# -*- coding: utf-8 -*-
"""
Білдер розділу «Посади» для НавігаторПМГ26.

Склеює три джерела, які в оригіналі ніде не перетинаються:

  1. ДКХП. Випуск 78 «Охорона здоров'я» — Довідник кваліфікаційних характеристик
     професій працівників (наказ МОЗ від 29.03.2002 № 117, чинна редакція від
     24.02.2025 за наказом № 307). 505 сторінок, 258 характеристик.
     Файл: 0_10_класификатори/профексії/Довідник ... d249235-20250224.pdf
  2. «Коди посад НСЗУ 2026» — 286 кодів P1–P286, те, чим ЗОЗ реально кодує
     персонал. Файл: 0_10_класификатори/профексії/Коди посад НСЗУ 2026.pdf
  3. Блок «Спеціалісти» (section.key == "specialists") зі специфікацій пакетів
     ПМГ-2026 — pakety/data/packages_2026.json. Дає зворотний зв'язок
     «посада → у яких пакетах вона є кадровою вимогою».

ПАСТКИ (перевірено 03.08.2026):
  1. PyMuPDF ріже вирівняні по ширині рядки на окремі «lines» пословно (великі
     міжслівні пробіли). Тому візуальні рядки збираємо самі — групуванням спанів
     за y з допуском 3 pt, а не через line['spans'].
  2. Абзац визначається відступом: тіло рядка стоїть на x0 = 72.0, перший рядок
     абзацу — на 94.5. Іншого маркера в PDF немає.
  3. Шрифти несуть усю структуру: Bold 14/16 — розділ, Bold 12 на весь рядок
     великими літерами — назва посади, Bold 12 на початку рядка — мітка блоку
     («Завдання та обов'язки.», «Повинен знати:», «Кваліфікаційні вимоги.»),
     Italic — примітки про зміни у фігурних дужках.
  4. Перенос рядка стається лише на наявному дефісі («виробничо-господарською»),
     тож дефіс зберігаємо і склеюємо без пробілу.
  5. У ЧИННІЙ редакції ДКХП посади «провізор» НЕМАЄ — її всюди замінено на
     «фармацевт». А довідник кодів НСЗУ тримає обидва набори як окремі коди
     (P21 Провізор ↔ P16 Фармацевт і ще 6 пар). Розводимо через ALIASES:
     застарілий код показуємо, але паспорт віддаємо від чинної назви.
  6. Назви в специфікаціях пакетів пливуть: «Сестра медична / брат медичний»,
     «Сестра медична/брат медичний», «Сестра медична /брат медичний» — три
     написання одного. Без нормалізації зіставлення розсипається.

Вихід у ./data/posady:
  posady_meta.json  — підсумки, розділи, лакуни, зауваги до джерел.
  posady_index.json — легкий список для дерева й пошуку.
  posady_cards.json — паспорти (три блоки + примітки), вантажиться лениво.
  posady_pkg.json   — кадрові вимоги пакетів ПМГ-2026.
"""
import json, re, sys, time
from collections import Counter, defaultdict
from pathlib import Path

import fitz  # PyMuPDF

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
DATA = BASE / "data" / "posady"
DATA.mkdir(parents=True, exist_ok=True)

SRC_DIR = Path(r"D:\pmg-data\0_10_класификатори\профексії")
PDF_DKHP = next(SRC_DIR.glob("Довідник кваліфікаційних*.pdf"), None)
PDF_CODES = SRC_DIR / "Коди посад НСЗУ 2026.pdf"
PKG_JSON = BASE.parent / "pakety" / "data" / "packages_2026.json"

BODY_X = 72.0          # ліва межа тіла тексту
INDENT_X = 90.0        # усе, що правіше — початок абзацу або заголовок
SEC_SIZE = 13.5        # від цього кегля починаються назви розділів

# Мітки блоків усередині характеристики.
BLOCKS = [
    ("duties", re.compile(r"^Завдання\s+та\s+обов['’ʼ]язки\b")),
    ("knowledge", re.compile(r"^Повинен\s+знати\b")),
    ("req", re.compile(r"^Кваліфікаційні\s+вимоги\b", re.I)),
]

