# -*- coding: utf-8 -*-
"""ПІЛОТ: шар подвійного кодування «хрестик — зірочка» поверх НК 025.

Читає data/nk025_index.json (НЕ змінює його), пише data/pilot_koduvannia.json.
Окремий конвеєр: build_nk025.py та основні дані розділу не чіпає.

Що робить:
  1. Знаходить у назвах кодів дужкові посилання з † (хрестик) та * (зірочка).
  2. Нормалізує токени кодів: кириличні гомогліфи -> латиниця, OCR "l" -> "1".
  3. Розуміє всі форми запису: одиночний код (E84.1), рубрику (G30),
     рубрику з крапкою-тире (G30.-), підрубрику з тире (M89.4-),
     діапазон в межах літери (M50-M51) і через літеру (C00-D48, A00-B94.9).
     Якщо названої підрубрики в НК 025 немає (E84.1) — відкат на рубрику.
  4. Будує пари «основний діагноз (†) <-> код прояву (*)» в обидва боки:
     - власний † у назві => сам код є проявом, посилання — на основні;
     - власна * у назві => сам код є основним, посилання — на прояви.
  5. Зворотні позначки чіпляє на САМЕ названі коди (зазвичай рубрики) —
     сторінка сама піднімається від підрубрики до рубрики за префіксом.

Формат byCode:
  "G55.1": {"manif":[{"raw":"M50-M51 †","codes":["M50","M51"]}]}  — код прояву
  "M51":   {"mainFor":["G55.1"]}                                  — основний
"""
import json
import re
import datetime
from pathlib import Path

BASE = Path(__file__).parent
SRC = BASE / "data" / "nk025_index.json"
OUT = BASE / "data" / "pilot_koduvannia.json"

# Кириличні літери, що виглядають як латинські (та сама пастка гомогліфів,
# що в кодах ДСГ постанови 1503 і в довіднику ЕСОЗ)
HOMO = str.maketrans("АВСЕНІКМОРТХ", "ABCEHIKMOPTX")

RE_GROUP = re.compile(r"\(([^()]*[†*][^()]*)\)")
RE_RANGE = re.compile(r"^([A-Z])(\d{2})(?:\.\d{1,2})?-([A-Z])(\d{2})(?:\.\d{1,2})?$")
RE_SUBDASH = re.compile(r"^([A-Z]\d{2}\.\d{1,2})-$")
RE_RUBDASH = re.compile(r"^([A-Z]\d{2})\.-?$")
RE_FULL = re.compile(r"^[A-Z]\d{2}\.\d{1,2}$")
RE_RUBRIC = re.compile(r"^[A-Z]\d{2}$")


def norm_token(raw: str) -> str:
    """Нормалізація токена коду: гомогліфи, OCR-хиби, прибрати пробіли."""
    t = raw.translate(HOMO)
    t = t.replace("l", "1")          # G30.l -> G30.1 (брак розпізнавання)
    t = re.sub(r"\s+", "", t)
    return t


