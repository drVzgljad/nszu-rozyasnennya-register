"""Порівняння тарифів і коефіцієнтів: постанова 1503 (ПМГ-2025) ↔ 1808 (ПМГ-2026).

Три сімейства даних, бо в постанові вони живуть по-різному:

1. rates        — суми в тексті тарифних пунктів («…становить 8735 гривень»).
                  У пункті їх буває до двадцяти, кожна зі своїм призначенням,
                  тому зберігаємо кожну окремо з її кваліфікатором.
2. coefficients — коригувальні коефіцієнти. Більшість із них — не в тексті, а в
                  таблицях усередині глав, тож документ читаємо послідовно:
                  таблиця належить главі, заголовок якої трапився перед нею.
3. drg          — вагові коефіцієнти діагностично-споріднених груп із додатків.

Зіставляємо глави за назвою, а не за номером: номер пакета ≠ номер глави, і між
роками нумерація не зобов'язана збігатися.

Редакції: 1503 — від 14.11.2025 (остання за 2025 рік), 1808 — від 04.04.2026.
Пізніші зміни до 1808 (№ 635, 721, 753, 948) звірено з поточною редакцією на
zakon.rada.gov.ua: сум і таблиць коефіцієнтів вони не міняли.
"""

import json
import re
import sys
from difflib import SequenceMatcher
from html.parser import HTMLParser
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
DATA_DIR = OUTPUT_DIR / "data"
DOCS_DIR = OUTPUT_DIR / "docs"
WEB_DIR = OUTPUT_DIR.parent
PACKAGES_JSON = WEB_DIR / "pakety" / "data" / "packages_2026.json"

YEARS = {"2025": "1503", "2026": "1808"}

CHAPTER_RE = re.compile(r"^Глава\s+(\d+)\.\s+")
APPENDIX_RE = re.compile(r"^Додаток\s+(\d+)\s+до Порядку")
AMEND_RE = re.compile(r"\{[^{}]*\}")
# Відмінки перелічені всі: у 1503 трапляється «801071 гривню» у знахідному, і без
# цієї форми дві суми з двадцяти губилися, а весь ряд трансплантації з'їжджав на
# одну позицію — 78563 ставало парою до 801071.
MONEY_RE = re.compile(r"(\d[\d\s ]*(?:,\d+)?)\s*(?:гривень|гривні|гривня|гривню|гривнею|гривнях)\b")
# Пробіл усередині числа — не збій розпізнавання, а форматування rada: «0, 616».
NUM_RE = re.compile(r"^\d+(?:\s*,\s*\d+)?$")
EDITION_RE = re.compile(r"Редакція від\s*([\d.]+)\s*,?\s*підстава\s*[—–-]\s*(\S+)")

# Тип ставки шукаємо в тексті ліворуч від суми — від найдовшого формулювання до
# найкоротшого, інакше «базова ставка на пролікований випадок» звелася б до
# «базова ставка».
RATE_KINDS = [
    ("базова ставка на пролікований випадок", "Базова ставка на пролікований випадок"),
    ("базова капітаційна ставка", "Базова капітаційна ставка"),
    ("ставка на пролікований випадок", "Ставка на пролікований випадок"),
    ("ставка на медичну послугу", "Ставка на медичну послугу"),
    ("ставки на медичні послуги", "Ставка на медичну послугу"),
    ("капітаційна ставка", "Капітаційна ставка"),
    ("глобальна ставка", "Глобальна ставка"),
    ("базова ставка", "Базова ставка"),
    ("оплати праці", "Рівень оплати праці"),
]


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


# Кирилиця, що виглядає як латиниця. У додатку 1 до 1503 коди «С01А», «С02А»,
# «С16А» набрано кирилицею, а в 1808 ті самі коди — латиницею; без зведення до
# одного алфавіту вони розходяться на «зник у 2025» і «з'явився у 2026».
HOMOGLYPHS = str.maketrans({
    "А": "A", "В": "B", "Е": "E", "І": "I", "Ї": "I", "К": "K", "М": "M", "Н": "H",
    "О": "O", "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X", "Ј": "J", "Ѕ": "S",
    "а": "a", "е": "e", "і": "i", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
})
CODE_LIKE_RE = re.compile(r"^[A-ZА-ЯІЇЄҐ]{1,4}[\d]{1,3}(?:[-–][\w]{1,3})?$")


