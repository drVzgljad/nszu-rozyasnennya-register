# -*- coding: utf-8 -*-
"""
Білдер розділу «Спеціальності та посади» для НавігаторПМГ26.

Дає відповідь на питання, яке досі не мало джерела на порталі: за якою
спеціальністю заклад має право працювати і яку посаду він може ввести
у штатний розпис. Це дві різні осі, і після ПКМУ № 813 вони пов'язані
жорстко — п. 32 Ліцензійних умов забороняє посади поза Переліком МОЗ.

ДЖЕРЕЛА (стягує 0_10_класификатори/спеціальності/fetch_sources.py)
------------------------------------------------------------------
  1. Додаток 7 до Ліцензійних умов у редакції ПКМУ від 24.06.2026 № 813 —
     172 спеціальності в чотирьох розділах. Постанова опублікована
     01.07.2026 (Урядовий кур'єр № 137), НАБИРАЄ ЧИННОСТІ 01.09.2026.
     На день збірки чинний ще старий Додаток 7 (у ред. ПКМУ № 781).
  2. Наказ МОЗ від 05.07.2025 № 1065 (z1109-25, зареєстрований у Мін'юсті
     23.07.2025 за № 1109/44515) — Перелік професій (посад) працівників
     сфери охорони здоров'я, розділ 1 (базові посади) і розділ 2 (посади
     за профілями роботи). Чинний, редакція 26.06.2026 за z0783-26.
  3. Блок «Спеціалісти» специфікацій пакетів ПМГ-2026 —
     pakety/data/packages_2026.json. Дає «спеціальність/посада → пакети».
  4. ДКХП, випуск 78 — data/posady/*.json, уже зібране розділом «Посади».
     Дає місток до кваліфікаційних характеристик.

ПАСТКИ (набиті 10.08.2026)
--------------------------
  1. ТАБЛИЦІ ДОДАТКА 7 НЕМАЄ В ТЕКСТІ НА RADA. Ні в ПКМУ 285, ні в ПКМУ 813
     HTML не містить переліку — після заголовка «ПЕРЕЛІК …» одразу йде
     наступний пункт. У корпусі rentgen вузол Додатка 7 має 366 символів.
     Таблиця живе тільки в сигнальному DOCX, прикріпленому до картки акта
     (f555263n63.docx). Тому джерело — DOCX, і при оновленні акта треба
     перевіряти саме наявність файла, а не довжину сторінки.
  2. Наказ 1065 у /print віддає нормальні <table>, АЛЕ з rowspan: колонка
     «професійні кваліфікації» об'єднана на 7 рядків поспіль. Без обробки
     rowspan рядки зсуваються і посаді приписується чужа кваліфікація.
  3. Виноски в наказі 1065 приходять як «- 1», «- 4» у кінці назви посади
     («Медичний директор - 1»). Це не частина назви — знімаємо в notes.
  4. Спеціальність ≠ посада, і офіційного зіставлення між ними НЕ ІСНУЄ.
     Місток обчислено за морфологією назв і має чотири рівні певності —
     див. MATCH_LEVELS. Рівень видно в інтерфейсі; те, що не зійшлося,
     показано списком, а не сховано.
  5. У Додатку 7 та сама назва трапляється у двох розділах (23 випадки:
     «Хірургія» і як лікарська, і як спеціальність фахівця). Таблиця не має
     ідентифікаторів, тому id збираємо з розділу і назви, інакше рядки
     злипаються.

ВИХІД у ./data/spec:
  spec_meta.json   — джерела, підсумки, рівні збігу, знайдені вади
  spec_index.json  — легкий список обох реєстрів для пошуку й дерева
  spec_cards.json  — паспорти (спеціальність і посада), лениве вантаження
  spec_pkg.json    — кадрові вимоги пакетів ПМГ-2026 і що з них зійшлося
"""
import html
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import pkg_staff  # спільний розбір блоку «Спеціалісти» специфікацій пакетів

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
DATA = BASE / "data" / "spec"
DATA.mkdir(parents=True, exist_ok=True)

SRC = Path(r"D:\pmg-data\0_10_класификатори\спеціальності")
DOCX_813 = SRC / "813-2026-p.docx"
HTML_1065 = SRC / "z1109-25.html"
SOURCES_JSON = SRC / "sources.json"
PKG_JSON = BASE.parent / "pakety" / "data" / "packages_2026.json"
POSADY_DIR = BASE / "data" / "posady"

SEC_CODE = {"І": "likar", "ІІ": "fahivec", "ІІІ": "profesional", "ІV": "farm"}
SEC_SHORT = {
    "likar": "Лікарські спеціальності",
    "fahivec": "Спеціальності фахівців у сфері охорони здоров'я",
    "profesional": "Спеціальності професіоналів у сфері охорони здоров'я",
    "farm": "Фармацевтичні спеціальності",
}

