"""Знімок реєстру медико-технологічних документів ДЕЦ МОЗ (dec.gov.ua) на полицю першоджерел.

Що робить: обходить перелік категорій «Галузеві стандарти та клінічні настанови»
(https://www.dec.gov.ua/cat_mtd/galuzevi-standarti-ta-klinichni-nastanovi/, сторінки /page/N/)
і зберігає HTML кожної сторінки переліку й кожної категорії /mtd/<slug>/ у
D:\\pmg-data\\0_10_класификатори\\dec_gov_ua\\. Поруч пише manifest.json: що, коли й з яким
відбитком завантажено. Збирач build_dec.py читає лише цю полицю, у мережу не ходить.

Сайт ДЕЦ на часті запити відповідає 503, тож запити йдуть по одному з паузою, а 503
повторюються з наростаючим очікуванням. Уже збережену сторінку, не старшу за --max-age
днів, повторно не тягнемо (продовження перерваного обходу).

Запуск:  python 05_Веб_реєстр/dec/fetch_dec.py            (докачати / оновити старіші за 7 днів)
         python 05_Веб_реєстр/dec/fetch_dec.py --force    (усе заново)
         python 05_Веб_реєстр/dec/fetch_dec.py --pdfs     (по одному PDF на категорію — для кодів МКХ-10)
Після нього: python 05_Веб_реєстр/dec/extract_icd.py і python tools/sources_build.py --only dec

⚠ Wordfence сайту блокує IP на годину за частоту — тоді й у браузері сайт ДЕЦ не відкривається.
Пауза між запитами 8 с; на сторінці блоку скрипт зупиняється сам (код 2), без повторів.
"""
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHELF = ROOT / "0_10_класификатори" / "dec_gov_ua"
BASE = "https://www.dec.gov.ua"
LIST_URL = BASE + "/cat_mtd/galuzevi-standarti-ta-klinichni-nastanovi/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
# Wordfence сайту ДЕЦ блокує IP на годину, якщо запитів більше ~20 за хвилину (24.11.2026:
# блок після ~40 сторінок з паузою 1,5 с). 8 с — із запасом; повний обхід ≈ 30 хв.
PAUSE = 8


class Blocked(Exception):
    pass


def get(url, tries=6):
    wait = 5
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "uk,en;q=0.5"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", "replace")
            except Exception:
                pass
            if "обмежив вам доступ" in body or "Wordfence" in body:
                # Блок Wordfence за частоту (Retry-After 3600): повтори лише подовжують його
                raise Blocked(e.headers.get("Retry-After", "3600"))
            if e.code in (429, 500, 502, 504) and attempt < tries - 1:
                print(f"  {e.code} — чекаю {wait} с: {url}", flush=True)
                time.sleep(wait)
                wait = min(wait * 2, 120)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < tries - 1:
                print(f"  {e} — чекаю {wait} с", flush=True)
                time.sleep(wait)
                wait = min(wait * 2, 120)
                continue
            raise


def listing_part(html):
    """Лише блок переліку (#content), без бокової панелі «Останні оновлення»."""
    i = html.find('id="content"')
    j = html.find('class="col-xl-4', i)
    return html[i:j] if i >= 0 else ""


PICK_ORDER = {"стандарт": 0, "протокол": 1, "настанова": 2, "клінічна настанова": 2}


