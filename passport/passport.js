/**
 * Паспорт пакета ПМГ 2026 — Controller Logic
 * Aggregates specification requirements, tariffs, clarifications, contracted facilities, and clinical standards.
 */

// Global State
const passportState = {
  packages: [],
  selectedPackage: null,
  contractsData: null, // contains count, total_sum, unique_providers, unique_packages, package_metadata, contracts
  decDocuments: [],
  decLinks: {},
  explanations: [],
  resolution: null,
  
  // Hospital Table State
  hospitalSearch: "",
  hospitalOblast: "",
  hospitalSortField: "sum",
  hospitalSortDesc: true,
  hospitalCurrentPage: 1,
  hospitalPageSize: 15
};

const el = (id) => document.getElementById(id);

// 2026 Package Groups mapping for clarifications
const PACKAGE_GROUPS = {
  "01": ["ПМД"],
  "03": ["Хірургія-стаціонар"],
  "04": ["Стаціонарна-допомога-без-операцій"],
  "05": ["Інсульт"],
  "06": ["Інфаркт"],
  "07": ["Допомога-при-пологах"],
  "08": ["Допомога-новонародженим"],
  "09": ["Амбулаторна-допомога"],
  "16": ["Гемодіаліз"],
  "18": ["Радіологічне-лікування"],
  "19": ["Психіатрична-допомога"],
  "20": ["Туберкульоз-ПМД"],
  "23": ["Паліативна-допомога"],
  "24": ["Паліативна-допомога"],
  "34": ["Стоматологічна-допомога"],
  "37": ["Перитонеальний-діаліз"],
  "53": ["Реабілітація", "Пакети-53-54"],
  "54": ["Реабілітація", "Пакети-53-54"],
  "60": ["Медогляд-ТЦК"],
  "63": ["Лікування-безпліддя-ДРТ"],
  "64": ["Трансплантація"],
  "86": ["Медична-допомога-дітям"],
};

// Formatting helpers
function formatCurrency(val) {
  if (val === undefined || val === null) return "0,00 ₴";
  return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' }).format(val);
}

