/* Порівняння тарифів і коефіцієнтів ПМГ-2025 ↔ ПМГ-2026.
   Дані готує postanova/build_comparison.py → data/comparison_2025_2026.json.

   Сторінка нічого не рахує з тексту постанов сама: усі числа, пари й дельти вже
   у файлі, разом із посиланням на главу, пункт і сторінку PDF. Тут лише фільтр,
   показ і вивантаження. */

'use strict';

const DATA_URL = 'data/comparison_2025_2026.json';
const RENDER_LIMIT = 300;   // намальованих рядків; у вивантаження йдуть усі

const TABS = [
  { id: 'rates', label: 'Ставки за пакетами' },
  { id: 'coefficients', label: 'Коригувальні коефіцієнти' },
  { id: 'drg', label: 'Вагові коефіцієнти ДСГ' }
];

let DB = null;
// pkgs порожній = обмеження немає. Так «нічого не вибрано» і «вибрано все»
// лишаються різними станами тільки на вигляд, а фільтрують однаково.
const state = { tab: 'rates', pkgs: new Set(), q: '', changedOnly: false, ratesView: 'base' };
let packageOptions = [];
// Глави, для яких розкрито решту сум у режимі базового тарифу.
const expanded = new Set();

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (v, digits) => v === null || v === undefined
  ? ''
  : v.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: digits ?? 2 });

function pct(row) {
  if (row.delta_pct === null || row.delta_pct === undefined) return '<span class="cmp-same">—</span>';
  if (Math.abs(row.delta_pct) < 0.005) return '<span class="cmp-same">без змін</span>';
  const cls = row.delta_pct > 0 ? 'cmp-up' : 'cmp-down';
  const sign = row.delta_pct > 0 ? '+' : '−';
  return `<span class="${cls}">${sign}${fmt(Math.abs(row.delta_pct), 2)}%</span>`;
}

function deltaCell(row, digits) {
  if (row.delta === null || row.delta === undefined) return '<span class="cmp-same">—</span>';
  if (row.delta === 0) return '<span class="cmp-same">0</span>';
  const cls = row.delta > 0 ? 'cmp-up' : 'cmp-down';
  const sign = row.delta > 0 ? '+' : '−';
  return `<span class="${cls}">${sign}${fmt(Math.abs(row.delta), digits ?? 2)}</span>`;
}

/** Клітинка коефіцієнта. Значення буває не числом, а відсиланням: «за додатком 1»,
    «за алгоритмами і правилами НСЗУ» — такий коефіцієнт існує, але його величина
    живе в іншому місці, і ховати це за «—» означало б збрехати про склад переліку. */
function coeffCell(value, raw) {
  if (value !== null && value !== undefined) return fmt(value, 4);
  if (raw && !/^\d/.test(raw)) return `<span class="cmp-refval">${esc(raw)}</span>`;
  return '<span class="cmp-absent">—</span>';
}

function statusTag(status) {
  if (status === 'only-2026') return '<span class="cmp-tag cmp-tag-new">нове у 2026</span>';
  if (status === 'only-2025') return '<span class="cmp-tag cmp-tag-gone">було у 2025</span>';
  return '';
}

/** Посилання на сторінку PDF тієї постанови, з якої взято число. */
function sourceLink(year, chapter, point, page) {
  if (!point && !page) return '<span class="cmp-absent">—</span>';
  const file = year === '2025' ? 'docs/postanova_1503.pdf' : 'docs/postanova_1808.pdf';
  const label = [chapter ? `гл. ${chapter}` : '', point ? `п. ${point}` : ''].filter(Boolean).join(', ');
  if (!page) return `<span class="cmp-src">${esc(label)}</span>`;
  return `<a class="cmp-src" href="${file}#page=${page}" target="_blank" rel="noopener">${esc(label)} · с. ${page}</a>`;
}

const changed = (row) => row.status !== 'both' || (row.delta !== undefined && row.delta !== 0);

function matchesText(haystack) {
  if (!state.q) return true;
  return haystack.toLowerCase().includes(state.q);
}

// ── Відбір ───────────────────────────────────────────────────────────────────

