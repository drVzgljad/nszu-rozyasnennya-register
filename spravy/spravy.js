/**
 * Розділ «Справи відділу» — дошка вхідних і наших відповідей на них.
 *
 * Одна картка = одна справа: вхідний документ із резолюцією → виконавець і
 * чернетка vN → погодження (рецензія, зауваження керівників) → на підписі →
 * вих. № і закрита резолюція. Те саме, що тека 00_ВХІДНЕ\NN\<вх.№>_<хто>_<суть>
 * в обміннику, тільки видно всім у відділі одразу.
 *
 * Дані — Supabase: dept_cases (картки) і dept_case_events (стрічка подій і
 * зауваження), обидві під RLS «свій відділ + керівництво + діловод». Етап,
 * версію, виконавця й рецензію в стрічку пише ТРИГЕР бази, а не ця сторінка:
 * так у стрічку потрапляє й те, що Claude змінює напряму через SQL
 * (migration_2026-11-02_dept_cases.sql).
 *
 * Персональних даних у файлі немає й не може бути — репозиторій публічний.
 * Демо-картки режиму ?demo=1 вигадані.
 */
const $ = (id) => document.getElementById(id);

const STAGES = [
  { key: 'new',     label: 'Нове',       hint: 'зареєстровано, ще не взялися' },
  { key: 'work',    label: 'Готуємо',    hint: 'виконавець, чернетка vN' },
  { key: 'review',  label: 'Погодження', hint: 'рецензія, керівник' },
  { key: 'signing', label: 'На підписі', hint: '10_НА_ПІДПИС' },
  { key: 'done',    label: 'Закрито',    hint: 'вих. №, резолюцію закрито' }
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const KIND_LABEL = { letter: 'Лист', sz: 'СЗ', pi: 'ПІ', info: 'До відома', other: 'Інше' };
// Чиє зауваження: керівництво департаменту підтягується з profiles (під RLS) —
// прізвищ у публічному репозиторії бути не повинно.
const REMARK_ROLES = ['Керівник відділу', 'Рецензент', 'Інше'];
const REMARK_STATUS = { open: 'Не враховано', done: 'Враховано', rejected: 'Не приймаємо' };
const LEADERSHIP = ['admin', 'director', 'deputy_director'];
const DEPARTMENTS = [
  'стратегічного розвитку програми медичних гарантій',
  'наукова та клінічна експертиза',
  'розвиток програми реімбурсації',
  'взаємодія з надавачами медичних послуг',
  'розрахунок вартості медичних послуг',
  'робота з електронними медичними даними'
];
const MISSING = /relation .* does not exist|could not find the table|PGRST205|42P01/i;
const DEMO = new URLSearchParams(location.search).has('demo');

const state = {
  sb: null,
  me: null,           // auth user
  profile: null,
  dept: '',           // відділ, який показуємо
  canPickDept: false, // керівництво й діловод бачать усі відділи
  cases: [],
  events: [],         // події відкритої справи
  remarkCounts: {},   // case_id → кількість незакритих зауважень
  people: [],         // співробітники відділу для поля «Виконавець»
  leaders: [],        // керівництво департаменту для поля «Чиє зауваження»
  q: '',
  mine: false,
  mobileStage: 'work',
  openId: null,
  demoEvents: {}
};

/* ───────────────────────── утиліти ───────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');
const fmtStamp = (ts) => {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
function daysLeft(iso) {
  if (!iso) return null;
  const a = new Date(todayISO() + 'T00:00:00');
  const b = new Date(iso.slice(0, 10) + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
/** Строк → { cls, text }. Закриті справи строком не «горять». */
function deadlineInfo(c) {
  const n = daysLeft(c.deadline);
  if (n === null) return null;
  const date = fmtDate(c.deadline);
  if (c.stage === 'done') return { cls: 'is-closed', text: date };
  if (n < 0) return { cls: 'is-over', text: `${date} · прострочено ${-n} дн.` };
  if (n === 0) return { cls: 'is-hot', text: `${date} · сьогодні` };
  if (n === 1) return { cls: 'is-hot', text: `${date} · завтра` };
  if (n <= 3) return { cls: 'is-hot', text: `${date} · за ${n} дн.` };
  return { cls: 'is-ok', text: date };
}
const initials = (name) => (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const myName = () => (DEMO ? 'Демо-користувач' : (state.profile?.full_name || state.me?.email || ''));

function toast(text, bad) {
  const t = $('spToast');
  t.textContent = text;
  t.classList.toggle('is-bad', !!bad);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ───────────────────────── дані ───────────────────────── */

async function client() {
  // auth-v2.js — модуль і може підвантажитися пізніше за цей скрипт
  for (let i = 0; i < 30 && !window.__pmgSb; i++) await new Promise((r) => setTimeout(r, 150));
  return window.__pmgSb || null;
}

async function boot() {
  wireStatic();
  if (DEMO) return bootDemo();

  state.sb = await client();
  if (!state.sb) return showNotice('Не вдалося підключитися до бази. Оновіть сторінку.');
  const { data: { session } } = await state.sb.auth.getSession();
  state.me = session?.user ?? null;
  if (!state.me) return showNotice('Увійдіть, щоб побачити справи свого відділу.');

  const { data: p } = await state.sb.from('profiles').select('*').eq('id', state.me.id).single();
  state.profile = p || {};
  if (state.profile.role === 'guest') return showNotice('Справи відділу доступні лише співробітникам департаменту.');
  state.canPickDept = LEADERSHIP.includes(state.profile.role) || state.profile.is_clerk === true;
  state.dept = state.profile.Section || '';
  if (!state.dept || !DEPARTMENTS.includes(state.dept)) {
    state.dept = state.canPickDept ? DEPARTMENTS[0] : state.dept;
  }
  setupDeptPicker();
  await loadLeaders();
  await loadPeople();
  await loadCases();
  subscribe();
}

function bootDemo() {
  state.profile = { full_name: 'Демо-користувач', role: 'admin' };
  state.dept = 'демо-відділ';
  state.leaders = ['Директор департаменту'];
  fillRemarkFrom();
  state.people = [{ id: 'u1', full_name: 'Олена Приклад' }, { id: 'u2', full_name: 'Петро Зразок' }, { id: 'u3', full_name: 'Демо-користувач' }];
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const mk = (o) => ({ id: crypto.randomUUID(), department: 'демо-відділ', reply_kind: 'letter', review_passed: false, priority: 0, source: 'manual', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...o });
  state.cases = [
    mk({ in_no: '10001-08-26', in_date: d(-6), correspondent: 'Міністерство (демо)', subject: 'Погодження проєкту наказу про зміни до переліку обладнання — п\'ятиденний строк', deadline: d(-1), stage: 'new', resolution: 'Керівник скл., відділ А, відділ Б', askod_state: 'До виконання', source: 'askod' }),
    mk({ in_no: 'Д-1002-26', in_date: d(-3), correspondent: 'Громадянин (демо)', subject: 'Чи покриває програма медичних гарантій обстеження за направленням лікаря ПМД', deadline: d(2), stage: 'work', executor_name: 'Олена Приклад', version: 2, draft_path: '19_службові_записки\\letter_demo_v2.json', reply_kind: 'sz', nuances: 'Нових умов не вигадувати — лише специфікація пакета.' }),
    mk({ in_no: '10003-12-26', in_date: d(-10), correspondent: 'Обласна адміністрація (демо)', subject: 'Впровадження нових вагових коефіцієнтів з 01.01.2027', deadline: d(9), stage: 'review', executor_name: 'Петро Зразок', version: 3, draft_url: 'https://docs.google.com/', nuances: 'Проєкт наступного року не тлумачимо.' }),
    mk({ in_no: 'ПІ-104-26', in_date: d(-4), correspondent: 'Запитувач (демо)', subject: 'Запит на інформацію: тарифи та кількість закладів за пакетом', deadline: d(1), stage: 'signing', executor_name: 'Демо-користувач', version: 2, reply_kind: 'pi', review_passed: true, draft_path: '10_НА_ПІДПИС\\02.11.26\\lyst_demo_v2.docx' }),
    mk({ in_no: '10005-06-26', in_date: d(-20), correspondent: 'Комітет (демо)', subject: 'Інформація щодо оплати медичних послуг у 2026 році', deadline: d(-5), stage: 'done', executor_name: 'Олена Приклад', version: 4, review_passed: true, out_no: '24001/8-15-26', out_date: d(-6) }),
    mk({ in_no: null, subject: 'Ініціативний лист: роз\'яснення закладам щодо обліку послуг', stage: 'work', executor_name: 'Петро Зразок', version: 1, deadline: d(14), source: 'claude' })
  ];
  const c3 = state.cases[2].id;
  state.demoEvents[c3] = [
    { id: 'e1', case_id: c3, created_at: new Date(Date.now() - 864e5 * 3).toISOString(), author_name: 'Claude', kind: 'system', body: 'Справу заведено з журналу АСКОД' },
    { id: 'e2', case_id: c3, created_at: new Date(Date.now() - 864e5 * 2).toISOString(), author_name: 'Петро Зразок', kind: 'version', body: 'Чернетка v2' },
    { id: 'e3', case_id: c3, created_at: new Date(Date.now() - 864e5).toISOString(), author_name: 'Петро Зразок', kind: 'remark', remark_from: 'Директор департаменту', remark_status: 'done', remark_answer: 'Терміни взято з постанови, заголовки без двокрапки', remark_version: 3, body: 'Регістр: «як правило» прибрати, терміни — з норми' },
    { id: 'e4', case_id: c3, created_at: new Date().toISOString(), author_name: 'Claude', kind: 'remark', remark_from: 'Керівник відділу', remark_status: 'open', body: 'Другий абзац скоротити до однієї тези' }
  ];
  state.remarkCounts = { [c3]: 1 };
  $('spDeptName').textContent = 'Демо-режим: картки вигадані, нічого не зберігається в базі';
  render();
}

function showNotice(text) {
  $('spBoard').innerHTML = `<div class="sp-notice">${esc(text)}</div>`;
  $('spBoard').classList.add('is-empty');
}

function setupDeptPicker() {
  const sel = $('spDept');
  $('spDeptName').textContent = state.dept ? `Відділ ${state.dept}` : '';
  if (!state.canPickDept) { sel.hidden = true; return; }
  sel.innerHTML = DEPARTMENTS.map((d) => `<option value="${esc(d)}"${d === state.dept ? ' selected' : ''}>${esc(d)}</option>`).join('');
  sel.hidden = false;
  sel.addEventListener('change', async () => {
    state.dept = sel.value;
    $('spDeptName').textContent = `Відділ ${state.dept}`;
    await loadPeople();
    await loadCases();
  });
}

async function loadLeaders() {
  const { data } = await state.sb.from('profiles').select('full_name, role')
    .in('role', ['director', 'deputy_director']).order('role');
  state.leaders = (data || []).map((p) => (p.full_name || '').split(/\s+/).pop()).filter(Boolean);
  fillRemarkFrom();
}

function fillRemarkFrom() {
  $('spRemarkFrom').innerHTML = [...state.leaders, ...REMARK_ROLES].map((r) => `<option>${esc(r)}</option>`).join('');
}

async function loadPeople() {
  const { data } = await state.sb.from('profiles').select('id, full_name, role').eq('Section', state.dept).order('full_name');
  state.people = (data || []).filter((p) => p.role !== 'guest');
}

async function loadCases() {
  const { data, error } = await state.sb.from('dept_cases').select('*').eq('department', state.dept)
    .order('priority').order('deadline', { nullsFirst: false });
  if (error) {
    if (MISSING.test(error.message || error.code || '')) {
      return showNotice('Таблиць справ у базі ще немає: потрібно застосувати migration_2026-11-02_dept_cases.sql у Supabase SQL Editor. Подивитися, як виглядатиме дошка, можна в демо-режимі: додайте до адреси ?demo=1.');
    }
    return showNotice('Не вдалося завантажити справи: ' + (error.message || error.code));
  }
  state.cases = data || [];
  await loadRemarkCounts();
  render();
  if (state.openId) openCase(state.openId, true);
}

async function loadRemarkCounts() {
  state.remarkCounts = {};
  const ids = state.cases.filter((c) => c.stage !== 'done').map((c) => c.id);
  if (!ids.length) return;
  const { data } = await state.sb.from('dept_case_events').select('case_id')
    .eq('kind', 'remark').eq('remark_status', 'open').in('case_id', ids);
  (data || []).forEach((r) => { state.remarkCounts[r.case_id] = (state.remarkCounts[r.case_id] || 0) + 1; });
}

function subscribe() {
  let timer = null;
  const reload = () => { clearTimeout(timer); timer = setTimeout(loadCases, 400); };
  state.sb.channel('dept-cases')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dept_cases' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dept_case_events' }, reload)
    .subscribe();
}

/** Зберегти зміну картки. У демо — лише в пам'яті. */
async function saveCase(id, patch) {
  const c = state.cases.find((x) => x.id === id);
  if (!c) return;
  const prev = { ...c };
  Object.assign(c, patch, { updated_by_name: myName() });
  if (DEMO) {
    demoLog(c, prev);
    render();
    if (state.openId === id) { renderDrawerHead(c); loadEvents(id); }
    return true;
  }
  const { error } = await state.sb.from('dept_cases').update({ ...patch, updated_by_name: myName() }).eq('id', id);
  if (error) {
    Object.assign(c, prev);
    render();
    toast('Не збережено: ' + error.message, true);
    return false;
  }
  render();
  if (state.openId === id) { renderDrawerHead(c); await loadEvents(id); }
  return true;
}

/** Демо-імітація тригера бази. */
function demoLog(c, prev) {
  const ev = (kind, body) => (state.demoEvents[c.id] ||= []).push({ id: crypto.randomUUID(), case_id: c.id, created_at: new Date().toISOString(), author_name: myName(), kind, body });
  if (c.stage !== prev.stage) ev('stage', `${STAGE_LABEL[prev.stage]} → ${STAGE_LABEL[c.stage]}`);
  if (c.version !== prev.version && c.version) ev('version', `Чернетка v${c.version}`);
  if (c.executor_name !== prev.executor_name) ev('executor', `Виконавець: ${c.executor_name || '—'}`);
  if (c.review_passed !== prev.review_passed) ev('review', c.review_passed ? 'Рецензію пройдено' : 'Рецензію знято');
}

async function addEvent(caseId, row) {
  if (DEMO) {
    (state.demoEvents[caseId] ||= []).push({ id: crypto.randomUUID(), case_id: caseId, created_at: new Date().toISOString(), author_name: myName(), ...row });
    recountDemo(caseId);
    render();
    return loadEvents(caseId);
  }
  const { error } = await state.sb.from('dept_case_events').insert({ case_id: caseId, author_id: state.me.id, author_name: myName(), ...row });
  if (error) return toast('Не збережено: ' + error.message, true);
  await loadEvents(caseId);
  await loadRemarkCounts();
  render();
}

async function updateEvent(caseId, evId, patch) {
  if (DEMO) {
    Object.assign((state.demoEvents[caseId] || []).find((e) => e.id === evId) || {}, patch);
    recountDemo(caseId);
    render();
    return loadEvents(caseId);
  }
  const { error } = await state.sb.from('dept_case_events').update(patch).eq('id', evId);
  if (error) return toast('Не збережено: ' + error.message, true);
  await loadEvents(caseId);
  await loadRemarkCounts();
  render();
}

function recountDemo(caseId) {
  state.remarkCounts[caseId] = (state.demoEvents[caseId] || []).filter((e) => e.kind === 'remark' && e.remark_status === 'open').length;
}

async function loadEvents(caseId) {
  if (DEMO) { state.events = state.demoEvents[caseId] || []; renderEvents(); return; }
  const { data } = await state.sb.from('dept_case_events').select('*').eq('case_id', caseId).order('created_at');
  state.events = data || [];
  renderEvents();
}

/* ───────────────────────── дошка ───────────────────────── */

function visibleCases() {
  const q = state.q.trim().toLowerCase();
  const me = myName();
  return state.cases.filter((c) => {
    if (state.mine && c.executor_name !== me) return false;
    if (!q) return true;
    return [c.in_no, c.subject, c.correspondent, c.executor_name, c.resolution, c.out_no, c.nuances]
      .some((v) => v && String(v).toLowerCase().includes(q));
  });
}

/** Порядок у колонці: спершу те, що горить. Закриті — найсвіжіші зверху. */
function sortCol(list, stage) {
  if (stage === 'done') return list.sort((a, b) => String(b.out_date || b.updated_at).localeCompare(String(a.out_date || a.updated_at)));
  return list.sort((a, b) => (a.priority - b.priority) || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
}

function render() {
  const list = visibleCases();
  renderStats();
  const board = $('spBoard');
  board.classList.remove('is-empty');
  board.innerHTML = STAGES.map((s) => {
    const items = sortCol(list.filter((c) => c.stage === s.key), s.key);
    const shown = s.key === 'done' ? items.slice(0, 30) : items;
    return `<section class="sp-col${s.key === state.mobileStage ? ' is-mobile-active' : ''}" data-stage="${s.key}">
      <header class="sp-col-head">
        <span class="sp-col-title">${s.label}</span>
        <span class="sp-col-count">${items.length}</span>
        <span class="sp-col-hint">${s.hint}</span>
      </header>
      <div class="sp-col-body" data-drop="${s.key}">
        ${shown.map(cardHTML).join('') || '<div class="sp-col-empty">порожньо</div>'}
        ${items.length > shown.length ? `<div class="sp-col-more">ще ${items.length - shown.length} — знайдіть пошуком</div>` : ''}
      </div>
    </section>`;
  }).join('');
  renderMobileTabs(list);
}

function cardHTML(c) {
  const dl = deadlineInfo(c);
  const remarks = state.remarkCounts[c.id] || 0;
  const badges = [
    `<span class="sp-kind">${KIND_LABEL[c.reply_kind] || ''}</span>`,
    c.version ? `<span class="sp-ver" title="Поточна версія чернетки">v${c.version}</span>` : '',
    c.review_passed ? '<span class="sp-ok" title="Рецензію пройдено">✓ рецензія</span>' : '',
    remarks ? `<span class="sp-rem" title="Незакриті зауваження">⚑ ${remarks}</span>` : '',
    c.source === 'claude' ? '<span class="sp-src" title="Справу завів Claude">Claude</span>' : ''
  ].join('');
  return `<article class="sp-card" draggable="true" data-id="${c.id}" tabindex="0" role="button" aria-label="${esc((c.in_no || 'Без вх. №') + ': ' + c.subject)}">
    <div class="sp-card-top">
      <span class="sp-inno">${esc(c.in_no || 'без вх. №')}</span>
      ${dl ? `<span class="sp-dl ${dl.cls}">${esc(dl.text)}</span>` : ''}
    </div>
    <div class="sp-subj">${esc(c.subject)}</div>
    ${c.correspondent ? `<div class="sp-corr">${esc(c.correspondent)}</div>` : ''}
    <div class="sp-card-foot">
      <div class="sp-badges">${badges}</div>
      ${c.executor_name ? `<span class="sp-ava" title="${esc(c.executor_name)}">${esc(initials(c.executor_name))}</span>` : '<span class="sp-ava is-none" title="Виконавця не призначено">?</span>'}
    </div>
    ${c.out_no ? `<div class="sp-out">вих. № ${esc(c.out_no)}${c.out_date ? ' від ' + fmtDate(c.out_date) : ''}</div>` : ''}
  </article>`;
}

function renderStats() {
  const active = state.cases.filter((c) => c.stage !== 'done');
  const over = active.filter((c) => { const n = daysLeft(c.deadline); return n !== null && n < 0; }).length;
  const hot = active.filter((c) => { const n = daysLeft(c.deadline); return n !== null && n >= 0 && n <= 3; }).length;
  const rem = Object.values(state.remarkCounts).reduce((a, b) => a + b, 0);
  $('statActive').textContent = active.length;
  $('statHot').textContent = hot;
  $('statOver').textContent = over;
  $('statRemarks').textContent = rem;
}

function renderMobileTabs(list) {
  $('spStageTabs').innerHTML = STAGES.map((s) => {
    const n = list.filter((c) => c.stage === s.key).length;
    return `<button type="button" class="sp-stab${s.key === state.mobileStage ? ' is-active' : ''}" data-stage="${s.key}">${s.label} <b>${n}</b></button>`;
  }).join('');
}

/* ───────────────────────── картка справи ───────────────────────── */

function fieldsHTML(c) {
  const people = state.people.map((p) => p.full_name).filter(Boolean);
  if (c.executor_name && !people.includes(c.executor_name)) people.unshift(c.executor_name);
  const opt = (v, cur, label) => `<option value="${esc(v)}"${v === (cur ?? '') ? ' selected' : ''}>${esc(label ?? v)}</option>`;
  return `
  <div class="sp-grid">
    <label class="sp-f"><span>Вх. №</span><input data-f="in_no" value="${esc(c.in_no)}" placeholder="10001-08-26"></label>
    <label class="sp-f"><span>Дата реєстрації</span><input type="date" data-f="in_date" value="${esc(c.in_date)}"></label>
    <label class="sp-f"><span>Строк</span><input type="date" data-f="deadline" value="${esc(c.deadline)}"></label>
    <label class="sp-f sp-wide"><span>Суть</span><textarea data-f="subject" rows="2">${esc(c.subject)}</textarea></label>
    <label class="sp-f sp-wide"><span>Кореспондент</span><input data-f="correspondent" value="${esc(c.correspondent)}"></label>
    <label class="sp-f"><span>Його вих. №</span><input data-f="corr_out_no" value="${esc(c.corr_out_no)}"></label>
    <label class="sp-f"><span>від</span><input type="date" data-f="corr_out_date" value="${esc(c.corr_out_date)}"></label>
    <label class="sp-f"><span>Тип відповіді</span><select data-f="reply_kind">${Object.entries(KIND_LABEL).map(([k, v]) => opt(k, c.reply_kind, v)).join('')}</select></label>
    <label class="sp-f sp-wide"><span>Резолюція (хто скл., співвиконавці)</span><input data-f="resolution" value="${esc(c.resolution)}" placeholder="Прізвище скл., Прізвище, Прізвище"></label>
    <label class="sp-f"><span>Виконавець у відділі</span><select data-f="executor_name">${opt('', c.executor_name, '— не призначено —')}${people.map((p) => opt(p, c.executor_name)).join('')}</select></label>
    <label class="sp-f"><span>Версія чернетки</span><input type="number" min="1" data-f="version" value="${esc(c.version)}" placeholder="1"></label>
    <label class="sp-f sp-check"><input type="checkbox" data-f="review_passed"${c.review_passed ? ' checked' : ''}><span>Рецензію пройдено</span></label>
    <label class="sp-f sp-wide"><span>Файл в обміннику</span><input data-f="draft_path" value="${esc(c.draft_path)}" placeholder="10_НА_ПІДПИС\\02.11.26\\lyst_…_v2.docx"></label>
    <label class="sp-f sp-wide"><span>Посилання (Google Doc із зауваженнями, OneDrive)</span>
      <span class="sp-linkrow"><input data-f="draft_url" value="${esc(c.draft_url)}" placeholder="https://docs.google.com/…">${/^https?:\/\//.test(c.draft_url || '') ? `<a class="sp-btn sp-btn-ghost" href="${esc(c.draft_url)}" target="_blank" rel="noopener">Відкрити</a>` : ''}</span></label>
    <label class="sp-f sp-wide"><span>Нюанси — на що зважати</span><textarea data-f="nuances" rows="3" placeholder="Що не можна писати, з чим звірити, хто вже відповідав">${esc(c.nuances)}</textarea></label>
    <label class="sp-f"><span>Вих. № НСЗУ</span><input data-f="out_no" value="${esc(c.out_no)}"></label>
    <label class="sp-f"><span>Дата відправлення</span><input type="date" data-f="out_date" value="${esc(c.out_date)}"></label>
    ${c.askod_state ? `<div class="sp-f sp-ro"><span>Стан резолюції в АСКОД</span><b>${esc(c.askod_state)}</b></div>` : ''}
  </div>`;
}

function renderDrawerHead(c) {
  $('spDrawerTitle').textContent = c.in_no ? `Вх. № ${c.in_no}` : 'Справа без вх. №';
  $('spDrawerSub').textContent = c.subject;
  const cur = STAGES.findIndex((x) => x.key === c.stage);
  $('spStepper').innerHTML = STAGES.map((s, i) => {
    const cls = i < cur ? 'is-past' : i === cur ? 'is-current' : '';
    return `<button type="button" class="sp-step ${cls}" data-stage="${s.key}" aria-pressed="${i === cur}">${s.label}</button>`;
  }).join('');
}

/**
 * Відкрити картку. refresh=true — оновлення вже відкритої (після збереження чи
 * realtime): поля перемальовуємо, лише якщо курсор не стоїть у жодному з них,
 * інакше людина втратить те, що саме набирає.
 */
function openCase(id, refresh) {
  const c = state.cases.find((x) => x.id === id);
  if (!c) return;
  state.openId = id;
  const dlg = $('spDrawer');
  const scroll = refresh ? $('spDrawerBody').scrollTop : 0;
  renderDrawerHead(c);
  if (!refresh || !dlg.contains(document.activeElement) || !document.activeElement.matches('input, textarea, select')) {
    $('spFields').innerHTML = fieldsHTML(c);
  }
  $('spDelete').hidden = !canDelete();
  if (!dlg.open) dlg.showModal();
  loadEvents(id).then(() => { $('spDrawerBody').scrollTop = scroll; });
}

function canDelete() {
  if (DEMO) return true;
  const p = state.profile || {};
  return LEADERSHIP.includes(p.role) || ((p.role === 'manager' || p.is_head === true) && p.Section === state.dept);
}

function renderEvents() {
  const remarks = state.events.filter((e) => e.kind === 'remark');
  const feed = state.events.filter((e) => e.kind !== 'remark').slice().reverse();
  const open = remarks.filter((r) => r.remark_status === 'open').length;
  $('spRemarksCount').textContent = remarks.length ? `${open} з ${remarks.length} не враховано` : '';
  $('spRemarks').innerHTML = remarks.length ? remarks.map((r) => `
    <li class="sp-remark is-${r.remark_status || 'open'}" data-ev="${r.id}">
      <div class="sp-remark-head">
        <b>${esc(r.remark_from || 'Зауваження')}</b>
        <span class="sp-muted">${fmtStamp(r.created_at)} · вніс ${esc(r.author_name || '—')}</span>
        <select class="sp-remark-status" aria-label="Стан зауваження">${Object.entries(REMARK_STATUS).map(([k, v]) => `<option value="${k}"${k === (r.remark_status || 'open') ? ' selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="sp-remark-body">${esc(r.body)}</div>
      <div class="sp-remark-answer">
        <input class="sp-remark-ans" value="${esc(r.remark_answer)}" placeholder="Як враховано (або чому ні)">
        <input class="sp-remark-ver" type="number" min="1" value="${esc(r.remark_version)}" placeholder="у v…" aria-label="У якій версії враховано">
      </div>
    </li>`).join('') : '<li class="sp-muted sp-none">Зауважень немає.</li>';
  $('spFeed').innerHTML = feed.length ? feed.map((e) => `
    <li class="sp-ev sp-ev-${e.kind}">
      <span class="sp-ev-when">${fmtStamp(e.created_at)}</span>
      <span class="sp-ev-who">${esc(e.author_name || '—')}</span>
      <span class="sp-ev-what">${esc(e.body)}</span>
    </li>`).join('') : '<li class="sp-muted sp-none">Подій ще немає.</li>';
}

/* ───────────────────────── нова справа ───────────────────────── */

async function createCase(form) {
  const fd = new FormData(form);
  const row = {
    department: state.dept,
    in_no: (fd.get('in_no') || '').trim() || null,
    subject: (fd.get('subject') || '').trim(),
    correspondent: (fd.get('correspondent') || '').trim() || null,
    deadline: fd.get('deadline') || null,
    reply_kind: fd.get('reply_kind') || 'letter',
    executor_name: fd.get('executor_name') || null,
    stage: fd.get('executor_name') ? 'work' : 'new',
    source: 'manual',
    created_by_name: myName()
  };
  if (!row.subject) return toast('Вкажіть суть справи', true);
  if (DEMO) {
    const c = { id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), priority: 0, review_passed: false, ...row };
    state.cases.push(c);
    state.demoEvents[c.id] = [{ id: crypto.randomUUID(), case_id: c.id, created_at: c.created_at, author_name: myName(), kind: 'system', body: 'Справу заведено' }];
  } else {
    const ex = state.people.find((p) => p.full_name === row.executor_name);
    if (ex) row.executor_id = ex.id;
    const { error } = await state.sb.from('dept_cases').insert({ ...row, created_by: state.me.id });
    if (error) {
      const dup = /duplicate|23505/.test(error.message || error.code || '');
      return toast(dup ? `Справа з вх. № ${row.in_no} у відділі вже є` : 'Не збережено: ' + error.message, true);
    }
    await loadCases();
  }
  $('spNew').close();
  form.reset();
  render();
  toast('Справу заведено');
}

/* ───────────────────────── події інтерфейсу ───────────────────────── */

function wireStatic() {
  $('spSearch').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('spMine').addEventListener('change', (e) => { state.mine = e.target.checked; render(); });

  $('spAdd').addEventListener('click', () => {
    const sel = $('spNewExecutor');
    sel.innerHTML = '<option value="">— пізніше —</option>' + state.people.map((p) => `<option>${esc(p.full_name)}</option>`).join('');
    $('spNew').showModal();
  });
  $('spNewForm').addEventListener('submit', (e) => { e.preventDefault(); createCase(e.target); });
  $('spNewCancel').addEventListener('click', () => $('spNew').close());

  $('spStageTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stage]');
    if (!b) return;
    state.mobileStage = b.dataset.stage;
    render();
  });

  const board = $('spBoard');
  board.addEventListener('click', (e) => {
    const card = e.target.closest('.sp-card');
    if (card) openCase(card.dataset.id);
  });
  board.addEventListener('keydown', (e) => {
    const card = e.target.closest('.sp-card');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCase(card.dataset.id); }
  });
  // Перетягування між колонками (десктоп)
  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.sp-card');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  });
  board.addEventListener('dragend', (e) => {
    e.target.closest('.sp-card')?.classList.remove('is-dragging');
    board.querySelectorAll('.is-over').forEach((x) => x.classList.remove('is-over'));
  });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('[data-drop]');
    if (!col) return;
    e.preventDefault();
    board.querySelectorAll('.is-over').forEach((x) => x !== col && x.classList.remove('is-over'));
    col.classList.add('is-over');
  });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('[data-drop]');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('is-over');
    const id = e.dataTransfer.getData('text/plain');
    const c = state.cases.find((x) => x.id === id);
    if (c && c.stage !== col.dataset.drop) saveCase(id, { stage: col.dataset.drop });
  });

  // Картка справи
  const dlg = $('spDrawer');
  $('spClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { state.openId = null; });
  $('spStepper').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stage]');
    if (b && state.openId) saveCase(state.openId, { stage: b.dataset.stage });
  });
  $('spFields').addEventListener('change', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el || !state.openId) return;
    const f = el.dataset.f;
    let v = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (f === 'version') v = v ? parseInt(v, 10) : null;
    else if (v === '' && f !== 'subject') v = null;
    if (f === 'subject' && !v) { toast('Суть не може бути порожньою', true); return; }
    const patch = { [f]: v };
    if (f === 'executor_name' && !DEMO) patch.executor_id = state.people.find((p) => p.full_name === v)?.id || null;
    saveCase(state.openId, patch);
  });
  $('spDelete').addEventListener('click', async () => {
    const c = state.cases.find((x) => x.id === state.openId);
    if (!c || !confirm(`Видалити справу ${c.in_no || ''} разом зі стрічкою подій? Цю дію не можна скасувати.`)) return;
    if (!DEMO) {
      const { error } = await state.sb.from('dept_cases').delete().eq('id', c.id);
      if (error) return toast('Не видалено: ' + error.message, true);
    }
    state.cases = state.cases.filter((x) => x.id !== c.id);
    dlg.close();
    render();
  });

  // Зауваження
  fillRemarkFrom();
  $('spRemarkForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('spRemarkText').value.trim();
    if (!text || !state.openId) return;
    addEvent(state.openId, { kind: 'remark', body: text, remark_from: $('spRemarkFrom').value, remark_status: 'open' });
    $('spRemarkText').value = '';
  });
  $('spRemarks').addEventListener('change', (e) => {
    const li = e.target.closest('[data-ev]');
    if (!li || !state.openId) return;
    if (e.target.classList.contains('sp-remark-status')) updateEvent(state.openId, li.dataset.ev, { remark_status: e.target.value });
    if (e.target.classList.contains('sp-remark-ans')) updateEvent(state.openId, li.dataset.ev, { remark_answer: e.target.value.trim() || null });
    if (e.target.classList.contains('sp-remark-ver')) updateEvent(state.openId, li.dataset.ev, { remark_version: e.target.value ? parseInt(e.target.value, 10) : null });
  });

  // Коментар у стрічку
  $('spCommentForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('spComment').value.trim();
    if (!text || !state.openId) return;
    addEvent(state.openId, { kind: 'comment', body: text });
    $('spComment').value = '';
  });
}

boot();
