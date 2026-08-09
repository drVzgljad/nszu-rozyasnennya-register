# -*- coding: utf-8 -*-
"""Збірка даних розділу «Інструменти ДСГ» (паспорт · калькулятор · аномалії).

Розділ не має власного джерела даних — він зшиває два вже зібраних:

  postanova/data/resolution_1808.json
      додаток 1 — вагові коефіцієнти ДСГ (443 групи, до трьох колонок),
      додаток 2 — коефіцієнти кардіохірургічних ДСГ (38 груп, дві колонки),
      пункти 34 і 38 глави 3 — базова ставка й перелік коефіцієнтів,
      що застосовуються до ставки на пролікований випадок.

  mapping/data/services.json + odk.json
      639 медичних послуг Таблиці співставлення: який пакет, яка ДСГ,
      які коди НК 025 і НК 026 її підтверджують.

ГОЛОВНЕ ОБМЕЖЕННЯ, яке треба тримати в голові й показувати користувачеві.
Групування пролікованого випадку в конкретну ДСГ виконує групер ЕСОЗ. Ні в
постанові, ні в наказі № 377, ні в Таблиці співставлення правил групування
немає: немає правил вибору між групами одного кореня (B02 проти B02-А),
немає таблиць супутніх станів і ускладнень (CC/MCC). Тому за кодом ми можемо
чесно дати лише перелік МОЖЛИВИХ ДСГ і порахувати суму для кожної. Розділ
ніде не заявляє, що відтворює групер, і не вигадує правил, яких немає.

Другий підводний камінь: додатки 1 і 2 — це два різні режими оплати, а не
одна таблиця. Той самий корінь може бути в обох (F19 = 2,367 у додатку 1 і
F19A = 22,36 у додатку 2), і різниця в 9 разів — не аномалія тарифу, а умова
підпункту 15 пункту 38: додаток 2 діє лише для закладів, які з 1 квітня по
30 вересня 2025 р. провели 50 і більше втручань за переліченими ДСГ. Тому
всі порівняння ваг у пошуку аномалій робляться ЛИШЕ в межах одного додатка,
а поле `a` кожної групи зберігає, з якого саме додатка взято коефіцієнти.

Вихід у drg/data/:
  drg.json — групи, коефіцієнти, зворотні індекси кодів, формула, джерела.

Запуск:  python 05_Веб_реєстр/drg/build_drg.py
"""

import io
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

RESOLUTION_JSON = WEB_DIR / "postanova" / "data" / "resolution_1808.json"
MAPPING_DIR = WEB_DIR / "mapping" / "data"

# Кирилична «А» в кодах ДСГ (B02-А) — та сама пастка, що в build_mapping.py.
CYR2LAT = str.maketrans("АВСЕКМНОРТХІ", "ABCEKMHOPTXI")

# Підписи колонок додатків — дослівно як у розділі «Постанова 1808».
APPENDIX_COLS = {
    "appendix-1": ["Ваговий коефіцієнт",
                   "Додатковий коефіцієнт за допомогу дітям",
                   "Додатковий коефіцієнт за лікування травм"],
    "appendix-2": ["Ваговий коефіцієнт за ДСГ",
                   "Додатковий коефіцієнт за допомогу дітям"],
}
APPENDIX_LABEL = {
    "appendix-1": "Додаток 1",
    "appendix-2": "Додаток 2 (кардіохірургічні ДСГ)",
}

# Які пакети живуть у режимі додатків. Пункт 34 називає три: «Хірургічні
# операції дорослим та дітям у стаціонарних умовах» (3), «Хірургічні операції
# дорослим та дітям в умовах стаціонару одного дня» (47) і «Стаціонарна
# допомога дорослим та дітям без проведення хірургічних операцій» (4).
# Додаток 2 — лише пакет 3 (підпункт 15 пункту 38).
#
# Обмеження не косметичне. Таблиця співставлення для пакета 19 (психіатрія)
# тримає в колонці «Медична послуга» не ДСГ, а ДІАПАЗОНИ МКХ-10 («F00-F09
# Органічні, включаючи симптоматичні, психічні розлади»), і збірка мапінгу
# читає їх тим самим шаблоном, що й коди ДСГ. Через це псевдокод F09 збігається
# з реальною ДСГ F09 додатка 1 — «Інші кардіоторакальні операції без
# використання апарата штучного кровообігу», ваговий 3,296. Психіатрія має
# власні вагові коефіцієнти за діапазонами МКХ у тексті своєї глави
# (0,629 · 1,373 · 1,451 · 2,551 · 1,41 · 0,485), а не в додатку 1, тож такі
# збіги ми відкидаємо й віддаємо окремим списком crossRegime.
APPENDIX_PACKAGES = {
    "appendix-1": {"3", "4", "47"},
    "appendix-2": {"3"},
}

