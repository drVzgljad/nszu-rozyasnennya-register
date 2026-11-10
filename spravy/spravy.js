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
import { initVoice, setVoiceDept } from './voice.js?v=20261110c';
import { initRoomChat, setRoomChatDept } from './room-chat.js?v=20261104a';
// Свій журнал АСКОД (xlsx) — кнопка «📥 Журнал АСКОД»; розбір — ../pmg-askod-journal.js
import { initAskodUpload } from './askod-upload.js?v=20261103a';
// Контролька департаменту (xlsx) — кнопка «🎯 Контролька»: позначка «На контролі» (migration_2026-11-09_case_control.sql)
import { initControlUpload } from './control-upload.js?v=20261109a';

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

/*
 * Види справ (migration_2026-11-03f_case_kinds.sql): не лише документи АСКОД.
 * Етапи в базі ті самі; завдання, захід і напрям ходять лише new → work → review → done
 * і мають свої назви етапів (у базі — dept_cases_stage_label(p, k), тут — KIND_STAGES).
 */
const CASE_KINDS = {
  askod:   { icon: '📨', label: 'Документ АСКОД',  short: 'АСКОД' },
  task:    { icon: '✅', label: 'Завдання',        short: 'Завдання' },
  event:   { icon: '📅', label: 'Захід',           short: 'Захід' },
  project: { icon: '🧭', label: 'Напрям / проєкт', short: 'Напрям' }
};
const KIND_STAGES = {
  task:    [{ key: 'new', label: 'Нове', hint: 'доручили, ще не взялися' }, { key: 'work', label: 'В роботі', hint: 'виконавець працює' },
            { key: 'review', label: 'На перевірці', hint: 'віддали керівнику' }, { key: 'done', label: 'Готово', hint: 'результат прийнято' }],
  event:   [{ key: 'new', label: 'Заплановано', hint: 'дата відома' }, { key: 'work', label: 'Підготовка', hint: 'тези, матеріали' },
            { key: 'review', label: 'Відбувся', hint: 'внести підсумки' }, { key: 'done', label: 'Підсумки внесено', hint: 'що домовились' }],
  project: [{ key: 'new', label: 'Задумано', hint: 'ідея, ще не почали' }, { key: 'work', label: 'В роботі', hint: 'віхи, пов\'язані справи' },
            { key: 'review', label: 'На погодженні', hint: 'у керівництва' }, { key: 'done', label: 'Завершено', hint: 'результат є' }]
};
const kindOf = (c) => c?.case_kind || (c?.in_no ? 'askod' : 'task');
/**
 * Вхідна службова записка іншого підрозділу НСЗУ (з 09.11.2026 — окрема смуга дошки й фільтр).
 * Користувач: «зроби окремо вхідні службові, а то нескінченна полоса губить їх». Ознака — кореспондент
 * «Службова записка» з журналу АСКОД або внутрішній індекс «15-15/143-26», «7.1.1-01/441-26».
 */
const isSzIn = (c) => kindOf(c) === 'askod' &&
  (/службов/i.test(c.correspondent || '') || /^\d[\d.]*-\d+\/\d+-\d{2}$/.test((c.in_no || '').trim()));
// Напрями (етап 2): будь-яка справа може належати напряму (parent_id), у напряму — віхи
const projectsOf = (exceptId) => state.cases.filter((x) => kindOf(x) === 'project' && x.id !== exceptId);
const childrenOf = (id) => state.cases.filter((x) => x.parent_id === id);
const milestonesOf = (c) => (Array.isArray(c?.milestones) ? c.milestones : []);
const nextMilestone = (c) => milestonesOf(c).filter((m) => !m.done && m.due).sort((a, b) => a.due.localeCompare(b.due))[0];
const stagesOf = (kind) => KIND_STAGES[kind] || STAGES;
const stageLabel = (c, key) => (KIND_STAGES[kindOf(c)]?.find((s) => s.key === key)?.label) || STAGE_LABEL[key];
/** Захід: «05.11, 14:00» з event_at */
const fmtEventAt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** ISO → значення для <input type="datetime-local"> у місцевому часі */
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const KIND_LABEL = { letter: 'Лист', sz: 'СЗ', sz_work: 'СЗ (робочий порядок)', pi: 'ПІ', info: 'До відома', other: 'Інше' };
const KIND_SHORT = { letter: 'Лист', sz: 'СЗ', sz_work: 'СЗ роб.', pi: 'ПІ', info: 'До відома', other: 'Інше' };
// answer — вхідна СЗ є відповіддю на нашу записку (вимога користувача 10.11.2026; міграція 10_case_role_answer)
const ROLE_LABEL = { lead: 'Ми — головний виконавець', co: 'Ми — співвиконавці', info: 'Нам — до відома', answer: 'СЗ-відповідь на нашу записку' };
const ROLE_SHORT = { lead: 'Гол.', co: 'Співвик.', info: 'До відома', answer: '↩ СЗ-відповідь' };
const DOC_KIND = { letter: 'Лист', sz: 'Службова записка', sz_work: 'СЗ у робочому порядку', other: 'Інший документ' };
// Зв'язки справ (migration_2026-11-09b_case_links.sql): документ туди (out — чекаємо) чи назад (in — врахувати)
const LINK_DOC = { sz: 'Службова записка', sz_work: 'СЗ у робочому порядку', letter: 'Лист', project: 'Проєкт на погодження (АСКОД)', other: 'Інший документ' };
const LINK_SHORT = { sz: 'СЗ', sz_work: 'СЗ роб.', letter: 'Лист', project: 'Проєкт', other: 'Документ' };
const LINK_STATUS = {
  out: { waiting: '⏳ Чекаємо відповіді', answered: '✓ Відповідь є', closed: 'Знято' },
  in:  { waiting: '📥 Треба врахувати', answered: '✓ Враховано', closed: 'Знято' }
};
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
  'Аналітичне управління',
  'Юридичний департамент', 'Департамент інформаційних технологій', 'Департамент моніторингу',
  'Управління комунікацій', 'Управління справами',
  'Відділ роботи зі скаргами пацієнтів'
];
// Чиє зауваження: керівництво департаменту підтягується з profiles (під RLS) —
// прізвищ у публічному репозиторії бути не повинно.
const REMARK_ROLES = ['Голова', 'Заступник Голови', 'Керівник відділу', 'Рецензент', 'Інше']; // «Хто повернув» / «Чиє зауваження»: після керівництва департаменту
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
  linkWait: {},       // case_id → { out: n, in: n } — відкриті зв'язки: ⏳ чекаємо / 📥 врахувати
  links: [],          // зв'язки відкритої справи (з погляду цієї справи, див. viewLink)
  peers: [],          // та сама справа (вх. №) в інших відділах — dept_case_peers()
  noLinks: false,     // таблиці зв'язків ще немає (міграцію 09b не застосовано)
  demoLinks: [],
  people: [],         // співробітники відділу для поля «Виконавець»
  leaders: [],        // керівництво департаменту для поля «Чиє зауваження»
  q: '',
  mine: false,
  f: 'all',           // фільтр: all / hot (строк ≤ 3 дн.) / overdue / remind (нагадування настали) / control / waiting / incoming
  kind: 'all',        // вид справ: all / askod / task / event / project
  view: 'board',      // board — дошка; list — список за строками; people — за виконавцями
  mobileStage: 'work',
  // (roomScope прибрано 04.11.2026: у «Справах» лише кімната відділу, див. roomTarget)
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
/**
 * Строк продовжено (кореспондент, керівник, АСКОД): { orig, now, days, tip } або null.
 * Первинний строк живе в deadline_original — його ставить перше ж зрушення строку.
 */
/**
 * «СЗ надано» рівнозначне «Закрито» (вимога користувача 10.11.2026): нашу частину зроблено, строк
 * не горить і не прострочується, у «у роботі» й навантаження виконавців справа не йде.
 * Колонка «СЗ надано» лишається — там видно, чию відповідь ми чекаємо (⏳).
 */
const isClosed = (c) => c.stage === 'done' || c.stage === 'sz_sent';

/**
 * «Врахувати в роботі» (вимога користувача 10.11.2026): службова, на яку відповідь не потрібна — резолюція
 * «До/Для врахування в роботі», «До відома», або ми в справі лише до відома. Позначка «📌 врахувати»,
 * фільтр і кнопка «📌 Враховано →» одразу в «Закрито».
 */
const isNoteCase = (c) => kindOf(c) === 'askod' &&
  (/врахуван|до відома/i.test(c.resolution || '') || c.reply_kind === 'info' || c.our_role === 'info' || c.our_role === 'answer');
/* ───────── Маршрут документа (вимога користувача 10.11.2026) ─────────
 * «Готуємо» — пишемо й чекаємо відповідей структур, куди робили запити; «Погодження» — виконавець погодив,
 * документ іде ланцюжком; «На підписі» — усі погодили, висить на підписанті (Голова / Заступник Голови /
 * Директор департаменту). Колонка dept_cases.route (migration_2026-11-10c_case_route.sql).
 */
const SIGNERS = ['Голова', 'Заступник Голови', 'Директор департаменту'];
const APPROVERS = ['Начальник відділу', 'Директор департаменту', 'Заступник директора департаменту', 'Заступник Голови', 'Юридичний департамент'];
const isSzReply = (c) => c.reply_kind === 'sz' || c.reply_kind === 'sz_work';
function defaultRoute(c) {
  return isSzReply(c)
    ? { exec: null, steps: [{ who: 'Начальник відділу', ok: null }], sign: { who: 'Директор департаменту', ok: null } }
    // Лист: Заступник Голови погоджує обов'язково (вимога користувача 10.11.2026)
    : { exec: null, steps: [{ who: 'Начальник відділу', ok: null }, { who: 'Директор департаменту', ok: null }, { who: 'Заступник Голови', ok: null }], sign: { who: 'Голова', ok: null } };
}
const routeOf = (c) => (c.route && Array.isArray(c.route.steps) && c.route.sign ? c.route : defaultRoute(c));
const hasRoute = (c) => kindOf(c) === 'askod' && !isNoteCase(c) && c.reply_kind !== 'info';
/** Етап за маршрутом: лише між «Готуємо», «Погодження» й «На підписі»; «СЗ надано» й «Закрито» не чіпаємо. */
function routeStage(c, r) {
  if (!['new', 'work', 'review', 'signing'].includes(c.stage)) return null;
  if (!r.exec) return c.stage === 'new' ? null : 'work';
  return r.steps.some((s) => !s.ok) ? 'review' : 'signing';
}
/** Міні-позначка на картці дошки: скільки ланок пройдено і хто підписує. */
function routeMiniHTML(c) {
  if (!hasRoute(c) || !c.route || !['review', 'signing'].includes(c.stage)) return '';
  const r = routeOf(c);
  const total = r.steps.length + 1;
  const done = r.steps.filter((s) => s.ok).length + (r.sign.ok ? 1 : 0);
  const wait = r.steps.find((s) => !s.ok)?.who || (r.sign.ok ? '' : r.sign.who);
  return `<span class="sp-rt-mini" title="${esc(`Маршрут: пройдено ${done} з ${total}${wait ? ' · зараз у: ' + wait : ''} · підписує: ${r.sign.who}`)}">🧭 ${done}/${total} → ${esc(r.sign.who)}</span>`;
}

const NOTE_TIP = (c) => 'Відповідь не потрібна — врахувати в роботі' + (c.resolution ? ' · резолюція: ' + c.resolution : '');

function prolongInfo(c) {
  if (!c.deadline || !c.deadline_original || c.deadline === c.deadline_original || isClosed(c)) return null;
  const days = Math.round((new Date(c.deadline + 'T00:00:00') - new Date(c.deadline_original + 'T00:00:00')) / 864e5);
  const sign = days > 0 ? '+' : '';
  return { orig: c.deadline_original, now: c.deadline, days,
    tip: `Строк ${days > 0 ? 'продовжено' : 'змінено'}: було ${fmtDate(c.deadline_original)} → стало ${fmtDate(c.deadline)} (${sign}${days} ${daysWord(Math.abs(days))})` };
}

