import csv
import json
import shutil
from collections import Counter
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
ORIGINALS = BASE / "00_Оригінали"
RENAMED = BASE / "02_Перейменовані"
BY_DIRECTION = BASE / "03_За_напрямами"
PROPOSALS_PATH = BASE / "04_Реєстр" / "пропоновані_назви.json"
OCR_RESULTS_PATH = BASE / "04_Реєстр" / "ocr_results.json"
FINAL_CSV = BASE / "04_Реєстр" / "фінальний_реєстр_розяснень.csv"
FINAL_JSON = BASE / "04_Реєстр" / "фінальний_реєстр_розяснень.json"


def main():
    proposals = json.loads(PROPOSALS_PATH.read_text(encoding="utf-8"))["proposals"]
    ocr_files = set()
    if OCR_RESULTS_PATH.exists():
        ocr_files = {
            row["original_file_name"]
            for row in json.loads(OCR_RESULTS_PATH.read_text(encoding="utf-8-sig"))
        }
    rows = []
    copied = set()
    counts = Counter()
    for proposal in proposals:
        source = ORIGINALS / proposal["original_file_name"]
        if not source.exists():
            raise FileNotFoundError(source)
        is_duplicate = bool(proposal["duplicate_of"])
        if not is_duplicate:
            renamed_target = RENAMED / proposal["proposed_name"]
            direction_dir = BY_DIRECTION / proposal["direction"]
            direction_dir.mkdir(parents=True, exist_ok=True)
            direction_target = direction_dir / proposal["proposed_name"]
            shutil.copy2(source, renamed_target)
            shutil.copy2(source, direction_target)
            copied.add(proposal["original_file_name"])
            counts[proposal["direction"]] += 1
        rows.append(
            {
                **proposal,
                "download_status": "завантажено",
                "ocr_status": "OCR виконано (кирилиця ru, перевірити українські літери)" if proposal["original_file_name"] in ocr_files else "машинний текст доступний",
                "renamed_relative_path": f"02_Перейменовані/{proposal['proposed_name']}",
                "direction_relative_path": f"03_За_напрямами/{proposal['direction']}/{proposal['proposed_name']}",
            }
        )
    FINAL_JSON.write_text(
        json.dumps(
            {"records": len(rows), "unique_files": len(copied), "direction_counts": dict(counts), "documents": rows},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    with FINAL_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()), delimiter=";")
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps({"records": len(rows), "unique_copied": len(copied), "direction_counts": dict(counts)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
