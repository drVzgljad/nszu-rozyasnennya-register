# -*- coding: utf-8 -*-
"""
Білдер розділу «Обладнання» для НавігаторПМГ26.

Робить із блоку «Вимоги до переліку обладнання» специфікацій ПМГ-2026 те саме,
що build_posady.py зробив зі «Спеціалістами»: зводить розсипані по 43 пакетах
вимоги в реєстр виробів і намагається дотягнути кожен до довідників —
НК 024:2023 (GMDN), НК 031:2024 (EMDN) і табелів оснащення МОЗ.

Джерела:
  1. pakety/data/packages_2026.json, section.key == "equipment" — 1785 позицій.
  2. classifiers/data/nk024/nk024_index.json — 23 876 кодів GMDN.
  3. classifiers/data/nk031/nk031_index.json — 8 342 позиції EMDN.
  4. classifiers/data/tabel/doc_*.json — 4 060 позицій табелів оснащення.

ПАСТКИ (перевірено 04.08.2026):
  1. У пакеті 42 («Готовність до надання допомоги в умовах НС») блок обладнання
     містить ТАБЛИЦЮ «Медичний кошик» — перелік лікарських засобів. Docx-парсер
     розклав її по клітинках, тож у пунктах обладнання лежать «таб», «мг», «амп»,
     «N01AX03» і назви діючих речовин. Ріжемо все після заголовка кошика: 448
     позицій із 1785 — це ліки, а не вироби.
  2. Вимога до обладнання часто не є виробом: «приєднання внутрішніх мереж
     відділення до автономного резервного джерела електропостачання відповідно
     до нормативно-технічних документів» — це умова, а не апарат. Такі позиції
     лишаємо в реєстрі, але позначаємо kind="умова" і в довідниках не шукаємо.
  3. «Тонометр та/або тонометр педіатричний з манжетками…» — це дві вимоги в
     одному рядку, так само як було з посадами. Ділимо по «та/або».
  4. Хвіст «– щонайменше 9» несе кількість, а не назву. Зрізаємо в назву окремим
     полем, інакше той самий апарат розпадається на десяток різних «виробів».
  5. Словники не перетинаються за словником. Специфікація каже «система
     ультразвукової візуалізації, зокрема на основі ефекту Доплера», GMDN —
     «Система ультразвукова діагностична…», табель — «Апарат УЗД». Точне
     зіставлення дає 2% по НК 024 і 12% по табелях. Тому шукаємо зважено (IDF
     по словах) і віддаємо КАНДИДАТІВ із балом, а не «правильний код».
  6. Сама вага IDF ловить хибні влучання: «резервне джерело електропостачання»
     важить у бік «ДЖЕРЕЛА СВІТЛА» (спільне рідке слово «джерела»). Тому
     запобіжник: найрідкісніше слово вимоги МУСИТЬ бути в назві кандидата.
     Без нього кожен десятий «сильний» збіг — сміття.

Вихід у ./data/equipment:
  equipment_meta.json  — підсумки, пастки, покриття довідниками.
  equipment_index.json — легкий список для дерева й пошуку.
  equipment_cards.json — картки: вимоги пакетів + кандидати з довідників.
  equipment_pkg.json   — координати назв у тексті вимог (для spec-links.js).
"""
import json, re, sys, time
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
DATA = BASE / "data" / "equipment"
DATA.mkdir(parents=True, exist_ok=True)
PKG_JSON = BASE.parent / "pakety" / "data" / "packages_2026.json"

MARKER = re.compile(r"^\s*(?:\d+(?:\.\d+)*\.?|[a-zа-я]\.)\s*", re.I)
QTY = re.compile(r"\s*[–—]\s*(щонайменше|не\s+менше)\b.*$", re.I)
BASKET = re.compile(r"медичн\w*\s+кошик", re.I)

# Вимога-умова, а не виріб: починається з віддієслівного іменника дії.
CONDITION = re.compile(
    r"^(приєднанн|наявн|забезпеченн|можлив|доступ|підключенн|облаштуванн|"
    r"дотриманн|відповідн|укомплектован|розміщенн|організац)", re.I)