function deadlineInfo(c) {
  const n = daysLeft(c.deadline);
  if (n === null) return null;
  const date = fmtDate(c.deadline);
  if (isClosed(c)) return { cls: 'is-closed', text: date };
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
  initAskodUpload({ sb: state.sb, me: state.me, name: myName(), dept: () => state.dept, toast, reload: loadCases });
  initControlUpload({ sb: state.sb, me: state.me, name: myName(), dept: () => state.dept, toast, reload: loadCases });
  // Голосова кімната (voice.js): заходимо одразу, мікрофон вимкнений. Текстовий канал під нею —
  // кімната відділу або головна стрічка «Робочого чату Департаменту» (room-chat.js).
  setupRoomScope();
  initVoice({ sb: state.sb, me: state.me, name: myName(), dept: roomTarget(), role: state.profile.role || '', depts: DEPARTMENTS, toast });
  initRoomChat({ sb: state.sb, me: state.me, name: myName(), dept: roomTarget(), toast });
}

/**
 * З 04.11.2026 у «Справах» лише кімната відділу. Кімната департаменту (voice:all і головна
 * стрічка) живе в «Чаті департаменту» — одні двері на кімнату, щоб не плутати.
 * Без відділу в профілі — '' (панель голосу й чату підкаже, куди йти).
 */
const roomTarget = () => (DEPARTMENTS.includes(state.dept) ? state.dept : '');

/** Над кімнатою — назва кімнати й посилання на кімнату департаменту в чаті. */
function setupRoomScope() {
  const box = $('spScope');
  if (box) box.hidden = false;
}

/**
 * Посилання з головної, смуги «мої справи» й сповіщень:
 * ?mine=1 — лише мої; ?f=hot|overdue|remind|control|waiting|incoming — фільтр; ?case=<id> — відкрити справу;
 * ?new=1 — одразу форма нової справи (кнопка «Доручити справу»).
 */
function applyUrlParams() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('mine') === '1') { state.mine = true; $('spMine').checked = true; }
  if (['hot', 'overdue', 'remind', 'control', 'waiting', 'incoming'].includes(qs.get('f'))) { state.f = qs.get('f'); $('spFilter').value = state.f; }
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
    mk({ in_no: '10001-08-26', in_date: d(-6), correspondent: 'Міністерство (демо)', subject: 'Погодження проєкту наказу про зміни до переліку обладнання — п\'ятиденний строк', deadline: d(-1), deadline_original: d(-1), stage: 'new', resolution: 'Керівник скл., відділ А, відділ Б', askod_state: 'До виконання', source: 'askod', our_role: 'lead', on_control: true, control_note: 'контроль Голови', control_state: 'проєкт відсутній', control_lead: 'Керівник В.', control_list: 'Контроль (демо)', lead_unit: 'Департамент стратегії універсального охоплення населення медичними послугами' }),
    mk({ in_no: 'Д-1002-26', in_date: d(-3), correspondent: 'Громадянин (демо)', subject: 'Чи покриває програма медичних гарантій обстеження за направленням лікаря ПМД', deadline: d(2), stage: 'work', executor_name: 'Олена Приклад', version: 2, draft_path: '19_службові_записки\\letter_demo_v2.json', reply_kind: 'sz', nuances: 'Нових умов не вигадувати — лише специфікація пакета.' }),
    mk({ in_no: '10003-12-26', in_date: d(-10), correspondent: 'Обласна адміністрація (демо)', subject: 'Впровадження нових вагових коефіцієнтів з 01.01.2027', deadline: d(9), deadline_original: d(-2), stage: 'review', executor_name: 'Петро Зразок', version: 3, draft_url: 'https://docs.google.com/', nuances: 'Проєкт наступного року не тлумачимо.', our_role: 'lead', lead_unit: 'Департамент стратегії універсального охоплення населення медичними послугами' }),
    mk({ in_no: '10006-11-26', in_date: d(-5), correspondent: 'Слідчий орган (демо)', subject: 'Запит про надання відомостей щодо оплати послуг закладу', deadline: d(4), deadline_original: d(4), stage: 'sz_sent', executor_name: 'Олена Приклад', reply_kind: 'sz_work', our_role: 'co', lead_unit: 'Юридичний департамент', resolution: 'Юридичний департамент скл., наш департамент' }),
    mk({ in_no: 'ПІ-104-26', in_date: d(-4), correspondent: 'Запитувач (демо)', subject: 'Запит на інформацію: тарифи та кількість закладів за пакетом', deadline: d(1), stage: 'signing', executor_name: 'Демо-користувач', version: 2, reply_kind: 'pi', review_passed: true, draft_path: '10_НА_ПІДПИС\\02.11.26\\lyst_demo_v2.docx' }),
    mk({ in_no: '10005-06-26', in_date: d(-20), correspondent: 'Комітет (демо)', subject: 'Інформація щодо оплати медичних послуг у 2026 році', deadline: d(-5), stage: 'done', executor_name: 'Олена Приклад', version: 4, review_passed: true, out_no: '24001/8-15-26', out_date: d(-6) }),
    // Вхідні службові записки інших підрозділів — окрема смуга дошки (вигадані)
    mk({ in_no: '11-12/101-26', in_date: d(-2), correspondent: 'Службова записка', subject: 'Про надання інформації щодо умов закупівлі за пакетом для відповіді заявнику (демо)', deadline: d(3), stage: 'new', reply_kind: 'sz', source: 'askod', our_role: 'co' }),
    mk({ in_no: '5-12/202-26', in_date: d(-7), correspondent: 'Службова записка', subject: 'Пропозиції до специфікацій на наступний рік (демо)', deadline: d(-1), stage: 'work', reply_kind: 'sz', executor_name: 'Петро Зразок', version: 1, source: 'askod' }),
    mk({ in_no: '7-12/303-26', in_date: d(-1), correspondent: 'Службова записка', subject: 'Про зміну технічного обмеження в електронній системі з наступного року (демо)', deadline: null, stage: 'new', resolution: 'Керівник відділу: До врахування в роботі', executor_name: 'Демо-користувач', source: 'askod' }),
    mk({ in_no: null, subject: 'Ініціативний лист: роз\'яснення закладам щодо обліку послуг', stage: 'work', executor_name: 'Петро Зразок', version: 1, deadline: d(14), source: 'claude' }),
    // Не лише АСКОД: завдання, захід, напрям (вигадані)
    mk({ case_kind: 'task', in_no: null, reply_kind: 'other', subject: 'Довідка до наради: динаміка оплат за пакетом (демо)', assigned_by: 'Керівник відділу', deadline: d(1), stage: 'work', executor_name: 'Демо-користувач' }),
    mk({ case_kind: 'event', in_no: null, reply_kind: 'other', subject: 'Робоча група з оновлення специфікацій (демо)', correspondent: 'Міністерство (демо)', event_at: new Date(Date.now() + 864e5 * 2).toISOString(), event_place: 'Teams', deadline: d(2), stage: 'work', executor_name: 'Олена Приклад' }),
    mk({ case_kind: 'project', in_no: null, reply_kind: 'other', subject: 'Пропозиції до програми наступного року (демо)', deadline: d(30), stage: 'work', executor_name: 'Петро Зразок', nuances: 'Віха 1 — збір пропозицій; віха 2 — розрахунки' })
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
  // Зв'язок: ми співвиконавці, СЗ у робочому порядку головному виконавцю — чекаємо, поки врахує
  state.demoLinks = [{ id: crypto.randomUUID(), created_at: ago(2), case_id: c6, case_department: 'демо-відділ', direction: 'out', doc_kind: 'sz_work',
    doc_no: '3-19/60-26', doc_date: d(-2), counterpart: 'Юридичний департамент', about: 'Дані щодо оплат закладу за 2025–2026',
    wait_until: d(3), status: 'waiting', created_by: 'demo', created_by_name: 'Олена Приклад' }];
  // Друга СЗ — давня, строк очікування минув: смужка червоніє
  const c7 = state.cases.find((x) => x.stage === 'work' && x.id !== c6 && x.id !== c3)?.id;
  if (c7) state.demoLinks.push({ id: crypto.randomUUID(), created_at: ago(12), case_id: c7, case_department: 'демо-відділ', direction: 'out', doc_kind: 'sz',
    doc_no: '8-12/999-26', doc_date: d(-12), counterpart: 'Департамент-приклад', about: 'Запит даних для відповіді',
    wait_until: d(-2), status: 'waiting', created_by: 'demo', created_by_name: 'Петро Зразок' });
  countLinks(state.demoLinks, new Set(state.cases.map((c) => c.id)));
  $('spDeptName').textContent = 'Демо-режим: картки вигадані, нічого не зберігається в базі';
  render();
  applyUrlParams();
  initVoice({ demo: true, name: myName(), dept: DEPARTMENTS[1], depts: DEPARTMENTS, toast });
  initRoomChat({ demo: true, name: myName() });
  initAskodUpload({ demo: true, name: myName(), dept: () => state.dept, toast, cases: () => state.cases, people: () => state.people, reload: async () => render() });
  initControlUpload({ demo: true, name: myName(), dept: () => state.dept, toast, cases: () => state.cases, people: () => state.people,
    demoEvent: (id, body) => (state.demoEvents[id] ||= []).push({ id: crypto.randomUUID(), case_id: id, created_at: new Date().toISOString(), author_name: myName(), kind: 'system', body }),
    reload: async () => { render(); if (state.openId) openCase(state.openId, true); } });
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
  state.linkWait = {};
  const ids = state.cases.filter((c) => c.stage !== 'done').map((c) => c.id);
  if (!ids.length) return;
  const [{ data }, links] = await Promise.all([
    state.sb.from('dept_case_events').select('id, case_id, kind, remark_status, due_date, done, body')
      .in('kind', ['remark', 'reminder']).in('case_id', ids),
    state.noLinks ? { data: [] } : state.sb.from('dept_case_links').select('id, case_id, counterpart_case_id, case_department, direction, status, doc_kind, doc_no, doc_date, counterpart, wait_until, created_at, created_by_name')
      .eq('status', 'waiting').or(`case_id.in.(${ids.join(',')}),counterpart_case_id.in.(${ids.join(',')})`)
  ]);
  (data || []).forEach((r) => {
    if (r.kind === 'remark' && r.remark_status === 'open') state.remarkCounts[r.case_id] = (state.remarkCounts[r.case_id] || 0) + 1;
    if (r.kind === 'reminder' && !r.done && r.due_date) (state.reminders[r.case_id] ||= []).push(r);
  });
  // Таблиці зв'язків ще немає (міграцію 09b не застосовано) — дошка працює без бейджів ⏳/📥
  if (links.error) { if (MISSING.test(links.error.message || links.error.code || '')) state.noLinks = true; return; }
  countLinks(links.data || [], new Set(ids));
}

/* ── Зв'язки справ (migration_2026-11-09b_case_links.sql) ── */

/**
 * Зв'язок з погляду справи caseId. Рядок вносить одна сторона (case_id), а друга
 * (counterpart_case_id) бачить його дзеркально: наше «надіслали — чекаємо» для неї
 * «надійшло — врахувати», і навпаки.
 */
function viewLink(l, caseId) {
  if (l.case_id === caseId) return { ...l, dir: l.direction, who: l.counterpart, mirrored: false };
  return { ...l, dir: l.direction === 'out' ? 'in' : 'out', who: l.case_department ? `відділ ${l.case_department}` : (l.created_by_name || '—'), mirrored: true };
}

/** Відкриті зв'язки → state.linkWait[case_id] = { out: ⏳ чекаємо, in: 📥 врахувати }. */
function countLinks(rows, ids) {
  rows.filter((l) => l.status === 'waiting').forEach((l) => {
    [l.case_id, l.counterpart_case_id].forEach((id) => {
      if (!id || !ids.has(id)) return;
      const v = viewLink(l, id);
      const w = (state.linkWait[id] ||= { out: 0, in: 0, first: {} });
      w[v.dir]++;
      // Найдавніший відкритий документ у кожному напрямку: його дату й дні очікування видно на картці
      if (!w.first[v.dir] || sentOn(v) < sentOn(w.first[v.dir])) w.first[v.dir] = v;
    });
  });
}

