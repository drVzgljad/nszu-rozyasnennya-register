/**
 * Розділ «Внутрішні акти НСЗУ».
 *
 * Три режими:
 *   Строки        — Додаток 1 наказу № 502 + калькулятор строку (файл data/stroky.json);
 *   Хто опрацьовує — Додаток 2 того ж наказу (Supabase, таблиця internal_act_units);
 *   Комунікація    — гайд і помічник за рекомендаціями ДІТ (Supabase, internal_act_guides).
 *
 * Реєстру внутрішніх актів і наших позицій до них тут НЕМАЄ і не має бути
 * (рішення користувача 18.09.2026): портал бачить кожен обліковий запис
 * департаменту, а статуси наших зауважень, чого ми домоглися в чужому проєкті
 * наказу і де лежать робочі файли — не те, що виносять на спільний екран.
 * Реєстр лишається в README теки 28_внутрішні_акти_НСЗУ.
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
   Режим 3: комунікація (гайд + помічник)

   Тут лише механіка. Текст розділів, приклади, ситуації помічника, позначки
   «що буде в матеріалі» і шаблон листа на press@ — у Supabase
   (internal_act_guides, slug 'komunikatsiia'), бо це вміст внутрішнього
   документа НСЗУ, а репозиторій публічний.

   Строки помічника двох типів:
     before_cal — n календарних днів ДО події («погодити за три дні»);
     after_wd   — n робочих днів ПІСЛЯ події («новина — 1–2 р. д.»).
   ────────────────────────────────────────────────────────────── */
let guide = null;

async function loadGuide() {
  const { status, rows } = await fetchTable("internal_act_guides", "slug");
  guide = status === "ok" ? rows.find((r) => r.slug === "komunikatsiia") : null;
  if (!guide) {
    $("komBody").innerHTML = stateBox(status === "ok" ? "empty" : status, "Гайд із зовнішньої комунікації",
      status === "missing" || status === "empty" || status === "ok"
        ? "Виконати <code>migration_2026-10-06_internal_guides.sql</code>, потім <code>python 05_Веб_реєстр/vnutrishni-akty/upload_guides.py</code>."
        : "");
    return;
  }
  renderGuide();
}

