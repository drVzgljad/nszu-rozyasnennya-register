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
    // Ці два не мають власної версії в імені, тому просимо браузер звірятися
    // з сервером (no-cache — це перевірка свіжості, а не відмова від кешу)
    const opt = { cache: "no-cache" };
    const [idx, demo] = await Promise.all([
      fetch("data/volumes/index.json", opt).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("data/demography.json", opt).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    V.index = idx;
    V.demo = demo;
    return Boolean(idx);
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
    return {
      val: (o) => rate[o] || 0,
      txt: (o) => (rate[o] ? dec(rate[o], rate[o] < 10 ? 1 : 0) : ""),
      tip: (o) => (rate[o] != null && dens[o]
        ? dec(rate[o], rate[o] < 10 ? 1 : 0) + " послуг " + unit.short +
          " — " + num(vol[o] || 0) + " послуг на " + num(dens[o]) + " осіб цільової групи"
        : "знаменника немає"),
      legend: "Число в області — послуг " + unit.short + " цільової групи (" +
              targetLabel(tc.cells) + ") за " + ov.months + " міс. Знаменник — активні " +
              "декларації ПМД станом на " + (V.demo ? dmy(V.demo.declarations_updated) : "—") +
              ". " + placeWarning(d, vol),
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
  function renderMonths(d) {
    const box = el("volMonths");
    const full = d.months.filter((m) => d.partial.indexOf(m) === -1);
    const max = Math.max.apply(null, [1].concat(full.map((m) => d.m[m][0])));
    const first = d.m[full[0]] ? d.m[full[0]][0] : 0;
    const last = d.m[full[full.length - 1]] ? d.m[full[full.length - 1]][0] : 0;
    const trend = first ? (last - first) / first * 100 : 0;
    const mn = (m) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];

    const bars = d.months.map((m) => {
      const v = d.m[m][0];
      const partial = d.partial.indexOf(m) !== -1;
      const h = Math.min(Math.max(2, v / max * 100), 100);
      const tip = partial
        ? mn(m) + ": " + num(v) + " — місяць обрізаний, не показник"
        : mn(m) + ": " + num(v) + " послуг · " + num(d.m[m][1]) + " медзаписів";
      return '<div class="vm-col' + (partial ? " partial" : "") + '" title="' + esc(tip) + '">' +
        '<span class="vm-val">' + (partial ? "" : shortNum(v)) + "</span>" +
        '<div class="vm-bar" style="height:' + h.toFixed(1) + '%"></div>' +
        '<span class="vm-lbl">' + mn(m) + "</span></div>";
    }).join("");

    const trendTxt = full.length > 1
      ? "Від " + mn(full[0]) + " до " + mn(full[full.length - 1]) + " обсяг " +
        (trend > 3 ? "виріс" : (trend < -3 ? "впав" : "тримається рівно")) +
        (Math.abs(trend) > 3 ? " на " + dec(Math.abs(trend), 0) + " %" : "") + "."
      : "";
    box.innerHTML = '<div class="vm-bars">' + bars + "</div>" +
      '<p class="vm-note">' + trendTxt +
      (d.partial.length ? " Штрихований стовпчик — обрізаний хвіст вивантажки." : "") + "</p>";
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

  window.Volumes = {
    boot: boot,
    render: render,
    mapMetric: mapMetric,
    moreServices: moreServices,
    setUnit: function (u) { V.unit = u; },
    hasData: function () { return Boolean(V._pkg); },
    state: V,
  };
})();
