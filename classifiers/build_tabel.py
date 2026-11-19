# -*- coding: utf-8 -*-
"""
Білдер розділу «Табелі оснащення» — реєстр наказів МОЗ і повні тексти табелів.

Розділ збирає в одному місці те, чого вимагають специфікації ПМГ: «підрозділ,
обладнаний відповідно до табелю матеріально-технічного оснащення». Табелів багато,
вони різних років і різної будови, тому кожен документ описано в реєстрі, а там,
де вдалося отримати офіційний текст, — розібрано до позицій.

Джерела текстів (знімки в D:\\rpe-pmg\\, у .gitignore; архів — у pmg-data\\0_10_класификатори):
  153  → tabel-153_1998.html   (розбирає окремий build_tabel153.py — HTML-таблиці)
  951  → tabel-951_2010.html   (псевдографічні таблиці)
  158  → tabel-158_2005.html   (HTML-таблиці)
  1103 → tabel-1103_2020.html  (HTML-таблиці; чинна редакція табеля первинки № 148)
  995  → tabel-995_2023.html   (HTML-таблиці; реабілітація, з колонкою «Опис»)

Накази, тексту яких немає у відкритих правових базах (лише moz.gov.ua за Cloudflare),
подано картками реєстру з реквізитами й посиланням на офіційне джерело — без вигаданого
вмісту. Їх видно в реєстрі з позначкою «текст не завантажено».

Правила склейки перенесених слів РІЗНІ для різних наказів — це не помилка, а властивість
набору: у наказі 153 (1998, моноширинний машинопис) дефіс на переносі ДОДАНО, тож його
прибираємо; у наказах 951, 158, 1103 переноси стаються на наявному дефісі складеного
слова («вакуум-аспірація», «наркозно-дихальний»), тож дефіс зберігаємо.

Вихід у ./data/tabel:
  registry.json   — реєстр документів, їхні табелі, розділи, лічильники, зв'язок з ПМГ.
  doc_<id>.json   — позиції: [id, назва, кількості[], табель, розділ, підрозділ, статус, опис].
"""
import json, re, sys, time
from pathlib import Path
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
DATA = BASE / "data" / "tabel"
DATA.mkdir(parents=True, exist_ok=True)
SRC = Path(r"D:\rpe-pmg")
# Першоджерело шукаємо на полиці класифікаторів (pmg-data\0_10_класификатори), далі — там,
# куди 03.09.2026 винесли знімки з теки деплою, і лише потім за старим шляхом у D:\rpe-pmg.
# УВАГА: якщо файла немає ніде, документ лишається без тексту (has_text = False) — тому
# перелік шляхів має бути повним, а після збірки звірка порівнює числа позицій.
SHELF = BASE.parent.parent / "0_10_класификатори"
MOVED = BASE.parent.parent / "99_Проблемні_файли" / "_з_rpe-pmg_2026-09-03"
SHELF_NAMES = {
    "tabel-951_2010.html": "nakaz-951_2010_tabeli-akush-ginek.html",
    "tabel-158_2005.html": "nakaz-158_2005_tabel-stomatolog.html",
    "tabel-1103_2020.html": "nakaz-148-1103_2020_tabel-pervynka.html",
    "tabel-995_2023.html": "nakaz-995_2023_tabel-reabilitaciya.html",
}


def src_path(name):
    for p in (SHELF / SHELF_NAMES.get(name, name), MOVED / name, SRC / name):
        if p.exists():
            return p
    return SRC / name
OLD153 = BASE / "data" / "tabel153"

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

