/* Розділ «Інструменти ДСГ»: паспорт коду · розрахунок випадку · пошук аномалій.
 *
 * Дані — drg/data/drg.json (збирає build_drg.py з додатків постанови 1808 і
 * Таблиці співставлення). Назви кодів беремо шардами з mapping/data/names/ —
 * тим самим способом, що й сторінка Таблиці співставлення: тримати в пам'яті
 * 12 918 назв діагнозів заради однієї підказки немає сенсу.
 *
 * Тип коду НЕ вгадуємо за форматом. «F70» однаково схоже на код ДСГ і на код
 * МКХ, «B02» — теж, тому тип визначається наявністю коду в довідниках: є в
 * groups → група, є в byIcd → діагноз, є в byAchi → інтервенція. Якщо код
 * трапляється у двох ролях, показуємо обидві, а не вибираємо за нас.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';

const CYR2LAT = { А: 'A', В: 'B', С: 'C', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', Т: 'T', Х: 'X', І: 'I' };

let DB = null;            // drg.json
let SERVICES = null;      // mapping/data/services_lite.json
let ODK = null;           // mapping/data/odk.json
let odkMembers = null;    // «ОДК 8» → Set кодів НК 025

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Код у канонічний вигляд: кирилиця в кодах — постійна пастка цих довідників. */
function normCode(text) {
  return String(text || '').trim().toUpperCase()
    .replace(/[АВСЕКМНОРТХІ]/g, (c) => CYR2LAT[c] || c)
    .replace(/\s+/g, '');
}

const fmtMoney = (n) => n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => (n === null || n === undefined ? '—' : n.toLocaleString('uk-UA', { maximumFractionDigits: 4 }));

// ── Завантаження ────────────────────────────────────────────────────────────
async function boot() {
  const [db, services, odk] = await Promise.all([
    fetch('data/drg.json').then((r) => r.json()),
    fetch('../mapping/data/services_lite.json').then((r) => r.json()).catch(() => []),
    fetch('../mapping/data/odk.json').then((r) => r.json()).catch(() => []),
  ]);
  DB = db;
  SERVICES = services;
  ODK = odk;
  odkMembers = new Map(odk.map((o) => [o.id, new Set(o.codes)]));

  renderStats();
  renderFactors();
  renderRules();
  wireTabs();
  wirePassport();
  wireCalc();
  wireAudit();
  wireFraudGate();
  openFromQuery();
}

function renderStats() {
  const c = DB.counters;
  const items = [
    [c.groups, 'груп ДСГ'],
    [c.groups_a1 + ' + ' + c.groups_a2, 'додаток 1 + додаток 2'],
    [c.icd.toLocaleString('uk-UA'), 'кодів НК 025 ведуть до груп'],
    [c.achi.toLocaleString('uk-UA'), 'кодів НК 026 ведуть до груп'],
    [DB.rate.case.toLocaleString('uk-UA'), 'грн базова ставка'],
  ];
  el('drgStats').innerHTML = items.map(([n, t]) =>
    `<div class="stat"><b>${n}</b><span>${t}</span></div>`).join('');
  el('drgSource').insertAdjacentHTML('beforeend',
    ` Дані зібрано ${esc(DB.meta.generated)}; Таблиця співставлення — версія ${esc(
      (DB.meta.sources.find((s) => s.id === 'mapping') || {}).version || '—')}.`);
}

// ── Назви кодів: шарди mapping/data/names ───────────────────────────────────
let namesIndex = null;
let namesIndexJob = null;
const shardJobs = new Map();
const nameCache = new Map();

function loadNamesIndex() {
  if (!namesIndexJob) {
    namesIndexJob = fetch('../mapping/data/names/index.json')
      .then((r) => r.json())
      .catch(() => ({ shards: {} }))
      .then((j) => (namesIndex = j && j.shards ? j : { shards: {} }));
  }
  return namesIndexJob;
}

/** Шард для коду: найдовший префікс із index.json, як у mapping.js. */
function shardOf(kind, code) {
  const keys = (namesIndex && namesIndex.shards[kind]) || [];
  let best = '';
  for (const key of keys) {
    if (code.startsWith(key) && key.length > best.length) best = key;
  }
  return best ? `${kind}_${best}` : '';
}

async function codeName(kind, code) {
  const key = `${kind}|${code}`;
  if (nameCache.has(key)) return nameCache.get(key);
  await loadNamesIndex();
  const id = shardOf(kind, code);
  if (!id) { nameCache.set(key, ''); return ''; }
  if (!shardJobs.has(id)) {
    shardJobs.set(id, fetch(`../mapping/data/names/${id}.json`)
      .then((r) => r.json()).catch(() => ({})));
  }
  const shard = await shardJobs.get(id);
  const name = shard[code] || '';
  nameCache.set(key, name);
  return name;
}

// ── Пошук коду в довіднику ──────────────────────────────────────────────────
/** Усі ролі, у яких код трапляється. Порожній масив = даних немає. */
function lookup(raw) {
  const code = normCode(raw);
  if (!code) return [];
  const roles = [];

  const groups = DB.groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.c === code);
  if (groups.length) roles.push({ kind: 'drg', code, hits: groups.map((x) => x.i) });

  if (DB.byIcd[code]) roles.push({ kind: 'icd', code, hits: DB.byIcd[code] });
  if (DB.byAchi[code]) roles.push({ kind: 'achi', code, hits: DB.byAchi[code] });

  // Код може підпадати під групу не напряму, а через ОДК, у складі якої він
  // перелічений у Таблиці співставлення. Так само робить паспорт у classifiers.
  const viaOdk = [];
  for (const [id, codes] of odkMembers) {
    if (!codes.has(code)) continue;
    const hits = DB.byOdk[id];
    if (hits) viaOdk.push({ id, hits });
  }
  if (viaOdk.length) {
    const direct = new Set(roles.flatMap((r) => r.hits));
    const merged = new Map();
    for (const { id, hits } of viaOdk) {
      for (const h of hits) {
        if (direct.has(h)) continue;
        (merged.get(h) || merged.set(h, []).get(h)).push(id);
      }
    }
    if (merged.size) {
      roles.push({ kind: 'odk', code, hits: [...merged.keys()], via: merged });
    }
  }
  return roles;
}

const KIND_LABEL = {
  drg: 'група ДСГ',
  icd: 'код діагнозу · НК 025',
  achi: 'код інтервенції · НК 026',
  odk: 'через об’єднану діагностичну категорію',
};

// ── Розрахунок випадку (пункт 38) ───────────────────────────────────────────
/** Стан перемикачів калькулятора. Ключ — id фактора з drg.json. */
const calcState = {};

function factorById(id) {
  return DB.factors.find((f) => f.id === id);
}

/**
 * Сума за випадок. Повертає кроки, щоб інтерфейс показував не «магічне число»,
 * а той самий ланцюжок, який експерт перевірить очима по тексту постанови.
 *
 * Порядок: ваговий коефіцієнт (+ додаткові, які постанова ДОДАЄ до ваги) ×
 * коригувальні множники (+ добавка за добу у ВІТ) × частка застосування ×
 * коефіцієнт збалансованості. Окремо — оплата від базової ставки на добу
 * (підпункти 17 і 18), яка йде поверх випадку й без частки застосування.
 */
