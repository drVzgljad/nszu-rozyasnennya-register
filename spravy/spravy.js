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
 * Повна історія справи (migration_2026-11-02b_dept_cases_history.sql):
 * головний виконавець і наша роль, продовження строку з підставою (первинний
 * строк зберігається), повернення на доопрацювання з причиною, відправлені
 * документи (листи, СЗ у робочому порядку), нагадування з датою. Підставу
 * зміни сторінка передає в полі change_note — тригер переносить її в історію.
 *
 * Персональних даних у файлі немає й не може бути — репозиторій публічний.
 * Демо-картки режиму ?demo=1 вигадані.
 *
 * Голосова кімната відділу — окремий модуль voice.js (WebRTC + приватний канал
 * Realtime, migration_2026-11-03_voice_room.sql), текстовий канал під нею —
 * room-chat.js (кімната відділу з чату порталу). Версії ?v= обох піднімати тут.
 */
import { initVoice, setVoiceDept } from './voice.js?v=20261103l';
import { initRoomChat, setRoomChatDept } from './room-chat.js?v=20261103e';

const $ = (id) => document.getElementById(id);

const STAGES = [
  { key: 'new',     label: 'Нове',       hint: 'зареєстровано, ще не взялися' },
  { key: 'work',    label: 'Готуємо',    hint: 'виконавець, чернетка vN' },
  { key: 'review',  label: 'Погодження', hint: 'рецензія, керівник' },
  { key: 'signing', label: 'На підписі', hint: '10_НА_ПІДПИС' },
  { key: 'sz_sent', label: 'СЗ надано',  hint: 'робочий порядок, головному виконавцю' },
  { key: 'done',    label: 'Закрито',    hint: 'вих. №, резолюцію закрито' }
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const KIND_LABEL = { letter: 'Лист', sz: 'СЗ', sz_work: 'СЗ (робочий порядок)', pi: 'ПІ', info: 'До відома', other: 'Інше' };
const KIND_SHORT = { letter: 'Лист', sz: 'СЗ', sz_work: 'СЗ роб.', pi: 'ПІ', info: 'До відома', other: 'Інше' };
const ROLE_LABEL = { lead: 'Ми — головний виконавець', co: 'Ми — співвиконавці', info: 'Нам — до відома' };
const ROLE_SHORT = { lead: 'Гол.', co: 'Співвик.', info: 'До відома' };
const DOC_KIND = { letter: 'Лист', sz: 'Службова записка', sz_work: 'СЗ у робочому порядку', other: 'Інший документ' };
// Значок події в історії справи
const EV_ICON = {
  system: '•', stage: '→', version: '✎', executor: '👤', review: '✓', comment: '💬', remark: '⚑',
  deadline: '⏱', returned: '↩', outgoing: '📤', reminder: '🔔'
};
// СКО-Д (облік роботи): гілка «Робота в АСКОД» особистого кабінету. Перелік типів і
// справ номенклатури — з cabinet/cabinet.js (BRANCH_CONFIG.askod): змінюєте там —
// змініть і тут. Коефіцієнти складності — звідти ж (COEFFICIENTS).
const SKOD_TYPES = ['01 — Лист', '22 — Судові документи', '44 — Претензія', '45 — Нормативно-правові акти',
  '46 — Запрошення', '47 — Лист-запит', '49 — Проект розпорядження КМУ', '50 — Проект ЗУ',
  '51 — Проект указу Президента України', '52 — Проект постанови КМУ', 'Інше (вказати в описі)'];
const SKOD_CATEGORIES = ['8-01 — Закони, укази, акти ВРУ та Президента', '8-02 — Постанови, розпорядження КМУ',
  '8-03 — Доручення Верховної Ради України', '8-04 — Доручення Офісу Президента України',
  '8-05 — Доручення Кабінету Міністрів України', '8-06 — Доручення (листи) МОЗ України',
  '8-07 — Доручення Голови НСЗУ та заступників', '8-08 — Накази НСЗУ з основної діяльності',
  '8-09 — Депутатські запити та звернення', '8-10 — Запити на публічну інформацію', '8-11 — Звернення громадян',
  '8-12 — Службові записки, довідки з основної діяльності', '8-14 — Листування з ЦОВВ та місцевими органами влади',
  '8-15 — Листування з підприємствами та установами', '8-16 — Доручення директора департаменту',
  '8-17 — Рішення колегії НСЗУ', '8.2-02 — Службові записки відділу', 'Інше'];
const SKOD_COEF = { easy: 1.0, medium: 1.3, hard: 1.8, expert: 2.5 };

/** Справа номенклатури за замовчуванням — з вх. № і типу відповіді; людина може змінити. */
function guessCategory(c) {
  const no = c.in_no || '';
  if (c.reply_kind === 'pi' || /^ПІ-/.test(no)) return '8-10 — Запити на публічну інформацію';
  if (/^[А-ЯІЇЄҐ]{1,2}-\d/.test(no)) return '8-11 — Звернення громадян';
  if (c.reply_kind === 'sz' || c.reply_kind === 'sz_work') return '8-12 — Службові записки, довідки з основної діяльності';
  if (/-08-\d{2}$/.test(no)) return '8-06 — Доручення (листи) МОЗ України';
  return '8-15 — Листування з підприємствами та установами';
}

// Підказки для поля «Головний виконавець» — лише назви підрозділів, без прізвищ.
// Відділи нашого департаменту — першими: часто департамент головний, а головний виконавець
// у ньому — інший відділ, і ми співвиконавці (назви — як у бланку форми 37-Д).
const LEAD_UNITS = [
  'Відділ розрахунку вартості медичних послуг', 'Відділ стратегічного розвитку програми медичних гарантій',
  'Відділ клінічної та наукової експертизи', 'Відділ розвитку програми реімбурсації',
  'Відділ взаємодії з надавачами медичних послуг', 'Відділ роботи з електронними медичними даними',
  'Департамент стратегії універсального охоплення населення медичними послугами',
  'Юридичний департамент', 'Департамент інформаційних технологій', 'Департамент моніторингу',
  'Управління комунікацій', 'Управління справами'
];
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
  reminders: {},      // case_id → [{ id, due_date, body }] невиконані нагадування
  people: [],         // співробітники відділу для поля «Виконавець»
  leaders: [],        // керівництво департаменту для поля «Чиє зауваження»
  q: '',
  mine: false,
  f: 'all',           // фільтр: all / hot (строк ≤ 3 дн.) / overdue / remind (нагадування настали)
  view: 'board',      // board — дошка; list — список за строками; people — за виконавцями
  mobileStage: 'work',
  roomScope: 'dept',  // кімната (голос + чат): dept — мій відділ, all — увесь департамент
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
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* приватний режим */ } };
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
  // «Лише мої» за замовчуванням: виконавцям — так, керівництву й діловоду — ні
  const pr = state.profile;
  const overseer = LEADERSHIP.includes(pr.role) || pr.role === 'manager' || pr.is_head === true || pr.is_clerk === true;
  const saved = lsGet('spravy-mine');
  state.mine = saved !== null ? saved === '1' : !overseer;
  $('spMine').checked = state.mine;
  setupDeptPicker();
  await loadLeaders();
  await loadPeople();
  await loadCases();
  applyUrlParams();
  subscribe();
  // Голосова кімната (voice.js): заходимо одразу, мікрофон вимкнений. Текстовий канал під нею —
  // кімната відділу або головна стрічка «Робочого чату Департаменту» (room-chat.js).
  setupRoomScope();
  initVoice({ sb: state.sb, me: state.me, name: myName(), dept: roomTarget(), toast });
  initRoomChat({ sb: state.sb, me: state.me, name: myName(), dept: roomTarget(), toast });
}

