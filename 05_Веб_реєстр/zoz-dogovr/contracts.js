const state = {
  data: null,
  filtered: [],
  selected: null,
  filters: {
    oblasts: new Set(),
    packages: new Set(),
    ownerships: new Set(),
    networks: new Set()
  }
};

const dropdowns = {};

const el = (id) => document.getElementById(id);

// Format number to local currency format
function formatCurrency(val) {
  if (val === undefined || val === null) return "0,00 ₴";
  return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' }).format(val);
}

// Escapes HTML special chars
function escapeHtml(val) {
  return String(val ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

// Setup a multiselect dropdown component
function setupMultiselect({
  dropdownId,
  btnId,
  optionsId,
  searchId,
  selectAllId,
  clearId,
  defaultText,
  filterKey,
  optionValuesExtractor,
  optionLabelFormatter,
  onSelectionChange
}) {
  const dropdown = el(dropdownId);
  const btn = el(btnId);
  const optionsContainer = el(optionsId);
  const searchInput = el(searchId);
  const selectAllBtn = el(selectAllId);
  const clearBtn = el(clearId);

  let optionsData = optionValuesExtractor();

  function renderOptions(filterQuery = "") {
    optionsContainer.innerHTML = "";
    const query = filterQuery.toLowerCase().trim();

    const filteredOpts = optionsData.filter(opt => {
      const label = optionLabelFormatter ? optionLabelFormatter(opt) : opt;
      return label.toLowerCase().includes(query) || opt.toLowerCase().includes(query);
    });

    if (filteredOpts.length === 0) {
      optionsContainer.innerHTML = '<div style="padding: 10px 12px; font-size:12px; color:var(--muted); text-align:center;">Нічого не знайдено</div>';
      return;
    }

    filteredOpts.forEach(opt => {
      const labelEl = document.createElement("label");
      labelEl.className = "multiselect-item";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.value = opt;
      chk.checked = state.filters[filterKey].has(opt);

      chk.addEventListener("change", () => {
        if (chk.checked) {
          state.filters[filterKey].add(opt);
        } else {
          state.filters[filterKey].delete(opt);
        }
        updateButtonText();
        onSelectionChange();
      });

      const span = document.createElement("span");
      span.textContent = optionLabelFormatter ? optionLabelFormatter(opt) : opt;
      span.title = span.textContent;

      labelEl.appendChild(chk);
      labelEl.appendChild(span);
      optionsContainer.appendChild(labelEl);
    });
  }

  function updateButtonText() {
    const selectedCount = state.filters[filterKey].size;
    if (selectedCount === 0) {
      btn.textContent = defaultText;
    } else if (selectedCount === optionsData.length) {
      btn.textContent = `Усі (${selectedCount})`;
    } else {
      btn.textContent = `Обрано: ${selectedCount}`;
    }
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains("open");
    document.querySelectorAll(".multiselect-dropdown").forEach(d => {
      if (d !== dropdown) d.classList.remove("open");
    });
    dropdown.classList.toggle("open");
    if (dropdown.classList.contains("open")) {
      if (searchInput) {
        searchInput.value = "";
        renderOptions();
        searchInput.focus();
      }
    }
  });

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      renderOptions(e.target.value);
    });
  }

  selectAllBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    optionsData.forEach(opt => state.filters[filterKey].add(opt));
    optionsContainer.querySelectorAll('input[type="checkbox"]').forEach(chk => chk.checked = true);
    updateButtonText();
    onSelectionChange();
  });

  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.filters[filterKey].clear();
    optionsContainer.querySelectorAll('input[type="checkbox"]').forEach(chk => chk.checked = false);
    updateButtonText();
    onSelectionChange();
  });

  // Initial populate
  renderOptions();
  updateButtonText();

  return {
    reset: () => {
      state.filters[filterKey].clear();
      if (searchInput) searchInput.value = "";
      renderOptions();
      updateButtonText();
    },
    selectSingle: (val) => {
      state.filters[filterKey].clear();
      state.filters[filterKey].add(val);
      renderOptions();
      updateButtonText();
    }
  };
}

