# -*- coding: utf-8 -*-
"""
Білдер LOINC 2.82 (довідник лабораторних та клінічних спостережень) для НавігаторПМГ26.

Джерело: D:\\rpe-pmg\\Loinc_2.82.zip (офіційний реліз Regenstrief, читається прямо з архіву).
  LoincTable/Loinc.csv                                  — 109 325 кодів (англ.).
  AccessoryFiles/LinguisticVariants/ukUA30LinguisticVariant.csv — 3 159 кодів (повний укр. переклад).

LOINC — НЕ офіційна класифікація в Україні і НЕ прив'язується до пакетів ПМГ.
Подається як довідник. Українська назва — офіційна там, де є у мовному варіанті;
де нема — складається з глосарію частин (позначається як неофіційний авто-переклад).

Вихід у ./data/loinc:
  loinc_meta.json          — типи класів → класи (з UA-назвами й лічильниками), підсумки, дата, версія.
  loinc_index.json         — плаский компактний пошуковий індекс усіх кодів (array-encoded).
  loinc_tree/<CLASS>.json   — повні паспорти кодів одного класу (lazy-load для фронта).

Ліцензія: This content LOINC® is copyright © 1995-2026, Regenstrief Institute, Inc.
"""
import os, re, io, csv, json, sys, time, zipfile
from pathlib import Path
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
csv.field_size_limit(10_000_000)

BASE = Path(__file__).resolve().parent
DATA = BASE / "data" / "loinc"
DATA.mkdir(parents=True, exist_ok=True)

ZIP = Path(r"D:\rpe-pmg\Loinc_2.82.zip")
if not ZIP.exists():
    cand = sorted(Path(r"D:\rpe-pmg").glob("Loinc_*.zip"))
    if cand:
        ZIP = cand[-1]
MAIN = "LoincTable/Loinc.csv"
UAV  = "AccessoryFiles/LinguisticVariants/ukUA30LinguisticVariant.csv"

LOG = DATA / "build_loinc.log"
def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")

AXES = ["COMPONENT", "PROPERTY", "TIME_ASPCT", "SYSTEM", "SCALE_TYP", "METHOD_TYP"]
FRAME = ["PROPERTY", "TIME_ASPCT", "SYSTEM", "SCALE_TYP", "METHOD_TYP"]  # усі осі, крім аналіта

# Типи класів LOINC (CLASSTYPE)
CLASSTYPE_LABEL = {
    "1": {"ua": "Лабораторні", "en": "Laboratory"},
    "2": {"ua": "Клінічні", "en": "Clinical"},
    "3": {"ua": "Атрибути вкладень (Claims)", "en": "Claims attachment"},
    "4": {"ua": "Опитувальники", "en": "Survey"},
}

# UA-назви найужиткованіших класів (решта показуються кодом як є)
CLASS_UA = {
    "CHEM": "Хімія / біохімія", "MICRO": "Мікробіологія", "SERO": "Серологія",
    "HEM/BC": "Гематологія / підрахунок клітин", "COAG": "Коагуляція / гемостаз",
    "DRUG/TOX": "Ліки / токсикологія", "UA": "Аналіз сечі", "MOLPATH": "Молекулярна патологія",
    "ABXBACT": "Чутливість до антибіотиків", "ALLERGY": "Алергологія", "BLDBK": "Служба крові",
    "CELLMARK": "Клітинні маркери", "CYTO": "Цитологія", "PATH": "Патоморфологія",
    "FERT": "Репродукція / фертильність", "SPEC": "Зразок / біоматеріал",
    "RAD": "Променева діагностика", "US": "УЗД", "CT": "Комп'ютерна томографія",
    "MRI": "Магнітно-резонансна томографія", "NUCMED": "Ядерна медицина", "XRAY": "Рентген",
    "CARD": "Кардіологія", "EKG": "Електрокардіографія", "ECHO": "Ехокардіографія",
    "PULM": "Пульмонологія / функція дихання", "OB.US": "Акушерське УЗД",
    "GYN": "Гінекологія", "OBGYN": "Акушерство-гінекологія", "H&P.HX": "Анамнез",
    "VITALS": "Вітальні показники", "BDYCRC": "Антропометрія", "BP": "Артеріальний тиск",
    "SURVEY.PROMIS": "Опитувальник PROMIS", "PANEL.CHEM": "Панель: біохімія",
    "PANEL.MICRO": "Панель: мікробіологія", "PANEL.HEM/BC": "Панель: гематологія",
    "DOC.ONTOLOGY": "Онтологія документів", "LABORDERS.ONTOLOGY": "Онтологія лаб-замовлень",
    "CHAL": "Провокаційні / функціональні проби", "PHENX": "PhenX (дослідницькі протоколи)",
    "NEO": "Неонатальний скринінг", "GENETICS": "Генетика", "TUMRRGT": "Онкореєстр",
}

