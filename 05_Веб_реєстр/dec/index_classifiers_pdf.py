import os
import re
import json
import pypdf
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

PDF_ICD_PATH = BASE_DIR / ".." / ".." / "0_10_класификатори" / "naczionalnyj-klasyfikator-nk-025 (1).pdf"
PDF_ACHI_PATH = BASE_DIR / ".." / ".." / "0_10_класификатори" / "nk-026_2021_ (1).pdf"

JSON_ICD_PATH = DATA_DIR / "icd10_codes.json"
JSON_ACHI_PATH = DATA_DIR / "achi_codes.json"

def load_existing_json(path):
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load {path}: {e}")
    return {}

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def index_icd():
    print(f"Parsing ICD PDF from {PDF_ICD_PATH}...")
    if not PDF_ICD_PATH.exists():
        print(f"Error: ICD PDF not found at {PDF_ICD_PATH}")
        return
        
    codes = load_existing_json(JSON_ICD_PATH)
    original_len = len(codes)
    print(f"Loaded {original_len} existing ICD codes from JSON.")
    
    reader = pypdf.PdfReader(PDF_ICD_PATH)
    total_pages = len(reader.pages)
    
    current_code = None
    added_count = 0
    updated_count = 0
    
    # We skip title pages, let's parse all pages
    for page_num in range(total_pages):
        # Print progress occasionally
        if page_num > 0 and page_num % 300 == 0:
            print(f"  Processed {page_num}/{total_pages} pages...")
            
        page = reader.pages[page_num]
        text = page.extract_text()
        if not text:
            continue
            
        lines = text.split("\n")
        for line in lines:
            line = line.strip()
            if not line or line.isdigit():
                continue
                
            # Match ICD-10 pattern
            m = re.match(r"^([A-Z][0-9]{2}(?:\.[0-9]{1,2})?)\s+(.*)", line)
            if m:
                code, desc = m.group(1), m.group(2).strip()
                # Remove double spaces
                desc = re.sub(r"\s+", " ", desc)
                
                if code not in codes:
                    codes[code] = desc
                    added_count += 1
                else:
                    # Update description if it's different/longer
                    if len(desc) > len(codes[code]):
                        codes[code] = desc
                        updated_count += 1
                current_code = code
            else:
                # Continuation check
                if current_code and line and not line[0].isupper() and line[0] not in ("*", "-", "•"):
                    cleaned_line = re.sub(r"\s+", " ", line.strip())
                    codes[current_code] = (codes[current_code] + " " + cleaned_line).strip()
                    codes[current_code] = re.sub(r"\s+", " ", codes[current_code])
                else:
                    current_code = None
                    
    save_json(JSON_ICD_PATH, codes)
    print(f"ICD PDF indexing complete. Added: {added_count}, Updated: {updated_count}, Total now: {len(codes)}")

def index_achi():
    print(f"Parsing ACHI PDF from {PDF_ACHI_PATH}...")
    if not PDF_ACHI_PATH.exists():
        print(f"Error: ACHI PDF not found at {PDF_ACHI_PATH}")
        return
        
    codes = load_existing_json(JSON_ACHI_PATH)
    original_len = len(codes)
    print(f"Loaded {original_len} existing ACHI codes from JSON.")
    
    reader = pypdf.PdfReader(PDF_ACHI_PATH)
    total_pages = len(reader.pages)
    
    current_code = None
    added_count = 0
    updated_count = 0
    
    for page_num in range(total_pages):
        if page_num > 0 and page_num % 100 == 0:
            print(f"  Processed {page_num}/{total_pages} pages...")
            
        page = reader.pages[page_num]
        text = page.extract_text()
        if not text:
            continue
            
        lines = text.split("\n")
        for line in lines:
            line = line.strip()
            if not line or line.isdigit():
                continue
                
            # Match ACHI pattern (5 digits, hyphen, 2 digits)
            m = re.match(r"^([0-9]{5}-[0-9]{2})\s+(.*)", line)
            if m:
                code, desc = m.group(1), m.group(2).strip()
                desc = re.sub(r"\s+", " ", desc)
                
                if code not in codes:
                    codes[code] = desc
                    added_count += 1
                else:
                    if len(desc) > len(codes[code]):
                        codes[code] = desc
                        updated_count += 1
                current_code = code
            else:
                if current_code and line and not line[0].isupper() and line[0] not in ("*", "-", "•"):
                    cleaned_line = re.sub(r"\s+", " ", line.strip())
                    codes[current_code] = (codes[current_code] + " " + cleaned_line).strip()
                    codes[current_code] = re.sub(r"\s+", " ", codes[current_code])
                else:
                    current_code = None
                    
    save_json(JSON_ACHI_PATH, codes)
    print(f"ACHI PDF indexing complete. Added: {added_count}, Updated: {updated_count}, Total now: {len(codes)}")

if __name__ == "__main__":
    index_icd()
    index_achi()
