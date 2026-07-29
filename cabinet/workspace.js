// ═══ Робочий простір Відділу (РпВ) ═══
// Окремий модуль кабінету: перемикач «Мій кабінет / Простір відділу»,
// дошка документів (Активні / Паркування / Завершені) для двох просторів
// (робочі документи та службові). Сховище файлів — приватний бакет
// Supabase 'dept-documents', доступ — за таблицею dept_works (RLS).

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const STATUSES = [
  { key: 'active', label: '🟢 Активні' },
  { key: 'parked', label: '🅿️ Паркування' },
  { key: 'done', label: '✅ Завершені' }
];
const KIND_ICON = { gdoc: '🔗', file: '📎', external: '🗄️' };
const KIND_LABEL = { gdoc: 'Google Doc / посилання', file: 'Завантажений файл', external: 'Зовнішнє посилання' };
const STATUS_LABEL = { active: '🟢 Активний', parked: '🅿️ Паркування', done: '✅ Завершений' };
// Маркування важливості документа
const MARKING = {
  main: { label: 'Основний', cls: 'ws-badge-main' },
  base: { label: 'Базовий', cls: 'ws-badge-base' },
  aux:  { label: 'Допоміжний', cls: 'ws-badge-aux' }
};

// Ролі, що бачать усі відділи (з фільтром)
const LEADERSHIP = ['admin', 'director', 'deputy_director'];
// Довідник відділів для фільтра (значення profiles."Section")
const DEPARTMENTS = [
  'стратегічного розвитку програми медичних гарантій',
  'наукова та клінічна експертиза',
  'розвиток програми реімбурсації',
  'взаємодія з надавачами медичних послуг',
  'розрахунок вартості медичних послуг',
  'робота з електронними медичними даними',
  'Поза відділами'
];

let me = null;            // auth user
let profile = null;       // profiles row
let myDept = '';          // department (Section)
let canManage = false;    // керівник відділу / заступник / адмін
let isLeadership = false; // директор / заступник / адмін — бачать усі відділи
let deptFilter = 'all';   // обраний відділ для керівництва ('all' — усі)
let currentMode = 'personal';
let works = [];           // документи відділу + наскрізні
let currentSpace = 'working';
let currentScope = 'department'; // 'department' — мій відділ, 'org' — наскрізні
let searchTerm = '';
let loaded = false;
let editKind = 'gdoc';    // тип у відкритій модалці
// Фільтри простору «Службові»
let svcPackage = 'all';   // 'all' | 'none' | номер пакета
let svcRelevance = 'active'; // 'active' — актуальні, 'irrelevant' — неактуальні, 'all'

document.addEventListener('DOMContentLoaded', initWorkspace);

async function initWorkspace() {
  const { data: { session } } = await sb.auth.getSession();
  me = session?.user ?? null;
  if (!me) return; // кабінет сам покаже екран доступу

  const { data: p } = await sb.from('profiles').select('*').eq('id', me.id).single();
  profile = p || {};
  myDept = profile.Section || profile.department || '';
  const isLeadershipRole = LEADERSHIP.includes(profile.role);
  // Діловод департаменту бачить дошки всіх відділів наскрізно, але не редагує чуже
  isLeadership = isLeadershipRole || profile.is_clerk === true;
  canManage = isLeadershipRole || profile.role === 'manager' || profile.is_head === true;
  deptFilter = isLeadership ? 'all' : (myDept || '');

  wireModeSwitch();
  wireSpaceTabs();
  wireScopeSwitch();
  wireDeptFilter();
  wireToolbar();
  wireDocModal();

  // Швидке копіювання номера службової (делеговано — і картки, і модалка)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    copyText(btn.dataset.copy, btn);
  });
}

function copyText(text, btn) {
  const flash = () => {
    if (!btn) return;
    const old = btn.innerHTML;
    btn.innerHTML = '✅ Скопійовано';
    setTimeout(() => { btn.innerHTML = old; }, 1100);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash).catch(() => fallbackCopy(text, flash));
  } else {
    fallbackCopy(text, flash);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  ta.remove();
  if (done) done();
}

// Назва відділу для банера в режимі «Простір відділу»
function deptBannerLabel() {
  if (isLeadership && deptFilter === 'all') return 'Усі відділи';
  return (isLeadership ? deptFilter : myDept) || 'Відділ';
}

// Відділ, у який додаються нові документи
function effectiveDept() {
  return (isLeadership && deptFilter !== 'all') ? deptFilter : myDept;
}

// Перемкнути «шапку» банера: ім'я (особистий) ↔ назва відділу (відділ)
function updateBannerHeads() {
  const personalHead = document.getElementById('ws-personal-head');
  const deptHead = document.getElementById('ws-dept-head');
  const deptName = document.getElementById('ws-dept-head-name');
  const inDept = currentMode === 'department';
  if (personalHead) personalHead.style.display = inDept ? 'none' : '';
  if (deptHead) deptHead.style.display = inDept ? '' : 'none';
  if (deptName) deptName.textContent = deptBannerLabel();
}