# Пари «застаріла або скорочена назва → чинна назва характеристики».
ALIASES = {
    # Провізорів у чинному ДКХП немає — усюди «фармацевт» (пастка 5).
    "провізор": "фармацевт",
    "старший провізор": "старший фармацевт",
    "провізор клінічний": "фармацевт клінічний",
    "провізор-аналітик": "фармацевт-аналітик",
    "провізор-косметолог": "фармацевт-косметолог",
    "провізор-токсиколог": "фармацевт-токсиколог",
    "провізор-інтерн": "фармацевт-інтерн",
    # Керівні коди НСЗУ — короткі форми однієї характеристики.
    "генеральний директор": "Генеральний директор (директор) / начальник (завідувач) закладу охорони здоров'я",
    "директор": "Генеральний директор (директор) / начальник (завідувач) закладу охорони здоров'я",
    "начальник": "Генеральний директор (директор) / начальник (завідувач) закладу охорони здоров'я",
    "завідувач": "Генеральний директор (директор) / начальник (завідувач) закладу охорони здоров'я",
    "головний лікар": "Генеральний директор (директор) / начальник (завідувач) закладу охорони здоров'я",
    "заступники з числа лікарів":
        "Заступник генерального директора (директора) / начальника (завідувача) закладу охорони здоров'я",
    "заступники з числа фармацевтів (завідувача, начальника)":
        "Заступник генерального директора (директора) / начальника (завідувача) закладу охорони здоров'я",
    "головний державний санітарний лікар - головний лікар":
        "Генеральний директор центру контролю і профілактики хвороб - головний державний санітарний лікар",
    "лаборант": "Лаборант (медицина)",
    # У специфікаціях пакетів первинки посада зветься за видом допомоги.
    "лікар з надання пмд": "Лікар загальної практики - сімейний лікар",
    "дитячий хірург": "Лікар-хірург дитячий",
}

# Наказ МОЗ № 805 від 10.04.2019 переназвав посади у парну форму: «сестра
# медична / брат медичний», «акушер/акушерка», «санітар/санітарка». Довідник
# кодів НСЗУ і специфікації пакетів лишилися на старих назвах, тож для
# зіставлення обидві сторони зводимо до однієї форми (пастка 8).
GENDER = [
    (r"\s*/\s*брат\s+медичний\b", ""),
    (r"\s*/\s*брата\s+медичного\b", ""),
    (r"\s*/\s*медичний\s+брат\b", ""),
    (r"\s*/\s*медичного\s+брата\b", ""),
    (r"\bбрат\s+медичний\b", ""),
    (r"\bмедичний\s+брат\b", ""),
    (r"\bакушер\s*/\s*(?=акушерк)", ""),
    (r"\bсанітар\s*/\s*(?=санітарк)", ""),
    (r"\bсестри\s+медичної\b", "сестра медична"),
    (r"\bмедичної\s+сестри\b", "медична сестра"),
]

# Коди НСЗУ, які взагалі не є посадами — це юридичні статуси або
# загальноадміністративні посади поза сферою Випуску 78.
NOT_A_POSITION = re.compile(
    r"^(в\.о\.|т\.в\.о\.|фоп|ліквідатор|керуючий санацією|розпорядник майна|"
    r"особа\s*[–—-]\s*управитель|голова комісії|керівник$)", re.I)
ADMIN_GENERIC = {
    "спеціаліст відділу кадрів", "комерційний директор", "начальник відділу",
    "начальник управління", "директор департаменту", "головний спеціаліст",
    "виконавчий директор", "спеціаліст", "голова", "заступник голови",
    "працівник реєстратури", "керівник",
}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ─────────────────────────────── нормалізація ────────────────────────────────

APOS = str.maketrans({"’": "'", "ʼ": "'", "`": "'", "´": "'"})