/** «*» — увесь департамент; без відділу в профілі людина потрапляє туди ж. */
const roomTarget = () => (state.roomScope === 'all' || !DEPARTMENTS.includes(state.dept) ? '*' : state.dept);

/** Перемикач «Мій відділ | Департамент» над кімнатою; вибір пам'ятає браузер. */
function setupRoomScope() {
  const box = $('spScope');
  if (!box) return;
  // ?room=dept|all — пряме посилання саме на цю кімнату (закладка, посилання колезі)
  const want = new URLSearchParams(location.search).get('room');
  const saved = want === 'all' || want === 'dept' ? want : lsGet('spravy-room-scope');
  state.roomScope = saved === 'all' || !DEPARTMENTS.includes(state.dept) ? 'all' : 'dept';
  const paint = () => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === state.roomScope)));
  paint();
  box.hidden = false;
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scope]');
    if (!b || b.dataset.scope === state.roomScope) return;
    state.roomScope = b.dataset.scope;
    lsSet('spravy-room-scope', state.roomScope);
    paint();
    setVoiceDept(roomTarget());
    setRoomChatDept(roomTarget());
  });
}

/**
 * Посилання з головної, смуги «мої справи» й сповіщень:
 * ?mine=1 — лише мої; ?f=hot|overdue|remind — фільтр; ?case=<id> — відкрити справу;
 * ?new=1 — одразу форма нової справи (кнопка «Доручити справу»).
 */