def code_key(raw):
    """Ключ коду, стійкий до алфавіту й до дефіса-тире."""
    return (raw or "").strip().upper().translate(HOMOGLYPHS).replace("–", "-").replace(" ", "")


def row_key(raw):
    """Коди зводимо до латиниці, звичайні назви — як текст."""
    stripped = (raw or "").strip()
    return code_key(stripped) if CODE_LIKE_RE.match(stripped) else norm_key(stripped)


def norm_key(text):
    text = (text or "").replace("’", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"^Глава\s+\d+\.\s*", "", text)
    return re.sub(r"[^\w' ]+", " ", re.sub(r"\s+", " ", text)).strip().casefold()


def to_number(raw):
    raw = re.sub(r"\s+", "", raw or "").replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def similar(a, b):
    return SequenceMatcher(None, norm_key(a), norm_key(b)).ratio()


def label_similar(a, b):
    """Схожість назв рядків: посимвольна плюс за спільними словами.

    Сама по собі посимвольна помиляється на скороченнях. «Загальні дослідження»
    (2026) до «загальні дослідження (основні лабораторні дослідження)» (2025)
    дає 0,54 — менше, ніж до «специфічні лабораторні дослідження» (0,59), бо
    різниця довжин важить більше за збіг початку. Частка спільних слів це
    виправляє: 1,0 проти 0,5.
    """
    sequence = SequenceMatcher(None, a, b).ratio()
    words_a = {w for w in re.split(r"\W+", a) if len(w) > 2}
    words_b = {w for w in re.split(r"\W+", b) if len(w) > 2}
    if not words_a or not words_b:
        return sequence
    overlap = len(words_a & words_b) / min(len(words_a), len(words_b))
    return 0.5 * sequence + 0.5 * overlap