# ══════════════════════════════════════════════════════════════
# Реєстр документів
# ══════════════════════════════════════════════════════════════
DOCS = [
    {
        "id": "153", "number": "153", "date": "05.06.1998", "authority": "МОЗ України",
        "short": "Табелі оснащення виробами медичного призначення",
        "title": "Про затвердження табелів оснащення виробами медичного призначення "
                 "структурних підрозділів закладів охорони здоров'я",
        "profile": "Кабінети поліклінік і стаціонарні відділення лікарень — 53 профілі",
        "edition": "у редакції від 04.11.2010",
        "url": "https://zakon.rada.gov.ua/laws/show/v0153282-98",
        "status": "чинний", "kind": "табель",
        "rada_id": "v0153282-98", "text_revision": "04.11.2010",
        "amendments": [
            {"number": "158", "date": "11.04.2005",
             "effect": "розділ XI «Стоматологія» Додатка 1 втратив чинність"},
            {"number": "951", "date": "04.11.2010",
             "effect": "виключено акушерсько-гінекологічні позиції в Додатках 1 і 2"},
            {"number": "2650", "date": "23.12.2019", "missing": True,
             "effect": "виключено пункти 1-28 розділу XXIII «Трансплантація нирки» Додатка 2 "
                       "(у базі «Законодавство України» цієї зміни немає; текст наказу — на сайті МОЗ)"},
        ],
        "parser": "convert153",
    },
    {
        "id": "951", "number": "951", "date": "04.11.2010", "authority": "МОЗ України",
        "short": "Примірні табелі — акушерсько-гінекологічна допомога",
        "title": "Про затвердження Примірних табелів оснащення обладнанням, медичною технікою "
                 "та виробами медичного призначення (акушерсько-гінекологічна допомога)",
        "profile": "ФАП, жіноча консультація, пологовий будинок, перинатальний центр, "
                   "гінекологічні відділення, виїзна бригада",
        "edition": "редакція прийняття від 04.11.2010",
        "url": "https://zakon.rada.gov.ua/laws/show/v0951282-10",
        "status": "чинний", "kind": "примірний табель",
        "rada_id": "v0951282-10", "text_revision": "04.11.2010",
        "amendments": [
            {"number": "904", "date": "16.05.2023", "missing": True,
             "effect": "додано позицію «Крісло гінекологічне (для осіб з інвалідністю)» у табелі "
                       "акушерського, гінекологічного відділення, гінекологічного відділення, жіночої "
                       "консультації, пологового будинку та перинатального центру"},
        ],
        "parser": "ascii", "src": "tabel-951_2010.html",
    },
    {
        "id": "158", "number": "158", "date": "11.04.2005", "authority": "МОЗ України",
        "short": "Табель — робоче місце лікаря-стоматолога та зубного техніка",
        "title": "Про затвердження табеля оснащення обладнанням одного робочого місця "
                 "лікаря-стоматолога та зубного техніка",
        "profile": "Стоматологічний кабінет, зуботехнічна лабораторія",
        "edition": "редакція прийняття від 11.04.2005",
        "url": "https://zakon.rada.gov.ua/laws/show/v0158282-05",
        "status": "чинний", "kind": "табель",
        "rada_id": "v0158282-05", "text_revision": "11.04.2005",
        "amendments": [
            {"number": "439", "date": "07.03.2023", "missing": True,
             "effect": "у розділі 3 для пунктів 8 і 10 кількість замінено умовою «за наявності "
                       "кабінету для стерилізації медичних виробів»"},
        ],
        "parser": "html", "src": "tabel-158_2005.html", "hyphen": "drop",
    },
    {
        "id": "148", "number": "148", "date": "26.01.2018", "authority": "МОЗ України",
        "short": "Примірний табель — первинна медична допомога",
        "title": "Про затвердження Примірного табеля матеріально-технічного оснащення закладів "
                 "охорони здоров'я та фізичних осіб — підприємців, які надають первинну медичну допомогу",
        "profile": "Заклади та ФОП первинної медичної допомоги, амбулаторії, ФАП",
        "edition": "у редакції наказу МОЗ від 08.05.2020 № 1103",
        "url": "https://zakon.rada.gov.ua/laws/show/v0148282-18",
        "status": "чинний", "kind": "примірний табель",
        "rada_id": "v0148282-18", "text_revision": "08.05.2020",
        "amendments": [
            {"number": "2857", "date": "10.12.2020", "missing": True,
             "effect": "Примірний табель викладено в новій редакції"},
            {"number": "233", "date": "10.02.2023", "missing": True,
             "effect": "змінено пункти 1 і 3 розділу I; додано розділ IV «Додатковий список для "
                       "домашніх візитів» (пункти 56-65)"},
            {"number": "20", "date": "04.01.2024", "missing": True,
             "effect": "розділ II доповнено набором камертонів медичних і плантографом"},
            {"number": "1746", "date": "19.11.2025", "missing": True,
             "effect": "замість отоофтальмоскопа — окремо отоскоп і офтальмоскоп (пункти 9 і 10); "
                       "пункт 53 про набір цифрових «скопічних» систем у новій редакції; пункти перенумеровано"},
        ],
        "parser": "html", "src": "tabel-1103_2020.html", "hyphen": "drop",
    },
    {
        "id": "995", "number": "995", "date": "31.05.2023", "authority": "МОЗ України",
        "short": "Примірний табель — стаціонарна реабілітація дорослих",
        "title": "Про затвердження Примірного табелю матеріально-технічного оснащення стаціонарних "
                 "реабілітаційних відділень, підрозділів закладів охорони здоров'я, які надають "
                 "реабілітаційну допомогу дорослим у післягострому реабілітаційному періоді",
        "profile": "Стаціонарні реабілітаційні відділення для дорослих: стаціонар, зали фізичної "
                   "терапії та ерготерапії, кабінети терапії мови й мовлення",
        "edition": "текст у редакції прийняття від 31.05.2023",
        "url": "https://zakon.rada.gov.ua/rada/show/v0995282-23",
        "status": "чинний", "kind": "примірний табель",
        "rada_id": "v0995282-23", "text_revision": "31.05.2023",
        "amendments": [
            {"number": "1309", "date": "26.07.2024",
             "effect": "додано примірні табелі для амбулаторних і стаціонарних реабілітаційних "
                       "відділень для дітей до трьох років і дітей від трьох років"},
            {"number": "1451", "date": "18.09.2025",
             "effect": "оновлено примірний табель кабінетів для реабілітаційної допомоги "
                       "в амбулаторних умовах"},
        ],
        "edition_note": "У базі «Законодавство України» цей акт наведено в редакції прийняття, "
                        "тож нижче — базовий табель 2023 року. Зміни наказами № 1309 і № 1451 "
                        "додають ОКРЕМІ табелі (для дітей та для амбулаторних кабінетів), їхні "
                        "тексти є лише на сайті МОЗ.",
        "parser": "html", "src": "tabel-995_2023.html",
    },
    # ── Накази, текст яких доступний лише на moz.gov.ua ────────────────
    {
        "id": "2650", "number": "2650", "date": "23.12.2019", "authority": "МОЗ України",
        "short": "Примірні табелі — трансплантація",
        "title": "Про затвердження примірних табелів матеріально-технічного оснащення закладів "
                 "охорони здоров'я, їх відокремлених підрозділів, які надають медичну допомогу "
                 "із застосуванням трансплантації, та внесення змін до додатка 2 до наказу "
                 "Міністерства охорони здоров'я України від 05 червня 1998 року № 153",
        "profile": "ЗОЗ, де здійснюють трансплантацію органів; бригади вилучення анатомічних "
                   "матеріалів (органів і тканин)",
        "edition": "редакція прийняття від 23.12.2019", "status": "чинний", "kind": "примірний табель",
        "manual_check": {"date": "2026-11-19",
                         "note": "Наказ опубліковано на сайті МОЗ. На сторінці наказу немає позначок "
                                 "про зміни чи скасування. У базі «Законодавство України» наказу немає."},
        "url": "https://moz.gov.ua/uk/decrees/nakaz-moz-ukraini-vid-23122019--2650-pro-zatverdzhennja-"
               "primirnih-tabeliv-materialno-tehnichnogo-osnaschennja-zakladiv-ohoroni-zdorov%E2%80%99ja-"
               "ih-vidokremlenih-pidrozdiliv-jaki-nadajut-medichnu-dopomogu-iz-zastosuvannjam-transplantacii",
        "parser": None,
    },
    {
        "id": "751", "number": "751", "date": "01.05.2024", "authority": "МОЗ України",
        # УВАГА: це наказ № 751 від 01.05.2024. Скасований наказ № 751 від 28.09.2012 (про
        # медико-технологічні документи) — інший акт, тезка за номером.
        "short": "Примірний табель — амбулаторна допомога із загальним знеболенням та/або седацією",
        "title": "Про затвердження Примірного табелю матеріально-технічного оснащення підрозділів "
                 "закладів охорони здоров'я, що надають медичну допомогу в амбулаторних умовах "
                 "із застосуванням методів загального знеболення та/або седації",
        "profile": "Підрозділи ЗОЗ, що надають амбулаторну допомогу із застосуванням загального "
                   "знеболення та/або седації",
        "edition": "редакція прийняття від 01.05.2024", "status": "чинний", "kind": "примірний табель",
        "manual_check": {"date": "2026-11-19",
                         "note": "Наказ опубліковано на сайті МОЗ. На сторінці наказу немає позначок "
                                 "про зміни чи скасування. У базі «Законодавство України» наказу немає."},
        "url": "https://moz.gov.ua/uk/decrees/nakaz-moz-ukraini-vid-01052024-751-pro-zatverdzhennja-"
               "primirnogo-tabelju-materialno-tehnichnogo-osnaschennja-pidrozdiliv-zakladiv-ohoroni-zdorov%E2%80%99ja",
        "parser": None,
    },
    {
        "id": "164", "number": "164", "date": "10.02.2026", "authority": "МОЗ України",
        "short": "Примірні табелі — гострий мозковий інсульт та інтервенційна нейрорадіологія",
        "title": "Про затвердження Примірного табелю матеріально-технічного оснащення структурних "
                 "підрозділів закладів охорони здоров'я, які надають стаціонарну допомогу пацієнтам "
                 "із гострим мозковим інсультом та Примірного табелю матеріально-технічного оснащення "
                 "відділення/блоку інтервенційної нейрорадіології закладів охорони здоров'я",
        "profile": "Підрозділи стаціонарної допомоги при гострому мозковому інсульті; відділення "
                   "або блок інтервенційної нейрорадіології",
        "edition": "редакція прийняття від 10.02.2026", "status": "чинний", "kind": "примірний табель",
        "manual_check": {"date": "2026-11-19",
                         "note": "Наказ опубліковано на сайті МОЗ. На сторінці наказу немає позначок "
                                 "про зміни чи скасування. У базі «Законодавство України» наказу немає."},
        "url": "https://moz.gov.ua/uk/decrees/nakaz-moz-ukrayini-vid-10-02-2026-164-pro-zatverdzhennya-"
               "primirnogo-tabelyu-materialno-tehnichnogo-osnashennya-strukturnih-pidrozdiliv-zakladiv-"
               "ohoroni-zdorov-ya-yaki-nadayut-stacionarnu-dopomogu-paciyentam-iz-gostrim-mozkovim",
        "parser": None,
    },
    {
        "id": "93", "number": "93", "date": "26.01.2026", "authority": "МОЗ України",
        "short": "Примірні табелі — кабінет інтервенційного менеджменту болю",
        "title": "Про затвердження примірних табелів матеріально-технічного оснащення закладів "
                 "охорони здоров'я для функціонування кабінету інтервенційного менеджменту болю "
                 "для кластерних та надкластерних закладів охорони здоров'я",
        "profile": "Кабінет інтервенційного менеджменту болю кластерного та надкластерного закладу",
        "edition": "редакція прийняття від 26.01.2026", "status": "чинний", "kind": "примірний табель",
        "manual_check": {"date": "2026-11-19",
                         "note": "Наказ опубліковано на сайті МОЗ. На сторінці наказу немає позначок "
                                 "про зміни чи скасування. У базі «Законодавство України» наказу немає."},
        "url": "https://moz.gov.ua/uk/decrees/nakaz-moz-ukrayini-vid-26-01-2026-93-pro-zatverdzhennya-"
               "primirnih-tabeliv-materialno-tehnichnogo-osnashennya-zakladiv-ohoroni-zdorov-ya-dlya-"
               "funkcionuvannya-kabinetu-intervencijnogo-menedzhmentu-bolyu",
        "parser": None,
    },
]

