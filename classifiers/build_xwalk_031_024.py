# -*- coding: utf-8 -*-
"""
Місток НК 031:2024 (EMDN) ↔ НК 024:2023 (GMDN) за українськими назвами.

Офіційного зіставлення EMDN↔GMDN не існує: Єврокомісія такої таблиці не видавала
(MDCG 2021-12 прямо каже, що мапінг залежить від співпраці з GMDN Agency), а сервіс
самої GMDN Agency платний. Тому будуємо ОРІЄНТОВНИЙ місток — косинусна близькість
назв, зважена за IDF, з грубим стемінгом української. Це підказка для експерта,
а не нормативне зіставлення; у фронті так і підписано.

Вихід:
  data/nk031/xwalk/<catId>.json  — {код EMDN: [[код GMDN, бал, назва GMDN], …]}
                                   ліниво по категоріях (як terms у НК 024).
  data/nk024/xwalk/<letterId>.json — зворотний бік: {код GMDN: [[код EMDN, бал, назва EMDN], …]}
  data/nk031/xwalk_meta.json     — параметри й покриття.
"""
import json, math, re, sys, time
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
D31, D24 = BASE / "data" / "nk031", BASE / "data" / "nk024"
(D31 / "xwalk").mkdir(parents=True, exist_ok=True)
(D24 / "xwalk").mkdir(parents=True, exist_ok=True)

TOP = 5           # скільки відповідників лишаємо з кожного боку
MIN_SCORE = 0.40  # поріг косинуса
RARE_DF = 600     # стем, рідкісніший за це, вважаємо «змістовним»
CAND_STEMS = 5    # скільки найрідкісніших стемів беремо для добору кандидатів

STOP = set("""для та і й з із зі у в на до без при або чи що як які який яка яке
з-поміж від по за під над між через після перед разом крім тощо тип типу виду
виду інше інший інша інші інших з’єднання""".split())

SPLIT = re.compile(r"[^0-9a-zа-яіїєґ']+", re.I)
ENDINGS = ("ами", "ями", "ові", "еві", "ний", "них", "ним", "ної", "ного", "ний",
           "ий", "ій", "их", "ім", "ої", "ою", "ах", "ях", "ів", "ам", "ям", "ом",
           "ем", "ах", "ці", "ки", "ка", "ку", "ко", "ти", "и", "і", "а", "я", "у",
           "ю", "е", "о", "й")


def stem(w):
    w = w.strip("'")
    if len(w) <= 4 or not re.search(r"[а-яіїєґ]", w):
        return w
    for e in ENDINGS:
        if len(w) - len(e) >= 4 and w.endswith(e):
            w = w[: len(w) - len(e)]
            break
    return w[:7]


def toks(name):
    out = []
    for w in SPLIT.split(str(name or "").lower().replace("’", "'")):
        if not w or w in STOP or len(w) < 2:
            continue
        out.append(stem(w))
    return out


# Родові «голови» назв: в EMDN позиція часто зветься «ПРИСТРОЇ ДЛЯ…», а в GMDN той самий
# виріб — конкретним іменником. На таких головах вимога збігу не працює, тож їх пропускаємо.
GENERIC_HEAD = {"пристр", "інструм", "систем", "апарат", "набір", "набор", "засіб", "засоб",
                "виріб", "вироб", "аксесу", "обладн", "матеріа", "компоне", "прилад", "техніка",
                "додатк", "різні", "різне", "прочее", "продукт", "модуль", "блок"}


def head_of(tokens):
    """Головне слово назви — перший змістовний токен."""
    return tokens[0] if tokens else ""


def vec(tokens, idf):
    c = Counter(tokens)
    v = {t: (1 + math.log(n)) * idf.get(t, 6.0) for t, n in c.items()}
    norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
    return {t: x / norm for t, x in v.items()}, norm


