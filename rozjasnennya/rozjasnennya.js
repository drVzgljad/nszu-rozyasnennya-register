/* Роз'яснення НСЗУ: реєстр → паспорт → текст до речення → таблиці → зв'язки.
   Дані: data/index.json (картки), docs/<id>.json (текст), tables/<id>.json,
   graph.json (зв'язки). Важкі файли тягнуться лениво, по документу.

   Вердикти експертів щодо гіпотез «скасовує / доповнює» живуть у Supabase
   (clarification_links) і накладаються поверх статичного graph.json. Публічний
   вигляд бере статуси з graph.json — його щодоби перезбирає пайплайн, тягнучи
   підтверджені рішення з тієї ж таблиці. */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = (window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY)));

/* Вердикт про чинність нормативного роз'яснення — не для випадкового
   користувача; та сама межа, що й у RLS-політиці таблиці. */
const DECIDER_ROLES = ['manager', 'deputy_director', 'director', 'admin'];

const state = {
  index: null,
  graph: null,
  visible: [],
  selected: null,
  doc: null,
  tables: null,
  tab: "passport",
  readerQuery: "",
  matches: [],
  matchIndex: -1,
  decisions: new Map(),   // edge_key → 'confirmed' | 'rejected'
  me: null,               // { id, name, role } або null для гостя
};