# ══════════════════════════════════════════════════════════════
# Спільне
# ══════════════════════════════════════════════════════════════
def html_blocks(html):
    for m in re.finditer(r'<div class="(d_\w+)">(.*?)</div>|<table[^>]*>.*?</table>', html, re.S):
        if m.group(1):
            yield m.group(1), m.group(2)
        else:
            yield "table", m.group(0)

def plain(s):
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return (s.replace("&#39;", "'").replace("&#34;", '"')
             .replace("&nbsp;", " ").replace("&amp;", "&"))

def one_line(s, drop_hyphen=False):
    t = re.sub(r"\s+", " ", plain(s)).strip()
    if drop_hyphen:
        # у наказах 158 і 1103 перенос усередині комірки лишає доданий дефіс:
        # «Хірур- гічний» → «Хірургічний»; підвісний дефіс перед сполучником зберігаємо
        t = re.sub(r"(\w)-\s+(?!(?:та|і|й|чи|або)\b)(?=[а-яіїєґa-z])", r"\1", t)
    return t

NUM = re.compile(r"^(\d+)[.)]?$")
# заголовок розділу всередині таблиці: «I. Стаціонар», «2. Кабінет…»
SECT_HEAD = re.compile(r"^([IVXL]+|\d+)\.\s+\S")
CELL = re.compile(r"<t[dh]([^>]*)>(.*?)</t[dh]>", re.S | re.I)   # у дзеркалі трапляється <TD>
ROW = re.compile(r"<tr.*?</tr>", re.S | re.I)