def main():
    t0 = time.time()
    idx24 = json.load(open(D24 / "nk024_index.json", encoding="utf-8"))     # [code, ua, en, letterId, flags]
    idx31 = json.load(open(D31 / "nk031_index.json", encoding="utf-8"))     # [code, name, catId, level, leaf]
    print(f"НК 024: {len(idx24)} · НК 031: {len(idx31)}")

    tok24 = [toks(e[1]) for e in idx24]
    tok31 = [toks(e[1]) for e in idx31]

    df = Counter()
    for t in tok24: df.update(set(t))
    for t in tok31: df.update(set(t))
    N = len(tok24) + len(tok31)
    idf = {t: math.log(N / (1 + n)) for t, n in df.items()}

    v24 = [vec(t, idf)[0] for t in tok24]
    v31 = [vec(t, idf)[0] for t in tok31]

    meta31 = json.load(open(D31 / "nk031_meta.json", encoding="utf-8"))
    W_CAT = next((c["id"] for c in meta31["categories"] if c["letter"] == "W"), -1)
    # Ознака IVD у НК 024 виведена з ОПИСУ, а він у частині записів мовчить — тому
    # додатково дивимось саму назву («… IVD (діагностика in vitro), реагент»).
    is_ivd24 = [bool(e[4] & 4) or "ivd" in e[1].lower() or "in vitro" in e[1].lower()
                for e in idx24]

    inv = defaultdict(list)                      # стем → індекси НК 024
    for i, t in enumerate(tok24):
        for s in set(t):
            inv[s].append(i)

    fwd = defaultdict(dict)                      # catId → {emdn: [...]}
    rev_pairs = defaultdict(list)                # gmdn code → [(score, emdn code, emdn name)]
    matched = 0

    for j, e31 in enumerate(idx31):
        vb = v31[j]
        if not vb:
            continue
        stems = sorted(set(tok31[j]), key=lambda s: df[s])[:CAND_STEMS]
        cand = set()
        for s in stems:
            lst = inv.get(s)
            if lst and len(lst) <= 4000:
                cand.update(lst)
        if not cand:
            continue
        h31 = head_of(tok31[j])
        set31 = set(tok31[j])
        # Категорія W НК 031 — це вироби для діагностики in vitro; у НК 024 ознака IVD
        # стоїть бітом 4. Схрещувати IVD з не-IVD не можна: інакше «шкірні степлери»
        # ловлять «шкірні антитіла IVD».
        want_ivd = idx31[j][2] == W_CAT
        scored = []
        for i in cand:
            if is_ivd24[i] != want_ivd:
                continue
            va, vb2 = (v24[i], vb) if len(v24[i]) <= len(vb) else (vb, v24[i])
            s = sum(x * vb2.get(t, 0.0) for t, x in va.items())
            if s < MIN_SCORE:
                continue
            # Спільних змістовних слів має бути щонайменше два — одного збігу замало
            # («поліетиленові рукавички» ≠ «поліетиленовий протез коліна»). Виняток —
            # односкладові назви (ПУЛЬСОКСИМЕТРИ ↔ Пульсоксиметр) і дуже високий бал.
            set24 = set(tok24[i])
            shared = [t for t in set24 & set31 if df[t] <= RARE_DF]
            if not shared:
                continue
            if len(shared) < 2 and s < 0.72 and min(len(set24), len(set31)) > 1:
                continue
            h24 = head_of(tok24[i])
            if h31 and h31 == h24:
                s *= 1.20
            elif h31 in set24 or h24 in set31:
                s *= 1.05
            scored.append((min(s, 1.0), i))
        if not scored:
            continue
        scored.sort(key=lambda x: (-x[0], idx24[x[1]][0]))
        top = scored[:TOP]
        matched += 1
        code31, name31, cat31 = e31[0], e31[1], e31[2]
        fwd[cat31][code31] = [[idx24[i][0], round(s, 3), idx24[i][1][:110]] for s, i in top]
        for s, i in top:
            rev_pairs[idx24[i][0]].append((s, code31, name31[:110]))
        if j and j % 1000 == 0:
            print(f"  {j}/{len(idx31)} · збігів {matched} · {time.time()-t0:.0f} с")

    # ── прямий бік: ліниво по категоріях ──────────────────────────────
    for c in meta31["categories"]:
        payload = fwd.get(c["id"], {})
        with open(D31 / "xwalk" / f"{c['id']:02d}.json", "w", encoding="utf-8") as fp:
            json.dump(payload, fp, ensure_ascii=False, separators=(",", ":"))

    # ── зворотний бік: ліниво по літерних розділах НК 024 ─────────────
    letter_of = {e[0]: e[3] for e in idx24}
    rev = defaultdict(dict)
    for code24, lst in rev_pairs.items():
        lst.sort(key=lambda x: (-x[0], x[1]))
        rev[letter_of[code24]][code24] = [[c, round(s, 3), n] for s, c, n in lst[:TOP]]
    meta24 = json.load(open(D24 / "nk024_meta.json", encoding="utf-8"))
    for l in meta24["letters"]:
        with open(D24 / "xwalk" / f"{l['id']:02d}.json", "w", encoding="utf-8") as fp:
            json.dump(rev.get(l["id"], {}), fp, ensure_ascii=False, separators=(",", ":"))

    leaves = sum(1 for e in idx31 if e[4])
    leaf_matched = sum(1 for e in idx31 if e[4] and e[0] in fwd.get(e[2], {}))
    meta = {
        "generated": time.strftime("%Y-%m-%d"),
        "method": "косинусна близькість українських назв (TF-IDF, грубий стемінг), "
                  f"поріг {MIN_SCORE}, до {TOP} відповідників з кожного боку",
        "disclaimer": "Офіційного зіставлення EMDN↔GMDN не існує (MDCG 2021-12). "
                      "Це орієнтовна підказка за назвами, не нормативна відповідність.",
        "nk031_total": len(idx31), "nk031_matched": matched,
        "nk031_leaves": leaves, "nk031_leaves_matched": leaf_matched,
        "nk024_total": len(idx24), "nk024_matched": len(rev_pairs),
        "params": {"min_score": MIN_SCORE, "top": TOP, "rare_df": RARE_DF},
    }
    with open(D31 / "xwalk_meta.json", "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=1)

    print(f"Готово за {time.time()-t0:.0f} с")
    print(f"  НК 031 з відповідниками: {matched}/{len(idx31)} "
          f"(найнижчий рівень: {leaf_matched}/{leaves})")
    print(f"  НК 024 з відповідниками: {len(rev_pairs)}/{len(idx24)}")


if __name__ == "__main__":
    main()
