/* Стандарти та настанови ДЕЦ МОЗ — сторінка реєстру.
 *
 * Дані: ../data/dec_documents.json (збирач dec/build_dec.py зі знімка dec.gov.ua),
 * зв'язки з пакетами: data/package_dec_links.json (лише з доказом, поле why),
 * каталог напрямів: data/clinical_directions.json (лише назви категорій).
 *
 * Пошук (аудит 24.11.2026, В1):
 *   • код діагнозу (I21, C50.9, «I20-I25») — за кодами МКХ-10, узятими з самих документів ДЕЦ;
 *   • слова — спільний модуль pmg-code-search.js зі сферою словника «dec» (інфаркт → гострий
 *     коронарний синдром, ХОЗЛ…), збіг лише з початку слова: «рак» не знаходить «торакотомію».
 * Статус — як його подає ДЕЦ на дату знімка; сторінка цю дату показує.
 */
const state = {
  data: null, visible: [], selected: null, directions: null, activeView: "search",
  selectedDirection: null, selectedDocsForDownload: new Set(), note: "", mode: "",
};
const el = (id) => document.getElementById(id);
const isLocal = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const BROAD = ["3", "4", "47"];
let packageLinks = {};
let packagesList = [];

const filterDefinitions = [
  { id: "category", allLabel: "Усі категорії", value: (doc) => doc.categories },
  { id: "type", allLabel: "Усі види", value: (doc) => doc.type },
  { id: "status", allLabel: "Усі статуси", value: (doc) => doc.status },
  { id: "year", allLabel: "Усі роки", value: (doc) => doc.year },
];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normText = (s) => (window.PMG_SEARCH ? PMG_SEARCH.text(s) : String(s || "").toLowerCase());
const normCode = (s) => (window.PMG_SEARCH ? PMG_SEARCH.code(s) : String(s || "").toUpperCase());
const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");

// ── розбір запиту ──────────────────────────────────────────────────────
const RE_ONE = /^[A-Z]\d{2}(\.\d{1,2})?$/;
function parseCodes(raw) {
  const q = normCode(String(raw || "").trim()).replace(/\s+/g, "").replace(/[–—]/g, "-");
  if (!q) return null;
  const parts = q.split(/[,;]/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const r = p.match(/^([A-Z])(\d{2})(?:\.\d{1,2})?-([A-Z])(\d{2})(?:\.\d{1,2})?$/);
    if (r && r[1] === r[3] && +r[4] >= +r[2] && +r[4] - +r[2] <= 40) {
      for (let n = +r[2]; n <= +r[4]; n++) out.push(r[1] + String(n).padStart(2, "0"));
    } else if (RE_ONE.test(p)) out.push(p);
    else return null;
  }
  return out.length ? out : null;
}

function categoryMatchesCodes(info, codes) {
  if (!info || !info.icd || !info.icd.length) return false;
  return codes.some((c) => info.icd.some((x) => x === c || x.startsWith(c + ".") || c.startsWith(x + ".") ||
    x.split(".")[0] === c.split(".")[0]));
}

function currentFilters() {
  return {
    query: el("search").value.trim(),
    category: el("category").value, type: el("type").value,
    status: el("status").value, year: el("year").value,
  };
}

function matchesSelects(doc, f, ignored = "") {
  if (ignored !== "category" && f.category && !doc.categories.includes(f.category)) return false;
  if (ignored !== "type" && f.type && doc.type !== f.type) return false;
  if (ignored !== "status" && f.status && doc.status !== f.status) return false;
  if (ignored !== "year" && f.year && doc.year !== f.year) return false;
  return true;
}

