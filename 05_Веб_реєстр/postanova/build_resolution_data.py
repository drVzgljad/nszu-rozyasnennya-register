import json
import re
import shutil
from bisect import bisect_right
from pathlib import Path

try:
    import fitz
except ImportError as exc:
    raise SystemExit("Для індексації PDF потрібен PyMuPDF: pip install pymupdf") from exc


WEB_DIR = Path(__file__).resolve().parents[1]
SITE_REPO = WEB_DIR.parent
SOURCE_DIR = SITE_REPO.parent / "postanova_1808"
OUTPUT_DIR = Path(__file__).resolve().parent
DOCS_DIR = OUTPUT_DIR / "docs"
DATA_DIR = OUTPUT_DIR / "data"
PACKAGES_JSON = WEB_DIR / "pakety" / "data" / "packages_2026.json"
LINKS_JSON = DATA_DIR / "package_resolution_links.json"

TYPE_LABELS = {
    "tariff": "Тарифи",
    "coefficient": "Коефіцієнти",
    "formula": "Формули",
    "deadline": "Строки",
    "monitoring": "Моніторинг",
    "contract": "Договори",
    "reimbursement": "Реімбурсація",
    "general": "Загальні правила",
}


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def classify(text, section_type=""):
    normalized = text.casefold()
    types = []
    checks = [
        ("tariff", ["тариф", "ставк"]),
        ("coefficient", ["коефіцієнт"]),
        ("formula", ["формул", "розраховується як", " = "]),
        ("deadline", ["до 1 ", "до 5 ", "до 10 ", "до 15 ", "до 20 ", "до 30 ", "до 31 ", "щомісяця"]),
        ("monitoring", ["моніторинг", "контрол"]),
        ("contract", ["договор"]),
        ("reimbursement", ["реімбурсац", "лікарських засобів", "медичних виробів"]),
    ]
    for key, needles in checks:
        if any(needle in normalized for needle in needles):
            types.append(key)
    if section_type == "reimbursement" and "reimbursement" not in types:
        types.append("reimbursement")
    return types or ["general"]


def find_first_page(pages, needle, start=0):
    for index in range(start, len(pages)):
        if needle.casefold() in pages[index].casefold():
            return index
    raise ValueError(f"Не знайдено структурну мітку PDF: {needle}")


def page_for_text(pages, text, start, end):
    fragment = clean(text)[:55].casefold()
    if fragment:
        for index in range(start, end):
            if fragment in pages[index].casefold():
                return index + 1
    return start + 1


def between(text, start_marker, end_marker=None):
    start = text.find(start_marker)
    if start < 0:
        raise ValueError(f"Не знайдено початок текстового блоку: {start_marker}")
    end = text.find(end_marker, start + len(start_marker)) if end_marker else len(text)
    if end_marker and end < 0:
        raise ValueError(f"Не знайдено кінець текстового блоку: {end_marker}")
    return clean(text[start:end])


def split_numbered_items(text, page_start, page_end, pages, prefix, section_type=""):
    matches = list(re.finditer(r"(?<!\d)(\d{1,3})\.\s+", text))
    items = []
    previous_number = -1
    for index, match in enumerate(matches):
        value = clean(text[match.start(): matches[index + 1].start() if index + 1 < len(matches) else len(text)])
        if len(value) < 12:
            continue
        number = match.group(1)
        numeric_number = int(number)
        if numeric_number <= previous_number:
            if items:
                items[-1]["text"] = clean(f"{items[-1]['text']} {value}")
                items[-1]["types"] = sorted(set(items[-1]["types"] + classify(value, section_type)))
            continue
        previous_number = numeric_number
        items.append({
            "id": f"{prefix}-p{number}",
            "number": number,
            "text": value,
            "page": page_for_text(pages, value, page_start - 1, page_end),
            "types": classify(value, section_type),
        })
    return items


def related_packages(numbers, packages):
    return [
        {"number": number, "title": packages[number]["title"], "related_document_ids": packages[number]["related_document_ids"]}
        for number in numbers if number in packages
    ]


def make_node(node_id, kind, title, text, page_start, page_end, pages, package_numbers, packages, section_type="", item_prefix=None):
    item_prefix = item_prefix or node_id
    items = split_numbered_items(text, page_start, page_end, pages, item_prefix, section_type)
    node_types = sorted(set(classify(text, section_type) + [tag for item in items for tag in item["types"]]))
    linked = related_packages(package_numbers, packages)
    return {
        "id": node_id,
        "kind": kind,
        "title": title,
        "page_start": page_start,
        "page_end": page_end,
        "types": node_types,
        "items": items,
        "text": text if not items else "",
        "package_numbers": package_numbers,
        "related_packages": linked,
    }


