# -*- coding: utf-8 -*-
"""
Спільний шар кадрових даних НавігаторПМГ26 — граф сутностей.

НАВІЩО. Кадрове питання зібране в двох розділах, і кожен із них — власник
своїх даних: `posady.js` тримає ДКХП-78 і коди НСЗУ, `specialnosti.js` —
Додаток 7 і Перелік МОЗ № 1065. Поки так, кожна нова номенклатура означає
нову сторінку, професійні стандарти додати нікуди, а на головне питання ЗОЗ —
ДЕ РВЕТЬСЯ ЛАНЦЮЖОК між спеціальністю, посадою, характеристикою і кодом —
відповіді немає в жодному з розділів, бо ланцюжок проходить крізь обидва.

Цей білдер зводить уже зібране в один граф. Сторінок він НЕ ЧІПАЄ: розділи
далі читають свої файли й працюють як працювали. Переводити їх на граф —
окремий крок, який можна не робити зовсім, і нічого не зламається.

ЩО ЧИТАЄ (нічого не парсить наново, крім специфікацій пакетів)
--------------------------------------------------------------
  data/spec/spec_index.json, spec_cards.json, spec_pkg.json, spec_meta.json
      ← build_specialnosti.py: Додаток 7, Перелік МОЗ № 1065, місток між ними
  data/posady/posady_index.json, posady_cards.json, posady_codes.json
      ← build_posady.py: ДКХП-78, коди посад НСЗУ 2026
  ../pakety/data/packages_2026.json через pkg_staff.load_requirements
      ← блок «Спеціалісти» специфікацій; ЄДИНИЙ парсер цього блоку, і саме
        тому вимоги тут ті самі, що бачили обидва білдери

ТИПИ ВУЗЛІВ
    spec    Додаток 7 до Ліцензійних умов ...... 172
    post    Перелік професій МОЗ № 1065 ........ 301
    dkhp    характеристика ДКХП, випуск 78 ..... 255
    code    код посади НСЗУ 2026 ............... 286
    pkgreq  кадрова вимога пакета ПМГ-2026 ..... 356
    profstd професійний стандарт ................. 0 — тип оголошено наперед,
            джерела ще немає; хай нове входить у наявний шар, а не в новий файл

ТИПИ РЕБЕР (напрям — за ходом ланцюжка, від права до обліку)
    spec → post    спеціальність дає право обіймати посаду
    post → dkhp    посада має кваліфікаційну характеристику
    dkhp → code    характеристику кодує код посади НСЗУ
    pkgreq → post  вимога пакета називає посаду Переліку
    pkgreq → dkhp  вимога пакета називає характеристику ДКХП

ПАСТКИ
  1. `post:P037` і `code:P37` — РІЗНІ РЕЧІ з майже однаковим написанням.
     Перше — позиція № 37 Переліку МОЗ № 1065 (нумерацію дав build_specialnosti
     порядком рядків), друге — код посади НСЗУ P37 із договірного довідника.
     Обидві нумерації прийшли з різних джерел і ніяк не пов'язані. Плутанина
     тут дає тихо неправильний граф, тому префікс типу в id обов'язковий.
  2. Рівні збігу НЕ ВИГАДУЮТЬСЯ. Кожне ребро несе той рівень, який порахував
     білдер-власник даних (`manual|exact|root|morph` для spec→post,
     `exact|generic|comma|base` для pkgreq→dkhp). Де рівня в джерелі немає —
     поля немає теж, а не «схоже на точний».
  3. Зіставлення вимоги з посадою (spec_pkg.json) розкладене у два списки —
     matched і unmatched, — і взаємний порядок вимог між ними втрачено.
     Відновлюємо протяжкою двох черг, а не пошуком за текстом: той самий
     рядок вимоги трапляється в пакеті двічі під різними заголовками груп.
  4. Місток post → dkhp — ЄДИНЕ, що цей білдер рахує сам, бо ніде більше його
     немає. Рахує НЕ своєю нормалізацією: `canon/key/norm/ALIASES/soft_match`
     імпортуються з build_posady. Третій нормалізатор назв у цьому проєкті
     вже одного разу дав дві правди на одному джерелі — pkg_staff.py саме
     через це й з'явився.

ВИХІД
  data/kadry/graph.json       повний граф: вузли з усіма полями, ребра, реєстри
                              джерел, розриви ланцюжка і звірка чисел
  data/kadry/graph_index.json шапка: реєстри джерел, підписи, підсумки, вади
                              джерел і перелік файлів з вузлами
  data/kadry/nodes_<тип>.json легкі вузли одного типу — без важких полів, зате
                              зі степенями за типом сусіда і переліком пакетів,
                              до яких вузол дотягується

ЧОМУ ТРИ РІВНІ, А НЕ ОДИН ФАЙЛ. Повний граф — це мегабайт, і на першому кадрі
він не потрібен: сторінці треба намалювати список і фільтри, а ребра й паспорти
— аж коли відкриють картку. Легкі вузли розкладено за типами, бо консументи
різні: «Спеціальності та посади» беруть spec + post (≈80 КБ), «Посади» — dkhp +
code, світлофор — pkgreq. Одним спільним індексом кожна сторінка платила б за
чужі типи вчетверо.

Код повернення: 0 — числа збіглися з контрольними; 2 — розійшлися (джерело
оновилося, розділи треба перезібрати); граф пишеться в обох випадках.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import pkg_staff                      # спільний розбір блоку «Спеціалісти»
import build_posady as BP             # тільки нормалізація назв, PDF не читаємо

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
SPEC_DIR = BASE / "data" / "spec"
POSADY_DIR = BASE / "data" / "posady"
OUT_DIR = BASE / "data" / "kadry"
PKG_JSON = BASE.parent / "pakety" / "data" / "packages_2026.json"

# Контрольні числа кадрового контуру на 10.08.2026. Це не константи коду, а
# знімок джерел: якщо котресь із них оновилося, числа МАЮТЬ розійтися, і тоді
# правити треба цей словник — свідомо, після перевірки, а не «щоб не сварилось».
EXPECTED = {
    "spec": 172,
    "spec_sections": {"likar": 122, "fahivec": 26, "profesional": 22, "farm": 2},
    "post": 301,
    "post_base": 238,
    "post_profile": 63,
    "dkhp": 255,
    "code": 286,
    "pkgreq": 356,
    "packages_with_staff": 40,
    "dkhp_in_packages": 138,
    "tone": {"ok": 330, "warn": 24, "risk": 2},
    "req_with_post": 354,
    "spec_without_post": 1,
    "orphan_names": 9,
    "orphan_packages": 17,
}

NODE_TYPES = {
    "spec": {
        "label": "спеціальність",
        "source": "Додаток 7 до Ліцензійних умов — перелік лікарських "
                  "спеціальностей, спеціальностей професіоналів та фахівців у "
                  "сфері охорони здоров'я, фармацевтичних спеціальностей",
        "act": "813-2026-п",
        "act_title": "постанова КМУ від 24.06.2026 № 813 (нова редакція додатка "
                     "до Ліцензійних умов, затверджених ПКМУ від 02.03.2016 № 285)",
        "status": "набирає чинності",
        "valid_from": "2026-09-01",
        "published": "Урядовий кур'єр, 01.07.2026, № 137",
        "built_by": "build_specialnosti.py → data/spec/",
    },
    "post": {
        "label": "посада",
        "source": "Перелік професій (посад) працівників сфери охорони здоров'я",
        "act": "z1109-25",
        "act_title": "наказ МОЗ від 05.07.2025 № 1065",
        "status": "чинний",
        "registered": "Мін'юст, 23.07.2025, № 1109/44515",
        "revision": "26.06.2026 (наказ МОЗ від 14.05.2026 № 618)",
        "valid_from": None,
        "note": "дати набрання чинності немає в наших джерелах — у sources.json "
                "зафіксовано лише реєстрацію і чинну редакцію",
        "built_by": "build_specialnosti.py → data/spec/",
    },
    "dkhp": {
        "label": "кваліфікаційна характеристика",
        "source": "Довідник кваліфікаційних характеристик професій працівників, "
                  "випуск 78 «Охорона здоров'я»",
        "act": "va117282-02",
        "act_title": "наказ МОЗ від 29.03.2002 № 117",
        "status": "чинний",
        "revision": "24.02.2025 (наказ МОЗ від 24.02.2025 № 307)",
        "valid_from": None,
        "built_by": "build_posady.py → data/posady/",
    },
    "code": {
        "label": "код посади НСЗУ",
        "source": "Коди посад НСЗУ 2026 — довідник кодування персоналу для "
                  "договірної кампанії",
        "act": None,
        "status": "договірний довідник, не нормативний акт",
        "valid_from": None,
        "built_by": "build_posady.py → data/posady/posady_codes.json",
    },
    "pkgreq": {
        "label": "кадрова вимога пакета",
        "source": "специфікації пакетів ПМГ-2026, блок «Спеціалісти»",
        "act": "1808-2025-п",
        "act_title": "постанова КМУ від 31.12.2025 № 1808",
        "status": "чинний",
        "valid_from": "2026-01-01",
        "built_by": "pkg_staff.load_requirements(pakety/data/packages_2026.json)",
    },
    "profstd": {
        "label": "професійний стандарт",
        "source": None,
        "act": None,
        "status": "джерела ще немає",
        "valid_from": None,
        "built_by": None,
        "note": "тип оголошено наперед: коли стандарти з'являться, вони мають "
                "лягти в цей самий граф, а не в новий розділ",
    },
}

# Підписи розділів обох реєстрів. Розділи Додатка 7 приходять із spec_meta
# (їх дає джерело), розділи Переліку — тут: у наказі № 1065 вони звуться просто
# «розділ 1» і «розділ 2», і людську назву їм дає портал, а не акт.
PART_LABELS = {
    "base": "Розділ 1 · базові посади",
    "profile": "Розділ 2 · за профілями роботи",
}

EDGE_RELS = {
    "spec_post": {
        "from": "spec", "to": "post",
        "means": "спеціальність дає право обіймати посаду",
        "source": "обчислено (build_specialnosti.py) — офіційного зіставлення "
                  "спеціальність↔посада не існує",
        "levels": {
            "manual": "зіставлено вручну (правило морфології не бере)",
            "exact": "назви збігаються дослівно",
            "root": "збіг за коренем назви (Алергологія → лікар-алерголог)",
            "morph": "збіг за основами всіх значущих слів",
        },
    },
    "post_dkhp": {
        "from": "post", "to": "dkhp",
        "means": "посада Переліку МОЗ має кваліфікаційну характеристику ДКХП",
        "source": "обчислено (build_kadry_graph.py нормалізацією build_posady.py) "
                  "— ДКХП-78 не переписували під Перелік № 1065, тож зіставлення "
                  "в джерелах немає",
        "levels": {
            "exact": "назви збігаються після нормалізації",
            "alias": "через відомий синонім (провізор → фармацевт, керівні посади)",
            "soft": "збіг за довгим префіксом назви",
        },
    },
    "dkhp_code": {
        "from": "dkhp", "to": "code",
        "means": "характеристику кодує код посади НСЗУ",
        "source": "build_posady.py (posady_codes.json)",
        "levels": {"alias": "код названо застарілою або скороченою формою"},
    },
    "req_post": {
        "from": "pkgreq", "to": "post",
        "means": "кадрова вимога називає посаду Переліку МОЗ",
        "source": "build_specialnosti.py (spec_pkg.json)",
        "levels": None,
        "note": "рівня збігу джерело не фіксує — поля на ребрі немає навмисно",
    },
    "req_dkhp": {
        "from": "pkgreq", "to": "dkhp",
        "means": "кадрова вимога називає характеристику ДКХП",
        "source": "build_posady.py (posady_cards.json)",
        "levels": {
            "exact": "назва вимоги дорівнює назві характеристики",
            "base": "назва + хвіст-уточнення сфери роботи",
            "comma": "у вимозі дві посади через кому",
            "generic": "вимога названа узагальнено, підходить кілька характеристик",
        },
    },
}

# Певність рівнів pkgreq → dkhp: одна й та сама пара може прийти з двох
# альтернатив вимоги з різними рівнями — на ребрі лишається сильніший.
REQ_DKHP_RANK = {"exact": 0, "base": 1, "comma": 2, "generic": 3}

# Світлофор кадрової вимоги. Відповідає на одне питання — чи може заклад цю
# вимогу виконати, — і нічого не оцінює: тон тут не «добре/погано», а стан
# ланцюжка, як у розборах розділу «Рентген».
#
# Рахується від пункту 32 Ліцензійних умов у редакції ПКМУ № 813: з 01.09.2026
# заклад не має права вводити посаду поза Переліком МОЗ № 1065. Тому вимога,
# яка називає посаду, котрої в Переліку немає, з тієї дати стає невиконуваною
# саме в цій частині — незалежно від того, чи є в закладу така людина сьогодні.
TONES = {
    "ok": "усі названі посади є в Переліку МОЗ № 1065 — вимогу можна виконати "
          "будь-яким із варіантів",
    "warn": "частина названих посад у Переліку відсутня: вимога лишається "
            "виконуваною через інші варіанти переліку «та/або», але з 01.09.2026 "
            "вибір у закладу вужчий",
    "risk": "жодна з названих посад не має відповідника в Переліку МОЗ — "
            "з 01.09.2026 виконати вимогу буквально не можна",
}

# Парну форму назви Перелік МОЗ № 1065 пише в дужках і повторює уточнення в
# обох половинах — «Сестра медична операційна (брат медичний операційний)», —
# а ДКХП ставить скісну і уточнює один раз у кінці: «Сестра медична / брат
# медичний операційна». Таблиця GENDER у build_posady знає цю рівність лише
# для скісної форми: інших написань їй не траплялося, бо вона зіставляла ДКХП
# з кодами НСЗУ і специфікаціями пакетів, а ті теж пишуть через скісну.
#
# Тому написання Переліку зводимо до її форми ТУТ, на межі джерела, а не
# новим правилом збігу. У саму GENDER це класти не можна: canon() тоді
# зміниться і для кодів, і для вимог пакетів, тобто попливуть числа живих
# розділів. Коли «Посади» стануть вью на граф (крок 3), обидва написання
# з'їдуться в одну таблицю.
PAIRED_FORM = re.compile(r"\s*\((?:[^)]*\bбрат[^)]*|акушер[^)]*)\)")

# Частина позицій Переліку сформульована не як посада, а як РОЛЬ: «Лікар
# відповідної спеціальності, який здійснює професійну діяльність за профілем
# роботи «Репродуктологія»». Це надбудова над уже наявною посадою, і власної
# кваліфікаційної характеристики вона не має за визначенням. Рахувати такі
# рядки прогалиною ДКХП означало б видати особливість Переліку за ваду
# Довідника — та сама помилка, від якої build_posady боронить рівнем
# «condition». Розділ 2 Переліку до них НЕ зводиться: більшість його рядків —
# звичайні посади («Статистик медичний», «Лаборант з бактеріології»), і
# характеристику вони мають.
ROLE_RE = re.compile(r"спеціальності,\s*(?:яка|який|які)\s+здійсню", re.I)


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


# ── вузли ───────────────────────────────────────────────────────────────
def nodes_from_spec(index, cards):
    """Спеціальності Додатка 7 і позиції Переліку МОЗ № 1065.

    Обидва реєстри лежать в одному spec_index.json і різняться полем `t`.
    Ідентифікатори (S001…, P001…) дав build_specialnosti порядком рядків
    таблиці — своїх у джерел немає (пастка 5 того білдера).
    """
    out = []
    for e in index:
        card = cards[e["id"]]
        if e["t"] == "s":
            out.append({
                "id": f"spec:{e['id']}",
                "type": "spec",
                "name": card["name"],
                "sec": card["sec"],
                "kinds": card["kinds"],
                # Рівень збігу лежить і тут, і на ребрах spec_post — свідомо.
                # build_specialnosti рахує ОДИН рівень на спеціальність, і всі
                # її посади мають той самий; ребро несе його для того, хто йде
                # графом, а вузол — для того, хто малює список і ребер ще не
                # вантажив. Це не два виміри, а одне число у двох місцях.
                "match": card["match"],
                "cross": bool(card.get("cross")),
                # Та сама назва трапляється у двох розділах Додатка 7 — розділ
                # і є єдиним, чим рядки розрізняються.
                "also_in": card["also_in"],
            })
        else:
            out.append({
                "id": f"post:{e['id']}",
                "type": "post",
                "name": card["name"],
                "part": card["part"],
                "no": card["no"],
                "path": card["path"],
                "regulated": card["regulated"],
                "qual": card["qual"],
                "notes": card["notes"],
            })
    return out


def nodes_from_posady(index):
    return [{
        "id": f"dkhp:{e['id']}",
        "type": "dkhp",
        "name": e["name"],
        "num": e["num"],
        "section": e["section"],
        "sub": e["sub"],
        "page": e["page"],
        # Пошукові синоніми: хто шукає «провізора», має знайти «фармацевта».
        "alt": e["alt"],
    } for e in index]


def nodes_from_codes(codes):
    out = []
    for c in codes:
        n = {
            "id": f"code:{c['code']}",
            "type": "code",
            "name": c["name"],
            # status/admin — це не посади: юридичні статуси (в.о., ФОП,
            # ліквідатор) і загальноадміністративні посади поза випуском 78.
            "kind": c["kind"],
        }
        if c.get("alias_of"):
            n["alias_of"] = c["alias_of"]
        out.append(n)
    return out


def nodes_from_reqs(reqs):
    """Кадрові вимоги пакетів. Один вузол — один пункт блоку «Спеціалісти».

    Ідентифікатор порядковий у межах пакета (`pkgreq:3-05`). Він стабільний,
    поки специфікація не змінилася, і читається очима — тексту вимоги в id
    немає навмисно: вона буває на півтори тисячі знаків.
    """
    seq = Counter()
    out = []
    for r in reqs:
        seq[r["package"]] += 1
        out.append({
            "id": f"pkgreq:{r['package']}-{seq[r['package']]:02d}",
            "type": "pkgreq",
            # Назва вузла — голова вимоги: усе до тире перед умовою.
            "name": r["head"],
            "package": r["package"],
            "scope": r["scope"],
            "cond": r["cond"],
            "critical": r["critical"],
            "alts": r["alts"],
            # Дослівний рядок специфікації. Він дублює head + cond, і це
            # свідомо: сторінки показують вимогу як вона написана в акті, а
            # склеювати її назад із половин означало б тихо міняти текст
            # джерела (зникає нумерація пункту, нормалізується тире).
            "raw": r["raw"],
        })
    return out


# ── ребра ───────────────────────────────────────────────────────────────
def edges_spec_post(cards):
    out = []
    for sid, card in cards.items():
        if "posts" not in card:
            continue
        for pid in card["posts"]:
            e = {"from": f"spec:{sid}", "to": f"post:{pid}",
                 "rel": "spec_post", "level": card["match"]}
            if card.get("cross"):
                # Знайшлася лише посада іншого рівня, ніж розділ Додатка 7
                # («Клінічна біохімія» професіонала → лікар-лаборант). Зв'язок
                # слабший, і ховати це не можна.
                e["cross"] = True
            out.append(e)
    return out


def edges_dkhp_code(codes):
    out = []
    for c in codes:
        if not c.get("dkhp"):
            continue
        e = {"from": f"dkhp:{c['dkhp']}", "to": f"code:{c['code']}",
             "rel": "dkhp_code"}
        if c.get("alias_of"):
            e["level"] = "alias"
        out.append(e)
    return out


def replay_spec_pkg(reqs, req_ids, spec_pkg):
    """Вимога → рядок spec_pkg.json (пастка 3).

    match_package_staff розклав вимоги пакета у matched і unmatched, і взаємний
    порядок між списками зник. Відновлюємо протяжкою: ідемо вимогами в тому
    самому порядку, у якому їх бачив той білдер, і знімаємо голову з тієї
    черги, що збігається текстом рядка і заголовком групи. Пошуком за текстом
    цього робити не можна — той самий рядок трапляється в пакеті двічі під
    різними заголовками, і збіг був би не з тим входженням.

    Обидві черги мають спорожніти. Якщо ні — зіставлення розійшлося з
    поточними специфікаціями, і мовчки будувати граф на цьому не можна.
    """
    queues = {p["package"]: (list(p["matched"]), list(p["unmatched"]))
              for p in spec_pkg}
    matched_of = {}
    for rid, r in zip(req_ids, reqs):
        q = queues.get(r["package"])
        if q is None:
            raise ValueError(
                f"пакета {r['package']} немає в spec_pkg.json — "
                f"перезібрати build_specialnosti.py")
        m, u = q
        if m and m[0]["line"] == r["raw"] and m[0]["scope"] == r["scope"]:
            matched_of[rid] = m.pop(0)
        elif u and u[0] == r["raw"]:
            u.pop(0)
            matched_of[rid] = None
        else:
            raise ValueError(
                f"вимога {rid} не сходиться зі spec_pkg.json — "
                f"перезібрати build_specialnosti.py.\n  вимога: {r['raw'][:120]}")
    left = {pkg: (len(m), len(u)) for pkg, (m, u) in queues.items() if m or u}
    if left:
        raise ValueError(f"у spec_pkg.json лишилися нерозібрані рядки: {left}")
    return matched_of


def alt_to_dkhp(posady_cards):
    """Назва посади з вимоги → характеристики ДКХП.

    posady_cards.json тримає зіставлення розкладеним по картках характеристик,
    але кожен рядок несе `name` — ДОСЛІВНУ альтернативу з вимоги, ту саму, яку
    дає pkg_staff.split_names. Тому ключем іде сам рядок назви: жодної нової
    нормалізації тут не потрібно.
    """
    out, conflicts = {}, []
    for did, card in posady_cards.items():
        for row in card.get("pkg_rows", []):
            level = row.get("via", "exact")
            slot = out.setdefault(row["name"], {"ids": [], "level": level})
            if slot["level"] != level:
                conflicts.append((row["name"], slot["level"], level))
                if REQ_DKHP_RANK.get(level, 9) < REQ_DKHP_RANK.get(slot["level"], 9):
                    slot["level"] = level
            if did not in slot["ids"]:
                slot["ids"].append(did)
    return out, conflicts


def edges_req(reqs, req_ids, matched_of, alt_map):
    """Ребра від кадрової вимоги: до посад Переліку і до характеристик ДКХП."""
    out = []
    orphans = {}                       # вимога → альтернативи поза Переліком
    no_post, no_dkhp = [], []
    for rid, r in zip(req_ids, reqs):
        row = matched_of[rid]
        if row:
            for pid in row["posts"]:
                out.append({"from": rid, "to": f"post:{pid}", "rel": "req_post"})
            if row.get("orphans"):
                orphans[rid] = row["orphans"]
        else:
            no_post.append(rid)

        # Ребро несе АЛЬТЕРНАТИВУ, якою вимога дотяглася до характеристики, і
        # тому між тією самою парою їх буває кілька. Приклад із пакета 5:
        # «Лікар-психолог або лікар-психотерапевт, або клінічний психолог, або
        # психолог, або психотерапевт» веде на «Лікар-психолог» двічі — точно
        # («Лікар-психолог») і узагальнено («психолог», яке підходить ще й
        # клінічному психологу). У картці це два різні рядки з різним рівнем
        # певності; звести їх в одне ребро означало б стерти один із них.
        made = False
        seen_alt = set()
        for alt in r["alts"]:
            hit = alt_map.get(alt)
            if not hit:
                continue
            for did in hit["ids"]:
                if (alt, did) in seen_alt:
                    continue
                seen_alt.add((alt, did))
                e = {"from": rid, "to": f"dkhp:{did}", "rel": "req_dkhp", "alt": alt}
                if hit["level"] != "exact":
                    e["level"] = hit["level"]
                out.append(e)
                made = True
        if not made:
            no_dkhp.append(rid)
    return out, orphans, no_post, no_dkhp


def edges_post_dkhp(posts, dkhp_index):
    """Місток Перелік МОЗ № 1065 → ДКХП-78 — єдине, що рахується тут.

    Його немає ніде: ДКХП, випуск 78, востаннє правили у лютому 2025, а Перелік
    посад вийшов у липні 2025 і вже мав редакцію. Тому частина посад Переліку
    характеристики не має за визначенням, і саме тут ланцюжок «спеціальність →
    посада → характеристика → код» рветься найчастіше.

    Нормалізація і словник синонімів — з build_posady, дослівно ті самі
    функції, якими він зіставляв коди НСЗУ. Свого нормалізатора назв тут немає
    навмисно (пастка 4).
    """
    by_key = {}
    for e in dkhp_index:
        by_key.setdefault(BP.key(e["name"]), e)
        by_key.setdefault(BP.canon(e["name"]), e)

    def resolve(name):
        for cand in BP.variants(name):
            hit = by_key.get(BP.canon(cand)) or by_key.get(BP.key(cand))
            if hit is not None:
                return hit, "exact"
            alias = BP.ALIASES.get(BP.norm(cand))
            if alias:
                hit = by_key.get(BP.canon(alias)) or by_key.get(BP.key(alias))
                if hit is not None:
                    return hit, "alias"
        for cand in BP.variants(name):
            hit = BP.soft_match(BP.canon(cand), by_key)
            if hit is not None:
                return hit, "soft"
        return None, None

    out, levels, missing = [], Counter(), []
    for p in posts:
        hit, level = resolve(PAIRED_FORM.sub("", p["name"]).strip())
        if hit is None:
            missing.append(p["id"])
            levels["none"] += 1
            continue
        e = {"from": p["id"], "to": f"dkhp:{hit['id']}", "rel": "post_dkhp"}
        if level != "exact":
            e["level"] = level
        out.append(e)
        levels[level] += 1
    return out, dict(levels), missing


# ── легкий зріз для першого кадру ───────────────────────────────────────
# Поля, які потрібні, щоб намалювати рядок результату і відфільтрувати список,
# — усе інше лишається в повному графі й вантажиться аж із першою карткою.
LIGHT_FIELDS = {
    "spec": ("sec", "kinds", "match", "cross"),
    "post": ("part", "no", "regulated"),
    # alt — пошукові синоніми з довідника кодів НСЗУ; без них у списку не
    # знайдеться «провізор», якого чинний ДКХП зве фармацевтом.
    "dkhp": ("section", "sub", "alt"),
    "code": ("kind",),
    # tone — світлофор вимоги; потрібен у списку, не тільки в паспорті.
    "pkgreq": ("package", "critical", "tone", "tone_why"),
    "profstd": (),
}


def pkg_sort(n):
    return (int(n) if str(n).isdigit() else 999, str(n))


def reachability(nodes, edges):
    """Степені за типом сусіда і пакети, до яких вузол дотягується.

    Обидва числа потрібні на першому кадрі — щоб підписати рядок («2 посади»)
    і відфільтрувати «лише те, що є кадровою вимогою пакета», — а ребер там ще
    немає. Рахуємо їх тут, щоб сторінка не мусила вантажити граф заради лічби.
    """
    type_of = {n["id"]: n["type"] for n in nodes}
    deg = defaultdict(Counter)
    for e in edges:
        deg[e["from"]][type_of[e["to"]]] += 1
        deg[e["to"]][type_of[e["from"]]] += 1

    pkg = defaultdict(set)
    for n in nodes:
        if n["type"] == "pkgreq":
            pkg[n["id"]].add(n["package"])
    # Крок від вимоги: посада і характеристика.
    for e in edges:
        if e["rel"] in ("req_post", "req_dkhp"):
            pkg[e["to"]] |= pkg[e["from"]]
    # Далі: спеціальність — через свої посади, код — через свою характеристику.
    # Ребро post_dkhp у цьому обході не бере участі навмисно: пакети до
    # характеристики приходять із самих вимог, і пускати їх ще й в обхід через
    # посаду означало б приписати характеристиці пакет, який її не називав.
    for e in edges:
        if e["rel"] == "spec_post":
            pkg[e["from"]] |= pkg[e["to"]]
        elif e["rel"] == "dkhp_code":
            pkg[e["to"]] |= pkg[e["from"]]
    return deg, pkg


def card_fields(nodes, t):
    """Важкі поля вузлів одного типу: усе, чого немає в легкому зрізі.

    Третя сім'я зрізів поруч із nodes_ і edges_. Без неї сторінка, якій
    потрібен паспорт, мусила б тягнути повний граф — тобто ще й чужі типи
    вузлів і всі відношення. Ключ — той самий ідентифікатор вузла, тож
    сторінка просто накладає картку на легкий вузол.
    """
    skip = {"id", "type", "name"} | set(LIGHT_FIELDS[t])
    out = {}
    for n in nodes:
        if n["type"] != t:
            continue
        d = {k: v for k, v in n.items() if k not in skip}
        if d:
            out[n["id"]] = d
    return out


def light_nodes(nodes, deg, pkg):
    out = []
    for n in nodes:
        e = {"id": n["id"], "type": n["type"], "name": n["name"]}
        for f in LIGHT_FIELDS[n["type"]]:
            v = n.get(f)
            # Порожнє й хибне не пишемо: сторінка читає їх як відсутність, а
            # на 1 370 вузлах кожне зайве поле — це десятки кілобайт.
            if v not in (None, "", False, [], {}):
                e[f] = v
        d = dict(deg.get(n["id"], {}))
        if d:
            e["deg"] = d
        p = pkg.get(n["id"])
        if p:
            e["pkg"] = sorted(p, key=pkg_sort)
        out.append(e)
    return out


# ── звірка ──────────────────────────────────────────────────────────────
def verify(actual):
    """Граф має відтворювати ті самі числа, що й розділи. Це тест на регресію."""
    ok, lines = True, []
    for k, want in EXPECTED.items():
        got = actual.get(k)
        good = got == want
        ok &= good
        mark = "✔" if good else "✘"
        lines.append(f"  {mark} {k:22s} {got}" + ("" if good else f"   (очікували {want})"))
    return ok, lines


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    spec_index = load(SPEC_DIR / "spec_index.json")
    spec_cards = load(SPEC_DIR / "spec_cards.json")
    spec_pkg = load(SPEC_DIR / "spec_pkg.json")
    spec_meta = load(SPEC_DIR / "spec_meta.json")
    posady_index = load(POSADY_DIR / "posady_index.json")
    posady_cards = load(POSADY_DIR / "posady_cards.json")
    posady_codes = load(POSADY_DIR / "posady_codes.json")
    posady_meta = load(POSADY_DIR / "posady_meta.json")

    reqs = pkg_staff.load_requirements(PKG_JSON)
    if not reqs:
        sys.exit("Не знайдено packages_2026.json або в ньому немає блоку «Спеціалісти»")

    nodes = (nodes_from_spec(spec_index, spec_cards)
             + nodes_from_posady(posady_index)
             + nodes_from_codes(posady_codes)
             + nodes_from_reqs(reqs))
    req_ids = [n["id"] for n in nodes if n["type"] == "pkgreq"]
    posts = [n for n in nodes if n["type"] == "post"]

    matched_of = replay_spec_pkg(reqs, req_ids, spec_pkg)
    alt_map, alt_conflicts = alt_to_dkhp(posady_cards)

    e_spec_post = edges_spec_post(spec_cards)
    e_dkhp_code = edges_dkhp_code(posady_codes)
    e_req, orphans, req_no_post, req_no_dkhp = edges_req(
        reqs, req_ids, matched_of, alt_map)
    e_post_dkhp, post_dkhp_levels, post_no_dkhp = edges_post_dkhp(
        posts, posady_index)

    edges = e_spec_post + e_post_dkhp + e_dkhp_code + e_req
    edges.sort(key=lambda e: (e["rel"], e["from"], e["to"]))

    # Альтернативи вимог, яких Перелік МОЗ не знає, — вішаємо на вузол вимоги:
    # це не шум, а звужений набір варіантів у закладу після п. 32 Ліцензійних
    # умов у редакції ПКМУ № 813. Звідти ж і світлофор.
    no_post = set(req_no_post)
    for n in nodes:
        if n["type"] != "pkgreq":
            continue
        if n["id"] in no_post:
            n["tone"] = "risk"
            # Обидва наші «risk» — це друкарська помилка специфікації, а не
            # відсутня посада: у назві загублено скісну риску. Сказати тут
            # «заклад не може виконати вимогу» було б неправдою — вимогу не
            # можна ЗІСТАВИТИ, і причина в тексті джерела, не в закладі.
            if re.search(r"медичнабрат|медичнийбрат", n["name"], re.I):
                n["tone_why"] = (
                    "у назві посади загублено скісну риску («Сестра медичнабрат "
                    "медичний» замість «Сестра медична/брат медичний»). Сама посада "
                    "в Переліку МОЗ є — зіставити заважає помилка специфікації, "
                    "а не брак посади")
        elif n["id"] in orphans:
            n["orphans"] = orphans[n["id"]]
            n["tone"] = "warn"
        else:
            n["tone"] = "ok"

    by_type = Counter(n["type"] for n in nodes)
    by_rel = Counter(e["rel"] for e in edges)
    sec_counts = Counter(n["sec"] for n in nodes if n["type"] == "spec")
    part_counts = Counter(n["part"] for n in nodes if n["type"] == "post")

    linked_posts = {e["to"] for e in e_spec_post}
    linked_dkhp = {e["from"] for e in e_dkhp_code}
    orphan_names = {o.lower() for v in orphans.values() for o in v}
    orphan_pkgs = {rid.split(":")[1].rsplit("-", 1)[0] for rid in orphans}

    actual = {
        "spec": by_type["spec"],
        "spec_sections": dict(sec_counts),
        "post": by_type["post"],
        "post_base": part_counts["base"],
        "post_profile": part_counts["profile"],
        "dkhp": by_type["dkhp"],
        "code": by_type["code"],
        "pkgreq": by_type["pkgreq"],
        "packages_with_staff": len({n["package"] for n in nodes
                                    if n["type"] == "pkgreq"}),
        "dkhp_in_packages": len({e["to"] for e in e_req if e["rel"] == "req_dkhp"}),
        "tone": dict(Counter(n["tone"] for n in nodes if n["type"] == "pkgreq")),
        "req_with_post": by_type["pkgreq"] - len(req_no_post),
        "spec_without_post": sum(1 for n in nodes if n["type"] == "spec"
                                 and not spec_cards[n["id"].split(":")[1]]["posts"]),
        "orphan_names": len(orphan_names),
        "orphan_packages": len(orphan_pkgs),
    }
    ok, check_lines = verify(actual)

    # Розриви ланцюжка — те, заради чого граф і будується. Позиції-ролі
    # відокремлені від справжніх прогалин (див. ROLE_RE).
    no_dkhp = set(post_no_dkhp)
    gaps = {
        "spec_without_post": sorted(
            n["name"] for n in nodes if n["type"] == "spec"
            and not spec_cards[n["id"].split(":")[1]]["posts"]),
        "post_without_spec": sorted(
            n["name"] for n in posts if n["id"] not in linked_posts),
        "post_without_dkhp": {
            "position": sorted(n["name"] for n in posts if n["id"] in no_dkhp
                               and not ROLE_RE.search(n["name"])),
            "role": sorted(n["name"] for n in posts if n["id"] in no_dkhp
                           and ROLE_RE.search(n["name"])),
        },
        "dkhp_without_code": sorted(
            n["name"] for n in nodes
            if n["type"] == "dkhp" and n["id"] not in linked_dkhp),
        "req_without_post": [
            {"id": rid, "head": next(n["name"] for n in nodes if n["id"] == rid)}
            for rid in req_no_post],
        "req_without_dkhp": [
            {"id": rid, "head": next(n["name"] for n in nodes if n["id"] == rid)}
            for rid in req_no_dkhp],
        "orphan_names": sorted(orphan_names),
    }

    # Вади джерел показує сторінка, тож вони мають доїхати разом із даними.
    # Свою знахідку (розбіжність рівнів) дописуємо до списку білдера-власника,
    # а не заводимо другий канал: у панелі «Вади джерел» це один список.
    defects = list(spec_meta.get("source_defects") or [])
    if alt_conflicts:
        defects.append({
            "source": "data/posady/posady_cards.json",
            "issue": "та сама назва посади у вимогах отримала різні рівні збігу "
                     "з ДКХП — на ребрі лишено сильніший",
            "items": [f"{n}: {a} / {b}" for n, a, b in alt_conflicts],
        })

    # Те саме з боку ДКХП: застарілі назви кодів, лакуни Довідника, вимоги без
    # характеристики і дефекти зведеного тексту. Структуру лишаємо як у
    # build_posady — сторінка малює кожен вид по-своєму, і зведення в спільний
    # список зробило б із чотирьох різних тверджень один сірий перелік.
    dkhp_notes = {k: posady_meta.get(k) or []
                  for k in ("notes", "aliases", "lacunae", "pkg_unmatched",
                            "pkg_elsewhere", "pkg_conditions", "no_block")}

    # Специфікація подекуди називає ту саму посаду ДВІЧІ в одному переліку
    # «та/або»: пакет 3 — «лікар-хірург-проктолог», пакет 5 — «лаборант
    # клініко-діагностичної лабораторії». Ребро на це одне: посада, названа
    # двічі, лишається одним зв'язком, а не двома вимогами. Але мовчати не
    # можна — у паспорті посади рядок від цього двоївся, і виглядало це як дві
    # різні умови пакета.
    dup_alts = []
    for r in reqs:
        for name, n in Counter(a.lower() for a in r["alts"]).items():
            if n > 1:
                dup_alts.append(f"пакет {r['package']} — «{name}» ×{n}")
    if dup_alts:
        dkhp_notes["notes"] = list(dkhp_notes["notes"]) + [
            "У специфікаціях пакетів та сама посада подекуди стоїть двічі в одному "
            "переліку взаємозамінних («та/або»): " + "; ".join(sorted(set(dup_alts))) +
            ". У паспорті це один рядок: повторне називання не створює другої вимоги."]

    deg, pkg_reach = reachability(nodes, edges)

    graph = {
        "generated": date.today().isoformat(),
        "built_from": {
            "spec": spec_meta.get("generated"),
            "posady": load(POSADY_DIR / "posady_meta.json").get("generated"),
        },
        "node_types": NODE_TYPES,
        "edge_rels": EDGE_RELS,
        "tones": TONES,
        "labels": {"sec": spec_meta.get("section_labels", {}), "part": PART_LABELS},
        "counts": {"nodes": dict(by_type), "edges": dict(by_rel)},
        "check": {
            "ok": bool(ok),
            "expected": EXPECTED,
            "actual": actual,
            "note": "числа графа мають збігатися з розділами «Посади» і "
                    "«Спеціальності та посади»; розбіжність означає, що джерело "
                    "оновилося, а не що граф зламався",
        },
        "post_dkhp_levels": post_dkhp_levels,
        "notes": {"spec": defects, "dkhp": dkhp_notes},
        "gaps": gaps,
        "nodes": nodes,
        "edges": edges,
    }

    def write(name, obj):
        p = OUT_DIR / name
        p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
                     encoding="utf-8")
        return p

    path = write("graph.json", graph)

    light = light_nodes(nodes, deg, pkg_reach)
    files = {}
    for t in NODE_TYPES:
        rows = [n for n in light if n["type"] == t]
        p = write(f"nodes_{t}.json", rows)
        cards = card_fields(nodes, t)
        c = write(f"cards_{t}.json", cards)
        files[t] = {"file": p.name, "count": len(rows),
                    "kb": round(p.stat().st_size / 1024),
                    "cards": c.name, "cards_kb": round(c.stat().st_size / 1024)}

    # Ребра теж зрізами: сторінці буває потрібне ОДНЕ відношення ще до того,
    # як приїде повний граф. «Посади» так малюють коди НСЗУ просто в рядку
    # списку й шукають за кодом — без цього зрізу довелося б або тягнути
    # мегабайт на першому кадрі, або дублювати зв'язок на обидва вузли.
    rels = {}
    for rel in EDGE_RELS:
        rows = [e for e in edges if e["rel"] == rel]
        p = write(f"edges_{rel}.json", rows)
        rels[rel] = {"file": p.name, "count": len(rows),
                     "kb": round(p.stat().st_size / 1024)}

    # Текст кваліфікаційних характеристик — 1,7 МБ, і в графі йому не місце:
    # це тіло документа, а не сутність чи зв'язок. Лежить окремо під тими
    # самими ідентифікаторами вузлів і вантажиться лише з паспортом.
    text = {f"dkhp:{k}": {"blocks": v["blocks"], "orders": v["orders"]}
            for k, v in posady_cards.items()}
    tpath = write("text_dkhp.json", text)

    ipath = write("graph_index.json", {
        "generated": graph["generated"],
        "node_types": NODE_TYPES,
        "edge_rels": EDGE_RELS,
        "labels": graph["labels"],
        "tones": TONES,
        # Назви пакетів окремим реєстром: на вузлі вимоги вони повторювалися б
        # 356 разів, а потрібні для одного випадаючого списку.
        "packages": {p["package"]: p["name"] for p in spec_pkg},
        "counts": {**actual, "nodes": dict(by_type), "edges": dict(by_rel)},
        # Зауваги до джерел лишаються ТАКИМИ, як їх склав білдер-власник, і
        # розкладені за типом вузла. Звести їх у спільний список спокусливо,
        # але тоді панелі «Вад джерел» на обох сторінках довелося б зробити
        # однаковими списками, а вони показують різне: у спеціальностей це
        # розриви між трьома актами, у посад — застарілі назви кодів, лакуни
        # Довідника і дефекти його зведеного тексту.
        "notes": {"spec": defects, "dkhp": dkhp_notes},
        "files": files,
        "rels": rels,
        "text": {"dkhp": {"file": tpath.name,
                          "kb": round(tpath.stat().st_size / 1024)}},
        "graph": {"file": "graph.json",
                  "kb": round(path.stat().st_size / 1024)},
    })

    print(f"Вузли:  {sum(by_type.values())}")
    for t in ("spec", "post", "dkhp", "code", "pkgreq", "profstd"):
        print(f"   {t:8s} {by_type[t]:5d}  {NODE_TYPES[t]['label']}")
    print(f"\nРебра:  {len(edges)}")
    for r, n in sorted(by_rel.items()):
        d = EDGE_RELS[r]
        print(f"   {d['from']:6s} → {d['to']:6s} {n:5d}  {d['means']}")

    print("\nЗвірка з контрольними числами:")
    for line in check_lines:
        print(line)

    print("\nДе рветься ланцюжок:")
    print(f"   спеціальностей без посади в Переліку ....... {len(gaps['spec_without_post']):4d}")
    print(f"   посад Переліку без спеціальності ........... {len(gaps['post_without_spec']):4d}")
    print(f"   посад Переліку без характеристики ДКХП ..... {len(gaps['post_without_dkhp']['position']):4d}"
          f"   ← рахує цей білдер, більше ніде немає")
    print(f"   позицій-ролей без характеристики ........... {len(gaps['post_without_dkhp']['role']):4d}"
          f"   (характеристики не мають за визначенням)")
    print(f"   характеристик ДКХП без коду НСЗУ ........... {len(gaps['dkhp_without_code']):4d}")
    print(f"   вимог без посади Переліку .................. {len(gaps['req_without_post']):4d}")
    print(f"   вимог без характеристики ДКХП .............. {len(gaps['req_without_dkhp']):4d}")
    print(f"   назв посад із вимог поза Переліком ......... {len(gaps['orphan_names']):4d}")
    print(f"\nМісток посада → ДКХП за рівнями: {post_dkhp_levels}")

    print(f"\nЗаписано в {OUT_DIR}")
    print(f"   graph_index.json   {ipath.stat().st_size / 1024:6.0f} КБ  шапка")
    for f in files.values():
        print(f"   {f['file']:19s}{f['kb']:6d} КБ  {f['count']:5d} вузлів"
              f"   + {f['cards']} {f['cards_kb']} КБ")
    for f in rels.values():
        print(f"   {f['file']:19s}{f['kb']:6d} КБ  {f['count']:5d} ребер")
    print(f"   graph.json         {path.stat().st_size / 1024:6.0f} КБ  повний граф, ліниво")
    print(f"   text_dkhp.json     {tpath.stat().st_size / 1024:6.0f} КБ  текст характеристик, ліниво")
    if not ok:
        print("\n[ДІЯ] Числа розійшлися з контрольними. Це не збій графа: котресь "
              "із джерел оновилося.\n       Перевірити check_kadry.py, перезібрати "
              "розділи, і аж тоді правити EXPECTED.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
