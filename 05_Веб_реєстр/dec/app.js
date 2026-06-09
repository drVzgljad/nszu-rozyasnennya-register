const state = { data: null, visible: [], selected: null };
const el = (id) => document.getElementById(id);

const filterDefinitions = [
  { id: "category", allLabel: "Усі категорії", value: (doc) => doc.category, display: (v) => v },
  { id: "type", allLabel: "Усі види", value: (doc) => doc.type, display: (v) => v },
  { id: "status", allLabel: "Усі статуси", value: (doc) => doc.status, display: (v) => v },
  { id: "year", allLabel: "Усі роки", value: (doc) => doc.year, display: (v) => v }
];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function currentFilters() {
  return {
    query: el("search").value.trim().toLowerCase(),
    category: el("category").value,
    type: el("type").value,
    status: el("status").value,
    year: el("year").value
  };
}

function matchesFilters(doc, filters, ignored = "") {
  if (filters.query && !doc.search_text.includes(filters.query)) return false;
  if (ignored !== "category" && filters.category && doc.category !== filters.category) return false;
  if (ignored !== "type" && filters.type && doc.type !== filters.type) return false;
  if (ignored !== "status" && filters.status && doc.status !== filters.status) return false;
  if (ignored !== "year" && filters.year && doc.year !== filters.year) return false;
  return true;
}

function refreshFilterMenus() {
  let filtersChanged = false;
  do {
    filtersChanged = false;
    const filters = currentFilters();
    filterDefinitions.forEach((definition) => {
      const select = el(definition.id);
      const currentValue = select.value;
      const counts = new Map();
      state.data.documents
        .filter((doc) => matchesFilters(doc, filters, definition.id))
        .forEach((doc) => {
          const value = definition.value(doc);
          if (!value) return;
          counts.set(value, (counts.get(value) || 0) + 1);
        });
      const options = [...counts.keys()].sort((left, right) =>
        definition.id === "year"
          ? right.localeCompare(left)
          : definition.display(left).localeCompare(definition.display(right), "uk")
      );
      select.innerHTML = "";
      select.appendChild(new Option(definition.allLabel, ""));
      options.forEach((value) => {
        select.add(new Option(`${definition.display(value)} (${counts.get(value)})`, value));
      });
      if (currentValue && counts.has(currentValue)) {
        select.value = currentValue;
      } else if (currentValue) {
        select.value = "";
        filtersChanged = true;
      }
    });
  } while (filtersChanged);
}

function renderStats() {
  const activeCount = state.data.documents.filter(doc => doc.status.toLowerCase().startsWith("чинн")).length;
  const uniqueCategories = new Set(state.data.documents.map(doc => doc.category)).size;

  el("stats").innerHTML = [
    [state.data.total_documents, "документів ДЕЦ"],
    [uniqueCategories, "напрямів / тем"],
    [activeCount, "чинних норм"]
  ].map(([number, label]) => `<div class="stat"><strong>${number}</strong><span>${label}</span></div>`).join("");
}

function applyFilters() {
  refreshFilterMenus();
  const filters = currentFilters();
  if (!hasActiveFilters(filters)) {
    state.visible = [];
    state.selected = null;
    el("resultCount").textContent = "Оберіть фільтр або введіть запит";
    renderCards(true);
    renderWelcome();
    return;
  }
  const query = filters.query;
  state.visible = state.data.documents.filter((doc) => matchesFilters(doc, filters));
  
  if (query) {
    state.visible.sort((left, right) => searchScore(right, query) - searchScore(left, query) || right.id - left.id);
  } else {
    state.visible.sort((left, right) =>
      left.category.localeCompare(right.category, "uk") ||
      left.title.localeCompare(right.title, "uk")
    );
  }
  
  el("resultCount").textContent = `Знайдено: ${state.visible.length} з ${state.data.total_documents}`;
  renderCards();
  if (!state.visible.length) {
    renderNoResults();
    return;
  }
  if (!state.selected || !state.visible.some((doc) => doc.id === state.selected.id)) {
    selectDocument(state.visible[0].id);
  }
}

function hasActiveFilters(filters) {
  return Object.values(filters).some((value) => Boolean(value));
}

