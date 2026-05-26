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


def paragraphs_from_docx(path):
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    paragraphs = []
    for paragraph in root.findall(".//w:p", NS):
        text = clean("".join(node.text or "" for node in paragraph.findall(".//w:t", NS)))
        if text:
            paragraphs.append(text)
    return paragraphs


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
    starts = [index for index, text in enumerate(body) if section_key(text) == "specification"]
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
        for text in segment:
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
            current["items"].append(text)
        sections = [section for section in sections if section["source_heading"] or section["items"]]
        first_spec = next((s for s in sections if s["key"] == "specification"), None)
        label = ""
        if multiple:
            candidate = first_spec["items"][0] if first_spec and first_spec["items"] else ""
            label = candidate if candidate else f"Блок послуг {unit_index + 1}"
        units.append({"id": f"unit-{unit_index + 1}", "label": label, "sections": sections})
    return units


def extract_tags(units):
    conditions_text = " ".join(
        " ".join([section["source_heading"]] + section["items"])
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
        section["source_heading"] + " " + " ".join(section["items"])
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
    title = re.sub(r"^\d+\s*[.]?\s*", "", paragraphs[0]).strip()
    search_text = clean(" ".join(paragraphs)).casefold()
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
        "generated": "2026-05-26",
        "package_count": len(packages),
        "packages": packages,
    }
    output = DATA_DIR / "packages_2026.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"package_count": len(packages), "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
