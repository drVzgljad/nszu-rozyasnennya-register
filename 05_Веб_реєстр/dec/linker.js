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
  selectedCategory: "",
  icd10Classifier: null,
  achiClassifier: null
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
    loadClassifiers();

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
  el("searchClassifierInput").addEventListener("input", handleClassifierSearch);
  el("classifierTypeSelect").addEventListener("change", handleClassifierSearch);
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

// Load classifiers asynchronously in the background
async function loadClassifiers() {
  try {
    const [icdRes, achiRes] = await Promise.all([
      fetch("data/icd10_codes.json").then(r => r.json()),
      fetch("data/achi_codes.json").then(r => r.json())
    ]);
    state.icd10Classifier = icdRes;
    state.achiClassifier = achiRes;
    console.log("Національні класифікатори (МКХ-10-АМ та АКМІ) завантажено успішно.");
  } catch (err) {
    console.error("Помилка завантаження класифікаторів:", err);
  }
}

// Classifier search handler
function handleClassifierSearch() {
  const query = el("searchClassifierInput").value.trim().toLowerCase();
  const type = el("classifierTypeSelect").value;
  const resultsDiv = el("searchClassifierResults");

  if (query.length < 3) {
    resultsDiv.style.display = "none";
    resultsDiv.innerHTML = "";
    return;
  }

  const classifier = type === "icd" ? state.icd10Classifier : state.achiClassifier;
  if (!classifier) {
    resultsDiv.style.display = "block";
    resultsDiv.innerHTML = `<div style="padding: 10px; color: var(--muted, #647688); font-size: 13px; text-align: center;">Завантаження класифікаторів... Спробуйте ще раз за мить.</div>`;
    return;
  }

  const matches = [];
  for (const code in classifier) {
    const name = classifier[code];
    if (code.toLowerCase().includes(query) || name.toLowerCase().includes(query)) {
      matches.push({ code, name });
      if (matches.length >= 40) break;
    }
  }

  if (matches.length === 0) {
    resultsDiv.style.display = "block";
    resultsDiv.innerHTML = `<div style="padding: 12px; color: var(--muted, #647688); font-size: 13px; text-align: center;">Нічого не знайдено</div>`;
    return;
  }

  resultsDiv.style.display = "block";
  resultsDiv.innerHTML = matches.map(m => {
    const isDark = document.documentElement.classList.contains("dark-theme");
    const itemBg = isDark ? "#1e293b" : "#ffffff";
    const borderC = isDark ? "#334155" : "#dde6ee";
    const textC = isDark ? "#cbd5e1" : "#1f3347";
    
    return `
      <div class="search-code-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid ${borderC}; gap: 12px; font-size: 13px; background: ${itemBg}; color: ${textC};">
        <div style="text-align: left; line-height: 1.4; flex: 1;">
          <strong style="color: var(--accent-dark, #2f6b9e); font-family: monospace; font-size: 13.5px;">${m.code}</strong> - <span>${m.name}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-add-code" data-code="${m.code}" data-type="${type}" style="padding: 4px 8px; font-size: 11px; margin-left: 8px; flex-shrink: 0;">Додати ➕</button>
      </div>
    `;
  }).join("");

  // Add event listeners to dynamic buttons
  resultsDiv.querySelectorAll(".btn-add-code").forEach(btn => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.code;
      const codeType = btn.dataset.type;
      addCodeToInput(code, codeType);
    });
  });
}

// Add code to input and update matching
function addCodeToInput(code, type) {
  const inputId = type === "icd" ? "icd10Codes" : "achiCodes";
  const inputEl = el(inputId);
  const currentVal = inputEl.value.trim();
  
  let codesList = currentVal ? currentVal.split(",").map(c => c.trim()).filter(c => c.length > 0) : [];
  
  if (!codesList.includes(code)) {
    codesList.push(code);
    inputEl.value = codesList.join(", ");
    
    // Automatically trigger code recalculation and UI refresh
    updateCategoryCodes();
    showToast(`Код ${code} успішно додано!`, 2000);
  } else {
    showToast(`Код ${code} вже присутній у списку.`, 2000);
  }
}

// DOMContentLoaded load trigger
document.addEventListener("DOMContentLoaded", loadData);
