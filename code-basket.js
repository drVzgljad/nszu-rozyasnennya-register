// ═══════════════════════════════════════════════════════════════
// Кошик кодів — плаваюче вікно на всіх сторінках порталу.
//
// Навіщо. Випадок збирається з кодів, які лежать у РІЗНИХ розділах:
// діагноз шукають у НК 025, втручання в НК 026, потім усе це треба
// набрати в групері. Досі єдиним способом було переписати коди на
// папірець або тримати три вкладки. Тепер код відкладається в кошик
// одним кліком там, де його знайшли, а групер приймає весь набір
// відразу через ?q=.
//
// Підключається автоматично з auth-v2.js — окремо в сторінки нічого
// вставляти не треба. Сторінка, яка хоче віддавати коди, малює кнопку
// з атрибутами data-basket-add / data-code / data-kind / data-name;
// клік по ній ловить делегований обробник нижче.
// ═══════════════════════════════════════════════════════════════

const STORE_KEY = 'portal-code-basket';
const OPEN_KEY = 'portal-code-basket-open';
const MAX_ITEMS = 24;

/* localStorage, а не sessionStorage: кошик збирають днями і між
   вкладками — на відміну від стежки навігації, яка живе одну сесію. */
function load() {
  try {
    const arr = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => x && x.c) : [];
  } catch (_) { return []; }
}

function save(items) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS))); } catch (_) {}
}