/** Документи за запитом: Map doc → score. Пишe state.note і state.mode. */
function queryHits(query) {
  state.note = ""; state.mode = "";
  if (!query) return null;
  const docs = state.data.documents;
  const codes = parseCodes(query);
  const hits = new Map();
  if (codes) {
    state.mode = "code";
    const cats = Object.entries(state.data.category_info || {})
      .filter(([, info]) => categoryMatchesCodes(info, codes)).map(([name]) => name);
    docs.forEach((d) => { if (d.categories.some((c) => cats.includes(c))) hits.set(d, 100); });
    // номер документа теж схожий на «код» лише зрідка; рядок номера перевіряємо окремо
    state.note = cats.length
      ? `код ${codes.join(", ")}: категорії ДЕЦ, у документах яких є ця рубрика МКХ-10 — ${cats.length}`
      : `коду ${codes.join(", ")} немає серед кодів МКХ-10 документів ДЕЦ (коди відомі для ${countWithIcd()} категорій)`;
    return hits;
  }
  const qn = normText(query);
  // реєстровий номер: «ГС 2025-1582», «2025-1582», «1582»
  if (/\d{3,4}/.test(query)) {
    const qc = qn.replace(/[\s-]/g, "");
    docs.forEach((d) => { if (normText(d.number).replace(/[\s-]/g, "").includes(qc)) hits.set(d, 90); });
  }
  if (window.PMG_FIND) {
    const r = PMG_FIND.search(docs, query, { text: (d) => d._t, scope: "dec" });
    for (const x of r.items) {
      // фраза всередині слова («рак» у «торакотомії») — не збіг
      if (!x.via && !PMG_FIND.test(x.e, x.e._t, query)) continue;
      hits.set(x.e, Math.max(hits.get(x.e) || 0, x.score));
    }
    if (r.note) state.note = r.note;
  } else {
    docs.forEach((d) => { if (d._t.includes(qn)) hits.set(d, 10); });
  }
  return hits;
}

function countWithIcd() {
  return Object.values(state.data.category_info || {}).filter((i) => i.icd && i.icd.length).length;
}

