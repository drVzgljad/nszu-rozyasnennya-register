const algorithmState = {
  data: null,
  visible: [],
  selected: null,
};

const EFFECTIVE_DATE = "15.05.2026";

const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function highlight(value, query) {
  const escaped = escapeHtml(value);
  if (!query) return escaped;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
}

function formatStatus(status) {
  const s = (status || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  const takCount = (lower.match(/так/g) || []).length;
  const forPkg4 = lower.includes("для 4 пакету") ? " (тільки пакет 4)" : "";
  const parts = [];
  if (takCount >= 1) parts.push("Діти");
  if (takCount >= 2) parts.push("дорослі (крім Y36 та Y96)");
  return parts.length ? parts.join(", ") + forPkg4 : s;
}

function setMobileTab(tab) {
  document.querySelector(".algorithms-layout").dataset.active = tab;
  document.querySelectorAll(".mobile-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
}

function queryText() {
  return normalize(byId("algorithmSearch").value);
}

function renderStats() {
  byId("algorithmStats").innerHTML = [
    [algorithmState.data.documents_count, "джерела"],
    [algorithmState.data.records_count, "коди"],
    ["377", "наказ НСЗУ"],
  ].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function fillFilters() {
  const sourceSelect = byId("sourceFilter");
  const packageSelect = byId("packageFilter");
  sourceSelect.innerHTML = '<option value="">Усі джерела</option>' + algorithmState.data.documents.map((doc) =>
    `<option value="${escapeHtml(doc.id)}">${escapeHtml(doc.short_title)}</option>`
  ).join("");
  const packages = [...new Set(algorithmState.data.records.flatMap((record) => record.packages || []))].sort();
  packageSelect.innerHTML = '<option value="">Усі пакети</option>' + packages.map((value) =>
    `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
  ).join("");
}

function renderSources() {
  byId("sourceCards").innerHTML = algorithmState.data.documents.filter((doc) => doc.id !== "comparison-table").map((doc) => `
    <a class="source-card" href="${encodeURI(doc.href)}" target="_blank">
      <em>${escapeHtml(doc.short_title)}</em>
      <strong>${escapeHtml(doc.title)}</strong>
      <span>${escapeHtml(doc.description)}</span>
      <span>${doc.pages} стор.; кодів у тексті: ${doc.codes_count}</span>
      <span class="source-card-date">Набрали чинності: ${EFFECTIVE_DATE}</span>
    </a>
  `).join("");
}

function recordMatches(record, query, source, packageValue) {
  return (!query || record.search_text.includes(query)) &&
    (!source || record.source_id === source) &&
    (!packageValue || (record.packages || []).includes(packageValue));
}

function applyFilters() {
  const query = queryText();
  const source = byId("sourceFilter").value;
  const packageValue = byId("packageFilter").value;
  algorithmState.visible = algorithmState.data.records.filter((record) => recordMatches(record, query, source, packageValue));
  byId("algorithmCount").textContent = `Знайдено: ${algorithmState.visible.length} з ${algorithmState.data.records_count}`;
  const mobileCount = byId("mobileCount");
  if (mobileCount) mobileCount.textContent = algorithmState.visible.length;
  if (!algorithmState.visible.some((record) => record.id === algorithmState.selected?.id)) {
    algorithmState.selected = algorithmState.visible[0] || null;
  }
  renderCards();
  renderReader();
  updateUrl();
}

function updateUrl() {
  const params = new URLSearchParams();
  const query = queryText();
  if (query) params.set("q", query);
  if (byId("sourceFilter").value) params.set("source", byId("sourceFilter").value);
  if (byId("packageFilter").value) params.set("package", byId("packageFilter").value);
  if (algorithmState.selected) params.set("code", algorithmState.selected.code);
  history.replaceState(null, "", `${location.pathname}${params.toString() ? `?${params}` : ""}`);
}

function renderCards() {
  const query = byId("algorithmSearch").value.trim();
  byId("algorithmCards").innerHTML = algorithmState.visible.map((record) => `
    <button class="algorithm-card ${record.id === algorithmState.selected?.id ? "active" : ""}" type="button" data-id="${escapeHtml(record.id)}">
      <span class="algorithm-card-main">
        <span class="algorithm-code">${escapeHtml(record.code)}</span>
        <span class="algorithm-card-copy">
          <span class="algorithm-card-header">
            <em>${escapeHtml(record.source_title)}</em>
            <span class="algorithm-badge">ЗМІНА ${EFFECTIVE_DATE}</span>
          </span>
          <strong>${highlight(record.name, query)}</strong>
          <span>${escapeHtml(record.status || "Статус у таблиці не виділено")} · стор. ${record.page}</span>
        </span>
      </span>
    </button>
  `).join("") || '<div class="no-results">За цим запитом кодів не знайдено. Спробуйте код, частину назви або очистіть фільтри.</div>';
  byId("algorithmCards").querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      algorithmState.selected = algorithmState.data.records.find((record) => record.id === button.dataset.id);
      renderCards();
      renderReader();
      updateUrl();
      if (window.innerWidth <= 1180) setMobileTab("reader");
    });
  });
}

function summaryText(record) {
  const packages = (record.packages || []).length ? `Пакет/правило: ${record.packages.join(", ")}.` : "";
  const status = formatStatus(record.status) ? `Застосовується до: ${formatStatus(record.status)}.` : "";
  return [
    `Код ${record.code}: ${record.name}.`,
    `Джерело: ${record.document_title}, стор. ${record.page}.`,
    packages,
    status,
  ].filter(Boolean).join("\n");
}

function renderReader() {
  const record = algorithmState.selected;
  const container = byId("algorithmReader");
  if (!record) {
    container.classList.add("reader-empty");
    container.innerHTML = "<p>Оберіть код або правило, щоб побачити деталі й сформувати текст для копіювання.</p>";
    return;
  }
  container.classList.remove("reader-empty");
  const packages = (record.packages || []).map((value) => `<span class="algorithm-pill">Пакет ${escapeHtml(value)}</span>`).join("");
  const comparisonHref = algorithmState.data.comparison_href;
  const comparePage = record.comparison_page;
  const compareUrl = comparisonHref
    ? encodeURI(comparisonHref) + (comparePage ? `#page=${comparePage}` : "")
    : null;
  container.innerHTML = `
    <h2>${escapeHtml(record.code)}</h2>
    <div class="algorithm-meta">
      <span class="algorithm-pill">${escapeHtml(record.source_title)}</span>
      <span class="algorithm-pill">стор. ${record.page}</span>
      <span class="algorithm-pill algorithm-pill--change">Набрали чинності: ${EFFECTIVE_DATE}</span>
      ${packages}
    </div>
    <div class="algorithm-text-box">
      <strong>${escapeHtml(record.name)}</strong>
      ${formatStatus(record.status) ? `<p>Застосовується до: ${escapeHtml(formatStatus(record.status))}</p>` : ""}
    </div>
    ${compareUrl ? `
    <div class="algorithm-compare-hint">
      <span>Зміни до цього коду — у порівняльній таблиці${comparePage ? `, стор. ${comparePage}` : ""}</span>
      <a href="${compareUrl}" target="_blank">Переглянути →</a>
    </div>` : ""}
    <label class="search">
      <span>Зведення для копіювання</span>
      <textarea class="algorithm-copy" id="algorithmCopy" readonly>${escapeHtml(summaryText(record))}</textarea>
    </label>
    <div class="algorithm-actions">
      <button class="action primary" id="copyAlgorithm" type="button">Копіювати висновок</button>
      <a class="action" href="${encodeURI(record.href)}" target="_blank">Відкрити PDF</a>
      ${compareUrl ? `<a class="action" href="${compareUrl}" target="_blank">Порівняльна таблиця${comparePage ? ` (стор. ${comparePage})` : ""}</a>` : ""}
      ${(record.packages || []).filter((value) => /^\d+$/.test(value)).slice(0, 1).map((value) =>
        `<a class="action" href="../pakety/index.html?package=${encodeURIComponent(value)}">До пакета ${escapeHtml(value)}</a>`
      ).join("")}
    </div>
  `;
  byId("copyAlgorithm").addEventListener("click", copySummary);
}

async function copySummary() {
  const textarea = byId("algorithmCopy");
  const button = byId("copyAlgorithm");
  if (!textarea?.value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(textarea.value);
    } else {
      textarea.select();
      document.execCommand("copy");
    }
    button.textContent = "Скопійовано";
    window.setTimeout(() => { button.textContent = "Копіювати висновок"; }, 1300);
  } catch (error) {
    console.warn("Не вдалося скопіювати зведення.", error);
    button.textContent = "Не скопійовано";
    window.setTimeout(() => { button.textContent = "Копіювати висновок"; }, 1300);
  }
}

async function initAlgorithms() {
  const response = await fetch("data/algorithms_377.json");
  algorithmState.data = await response.json();
  const params = new URLSearchParams(location.search);
  byId("algorithmSearch").value = params.get("q") || "";
  renderStats();
  fillFilters();
  renderSources();
  byId("sourceFilter").value = params.get("source") || "";
  byId("packageFilter").value = params.get("package") || "";
  byId("algorithmSearch").addEventListener("input", applyFilters);
  byId("sourceFilter").addEventListener("change", applyFilters);
  byId("packageFilter").addEventListener("change", applyFilters);
  byId("clearAlgorithms").addEventListener("click", () => {
    byId("algorithmSearch").value = "";
    byId("sourceFilter").value = "";
    byId("packageFilter").value = "";
    applyFilters();
  });
  document.querySelectorAll(".mobile-tab").forEach((btn) => {
    btn.addEventListener("click", () => setMobileTab(btn.dataset.tab));
  });
  applyFilters();
  const code = params.get("code");
  if (code) {
    const match = algorithmState.visible.find((record) => record.code === code);
    if (match) {
      algorithmState.selected = match;
      renderCards();
      renderReader();
    }
  }
}

initAlgorithms().catch((error) => {
  console.error("Не вдалося завантажити алгоритми та правила.", error);
  byId("algorithmCards").innerHTML = '<div class="no-results">Не вдалося завантажити дані алгоритмів та правил.</div>';
});
