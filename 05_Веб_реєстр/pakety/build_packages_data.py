import json
import re
import shutil
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


WEB_DIR = Path(__file__).resolve().parents[1]
SITE_REPO = WEB_DIR.parent
SOURCE_DIR = SITE_REPO.parent / "paket_26"
OUTPUT_DIR = Path(__file__).resolve().parent
DOCS_DIR = OUTPUT_DIR / "docs"
DATA_DIR = OUTPUT_DIR / "data"
DOCUMENTS_JSON = WEB_DIR / "data" / "documents.json"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

SECTION_LABELS = {
    "specification": "Що входить у пакет (специфікація)",
    "conditions": "Умови надання",
    "grounds": "Підстави надання",
    "organization": "Організаційні вимоги",
    "specialists": "Спеціалісти",
    "equipment": "Обладнання",
    "other": "Інші вимоги",
}

PACKAGE_GROUPS = {
    "01": ["ПМД"],
    "03": ["Хірургія-стаціонар"],
    "04": ["Стаціонарна-допомога-без-операцій"],
    "05": ["Інсульт"],
    "06": ["Інфаркт"],
    "07": ["Допомога-при-пологах"],
    "08": ["Допомога-новонародженим"],
    "09": ["Амбулаторна-допомога"],
    "16": ["Гемодіаліз"],
    "18": ["Радіологічне-лікування"],
    "19": ["Психіатрична-допомога"],
    "20": ["Туберкульоз-ПМД"],
    "23": ["Паліативна-допомога"],
    "24": ["Паліативна-допомога"],
    "34": ["Стоматологічна-допомога"],
    "37": ["Перитонеальний-діаліз"],
    "53": ["Реабілітація", "Пакети-53-54"],
    "54": ["Реабілітація", "Пакети-53-54"],
    "60": ["Медогляд-ТЦК"],
    "63": ["Лікування-безпліддя-ДРТ"],
    "64": ["Трансплантація"],
    "86": ["Медична-допомога-дітям"],
}


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def w_attr(element, name):
    return element.get(f"{{{NS['w']}}}{name}") if element is not None else None


def parse_numbering(archive):
    if "word/numbering.xml" not in archive.namelist():
        return {}, {}, {}
    root = ET.fromstring(archive.read("word/numbering.xml"))
    abstract_levels = {}
    for abstract in root.findall("w:abstractNum", NS):
        abstract_id = w_attr(abstract, "abstractNumId")
        levels = {}
        for level in abstract.findall("w:lvl", NS):
            ilvl = int(w_attr(level, "ilvl") or 0)
            start = level.find("w:start", NS)
            num_fmt = level.find("w:numFmt", NS)
            lvl_text = level.find("w:lvlText", NS)
            levels[ilvl] = {
                "start": int(w_attr(start, "val") or 1),
                "fmt": w_attr(num_fmt, "val") or "decimal",
                "text": w_attr(lvl_text, "val") or "%1.",
            }
        abstract_levels[abstract_id] = levels

    num_to_abstract = {}
    overrides = {}
    for num in root.findall("w:num", NS):
        num_id = w_attr(num, "numId")
        abstract = num.find("w:abstractNumId", NS)
        num_to_abstract[num_id] = w_attr(abstract, "val")
        for override in num.findall("w:lvlOverride", NS):
            ilvl = int(w_attr(override, "ilvl") or 0)
            start_override = override.find("w:startOverride", NS)
            if start_override is not None:
                overrides[(num_id, ilvl)] = int(w_attr(start_override, "val") or 1)
    return num_to_abstract, abstract_levels, overrides


def number_to_letters(value):
    letters = ""
    while value > 0:
        value -= 1
        letters = chr(ord("a") + (value % 26)) + letters
        value //= 26
    return letters or "a"