MATCH_LEVELS = {
    "exact": "назви збігаються дослівно",
    "root": "збіг за коренем назви (Алергологія → лікар-алерголог)",
    "morph": "збіг за основами всіх значущих слів",
    "manual": "зіставлено вручну (правило морфології не бере)",
}

# Пари, які морфологія не бере: назва посади побудована від іншого кореня,
# ніж назва спеціальності. Ключ — назва спеціальності з Додатка 7 як є.
MANUAL = {
    "Акушерство і гінекологія": ["Лікар-акушер-гінеколог"],
    "Внутрішні хвороби": ["Лікар-терапевт"],
    "Дитячі інфекційні хвороби": ["Лікар-інфекціоніст дитячий"],
    "Інфекційні хвороби": ["Лікар-інфекціоніст"],
    "Дезінфекційна справа": ["Лікар-дезінфекціоніст"],
    "Ендоскопія": ["Лікар-ендоскопіст"],
    "Клінічна лабораторна діагностика": ["Лікар-лаборант"],
    "Лабораторна діагностика, вірусологія, мікробіологія": [
        "Лікар-лаборант", "Лікар-вірусолог", "Лікар-мікробіолог-вірусолог"],
    "Генетика лабораторна": ["Лікар-лаборант-генетик"],
    "Генетика медична": ["Лікар-генетик"],
    "Патологічна анатомія": ["Лікар-патологоанатом"],
    "Дитяча патологічна анатомія": ["Лікар-патологоанатом дитячий"],
    "Професійна патологія": ["Лікар-профпатолог"],
    "Неонатологія": ["Лікар-педіатр-неонатолог"],
    "Онкогінекологія": ["Лікар-гінеколог-онколог"],
    "Онкоотоларингологія": ["Лікар-отоларинголог-онколог"],
    "Онкохірургія": ["Лікар-хірург-онколог"],
    "Клінічна онкологія": ["Лікар-онколог"],
    "Дитяча гематологія-онкологія": ["Лікар-гематолог-онколог дитячий"],
    "Дитяча гінекологія": ["Лікар-гінеколог дитячого та підліткового віку"],
    "Ортодонтія": ["Лікар-стоматолог-ортодонт"],
    "Ортопедична стоматологія": ["Лікар-стоматолог-ортопед"],
    "Пародонтологія": ["Лікар-стоматолог-пародонтолог"],
    "Терапевтична стоматологія": ["Лікар-стоматолог-терапевт"],
    "Хірургічна стоматологія": ["Лікар-стоматолог-хірург"],
    "Ортопедія і травматологія": ["Лікар-ортопед-травматолог"],
    "Дитяча ортопедія і травматологія": ["Лікар-ортопед-травматолог дитячий"],
    "Проктологія": ["Лікар-хірург-проктолог"],
    "Судинна хірургія": ["Лікар-хірург судинний"],
    "Торакальна хірургія": ["Лікар-хірург торакальний"],
    "Щелепно-лицева хірургія": ["Лікар-хірург щелепно-лицевий"],
    "Хірургія серця та магістральних судин": ["Лікар-хірург серцево-судинний"],
    "Суднова медицина": ["Лікар судновий"],
    "Трансплантологія": ["Лікар-трансплантолог"],
    "Трансплант-координація": [
        "Трансплант-координатор, трансплант-координатор патолого-анатомічного "
        "бюро (бюро судово-медичної експертизи)"],
    "Оптометрія": ["Оптометрист"],
    "Протезування-ортезування": ["Протезист-ортезист"],
    "Терапія мови і мовлення": ["Терапевт мови і мовлення"],
    "Фізична терапія": ["Фізичний терапевт"],
    "Ерготерапія": ["Ерготерапевт"],
    "Психотерапія": ["Лікар-психотерапевт"],
    "Медична психологія": ["Лікар-психолог"],
    "Рефлексотерапія": ["Лікар-рефлексотерапевт"],
    "Клінічна фармація": ["Фармацевт клінічний"],
    "Фармація": ["Фармацевт"],
    "Анестезіологія та реанімація": [
        "Сестра медична-анестезист (брат медичний-анестезист)"],
    "Сестринська справа": ["Сестра медична (брат медичний)"],
    "Акушерська справа": ["Акушерка (акушер)"],
    "likar|Загальна практика — сімейна медицина": [
        "Лікар загальної практики — сімейний лікар"],
    "fahivec|Загальна практика — сімейна медицина": [
        "Сестра медична (брат медичний) загальної практики — сімейної медицини"],
    "Інвазивна електрофізіологія": ["Лікар-кардіолог-електрофізіолог"],
    "Клінічне душпастирство": ["Капелан в охороні здоров'я"],
    "Організація і управління охороною здоров'я": [
        "Генеральний директор", "Директор", "Медичний директор", "Завідувач"],
    # Та сама назва в різних розділах веде на різні посади — ключ із розділом.
    "likar|Лабораторні дослідження факторів навколишнього середовища": [
        "Лікар-лаборант-гігієніст"],
    "profesional|Лабораторні дослідження факторів навколишнього середовища": [
        "Професіонал з дослідження факторів навколишнього середовища"],
    "profesional|Клінічна біохімія": ["Біохімік"],
    "profesional|Мікробіологія і вірусологія": ["Мікробіолог", "Вірусолог"],
    "profesional|Лабораторна імунологія": ["Імунолог"],
    "profesional|Бактеріологія": ["Бактеріолог"],
    "profesional|Вірусологія": ["Вірусолог"],
    "profesional|Генетика лабораторна": ["Генетик"],
    "profesional|Паразитологія": ["Паразитолог"],
    "profesional|Ентомологія": ["Ентомолог"],
    "profesional|Цитоморфологія": ["Цитоморфолог"],
    "profesional|Медична статистика": ["Професіонал з медичної статистики"],
    "profesional|Медична фізика": ["Професіонал з медичної фізики"],
    "profesional|Громадське здоров'я": ["Професіонал з громадського здоров'я"],
    "fahivec|Громадське здоров'я": ["Фахівець з громадського здоров'я"],
    "fahivec|Екстрена медицина": ["Парамедик", "Екстрений медичний технік"],
    "fahivec|Лікувальна справа": ["Фельдшер"],
    "fahivec|Медико-профілактична справа": ["Фельдшер санітарний"],
    "fahivec|Профілактична стоматологія": ["Гігієніст зубний"],
    "fahivec|Стоматологія": ["Лікар зубний"],
    "fahivec|Стоматологія ортопедична": ["Технік зубний"],
    "fahivec|Клінічна діагностика": ["Лаборант (медицина)"],
    "fahivec|Лабораторна діагностика": ["Фельдшер-лаборант"],
    "fahivec|Рентгенологія": ["Рентгенолаборант"],
    "fahivec|Анестезіологія та реанімація": [
        "Сестра медична-анестезист (брат медичний-анестезист)"],
    "fahivec|Психіатрія": ["Сестра медична (брат медичний) психіатричного відділення"],
    "fahivec|Функціональна діагностика": [
        "Сестра медична (брат медичний) з функціональної діагностики"],
    "fahivec|Фізична та реабілітаційна медицина": [
        "Сестра медична (брат медичний) з реабілітації"],
    "fahivec|Нутриціологія": ["Нутриціолог"],
    "fahivec|Оптометрія": ["Оптометрист"],
    "fahivec|Клінічне душпастирство": ["Помічник капелана в охороні здоров'я"],
    "profesional|Клінічне душпастирство": ["Капелан в охороні здоров'я"],
    "profesional|Психотерапія": ["Психотерапевт"],
    "profesional|Ерготерапія": ["Ерготерапевт"],
    "fahivec|Ерготерапія": ["Асистент ерготерапевта"],
    "profesional|Фізична терапія": ["Фізичний терапевт"],
    "fahivec|Фізична терапія": ["Асистент фізичного терапевта"],
}

