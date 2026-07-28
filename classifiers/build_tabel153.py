# -*- coding: utf-8 -*-
"""
Білдер табелів оснащення — наказ МОЗ від 05.06.1998 № 153 «Про затвердження табелів
оснащення виробами медичного призначення структурних підрозділів закладів охорони здоров'я».

Офіційне джерело: https://zakon.rada.gov.ua/laws/show/v0153282-98 (поточна редакція
від 04.11.2010, підстава — наказ МОЗ від 04.11.2010 № 951). Текст на rada.gov.ua
підвантажується скриптом, тож знімок беремо з дзеркала, яке віддає готовий HTML
з таблицями: D:\\rpe-pmg\\tabel-153_1998.html (iplex.com.ua, код v0153282-98).
Нормативно-правові акти не є об'єктами авторського права (ст. 8 ЗУ «Про авторське право»).

Структура акта:
  Додаток 1 — лікувальні та діагностичні кабінети амбулаторно-поліклінічних закладів,
              розділи I–XV (XIV — лабораторне обладнання з підрозділами).
  Додаток 2 — стаціонарні відділення лікарень, розділи I–XXXVIII
              (XXXVIII — клінікодіагностична лабораторія з підрозділами).

Особливості вихідного тексту:
  · Текст 1998 року набрано моноширинно, слова переносяться з дефісом: «коагуля-<br>ції».
    Тому дефіс перед <br> ПРИБИРАЄМО (на відміну від НК 024, де переноси лише на наявному
    дефісі). Виняток — складені слова, список REAL_HYPHEN нижче (перевірено вручну).
  · У Додатку 2 рядок розділу несе кількість місць («I. Інтенсивна терапія | 15»),
    а кількість виробів у позиціях подано саме на цю кількість місць.
  · Лабораторні таблиці мають кілька колонок кількості: у Додатку 1 — за кількістю
    пацієнтів (550 / 1200), у Додатку 2 — за кількістю ліжок (до 199 … 600 і більше).
  · Позиції, виключені наказами № 158 і № 951, у тексті лишилися як примітки без рядків —
    їх зберігаємо як окремі записи зі статусом «виключено», щоб розділ читався повністю.

Вихід у ./data/tabel153:
  tabel153_meta.json  — акт, зміни, додатки, розділи з лічильниками й примітками.
  tabel153_index.json — усі позиції: [id, назва, кількості[], додаток, розділ, підрозділ, статус].
"""
import json, re, sys, time
from pathlib import Path
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
DATA = BASE / "data" / "tabel153"
DATA.mkdir(parents=True, exist_ok=True)

SRC = Path(r"D:\rpe-pmg\tabel-153_1998.html")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

# Складені слова, де дефіс наприкінці рядка справжній, а не знак переносу.
# Перевірено переглядом усіх склейок, де перша частина закінчується на «о»/«е».
REAL_HYPHEN = {
    "лікувально", "діагностично", "консультативно", "санітарно", "акушерсько",
    "серцево", "кислотно", "матеріально", "клініко", "спектро", "радіо",
    "апаратно", "приймально", "фізико", "хіміко", "імуно", "електро",
}

ROMAN_RE = re.compile(r"^([IVXL]+)\.?$")
NUM_RE = re.compile(r"^(\d+)\.?$")

# Поодинокі артефакти вихідного набору: слово перенесено БЕЗ дефіса (у комірках
# кількості, що об'єднують колонки), тож лишився пробіл посеред слова.
FIXUPS = {"мікроско пів": "мікроскопів"}

# Підписи колонок кількості читабельніше
LABEL_FIX = {"600": "600 і більше", "200 - 399": "200–399", "400 - 599": "400–599"}

def roman_val(s):
    vals = {"I": 1, "V": 5, "X": 10, "L": 50}
    total, prev = 0, 0
    for ch in reversed(s):
        v = vals.get(ch, 0)
        total = total - v if v < prev else total + v
        prev = max(prev, v)
    return total

JOINS = Counter()

