const state = {
  data: null,
  filtered: [],
  selected: null
};

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

// Build dropdown options dynamically based on initial dataset
defOptions = () => {
  const oblasts = new Set();
  const packages = new Set();
  const ownerships = new Set();

  state.data.contracts.forEach(c => {
    if (c.oblast) oblasts.add(c.oblast);
    if (c.package_num) packages.add(c.package_num);
    if (c.ownership) ownerships.add(c.ownership);
  });

  // Populate Oblast selector
  const oblastSelect = el("filterOblast");
  [...oblasts].sort((a,b) => a.localeCompare(b, "uk")).forEach(ob => {
    oblastSelect.add(new Option(ob, ob));
  });

  // Populate Package selector
  const packageSelect = el("filterPackage");
  [...packages].sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  }).forEach(pkg => {
    // Find package name to display
    const match = state.data.contracts.find(c => c.package_num === pkg);
    const label = match ? `Пакет ${pkg} — ${match.package_name.substring(0, 45)}...` : `Пакет ${pkg}`;
    packageSelect.add(new Option(label, pkg));
  });

  // Populate Ownership selector
  const ownershipSelect = el("filterOwnership");
  [...ownerships].sort((a,b) => a.localeCompare(b, "uk")).forEach(own => {
    ownershipSelect.add(new Option(own, own));
  });
};

// Filter data
function applyFilters() {
  const query = el("contractSearch").value.trim().toLowerCase();
  const oblast = el("filterOblast").value;
  const pkg = el("filterPackage").value;
  const ownership = el("filterOwnership").value;
  const network = el("filterNetwork").value;

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
        c.package_num.includes(query) ||
        c.package_name.toLowerCase().includes(query)
      );
      if (!matchText) return false;
    }

    // Dropdowns
    if (oblast && c.oblast !== oblast) return false;
    if (pkg && c.package_num !== pkg) return false;
    if (ownership && c.ownership !== ownership) return false;
    if (network && c.network_type !== network) return false;

    return true;
  });

  // Update summary metrics
  const uniqueProviders = new Set(state.filtered.map(c => c.edrpou)).size;
  const sumTotal = state.filtered.reduce((acc, curr) => acc + curr.sum, 0);
  
  el("resultsCount").textContent = `Знайдено: ${state.filtered.length} договорі(в) у ${uniqueProviders} надавачів`;
  
  // Render list
  renderCards();

  // Handle side view sync
  if (state.filtered.length > 0) {
    // If current selection is no longer in filtered, select first
    const isStillVisible = state.selected && state.filtered.some(c => c.id === state.selected.id);
    if (!isStillVisible) {
      selectContract(state.filtered[0].id);
    }
  } else {
    showEmptyState();
  }
}