def extract_chapters(pages, start, end, packages, links):
    page_texts = pages[start:end + 1]
    combined = "\n".join(page_texts)
    combined = combined[:combined.find("III. Реімбурсація")]
    boundaries = []
    cursor = 0
    for page_text in page_texts:
        boundaries.append(cursor)
        cursor += len(page_text) + 1

    def source_page(offset):
        return start + bisect_right(boundaries, offset)

    headings = list(re.finditer(r"Глава\s+(\d+)\.\s+", combined))
    chapters = []
    for index, match in enumerate(headings):
        chunk = clean(combined[match.start(): headings[index + 1].start() if index + 1 < len(headings) else len(combined)])
        title_match = re.match(r"Глава\s+\d+\.\s+(.*?)(?=\s+\d+\.\s+)", chunk)
        title = title_match.group(1) if title_match else chunk[:110]
        body = clean(chunk[title_match.end():]) if title_match else chunk
        page_start = source_page(match.start())
        page_end = source_page((headings[index + 1].start() - 1) if index + 1 < len(headings) else len(combined) - 1)
        number = match.group(1)
        chapters.append(make_node(
            f"chapter-{number}", "chapter", f"Глава {number}. {title}", body,
            page_start, max(page_start, page_end), pages,
            links.get(number, []), packages, item_prefix=f"chapter-{number}"
        ))
    return chapters


def main():
    source_pdf = next(SOURCE_DIR.glob("*.pdf"), None)
    if not source_pdf:
        raise SystemExit(f"Не знайдено PDF у папці: {SOURCE_DIR}")
    packages_payload = json.loads(PACKAGES_JSON.read_text(encoding="utf-8"))
    packages = {package["number"]: package for package in packages_payload["packages"]}
    links = json.loads(LINKS_JSON.read_text(encoding="utf-8"))

    document = fitz.open(source_pdf)
    pages = [clean(page.get_text("text")) for page in document]
    full_text = clean(" ".join(pages))
    order_start = find_first_page(pages, "ЗАТВЕРДЖЕНО постановою Кабінету Міністрів України від 31 грудня 2025 р. № 1808 ПОРЯДОК")
    packages_start = find_first_page(pages, "II. Пакети медичних послуг")
    reimbursement_start = find_first_page(pages, "III. Реімбурсація")
    appendix_1 = find_first_page(pages, "Додаток 1 до Порядку ВАГОВІ КОЕФІЦІЄНТИ")
    appendix_2 = find_first_page(pages, "Додаток 2 до Порядку КОЕФІЦІЄНТИ")
    appendix_3 = find_first_page(pages, "Додаток 3 до Порядку КОЕФІЦІЄНТ")
    amendments_start = find_first_page(pages, "ЗМІНИ, що вносяться", appendix_3)

    parts = [
        make_node("resolution", "part", "Постанова та доручення", clean(" ".join(pages[:order_start])), 1, order_start, pages, [], packages),
        make_node(
            "part-i", "part", "I. Загальна частина",
            between(full_text, "I. Загальна частина", "II. Пакети медичних послуг"),
            order_start + 1, packages_start + 1, pages, [], packages
        ),
        make_node(
            "part-iii", "part", "III. Реімбурсація",
            between(full_text, "III. Реімбурсація", "Додаток 1 до Порядку"),
            reimbursement_start + 1, appendix_1, pages, [], packages, section_type="reimbursement"
        ),
        make_node(
            "amendments", "part", "Зміни до інших постанов", clean(" ".join(pages[amendments_start:-1])),
            amendments_start + 1, len(pages) - 1, pages, [], packages
        ),
    ]
    chapters = extract_chapters(pages, packages_start, reimbursement_start, packages, links["chapters"])
    appendix_ranges = [(appendix_1, appendix_2), (appendix_2, appendix_3), (appendix_3, amendments_start)]
    appendix_titles = [
        "Додаток 1. Вагові коефіцієнти діагностично-споріднених груп",
        "Додаток 2. Коефіцієнти кардіохірургічних діагностично-споріднених груп",
        "Додаток 3. Коефіцієнт збалансованості бюджету",
    ]
    appendices = []
    for index, (start, end) in enumerate(appendix_ranges, start=1):
        appendices.append(make_node(
            f"appendix-{index}", "appendix", appendix_titles[index - 1], clean(" ".join(pages[start:end])),
            start + 1, end, pages, links["appendices"][str(index)], packages
        ))

    all_nodes = parts + chapters + appendices
    package_links = {}
    for node in chapters + appendices:
        for package_number in node["package_numbers"]:
            package_links.setdefault(package_number, []).append({
                "id": node["id"],
                "title": node["title"],
                "page": node["page_start"],
                "types": node["types"],
            })

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_pdf, DOCS_DIR / "postanova_1808.pdf")
    payload = {
        "document": {
            "title": "Деякі питання реалізації програми державних гарантій медичного обслуговування населення у 2026 році",
            "number": "1808",
            "date": "31.12.2025",
            "edition_date": "04.04.2026",
            "amended_by": "Постанова КМУ № 440 від 03.04.2026",
            "page_count": len(pages),
            "source_href": "docs/postanova_1808.pdf",
        },
        "generated": "2026-05-26",
        "counts": {"chapters": len(chapters), "appendices": len(appendices), "packages_linked": len(package_links)},
        "type_labels": TYPE_LABELS,
        "parts": parts,
        "chapters": chapters,
        "appendices": appendices,
        "package_links": package_links,
    }
    target = DATA_DIR / "resolution_1808.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"pages": len(pages), "chapters": len(chapters), "appendices": len(appendices), "packages_linked": len(package_links), "output": str(target)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