function calcCase(groupIndex, state = calcState) {
  const g = DB.groups[groupIndex];
  const rate = DB.rate.case;
  const steps = [];
  const unknown = [];

  let weight = g.k[0];
  steps.push({ label: `Ваговий коефіцієнт ДСГ ${g.c}`, op: '', value: weight,
    src: DB.appendixLabel[g.a], sub: '3' });

  for (const f of DB.factors.filter((x) => x.kind === 'addw')) {
    if (!state[f.id]) continue;
    const add = g.k[f.column];
    if (add === null || add === undefined) {
      unknown.push({ f, why: `у ${DB.appendixLabel[g.a]} для ${g.c} ця колонка порожня` });
      continue;
    }
    weight += add;
    steps.push({ label: f.label, op: '+', value: add, sub: f.sub,
      src: `${DB.appendixLabel[g.a]}, колонка «${DB.appendixCols[g.a][f.column]}»` });
  }

  let adjust = 1;
  for (const f of DB.factors) {
    if (f.stage === 'final' || !state[f.id]) continue;
    if (f.kind === 'mul') {
      const value = f.options ? Number(state[f.id]) : f.value;
      if (!value) continue;
      adjust *= value;
      steps.push({ label: f.label, op: '×', value, sub: f.sub });
    } else if (f.kind === 'addk') {
      const days = Math.max(0, Math.min(Number(state[f.id]) || 0, f.max_days));
      if (!days) continue;
      adjust += f.value * days;
      steps.push({ label: `${f.label} — ${days} діб × ${fmtK(f.value)}`,
        op: '+к', value: f.value * days, sub: f.sub });
    } else if (f.kind === 'unknown') {
      unknown.push({ f, why: 'величину визначають алгоритми і правила НСЗУ' });
    }
  }

  let total = rate * weight * adjust;
  for (const f of DB.factors.filter((x) => x.stage === 'final')) {
    const value = f.editable && state[f.id] !== undefined
      ? Number(state[f.id]) : f.value;
    if (!Number.isFinite(value)) continue;
    total *= value;
    steps.push({ label: f.label, op: '×', value, sub: f.sub });
  }

  // Оплата від базової ставки на добу — поверх випадку, без частки застосування.
  const perDay = [];
  for (const f of DB.factors.filter((x) => x.kind === 'rateday')) {
    const days = Number(state[f.id]) || 0;
    if (!days) continue;
    if (f.drg && !f.drg.includes(g.c)) continue;
    perDay.push({ f, days, sum: rate * f.value * days });
  }

  return { g, rate, weight, adjust, total, steps, unknown, perDay,
    grand: total + perDay.reduce((s, p) => s + p.sum, 0) };
}

/** Той самий розрахунок, але без кроків — для масових прогонів режимів A і C. */
function quickSum(groupIndex, extra = {}) {
  const state = { share: true, balance: true, ...extra };
  return calcCase(groupIndex, state).total;
}

// ── Модуль 1. Паспорт ───────────────────────────────────────────────────────
function wirePassport() {
  const input = el('pQ');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => renderPassport(input.value), 160);
  });
  el('pSuggest').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-code]');
    if (!btn) return;
    input.value = btn.dataset.code;
    renderPassport(btn.dataset.code);
  });
  el('pCard').addEventListener('click', (ev) => {
    const jump = ev.target.closest('[data-calc]');
    if (jump) { openCalc(Number(jump.dataset.calc)); return; }
    const goto = ev.target.closest('[data-code]');
    if (goto) { input.value = goto.dataset.code; renderPassport(goto.dataset.code); }
  });
}

async function renderPassport(raw) {
  const card = el('pCard');
  const hint = el('pHint');
  const code = normCode(raw);
  el('pSuggest').hidden = true;

  if (!code) {
    card.className = 'drg-card drg-card-empty';
    card.innerHTML = '<p class="muted">Введіть код — покажемо його паспорт.</p>';
    hint.textContent = 'Введіть код: діагноз (J18.9), інтервенцію (13750-00) або групу (B02).';
    return;
  }

  const roles = lookup(code);
  if (!roles.length) {
    card.className = 'drg-card drg-card-none';
    card.innerHTML = `<h2>Даних у довіднику немає</h2>
      <p>Код <b>${esc(code)}</b> не знайдено ні серед груп ДСГ додатків 1 і 2,
         ні серед кодів НК 025 і НК 026, які ведуть до груп у Таблиці співставлення.</p>
      <p class="muted">Це не означає, що коду не існує: він може бути в класифікаторі,
         але не фігурувати в жодній специфікації, що оплачується за ДСГ. Перевірте
         у повних класифікаторах:</p>
      <div class="drg-links">
        <a class="drg-xlink" href="../classifiers/index.html?q=${encodeURIComponent(code)}">НК 025 — хвороби</a>
        <a class="drg-xlink" href="../classifiers/nk026.html?q=${encodeURIComponent(code)}">НК 026 — інтервенції</a>
        <a class="drg-xlink" href="../mapping/index.html?q=${encodeURIComponent(code)}">Таблиця співставлення</a>
      </div>`;
    hint.textContent = 'Формат кодів: діагноз J18.9 · інтервенція 13750-00 · група ДСГ B02 або F04C.';
    return;
  }

  hint.textContent = roles.map((r) => KIND_LABEL[r.kind]).join(' + ');
  const names = {};
  if (roles.some((r) => r.kind === 'icd' || r.kind === 'odk')) names.icd = await codeName('icd', code);
  if (roles.some((r) => r.kind === 'achi')) names.achi = await codeName('achi', code);

  const own = roles.find((r) => r.kind === 'drg');
  const title = names.icd || names.achi ||
    (own ? DB.groups[own.hits[0]].t : '');

  const seen = new Set();
  const blocks = [];
  for (const role of roles) {
    const fresh = role.hits.filter((h) => !seen.has(h));
    role.hits.forEach((h) => seen.add(h));
    if (!fresh.length && role.kind !== 'drg') continue;
    blocks.push(renderRoleBlock(role, role.kind === 'drg' ? role.hits : fresh));
  }

  card.className = 'drg-card';
  card.innerHTML = `
    <div class="drg-card-head">
      <div class="drg-card-code">${esc(code)}</div>
      <div class="drg-card-kinds">${roles.map((r) =>
        `<span class="drg-kind drg-kind-${r.kind}">${KIND_LABEL[r.kind]}</span>`).join('')}</div>
    </div>
    ${title ? `<h2 class="drg-card-title">${esc(title)}</h2>` : ''}
    ${blocks.join('')}
    <div class="reader-block">
      <h3>Повна картка коду — у профільному розділі</h3>
      <div class="drg-links">
        <a class="drg-xlink" href="../classifiers/index.html?q=${encodeURIComponent(code)}">Ієрархія в НК 025</a>
        <a class="drg-xlink" href="../classifiers/nk026.html?q=${encodeURIComponent(code)}">Ієрархія в НК 026</a>
        <a class="drg-xlink" href="../mapping/index.html?q=${encodeURIComponent(code)}">Клітинка Таблиці співставлення</a>
        <a class="drg-xlink" href="../postanova/index.html?q=${encodeURIComponent(code)}">Згадки в постанові 1808</a>
      </div>
    </div>
    <div class="drg-card-foot">
      Вагові коефіцієнти — ${esc(DB.meta.sourceDoc)}, додатки 1 і 2.
      Зв'язок коду з групою — Таблиця співставлення, версія ${esc(
        (DB.meta.sources.find((s) => s.id === 'mapping') || {}).version || '—')}.
      Дані розділу зібрано ${esc(DB.meta.generated)}.
    </div>`;
}

