// ═══════════════════════════════════════════════════════════════
// Пілотні та експериментальні проєкти НСЗУ (поза постановою 1808)
// Реєстр напрямів + паспорт кожного: нормативка, категорії,
// зміст послуги, вимоги до надавача, тарифи.
// ═══════════════════════════════════════════════════════════════

let PILOTS = [];
let current = null;

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Пілоти, що вимагають чинного договору за пакетом ПМГ — даємо перехід у паспорт
const REQUIRED_PACKAGE = { '71': '63', '73': '1' };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const res = await fetch('data/pilots_2026.json?v=20260728a');
    const data = await res.json();
    PILOTS = data.pilots || [];
  } catch (e) {
    $('pl-detail').innerHTML = '<div class="pl-loading">⚠️ Не вдалося завантажити дані пілотних проєктів.</div>';
    return;
  }

  renderStats();
  renderList();

  // Пілот з адреси: pilots/index.html?p=66
  const wanted = new URLSearchParams(location.search).get('p');
  select(PILOTS.find(p => p.number === wanted) || PILOTS[0], false);

  window.addEventListener('popstate', () => {
    const n = new URLSearchParams(location.search).get('p');
    select(PILOTS.find(p => p.number === n) || PILOTS[0], false);
  });
}

// ── Шапка: зведення ────────────────────────────────────────────
function renderStats() {
  const active = PILOTS.filter(p => p.status === 'active').length;
  const ended = PILOTS.length - active;
  const acts = new Set();
  PILOTS.forEach(p => (p.normative || []).forEach(n => acts.add(n.num + '/' + n.date)));

  $('pl-hero-stats').innerHTML = `
    <div class="pl-stat"><span class="pl-stat-num">${PILOTS.length}</span><span class="pl-stat-lbl">напрямів</span></div>
    <div class="pl-stat"><span class="pl-stat-num">${active}</span><span class="pl-stat-lbl">діють у 2026</span></div>
    ${ended ? `<div class="pl-stat pl-stat-warn"><span class="pl-stat-num">${ended}</span><span class="pl-stat-lbl">не продовжено</span></div>` : ''}
    <div class="pl-stat"><span class="pl-stat-num">${acts.size}</span><span class="pl-stat-lbl">актів КМУ</span></div>
  `;
}

// ── Ліва колонка: перелік напрямів ─────────────────────────────
function renderList() {
  $('pl-list').innerHTML = PILOTS.map(p => `
    <button type="button" class="pl-item${p.status === 'ended' ? ' ended' : ''}" data-num="${esc(p.number)}">
      <span class="pl-item-icon">${p.icon || '🧪'}</span>
      <span class="pl-item-body">
        <span class="pl-item-top">
          <span class="pl-item-num">№ ${esc(p.number)}</span>
          <span class="pl-dot ${p.status === 'active' ? 'ok' : 'off'}" title="${esc(p.status_label)}"></span>
        </span>
        <span class="pl-item-title">${esc(p.short_title)}</span>
      </span>
    </button>
  `).join('');

  $('pl-list').querySelectorAll('.pl-item').forEach(btn => {
    btn.addEventListener('click', () => {
      select(PILOTS.find(p => p.number === btn.dataset.num), true);
    });
  });
}

function markActive() {
  document.querySelectorAll('.pl-item').forEach(b =>
    b.classList.toggle('active', b.dataset.num === current.number));
}

function select(pilot, push) {
  if (!pilot) return;
  current = pilot;
  markActive();
  renderDetail(pilot);
  if (push) history.pushState(null, '', `?p=${encodeURIComponent(pilot.number)}`);
}

