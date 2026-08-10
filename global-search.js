// Глобальний пошук «одне вікно» (Ctrl+K).
// Ліниво імпортується з auth-v2.js при першому виклику; індекс data/search_global.json
// генерує tools/build_global_search.py (запускати після оновлення документів/договорів).

let indexPromise = null;
let overlay = null;
let state = { entries: [], blobs: [], results: [], selected: 0, prefix: './' };

const GROUPS = [
  { type: 1, label: 'Пакети ПМГ-2026', icon: '📦' },
  { type: 2, label: 'Постанова 1808', icon: '📜' },
  { type: 4, label: 'Класифікатор НК 025', icon: '🩺' },
  { type: 5, label: 'Класифікатор НК 026', icon: '🔬' },
  { type: 6, label: 'Таблиця співставлення', icon: '🔗' },
  { type: 7, label: 'Спеціальності та посади', icon: '🪪' },
  { type: 0, label: "Роз'яснення НСЗУ", icon: '📄' },
  { type: 3, label: 'Договори ЗОЗ', icon: '🏥' },
];
const GROUP_ORDER = { 1: 0, 2: 1, 6: 2, 4: 3, 5: 4, 7: 5, 0: 6, 3: 7 };
const PER_GROUP = 7;

function buildUrl(entry, prefix) {
  const [type, , , , link] = entry;
  switch (type) {
    case 0: return `${prefix}rozjasnennya.html?q=${encodeURIComponent(link)}`;
    case 1: return `${prefix}passport/index.html?package=${encodeURIComponent(link)}`;
    case 2: return `${prefix}postanova/index.html?node=${encodeURIComponent(link)}`;
    case 3: return `${prefix}zoz-dogovr/index.html?q=${encodeURIComponent(link)}`;
    case 4: return `${prefix}classifiers/index.html?code=${encodeURIComponent(link)}`;
    case 5: return `${prefix}classifiers/nk026.html?code=${encodeURIComponent(link)}`;
    case 6: return `${prefix}mapping/index.html?service=${encodeURIComponent(link)}`;
    // Реєстр у link закодовано першою літерою id: S… — спеціальність
    // Додатка 7, P… — посада за наказом МОЗ № 1065.
    case 7: return `${prefix}classifiers/specialnosti.html?reg=${
      link.startsWith('P') ? 'p' : 's'}&id=${encodeURIComponent(link)}`;
  }
}