// Фільтр відділу (лише для керівництва)
function wireDeptFilter() {
  const sel = document.getElementById('ws-dept-filter');
  if (!sel) return;
  if (!isLeadership) { sel.style.display = 'none'; return; }

  sel.innerHTML = '<option value="all">🏢 Усі відділи</option>'
    + DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('');
  sel.value = deptFilter;
  sel.style.display = '';
  sel.addEventListener('change', () => {
    deptFilter = sel.value;
    updateBannerHeads();
    loadWorks();
  });
}

// ── Перемикач режиму «Мій кабінет / Простір відділу» ──
function wireModeSwitch() {
  const personalBtn = document.getElementById('ws-mode-personal');
  const deptBtn = document.getElementById('ws-mode-department');
  const personalView = document.getElementById('personal-view');
  const deptView = document.getElementById('workspace-view');
  if (!personalBtn || !deptBtn || !personalView || !deptView) return;

  const profileCard = document.querySelector('.cabinet-profile-card');
  const setMode = (mode) => {
    const dept = mode === 'department';
    currentMode = mode;
    personalView.style.display = dept ? 'none' : '';
    deptView.style.display = dept ? '' : 'none';
    personalBtn.classList.toggle('active', !dept);
    deptBtn.classList.toggle('active', dept);
    personalBtn.setAttribute('aria-selected', String(!dept));
    deptBtn.setAttribute('aria-selected', String(dept));
    // Банер профілю: синій (особистий) ↔ зелений (відділ) з плавним переходом,
    // ім'я ↔ назва відділу
    profileCard?.classList.toggle('ws-mode-dept', dept);
    // Планувальник — лише в особистому кабінеті
    const plannerBtn = profileCard?.querySelector('.planner-link-btn');
    if (plannerBtn) plannerBtn.style.display = dept ? 'none' : '';
    updateBannerHeads();
    if (dept && !loaded) loadWorks();
    try { localStorage.setItem('cabinet-mode', mode); } catch (_) {}
  };

  personalBtn.addEventListener('click', () => setMode('personal'));
  deptBtn.addEventListener('click', () => setMode('department'));

  const deptNameEl = document.getElementById('ws-dept-name');
  if (deptNameEl) deptNameEl.textContent = myDept || 'Відділ не визначено';

  let saved = 'personal';
  try { saved = localStorage.getItem('cabinet-mode') || 'personal'; } catch (_) {}
  if (saved === 'department') setMode('department');
}

// ── Вкладки просторів (робочі / службові) ──
function wireSpaceTabs() {
  document.querySelectorAll('.ws-space-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ws-space-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentSpace = tab.dataset.space;
      renderBoard();
    });
  });
}

// ── Перемикач області (мій відділ / наскрізні) ──
function wireScopeSwitch() {
  document.querySelectorAll('.ws-scope-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ws-scope-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentScope = btn.dataset.scope;
      updateAddBtnVisibility();
      renderBoard();
    });
  });
}

// Наскрізні документи створює лише керівництво
function updateAddBtnVisibility() {
  const addBtn = document.getElementById('ws-add-btn');
  if (!addBtn) return;
  const canAdd = currentScope === 'department' ? (profile.role !== 'guest') : canManage;
  addBtn.style.display = canAdd ? '' : 'none';
}

