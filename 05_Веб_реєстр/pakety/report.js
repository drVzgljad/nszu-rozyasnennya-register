const reportState = { data: null, section: "" };
const reportById = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function searchTerms(query) {
  const terms = normalize(query).split(" ").filter((term) => term.length > 1).map((term) =>
    term === "ретген" || term === "ренген" ? "рентген" : term
  );
  const meaningful = terms.filter((term) => !term.startsWith("установ") && !term.startsWith("утанов"));
  return meaningful.length ? meaningful : terms;
}

function matchesSearch(value, terms) {
  const text = normalize(value);
  return terms.every((term) => text.includes(term));
}

function matchingReport(query, tag = "") {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  return reportState.data.packages.filter((pkg) => !tag || pkg.tags.includes(tag)).map((pkg) => {
    const sections = pkg.units.flatMap((unit) => unit.sections.map((section) => {
      if (reportState.section && section.label !== reportState.section) return null;
      const headingMatches = matchesSearch(section.source_heading, terms);
      const itemMatches = section.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => matchesSearch(item, terms));
      if (!headingMatches && !itemMatches.length) return null;
      return { unit, section, headingMatches, itemMatches };
    })).filter(Boolean);
    return sections.length ? { pkg, sections } : null;
  }).filter(Boolean);
}

function sectionLabels() {
  return [...new Set(reportState.data.packages.flatMap((pkg) =>
    pkg.units.flatMap((unit) => unit.sections.map((section) => section.label))
  ))].sort((left, right) => left.localeCompare(right, "uk"));
}

function renderSectionFilter() {
  const container = reportById("reportSectionFilter");
  const labels = sectionLabels();
  container.innerHTML = [
    `<button class="filter-chip ${!reportState.section ? "active" : ""}" data-section="">Усі підрозділи</button>`,
    ...labels.map((label) =>
      `<button class="filter-chip ${reportState.section === label ? "active" : ""}" data-section="${escapeHtml(label)}">${escapeHtml(label)}</button>`
    ),
  ].join("");
  container.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      reportState.section = button.dataset.section;
      renderReport();
      renderSectionFilter();
    });
  });
}

function renderStats(matches) {
  const sectionCount = matches.reduce((total, entry) => total + entry.sections.length, 0);
  const itemCount = matches.reduce((total, entry) =>
    total + entry.sections.reduce((count, section) => count + section.itemMatches.length, 0), 0);
  reportById("reportStats").innerHTML = [
    [matches.length, "пакетів"],
    [sectionCount, reportState.section ? "обраних розділів" : "розділів"],
    [itemCount, "пунктів"],
  ].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function reportCounts(matches) {
  return {
    packages: matches.length,
    sections: matches.reduce((total, entry) => total + entry.sections.length, 0),
    items: matches.reduce((total, entry) =>
      total + entry.sections.reduce((count, section) => count + section.itemMatches.length, 0), 0),
  };
}

function buildSummary(query, matches) {
  if (!query) return "";
  const counts = reportCounts(matches);
  const lines = [
    "Звіт пошуку в пакетах ПМГ 2026",
    `Запит: ${query}`,
    `Підрозділ: ${reportState.section || "усі підрозділи"}`,
    `Знайдено: ${counts.packages} пакетів; ${counts.sections} розділів; ${counts.items} пунктів.`,
    "",
  ];
  matches.forEach(({ pkg, sections }) => {
    lines.push(`Пакет ${pkg.number}. ${pkg.title}`);
    sections.forEach(({ unit, section, headingMatches, itemMatches }) => {
      if (unit.label) lines.push(`  ${unit.label}`);
      lines.push(`  ${section.label}`);
      if (headingMatches && section.source_heading) lines.push(`  Заголовок: ${section.source_heading}`);
      if (itemMatches.length) {
        itemMatches.forEach(({ item, index }) => lines.push(`  ${index + 1}. ${item}`));
      } else {
        lines.push("  Збіг знайдено у назві розділу.");
      }
      lines.push("");
    });
  });
  return lines.join("\n").trim();
}

function renderReport() {
  const query = reportById("reportSearch").value.trim();
  const currentParams = new URLSearchParams(location.search);
  const tag = currentParams.get("tag") || "";
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (tag) params.set("tag", tag);
  if (reportState.section) params.set("section", reportState.section);
  history.replaceState(null, "", `${location.pathname}${query ? `?${params}` : ""}`);
  reportById("backToPackages").href = query ? `index.html?q=${encodeURIComponent(query)}` : "index.html";

  if (!query) {
    renderStats([]);
    reportById("reportSummary").value = "";
    return;
  }

  const matches = matchingReport(query, tag);
  renderStats(matches);
  reportById("reportSummary").value = buildSummary(query, matches);
}

async function copySummary() {
  const summary = reportById("reportSummary").value.trim();
  const button = reportById("copyReportSummary");
  if (!summary) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(summary);
    } else {
      reportById("reportSummary").select();
      document.execCommand("copy");
    }
    button.textContent = "Скопійовано";
    window.setTimeout(() => { button.textContent = "Копіювати зведення"; }, 1300);
  } catch (error) {
    console.warn("Не вдалося скопіювати зведення.", error);
    button.textContent = "Не скопійовано";
    window.setTimeout(() => { button.textContent = "Копіювати зведення"; }, 1300);
  }
}

async function initReport() {
  const response = await fetch("data/packages_2026.json");
  reportState.data = await response.json();
  const params = new URLSearchParams(location.search);
  reportById("reportSearch").value = params.get("q") || "";
  reportState.section = params.get("section") || "";
  renderSectionFilter();
  reportById("buildReport").addEventListener("click", renderReport);
  reportById("copyReportSummary").addEventListener("click", copySummary);
  reportById("reportSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") renderReport();
  });
  renderReport();
}

initReport().catch((error) => {
  console.error("Не вдалося сформувати звіт пошуку.", error);
  reportById("reportSummary").value = `Не вдалося завантажити дані пакетів.\n${error.message}`;
});
