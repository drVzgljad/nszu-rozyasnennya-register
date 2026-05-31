import json
import re
import shutil
from pathlib import Path

import pypdf


WEB_DIR = Path(__file__).resolve().parents[1]
SITE_REPO = WEB_DIR.parent
SOURCE_DIR = SITE_REPO.parent / "07_Алгоритми та правила"
OUTPUT_DIR = Path(__file__).resolve().parent
DOCS_DIR = OUTPUT_DIR / "docs"
DATA_DIR = OUTPUT_DIR / "data"

CODE_RE = re.compile(r"^[A-ZА-Я]\d{2}(?:\.\d{1,2})?\b")
INLINE_CODE_RE = re.compile(r"\b[A-ZА-Я]\d{2}(?:\.\d{1,2})?\b")
TAK_RE = re.compile(r"так(?:,\s*для\s*(\d+)\s*пакет[ау]?)?", re.I)

SOURCE_META = {
    "Додаток 3": {
        "id": "appendix-3",
        "kind": "appendix",
        "title": "Додаток 3. Амбулаторно-асоційовані стани та втручання",
        "short_title": "Амбулаторно-асоційовані стани",
        "description": "Перелік амбулаторно-асоційованих діагнозів та втручань за пакетами 3, 4 і 47.",
        "packages": ["3", "4", "47"],
    },
    "Додаток 4": {
        "id": "appendix-4",
        "kind": "appendix",
        "title": "Додаток 4. Діагнози для епізоду «Профілактика»",
        "short_title": "Профілактика",
        "description": "Перелік діагнозів, які обліковуються тільки в межах епізоду «Профілактика».",
        "packages": ["Профілактика"],
    },
    "ЗМІНИ": {
        "id": "order-changes",
        "kind": "order",
        "title": "Зміни до наказу НСЗУ від 15.05.2026 № 377",
        "short_title": "Наказ про зміни",
        "description": "Проєкт змін до наказу про алгоритми і правила визначення послуг за пакетами ПМГ.",
        "packages": [],
    },
    "Порівняльна": {
        "id": "comparison-table",
        "kind": "comparison",
        "title": "Порівняльна таблиця до змін наказу № 377",
        "short_title": "Порівняльна таблиця",
        "description": "Порівняння чинної редакції та запропонованих змін до наказу № 377.",
        "packages": [],
    },
}


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def normalize_filename(path):
    return re.sub(r"\s+", "_", path.name)


def source_meta(path):
    if "Порівняльна".casefold() in path.name.casefold():
        return SOURCE_META["Порівняльна"]
    for token, meta in SOURCE_META.items():
        if token.casefold() in path.name.casefold():
            return meta
    return {
        "id": re.sub(r"[^a-z0-9]+", "-", path.stem.casefold()).strip("-"),
        "kind": "document",
        "title": path.stem,
        "short_title": path.stem,
        "description": "",
        "packages": [],
    }


def pdf_pages(path):
    reader = pypdf.PdfReader(str(path))
    pages = []
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        try:
            layout = page.extract_text(extraction_mode="layout") or ""
        except Exception:
            layout = text
        pages.append({"page": index, "text": text, "layout": layout, "clean": clean(text)})
    return pages


def detect_column_boundary(pages):
    """Знаходить межу між колонками 'Діти' та 'Дорослі'.
    Метод 1: заголовок на одному рядку.
    Метод 2: середня між першим і другим 'так' у рядках з двома 'так'.
    """
    # Метод 1: заголовок на одному рядку
    for page in pages:
        for line in page["layout"].splitlines():
            lower = line.lower()
            if "діти" in lower and "дорослі" in lower:
                pos_children = lower.index("діти")
                pos_adults = lower.index("дорослі")
                if pos_adults > pos_children:
                    return (pos_children + pos_adults) // 2

    # Метод 2: аналіз рядків де є рівно два 'так'
    pairs = []
    for page in pages:
        for line in page["layout"].splitlines():
            ms = list(re.finditer(r"так", line, re.I))
            if len(ms) == 2:
                pairs.append((ms[0].start(), ms[1].start()))
    if pairs:
        avg1 = sum(p[0] for p in pairs) / len(pairs)
        avg2 = sum(p[1] for p in pairs) / len(pairs)
        return int((avg1 + avg2) / 2)

    return None


def parse_age_from_layout(layout_line, boundary):
    """По позиції 'так' у рядку визначає колонку: ліво від межі = Діти, право = Дорослі."""
    children, adults = False, False
    pkg4_only = None
    for m in re.finditer(r"так(?:,\s*для\s*(\d+)\s*пакет[ау]?)?", layout_line, re.I):
        if boundary is None or m.start() < boundary:
            children = True
        else:
            adults = True
        if m.group(1):
            pkg4_only = m.group(1)
    return children, adults, pkg4_only


def split_status(name_with_status):
    value = clean(name_with_status)
    match = re.search(r"\s+(так(?:,\s*для\s*\d+\s*пакет[ау]?)?(?:\s+так(?:,\s*для\s*\d+\s*пакет[ау]?)?)?)\s*$", value, re.I)
    if not match:
        return value, ""
    name = clean(value[: match.start()])
    status = clean(match.group(1))
    return name, status