DROP_HYPHEN = False          # вмикається для документів із машинописним переносом

def cells_of(row_html):
    return [one_line(c, DROP_HYPHEN) for _, c in CELL.findall(row_html)]

def is_numbering(cells):
    """Рядок «1 | 2 | 3 | 4» — нумерація колонок, а не дані."""
    vals = [c for c in cells if c]
    if len(vals) < 3 or not all(re.fullmatch(r"\d{1,2}", v) for v in vals):
        return False
    nums = [int(v) for v in vals]
    return nums == list(range(nums[0], nums[0] + len(nums)))

def header_grid(header_rows):
    """Плоскі підписи колонок із шапки, що містить colspan/rowspan."""
    grid, width = {}, 0
    for r, row_html in enumerate(header_rows):
        c = 0
        for attrs, content in CELL.findall(row_html):
            while (r, c) in grid:
                c += 1
            def span(name):
                m = re.search(name + r'\s*=\s*"?(\d+)', attrs, re.I)
                return int(m.group(1)) if m else 1
            cs, rs = span("colspan"), span("rowspan")
            txt = one_line(content, DROP_HYPHEN)
            for dr in range(rs):
                for dc in range(cs):
                    grid[(r + dr, c + dc)] = txt
            c += cs
            width = max(width, c)
    cols = []
    for c in range(width):
        parts = []
        for r in range(len(header_rows)):
            t = grid.get((r, c), "")
            if t and (not parts or parts[-1] != t):
                parts.append(t)
        cols.append(" · ".join(parts))
    return cols