# ── Коефіцієнти до ставки на пролікований випадок ───────────────────────────
# Пункт 38 глави 3 розділу II Порядку. Розмічено вручну з тексту постанови —
# єдине місце в розділі, де дані заведено руками, тому кожен рядок має `ref`
# (пункт) і `sub` (підпункт), щоб інтерфейс міг показати першоджерело.
#
# kind — як саме коефіцієнт входить у розрахунок:
#   weight  ваговий коефіцієнт ДСГ, основа розрахунку (підпункт 3);
#   addw    ДОДАЄТЬСЯ до вагового коефіцієнта (постанова: «додається до
#           вагових коефіцієнтів»), значення бере з колонки додатка;
#   mul     множник (постанова: «застосовується до вагових коефіцієнтів»);
#   addk    додається до коригувального коефіцієнта за кожну добу;
#   alt     не число, а заміна таблиці ваг (додаток 2 замість додатка 1);
#   rateday коефіцієнт від базової ставки НА ДОБУ, окрема оплата поверх випадку;
#   special власний порядок обчислення (кілька операцій при травмі);
#   unknown значення визначають алгоритми і правила НСЗУ — у постанові його немає.
CASE_FACTORS = [
    # stage: "final" — множники, що діють на весь розрахунок і НЕ входять до
    # коригувального коефіцієнта. Різниця з рештою множників не косметична:
    # підпункт 16 додає 0,1 «до коригувального коефіцієнта», і якби частка
    # застосування 0,55 сиділа в тій самій сумі, добавка за добу у ВІТ
    # рахувалася б від неї.
    {"id": "share", "sub": "1", "kind": "mul", "stage": "final", "value": 0.55,
     "on": True, "fixed": True,
     "label": "Частка застосування ставки на пролікований випадок",
     "note": "З 1 січня до 31 грудня 2026 р."},

    {"id": "balance", "sub": "2", "kind": "mul", "stage": "final", "value": 1.0,
     "on": True, "editable": True,
     "label": "Коефіцієнт збалансованості бюджету",
     "note": "Станом на 1 січня 2026 р. — 1. Перераховується не рідше разу "
             "на квартал у порядку додатка 3, тож значення треба перевіряти."},

    {"id": "weight", "sub": "3", "kind": "weight", "on": True, "fixed": True,
     "label": "Ваговий коефіцієнт діагностично-спорідненої групи",
     "note": "Значення — у додатку 1."},

    {"id": "readiness", "sub": "4", "kind": "mul", "on": False,
     "label": "Готовність надавати медичну допомогу",
     "options": [{"value": 1.3, "label": "дітям"},
                 {"value": 1.2, "label": "дорослим"}],
     "packages": ["3", "4"],
     "note": "За умови відповідності додатковим умовам закупівлі."},

    {"id": "mountain", "sub": "5", "kind": "mul", "value": 1.2, "on": False,
     "label": "Гірський коефіцієнт",
     "note": "Місце надання послуг у населеному пункті зі статусом гірського."},

    {"id": "child_add", "sub": "6", "kind": "addw", "column": 1, "on": False,
     "label": "Додатковий коефіцієнт за допомогу дітям",
     "packages": ["3", "4"],
     "note": "Додається до вагового коефіцієнта; значення — друга колонка "
             "додатка 1. Лише для надкластерних і кластерних закладів, "
             "закладів державної форми власності, НАМН і МОЗ за умовами "
             "підпункту 6 пункту 38."},

    {"id": "trauma_add", "sub": "7", "kind": "addw", "column": 2, "on": False,
     "label": "Додатковий коефіцієнт за лікування травм",
     "packages": ["3"],
     "note": "Основний діагноз класу S або T, тривалість лікування у межах "
             "референтних значень. Лише для надавачів, які мають коефіцієнт "
             "пролонгованої стаціонарної допомоги за переліком МОЗ."},

    {"id": "prolonged", "sub": "8", "kind": "mul", "value": 1.1, "on": False,
     "label": "Пролонгована стаціонарна допомога",
     "packages": ["3", "4"],
     "note": "Тривалість лікування перевищує верхнє референтне значення. "
             "Застосовується до коригувальних коефіцієнтів ДСГ."},

    {"id": "short_stay_op", "sub": "9", "kind": "unknown",
     "label": "Коефіцієнт за оперативне втручання при короткому лікуванні",
     "packages": ["3"],
     "note": "Тривалість менша за нижнє референтне значення. Величину "
             "визначають алгоритми і правила НСЗУ — у постанові її немає, "
             "тому розділ її не рахує."},

    {"id": "short_stay_day", "sub": "10", "kind": "unknown",
     "label": "Коефіцієнт за кожен день при короткому лікуванні",
     "packages": ["3", "4"],
     "note": "Базовий коефіцієнт за день × кількість днів. Величину "
             "визначають алгоритми і правила НСЗУ."},

    {"id": "multi_trauma", "sub": "11", "kind": "special",
     "shares": [1.0, 0.75, 0.6], "max_ops": 5, "on": False,
     "label": "Кілька операцій при травмі (S/T)",
     "packages": ["3"],
     "note": "100 % коефіцієнта ДСГ за операцію з найбільшою вагою, 75 % за "
             "наступну, 60 % за кожну подальшу; не більше пʼяти операцій."},

    {"id": "planned", "sub": "12", "kind": "mul", "value": 0.8, "on": False,
     "label": "Планова медична допомога",
     "packages": ["4"],
     "note": "Пріоритет звернення «планова медична допомога», крім лікування "
             "дітей віком до 18 років."},

    {"id": "amb_assoc", "sub": "13", "kind": "mul", "value": 0.6, "on": False,
     "label": "Амбулаторно-асоційований стан або інтервенція",
     "packages": ["3", "4", "47"],
     "note": "Відповідно до алгоритмів і правил НСЗУ (наказ № 377, додаток 3)."},

    {"id": "onco_low_volume", "sub": "14", "kind": "mul", "value": 0.5,
     "on": False,
     "label": "Мала кількість втручань при діагнозах C00-D09, D37-D48",
     "packages": ["3"],
     "icd_ranges": ["C00-D09", "D37-D48"],
     "note": "Заклад з 1 квітня по 30 вересня 2025 р. провів менше 100 "
             "хірургічних втручань за такими діагнозами. Не застосовується до "
             "дитячих лікарень і закладів НАМН та МОЗ за умовами підпункту 14."},

    {"id": "cardio_alt", "sub": "15", "kind": "alt", "on": False,
     "label": "Кардіохірургічні коефіцієнти за додатком 2",
     "packages": ["3"],
     "note": "Замінює ваговий коефіцієнт додатка 1 для закладів, які з "
             "1 квітня по 30 вересня 2025 р. провели 50 і більше втручань за "
             "ДСГ F03, F04, F05, F06, F07, F09, F10, F19, F24 та/або 30 і "
             "більше втручань з відновлення кровотоку в коронарних артеріях."},

    {"id": "icu_day", "sub": "16", "kind": "addk", "value": 0.1, "on": False,
     "from_day": 2, "max_days": 7,
     "label": "Доба у відділенні інтенсивної терапії",
     "note": "0,1 за добу, починаючи з другої, загалом не більше семи діб; "
             "додається до коригувального коефіцієнта. Не застосовується до "
             "ДСГ з інвазивною вентиляцією. Для надкластерних і кластерних "
             "закладів та закладів державної форми власності, у ВІТ яких 20 % "
             "і більше пацієнтів були на ШВЛ."},

    {"id": "dialysis_acute", "sub": "17", "kind": "rateday", "value": 2.0,
     "on": False,
     "label": "Діаліз при гострих станах",
     "note": "Коефіцієнт 2 від базової ставки на добу, поверх випадку, без "
             "коефіцієнта частки застосування."},

    {"id": "b40_plasma", "sub": "18", "kind": "rateday", "value": 0.249,
     "on": False, "drg": ["B40"], "achi": ["13750-00"],
     "label": "Плазмоферез при неврологічних захворюваннях (B40)",
     "packages": ["4"],
     "note": "Коефіцієнт 0,249 від базової ставки на добу за наявності "
             "електронного запису «Процедура» з кодом НК 026 13750-00, без "
             "коефіцієнта частки застосування."},
]

