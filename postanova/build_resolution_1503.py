"""Розбір постанови КМУ від 24.12.2024 № 1503 (ПМГ-2025) — пара до 1808.

Навіщо окремий білдер, а не параметр до build_resolution_data.py: у 1503 інша
розкладка додатків (1 — вагові ДСГ, 2 — коефіцієнт збалансованості, 3 — вагові
ДСГ при симультанних операціях; у 1808 порядок 1/2/3 інший) і немає прив'язки
до пакетів 2026 року. Спільне — формат виходу: сторінка порівняння читає обидві
постанови однаково.

Джерело тексту — консолідована редакція з zakon.rada.gov.ua (14 змін 2025 року).
"""

import json
import re
import shutil
import sys
from html.parser import HTMLParser
from pathlib import Path

try:
    import fitz
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "04_Реєстр" / "_python_deps"))
    try:
        import fitz
    except ImportError as exc:
        raise SystemExit("Для індексації PDF потрібен PyMuPDF: pip install pymupdf") from exc


WEB_DIR = Path(__file__).resolve().parents[1]
SITE_REPO = WEB_DIR.parent
SOURCE_DIR = next(
    (path for path in (SITE_REPO / "postanova_1503", SITE_REPO.parent / "postanova_1503")
     if path.is_dir()),
    SITE_REPO / "postanova_1503",
)
OUTPUT_DIR = Path(__file__).resolve().parent
DOCS_DIR = OUTPUT_DIR / "docs"
DATA_DIR = OUTPUT_DIR / "data"

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

# Заголовок додатка: саме «до Порядку». Без цього якоря ловляться згадки
# «додаток 1» усередині тексту і рядок «{Додаток 1 із змінами…}» після таблиці.
APPENDIX_HEAD_RE = re.compile(r"^Додаток\s+(\d+)\s+до Порядку")
CHAPTER_RE = re.compile(r"^Глава\s+(\d+)\.\s+")
# Маркер редакційної правки: {Пункт 40 в редакції Постанови КМ № 978 від 13.08.2025}
AMENDMENT_RE = re.compile(r"\{[^{}]*(?:Постанов|редакці|Зміни|доповнено|виключено)[^{}]*\}")


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


class ParagraphParser(HTMLParser):
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