def short_section(title, fallback=""):
    """Довгу назву табеля робимо придатною для підпису розділу."""
    t = re.sub(r"^\s*\d\.\d\.\s*", "", title or "")
    t = re.sub(r"^(ПРИМІРНИЙ ТАБЕЛЬ|Примірний табель|ТАБЕЛЬ|Табель)\s+", "", t)
    t = re.sub(r"^оснащення\s+", "", t, flags=re.I)
    # канцелярський зачин трапляється в різному порядку («медичною технікою, обладнанням
    # та виробами медичного призначення»), тож зрізаємо по колу, доки щось зрізається
    chunks = ("обладнанням", "медичною технікою", "виробами медичного призначення",
              "матеріально-технічного", "оснащення")
    changed = True
    while changed:
        changed = False
        for chunk in chunks:
            new = re.sub(r"^(та\s+|,\s*)?" + chunk + r"[,\s]*", "", t, flags=re.I)
            if new != t:
                t, changed = new, True
    t = t.strip(" ,;—-")
    return (t[:1].upper() + t[1:]) if t else (fallback or title)

# ══════════════════════════════════════════════════════════════
# Парсер А: псевдографічні таблиці (наказ 951)
# ══════════════════════════════════════════════════════════════
def parse_ascii(html, doc):
    """Таблиці намальовано символами | та -, слова переносяться на наявному дефісі."""
    tables, items = [], []
    cur_tit, cur_roz = "", ""
    tbl = None
    row = None
    hyph = Counter()

    def join(a, b):
        if not a:
            return b
        if a.endswith("-"):                      # перенос на складеному слові
            hyph[a.split()[-1]] += 1
            return a + b
        return a + " " + b

    def flush_row():
        nonlocal row
        if row and row["name"]:
            tbl["rows"].append(row)
        row = None

    def flush_table():
        nonlocal tbl
        if tbl:
            flush_row()
            if tbl["rows"]:
                tables.append(tbl)
        tbl = None

    for cls, raw in html_blocks(html):
        text = plain(raw)
        if cls == "d_tit":
            t = one_line(raw)
            if re.match(r"^\d\.\d\.", t):
                flush_table()
                cur_tit, cur_roz = t, ""
            elif cur_tit:
                cur_tit = (cur_tit + " " + t).strip()
            continue
        if cls in ("d_roz", "d_cen"):
            t = one_line(raw)
            if t and len(t) < 200 and not t.startswith("ЗАТВЕРДЖЕНО"):
                flush_table()
                cur_roz = t
            continue
        if cls != "d_bla":
            continue
        for line in text.split("\n"):
            bare = line.strip()
            if not bare:
                continue
            if set(bare) <= set("-") and len(bare) > 10:
                if tbl is None:
                    tbl = {"tit": cur_tit, "roz": cur_roz, "header": [], "rows": []}
                else:
                    flush_table()
                continue
            if not bare.startswith("|"):
                continue
            if tbl is None:
                tbl = {"tit": cur_tit, "roz": cur_roz, "header": [], "rows": []}
            cells = bare.strip("|").split("|")
            if all(set(c.strip()) <= set("-+") for c in cells):
                flush_row()
                continue
            head = cells[0].strip()
            if NUM.match(head):
                flush_row()
                row = {"no": NUM.match(head).group(1),
                       "name": cells[1].strip() if len(cells) > 1 else "",
                       "qty": [c.strip() for c in cells[2:]]}
            elif row is not None:
                if len(cells) > 1 and cells[1].strip():
                    row["name"] = join(row["name"], cells[1].strip())
                for i, c in enumerate(cells[2:]):
                    if c.strip():
                        if i < len(row["qty"]):
                            row["qty"][i] = join(row["qty"][i], c.strip())
                        else:
                            row["qty"].append(c.strip())
            else:
                tbl["header"].append([c.strip() for c in cells])
    flush_table()
    log(f"  {doc['id']}: псевдографіка — таблиць {len(tables)}, склейок на дефісі {sum(hyph.values())}")
    return assemble(tables, doc)

