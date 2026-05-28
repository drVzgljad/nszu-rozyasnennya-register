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

function sourceLabel(node) {
  return node.legal_document || "Порядок";
}

function shortParagraphTitle(item) {
  const marker = item.marker || `${item.number}.`;
  const text = String(item.text || "")
    .replace(new RegExp(`^\\s*${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return `Пункт ${marker}`;
  return text.length > 86 ? `${text.slice(0, 86).trim()}...` : text;
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
    [counts.resolution_items, "пункти постанови"],
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
      <span class="card-kind">${escapeHtml(sourceLabel(node))} · ${kindLabel(node)}</span>
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
  const paragraphs = node.items.map((item) => {
    const marker = item.marker || `${item.number}.`;
    const title = shortParagraphTitle(item);
    return `<div class="paragraph-row ${item.id === resolutionState.selectedParagraph ? "active" : ""}">
      <button class="paragraph-link" data-paragraph="${item.id}">
        <span class="paragraph-main"><strong>${escapeHtml(marker)}</strong> ${escapeHtml(title)}</span>
        <span class="paragraph-page">стор. ${item.page}</span>
      </button>
      <button class="copy-fragment" type="button" data-copy-paragraph="${item.id}" title="Копіювати текст пункту" aria-label="Копіювати текст пункту ${escapeHtml(marker)}">⧉</button>
    </div>`;
  }).join("");
  container.innerHTML = `
    <div class="outline-label">${escapeHtml(sourceLabel(node))} · ${kindLabel(node)}</div>
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
  container.querySelectorAll("[data-copy-paragraph]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = node.items.find((entry) => entry.id === button.dataset.copyParagraph);
      if (item) copyFragment(item.text, button);
    });
  });
}

async function copyFragment(text, button) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    button.classList.add("copied");
    button.textContent = "✓";
    window.setTimeout(() => {
      button.classList.remove("copied");
      button.textContent = "⧉";
    }, 1200);
  } catch (error) {
    console.warn("Не вдалося скопіювати фрагмент.", error);
    button.classList.add("copy-error");
    button.textContent = "!";
    window.setTimeout(() => {
      button.classList.remove("copy-error");
      button.textContent = "⧉";
    }, 1200);
  }
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

function splitAppendixTable(text) {
  const codePattern = /\b[A-ZА-ЯІЇЄҐ][0-9]{2}[A-ZА-ЯІЇЄҐ]?(?:-\d{2})?\b/g;
  const headerIndex = text.search(/Діагностично-споріднені групи\s+Назва медичної послуги/i);
  const searchStart = headerIndex >= 0 ? headerIndex : 0;
  const tableText = text.slice(searchStart);
  const firstCode = tableText.search(codePattern);
  if (firstCode < 0) return { intro: text, rows: [] };

  const intro = text.slice(0, searchStart + firstCode).trim();
  const body = tableText.slice(firstCode);
  const matches = [...body.matchAll(codePattern)].filter((match) => /^[A-ZА-ЯІЇЄҐ]\d/.test(match[0]));
  const rows = matches.map((match, index) => {
    const next = matches[index + 1];
    const segment = body.slice(match.index + match[0].length, next ? next.index : body.length).trim();
    const coeffMatch = segment.match(/((?:\d+,\d+)(?:\s+\d+,\d+)*)\s*$/);
    const coeffs = coeffMatch ? coeffMatch[1].split(/\s+/) : [];
    const title = (coeffMatch ? segment.slice(0, coeffMatch.index) : segment).trim();
    return { code: match[0], title, coeffs };
  }).filter((row) => row.title || row.coeffs.length);
  return { intro, rows };
}

