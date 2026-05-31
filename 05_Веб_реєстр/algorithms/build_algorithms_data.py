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
        "title": "Зміни до наказу НСЗУ від 15.05.2025 № 377",
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
        pages.append({"page": index, "text": text, "clean": clean(text)})
    return pages


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

    records = []
    current = None
    for page in pages:
        for raw_line in page["text"].splitlines():
            line = clean(raw_line)
            if not line:
                continue
            match = CODE_RE.match(line)
            if match:
                code = match.group(0)
                rest = clean(line[match.end() :])
                if code in {"Y36", "Y96"} and rest.casefold().startswith("та "):
                    continue
                if current:
                    records.append(current)
                name, status = split_status(rest)
                current = {
                    "id": f"{meta['id']}-{code.lower().replace('.', '-')}-{len(records) + 1}",
                    "code": code,
                    "name": name,
                    "status": status,
                    "source_id": meta["id"],
                    "source_title": meta["short_title"],
                    "document_title": meta["title"],
                    "kind": meta["kind"],
                    "packages": meta["packages"],
                    "page": page["page"],
                    "href": f"docs/{normalize_filename(path)}#page={page['page']}",
                    "search_text": "",
                }
                continue
            if current and not line.startswith(("СЕД АСКОД", "ДОКУМЕНТ №", "Сертифікат", "Підписувач")):
                current["name"] = clean(f"{current['name']} {line}")
                current["name"], current["status"] = split_status(f"{current['name']} {current['status']}")
    if current:
        records.append(current)

    unique = []
    seen = set()
    for record in records:
        key = (record["source_id"], record["code"], record["name"])
        if key in seen or not record["name"]:
            continue
        seen.add(key)
        record["search_text"] = clean(
            " ".join([
                record["code"],
                record["name"],
                record["status"],
                record["source_title"],
                record["document_title"],
                " ".join(record["packages"]),
            ])
        ).casefold()
        unique.append(record)
    return unique


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
    for source_file in sorted(SOURCE_DIR.glob("*.pdf")):
        meta = source_meta(source_file)
        target = DOCS_DIR / normalize_filename(source_file)
        shutil.copy2(source_file, target)
        pages = pdf_pages(source_file)
        documents.append(document_record(source_file, meta, pages))
        records.extend(parse_records(source_file, meta, pages))

    payload = {
        "generated": "2026-05-31",
        "title": "Алгоритми та правила за наказом № 377",
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
