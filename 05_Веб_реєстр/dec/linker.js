/**
 * Конструктор зв'язків ДЕЦ та ПМГ — Controller Logic
 * Handles interactive linking of clinical categories to packages, code overlap, and saving data.
 */

// Global State
const state = {
  categories: [],
  decDocumentCodes: {},
  packageCodes: {},
  packages: [],
  packageDecLinks: {},
  selectedCategory: ""
};

// DOM Elements
const el = (id) => document.getElementById(id);

// Care stages list
const CARE_STAGES = [
  "Діагностика / Скринінг",
  "Хірургічне лікування",
  "Спеціалізоване лікування",
  "Реабілітація",
  "Паліативна допомога",
  "Профілактика / Первинна допомога",
  "Інше"
];

// Helper to normalize medical codes for matching (uppercase, remove dots and spaces)
function normalizeCode(code) {
  return String(code || "").toUpperCase().replace(/[\s\.]/g, "");
}

// Check if there is an overlap between category codes and package target codes
function findOverlappingCodes(pkgTargets, catCodes) {
  if (!pkgTargets || !catCodes || pkgTargets.length === 0 || catCodes.length === 0) {
    return [];
  }
  const normalizedPkg = pkgTargets.map(normalizeCode);
  const normalizedCat = catCodes.map(normalizeCode);
  
  const overlaps = [];
  
  catCodes.forEach((originalCatCode, idx) => {
    const normCat = normalizedCat[idx];
    pkgTargets.forEach((originalPkgCode, pIdx) => {
      const normPkg = normalizedPkg[pIdx];
      // Match if one starts with another (covers C50 vs C50.1, and C50.1 vs C50)
      if (normCat.startsWith(normPkg) || normPkg.startsWith(normCat)) {
        if (!overlaps.includes(originalCatCode)) {
          overlaps.push(originalCatCode);
        }
      }
    });
  });
  
  return overlaps;
}

// ── Data Initialization ──────────────────────────────────────
async function loadData() {
  try {
    const [
      decDocsRes,
      decCodesRes,
      pkgCodesRes,
      packagesRes,
      decLinksRes
    ] = await Promise.all([
      fetch("../data/dec_documents.json").then(r => r.json()).catch(() => ({ categories: [] })),
      fetch("data/dec_document_codes.json").then(r => r.json()).catch(() => ({})),
      fetch("data/package_codes.json").then(r => r.json()).catch(() => ({})),
      fetch("../pakety/data/packages_2026.json").then(r => r.json()).catch(() => ({ packages: [] })),
      fetch("data/package_dec_links.json").then(r => r.json()).catch(() => ({}))
    ]);

    state.categories = decDocsRes.categories || [];
    state.decDocumentCodes = decCodesRes;
    state.packageCodes = pkgCodesRes;
    
    // Sort packages numerically by their package number
    state.packages = (packagesRes.packages || []).sort((a, b) => {
      return parseInt(a.number, 10) - parseInt(b.number, 10);
    });

    // Standardize decLinks: convert any arrays of strings to objects { categoryName: { stage: "", note: "" } }
    state.packageDecLinks = decLinksRes;
    for (const pkgNum in state.packageDecLinks) {
      if (Array.isArray(state.packageDecLinks[pkgNum])) {
        const obj = {};
        state.packageDecLinks[pkgNum].forEach(catName => {
          obj[catName] = { stage: "", note: "" };
        });
        state.packageDecLinks[pkgNum] = obj;
      }
    }

    populateCategories();
    setupEventListeners();

  } catch (err) {
    console.error("Помилка завантаження даних для Конструктора:", err);
    el("packagesLoading").textContent = "Помилка завантаження даних. Перевірте з'єднання з локальним сервером.";
  }
}

