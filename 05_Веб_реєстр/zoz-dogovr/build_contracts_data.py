import os
import json
import re
import pandas as pd
from pathlib import Path
from collections import defaultdict

# Paths
BASE_DIR = Path(__file__).resolve().parents[2]
EXCEL_PATH = BASE_DIR / "08_zoz_dogovr" / "укладені договори всі 2026.xlsx"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"
OUTPUT_JSON = OUTPUT_DIR / "contracts.json"

def clean_date(val):
    if pd.isna(val) or val is None:
        return ""
    if isinstance(val, pd.Timestamp):
        return val.strftime("%d.%m.%Y")
    
    s = str(val).strip()
    match = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", s)
    if match:
        yr, mo, dy = match.groups()
        return f"{int(dy):02d}.{int(mo):02d}.{yr}"
    
    match2 = re.search(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", s)
    if match2:
        dy, mo, yr = match2.groups()
        return f"{int(dy):02d}.{int(mo):02d}.{yr}"
    
    return s.split(" ")[0]

def clean_edrpou(val):
    if pd.isna(val) or val is None:
        return ""
    try:
        val_int = int(float(val))
        return f"{val_int:08d}"
    except (ValueError, TypeError):
        s = str(val).strip()
        if s.endswith(".0"):
            s = s[:-2]
        return s.zfill(8)

def clean_package_num(val):
    if pd.isna(val) or val is None:
        return ""
    try:
        return str(int(float(val)))
    except (ValueError, TypeError):
        return str(val).strip()

def clean_float(val):
    if pd.isna(val) or val is None:
        return 0.0
    try:
        return round(float(val), 2)
    except (ValueError, TypeError):
        return 0.0

def clean_str(val):
    if pd.isna(val) or val is None:
        return ""
    return str(val).strip()

def main():
    print(f"Reading Excel: {EXCEL_PATH}")
    if not EXCEL_PATH.exists():
        print(f"Error: {EXCEL_PATH} does not exist.")
        return

    # Read the sheet
    df = pd.read_excel(EXCEL_PATH, sheet_name=0)
    print(f"Read {len(df)} rows.")

    # Dictionary for static package metadata mapping
    package_metadata = {}

    # Group rows by (Код ЄДРПОУ, Номер договору/додаткової угоди)
    grouped_rows = defaultdict(list)
    for idx, row in df.iterrows():
        edrpou = clean_edrpou(row.get("Код ЄДРПОУ (внутрішній)"))
        provider_name = clean_str(row.get("Назва надавача"))
        if not edrpou and not provider_name:
            continue
        
        slug = clean_str(row.get("Номер договору/додаткової угоди"))
        if not slug:
            slug = clean_str(row.get("Номер договору"))
        
        key = (edrpou, slug)
        grouped_rows[key].append(row)

        # Track package metadata statically
        pkg_num = clean_package_num(row.get("Номер пакету послуг"))
        if pkg_num and pkg_num not in package_metadata:
            package_metadata[pkg_num] = {
                "package_name": clean_str(row.get("Назва пакету послуг")),
                "direction": clean_str(row.get("Напрям допомоги")),
                "help_type": clean_str(row.get("Вид допомоги")),
                "financing_program": clean_str(row.get("Програма фінансування"))
            }

    print(f"Grouped into {len(grouped_rows)} unique contracts.")

    contracts = []
    
    for (edrpou, slug), rows in grouped_rows.items():
        primary = rows[0]
        
        oblast = clean_str(primary.get("Область реєстрації"))
        provider_name = clean_str(primary.get("Назва надавача"))
        provider_name_full = clean_str(primary.get("Повна назва надавача"))
        contract_num = clean_str(primary.get("Номер договору"))
        contract_slug = slug
        sign_date = clean_date(primary.get("Дата підписання договору/додаткової угоди"))
        start_date = clean_date(primary.get("Початок дії договору"))
        end_date = clean_date(primary.get("Кінець дії договору"))
        ownership = clean_str(primary.get("Форма власності"))
        settlement_type = clean_str(primary.get("Тип населеного пункту"))
        settlement = clean_str(primary.get("Населений пункт"))
        if not settlement:
            settlement = clean_str(primary.get("Громада надавача"))
        community = clean_str(primary.get("Громада надавача"))
        network_type = clean_str(primary.get("Тип закладу спроможної мережі"))
        locations = clean_str(primary.get("Перелік МНП за договором"))
        email = clean_str(primary.get("email"))
        reg_address = clean_str(primary.get("Адреса реєстрації"))
        doc_type = clean_str(primary.get("Тип документа"))
        year = clean_str(primary.get("Рік дії ПМГ"))
        leader_title = clean_str(primary.get("Посада керівника"))
        leader_name = clean_str(primary.get("ПІБ керівника"))
        has_extra_coef_contract = clean_str(primary.get("Наявність додаткових коефіцієнтів в договорі"))

        # Extra info (optional)
        extra_info = clean_str(primary.get("Додаткова інформація по пакетам послуг"))

        # Compile packages
        packages = []
        for row in rows:
            pkg_num = clean_package_num(row.get("Номер пакету послуг"))
            has_extra_coef_package = clean_str(row.get("Наявність додаткового коефіцієнту для пакету послуг"))
            pkg_sum = clean_float(row.get("Сума договорів"))

            packages.append({
                "package_num": pkg_num,
                "has_extra_coef_package": has_extra_coef_package,
                "sum": pkg_sum
            })

        # Contract sum is the sum of all packages under it
        total_sum = round(sum(p["sum"] for p in packages), 2)

        contracts.append({
            "id": len(contracts) + 1,
            "oblast": oblast,
            "edrpou": edrpou,
            "provider_name": provider_name,
            "provider_name_full": provider_name_full,
            "contract_num": contract_num,
            "contract_slug": contract_slug,
            "sign_date": sign_date,
            "start_date": start_date,
            "end_date": end_date,
            "ownership": ownership,
            "settlement_type": settlement_type,
            "settlement": settlement,
            "community": community,
            "network_type": network_type,
            "locations": locations,
            "email": email,
            "reg_address": reg_address,
            "doc_type": doc_type,
            "year": year,
            "leader_title": leader_title,
            "leader_name": leader_name,
            "has_extra_coef_contract": has_extra_coef_contract,
            "extra_info": extra_info,
            "sum": total_sum,
            "packages": packages
        })

    output_payload = {
        "count": len(contracts),
        "total_sum": round(sum(c["sum"] for c in contracts), 2),
        "unique_providers": len(set(c["edrpou"] for c in contracts)),
        "unique_packages": sorted(list(package_metadata.keys()), key=lambda x: int(x) if x.isdigit() else 999),
        "package_metadata": package_metadata,
        "contracts": contracts
    }

    # Write output
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)
    print(f"Successfully generated {OUTPUT_JSON} with {len(contracts)} contracts.")

    # Mirror to GitHub version if exists
    github_output_path = BASE_DIR / "06_GitHub_версія" / "05_Веб_реєстр" / "data" / "contracts.json"
    if github_output_path.parent.parent.exists():
        github_output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(github_output_path, "w", encoding="utf-8") as f:
            json.dump(output_payload, f, ensure_ascii=False, indent=2)
        print(f"Mirrored data to {github_output_path}")

if __name__ == "__main__":
    main()
