# -*- coding: utf-8 -*-
"""
Розбір блоку «Спеціалісти» специфікацій пакетів ПМГ-2026 — спільний для всіх,
хто його читає.

ЧОМУ ОКРЕМИЙ МОДУЛЬ. Той самий блок парсили двічі: build_posady.py зіставляв
його з ДКХП, build_specialnosti.py — з Переліком посад МОЗ № 1065. Два різні
парсери на одному тексті давали різні числа (40 пакетів проти 41, 356 згадок
проти 357), тобто одна сутність мала дві правди. Тепер витяг і нормалізація
тут, а зіставлення лишається за кожним білдером — воно й має різнитися, бо
довідники різні.

СТРУКТУРА ДЖЕРЕЛА: packages[].units[].sections[key == "specialists"].items[].text

ПАСТКИ (набиті в build_posady.py, перенесені сюди разом із кодом):
  1. Той самий рядок вимоги повторюється в різних блоках послуг пакета.
     Без дедуплікації довгий перелік «та/або» множить пакет у картці кожної
     згаданої посади.
  2. Рядок, що закінчується двокрапкою, — це заголовок групи
     («1. За місцем надання медичних послуг (критичні*):»), він задає контекст
     наступним підпунктам, а не є вимогою.
  3. Тире всередині назви — не роздільник. Розріз по ПЕРШОМУ тире рубав
     перелік «та/або» навпіл. Беремо перше тире поза дужками, праворуч від
     якого текст схожий на умову («щонайменше…», число).
  4. Верхньої межі довжини назви немає навмисно: вимога буває переліком на
     півсотні посад (пакет 4 — ~1 800 знаків до тире), і колишній кап у 160
     символів мовчки викидав такі вимоги цілком.
  5. Ділити перелік можна ЛИШЕ по «та/або», «і/або», «або». Голе «та»
     сполучає частини однієї назви: «Лікар фізичної та реабілітаційної
     медицини», «Терапевт мови і мовлення».
"""
import json
import re
from collections import defaultdict

# Нумерація на початку пункту: «2.1.», «a.», «b)».
MARKER = re.compile(r"^\s*(?:\d+(?:\.\d+)*\.|[a-zа-яіїєґ][.)])\s*", re.I)
# Так починається умова вимоги, а не продовження назви посади.
COND_RE = re.compile(r"^(?:щонайменше|не\s+менше|принаймні|мінімум|за\s+наявност|у\s+раз[іi]|\d)", re.I)
# Ті самі слова для пошуку всередині рядка — без цифр: цифра буває в назві.
COND_WORD = re.compile(r"\b(?:щонайменше|не\s+менше|принаймні|мінімум)\b", re.I)


def split_requirement(body):
    """Ділить «Посада – вимога» по тире ПОЗА дужками (пастки 3 і 4).

    З усіх тире поза дужками беремо перше, ПРАВОРУЧ від якого текст схожий на
    умову. Якщо такого немає — перше тире. Нижня межа лишається: одна-дві
    літери перед тире — це не назва посади.
    """
    dashes = []
    depth = 0
    for i, ch in enumerate(body):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif depth == 0 and (ch in "–—" or (ch == "-" and 0 < i < len(body) - 1
                                            and body[i - 1] == " "
                                            and body[i + 1] == " ")):
            dashes.append(i)

    def cut(i):
        name, cond = body[:i].strip(), body[i + 1:].strip()
        if len(name) >= 3 and cond:
            return name, cond
        return None

    for i in dashes:
        m = cut(i)
        if m and COND_RE.match(m[1]):
            return m
    if dashes:
        # Друкарська хиба джерела: тире між назвою та умовою загублено
        # («Лікар — анестезіолог щонайменше 1 особа…», пакет 63). Умовне
        # слово всередині рядка — надійніший розріз, ніж перше-ліпше тире.
        w = COND_WORD.search(body)
        if w and w.start() > 3:
            return body[:w.start()].strip(" ,;–—-"), body[w.start():].strip()
        return cut(dashes[0])
    return None


def split_names(name, keep_tail=False):
    """«Лікар-анестезіолог та/або лікар-анестезіолог дитячий» — це дві посади
    (пастка 5).

    keep_tail=True лишає хвостове уточнення в дужках. Воно заважає, коли це
    синонім («клінічний психолог (психолог)»), і потрібне, коли це друга
    половина парної назви («Сестра медична (брат медичний)»): без неї посада
    з Переліку МОЗ у вимогу вже не вкладається. Розрізнити ці два випадки за
    формою не можна, тому віддаємо обидві версії, а вибирає той, хто зіставляє.
    """
    parts = re.split(r"\s*,?\s+(?:та\s*/\s*або|і\s*/\s*або|та\s+або|або)\s+", name)
    out = []
    for p in parts:
        p = p.strip(" .;,")
        # Вимога буває продовженням попереднього рядка і починається просто з
        # «та/або лікар-…» — сполучник на початку не є частиною назви.
        p = re.sub(r"^(?:та\s*/\s*або|і\s*/\s*або|або)\s+", "", p, flags=re.I).strip()
        if not keep_tail:
            p = re.sub(r"\s*\([^)]*\)\s*$", "", p).strip()
        if len(p) > 3:
            out.append(p)
    return out or [name]


def load_requirements(path):
    """Читає packages_2026.json і повертає плаский список вимог.

    Кожен запис:
      package  — номер пакета (рядок)
      title    — назва пакета
      scope    — заголовок групи, під яким стоїть вимога («У ЗОЗ (критичні*)»)
      raw      — текст пункту як у специфікації
      head     — назва(и) посад: усе до тире перед умовою
      cond     — умова: скільки осіб, за яким місцем роботи
      alts     — перелік окремих посад із head
      critical — чи стоїть вимога під заголовком «критичні»
    """
    if not path.exists():
        return []
    d = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for pkg in d.get("packages", []):
        seen = set()                       # пастка 1
        for unit in pkg.get("units", []):
            for sec in unit.get("sections", []):
                if sec.get("key") != "specialists":
                    continue
                scope = ""
                for it in sec.get("items", []):
                    txt = (it.get("text") or "").strip()
                    if not txt:
                        continue
                    body = MARKER.sub("", txt).strip()
                    if body.endswith(":"):          # пастка 2
                        scope = body.rstrip(":").strip()
                        continue
                    m = split_requirement(body)
                    if not m:
                        continue
                    name, cond = m
                    if (scope, body) in seen:
                        continue
                    seen.add((scope, body))
                    out.append({
                        "package": str(pkg.get("number")),
                        "title": pkg.get("title") or "",
                        "scope": scope,
                        "raw": txt,
                        "head": name,
                        "cond": cond,
                        "alts": split_names(name),
                        "alts_full": split_names(name, keep_tail=True),
                        "critical": "критичн" in (scope + " " + cond).lower(),
                    })
    return out


def group_by_package(reqs):
    """Той самий список, згрупований за пакетом — зручно для сторінок."""
    by = defaultdict(list)
    for r in reqs:
        by[r["package"]].append(r)
    return by


def stats(reqs):
    return {
        "requirements": len(reqs),
        "packages": len({r["package"] for r in reqs}),
        "mentions": sum(len(r["alts"]) for r in reqs),
        "distinct_names": len({a.lower() for r in reqs for a in r["alts"]}),
        "critical": sum(1 for r in reqs if r["critical"]),
    }
