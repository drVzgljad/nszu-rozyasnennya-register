import json
import os
from pathlib import Path
import openpyxl

# Set paths
BASE = Path(__file__).resolve().parent
XLSX_PATH = BASE.parent / "09_decMOZ" / "документи_ДЕЦМОЗ.xlsx"
OUTPUT_JSON = BASE / "data" / "dec_documents.json"

def main():
    if not XLSX_PATH.exists():
        print(f"Error: Excel file not found at {XLSX_PATH}")
        return

    print(f"Loading workbook from {XLSX_PATH}...")
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
    sheet = wb.active

    documents = []
    categories = set()
    types = set()
    statuses = set()
    years = set()

    # Read rows
    row_idx = 0
    for row in sheet.iter_rows(values_only=True):
        if row_idx == 0:
            # Header row
            row_idx += 1
            continue

        category = row[0]
        title = row[1]
        status = row[2]
        doc_type = row[3]
        reg_number = row[4]
        published_date = row[5]
        # In some rows, published_date might be a datetime object or a string or None
        published_str = ""
        pub_year = ""
        if published_date:
            if hasattr(published_date, 'strftime'):
                published_str = published_date.strftime('%d.%m.%Y')
                pub_year = published_date.strftime('%Y')
            else:
                published_str = str(published_date).strip()
                # Try to extract year from string (e.g. DD.MM.YYYY or YYYY)
                if '.' in published_str:
                    parts = published_str.split('.')
                    if len(parts) == 3 and len(parts[2]) == 4:
                        pub_year = parts[2]
                elif '-' in published_str:
                    parts = published_str.split('-')
                    if len(parts) >= 1 and len(parts[0]) == 4:
                        pub_year = parts[0]
                elif len(published_str) == 4 and published_str.isdigit():
                    pub_year = published_str

        doc_url = row[8] if len(row) > 8 else None
        category_url = row[9] if len(row) > 9 else None

        if not title:
            # Skip empty rows
            continue

        # Clean strings
        category = category.strip() if category else "Без категорії"
        title = title.strip()
        status = status.strip() if status else "Невідомий"
        doc_type = doc_type.strip() if doc_type else "Невідомий"
        reg_number = reg_number.strip() if reg_number else ""
        doc_url = doc_url.strip() if doc_url else ""
        category_url = category_url.strip() if category_url else ""

        # Normalize status and type for filters
        categories.add(category)
        types.add(doc_type)
        statuses.add(status)
        if pub_year:
            years.add(pub_year)

        documents.append({
            "id": row_idx,
            "category": category,
            "title": title,
            "status": status,
            "type": doc_type,
            "number": reg_number,
            "published": published_str,
            "year": pub_year,
            "document_url": doc_url,
            "category_url": category_url,
            "search_text": f"{title} {category} {status} {doc_type} {reg_number} {published_str}".lower()
        })
        row_idx += 1

    # Prepare summary data
    payload = {
        "generated": "2026-06-09",
        "total_documents": len(documents),
        "categories": sorted(list(categories)),
        "types": sorted(list(types)),
        "statuses": sorted(list(statuses)),
        "years": sorted(list(years), reverse=True),
        "documents": documents
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"Successfully processed {len(documents)} documents.")
    print(f"Data saved to {OUTPUT_JSON}")

if __name__ == "__main__":
    main()