function searchScore(doc, query) {
  const title = doc.title.toLowerCase();
  const category = doc.category.toLowerCase();
  const docType = doc.type.toLowerCase();
  const number = doc.number.toLowerCase();
  let score = 1;
  if (title.includes(query)) score += 80;
  if (category.includes(query)) score += 60;
  if (docType.includes(query)) score += 30;
  if (number.includes(query)) score += 90;
  return score;
}

function renderCards(isBlank = false) {
  const container = el("cards");
  container.innerHTML = "";
  if (isBlank) return;
  if (!state.visible.length) {
    container.innerHTML = '<div class="no-results">За цими умовами документів не знайдено. Спробуйте інше слово або очистіть фільтри.</div>';
    return;
  }
  state.visible.forEach((doc) => {
    const card = el("cardTemplate").content.firstElementChild.cloneNode(true);
    card.classList.toggle("active", state.selected?.id === doc.id);
    
    // Status color badge
    let statusClass = "tag";
    const statusLower = doc.status.toLowerCase();
    if (statusLower.startsWith("чинн")) {
      statusClass = "tag file"; // Teal styling
    }
    
    card.querySelector(".card-tags").innerHTML =
      `<span class="${statusClass}">${escapeHtml(doc.status)}</span><span class="tag">${escapeHtml(doc.type)}</span>${doc.year ? `<span class="tag">${escapeHtml(doc.year)}</span>` : ''}`;
    card.querySelector("strong").textContent = doc.title;
    card.querySelector(".card-subtitle").textContent =
      `${doc.category} ${doc.number ? '| ' + doc.number : ''}`;
    card.addEventListener("click", () => selectDocument(doc.id));
    container.appendChild(card);
  });
}

function renderWelcome() {
  const detail = el("detail");
  detail.classList.add("empty");
  detail.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">i</div>
      <h2>Оберіть фільтр або знайдіть документ</h2>
      <p>Результати пошуку з'являться після вибору умови або введення пошукового запиту.</p>
    </div>`;
}

function renderNoResults() {
  const detail = el("detail");
  detail.classList.add("empty");
  detail.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">?</div>
      <h2>Нічого не знайдено</h2>
      <p>Змініть пошуковий запит або натисніть «Очистити фільтри».</p>
    </div>`;
}