// ── Права колонка: паспорт напряму ─────────────────────────────
function renderDetail(p) {
  const block = (icon, title, inner, extraClass = '') => inner
    ? `<section class="pl-block ${extraClass}"><h3>${icon} ${title}</h3>${inner}</section>` : '';

  const list = arr => (arr && arr.length)
    ? `<ul class="pl-ul">${arr.map(x => `<li>${highlight(x)}</li>`).join('')}</ul>` : '';

  // ── Нормативна база
  const normative = (p.normative || []).map(n => `
    <div class="pl-act">
      <div class="pl-act-head">
        <a class="pl-act-num" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.act)} № ${esc(n.num)}</a>
        <span class="pl-act-date">від ${esc(n.date)}</span>
        <span class="pl-act-role pl-role-${roleClass(n.role)}">${esc(n.role)}</span>
      </div>
      <div class="pl-act-title">${esc(n.title)}</div>
      ${n.note ? `<div class="pl-act-note">${esc(n.note)}</div>` : ''}
    </div>
  `).join('');

  // ── Тарифи
  const pay = p.payment || {};
  const rateRows = (pay.rates || []).map(r => `
    <tr>
      <td class="pl-rate-code">${r.code && r.code !== '—' ? esc(r.code) : ''}</td>
      <td>${esc(r.label)}</td>
      <td class="pl-rate-val">${esc(r.value)}</td>
    </tr>`).join('');

  const payInner = `
    <div class="pl-pay-model">${esc(pay.model || '')}</div>
    <div class="pl-pay-chips">
      ${pay.base_rate ? `<span class="pl-chip pl-chip-accent">Ставка: ${esc(pay.base_rate)}</span>` : ''}
      ${pay.cap ? `<span class="pl-chip">${esc(pay.cap)}</span>` : ''}
    </div>
    ${rateRows ? `<div class="pl-table-wrap"><table class="pl-table">
        <thead><tr><th>Код</th><th>Послуга</th><th>Тариф / коефіцієнт</th></tr></thead>
        <tbody>${rateRows}</tbody></table></div>` : ''}
    ${pay.planning ? `<p class="pl-pay-planning"><strong>Планування обсягів:</strong> ${esc(pay.planning)}</p>` : ''}
    ${list(pay.rules)}
  `;

  // ── Вимоги до надавача
  const pr = p.provider || {};
  const providerInner = pr.who ? `
    <p class="pl-who">${highlight(pr.who)}</p>
    ${list(pr.requirements)}
    ${pr.staff ? `<h4 class="pl-sub">👥 Спеціалісти</h4>${list(pr.staff)}` : ''}
    ${pr.premises ? `<h4 class="pl-sub">🏥 Приміщення</h4>${list(pr.premises)}` : ''}
    ${pr.equipment ? `<h4 class="pl-sub">🔧 Обладнання</h4>${list(pr.equipment)}` : ''}
  ` : '';

  // ── Пов'язаний пакет ПМГ (умова допуску)
  const reqPkg = REQUIRED_PACKAGE[p.number];
  const linkBlock = reqPkg ? `
    <div class="pl-link-note">
      🔗 Допуск до цього напряму вимагає чинного договору за пакетом ПМГ —
      <a href="../passport/index.html?package=${encodeURIComponent(reqPkg)}">відкрити паспорт пакета № ${esc(reqPkg)}</a>
    </div>` : '';

  const sources = (p.sources || []).map(u =>
    `<a class="pl-src" href="${esc(u)}" target="_blank" rel="noopener">${esc(shortUrl(u))}</a>`).join('');

  $('pl-detail').innerHTML = `
    <header class="pl-head ${p.status === 'ended' ? 'ended' : ''}">
      <div class="pl-head-top">
        <span class="pl-head-num">${p.icon || '🧪'} № ${esc(p.number)}</span>
        <span class="pl-status pl-status-${p.status}">${p.status === 'active' ? '🟢' : '🟠'} ${esc(p.status_label)}</span>
      </div>
      <h2 class="pl-head-title">${esc(p.title)}</h2>
      <p class="pl-head-official">${esc(p.official_name)}</p>
      ${p.pilot_note ? `<div class="pl-warn">⚠️ ${esc(p.pilot_note)}</div>` : ''}
      ${p.status === 'ended' ? `<div class="pl-warn pl-warn-strong">🟠 ${esc(p.status_note)}</div>` : ''}
    </header>

    <div class="pl-facts">
      ${p.status !== 'ended' ? factCard('📅 Строк і договори', p.status_note) : ''}
      ${factCard('💰 Бюджетна програма', p.budget_program)}
      ${p.history ? factCard('🕘 Що змінювалось', p.history) : ''}
    </div>

    ${linkBlock}

    ${block('👥', 'Кому надається', list(p.categories))}
    ${block('📋', 'Що входить у послугу', list(p.content))}
    ${block('📝', 'Підстави надання', list(p.grounds))}
    ${block('🏥', 'Вимоги до надавача', providerInner)}
    ${block('💵', 'Оплата і тарифи', payInner, 'pl-block-pay')}
    ${block('⚖️', 'Нормативна база', normative)}

    ${sources ? `<section class="pl-block pl-block-src"><h3>🔗 Першоджерела</h3><div class="pl-srcs">${sources}</div></section>` : ''}
  `;
}

function factCard(title, text) {
  if (!text) return '';
  return `<div class="pl-fact"><span class="pl-fact-t">${title}</span><span class="pl-fact-v">${esc(text)}</span></div>`;
}

// Підсвітити застереження й ключові умови всередині пунктів
function highlight(text) {
  let out = esc(text);
  out = out.replace(/(УВАГА|ОБОВ'ЯЗКОВО|КРИТЕРІЙ|ОСОБЛИВО|ВИХІД З ПРОГРАМИ|НЕ допускаються|НЕ поширюється|НЕ оплачує|ВИЗНАЧЕНІ|ВКЛЮЧЕНІ|ЛИШЕ|НЕМАЄ)/g,
    '<strong class="pl-hl">$1</strong>');
  return out;
}

function roleClass(role) {
  if (/чинн|база|гроші|процедур/i.test(role)) return 'base';
  if (/змін/i.test(role)) return 'amend';
  if (/попередник|2025/i.test(role)) return 'old';
  return 'other';
}

function shortUrl(u) {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, '') + decodeURIComponent(url.pathname).replace(/\/$/, '');
  } catch (_) { return u; }
}
