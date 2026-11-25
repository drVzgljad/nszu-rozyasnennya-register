/**
 * Голосове вікно порталу (19.11.2026). Користувач: «щоб коли ти зайшов в голосовий чат, була можливість
 * серфити по порталу та інтернету, закривати вікна. Ще зроби маркер "в ефірі" поверх всіх вікон».
 *
 * Чому окреме вікно. Рушій голосу (../zviazok/voice.js — WebRTC і канал Realtime) живе в документі:
 * перейшов на іншу сторінку чи закрив вкладку — з'єднання рветься. Тож голос тримає окреме вікно
 * браузера, яке живе своїм життям, а сторінки порталу лише показують стан і шлють команди
 * (./link.js, BroadcastChannel). Відкидали: PiP із вкладки розділу (закривається разом зі сторінкою,
 * що його відкрила), обгортку порталу в iframe (ламає навігацію, сторонні сайти в iframe не йдуть,
 * а закриття вкладки однаково рве розмову), фоновий воркер (WebRTC і мікрофона там немає).
 *
 * З 25.11.2026 вікно за замовчуванням — лише значок «В ефірі» (./pill.js) у лівому нижньому куті
 * («мені не дуже подобається вікно голосового чату, лишив би тільки маленьке, щоб було поверх усіх вікон»).
 * - Перший будь-який клік у вікні закріплює значок поверх усіх вікон і програм (./pip.js; браузер
 *   відкриває таке вікно лише на клік у сторінці, що тримає голос). Після цього голосове вікно можна згорнути.
 * - ⤢ — повна панель (та сама, що в «Справах», ../spravy/voice.js, режим win: учасники, стук і гості,
 *   дорадча кімната, показ екрана, нарада, мікрофон). Розгортається й сама, коли щось вимагає дії
 *   (кличуть у дорадчу, стукають, показ треба підтвердити кліком, немає зв'язку), і з вкладок (⧉).
 * - Намір — з адреси: ?room=all [&mic=1] (кімната департаменту), ?door=…, ?door_dept=…, ?voice_invite=…,
 *   ?knock=<відділ>, ?tet=…; без параметрів — кімната свого відділу. Відкрите вікно отримує намір командою 'intent'.
 * - Команди вкладок: 'mic', 'deaf', 'leave', 'focus' (показати й розгорнути), 'intent', 'screen' — почати
 *   показ (браузер вимагає клік тут, панель попросить), 'screenwin' — екран спікера в окремому вікні.
 * - Вийшли з кімнати — вікно закривається. Закрили вікно — вийшли (рушій сам виходить на pagehide).
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { initVoice } from '../spravy/voice.js?v=20261125p';
import { BUS, HEARTBEAT, COMPACT } from './link.js?v=20261125d';
import { createPip } from './pip.js?v=20261125e';
import { PILL_CSS, pillHTML } from './pill.js?v=20261125e';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';

// Ті самі відділи, що в spravy.js (DEPARTMENTS) і cabinet-voice.js: кімната = хеш назви відділу
const DEPARTMENTS = [
  'стратегічного розвитку програми медичних гарантій',
  'наукова та клінічна експертиза',
  'розвиток програми реімбурсації',
  'взаємодія з надавачами медичних послуг',
  'розрахунок вартості медичних послуг',
  'робота з електронними медичними даними'
];
const FULL = { w: 440, h: 700 };   // повна панель (внутрішній розмір)

const $ = (id) => document.getElementById(id);
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(BUS) : null;
let api = null;
let pip = null;
let speaking = [];
let closed = false;
let mode = 'compact';     // 'compact' — лише значок; 'full' — повна панель
let pipByUser = false;    // людина сама закрила значок поверх усіх — більше не відкриваємо його самі
let needed = false;       // панель уже розгортали через «щось вимагає дії»

{
  const st = document.createElement('style');
  st.textContent = PILL_CSS;
  document.head.append(st);
}

function toast(text, bad) {
  let t = document.getElementById('spToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'spToast';
    t.className = 'sp-toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.toggle('is-bad', !!bad);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3600);
}

function message(html) {
  const m = $('vwMsg');
  m.innerHTML = html;
  m.hidden = false;
  setMode('full');
}

/* ───────── розмір вікна: значок або повна панель ───────── */

function place(w, h, corner) {
  // resizeTo задає зовнішній розмір — додаємо рамку й заголовок вікна
  const dw = Math.max(0, window.outerWidth - window.innerWidth);
  const dh = Math.max(0, window.outerHeight - window.innerHeight);
  const s = window.screen;
  const ax = s.availLeft || 0, ay = s.availTop || 0, aw = s.availWidth || 1280, ah = s.availHeight || 800;
  const ow = Math.min(w + dw, aw), oh = Math.min(h + dh, ah);
  try {
    window.resizeTo(ow, oh);
    if (corner) window.moveTo(ax + 16, ay + ah - oh - 16);
    else if (window.screenY + oh > ay + ah) window.moveTo(window.screenX, Math.max(ay, ay + ah - oh - 16));
  } catch (_) { /* вікно відкрили не скриптом — розмір міняти не можна */ }
}

