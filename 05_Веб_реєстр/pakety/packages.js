const packageState = {
  data: null,
  explanations: [],
  resolution: null,
  visible: [],
  selected: null,
  selectedUnit: null,
  selectedSection: null,
  tag: "",
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
  return byId("packageSearch").value.trim().toLowerCase();
}

function itemText(item) {
  return typeof item === "string" ? item : item?.text || "";
}

function itemMarker(item) {
  return typeof item === "string" ? "" : item?.marker || "";
}

function itemLevel(item) {
  return typeof item === "string" ? 0 : Number(item?.level || 0);
}

function itemSearchText(item) {
  return `${itemMarker(item)} ${itemText(item)}`.trim();
}

function renderRequirementItem(item, query) {
  const marker = itemMarker(item);
  const level = Math.min(itemLevel(item), 5);
  return `<div class="requirement-item level-${level}">
    <span class="requirement-marker">${escapeHtml(marker)}</span>
    <span class="requirement-text">${highlight(itemText(item), query)}</span>
  </div>`;
}

function allSections(pkg) {
  return pkg.units.flatMap((unit) => unit.sections.map((section) => ({ unit, section })));
}

function firstMatch(pkg, query) {
  if (!query) return allSections(pkg)[0];
  return allSections(pkg).find(({ section }) =>
    `${section.source_heading} ${section.items.map(itemSearchText).join(" ")}`.toLowerCase().includes(query)
  ) || allSections(pkg)[0];
}

function updateUrl() {
  const params = new URLSearchParams();
  if (packageState.selected) params.set("package", packageState.selected.number);
  if (packageState.selectedSection) params.set("section", packageState.selectedSection.key);
  if (packageState.selectedUnit && packageState.selected.units.length > 1) params.set("unit", packageState.selectedUnit.id);
  const query = queryText();
  if (query) params.set("q", query);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  updateReportLink(query);
}

function updateReportLink(query = queryText()) {
  const link = byId("packageReportLink");
  if (!link) return;
  if (!query) {
    link.href = "report.html";
    return;
  }
  const params = new URLSearchParams({ q: query });
  if (packageState.tag) params.set("tag", packageState.tag);
  link.href = `report.html?${params}`;
}

