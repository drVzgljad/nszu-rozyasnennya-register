import os
import json
import re
import pandas as pd
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parents[2]
EXCEL_PATH = BASE_DIR / "08_zoz_dogovr" / "укладені договори промедобслуговування.xlsx"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"
OUTPUT_JSON = OUTPUT_DIR / "contracts.json"

def clean_date(val):
    if pd.isna(val) or val is None:
        return ""
    if isinstance(val, pd.Timestamp):
        return val.strftime("%d.%m.%Y")
    
    # Try parsing string format
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
    # Usually read as float or int, convert to string
    try:
        val_int = int(float(val))
        return f"{val_int:08d}"
    except (ValueError, TypeError):
        s = str(val).strip()
        # strip float decimals if any
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

    # Read the first sheet
    df = pd.read_excel(EXCEL_PATH, sheet_name=0)
    print(f"Read {len(df)} rows and {len(df.columns)} columns.")

    contracts = []
    
    for idx, row in df.iterrows():
        # Get raw values
        oblast = clean_str(row.get("Область реєстрації"))
        edrpou = clean_edrpou(row.get("Код ЄДРПОУ (внутрішній)"))
        provider_name = clean_str(row.get("Назва надавача"))
        
        if not edrpou and not provider_name:
            continue

        provider_name_full = clean_str(row.get("Повна назва надавача"))
        contract_num = clean_str(row.get("Номер договору"))
        contract_slug = clean_str(row.get("Номер договору/додаткової угоди"))
        sign_date = clean_date(row.get("Дата підписання договору/додаткової угоди"))
        start_date = clean_date(row.get("Початок дії договору"))
        end_date = clean_date(row.get("Кінець дії договору"))
        package_num = clean_package_num(row.get("Номер пакету послуг"))
        package_name = clean_str(row.get("Назва пакету послуг"))
        ownership = clean_str(row.get("Форма власності"))
        settlement_type = clean_str(row.get("Тип населеного пункту"))
        settlement = clean_str(row.get("Населений пункт"))
        community = clean_str(row.get("Громада надавача"))
        direction = clean_str(row.get("Напрям допомоги"))
        network_type = clean_str(row.get("Тип закладу спроможної мережі"))
        locations = clean_str(row.get("Перелік МНП за договором"))
        email = clean_str(row.get("email"))
        reg_address = clean_str(row.get("Адреса реєстрації"))
        help_type = clean_str(row.get("Вид допомоги"))
        financing_program = clean_str(row.get("Програма фінансування"))
        doc_type = clean_str(row.get("Тип документа"))
        year = clean_str(row.get("Рік дії ПМГ"))
        leader_title = clean_str(row.get("Посада керівника"))
        leader_name = clean_str(row.get("ПІБ керівника"))
        has_extra_coef_contract = clean_str(row.get("Наявність додаткових коефіцієнтів в договорі"))
        has_extra_coef_package = clean_str(row.get("Наявність додаткового коефіцієнту для пакету послуг"))
        extra_info = clean_str(row.get("Додаткова інформація по пакетам послуг"))
        contract_sum = clean_float(row.get("Сума договорів"))

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
            "package_num": package_num,
            "package_name": package_name,
            "ownership": ownership,
            "settlement_type": settlement_type,
            "settlement": settlement,
            "community": community,
            "direction": direction,
            "network_type": network_type,
            "locations": locations,
            "email": email,
            "reg_address": reg_address,
            "help_type": help_type,
            "financing_program": financing_program,
            "doc_type": doc_type,
            "year": year,
            "leader_title": leader_title,
            "leader_name": leader_name,
            "has_extra_coef_contract": has_extra_coef_contract,
            "has_extra_coef_package": has_extra_coef_package,
            "extra_info": extra_info,
            "sum": contract_sum
        })

    # Prepare final output structure
    output_payload = {
        "count": len(contracts),
        "total_sum": round(sum(c["sum"] for c in contracts), 2),
        "unique_providers": len(set(c["edrpou"] for c in contracts)),
        "unique_packages": sorted(list(set(c["package_num"] for c in contracts if c["package_num"])), key=lambda x: int(x) if x.isdigit() else 999),
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