# Пункт 36 навмисно не заведено: його коефіцієнти застосовуються до ГЛОБАЛЬНОЇ
# ставки на місяць (частка 0,45, повторна госпіталізація, частка коротких
# випадків), тобто до бюджету закладу за період, а не до окремого випадку.
# Змішати їх в одну формулу з пунктом 38 означало б порахувати те, чого
# постанова не рахує.
GLOBAL_RATE_NOTE = (
    "Пункт 36 постанови задає коефіцієнти до глобальної ставки на місяць "
    "(частка застосування 0,45, повторна госпіталізація протягом 30 днів, "
    "частка випадків до трьох діб, частка амбулаторно-асоційованих станів). "
    "Вони діють на бюджет закладу за період, а не на окремий випадок, тому в "
    "калькуляторі випадку їх немає."
)


def log(msg):
    print(msg, flush=True)


def num(value):
    """«16,047» → 16.047. Порожня клітинка чи сміття → None."""
    if value is None:
        return None
    text = str(value).strip().replace("\xa0", "").replace(" ", "").replace(",", ".")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def split_code(code):
    """B02-А → ('B02', '-А'); F04C → ('F04', 'C'); C03-01 → ('C03', '-01')."""
    match = re.match(r"^([A-Z]\d{2})(.*)$", code)
    return (match.group(1), match.group(2)) if match else (code, "")


