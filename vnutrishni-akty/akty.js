/**
 * Розділ «Внутрішні акти НСЗУ».
 *
 * Три режими:
 *   Строки        — Додаток 1 наказу № 502 + калькулятор строку (файл data/stroky.json);
 *   Хто опрацьовує — Додаток 2 того ж наказу (Supabase, таблиця internal_act_units);
 *   Реєстр актів  — чинні, проєкти на погодженні, наші позиції (Supabase, internal_acts).
 *
 * Чому вміст розділений між файлом і базою. Репозиторій порталу публічний, а
 * роль-гейт на сторінці — це видимість, а не захист: розмітка й дані вантажаться
 * до перевірки ролі. Тому вміст внутрішніх актів лежить у Supabase під RLS
 * («роль не guest»), і у файлі лишається тільки Додаток 1 — компіляція строків
 * із публічних законів.
 */
const $ = (id) => document.getElementById(id);

/* ──────────────────────────────────────────────────────────────
   Робочі дні: святкові за ст. 73 КЗпП, рухомі — від православної Пасхи.
   Порт scripts/stroky.py зі скіла nszu-vnutrishni-akty, конвенція та сама:
   відлік з дня, НАСТУПНОГО за днем події.
   ────────────────────────────────────────────────────────────── */
const FIXED_HOLIDAYS = [[1, 1], [3, 8], [5, 1], [5, 8], [6, 28], [8, 24], [12, 25]];
const holidayCache = new Map();

function easter(year) {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(Date.UTC(year, month - 1, day));
  julian.setUTCDate(julian.getUTCDate() + 13);   // зсув юліанського календаря для XXI ст.
  return julian;
}

function holidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const set = new Set(FIXED_HOLIDAYS.map(([m, d]) => Date.UTC(year, m - 1, d)));
  const p = easter(year);
  set.add(p.getTime());                                        // Великдень
  set.add(p.getTime() + 49 * 86400000);                        // Трійця
  holidayCache.set(year, set);
  return set;
}

function isWorkday(d) {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !holidays(d.getUTCFullYear()).has(d.getTime());
}

/** start + n робочих днів, відлік з дня, наступного за start. */
function addWorkdays(start, n) {
  const d = new Date(start.getTime());
  let c = 0;
  while (c < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkday(d)) c++;
  }
  return d;
}

/** limit − n робочих днів (n-й робочий день перед limit). */
function subWorkdays(limit, n) {
  const d = new Date(limit.getTime());
  let c = 0;
  while (c < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (isWorkday(d)) c++;
  }
  return d;
}

const addDays = (start, n) => new Date(start.getTime() + n * 86400000);

/** Найближчий робочий день, не раніший за d. */
function nextWorkday(d) {
  const x = new Date(d.getTime());
  while (!isWorkday(x)) x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

const WEEKDAYS = ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"];
const fmt = (d) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
const fmtLong = (d) => `${fmt(d)}, ${WEEKDAYS[d.getUTCDay()]}`;
const parseDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};

/** Українське відмінювання за числом: 1 підрозділ · 2 підрозділи · 5 підрозділів. */
function plural(n, one, few, many) {
  const t = n % 100, u = n % 10;
  if (t >= 11 && t <= 14) return many;
  if (u === 1) return one;
  if (u >= 2 && u <= 4) return few;
  return many;
}

/** «3 робочі дні» · «10 робочих днів» · «30 днів» — щоб підпис під датою читався. */
const dayWord = (n, isWd) => isWd
  ? plural(n, "робочий день", "робочі дні", "робочих днів")
  : plural(n, "день", "дні", "днів");

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ──────────────────────────────────────────────────────────────
   Спільний клієнт Supabase з auth-v2.js
   ────────────────────────────────────────────────────────────── */
const MISSING = /relation .* does not exist|could not find the table|PGRST205|42P01/i;

async function client() {
  // auth-v2.js — модуль і може підвантажитися пізніше за цей скрипт
  for (let i = 0; i < 30 && !window.__pmgSb; i++) await new Promise((r) => setTimeout(r, 150));
  return window.__pmgSb || null;
}