class DocumentStream(HTMLParser):
    """Абзаци й таблиці в порядку появи.

    Абзаци з клітинок у потік верхнього рівня не пускаємо: інакше кожна клітинка
    приїхала б удруге як самостійний абзац і зіпсувала б контекст глави.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stream = []
        self._depth = 0
        self._tables = []
        self._rows = []
        self._cell = None
        self._para = None

    def handle_starttag(self, tag, attrs):
        tag = tag.casefold()
        if tag == "table":
            self._depth += 1
            self._tables.append([])
        elif tag == "tr" and self._tables:
            self._rows.append([])
        elif tag in ("td", "th") and self._rows:
            self._cell = []
        elif tag == "p" and self._depth == 0:
            self._para = []

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)
        elif self._para is not None:
            self._para.append(data)

    def handle_endtag(self, tag):
        tag = tag.casefold()
        if tag in ("td", "th") and self._cell is not None:
            self._rows[-1].append(clean(" ".join(self._cell)))
            self._cell = None
        elif tag == "tr" and self._rows:
            row = self._rows.pop()
            if self._tables:
                self._tables[-1].append(row)
        elif tag == "table" and self._tables:
            table = self._tables.pop()
            self._depth -= 1
            if self._depth == 0:
                self.stream.append(("table", table))
        elif tag == "p" and self._para is not None:
            text = clean(" ".join(self._para))
            if text:
                self.stream.append(("p", text))
            self._para = None


def read_stream(path):
    parser = DocumentStream()
    parser.feed(Path(path).read_text(encoding="utf-8", errors="ignore"))
    return parser.stream


# ── Ставки ──────────────────────────────────────────────────────────────────

def rate_kind(text_before):
    tail = text_before.casefold()[-260:]
    best, position = "Інше", -1
    for needle, label in RATE_KINDS:
        found = tail.rfind(needle)
        if found > position:
            best, position = label, found
    return best


def qualifier_for(text, match, next_start):
    """Що саме оплачує ця сума.

    Пункт будується як «становить: 41253 гривні - за етап А, 18630 гривень - за
    етап Б», тож призначення стоїть праворуч від суми. Коли праворуч порожньо
    (сума завершує речення) — беремо контекст ліворуч.
    """
    right = text[match.end():next_start]
    right = re.split(r"(?<=[.;])\s+(?=[А-ЯІЇЄҐ])", right)[0]
    right = re.sub(r"^\s*[-–—,:]\s*", "", right).strip(" ;,.")
    right = re.sub(r"^(за|для|на)\s+", "", right, flags=re.IGNORECASE).strip()
    if len(right) >= 8:
        return clean(right)[:220]
    left = clean(text[:match.start()]).rstrip(" ,;:-–—")
    left = re.split(r"(?<=[.;])\s+", left)[-1]
    if len(left) > 200:
        # Обрізаємо по межі слова: «…аціонарна допомога» замість половини слова.
        left = "… " + left[-200:].split(" ", 1)[-1]
    return clean(f"{left} {right}".strip())[:220]


def extract_rates(resolution):
    """[(chapter_id, chapter_title, rate)] — усі суми з тарифних пунктів глав."""
    out = []
    for chapter in resolution["chapters"]:
        for item in chapter["items"]:
            text = clean(AMEND_RE.sub(" ", item["text"]))
            matches = list(MONEY_RE.finditer(text))
            if not matches:
                continue
            for index, match in enumerate(matches):
                next_start = matches[index + 1].start() if index + 1 < len(matches) else len(text)
                value = to_number(match.group(1))
                if value is None:
                    continue
                out.append((chapter["id"], chapter["title"], {
                    "value": value,
                    "kind": rate_kind(text[:match.start()]),
                    "qualifier": qualifier_for(text, match, next_start),
                    "point": item["number"],
                    "page": item["page"],
                }))
    return out


def pair_rates(left, right):
    """Зіставлення сум у межах глави: спершу найкращі пари, потім за типом ставки.

    Пара шукається глобально, а не «для кожної суми найкраща вільна»: у главі про
    трансплантацію сума 78563 повторюється чотири рази, і послідовний жадібний
    прохід віддавав її першому-ліпшому кандидатові, а решта ряду розповзалася.

    Другий прохід рятує випадок, коли призначення переписали: базова капітаційна
    ставка екстреної допомоги у 2025 описана як «на рік», а у 2026 — «на рік на
    одну особу», схожість тексту низька, але тип ставки той самий і в главі він
    один.
    """
    if not left or not right:
        return [(a, None, 0.0) for a in left] + [(None, b, 0.0) for b in right]
    if len(left) == 1 and len(right) == 1:
        return [(left[0], right[0], 1.0)]

    candidates = []
    for i, a in enumerate(left):
        for j, b in enumerate(right):
            score = similar(a["qualifier"], b["qualifier"])
            if a["kind"] == b["kind"]:
                score = min(1.0, score + 0.12)
            if a["value"] == b["value"]:
                score = min(1.0, score + 0.10)
            candidates.append((score, i, j))
    candidates.sort(key=lambda item: (-item[0], item[1], item[2]))

    taken_left, taken_right, pairs = set(), set(), []
    for score, i, j in candidates:
        if score < 0.55 or i in taken_left or j in taken_right:
            continue
        taken_left.add(i)
        taken_right.add(j)
        pairs.append((i, j, score))

    rest_left = [i for i in range(len(left)) if i not in taken_left]
    rest_right = [j for j in range(len(right)) if j not in taken_right]
    for i in list(rest_left):
        match = next((j for j in rest_right
                      if left[i]["kind"] == right[j]["kind"] and left[i]["kind"] != "Інше"), None)
        if match is not None:
            rest_left.remove(i)
            rest_right.remove(match)
            pairs.append((i, match, 0.5))

    ordered = sorted(pairs, key=lambda item: (item[1], item[0]))
    out = [(left[i], right[j], round(score, 2)) for i, j, score in ordered]
    out += [(left[i], None, 0.0) for i in rest_left]
    out += [(None, right[j], 0.0) for j in rest_right]
    return out


# ── Таблиці коефіцієнтів ────────────────────────────────────────────────────

def coefficient_tables(stream):
    """Таблиці з колонкою коефіцієнта, прив'язані до глави або додатка."""
    tables, context, caption = [], None, ""
    for kind, value in stream:
        if kind == "p":
            match = CHAPTER_RE.match(value) or APPENDIX_RE.match(value)
            if match:
                context, caption = value, ""
            elif 3 < len(value) < 240:
                caption = value
            continue
        head = value[0] if value else []
        # Заголовок додатка приходить окремою однорядковою таблицею-плашкою.
        if len(value) == 1 and len(head) == 2 and APPENDIX_RE.match(head[1] or ""):
            context, caption = head[1], ""
            continue
        if len(value) < 4 or not head or not any("оефіцієнт" in cell for cell in head):
            continue
        if any(cell.startswith("Ваговий коефіцієнт діагностично") for cell in head):
            continue  # додатки ДСГ ідуть окремим сімейством
        if head[0].startswith("Діагностично-спор"):
            continue
        value_column = next((i for i, cell in enumerate(head) if "оефіцієнт" in cell), len(head) - 1)
        key_column = 0 if value_column != 0 else 1
        rows, section = [], ""
        for cells in value[1:]:
            cells = (list(cells) + [""] * len(head))[:len(head)]
            key = cells[key_column].strip()
            raw_value = cells[value_column].strip()
            if not key:
                continue
            # Рядок із назвою, але без коефіцієнта — заголовок групи всередині
            # таблиці («Гематологія:»). Підрядки під різними групами звуться
            # однаково («загальні дослідження»), тож без префікса вони злипаються.
            # Довгий такий рядок групою не робимо: у психіатричній таблиці 2026
            # року це ціле речення-застереження про один блок кодів, і якби воно
            # стало секцією, то поширилося б на всі дальші рядки таблиці — вони
            # перестали б знаходити свою пару за 2025 рік.
            if not raw_value:
                section = key.rstrip(":") if len(key) <= 60 else ""
                continue
            rows.append({
                "key": key,
                "section": section,
                "value": raw_value,
                "number": to_number(raw_value) if NUM_RE.match(raw_value) else None,
                "extra": [c for i, c in enumerate(cells) if i not in (key_column, value_column) and c],
            })
        # Таблиця без жодного числа в колонці коефіцієнта — це не коефіцієнти, а
        # критерії їх застосування (глава 27 має таку поруч зі справжньою).
        if rows and any(row["number"] is not None for row in rows):
            tables.append({"context": context or "", "caption": caption,
                           "columns": head, "rows": rows})
    return tables


