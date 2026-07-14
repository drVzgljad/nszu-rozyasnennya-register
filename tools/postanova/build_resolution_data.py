import json
import re
import shutil
import sys
from html.parser import HTMLParser
from pathlib import Path

try:
    import fitz
except ImportError:
    LOCAL_DEPS = Path(__file__).resolve().parents[3] / "04_Реєстр" / "_python_deps"
    sys.path.insert(0, str(LOCAL_DEPS))
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


class SourceHtmlParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.paragraphs = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag.casefold() == "p":
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag.casefold() == "p" and self.current is not None:
            text = clean(" ".join(self.current))
            if text:
                self.paragraphs.append(text)
            self.current = None


def read_html_paragraphs(source_html):
    parser = SourceHtmlParser()
    parser.feed(source_html.read_text(encoding="utf-8", errors="ignore"))
    return parser.paragraphs


def block_between(paragraphs, start_marker, end_marker=None, include_start=False):
    start = next((index for index, paragraph in enumerate(paragraphs) if start_marker in paragraph), None)
    if start is None:
        raise ValueError(f"Не знайдено початок текстового блоку HTM: {start_marker}")
    end = len(paragraphs)
    if end_marker:
        end = next(
            (index for index, paragraph in enumerate(paragraphs[start + 1:], start + 1) if end_marker in paragraph),
            None,
        )
        if end is None:
            raise ValueError(f"Не знайдено кінець текстового блоку HTM: {end_marker}")
    return paragraphs[start if include_start else start + 1:end]


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


def split_numbered_items(paragraphs, page_start, page_end, pages, prefix, section_type=""):
    items = []
    for paragraph in paragraphs:
        match = re.match(r"^(\d{1,3})\.\s+", paragraph)
        if not match:
            if items:
                items[-1]["text"] = clean(f"{items[-1]['text']} {paragraph}")
                items[-1]["types"] = sorted(set(items[-1]["types"] + classify(paragraph, section_type)))
            continue
        number = match.group(1)
        items.append({
            "id": f"{prefix}-p{number}",
            "number": number,
            "marker": f"{number}.",
            "text": paragraph,
            "page": page_for_text(pages, paragraph, page_start - 1, page_end),
            "types": classify(paragraph, section_type),
        })
    return items


def related_packages(numbers, packages):
    return [
        {"number": number, "title": packages[number]["title"], "related_document_ids": packages[number]["related_document_ids"]}
        for number in numbers if number in packages
    ]


def make_node(node_id, kind, title, paragraphs, page_start, page_end, pages, package_numbers, packages,
              legal_document, section_type="", item_prefix=None):
    item_prefix = item_prefix or node_id
    text = clean(" ".join(paragraphs))
    items = split_numbered_items(paragraphs, page_start, page_end, pages, item_prefix, section_type)
    node_types = sorted(set(classify(text, section_type) + [tag for item in items for tag in item["types"]]))
    linked = related_packages(package_numbers, packages)
    return {
        "id": node_id,
        "kind": kind,
        "legal_document": legal_document,
        "title": title,
        "page_start": page_start,
        "page_end": page_end,
        "types": node_types,
        "items": items,
        "text": text if not items else "",
        "package_numbers": package_numbers,
        "related_packages": linked,
    }


def extract_chapters(paragraphs, pages, start, end, packages, links):
    headings = [
        (index, re.match(r"^Глава\s+(\d+)\.\s+", paragraph))
        for index, paragraph in enumerate(paragraphs)
        if re.match(r"^Глава\s+(\d+)\.\s+", paragraph)
    ]
    chapters = []
    for index, (heading_index, match) in enumerate(headings):
        next_index = headings[index + 1][0] if index + 1 < len(headings) else len(paragraphs)
        heading = paragraphs[heading_index]
        body = paragraphs[heading_index + 1:next_index]
        page_start = page_for_text(pages, heading, start, end + 1)
        next_page = page_for_text(pages, paragraphs[next_index], start, end + 1) if next_index < len(paragraphs) else end + 1
        page_end = max(page_start, next_page)
        number = match.group(1)
        chapters.append(make_node(
            f"chapter-{number}", "chapter", heading, body,
            page_start, max(page_start, page_end), pages,
            links.get(number, []), packages, "Порядок", item_prefix=f"chapter-{number}"
        ))
    return chapters