async function fetchTable(table, order) {
  const sb = await client();
  if (!sb) return { status: "error", rows: [] };
  try {
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) return { status: "guest", rows: [] };
  } catch (e) {
    return { status: "guest", rows: [] };
  }
  try {
    const { data, error } = await sb.from(table).select("*").order(order);
    if (error) throw error;
    // RLS для гостя повертає порожньо, а не помилку
    return { status: (data && data.length) ? "ok" : "empty", rows: data || [] };
  } catch (e) {
    const missing = MISSING.test(String(e.message || e.code || e));
    if (!missing) console.warn(`Таблиця ${table} недоступна:`, e.message || e);
    return { status: missing ? "missing" : "error", rows: [] };
  }
}

function stateBox(status, what, howto) {
  // Підмет тут різного роду («матриця», «реєстр»), тому все після тире —
  // безособове: інакше довелося б тримати по формі на кожен випадок.
  const text = {
    guest: `${what} — показуємо після входу на портал.`,
    empty: `${what} — у базі ще немає даних.`,
    missing: `${what} — таблиці ще немає в базі.`,
    error: `${what} — дані зараз недоступні.`,
  }[status] || "";
  return `<div class="va-state"><p>${esc(text)}</p>${howto ? `<p class="va-state-howto">${howto}</p>` : ""}</div>`;
}

/* ──────────────────────────────────────────────────────────────
   Режим 1: строки (Додаток 1)
   ────────────────────────────────────────────────────────────── */
let stroky = null;

async function loadStroky() {
  try {
    const res = await fetch("data/stroky.json", { cache: "no-cache" });
    stroky = await res.json();
  } catch (e) {
    $("strokyBody").innerHTML = `<div class="va-state"><p>Не вдалося завантажити таблицю строків.</p></div>`;
    return;
  }
  $("statKinds").textContent = stroky.rows.length;
  $("strokySource").textContent = `${stroky.dodatok} до Алгоритму, затвердженого ${stroky.approved}.`;

  const sel = $("calcKind");
  sel.innerHTML = stroky.rows.map((r) =>
    `<option value="${esc(r.id)}">${esc(r.vyd.length > 92 ? r.vyd.slice(0, 92) + "…" : r.vyd)}</option>`).join("");
  sel.value = "zvern-hrom";

  renderStroky("");
  runCalc();
}