function renderRoleBlock(role, hits) {
  const rows = hits
    .map((i) => ({ i, g: DB.groups[i], sum: quickSum(i) }))
    .sort((a, b) => b.sum - a.sum);
  const viaNote = (i) => {
    if (role.kind !== 'odk' || !role.via) return '';
    const ids = role.via.get(i) || [];
    return ids.length ? ` <span class="drg-via">через ${esc(ids.join(', '))}</span>` : '';
  };
  const head = role.kind === 'drg'
    ? `Група ДСГ — коефіцієнти з постанови`
    : `Можливі групи ДСГ (${rows.length})`;
  const sub = role.kind === 'drg' ? '' :
    '<span class="src">фінальну групу присвоює групер ЕСОЗ — тут перелік можливих</span>';

  return `<div class="reader-block">
    <h3>${head} ${sub}</h3>
    <div class="drg-glist">${rows.map(({ i, g, sum }) => `
      <div class="drg-grow">
        <div class="drg-grow-main">
          <b class="drg-gcode">${esc(g.c)}</b>
          <span class="drg-gname">${esc(g.t || '—')}${viaNote(i)}</span>
        </div>
        <div class="drg-grow-meta">
          <span class="drg-app drg-app-${g.a.slice(-1)}">${esc(DB.appendixLabel[g.a])}</span>
          ${g.pkgs.map((p) => `<a class="pk-pkg" href="../passport/index.html?package=${encodeURIComponent(p)}">Пакет № ${esc(p)}</a>`).join('')}
          ${g.sfxk === 'day' ? '<span class="drg-badge">стаціонар одного дня</span>' : ''}
          ${g.sfxk === 'level' ? '<span class="drg-badge">рівень складності</span>' : ''}
        </div>
        <table class="drg-ktable"><tbody>
          ${DB.appendixCols[g.a].map((col, idx) => `
            <tr class="${g.k[idx] === null ? 'is-empty' : ''}">
              <th>${esc(col)}</th><td>${g.k[idx] === null ? '—' : fmtK(g.k[idx])}</td></tr>`).join('')}
        </tbody></table>
        <div class="drg-grow-sum">
          <span class="drg-sum-label">Базовий розрахунок</span>
          <b>${fmtMoney(sum)} грн</b>
          <button class="drg-btn drg-btn-sm" type="button" data-calc="${i}">Відкрити в розрахунку →</button>
        </div>
        <div class="drg-grow-svc">${renderGroupServices(g)}</div>
      </div>`).join('')}</div>
  </div>`;
}

function renderGroupServices(g) {
  if (!g.svc.length) {
    return '<span class="muted">Жодна послуга Таблиці співставлення не веде до цієї групи.</span>';
  }
  const shown = g.svc.slice(0, 4).map((i) => {
    const s = SERVICES[i];
    return s ? `<a class="drg-svc" href="../mapping/index.html?service=${i}">${esc(s.n.slice(0, 90))}</a>` : '';
  }).join('');
  const rest = g.svc.length > 4 ? `<span class="muted">і ще ${g.svc.length - 4}</span>` : '';
  return `<span class="drg-svc-label">Медичні послуги:</span> ${shown} ${rest}`;
}

// ── Модуль 2. Розрахунок ────────────────────────────────────────────────────
let calcGroup = null;

function renderFactors() {
  const box = el('cFactors');
  box.innerHTML = DB.factors.map((f) => {
    const ref = `<span class="drg-sub" title="Підпункт ${esc(f.sub)} пункту 38">п. 38.${esc(f.sub)}</span>`;
    const packages = f.packages
      ? `<span class="drg-pkgs">пакети ${f.packages.join(', ')}</span>` : '';
    const note = f.note ? `<div class="drg-fnote">${esc(f.note)}</div>` : '';

    if (f.kind === 'weight') {
      return `<div class="drg-f is-base"><div class="drg-frow">
        <b>${esc(f.label)}</b>${ref}</div>${note}</div>`;
    }
    if (f.kind === 'unknown') {
      return `<div class="drg-f is-unknown"><div class="drg-frow">
        <span class="drg-fico" aria-hidden="true">∅</span>
        <b>${esc(f.label)}</b>${ref}${packages}</div>${note}</div>`;
    }
    if (f.kind === 'alt') {
      return `<div class="drg-f is-alt"><div class="drg-frow">
        <span class="drg-fico" aria-hidden="true">⇄</span>
        <b>${esc(f.label)}</b>${ref}${packages}</div>${note}</div>`;
    }
    if (f.kind === 'special') {
      return `<div class="drg-f is-alt"><div class="drg-frow">
        <span class="drg-fico" aria-hidden="true">Σ</span>
        <b>${esc(f.label)}</b>${ref}${packages}</div>${note}</div>`;
    }
    if (f.options) {
      return `<div class="drg-f"><div class="drg-frow">
        <label><input type="checkbox" data-f="${f.id}"> ${esc(f.label)}</label>${ref}${packages}
        <select data-fv="${f.id}" disabled>${f.options.map((o) =>
          `<option value="${o.value}">${esc(o.label)} — ${fmtK(o.value)}</option>`).join('')}</select>
      </div>${note}</div>`;
    }
    if (f.kind === 'addk' || f.kind === 'rateday') {
      const max = f.max_days || 60;
      return `<div class="drg-f"><div class="drg-frow">
        <label>${esc(f.label)}</label>${ref}${packages}
        <span class="drg-days"><input type="number" min="0" max="${max}" step="1"
          value="0" data-fd="${f.id}"> діб${f.kind === 'rateday'
          ? ` × ${fmtK(f.value)} ставки` : ''}</span>
      </div>${note}</div>`;
    }
    if (f.editable) {
      return `<div class="drg-f"><div class="drg-frow">
        <label>${esc(f.label)}</label>${ref}
        <input type="number" step="0.001" min="0" value="${f.value}" data-fn="${f.id}">
      </div>${note}</div>`;
    }
    const fixed = f.fixed ? ' checked disabled' : '';
    return `<div class="drg-f${f.fixed ? ' is-fixed' : ''}"><div class="drg-frow">
      <label><input type="checkbox" data-f="${f.id}"${fixed}> ${esc(f.label)}</label>
      ${ref}<span class="drg-fval">${fmtK(f.value)}</span>${packages}</div>${note}</div>`;
  }).join('');

  for (const f of DB.factors) {
    if (f.stage === 'final') calcState[f.id] = f.editable ? f.value : true;
    else if (f.on) calcState[f.id] = f.options ? f.options[0].value : true;
  }

  box.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.f) {
      const f = factorById(t.dataset.f);
      const select = box.querySelector(`[data-fv="${t.dataset.f}"]`);
      if (select) select.disabled = !t.checked;
      calcState[t.dataset.f] = t.checked
        ? (f.options ? Number(select.value) : true) : false;
    } else if (t.dataset.fv) {
      calcState[t.dataset.fv] = Number(t.value);
    } else if (t.dataset.fd) {
      calcState[t.dataset.fd] = Number(t.value);
    } else if (t.dataset.fn) {
      calcState[t.dataset.fn] = Number(t.value);
    }
    if (calcGroup !== null) renderCalc(calcGroup);
  });
}

function wireCalc() {
  const input = el('cQ');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => pickGroups(input.value, 'cPick', 'cHint'), 160);
  });
  el('cPick').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-pick]');
    if (btn) renderCalc(Number(btn.dataset.pick));
  });
}

/** Перелік можливих груп для введеного коду — спільний для модулів 2 і 3C. */
function pickGroups(raw, pickId, hintId) {
  const box = el(pickId);
  const hint = hintId ? el(hintId) : null;
  const roles = lookup(raw);
  if (!normCode(raw)) {
    box.hidden = true;
    if (hint) hint.textContent = 'Введіть код — покажемо всі можливі групи.';
    return [];
  }
  if (!roles.length) {
    box.hidden = false;
    box.innerHTML = '<div class="drg-pick-none">Даних у довіднику немає.</div>';
    if (hint) hint.textContent = 'Код не знайдено ні серед груп, ні серед кодів, що ведуть до груп.';
    return [];
  }
  const hits = [...new Set(roles.flatMap((r) => r.hits))]
    .map((i) => ({ i, g: DB.groups[i], sum: quickSum(i) }))
    .sort((a, b) => b.sum - a.sum);
  if (hint) hint.textContent = `${roles.map((r) => KIND_LABEL[r.kind]).join(' + ')} · ${hits.length} можливих груп`;
  box.hidden = false;
  box.innerHTML = hits.map(({ i, g, sum }) => `
    <button class="drg-pick-row" type="button" data-pick="${i}">
      <b>${esc(g.c)}</b><span>${esc(g.t || '—')}</span>
      <em class="drg-app drg-app-${g.a.slice(-1)}">${esc(DB.appendixLabel[g.a])}</em>
      <span class="drg-pick-sum">${fmtMoney(sum)} грн</span>
    </button>`).join('');
  return hits;
}

