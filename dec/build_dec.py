# -*- coding: utf-8 -*-
"""Збирач реєстру «Стандарти та настанови ДЕЦ МОЗ» (розділ dec/).

Першоджерело — реєстр медико-технологічних документів на dec.gov.ua. Його знімок кладе на
полицю fetch_dec.py (0_10_класификатори/dec_gov_ua/, manifest.json). Збирач у мережу не ходить.

Пише:
  data/dec_documents.json          документи (один запис = один PDF), категорії, дата знімка
  dec/data/package_dec_links.json  зв'язки категорій ДЕЦ із пакетами ПМГ — лише з доказом
  dec/data/errata_dec.json         журнал правок першоджерела (латинські двійники в назвах)

Що нормалізує (аудит 24.11.2026, К2, В2, В3):
  * статус → state: «чинний» / «застарілий» / «скасований» / «невідомий»; сирий рядок лишається;
  * дата: «02.04.202017.05.2023» → published 02.04.2020 + revised 17.05.2023;
  * назва: розмір файла «(738.3 Кб)» → поле size; «Наказ МОЗ» → «Наказ МОЗ від … № …»;
  * латинські двійники — classifiers/homoglyph_fix.fix_name (з журналом);
  * номер: нерозривний пробіл і нерозривний дефіс → звичайні;
  * один PDF у кількох категоріях — один запис із categories: [...]; id — від адреси PDF.

Коди НК 025 категорії беруться лише з самих документів ДЕЦ (dec/data/dec_icd.json, збирає
extract_icd.py з PDF на полиці) — ніяких кодів «від руки». Зв'язок із пакетом:
  * auto   — коди категорії є серед кодів пакета в Таблиці співставлення (вузькі пакети);
  * manual — dec/data/package_dec_manual.json, кожен запис з полем why (і verified_by).
Збіг лише за кодами класу Z і категорії понад 30 рубрик доказом не вважаються.
Широкі пакети 3, 4, 9, 47 автоматично не прив'язуються: туди потрапляє майже будь-який
діагноз, і зв'язок нічого б не означав. Для них сторінка веде в Кодер за кодом.

Запуск: python tools/sources_build.py --only dec   (або напряму цей файл)
"""
import base64
import hashlib
import html as htmllib
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
ROOT = WEB.parent
SHELF = ROOT / "0_10_класификатори" / "dec_gov_ua"
OUT_DOCS = WEB / "data" / "dec_documents.json"
OUT_LINKS = WEB / "dec" / "data" / "package_dec_links.json"
ICD_FILE = WEB / "dec" / "data" / "dec_icd.json"
MANUAL_FILE = WEB / "dec" / "data" / "package_dec_manual.json"
DIRECTIONS_FILE = WEB / "dec" / "data" / "clinical_directions.json"
ERRATA = WEB / "dec" / "data" / "errata_dec.json"
BY_PACKAGE = WEB / "mapping" / "data" / "by_package.json"
PACKAGES = WEB / "pakety" / "data" / "packages_lite.json"

sys.path.insert(0, str(WEB / "classifiers"))
import homoglyph_fix as hf  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Пакети, куди за Таблицею співставлення потрапляє майже будь-який діагноз
BROAD_PACKAGES = {"3", "4", "9", "47"}
# Пакет вважається зв'язаним, якщо з його кодами збігається хоч одна рубрика категорії.
# Категорія, що охоплює понад BROAD_RUBRICS рубрик (напр. «Профілактика ССЗ» — увесь клас I00–I99),
# так само широка, як пакети вище: автозв'язок із нею нічого б не означав.
BROAD_RUBRICS = 30
RE_DATE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})")
RE_SIZE = re.compile(r"\s*\(\s*(\d+(?:[.,]\d+)?)\s*([КкKkMМ][бБbB]|[ГG][бБB])\s*\)\s*$")
MONTHS = {"січ": 1, "лют": 2, "бер": 3, "квіт": 4, "трав": 5, "черв": 6, "лип": 7, "серп": 8,
          "верес": 9, "жовт": 10, "листоп": 11, "груд": 12}
TYPE_NORM = {"клінічна настанова": "Настанова", "настанова": "Настанова", "стандарт": "Стандарт",
             "протокол": "Протокол", "наказ": "Наказ", "зміни до протоколу": "Зміни до протоколу",
             "програма": "Програма", "додаток": "Додаток"}
STATE_LABEL = {"чинний": "Чинний", "застарілий": "Застарілий — використовувати з обережністю",
               "скасований": "Скасований", "невідомий": "Статус не вказано"}