function renderAppendixPackages(intro, query) {
  const blocks = intro.split(/(?=Пакет [“"])/).map((part) => part.trim()).filter(Boolean);
  if (blocks.length < 2) return `<p class="appendix-intro">${highlight(intro, query)}</p>`;

  const preamble = blocks[0].startsWith("Пакет ") ? "" : blocks.shift();
  const cards = blocks.map((block) => {
    const [name, ...rest] = block.split(/\s+-\s+/);
    const groups = rest.join(" - ");
    return `<div class="appendix-package-card">
      <strong>${highlight(name, query)}</strong>
      ${groups ? `<span>${highlight(groups, query)}</span>` : ""}
    </div>`;
  }).join("");
  return `
    ${preamble ? `<p class="appendix-intro">${highlight(preamble, query)}</p>` : ""}
    <div class="appendix-package-grid">${cards}</div>
  `;
}

function renderAppendixTable(rows, query) {
  if (!rows.length) return "";
  return `<div class="appendix-table-wrap" role="region" aria-label="Таблиця додатка">
    <table class="appendix-table">
      <thead>
        <tr>
          <th>Код</th>
          <th>Назва медичної послуги</th>
          <th>Коефіцієнти</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `<tr>
          <td><strong>${escapeHtml(row.code)}</strong></td>
          <td>${highlight(row.title, query)}</td>
          <td>${row.coeffs.map((value) => `<span class="coef-pill">${escapeHtml(value)}</span>`).join("")}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

function renderFormulaAppendix(text, query) {
  const formulaMatch = text.match(/розраховується за такою формулою:\s*(.+?),\s*де\s+(.+?)(?:\s+ЗАТВЕРДЖЕНО|$)/i);
  if (!formulaMatch) return `<p class="law-text">${highlight(text, query)}</p>`;

  const before = text.slice(0, formulaMatch.index + "розраховується за такою формулою:".length).trim();
  const formula = formulaMatch[1].trim();
  const definitions = formulaMatch[2].split(/;\s*/).map((part) => part.replace(/\.$/, "").trim()).filter(Boolean);
  const approved = text.match(/ЗАТВЕРДЖЕНО.+$/);
  return `
    <p class="appendix-intro">${highlight(before, query)}</p>
    <div class="formula-box">${highlight(formula, query)}</div>
    <div class="definition-list">
      ${definitions.map((entry) => {
        const parts = entry.split(/\s+-\s+/);
        return `<div class="definition-row">
          <strong>${highlight(parts.shift() || "", query)}</strong>
          <span>${highlight(parts.join(" - "), query)}</span>
        </div>`;
      }).join("")}
    </div>
    ${approved ? `<p class="appendix-approved">${highlight(approved[0], query)}</p>` : ""}
  `;
}

function renderAppendixContent(node, query) {
  if (node.id === "appendix-3") return renderFormulaAppendix(node.text, query);
  const parsed = splitAppendixTable(node.text);
  return `
    <div class="appendix-content">
      ${renderAppendixPackages(parsed.intro, query)}
      ${renderAppendixTable(parsed.rows, query)}
    </div>
  `;
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
  const content = node.kind === "appendix"
    ? renderAppendixContent(node, query)
    : node.items.length
      ? `<div class="law-items">${node.items.map((item) => `<div class="law-item ${item.id === resolutionState.selectedParagraph ? "selected" : ""}">${highlight(item.text, query)}</div>`).join("")}</div>`
      : `<p class="law-text">${highlight(node.text, query)}</p>`;
  container.innerHTML = `
    <h2>${escapeHtml(node.title)}</h2>
    <p class="law-context">${escapeHtml(sourceLabel(node))} · редакція від ${escapeHtml(resolutionState.data.document.edition_date)} · постанова КМУ № ${escapeHtml(resolutionState.data.document.number)}</p>
    <div class="norm-summary">
      <div><span>Тип норми</span><strong>${escapeHtml(typeLabels(node).join(", "))}</strong></div>
      <div><span>Сторінки джерела</span><strong>${node.page_start === node.page_end ? node.page_start : `${node.page_start}-${node.page_end}`}</strong></div>
    </div>
    ${content}
    <div class="law-actions">
      <a class="action primary" href="${resolutionState.data.document.source_href}#page=${page}" target="_blank">Відкрити PDF, стор. ${page}</a>
      <a class="action" href="${resolutionState.data.document.source_html_href}" target="_blank">Відкрити офіційний HTM</a>
    </div>
    <section class="law-links">
      <h3>Пов'язані пакети</h3>
      ${relatedPackages(node)}
    </section>
    <section class="law-links">
      <h3>Пов'язані роз'яснення</h3>
      ${relatedExplanations(node)}
    </section>`;
  container.querySelector(".law-item.selected")?.scrollIntoView({ block: "nearest" });
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