// Build all dropdown components
const initDropdowns = () => {
  // Oblast dropdown
  dropdowns.oblasts = setupMultiselect({
    dropdownId: "dropdownOblast",
    btnId: "btnOblast",
    optionsId: "optionsOblast",
    searchId: "searchOblast",
    selectAllId: "selectAllOblast",
    clearId: "clearOblast",
    defaultText: "Усі області",
    filterKey: "oblasts",
    optionValuesExtractor: () => {
      const list = new Set();
      state.data.contracts.forEach(c => { if (c.oblast) list.add(c.oblast); });
      return [...list].sort((a,b) => a.localeCompare(b, "uk"));
    },
    onSelectionChange: applyFilters
  });

  // Package dropdown
  dropdowns.packages = setupMultiselect({
    dropdownId: "dropdownPackage",
    btnId: "btnPackage",
    optionsId: "optionsPackage",
    searchId: "searchPackage",
    selectAllId: "selectAllPackage",
    clearId: "clearPackage",
    defaultText: "Усі пакети",
    filterKey: "packages",
    optionValuesExtractor: () => {
      const list = new Set();
      state.data.contracts.forEach(c => {
        if (c.packages) c.packages.forEach(p => list.add(p.package_num));
      });
      return [...list].sort((a, b) => {
        const na = parseInt(a), nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      });
    },
    optionLabelFormatter: (pkg) => {
      const meta = state.data.package_metadata[pkg];
      return meta ? `Пакет ${pkg} — ${meta.package_name.substring(0, 45)}...` : `Пакет ${pkg}`;
    },
    onSelectionChange: applyFilters
  });

  // Ownership dropdown
  dropdowns.ownerships = setupMultiselect({
    dropdownId: "dropdownOwnership",
    btnId: "btnOwnership",
    optionsId: "optionsOwnership",
    searchId: null,
    selectAllId: "selectAllOwnership",
    clearId: "clearOwnership",
    defaultText: "Усі форми",
    filterKey: "ownerships",
    optionValuesExtractor: () => {
      const list = new Set();
      state.data.contracts.forEach(c => { if (c.ownership) list.add(c.ownership); });
      return [...list].sort((a,b) => a.localeCompare(b, "uk"));
    },
    onSelectionChange: applyFilters
  });

  // Network dropdown
  dropdowns.networks = setupMultiselect({
    dropdownId: "dropdownNetwork",
    btnId: "btnNetwork",
    optionsId: "optionsNetwork",
    searchId: null,
    selectAllId: "selectAllNetwork",
    clearId: "clearNetwork",
    defaultText: "Усі типи",
    filterKey: "networks",
    optionValuesExtractor: () => {
      return ["Надкластерний", "Кластерний", "Загальний", "Не входить в спроможну мережу"];
    },
    optionLabelFormatter: (val) => {
      return val === "Не входить в спроможну мережу" ? "Не входить в мережу" : val;
    },
    onSelectionChange: applyFilters
  });
};

// Filter data
function applyFilters() {
  const query = el("contractSearch").value.trim().toLowerCase();

  state.filtered = state.data.contracts.filter(c => {
    // Text search
    if (query) {
      const matchText = (
        c.provider_name.toLowerCase().includes(query) ||
        c.provider_name_full.toLowerCase().includes(query) ||
        c.edrpou.includes(query) ||
        c.contract_num.toLowerCase().includes(query) ||
        c.contract_slug.toLowerCase().includes(query) ||
        c.settlement.toLowerCase().includes(query) ||
        c.oblast.toLowerCase().includes(query) ||
        c.packages.some(p => {
          const meta = state.data.package_metadata[p.package_num] || {};
          return (
            p.package_num.includes(query) ||
            (meta.package_name && meta.package_name.toLowerCase().includes(query)) ||
            (meta.direction && meta.direction.toLowerCase().includes(query))
          );
        })
      );
      if (!matchText) return false;
    }

    // Multi-select dropdown filters
    if (state.filters.oblasts.size > 0 && !state.filters.oblasts.has(c.oblast)) {
      return false;
    }
    if (state.filters.packages.size > 0 && !c.packages.some(p => state.filters.packages.has(p.package_num))) {
      return false;
    }
    if (state.filters.ownerships.size > 0 && !state.filters.ownerships.has(c.ownership)) {
      return false;
    }
    if (state.filters.networks.size > 0 && !state.filters.networks.has(c.network_type)) {
      return false;
    }

    return true;
  });

  // Update summary metrics
  const uniqueProviders = new Set(state.filtered.map(c => c.edrpou)).size;
  
  // Calculate total sum of filtered contracts or filtered packages
  let sumTotal = 0;
  if (state.filters.packages.size > 0) {
    state.filtered.forEach(c => {
      c.packages.forEach(p => {
        if (state.filters.packages.has(p.package_num)) {
          sumTotal += p.sum;
        }
      });
    });
  } else {
    sumTotal = state.filtered.reduce((acc, curr) => acc + curr.sum, 0);
  }
  
  el("resultsCount").textContent = `Знайдено: ${state.filtered.length} договорі(в) у ${uniqueProviders} надавачів`;
  
  // Render list
  renderCards();

  // Handle side view sync
  if (state.filtered.length > 0) {
    const isStillVisible = state.selected && state.filtered.some(c => c.id === state.selected.id);
    if (!isStillVisible) {
      selectContract(state.filtered[0].id);
    }
  } else {
    showEmptyState();
  }
}