function wireToolbar() {
  const search = document.getElementById('ws-search');
  if (search) {
    search.addEventListener('input', () => {
      searchTerm = search.value.trim().toLocaleLowerCase('uk');
      renderBoard();
    });
  }
  const addBtn = document.getElementById('ws-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => openDocModal(null));
  updateAddBtnVisibility();
}

// ── Завантаження документів відділу ──
async function loadWorks() {
  const board = document.getElementById('ws-board');
  if (board) board.innerHTML = '<div class="ws-loading">Завантаження робочого простору…</div>';

  if (!myDept && !isLeadership) {
    if (board) board.innerHTML = '<div class="ws-empty">Ваш профіль не прив\'язаний до відділу. Зверніться до адміністратора.</div>';
    loaded = true;
    return;
  }

  // Відділкові документи: свій відділ; для керівництва — обраний або всі.
  // Наскрізні (scope='org') — завжди всі. RLS фільтрує дозволене.
  const viewingAll = isLeadership && deptFilter === 'all';
  let deptQuery = sb.from('dept_works').select('*').eq('scope', 'department')
    .order('priority', { ascending: true }).order('created_at', { ascending: false });
  if (!viewingAll) {
    deptQuery = deptQuery.eq('department', isLeadership ? deptFilter : myDept);
  }

  const [deptRes, orgRes] = await Promise.all([
    deptQuery,
    sb.from('dept_works').select('*')
      .eq('scope', 'org')
      .order('priority', { ascending: true }).order('created_at', { ascending: false })
  ]);

  const error = deptRes.error || orgRes.error;
  if (error) {
    if (board) board.innerHTML = `<div class="ws-empty" style="color:#b91c1c">Помилка завантаження: ${escapeHtml(error.message)}.<br>Перевірте, чи застосована міграція dept_works.</div>`;
    loaded = true;
    return;
  }

  // Злиття без дублів (наскрізний документ свого відділу міг потрапити в обидва)
  const byId = new Map();
  [...(deptRes.data || []), ...(orgRes.data || [])].forEach(w => byId.set(w.id, w));
  works = [...byId.values()];
  loaded = true;
  renderBoard();
}

// ── Рендер дошки ──
function renderBoard() {
  const board = document.getElementById('ws-board');
  if (!board) return;

  // Службові — окремий вигляд (список із фільтром по пакетах, без канбану)
  if (currentSpace === 'service') { board.classList.add('ws-board-list'); return renderServiceList(); }
  board.classList.remove('ws-board-list');

  const inScope = works.filter(w => (w.scope || 'department') === currentScope
    && (w.space || 'working') === currentSpace);
  const filtered = searchTerm
    ? inScope.filter(w =>
        (w.title || '').toLocaleLowerCase('uk').includes(searchTerm) ||
        (w.description || '').toLocaleLowerCase('uk').includes(searchTerm))
    : inScope;

  if (!inScope.length) {
    const spaceLabel = currentSpace === 'service' ? 'Службові' : 'Робочі документи';
    const scopeNote = currentScope === 'org'
      ? 'Наскрізних документів у цьому просторі ще немає.'
      : `У просторі «${spaceLabel}» ще немає документів.`;
    const addNote = (currentScope === 'org' && !canManage)
      ? 'Наскрізні документи додає керівництво.'
      : 'Натисніть «➕ Додати документ», щоб почати.';
    board.innerHTML = `<div class="ws-empty">${scopeNote}<br>${addNote}</div>`;
    return;
  }

  board.innerHTML = STATUSES.map(st => {
    const cards = filtered
      .filter(w => (w.status || 'active') === st.key)
      .sort((a, b) => (a.priority - b.priority) || (new Date(b.created_at) - new Date(a.created_at)));
    const inner = cards.length
      ? cards.map(cardHtml).join('')
      : '<div class="ws-col-empty">— порожньо —</div>';
    return `
      <div class="ws-col" data-status="${st.key}">
        <div class="ws-col-head">${st.label}<span class="ws-col-count">${cards.length}</span></div>
        <div class="ws-col-body" data-status="${st.key}">${inner}</div>
      </div>`;
  }).join('');

  wireCards();
  wireDnd();
}

// Пакет документа: із service_meta.package або розбір із опису «Пакет № N — Назва»
function docPackage(w) {
  const sm = w.service_meta || {};
  if (sm.package) return { num: String(sm.package), name: sm.packageName || '' };
  const m = (w.description || '').match(/Пакет\s*№\s*(\d+)\s*[—–-]\s*(.+)/);
  if (m) return { num: m[1], name: m[2].trim() };
  return null;
}

// ── Простір «Службові»: список із фільтром по пакетах та актуальності ──
function renderServiceList() {
  const board = document.getElementById('ws-board');
  if (!board) return;

  const all = works.filter(w => (w.scope || 'department') === currentScope && (w.space || 'working') === 'service');

  // Довідник пакетів серед наявних документів
  const pkgMap = new Map();
  let hasNoPkg = false;
  all.forEach(w => { const p = docPackage(w); if (p) { if (!pkgMap.has(p.num)) pkgMap.set(p.num, p.name); } else hasNoPkg = true; });
  const pkgSorted = [...pkgMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));

  const activeCount = all.filter(w => w.status !== 'done').length;
  const irrelevantCount = all.length - activeCount;

  // Застосувати фільтри
  let list = all.slice();
  if (svcPackage === 'none') list = list.filter(w => !docPackage(w));
  else if (svcPackage !== 'all') list = list.filter(w => docPackage(w)?.num === svcPackage);
  if (svcRelevance === 'active') list = list.filter(w => w.status !== 'done');
  else if (svcRelevance === 'irrelevant') list = list.filter(w => w.status === 'done');
  if (searchTerm) list = list.filter(w =>
    (w.title || '').toLocaleLowerCase('uk').includes(searchTerm) ||
    (w.description || '').toLocaleLowerCase('uk').includes(searchTerm) ||
    ((w.service_meta || {}).marking || '').toLocaleLowerCase('uk').includes(searchTerm));

  if (!all.length) {
    board.innerHTML = `<div class="ws-empty">Службових документів у цій області ще немає.<br>${(currentScope === 'org' && !canManage) ? 'Наскрізні службові додає керівництво.' : 'Натисніть «➕ Додати документ», щоб почати.'}</div>`;
    return;
  }

  const pkgOptions = ['<option value="all">📦 Усі пакети</option>']
    .concat(pkgSorted.map(([num, name]) =>
      `<option value="${num}" ${svcPackage === num ? 'selected' : ''}>№ ${num} — ${escapeHtml(name.length > 42 ? name.slice(0, 42) + '…' : name)}</option>`));
  if (hasNoPkg) pkgOptions.push(`<option value="none" ${svcPackage === 'none' ? 'selected' : ''}>Без пакета</option>`);

  const bar = `
    <div class="ws-svc-bar">
      <select id="ws-svc-package" class="ws-dept-filter" aria-label="Пакет">${pkgOptions.join('')}</select>
      <div class="ws-scope-switch ws-svc-relevance" role="tablist" aria-label="Актуальність">
        <button type="button" class="ws-scope-btn ${svcRelevance === 'active' ? 'active' : ''}" data-rel="active">Актуальні (${activeCount})</button>
        <button type="button" class="ws-scope-btn ${svcRelevance === 'irrelevant' ? 'active' : ''}" data-rel="irrelevant">Неактуальні (${irrelevantCount})</button>
        <button type="button" class="ws-scope-btn ${svcRelevance === 'all' ? 'active' : ''}" data-rel="all">Усі (${all.length})</button>
      </div>
    </div>`;

  const listHtml = list.length
    ? `<div class="ws-svc-list">${list.map(serviceCardHtml).join('')}</div>`
    : '<div class="ws-empty">Немає службових документів за обраним фільтром.</div>';

  board.innerHTML = bar + listHtml;

  document.getElementById('ws-svc-package')?.addEventListener('change', (e) => { svcPackage = e.target.value; renderServiceList(); });
  board.querySelectorAll('[data-rel]').forEach(b => b.addEventListener('click', () => { svcRelevance = b.dataset.rel; renderServiceList(); }));
  board.querySelectorAll('[data-relevance]').forEach(b => b.addEventListener('click', () => toggleRelevance(b.dataset.relevance)));
  wireCards();
}