# ══════════════════════════════════════════════════════════════
# Парсер Б: звичайні HTML-таблиці (накази 158, 148/1103)
# ══════════════════════════════════════════════════════════════
def parse_html(html, doc):
    global DROP_HYPHEN
    DROP_HYPHEN = doc.get("hyphen") == "drop"
    tables = []
    cur_tit, cur_roz = "", ""
    for cls, raw in html_blocks(html):
        if cls in ("d_tit", "d_cen", "d_roz", "d_par"):
            t = one_line(raw)
            if not t or t.startswith("ЗАТВЕРДЖЕНО") or len(t) > 220:
                continue
            if cls == "d_tit":
                cur_tit = t if not cur_tit or len(t) > 25 else (cur_tit + " " + t)
                cur_roz = ""
            elif cls in ("d_roz", "d_cen"):
                cur_roz = t
            elif re.match(r"^[IVX]+\.\s+\S", t) or re.match(r"^Додаток \d", t):
                cur_roz = t
            continue
        if cls != "table":
            continue
        rows = ROW.findall(raw)
        if len(rows) < 3:
            continue
        parsed, header_rows, roz = [], [], cur_roz
        cols = None

        def flush(rows_acc, roz_title):
            if rows_acc:
                tables.append({"tit": cur_tit, "roz": roz_title,
                               "cols": cols if cols is not None else header_grid(header_rows),
                               "rows": rows_acc})

        for r in rows:
            cells = cells_of(r)
            if not cells or not any(cells) or is_numbering(cells):
                continue
            head = cells[0]
            filled = [c for c in cells if c]
            if NUM.match(head):
                parsed.append({"no": NUM.match(head).group(1),
                               "name": cells[1] if len(cells) > 1 else "",
                               "qty": cells[2:]})
            elif len(filled) == 1 and len(filled[0]) < 160 and SECT_HEAD.match(filled[0]):
                # однокомірковий рядок усередині таблиці — заголовок розділу
                # («I. Стаціонар», «II. Приміщення для проведення фізичної терапії»).
                # Якщо він стоїть ПЕРЕД шапкою (наказ 148), лише запам'ятовуємо назву:
                # шапку ще не прочитано, тож підписи колонок фіксувати рано.
                if parsed:
                    if cols is None:
                        cols = header_grid(header_rows)
                    flush(parsed, roz)
                    parsed = []
                roz = filled[0]
            elif not parsed:                       # шапка (може бути кількарівнева)
                header_rows.append(r)
        if cols is None:
            cols = header_grid(header_rows)
        flush(parsed, roz)
    log(f"  {doc['id']}: HTML-таблиць {len(tables)}")
    return assemble(tables, doc)

# ══════════════════════════════════════════════════════════════
# Складання документа у спільний формат
# ══════════════════════════════════════════════════════════════
def qty_labels(t, ncols):
    """Підписи колонок кількості: хвіст шапки завдовжки з кількість колонок даних."""
    cols = t.get("cols")
    if not cols:                                   # псевдографіка: шапка рядками
        cols = []
        for lvl in t.get("header", []):
            for i, c in enumerate(lvl[2:]):
                while len(cols) <= i:
                    cols.append("")
                if c and not re.fullmatch(r"\d+", c):
                    cols[i] = (cols[i] + " " + c).strip()
    cols = [c for c in cols if c]
    tail = cols[-ncols:] if ncols and len(cols) >= ncols else cols
    tail = [c or "Кількість" for c in tail]
    if ncols and len(tail) < ncols:
        tail += ["Кількість"] * (ncols - len(tail))
    return tail or ["Кількість"]

