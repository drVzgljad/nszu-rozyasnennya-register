/* ══════════════ ПАНЕЛЬ «ЯК ПРАЦЮЄ ПАКЕТ» ══════════════
   Верхній рівень вкладки «Аналітика та ЗОЗ». Каталог показників і пороги
   лампочок — D:\pmg-data\27_панель_пакета\ПОКАЗНИКИ.md.

   ПРИНЦИП (домовленість із користувачем): спершу загальна картина — картки зі
   спідометрами, КАРТА і загальні діаграми; таблиці, переліки й реєстр джерел
   розкриваються лише за потреби (<details>).

   Будова відповідає самому пакету: Умови → Мережа → Гроші → Робота → Доступ.
   Сходи: країна → область → громада → населений пункт → заклад. Крок униз —
   клік по карті, по стовпчику зрізу чи по області на діаграмі доступу; карта і
   панель синхронні (map-drill.js). Останній щабель — паспорт закладу, лише для
   авторизованих.

   ОДНЕ ДЖЕРЕЛО ЗРІЗУ. Мережа й гроші на всіх щаблях рахуються з panel.json
   (ті самі рядки, що малює карта), обсяги — з volumes/pkg_N.json по
   областях і з Supabase нижче області.
   ──────────────────────────────────────────────────────────────── */