STOP = {"та", "і", "й", "з", "із", "зі", "для", "у", "в", "на", "або", "не",
        "менше", "ніж", "зокрема", "відповідно", "до", "що", "яка", "який",
        "які", "від", "при", "про", "за", "як", "його", "цьому", "тому"}

SUFFIX = ("ування", "ичног", "ічног", "ального", "ований", "івськ", "ічної",
          "ичної", "ного", "ний", "ної", "них", "ими", "ами", "ові", "ова",
          "ове", "ий", "ій", "ої", "их", "ом", "ам", "ах", "ів", "ям",
          "и", "а", "у", "е", "о", "і", "я", "ю")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def norm(s):
    s = s.lower().replace("’", "'").replace("ʼ", "'").replace("`", "'")
    s = re.sub(r"[^\w\s'-]", " ", s, flags=re.UNICODE)
    return re.sub(r"\s+", " ", s).strip()


def stem(t):
    for suf in SUFFIX:
        if len(t) > 5 and t.endswith(suf):
            return t[:-len(suf)]
    return t


def toks(s):
    return [stem(t) for t in norm(s).split() if t not in STOP and len(t) > 2]


def slug(s):
    return re.sub(r"[^a-zа-яїієґ0-9]", "", norm(s))[:80] or "x"


# ─────────────────────── вимоги пакетів до обладнання ────────────────────────

SPLIT = re.compile(r"\s*,?\s+(?:та\s*/\s*або|і\s*/\s*або|та\s+або)\s+", re.I)


def split_names(name, devices=frozenset()):
    """«Тонометр та/або тонометр педіатричний» — це дві вимоги (пастка 3).

    Ділити можна ЛИШЕ поза дужками. Усередині «(центральний кисневий пункт
    та/або киснево-газифікаційна станція, та/або кисневий концентратор)» те
    саме «та/або» перелічує варіанти джерела в одному виробі — розріз там
    лишає уламки на кшталт «ортореабілітації)».

    Друга пастка того ж «та/або»: «централізована та/або змішана, та/або
    децентралізована система постачання кисню» — тут сполучник перелічує
    ПРИКМЕТНИКИ до спільного іменника, і розріз народжує вимогу «змішана».
    Розрізняємо за довідниками: однослівна частина лишається вимогою, лише
    якщо таке слово взагалі є назвою виробу («тонометр» — є, «змішана» — ні).
    """
    cuts, depth = [], 0
    for i, ch in enumerate(name):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
    if depth:
        return [name.strip(" .;,")]      # дужка не закрита — краще не різати
    depth = 0
    pos = 0
    for m in SPLIT.finditer(name):
        depth = (name.count("(", 0, m.start()) - name.count(")", 0, m.start()))
        if depth == 0:
            cuts.append((pos, m.start()))
            pos = m.end()
    cuts.append((pos, len(name)))
    out = []
    for a, b in cuts:
        p = name[a:b].strip(" .;,")
        if len(p) > 3:
            out.append(p)
    if len(out) > 1:
        for p in out:
            tt = toks(p)
            if len(tt) == 1 and tt[0] not in devices:
                return [name.strip(" .;,")]
    return out or [name.strip(" .;,")]