function applyUrlParams() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('mine') === '1') { state.mine = true; $('spMine').checked = true; }
  if (['hot', 'overdue', 'remind'].includes(qs.get('f'))) { state.f = qs.get('f'); $('spFilter').value = state.f; }
  if (state.mine || state.f !== 'all') render();
  const id = qs.get('case');
  if (id && state.cases.some((c) => c.id === id)) openCase(id);
  if (qs.get('new') === '1') $('spAdd').click();
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
    mk({ in_no: '10001-08-26', in_date: d(-6), correspondent: 'Міністерство (демо)', subject: 'Погодження проєкту наказу про зміни до переліку обладнання — п\'ятиденний строк', deadline: d(-1), deadline_original: d(-1), stage: 'new', resolution: 'Керівник скл., відділ А, відділ Б', askod_state: 'До виконання', source: 'askod', our_role: 'lead', lead_unit: 'Департамент стратегії універсального охоплення населення медичними послугами' }),
    mk({ in_no: 'Д-1002-26', in_date: d(-3), correspondent: 'Громадянин (демо)', subject: 'Чи покриває програма медичних гарантій обстеження за направленням лікаря ПМД', deadline: d(2), stage: 'work', executor_name: 'Олена Приклад', version: 2, draft_path: '19_службові_записки\\letter_demo_v2.json', reply_kind: 'sz', nuances: 'Нових умов не вигадувати — лише специфікація пакета.' }),
    mk({ in_no: '10003-12-26', in_date: d(-10), correspondent: 'Обласна адміністрація (демо)', subject: 'Впровадження нових вагових коефіцієнтів з 01.01.2027', deadline: d(9), deadline_original: d(-2), stage: 'review', executor_name: 'Петро Зразок', version: 3, draft_url: 'https://docs.google.com/', nuances: 'Проєкт наступного року не тлумачимо.', our_role: 'lead', lead_unit: 'Департамент стратегії універсального охоплення населення медичними послугами' }),
    mk({ in_no: '10006-11-26', in_date: d(-5), correspondent: 'Слідчий орган (демо)', subject: 'Запит про надання відомостей щодо оплати послуг закладу', deadline: d(4), deadline_original: d(4), stage: 'sz_sent', executor_name: 'Олена Приклад', reply_kind: 'sz_work', our_role: 'co', lead_unit: 'Юридичний департамент', resolution: 'Юридичний департамент скл., наш департамент' }),
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
  const c6 = state.cases[3].id;
  const ago = (n) => new Date(Date.now() - 864e5 * n).toISOString();
  state.demoEvents[c3].push(
    { id: 'e5', case_id: c3, created_at: ago(1.5), author_name: 'Петро Зразок', kind: 'returned', body: 'Повернуто: Погодження → Готуємо — Директор департаменту: прибрати оцінки' },
    { id: 'e6', case_id: c3, created_at: ago(1.2), author_name: 'Петро Зразок', kind: 'deadline', body: `Строк: ${fmtDate(d(-2))} → ${fmtDate(d(9))} — лист кореспондента про продовження`, due_date: d(9) },
    { id: 'e7', case_id: c3, created_at: ago(0), author_name: 'Петро Зразок', kind: 'reminder', body: 'Нагадати керівнику про погодження v3', due_date: d(0), done: false }
  );
  state.demoEvents[c6] = [
    { id: 'f1', case_id: c6, created_at: ago(5), author_name: 'Claude', kind: 'system', body: 'Справу заведено з журналу АСКОД' },
    { id: 'f2', case_id: c6, created_at: ago(2), author_name: 'Олена Приклад', kind: 'outgoing', body: 'Дані щодо оплат закладу за 2025–2026', doc_kind: 'sz_work', doc_no: '3-19/60-26', addressee: 'Юридичний департамент', event_date: d(-2) },
    { id: 'f3', case_id: c6, created_at: ago(2), author_name: 'Олена Приклад', kind: 'stage', body: 'Готуємо → СЗ надано' },
    { id: 'f4', case_id: c6, created_at: ago(1), author_name: 'Олена Приклад', kind: 'reminder', body: 'Перевірити, чи головний виконавець відправив відповідь', due_date: d(3), done: false }
  ];
  state.remarkCounts = { [c3]: 1 };
  Object.keys(state.demoEvents).forEach(recountDemo);
  $('spDeptName').textContent = 'Демо-режим: картки вигадані, нічого не зберігається в базі';
  render();
  applyUrlParams();
  initVoice({ demo: true, name: myName() });
  initRoomChat({ demo: true, name: myName() });
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
    setVoiceDept(roomTarget());
    setRoomChatDept(roomTarget());
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
  await loadCounts();
  render();
  if (state.openId) openCase(state.openId, true);
}

/** Незакриті зауваження й невиконані нагадування — для бейджів на дошці. */
async function loadCounts() {
  state.remarkCounts = {};
  state.reminders = {};
  const ids = state.cases.filter((c) => c.stage !== 'done').map((c) => c.id);
  if (!ids.length) return;
  const { data } = await state.sb.from('dept_case_events').select('id, case_id, kind, remark_status, due_date, done, body')
    .in('kind', ['remark', 'reminder']).in('case_id', ids);
  (data || []).forEach((r) => {
    if (r.kind === 'remark' && r.remark_status === 'open') state.remarkCounts[r.case_id] = (state.remarkCounts[r.case_id] || 0) + 1;
    if (r.kind === 'reminder' && !r.done && r.due_date) (state.reminders[r.case_id] ||= []).push(r);
  });
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
    c.change_note = null;
    render();
    if (state.openId === id) { renderDrawerHead(c); loadEvents(id); }
    return true;
  }
  const { error } = await state.sb.from('dept_cases').update({ ...patch, updated_by_name: myName() }).eq('id', id);
  c.change_note = null;
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
  const ev = (kind, body, extra) => (state.demoEvents[c.id] ||= []).push({ id: crypto.randomUUID(), case_id: c.id, created_at: new Date().toISOString(), author_name: myName(), kind, body, ...extra });
  const tail = c.change_note ? ` — ${c.change_note}` : '';
  const rank = (k) => STAGES.findIndex((s) => s.key === k);
  if (c.deadline !== prev.deadline) {
    if (!c.deadline_original) c.deadline_original = prev.deadline || c.deadline;
    ev('deadline', `Строк: ${fmtDate(prev.deadline) || '—'} → ${fmtDate(c.deadline) || '—'}${tail}`, { due_date: c.deadline });
  }
  if (c.stage !== prev.stage) {
    const back = rank(c.stage) < rank(prev.stage) && prev.stage !== 'new';
    ev(back ? 'returned' : 'stage', `${back ? 'Повернуто: ' : ''}${STAGE_LABEL[prev.stage]} → ${STAGE_LABEL[c.stage]}${tail}`);
  }
  if (c.lead_unit !== prev.lead_unit || c.our_role !== prev.our_role) ev('system', `Головний виконавець: ${c.lead_unit || '—'}${c.our_role ? ` (${ROLE_LABEL[c.our_role].toLowerCase()})` : ''}`);
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
  await loadCounts();
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
  await loadCounts();
  render();
}

function recountDemo(caseId) {
  const evs = state.demoEvents[caseId] || [];
  state.remarkCounts[caseId] = evs.filter((e) => e.kind === 'remark' && e.remark_status === 'open').length;
  state.reminders[caseId] = evs.filter((e) => e.kind === 'reminder' && !e.done && e.due_date);
}

async function loadEvents(caseId) {
  if (DEMO) { state.events = state.demoEvents[caseId] || []; renderEvents(); return; }
  const { data } = await state.sb.from('dept_case_events').select('*').eq('case_id', caseId).order('created_at');
  state.events = data || [];
  renderEvents();
}