(() => {
"use strict";

const P = { EDRPOU: 0, NAME: 1, OBL: 2, SETTLE: 3, X: 4, Y: 5,
            OWN: 6, NET: 7, HCODE: 8, HNAME: 9 };
const NO_HROM = "∅";                      // заклади без прив'язки до громади
const NET_LABEL = { 3: "Надкластерний", 2: "Кластерний", 1: "Загальний", 0: "Поза мережею" };
const OWN_ORDER = ["Комунальна", "Державна", "Приватна (без ФОП)", "ФОП", "Інші орг.-правові форми"];
const OWN_SHORT = { "Комунальна": "комунальні", "Державна": "державні",
  "Приватна (без ФОП)": "приватні", "ФОП": "ФОП", "Інші орг.-правові форми": "інші" };
const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const MONTH_FULL = ["січень", "лютий", "березень", "квітень", "травень", "червень",
                    "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];
const MONTH_GEN = ["січня", "лютого", "березня", "квітня", "травня", "червня",
                   "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* passportState оголошено через const у passport.js: це спільна глобальна
   область класичних скриптів, але НЕ властивість window. */
const ST = () => (typeof passportState !== "undefined" ? passportState : {});

/* ── Числа українською ─────────────────────────────────────────── */
const NB = "\u00a0";
function num(v) { return Math.round(v || 0).toLocaleString("uk-UA"); }
function dec(v, d) {
  return (v || 0).toLocaleString("uk-UA", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function pct(v, d) { return dec(v, d == null ? 1 : d) + NB + "%"; }
function money(v) {
  if (!v) return "—";
  if (v >= 1e9) return dec(v / 1e9, 2) + NB + "млрд" + NB + "₴";
  if (v >= 1e6) return dec(v / 1e6, v >= 1e8 ? 0 : 1) + NB + "млн" + NB + "₴";
  if (v >= 1e3) return dec(v / 1e3, 0) + NB + "тис." + NB + "₴";
  return num(v) + NB + "₴";
}
/** Нормативна ставка з постанови — рівно як у джерелі, дві цифри після коми
 *  (921,82 ₴, а не 922 ₴). money() з його «тис./млн» для ставок не годиться:
 *  він створений для сум договорів і оплат. */
function rate(v) { return dec(v, 2) + NB + "₴"; }
/** Коефіцієнт друкуємо з точністю джерела (до 4 знаків), без добивання нулями. */
function coefTxt(v) { return (v || 0).toLocaleString("uk-UA", { maximumFractionDigits: 4 }); }
function big(v) {
  if (v >= 1e6) return dec(v / 1e6, 1) + NB + "млн";
  if (v >= 1e4) return dec(v / 1e3, 0) + NB + "тис.";
  return num(v);
}
const PR = new Intl.PluralRules("uk-UA");
function plural(n, one, few, many) {
  const f = PR.select(Math.round(n));
  return f === "one" ? one : f === "few" ? few : many;
}
const nProv = (n) => num(n) + NB + plural(n, "надавач", "надавачі", "надавачів");
/** «191 послуга», «1,2 млн послуг» — після «тис./млн» завжди родовий. */
const svc = (v) => big(v) + NB + (v >= 1e4 ? "послуг" : plural(v, "послуга", "послуги", "послуг"));

/* ── Статистика ────────────────────────────────────────────────── */
function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return 0;
  const i = (sortedAsc.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (i - lo);
}
const median = (a) => quantile(a, 0.5);

/** Скільки найбільших отримувачів разом дають ≥ 80 % суми. */
function core80(sortedAsc, total) {
  let acc = 0, k = 0;
  for (let i = sortedAsc.length - 1; i >= 0; i--) {
    acc += sortedAsc[i];
    k++;
    if (acc >= total * 0.8) break;
  }
  return { count: k, share: sortedAsc.length ? k / sortedAsc.length * 100 : 0 };
}

/** Коефіцієнт Джині: 0 — усім порівну, 1 — усе в одного. */
function gini(sortedAsc) {
  const n = sortedAsc.length;
  if (n < 2) return null;
  let s = 0, w = 0;
  sortedAsc.forEach((x, i) => { s += x; w += (i + 1) * x; });
  return s ? (2 * w) / (n * s) - (n + 1) / n : null;
}

/* ── Стан ──────────────────────────────────────────────────────── */
const A = {
  pkg: null,
  panel: null,
  items: [],                          // [{pi, sum, q}] унікальні надавачі пакета
  scope: { obl: null, hrom: null, place: null },
  hromCount: new Map(),               // область → скільки громад у геометрії
  cmp: null, docStatus: null,         // ставки й монітор редакцій
  access: null,                       // {signedIn, role} — null, поки не перевіряли
  pvol: null, pvolPkg: null,          // обсяги по закладах (Supabase)
  pay: null, payPkg: null, payTried: null, // фактичні оплати (таблиця ДІТ), data/payments/pkg_N.json
  cases: null, casesPkg: null, casesTried: null, // випадки ЕСОЗ (пілот): data/cases/pkg_N.json
  provPk: null,                       // pi → [[пакет, сума]]
  showAll: false,
  zozPi: null,
  loading: null,
  urlApplied: false,
  syncing: false,
};

/* ── Дані ──────────────────────────────────────────────────────── */
function getJson(url) {
  return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

function ensurePanel() {
  if (A.panel) return Promise.resolve(A.panel);
  const p = window.MapDrill && window.MapDrill.ensurePanel
    ? window.MapDrill.ensurePanel()
    : getJson("../panel/data/panel.json");
  return p.then((d) => { A.panel = d; return d; });
}

function ensureExtras() {
  if (A.loading) return A.loading;
  A.loading = Promise.all([
    getJson("../postanova/data/comparison_2025_2026.json"),
    getJson("../postanova/data/document_status.json"),
  ]).then(([cmp, ds]) => { A.cmp = cmp; A.docStatus = ds; });
  return A.loading;
}

/* Фактичні оплати за пакетом — tools/build_payments_it.py із таблиці ДІТ.
   Гроші за ЗВІТНИМ місяцем; у файлі: tot/ytd/np по роках, m — помісячно,
   o/mo — по областях, pv — по надавачах [t×3, ytd×3], nm — назви юросіб,
   яких немає в реєстрі договорів. Вантажимо окремо: панель без них малюється. */
function loadPay(pkg) {
  const key = String(pkg);
  return getJson(`data/payments/pkg_${encodeURIComponent(key)}.json`).then((d) => {
    if (A.pkg !== key) return;
    A.pay = d;
    A.payPkg = key;
    A.payTried = key;
    draw();
  });
}

/* Випадки ЕСОЗ — 30_випадки_ЕСОЗ/build_cases.py з вигрузки «один рядок = випадок»
   (пілот 21.09.2026: пакет 7). Лише агрегати по країні й областях, без закладів.
   Файлу немає — блок не показується взагалі. */
let casesIndex = null;
function loadCases(pkg) {
  const key = String(pkg);
  if (!casesIndex) casesIndex = getJson("data/cases/_index.json").then((x) => new Set(((x && x.pkgs) || []).map(String)));
  return casesIndex.then((have) => (have.has(key) ? getJson(`data/cases/pkg_${encodeURIComponent(key)}.json`) : null)).then((d) => {
    if (A.pkg !== key) return;
    A.cases = d;
    A.casesPkg = key;
    A.casesTried = key;
    draw();
  });
}

function loadHromCount(obl) {
  if (!obl || A.hromCount.has(obl)) return Promise.resolve();
  return getJson(`../panel/data/geo/hromada/${encodeURIComponent(obl)}.json`)
    .then((g) => { A.hromCount.set(obl, g && g.units ? Object.keys(g.units).length : 0); });
}

function prepare() {
  const d = A.panel;
  const acc = new Map();
  ((d && d.links[String(A.pkg)]) || []).forEach(([pi, s]) => acc.set(pi, (acc.get(pi) || 0) + s));
  A.items = [...acc].map(([pi, sum]) => ({ pi, sum, q: d.providers[pi] })).filter((it) => it.q);
}

function providerPackages(pi) {
  if (!A.provPk) {
    A.provPk = new Map();
    Object.entries(A.panel.links).forEach(([pk, rows]) => rows.forEach(([i, s]) => {
      let a = A.provPk.get(i);
      if (!a) A.provPk.set(i, (a = []));
      a.push([pk, s]);
    }));
  }
  return A.provPk.get(pi) || [];
}

/** Пакети постанови 1808, з якими порівнюємо (реімбурсація й пілоти — ні). */
function validPkgs() {
  return new Set((ST().packages || []).map((p) => String(p.number)));
}

/* ── Доступ ────────────────────────────────────────────────────── */
/** Роль лише з profiles, як в auth-v2.js. Межа паспорта закладу — «не гість»:
 *  та сама, що в RLS таблиці package_provider_volumes. */
async function checkAccess() {
  const sb = window.__pmgSb;
  if (!sb) return { signedIn: false, role: "guest" };
  try {
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    if (!session) return { signedIn: false, role: "guest" };
    const { data: prof } = await sb.from("profiles").select("role").eq("id", session.user.id).single();
    return { signedIn: true, role: (prof && prof.role) || "guest" };
  } catch (e) {
    return { signedIn: false, role: "guest" };
  }
}
const canSeeZoz = () => Boolean(A.access && A.access.signedIn && A.access.role !== "guest");

/* ── Лампочки якості даних ─────────────────────────────────────────
   Правило користувача (13.09.2026), однакове для всіх джерел:
   🟢 дані до 1 місяця · 🟡 до 3 місяців · 🔴 старші за 3 місяці · ⚪ немає даних.
   «Дата даних» — зріз джерела; для обсягів — кінець останнього повного місяця. */
const LAMP_TEXT = { ok: "актуальні", warn: "треба оновити", bad: "неактуальні", na: "немає даних" };
const LAMP_RANK = { ok: 0, na: 1, warn: 2, bad: 3 };
const LAMP_RULE = "до 1 міс. — актуальні · до 3 міс. — треба оновити · старші — неактуальні";

function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const i = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (i) return new Date(+i[1], +i[2] - 1, i[3] ? +i[3] : 1);
  return null;
}
const dmy = (d) => d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}` : "—";
const worst = (...st) => st.filter(Boolean).reduce((a, b) => (LAMP_RANK[b] > LAMP_RANK[a] ? b : a), "ok");

function monthsAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - n);
  return d;
}
function byMonths(date) {
  if (!date) return "na";
  return date >= monthsAgo(1) ? "ok" : date >= monthsAgo(3) ? "warn" : "bad";
}
function ageText(date) {
  if (!date) return "—";
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  return days < 45 ? `${num(days)} ${plural(days, "день", "дні", "днів")}` : `${dec(days / 30.44, 1)} міс.`;
}

/** Ставки: колір — за віком звірки (правило для всіх), а зміни постанови після
 *  звірки — окремим застереженням поруч, щоб не губилися. */
function ratesInfo() {
  const cmp = A.cmp, ds = A.docStatus;
  if (!cmp) return { date: null, note: "ставки постанови не завантажилися", fresh: [] };
  const meta = cmp.meta || {};
  const src = (meta.sources && meta.sources["2026"]) || {};
  const edition = parseDate(src.edition);
  const verified = new Set((meta.note || "").match(/\d{3,4}/g) || []);
  if (src.basis) verified.add(String(src.basis).split("-")[0]);
  const fresh = ((ds && ds.amendments) || []).filter((a) => {
    const nm = String(a.doc_id || "").split("-")[0];
    const eff = parseDate(a.effective_date);
    return !verified.has(nm) && eff && (!edition || eff > edition);
  });
  const lastVerified = [...verified].filter((n) => n !== "1808").sort((a, b) => +a - +b).pop();
  const list = fresh.map((a) => `№ ${String(a.doc_id).split("-")[0]} від ${a.effective_date}`).join(", ");
  return {
    date: parseDate(meta.generated),
    fresh,
    slice: `звірено ${dmy(parseDate(meta.generated))}${lastVerified ? ` (до зміни № ${lastVerified})` : ""}`,
    note: (fresh.length ? `⚠ Після звірки постанову змінювали: ${list} — ставки треба звірити. ` : "") +
      (ds && ds.checked_at ? `Монітор редакцій перевіряв zakon.rada.gov.ua ${dmy(parseDate(ds.checked_at))}.` : ""),
  };
}

function sources() {
  const st = ST();
  const cd = st.contractsData || {};
  const V = window.Volumes;
  const meta = V && V.meta ? V.meta() : null;
  const demo = V && V.demo ? V.demo() : null;
  const lastFull = meta && meta.full_months && meta.full_months.length
    ? meta.full_months[meta.full_months.length - 1] : null;
  const volEnd = lastFull ? (() => { const d = parseDate(lastFull); return new Date(d.getFullYear(), d.getMonth() + 1, 0); })() : null;
  const net = parseDate(cd.source_date), sums = parseDate(cd.sums_date);
  const decl = demo ? parseDate(demo.declarations_updated) : null;
  const spec = parseDate(st.packagesGenerated);
  const rates = ratesInfo();
  const pvEnd = A.pvol && A.pvol.period ? parseDate(A.pvol.period.to) : null;
  // Оплати — як обсяги: вік від кінця останнього ПОВНОГО звітного місяця
  const pd = payData();
  const pp = pd ? payPeriod(pd) : null;
  const payEnd = pp && pp.k ? new Date(pp.Y[pp.cur], pp.k, 0) : null;
  const payMatch = pd && pd.match_pct ? pd.match_pct[String(pp.Y[pp.cur])] : null;
  return [
    { id: "net", title: "Склад мережі (реєстр договорів)", slice: dmy(net), date: net, state: byMonths(net),
      affects: "Мережа, Гроші, карта, паспорт закладу", fix: "Оновити_договори.cmd" },
    { id: "sums", title: "Суми договорів", slice: dmy(sums), date: sums, state: byMonths(sums),
      affects: "Гроші, медіанний договір, ядро 80 %",
      fix: "вивантажка реєстру з колонкою «Сума договорів» → Оновити_договори.cmd",
      note: cd.sums_date && cd.sums_date !== cd.source_date
        ? `Суми старші за склад мережі: склад від ${cd.source_date}, суми від ${cd.sums_date}.` : "" },
    { id: "pay", title: "Фактичні оплати (таблиця ДІТ)", date: payEnd,
      state: pd ? byMonths(payEnd) : "na",
      slice: pp ? `повні місяці ${pp.Y[pp.cur]}: ${pp.span}` : "—",
      ageText: pd ? null : (A.payTried === String(A.pkg) ? "за пакетом немає" : "вантажиться"),
      affects: "Оплати, дані зрізу, паспорт закладу",
      fix: "запросити в ДІТ оновлену таблицю → tools/build_payments_it.py",
      note: pd ? `${pd.src.doc}. Гроші — за звітним місяцем${pp.tail ? `; ${pp.tail} ще оплачуються і в порівняння не входять` : ""}. ` +
        `Зшито із закладами реєстру договорів: ${payMatch != null ? pct(payMatch) : "—"} суми ${pp.Y[pp.cur]} року (решта — отримувачі, чиїх договорів у реєстрі вже немає).` : "" },
    { id: "vol", title: "Обсяги ЕСОЗ (по областях)", date: volEnd, state: meta ? byMonths(volEnd) : "na",
      slice: lastFull ? `повні місяці до ${lastFull.slice(5)}.${lastFull.slice(0, 4)}` : "—",
      affects: "Робота, Доступ", fix: "запит аналітикам за наступний місяць → 23_обсяги_демографія",
      note: meta ? `Вивантажку зібрано ${meta.generated}; вік рахується від кінця останнього повного місяця; обрізаний місяць викинуто з усіх підсумків.` : "" },
    { id: "decl", title: "Декларації ПМД (знаменник)", slice: dmy(decl), date: decl, state: demo ? byMonths(decl) : "na",
      affects: "Доступ (на населення)", fix: "23_обсяги_демографія/build_demography.py" },
    { id: "rates", title: "Ставки й коефіцієнти (постанова 1808)", slice: rates.slice, date: rates.date,
      state: byMonths(rates.date), affects: "Умови", fix: "звірити зміни → postanova/build_comparison.py", note: rates.note },
    { id: "spec", title: "Специфікації пакетів", slice: dmy(spec), date: spec, state: byMonths(spec),
      affects: "Умови: поріг входу, анатомія", fix: "перезібрати pakety/data/packages_2026.json" },
    { id: "geo", title: "Межі громад і координати", slice: "HDX (реформа 2020) + GeoNames", date: null,
      ageText: "довідник", state: "ok", affects: "карта, сходи", fix: "—",
      note: "Довідник меж і населених пунктів із часом не старіє — оновлюється при зміні адмінустрою. Точність — населений пункт, не адреса закладу." },
    ...(casesData() ? [(() => {
      const cm = casesData().meta, lastM = cm.months[cm.months.length - 1];
      const end = new Date(+lastM.slice(0, 4), +lastM.slice(5), 0);
      return { id: "cases", title: "Випадки ЕСОЗ (пілотна вигрузка)", date: end, state: byMonths(end),
        slice: `${cm.months[0]} — ${lastM}`, affects: "Випадки: розродження, результати, заклади за обсягом",
        fix: "нова вигрузка аналітиків → 30_випадки_ЕСОЗ/build_cases.py",
        note: `Вигрузка від ${cm.export}; ${cm.rows_used} із ${cm.rows} рядків (неповний місяць викинуто). ` +
          "Область — за місцем закладу. Лише агрегати по країні й областях; менше трьох закладів — показники якості приховано." };
    })()] : []),
    { id: "pvol", title: "Послуги по закладах (Supabase)", date: pvEnd,
      slice: A.pvol && A.pvol.period ? `${A.pvol.period.from} — ${A.pvol.period.to}` : "—",
      ageText: canSeeZoz() ? (A.pvol ? null : "за пакетом немає") : "лише після входу",
      state: canSeeZoz() && pvEnd ? byMonths(pvEnd) : "na",
      affects: "Робота нижче області, паспорт закладу", fix: "23_обсяги_демографія/upload_provider_volumes.py" },
  ];
}
const srcState = (list, id) => (list.find((s) => s.id === id) || {}).state || "na";

function lampHtml(state, label) {
  return `<span class="ap-lamp is-${state}" title="${esc(LAMP_TEXT[state])}">` +
    `<i aria-hidden="true"></i><span>${esc(label || LAMP_TEXT[state])}</span></span>`;
}

/* ── Зріз і щаблі ──────────────────────────────────────────────── */
function level() {
  const s = A.scope;
  return s.place ? "place" : s.hrom ? "hromada" : s.obl ? "oblast" : "country";
}

function scoped(scope) {
  const s = scope || A.scope;
  return A.items.filter((it) =>
    (!s.obl || it.q[P.OBL] === s.obl) &&
    (!s.hrom || (s.hrom === NO_HROM ? !it.q[P.HCODE] : it.q[P.HCODE] === s.hrom)) &&
    (!s.place || it.q[P.SETTLE] === s.place));
}

function oblName(o) {
  if (!o) return "";
  if (o === "М.КИЇВ") return "м. Київ";
  if (o === "М.СЕВАСТОПОЛЬ") return "м. Севастополь";
  if (o === "АВТОНОМНА РЕСПУБЛІКА КРИМ") return "АР Крим";
  const t = o.toLowerCase().replace(/(^|[-\s])(\S)/gu, (m, p, ch) => p + ch.toUpperCase());
  return t + " область";
}
function oblShort(o) { return oblName(o).replace(/ область$/, ""); }
function hromName(code, list) {
  if (code === NO_HROM) return "без прив'язки до громади";
  const it = (list || A.items).find((x) => x.q[P.HCODE] === code);
  return it ? `${it.q[P.HNAME]} громада` : "громада";
}
/** «м. ПОГРЕБИЩЕ» → «м. Погребище», «смт ТИВРІВ» → «смт Тиврів». */
function placeName(s) {
  const raw = String(s || "").trim();
  if (!raw || raw === "—") return "—";
  const m = raw.match(/^(м\.|с\.|смт|с-ще|селище)\s*(.*)$/i);
  const body = (m ? m[2] : raw).toLowerCase()
    .replace(/(^|[-\s'’])(\S)/gu, (x, p, ch) => (p === "'" || p === "’" ? p + ch : p + ch.toUpperCase()));
  return m ? `${m[1].toLowerCase()} ${body}` : body;
}
function scopeTitle(s) {
  s = s || A.scope;
  if (s.place) return placeName(s.place);
  if (s.hrom) return hromName(s.hrom);
  if (s.obl) return oblName(s.obl);
  return "Україна";
}
const CHILD_WORD = {
  country: ["область", "області", "областей"],
  oblast: ["громада", "громади", "громад"],
  hromada: ["населений пункт", "населені пункти", "населених пунктів"],
  place: ["заклад", "заклади", "закладів"],
};

/** Діти поточного щабля: ключ і назва. */
function childOf(it, lvl) {
  if (lvl === "country") return [it.q[P.OBL], oblShort(it.q[P.OBL])];
  if (lvl === "oblast") return it.q[P.HCODE] ? [it.q[P.HCODE], it.q[P.HNAME]] : [NO_HROM, "без прив'язки до громади"];
  if (lvl === "hromada") return [it.q[P.SETTLE] || "—", placeName(it.q[P.SETTLE])];
  return ["pi:" + it.pi, it.q[P.NAME]];
}

function childGroups(list, lvl) {
  const groups = new Map();
  list.forEach((it) => {
    const [k, label] = childOf(it, lvl);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { key: k, label, list: [] }));
    g.list.push(it);
  });
  return [...groups.values()].map((g) => ({ ...g, st: stats(g.list) }))
    .sort((a, b) => (b.st.total - a.st.total) || (b.st.n - a.st.n));
}

/* ── Обсяги в зрізі ────────────────────────────────────────────────
   По країні й областях — публічні агрегати volumes.js. Нижче області —
   сума по закладах із Supabase, і лише для авторизованих. */
function volData() {
  const V = window.Volumes;
  const d = V && V.data ? V.data() : null;
  return d && String(d.p) === String(A.pkg) ? d : null;
}
/** Період повних місяців вивантажки словами: «січень–липень 2026». */
function volSpan(full) {
  if (!full || !full.length) return "—";
  const a = full[0], b = full[full.length - 1];
  const mA = MONTH_FULL[+a.slice(5) - 1], mB = MONTH_FULL[+b.slice(5) - 1];
  if (a === b) return `${mA} ${a.slice(0, 4)}`;
  return a.slice(0, 4) === b.slice(0, 4)
    ? `${mA}–${mB} ${b.slice(0, 4)}` : `${mA} ${a.slice(0, 4)} – ${mB} ${b.slice(0, 4)}`;
}
/** Дата зрізу реєстру договорів — з неї береться склад мережі. */
function netDate() { return dmy(parseDate((ST().contractsData || {}).source_date)); }
/** Дата, на яку взято суми договорів (буває старша за склад мережі). */
function sumsDate() { return dmy(parseDate((ST().contractsData || {}).sums_date)); }
function volMetric(mode) {
  const V = window.Volumes;
  if (!volData() || !V.hasData || !V.hasData()) return null;
  return V.mapMetric(mode);
}
function pvKey(q) {
  const Z = window.ZozVolumes;
  return Z ? Z.providerKey({ ownership: q[P.OWN], provider_name: q[P.NAME], edrpou: q[P.EDRPOU] }) : null;
}
function pvOf(it) {
  if (!A.pvol || A.pvolPkg !== String(A.pkg)) return null;
  const r = A.pvol.map.get(pvKey(it.q));
  return r ? r.s : 0;
}
/** Послуги списку закладів: {v, how} або null, якщо показати нічим. */
function servicesOf(list, lvl, key) {
  const d = volData();
  if (lvl === "country-total" && d) return { v: d.tot[0], how: "pub" };
  if (lvl === "oblast-row" || lvl === "oblast-total") {
    const m = volMetric("vol");
    if (m) return { v: m.val(key), how: "pub" };
  }
  if (A.pvol && A.pvolPkg === String(A.pkg)) {
    return { v: list.reduce((a, it) => a + (pvOf(it) || 0), 0), how: "auth" };
  }
  return null;
}

/* ── Оплати в зрізі ────────────────────────────────────────────────
   Країна й область — підсумки таблиці ДІТ (усі отримувачі, зокрема ті, чий
   договір уже не в реєстрі). Нижче області — сума по закладах реєстру
   договорів, зшитих за ключем надавача (юрособа → ЄДРПОУ, ФОП → ПІБ). */
function payData() {
  return A.pay && A.payPkg === String(A.pkg) ? A.pay : null;
}
/** Дзеркало normName() із zoz-volumes.js і norm_name() у build_payments_it.py. */
function payNorm(s) {
  return String(s || "").replace(/[’`]/g, "'").toUpperCase().split(/\s+/).filter(Boolean).join(" ");
}
function payKey(q) {
  return q[P.OWN] === "ФОП" ? payNorm(q[P.NAME]) : String(q[P.EDRPOU] || "");
}
function payRow(it) {
  const d = payData();
  return d ? d.pv[payKey(it.q)] || null : null;
}
const PAY_ZERO = () => ({ t: [0, 0, 0], ytd: [0, 0, 0], n: [0, 0, 0], m: null, how: "items" });
/** Сума по закладах списку (кожен ключ — один раз). */
function payItems(list) {
  if (!payData()) return null;
  const res = PAY_ZERO(), seen = new Set();
  list.forEach((it) => {
    const k = payKey(it.q);
    if (seen.has(k)) return;
    seen.add(k);
    const r = payRow(it);
    if (!r) return;
    for (let i = 0; i < 3; i++) {
      res.t[i] += r[i];
      res.ytd[i] += r[3 + i];
      if (Math.abs(r[i]) >= 1) res.n[i]++;
    }
  });
  return res;
}
/** Оплати поточного зрізу або дочірньої групи: {t, ytd, n, m, how}. */
function payOf(list, lvl, key) {
  const d = payData();
  if (!d) return null;
  if (lvl === "country") return { t: d.tot, ytd: d.ytd, n: d.np, m: d.m, how: "file" };
  if (lvl === "oblast") {
    const o = d.o[key];
    return o ? { t: o.slice(0, 3), ytd: o.slice(3, 6), n: o.slice(6, 9), m: d.mo[key] || null, how: "file" }
      : { ...PAY_ZERO(), how: "file" };
  }
  return payItems(list);
}
/** «+15,7 %», «−3 %»; null — бази немає. */
function payChange(cur, base) {
  if (!base) return null;
  return (cur - base) / Math.abs(base) * 100;
}
function chgText(v) {
  if (v == null || !Number.isFinite(v)) return "";
  const a = Math.abs(v);
  return (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + pct(a, a < 10 ? 1 : 0);
}
/** Підписи періоду порівняння: «7 міс. 2026», «січень–липень». */
function payPeriod(d) {
  const Y = d.y, k = d.ytd_months, cur = Y.length - 1;
  const last = d.last[String(Y[cur])] || k;
  const tail = last > k ? MONTH_FULL.slice(k, last).join(" і ") : "";
  return {
    Y, k, cur,
    ytdLbl: k >= 12 ? `${Y[cur]} рік` : `${k} міс. ${Y[cur]}`,
    ytdPrev: k >= 12 ? `${Y[cur - 1]} рік` : `${k} міс. ${Y[cur - 1]}`,
    span: k >= 1 ? `січень–${MONTH_FULL[k - 1]}` : "—",
    tail,
  };
}

function stats(list) {
  const sums = list.map((it) => it.sum).filter((v) => v > 0).sort((a, b) => a - b);
  const total = sums.reduce((a, b) => a + b, 0);
  const own = {}, net = { 0: 0, 1: 0, 2: 0, 3: 0 };
  list.forEach((it) => {
    const o = it.q[P.OWN] || "Інші орг.-правові форми";
    own[o] = (own[o] || 0) + 1;
    net[it.q[P.NET] || 0]++;
  });
  return {
    n: list.length, total, withSum: sums.length, sums,
    med: median(sums), q1: quantile(sums, 0.25), q3: quantile(sums, 0.75),
    core: core80(sums, total), gini: gini(sums),
    inNet: list.length - net[0], net, own,
    places: new Set(list.map((it) => it.q[P.SETTLE])).size,
    hroms: new Set(list.map((it) => it.q[P.HCODE]).filter(Boolean)).size,
    obls: new Set(list.map((it) => it.q[P.OBL])).size,
  };
}

/** Гроші й мережа 46 пакетів — для місця пакета в черзі. */
function bench() {
  const valid = validPkgs();
  const pk = (A.panel && A.panel.packages) || {};
  const rows = Object.entries(pk).filter(([n]) => valid.has(n))
    .map(([n, v]) => ({ n, sum: v.sum || 0, prov: v.providers || 0 }));
  const V = window.Volumes;
  const meta = V && V.meta ? V.meta() : null;
  const vols = ((meta && meta.packages) || []).filter((e) => e && e.s && valid.has(String(e.p)))
    .map((e) => ({ n: String(e.p), s: e.s }));
  return { rows, vols, totalSum: rows.reduce((a, r) => a + r.sum, 0) };
}
const rankIn = (arr, v) => 1 + arr.filter((x) => x > v).length;
const behindPct = (arr, v) => { const rk = rankIn(arr, v); return arr.length > 1 ? (arr.length - rk) / (arr.length - 1) * 100 : 100; };

/* ── Примітиви малювання: чистий SVG/HTML, без бібліотек ─────────── */

/** Спідометр — вибір користувача (скіл pmg-dashboard, налаштування
 *  «вимірювач»). Правила, без яких він бреше: підписані мінімум і максимум,
 *  зони одного тону з назвами в підказках, стрілка І число під віссю, риска
 *  порівняння, компактний розмір (не більший за картку). */
function gaugeSvg(o) {
  const W = 190, H = 118, cx = 95, cy = 92, R = 78, r0 = 58;
  const min = o.min == null ? 0 : o.min, max = o.max == null ? 100 : o.max;
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const ang = (v) => Math.PI * (1 - (clamp(v) - min) / ((max - min) || 1));
  const pt = (a, rr) => [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  const f = (x) => x.toFixed(2);
  const band = (v1, v2, rOut, rIn) => {
    const [x1, y1] = pt(ang(v1), rOut), [x2, y2] = pt(ang(v2), rOut);
    const [x3, y3] = pt(ang(v2), rIn), [x4, y4] = pt(ang(v1), rIn);
    return `M${f(x1)},${f(y1)} A${rOut},${rOut} 0 0 1 ${f(x2)},${f(y2)} L${f(x3)},${f(y3)} A${rIn},${rIn} 0 0 0 ${f(x4)},${f(y4)} Z`;
  };
  const zones = (o.zones || [[min, max, ""]]).map((z, i) =>
    `<path d="${band(z[0], z[1], R, r0)}" class="ap-gz z${o.zoneCls ? o.zoneCls[i] : i}"><title>${esc(z[2] || "")}</title></path>`).join("");
  const has = o.value != null && Number.isFinite(o.value);
  const a = ang(has ? o.value : min);
  const [nx, ny] = pt(a, R - 4);
  const [bx1, by1] = pt(a + Math.PI / 2, 3.2), [bx2, by2] = pt(a - Math.PI / 2, 3.2);
  const needle = has
    ? `<path d="M${f(bx1)},${f(by1)} L${f(nx)},${f(ny)} L${f(bx2)},${f(by2)} Z" class="ap-gn"/><circle cx="${cx}" cy="${cy}" r="5.5" class="ap-gh"/>`
    : "";
  let tick = "";
  if (o.target != null) {
    const [t1x, t1y] = pt(ang(o.target), r0 - 4), [t2x, t2y] = pt(ang(o.target), R + 5);
    tick = `<line x1="${f(t1x)}" y1="${f(t1y)}" x2="${f(t2x)}" y2="${f(t2y)}" class="ap-gt"><title>${esc(o.targetLabel || "")}</title></line>`;
  }
  const lbl = (v) => (o.fmt ? o.fmt(v) : num(v));
  return `<figure class="ap-gauge" role="img" aria-label="${esc(o.aria || "")}">
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
        ${zones}${tick}${needle}
        <text x="${f(cx - (R + r0) / 2)}" y="${cy + 15}" class="ap-gl" text-anchor="middle">${esc(o.minLabel || lbl(min))}</text>
        <text x="${f(cx + (R + r0) / 2)}" y="${cy + 15}" class="ap-gl" text-anchor="middle">${esc(o.maxLabel || lbl(max))}</text>
        <text x="${cx}" y="${cy + 23}" class="ap-gv" text-anchor="middle">${esc(has ? o.valueText : "—")}</text>
      </svg>
      ${o.caption ? `<figcaption>${o.caption}</figcaption>` : ""}
    </figure>`;
}

function sparkSvg(vals, o) {
  o = o || {};
  const W = o.w || 160, H = o.h || 30, pad = 3;
  if (!vals.length) return "";
  const max = Math.max(...vals, 1);
  const x = (i) => pad + (vals.length > 1 ? i / (vals.length - 1) : 0.5) * (W - 2 * pad);
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = vals.length - 1;
  return `<svg class="ap-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="M${x(0).toFixed(1)},${H - pad}${d.replace(/^M/, "L")}L${x(last).toFixed(1)},${H - pad}Z" class="ap-spark-a"/>
      <path d="${d}" class="ap-spark-l"/><circle cx="${x(last).toFixed(1)}" cy="${y(vals[last]).toFixed(1)}" r="2.6" class="ap-spark-d"/>
    </svg>`;
}

/** Лінія за місяцями: вісь від нуля, підписи прямо на точках. */
function lineSvg(points, o) {
  o = o || {};
  const W = 560, H = 210, L = 46, R = 16, T = 16, B = 30;
  if (!points.length) return "";
  const max = Math.max(...points.map((p) => p.v), 1) * 1.12;
  const x = (i) => L + (points.length > 1 ? i / (points.length - 1) : 0.5) * (W - L - R);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, 0.5, 1].map((k) => max / 1.12 * k);
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="ap-grid"/>
      <text x="${L - 6}" y="${(y(t) + 4).toFixed(1)}" class="ap-axis" text-anchor="end">${esc(big(t))}</text>`).join("");
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const dots = points.map((p, i) => `<g><circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.2" class="ap-line-d"/>
      <title>${esc(p.label)}: ${esc(num(p.v))}</title>
      <text x="${x(i).toFixed(1)}" y="${H - 10}" class="ap-axis" text-anchor="middle">${esc(p.short)}</text></g>`).join("");
  const lastI = points.length - 1;
  return `<svg class="ap-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "")}">
      ${grid}<path d="${d}" class="ap-line-l"/>${dots}
      <text x="${x(lastI).toFixed(1)}" y="${(y(points[lastI].v) - 9).toFixed(1)}" class="ap-line-v" text-anchor="end">${esc(big(points[lastI].v))}</text>
    </svg>`;
}

/** Короткі гроші для осей: «2,6 млрд», «340 млн». */
function moneyAxis(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return dec(v / 1e9, a >= 1e10 ? 0 : 1) + NB + "млрд";
  if (a >= 1e6) return dec(v / 1e6, 0) + NB + "млн";
  if (a >= 1e3) return dec(v / 1e3, 0) + NB + "тис.";
  return num(v);
}

/** Оплати за місяцями, рік до року: три лінії на одній осі січень–грудень.
 *  Поточний рік — лише повні місяці: неповні занизили б криву й збрехали про спад. */
function yearLinesSvg(series, o) {
  o = o || {};
  // ширина viewBox = реальна ширина місця: інакше на телефоні підписи стискаються до 6 px
  const W = Math.round(Math.max(300, Math.min(640, o.w || 640)));
  const narrow = W < 460;
  const H = narrow ? 200 : 232, L = narrow ? 50 : 58, R = narrow ? 40 : 54, T = 14, B = 30;
  const all = series.flatMap((s) => s.vals);
  if (!all.length) return "";
  const max = Math.max(...all, 1) * 1.1;
  const x = (i) => L + i / 11 * (W - L - R);
  const y = (v) => T + (1 - Math.max(v, 0) / max) * (H - T - B);
  const ticks = [0, 0.5, 1].map((k) => max / 1.1 * k);
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="ap-grid"/>
      <text x="${L - 6}" y="${(y(t) + 4).toFixed(1)}" class="ap-axis" text-anchor="end">${esc((o.axisFmt || moneyAxis)(t))}</text>`).join("");
  const months = MONTHS.map((m, i) => (narrow && i % 2 ? "" : `<text x="${x(i).toFixed(1)}" y="${H - 10}" class="ap-axis" text-anchor="middle">${m}</text>`)).join("");
  // підписи років біля кінців ліній — розводимо, щоб не налазили
  const ends = series.filter((s) => s.vals.length).map((s) => ({ s, i: s.vals.length - 1, yy: y(s.vals[s.vals.length - 1]) }))
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) {
    if (Math.abs(ends[i].i - ends[i - 1].i) < 2 && ends[i].yy - ends[i - 1].yy < 13) ends[i].yy = ends[i - 1].yy + 13;
  }
  const lines = series.map((s) => {
    if (!s.vals.length) return "";
    const d = s.vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const dots = s.vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${s.main ? 3.2 : 2.4}" class="ap-yl-d ${s.cls}">
        <title>${esc(MONTH_FULL[i])} ${s.year}: ${esc((o.tipFmt || money)(v))}</title></circle>`).join("");
    return `<g class="ap-yl ${s.cls}"><path d="${d}" class="ap-yl-l"/>${dots}</g>`;
  }).join("");
  const labels = ends.map((e) => `<text x="${(x(e.i) + 7).toFixed(1)}" y="${(e.yy + 4).toFixed(1)}" class="ap-yl-t ${e.s.cls}">${e.s.year}</text>`).join("");
  return `<svg class="ap-line ap-years" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "")}">
      ${grid}${months}${lines}${labels}
    </svg>`;
}

/** Крива концентрації (Лоренца): частка надавачів → частка СУМИ ДОГОВОРІВ. */
function lorenzSvg(sortedAsc, total) {
  const W = 260, H = 200, L = 34, R = 10, T = 10, B = 28;
  const n = sortedAsc.length;
  if (n < 2 || !total) return "";
  const x = (fr) => L + fr * (W - L - R);
  const y = (fr) => T + (1 - fr) * (H - T - B);
  let acc = 0;
  const pts = [[0, 0]];
  const step = Math.max(1, Math.floor(n / 120));
  sortedAsc.forEach((v, i) => {
    acc += v;
    if (i % step === 0 || i === n - 1) pts.push([(i + 1) / n, acc / total]);
  });
  const d = pts.map(([a, b], i) => `${i ? "L" : "M"}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join("");
  const c = core80(sortedAsc, total);
  const fx = 1 - c.count / n;                       // звідки починається ядро
  return `<svg class="ap-lorenz" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Крива концентрації: ${esc(num(c.count))} найбільших із ${esc(num(n))} мають 80 % суми договорів">
      <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="ap-diag"/>
      <rect x="${x(fx).toFixed(1)}" y="${T}" width="${(x(1) - x(fx)).toFixed(1)}" height="${H - T - B}" class="ap-core-zone"><title>ядро: заклади, на які разом припадає 80 % суми договорів</title></rect>
      <path d="${d}" class="ap-lorenz-l"/>
      <line x1="${L}" x2="${W - R}" y1="${y(0.2).toFixed(1)}" y2="${y(0.2).toFixed(1)}" class="ap-grid"/>
      <text x="${L - 4}" y="${(y(0.2) + 3).toFixed(1)}" class="ap-axis" text-anchor="end">20%</text>
      <text x="${x(0)}" y="${H - 8}" class="ap-axis">менші</text>
      <text x="${x(1)}" y="${H - 8}" class="ap-axis" text-anchor="end">більші →</text>
    </svg>`;
}

/** Смуга часток (100 %) з підписами прямо на сегментах. */
function shareBarHtml(parts, total) {
  const t = total || parts.reduce((a, p) => a + p.v, 0);
  if (!t) return "";
  return `<div class="ap-share" role="img" aria-label="${esc(parts.map((p) => `${p.label} ${num(p.v)}`).join(", "))}">` +
    parts.filter((p) => p.v > 0).map((p) => {
      const w = p.v / t * 100;
      return `<i class="ap-seg ${p.cls || ""}" style="width:${w.toFixed(2)}%" title="${esc(p.label)}: ${esc(num(p.v))} (${esc(pct(w))})">` +
        (w >= 14 ? `<span>${esc(p.short || p.label)} ${esc(pct(w, 0))}</span>` : "") + `</i>`;
    }).join("") + `</div>`;
}
const ownShares = (own) => shareBarHtml(OWN_ORDER.map((k) => ({ label: k, short: OWN_SHORT[k], v: own[k] || 0, cls: "own-" + OWN_ORDER.indexOf(k) })));

/* ── Шапка і стежка ────────────────────────────────────────────── */
function lampSummary(srcs) {
  const cnt = { ok: 0, warn: 0, bad: 0, na: 0 };
  srcs.forEach((s) => cnt[s.state]++);
  return ["ok", "warn", "bad", "na"].filter((k) => cnt[k]).map((k) => lampHtml(k, `${cnt[k]} ${LAMP_TEXT[k]}`)).join(" ");
}

function renderHead(srcs) {
  const box = $("apHead");
  if (!box) return;
  const pkg = ST().selectedPackage || {};
  box.innerHTML = `
    <div class="ap-titlebox">
      <h3>Як працює пакет ${esc(pkg.number || A.pkg)}</h3>
      <p class="ap-lead">Умови → мережа → гроші → робота → доступ. Клік по карті чи стовпчику — крок униз, до закладу; дані розкриваються нижче за потреби.</p>
    </div>
    <button type="button" class="ap-pill" data-ap-open="apQualityDetails" title="Якість даних: ${esc(LAMP_RULE)}">
      <span class="ap-pill-h">Якість даних</span>${lampSummary(srcs)}
    </button>`;
  const qs = $("apQualitySum");
  if (qs) qs.innerHTML = lampSummary(srcs);
}

function renderLadder() {
  const box = $("apLadder");
  if (!box) return;
  const s = A.scope;
  const steps = [{ label: "Україна", scope: { obl: null, hrom: null, place: null } }];
  if (s.obl) steps.push({ label: oblName(s.obl), scope: { obl: s.obl, hrom: null, place: null } });
  if (s.hrom) steps.push({ label: hromName(s.hrom), scope: { obl: s.obl, hrom: s.hrom, place: null } });
  if (s.place) steps.push({ label: placeName(s.place), scope: { ...s } });
  const next = { country: "області", oblast: "громади", hromada: "населені пункти", place: "заклади — паспорт закладу" }[level()];
  box.innerHTML = steps.map((st, i) => i === steps.length - 1
    ? `<span class="ap-crumb is-now" aria-current="location">${esc(st.label)}</span>`
    : `<button type="button" class="ap-crumb" data-ap-scope='${esc(JSON.stringify(st.scope))}'>${esc(st.label)}</button><span class="ap-sep" aria-hidden="true">›</span>`)
    .join("") + `<span class="ap-next">далі — ${esc(next)}${s.obl ? " · Esc — щабель вище" : ""}</span>`;
}

/* ── Ланцюжок із п'яти карток ──────────────────────────────────── */
function card(o) {
  return `<article class="ap-link" data-ap-go="${esc(o.go || "")}" tabindex="0" role="button" aria-label="${esc(o.name)}: ${esc(o.plain || "")}">
      <header class="ap-link-h"><span class="ap-link-n">${esc(o.step)}</span><span class="ap-link-name">${esc(o.name)}</span>${lampHtml(o.lamp, LAMP_TEXT[o.lamp])}</header>
      <div class="ap-link-v">${o.value}</div>
      ${o.gauge || ""}
      ${o.base ? `<p class="ap-link-s">${o.base}</p>` : ""}
      ${o.more ? `<details class="ap-link-more"><summary>детально</summary><div>${o.more}</div></details>` : ""}
    </article>`;
}

function pkgRates() {
  if (!A.cmp) return null;
  const k = String(A.pkg);
  const rows = (A.cmp.rates || []).filter((r) => (r.packages || []).includes(k));
  return {
    rows,
    base: rows.filter((r) => r.base),
    kinds: [...new Set(rows.map((r) => r.kind).filter((x) => x && x !== "Інше"))],
    coef: (A.cmp.coefficients || []).filter((g) => (g.packages || []).includes(k)),
    drg: (A.cmp.drg || []).filter((d) => (d.packages || []).includes(k)),
  };
}

/** Як платять — лише з типів ставок, що є в постанові для цього пакета.
 *  Якщо типів кілька (пакет 9: ставка за послугу + глобальна), пишемо обидва,
 *  а не вигадуємо механізм. */
function payHint(r) {
  const has = (re) => r.kinds.some((k) => re.test(k));
  if (has(/глобальн/i) && has(/послуг|пролікован/i)) {
    return "глобальна ставка на період; ставка " + (has(/пролікован/i) ? "за випадок" : "за послугу") + " — база її розрахунку";
  }
  if (has(/глобальн/i)) return "фіксована сума на період, а не плата за кожну послугу";
  if (has(/капітац/i)) return "ставка на одного пацієнта за період (капітація)";
  if (has(/пролікован/i)) return r.drg.length ? "за пролікований випадок: базова ставка × ваговий коефіцієнт ДСГ" : "за кожен пролікований випадок";
  if (has(/послуг/i)) return "за кожну надану медичну послугу";
  return "за ставками глави — див. вкладку «Оплата»";
}

/** Поріг входу: скільки вимог специфікації (обладнання + організація + кадри)
 *  проти 46 пакетів — та сама міра, що вісь «Поріг входу» в анатомії. */
function entryGate() {
  const an = ST().anatomy && ST().anatomy.pkgs;
  if (!an || !an[String(A.pkg)]) return null;
  const valid = validPkgs();
  const val = (a) => (a.eq || 0) + (a.org || 0) + (a.kadr || 0);
  const all = Object.entries(an).filter(([n]) => valid.has(n)).map(([, a]) => val(a)).sort((a, b) => a - b);
  const mine = val(an[String(A.pkg)]);
  const below = all.filter((v) => v < mine).length;
  return { mine, pctl: all.length > 1 ? below / (all.length - 1) * 100 : 50, n: all.length, buys: an[String(A.pkg)].buys };
}

function conditionsCard(list, st, srcs) {
  const r = pkgRates();
  const lamp = worst(srcState(srcs, "rates"), srcState(srcs, "spec"));
  if (!r) return card({ step: "1", name: "Умови", lamp: "na", value: "—", base: "ставки постанови не завантажилися", go: "" });
  const base = r.base.find((x) => x.v2026 > 1) || r.base[0];
  const kind = (base && base.kind) || r.kinds[0] || "ставка";
  // Ставку НЕ проганяємо через money(): той округлює і стискає в «тис./млн»,
  // і 921,82 ₴ ставало «922 ₴». Поруч — пункт постанови, з якого вона взята.
  const point = base && base.point2026 ? `п. ${String(base.point2026)}` : "";
  const value = base && base.v2026 > 1
    ? `${esc(rate(base.v2026))} <small>${esc(kind.toLowerCase())}${base.qualifier && base.qualifier.length < 30 ? " " + esc(base.qualifier) : ""}${point ? " · " + esc(point) : ""}</small>`
    : `<small>${esc(kind)}${base && base.qualifier ? " — " + esc(base.qualifier) : ""}</small>`;
  const delta = base && base.delta_pct != null && base.v2025
    ? (Math.abs(base.delta_pct) < 0.05 ? "ставка та сама, що у 2025" : `до 2025: ${base.delta_pct > 0 ? "+" : ""}${pct(base.delta_pct)}`)
    : (base && base.status === "only-2026" ? "нова в 2026" : "");
  const gate = entryGate();
  // Шкали «легкий—важкий» за кількістю пунктів специфікації тут більше немає:
  // це міра довжини переліку вимог (і парсингу документа), а не вартості
  // обладнання, кадрової складності чи виконання вимог. Саме число лишилося
  // в «детально» з методикою. Спідометр натомість показує зміну САМОЇ ставки
  // до 2025 року — та сама норма, та сама одиниця, тож порівняння чесне.
  // Малюємо, лише якщо ставка справді змінилася: з 44 базових ставок 34 такі
  // самі, що й у 2025, і спідометр на нулі був би порожнім місцем. Шкала
  // −70…+30 покриває весь фактичний розмах (пакет 42: −61,7 %; пакет 2: +22,4 %),
  // тож стрілка нікуди не впирається.
  const dp = base && base.delta_pct != null && base.v2025 && Math.abs(base.delta_pct) >= 0.05 ? base.delta_pct : null;
  const gauge = dp != null ? gaugeSvg({
    value: dp, min: -70, max: 30, target: 0, targetLabel: "рівень 2025 року",
    fmt: (v) => (v > 0 ? "+" : "") + dec(v, 0) + NB + "%",
    minLabel: `−70${NB}%`, maxLabel: `+30${NB}%`,
    zones: [[-70, 0, "нижча, ніж у 2025"], [0, 30, "вища, ніж у 2025"]], zoneCls: [3, 3],
    valueText: `${dp > 0 ? "+" : "−"}${pct(Math.abs(dp))}`,
    aria: `ставка 2026 проти 2025: ${dec(dp, 1)} відсотка`,
    caption: "ставка 2026 до ставки 2025 · риска — рівень 2025",
  }) : "";
  const vr = ST().volReq && ST().volReq.packages ? ST().volReq.packages[String(A.pkg)] : null;
  const rule = vr && vr.rules && vr.rules[0] ? vr.rules[0] : null;
  const rates = ratesInfo();
  const more = [
    `<b>Як платять:</b> ${esc(payHint(r))}${delta ? ` · ${esc(delta)}` : ""}`,
    `<span class="ap-note">Пояснення скорочене: ставка — не вся формула оплати${point ? `; базова ставка — ${esc(point)}` : ""}. Коригувальні коефіцієнти, умови надання й винятки — у пунктах глави.</span>`,
    r.kinds.length > 1 ? `Типи ставок: ${esc(r.kinds.join(", "))}` : "",
    r.coef.length ? `${r.coef.length} ${plural(r.coef.length, "група", "групи", "груп")} коригувальних коефіцієнтів` : "коригувальних коефіцієнтів немає",
    // Коефіцієнти — з точністю джерела: у постанові трапляється 11,0813
    r.drg.length ? `${r.drg.length} ДСГ, вагові коефіцієнти ${esc(coefTxt(Math.min(...r.drg.map((d) => d.w2026 || Infinity))))}–${esc(coefTxt(Math.max(...r.drg.map((d) => d.w2026 || 0))))}` : "",
    gate ? `Пакет купує: <b>${esc(gate.buys)}</b>` : "",
    rule ? `<b>Поріг обсягу (норма):</b> не менше ${esc(num(rule.value))} ${esc(rule.unit)} за ${esc(rule.period)}` : "",
    gate ? `Вимоги специфікації: <b>${esc(num(gate.mine))}</b> ${esc(plural(gate.mine, "структурований пункт", "структуровані пункти", "структурованих пунктів"))} (обладнання, організація, кадри). Це довжина переліку вимог у тексті специфікації, а не оцінка складності, вартості входу чи відповідності надавача; із нормативним порогом обсягу вище не плутати.` : "",
    rates.fresh.length ? `<span class="ap-warn-inline">${esc(rates.note)}</span>` : "",
    `<a href="#" data-ap-go="tariffs" class="ap-more">формула й коефіцієнти — вкладка «Оплата» →</a>`,
  ].filter(Boolean).map((x) => `<p>${x}</p>`).join("");
  return card({ step: "1", name: "Умови", lamp, go: "tariffs", value, gauge, more,
    base: esc(payHint(r)), plain: `${kind} ${base && base.v2026 ? dec(base.v2026, 2) : ""}` });
}

function networkCard(list, st, srcs) {
  const lvl = level();
  const all = A.items.length;
  let value, gauge;
  if (lvl === "country") {
    const nets = bench().rows.map((r) => r.prov);
    const rk = rankIn(nets, all);
    value = `${esc(num(all))} <small>${plural(all, "надавач", "надавачі", "надавачів")} у ${st.obls} з 25 регіонів</small>`;
    gauge = gaugeSvg({ value: behindPct(nets, all), min: 0, max: 100, minLabel: "вузька", maxLabel: "широка",
      zones: [[0, 25, "нижня чверть пакетів"], [25, 50, "друга чверть"], [50, 75, "третя чверть"], [75, 100, "верхня чверть"]],
      valueText: `місце ${rk} із ${nets.length}`, aria: `мережа пакета: місце ${rk} із ${nets.length}`,
      caption: "ширина мережі серед пакетів постанови 1808" });
  } else {
    const where = lvl === "oblast" ? `у ${st.hroms} з ${A.hromCount.get(A.scope.obl) || "…"} громад`
      : lvl === "hromada" ? `у ${st.places} ${plural(st.places, "населеному пункті", "населених пунктах", "населених пунктах")}` : "";
    value = `${esc(num(st.n))} <small>${plural(st.n, "надавач", "надавачі", "надавачів")} ${esc(where)}</small>`;
    // частка мережі пакета проти «рівної» частки серед сусідів того самого щабля
    const parent = lvl === "oblast" ? { obl: null } : lvl === "hromada" ? { obl: A.scope.obl } : { obl: A.scope.obl, hrom: A.scope.hrom };
    const parentLvl = lvl === "oblast" ? "country" : lvl === "hromada" ? "oblast" : "hromada";
    const sibs = childGroups(scoped(parent), parentLvl);
    const maxShare = Math.max(...sibs.map((g) => g.st.n / all * 100), 1);
    const share = st.n / all * 100;
    gauge = gaugeSvg({ value: share, min: 0, max: Math.ceil(maxShare * 1.1), target: 100 / Math.max(sibs.length, 1) * (scoped(parent).length / all),
      targetLabel: "середня частка серед сусідів", fmt: (v) => pct(v, 0),
      zones: [[0, maxShare * 0.33, ""], [maxShare * 0.33, maxShare * 0.66, ""], [maxShare * 0.66, Math.ceil(maxShare * 1.1), ""]],
      valueText: pct(share, 1), aria: `частка мережі пакета ${pct(share, 1)}`,
      caption: `частка мережі пакета · риска — середня серед сусідніх ${CHILD_WORD[parentLvl][2]}` });
  }
  const fop = st.own["ФОП"] || 0;
  return card({ step: "2", name: "Мережа", lamp: srcState(srcs, "net"), go: "apMapSlot", value, gauge,
    base: `у спроможній мережі — <b>${esc(num(st.inNet))}</b> (${esc(pct(st.n ? st.inNet / st.n * 100 : 0, 0))})`,
    more: `<p>Форма власності:</p>${ownShares(st.own)}` + (fop ? `<p>ФОП — ${esc(num(fop))}</p>` : ""),
    plain: `${st.n} надавачів` });
}

function moneyCard(list, st, srcs) {
  const lvl = level();
  const lamp = worst(srcState(srcs, "sums"), srcState(srcs, "net"));
  if (!st.total) {
    return card({ step: "3", name: "Гроші", lamp: "na", go: "apMoney", value: "—",
      base: "у вивантажці договорів суми за цим пакетом відсутні", plain: "сум немає" });
  }
  const b = bench();
  const pkgTotal = A.items.reduce((a, it) => a + it.sum, 0);
  // Знаменник — сума договорів пакетів постанови в реєстрі, а НЕ весь бюджет
  // ПМГ: реімбурсація та інші компоненти програми в panel.json не входять.
  const shareTxt = lvl === "country"
    ? `${pct(b.totalSum ? st.total / b.totalSum * 100 : 0)} суми договорів пакетів · місце ${rankIn(b.rows.map((r) => r.sum), st.total)} із ${b.rows.length}`
    : `${pct(pkgTotal ? st.total / pkgTotal * 100 : 0)} суми договорів пакета`;
  const natMed = median(A.items.map((it) => it.sum).filter((v) => v > 0).sort((a, c) => a - c));
  const gauge = st.withSum > 2 ? gaugeSvg({
    value: st.core.share, min: 0, max: 100, target: 80, targetLabel: "рівний поділ: 80 % закладів",
    fmt: (v) => pct(v, 0), minLabel: "у кількох", maxLabel: "порівну",
    zones: [[0, 20, "дуже зосереджено"], [20, 50, "зосереджено"], [50, 80, "помірно"], [80, 100, "порівну"]],
    valueText: `ядро ${pct(st.core.share, 0)}`,
    aria: `${st.core.count} з ${st.withSum} закладів мають 80 % суми договорів`,
    caption: `${num(st.core.count)} з ${num(st.withSum)} закладів мають 80 % суми договорів · риска — рівний поділ` }) : "";
  const pd = payData();
  const pay = pd ? payOf(list, lvl, A.scope.obl) : null;
  const pp = pd ? payPeriod(pd) : null;
  const payLine = pay && (pay.ytd[pp.cur] || pay.t[pp.cur - 1])
    ? `<p><b>Фактично сплачено:</b> ${pp.Y[pp.cur - 1]} рік — ${esc(money(pay.t[pp.cur - 1]))}; ${esc(pp.ytdLbl)} — ${esc(money(pay.ytd[pp.cur]))}` +
      `${payChange(pay.ytd[pp.cur], pay.ytd[pp.cur - 1]) != null ? ` (${esc(chgText(payChange(pay.ytd[pp.cur], pay.ytd[pp.cur - 1])))} до ${esc(pp.ytdPrev)})` : ""}.` +
      ` <a href="#" data-ap-go="apPay" class="ap-more">оплати рік до року →</a></p>` : "";
  return card({ step: "3", name: "Гроші", lamp, go: "apMoney",
    value: `${esc(money(st.total))} <small>${esc(shareTxt)}</small>`, gauge,
    base: `сума договорів на ${esc(sumsDate())} · медіанний договір <b>${esc(money(st.med))}</b>${lvl !== "country" && natMed ? ` · ×${esc(dec(st.med / natMed, 1))} до країни` : ""}`,
    more: `<p class="ap-note">Показано законтрактовану суму, а не перераховані кошти.${lvl === "country" ? ` Частка рахується від суми договорів ${esc(num(b.rows.length))} ${plural(b.rows.length, "пакета", "пакетів", "пакетів")} постанови в реєстрі на ${esc(sumsDate())}, а не від усього бюджету ПМГ.` : ""}</p>` +
      payLine + (st.withSum > 3 ? `<p>Половина договорів — від ${esc(money(st.q1))} до ${esc(money(st.q3))}.</p><p>Джині ${st.gini == null ? "—" : esc(dec(st.gini, 2))}.</p>` : ""),
    plain: money(st.total) });
}

function workCard(list, st, srcs) {
  const lvl = level();
  const d = volData();
  const gate = entryGate();
  if (!d) {
    return card({ step: "4", name: "Робота", lamp: "na", go: "apWork", value: "—",
      base: gate && gate.buys !== "послуга"
        ? `обсяг послуг не рахується: пакет купує <b>${esc(gate.buys)}</b>, а не окремі послуги`
        : "у вивантажці ЕСОЗ послуг за цим пакетом немає", plain: "обсягів немає" });
  }
  const full = d.months.filter((m) => d.partial.indexOf(m) === -1);
  const lamp = srcState(srcs, "vol");
  if (lvl === "country") {
    const vs = bench().vols.map((v) => v.s);
    const rk = rankIn(vs, d.tot[0]);
    return card({ step: "4", name: "Робота", lamp, go: "apWork",
      value: `${esc(big(d.tot[0]))} <small>послуг за ${full.length} міс. 2026</small>`,
      gauge: gaugeSvg({ value: behindPct(vs, d.tot[0]), min: 0, max: 100, minLabel: "мало", maxLabel: "багато",
        zones: [[0, 25, "нижня чверть"], [25, 50, "друга чверть"], [50, 75, "третя чверть"], [75, 100, "верхня чверть"]],
        valueText: `місце ${rk} із ${vs.length}`, aria: `обсяг послуг: місце ${rk} із ${vs.length}`,
        caption: "обсяг послуг серед пакетів з даними ЕСОЗ" }),
      base: `${esc(svc(Math.round(d.tot[0] / Math.max(d.tot[2], 1) / full.length)))} на надавача за місяць`,
      // tot[2] — надавачі з послугами в ЕСОЗ; їх буває більше, ніж договорів у
      // реєстрі: ЕСОЗ бачить і тих, чий договір не дожив до дати реєстру.
      // Тому два незалежні твердження з періодом і датою, а не «N з M».
      more: `<p>У ЕСОЗ звітували ${esc(num(d.tot[2]))} ${plural(d.tot[2], "надавач", "надавачі", "надавачів")} за ${esc(volSpan(full))}.</p>` +
        `<p>У реєстрі договорів на ${esc(netDate())} — ${esc(num(A.items.length))} ${plural(A.items.length, "надавач", "надавачі", "надавачів")}.</p>` +
        `<p class="ap-note">Це різні зрізи: різні періоди й різні джерела, тому ділити одне на одне не можна.</p>${sparkSvg(full.map((m) => d.m[m][0]))}`,
      plain: `${d.tot[0]} послуг` });
  }
  if (lvl === "oblast") {
    const o = (d.o && d.o[A.scope.obl]) || [0, 0, 0];
    const pkgTotal = A.items.reduce((a, it) => a + it.sum, 0);
    const shS = d.tot[0] ? o[0] / d.tot[0] * 100 : 0;
    const shM = pkgTotal ? st.total / pkgTotal * 100 : 0;
    const ratio = shM ? shS / shM : null;
    // Спідометр «×0,93 — роботи менше, ніж грошей» знято: це відношення часток
    // із РІЗНИХ джерел і періодів (ЕСОЗ проти реєстру договорів), договірна сума
    // не є сплаченою, а випадки різної ресурсоємності. Оцінка ефективності з
    // нього не виводиться. Замість цього — місце області за обсягом послуг:
    // одне джерело, один період, одна одиниця.
    const oblVals = Object.values(d.o || {}).map((v) => (v && v[0]) || 0).filter((v) => v > 0).sort((a, b) => a - b);
    const rkO = rankIn(oblVals, o[0]);
    return card({ step: "4", name: "Робота", lamp, go: "apWork",
      value: `${esc(big(o[0]))} <small>послуг за ${full.length} міс.</small>`,
      gauge: o[0] > 0 && oblVals.length > 3 ? gaugeSvg({ value: behindPct(oblVals, o[0]), min: 0, max: 100,
        minLabel: "менше", maxLabel: "більше",
        zones: [[0, 25, "нижня чверть областей"], [25, 50, "друга чверть"], [50, 75, "третя чверть"], [75, 100, "верхня чверть"]],
        valueText: `місце ${rkO} із ${oblVals.length}`, aria: `обсяг послуг: місце ${rkO} із ${oblVals.length} областей`,
        caption: "обсяг послуг серед областей з даними ЕСОЗ · масштаб, не оцінка" }) : "",
      base: `у ЕСОЗ звітували <b>${esc(num(o[2]))}</b> · у реєстрі договорів — <b>${esc(num(st.n))}</b>`,
      more: `<p>ЕСОЗ: ${esc(num(o[2]))} ${plural(o[2], "надавач", "надавачі", "надавачів")} із послугами за ${esc(volSpan(full))}. Реєстр договорів на ${esc(netDate())}: ${esc(num(st.n))} ${plural(st.n, "надавач", "надавачі", "надавачів")} області.</p>` +
        `<p class="ap-note">Сукупності різні — ЕСОЗ бачить і тих, чий договір до дати реєстру вже не дожив, тому «N з M» тут не рахується.</p>` +
        (ratio != null ? `<p>Частка області: послуги — ${esc(pct(shS))}, сума договорів — ${esc(pct(shM))}.</p>` +
          `<p class="ap-note">Це опис двох часток із різних джерел і періодів, а не показник ефективності: сума договору не дорівнює сплаченому, а випадки мають різну ресурсоємність.</p>` : "") +
        sparkSvg(full.map((m) => (d.mo[m] || {})[A.scope.obl] || 0)),
      plain: `${o[0]} послуг` });
  }
  const sv = servicesOf(list, "below");
  return card({ step: "4", name: "Робота", lamp: sv ? lamp : "na", go: "apWork",
    value: sv ? `${esc(big(sv.v))} <small>послуг за ${full.length} міс.</small>` : "—",
    base: sv ? "сума по закладах зрізу (Supabase)" : "нижче області обсяги — по закладах, їх видно лише після входу",
    plain: sv ? `${sv.v} послуг` : "після входу" });
}

function accessCard(list, st, srcs) {
  const m = volMetric("rate");
  const lamp = worst(srcState(srcs, "vol"), srcState(srcs, "decl"));
  if (!m) {
    return card({ step: "5", name: "Доступ", lamp: "na", go: "apAccess", value: "—",
      base: "без обсягів послуг показник «на населення» не рахується", plain: "не рахується" });
  }
  const oblasts = [...new Set(A.items.map((it) => it.q[P.OBL]))];
  const vals = oblasts.map((o) => ({ o, v: m.val(o) })).filter((x) => x.v > 0).sort((a, b) => a.v - b.v);
  const unit = (m.unit && m.unit.short) || "";
  // Точкова мережа: обсяг кількох центрів ділиться на населення їхніх областей,
  // а лікують вони всю країну — «розрив між областями» тут не читається взагалі
  if (vals.length < 15) {
    return card({ step: "5", name: "Доступ", lamp, go: "apAccess",
      value: `${vals.length} <small>${plural(vals.length, "регіон", "регіони", "регіонів")} з обсягами — мережа точкова</small>`,
      base: "показник «на населення» не читається: центри лікують пацієнтів з усієї країни",
      plain: `${vals.length} регіонів` });
  }
  const med = median(vals.map((x) => x.v));
  const low = vals.filter((x) => m.conf && m.conf(x.o) === "low").length;
  // Розрив — стійкою мірою Q3/Q1 без областей із ненадійним знаменником: відношення
  // крайніх бреше (пакет 3 давав «×95», пакет 64 — «×270» через одну область)
  const reliable = vals.filter((x) => !(m.conf && m.conf(x.o) === "low"));
  const base = reliable.length >= 4 ? reliable : vals;
  const asc = base.map((x) => x.v);
  const q1 = quantile(asc, 0.25), q3 = quantile(asc, 0.75);
  const eq = q1 > 0 ? q3 / q1 : asc[asc.length - 1] / asc[0];
  const mine = A.scope.obl ? vals.find((x) => x.o === A.scope.obl) : null;
  if (A.scope.obl) {
    const r = mine ? mine.v / med : null;
    return card({ step: "5", name: "Доступ", lamp, go: "apAccess",
      value: mine ? `${esc(m.txt(A.scope.obl))} <small>послуг ${esc(unit)} цільової групи</small>` : "—",
      gauge: r != null ? gaugeSvg({ value: r, min: 0, max: 2, target: 1, targetLabel: "медіана областей",
        fmt: (v) => "×" + dec(v, 0), zones: [[0, 0.8, "нижче за типову область"], [0.8, 1.2, "як типова область"], [1.2, 2, "вище за типову"]],
        zoneCls: [0, 2, 1], valueText: `×${dec(r, 2)}`, aria: `інтенсивність до медіани областей ${dec(r, 2)}`,
        caption: "інтенсивність проти медіани областей" }) : "",
      base: mine ? (m.conf && m.conf(A.scope.obl) === "low" ? "⚠ знаменник області ненадійний (*)" : "знаменник надійний")
        : "в області обсягів немає",
      more: `<p>Область — місце надавача, а не проживання пацієнта.${level() === "hromada" || level() === "place" ? " Знаменник є лише по областях, тому показано область." : ""}</p>`,
      plain: mine ? `${m.txt(A.scope.obl)} ${unit}` : "—" });
  }
  return card({ step: "5", name: "Доступ", lamp, go: "apAccess",
    value: `×${esc(dec(eq, 1))} <small>верхня чверть областей проти нижньої</small>`,
    gauge: gaugeSvg({ value: eq, min: 1, max: 3, fmt: (v) => "×" + dec(v, 0), minLabel: "×1", maxLabel: "×3+",
      zones: [[1, 1.3, "майже рівно"], [1.3, 2, "помірний розрив"], [2, 3, "великий розрив"]], zoneCls: [0, 1, 2],
      valueText: `×${dec(eq, 1)}`, aria: `розрив між областями ${dec(eq, 1)}`,
      caption: `розрив інтенсивності між областями${low ? " (без областей з *)" : ""}` }),
    base: `медіана областей — <b>${esc(dec(med, med < 10 ? 1 : 0))}</b> послуг ${esc(unit)}`,
    more: `<p>Крайні області — ×${esc(dec(vals[vals.length - 1].v / vals[0].v, 0))}.${low ? ` ${low} ${plural(low, "область", "області", "областей")} із ненадійним знаменником (*) у розрив не входять.` : ""}</p><p>Область — місце надавача, а не проживання пацієнта.</p>`,
    plain: `розрив ${dec(eq, 1)}` });
}

function renderChain(list, st, srcs) {
  const box = $("apChain");
  if (!box) return;
  const parts = [conditionsCard, networkCard, moneyCard, workCard, accessCard].map((fn) => {
    try { return fn(list, st, srcs); } catch (e) { console.warn("панель: картка не намалювалась —", e); return ""; }
  });
  box.innerHTML = parts.join('<span class="ap-arrow" aria-hidden="true">→</span>');
}

/* ── Зріз поруч із картою: де гроші (загальний графік, клік — крок униз) ── */
const KIDS_TOP = 10;

function renderKids(list, st) {
  const box = $("apKids");
  if (!box) return;
  const lvl = level();
  const word = CHILD_WORD[lvl];
  let rows;
  if (lvl === "place") {
    rows = [...list].sort((a, b) => b.sum - a.sum).map((it) => ({ key: "pi:" + it.pi, pi: it.pi, label: it.q[P.NAME], st: { total: it.sum, n: 1 } }));
  } else {
    rows = childGroups(list, lvl);
  }
  if (!rows.length) { box.innerHTML = `<p class="ap-empty">У цьому зрізі закладів за пакетом немає.</p>`; return; }
  const top = rows.slice(0, KIDS_TOP);
  const maxS = Math.max(...top.map((r) => r.st.total), 1);
  const lead3 = rows.slice(0, 3).reduce((a, r) => a + r.st.total, 0);
  const title = st.total
    ? (rows.length > 3
      ? `${rows.length} ${word[plural(rows.length, 0, 1, 2)] || word[2]}: перші три — ${pct(lead3 / st.total * 100, 0)} суми договорів`
      : `${rows.length} ${plural(rows.length, word[0], word[1], word[2])}`)
    : `${rows.length} ${plural(rows.length, word[0], word[1], word[2])}`;
  box.innerHTML = `
    <header class="ap-card-h">
      <h4>${esc(scopeTitle())}: ${esc(title)}</h4>
      <p class="ap-prov">${lvl === "place" ? "Клік — паспорт закладу" : "Клік — крок униз"} · смуга — сума договорів, число праворуч — закладів</p>
    </header>
    <ol class="ap-kids">${top.map((r) => {
      const attr = r.pi != null ? `data-ap-zoz="${r.pi}"` : `data-ap-child="${esc(r.key)}"`;
      return `<li ${attr} tabindex="0" title="${esc(r.label)}">
        <span class="ap-rname">${esc(r.label)}</span>
        <span class="ap-kbar"><i style="width:${(r.st.total / maxS * 100).toFixed(1)}%"></i></span>
        <b>${esc(money(r.st.total))}</b>
        <span class="ap-kn">${r.pi != null ? esc(OWN_SHORT[(A.panel.providers[r.pi] || [])[P.OWN]] || "") : esc(num(r.st.n))}</span>
      </li>`;
    }).join("")}</ol>
    ${rows.length > KIDS_TOP ? `<button type="button" class="ap-link-btn" data-ap-open="apDataDetails">усі ${rows.length} — у даних зрізу нижче</button>` : ""}`;
}

/* ── Дані зрізу: таблиця (розкривається за потреби) ────────────── */
const TOP_ROWS = 12;

function renderSteps(list, st) {
  const box = $("apSteps");
  if (!box) return;
  const lvl = level();
  const cd = ST().contractsData || {};
  const rate = lvl === "country" ? volMetric("rate") : null;
  const authVol = A.pvol && A.pvolPkg === String(A.pkg);
  const svcHead = lvl === "country" ? "Послуг" : "Послуг" + (authVol ? "" : " 🔒");
  // Фактичні оплати: минулий рік цілком і повні місяці поточного (рік до року)
  const pd = payData();
  const pp = pd ? payPeriod(pd) : null;
  const payHead = pp ? `<th scope="col" class="n" title="${esc(pd.src.doc)}">Сплачено ${pp.Y[pp.cur - 1]}</th>
      <th scope="col" class="n" title="${esc(`порівняння з ${pp.ytdPrev}`)}">Сплачено, ${esc(pp.ytdLbl)}</th>` : "";
  const payCells = (t, ytdCur, ytdPrev) => {
    if (!pp) return "";
    const ch = payChange(ytdCur, ytdPrev);
    return `<td class="n">${esc(money(t))}</td>
      <td class="n">${esc(money(ytdCur))}${ch != null ? ` <small class="${ch >= 0 ? "up" : "down"}">${esc(chgText(ch))}</small>` : ""}</td>`;
  };
  const payCols = pp ? 2 : 0;
  let head, body, count;

  if (lvl === "place") {
    const rows = [...list].sort((a, b) => b.sum - a.sum);
    count = rows.length;
    const pkgTotal = A.items.reduce((a, it) => a + it.sum, 0);
    head = `<th scope="col">Заклад</th><th scope="col">Власність</th><th scope="col">Мережа</th>
      <th scope="col" class="n">Сума договору</th><th scope="col" class="n">Частка пакета</th>${payHead}<th scope="col" class="n">${svcHead}</th>`;
    body = rows.map((it) => {
      const sv = pvOf(it);
      const r = pp ? payRow(it) : null;
      return `<tr data-ap-zoz="${it.pi}" tabindex="0" title="Відкрити паспорт закладу">
        <th scope="row"><span class="ap-rname">${esc(it.q[P.NAME])}</span><span class="ap-go">паспорт →</span></th>
        <td>${esc(OWN_SHORT[it.q[P.OWN]] || it.q[P.OWN] || "—")}</td>
        <td>${esc(NET_LABEL[it.q[P.NET] || 0])}</td>
        <td class="n">${esc(money(it.sum))}</td>
        <td class="n">${esc(pct(pkgTotal ? it.sum / pkgTotal * 100 : 0, 2))}</td>
        ${pp ? (r ? payCells(r[pp.cur - 1], r[3 + pp.cur], r[3 + pp.cur - 1]) : '<td class="n">—</td><td class="n">—</td>') : ""}
        <td class="n">${sv == null ? '<span class="ap-lock">після входу</span>' : esc(num(sv))}</td></tr>`;
    }).join("");
  } else {
    const rows = childGroups(list, lvl);
    count = rows.length;
    const maxN = Math.max(...rows.map((r) => r.st.n), 1);
    const maxS = Math.max(...rows.map((r) => r.st.total), 1);
    const what = { country: "Область", oblast: "Громада", hromada: "Населений пункт" }[lvl];
    head = `<th scope="col">${what}</th><th scope="col" class="n">Надавачів</th><th scope="col" class="n">Сума договорів</th>
      <th scope="col" class="n" title="Медіанний договір і його відношення до медіани рівня вище">Медіанний договір</th>
      ${payHead}<th scope="col" class="n">У спроможній мережі</th><th scope="col" class="n">${svcHead}</th>` +
      (rate ? `<th scope="col" class="n" title="${esc("послуг " + ((rate.unit && rate.unit.short) || "") + " цільової групи")}">На населення</th>` : "");
    const shown = A.showAll ? rows : rows.slice(0, TOP_ROWS);
    body = shown.map((r) => {
      const sv = servicesOf(r.list, lvl === "country" ? "oblast-row" : "below", r.key);
      const idx = st.med && r.st.med ? r.st.med / st.med : null;
      const pr = pp ? (lvl === "country" ? payOf(r.list, "oblast", r.key) : payItems(r.list)) : null;
      return `<tr data-ap-child="${esc(r.key)}" tabindex="0" title="Крок униз: ${esc(r.label)}">
        <th scope="row"><span class="ap-rname">${esc(r.label)}</span><span class="ap-go">↘</span></th>
        <td class="n"><span class="ap-cellbar"><i style="width:${(r.st.n / maxN * 100).toFixed(1)}%"></i></span>${esc(num(r.st.n))}</td>
        <td class="n"><span class="ap-cellbar is-money"><i style="width:${(r.st.total / maxS * 100).toFixed(1)}%"></i></span>${esc(money(r.st.total))}
          <small>${esc(pct(st.total ? r.st.total / st.total * 100 : 0, 1))}</small></td>
        <td class="n">${esc(money(r.st.med))}${idx != null && r.st.withSum >= 3 ? ` <small class="${idx >= 1 ? "up" : "down"}">×${esc(dec(idx, 1))}</small>` : ""}</td>
        ${pr ? payCells(pr.t[pp.cur - 1], pr.ytd[pp.cur], pr.ytd[pp.cur - 1]) : ""}
        <td class="n">${esc(pct(r.st.n ? r.st.inNet / r.st.n * 100 : 0, 0))}</td>
        <td class="n">${sv == null ? '<span class="ap-lock">після входу</span>' : esc(big(sv.v))}</td>` +
        (rate ? `<td class="n">${esc(rate.txt(r.key) || "—")}</td>` : "") + `</tr>`;
    }).join("");
    if (rows.length > TOP_ROWS) {
      body += `<tr class="ap-more-row"><td colspan="${(rate ? 7 : 6) + payCols}">
        <button type="button" class="ap-link-btn" data-ap-all="1">${A.showAll ? "згорнути до " + TOP_ROWS : `показано ${TOP_ROWS} з ${rows.length} — показати всі`}</button></td></tr>`;
    }
  }
  const cnt = $("apDataCount");
  if (cnt) cnt.textContent = `${scopeTitle()}: ${count} ${plural(count, CHILD_WORD[lvl][0], CHILD_WORD[lvl][1], CHILD_WORD[lvl][2])}`;
  const svTotal = lvl === "country" ? servicesOf(list, "country-total")
    : lvl === "oblast" ? servicesOf(list, "oblast-total", A.scope.obl) : servicesOf(list, "below");
  const payTotal = pp ? payOf(list, lvl, A.scope.obl) : null;
  box.innerHTML = `
    <header class="ap-card-h">
      <h4>${esc(scopeTitle())}: ${esc(nProv(st.n))} · договори ${esc(money(st.total))}${payTotal ? ` · сплачено ${esc(money(payTotal.ytd[pp.cur]))} за ${esc(pp.ytdLbl)}` : ""}${svTotal ? ` · ${esc(big(svTotal.v))} послуг` : ""}</h4>
      <p class="ap-prov">Реєстр договорів від ${esc(cd.source_date || "—")}; суми від ${esc(cd.sums_date || "—")};
        громада — за координатою населеного пункту (HDX).${pp ? ` Оплати — ${esc(pd.src.short)}, за звітним місяцем; ${lvl === "country" ? "у рядках областей — усі отримувачі області" : "у рядках — сума по закладах реєстру договорів"}.` : ""}${lvl === "country" ? "" : " Послуги нижче області — сума по закладах із Supabase, лише після входу."}</p>
    </header>
    <div class="ap-table-wrap"><table class="ap-table">
      <thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${7 + payCols}" class="ap-empty">У цьому зрізі закладів за пакетом немає.</td></tr>`}</tbody>
    </table></div>`;
}

/* ── Гроші: концентрація ───────────────────────────────────────── */
/* ── Випадки ЕСОЗ: як розроджують і з яким результатом (пілот) ──────
   Питання блока: скільки пологів і в якій динаміці до того самого періоду
   минулого року; яка частка кесаревих проти медіани закладів чи країни;
   які результати (мертвонародження, передчасні, кровотечі, летальні);
   як потрапляють до закладу; скільки лежать; як обсяг розподілений між
   закладами; чи можна вірити записам. Дані — лише агрегати по країні й
   областях (30_випадки_ЕСОЗ/build_cases.py). */
function casesData() {
  return A.cases && A.casesPkg === String(A.pkg) ? A.cases : null;
}
/** «січень 2025 – серпень 2026» з "2025-01", "2026-08". */
function monthSpan(a, b) {
  const f = (s) => `${MONTH_FULL[+s.slice(5) - 1]} ${s.slice(0, 4)}`;
  return `${f(a)} – ${f(b)}`;
}
/** «січень–серпень» для одного року. */
function monthSpanShort(a, b) {
  const f = (s) => MONTH_FULL[+s.slice(5) - 1];
  return a.slice(0, 4) === b.slice(0, 4) ? `${f(a)}–${f(b)}` : `${f(a)} ${a.slice(0, 4)} – ${f(b)} ${b.slice(0, 4)}`;
}
const per = (a, b, k) => (b ? a / b * k : null);

function renderCases() {
  const box = $("apCases");
  if (!box) return;
  const row = box.closest(".ap-row");
  const d = casesData();
  if (!d) {
    // файлу за пакетом немає — блок не займає місця
    if (row) row.hidden = A.casesTried === String(A.pkg);
    if (A.casesTried !== String(A.pkg)) box.innerHTML = '<div class="ap-skel"><i></i><i></i><i></i></div>';
    return;
  }
  if (row) row.hidden = false;
  const M = d.meta, ms = M.months, ua = d.scopes.UA;
  const lvl = level();
  const key = lvl === "country" ? "UA" : A.scope.obl;
  const c = d.scopes[key];
  const span = monthSpan(ms[0], ms[ms.length - 1]);
  const prov = `ЕСОЗ, вигрузка випадків від ${esc(dmy(parseDate(M.export)))} (пілот) · ${esc(span)}` +
    (M.dropped ? ` · ${esc(MONTH_FULL[+M.dropped.month.slice(5) - 1])} ${M.dropped.month.slice(0, 4)} неповний — не враховано` : "") +
    " · область — за місцем закладу, не проживання пацієнтки";
  if (lvl === "hromada" || lvl === "place") {
    box.innerHTML = `<header class="ap-card-h"><h4>Випадки: ${esc(scopeTitle())}</h4><p class="ap-prov">${prov}</p></header>
      <p class="ap-empty">Пілотна вигрузка розкладена лише до області закладу. Нижче області випадки можна показати тільки по закладах — це окремий закритий шар, його ще не підключено.</p>`;
    return;
  }
  if (!c) {
    box.innerHTML = `<header class="ap-card-h"><h4>Випадки: ${esc(scopeTitle())}</h4><p class="ap-prov">${prov}</p></header>
      <p class="ap-empty">У вигрузці немає випадків, наданих закладами цієї області.</p>`;
    return;
  }
  const ytdCh = c.ytd[1] ? (c.ytd[0] / c.ytd[1] - 1) * 100 : null;
  const ytdSpan = monthSpanShort(M.ytd.cur[0], M.ytd.cur[1]);
  const ytdTxt = ytdCh == null ? "" :
    `; за ${ytdSpan} ${M.ytd.cur[0].slice(0, 4)} — ${num(c.ytd[0])}, ${chgText(ytdCh)} до того самого періоду ${M.ytd.base[0].slice(0, 4)}`;
  const csShare = c.mode ? per(c.mode.cs || 0, c.n, 100) : null;
  const title = `${num(c.n)} ${plural(c.n, "випадок пологів", "випадки пологів", "випадків пологів")} за ${span}${ytdTxt}` +
    (csShare != null ? `; кесарів розтин — ${pct(csShare)}` : "");

  // двадцять місяців → лінії «рік до року» на одній осі
  const years = [...new Set(ms.map((m) => m.slice(0, 4)))];
  const series = years.map((y, i) => ({
    year: y, cls: i === years.length - 1 ? "is-cur" : i === years.length - 2 ? "is-prev" : "is-old",
    main: i === years.length - 1,
    vals: ms.map((m, j) => [m, c.m[j]]).filter(([m]) => m.startsWith(y)).map(([, v]) => v),
  }));
  const line = yearLinesSvg(series, {
    aria: `Випадки пологів за місяцями, ${years.join(" і ")}`, w: 560,
    axisFmt: (v) => big(v), tipFmt: (v) => `${num(v)} ${plural(v, "випадок", "випадки", "випадків")}`,
  });

  if (c.small) {
    box.innerHTML = `<header class="ap-card-h"><h4>${esc(scopeTitle())}: ${esc(title)}</h4><p class="ap-prov">${prov}</p></header>
      <p class="ap-sub">Випадки за місяцями</p>${line}
      <p class="ap-empty">Пологи в цій області приймає ${c.prov === 1 ? "один заклад" : `${c.prov} заклади`}: обласні показники якості збіглися б із показниками конкретного закладу, тому тут їх не показуємо.</p>`;
    return;
  }

  // спідометри: порівняння — з медіаною закладів (країна) або з країною (область)
  const isUA = key === "UA";
  const still = per(c.still, c.n, 1000), stillUA = per(ua.still, ua.n, 1000);
  const pre = per(c.pre, c.n, 100), preUA = per(ua.pre, ua.n, 100);
  const csUA = per(ua.mode.cs || 0, ua.n, 100);
  const pcs = c.pcs;
  const gauges = [
    gaugeSvg({
      value: csShare, min: 0, max: 50, fmt: (v) => pct(v, 0),
      zones: [[0, 15, "до 15 %"], [15, 30, "15–30 %"], [30, 50, "понад 30 %"]],
      target: isUA ? (pcs ? pcs.med : null) : csUA,
      targetLabel: isUA ? "медіана закладів" : "Україна",
      valueText: csShare == null ? "—" : pct(csShare),
      aria: `Кесарів розтин ${csShare == null ? "—" : pct(csShare)}`,
      caption: `<b>Кесарів розтин</b><br>${isUA
        ? (pcs ? `медіана закладів ${esc(pct(pcs.med))}, у половини — від ${esc(pct(pcs.q1, 0))} до ${esc(pct(pcs.q3, 0))}` : "")
        : `Україна — ${esc(pct(csUA))}${pcs ? `; медіана закладів області ${esc(pct(pcs.med))}` : ""}`}`,
    }),
    gaugeSvg({
      value: still, min: 0, max: 12, fmt: (v) => dec(v, 0),
      zones: [[0, 4, "до 4 на 1 000"], [4, 8, "4–8 на 1 000"], [8, 12, "понад 8 на 1 000"]],
      target: isUA ? null : stillUA, targetLabel: "Україна",
      valueText: still == null ? "—" : dec(still, 1) + NB + "‰",
      aria: `Мертвонародження ${still == null ? "—" : dec(still, 1)} на 1 000 пологів`,
      caption: `<b>Мертвонародження на 1 000 пологів</b><br>${esc(num(c.still))} ${plural(c.still, "випадок", "випадки", "випадків")}${isUA ? "" : ` · Україна — ${esc(dec(stillUA, 1))}‰`}`,
    }),
    gaugeSvg({
      value: pre, min: 0, max: 10, fmt: (v) => pct(v, 0),
      zones: [[0, 5, "до 5 %"], [5, 8, "5–8 %"], [8, 10, "понад 8 %"]],
      target: isUA ? null : preUA, targetLabel: "Україна",
      valueText: pre == null ? "—" : pct(pre),
      aria: `Передчасні пологи ${pre == null ? "—" : pct(pre)}`,
      caption: `<b>Передчасні пологи</b><br>${esc(num(c.pre))} із ${esc(num(c.n))}${isUA ? "" : ` · Україна — ${esc(pct(preUA))}`}`,
    }),
    gaugeSvg({
      value: c.los.med, min: 0, max: 8, fmt: (v) => dec(v, 0),
      zones: [[0, 3, "до 3 днів"], [3, 5, "3–5 днів"], [5, 8, "понад 5 днів"]],
      target: isUA ? null : ua.los.med, targetLabel: "Україна",
      valueText: `${dec(c.los.med, 0)}${NB}${plural(c.los.med, "день", "дні", "днів")}`,
      aria: `Медіана тривалості госпіталізації ${dec(c.los.med, 0)} днів`,
      caption: `<b>Госпіталізація, медіана днів</b><br>самостійні — ${esc(dec(c.los.med_v, 0))}, кесарів — ${esc(dec(c.los.med_c, 0))} · довше 30 днів: ${esc(num(c.los.gt30))}`,
    }),
  ].join("");

  const modeBar = shareBarHtml([
    { label: "Самостійні", short: "самостійні", v: c.mode.sp || 0, cls: "own-0" },
    { label: "Щипці або вакуум", short: "щипці/вакуум", v: c.mode.inst || 0, cls: "own-1" },
    { label: "Кесарів розтин", short: "кесарів", v: c.mode.cs || 0, cls: "own-2" },
    { label: "Інші, зокрема багатоплідні", short: "інші", v: c.mode.oth || 0, cls: "own-4" },
  ], c.n);
  const a = c.adm || {};
  const admBar = shareBarHtml([
    { label: "Звернулася сама", short: "сама", v: a.self || 0, cls: "own-0" },
    { label: "За направленням", short: "направлення", v: (a.eref || 0) + (a.paper || 0), cls: "own-1" },
    { label: "Бригадою екстреної допомоги", short: "ЕМД", v: a.ems || 0, cls: "own-2" },
    { label: "Переведено з іншого відділення або закладу", short: "переведення", v: (a.dept || 0) + (a.zoz || 0), cls: "own-3" },
    { label: "Доставлено третіми особами та інше", short: "інше", v: (a.third || 0) + (a.other || 0), cls: "own-4" },
  ], c.n);
  const plan = per(c.plan, c.n, 100);

  // результати: по країні — разом із летальними; в області летальних не показуємо (одиниці)
  const outs = [
    ["Мертвонародження (хоча б одна дитина)", c.still],
    ["Післяпологова кровотеча", c.pph],
    ["Багатоплідні пологи", c.multi],
    ["Переведено в інший заклад", c.tr_out],
    ["Пішла всупереч рекомендаціям", c.ama],
  ];
  if (isUA) outs.unshift(["Летальні випадки", ua.died]);
  const outMax = Math.max(...outs.map(([, v]) => v), 1);
  const outsHtml = `<ol class="ap-cbars is-res">${outs.map(([l, v]) => `<li title="${esc(l)}: ${esc(num(v))} (${esc(dec(per(v, c.n, 1000), 2))} на 1 000 пологів)">
      <span class="ap-rname">${esc(l)}</span><span class="ap-kbar"><i style="width:${Math.max(1, v / outMax * 100).toFixed(1)}%"></i></span>
      <b>${esc(num(v))}</b><small>${esc(dec(per(v, c.n, 1000), 1))}‰</small></li>`).join("")}</ol>`;

  // заклади за обсягом пологів — знеособлено
  const binsRows = c.bins.map((b) => (b.hid
    ? `<tr><th>${esc(b.k)}</th><td class="n">${esc(num(b.prov))}</td><td class="n" colspan="4">${b.prov ? "приховано: менше трьох закладів" : "—"}</td></tr>`
    : `<tr><th>${esc(b.k)}</th><td class="n">${esc(num(b.prov))}</td><td class="n">${esc(num(b.n))}</td>
        <td class="n">${b.cs == null ? "—" : esc(pct(b.cs))}</td><td class="n">${b.still == null ? "—" : esc(dec(b.still, 1))}</td><td class="n">${b.los == null ? "—" : esc(dec(b.los, 0))}</td></tr>`)).join("");
  const smallN = c.bins.filter((b) => b.k === "<100" || b.k === "100–299").reduce((acc, b) => acc + (b.prov || 0), 0);
  const binsHtml = `<details class="ap-inline-more"><summary>заклади за кількістю пологів у 2025 році${smallN ? ` · ${num(smallN)} ${plural(smallN, "заклад", "заклади", "закладів")} мають менше 300 пологів на рік` : ""}</summary>
      <div class="ap-table-wrap"><table class="ap-table">
        <thead><tr><th>Пологів за рік</th><th class="n">Закладів</th><th class="n">Пологів</th><th class="n">Кесарів</th><th class="n">Мертвонар., ‰</th><th class="n">Днів, медіана</th></tr></thead>
        <tbody>${binsRows}</tbody></table></div>
      <p class="ap-sub">Без поправки на ризик: великі перинатальні центри приймають складніші випадки, тож вищі показники в них не означають гіршої допомоги. Показники окремих закладів тут не публікуються.</p></details>`;

  // області — лише на рівні країни, клік = крок униз
  let oblHtml = "";
  if (isUA) {
    const rows = Object.entries(d.scopes).filter(([k]) => k !== "UA").map(([o, v]) => ({ o, v }))
      .sort((x, y) => y.v.n - x.v.n);
    oblHtml = `<details class="ap-inline-more"><summary>області · ${rows.length}</summary>
      <div class="ap-table-wrap"><table class="ap-table">
        <thead><tr><th>Область закладу</th><th class="n">Випадків</th><th class="n">${esc(ytdSpan)} до ${M.ytd.base[0].slice(0, 4)}</th><th class="n">Кесарів</th><th class="n">Мертвонар., ‰</th><th class="n">Передч., %</th><th class="n">Днів</th></tr></thead>
        <tbody>${rows.map(({ o, v }) => {
          const ch = v.ytd[1] ? (v.ytd[0] / v.ytd[1] - 1) * 100 : null;
          const qcells = v.small
            ? '<td class="n" colspan="4">менше трьох закладів — не публікуються</td>'
            : `<td class="n">${esc(pct(per(v.mode.cs || 0, v.n, 100)))}</td><td class="n">${esc(dec(per(v.still, v.n, 1000), 1))}</td><td class="n">${esc(pct(per(v.pre, v.n, 100)))}</td><td class="n">${esc(dec(v.los.med, 0))}</td>`;
          return `<tr data-ap-child="${esc(o)}" data-ap-lvl="country" tabindex="0" title="${esc(oblShort(o))} — крок униз">
            <th>${esc(oblShort(o))}</th><td class="n">${esc(num(v.n))}</td><td class="n">${ch == null ? "—" : esc(chgText(ch))}</td>${qcells}</tr>`;
        }).join("")}</tbody></table></div></details>`;
  }

  const qa = M.qa || {};
  const qaHtml = isUA ? `<details class="ap-inline-more"><summary>якість записів у вигрузці</summary>
      <ul class="ap-qa-list">
        <li>Діагноз кесаревого розтину без самої операції в записі — <b>${esc(num(qa.dx_no_proc || 0))}</b>; операція без такого діагнозу — <b>${esc(num(qa.proc_no_dx || 0))}</b>.</li>
        <li>Одна пацієнтка двічі в одному місяці, ймовірні дублі записів — <b>${esc(num(qa.dup_same_month || 0))}</b>.</li>
        <li>Госпіталізація довша за 30 днів — <b>${esc(num(qa.los_gt30 || 0))}</b>; тип епізоду не «Лікування» — <b>${esc(num(qa.ep_atypical || 0))}</b>.</li>
        <li>Унікальних пацієнток — <b>${esc(num(ua.pat))}</b> на ${esc(num(ua.n))} випадків; із двома й більше пологами за період — ${esc(num(ua.rep))}.</li>
      </ul></details>` : "";

  box.innerHTML = `
    <header class="ap-card-h">
      <h4>${esc(scopeTitle())}: ${esc(title)}</h4>
      <p class="ap-prov">${prov} · кесарів розтин — основний діагноз O82 або O84.2; мертвонародження — Z37.1, .3, .4, .6, .7 у супутніх · без поправки на ризик</p>
    </header>
    <div class="ap-cases-g">${gauges}</div>
    <div class="ap-cases">
      <div><p class="ap-sub">Випадки за місяцями</p>${line}</div>
      <div>
        <p class="ap-sub">Як розроджено</p>${modeBar}
        <p class="ap-sub">Як потрапили до закладу · планових госпіталізацій ${esc(pct(plan))}</p>${admBar}
        <p class="ap-sub">Результати й ускладнення · на 1 000 пологів</p>${outsHtml}
      </div>
    </div>
    ${binsHtml}${oblHtml}${qaHtml}`;
}

function renderMoney(list, st) {
  const box = $("apMoney");
  if (!box) return;
  if (st.withSum < 3) {
    box.innerHTML = `<header class="ap-card-h"><h4>Концентрація сум договорів</h4></header>
      <p class="ap-empty">${st.withSum ? "Закладів із сумою менше трьох — частки тут нічого не пояснюють, важать конкретні заклади." : "Сум за пакетом у цьому зрізі немає."}</p>`;
    return;
  }
  const g = st.gini;
  const gTxt = g == null ? "" : g < 0.3 ? "рівномірно" : g < 0.5 ? "помірна нерівність" : g < 0.7 ? "висока концентрація" : "дуже висока концентрація";
  const top = [...list].sort((a, b) => b.sum - a.sum).slice(0, 5);
  const top5 = top.reduce((a, it) => a + it.sum, 0);
  const maxT = Math.max(...top.map((it) => it.sum), 1);
  box.innerHTML = `
    <header class="ap-card-h">
      <h4>${esc(num(st.core.count))} з ${esc(num(st.withSum))} закладів (${esc(pct(st.core.share, 0))}) мають 80 % суми договорів</h4>
      <p class="ap-prov">${esc(scopeTitle())} · суми договорів від ${esc((ST().contractsData || {}).sums_date || "—")} — це законтрактовані суми, а не перераховані кошти · при рівному поділі 80 % суми договорів припадало б на 80 % закладів</p>
    </header>
    <div class="ap-money">
      ${lorenzSvg(st.sums, st.total)}
      <dl class="ap-kv">
        <div><dt>Джині</dt><dd>${g == null ? "—" : esc(dec(g, 2))}<small>${esc(gTxt)}</small></dd></div>
        <div><dt>Топ-5 закладів</dt><dd>${esc(pct(st.total ? top5 / st.total * 100 : 0, 0))}<small>суми договорів зрізу</small></dd></div>
        <div><dt>Медіанний договір</dt><dd>${esc(money(st.med))}<small>половина — від ${esc(money(st.q1))} до ${esc(money(st.q3))}</small></dd></div>
      </dl>
    </div>
    <details class="ap-inline-more"><summary>топ-5 закладів</summary>
      <ol class="ap-top">${top.map((it) => `<li data-ap-zoz="${it.pi}" tabindex="0" title="Паспорт закладу">
        <span class="ap-rname">${esc(it.q[P.NAME])}</span><span class="ap-cellbar is-money"><i style="width:${(it.sum / maxT * 100).toFixed(1)}%"></i></span>
        <b>${esc(money(it.sum))}</b></li>`).join("")}</ol>
      ${level() === "country" ? `<button type="button" class="ap-link-btn" data-drill="core80">ядро бюджету пакета детально →</button>` : ""}
    </details>`;
}

/* ── Оплати: рік до року (таблиця ДІТ) ─────────────────────────────
   Питання блока: скільки держава фактично заплатила за пакет у цьому зрізі і
   як це змінюється рік до року. Порівняння — лише рівних відрізків (повні
   місяці поточного року проти тих самих місяців минулого). */
const PAY_TOP = 10;

function renderPay(list) {
  const box = $("apPay");
  if (!box) return;
  const d = payData();
  if (!d) {
    box.innerHTML = A.payTried === String(A.pkg)
      ? `<header class="ap-card-h"><h4>Фактичні оплати</h4></header>
        <p class="ap-empty">У таблиці оплат ДІТ за 2024–2026 роки записів за цим пакетом немає.</p>`
      : '<div class="ap-skel"><i></i><i></i><i></i></div>';
    return;
  }
  const lvl = level();
  const pp = payPeriod(d);
  const { Y, k, cur } = pp;
  const pay = payOf(list, lvl, A.scope.obl);
  const dYtd = payChange(pay.ytd[cur], pay.ytd[cur - 1]);
  const dYear = payChange(pay.t[cur - 1], pay.t[cur - 2]);
  const title = pay.ytd[cur]
    ? `сплачено ${money(pay.ytd[cur])} за ${pp.ytdLbl}${dYtd != null ? `, ${chgText(dYtd)} до ${pp.ytdPrev}` : ""}`
    : pay.t[cur - 1] ? `у ${Y[cur - 1]} році сплачено ${money(pay.t[cur - 1])}; за ${pp.ytdLbl} оплат немає`
    : `оплат за ${Y[0]}–${Y[cur]} роки немає`;
  const how = pay.how === "file"
    ? (lvl === "country" ? "усі отримувачі за пакетом" : "усі отримувачі області, зокрема ті, чиїх договорів у реєстрі вже немає")
    : "сума по закладах реєстру договорів у цьому зрізі";
  const tile = (label, v, sub) => `<div><dt>${esc(label)}</dt><dd>${esc(money(v))}<small>${sub}</small></dd></div>`;
  const tiles = `<dl class="ap-kv ap-pay-kv">
      ${tile(`${Y[cur - 2]} рік`, pay.t[cur - 2], esc(nProv(pay.n[cur - 2])))}
      ${tile(`${Y[cur - 1]} рік`, pay.t[cur - 1], (dYear != null ? `${esc(chgText(dYear))} до ${Y[cur - 2]} · ` : "") + esc(nProv(pay.n[cur - 1])))}
      ${tile(pp.ytdLbl, pay.ytd[cur], (dYtd != null ? `${esc(chgText(dYtd))} до ${esc(pp.ytdPrev)} · ` : "") + esc(nProv(pay.n[cur])))}
    </dl>`;
  let chart = "";
  if (pay.m) {
    const series = Y.map((yr, i) => ({
      year: yr, cls: "y" + i, main: i === cur,
      vals: (pay.m[String(yr)] || []).slice(0, i === cur ? k : 12),
    }));
    // у широкому контейнері графік займає праву колонку сітки .ap-pay, у вузькому — усю ширину
    const cw = box.clientWidth || 0;
    const apw = ($("analyticsPanel") || box).clientWidth || cw;
    const w = apw >= 900 ? cw - 28 - 300 - 12 : cw - 28;
    chart = yearLinesSvg(series, { w: w > 0 ? w : 640, aria: `оплати за місяцями у ${Y.join(", ")} роках, ${scopeTitle()}` });
  }
  // Заклади зрізу за оплатами поточного року; у найвужчих зрізах — усі
  const narrow = lvl === "hromada" || lvl === "place";
  const rows = list.map((it) => ({ it, r: payRow(it) })).filter((x) => x.r)
    .sort((a, b) => (b.r[3 + cur] - a.r[3 + cur]) || (b.r[cur - 1] - a.r[cur - 1]));
  const shown = narrow ? rows : rows.slice(0, PAY_TOP);
  const without = list.length - rows.length;
  const maxT = Math.max(...shown.map((x) => x.r[3 + cur]), 1);
  const listHtml = shown.length ? `<ol class="ap-top ap-pay-top">${shown.map(({ it, r }) => {
      const ch = payChange(r[3 + cur], r[3 + cur - 1]);
      return `<li data-ap-zoz="${it.pi}" tabindex="0" title="${esc(it.q[P.NAME])}: ${esc(pp.ytdPrev)} — ${esc(money(r[3 + cur - 1]))} → ${esc(pp.ytdLbl)} — ${esc(money(r[3 + cur]))}. Клік — паспорт закладу">
        <span class="ap-rname">${esc(it.q[P.NAME])}</span>
        <span class="ap-cellbar is-money"><i style="width:${(Math.max(r[3 + cur], 0) / maxT * 100).toFixed(1)}%"></i></span>
        <b>${esc(money(r[3 + cur]))}</b><small class="${ch == null ? "" : ch >= 0 ? "up" : "down"}">${esc(chgText(ch)) || "—"}</small></li>`;
    }).join("")}</ol>`
    : `<p class="ap-empty">Серед закладів зрізу оплат за пакетом у таблиці ДІТ не знайдено.</p>`;
  const cap = !narrow && rows.length > PAY_TOP ? ` · показано ${PAY_TOP} з ${num(rows.length)}` : "";
  box.innerHTML = `
    <header class="ap-card-h">
      <h4>${esc(scopeTitle())}: ${esc(title)}</h4>
      <p class="ap-prov">${esc(d.src.short)} · гроші за звітним місяцем · ${Y[cur]}: повні місяці ${esc(pp.span)}${pp.tail ? `, ${esc(pp.tail)} ще оплачуються й у порівняння не входять` : ""} · ${esc(how)}</p>
    </header>
    <div class="ap-pay">
      ${tiles}
      ${chart ? `<figure class="ap-pay-chart">${chart}<figcaption>${Y.map((yr, i) => `<span class="ap-yl-key y${i}">${yr}</span>`).join(" ")} · ${Y[cur]} — лише повні місяці · вісь від нуля</figcaption></figure>`
        : `<p class="ap-sub">Помісячні оплати є до рівня області; нижче — річні суми по закладах зрізу.</p>`}
    </div>
    <details class="ap-inline-more"${narrow ? " open" : ""}>
      <summary>${narrow ? "заклади зрізу" : "найбільші отримувачі"} за ${esc(pp.ytdLbl)}${cap}</summary>
      ${listHtml}
      ${without > 0 ? `<p class="ap-sub">${esc(num(without))} ${plural(without, "заклад", "заклади", "закладів")} реєстру договорів у зрізі — без оплат за пакетом у таблиці ДІТ (договір новий, або заклад зшито не вдалося).</p>` : ""}
    </details>`;
}

/* ── Робота в часі ─────────────────────────────────────────────── */
function renderWork(list, st) {
  const box = $("apWork");
  if (!box) return;
  const V = window.Volumes;
  const d = volData();
  const lvl = level();
  if (!d) {
    box.innerHTML = `<header class="ap-card-h"><h4>Робота в часі</h4></header>
      <p class="ap-empty">У вивантажці ЕСОЗ послуг за цим пакетом немає — пакет оплачується не за кількість послуг, або обсяги ще не зібрані.</p>`;
    return;
  }
  const full = d.months.filter((m) => d.partial.indexOf(m) === -1);
  const cut = d.partial.length ? `${MONTH_FULL[+d.partial[0].slice(5) - 1]} обрізаний у вивантажці і не показаний` : "";
  if (lvl === "country" || lvl === "oblast") {
    const pts = full.map((m) => ({ label: `${MONTH_FULL[+m.slice(5) - 1]} ${m.slice(0, 4)}`, short: MONTHS[+m.slice(5) - 1],
      v: lvl === "country" ? d.m[m][0] : ((d.mo[m] || {})[A.scope.obl] || 0) }));
    const tot = pts.reduce((a, p) => a + p.v, 0);
    const first = pts[0].v, last = pts[pts.length - 1].v;
    const ch = first ? (last - first) / first * 100 : 0;
    const lastM = MONTH_FULL[+full[full.length - 1].slice(5) - 1], firstG = MONTH_GEN[+full[0].slice(5) - 1];
    const chTxt = Math.abs(ch) < 3 ? `${lastM} проти ${firstG} — практично без змін` : `${lastM} проти ${firstG}: ${ch > 0 ? "+" : ""}${pct(ch, 0)}`;
    box.innerHTML = `
      <header class="ap-card-h">
        <h4>${esc(big(tot))} послуг за ${full.length} міс.; ${esc(chTxt)}</h4>
        <p class="ap-prov">${esc(scopeTitle())} · ЕСОЗ, вивантажка від ${esc((V.meta() || {}).generated || "—")}${cut ? " · " + esc(cut) : ""} · вісь від нуля</p>
      </header>
      ${lineSvg(pts, { aria: `послуги за місяцями, ${scopeTitle()}` })}
      ${lvl === "country" && d.prop ? `<p class="ap-sub">Хто надає послуги — за формою власності:</p>${ownShares(d.prop)}` : ""}`;
    return;
  }
  const sv = servicesOf(list, "below");
  box.innerHTML = `<header class="ap-card-h"><h4>Робота: ${esc(scopeTitle())}</h4></header>
    <p class="ap-empty">Помісячної динаміки нижче області у вивантажці немає.
      ${sv ? `Разом по закладах зрізу — <b>${esc(num(sv.v))}</b> послуг за ${full.length} міс. (Supabase).` : "Обсяги по закладах видно після входу."}</p>`;
}

/* ── Доступ: області за інтенсивністю (загальний графік + перелік за потреби) ── */
function renderAccess() {
  const box = $("apAccess");
  if (!box) return;
  const m = volMetric("rate");
  if (!m) {
    box.innerHTML = `<header class="ap-card-h"><h4>Доступ по країні</h4></header>
      <p class="ap-empty">Без обсягів послуг показник «на населення» не рахується.</p>`;
    return;
  }
  const obls = [...new Set(A.items.map((it) => it.q[P.OBL]))];
  const vals = obls.map((o) => ({ o, v: m.val(o) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const unit = (m.unit && m.unit.short) || "";
  if (vals.length < 2) {
    box.innerHTML = `<header class="ap-card-h"><h4>Доступ по країні</h4></header><p class="ap-empty">Обсяги лише в одній області.</p>`;
    return;
  }
  const max = vals[0].v, med = median(vals.map((x) => x.v).sort((a, b) => a - b));
  const reliable = vals.filter((x) => !(m.conf && m.conf(x.o) === "low"));
  const base = reliable.length >= 4 ? reliable : vals;
  const ascV = base.map((x) => x.v).sort((a, b) => a - b);
  const q1 = quantile(ascV, 0.25), q3 = quantile(ascV, 0.75);
  const eq = q1 > 0 ? q3 / q1 : ascV[ascV.length - 1] / ascV[0];
  const nLow = vals.length - reliable.length;
  // Загальний графік: усі області точками на одній осі; підписані лише крайні
  // й вибрана — повний перелік розкривається нижче
  const W = 520, H = 70, L = 10, R = 10, y0 = 34;
  const x = (v) => L + (v / max) * (W - L - R);
  const labelled = new Set([vals[0].o, vals[vals.length - 1].o, A.scope.obl].filter(Boolean));
  const dots = vals.map((v) => `<g class="ap-sdot${v.o === A.scope.obl ? " is-me" : ""}${m.conf && m.conf(v.o) === "low" ? " is-low" : ""}" data-ap-child="${esc(v.o)}" data-ap-lvl="country" tabindex="0">
      <circle cx="${x(v.v).toFixed(1)}" cy="${y0}" r="${v.o === A.scope.obl ? 7 : 5}"/>
      <title>${esc(oblShort(v.o))}: ${esc(m.txt(v.o))} ${esc(unit)}</title>
      ${labelled.has(v.o) ? `<text x="${x(v.v).toFixed(1)}" y="${v.o === vals[0].o ? y0 - 12 : y0 + 22}" text-anchor="${x(v.v) > W - 90 ? "end" : x(v.v) < 90 ? "start" : "middle"}" class="ap-axis">${esc(oblShort(v.o))}</text>` : ""}
    </g>`).join("");
  const warn = vals.length < 15
    ? `<p class="ap-warn">⚠ Заклади з обсягами є лише у ${vals.length} ${plural(vals.length, "регіоні", "регіонах", "регіонах")}: обсяг центру ділиться на населення його області, а лікуються там люди з усієї країни. Дивіться абсолютний обсяг.</p>` : "";
  box.innerHTML = `
    <header class="ap-card-h">
      <h4>${vals.length < 15 ? `Обсяги лише у ${vals.length} ${plural(vals.length, "регіоні", "регіонах", "регіонах")}`
        : `Типова область верхньої чверті надає в ${esc(dec(eq, 1))} раза більше послуг на населення, ніж нижньої`}</h4>
      <p class="ap-prov">послуг ${esc(unit)} цільової групи · медіана ${esc(dec(med, med < 10 ? 1 : 0))}${nLow && base === reliable ? ` · розрив без ${nLow} ${plural(nLow, "області", "областей", "областей")} з *` : ""} · область — місце надавача</p>
    </header>
    ${warn}
    <svg class="ap-strip-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`області за інтенсивністю від ${m.txt(vals[vals.length - 1].o)} до ${m.txt(vals[0].o)} ${unit}`)}">
      <line x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}" class="ap-grid"/>
      <line x1="${x(med).toFixed(1)}" x2="${x(med).toFixed(1)}" y1="${y0 - 16}" y2="${y0 + 12}" class="ap-medline"><title>медіана областей</title></line>
      ${dots}
    </svg>
    <details class="ap-inline-more"><summary>усі ${vals.length} ${plural(vals.length, "область", "області", "областей")} за інтенсивністю</summary>
      <ol class="ap-dots">${vals.map((v) => `<li data-ap-child="${esc(v.o)}" data-ap-lvl="country" tabindex="0" class="${v.o === A.scope.obl ? "is-me" : ""}">
        <span class="ap-rname">${esc(oblShort(v.o))}</span>
        <span class="ap-dtrack"><b style="left:${(med / max * 100).toFixed(1)}%"></b><i style="left:${(v.v / max * 100).toFixed(1)}%"></i></span>
        <span class="ap-dval">${esc(m.txt(v.o))}</span></li>`).join("")}</ol>
    </details>`;
}

/* ── Якість даних (реєстр, розкривається за потреби) ───────────── */
function renderQuality(srcs) {
  const box = $("apQuality");
  if (!box) return;
  box.innerHTML = `
    <p class="ap-prov">${lampHtml("ok", "до 1 місяця")} ${lampHtml("warn", "до 3 місяців")} ${lampHtml("bad", "старші за 3 місяці")} ${lampHtml("na", "немає даних")}
      Колір — вік даних. Лампочка картки вгорі — найгірша з її джерел.</p>
    <div class="ap-table-wrap"><table class="ap-table ap-qtable">
      <thead><tr><th scope="col">Стан</th><th scope="col">Джерело</th><th scope="col">Дата даних</th><th scope="col" class="n">Вік</th>
        <th scope="col">На що впливає</th><th scope="col">Що зробити</th></tr></thead>
      <tbody>${srcs.map((s) => `<tr>
        <td>${lampHtml(s.state)}</td>
        <th scope="row">${esc(s.title)}${s.note ? `<small>${esc(s.note)}</small>` : ""}</th>
        <td>${esc(s.slice)}</td>
        <td class="n">${esc(s.ageText || ageText(s.date))}</td>
        <td>${esc(s.affects)}</td>
        <td><code>${esc(s.fix)}</code></td></tr>`).join("")}</tbody>
    </table></div>`;
}

/* ── Паспорт закладу (лише для авторизованих) ──────────────────────
   Межа — роль «не гість», як у RLS таблиці обсягів. Оверлей тут — лише
   видимість: справжній замок стоїть на даних Supabase. */
function zozBox() { return $("apZoz"); }

function closeZoz() {
  const box = zozBox();
  A.zozPi = null;
  if (!box || box.hidden) return;
  box.hidden = true;
  box.innerHTML = "";
  document.body.classList.remove("ap-zoz-open");
}

async function openZoz(pi) {
  const box = zozBox();
  if (!box || !A.panel || !A.panel.providers[pi]) return;
  A.zozPi = pi;
  box.hidden = false;
  document.body.classList.add("ap-zoz-open");
  box.innerHTML = `<div class="ap-zoz-panel is-skel" role="dialog" aria-modal="true" aria-label="Паспорт закладу"><p>Перевіряю доступ…</p></div>`;
  if (A.access == null) A.access = await checkAccess();
  if (A.zozPi !== pi) return;
  if (!canSeeZoz()) {
    box.innerHTML = `<div class="ap-zoz-panel" role="dialog" aria-modal="true" aria-labelledby="apZozTitle">
      <button type="button" class="ap-zoz-x" data-ap-close aria-label="Закрити">✕</button>
      <p class="ap-zoz-kicker">Паспорт закладу</p>
      <h3 id="apZozTitle">Доступно після входу</h3>
      <p>Паспорт закладу — останній щабель сходів: місце закладу в пакеті, його договір проти медіан області й країни,
        фактичні послуги й навантаження. Послуги конкретного закладу — внутрішні аналітичні дані, тому паспорт відкривається
        лише співробітникам із роллю експерта.</p>
      ${A.access && A.access.signedIn ? `<p class="ap-warn">Ви увійшли, але роль у профілі — «гість». Роль виставляє адміністратор порталу.</p>`
        : `<button type="button" class="ap-btn" data-ap-login>Увійти</button>`}
    </div>`;
    return;
  }
  renderZoz(pi);
  loadZozAllPackages(pi);
  fillZozContacts(pi);
}

function renderZoz(pi) {
  const box = zozBox();
  const q = A.panel.providers[pi];
  const it = A.items.find((x) => x.pi === pi) || { pi, sum: 0, q };
  const isFop = q[P.OWN] === "ФОП";
  const obl = q[P.OBL];
  const inObl = A.items.filter((x) => x.q[P.OBL] === obl);
  const sortDesc = (l) => [...l].sort((a, b) => b.sum - a.sum);
  const nat = sortDesc(A.items), oblL = sortDesc(inObl);
  const natSums = A.items.map((x) => x.sum).filter((v) => v > 0).sort((a, b) => a - b);
  const oblSums = inObl.map((x) => x.sum).filter((v) => v > 0).sort((a, b) => a - b);
  const natTotal = natSums.reduce((a, b) => a + b, 0), oblTotal = oblSums.reduce((a, b) => a + b, 0);
  let acc = 0, inCore = false;
  for (const x of nat) { if (acc >= natTotal * 0.8) break; acc += x.sum; if (x.pi === pi) { inCore = true; break; } }
  const rankN = nat.findIndex((x) => x.pi === pi) + 1, rankO = oblL.findIndex((x) => x.pi === pi) + 1;
  const medN = median(natSums), medO = median(oblSums);

  const d = volData();
  const months = d ? d.months.filter((m) => d.partial.indexOf(m) === -1).length : 7;
  const sv = pvOf(it);
  const loads = (l) => l.map((x) => pvOf(x)).filter((v) => v > 0).map((v) => v / months).sort((a, b) => a - b);
  const lO = loads(inObl), lN = loads(A.items);
  const myLoad = sv ? sv / months : 0;
  const ratioZones = [[0, 0.5, "удвічі менше за медіану"], [0.5, 1.5, "близько до медіани"], [1.5, 3, "значно більше за медіану"]];

  const valid = validPkgs();
  const allPk = providerPackages(pi).sort((a, b) => b[1] - a[1]);
  const pkgs = allPk.filter(([n]) => valid.has(n));
  const otherPk = allPk.filter(([n]) => !valid.has(n)).map(([n]) => n).sort((a, b) => +a - +b);
  const pkgName = (n) => ((A.panel.packages || {})[n] || {}).name || "";
  const contract = contractOf(q);
  const contact = { fop: isFop, email: contract ? contract.email : "", pkey: contract ? contract.pkey : null };
  const quality = [
    [it.sum > 0 ? "ok" : "warn", it.sum > 0 ? "сума договору є" : "суми у вивантажці немає"],
    [q[P.X] != null ? "ok" : "warn", q[P.X] != null ? "населений пункт геокодовано" : "координат немає"],
    [q[P.HCODE] ? "ok" : "warn", q[P.HCODE] ? "громаду визначено" : "громаду не визначено"],
    [sv == null ? "na" : sv > 0 ? "ok" : "warn", sv == null ? "обсяги за пакетом не завантажені" : sv > 0 ? "обсяги зшито з ЕСОЗ" : "послуг за ключем закладу не знайдено"],
  ];

  box.innerHTML = `<div class="ap-zoz-panel" role="dialog" aria-modal="true" aria-labelledby="apZozTitle">
    <button type="button" class="ap-zoz-x" data-ap-close aria-label="Закрити паспорт закладу">✕</button>
    <p class="ap-zoz-kicker">Паспорт закладу · пакет ${esc(A.pkg)}</p>
    <h3 id="apZozTitle">${esc(q[P.NAME])}</h3>
    <p class="ap-zoz-badges"><span>${esc(q[P.OWN] || "—")}</span><span>${esc(NET_LABEL[q[P.NET] || 0])}</span>
      ${inCore ? '<span class="is-core">ядро 80 % пакета</span>' : ""}</p>
    <dl class="ap-kv ap-zoz-req">
      <div><dt>Код</dt><dd>${isFop ? "ФОП — код не показуємо" : esc(q[P.EDRPOU])}</dd></div>
      <div><dt>Область</dt><dd>${esc(oblName(obl))}</dd></div>
      <div><dt>Громада</dt><dd>${q[P.HCODE] ? esc(q[P.HNAME]) : "—"}</dd></div>
      <div><dt>Населений пункт</dt><dd>${esc(placeName(q[P.SETTLE]))}</dd></div>
    </dl>

    <section class="ap-zoz-sec">
      <h4>Місце в пакеті</h4>
      ${it.sum > 0 ? `
      <p class="ap-zoz-lead"><b>${esc(money(it.sum))}</b> — ${esc(pct(natTotal ? it.sum / natTotal * 100 : 0, 2))} суми договорів пакета,
        ${esc(pct(oblTotal ? it.sum / oblTotal * 100 : 0, 1))} області · місце ${rankO} з ${oblL.length} в області, ${rankN} з ${nat.length} у країні</p>
      <div class="ap-zoz-gauges">
        ${gaugeSvg({ value: medO ? it.sum / medO : null, min: 0, max: 3, target: 1, targetLabel: "медіана області",
          fmt: (v) => "×" + dec(v, 0), zones: ratioZones, zoneCls: [0, 2, 1], valueText: medO ? `×${dec(it.sum / medO, 1)}` : "—",
          aria: `договір до медіани області`, caption: `договір проти медіани області (${esc(money(medO))})` })}
        ${gaugeSvg({ value: medN ? it.sum / medN : null, min: 0, max: 3, target: 1, targetLabel: "медіана країни",
          fmt: (v) => "×" + dec(v, 0), zones: ratioZones, zoneCls: [0, 2, 1], valueText: medN ? `×${dec(it.sum / medN, 1)}` : "—",
          aria: `договір до медіани країни`, caption: `проти медіани країни (${esc(money(medN))})` })}
      </div>`
      : `<p class="ap-empty">Суми за цим пакетом у вивантажці немає.</p>`}
    </section>

    ${zozPayHtml(it, inObl)}

    <section class="ap-zoz-sec">
      <h4>Робота за пакетом</h4>
      ${sv == null ? `<p class="ap-empty">Обсяги по закладах ще вантажаться або за пакетом їх немає.</p>`
        : sv === 0 ? `<p class="ap-warn">За ключем закладу послуг у вивантажці ЕСОЗ не знайдено. Це або справді нуль, або ключ не зшився (для ФОП зшиваємо за ПІБ).</p>`
        : `<p class="ap-zoz-lead"><b>${esc(num(sv))}</b> послуг за ${months} міс. · ${esc(num(myLoad))} на місяць</p>
          <div class="ap-zoz-gauges">
            ${gaugeSvg({ value: median(lO) ? myLoad / median(lO) : null, min: 0, max: 3, target: 1, targetLabel: "медіана області",
              fmt: (v) => "×" + dec(v, 0), zones: ratioZones, zoneCls: [0, 2, 1], valueText: median(lO) ? `×${dec(myLoad / median(lO), 1)}` : "—",
              aria: "навантаження до медіани області", caption: `навантаження проти медіани області (${esc(num(median(lO)))}/міс.)` })}
            ${gaugeSvg({ value: median(lN) ? myLoad / median(lN) : null, min: 0, max: 3, target: 1, targetLabel: "медіана країни",
              fmt: (v) => "×" + dec(v, 0), zones: ratioZones, zoneCls: [0, 2, 1], valueText: median(lN) ? `×${dec(myLoad / median(lN), 1)}` : "—",
              aria: "навантаження до медіани країни", caption: `проти медіани країни (${esc(num(median(lN)))}/міс.)` })}
          </div>
          <p class="ap-sub">Навантаження порівнюється лише всередині пакета: одиниця послуги в різних пакетах різна.</p>`}
    </section>

    <details class="ap-zoz-sec ap-inline-more" open>
      <summary>Пакети закладу · ${pkgs.length} ${plural(pkgs.length, "пакет", "пакети", "пакетів")} постанови 1808 · ${esc(money(pkgs.reduce((a, r) => a + r[1], 0)))}</summary>
      <table class="ap-table ap-zoz-pk"><thead><tr><th scope="col">Пакет</th><th scope="col" class="n">Сума</th><th scope="col" class="n">Послуг</th></tr></thead>
        <tbody>${pkgs.map(([n, s]) => `<tr class="${n === String(A.pkg) ? "is-me" : ""}"><th scope="row"><b>${esc(n)}</b> ${esc(pkgName(n))}</th>
          <td class="n">${esc(money(s))}</td><td class="n" data-ap-pkgsv="${esc(n)}">…</td></tr>`).join("")}</tbody></table>
      ${otherPk.length ? `<p class="ap-sub">Ще ${otherPk.length} ${plural(otherPk.length, "напрям", "напрями", "напрямів")} поза постановою 1808 (реімбурсація «Доступні ліки», пілоти): ${esc(otherPk.join(", "))}.</p>` : ""}
    </details>

    <section class="ap-zoz-sec">
      <h4>Контакти</h4>
      <dl class="ap-kv ap-zoz-req">
        <div><dt>Email</dt><dd data-ap-contact="email">${contact.fop ? "…" : (contact.email ? `<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>` : "—")}</dd></div>
        <div><dt>Адреса реєстрації</dt><dd data-ap-contact="addr">${contact.fop ? "…" : "у картці договору"}</dd></div>
      </dl>
      ${!contact.fop && q[P.EDRPOU] ? `<p class="ap-sub"><a href="../zoz-dogovr/?q=${encodeURIComponent(q[P.EDRPOU])}" class="ap-more">картка договору в «Договорах ЗОЗ» →</a></p>` : ""}
      ${contact.fop ? `<p class="ap-sub">Контакти ФОП — персональні дані: зберігаються в базі під захистом доступу, у публічних файлах їх немає.</p>` : ""}
    </section>

    <section class="ap-zoz-sec">
      <h4>Якість рядка</h4>
      <p class="ap-zoz-q">${quality.map(([s, t]) => lampHtml(s, t)).join(" ")}</p>
    </section>
    <p class="ap-sub">Джерела: реєстр договорів НСЗУ (${esc((ST().contractsData || {}).source_date || "—")}, суми — ${esc((ST().contractsData || {}).sums_date || "—")}); послуги — вивантажка ЕСОЗ у Supabase (RLS)${payData() ? `; оплати — ${esc(payData().src.short)}` : ""}.</p>
  </div>`;
}

/** Паспорт закладу: скільки закладу фактично сплачено за пакетом і його місце за оплатами. */
function zozPayHtml(it, inObl) {
  const d = payData();
  if (!d) return "";
  const pp = payPeriod(d);
  const { Y, cur } = pp;
  const r = payRow(it);
  if (!r) {
    return `<section class="ap-zoz-sec"><h4>Оплати за пакетом</h4>
      <p class="ap-empty">У таблиці оплат ДІТ за ${Y[0]}–${Y[cur]} роки закладу за цим пакетом не знайдено${it.q[P.OWN] === "ФОП" ? " (ФОП зшиваємо за ПІБ — розбіжність у написанні теж дає «не знайдено»)" : ""}.</p></section>`;
  }
  // місце за оплатами минулого повного року: в області — серед закладів реєстру, у країні — серед усіх отримувачів
  const col = cur - 1;
  const oblVals = inObl.map((x) => payRow(x)).filter(Boolean).map((x) => x[col]).sort((a, b) => b - a);
  const natVals = Object.values(d.pv).map((x) => x[col]).sort((a, b) => b - a);
  const rankO = oblVals.filter((v) => v > r[col]).length + 1, rankN = natVals.filter((v) => v > r[col]).length + 1;
  const ch = payChange(r[3 + cur], r[3 + cur - 1]);
  return `<section class="ap-zoz-sec">
      <h4>Оплати за пакетом</h4>
      <p class="ap-zoz-lead">${Y[cur - 2]} — <b>${esc(money(r[cur - 2]))}</b> · ${Y[cur - 1]} — <b>${esc(money(r[cur - 1]))}</b> ·
        ${esc(pp.ytdLbl)} — <b>${esc(money(r[3 + cur]))}</b>${ch != null ? ` (${esc(chgText(ch))} до ${esc(pp.ytdPrev)})` : ""}</p>
      ${r[col] > 0 ? `<p class="ap-sub">За оплатами ${Y[col]} року — місце ${rankO} з ${oblVals.length} в області (заклади реєстру) і ${rankN} з ${natVals.length} у країні (усі отримувачі).</p>` : ""}
      <p class="ap-sub">${esc(d.src.short)}; гроші за звітним місяцем, ${Y[cur]} — повні місяці ${esc(pp.span)}.</p>
    </section>`;
}

/** Договір закладу з реєстру (для ключа pkey і email юрособи). panel.json
 *  зводить надавачів за парою (код, назва) — тим самим шукаємо й тут. */
function contractOf(q) {
  const list = (ST().contractsData || {}).contracts || [];
  return list.find((c) => c.edrpou === q[P.EDRPOU] && (c.provider_name || "").trim() === (q[P.NAME] || "").trim()) || null;
}

/** Контакти ФОП — із Supabase (provider-private.js), лише для авторизованих. */
function fillZozContacts(pi) {
  const q = A.panel.providers[pi];
  const PPriv = window.ProviderPrivate;
  if (!q || q[P.OWN] !== "ФОП" || !PPriv) return;
  const c = contractOf(q);
  PPriv.get(c ? c.pkey : null).then((res) => {
    if (A.zozPi !== pi) return;
    const note = PPriv.message(res.status);
    document.querySelectorAll('[data-ap-contact="email"]').forEach((n) => {
      n.innerHTML = res.status === "ok" && res.email ? `<a href="mailto:${esc(res.email)}">${esc(res.email)}</a>` : esc(res.status === "ok" ? "—" : note);
    });
    document.querySelectorAll('[data-ap-contact="addr"]').forEach((n) => {
      n.textContent = res.status === "ok" ? (res.reg_address || "—") : note;
    });
  });
}

/** Послуги закладу за всіма пакетами — одним запитом за ключем закладу. */
async function loadZozAllPackages(pi) {
  const sb = window.__pmgSb;
  const key = pvKey(A.panel.providers[pi]);
  const fill = (map) => {
    if (A.zozPi !== pi) return;
    document.querySelectorAll("[data-ap-pkgsv]").forEach((td) => {
      const v = map ? map.get(td.dataset.apPkgsv) : null;
      td.textContent = map ? (v != null ? num(v) : "—") : "н/д";
    });
  };
  if (!sb || !key) { fill(null); return; }
  try {
    const { data, error } = await sb.from("package_provider_volumes")
      .select("packet,services").eq("provider_key", key).limit(200);
    if (error) throw error;
    fill(new Map((data || []).map((r) => [String(r.packet), r.services || 0])));
  } catch (e) {
    console.warn("паспорт закладу: послуги за пакетами недоступні —", e.message || e);
    fill(null);
  }
}

/* ── Керування зрізом ──────────────────────────────────────────── */
const sameScope = (a, b) => a.obl === b.obl && a.hrom === b.hrom && a.place === b.place;

function setScope(next, opt) {
  opt = opt || {};
  const s = { obl: next.obl || null, hrom: next.hrom || null, place: next.place || null };
  if (sameScope(s, A.scope)) return;
  A.scope = s;
  A.showAll = false;
  if (!opt.fromMap) syncMap();
  syncList();
  syncUrl();
  draw();
  if (s.obl && !A.hromCount.has(s.obl)) loadHromCount(s.obl).then(() => { if (A.scope.obl === s.obl) draw(); });
}

/** Панель → карта. Поки синхронізуємося, відповіді карти ігноруємо, інакше
 *  проміжний щабель (громада без віяла) перезаписав би вибраний населений пункт. */
function syncMap(attempt) {
  const M = window.MapDrill;
  if (!M || !M.state) return;
  const st = M.state;
  if (!st.svg) return;
  if (st.busy) {
    if ((attempt || 0) < 10) setTimeout(() => syncMap((attempt || 0) + 1), 250);
    return;
  }
  const s = A.scope;
  const hrom = s.hrom && s.hrom !== NO_HROM ? s.hrom : null;
  A.syncing = true;
  const done = () => { setTimeout(() => { A.syncing = false; }, 50); };
  let p = Promise.resolve();
  if (!s.obl) { if (st.oblast) p = M.zoomTo(null); }
  else if (st.oblast !== s.obl || st.hromada !== hrom) p = M.zoomTo(s.obl, { hromada: hrom });
  Promise.resolve(p).then(() => {
    if (s.place && M.openFan) {
      const it = scoped().find((x) => x.q[P.X] != null);
      if (it) M.openFan(`${it.q[P.X]}|${it.q[P.Y]}`);
    } else if (!s.place && st.fan && M.openFan) {
      M.openFan(null);
    }
  }).finally(done);
}

/** Карта → панель (виклик із map-drill.js). */
function onMapScope(ms) {
  if (A.syncing || !A.panel) return;
  const s = { obl: ms.oblast || null, hrom: ms.hromada || null, place: null };
  if (ms.fan && ms.place) {
    s.place = ms.place;
    if (!s.hrom) {
      const it = A.items.find((x) => x.q[P.OBL] === s.obl && x.q[P.SETTLE] === ms.place);
      if (it && it.q[P.HCODE]) s.hrom = it.q[P.HCODE];
    }
  }
  setScope(s, { fromMap: true });
}

/** Перелік ЗОЗ нижче панелі фільтрується за областю зрізу — без прокрутки. */
function syncList() {
  const st = ST();
  const sel = $("hospitalOblastFilter");
  if (!sel || !st) return;
  const o = A.scope.obl || "";
  if ((st.hospitalOblast || "") === o) return;
  st.hospitalOblast = o;
  st.hospitalCurrentPage = 1;
  sel.value = o;
  if (typeof renderHospitalsTable === "function") renderHospitalsTable();
}

function syncUrl() {
  const p = new URLSearchParams(location.search);
  const set = (k, v) => (v ? p.set(k, v) : p.delete(k));
  set("obl", A.scope.obl);
  set("hrom", A.scope.hrom);
  set("np", A.scope.place);
  history.replaceState(null, "", `${location.pathname}?${p}`);
}

function applyUrlOnce() {
  if (A.urlApplied) return;
  A.urlApplied = true;
  const p = new URLSearchParams(location.search);
  if (p.get("package") !== A.pkg) return;
  const s = { obl: p.get("obl"), hrom: p.get("hrom"), place: p.get("np") };
  if (s.obl && A.items.some((it) => it.q[P.OBL] === s.obl)) A.scope = { obl: s.obl, hrom: s.hrom || null, place: s.place || null };
}

/* ── Малювання і життєвий цикл ─────────────────────────────────── */
function draw() {
  if (!A.panel) return;
  const list = scoped();
  const st = stats(list);
  const srcs = sources();
  const safe = (fn, ...args) => { try { fn(...args); } catch (e) { console.warn("панель «Як працює пакет»:", fn.name, e); } };
  safe(renderHead, srcs);
  safe(renderLadder);
  safe(renderChain, list, st, srcs);
  safe(renderKids, list, st);
  safe(renderPay, list);
  safe(renderCases);
  safe(renderMoney, list, st);
  safe(renderWork, list, st);
  safe(renderAccess);
  safe(renderSteps, list, st);
  safe(renderQuality, srcs);
}

function skeleton() {
  const chain = $("apChain");
  if (chain) chain.innerHTML = Array.from({ length: 5 }, () => '<article class="ap-link is-skel"><i></i><i></i><i></i></article>').join("");
  ["apKids", "apPay", "apCases", "apMoney", "apWork", "apAccess"].forEach((id) => { const b = $(id); if (b) b.innerHTML = '<div class="ap-skel"><i></i><i></i><i></i></div>'; });
}

async function render(pkgNum) {
  wire();
  A.pkg = String(pkgNum);
  A.scope = { obl: null, hrom: null, place: null };
  A.showAll = false;
  A.pvol = null;
  A.pvolPkg = null;
  A.pay = null;
  A.payPkg = null;
  A.payTried = null;
  A.cases = null;
  A.casesPkg = null;
  A.casesTried = null;
  closeZoz();
  skeleton();
  loadPay(A.pkg);                   // окремо: панель не чекає на оплати
  loadCases(A.pkg);
  const [panel] = await Promise.all([ensurePanel(), ensureExtras()]);
  if (A.pkg !== String(pkgNum)) return;
  if (!panel) {
    const box = $("apKids");
    if (box) box.innerHTML = '<p class="ap-empty">Не завантажилися дані панелі (panel/data/panel.json) — сходи недоступні. Решта вкладки працює.</p>';
    return;
  }
  prepare();
  applyUrlOnce();
  if (A.scope.obl) await loadHromCount(A.scope.obl);
  syncUrl();
  draw();
  if (A.scope.obl) { syncList(); setTimeout(syncMap, 400); }
}

function onVolumes(pkgNum) {
  if (String(pkgNum) === A.pkg) draw();
}

function onProviderVolumes(pkgNum, res) {
  if (String(pkgNum) !== A.pkg) return;
  A.pvol = res;
  A.pvolPkg = String(pkgNum);
  draw();
  if (A.zozPi != null && canSeeZoz()) { renderZoz(A.zozPi); loadZozAllPackages(A.zozPi); fillZozContacts(A.zozPi); }
}

function openDetails(id) {
  const d = $(id);
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ behavior: "smooth", block: "start" });
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  const root = $("analyticsPanel");
  const zoz = zozBox();
  const act = (e) => {
    const t = e.target;
    // «детально» всередині картки розкривається само, без переходу
    if (t.closest("summary") && t.closest(".ap-link-more, .ap-inline-more")) return true;
    const op = t.closest("[data-ap-open]");
    if (op) { openDetails(op.dataset.apOpen); return true; }
    const sc = t.closest("[data-ap-scope]");
    if (sc) { setScope(JSON.parse(sc.dataset.apScope)); return true; }
    const zz = t.closest("[data-ap-zoz]");
    if (zz) { openZoz(+zz.dataset.apZoz); return true; }
    const ch = t.closest("[data-ap-child]");
    if (ch) {
      const k = ch.dataset.apChild;
      const lvl = ch.dataset.apLvl || level();
      const s = A.scope;
      if (lvl === "country") setScope({ obl: k });
      else if (lvl === "oblast") setScope({ obl: s.obl, hrom: k });
      else if (lvl === "hromada") setScope({ obl: s.obl, hrom: s.hrom, place: k });
      return true;
    }
    if (t.closest("[data-ap-all]")) { A.showAll = !A.showAll; renderSteps(scoped(), stats(scoped())); return true; }
    if (t.closest(".ap-link-more")) return true;
    const go = t.closest("[data-ap-go]");
    if (go && go.dataset.apGo) {
      e.preventDefault();
      if (go.dataset.apGo === "tariffs") {
        const tab = document.querySelector('.tab-link[data-tab="tariffs"]');
        if (tab) tab.click();
      } else {
        const target = $(go.dataset.apGo);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return true;
    }
    return false;
  };
  if (root) {
    root.addEventListener("click", (e) => { act(e); });
    root.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("[tabindex]") && act(e)) e.preventDefault();
    });
  }
  if (zoz) {
    zoz.addEventListener("click", (e) => {
      if (e.target === zoz || e.target.closest("[data-ap-close]")) { closeZoz(); return; }
      if (e.target.closest("[data-ap-login]")) {
        const btn = document.getElementById("auth-nav-btn");
        closeZoz();
        if (btn) btn.click();
      }
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (A.zozPi != null) { closeZoz(); e.stopImmediatePropagation(); return; }
    const pane = $("tab-analytics");
    if (!pane || !pane.classList.contains("active") || !A.scope.obl) return;
    if (e.target.closest("input, textarea, select, .kd-drawer, [role=dialog]")) return;
    // карта сама обробляє Esc, коли її видно; тут — лише коли панель веде сама
    if (window.MapDrill && window.MapDrill.state && window.MapDrill.state.oblast) return;
    const s = A.scope;
    setScope(s.place ? { obl: s.obl, hrom: s.hrom } : s.hrom ? { obl: s.obl } : {});
  }, true);
  const hookAuth = () => {
    const sb = window.__pmgSb;
    if (!sb || !sb.auth) return false;
    sb.auth.onAuthStateChange(() => {
      A.access = null;
      if (A.zozPi != null) openZoz(A.zozPi);
    });
    return true;
  };
  if (!hookAuth()) { let n = 0; const t = setInterval(() => { if (hookAuth() || ++n > 20) clearInterval(t); }, 500); }
}

window.AnalyticsPanel = {
  render, onVolumes, onProviderVolumes, onMapScope, openZoz, closeZoz, setScope,
  get state() { return A; },
};
})();