def main() -> None:
    idx = json.loads(SRC.read_text(encoding="utf-8"))
    codes = {}                        # нормалізований код -> оригінальний з індексу
    for e in idx:
        codes[norm_token(e["c"])] = e["c"]

    def rubric(r: str):
        return [codes[r]] if r in codes else []

    def span(al: str, an: int, bl: str, bn: int):
        """Діапазон рубрик, можливо через літеру: C00-D48 -> C00..C99 + D00..D48."""
        out = []
        for L in range(ord(al), ord(bl) + 1):
            lo = an if L == ord(al) else 0
            hi = bn if L == ord(bl) else 99
            for n in range(lo, hi + 1):
                out.extend(rubric(f"{chr(L)}{n:02d}"))
        return out

    fixes, unresolved = [], []
    n_fallback = 0
    by_code = {}

    def bc(code: str) -> dict:
        return by_code.setdefault(code, {})

    n_dagger = n_aster = 0
    for e in idx:
        name = e["n"]
        groups = RE_GROUP.findall(name)
        if not groups:
            if "†" in name or "*" in name:
                unresolved.append({"code": e["c"], "raw": name[-60:],
                                   "why": "знак поза дужками"})
            continue
        for g in groups:
            has_dagger = "†" in g
            has_aster = "*" in g
            body = g.replace("†", "").replace("*", "")
            tokens = [t.strip() for t in body.split(",") if t.strip()]
            resolved_all, notes = [], []
            for raw in tokens:
                t = norm_token(raw)
                if re.sub(r"\s+", "", raw) != t:
                    fixes.append({"code": e["c"], "raw": raw, "norm": t})
                targets, fell = [], False
                m = RE_RANGE.match(t)
                if m and (m.group(1), m.group(2)) != (m.group(3), m.group(4)):
                    targets = span(m.group(1), int(m.group(2)),
                                   m.group(3), int(m.group(4)))
                elif m:  # діапазон виду M50-M50.9 — одна рубрика
                    targets = rubric(m.group(1) + m.group(2))
                elif RE_SUBDASH.match(t):
                    sub = RE_SUBDASH.match(t).group(1)
                    targets = [codes[sub]] if sub in codes else rubric(sub[:3])
                    fell = sub not in codes and bool(targets)
                elif RE_RUBDASH.match(t):
                    targets = rubric(RE_RUBDASH.match(t).group(1))
                elif RE_FULL.match(t):
                    if t in codes:
                        targets = [codes[t]]
                    else:
                        targets = rubric(t[:3])   # підрубрики немає — відкат
                        fell = bool(targets)
                elif RE_RUBRIC.match(t):
                    targets = rubric(t)
                if not targets:
                    unresolved.append({"code": e["c"], "raw": raw, "norm": t,
                                       "why": "не знайдено в НК 025"})
                    continue
                if fell:
                    n_fallback += 1
                    notes.append(f"{t}: у НК 025 немає, взято рубрику {t[:3]}")
                resolved_all.extend(targets)
            if not resolved_all:
                continue
            ref = {"raw": g.strip(), "codes": sorted(set(resolved_all))}
            if notes:
                ref["notes"] = notes
            if has_dagger:
                # сам код — прояв; посилання — на основні діагнози
                n_dagger += 1
                bc(e["c"]).setdefault("manif", []).append(ref)
                for t_code in ref["codes"]:
                    lst = bc(t_code).setdefault("mainFor", [])
                    if e["c"] not in lst:
                        lst.append(e["c"])
            if has_aster:
                # сам код — основний; посилання — на коди прояву
                n_aster += 1
                bc(e["c"]).setdefault("mainOf", []).append(ref)
                for t_code in ref["codes"]:
                    m_ref = bc(t_code).setdefault("manifOf", [])
                    if e["c"] not in m_ref:
                        m_ref.append(e["c"])

    out = {
        "meta": {
            "built": datetime.date.today().isoformat(),
            "source": "nk025_index.json (лише читання)",
            "names_with_dagger": sum(1 for e in idx if "†" in e["n"]),
            "names_with_aster": sum(1 for e in idx if "*" in e["n"]),
            "groups_dagger": n_dagger,
            "groups_aster": n_aster,
            "codes_flagged": len(by_code),
            "fallbacks": n_fallback,
            "fixes": fixes,
            "unresolved": unresolved,
        },
        "byCode": by_code,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")

    print(f"назв із †: {out['meta']['names_with_dagger']}, "
          f"груп † розібрано: {n_dagger}")
    print(f"назв із *: {out['meta']['names_with_aster']}, "
          f"груп * розібрано: {n_aster}")
    print(f"кодів у byCode: {len(by_code)}, відкатів на рубрику: {n_fallback}")
    print(f"виправлень OCR/гомогліфів: {len(fixes)}")
    for f in fixes:
        print("   fix:", f["code"], "|", f["raw"], "->", f["norm"])
    print(f"нерозв'язаних: {len(unresolved)}")
    for u in unresolved:
        print("   unresolved:", u["code"], "|", u.get("raw", ""), "|", u["why"])
    size = OUT.stat().st_size
    print(f"записано: {OUT} ({size/1024:.0f} КБ)")


if __name__ == "__main__":
    main()