function serviceCardHtml(w) {
  const canEdit = canEditWork(w);
  const svc = w.service_meta || {};
  const pkg = docPackage(w);
  const irrelevant = w.status === 'done';

  const badges = [];
  badges.push(irrelevant
    ? '<span class="ws-badge ws-badge-irrelevant">🗄️ Неактуальна</span>'
    : '<span class="ws-badge ws-badge-actual">🟢 Актуальна</span>');
  if (pkg) badges.push(`<span class="ws-badge ws-badge-pkg" title="${escapeAttr(pkg.name)}">Пакет № ${escapeHtml(pkg.num)}</span>`);
  if (svc.type) badges.push(`<span class="ws-badge ws-badge-svc">${escapeHtml(svc.type)}</span>`);
  if (w.marking && MARKING[w.marking]) badges.push(`<span class="ws-badge ${MARKING[w.marking].cls}">${MARKING[w.marking].label}</span>`);
  if (w.scope === 'org' && isLeadership && deptFilter === 'all' && w.department) badges.push(`<span class="ws-badge ws-badge-dept">${escapeHtml(w.department)}</span>`);
  if (w.visibility === 'restricted') badges.push('<span class="ws-badge ws-badge-restricted">🔒 обмежено</span>');
  if (svc.marking) badges.push(`<button type="button" class="ws-copy-num" data-copy="${escapeAttr(svc.marking)}" title="Скопіювати номер службової">📋 ${escapeHtml(svc.marking)}</button>`);

  const openBtn = (w.kind === 'file')
    ? `<button type="button" class="ws-card-view" data-open-file="${w.id}">📎 Файл</button>`
    : (w.url ? `<a class="ws-card-view" href="${escapeAttr(w.url)}" target="_blank" rel="noopener">🔗 Відкрити</a>` : '');

  return `
    <div class="ws-svc-card ${irrelevant ? 'ws-card-irrelevant' : ''}" data-id="${w.id}">
      <div class="ws-svc-main">
        <div class="ws-svc-title">${escapeHtml(w.title || 'Без назви')}</div>
        <div class="ws-svc-badges">${badges.join(' ')}</div>
      </div>
      <div class="ws-svc-actions">
        <button type="button" class="ws-card-view" data-view="${w.id}">👁️ Опис</button>
        ${openBtn}
        ${canEdit ? `<button type="button" class="ws-card-view" data-relevance="${w.id}">${irrelevant ? '♻️ Актуальна' : '🗄️ Неактуальна'}</button>` : ''}
        ${canEdit ? `<button type="button" class="ws-card-edit" data-edit="${w.id}">✏️ Змінити</button>` : ''}
      </div>
    </div>`;
}