/* ───────────────────────── дошка ───────────────────────── */

/** Моя справа: за id виконавця, а для справ без id — за ПІБ. */
function isMine(c) {
  if (c.executor_id && state.me) return c.executor_id === state.me.id;
  return !!c.executor_name && c.executor_name === myName();
}

function passesFilter(c) {
  if (state.f === 'all') return true;
  if (c.stage === 'done') return false;
  const n = daysLeft(c.deadline);
  if (state.f === 'hot') return n !== null && n >= 0 && n <= 3 && c.stage !== 'sz_sent';
  if (state.f === 'overdue') return n !== null && n < 0 && c.stage !== 'sz_sent';
  if (state.f === 'remind') return (state.reminders[c.id] || []).some((r) => daysLeft(r.due_date) <= 0);
  return true;
}

function visibleCases() {
  const q = state.q.trim().toLowerCase();
  return state.cases.filter((c) => {
    if (state.mine && !isMine(c)) return false;
    if (!passesFilter(c)) return false;
    if (!q) return true;
    return [c.in_no, c.subject, c.correspondent, c.executor_name, c.resolution, c.out_no, c.nuances, c.lead_unit]
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
  board.classList.toggle('is-list', state.view !== 'board');
  $('spStageTabs').hidden = state.view !== 'board';
  document.querySelectorAll('#spView [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  if (state.view === 'list') { board.innerHTML = listHTML(list); renderReminderStrip(); return; }
  if (state.view === 'people') { board.innerHTML = peopleHTML(list); renderReminderStrip(); return; }
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
  renderReminderStrip();
}

/* ── Вигляд «Список»: усе одним списком, найгарячіше зверху ── */

/** Порядок за строком: прострочене й найближче зверху, без строку — внизу, закрите — в кінці. */
function byDeadline(a, b) {
  const done = (c) => (c.stage === 'done' ? 1 : 0);
  return (done(a) - done(b)) || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'));
}

function rowHTML(c, withExecutor = true) {
  const dl = deadlineInfo(c);
  const rem = state.remarkCounts[c.id] || 0;
  const bell = nextReminder(c.id);
  return `<li class="sp-row sp-row-${c.stage}" data-id="${c.id}" tabindex="0" role="button">
    <span class="sp-row-dl">${dl ? `<span class="sp-dl ${dl.cls}">${esc(dl.text)}</span>` : '<span class="sp-muted">без строку</span>'}</span>
    <span class="sp-row-no">${esc(c.in_no || 'без вх. №')}</span>
    <span class="sp-row-subj">${esc(c.subject)}${c.correspondent ? `<i>${esc(c.correspondent)}</i>` : ''}</span>
    ${withExecutor ? `<span class="sp-row-ex">${esc(c.executor_name || '—')}</span>` : ''}
    <span class="sp-row-stage"><b class="sp-stage-dot"></b>${STAGE_LABEL[c.stage]}${c.version ? ` · v${c.version}` : ''}${rem ? ` <span class="sp-rem-mini">⚑ ${rem}</span>` : ''}${bell ? ' 🔔' : ''}</span>
  </li>`;
}

function listHTML(list) {
  const rows = list.slice().sort(byDeadline);
  const shown = rows.filter((c) => c.stage !== 'done').concat(rows.filter((c) => c.stage === 'done').slice(0, 30));
  return rows.length ? `<ul class="sp-list">${shown.map((c) => rowHTML(c)).join('')}</ul>`
    : '<div class="sp-notice">Справ за цим фільтром немає.</div>';
}

/* ── Вигляд «За виконавцями»: хто що тримає ── */
function peopleHTML(list) {
  const groups = new Map();
  list.filter((c) => c.stage !== 'done').forEach((c) => {
    const k = c.executor_name || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });
  if (!groups.size) return '<div class="sp-notice">Відкритих справ немає.</div>';
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'uk')));
  return keys.map((k) => {
    const items = groups.get(k).sort(byDeadline);
    const over = items.filter((c) => { const n = daysLeft(c.deadline); return n !== null && n < 0 && c.stage !== 'sz_sent'; }).length;
    const hot = items.filter((c) => { const n = daysLeft(c.deadline); return n !== null && n >= 0 && n <= 3 && c.stage !== 'sz_sent'; }).length;
    return `<section class="sp-person">
      <header class="sp-person-head">
        <span class="sp-ava${k ? '' : ' is-none'}">${k ? esc(initials(k)) : '?'}</span>
        <b>${esc(k || 'Без виконавця')}</b>
        <span class="sp-person-stats">${items.length} у роботі${hot ? ` · <span class="sp-dl is-hot">горить ${hot}</span>` : ''}${over ? ` · <span class="sp-dl is-over">прострочено ${over}</span>` : ''}</span>
      </header>
      <ul class="sp-list">${items.map((c) => rowHTML(c, false)).join('')}</ul>
    </section>`;
  }).join('');
}

/** Найближче невиконане нагадування справи. */
function nextReminder(id) {
  const list = (state.reminders[id] || []).slice().sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return list[0] || null;
}

/** Смуга «Нагадування»: усе, чий день настав або минув. */
function renderReminderStrip() {
  const due = [];
  Object.entries(state.reminders).forEach(([id, list]) => list.forEach((r) => {
    if (daysLeft(r.due_date) <= 0) {
      const c = state.cases.find((x) => x.id === id);
      if (c && c.stage !== 'done') due.push({ c, r });
    }
  }));
  due.sort((a, b) => String(a.r.due_date).localeCompare(String(b.r.due_date)));
  const box = $('spReminders');
  box.hidden = !due.length;
  box.innerHTML = due.length ? '<b>🔔 Нагадування</b>' + due.map(({ c, r }) =>
    `<button type="button" class="sp-remind" data-open="${c.id}"><span>${fmtDate(r.due_date)}</span> ${esc(c.in_no || 'без вх. №')}: ${esc(r.body)}</button>`).join('') : '';
}