// Render cards
function renderCards() {
  const container = el("contractCards");
  container.innerHTML = "";

  if (state.filtered.length === 0) {
    container.innerHTML = '<div class="no-results">За обраними умовами договорів не знайдено. Спробуйте змінити критерії пошуку.</div>';
    return;
  }

  state.filtered.forEach(c => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "document-card contract-card";
    if (state.selected && state.selected.id === c.id) {
      card.classList.add("active");
    }

    // Network status badge helper
    let netClass = "";
    if (c.network_type === "Надкластерний") netClass = "nadklaster";
    else if (c.network_type === "Кластерний") netClass = "klaster";
    else if (c.network_type === "Загальний") netClass = "general";

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
        <span class="package-badge-mini">Пакет ${escapeHtml(c.package_num)}</span>
      </div>
    `;

    card.addEventListener("click", () => selectContract(c.id));
    container.appendChild(card);
  });
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
    // Usually locations are split by semicolons or commas
    const addressList = contract.locations.split(/;\s*|\n+/).filter(x => x.trim().length > 0);
    locationsHtml = addressList.map(addr => `
      <div class="mnp-location-item">${escapeHtml(addr)}</div>
    `).join("");
  } else {
    locationsHtml = "<p class='text-muted'>Місця надання послуг не вказані.</p>";
  }

  // Network badge helper class
  let netBadgeClass = "";
  if (contract.network_type === "Надкластерний") netBadgeClass = "nadklaster";
  else if (contract.network_type === "Кластерний") netBadgeClass = "klaster";
  else if (contract.network_type === "Загальний") netBadgeClass = "general";

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
        <span>Програма фінансування</span>
        <strong>${escapeHtml(contract.financing_program)}</strong>
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

    <div class="section-title">Пакет медичних послуг</div>
    <div class="details-list-grid">
      <div class="details-grid-item span-2" style="background: var(--accent-soft);">
        <span style="color: var(--accent-dark);">Пакет № ${escapeHtml(contract.package_num)}</span>
        <strong style="color: var(--accent-dark); font-size: 14.5px;">${escapeHtml(contract.package_name)}</strong>
      </div>
      <div class="details-grid-item">
        <span>Напрям допомоги</span>
        <strong>${escapeHtml(contract.direction)}</strong>
      </div>
      <div class="details-grid-item">
        <span>Вид допомоги</span>
        <strong>${escapeHtml(contract.help_type)}</strong>
      </div>
    </div>

    <div class="section-title">Коефіцієнти та додаткові умови</div>
    <div class="coef-status-row">
      <div class="coef-box ${contract.has_extra_coef_contract === 'Так' ? 'active' : ''}">
        <span>Додаткові коефіцієнти</span>
        <div class="coef-val">${escapeHtml(contract.has_extra_coef_contract)}</div>
        <div class="coef-desc">наявність додаткових коригувальних коефіцієнтів у тексті договору</div>
      </div>
      <div class="coef-box ${contract.has_extra_coef_package === 'Так' ? 'active' : ''}">
        <span>Коефіцієнт пакета</span>
        <div class="coef-val">${escapeHtml(contract.has_extra_coef_package)}</div>
        <div class="coef-desc">наявність додаткового коригувального коефіцієнту під цей конкретний пакет</div>
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

  // On small screens, scroll detail viewer into view
  if (window.innerWidth <= 1040) {
    el("contractDetailViewer").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showEmptyState() {
  el("detailEmptyState").style.display = "block";
  el("detailContent").style.display = "none";
}

// Export filtered list to Excel-compatible CSV file (semicolon delimited with UTF-8 BOM)
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
    "Сума договору",
    "Додаткові коефіцієнти",
    "Коефіцієнт пакета",
    "Додаткова інформація"
  ];

  let csvContent = "\uFEFF"; // UTF-8 BOM for Excel Cyrillic support
  csvContent += headers.join(";") + "\r\n";

  state.filtered.forEach(c => {
    const row = [
      c.edrpou,
      `"${c.provider_name_full.replace(/"/g, '""')}"`,
      `"${c.ownership.replace(/"/g, '""')}"`,
      `"${c.oblast.replace(/"/g, '""')}"`,
      `"${c.community.replace(/"/g, '""')}"`,
      `"${c.settlement.replace(/"/g, '""')}"`,
      `"${c.settlement_type.replace(/"/g, '""')}"`,
      `"${c.contract_num.replace(/"/g, '""')}"`,
      `"${c.contract_slug.replace(/"/g, '""')}"`,
      c.sign_date,
      c.start_date,
      c.end_date,
      c.package_num,
      `"${c.package_name.replace(/"/g, '""')}"`,
      `"${c.direction.replace(/"/g, '""')}"`,
      `"${c.help_type.replace(/"/g, '""')}"`,
      `"${c.network_type.replace(/"/g, '""')}"`,
      c.email,
      c.sum.toString().replace(".", ","), // Decimal separator comma
      c.has_extra_coef_contract,
      c.has_extra_coef_package,
      `"${c.extra_info.replace(/"/g, '""')}"`
    ];
    csvContent += row.join(";") + "\r\n";
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  
  const dateStr = new Date().toISOString().slice(0, 10);
  link.setAttribute("download", `zoz_dogovory_${dateStr}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Reset all search inputs and filters
function resetFilters() {
  el("contractSearch").value = "";
  el("filterOblast").value = "";
  el("filterPackage").value = "";
  el("filterOwnership").value = "";
  el("filterNetwork").value = "";
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

  // Populate dropdown options
  defOptions();

  // Setup event listeners
  el("contractSearch").addEventListener("input", applyFilters);
  el("filterOblast").addEventListener("change", applyFilters);
  el("filterPackage").addEventListener("change", applyFilters);
  el("filterOwnership").addEventListener("change", applyFilters);
  el("filterNetwork").addEventListener("change", applyFilters);
  el("resetFilters").addEventListener("click", resetFilters);
  el("exportExcel").addEventListener("click", exportToExcel);

  // Check URL params for deep linking (e.g. ?package=53)
  const params = new URLSearchParams(location.search);
  const initialPackage = params.get("package") || "";
  const initialQuery = params.get("q") || "";

  if (initialQuery) {
    el("contractSearch").value = initialQuery;
  }
  if (initialPackage) {
    el("filterPackage").value = initialPackage;
  }

  // Initial filtering
  applyFilters();
}

document.addEventListener("DOMContentLoaded", init);