function openCalc(groupIndex) {
  setTab('calc');
  const g = DB.groups[groupIndex];
  el('cQ').value = g.c;
  pickGroups(g.c, 'cPick', 'cHint');
  renderCalc(groupIndex);
}

function renderCalc(groupIndex) {
  calcGroup = groupIndex;
  const r = calcCase(groupIndex);
  const g = r.g;

  const stepRows = r.steps.map((s) => `
    <tr>
      <td class="drg-op">${esc(s.op || '=')}</td>
      <td>${esc(s.label)}${s.sub ? ` <span class="drg-sub">п. 38.${esc(s.sub)}</span>` : ''}
          ${s.src ? `<div class="drg-step-src">${esc(s.src)}</div>` : ''}</td>
      <td class="drg-num">${fmtK(s.value)}</td>
    </tr>`).join('');

  const perDay = r.perDay.map((p) => `
    <tr>
      <td class="drg-op">+</td>
      <td>${esc(p.f.label)} — ${p.days} діб × ${fmtK(p.f.value)} базової ставки
        <span class="drg-sub">п. 38.${esc(p.f.sub)}</span></td>
      <td class="drg-num">${fmtMoney(p.sum)}</td>
    </tr>`).join('');

  const unknown = r.unknown.length ? `
    <div class="drg-note drg-note-gap">
      <b>Не входить у розрахунок (${r.unknown.length}):</b>
      <ul>${r.unknown.map((u) =>
        `<li>${esc(u.f.label)} — ${esc(u.why)} <span class="drg-sub">п. 38.${esc(u.f.sub)}</span></li>`).join('')}</ul>
    </div>` : '';

  // Сусідні групи: той самий корінь у тому самому додатку. Саме тут живе
  // різниця рівнів складності й пари «стаціонар / до 24 годин».
  const siblings = DB.groups
    .map((x, i) => ({ x, i }))
    .filter(({ x, i }) => i !== groupIndex && x.root === g.root && x.a === g.a)
    .map(({ i, x }) => ({ i, x, sum: quickSum(i) }))
    .sort((a, b) => b.sum - a.sum);

  const alt = DB.groups
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.root === g.root && x.a !== g.a)
    .map(({ i, x }) => ({ i, x, sum: quickSum(i) }));

  el('cOut').innerHTML = `
    <article class="drg-card drg-calc">
      <div class="drg-card-head">
        <div class="drg-card-code">${esc(g.c)}</div>
        <span class="drg-app drg-app-${g.a.slice(-1)}">${esc(DB.appendixLabel[g.a])}</span>
      </div>
      <h2 class="drg-card-title">${esc(g.t || '—')}</h2>
      <div class="drg-chips">
        ${g.pkgs.map((p) => `<a class="pk-pkg" href="../passport/index.html?package=${encodeURIComponent(p)}">Пакет № ${esc(p)}</a>`).join('')}
      </div>

      <table class="drg-calc-table">
        <thead><tr><th></th><th>Крок</th><th class="drg-num">Значення</th></tr></thead>
        <tbody>
          <tr class="is-rate"><td class="drg-op">×</td>
            <td>${esc(DB.rate.label)} <span class="drg-sub">п. 34</span></td>
            <td class="drg-num">${fmtMoney(r.rate)}</td></tr>
          ${stepRows}
        </tbody>
        <tfoot>
          <tr class="drg-total"><td></td><td>Сума за пролікований випадок</td>
            <td class="drg-num">${fmtMoney(r.total)} грн</td></tr>
          ${perDay}
          ${r.perDay.length ? `<tr class="drg-total"><td></td><td>Разом</td>
            <td class="drg-num">${fmtMoney(r.grand)} грн</td></tr>` : ''}
        </tfoot>
      </table>
      <div class="drg-formula">
        ${fmtMoney(r.rate)} × ${fmtK(r.weight)} <span class="muted">(вага)</span>
        × ${fmtK(r.adjust)} <span class="muted">(коригувальний)</span>
        × ${fmtK(calcState.share === false ? 1 : factorById('share').value)}
        × ${fmtK(Number(calcState.balance) || 1)}
        = <b>${fmtMoney(r.total)} грн</b>
      </div>
      ${unknown}

      ${siblings.length ? `<div class="reader-block">
        <h3>Інші групи того самого кореня ${esc(g.root)}
          <span class="src">у межах ${esc(DB.appendixLabel[g.a])} — саме тут різниця рівнів</span></h3>
        <div class="drg-cmp">${siblings.map(({ i, x, sum }) => {
          const delta = sum - r.total;
          return `<button class="drg-cmp-row" type="button" data-pick="${i}">
            <b>${esc(x.c)}</b><span>${esc(x.t || '—')}</span>
            ${x.sfxk === 'day' ? '<em class="drg-badge">одного дня</em>' : ''}
            ${x.sfxk === 'level' ? '<em class="drg-badge">рівень складності</em>' : ''}
            <span class="drg-cmp-sum">${fmtMoney(sum)} грн</span>
            <span class="drg-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${fmtMoney(delta)}</span>
          </button>`;
        }).join('')}</div>
      </div>` : ''}

      ${alt.length ? `<div class="reader-block">
        <h3>Той самий корінь в іншому додатку
          <span class="src">інший режим оплати, а не інша сума за те саме</span></h3>
        <div class="drg-cmp">${alt.map(({ i, x, sum }) => `
          <button class="drg-cmp-row is-alt" type="button" data-pick="${i}">
            <b>${esc(x.c)}</b><span>${esc(x.t || '—')}</span>
            <em class="drg-app drg-app-${x.a.slice(-1)}">${esc(DB.appendixLabel[x.a])}</em>
            <span class="drg-cmp-sum">${fmtMoney(sum)} грн</span>
          </button>`).join('')}</div>
        <p class="drg-fnote">${esc(factorById('cardio_alt').note)}</p>
      </div>` : ''}
    </article>`;

  el('cOut').querySelectorAll('[data-pick]').forEach((btn) =>
    btn.addEventListener('click', () => renderCalc(Number(btn.dataset.pick))));
}

// ── Модуль 3. Пошук аномалій ────────────────────────────────────────────────
/* Кожне правило — окрема функція, яка повертає рядки таблиці. Правила прямо
 * називають, чого в наших даних немає: правил CC/MCC (супутні стани й
 * ускладнення) не існує в жодному відкритому джерелі, тому «додавання
 * супутнього діагнозу» перевіряється не вигаданою таблицею, а тими факторами,
 * які постанова справді документує: додатковий коефіцієнт за дітей і за
 * травми, рівні складності в межах кореня, пара «стаціонар / одного дня».
 */
const RULES = [
  { id: 'spread_root', on: true,
    label: 'Розкид ваг у межах одного кореня ДСГ',
    hint: 'Групи одного кореня в одному додатку відрізняються ваговим коефіцієнтом більше ніж у N разів.' },
  { id: 'spread_achi', on: true,
    label: 'Одна інтервенція веде до груп із різними вагами',
    hint: 'Той самий код НК 026 фігурує в групах, вагові коефіцієнти яких відрізняються більше ніж у N разів.' },
  { id: 'documented_delta', on: true,
    label: 'Документований фактор змінює суму більше ніж на X %',
    hint: 'Додатковий коефіцієнт за допомогу дітям або за лікування травм додається до ваги і піднімає суму — вектор кодування віку й обставини травми.' },
  { id: 'cheap_surgery', on: true,
    label: 'Хірургічна група з низькою сумою',
    hint: 'Група пакета 3 «Хірургічні операції…» із сумою нижче порога. Хірургічність тут не вгадана: її задає сам пакет.' },
  { id: 'gaps', on: true,
    label: 'Діри: група без ваги, вага без групи, послуга без ДСГ',
    hint: 'Позиції, де ланцюжок «послуга → група → коефіцієнт» рветься. Рядки з іншим режимом оплати позначено окремо й не рахуються дірою.' },
  { id: 'day_pair', on: true,
    label: 'Пара «стаціонар / стаціонар одного дня»',
    hint: 'Код і код-01: та сама операція в пакетах 3 і 47. У чинній редакції ваги в усіх парах однакові, тож правило зводить це в один рядок і показує окремо лише ті пари, де вага таки різна.' },
  { id: 'same_name', on: true,
    label: 'Однакова назва — різна вага',
    hint: 'Дві групи одного додатка названі дослівно однаково, але оплачуються по-різному. Порогів не має: або назви збігаються, або ні.' },
];

