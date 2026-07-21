const resolutionState = {
  data: null,
  explanations: [],
  nodes: [],
  visible: [],
  selected: null,
  selectedParagraph: "",
  type: "",
  packageNumber: "",
  amendments: [],
  amendItemMap: {},
  amendNodeSet: null,
  amendOnly: false,
};
resolutionState.amendNodeSet = new Set();

const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlight(value, query) {
  const escaped = escapeHtml(value);
  if (!query) return escaped;
  const terms = [query, ...searchTerms(query)].filter(Boolean);
  const safe = [...new Set(terms)]
    .sort((left, right) => right.length - left.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!safe) return escaped;
  return escaped.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
}

function queryText() {
  return byId("resolutionSearch").value.trim();
}

const codeLookalikes = {
  а: "a", в: "b", с: "c", е: "e", н: "h", і: "i", ї: "i", к: "k",
  м: "m", о: "o", р: "p", т: "t", х: "x", у: "y",
};

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[авсеніїкмортху]/g, (char) => codeLookalikes[char] || char)
    .replace(/(\d)\.(\d)/g, "$1,$2")
    .replace(/[’ʼ`´]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[^a-z0-9а-яіїєґ'’,-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTerms(query) {
  return normalizeSearch(query).split(" ").filter(Boolean);
}

function matchesQuery(value, query) {
  const terms = searchTerms(query);
  if (!terms.length) return true;
  const index = normalizeSearch(value);
  return terms.every((term) => index.includes(term));
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
  return normalizeSearch([
    node.title,
    node.text,
    sourceLabel(node),
    kindLabel(node),
    ...typeLabels(node),
    ...node.package_numbers,
    ...node.items.map((item) => item.text),
    ...node.related_packages.map((pkg) => pkg.title),
  ].join(" "));
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

// ── Підсвічування змін (накладка data/amendment_highlights.json) ──
const AMEND_ACTION_LABELS = {
  replace: "Замінено",
  insert: "Доповнено",
  "new-edition": "Нова редакція",
  add: "Додано",
  remove: "Виключено",
};

function amendChangesFor(itemId) {
  return resolutionState.amendItemMap[itemId] || [];
}

function amendStatusLabel(amendment) {
  return amendment.status === "effective"
    ? `чинна з ${amendment.effective_date || amendment.date}`
    : "очікує опублікування";
}

function renderAmendBanner() {
  const section = byId("amendHighlightSection");
  if (!section) return;
  if (!resolutionState.amendments.length) {
    section.style.display = "none";
    return;
  }
  const amendment = resolutionState.amendments[0];
  const itemCount = Object.keys(resolutionState.amendItemMap).length;
  section.innerHTML = `
    <div class="amend-banner">
      <span>🖍️</span>
      <strong>Зміни: постанова КМУ від ${escapeHtml(amendment.date)} № ${escapeHtml(amendment.number)}</strong>
      <span class="amend-status">${escapeHtml(amendStatusLabel(amendment))}</span>
      <span class="amend-count">зачеплено пунктів: ${itemCount}</span>
      <span class="amend-legend">
        <span class="amend-ins">нове / доповнено</span>
        <span class="amend-del">виключено / замінено</span>
      </span>
      <button type="button" class="amend-filter-btn ${resolutionState.amendOnly ? "active" : ""}" id="amendFilterBtn">
        ${resolutionState.amendOnly ? "Показати всі розділи" : "Лише змінені розділи"}
      </button>
    </div>
    ${amendment.status_note ? `<div class="amend-note">${escapeHtml(amendment.status_note)}</div>` : ""}`;
  section.style.display = "block";
  byId("amendFilterBtn").addEventListener("click", () => {
    resolutionState.amendOnly = !resolutionState.amendOnly;
    renderAmendBanner();
    applyFilters();
  });
}

function amendInlineMarkup(html, changes) {
  for (const change of changes) {
    if (change.was && change.was.length >= 12) {
      const fragment = escapeHtml(change.was);
      if (html.includes(fragment)) html = html.replace(fragment, `<del class="amend-del">${fragment}</del>`);
    }
    if (change.now && change.now.length >= 12) {
      const fragment = escapeHtml(change.now);
      if (html.includes(fragment)) html = html.replace(fragment, `<ins class="amend-ins">${fragment}</ins>`);
    }
  }
  return html;
}

function renderAmendDetails(changes) {
  const amendment = changes[0]._amend;
  const blocks = changes.map((change) => `
    <div class="amend-change">
      <span class="amend-action ${escapeHtml(change.action)}">${AMEND_ACTION_LABELS[change.action] || change.action}</span>
      <span class="amend-target">${escapeHtml(change.target || "")}</span>
      <div class="amend-summary">${escapeHtml(change.summary || "")}</div>
      ${change.was ? `<div class="amend-was"><del>${escapeHtml(change.was)}</del></div>` : ""}
      ${change.now ? `<div class="amend-now"><ins>${escapeHtml(change.now)}</ins></div>` : ""}
    </div>`).join("");
  return `
    <div class="amend-flag">🖍️ Зміна: постанова № ${escapeHtml(amendment.number)} від ${escapeHtml(amendment.date)}
      <span class="amend-status">${escapeHtml(amendStatusLabel(amendment))}</span>
    </div>
    <div class="amend-details">${blocks}</div>`;
}

function renderLawItem(item, query) {
  const selectedClass = item.id === resolutionState.selectedParagraph ? " selected" : "";
  const changes = amendChangesFor(item.id);
  let html = highlight(item.text, query);
  if (!changes.length) return `<div class="law-item${selectedClass}">${html}</div>`;
  if (!query) html = amendInlineMarkup(html, changes);
  return `<div class="law-item amended${selectedClass}">${html}${renderAmendDetails(changes)}</div>`;
}

async function loadAmendHighlights() {
  try {
    const response = await fetch("data/amendment_highlights.json");
    if (!response.ok) return;
    const payload = await response.json();
    resolutionState.amendments = payload.amendments || [];
    for (const amendment of resolutionState.amendments) {
      for (const change of amendment.changes || []) {
        change._amend = amendment;
        (resolutionState.amendItemMap[change.item] = resolutionState.amendItemMap[change.item] || []).push(change);
        resolutionState.amendNodeSet.add(change.node);
      }
    }
  } catch (error) {
    console.warn("Не вдалося завантажити накладку змін.", error);
  }
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
  if (node.kind === "appendix") return firstMatchedAppendixRow(node, query)?.id || "";
  return node.items.find((item) => matchesQuery(item.text, query))?.id || "";
}

function appendixRows(node) {
  if (!node || node.kind !== "appendix" || node.id === "appendix-3") return [];
  if (!node._appendixRows) node._appendixRows = splitAppendixTable(node.text).rows.map((row, index) => ({
    ...row,
    id: `${node.id}-row-${index + 1}`,
    searchText: [row.code, row.title, ...row.coeffs].join(" "),
  }));
  return node._appendixRows;
}

function firstMatchedAppendixRow(node, query) {
  if (!query) return null;
  return appendixRows(node).find((row) => matchesQuery(row.searchText, query)) || null;
}

function applyFilters() {
  const query = queryText();
  resolutionState.visible = resolutionState.nodes.filter((node) =>
    (!query || searchTerms(query).every((term) => searchableText(node).includes(term))) &&
    (!resolutionState.type || node.types.includes(resolutionState.type)) &&
    (!resolutionState.packageNumber || node.package_numbers.includes(resolutionState.packageNumber)) &&
    (!resolutionState.amendOnly || resolutionState.amendNodeSet.has(node.id))
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
    const amendBadge = resolutionState.amendNodeSet.has(node.id)
      ? '<span class="amend-badge">🖍 зміни № 948</span>'
      : "";
    return `<button class="resolution-card ${node.id === resolutionState.selected?.id ? "active" : ""}" data-node="${node.id}">
      <span class="card-kind">${escapeHtml(sourceLabel(node))} · ${kindLabel(node)}${amendBadge}</span>
      <strong>${escapeHtml(node.title)}</strong>
      <small>${escapeHtml(context + match)}</small>
    </button>`;
  }).join("") || '<div class="no-results">За цим запитом норм не знайдено.</div>';
  byId("resolutionCards").querySelectorAll("[data-node]").forEach((button) => {
    button.addEventListener("click", () => {
      selectNode(resolutionState.nodes.find((node) => node.id === button.dataset.node));
      if (window.innerWidth <= 840) {
        byId("resolutionOutline").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
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
  if (node.kind === "appendix") {
    renderAppendixOutline(node, container, pages);
    return;
  }
  const paragraphs = node.items.map((item) => {
    const marker = item.marker || `${item.number}.`;
    const title = shortParagraphTitle(item);
    const amendDot = amendChangesFor(item.id).length
      ? '<span class="amend-dot" title="Пункт зачеплено змінами № 948"></span>'
      : "";
    return `<div class="paragraph-row ${item.id === resolutionState.selectedParagraph ? "active" : ""}">
      <button class="paragraph-link" data-paragraph="${item.id}">
        <span class="paragraph-main"><strong>${escapeHtml(marker)}</strong> ${escapeHtml(title)}${amendDot}</span>
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
      if (window.innerWidth <= 840) {
        byId("resolutionReader").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
  container.querySelectorAll("[data-copy-paragraph]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = node.items.find((entry) => entry.id === button.dataset.copyParagraph);
      if (item) copyFragment(item.text, button);
    });
  });
}

