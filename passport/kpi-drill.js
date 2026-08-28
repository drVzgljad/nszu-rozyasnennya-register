/**
 * Розгортка KPI-плитки термометра — пояснювально-візуальна сторінка одного
 * показника: що саме він вимірює, як виглядає в цифрах, кого стосується
 * поіменно і що з цього випливає для пакета.
 *
 * Перша плитка — «Ядро: 80 % бюджету». Реєстр DRILLS відкритий: наступна
 * плитка додається одним записом {icon, title, build}.
 *
 * Файл підключається ПІСЛЯ passport.js і спирається на його глобали
 * (passportState, el, escapeHtml, pctUk, formatMoneyShort, formatCurrency,
 * oblastDisplay, medianOf, renderHospitalsTable, renderComboFilterChip).
 */
(function () {
  "use strict";

  /* ═══════ дрібні помічники: числа й українська морфологія ═══════ */

  const uaNum = (v) => Number(v).toLocaleString("uk-UA");
  // Точна сума без копійок: короткий формат («10,6 млн ₴») ховає різницю між
  // останнім закладом ядра і першим закладом хвоста, а вона тут і є суттю
  const moneyExact = (v) => `${Math.round(v).toLocaleString("uk-UA")} ₴`;

  // «1 заклад / 2 заклади / 5 закладів»
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 10, b = Math.abs(n) % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
  }
  const zozUk = (n) => plural(n, "заклад", "заклади", "закладів");
  const dilyt = (n) => plural(n, "ділить", "ділять", "ділять");
  const otrym = (n) => plural(n, "отримує", "отримують", "отримують");
  const najb = (n) => plural(n, "найбільший", "найбільші", "найбільших");
  // Показник трапляється тільки в місцевому відмінку («в усіх 25 …»), тому
  // слово «область» замінене на «регіон»: у нього там однакова форма
  const regUk = (n) => plural(n, "регіоні", "регіонах", "регіонах");

  // «у 3,1 раза» / «у 15 разів». Дробові завжди беруть «раза».
  function timesUk(v) {
    if (!isFinite(v) || v < 1.15) return "майже стільки само";
    if (v >= 10) {
      const n = Math.round(v);
      return `у ${uaNum(n)} ${plural(n, "раз", "рази", "разів")}`;
    }
    return `у ${v.toFixed(1).replace(".", ",")} раза`;
  }

  /* ═══════ арифметика ядра ═══════

     Ядро — найбільші заклади, які разом набирають 4/5 бюджету пакета.
     Рахунок навмисно повторює код плитки крок у крок (accumulate → break),
     щоб число на сторінці і число на плитці не могли розійтися на одиницю
     через інший порядок округлень. */

  function computeCore(pkgNum) {
    const rows = [];
    passportState.contractsData.contracts.forEach((c) => {
      const p = c.packages.find((x) => x.package_num === pkgNum);
      if (p) rows.push({ c, sum: p.sum || 0 });
    });
    const paid = rows.filter((r) => r.sum > 0).sort((a, b) => b.sum - a.sum);
    const total = paid.reduce((a, r) => a + r.sum, 0);
    if (!total || !paid.length) return null;

    let acc = 0, core = 0;
    for (const r of paid) { acc += r.sum; core++; if (acc >= total * 0.8) break; }

    const coreRows = paid.slice(0, core);
    const tailRows = paid.slice(core);
    const coreSum = coreRows.reduce((a, r) => a + r.sum, 0);

    // Накопичена частка бюджету після i-го закладу — основа кривої
    const cum = [];
    let run = 0;
    paid.forEach((r) => { run += r.sum; cum.push(run / total); });
    const at = (share) => {
      const k = Math.max(1, Math.round(paid.length * share));
      return { k, pct: cum[k - 1] * 100 };
    };

    // По областях: скільки закладів ядра і скільки грошей пакета в кожній
    const oblCore = new Map();
    coreRows.forEach(({ c, sum }) => {
      const o = c.oblast || "—";
      const rec = oblCore.get(o) || { n: 0, sum: 0 };
      rec.n++; rec.sum += sum; oblCore.set(o, rec);
    });
    const oblAll = new Set(paid.map((r) => r.c.oblast).filter(Boolean));
    const oblNoCore = [...oblAll].filter((o) => !oblCore.has(o))
      .sort((a, b) => a.localeCompare(b, "uk"));

    const byKey = (arr, key) => {
      const m = new Map();
      arr.forEach(({ c }) => {
        const v = c[key] || "—";
        m.set(v, (m.get(v) || 0) + 1);
      });
      return m;
    };

    // Скільки взагалі різних сум у пакеті: якщо їх одиниці — розмір договору
    // визначає норматив, а не заклад, і «концентрація» тут ні до чого
    const uniq = new Set(paid.map((r) => Math.round(r.sum))).size;

    return {
      pkgNum,
      net: rows.length,               // уся мережа пакета
      n: paid.length,                 // з них із сумою у вивантажці
      noSum: rows.length - paid.length,
      total,
      core, coreRows, tailRows,
      coreSum,
      coreMoneyPct: (coreSum / total) * 100,
      corePct: (core / paid.length) * 100,
      equalCount: Math.ceil(paid.length * 0.8),
      cum, paid,
      q10: at(0.10), q25: at(0.25), q50: at(0.50),
      medCore: medianOf(coreRows.map((r) => r.sum)),
      medTail: medianOf(tailRows.map((r) => r.sum)),
      minCore: coreRows.length ? coreRows[coreRows.length - 1].sum : 0,
      maxTail: tailRows.length ? tailRows[0].sum : 0,
      oblCore, oblAll, oblNoCore,
      ownCore: byKey(coreRows, "ownership"), ownTail: byKey(tailRows, "ownership"),
      netCore: byKey(coreRows, "network_type"), netTail: byKey(tailRows, "network_type"),
      uniqSums: uniq,
      // «Однакові договори» — це не просто «мало різних сум»: у пакеті з
      // чотирьох договорів різних сум теж мало. Ознака має сенс лише коли
      // ядро вже близьке до рівного поділу і мережа достатньо велика
      tiny: paid.length <= 6,
      flat: paid.length >= 12 && uniq <= Math.max(3, paid.length * 0.08)
            && (core / paid.length) * 100 >= 55,
    };
  }

  /* Черга всіх пакетів за щільністю ядра — щоб сказати «місце N із M»
     і намалювати лінійку. Рахується один раз на завантаження сторінки. */
  function coreBench() {
    if (passportState._coreBench) return passportState._coreBench;
    const valid = new Set(passportState.packages.map((p) => p.number));
    const per = new Map();
    passportState.contractsData.contracts.forEach((c) => {
      c.packages.forEach((p) => {
        if (!valid.has(p.package_num) || !(p.sum > 0)) return;
        let arr = per.get(p.package_num);
        if (!arr) { arr = []; per.set(p.package_num, arr); }
        arr.push(p.sum);
      });
    });
    const list = [];
    per.forEach((arr, num) => {
      arr.sort((a, b) => b - a);
      const total = arr.reduce((a, b) => a + b, 0);
      let acc = 0, k = 0;
      for (const s of arr) { acc += s; k++; if (acc >= total * 0.8) break; }
      list.push({ num, pct: (k / arr.length) * 100, k, n: arr.length });
    });
    list.sort((a, b) => a.pct - b.pct);
    passportState._coreBench = list;
    return list;
  }

  /* ═══════ малювання: два SVG ═══════ */

  /* Вузький екран. Полотна мають фіксований viewBox, тому підписи там треба
     не «зменшувати шрифт», а збільшувати кегль у одиницях viewBox і разом
     із ним поля під підписи. Ознака одна на обидва полотна. */
  const isCompact = () => Boolean(window.matchMedia && window.matchMedia("(max-width: 760px)").matches);

  /** Лійка «заклади → гроші»: дві смуги і стрічки між ними.
      Головна картинка сторінки — вона одна відповідає на питання.
      На вузькому екрані смуги вищі, а шрифти більші: viewBox однаковий,
      тож на 350 px підпис у 20 одиниць перетворився б на 7-піксельний. */
  function funnelSvg(s) {
    const compact = isCompact();
    const W = 1000;
    const BAR = compact ? 104 : 46;
    const GAP = compact ? 118 : 70;          // висота стрічок між смугами
    const TOP = compact ? 46 : 22;           // місце під верхній підпис
    const yA = TOP + (compact ? 44 : 30);
    const yB = yA + BAR + GAP;
    const H = yB + BAR + (compact ? 56 : 36);
    const fs = compact ? 46 : 20;            // кегль підпису всередині смуги
    const dy = yA + BAR / 2 + fs * 0.35;     // базова лінія тексту в смузі
    const dyB = yB + BAR / 2 + fs * 0.35;
    const rx = compact ? 14 : 9;

    const xA = Math.max(2, s.corePct) / 100 * W;
    const xB = Math.max(2, s.coreMoneyPct) / 100 * W;
    const inBar = (w) => w >= fs * 4;        // підпис влазить усередину сегмента
    const lbl = (x, y, text, cls, anchor) =>
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="${cls}" text-anchor="${anchor || "middle"}">${text}</text>`;
    // Ліва скруглена «шапка» сегмента ядра, щоб він лягав у смугу без щілин
    const cap = (x, y) => `M0 ${y + rx} a${rx} ${rx} 0 0 1 ${rx} -${rx} h${Math.max(0, x - rx).toFixed(1)} ` +
      `v${BAR} h-${Math.max(0, x - rx).toFixed(1)} a${rx} ${rx} 0 0 1 -${rx} -${rx} z`;

    const bar = (y, dyText, x, corePctText, tailPctText) => `
      <rect x="0" y="${y}" width="${W}" height="${BAR}" rx="${rx}" class="dr-tail-bar"/>
      <path d="${cap(x, y)}" class="dr-core-bar"/>
      ${inBar(x)
        ? lbl(x / 2, dyText, corePctText, "dr-inbar")
        : lbl(x + fs * 0.6, dyText, corePctText, "dr-outbar", "start")}
      ${inBar(W - x) ? lbl(x + (W - x) / 2, dyText, tailPctText, "dr-inbar-dim") : ""}`;

    return `
    <svg class="dr-funnel${compact ? " compact" : ""}" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Ядро — ${pctUk(s.corePct)} закладів — забирає ${pctUk(s.coreMoneyPct)} бюджету пакета">
      ${lbl(0, TOP, `ЗАКЛАДИ · ${uaNum(s.n)}`, "dr-axtitle", "start")}
      ${bar(yA, dy, xA, pctUk(s.corePct), pctUk(100 - s.corePct))}

      <path d="M0 ${yA + BAR} L${xA.toFixed(1)} ${yA + BAR} L${xB.toFixed(1)} ${yB} L0 ${yB} Z" class="dr-band-core"/>
      <path d="M${xA.toFixed(1)} ${yA + BAR} L${W} ${yA + BAR} L${W} ${yB} L${xB.toFixed(1)} ${yB} Z" class="dr-band-tail"/>

      ${bar(yB, dyB, xB, pctUk(s.coreMoneyPct), pctUk(100 - s.coreMoneyPct))}
      ${lbl(0, H - (compact ? 14 : 4), `ГРОШІ · ${escapeHtml(formatMoneyShort(s.total))}`, "dr-axtitle", "start")}
    </svg>`;
  }

  /** Крива концентрації: заклади від найбільшого до найменшого по осі X,
      накопичена частка бюджету по Y. Пунктирна діагональ — «якби порівну».
      Як і лійка, має вузький варіант: кегль підписів росте, а поля під них
      мусять рости разом, інакше підписи осі налазять на її назву. */
  function curveSvg(s) {
    const compact = isCompact();
    const W = 620, H = 400;
    // Ліве поле мусить умістити підпис «100 %» І повернуту назву осі:
    // на вузькому екрані кегль більший, тож і поле ширше
    const L = compact ? 106 : 56, R = compact ? 20 : 18;
    const T = compact ? 22 : 18, B = compact ? 84 : 50;
    const pw = W - L - R, ph = H - T - B;
    const px = (f) => L + f * pw;              // f — частка закладів 0..1
    const py = (f) => T + (1 - f) * ph;        // f — частка бюджету 0..1

    // Вибірка точок: до 200 вузлів, але завжди з кінцями і точкою ядра
    const n = s.n;
    const idx = new Set([0, n - 1, s.core - 1]);
    const step = Math.max(1, Math.floor(n / 200));
    for (let i = 0; i < n; i += step) idx.add(i);
    const pts = [...idx].sort((a, b) => a - b)
      .map((i) => [px((i + 1) / n), py(s.cum[i])]);

    const line = `M${px(0).toFixed(1)} ${py(0).toFixed(1)} ` +
      pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const area = `${line} L${px(1).toFixed(1)} ${py(0).toFixed(1)} Z`;

    const cx = px(s.core / n), cy = py(s.coreMoneyPct / 100);
    const grid = [0, 0.25, 0.5, 0.75, 1];
    const dl = { x: px(0.5), y: py(0.5) + (compact ? 30 : 24) };   // підпис діагоналі
    // У пакеті, де крива вистрілює майже в стелю з першого закладу, точка ядра
    // стоїть під верхнім краєм — тоді підпис іде під неї, а не за полотно
    const up = compact ? 18 : 15, down = compact ? 34 : 27;
    const dotLblY = (cy - up - (compact ? 20 : 13) >= T) ? cy - up : cy + down;

    return `
    <svg class="dr-curve${compact ? " compact" : ""}" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Крива концентрації: ${pctUk(s.corePct)} закладів дають ${pctUk(s.coreMoneyPct)} бюджету">
      <defs>
        <linearGradient id="drAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--core-c)" stop-opacity=".34"/>
          <stop offset="100%" stop-color="var(--core-c)" stop-opacity=".04"/>
        </linearGradient>
      </defs>
      ${grid.map((g) => `
        <line x1="${L}" y1="${py(g).toFixed(1)}" x2="${W - R}" y2="${py(g).toFixed(1)}" class="dr-grid"/>
        <text x="${L - 9}" y="${(py(g) + (compact ? 6 : 4)).toFixed(1)}" class="dr-tick" text-anchor="end">${g * 100} %</text>
        ${g === 0 ? "" : `<text x="${px(g).toFixed(1)}" y="${H - B + (compact ? 30 : 22)}" class="dr-tick" text-anchor="${g === 1 ? "end" : "middle"}">${g * 100} %</text>`}`).join("")}

      <line x1="${px(0)}" y1="${py(0)}" x2="${px(1)}" y2="${py(1)}" class="dr-equal"/>
      <text x="${dl.x.toFixed(1)}" y="${dl.y.toFixed(1)}" class="dr-equal-lbl" text-anchor="middle"
            transform="rotate(-31 ${dl.x.toFixed(1)} ${dl.y.toFixed(1)})">якби гроші ділилися порівну</text>

      <path d="${area}" fill="url(#drAreaGrad)"/>
      <path d="${line}" class="dr-line"/>

      <line x1="${L}" y1="${cy.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${cy.toFixed(1)}" class="dr-mark"/>
      <line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${py(0)}" class="dr-mark"/>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${compact ? 9 : 6.5}" class="dr-dot"/>
      <text x="${((s.core / n > 0.55 ? cx - 14 : cx + 14)).toFixed(1)}" y="${dotLblY.toFixed(1)}"
            class="dr-dotlbl" text-anchor="${s.core / n > 0.55 ? "end" : "start"}">ядро · ${uaNum(s.core)} ${zozUk(s.core)}</text>

      <line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" class="dr-axis"/>
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="dr-axis"/>
      <text x="${L}" y="${H - (compact ? 12 : 8)}" class="dr-axname" text-anchor="start">заклади — від найбільшого до найменшого →</text>
      <text x="0" y="0" class="dr-axname" transform="translate(${compact ? 22 : 15} ${T + ph / 2}) rotate(-90)" text-anchor="middle">накопичена частка бюджету</text>
    </svg>`;
  }

  /* Розсіювання «щільність мережі × навантаження на заклад».

     Обидві шкали логарифмічні — і не заради краси: показники областей
     розтягнуті на порядки, а головне — у логарифмі лінія однакової
     інтенсивності (load × dens = const) стає ПРЯМОЮ з нахилом −1. Тобто
     «однакова інтенсивність за різної будови» видно оком, без обчислень. */
  function scatterSvg(sp, nLoad, nDens) {
    const compact = isCompact();
    const W = 660, H = compact ? 500 : 440;
    const L = compact ? 92 : 74, R = 18;
    const T = compact ? 30 : 22, B = compact ? 80 : 58;
    const pw = W - L - R, ph = H - T - B;

    const xs = sp.rows.map(r => r.dens), ys = sp.rows.map(r => r.load);
    const pad = (lo, hi) => {
      const a = Math.log10(Math.max(lo, 1e-6)), b = Math.log10(Math.max(hi, 1e-6));
      const m = Math.max((b - a) * 0.12, 0.12);
      return [a - m, b + m];
    };
    const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
    const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
    const px = (v) => L + (Math.log10(v) - x0) / (x1 - x0) * pw;
    const py = (v) => T + (1 - (Math.log10(v) - y0) / (y1 - y0)) * ph;

    // Мітки шкали виду 1-2-5 × 10^k: на вузькому діапазоні самі десятки
    // дали б одну поділку на всю вісь
    const ticks = (a, b) => {
      const out = [];
      for (let k = Math.floor(a) - 1; k <= Math.ceil(b) + 1; k++) {
        [1, 2, 5].forEach(m => {
          const v = m * Math.pow(10, k);
          if (Math.log10(v) >= a && Math.log10(v) <= b) out.push(v);
        });
      }
      return out.length > 1 ? out : [Math.pow(10, (a + b) / 2)];
    };

    // Лінія однакової інтенсивності: load = C / dens, у логарифмі — пряма.
    // Обрізаємо її по видимій частині полотна, інакше вона (і підпис на ній)
    // вилазить за осі там, де діапазони не збігаються
    const isoSeg = (C) => {
      const lc = Math.log10(C);
      const a = Math.max(x0, lc - y1), b = Math.min(x1, lc - y0);
      if (!(b > a)) return null;
      const pt = (ld) => [L + (ld - x0) / (x1 - x0) * pw, T + (1 - (lc - ld - y0) / (y1 - y0)) * ph];
      return { a, b, p1: pt(a), p2: pt(b), at: (t) => pt(a + (b - a) * t) };
    };
    const iso = isoSeg(sp.rate);

    const nets = sp.rows.map(r => r.n);
    const maxN = Math.max(...nets);
    const rOf = (n) => (compact ? 6 : 4.5) + Math.sqrt(n / maxN) * (compact ? 13 : 10);

    // Підписуємо лише крайні випадки — 25 підписів злиплися б у кашу
    const byRate = sp.rows.slice().sort((a, b) => a.rate - b.rate);
    const byLoad = sp.rows.slice().sort((a, b) => a.load - b.load);
    const byDens = sp.rows.slice().sort((a, b) => a.dens - b.dens);
    // На вузькому екрані кегль підписів удвічі більший, тож пʼять назв на
    // те саме полотно вже не влазять — лишаємо три найпоказовіші
    const marked = new Set((compact
      ? [byRate[0].o, byRate[byRate.length - 1].o, byLoad[0].o]
      : [byRate[0].o, byRate[byRate.length - 1].o, byLoad[0].o,
         byLoad[byLoad.length - 1].o, byDens[0].o]).filter(Boolean));

    // Розкладаємо підписи так, щоб не налазили один на одного: ширину
    // доводиться оцінювати наперед (getBBox тут ще немає), тому беремо
    // консервативні пів-кегля на символ і зсуваємо вниз, поки є перетин
    const FS = compact ? 20 : 11;
    const TFS = compact ? 20 : 11;          // кегль підписів шкали
    // Підписи шкали резервуємо ПЕРШИМИ: інакше назва області сідала на поділку
    const placed = [];
    ticks(x0, x1).forEach(v => {
      const w = String(nDens(v)).length * TFS * 0.68;
      placed.push({ x: px(v) - w / 2, y: T + ph + (compact ? 28 : 20) - TFS, w, h: TFS + 5 });
    });
    ticks(y0, y1).forEach(v => {
      const w = String(nLoad(v)).length * TFS * 0.68;
      placed.push({ x: L - 9 - w, y: py(v) - TFS + 2, w, h: TFS + 5 });
    });
    const fit = (x, y, w) => {
      let yy = y, step = 0;
      const hit = (a) => placed.some(b =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
      const mk = (v) => ({ x: x - 2, y: v - FS, w: w + 4, h: FS + 5 });
      let box = mk(yy);
      // Крок мусить бути БІЛЬШИЙ за висоту коробки (FS + 5): інакше два
      // підписи, розведені на один крок, лишалися б накладеними на пікселі
      while (hit(box) && step < 14) { step++; yy += FS + 7; box = mk(yy); }
      placed.push(box);
      return yy;
    };

    const pts = sp.rows.map(r => {
      const x = px(r.dens), y = py(r.load), rad = rOf(r.n);
      const hot = r.rate >= sp.rate;
      let lbl = "";
      if (marked.has(r.o)) {
        const name = oblastDisplay(r.o);
        const w = name.length * FS * 0.68;   // оцінка з запасом: getBBox тут ще немає
        // Бік вибираємо за тим, чи ВЛІЗЕ підпис, а не за часткою полотна:
        // «Дніпропетровська» праворуч від точки виїжджала за край
        const right = (x + rad + 5 + w) > (L + pw);
        // Коробка резервування мусить збігатися з тим, де текст справді ляже:
        // клампінг однієї і не другої розводив їх і давав хибний «вільно»
        const lx = right ? x - rad - 5 - w : x + rad + 5;
        const ly = fit(lx, y + 4, w);
        lbl = `<text x="${(right ? x - rad - 5 : x + rad + 5).toFixed(1)}" y="${ly.toFixed(1)}"
                 class="sc-lbl" text-anchor="${right ? "end" : "start"}">${escapeHtml(name)}</text>`;
      }
      return `<g class="sc-pt${hot ? " hot" : ""}">
        <title>${escapeHtml(`${oblastDisplay(r.o)} — інтенсивність ${nLoad(r.rate)} = ${nLoad(r.load)} на заклад × ${nDens(r.dens)} закладу на 10 тис. (${r.n} ЗОЗ)`)}</title>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}"/>${lbl}</g>`;
    }).join("");

    const mx = px(sp.medDens), my = py(sp.medLoad);
    return `
    <svg class="dr-scatter${compact ? " compact" : ""}" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Області: щільність мережі проти навантаження на заклад">
      ${ticks(x0, x1).map(v => `
        <line x1="${px(v).toFixed(1)}" y1="${T}" x2="${px(v).toFixed(1)}" y2="${T + ph}" class="dr-grid"/>
        <text x="${px(v).toFixed(1)}" y="${T + ph + (compact ? 28 : 20)}" class="dr-tick" text-anchor="middle">${escapeHtml(nDens(v))}</text>`).join("")}
      ${ticks(y0, y1).map(v => `
        <line x1="${L}" y1="${py(v).toFixed(1)}" x2="${L + pw}" y2="${py(v).toFixed(1)}" class="dr-grid"/>
        <text x="${L - 9}" y="${(py(v) + (compact ? 6 : 4)).toFixed(1)}" class="dr-tick" text-anchor="end">${escapeHtml(nLoad(v))}</text>`).join("")}

      <line x1="${mx.toFixed(1)}" y1="${T}" x2="${mx.toFixed(1)}" y2="${T + ph}" class="sc-med"/>
      <line x1="${L}" y1="${my.toFixed(1)}" x2="${L + pw}" y2="${my.toFixed(1)}" class="sc-med"/>

      ${iso ? `<path d="M${iso.p1[0].toFixed(1)} ${iso.p1[1].toFixed(1)} L${iso.p2[0].toFixed(1)} ${iso.p2[1].toFixed(1)}" class="sc-iso"/>` : ""}
      ${iso ? (() => {
        // Підпис їде вздовж лінії: біля її кінця він неминуче накривав точку
        const [lx, ly] = iso.at(0.26);
        const ang = Math.atan2(iso.p2[1] - iso.p1[1], iso.p2[0] - iso.p1[0]) * 180 / Math.PI;
        return `<text x="${lx.toFixed(1)}" y="${(ly - 7).toFixed(1)}" class="sc-iso-lbl" text-anchor="start"
                  transform="rotate(${ang.toFixed(1)} ${lx.toFixed(1)} ${(ly - 7).toFixed(1)})">рівень країни · ${escapeHtml(nLoad(sp.rate))}</text>`;
      })() : ""}

      ${pts}

      <line x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}" class="dr-axis"/>
      <line x1="${L}" y1="${T + ph}" x2="${L + pw}" y2="${T + ph}" class="dr-axis"/>
      <text x="${L}" y="${H - (compact ? 12 : 8)}" class="dr-axname" text-anchor="start">закладів на 10 тис. цільової групи →</text>
      <text x="0" y="0" class="dr-axname" transform="translate(${compact ? 22 : 15} ${T + ph / 2}) rotate(-90)" text-anchor="middle">послуг на один заклад</text>
    </svg>`;
  }

  /** Висновки з розкладу — з числами саме цього пакета. */
  function intensMeaning(sp, verdict, nLoad, nDens) {
    const items = [];
    const tag = (k) => sp.rows.filter(r => verdict(r).k === k);
    const net = tag("net"), work = tag("work"), bad = tag("bad");
    const nameList = (a) => a.slice(0, 5).map(r => oblastDisplay(r.o)).join(", ") + (a.length > 5 ? ` та ще ${a.length - 5}` : "");

    if (net.length) {
      items.push(["🏥", `Мало закладів — ${uaPlural(net.length, "регіон", "регіони", "регіонів")}`,
        `${nameList(net)}. Наявні заклади працюють не менше за середні по країні, але їх просто мало на цільову групу. ` +
        `Це питання контрактування й доступності, а не роботи надавачів.`]);
    }
    if (work.length) {
      items.push(["🪫", `Мало роботи в наявних — ${uaPlural(work.length, "регіон", "регіони", "регіонів")}`,
        `${nameList(work)}. Мережа тут не рідша за медіанну, а послуг мало. Дивитися треба не на кількість договорів, ` +
        `а на маршрут пацієнта, направлення й реальну потребу.`]);
    }
    if (bad.length) {
      items.push(["🚩", `І закладів, і роботи мало — ${uaPlural(bad.length, "регіон", "регіони", "регіонів")}`,
        `${nameList(bad)}. Тут обидві складові нижче медіани одночасно — найгірший для пацієнта варіант.`]);
    }

    const byLoad = sp.rows.slice().sort((a, b) => a.load - b.load);
    const lo = byLoad[0], hi = byLoad[byLoad.length - 1];
    if (lo && hi && lo.load > 0) {
      items.push(["📏", "Розрив у завантаженні",
        `Від ${nLoad(lo.load)} послуг на заклад (${oblastDisplay(lo.o)}) до ${nLoad(hi.load)} (${oblastDisplay(hi.o)}) — ` +
        `різниця ${timesUk(hi.load / lo.load)}. Це різниця в роботі однакових за вимогами закладів, а не в населенні: ` +
        `населення вже поділене.`]);
    }
    const perMonth = sp.load / Math.max(1, sp.months);
    if (perMonth < 25 && sp.net >= 100) {
      items.push(["🧮", "Мережа проти навантаження",
        // Дробове число тягне родовий однини: «6,6 послуги», а не «6,6 послуг»
        `У середньому заклад робить ${nLoad(perMonth)} ${String(nLoad(perMonth)).includes(",") ? "послуги" : plural(perMonth, "послугу", "послуги", "послуг")} на місяць — ` +
        `при тому, що всі ${uaPlural(sp.net, "заклад", "заклади", "закладів")} мережі тримають обладнання й кадри під вимоги пакета. ` +
        `Це привід перевірити, чи виправдана така широка мережа.`]);
    }
    return items.map(([ic, h, t]) => `
      <div class="dr-mean"><span class="dr-mean-i">${ic}</span>
        <div><strong>${escapeHtml(h)}</strong><p>${escapeHtml(t)}</p></div></div>`).join("");
  }

  /* ═══════ блоки сторінки ═══════ */

  function verdictOf(s) {
    if (s.tiny) return {
      icon: "🔬", key: "tiny",
      title: `Мережа пакета — ${uaNum(s.n)} ${zozUk(s.n)}`,
      desc: "На такій мережі частки нічого не пояснюють: тут важать не відсотки, а конкретні заклади — вони перелічені нижче поіменно.",
    };
    if (s.flat) return {
      icon: "⚖️", key: "flat",
      title: "Гроші поділені майже порівну",
      desc: `У пакеті всього ${uaNum(s.uniqSums)} ${plural(s.uniqSums, "різна сума", "різні суми", "різних сум")} договору на ${uaNum(s.n)} ${zozUk(s.n)}: розмір визначає норматив, а не заклад.`,
    };
    if (s.corePct < 25) return {
      icon: "🎯", key: "tight",
      title: "Гроші зібрані у вузькому колі закладів",
      desc: "Пакет тримається на кількох центрах: рішення щодо них рухає бюджет пакета, рішення щодо решти мережі — майже ні.",
    };
    if (s.corePct < 40) return {
      icon: "🔻", key: "dense",
      title: "Гроші зібрані у меншості мережі",
      desc: "Чверть-третина закладів робить 4/5 роботи в грошах. Типова форма для пакета, де поруч працюють великі й малі надавачі.",
    };
    if (s.corePct < 55) return {
      icon: "📊", key: "even",
      title: "Гроші розподілені досить рівномірно",
      desc: "Ядро близьке до половини мережі: явних центрів, на які можна впливати точково, у пакеті немає.",
    };
    return {
      icon: "🫧", key: "spread",
      title: "Гроші розмиті по всій мережі",
      desc: "Щоб зачепити 4/5 бюджету, треба зачепити більшість закладів: великих гравців, які тягнуть пакет, у ньому немає.",
    };
  }

  /* Плитка «стільки-то мережі — стільки-то бюджету». На великій мережі
     підпис відсотковий («топ-10 %»), на малій він брехав би: 10 % від трьох
     закладів — це один, тобто третина. Там підписуємо фактичну кількість. */
  function quantTile(s, q, bigLabel) {
    const label = s.n >= 20
      ? bigLabel
      : (q.k === 1 ? "Найбільший заклад" : `Найбільші ${uaNum(q.k)} із ${uaNum(s.n)}`);
    const sub = s.n >= 20
      ? `${uaNum(q.k)} ${najb(q.k)} ${zozUk(q.k)} — стільки бюджету`
      : `${formatMoneyShort(q.pct / 100 * s.total)} із ${formatMoneyShort(s.total)}`;
    return statCard(label, pctUk(q.pct), sub);
  }

  function statCard(label, value, sub, tip) {
    return `
      <div class="dr-stat"${tip ? ` title="${escapeHtml(tip)}"` : ""}>
        <div class="dr-stat-l">${escapeHtml(label)}</div>
        <div class="dr-stat-v">${value}</div>
        <div class="dr-stat-s">${escapeHtml(sub)}</div>
      </div>`;
  }

  /** Лінійка «де цей пакет серед решти за щільністю ядра». */
  function rulerHtml(s) {
    const list = coreBench();
    if (list.length < 4) return "";
    const lo = list[0], hi = list[list.length - 1];
    const min = Math.min(lo.pct, 15), max = Math.max(hi.pct, 85);
    const at = (p) => ((p - min) / (max - min)) * 100;
    const rank = 1 + list.filter((r) => r.pct < s.corePct).length;
    const dots = list.map((r) => `<span class="dr-dotmark${r.num === s.pkgNum ? " me" : ""}"
        style="left:${at(r.pct).toFixed(2)}%"
        title="Пакет ${escapeHtml(r.num)} — ядро ${pctUk(r.pct)} мережі (${uaNum(r.k)} з ${uaNum(r.n)})"></span>`).join("");
    return `
      <div class="dr-ruler-head"><strong>Місце ${rank} із ${list.length}</strong> за щільністю ядра
        серед пакетів ПМГ, за якими у вивантажці є суми</div>
      <div class="dr-ruler">
        <div class="dr-ruler-line"></div>
        ${dots}
        <span class="dr-ruler-me" style="left:${at(s.corePct).toFixed(2)}%"></span>
      </div>
      <div class="dr-ruler-ends">
        <span>← щільніше · пакет ${escapeHtml(lo.num)} (${pctUk(lo.pct)})</span>
        <span>рівномірніше · пакет ${escapeHtml(hi.num)} (${pctUk(hi.pct)}) →</span>
      </div>`;
  }

  function regionsHtml(s) {
    const rows = [...s.oblCore.entries()].sort((a, b) => b[1].sum - a[1].sum);
    const maxSum = rows.length ? rows[0][1].sum : 1;
    const list = rows.map(([o, r]) => `
      <button type="button" class="dr-reg" data-obl="${escapeHtml(o)}"
              title="Показати заклади цього регіону в переліку ЗОЗ">
        <span class="dr-reg-name">${escapeHtml(oblastDisplay(o))}</span>
        <span class="dr-reg-bar"><i style="width:${(r.sum / maxSum * 100).toFixed(1)}%"></i></span>
        <span class="dr-reg-val">${escapeHtml(formatMoneyShort(r.sum))}
          <small>${uaNum(r.n)} ${zozUk(r.n)} · ${pctUk(r.sum / s.total * 100)} бюджету</small></span>
      </button>`).join("");

    const gap = s.oblNoCore.length
      ? `<p class="dr-note warn">У ${uaNum(s.oblNoCore.length)} ${plural(s.oblNoCore.length, "регіоні", "регіонах", "регіонах")} немає жодного закладу ядра —
         ${s.oblNoCore.map((o) => escapeHtml(oblastDisplay(o))).join(", ")}. Заклади там працюють, але всі вони в хвості:
         на ці території припадає частина останньої п'ятої бюджету.</p>`
      : (s.oblAll.size === 1
          ? `<p class="dr-note ok">Пакет законтрактовано лише в одному регіоні, і ядро в ньому є.</p>`
          : `<p class="dr-note ok">Ядро представлене в усіх ${uaNum(s.oblAll.size)} ${regUk(s.oblAll.size)}, де пакет законтрактовано — географічних провалів у ньому немає.</p>`);

    return `<div class="dr-regs">${list}</div>${gap}`;
  }

  function compareHtml(s) {
    const share = (m, tot) => [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => {
        const p = v / tot * 100;
        return `<span class="dr-chip"><b>${uaNum(v)}</b> ${escapeHtml(k === "Не входить в спроможну мережу" ? "поза спроможною" : k)}
          <i>${p < 0.5 ? "&lt;1" : Math.round(p)} %</i></span>`;
      }).join("");
    const row = (label, a, b) => `<tr><th>${escapeHtml(label)}</th><td>${a}</td><td>${b}</td></tr>`;
    const nT = s.tailRows.length;
    const oblTail = new Set(s.tailRows.map((r) => r.c.oblast).filter(Boolean)).size;
    return `
      <table class="dr-cmp">
        <thead><tr><th></th>
          <th class="core">🎯 Ядро<small>${uaNum(s.core)} ${zozUk(s.core)}</small></th>
          <th class="tail">Хвіст<small>${uaNum(nT)} ${zozUk(nT)}</small></th></tr></thead>
        <tbody>
          ${row("Гроші пакета",
            `<b>${escapeHtml(formatMoneyShort(s.coreSum))}</b><small>${pctUk(s.coreMoneyPct)}</small>`,
            `<b>${escapeHtml(formatMoneyShort(s.total - s.coreSum))}</b><small>${pctUk(100 - s.coreMoneyPct)}</small>`)}
          ${row("Медіанний договір",
            `<b>${escapeHtml(formatMoneyShort(s.medCore))}</b>`,
            `<b>${escapeHtml(formatMoneyShort(s.medTail))}</b><small>${s.medTail ? escapeHtml(timesUk(s.medCore / s.medTail)) + " менше" : "—"}</small>`)}
          ${row("Межа між групами",
            `<b class="sm">${escapeHtml(moneyExact(s.minCore))}</b><small>найменший договір у ядрі</small>`,
            `<b class="sm">${nT ? escapeHtml(moneyExact(s.maxTail)) : "—"}</b><small>найбільший договір у хвості</small>`)}
          ${row("Форма власності", share(s.ownCore, s.core), nT ? share(s.ownTail, nT) : "—")}
          ${row("Спроможна мережа", share(s.netCore, s.core), nT ? share(s.netTail, nT) : "—")}
          ${row("Регіонів",
            `<b>${uaNum(s.oblCore.size)}</b><small>з ${uaNum(s.oblAll.size)} у мережі</small>`,
            `<b>${uaNum(oblTail)}</b><small>з ${uaNum(s.oblAll.size)} у мережі</small>`)}
        </tbody>
      </table>`;
  }

  const LIST_STEP = 20;

  function listHtml(s, limit) {
    const shown = s.coreRows.slice(0, limit);
    let acc = 0;
    const rows = shown.map((r, i) => {
      acc += r.sum;
      return `<tr>
        <td class="dr-rk">${i + 1}</td>
        <td class="dr-nm"><span title="${escapeHtml(r.c.provider_name_full || r.c.provider_name)}">${escapeHtml(r.c.provider_name)}</span>
          <small>📍 ${escapeHtml(r.c.settlement || "—")} · ${escapeHtml(oblastDisplay(r.c.oblast || "—"))}</small></td>
        <td class="dr-sm" title="${escapeHtml(formatCurrency(r.sum))}">${escapeHtml(formatMoneyShort(r.sum))}</td>
        <td class="dr-sh">${pctUk(r.sum / s.total * 100)}</td>
        <td class="dr-cu">${pctUk(acc / s.total * 100)}</td>
      </tr>`;
    }).join("");
    const rest = s.core - shown.length;
    return `
      <div class="dr-list-scroll"><table class="dr-list">
        <thead><tr><th>#</th><th>Заклад</th><th>Договір</th><th>Частка</th><th>Разом</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${rest > 0
        ? `<button type="button" class="dr-more" data-more="1">Показати ще ${uaNum(Math.min(rest, LIST_STEP * 4))} із ${uaNum(rest)}</button>`
        : (s.core > LIST_STEP ? `<button type="button" class="dr-more" data-more="0">Згорнути до ${LIST_STEP}</button>` : "")}`;
  }

  /** Висновки — прив'язані до чисел цього пакета, а не загальні слова. */
  function meaningHtml(s, v) {
    const items = [];
    const tailShare = 100 - s.coreMoneyPct;
    const nT = s.tailRows.length;

    if (v.key === "tiny") {
      items.push(["🔬", "Пакет вирішується поіменно",
        `У мережі ${uaNum(s.n)} ${zozUk(s.n)} із сумами, найбільший договір — ${formatMoneyShort(s.paid[0].sum)}, найменший — ${formatMoneyShort(s.paid[s.n - 1].sum)}. Будь-яка зміна умов тут стосується конкретних закладів, а не «частки мережі»: дивитися треба на перелік, а не на відсотки.`]);
    } else if (v.key === "flat") {
      items.push(["⚖️", "Важіль тут — норматив, а не окремий заклад",
        `Договори однакові за розміром (${uaNum(s.uniqSums)} ${plural(s.uniqSums, "різна сума", "різні суми", "різних сум")} на ${uaNum(s.n)} ${zozUk(s.n)}), тож бюджет пакета міняється кількістю закладів у мережі й ставкою, а не рішенням щодо конкретного надавача.`]);
    } else if (s.corePct < 40) {
      items.push(["🎚️", "Бюджет пакета вирішує меншість мережі",
        `Зміна тарифу, коефіцієнта чи умов закупівлі, що зачіпає ${uaNum(s.core)} ${zozUk(s.core)} ядра, рухає ${pctUk(s.coreMoneyPct)} грошей пакета. Те саме рішення щодо решти ${uaNum(nT)} ${zozUk(nT)} зачепить лише ${pctUk(tailShare)}.`]);
      items.push(["🔍", "Нагляд за грошима пакета реалістичний",
        `Щоб охопити 4/5 коштів, треба дивитися на ${uaNum(s.core)} ${zozUk(s.core)} — це ${pctUk(s.corePct)} мережі. Суцільна перевірка всіх ${uaNum(s.n)} для цього не потрібна.`]);
    } else {
      items.push(["🎚️", "Точки впливу в пакеті немає",
        `Щоб зачепити 4/5 бюджету, рішення має накрити ${uaNum(s.core)} ${zozUk(s.core)} — ${pctUk(s.corePct)} мережі. Окремі умови для «великих центрів» тут майже нічого не змінюють.`]);
      items.push(["🔍", "Нагляд коштує дорого",
        `Вибіркова перевірка найбільших покриє мало: топ-10 % мережі — це лише ${pctUk(s.q10.pct)} грошей пакета.`]);
    }

    if (!s.tiny && s.medTail > 0 && s.medCore / s.medTail >= 2) {
      items.push(["🪶", "Хвіст живе в іншому масштабі",
        `Медіанний договір у хвості — ${formatMoneyShort(s.medTail)} проти ${formatMoneyShort(s.medCore)} у ядрі (${timesUk(s.medCore / s.medTail)} менше). Для цих закладів пакет не є основним навантаженням, але умови закупівлі до них застосовуються ті самі, що й до найбільших.`]);
    }

    if (s.oblNoCore.length) {
      items.push(["🗺️", "Регіони без жодного закладу ядра",
        `${s.oblNoCore.map((o) => oblastDisplay(o)).join(", ")} — ${uaNum(s.oblNoCore.length)} ${plural(s.oblNoCore.length, "регіон", "регіони", "регіонів")}, де весь пакет тримається на закладах хвоста. Це питання не бюджету, а маршруту пацієнта: великих обсягів за пакетом там не виконує ніхто.`]);
    } else {
      const top3 = [...s.oblCore.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 3);
      const t3 = top3.reduce((a, [, r]) => a + r.sum, 0) / s.total * 100;
      items.push(["🗺️", s.oblCore.size === 1 ? "Пакет живе в одному регіоні" : "Ядро є в кожному регіоні мережі",
        s.oblCore.size === 1
          ? `Увесь пакет законтрактовано в одному регіоні — ${oblastDisplay([...s.oblCore.keys()][0])}. Для пацієнтів з інших областей це означає поїздку.`
          : `Заклади ядра є в усіх ${uaNum(s.oblCore.size)} ${regUk(s.oblCore.size)}, де пакет законтрактовано. Найбільші частки — ${top3.map(([o, r]) => `${oblastDisplay(o)} (${pctUk(r.sum / s.total * 100)})`).join(", ")}: разом ${pctUk(t3)} бюджету пакета.`]);
    }

    const commCore = (s.ownCore.get("Комунальна") || 0) / s.core * 100;
    const commTail = nT ? (s.ownTail.get("Комунальна") || 0) / nT * 100 : 0;
    if (s.n >= 20 && nT >= 5 && Math.abs(commCore - commTail) >= 15) {
      items.push(["🏛️", commCore > commTail ? "Ядро комунальне, хвіст — ні" : "Ядро не комунальне",
        `Серед закладів ядра комунальних ${pctUk(commCore)}, серед хвоста — ${pctUk(commTail)}. Це різні за природою групи надавачів, і однакові вимоги діють на них по-різному.`]);
    }

    return items.map(([ic, h, t]) => `
      <div class="dr-mean">
        <span class="dr-mean-i">${ic}</span>
        <div><strong>${escapeHtml(h)}</strong><p>${escapeHtml(t)}</p></div>
      </div>`).join("");
  }

  function limitsHtml(s) {
    const d = passportState.contractsData || {};
    const items = [
      `Це <b>законтрактовані суми</b> з вивантажки договорів${d.sums_date ? ` станом на ${escapeHtml(d.sums_date)}` : ""}, а не фактично оплачене за пакетом.`,
      `Договір, укладений або розірваний посеред року, сидить у числах повністю: строків дії <b>окремого пакета</b> вивантажка не передає.`,
      `Розмір договору — це обсяг, а не якість і не ефективність. Заклад у ядрі не «кращий» за заклад у хвості.`,
      `Ядро рахується <b>всередині цього пакета</b>. Той самий заклад може бути дрібним тут і найбільшим в іншому.`,
    ];
    if (s.noSum) {
      items.push(`${uaNum(s.noSum)} ${zozUk(s.noSum)} мережі не мають суми у вивантажці й у розрахунок не входять: усі частки рахуються від ${uaNum(s.n)}.`);
    }
    if (s.coreMoneyPct >= 81.5) {
      items.push(`Ядро набирає ${pctUk(s.coreMoneyPct)}, а не рівно 80 %: рахунок зупиняється на закладі, який перетнув межу, а договори тут великі — останній крок «перестрибує» 4/5.`);
    }
    return `<ul class="dr-limits">${items.map((t) => `<li>${t}</li>`).join("")}</ul>`;
  }

  /* ═══════ реєстр показників ═══════ */

  const DRILLS = {
    intensity: {
      icon: "📈",
      title: "Інтенсивність: мережа чи завантаження",
      build(pkg) {
        const sp = intensityBreakdown(pkg.number);
        if (!sp || sp.rows.length < 3) return null;
        const f = window.Volumes.fmt;
        const nLoad = (v) => (v < 10 ? f.dec(v, 1) : f.num(Math.round(v)));
        const nDens = (v) => f.dec(v, v < 1 ? 3 : 2);

        // Вердикт області: та сама низька інтенсивність буває з двох різних
        // причин, і саме їх ми тут розділяємо
        // Поріг із запасом: без нього область із навантаженням на 9 % нижче
        // медіани отримувала б вирок «роботи мало», хоч це шум, а не сигнал
        const MARGIN = 0.8;
        const verdict = (r) => {
          if (r.rate >= sp.rate) return { k: "ok", t: "вище за країну" };
          const few = r.dens < sp.medDens * MARGIN;
          const low = r.load < sp.medLoad * MARGIN;
          if (few && low) return { k: "bad", t: "і закладів, і роботи мало" };
          if (few) return { k: "net", t: "мало закладів" };
          if (low) return { k: "work", t: "мало роботи в наявних" };
          return { k: "ok", t: "трохи нижче за країну" };
        };

        return { state: null, html: `
        <section class="dr-lede in-lede">
          <div class="dr-lede-main">
            <p class="dr-lede-q">Інтенсивність — це добуток двох різних речей</p>
            <p class="dr-lede-a in-formula">
              <b>${escapeHtml(nLoad(sp.rate))}</b> <small>на 10 тис.</small>
              <span class="in-eq">=</span>
              <b>${escapeHtml(nLoad(sp.load))}</b> <small>на заклад</small>
              <span class="in-eq">×</span>
              <b>${escapeHtml(nDens(sp.dens))}</b> <small>закладу на 10 тис.</small>
            </p>
            <p class="dr-lede-b">${escapeHtml(f.num(sp.s))} послуг за ${sp.months} міс. у
              ${escapeHtml(uaPlural(sp.net, "закладі", "закладах", "закладах"))};
              цільова група — ${escapeHtml(sp.target)}, ${escapeHtml(f.shortNum(sp.den))} осіб.
              Пакет на ${sp.rank}-му місці з ${sp.total} за інтенсивністю.</p>
          </div>
          <div class="dr-lede-badge">
            <span class="dlb-i">🔀</span>
            <b>Навіщо розкладати</b>
            <i>«Тут мало послуг» означає дві протилежні речі: закладів мало — або кожен наявний
              робить мало. Перше — питання контрактування, друге — завантаження й маршруту пацієнта.
              Сама інтенсивність їх не розрізняє.</i>
          </div>
        </section>

        <section class="dr-card dr-card-hero">
          <h3>Області: мережа проти завантаження</h3>
          <p class="dr-hint">Обидві шкали логарифмічні. Пунктирна діагональ — рівень країни: усі точки на ній
            мають однакову інтенсивність за різної будови. Сірі лінії — медіани по областях.</p>
          ${scatterSvg(sp, nLoad, nDens)}
          <div class="dr-legend">
            <span><i class="core"></i>вище за рівень країни</span>
            <span><i class="tail"></i>нижче</span>
            <span>розмір точки — скільки закладів</span>
          </div>
          <p class="dr-hint sc-read">Ліворуч-угорі — <b>закладів мало, кожен завантажений</b>;
            праворуч-унизу — <b>закладів багато, роботи мало</b>. Обидва кути дають однаково низьку
            інтенсивність, але вимагають протилежних рішень.</p>
        </section>

        <section class="dr-card">
          <h3>Поіменно по областях</h3>
          <p class="dr-hint">Спершу ті, де інтенсивність найнижча. Клік по рядку відфільтрує перелік ЗОЗ.</p>
          <div class="dr-cmp-scroll"><table class="dr-list in-tab">
            <thead><tr><th>Область</th><th>Інтенсивність</th><th>На заклад</th><th>Закладів<br><small>на 10 тис.</small></th><th>ЗОЗ</th><th>Причина</th></tr></thead>
            <tbody>
              ${sp.rows.slice().sort((a, b) => a.rate - b.rate).map((r) => {
                const v = verdict(r);
                return `<tr data-obl="${escapeHtml(r.o)}">
                  <td class="dr-nm"><span>${escapeHtml(oblastDisplay(r.o))}</span></td>
                  <td class="dr-sm">${escapeHtml(nLoad(r.rate))}</td>
                  <td class="dr-sm">${escapeHtml(nLoad(r.load))}</td>
                  <td class="dr-cu">${escapeHtml(nDens(r.dens))}</td>
                  <td class="dr-cu">${uaNum(r.n)}</td>
                  <td><span class="in-tag ${v.k}">${escapeHtml(v.t)}</span></td>
                </tr>`;
              }).join("")}
            </tbody>
          </table></div>
        </section>

        <section class="dr-card dr-card-mean">
          <h3>Що з цього випливає</h3>
          ${intensMeaning(sp, verdict, nLoad, nDens)}
        </section>

        <section class="dr-card dr-card-limits">
          <h3>Чого показник не каже</h3>
          <ul class="dr-limits">
            <li>Навантаження на заклад <b>не можна порівнювати між різними пакетами</b>: одиниця послуги в них різна — пакет 9 рахує кожен аналіз, пакет 3 — кожну операцію. Між областями одного пакета порівняння чесне.</li>
            <li>Знаменник — <b>активні декларації ПМД</b>, а не чисельність населення: офіційної чисельності немає. В областях з ненадійним знаменником інтенсивність спотворена, навантаження — ні.</li>
            <li>Область — це місце <b>надавача</b>, а не проживання пацієнта. У пакетах з кількома центрами на країну люди їдуть, і навантаження «чужої» області вбирає їхні випадки.</li>
            <li>Низьке навантаження саме по собі не вирок: воно може означати і зайву мережу, і слабку потребу, і те, що пацієнти не доходять. Показник ставить питання, а не відповідає на нього.</li>
          </ul>
        </section>`,
        };
      },
    },
    anatomy: {
      icon: "🧬",
      title: "Анатомія пакета",
      build(pkg) {
        const A = passportState.anatomy && passportState.anatomy.pkgs[pkg.number];
        if (!A) return null;
        const service = A.buys === "послуга";
        const width = service ? anatWidth(A) : { band: null, note: "" };
        const team = anatTeam(A);
        const gate = anatGate(A, anatBench());
        const role = anatRole(pkg.number);
        const buys = ANAT_BUYS[A.buys] || ANAT_BUYS["послуга"];

        // Черга пакетів за кожною віссю — щоб «дуже високий поріг» мав із чим
        // порівнюватися, а не висів прикметником у повітрі
        const all = passportState.anatomy.pkgs;
        const nums = Object.keys(all);
        const gateOf = (x) => x.eq + x.org + x.kadr;
        const rankBy = (f, v) => 1 + nums.filter((k) => f(all[k]) > v).length;
        const gRank = rankBy(gateOf, gateOf(A));
        const tRank = rankBy((x) => x.posts, A.posts);
        const topBy = (f) => nums.slice().sort((a, b) => f(all[b]) - f(all[a]))[0];
        const gTop = topBy(gateOf), tTop = topBy((x) => x.posts);

        const axis = (icon, name, steps, res, question, how, extra) => {
          const off = !res || res.band === null;
          return `
          <section class="dr-card da-axis">
            <div class="da-head">
              <span class="da-icon">${icon}</span>
              <div>
                <h3>${escapeHtml(name)}</h3>
                <p class="da-q">${escapeHtml(question)}</p>
              </div>
              <span class="da-val${off ? " off" : ""}">${escapeHtml(off ? "не міряється" : steps[res.band])}</span>
            </div>
            <div class="da-steps">
              ${steps.map((t, i) => `<span class="${!off && i === res.band ? "now" : ""}${!off && i < res.band ? " past" : ""}">${escapeHtml(t)}</span>`).join("")}
            </div>
            <p class="da-note">${escapeHtml(res ? res.note : "")}</p>
            <p class="da-how"><b>Як рахується.</b> ${how}</p>
            ${extra || ""}
          </section>`;
        };

        return {
          state: null,
          html: `
        <section class="dr-lede da-lede">
          <div class="dr-lede-main">
            <p class="dr-lede-q">Що це за пакет за будовою</p>
            <p class="dr-lede-a">${escapeHtml([
              service ? (width.band === null ? "" : ANAT_WIDTH[width.band]) : "",
              ANAT_TEAM[team.band],
              `поріг входу ${ANAT_GATE[gate.band]}`,
              role ? ANAT_ROLE[role.band] : "",
            ].filter(Boolean).join(" · "))}</p>
            <p class="dr-lede-b">Термометр на вкладці міряє <b>масштаб</b> — скільки роботи пакет робить по країні.
              Тут інша величина: <b>як ця робота влаштована</b>. Одне з іншого не випливає: пакет може бути
              прохолодним за масштабом і найважчим у ПМГ на вході.</p>
          </div>
          <div class="dr-lede-badge">
            <span class="dlb-i">${buys.icon}</span>
            <b>Пакет купує: ${escapeHtml(A.buys)}</b>
            <i>${escapeHtml(buys.text)}${service ? "" : " Через це клінічна ширина для нього не рахується — див. нижче."}</i>
          </div>
        </section>

        ${axis("🧬", "Клінічна ширина", ANAT_WIDTH, width,
          "Скільки різних хвороб і напрямів лежить усередині пакета",
          "За таблицею співставлення: ОДК — великі діагностичні блоки, МКХ-10 — фактичний перелік діагнозів, з якими пакет працює. " +
          "Кадри сюди <b>не входять</b> навмисно: паліативна допомога потребує 47 різних посад при 36 діагнозах, і за кадрами вона виглядала б багатопрофільною, якою не є.",
          service && A.icd != null ? `
          <div class="da-nums">
            <span><b>${A.odk ? uaNum(A.odk) : "—"}</b>${A.odk ? "ОДК" : "ОДК немає"}</span>
            <span><b>${uaNum(A.icd)}</b>${plural(A.icd, "діагноз", "діагнози", "діагнозів")} МКХ-10</span>
            <span><b>${uaNum(A.achi)}</b>${plural(A.achi, "інтервенція", "інтервенції", "інтервенцій")} ACHI</span>
            <span><b>${uaNum(A.codes)}</b>${plural(A.codes, "код", "коди", "кодів")} ЕСОЗ у фактичних обсягах</span>
          </div>` : `<p class="dr-note warn">${escapeHtml(width.note || "")}</p>`)}

        ${axis("👥", "Команда", ANAT_TEAM, team,
          "Скільки різних фахівців треба зібрати, щоб виконувати пакет",
          "Кадрові вимоги специфікації, зведені до <b>унікальних посад</b>: одна вимога часто тягне кілька посад через «та/або», і рядки вимог рахувати не можна. " +
          `Найбільша команда в ПМГ — пакет ${escapeHtml(tTop)} (${uaNum(all[tTop].posts)} посад); цей пакет на ${tRank}-му місці з ${nums.length}.`,
          `<div class="da-nums">
            <span><b>${uaNum(A.posts)}</b>${plural(A.posts, "різна посада", "різні посади", "різних посад")}</span>
            <span><b>${uaNum(A.reqs)}</b>${plural(A.reqs, "кадрова вимога", "кадрові вимоги", "кадрових вимог")}</span>
            <span><b>${uaNum(A.crit)}</b>з них ${plural(A.crit, "критична", "критичні", "критичних")}</span>
          </div>`)}

        ${axis("🧗", "Поріг входу", ANAT_GATE, gate,
          "Скільки треба мати, щоб узагалі увійти в пакет",
          "Рядки вимог зі специфікації: обладнання, організаційні умови, кадри. Береться <b>сирий текст</b>, а не «розпізнані» позиції: " +
          "у пакеті 42 розпізнаних одиниць обладнання 24, а в тексті вимог — 480. Смуга — за місцем серед пакетів, бо саме число ні про що не каже. " +
          `Найважчий вхід у ПМГ — пакет ${escapeHtml(gTop)} (${uaNum(gateOf(all[gTop]))} рядків); цей пакет на ${gRank}-му місці з ${nums.length}.`,
          `<div class="da-nums">
            <span><b>${uaNum(A.eq)}</b>${plural(A.eq, "рядок", "рядки", "рядків")} про обладнання</span>
            <span><b>${uaNum(A.org)}</b>${plural(A.org, "організаційна умова", "організаційні умови", "організаційних умов")}</span>
            <span><b>${uaNum(A.kadr)}</b>${plural(A.kadr, "кадрова вимога", "кадрові вимоги", "кадрових вимог")}</span>
            <span><b>${uaNum(A.spec)}</b>${plural(A.spec, "пункт", "пункти", "пунктів")} специфікації</span>
          </div>`)}

        ${role ? axis("🧩", "Роль у закладі", ANAT_ROLE, role,
          "Заклад із цим пакетом займається переважно ним — чи це один рядок у великій лікарні",
          "Єдина вісь, що рахується не з тексту, а з <b>чинних договорів</b>: скільки ще пакетів ПМГ має той самий надавач. " +
          "Оновлюється разом із вивантажкою мережі. Реімбурсація та пілоти в рахунок не беруться.",
          `<div class="da-nums">
            ${role.solo >= 0.5 ? `<span><b>${pctUk(role.solo)}</b>надавачів мають лише цей пакет</span>` : `<span><b>жоден</b>надавач не живе лише цим пакетом</span>`}
            <span><b>${uaNum(Math.round(role.med))}</b>${plural(Math.round(role.med), "пакет", "пакети", "пакетів")} ПМГ у медіанного надавача, крім цього</span>
          </div>`) : ""}

        <section class="dr-card dr-card-mean">
          <h3>Навіщо це поруч із термометром</h3>
          <div class="dr-mean">
            <span class="dr-mean-i">🌡️</span>
            <div><strong>Масштаб і будова — різні питання</strong>
              <p>Термометр відповідає «скільки роботи», анатомія — «яка це робота». Пакет 64 (трансплантація органів) прохолодний за масштабом і вузький клінічно, але має найважчий вхід у ПМГ. Пакет 34 (стоматологія) монопрофільний і масовий водночас. Звести це в один бал означало б сховати саме те, що відрізняє пакети один від одного.</p></div>
          </div>
          <div class="dr-mean">
            <span class="dr-mean-i">🧩</span>
            <div><strong>Ширина і команда — теж різні речі</strong>
              <p>Паліативна допомога вузька за діагнозами (36 кодів МКХ-10), але потребує 47 різних посад: лікар, медсестра, психолог, соціальний працівник. Неонатальний скринінг навпаки — один напрям, шість посад і 69 рядків вимог до обладнання. Одна вісь не замінює іншу.</p></div>
          </div>
          <div class="dr-mean">
            <span class="dr-mean-i">🚪</span>
            <div><strong>Шлюз важливіший за осі</strong>
              <p>Перед будь-яким порівнянням стоїть питання, що пакет узагалі купує. Для капітації (ПМД) і готовності (42, 57, 68) клінічна ширина невимірювана: у платіжних даних первинки три коди на 48,4 млн послуг, і будь-яка цифра ширини там буде вигадкою.</p></div>
          </div>
        </section>

        <section class="dr-card dr-card-limits">
          <h3>Чого анатомія не каже</h3>
          <ul class="dr-limits">
            <li>Це опис <b>вимог і складу</b>, а не якості. Важкий вхід не означає, що пакет виконується добре.</li>
            <li>Клінічна ширина рахується з таблиці співставлення, а вона покриває <b>36 пакетів із 46</b>. Для решти вісь чесно показує «не міряється», а не вигадане число.</li>
            <li>Поріг входу — це <b>кількість рядків</b> вимог, а не їхня вартість. Один томограф в одному рядку важчий за десять рядків дрібного інвентарю.</li>
            <li>«Роль у закладі» описує мережу, а не пакет: той самий пакет в одній області може бути в моноклініці, а в іншій — у складі лікарні.</li>
          </ul>
        </section>`,
        };
      },
    },
    core80: {
      icon: "🎯",
      title: "Ядро бюджету пакета",
      build(pkg) {
        const s = computeCore(pkg.number);
        if (!s) return null;
        const v = verdictOf(s);
        const dens = s.equalCount / s.core;

        return {
          state: s,
          html: `
        <section class="dr-lede" data-verdict="${v.key}">
          <div class="dr-lede-main">
            <p class="dr-lede-q">Скільки закладів забирає 4/5 грошей пакета</p>
            <p class="dr-lede-a"><b>${uaNum(s.core)}</b> ${zozUk(s.core)} із ${uaNum(s.n)} —
              <b>${pctUk(s.corePct)}</b> мережі — ${otrym(s.core)} <b>${pctUk(s.coreMoneyPct)}</b> бюджету пакета.</p>
            <p class="dr-lede-b">${s.tailRows.length === 0
              ? "Це вся мережа пакета: закладів поза ядром немає."
              : s.tailRows.length === 1
                ? `Ще один заклад отримує ${pctUk(100 - s.coreMoneyPct)} — ${escapeHtml(formatMoneyShort(s.total - s.coreSum))}.`
                : `Решта ${uaNum(s.tailRows.length)} ${zozUk(s.tailRows.length)} ${dilyt(s.tailRows.length)} між собою
                   ${pctUk(100 - s.coreMoneyPct)} — ${escapeHtml(formatMoneyShort(s.total - s.coreSum))}.`}</p>
          </div>
          <div class="dr-lede-badge">
            <span class="dlb-i">${v.icon}</span>
            <b>${escapeHtml(v.title)}</b>
            <i>${escapeHtml(v.desc)}</i>
          </div>
        </section>

        <section class="dr-card dr-card-hero">
          <h3>Куди йдуть гроші пакета</h3>
          <p class="dr-hint">Верхня смуга — заклади, нижня — гривні. Стрічка між ними показує, наскільки одне не збігається з іншим.</p>
          ${funnelSvg(s)}
          <div class="dr-legend">
            <span><i class="core"></i>ядро — ${uaNum(s.core)} ${zozUk(s.core)}</span>
            <span><i class="tail"></i>хвіст — ${uaNum(s.tailRows.length)} ${zozUk(s.tailRows.length)}</span>
          </div>
        </section>

        <section class="dr-stats">
          ${statCard("Якби ділилося порівну", `${uaNum(s.equalCount)} <small>ЗОЗ</small>`,
            "стільки закладів давали б 4/5 бюджету при однакових договорах",
            "80 % грошей при рівному розподілі беруть 80 % закладів. Це природний нуль показника: чим менше за нього ядро, тим щільніше зібрані гроші.")}
          ${statCard("Насправді ядро менше", escapeHtml(timesUk(dens).replace(/^у /, "")),
            `${uaNum(s.core)} замість ${uaNum(s.equalCount)}`,
            "У скільки разів фактичне ядро менше за те, яке було б при однакових договорах.")}
          ${quantTile(s, s.q10, "Топ-10 % мережі")}
          ${quantTile(s, s.q50, "Половина мережі")}
        </section>

        <div class="dr-two">
          <section class="dr-card">
            <h3>Крива концентрації</h3>
            <p class="dr-hint">Що вище крива над діагоналлю — то щільніше зібрані гроші.</p>
            ${curveSvg(s)}
          </section>
          <section class="dr-card dr-card-read">
            <h3>Як це читати</h3>
            <ul class="dr-read">
              <li><b>${pctUk(s.q10.pct)}</b> бюджету — у 10 % найбільших <small>${uaNum(s.q10.k)} ${zozUk(s.q10.k)}</small></li>
              <li><b>${pctUk(s.q25.pct)}</b> — у чверті мережі <small>${uaNum(s.q25.k)} ${zozUk(s.q25.k)}</small></li>
              <li><b>${pctUk(s.q50.pct)}</b> — у половини мережі <small>${uaNum(s.q50.k)} ${zozUk(s.q50.k)}</small></li>
              <li class="hi"><b>${pctUk(s.coreMoneyPct)}</b> — у ядра <small>${uaNum(s.core)} ${zozUk(s.core)} · ${pctUk(s.corePct)} мережі</small></li>
            </ul>
            <div class="dr-ruler-box">${rulerHtml(s)}</div>
          </section>
        </div>

        <section class="dr-card">
          <h3>Ядро проти хвоста</h3>
          <p class="dr-hint">Дві групи одного пакета — і те, чим вони відрізняються, крім суми договору.</p>
          <div class="dr-cmp-scroll">${compareHtml(s)}</div>
        </section>

        <section class="dr-card">
          <h3>Де лежить ядро</h3>
          <p class="dr-hint">Скільки грошей пакета в кожному регіоні припадає на заклади ядра. Клік по регіону відфільтрує перелік ЗОЗ на сторінці.</p>
          ${regionsHtml(s)}
        </section>

        <section class="dr-card">
          <div class="dr-list-head">
            <h3>Поіменно: ${uaNum(s.core)} ${zozUk(s.core)} ядра</h3>
            <button type="button" class="dr-apply" data-apply="core">Показати їх у переліку ЗОЗ ↓</button>
          </div>
          <div id="drList">${listHtml(s, LIST_STEP)}</div>
        </section>

        <section class="dr-card dr-card-mean">
          <h3>Що з цього випливає</h3>
          ${meaningHtml(s, v)}
        </section>

        <section class="dr-card dr-card-limits">
          <h3>Чого показник не каже</h3>
          ${limitsHtml(s)}
        </section>`,
        };
      },
    },
  };

  /* ═══════ каркас: шухляда, відкриття, закриття ═══════ */

  let scrim = null, lastFocus = null, cur = null, curLimit = LIST_STEP;

  function ensureDom() {
    if (scrim) return;
    scrim = document.createElement("div");
    scrim.className = "drill-scrim";
    scrim.hidden = true;
    scrim.innerHTML = `
      <div class="drill-sheet" role="dialog" aria-modal="true" aria-labelledby="drillTitle">
        <header class="drill-head">
          <span class="dh-icon" id="drillIcon">🎯</span>
          <div class="dh-txt">
            <h2 id="drillTitle">—</h2>
            <p class="dh-sub" id="drillSub">—</p>
          </div>
          <button type="button" class="drill-close" id="drillClose" aria-label="Закрити" title="Закрити (Esc)">✕</button>
        </header>
        <div class="drill-body" id="drillBody"></div>
      </div>`;
    document.body.appendChild(scrim);

    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
    scrim.querySelector("#drillClose").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !scrim.hidden) close();
    });

    // Дії всередині сторінки
    scrim.addEventListener("click", (e) => {
      const more = e.target.closest("[data-more]");
      if (more && cur) {
        const box = el("drList");
        curLimit = more.dataset.more === "1"
          ? Math.min(cur.core, curLimit + LIST_STEP * 4)
          : LIST_STEP;
        box.innerHTML = listHtml(cur, curLimit);
        if (more.dataset.more === "0") box.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      const apply = e.target.closest("[data-apply]");
      if (apply && cur) { applyCoreFilter(cur); return; }
      const reg = e.target.closest("[data-obl]");
      if (reg) { applyOblast(reg.dataset.obl); return; }
    });
  }

  /* Фільтр переліку ЗОЗ по конкретних закладах ядра. Ключ — ЄДРПОУ:
     у межах одного пакета надавач має рівно один договір, тож колізій немає. */
  function applyCoreFilter(s) {
    passportState.hospitalCombo = {
      req: [], excl: [],
      only: new Set(s.coreRows.map((r) => r.c.pkey || r.c.edrpou)),
      chip: "Фільтр:",
      label: `ядро бюджету — ${uaNum(s.core)} ${zozUk(s.core)}, що дають ${pctUk(s.coreMoneyPct)} грошей пакета`,
    };
    passportState.hospitalCurrentPage = 1;
    close();
    renderComboFilterChip();
    renderHospitalsTable();
    const box = el("hospitalsCollapse");
    if (box) { box.open = true; box.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }

  function applyOblast(o) {
    passportState.hospitalOblast = o;
    passportState.hospitalCurrentPage = 1;
    const sel = el("hospitalOblastFilter");
    if (sel) sel.value = o;
    close();
    renderHospitalsTable();
    const box = el("hospitalsCollapse");
    if (box) { box.open = true; box.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }

  function open(kind) {
    const d = DRILLS[kind];
    const pkg = passportState.selectedPackage;
    if (!d || !pkg) return;
    ensureDom();
    const built = d.build(pkg);
    if (!built) return;

    cur = built.state;
    curLimit = LIST_STEP;
    lastFocus = document.activeElement;

    el("drillIcon").textContent = d.icon;
    el("drillTitle").textContent = d.title;
    el("drillSub").textContent = `Пакет ${pkg.number} · ${pkg.title || pkg.name || ""}`;
    el("drillBody").innerHTML = built.html;
    el("drillBody").scrollTop = 0;

    scrim.hidden = false;
    document.body.classList.add("drill-open");
    const main = document.querySelector(".passport-main");
    if (main) main.style.overflow = "hidden";
    scrim.classList.remove("in");
    void scrim.offsetHeight;      // перезапуск анімації появи
    scrim.classList.add("in");
    el("drillClose").focus();
  }

  function close() {
    if (!scrim || scrim.hidden) return;
    // Закриваємо синхронно: відкладене приховування залишало б непрозору
    // підкладку поверх сторінки, якщо анімація зникання не відпрацює
    scrim.classList.remove("in");
    scrim.hidden = true;
    document.body.classList.remove("drill-open");
    const main = document.querySelector(".passport-main");
    if (main) main.style.overflow = "";
    el("drillBody").innerHTML = "";
    cur = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* Клік по плитці — делегований на документ: плитки перемальовуються
     при кожній зміні пакета, і вішати обробник на кожну означало б стежити
     за їхнім життєвим циклом. */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-drill]");
    if (t) open(t.dataset.drill);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target.closest && e.target.closest("[data-drill]");
    if (t) { e.preventDefault(); open(t.dataset.drill); }
  });

  window.KpiDrill = { open, close, has: (k) => Boolean(DRILLS[k]) };
})();