/** Дата відправлення документа зв'язку: дата документа, інакше — коли внесли запис. */
const sentOn = (l) => l.doc_date || (l.created_at || '').slice(0, 10) || '';

function daysWord(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дні';
  return 'днів';
}

const DIR_WORD = {
  out: { icon: '📤', who: 'Ми', arrow: '→', waitHead: '⏳ чекаємо', tipHead: 'Ми надіслали', wait: 'чекаємо відповіді', cls: 'is-out' },
  in:  { icon: '📥', who: 'Нам', arrow: '←', waitHead: '🕓 у нас', tipHead: 'Нам надіслали', wait: 'у нас без опрацювання', cls: 'is-in' }
};

/**
 * Відкритий документ справи в напрямку dir ('out' — ми надіслали й чекаємо, 'in' — нам надіслали,
 * треба врахувати): { o, dir, label, sent, days, waitTxt, over, warm, tip, more }.
 * Вхідна службова записка без зв'язку теж «нам»: дата — дата реєстрації, від кого — кореспондент.
 * over — минув «чекаємо до» (або строк вхідної СЗ), warm — тиждень і довше.
 */
function waitInfo(c, dir) {
  const w = state.linkWait[c.id];
  let o = w?.first?.[dir];
  let count = w?.[dir] || 0;
  if (!o && dir === 'in' && isSzIn(c) && c.stage !== 'done' && c.stage !== 'sz_sent') {
    const who = c.correspondent && !/^службов/i.test(c.correspondent.trim()) ? c.correspondent : '';
    o = { doc_kind: 'sz', doc_no: c.in_no, doc_date: c.in_date, who, wait_until: c.deadline };
    count = 1;
  }
  if (!o) return null;
  const D = DIR_WORD[dir];
  const sent = sentOn(o);
  const days = sent ? Math.max(0, -daysLeft(sent)) : null;
  const over = !!o.wait_until && daysLeft(o.wait_until) < 0;
  const label = `${LINK_SHORT[o.doc_kind] || 'Документ'}${o.doc_no ? ' № ' + o.doc_no : ''}`;
  const waitTxt = days === null ? (dir === 'out' ? 'чекаємо' : 'врахувати') : days === 0 ? 'сьогодні' : `${days} ${daysWord(days)}`;
  const who = o.who && o.who !== '—' ? o.who : '';
  const tip = [`${D.tipHead}: ${label}${sent ? ' від ' + fmtDate(sent) : ''}`, who ? (dir === 'out' ? 'кому: ' : 'від кого: ') + who : '',
    days !== null ? `${D.wait} ${days} ${daysWord(days)}` : '', o.wait_until ? `${dir === 'out' ? 'чекаємо до' : 'строк'} ${fmtDate(o.wait_until)}${over ? ' — минув' : ''}` : '',
    count > 1 ? `ще ${count - 1}` : ''].filter(Boolean).join(' · ');
  return { o, dir, who, label, sent, days, waitTxt, over, warm: !over && days !== null && days >= 7, tip, more: count - 1 };
}

/** Смужка на картці: «📤 Ми → кому · СЗ № … від 03.11 · ⏳ 6 днів» або «📥 Нам ← від кого · …». */
function sentStripHTML(c, dir) {
  const i = waitInfo(c, dir);
  if (!i) return '';
  const D = DIR_WORD[dir];
  return `<div class="sp-sent ${D.cls}${i.over ? ' is-over' : i.warm ? ' is-warm' : ''}" title="${esc(i.tip)}">
      <span class="sp-sent-doc">${D.icon} <b class="sp-sent-dir">${D.who}${i.who ? ` ${D.arrow}` : ''}</b>${i.who ? ` ${esc(i.who)}` : ''} · <b>${esc(i.label)}</b>${i.sent ? ` від ${fmtDate(i.sent).slice(0, 5)}` : ''}</span>
      <span class="sp-sent-wait">${D.waitHead} ${esc(i.waitTxt)}${i.more > 0 ? ` · +${i.more}` : ''}</span>
    </div>`;
}

/** Міні-мітка в рядку списку. */
function sentMiniHTML(c, dir) {
  const i = waitInfo(c, dir);
  if (!i) return '';
  return ` <span class="sp-sent-mini ${DIR_WORD[dir].cls}${i.over ? ' is-over' : i.warm ? ' is-warm' : ''}" title="${esc(i.tip)}">${DIR_WORD[dir].icon} ${dir === 'out' ? 'ми' : 'нам'}${i.sent ? ' ' + fmtDate(i.sent).slice(0, 5) : ''} · ${esc(i.waitTxt)}</span>`;
}

async function loadLinks(caseId) {
  state.links = [];
  state.peers = [];
  if (DEMO) {
    state.links = state.demoLinks.filter((l) => l.case_id === caseId || l.counterpart_case_id === caseId).map((l) => viewLink(l, caseId));
    return renderLinks();
  }
  if (state.noLinks) return renderLinks();
  const c = state.cases.find((x) => x.id === caseId);
  const [links, peers] = await Promise.all([
    state.sb.from('dept_case_links').select('*').or(`case_id.eq.${caseId},counterpart_case_id.eq.${caseId}`).order('created_at'),
    c?.in_no ? state.sb.rpc('dept_case_peers', { p_case: caseId }) : { data: [] }
  ]);
  if (links.error && MISSING.test(links.error.message || links.error.code || '')) state.noLinks = true;
  state.links = (links.data || []).map((l) => viewLink(l, caseId));
  state.peers = peers.error ? [] : (peers.data || []);
  renderLinks();
}

