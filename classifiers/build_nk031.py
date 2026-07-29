# -*- coding: utf-8 -*-
"""
Білдер НК 031:2024 «Національна номенклатура медичних виробів» для НавігаторПМГ26.

Джерело: офіційне видання МОЗ (наказ Мінекономіки від 24.09.2024 № 23992, чинний
з 01.09.2025 — дату перенесено наказом від 24.01.2025 № 711). Класифікатор є
адаптованим перекладом EMDN (European Medical Device Nomenclature).
Файли лежать у D:\\pmg-data\\0_10_класификатори\\ (з moz.gov.ua їх віддає лише
Wayback — прямі посилання під Cloudflare дають 403):
  nk-031_2024_dodatok.pdf — таблиця номенклатури (252 с.)
  nk-031_2024_osnova.pdf  — розділи 1–4
  nakaz-23992_nk-031.pdf  — наказ

ПАСТКИ ПАРСИНГУ (перевірено 29.07.2026):
  1. У PDF немає ліній таблиці — page.find_tables() не бачить нічого, тільки координати.
  2. Комірки рядка вирівняні ПО НИЖНЬОМУ краю: цифрові колонки стоять на ОСТАННЬОМУ
     рядку тексту комірки, а перенесені рядки назв лежать ВИЩЕ за якір. Тому слово
     чіпляємо до ПЕРШОГО якоря, чия базова лінія не вища за саме слово (bisect по y2).
  3. Нумерація в джерелі рвана: 110 розривів, 278 пропущених ідентифікаторів.

Вихід у ./data/nk031:
  nk031_meta.json  — підсумки, категорії, рівні, зауваги до джерела.
  nk031_index.json — плаский індекс: [code, name, catId, level, leaf].
                     Ієрархія відновлюється на фронті обрізанням коду (13→11→9→7→5→3→1).
"""
import bisect, json, re, sys, time
from collections import Counter, defaultdict
from pathlib import Path

import fitz  # PyMuPDF

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
DATA = BASE / "data" / "nk031"
DATA.mkdir(parents=True, exist_ok=True)

SOURCES = [
    Path(r"D:\pmg-data\0_10_класификатори\nk-031_2024_dodatok.pdf"),
    Path(r"D:\rpe-pmg\nk-031_2024_dodatok.pdf"),
]
PDF = next((p for p in SOURCES if p.exists()), None)

HEADER = {"ІДЕНТИ", "ФІКАТОР", "категорії", "EMDN", "Рівень", "Найнижчий", "ТАК/НІ", "позиції"}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def col_of(x):
    """Межі колонок за x0 слова (стабільні на всіх 252 сторінках)."""
    if x < 90:  return "id"
    if x < 115: return "cat"
    if x < 190: return "code"
    if x < 230: return "level"
    if x < 285: return "leaf"
    if x < 410: return "catname"
    return "name"


def clean(s):
    s = re.sub(r"\s+", " ", s).strip()
    # Перенос усередині слова стається лише на наявному дефісі: «шприців- ручок».
    s = re.sub(r"(?<=\w)- (?!(?:чи|або|й|і|та|ані)\b)(?=\w)", "-", s)
    s = re.sub(r"\s+([,.;:])", r"\1", s)
    return s


def parse(pdf):
    doc = fitz.open(pdf)
    rows = []
    for pno in range(doc.page_count):
        words = [w for w in doc[pno].get_text("words") if w[4].strip()]
        hdr = [w[3] for w in words if w[4].strip() in HEADER]
        cut = max(hdr) + 0.5 if hdr else 0
        words = [w for w in words if w[3] > cut]

        anchors = sorted((w for w in words if col_of(w[0]) == "id" and w[4].strip().isdigit()),
                         key=lambda w: w[3])
        if not anchors:
            continue
        bottoms = [w[3] for w in anchors]
        cells = [defaultdict(list) for _ in anchors]
        for w in words:
            col = col_of(w[0])
            if col == "id":
                continue
            i = min(bisect.bisect_left(bottoms, w[3] - 0.6), len(anchors) - 1)
            cells[i][col].append((round(w[1], 1), w[0], w[4].strip()))

        for a, c in zip(anchors, cells):
            rec = {"id": int(a[4]), "page": pno + 1}
            for col, ws in c.items():
                ws.sort()
                rec[col] = clean(" ".join(t for _, _, t in ws))
            rows.append(rec)
        if pno and pno % 50 == 0:
            log(f"  сторінка {pno}, рядків поки {len(rows)}")
    rows.sort(key=lambda r: r["id"])
    return rows, doc.page_count