def suffix_kind(suffix):
    """Що означає суфікс коду ДСГ — за самими додатками, без домислів.

    «-01»: у назві групи завжди стоїть «до 24 годин» (C03 «Операції на
    сітківці» → C03-01 «Операції на сітківці до 24 годин») — та сама операція
    в умовах стаціонару одного дня, пакет 47 замість 3. Таких 72.

    Літера: рівень складності, і це не наша інтерпретація — 38 із 41 назви
    прямо містять «висока складність» або «низька складність» (C01A «Операції,
    пов'язані з проникаючою травмою ока. Висока складність»).

    «-А» через дефіс — інша річ, і саме тому має власний вид. Таких пар лише
    три (B02, F08, H06), і в усіх трьох назва групи ДОСЛІВНО збігається з
    назвою базової, а вага відрізняється від 1,65 до 3,69 раза. Чим ці групи
    відрізняються, з додатка не видно, тому називати це рівнем складності було
    б домислом: розділ так і каже.
    """
    if not suffix:
        return ""
    if re.fullmatch(r"-\d{2}", suffix):
        return "day"
    if re.fullmatch(r"[A-Z]", suffix):
        return "level"
    if re.fullmatch(r"[A-Z]-\d{2}", suffix):
        return "level_day"
    if re.fullmatch(r"-[A-Z]", suffix):
        return "dash"
    return "other"


# ── Джерело 1: додатки постанови ────────────────────────────────────────────
def load_groups():
    """{«додаток|код»: група} з таблиць додатків 1 і 2 resolution_1808.json.

    Повторний код у межах одного додатка не перезаписуємо молчки, а збираємо в
    `dupes`: однакова група з різними вагами — це або помилка додатка, або
    помилка нашого парсера, і в обох випадках про це має знати експерт, а не
    словник Python.
    """
    doc = json.loads(RESOLUTION_JSON.read_text(encoding="utf-8"))
    groups = {}
    dupes = []
    for node in doc.get("appendices", []):
        cols = APPENDIX_COLS.get(node["id"])
        table = node.get("table")
        if not cols or not table:
            continue
        for row in table["rows"]:
            code = row["code"].translate(CYR2LAT)
            values = [num(v) for v in list(row["coeffs"])[:len(cols)]]
            values += [None] * (len(cols) - len(values))
            if values[0] is None:
                continue
            root, suffix = split_code(code)
            key = f'{node["id"]}|{code}'
            if key in groups:
                dupes.append({"c": code, "a": node["id"],
                              "t1": groups[key]["t"], "k1": groups[key]["k"],
                              "t2": row["title"], "k2": values})
                continue
            groups[key] = {
                "c": code, "t": row["title"], "a": node["id"],
                "k": values, "root": root, "sfx": suffix,
                "sfxk": suffix_kind(suffix),
                "svc": [], "pkgs": [],
            }
    log(f"Додатки: {len(groups)} ДСГ "
        f"({sum(1 for g in groups.values() if g['a'] == 'appendix-1')} у додатку 1, "
        f"{sum(1 for g in groups.values() if g['a'] == 'appendix-2')} у додатку 2)")
    if dupes:
        log(f"  ! повторних кодів у межах додатка: {len(dupes)} "
            f"({', '.join(sorted({d['c'] for d in dupes}))})")
    return groups, doc, dupes