def parse_records(path, meta, pages):
    if meta["id"] not in {"appendix-3", "appendix-4"}:
        return []

    boundary = detect_column_boundary(pages) if meta["id"] == "appendix-3" else None

    records = []
    current = None
    current_layout_lines = []  # всі layout-рядки для поточного запису

    for page in pages:
        layout_lines = page["layout"].splitlines()
        # Будуємо індекс layout рядків по очищеному тексту для зіставлення
        layout_clean_map = {clean(ll): ll for ll in layout_lines if clean(ll)}

        for raw_line in page["text"].splitlines():
            line = clean(raw_line)
            if not line:
                continue
            match = CODE_RE.match(line)
            if match:
                code = match.group(0)
                rest = clean(line[match.end():])
                if code in {"Y36", "Y96"} and rest.casefold().startswith("та "):
                    continue
                if current:
                    # Визначаємо вікові групи по всіх layout-рядках запису
                    combined_layout = " ".join(current_layout_lines)
                    children, adults, pkg4_only = parse_age_from_layout(combined_layout, boundary)
                    current["children"] = children
                    current["adults"] = adults
                    current["pkg4_only"] = pkg4_only
                    records.append(current)
                name, _ = split_status(rest)
                current = {
                    "id": f"{meta['id']}-{code.lower().replace('.', '-')}-{len(records) + 1}",
                    "code": code,
                    "name": name,
                    "children": False,
                    "adults": False,
                    "pkg4_only": None,
                    "source_id": meta["id"],
                    "source_title": meta["short_title"],
                    "document_title": meta["title"],
                    "kind": meta["kind"],
                    "packages": meta["packages"],
                    "page": page["page"],
                    "href": f"docs/{normalize_filename(path)}#page={page['page']}",
                    "search_text": "",
                }
                current_layout_lines = [layout_clean_map.get(line, raw_line)]
                continue
            if current and not line.startswith(("СЕД АСКОД", "ДОКУМЕНТ №", "Сертифікат", "Підписувач")):
                name_only, _ = split_status(line)
                current["name"] = clean(f"{current['name']} {name_only}")
                if line in layout_clean_map:
                    current_layout_lines.append(layout_clean_map[line])
    if current:
        combined_layout = " ".join(current_layout_lines)
        children, adults, pkg4_only = parse_age_from_layout(combined_layout, boundary)
        current["children"] = children
        current["adults"] = adults
        current["pkg4_only"] = pkg4_only
        records.append(current)

    unique = []
    seen = set()
    for record in records:
        key = (record["source_id"], record["code"], record["name"])
        if key in seen or not record["name"]:
            continue
        seen.add(key)
        age_text = " ".join(filter(None, [
            "Діти" if record["children"] else "",
            "Дорослі" if record["adults"] else "",
        ]))
        record["search_text"] = clean(
            " ".join([
                record["code"],
                record["name"],
                age_text,
                record["source_title"],
                record["document_title"],
                " ".join(record["packages"]),
            ])
        ).casefold()
        unique.append(record)
    return unique


def find_comparison_pages(code, comparison_pages):
    pattern = re.compile(r"\b" + re.escape(code) + r"\b")
    return [p["page"] for p in comparison_pages if pattern.search(p["text"])]


def document_record(path, meta, pages):
    full_text = clean(" ".join(page["clean"] for page in pages))
    codes = sorted(set(INLINE_CODE_RE.findall(full_text)))
    return {
        "id": meta["id"],
        "kind": meta["kind"],
        "title": meta["title"],
        "short_title": meta["short_title"],
        "description": meta["description"],
        "file_name": normalize_filename(path),
        "href": f"docs/{normalize_filename(path)}",
        "pages": len(pages),
        "packages": meta["packages"],
        "codes_count": len(codes),
        "codes_sample": codes[:24],
        "search_text": full_text.casefold(),
    }


def main():
    if not SOURCE_DIR.exists():
        raise SystemExit(f"Не знайдено папку джерел: {SOURCE_DIR}")
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    documents = []
    records = []
    all_pages = {}
    for source_file in sorted(SOURCE_DIR.glob("*.pdf")):
        meta = source_meta(source_file)
        target = DOCS_DIR / normalize_filename(source_file)
        shutil.copy2(source_file, target)
        pages = pdf_pages(source_file)
        all_pages[meta["id"]] = pages
        documents.append(document_record(source_file, meta, pages))
        records.extend(parse_records(source_file, meta, pages))

    comparison_doc = next((d for d in documents if d["id"] == "comparison-table"), None)
    comparison_pages = all_pages.get("comparison-table", [])
    if comparison_pages:
        for record in records:
            found = find_comparison_pages(record["code"], comparison_pages)
            record["comparison_page"] = found[0] if found else None
    else:
        for record in records:
            record["comparison_page"] = None

    payload = {
        "generated": "2026-05-31",
        "title": "Алгоритми та правила за наказом № 377",
        "comparison_href": comparison_doc["href"] if comparison_doc else None,
        "documents_count": len(documents),
        "records_count": len(records),
        "documents": documents,
        "records": records,
    }
    output = DATA_DIR / "algorithms_377.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"documents": len(documents), "records": len(records), "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