# Слова, які нічого не додають до зіставлення.
STOP = {"та", "і", "й", "з", "із", "зі", "у", "в", "на", "для", "справа",
        "медицина", "медичний", "медична", "медичне"}


# ── нормалізація ────────────────────────────────────────────────────────
FOOTNOTE = re.compile(r"\s*-\s*\d+\s*$")


def clean(s):
    """Знімає виноску «- 4», зводить апострофи й тире до одного вигляду."""
    s = FOOTNOTE.sub("", s or "")
    s = s.replace("\u2019", "'").replace("\u02bc", "'")
    s = s.replace("\u2014", "—").replace("\u2013", "—")
    return " ".join(s.split()).strip()


def footnotes(s):
    m = FOOTNOTE.search(s or "")
    return [int(m.group(0).strip(" -"))] if m else []


def fold(s):
    return re.sub(r"[^а-яіїєґ]", "", clean(s).lower())


# Українська абетка. Стандартне сортування рядків тут не працює: в Unicode
# «і» (U+0456) стоїть після «я», тому «Внутрішні» опиняється перед
# «Вірусологія» і перевірка порядку дає хибну тривогу.
UA_ALPHABET = "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя"
UA_RANK = {c: i for i, c in enumerate(UA_ALPHABET)}


def ua_key(s):
    return [UA_RANK.get(c, 99) for c in clean(s).lower() if c.isalpha()]