def main():
    source_pdf = next(SOURCE_DIR.glob("*.pdf"), None)
    if not source_pdf:
        raise SystemExit(f"Не знайдено PDF у папці: {SOURCE_DIR}")
    source_html = next(SOURCE_DIR.glob("*.htm"), None)
    if not source_html:
        raise SystemExit(f"Не знайдено HTM у папці: {SOURCE_DIR}")
    packages_payload = json.loads(PACKAGES_JSON.read_text(encoding="utf-8"))
    packages = {package["number"]: package for package in packages_payload["packages"]}
    links = json.loads(LINKS_JSON.read_text(encoding="utf-8"))

    document = fitz.open(source_pdf)
    pages = [clean(page.get_text("text")) for page in document]
    html_paragraphs = read_html_paragraphs(source_html)
    order_start = find_first_page(pages, "ЗАТВЕРДЖЕНО постановою Кабінету Міністрів України від 31 грудня 2025 р. № 1808 ПОРЯДОК")
    packages_start = find_first_page(pages, "II. Пакети медичних послуг")
    reimbursement_start = find_first_page(pages, "III. Реімбурсація")
    appendix_1 = find_first_page(pages, "Додаток 1 до Порядку ВАГОВІ КОЕФІЦІЄНТИ")
    appendix_2 = find_first_page(pages, "Додаток 2 до Порядку КОЕФІЦІЄНТИ")
    appendix_3 = find_first_page(pages, "Додаток 3 до Порядку КОЕФІЦІЄНТ")
    amendments_start = find_first_page(pages, "ЗМІНИ, що вносяться", appendix_3)
    resolution_paragraphs = block_between(html_paragraphs, "постановляє:", "ЗАТВЕРДЖЕНО")
    general_paragraphs = block_between(html_paragraphs, "I. Загальна частина", "II. Пакети медичних послуг")
    package_paragraphs = block_between(html_paragraphs, "II. Пакети медичних послуг", "III. Реімбурсація")
    reimbursement_paragraphs = block_between(html_paragraphs, "III. Реімбурсація", "Додаток 1")
    amendments_paragraphs = block_between(html_paragraphs, "ЗМІНИ,", None, include_start=True)

    parts = [
        make_node("resolution", "part", "Постанова. Розпорядчі положення", resolution_paragraphs, 1, order_start, pages, [], packages, "Постанова"),
        make_node(
            "part-i", "part", "I. Загальна частина",
            general_paragraphs, order_start + 1, packages_start + 1, pages, [], packages, "Порядок"
        ),
        make_node(
            "part-iii", "part", "III. Реімбурсація",
            reimbursement_paragraphs, reimbursement_start + 1, appendix_1, pages, [], packages, "Порядок",
            section_type="reimbursement"
        ),
        make_node(
            "amendments", "part", "Зміни до інших постанов", amendments_paragraphs,
            amendments_start + 1, len(pages) - 1, pages, [], packages, "Зміни"
        ),
    ]
    chapters = extract_chapters(package_paragraphs, pages, packages_start, reimbursement_start, packages, links["chapters"])
    appendix_ranges = [(appendix_1, appendix_2), (appendix_2, appendix_3), (appendix_3, amendments_start)]
    appendix_titles = [
        "Додаток 1. Вагові коефіцієнти діагностично-споріднених груп",
        "Додаток 2. Коефіцієнти кардіохірургічних діагностично-споріднених груп",
        "Додаток 3. Коефіцієнт збалансованості бюджету",
    ]
    appendices = []
    for index, (start, end) in enumerate(appendix_ranges, start=1):
        appendix_paragraphs = block_between(
            html_paragraphs,
            f"Додаток {index}",
            f"Додаток {index + 1}" if index < 3 else "ЗМІНИ,",
            include_start=True,
        )
        appendices.append(make_node(
            f"appendix-{index}", "appendix", appendix_titles[index - 1], appendix_paragraphs,
            start + 1, end, pages, links["appendices"][str(index)], packages, "Порядок"
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
    shutil.copy2(source_html, DOCS_DIR / "postanova_1808.htm")
    payload = {
        "document": {
            "title": "Деякі питання реалізації програми державних гарантій медичного обслуговування населення у 2026 році",
            "number": "1808",
            "date": "31.12.2025",
            "edition_date": "04.04.2026",
            "amended_by": "Постанова КМУ № 440 від 03.04.2026",
            "page_count": len(pages),
            "source_href": "docs/postanova_1808.pdf",
            "source_html_href": "docs/postanova_1808.htm",
        },
        "generated": "2026-05-27",
        "counts": {
            "chapters": len(chapters),
            "appendices": len(appendices),
            "packages_linked": len(package_links),
            "resolution_items": len(parts[0]["items"]),
        },
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