/** Рядок належить будь-якому з обраних пакетів. Глава 3 віддає одразу три
    пакети (3, 4, 47), тож перетин, а не рівність. */
const inPackages = (packages) => !state.pkgs.size || packages.some((p) => state.pkgs.has(p));

function visibleRates() {
  return DB.rates.filter((r) => {
    if (!inPackages(r.packages)) return false;
    if (state.changedOnly && !changed(r)) return false;
    return matchesText(`${r.chapter_title} ${r.kind} ${r.qualifier} ${r.qualifier2025} ${r.v2025 ?? ''} ${r.v2026 ?? ''}`);
  });
}

/** Те, що реально показуємо у вкладці ставок.
    У режимі «Базовий тариф» — один рядок на пакет плюс розкриті вручну глави. */
function ratesForDisplay() {
  const rows = visibleRates();
  if (state.ratesView === 'all') return rows;
  return rows.filter((r) => r.base || expanded.has(r.chapter_title));
}

function visibleCoefficients() {
  const groups = [];
  for (const group of DB.coefficients) {
    if (!inPackages(group.packages)) continue;
    const groupText = `${group.chapter_title} ${group.caption}`;
    const rows = group.rows.filter((row) => {
      if (state.changedOnly && !changed(row)) return false;
      return matchesText(`${groupText} ${row.section} ${row.label} ${row.label2025}`);
    });
    if (rows.length) groups.push({ group, rows });
  }
  return groups;
}

function visibleDrg() {
  return DB.drg.filter((r) => {
    if (!inPackages(r.packages)) return false;
    if (state.changedOnly && !changed(r)) return false;
    return matchesText(`${r.code} ${r.title} ${r.printed.join(' ')}`);
  });
}

// ── Показ ────────────────────────────────────────────────────────────────────

function renderTabs() {
  const counts = {
    rates: DB.rates.length,
    coefficients: DB.meta.counts.coefficient_rows,
    drg: DB.drg.length
  };
  el('cmpTabs').innerHTML = TABS.map((tab) => `
    <button class="cmp-tab" role="tab" type="button" data-tab="${tab.id}"
            aria-selected="${state.tab === tab.id}">${esc(tab.label)}<small>${counts[tab.id]}</small></button>`).join('');
  el('cmpTabs').querySelectorAll('.cmp-tab').forEach((button) => {
    button.addEventListener('click', () => { state.tab = button.dataset.tab; render(); });
  });
}

function renderSources() {
  const source = (year, meta) => `
    <div class="cmp-source">
      <b>ПМГ-${year} · постанова № ${esc(meta.number)}</b>
      <span>від ${esc(meta.date)}${meta.edition ? `, редакція від ${esc(meta.edition)}` : ''}</span>
      <span>${meta.basis ? `підстава останньої зміни: ${esc(meta.basis)}` : ''}</span>
      <a href="${esc(meta.href)}" target="_blank" rel="noopener">Відкрити PDF ↗</a>
    </div>`;
  el('cmpSources').innerHTML = `<div class="cmp-sources-inner">
    ${source('2025', DB.meta.sources['2025'])}
    ${source('2026', DB.meta.sources['2026'])}
    <div class="cmp-note">${esc(DB.meta.note)}<br>
      Глави зіставлено за назвою, а не за номером: у 2025 році глав ${DB.meta.counts.chapters_2025},
      у 2026-му ${DB.meta.counts.chapters_2026}, спільних ${DB.meta.counts.chapters_matched}.</div>
  </div>`;
}