def number_to_roman(value):
    numerals = [
        (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"),
        (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
        (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
    ]
    result = ""
    for amount, numeral in numerals:
        while value >= amount:
            result += numeral
            value -= amount
    return result or "i"


def format_counter(value, num_format):
    if num_format == "lowerLetter":
        return number_to_letters(value)
    if num_format == "upperLetter":
        return number_to_letters(value).upper()
    if num_format == "lowerRoman":
        return number_to_roman(value)
    if num_format == "upperRoman":
        return number_to_roman(value).upper()
    if num_format == "bullet":
        return "\u2022"
    return str(value)


def paragraph_numbering(paragraph):
    num_pr = paragraph.find("w:pPr/w:numPr", NS)
    if num_pr is None:
        return None
    num_id = w_attr(num_pr.find("w:numId", NS), "val")
    ilvl = int(w_attr(num_pr.find("w:ilvl", NS), "val") or 0)
    if not num_id:
        return None
    return num_id, ilvl


def make_marker(num_id, ilvl, counters, num_to_abstract, abstract_levels, overrides):
    abstract_id = num_to_abstract.get(num_id)
    levels = abstract_levels.get(abstract_id, {})
    level = levels.get(ilvl, {})
    start = overrides.get((num_id, ilvl), level.get("start", 1))
    key = (num_id, ilvl)
    counters[key] = counters.get(key, start - 1) + 1
    for old_key in list(counters):
        if old_key[0] == num_id and old_key[1] > ilvl:
            counters.pop(old_key, None)

    pattern = level.get("text", f"%{ilvl + 1}.")
    if level.get("fmt") == "bullet":
        return format_counter(counters[key], "bullet")

    def replace(match):
        ref_level = int(match.group(1)) - 1
        ref_info = levels.get(ref_level, level)
        ref_value = counters.get((num_id, ref_level), counters[key])
        return format_counter(ref_value, ref_info.get("fmt", "decimal"))

    return re.sub(r"%(\d+)", replace, pattern)


def paragraphs_from_docx(path):
    with ZipFile(path) as archive:
        num_to_abstract, abstract_levels, overrides = parse_numbering(archive)
        root = ET.fromstring(archive.read("word/document.xml"))
    paragraphs = []
    counters = {}
    for paragraph in root.findall(".//w:p", NS):
        text = clean("".join(node.text or "" for node in paragraph.findall(".//w:t", NS)))
        if text:
            numbering = paragraph_numbering(paragraph)
            marker = ""
            level = 0
            if numbering:
                num_id, level = numbering
                marker = make_marker(num_id, level, counters, num_to_abstract, abstract_levels, overrides)
            paragraphs.append({"text": text, "marker": marker, "level": level})
    return paragraphs


def paragraph_text(paragraph):
    return paragraph["text"] if isinstance(paragraph, dict) else paragraph


def item_payload(paragraph):
    if isinstance(paragraph, dict):
        return {
            "text": paragraph["text"],
            "marker": paragraph.get("marker", ""),
            "level": paragraph.get("level", 0),
        }
    return {"text": paragraph, "marker": "", "level": 0}


def item_text(item):
    return item["text"] if isinstance(item, dict) else item


def item_search_text(item):
    if isinstance(item, dict):
        return clean(f"{item.get('marker', '')} {item.get('text', '')}")
    return item


def section_key(text):
    normalized = text.casefold()
    if normalized.startswith("обсяг медичних послуг") or (
        normalized.startswith("опис медичних послуг") and "специфікац" in normalized
    ):
        return "specification"
    if normalized.startswith("умови закупівлі медичних послуг"):
        return "procurement"
    if normalized.startswith("умови надання послуги") or normalized.startswith("умови надання послуг"):
        return "conditions"
    if normalized.startswith("підстави надання послуги") or normalized.startswith("підстави надання послуг"):
        return "grounds"
    if normalized.startswith("вимоги до організації"):
        return "organization"
    if normalized.startswith("вимоги до структурних підрозділів"):
        return "organization"
    if normalized.startswith("вимоги до спеціалістів"):
        return "specialists"
    if normalized.startswith("вимоги до переліку обладнання"):
        return "equipment"
    if normalized.startswith("інші вимоги"):
        return "other"
    return None


def new_section(key, heading):
    return {
        "key": key,
        "label": SECTION_LABELS[key],
        "source_heading": heading,
        "items": [],
    }


def parse_units(paragraphs):
    body = paragraphs[1:]
    starts = [index for index, paragraph in enumerate(body) if section_key(paragraph_text(paragraph)) == "specification"]
    if starts and starts[0] == 0:
        segments = [body[starts[index]: starts[index + 1] if index + 1 < len(starts) else len(body)] for index in range(len(starts))]
    else:
        segments = [body]
    units = []
    multiple = len(segments) > 1
    for unit_index, segment in enumerate(segments):
        sections = []
        current = None
        procurement_pending = False
        for paragraph in segment:
            text = paragraph_text(paragraph)
            key = section_key(text)
            if key == "procurement":
                procurement_pending = True
                current = None
                continue
            if key:
                current = new_section(key, text)
                sections.append(current)
                procurement_pending = False
                continue
            if current is None:
                current = new_section("other", "Умови закупівлі медичних послуг" if procurement_pending else "")
                sections.append(current)
                procurement_pending = False
            current["items"].append(item_payload(paragraph))
        sections = [section for section in sections if section["source_heading"] or section["items"]]
        first_spec = next((s for s in sections if s["key"] == "specification"), None)
        label = ""
        if multiple:
            candidate = item_text(first_spec["items"][0]) if first_spec and first_spec["items"] else ""
            label = candidate if candidate else f"Блок послуг {unit_index + 1}"
        units.append({"id": f"unit-{unit_index + 1}", "label": label, "sections": sections})
    return units


def extract_tags(units):
    conditions_text = " ".join(
        " ".join([section["source_heading"]] + [item_search_text(item) for item in section["items"]])
        for unit in units for section in unit["sections"] if section["key"] == "conditions"
    )
    conditions_text = conditions_text.casefold()
    tags = []
    for token, label in [
        ("амбулатор", "Амбулаторно"),
        ("стаціонар", "Стаціонарно"),
        ("місцем проживання", "За місцем перебування"),
        ("місцем перебування", "За місцем перебування"),
        ("електронних комунікацій", "Дистанційно"),
    ]:
        if token in conditions_text and label not in tags:
            tags.append(label)
    full_text = " ".join(
        section["source_heading"] + " " + " ".join(item_search_text(item) for item in section["items"])
        for unit in units for section in unit["sections"]
    ).casefold()
    if "критичні" in full_text:
        tags.append("Критичні вимоги")
    return tags


def related_ids(number, documents):
    groups = set(PACKAGE_GROUPS.get(number, []))
    return [
        document["id"]
        for document in documents
        if document.get("package") in groups
    ][:12]


def build_package(path, documents):
    paragraphs = paragraphs_from_docx(path)
    number = re.match(r"(\d+)", path.name).group(1)
    number = str(int(number))
    units = parse_units(paragraphs)
    title = re.sub(r"^\d+\s*[.]?\s*", "", paragraph_text(paragraphs[0])).strip()
    search_text = clean(" ".join(paragraph_text(paragraph) for paragraph in paragraphs)).casefold()
    return {
        "number": number,
        "title": title,
        "file_name": path.name,
        "source_href": "docs/" + path.name,
        "tags": extract_tags(units),
        "units": units,
        "related_document_ids": related_ids(number.zfill(2), documents),
        "search_text": search_text,
    }


def main():
    if not SOURCE_DIR.exists():
        raise SystemExit(f"Не знайдено папку джерел: {SOURCE_DIR}")
    documents = json.loads(DOCUMENTS_JSON.read_text(encoding="utf-8"))["documents"]
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    source_files = sorted(SOURCE_DIR.glob("*.docx"))
    packages = []
    for source_file in source_files:
        packages.append(build_package(source_file, documents))
        shutil.copy2(source_file, DOCS_DIR / source_file.name)
    payload = {
        "generated": "2026-05-29",
        "package_count": len(packages),
        "packages": packages,
    }
    output = DATA_DIR / "packages_2026.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"package_count": len(packages), "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