const el = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Читання JSON з однією повторною спробою.
   Важливо відрізняти «файлу немає» (404 — у документа просто нема таблиць)
   від «не змогли дістати» (обрив з'єднання). Раніше і те, і те виглядало як
   «таблиць немає», і збій мережі мовчки прикидався порожнім документом. */
async function fetchJson(url, { retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (response.status === 404) return { value: null, failed: false };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { value: await response.json(), failed: false };
    } catch (error) {
      if (attempt === retries) {
        console.warn(`Не вдалося прочитати ${url}:`, error);
        return { value: null, failed: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  return { value: null, failed: true };
}

const KIND_LABEL = {
  icd: "МКХ-10", achi: "НК 026", esoz: "ЕСОЗ", drg: "сервіс",
  position: "посада", loinc: "LOINC", odk: "ОДК", package: "пакет",
};

/* Куди веде код в екосистемі порталу */
function codeHref(kind, code) {
  const q = encodeURIComponent(code);
  if (kind === "icd") return `../classifiers/index.html?q=${q}`;
  if (kind === "achi") return `../classifiers/nk026.html?q=${q}`;
  if (kind === "loinc") return `../classifiers/loinc.html?q=${q}`;
  if (kind === "esoz" || kind === "drg") return `../mapping/index.html?q=${q}`;
  if (kind === "odk") return `../mapping/index.html?odk=${q}`;
  if (kind === "package") return `../pakety/index.html?package=${q}`;
  return null;
}

function formatDate(value) {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  return `${d}.${m}.${y}`;
}

/* ── вердикти експертів ────────────────────────────────────── */
const edgeKey = (edge) => `${edge.from}→${edge.to}:${edge.relation}`;

/* Статус ребра = статичний із graph.json, поверх нього — свіжий вердикт */
function edgeStatus(edge) {
  const decision = state.decisions.get(edgeKey(edge));
  if (decision === "confirmed") return "confirmed";
  if (decision === "rejected") return "rejected";
  return edge.status;
}

const canDecide = () => Boolean(state.me && DECIDER_ROLES.includes(state.me.role));

async function loadMe() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data } = await sb.from("profiles")
      .select("id, role, full_name").eq("id", session.user.id).single();
    if (!data) return null;
    return { id: data.id, role: data.role, name: data.full_name || session.user.email };
  } catch (error) {
    return null;             // гість або збій — просто без кнопок вердикту
  }
}

async function loadDecisions() {
  if (!state.me) return;     // RLS: читати таблицю можуть лише авторизовані
  try {
    const { data } = await sb.from("clarification_links").select("edge_key, decision");
    (data || []).forEach((row) => state.decisions.set(row.edge_key, row.decision));
  } catch (error) {
    console.warn("Вердикти не завантажилися:", error);
  }
}

async function decide(edge, decision) {
  const key = edgeKey(edge);
  const row = {
    edge_key: key,
    from_id: edge.from,
    to_id: edge.to,
    relation: edge.relation,
    decision,
    evidence: (edge.evidence || "").slice(0, 1000),
    decided_by: state.me.id,
    decided_by_name: state.me.name,
  };
  const { error } = await sb.from("clarification_links")
    .upsert(row, { onConflict: "edge_key" });
  if (error) {
    alert(`Не вдалося зберегти вердикт: ${error.message}`);
    return;
  }
  state.decisions.set(key, decision);
  renderDetail({ tab: "links" });
  renderCards();
}

async function undecide(edge) {
  const key = edgeKey(edge);
  const { error } = await sb.from("clarification_links").delete().eq("edge_key", key);
  if (error) {
    alert(`Не вдалося скасувати вердикт: ${error.message}`);
    return;
  }
  state.decisions.delete(key);
  renderDetail({ tab: "links" });
  renderCards();
}

/* ── стан чинності з графа ─────────────────────────────────── */
function docState(id) {
  if (!state.graph) return "чинне";
  const incoming = state.graph.edges
    .filter((e) => e.to === id && (e.relation === "скасовує" || e.relation === "доповнює"))
    .map((e) => ({ ...e, status: edgeStatus(e) }))
    .filter((e) => e.status !== "rejected");
  if (incoming.some((e) => e.status === "confirmed")) return "замінено";
  if (incoming.length) return "потребує перевірки";
  return "чинне";
}

/* ── фільтри ───────────────────────────────────────────────── */
function currentFilters() {
  const query = el("rzSearch").value.trim().toLowerCase();
  return {
    query,
    codeDocs: looksLikeCode(query) ? docsWithCode(query) : null,
    pkg: el("fPackage").value,
    topic: el("fTopic").value,
    kind: el("fKind").value,
    year: el("fYear").value,
    docState: el("fState").value,
    flag: el("fFlag").value,
  };
}

/* ── пошук за кодом ────────────────────────────────────────────
   Рядок пошуку раніше дивився лише в назву, тему й номер листа, тож запит
   «I63.9», «40803-00» чи «47544-2» не знаходив нічого — а саме з кодом на руках
   експерт найчастіше й приходить. Зворотні індекси (код → документи) лежать
   готові поруч, але важать 1,4 МБ, тому вантажимо їх лише тоді, коли запит
   справді схожий на код. */
const CODE_QUERY_RE = /^(?:[A-ZА-ЯІЇЄҐ]\d{2}(?:\.\d{1,2})?|\d{5}-\d{2}|[A-ZА-ЯІЇЄҐ]\d{5}|\d{2,6}-\d|[PР]\d{1,3})$/i;
let codeIndexes = null;
let codeIndexPromise = null;

function looksLikeCode(query) {
  return CODE_QUERY_RE.test(query.trim());
}

function loadCodeIndexes() {
  if (codeIndexes) return Promise.resolve(codeIndexes);
  if (!codeIndexPromise) {
    codeIndexPromise = Promise.all([
      fetch("data/codes_index.json").then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch("data/codes_tables.json").then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([texts, tables]) => {
      codeIndexes = { texts: texts?.index || {}, tables: tables?.index || {} };
      return codeIndexes;
    });
  }
  return codeIndexPromise;
}

/** Множина id документів, де код згадано — у тексті або в таблиці додатка. */
function docsWithCode(query) {
  if (!codeIndexes) return null;
  const wanted = query.trim().toUpperCase();
  const found = new Set();
  for (const source of (["texts", "tables"])) {
    for (const byCode of Object.values(codeIndexes[source])) {
      const hits = byCode[wanted];
      if (!hits) continue;
      hits.forEach((hit) => found.add(typeof hit === "object" ? hit.d : hit));
    }
  }
  return found;
}

function matches(doc, f) {
  if (f.pkg && !(doc.packages || []).includes(f.pkg)) return false;
  if (f.topic && !(doc.topics || []).includes(f.topic)) return false;
  if (f.kind && doc.kind !== f.kind) return false;
  if (f.year && (doc.date || "").slice(0, 4) !== f.year) return false;
  if (f.docState && docState(doc.id) !== f.docState) return false;
  if (f.flag === "coding" && !doc.touches_coding) return false;
  if (f.flag === "tables" && !(doc.stats?.tables > 0)) return false;
  if (f.flag === "attachment" && !doc.is_attachment) return false;
  if (f.flag === "letters" && doc.is_attachment) return false;
  if (f.flag === "ocr" && !doc.ocr) return false;
  if (f.query && !doc._search.includes(f.query)) {
    // Запит-код: документ проходить, якщо код згадано в його тексті або таблиці
    if (!(f.codeDocs && f.codeDocs.has(doc.id))) return false;
  }
  return true;
}

function fillSelect(select, values, allLabel, format = (v) => v) {
  const previous = select.value;
  select.innerHTML = "";
  select.appendChild(new Option(allLabel, ""));
  values.forEach(([value, count]) =>
    select.add(new Option(`${format(value)} (${count})`, value)));
  if (previous && values.some(([v]) => v === previous)) select.value = previous;
}

function refreshFilters() {
  const f = currentFilters();
  const tally = (key, pick) => {
    const counter = new Map();
    state.index.documents
      .filter((d) => matches(d, { ...f, [key]: "" }))
      .forEach((d) => pick(d).forEach((v) => counter.set(v, (counter.get(v) || 0) + 1)));
    return [...counter.entries()];
  };

  const packages = tally("pkg", (d) => d.packages || [])
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  fillSelect(el("fPackage"), packages, "Усі пакети",
    (v) => `№ ${v} · ${(state.index.packageNames?.[v] || "").slice(0, 34)}`);

  fillSelect(el("fTopic"),
    tally("topic", (d) => d.topics || []).sort((a, b) => b[1] - a[1]).slice(0, 40),
    "Усі теми");
  fillSelect(el("fKind"),
    tally("kind", (d) => (d.kind ? [d.kind] : [])).sort((a, b) => b[1] - a[1]),
    "Усі типи");
  fillSelect(el("fYear"),
    tally("year", (d) => (d.date ? [d.date.slice(0, 4)] : [])).sort((a, b) => b[0].localeCompare(a[0])),
    "Усі роки");
}

function apply() {
  refreshFilters();
  const f = currentFilters();
  state.visible = state.index.documents.filter((d) => matches(d, f));
  state.visible.sort((a, b) => (b.date || "0000").localeCompare(a.date || "0000") || b.id - a.id);
  el("rzCount").textContent =
    `Знайдено ${state.visible.length} з ${state.index.documents.length}`;
  renderCards();
}

/* ── картки ────────────────────────────────────────────────── */
function snippet(doc, query) {
  if (!query || query.length < 3) return "";
  const index = doc._search.indexOf(query);
  if (index < 0) return "";
  const source = doc._searchRaw;
  const start = Math.max(0, index - 60);
  const end = Math.min(source.length, index + query.length + 90);
  return `<span class="rz-snippet">${start > 0 ? "…" : ""}${esc(source.slice(start, index))}` +
    `<mark>${esc(source.slice(index, index + query.length))}</mark>` +
    `${esc(source.slice(index + query.length, end))}${end < source.length ? "…" : ""}</span>`;
}

function renderCards() {
  const container = el("rzCards");
  if (!state.visible.length) {
    container.innerHTML = `<p class="rz-empty-note">За цими умовами нічого не знайдено.
      Спробуйте коротший запит або очистіть фільтри.</p>`;
    return;
  }
  const query = el("rzSearch").value.trim().toLowerCase();
  container.innerHTML = state.visible.slice(0, 300).map((doc) => {
    const st = docState(doc.id);
    const tags = [
      doc.date ? `<span class="rz-tag date">${formatDate(doc.date)}</span>` : "",
      doc.number ? `<span class="rz-tag num">№ ${esc(doc.number)}</span>` : "",
      doc.is_attachment ? '<span class="rz-tag dim">📎 додаток</span>' : "",
      doc.touches_coding ? '<span class="rz-tag">кодування</span>' : "",
      doc.stats?.tables ? `<span class="rz-tag">таблиць ${doc.stats.tables}</span>` : "",
      doc.ocr ? '<span class="rz-tag ocr">скан</span>' : "",
      st === "замінено" ? '<span class="rz-tag dim">замінено</span>' : "",
      st === "потребує перевірки" ? '<span class="rz-tag warn">є заявка на зміну</span>' : "",
      ...(doc.packages || []).slice(0, 3).map((p) => `<span class="rz-tag pkg">пакет ${p}</span>`),
    ].filter(Boolean).join("");
    /* Заголовок — ДОСЛІВНО як опубліковано в архіві НСЗУ. Коротка назва від
       моделі тут недопустима: за назвою людина шукає документ на сайті, і
       розбіжність робить реєстр недостовірним. */
    return `<button class="rz-card${state.selected === doc.id ? " active" : ""}"
      data-id="${doc.id}" data-state="${esc(st)}" type="button">
      <span class="rz-tags">${tags}</span>
      <strong>${highlight(doc.title, query)}</strong>
      <span class="rz-sub">${esc((doc.summary || "").slice(0, 150))}</span>
      ${snippet(doc, query)}
    </button>`;
  }).join("");
  container.querySelectorAll(".rz-card").forEach((card) =>
    card.addEventListener("click", () => select(Number(card.dataset.id))));
}

/* ── вибір документа ───────────────────────────────────────── */
async function select(id, options = {}) {
  state.selected = id;
  state.tab = options.tab || "passport";
  renderCards();
  const detail = el("rzDetail");
  detail.classList.remove("empty");
  detail.innerHTML = '<div class="rz-panel">Завантаження документа…</div>';
  document.querySelector(".rz-layout").dataset.active = "detail";
  syncMobileTabs();

  const [doc, tables] = await Promise.all([
    fetchJson(`data/docs/${id}.json`),
    fetchJson(`data/tables/${id}.json`),
  ]);
  if (state.selected !== id) return;      // користувач уже клікнув інший
  state.doc = doc.value;
  state.tables = tables.value;
  state.tablesFailed = tables.failed;
  renderDetail(options);
}

function card(id) {
  return state.index.documents.find((d) => d.id === id);
}

/* «Очистити» мусить прибирати і праву панель: інакше на екрані лишається
   відкритий документ, якого вже може не бути у відфільтрованому списку. */
function clearSelection() {
  state.selected = null;
  state.doc = null;
  state.tables = null;
  state.tablesFailed = false;
  state.readerQuery = "";
  const detail = el("rzDetail");
  detail.classList.add("empty");
  detail.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">і</div>
      <h2>Оберіть роз'яснення</h2>
      <p>Тут з'явиться паспорт документа, повний текст, таблиці додатків,
         знайдені коди й зв'язки з іншими листами.</p>
    </div>`;
  const url = new URL(location.href);
  ["doc", "b", "s"].forEach((key) => url.searchParams.delete(key));
  history.replaceState(null, "", url);
  document.querySelector(".rz-layout").dataset.active = "browser";
  syncMobileTabs();
}

function renderDetail(options = {}) {
  const doc = state.doc;
  const meta = card(state.selected) || {};
  if (!doc) {
    el("rzDetail").innerHTML =
      '<div class="rz-panel">Не вдалося завантажити текст документа.</div>';
    return;
  }
  const passport = doc.passport || {};
  const st = docState(doc.id);
  const edges = relatedEdges(doc.id);
  const tableRows = (state.tables?.tables || []).reduce((sum, t) => sum + t.rows.length, 0);

  el("rzDetail").innerHTML = `
    <div class="rz-head">
      <span class="rz-tags">
        ${passport.date ? `<span class="rz-tag date">${formatDate(passport.date)}</span>` : ""}
        ${passport.number ? `<span class="rz-tag num">№ ${esc(passport.number)}</span>` : ""}
        ${passport.kind ? `<span class="rz-tag">${esc(passport.kind)}</span>` : ""}
        <span class="rz-tag ${st === "чинне" ? "pkg" : st === "замінено" ? "dim" : "warn"}">${esc(st)}</span>
        ${doc.ocr ? '<span class="rz-tag ocr">розпізнано зі скану</span>' : ""}
      </span>
      <h2>${esc(doc.title)}</h2>
      ${passport.summary ? `<p class="rz-summary">${esc(passport.summary)}</p>` : ""}
    </div>
    <div class="rz-panel-tabs">
      <button class="rz-panel-tab" data-tab="passport" type="button">Паспорт</button>
      <button class="rz-panel-tab" data-tab="text" type="button">Текст
        <span class="count">${doc.stats?.sentences || 0}</span></button>
      <button class="rz-panel-tab" data-tab="tables" type="button">Таблиці
        <span class="count">${tableRows || 0}</span></button>
      <button class="rz-panel-tab" data-tab="codes" type="button">Коди
        <span class="count">${(doc.codes || []).length}</span></button>
      <button class="rz-panel-tab" data-tab="links" type="button">Зв'язки
        <span class="count">${edges.length}</span></button>
    </div>
    <div class="rz-panel" id="panelPassport" hidden>${renderPassport(doc, meta)}</div>
    <div class="rz-panel" id="panelText" hidden>${renderReader(doc)}</div>
    <div class="rz-panel" id="panelTables" hidden>${renderTables()}</div>
    <div class="rz-panel" id="panelCodes" hidden>${renderCodes(doc)}</div>
    <div class="rz-panel" id="panelLinks" hidden>${renderLinks(edges)}</div>`;

  el("rzDetail").querySelectorAll(".rz-panel-tab").forEach((tab) =>
    tab.addEventListener("click", () => showTab(tab.dataset.tab)));
  showTab(state.tab);
  bindReader();
  bindTables();
  bindLinks();
  if (options.block !== undefined) gotoBlock(options.block, options.sentence);
}

function showTab(name) {
  state.tab = name;
  const map = { passport: "panelPassport", text: "panelText", tables: "panelTables",
                codes: "panelCodes", links: "panelLinks" };
  Object.entries(map).forEach(([key, id]) => {
    const panel = el(id);
    if (panel) panel.hidden = key !== name;
  });
  el("rzDetail").querySelectorAll(".rz-panel-tab").forEach((tab) =>
    tab.classList.toggle("active", tab.dataset.tab === name));
}

/* ── паспорт ───────────────────────────────────────────────── */
function renderPassport(doc, meta) {
  const p = doc.passport || {};
  const cells = [
    ["Номер листа", p.number ? `№ ${p.number}` : "не вказано в документі"],
    ["Дата листа", p.date ? formatDate(p.date) : "не вказано"],
    ["Підписант", p.signer || "не визначено"],
    ["Тип", p.kind || "—"],
    ["Діє з", p.effective_from ? formatDate(p.effective_from) : "окремо не зазначено"],
    ["Роки ПМГ", (p.applies_to_years || []).join(", ") || "—"],
    ["Формат файлу", (meta.extension || "").toUpperCase() || "—"],
    ["Опубліковано в архіві", meta.storage_date ? formatDate(meta.storage_date) : "—"],
    ["Джерело тексту", doc.engine === "vision" ? "розпізнано зі скану"
      : doc.engine === "pdf-text" ? "текстовий шар PDF" : doc.engine],
    ["Обсяг", `${doc.stats?.body_blocks || 0} абзаців, ${doc.stats?.sentences || 0} речень`],
  ];
  const addressees = (p.addressees || []).map((a) => `<span class="rz-tag">${esc(a)}</span>`).join("");
  const topics = (p.topics || []).map((t) => `<span class="rz-tag">${esc(t)}</span>`).join("");
  const packages = (meta.packages || []).map((code) =>
    `<a class="rz-code" data-kind="package" href="${codeHref("package", code)}" target="_blank">
       <span class="kind">пакет</span><b>${esc(code)}</b></a>`).join("");

  /* Той самий файл трапляється на сайті НСЗУ під двома записами. Причина
     буває різна: або це непослідовне найменування одного документа, або під
     одним із записів справді лежить не той файл — і тоді другий документ на
     сайті недоступний. Вердикт не автоматизуємо: показуємо обидві назви
     і кажемо, що саме перевірити. */
  /* Коротке формулювання від моделі показуємо ОКРЕМО і підписуємо як
     автоматичне — щоб його не сприймали за офіційну назву документа. */
  const shortLabel = (p.subject || "").trim();
  const officialTitle = (doc.title || "").trim();
  const shortBlock = shortLabel && shortLabel.slice(0, 60) !== officialTitle.slice(0, 60)
    ? `<div class="rz-section-title">Коротко, сформульовано автоматично</div>
       <div class="rz-auto-label">${esc(shortLabel)}</div>` : "";

  const aliases = meta.archive_aliases || [];
  const aliasBlock = aliases.length ? `
    <div class="rz-section-title">Цей файл в архіві НСЗУ опубліковано двічі</div>
    <div class="rz-alias">
      <div>Запис 1: «${esc(meta.archive_title || "")}»</div>
      ${aliases.map((a, i) => `<div>Запис ${i + 2}: «${esc(a)}»</div>`).join("")}
      <p>Обидва записи ведуть на один і той самий файл. Якщо назви описують
         різні документи — звіртеся з текстом нижче: під одним із записів
         лежить не той файл, і другий документ на сайті недоступний.</p>
    </div>` : "";

  /* Документ поза архівом НСЗУ. Тут важливі дві речі, і мовчати про них не
     можна: звідки взято файл (бо перевірити його на сайті НСЗУ не вийде) і
     як здобуто текст. Для flat-text структура таблиць НЕ відновлена — коди
     шукаються, але стовпці склеєні, і будувати на цьому висновок не варто. */
  const externalBlock = meta.external ? `
    <div class="rz-section-title">Цього документа немає в архіві НСЗУ</div>
    <div class="rz-alias">
      <div>Звідки: ${esc(meta.origin || "джерело не вказано")}</div>
      ${meta.quality === "flat-text" ? `<p><b>Структура таблиць не відновлена.</b>
        Текст здобуто не з оригінального файлу, а з чужого текстового індексу:
        таблиця склеєна в суцільний рядок. Коди в ній шукаються, стовпці й
        зв'язки між ними — ні. Щоб зробити повноцінно, потрібен оригінальний PDF.</p>` : ""}
    </div>` : "";

  return `
    <div class="rz-section-title">${meta.external ? "Назва документа" : "Назва в архіві НСЗУ"}</div>
    <div class="rz-official-title">${esc(officialTitle)}</div>
    ${externalBlock}
    ${renderAttachmentBlock(doc.id)}
    <div class="rz-meta">${cells.map(([label, value]) =>
      `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div>
    ${shortBlock}
    ${aliasBlock}
    ${addressees ? `<div class="rz-section-title">Кому адресовано</div>
      <div class="rz-tags">${addressees}</div>` : ""}
    ${topics ? `<div class="rz-section-title">Теми</div><div class="rz-tags">${topics}</div>` : ""}
    ${packages ? `<div class="rz-section-title">Пакети ПМГ</div><div class="rz-codes">${packages}</div>` : ""}
    <div class="rz-section-title">Файл</div>
    <div class="rz-actions">
      ${meta.url ? `<a class="action" href="${esc(meta.url)}" target="_blank" rel="noopener">Відкрити оригінал на сайті НСЗУ</a>` : ""}
      <button class="rz-mini" type="button" data-goto-tab="text">Читати повний текст →</button>
    </div>`;
}

/* Додатки в паспорті, а не лише у вкладці «Зв'язки»: людина, яка відкрила
   лист із рядком «Додаток 1: на 3 арк.», шукає самі додатки тут і зараз.
   Архів НСЗУ публікує їх окремими записами, часто під назвою «Додатки 1-8»,
   і без цього блоку вони губляться серед 179 документів. */
function renderAttachmentBlock(id) {
  if (!state.graph) return "";
  const line = (docId, note) => {
    const meta = card(docId) || {};
    const detail = [
      meta.stats?.table_rows ? `таблиць ${meta.stats.tables}, рядків ${meta.stats.table_rows}` : "",
      (meta.extension || "").toUpperCase(),
    ].filter(Boolean).join(" · ");
    /* Доказ прив'язки тут — коротким рядком: повне формулювання лишається
       у вкладці «Зв'язки», щоб паспорт не перетворювався на простирадло. */
    const short = (note || "").length > 90 ? `${note.slice(0, 90)}…` : (note || "");
    return `<div class="rz-attach-item">
      <button class="link" type="button" data-open="${docId}">${esc(meta.title || `Документ ${docId}`)}</button>
      <span class="rz-attach-note">${esc([short, detail].filter(Boolean).join(" · "))}</span>
    </div>`;
  };

  const children = state.graph.edges
    .filter((e) => e.relation === "додаток до" && e.to === id)
    .map((e) => line(e.from, e.evidence));
  if (children.length) {
    return `<div class="rz-section-title">Додатки до цього листа (${children.length})</div>
      <div class="rz-attach">${children.join("")}</div>`;
  }

  const parents = state.graph.edges.filter((e) => e.relation === "додаток до" && e.from === id);
  if (parents.length) {
    return `<div class="rz-section-title">Це додаток до листа</div>
      <div class="rz-attach">${parents.map((e) => line(e.to, e.evidence)).join("")}</div>`;
  }

  /* Лист, якого НСЗУ не публікувала, але який відомий за реквізитами з інших
     листів. Показуємо його як групу: реквізити, всі знайдені додатки і — що
     важливіше — яких додатків цього листа в архіві теж немає. Саме цей список
     і є текстом запиту до НСЗУ. */
  const lost = (state.graph.missing_letters || [])
    .find((m) => (m.attachments || []).some((a) => a.id === id));
  if (lost) {
    const mine = (lost.attachments || []).find((a) => a.id === id) || {};
    const requisites = [lost.number ? `№ ${lost.number}` : "номер невідомий",
      lost.date || lost.date_hint || "дата невідома"].join(" · ");
    const siblings = (lost.attachments || []).filter((a) => a.id !== id)
      .map((a) => line(a.id, ""));
    const gaps = (lost.gaps || [])
      .map((g) => `<li>Додаток ${esc(g.number)} — ${esc(g.note)}</li>`).join("");
    return `<div class="rz-section-title">Лист, якого НСЗУ не публікувала</div>
      <div class="rz-alias">
        <div>«${esc(lost.title || lost.key)}»</div>
        <div class="rz-attach-note">${esc(requisites)}</div>
        <p>${esc(mine.why || "")}</p>
        <p>${esc(lost.why || "")}</p>
        ${lost.candidate ? `<p><b>Гіпотеза, не факт:</b> ${esc(lost.candidate)}</p>` : ""}
        ${lost.warning ? `<p><b>Обережно:</b> ${esc(lost.warning)}</p>` : ""}
        ${siblings.length ? `<div class="rz-attach">
          <div class="rz-attach-note">Інші додатки цього ж листа (${siblings.length}):</div>
          ${siblings.join("")}</div>` : ""}
        ${gaps ? `<div class="rz-section-title">Чого немає і в архіві</div>
          <ul class="rz-gaps">${gaps}</ul>` : ""}
      </div>`;
  }

  const orphan = (state.graph.orphan_attachments || []).find((o) => o.id === id);
  if (!orphan) return "";
  const siblings = (state.graph.orphan_attachments || [])
    .filter((o) => o.id !== id && o.parent_title && o.parent_title === orphan.parent_title)
    .map((o) => line(o.id, ""));
  return `<div class="rz-section-title">Батьківського листа немає в архіві НСЗУ</div>
    <div class="rz-alias">
      ${orphan.parent_title ? `<div>Лист: «${esc(orphan.parent_title)}»</div>` : ""}
      <p>${esc(orphan.why)}. Сам файл додатка опубліковано, лист — ні: шукати його
         треба поза архівом роз'яснень (лист надавачам, СЕД АСКОД).</p>
      ${siblings.length ? `<div class="rz-attach">
        <div class="rz-attach-note">Інші додатки до того самого листа:</div>
        ${siblings.join("")}</div>` : ""}
    </div>`;
}

/* ── читалка ───────────────────────────────────────────────── */
function highlight(text, query) {
  const safe = esc(text);
  if (!query || query.length < 3) return safe;
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

/* Коди підсвічуються прямо в реченні і ведуть у класифікатори */
function linkCodes(html, codes) {
  if (!codes || !codes.length) return html;
  let result = html;
  const seen = new Set();
  codes.forEach(({ kind, code }) => {
    if (seen.has(code) || kind === "package") return;
    seen.add(code);
    const href = codeHref(kind, code);
    if (!href) return;
    const pattern = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`(?<![\\w>/-])(${pattern})(?![\\w-])`, "g"),
      `<a class="rz-chip-inline" href="${href}" target="_blank" title="${esc(KIND_LABEL[kind] || kind)}">$1</a>`);
  });
  return result;
}

function renderReader(doc) {
  const query = state.readerQuery;
  const body = doc.blocks.map((block) => {
    const inner = block.sentences && block.sentences.length > 1
      ? block.sentences.map((s) =>
          `<span class="rz-sent" data-b="${block.i}" data-s="${s.s}">${
            linkCodes(highlight(s.text, query), block.codes)}</span>`).join(" ")
      : linkCodes(highlight(block.text, query), block.codes);

    const anchor = `<button class="anchor" type="button" data-anchor="${block.i}"
       title="Скопіювати посилання на цей абзац">§</button>`;

    if (block.t === "table") {
      return `<p class="rz-block" data-block="${block.i}">${anchor}
        <button class="rz-mini" type="button" data-goto-table="${block.table}">
        📊 ${esc(block.text)} — відкрити</button></p>`;
    }
    if (block.t === "h") return `<h3 class="rz-block" data-block="${block.i}">${anchor}${inner}</h3>`;
    if (block.t === "q") return `<p class="rz-block q" data-block="${block.i}">${anchor}${inner}</p>`;
    if (block.t === "li") return `<p class="rz-block li" data-block="${block.i}">${anchor}${inner}</p>`;
    if (block.t === "stamp") return `<p class="rz-block stamp" data-block="${block.i}">${inner}</p>`;
    const unreadable = block.unreadable ? " unreadable" : "";
    return `<p class="rz-block${unreadable}" data-block="${block.i}">${anchor}${inner}</p>`;
  }).join("");

  const outline = (doc.outline || []).length > 1
    ? `<div class="rz-section-title">Зміст документа</div>
       <div class="rz-tags">${doc.outline.map((item) =>
         `<button class="rz-mini" type="button" data-goto-block="${item.i}">${esc(item.text.slice(0, 70))}</button>`).join("")}</div>`
    : "";

  return `
    <div class="rz-toolbar">
      <input id="readerFind" type="search" placeholder="Пошук у тексті документа"
             value="${esc(query)}">
      <button class="rz-mini" type="button" id="findPrev">↑</button>
      <button class="rz-mini" type="button" id="findNext">↓</button>
      <span id="findInfo" class="rz-empty-note"></span>
    </div>
    ${doc.ocr ? `<div class="rz-ocr-note">Текст розпізнано зі скана моделлю.
      Коди звірені з класифікаторами, але для юридично значущих рішень
      відкривайте оригінал файлу.</div>` : ""}
    ${outline}
    <div class="rz-reader" id="readerBody">${body}</div>`;
}

function bindReader() {
  const detail = el("rzDetail");
  detail.querySelectorAll("[data-goto-tab]").forEach((button) =>
    button.addEventListener("click", () => showTab(button.dataset.gotoTab)));
  detail.querySelectorAll("[data-goto-block]").forEach((button) =>
    button.addEventListener("click", () => gotoBlock(Number(button.dataset.gotoBlock))));
  detail.querySelectorAll("[data-goto-table]").forEach((button) =>
    button.addEventListener("click", () => {
      showTab("tables");
      el("panelTables").querySelector(`[data-table="${button.dataset.gotoTable}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  detail.querySelectorAll("[data-anchor]").forEach((button) =>
    button.addEventListener("click", () => copyAnchor(Number(button.dataset.anchor))));
  detail.querySelectorAll(".rz-sent").forEach((span) =>
    span.addEventListener("dblclick", () =>
      copyAnchor(Number(span.dataset.b), Number(span.dataset.s))));

  const find = el("readerFind");
  if (find) {
    find.addEventListener("input", () => {
      state.readerQuery = find.value.trim();
      const scroll = el("panelText").scrollTop;
      el("panelText").innerHTML = renderReader(state.doc);
      bindReader();
      el("panelText").scrollTop = scroll;
      collectMatches();
      if (state.matches.length) stepMatch(1);
    });
    el("findPrev").addEventListener("click", () => stepMatch(-1));
    el("findNext").addEventListener("click", () => stepMatch(1));
    collectMatches();
  }
}

function collectMatches() {
  state.matches = [...(el("readerBody")?.querySelectorAll("mark") || [])];
  state.matchIndex = -1;
  const info = el("findInfo");
  if (info) {
    info.textContent = state.readerQuery.length >= 3
      ? (state.matches.length ? `збігів: ${state.matches.length}` : "збігів немає") : "";
  }
}

function stepMatch(delta) {
  if (!state.matches.length) return;
  state.matchIndex = (state.matchIndex + delta + state.matches.length) % state.matches.length;
  state.matches.forEach((m, i) => m.classList.toggle("current", i === state.matchIndex));
  state.matches[state.matchIndex].scrollIntoView({ behavior: "smooth", block: "center" });
  el("findInfo").textContent = `${state.matchIndex + 1} з ${state.matches.length}`;
}

function gotoBlock(blockIndex, sentenceIndex) {
  showTab("text");
  const body = el("readerBody");
  const target = body?.querySelector(`[data-block="${blockIndex}"]`);
  if (!target) return;
  body.querySelectorAll(".target").forEach((node) => node.classList.remove("target"));
  body.querySelectorAll(".rz-sent.picked").forEach((node) => node.classList.remove("picked"));
  target.classList.add("target");
  if (sentenceIndex !== undefined && sentenceIndex !== null) {
    target.querySelector(`.rz-sent[data-s="${sentenceIndex}"]`)?.classList.add("picked");
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* Посилання на абзац або конкретне речення — те, заради чого все будувалося */
function copyAnchor(blockIndex, sentenceIndex) {
  const url = new URL(location.href);
  url.searchParams.set("doc", state.selected);
  url.searchParams.set("b", blockIndex);
  if (sentenceIndex !== undefined) url.searchParams.set("s", sentenceIndex);
  else url.searchParams.delete("s");
  history.replaceState(null, "", url);
  navigator.clipboard?.writeText(url.toString());
  gotoBlock(blockIndex, sentenceIndex);
  const info = el("findInfo");
  if (info) {
    info.textContent = sentenceIndex === undefined
      ? "посилання на абзац скопійовано" : "посилання на речення скопійовано";
    setTimeout(collectMatches, 2500);
  }
}

/* ── таблиці ───────────────────────────────────────────────── */
function renderTables() {
  if (state.tablesFailed) {
    return `<p class="rz-empty-note">Не вдалося завантажити таблиці цього документа.
      <button class="rz-mini" type="button" data-retry-tables="1">Спробувати ще раз</button></p>`;
  }
  const tables = state.tables?.tables || [];
  if (!tables.length) return '<p class="rz-empty-note">У цьому документі таблиць немає.</p>';
  return tables.map((table, index) => renderOneTable(table, index)).join("");
}

const CODE_CELL_RE = /^[A-ZА-Я]?\d{2,5}(?:[.-]\d{1,2})?$/;

/* Аркуші XLSX майже завжди тягнуть за собою порожні колонки, а довгі шапки
   («Тип (інструментальні / процедури / консультації/ Ургентні )») в один
   рядок розпихають таблицю на кілометр. Тому: порожні колонки прибираємо,
   шапки переносимо, ширину клітинок обмежуємо, а колонки з кодами лишаємо
   вузькими й без переносу. */
function renderOneTable(table, index) {
  const width = Math.max(table.columns.length,
                         ...table.rows.map((row) => row.length), 0);
  const filled = Array.from({ length: width }, (_, column) =>
    table.rows.reduce((sum, row) =>
      sum + ((row[column] || "").trim() ? 1 : 0), 0));
  const keep = Array.from({ length: width }, (_, column) =>
    filled[column] > 0 || (table.columns[column] || "").trim() !== "");
  const dropped = keep.filter((k) => !k).length;

  const isCodeColumn = Array.from({ length: width }, (_, column) => {
    const values = table.rows.map((row) => (row[column] || "").trim()).filter(Boolean).slice(0, 60);
    return values.length > 3 && values.every((v) => CODE_CELL_RE.test(v));
  });

  /* Аркуш на один стовпець — це перелік, а не таблиця. Показувати його
     сіткою з однією колонкою і шапкою безглуздо. */
  if (keep.filter(Boolean).length === 1) {
    const column = keep.findIndex(Boolean);
    const values = [table.columns[column], ...table.rows.map((r) => r[column] || "")]
      .filter((v) => (v || "").trim());
    const listed = values.slice(0, 400);
    return `
      <div class="rz-section-title" data-table="${index}">${esc(table.title)}
        — перелік, ${values.length} позицій${values.length > listed.length
          ? `, показано перші ${listed.length}` : ""}</div>
      <div class="rz-toolbar">
        <input type="search" data-filter-table="${index}" placeholder="Фільтр позицій">
        <span class="rz-empty-note" data-filter-count="${index}"></span>
      </div>
      <div class="rz-table-wrap">
        <table class="rz-table" data-body="${index}"><tbody>${listed.map((v) =>
          `<tr><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
      </div>`;
  }

  const shown = table.rows.slice(0, 300);
  const header = table.columns.map((cell, column) => keep[column]
    ? `<th${isCodeColumn[column] ? ' class="code"' : ""}>${esc(cell)}</th>` : "").join("");
  const body = shown.map((row) => {
    const cells = Array.from({ length: width }, (_, column) => keep[column]
      ? `<td${isCodeColumn[column] ? ' class="code"' : ""}>${esc(row[column] || "")}</td>` : "").join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  const notes = [
    `${table.rows.length} рядків`,
    table.rows.length > shown.length ? `показано перші ${shown.length}` : "",
    dropped ? `${dropped} порожніх колонок приховано` : "",
  ].filter(Boolean).join(" · ");

  return `
    <div class="rz-section-title" data-table="${index}">${esc(table.title)} — ${notes}</div>
    <div class="rz-toolbar">
      <input type="search" data-filter-table="${index}" placeholder="Фільтр рядків цієї таблиці">
      <span class="rz-empty-note" data-filter-count="${index}"></span>
    </div>
    <div class="rz-table-wrap">
      <table class="rz-table" data-body="${index}">
        <thead><tr>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function bindTables() {
  const detail = el("rzDetail");
  if (!detail) return;
  detail.querySelectorAll("[data-filter-table]").forEach((input) => {
    input.addEventListener("input", () => {
      const index = input.dataset.filterTable;
      const needle = input.value.trim().toLowerCase();
      let visible = 0;
      detail.querySelectorAll(`[data-body="${index}"] tbody tr`).forEach((row) => {
        const match = !needle || row.textContent.toLowerCase().includes(needle);
        row.style.display = match ? "" : "none";
        if (match) visible += 1;
      });
      const counter = detail.querySelector(`[data-filter-count="${index}"]`);
      if (counter) counter.textContent = needle ? `знайдено рядків: ${visible}` : "";
    });
  });
  detail.querySelectorAll("[data-retry-tables]").forEach((button) =>
    button.addEventListener("click", () => select(state.selected, { tab: "tables" })));
}

/* ── коди ──────────────────────────────────────────────────── */
function renderCodes(doc) {
  const codes = doc.codes || [];
  if (!codes.length) return '<p class="rz-empty-note">Кодів у тексті не знайдено.</p>';
  const groups = {};
  codes.forEach((code) => (groups[code.kind] ||= []).push(code));
  const order = ["package", "icd", "achi", "esoz", "position", "odk", "drg", "loinc"];
  return order.filter((kind) => groups[kind]).map((kind) => `
    <div class="rz-section-title">${esc(KIND_LABEL[kind] || kind)} — ${groups[kind].length}</div>
    <div class="rz-codes">${groups[kind].map((item) => {
      const href = codeHref(item.kind, item.code);
      const title = item.title ? ` — ${item.title}` : "";
      const ambiguous = item.also?.length
        ? `<span class="amb" title="Цей код може означати й інше: ${
            esc(item.also.map((a) => `${KIND_LABEL[a.kind] || a.kind} ${a.code}`).join(", "))}">⚠</span>` : "";
      const inner = `<span class="kind">${esc(KIND_LABEL[item.kind] || item.kind)}</span>
        <b>${esc(item.code)}</b>${esc(title.slice(0, 70))}${ambiguous}
        <button class="rz-mini" type="button" data-goto-block="${item.blocks?.[0] ?? 0}">у тексті</button>`;
      return href
        ? `<span class="rz-code" data-kind="${esc(item.kind)}"><a href="${href}" target="_blank"
             style="text-decoration:none;color:inherit">${inner}</a></span>`
        : `<span class="rz-code" data-kind="${esc(item.kind)}">${inner}</span>`;
    }).join("")}</div>`).join("");
}

/* ── зв'язки ───────────────────────────────────────────────── */
function relatedEdges(id) {
  if (!state.graph) return [];
  return state.graph.edges.filter((e) => e.from === id || e.to === id);
}

function renderLinks(edges) {
  if (!edges.length) {
    return `<p class="rz-empty-note">Зв'язків з іншими роз'ясненнями не знайдено.</p>`;
  }
  const label = (edge) => {
    const outgoing = edge.from === state.selected;
    const other = outgoing ? edge.to : edge.from;
    return {
      other,
      node: state.graph.nodes.find((n) => n.id === other),
      direction: outgoing ? `цей документ ${edge.relation}` : `${edge.relation} цей документ`,
    };
  };
  const STATUS_LABEL = {
    confirmed: "підтверджено",
    proposed: "гіпотеза, чекає підтвердження",
    rejected: "відхилено експертом",
  };

  return `<div class="rz-edges">${edges.map((edge, position) => {
    const { other, node, direction } = label(edge);
    const status = edgeStatus(edge);
    const decided = state.decisions.has(edgeKey(edge));
    // Кнопки вердикту — лише для гіпотез моделі: додатки й прямі посилання
    // на номер листа це факти, їх підтверджувати нема чого.
    const askable = edge.source === "claim";
    const buttons = askable && canDecide()
      ? `<div class="rz-verdict">
           ${decided
             ? `<button class="rz-mini" type="button" data-undecide="${position}">↺ Скасувати вердикт</button>`
             : `<button class="rz-mini ok" type="button" data-confirm="${position}">✓ Підтвердити</button>
                <button class="rz-mini no" type="button" data-reject="${position}">✕ Відхилити</button>`}
         </div>`
      : askable && !state.me
        ? `<div class="rz-verdict-note">Підтвердити або відхилити гіпотезу може керівник відділу і вище — увійдіть у портал.</div>`
        : "";

    return `<div class="rz-edge" data-relation="${esc(edge.relation)}" data-status="${status}">
      <div class="rz-edge-head">
        <span class="rz-tag">${esc(direction)}</span>
        <span class="rz-status ${status}">${STATUS_LABEL[status] || status}</span>
        ${node?.date ? `<span class="rz-tag date">${formatDate(node.date)}</span>` : ""}
        ${edge.source === "attachment" ? '<span class="rz-tag dim">прив\'язка додатка</span>' : ""}
        ${edge.source === "reference" ? '<span class="rz-tag dim">номер листа в тексті</span>' : ""}
        ${edge.source === "claim" ? '<span class="rz-tag warn">прочитано в тексті</span>' : ""}
      </div>
      <button class="link" type="button" data-open="${other}">${esc(node?.subject || `Документ ${other}`)}</button>
      ${edge.evidence ? `<div class="quote">${esc(edge.evidence)}</div>` : ""}
      ${buttons}
    </div>`;
  }).join("")}</div>`;
}

function bindLinks() {
  const detail = el("rzDetail");
  if (!detail) return;
  detail.querySelectorAll("[data-open]").forEach((button) =>
    button.addEventListener("click", () => select(Number(button.dataset.open), { tab: "passport" })));

  const edges = relatedEdges(state.selected);
  const bind = (attribute, handler) =>
    detail.querySelectorAll(`[data-${attribute}]`).forEach((button) =>
      button.addEventListener("click", async () => {
        const edge = edges[Number(button.dataset[attribute])];
        if (!edge) return;
        button.disabled = true;
        await handler(edge);
      }));
  bind("confirm", (edge) => decide(edge, "confirmed"));
  bind("reject", (edge) => decide(edge, "rejected"));
  bind("undecide", (edge) => undecide(edge));
}

/* ── службове ──────────────────────────────────────────────── */
function syncMobileTabs() {
  const active = document.querySelector(".rz-layout").dataset.active;
  document.querySelectorAll(".mobile-tab").forEach((tab) =>
    tab.classList.toggle("active", tab.dataset.tab === active));
}

function renderStats() {
  const documents = state.index.documents;
  const sentences = documents.reduce((sum, d) => sum + (d.stats?.sentences || 0), 0);
  const rows = documents.reduce((sum, d) => sum + (d.stats?.table_rows || 0), 0);
  const archive = state.index.archive_records;
  const duplicates = state.index.duplicate_files || 0;
  /* Записів на сайті НСЗУ більше, ніж файлів: один файл там трапляється під
     двома записами. Показуємо обидва числа, щоб не здавалося, що бібліотека
     чогось не добрала. */
  const cards = [
    [documents.length, "роз'яснень",
     archive && duplicates
       ? `На сайті НСЗУ ${archive} записів, але ${duplicates} з них — повтори того самого файлу`
       : ""],
    [state.index.with_real_date ?? 0, "з датою листа",
     "Дату взято зі штампа ЕЦП усередині документа"],
    [sentences.toLocaleString("uk"), "речень", "Кожне має постійне посилання"],
    [rows.toLocaleString("uk"), "рядків у таблицях", "З додатків XLSX, DOCX і PDF"],
  ];
  el("rzStats").innerHTML = cards.map(([n, label, hint]) =>
    `<div class="stat"${hint ? ` title="${esc(hint)}"` : ""}>
       <strong>${n}</strong><span>${esc(label)}</span></div>`).join("");
}

async function init() {
  const [index, graph] = await Promise.all([
    fetch("data/index.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("data/graph.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).catch(() => null),
  ]);
  state.index = index;
  state.graph = graph;
  state.me = await loadMe();
  await loadDecisions();
  index.documents.forEach((doc) => {
    doc._searchRaw = [doc.subject, doc.title, doc.summary, doc.number,
      (doc.topics || []).join(" ")].filter(Boolean).join(" · ");
    doc._search = doc._searchRaw.toLowerCase();
  });

  renderStats();
  ["fPackage", "fTopic", "fKind", "fYear", "fState", "fFlag"].forEach((id) =>
    el(id).addEventListener("change", apply));
  // Запит-код спершу дочікується індексів, інакше перше натискання Enter після
  // набору «I63.9» показало б нуль, а друге — вже результат
  el("rzSearch").addEventListener("input", () => {
    if (looksLikeCode(el("rzSearch").value) && !codeIndexes) {
      loadCodeIndexes().then(apply);
    }
    apply();
  });
  el("rzReset").addEventListener("click", () => {
    ["rzSearch", "fPackage", "fTopic", "fKind", "fYear", "fState", "fFlag"]
      .forEach((id) => { el(id).value = ""; });
    clearSelection();
    apply();
  });
  document.querySelectorAll(".mobile-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      document.querySelector(".rz-layout").dataset.active = tab.dataset.tab;
      syncMobileTabs();
    }));

  apply();

  const params = new URLSearchParams(location.search);
  const initial = Number(params.get("doc"));
  if (initial && index.documents.some((d) => d.id === initial)) {
    await select(initial, {
      tab: params.has("b") ? "text" : "passport",
      block: params.has("b") ? Number(params.get("b")) : undefined,
      sentence: params.has("s") ? Number(params.get("s")) : undefined,
    });
  }
}

init().catch((error) => {
  el("rzCount").textContent = "Не вдалося завантажити реєстр.";
  console.error(error);
});