def main():
    if PDF is None:
        sys.exit("Не знайдено nk-031_2024_dodatok.pdf — перевірте шляхи в SOURCES.")
    log(f"PDF: {PDF}")
    rows, pages = parse(PDF)
    log(f"Розпарсено рядків: {len(rows)} з {pages} сторінок")

    # ── Розкладання й контроль якості ────────────────────────────────
    good, defects = [], []
    for r in rows:
        code = (r.get("code") or "").replace(" ", "")
        lvl = r.get("level", "")
        if not code or not lvl.isdigit():
            defects.append({"id": r["id"], "page": r["page"], "name": r.get("name", ""),
                            "issue": "у джерелі немає коду / рівня / ознаки найнижчого рівня"})
            continue
        good.append({
            "id": r["id"], "code": code, "level": int(lvl),
            "leaf": (r.get("leaf", "").upper().startswith("ТАК")),
            "cat": r.get("cat", "").strip() or code[:1],
            "catname": r.get("catname", ""), "name": r.get("name", ""),
        })

    # рівень ↔ довжина коду
    bad_len = [g["code"] for g in good if len(g["code"]) - 1 != (g["level"] - 1) * 2]
    if bad_len:
        log(f"УВАГА: рівень не збігається з довжиною коду ({len(bad_len)}): {bad_len[:10]}")

    codes = {g["code"] for g in good}
    kids = Counter()
    for g in good:
        c = g["code"]
        for k in range(len(c) - 1, 0, -1):
            if c[:k] in codes:
                kids[c[:k]] += 1
                break
    false_leaf = [g for g in good if g["leaf"] and kids[g["code"]] > 0]
    for g in false_leaf:
        defects.append({"id": g["id"], "code": g["code"], "name": g["name"],
                        "issue": f"позначено «найнижчий рівень = ТАК», хоча має підпозиції ({kids[g['code']]})"})

    dup = defaultdict(list)
    for g in good:
        dup[(g["cat"], g["name"])].append(g["code"])
    dup_names = {" / ".join(v): k[1] for k, v in dup.items() if len(v) > 1}

    ids = sorted(g["id"] for g in good) + sorted(d["id"] for d in defects if "id" in d)
    ids.sort()
    gaps = sum(b - a - 1 for a, b in zip(ids, ids[1:]) if b - a > 1)
    gap_runs = sum(1 for a, b in zip(ids, ids[1:]) if b - a > 1)

    # ── Категорії ────────────────────────────────────────────────────
    cat_order = []
    for g in good:
        if g["cat"] not in cat_order:
            cat_order.append(g["cat"])
    cid = {c: i for i, c in enumerate(cat_order)}
    cat_name, cat_cnt, cat_leaf = {}, Counter(), Counter()
    for g in good:
        cat_cnt[g["cat"]] += 1
        cat_leaf[g["cat"]] += g["leaf"]
        if g["level"] == 1:
            cat_name[g["cat"]] = g["name"]
    for c in cat_order:
        cat_name.setdefault(c, next(g["catname"] for g in good if g["cat"] == c))

    index = [[g["code"], g["name"], cid[g["cat"]], g["level"], 1 if g["leaf"] else 0] for g in good]
    with open(DATA / "nk031_index.json", "w", encoding="utf-8") as fp:
        json.dump(index, fp, ensure_ascii=False, separators=(",", ":"))

    levels = Counter(g["level"] for g in good)
    meta = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": "НК 031:2024 «Національна номенклатура медичних виробів» (адаптований переклад EMDN)",
        "approved": "наказ Мінекономіки від 24.09.2024 № 23992",
        "effective": "чинний з 01.09.2025 (дату перенесено наказом Мінекономіки від 24.01.2025 № 711)",
        "keeper": "ведення класифікатора здійснює МОЗ",
        "note_nk024": "Діє паралельно з НК 024:2023 «Класифікатор медичних виробів» (GMDN) — той не скасовано. Обидва названо в пункті 9 постанови 1808.",
        "total": len(index),
        "leaves": sum(1 for g in good if g["leaf"]),
        "nodes": sum(1 for g in good if not g["leaf"]),
        "levels": {str(k): levels[k] for k in sorted(levels)},
        "pages": pages,
        "categories": [
            {"id": cid[c], "letter": c, "name": cat_name[c],
             "count": cat_cnt[c], "leaves": cat_leaf[c]}
            for c in cat_order
        ],
        "issues": {
            "rows_without_code": [d for d in defects if "code" not in d],
            "false_leaves": [d for d in defects if "code" in d],
            "duplicate_names": len(dup_names),
            "duplicate_examples": dict(list(dup_names.items())[:8]),
            "id_gaps": gaps, "id_gap_runs": gap_runs,
            "max_id": max(ids) if ids else 0,
        },
        "schema_index": ["code", "name", "category_id", "level(1..7)", "leaf(1=найнижчий рівень)"],
    }
    with open(DATA / "nk031_meta.json", "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=1)

    log(f"Готово: {len(index)} позицій, {len(cat_order)} категорій, "
        f"{meta['leaves']} найнижчого рівня")
    log(f"Рівні: {meta['levels']}")
    log(f"Дефекти джерела: без коду {len(meta['issues']['rows_without_code'])}, "
        f"хибних «ТАК» {len(meta['issues']['false_leaves'])}, "
        f"дублікатів назв {len(dup_names)}, розривів нумерації {gap_runs} ({gaps} ід.)")


if __name__ == "__main__":
    main()