async function toggleRelevance(id) {
  const w = works.find(x => x.id === id);
  if (!w || !canEditWork(w)) return;
  const newStatus = w.status === 'done' ? 'active' : 'done';
  w.status = newStatus;
  renderServiceList();
  const { error } = await sb.from('dept_works').update({ status: newStatus }).eq('id', id);
  if (error) { alert('Помилка збереження: ' + error.message); loadWorks(); }
}

function cardHtml(w) {
  const icon = KIND_ICON[w.kind] || '📄';
  const canEdit = canEditWork(w);
  const svc = w.service_meta || {};
  const badges = [];
  if (w.marking && MARKING[w.marking]) badges.push(`<span class="ws-badge ${MARKING[w.marking].cls}">${MARKING[w.marking].label}</span>`);
  if (w.scope === 'org') badges.push('<span class="ws-badge ws-badge-org">🌐 наскрізний</span>');
  // Показуємо відділ: для наскрізних (джерело) та коли керівництво дивиться «Усі відділи»
  const showDept = (w.scope === 'org') || (isLeadership && deptFilter === 'all' && currentScope === 'department');
  if (showDept && w.department) badges.push(`<span class="ws-badge ws-badge-dept">${escapeHtml(w.department)}</span>`);
  if (currentSpace === 'service' && svc.type) badges.push(`<span class="ws-badge ws-badge-svc">${escapeHtml(svc.type)}</span>`);
  if (currentSpace === 'service' && svc.marking) badges.push(`<button type="button" class="ws-copy-num" data-copy="${escapeAttr(svc.marking)}" title="Скопіювати номер службової">📋 ${escapeHtml(svc.marking)}</button>`);
  if (w.visibility === 'restricted') badges.push('<span class="ws-badge ws-badge-restricted">🔒 обмежено</span>');

  const openLabel = w.kind === 'file' ? '📎 Відкрити файл' : '🔗 Відкрити';
  const openBtn = (w.kind === 'file')
    ? `<button type="button" class="ws-card-open" data-open-file="${w.id}">${openLabel}</button>`
    : (w.url ? `<a class="ws-card-open" href="${escapeAttr(w.url)}" target="_blank" rel="noopener">${openLabel}</a>` : '');

  return `
    <div class="ws-card" draggable="${canEdit ? 'true' : 'false'}" data-id="${w.id}">
      <div class="ws-card-top">
        <span class="ws-card-kind">${icon}</span>
        <span class="ws-card-title">${escapeHtml(w.title || 'Без назви')}</span>
      </div>
      ${w.description ? `<div class="ws-card-desc">${escapeHtml(w.description)}</div>` : ''}
      <div class="ws-card-meta">
        ${badges.join(' ')}
        <span>${escapeHtml(w.owner_name || w.created_by_name || '')}</span>
      </div>
      <div class="ws-card-actions">
        <button type="button" class="ws-card-view" data-view="${w.id}" title="Експрес-опис">👁️ Опис</button>
        ${openBtn}
        ${canEdit ? `<button type="button" class="ws-card-edit" data-edit="${w.id}">✏️ Змінити</button>` : ''}
      </div>
    </div>`;
}

function canEditWork(w) {
  return w.owner_id === me.id || w.created_by === me.id || canManage;
}

function wireCards() {
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = works.find(x => x.id === btn.dataset.edit);
      if (w) openDocModal(w);
    });
  });
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = works.find(x => x.id === btn.dataset.view);
      if (w) openQuickView(w);
    });
  });
  document.querySelectorAll('[data-open-file]').forEach(btn => {
    btn.addEventListener('click', () => openFile(btn.dataset.openFile, btn));
  });
}

