const state = { data: null, visible: [], selected: null };
const el = (id) => document.getElementById(id);
const filterDefinitions = [
  { id: "direction", allLabel: "Усі напрями", value: (doc) => doc.direction, display: humanize },
  { id: "package", allLabel: "Усі пакети", value: (doc) => doc.package, display: humanize },
  { id: "year", allLabel: "Усі роки", value: (doc) => doc.year, display: (value) => value },
  { id: "documentDate", allLabel: "Усі дати", value: (doc) => doc.document_date, display: formatDate },
  { id: "documentNumber", allLabel: "Усі номери", value: (doc) => doc.document_number, display: (value) => value },
  { id: "format", allLabel: "Усі формати", value: (doc) => doc.format, display: (value) => value },
  {
    id: "quality",
    allLabel: "Усі документи",
    value: (doc) => doc.ocr ? "ocr" : "text",
    display: (value) => value === "ocr" ? "Розпізнані скани" : "З машинним текстом"
  }
];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function humanize(value) {
  return value.replaceAll("-", " ");
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function currentFilters() {
  return {
    query: el("search").value.trim().toLowerCase(),
    direction: el("direction").value,
    package: el("package").value,
    year: el("year").value,
    documentDate: el("documentDate").value,
    documentNumber: el("documentNumber").value,
    format: el("format").value,
    quality: el("quality").value
  };
}

function matchesFilters(doc, filters, ignored = "") {
  if (filters.query && !doc.search_text.includes(filters.query)) return false;
  if (ignored !== "direction" && filters.direction && doc.direction !== filters.direction) return false;
  if (ignored !== "package" && filters.package && doc.package !== filters.package) return false;
  if (ignored !== "year" && filters.year && doc.year !== filters.year) return false;
  if (ignored !== "documentDate" && filters.documentDate && doc.document_date !== filters.documentDate) return false;
  if (ignored !== "documentNumber" && filters.documentNumber && doc.document_number !== filters.documentNumber) return false;
  if (ignored !== "format" && filters.format && doc.format !== filters.format) return false;
  if (ignored !== "quality" && filters.quality === "ocr" && !doc.ocr) return false;
  if (ignored !== "quality" && filters.quality === "text" && doc.ocr) return false;
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
        definition.id === "year" || definition.id === "documentDate"
          ? right.localeCompare(left)
          : definition.display(left).localeCompare(definition.display(right), "uk")
      );
      select.replaceChildren(new Option(definition.allLabel, ""));
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
  el("stats").innerHTML = [
    [state.data.unique_files, "файлів"],
    [Object.keys(state.data.directions).length, "напрямів"],
    [state.data.site_records, "записів архіву"]
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
    state.visible.sort((left, right) => searchScore(right, query) - searchScore(left, query) || right.year.localeCompare(left.year));
  } else {
    state.visible.sort((left, right) =>
      attachmentRank(left) - attachmentRank(right) ||
      right.year.localeCompare(left.year) ||
      left.direction.localeCompare(right.direction, "uk") ||
      left.title.localeCompare(right.title, "uk")
    );
  }
  el("resultCount").textContent = `Знайдено: ${state.visible.length} з ${state.data.unique_files}`;
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

function attachmentRank(doc) {
  return doc.title.toLowerCase().includes("додат") ? 1 : 0;
}

function searchScore(doc, query) {
  const title = doc.title.toLowerCase();
  const direction = doc.direction.toLowerCase();
  const packageName = doc.package.toLowerCase();
  const topic = doc.topic.toLowerCase();
  let score = 1;
  if (title.includes(query)) score += 70;
  if (direction.includes(query)) score += 90;
  if (packageName.includes(query)) score += 80;
  if (topic.includes(query)) score += 40;
  return score;
}

function renderCards(isBlank = false) {
  const container = el("cards");
  container.replaceChildren();
  if (isBlank) return;
  if (!state.visible.length) {
    container.innerHTML = '<div class="no-results">За цими умовами документів не знайдено. Спробуйте коротше слово або очистіть фільтри.</div>';
    return;
  }
  state.visible.forEach((doc) => {
    const card = el("cardTemplate").content.firstElementChild.cloneNode(true);
    card.classList.toggle("active", state.selected?.id === doc.id);
    card.querySelector(".card-tags").innerHTML =
      `<span class="tag">${escapeHtml(doc.document_date_display || doc.year)}</span><span class="tag file">${escapeHtml(doc.format)}</span>`;
    card.querySelector("strong").textContent = doc.title;
    card.querySelector(".card-subtitle").textContent =
      `${doc.direction.replaceAll("-", " ")} | ${doc.package.replaceAll("-", " ")}`;
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
      <p>Результати з'являться після вибору умови або введення пошукового запиту.</p>
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

function localHref(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function selectDocument(id) {
  const documentInfo = state.data.documents.find((doc) => doc.id === id);
  if (!documentInfo) return;
  state.selected = documentInfo;
  renderCards();
  renderDetail(documentInfo);
}

function renderDetail(doc) {
  const detail = el("detail");
  detail.classList.remove("empty");
  const yearLabel = doc.year_basis === "publication_year" ? "Рік публікації" : "Рік документа";
  const duplicates = doc.record_ids.length > 1
    ? `<span class="label">У переліку повторено ${doc.record_ids.length} рази</span>` : "";
  const related = doc.related.map((relationship) => {
    const other = state.data.documents.find((item) => item.id === relationship.id);
    if (!other) return "";
    return `<button data-related="${other.id}"><strong>${escapeHtml(other.title)}</strong><span>${escapeHtml(relationship.reason)}</span></button>`;
  }).join("");
  detail.innerHTML = `
    <div class="detail-header">
      <span class="label">${escapeHtml(doc.direction.replaceAll("-", " "))}</span>
      <span class="label">${escapeHtml(doc.package.replaceAll("-", " "))}</span>
      ${doc.ocr ? '<span class="label ocr">OCR зі скану</span>' : ""}
      ${duplicates}
      <h2>${escapeHtml(doc.title)}</h2>
    </div>
    <div class="meta">
      <div class="meta-item"><span>Дата документа</span><strong>${escapeHtml(doc.document_date_display || "Не визначено")}</strong></div>
      <div class="meta-item"><span>Номер документа</span><strong>${escapeHtml(doc.document_number ? `№ ${doc.document_number}` : "Не визначено")}</strong></div>
      <div class="meta-item"><span>${yearLabel}</span><strong>${escapeHtml(doc.year)}</strong></div>
      <div class="meta-item"><span>Формат</span><strong>${escapeHtml(doc.format)}</strong></div>
      <div class="meta-item"><span>Тема</span><strong>${escapeHtml(doc.topic)}</strong></div>
      <div class="meta-item"><span>Запис в архіві</span><strong>№ ${escapeHtml(doc.record_ids.join(", "))}</strong></div>
    </div>
    <div class="actions">
      <a class="action primary" href="${localHref(doc.local_path)}" target="_blank">Відкрити файл</a>
      <a class="action" href="${escapeHtml(doc.source_url)}" target="_blank" rel="noopener">Джерело НСЗУ</a>
    </div>
    <div class="section-title">Назва у бібліотеці</div>
    <div class="excerpt">${escapeHtml(doc.name)}</div>
    <div class="section-title">Оригінальна технічна назва</div>
    <div class="excerpt">${escapeHtml(doc.original_name)}</div>
    <div class="section-title">Фрагмент змісту</div>
    <div class="excerpt">${escapeHtml(doc.excerpt || "Текстовий фрагмент недоступний.")}</div>
    <div class="section-title">Пов'язані документи</div>
    <div class="related">${related || "<p>Пов'язані документи не визначено.</p>"}</div>
  `;
  detail.querySelectorAll("[data-related]").forEach((button) => {
    button.addEventListener("click", () => selectDocument(Number(button.dataset.related)));
  });
}

async function init() {
  const response = await fetch("data/documents.json");
  state.data = await response.json();
  renderStats();
  ["search", "direction", "package", "year", "documentDate", "documentNumber", "format", "quality"].forEach((id) => {
    el(id).addEventListener(id === "search" ? "input" : "change", applyFilters);
  });
  el("reset").addEventListener("click", () => {
    ["search", "direction", "package", "year", "documentDate", "documentNumber", "format", "quality"].forEach((id) => { el(id).value = ""; });
    applyFilters();
  });
  const params = new URLSearchParams(location.search);
  const initialPackage = params.get("package") || "";
  const initialQuery = params.get("q") || "";
  if (initialQuery) el("search").value = initialQuery;
  refreshFilterMenus();
  if (initialPackage && Array.from(el("package").options).some((option) => option.value === initialPackage)) {
    el("package").value = initialPackage;
  }
  applyFilters();
}

init().catch(() => {
  el("cards").innerHTML = "<p>Не вдалося завантажити дані реєстру. Запустіть сторінку через локальний запуск.</p>";
});