def fetch_pdfs():
    """По одному PDF на категорію — джерело кодів МКХ-10 для extract_icd.py.
    Беремо чинний стандарт, інакше УКПМД (протокол), інакше настанову; новіший — першим."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from build_dec import parse_category, parse_dates, state_of  # noqa: E402
    man = json.loads((SHELF / "manifest.json").read_text(encoding="utf-8"))
    (SHELF / "pdf").mkdir(exist_ok=True)
    picks_p = SHELF / "pdf" / "picks.json"
    picks = json.loads(picks_p.read_text(encoding="utf-8")) if picks_p.exists() else {}
    failed = []
    for slug in man.get("categories", []):
        p = SHELF / "mtd" / f"{slug}.html"
        if not p.exists():
            continue
        rows = parse_category(slug, p.read_text(encoding="utf-8"))["rows"]
        cand = [r for r in rows if r["type_raw"].lower() in PICK_ORDER and r["url"].lower().endswith(".pdf")]
        if not cand:
            continue

        def key(r):
            pub = parse_dates(r["date_raw"])[0]
            return (state_of(r["status_raw"]) != "чинний", PICK_ORDER[r["type_raw"].lower()],
                    "-".join(reversed(pub.split("."))) if pub else "")
        cand.sort(key=lambda r: (key(r)[0], key(r)[1]))
        best = cand[0]
        fname = hashlib.sha1(best["url"].encode()).hexdigest()[:10] + ".pdf"
        picks[slug] = {"file": fname, "url": best["url"], "type": best["type_raw"], "number": best["number"]}
        dst = SHELF / "pdf" / fname
        if dst.exists() and dst.stat().st_size > 1000:
            continue
        time.sleep(PAUSE)
        try:
            req = urllib.request.Request(best["url"], headers={"User-Agent": UA})
            for attempt in range(5):
                try:
                    with urllib.request.urlopen(req, timeout=120) as r:
                        dst.write_bytes(r.read())
                    break
                except urllib.error.HTTPError as e:
                    if e.code == 503 and "обмежив" in e.read().decode("utf-8", "replace"):
                        raise Blocked(e.headers.get("Retry-After", "3600"))
                    if e.code in (429, 503) and attempt < 4:
                        time.sleep(10 * (attempt + 1))
                        continue
                    raise
            print(f"  pdf {slug}", flush=True)
        except Blocked:
            raise
        except Exception as e:  # noqa: BLE001
            failed.append(slug)
            print(f"  ✗ pdf {slug}: {e}", flush=True)
        picks_p.write_text(json.dumps(picks, ensure_ascii=False, indent=1), encoding="utf-8")
    picks_p.write_text(json.dumps(picks, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"PDF: {len(picks)} категорій, не завантажено {len(failed)}")


def main():
    args = sys.argv[1:]
    if "--pdfs" in args:
        return fetch_pdfs()
    force = "--force" in args
    max_age = 7
    if "--max-age" in args:
        max_age = float(args[args.index("--max-age") + 1])
    (SHELF / "list").mkdir(parents=True, exist_ok=True)
    (SHELF / "mtd").mkdir(parents=True, exist_ok=True)
    man_path = SHELF / "manifest.json"
    man = json.loads(man_path.read_text(encoding="utf-8")) if man_path.exists() else {}
    files = man.get("files", {})
    now = datetime.now(timezone.utc)

    def fresh(rel):
        if force or rel not in files or not (SHELF / rel).exists():
            return False
        t = datetime.fromisoformat(files[rel]["fetched"])
        return (now - t).total_seconds() < max_age * 86400

    def save(rel, url, html):
        (SHELF / rel).write_text(html, encoding="utf-8")
        files[rel] = {"url": url, "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      "sha": hashlib.sha256(html.encode("utf-8")).hexdigest()[:16]}
        man["files"] = files
        man_path.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")

    # 1. Сторінки переліку
    first = get(LIST_URL)
    save("list/page-1.html", LIST_URL, first)
    pages = [int(n) for n in re.findall(r"/galuzevi-standarti-ta-klinichni-nastanovi/page/(\d+)/", first)]
    last = max(pages) if pages else 1
    print(f"Сторінок переліку: {last}", flush=True)
    failed = []
    for n in range(2, last + 1):
        rel = f"list/page-{n}.html"
        if fresh(rel):
            continue
        time.sleep(PAUSE)
        url = f"{LIST_URL}page/{n}/"
        try:
            save(rel, url, get(url))
        except Blocked:
            raise
        except Exception as e:  # noqa: BLE001
            failed.append(f"list/page-{n}")
            print(f"  ✗ перелік {n}: {e}", flush=True)
            continue
        print(f"  перелік {n}/{last}", flush=True)

    # 2. Категорії
    cats = []
    for n in range(1, last + 1):
        p = SHELF / f"list/page-{n}.html"
        if not p.exists():
            continue
        part = listing_part(p.read_text(encoding="utf-8"))
        for slug in re.findall(r'href="https://www\.dec\.gov\.ua/mtd/([^"/]+)/"', part):
            if slug not in cats:
                cats.append(slug)
    print(f"Категорій у переліку: {len(cats)}", flush=True)
    man["categories"] = cats
    man_path.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    for k, slug in enumerate(cats, 1):
        rel = f"mtd/{slug}.html"
        if fresh(rel):
            continue
        time.sleep(PAUSE)
        url = f"{BASE}/mtd/{slug}/"
        try:
            save(rel, url, get(url))
        except Blocked:
            raise
        except Exception as e:  # noqa: BLE001 — сторінка лишається в переліку на дозавантаження
            failed.append(slug)
            print(f"  ✗ {slug}: {e}", flush=True)
            continue
        if k % 10 == 0:
            print(f"  категорія {k}/{len(cats)}", flush=True)

    man["categories"] = cats
    man["list_pages"] = last
    man["completed"] = datetime.now(timezone.utc).isoformat(timespec="seconds") if not failed else None
    man["failed"] = failed
    man_path.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    if failed:
        print(f"Не завантажено {len(failed)} — запустіть ще раз (докачає лише їх).")
        sys.exit(1)
    print("Готово.")


if __name__ == "__main__":
    try:
        main()
    except Blocked as b:
        print(f"⛔ Сайт ДЕЦ тимчасово заблокував доступ за частоту запитів (Retry-After {b} с). "
              f"Запустіть пізніше — уже завантажене не тягнеться вдруге.")
        sys.exit(2)
