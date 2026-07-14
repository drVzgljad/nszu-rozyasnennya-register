document.addEventListener('DOMContentLoaded', () => {
  // Application State
  let allPackages = [];
  let filteredPackages = [];
  const selectedPaths = new Set(loadSelectedFromStorage());

  // Cache DOM Elements
  const packageSearch = document.getElementById('packageSearch');
  const yearFiltersContainer = document.getElementById('yearFilters');
  const typeFiltersContainer = document.getElementById('typeFilters');
  const resultsCount = document.getElementById('resultsCount');
  const filesList = document.getElementById('filesList');
  const basketList = document.getElementById('basketList');
  const basketCount = document.getElementById('basketCount');
  const basketSize = document.getElementById('basketSize');
  const statTotalCount = document.getElementById('statTotalCount');
  const statCartCount = document.getElementById('statCartCount');
  const downloadZipBtn = document.getElementById('downloadZipBtn');
  const clearBasketBtn = document.getElementById('clearBasketBtn');
  const selectAllFilteredBtn = document.getElementById('selectAllFiltered');
  const clearSearchBtn = document.getElementById('clearSearch');
  const archiveNameInput = document.getElementById('archiveName');

  // Initialize
  fetchPackages();

  // ── Event Listeners ─────────────────────────────────

  packageSearch.addEventListener('input', applyFilters);

  // Multi-select year chips
  yearFiltersContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    chip.classList.toggle('active');
    applyFilters();
  });

  // Single-select type chips
  typeFiltersContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    
    // Deactivate all type chips
    typeFiltersContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    applyFilters();
  });

  selectAllFilteredBtn.addEventListener('click', () => {
    if (filteredPackages.length === 0) return;
    filteredPackages.forEach(pkg => {
      selectedPaths.add(pkg.path);
    });
    saveSelectedToStorage();
    renderAll();
  });

  clearSearchBtn.addEventListener('click', () => {
    packageSearch.value = '';
    // Reset years to all active
    yearFiltersContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.add('active'));
    // Reset type to 'all' active
    typeFiltersContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    typeFiltersContainer.querySelector('[data-type="all"]').classList.add('active');
    applyFilters();
  });

  clearBasketBtn.addEventListener('click', () => {
    if (confirm('Очистити всі вибрані документи?')) {
      selectedPaths.clear();
      saveSelectedToStorage();
      renderAll();
    }
  });

  downloadZipBtn.addEventListener('click', downloadZipArchive);

  // ── API Calls ───────────────────────────────────────

  async function fetchPackages() {
    filesList.innerHTML = '<div class="loading-state">Завантаження пакетів документів...</div>';
    let loadedFromSupabase = false;

    try {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
      const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
      const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
      
      if (sb) {
        const { data: dbData, error } = await sb.from('pmg_packages').select('*');
        if (!error && dbData && dbData.length > 0) {
          allPackages = dbData;
          loadedFromSupabase = true;
          console.log("Loaded packages list from Supabase!");
        } else if (error) {
          console.warn("Supabase packages error:", error);
        }
      }
    } catch (dbErr) {
      console.warn("Supabase fetch failed, falling back to local JSON:", dbErr);
    }

    if (!loadedFromSupabase) {
      try {
        const response = await fetch('data/packages_list.json');
        if (!response.ok) throw new Error('Не вдалося завантажити локальний список пакетів');
        allPackages = await response.json();
        console.log("Loaded packages list from local JSON file.");
      } catch (error) {
        console.error(error);
        filesList.innerHTML = `<div class="error-state">Помилка завантаження даних: ${error.message}</div>`;
        return;
      }
    }

    statTotalCount.textContent = allPackages.length;
    applyFilters();
  }

  async function downloadZipArchive() {
    if (selectedPaths.size === 0) return;
    
    const originalText = downloadZipBtn.innerHTML;
    downloadZipBtn.disabled = true;
    downloadZipBtn.innerHTML = `
      <svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; animation: spin 1s linear infinite;">
        <line x1="12" y1="2" x2="12" y2="6"></line>
        <line x1="12" y1="18" x2="12" y2="22"></line>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
        <line x1="2" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="22" y2="12"></line>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
      </svg>
      Завантаження...
    `;

    try {
      const zip = new JSZip();
      const archiveName = archiveNameInput.value.trim() || 'пакети_пмг_вибірка';
      
      let count = 0;
      const total = selectedPaths.size;

      for (const relPath of selectedPaths) {
        count++;
        downloadZipBtn.innerHTML = `
          <svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; animation: spin 1s linear infinite;">
            <line x1="12" y1="2" x2="12" y2="6"></line>
            <line x1="12" y1="18" x2="12" y2="22"></line>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
            <line x1="2" y1="12" x2="6" y2="12"></line>
            <line x1="18" y1="12" x2="22" y2="12"></line>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
          </svg>
          Завантаження ${count}/${total}...
        `;

        const pkg = allPackages.find(p => p.path === relPath);
        const folderName = pkg ? String(pkg.year) : 'інше';
        const fileName = pkg ? pkg.name : relPath.split('/').pop();
        
        const fileUrl = '../../' + relPath;
        const fileRes = await fetch(fileUrl);
        if (!fileRes.ok) throw new Error(`Не вдалося завантажити файл ${fileName} (помилка ${fileRes.status})`);
        
        const blob = await fileRes.blob();
        zip.file(fileName, blob);
      }

      downloadZipBtn.innerHTML = `
        <svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; animation: spin 1s linear infinite;">
          <line x1="12" y1="2" x2="12" y2="6"></line>
          <line x1="12" y1="18" x2="12" y2="22"></line>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
          <line x1="2" y1="12" x2="6" y2="12"></line>
          <line x1="18" y1="12" x2="22" y2="12"></line>
          <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
          <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
        </svg>
        Генерація ZIP...
      `;

      const content = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${archiveName}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Не вдалося завантажити ZIP-архів: ' + err.message);
    } finally {
      downloadZipBtn.disabled = false;
      downloadZipBtn.innerHTML = originalText;
    }
  }

  // ── Filtering Logic ─────────────────────────────────

  function applyFilters() {
    const query = packageSearch.value.toLowerCase().trim().replace(/_/g, ' ');
    
    // Get active years
    const activeYears = Array.from(yearFiltersContainer.querySelectorAll('.filter-chip.active'))
      .map(c => parseInt(c.dataset.year));
      
    // Get active type
    const activeTypeChip = typeFiltersContainer.querySelector('.filter-chip.active');
    const activeType = activeTypeChip ? activeTypeChip.dataset.type : 'all';

    filteredPackages = allPackages.filter(pkg => {
      // Normalize filename to spaces for search comparison
      const normalizedName = pkg.name.toLowerCase().replace(/_/g, ' ');
      const matchesQuery = query === '' || normalizedName.includes(query);
      
      // Year filter
      const matchesYear = activeYears.includes(pkg.year);
      
      // Document type filter
      const matchesType = checkDocType(pkg.name, activeType);

      return matchesQuery && matchesYear && matchesType;
    });

    resultsCount.textContent = `Знайдено: ${filteredPackages.length} файлів`;
    renderAll();
  }

  function checkDocType(name, type) {
    if (type === 'all') return true;
    
    const lower = name.toLowerCase();
    const hasSpec = lower.includes('специф');
    const hasCond = lower.includes('умови') || lower.includes('вимог') || lower.includes('закуп');
    
    // 2021 booklet split and 2026 docx contain BOTH specs and conditions in a single file
    const containsBoth = !hasSpec && !hasCond;

    if (type === 'specs') {
      return hasSpec || containsBoth;
    }
    if (type === 'conditions') {
      return hasCond || containsBoth;
    }
    return true;
  }

  // ── Render Utilities ────────────────────────────────

  function renderAll() {
    renderFilesList();
    renderBasket();
  }

  function renderFilesList() {
    if (filteredPackages.length === 0) {
      filesList.innerHTML = '<div class="empty-state">Нічого не знайдено за вибраними фільтрами. Спробуйте змінити критерії пошуку.</div>';
      return;
    }

    filesList.innerHTML = '';
    filteredPackages.forEach(pkg => {
      const isSelected = selectedPaths.has(pkg.path);
      const ext = pkg.name.split('.').pop().toUpperCase();
      const cleanTitle = pkg.name.substring(0, pkg.name.lastIndexOf('.')) || pkg.name;
      
      const fileCard = document.createElement('div');
      fileCard.className = `file-card ${isSelected ? 'active' : ''}`;
      
      // Icon depending on file type
      const iconSVG = ext === 'PDF' 
        ? `<svg class="file-icon pdf" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`
        : `<svg class="file-icon docx" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M8 13h1v4H8z"></path><path d="M12 15h3"></path><path d="M12 13h3"></path></svg>`;

      fileCard.innerHTML = `
        <label class="card-checkbox-label">
          <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''}>
          <span class="custom-checkbox"></span>
        </label>
        
        <div class="card-content">
          ${iconSVG}
          <div class="card-details">
            <span class="card-title" title="${pkg.name}">${cleanTitle}</span>
            <div class="card-meta">
              <span class="badge badge-year">${pkg.year} рік</span>
              <span class="badge badge-format ${ext.toLowerCase()}">${ext}</span>
              <span class="badge badge-size">${formatBytes(pkg.size)}</span>
            </div>
          </div>
        </div>

        <div class="card-actions">
          <a href="../../${pkg.path}" download class="btn-icon" title="Завантажити файл безпосередньо">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </a>
        </div>
      `;

      // Handle card clicks
      const checkbox = fileCard.querySelector('.card-checkbox');
      const toggleSelection = (e) => {
        // Prevent click events on download button/link from toggling
        if (e.target.closest('.btn-icon')) return;

        e.preventDefault();
        
        if (selectedPaths.has(pkg.path)) {
          selectedPaths.delete(pkg.path);
        } else {
          selectedPaths.add(pkg.path);
        }
        saveSelectedToStorage();
        renderAll();
      };
      
      fileCard.addEventListener('click', toggleSelection);
      filesList.appendChild(fileCard);
    });
  }

  function renderBasket() {
    statCartCount.textContent = selectedPaths.size;
    basketCount.textContent = `${selectedPaths.size} шт.`;

    if (selectedPaths.size === 0) {
      basketList.innerHTML = '<li class="empty-basket">Кошик порожній. Виберіть потрібні файли зі списку ліворуч.</li>';
      basketSize.textContent = '0 КБ';
      downloadZipBtn.disabled = true;
      clearBasketBtn.disabled = true;
      return;
    }

    basketList.innerHTML = '';
    let totalSize = 0;

    // Filter allPackages to get selected packages information
    const selectedPkgs = allPackages.filter(pkg => selectedPaths.has(pkg.path));
    
    // Sort basket by year desc, then name asc
    selectedPkgs.sort((a, b) => (-a.year) || a.name.localeCompare(b.name));

    selectedPkgs.forEach(pkg => {
      totalSize += pkg.size;
      const cleanTitle = pkg.name.substring(0, pkg.name.lastIndexOf('.')) || pkg.name;
      
      const li = document.createElement('li');
      li.className = 'basket-item';
      li.innerHTML = `
        <div class="basket-item-info">
          <span class="basket-item-title" title="${pkg.name}">${cleanTitle}</span>
          <div class="basket-item-meta">
            <span class="basket-item-year">${pkg.year}</span>
            <span class="basket-item-size">${formatBytes(pkg.size)}</span>
          </div>
        </div>
        <button class="btn-remove-item" title="Видалити зі збірки">&times;</button>
      `;

      li.querySelector('.btn-remove-item').addEventListener('click', () => {
        selectedPaths.delete(pkg.path);
        saveSelectedToStorage();
        renderAll();
      });

      basketList.appendChild(li);
    });

    basketSize.textContent = formatBytes(totalSize);
    downloadZipBtn.disabled = false;
    clearBasketBtn.disabled = false;
  }

  // ── Storage and Formatting Utilities ───────────────

  function loadSelectedFromStorage() {
    try {
      const stored = localStorage.getItem('pmg_collector_selected');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.warn('LocalStorage error:', e);
      return [];
    }
  }

  function saveSelectedToStorage() {
    try {
      localStorage.setItem('pmg_collector_selected', JSON.stringify(Array.from(selectedPaths)));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = 1;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
});