/** Скільки рядків малюємо. Решта є в CSV — таблиця на кілька тисяч рядків
 *  не читається, а тихо обрізати результат гірше, ніж сказати про обрізання. */
const ROW_LIMIT = 300;

/* Ступінь підозрілості — «у скільки разів перевищено поріг»: 1,0 означає
 * рівно на порозі. Без спільної одиниці сортування було безглуздим: розкид у
 * 20 разів (score 20) стояв нижче за приріст 300 % (score 300), хоча це просто
 * різні одиниці. Для правил без порогів ступінь задано явно нижче. */
const GAP_SCORE = {
  'Діра: група без ваги': 2,
  'Послуга без ДСГ': 2,
  'Колізія код ↔ діапазон МКХ': 1.5,
  'Вага без входу': 1.2,
  'Інший режим оплати': 0.5,
};

function renderRules() {
  el('auditRules').innerHTML = RULES.map((r) => `
    <label class="drg-rule">
      <input type="checkbox" data-rule="${r.id}"${r.on ? ' checked' : ''}>
      <span><b>${esc(r.label)}</b><em>${esc(r.hint)}</em></span>
    </label>`).join('');
}

function thresholds() {
  return {
    N: Math.max(1.01, Number(el('thN').value) || 3),
    X: Math.max(1, Number(el('thX').value) || 30),
    SUM: Math.max(0, Number(el('thSum').value) || 0),
  };
}

function ruleSpreadRoot({ N }) {
  const byRoot = new Map();
  DB.groups.forEach((g, i) => {
    const key = `${g.a}|${g.root}`;
    (byRoot.get(key) || byRoot.set(key, []).get(key)).push({ i, g });
  });
  const rows = [];
  for (const [key, list] of byRoot) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => a.g.k[0] - b.g.k[0]);
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    const ratio = hi.g.k[0] / lo.g.k[0];
    if (ratio < N) continue;
    rows.push({
      type: 'Розкид у корені',
      combo: list.map((x) => x.g.c).join(' / '),
      drg: `${lo.g.c} → ${hi.g.c}`,
      sum: quickSum(hi.i),
      score: ratio / N,
      why: `корінь ${key.split('|')[1]}, ${DB.appendixLabel[list[0].g.a]}: вага ${fmtK(lo.g.k[0])} → ${fmtK(hi.g.k[0])} (×${ratio.toFixed(2)}); суми ${fmtMoney(quickSum(lo.i))} → ${fmtMoney(quickSum(hi.i))} грн`,
      pick: hi.i,
    });
  }
  return rows;
}

function ruleSpreadAchi({ N }) {
  const rows = [];
  for (const [code, hits] of Object.entries(DB.byAchi)) {
    if (hits.length < 2) continue;
    // лише в межах одного додатка — інакше порівнюємо два режими оплати
    const byApp = new Map();
    for (const i of hits) {
      const a = DB.groups[i].a;
      (byApp.get(a) || byApp.set(a, []).get(a)).push(i);
    }
    for (const [app, list] of byApp) {
      if (list.length < 2) continue;
      const sorted = list.slice().sort((x, y) => DB.groups[x].k[0] - DB.groups[y].k[0]);
      const lo = sorted[0], hi = sorted[sorted.length - 1];
      const ratio = DB.groups[hi].k[0] / DB.groups[lo].k[0];
      if (ratio < N) continue;
      rows.push({
        type: 'Розкид за інтервенцією',
        combo: code,
        drg: `${DB.groups[lo].c} → ${DB.groups[hi].c}`,
        sum: quickSum(hi),
        score: ratio / N,
        why: `${DB.appendixLabel[app]}: інтервенція веде до ${list.length} груп, вага ${fmtK(DB.groups[lo].k[0])} → ${fmtK(DB.groups[hi].k[0])} (×${ratio.toFixed(2)}); різниця ${fmtMoney(quickSum(hi) - quickSum(lo))} грн`,
        pick: hi,
      });
    }
  }
  return rows;
}

function ruleDocumentedDelta({ X }) {
  const rows = [];
  DB.groups.forEach((g, i) => {
    DB.factors.filter((f) => f.kind === 'addw').forEach((f) => {
      const add = g.k[f.column];
      if (!add) return;
      const pct = (add / g.k[0]) * 100;
      if (pct < X) return;
      const base = quickSum(i);
      const withAdd = quickSum(i, { [f.id]: true });
      rows.push({
        type: 'Документований фактор',
        combo: `${g.c} + ${f.label.toLowerCase()}`,
        drg: g.c,
        sum: withAdd,
        score: pct / X,
        why: `${DB.appendixCols[g.a][f.column]} ${fmtK(add)} додається до ваги ${fmtK(g.k[0])} — це +${pct.toFixed(1)} % до суми: ${fmtMoney(base)} → ${fmtMoney(withAdd)} грн (п. 38.${f.sub})`,
        pick: i,
      });
    });
  });
  return rows;
}

function ruleCheapSurgery({ SUM }) {
  const rows = [];
  DB.groups.forEach((g, i) => {
    if (!g.pkgs.includes('3')) return;
    const sum = quickSum(i);
    if (sum >= SUM) return;
    rows.push({
      type: 'Дешева хірургія',
      combo: g.c,
      drg: g.c,
      sum,
      score: sum > 0 ? SUM / sum : 0,
      why: `група пакета 3 «Хірургічні операції дорослим та дітям у стаціонарних умовах» із сумою ${fmtMoney(sum)} грн — нижче порога ${fmtMoney(SUM)} грн; вага ${fmtK(g.k[0])}`,
      pick: i,
    });
  });
  return rows;
}

function ruleGaps() {
  const rows = [];
  for (const r of DB.orphanDrg) {
    rows.push({
      type: r.why === 'gap' ? 'Діра: група без ваги' : 'Інший режим оплати',
      combo: r.c,
      drg: r.c,
      sum: null,
      score: GAP_SCORE[r.why === 'gap' ? 'Діра: група без ваги' : 'Інший режим оплати'],
      why: `${DB.gapLabel[r.why]}; пакети ${r.p.join(', ')}; у Таблиці співставлення: ${r.t.slice(0, 90) || '—'}`,
    });
  }
  for (const r of DB.noService) {
    rows.push({
      type: 'Вага без входу',
      combo: r.c,
      drg: r.c,
      sum: null,
      score: GAP_SCORE['Вага без входу'],
      why: `${DB.appendixLabel[r.a]} дає вагу ${fmtK(r.k[0])}, але жодна послуга Таблиці співставлення до групи не веде: ${r.t.slice(0, 90)}`,
    });
  }
  for (const r of DB.noDrg.filter((x) => x.why === 'gap')) {
    rows.push({
      type: 'Послуга без ДСГ',
      combo: `послуга № ${r.i}`,
      drg: '—',
      sum: null,
      score: GAP_SCORE['Послуга без ДСГ'],
      why: `пакети ${r.p.join(', ')} оплачуються за додатками, але групи в рядку немає: ${r.n.slice(0, 110)}`,
    });
  }
  for (const r of DB.crossRegime) {
    rows.push({
      type: 'Колізія код ↔ діапазон МКХ',
      combo: r.c,
      drg: r.c,
      sum: null,
      score: GAP_SCORE['Колізія код ↔ діапазон МКХ'],
      why: `пакет ${r.p.join(', ')}: у колонці «Медична послуга» стоїть діапазон МКХ, а не ДСГ, і код збігся з групою «${r.drg}» іншого режиму. Зв'язок відкинуто при збірці`,
    });
  }
  return rows;
}

