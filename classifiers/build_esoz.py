# -*- coding: utf-8 -*-
"""Довідник кодів ЕСОЗ — збірка з наявних джерел порталу.

⚠️ Це РЕКОНСТРУКЦІЯ, а не копія офіційного класифікатора. Офіційного видання
довідника ЕСОЗ у нас немає, тому коди й назви зібрані з вторинних джерел:
таблиці співставлення, додатків до роз'яснень НСЗУ та побічних продуктів
інших білдерів порталу. Покриття неповне — це рівно ті коди, що трапилися
в опрацьованих документах.

Джерела:
  classifiers/data/esoz_names.json        502  побічний продукт build_nk026.py
  mapping/data/names/esoz_all.json        479  білдер таблиці співставлення
  rozjasnennya/build/esoz_names.json      478  вишкребено з таблиць додатків
  rozjasnennya/data/codes_index.json      479  titles.esoz (з категорією) + index.esoz
  rozjasnennya/build/positions.json        97  посади ЕСОЗ (P-коди)
  mapping/data/services.json              639  послуги таблиці співставлення

Пастка, закладена в нормалізацію: у документах коди набрані змішано —
кирилична «А» і латинська «A» виглядають однаково. Нормалізуємо і при
збірці, і в пошуку на сторінці (esoz.js робить те саме).

Вихід: classifiers/data/esoz/{esoz_meta,esoz_index,esoz_cards}.json
"""
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "classifiers" / "data" / "esoz"

SRC = {
    "nk026": WEB / "classifiers" / "data" / "esoz_names.json",
    "mapping": WEB / "mapping" / "data" / "names" / "esoz_all.json",
    "rozjasnennya": WEB / "rozjasnennya" / "build" / "esoz_names.json",
}
CODES_INDEX = WEB / "rozjasnennya" / "data" / "codes_index.json"
POSITIONS = WEB / "rozjasnennya" / "build" / "positions.json"
SERVICES = WEB / "mapping" / "data" / "services.json"
ROZ_INDEX = WEB / "rozjasnennya" / "data" / "index.json"

SRC_LABEL = {
    "nk026": "довідник НК 026",
    "mapping": "таблиця співставлення",
    "rozjasnennya": "додатки до роз'яснень",
    "titles": "покажчик кодів роз'яснень",
}

# Кириличні двійники латинських літер, що трапляються в кодах.
HOMOGLYPH = str.maketrans({
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I",
    "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X",
    "У": "Y", "Ѕ": "S",
})
SERVICE_RE = re.compile(r"^[A-Z]\d{5}$")
POSITION_RE = re.compile(r"^P\d{1,3}$")

# Категорія дописана в кінці назви у titles.esoz: «Аналіз; гістопатологія laboratory_procedure»
CATEGORY_RE = re.compile(r"\s+([a-z][a-z_]{4,})$")
CATEGORY_UA = {
    "laboratory_procedure": "лабораторна процедура",
    "procedure": "процедура",
    "observation": "спостереження",
    "imaging_procedure": "візуалізаційна процедура",
    "service": "послуга",
}


def log(msg):
    print(msg, flush=True)