// Render cards (with 250 limit to avoid DOM freezing)
function renderCards() {
  const container = el("contractCards");
  container.innerHTML = "";

  if (state.filtered.length === 0) {
    container.innerHTML = '<div class="no-results">За обраними умовами договорів не знайдено. Спробуйте змінити критерії пошуку.</div>';
    return;
  }

  const limit = 250;
  const itemsToRender = state.filtered.slice(0, limit);

  itemsToRender.forEach(c => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "document-card contract-card";
    if (state.selected && state.selected.id === c.id) {
      card.classList.add("active");
    }

    let netClass = "";
    if (c.network_type === "Надкластерний") netClass = "nadklaster";
    else if (c.network_type === "Кластерний") netClass = "klaster";
    else if (c.network_type === "Загальний") netClass = "general";

    // Show package numbers contracted under this provider
    const pkgStr = c.packages.map(p => p.package_num).join(", ");

    card.innerHTML = `
      <div class="contract-card-header">
        <div class="contract-card-meta">
          <span class="contract-edrpou">${escapeHtml(c.edrpou)}</span>
          <span class="tag file ${netClass}">${escapeHtml(c.network_type || "Заклад")}</span>
        </div>
        <div class="contract-card-sum">${formatCurrency(c.sum)}</div>
      </div>
      <strong class="contract-card-title" title="${escapeHtml(c.provider_name)}">${escapeHtml(c.provider_name)}</strong>
      <div class="contract-card-footer">
        <span>📍 ${escapeHtml(c.settlement)} (${escapeHtml(c.oblast)})</span>
        <span class="package-badge-mini" title="Пакети: ${escapeHtml(pkgStr)}">Пакет(и): ${escapeHtml(pkgStr)}</span>
      </div>
    `;

    card.addEventListener("click", () => selectContract(c.id));
    container.appendChild(card);
  });

  if (state.filtered.length > limit) {
    const note = document.createElement("div");
    note.className = "no-results";
    note.style.border = "none";
    note.style.background = "var(--accent-soft)";
    note.style.color = "var(--accent-dark)";
    note.style.fontSize = "13px";
    note.style.padding = "14px";
    note.textContent = `Показано перші ${limit} з ${state.filtered.length} результатів. Будь ласка, уточніть пошук для перегляду решти.`;
    container.appendChild(note);
  }
}

