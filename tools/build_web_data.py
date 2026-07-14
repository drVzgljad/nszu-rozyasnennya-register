import json
import re
from collections import Counter, defaultdict
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
REGISTRY = BASE / "04_Реєстр" / "фінальний_реєстр_розяснень.json"
TEXT_DIR = BASE / "01_Текст_та_OCR"
OUTPUT = Path(__file__).resolve().parent / "data" / "documents.json"


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def read_text(file_name, uses_ocr):
    stem = Path(file_name).stem
    path = TEXT_DIR / (f"{stem}.ocr.txt" if uses_ocr else f"{stem}.txt")
    if not path.exists():
        return ""
    return clean(path.read_text(encoding="utf-8-sig", errors="ignore"))


def normalized_date(value):
    match = re.search(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", value or "")
    if not match:
        return "", ""
    day, month, year = match.groups()
    display = f"{int(day):02d}.{int(month):02d}.{year}"
    return f"{year}-{int(month):02d}-{int(day):02d}", display


def extract_document_identity(title, text):
    number_token = r"([0-9][0-9A-Za-zА-Яа-яІіЇїЄєҐґ/._-]{2,})"
    date_token = r"(\d{1,2}[./]\d{1,2}[./]\d{4})"
    sources = [
        ("text_header", text[:2500]),
        ("title", title),
    ]
    patterns = [
        rf"(?:ДОКУМЕНТ\s*)?№\s*{number_token}\s*(?:від|вiд|вид)\s*{date_token}",
        rf"(?:від|вiд|вид)\s*{date_token}\s*(?:р\.?\s*)?№\s*{number_token}",
        rf"\b{number_token}\s*(?:від|вiд|вид)\s*{date_token}",
    ]
    for source, content in sources:
        for index, pattern in enumerate(patterns):
            match = re.search(pattern, content, flags=re.IGNORECASE)
            if not match:
                continue
            if index == 1:
                raw_date, number = match.groups()
            else:
                number, raw_date = match.groups()
            date_value, date_display = normalized_date(raw_date)
            return number.rstrip(".,;"), date_value, date_display, source
    return "", "", "", "not_found"


def unique_documents(rows):
    by_file = defaultdict(list)
    for row in rows:
        by_file[row["original_file_name"]].append(row)
    documents = []
    for related_rows in by_file.values():
        primary = next((row for row in related_rows if not row["duplicate_of"]), related_rows[0])
        ocr = primary["ocr_status"].startswith("OCR")
        text = read_text(primary["original_file_name"], ocr)
        document_number, document_date, document_date_display, document_meta_source = extract_document_identity(
            primary["site_title"], text
        )
        documents.append(
            {
                "id": primary["id"],
                "record_ids": [row["id"] for row in related_rows],
                "titles": [row["site_title"] for row in related_rows],
                "title": primary["site_title"],
                "name": primary["proposed_name"],
                "original_name": primary["original_file_name"],
                "format": primary["extension"].upper(),
                "direction": primary["direction"],
                "package": primary["package"],
                "topic": primary["content_short"].replace("-", " ").replace("_", " "),
                "year": primary["year"],
                "year_basis": primary["year_basis"],
                "ocr": ocr,
                "ocr_status": primary["ocr_status"],
                "document_number": document_number,
                "document_date": document_date,
                "document_date_display": document_date_display,
                "document_meta_source": document_meta_source,
                "local_path": "../" + primary["direction_relative_path"].replace("\\", "/"),
                "source_url": primary["url"],
                "excerpt": text[:900],
                "search_text": clean(
                    " ".join(
                        [
                            primary["site_title"],
                            primary["proposed_name"],
                            primary["direction"],
                            primary["package"],
                            primary["content_short"],
                            document_number,
                            document_date_display,
                            text[:12000],
                        ]
                    )
                ).lower(),
            }
        )
    return sorted(documents, key=lambda item: (-int(item["year"]), item["direction"], item["title"]))


def reason_and_score(left, right):
    score = 0
    reasons = []
    if left["package"] != "Без-пакета" and left["package"] == right["package"]:
        score += 60
        reasons.append("той самий пакет")
    if left["direction"] == right["direction"]:
        score += 30
        reasons.append("той самий напрям")
    if left["year"] == right["year"]:
        score += 6
    if abs(left["id"] - right["id"]) <= 3:
        score += 18
        reasons.append("поруч у публікації")
    left_addition = "додат" in left["title"].lower()
    right_addition = "додат" in right["title"].lower()
    if left_addition != right_addition and left["direction"] == right["direction"]:
        score += 12
        reasons.append("роз'яснення та додаток")
    return score, reasons


def attach_relationships(documents):
    for document in documents:
        scored = []
        for other in documents:
            if other["id"] == document["id"]:
                continue
            score, reasons = reason_and_score(document, other)
            if score >= 30:
                scored.append({"id": other["id"], "score": score, "reason": ", ".join(dict.fromkeys(reasons))})
        document["related"] = sorted(scored, key=lambda item: (-item["score"], item["id"]))[:8]


def main():
    source = json.loads(REGISTRY.read_text(encoding="utf-8"))
    documents = unique_documents(source["documents"])
    attach_relationships(documents)
    directions = Counter(item["direction"] for item in documents)
    years = Counter(item["year"] for item in documents)
    formats = Counter(item["format"] for item in documents)
    document_dates = Counter(item["document_date"] for item in documents if item["document_date"])
    document_numbers = Counter(item["document_number"] for item in documents if item["document_number"])
    payload = {
        "generated": "2026-05-26",
        "site_records": source["records"],
        "unique_files": len(documents),
        "ocr_files": sum(1 for item in documents if item["ocr"]),
        "documents_with_identity": sum(1 for item in documents if item["document_number"] or item["document_date"]),
        "directions": dict(sorted(directions.items())),
        "years": dict(sorted(years.items(), reverse=True)),
        "formats": dict(sorted(formats.items())),
        "document_dates": dict(sorted(document_dates.items(), reverse=True)),
        "document_numbers": dict(sorted(document_numbers.items())),
        "documents": documents,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: payload[key] for key in ("site_records", "unique_files", "documents_with_identity", "formats")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