def pair_tables(left, right):
    """Таблиці спарюємо в межах однієї глави: спершу за підписом, потім за порядком."""
    def bucket(tables):
        out = {}
        for table in tables:
            out.setdefault(norm_key(table["context"]), []).append(table)
        return out

    left_by, right_by = bucket(left), bucket(right)
    pairs = []
    for key in sorted(set(left_by) | set(right_by)):
        a_list, b_list = left_by.get(key, []), right_by.get(key, [])
        used = set()
        for a in a_list:
            best, score = None, 0.0
            for index, b in enumerate(b_list):
                if index in used:
                    continue
                candidate = similar(a["caption"], b["caption"])
                keys_a = {norm_key(r["key"]) for r in a["rows"]}
                keys_b = {norm_key(r["key"]) for r in b["rows"]}
                overlap = len(keys_a & keys_b) / max(1, min(len(keys_a), len(keys_b)))
                candidate = max(candidate, overlap)
                if candidate > score:
                    best, score = index, candidate
            if best is not None and score >= 0.34:
                used.add(best)
                pairs.append((a, b_list[best]))
            else:
                pairs.append((a, None))
        for index, b in enumerate(b_list):
            if index not in used:
                pairs.append((None, b))
    return pairs


# ── ДСГ ─────────────────────────────────────────────────────────────────────

def appendix_table(resolution, appendix_id):
    for appendix in resolution["appendices"]:
        if appendix["id"] == appendix_id:
            return appendix.get("table")
    return None