/**
 * Наступний етап для кнопки «далі →». Співвиконавці після «Готуємо» передають
 * СЗ головному, а не несуть лист на підпис.
 */
function nextStage(c) {
  const co = c.our_role === 'co';
  return {
    new: 'work',
    work: co ? 'sz_sent' : 'review',
    review: co ? 'sz_sent' : 'signing',
    signing: 'done',
    sz_sent: 'done'
  }[c.stage] || null;
}

function cardHTML(c) {
  const dl = deadlineInfo(c);
  const next = nextStage(c);
  const remarks = state.remarkCounts[c.id] || 0;
  const rem = nextReminder(c.id);
  const prolonged = c.deadline && c.deadline_original && c.deadline !== c.deadline_original;
  const badges = [
    c.our_role ? `<span class="sp-role sp-role-${c.our_role}" title="${esc(ROLE_LABEL[c.our_role] + (c.lead_unit ? ' · головний: ' + c.lead_unit : ''))}">${ROLE_SHORT[c.our_role]}</span>` : '',
    `<span class="sp-kind">${KIND_SHORT[c.reply_kind] || ''}</span>`,
    c.version ? `<span class="sp-ver" title="Поточна версія чернетки">v${c.version}</span>` : '',
    c.review_passed ? '<span class="sp-ok" title="Рецензію пройдено">✓ рецензія</span>' : '',
    remarks ? `<span class="sp-rem" title="Незакриті зауваження">⚑ ${remarks}</span>` : '',
    rem ? `<span class="sp-bell${daysLeft(rem.due_date) <= 0 ? ' is-due' : ''}" title="${esc('Нагадування: ' + rem.body)}">🔔 ${fmtDate(rem.due_date).slice(0, 5)}</span>` : '',
    c.source === 'claude' ? '<span class="sp-src" title="Справу завів Claude">Claude</span>' : ''
  ].join('');
  return `<article class="sp-card" draggable="true" data-id="${c.id}" tabindex="0" role="button" aria-label="${esc((c.in_no || 'Без вх. №') + ': ' + c.subject)}">
    <div class="sp-card-top">
      <span class="sp-inno">${esc(c.in_no || 'без вх. №')}</span>
      ${dl ? `<span class="sp-dl ${dl.cls}"${prolonged ? ` title="Продовжено; первинний строк ${fmtDate(c.deadline_original)}"` : ''}>${prolonged ? '↻ ' : ''}${esc(dl.text)}</span>` : ''}
    </div>
    <div class="sp-subj">${esc(c.subject)}</div>
    ${c.correspondent ? `<div class="sp-corr">${esc(c.correspondent)}</div>` : ''}
    <div class="sp-card-foot">
      <div class="sp-badges">${badges}</div>
      ${c.executor_name ? `<span class="sp-ava" title="${esc(c.executor_name)}">${esc(initials(c.executor_name))}</span>` : '<span class="sp-ava is-none" title="Виконавця не призначено">?</span>'}
    </div>
    ${c.out_no ? `<div class="sp-out">вих. № ${esc(c.out_no)}${c.out_date ? ' від ' + fmtDate(c.out_date) : ''}</div>` : ''}
    ${next ? `<button type="button" class="sp-next" data-next="${c.id}" title="Перевести в «${STAGE_LABEL[next]}»">${STAGE_LABEL[next]} →</button>` : ''}
  </article>`;
}