def norm(s):
    """Ключ для зіставлення назв між трьома джерелами."""
    s = (s or "").translate(APOS).lower()
    s = re.sub(r"[«»\"]", "", s)
    s = re.sub(r"\s*[/]\s*", "/", s)
    # прийменники й сполучники, що різняться між джерелами: із/зі/з, та/і/й
    s = re.sub(r"\b(із|зі|iз)\b", "з", s)
    s = re.sub(r"\b(та|й)\b", "і", s)
    s = re.sub(r"[^\w'/-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def key(s):
    """Жорсткіший ключ: без дефісів і слешів — для м'якого зіставлення."""
    return re.sub(r"[\s'/-]+", "", norm(s))


def canon(s):
    """Ключ зіставлення зі згорнутою парною формою назви (пастка 8)."""
    s = norm(s)
    for rx, rep in GENDER:
        s = re.sub(rx, rep, s)
    # «сестра медична операційна / брат медичний операційна» після згортання
    # лишає подвоєне слово — прибираємо.
    words, out = s.split(), []
    for w in words:
        if not out or out[-1] != w:
            out.append(w)
    return key(" ".join(out))


# ─────────────────────────────── читання PDF ─────────────────────────────────

def visual_lines(page):
    """Візуальні рядки сторінки: спани, згруповані за y (пастка 1)."""
    spans = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                if s["text"].strip():
                    spans.append(s)
    spans.sort(key=lambda s: (round(s["bbox"][1], 1), s["bbox"][0]))

    groups, cur = [], []
    for s in spans:
        if cur and abs(s["bbox"][1] - cur[0]["bbox"][1]) > 3:
            groups.append(cur)
            cur = []
        cur.append(s)
    if cur:
        groups.append(cur)

    out = []
    for g in groups:
        g.sort(key=lambda s: s["bbox"][0])
        txt, prev_x1 = "", None
        for s in g:
            t = s["text"]
            if txt and not txt.endswith(" ") and not t.startswith(" ") \
               and prev_x1 is not None and s["bbox"][0] - prev_x1 > 1:
                txt += " "
            txt += t
            prev_x1 = s["bbox"][2]
        # Заголовок, що не вмістився в рядок, лишає по собі хвостовий пробіл
        # або дефіс — це єдина ознака переносу, яку дає PDF (пастка 7).
        wrap = txt.endswith(" ") or txt.endswith("-")
        txt = txt.rstrip()
        if not txt or txt.strip().isdigit():
            continue
        body = [s for s in g if s["text"].strip()]
        out.append({
            "t": txt,
            "wrap": wrap,
            "x0": min(s["bbox"][0] for s in body),
            "size": max(s["size"] for s in body),
            "bold": all("Bold" in s["font"] for s in body),
            "italic": all("Italic" in s["font"] or "Ital" in s["font"] for s in body),
            # довжина суцільного жирного префікса — мітка блоку чи підзаголовок
            "lead": _bold_lead(g),
        })
    return out


def _bold_lead(spans):
    lead = ""
    for s in spans:
        if "Bold" not in s["font"]:
            break
        lead += s["text"]
    return lead.strip()


def join(prev, nxt):
    """Склейка перенесеного рядка (пастка 4)."""
    if prev.endswith("-"):
        return prev + nxt.lstrip()
    if not prev.endswith(" ") and nxt:
        return prev + " " + nxt.lstrip()
    return prev + nxt.lstrip()


def is_title(line):
    """Рядок «N. НАЗВА ПОСАДИ» — жирний, великими літерами."""
    if not line["bold"] or line["size"] > SEC_SIZE:
        return False
    m = re.match(r"^\d+\.\s+(.+)$", line["t"].strip())
    if not m:
        return False
    return is_caps(m.group(1))


def is_caps(s):
    # «57. ДИСПЕТЧЕР ОПЕРАТИВНО-ДИСПЕТЧЕРСЬКОЇ СЛУЖБИ (медицина)» — уточнення
    # в дужках подекуди набране малими літерами, на регістр назви не впливає.
    bare = re.sub(r"\([^)]*\)", " ", s)
    if any(c.isalpha() for c in bare):
        s = bare        # «(БЮРО СУДОВО-МЕДИЧНОЇ ЕКСПЕРТИЗИ)» — дужки і є назвою
    letters = [c for c in s if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters)


# ───────────────────────────── парсер ДКХП-78 ────────────────────────────────

def parse_dkhp(pdf):
    doc = fitz.open(pdf)
    entries, sections = [], []
    section = sub = None
    cur = None            # поточна характеристика
    block = None          # duties | knowledge | req
    para = None           # накопичувач абзацу
    pending_title = False # ідемо по багаторядковій назві посади
    sec_buf = []          # багаторядкова назва розділу

    # Розділи верхнього рівня — щоб відрізняти розділ від підрозділу.
    TOP = {"КЕРІВНИКИ", "ПРОФЕСІОНАЛИ", "ФАХІВЦІ", "ТЕХНІЧНІ СЛУЖБОВЦІ", "РОБІТНИКИ"}

    def flush_para():
        nonlocal para
        if cur and para and para["t"].strip():
            para["t"] = re.sub(r"\s+", " ", para["t"]).strip()
            cur["blocks"].setdefault(block or "intro", []).append(para)
        para = None

    def flush_section():
        nonlocal section, sub, sec_buf
        if not sec_buf:
            return
        name = sec_buf[0]
        for part in sec_buf[1:]:
            name = join(name, part)
        name = re.sub(r"\s+", " ", name).strip()
        sec_buf = []
        if name in ("КВАЛІФІКАЦІЙНІ ХАРАКТЕРИСТИКИ",):
            return
        if name in TOP:
            section, sub = name, None
        else:
            sub = name
        sections.append({"section": section, "sub": sub})

    for pno in range(3, 489):                      # тіло: с. 4–489
        for line in visual_lines(doc[pno]):
            t = line["t"].strip()

            # ── назва розділу / підрозділу
            if line["bold"] and line["size"] >= SEC_SIZE:
                flush_para()
                pending_title = False
                sec_buf.append(t)
                if not line["wrap"]:      # заголовок дочитано (пастка 7)
                    flush_section()
                continue
            if sec_buf:
                flush_section()

            # ── назва посади
            if is_title(line):
                flush_para()
                num, name = re.match(r"^(\d+)\.\s+(.+)$", t).groups()
                cur = {
                    "num": int(num), "name": name, "section": section,
                    "sub": sub, "page": pno + 1, "blocks": {},
                }
                entries.append(cur)
                block, pending_title = None, line["wrap"]
                continue

            # ── продовження багаторядкової назви
            if pending_title and line["bold"] and is_caps(t) \
               and not re.match(r"^\d", t) and line["x0"] > INDENT_X:
                cur["name"] = join(cur["name"], t)
                pending_title = line["wrap"]
                continue
            pending_title = False

            if cur is None:
                continue

            # ── «КВАЛІФІКАЦІЙНІ ВИМОГИ» окремим жирним рядком великими літерами
            if line["bold"] and is_caps(t) and BLOCKS[2][1].match(t):
                flush_para()
                block = "req"
                continue

            # ── початок нового абзацу (пастка 2)
            starts = line["x0"] > INDENT_X
            if starts:
                flush_para()
                # Деякі характеристики покривають кілька варіантів посади й
                # усередині мають власні жирні підзаголовки великими літерами
                # («ЗАВІДУВАЧ ВІДДІЛУ АПТЕКИ»). Вони починають опис заново.
                variant = line["bold"] and is_caps(t) and len(t) < 100
                if variant:
                    block = "duties"
                else:
                    for name_, rx in BLOCKS:
                        if rx.match(t):
                            block = name_
                            break
                para = {
                    "t": t,
                    "lead": line["lead"] if line["lead"] and len(line["lead"]) < 120 else "",
                    "note": t.startswith("{") or line["italic"],
                }
                if variant:
                    para["variant"] = True
            elif para is not None:
                para["t"] = join(para["t"], t)
            # рядок до першої характеристики — ігноруємо

    flush_para()
    log(f"ДКХП: {len(entries)} характеристик, розділів/підрозділів {len(sections)}")
    return entries, doc


def parse_index(doc):
    """Абетковий покажчик (с. 490–505) — для звірки повноти."""
    names = []
    for pno in range(489, doc.page_count):
        for line in visual_lines(doc[pno]):
            m = re.match(r"^\d+\.\s+(.+?)\s*$", line["t"].strip())
            if m and not line["bold"]:
                names.append(m.group(1))
    return names


# ─────────────────────────── коди посад НСЗУ 2026 ────────────────────────────

def parse_codes(pdf):
    doc = fitz.open(pdf)
    rows = []
    for pno in range(doc.page_count):
        for line in visual_lines(doc[pno]):
            m = re.match(r"^(P\d+)\s+(.+)$", line["t"].strip())
            if m:
                rows.append({"code": m.group(1), "name": m.group(2).strip()})
    rows.sort(key=lambda r: int(r["code"][1:]))
    log(f"Коди НСЗУ: {len(rows)} (P1–P{rows[-1]['code'][1:]})")
    return rows


# ───────────────────── кадрові вимоги пакетів ПМГ-2026 ───────────────────────

MARKER = re.compile(r"^\s*(?:\d+\.|[a-zа-я]\.)\s*", re.I)


def parse_packages(path):
    if not path.exists():
        log("! packages_2026.json не знайдено — блок пакетів пропущено")
        return {}, [], []
    d = json.loads(path.read_text(encoding="utf-8"))
    hits = defaultdict(list)
    raw = []
    heads = []
    for pkg in d.get("packages", []):
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
                    # «1. За місцем надання медичних послуг (критичні*):» — це
                    # заголовок групи, він задає контекст наступним підпунктам.
                    if body.endswith(":"):
                        scope = body.rstrip(":").strip()
                        continue
                    m = split_requirement(body)
                    if not m:
                        continue
                    name, cond = m
                    raw.append(name)
                    parts = split_names(name)
                    # Голова вимоги — дослівний шматок тексту пункту до тире.
                    # Її віддаємо на фронт як якір: сторінка шукає її через
                    # indexOf і лінкує назви ЛИШЕ всередині неї, тож парсер
                    # вимоги не доводиться писати вдруге на JS.
                    heads.append({"pkg": pkg.get("number"), "h": name, "p": parts})
                    for part in parts:
                        hits[canon(part)].append({
                            "pkg": pkg.get("number"),
                            "title": pkg.get("title"),
                            "name": part,
                            "scope": scope,
                            "cond": cond,
                            "critical": "критичн" in (scope + " " + cond).lower(),
                        })
    log(f"Пакети: {len(raw)} згадок спеціалістів, {len(hits)} унікальних посад")
    return hits, raw, heads


def split_requirement(body):
    """Ділить «Посада – вимога» по першому тире ПОЗА дужками.

    «Лікар з надання ПМД (лікар загальної практики – сімейний лікар) – …»:
    наївний нежадібний пошук зупиняється на тире всередині дужок і обрізає
    назву посади посередині.
    """
    depth = 0
    for i, ch in enumerate(body):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif depth == 0 and (ch in "–—" or (ch == "-" and 0 < i < len(body) - 1
                                            and body[i - 1] == " "
                                            and body[i + 1] == " ")):
            name, cond = body[:i].strip(), body[i + 1:].strip()
            if 3 <= len(name) <= 160 and cond:
                return name, cond
            return None
    return None


def split_names(name):
    """«Лікар-анестезіолог та/або лікар-анестезіолог дитячий» — це дві посади.

    Ділимо ЛИШЕ по «та/або», «і/або», «або» — голе «та» всередині назви
    сполучає її частини: «Лікар фізичної та реабілітаційної медицини»,
    «Терапевт мови і мовлення».
    """
    parts = re.split(r"\s*,?\s+(?:та\s*/\s*або|і\s*/\s*або|та\s+або|або)\s+", name)
    out = []
    for p in parts:
        p = p.strip(" .;,")
        # «клінічний психолог (психолог)» — уточнення в кінці не є частиною назви
        p = re.sub(r"\s*\([^)]*\)\s*$", "", p).strip()
        if len(p) > 3:
            out.append(p)
    return out or [name]


def build_pkg_links(heads, id_of_key, name_of_id):
    """Карта для лінкування назв посад просто в тексті вимоги пакета.

    Фронт не має права розбирати вимогу вдруге — це другий парсер того самого,
    і він неминуче розійдеться з цим. Тому віддаємо готові координати:
    голову вимоги дослівно (сторінка знаходить її в тексті пункту через
    indexOf) і зсуви назв УСЕРЕДИНІ голови. Так посилання не потрапить у
    хвіст умови, де та сама посада згадана у знахідному відмінку.
    """
    out, used, dropped = defaultdict(list), {}, Counter()
    for h in heads:
        head, spans, cursor = h["h"], [], 0
        for part in h["p"]:
            pid = id_of_key.get(canon(part))
            if pid is None:
                continue
            off = head.find(part, cursor)
            if off < 0:
                # split_names зрізає хвостовий уточнювач у дужках, тож частина
                # завжди має лишатися дослівним шматком голови. Якщо ні —
                # мовчки не лінкуємо, а рахуємо: це сигнал, що правило змінилося.
                dropped[part] += 1
                continue
            spans.append([off, len(part), pid])
            used[pid] = name_of_id.get(pid, "")
            cursor = off + len(part)
        if spans:
            out[h["pkg"]].append({"h": head, "p": spans})

    # Той самий рядок вимоги трапляється у пакеті двічі (різні блоки послуг) —
    # координати однакові, тримати обидві копії немає сенсу.
    links = {}
    for pkg, rows in out.items():
        seen, uniq = set(), []
        for r in rows:
            if r["h"] in seen:
                continue
            seen.add(r["h"])
            uniq.append(r)
        links[str(pkg)] = uniq

    if dropped:
        log(f"! назв поза головою вимоги: {sum(dropped.values())} "
            f"({', '.join(list(dropped)[:3])})")
    log(f"Лінки в пакетах: {sum(len(v) for v in links.values())} вимог "
        f"у {len(links)} пакетах, {len(used)} посад")
    return {"pkgs": links, "names": used,
            "counts": {"packages": len(links), "positions": len(used),
                       "requirements": sum(len(v) for v in links.values()),
                       "dropped": sum(dropped.values())}}


# ──────────────────────────────── зіставлення ────────────────────────────────

def build():
    if not PDF_DKHP or not PDF_DKHP.exists():
        sys.exit("Не знайдено PDF ДКХП-78")

    entries, doc = parse_dkhp(PDF_DKHP)
    idx_names = parse_index(doc)
    codes = parse_codes(PDF_CODES)
    pkg_hits, pkg_raw, pkg_heads = parse_packages(PKG_JSON)

    # ── ідентифікатори та пошукові ключі
    seen = Counter()
    by_key, by_key_name = {}, {}
    for e in entries:
        e["name"] = tidy_name(e["name"])
        slug = key(e["name"])
        seen[slug] += 1
        e["id"] = slug if seen[slug] == 1 else f"{slug}~{seen[slug]}"
        by_key.setdefault(slug, e)
        by_key.setdefault(canon(e["name"]), e)
        by_key_name[e["id"]] = e["name"]

    def resolve(name):
        """Назва з іншого джерела → характеристика ДКХП (або None)."""
        for cand in variants(name):
            hit = by_key.get(canon(cand)) or by_key.get(key(cand))
            if hit is not None:
                return hit, None
            alias = ALIASES.get(norm(cand))
            if alias:
                hit = by_key.get(canon(alias)) or by_key.get(key(alias))
                if hit is not None:
                    return hit, alias
        for cand in variants(name):
            hit = soft_match(canon(cand), by_key)
            if hit is not None:
                return hit, None
        return None, None

    # ── коди НСЗУ → характеристика
    lacunae, alias_pairs = [], []
    code_of = defaultdict(list)
    for c in codes:
        c["kind"] = classify_code(c["name"])
        target, via = resolve(c["name"])
        if target is not None:
            c["dkhp"] = target["id"]
            code_of[target["id"]].append(c["code"])
            if via:
                # Показуємо чинну назву характеристики, а не сирий ключ аліаса.
                c["alias_of"] = target["name"]
                alias_pairs.append((c["code"], c["name"], target["name"]))
        else:
            c["dkhp"] = None
            if c["kind"] == "position":
                lacunae.append(c)

    # Назви кодів, що не збігаються з назвою характеристики, лишаються
    # пошуковими синонімами: хто шукає «провізор», має знайти «фармацевта».
    alt_of = defaultdict(list)
    for c in codes:
        if c["dkhp"] and key(c["name"]) != key(by_key_name.get(c["dkhp"], "")):
            alt_of[c["dkhp"]].append(c["name"])

    for e in entries:
        e["codes"] = sorted(code_of.get(e["id"], []), key=lambda x: int(x[1:]))
        e["alt"] = sorted(set(alt_of.get(e["id"], [])))

    # ── кадрові вимоги пакетів → характеристика
    pkg_of = defaultdict(list)
    pkg_unmatched = Counter()
    id_of_key = {}
    for k, rows in pkg_hits.items():
        target, _ = resolve(rows[0]["name"])
        if target is not None:
            pkg_of[target["id"]].extend(rows)
            id_of_key[k] = target["id"]
        else:
            pkg_unmatched[rows[0]["name"]] += len(rows)

    def pkg_sort(n):
        m = re.match(r"^(\d+)", str(n or ""))
        return (int(m.group(1)) if m else 999, str(n))

    for e in entries:
        rows = pkg_of.get(e["id"], [])
        e["pkgs"] = sorted({r["pkg"] for r in rows}, key=pkg_sort)
        e["pkg_rows"] = sorted(rows, key=lambda r: pkg_sort(r["pkg"]))

    pkg_links = build_pkg_links(pkg_heads, id_of_key, by_key_name)

    # ── видача
    meta = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": {
            "dkhp": {
                "title": "Довідник кваліфікаційних характеристик професій працівників. "
                         "Випуск 78 «Охорона здоров'я»",
                "order": "наказ МОЗ від 29.03.2002 № 117",
                "edition": "редакція від 24.02.2025 (наказ МОЗ від 24.02.2025 № 307)",
                "status": "чинний",
                "url": "https://zakon.rada.gov.ua/go/va117282-02",
                "pages": doc.page_count,
            },
            "codes": {
                "title": "Коди посад НСЗУ 2026",
                "note": "довідник кодування персоналу для договірної кампанії",
            },
            "packages": {
                "title": "Специфікації пакетів ПМГ-2026, блок «Спеціалісти»",
                "order": "постанова КМУ від 31.12.2025 № 1808",
            },
        },
        "counts": {
            "entries": len(entries),
            "index_names": len(idx_names),
            "codes": len(codes),
            "codes_matched": sum(1 for c in codes if c["dkhp"]),
            "pkg_mentions": len(pkg_raw),
            "pkg_positions": sum(1 for e in entries if e["pkgs"]),
            "packages_with_staff": len({r["pkg"] for rows in pkg_of.values() for r in rows}),
        },
        "sections": section_stats(entries),
        "aliases": [{"code": c, "name": n, "current": v} for c, n, v in alias_pairs],
        "lacunae": [{"code": c["code"], "name": c["name"]} for c in lacunae],
        "pkg_unmatched": [{"name": n, "hits": h} for n, h in pkg_unmatched.most_common()],
        # Дефекти самого джерела: у зведеному тексті мітка блоку подекуди
        # втоплена всередину абзацу, тож блок не виділяється.
        "no_block": [{"id": e["id"], "name": e["name"], "page": e["page"],
                      "missing": [b for b in ("duties", "knowledge", "req")
                                  if b not in e["blocks"]]}
                     for e in entries
                     if not all(b in e["blocks"] for b in ("duties", "req"))],
        "notes": [
            "У чинній редакції ДКХП посади «провізор» немає — її замінено на "
            "«фармацевт». Довідник кодів НСЗУ тримає обидві назви як окремі коди.",
            "Наказ МОЗ № 805 від 10.04.2019 переназвав посади у парну форму "
            "(«сестра медична / брат медичний», «акушер/акушерка»). Коди НСЗУ і "
            "специфікації пакетів лишилися на попередніх назвах — тут вони зведені.",
            "Коди-статуси (в.о., т.в.о., ФОП, ліквідатор, розпорядник майна) не є "
            "посадами і кваліфікаційної характеристики не мають за визначенням.",
            "Абетковий покажчик наприкінці Довідника не встигає за змінами: у ньому "
            "лишилися назви до наказу № 805 і позиція «Позицію виключено», а трьох "
            "нових характеристик немає. Розділ побудовано за текстом Довідника, не "
            "за покажчиком.",
        ],
    }

    index = [{
        "id": e["id"], "num": e["num"], "name": e["name"],
        "section": e["section"], "sub": e["sub"], "page": e["page"],
        "codes": e["codes"], "alt": e["alt"], "pkgs": e["pkgs"],
    } for e in entries]

    cards = {e["id"]: {
        "id": e["id"], "name": e["name"], "num": e["num"],
        "section": e["section"], "sub": e["sub"], "page": e["page"],
        "codes": e["codes"], "alt": e["alt"], "pkgs": e["pkgs"], "pkg_rows": e["pkg_rows"],
        "blocks": e["blocks"], "orders": orders_of(e),
    } for e in entries}

    write(DATA / "posady_meta.json", meta)
    write(DATA / "posady_index.json", index)
    write(DATA / "posady_cards.json", cards)
    write(DATA / "posady_codes.json", codes)
    write(DATA / "posady_pkg.json", {"generated": meta["generated"], **pkg_links})

    log(f"Готово: {len(entries)} характеристик, {len(codes)} кодів "
        f"({meta['counts']['codes_matched']} зіставлено), "
        f"{meta['counts']['pkg_positions']} посад у пакетах ПМГ")
    if len(entries) != len(idx_names):
        log(f"! Звірка з абетковим покажчиком: {len(entries)} проти {len(idx_names)}")