# П'ять, а не шість: прикметник у назві посади стоїть у родовому і розходиться
# з називним уже на шостій літері («ядерна» / «ядерної», «фізика» / «фізики»).
STEM_LEN = 5


def stems(name):
    """Основи значущих слів як префікси фіксованої довжини:
    «Ультразвукова діагностика» → {'ультра', 'діагно'}.

    Обрізання з кінця (w[:-2]) тут не працює: назва спеціальності стоїть у
    називному, а в назві посади те саме слово в родовому і довше на склад
    («ультразвукова» → «ультразвукової»), тому хвости різні, а голови — ні."""
    out = set()
    for w in re.split(r"[^а-яіїєґ']+", clean(name).lower()):
        if not w or w in STOP or len(w) < 3:
            continue
        out.add(w[:STEM_LEN])
    return out


def spec_root(name):
    """Корінь спеціальності: єдине граматичне правило — знімається «-ія»
    («Алергологія» → «алерголог», «Педіатрія» → «педіатр»). Окремо
    «-терапія» → «-терапевт»: там міняється основа, а не закінчення."""
    n = clean(name).lower()
    n = re.sub(r"терапія$", "терапевт", n)
    if n.endswith("ія") and len(n) > 6:
        n = n[:-2]
    return n


def post_root(name):
    """Корінь посади: знімається родове «лікар-» або «лікар »."""
    return re.sub(r"^лікар\s*[-—]?\s*", "", clean(name).lower()).strip()


# ── джерело 1: Додаток 7 із сигнального DOCX ────────────────────────────
def load_specialties():
    xml = zipfile.ZipFile(DOCX_813).read("word/document.xml").decode("utf-8")
    rows = re.findall(r"<w:tr[ >].*?</w:tr>", xml, re.S)
    secre = re.compile(r"^([IІ]{1,3}[VІI]?)\.\s")
    out, sec, seq = [], None, 0
    for r in rows:
        cells = [" ".join("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", c)).split())
                 for c in re.findall(r"<w:tc>.*?</w:tc>", r, re.S)]
        if len(cells) == 1:
            m = secre.match(cells[0])
            if m:
                sec = SEC_CODE.get(m.group(1))
                if sec is None:
                    raise ValueError(f"невідомий розділ Додатка 7: {cells[0]!r}")
            continue
        if len(cells) < 2 or cells[0] == "Назва спеціальності":
            continue
        name = clean(cells[0])
        # Останній рядок таблиці закриває цитату зміни: «спеціалізована”;».
        # Лапка і крапка з комою — розділові знаки постанови, не вид допомоги.
        kinds = [k.strip() for k in clean(cells[1]).strip('”"”; ').split(",")
                 if k.strip()]
        seq += 1
        out.append({
            "id": f"S{seq:03d}",
            "sec": sec,
            "name": name,
            "kinds": kinds,
        })
    return out


# ── джерело 2: Перелік посад із /print наказу 1065 ──────────────────────
def html_grid(tbl):
    """Розкладає HTML-таблицю в сітку з урахуванням rowspan (пастка 2)."""
    grid, carry = [], {}                    # carry: індекс колонки -> (текст, скільки ще рядків)
    for tr in re.findall(r"<tr.*?</tr>", tbl, re.S | re.I):
        row, col = [], 0
        for attrs, body in re.findall(r"<t[dh]([^>]*)>(.*?)</t[dh]>", tr, re.S | re.I):
            while col in carry:
                txt, left = carry[col]
                row.append(txt)
                carry[col] = (txt, left - 1)
                if carry[col][1] <= 0:
                    del carry[col]
                col += 1
            txt = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", body))
                           .replace("\xa0", " ").split())
            row.append(txt)
            m = re.search(r"rowspan\s*=\s*\"?(\d+)", attrs, re.I)
            if m and int(m.group(1)) > 1:
                carry[col] = (txt, int(m.group(1)) - 1)
            col += 1
        while col in carry:
            txt, left = carry[col]
            row.append(txt)
            carry[col] = (txt, left - 1)
            if carry[col][1] <= 0:
                del carry[col]
            col += 1
        if any(row):
            grid.append(row)
    return grid