// ── Експрес-перегляд документа (лише читання) ──
function openQuickView(w) {
  const modal = document.getElementById('ws-qv-modal');
  if (!modal) return;

  document.getElementById('ws-qv-title').textContent = w.title || 'Без назви';

  // Бейджі
  const badges = [];
  if (w.marking && MARKING[w.marking]) badges.push(`<span class="ws-badge ${MARKING[w.marking].cls}">${MARKING[w.marking].label}</span>`);
  if (w.scope === 'org') badges.push('<span class="ws-badge ws-badge-org">🌐 наскрізний</span>');
  if (w.visibility === 'restricted') badges.push('<span class="ws-badge ws-badge-restricted">🔒 обмежено</span>');
  const svc = w.service_meta || {};
  if (svc.type) badges.push(`<span class="ws-badge ws-badge-svc">${escapeHtml(svc.type)}</span>`);
  document.getElementById('ws-qv-badges').innerHTML = badges.join(' ');

  // Опис
  const descEl = document.getElementById('ws-qv-desc');
  descEl.textContent = w.description || 'Опис не додано.';
  descEl.style.opacity = w.description ? '1' : '.6';

  // Метадані
  const rows = [];
  rows.push({ k: 'Тип', v: KIND_LABEL[w.kind] || '—' });
  rows.push({ k: 'Стан', v: STATUS_LABEL[w.status] || w.status || '—' });
  if (w.department) rows.push({ k: 'Відділ', v: w.department });
  if (svc.marking) rows.push({ k: 'Реєстр. № / позначка', v: svc.marking, copy: true });
  rows.push({ k: 'Власник', v: w.owner_name || w.created_by_name || '—' });
  if (w.updated_at) rows.push({ k: 'Оновлено', v: fmtDate(w.updated_at) });
  else if (w.created_at) rows.push({ k: 'Створено', v: fmtDate(w.created_at) });
  document.getElementById('ws-qv-meta').innerHTML = rows.map(r => {
    const val = escapeHtml(String(r.v));
    const copyBtn = r.copy
      ? ` <button type="button" class="ws-copy-num" data-copy="${escapeAttr(String(r.v))}" title="Скопіювати номер">📋 копіювати</button>`
      : '';
    return `<dt>${r.k}</dt><dd>${val}${copyBtn}</dd>`;
  }).join('');

  // Кнопки відкриття
  const openLink = document.getElementById('ws-qv-open');
  const openFileBtn = document.getElementById('ws-qv-open-file');
  openLink.style.display = 'none';
  openFileBtn.style.display = 'none';
  if (w.kind === 'file' && w.storage_path) {
    openFileBtn.style.display = '';
    openFileBtn.onclick = () => openFile(w.id, openFileBtn);
  } else if (w.url) {
    openLink.style.display = '';
    openLink.href = w.url;
  }

  // Кнопка «Змінити» — лише за наявності прав
  const editBtn = document.getElementById('ws-qv-edit');
  if (canEditWork(w)) {
    editBtn.style.display = '';
    editBtn.onclick = () => { modal.style.display = 'none'; openDocModal(w); };
  } else {
    editBtn.style.display = 'none';
  }

  modal.style.display = 'flex';
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('uk-UA') + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return iso; }
}

async function openFile(id, btn) {
  const w = works.find(x => x.id === id);
  if (!w || !w.storage_path) { alert('Файл не знайдено.'); return; }
  const old = btn.textContent;
  btn.textContent = '⏳…';
  const { data, error } = await sb.storage.from('dept-documents').createSignedUrl(w.storage_path, 3600);
  btn.textContent = old;
  if (error || !data?.signedUrl) { alert('Не вдалося відкрити файл: ' + (error?.message || 'невідома помилка')); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
}

// ── Drag & drop між колонками (зміна статусу + пріоритет) ──
let dragId = null;
function wireDnd() {
  document.querySelectorAll('.ws-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      dragId = null;
      card.classList.remove('dragging');
      document.querySelectorAll('.ws-col-body').forEach(b => b.classList.remove('drag-over'));
    });
  });

  document.querySelectorAll('.ws-col-body').forEach(body => {
    body.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      body.classList.remove('drag-over');
      if (!dragId) return;
      const newStatus = body.dataset.status;
      const afterEl = dragAfterElement(body, e.clientY);
      handleDrop(dragId, newStatus, afterEl ? afterEl.dataset.id : null);
    });
  });
}

function dragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.ws-card:not(.dragging)')];
  return cards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: -Infinity, element: null }).element;
}

async function handleDrop(id, newStatus, beforeId) {
  const w = works.find(x => x.id === id);
  if (!w || !canEditWork(w)) return;

  // Побудувати новий порядок колонки-призначення в межах поточних простору й області
  const col = works
    .filter(x => (x.scope || 'department') === currentScope && (x.space || 'working') === currentSpace
      && (x.status || 'active') === newStatus && x.id !== id)
    .sort((a, b) => (a.priority - b.priority) || (new Date(b.created_at) - new Date(a.created_at)));

  const insertIdx = beforeId ? col.findIndex(x => x.id === beforeId) : col.length;
  const ordered = [...col];
  ordered.splice(insertIdx < 0 ? col.length : insertIdx, 0, w);

  // Оптимістично оновити локальний стан
  w.status = newStatus;
  ordered.forEach((x, i) => { x.priority = i * 10; });
  renderBoard();

  // Зберегти: статус переміщеної + пріоритети всієї колонки
  try {
    await sb.from('dept_works').update({ status: newStatus, priority: w.priority }).eq('id', w.id);
    await Promise.all(ordered
      .filter(x => x.id !== w.id)
      .map(x => sb.from('dept_works').update({ priority: x.priority }).eq('id', x.id)));
  } catch (err) {
    console.error('Помилка збереження порядку:', err);
    loadWorks(); // перезавантажити істинний стан
  }
}

