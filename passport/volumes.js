/**
 * Фактичні обсяги наданих послуг — вкладка «Аналітика та ЗОЗ» паспорта пакета.
 *
 * Дані: вивантажка ЕСОЗ (місяць × надавач × пакет × послуга × стать × вік),
 * зведена конвеєром 23_обсяги_демографія у passport/data/volumes/pkg_<N>.json.
 * Знаменник для показників «на N населення» — passport/data/demography.json
 * (активні декларації ПМД, оновлюються щотижня).
 *
 * Головне застереження, винесене і в інтерфейс: у джерелі НЕМАЄ унікальних
 * пацієнтів — лише послуги й медзаписи. Тому все, що тут рахується, — це
 * інтенсивність «послуг на N населення», а не «відсоток охоплення».
 */
(function () {
  "use strict";

  const V = {
    index: null,
    demo: null,
    cache: new Map(),
    unit: "auto",          // auto | 1000 | 10000 | 100000
    _pkg: null,
    _svcLimit: 12,
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => Number(n || 0).toLocaleString("uk-UA");
  const dec = (n, d) => Number(n || 0).toLocaleString("uk-UA",
    { minimumFractionDigits: d, maximumFractionDigits: d });
  const el = (id) => document.getElementById(id);

  const MONTH_NAMES = ["січ", "лют", "бер", "кві", "тра", "чер",
                       "лип", "сер", "вер", "жов", "лис", "гру"];
  const BAND_LABEL = { "y00-05": "0–5", "y06-17": "6–17", "y18-39": "18–39",
                       "y40-64": "40–64", "y65+": "65+" };
  const BANDS = ["y00-05", "y06-17", "y18-39", "y40-64", "y65+"];
  const UNITS = [
    { mult: 1000, label: "на 1 тис. населення", short: "на 1 тис." },
    { mult: 10000, label: "на 10 тис. населення", short: "на 10 тис." },
    { mult: 100000, label: "на 100 тис. населення", short: "на 100 тис." },
  ];

  /* ── Завантаження ─────────────────────────────────────────────
     Обидва набори необовʼязкові: якщо конвеєр ще не проганяли, блок просто
     не показується, а решта паспорта працює як раніше.  */
  async function boot() {
    const [idx, demo] = await Promise.all([
      fresh("data/volumes/index.json"),
      fresh("data/demography.json"),
    ]);
    V.index = idx;
    V.demo = demo;
    return Boolean(idx);
  }

  /* Ці два файли не мають версії в імені, а сервіс-воркер тримає .json
     cache-first — тобто `cache: "no-cache"` його не обходить: воркер віддає
     свою копію, навіть не питаючи сервер. Саме на цьому index.json одного
     разу приїхав без нового поля. Тому додаємо унікальний параметр: для
     воркера це інша адреса, і він іде в мережу.
     Якщо мережі немає (офлайн у PWA), падаємо назад на адресу без параметра —
     тоді працює збережена копія. */
  function fresh(url) {
    return fetch(url + "?t=" + Date.now())
      .then((r) => { if (!r.ok) throw new Error("no " + url); return r.json(); })
      .catch(() => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }

  /* Файли пакетів ходять під cache-first сервіс-воркера, тому версіонуємо їх
     штампом збірки з index.json: перезібрали конвеєр — змінився ?v=, і браузер
     піде по нові числа замість того, щоб малювати вчорашні. */
  async function pkgData(pkgNum) {
    if (V.cache.has(pkgNum)) return V.cache.get(pkgNum);
    const v = (V.index && V.index.stamp) ? "?v=" + V.index.stamp : "";
    const d = await fetch("data/volumes/pkg_" + encodeURIComponent(pkgNum) + ".json" + v)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    V.cache.set(pkgNum, d);
    return d;
  }

  /* ── Цільова група пакета ─────────────────────────────────────
     Знаменник «усе населення» бреше там, де пакет за визначенням працює з
     вужчим колом: мамографія — жінки 40+, неонатальний скринінг — діти 0–5.
     Тому цільову групу не задаємо вручну, а виводимо з самих даних.

     Стать і вік відбираються ОКРЕМО, а не парами «стать × вік». Інакше
     трапляється так, що в знаменник потрапляють жінки 65+, а чоловіки 65+ ні,
     — підпис «чоловіки і жінки 65+» тоді не описує того, що порахували.
     Пороги різні, бо питання різні: стать — це «пакет для обох чи для однієї»
     (5 %), вік — «чи працює пакет із цією групою взагалі» (1 %).  */
  const GENDER_MIN = 0.05;
  const AGE_MIN = 0.01;

  function targetCells(d) {
    let tot = 0;
    const byG = { MALE: 0, FEMALE: 0 };
    const byB = {};
    Object.keys(d.d).forEach((c) => {
      if (c.indexOf("Уточнюється") !== -1) return;
      const v = d.d[c][0];
      const p = c.split("|");
      tot += v;
      byG[p[0]] = (byG[p[0]] || 0) + v;
      byB[p[1]] = (byB[p[1]] || 0) + v;
    });
    if (!tot) return { cells: [], share: 0 };

    let genders = ["MALE", "FEMALE"].filter((g) => byG[g] >= tot * GENDER_MIN);
    if (!genders.length) genders = ["MALE", "FEMALE"].filter((g) => byG[g] > 0);
    let bands = BANDS.filter((b) => (byB[b] || 0) >= tot * AGE_MIN);
    if (!bands.length) bands = BANDS.filter((b) => byB[b] > 0);

    const cells = [];
    let acc = 0;
    genders.forEach((g) => bands.forEach((b) => {
      const c = g + "|" + b;
      cells.push(c);
      acc += (d.d[c] || [0])[0];
    }));
    return { cells: cells, share: acc / tot };
  }

  function targetLabel(cells) {
    const g = new Set(cells.map((c) => c.split("|")[0]));
    const ages = BANDS.filter((b) => cells.some((c) => c.slice(c.indexOf("|") + 1) === b));
    const gl = g.size === 2 ? "чоловіки і жінки" : (g.has("FEMALE") ? "жінки" : "чоловіки");
    if (!ages.length) return gl;
    if (ages.length === BANDS.length) return gl + " всіх віків";
    if (ages.length === 1) return gl + " " + BAND_LABEL[ages[0]];
    const lo = BAND_LABEL[ages[0]].split("–")[0];
    const hiKey = ages[ages.length - 1];
    // Верхня група відкрита («65+»), тому діапазон теж пишемо відкритим:
    // «40–65+» читалося б як верхня межа 65 років
    if (hiKey === "y65+") return gl + " " + lo + "+";
    return gl + " " + lo + "–" + BAND_LABEL[hiKey].split("–")[1];
  }

  /** ISO-дату з даних — у звичний вигляд 19.08.2026. */
  function dmy(iso) {
    if (!iso || iso.length < 10 || iso.indexOf("-") === -1) return iso || "—";
    const p = iso.slice(0, 10).split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }

  /** Населення цільової групи: по країні або по одній області. */
  function denominator(cells, oblast) {
    if (!V.demo) return 0;
    const src = oblast ? [V.demo.oblasts[oblast]] : Object.keys(V.demo.oblasts).map((k) => V.demo.oblasts[k]);
    let n = 0;
    for (const o of src) {
      if (!o) continue;
      for (const c of cells) n += o.cells[c] || 0;
    }
    return n;
  }

  /** Сходинка одиниці: найдрібніша, за якої показник ще не менший за 1. */
  function pickUnit(perPerson) {
    if (V.unit !== "auto") {
      const forced = UNITS.filter((u) => u.mult === Number(V.unit))[0];
      if (forced) return forced;
    }
    return UNITS.filter((u) => perPerson * u.mult >= 1)[0] || UNITS[2];
  }

  function shortNum(n) {
    if (n >= 1e6) return dec(n / 1e6, 1) + " млн";
    if (n >= 1e4) return Math.round(n / 1e3) + " тис.";
    return num(n);
  }

  /* ── Головна пастка розрізу «на населення» ────────────────────
     Область у вивантажці — це місце НАДАВАЧА, а не проживання пацієнта.
     Поки мережа широка, різниця розмивається: людину лікують переважно вдома.
     Але там, де на всю країну кілька центрів (неонатальний скринінг — чотири
     лабораторії, трансплантація, радіоізотопна діагностика), знаменник і
     чисельник стосуються різних людей: обсяг центру ділиться на населення
     області, де центр стоїть. Такий показник не читається взагалі, і мовчати
     про це не можна — тому попередження йде просто в легенду карти.  */
  const SPREAD_MIN = 15;   // менше стількох областей з обсягом — мережа точкова

  function placeWarning(d, vol) {
    const withVol = Object.keys(vol).filter((o) => vol[o] > 0).length;
    const base = "Область — це місце надавача, а не проживання пацієнта.";
    if (withVol >= SPREAD_MIN) return base;
    return "⚠ " + base + " Заклади за цим пакетом є лише у " + withVol + " " +
      plural(withVol, "регіоні", "регіонах", "регіонах") +
      ", тобто обсяг центру ділиться на населення області, де центр стоїть, " +
      "а лікуються там люди з усієї країни. Показник «на населення» для такого " +
      "пакета не читається — дивіться абсолютний обсяг.";
  }

  /** Обсяг по областях за повні місяці. */
  function oblastVolumes(d) {
    const full = d.months.filter((m) => d.partial.indexOf(m) === -1);
    const vol = {};
    full.forEach((m) => {
      const row = d.mo[m] || {};
      Object.keys(row).forEach((o) => { vol[o] = (vol[o] || 0) + row[o]; });
    });
    return { vol: vol, months: full.length };
  }

  /* ── Публічний зріз для карти ─────────────────────────────────
     passport.js питає, чим зафарбувати області в режимах «обсяг» і
     «на населення». Повертаємо null, якщо даних немає, — карта тоді
     лишається в базовому режимі «кількість ЗОЗ».  */
  function mapMetric(mode) {
    const d = V._pkg;
    if (!d) return null;
    const ov = oblastVolumes(d);
    const vol = ov.vol;

    if (mode === "vol") {
      return {
        val: (o) => vol[o] || 0,
        txt: (o) => (vol[o] ? shortNum(vol[o]) : ""),
        tip: (o) => (vol[o]
          ? num(vol[o]) + " послуг за " + ov.months + " міс."
          : "послуг не надавалось"),
        legend: "Число в області — скільки послуг за пакетом фактично надано за " +
                ov.months + " міс. 2026 року. Це не гроші й не кількість пацієнтів.",
      };
    }

    const tc = targetCells(d);
    const denUkr = denominator(tc.cells);
    const unit = pickUnit(denUkr ? d.tot[0] / denUkr : 0);
    const rate = {};
    const dens = {};
    Object.keys(vol).forEach((o) => {
      const den = denominator(tc.cells, o);
      if (den > 0) { dens[o] = den; rate[o] = vol[o] / den * unit.mult; }
    });
    /* Довіра до знаменника рахується в конвеєрі (див. build_demography.py) з
       двох сигналів: охоплення деклараціями проти бази 2022 року і частка ВПО
       за IOM DTM. Області з низькою довірою помічаємо зірочкою просто в числі —
       це звична статистична конвенція і працює однаково на карті й на плитках. */
    const conf = (o) => {
      const rec = V.demo && V.demo.oblasts[o];
      return rec && rec.confidence ? rec.confidence : null;
    };
    const why = (o) => {
      const rec = V.demo && V.demo.oblasts[o];
      return rec && rec.confidence_why ? rec.confidence_why : "";
    };
    const flagged = Object.keys(rate).filter((o) => conf(o) === "low");

    return {
      val: (o) => rate[o] || 0,
      txt: (o) => (rate[o]
        ? dec(rate[o], rate[o] < 10 ? 1 : 0) + (conf(o) === "low" ? "*" : "")
        : ""),
      tip: (o) => (rate[o] != null && dens[o]
        ? dec(rate[o], rate[o] < 10 ? 1 : 0) + " послуг " + unit.short +
          " — " + num(vol[o] || 0) + " послуг на " + num(dens[o]) + " осіб цільової групи" +
          (conf(o) && conf(o) !== "high" ? ". Знаменник: " + why(o) : "")
        : "знаменника немає"),
      conf: conf,
      legend: "Число в області — послуг " + unit.short + " цільової групи (" +
              targetLabel(tc.cells) + ") за " + ov.months + " міс. Знаменник — активні " +
              "декларації ПМД станом на " + (V.demo ? dmy(V.demo.declarations_updated) : "—") +
              ". " + placeWarning(d, vol) +
              (flagged.length
                ? " Зірочкою помічені " + flagged.length + " " +
                  plural(flagged.length, "область", "області", "областей") +
                  ", де знаменник ненадійний — прифронтові та з базою, що включає " +
                  "окуповану територію; порівнювати їх з рештою не можна" +
                  (V.demo && V.demo.idp_date
                    ? " (оцінка руху населення — ВПО за IOM DTM на " + dmy(V.demo.idp_date) + ")"
                    : "") + "."
                : ""),
      unit: unit,
    };
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function kpi(icon, label, value, sub) {
    return '<div class="kpi-tile">' +
      '<div class="kpi-head"><span class="kpi-icon">' + icon + '</span>' +
      '<span class="kpi-label">' + esc(label) + '</span></div>' +
      '<div class="kpi-value">' + value + '</div>' +
      '<div class="kpi-sub">' + sub + '</div></div>';
  }

  /* ── Малювання блоку ──────────────────────────────────────── */
  async function render(pkgNum) {
    const sec = el("volumesSection");
    if (!sec) return null;
    const d = await pkgData(pkgNum);
    V._pkg = d;
    if (!d) { sec.hidden = true; return null; }
    sec.hidden = false;

    const ov = oblastVolumes(d);
    const full = d.months.filter((m) => d.partial.indexOf(m) === -1);
    const fullSum = full.reduce((s, m) => s + d.m[m][0], 0);
    const fullEmz = full.reduce((s, m) => s + d.m[m][1], 0);
    const mn = (m) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];
    const periodLabel = full.length
      ? mn(full[0]) + "–" + mn(full[full.length - 1]) + " " + full[0].slice(0, 4)
      : "—";

    const tc = targetCells(d);
    const denUkr = denominator(tc.cells);
    const perPerson = denUkr ? fullSum / denUkr : 0;
    const unit = pickUnit(perPerson);
    const rateUkr = perPerson * unit.mult;

    el("volSub").innerHTML =
      "Що <b>фактично надано</b> за пакетом у " + esc(periodLabel) +
      " — на відміну від решти вкладки, де показані договори й гроші. " +
      "Джерело — вивантажка ЕСОЗ, зведена " + esc(V.index ? V.index.generated : "") + ".";

    const emzHint = fullEmz > fullSum * 1.5
      ? "на одну оплачувану послугу — " + dec(fullEmz / fullSum, 1) + " медзаписи"
      : (fullEmz < fullSum * 0.9
        ? "медзаписів менше, ніж послуг (" + dec(fullEmz / fullSum, 2) + " на послугу)"
        : "майже один до одного з послугами");

    el("volKpis").innerHTML =
      kpi("📈", "Надано послуг", num(fullSum), "за " + full.length + " міс. " + esc(periodLabel)) +
      kpi("🧾", "Медичних записів", num(fullEmz), emzHint) +
      kpi("🏥", "Надавачів звітували", num(d.tot[2]),
          "у пакеті " + d.sv.length + " " +
          plural(d.sv.length, "послуга", "послуги", "послуг") + " у вивантажці") +
      (denUkr
        ? kpi("👥", "Послуг " + unit.short, dec(rateUkr, rateUkr < 10 ? 1 : 0),
              "цільова група — " + esc(targetLabel(tc.cells)) + ", " + shortNum(denUkr) + " осіб")
        : kpi("👥", "Послуг на населення", "—", "знаменника для цієї групи немає"));

    renderMonths(d);
    renderDemo(d, unit);
    renderServices(d);

    const partialTxt = d.partial.length
      ? " Останній місяць вивантажки (" + d.partial.map((m) => mn(m) + " " + m.slice(0, 4)).join(", ") +
        ") обрізаний — у ньому близько 1 % звичайного обсягу, тому в підсумки він не входить."
      : "";
    el("volFootnote").innerHTML =
      "<b>Одиниця обліку — послуга, а не пацієнт.</b> У вивантажці немає унікальних осіб, тому " +
      "«послуг " + esc(unit.short) + "» — це інтенсивність, а не відсоток охоплення: одна людина " +
      "може отримати послугу кілька разів за рік." +
      (tc.share < 0.999
        ? " Цільову групу (" + esc(targetLabel(tc.cells)) + ") виведено з самих даних — вона дає " +
          dec(tc.share * 100, 1) + " % обсягу пакета; поодинокі випадки поза нею у знаменник не беруться."
        : "") +
      " Знаменник — активні декларації ПМД (оновлення щотижня, дані на " +
      esc(V.demo ? dmy(V.demo.declarations_updated) : "—") + "), а не чисельність населення: офіційної " +
      "чисельності після 01.01.2022 не існує. По країні деклараціями охоплено " +
      (V.demo ? dec(V.demo.coverage_ukr_pct, 1) : "—") + " % населення бази 2022 року, і по областях " +
      "це різниться — від 48 % на Херсонщині до 103 % на Київщині, тому міжобласне порівняння " +
      "показника читається з поправкою на цю різницю." + partialTxt;

    return { months: ov.months };
  }

  /* ── Помісячна динаміка ─────────────────────────────────────
     Обрізаний хвіст малюємо штрихованим і не враховуємо в максимумі, інакше
     графік читався б як обвал наприкінці року.  */
  /* Полотно рахується під ФАКТИЧНУ ширину картки, а не малюється в умовному
     viewBox і розтягується. preserveAspectRatio="none" розтягує разом із
     геометрією ще й текст — літери пливуть по горизонталі, і графік виглядає
     розмитим. Тому viewBox = реальні пікселі, а масштаб (якщо й буде) —
     рівномірний. */
  const CH = { h: 210, l: 52, r: 16, t: 26, b: 28, minW: 320 };

  function renderMonths(d) {
    const box = el("volMonths");
    const full = d.months.filter((m) => d.partial.indexOf(m) === -1);
    const mn = (m) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];
    if (!full.length) { box.innerHTML = ""; return; }

    const W = Math.max(CH.minW, Math.round(box.clientWidth || 640));
    box._vw = W;

    const svc = full.map((m) => d.m[m][0]);
    const emz = full.map((m) => d.m[m][1]);
    const svcTop = Math.max.apply(null, svc);
    const emzTop = Math.max.apply(null, emz);
    /* Друга лінія доречна лише у вузькій смузі. Нижче 1,15× вона просто лягає
       на першу. Вище 4× — гірше: спільна вісь тягнеться до медзаписів, і лінія
       послуг, заради якої графік існує, розчавлюється в риску біля нуля
       (пакет 54: 148 тис. послуг проти 4,8 млн записів). Там, де так, число
       записів на послугу вже стоїть у плитці KPI. */
    const showEmz = emzTop > svcTop * 1.15 && emzTop <= svcTop * 4;

    /* Вісь від НУЛЯ, а не від мінімуму ряду. Автомасштаб «від мінімуму» —
       найпоширеніший спосіб збрехати графіком: коливання в 4 % розтягується
       на всю висоту і читається як обвал. */
    const top = showEmz ? emzTop : svcTop;
    const step = niceStep(top);
    const yMax = Math.max(step, Math.ceil(top / step) * step);
    const iw = W - CH.l - CH.r;
    const ih = CH.h - CH.t - CH.b;
    const x = (i) => CH.l + (full.length === 1 ? iw / 2 : (iw * i) / (full.length - 1));
    const y = (v) => CH.t + ih - (v / yMax) * ih;

    // Підписи осі — у власній лівій колонці, а не поверх графіка: саме там
    // вони налазили на значення першої точки
    const ax = axisFmt(yMax);
    const ticks = [];
    for (let v = 0; v <= yMax + 1; v += step) ticks.push(v);
    const grid = ticks.map((v) =>
      '<line class="vc-grid" x1="' + CH.l + '" x2="' + (W - CH.r) +
      '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
      '<text class="vc-tick" x="' + (CH.l - 8) + '" y="' + (y(v) + 3.5).toFixed(1) +
      '" text-anchor="end">' + esc(ax(v)) + "</text>").join("");

    const path = (vals) =>
      vals.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    const areaPath = '<path class="vc-area" d="' + path(svc) +
      " L" + x(svc.length - 1).toFixed(1) + " " + y(0).toFixed(1) +
      " L" + x(0).toFixed(1) + " " + y(0).toFixed(1) + ' Z"/>';

    const dots = full.map((m, i) => {
      const tip = mn(m) + ": " + num(svc[i]) + " послуг · " + num(emz[i]) + " медзаписів";
      return '<g class="vc-pt"><title>' + esc(tip) + "</title>" +
        '<circle class="vc-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(svc[i]).toFixed(1) + '" r="3"/>' +
        '<circle class="vc-hit" cx="' + x(i).toFixed(1) + '" cy="' + y(svc[i]).toFixed(1) + '" r="16"/>' +
        "</g>";
    }).join("");

    /* Підписуємо тільки найвищу і найнижчу точки. Краї ряду підписували
       раніше — і на лівому краю значення сідало рівно на позначку осі.
       Динаміку словами й так дає підпис під графіком. */
    const iMax = svc.indexOf(svcTop);
    const iMin = svc.indexOf(Math.min.apply(null, svc));
    const marks = iMax === iMin ? [iMax] : [iMax, iMin];
    const vals = marks.map((i) => {
      const up = i === iMax;
      const anchor = i === 0 ? "start" : (i === full.length - 1 ? "end" : "middle");
      return '<text class="vc-val" x="' + x(i).toFixed(1) + '" y="' +
        (y(svc[i]) + (up ? -11 : 17)).toFixed(1) + '" text-anchor="' + anchor + '">' +
        esc(ax(svc[i])) + "</text>";
    }).join("");

    const labels = full.map((m, i) =>
      '<text class="vc-mon" x="' + x(i).toFixed(1) + '" y="' + (CH.h - 8) +
      '" text-anchor="middle">' + mn(m) + "</text>").join("");

    const svg = '<svg class="vc" viewBox="0 0 ' + W + " " + CH.h + '" width="' + W +
      '" height="' + CH.h + '" role="img" aria-label="Помісячна динаміка наданих послуг">' +
      grid + areaPath +
      '<path class="vc-line" d="' + path(svc) + '"/>' +
      (showEmz ? '<path class="vc-line emz" d="' + path(emz) + '"/>' : "") +
      dots + vals + labels + "</svg>";

    const legend = showEmz
      ? '<div class="vc-legend"><span class="vc-key svc"></span>послуги' +
        '<span class="vc-key emz"></span>медзаписи</div>'
      : "";

    const first = svc[0], last = svc[svc.length - 1];
    const trend = first ? (last - first) / first * 100 : 0;
    const trendTxt = full.length > 1
      ? "Від " + mn(full[0]) + " (" + ax(first) + ") до " + mn(full[full.length - 1]) +
        " (" + ax(last) + ") обсяг " +
        (trend > 3 ? "виріс" : (trend < -3 ? "впав" : "тримається рівно")) +
        (Math.abs(trend) > 3 ? " на " + dec(Math.abs(trend), 0) + " %" : "") + "."
      : "";
    box.innerHTML = svg + legend + '<p class="vm-note">' + trendTxt +
      (d.partial.length
        ? " Обрізаний хвіст вивантажки (" +
          d.partial.map((m) => mn(m)).join(", ") + ") на графік не береться."
        : "") + "</p>";

    watchWidth(box, d);
  }

  /* Полотно прив'язане до ширини в пікселях, тому при зміні розміру вікна його
     треба перерахувати. Перемальовуємо лише на помітну зміну — інакше власна
     перерисовка знову тригерила б спостерігача. */
  function watchWidth(box, d) {
    if (box._ro || typeof ResizeObserver === "undefined") return;
    box._ro = new ResizeObserver(() => {
      const w = Math.round(box.clientWidth || 0);
      if (w && Math.abs(w - (box._vw || 0)) > 8 && V._pkg) renderMonths(V._pkg);
    });
    box._ro.observe(box);
  }

  /** Один формат чисел на всю вісь, обраний за її верхом. */
  function axisFmt(yMax) {
    if (yMax >= 1e6) return (v) => (v ? dec(v / 1e6, 1) + " млн" : "0");
    if (yMax >= 1e4) return (v) => (v ? dec(v / 1e3, 0) + " тис." : "0");
    return (v) => num(v);
  }

  /** Крок сітки: 1/2/5 × 10^n, щоб підписи осі були круглими числами. */
  function niceStep(top) {
    if (top <= 0) return 1;
    const raw = top / 4;
    const mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  /* ── Хто отримує: стать × вік ───────────────────────────────
     Ліворуч чоловіки, праворуч жінки. Крім обсягу показуємо інтенсивність
     у кожній віковій групі — це те, чого не видно в абсолютних числах:
     маленька за обсягом група може виявитись найінтенсивнішою.  */
  function renderDemo(d, unit) {
    const box = el("volDemo");
    const get = (g, b) => (d.d[g + "|" + b] || [0])[0];
    const tot = BANDS.reduce((s, b) => s + get("MALE", b) + get("FEMALE", b), 0);
    const max = Math.max.apply(null, [1].concat(
      BANDS.map((b) => Math.max(get("MALE", b), get("FEMALE", b)))));

    const pop = (g, b) => {
      if (!V.demo) return 0;
      let n = 0;
      const obl = V.demo.oblasts;
      for (const k of Object.keys(obl)) n += obl[k].cells[g + "|" + b] || 0;
      return n;
    };
    const fmtRate = (r) => (r == null ? "" : dec(r, r < 10 ? 1 : 0) + " " + unit.short);

    const rows = BANDS.map((b) => {
      const m = get("MALE", b), f = get("FEMALE", b);
      if (!m && !f) return "";
      const pm = pop("MALE", b), pf = pop("FEMALE", b);
      const rm = pm ? m / pm * unit.mult : null;
      const rf = pf ? f / pf * unit.mult : null;
      const tipM = "Чоловіки " + BAND_LABEL[b] + ": " + num(m) + " послуг" +
        (rm != null ? ", " + fmtRate(rm) : "");
      const tipF = "Жінки " + BAND_LABEL[b] + ": " + num(f) + " послуг" +
        (rf != null ? ", " + fmtRate(rf) : "");
      return '<div class="vd-row">' +
        '<span class="vd-num left" title="' + esc(tipM) + '">' + shortNum(m) + "</span>" +
        '<div class="vd-track left"><div class="vd-bar male" style="width:' +
          (m / max * 100).toFixed(1) + '%" title="' + esc(tipM) + '"></div></div>' +
        '<span class="vd-age">' + BAND_LABEL[b] + "</span>" +
        '<div class="vd-track right"><div class="vd-bar female" style="width:' +
          (f / max * 100).toFixed(1) + '%" title="' + esc(tipF) + '"></div></div>' +
        '<span class="vd-num right" title="' + esc(tipF) + '">' + shortNum(f) + "</span></div>";
    }).join("");

    box.innerHTML =
      '<div class="vd-head"><span class="vd-m">чоловіки</span>' +
      '<span class="vd-age">вік</span><span class="vd-f">жінки</span></div>' + rows +
      '<p class="vd-note">Ширина смуги — обсяг послуг; у підказці ще й інтенсивність ' +
      esc(unit.short) + ' відповідної статево-вікової групи. Разом ' + num(tot) + " послуг.</p>";
  }

  /* ── Послуги пакета ──────────────────────────────────────── */
  const SVC_STEP = 12;
  function renderServices(d) {
    const card = el("volServicesCard");
    if (!card) return;
    if (d.sv.length <= 1) { card.hidden = true; return; }
    card.hidden = false;
    V._svcLimit = SVC_STEP;
    el("volServicesHead").textContent =
      d.sv.length + " " + plural(d.sv.length, "позиція", "позиції", "позицій") + " у вивантажці";
    drawServices(d);
  }

  function drawServices(d) {
    const box = el("volServices");
    const max = Math.max.apply(null, [1].concat(d.sv.map((s) => s.s)));
    const tot = d.sv.reduce((s, x) => s + x.s, 0);
    const rows = d.sv.slice(0, V._svcLimit);
    box.innerHTML = rows.map((s) =>
      '<div class="vs-row" title="' + esc(s.t) + '">' +
      '<span class="vs-code">' + esc(s.n) + "</span>" +
      '<span class="vs-name">' + esc(s.t) + "</span>" +
      '<div class="vs-track"><div class="vs-bar" style="width:' +
        (s.s / max * 100).toFixed(1) + '%"></div></div>' +
      '<span class="vs-val">' + num(s.s) + "<small>" + dec(s.s / tot * 100, 1) + " %</small></span>" +
      '<span class="vs-z">' + num(s.z) + " <small>ЗОЗ</small></span></div>").join("");
    const more = el("volServicesMore");
    const left = d.sv.length - rows.length;
    more.hidden = left <= 0;
    more.textContent = left > 0 ? "Показати ще " + Math.min(left, SVC_STEP) + " з " + left : "";
  }

  function moreServices() {
    if (!V._pkg) return;
    V._svcLimit = Math.min(V._svcLimit + SVC_STEP, V._pkg.sv.length);
    drawServices(V._pkg);
  }

  /* Показник для плитки в термометрі. Одиниця там ЖОРСТКО «на 10 тис.», а не
     плаваюча, як у блоці «Фактично надано»: термометр існує, щоб порівнювати
     пакети між собою, а порівняння в різних одиницях — не порівняння. */
  function headline(mult) {
    const d = V._pkg;
    if (!d) return null;
    const tc = targetCells(d);
    const den = denominator(tc.cells);
    if (!den) return null;
    const full = d.months.filter((m) => d.partial.indexOf(m) === -1);
    const svc = full.reduce((s, m) => s + d.m[m][0], 0);
    return {
      rate: svc / den * (mult || 10000),
      den: den,
      services: svc,
      months: full.length,
      target: targetLabel(tc.cells),
    };
  }

  /* ── Друга шкала: інтенсивність ────────────────────────────────
     Температура міряє МАСШТАБ (покриття, мережа, гроші). Інтенсивність —
     інша величина, і в ту саму формулу її класти не можна: неонатальний
     скринінг дає 732 послуги на 10 тис. дітей при чотирьох лабораторіях на
     країну, тобто був би «гарячим» при мінімальному масштабі.

     Місце рахуємо серед пакетів ПМГ, за якими у вивантажці є обсяги. Правило
     цільової групи тут те саме, що й скрізь (targetCells), тому в index.json
     лежить сирий розподіл «стать × вік», а не готовий показник: два незалежні
     обчислення рано чи пізно розійшлися б.  */
  function rateOfEntry(entry, mult) {
    if (!entry || !entry.d || !entry.s) return null;
    const wrapped = { d: {} };
    Object.keys(entry.d).forEach((c) => { wrapped.d[c] = [entry.d[c], 0]; });
    const tc = targetCells(wrapped);
    const den = denominator(tc.cells);
    if (!den) return null;
    return { rate: entry.s / den * mult, den: den, target: targetLabel(tc.cells) };
  }

  function intensity(mult) {
    const d = V._pkg;
    if (!d || !V.index || !V.demo) return null;
    const M = mult || 10000;
    const pool = V.index.packages
      .filter((e) => e.program === "Програма медичних гарантій")
      .map((e) => ({ p: e.p, name: e.name, r: rateOfEntry(e, M) }))
      .filter((e) => e.r)
      .sort((a, b) => b.r.rate - a.r.rate);
    const i = pool.findIndex((e) => e.p === d.p);
    if (i === -1) return null;
    const me = pool[i];
    return {
      rate: me.r.rate,
      den: me.r.den,
      target: me.r.target,
      rank: i + 1,
      total: pool.length,
      // Позиція на шкалі — за місцем, а не за значенням: показники розтягнуті
      // на пʼять порядків, і на лінійній шкалі всі, крім двох найбільших,
      // злиплися б у лівому краю
      pct: pool.length > 1 ? (1 - i / (pool.length - 1)) * 100 : 100,
      top: pool[0],
      bottom: pool[pool.length - 1],
      unitMult: M,
    };
  }

  window.Volumes = {
    boot: boot,
    headline: headline,
    intensity: intensity,
    // Для Excel-звіту: сирі дані пакета, демографія і правило цільової групи
    data: function () { return V._pkg; },
    demo: function () { return V.demo; },
    meta: function () { return V.index; },
    target: function () {
      const d = V._pkg;
      if (!d) return null;
      const tc = targetCells(d);
      return { cells: tc.cells, share: tc.share, label: targetLabel(tc.cells),
               den: denominator(tc.cells),
               denOf: (o) => denominator(tc.cells, o) };
    },
    fmt: { num: num, dec: dec, shortNum: shortNum },
    render: render,
    mapMetric: mapMetric,
    moreServices: moreServices,
    setUnit: function (u) { V.unit = u; },
    hasData: function () { return Boolean(V._pkg); },
    state: V,
  };
})();