function renderStats() {
  const sectionCount = packageState.data.packages.reduce((total, pkg) =>
    total + pkg.units.reduce((count, unit) => count + unit.sections.length, 0), 0);
  byId("packageStats").innerHTML = [
    [packageState.data.package_count, "пакетів"],
    [sectionCount, "розділів"],
    ["2026", "рік ПМГ"],
  ].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderTags() {
  const tags = [...new Set(packageState.data.packages.flatMap((pkg) => pkg.tags))];
  byId("tagFilters").innerHTML = tags.map((tag) =>
    `<button class="filter-chip ${packageState.tag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  ).join("");
  byId("tagFilters").querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      packageState.tag = packageState.tag === button.dataset.tag ? "" : button.dataset.tag;
      applyPackageFilters();
    });
  });
}

function applyPackageFilters() {
  const query = queryText();
  packageState.visible = packageState.data.packages.filter((pkg) =>
    (!query || pkg.search_text.includes(query)) &&
    (!packageState.tag || pkg.tags.includes(packageState.tag))
  );
  byId("packageCount").textContent = `Знайдено: ${packageState.visible.length} з ${packageState.data.package_count}`;
  if (!packageState.visible.some((pkg) => pkg.number === packageState.selected?.number)) {
    selectPackage(packageState.visible[0] || null);
  } else if (query) {
    const match = firstMatch(packageState.selected, query);
    packageState.selectedUnit = match.unit;
    packageState.selectedSection = match.section;
  }
  renderTags();
  renderCards();
  renderOutline();
  renderReader();
  updateUrl();
}

function renderCards() {
  const query = queryText();
  byId("packageCards").innerHTML = packageState.visible.map((pkg) => {
    const match = firstMatch(pkg, query);
    const matchLabel = query && match ? `<span class="match-label">Збіг: ${escapeHtml(match.section.label)}</span>` : "";
    return `<button class="package-card ${pkg.number === packageState.selected?.number ? "active" : ""}" data-package="${pkg.number}">
      <span class="package-number">${pkg.number}</span>
      <span><strong>${escapeHtml(pkg.title)}</strong>${matchLabel}</span>
    </button>`;
  }).join("") || '<div class="no-results">За цим запитом пакетів не знайдено.</div>';
  byId("packageCards").querySelectorAll("[data-package]").forEach((card) => {
    card.addEventListener("click", () => selectPackage(packageState.data.packages.find((pkg) => pkg.number === card.dataset.package)));
  });
}

function selectPackage(pkg, sectionKey = "", unitId = "") {
  packageState.selected = pkg;
  if (!pkg) {
    packageState.selectedUnit = null;
    packageState.selectedSection = null;
  } else {
    const match = firstMatch(pkg, queryText());
    packageState.selectedUnit = pkg.units.find((unit) => unit.id === unitId) || match.unit;
    packageState.selectedSection = packageState.selectedUnit.sections.find((section) => section.key === sectionKey) || match.section;
  }
  renderCards();
  renderOutline();
  renderReader();
  updateUrl();
}

function renderOutline() {
  const container = byId("packageOutline");
  const pkg = packageState.selected;
  if (!pkg) {
    container.innerHTML = '<div class="empty-state"><h2>Пакет не обрано</h2><p>Уточніть пошук або очистіть фільтр.</p></div>';
    return;
  }
  const units = pkg.units.map((unit) => `
    ${pkg.units.length > 1 ? `<div class="unit-heading">${escapeHtml(unit.label)}</div>` : ""}
    ${unit.sections.map((section) =>
      `<button class="outline-link ${section === packageState.selectedSection && unit === packageState.selectedUnit ? "active" : ""}"
        data-unit="${unit.id}" data-section="${section.key}">${escapeHtml(section.label)} <span>${Math.max(section.items.length, 1)}</span></button>`
    ).join("")}
  `).join("");
  container.innerHTML = `
    <div class="outline-number">ПАКЕТ ${escapeHtml(pkg.number)}</div>
    <h2>${escapeHtml(pkg.title)}</h2>
    <div class="tag-row">${pkg.tags.map((tag) => `<span class="package-tag">${escapeHtml(tag)}</span>`).join("")}</div>
    ${units}`;
  container.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      packageState.selectedUnit = pkg.units.find((unit) => unit.id === button.dataset.unit);
      packageState.selectedSection = packageState.selectedUnit.sections.find((section) => section.key === button.dataset.section);
      renderOutline();
      renderReader();
      updateUrl();
    });
  });
  container.querySelector(".outline-link.active")?.scrollIntoView({ block: "nearest" });
}

function readerRelated(pkg) {
  const related = pkg.related_document_ids.map((id) => packageState.explanations.find((doc) => doc.id === id)).filter(Boolean);
  if (!related.length) return "<p>Пов'язані роз'яснення не визначено.</p>";
  return related.map((doc) =>
    `<a class="related-link" href="../index.html?package=${encodeURIComponent(doc.package)}">${escapeHtml(doc.title)}</a>`
  ).join("");
}

function readerResolution(pkg) {
  if (!packageState.resolution) return "<p>Завантажуємо тарифні норми постанови...</p>";
  const links = packageState.resolution?.package_links?.[pkg.number] || [];
  if (!links.length) return "<p>Тарифні норми для цього пакета не визначено.</p>";
  return links.map((link) => {
    const labels = link.types.slice(0, 3).map((type) => packageState.resolution.type_labels[type] || type).join(", ");
    return `<a class="law-related-link" href="../postanova/index.html?node=${encodeURIComponent(link.id)}&package=${encodeURIComponent(pkg.number)}">
      <strong>${escapeHtml(link.title)}</strong><span>${escapeHtml(labels)} · стор. ${link.page}</span>
    </a>`;
  }).join("");
}

function renderReader() {
  const container = byId("packageReader");
  const pkg = packageState.selected;
  const section = packageState.selectedSection;
  if (!pkg || !section) {
    container.classList.add("reader-empty");
    container.innerHTML = "<p>Оберіть пакет, щоб переглянути його вимоги.</p>";
    return;
  }
  container.classList.remove("reader-empty");
  const query = queryText();
  const context = pkg.units.length > 1 ? packageState.selectedUnit.label : `Пакет ${pkg.number}`;
  const items = section.items.length
    ? `<div class="requirement-list">${section.items.map((item) => renderRequirementItem(item, query)).join("")}</div>`
    : "<p>Окремі пункти у цьому розділі не виділено.</p>";
  container.innerHTML = `
    <h2>${escapeHtml(section.label)}</h2>
    <p class="reader-context">${escapeHtml(context)}</p>
    ${section.source_heading ? `<div class="source-heading">${highlight(section.source_heading, query)}</div>` : ""}
    ${items}
    <div class="package-actions">
      <a class="action primary" href="${encodeURI(pkg.source_href)}" target="_blank">Відкрити оригінал DOCX</a>
      <a class="action" href="../index.html?package=${encodeURIComponent((pkg.related_document_ids.length && packageState.explanations.find((doc) => doc.id === pkg.related_document_ids[0])?.package) || "")}">До реєстру роз'яснень</a>
    </div>
    <section class="related-explanations resolution-connections">
      <h3>Оплата за постановою № 1808</h3>
      ${readerResolution(pkg)}
    </section>
    <section class="related-explanations">
      <h3>Пов'язані роз'яснення</h3>
      ${readerRelated(pkg)}
    </section>`;
}

async function initPackages() {
  const [packagesResponse, docsResponse] = await Promise.all([
    fetch("data/packages_2026.json"),
    fetch("../data/documents.json"),
  ]);
  packageState.data = await packagesResponse.json();
  packageState.explanations = (await docsResponse.json()).documents;
  const params = new URLSearchParams(location.search);
  byId("packageSearch").value = params.get("q") || "";
  renderStats();
  renderTags();
  packageState.visible = packageState.data.packages;
  const initial = packageState.data.packages.find((pkg) => pkg.number === params.get("package")) || packageState.data.packages[0];
  selectPackage(initial, params.get("section") || "", params.get("unit") || "");
  byId("packageSearch").addEventListener("input", applyPackageFilters);
  byId("clearPackages").addEventListener("click", () => {
    byId("packageSearch").value = "";
    packageState.tag = "";
    applyPackageFilters();
  });
  applyPackageFilters();
  fetch("../postanova/data/resolution_1808.json")
    .then((response) => response.json())
    .then((payload) => {
      packageState.resolution = payload;
      renderReader();
    })
    .catch((error) => console.warn("Не вдалося підвантажити норми постанови.", error));
}

initPackages().catch(() => {
  byId("packageCards").innerHTML = '<div class="no-results">Не вдалося завантажити індекс пакетів.</div>';
});
