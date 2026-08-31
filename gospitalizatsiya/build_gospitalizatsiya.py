# -*- coding: utf-8 -*-
"""
Збірка розділу «Критерії госпіталізації» (наказ МОЗ від 30.07.2026 № 1044).

Джерела (PDF з офіційного сайту МОЗ, покладені в 00_ВХІДНЕ обмінної теки):
  dn_1044_30072026.pdf      — сам наказ (1 стор.)
  dn_1044_30072026_dod.pdf  — Стандарт «Критерії госпіталізації …» (61 стор.)

Що робить:
  1. Витягує текст PyMuPDF-ом у режимі dict — потрібен саме він, бо жирність
     рядка це ЄДИНА ознака підзаголовка всередині розділу («Дихальні шляхи та
     дихання», «Кровообіг, неврологічні …»). У плоскому get_text() вона зникає,
     і документ перетворюється на суцільну кашу з 500 однакових абзаців.
  2. Склеює перенесені рядки в абзаци. Пастка PDF: вирівняний по ширині текст
     PyMuPDF місцями ріже на однослівні рядки («У / розробці / положень / …»),
     тож будь-який рядок, що не починається з маркера, — це продовження.
  3. Маркер списку в PDF намальовано символьним шрифтом і при витягуванні він
     зникає, лишаючи ДВА ПРОБІЛИ на початку рядка. Це і є ознака пункту-крапки.
  4. Пише data/standard.json — плоский список блоків із рівнями; вкладеність
     малює вже сторінка.

Запуск:  python build_gospitalizatsiya.py [шлях_до_теки_з_pdf]
"""
import json
import os
import re
import sys
from datetime import date

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "standard.json")

DEFAULT_SRC = os.path.join(
    os.path.expanduser("~"),
    "OneDrive - National Health Service of Ukraine",
    "!Работа!", "!ПМГ!", "!!Обмінна!!", "00_ВХІДНЕ",
)

# Розділи стандарту. Ключ — як воно надруковано (кирилична І, латинська V).
SECTIONS = [
    ("I",   "І. Загальні положення та принципи застосування",
     "Загальні положення та принципи застосування"),
    ("II",  "ІІ. Втручання, що проводяться в умовах стаціонару",
     "Втручання, що проводяться в умовах стаціонару"),
    ("III", "ІІІ. Деякі загрозливі для життя показники, при яких госпіталізація",
     "Деякі загрозливі для життя показники, при яких госпіталізація обов’язкова"),
    ("IV",  "ІV. Деякі захворювання та стани, при яких госпіталізація",
     "Деякі захворювання та стани, при яких госпіталізація обов’язкова"),
    ("V",   "V. Соціальні показання до госпіталізації",
     "Соціальні показання до госпіталізації"),
]
SOURCES_HEAD = "Перелік джерел та нормативно-правових актів, використаних при"

# «6.» окремим рядком — не помилка розпізнавання, а вирівняний по ширині
# абзац, який PyMuPDF ріже на однослівні рядки. Без хвоста `|$` пункт 6
# розділу І (той самий, що каже «не встановлює тарифи і правила оплати»)
# мовчки прилипав до пункту 5 і зникав із переліку.
RE_NUM = re.compile(r"^(\d{1,2})\.(\s+(?=[А-ЯЄІЇҐа-яєіїґ«(])|\s*$)")
RE_SUB = re.compile(r"^(\d{1,2})\)(\s+|\s*$)")
RE_LET = re.compile(r"^([абвгдеєжзиійк])\)(\s+|\s*$)")
RE_PAGENO = re.compile(r"^\d{1,2}\s*$")
RE_SRC_NUM = re.compile(r"^(\d{1,3})\.\s+")
RE_SIGN = re.compile(r"^(Директор Департаменту|В\.?\s*о\.?\s+директора)")