def parse_packages(path, devices=frozenset()):
    d = json.loads(path.read_text(encoding="utf-8"))
    rows, heads, drugs = [], [], 0
    for pkg in d.get("packages", []):
        num = str(pkg.get("number"))
        for unit in pkg.get("units", []):
            for sec in unit.get("sections", []):
                if sec.get("key") != "equipment":
                    continue
                scope, basket = "", False
                for it in sec.get("items", []):
                    txt = (it.get("text") or "").strip()
                    if not txt:
                        continue
                    body = MARKER.sub("", txt).strip()
                    if BASKET.search(body):
                        basket = True          # далі таблиця ліків (пастка 1)
                    if basket:
                        drugs += 1
                        continue
                    if body.endswith(":"):
                        scope = body.rstrip(":").strip()
                        continue
                    qty = ""
                    m = QTY.search(body)
                    if m:
                        qty = body[m.start():].strip(" –—.;")
                    zone = QTY.sub("", body).strip(" .;")
                    if len(zone) < 4:
                        continue
                    parts = split_names(zone, devices)
                    heads.append({"pkg": num, "h": zone, "p": parts})
                    for part in parts:
                        rows.append({
                            "pkg": num, "title": pkg.get("title"), "name": part,
                            "scope": scope, "qty": qty,
                            "critical": "критичн" in (scope + " " + body).lower(),
                        })
    log(f"Пакети: {len(rows)} вимог до обладнання, "
        f"{len({r['pkg'] for r in rows})} пакетів; клітинок медичного кошика "
        f"відкинуто {drugs}")
    return rows, heads


# ──────────────────────────── довідники виробів ──────────────────────────────

def load_refs():
    refs = []
    p = BASE / "data" / "nk024" / "nk024_index.json"
    if p.exists():
        for r in json.loads(p.read_text(encoding="utf-8")):
            refs.append(("nk024", r[0], r[1]))
    p = BASE / "data" / "nk031" / "nk031_index.json"
    if p.exists():
        for r in json.loads(p.read_text(encoding="utf-8")):
            refs.append(("nk031", r[0], r[1]))
    for f in sorted((BASE / "data" / "tabel").glob("doc_*.json")):
        order = f.stem.split("_")[1]
        for r in json.loads(f.read_text(encoding="utf-8")):
            refs.append(("tabel" + order, r[0], r[1]))
    log(f"Довідники: {len(refs)} позицій "
        f"({', '.join(f'{k}={v}' for k, v in Counter(s for s, _, _ in refs).most_common())})")
    return refs


# Слова, що самі по собі виробу не називають: як «ширший» відповідник вони
# не годяться — «набір» є в кожному другому рядку довідників.
GENERIC = {"набір", "комплект", "систем", "апарат", "пристрій", "прилад",
           "обладнанн", "виріб", "засіб", "стіл", "шаф", "візок"}


class Matcher:
    """Зважений пошук кандидатів із запобіжником за найрідкіснішим словом."""

    def __init__(self, refs, device_words=frozenset()):
        self.devices = set(device_words) - GENERIC
        self.rows, self.inv = [], defaultdict(list)
        for i, (src, code, nm) in enumerate(refs):
            tt = toks(nm)
            self.rows.append((src, code, nm, set(tt), len(tt)))
            for t in set(tt):
                self.inv[t].append(i)
        self.idf = {t: 1.0 / (1 + len(v)) ** 0.5 for t, v in self.inv.items()}

    def w(self, t):
        return self.idf.get(t, 0.5)

    def find(self, name, top=4):
        want = set(toks(name))
        if not want:
            return []
        # Пастка 6: кандидат мусить мати хоч одне з двох найрідкісніших слів
        # вимоги. Одного мало: «мішок ручної вентиляції легенів» у GMDN зветься
        # «апарат … ручний», слова «мішок» там немає взагалі, а зміст той самий.
        rare = sorted(want, key=self.w, reverse=True)[:2]
        total = sum(self.w(t) for t in want)
        seen = set()
        for t in rare:
            seen.update(self.inv.get(t, ()))
        # Ширші відповідники шукаємо по ВСІХ словах вимоги: табельний
        # «Дефібрилятор» не має ні «портативний», ні «синхронізація», тож у
        # вибірку за рідкісними словами він не потрапляє — а це саме той
        # рядок табеля, яким ЗОЗ звітує про виконання вимоги.
        for t in want:
            seen.update(self.inv.get(t, ())[:600])
        out = []
        for i in seen:
            src, code, nm, tt, ln = self.rows[i]
            if not tt:
                continue
            cover = sum(self.w(t) for t in want & tt) / total
            noise = len(tt - want) / max(ln, 1)
            score = round(cover * (1 - 0.35 * noise), 3)
            if score >= 0.45:
                out.append((score, src, code, nm, band(score)))
            elif tt <= want and tt & self.devices:
                # Назва довідника цілком міститься у вимозі: рід замість виду.
                # Ваговий поріг тут не працює — «Дефібрилятор» важить 0,12 від
                # «портативний дефібрилятор з функцією синхронізації» саме тому,
                # що вимога навісила рідкісні уточнення. Критерій інший: слово
                # довідника має бути самостійною назвою виробу.
                out.append((round(cover, 3), src, code, nm, "ширший"))
        # Спершу справжні збіги, ширші — після них, і лише як запасний варіант.
        rank = {"точний": 0, "ймовірний": 1, "ширший": 2}
        out.sort(key=lambda x: (rank[x[4]], -x[0], x[1], x[2]))
        # По два найкращі кандидати з довідника: три однакові «Пульсоксиметри»
        # з різних наказів корисні, п'ять — уже шум. Дублі назв прибираємо:
        # табель 153 має «Дефібрилятор» десять разів у різних відділеннях.
        best, per, seen = [], Counter(), set()
        for row in out:
            k = (row[1], norm(row[3]))
            if k in seen:
                continue
            seen.add(k)
            per[row[1]] += 1
            if per[row[1]] <= 2:
                best.append(row)
            if len(best) >= top:
                break
        return best