function renderStats() {
  const active = state.cases.filter((c) => c.stage !== 'done');
  const over = active.filter((c) => { const n = daysLeft(c.deadline); return n !== null && n < 0; }).length;
  const hot = active.filter((c) => { const n = daysLeft(c.deadline); return n !== null && n >= 0 && n <= 3; }).length;
  const rem = Object.values(state.remarkCounts).reduce((a, b) => a + b, 0);
  const dueRem = Object.values(state.reminders).flat().filter((r) => daysLeft(r.due_date) <= 0).length;
  $('statReminders').textContent = dueRem;
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
  const prolonged = c.deadline && c.deadline_original && c.deadline !== c.deadline_original;
  return `
  <div class="sp-lead">
    <label class="sp-f sp-lead-unit"><span>Головний виконавець (департамент / управління / відділ)</span>
      <input data-f="lead_unit" list="spLeadUnits" value="${esc(c.lead_unit)}" placeholder="Хто відповідає за документ у цілому"></label>
    <label class="sp-f"><span>Наша роль</span><select data-f="our_role">${opt('', c.our_role, '— не визначено —')}${Object.entries(ROLE_LABEL).map(([k, v]) => opt(k, c.our_role, v)).join('')}</select></label>
  </div>
  <datalist id="spLeadUnits">${LEAD_UNITS.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
  <div class="sp-grid">
    <label class="sp-f"><span>Вх. №</span><input data-f="in_no" value="${esc(c.in_no)}" placeholder="10001-08-26"></label>
    <label class="sp-f"><span>Строк${prolonged ? ` <i class="sp-orig">первинний ${fmtDate(c.deadline_original)}</i>` : ''}</span><input type="date" data-f="deadline" value="${esc(c.deadline)}"></label>
    <label class="sp-f sp-wide"><span>Суть</span><textarea data-f="subject" rows="2">${esc(c.subject)}</textarea></label>
    <label class="sp-f sp-wide"><span>Кореспондент</span><input data-f="correspondent" value="${esc(c.correspondent)}"></label>
    <label class="sp-f"><span>Тип відповіді</span><select data-f="reply_kind">${Object.entries(KIND_LABEL).map(([k, v]) => opt(k, c.reply_kind, v)).join('')}</select></label>
    <label class="sp-f sp-wide"><span>Резолюція (хто скл., співвиконавці)</span><input data-f="resolution" value="${esc(c.resolution)}" placeholder="Прізвище скл., Прізвище, Прізвище"></label>
    <label class="sp-f"><span>Виконавець у відділі</span><select data-f="executor_name">${opt('', c.executor_name, '— не призначено —')}${people.map((p) => opt(p, c.executor_name)).join('')}</select></label>
    <label class="sp-f"><span>Версія чернетки</span><input type="number" min="1" data-f="version" value="${esc(c.version)}" placeholder="1"></label>
    <label class="sp-f sp-check"><input type="checkbox" data-f="review_passed"${c.review_passed ? ' checked' : ''}><span>Рецензію пройдено</span></label>
    <label class="sp-f sp-wide"><span>Посилання (Google Doc із зауваженнями, OneDrive)</span>
      <span class="sp-linkrow"><input data-f="draft_url" value="${esc(c.draft_url)}" placeholder="https://docs.google.com/…">${/^https?:\/\//.test(c.draft_url || '') ? `<a class="sp-btn sp-btn-ghost" href="${esc(c.draft_url)}" target="_blank" rel="noopener">Відкрити</a>` : ''}</span></label>
    <label class="sp-f sp-wide"><span>Нюанси — на що зважати</span><textarea data-f="nuances" rows="3" placeholder="Що не можна писати, з чим звірити, хто вже відповідав">${esc(c.nuances)}</textarea></label>
  </div>
  <details class="sp-more"${lsGet('spravy-more') === '1' ? ' open' : ''}>
    <summary>Більше полів: реквізити, файл, вих. №</summary>
    <div class="sp-grid">
      <label class="sp-f"><span>Дата реєстрації</span><input type="date" data-f="in_date" value="${esc(c.in_date)}"></label>
      <label class="sp-f"><span>Його вих. №</span><input data-f="corr_out_no" value="${esc(c.corr_out_no)}"></label>
      <label class="sp-f"><span>від</span><input type="date" data-f="corr_out_date" value="${esc(c.corr_out_date)}"></label>
      <label class="sp-f sp-wide"><span>Файл в обміннику</span><input data-f="draft_path" value="${esc(c.draft_path)}" placeholder="10_НА_ПІДПИС\\02.11.26\\lyst_…_v2.docx"></label>
      <label class="sp-f"><span>Вих. № НСЗУ</span><input data-f="out_no" value="${esc(c.out_no)}"></label>
      <label class="sp-f"><span>Дата відправлення</span><input type="date" data-f="out_date" value="${esc(c.out_date)}"></label>
      ${c.askod_state ? `<div class="sp-f sp-ro"><span>Стан резолюції в АСКОД</span><b>${esc(c.askod_state)}</b></div>` : ''}
    </div>
  </details>`;
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
  // Справу з журналу АСКОД не видаляємо: синхронізація завела б її знову, поки
  // резолюція відкрита. Замість цього — «Закрити як не наше» (етап «Закрито» з причиною).
  const fromAskod = c.source === 'askod';
  $('spDelete').hidden = fromAskod || !canDelete();
  $('spNotOurs').hidden = !fromAskod || c.stage === 'done';
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
  // Повна історія: усе разом, включно із зауваженнями; найсвіжіше зверху.
  // Дата події (event_date) — коли документ справді датовано, інакше — коли внесли.
  const when = (e) => (datedApart(e) ? e.event_date + 'T12:00:00' : e.created_at);
  const feed = state.events.slice().sort((a, b) => String(when(b)).localeCompare(String(when(a))));
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
  $('spFeed').innerHTML = feed.length ? feed.map(historyHTML).join('') : '<li class="sp-muted sp-none">Подій ще немає.</li>';
}

/** Подія датована іншим днем, ніж її внесли (СЗ від 28.10, внесена 02.11). */
const datedApart = (e) => e.event_date && e.event_date !== String(e.created_at).slice(0, 10);

function historyHTML(e) {
  const date = datedApart(e) ? fmtDate(e.event_date) : fmtStamp(e.created_at);
  let what = esc(e.body);
  if (e.kind === 'remark') what = `<b>${esc(e.remark_from || 'Зауваження')}:</b> ${what} <i class="sp-muted">(${REMARK_STATUS[e.remark_status || 'open'].toLowerCase()})</i>`;
  if (e.kind === 'outgoing') {
    const head = [DOC_KIND[e.doc_kind] || 'Документ', e.doc_no ? '№ ' + e.doc_no : '', e.addressee ? '→ ' + e.addressee : ''].filter(Boolean).join(' ');
    what = `<b>${esc(head)}</b>${e.body ? ' — ' + what : ''}`;
  }
  if (e.kind === 'reminder') {
    what = `<label class="sp-rem-check"><input type="checkbox" data-remind="${e.id}"${e.done ? ' checked' : ''}>
      <span><b>${fmtDate(e.due_date)}</b> — ${what}</span></label>`;
  }
  return `<li class="sp-ev sp-ev-${e.kind}${e.kind === 'reminder' && e.done ? ' is-done' : ''}">
      <span class="sp-ev-ico" aria-hidden="true">${EV_ICON[e.kind] || '•'}</span>
      <span class="sp-ev-when">${date}</span>
      <span class="sp-ev-who">${esc(e.author_name || '—')}</span>
      <span class="sp-ev-what">${what}</span>
    </li>`;
}