/* Пари «стаціонар / стаціонар одного дня». Початкове припущення було, що тут
 * місце тарифного арбітражу, і воно виявилося хибним: у чинній редакції всі 72
 * пари мають ДОСЛІВНО однакову вагу. Тому правило показує різницю там, де вона
 * є, а факт її відсутності зводить в один підсумковий рядок замість 72
 * однакових. Ступінь нижче 1,0 читається як «поріг не перевищено»: це
 * спостереження про дизайн тарифу, а не кандидат на порушення. */
function ruleDayPair({ N }) {
  const rows = [];
  const byCode = new Map(DB.groups.map((g, i) => [`${g.a}|${g.c}`, i]));
  let equal = 0;
  let sample = null;
  DB.groups.forEach((g, i) => {
    if (g.sfxk !== 'day') return;
    const base = byCode.get(`${g.a}|${g.root}`);
    if (base === undefined) {
      rows.push({
        type: 'Стаціонар проти одного дня',
        combo: g.c, drg: g.c, sum: quickSum(i),
        score: GAP_SCORE['Вага без входу'],
        why: `група «до 24 годин» є, а базової стаціонарної ${g.root} у ${DB.appendixLabel[g.a]} немає — порівнювати ні з чим`,
        pick: i,
      });
      return;
    }
    const ratio = DB.groups[base].k[0] / g.k[0];
    if (Math.abs(ratio - 1) < 1e-9) {
      equal += 1;
      sample = sample || { base, day: i };
      return;
    }
    rows.push({
      type: 'Стаціонар проти одного дня',
      combo: `${g.root} / ${g.c}`,
      drg: `${DB.groups[base].c} ↔ ${g.c}`,
      sum: quickSum(base),
      score: Math.max(ratio, 1 / ratio) / N,
      why: `та сама операція: ${DB.groups[base].c} (вага ${fmtK(DB.groups[base].k[0])}, ${fmtMoney(quickSum(base))} грн) проти ${g.c} «до 24 годин» (вага ${fmtK(g.k[0])}, ${fmtMoney(quickSum(i))} грн); різниця ${fmtMoney(quickSum(base) - quickSum(i))} грн, ×${ratio.toFixed(2)}`,
      pick: base,
    });
  });
  if (equal && sample) {
    rows.push({
      type: 'Стаціонар проти одного дня',
      combo: `${equal} пар «код / код-01»`,
      drg: `${DB.groups[sample.base].c} ↔ ${DB.groups[sample.day].c}`,
      sum: quickSum(sample.base),
      score: 0.9,
      why: `у всіх ${equal} парах ваговий коефіцієнт стаціонарної групи і групи «до 24 годин» однаковий (наприклад ${DB.groups[sample.base].c} і ${DB.groups[sample.day].c} — ${fmtK(DB.groups[sample.base].k[0])}). Отже різниця між пакетами 3 і 47 закладена не у вагу ДСГ, а в умови закупівлі та окремі коефіцієнти пунктів 36 і 38: саме перекодування «одного дня» у стаціонар суми за випадок не змінює`,
      pick: sample.base,
    });
  }
  return rows;
}

function ruleSameName() {
  const key = (t) => String(t || '').toLowerCase()
    .replace(/[«»"'.,;:()]/g, '').replace(/\s+/g, ' ').trim();
  const byName = new Map();
  DB.groups.forEach((g, i) => {
    if (!g.t) return;
    const k = `${g.a}|${key(g.t)}`;
    (byName.get(k) || byName.set(k, []).get(k)).push({ i, g });
  });
  const rows = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    const weights = new Set(list.map((x) => x.g.k[0]));
    if (weights.size < 2) continue;
    const sorted = list.slice().sort((a, b) => a.g.k[0] - b.g.k[0]);
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    rows.push({
      type: 'Однакова назва — різна вага',
      combo: list.map((x) => x.g.c).join(' / '),
      drg: `${lo.g.c} ↔ ${hi.g.c}`,
      sum: quickSum(hi.i),
      score: hi.g.k[0] / lo.g.k[0],
      why: `${DB.appendixLabel[hi.g.a]}: «${hi.g.t}» — ${lo.g.c} з вагою ${fmtK(lo.g.k[0])} (${fmtMoney(quickSum(lo.i))} грн) і ${hi.g.c} з вагою ${fmtK(hi.g.k[0])} (${fmtMoney(quickSum(hi.i))} грн); різниця ${fmtMoney(quickSum(hi.i) - quickSum(lo.i))} грн. Що саме відрізняє ці групи, з назви не видно`,
      pick: hi.i,
    });
  }
  return rows;
}

const RULE_FN = {
  spread_root: ruleSpreadRoot,
  spread_achi: ruleSpreadAchi,
  documented_delta: ruleDocumentedDelta,
  cheap_surgery: ruleCheapSurgery,
  gaps: ruleGaps,
  day_pair: ruleDayPair,
  same_name: ruleSameName,
};

let auditRows = [];

function wireAudit() {
  el('auditRun').addEventListener('click', runAudit);
  // В експорт ідуть усі рядки за обраними типами, без ліміту показу: саме на
  // це посилається підпис під таблицею, коли рядків більше, ніж намальовано.
  el('auditCsv').addEventListener('click', () =>
    downloadCsv('anomalii-dsg',
      ['Комбінація', 'ДСГ', 'Сума, грн', 'Тип', 'Перевищення порога', 'Пояснення'],
      auditRows.filter((r) => !typeOff.has(r.type))
        .map((r) => [r.combo, r.drg, r.sum === null ? '' : r.sum.toFixed(2),
          r.type, r.score.toFixed(3), r.why])));
  el('bRun').addEventListener('click', runCombo);
  el('bQ').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') runCombo(); });
  document.querySelectorAll('.drg-subtab').forEach((btn) =>
    btn.addEventListener('click', () => setSubtab(btn.dataset.mode)));
  el('auditOut').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-open]');
    if (btn) openCalc(Number(btn.dataset.open));
  });
}

function runAudit() {
  const th = thresholds();
  const active = [...document.querySelectorAll('[data-rule]')]
    .filter((c) => c.checked).map((c) => c.dataset.rule);
  auditRows = active.flatMap((id) => RULE_FN[id](th));
  auditRows.sort((a, b) => b.score - a.score);

  el('auditCsv').disabled = !auditRows.length;
  el('auditCount').textContent = auditRows.length
    ? `${auditRows.length} кандидатів на перевірку`
    : 'за цими порогами нічого не знайдено';

  const byType = new Map();
  for (const r of auditRows) byType.set(r.type, (byType.get(r.type) || 0) + 1);
  typeOff.clear();

  el('auditOut').innerHTML = `
    <div class="drg-note drg-note-gap" id="auditCap" hidden></div>
    <div class="drg-filter">
      <b>За типом:</b>
      ${[...byType].map(([t, n]) =>
        `<label><input type="checkbox" data-type="${esc(t)}" checked> ${esc(t)} <em>${n}</em></label>`).join('')}
    </div>
    <div class="drg-table-wrap"><table class="drg-table" id="auditTable">
      <thead><tr>
        <th data-sort="combo">Комбінація</th>
        <th data-sort="drg">ДСГ</th>
        <th data-sort="sum" class="drg-num">Сума, грн</th>
        <th data-sort="type">Тип</th>
        <th data-sort="score" class="drg-num"
            title="У скільки разів перевищено заданий поріг; 1,0 — рівно на порозі">Перевищення</th>
        <th>Чому позначено</th>
      </tr></thead>
      <tbody></tbody>
    </table></div>`;

  el('auditOut').querySelectorAll('[data-type]').forEach((box) =>
    box.addEventListener('change', () => {
      box.checked ? typeOff.delete(box.dataset.type) : typeOff.add(box.dataset.type);
      paintAudit();
    }));
  el('auditOut').querySelectorAll('th[data-sort]').forEach((th) =>
    th.addEventListener('click', () => sortAudit(th.dataset.sort)));
  paintAudit();
}

