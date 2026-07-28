// ═══════════════════════════════════════════════════════════════
// Стежка навігації («хлібні крихти» серфінгу по порталу)
// Плаваючий віджет: пам'ятає пройдені сторінки в межах вкладки
// (sessionStorage) і дає повернутися на будь-яку одним кліком.
// Підключається автоматично з auth-v2.js — окремо нічого вставляти
// в сторінки не треба.
// ═══════════════════════════════════════════════════════════════

const STORE_KEY = 'portal-nav-trail';
const OPEN_KEY = 'portal-nav-trail-open';
const MAX_TRAIL = 30;

// ── Стан стежки ────────────────────────────────────────────────
function loadTrail() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function saveTrail(trail) {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(trail)); } catch (_) {}
}

// Ідентичність сторінки — шлях + query (хеш ігноруємо, щоб вкладки
// на кшталт #all не плодили записи)
function pageKey() {
  return location.pathname + location.search;
}

function pageTitle() {
  // Сторінки титулуються по-різному: «X — НавігаторПМГ26» і «НавігаторПМГ26 | X»
  const t = (document.title || '')
    .replace(/^\s*НавігаторПМГ26\s*[|·—–-]\s*/i, '')
    .replace(/\s*[|·—–-]\s*НавігаторПМГ26.*$/i, '')
    .trim();
  if (t) return t;
  const seg = location.pathname.split('/').filter(Boolean);
  return seg.length ? decodeURIComponent(seg[seg.length - 1]) : 'Головна';
}

// Реєструємо поточну сторінку в стежці
function recordCurrentPage() {
  const key = pageKey();
  let trail = loadTrail();

  const idx = trail.findIndex(e => e.k === key);
  if (idx !== -1) {
    // Повернулися на вже пройдену сторінку — зрізаємо «хвіст» після неї
    trail = trail.slice(0, idx + 1);
    trail[idx] = { k: key, u: key + location.hash, t: pageTitle() };
  } else {
    trail.push({ k: key, u: key + location.hash, t: pageTitle() });
    if (trail.length > MAX_TRAIL) trail = trail.slice(trail.length - MAX_TRAIL);
  }
  saveTrail(trail);
  return trail;
}

// ── Розмітка та стилі ──────────────────────────────────────────
const CSS = `
.nav-trail {
  position: fixed;
  left: 16px; bottom: 16px;
  z-index: 10500;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  font-family: inherit;
}
@media (max-width: 980px) {
  /* не перекривати мобільний таббар */
  .nav-trail { bottom: calc(70px + env(safe-area-inset-bottom)); left: 10px; }
}

/* Рядок «кнопка + швидкий назад» */
.nav-trail-row { display: flex; align-items: center; gap: 8px; }

.nav-trail-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 1px solid var(--p-line, #e3edf3);
  background: var(--p-surface, #fff);
  font-size: 19px;
  cursor: pointer;
  box-shadow: 0 8px 22px rgba(38,78,112,.18);
  position: relative;
  padding: 0;
}
.nav-trail-toggle:hover { transform: translateY(-1px); }
.nav-trail-badge {
  position: absolute; top: -4px; right: -4px;
  min-width: 18px; height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--accent-deep, #2f6b9e);
  color: #fff;
  font-size: 10.5px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}

.nav-trail-back {
  display: inline-flex; align-items: center; gap: 6px;
  max-width: min(46vw, 260px);
  padding: 9px 14px;
  border-radius: 999px;
  border: 1px solid var(--p-line, #e3edf3);
  background: var(--p-surface, #fff);
  color: var(--p-ink, #1f3347);
  font: inherit; font-size: 12.5px; font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  box-shadow: 0 8px 22px rgba(38,78,112,.14);
  white-space: nowrap;
}
.nav-trail-back .ntb-title { overflow: hidden; text-overflow: ellipsis; }
.nav-trail-back:hover { border-color: var(--accent-deep, #2f6b9e); color: var(--accent-deep, #2f6b9e); }

/* Розгорнута панель зі стежкою */
.nav-trail-panel {
  display: none;
  flex-direction: column;
  width: min(320px, calc(100vw - 24px));
  max-height: min(56vh, 430px);
  border-radius: 16px;
  border: 1px solid var(--p-line, #e3edf3);
  background: var(--p-surface, #fff);
  box-shadow: 0 18px 44px rgba(38,78,112,.22);
  overflow: hidden;
}
.nav-trail.open .nav-trail-panel { display: flex; }

.nav-trail-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--p-line, #e3edf3);
  font-size: 12.5px; font-weight: 800; color: var(--p-muted, #647688);
}
.nav-trail-clear {
  border: 0; background: transparent;
  font: inherit; font-size: 11.5px; font-weight: 700;
  color: var(--p-muted, #647688);
  cursor: pointer; padding: 2px 4px;
}
.nav-trail-clear:hover { color: #c23b3b; }

.nav-trail-list {
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
}
.nav-trail-item {
  display: flex; align-items: baseline; gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  color: var(--p-ink, #1f3347);
  font-size: 13px; font-weight: 600;
  text-decoration: none;
  line-height: 1.35;
}
.nav-trail-item:hover { background: var(--p-soft, #f2f8fb); color: var(--accent-deep, #2f6b9e); }
.nav-trail-item .nti-no {
  flex: none;
  font-size: 10.5px; font-weight: 800;
  color: var(--p-muted, #647688);
  min-width: 16px; text-align: right;
}
.nav-trail-item.current {
  color: var(--p-muted, #647688);
  cursor: default;
  font-weight: 700;
}
.nav-trail-item.current:hover { background: transparent; color: var(--p-muted, #647688); }
.nav-trail-item.current .nti-here {
  flex: none;
  font-size: 10px; font-weight: 800;
  color: var(--accent-deep, #2f6b9e);
}

/* Темна тема (клас на <html>, змінні вже переозначені) */
:root.dark-theme .nav-trail-toggle,
:root.dark-theme .nav-trail-back,
:root.dark-theme .nav-trail-panel {
  box-shadow: 0 12px 30px rgba(0,0,0,.45);
}

@media print { .nav-trail { display: none; } }
`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Абсолютний перехід у межах origin — записи стежки зберігають
// шлях від кореня, тож працює з будь-якої глибини вкладеності
function hrefFor(entry) {
  return entry.u;
}

