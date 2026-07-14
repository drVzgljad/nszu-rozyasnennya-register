import json
import sys
from pathlib import Path

DEPS = Path(__file__).resolve().parent / "_python_deps"
sys.path.insert(0, str(DEPS))

import fitz


BASE = Path(__file__).resolve().parents[1]
ORIGINALS = BASE / "00_Оригінали"
OCR_PAGES = BASE / "01_Текст_та_OCR" / "_ocr_pages"
ANALYSIS_PATH = BASE / "04_Реєстр" / "аналіз_текстового_шару.json"


def main(limit=None):
    analysis = json.loads(ANALYSIS_PATH.read_text(encoding="utf-8"))
    scans = [item for item in analysis["files"] if item["text_quality"] == "needs_ocr"]
    if limit:
        scans = scans[:limit]
    rendered = 0
    for item in scans:
        source = ORIGINALS / item["original_file_name"]
        folder = OCR_PAGES / source.stem
        folder.mkdir(parents=True, exist_ok=True)
        document = fitz.open(source)
        for index, page in enumerate(document):
            target = folder / f"page-{index + 1:03d}.png"
            if not target.exists():
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2.3, 2.3), alpha=False)
                pixmap.save(target)
            rendered += 1
    print(json.dumps({"scan_files": len(scans), "rendered_pages": rendered}, ensure_ascii=False))


if __name__ == "__main__":
    requested_limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    main(requested_limit)