const KIND_LABEL = { dx: 'НК 025', iv: 'НК 026', drg: 'ДСГ', svc: 'послуга' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── Стан ───────────────────────────────────────────────────────
let items = load();
const listeners = new Set();

function emit() {
  save(items);
  paint();
  listeners.forEach((fn) => { try { fn(items.slice()); } catch (_) {} });
  /* Сторінки, відкриті в сусідніх вкладках, мають побачити те саме:
     подія storage у них спрацює сама, тут лише свою вкладку оновлюємо. */
}

function add(code, kind, name) {
  const c = String(code || '').trim();
  if (!c) return false;
  if (items.some((x) => x.c === c)) return false;
  items = [...items, { c, k: kind || '', n: name || '' }].slice(-MAX_ITEMS);
  emit();
  return true;
}

function remove(code) {
  const n = items.length;
  items = items.filter((x) => x.c !== code);
  if (items.length !== n) emit();
}

const has = (code) => items.some((x) => x.c === code);

function clear() { items = []; emit(); }

// ── Вигляд ─────────────────────────────────────────────────────
const CSS = `
.cbask {
  position: fixed; right: 16px; bottom: var(--cb-bottom, 16px);
  z-index: 10500; display: flex; flex-direction: column; align-items: flex-end;
  gap: 8px; font-family: inherit;
}
@media (max-width: 980px) {
  .cbask { bottom: var(--cb-bottom, calc(70px + env(safe-area-inset-bottom))); right: 10px; }
}
.cbask-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; border-radius: 50%; padding: 0;
  border: 1px solid var(--p-line, #e3edf3); background: var(--p-surface, #fff);
  color: var(--p-ink, #1f3347); font-size: 19px; cursor: pointer; position: relative;
  box-shadow: 0 8px 22px rgba(38,78,112,.18);
}
.cbask-toggle:hover { transform: translateY(-1px); }
.cbask-badge {
  position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px;
  padding: 0 4px; border-radius: 9px; background: var(--accent-deep, #2f6b9e);
  color: #fff; font-size: 10.5px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}
.cbask-panel {
  width: min(92vw, 340px); max-height: min(64vh, 460px); overflow: auto;
  background: var(--p-surface, #fff); border: 1px solid var(--p-line, #e3edf3);
  border-radius: 14px; box-shadow: 0 14px 34px rgba(38,78,112,.22);
}
.cbask-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  padding: 11px 14px; border-bottom: 1px solid var(--p-line, #e3edf3);
  font-size: 13.5px; font-weight: 700; color: var(--p-ink, #1f3347);
}
.cbask-head span { font-size: 12px; font-weight: 400; color: var(--muted, #5b7185); }
.cbask-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 14px;
  border-bottom: 1px solid var(--p-line, #eef3f7);
}
.cbask-code {
  font-family: ui-monospace, Consolas, monospace; font-weight: 700; font-size: 13.5px;
  color: var(--p-ink, #1f3347); flex: 0 0 auto;
}
.cbask-name {
  flex: 1; min-width: 0; font-size: 12.5px; color: var(--muted, #5b7185);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cbask-tag { flex: 0 0 auto; font-size: 11px; color: var(--faint, #8298aa); }
.cbask-del {
  flex: 0 0 auto; border: 0; background: none; cursor: pointer; font-size: 15px;
  color: var(--faint, #8298aa); padding: 2px 4px; line-height: 1;
}
.cbask-del:hover { color: var(--p-ink, #1f3347); }
.cbask-empty { padding: 14px; font-size: 12.5px; color: var(--muted, #5b7185); line-height: 1.55; }
.cbask-acts { display: flex; flex-wrap: wrap; gap: 6px; padding: 11px 14px; }
.cbask-btn {
  font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
  padding: 7px 12px; border-radius: 9px; text-decoration: none;
  border: 1px solid var(--p-line, #e3edf3); background: var(--p-surface, #fff);
  color: var(--p-ink, #1f3347);
}
.cbask-btn:hover { border-color: var(--accent-deep, #2f6b9e); }
.cbask-btn-main {
  background: var(--accent-deep, #2f6b9e); border-color: var(--accent-deep, #2f6b9e); color: #fff;
}
/* Кнопка «відкласти», яку малюють самі розділи */
.cbask-add {
  font: inherit; font-size: 12.5px; cursor: pointer; padding: 3px 9px;
  border-radius: 8px; border: 1px dashed var(--accent, #4a90c2);
  background: transparent; color: var(--accent-dark, #2f6b9e); white-space: nowrap;
}
.cbask-add:hover { border-style: solid; }
.cbask-add.on { border-style: solid; background: var(--kd-ok-bg, #eaf7f0); }
`;

let root = null;

/* Групер приймає весь набір одним рядком — саме заради цього в розділі
   «Кодування випадку» з'явився параметр ?q=. Порядок збереження важливий:
   перший діагноз у стрічці читається як основний. */
function grouperHref() {
  const codes = items.map((x) => x.c).join(' ');
  return '/koduvannia/index.html?q=' + encodeURIComponent(codes);
}

function paint() {
  if (!root) return;
  const open = root.dataset.open === '1';
  const n = items.length;
  root.innerHTML = `
    ${open ? `<div class="cbask-panel">
      <div class="cbask-head">Кошик кодів <span>${n ? n + ' з ' + MAX_ITEMS : 'порожній'}</span></div>
      ${n ? items.map((x) => `<div class="cbask-row">
          <span class="cbask-code">${esc(x.c)}</span>
          <span class="cbask-name" title="${esc(x.n)}">${esc(x.n)}</span>
          <span class="cbask-tag">${esc(KIND_LABEL[x.k] || '')}</span>
          <button class="cbask-del" type="button" data-del="${esc(x.c)}"
                  title="Прибрати з кошика" aria-label="Прибрати ${esc(x.c)}">×</button>
        </div>`).join('')
        : `<div class="cbask-empty">Порожньо. У класифікаторах НК 025 і НК 026
             та в самому кодуванні біля коду є кнопка <b>＋ у кошик</b> — відкладені
             коди збираються тут і одним кліком ідуть у групер.</div>`}
      <div class="cbask-acts">
        ${n ? `<a class="cbask-btn cbask-btn-main" href="${esc(grouperHref())}"
                 title="Відкрити всі відкладені коди як випадок">🧭 У групер</a>
               <button class="cbask-btn" type="button" data-act="copy">Копіювати</button>
               <button class="cbask-btn" type="button" data-act="clear">Очистити</button>`
             : ''}
      </div>
    </div>` : ''}
    <button class="cbask-toggle" type="button" data-act="toggle"
            title="Кошик кодів${n ? ': ' + n : ''}" aria-label="Кошик кодів">🧺${
      n ? `<span class="cbask-badge">${n}</span>` : ''}</button>`;
}

function onClick(e) {
  const del = e.target.closest('[data-del]');
  if (del) { remove(del.dataset.del); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'toggle') {
    const open = root.dataset.open === '1' ? '0' : '1';
    root.dataset.open = open;
    try { localStorage.setItem(OPEN_KEY, open); } catch (_) {}
    paint();
  } else if (a === 'clear') {
    clear();
  } else if (a === 'copy') {
    const text = items.map((x) => x.c).join(' ');
    const done = () => { act.textContent = 'Скопійовано'; setTimeout(paint, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
    else done();
  }
}

/* Лівий нижній кут порталу вже зайнятий стежкою навігації і кнопкою «Верх»,
   тому кошик стоїть справа. Але на сторінках із власним плаваючим блоком
   праворуч (наприклад, лічильник вибраного) варто піднятися над ним. */
function keepClear() {
  const apply = () => {
    const others = [...document.querySelectorAll('.floating-count, .map-legend')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' || cs.display === 'none') return false;
        const r = el.getBoundingClientRect();
        return r.height && r.left > window.innerWidth / 2;
      });
    if (!others.length) { root.style.removeProperty('--cb-bottom'); return; }
    const top = Math.min(...others.map((el) => el.getBoundingClientRect().top));
    const base = window.innerWidth <= 980 ? 70 : 16;
    root.style.setProperty('--cb-bottom', Math.max(base, Math.round(window.innerHeight - top + 10)) + 'px');
  };
  apply();
  window.addEventListener('resize', apply);
  setTimeout(apply, 700);
}

// ── Кнопки «відкласти» на сторінках ────────────────────────────
/* Делегування, а не прив'язка до кожної кнопки: розділи перемальовують
   свої картки постійно, і слухачі на конкретних вузлах помирали б разом
   з ними. Сторінці досить намалювати кнопку з атрибутами. */
function onAddClick(e) {
  const btn = e.target.closest('[data-basket-add]');
  if (!btn) return;
  e.preventDefault();
  const code = btn.dataset.code || btn.dataset.basketAdd;
  if (!code) return;
  if (has(code)) { remove(code); } else { add(code, btn.dataset.kind, btn.dataset.name); }
  syncAddButtons();
}

/* Кнопки показують стан: відкладений код видно не відкриваючи кошик.
   Пишемо ТІЛЬКИ якщо значення справді змінилося: інакше кожен запис у
   textContent сам породжує мутацію, спостерігач нижче будить цю ж функцію —
   і сторінка намертво зациклюється. */
function syncAddButtons() {
  document.querySelectorAll('[data-basket-add]').forEach((btn) => {
    const code = btn.dataset.code || btn.dataset.basketAdd;
    const on = has(code);
    const text = on ? '✓ у кошику' : '＋ у кошик';
    if (btn.classList.contains('on') !== on) btn.classList.toggle('on', on);
    if (btn.textContent !== text) btn.textContent = text;
    const title = on ? 'Прибрати з кошика' : 'Відкласти код у кошик';
    if (btn.title !== title) btn.title = title;
  });
}

function start() {
  const style = document.createElement('style');
  style.id = 'code-basket-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  root = document.createElement('div');
  root.className = 'cbask';
  try { root.dataset.open = localStorage.getItem(OPEN_KEY) === '1' ? '1' : '0'; }
  catch (_) { root.dataset.open = '0'; }
  root.addEventListener('click', onClick);
  document.body.appendChild(root);
  paint();
  keepClear();

  document.addEventListener('click', onAddClick);
  /* Кнопки з'являються разом із картками розділу, тобто пізніше за нас.
     Спостерігач з відкладеним викликом: розділи перемальовують картки
     пачками, і синхронізувати стан на кожну окрему мутацію — марна робота. */
  let syncTimer = null;
  const mo = new MutationObserver(() => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncAddButtons, 150);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  syncAddButtons();

  // Сусідня вкладка змінила кошик — показуємо те саме
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY) return;
    items = load();
    paint();
    syncAddButtons();
  });
}

window.PMG_BASKET = {
  add, remove, has, clear,
  list: () => items.slice(),
  on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  href: grouperHref,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