function escapeHtml(val) {
  return String(val ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function formatDate(val) {
  if (!val) return "";
  const parts = val.split("-");
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return val;
}

// Helper to normalize dec links for a package (supports both legacy array and new object format)
function getLinkedCategoriesForPackage(pkgNum) {
  const pkgLinks = passportState.decLinks[pkgNum] || [];
  if (Array.isArray(pkgLinks)) {
    return pkgLinks;
  }
  return Object.keys(pkgLinks);
}

// ── Data Initialization ──────────────────────────────────────
async function init() {
  try {
    // Concurrent fetch of all resources
    const [
      packagesRes,
      contractsRes,
      decDocsRes,
      decLinksRes,
      docsRes,
      resolutionRes,
    ] = await Promise.all([
      fetch("../pakety/data/packages_2026.json").then(r => r.json()),
      // Полегшена версія договорів (4.5 МБ замість 19); якщо її немає — повна
      fetch("../data/contracts_slim.json")
        .then(r => { if (!r.ok) throw new Error("no slim"); return r.json(); })
        .catch(() => fetch("../data/contracts.json").then(r => r.json())),
      fetch("../data/dec_documents.json").then(r => r.json()).catch(() => ({ documents: [] })),
      fetch("../dec/data/package_dec_links.json").then(r => r.json()).catch(() => ({})),
      // Індекс без search_text (0,7 МБ замість 2,7); excerpt у ньому лишився —
      // паспорт показує фрагмент документа
      fetch("../data/documents_index.json")
        .then(r => { if (!r.ok) throw new Error("no index"); return r.json(); })
        .catch(() => fetch("../data/documents.json").then(r => r.json())),
      fetch("../postanova/data/resolution_1808.json").then(r => r.json()).catch(() => null),
      // Карта посад для лінкування вимог до спеціалістів. Вантажимо разом з
      // рештою, щоб посилання були вже на першому малюванні вкладки «Вимоги»;
      // load() не кидає — без карти сторінка просто покаже чистий текст.
      window.SpecLinks ? window.SpecLinks.load() : Promise.resolve(null)
    ]);

    // Populate State
    passportState.packages = packagesRes.packages || [];
    passportState.contractsData = contractsRes;
    passportState.decDocuments = decDocsRes.documents || [];
    passportState.decLinks = decLinksRes || {};
    passportState.explanations = docsRes.documents || [];
    passportState.resolution = resolutionRes;

    // Дата вивантажки договорів — у шапці термометра. З серпня 2026 вивантажка
    // складу мережі йде без сум, тому суми беруться зі старішої вивантажки і
    // мають власну дату (sums_date) — показуємо обидві, щоб не брехати.
    const zozFreshEl = el("zozFreshness");
    if (zozFreshEl && contractsRes.source_date) {
      const sumsPart = contractsRes.sums_date && contractsRes.sums_date !== contractsRes.source_date
        ? ` · суми — ${contractsRes.sums_date}` : "";
      zozFreshEl.textContent = `мережа станом на ${contractsRes.source_date}${sumsPart}`;
      zozFreshEl.title = contractsRes.sums_source
        ? `Склад мережі — вивантажка від ${contractsRes.source_date} (без сум); суми договорів — з вивантажки від ${contractsRes.sums_date}`
        : (contractsRes.built_at
            ? `Вивантажка договорів від ${contractsRes.source_date}, перезібрано ${contractsRes.built_at}`
            : `Вивантажка договорів від ${contractsRes.source_date}`);
      zozFreshEl.hidden = false;
    }

    // Populate hospital oblast filter select
    populateOblastFilter();

    // Render left sidebar
    renderSidebar();

    // Setup Event Listeners
    setupListeners();

    // Select initial package
    selectInitialPackage();

  } catch (err) {
    console.error("Помилка завантаження даних для паспорта:", err);
    el("sidebarPackageList").innerHTML = `<div class="sidebar-empty" style="color: #c0392b;">Помилка завантаження даних</div>`;
  }
}

// Populate Oblast Dropdown from Contracts
function populateOblastFilter() {
  const oblasts = new Set();
  if (passportState.contractsData && passportState.contractsData.contracts) {
    passportState.contractsData.contracts.forEach(c => {
      if (c.oblast) oblasts.add(c.oblast);
    });
  }
  const select = el("hospitalOblastFilter");
  select.innerHTML = '<option value="">Усі області</option>';
  [...oblasts].sort((a, b) => a.localeCompare(b, "uk")).forEach(ob => {
    const opt = document.createElement("option");
    opt.value = ob;
    opt.textContent = ob;
    select.appendChild(opt);
  });
}

// Left Sidebar Rendering
function renderSidebar(query = "") {
  const container = el("sidebarPackageList");
  container.innerHTML = "";

  const filtered = passportState.packages.filter(pkg => {
    if (!query) return true;
    const q = query.toLowerCase().trim();
    return pkg.number.includes(q) || pkg.title.toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="sidebar-empty">Нічого не знайдено</div>`;
    return;
  }

  filtered.forEach(pkg => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "sidebar-pkg-card";
    if (passportState.selectedPackage && passportState.selectedPackage.number === pkg.number) {
      card.classList.add("active");
    }

    const metadata = passportState.contractsData.package_metadata[pkg.number] || {};
    const direction = metadata.direction || "Без напряму";

    card.innerHTML = `
      <div class="sidebar-pkg-num">${pkg.number}</div>
      <div class="sidebar-pkg-info">
        <strong class="sidebar-pkg-name" title="${escapeHtml(pkg.title)}">${escapeHtml(pkg.title)}</strong>
        <span class="sidebar-pkg-desc" title="${escapeHtml(direction)}">${escapeHtml(direction)}</span>
      </div>
    `;

    card.addEventListener("click", () => {
      selectPackage(pkg.number);
    });

    container.appendChild(card);
  });
}

// Select Package Logic
function selectPackage(pkgNum) {
  const pkg = passportState.packages.find(p => p.number === pkgNum);
  if (!pkg) return;

  passportState.selectedPackage = pkg;

  // Update sidebar active classes
  document.querySelectorAll(".sidebar-pkg-card").forEach(card => {
    const num = card.querySelector(".sidebar-pkg-num").textContent;
    card.classList.toggle("active", num === pkgNum);
  });

  // Switch display from welcome state
  el("passportWelcome").style.display = "none";
  el("passportContent").style.display = "block";

  // Reset hospital table state
  passportState.hospitalSearch = "";
  passportState.hospitalOblast = "";
  passportState.hospitalSortField = "sum";
  passportState.hospitalSortDesc = true;
  passportState.hospitalCurrentPage = 1;
  el("hospitalSearchInput").value = "";
  el("hospitalOblastFilter").value = "";
  // Перелік ЗОЗ схлопнутий за замовчуванням — розгортається кнопкою або
  // кліком по регіону в теплокарті
  const hospitalsBox = el("hospitalsCollapse");
  if (hospitalsBox) hospitalsBox.open = false;

  // Render passport sections
  renderHeaderAndMetrics();
  renderAnalytics();
  renderHospitalsTable();
  renderRequirements();
  renderTariffs();
  renderExplanations();
  renderDecDocuments();

  // Sync URL parameters
  const params = new URLSearchParams(window.location.search);
  params.set("package", pkgNum);
  window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
}

// Номери пілотних напрямів — це внутрішня нумерація НСЗУ/ЕСОЗ, у постанові 1808
// таких пакетів немає. Раніше ?package=66 мовчки відкривав пакет 1 і людина
// читала «Первинну медичну допомогу» замість зубопротезування ветеранів.
const PILOT_PACKAGES = {
  "66": "Зубопротезування окремих категорій осіб, які захищають/захищали незалежність України",
  "67": "Стоматологічна допомога окремій категорії осіб, які захищають/захищали незалежність України",
  "71": "Забір, кріоконсервація та зберігання репродуктивних клітин",
  "73": "Розширені послуги з первинної медичної допомоги",
  "84": "Довготривалий медсестринський догляд внутрішньо переміщених осіб",
  "87": "Довготривалий медичний догляд окремим категоріям осіб",
};

function selectInitialPackage() {
  const params = new URLSearchParams(window.location.search);
  const pkgNum = params.get("package");
  if (pkgNum && passportState.packages.some(p => p.number === pkgNum)) {
    selectPackage(pkgNum);
    return;
  }
  if (pkgNum && PILOT_PACKAGES[pkgNum]) {
    showPilotNotice(pkgNum);
    return;
  }
  if (pkgNum) {
    showUnknownPackageNotice(pkgNum);
    return;
  }
  if (passportState.packages.length > 0) {
    selectPackage(passportState.packages[0].number);
  }
}

/** Запитаний номер — пілотний напрям: ведемо туди, де він насправді описаний. */
function showPilotNotice(pkgNum) {
  const welcome = el("passportWelcome");
  if (!welcome) return;
  welcome.style.display = "";
  el("passportContent").style.display = "none";
  welcome.innerHTML = `
    <div class="welcome-box">
      <div class="welcome-icon">🧪</div>
      <h2>№ ${escapeHtml(pkgNum)} — це пілотний проєкт, а не пакет ПМГ</h2>
      <p>«${escapeHtml(PILOT_PACKAGES[pkgNum])}» закуповується окремою постановою Кабінету Міністрів,
         поза постановою № 1808, тому паспорта пакета в нього немає.</p>
      <p><a class="passport-btn btn-excel" href="../pilots/index.html?p=${encodeURIComponent(pkgNum)}">
        Відкрити напрям у розділі «Пілотні проєкти»</a></p>
    </div>`;
}

/** Номер, якого немає ні серед пакетів, ні серед пілотів. */
function showUnknownPackageNotice(pkgNum) {
  const welcome = el("passportWelcome");
  if (!welcome) return;
  welcome.style.display = "";
  el("passportContent").style.display = "none";
  welcome.innerHTML = `
    <div class="welcome-box">
      <div class="welcome-icon">❓</div>
      <h2>Пакета № ${escapeHtml(pkgNum)} немає у ПМГ-2026</h2>
      <p>У постанові № 1808 такого номера немає. Оберіть пакет зі списку ліворуч.</p>
    </div>`;
}

// ── Header & Key Metrics ──────────────────────────────────────
function renderHeaderAndMetrics() {
  const pkg = passportState.selectedPackage;
  const meta = passportState.contractsData.package_metadata[pkg.number] || {};
  
  // Headers
  el("passportTitle").textContent = `Пакет ${pkg.number}: ${pkg.title}`;
  el("passportDirection").textContent = meta.direction || "Не визначено";
  el("passportHelpType").textContent = meta.help_type || "Не визначено";
  el("passportProgram").textContent = meta.financing_program || "ПМГ";

  // Filtered contracts for metrics
  const pContracts = passportState.contractsData.contracts.filter(c => 
    c.packages.some(p => p.package_num === pkg.number)
  );

  const totalSum = pContracts.reduce((sum, c) => {
    const pInfo = c.packages.find(p => p.package_num === pkg.number);
    return sum + (pInfo ? pInfo.sum : 0);
  }, 0);

  // Indicators
  el("indTotalSum").textContent = formatCurrency(totalSum);
  el("indProvidersCount").textContent = pContracts.length;

  // Linked Clarifications Count
  const groupCodes = PACKAGE_GROUPS[pkg.number.padStart(2, '0')] || [];
  const linkedDocs = passportState.explanations.filter(doc => 
    pkg.related_document_ids.includes(doc.id) || groupCodes.includes(doc.package)
  );
  el("indExplanationsCount").textContent = linkedDocs.length;

  // Clinical Protocols Count
  const linkedCategories = getLinkedCategoriesForPackage(pkg.number);
  const decDocs = passportState.decDocuments.filter(doc => linkedCategories.includes(doc.category));
  el("indDecCount").textContent = decDocs.length;
}

// ── Tab 1: Analytics — «Термометр роботи пакету» ──────────────
// Зведення по ВСІХ пакетах для перцентилів термометра. Рахується один раз
// після завантаження договорів і кешується.
function getPkgBenchmarks() {
  if (passportState._bench) return passportState._bench;
  const perPkg = new Map();
  const oblasts = new Set();
  passportState.contractsData.contracts.forEach(c => {
    if (c.oblast) oblasts.add(c.oblast);
    c.packages.forEach(p => {
      if (!p.package_num) return;
      let s = perPkg.get(p.package_num);
      if (!s) { s = { n: 0, sum: 0, obl: new Set() }; perPkg.set(p.package_num, s); }
      s.n++;
      s.sum += p.sum;
      if (c.oblast) s.obl.add(c.oblast);
    });
  });
  // У чергу порівняння беремо лише пакети постанови 1808 (ті, що мають
  // паспорт). У вивантажці є ще реімбурсація й пілотні проєкти — там
  // «закладами» є тисячі аптек, і вони нечесно виштовхують лікарняні пакети
  // вниз черги (хірургія була «місце 25 із 70», а серед своїх — 8 із 46).
  const valid = new Set(passportState.packages.map(p => p.number));
  [...perPkg.keys()].forEach(num => { if (!valid.has(num)) perPkg.delete(num); });
  const counts = [...perPkg.values()].map(s => s.n).sort((a, b) => a - b);
  const sums = [...perPkg.values()].map(s => s.sum).filter(v => v > 0).sort((a, b) => a - b);
  const totalPMG = sums.reduce((a, b) => a + b, 0);
  // Лідер за кількістю закладів — для живого прикладу в підказці
  let maxPkg = { num: "", n: 0 };
  perPkg.forEach((s, num) => { if (s.n > maxPkg.n) maxPkg = { num, n: s.n }; });
  passportState._bench = {
    perPkg,
    counts,
    sums,
    totalPMG,
    maxPkg,
    pkgCount: perPkg.size,
    allOblasts: [...oblasts].sort((a, b) => a.localeCompare(b, "uk")),
  };
  return passportState._bench;
}

// Частка значень вибірки, що не перевищують v (перцентиль, 0–100)
function percentileOf(sortedArr, v) {
  if (!sortedArr.length) return 0;
  let i = 0;
  while (i < sortedArr.length && sortedArr[i] <= v) i++;
  return (i / sortedArr.length) * 100;
}

function formatMoneyShort(v) {
  if (!v) return "—";
  const fmt = (x, d) => x.toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: d });
  if (v >= 1e9) return `${fmt(v / 1e9, 2)} млрд ₴`;
  if (v >= 1e6) return `${fmt(v / 1e6, 1)} млн ₴`;
  if (v >= 1e3) return `${fmt(v / 1e3, 0)} тис ₴`;
  return formatCurrency(v);
}

// «ІВАНО-ФРАНКІВСЬКА» → «Івано-Франківська», «М.КИЇВ» → «м. Київ»
function oblastDisplay(o) {
  if (o === "М.КИЇВ") return "м. Київ";
  return o.toLowerCase().replace(/(^|[-\s])(\S)/gu, (m, p, ch) => p + ch.toUpperCase());
}

// Плавний «набіг» числа в лічильнику. На прихованій вкладці rAF не тікає,
// тому там одразу ставимо фінальне значення — інакше лишається «0».
function animateCount(node, target, formatter) {
  const dur = 900;
  const t0 = performance.now();
  const fmt = formatter || (v => Math.round(v).toLocaleString("uk-UA"));
  if (document.hidden) { node.textContent = fmt(target); return; }
  function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(target * eased);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Відсоток у нашій типографіці: десяткова кома, один знак після неї
function pctUk(v) {
  return v.toFixed(1).replace(".", ",") + "%";
}

const THERMO_BANDS = [
  { min: 75, icon: "🔥", label: "Гарячий", desc: "пакет-гігант: працює масово по всій країні", color: "#e0532f" },
  { min: 50, icon: "☀️", label: "Теплий", desc: "великий пакет із широкою мережею закладів", color: "#f0a03c" },
  { min: 25, icon: "🌤️", label: "Помірний", desc: "середній масштаб: працює стабільно, але не всюди", color: "#54ad84" },
  { min: 0,  icon: "❄️", label: "Прохолодний", desc: "вузькоспеціалізований: мала мережа — так і задумано", color: "#4a8fc7" },
];

const DONUT_PALETTE = ["#4a8fc7", "#54ad84", "#f0a03c", "#e0532f", "#8b6cc7", "#c75c8f", "#64748b"];
const NETWORK_COLORS = {
  "Надкластерний": "#8b6cc7",
  "Кластерний": "#4a8fc7",
  "Загальний": "#54ad84",
  "Не входить в спроможну мережу": "#94a3b8",
};

function renderDonut(container, entries) {
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (!total) {
    container.innerHTML = `<div class="no-results">Немає даних</div>`;
    return;
  }
  let acc = 0;
  const stops = entries.map(e => {
    const from = (acc / total) * 360;
    acc += e.value;
    return `${e.color} ${from}deg ${(acc / total) * 360}deg`;
  }).join(", ");
  container.innerHTML = `
    <div class="donut" style="background: conic-gradient(${stops})">
      <div class="donut-hole"><strong>${total.toLocaleString("uk-UA")}</strong><span>ЗОЗ</span></div>
    </div>
    <div class="donut-legend">
      ${entries.map(e => `
        <div class="dl-row">
          <span class="dl-chip" style="background:${e.color}"></span>
          <span class="dl-label" title="${escapeHtml(e.label)}">${escapeHtml(e.label)}</span>
          <span class="dl-val">${e.value.toLocaleString("uk-UA")} · ${pctUk(e.value / total * 100)}</span>
        </div>`).join("")}
    </div>`;
}

function kpiTileHtml(icon, label, valueHtml, sub, id = "") {
  return `
    <div class="kpi-tile">
      <div class="kpi-head"><span class="kpi-icon">${icon}</span><span class="kpi-label">${escapeHtml(label)}</span></div>
      <div class="kpi-value"${id ? ` id="${id}"` : ""}>${valueHtml}</div>
      <div class="kpi-sub">${escapeHtml(sub)}</div>
    </div>`;
}

function renderAnalytics() {
  const pkg = passportState.selectedPackage;
  const bench = getPkgBenchmarks();
  const pContracts = passportState.contractsData.contracts.filter(c =>
    c.packages.some(p => p.package_num === pkg.number)
  );

  const getPkgSum = (c) => {
    const pInfo = c.packages.find(p => p.package_num === pkg.number);
    return pInfo ? pInfo.sum : 0;
  };

  const totalSum = pContracts.reduce((sum, c) => sum + getPkgSum(c), 0);
  const noSums = totalSum === 0;

  // ── Складові температури ──
  const oblMap = {};
  pContracts.forEach(c => {
    const o = c.oblast || "";
    if (!oblMap[o]) oblMap[o] = { count: 0, sum: 0 };
    oblMap[o].count++;
    oblMap[o].sum += getPkgSum(c);
  });
  const oblCovered = Object.keys(oblMap).filter(Boolean).length;
  const oblTotal = bench.allOblasts.length;

  const coverage = oblTotal ? (oblCovered / oblTotal) * 100 : 0;
  const netPct = percentileOf(bench.counts, pContracts.length);
  const budPct = noSums ? null : percentileOf(bench.sums, totalSum);
  const temp = Math.round(budPct === null
    ? coverage * 0.55 + netPct * 0.45
    : coverage * 0.40 + netPct * 0.35 + budPct * 0.25);
  const band = THERMO_BANDS.find(b => temp >= b.min) || THERMO_BANDS[3];

  const hero = el("thermoHero");
  hero.style.setProperty("--thermo-color", band.color);

  // Ртутний стовпчик: висота = температура (перезапуск анімації через reflow)
  const mercury = el("thermoMercury");
  mercury.style.transition = "none";
  mercury.style.height = "0%";
  void mercury.offsetHeight;
  mercury.style.transition = "";
  mercury.style.height = `${Math.max(temp, 3)}%`;

  animateCount(el("thermoTemp"), temp, v => `${Math.round(v)}°`);
  el("thermoVerdict").innerHTML =
    `<span class="verdict-badge">${band.icon} ${band.label}</span><span class="verdict-desc">${escapeHtml(band.desc)}</span>`;

  // Три складові індексу; title — пояснення людською мовою
  const compRow = (icon, label, pct, valText, tip) => `
    <div class="comp-row" title="${escapeHtml(tip)}">
      <span class="comp-label">${icon} ${escapeHtml(label)}</span>
      <div class="comp-track"><div class="comp-fill" style="width:${Math.max(pct, 1.5)}%"></div></div>
      <span class="comp-val">${escapeHtml(valText)}</span>
    </div>`;
  const rank = 1 + [...bench.perPkg.values()].filter(s => s.n > pContracts.length).length;
  const sharePMG = bench.totalPMG > 0 ? (totalSum / bench.totalPMG) * 100 : 0;
  el("thermoComponents").innerHTML =
    compRow("🗺️", "Покриття регіонів", coverage, `${oblCovered} з ${oblTotal}`,
      `У скількох із ${oblTotal} регіонів є хоча б один заклад із договором за цим пакетом. ` +
      `${oblCovered} з ${oblTotal}: ${oblCovered === oblTotal ? "пакет доступний по всій країні" : `у ${oblTotal - oblCovered} регіонах закладів немає`}.`) +
    compRow("🏥", "Мережа закладів", netPct, `місце ${rank} із ${bench.pkgCount}`,
      `Договір за цим пакетом мають ${pContracts.length.toLocaleString("uk-UA")} закладів. ` +
      `Якщо вишикувати всі ${bench.pkgCount} пакетів постанови № 1808 за кількістю закладів — від найбільшого до найменшого, ` +
      (rank === 1 ? "цей пакет стоїть першим: найширша мережа в усій ПМГ."
                  : `цей пакет стоїть на ${rank}-му місці. Перший у черзі — пакет ${bench.maxPkg.num} (${bench.maxPkg.n.toLocaleString("uk-UA")} закладів).`) +
      ` Реімбурсація (аптеки) та пілотні проєкти в порівнянні участі не беруть.`) +
    compRow("💰", "Фінансова вага", budPct ?? 0,
      noSums ? "немає даних" : `${sharePMG < 0.1 ? "<0,1" : sharePMG.toFixed(1).replace(".", ",")}% ПМГ`,
      noSums ? "У вивантажці за цим пакетом сум немає, складова не рахується."
             : `Яка частка всіх грошей ПМГ іде через цей пакет — тут ${sharePMG < 0.1 ? "менш як 0,1" : sharePMG.toFixed(1).replace(".", ",")} %.`);

  // ── KPI-плитки ──
  const sums = pContracts.map(getPkgSum).filter(v => v > 0).sort((a, b) => a - b);
  const median = sums.length
    ? (sums.length % 2 ? sums[(sums.length - 1) / 2] : (sums[sums.length / 2 - 1] + sums[sums.length / 2]) / 2)
    : 0;
  const top5 = sums.slice(-5).reduce((a, b) => a + b, 0);
  const top5Share = totalSum > 0 ? (top5 / totalSum) * 100 : 0;

  el("thermoKpis").innerHTML =
    kpiTileHtml("🏥", "ЗОЗ у мережі", "0", `місце ${rank} із ${bench.pkgCount} пакетів постанови 1808 за кількістю закладів`, "kpiProviders") +
    kpiTileHtml("💰", "Бюджет пакета", escapeHtml(formatMoneyShort(totalSum)),
      noSums ? "у вивантажці суми за пакетом відсутні" : `${sharePMG < 0.1 ? "менш як 0,1" : sharePMG.toFixed(1).replace(".", ",")} % усієї ПМГ`) +
    kpiTileHtml("🗺️", "Покриття регіонів", `${oblCovered} <small>з ${oblTotal}</small>`,
      oblCovered === oblTotal ? "заклади в усіх регіонах" : `немає закладів у ${oblTotal - oblCovered} регіонах`) +
    kpiTileHtml("⚖️", "Медіанний договір", escapeHtml(formatMoneyShort(median)),
      noSums ? "у вивантажці суми за пакетом відсутні" : "типова сума на один заклад") +
    kpiTileHtml("🎯", "Концентрація топ-5", noSums ? "—" : `${Math.round(top5Share)}<small>%</small>`,
      noSums ? "у вивантажці суми за пакетом відсутні" : "бюджету пакета — у пʼяти найбільших ЗОЗ");
  animateCount(el("kpiProviders"), pContracts.length);

  // ── Примітка про формулу ──
  el("thermoFootnote").textContent =
    `Температура вимірює масштаб роботи пакета, а не його якість: покриття регіонів (40 %), мережа закладів (35 %) і фінансова вага (25 %); ` +
    `дві останні складові — місце пакета серед ${bench.pkgCount} пакетів постанови № 1808 (реімбурсацію та пілотні проєкти в порівняння не беремо). ` +
    `100° набирав би пакет, який працює в усіх регіонах і є найбільшим за мережею та грошима; вузький пакет із кількома центрами буде «прохолодним» — і це його нормальний режим.` +
    (noSums ? " Для цього пакета вивантажка не передає сум (реімбурсація або новий пакет), тому індекс пораховано з двох складових (55/45)." : "");

  // ── Теплокарта регіонів ──
  const maxObl = Math.max(1, ...Object.values(oblMap).map(v => v.count));
  const heat = el("regionHeatmap");
  heat.innerHTML = bench.allOblasts.map(o => {
    const d = oblMap[o];
    const count = d ? d.count : 0;
    const ratio = count / maxObl;
    const tip = d
      ? `${oblastDisplay(o)} — ${count} ЗОЗ${d.sum > 0 ? ` · ${formatMoneyShort(d.sum)}` : ""}`
      : `${oblastDisplay(o)} — закладів немає`;
    return `
      <button type="button" class="region-tile${count ? "" : " empty"}${ratio > 0.55 ? " heat-high" : ""}"
              style="--heat:${ratio.toFixed(3)}" data-oblast="${escapeHtml(o)}" title="${escapeHtml(tip)}" ${count ? "" : "disabled"}>
        <span class="rt-name">${escapeHtml(oblastDisplay(o))}</span>
        <span class="rt-count">${count}</span>
      </button>`;
  }).join("");
  heat.querySelectorAll(".region-tile:not(.empty)").forEach(tile => {
    tile.addEventListener("click", () => {
      const o = tile.dataset.oblast;
      passportState.hospitalOblast = o;
      passportState.hospitalCurrentPage = 1;
      el("hospitalOblastFilter").value = o;
      const box = el("hospitalsCollapse");
      box.open = true;
      renderHospitalsTable();
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // ── Донати: власність і спроможна мережа ──
  const ownMap = {};
  pContracts.forEach(c => {
    const own = c.ownership || "Інші форми";
    ownMap[own] = (ownMap[own] || 0) + 1;
  });
  renderDonut(el("ownershipDonut"),
    Object.keys(ownMap).sort((a, b) => ownMap[b] - ownMap[a])
      .map((own, i) => ({ label: own, value: ownMap[own], color: DONUT_PALETTE[i % DONUT_PALETTE.length] })));

  const netMap = {};
  pContracts.forEach(c => {
    const net = c.network_type || "Не входить в спроможну мережу";
    netMap[net] = (netMap[net] || 0) + 1;
  });
  const netOrder = ["Надкластерний", "Кластерний", "Загальний", "Не входить в спроможну мережу"];
  renderDonut(el("networkDonut"),
    netOrder.filter(net => netMap[net])
      .map(net => ({
        label: net === "Не входить в спроможну мережу" ? "Поза спроможною мережею" : net,
        value: netMap[net],
        color: NETWORK_COLORS[net] || "#64748b",
      })));

  // ── Топ-10 надавачів ──
  const topCard = el("topProvidersCard");
  const topBox = el("topProviders");
  if (noSums) {
    topCard.style.display = "none";
  } else {
    topCard.style.display = "";
    const ranked = [...pContracts].sort((a, b) => getPkgSum(b) - getPkgSum(a)).slice(0, 10);
    const maxSum = getPkgSum(ranked[0]) || 1;
    const medals = ["🥇", "🥈", "🥉"];
    topBox.innerHTML = ranked.map((c, i) => {
      const s = getPkgSum(c);
      return `
        <div class="top-provider-row">
          <span class="tp-rank">${medals[i] || (i + 1)}</span>
          <div class="tp-body">
            <div class="bar-labels">
              <span class="bar-name" title="${escapeHtml(c.provider_name_full || c.provider_name)}">${escapeHtml(c.provider_name)}
                <small class="tp-place">📍 ${escapeHtml(c.settlement)}</small></span>
              <span class="bar-val">${formatCurrency(s)} · ${pctUk(s / totalSum * 100)}</span>
            </div>
            <div class="bar-track"><div class="bar-fill tp-fill" style="width:${(s / maxSum * 100).toFixed(1)}%"></div></div>
          </div>
        </div>`;
    }).join("");
  }

  // Лічильник у схлопнутому переліку ЗОЗ
  const cnt = el("hospitalsCount");
  if (cnt) cnt.textContent = pContracts.length.toLocaleString("uk-UA");
}

// Hospitals List Filters & Sort
function getFilteredHospitals() {
  const pkg = passportState.selectedPackage;
  if (!pkg) return [];

  const getPkgSum = (c) => {
    const pInfo = c.packages.find(p => p.package_num === pkg.number);
    return pInfo ? pInfo.sum : 0;
  };

  let list = passportState.contractsData.contracts.filter(c => 
    c.packages.some(p => p.package_num === pkg.number)
  );

  // Region Filter
  if (passportState.hospitalOblast) {
    list = list.filter(c => c.oblast === passportState.hospitalOblast);
  }

  // Text Filter
  if (passportState.hospitalSearch) {
    const q = passportState.hospitalSearch.toLowerCase().trim();
    list = list.filter(c => 
      c.provider_name.toLowerCase().includes(q) ||
      c.provider_name_full.toLowerCase().includes(q) ||
      c.edrpou.includes(q) ||
      c.settlement.toLowerCase().includes(q)
    );
  }

  // Sort
  list.sort((left, right) => {
    let a = left[passportState.hospitalSortField];
    let b = right[passportState.hospitalSortField];

    if (passportState.hospitalSortField === "sum") {
      a = getPkgSum(left);
      b = getPkgSum(right);
    } else if (passportState.hospitalSortField === "name") {
      a = left.provider_name || "";
      b = right.provider_name || "";
    } else if (passportState.hospitalSortField === "network") {
      a = left.network_type || "";
      b = right.network_type || "";
    }

    if (typeof a === "string") {
      return passportState.hospitalSortDesc 
        ? b.localeCompare(a, "uk") 
        : a.localeCompare(b, "uk");
    } else {
      return passportState.hospitalSortDesc ? b - a : a - b;
    }
  });

  return list;
}

function renderHospitalsTable() {
  const list = getFilteredHospitals();
  const pkg = passportState.selectedPackage;
  const tbody = el("hospitalsTableBody");
  tbody.innerHTML = "";

  const getPkgSum = (c) => {
    const pInfo = c.packages.find(p => p.package_num === pkg.number);
    return pInfo ? pInfo.sum : 0;
  };

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="no-results">За цими умовами закладів не знайдено</td></tr>`;
    el("tablePagination").innerHTML = "";
    return;
  }

  // Paginated chunk
  const totalItems = list.length;
  const totalPages = Math.ceil(totalItems / passportState.hospitalPageSize);
  
  if (passportState.hospitalCurrentPage > totalPages) {
    passportState.hospitalCurrentPage = totalPages || 1;
  }

  const startIdx = (passportState.hospitalCurrentPage - 1) * passportState.hospitalPageSize;
  const endIdx = Math.min(startIdx + passportState.hospitalPageSize, totalItems);
  const pageItems = list.slice(startIdx, endIdx);

  pageItems.forEach(c => {
    const tr = document.createElement("tr");

    let netClass = "tag";
    if (c.network_type === "Надкластерний") netClass = "tag file";
    else if (c.network_type === "Кластерний") netClass = "tag";
    else if (c.network_type === "Загальний") netClass = "tag";

    const contactsHtml = c.email 
      ? `<a href="mailto:${escapeHtml(c.email)}" style="text-decoration:none;color:var(--accent-dark);font-weight:600;">${escapeHtml(c.email)}</a>` 
      : '<span style="color:var(--muted)">—</span>';

    tr.innerHTML = `
      <td><strong>${escapeHtml(c.edrpou)}</strong></td>
      <td title="${escapeHtml(c.provider_name_full || c.provider_name)}"><strong>${escapeHtml(c.provider_name)}</strong><br><small style="color:var(--muted)">📍 ${escapeHtml(c.settlement)}</small></td>
      <td>${escapeHtml(c.oblast)}</td>
      <td><span class="${netClass}">${escapeHtml(c.network_type || "Заклад")}</span></td>
      <td><span class="tag" style="background:#f1f5f9;color:#475569;">${escapeHtml(c.ownership)}</span></td>
      <td class="num-cell"><strong>${formatCurrency(getPkgSum(c))}</strong></td>
      <td>${contactsHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  // Render pagination controls
  renderTablePagination(totalItems, totalPages, startIdx + 1, endIdx);
}

function renderTablePagination(totalItems, totalPages, fromItem, toItem) {
  const container = el("tablePagination");
  container.innerHTML = "";

  const infoSpan = document.createElement("span");
  infoSpan.className = "pagination-info";
  infoSpan.innerHTML = `Показано <strong>${fromItem}-${toItem}</strong> з <strong>${totalItems}</strong> закладів`;
  container.appendChild(infoSpan);

  const btnRow = document.createElement("div");
  btnRow.className = "pagination-btn-row";

  // Prev Button
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "page-btn";
  prevBtn.textContent = "«";
  prevBtn.disabled = passportState.hospitalCurrentPage === 1;
  prevBtn.addEventListener("click", () => {
    passportState.hospitalCurrentPage--;
    renderHospitalsTable();
  });
  btnRow.appendChild(prevBtn);

  // Quick page buttons
  const startPage = Math.max(1, passportState.hospitalCurrentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);

  for (let i = startPage; i <= endPage; i++) {
    const pBtn = document.createElement("button");
    pBtn.type = "button";
    pBtn.className = `page-btn ${i === passportState.hospitalCurrentPage ? 'active' : ''}`;
    pBtn.textContent = i;
    pBtn.addEventListener("click", () => {
      passportState.hospitalCurrentPage = i;
      renderHospitalsTable();
    });
    btnRow.appendChild(pBtn);
  }

  // Next Button
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "page-btn";
  nextBtn.textContent = "»";
  nextBtn.disabled = passportState.hospitalCurrentPage === totalPages;
  nextBtn.addEventListener("click", () => {
    passportState.hospitalCurrentPage++;
    renderHospitalsTable();
  });
  btnRow.appendChild(nextBtn);

  container.appendChild(btnRow);
}

// ── Tab 2: Requirements (Specification Accordion) ────────────
const SECTION_LABELS = {
  "specification": "Що входить у пакет (специфікація)",
  "conditions": "Умови надання послуг",
  "grounds": "Підстави надання послуг",
  "organization": "Вимоги до організації надання послуг",
  "specialists": "Вимоги до спеціалістів",
  "equipment": "Вимоги до переліку обладнання",
  "other": "Інші вимоги закупівлі",
};

// Лічильник рендерів вимог: мітка для шару норм (див. decorateNorms).
let requirementsRenderSeq = 0;

function renderRequirements() {
  const pkg = passportState.selectedPackage;
  const container = el("specAccordion");
  container.innerHTML = "";
  container.dataset.renderToken = `${pkg && pkg.number}#${++requirementsRenderSeq}`;
  delete container.dataset.normsDone;

  if (!pkg.units || pkg.units.length === 0) {
    container.innerHTML = `<div class="no-results">Вимоги закупівлі відсутні або знаходяться в процесі обробки.</div>`;
    return;
  }

  pkg.units.forEach((unit, uIdx) => {
    // Show unit header if there are multiple units in the package
    if (pkg.units.length > 1) {
      const uHead = document.createElement("h3");
      uHead.style.cssText = "font-size: 15px; font-weight: 800; color: var(--ink); margin: 24px 0 10px; border-bottom: 2px solid var(--line); padding-bottom: 8px;";
      uHead.textContent = unit.label || `Блок послуг ${uIdx + 1}`;
      container.appendChild(uHead);
    }

    unit.sections.forEach(section => {
      const group = document.createElement("details");
      group.className = "spec-group";
      // Auto open first section
      if (uIdx === 0 && section.key === "specification") {
        group.open = true;
      }

      const summary = document.createElement("summary");
      summary.innerHTML = `<span>${escapeHtml(SECTION_LABELS[section.key] || section.label)}</span>`;
      group.appendChild(summary);

      const contentDiv = document.createElement("div");
      contentDiv.className = "spec-group-content";

      if (section.source_heading) {
        const h = document.createElement("div");
        h.className = "spec-section-heading";
        h.textContent = section.source_heading;
        contentDiv.appendChild(h);
      }

      if (section.items && section.items.length > 0) {
        const listDiv = document.createElement("div");
        listDiv.className = "spec-items-list";

        // У блоках «Спеціалісти» й «Обладнання» назви ведуть на паспорт
        // довідника — характеристику ДКХП-78 або картку виробу
        // (координати дає spec-links.js).
        const linked = window.SpecLinks && window.SpecLinks.KINDS.includes(section.key)
          && window.SpecLinks.has(pkg.number, section.key);

        section.items.forEach((item, iIdx) => {
          const itemDiv = document.createElement("div");
          const level = Math.min(item.level || 0, 3);
          itemDiv.className = `spec-item level-${level}`;
          // координати пункту для шару нормативного підкріплення (norm-links.js);
          // відбиток тексту знімаємо тут, з чистого item.text — ДО SpecLinks,
          // який домальовує в DOM мітки кодів ЕСОЗ і ламає звірку по тексту
          itemDiv.dataset.sec = section.key;
          itemDiv.dataset.ord = String(iIdx + 1);
          if (window.NormLinks) itemDiv.dataset.nk = window.NormLinks.key(item.text);

          const marker = item.marker ? `<span class="spec-item-marker">${escapeHtml(item.marker)}</span>` : "";
          const body = linked
            ? window.SpecLinks.render(item.text, pkg.number, escapeHtml, section.key)
            : escapeHtml(item.text);
          itemDiv.innerHTML = `${marker}<span>${body}</span>`;
          listDiv.appendChild(itemDiv);
        });

        contentDiv.appendChild(listDiv);
      } else {
        contentDiv.innerHTML += `<p style="font-size: 13.5px; color: var(--muted); margin: 10px 0 0 0;">Окремі деталізовані пункти в цьому розділі відсутні.</p>`;
      }

      group.appendChild(contentDiv);
      container.appendChild(group);
    });
  });

  decorateNorms(pkg.number, container);
}

// ── Шар нормативного підкріплення ─────────────────────────────
// Дорисовує до кожного пункту рівень A/B/C/D і норму, на якій він стоїть.
// Працює після рендера: якщо даних для пакета немає, вкладка лишається як була.
//
// ⚠ Мітка «вже намальовано» — НЕ номер пакета, а номер рендера (renderToken).
// Номер пакета тут не годиться: `container.innerHTML = ""` стирає пункти, але
// не dataset самого контейнера, тож при повторному відкритті ТОГО САМОГО
// пакета мітка лишалася, шар мовчки не малювався, і людина бачила вимоги без
// значків A/B/C/D. Токен ставить renderRequirements на кожному рендері, тому:
//   * новий рендер → нова мітка → шар малюється знову;
//   * поки вантажилися дані, встиг перемалюватися інший пакет → токен уже
//     чужий, і ми не садимо на нову розмітку норми старого пакета.
async function decorateNorms(pkgNum, container) {
  if (!window.NormLinks) return;
  const token = container.dataset.renderToken || "";
  const data = await window.NormLinks.load(pkgNum);
  if (!data) return;
  if (container.dataset.renderToken !== token) return;
  if (container.dataset.normsDone === token) return;
  container.dataset.normsDone = token;

  const legend = document.createElement("div");
  legend.innerHTML = window.NormLinks.legend(data);
  container.prepend(legend.firstElementChild);

  let shown = 0, skipped = 0;
  container.querySelectorAll(".spec-item[data-sec]").forEach(div => {
    const text = div.querySelector("span:last-child")?.textContent || "";
    const e = window.NormLinks.entry(data, div.dataset.sec, Number(div.dataset.ord), text, div.dataset.nk);
    if (!e) { skipped++; return; }
    div.insertAdjacentHTML("afterbegin", window.NormLinks.badge(e));
    div.insertAdjacentHTML("beforeend", window.NormLinks.panel(e));
    div.classList.add("has-norm");
    shown++;
  });
  if (skipped) {
    console.info(`NormLinks: пакет ${pkgNum} — прив'язано ${shown}, пропущено ${skipped} ` +
                 `(текст пункту не збігся з відбитком — дані треба перезібрати).`);
  }
  // валідація прив'язок експертами (✓/✗ + пропозиції норм, Supabase)
  if (window.NormLinks.votes) window.NormLinks.votes.init(pkgNum, container);
}

// ── Tab 3: Tariffs (Resolution 1808) ──────────────────────────
function renderTariffs() {
  const pkg = passportState.selectedPackage;
  const container = el("tariffsContainer");
  container.innerHTML = "";

  if (!passportState.resolution) {
    container.innerHTML = `<div class="no-results">Постанова 1808 не завантажена або відсутня.</div>`;
    return;
  }

  // Find all parts/chapters/appendices where package_numbers contains pkg.number
  const matchedNodes = [];
  const allNodes = [
    ...(passportState.resolution.parts || []),
    ...(passportState.resolution.chapters || []),
    ...(passportState.resolution.appendices || [])
  ];

  allNodes.forEach(node => {
    if (node.package_numbers && node.package_numbers.includes(pkg.number)) {
      matchedNodes.push(node);
    }
  });

  if (matchedNodes.length === 0) {
    container.innerHTML = `<div class="no-results">Окремих тарифних норм та умов оплати для цього пакета в Постанові № 1808 не виявлено. Діють загальні умови оплати за Порядком.</div>`;
    return;
  }

  matchedNodes.forEach(node => {
    const card = document.createElement("div");
    card.className = "tariff-block";

    const labelKind = node.kind === "chapter" ? "Тарифна глава" : (node.kind === "appendix" ? "Додаток" : "Загальний розділ");
    const source = node.legal_document || "Порядок реалізації ПМГ";
    const pages = node.page_start === node.page_end ? `стор. ${node.page_start}` : `стор. ${node.page_start}-${node.page_end}`;

    const tagsHtml = (node.types || []).map(t => {
      const lbl = passportState.resolution.type_labels[t] || t;
      return `<span class="tag" style="margin-right:4px;">${escapeHtml(lbl)}</span>`;
    }).join("");

    let contentHtml = "";
    if (node.kind === "appendix" && node.id !== "appendix-3") {
      // Split and render tables or text for appendices
      const parsed = splitAppendixTable(node.text);
      if (parsed.rows && parsed.rows.length > 0) {
        contentHtml = `
          <p style="font-size: 13.5px; line-height: 1.5; color: var(--ink); margin-bottom: 12px;">${escapeHtml(parsed.intro)}</p>
          <div class="table-wrap">
            <table class="hospitals-table" style="font-size:12px;">
              <thead>
                <tr>
                  <th>Код ДСГ</th>
                  <th>Назва послуги / діагностичної групи</th>
                  <th>Коефіцієнт(и)</th>
                </tr>
              </thead>
              <tbody>
                ${parsed.rows.map(r => `
                  <tr>
                    <td><strong>${escapeHtml(r.code)}</strong></td>
                    <td>${escapeHtml(r.title)}</td>
                    <td style="font-weight:700;">${escapeHtml(r.coeffs.join(" | "))}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
      } else {
        contentHtml = `<p style="font-size: 13.5px; line-height: 1.5; color: var(--ink); white-space: pre-wrap;">${escapeHtml(node.text)}</p>`;
      }
    } else {
      // Standard items list or full text
      if (node.items && node.items.length > 0) {
        contentHtml = node.items.map(item => {
          const marker = item.marker || `${item.number}.`;
          return `<div class="tariff-clause"><strong>${escapeHtml(marker)}</strong> ${escapeHtml(item.text)}</div>`;
        }).join("");
      } else {
        contentHtml = `<p style="font-size: 13.5px; line-height: 1.5; color: var(--ink); white-space: pre-wrap;">${escapeHtml(node.text)}</p>`;
      }
    }

    card.innerHTML = `
      <div class="tariff-block-header">
        <div>
          <h3>${escapeHtml(node.title)}</h3>
          <div style="margin-top:6px; display:flex; align-items:center;">
            <span class="tag file" style="margin-right:8px;">${escapeHtml(labelKind)}</span>
            ${tagsHtml}
          </div>
        </div>
        <div class="tariff-block-meta">
          <span>${escapeHtml(source)} · ${escapeHtml(pages)}</span>
        </div>
      </div>
      <div class="tariff-block-content">
        ${contentHtml}
      </div>
      <div class="tariff-actions">
        <a class="tariff-action-link" href="${passportState.resolution.document.source_href}#page=${node.page_start}" target="_blank">📄 PDF сторінка ${node.page_start}</a>
        <a class="tariff-action-link" href="${passportState.resolution.document.source_html_href}" target="_blank" style="margin-left:14px;">🌐 Офіційний веб-текст</a>
      </div>
    `;

    container.appendChild(card);
  });
}

// Appendix Table Parser helper (mirrors resolution.js logic)
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

// ── Tab 4: Explanations (Clarifications) ──────────────────────
function renderExplanations() {
  const pkg = passportState.selectedPackage;
  const container = el("explanationsList");
  container.innerHTML = "";

  const groupCodes = PACKAGE_GROUPS[pkg.number.padStart(2, '0')] || [];
  const linkedDocs = passportState.explanations.filter(doc => 
    pkg.related_document_ids.includes(doc.id) || groupCodes.includes(doc.package)
  );

  if (linkedDocs.length === 0) {
    container.innerHTML = `<div class="no-results">Пов'язаних листів-роз'яснень або додатків НСЗУ не виявлено.</div>`;
    return;
  }

  linkedDocs.forEach(doc => {
    const card = document.createElement("div");
    card.className = "explanation-card";

    const dateStr = doc.document_date_display || doc.year || "Не вказано";
    const numStr = doc.document_number ? `№ ${doc.document_number}` : "Без номера";
    const excerptText = doc.excerpt ? doc.excerpt.substring(0, 350) + "..." : "Текстовий фрагмент змісту відсутній.";

    // Download URL cleaner
    const localUrl = doc.local_path ? doc.local_path.replace(/^\.\.\//, "../") : "";

    card.innerHTML = `
      <div class="explanation-card-header">
        <div class="explanation-badge-row">
          <span class="tag file">${escapeHtml(doc.format)}</span>
          <span class="tag" style="background:#eef6fc;color:#2f6b9e;">${escapeHtml(doc.direction.replace(/-/g, " "))}</span>
        </div>
        <span class="exp-date">від ${escapeHtml(dateStr)} · ${escapeHtml(numStr)}</span>
      </div>
      <h3>${escapeHtml(doc.title)}</h3>
      <p style="font-size:13px; color:var(--muted); margin:-4px 0 10px 0; font-weight:600;">Назва у бібліотеці: ${escapeHtml(doc.name)}</p>
      <div class="explanation-excerpt">
        ${escapeHtml(excerptText)}
      </div>
      <div class="explanation-actions">
        ${localUrl ? `<a class="exp-link primary" href="${escapeHtml(localUrl)}" target="_blank">📥 Завантажити локально</a>` : ""}
        ${doc.source_url ? `<a class="exp-link" href="${escapeHtml(doc.source_url)}" target="_blank" rel="noopener">🌐 Офіційне джерело НСЗУ</a>` : ""}
      </div>
    `;

    container.appendChild(card);
  });
}

// ── Tab 5: Clinical Protocols (DEC) ───────────────────────────
const STAGE_EMOJIS = {
  "Діагностика / Скринінг": "🔍",
  "Хірургічне лікування": "🏥",
  "Спеціалізоване лікування": "💊",
  "Реабілітація": "⚡",
  "Паліативна допомога": "🕊️",
  "Профілактика / Первинна допомога": "🛡️",
  "Інше": "📂",
  "Не визначено": "📋"
};

const STAGE_ORDER = [
  "Діагностика / Скринінг",
  "Хірургічне лікування",
  "Спеціалізоване лікування",
  "Реабілітація",
  "Паліативна допомога",
  "Профілактика / Первинна допомога",
  "Інше",
  "Не визначено"
];

function renderDecDocuments() {
  const pkg = passportState.selectedPackage;
  const container = el("decContainer");
  container.innerHTML = "";

  const pkgLinks = passportState.decLinks[pkg.number] || {};
  const linkedCategories = getLinkedCategoriesForPackage(pkg.number);
  const decDocs = passportState.decDocuments.filter(doc => linkedCategories.includes(doc.category));

  if (decDocs.length === 0) {
    container.innerHTML = `<div class="no-results">Пов'язаних галузевих стандартів чи клінічних протоколів МОЗ України для цього пакета не знайдено.</div>`;
    return;
  }

  // Group by stage
  const stagesMap = {};
  STAGE_ORDER.forEach(st => {
    stagesMap[st] = [];
  });

  decDocs.forEach(doc => {
    let stage = "Не визначено";
    let note = "";
    
    if (!Array.isArray(pkgLinks) && pkgLinks[doc.category]) {
      stage = pkgLinks[doc.category].stage || "Не визначено";
      note = pkgLinks[doc.category].note || "";
    }
    
    if (!stagesMap[stage]) {
      stagesMap[stage] = [];
    }
    stagesMap[stage].push({ doc, note });
  });

  // Render by stages
  STAGE_ORDER.forEach(stage => {
    const items = stagesMap[stage];
    if (!items || items.length === 0) return;

    const stageSection = document.createElement("div");
    stageSection.className = "dec-stage-section";
    stageSection.style.marginTop = "28px";
    stageSection.style.marginBottom = "20px";

    const emoji = STAGE_EMOJIS[stage] || "📋";
    
    const heading = document.createElement("h3");
    heading.className = "dec-stage-heading";
    heading.style.fontSize = "16px";
    heading.style.fontWeight = "800";
    heading.style.borderBottom = "2px solid var(--line, #dde6ee)";
    heading.style.paddingBottom = "8px";
    heading.style.color = "var(--accent-dark, #2f6b9e)";
    heading.style.marginBottom = "16px";
    heading.textContent = `${emoji} ${stage}`;
    stageSection.appendChild(heading);

    const cardsContainer = document.createElement("div");
    cardsContainer.className = "dec-container";
    cardsContainer.style.display = "flex";
    cardsContainer.style.flexDirection = "column";
    cardsContainer.style.gap = "14px";

    items.forEach(({ doc, note }) => {
      const card = document.createElement("div");
      card.className = "dec-card";

      const statusClass = doc.status.toLowerCase().startsWith("чинн") ? "active" : "inactive";

      let noteHtml = "";
      if (note) {
        noteHtml = `
          <div class="dec-expert-note" style="margin-top: 14px; padding: 10px 14px; background: var(--accent-soft, #eef6fc); border-left: 4px solid var(--accent, #4a8fc7); border-radius: 8px; font-size: 13px; color: var(--ink, #1f3347);">
            <strong>💡 Коментар експерта:</strong> ${escapeHtml(note)}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="dec-card-header">
          <span class="dec-type-pill">${escapeHtml(doc.type)}</span>
          <span class="dec-status-pill ${statusClass}">${escapeHtml(doc.status)}</span>
        </div>
        <h3>${escapeHtml(doc.title)}</h3>
        <div class="dec-meta-row">
          <div class="dec-meta-item">Тематична категорія: <strong>${escapeHtml(doc.category)}</strong></div>
          ${doc.number ? `<div class="dec-meta-item">Реєстраційний №: <strong>${escapeHtml(doc.number)}</strong></div>` : ""}
          ${doc.published ? `<div class="dec-meta-item">Опубліковано: <strong>${escapeHtml(doc.published)}</strong></div>` : ""}
        </div>
        <div class="dec-actions">
          ${doc.document_url ? `<a class="exp-link primary" href="${escapeHtml(doc.document_url)}" target="_blank" rel="noopener">📄 Відкрити PDF наказ</a>` : ""}
          ${doc.category_url ? `<a class="exp-link" href="${escapeHtml(doc.category_url)}" target="_blank" rel="noopener">🌐 Категорія ДЕЦ МОЗ</a>` : ""}
        </div>
        ${noteHtml}
      `;
      cardsContainer.appendChild(card);
    });

    stageSection.appendChild(cardsContainer);
    container.appendChild(stageSection);
  });
}

// ── Setup Listeners ───────────────────────────────────────────
function setupListeners() {
  // Sidebar package search
  el("sidebarSearchInput").addEventListener("input", (e) => {
    renderSidebar(e.target.value);
  });

  // Tab switching
  document.querySelectorAll(".tab-link").forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;
      
      // Update tab active classes
      document.querySelectorAll(".tab-link").forEach(b => b.classList.toggle("active", b === btn));
      
      // Show tab content
      document.querySelectorAll(".tab-pane").forEach(pane => {
        pane.classList.toggle("active", pane.id === `tab-${tabId}`);
      });

      // Special handling or re-render if needed
      if (tabId === "analytics") {
        renderAnalytics();
        renderHospitalsTable();
      }
    });
  });

  // Hospital Table search & filter
  el("hospitalSearchInput").addEventListener("input", (e) => {
    passportState.hospitalSearch = e.target.value;
    passportState.hospitalCurrentPage = 1;
    renderHospitalsTable();
  });

  el("hospitalOblastFilter").addEventListener("change", (e) => {
    passportState.hospitalOblast = e.target.value;
    passportState.hospitalCurrentPage = 1;
    renderHospitalsTable();
  });

  // Sort Listeners
  document.querySelectorAll(".hospitals-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      
      if (passportState.hospitalSortField === field) {
        passportState.hospitalSortDesc = !passportState.hospitalSortDesc;
      } else {
        passportState.hospitalSortField = field;
        passportState.hospitalSortDesc = true;
      }

      // Update active header classes
      document.querySelectorAll(".hospitals-table th.sortable").forEach(header => {
        header.classList.remove("active", "asc", "desc");
      });

      th.classList.add("active", passportState.hospitalSortDesc ? "desc" : "asc");
      passportState.hospitalCurrentPage = 1;
      renderHospitalsTable();
    });
  });

  // Excel export trigger
  el("btnExportExcel").addEventListener("click", exportPassportToExcel);
}

