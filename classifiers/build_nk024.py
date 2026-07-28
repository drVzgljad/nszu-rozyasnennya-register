# -*- coding: utf-8 -*-
"""
Білдер НК 024:2023 «Класифікатор медичних виробів» для НавігаторПМГ26.

Джерело: D:\\rpe-pmg\\nk-024_2023.pdf — офіційне видання розробника (ТОВ «ВО ПОЛІТЕХМЕД»),
введено наказом Мінекономіки від 24.05.2023 № 4139, чинний з 15.06.2023.
Класифікатор гармонізовано з міжнародною номенклатурою GMDN
(Global Medical Device Nomenclature). Позиція = п'ять частин:
код (5 цифр), назва укр., опис укр., назва англ., опис англ.

Таблиця в PDF — альбомна, 5 колонок зі стабільними x-координатами:
  x≈20 код · x≈73 назва укр · x≈185 опис укр · x≈438 назва англ · x≈600 опис англ
Записи переносяться між сторінками; заголовок таблиці лише на першій табличній сторінці.

Порядок слів беремо з нумерації (блок, рядок, слово), а не з координат: курсивне
«in vitro» має власну базову лінію, тож сортування за y розриває назви на кшталт
«IVD (діагностика in vitro)». Колонку визначаємо за x кожного слова окремо —
один рядок PDF може охоплювати дві колонки (назва англ. + початок опису).

Вихід у ./data/nk024:
  nk024_meta.json   — підсумки, літерні розділи, лічильники ознак, дата, джерело.
  nk024_index.json  — плаский пошуковий індекс: [код, назва укр, назва англ, літера, ознаки].
  terms/<id>.json   — повні паспорти (назви + описи обома мовами) по літерних розділах
                      (lazy-load для фронта).

Ознаки (бітова маска, виводяться з опису):
  1 — одноразовий · 2 — багаторазовий · 4 — IVD (діагностика in vitro) · 8 — стерильний
"""
import json, re, sys, time
from pathlib import Path
from collections import Counter, defaultdict

import fitz  # PyMuPDF

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
DATA = BASE / "data" / "nk024"
TERMS = DATA / "terms"
DATA.mkdir(parents=True, exist_ok=True)
TERMS.mkdir(parents=True, exist_ok=True)

PDF = Path(r"D:\rpe-pmg\nk-024_2023.pdf")

LOG = DATA / "build_nk024.log"
def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")

# Межі колонок за x0 слова
def col_of(x):
    if x < 70:  return 0   # код
    if x < 183: return 1   # назва укр
    if x < 436: return 2   # опис укр
    if x < 597: return 3   # назва англ
    return 4               # опис англ

CODE_RE = re.compile(r"^\d{5}$")

# Український алфавіт для порядку літерних розділів
UA_ALPHA = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ"
LAT_BUCKET = "LAT"   # латиниця/цифри (SARS-CoV-2 тощо)

def letter_of(name):
    ch = name[:1].upper()
    if ch in UA_ALPHA:
        return ch
    return LAT_BUCKET

def clean_text(s):
    s = re.sub(r"\s+", " ", s).strip()
    # Перенос рядка стається лише на наявному дефісі (авто-переносу в джерелі немає),
    # тож дефіс зберігаємо, прибираємо тільки пробіл: "мас- спектрометрія" → "мас-спектрометрія".
    # Виняток — «підвісний» дефіс перед сполучником: «внутрішньо- чи зовнішньо-» лишаємо як є.
    s = re.sub(r"(?<=\w)- (?!(?:чи|або|й|і|та|ані)\b)(?=\w)", "-", s)
    # PDF-артефакт курсиву: "in vitro )" → "in vitro)"
    s = s.replace(" )", ")").replace("( ", "(")
    s = re.sub(r"\s+([,.;:])", r"\1", s)
    return s

def flags_of(ua_desc):
    d = ua_desc.lower()
    f = 0
    if "одноразов" in d: f |= 1
    if "багаторазов" in d: f |= 2
    if "in vitro" in d or "івд" in d: f |= 4
    if "стериль" in d: f |= 8
    return f