STATUS_SHORT = {"ACTIVE": "A", "TRIAL": "T", "DEPRECATED": "D", "DISCOURAGED": "X"}

def clean(s):
    if not s:
        return ""
    return re.sub(r"\s+", " ", str(s)).strip()

def rows(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))

# ── Композиція української назви з глосарію ──────────────────────────
def compose_ua(en, gloss):
    """Повертає (axes_ua, ua_status, comp_translated).
       axes_ua = {AXIS: (value, is_ua)}  де is_ua=True, якщо значення взяте з глосарію.
       ua_status: 3 офіц. (ставиться зовні), 2 повна, 1 часткова, 0 без перекладу."""
    axes_ua = {}
    any_tr = False
    all_present_tr = True
    comp_tr = False
    for a in AXES:
        ev = clean(en.get(a))
        if not ev:
            axes_ua[a] = ("", False)
            continue
        uv = gloss[a].get(ev)
        if uv:
            axes_ua[a] = (uv, True)
            any_tr = True
            if a == "COMPONENT":
                comp_tr = True
        else:
            axes_ua[a] = (ev, False)
            all_present_tr = False
    status = 2 if all_present_tr else (1 if any_tr else 0)
    return axes_ua, status, comp_tr

# ════════════════════════════════════════════════════════════════════
def main():
    open(LOG, "w", encoding="utf-8").close()
    log(f"Джерело: {ZIP}")
    t0 = time.time()
    if not ZIP.exists():
        log("!! Архів LOINC не знайдено — поклади Loinc_2.82.zip у D:\\rpe-pmg")
        sys.exit(1)

    z = zipfile.ZipFile(ZIP)

    # реліз/версія з імені файлу
    mver = re.search(r"Loinc[_-]?(\d+\.\d+)", ZIP.name)
    version = mver.group(1) if mver else "?"

    # 1) головна таблиця → компактні записи + збір значень осей
    KEEP = AXES + ["CLASS", "CLASSTYPE", "STATUS", "SHORTNAME", "LONG_COMMON_NAME",
                   "CONSUMER_NAME", "DisplayName", "COMMON_TEST_RANK", "ORDER_OBS",
                   "EXAMPLE_UCUM_UNITS", "EXAMPLE_UNITS", "DefinitionDescription",
                   "RELATEDNAMES2", "EXTERNAL_COPYRIGHT_NOTICE", "STATUS_TEXT"]
    en = {}
    order = []
    for r in rows(z, MAIN):
        num = r["LOINC_NUM"]
        en[num] = {k: clean(r.get(k)) for k in KEEP}
        order.append(num)
    log(f"Головна таблиця: {len(en)} кодів")

    # 2) український варіант → офіційні паспорти + глосарій частин
    ua_off = {}   # num -> {AXIS: ua, SHORTNAME, LONG_COMMON_NAME, RELATEDNAMES2}
    gloss = {a: Counter() for a in AXES}   # EN-значення осі -> Counter(UA варіантів)
    for r in rows(z, UAV):
        num = r["LOINC_NUM"]
        rec = {a: clean(r.get(a)) for a in AXES}
        rec["SHORTNAME"] = clean(r.get("SHORTNAME"))
        rec["LONG_COMMON_NAME"] = clean(r.get("LONG_COMMON_NAME"))
        rec["RELATEDNAMES2"] = clean(r.get("RELATEDNAMES2"))
        rec["DISPLAY"] = clean(r.get("LinguisticVariantDisplayName"))
        ua_off[num] = rec
        e = en.get(num)
        if not e:
            continue
        for a in AXES:
            ev, uv = e.get(a), rec.get(a)
            if ev and uv:
                gloss[a][(ev, uv)] += 1
    # згорнути глосарій: для кожного EN-значення беремо найчастіший UA-варіант
    gloss_final = {a: {} for a in AXES}
    tmp = {a: defaultdict(Counter) for a in AXES}
    for a in AXES:
        for (ev, uv), c in gloss[a].items():
            tmp[a][ev][uv] += c
        for ev, cc in tmp[a].items():
            gloss_final[a][ev] = cc.most_common(1)[0][0]
    gloss = gloss_final
    log(f"Український варіант: {len(ua_off)} кодів; "
        f"глосарій — " + ", ".join(f"{a}={len(gloss[a])}" for a in AXES))

    # LLM-переклад компонентів (неофіційний, нижчий пріоритет за офіційний глосарій).
    # Файл — результат перекладу distinct-компонентів субагентами (див. loinc_untranslated_components.json).
    LLM_COMP = BASE / "loinc_ua_components.json"
    if LLM_COMP.exists():
        added = 0
        for en_val, ua_val in json.load(open(LLM_COMP, encoding="utf-8")).items():
            en_val, ua_val = clean(en_val), clean(ua_val)
            if en_val and ua_val and en_val != ua_val and en_val not in gloss["COMPONENT"]:
                gloss["COMPONENT"][en_val] = ua_val
                added += 1
        log(f"LLM-переклад компонентів: додано {added} (усього COMPONENT={len(gloss['COMPONENT'])})")

    # 3) збірка компактних записів (один шар даних, без окремого дерева).
    #    Схема запису (array-encoded, фіксовані колонки):
    #      0 num
    #      1..6 EN-осі: COMPONENT, PROPERTY, TIME_ASPCT, SYSTEM, SCALE_TYP, METHOD_TYP
    #      7 uaSlots: [comp,prop,time,sys,scale,method] — UA-значення осі або 0, якщо не перекладено
    #      8 cls (CLASS-код)   9 us (0-3)   10 rank   11 st (A/T/D/X)
    #      12 units|0   13 cons|0   14 def|0   15 cpr|0
    #    Довгі/короткі назви й паспорт фронт складає сам із осей — не дублюємо.
    SCHEMA = ["num", "comp", "prop", "time", "sys", "scale", "method",
              "ua", "cls", "us", "rank", "st", "units", "cons", "def", "cpr"]
    by_ct = defaultdict(list)             # CLASSTYPE -> [record, ...]
    class_meta = {}                       # CLASS -> {ct, count, ua_full}
    ua_stats = Counter()                  # 0/1/2/3
    for num in order:
        e = en[num]
        cls = e.get("CLASS") or "OTHER"
        ctype = e.get("CLASSTYPE") or "0"
        off = ua_off.get(num)
        if off:
            ua_slots = [off.get(a) or 0 for a in AXES]
            ustat = 3
        else:
            axes_ua, ustat, _ = compose_ua(e, gloss)
            ua_slots = [axes_ua[a][0] if axes_ua[a][1] else 0 for a in AXES]
        ua_stats[ustat] += 1

        try:
            rank = int(e.get("COMMON_TEST_RANK") or "0")
        except ValueError:
            rank = 0
        st = STATUS_SHORT.get(e.get("STATUS", ""), "A")

        rec = [
            num,
            e.get("COMPONENT"), e.get("PROPERTY"), e.get("TIME_ASPCT"),
            e.get("SYSTEM"), e.get("SCALE_TYP"), e.get("METHOD_TYP"),
            ua_slots, cls, ustat, rank, st,
            e.get("EXAMPLE_UCUM_UNITS") or e.get("EXAMPLE_UNITS") or 0,
            e.get("CONSUMER_NAME") or 0,
            (e.get("DefinitionDescription") or "")[:1200] or 0,
            e.get("EXTERNAL_COPYRIGHT_NOTICE") or 0,
        ]
        by_ct[ctype].append(rec)
        cm = class_meta.setdefault(cls, {"ct": ctype, "count": 0, "ua_full": 0})
        cm["count"] += 1
        if ustat >= 2:
            cm["ua_full"] += 1

    total = sum(len(v) for v in by_ct.values())

    # 4) meta: типи класів -> класи (для каскаду й лічильників)
    ct_groups = defaultdict(list)
    for cls, m in class_meta.items():
        ct_groups[m["ct"]].append(cls)
    classtypes = []
    for ct in sorted(ct_groups, key=lambda x: (x or "9")):
        cl_list = sorted(ct_groups[ct], key=lambda c: (-class_meta[c]["count"], c))
        classes = [{"code": c, "ua": CLASS_UA.get(c),
                    "count": class_meta[c]["count"], "ua_full": class_meta[c]["ua_full"]}
                   for c in cl_list]
        lab = CLASSTYPE_LABEL.get(ct, {"ua": "Інше", "en": "Other"})
        classtypes.append({
            "id": ct, "ua": lab["ua"], "en": lab["en"],
            "count": sum(class_meta[c]["count"] for c in cl_list),
            "file": f"loinc_data_{ct}.json",
            "classes": classes,
        })

    meta = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": f"LOINC® {version} (Regenstrief Institute, Inc.)",
        "version": version,
        "schema": SCHEMA,
        "axes": AXES,
        "total": total,
        "ua_official": ua_stats[3],
        "ua_full": ua_stats[3] + ua_stats[2],
        "ua_partial": ua_stats[1],
        "en_only": ua_stats[0],
        "classtypes": classtypes,
        "license": ("Цей довідник містить контент LOINC® (http://loinc.org), "
                    "© 1995–2026 Regenstrief Institute, Inc. Використовується на умовах "
                    "ліцензії LOINC. LOINC — не національний класифікатор України; наведено "
                    "як довідковий інструмент."),
    }
    json.dump(meta, open(DATA / "loinc_meta.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    # 5) шари даних по типах класів (лаб/клін/опитувальники/claims) — lazy-load
    for ct, recs in by_ct.items():
        # сортуємо: спершу з рангом вживаності (частіші вгорі), далі за кодом
        recs.sort(key=lambda r: (0 if r[10] else 1, -r[10], r[0]))
        json.dump(recs, open(DATA / f"loinc_data_{ct}.json", "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))

    dt = time.time() - t0
    sizes = {ct: (DATA / f"loinc_data_{ct}.json").stat().st_size for ct in by_ct}
    tot_sz = sum(sizes.values())
    log(f"ГОТОВО за {dt:.0f}с. Кодів={total}, класів={len(class_meta)}.")
    log(f"UA: офіц={ua_stats[3]}, повна(вкл.складену)={ua_stats[3]+ua_stats[2]}, "
        f"часткова={ua_stats[1]}, лише EN={ua_stats[0]}")
    for ct in sorted(sizes):
        lab = CLASSTYPE_LABEL.get(ct, {"ua": ct})["ua"]
        log(f"   loinc_data_{ct}.json ({lab}): {len(by_ct[ct])} кодів, {sizes[ct]/1024/1024:.2f} МБ")
    log(f"Разом даних: {tot_sz/1024/1024:.2f} МБ + meta")

if __name__ == "__main__":
    main()