/** Типи, зняті галочкою. Фільтр мусить діяти ДО зрізу ROW_LIMIT: інакше
 *  вимкнення шумного правила лише прорідило б ті самі 300 рядків, а решта
 *  так і лишилася б за межею показу. */
const typeOff = new Set();

function paintAudit() {
  const rows = auditRows.filter((r) => !typeOff.has(r.type));
  const shown = rows.slice(0, ROW_LIMIT);
  el('auditTable').querySelector('tbody').innerHTML = shown.map(rowHtml).join('');
  const cap = el('auditCap');
  if (rows.length > ROW_LIMIT) {
    cap.hidden = false;
    cap.innerHTML = `За обраними типами знайдено <b>${rows.length}</b>
      кандидатів, у таблиці показано перші <b>${ROW_LIMIT}</b> за перевищенням
      порога. Решта не зникла — вона є в експорті CSV. Щоб скоротити перелік,
      підніміть пороги або зніміть типи, які дають найбільше рядків.`;
  } else {
    cap.hidden = true;
  }
}

const sortDir = {};
function sortAudit(key) {
  sortDir[key] = !sortDir[key];
  const dir = sortDir[key] ? 1 : -1;
  auditRows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (typeof x === 'number' || typeof y === 'number') {
      return ((x ?? -1) - (y ?? -1)) * dir;
    }
    return String(x).localeCompare(String(y), 'uk') * dir;
  });
  paintAudit();
}

function rowHtml(r) {
  return `<tr data-type="${esc(r.type)}">
    <td><b>${esc(r.combo)}</b></td>
    <td>${r.pick !== undefined
      ? `<button class="drg-linkish" type="button" data-open="${r.pick}">${esc(r.drg)}</button>`
      : esc(r.drg)}</td>
    <td class="drg-num">${r.sum === null ? '—' : fmtMoney(r.sum)}</td>
    <td><span class="drg-type">${esc(r.type)}</span></td>
    <td class="drg-num">${r.score.toFixed(2)}</td>
    <td class="drg-why">${esc(r.why)}</td>
  </tr>`;
}

// Режим B — перевірка конкретної комбінації.
function runCombo() {
  const parts = el('bQ').value.split(/[,;]+/).map(normCode).filter(Boolean);
  const out = el('bOut');
  if (!parts.length) {
    out.innerHTML = '<div class="drg-card drg-card-empty"><p class="muted">Введіть коди через кому.</p></div>';
    return;
  }
  const found = [];
  const missing = [];
  for (const code of parts) {
    const roles = lookup(code);
    if (!roles.length) { missing.push(code); continue; }
    found.push({ code, roles, hits: [...new Set(roles.flatMap((r) => r.hits))] });
  }
  if (!found.length) {
    out.innerHTML = `<div class="drg-card drg-card-none"><h2>Даних у довіднику немає</h2>
      <p>Жоден із кодів (${missing.map(esc).join(', ')}) не веде до груп ДСГ.</p></div>`;
    return;
  }

  // Спільні групи — ті, до яких ведуть ВСІ введені коди. Це не результат
  // групування: перетин лише звужує перелік можливих груп.
  const sets = found.map((f) => new Set(f.hits));
  const common = [...sets[0]].filter((i) => sets.every((s) => s.has(i)));
  const union = [...new Set(found.flatMap((f) => f.hits))];
  const th = thresholds();
  const scope = common.length ? common : union;

  // Правило «розкид за інтервенцією» фільтруємо за самим кодом, а не за групою:
  // інакше в перелік лізли сусідні інтервенції, які лише ведуть до тієї самої
  // групи, і пояснення говорило про код, якого користувач не вводив.
  const entered = new Set(found.map((f) => f.code));
  const flags = [];
  for (const rule of RULES) {
    if (rule.id === 'gaps') continue;
    const hits = RULE_FN[rule.id](th).filter((r) => rule.id === 'spread_achi'
      ? entered.has(r.combo)
      : r.pick !== undefined && scope.includes(r.pick));
    for (const h of hits) flags.push({ rule, h });
  }

  const rows = scope
    .map((i) => ({ i, g: DB.groups[i], sum: quickSum(i) }))
    .sort((a, b) => b.sum - a.sum);

  out.innerHTML = `
    <article class="drg-card">
      <h2 class="drg-card-title">Комбінація: ${found.map((f) => `<b>${esc(f.code)}</b>`).join(' + ')}</h2>
      <p class="drg-fnote">${found.map((f) =>
        `${esc(f.code)} — ${f.roles.map((r) => KIND_LABEL[r.kind]).join(', ')}`).join(' · ')}
        ${missing.length ? `<br>Немає в довіднику: ${missing.map(esc).join(', ')}.` : ''}</p>
      <div class="reader-block">
        <h3>${common.length ? `Групи, до яких ведуть усі коди (${common.length})`
          : `Спільних груп немає — показано всі можливі (${union.length})`}
          <span class="src">перетин звужує перелік, але не групує випадок</span></h3>
        <div class="drg-cmp">${rows.slice(0, 12).map(({ i, g, sum }) => `
          <button class="drg-cmp-row" type="button" data-open="${i}">
            <b>${esc(g.c)}</b><span>${esc(g.t || '—')}</span>
            <em class="drg-app drg-app-${g.a.slice(-1)}">${esc(DB.appendixLabel[g.a])}</em>
            <span class="drg-cmp-sum">${fmtMoney(sum)} грн</span>
          </button>`).join('')}</div>
      </div>
      <div class="reader-block">
        <h3>Чи виглядає комбінація аномальною</h3>
        ${flags.length ? `<ul class="drg-flags">${flags.map(({ rule, h }) =>
          `<li><b>${esc(h.drg)}</b> · ${esc(rule.label)} — ${esc(h.why)}</li>`).join('')}</ul>`
          : `<p class="drg-ok">За чинними порогами (розкид ×${th.N}, фактор ${th.X} %,
             поріг ${fmtMoney(th.SUM)} грн) правила нічого не позначили — усе в межах норми.</p>`}
      </div>
    </article>`;
  out.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => openCalc(Number(btn.dataset.open))));
}

// ── Режим C: стрес-тест, лише для авторизованих ─────────────────────────────
let fraudRows = [];
let fraudGroup = null;

async function wireFraudGate() {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const apply = (session) => {
    const open = Boolean(session?.user);
    el('cLock').hidden = open;
    el('cBody').hidden = !open;
  };
  const { data } = await sb.auth.getSession();
  apply(data?.session);
  sb.auth.onAuthStateChange((_event, session) => apply(session));

  const input = el('fQ');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pickGroups(input.value, 'fPick', null);
      el('fRun').disabled = fraudGroup === null;
    }, 160);
  });
  el('fPick').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-pick]');
    if (!btn) return;
    fraudGroup = Number(btn.dataset.pick);
    el('fPick').querySelectorAll('.drg-pick-row').forEach((r) =>
      r.classList.toggle('is-picked', r === btn));
    el('fRun').disabled = false;
  });
  el('fRun').addEventListener('click', runFraud);
  el('fCsv').addEventListener('click', () =>
    downloadCsv('stres-test-dsg',
      ['Стратегія', 'Базова ДСГ', 'Ставши ДСГ', 'Базова сума', 'Нова сума', 'Дельта, грн', 'Дельта, %', 'Чим стримується'],
      fraudRows.map((r) => [r.strategy, r.from, r.to, r.base.toFixed(2),
        r.next.toFixed(2), r.delta.toFixed(2), r.pct.toFixed(1), r.control])));
}