function renderStroky(q) {
  const needle = q.trim().toLowerCase();
  const rows = needle
    ? stroky.rows.filter((r) => (r.vyd + " " + r.strok + " " + r.pidstava + " " + r.tags).toLowerCase().includes(needle))
    : stroky.rows;

  const hits = $("hitsStroky");
  hits.hidden = !needle;
  hits.textContent = needle ? `${rows.length} з ${stroky.rows.length}` : "";

  if (!rows.length) {
    $("strokyBody").innerHTML = `<div class="va-state"><p>За запитом нічого не знайшлося.</p></div>`;
    return;
  }
  $("strokyBody").innerHTML = `
    <table class="va-table">
      <thead><tr><th>Вид документа</th><th class="va-col-term">Строк</th><th>Нормативна підстава</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td class="va-td-kind">${esc(r.vyd)}</td>
          <td class="va-col-term"><span class="va-chip${r.unit === "wd" ? " is-wd" : ""}">${esc(r.label)}</span>
            <div class="va-term-full">${esc(r.strok)}</div></td>
          <td class="va-td-base">${esc(r.pidstava)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

function runCalc() {
  const out = $("calcOut");
  const row = stroky.rows.find((r) => r.id === $("calcKind").value);
  const start = parseDate($("calcDate").value);
  if (!row || !start) { out.hidden = true; return; }
  out.hidden = false;

  const isWd = row.unit === "wd";
  const noteHtml = row.note ? `<p class="va-calc-note">${esc(row.note)}</p>` : "";

  if (row.days == null) {
    // Базового строку в документі немає — рахувати нічого, але граничний
    // (якщо він є) показати варто: саме він і обмежує роботу.
    const only = row.max_days != null
      ? (row.max_unit === "wd" ? addWorkdays(start, row.max_days) : addDays(start, row.max_days))
      : null;
    out.innerHTML = `
      ${only ? `<div class="va-calc-main"><div class="va-calc-big va-calc-ext">
        <span class="va-calc-label">Граничний строк</span>
        <strong>${fmtLong(only)}</strong>
        <span class="va-calc-sub">${row.max_days} ${dayWord(row.max_days, row.max_unit === "wd")} з дня одержання</span>
      </div></div>` : ""}
      ${noteHtml}
      <p class="va-calc-basis">${esc(row.pidstava)}</p>`;
    return;
  }

  const due = isWd ? addWorkdays(start, row.days) : addDays(start, row.days);
  const shifted = isWorkday(due) ? null : nextWorkday(due);
  // п. 8 Алгоритму: співвиконавці віддають інформацію за першу третину строку
  const third = Math.ceil(row.days / 3);
  const thirdDate = isWd ? addWorkdays(start, third) : addDays(start, third);
  // п. 7 Алгоритму: проєкт відповіді — на погодження заступнику за 3 р. д. до
  // строку. На коротких строках (1–3 р. д., а для календарних — коли три
  // робочі дні назад заводять до самої реєстрації) діє інше правило пункту.
  const approveRaw = subWorkdays(due, 3);
  const approve = (isWd && row.days <= 3) || approveRaw <= start ? null : approveRaw;
  // п. 4 Алгоритму: служба діловодства може поставити випереджувальний строк
  const ahead = isWd ? subWorkdays(due, 2)
    : (row.days === 30 ? addDays(start, 21) : subWorkdays(due, 2));

  // Граничний строк у більшості випадків відлічується від реєстрації, але в
  // НАБУ продовження додається до основного строку — звідси max_from.
  const extBase = row.max_from === "due" ? due : start;
  const ext = row.max_days != null
    ? (row.max_unit === "wd" ? addWorkdays(extBase, row.max_days) : addDays(extBase, row.max_days))
    : null;

  out.innerHTML = `
    <div class="va-calc-main">
      <div class="va-calc-big">
        <span class="va-calc-label">Строк виконання</span>
        <strong>${fmtLong(due)}</strong>
        <span class="va-calc-sub">${row.days} ${dayWord(row.days, isWd)} із дня, наступного за реєстрацією</span>
        ${shifted ? `<span class="va-calc-sub va-calc-warn">припадає на неробочий день — найближчий робочий ${fmt(shifted)}
          (ст. 254 ЦК України)</span>` : ""}
      </div>
      ${ext ? `<div class="va-calc-big va-calc-ext">
        <span class="va-calc-label">З продовженням, граничний</span>
        <strong>${fmtLong(ext)}</strong>
        <span class="va-calc-sub">${row.max_days} ${dayWord(row.max_days, row.max_unit === "wd")}
          ${row.max_from === "due" ? "понад основний строк" : "з дня, наступного за реєстрацією"}</span>
      </div>` : ""}
    </div>
    <ul class="va-calc-chain">
      <li><strong>${fmt(thirdDate)}</strong> — співвиконавці мають дати інформацію головному виконавцю:
        перша третина строку, ${third} ${isWd ? "р. д." : "дн."} <span class="va-calc-src">п. 8 Алгоритму</span></li>
      ${approve ? `<li><strong>${fmt(approve)}</strong> — проєкт відповіді на погодження заступнику Голови
        за розподілом обов'язків, якщо документ такого погодження потребує
        <span class="va-calc-src">п. 7 Алгоритму</span></li>`
      : `<li>Строк короткий (1–3 р. д.): проєкт відповіді подається одразу після підготовки,
        не пізніше передостаннього робочого дня <span class="va-calc-src">п. 7 Алгоритму</span></li>`}
      <li><strong>${fmt(ahead)}</strong> — можливий випереджувальний строк служби діловодства
        ${isWd || row.days !== 30 ? "(на 2 р. д. раніше)" : "(21 к. д. замість 30)"};
        у картці АСКОД може стояти саме він <span class="va-calc-src">п. 4 Алгоритму</span></li>
    </ul>
    ${noteHtml}
    <p class="va-calc-basis">${esc(row.pidstava)}</p>`;
}

/* ──────────────────────────────────────────────────────────────
   Режим 2: хто опрацьовує (Додаток 2)
   ────────────────────────────────────────────────────────────── */
let units = null;
let unitsStatus = "";

async function loadUnits() {
  const { status, rows } = await fetchTable("internal_act_units", "n");
  unitsStatus = status;
  units = rows;
  if (status !== "ok") {
    $("htoBody").innerHTML = stateBox(status, "Матриця підрозділів",
      status === "missing" || status === "empty"
        ? "Виконати <code>migration_2026-09-18_internal_acts.sql</code>, потім <code>python 05_Веб_реєстр/vnutrishni-akty/upload_dodatok2.py</code>."
        : "");
    return;
  }
  $("statUnits").textContent = units.length;
  $("statTopics").textContent = units.reduce(
    (s, u) => s + (u.blocks || []).reduce((k, b) => k + Math.max(1, (b.items || []).length), 0), 0);
  renderUnits();
}

function renderUnits() {
  if (!units || unitsStatus !== "ok") return;
  const needle = $("qHto").value.trim().toLowerCase();
  const onlyOurs = $("onlyOurs").checked;

  // Слова запиту шукаються окремо і всі разом: «акт звіряння» має знаходити
  // «актів звіряння розрахунків», хоч дослівного збігу там немає.
  const terms = needle.split(/\s+/).filter(Boolean);
  const hasAll = (s) => { const x = s.toLowerCase(); return terms.every((t) => x.includes(t)); };

  const matched = units
    .filter((u) => !onlyOurs || u.is_ours)
    .map((u) => {
      if (!needle) return { u, blocks: u.blocks || [], hits: 0 };
      const inUnit = hasAll(u.unit);
      const blocks = (u.blocks || []).map((b) => {
        const intro = b.intro || "";
        if (inUnit || hasAll(intro)) return { ...b };
        // Підпункт читається разом зі своїм вступом («Листи … з питань:» +
        // «актів звіряння»), але не з сусідніми підпунктами — інакше слова
        // запиту збиралися б із різних тем і давали хибні збіги.
        const items = (b.items || []).filter((i) => hasAll(intro + " " + i));
        return items.length ? { ...b, items } : null;
      }).filter(Boolean);
      const hits = blocks.reduce((s, b) => s + Math.max(1, (b.items || []).length), 0);
      return (inUnit || blocks.length) ? { u, blocks, hits } : null;
    })
    .filter(Boolean);

  const hits = $("hitsHto");
  hits.hidden = !needle && !onlyOurs;
  const found = matched.reduce((s, m) => s + m.hits, 0);
  hits.textContent = needle
    ? `${matched.length} ${plural(matched.length, "підрозділ", "підрозділи", "підрозділів")} · `
      + `${found} ${plural(found, "питання", "питання", "питань")}`
    : (onlyOurs ? "позиція 18 — наш департамент" : "");

  if (!matched.length) {
    $("htoBody").innerHTML = `<div class="va-state"><p>За цим словом у Додатку 2 нічого немає.
      Якщо питання не описане в жодного підрозділу, головного виконавця визначає резолюція.</p></div>`;
    return;
  }

  const mark = (s) => {
    let safe = esc(s);
    // Підсвічуємо кожне слово запиту окремо; сам <mark> уже в розмітці, тому
    // наступні слова шукаємо тільки поза вставленими тегами.
    terms.forEach((t) => {
      const esct = esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      safe = safe.replace(new RegExp(`(?![^<]*>)(${esct})`, "gi"), "<mark>$1</mark>");
    });
    return safe;
  };

  $("htoBody").innerHTML = matched.map(({ u, blocks }) => `
    <article class="va-unit${u.is_ours ? " is-ours" : ""}">
      <header class="va-unit-head">
        <span class="va-unit-n">${u.n}</span>
        <h3>${mark(u.unit)}</h3>
        ${u.is_ours ? `<span class="va-badge">наш департамент</span>` : ""}
      </header>
      ${blocks.map((b) => `
        <div class="va-block">
          ${b.intro ? `<p class="va-block-intro">${mark(b.intro)}</p>` : ""}
          ${(b.items || []).length ? `<ul class="va-block-items">${b.items.map((i) => `<li>${mark(i)}</li>`).join("")}</ul>` : ""}
          <p class="va-block-official"><span>Первинний розгляд:</span> ${esc(b.official || u.official || "—")}</p>
        </div>`).join("")}
    </article>`).join("");
}

/* ──────────────────────────────────────────────────────────────
   Режим 3: реєстр актів
   ────────────────────────────────────────────────────────────── */
const GROUPS = [
  { kind: "chynnyi", title: "Чинні акти", note: "Те, чим ми зобов'язані керуватися вже зараз." },
  { kind: "proekt", title: "Проєкти на погодженні", note: "Те, на що ми ще можемо вплинути зауваженнями." },
  { kind: "pozytsiia", title: "Наші позиції та зауваження", note: "Що департамент уже подав до цих проєктів." },
];

async function loadActs() {
  const { status, rows } = await fetchTable("internal_acts", "sort");
  if (status !== "ok") {
    $("reyestrBody").innerHTML = stateBox(status, "Реєстр актів",
      status === "missing" || status === "empty"
        ? "Виконати <code>migration_2026-09-18_internal_acts.sql</code> — реєстр засівається самою міграцією."
        : "");
    return;
  }
  $("statActs").textContent = rows.length;
  $("reyestrBody").innerHTML = GROUPS.map((g) => {
    const list = rows.filter((r) => r.kind === g.kind);
    if (!list.length) return "";
    return `
      <section class="va-group">
        <h2>${esc(g.title)} <span class="va-group-n">${list.length}</span></h2>
        <p class="va-group-note">${esc(g.note)}</p>
        ${list.map(actCard).join("")}
      </section>`;
  }).join("");
}

function actCard(a) {
  const meta = [a.requisites, a.developer && `розробник: ${a.developer}`].filter(Boolean);
  return `
    <article class="va-act">
      <header class="va-act-head">
        <h3>${esc(a.title)}</h3>
        ${a.status ? `<span class="va-act-status">${esc(a.status)}</span>` : ""}
      </header>
      ${meta.length ? `<p class="va-act-meta">${esc(meta.join(" · "))}</p>` : ""}
      ${a.regulates ? `<p class="va-act-text">${esc(a.regulates)}</p>` : ""}
      ${a.our_role ? `<p class="va-act-role"><span>Наша роль:</span> ${esc(a.our_role)}</p>` : ""}
      ${a.notes ? `<details class="va-act-notes"><summary>Подробиці</summary><p>${esc(a.notes)}</p></details>` : ""}
      ${a.doc_path ? `<p class="va-act-path" title="Шлях у робочій теці">${esc(a.doc_path)}</p>` : ""}
    </article>`;
}

/* ──────────────────────────────────────────────────────────────
   Вкладки та події
   ────────────────────────────────────────────────────────────── */
const VIEWS = [
  { tab: "tabStroky", view: "viewStroky" },
  { tab: "tabHto", view: "viewHto" },
  { tab: "tabReyestr", view: "viewReyestr" },
];

function switchTo(id) {
  VIEWS.forEach(({ tab, view }) => {
    const on = tab === id;
    $(tab).classList.toggle("is-active", on);
    $(tab).setAttribute("aria-selected", String(on));
    $(view).classList.toggle("is-visible", on);
    $(view).hidden = !on;
  });
  const hash = { tabStroky: "", tabHto: "#hto", tabReyestr: "#reyestr" }[id];
  if (hash !== undefined) history.replaceState(null, "", location.pathname + hash);
}

function bindSearch(inputId, clearId, onChange) {
  const input = $(inputId), clear = $(clearId);
  input.addEventListener("input", () => {
    clear.hidden = !input.value;
    onChange();
  });
  clear.addEventListener("click", () => {
    input.value = "";
    clear.hidden = true;
    onChange();
    input.focus();
  });
}

VIEWS.forEach(({ tab }) => $(tab).addEventListener("click", () => switchTo(tab)));
bindSearch("qStroky", "qStrokyClear", () => renderStroky($("qStroky").value));
bindSearch("qHto", "qHtoClear", renderUnits);
$("onlyOurs").addEventListener("change", renderUnits);
$("calcKind").addEventListener("change", runCalc);
$("calcDate").addEventListener("change", runCalc);

$("calcDate").value = new Date().toISOString().slice(0, 10);
if (location.hash === "#hto") switchTo("tabHto");
if (location.hash === "#reyestr") switchTo("tabReyestr");

loadStroky();
loadUnits();
loadActs();

// Вхід або вихід без перезавантаження — перечитуємо закриті таблиці
(async () => {
  const sb = await client();
  if (sb && sb.auth) sb.auth.onAuthStateChange(() => { loadUnits(); loadActs(); });
})();