def resolution_refs(doc):
    """Дослівні уривки пунктів 34 і 38 — щоб інтерфейс цитував, а не переказував."""
    wanted = {"chapter-3-p34": "34", "chapter-3-p38": "38"}
    found = {}

    def walk(node):
        if isinstance(node, dict):
            if node.get("id") in wanted and isinstance(node.get("text"), str):
                found[node["id"]] = node["text"]
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(doc)
    missing = set(wanted) - set(found)
    if missing:
        log(f"! у постанові не знайдено пунктів: {sorted(missing)}")
    return found


# ── Джерело 2: Таблиця співставлення ───────────────────────────────────────
def load_services():
    services = json.loads((MAPPING_DIR / "services.json").read_text(encoding="utf-8"))
    odk = json.loads((MAPPING_DIR / "odk.json").read_text(encoding="utf-8"))
    meta = json.loads((MAPPING_DIR / "mapping_meta.json").read_text(encoding="utf-8"))
    log(f"Таблиця співставлення: {len(services)} послуг, {len(odk)} ОДК "
        f"(версія {meta.get('generated')})")
    return services, odk, meta


def attach_services(groups, services):
    """Послуги, пакети й коди до кожної ДСГ.

    Ключ групи — «додаток|код», бо той самий код може бути в обох додатках із
    різними вагами. Послуга в Таблиці співставлення несе поле `ka` — з якого
    додатка взято її коефіцієнти, тому прив'язка однозначна.

    Чіпляємо лише послуги тих пакетів, які справді оплачуються за додатками
    (APPENDIX_PACKAGES). Решту збігів кодів віддаємо списком cross_regime: це
    не зв'язок, а колізія назв між ДСГ і діапазоном МКХ-10.
    """
    by_code = defaultdict(list)
    for key, group in groups.items():
        by_code[group["c"]].append(key)

    orphan_drg = {}
    cross_regime = []
    for service in services:
        packages = set(service["pkgs"])
        for drg in service["drg"]:
            code = drg["c"].translate(CYR2LAT)
            keys = by_code.get(code)
            if not keys:
                orphan_drg.setdefault(code, {
                    "c": code, "t": drg.get("t", ""), "p": service["pkgs"],
                    "i": service["i"]})
                continue
            if drg.get("ka"):
                keys = [k for k in keys if groups[k]["a"] == drg["ka"]] or keys
            allowed = [k for k in keys
                       if packages & APPENDIX_PACKAGES[groups[k]["a"]]]
            if not allowed:
                cross_regime.append({
                    "c": code, "p": service["pkgs"], "i": service["i"],
                    "svc": service["name"][:120],
                    "drg": groups[keys[0]]["t"][:120],
                    "k": drg.get("k") or [],
                })
                continue
            for key in allowed:
                groups[key]["svc"].append(service["i"])
                for package in packages:
                    if package not in groups[key]["pkgs"]:
                        groups[key]["pkgs"].append(package)

    for group in groups.values():
        group["pkgs"].sort(key=lambda n: int(n) if n.isdigit() else 999)

    linked = sum(1 for g in groups.values() if g["svc"])
    log(f"Прив'язка: {linked} ДСГ мають послуги в Таблиці співставлення, "
        f"{len(groups) - linked} — ні")
    if orphan_drg:
        log(f"  ДСГ у таблиці без ваги в додатках: {len(orphan_drg)} "
            f"({', '.join(sorted(orphan_drg)[:8])}…)")
    if cross_regime:
        packages = sorted({p for row in cross_regime for p in row["p"]},
                          key=lambda n: int(n) if n.isdigit() else 999)
        log(f"  ! колізій код ДСГ ↔ діапазон МКХ: {len(cross_regime)} "
            f"(пакети {', '.join(packages)}) — відкинуто")
    return (sorted(orphan_drg.values(), key=lambda r: r["c"]), cross_regime)