class TableParser(HTMLParser):
    """Таблиці як таблиці — з порожніми клітинками включно.

    У плоскому потоці абзаців клітинки нерозрізненні від тексту: рядок додатка 1
    розсипається на «A15», «Лікування пацієнта…», «Хірургічні операції…», «7,512».
    Структуру беремо з розмітки.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._tables = []
        self._rows = []
        self._cell = None

    def handle_starttag(self, tag, attrs):
        tag = tag.casefold()
        if tag == "table":
            self._tables.append([])
        elif tag == "tr" and self._tables:
            self._rows.append([])
        elif tag in ("td", "th") and self._rows:
            self._cell = []

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        tag = tag.casefold()
        if tag in ("td", "th") and self._cell is not None:
            self._rows[-1].append(clean(" ".join(self._cell)))
            self._cell = None
        elif tag == "tr" and self._rows:
            row = self._rows.pop()
            if self._tables:
                self._tables[-1].append(row)
        elif tag == "table" and self._tables:
            self.tables.append(self._tables.pop())


def read_paragraphs(source_html):
    parser = ParagraphParser()
    parser.feed(source_html.read_text(encoding="utf-8", errors="ignore"))
    return parser.paragraphs


def read_tables(source_html):
    parser = TableParser()
    parser.feed(source_html.read_text(encoding="utf-8", errors="ignore"))
    return parser.tables


def coefficient_tables(tables):
    """{id додатка: {columns, rows}} — таблиці вагових коефіцієнтів ДСГ.

    Обидві мають першу колонку «Код», а розрізняються шириною: у додатку 1 є
    колонка «Пакет послуг», у додатку 3 її немає, бо він увесь про один пакет.
    """
    found = {}
    for table in tables:
        if not table or len(table) < 20:
            continue
        head = table[0]
        if not head or head[0] != "Код" or not head[-1].startswith("Ваговий коефіцієнт"):
            continue
        node_id = "appendix-1" if len(head) == 4 else "appendix-3"
        if node_id in found:
            continue
        width = len(head)
        rows, skipped = [], 0
        for cells in table[1:]:
            cells = (cells + [""] * width)[:width]
            if not cells[0]:
                skipped += 1
                continue
            rows.append({
                "code": cells[0],
                "title": cells[1],
                "package": cells[2] if width == 4 else "",
                "coeffs": cells[width - 1:],
            })
        found[node_id] = {"columns": head[width - 1:], "rows": rows}
        print(f"  {node_id}: {len(rows)} рядків ДСГ"
              + (f", пропущено рядків без коду: {skipped}" if skipped else ""))
    return found


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
        for index in range(max(0, start), min(end, len(pages))):
            if fragment in pages[index].casefold():
                return index + 1
    return max(1, start + 1)


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
    for item in items:
        notes = AMENDMENT_RE.findall(item["text"])
        if notes:
            item["notes"] = notes
    return items


def make_node(node_id, kind, title, paragraphs, page_start, page_end, pages,
              legal_document, section_type="", item_prefix=None):
    item_prefix = item_prefix or node_id
    text = clean(" ".join(paragraphs))
    items = split_numbered_items(paragraphs, page_start, page_end, pages, item_prefix, section_type)
    node_types = sorted(set(classify(text, section_type) + [tag for item in items for tag in item["types"]]))
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
    }


def extract_chapters(paragraphs, pages, start, end):
    headings = [index for index, paragraph in enumerate(paragraphs) if CHAPTER_RE.match(paragraph)]
    chapters = []
    for order, heading_index in enumerate(headings):
        next_index = headings[order + 1] if order + 1 < len(headings) else len(paragraphs)
        heading = paragraphs[heading_index]
        body = paragraphs[heading_index + 1:next_index]
        page_start = page_for_text(pages, heading, start, end + 1)
        next_page = (page_for_text(pages, paragraphs[next_index], start, end + 1)
                     if next_index < len(paragraphs) else end + 1)
        number = CHAPTER_RE.match(heading).group(1)
        chapters.append(make_node(
            f"chapter-{number}", "chapter", heading, body,
            page_start, max(page_start, next_page), pages, "Порядок",
            item_prefix=f"chapter-{number}",
        ))
    return chapters


def main():
    source_pdf = next(SOURCE_DIR.glob("*.pdf"), None)
    source_html = next(SOURCE_DIR.glob("*.htm"), None)
    if not source_pdf or not source_html:
        raise SystemExit(f"Потрібні PDF і HTM у папці: {SOURCE_DIR}")

    document = fitz.open(source_pdf)
    pages = [clean(page.get_text("text")) for page in document]
    paragraphs = read_paragraphs(source_html)

    # Якорі в потоці абзаців. Індекси, а не пошук підрядка: клітинки таблиць
    # теж приходять сюди абзацами, тож підрядок «Додаток 1» ловить зайве.
    def only(predicate, label):
        hits = [index for index, text in enumerate(paragraphs) if predicate(text)]
        if not hits:
            raise SystemExit(f"Не знайдено якір HTM: {label}")
        return hits

    idx_general = only(lambda t: t == "I. Загальна частина", "I. Загальна частина")[0]
    idx_packages = only(lambda t: t.startswith("II. Пакети медичних послуг"), "II. Пакети")[0]
    idx_reimbursement = only(lambda t: t == "III. Реімбурсація", "III. Реімбурсація")[0]
    idx_resolution = only(lambda t: t.endswith("постановляє:"), "постановляє:")[0]
    idx_approved = only(lambda t: t.startswith("ЗАТВЕРДЖЕНО"), "ЗАТВЕРДЖЕНО")[0]
    idx_amendments = only(lambda t: t.startswith("ЗМІНИ, що вносяться"), "ЗМІНИ, що вносяться")[0]

    appendix_heads = only(lambda t: APPENDIX_HEAD_RE.match(t), "Додаток N до Порядку")
    if len(appendix_heads) != 3:
        raise SystemExit(f"Очікували 3 додатки, знайшли {len(appendix_heads)}: {appendix_heads}")

    page_order = find_first_page(pages, "ЗАТВЕРДЖЕНО постановою Кабінету Міністрів України від 24 грудня 2024 р. № 1503")
    page_packages = find_first_page(pages, "II. Пакети медичних послуг")
    page_reimbursement = find_first_page(pages, "III. Реімбурсація")
    page_appendix_1 = find_first_page(pages, "Додаток 1 до Порядку ВАГОВІ КОЕФІЦІЄНТИ")
    page_appendix_2 = find_first_page(pages, "Додаток 2 до Порядку КОЕФІЦІЄНТ", page_appendix_1)
    page_appendix_3 = find_first_page(pages, "Додаток 3 до Порядку", page_appendix_2)
    page_amendments = find_first_page(pages, "ЗМІНИ, що вносяться", page_appendix_3)

    parts = [
        make_node("resolution", "part", "Постанова. Розпорядчі положення",
                  paragraphs[idx_resolution + 1:idx_approved], 1, page_order, pages, "Постанова"),
        make_node("part-i", "part", "I. Загальна частина",
                  paragraphs[idx_general + 1:idx_packages], page_order + 1, page_packages + 1, pages, "Порядок"),
        make_node("part-iii", "part", "III. Реімбурсація",
                  paragraphs[idx_reimbursement + 1:appendix_heads[0]],
                  page_reimbursement + 1, page_appendix_1, pages, "Порядок", section_type="reimbursement"),
        make_node("amendments", "part", "Зміни до інших постанов",
                  paragraphs[idx_amendments:], page_amendments + 1, len(pages), pages, "Зміни"),
    ]

    chapters = extract_chapters(paragraphs[idx_packages:idx_reimbursement], pages,
                                page_packages, page_reimbursement)

    print("Таблиці коефіцієнтів:")
    tables = coefficient_tables(read_tables(source_html))

    appendix_titles = {
        1: "Додаток 1. Вагові коефіцієнти діагностично-споріднених груп",
        2: "Додаток 2. Коефіцієнт збалансованості бюджету",
        3: "Додаток 3. Вагові коефіцієнти ДСГ при симультанних, повторних і послідовних операціях",
    }
    appendix_pages = {1: (page_appendix_1, page_appendix_2), 2: (page_appendix_2, page_appendix_3),
                      3: (page_appendix_3, page_amendments)}
    appendices = []
    for order, head_index in enumerate(appendix_heads):
        number = int(APPENDIX_HEAD_RE.match(paragraphs[head_index]).group(1))
        stop = appendix_heads[order + 1] if order + 1 < len(appendix_heads) else idx_approved
        body = paragraphs[head_index:stop]
        # У додатках із таблицею проза закінчується там, де починається шапка:
        # решта абзаців — це клітинки, вони приїдуть окремо у node["table"].
        if "Код" in body:
            body = body[:body.index("Код")]
        page_start, page_end = appendix_pages[number]
        node = make_node(f"appendix-{number}", "appendix", appendix_titles[number], body,
                         page_start + 1, page_end, pages, "Порядок")
        if tables.get(node["id"]):
            node["table"] = tables[node["id"]]
        appendices.append(node)

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_pdf, DOCS_DIR / "postanova_1503.pdf")
    shutil.copy2(source_html, DOCS_DIR / "postanova_1503.htm")

    amended_by = re.search(r"\{Із змінами, внесеними згідно з Постановами? КМ(.+?)\}", pages[0])
    payload = {
        "document": {
            "title": "Деякі питання реалізації програми державних гарантій медичного "
                     "обслуговування населення у 2025 році",
            "number": "1503",
            "date": "24.12.2024",
            "amended_by": clean(amended_by.group(1)) if amended_by else "",
            "page_count": len(pages),
            "source_href": "docs/postanova_1503.pdf",
            "source_html_href": "docs/postanova_1503.htm",
            "source_url": "https://zakon.rada.gov.ua/laws/show/1503-2024-п",
        },
        "counts": {
            "chapters": len(chapters),
            "appendices": len(appendices),
            "resolution_items": len(parts[0]["items"]),
        },
        "type_labels": TYPE_LABELS,
        "parts": parts,
        "chapters": chapters,
        "appendices": appendices,
    }
    target = DATA_DIR / "resolution_1503.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "pages": len(pages),
        "chapters": len(chapters),
        "chapter_numbers": [c["id"].split("-")[1] for c in chapters],
        "appendices": [a["id"] for a in appendices],
        "output": str(target),
        "size_kb": round(target.stat().st_size / 1024, 1),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