def clean(s):
    s = htmllib.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = s.replace(" ", " ").replace("‑", "-").replace("–", "–")
    return re.sub(r"\s+", " ", s).strip()


def norm_number(s):
    s = clean(s).replace("‑", "-")
    return re.sub(r"\s*-\s*", "-", s)


def state_of(raw):
    r = (raw or "").lower()
    if r.startswith("чинн"):
        return "чинний"
    if "застар" in r:
        return "застарілий"
    if "скасов" in r or "втрат" in r or "нечинн" in r:
        return "скасований"
    return "невідомий"


def parse_dates(raw):
    """Повертає (published, revised, year)."""
    dates = ["%s.%s.%s" % m for m in RE_DATE.findall(raw or "")]
    if not dates:
        # «червень, 2017» / «Квітень, 2021» / «2017»
        y = re.search(r"(19|20)\d{2}", raw or "")
        return "", "", y.group(0) if y else ""
    published = dates[0]
    revised = dates[-1] if len(dates) > 1 and dates[-1] != dates[0] else ""
    return published, revised, published[-4:]


def iso(d):
    return "-".join(reversed(d.split("."))) if d else ""


def fix_url(u):
    u = htmllib.unescape(u or "").strip()
    m = re.search(r"\?ZG93bmxvYWQ=([A-Za-z0-9+/=_-]+)", u)
    if m:
        b = m.group(1)
        try:
            path = base64.b64decode(b + "=" * (-len(b) % 4)).decode("utf-8")
            return "https://www.dec.gov.ua/" + path.lstrip("/")
        except Exception:
            return u
    if u.startswith("/"):
        u = "https://www.dec.gov.ua" + u
    return u