function renderStats() {
  const counts = DB.meta.counts;
  const drgChanged = DB.drg.filter((r) => r.delta).length;
  const items = [
    ['Ставок зіставлено', `${counts.rates_both} з ${counts.rates}`],
    ['Рядків коефіцієнтів', counts.coefficient_rows],
    ['Кодів ДСГ', `${counts.drg_both} з ${counts.drg}`],
    ['ДСГ зі зміною ваги', drgChanged]
  ];
  el('cmpStats').innerHTML = items.map(([label, value]) => `
    <div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
}

function collectPackages() {
  const used = new Set();
  DB.rates.forEach((r) => r.packages.forEach((p) => used.add(p)));
  DB.coefficients.forEach((g) => g.packages.forEach((p) => used.add(p)));
  DB.drg.forEach((r) => r.packages.forEach((p) => used.add(p)));
  packageOptions = DB.packages.filter((p) => used.has(p.number));
}

/** Список чекбоксів, відфільтрований пошуком усередині панелі.
    Уже обрані показуємо завжди — інакше пошук ховав би власний вибір. */
function renderPackageList(query = '') {
  const needle = query.trim().toLowerCase();
  const matched = packageOptions.filter((p) => !needle
    || state.pkgs.has(p.number)
    || p.number.includes(needle)
    || p.title.toLowerCase().includes(needle));
  el('cmpPkgList').innerHTML = matched.length
    ? matched.map((p) => `
        <label class="cmp-pkg-item">
          <input type="checkbox" value="${esc(p.number)}"${state.pkgs.has(p.number) ? ' checked' : ''}>
          <span><b>№ ${esc(p.number)}</b> — ${esc(p.title)}</span>
        </label>`).join('')
    : '<div class="cmp-pkg-empty">Пакета з такою назвою немає.</div>';
  el('cmpPkgCount').textContent = state.pkgs.size
    ? `обрано ${state.pkgs.size} із ${packageOptions.length}`
    : `усі ${packageOptions.length} пакетів`;
}

function renderPackageSummary() {
  const chosen = packageOptions.filter((p) => state.pkgs.has(p.number));
  el('cmpPkgToggle').textContent = !chosen.length
    ? 'Усі пакети'
    : (chosen.length === 1 ? `№ ${chosen[0].number} — ${chosen[0].title}` : `Обрано пакетів: ${chosen.length}`);
  el('cmpPkgChosen').innerHTML = chosen.length < 2 ? '' : chosen.map((p) => `
    <span class="cmp-pkg-tag">№ ${esc(p.number)}
      <button type="button" data-drop="${esc(p.number)}" aria-label="Прибрати пакет № ${esc(p.number)}">×</button>
    </span>`).join('');
  el('cmpPkgChosen').querySelectorAll('button[data-drop]').forEach((button) => {
    button.addEventListener('click', () => {
      state.pkgs.delete(button.dataset.drop);
      renderPackageSummary();
      renderPackageList(el('cmpPkgSearch').value);
      render();
    });
  });
}

function togglePackagePanel(open) {
  const panel = el('cmpPkgPanel');
  const next = open === undefined ? panel.hidden : open;
  panel.hidden = !next;
  el('cmpPkgToggle').setAttribute('aria-expanded', String(next));
  if (next) {
    renderPackageList(el('cmpPkgSearch').value);
    el('cmpPkgSearch').focus();
  }
}

function tableShell(head, body, note) {
  return `<div class="cmp-scroll"><table class="cmp-table">
      <thead><tr>${head.map((h) => `<th${h.num ? ' class="cmp-num"' : ''}>${esc(h.label ?? h)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>${note ? `<div class="cmp-more">${esc(note)}</div>` : ''}`;
}

function renderRates() {
  const base = state.ratesView === 'base';
  const rows = ratesForDisplay();
  // Підписи називають документ, а не рік: «Пункт 2025» читалося як «пункт № 2025».
  const head = ['Пакет', 'Глава', 'Тип ставки', 'За що / одиниця',
    { label: 'ПМГ-2025, грн', num: 1 }, { label: 'ПМГ-2026, грн', num: 1 },
    { label: 'Різниця, грн', num: 1 }, { label: 'Різниця, %', num: 1 },
    'Де в постанові 1503', 'Де в постанові 1808'];
  const shell = `<div class="cmp-group">
      <div class="cmp-group-head">
        <div class="cmp-head-row">
          <h2>${base ? 'Базовий тариф пакета' : 'Усі суми, названі в главах'}</h2>
          <div class="cmp-view" role="group" aria-label="Що показувати у ставках">
            <button type="button" data-view="base" aria-pressed="${base}">Базовий тариф</button>
            <button type="button" data-view="all" aria-pressed="${!base}">Усі суми</button>
          </div>
        </div>
        <p>${base
          ? 'По одному рядку на пакет — та ставка, яку постанова називає тарифом. Решта сум глави (доплати, вартість окремих етапів, рівні оплати праці) розкривається кнопкою «ще N».'
          : 'Кожна сума з тарифних пунктів глави окремим рядком разом із тим, що саме вона оплачує. Порожнє поле означає, що в тому році такої суми в главі не було.'}</p>
      </div>
      %ROWS%
    </div>`;
  if (!rows.length) return shell.replace('%ROWS%', '<div class="cmp-empty">За цим фільтром нічого не знайшлося.</div>');

  const shown = rows.slice(0, RENDER_LIMIT);
  const body = shown.map((r) => {
    const more = base && r.extras
      ? `<button type="button" class="cmp-more-btn" data-chapter="${esc(r.chapter_title)}">${expanded.has(r.chapter_title) ? '− згорнути' : `ще ${r.extras}`}</button>`
      : '';
    return `
    <tr${base && !r.base ? ' class="cmp-sub"' : ''}>
      <td>${r.base ? r.packages.map((p) => `<span class="cmp-chip">№ ${esc(p)}</span>`).join('') : ''}</td>
      <td class="cmp-title">${r.base ? esc(r.chapter_title.replace(/^Глава\s+\d+\.\s*/, '')) : ''}${more}</td>
      <td>${esc(r.kind)}${r.formula ? ' <span class="cmp-tag cmp-tag-calc">розрахунок</span>' : ''}</td>
      <td class="cmp-title">${esc(r.qualifier)} ${statusTag(r.status)}</td>
      <td class="cmp-num">${r.v2025 === null ? '<span class="cmp-absent">—</span>' : fmt(r.v2025)}</td>
      <td class="cmp-num">${r.v2026 === null ? '<span class="cmp-absent">—</span>' : fmt(r.v2026)}</td>
      <td class="cmp-num">${deltaCell(r)}</td>
      <td class="cmp-num">${pct(r)}</td>
      <td>${sourceLink('2025', r.chapter2025, r.point2025, r.page2025)}</td>
      <td>${sourceLink('2026', r.chapter2026, r.point2026, r.page2026)}</td>
    </tr>`;
  }).join('');
  const note = rows.length > shown.length
    ? `Показано ${shown.length} рядків із ${rows.length}. У вивантаження в Excel потрапляють усі.` : '';
  return shell.replace('%ROWS%', tableShell(head, body, note));
}

function renderCoefficients() {
  const groups = visibleCoefficients();
  if (!groups.length) return emptyState();
  return groups.map(({ group, rows }) => {
    // Коефіцієнти з тексту несуть номер пункту, тож для них додаємо джерела:
    // у таблиць посилатися нема на що, вони самі є частиною глави.
    const withSource = group.source === 'text';
    const body = rows.map((row) => `
      <tr>
        <td class="cmp-title">
          ${row.section ? `<span class="cmp-chip">${esc(row.section)}</span>` : ''}${esc(row.label)}
          ${statusTag(row.status)}
          ${row.label2025 ? `<span class="cmp-renamed">у 2025 звучало: ${esc(row.label2025)}</span>` : ''}
        </td>
        <td class="cmp-num">${coeffCell(row.v2025, row.raw2025)}</td>
        <td class="cmp-num">${coeffCell(row.v2026, row.raw2026)}</td>
        <td class="cmp-num">${deltaCell(row, 4)}</td>
        <td class="cmp-num">${pct(row)}</td>
        ${withSource ? `<td>${sourceLink('2025', group.chapter2025, row.point2025, row.page2025)}</td>
        <td>${sourceLink('2026', group.chapter2026, row.point2026, row.page2026)}</td>` : ''}
      </tr>`).join('');
    const head = ['Показник', { label: 'Коефіцієнт 2025', num: 1 }, { label: 'Коефіцієнт 2026', num: 1 },
      { label: 'Різниця', num: 1 }, { label: 'Різниця, %', num: 1 }];
    if (withSource) head.push('Де в постанові 1503', 'Де в постанові 1808');
    return `<div class="cmp-group">
        <div class="cmp-group-head">
          <h2>${group.packages.map((p) => `<span class="cmp-chip">№ ${esc(p)}</span>`).join('')}${esc(group.chapter_title.replace(/^Глава\s+\d+\.\s*/, ''))}</h2>
          <p>${esc(group.caption || 'Таблиця коефіцієнтів глави')}</p>
        </div>
        ${tableShell(head, body, '')}
      </div>`;
  }).join('');
}

function renderDrg() {
  const rows = visibleDrg();
  const finding = drgFinding();
  if (!rows.length) return finding + emptyState();
  const shown = rows.slice(0, RENDER_LIMIT);
  const body = shown.map((r) => `
    <tr>
      <td class="cmp-code">${esc(r.code)}${r.printed.length ? `<span class="cmp-renamed">у тексті: ${esc(r.printed.join(', '))}</span>` : ''}</td>
      <td class="cmp-title">${esc(r.title)} ${statusTag(r.status)}</td>
      <td class="cmp-num">${r.w2025 === null ? '<span class="cmp-absent">—</span>' : fmt(r.w2025, 4)}</td>
      <td class="cmp-num">${r.w2026 === null ? '<span class="cmp-absent">—</span>' : fmt(r.w2026, 4)}</td>
      <td class="cmp-num">${deltaCell(r, 4)}</td>
      <td class="cmp-num">${pct(r)}</td>
      <td class="cmp-num">${r.kids2026 === null ? '<span class="cmp-absent">—</span>' : fmt(r.kids2026, 4)}</td>
      <td class="cmp-num">${r.trauma2026 === null ? '<span class="cmp-absent">—</span>' : fmt(r.trauma2026, 4)}</td>
      <td class="cmp-num">${r.simult2025 === null ? '<span class="cmp-absent">—</span>' : fmt(r.simult2025, 4)}</td>
    </tr>`).join('');
  const head = ['Код ДСГ', 'Назва групи',
    { label: 'Ваговий коеф. 2025', num: 1 }, { label: 'Ваговий коеф. 2026', num: 1 },
    { label: 'Різниця', num: 1 }, { label: 'Різниця, %', num: 1 },
    { label: 'Дод. коеф. за дітей, 2026', num: 1 },
    { label: 'Дод. коеф. за травми, 2026', num: 1 },
    { label: 'Додаток 3, 2025', num: 1 }];
  const note = rows.length > shown.length
    ? `Показано ${shown.length} рядків із ${rows.length}. У вивантаження в Excel потрапляють усі.` : '';
  return finding + `<div class="cmp-group">
      <div class="cmp-group-head">
        <h2>Вагові коефіцієнти діагностично-споріднених груп</h2>
        <p>Додаток 1 обох постанов. У 2026 році до нього додалися дві колонки — додаткові коефіцієнти за допомогу дітям і за лікування травм; у 2025 таких колонок не було. Остання колонка — окремий додаток 3 за 2025 рік (симультанні, повторні та послідовні операції).</p>
      </div>
      ${tableShell(head, body, note)}
    </div>`;
}

/** Збіг, який видно лише поруч: додаток 3 за 2025 рік і колонка «за лікування
    травм» за 2026-й — це ті самі числа. Рахуємо на льоту, щоб текст на сторінці
    не розійшовся з даними, якщо постанову перезберуть. */
function drgFinding() {
  const withSimult = DB.drg.filter((r) => r.simult2025 !== null);
  const identical = withSimult.filter((r) => r.trauma2026 !== null && Math.abs(r.simult2025 - r.trauma2026) < 1e-9);
  const differing = withSimult.filter((r) => r.trauma2026 !== null && Math.abs(r.simult2025 - r.trauma2026) >= 1e-9);
  if (!withSimult.length) return '';
  return `<div class="cmp-finding">
      <b>Що видно лише при зіставленні років.</b> У 2025 році коефіцієнти для симультанних, повторних
      і послідовних операцій були окремим додатком 3 — ${withSimult.length} кодів.
      У 2026 році такого додатка немає, натомість у додатку 1 з'явилася колонка
      «додатковий коефіцієнт за лікування травм».
      <b>${identical.length} із ${withSimult.length} кодів мають у ній рівно ті самі значення,
      розбіжних — ${differing.length}.</b>
      <p>Числа збігаються один в один, а підпис колонки інший. Чи це те саме правило під новою назвою,
      чи різні правила з однаковими вагами — питання тлумачення постанови, а не даних: обидві колонки
      показані поруч, щоб було з чим працювати.</p>
    </div>`;
}

function emptyState() {
  return '<div class="cmp-group"><div class="cmp-empty">За цим фільтром нічого не знайшлося. Спробуйте зняти обмеження по пакету або очистити пошук.</div></div>';
}

function renderSummary() {
  let total = 0;
  let changedCount = 0;
  if (state.tab === 'rates') {
    const rows = ratesForDisplay();
    total = rows.length;
    changedCount = rows.filter(changed).length;
  } else if (state.tab === 'drg') {
    const rows = visibleDrg();
    total = rows.length;
    changedCount = rows.filter(changed).length;
  } else {
    visibleCoefficients().forEach(({ rows }) => { total += rows.length; changedCount += rows.filter(changed).length; });
  }
  const chosen = packageOptions.filter((p) => state.pkgs.has(p.number));
  const pkgText = !chosen.length ? ''
    : (chosen.length === 1
      ? `. Пакет: <b>№ ${esc(chosen[0].number)} — ${esc(chosen[0].title)}</b>`
      : `. Пакети: <b>${chosen.map((p) => '№ ' + esc(p.number)).join(', ')}</b>`);
  el('cmpSummary').innerHTML = `Показано <b>${total}</b> ${total === 1 ? 'рядок' : 'рядків'}`
    + `, з них зі зміною — <b>${changedCount}</b>`
    + pkgText
    + (state.q ? `. Пошук: <b>${esc(state.q)}</b>` : '');
}

function render() {
  renderTabs();
  const panel = el('cmpPanel');
  if (state.tab === 'rates') panel.innerHTML = renderRates();
  else if (state.tab === 'coefficients') panel.innerHTML = renderCoefficients();
  else panel.innerHTML = renderDrg();
  renderSummary();
}

// ── Вивантаження у справжній .xlsx ───────────────────────────────────────────
/* Готового пакувальника в порталі немає, а CSV не вміє трьох аркушів і губить
   тип числа. Тому нижче — мінімальний ZIP без стиснення (метод store) і
   SpreadsheetML з рядками просто в клітинках (inlineStr), без таблиці
   спільних рядків: файли в нас маленькі, а код лишається читабельним. */

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);          // прапорець UTF-8 для імен
    view.setUint16(8, 0, true);               // без стиснення
    view.setUint16(12, 0x0021, true);         // дата 01.01.1980
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, data);

    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true);
    entryView.setUint16(6, 20, true);
    entryView.setUint16(8, 0x0800, true);
    entryView.setUint16(10, 0, true);
    entryView.setUint16(14, 0x0021, true);
    entryView.setUint32(16, crc, true);
    entryView.setUint32(20, data.length, true);
    entryView.setUint32(24, data.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + data.length;
  }
  const directory = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, directory, true);
  endView.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function sheetXml(rows) {
  const body = rows.map((cells, rowIndex) => {
    const inner = cells.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? ' s="1"' : '';
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
      if (value === null || value === undefined || value === '') return `<c r="${ref}"${style}/>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${inner}</row>`;
  }).join('');
  const width = rows.reduce((max, cells) => Math.max(max, cells.length), 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>
<cols><col min="1" max="${width}" width="26" customWidth="1"/></cols>
<sheetData>${body}</sheetData></worksheet>`;
}

function buildWorkbook(sheets) {
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}">
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`
    },
    {
      name: 'xl/styles.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
    }
  ];
  sheets.forEach((sheet, index) => {
    files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, text: sheetXml(sheet.rows) });
  });
  return zipStore(files);
}