def raw_lines(pdf_path):
    """Рядки документа з ознакою жирності, без колонтитулів і порожніх."""
    doc = fitz.open(pdf_path)
    out = []
    for pageno, page in enumerate(doc, 1):
        taken = 0
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                text = "".join(s["text"] for s in line["spans"])
                if not text.strip():
                    continue
                # Колонтитул відкидається лише тоді, коли число ДОРІВНЮЄ
                # номеру сторінки і стоїть на її початку. Правило «будь-яке
                # двоцифрове число само на рядку» з'їдало текст: у пункті 1
                # розділу V так зникло «48» з фрази «Продовження понад
                # 48 години», бо вирівнювання по ширині винесло його в
                # окремий рядок.
                if taken < 2 and text.strip() == str(pageno):
                    taken += 1
                    continue
                taken += 1
                bold = any("Bold" in s["font"] for s in line["spans"])
                # Два пробіли на початку = зниклий маркер списку
                bullet = text.startswith("  ") and not text.startswith("   ")
                out.append({"t": text.rstrip(), "b": bold, "bul": bullet})
    doc.close()
    return out


def classify(text, bold, bullet):
    """Тип початку абзацу або None, якщо це продовження попереднього."""
    s = text.strip()
    if bullet:
        return "bullet"
    if RE_NUM.match(s):
        return "num"
    if RE_SUB.match(s):
        return "sub"
    if RE_LET.match(s):
        return "letter"
    if bold:
        return "head"
    return None


def build_blocks(lines):
    """Склеює рядки в абзаци й розкладає їх по розділах."""
    sections = [{"id": sid, "title": title, "printed": printed, "blocks": []}
                for sid, printed, title in SECTIONS]
    by_printed = {printed: i for i, (_, printed, _) in enumerate(SECTIONS)}

    cur = None          # індекс поточного розділу
    preamble = []       # усе до розділу І (титул, перелік скорочень)
    sources = []        # перелік джерел у кінці
    signature = []      # підпис директора Департаменту під переліком джерел
    in_sources = False
    in_sign = False
    drop_tail = False   # чекаємо на хвіст назви розділу, перенесений на рядок
    buf = None

    def flush():
        nonlocal buf
        if not buf:
            return
        text = re.sub(r"\s+", " ", buf["text"]).strip()
        if not text:
            buf = None
            return
        rec = {"kind": buf["kind"], "text": text}
        if in_sources:
            sources.append(text)
        elif cur is None:
            preamble.append(rec)
        else:
            sections[cur]["blocks"].append(rec)
        buf = None

    for ln in lines:
        s = ln["t"].strip()

        if s.startswith(SOURCES_HEAD):
            flush()
            in_sources = True
            buf = None       # «підготовці» — хвіст заголовка, не джерело
            continue

        if in_sources:
            # Перелік джерел має власне правило: 70 із 84 позицій — це
            # англомовна бібліографія, і загальне RE_NUM її не бачить
            # (воно вимагає кириличний початок), тож усі вони злипалися
            # в один пункт 14.
            if RE_SIGN.match(s):
                in_sign = True
            if in_sign:
                signature.append(s)
                continue
            # Перелік джерел не ріжеться по рядках узагалі: позиція 45
            # починається ПОСЕРЕДИНІ рядка, одразу після крапки позиції 44
            # («… jama.2016.9185. 45. Burn Patient Referral …»). Тому
            # збираємо все в одну стрічку, а ріжемо після циклу.
            sources.append(s)
            continue

        hit = next((p for p in by_printed if s.startswith(p)), None)
        if hit:
            flush()
            cur = by_printed[hit]
            # У «ІІІ.» і «ІV.» назва розділу перенесена на два рядки, і хвіст
            # («обов’язкова») теж жирний — без цього прапорця він відкривав би
            # фальшивий підзаголовок і зжирав першу вступну фразу розділу.
            # Тільки ІІІ і ІV: у розділу ІІ наступний жирний рядок — це вже
            # «Респіраторна», перше слово підзаголовка, і його треба лишити.
            drop_tail = by_printed[hit] in (2, 3)
            continue

        kind = classify(ln["t"], ln["b"], ln["bul"])
        if drop_tail:
            drop_tail = False
            if ln["b"] and len(s) < 20:
                continue

        # Жирний заголовок теж переноситься («… (будь-що з» / «наведеного):»).
        # Другий рядок — продовження, а не новий підзаголовок: ознака та сама,
        # що й у людини, — попередня фраза ще не закінчена.
        if (kind == "head" and buf
                and not buf["text"].rstrip().endswith((":", ".", ";"))):
            buf["text"] += " " + s
        elif kind:
            flush()
            buf = {"kind": kind, "text": s}
        elif buf:
            buf["text"] += " " + s
        else:
            buf = {"kind": "para", "text": s}
    flush()

    # Хвіст заголовка розділу («обов’язкова») першим блоком — прибираємо
    for sec in sections:
        while sec["blocks"] and len(sec["blocks"][0]["text"]) < 15:
            sec["blocks"].pop(0)

    return preamble, sections, split_sources(sources), " ".join(signature)