function linkHTML(l) {
  const head = [LINK_DOC[l.doc_kind] || 'Документ', l.doc_no ? '№ ' + l.doc_no : '', l.doc_date ? 'від ' + fmtDate(l.doc_date) : ''].filter(Boolean).join(' ');
  const side = l.who ? (l.dir === 'out' ? '→ ' : '← ') + l.who : '';
  const wait = l.dir === 'out' && l.status === 'waiting' && l.wait_until ? daysLeft(l.wait_until) : null;
  const peer = l.counterpart_case_id && !l.mirrored ? state.cases.find((x) => x.id === l.counterpart_case_id) : (l.mirrored ? state.cases.find((x) => x.id === l.case_id) : null);
  const mine = DEMO || (state.me && l.created_by === state.me.id);
  const st = LINK_STATUS[l.dir];
  return `<li class="sp-link is-${l.dir} is-${l.status}" data-link="${l.id}">
    <div class="sp-link-head">
      <span class="sp-link-dir">${l.dir === 'out' ? '📤 Ми надіслали' : '📥 Нам надіслали'}</span>
      <b>${esc(head)}</b> <span class="sp-muted">${esc(side)}</span>
      <select class="sp-link-status" aria-label="Стан">${Object.entries(st).map(([k, v]) => `<option value="${k}"${k === l.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
      ${mine && !l.mirrored ? '<button type="button" class="sp-link-del" data-link-del title="Прибрати зв\'язок" aria-label="Прибрати зв\'язок">✕</button>' : ''}
    </div>
    ${l.about ? `<div class="sp-link-body">${esc(l.about)}</div>` : ''}
    <div class="sp-link-meta">
      ${l.project_no && l.project_no !== l.doc_no ? `<span>до проєкту № ${esc(l.project_no)}</span>` : ''}
      ${l.wait_until ? `<span class="${wait !== null && wait < 0 ? 'sp-dl is-over' : wait !== null && wait <= 1 ? 'sp-dl is-hot' : ''}">чекаємо до ${fmtDate(l.wait_until)}${wait !== null && wait < 0 ? ` · минуло ${-wait} дн.` : ''}</span>` : ''}
      ${peer ? `<button type="button" class="sp-link-case" data-open-case="${peer.id}">↗ ${esc(peer.in_no || 'справа')}</button>` : l.counterpart_case_id || l.mirrored ? '<span>справа іншого відділу</span>' : ''}
      ${l.mirrored ? `<span>вніс(-ла) ${esc(l.created_by_name || '—')}</span>` : ''}
    </div>
    <input class="sp-link-ans" value="${esc(l.answer_note)}" placeholder="${l.dir === 'out' ? 'Що відповіли' : 'Як враховано'}">
  </li>`;
}

function renderLinks() {
  const box = $('spLinks');
  if (!box) return;
  const open = state.links.filter((l) => l.status === 'waiting').length;
  $('spLinksCount').textContent = state.links.length ? `${open} відкрито з ${state.links.length}` : '';
  const rcase = state.cases.find((x) => x.id === state.openId);
  if (rcase) renderRoute(rcase);   // «⏳ Чекаємо» в маршруті — з тих самих зв'язків
  // Що справа вже знає: наш проєкт відповіді, головний виконавець, наша роль — видно й без зв'язків
  const c = state.cases.find((x) => x.id === state.openId) || {};
  const ctx = [c.project_no && `наш проєкт відповіді <b>№ ${copyHTML(c.project_no, '№ проєкту')}</b>`,
    c.lead_unit && `головний виконавець: <b>${esc(c.lead_unit)}</b>`, c.our_role && esc(ROLE_LABEL[c.our_role])].filter(Boolean);
  const peers = (ctx.length ? `<p class="sp-link-ctx">${ctx.join(' · ')}</p>` : '') + (state.peers.length ? `<p class="sp-peers"><b>Та сама справа в інших відділах:</b> ${state.peers.map((p) =>
    `<span class="sp-peer">відділ ${esc(p.department)} · ${esc(STAGE_LABEL[p.stage] || p.stage)}${p.executor_name ? ' · ' + esc(p.executor_name) : ''}${p.our_role ? ' · ' + esc(ROLE_SHORT[p.our_role] || '') : ''}${p.project_no ? ' · проєкт № ' + esc(p.project_no) : ''}</span>`).join('')}</p>` : '');
  box.innerHTML = state.noLinks
    ? '<li class="sp-muted sp-none">Зв\'язків у базі ще немає: потрібно застосувати migration_2026-11-09b_case_links.sql.</li>'
    : (state.links.length ? state.links.map(linkHTML).join('')
      : '<li class="sp-muted sp-none">Зв\'язків немає. Надіслали СЗ головному виконавцю чи отримали СЗ від співвиконавця — внесіть кнопкою нижче.</li>');
  $('spPeers').innerHTML = peers;
  $('spLinkBtns').hidden = state.noLinks;
}

/** Новий зв'язок. У демо — у пам'яті; у базі історію обох справ пише тригер. */
async function addLink(caseId, row) {
  const full = { case_id: caseId, status: 'waiting', created_by_name: myName(), ...row };
  if (DEMO) {
    const c = state.cases.find((x) => x.id === caseId);
    const l = { id: crypto.randomUUID(), created_at: new Date().toISOString(), case_department: c?.department, created_by: 'demo', ...full };
    state.demoLinks.push(l);
    demoLinkLog(l, null);
  } else {
    const { error } = await state.sb.from('dept_case_links').insert({ ...full, created_by: state.me.id });
    if (error) return toast('Зв\'язок не збережено: ' + error.message, true);
    if (state.openId === caseId) await loadEvents(caseId);
  }
  await refreshLinks(caseId);
}

async function updateLink(caseId, id, patch) {
  if (DEMO) {
    const l = state.demoLinks.find((x) => x.id === id);
    if (!l) return;
    const prev = { ...l };
    Object.assign(l, patch);
    demoLinkLog(l, prev);
  } else {
    const { error } = await state.sb.from('dept_case_links').update({ ...patch, updated_by_name: myName() }).eq('id', id);
    if (error) return toast('Не збережено: ' + error.message, true);
    if ('status' in patch && state.openId === caseId) await loadEvents(caseId);
  }
  await refreshLinks(caseId);
}

async function deleteLink(caseId, id) {
  if (!confirm('Прибрати цей зв\'язок? Записи в історії справи лишаться.')) return;
  if (DEMO) state.demoLinks = state.demoLinks.filter((x) => x.id !== id);
  else {
    const { error } = await state.sb.from('dept_case_links').delete().eq('id', id);
    if (error) return toast('Не прибрано: ' + error.message, true);
  }
  await refreshLinks(caseId);
}

async function refreshLinks(caseId) {
  if (DEMO) { state.linkWait = {}; countLinks(state.demoLinks, new Set(state.cases.map((c) => c.id))); }
  else await loadCounts();
  render();
  if (state.openId === caseId) { loadLinks(caseId); if (DEMO) loadEvents(caseId); }
}

/** Демо-імітація тригера dept_case_links_log: історія обох справ. */
function demoLinkLog(l, prev) {
  const doc = `${LINK_SHORT[l.doc_kind] || 'Документ'}${l.doc_no ? ' № ' + l.doc_no : ''}`;
  const push = (id, body) => id && (state.demoEvents[id] ||= []).push({ id: crypto.randomUUID(), case_id: id, created_at: new Date().toISOString(), author_name: myName(), kind: 'system', body });
  if (!prev) {
    push(l.case_id, l.direction === 'out' ? `🔗 ${doc}${l.counterpart ? ' → ' + l.counterpart : ''} — чекаємо відповіді` : `🔗 ${doc}${l.counterpart ? ' від ' + l.counterpart : ''} — врахувати`);
    push(l.counterpart_case_id, l.direction === 'out' ? `🔗 Від відділу ${l.case_department || '—'}: ${doc} — врахувати` : `🔗 ${doc} → відділу ${l.case_department || '—'} — чекають від нас`);
  } else if (prev.status !== l.status) {
    const word = { answered: l.direction === 'out' ? 'відповідь отримано' : 'враховано', closed: 'знято', waiting: 'знову чекаємо' }[l.status];
    const body = `🔗 ${doc}: ${word}${l.answer_note ? ' — ' + l.answer_note : ''}`;
    push(l.case_id, body);
    push(l.counterpart_case_id, body);
  }
}

function subscribe() {
  let timer = null;
  const reload = () => { clearTimeout(timer); timer = setTimeout(loadCases, 400); };
  state.sb.channel('dept-cases')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dept_cases' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dept_case_events' }, reload)
    // Друга сторона зв'язку відмітила «враховано» / «відповідь є» — бейджі ⏳/📥 оновлюються самі
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dept_case_links' }, reload)
    .subscribe();
}

/** Зберегти зміну картки. У демо — лише в пам'яті. */
async function saveCase(id, patch) {
  const c = state.cases.find((x) => x.id === id);
  if (!c) return;
  const prev = { ...c };
  Object.assign(c, patch, { updated_by_name: myName() });
  const toSz = patch.stage === 'sz_sent' && prev.stage !== 'sz_sent';
  if (DEMO) {
    demoLog(c, prev);
    c.change_note = null;
    render();
    if (state.openId === id) { renderDrawerHead(c); loadEvents(id); }
    if (toSz) await autoLinkSzSent(c);
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
  if (toSz) await autoLinkSzSent(c);
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
    ev(back ? 'returned' : 'stage', `${back ? 'Повернуто: ' : ''}${stageLabel(c, prev.stage)} → ${stageLabel(c, c.stage)}${tail}`);
  }
  if (c.lead_unit !== prev.lead_unit || c.our_role !== prev.our_role) ev('system', `Головний виконавець: ${c.lead_unit || '—'}${c.our_role ? ` (${ROLE_LABEL[c.our_role].toLowerCase()})` : ''}`);
  if (c.version !== prev.version && c.version) ev('version', `Чернетка v${c.version}`);
  if (c.executor_name !== prev.executor_name) ev('executor', `Виконавець: ${c.executor_name || '—'}`);
  if (c.review_passed !== prev.review_passed) ev('review', c.review_passed ? 'Рецензію пройдено' : 'Рецензію знято');
  if (!!c.on_control !== !!prev.on_control) ev('system', c.on_control ? `🎯 Поставлено на контроль${c.control_note ? ' — ' + c.control_note : ''}` : '🎯 Знято з контролю');
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
  if (state.f === 'control') return !!c.on_control;
  if (state.f === 'prolonged') return !!prolongInfo(c);
  if (state.f === 'note') return isNoteCase(c);
  if (state.f === 'waiting') return (state.linkWait[c.id]?.out || 0) > 0;
  if (state.f === 'incoming') return (state.linkWait[c.id]?.in || 0) > 0;
  return true;
}

function visibleCases() {
  const q = state.q.trim().toLowerCase();
  return state.cases.filter((c) => {
    if (state.kind === 'szin') { if (!isSzIn(c)) return false; }
    else if (state.kind !== 'all' && kindOf(c) !== state.kind) return false;
    if (state.mine && !isMine(c)) return false;
    if (!passesFilter(c)) return false;
    if (!q) return true;
    return [c.in_no, c.subject, c.correspondent, c.executor_name, c.resolution, c.out_no, c.project_no, c.nuances, c.lead_unit,
      c.assigned_by, c.event_place, CASE_KINDS[kindOf(c)]?.label, c.control_note, c.control_state, c.control_lead]
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
  // Вхідні службові записки — окремою смугою НАД листами й зверненнями (їх мало — не губляться внизу), з тими самими етапами
  const lanes = splitLanes(list);
  applyColWidths(board);
  board.innerHTML = lanes
    ? laneHTML('📝 Вхідні службові записки', lanes.sz, 'sz') + laneHTML('📨 Листи, звернення, запити', lanes.main, 'main')
    : colsHTML(list);
  renderMobileTabs(list);
  renderReminderStrip();
}

/**
 * Дві смуги — лише коли показуємо документи АСКОД разом («Усі види» / «Документи АСКОД») і є обидві
 * частини; вибрано «📝 Вхідні службові» чи інший вид — одна звичайна дошка.
 */
function splitLanes(list) {
  if (!['all', 'askod'].includes(state.kind)) return null;
  const sz = list.filter(isSzIn);
  if (!sz.length || sz.length === list.length) return null;
  return { main: list.filter((c) => !isSzIn(c)), sz };
}

/**
 * Смуги згортаються (з 09.11.2026, користувач: «зроби щоб могли згортатись службові та листи»): клік по
 * заголовку. Що згорнуто — пам'ятає браузер (localStorage 'spravy-lanes-closed'); у згорнутій смузі заголовок
 * показує, скільки справ на кожному етапі, щоб нічого не загубилось.
 */
const lanesClosed = () => { try { return JSON.parse(lsGet('spravy-lanes-closed') || '{}') || {}; } catch (_) { return {}; } };
function laneHead(title, list, key) {
  const closed = !!lanesClosed()[key];
  const open = list.filter((c) => !isClosed(c)).length;
  const sum = closed ? stagesOf('askod').filter((s) => s.key !== 'done')
    .map((s) => [s.label, list.filter((c) => c.stage === s.key).length]).filter(([, n]) => n)
    .map(([l, n]) => `${l} ${n}`).join(' · ') : '';
  return `<h2 class="sp-lane sp-lane-${key}${closed ? ' is-closed' : ''}"><button type="button" class="sp-lane-tg" data-lane="${key}" aria-expanded="${!closed}" title="${closed ? 'Розгорнути' : 'Згорнути'}">
    <span class="sp-lane-chev" aria-hidden="true">▾</span><span>${title}</span><b>${open}</b><i>у роботі</i>${sum ? `<em class="sp-lane-sum">${sum}</em>` : ''}</button></h2>`;
}
const laneOpen = (key) => !lanesClosed()[key];

function laneHTML(title, list, key) {
  return laneHead(title, list, key) + (laneOpen(key) ? colsHTML(list) : '');
}

/** Колонки етапів. Обрано один вид, не АСКОД — колонки і назви етапів цього виду (без «На підписі» / «СЗ надано»). */
/**
 * Згорнуті колонки (вимога користувача 10.11.2026: «Закрито» й «Нове» розтягуються дуже сильно).
 * Стан — на пристрої, спільний для обох смуг: колонки в них ті самі. Згорнута колонка — вузька смужка з
 * назвою й лічильником; картки можна перетягувати й на неї. На телефоні не діє (там по одній колонці).
 */
const colsFolded = () => { try { return JSON.parse(lsGet('spravy-cols-folded') || '{}') || {}; } catch (_) { return {}; } };
const boardStages = () => stagesOf(state.kind === 'all' || state.kind === 'szin' ? 'askod' : state.kind);

function applyColWidths(board) {
  const f = colsFolded();
  const st = boardStages();
  board.style.setProperty('--sp-cols', st.map((s) => (f[s.key] ? '46px' : 'minmax(0, 1fr)')).join(' '));
  board.style.setProperty('--sp-cols-narrow', st.map((s) => (f[s.key] ? '46px' : 'minmax(210px, 1fr)')).join(' '));
}

function colsHTML(list) {
  const folded = colsFolded();
  return boardStages().map((s) => {
    const items = sortCol(list.filter((c) => c.stage === s.key), s.key);
    const shown = s.key === 'done' ? items.slice(0, 30) : items;
    const fold = !!folded[s.key];
    return `<section class="sp-col${s.key === state.mobileStage ? ' is-mobile-active' : ''}${fold ? ' is-folded' : ''}" data-stage="${s.key}">
      <header class="sp-col-head">
        <button type="button" class="sp-col-fold" data-fold="${s.key}" aria-expanded="${!fold}" title="${fold ? `Розгорнути «${s.label}»` : `Згорнути «${s.label}»`}">${fold ? '›' : '‹'}</button>
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
}

/* ── Вигляд «Список»: усе одним списком, найгарячіше зверху ── */

/** Порядок за строком: прострочене й найближче зверху, без строку — внизу, закрите — в кінці. */
function byDeadline(a, b) {
  const done = (c) => (c.stage === 'done' ? 2 : c.stage === 'sz_sent' ? 1 : 0);
  return (done(a) - done(b)) || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'));
}

function rowHTML(c, withExecutor = true) {
  const dl = deadlineInfo(c);
  const rem = state.remarkCounts[c.id] || 0;
  const bell = nextReminder(c.id);
  return `<li class="sp-row sp-row-${c.stage}" data-id="${c.id}" tabindex="0" role="button">
    <span class="sp-row-dl">${dl ? `<span class="sp-dl ${dl.cls}">${esc(dl.text)}</span>` : '<span class="sp-muted">без строку</span>'}${(() => { const pr = prolongInfo(c); return pr ? ` <span class="sp-prol sp-prol-mini" title="${esc(pr.tip)}">↻ було ${fmtDate(pr.orig).slice(0, 5)}</span>` : ''; })()}</span>
    <span class="sp-row-no">${c.on_control ? `<span class="sp-ctl-mini" title="${esc(controlTip(c))}">🎯</span> ` : ''}${CASE_KINDS[kindOf(c)].icon} ${esc(c.in_no || (kindOf(c) === 'event' && c.event_at ? fmtEventAt(c.event_at) : CASE_KINDS[kindOf(c)].short))}</span>
    <span class="sp-row-subj">${esc(c.subject)}${c.correspondent ? `<i>${esc(c.correspondent)}</i>` : c.assigned_by ? `<i>від: ${esc(c.assigned_by)}</i>` : ''}</span>
    ${withExecutor ? `<span class="sp-row-ex">${esc(c.executor_name || '—')}</span>` : ''}
    <span class="sp-row-stage"><b class="sp-stage-dot"></b>${stageLabel(c, c.stage)}${c.version ? ` · v${c.version}` : ''}${rem ? ` <span class="sp-rem-mini">⚑ ${rem}</span>` : ''}${bell ? ' 🔔' : ''}${isNoteCase(c) ? ` <span class="sp-note sp-note-mini" title="${esc(NOTE_TIP(c))}">${c.our_role === 'answer' ? '↩ СЗ-відповідь' : '📌 врахувати'}</span>` : ''}${sentMiniHTML(c, 'out')}${sentMiniHTML(c, 'in')}</span>
  </li>`;
}

function listHTML(list) {
  const lanes = splitLanes(list);
  if (lanes) {
    const part = (title, l, key) => laneHead(title, l, key) + (laneOpen(key) ? listRows(l) : '');
    return part('📝 Вхідні службові записки', lanes.sz, 'sz') + part('📨 Листи, звернення, запити', lanes.main, 'main');
  }
  return listRows(list);
}

function listRows(list) {
  const rows = list.slice().sort(byDeadline);
  const shown = rows.filter((c) => c.stage !== 'done').concat(rows.filter((c) => c.stage === 'done').slice(0, 30)); // «СЗ надано» — у кінці відкритих (byDeadline)
  return rows.length ? `<ul class="sp-list">${shown.map((c) => rowHTML(c)).join('')}</ul>`
    : '<div class="sp-notice">Справ за цим фільтром немає.</div>';
}

/* ── Вигляд «За виконавцями»: хто що тримає ── */
function peopleHTML(list) {
  const groups = new Map();
  list.filter((c) => !isClosed(c)).forEach((c) => {
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
  if (isNoteCase(c) && !isClosed(c)) return 'done';
  if (kindOf(c) !== 'askod') return { new: 'work', work: 'review', review: 'done' }[c.stage] || null;
  const co = c.our_role === 'co';
  return {
    new: 'work',
    work: co ? 'sz_sent' : 'review',
    review: co ? 'sz_sent' : 'signing',
    signing: 'done',
    sz_sent: 'done'
  }[c.stage] || null;
}

/** Підказка позначки «На контролі»: примітка, стан за контролькою, гол. виконавець, звідки. */
function controlTip(c) {
  return ['На контролі', c.control_note, c.control_state && 'стан: ' + c.control_state,
    c.control_lead && 'гол. вик.: ' + c.control_lead, c.control_list].filter(Boolean).join(' · ');
}

function cardHTML(c) {
  const dl = deadlineInfo(c);
  const next = nextStage(c);
  const remarks = state.remarkCounts[c.id] || 0;
  const rem = nextReminder(c.id);
  const prolonged = c.deadline && c.deadline_original && c.deadline !== c.deadline_original;
  const pr = prolongInfo(c);
  const k = kindOf(c);
  const lw = state.linkWait[c.id];
  const badges = [
    c.on_control ? `<span class="sp-ctl" title="${esc(controlTip(c))}">🎯 контроль</span>` : '',
    pr ? `<span class="sp-prol" title="${esc(pr.tip)}">↻ було ${fmtDate(pr.orig).slice(0, 5)}</span>` : '',
    routeMiniHTML(c),
    isNoteCase(c) && c.our_role !== 'answer' ? `<span class="sp-note" title="${esc(NOTE_TIP(c))}">📌 врахувати</span>` : '',
    c.our_role ? `<span class="sp-role sp-role-${c.our_role}" title="${esc(ROLE_LABEL[c.our_role] + (c.lead_unit ? ' · головний: ' + c.lead_unit : ''))}">${ROLE_SHORT[c.our_role]}</span>` : '',
    k === 'askod' ? `<span class="sp-kind">${KIND_SHORT[c.reply_kind] || ''}</span>` : `<span class="sp-kind sp-kind-${k}" title="${CASE_KINDS[k].label}">${CASE_KINDS[k].icon} ${CASE_KINDS[k].short}</span>`,
    c.version ? `<span class="sp-ver" title="Поточна версія чернетки">v${c.version}</span>` : '',
    c.review_passed ? '<span class="sp-ok" title="Рецензію пройдено">✓ рецензія</span>' : '',
    remarks ? `<span class="sp-rem" title="Незакриті зауваження">⚑ ${remarks}</span>` : '',
    rem ? `<span class="sp-bell${daysLeft(rem.due_date) <= 0 ? ' is-due' : ''}" title="${esc('Нагадування: ' + rem.body)}">🔔 ${fmtDate(rem.due_date).slice(0, 5)}</span>` : '',
    c.source === 'claude' ? '<span class="sp-src" title="Справу завів Claude">Claude</span>' : ''
  ].join('');
  const ms = k === 'project' ? milestonesOf(c) : [];
  const msNext = k === 'project' ? nextMilestone(c) : null;
  const kids = k === 'project' ? childrenOf(c.id).length : 0;
  const parent = c.parent_id ? state.cases.find((x) => x.id === c.parent_id) : null;
  const head = c.in_no || (k === 'event' && c.event_at ? `📅 ${fmtEventAt(c.event_at)}` : `${CASE_KINDS[k].icon} ${CASE_KINDS[k].short}`);
  return `<article class="sp-card sp-card-${k}${c.on_control && !isClosed(c) ? ' is-control' : ''}${c.stage === 'sz_sent' ? ' is-closed' : ''}${pr ? ' is-prolonged' : ''}${isNoteCase(c) && !isClosed(c) ? ' is-note' : ''}${lw?.out ? ' is-waiting' : lw?.in ? ' is-incoming' : ''}" draggable="true" data-id="${c.id}" tabindex="0" role="button" aria-label="${esc((c.in_no || CASE_KINDS[k].label) + ': ' + c.subject)}">
    <div class="sp-card-top">
      <span class="sp-inno">${esc(head)}</span>
      ${dl ? `<span class="sp-dl ${dl.cls}"${prolonged ? ` title="Продовжено; первинний строк ${fmtDate(c.deadline_original)}"` : ''}>${prolonged ? '↻ ' : ''}${esc(dl.text)}</span>` : ''}
    </div>
    <div class="sp-subj">${esc(c.subject)}</div>
    ${c.correspondent ? `<div class="sp-corr">${esc(c.correspondent)}</div>`
      : c.assigned_by ? `<div class="sp-corr">від: ${esc(c.assigned_by)}</div>`
      : k === 'event' && c.event_place ? `<div class="sp-corr">${esc(c.event_place)}</div>` : ''}
    ${parent ? `<div class="sp-parent" title="Напрям">🧭 ${esc(parent.subject)}</div>` : ''}
    ${ms.length || kids ? `<div class="sp-ms-line">${ms.length ? `<span class="sp-ms-bar" style="--p:${Math.round(100 * ms.filter((m) => m.done).length / ms.length)}%"></span><span>віхи ${ms.filter((m) => m.done).length}/${ms.length}</span>` : ''}${msNext ? `<span title="${esc('Наступна віха: ' + msNext.title)}">→ ${fmtDate(msNext.due).slice(0, 5)}</span>` : ''}${kids ? `<span title="Пов'язані справи">🔗 ${kids}</span>` : ''}</div>` : ''}
    ${k === 'project' && c.lead_unit ? `<div class="sp-parent" title="Головний виконавець">🏛 ${esc(c.lead_unit)}</div>` : ''}
    ${sentStripHTML(c, 'out')}${sentStripHTML(c, 'in')}
    <div class="sp-card-foot">
      <div class="sp-badges">${badges}</div>
      ${c.executor_name ? `<span class="sp-ava" title="${esc(c.executor_name)}">${esc(initials(c.executor_name))}</span>` : '<span class="sp-ava is-none" title="Виконавця не призначено">?</span>'}
    </div>
    ${c.out_no ? `<div class="sp-out">вих. № ${esc(c.out_no)}${c.out_date ? ' від ' + fmtDate(c.out_date) : ''}</div>`
      : c.project_no ? `<div class="sp-out" title="№ проєкту відповіді в АСКОД — клік копіює">проєкт № ${copyHTML(c.project_no, '№ проєкту')}</div>` : ''}
    ${next ? (isNoteCase(c) && next === 'done'
      ? `<button type="button" class="sp-next sp-next-note" data-next="${c.id}" title="Враховано в роботі — перевести в «Закрито»">📌 Враховано →</button>`
      : `<button type="button" class="sp-next" data-next="${c.id}" title="Перевести в «${stageLabel(c, next)}»">${stageLabel(c, next)} →</button>`) : ''}
  </article>`;
}

function renderStats() {
  const active = state.cases.filter((c) => !isClosed(c));
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
  $('spStageTabs').innerHTML = stagesOf(state.kind === 'all' || state.kind === 'szin' ? 'askod' : state.kind).map((s) => {
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
  const k = kindOf(c);
  const kindSel = `<label class="sp-f"><span>Вид справи</span><select data-f="case_kind">${Object.entries(CASE_KINDS).map(([v, d]) => opt(v, k, `${d.icon} ${d.label}`)).join('')}</select></label>`;
  const exSel = (label) => `<label class="sp-f"><span>${label}</span><select data-f="executor_name">${opt('', c.executor_name, '— не призначено —')}${people.map((p) => opt(p, c.executor_name)).join('')}</select></label>`;
  const link = (label) => `<label class="sp-f sp-wide"><span>${label}</span>
      <span class="sp-linkrow"><input data-f="draft_url" value="${esc(c.draft_url)}" placeholder="https://…">${/^https?:\/\//.test(c.draft_url || '') ? `<a class="sp-btn sp-btn-ghost" href="${esc(c.draft_url)}" target="_blank" rel="noopener">Відкрити</a>` : ''}</span></label>`;
  const projs = projectsOf(c.id);
  const parentSel = projs.length || c.parent_id ? `<label class="sp-f"><span>Напрям</span><select data-f="parent_id">${opt('', c.parent_id, '— поза напрямом —')}${projs.map((x) => opt(x.id, c.parent_id, x.subject.length > 60 ? x.subject.slice(0, 58) + '…' : x.subject)).join('')}</select></label>` : '';
  const deadlineF = (label) => `<label class="sp-f"><span>${label}${prolonged ? ` <i class="sp-orig">первинний ${fmtDate(c.deadline_original)}</i>` : ''}</span><input type="date" data-f="deadline" value="${esc(c.deadline)}"></label>`;
  if (k === 'task') return `<div class="sp-grid">
    ${kindSel}${deadlineF('Строк')}${parentSel}
    <label class="sp-f sp-wide"><span>Що зробити</span><textarea data-f="subject" rows="2">${esc(c.subject)}</textarea></label>
    <label class="sp-f sp-wide"><span>Від кого</span><input data-f="assigned_by" value="${esc(c.assigned_by)}" placeholder="Хто доручив: керівник, колега, Teams"></label>
    ${exSel('Виконавець')}
    ${link('Результат — файл, документ, посилання')}
    <label class="sp-f sp-wide"><span>Нюанси — на що зважати</span><textarea data-f="nuances" rows="3">${esc(c.nuances)}</textarea></label>
  </div>`;
  if (k === 'event') return `<div class="sp-grid">
    ${kindSel}
    <label class="sp-f"><span>Коли</span><input type="datetime-local" data-f="event_at" value="${esc(toLocalInput(c.event_at))}"></label>${parentSel}
    <label class="sp-f sp-wide"><span>Назва заходу</span><textarea data-f="subject" rows="2">${esc(c.subject)}</textarea></label>
    <label class="sp-f sp-wide"><span>Де / посилання на зустріч</span><input data-f="event_place" value="${esc(c.event_place)}" placeholder="Teams, Zoom, кабінет"></label>
    <label class="sp-f sp-wide"><span>Організатор</span><input data-f="correspondent" value="${esc(c.correspondent)}" placeholder="МОЗ, ВООЗ, Голова НСЗУ…"></label>
    ${exSel('Хто від відділу')}
    ${link('Матеріали — тези, презентація, протокол')}
    <label class="sp-f sp-wide"><span>Що домовились / підсумки</span><textarea data-f="nuances" rows="4" placeholder="Рішення, доручення, хто що робить далі">${esc(c.nuances)}</textarea></label>
  </div>`;
  if (k === 'project') return `<div class="sp-grid">
    ${kindSel}${deadlineF('Ключова дата')}
    <label class="sp-f sp-wide"><span>Назва напряму</span><textarea data-f="subject" rows="2">${esc(c.subject)}</textarea></label>
    ${exSel('Відповідальний')}
    <label class="sp-f"><span>Головний виконавець</span>
      <input data-f="lead_unit" list="spLeadUnits" value="${esc(c.lead_unit)}" placeholder="Аналітичне управління, наш департамент…"></label>
    ${link('Робочий документ, тека, посилання')}
    <label class="sp-f sp-wide"><span>Нотатки й план</span><textarea data-f="nuances" rows="4" placeholder="Мета, що вже є, на що зважати">${esc(c.nuances)}</textarea></label>
  </div>
  <datalist id="spLeadUnits">${LEAD_UNITS.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
  ${projectBlockHTML(c)}`;
  return `
  <div class="sp-lead">
    <label class="sp-f sp-lead-unit"><span>Головний виконавець (департамент / управління / відділ)</span>
      <input data-f="lead_unit" list="spLeadUnits" value="${esc(c.lead_unit)}" placeholder="Хто відповідає за документ у цілому"></label>
    <label class="sp-f"><span>Наша роль</span><select data-f="our_role">${opt('', c.our_role, '— не визначено —')}${Object.entries(ROLE_LABEL).map(([k, v]) => opt(k, c.our_role, v)).join('')}</select></label>
  </div>
  <datalist id="spLeadUnits">${LEAD_UNITS.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
  ${controlHTML(c)}
  <div class="sp-grid">
    ${kindSel}${parentSel}
    <label class="sp-f"><span>Вх. №</span><input data-f="in_no" value="${esc(c.in_no)}" placeholder="10001-08-26"></label>
    <label class="sp-f"><span>Строк${prolonged ? ` <i class="sp-orig">первинний ${fmtDate(c.deadline_original)}</i>` : ''}</span><input type="date" data-f="deadline" value="${esc(c.deadline)}"></label>
    <label class="sp-f sp-wide"><span>Суть</span><textarea data-f="subject" rows="2">${esc(c.subject)}</textarea></label>
    <label class="sp-f sp-wide"><span>Кореспондент</span><input data-f="correspondent" value="${esc(c.correspondent)}"></label>
    <label class="sp-f"><span>Тип відповіді</span><select data-f="reply_kind">${Object.entries(KIND_LABEL).map(([k, v]) => opt(k, c.reply_kind, v)).join('')}</select></label>
    <label class="sp-f sp-wide"><span>Резолюція (хто скл., співвиконавці)</span><input data-f="resolution" value="${esc(c.resolution)}" placeholder="Прізвище скл., Прізвище, Прізвище"></label>
    <label class="sp-f"><span>Виконавець у відділі</span><select data-f="executor_name">${opt('', c.executor_name, '— не призначено —')}${people.map((p) => opt(p, c.executor_name)).join('')}</select></label>
    <label class="sp-f"><span>Версія чернетки</span><input type="number" min="1" data-f="version" value="${esc(c.version)}" placeholder="1"></label>
    <label class="sp-f"><span>№ проєкту відповіді (АСКОД)</span><input data-f="project_no" value="${esc(c.project_no)}" placeholder="Н(СЛ)-12345"></label>
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

/**
 * «🎯 На контролі» (з 09.11.2026): галочка й примітка — вручну; стан виконання,
 * гол. виконавець і назва контрольки — з кнопки «🎯 Контролька» (control-upload.js).
 */
function controlHTML(c) {
  const from = [c.control_state && `Стан за контролькою: <b>${esc(c.control_state)}</b>`,
    c.control_lead && `гол. вик.: ${esc(c.control_lead)}`, c.control_list && esc(c.control_list)].filter(Boolean).join(' · ');
  return `<div class="sp-ctlbox${c.on_control ? ' is-on' : ''}">
    <label class="sp-f sp-check"><input type="checkbox" data-f="on_control"${c.on_control ? ' checked' : ''}><span>🎯 На контролі</span></label>
    <label class="sp-f sp-ctl-note"><span>Вид контролю / примітка</span>
      <input data-f="control_note" value="${esc(c.control_note)}" placeholder="контроль Голови, подовжено до …"></label>
    ${c.on_control && from ? `<p class="sp-ctl-from">${from}</p>` : ''}
  </div>`;
}

/** Напрям: віхи (чекліст із датами) і справи, що до нього належать. */
function projectBlockHTML(c) {
  const ms = milestonesOf(c).slice().sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const done = ms.filter((m) => m.done).length;
  const kids = childrenOf(c.id).sort((a, b) => isClosed(a) - isClosed(b) || String(a.deadline || '9').localeCompare(String(b.deadline || '9')));
  return `<section class="sp-block sp-proj">
    <h3>Віхи <span class="sp-muted">${ms.length ? `${done} з ${ms.length} виконано` : ''}</span></h3>
    <ul class="sp-ms">${ms.length ? ms.map((m) => {
      const n = !m.done && m.due ? daysLeft(m.due) : null;
      return `<li class="sp-ms-item${m.done ? ' is-done' : ''}${n !== null && n < 0 ? ' is-late' : ''}">
        <label><input type="checkbox" data-ms="${esc(m.id)}"${m.done ? ' checked' : ''}><span>${esc(m.title)}</span></label>
        <span class="sp-ms-due">${m.due ? fmtDate(m.due) : ''}</span>
        <button type="button" class="sp-ms-del" data-ms-del="${esc(m.id)}" title="Прибрати віху" aria-label="Прибрати віху">✕</button>
      </li>`;
    }).join('') : '<li class="sp-muted sp-none">Віх ще немає: додайте кроки з датами, і дошка покаже, що наступне.</li>'}</ul>
    <form class="sp-ms-form" id="spMsForm">
      <input name="title" placeholder="Віха: що має бути зроблено" autocomplete="off" required>
      <input name="due" type="date" aria-label="До якої дати">
      <button type="submit" class="sp-btn">Додати</button>
    </form>
    <h3>Пов'язані справи <span class="sp-muted">${kids.length || ''}</span></h3>
    <ul class="sp-kids">${kids.length ? kids.map((x) => {
      const kk = kindOf(x);
      return `<li><button type="button" class="sp-kid${isClosed(x) ? ' is-done' : ''}" data-open-case="${x.id}">
        <span>${CASE_KINDS[kk].icon} ${esc(x.in_no || CASE_KINDS[kk].short)}</span><b>${esc(x.subject)}</b><i>${stageLabel(x, x.stage)}${x.executor_name ? ' · ' + esc(x.executor_name) : ''}</i></button></li>`;
    }).join('') : '<li class="sp-muted sp-none">Справи привʼязуються до напряму в їхній картці: поле «Напрям».</li>'}</ul>
  </section>`;
}

/** Зберегти віхи напряму; вагомі зміни — рядком в історію. */
async function saveMilestones(c, list, note) {
  const ok = await saveCase(c.id, { milestones: list });
  if (ok !== false && note) await addEvent(c.id, { kind: 'system', body: note });
  if ($('spFields').contains(document.activeElement)) document.activeElement.blur();
  openCase(c.id, true);
}

/** Номер, що копіюється кліком у буфер обміну (лише сам номер). */
const copyHTML = (v, what) => `<button type="button" class="sp-copy" data-copy="${esc(v)}" title="Скопіювати ${esc(what)}: ${esc(v)}">${esc(v)}<span class="sp-copy-ico" aria-hidden="true">⧉</span></button>`;

async function copyText(v) {
  try { await navigator.clipboard.writeText(v); }
  catch (_) {
    // Запасний шлях: старі браузери й сторінки без дозволу на буфер
    const t = document.createElement('textarea');
    t.value = v; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } finally { t.remove(); }
  }
  toast(`Скопійовано: ${v}`);
}

function renderDrawerHead(c) {
  const k = kindOf(c);
  // Вх. № копіюється кліком — сам номер, без «Вх. №» (09.11.2026: для пошуку в АСКОД)
  $('spDrawerTitle').innerHTML = (c.in_no ? `Вх. № ${copyHTML(c.in_no, 'вх. №')}`
    : esc(`${CASE_KINDS[k].icon} ${CASE_KINDS[k].label}${k === 'event' && c.event_at ? ' · ' + fmtEventAt(c.event_at) : ''}`))
    // № проєкту відповіді — теж одним кліком (10.11.2026: для пошуку проєкту в АСКОД)
    + (c.project_no ? ` <span class="sp-head-proj">· проєкт № ${copyHTML(c.project_no, '№ проєкту')}</span>` : '');
  $('spDrawerSub').textContent = c.subject;
  const st = stagesOf(kindOf(c));
  const cur = st.findIndex((x) => x.key === c.stage);
  $('spStepper').innerHTML = st.map((s, i) => {
    const cls = i < cur ? 'is-past' : i === cur ? 'is-current' : '';
    return `<button type="button" class="sp-step ${cls}" data-stage="${s.key}" aria-pressed="${i === cur}">${s.label}</button>`;
  }).join('');
  renderRoute(c);
}

/** Маршрут у картці: виконавець → погоджувачі → підписант; над виконавцем — чого чекаємо від інших. */
function renderRoute(c) {
  const box = $('spRoute');
  if (!box) return;
  box.hidden = !hasRoute(c);
  if (box.hidden) return;
  const r = routeOf(c);
  const waits = (state.links || []).filter((l) => l.dir === 'out' && l.status === 'waiting');
  const okTxt = (d) => (d ? `✓ ${fmtDate(d).slice(0, 5)}` : 'чекає');
  const cur = !r.exec ? 'exec' : r.steps.findIndex((s) => !s.ok) >= 0 ? 's' + r.steps.findIndex((s) => !s.ok) : (!r.sign.ok ? 'sign' : '');
  const node = (key, role, who, ok, attrs, del) => `<li class="sp-rt-node${ok ? ' is-ok' : ''}${cur === key ? ' is-cur' : ''}">
      <button type="button" class="sp-rt-btn" ${attrs} aria-pressed="${!!ok}" title="${ok ? 'Погоджено ' + fmtDate(ok) + ' — натисніть, щоб зняти' : 'Натисніть, коли погоджено'}">
        <span class="sp-rt-role">${role}</span><b>${esc(who)}</b><i>${okTxt(ok)}</i></button>${del || ''}</li>`;
  const steps = r.steps.map((s, i) => node('s' + i, 'погоджує', s.who, s.ok, `data-rt="step" data-i="${i}"`,
    `<button type="button" class="sp-rt-del" data-rt-del="${i}" title="Прибрати ланку" aria-label="Прибрати ланку ${esc(s.who)}">✕</button>`)).join('<li class="sp-rt-arrow" aria-hidden="true">→</li>');
  box.innerHTML = `<div class="sp-rt-head"><b>🧭 Маршрут</b>
      <label class="sp-rt-sel">підписує <select data-rt-signer>${SIGNERS.map((s) => `<option${s === r.sign.who ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="sp-rt-sel">+ ланка <select data-rt-add><option value="">—</option>${APPROVERS.map((s) => `<option>${esc(s)}</option>`).join('')}<option value="*">Інше…</option></select></label>
      ${c.route ? '' : '<span class="sp-muted">типовий маршрут — збережеться після першої позначки</span>'}</div>
    ${waits.length ? `<p class="sp-rt-wait">⏳ Чекаємо: ${waits.map((l) => esc(`${LINK_SHORT[l.doc_kind] || 'документ'}${l.doc_no ? ' № ' + l.doc_no : ''}${l.who && l.who !== '—' ? ' — ' + l.who : ''}`)).join(' · ')}</p>` : ''}
    <ol class="sp-rt">
      ${node('exec', 'готує', c.executor_name || 'Виконавець', r.exec, 'data-rt="exec"')}
      <li class="sp-rt-arrow" aria-hidden="true">→</li>
      ${steps}${r.steps.length ? '<li class="sp-rt-arrow" aria-hidden="true">→</li>' : ''}
      ${node('sign', '🖋 підписує', r.sign.who, r.sign.ok, 'data-rt="sign"')}
    </ol>`;
}

/** Зберегти маршрут; етап підлаштовуємо (Готуємо / Погодження / На підписі) і пишемо подію в історію. */
async function saveRoute(c, r, note) {
  const patch = { route: r };
  const st = routeStage(c, r);
  if (st && st !== c.stage) patch.stage = st;
  patch.change_note = note;
  const ok = await saveCase(c.id, patch);
  if (ok && !patch.stage) await addEvent(c.id, { kind: 'system', body: '🧭 ' + note });
  if (!ok) toast('Маршрут не збережено: можливо, ще не застосовано migration_2026-11-10c_case_route.sql', true);
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
  Promise.all([loadEvents(id), loadLinks(id)]).then(() => { $('spDrawerBody').scrollTop = scroll; });
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
      const rc = state.cases.find((x) => x.id === id);
      const patch = { stage: 'work', change_note: `${from}: ${note}` };
      // Повернули — маршрут починається знову: позначки погодження знімаємо (сам ланцюжок лишається)
      if (rc?.route) patch.route = { ...rc.route, exec: null, steps: rc.route.steps.map((s) => ({ ...s, ok: null })), sign: { ...rc.route.sign, ok: null } };
      const ok = await saveCase(id, patch);
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
      <label class="sp-f sp-check sp-wide"><input type="checkbox" name="move" checked><span>Перевести справу в «СЗ надано» (для СЗ у робочому порядку) або «Закрито»</span></label>
      ${state.noLinks ? '' : `<label class="sp-f sp-check sp-wide"><input type="checkbox" name="wait" checked><span>⏳ Чекаємо відповіді — додати в «Зв'язки» (лише для СЗ)</span></label>`}`,
    run: async (id, fd) => {
      const kind = fd.get('doc_kind');
      const no = fd.get('doc_no').trim();
      await addEvent(id, { kind: 'outgoing', body: fd.get('note').trim() || '', doc_kind: kind, doc_no: no || null,
        addressee: fd.get('addressee').trim() || null, event_date: fd.get('date') || null });
      // СЗ головному виконавцю — чекаємо, поки він урахує: зв'язок «⏳», прив'язаний до його справи, якщо вона на дошці
      if (fd.get('wait') && ['sz', 'sz_work'].includes(kind)) {
        const lead = state.peers.find((p) => p.our_role === 'lead');
        await addLink(id, { direction: 'out', doc_kind: kind, doc_no: no || null, doc_date: fd.get('date') || null,
          counterpart: fd.get('addressee').trim() || null, about: fd.get('note').trim() || null, counterpart_case_id: lead?.id || null });
      }
      if (fd.get('move')) {
        const patch = { stage: kind === 'sz_work' ? 'sz_sent' : 'done' };
        state.skipAutoLink = !fd.get('wait');
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
        project_no: c.project_no || null,
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
  link_out: {
    title: '📤 Ми надіслали — чекаємо відповіді',
    fields: (c) => linkFields(c, 'out'),
    run: (id, fd) => addLink(id, linkRow(fd, 'out'))
  },
  link_in: {
    title: '📥 Нам надіслали — врахувати',
    fields: (c) => linkFields(c, 'in'),
    run: (id, fd) => addLink(id, linkRow(fd, 'in'))
  },
  reminder: {
    title: 'Нагадування',
    fields: () => `
      <label class="sp-f"><span>Коли нагадати *</span><input type="date" name="date" required></label>
      <label class="sp-f sp-wide"><span>Про що *</span><input name="note" required placeholder="перевірити, чи головний виконавець відправив відповідь"></label>`,
    run: (id, fd) => addEvent(id, { kind: 'reminder', body: fd.get('note').trim(), due_date: fd.get('date'), done: false })
  }
};

/**
 * Форма зв'язку. «Справа другої сторони» — та сама справа в іншому відділі (dept_case_peers)
 * або інша справа нашого відділу: тоді зв'язок видно з обох карток.
 */
/**
 * Що форма зв'язку бере зі справи (09.11.2026, користувач: «чому вона не заповнена, номер…»):
 * № — № проєкту нашої СЗ в АСКОД (project_no), поки немає зареєстрованого; кому — головний
 * виконавець; дата й «про що» — з останнього «📤 Відправлено документ»; чекаємо до — строк справи.
 */
function linkDefaults(c, dir) {
  const out = dir === 'out';
  const sent = (state.openId === c.id ? state.events : []).filter((e) => e.kind === 'outgoing').slice(-1)[0];
  const n = daysLeft(c.deadline);
  return {
    doc_kind: sent && LINK_DOC[sent.doc_kind] ? sent.doc_kind : 'sz',
    doc_no: out ? (sent?.doc_no || c.project_no || '') : '',
    doc_date: (out && (sent?.event_date || String(sent?.created_at || '').slice(0, 10))) || todayISO(),
    counterpart: out ? (sent?.addressee || c.lead_unit || '') : '',
    about: out ? (sent?.body || '') : '',
    wait_until: out && n !== null && n >= 0 ? c.deadline.slice(0, 10) : ''
  };
}

function linkFields(c, dir) {
  const out = dir === 'out';
  const d = linkDefaults(c, dir);
  const peerOpts = state.peers.map((p) => `<option value="${p.id}"${out && p.our_role === 'lead' ? ' selected' : ''}>відділ ${esc(p.department)} — та сама справа${p.executor_name ? ' (' + esc(p.executor_name) + ')' : ''}</option>`);
  const ownOpts = state.cases.filter((x) => x.id !== c.id && x.stage !== 'done')
    .map((x) => `<option value="${x.id}">${esc(x.in_no || CASE_KINDS[kindOf(x)].short)} — ${esc(x.subject.length > 50 ? x.subject.slice(0, 48) + '…' : x.subject)}</option>`);
  return `
    <label class="sp-f"><span>Що</span><select name="doc_kind">${Object.entries(LINK_DOC).map(([k, v]) => `<option value="${k}"${k === d.doc_kind ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="sp-f"><span>№ ${out ? 'нашого документа' : 'їхнього документа'}</span><input name="doc_no" value="${esc(d.doc_no)}" placeholder="${out ? 'Н(СЛ)-… або зареєстрований №' : '№ їхньої СЗ'}"></label>
    <label class="sp-f"><span>Дата</span><input type="date" name="doc_date" value="${esc(d.doc_date)}"></label>
    <label class="sp-f"><span>${out ? 'Кому' : 'Від кого'}</span><input name="counterpart" list="spLeadUnits" placeholder="підрозділ або людина" value="${esc(d.counterpart)}"></label>
    ${out ? `<label class="sp-f"><span>Чекаємо до</span><input type="date" name="wait_until" value="${esc(d.wait_until)}"></label>` : ''}
    <label class="sp-f sp-wide"><span>Про що</span><input name="about" value="${esc(d.about)}" placeholder="${out ? 'позиція відділу, дані, пропозиції до проєкту' : 'що просять урахувати'}"></label>
    <label class="sp-f sp-wide"><span>Справа другої сторони на дошці</span><select name="counterpart_case_id">
      <option value="">— немає на дошці —</option>${peerOpts.join('')}${ownOpts.length ? `<optgroup label="Справи нашого відділу">${ownOpts.join('')}</optgroup>` : ''}</select></label>
    <p class="sp-f sp-wide sp-muted">${out ? 'На картці з\'явиться «⏳», доки не відмітите «Відповідь є».' : 'На картці з\'явиться «📥», доки не відмітите «Враховано».'}
      Якщо вибрати справу другої сторони, зв'язок побачать і там.</p>`;
}

function linkRow(fd, dir) {
  const v = (k) => (String(fd.get(k) || '').trim() || null);
  const c = state.cases.find((x) => x.id === state.openId);
  // № проєкту відповіді — зі справи сам; окремого поля в формі немає (його плутали з вх. №)
  return { direction: dir, doc_kind: v('doc_kind') || 'sz', doc_no: v('doc_no'), doc_date: v('doc_date'), counterpart: v('counterpart'),
    project_no: c?.project_no || null, about: v('about'), wait_until: dir === 'out' ? v('wait_until') : null, counterpart_case_id: v('counterpart_case_id') };
}

/**
 * Справу перевели в «СЗ надано» (кнопкою, перетягуванням чи кроком), а зв'язку «⏳» ще немає —
 * заводимо його сам із даних справи. «📤 Відправлено документ» додає зв'язок раніше, тож дубля не буде.
 */
async function autoLinkSzSent(c) {
  // «📤 Відправлено документ» зі знятою галочкою «Чекаємо відповіді» — людина сказала, що зв'язок не потрібен
  if (state.skipAutoLink) { state.skipAutoLink = false; return; }
  if (state.noLinks) return;
  // Вхідна службова: наша СЗ — кінцева відповідь, чекати нема на кого (10.11.2026: зв'язок «⏳» на власний
  // відділ після «СЗ надано» на 10-12/749-26)
  if (isSzIn(c)) return;
  if (DEMO) {
    if (state.demoLinks.some((l) => l.case_id === c.id && l.direction === 'out')) return;
  } else {
    const { data, error } = await state.sb.from('dept_case_links').select('id').eq('case_id', c.id).eq('direction', 'out').limit(1);
    if (error || data?.length) return;
  }
  if (state.openId === c.id && !state.events.length) await loadEvents(c.id);
  const d = linkDefaults(c, 'out');
  await addLink(c.id, { direction: 'out', doc_kind: d.doc_kind, doc_no: d.doc_no || null, doc_date: d.doc_date, counterpart: d.counterpart || null,
    project_no: c.project_no || null, about: d.about || null, wait_until: d.wait_until || null,
    counterpart_case_id: state.openId === c.id ? (state.peers.find((p) => p.our_role === 'lead')?.id || null) : null });
  toast('⏳ Додано зв\'язок: чекаємо, поки головний виконавець урахує СЗ');
}

function skodDescription(c) {
  const out = state.events.filter((e) => e.kind === 'outgoing').slice(-1)[0];
  const done = out ? ` — ${(DOC_KIND[out.doc_kind] || 'документ').toLowerCase()}${out.doc_no ? ' № ' + out.doc_no : ''}${out.addressee ? ' → ' + out.addressee : ''}`
    : (c.out_no ? ` — лист вих. № ${c.out_no}` : '');
  return `${c.in_no ? 'Вх. № ' + c.in_no + ': ' : ''}${c.subject}${done}`;
}

/**
 * № проєкту відповіді зареєстровано в АСКОД — робота зроблена: записуємо її в СКО-Д сама справа
 * (вказівка користувача 04.11.2026: «щоб це було автоматично»). Параметри — як у записів, що
 * вносять через кабінет: 1 год, середня складність, «01 — Лист», справа номенклатури за guessCategory.
 * Якщо запис із цим № проєкту вже є (внесли через кабінет або кнопкою 🕒) — нічого не дублюємо.
 * Поправити час чи складність — в особистому кабінеті.
 */
async function autoSkod(id) {
  const c = state.cases.find((x) => x.id === id);
  if (!c?.project_no) return;
  if (!DEMO) {
    const { data: had } = await state.sb.from('skod_logs').select('id')
      .eq('user_id', state.me.id).eq('project_no', c.project_no).limit(1);
    if (had?.length) return;
  }
  const minutes = 60, sev = 'medium';
  const category = guessCategory(c);
  const now = new Date();
  const row = {
    user_name: myName(),
    department: state.profile?.Section || state.dept,
    log_date: todayISO(),
    start_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`,
    duration_minutes: minutes,
    branch: 'askod',
    task_type: c.reply_kind === 'pi' ? '47 — Лист-запит' : '01 — Лист',
    category,
    severity_level: sev,
    complexity_coefficient: SKOD_COEF[sev],
    score: parseFloat(((minutes / 60) * SKOD_COEF[sev]).toFixed(2)),
    status: 'completed',
    description: skodDescription(c),
    askod_reg_number: c.in_no || null,
    reply_to_number: c.out_no || null,
    project_no: c.project_no,
    include_37d: false
  };
  if (!DEMO) {
    const { error } = await state.sb.from('skod_logs').insert([{ ...row, user_id: state.me.id }]);
    if (error) return toast('СКО-Д не записано: ' + error.message + ' — натисніть 🕒', true);
  }
  await addEvent(id, { kind: 'system', body: `Зараховано в СКО-Д: 1 год, ${category.split(' — ')[0]} (автоматично за № проєкту)` });
  toast('Зараховано в СКО-Д: 1 год. Час і складність можна змінити в особистому кабінеті');
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

/** Діалог нової справи: показати поля обраного виду (атрибут data-for на полях). */
function paintNewKind() {
  const kind = new FormData($('spNewForm')).get('case_kind') || 'askod';
  document.querySelectorAll('#spNewForm [data-for]').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(kind); });
  $('spNewSubjLbl').textContent = { askod: 'Суть *', task: 'Що зробити *', event: 'Назва заходу *', project: 'Назва напряму *' }[kind];
  $('spNewDeadlineLbl').textContent = kind === 'project' ? 'Ключова дата' : 'Строк';
  $('spNewCorrLbl').textContent = kind === 'event' ? 'Організатор' : 'Кореспондент';
  $('spNewTitle').textContent = kind === 'askod' ? 'Нова справа' : `Нова справа: ${CASE_KINDS[kind].label.toLowerCase()}`;
}

async function createCase(form) {
  const fd = new FormData(form);
  const kind = fd.get('case_kind') || 'askod';
  const eventAt = kind === 'event' && fd.get('event_at') ? new Date(fd.get('event_at')).toISOString() : null;
  const row = {
    department: state.dept,
    case_kind: kind,
    in_no: kind === 'askod' ? ((fd.get('in_no') || '').trim() || null) : null,
    subject: (fd.get('subject') || '').trim(),
    correspondent: ['askod', 'event'].includes(kind) ? ((fd.get('correspondent') || '').trim() || null) : null,
    // Захід: дата заходу — і строк (сортування, «горить»)
    deadline: kind === 'event' ? (fd.get('event_at') ? String(fd.get('event_at')).slice(0, 10) : null) : (fd.get('deadline') || null),
    event_at: eventAt,
    event_place: kind === 'event' ? ((fd.get('event_place') || '').trim() || null) : null,
    assigned_by: kind === 'task' ? ((fd.get('assigned_by') || '').trim() || null) : null,
    reply_kind: kind === 'askod' ? (fd.get('reply_kind') || 'letter') : 'other',
    executor_name: fd.get('executor_name') || null,
    our_role: kind === 'askod' ? (fd.get('our_role') || null) : null,
    // Головний виконавець — у документів АСКОД і в напрямів/проєктів (з 04.11.2026: напрям може вести, напр., Аналітичне управління)
    lead_unit: kind === 'askod' || kind === 'project' ? ((fd.get('lead_unit') || '').trim() || null) : null,
    stage: fd.get('executor_name') && kind !== 'event' ? 'work' : 'new',
    source: 'manual',
    created_by_name: myName()
  };
  if (!row.subject) return toast('Вкажіть суть справи', true);
  if (kind === 'event' && !eventAt) return toast('Вкажіть дату й час заходу', true);
  lsSet('spravy-new-kind', kind);
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
  $('spKind').value = lsGet('spravy-kind') || 'all';
  state.kind = $('spKind').value;
  $('spKind').addEventListener('change', (e) => {
    state.kind = e.target.value;
    lsSet('spravy-kind', state.kind);
    if (!stagesOf(state.kind).some((s) => s.key === state.mobileStage)) state.mobileStage = 'work';
    render();
  });
  // Діалог нової справи: вид → свій набір полів
  $('spNewKinds').addEventListener('change', paintNewKind);
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
    $('spNewAssigners').innerHTML = state.leaders.map((n) => `<option value="${esc(n)}">`).join('');
    // Вид за замовчуванням — той, що обрано у фільтрі (дивлюся заходи → заводжу захід)
    const kind = state.kind !== 'all' ? state.kind : (lsGet('spravy-new-kind') || 'askod');
    const radio = $('spNewKinds').querySelector(`input[value="${kind}"]`);
    if (radio) radio.checked = true;
    paintNewKind();
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
    // № проєкту на картці дошки — копіюється, картка при цьому не відкривається
    const cp = e.target.closest('[data-copy]');
    if (cp) { e.preventDefault(); e.stopPropagation(); return copyText(cp.dataset.copy); }
    const fold = e.target.closest('[data-fold]') || (e.target.closest('.sp-col.is-folded .sp-col-head') && e.target.closest('.sp-col')?.querySelector('[data-fold]'));
    if (fold) {
      const f = colsFolded();
      f[fold.dataset.fold] = !f[fold.dataset.fold];
      lsSet('spravy-cols-folded', JSON.stringify(f));
      render();
      return;
    }
    const lane = e.target.closest('[data-lane]');
    if (lane) {
      const closed = lanesClosed();
      closed[lane.dataset.lane] = !closed[lane.dataset.lane];
      lsSet('spravy-lanes-closed', JSON.stringify(closed));
      render();
      return;
    }
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
      saveCase(c.id, patch).then((ok) => ok !== false && toast(`${c.in_no || 'Справа'} → ${stageLabel(c, to)}`));
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
    if (c && kindOf(c) !== 'askod' && ['signing', 'sz_sent'].includes(col.dataset.drop)) {
      toast(`${CASE_KINDS[kindOf(c)].label}: етапів «На підписі» і «СЗ надано» немає`, true);
      return;
    }
    if (c && c.stage !== col.dataset.drop) saveCase(id, { stage: col.dataset.drop });
  });

  // Картка справи
  const dlg = $('spDrawer');
  $('spClose').addEventListener('click', () => dlg.close());
  // Номер у заголовку картки (і № проєкту в «Зв'язках») — копіюється кліком
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    e.preventDefault();
    copyText(b.dataset.copy);
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { state.openId = null; });
  $('spRoute').addEventListener('click', (e) => {
    const c = state.cases.find((x) => x.id === state.openId);
    if (!c) return;
    const r = JSON.parse(JSON.stringify(routeOf(c)));
    const del = e.target.closest('[data-rt-del]');
    if (del) {
      const s = r.steps.splice(+del.dataset.rtDel, 1)[0];
      return saveRoute(c, r, `Маршрут: прибрано ланку «${s?.who || ''}»`);
    }
    const b = e.target.closest('[data-rt]');
    if (!b) return;
    const today = todayISO();
    if (b.dataset.rt === 'exec') {
      r.exec = r.exec ? null : today;
      return saveRoute(c, r, r.exec ? 'Виконавець погодив — документ на погодження' : 'Знято позначку виконавця');
    }
    if (b.dataset.rt === 'step') {
      const s = r.steps[+b.dataset.i];
      s.ok = s.ok ? null : today;
      if (s.ok && !r.exec) r.exec = today;
      return saveRoute(c, r, s.ok ? `Погоджено: ${s.who}` : `Знято погодження: ${s.who}`);
    }
    if (b.dataset.rt === 'sign') {
      r.sign.ok = r.sign.ok ? null : today;
      if (r.sign.ok) { r.exec = r.exec || today; r.steps.forEach((s) => { s.ok = s.ok || today; }); }
      return saveRoute(c, r, r.sign.ok ? `Підписано: ${r.sign.who}` : `Знято позначку підпису: ${r.sign.who}`);
    }
  });
  $('spRoute').addEventListener('change', (e) => {
    const c = state.cases.find((x) => x.id === state.openId);
    if (!c) return;
    const r = JSON.parse(JSON.stringify(routeOf(c)));
    if (e.target.matches('[data-rt-signer]')) {
      r.sign = { who: e.target.value, ok: null };
      return saveRoute(c, r, `Маршрут: підписує ${e.target.value}`);
    }
    if (e.target.matches('[data-rt-add]')) {
      let who = e.target.value;
      if (who === '*') who = (prompt('Хто погоджує (посада або підрозділ)?') || '').trim();
      e.target.value = '';
      if (!who) return;
      r.steps.push({ who, ok: null });
      return saveRoute(c, r, `Маршрут: додано ланку «${who}»`);
    }
  });
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
    // Захід: час — в ISO; дата заходу стає й строком (сортування, «горить», нагадування)
    if (f === 'event_at') {
      patch.event_at = v ? new Date(v).toISOString() : null;
      if (v) patch.deadline = v.slice(0, 10);
    }
    // Вид справи змінено: «На підписі» / «СЗ надано» є лише в АСКОД; поля картки — інші.
    // «На контролі» — перемалювати блок (підсвітка й стан за контролькою)
    if (f === 'case_kind' || f === 'on_control') {
      const cur = state.cases.find((x) => x.id === state.openId);
      if (v !== 'askod' && ['signing', 'sz_sent'].includes(cur?.stage)) patch.stage = 'work';
      el.blur();
      saveCase(state.openId, patch).then(() => openCase(state.openId, true));
      return;
    }
    // № проєкту відповіді зареєстровано в АСКОД — робота зроблена: записуємо її в СКО-Д автоматично (autoSkod),
    // інакше в особистому кабінеті її не видно (04.11.2026: два проєкти, оформлені тут, не потрапили в кабінет)
    const before = state.cases.find((x) => x.id === state.openId);
    const askSkod = f === 'project_no' && v && v !== (before?.project_no || null);
    const caseId = state.openId;
    // Вхідна службова з № проєкту нашої СЗ-відповіді — справу виконано: одразу «Закрито» (вимога користувача
    // 10.11.2026: «службова повинна бути закрита, номер проекту відповіді вже є»)
    if (askSkod && before && isSzIn(before) && before.stage !== 'done') {
      patch.stage = 'done';
      patch.change_note = `СЗ-відповідь, проєкт № ${v}`;
    }
    saveCase(caseId, patch).then((ok) => { if (ok && askSkod) autoSkod(caseId); });
  });
  // Напрям: віхи й перехід до пов'язаної справи
  $('spFields').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-ms]');
    const c = state.cases.find((x) => x.id === state.openId);
    if (!cb || !c) return;
    const list = milestonesOf(c).map((m) => (m.id === cb.dataset.ms ? { ...m, done: cb.checked } : m));
    const m = list.find((x) => x.id === cb.dataset.ms);
    saveMilestones(c, list, `${cb.checked ? 'Віху виконано' : 'Віху знову відкрито'}: ${m?.title || ''}`);
  });
  $('spFields').addEventListener('click', (e) => {
    const kid = e.target.closest('[data-open-case]');
    if (kid) return openCase(kid.dataset.openCase);
    const del = e.target.closest('[data-ms-del]');
    const c = state.cases.find((x) => x.id === state.openId);
    if (!del || !c) return;
    const m = milestonesOf(c).find((x) => x.id === del.dataset.msDel);
    if (!m || !confirm(`Прибрати віху «${m.title}»?`)) return;
    saveMilestones(c, milestonesOf(c).filter((x) => x.id !== m.id), `Віху прибрано: ${m.title}`);
  });
  $('spFields').addEventListener('submit', (e) => {
    if (e.target.id !== 'spMsForm') return;
    e.preventDefault();
    const c = state.cases.find((x) => x.id === state.openId);
    const fd = new FormData(e.target);
    const title = String(fd.get('title') || '').trim();
    if (!c || !title) return;
    const due = fd.get('due') || null;
    const list = [...milestonesOf(c), { id: crypto.randomUUID().slice(0, 8), title, due, done: false }];
    e.target.reset();
    saveMilestones(c, list, `Нова віха: ${title}${due ? ' — до ' + fmtDate(due) : ''}`);
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
  // Зв'язки: стан, «що відповіли / як враховано», прибрати, перейти до справи другої сторони
  $('spLinks').addEventListener('change', (e) => {
    const li = e.target.closest('[data-link]');
    if (!li || !state.openId) return;
    if (e.target.classList.contains('sp-link-status')) updateLink(state.openId, li.dataset.link, { status: e.target.value });
    if (e.target.classList.contains('sp-link-ans')) updateLink(state.openId, li.dataset.link, { answer_note: e.target.value.trim() || null });
  });
  $('spLinks').addEventListener('click', (e) => {
    const go = e.target.closest('[data-open-case]');
    if (go) return openCase(go.dataset.openCase);
    const li = e.target.closest('[data-link]');
    if (li && e.target.closest('[data-link-del]') && state.openId) deleteLink(state.openId, li.dataset.link);
  });
  $('spLinkBtns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) openAction(b.dataset.act);
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