function exportRows() {
  const rates = [[
    'Пакет', 'Назва пакета (глава)', 'Базовий тариф', 'Тип ставки', 'За що / одиниця',
    'ПМГ-2025, грн', 'ПМГ-2026, грн', 'Різниця, грн', 'Різниця, %',
    'Постанова 1503: глава', 'Постанова 1503: пункт', 'Постанова 1503: стор. PDF',
    'Постанова 1808: глава', 'Постанова 1808: пункт', 'Постанова 1808: стор. PDF', 'Стан'
  ]];
  ratesForDisplay().forEach((r) => rates.push([
    r.packages.join(', '),
    r.chapter_title.replace(/^Глава\s+\d+\.\s*/, ''),
    r.base ? (r.formula ? 'так, розрахунком' : 'так') : '',
    r.kind, r.qualifier,
    r.v2025, r.v2026, r.delta ?? null, r.delta_pct ?? null,
    r.chapter2025, r.point2025, r.page2025,
    r.chapter2026, r.point2026, r.page2026,
    r.status === 'both' ? 'в обох роках' : (r.status === 'only-2025' ? 'лише 2025' : 'лише 2026')
  ]));

  const coefficients = [['Пакет', 'Глава', 'Звідки', 'Таблиця коефіцієнтів', 'Група в таблиці', 'Показник',
    'Як показник звався у 2025', 'Коефіцієнт 2025', 'Коефіцієнт 2026', 'Різниця', 'Різниця, %',
    'Постанова 1503: пункт', 'Постанова 1808: пункт', 'Стан']];
  visibleCoefficients().forEach(({ group, rows }) => rows.forEach((row) => coefficients.push([
    group.packages.join(', '), group.chapter_title.replace(/^Глава\s+\d+\.\s*/, ''),
    group.source === 'text' ? 'текст пункту' : 'таблиця глави',
    group.source === 'text' ? '' : group.caption,
    row.section, row.label, row.label2025,
    row.v2025 ?? (row.raw2025 || null), row.v2026 ?? (row.raw2026 || null),
    row.delta ?? null, row.delta_pct ?? null,
    row.point2025 || '', row.point2026 || '',
    row.status === 'both' ? 'в обох роках' : (row.status === 'only-2025' ? 'лише 2025' : 'лише 2026')
  ])));

  const drg = [[
    'Код ДСГ', 'Назва групи', 'Пакет', 'Ваговий коефіцієнт 2025', 'Ваговий коефіцієнт 2026',
    'Різниця', 'Різниця, %', 'Дод. коефіцієнт за дітей, 2026', 'Дод. коефіцієнт за травми, 2026',
    'Додаток 3 (симультанні), 2025', 'Кардіохірургічна група 2026', 'Стан'
  ]];
  visibleDrg().forEach((r) => drg.push([
    r.code, r.title, r.packages.join(', '),
    r.w2025, r.w2026, r.delta ?? null, r.delta_pct ?? null,
    r.kids2026, r.trauma2026, r.simult2025, r.cardio2026 ? 'так' : '',
    r.status === 'both' ? 'в обох роках' : (r.status === 'only-2025' ? 'лише 2025' : 'лише 2026')
  ]));

  const filter = [
    ['Порівняння тарифів і коефіцієнтів ПМГ-2025 ↔ ПМГ-2026'],
    [],
    ['Джерело 2025', `Постанова КМУ № ${DB.meta.sources['2025'].number} від ${DB.meta.sources['2025'].date}, редакція від ${DB.meta.sources['2025'].edition}`],
    ['Джерело 2026', `Постанова КМУ № ${DB.meta.sources['2026'].number} від ${DB.meta.sources['2026'].date}, редакція від ${DB.meta.sources['2026'].edition}`],
    ['Застереження', DB.meta.note],
    [],
    ['Фільтр: пакети', state.pkgs.size
      ? packageOptions.filter((p) => state.pkgs.has(p.number)).map((p) => `№ ${p.number} — ${p.title}`).join('; ')
      : 'усі'],
    ['Фільтр: пошук', state.q || '—'],
    ['Фільтр: лише зміни', state.changedOnly ? 'так' : 'ні'],
    ['Аркуш «Ставки»', state.ratesView === 'base'
      ? 'базовий тариф — по одному рядку на пакет'
      : 'усі суми, названі в главах'],
    ['Вивантажено рядків', `ставки ${rates.length - 1}, коефіцієнти ${coefficients.length - 1}, ДСГ ${drg.length - 1}`]
  ];

  return [
    { name: 'Ставки', rows: rates },
    { name: 'Коефіцієнти', rows: coefficients },
    { name: 'ДСГ', rows: drg },
    { name: 'Про вивантаження', rows: filter }
  ];
}