def main():
    doc = fitz.open(PDF)
    log(f"PDF відкрито: {PDF.name}, сторінок: {len(doc)}")

    records = []          # [code, ua, uadesc, en, endesc]
    cur = None
    stray = []

    for pno in range(len(doc)):
        page = doc[pno]
        r = page.rect
        if r.width < r.height:      # портретні сторінки — передмова, зміст
            continue
        words = page.get_text("words")
        # заголовок таблиці (лише там, де в колонці коду стоїть слово "Код")
        header_y = None
        for w in words:
            if col_of(w[0]) == 0 and w[4] == "Код":
                header_y = w[1]
                break
        if header_y is not None:
            words = [w for w in words if abs(w[1] - header_y) > 2]
        words.sort(key=lambda w: (w[5], w[6], w[7]))   # блок → рядок → слово

        for x0, y0, x1, y1, text, *_ in words:
            c = col_of(x0)
            if c == 0:
                if CODE_RE.match(text):
                    if cur: records.append(cur)
                    cur = [text, [], [], [], []]
                else:
                    stray.append((pno, round(x0, 1), round(y0, 1), text))
            else:
                if cur is None:
                    stray.append((pno, round(x0, 1), round(y0, 1), text))
                    continue
                cur[c].append(text)
        if pno % 1000 == 0:
            log(f"  сторінка {pno}, записів поки {len(records)}")
    if cur: records.append(cur)

    log(f"Розпарсено записів: {len(records)}; сторонніх слів: {len(stray)}")
    if stray[:10]:
        log(f"Приклади сторонніх: {stray[:10]}")

    # Збирання текстів
    out = []
    dups = Counter()
    for code, ua, uadesc, en, endesc in records:
        rec = [code, clean_text(" ".join(ua)), clean_text(" ".join(uadesc)),
               clean_text(" ".join(en)), clean_text(" ".join(endesc))]
        dups[code] += 1
        out.append(rec)

    dup_codes = [c for c, n in dups.items() if n > 1]
    if dup_codes:
        log(f"УВАГА: дублікати кодів ({len(dup_codes)}): {dup_codes[:20]}")
    empty_ua = [r[0] for r in out if not r[1]]
    if empty_ua:
        log(f"УВАГА: без укр. назви ({len(empty_ua)}): {empty_ua[:20]}")

    # Літерні розділи в порядку книги (алфавітному)
    letters_seen = []
    for r in out:
        L = letter_of(r[1])
        if L not in letters_seen:
            letters_seen.append(L)
    order = [ch for ch in UA_ALPHA if ch in letters_seen]
    if LAT_BUCKET in letters_seen:
        order.append(LAT_BUCKET)
    lid = {L: i for i, L in enumerate(order)}

    # Індекс + повні паспорти по розділах
    index = []
    terms = defaultdict(dict)
    flag_counts = Counter()
    letter_counts = Counter()
    for code, uan, uad, enn, end in out:
        L = letter_of(uan)
        f = flags_of(uad)
        index.append([code, uan, enn, lid[L], f])
        terms[L][code] = [uan, uad, enn, end]
        letter_counts[L] += 1
        for bit, key in ((1, "single_use"), (2, "reusable"), (4, "ivd"), (8, "sterile")):
            if f & bit: flag_counts[key] += 1

    with open(DATA / "nk024_index.json", "w", encoding="utf-8") as fp:
        json.dump(index, fp, ensure_ascii=False, separators=(",", ":"))

    for L in order:
        fname = f"{lid[L]:02d}.json"
        with open(TERMS / fname, "w", encoding="utf-8") as fp:
            json.dump(terms[L], fp, ensure_ascii=False, separators=(",", ":"))

    meta = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": "НК 024:2023 «Класифікатор медичних виробів» (гармонізований з номенклатурою GMDN)",
        "approved": "наказ Мінекономіки від 24.05.2023 № 4139, чинний з 15.06.2023",
        "note_nk031": "З 01.09.2025 паралельно чинний НК 031:2024 «Національна номенклатура медичних виробів» (наказ Мінекономіки від 24.09.2024 № 23992); НК 024:2023 не скасовано.",
        "total": len(out),
        "flags": dict(flag_counts),
        "letters": [
            {"id": lid[L], "letter": ("Латиниця / цифри" if L == LAT_BUCKET else L),
             "file": f"{lid[L]:02d}.json", "count": letter_counts[L]}
            for L in order
        ],
        "schema_index": ["code", "ua", "en", "letter_id", "flags(1=одноразовий,2=багаторазовий,4=IVD,8=стерильний)"],
        "schema_terms": ["ua", "ua_desc", "en", "en_desc"],
    }
    with open(DATA / "nk024_meta.json", "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=1)

    log(f"Готово: {len(out)} кодів, {len(order)} літерних розділів")
    log(f"Ознаки: {dict(flag_counts)}")
    for L in order:
        log(f"  {L}: {letter_counts[L]}")

if __name__ == "__main__":
    main()