function setMode(next) {
  if (next === mode) return;
  mode = next;
  document.body.classList.toggle('is-compact', mode === 'compact');
  if (mode === 'full') place(FULL.w, FULL.h, false);
  else place(COMPACT.w, COMPACT.h, true);
  tip();
}

/** Підказка під значком у компактному вікні. */
function tip() {
  const el = $('vwTip');
  if (!el) return;
  let t = '';
  if (pip?.isOpen) t = '📌 Значок — поверх усіх вікон. Це вікно можна згорнути (—): розмова триває.';
  else if (pip?.supported) t = '📌 Клацніть тут будь-де — значок стане поверх усіх вікон.';
  else t = 'Значок «В ефірі» видно й на кожній сторінці порталу.';
  el.textContent = t;
  el.hidden = mode !== 'compact';
}

/* ───────── стан для вкладок, значка й бейджа ───────── */

function state() {
  const s = api?.state;
  const inRoom = !!(s && s.inRoom && s.status === 'live');
  return {
    alive: !closed,
    inRoom,
    status: s?.status || 'idle',
    label: api?.label || 'Голос',
    topic: s?.topic || '',
    dept: api?.dept || '',
    muted: s ? !!s.muted : true,
    deaf: !!s?.deaf,
    count: s?.members?.length || 0,
    // Хто в кімнаті — для бейджа й значка («де я і хто там»)
    people: (s?.members || []).map((m) => (m.me ? `${m.name || 'ви'} (ви)` : m.name || 'Без імені')),
    speaking,
    needGesture: !!s?.needGesture,
    tet: api?.tet || '',          // з ким дорадча кімната (25.11.2026)
    tetAsk: api?.tetAsk || '',    // хто кличе на тет-а-тет (вкладка знімає своє запрошення, коли тут відповіли)
    pip: !!pip?.isOpen,           // значок висить поверх усіх вікон — бейдж на сторінках порталу не потрібен
    sharing: !!s?.sharing,        // я показую екран (кнопка у вкладці стає «Зупинити показ»)
    canShare: !!(s?.canShare && s?.inRoom)
  };
}

let lastSent = '';
let lastPill = '';
function publish(force = false) {
  const st = state();
  // Щось вимагає дії в панелі — розгортаємо її (один раз на кожну нову потребу)
  const need = !!api?.needs;
  if (need && !needed) setMode('full');
  needed = need;
  // Вікно щойно відкрилось: одна велика кнопка «Закріпити» — після неї лишається лише значок поверх усіх вікон
  const pinFirst = !!(pip?.supported && !pip.isOpen && !pipByUser && st.inRoom && mode === 'compact');
  const pill = pinFirst
    ? '<button type="button" class="vw-pinbig" data-pm="pin" title="Значок «В ефірі» висітиме поверх усіх вікон і програм; це вікно потім можна згорнути">📌 Закріпити значок «В ефірі» поверх усіх вікон</button>'
    : pillHTML(st, { pin: !!(pip?.supported && !pip.isOpen && st.inRoom) });
  if (pill !== lastPill) { lastPill = pill; $('vwPill').innerHTML = pill; }
  const key = JSON.stringify(st);
  if (!force && key === lastSent) return;
  lastSent = key;
  bc?.postMessage({ type: 'state', ...st });
  pip?.update();
  document.title = `${st.inRoom ? (st.muted ? '🔇' : '🔴') + ' В ефірі' : '🎙 Голос'} · ${st.label}`;
}

/** Хто говорить: рушій підсвічує .is-speaking на рядках панелі (data-vk) — читаємо звідти. */
function readSpeaking() {
  const s = api?.state;
  if (!s) return;
  const keys = new Set([...document.querySelectorAll('#spVoice [data-vk].is-speaking')].map((el) => el.dataset.vk));
  const names = (s.members || []).filter((m) => keys.has(m.key)).map((m) => (m.me ? 'ви' : (m.name || '').split(/\s+/).slice(0, 2).join(' ')));
  if (names.join('|') !== speaking.join('|')) { speaking = names; publish(); }
}