def split_sources(lines):
    """Ріже суцільний перелік джерел за наскрізною нумерацією 1, 2, 3 …

    Шукаємо саме НАСТУПНИЙ номер, а не «будь-яку цифру з крапкою»: в описах
    статей цифр із крапкою повно (том, сторінки, рік), і за загальним
    правилом 84 позиції розсипаються на 145.
    """
    blob = re.sub(r"\s+", " ", " ".join(lines)).strip()
    # Заголовок переліку перенесено на два рядки; його хвіст інакше стає
    # позицією № 1 і зсуває всю нумерацію на одиницю.
    blob = re.sub(r"^підготовці\s*", "", blob)
    out, pos, n = [], 0, 1
    if blob.startswith("1. "):
        pos, n = 3, 2
    while True:
        m = re.search(rf"(?<![\divxlc]){n}\.\s", blob[pos:])
        if not m:
            break
        out.append(blob[pos:pos + m.start()].strip(" ;"))
        pos += m.end()
        n += 1
    out.append(blob[pos:].strip(" ;"))
    return [x for x in out if x]


def strip_marker(kind, text):
    """Виносить маркер («1.», «2)», «а)») з тексту в окреме поле."""
    if kind == "num":
        m = RE_NUM.match(text)
        if m:
            return m.group(1) + ".", text[m.end():]
    if kind == "sub":
        m = RE_SUB.match(text)
        if m:
            return m.group(1) + ")", text[m.end():]
    if kind == "letter":
        m = RE_LET.match(text)
        if m:
            return m.group(1) + ")", text[m.end():]
    return "", text


def enrich(sections):
    """Маркери в окреме поле, наскрізні id, посилання на інші акти."""
    re_act = re.compile(
        r"(наказ(?:ом|у|і)?\s+Міністерства охорони здоров[’']я України[^;.]{0,160}?№\s*\d+"
        r"|постанов(?:а|и|ою|і)\s+Кабінету Міністрів України[^;.]{0,120}?№\s*\d+"
        r"|Закон(?:у|ом|і)?\s+України\s+«[^»]+»)", re.I)
    for sec in sections:
        for i, b in enumerate(sec["blocks"], 1):
            b["marker"], b["text"] = strip_marker(b["kind"], b["text"])
            b["id"] = f'{sec["id"]}-{i}'
            acts = [re.sub(r"\s+", " ", m.group(0)).strip()
                    for m in re_act.finditer(b["text"])]
            if acts:
                b["acts"] = sorted(set(acts))
    return sections