def read_json(path, default=None):
    if not path.exists():
        log(f"  ! немає: {path.name}")
        return default if default is not None else {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        log(f"  ! не читається {path.name}: {exc}")
        return default if default is not None else {}


def norm_code(raw):
    """Кирилиця → латиниця, верхній регістр, без пробілів."""
    return (raw or "").strip().upper().translate(HOMOGLYPH).replace(" ", "")


def split_category(name):
    """Відділити технічну категорію від назви."""
    m = CATEGORY_RE.search(name or "")
    if not m:
        return (name or "").strip(), ""
    return name[: m.start()].strip(), m.group(1)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    log("Джерела назв:")

    # code -> {name -> set(sources)}
    names = defaultdict(lambda: defaultdict(set))
    categories = {}

    for key, path in SRC.items():
        data = read_json(path)
        for raw_code, raw_name in (data or {}).items():
            code = norm_code(raw_code)
            if not code:
                continue
            nm, _ = split_category(str(raw_name))
            if nm:
                names[code][nm].add(key)
        log(f"  {SRC_LABEL[key]:<28} {len(data or {})}")

    codes_index = read_json(CODES_INDEX)
    titles = (codes_index.get("titles") or {}).get("esoz") or {}
    for raw_code, raw_name in titles.items():
        code = norm_code(raw_code)
        nm, cat = split_category(str(raw_name))
        if nm:
            names[code][nm].add("titles")
        if cat:
            categories[code] = cat
    log(f"  {SRC_LABEL['titles']:<28} {len(titles)}")

    # Згадки в роз'ясненнях: code -> [{d: doc_id, n: скільки разів}]
    mentions = {}
    for raw_code, refs in ((codes_index.get("index") or {}).get("esoz") or {}).items():
        mentions[norm_code(raw_code)] = refs

    # Назви документів роз'яснень
    doc_titles = {}
    roz = read_json(ROZ_INDEX)
    docs = roz.get("documents")
    if isinstance(docs, list):
        for d in docs:
            if isinstance(d, dict) and "id" in d:
                doc_titles[str(d["id"])] = d.get("title") or ""
    log(f"  назв документів роз'яснень   {len(doc_titles)}")

    # Послуги таблиці співставлення: code -> [{назва послуги, пакети}]
    services = read_json(SERVICES, [])
    svc_by_code = defaultdict(list)
    notes_by_code = {}
    for row in services if isinstance(services, list) else []:
        block = row.get("achi") or {}
        raw = block.get("raw") or ""
        note = row.get("note") or ""
        for raw_code in block.get("esoz") or []:
            code = norm_code(raw_code)
            svc_by_code[code].append({
                "s": row.get("name") or "",
                "p": row.get("pkgs") or [],
            })
            if note and code in note.replace("*", ""):
                notes_by_code[code] = note
            elif note and (code + "*") in raw:
                notes_by_code[code] = note
    log(f"  послуг таблиці співставлення {len(services) if isinstance(services, list) else 0}")

    positions = read_json(POSITIONS)

    # ── Збірка карток ────────────────────────────────────────
    index, cards = [], {}

    def add(code, kind):
        variants = names.get(code) or {}
        if not variants and kind != "position":
            return
        ordered = sorted(variants.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        primary = ordered[0][0] if ordered else ""
        cat = categories.get(code, "")
        svc = svc_by_code.get(code) or []
        pkgs = sorted({str(p) for s in svc for p in (s["p"] or [])}, key=lambda x: int(x) if x.isdigit() else 999)
        refs = mentions.get(code) or []
        index.append({
            "c": code,
            "n": primary,
            "k": kind,
            "t": CATEGORY_UA.get(cat, cat),
            "p": pkgs,
            "r": len(refs),
            "v": len(ordered),
        })
        cards[code] = {
            "c": code,
            "k": kind,
            "t": CATEGORY_UA.get(cat, cat),
            "raw_t": cat,
            "names": [{"n": nm, "src": sorted(SRC_LABEL.get(s, s) for s in srcs)} for nm, srcs in ordered],
            "services": svc,
            "packages": pkgs,
            "note": notes_by_code.get(code, ""),
            "mentions": [
                {"d": r.get("d"), "n": r.get("n"), "t": doc_titles.get(str(r.get("d")), "")}
                for r in refs
            ],
        }

    for code in sorted(names):
        if SERVICE_RE.match(code):
            add(code, "service")

    for raw_code, nm in (positions or {}).items():
        code = norm_code(raw_code)
        if not POSITION_RE.match(code):
            continue
        names[code][str(nm)].add("rozjasnennya")
        add(code, "position")

    skipped = [c for c in names if not SERVICE_RE.match(c) and not POSITION_RE.match(c)]

    meta = {
        "generated": date.today().isoformat(),
        "title": "Коди ЕСОЗ",
        "disclaimer": (
            "Реконструкція, зібрана з документів НСЗУ, а не копія офіційного класифікатора. "
            "Покриття неповне: це ті коди, що трапилися в опрацьованих документах."
        ),
        "counts": {
            "services": sum(1 for e in index if e["k"] == "service"),
            "positions": sum(1 for e in index if e["k"] == "position"),
            "with_packages": sum(1 for e in index if e["p"]),
            "with_mentions": sum(1 for e in index if e["r"]),
            "with_note": sum(1 for c in cards.values() if c["note"]),
            "conflicting_names": sum(1 for e in index if e["v"] > 1),
            "skipped_codes": len(skipped),
        },
        "sources": [
            {"file": "classifiers/data/esoz_names.json", "label": SRC_LABEL["nk026"]},
            {"file": "mapping/data/names/esoz_all.json", "label": SRC_LABEL["mapping"]},
            {"file": "rozjasnennya/build/esoz_names.json", "label": SRC_LABEL["rozjasnennya"]},
            {"file": "rozjasnennya/data/codes_index.json", "label": SRC_LABEL["titles"]},
            {"file": "rozjasnennya/build/positions.json", "label": "посади ЕСОЗ"},
        ],
        "categories": sorted({e["t"] for e in index if e["t"]}),
    }

    index.sort(key=lambda e: (e["k"] != "service", e["c"]))

    (OUT / "esoz_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "esoz_index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "esoz_cards.json").write_text(
        json.dumps(cards, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    log("")
    log(f"Записано у {OUT.relative_to(WEB)}:")
    log(f"  послуг: {meta['counts']['services']} · посад: {meta['counts']['positions']}")
    log(f"  з пакетами: {meta['counts']['with_packages']} · зі згадками в роз'ясненнях: {meta['counts']['with_mentions']}")
    log(f"  з розбіжними назвами: {meta['counts']['conflicting_names']} · із застереженням: {meta['counts']['with_note']}")
    if skipped:
        log(f"  пропущено кодів нестандартного вигляду: {len(skipped)} — {skipped[:8]}")


if __name__ == "__main__":
    sys.exit(main())