def assemble(tables, doc):
    """tables → {tables: [...], items: [...]} у форматі розділу."""
    out_tables, items = [], []
    groups, seen_titles = {}, Counter()
    for t in tables:
        tit = t["tit"] or doc["short"]
        g = groups.get(tit)
        if not g:
            g = {"id": str(len(out_tables) + 1), "title": tit,
                 "short": short_section(tit, doc["short"]), "sections": []}
            out_tables.append(g)
            groups[tit] = g
        ncols = max((len(r["qty"]) for r in t["rows"]), default=1)
        # назва розділу: своя, якщо є; інакше — коротка назва самого табеля
        title = t["roz"] or short_section(tit, doc["short"])
        seen_titles[(g["id"], title)] += 1
        n = seen_titles[(g["id"], title)]
        if n > 1:
            title = f"{title} · частина {n}"
        labels = qty_labels(t, ncols)
        # остання колонка на кшталт «Опис» / «Примітка» — це не кількість, а вимога до виробу
        note_col = None
        if labels and re.match(r"(опис|приміт|характерист)", labels[-1], re.I):
            note_col = ncols - 1
            labels = labels[:-1] or ["Кількість"]
        sec = {"id": f'{g["id"]}-{len(g["sections"]) + 1}',
               "title": title, "count": len(t["rows"]),
               "qty_labels": labels, "notes": [], "excluded": 0}
        g["sections"].append(sec)
        for r in t["rows"]:
            qty, note = list(r["qty"]), ""
            if note_col is not None and len(qty) > note_col:
                note = qty.pop(note_col)
            # наскрізний номер: у підтаблицях нумерація починається заново, тож
            # «документ-розділ-номер» не був би унікальним
            items.append([f'{doc["id"]}-{len(items) + 1}', r["name"], qty,
                          g["id"], sec["id"], "", "", note])
    return out_tables, items

# ══════════════════════════════════════════════════════════════
# Наказ 153 — переклад із формату build_tabel153.py
# ══════════════════════════════════════════════════════════════
def convert_153(doc):
    meta = json.loads((OLD153 / "tabel153_meta.json").read_text(encoding="utf-8"))
    idx = json.loads((OLD153 / "tabel153_index.json").read_text(encoding="utf-8"))
    tables, items = [], []
    for a in meta["appendices"]:
        g = {"id": str(a["no"]),
             "title": f'Додаток {a["no"]} · ' + ("кабінети амбулаторно-поліклінічних закладів"
                                                if a["no"] == 1 else "стаціонарні відділення лікарень"),
             "sections": []}
        for s in a["sections"]:
            # римські номери повторюються в обох додатках, тож ідентифікатор — «додаток-номер»
            g["sections"].append({
                "id": f'{a["no"]}-{s["roman"]}', "title": f'{s["roman"]}. {s["title"]}',
                "count": s["count"], "excluded": s.get("excluded", 0),
                "qty_labels": s.get("qty_labels") or ["Кількість"],
                "qty_group": s.get("qty_group"), "beds": s.get("beds", ""),
                "notes": s.get("notes", []), "status": s.get("status"),
            })
        tables.append(g)
    for r in idx:
        items.append([f'153-{len(items) + 1}', r[1], r[2],
                      str(r[3]), f'{r[3]}-{r[4]}', r[5], r[6], ""])
    log(f"  153: перенесено {len(items)} позицій із tabel153")
    return tables, items

# ══════════════════════════════════════════════════════════════
def pmg_bridge():
    try:
        # специфікації — з джерела сайту, не з теки деплою
        pk = json.loads((BASE.parent / "pakety" / "data" / "packages_2026.json").read_text(encoding="utf-8"))["packages"]
        pkgs = [{"no": str(p.get("number", "")).strip(), "title": (p.get("title") or "").strip()}
                for p in pk if re.search(r"табел", json.dumps(p, ensure_ascii=False), re.I)]
        log(f"пакетів ПМГ-2026 з вимогою про табель: {len(pkgs)} з {len(pk)}")
        return pkgs
    except Exception as ex:
        log(f"WARN: пакети ПМГ не звірено: {ex}")
        return []

def ua(iso):
    """2026-11-19 → 19.11.2026"""
    p = str(iso or "").split("-")
    return ".".join(reversed(p)) if len(p) == 3 else str(iso or "")