/* Маніпуляції, які МОЖНА порахувати на довідниках. Кожна спирається на
 * задокументовану різницю в постанові, а не на здогад про поведінку групера.
 * Для кожної одразу вказано, чим постанова її стримує — інакше карта читалась
 * би як інструкція, а не як стрес-тест дизайну.
 */
/* Назва стратегії залежить від того, ЩО насправді відрізняє сусідню групу.
 * Для суфікса «-А» додаток не дає нічого: назва та сама, вага інша, тож
 * називати перехід «важчим рівнем складності» означало б вигадати підставу. */
const STRATEGY = {
  day: 'Перекодувати як стаціонарний випадок замість стаціонару одного дня',
  level: 'Перекодувати на важчий рівень складності того самого кореня',
  level_day: 'Перекодувати на важчий рівень складності того самого кореня',
  dash: 'Перекодувати на однойменну групу з вищою вагою',
  other: 'Перекодувати на іншу групу того самого кореня',
  '': 'Перекодувати на базову групу того самого кореня',
};

function runFraud() {
  if (fraudGroup === null) return;
  const g = DB.groups[fraudGroup];
  const base = quickSum(fraudGroup);
  const rows = [];

  const push = (strategy, i, control, extra) => {
    const next = i === null ? quickSum(fraudGroup, extra) : quickSum(i, extra);
    const to = i === null ? g.c : DB.groups[i].c;
    if (next <= base) return;
    rows.push({ strategy, from: g.c, to, base, next,
      delta: next - base, pct: ((next - base) / base) * 100, control, pick: i ?? fraudGroup });
  };

  DB.groups.forEach((x, i) => {
    if (i === fraudGroup || x.root !== g.root) return;
    if (x.a === g.a) {
      push(STRATEGY[x.sfxk] || STRATEGY.other, i,
        x.sfxk === 'day'
          ? 'Пакети 3 і 47 різні: випадок «до 24 годин» оплачується за пакетом 47. Підпункти 6, 7 і 10 пункту 38 вводять нижнє референтне значення тривалості — коротке лікування в пакеті 3 перераховується за день.'
          : x.sfxk === 'dash'
            ? 'Чим ця група відрізняється від однойменної, з додатка 1 не видно: назви дослівно однакові. Поки різниця не описана, підстави для вибору групи перевірити нічим — це питання до дизайну додатка, а не до контролю.'
            : 'Рівень складності присвоює групер ЕСОЗ за медичними записами, а назва групи в додатку прямо називає складність; підпункт 11 пункту 36 знижує оплату за амбулаторно-асоційовані стани.');
    } else {
      push('Перейти в режим додатка 2 (кардіохірургічні групи)', i,
        'Підпункт 15 пункту 38: додаток 2 діє лише для закладів, які провели 50 і більше втручань за переліченими ДСГ або 30 і більше втручань з відновлення кровотоку. Умова перевіряється за даними ЕСОЗ, а не заявою закладу.');
    }
  });

  for (const f of DB.factors.filter((x) => x.kind === 'addw')) {
    if (!g.k[f.column]) continue;
    push(`Заявити фактор «${f.label.toLowerCase()}»`, null,
      f.id === 'child_add'
        ? 'Вік пацієнта є в медичних записах ЕСОЗ; коефіцієнт діє лише для надкластерних, кластерних і державних закладів за умовами підпункту 6 пункту 38.'
        : 'Основний діагноз класу S або T і тривалість у межах референтних значень перевіряються за записами; коефіцієнт діє лише для надавачів з переліку МОЗ.',
      { [f.id]: true });
  }

  // Розщеплення одного випадку на два — класика; в наших даних воно вимірне як
  // подвійна оплата тієї самої групи, а стримується підпунктом 9 пункту 36.
  rows.push({
    strategy: 'Розщепити випадок на дві госпіталізації',
    from: g.c, to: `${g.c} × 2`, base, next: base * 2,
    delta: base, pct: 100,
    control: 'Підпункт 9 пункту 36: повторна госпіталізація в той самий заклад протягом 30 днів з діагнозом тієї самої основної діагностичної категорії знижує глобальний бюджет до 0,6 або 0,4 залежно від частки таких випадків.',
    pick: fraudGroup,
  });

  rows.sort((a, b) => b.delta - a.delta);
  fraudRows = rows;
  el('fCsv').disabled = !rows.length;

  el('fOut').innerHTML = `
    <article class="drg-card">
      <h2 class="drg-card-title">Базовий випадок: ${esc(g.c)} — ${esc(g.t || '—')}</h2>
      <p class="drg-fnote">Чесний розрахунок: <b>${fmtMoney(base)} грн</b>
        (${esc(DB.appendixLabel[g.a])}, вага ${fmtK(g.k[0])}).
        Нижче — маніпуляції, вигідніші за базовий випадок, від найбільшої вигоди.</p>
      ${rows.length ? `<div class="drg-table-wrap"><table class="drg-table">
        <thead><tr><th>Стратегія</th><th>Стає ДСГ</th>
          <th class="drg-num">Нова сума</th><th class="drg-num">Δ грн</th>
          <th class="drg-num">Δ %</th><th>Чим стримується</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.strategy)}</td>
          <td><button class="drg-linkish" type="button" data-open="${r.pick}">${esc(r.to)}</button></td>
          <td class="drg-num">${fmtMoney(r.next)}</td>
          <td class="drg-num drg-delta up">+${fmtMoney(r.delta)}</td>
          <td class="drg-num">+${r.pct.toFixed(1)}</td>
          <td class="drg-why">${esc(r.control)}</td>
        </tr>`).join('')}</tbody></table></div>`
        : `<p class="drg-ok">Для цієї групи вигідніших перекодувань у наших даних
           немає: ні сусідніх груп того самого кореня, ні документованих
           додаткових коефіцієнтів.</p>`}
    </article>`;
  el('fOut').querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => openCalc(Number(btn.dataset.open))));
}

// ── CSV ─────────────────────────────────────────────────────────────────────
/** BOM обов'язковий: без нього Excel читає українські назви як «????». */
function downloadCsv(name, head, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${DB.meta.generated}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Вкладки ─────────────────────────────────────────────────────────────────
function setTab(mod) {
  document.querySelectorAll('.drg-tab').forEach((btn) => {
    const on = btn.dataset.mod === mod;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.drg-mod').forEach((section) => {
    section.hidden = section.id !== `mod-${mod}`;
  });
  const url = new URL(location.href);
  url.searchParams.set('mod', mod);
  history.replaceState(null, '', url);
}

function setSubtab(mode) {
  document.querySelectorAll('.drg-subtab').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.mode === mode));
  document.querySelectorAll('.drg-submod').forEach((box) => {
    box.hidden = box.id !== `aud-${mode}`;
  });
}

function wireTabs() {
  document.querySelectorAll('.drg-tab').forEach((btn) =>
    btn.addEventListener('click', () => setTab(btn.dataset.mod)));
}

/** ?code=J18.9&mod=calc — щоб посилання з інших розділів відкривало потрібне. */
function openFromQuery() {
  const params = new URLSearchParams(location.search);
  const mod = params.get('mod');
  if (mod && ['passport', 'calc', 'audit'].includes(mod)) setTab(mod);
  const code = params.get('code') || params.get('q');
  if (!code) return;
  el('pQ').value = code;
  renderPassport(code);
  if (mod === 'calc') {
    el('cQ').value = code;
    const hits = pickGroups(code, 'cPick', 'cHint');
    if (hits.length) renderCalc(hits[0].i);
  }
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('.drg-main').insertAdjacentHTML('afterbegin',
    `<div class="drg-note drg-note-warn">Не вдалося завантажити дані розділу.
     Перезавантажте сторінку; якщо не допомогло — дані ще не зібрано
     (<code>python 05_Веб_реєстр/drg/build_drg.py</code>).</div>`);
});