// Populate Category Dropdown
function populateCategories() {
  const select = el("categorySelector");
  select.innerHTML = '<option value="">-- Оберіть тему --</option>';
  
  // Sort categories alphabetically
  const sortedCategories = [...state.categories].sort((a, b) => a.localeCompare(b, "uk"));
  
  sortedCategories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

// Setup Event Listeners
function setupEventListeners() {
  el("categorySelector").addEventListener("change", (e) => {
    selectCategory(e.target.value);
  });

  el("btnUpdateCodes").addEventListener("click", updateCategoryCodes);
  el("btnSaveLinks").addEventListener("click", saveLinksAndCodesToServer);
}

// Handle Category Selection
function selectCategory(categoryName) {
  state.selectedCategory = categoryName;

  if (!categoryName) {
    el("codesEditor").style.display = "none";
    el("packagesList").style.display = "none";
    el("btnSaveLinks").style.display = "none";
    el("packagesLoading").style.display = "block";
    el("packagesLoading").textContent = "Оберіть клінічну тему ліворуч для завантаження пакетів.";
    return;
  }

  // Hide loading text and show UI parts
  el("packagesLoading").style.display = "none";
  el("codesEditor").style.display = "block";
  el("packagesList").style.display = "flex";
  el("btnSaveLinks").style.display = "inline-flex";

  // Load codes
  const codes = state.decDocumentCodes[categoryName] || { icd10: [], achi: [] };
  el("icd10Codes").value = (codes.icd10 || []).join(", ");
  el("achiCodes").value = (codes.achi || []).join(", ");

  renderPackagesGrid();
}

// Update local codes state (updates in memory, recalculates overlaps)
function updateCategoryCodes() {
  if (!state.selectedCategory) return;

  const icdText = el("icd10Codes").value;
  const achiText = el("achiCodes").value;

  const icdArray = icdText.split(",")
    .map(c => c.trim())
    .filter(c => c.length > 0);
  
  const achiArray = achiText.split(",")
    .map(c => c.trim())
    .filter(c => c.length > 0);

  state.decDocumentCodes[state.selectedCategory] = {
    icd10: icdArray,
    achi: achiArray
  };

  // Recalculate overlaps and re-render grid while keeping user inputs where possible
  renderPackagesGrid();
  showToast("Коди теми оновлено в пам'яті. Не забудьте натиснути 'Зберегти зміни'!", 3000);
}

// Render the package rows
function renderPackagesGrid() {
  const container = el("packagesList");
  container.innerHTML = "";

  const category = state.selectedCategory;
  const catCodes = state.decDocumentCodes[category] || { icd10: [], achi: [] };

  state.packages.forEach(pkg => {
    const pkgNum = pkg.number;
    const pkgTargets = state.packageCodes[pkgNum] || { icd10_targets: [], achi_targets: [] };

    // 1. Calculate automated overlaps
    const overlappingIcd = findOverlappingCodes(pkgTargets.icd10_targets || [], catCodes.icd10 || []);
    const overlappingAchi = findOverlappingCodes(pkgTargets.achi_targets || [], catCodes.achi_targets || catCodes.achi || []);
    const hasOverlap = overlappingIcd.length > 0 || overlappingAchi.length > 0;
    const overlapText = [...overlappingIcd, ...overlappingAchi].join(", ");

    // 2. Check if already linked manually/expertly
    const pkgLinks = state.packageDecLinks[pkgNum] || {};
    const isLinked = category in pkgLinks;
    const linkMetadata = pkgLinks[category] || { stage: "", note: "" };

    // Create Row
    const row = document.createElement("div");
    row.className = `package-linker-row ${isLinked ? 'is-linked' : ''}`;
    row.id = `pkg-row-${pkgNum}`;

    // Checkbox column
    const colCheck = document.createElement("div");
    colCheck.style.display = "flex";
    colCheck.style.justifyContent = "center";
    
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "pkg-link-checkbox";
    checkbox.style.width = "20px";
    checkbox.style.height = "20px";
    checkbox.style.cursor = "pointer";
    checkbox.checked = isLinked;
    checkbox.dataset.pkgNum = pkgNum;
    
    colCheck.appendChild(checkbox);

    // Title column
    const colTitle = document.createElement("div");
    colTitle.className = "pkg-title-label";
    colTitle.innerHTML = `<span class="pkg-num-label">Пакет ${pkgNum}</span><br>${pkg.title}`;

    // Badge column (auto-match)
    const colBadge = document.createElement("div");
    colBadge.className = "pkg-badge-container";
    if (hasOverlap) {
      colBadge.innerHTML = `
        <span class="badge-auto-match" title="Коди збігу: ${overlapText}">
          🤖 Авто-збіг (${overlapText})
        </span>
      `;
    }

    // Stage column
    const colStage = document.createElement("div");
    const stageSelect = document.createElement("select");
    stageSelect.className = "form-control pkg-stage-select";
    stageSelect.disabled = !isLinked;
    stageSelect.innerHTML = '<option value="">-- Оберіть етап --</option>';
    
    CARE_STAGES.forEach(st => {
      const opt = document.createElement("option");
      opt.value = st;
      opt.textContent = st;
      if (linkMetadata.stage === st) {
        opt.selected = true;
      }
      stageSelect.appendChild(opt);
    });
    colStage.appendChild(stageSelect);

    // Note column
    const colNote = document.createElement("div");
    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.className = "form-control pkg-note-input";
    noteInput.placeholder = "Додати експертний коментар...";
    noteInput.value = linkMetadata.note || "";
    noteInput.disabled = !isLinked;
    colNote.appendChild(noteInput);

    // Assembly
    row.appendChild(colCheck);
    row.appendChild(colTitle);
    row.appendChild(colBadge);
    row.appendChild(colStage);
    row.appendChild(colNote);

    container.appendChild(row);

    // Listeners for checkbox toggling
    checkbox.addEventListener("change", (e) => {
      const checked = e.target.checked;
      row.classList.toggle("is-linked", checked);
      stageSelect.disabled = !checked;
      noteInput.disabled = !checked;
      
      // Auto-set stage to "Діагностика / Скринінг" or default if checked and empty
      if (checked && !stageSelect.value) {
        // Simple heuristic: if package name or code match is diagnostics-related, guess stage
        if (pkg.title.toLowerCase().includes("діагностик") || pkg.title.toLowerCase().includes("мамографія") || pkg.title.toLowerCase().includes("ендоскопія")) {
          stageSelect.value = "Діагностика / Скринінг";
        } else if (pkg.title.toLowerCase().includes("хірургі")) {
          stageSelect.value = "Хірургічне лікування";
        } else if (pkg.title.toLowerCase().includes("реабілітаці")) {
          stageSelect.value = "Реабілітація";
        } else if (pkg.title.toLowerCase().includes("паліатив")) {
          stageSelect.value = "Паліативна допомога";
        } else {
          stageSelect.value = "Спеціалізоване лікування";
        }
      }
    });
  });
}

// Save all changes to local disk via server.py /api/save-data POST
async function saveLinksAndCodesToServer() {
  if (!state.selectedCategory) return;

  const btn = el("btnSaveLinks");
  const originalText = btn.textContent;
  
  btn.disabled = true;
  btn.textContent = "💾 Збереження...";

  try {
    // 1. Rebuild the selected category links from UI inputs
    const rows = document.querySelectorAll(".package-linker-row");
    
    rows.forEach(row => {
      const checkbox = row.querySelector(".pkg-link-checkbox");
      const pkgNum = checkbox.dataset.pkgNum;
      const stageSelect = row.querySelector(".pkg-stage-select");
      const noteInput = row.querySelector(".pkg-note-input");

      if (!state.packageDecLinks[pkgNum]) {
        state.packageDecLinks[pkgNum] = {};
      }

      if (checkbox.checked) {
        state.packageDecLinks[pkgNum][state.selectedCategory] = {
          stage: stageSelect.value,
          note: noteInput.value.trim()
        };
      } else {
        // Unlinked, so delete category key if exists
        if (state.packageDecLinks[pkgNum]) {
          delete state.packageDecLinks[pkgNum][state.selectedCategory];
        }
      }
    });

    // 2. Call server API to save package links
    const saveLinksRes = await fetch("/api/save-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "package_dec_links.json",
        data: state.packageDecLinks
      })
    });

    if (!saveLinksRes.ok) {
      throw new Error(`Failed to save package links: ${saveLinksRes.statusText}`);
    }

    // 3. Call server API to save theme codes
    const saveCodesRes = await fetch("/api/save-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "dec_document_codes.json",
        data: state.decDocumentCodes
      })
    });

    if (!saveCodesRes.ok) {
      throw new Error(`Failed to save document codes: ${saveCodesRes.statusText}`);
    }

    showToast("💾 Зв'язки та коди успішно збережено на сервері!", 4000);

  } catch (err) {
    console.error("Помилка збереження даних:", err);
    alert("Помилка при збереженні даних на сервері: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// Show simple toast notifications
let toastTimeout = null;
function showToast(message, duration = 3000) {
  const toast = el("toastNotification");
  const msgEl = el("toastMessage");
  
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  toast.style.display = "block";

  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  toastTimeout = setTimeout(() => {
    toast.style.display = "none";
  }, duration);
}

// DOMContentLoaded load trigger
document.addEventListener("DOMContentLoaded", loadData);