function render(trail) {
  // Показуємо віджет лише коли є куди повертатися
  if (trail.length < 2) return;

  const prev = trail[trail.length - 2];
  const open = sessionStorage.getItem(OPEN_KEY) === '1';

  const root = document.createElement('div');
  root.className = 'nav-trail' + (open ? ' open' : '');
  root.id = 'nav-trail';
  root.innerHTML = `
    <div class="nav-trail-panel" role="navigation" aria-label="Пройдені сторінки">
      <div class="nav-trail-head">
        <span>🧭 Пройдений шлях</span>
        <button type="button" class="nav-trail-clear" title="Забути пройдений шлях">🧹 очистити</button>
      </div>
      <div class="nav-trail-list">
        ${trail.map((e, i) => {
          const isCurrent = i === trail.length - 1;
          return isCurrent
            ? `<span class="nav-trail-item current"><span class="nti-no">${i + 1}.</span><span>${esc(e.t)}</span><span class="nti-here">ви тут</span></span>`
            : `<a class="nav-trail-item" href="${esc(hrefFor(e))}"><span class="nti-no">${i + 1}.</span><span>${esc(e.t)}</span></a>`;
        }).reverse().join('')}
      </div>
    </div>
    <div class="nav-trail-row">
      <button type="button" class="nav-trail-toggle" title="Стежка навігації: пройдені сторінки" aria-label="Стежка навігації">
        🧭<span class="nav-trail-badge">${trail.length - 1}</span>
      </button>
      <a class="nav-trail-back" href="${esc(hrefFor(prev))}" title="Повернутися: ${esc(prev.t)}">
        ← <span class="ntb-title">${esc(prev.t)}</span>
      </a>
    </div>
  `;

  root.querySelector('.nav-trail-toggle').addEventListener('click', () => {
    const isOpen = root.classList.toggle('open');
    try { sessionStorage.setItem(OPEN_KEY, isOpen ? '1' : '0'); } catch (_) {}
  });

  root.querySelector('.nav-trail-clear').addEventListener('click', () => {
    saveTrail([trail[trail.length - 1]]); // лишаємо тільки поточну сторінку
    root.remove();
  });

  document.body.appendChild(root);
}

// ── Старт ──────────────────────────────────────────────────────
function start() {
  const style = document.createElement('style');
  style.id = 'nav-trail-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  const trail = recordCurrentPage();
  render(trail);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