def drg_rows(resolution_2025, resolution_2026, package_titles, cardio_packages):
    """Рядки ДСГ з обох років. Пакет беремо з колонки «Пакет послуг» додатка 1
    за 2025 рік — у 2026 такої колонки немає, тож для нових кодів лишається
    прив'язка самого додатка (пакети 3, 4, 47), а для кардіохірургічних — 3."""
    by_title = {norm_key(title): number for number, title in package_titles.items()}

    a1_2025 = appendix_table(resolution_2025, "appendix-1") or {"rows": []}
    a3_2025 = appendix_table(resolution_2025, "appendix-3") or {"rows": []}
    a1_2026 = appendix_table(resolution_2026, "appendix-1") or {"rows": []}
    a2_2026 = appendix_table(resolution_2026, "appendix-2") or {"rows": []}

    simultaneous = {code_key(r["code"]): to_number(r["coeffs"][0]) for r in a3_2025["rows"]}
    cardio = {code_key(r["code"]): [to_number(c) for c in r["coeffs"]] for r in a2_2026["rows"]}
    cardio_titles = {code_key(r["code"]): r["title"] for r in a2_2026["rows"]}
    by_2025 = {code_key(r["code"]): r for r in a1_2025["rows"]}
    by_2026 = {code_key(r["code"]): r for r in a1_2026["rows"]}

    rows = []
    for code in sorted(set(by_2025) | set(by_2026) | set(cardio)):
        source_2025 = by_2025.get(code)
        source_2026 = by_2026.get(code)
        weight_2025 = to_number(source_2025["coeffs"][0]) if source_2025 else None
        coeffs_2026 = [to_number(c) for c in source_2026["coeffs"]] if source_2026 else []
        weight_2026 = coeffs_2026[0] if coeffs_2026 else None
        if weight_2026 is None and code in cardio:
            weight_2026 = cardio[code][0]
        title = (source_2026 or source_2025 or {}).get("title") or cardio_titles.get(code, "")
        # Як код надрукований у самій постанові — щоб було видно, де кирилиця.
        printed = {(source_2025 or {}).get("code", ""), (source_2026 or {}).get("code", "")} - {"", code}
        package_name = (source_2025 or {}).get("package", "")
        number = by_title.get(norm_key(package_name)) if package_name else None
        row = {
            "code": code,
            "printed": sorted(printed),
            "packages": [number] if number else (["3"] if code in cardio else list(cardio_packages)),
            "title": title,
            "package": (source_2025 or {}).get("package", ""),
            "w2025": weight_2025,
            "w2026": weight_2026,
            "kids2026": coeffs_2026[1] if len(coeffs_2026) > 1 else None,
            "trauma2026": coeffs_2026[2] if len(coeffs_2026) > 2 else None,
            "simult2025": simultaneous.get(code),
            "cardio2026": code in cardio,
            "status": "both" if weight_2025 is not None and weight_2026 is not None
                      else ("only-2025" if weight_2025 is not None else "only-2026"),
        }
        if row["w2025"] is not None and row["w2026"] is not None:
            row["delta"] = round(row["w2026"] - row["w2025"], 4)
            row["delta_pct"] = round((row["w2026"] / row["w2025"] - 1) * 100, 2) if row["w2025"] else None
        rows.append(row)
    return rows, len(a3_2025["rows"]), len(a2_2026["rows"])


# ── Збірка ──────────────────────────────────────────────────────────────────

def edition_of(stream):
    for kind, value in stream:
        if kind != "table":
            continue
        for row in value:
            for cell in row:
                match = EDITION_RE.search(cell or "")
                if match:
                    return {"edition": match.group(1), "basis": match.group(2).rstrip(",.")}
    return {"edition": "", "basis": ""}


