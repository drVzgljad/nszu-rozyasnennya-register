# -*- coding: utf-8 -*-
"""LOINC у документах ПМГ — малий витяг із довідника для Кодера.

Повний LOINC — 109 тисяч кодів і 37 МБ; тягнути його в Кодер заради одного коду не варто.
А кодів, які справді трапляються в документах НСЗУ про ПМГ, — кількасот. Цей скрипт
збирає їхній перелік і бере назви з уже зібраного довідника (`data/loinc/loinc_data_*.json`).

Де шукає коди LOINC:
  algorithms/data/ambulatory_9.json   коди спостережень лабораторних та інструментальних
                                      послуг пакета 9 (поля code, report_code, obs)
  mapping/data/services.json          коди спостережень у Таблиці співставлення
  rozjasnennya/data/codes_index.json  згадки в роз'ясненнях НСЗУ (index.loinc)

Сам файл зв'язків не містить: хто і де згадує код, Кодер читає з тих самих трьох джерел.
Тут лише назви — щоб одна група даних мала одне джерело.

Код, якого немає в LOINC цієї версії, потрапляє в `absent` і друкується: це або помилка
набору в документі, або код, новіший за наш реліз.

У файлі навмисно немає дати збірки: він іде на сайт, і зміна самої дати тягла б деплой.

Вихід: classifiers/data/loinc/loinc_pmg.json
"""
import json
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
LOINC = WEB / "classifiers" / "data" / "loinc"
OUT = LOINC / "loinc_pmg.json"
AMBULATORY = WEB / "algorithms" / "data" / "ambulatory_9.json"
MAPPING = WEB / "mapping" / "data" / "services.json"
CODES_INDEX = WEB / "rozjasnennya" / "data" / "codes_index.json"

RE_LOINC = re.compile(r"^\d{1,7}-\d$")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def used_codes():
    """Коди LOINC з документів → звідки взято (для звіту в консолі)."""
    used = {}

    def add(code, where):
        code = str(code or "").strip()
        if RE_LOINC.match(code):
            used.setdefault(code, set()).add(where)

    for r in load(AMBULATORY)["records"]:
        add(r.get("code"), "пакет 9")
        add(r.get("report_code"), "пакет 9")
        for o in r.get("obs") or []:
            add(o, "пакет 9")
    for s in load(MAPPING):
        for part in ("icd", "achi"):
            for c in (s.get(part) or {}).get("loinc") or []:
                add(c, "Таблиця співставлення")
    if CODES_INDEX.exists():
        for c in (load(CODES_INDEX).get("index") or {}).get("loinc") or {}:
            add(c, "роз'яснення")
    return used


def long_name(axes):
    """Та сама збірка назви, що й на сторінці довідника: компонент [властивість] — система · шкала, метод."""
    comp, prop, _time, system, scale, method = axes
    s = comp or "(без компонента)"
    if prop:
        s += f" [{prop}]"
    if system:
        s += f" — {system}"
    tail = ", ".join(x for x in (scale, method) if x)
    if tail:
        s += f" · {tail}"
    return s


def main():
    meta = load(LOINC / "loinc_meta.json")
    used = used_codes()
    class_ua = {}
    codes = {}
    for ct in meta["classtypes"]:
        for c in ct.get("classes") or []:
            if c.get("ua"):
                class_ua[c["code"]] = c["ua"]
        for r in load(LOINC / ct["file"]):
            if r[0] not in used:
                continue
            en = [r[i] or "" for i in range(1, 7)]
            ua_slots = r[7] or [0] * 6
            ua = [ua_slots[i] or en[i] for i in range(6)]
            codes[r[0]] = {
                "n": long_name(ua),      # назва українською (де перекладу осі немає — англійською)
                "e": long_name(en),      # назва англійською
                "ax": en,                # шість осей LOINC
                "ua": [x or 0 for x in ua_slots],
                "c": r[8],               # клас
                "us": r[9],              # якість української назви: 3 офіційна, 2 складена, 1 часткова
                "st": r[11],             # статус коду
                "un": r[12] or "",       # одиниці
                "t": ct["ua"],           # тип: лабораторні, клінічні…
            }
    absent = sorted(c for c in used if c not in codes)
    out = {
        "version": meta.get("version"),
        "source": meta.get("source"),
        "about": "Коди LOINC, які трапляються в документах НСЗУ про програму медичних гарантій: "
                 "спостереження послуг пакета 9, Таблиця співставлення, роз'яснення. "
                 "Назви — з довідника LOINC; повний довідник відкривається окремо.",
        "total": meta.get("total"),
        "classes": {k: class_ua[k] for k in sorted({v["c"] for v in codes.values()}) if k in class_ua},
        "absent": absent,
        "codes": {k: codes[k] for k in sorted(codes)},
    }
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print(f"loinc_pmg.json без змін: {len(codes)} кодів")
    else:
        OUT.write_text(text, encoding="utf-8", newline="\n")
        print(f"loinc_pmg.json: {len(codes)} кодів, {OUT.stat().st_size // 1024} КБ")
    where = {}
    for c in codes:
        for w in used[c]:
            where[w] = where.get(w, 0) + 1
    print("   звідки: " + ", ".join(f"{k} — {v}" for k, v in sorted(where.items())))
    if absent:
        print(f"   ⚠ немає в LOINC {meta.get('version')}: " +
              ", ".join(f"{c} ({', '.join(sorted(used[c]))})" for c in absent))


if __name__ == "__main__":
    main()