// ── Модалка документа ──
function wireDocModal() {
  const modal = document.getElementById('ws-doc-modal');
  if (!modal) return;
  const close = () => { modal.style.display = 'none'; };
  document.getElementById('ws-doc-close')?.addEventListener('click', close);
  document.getElementById('ws-doc-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  document.querySelectorAll('.ws-kind-btn').forEach(btn => {
    btn.addEventListener('click', () => setEditKind(btn.dataset.kind));
  });

  document.getElementById('ws-doc-save')?.addEventListener('click', saveDoc);
  document.getElementById('ws-doc-delete')?.addEventListener('click', deleteDoc);

  // Модалка експрес-перегляду
  const qv = document.getElementById('ws-qv-modal');
  if (qv) {
    const qvClose = () => { qv.style.display = 'none'; };
    document.getElementById('ws-qv-close')?.addEventListener('click', qvClose);
    document.getElementById('ws-qv-cancel')?.addEventListener('click', qvClose);
    qv.addEventListener('click', (e) => { if (e.target === qv) qvClose(); });
  }
}

function setEditKind(kind) {
  editKind = kind;
  document.querySelectorAll('.ws-kind-btn').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
  const urlGroup = document.getElementById('ws-doc-url-group');
  const fileGroup = document.getElementById('ws-doc-file-group');
  if (urlGroup) urlGroup.style.display = (kind === 'file') ? 'none' : '';
  if (fileGroup) fileGroup.style.display = (kind === 'file') ? '' : 'none';
}

function openDocModal(w) {
  const modal = document.getElementById('ws-doc-modal');
  if (!modal) return;
  const isNew = !w;

  document.getElementById('ws-doc-modal-title').textContent =
    isNew ? (currentSpace === 'service' ? 'Новий службовий документ' : 'Новий документ') : 'Редагування документа';
  document.getElementById('ws-doc-id').value = w?.id || '';
  document.getElementById('ws-doc-title').value = w?.title || '';
  document.getElementById('ws-doc-url').value = w?.url || '';
  document.getElementById('ws-doc-status').value = w?.status || 'active';
  document.getElementById('ws-doc-marking').value = w?.marking || '';
  document.getElementById('ws-doc-desc').value = w?.description || '';
  document.getElementById('ws-doc-file').value = '';

  setEditKind(w?.kind || (currentSpace === 'service' ? 'gdoc' : 'gdoc'));

  // Поточний файл (при редагуванні kind=file)
  const cur = document.getElementById('ws-doc-file-current');
  if (cur) {
    if (w?.kind === 'file' && w?.file_name) {
      cur.style.display = '';
      cur.textContent = 'Поточний файл: ' + w.file_name + ' (завантажте новий, щоб замінити)';
    } else {
      cur.style.display = 'none';
      cur.textContent = '';
    }
  }

  // Службові поля. Для службових канбан-стан ховаємо (замість нього — актуальність)
  const isService = currentSpace === 'service';
  const statusGroup = document.getElementById('ws-status-group');
  if (statusGroup) statusGroup.style.display = isService ? 'none' : '';
  const svcFields = document.getElementById('ws-service-fields');
  if (svcFields) svcFields.style.display = isService ? '' : 'none';
  const svc = w?.service_meta || {};
  document.getElementById('ws-doc-relevance').value = (w?.status === 'done') ? 'done' : 'active';
  document.getElementById('ws-doc-svc-type').value = svc.type || '';
  document.getElementById('ws-doc-svc-package').value = (svc.package != null ? svc.package : (w ? (docPackage(w)?.num || '') : '')) || '';
  document.getElementById('ws-doc-svc-marking').value = svc.marking || '';

  // Область (мій відділ / наскрізний) — селектор лише для керівництва
  const scopeGroup = document.getElementById('ws-scope-group');
  const scopeSel = document.getElementById('ws-doc-scope');
  if (scopeSel) scopeSel.value = w?.scope || currentScope;
  if (scopeGroup) scopeGroup.style.display = canManage ? '' : 'none';

  // Видимість — редагує лише керівництво
  const visSel = document.getElementById('ws-doc-visibility');
  const visHint = document.getElementById('ws-vis-hint');
  visSel.value = w?.visibility || 'department';
  visSel.disabled = !canManage;
  if (visHint) visHint.style.display = canManage ? 'none' : '';

  // Кнопка видалення — лише при редагуванні і за наявності прав
  const delBtn = document.getElementById('ws-doc-delete');
  if (delBtn) delBtn.style.display = (!isNew && w && canEditWork(w)) ? '' : 'none';

  modal.style.display = 'flex';
}

