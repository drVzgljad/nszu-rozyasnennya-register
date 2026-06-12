const state = { 
  data: null, 
  visible: [], 
  selected: null 
};
const el = (id) => document.getElementById(id);

const filterDefinitions = [
  { id: "document_type", allLabel: "Усі види", value: (doc) => doc.document_type, display: (v) => v },
  { id: "status", allLabel: "Усі статуси", value: (doc) => doc.status, display: (v) => v },
  { id: "category", allLabel: "Усі теми", value: (doc) => doc.category, display: (v) => v },
  { id: "year", allLabel: "Усі роки", value: (doc) => doc.year, display: (v) => v }
];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function currentFilters() {
  return {
    query: el("search").value.trim().toLowerCase(),
    document_type: el("document_type").value,
    status: el("status").value,
    category: el("category").value,
    year: el("year").value
  };
}

function matchesFilters(doc, filters, ignored = "") {
  if (filters.query && !doc.search_text.includes(filters.query)) return false;
  if (ignored !== "document_type" && filters.document_type && doc.document_type !== filters.document_type) return false;
  if (ignored !== "status" && filters.status && doc.status !== filters.status) return false;
  if (ignored !== "category" && filters.category && doc.category !== filters.category) return false;
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
  const uniqueCategories = new Set(state.data.documents.map(doc => doc.category).filter(Boolean)).size;

  el("stats").innerHTML = [
    [state.data.total_documents, "документів"],
    [uniqueCategories, "напрямів / тем"],
    [activeCount, "чинних актів"]
  ].map(([number, label]) => `<div class="stat"><strong>${number}</strong><span>${label}</span></div>`).join("");
}

