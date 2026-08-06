/* Кодування реабілітації — наказ НСЗУ № 182 від 16.04.2026.

   Дані — algorithms/data/rehab_182.json зі скрипта build_rehab.py: правила й
   приклади з тексту наказу, коди з Додатка (лише видимі стовпчики).

   Головне, що має розуміти читач сторінки: у Додатку НЕМАЄ стовпчика групи
   порушень. Тому зв'язок «код → група» ми не вигадуємо, а показуємо рівно там,
   де код прямо названий у правилі або в прикладі, і завжди з посиланням на це
   місце. Решта кодів чесно лишається без групи. */

const DATA_VERSION = "20260806a";   // піднімати разом із перезбіркою даних

const state = {
  data: null,
  visible: [],
  selected: null,      // індекс запису в records
  group: null,         // відкрита група в читалці
  byCode: new Map(),
};

const byId = (id) => document.getElementById(id);
const norm = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();

function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function highlight(value, query) {
  const safe = esc(value);
  if (!query || query.length < 2) return safe;
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

function formatDate(value) {
  if (!value) return "";
  const [y, m, d] = String(value).split("-");
  return d ? `${d}.${m}.${y}` : value;
}

const MAIN_TONE = { yes: "ok", postacute: "warm", conditional: "warn", no: "no" };
// Дозвіл бути основним діагнозом описано 12 формулюваннями на 1 624 коди, тому
// в записі лежить лише ключ до довідника, а статус — властивість формулювання.
const wording = (record) => state.data.wordings[record.w] || { text: "", status: "conditional" };
const status = (record) => wording(record).status;
// Класи в CSS латиницею: ключі категорій кириличні, а мішати абетки в іменах
// класів — напрошуватися на суперечку С-кирилична проти C-латинської.
const CAT_SLUG = { "ФО": "fo", "ПП": "pp", "СП": "sp", "С": "st", "СФЗ": "sfz" };
const slug = (key) => CAT_SLUG[key] || "st";
const CAT_TITLE = {};
const CAT_NOTE = {};
const MAIN_TITLE = {};

/* Алгоритм і заборони з розділу ІІ наказу. Тримаємо в коді, а не в даних:
   це не таблиця, а текст на чотири рядки, і він змінюється разом із наказом. */
const STEPS = [
  "Що саме потребує реабілітації? Геміпарез, біль, слабкість, порушення ходи, обмеження рухів — це функціональне обмеження.",
  "Яка причина цього обмеження? Встановити етіологічний діагноз: геміпарез — інсульт, біль — радикулопатія.",
  "Код етіології (першопричини), як правило, і зазначається основним діагнозом.",
  "Якщо станів кілька — основним беруть той, що спричинив найвиразніше обмеження і потребує найбільшого обсягу втручань.",
];
const NOTS = [
  "Коди симптомів і проявів — якщо причину обмеження встановлено.",
  "Коди статусу пацієнта — окрім випадків, коли саме вони описують стан, що спричинив обмеження (набута відсутність кінцівки).",
  "Коди ізольованого болю без структурної патології — за окремими винятками.",
  "Коди соціально-функціональної залежності від догляду — без медичних підстав.",
];

/* ── посилання назовні ───────────────────────────────────────── */
const icdHref = (code) => `../classifiers/index.html?q=${encodeURIComponent(code)}`;

function codeBadge(code, options = {}) {
  const known = state.byCode.has(code);
  const title = known ? state.byCode.get(code).name : "Немає в Додатку до наказу";
  return `<button class="code-badge rehab-code${known ? "" : " rehab-code--unknown"}"
      type="button" data-code="${esc(code)}" title="${esc(title)}">${esc(code)}${
      options.mark ? esc(options.mark) : ""}</button>`;
}

/* Коди всередині тексту правила робимо клікабельними — інакше правило
   лишається текстом, який доводиться перечитувати очима. */
const CODE_RE = /\b([A-Z]\d{2}(?:\.\d{1,2})?)([†*])?/g;
function linkifyCodes(text) {
  let out = "";
  let last = 0;
  const source = String(text || "");
  source.replace(CODE_RE, (match, code, mark, offset) => {
    out += esc(source.slice(last, offset));
    out += codeBadge(code, { mark: mark || "" });
    last = offset + match.length;
    return match;
  });
  return out + esc(source.slice(last));
}

/* ── шапка та довідкові панелі ───────────────────────────────── */
function renderStats() {
  const { totals, meta } = state.data;
  byId("rehabStats").innerHTML = [
    [totals.groups, "груп порушень"],
    [totals.rules, "правил CR"],
    [totals.codes.toLocaleString("uk-UA"), "кодів у Додатку"],
    [totals.examples, "прикладів кодування"],
    [formatDate(meta.order.effective), "застосовується з"],
  ].map(([value, label]) =>
    `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join("");
}

function renderGroupList() {
  byId("rehabGroups").innerHTML = state.data.groups.map((group) => `
    <button class="rehab-group-btn${state.group === group.n ? " active" : ""}"
        type="button" data-group="${group.n}">
      <span class="rehab-group-n">${group.n}</span>
      <span class="rehab-group-copy">
        <strong>${esc(group.title)}</strong>
        <em>${group.rules.length} правил · ${group.examples.length} прикладів${
          group.subgroups.length ? ` · ${group.subgroups.length} підгруп` : ""}</em>
      </span>
    </button>`).join("");
  byId("rehabGroups").querySelectorAll("[data-group]").forEach((button) =>
    button.addEventListener("click", () => selectGroup(Number(button.dataset.group))));
}

function renderLegends() {
  byId("rehabSteps").innerHTML = STEPS.map((step) => `<li>${esc(step)}</li>`).join("");
  byId("rehabNots").innerHTML = NOTS.map((item) => `<li>${esc(item)}</li>`).join("");

  byId("rehabCats").innerHTML = state.data.categories.map((cat) => `
    <button class="rehab-cat" type="button" data-cat="${esc(cat.key)}">
      <span class="rehab-cat-head">
        <span class="rehab-pill rehab-pill--${slug(cat.key)}">${esc(cat.column)}</span>
        <strong>${esc(cat.title)}</strong>
        <em>${cat.count} кодів</em>
      </span>
      <span class="rehab-cat-note">${esc(cat.note)}</span>
    </button>`).join("");
  byId("rehabCats").querySelectorAll("[data-cat]").forEach((button) =>
    button.addEventListener("click", () => {
      byId("rehabCat").value = button.dataset.cat === byId("rehabCat").value ? "" : button.dataset.cat;
      apply();
    }));

  const gaps = state.data.gaps;
  const linked = state.data.totals.linked;
  byId("rehabSource").innerHTML = `
    <p><b>Групи порушень у Додатку немає.</b> Наказ дає 16 груп у тексті, а Додаток —
       категорію коду, дозвіл бути основним діагнозом і формулу. Тому групу показуємо лише
       там, де код прямо названий у правилі або прикладі: таких
       <b>${linked}</b> із ${state.data.totals.codes.toLocaleString("uk-UA")}.</p>
    <p class="rehab-dim">Приховані (робочі) стовпчики Додатка — групи СР/АР за 2025 рік,
       колонка 2026 та колонка без заголовка — на портал не виводяться.</p>
    ${gaps.orphans.length ? `<details class="rehab-details">
      <summary>Наказ згадує, а Додаток не містить — ${gaps.orphans.length} кодів</summary>
      <div class="rehab-badge-row">${gaps.orphans.map((code) => codeBadge(code)).join(" ")}</div>
    </details>` : ""}
    ${gaps.code_mismatch.length ? `<details class="rehab-details">
      <summary>Стовпчик «Код» розходиться з діагнозом — ${gaps.code_mismatch.length} рядків</summary>
      <ul class="rehab-gap-list">${gaps.code_mismatch.map((item) => `<li>
        рядок ${item.row}: у стовпчику <b>${esc(item.declared)}</b>, у діагнозі
        <b>${esc(item.used)}</b> — ${esc(item.name)}</li>`).join("")}</ul>
      <p class="rehab-dim">Ми беремо код із тексту діагнозу. Це питання до автора Додатка.</p>
    </details>` : ""}`;
  bindCodeBadges(byId("rehabSource"));
}

/* ── фільтри ────────────────────────────────────────────────── */
function fillFilters() {
  byId("rehabGroup").innerHTML = '<option value="">Усі групи</option>' +
    state.data.groups.map((group) =>
      `<option value="${group.n}">(${group.n}) ${esc(group.title)} — ${group.codes.length} кодів</option>`).join("");
  byId("rehabCat").innerHTML = '<option value="">Будь-яка</option>' +
    state.data.categories.map((cat) =>
      `<option value="${esc(cat.key)}">${esc(cat.column)} — ${esc(cat.title)} (${cat.count})</option>`).join("");
  byId("rehabMain").innerHTML = '<option value="">Будь-який статус</option>' +
    state.data.main_status.filter((item) => item.count).map((item) =>
      `<option value="${esc(item.key)}">${esc(item.title)} (${item.count})</option>`).join("");
}

function haystack(record) {
  if (record._h) return record._h;
  record._h = norm([record.code, record.code_to, record.name, wording(record).text,
    (record.in_rules || []).join(" ")].filter(Boolean).join(" "));
  return record._h;
}

function apply() {
  const raw = byId("rehabSearch").value.trim();
  const query = norm(raw);
  const group = byId("rehabGroup").value;
  const cat = byId("rehabCat").value;
  const main = byId("rehabMain").value;

  // Набране «CR_1_2» — це не пошук по кодах, а запит на конкретне правило.
  const ruleMatch = raw.match(/^CR[_\s]?(\d{1,2})[_\s]?(\d{1,2})$/i);
  if (ruleMatch) {
    const id = `CR_${ruleMatch[1]}_${ruleMatch[2]}`;
    if (state.data.groups.some((g) => g.rules.some((r) => r.id === id))) {
      selectGroup(Number(ruleMatch[1]), id);
    }
  }

  const groupCodes = group
    ? new Set(state.data.groups[Number(group) - 1].codes)
    : null;

  state.visible = state.data.records.filter((record) => {
    if (groupCodes && !groupCodes.has(record.code)) return false;
    if (cat && !record.cats.includes(cat)) return false;
    if (main && status(record) !== main) return false;
    return !query || haystack(record).includes(query);
  });

  byId("rehabCount").textContent = state.visible.length
    ? `Знайдено ${state.visible.length}`
    : "Нічого не знайдено";
  byId("mobileCount").textContent = state.visible.length ? `(${state.visible.length})` : "";
  renderCards(query);
}

/* ── список ─────────────────────────────────────────────────── */
function renderCards(query) {
  const cards = state.visible.slice(0, 300).map((record) => `
    <button class="algorithm-card${state.selected === record.i ? " active" : ""}"
        type="button" data-index="${record.i}">
      <div class="algorithm-card-header">
        <span class="algorithm-code">${highlight(record.code + (record.code_to ? "–" + record.code_to : ""), query)}</span>
        <span class="rehab-main-dot rehab-main-dot--${MAIN_TONE[status(record)]}"
              title="${esc(wording(record).text)}">${esc(MAIN_TITLE[status(record)] || "")}</span>
      </div>
      <div class="algorithm-card-main">
        <strong>${highlight(record.name, query)}</strong>
        <div class="rehab-pill-row">
          ${record.cats.map((key) =>
            `<span class="rehab-pill rehab-pill--${slug(key)}" title="${esc(CAT_NOTE[key] || "")}">${esc(key)}</span>`).join("")}
          ${(record.g || []).map((n) =>
            `<span class="rehab-pill rehab-pill--group">група ${n}</span>`).join("")}
        </div>
      </div>
    </button>`).join("");

  byId("rehabCards").innerHTML = cards ||
    '<p class="reader-empty">Нічого не знайдено. Спробуйте інший код або зніміть фільтри.</p>';
  if (state.visible.length > 300) {
    byId("rehabCards").insertAdjacentHTML("beforeend",
      `<p class="rehab-more">Показано перші 300 із ${state.visible.length}. Звузьте пошук.</p>`);
  }
  byId("rehabCards").querySelectorAll("[data-index]").forEach((button) =>
    button.addEventListener("click", () => selectCode(Number(button.dataset.index))));
}

/* ── формула як ланцюжок ────────────────────────────────────── */
function renderFormula(record) {
  const formula = state.data.formulas[record.f];
  if (!formula) return "";
  const chain = formula.parts.map((part) => `
    <span class="rehab-chain-op">плюс</span>
    <span class="rehab-chain-slot">
      ${part.alts.map((alt) => alt.kind === "star"
        ? '<span class="rehab-pill rehab-pill--star">*-код</span>'
        : `<button class="rehab-pill rehab-pill--${slug(alt.cat)} rehab-pill-btn" type="button"
             data-cat="${esc(alt.cat)}" title="Показати всі коди категорії ${esc(alt.cat)}"
             >Діагноз_${esc(alt.cat)}</button>`).join('<span class="rehab-chain-or">або</span>')}
    </span>`).join("");
  return `
    <div class="amb-section-title">Формула кодування випадку</div>
    <div class="rehab-chain">
      <span class="rehab-chain-head">${esc(record.code)}</span>${chain}
    </div>
    <p class="rehab-dim">${esc(formula.text)}</p>`;
}

/* ── паспорт коду ───────────────────────────────────────────── */
function selectCode(index) {
  const record = state.data.records[index];
  if (!record) return;
  state.selected = index;
  state.group = null;

  const mentions = [];
  (record.in_rules || []).forEach((id) => {
    const group = state.data.groups[Number(id.split("_")[1]) - 1];
    const rule = group && group.rules.find((r) => r.id === id);
    if (rule) {
      mentions.push(`<button class="rehab-mention" type="button" data-group="${group.n}" data-rule="${esc(id)}">
        <b>${esc(id)}</b> <span>група (${group.n}) ${esc(group.title)}</span>
        <em>${esc(rule.text.slice(0, 150))}…</em></button>`);
    }
  });

  const examples = (record.in_examples || []).map((hit) => {
    const group = state.data.groups[hit.g - 1];
    const example = group && group.examples.find((e) => e.n === hit.n && sameRole(e, record.code, hit.role));
    if (!group || !example) return "";
    return exampleCard(example, group, record.code);
  }).filter(Boolean);

  const groupLinks = (record.g || []).map((n) => {
    const group = state.data.groups[n - 1];
    return `<button class="rehab-pill rehab-pill--group rehab-pill-btn" type="button"
      data-group="${n}">(${n}) ${esc(group.title)}</button>`;
  }).join(" ");

  byId("rehabReader").classList.remove("reader-empty");
  byId("rehabReader").innerHTML = `
    <h2>${esc(record.code)}${record.code_to ? `–${esc(record.code_to)}` : ""}${esc(record.mark || "")}</h2>
    <p class="amb-name">${esc(record.name)}</p>
    <div class="algorithm-meta">
      ${record.cats.map((key) => `<span class="rehab-pill rehab-pill--${slug(key)}"
        title="${esc(CAT_NOTE[key] || "")}">Діагноз_${esc(key)} · ${esc(CAT_TITLE[key] || "")}</span>`).join("")}
      ${record.cats.length ? "" : '<span class="rehab-pill">Категорію не позначено</span>'}
    </div>

    <div class="rehab-verdict rehab-verdict--${MAIN_TONE[status(record)]}">
      <span class="rehab-verdict-title">${esc(MAIN_TITLE[status(record)] || "")}</span>
      <p>${esc(wording(record).text || "—")}</p>
    </div>

    ${renderFormula(record)}

    <div class="amb-section-title">Група порушень</div>
    ${groupLinks
      ? `<div class="rehab-badge-row">${groupLinks}</div>
         <p class="rehab-dim">Зв'язок узято з тексту наказу: цей код прямо названий у правилі або прикладі.</p>`
      : `<p class="rehab-dim">Наказ не називає цей код у правилах чи прикладах, а Додаток стовпчика групи
         не має — тож групу порушень визначає експерт за домінуючим функціональним обмеженням.</p>`}

    ${mentions.length ? `<div class="amb-section-title">Правила, де цей код названо</div>
      <div class="rehab-mentions">${mentions.join("")}</div>` : ""}

    ${examples.length ? `<div class="amb-section-title">Приклади кодування з цим кодом</div>
      <div class="rehab-examples">${examples.join("")}</div>` : ""}

    <div class="amb-section-title">Куди далі</div>
    <div class="algorithm-actions">
      <a class="action" href="${icdHref(record.code)}" target="_blank" rel="noopener">Код у НК 025 ↗</a>
      <a class="action" href="../passport/index.html?package=53">Пакет 53</a>
      <a class="action" href="../passport/index.html?package=54">Пакет 54</a>
      <button class="action primary" type="button" id="rehabCopy">Скопіювати висновок</button>
    </div>
    <p class="rehab-dim">Рядок ${record.row} Додатка до наказу № ${esc(state.data.meta.order.number)}
       від ${formatDate(state.data.meta.order.date)}.</p>`;

  byId("rehabCopy").addEventListener("click", () => copySummary(record));
  bindReader();
  renderCards(norm(byId("rehabSearch").value));
  renderGroupList();
  if (window.matchMedia("(max-width: 1180px)").matches) setTab("reader");
}

function sameRole(example, code, role) {
  const list = role === "main" ? example.main_dx : example.extra_dx;
  return (list || []).some((item) => item.code === code);
}

function exampleCard(example, group, focus) {
  const line = (item) => `<li>${codeBadge(item.code, { mark: item.mark })}
    <span${item.code === focus ? ' class="rehab-focus"' : ""}>${esc(item.name)}</span></li>`;
  return `<div class="rehab-example">
    <div class="rehab-example-head">
      <span class="rehab-pill rehab-pill--group">група ${group.n}${example.sub ? ` · ${esc(example.sub)}` : ""}</span>
      <b>Приклад ${example.n}</b>
      ${example.label ? `<em>${esc(example.label)}</em>` : ""}
    </div>
    <div class="rehab-example-body">
      <div><span class="rehab-example-label">Основний</span>
        <ul>${(example.main_dx || []).map(line).join("")}</ul></div>
      ${(example.extra_dx || []).length ? `<div><span class="rehab-example-label">Додаткові</span>
        <ul>${example.extra_dx.map(line).join("")}</ul></div>` : ""}
    </div>
    ${example.note ? `<p class="rehab-dim">${esc(example.note)}</p>` : ""}
  </div>`;
}

/* ── паспорт групи ──────────────────────────────────────────── */
function selectGroup(number, focusRule) {
  const group = state.data.groups[number - 1];
  if (!group) return;
  state.group = number;
  state.selected = null;

  const rules = group.rules.map((rule) => `
    <div class="rehab-rule${focusRule === rule.id ? " rehab-rule--focus" : ""}" id="rule-${esc(rule.id)}">
      <div class="rehab-rule-head">
        <span class="rehab-rule-id">${esc(rule.id)}</span>
        <span class="rehab-rule-date">запроваджено ${formatDate(rule.date)}</span>
      </div>
      <p>${linkifyCodes(rule.text)}</p>
    </div>`).join("");

  const subgroups = group.subgroups.length ? `
    <div class="amb-section-title">Підгрупи</div>
    <ul class="rehab-subgroups">
      ${group.subgroups.map((sub) => `<li><b>(${esc(sub.id)})</b> ${esc(sub.title)}
        ${sub.note ? `<span class="rehab-dim">— ${esc(sub.note)}</span>` : ""}</li>`).join("")}
    </ul>` : "";

  byId("rehabReader").classList.remove("reader-empty");
  byId("rehabReader").innerHTML = `
    <h2>(${group.n}) ${esc(group.title)}</h2>
    <div class="algorithm-meta">
      <span class="rehab-pill rehab-pill--group">${group.rules.length} правил</span>
      <span class="rehab-pill">${group.examples.length} прикладів</span>
      <span class="rehab-pill">${group.codes.length} кодів у тексті</span>
    </div>
    ${subgroups}
    <div class="amb-section-title">Правила кодування</div>
    <div class="rehab-rules">${rules}</div>
    ${group.examples.length ? `<div class="amb-section-title">Приклади правильного кодування</div>
      <div class="rehab-examples">${group.examples.map((example) => exampleCard(example, group)).join("")}</div>` : ""}
    <div class="amb-section-title">Куди далі</div>
    <div class="algorithm-actions">
      <button class="action" type="button" id="rehabFilterGroup">Показати коди цієї групи</button>
      <a class="action" href="../passport/index.html?package=53">Пакет 53</a>
      <a class="action" href="../passport/index.html?package=54">Пакет 54</a>
    </div>`;

  byId("rehabFilterGroup").addEventListener("click", () => {
    byId("rehabGroup").value = String(group.n);
    apply();
    if (window.matchMedia("(max-width: 1180px)").matches) setTab("results");
  });
  bindReader();
  renderGroupList();
  if (focusRule) {
    const node = byId(`rule-${focusRule}`);
    if (node) node.scrollIntoView({ block: "center" });
  }
  if (window.matchMedia("(max-width: 1180px)").matches) setTab("reader");
}

/* ── спільні прив'язки ──────────────────────────────────────── */
function bindCodeBadges(root) {
  root.querySelectorAll("[data-code]").forEach((button) =>
    button.addEventListener("click", () => {
      const record = state.byCode.get(button.dataset.code);
      if (record) selectCode(record.i);
    }));
}

function bindReader() {
  const reader = byId("rehabReader");
  bindCodeBadges(reader);
  reader.querySelectorAll("[data-group]").forEach((button) =>
    button.addEventListener("click", () => selectGroup(Number(button.dataset.group),
      button.dataset.rule || undefined)));
  reader.querySelectorAll(".rehab-pill-btn[data-cat]").forEach((button) =>
    button.addEventListener("click", () => {
      byId("rehabCat").value = button.dataset.cat;
      byId("rehabGroup").value = "";
      apply();
      if (window.matchMedia("(max-width: 1180px)").matches) setTab("results");
    }));
}

function copySummary(record) {
  const formula = state.data.formulas[record.f];
  const order = state.data.meta.order;
  const lines = [
    `${record.code}${record.code_to ? "–" + record.code_to : ""} — ${record.name}`,
    record.cats.length ? `Категорія: ${record.cats.map((key) => `Діагноз_${key} (${CAT_TITLE[key]})`).join(", ")}` : "",
    `Основний діагноз: ${wording(record).text || "—"}`,
    formula ? `Формула кодування: ${record.code} ${formula.text}` : "",
    (record.g || []).length
      ? `Групи порушень, де код названо: ${record.g.map((n) => `(${n}) ${state.data.groups[n - 1].title}`).join("; ")}`
      : "Групу порушень наказ для цього коду прямо не називає.",
    (record.in_rules || []).length ? `Правила: ${record.in_rules.join(", ")}` : "",
    `Підстава: наказ ${order.agency} № ${order.number} від ${formatDate(order.date)}, `
      + `Додаток, рядок ${record.row}; правила застосовуються з ${formatDate(order.effective)}.`,
  ].filter(Boolean);
  navigator.clipboard.writeText(lines.join("\n")).then(() => {
    const button = byId("rehabCopy");
    button.textContent = "Скопійовано ✓";
    setTimeout(() => { button.textContent = "Скопіювати висновок"; }, 1600);
  });
}

/* ── мобільні вкладки ───────────────────────────────────────── */
function setTab(tab) {
  document.querySelector(".algorithms-layout").dataset.active = tab;
  document.querySelectorAll(".mobile-tab").forEach((button) =>
    button.classList.toggle("active", button.dataset.tab === tab));
}

/* ── старт ──────────────────────────────────────────────────── */
async function init() {
  // Мітку піднімати щоразу після build_rehab.py — інакше сторінка малює свіжим
  // кодом учорашні дані: файли в /data/ ходять без версії і осідають у кеші
  // браузера й воркера (та сама пастка, що ловила розділ обладнання 04.08.2026).
  const response = await fetch(`data/rehab_182.json?v=${DATA_VERSION}`);
  state.data = await response.json();

  state.data.categories.forEach((cat) => {
    CAT_TITLE[cat.key] = cat.title;
    CAT_NOTE[cat.key] = cat.note;
  });
  state.data.main_status.forEach((item) => { MAIN_TITLE[item.key] = item.title; });
  state.data.records.forEach((record, index) => {
    record.i = index;                       // збірка більше не пише індекс у файл
    if (!state.byCode.has(record.code)) state.byCode.set(record.code, record);
  });

  renderStats();
  renderGroupList();
  renderLegends();
  fillFilters();

  byId("rehabSearch").addEventListener("input", apply);
  ["rehabGroup", "rehabCat", "rehabMain"].forEach((id) =>
    byId(id).addEventListener("change", apply));
  byId("rehabClear").addEventListener("click", () => {
    byId("rehabSearch").value = "";
    byId("rehabGroup").value = "";
    byId("rehabCat").value = "";
    byId("rehabMain").value = "";
    apply();
  });
  document.querySelectorAll(".mobile-tab").forEach((button) =>
    button.addEventListener("click", () => setTab(button.dataset.tab)));

  apply();

  const params = new URLSearchParams(location.search);
  const group = params.get("group");
  const code = params.get("code");
  const query = params.get("q");
  if (query) {
    byId("rehabSearch").value = query;
    apply();
  }
  if (code && state.byCode.has(code.toUpperCase())) {
    selectCode(state.byCode.get(code.toUpperCase()).i);
  } else if (group) {
    selectGroup(Number(group));
  }
}

init().catch((error) => {
  byId("rehabCount").textContent = "Не вдалося завантажити дані розділу.";
  console.error(error);
});