def load_posts():
    h = HTML_1065.read_text(encoding="utf-8")
    tabs = re.findall(r"<table.*?</table>", h, re.S | re.I)
    # Таблиці шукаємо за шапкою, а не за номером: у наказі 13 таблиць,
    # і будь-яка правка акта зсуне індекси.
    t_base = t_prof = None
    for t in tabs:
        head = " ".join(html_grid(t)[0]) if html_grid(t) else ""
        if "Базові найменування професій" in head:
            t_base = t
        elif "після проходження субспеціалізації" in head:
            t_prof = t
    if t_base is None:
        raise ValueError("у наказі 1065 не знайдено таблицю базових посад")

    out, seq = [], 0
    for tbl, part in ((t_base, "base"), (t_prof, "profile")):
        if tbl is None:
            continue
        path = []
        for r in html_grid(tbl):
            if len(r) == 1:
                t = r[0]
                lvl = 0 if re.match(r"^[IVXІ]+\.", t) else (1 if re.match(r"^\d+\.", t) else 2)
                path = path[:lvl] + [t]
                continue
            # Технічний рядок нумерації колонок — це рівно ['1','2','3','4'].
            # Раніше тут стояло r[0] == "1", і воно з'їдало ПЕРШУ посаду
            # кожного підрозділу (зникали «Генеральний директор»,
            # «Лікар-алерголог», «Лікар загальної практики — сімейний лікар»).
            if len(r) < 3 or r[0] == "№ з/п" or all(c.isdigit() for c in r if c):
                continue
            seq += 1
            out.append({
                "id": f"P{seq:03d}",
                "part": part,
                "no": r[0],
                "name": clean(r[1]),
                "notes": footnotes(r[1]),
                "regulated": "+" in (r[2] or ""),
                "qual": clean(r[3]) if len(r) > 3 else "",
                "path": list(path),
            })
    return out


def sec_score(sec, post_name):
    """Наскільки рівень посади відповідає розділу Додатка 7:
    0 — точно той рівень, 1 — сусідній, 2 — інший рівень зовсім.

    Без цього «Клінічна біохімія» в розділі професіоналів веде на
    лікаря-лаборанта, хоча їй відповідає «Біохімік», а «Громадське здоров'я»
    в обох розділах тягне за собою і фахівця, і професіонала."""
    n = clean(post_name).lower()
    is_doctor = n.startswith("лікар")
    if sec == "likar":
        return 0 if is_doctor else 2
    if sec == "farm":
        return 0 if "фармац" in n else 2
    if is_doctor:
        return 2
    want = "фахівець" if sec == "fahivec" else "професіонал"
    return 0 if n.startswith(want) else 1


# ── місток спеціальність → посада ───────────────────────────────────────
def build_bridge(specs, posts):
    by_fold = defaultdict(list)
    by_root = defaultdict(list)
    for p in posts:
        by_fold[fold(p["name"])].append(p)
        by_root[post_root(p["name"])].append(p)

    stats = Counter()
    broken = []
    for s in specs:
        name = s["name"]
        hits, how = [], None

        # Ключ або «розділ|назва» (коли та сама назва в двох розділах веде до
        # різних посад: «Психотерапія» — лікар-психотерапевт і психотерапевт),
        # або просто назва.
        rule = MANUAL.get(f"{s['sec']}|{name}") or MANUAL.get(name)
        if rule:
            want = {fold(x) for x in rule}
            hits = [p for p in posts if fold(p["name"]) in want]
            missing = want - {fold(p["name"]) for p in hits}
            if missing:
                broken.append((name, [x for x in rule if fold(x) in missing]))
            how = "manual" if hits else None

        if not hits and fold(name) in by_fold:
            hits, how = by_fold[fold(name)], "exact"

        if not hits:
            sr = spec_root(name)
            if sr in by_root:
                hits, how = by_root[sr], "root"
            elif sr.startswith("дитяч"):
                base = spec_root(re.sub(r"^дитяч\S*\s+", "", clean(name).lower()).strip())
                for cand in (base + " дитячий", base + " дитяча"):
                    if cand in by_root:
                        hits, how = by_root[cand], "root"
                        break
            # Корінь у лікаря і в професіонала той самий («Лікар-бактеріолог»
            # і «Бактеріолог»), тому лишаємо тільки посади свого рівня.
            if hits:
                best = min(sec_score(s["sec"], p["name"]) for p in hits)
                hits = [p for p in hits if sec_score(s["sec"], p["name"]) == best]
                s["cross"] = best == 2

        if not hits:
            need = stems(name)
            if need:
                cands = [p for p in posts if need <= stems(p["name"])]
                if cands:
                    # Спершу ті, чий рівень посади відповідає розділу Додатка 7,
                    # потім — найкоротша назва, тобто найменше зайвих слів.
                    def rank(p):
                        return (sec_score(s["sec"], p["name"]), len(stems(p["name"])))
                    cands.sort(key=rank)
                    best = rank(cands[0])
                    hits = [p for p in cands if rank(p) == best]
                    how = "morph"
                    # Знайшлася лише посада іншого рівня — це слабший зв'язок,
                    # і в інтерфейсі він має бути видимо іншим.
                    s["cross"] = best[0] == 2

        # «Завідувач» у наказі 1065 — три різні рядки (керівник ЗОЗ, керівник
        # структурного підрозділу, керівник у професіоналів). У картці це
        # виглядало б як «Завідувач; Завідувач; Завідувач», тому лишаємо
        # перше входження — розділ видно у шляху посади.
        seen, uniq = set(), []
        for p in hits:
            if fold(p["name"]) in seen:
                continue
            seen.add(fold(p["name"]))
            uniq.append(p)
        hits = uniq

        s["posts"] = [p["id"] for p in hits]
        s["match"] = how
        stats[how or "none"] += 1
        for p in hits:
            p.setdefault("specs", []).append(s["id"])

    if broken:
        raise ValueError(
            "MANUAL посилається на посади, яких у наказі 1065 немає:\n" +
            "\n".join(f"  {n}: {v}" for n, v in broken))
    return stats