def main():
    resolutions = {
        year: json.loads((DATA_DIR / f"resolution_{number}.json").read_text(encoding="utf-8"))
        for year, number in YEARS.items()
    }
    streams = {
        year: read_stream(DOCS_DIR / f"postanova_{number}.htm")
        for year, number in YEARS.items()
    }
    packages_payload = json.loads(PACKAGES_JSON.read_text(encoding="utf-8"))
    package_titles = {p["number"]: p["title"] for p in packages_payload["packages"]}

    # Глави між роками — за назвою. Номери збігаються, але покладатися на це не можна.
    chapters_2026 = {c["id"]: c for c in resolutions["2026"]["chapters"]}
    matched, used = {}, set()
    for chapter in resolutions["2025"]["chapters"]:
        key = norm_key(chapter["title"])
        exact = next((c for c in chapters_2026.values()
                      if norm_key(c["title"]) == key and c["id"] not in used), None)
        if not exact:
            best, score = None, 0.0
            for candidate in chapters_2026.values():
                if candidate["id"] in used:
                    continue
                value = similar(chapter["title"], candidate["title"])
                if value > score:
                    best, score = candidate, value
            exact = best if score >= 0.72 else None
        if exact:
            used.add(exact["id"])
            matched[chapter["id"]] = exact["id"]

    def packages_for(chapter_id_2026):
        chapter = chapters_2026.get(chapter_id_2026)
        return chapter["package_numbers"] if chapter else []

    # ── ставки
    rates_2025, rates_2026 = extract_rates(resolutions["2025"]), extract_rates(resolutions["2026"])
    grouped_2025, grouped_2026 = {}, {}
    for chapter_id, title, rate in rates_2025:
        grouped_2025.setdefault(chapter_id, (title, []))[1].append(rate)
    for chapter_id, title, rate in rates_2026:
        grouped_2026.setdefault(chapter_id, (title, []))[1].append(rate)

    rates = []
    for chapter_id_2025, chapter_id_2026 in sorted(matched.items(), key=lambda kv: int(kv[0].split("-")[1])):
        title_2025, list_2025 = grouped_2025.get(chapter_id_2025, ("", []))
        title_2026, list_2026 = grouped_2026.get(chapter_id_2026, ("", []))
        if not list_2025 and not list_2026:
            continue
        for a, b, score in pair_rates(list_2025, list_2026):
            row = {
                "packages": packages_for(chapter_id_2026),
                "chapter2025": chapter_id_2025.split("-")[1],
                "chapter2026": chapter_id_2026.split("-")[1],
                "chapter_title": chapters_2026[chapter_id_2026]["title"],
                "kind": (b or a)["kind"],
                "qualifier": (b or a)["qualifier"],
                "qualifier2025": a["qualifier"] if a else "",
                "v2025": a["value"] if a else None,
                "v2026": b["value"] if b else None,
                "point2025": a["point"] if a else "",
                "page2025": a["page"] if a else None,
                "point2026": b["point"] if b else "",
                "page2026": b["page"] if b else None,
                "match": round(score, 2),
                "status": "both" if a and b else ("only-2025" if a else "only-2026"),
            }
            if a and b:
                row["delta"] = round(b["value"] - a["value"], 2)
                row["delta_pct"] = round((b["value"] / a["value"] - 1) * 100, 2) if a["value"] else None
            rates.append(row)

    # глави 2026 без пари у 2025 — цілком нові пакети
    for chapter_id, (title, list_2026) in grouped_2026.items():
        if chapter_id in used:
            continue
        for rate in list_2026:
            rates.append({
                "packages": packages_for(chapter_id),
                "chapter2025": "", "chapter2026": chapter_id.split("-")[1],
                "chapter_title": title, "kind": rate["kind"], "qualifier": rate["qualifier"],
                "qualifier2025": "", "v2025": None, "v2026": rate["value"],
                "point2025": "", "page2025": None,
                "point2026": rate["point"], "page2026": rate["page"],
                "match": 0.0, "status": "only-2026",
            })

    # ── коефіцієнти
    tables_2025 = coefficient_tables(streams["2025"])
    tables_2026 = coefficient_tables(streams["2026"])
    chapter_number_2025 = {norm_key(c["title"]): c["id"].split("-")[1] for c in resolutions["2025"]["chapters"]}
    chapter_lookup_2026 = {norm_key(c["title"]): c for c in chapters_2026.values()}

    coefficients = []
    for a, b in pair_tables(tables_2025, tables_2026):
        anchor = (b or a)["context"]
        chapter_2026 = chapter_lookup_2026.get(norm_key(anchor))
        if not chapter_2026:
            best, score = None, 0.0
            for key, candidate in chapter_lookup_2026.items():
                value = SequenceMatcher(None, norm_key(anchor), key).ratio()
                if value > score:
                    best, score = candidate, value
            chapter_2026 = best if score >= 0.72 else None
        group = {
            "packages": chapter_2026["package_numbers"] if chapter_2026 else [],
            "chapter_title": chapter_2026["title"] if chapter_2026 else anchor,
            "caption": (b or a)["caption"] or (a or b)["caption"],
            "columns2025": a["columns"] if a else [],
            "columns2026": b["columns"] if b else [],
            "chapter2025": chapter_number_2025.get(norm_key((a or {}).get("context", "")), ""),
            "status": "both" if a and b else ("only-2025" if a else "only-2026"),
            "rows": [],
        }
        # Рядок шукаємо спершу за точним ключем, потім за схожістю: у таблиці
        # лімітів первинки той самий рядок 2025 року звучить «Від 110 відсотків»,
        # а 2026-го — «Від 111 відсотка», і точний ключ його не знаходить.
        def keyed(rows):
            return [((norm_key(r["section"]) + "|" if r.get("section") else "") + row_key(r["key"]), r)
                    for r in rows]

        rows_2025 = keyed(a["rows"] if a else [])
        rows_2026 = keyed(b["rows"] if b else [])
        index_2025 = {key: r for key, r in rows_2025}
        taken = set()
        merged = []
        for key, right in rows_2026:
            left = index_2025.get(key)
            if left is not None:
                taken.add(key)
            else:
                best, score, same_section = None, 0.0, False
                for other_key, candidate in rows_2025:
                    if other_key in taken:
                        continue
                    value = label_similar(key, other_key)
                    if value > score:
                        best, score = (other_key, candidate), value
                        same_section = bool(right.get("section")) and \
                            right.get("section") == candidate.get("section")
                # Усередині однієї групи поле кандидатів вузьке, тож вимогу до
                # схожості послаблюємо: у 2026 «загальні дослідження (основні
                # лабораторні дослідження)» скоротили до «загальні дослідження».
                if best and score >= (0.5 if same_section else 0.75):
                    taken.add(best[0])
                    left = best[1]
            merged.append((left, right))
        merged += [(r, None) for key, r in rows_2025 if key not in taken
                   and key not in {k for k, _ in rows_2026}]

        for left, right in merged:
            row = {
                "label": (right or left)["key"],
                "section": (right or left).get("section", ""),
                "label2025": left["key"] if left and right and left["key"] != right["key"] else "",
                "v2025": left["number"] if left else None,
                "v2026": right["number"] if right else None,
                "raw2025": left["value"] if left else "",
                "raw2026": right["value"] if right else "",
                "extra": (right or left)["extra"],
                "status": "both" if left and right else ("only-2025" if left else "only-2026"),
            }
            if row["v2025"] is None and row["v2026"] is None:
                continue  # рядок-заголовок усередині таблиці, порівнювати нічого
            if row["v2025"] is not None and row["v2026"] is not None:
                row["delta"] = round(row["v2026"] - row["v2025"], 4)
                row["delta_pct"] = round((row["v2026"] / row["v2025"] - 1) * 100, 2) if row["v2025"] else None
            group["rows"].append(row)
        coefficients.append(group)

    # ── ДСГ
    appendix_packages = next((a["package_numbers"] for a in resolutions["2026"]["appendices"]
                              if a["id"] == "appendix-1"), ["3", "4", "47"])
    drg, simultaneous_2025, cardio_2026 = drg_rows(
        resolutions["2025"], resolutions["2026"], package_titles, appendix_packages)

    packages = []
    for number, title in sorted(package_titles.items(), key=lambda kv: int(kv[0])):
        chapters = [cid for cid, chapter in chapters_2026.items() if number in chapter["package_numbers"]]
        reverse = {v: k for k, v in matched.items()}
        packages.append({
            "number": number,
            "title": title,
            "chapters2026": [c.split("-")[1] for c in chapters],
            "chapters2025": [reverse[c].split("-")[1] for c in chapters if c in reverse],
        })

    payload = {
        "meta": {
            "generated": "2026-08-14",
            "sources": {
                "2025": {"number": "1503", "date": "24.12.2024",
                         "title": "Про реалізацію програми медичних гарантій у 2025 році",
                         "href": "docs/postanova_1503.pdf", **edition_of(streams["2025"])},
                "2026": {"number": "1808", "date": "31.12.2025",
                         "title": "Про реалізацію програми медичних гарантій у 2026 році",
                         "href": "docs/postanova_1808.pdf", **edition_of(streams["2026"])},
            },
            "note": "Пізніші зміни до 1808 (№ 635, 721, 753, 948) звірено з поточною "
                    "редакцією на zakon.rada.gov.ua — сум і таблиць коефіцієнтів вони не міняли.",
            "counts": {
                "chapters_matched": len(matched),
                "chapters_2025": len(resolutions["2025"]["chapters"]),
                "chapters_2026": len(resolutions["2026"]["chapters"]),
                "rates": len(rates),
                "rates_both": sum(1 for r in rates if r["status"] == "both"),
                "coefficient_groups": len(coefficients),
                "coefficient_rows": sum(len(g["rows"]) for g in coefficients),
                "drg": len(drg),
                "drg_both": sum(1 for r in drg if r["status"] == "both"),
                "simultaneous_2025": simultaneous_2025,
                "cardio_2026": cardio_2026,
            },
        },
        "packages": packages,
        "rates": rates,
        "coefficients": coefficients,
        "drg": drg,
    }
    target = DATA_DIR / "comparison_2025_2026.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({**payload["meta"]["counts"],
                      "size_kb": round(target.stat().st_size / 1024, 1),
                      "output": str(target)}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