def build_indexes(groups, order, services):
    """код НК 025 / НК 026 / ОДК → номери груп у списку `order`.

    Номери, а не ключі «додаток|код»: індекс за 12 918 кодами НК 025 з
    рядковими ключами важив понад мегабайт, з числами — утретє менше.

    ОДК не розкриваємо в byIcd: 27 категорій містять 16 011 кодів, і пряме
    розкриття роздуло б файл. Замість цього віддаємо byOdk, а членство коду в
    категорії сторінка перевіряє по mapping/data/odk.json — так само, як це
    робить паспорт у classifiers.js.
    """
    position = {key: i for i, key in enumerate(order)}
    svc_groups = defaultdict(set)
    for key, group in groups.items():
        for index in group["svc"]:
            svc_groups[index].add(position[key])

    by_icd, by_achi, by_odk = defaultdict(set), defaultdict(set), defaultdict(set)
    for service in services:
        hits = svc_groups.get(service["i"])
        if not hits:
            continue
        for code in service["icd"]["icd"]:
            by_icd[code].update(hits)
        for code in service["achi"]["achi"]:
            by_achi[code].update(hits)
        for odk_id in set(service["icd"]["odk"]) | set(service["achi"]["odk"]):
            by_odk[odk_id].update(hits)

    log(f"Індекси: {len(by_icd)} кодів НК 025, {len(by_achi)} кодів НК 026, "
        f"{len(by_odk)} ОДК ведуть до ДСГ")
    pack = lambda d: {k: sorted(v) for k, v in sorted(d.items())}
    return pack(by_icd), pack(by_achi), pack(by_odk)


def classify_gap(packages):
    """Чому позиція без ваги в додатках — діра чи інший режим оплати.

    Порядок перевірок важливий: спершу режим додатків (там відсутність ваги —
    справжня діра), потім відомі власні режими, і лише тоді «інше».
    """
    packages = set(packages)
    if packages & {"3", "4", "47"}:
        return "gap"        # режим додатків, а ваги немає
    if "8" in packages:
        return "neonatal"   # пакет 8: ставка на випадок і власні коефіцієнти глави
    if "19" in packages:
        return "psychiatry"  # пакет 19: вагові коефіцієнти за діапазонами МКХ у главі
    return "other"


GAP_LABEL = {
    "gap": "діра: пакет оплачується за додатками, а ваги немає",
    "neonatal": "інший режим: пакет 8 має власні коефіцієнти в тексті глави",
    "psychiatry": "інший режим: пакет 19 має вагові коефіцієнти за діапазонами МКХ",
    "other": "інший режим оплати (не ДСГ)",
}


def surgical_blocks(services):
    """Блоки НК 026, які в Таблиці співставлення поводяться як процедурні.

    Потрібно для правила «ресурсомістка інтервенція в дешевій ДСГ». Замість
    власної класифікації беремо факт: у НК 026 блоки 30-99 — це втручання й
    операції, а 11-29 — обстеження та неоперативні процедури. Межу задає сам
    класифікатор, ми лише рахуємо, скільки кодів кожного блоку є в таблиці.
    """
    counts = defaultdict(int)
    for service in services:
        for code in service["achi"]["achi"]:
            block = code.split("-")[0][:2]
            if block.isdigit():
                counts[block] += 1
    return {b: n for b, n in sorted(counts.items())}