async function saveDoc() {
  const saveBtn = document.getElementById('ws-doc-save');
  const id = document.getElementById('ws-doc-id').value;
  const title = document.getElementById('ws-doc-title').value.trim();
  const url = document.getElementById('ws-doc-url').value.trim();
  const status = document.getElementById('ws-doc-status').value;
  const description = document.getElementById('ws-doc-desc').value.trim();
  const visibility = document.getElementById('ws-doc-visibility').value;
  const fileInput = document.getElementById('ws-doc-file');
  const file = fileInput?.files?.[0] || null;

  if (!title) { alert('Вкажіть назву документа.'); return; }
  if (editKind !== 'file' && !url) { alert('Вкажіть посилання на документ.'); return; }
  if (editKind === 'file' && !file && !id) { alert('Оберіть файл для завантаження.'); return; }
  if (!id && !effectiveDept()) { alert('Оберіть конкретний відділ у фільтрі, щоб додати документ.'); return; }

  saveBtn.disabled = true;
  const oldText = saveBtn.textContent;
  saveBtn.textContent = '⏳ Збереження…';

  try {
    // Область: керівництво обирає в модалці; решта — поточна область.
    // Наскрізний документ дозволено створювати лише керівництву.
    let scope = canManage ? (document.getElementById('ws-doc-scope').value || currentScope) : currentScope;
    if (scope === 'org' && !canManage) scope = 'department';

    const rec = {
      scope,
      space: currentSpace,
      title,
      description: description || null,
      kind: editKind,
      status,
      marking: document.getElementById('ws-doc-marking').value || null,
      visibility: canManage ? visibility : (id ? undefined : 'department')
    };
    if (rec.visibility === undefined) delete rec.visibility;
    // Відділ ставимо лише для нового документа (при редагуванні не переносимо)
    if (!id) rec.department = effectiveDept();

    if (editKind === 'file') {
      if (file) {
        // ASCII-ключ (UUID + розширення) — оригінальну назву зберігаємо у file_name
        const ext = (file.name.split('.').pop() || 'bin').replace(/[^\w]+/g, '').slice(0, 12) || 'bin';
        const path = `dept/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await sb.storage.from('dept-documents').upload(path, file, { upsert: false });
        if (upErr) throw new Error('Завантаження файлу: ' + upErr.message);
        rec.storage_path = path;
        rec.file_name = file.name;
        rec.url = null;
      }
    } else {
      rec.url = url;
      rec.storage_path = null;
      rec.file_name = null;
    }

    if (currentSpace === 'service') {
      // Стан службового = актуальність (актуальна → active, неактуальна → done)
      rec.status = document.getElementById('ws-doc-relevance').value === 'done' ? 'done' : 'active';
      const pkgNum = document.getElementById('ws-doc-svc-package').value.trim();
      rec.service_meta = {
        type: document.getElementById('ws-doc-svc-type').value || null,
        package: pkgNum || null,
        marking: document.getElementById('ws-doc-svc-marking').value.trim() || null
      };
    }

    if (id) {
      const { error } = await sb.from('dept_works').update(rec).eq('id', id);
      if (error) throw error;
    } else {
      rec.owner_id = me.id;
      rec.owner_name = profile.full_name || null;
      rec.created_by = me.id;
      rec.created_by_name = profile.full_name || null;
      rec.priority = nextPriority(status);
      const { error } = await sb.from('dept_works').insert(rec);
      if (error) throw error;
    }

    document.getElementById('ws-doc-modal').style.display = 'none';
    // Синхронізувати вигляд з областю збереженого документа, щоб він був видимий
    if (scope !== currentScope) {
      currentScope = scope;
      document.querySelectorAll('.ws-scope-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === scope));
      updateAddBtnVisibility();
    }
    await loadWorks();
  } catch (err) {
    console.error('Помилка збереження документа:', err);
    alert('Помилка збереження: ' + (err.message || err));
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = oldText;
  }
}

function nextPriority(status) {
  const col = works.filter(w => (w.scope || 'department') === currentScope
    && (w.space || 'working') === currentSpace && (w.status || 'active') === status);
  return col.length ? Math.max(...col.map(w => w.priority || 0)) + 10 : 0;
}

async function deleteDoc() {
  const id = document.getElementById('ws-doc-id').value;
  if (!id) return;
  const w = works.find(x => x.id === id);
  if (!w) return;
  if (!confirm(`Видалити «${w.title}»? Дію не можна скасувати.`)) return;

  try {
    if (w.kind === 'file' && w.storage_path) {
      await sb.storage.from('dept-documents').remove([w.storage_path]);
    }
    const { error } = await sb.from('dept_works').delete().eq('id', id);
    if (error) throw error;
    document.getElementById('ws-doc-modal').style.display = 'none';
    await loadWorks();
  } catch (err) {
    console.error('Помилка видалення:', err);
    alert('Помилка видалення: ' + (err.message || err));
  }
}

// ── Утиліти ──
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(v) {
  return escapeHtml(v).replace(/`/g, '&#96;');
}
