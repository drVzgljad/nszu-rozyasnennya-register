const resolutionState = {
  data: null,
  explanations: [],
  nodes: [],
  visible: [],
  selected: null,
  selectedParagraph: "",
  type: "",
  packageNumber: "",
};

const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function highlight(value, query) {
  const escaped = escapeHtml(value);
  if (!query) return escaped;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
}

function queryText() {
  return byId("resolutionSearch").value.trim().toLowerCase();
}

function kindLabel(node) {
  if (node.kind === "chapter") return "Тарифна глава";
  if (node.kind === "appendix") return "Додаток";
  return "Розділ";
}

function typeLabels(node) {
  return node.types.map((type) => resolutionState.data.type_labels[type] || type);
}

function searchableText(node) {
  return [
    node.title,
    node.text,
    ...node.items.map((item) => item.text),
    ...node.related_packages.map((pkg) => pkg.title),
  ].join(" ").toLowerCase();
}

function updateUrl() {
  const params = new URLSearchParams();
  if (resolutionState.selected) params.set("node", resolutionState.selected.id);
  if (resolutionState.selectedParagraph) params.set("paragraph", resolutionState.selectedParagraph);
  if (resolutionState.packageNumber) params.set("package", resolutionState.packageNumber);
  const query = queryText();
  if (query) params.set("q", query);
  if (resolutionState.type) params.set("type", resolutionState.type);
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

function renderStats() {
  const counts = resolutionState.data.counts;
  byId("resolutionStats").innerHTML = [
    [counts.chapters, "глави"],
    [counts.appendices, "додатки"],
    [resolutionState.data.document.page_count, "сторінки"],
  ].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderTypes() {
  const types = [...new Set(resolutionState.nodes.flatMap((node) => node.types))];
  byId("typeFilters").innerHTML = types.map((type) =>
    `<button class="type-chip ${resolutionState.type === type ? "active" : ""}" data-type="${escapeHtml(type)}">${escapeHtml(resolutionState.data.type_labels[type])}</button>`
  ).join("");
  byId("typeFilters").querySelectorAll("[data-type]").forEach((button) => {
    button.addEventListener("click", () => {
      resolutionState.type = resolutionState.type === button.dataset.type ? "" : button.dataset.type;
      applyFilters();
    });
  });
}

function firstMatchedParagraph(node, query) {
  if (!query) return "";
  return node.items.find((item) => item.text.toLowerCase().includes(query))?.id || "";
}

function applyFilters() {
  const query = queryText();
  resolutionState.visible = resolutionState.nodes.filter((node) =>
    (!query || searchableText(node).includes(query)) &&
    (!resolutionState.type || node.types.includes(resolutionState.type)) &&
    (!resolutionState.packageNumber || node.package_numbers.includes(resolutionState.packageNumber))
  );
  byId("resolutionCount").textContent = `Знайдено: ${resolutionState.visible.length} з ${resolutionState.nodes.length}`;
  if (!resolutionState.visible.some((node) => node.id === resolutionState.selected?.id)) {
    selectNode(resolutionState.visible[0] || null);
  } else if (query && resolutionState.selected) {
    resolutionState.selectedParagraph = firstMatchedParagraph(resolutionState.selected, query);
  }
  renderTypes();
  renderCards();
  renderOutline();
  renderReader();
  updateUrl();
}

function renderCards() {
  const query = queryText();
  byId("resolutionCards").innerHTML = resolutionState.visible.map((node) => {
    const context = node.package_numbers.length ? `Пакети: ${node.package_numbers.join(", ")}` : `Стор. ${node.page_start}`;
    const match = query && firstMatchedParagraph(node, query) ? " · збіг у пункті" : "";
    return `<button class="resolution-card ${node.id === resolutionState.selected?.id ? "active" : ""}" data-node="${node.id}">
      <span class="card-kind">${kindLabel(node)}</span>
      <strong>${escapeHtml(node.title)}</strong>
      <small>${escapeHtml(context + match)}</small>
    </button>`;
  }).join("") || '<div class="no-results">За цим запитом норм не знайдено.</div>';
  byId("resolutionCards").querySelectorAll("[data-node]").forEach((button) => {
    button.addEventListener("click", () => selectNode(resolutionState.nodes.find((node) => node.id === button.dataset.node)));
  });
}

function selectNode(node, paragraphId = "") {
  resolutionState.selected = node;
  resolutionState.selectedParagraph = paragraphId || firstMatchedParagraph(node || {items: []}, queryText());
  renderCards();
  renderOutline();
  renderReader();
  updateUrl();
}

function renderOutline() {
  const node = resolutionState.selected;
  const container = byId("resolutionOutline");
  if (!node) {
    container.innerHTML = '<div class="empty-state"><h2>Норму не обрано</h2><p>Уточніть пошук або очистіть фільтри.</p></div>';
    return;
  }
  const pages = node.page_start === node.page_end ? `стор. ${node.page_start}` : `стор. ${node.page_start}-${node.page_end}`;
  const paragraphs = node.items.map((item) =>
    `<button class="paragraph-link ${item.id === resolutionState.selectedParagraph ? "active" : ""}" data-paragraph="${item.id}">Пункт ${escapeHtml(item.number)} <span>стор. ${item.page}</span></button>`
  ).join("");
  container.innerHTML = `
    <div class="outline-label">${kindLabel(node)}</div>
    <h2>${escapeHtml(node.title)}</h2>
    <p class="source-pages">${pages}</p>
    <div class="norm-tags">${typeLabels(node).map((label) => `<span class="norm-tag">${escapeHtml(label)}</span>`).join("")}</div>
    ${paragraphs || "<p>Окремі нумеровані пункти у цьому блоці не виділено.</p>"}`;
  container.querySelectorAll("[data-paragraph]").forEach((button) => {
    button.addEventListener("click", () => {
      resolutionState.selectedParagraph = button.dataset.paragraph;
      renderOutline();
      renderReader();
      updateUrl();
    });
  });
}

function relatedPackages(node) {
  if (!node.related_packages.length) return "<p>Цей загальний розділ не прив'язаний до окремого пакета.</p>";
  return node.related_packages.map((pkg) =>
    `<a class="package-law-link" href="../pakety/index.html?package=${encodeURIComponent(pkg.number)}"><strong>Пакет ${escapeHtml(pkg.number)}</strong> ${escapeHtml(pkg.title)}</a>`
  ).join("");
}

function relatedExplanations(node) {
  const ids = [...new Set(node.related_packages.flatMap((pkg) => pkg.related_document_ids))];
  const docs = ids.map((id) => resolutionState.explanations.find((doc) => doc.id === id)).filter(Boolean).slice(0, 12);
  if (!docs.length) return "<p>Пов'язані роз'яснення не визначено.</p>";
  return docs.map((doc) =>
    `<a class="explanation-law-link" href="../index.html?package=${encodeURIComponent(doc.package)}">${escapeHtml(doc.title)}</a>`
  ).join("");
}

function renderReader() {
  const node = resolutionState.selected;
  const container = byId("resolutionReader");
  if (!node) {
    container.innerHTML = "<p>Оберіть розділ або главу постанови.</p>";
    return;
  }
  const query = queryText();
  const page = node.items.find((item) => item.id === resolutionState.selectedParagraph)?.page || node.page_start;
  const content = node.items.length
    ? `<ol class="law-items">${node.items.map((item) => `<li class="${item.id === resolutionState.selectedParagraph ? "selected" : ""}">${highlight(item.text.replace(/^\d+\.\s*/, ""), query)}</li>`).join("")}</ol>`
    : `<p class="law-text">${highlight(node.text, query)}</p>`;
  container.innerHTML = `
    <h2>${escapeHtml(node.title)}</h2>
    <p class="law-context">Редакція від ${escapeHtml(resolutionState.data.document.edition_date)} · Джерело: постанова КМУ № ${escapeHtml(resolutionState.data.document.number)}</p>
    <div class="norm-summary">
      <div><span>Тип норми</span><strong>${escapeHtml(typeLabels(node).join(", "))}</strong></div>
      <div><span>Сторінки джерела</span><strong>${node.page_start === node.page_end ? node.page_start : `${node.page_start}-${node.page_end}`}</strong></div>
    </div>
    ${content}
    <div class="law-actions">
      <a class="action primary" href="${resolutionState.data.document.source_href}#page=${page}" target="_blank">Відкрити PDF, стор. ${page}</a>
    </div>
    <section class="law-links">
      <h3>Пов'язані пакети</h3>
      ${relatedPackages(node)}
    </section>
    <section class="law-links">
      <h3>Пов'язані роз'яснення</h3>
      ${relatedExplanations(node)}
    </section>`;
  container.querySelector(".law-items li.selected")?.scrollIntoView({ block: "nearest" });
}

async function initResolution() {
  const dataResponse = await fetch("data/resolution_1808.json");
  resolutionState.data = await dataResponse.json();
  resolutionState.nodes = [...resolutionState.data.parts, ...resolutionState.data.chapters, ...resolutionState.data.appendices];
  const params = new URLSearchParams(location.search);
  byId("resolutionSearch").value = params.get("q") || "";
  resolutionState.type = params.get("type") || "";
  resolutionState.packageNumber = params.get("package") || "";
  renderStats();
  renderTypes();
  resolutionState.visible = resolutionState.nodes;
  const initial = resolutionState.nodes.find((node) => node.id === params.get("node")) ||
    (resolutionState.packageNumber && resolutionState.nodes.find((node) => node.package_numbers.includes(resolutionState.packageNumber))) ||
    resolutionState.nodes[0];
  selectNode(initial, params.get("paragraph") || "");
  byId("resolutionSearch").addEventListener("input", applyFilters);
  byId("clearResolution").addEventListener("click", () => {
    byId("resolutionSearch").value = "";
    resolutionState.type = "";
    resolutionState.packageNumber = "";
    applyFilters();
  });
  applyFilters();
  fetch("../data/documents.json")
    .then((response) => response.json())
    .then((payload) => {
      resolutionState.explanations = payload.documents;
      renderReader();
    })
    .catch((error) => console.warn("Не вдалося підвантажити пов'язані роз'яснення.", error));
}

initResolution().catch((error) => {
  console.error("Не вдалося ініціалізувати навігатор постанови.", error);
  byId("resolutionCards").innerHTML = `<div class="no-results">Не вдалося завантажити індекс постанови.<br><small>${escapeHtml(error.message)}</small></div>`;
});