# ── джерело 3: кадрові вимоги пакетів ───────────────────────────────────
# Написання у специфікаціях пакетів, які основами не беруться: посада стоїть
# у родовому відмінку або Перелік називає її складеним іменем.
PKG_ALIAS = [
    (re.compile(r"сестри медичної\s*/\s*брата медичного", re.I),
     "Сестра медична (брат медичний)"),
    # У специфікаціях первинки посада зветься за видом допомоги, а не за
    # назвою з Переліку. Той самий аліас є і в build_posady.py.
    (re.compile(r"^лікар з надання ПМД", re.I),
     "Лікар загальної практики — сімейний лікар"),
    (re.compile(r"^трансплант-координатор$", re.I),
     "Трансплант-координатор, трансплант-координатор патолого-анатомічного "
     "бюро (бюро судово-медичної експертизи)"),
]


def match_package_staff(reqs, posts):
    """Для кожної кадрової вимоги шукає посади з наказу 1065.

    Витяг і нормалізацію вимоги робить спільний модуль pkg_staff — тут лише
    зіставлення з Переліком. Кожна альтернатива з «та/або» зіставляється
    окремо: інакше довгий ланцюг дає одну випадкову довгу назву (рядок про
    акушера-гінеколога чіплявся за «Лікар-хірург щелепно-лицевий»).

    Після п. 32 Ліцензійних умов у редакції ПКМУ № 813 вимога, яка називає
    посаду поза Переліком МОЗ, стає непридатною до виконання: таку посаду
    заклад ввести не має права. Тому альтернативи без збігу — не шум, а те,
    заради чого ця звірка робиться.
    """
    post_stems = [(p, stems(p["name"])) for p in posts]
    by_pkg, hits_total = {}, 0

    for r in reqs:
        slot = by_pkg.setdefault(r["package"], {
            "package": r["package"], "name": r["title"],
            "matched": [], "unmatched": []})
        ids, found_any, orphan_alts = [], [], []
        full = r.get("alts_full") or r["alts"]
        for i, alt in enumerate(r["alts"]):
            als = stems(alt)
            cands = [p for p, ps in post_stems if ps and ps <= als]
            if not cands and i < len(full) and full[i] != alt:
                # Розбір зрізає хвостове уточнення в дужках, а там буває друга
                # половина парної назви: «Сестра медична (брат медичний)» стає
                # «Сестра медична», і посада з Переліку вже не вкладається.
                # Пробуємо ТУ САМУ альтернативу з дужками — не всю вимогу,
                # інакше будь-яка посада знайдеться десь у сусідній частині
                # ланцюга «та/або» і сироти зникнуть як клас.
                cands = [p for p, ps in post_stems if ps and ps <= stems(full[i])]
            if not cands:
                for rx, target in PKG_ALIAS:
                    if rx.search(alt):
                        cands = [p for p in posts if fold(p["name"]) == fold(target)]
                        break
            if not cands:
                orphan_alts.append(alt)
                continue
            cands.sort(key=lambda p: -len(stems(p["name"])))
            best = len(stems(cands[0]["name"]))
            for p in cands:
                if len(stems(p["name"])) == best and p["id"] not in ids:
                    ids.append(p["id"])
                    found_any.append(p)
        if ids:
            slot["matched"].append({
                "line": r["raw"], "head": r["head"], "cond": r["cond"],
                "scope": r["scope"], "critical": r["critical"],
                "posts": ids,
                # Альтернативи, яких у Переліку немає: вимогу ще можна
                # виконати через сусідню, але вибір у закладу вужчий.
                "orphans": orphan_alts,
            })
            hits_total += 1
            for p in found_any:
                p.setdefault("packages", []).append(r["package"])
        else:
            slot["unmatched"].append(r["raw"])

    order = {}
    for i, r in enumerate(reqs):
        order.setdefault(r["package"], i)
    return sorted(by_pkg.values(), key=lambda s: order[s["package"]]), hits_total


