# -*- coding: utf-8 -*-
"""Коди НК 025 (МКХ-10) категорій ДЕЦ — з самих документів ДЕЦ, а не «від руки».

Аудит 24.11.2026, К4: у старому dec_document_codes.json коди були вигадані (рак молочної залози →
«введення ВМП»). Тут коди беруться з PDF стандарту / УКПМД / настанови: у паспорті документа є
розділ «Шифр (код) за МКХ-10». PDF кладе на полицю fetch_dec.py --pdfs.

Правило вибору кодів (щоб не тягнути випадкові коди з тексту):
  1. Шукаємо в тексті перше згадування «МКХ» і беремо коди у вікні після нього (до 2500 знаків
     або до наступного розділу). Діапазони «I20–I25» розкриваємо до рубрик.
  2. Код лишається, лише якщо він є в НК 025 (classifiers/data/nk025_index.json) — рубрикою
     або підрубрикою. Кирилицю в кодах (С50 з кириличною С) зводить homoglyph_fix.fix_code.
  3. Якщо вікна з «МКХ» немає — коди не беремо зовсім (категорія лишається без кодів).
Пише dec/data/dec_icd.json: {categories: {slug: {codes, from, doc, quote}}}.

Запуск: python 05_Веб_реєстр/dec/extract_icd.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
ROOT = WEB.parent
SHELF = ROOT / "0_10_класификатори" / "dec_gov_ua"
OUT = WEB / "dec" / "data" / "dec_icd.json"
sys.path.insert(0, str(WEB / "classifiers"))
import homoglyph_fix as hf  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

CYR = "АВСЕНІКМОРТХ"
LAT = "ABCEHIKMOPTX"
L = f"[A-Z{CYR}]"
RE_CODE = re.compile(rf"(?<![A-Za-zА-Яа-яІіЇїЄєҐґ0-9]){L} ?\d{{2}}(?:\.\d{{1,2}})?(?:\*|†)?(?![\d.]\d)")
RE_RANGE = re.compile(rf"({L} ?\d{{2}})(?:\.\d{{1,2}})?\s*[-–—]\s*({L} ?\d{{2}})(?:\.\d{{1,2}})?")
# Якір — заголовок розділу про коди в паспорті документа, а не будь-яка згадка «МКХ»
# (вона є й у переліку скорочень, звідки колись потрапили випадкові коди R80, R81).
RE_MKH = re.compile(
    r"Код(?:и|ів)?\s+стану\s+або\s+захворювання"
    r"|(?:Шифр|Код(?:и|ів)?)[^\n.]{0,60}?(?:МКХ|МКБ|НК\s*025|ICD[- ]?10|Міжнародн\w+\s+(?:статистичн\w+\s+)?класифікац\w+\s+хвороб)",
    re.I)
TR = str.maketrans(CYR, LAT)
# Крапка між літерою й цифрами коду: «D.86.» → D86 (лише якщо такий код є в НК 025)
RE_DOT_TYPO = re.compile(rf"(?<![A-Za-zА-Яа-яІіЇїЄєҐґ0-9.])({L})\.(\d{{2}})(?![\d])")


def text_of(pdf):
    try:
        r = subprocess.run(["pdftotext", "-enc", "UTF-8", "-l", "25", str(pdf), "-"],
                           capture_output=True, timeout=120)
        return r.stdout.decode("utf-8", "replace")
    except Exception:
        return ""


def expand(a, b):
    a, b = a.translate(TR), b.translate(TR)
    if a[0] != b[0]:
        return [a, b]
    x, y = int(a[1:3]), int(b[1:3])
    if y < x or y - x > 40:
        return [a, b]
    return [f"{a[0]}{n:02d}" for n in range(x, y + 1)]


def main():
    nk = json.loads((WEB / "classifiers/data/nk025_index.json").read_text(encoding="utf-8"))
    nk025 = {x["c"] for x in nk}
    picks = json.loads((SHELF / "pdf" / "picks.json").read_text(encoding="utf-8"))
    out, none = {}, []
    by_file = {}
    for slug, p in picks.items():
        by_file.setdefault(p["file"], []).append(slug)
    shared = {f: v for f, v in by_file.items() if len(v) > 1}
    for slug, p in picks.items():
        if p["file"] in shared:
            # Один PDF на кілька категорій (напр. настанова 2014 з гепатології): чиї це коди — невідомо
            none.append(slug)
            continue
        pdf = SHELF / "pdf" / p["file"]
        if not pdf.exists():
            none.append(slug)
            continue
        t = text_of(pdf)
        windows = []
        for m in RE_MKH.finditer(t):
            windows.append(t[m.start(): m.start() + 2500])
            if len(windows) >= 3:
                break
        codes = []
        fixes = []
        quote = ""
        for w in windows:
            # Обрізаємо вікно на наступному великому розділі паспорта
            cut = re.search(r"\n\s*(?:\d\.\d+\.?\s+|[IVX]+\.\s+)?(?:Протокол|Призначення|Дата складання|Розробники|"
                            r"Цільові групи|Мета|Коротка|Епідеміолог|Загальна частина|Перелік скорочень)", w[40:])
            if cut:
                w = w[: 40 + cut.start()]
            # Коди інших класифікацій (ICPC-2: R80 «грип») стоять поруч і схожі на МКХ — відрізаємо
            # ... і коди Єдиного класифікатора попередніх діагнозів для бригад ЕМД (A80, A88.5 «шок»)
            icpc = re.search(r"ICPC|МКПМД|Міжнародн\w+ класифікац\w+ первинн|Єдин\w+ класифікатор|"
                             r"класифікатор\w* попередніх діагнозів", w[20:])
            if icpc:
                w = w[: 20 + icpc.start()]
            # Коди йдуть переліком одразу за заголовком; після переліку — текст. Перерва понад
            # 400 знаків між кодами = перелік скінчився (так відсікається випадковий код далі в тексті).
            last = None
            for mm in RE_CODE.finditer(w):
                if last is not None and mm.start() - last > 400:
                    w = w[: last + 10]
                    break
                last = mm.end()
            # Помилка набору в паспорті: «D.86.» замість «D86» (саркоїдоз, УКПМД 2014-634).
            # Виправлення не мовчазне: «було → стало» йде в журнал правок (errata_dec.json).
            for mm in RE_DOT_TYPO.finditer(w):
                fixed = (mm.group(1) + mm.group(2)).translate(TR)
                if fixed in nk025 and not any(f["was"] == mm.group(0) for f in fixes):
                    fixes.append({"was": mm.group(0), "now": fixed})
            w = RE_DOT_TYPO.sub(lambda mm: mm.group(1) + mm.group(2), w)
            found = []
            for a, b in RE_RANGE.findall(w):
                found += expand(a.replace(" ", ""), b.replace(" ", ""))
            for c in RE_CODE.findall(w):
                c = c.rstrip("*†").replace(" ", "").translate(TR)
                found.append(c)
            found = [c for c in found if c in nk025 or c.split(".")[0] in nk025]
            if found:
                codes += found
                if not quote:
                    quote = re.sub(r"\s+", " ", w[:300]).strip()
        seen, uniq = set(), []
        for c in codes:
            if c not in seen:
                seen.add(c)
                uniq.append(c)
        if not uniq:
            none.append(slug)
            continue
        out[slug] = {"codes": uniq[:120], "from": f"{p['type']} {p['number']}".strip(), "doc": p["url"],
                     "quote": quote[:300]}
        if fixes:
            out[slug]["fixes"] = fixes
    OUT.write_text(json.dumps({"about": __doc__.split("\n")[0], "categories": dict(sorted(out.items()))},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Коди МКХ-10 знайдено для {len(out)} категорій з {len(picks)}; без кодів — {len(none)}")
    if none:
        print("  без кодів:", none[:20], "…" if len(none) > 20 else "")


if __name__ == "__main__":
    main()