function selectDocument(id) {
  const documentInfo = state.data.documents.find((doc) => doc.id === id);
  if (!documentInfo) return;
  state.selected = documentInfo;
  renderCards();
  renderDetail(documentInfo);
  if (window.innerWidth <= 1040) {
    el("detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

let packageLinks = {};
let packagesList = [];

function renderDetail(doc) {
  const detail = el("detail");
  detail.classList.remove("empty");
  
  let statusBadgeClass = "label";
  if (doc.status.toLowerCase().startsWith("чинн")) {
    statusBadgeClass = "label ocr"; // Highlighted
  }

  const fileActions = doc.document_url 
    ? `<a class="action primary" href="${escapeHtml(doc.document_url)}" target="_blank" rel="noopener">Завантажити PDF</a>` 
    : `<span style="font-size: 13px; color: var(--muted); padding: 10px; border: 1px dashed var(--line); border-radius: 10px;">Файл недоступний</span>`;

  const categoryAction = doc.category_url 
    ? `<a class="action" href="${escapeHtml(doc.category_url)}" target="_blank" rel="noopener">Сторінка категорії ДЕЦ</a>` 
    : "";

  // Find linked packages
  const linkedPackages = [];
  for (const pkgNum in packageLinks) {
    if (packageLinks[pkgNum].includes(doc.category)) {
      const pkg = packagesList.find(p => p.number === pkgNum);
      if (pkg) {
        linkedPackages.push(pkg);
      }
    }
  }
  
  let packagesHtml = "";
  if (linkedPackages.length > 0) {
    packagesHtml = linkedPackages.map(pkg => 
      `<a class="law-related-link" href="../pakety/index.html?package=${pkg.number}" target="_blank" style="margin-bottom: 7px; display: block; padding: 10px 11px; border: 1px solid #d5e5f3; border-radius: 10px; color: var(--ink); background: #f5faff; text-decoration: none; font-size: 12px; line-height: 1.4;">
        <strong>Пакет ${pkg.number}: ${escapeHtml(pkg.title)}</strong>
        <span style="font-size: 11px; color: var(--muted); margin-top: 4px; display: block;">Переглянути вимоги закупівлі</span>
      </a>`
    ).join("");
  } else {
    packagesHtml = "<p style='font-size: 13px; color: var(--muted);'>Пов'язаних пакетів ПМГ не знайдено.</p>";
  }

  detail.innerHTML = `
    <div class="detail-header">
      <span class="label">${escapeHtml(doc.type)}</span>
      <span class="${statusBadgeClass}">${escapeHtml(doc.status)}</span>
      <h2>${escapeHtml(doc.title)}</h2>
    </div>
    <div class="meta">
      <div class="meta-item"><span>Категорія</span><strong>${escapeHtml(doc.category)}</strong></div>
      <div class="meta-item"><span>Реєстровий номер</span><strong>${escapeHtml(doc.number || "Не визначено")}</strong></div>
      <div class="meta-item"><span>Опубліковано</span><strong>${escapeHtml(doc.published || "Не визначено")}</strong></div>
      <div class="meta-item"><span>Рік</span><strong>${escapeHtml(doc.year || "—")}</strong></div>
    </div>
    <div class="actions">
      ${fileActions}
      ${categoryAction}
    </div>
    <div class="section-title">Назва документа</div>
    <div class="excerpt">${escapeHtml(doc.title)}</div>
    <div class="section-title">Категорія ДЕЦ</div>
    <div class="excerpt">${escapeHtml(doc.category)}</div>
    <div class="section-title">Пов'язані пакети ПМГ 2026</div>
    <div class="related">${packagesHtml}</div>
  `;
}

async function init() {
  // 1. Try to load package mapping and package list
  try {
    const [linksRes, pkgsRes] = await Promise.all([
      fetch("data/package_dec_links.json").catch(() => null),
      fetch("../pakety/data/packages_2026.json").catch(() => null)
    ]);
    if (linksRes) packageLinks = await linksRes.json();
    if (pkgsRes) packagesList = (await pkgsRes.json()).packages || [];
  } catch (e) {
    console.warn("Failed to load package data or links:", e);
  }

  // 2. Try to load from Supabase with local fallback
  let loadedFromSupabase = false;
  const sortedList = (set, desc = false) => [...set].sort((a,b) => desc ? b.localeCompare(a) : a.localeCompare(b, "uk"));

  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    if (sb) {
      const { data: dbData, error } = await sb.from('dec_documents').select('*');
      if (!error && dbData && dbData.length > 0) {
        const documents = dbData.map(doc => ({
          ...doc,
          search_text: `${doc.title} ${doc.category} ${doc.status} ${doc.type} ${doc.number} ${doc.published}`.toLowerCase()
        }));
        const categories = new Set(documents.map(d => d.category));
        const types = new Set(documents.map(d => d.type));
        const statuses = new Set(documents.map(d => d.status));
        const years = new Set(documents.map(d => d.year).filter(Boolean));

        state.data = {
          generated: "Supabase Realtime",
          total_documents: documents.length,
          categories: sortedList(categories),
          types: sortedList(types),
          statuses: sortedList(statuses),
          years: sortedList(years, true),
          documents: documents
        };
        loadedFromSupabase = true;
        console.log("Loaded DEC documents from Supabase database!");
      }
    }
  } catch (dbErr) {
    console.warn("Supabase fetch skipped or failed, falling back to local JSON:", dbErr);
  }

  if (!loadedFromSupabase) {
    const response = await fetch("../data/dec_documents.json");
    state.data = await response.json();
    console.log("Loaded DEC documents from local JSON file.");
  }

  renderStats();
  
  ["search", "category", "type", "status", "year"].forEach((id) => {
    el(id).addEventListener(id === "search" ? "input" : "change", applyFilters);
  });
  
  el("reset").addEventListener("click", () => {
    ["search", "category", "type", "status", "year"].forEach((id) => { el(id).value = ""; });
    applyFilters();
  });
  
  const params = new URLSearchParams(location.search);
  const initialQuery = params.get("q") || "";
  if (initialQuery) el("search").value = initialQuery;
  
  refreshFilterMenus();
  applyFilters();
}

init().catch((e) => {
  console.error(e);
  el("cards").innerHTML = "<p>Не вдалося завантажити дані реєстру ДЕЦ МОЗ. Перевірте консоль браузера.</p>";
});
