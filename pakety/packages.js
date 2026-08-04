const packageState = {
  data: null,
  explanations: [],
  resolution: null,
  decDocuments: [],
  decLinks: {},
  visible: [],
  selected: null,
  selectedUnit: null,
  selectedSection: null,
  tag: "",
};

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

function renderRequirementItem(item, query, linkPkg) {
  const marker = itemMarker(item);
  const level = Math.min(itemLevel(item), 5);
  const text = itemText(item);
  // Підсвітку пошуку віддаємо як форматер: інакше <mark> ліг би всередину
  // href і посилання на паспорт посади розсипалося б.
  const body = linkPkg
    ? window.SpecLinks.render(text, linkPkg, (chunk) => highlight(chunk, query))
    : highlight(text, query);
  return `<div class="requirement-item level-${level}">
    <span class="requirement-marker">${escapeHtml(marker)}</span>
    <span class="requirement-text">${body}</span>
  </div>`;
}

// Номер пакета для лінкування назв посад — або "" , якщо лінкувати нічого.
// Пілоти нумеруються власним рядом НСЗУ, який перетинається з нумерацією
// постанови 1808, тож карту вимог до них не прикладаємо.
function staffLinkPkg(pkg, section) {
  if (!pkg || pkg.pilot || !section || section.key !== "specialists") return "";
  return window.SpecLinks && window.SpecLinks.has(pkg.number) ? pkg.number : "";
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

const pkgKey = (pkg) => (pkg ? pkg.key || pkg.number : "");

function updateUrl() {
  const params = new URLSearchParams();
  if (packageState.selected) params.set("package", pkgKey(packageState.selected));
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
    [packageState.data.package_count, "пакетів ПМГ"],
    ...(packageState.pilotCount ? [[packageState.pilotCount, "пілотних проєктів"]] : []),
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
  byId("packageCount").textContent = `Знайдено: ${packageState.visible.length} з ${packageState.data.packages.length}`;
  if (!packageState.visible.some((pkg) => pkgKey(pkg) === pkgKey(packageState.selected))) {
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
    return `<button class="package-card ${pkgKey(pkg) === pkgKey(packageState.selected) ? "active" : ""}${pkg.pilot ? " pilot-card" : ""}" data-package="${pkgKey(pkg)}"${pkg.pilot ? ' data-pilot="1"' : ""}>
      <span class="package-number${pkg.pilot ? " pilot-number" : ""}">${pkg.number}</span>
      <span><strong>${escapeHtml(pkg.title)}</strong>${pkg.pilot ? '<span class="pilot-flag">🧪 пілотний проєкт · поза постановою 1808</span>' : ""}${matchLabel}</span>
    </button>`;
  }).join("") || '<div class="no-results">За цим запитом пакетів не знайдено.</div>';
  byId("packageCards").querySelectorAll("[data-package]").forEach((card) => {
    card.addEventListener("click", () => {
      selectPackage(packageState.data.packages.find((pkg) => pkgKey(pkg) === card.dataset.package));
      if (window.innerWidth <= 820) {
        byId("packageOutline").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
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
      if (window.innerWidth <= 820) {
        byId("packageReader").scrollIntoView({ behavior: "smooth", block: "start" });
      }
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

function getLinkedCategoriesForPackage(pkgNum) {
  const pkgLinks = packageState.decLinks[pkgNum] || [];
  if (Array.isArray(pkgLinks)) {
    return pkgLinks;
  }
  return Object.keys(pkgLinks);
}

function readerDec(pkg) {
  if (!packageState.decDocuments || !packageState.decDocuments.length) {
    return "<p>Завантажуємо стандарти ДЕЦ...</p>";
  }
  const linkedCategories = getLinkedCategoriesForPackage(pkg.number);
  if (!linkedCategories.length) {
    return "<p>Клінічні стандарти для цього пакета не визначено.</p>";
  }
  const pkgLinks = packageState.decLinks[pkg.number] || {};
  const relatedDocs = packageState.decDocuments.filter(doc => linkedCategories.includes(doc.category));
  if (!relatedDocs.length) {
    return "<p>У пов'язаних категоріях ДЕЦ немає зареєстрованих документів.</p>";
  }
  return relatedDocs.map((doc) => {
    let statusClass = "law-related-badge";
    const statusLower = doc.status.toLowerCase();
    if (statusLower.startsWith("чинн")) {
      statusClass = "law-related-badge active-badge";
    }
    
    let stage = "";
    let note = "";
    if (!Array.isArray(pkgLinks) && pkgLinks[doc.category]) {
      stage = pkgLinks[doc.category].stage || "";
      note = pkgLinks[doc.category].note || "";
    }
    
    const stageInfo = stage ? `<span style="font-size: 11px; margin-left: 6px; padding: 2px 6px; background: rgba(74, 143, 199, 0.12); color: var(--accent-dark, #2f6b9e); border-radius: 4px; font-weight: 700;">${escapeHtml(stage)}</span>` : "";
    const noteHtml = note ? `<span style="font-size: 12px; color: #0284c7; margin-top: 4px; display: block; font-weight: 600;">💡 Коментар: ${escapeHtml(note)}</span>` : "";

    return `<a class="law-related-link" href="../dec/index.html?q=${encodeURIComponent(doc.title)}" target="_blank">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
          <strong>${escapeHtml(doc.title)}</strong>
          ${stageInfo}
        </div>
        <span class="${statusClass}" style="font-size:11px; padding:2px 6px; border-radius:6px; font-weight:700; background:var(--accent-soft); color:var(--accent-dark);">${escapeHtml(doc.status)}</span>
      </div>
      <span style="font-size: 12px; color: var(--muted); margin-top: 4px; display: block;">Категорія: ${escapeHtml(doc.category)} · ${escapeHtml(doc.type)} ${doc.number ? '· ' + escapeHtml(doc.number) : ''}</span>
      ${noteHtml}
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
  const linkPkg = staffLinkPkg(pkg, section);
  const items = section.items.length
    ? `<div class="requirement-list">${section.items.map((item) => renderRequirementItem(item, query, linkPkg)).join("")}</div>`
    : "<p>Окремі пункти у цьому розділі не виділено.</p>";
  // Пілотні проєкти живуть поза постановою 1808: у них немає ні DOCX,
  // ні норм оплати 1808, ні прив'язки до ДЕЦ — показуємо їхню нормативку
  if (pkg.pilot) {
    const meta = pkg.pilot_meta || {};
    const acts = (meta.normative || []).map((n) =>
      `<a class="law-related-link" href="${escapeHtml(n.url)}" target="_blank" rel="noopener">
        <strong>${escapeHtml(n.act)} № ${escapeHtml(n.num)} від ${escapeHtml(n.date)}</strong>
        <span>${escapeHtml(n.role)} · ${escapeHtml(n.title)}</span>
      </a>`).join("") || "<p>Нормативні акти не визначено.</p>";
    container.innerHTML = `
      <h2>${escapeHtml(section.label)}</h2>
      <p class="reader-context">Пілотний проєкт ${escapeHtml(pkg.number)} · ${escapeHtml(meta.status_label || "")}</p>
      ${section.source_heading ? `<div class="source-heading">${highlight(section.source_heading, query)}</div>` : ""}
      ${items}
      <div class="package-actions">
        <a class="action primary" href="../pilots/index.html?p=${encodeURIComponent(pkg.number)}">Повний паспорт проєкту</a>
        <a class="action" href="../cabinet/rozpodil.html#all">Хто відповідає за напрям</a>
      </div>
      <section class="related-explanations resolution-connections">
        <h3>Нормативна база проєкту</h3>
        ${acts}
      </section>`;
    return;
  }

  container.innerHTML = `
    <h2>${escapeHtml(section.label)}</h2>
    <p class="reader-context">${escapeHtml(context)}</p>
    ${section.source_heading ? `<div class="source-heading">${highlight(section.source_heading, query)}</div>` : ""}
    ${items}
    <div class="package-actions">
      <a class="action primary" href="${encodeURI(pkg.source_href)}" target="_blank">Відкрити оригінал DOCX</a>
      <a class="action" href="../index.html?package=${encodeURIComponent((pkg.related_document_ids.length && packageState.explanations.find((doc) => doc.id === pkg.related_document_ids[0])?.package) || "")}">До реєстру роз'яснень</a>
      <a class="action" href="../algorithms/index.html?package=${encodeURIComponent(pkg.number)}">Правила Наказу 377</a>
    </div>
    <section class="related-explanations resolution-connections">
      <h3>Оплата за постановою № 1808</h3>
      ${readerResolution(pkg)}
    </section>
    <section class="related-explanations dec-connections" style="border-top-color: #d7e4ef;">
      <h3>Клінічні стандарти та настанови ДЕЦ МОЗ</h3>
      ${readerDec(pkg)}
    </section>
    <section class="related-explanations">
      <h3>Пов'язані роз'яснення</h3>
      ${readerRelated(pkg)}
    </section>`;
}

// ── Пілотні проєкти як пакети навігатора ───────────────────────
// Пілоти не мають docx-специфікацій (вони поза постановою 1808), тож
// збираємо для них ті самі розділи з pilots/data/pilots_2026.json.
function pilotToPackage(p) {
  const sec = (key, label, heading, items) => ({
    key, label, source_heading: heading,
    items: (items || []).filter(Boolean).map((text) => ({ text, marker: "•", level: 0 })),
  });

  const pay = p.payment || {};
  const pr = p.provider || {};
  const payItems = [
    pay.model,
    pay.base_rate ? `Базова ставка: ${pay.base_rate}` : "",
    pay.cap,
    ...(pay.rates || []).map((r) => `${r.code && r.code !== "—" ? r.code + " — " : ""}${r.label}: ${r.value}`),
    pay.planning,
    ...(pay.rules || []),
  ];

  const sections = [
    sec("specification", "Що входить у пакет (специфікація)", "Зміст послуги за Порядком, затвердженим постановою КМУ", p.content),
    sec("conditions", "Умови надання", p.status_label || "", [p.status_note, p.budget_program, p.history]),
    sec("grounds", "Підстави надання", "Документи та порядок звернення", p.grounds),
    sec("organization", "Вимоги до організації надання послуг", "Хто може бути надавачем", [pr.who, ...(pr.requirements || [])]),
    sec("specialists", "Вимоги до спеціалістів", "", pr.staff),
    sec("equipment", "Обладнання", "", [...(pr.premises || []), ...(pr.equipment || [])]),
    sec("other", "Оплата і тарифи", pay.model || "", payItems.filter((x) => x && x !== pay.model)),
  ].filter((s) => s.items.length || s.source_heading);

  const blob = [p.number, p.title, p.short_title, p.official_name, p.status_label,
    ...(p.categories || []), ...(p.content || []), ...(p.grounds || []),
    ...(p.normative || []).map((n) => `${n.act} ${n.num} ${n.date} ${n.title}`),
    ...payItems].join(" ").toLowerCase();

  return {
    number: p.number,
    // Нумерація пілотів — внутрішня (НСЗУ/ЕСОЗ) і живе окремо від нумерації
    // постанови 1808, тому в навігаторі кожен пілот адресується власним ключем
    key: `p${p.number}`,
    title: p.title,
    pilot: true,
    pilot_meta: p,
    tags: ["🧪 Пілотний проєкт", p.status === "active" ? "Діє у 2026" : "Не діє у 2026"],
    units: [{ id: "unit-1", label: "", sections: [
      sec("categories", "Кому надається", "Категорії осіб, які мають право на послугу", p.categories),
      ...sections,
    ] }],
    related_document_ids: [],
    source_href: "",
    search_text: blob,
  };
}

async function loadPilots() {
  try {
    const res = await fetch("../pilots/data/pilots_2026.json");
    if (!res.ok) return [];
    const json = await res.json();
    return (json.pilots || []).map(pilotToPackage);
  } catch (e) {
    console.warn("Пілотні проєкти не підвантажилися", e);
    return [];
  }
}

async function initPackages() {
  const [packagesResponse, docsResponse, decLinksResponse] = await Promise.all([
    fetch("data/packages_2026.json"),
    // Індекс без search_text (0,7 МБ замість 2,7) — тут потрібні лише назви
    // й прив'язки роз'яснень до пакетів
    fetch("../data/documents_index.json")
      .then((r) => { if (!r.ok) throw new Error("no index"); return r; })
      .catch(() => fetch("../data/documents.json")),
    fetch("../dec/data/package_dec_links.json").catch(() => null),
  ]);
  packageState.data = await packagesResponse.json();

  // Пілоти йдуть після пакетів ПМГ — окремою групою в переліку
  const pilots = await loadPilots();
  packageState.pilotCount = pilots.length;
  packageState.data.packages = packageState.data.packages.concat(pilots);
  packageState.explanations = (await docsResponse.json()).documents;
  if (decLinksResponse) {
    try {
      packageState.decLinks = await decLinksResponse.json() || {};
    } catch(e) { console.warn("Failed to load dec links", e); }
  }

  // Гібридне завантаження документів ДЕЦ
  let loadedFromSupabase = false;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    if (sb) {
      const { data: dbData, error } = await sb.from('dec_documents').select('*');
      if (!error && dbData && dbData.length > 0) {
        packageState.decDocuments = dbData;
        loadedFromSupabase = true;
        console.log("Loaded DEC documents for packages from Supabase!");
      }
    }
  } catch (dbErr) {
    console.warn("Supabase fetch for packages skipped or failed, falling back to local JSON:", dbErr);
  }

  if (!loadedFromSupabase) {
    try {
      const decDocsResponse = await fetch("../data/dec_documents.json");
      if (decDocsResponse) {
        packageState.decDocuments = (await decDocsResponse.json()).documents || [];
        console.log("Loaded DEC documents for packages from local JSON.");
      }
    } catch(e) {
      console.warn("Failed to load local dec documents", e);
    }
  }
  const params = new URLSearchParams(location.search);
  byId("packageSearch").value = params.get("q") || "";
  renderStats();
  renderTags();
  packageState.visible = packageState.data.packages;
  const wantedPkg = params.get("package");
  const initial = packageState.data.packages.find((pkg) => pkgKey(pkg) === wantedPkg)
    || packageState.data.packages.find((pkg) => pkg.number === wantedPkg)
    || packageState.data.packages[0];
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
  // Карта посад тягнеться окремо й може приїхати після першого малювання —
  // тоді просто перемальовуємо читалку вже з посиланнями.
  if (window.SpecLinks) window.SpecLinks.load(() => renderReader());
}

initPackages().catch(() => {
  byId("packageCards").innerHTML = '<div class="no-results">Не вдалося завантажити індекс пакетів.</div>';
});