def main():
    src_meta = json.loads(SOURCES_JSON.read_text(encoding="utf-8"))
    specs = load_specialties()
    posts = load_posts()
    print(f"Додаток 7: {len(specs)} спеціальностей")
    print(f"Наказ 1065: {len(posts)} позицій "
          f"({sum(1 for p in posts if p['part'] == 'base')} базових + "
          f"{sum(1 for p in posts if p['part'] == 'profile')} за профілями)")

    stats = build_bridge(specs, posts)
    print("Місток спеціальність → посада:", dict(stats))

    reqs = pkg_staff.load_requirements(PKG_JSON)
    staff, hits = match_package_staff(reqs, posts)
    n_lines = sum(len(p["matched"]) + len(p["unmatched"]) for p in staff)
    print(f"Пакетів із блоком «Спеціалісти»: {len(staff)}; "
          f"вимог розібрано {n_lines}, зійшлося з наказом 1065 — {hits}, "
          f"без відповідника — {n_lines - hits}")

    # Дублі назв між розділами Додатка 7 (пастка 5).
    dup = defaultdict(list)
    for s in specs:
        dup[s["name"]].append(s["sec"])
    dups = {k: v for k, v in dup.items() if len(v) > 1}

    sec_counts = Counter(s["sec"] for s in specs)
    unmatched = [s["name"] for s in specs if not s["match"]]

    # Вади самих джерел — показуємо, а не мовчки лагодимо.
    defects = []
    glued = [p["name"] for p in posts
             if re.search(r"[а-яіїєґ]{4} (?:Фельдшер|Лікар|Сестра|Лаборант)[- ]", p["name"])]
    if glued:
        defects.append({
            "source": "наказ МОЗ № 1065",
            "issue": "у клітинці Переліку злиплися дві назви посад — так вони "
                     "приходять із zakon.rada, розділити автоматично не можна",
            "items": glued,
        })
    # Розділ III Додатка 7 починається з «Ерготерапія», далі абетка від
    # «Бактеріологія» — рядок вибивається з порядку.
    for sec in ("likar", "fahivec", "profesional", "farm"):
        names = [s["name"] for s in specs if s["sec"] == sec]
        if names and names != sorted(names, key=ua_key):
            first_bad = next((names[i] for i in range(1, len(names))
                              if ua_key(names[i]) < ua_key(names[i - 1])), None)
            defects.append({
                "source": "Додаток 7 (ПКМУ № 813)",
                "issue": f"розділ «{SEC_SHORT[sec]}» не за абеткою",
                "items": [f"перший розрив на позиції «{first_bad}»"],
            })
    typo = [f"пакет {pk['package']}: {l}" for pk in staff for l in pk["unmatched"]
            if re.search(r"медичнабрат|медичнийбрат", l)]
    if typo:
        defects.append({
            "source": "специфікації пакетів ПМГ-2026",
            "issue": "у назві посади загублено скісну риску — «Сестра "
                     "медичнабрат медичний» замість «Сестра медична/брат медичний»",
            "items": [t[:160] for t in typo],
        })
    rest = [f"пакет {pk['package']}: {l[:150]}" for pk in staff for l in pk["unmatched"]
            if not re.search(r"медичнабрат|медичнийбрат", l)]
    if rest:
        defects.append({
            "source": "специфікації пакетів ПМГ-2026",
            "issue": "кадрова вимога описує функцію, а не посаду з Переліку МОЗ "
                     "№ 1065 — після п. 32 Ліцензійних умов таку посаду заклад "
                     "ввести не має права",
            "items": rest,
        })
    # Найважливіше для планування: посади, які вимога пропонує як варіант, а
    # Перелік МОЗ їх не знає. Вимогу ще можна виконати через сусідню
    # альтернативу, але з 01.09.2026 цей вибір у закладу зникає.
    orphans = {}
    for pk in staff:
        for m in pk["matched"]:
            for o in m.get("orphans", []):
                orphans.setdefault(o.lower(), set()).add(pk["package"])
    if orphans:
        defects.append({
            "source": "специфікації пакетів ПМГ-2026 ↔ Перелік МОЗ № 1065",
            "issue": "вимога пропонує посаду, якої в Переліку МОЗ немає. Вимога "
                     "лишається виконуваною через інші варіанти того самого "
                     "переліку «та/або», але саме цю посаду з 01.09.2026 ввести "
                     "не можна — набір альтернатив у закладу звужується",
            "items": [f"{name} — пакети " +
                      ", ".join(sorted(p, key=lambda x: int(x) if x.isdigit() else 999))
                      for name, p in sorted(orphans.items(), key=lambda x: -len(x[1]))],
        })
    if dups:
        defects.append({
            "source": "Додаток 7 (ПКМУ № 813)",
            "issue": "та сама назва спеціальності у двох розділах, а рядки "
                     "таблиці не мають ідентифікаторів — розрізнити можна "
                     "лише за розділом",
            "items": sorted(dups),
        })

    meta = {
        "generated": date.today().isoformat(),
        "source": {
            "dodatok7": {
                "title": "Додаток 7 до Ліцензійних умов — Перелік лікарських "
                         "спеціальностей, спеціальностей професіоналів та фахівців "
                         "у сфері охорони здоров'я, фармацевтичних спеціальностей",
                "act": "постанова КМУ від 24.06.2026 № 813 (нова редакція додатка)",
                "base_act": "Ліцензійні умови, затверджені ПКМУ від 02.03.2016 № 285",
                "status": "набирає чинності",
                "effective_from": "01.09.2026",
                "published": "Урядовий кур'єр, 01.07.2026, № 137",
                "url": "https://zakon.rada.gov.ua/laws/show/813-2026-%D0%BF",
                "note": "Таблиці немає в тексті акта на zakon.rada — джерелом є "
                        "сигнальний документ, прикріплений до картки.",
            },
            "nakaz1065": {
                "title": "Перелік професій (посад) працівників сфери охорони здоров'я",
                "act": "наказ МОЗ від 05.07.2025 № 1065",
                "registered": "Мін'юст, 23.07.2025, № 1109/44515",
                "status": "чинний",
                "revision": "26.06.2026 (наказ МОЗ № 618 від 14.05.2026)",
                "url": "https://zakon.rada.gov.ua/laws/show/z1109-25",
            },
            "packages": {
                "title": "Специфікації пакетів ПМГ-2026, блок «Спеціалісти»",
                "act": "постанова КМУ від 31.12.2025 № 1808",
            },
            "fetched_at": src_meta.get("fetched_at"),
        },
        "counts": {
            "specialties": len(specs),
            "posts": len(posts),
            "posts_base": sum(1 for p in posts if p["part"] == "base"),
            "posts_profile": sum(1 for p in posts if p["part"] == "profile"),
            "packages_with_staff": len(staff),
            "staff_lines": n_lines,
            "staff_matched": hits,
            "staff_unmatched": n_lines - hits,
            "staff_orphan_names": len(orphans),
            "staff_orphan_packages": len({p for ps in orphans.values() for p in ps}),
            "sections": dict(sec_counts),
        },
        "match_levels": MATCH_LEVELS,
        "match_stats": dict(stats),
        "cross_level": sorted(s["name"] for s in specs if s.get("cross")),
        "unmatched": sorted(unmatched),
        "source_defects": defects,
        "duplicate_names": {k: sorted(v) for k, v in sorted(dups.items())},
        "section_labels": SEC_SHORT,
    }

    index = [{"id": s["id"], "t": "s", "sec": s["sec"], "n": s["name"],
              "k": s["kinds"], "m": s["match"], "p": len(s["posts"]),
              "x": bool(s.get("cross"))} for s in specs] + \
            [{"id": p["id"], "t": "p", "sec": p["part"], "n": p["name"],
              "r": p["regulated"], "s": len(p.get("specs", []))} for p in posts]

    cards = {s["id"]: {"name": s["name"], "sec": s["sec"], "kinds": s["kinds"],
                       "match": s["match"], "cross": bool(s.get("cross")),
                       "posts": s["posts"],
                       "also_in": sorted(x for x in dup[s["name"]] if x != s["sec"])}
             for s in specs}
    cards.update({p["id"]: {"name": p["name"], "part": p["part"], "no": p["no"],
                            "path": p["path"], "regulated": p["regulated"],
                            "qual": p["qual"], "notes": p["notes"],
                            "specs": p.get("specs", []),
                            "packages": sorted(set(p.get("packages", [])),
                                               key=lambda x: int(x) if x.isdigit() else 999)}
                  for p in posts})
    # Пакети спеціальності — через її посади.
    for s in specs:
        pk = set()
        for pid in s["posts"]:
            pk.update(cards[pid]["packages"])
        cards[s["id"]]["packages"] = sorted(pk, key=lambda x: int(x) if x.isdigit() else 999)

    def write(name, obj):
        path = DATA / name
        path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
        print(f"  {name:20s} {path.stat().st_size / 1024:7.1f} КБ")

    print("\nЗаписано в", DATA)
    write("spec_meta.json", meta)
    write("spec_index.json", index)
    write("spec_cards.json", cards)
    write("spec_pkg.json", staff)

    if unmatched:
        print(f"\nБез пари в наказі 1065: {len(unmatched)}")
        for n in unmatched:
            print("   ·", n)
    if dups:
        print(f"\nНазв у двох розділах Додатка 7: {len(dups)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