function renderGuide() {
  const c = guide.content || {};
  const calc = c.calc || {};
  const mail = calc.email || {};
  const sections = c.sections || [];

  $("komBody").innerHTML = `
    ${c.lead ? `<p class="kom-lead">${esc(c.lead)}</p>` : ""}

    <div class="va-calc kom-calc">
      <h2>${esc(calc.title || "Помічник")}</h2>
      ${calc.hint ? `<p class="va-calc-hint">${esc(calc.hint)}</p>` : ""}
      <div class="va-calc-row">
        <label class="va-field">
          <span>Ситуація</span>
          <select id="komScen">${(calc.scenarios || []).map((s) =>
            `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("")}</select>
        </label>
        <label class="va-field va-field-date" id="komDateWrap">
          <span id="komDateLabel">Дата</span>
          <input id="komDate" type="date">
        </label>
      </div>
      <fieldset class="kom-flags">
        <legend>Що буде в матеріалі чи розмові?</legend>
        ${(calc.flags || []).map((f) => `
          <label class="kom-flag"><input type="checkbox" value="${esc(f.id)}"><span>${esc(f.label)}</span></label>`).join("")}
      </fieldset>
      <div class="va-calc-out" id="komOut"></div>

      <div class="kom-mail" id="komMail" hidden>
        <h3>Лист на <a href="mailto:${esc(c.press_email)}">${esc(c.press_email)}</a></h3>
        <div class="kom-mail-grid">
          ${(mail.fields || []).map((f) => `
            <label class="va-field${f.multiline ? " kom-wide" : ""}">
              <span>${esc(f.label)}</span>
              ${f.select
                ? `<select data-mail="${esc(f.id)}">${(mail.formats || []).map((o) => `<option>${esc(o)}</option>`).join("")}</select>`
                : f.multiline
                  ? `<textarea data-mail="${esc(f.id)}" rows="3"></textarea>`
                  : `<input data-mail="${esc(f.id)}" type="text">`}
            </label>`).join("")}
        </div>
        <pre class="kom-mail-text" id="komMailText"></pre>
        <div class="kom-mail-actions">
          <button type="button" class="kom-btn" id="komCopy">Скопіювати текст</button>
          <a class="kom-btn kom-btn-ghost" id="komMailto" href="#">Відкрити в пошті</a>
          <span class="kom-copied" id="komCopied" hidden>скопійовано</span>
        </div>
      </div>
    </div>

    <div class="kom-sections">
      ${sections.map((s) => `
        <article class="kom-sec" id="kom-${esc(s.id)}">
          <h3><span aria-hidden="true">${esc(s.icon || "")}</span> ${esc(s.title)}</h3>
          <ul class="kom-rules">${(s.rules || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
          ${s.script ? `<blockquote class="kom-script">${esc(s.script)}</blockquote>` : ""}
          ${(s.examples || []).length ? `
            <div class="kom-ex">
              <div class="kom-ex-head">Приклади</div>
              ${s.examples.map((e) => `
                <p class="kom-ex-item ${e.ok ? "is-ok" : "is-no"}"><span aria-hidden="true">${e.ok ? "✅" : "⛔"}</span> ${esc(e.text)}</p>`).join("")}
            </div>` : ""}
        </article>`).join("")}
    </div>

    <p class="va-source">${esc(guide.doc_ref || "")}${c.examples_note ? ` ${esc(c.examples_note)}` : ""}</p>`;

  $("komScen").addEventListener("change", runKom);
  $("komDate").addEventListener("change", runKom);
  $("komBody").querySelectorAll(".kom-flag input").forEach((i) => i.addEventListener("change", runKom));
  $("komBody").querySelectorAll("[data-mail]").forEach((i) => {
    i.addEventListener("input", renderMail);
    i.addEventListener("change", renderMail);
  });
  $("komCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("komMailText").textContent);
      $("komCopied").hidden = false;
      setTimeout(() => { $("komCopied").hidden = true; }, 1800);
    } catch (e) { /* буфер недоступний — текст видно, його можна виділити */ }
  });
  $("komDate").value = new Date().toISOString().slice(0, 10);
  runKom();
}

function runKom() {
  const calc = guide.content.calc || {};
  const sc = (calc.scenarios || []).find((s) => s.id === $("komScen").value);
  if (!sc) return;

  $("komDateWrap").hidden = !sc.deadline;
  $("komDateLabel").textContent = sc.date_label || "Дата";

  const flags = [...$("komBody").querySelectorAll(".kom-flag input:checked")]
    .map((i) => (calc.flags || []).find((f) => f.id === i.value)).filter(Boolean);
  const stops = flags.filter((f) => f.effect === "stop");
  const warns = flags.filter((f) => f.effect !== "stop");
  const vKey = stops.length ? "stop" : sc.verdict;
  const v = (calc.verdicts || {})[vKey] || { tone: "warn", title: "" };

  let dateHtml = "";
  const when = parseDate($("komDate").value);
  if (sc.deadline && when) {
    const d = sc.deadline;
    const due = d.type === "before_cal" ? addDays(when, -d.n) : addWorkdays(when, d.n);
    const today = parseDate(new Date().toISOString().slice(0, 10));
    const late = d.type === "before_cal" && due < today;
    // «За три дні» до події може припасти на вихідний — тоді підказуємо
    // попередній робочий день: у суботу запит на press@ ніхто не опрацює.
    let prevWd = null;
    if (d.type === "before_cal" && !isWorkday(due)) {
      prevWd = new Date(due.getTime());
      while (!isWorkday(prevWd)) prevWd.setUTCDate(prevWd.getUTCDate() - 1);
    }
    dateHtml = `
      <div class="va-calc-big">
        <span class="va-calc-label">${esc(d.label)}</span>
        <strong>${fmtLong(due)}</strong>
        ${prevWd && !late ? `<span class="va-calc-sub">неробочий день — краще не пізніше ${fmtLong(prevWd)}</span>` : ""}
        ${late ? `<span class="va-calc-sub va-calc-warn">цей день уже минув — погоджуйте якнайшвидше, терміново — телефоном</span>` : ""}
      </div>`;
  }

  $("komOut").innerHTML = `
    <div class="kom-verdict is-${esc(v.tone)}">${v.tone === "stop" ? "⛔ " : v.tone === "ok" ? "✅ " : "⚠️ "}${esc(v.title)}</div>
    ${stops.length ? `<ul class="kom-alerts is-stop">${stops.map((f) => `<li>${esc(f.msg)}</li>`).join("")}</ul>
      <p class="kom-hint">Приберіть цю інформацію з матеріалу чи розмови — тоді помічник покаже кроки погодження.</p>` : `
    ${dateHtml ? `<div class="va-calc-main">${dateHtml}</div>` : ""}
    <ol class="va-calc-chain">${(sc.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`}
    ${warns.length ? `<ul class="kom-alerts">${warns.map((f) => `<li>${esc(f.msg)}</li>`).join("")}</ul>` : ""}`;

  $("komMail").hidden = !sc.email || vKey === "stop";
  if (!$("komMail").hidden) {
    const w = $("komBody").querySelector('[data-mail="when"]');
    if (w && !w.dataset.touched && when) w.value = fmt(when);
    const f = $("komBody").querySelector('[data-mail="format"]');
    if (f && !f.dataset.touched) f.value = sc.format_default || (f.options[0] && f.options[0].value) || "";
    renderMail();
  }
}

function renderMail() {
  const c = guide.content;
  const mail = (c.calc || {}).email || {};
  const val = (id) => {
    const el = $("komBody").querySelector(`[data-mail="${id}"]`);
    return el && el.value.trim() ? el.value.trim() : "…";
  };
  const act = document.activeElement;
  if (act && act.dataset && act.dataset.mail) act.dataset.touched = "1";
  const sc = (c.calc.scenarios || []).find((s) => s.id === $("komScen").value);
  const what = sc && sc.id === "event" ? "публічний виступ" : "взаємодію з медіа";
  const body = [
    "Доброго дня!",
    "",
    `Прошу погодити ${what}:`,
    ...(mail.fields || []).map((f) => `• ${f.label}: ${val(f.id)}`),
    "",
    "З повагою,",
  ].join("\n");
  $("komMailText").textContent = `Тема: ${mail.subject || ""}\n\n${body}`;
  $("komMailto").href = `mailto:${c.press_email}?subject=${encodeURIComponent(mail.subject || "")}&body=${encodeURIComponent(body)}`;
}

/* ──────────────────────────────────────────────────────────────
   Вкладки та події
   ────────────────────────────────────────────────────────────── */
const VIEWS = [
  { tab: "tabStroky", view: "viewStroky" },
  { tab: "tabHto", view: "viewHto" },
  { tab: "tabKom", view: "viewKom" },
];

function switchTo(id) {
  VIEWS.forEach(({ tab, view }) => {
    const on = tab === id;
    $(tab).classList.toggle("is-active", on);
    $(tab).setAttribute("aria-selected", String(on));
    $(view).classList.toggle("is-visible", on);
    $(view).hidden = !on;
  });
  const hash = { tabStroky: "", tabHto: "#hto", tabKom: "#komunikatsiia" }[id];
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
if (location.hash === "#komunikatsiia") switchTo("tabKom");

loadStroky();
loadUnits();
loadGuide();

// Локальний перегляд вкладки «Комунікація» до заливки в базу: сід лежить у
// _seeds_local (поза git), http.server його віддає. На проді хука немає.
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  window.__komPreview = (g) => { guide = g; renderGuide(); };
}

// Вхід або вихід без перезавантаження — перечитуємо закриті таблиці
(async () => {
  const sb = await client();
  if (sb && sb.auth) sb.auth.onAuthStateChange(() => { loadUnits(); loadGuide(); });
})();