// Select specific contract and show details
function selectContract(id) {
  const contract = state.data.contracts.find(c => c.id === id);
  if (!contract) return;

  state.selected = contract;

  // Highlight card
  document.querySelectorAll(".contract-card").forEach((card, index) => {
    const item = state.filtered[index];
    if (item) {
      card.classList.toggle("active", item.id === id);
    }
  });

  // Render detail view
  el("detailEmptyState").style.display = "none";
  const content = el("detailContent");
  content.style.display = "block";

  // Parse locations if any
  let locationsHtml = "";
  if (contract.locations) {
    const addressList = contract.locations.split(/;\s*|\n+/).filter(x => x.trim().length > 0);
    locationsHtml = addressList.map(addr => `
      <div class="mnp-location-item">${escapeHtml(addr)}</div>
    `).join("");
  } else {
    locationsHtml = "<p class='text-muted'>Місця надання послуг не вказані.</p>";
  }

  let netBadgeClass = "";
  if (contract.network_type === "Надкластерний") netBadgeClass = "nadklaster";
  else if (contract.network_type === "Кластерний") netBadgeClass = "klaster";
  else if (contract.network_type === "Загальний") netBadgeClass = "general";

  // Build packages list rendering
  const packagesHtml = contract.packages.map(p => {
    const meta = state.data.package_metadata[p.package_num] || {
      package_name: "Невідомий пакет",
      direction: "Невідомо",
      help_type: "Невідомо"
    };
    return `
      <div class="details-grid-item span-2" style="background: var(--accent-soft); border-left: 3px solid var(--accent); margin-bottom: 2px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%; gap: 10px;">
          <span style="color: var(--accent-dark); font-weight: 700; font-size: 11px;">Пакет № ${escapeHtml(p.package_num)}</span>
          <strong style="color: var(--teal-dark); font-size: 13.5px; white-space: nowrap;">${formatCurrency(p.sum)}</strong>
        </div>
        <strong style="color: var(--ink); font-size: 13px; margin-top: 4px; display: block; font-weight: 600;">${escapeHtml(meta.package_name)}</strong>
        <div style="font-size: 11px; color: var(--muted); margin-top: 6px; display: flex; flex-wrap: wrap; gap: 10px;">
          <span>Напрям: <strong>${escapeHtml(meta.direction)}</strong></span>
          <span>Вид: <strong>${escapeHtml(meta.help_type)}</strong></span>
          <span>Коеф. пакета: <strong>${escapeHtml(p.has_extra_coef_package)}</strong></span>
        </div>
      </div>
    `;
  }).join("");

  content.innerHTML = `
    <div class="detail-header-card">
      <div class="detail-pills-row">
        <span class="label">${escapeHtml(contract.oblast)} область</span>
        <span class="label file">${escapeHtml(contract.ownership)}</span>
        <span class="label network-badge ${netBadgeClass}">${escapeHtml(contract.network_type)}</span>
      </div>
      <h2 class="detail-title-desc">${escapeHtml(contract.provider_name_full)}</h2>
      <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">
        Код ЄДРПОУ: <strong>${escapeHtml(contract.edrpou)}</strong>
      </div>
    </div>

    <div class="finance-highlight-box">
      <div class="finance-label">
        <span>Сума договору / угоди</span>
        <strong>${escapeHtml(contract.doc_type)} (${escapeHtml(contract.year)})</strong>
      </div>
      <div class="finance-sum">${formatCurrency(contract.sum)}</div>
    </div>

    <div class="section-title">Основні реквізити договору</div>
    <div class="details-list-grid">
      <div class="details-grid-item">
        <span>Номер договору</span>
        <strong>${escapeHtml(contract.contract_num)}</strong>
      </div>
      <div class="details-grid-item">
        <span>Повна угода</span>
        <strong>${escapeHtml(contract.contract_slug)}</strong>
      </div>
      <div class="details-grid-item">
        <span>Дата підписання</span>
        <strong>${escapeHtml(contract.sign_date || "—")}</strong>
      </div>
      <div class="details-grid-item">
        <span>Термін дії</span>
        <strong>з ${escapeHtml(contract.start_date)} до ${escapeHtml(contract.end_date)}</strong>
      </div>
      <div class="details-grid-item span-2">
        <span>Керівник закладу</span>
        <strong>${escapeHtml(contract.leader_title)} — ${escapeHtml(contract.leader_name)}</strong>
      </div>
      <div class="details-grid-item">
        <span>Контактний email</span>
        <strong>${contract.email ? `<a href="mailto:${escapeHtml(contract.email)}">${escapeHtml(contract.email)}</a>` : "—"}</strong>
      </div>
      <div class="details-grid-item">
        <span>Населений пункт</span>
        <strong>${escapeHtml(contract.settlement_type)} ${escapeHtml(contract.settlement)} (${escapeHtml(contract.community)} громада)</strong>
      </div>
      <div class="details-grid-item span-2">
        <span>Юридична адреса реєстрації</span>
        <strong>${escapeHtml(contract.reg_address)}</strong>
      </div>
    </div>

    <div class="section-title">Пакет(и) медичних послуг за договором</div>
    <div class="mnp-packages-container" style="display: flex; flex-direction: column; gap: 6px;">
      ${packagesHtml}
    </div>

    <div class="section-title">Коефіцієнти та додаткові умови</div>
    <div class="coef-status-row">
      <div class="coef-box ${contract.has_extra_coef_contract === 'Так' ? 'active' : ''}" style="grid-column: span 2;">
        <span>Коефіцієнти в договорі</span>
        <div class="coef-val">${escapeHtml(contract.has_extra_coef_contract)}</div>
        <div class="coef-desc">наявність додаткових коригувальних коефіцієнтів у тексті договору</div>
      </div>
      ${contract.extra_info && contract.extra_info !== 'nan' ? `
        <div class="coef-box active span-2" style="grid-column: span 2;">
          <span>Додаткова інформація</span>
          <div class="coef-desc" style="font-weight: 600; color: var(--ink);">${escapeHtml(contract.extra_info)}</div>
        </div>
      ` : ""}
    </div>

    <div class="section-title">Місця надання послуг (МНП) за договором</div>
    <div class="mnp-locations-container">
      ${locationsHtml}
    </div>
  `;

  if (window.innerWidth <= 1040) {
    el("contractDetailViewer").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Export filtered list to premium binary Excel (.xlsx) file using SheetJS
function exportToExcel() {
  if (!state.filtered || state.filtered.length === 0) {
    alert("Немає даних для експорту!");
    return;
  }

  const headers = [
    "Код ЄДРПОУ",
    "Назва надавача",
    "Форма власності",
    "Область реєстрації",
    "Громада",
    "Населений пункт",
    "Тип населеного пункту",
    "Номер договору",
    "Номер договору/додаткової угоди",
    "Дата підписання",
    "Початок дії",
    "Кінець дії",
    "Номер пакету",
    "Назва пакету",
    "Напрям допомоги",
    "Вид допомоги",
    "Спроможна мережа",
    "Електронна пошта",
    "Сума пакету",
    "Додаткові коефіцієнти договору",
    "Коефіцієнт пакету",
    "Додаткова інформація"
  ];

  const wsData = [headers];

  state.filtered.forEach(c => {
    c.packages.forEach(p => {
      // If package filters are active, only export the selected packages
      if (state.filters.packages.size > 0 && !state.filters.packages.has(p.package_num)) return;

      const meta = state.data.package_metadata[p.package_num] || {};
      const row = [
        c.edrpou,
        c.provider_name_full,
        c.ownership,
        c.oblast,
        c.community,
        c.settlement,
        c.settlement_type,
        c.contract_num,
        c.contract_slug,
        c.sign_date || "",
        c.start_date || "",
        c.end_date || "",
        p.package_num,
        meta.package_name || "",
        meta.direction || "",
        meta.help_type || "",
        c.network_type,
        c.email || "",
        p.sum, // Keep as numeric value
        c.has_extra_coef_contract || "Ні",
        p.has_extra_coef_package || "Ні",
        (c.extra_info && c.extra_info !== "nan") ? c.extra_info : ""
      ];
      wsData.push(row);
    });
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-adjust column widths
  const max_cols = headers.length;
  ws['!cols'] = [];
  for (let col = 0; col < max_cols; col++) {
    let maxLen = headers[col].length;
    for (let row = 1; row < wsData.length; row++) {
      const cellVal = wsData[row][col];
      if (cellVal !== undefined && cellVal !== null) {
        const len = cellVal.toString().length;
        if (len > maxLen) maxLen = len;
      }
    }
    ws['!cols'].push({ wch: Math.min(Math.max(maxLen + 3, 10), 60) });
  }

  // Format the "Сума пакету" numeric column (index 18)
  const colLetter = XLSX.utils.encode_col(18);
  for (let r = 1; r < wsData.length; r++) {
    const cellRef = colLetter + (r + 1);
    if (ws[cellRef]) {
      ws[cellRef].t = 'n'; // Numeric format type
      ws[cellRef].z = '#,##0.00'; // Standard Ukrainian currency presentation layout
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, "Договори ЗОЗ");

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `zoz_dogovory_${dateStr}.xlsx`);
}

// Export a brief table of EDRPOU, ZOZ Name, Email and Selected Packages
function exportEmailsToExcel() {
  if (!state.filtered || state.filtered.length === 0) {
    alert("Немає даних для експорту!");
    return;
  }

  const headers = [
    "Код ЄДРПОУ",
    "Назва надавача",
    "Електронна пошта",
    "Обрані пакети"
  ];

  const wsData = [headers];
  
  // Use a map to ensure unique ZOZ rows by EDRPOU (avoid duplicates for mailing)
  const uniqueZOZ = new Map();

  state.filtered.forEach(c => {
    // Find matching package numbers
    const matchedPkgs = c.packages
      .map(p => p.package_num)
      .filter(num => state.filters.packages.size === 0 || state.filters.packages.has(num));

    if (state.filters.packages.size > 0 && matchedPkgs.length === 0) {
      return;
    }

    const edrpou = c.edrpou;
    const email = c.email || "";
    const name = c.provider_name_full || c.provider_name;
    const pkgsStr = matchedPkgs.join(", ");

    if (uniqueZOZ.has(edrpou)) {
      const existing = uniqueZOZ.get(edrpou);
      const existingPkgs = existing.pkgs.split(", ");
      matchedPkgs.forEach(p => {
        if (!existingPkgs.includes(p)) existingPkgs.push(p);
      });
      existing.pkgs = existingPkgs.sort((a,b) => parseInt(a) - parseInt(b)).join(", ");
    } else {
      uniqueZOZ.set(edrpou, {
        name: name,
        email: email,
        pkgs: pkgsStr
      });
    }
  });

  if (uniqueZOZ.size === 0) {
    alert("Дані відсутні!");
    return;
  }

  uniqueZOZ.forEach((info, edrpou) => {
    wsData.push([
      edrpou,
      info.name,
      info.email,
      info.pkgs
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-adjust column widths
  const max_cols = headers.length;
  ws['!cols'] = [];
  for (let col = 0; col < max_cols; col++) {
    let maxLen = headers[col].length;
    for (let row = 1; row < wsData.length; row++) {
      const cellVal = wsData[row][col];
      if (cellVal !== undefined && cellVal !== null) {
        const len = cellVal.toString().length;
        if (len > maxLen) maxLen = len;
      }
    }
    ws['!cols'].push({ wch: Math.min(Math.max(maxLen + 3, 10), 60) });
  }

  XLSX.utils.book_append_sheet(wb, ws, "Контакти ЗОЗ");

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `zoz_emails_${dateStr}.xlsx`);
}

function showEmptyState() {
  el("detailEmptyState").style.display = "block";
  el("detailContent").style.display = "none";
}

// Reset all search inputs and filters
function resetFilters() {
  el("contractSearch").value = "";
  Object.values(dropdowns).forEach(d => d.reset());
  applyFilters();
}

async function init() {
  // Load data
  const response = await fetch("../data/contracts.json");
  state.data = await response.json();

  // Populate hero statistics
  el("statContractsCount").textContent = state.data.count.toLocaleString('uk-UA');
  el("statProvidersCount").textContent = state.data.unique_providers.toLocaleString('uk-UA');
  el("statTotalSum").textContent = formatCurrency(state.data.total_sum);

  // Initialize multiselect dropdowns
  initDropdowns();

  // Setup event listeners
  el("contractSearch").addEventListener("input", applyFilters);
  el("resetFilters").addEventListener("click", resetFilters);
  el("exportExcel").addEventListener("click", exportToExcel);
  el("exportEmails").addEventListener("click", exportEmailsToExcel);

  // Close dropdowns on document click
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".multiselect-dropdown")) {
      document.querySelectorAll(".multiselect-dropdown").forEach(d => d.classList.remove("open"));
    }
  });

  // Check URL params for deep linking (e.g. ?package=53)
  const params = new URLSearchParams(location.search);
  const initialPackage = params.get("package") || "";
  const initialQuery = params.get("q") || "";

  if (initialQuery) {
    el("contractSearch").value = initialQuery;
  }
  if (initialPackage) {
    dropdowns.packages.selectSingle(initialPackage);
  }

  // Initial filtering
  applyFilters();
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    console.error(err);
    const resultsCountEl = el("resultsCount");
    if (resultsCountEl) {
      resultsCountEl.textContent = "Помилка завантаження даних";
    }
    const cardsContainer = el("contractCards");
    if (cardsContainer) {
      cardsContainer.innerHTML = `
        <div class="no-results" style="border: 1px dashed var(--accent); background: var(--accent-soft); color: var(--accent-dark); padding: 20px; border-radius: 12px; margin: 10px 0;">
          <strong>Не вдалося завантажити дані договорів.</strong><br>
          Будь ласка, переконайтеся, що сторінку запущено через локальний вебсервер.<br><br>
          Скористайтеся файлом <code>Відкрити_реєстр.cmd</code> у корені папки для правильного запуску.
        </div>
      `;
    }
  });
});