function normalize(s) {
  return s.toLowerCase().replace(/[ʼ’`]/g, "'").replace(/\s+/g, ' ').trim();
}

function loadIndex(prefix) {
  if (!indexPromise) {
    indexPromise = fetch(`${prefix}data/search_global.json`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        state.entries = data.entries;
        state.blobs = data.entries.map(e => normalize(`${e[1]} ${e[2]} ${e[3]}`));
      })
      .catch(err => { indexPromise = null; throw err; });
  }
  return indexPromise;
}

function search(query) {
  const q = normalize(query);
  if (q.length < 2) return [];
  const tokens = q.split(' ');
  const scored = [];
  for (let i = 0; i < state.entries.length; i++) {
    const blob = state.blobs[i];
    let ok = true;
    for (const t of tokens) {
      if (!blob.includes(t)) { ok = false; break; }
    }
    if (!ok) continue;
    const entry = state.entries[i];
    const title = normalize(entry[1]);
    let score = 0;
    if (title.startsWith(q)) score += 4;
    else if (title.includes(q)) score += 2;
    for (const t of tokens) if (title.includes(t)) score += 1;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || GROUP_ORDER[a.entry[0]] - GROUP_ORDER[b.entry[0]]);
  // Групуємо: не більше PER_GROUP на тип, зберігаючи порядок груп
  const byType = new Map();
  for (const s of scored) {
    const t = s.entry[0];
    if (!byType.has(t)) byType.set(t, []);
    if (byType.get(t).length < PER_GROUP) byType.get(t).push(s.entry);
  }
  const flat = [];
  for (const g of GROUPS) {
    for (const e of (byType.get(g.type) || [])) flat.push(e);
  }
  return flat;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlight(text, query) {
  const safe = escapeHtml(text);
  const tokens = normalize(query).split(' ').filter(t => t.length > 1);
  if (!tokens.length) return safe;
  try {
    const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "[ʼ’`']")).join('|');
    return safe.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
  } catch { return safe; }
}

function render() {
  const list = overlay.querySelector('.gs-results');
  const query = overlay.querySelector('.gs-input').value;
  if (!state.results.length) {
    list.innerHTML = normalize(query).length < 2
      ? `<div class="gs-empty">Почніть вводити: назву пакета, тему роз'яснення, главу постанови, назву чи ЄДРПОУ закладу…</div>`
      : `<div class="gs-empty">Нічого не знайдено за запитом «${escapeHtml(query)}»</div>`;
    return;
  }
  let html = '';
  let lastType = null;
  state.results.forEach((entry, i) => {
    const [type, title, sub] = entry;
    if (type !== lastType) {
      const g = GROUPS.find(g => g.type === type);
      html += `<div class="gs-group">${g.icon} ${g.label}</div>`;
      lastType = type;
    }
    html += `
      <a class="gs-item${i === state.selected ? ' selected' : ''}" data-i="${i}" href="${buildUrl(entry, state.prefix)}">
        <span class="gs-item-title">${highlight(title, query)}</span>
        ${sub ? `<span class="gs-item-sub">${escapeHtml(sub)}</span>` : ''}
      </a>`;
  });
  list.innerHTML = html;
  const sel = list.querySelector('.gs-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function navigate() {
  const entry = state.results[state.selected];
  if (entry) window.location.href = buildUrl(entry, state.prefix);
}

const STYLES = `
.gs-overlay { position: fixed; inset: 0; z-index: 12000; background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(3px); display: flex; align-items: flex-start; justify-content: center; padding: 10vh 16px 16px; }
.gs-box { width: 100%; max-width: 640px; background: #fff; border-radius: 14px; box-shadow: 0 24px 64px rgba(2, 6, 23, 0.35); overflow: hidden; display: flex; flex-direction: column; max-height: 72vh; }
.gs-input-row { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
.gs-input-row .gs-icon { font-size: 18px; opacity: 0.6; }
.gs-input { flex: 1; border: 0; outline: 0; font-size: 16px; background: transparent; color: #0f172a; }
.gs-kbd { font: 600 11px/1 system-ui, sans-serif; color: #64748b; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 5px; padding: 3px 6px; }
.gs-results { overflow-y: auto; padding: 6px 0 10px; }
.gs-group { font: 700 11px/1 system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; padding: 12px 16px 6px; }
.gs-item { display: block; padding: 8px 16px; text-decoration: none; cursor: pointer; }
.gs-item.selected, .gs-item:hover { background: #eff6ff; }
.gs-item-title { display: block; font-size: 14px; font-weight: 600; color: #0f172a; }
.gs-item-title mark { background: #fde68a; color: inherit; border-radius: 3px; padding: 0 1px; }
.gs-item-sub { display: block; font-size: 12px; color: #64748b; margin-top: 1px; }
.gs-empty { padding: 28px 20px; text-align: center; font-size: 13.5px; color: #64748b; }
.gs-footer { display: flex; gap: 14px; padding: 9px 16px; border-top: 1px solid #e2e8f0; font-size: 11.5px; color: #64748b; }
.gs-footer b { font-weight: 600; color: #475569; }
html.dark-theme .gs-box { background: #1e293b; }
html.dark-theme .gs-input { color: #f1f5f9; }
html.dark-theme .gs-input-row, html.dark-theme .gs-footer { border-color: #334155; }
html.dark-theme .gs-kbd { background: #334155; border-color: #475569; color: #cbd5e1; }
html.dark-theme .gs-item.selected, html.dark-theme .gs-item:hover { background: #334155; }
html.dark-theme .gs-item-title { color: #f1f5f9; }
html.dark-theme .gs-item-title mark { background: #a16207; }
html.dark-theme .gs-group, html.dark-theme .gs-item-sub, html.dark-theme .gs-empty { color: #94a3b8; }
@media (max-width: 768px) {
  /* На телефоні палітра стає повноекранною — зручніше з клавіатурою */
  .gs-overlay { padding: 0; align-items: stretch; }
  .gs-box { max-width: none; max-height: none; height: 100%; border-radius: 0; }
  .gs-input-row { padding: 14px 14px calc(14px); }
  .gs-kbd { display: none; }
  .gs-footer { display: none; }
  .gs-item { padding: 12px 16px; }
  .gs-results { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
}
`;

function ensureOverlay() {
  if (overlay) return;
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);

  overlay = document.createElement('div');
  overlay.className = 'gs-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="gs-box" role="dialog" aria-modal="true" aria-label="Глобальний пошук">
      <div class="gs-input-row">
        <span class="gs-icon">🔍</span>
        <input class="gs-input" type="text" placeholder="Пошук по порталу: пакети, постанова, роз'яснення, договори…" autocomplete="off" spellcheck="false">
        <span class="gs-kbd">Esc</span>
      </div>
      <div class="gs-results"></div>
      <div class="gs-footer"><span><b>↑↓</b> вибір</span><span><b>Enter</b> відкрити</span><span><b>Esc</b> закрити</span></div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.gs-input');
  input.addEventListener('input', () => {
    if (!state.entries.length) return; // індекс ще вантажиться — open() відрендерить після завершення
    state.results = search(input.value);
    state.selected = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); state.selected = Math.min(state.selected + 1, state.results.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.selected = Math.max(state.selected - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); navigate(); }
    else if (e.key === 'Escape') { close(); }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.gs-results').addEventListener('mousemove', (e) => {
    const item = e.target.closest('.gs-item');
    if (item && +item.dataset.i !== state.selected) { state.selected = +item.dataset.i; render(); }
  });
}

export function close() {
  if (overlay) overlay.style.display = 'none';
}

export async function open(prefix) {
  state.prefix = prefix || './';
  ensureOverlay();
  overlay.style.display = 'flex';
  const input = overlay.querySelector('.gs-input');
  const list = overlay.querySelector('.gs-results');
  input.focus();
  input.select();
  if (!state.entries.length) {
    list.innerHTML = '<div class="gs-empty">Завантаження індексу…</div>';
    try {
      await loadIndex(state.prefix);
    } catch (err) {
      list.innerHTML = '<div class="gs-empty">Не вдалося завантажити індекс пошуку. Спробуйте оновити сторінку.</div>';
      return;
    }
  }
  state.results = search(input.value);
  state.selected = 0;
  render();
}