def tidy_name(s):
    s = re.sub(r"\s+", " ", s).strip()
    # у покажчику назви записані з великої, у тілі — капсом
    return s[0] + s[1:].lower() if s.isupper() else s


def classify_code(name):
    n = norm(name)
    if NOT_A_POSITION.match(name.strip()):
        return "status"
    if n in ADMIN_GENERIC:
        return "admin"
    return "position"


def variants(name):
    """Назва + вона ж без уточнювального звороту.

    У специфікаціях пакетів посада часто йде з умовою: «Лікар-невропатолог,
    який має відповідну підготовку з надання медичної допомоги при гострому
    мозковому інсульті». Характеристика — на базову посаду.
    """
    out = [name]
    cut = re.sub(r",\s*(?:який|яка|які|що)\s.*$", "", name, flags=re.I)
    cut = re.sub(r"\s+стаж\s+роботи\b.*$", "", cut, flags=re.I).strip()
    if cut != name and len(cut) > 3:
        out.append(cut)
    return out


def soft_match(k, by_key):
    """М'яке зіставлення: точний ключ уже не спрацював, пробуємо префікс."""
    if len(k) < 8:
        return None
    best = None
    for cand, e in by_key.items():
        if cand == k:
            return e
        if not (cand.startswith(k) or k.startswith(cand)):
            continue
        if abs(len(cand) - len(k)) <= 3:
            return e
        # «Сестра медична / брат медичний загальної практики» у специфікації
        # обірвана — характеристика зветься «…-сімейної медицини». Довгий
        # префікс однозначний, беремо найкоротшого кандидата.
        if len(k) >= 18 and cand.startswith(k) and (best is None or len(cand) < len(best[0])):
            best = (cand, e)
    return best[1] if best else None


ORDER_RX = re.compile(r"№\s*([\dО\-]+)\s+від\s+(\d{2}\.\d{2}\.\d{4})")


def orders_of(entry):
    out = {}
    for paras in entry["blocks"].values():
        for p in paras:
            if not p.get("note"):
                continue
            for num, date in ORDER_RX.findall(p["t"]):
                out[(num, date)] = True
    return [{"num": n, "date": d} for n, d in sorted(
        out, key=lambda x: tuple(reversed(x[1].split("."))))]


def section_stats(entries):
    out = []
    seen = {}
    for e in entries:
        k = (e["section"], e["sub"])
        if k not in seen:
            seen[k] = {"section": e["section"], "sub": e["sub"], "count": 0}
            out.append(seen[k])
        seen[k]["count"] += 1
    return out


def write(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    log(f"  → {path.name}  {path.stat().st_size / 1024:.0f} КБ")


if __name__ == "__main__":
    build()