def main():
    groups, doc, dupes = load_groups()
    services, odk, mapping_meta = load_services()
    orphan_drg, cross_regime = attach_services(groups, services)
    for row in orphan_drg:
        row["why"] = classify_gap(row["p"])
    # Порядок груп фіксуємо один раз: за кодом у межах додатка. Від нього
    # залежать номери в зворотних індексах, тож він мусить бути стабільним.
    order = sorted(groups, key=lambda key: (groups[key]["a"], groups[key]["c"]))
    by_icd, by_achi, by_odk = build_indexes(groups, order, services)
    refs = resolution_refs(doc)

    # Послуги без ДСГ — сировина для режиму A. Відсутність ДСГ у пакета 9
    # (амбулаторка) очікувана, у пакета 3 — ні, тому кожен рядок несе `why`.
    no_drg = [{"i": s["i"], "n": s["name"][:160], "p": s["pkgs"],
               "why": classify_gap(s["pkgs"])}
              for s in services if not s["drg"]]

    # ДСГ, на яку не веде жодна послуга Таблиці співставлення: за такою групою
    # оплата передбачена, але як до неї потрапити — з наших даних не видно.
    no_service = [{"c": g["c"], "a": g["a"], "t": g["t"][:160], "k": g["k"]}
                  for g in groups.values() if not g["svc"]]

    payload = {
        "meta": {
            "generated": date.today().isoformat(),
            "version": "1",
            "sourceDoc": doc.get("document") or
                         "Постанова КМУ від 31.12.2025 № 1808",
            "sources": [
                {"id": "1808",
                 "title": "Постанова КМУ від 31.12.2025 № 1808, додатки 1 і 2, "
                          "пункти 34 і 38 глави 3 розділу II Порядку",
                 "from": "postanova/data/resolution_1808.json",
                 "version": json.loads(
                     RESOLUTION_JSON.read_text(encoding="utf-8")).get("generated")},
                {"id": "mapping",
                 "title": mapping_meta.get("title", "Таблиця співставлення"),
                 "from": "mapping/data/services.json",
                 "version": mapping_meta.get("generated")},
            ],
            "limits": {
                "grouper": "Групування випадку в конкретну ДСГ виконує групер "
                           "ЕСОЗ. Правил групування (вибір між групами одного "
                           "кореня, супутні стани й ускладнення) немає ні в "
                           "постанові, ні в наказі № 377, ні в Таблиці "
                           "співставлення, тому розділ дає перелік можливих ДСГ, "
                           "а не результат групування.",
                "appendices": "Додатки 1 і 2 — два різні режими оплати. "
                              "Порівнювати ваги між ними не можна: додаток 2 "
                              "діє лише за умовами підпункту 15 пункту 38.",
                "order": "Постанова не описує порядок дій при поєднанні "
                         "коефіцієнтів. Розрахунок показано як послідовне "
                         "застосування, кожен крок підписано.",
                "globalRate": GLOBAL_RATE_NOTE,
            },
        },
        "rate": {
            "case": 8735,
            "unit": "грн",
            "label": "Базова ставка на пролікований випадок",
            "ref": "chapter-3-p34",
            "packages": ["3", "4", "47"],
        },
        "factors": CASE_FACTORS,
        "refs": refs,
        "appendixLabel": APPENDIX_LABEL,
        "appendixCols": APPENDIX_COLS,
        "appendixPackages": {k: sorted(v, key=int)
                             for k, v in APPENDIX_PACKAGES.items()},
        "groups": [groups[key] for key in order],
        "byIcd": by_icd,
        "byAchi": by_achi,
        "byOdk": by_odk,
        "noDrg": no_drg,
        "noService": no_service,
        "orphanDrg": orphan_drg,
        "crossRegime": cross_regime,
        "dupes": dupes,
        "gapLabel": GAP_LABEL,
        "achiBlocks": surgical_blocks(services),
        "counters": {
            "groups": len(groups),
            "groups_a1": sum(1 for g in groups.values() if g["a"] == "appendix-1"),
            "groups_a2": sum(1 for g in groups.values() if g["a"] == "appendix-2"),
            "roots_multilevel": len({
                g["root"] for g in groups.values()
                if sum(1 for o in groups.values()
                       if o["root"] == g["root"] and o["a"] == g["a"]) > 1}),
            "icd": len(by_icd),
            "achi": len(by_achi),
            "odk": len(by_odk),
            "services_no_drg": len(no_drg),
            "services_no_drg_gap": sum(1 for r in no_drg if r["why"] == "gap"),
            "groups_no_service": len(no_service),
            "orphan_drg": len(orphan_drg),
            "orphan_drg_gap": sum(1 for r in orphan_drg if r["why"] == "gap"),
            "cross_regime": len(cross_regime),
            "dupes": len(dupes),
            "factors_known": sum(1 for f in CASE_FACTORS
                                 if f["kind"] not in ("unknown",)),
            "factors_unknown": sum(1 for f in CASE_FACTORS
                                   if f["kind"] == "unknown"),
        },
    }

    path = DATA_DIR / "drg.json"
    path.write_text(json.dumps(payload, ensure_ascii=False,
                               separators=(",", ":")), encoding="utf-8")
    log(f"\ndrg.json: {path.stat().st_size // 1024} КБ")
    log("Підсумок: " + " · ".join(f"{k} {v}" for k, v
                                  in payload["counters"].items()))


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                  errors="replace")
    main()