def band(score):
    return "точний" if score >= 0.85 else "ймовірний"


# ──────────────────────────────────── збірка ─────────────────────────────────

def build():
    refs = load_refs()
    # Однослівні назви довідників — словник «це справді виріб» для розрізання
    # вимог по «та/або» (див. split_names).
    device_words = {toks(nm)[0] for _, _, nm in refs if len(toks(nm)) == 1}
    rows, heads = parse_packages(PKG_JSON, device_words)
    matcher = Matcher(refs, device_words)

    # ── звід однакових вимог
    items = {}
    for r in rows:
        sid = slug(r["name"])
        e = items.setdefault(sid, {"id": sid, "names": Counter(), "rows": []})
        e["names"][r["name"]] += 1
        e["rows"].append(r)

    for e in items.values():
        e["name"] = e["names"].most_common(1)[0][0]
        e["kind"] = "умова" if CONDITION.match(e["name"]) else "виріб"
        e["pkgs"] = sorted({r["pkg"] for r in e["rows"]}, key=lambda n: int(re.match(r"\d+", n).group()))
        e["critical"] = any(r["critical"] for r in e["rows"])
        e["refs"] = ([] if e["kind"] == "умова" else
                     [{"src": s, "code": c, "name": n, "score": sc, "band": bd}
                      for sc, s, c, n, bd in matcher.find(e["name"])])

    entries = sorted(items.values(), key=lambda e: (-len(e["rows"]), e["name"]))
    devices = [e for e in entries if e["kind"] == "виріб"]
    tally = Counter(e["refs"][0]["band"] if e["refs"] else "—" for e in devices)
    exact = [e for e in devices if e["refs"] and e["refs"][0]["band"] == "точний"]
    log(f"Зведено: {len(entries)} унікальних вимог "
        f"({len(devices)} виробів, {len(entries) - len(devices)} умов); "
        + ", ".join(f"{k}: {v}" for k, v in tally.most_common()))

    # ── координати назв у тексті вимог (для spec-links.js)
    by_name = {slug(r["name"]): e["id"] for e in entries for r in e["rows"]}
    links, dropped = defaultdict(list), 0
    for h in heads:
        spans, cursor = [], 0
        for part in h["p"]:
            eid = by_name.get(slug(part))
            if not eid:
                continue
            off = h["h"].find(part, cursor)
            if off < 0:
                dropped += 1
                continue
            spans.append([off, len(part), eid])
            cursor = off + len(part)
        if spans:
            links[h["pkg"]].append({"h": h["h"], "p": spans})
    pkg_links = {}
    for pkg, rr in links.items():
        seen, uniq = set(), []
        for r in rr:
            if r["h"] in seen:
                continue
            seen.add(r["h"])
            uniq.append(r)
        pkg_links[pkg] = uniq
    log(f"Лінки в пакетах: {sum(len(v) for v in pkg_links.values())} вимог "
        f"у {len(pkg_links)} пакетах" + (f", поза текстом {dropped}" if dropped else ""))

    meta = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": {
            "packages": {
                "title": "Специфікації пакетів ПМГ-2026, блок «Вимоги до переліку обладнання»",
                "order": "постанова КМУ від 31.12.2025 № 1808",
            },
            "refs": [
                {"key": "nk024", "title": "НК 024:2023 «Класифікатор медичних виробів» (GMDN)",
                 "page": "nk024.html"},
                {"key": "nk031", "title": "НК 031:2024 «Національна номенклатура медичних виробів» (EMDN)",
                 "page": "nk031.html"},
                {"key": "tabel", "title": "Табелі матеріально-технічного оснащення (накази МОЗ)",
                 "page": "tabel.html"},
            ],
        },
        "counts": {
            "mentions": len(rows),
            "entries": len(entries),
            "devices": len(devices),
            "conditions": len(entries) - len(devices),
            "packages": len({r["pkg"] for r in rows}),
            "exact": tally["точний"],
            "likely": tally["ймовірний"],
            "broader": tally["ширший"],
            "unmatched": tally["—"],
        },
        "notes": [
            "Блок обладнання пакета 42 містить таблицю «Медичний кошик» — перелік "
            "лікарських засобів. Її клітинки не є вимогами до обладнання і в реєстр "
            "не потрапили.",
            "Частина вимог блоку — не вироби, а умови («приєднання внутрішніх мереж "
            "до резервного джерела електропостачання»). Вони показані окремим видом "
            "і в довідниках не шукаються.",
            "Специфікації, GMDN і табелі називають одне й те саме різними словами, "
            "тож зіставлення дає КАНДИДАТІВ із балом, а не єдиний правильний код. "
            "«Точний» — бал від 0,85, «ймовірний» — від 0,45, «ширший» — коли назва "
            "довідника цілком міститься у вимозі (табельний «Дефібрилятор» проти "
            "«портативний дефібрилятор з функцією синхронізації»).",
            "Кількість («щонайменше 9») винесена з назви в окреме поле: інакше той "
            "самий апарат розпадається на десяток різних позицій.",
        ],
        "top_unmatched": [
            {"name": e["name"], "hits": len(e["rows"]), "pkgs": len(e["pkgs"])}
            for e in devices if not e["refs"]
        ][:40],
    }

    index = [{"id": e["id"], "name": e["name"], "kind": e["kind"],
              "hits": len(e["rows"]), "pkgs": e["pkgs"], "critical": e["critical"],
              "refs": len(e["refs"]),
              "band": e["refs"][0]["band"] if e["refs"] else ""} for e in entries]

    cards = {e["id"]: {
        "id": e["id"], "name": e["name"], "kind": e["kind"],
        "aliases": [n for n, _ in e["names"].most_common() if n != e["name"]],
        "critical": e["critical"], "pkgs": e["pkgs"], "refs": e["refs"],
        "rows": [{"pkg": r["pkg"], "title": r["title"], "scope": r["scope"],
                  "qty": r["qty"], "critical": r["critical"], "name": r["name"]}
                 for r in e["rows"]],
    } for e in entries}

    write(DATA / "equipment_meta.json", meta)
    write(DATA / "equipment_index.json", index)
    write(DATA / "equipment_cards.json", cards)
    write(DATA / "equipment_pkg.json",
          {"generated": meta["generated"], "pkgs": pkg_links,
           "names": {e["id"]: e["name"] for e in entries}})
    log(f"Готово: {len(entries)} вимог, {len(exact)} точних збігів із довідниками")


def write(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    log(f"  → {path.name}  {path.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    build()