def apply_status(entry, doc, status):
    """Статус, редакція й дата звірки — зі status.json (пише tools/tabel_status.py).

    УРОК 19.11.2026: «чинний» і «чинна редакція» стояли тут рядками, вписаними 28.07.2026.
    Звірка з першоджерелом показала, що тексти чотирьох табелів із п'яти відстали від
    чинних редакцій (№ 148 — на чотири редакції), а портал про це мовчав. Тепер:
      * чинність і поточна редакція — лише зі status.json;
      * якщо текст на порталі не відповідає поточній редакції, документ позначається
        `stale`, а що саме не враховано — видно на сторінці й у звірці джерел.
    """
    for k in ("rada_id", "text_revision", "manual_check"):
        entry.pop(k, None)
    st = (status.get("docs") or {}).get(doc["id"])
    if not st:
        entry.update({"status": "не звірено", "checked": "", "stale": False})
        return
    entry["checked"] = ua(st.get("checked"))
    entry["check_source"] = ("база «Законодавство України»" if st.get("source") == "zakon.rada.gov.ua"
                             else "сайт МОЗ, переглянуто вручну")
    entry["status"] = "втратив чинність" if st.get("lost_force") else "чинний"
    missing = [a for a in doc.get("amendments", []) if a.get("missing")]
    cur, text_rev = st.get("current_revision"), doc.get("text_revision")
    # редакція, якої немає серед описаних змін, — нова зміна, про яку портал ще не знає
    known = {a["date"] for a in doc.get("amendments", [])} | {text_rev, st.get("adopted")}
    unknown = [r for r in st.get("revisions", []) if r["date"] not in known]
    if cur and text_rev:
        entry["current_revision"] = cur
    entry["stale"] = bool(missing or unknown)
    if entry["stale"]:
        parts = [f"№ {a['number']} від {a['date']} — {a['effect']}" for a in missing]
        parts += [f"редакція від {r['date']} (підстава {r['basis']}) — зміст ще не описано" for r in unknown]
        was = doc.get("edition", "")
        entry["edition"] = (f"текст на порталі — {was}" + (f"; чинна редакція — від {cur}" if cur and cur != text_rev else ""))
        entry["edition_note"] = ("Текст табеля на порталі відстає від чинної редакції. Не враховано: "
                                 + "; ".join(parts) + ". Чинний текст — за посиланням «Офіційне джерело»."
                                 + (" " + doc["edition_note"] if doc.get("edition_note") else ""))
    for a in entry.get("amendments", []):
        if a.get("missing"):
            a["effect"] += " — у тексті на порталі НЕ враховано"


def main():
    status_path = DATA / "status.json"
    status = json.loads(status_path.read_text(encoding="utf-8")) if status_path.exists() else {}
    if not status:
        log("УВАГА: немає data/tabel/status.json — запустіть python tools/tabel_status.py")
    registry = {
        "generated": time.strftime("%Y-%m-%d"),
        "pmg": {
            "packages": pmg_bridge(),
            "requirement": "Специфікації ПМГ-2026 вимагають, щоб підрозділи були «обладнані "
                           "відповідно до табелю матеріально-технічного оснащення» — це критична "
                           "умова закупівлі.",
            "contract": "Пункт 19 договору про медичне обслуговування населення (підпункти 3, 13, "
                        "28, 36): надавач зобов'язується дотримуватися вимог законодавства, зокрема "
                        "порядків надання медичної допомоги та табелів матеріально-технічного "
                        "оснащення, у тому числі примірних.",
            "caveat": "Наказ № 153 — базовий табель щодо виробів медичного призначення; примірні "
                      "табелі матеріально-технічного оснащення доповнюють його за профілями. "
                      "Специфікації ПМГ посилаються на табелі загалом, не називаючи конкретного наказу.",
        },
        "docs": [],
        "schema_items": ["id", "name", "qtys[]", "table", "section", "sub", "status", "note"],
    }

    for doc in DOCS:
        entry = json.loads(json.dumps({k: v for k, v in doc.items() if k not in ("parser", "src")}))
        apply_status(entry, doc, status)
        parser = doc.get("parser")
        if not parser:
            entry.update({"has_text": False, "tables": [], "total": 0,
                          "text_note": "Повний текст доступний лише на офіційному сайті МОЗ — "
                                       "картку наведено з реквізитами й посиланням."})
            registry["docs"].append(entry)
            continue

        if parser == "convert153":
            tables, items = convert_153(doc)
        else:
            path = src_path(doc["src"])
            if not path.exists():
                log(f"  {doc['id']}: НЕМАЄ ФАЙЛУ {path} — пропускаю")
                entry.update({"has_text": False, "tables": [], "total": 0,
                              "text_note": "Текст не завантажено."})
                registry["docs"].append(entry)
                continue
            html = path.read_text(encoding="utf-8", errors="replace")
            tables, items = (parse_ascii if parser == "ascii" else parse_html)(html, doc)

        (DATA / f'doc_{doc["id"]}.json').write_text(
            json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        entry.update({
            "has_text": True, "tables": tables, "total": len(items),
            "sections": sum(len(t["sections"]) for t in tables),
            "file": f'doc_{doc["id"]}.json',
        })
        registry["docs"].append(entry)
        log(f"  {doc['id']}: табелів {len(tables)}, розділів "
            f'{sum(len(t["sections"]) for t in tables)}, позицій {len(items)}')

    (DATA / "registry.json").write_text(
        json.dumps(registry, ensure_ascii=False, indent=1), encoding="utf-8")
    with_text = [d for d in registry["docs"] if d.get("has_text")]
    log(f"готово: документів {len(registry['docs'])} (з текстом {len(with_text)}), "
        f"позицій разом {sum(d['total'] for d in with_text)}")

if __name__ == "__main__":
    main()