def parse_category(slug, html):
    h1 = re.search(r'<h1 class="card-title">(.*?)</h1>', html, re.S)
    name = hf.fix_name(clean(h1.group(1)) if h1 else slug, f"категорія {slug}")
    upd = re.search(r'<div class="meta-data[^"]*">\s*<span><i class="fa fa-calendar"[^>]*></i>\s*([\d.]+)', html)
    i = html.find('<div class="text">')
    j = html.find('class="col-xl-4', i)
    body = html[i:j] if i >= 0 else ""
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) < 3:
            continue
        a = re.search(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', tds[0], re.S)
        if not a:
            continue  # шапка таблиці або рядок без файла
        cells = [clean(re.sub(r"<br\s*/?>", " ", t)) for t in tds]
        # Колонки: Назва | Статус | Вид | Реєстровий № | Опубліковано (бувають сторінки без статусу)
        status, typ, number, pub = (cells + ["", "", "", "", ""])[1:5]
        if len(cells) == 4:
            status, typ, number, pub = "", cells[1], cells[2], cells[3]
        rows.append({"url": fix_url(a.group(1)), "title_raw": clean(a.group(2)),
                     "status_raw": status, "type_raw": typ, "number": norm_number(number), "date_raw": pub})
    return {"name": name, "slug": slug, "url": f"https://www.dec.gov.ua/mtd/{slug}/",
            "updated": upd.group(1) if upd else "", "rows": rows}


def doc_title(row, typ, published):
    t = row["title_raw"]
    size = ""
    m = RE_SIZE.search(t)
    if m:
        size = f"{m.group(1).replace(',', '.')} {m.group(2).upper().replace('M', 'М').replace('K', 'К').replace('Б', 'б').replace('B', 'б')}"
        size = size.replace("Мб", "МБ").replace("Кб", "КБ").replace("КБ", "КБ").replace("Гб", "ГБ")
        t = t[: m.start()].strip()
    t = hf.fix_name(t, f"документ {row['number'] or row['url']}")
    bare = t.lower().strip(" .")
    if bare in ("наказ моз", "наказ", "наказ моз україни") or re.fullmatch(r"наказ моз\s*(україни)?", bare):
        n = re.search(r"(\d{4})-(\d+)", row["number"])
        parts = ["Наказ МОЗ"]
        if published:
            parts.append(f"від {published}")
        if n:
            parts.append(f"№ {n.group(2)}")
        t = " ".join(parts)
    return t, size


def main():
    man_p = SHELF / "manifest.json"
    if not man_p.exists():
        sys.exit("Немає знімка реєстру ДЕЦ на полиці — спершу python 05_Веб_реєстр/dec/fetch_dec.py")
    man = json.loads(man_p.read_text(encoding="utf-8"))
    cats_order = man.get("categories") or []
    if not cats_order:  # обхід перервано до кінця — перелік беремо зі збережених сторінок переліку
        for lp in sorted((SHELF / "list").glob("page-*.html"), key=lambda q: int(re.search(r"\d+", q.stem).group())):
            h = lp.read_text(encoding="utf-8")
            i = h.find('id="content"')
            part = h[i:h.find('class="col-xl-4', i)] if i >= 0 else ""
            for slug in re.findall(r'href="https://www\.dec\.gov\.ua/mtd/([^"/]+)/"', part):
                if slug not in cats_order:
                    cats_order.append(slug)
    snap_dates = [v["fetched"][:10] for k, v in man.get("files", {}).items() if k.startswith("mtd/")]
    snapshot = max(snap_dates) if snap_dates else ""
    missing = [s for s in cats_order if not (SHELF / "mtd" / f"{s}.html").exists()]
    if missing and "--partial" not in sys.argv:
        sys.exit(f"Знімок неповний: {len(missing)} з {len(cats_order)} категорій не завантажено — "
                 f"спершу python 05_Веб_реєстр/dec/fetch_dec.py (або --partial для перевірки розбору)")
    if missing:
        print(f"⚠ Знімок неповний: {len(missing)} категорій не завантажено — {missing[:5]}")

    categories, docs = [], {}
    for slug in cats_order:
        p = SHELF / "mtd" / f"{slug}.html"
        if not p.exists():
            continue
        cat = parse_category(slug, p.read_text(encoding="utf-8"))
        categories.append(cat)
        for row in cat["rows"]:
            published, revised, year = parse_dates(row["date_raw"])
            typ_raw = row["type_raw"]
            typ = TYPE_NORM.get(typ_raw.lower(), typ_raw[:1].upper() + typ_raw[1:] if typ_raw else "Інше")
            title, size = doc_title(row, typ, published)
            key = row["url"]
            did = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
            if did in docs:
                d = docs[did]
                if cat["name"] not in d["categories"]:
                    d["categories"].append(cat["name"])
                continue
            st = state_of(row["status_raw"])
            docs[did] = {
                "id": did, "title": title, "size": size,
                "status": STATE_LABEL[st], "status_raw": row["status_raw"], "state": st,
                "type": typ, "number": row["number"],
                "published": published, "revised": revised, "year": year, "date_raw": row["date_raw"],
                "document_url": key,
                "category": cat["name"], "categories": [cat["name"]], "category_url": cat["url"],
            }

    # ── коди НК 025 категорій (лише з документів ДЕЦ) ───────────────────────
    icd = json.loads(ICD_FILE.read_text(encoding="utf-8")).get("categories", {}) if ICD_FILE.exists() else {}
    nk025 = {x["c"] for x in json.loads((WEB / "classifiers/data/nk025_index.json").read_text(encoding="utf-8"))}
    directions = json.loads(DIRECTIONS_FILE.read_text(encoding="utf-8")) if DIRECTIONS_FILE.exists() else {"directions": []}
    dir_of = {}
    for dr in directions.get("directions", []):
        for pth in dr.get("pathologies", []):
            dir_of[pth["name"]] = dr["id"]

    cat_info = {}
    for c in categories:
        ic = icd.get(c["slug"]) or {}
        codes = [x for x in ic.get("codes", []) if x in nk025 or re.fullmatch(r"[A-Z]\d{2}", x)]
        cat_info[c["name"]] = {
            "slug": c["slug"], "url": c["url"], "updated": c["updated"],
            "direction": dir_of.get(c["name"], ""),
            "icd": codes, "icd_from": ic.get("from", ""),
            "docs": [d["id"] for d in docs.values() if c["name"] in d["categories"]],
        }

    # ── зв'язки з пакетами ────────────────────────────────────────────────
    by_pkg = json.loads(BY_PACKAGE.read_text(encoding="utf-8"))
    pkg_icd = {k: set(v.get("icd", [])) for k, v in by_pkg.items()}
    links = {}

    def rub(code):
        return code.split(".")[0]

    for name, info in cat_info.items():
        if not info["icd"]:
            continue
        cat_codes = set(info["icd"])
        if len({rub(c) for c in cat_codes}) > BROAD_RUBRICS:
            continue
        # Рубрика категорії («I21») охоплює всі свої підрубрики в пакеті; уточнений код («R06.6») —
        # лише сам себе або рубрику пакета, що його містить. Інакше «гикавка» R06.6 тягла б
        # реабілітацію через задишку R06.0.
        cat_rubrics = {c for c in cat_codes if "." not in c}

        def hits(c):
            return c in cat_codes or rub(c) in cat_rubrics or ("." not in c and any(x.startswith(c + ".") for x in cat_codes))

        for pkg, codes in pkg_icd.items():
            if pkg in BROAD_PACKAGES or not codes:
                continue
            hit = sorted(c for c in codes if hits(c))
            # Самі коди класу Z (чинники, консультування: Z71 у «Протоколах фармацевта») —
            # не доказ: вони є в багатьох пакетах і не кажуть про захворювання.
            if not hit or all(c.startswith("Z") for c in hit):
                continue
            rubs = sorted({rub(c) for c in hit})
            links.setdefault(pkg, {})[name] = {
                "stage": "", "source": "auto",
                "note": f"Коди категорії є серед діагнозів пакета в Таблиці співставлення: {', '.join(rubs[:6])}{' …' if len(rubs) > 6 else ''}",
                "why": f"Таблиця співставлення: {', '.join(hit[:8])}{' …' if len(hit) > 8 else ''}; коди категорії — {info['icd_from']}",
            }
    manual = json.loads(MANUAL_FILE.read_text(encoding="utf-8")) if MANUAL_FILE.exists() else {"links": []}
    unknown_manual = []
    for m in manual.get("links", []):
        if m["category"] not in cat_info:
            unknown_manual.append(m["category"])
            continue
        if m.get("remove"):
            links.get(str(m["package"]), {}).pop(m["category"], None)
            continue
        links.setdefault(str(m["package"]), {})[m["category"]] = {
            "stage": m.get("stage", ""), "source": "manual", "note": m.get("note", ""),
            "why": m["why"], "verified_by": m.get("verified_by", ""), "basis": m.get("basis", ""),
        }
    links = {k: dict(sorted(v.items())) for k, v in sorted(links.items(), key=lambda kv: int(kv[0]))}

    # ── запис ────────────────────────────────────────────────────────────
    doc_list = sorted(docs.values(), key=lambda d: (d["category"], d["title"]))
    for d in doc_list:
        d["search_text"] = " ".join(x for x in [d["title"], " ".join(d["categories"]), d["type"], d["number"],
                                               d["published"], d["revised"]] if x).lower()
    out = {
        "generated": date.today().isoformat(),
        "snapshot": snapshot,
        "source": "https://www.dec.gov.ua/cat_mtd/galuzevi-standarti-ta-klinichni-nastanovi/",
        "basis": "Перелік медико-технологічних документів ДЕЦ МОЗ (положення — наказ МОЗ від 19.06.2026 № 845)",
        "complete": not missing,
        "total_documents": len(doc_list),
        "total_categories": len(categories),
        "categories": [c["name"] for c in categories],
        "category_info": cat_info,
        "types": sorted({d["type"] for d in doc_list}, key=str.lower),
        "statuses": [STATE_LABEL[s] for s in ("чинний", "застарілий", "скасований", "невідомий")
                     if any(d["state"] == s for d in doc_list)],
        "years": sorted({d["year"] for d in doc_list if d["year"]}, reverse=True),
        "documents": doc_list,
    }
    if "--dry" in sys.argv:
        OUT_DOCS_ = OUT_DOCS.with_name("dec_documents.dry.json")
        OUT_DOCS_.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        OUT_DOCS_.with_name("package_dec_links.dry.json").write_text(json.dumps(links, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"(--dry) записано лише {OUT_DOCS_} і package_dec_links.dry.json")
        return
    OUT_DOCS.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    OUT_LINKS.write_text(json.dumps(links, ensure_ascii=False, indent=1), encoding="utf-8")
    n_err = hf.save_log(ERRATA, "dec", "Реєстр ДЕЦ МОЗ (dec.gov.ua)")
    with_icd = sum(1 for v in cat_info.values() if v["icd"])
    no_dir = [n for n, v in cat_info.items() if not v["direction"]]
    print(f"ДЕЦ: категорій {len(categories)}, документів {len(doc_list)}, знімок {snapshot}")
    print(f"  статуси: " + ", ".join(f"{s} {sum(1 for d in doc_list if d['state'] == s)}" for s in STATE_LABEL))
    print(f"  коди НК 025 є у {with_icd} категорій; зв'язків із пакетами {sum(len(v) for v in links.values())}"
          f" (ручних {sum(1 for v in links.values() for x in v.values() if x['source'] == 'manual')})")
    print(f"  правок першоджерела в журналі: {n_err}")
    if no_dir:
        print(f"  ⚠ без напряму в каталозі: {len(no_dir)} — {no_dir[:8]}")
    if unknown_manual:
        print(f"  ⚠ ручні зв'язки на невідомі категорії: {unknown_manual}")


if __name__ == "__main__":
    main()