function download() {
  const blob = buildWorkbook(exportRows());
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `taryfy-2025-2026-${DB.meta.generated}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

// ── Запуск ───────────────────────────────────────────────────────────────────

let searchTimer = null;
let bound = false;

function bind() {
  if (bound) return;   // start() можна викликати повторно кнопкою «Спробувати ще раз»
  bound = true;
  // Таблиця перемальовується цілком, тож слухаємо на контейнері, а не на кнопках.
  el('cmpPanel').addEventListener('click', (e) => {
    const view = e.target.closest('.cmp-view button');
    if (view) {
      state.ratesView = view.dataset.view;
      if (state.ratesView === 'base') expanded.clear();
      render();
      return;
    }
    const more = e.target.closest('.cmp-more-btn');
    if (more) {
      const chapter = more.dataset.chapter;
      if (expanded.has(chapter)) expanded.delete(chapter); else expanded.add(chapter);
      render();
    }
  });

  el('cmpPkgToggle').addEventListener('click', () => togglePackagePanel());
  el('cmpPkgSearch').addEventListener('input', (e) => renderPackageList(e.target.value));
  el('cmpPkgList').addEventListener('change', (e) => {
    const box = e.target.closest('input[type="checkbox"]');
    if (!box) return;
    if (box.checked) state.pkgs.add(box.value); else state.pkgs.delete(box.value);
    el('cmpPkgCount').textContent = state.pkgs.size
      ? `обрано ${state.pkgs.size} із ${packageOptions.length}`
      : `усі ${packageOptions.length} пакетів`;
    renderPackageSummary();
    render();
  });
  el('cmpPkgNone').addEventListener('click', () => {
    state.pkgs.clear();
    renderPackageSummary();
    renderPackageList(el('cmpPkgSearch').value);
    render();
  });
  el('cmpPkgClose').addEventListener('click', () => { togglePackagePanel(false); el('cmpPkgToggle').focus(); });
  // Панель перекриває таблицю, тож клік повз неї та Esc мають її закривати.
  document.addEventListener('click', (e) => {
    if (!el('cmpPkgPanel').hidden && !e.target.closest('.cmp-field-pkg')) togglePackagePanel(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('cmpPkgPanel').hidden) { togglePackagePanel(false); el('cmpPkgToggle').focus(); }
  });

  el('cmpSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const value = e.target.value.trim().toLowerCase();
    searchTimer = setTimeout(() => { state.q = value; render(); }, 160);
  });
  el('cmpChangedOnly').addEventListener('change', (e) => { state.changedOnly = e.target.checked; render(); });
  el('cmpExport').addEventListener('click', download);
  el('cmpReset').addEventListener('click', () => {
    state.pkgs.clear(); state.q = ''; state.changedOnly = false;
    state.ratesView = 'base'; expanded.clear();
    el('cmpSearch').value = ''; el('cmpChangedOnly').checked = false;
    el('cmpPkgSearch').value = '';
    togglePackagePanel(false);
    renderPackageSummary();
    renderPackageList();
    render();
  });
}

/* Файл порівняння важить близько пів мегабайта, і на слабкому з'єднанні перший
   запит іноді обривається (на локальному однопотоковому сервері — регулярно).
   Одна невдача не привід показувати порожню сторінку, тому пробуємо тричі. */
async function loadData(attempts = 3) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(DATA_URL, { cache: 'default' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }
  throw last;
}

async function start() {
  el('cmpPanel').innerHTML = '<div class="cmp-group"><div class="cmp-empty">Завантаження…</div></div>';
  try {
    DB = await loadData();
  } catch (error) {
    console.error('comparison load failed', error);
    el('cmpPanel').innerHTML = '<div class="cmp-group"><div class="cmp-empty">'
      + 'Не вдалося завантажити дані порівняння.<br><button id="cmpRetry" type="button" class="cmp-btn" style="margin-top:12px;">Спробувати ще раз</button>'
      + '</div></div>';
    el('cmpRetry').addEventListener('click', start);
    return;
  }
  renderStats();
  renderSources();
  collectPackages();
  renderPackageSummary();
  renderPackageList();
  bind();
  render();
}

start();