def cell_text(html):
    """Текст комірки: знімає переноси слів, зберігає справжні дефіси складених слів."""
    def join(m):
        head = m.group(1)
        JOINS[head.lower()] += 1
        return head + ("-" if head.lower() in REAL_HYPHEN else "")
    # «низько- та середньочастотні»: перед сполучником дефіс підвісний, а не знак переносу
    html = re.sub(r"(\w+)-\s*<br\s*/?>\s*(?=(?:та|і|й|чи|або)\b)", r"\1- ", html)
    html = re.sub(r"(\w+)-\s*<br\s*/?>\s*", join, html)
    html = re.sub(r"<br\s*/?>", " ", html)
    html = re.sub(r"<[^>]+>", "", html)
    html = (html.replace("&#39;", "'").replace("&#34;", '"')
                .replace("&nbsp;", " ").replace("&amp;", "&"))
    out = re.sub(r"\s+", " ", html).strip()
    for bad, good in FIXUPS.items():
        out = out.replace(bad, good)
    return out

def rows_of(table_html):
    for r in re.findall(r"<tr.*?</tr>", table_html, re.S):
        yield [cell_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]

def main():
    html = SRC.read_text(encoding="utf-8")
    body = html[html.find('<div class="d_tit">'):]

    # Потік блоків у порядку документа: службові div-и та таблиці
    tokens = []
    for m in re.finditer(r'<div class="(d_\w+)">(.*?)</div>|<table[^>]*class="d_rta".*?</table>',
                         body, re.S):
        if m.group(1):
            tokens.append((m.group(1), cell_text(m.group(2)), m.group(0)))
        else:
            tokens.append(("table", "", m.group(0)))
    log(f"блоків у документі: {len(tokens)}")

    # ── Зміст кожного додатка: римський номер → назва розділу ────
    # Блоки d_bla між «Зміст» і першою таблицею; верхній рівень — БЕЗ крапки
    # після номера («XIV Лабораторне обладнання»), підрозділи — з крапкою.
    contents = []            # [{roman: title}] у порядку додатків
    cur, last = None, None
    for m in re.finditer(r'<div class="d_(cen|bla)">(.*?)</div>', body, re.S):
        txt = cell_text(m.group(2))
        if m.group(1) == "cen":
            if txt == "Зміст":
                cur = {}
                contents.append(cur)
                last = None
            else:
                cur = None
            continue
        if cur is None:
            continue
        hm = re.match(r"^([IVXL]+)\s+(.+)$", txt)
        if hm:
            last = hm.group(1)
            cur[last] = hm.group(2)
        elif last and not re.match(r"^([IVXL]+\.|\d+\.|[абв]\))", txt):
            cur[last] += " " + txt          # продовження довгої назви
    log("зміст: " + ", ".join(f"додаток {i+1} — {len(c)} розділів" for i, c in enumerate(contents)))

    appendices = []          # {no, title, sections: [...]}
    index = []               # позиції
    app = None
    section = None
    sub = ""                 # шлях підрозділу («I. Апарати та приладдя › 2. Для біохімічних…»)
    sub_stack = []
    qty_labels = ["Кількість"]
    pending_group = ""       # «кількість ліжок» тощо

    def new_section(roman, title, beds=""):
        nonlocal section, sub, sub_stack, qty_labels
        if app is None:
            return
        sub, sub_stack = "", []
        section = {
            "roman": roman, "no": roman_val(roman), "title": title,
            "beds": beds, "count": 0, "notes": [],
        }
        app["sections"].append(section)
        # для основних таблиць кількість подано «на N місць»
        qty_labels = [f"на {beds} місць"] if beds else ["Кількість"]

    for kind, text, raw in tokens:
        if kind == "d_lef":
            m = re.match(r"Додаток (\d)", text)
            if m:
                app = {"no": int(m.group(1)), "title": "", "sections": []}
                appendices.append(app)
                section, sub, sub_stack = None, "", []
            elif text.startswith("кількість"):
                pending_group = text
            continue

        if kind == "d_tit" and app is not None and not app["title"] and "оснащення" in text:
            app["title"] = text
            continue

        if kind in ("d_cen", "d_par", "d_bla"):
            # Зміст пропускаємо: він іде суцільним блоком d_bla до першої таблиці
            if kind == "d_bla":
                continue
            m = re.match(r"^([IVXL]+)\.\s+(.+)$", text)
            if m and app is not None:
                val = roman_val(m.group(1))
                if section is None or val > section["no"]:
                    new_section(m.group(1), m.group(2))
                else:                                   # підрозділ лабораторної частини
                    sub_stack = [text]
                    sub = " › ".join(sub_stack)
                continue
            if re.match(r"^(\d+\.|[абв]\))\s+", text) and section is not None:
                sub_stack = sub_stack[:1] + [text]
                sub = " › ".join(sub_stack)
            continue

        if kind == "d_com":
            note = re.sub(r"\)\s*\(", ") · (", text)
            if section is not None:
                section["notes"].append(note)
                # окремі виключені пункти зберігаємо як позиції зі статусом
                for pm in re.finditer(r"Пункт (\d+) виключено на підставі Наказу[^)]*?N (\d+)\s*від ([\d.]+)", text):
                    section["count"] += 1
                    index.append([
                        f"{app['no']}-{section['roman']}-{pm.group(1)}",
                        f"Пункт {pm.group(1)}", [], app["no"], section["roman"], "",
                        f"виключено наказом № {pm.group(2)} від {pm.group(3)}",
                    ])
            elif app is not None:
                app.setdefault("notes", []).append(note)
            continue

        if kind == "table":
            for cells in rows_of(raw):
                if not cells:
                    continue
                head = cells[0]
                # заголовок таблиці
                if head.startswith("N п/п") or head.startswith("N п"):
                    labels = [c for c in cells[2:] if c]
                    if labels and not labels[0].startswith("Кількість виробів на"):
                        qty_labels = labels
                    continue
                # окремий рядок з підписами колонок кількості
                if not NUM_RE.match(head) and not ROMAN_RE.match(head) and len(cells) >= 2 \
                        and all(re.search(r"\d", c) for c in cells if c):
                    qty_labels = [c for c in cells if c]
                    continue
                if ROMAN_RE.match(head):
                    beds = cells[2] if len(cells) > 2 and re.fullmatch(r"\d+", cells[2] or "") else ""
                    new_section(ROMAN_RE.match(head).group(1), cells[1] if len(cells) > 1 else "", beds)
                    continue
                if NUM_RE.match(head) and section is not None:
                    name = cells[1] if len(cells) > 1 else ""
                    if not name:
                        continue
                    qtys = [c for c in cells[2:]]
                    section["count"] += 1
                    index.append([
                        f"{app['no']}-{section['roman']}-{NUM_RE.match(head).group(1)}",
                        name, qtys, app["no"], section["roman"], sub, "",
                    ])
                    section["qty_labels"] = [LABEL_FIX.get(l, l) for l in qty_labels]
                    if pending_group:
                        section["qty_group"] = pending_group
            pending_group = ""
            continue

    # ── Назви розділів зі Змісту + статуси ───────────────────────
    for a, cont in zip(appendices, contents):
        for s in a["sections"]:
            if not s["title"]:
                s["title"] = cont.get(s["roman"], "")
            s["excluded"] = sum(1 for r in index
                                if r[3] == a["no"] and r[4] == s["roman"] and r[6])
            if s["count"] == 0:
                s["status"] = "втратив чинність"
            elif s["excluded"] == s["count"]:
                s["status"] = "позиції виключено"
        missing = [r for r in cont if not any(s["roman"] == r for s in a["sections"])]
        if missing:
            log(f"  УВАГА: у Додатку {a['no']} немає розділів зі Змісту: {missing}")

    # ── Підсумки ─────────────────────────────────────────────────
    total = len(index)
    excluded = sum(1 for r in index if r[6])
    log(f"позицій: {total} (зокрема виключених: {excluded})")
    for a in appendices:
        log(f"  Додаток {a['no']}: розділів {len(a['sections'])}, позицій "
            f"{sum(s['count'] for s in a['sections'])}")
        empty = [s['roman'] for s in a['sections'] if s['count'] == 0]
        if empty:
            log(f"    без позицій: {', '.join(empty)}")

    log("склейки переносів (перші 30 за частотою): " +
        ", ".join(f"{w}×{n}" for w, n in JOINS.most_common(30)))
    ends_o = [(w, n) for w, n in JOINS.items() if w.endswith(("о", "е")) and w not in REAL_HYPHEN]
    if ends_o:
        log("УВАГА, перевірити (закінчуються на о/е, склеєно без дефіса): " +
            ", ".join(f"{w}×{n}" for w, n in sorted(ends_o, key=lambda x: -x[1])[:40]))

    # ── Місток до ПМГ-2026: у яких пакетах є вимога про табель оснащення ──
    pmg_packages = []
    try:
        pk = json.loads(Path(r"D:\rpe-pmg\pakety\data\packages_2026.json")
                        .read_text(encoding="utf-8"))["packages"]
        for p in pk:
            if re.search(r"табел", json.dumps(p, ensure_ascii=False), re.I):
                pmg_packages.append({"no": str(p.get("number", "")).strip(),
                                     "title": (p.get("title") or "").strip()})
        log(f"пакетів ПМГ-2026 з вимогою про табель оснащення: {len(pmg_packages)} з {len(pk)}")
    except Exception as ex:
        log(f"WARN: не вдалося звірити з пакетами ПМГ: {ex}")

    meta = {
        "generated": time.strftime("%Y-%m-%d"),
        "act": {
            "title": "Про затвердження табелів оснащення виробами медичного призначення "
                     "структурних підрозділів закладів охорони здоров'я",
            "authority": "МОЗ України",
            "number": "153",
            "date": "05.06.1998",
            "edition": "поточна редакція від 04.11.2010",
            "code": "v0153282-98",
            "url": "https://zakon.rada.gov.ua/laws/show/v0153282-98",
            "status": "чинний",
        },
        "amendments": [
            {"number": "158", "date": "11.04.2005", "code": "v0158282-05",
             "url": "https://zakon.rada.gov.ua/laws/show/v0158282-05",
             "title": "Про затвердження табеля оснащення обладнанням одного робочого місця "
                      "лікаря-стоматолога та зубного техніка",
             "effect": "розділ XI «Стоматологія» Додатка 1 втратив чинність"},
            {"number": "951", "date": "04.11.2010", "code": "v0951282-10",
             "url": "https://zakon.rada.gov.ua/laws/show/v0951282-10",
             "title": "Про затвердження Примірних табелів оснащення обладнанням, медичною "
                      "технікою та виробами медичного призначення (акушерсько-гінекологічна допомога)",
             "effect": "виключено акушерсько-гінекологічні позиції в Додатках 1 і 2"},
        ],
        "pmg": {
            "packages": pmg_packages,
            "requirement": "Специфікації ПМГ-2026 вимагають, щоб підрозділи були «обладнані "
                           "відповідно до табелю матеріально-технічного оснащення» — це критична "
                           "умова закупівлі.",
            "contract": "Пункт 19 договору про медичне обслуговування населення (підпункти 3, 13, "
                        "28, 36): надавач зобов'язується дотримуватися вимог законодавства, зокрема "
                        "порядків надання медичної допомоги та табелів матеріально-технічного "
                        "оснащення, у тому числі примірних.",
            "caveat": "Наказ № 153 — базовий чинний табель саме щодо виробів медичного призначення. "
                      "Профільні примірні табелі матеріально-технічного оснащення (зокрема наказ "
                      "МОЗ № 951 від 04.11.2010 щодо акушерсько-гінекологічної допомоги) "
                      "доповнюють його за напрямами.",
        },
        "total": total,
        "excluded": excluded,
        "appendices": appendices,
        "schema_index": ["id", "name", "qtys[]", "appendix", "section_roman", "sub", "status"],
    }
    (DATA / "tabel153_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "tabel153_index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log("готово: " + str(DATA))

if __name__ == "__main__":
    main()