function renderAppendixOutline(node, container, pages) {
  const query = queryText();
  const rows = appendixRows(node);
  const matchedRows = query ? rows.filter((row) => matchesQuery(row.searchText, query)) : rows;
  const rowLimit = query ? 80 : 60;
  const rowHtml = matchedRows.slice(0, rowLimit).map((row) => `
    <div class="paragraph-row appendix-outline-row ${row.id === resolutionState.selectedParagraph ? "active" : ""}">
      <button class="paragraph-link" data-appendix-row="${row.id}">
        <span class="paragraph-main">
          <strong>${highlight(row.code, query)}</strong>
          ${highlight(row.title, query)}
          <span class="appendix-outline-coefs">${row.coeffs.map((value) => highlight(value, query)).join(" · ")}</span>
        </span>
      </button>
      <button class="copy-fragment" type="button" data-copy-appendix-row="${row.id}" title="Копіювати рядок додатка" aria-label="Копіювати рядок додатка ${escapeHtml(row.code)}">⧉</button>
    </div>
  `).join("");
  const appendixNote = rows.length
    ? `<p class="source-pages">${query ? `Знайдено рядків: ${matchedRows.length} з ${rows.length}` : `Рядків у таблиці: ${rows.length}`}. ${pages}</p>`
    : `<p class="source-pages">${pages}</p>`;
  container.innerHTML = `
    <div class="outline-label">${escapeHtml(sourceLabel(node))} · ${kindLabel(node)}</div>
    <h2>${escapeHtml(node.title)}</h2>
    ${appendixNote}
    <div class="norm-tags">${typeLabels(node).map((label) => `<span class="norm-tag">${escapeHtml(label)}</span>`).join("")}</div>
    ${rowHtml || "<p>У цьому додатку немає табличних рядків для навігації.</p>"}
    ${matchedRows.length > rowLimit ? `<p class="source-pages">Показано перші ${rowLimit} рядків. Уточніть пошук, щоб звузити перелік.</p>` : ""}
  `;
  container.querySelectorAll("[data-appendix-row]").forEach((button) => {
    button.addEventListener("click", () => {
      resolutionState.selectedParagraph = button.dataset.appendixRow;
      renderOutline();
      renderReader();
      updateUrl();
      if (window.innerWidth <= 840) {
        byId("resolutionReader").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
  container.querySelectorAll("[data-copy-appendix-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = rows.find((entry) => entry.id === button.dataset.copyAppendixRow);
      if (row) copyFragment([row.code, row.title, ...row.coeffs].filter(Boolean).join(" | "), button);
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

function appendixColumns(nodeId) {
  if (nodeId === "appendix-1") {
    return [
      "Ваговий коефіцієнт",
      "Додатковий коефіцієнт за допомогу дітям",
      "Додатковий коефіцієнт за лікування травм",
    ];
  }
  if (nodeId === "appendix-2") {
    return [
      "Ваговий коефіцієнт за ДСГ",
      "Додатковий коефіцієнт за допомогу дітям",
    ];
  }
  return ["Коефіцієнти"];
}

function renderCoeffCell(value, query) {
  return value ? `<span class="coef-value">${highlight(value, query)}</span>` : '<span class="coef-empty">—</span>';
}

function renderAppendixTable(nodeId, rows, query, selectedRowId = "") {
  if (!rows.length) return "";
  const columns = appendixColumns(nodeId);
  return `<div class="appendix-table-wrap" role="region" aria-label="Таблиця додатка">
    <table class="appendix-table">
      <thead>
        <tr>
          <th>Код</th>
          <th>Назва медичної послуги</th>
          ${columns.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows.map((row, index) => {
          const rowId = row.id || `${nodeId}-row-${index + 1}`;
          return `<tr id="${escapeHtml(rowId)}" class="${rowId === selectedRowId ? "selected" : ""}">
          <td><strong>${escapeHtml(row.code)}</strong></td>
          <td>${highlight(row.title, query)}</td>
          ${columns.map((_, index) => `<td class="coef-cell">${renderCoeffCell(row.coeffs[index], query)}</td>`).join("")}
        </tr>`;
        }).join("")}
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
  const rows = appendixRows(node).length ? appendixRows(node) : parsed.rows;
  return `
    <div class="appendix-content">
      ${renderAppendixPackages(parsed.intro, query)}
      ${renderAppendixTable(node.id, rows, query, resolutionState.selectedParagraph)}
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
      ? `<div class="law-items">${node.items.map((item) => renderLawItem(item, query)).join("")}</div>`
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
  await loadAmendHighlights();
  renderAmendBanner();
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