function applyFilters() {
  refreshFilterMenus();
  const filters = currentFilters();
  
  if (!hasActiveFilters(filters)) {
    state.visible = [...state.data.documents];
    // Sort by adoption date descending, or by title
    state.visible.sort((left, right) => {
      const dateL = left.adoption_date || "";
      const dateR = right.adoption_date || "";
      if (dateL || dateR) return dateR.localeCompare(dateL);
      return left.title.localeCompare(right.title, "uk");
    });
    el("resultCount").textContent = `Всього документів: ${state.visible.length}`;
    renderCards();
    if (state.visible.length > 0) {
      selectDocument(state.visible[0].id);
    } else {
      renderWelcome();
    }
    return;
  }
  
  const query = filters.query;
  state.visible = state.data.documents.filter((doc) => matchesFilters(doc, filters));
  
  if (query) {
    state.visible.sort((left, right) => searchScore(right, query) - searchScore(left, query) || right.adoption_date.localeCompare(left.adoption_date));
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
  const category = doc.category ? doc.category.toLowerCase() : "";
  const docType = doc.document_type.toLowerCase();
  const number = doc.document_number ? doc.document_number.toLowerCase() : "";
  const content = doc.content ? doc.content.toLowerCase() : "";
  
  let score = 1;
  if (title.includes(query)) score += 80;
  if (number && number.includes(query)) score += 90;
  if (category && category.includes(query)) score += 50;
  if (docType.includes(query)) score += 30;
  if (content.includes(query)) score += 20;
  return score;
}

function renderCards(isBlank = false) {
  const container = el("cards");
  container.innerHTML = "";
  if (isBlank) return;
  if (!state.visible.length) {
    container.innerHTML = '<div class="no-results">За цими умовами документів не знайдено. Спробуйте змінити фільтри.</div>';
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
    } else if (statusLower.includes("втрат")) {
      statusClass = "tag doc-locked"; // Dark/grey styling
    } else if (statusLower.includes("проєкт") || statusLower.includes("проект")) {
      statusClass = "tag ocr"; // Yellow styling
    }
    
    card.querySelector(".card-tags").innerHTML =
      `<span class="${statusClass}">${escapeHtml(doc.status)}</span><span class="tag">${escapeHtml(doc.document_type)}</span>${doc.year ? `<span class="tag">${escapeHtml(doc.year)}</span>` : ''}`;
    card.querySelector("strong").textContent = doc.title;
    
    const subtitleParts = [];
    if (doc.category) subtitleParts.push(doc.category);
    if (doc.document_number) subtitleParts.push(`№ ${doc.document_number}`);
    if (doc.adoption_date) {
      const dateParts = doc.adoption_date.split("-");
      if (dateParts.length === 3) subtitleParts.push(`${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`);
    }
    card.querySelector(".card-subtitle").textContent = subtitleParts.join(" | ");
    
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
      <p>Результати пошуку з'являться після вибору умов або введення запиту.</p>
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

function renderDetail(doc) {
  const detail = el("detail");
  detail.classList.remove("empty");
  
  // Date format
  let dateFormatted = "-";
  if (doc.adoption_date) {
    const dateParts = doc.adoption_date.split("-");
    if (dateParts.length === 3) dateFormatted = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;
  }

  // Badges
  let statusClass = "tag";
  const statusLower = doc.status.toLowerCase();
  if (statusLower.startsWith("чинн")) {
    statusClass = "tag file"; 
  } else if (statusLower.includes("втрат")) {
    statusClass = "tag doc-locked";
  } else if (statusLower.includes("проєкт") || statusLower.includes("проект")) {
    statusClass = "tag ocr";
  }

  // Links block
  let linksHtml = "";
  if (doc.document_url || doc.file_url) {
    linksHtml = `<div class="detail-actions" style="display:flex; gap:12px; margin-top:20px; flex-wrap:wrap;">`;
    if (doc.document_url) {
      linksHtml += `<a href="${escapeHtml(doc.document_url)}" target="_blank" class="detail-btn web" style="text-decoration:none; display:inline-flex; align-items:center; gap:8px;">🌐 Офіційне джерело</a>`;
    }
    if (doc.file_url) {
      linksHtml += `<a href="${escapeHtml(doc.file_url)}" target="_blank" class="detail-btn doc" style="text-decoration:none; display:inline-flex; align-items:center; gap:8px;">📄 Локальна копія / перехід</a>`;
    }
    linksHtml += `</div>`;
  }

  // Metadata block
  const userMetadata = doc.updated_by_name ? `<div style="font-size:12px; color:var(--muted); margin-top:30px; border-top:1px solid var(--line); padding-top:12px;">Останній запис вніс: <strong>${escapeHtml(doc.updated_by_name)}</strong></div>` : "";

  detail.innerHTML = `
    <div class="detail-scroll">
      <div class="detail-header">
        <div class="detail-tags">
          <span class="${statusClass}">${escapeHtml(doc.status)}</span>
          <span class="tag">${escapeHtml(doc.document_type)}</span>
          ${doc.year ? `<span class="tag">${escapeHtml(doc.year)}</span>` : ""}
        </div>
        <h2>${escapeHtml(doc.title)}</h2>
      </div>

      <table class="properties-table">
        <tbody>
          <tr>
            <th>Вид документа</th>
            <td>${escapeHtml(doc.document_type)}</td>
          </tr>
          ${doc.document_number ? `<tr><th>Реєстраційний №</th><td>${escapeHtml(doc.document_number)}</td></tr>` : ""}
          ${doc.adoption_date ? `<tr><th>Дата прийняття</th><td>${dateFormatted}</td></tr>` : ""}
          ${doc.category ? `<tr><th>Тема / Напрям</th><td>${escapeHtml(doc.category)}</td></tr>` : ""}
          <tr>
            <th>Статус документа</th>
            <td><strong>${escapeHtml(doc.status)}</strong></td>
          </tr>
        </tbody>
      </table>

      ${linksHtml}

      ${doc.content ? `
        <div class="detail-content" style="margin-top:24px;">
          <h3 style="font-size:16px; font-weight:800; border-bottom:1px solid var(--line); padding-bottom:6px; margin-bottom:12px;">Короткий опис та зміст:</h3>
          <div class="content-text" style="font-size:14.5px; line-height:1.6; white-space:pre-wrap; color:var(--ink);">${escapeHtml(doc.content)}</div>
        </div>
      ` : ""}

      ${userMetadata}
    </div>
  `;
}

async function init() {
  let loadedFromSupabase = false;
  const sortedList = (set, desc = false) => [...set].sort((a,b) => desc ? b.localeCompare(a) : a.localeCompare(b, "uk"));

  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    if (sb) {
      const { data: dbData, error } = await sb.from('regulatory_documents').select('*');
      if (!error && dbData && dbData.length > 0) {
        const documents = dbData.map(doc => {
          const year = doc.adoption_date ? doc.adoption_date.split("-")[0] : "";
          return {
            ...doc,
            year,
            search_text: `${doc.title} ${doc.document_type} ${doc.status} ${doc.document_number} ${doc.category} ${doc.content || ""}`.toLowerCase()
          };
        });
        
        const categories = new Set(documents.map(d => d.category).filter(Boolean));
        const types = new Set(documents.map(d => d.document_type));
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
        console.log("Loaded regulatory documents from Supabase!");
      }
    }
  } catch (dbErr) {
    console.warn("Supabase fetch failed, falling back to local JSON:", dbErr);
  }

  if (!loadedFromSupabase) {
    const response = await fetch("data/regulatory_documents.json");
    const localData = await response.json();
    const documents = localData.documents.map(doc => {
      const year = doc.adoption_date ? doc.adoption_date.split("-")[0] : "";
      return {
        ...doc,
        year,
        search_text: `${doc.title} ${doc.document_type} ${doc.status} ${doc.document_number} ${doc.category} ${doc.content || ""}`.toLowerCase()
      };
    });
    
    const categories = new Set(documents.map(d => d.category).filter(Boolean));
    const types = new Set(documents.map(d => d.document_type));
    const statuses = new Set(documents.map(d => d.status));
    const years = new Set(documents.map(d => d.year).filter(Boolean));

    state.data = {
      generated: "Local JSON File",
      total_documents: documents.length,
      categories: sortedList(categories),
      types: sortedList(types),
      statuses: sortedList(statuses),
      years: sortedList(years, true),
      documents: documents
    };
    console.log("Loaded regulatory documents from local JSON file.");
  }

  renderStats();
  
  ["search", "document_type", "status", "category", "year"].forEach((id) => {
    el(id).addEventListener(id === "search" ? "input" : "change", applyFilters);
  });
  
  el("reset").addEventListener("click", () => {
    ["search", "document_type", "status", "category", "year"].forEach((id) => { el(id).value = ""; });
    applyFilters();
  });
  
  const params = new URLSearchParams(location.search);
  const initialQuery = params.get("q") || "";
  if (initialQuery) {
    el("search").value = initialQuery;
  }
  
  refreshFilterMenus();
  applyFilters();
}

init().catch((e) => {
  console.error(e);
  el("cards").innerHTML = "<p>Не вдалося завантажити дані нормативної бази. Перевірте консоль браузера.</p>";
});