def parse_abbrev(pdf_path):
    """Перелік скорочень зі сторінки 2 — двоколонкова таблиця.

    Ріжеться за координатою x (скорочення ~91, розшифровка ~179), а не за
    порядком рядків: у «MOG-асоційоване захворювання» ліва колонка займає
    три рядки, права два, і будь-яке чергування розсипається.
    """
    doc = fitz.open(pdf_path)
    left, right = [], []
    for block in doc[1].get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            t = "".join(s["text"] for s in line["spans"]).strip()
            if not t or t == "2" or t.startswith("Перелік скорочень"):
                continue
            x, y = line["bbox"][0], line["bbox"][1]
            (left if x < 150 else right).append((y, t))
    doc.close()
    left.sort(); right.sort()

    # Новий запис починається з рядка, що НЕ є продовженням. Продовження —
    # це слово БЕЗ жодної великої літери («асоційоване», «захворювання»).
    # Перевіряти лише першу літеру мало: «sPESI» так приклеювався до «PESI».
    entries = []
    for y, t in left:
        if entries and (t == t.lower() or entries[-1]["short"].endswith("-")):
            entries[-1]["short"] += ("" if entries[-1]["short"].endswith("-") else " ") + t
        else:
            entries.append({"y": y, "short": t, "full": []})
    for i, e in enumerate(entries):
        top = e["y"] - 3
        bottom = entries[i + 1]["y"] - 3 if i + 1 < len(entries) else 10 ** 6
        e["full"] = " ".join(t for y, t in right if top <= y < bottom)
        del e["y"]
    return [e for e in entries if e["full"]]


def lost_words(lines, data):
    """Що з PDF не доїхало до JSON.

    Рахуємо ЛІТЕРИ І ЦИФРИ, а не слова: словниковий діфф шумить на кожній
    дрібниці розбиття («MOG-» + «асоційоване» проти «MOG-асоційоване»), і
    справжня втрата тоне в артефактах. Слова показуємо лише як підказку,
    де саме шукати.
    """
    from collections import Counter

    def words(s):
        return re.findall(r"[0-9A-Za-zА-Яа-яЄІЇҐєіїґ’'ʼ.,%№≥≤<>/-]+", s)

    def chars(s):
        return [c for c in s.lower() if c.isalnum()]

    # Усе, що сторінка показує людині, плюс те, що свідомо не переїхало в
    # дані: титул, заголовок переліку джерел, перенесені хвости назв розділів.
    shown = [sec["id"] + ". " + sec["title"] for sec in data["sections"]]
    shown += [b["marker"] + " " + b["text"]
              for sec in data["sections"] for b in sec["blocks"]]
    shown += [f"{i + 1}. {s}" for i, s in enumerate(data["sources"])]
    shown += [a["short"] + " " + a["full"] for a in data.get("abbrev", [])]
    shown.append(data.get("std_signed_by", ""))
    shown.append("ЗАТВЕРДЖЕНО Наказ Міністерства охорони здоров’я України "
                 "30 липня 2026 року № 1044 СТАНДАРТ КРИТЕРІЇ ГОСПІТАЛІЗАЦІЇ "
                 "ПАЦІЄНТІВ ДЛЯ НАДАННЯ СТАЦІОНАРНОЇ МЕДИЧНОЇ ДОПОМОГИ 2026 "
                 "Перелік скорочень обов’язкова")
    shown.append(SOURCES_HEAD + " підготовці")
    # Номер розділу в даних латиницею (I, II…), у PDF — кирилицею (І, ІІ…)
    shown += [printed for _, printed, _ in SECTIONS]

    raw = [ln["t"] for ln in lines]
    lost_chars = Counter(c for s in raw for c in chars(s)) \
        - Counter(c for s in shown for c in chars(s))
    if not lost_chars:
        return []
    hint = Counter(w for s in raw for w in words(s)) \
        - Counter(w for s in shown for w in words(s))
    return [f"{sum(lost_chars.values())} символів"] + \
           [f"{w}×{n}" if n > 1 else w for w, n in hint.most_common(12)]