function refreshFilterMenus(hits) {
  let changed;
  do {
    changed = false;
    const f = currentFilters();
    filterDefinitions.forEach((def) => {
      const select = el(def.id);
      const cur = select.value;
      const counts = new Map();
      state.data.documents
        .filter((d) => (!hits || hits.has(d)) && matchesSelects(d, f, def.id))
        .forEach((d) => {
          const v = def.value(d);
          (Array.isArray(v) ? v : [v]).forEach((x) => { if (x) counts.set(x, (counts.get(x) || 0) + 1); });
        });
      const opts = [...counts.keys()].sort((a, b) => (def.id === "year" ? b.localeCompare(a) : a.localeCompare(b, "uk")));
      select.innerHTML = `<option value="">${escapeHtml(def.allLabel)}</option>` +
        opts.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)} (${counts.get(v)})</option>`).join("");
      if (cur && counts.has(cur)) select.value = cur;
      else if (cur) { select.value = ""; changed = true; }
    });
  } while (changed);
}

function renderStats() {
  const docs = state.data.documents;
  const active = docs.filter((d) => d.state === "чинний").length;
  el("stats").innerHTML = [
    [docs.length, "документів ДЕЦ"],
    [state.data.total_categories || state.data.categories.length, "категорій"],
    [active, "чинних за даними ДЕЦ"],
  ].map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join("");
  const snap = fmtDate(state.data.snapshot);
  el("decSnapshot").innerHTML = snap
    ? `Статус і склад — за реєстром <a href="${escapeHtml(state.data.source)}" target="_blank" rel="noopener">dec.gov.ua</a> станом на ${snap}` +
      (state.data.complete === false ? " (знімок неповний)" : "")
    : "";
}

function applyFilters() {
  state.selectedDocsForDownload.clear();
  const f = currentFilters();
  const hits = queryHits(f.query);
  refreshFilterMenus(hits);
  const f2 = currentFilters();
  if (!f2.query && !f2.category && !f2.type && !f2.status && !f2.year) {
    state.visible = []; state.selected = null;
    el("resultCount").textContent = "Оберіть фільтр або введіть запит";
    el("searchNote").textContent = "";
    renderCards(true); renderWelcome();
    return;
  }
  state.visible = state.data.documents.filter((d) => (!hits || hits.has(d)) && matchesSelects(d, f2));
  const rank = { "чинний": 0, "невідомий": 1, "застарілий": 2, "скасований": 3 };
  state.visible.sort((a, b) =>
    (hits ? (hits.get(b) || 0) - (hits.get(a) || 0) : 0) ||
    (rank[a.state] - rank[b.state]) ||
    a.category.localeCompare(b.category, "uk") ||
    (b.published ? b.published.split(".").reverse().join("") : "").localeCompare(a.published ? a.published.split(".").reverse().join("") : ""));
  el("resultCount").textContent = `Знайдено: ${state.visible.length} з ${state.data.documents.length}`;
  el("searchNote").textContent = state.note;
  renderCards();
  if (!state.visible.length) { renderNoResults(f2.query); return; }
  if (!state.selected || !state.visible.includes(state.selected)) selectDocument(state.visible[0].id, false);
}

function statusTag(doc) {
  const cls = { "чинний": "tag file", "застарілий": "tag dec-old", "скасований": "tag dec-old" }[doc.state] || "tag";
  return `<span class="${cls}">${escapeHtml(doc.state === "застарілий" ? "Застарілий" : doc.status)}</span>`;
}

function renderCards(isBlank = false) {
  const box = el("cards");
  if (isBlank) { box.innerHTML = ""; updateDownloadPanel(); return; }
  if (!state.visible.length) {
    box.innerHTML = '<div class="no-results">За цими умовами документів не знайдено.</div>';
    updateDownloadPanel(); return;
  }
  const withBox = isLocal;
  box.innerHTML = state.visible.map((doc) => `
    <button class="document-card${state.selected === doc ? " active" : ""}" type="button" data-id="${doc.id}">
      ${withBox && doc.document_url ? `<div class="card-checkbox-wrapper"><input type="checkbox" class="card-select-checkbox" data-id="${doc.id}"
        ${state.selectedDocsForDownload.has(doc.id) ? "checked" : ""} aria-label="Вибрати документ для завантаження"></div>` : ""}
      <div class="card-content-wrapper">
        <span class="card-tags">${statusTag(doc)}<span class="tag">${escapeHtml(doc.type)}</span>${doc.year ? `<span class="tag">${escapeHtml(doc.year)}</span>` : ""}</span>
        <strong>${escapeHtml(doc.title)}</strong>
        <span class="card-subtitle">${escapeHtml(doc.categories.join(" · "))}${doc.number ? " | " + escapeHtml(doc.number) : ""}</span>
      </div>
    </button>`).join("");
  updateDownloadPanel();
}

function onCardsClick(e) {
  const cb = e.target.closest && e.target.closest(".card-select-checkbox");
  if (cb) {
    e.stopPropagation();
    cb.checked ? state.selectedDocsForDownload.add(cb.dataset.id) : state.selectedDocsForDownload.delete(cb.dataset.id);
    updateDownloadPanel();
    return;
  }
  const card = e.target.closest && e.target.closest(".document-card");
  if (card) selectDocument(card.dataset.id);
}

// ── масове завантаження — лише на локальному сервері з /api/download-file ──
function updateDownloadPanel() {
  const panel = el("download-panel");
  if (!panel) return;
  if (!isLocal || !state.visible.length || state.activeView !== "search") { panel.style.display = "none"; return; }
  panel.style.display = "flex";
  const can = state.visible.filter((d) => d.document_url);
  const sel = el("select-all-visible");
  const all = can.length > 0 && can.every((d) => state.selectedDocsForDownload.has(d.id));
  sel.checked = all;
  sel.indeterminate = !all && can.some((d) => state.selectedDocsForDownload.has(d.id));
  sel.disabled = !can.length;
  const n = state.selectedDocsForDownload.size;
  el("download-selected-btn").innerHTML = `<span>📥 Скачати вибране (${n})</span>`;
  el("download-selected-btn").disabled = n === 0;
}

function downloadSelectedDocs() {
  const docs = state.data.documents.filter((d) => state.selectedDocsForDownload.has(d.id) && d.document_url);
  const status = el("download-status");
  el("download-status-container").style.display = "block";
  status.className = "download-status info";
  docs.forEach((doc, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = `/api/download-file?url=${encodeURIComponent(doc.document_url)}&title=${encodeURIComponent(doc.title)}`;
    a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
    status.textContent = `Запущено завантаження ${i + 1} з ${docs.length}`;
    if (i === docs.length - 1) { state.selectedDocsForDownload.clear(); renderCards(); }
  }, i * 800));
}

function renderWelcome() {
  const d = el("detail");
  d.classList.add("empty");
  d.innerHTML = `<div class="empty-state"><div class="empty-icon">i</div>
    <h2>Оберіть фільтр або знайдіть документ</h2>
    <p>Шукайте словами («інфаркт», «ХОЗЛ»), кодом діагнозу МКХ-10 («I21», «C50») або реєстровим номером («ГС 2025-1582»).</p></div>`;
}

function renderNoResults(query) {
  const d = el("detail");
  d.classList.add("empty");
  const snap = fmtDate(state.data.snapshot);
  d.innerHTML = `<div class="empty-state"><div class="empty-icon">?</div>
    <h2>Нічого не знайдено</h2>
    <p>${query ? `У реєстрі ДЕЦ${snap ? ` (знімок від ${snap})` : ""} документа за запитом «${escapeHtml(query)}» немає. ` : ""}
    Деяких тем — наприклад, апендициту, холециститу, гриж — немає в самому реєстрі ДЕЦ.</p></div>`;
}

function selectDocument(id, scroll = true) {
  const doc = state.data.documents.find((d) => d.id === id);
  if (!doc) return;
  state.selected = doc;
  renderCards();
  renderDetail(doc);
  if (scroll && window.innerWidth <= 980) el("detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function packagesFor(categories) {
  const out = [];
  for (const [num, cats] of Object.entries(packageLinks)) {
    for (const c of categories) {
      if (cats && cats[c]) { out.push({ num, cat: c, ...cats[c] }); break; }
    }
  }
  return out.sort((a, b) => +a.num - +b.num);
}

function pkgTitle(num) {
  const p = packagesList.find((x) => String(x.number) === String(num));
  return p ? p.title : "";
}

function renderDetail(doc) {
  const d = el("detail");
  d.classList.remove("empty");
  const infos = doc.categories.map((c) => [c, (state.data.category_info || {})[c] || {}]);
  const fileAction = doc.document_url
    ? `<a class="action primary" href="${escapeHtml(doc.document_url)}" target="_blank" rel="noopener">Відкрити PDF${doc.size ? ` · ${escapeHtml(doc.size)}` : ""}</a>`
    : `<span class="dec-muted-box">Файл недоступний</span>`;
  const catLinks = infos.map(([c, i]) => i.url
    ? `<a class="action" href="${escapeHtml(i.url)}" target="_blank" rel="noopener">Сторінка ДЕЦ: ${escapeHtml(c)}</a>` : "").join("");

  const codesHtml = infos.map(([c, i]) => {
    if (!i.icd || !i.icd.length) {
      return `<p class="dec-muted">${infos.length > 1 ? `<b>${escapeHtml(c)}:</b> ` : ""}кодів МКХ-10 у документах категорії не знайдено.</p>`;
    }
    const chips = i.icd.slice(0, 40).map((x) =>
      `<a class="dec-code" href="../koduvannia/koder.html?q=${encodeURIComponent(x)}" title="Відкрити в Кодері">${escapeHtml(x)}</a>`).join("");
    return `<div class="dec-codes">${infos.length > 1 ? `<b>${escapeHtml(c)}</b>` : ""}${chips}${i.icd.length > 40 ? `<span class="dec-muted"> … ще ${i.icd.length - 40}</span>` : ""}
      <div class="dec-muted">Коди — з документа ДЕЦ ${escapeHtml(i.icd_from || "")}, розділ про шифр за МКХ-10.</div></div>`;
  }).join("");

  const links = packagesFor(doc.categories);
  let pkgHtml = links.map((l) => `
    <a class="dec-pkg" href="../pakety/index.html?package=${l.num}" target="_blank" rel="noopener">
      <strong>Пакет ${l.num}${pkgTitle(l.num) ? ": " + escapeHtml(pkgTitle(l.num)) : ""}</strong>
      ${l.note ? `<span class="dec-pkg-note">${escapeHtml(l.note)}</span>` : ""}
      <span class="dec-pkg-why">${l.source === "manual" ? (l.verified_by ? "Підтвердив: " + escapeHtml(l.verified_by) : "За специфікацією пакета") : "За Таблицею співставлення"} · ${escapeHtml(l.why || "")}</span>
    </a>`).join("");
  const anyIcd = infos.find(([, i]) => i.icd && i.icd.length);
  const broad = anyIcd
    ? `<p class="dec-muted">Стаціонарне лікування оплачується за ДСГ у пакетах ${BROAD.join(", ")} (і пакет 9 — амбулаторно):
       група залежить від коду діагнозу й втручання, тому окремим зв'язком тут не показується.
       <a href="../koduvannia/koder.html?q=${encodeURIComponent(anyIcd[1].icd[0])}">Перевірити в Кодері (${escapeHtml(anyIcd[1].icd[0])}) →</a></p>`
    : "";
  if (!pkgHtml) pkgHtml = `<p class="dec-muted">Спеціального пакета ПМГ, пов'язаного з цією категорією, не знайдено.</p>`;

  d.innerHTML = `
    <div class="detail-header">
      <span class="label">${escapeHtml(doc.type)}</span>
      <span class="label ${doc.state === "чинний" ? "ocr" : "dec-old"}">${escapeHtml(doc.status)}</span>
      <h2>${escapeHtml(doc.title)}</h2>
    </div>
    <div class="meta">
      <div class="meta-item"><span>Категорія</span><strong>${escapeHtml(doc.categories.join(" · "))}</strong></div>
      <div class="meta-item"><span>Реєстровий номер</span><strong>${escapeHtml(doc.number || "—")}</strong></div>
      <div class="meta-item"><span>Опубліковано</span><strong>${escapeHtml(doc.published || doc.date_raw || "—")}</strong></div>
      <div class="meta-item"><span>${doc.revised ? "Остання редакція" : "Рік"}</span><strong>${escapeHtml(doc.revised || doc.year || "—")}</strong></div>
    </div>
    ${doc.state !== "чинний" ? `<div class="dec-warn">ДЕЦ позначає документ як «${escapeHtml(doc.status_raw || doc.status)}».</div>` : ""}
    <div class="actions">${fileAction}${catLinks}</div>
    <div class="section-title">Коди діагнозів (МКХ-10)</div>
    ${codesHtml}
    <div class="section-title">Пакети ПМГ 2026</div>
    <div class="related">${pkgHtml}${broad}</div>`;
}

// ── каталог за напрямами ───────────────────────────────────────────────
function switchView(view) {
  state.activeView = view;
  el("view-search-btn").classList.toggle("active", view === "search");
  el("view-catalog-btn").classList.toggle("active", view !== "search");
  el("search-panel").style.display = view === "search" ? "block" : "none";
  el("cards").style.display = view === "search" ? "block" : "none";
  el("catalog-container").style.display = view === "search" ? "none" : "flex";
  if (view !== "search") renderCatalog();
  updateDownloadPanel();
}

function docsInCategory(name) {
  return state.data.documents.filter((d) => d.categories.includes(name)).length;
}

function directionsWithRest() {
  const dirs = (state.directions && state.directions.directions) || [];
  const known = new Set(dirs.flatMap((d) => d.pathologies.map((p) => p.name)));
  const rest = state.data.categories.filter((c) => !known.has(c));
  return rest.length ? [...dirs, { id: "other-new", title: "Інші та нові категорії", emoji: "🆕", pathologies: rest.map((name) => ({ name })) }] : dirs;
}

function renderCatalog() {
  el("catalog-directions-grid").innerHTML = directionsWithRest().map((dir) => {
    const live = dir.pathologies.filter((p) => docsInCategory(p.name));
    if (!live.length) return "";
    const n = live.reduce((sum, p) => sum + docsInCategory(p.name), 0);
    const active = state.selectedDirection && state.selectedDirection.id === dir.id ? " active" : "";
    return `<button type="button" class="direction-card${active}" data-dir="${escapeHtml(dir.id)}">
      <div class="dec-dir-emoji">${dir.emoji || "📁"}</div>
      <div class="dec-dir-title">${escapeHtml(dir.title)}</div>
      <div class="dec-dir-meta"><span>📁 ${live.length} кат.</span><span>📄 ${n} док.</span></div></button>`;
  }).join("");
}

function showPathologies(dir) {
  state.selectedDirection = dir;
  renderCatalog();
  el("catalog-pathologies-section").style.display = "block";
  el("selected-direction-title").innerHTML = `<span>${dir.emoji || "📁"}</span> ${escapeHtml(dir.title)}`;
  el("catalog-pathologies-list").innerHTML = dir.pathologies.map((p) => {
    const n = docsInCategory(p.name);
    if (!n) return "";
    const badges = packagesFor([p.name]).map((l) =>
      `<span class="dec-pkg-badge" title="${escapeHtml(l.why || "")}">П${l.num}</span>`).join(" ");
    return `<button type="button" class="pathology-btn" data-cat="${escapeHtml(p.name)}">
      <div class="dec-path-main"><span class="dec-path-name">${escapeHtml(p.name)}</span>
      <div class="dec-path-badges">${badges}</div></div><span class="dec-doc-count">📄 ${n}</span></button>`;
  }).join("");
}

function openCategory(name) {
  el("search").value = "";
  switchView("search");
  el("category").value = "";
  refreshFilterMenus(null);
  el("category").value = name;
  applyFilters();
}

function onCatalogClick(e) {
  const d = e.target.closest && e.target.closest(".direction-card");
  if (d) { const dir = directionsWithRest().find((x) => x.id === d.dataset.dir); if (dir) showPathologies(dir); return; }
  const p = e.target.closest && e.target.closest(".pathology-btn");
  if (p) openCategory(p.dataset.cat);
}

// ── старт ──────────────────────────────────────────────────────────────
async function init() {
  // Одна повторна спроба: обірваний запит (мережа, однопотоковий локальний сервер) не лишає сторінку порожньою
  const once = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const get = (u) => once(u).then((x) => x || new Promise((ok) => setTimeout(ok, 400)).then(() => once(u)));
  const [docs, links, pkgs, dirs] = await Promise.all([
    get("../data/dec_documents.json"),
    get("data/package_dec_links.json"),
    get("../pakety/data/packages_lite.json"),
    get("data/clinical_directions.json"),
  ]);
  if (!docs || !Array.isArray(docs.documents)) {
    el("resultCount").textContent = "Не вдалося завантажити реєстр ДЕЦ";
    el("cards").innerHTML = '<div class="no-results">Не вдалося завантажити реєстр документів ДЕЦ. Оновіть сторінку.</div>';
    return;
  }
  state.data = docs;
  packageLinks = links || {};
  packagesList = (pkgs && pkgs.packages) || [];
  state.directions = dirs;
  for (const d of docs.documents) {
    d.categories = d.categories || [d.category];
    d._t = normText(`${d.title} ${d.categories.join(" ")} ${d.type}`);
  }
  if (window.PMG_FIND) await PMG_FIND.ready();
  renderStats();

  el("search").addEventListener("input", applyFilters);
  ["category", "type", "status", "year"].forEach((id) => el(id).addEventListener("change", applyFilters));
  el("reset").addEventListener("click", () => {
    ["search", "category", "type", "status", "year"].forEach((id) => { el(id).value = ""; });
    applyFilters();
  });
  el("cards").addEventListener("click", onCardsClick);
  el("catalog-container").addEventListener("click", onCatalogClick);
  el("view-search-btn").addEventListener("click", () => switchView("search"));
  el("view-catalog-btn").addEventListener("click", () => switchView("catalog"));
  if (isLocal) {
    el("select-all-visible").addEventListener("change", (e) => {
      state.visible.forEach((d) => { if (e.target.checked && d.document_url) state.selectedDocsForDownload.add(d.id); else state.selectedDocsForDownload.delete(d.id); });
      renderCards();
    });
    el("download-selected-btn").addEventListener("click", downloadSelectedDocs);
  }
  const params = new URLSearchParams(location.search);
  const q = params.get("code") || params.get("q") || "";
  if (q) el("search").value = q;
  if (params.get("category")) {
    refreshFilterMenus(null);
    el("category").value = params.get("category");
  }
  applyFilters();
}

init().catch((e) => {
  console.error(e);
  el("cards").innerHTML = '<div class="no-results">Не вдалося завантажити реєстр документів ДЕЦ. Оновіть сторінку.</div>';
});