/** Кнопки значка (тут і поверх усіх вікон). */
async function act(cmd) {
  if (!api) return;
  api.unlock();
  if (cmd === 'mic') {
    // Звук вимкнено — «мікрофон» повертає і звук, і мікрофон (як просили: швидко ввімкнути голос)
    if (api.state?.deaf) await api.toggleDeaf();
    else await api.toggleMic();
  } else if (cmd === 'panel') {
    try { window.focus(); } catch (_) { /* браузер не дав */ }
    setMode(mode === 'full' && document.hasFocus() ? 'compact' : 'full');
  } else if (cmd === 'screen') {
    await api.share();
  } else if (cmd === 'pin') {
    pipByUser = false;
    await pip?.open();
  } else if (cmd === 'leave') {
    try { window.focus(); } catch (_) { /* браузер не дав */ }
    await leave();
  }
  publish(true);
}

async function onCmd(m) {
  if (!api || m?.type !== 'cmd') return;
  if (m.cmd === 'mic') await api.toggleMic();
  else if (m.cmd === 'deaf') await api.toggleDeaf();
  else if (m.cmd === 'leave') await leave();
  else if (m.cmd === 'focus') { try { window.focus(); } catch (_) { /* браузер не дав */ } setMode('full'); pip?.update(); }
  else if (m.cmd === 'intent') await api.intent(m.params || {});
  else if (m.cmd === 'screen') await api.share();                       // зупинити показ із вкладки
  else if (m.cmd === 'screenwin') api.openScreen();                     // «⧉ Дивитися» у вкладці
  publish(true);
}

async function leave() {
  const ok = await api.leave();
  if (ok === false) return;
}

/** Вийшли з кімнати (тут, у значку чи з вкладки) — вікно закривається. */
function onLeave() {
  closed = true;
  publish(true);
  pip?.close();
  window.close();
  // Вікно відкрили не скриптом (набрали адресу) — закрити себе браузер не дасть
  setTimeout(() => {
    $('vwMore').hidden = true;
    message('Ви вийшли з кімнати. Це вікно можна закрити.<br><button type="button" class="spv-btn spv-join" id="vwAgain">🎙 Зайти знову</button>');
    $('vwAgain')?.addEventListener('click', () => location.reload());
  }, 300);
}

/** Голос забрала вкладка порталу (там не відкрилось вікно — запасний шлях). */
function onLost() {
  if (closed) return;
  closed = true;
  publish(true);
  pip?.close();
  toast('Голос перейшов у вкладку порталу');
  setTimeout(() => window.close(), 800);
  setTimeout(() => { $('vwMore').hidden = true; message('Голос перейшов у вкладку порталу. Це вікно можна закрити.'); }, 1200);
}

async function start() {
  document.body.classList.add('is-compact');
  if (!window.RTCPeerConnection) return message('Цей браузер не вміє голосових кімнат. Спробуйте Chrome, Edge або Firefox.');
  const sb = window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY));
  const { data: { session } } = await sb.auth.getSession();
  const me = session?.user;
  if (!me) return message('Увійдіть на порталі (кнопка «Увійти» у шапці будь-якої сторінки), потім відкрийте голос ще раз.');
  const { data: p } = await sb.from('profiles').select('*').eq('id', me.id).single();
  if (!p || p.role === 'guest') return message('Голосові кімнати — для співробітників департаменту.');
  const dept = DEPARTMENTS.includes(p.Section) ? p.Section : '';

  api = initVoice({
    sb, me, name: p.full_name || me.email, dept, role: p.role || '', depts: DEPARTMENTS, toast,
    win: true,
    onState: () => publish(),
    onLeave,
    onLost
  });
  if (!api) return message('Не вдалося запустити голос.');

  bc?.addEventListener('message', (e) => {
    if (e.data?.type === 'ask') publish(true);
    else onCmd(e.data);
  });
  setInterval(() => publish(true), HEARTBEAT);
  setInterval(readSpeaking, 250);
  window.addEventListener('pagehide', () => { closed = true; bc?.postMessage({ type: 'state', alive: false }); });

  // Значок поверх усіх вікон
  pip = createPip({
    getState: state,
    act,
    onToggle: (on) => {
      if (!on && !closed) pipByUser = true;   // закрили значок самі — не нав'язуємо його знову
      tip();
      publish(true);
    }
  });
  // Перший будь-який клік у вікні закріплює значок поверх усіх (браузер дозволяє лише на клік)
  document.addEventListener('pointerdown', (e) => {
    if (!pip.supported || pip.isOpen || pipByUser || closed || !state().inRoom) return;
    if (e.target.closest?.('[data-pm="leave"], [data-pm="pin"]')) return;
    pip.open();
  }, true);
  // Вкладка, що відкрила вікно, захоплює екран у своєму кліку й віддає доріжку сюди
  window.__pmgVoiceShare = (t) => api.shareTrack(t);
  $('vwPill').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pm]');
    if (b) act(b.dataset.pm);
  });
  tip();
  publish(true);
}

start().catch((e) => message('Голос не запустився: ' + (e?.message || e)));