def order_text(pdf_path):
    doc = fitz.open(pdf_path)
    txt = doc[0].get_text()
    doc.close()
    paras, buf = [], ""
    for line in txt.split("\n"):
        s = line.strip()
        if not s:
            if buf:
                paras.append(re.sub(r"\s+", " ", buf).strip())
                buf = ""
            continue
        buf += " " + s
    if buf:
        paras.append(re.sub(r"\s+", " ", buf).strip())
    return [p for p in paras if p]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    p_order = os.path.join(src, "dn_1044_30072026.pdf")
    p_std = os.path.join(src, "dn_1044_30072026_dod.pdf")
    for p in (p_order, p_std):
        if not os.path.exists(p):
            sys.exit(f"Немає файлу: {p}")

    lines = raw_lines(p_std)
    preamble, sections, sources, signature = build_blocks(lines)
    sections = enrich(sections)

    abbrev = parse_abbrev(p_std)

    doc = fitz.open(p_std)
    pages = doc.page_count
    doc.close()

    data = {
        "meta": {
            "order_no": "1044",
            "order_date": "30.07.2026",
            "order_title": "Про затвердження Стандарту «Критерії госпіталізації "
                           "пацієнтів для надання стаціонарної медичної допомоги»",
            "std_title": "Критерії госпіталізації пацієнтів для надання "
                         "стаціонарної медичної допомоги",
            "signed_by": "Міністр Віктор Ляшко",
            "control": "заступник Міністра Євгеній Гончар",
            "pages": pages,
            "generated": date.today().isoformat(),
        },
        "order": order_text(p_order),
        "abbrev": abbrev,
        "sections": sections,
        "sources": sources,
        "std_signed_by": signature,
    }

    # Скільки тексту PDF не доїхало до JSON. Саме так спіймано зникле «48»
    # у пункті 1 розділу V: на око фраза читалася гладко («Продовження
    # понад години»), і без цієї перевірки помилка поїхала б на портал.
    lost = lost_words(lines, data)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    total = sum(len(s["blocks"]) for s in data["sections"])
    print(f"standard.json: {len(data['sections'])} розділів, {total} блоків, "
          f"{len(abbrev)} скорочень, {len(sources)} джерел, {pages} стор.")
    for s in data["sections"]:
        print(f"  {s['id']:>3}. {s['title'][:56]:<58} {len(s['blocks']):>4} блоків")
    print(check(data, lost))


def check(data, lost):
    """Самоперевірка: дірки в наскрізній нумерації = з'їдений пункт.

    Саме так спіймано зникнення пункту 6 розділу І — того самого, що каже
    «не встановлює тарифи і правила оплати». Дірка в нумерації дешевша за
    перечитування 61 сторінки очима.
    """
    problems = []
    for sec in data["sections"]:
        nums = [int(b["marker"][:-1]) for b in sec["blocks"]
                if b["kind"] == "num" and b["marker"][:-1].isdigit()]
        if nums:
            missing = sorted(set(range(1, max(nums) + 1)) - set(nums))
            if missing:
                problems.append(f"розділ {sec['id']}: немає пунктів "
                                + ", ".join(map(str, missing)))
        # «ІВЛ;» і «судоми;» — справжні пункти стандарту, не збій розбору,
        # тож поріг стоїть нижче за них.
        empty = [b["id"] for b in sec["blocks"] if len(b["text"]) < 4]
        if empty:
            problems.append(f"розділ {sec['id']}: обірвані блоки {empty[:5]}")
    short_src = [i + 1 for i, s in enumerate(data["sources"]) if len(s) < 25]
    if short_src:
        problems.append("джерела: підозріло короткі позиції "
                        + ", ".join(map(str, short_src[:10])))
    if lost:
        problems.append("втрачено при розборі: " + "; ".join(lost))
    return "перевірка: усе на місці" if not problems \
        else "УВАГА:\n  " + "\n  ".join(problems)


if __name__ == "__main__":
    main()