/* ───────────────────────── дії в картці справи ───────────────────────── */

const ACTIONS = {
  prolong: {
    title: 'Продовжити строк',
    fields: () => `
      <label class="sp-f"><span>Новий строк *</span><input type="date" name="deadline" required></label>
      <label class="sp-f sp-wide"><span>Підстава</span><input name="note" placeholder="лист кореспондента / резолюція від … № …"></label>`,
    run: (id, fd) => saveCase(id, { deadline: fd.get('deadline'), change_note: 'продовжено' + (fd.get('note') ? ': ' + fd.get('note') : '') })
  },
  returned: {
    title: 'Повернуто на доопрацювання',
    fields: () => `
      <label class="sp-f"><span>Хто повернув</span><select name="from">${[...state.leaders, ...REMARK_ROLES].map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
      <label class="sp-f"><span>Дата</span><input type="date" name="date" value="${todayISO()}"></label>
      <label class="sp-f sp-wide"><span>Що сказали *</span><textarea name="note" rows="3" required placeholder="Суть зауваження — воно ж піде в «Зауваження» як невраховане"></textarea></label>`,
    run: async (id, fd) => {
      const from = fd.get('from'), note = fd.get('note').trim();
      const ok = await saveCase(id, { stage: 'work', change_note: `${from}: ${note}` });
      if (ok) await addEvent(id, { kind: 'remark', body: note, remark_from: from, remark_status: 'open', event_date: fd.get('date') || null });
    }
  },
  outgoing: {
    title: 'Відправлено документ',
    fields: (c) => `
      <label class="sp-f"><span>Що відправлено</span><select name="doc_kind">${Object.entries(DOC_KIND).map(([k, v]) => `<option value="${k}"${k === (c.our_role === 'co' ? 'sz_work' : 'letter') ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="sp-f"><span>№</span><input name="doc_no" placeholder="вих. № або № СЗ"></label>
      <label class="sp-f"><span>Дата</span><input type="date" name="date" value="${todayISO()}"></label>
      <label class="sp-f"><span>Кому</span><input name="addressee" list="spLeadUnits" placeholder="адресат"></label>
      <label class="sp-f sp-wide"><span>Коротко про зміст</span><input name="note"></label>
      <label class="sp-f sp-check sp-wide"><input type="checkbox" name="move" checked><span>Перевести справу в «СЗ надано» (для СЗ у робочому порядку) або «Закрито»</span></label>`,
    run: async (id, fd) => {
      const kind = fd.get('doc_kind');
      const no = fd.get('doc_no').trim();
      await addEvent(id, { kind: 'outgoing', body: fd.get('note').trim() || '', doc_kind: kind, doc_no: no || null,
        addressee: fd.get('addressee').trim() || null, event_date: fd.get('date') || null });
      if (fd.get('move')) {
        const patch = { stage: kind === 'sz_work' ? 'sz_sent' : 'done' };
        if (kind === 'letter' && no) Object.assign(patch, { out_no: no, out_date: fd.get('date') || null });
        await saveCase(id, patch);
      }
      state.followUp = 'skod';       // одразу запропонувати зарахувати роботу в СКО-Д
    }
  },
  skod: {
    title: 'Зарахувати в СКО-Д',
    fields: (c) => `
      <p class="sp-f sp-wide sp-muted">Запис обліку роботи (особистий кабінет → «Робота в АСКОД»). Номер, суть і вих. № — зі справи.</p>
      <label class="sp-f"><span>Дата роботи *</span><input type="date" name="date" value="${todayISO()}" max="${todayISO()}" required></label>
      <label class="sp-f"><span>Скільки часу *</span><select name="minutes">${[30, 60, 90, 120, 180, 240, 360, 480].map((m) => `<option value="${m}"${m === 120 ? ' selected' : ''}>${m < 60 ? m + ' хв' : (m / 60) + ' год'}</option>`).join('')}</select></label>
      <label class="sp-f"><span>Складність</span><select name="severity">
        <option value="easy">Легка (1,0)</option><option value="medium" selected>Середня (1,3)</option>
        <option value="hard">Складна (1,8)</option><option value="expert">Експертна (2,5)</option></select></label>
      <label class="sp-f"><span>Тип документа</span><select name="type">${SKOD_TYPES.map((t) => `<option${t === (c.reply_kind === 'pi' ? '47 — Лист-запит' : '01 — Лист') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="sp-f sp-wide"><span>Справа номенклатури</span><select name="category">${SKOD_CATEGORIES.map((t) => `<option${t === guessCategory(c) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="sp-f sp-wide"><span>Що зроблено *</span><textarea name="desc" rows="3" required>${esc(skodDescription(c))}</textarea></label>`,
    run: async (id, fd) => {
      const c = state.cases.find((x) => x.id === id);
      const minutes = parseInt(fd.get('minutes'), 10);
      const sev = fd.get('severity');
      const row = {
        user_name: myName(),
        department: state.profile?.Section || state.dept,
        log_date: fd.get('date'),
        start_time: '09:00:00',
        duration_minutes: minutes,
        branch: 'askod',
        task_type: fd.get('type'),
        category: fd.get('category'),
        severity_level: sev,
        complexity_coefficient: SKOD_COEF[sev],
        score: parseFloat(((minutes / 60) * SKOD_COEF[sev]).toFixed(2)),
        status: 'completed',
        description: fd.get('desc').trim(),
        askod_reg_number: c.in_no || null,
        reply_to_number: c.out_no || null,
        include_37d: false
      };
      if (!DEMO) {
        const { error } = await state.sb.from('skod_logs').insert([{ ...row, user_id: state.me.id }]);
        if (error) return toast('СКО-Д не збережено: ' + error.message, true);
      }
      await addEvent(id, { kind: 'system', body: `Зараховано в СКО-Д: ${minutes < 60 ? minutes + ' хв' : (minutes / 60) + ' год'}, ${row.category.split(' — ')[0]}` });
    }
  },
  notours: {
    title: 'Закрити як не наше',
    fields: () => `
      <p class="sp-f sp-wide sp-muted">Справа піде в «Закрито» з причиною в історії. Синхронізація з АСКОД її більше не відкриє:
        вона оновлює лише строк і резолюцію, а етап не чіпає.</p>
      <label class="sp-f sp-wide"><span>Чому</span><select name="why">
        <option>Не наше — головний виконавець інший підрозділ</option>
        <option>До відома — дій від нас не потрібно</option>
        <option>Виконано в іншій справі</option>
        <option>Помилково розписано на нас</option>
      </select></label>
      <label class="sp-f sp-wide"><span>Примітка</span><input name="note" placeholder="необовʼязково: кому передали, де відповідь"></label>`,
    run: (id, fd) => saveCase(id, { stage: 'done', change_note: 'знято: ' + fd.get('why') + (fd.get('note').trim() ? ' — ' + fd.get('note').trim() : '') })
  },
  reminder: {
    title: 'Нагадування',
    fields: () => `
      <label class="sp-f"><span>Коли нагадати *</span><input type="date" name="date" required></label>
      <label class="sp-f sp-wide"><span>Про що *</span><input name="note" required placeholder="перевірити, чи головний виконавець відправив відповідь"></label>`,
    run: (id, fd) => addEvent(id, { kind: 'reminder', body: fd.get('note').trim(), due_date: fd.get('date'), done: false })
  }
};

function skodDescription(c) {
  const out = state.events.filter((e) => e.kind === 'outgoing').slice(-1)[0];
  const done = out ? ` — ${(DOC_KIND[out.doc_kind] || 'документ').toLowerCase()}${out.doc_no ? ' № ' + out.doc_no : ''}${out.addressee ? ' → ' + out.addressee : ''}`
    : (c.out_no ? ` — лист вих. № ${c.out_no}` : '');
  return `${c.in_no ? 'Вх. № ' + c.in_no + ': ' : ''}${c.subject}${done}`;
}

function openAction(name) {
  const c = state.cases.find((x) => x.id === state.openId);
  const a = ACTIONS[name];
  if (!c || !a) return;
  const dlg = $('spAct');
  dlg.dataset.action = name;
  $('spActTitle').textContent = a.title;
  $('spActFields').innerHTML = a.fields(c);
  dlg.showModal();
  dlg.querySelector('input, select, textarea')?.focus();
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
    our_role: fd.get('our_role') || null,
    lead_unit: (fd.get('lead_unit') || '').trim() || null,
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
  $('spMine').addEventListener('change', (e) => { state.mine = e.target.checked; lsSet('spravy-mine', state.mine ? '1' : '0'); render(); });
  $('spFilter').addEventListener('change', (e) => { state.f = e.target.value; render(); });
  if (['board', 'list', 'people'].includes(lsGet('spravy-view'))) state.view = lsGet('spravy-view');
  $('spView').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    lsSet('spravy-view', state.view);
    render();
  });

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
    const nx = e.target.closest('[data-next]');
    if (nx) {
      // «далі →»: справу без виконавця беру на себе
      const c = state.cases.find((x) => x.id === nx.dataset.next);
      const to = c && nextStage(c);
      if (!to) return;
      const patch = { stage: to };
      if (to === 'work' && !c.executor_name) {
        patch.executor_name = myName();
        if (!DEMO && state.me) patch.executor_id = state.me.id;
      }
      saveCase(c.id, patch).then((ok) => ok !== false && toast(`${c.in_no || 'Справа'} → ${STAGE_LABEL[to]}`));
      return;
    }
    const card = e.target.closest('.sp-card, .sp-row');
    if (card) openCase(card.dataset.id);
  });
  board.addEventListener('keydown', (e) => {
    const card = e.target.closest('.sp-card, .sp-row');
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
  $('spFields').addEventListener('toggle', (e) => {
    if (e.target.classList?.contains('sp-more')) lsSet('spravy-more', e.target.open ? '1' : '0');
  }, true);
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
  $('spNotOurs').addEventListener('click', () => openAction('notours'));
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

  // Дії: продовжити строк, повернуто, відправлено документ, нагадування
  $('spActions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) openAction(b.dataset.act);
  });
  $('spActCancel').addEventListener('click', () => $('spAct').close());
  $('spActForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = ACTIONS[$('spAct').dataset.action];
    if (!a || !state.openId) return;
    const fd = new FormData(e.target);
    $('spAct').close();
    await a.run(state.openId, fd);
    openCase(state.openId, true);       // поля картки (строк, етап, вих. №) — свіжі
    toast('Записано в історію справи');
    if (state.followUp) { const next = state.followUp; state.followUp = null; setTimeout(() => openAction(next), 250); }
  });
  // Нагадування: позначити виконаним прямо в історії
  $('spFeed').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-remind]');
    if (cb && state.openId) updateEvent(state.openId, cb.dataset.remind, { done: cb.checked });
  });
  // Смуга нагадувань над дошкою відкриває справу
  $('spReminders').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (b) openCase(b.dataset.open);
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