// ── SheetJS Excel Multi-sheet Exporter ────────────────────────
function exportPassportToExcel() {
  const pkg = passportState.selectedPackage;
  if (!pkg) return;

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `pasport_paketa_${pkg.number}_${dateStr}.xlsx`;

  const wb = XLSX.utils.book_new();

  // 1. Overview Sheet (Паспорт)
  const meta = passportState.contractsData.package_metadata[pkg.number] || {};
  const pContracts = passportState.contractsData.contracts.filter(c => 
    c.packages.some(p => p.package_num === pkg.number)
  );
  
  const getPkgSum = (c) => {
    const pInfo = c.packages.find(p => p.package_num === pkg.number);
    return pInfo ? pInfo.sum : 0;
  };
  const totalSum = pContracts.reduce((sum, c) => sum + getPkgSum(c), 0);

  const overviewData = [
    ["ПАСПОРТ ПАКЕТА МЕДИЧНИХ ПОСЛУГ 2026"],
    [],
    ["Номер пакету", pkg.number],
    ["Назва пакету", pkg.title],
    ["Напрям медичної допомоги", meta.direction || "Не визначено"],
    ["Вид медичної допомоги", meta.help_type || "Не визначено"],
    ["Програма фінансування", meta.financing_program || "ПМГ"],
    [],
    ["ЗВЕДЕНІ МЕТРИКИ ДОГОВОРІВ ЗОЗ"],
    ["Загальний бюджет контрактування за пакетом", totalSum],
    ["Кількість законтрактованих медичних закладів (ЗОЗ)", pContracts.length],
    [],
    ["Секція", "Сума фінансування (₴)", "Кількість закладів"],
  ];

  // Group by ownership for summary in sheet 1
  const ownSummary = {};
  pContracts.forEach(c => {
    const own = c.ownership || "Інші";
    if (!ownSummary[own]) ownSummary[own] = { count: 0, sum: 0 };
    ownSummary[own].count++;
    ownSummary[own].sum += getPkgSum(c);
  });
  Object.keys(ownSummary).forEach(own => {
    overviewData.push([own, ownSummary[own].sum, ownSummary[own].count]);
  });

  const wsOverview = XLSX.utils.aoa_to_sheet(overviewData);
  // Auto-width
  wsOverview['!cols'] = [{ wch: 45 }, { wch: 55 }, { wch: 20 }];
  // Cell sum formatting
  const colLetter = XLSX.utils.encode_col(1);
  
  // Format budget row (Row 9, 0-indexed)
  const budgetCellRef = colLetter + (9 + 1);
  if (wsOverview[budgetCellRef]) {
    wsOverview[budgetCellRef].t = 'n';
    wsOverview[budgetCellRef].z = '#,##0.00';
  }
  
  // Format ownership rows (starting from Row 13, 0-indexed)
  let rowIdx = 13;
  Object.keys(ownSummary).forEach(() => {
    const cellRef = colLetter + (rowIdx + 1);
    if (wsOverview[cellRef]) {
      wsOverview[cellRef].t = 'n';
      wsOverview[cellRef].z = '#,##0.00';
    }
    rowIdx++;
  });
  XLSX.utils.book_append_sheet(wb, wsOverview, "Паспорт");


  // 2. Specifications Sheet (Вимоги)
  const specData = [
    ["Розділ вимог", "Підрозділ / Заголовок", "Вимога (Пункт)", "Маркер", "Рівень"]
  ];
  pkg.units.forEach(unit => {
    unit.sections.forEach(section => {
      const secLabel = SECTION_LABELS[section.key] || section.label;
      if (section.items && section.items.length > 0) {
        section.items.forEach(item => {
          specData.push([
            secLabel,
            section.source_heading || "",
            item.text,
            item.marker || "",
            item.level || 0
          ]);
        });
      } else {
        specData.push([
          secLabel,
          section.source_heading || "",
          "Окремі деталізовані вимоги в даному розділі відсутні.",
          "",
          ""
        ]);
      }
    });
  });
  const wsSpec = XLSX.utils.aoa_to_sheet(specData);
  wsSpec['!cols'] = [{ wch: 30 }, { wch: 35 }, { wch: 70 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsSpec, "Вимоги закупівлі");


  // 3. Resolution 1808 Sheet (Постанова)
  const tariffData = [
    ["Тип норми", "Назва статті / глави", "Пункт", "Зміст норми Постанови № 1808", "Сторінка в PDF"]
  ];
  
  const matchedNodes = [];
  const allNodes = [
    ...(passportState.resolution?.parts || []),
    ...(passportState.resolution?.chapters || []),
    ...(passportState.resolution?.appendices || [])
  ];
  allNodes.forEach(node => {
    if (node.package_numbers && node.package_numbers.includes(pkg.number)) {
      matchedNodes.push(node);
    }
  });

  matchedNodes.forEach(node => {
    const labelKind = node.kind === "chapter" ? "Тарифна глава" : (node.kind === "appendix" ? "Додаток" : "Загальний розділ");
    if (node.items && node.items.length > 0) {
      node.items.forEach(item => {
        tariffData.push([
          labelKind,
          node.title,
          item.marker || `${item.number}.`,
          item.text,
          item.page || node.page_start
        ]);
      });
    } else {
      tariffData.push([
        labelKind,
        node.title,
        "",
        node.text,
        node.page_start
      ]);
    }
  });
  const wsTariff = XLSX.utils.aoa_to_sheet(tariffData);
  wsTariff['!cols'] = [{ wch: 18 }, { wch: 35 }, { wch: 10 }, { wch: 80 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsTariff, "Постанова 1808");


  // 4. Explanations Sheet (Роз'яснення)
  const expData = [
    ["Дата документа", "Номер", "Назва документа", "Формат", "Напрям НСЗУ", "Посилання джерела", "Локальний файл"]
  ];
  const groupCodes = PACKAGE_GROUPS[pkg.number.padStart(2, '0')] || [];
  const linkedDocs = passportState.explanations.filter(doc => 
    pkg.related_document_ids.includes(doc.id) || groupCodes.includes(doc.package)
  );

  linkedDocs.forEach(doc => {
    expData.push([
      doc.document_date_display || doc.year || "",
      doc.document_number || "",
      doc.title,
      doc.format,
      doc.direction.replace(/-/g, " "),
      doc.source_url || "",
      doc.local_path ? doc.local_path.replace(/^\.\.\//, "") : ""
    ]);
  });
  const wsExp = XLSX.utils.aoa_to_sheet(expData);
  wsExp['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 55 }, { wch: 10 }, { wch: 25 }, { wch: 45 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, wsExp, "Роз'яснення НСЗУ");


  // 5. Zoz Contracts Sheet (Договори ЗОЗ)
  const zozData = [
    ["Код ЄДРПОУ", "Назва закладу (надавача)", "Повна назва ЗОЗ", "Область реєстрації", "Громада", "Населений пункт", "Форма власності", "Спроможна мережа", "Сума за цим пакетом (грн)", "Електронна пошта", "Юридична адреса"]
  ];
  pContracts.forEach(c => {
    zozData.push([
      c.edrpou,
      c.provider_name,
      c.provider_name_full,
      c.oblast,
      c.community,
      c.settlement,
      c.ownership,
      c.network_type || "Не входить в спроможну мережу",
      getPkgSum(c),
      c.email || "",
      c.reg_address || ""
    ]);
  });
  const wsZoz = XLSX.utils.aoa_to_sheet(zozData);
  
  // Columns width
  wsZoz['!cols'] = [
    { wch: 14 }, { wch: 35 }, { wch: 45 }, { wch: 20 }, { wch: 22 }, { wch: 20 },
    { wch: 20 }, { wch: 22 }, { wch: 24 }, { wch: 24 }, { wch: 45 }
  ];
  
  // Format numeric column (index 8)
  const sumColLetter = XLSX.utils.encode_col(8);
  for (let r = 1; r < zozData.length; r++) {
    const cellRef = sumColLetter + (r + 1);
    if (wsZoz[cellRef]) {
      wsZoz[cellRef].t = 'n';
      wsZoz[cellRef].z = '#,##0.00';
    }
  }
  XLSX.utils.book_append_sheet(wb, wsZoz, "Договори ЗОЗ");


  // 6. Clinical Protocols Sheet (Протоколи ДЕЦ)
  const decData = [
    ["Тематична категорія ДЕЦ", "Етап медичної допомоги", "Коментар експерта", "Вид стандарту", "Назва протоколу / документа", "Статус чинності", "Реєстраційний №", "Дата публікації", "Рік", "Посилання PDF"]
  ];
  const pkgLinks = passportState.decLinks[pkg.number] || {};
  const linkedCategories = getLinkedCategoriesForPackage(pkg.number);
  const decDocs = passportState.decDocuments.filter(doc => linkedCategories.includes(doc.category));
  
  decDocs.forEach(doc => {
    let stage = "Не визначено";
    let note = "";
    if (!Array.isArray(pkgLinks) && pkgLinks[doc.category]) {
      stage = pkgLinks[doc.category].stage || "Не визначено";
      note = pkgLinks[doc.category].note || "";
    }
    
    decData.push([
      doc.category,
      stage,
      note,
      doc.type,
      doc.title,
      doc.status,
      doc.number || "",
      doc.published || "",
      doc.year || "",
      doc.document_url || ""
    ]);
  });
  const wsDec = XLSX.utils.aoa_to_sheet(decData);
  wsDec['!cols'] = [{ wch: 30 }, { wch: 25 }, { wch: 35 }, { wch: 18 }, { wch: 55 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, wsDec, "Стандарти ДЕЦ МОЗ");

  // Write file
  XLSX.writeFile(wb, fileName);
}

// Start Initialization
document.addEventListener("DOMContentLoaded", init);
