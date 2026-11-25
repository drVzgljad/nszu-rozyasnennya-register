/**
 * Голосова кімната відділу — постійна «кімната» на кшталт Discord у розділі «Справи».
 *
 * Відкрив сторінку — і ти в кімнаті свого відділу: видно, хто ще тут, чути тих,
 * хто говорить. Мікрофон за замовчуванням ВИМКНЕНИЙ — щоб розмова в кабінеті
 * випадково не пішла колегам; говорити — кнопкою «Мікрофон». «Вийти» запамʼятовується
 * в цьому браузері: наступного разу сторінка лише покаже, хто в кімнаті.
 *
 * Тут — лише ПАНЕЛЬ «Справ» (#spVoice). Сам голос — спільний рушій порталу
 * ../zviazok/voice.js (той самий, що в «Чаті департаменту»; зведено 03.11.2026):
 * WebRTC кожен з кожним, рукостискання й присутність — приватним каналом Realtime,
 * запасний шлях — Cloudflare TURN. Виправлення з'єднань — там, а не тут.
 * - Канал: 'voice:dept:<хеш відділу>' (RLS migration_2026-11-03_voice_room.sql) або
 *   'voice:all' — кімната департаменту (перемикач у spravy.js, …03b_voice_room_all.sql).
 *   Кімната департаменту — та сама, що голос головної стрічки «Чату департаменту».
 * - «Вийти» = режим рушія «лише дивлюся» (бачиш, хто в кімнаті; тебе не видно й не чути).
 * - 🎧 «Вимкнути звук» глушить і мікрофон, «Увімкнути звук» повертає мікрофон у
 *   попередній стан — це вміє рушій.
 * - Панель стоїть і в «Справах», і в особистому кабінеті (10.11.2026). Рушій — один учасник на
 *   ВКЛАДКУ, тож у кімнаті тримає голос лише одна вкладка браузера (Web Locks, замок LOCK); решта
 *   показують, хто в кімнаті, і кнопку «Перенести голос сюди» (steal + BroadcastChannel). Закрилась
 *   вкладка з голосом — замок переходить до наступної, і та заходить сама.
 * - «🚪 В гості» (10.11.2026): колега з іншого відділу стукає в кімнату відділу (таблиця voice_knocks,
 *   migration_2026-11-10b_voice_knock.sql), будь-хто з відділу пускає — і голос гостя переходить у ту
 *   кімнату; «← До свого відділу» знімає дозвіл. Керівництво заходить без стуку (як і раніше).
 * - Покликати колегу (10.11.2026): ім'я зі списку «в мережі» (auth-v2.js) перетягують на панель —
 *   колега отримує «Зайти / Ні» (broadcast 'voice-invite' каналу присутності). «Зайти»: свій відділ —
 *   просто заходить; інший — стукає, і вкладка того, хто кликав, пускає сама (v.invited).
 * - «Двері відділів» на головній (17.11.2026, ../home-doors.js): стук іде звідти, а сюди приходять
 *   з ?door=home (свої двері), ?door=<id стуку 'ok'> (впустили) або ?door_dept=<відділ> (керівництво).
 * - «Вивести» (17.11.2026): біля гостя, якого впустили за стуком, — кнопка для будь-кого з відділу.
 *   Стук стає 'out' (migration_2026-11-17_voice_doors.sql; до неї — 'gone'), гостя повертає до свого відділу.
 * - Звук входу (17.11.2026) — у рушії (../zviazok/greet.js): перший вхід людини за день — привітання на
 *   ім'я («Вітаємо пані Олену!»), далі — мелодійний дзвінок; керівництво — на ім'я на кожен вхід. Сюди
 *   лише передаємо роль (createVoice({ role })), щоб рушій знав, хто з керівництва.
 * - «Голосове вікно» (19.11.2026, ../voice/): голос живе в окремому вікні браузера, щоб розмова не рвалась,
 *   поки людина ходить порталом, закриває вкладки чи відкриває сторонні сайти. У вікні — ця сама панель
 *   (initVoice({ win: true }) → api()); у вкладках «Справ» і кабінету — «лише дивлюся» плюс кнопки, що
 *   керують вікном (../voice/link.js). Вкладка сама в ефір більше не йде. Браузер не дав відкрити вікно —
 *   запасний шлях v.local: голос у вкладці, як до 19.11. Намір (двері, запрошення, стук, кімната
 *   департаменту) іде у вікно параметрами адреси або командою 'intent' — applyIntent().
 * - 🤝 Дорадча кімната (25.11.2026): друга кімната відділу поруч з офісом, канал 'voice:tet:<хеш відділу>'
 *   (migration_2026-11-25b_voice_tet_room.sql). Заходять самі або на запрошення; себе й колегу перетягують
 *   між картками. Обидві картки показують, хто де (друга кімната — peekRoom). Деталі — розділ нижче.
 * - Показ екрана з вкладки (25.11.2026): у вкладці «Справ» і кабінету знову є 🖥 — команда йде у вікно, а
 *   там браузер вимагає клік: вікно просить «🖥 Обрати, що показати». Екран спікера відкривається в
 *   окремому вікні (../voice/screen-win.js) — розгорнути, згорнути, на весь екран.
 */

import { createVoice, netInfo } from '../zviazok/voice.js?v=20261125e';
import { greetFor, playClip, CHIME } from '../zviazok/greet.js?v=20261117a';
import { openMicPicker } from '../zviazok/mic-picker.js?v=20261106a';
import { createMeeting } from '../zviazok/meeting.js?v=20261103a';
import { createStage } from '../zviazok/stage.js?v=20261125b';
import { createScreenWin } from '../voice/screen-win.js?v=20261125b';
import { openVoiceWindow, voiceWin, onVoiceWin, sendVoiceCmd, focusVoiceWindow, voiceWinRef, BUS, HEARTBEAT } from '../voice/link.js?v=20261125d';
import { createPip } from '../voice/pip.js?v=20261125e';

const MANY = 10;               // з такої кількості попереджаємо: пряма схема важчає
const LS_OFF = 'spravy-voice-off';
const ALL = '*';               // «відділ» = увесь департамент (перемикач у spravy.js)
const LOCK = 'pmg-voice-holder';   // замок «ця вкладка тримає голос» (Web Locks)
const BC = 'pmg-voice-tabs';       // канал між вкладками: «віддай голос»
const LEAD = ['admin', 'director', 'deputy_director'];   // заходять у будь-яку кімнату без стуку
const BOSS = ['manager', ...LEAD];                        // кличуть колегу в дорадчу кімнату (тет-а-тет)
const TET_WAIT = 90e3;                                    // скільки чекаємо співрозмовника в дорадчій (як запрошення в auth-v2)
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');

/* Герої (25.11.2026): «Звичайний» вигляд — кружечки з ініціалами, «Просунутий» — 3D-герої з Blender
   (tools/heroes, спрайт 4 кадри: рот закритий · трохи · широко · очі заплющені). Героя обирає кожен сам —
   стать і вигляд за іменем не вгадуємо; вибір іде колегам через присутність кімнати (рушій, meta.hero). */
const HEROES = [
  { id: 'base', name: 'Медик' },
  { id: 'chub', name: 'Чубчик з кавою' },
  { id: 'boss', name: 'Строга з текою' },
  { id: 'tail', name: 'Хвостик з гарнітурою' },
  { id: 'bob', name: 'Каре з блокнотом' },
  { id: 'curly', name: 'Кучерява брюнетка' },
  { id: 'blond', name: 'Блондинка в окулярах' }
];
const HERO_V = '20261125b';
const heroUrl = (id) => new URL(`../voice/heroes/${HEROES.some((h) => h.id === id) ? id : 'base'}.webp?v=${HERO_V}`, import.meta.url).href;
const VIEW_LS = 'pmg-voice-view';            // 'hero' — просунутий вигляд; пам'ятає браузер кожного
const lsRead = (k) => { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } };
const lsWrite = (k, val) => { try { val ? localStorage.setItem(k, val) : localStorage.removeItem(k); } catch (_) { /* приватне вікно */ } };
const heroView = () => lsRead(VIEW_LS) === 'hero';
const myHero = () => lsRead('pmg-voice-hero');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, val) => { try { val === null ? localStorage.removeItem(k) : localStorage.setItem(k, val); } catch (_) { /* приватний режим */ } };

const v = {
  root: null,
  demo: false,
  sb: null,
  me: null,
  name: '',
  dept: '',
  toast: () => {},
  eng: null,           // рушій ../zviazok/voice.js
  meet: null,          // нарада із записом ../zviazok/meeting.js
  stage: null,         // «сцена» показу екрана ../zviazok/stage.js — під панеллю
  vs: null,            // його знімок стану: status, error, inRoom, muted, deaf, needGesture, members
  noDept: false,
  holder: true,        // ця вкладка тримає голос (без Web Locks — завжди так, як раніше)
  elsewhere: false,    // голос тримає інша вкладка: тут лише видно, хто в кімнаті
  release: null,       // відпустити замок
  pending: null,       // AbortController заявки, що чекає в черзі
  bc: null,
  home: '',            // свій відділ (кімната «вдома»)
  role: '',
  depts: [],           // відділи департаменту — куди можна піти в гості
  showDepts: false,    // розгорнуто список «🚪 В гості»
  visit: null,         // { dept, id, status: 'wait' | 'in' } — стукаємо / в гостях
  knocks: [],          // хто стукає в нашу кімнату (status 'wait')
  knockCh: null,       // Realtime: стуки в нашу кімнату
  myKnockCh: null,     // Realtime: відповідь на наш стук
  noKnock: false,      // таблиці voice_knocks ще нема (міграція 10b)
  invited: new Map(),  // кого ми покликали: user_id → час (їхній стук пускаємо самі, 15 хв)
  guests: new Map(),   // гості нашої кімнати, впущені за стуком: user_id → рядок voice_knocks ('ok')
  // «Голосове вікно» (19.11.2026, ../voice/): голос живе там, а вкладки розділів лише показують кімнату
  win: false,          // ця панель — у голосовому вікні (тримає голос)
  local: false,        // вкладка розділу взяла голос собі (браузер не дав відкрити вікно — як до 19.11)
  ask: null,           // намір із адреси вкладки (двері, запрошення): чекає кліку «Зайти» — вікно лише на дію людини
  onState: null,       // вікно: стан змінився (для BroadcastChannel і маркера «в ефірі»)
  onLeave: null,       // вікно: людина вийшла з кімнати — вікно закривається
  onLost: null,        // вікно: голос забрала вкладка (запасний шлях) — вікно закривається
  follow: '',          // вкладка: назва кімнати, куди пішло вікно (у гостях), — показуємо її
  // Дорадча кімната (25.11.2026)
  tet: null,           // { topic, dept, since } — ми в дорадчій кімнаті відділу
  heroSeen: new Set(), // кого вже показали героєм (вистрибує лише той, хто щойно зайшов)
  heroPick: false,
  peek: [],            // хто в другій кімнаті (офіс чи дорадча) — присутність без власного запису
  peekCh: null,
  peekTopic: '',
  tetAsk: null,        // { from_id, from_name, at } — нас кличуть
  dragging: false,     // начальник тягне колегу: панель не перемальовуємо, щоб не зірвати перетягування
  dirty: false,        // перемалювати, щойно перетягування скінчиться
  scr: null,          // окреме вікно екрана спікера (../voice/screen-win.js)
  // Голос у вкладці (25.11.2026): значок поверх усіх вікон і зв'язок з іншими вкладками
  mode: '',            // '' · 'voice' — у голосі · 'screen' — лише показую екран · 'watch' — лише дивлюся екран
  pip: null,           // значок «В ефірі» поверх усіх вікон (../voice/pip.js)
  bus: null,           // BroadcastChannel ../voice/link.js: ця вкладка — «голос» для інших вкладок
  watch: null,         // { since, saw } — дивимось чужий екран без голосу
  scrStarting: false,  // показ саме починається (ще не live) — не виходити з кімнати
  seenPresenter: ''    // про чий показ уже підказали
};

const holds = () => v.win || v.local;   // ця панель тримає голос (вікно або вкладка на запасному шляху)

/* ───────────────────────── публічне ───────────────────────── */

/** Запустити кімнату. opts: { sb, me, name, dept, toast } або { demo: true, name }. */
export function initVoice(opts) {
  v.root = document.getElementById('spVoice');
  if (!v.root || !window.RTCPeerConnection) return;
  Object.assign(v, opts);
  v.home = v.dept;
  v.root.hidden = false;
  v.root.addEventListener('click', onClick);
  // Галочка «не вимикати мікрофон автоматично» (25.11.2026)
  v.root.addEventListener('change', (e) => {
    const c = e.target.closest?.('input[data-keep]');
    if (!c || !v.eng) return;
    v.eng.setKeepMic(c.checked);
    v.toast(c.checked ? 'Мікрофон не вимикатиметься сам, навіть якщо довго мовчите' : 'Після 5 хвилин тиші мікрофон вимикатиметься сам (за 3 хвилини попередимо)');
  });
  setupInviteDrop();
  if (v.demo) return demo();
  const host = document.createElement('section');
  v.root.after(host);
  v.scr = createScreenWin();
  v.stage = createStage(host, { onStop: () => v.eng.toggleShare(), onPop: () => v.scr.open() });
  v.eng = createVoice({ sb: v.sb, me: v.me, name: v.name, role: v.role, toast: v.toast, onMsg: onRoomMsg, onChange: (s) => {
    v.vs = s;
    watchTet(s);
    watchSilent(s);
    notePresenter(s);
    render();
    publishHost();
    // Вкладка «лише дивиться»: відео тут немає (воно в голосовому вікні) — сцену не показуємо
    v.stage.update(holds() ? s : null);
    v.scr.update(holds() ? s.presenter : null);
    v.onState?.();
  } });
  v.meet = createMeeting({ sb: v.sb, me: v.me, name: v.name, eng: v.eng, toast: v.toast });
  watchKnocks();
  window.addEventListener('pmg:voice-invite-reply', (e) => {
    const r = e.detail || {};
    if (r.tet) {
      if (r.ok) v.toast(`🤝 ${r.name || 'Колега'} заходить у дорадчу кімнату`);
      else tetDeclined({ uid: r.from || r.uid, name: r.name });
      return;
    }
    v.toast(r.ok ? `🎙 ${r.name || 'Колега'} заходить у кімнату` : `${r.name || 'Колега'} зараз не може`, !r.ok);
  });
  // Намір з адреси: запрошення («Зайти»), «Двері відділів» на головній, кімната департаменту
  const qs = new URLSearchParams(location.search);
  const intent = {};
  ['room', 'mic', 'door', 'door_dept', 'voice_invite', 'knock', 'tet', 'tet_room'].forEach((k) => { if (qs.get(k)) intent[k] = qs.get(k); });
  if (Object.keys(intent).length) {
    const u = new URL(location.href);
    Object.keys(intent).forEach((k) => u.searchParams.delete(k));
    history.replaceState(null, '', u);
  }
  if (v.win) { winStart(intent); return api(); }

  // Вкладка розділу: голос живе тут (з 25.11.2026), значок «В ефірі» — поверх усіх вікон
  setupHost();
  window.__pmgVoice = {
    acceptInvite: (p) => { startPip(); v.local = true; v.mode = 'voice'; return acceptInvite(p); },
    acceptTet: (p) => { startPip(); v.local = true; v.mode = 'voice'; return applyIntent({ tet: JSON.stringify(p) }); },
    tetRoom: () => goTet()
  };
  if (Object.keys(intent).length) { v.ask = intent; lsSet(LS_OFF, null); }
  onVoiceWin((w) => {
    if (holds()) return render();      // це наш же стан (ця вкладка — голос), а не чуже вікно
    // Вікно вже живе — намір із адреси (двері, запрошення) передаємо йому без кліку
    if (w && v.ask) { sendVoiceCmd('intent', v.ask); v.ask = null; }
    // Відповіли на тет-а-тет у самому вікні — і тут знімаємо запрошення
    if (v.tetAsk && w && !w.tetAsk && Date.now() - v.tetAsk.at > 2000) v.tetAsk = null;
    followWin(w);
    render();
  });
  if (!navigator.locks || !window.BroadcastChannel) return openRoom();
  v.holder = false;
  v.bc = new BroadcastChannel(BC);
  v.bc.onmessage = (e) => { if (e.data === 'yield' && v.holder) giveAway(); };
  queueForLock();
  // Замок не дали одразу — голос в іншій вкладці: показуємо кімнату «лише дивлюся»
  setTimeout(() => { if (!v.holder && !v.elsewhere) { v.elsewhere = true; openRoom(); } }, 400);
}

/* ───────────────────────── одна вкладка з голосом ───────────────────────── */

/**
 * Стати в чергу на замок; отримали — ця вкладка тримає голос, поки замок не заберуть («Перенести сюди»
 * в іншій вкладці) або не попросять віддати. У вкладці завжди не більше однієї заявки в черзі:
 * перед «steal» очікувану заявку скасовуємо (v.pending).
 */
function queueForLock(steal = false) {
  const ac = steal ? null : new AbortController();
  if (ac) v.pending = ac;
  navigator.locks.request(LOCK, steal ? { steal: true } : { signal: ac.signal }, () => new Promise((res) => {
    if (ac) v.pending = null;
    v.release = res;
    v.holder = true;
    v.elsewhere = false;
    openRoom();
  })).catch(() => { /* замок забрала інша вкладка або заявку скасовано */ }).finally(() => {
    if (ac && ac.signal.aborted) return;       // скасовано заради «Перенести сюди» в цій же вкладці
    if (v.holder) { v.holder = false; v.elsewhere = true; v.local = false; v.mode = ''; publishHost(true); openRoom(); }
    queueForLock();                            // знову в чергу: закриється вкладка з голосом — замок наш, але в ефір не йдемо
  });
}

/** Інша вкладка чи голосове вікно попросили голос — виходимо в «лише дивлюся» і відпускаємо замок. */
async function giveAway() {
  if (v.local) {
    if (v.meet?.active) await v.meet.finish();
    if (v.visit) await endVisit(false);
  }
  v.holder = false;
  v.elsewhere = true;
  v.local = false;
  v.mode = '';
  publishHost(true);
  await openRoom();
  const r = v.release; v.release = null; if (r) r();
}

/* ───────────────────────── голосове вікно (19.11.2026) ───────────────────────── */

/**
 * Панель у голосовому вікні (../voice/): забираємо голос у вкладок (спершу просимо віддати — так
 * вкладка, що писала нараду, встигне її зберегти), далі виконуємо намір. Замок забрали назад
 * (вкладка без вікна, запасний шлях) — вікно закривається.
 */
async function winStart(intent) {
  v.holder = true;
  v.elsewhere = false;
  if (navigator.locks && window.BroadcastChannel) {
    v.bc = new BroadcastChannel(BC);
    v.bc.postMessage('yield');
    await new Promise((r) => setTimeout(r, 400));
    navigator.locks.request(LOCK, { steal: true }, () => new Promise((res) => { v.release = res; }))
      .catch(() => { /* замок забрали */ })
      .finally(() => { if (v.release !== 'done') v.onLost?.(); });
  }
  await applyIntent(intent);
}

/** Що вміє вікно ззовні: команди з вкладок (BroadcastChannel) і маркер «в ефірі». */
function api() {
  return {
    get state() { return v.vs; },
    get label() { return roomTitle(); },
    get dept() { return v.dept; },
    toggleMic: async () => { v.eng.unlock(); await v.eng.toggleMic(); },
    toggleDeaf: async () => { v.eng.unlock(); await v.eng.toggleDeaf(); },
    leave: () => leaveWin(),
    intent: (p) => applyIntent(p || {}),
    unlock: () => v.eng.unlock(),
    // Показ екрана з кнопки значка (клік тут чи на значку поверх усіх вікон) або зупинка з вкладки
    share: async () => {
      const r = await v.eng.toggleShare();
      if (r === 'gesture') v.toast('Почати показ можна кнопкою екрана на значку «В ефірі» або у вкладці «Справ»', true);
      return r;
    },
    // Вкладка «Справ» сама захопила екран у своєму кліку й віддає доріжку сюди (25.11.2026)
    shareTrack: (t) => v.eng.shareTrack(t),
    openScreen: () => {
      if (!v.scr.open()) v.toast('Браузер не дав відкрити вікно саме — натисніть «⧉ Окреме вікно» над екраном колеги', true);
    },
    get tet() { return v.tet ? 'дорадча' : ''; },
    /** Щось у панелі вимагає дії — голосове вікно розгортає її зі значка (25.11.2026). */
    get needs() { return !!(v.tetAsk || v.knocks.length || v.vs?.status === 'error' || false); },
    get tetAsk() { return v.tetAsk?.from_id || ''; }
  };
}

/**
 * Вкладка йде слідом за вікном (19.11.2026, «мене пустили, а я не бачу, де я і хто там»): вікно
 * пішло в гості — панель вкладки показує ту кімнату (хто там, чат відділу-господаря), а не свою.
 * Кімнату департаменту тут не показуємо: вона в «Чаті департаменту». Вікно закрилось — назад додому.
 */
function followWin(w) {
  if (v.win || v.local || v.demo || !v.eng) return;
  const there = w && w.inRoom && w.dept && w.dept !== ALL && (v.depts || []).includes(w.dept) ? w.dept : v.home;
  const label = there !== v.home ? (w.label || `В гостях: ${cap(there)}`) : '';
  if (there === v.dept && label === v.follow) return;
  const moved = there !== v.dept;
  v.dept = there;
  v.follow = label;
  if (moved) { roomChanged(); if (v.dept) openRoom(); }
}

/** Вийти з кімнати у вікні: нарада зберігається, замок відпускаємо, вікно закривається. */
async function leaveWin() {
  if (v.meet?.active) {
    if (!confirm('Іде запис наради. Завершити нараду й зберегти запис?')) return false;
    await v.meet.finish();
  }
  if (v.visit) await endVisit(false);
  await v.eng.leave(true);
  const r = v.release; v.release = 'done'; if (typeof r === 'function') r();
  v.onLeave?.();
  return true;
}

/**
 * Намір зайти — у вікні (або у вкладці, якщо вікно не відкрилось): кімната департаменту,
 * запрошення, двері, стук, своя кімната (за замовчуванням). mic: '1' — одразу з мікрофоном (як «🎙 Голос» у чаті).
 */
async function applyIntent(p = {}) {
  const parse = (x) => { try { return typeof x === 'string' ? JSON.parse(x) : x; } catch (_) { return null; } };
  if (p.tet_call) return callTet(parse(p.tet_call));
  if (p.tet || p.tet_room) {                 // прийняли запрошення чи заходимо в дорадчу
    const a = p.tet ? parse(p.tet) : null;
    if (!v.eng.topic) await openRoom();
    return enterTetRoom(a?.dept || p.tet_room);
  }
  if (p.tet_no) { v.tetAsk = null; return render(); }
  if (p.tet_declined) return tetDeclined(parse(p.tet_declined));
  // Будь-який інший намір виводить із дорадчої кімнати
  if (v.tet) { v.tet = null; await openRoom(); }
  // Кімната ще не відкрита (щойно відкрите вікно) — спершу своя; гостювання й департамент відкриють свою самі
  const elsewhereRoom = p.room === 'all' || p.door_dept || (p.door && p.door !== 'home');
  if (!v.eng.topic && !elsewhereRoom) await openRoom();
  if (p.room === 'all') {
    if (v.visit) await endVisit(false);
    if (v.elsewhere) takeOver();
    v.dept = ALL;
    roomChanged();
    await openRoom();
    if (v.eng.state && !v.eng.state.inRoom && !v.elsewhere) await v.eng.enter();
  } else if (p.voice_invite) {
    let inv = p.voice_invite;
    try { if (typeof inv === 'string') inv = JSON.parse(inv); } catch (_) { inv = null; }
    if (inv) await acceptInvite(inv);
  } else if (p.knock && (v.depts || []).includes(p.knock)) {
    if (v.visit) await endVisit(false);
    await knock(p.knock);
  } else if ((!v.home || v.home === ALL) && !p.door && !p.door_dept) {
    return applyIntent({ ...p, room: 'all' });   // відділу в профілі нема — кімната департаменту
  } else {
    await acceptDoor(p.door || (p.door_dept ? null : 'home'), p.door_dept || null);
  }
  if (p.mic === '1' && v.eng.state?.inRoom && v.eng.state.muted) { v.eng.unlock(); await v.eng.toggleMic(); }
  render();
}

/**
 * Вкладка розділу: «Увійти» відкриває голосове вікно (лише на клік). Браузер не дав —
 * голос береться в цю вкладку, як було до 19.11 (тоді перехід на іншу сторінку його перерве).
 */
function requestVoice(p = {}) {
  lsSet(LS_OFF, null);
  v.ask = null;
  // Голос уже тримає інша вкладка (чи старе голосове вікно) — намір їй
  if (!holds() && voiceWin()) { sendVoiceCmd('intent', p); return render(); }
  startPip();                       // ще в кліку: значок «В ефірі» поверх усіх вікон
  const silent = v.mode === 'screen' || v.mode === 'watch';
  v.local = true;
  v.mode = 'voice';
  v.watch = null;
  if (silent && v.eng.state?.deaf) v.eng.toggleDeaf();   // з показу без голосу — повертаємо звук
  applyIntent(p);
  publishHost(true);
}

/** «Перенести голос сюди»: просимо вкладку з голосом піти й забираємо замок. */
function takeOver() {
  v.pending?.abort();
  v.pending = null;
  v.bc?.postMessage('yield');
  queueForLock(true);
}

/** Керівництво перемкнуло відділ або «Мій відділ | Департамент» — переходимо в ту кімнату. */
export async function setVoiceDept(dept) {
  if (v.demo || !v.root || dept === v.home) return;
  if (v.visit) await endVisit(false);
  v.dept = v.home = dept;
  openRoom();
  watchKnocks();
}

/* ───────────────────────── «🚪 В гості» ───────────────────────── */

/** Стуки в нашу кімнату: ті, що чекають (за 30 хв), і нові — миттєво. Плюс гості, яких уже впустили (12 год). */
async function watchKnocks() {
  if (v.knockCh) { v.sb.removeChannel(v.knockCh); v.knockCh = null; }
  v.knocks = [];
  v.guests = new Map();
  if (!v.home || v.home === ALL) return render();
  const topic = await topicFor(v.home);
  const since = new Date(Date.now() - 30 * 60e3).toISOString();
  const { data, error } = await v.sb.from('voice_knocks').select('*').eq('topic', topic).eq('status', 'wait')
    .gte('created_at', since).order('created_at');
  if (error) { v.noKnock = true; return render(); }   // міграції 10b ще нема — кнопка «В гості» схована
  v.knocks = (data || []).filter((k) => k.user_id !== v.me.id);
  v.knocks.filter(wasInvited).forEach((k) => decide(k.id, true));
  // Кого впустили (дозвіл діє 12 годин — так само рахує voice_room_allowed()): біля них «Вивести»
  const { data: ok } = await v.sb.from('voice_knocks').select('*').eq('topic', topic).eq('status', 'ok')
    .gte('decided_at', new Date(Date.now() - 12 * 3600e3).toISOString());
  (ok || []).forEach((k) => { if (k.user_id !== v.me.id) v.guests.set(k.user_id, k); });
  v.knockCh = v.sb.channel('knocks:' + topic)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_knocks', filter: `topic=eq.${topic}` }, (p) => {
      const k = p.new;
      if (!k?.id) return;
      const was = v.knocks.some((x) => x.id === k.id);
      v.knocks = v.knocks.filter((x) => x.id !== k.id);
      if (k.status === 'ok' && k.user_id !== v.me.id) v.guests.set(k.user_id, k);
      else if (v.guests.get(k.user_id)?.id === k.id) v.guests.delete(k.user_id);
      if (k.status === 'wait' && wasInvited(k)) { decide(k.id, true); return; }
      if (k.status === 'wait' && k.user_id !== v.me.id) {
        v.knocks.push(k);
        if (!was) v.toast(`🚪 ${k.name || 'Колега'} просить зайти в кімнату відділу`);
      }
      render();
    })
    .subscribe();
  render();
}

/** Стукає той, кого ми самі покликали за останні 15 хвилин — пускаємо без питань. */
function wasInvited(k) {
  const t = v.invited.get(k.user_id);
  return !!t && Date.now() - t < 15 * 60e3;
}

/* ───────────────────────── покликати колегу ───────────────────────── */

/** Панель голосу приймає ім'я, перетягнуте зі списку «в мережі». */
function setupInviteDrop() {
  const has = (e) => [...(e.dataTransfer?.types || [])].includes('application/x-pmg-user');
  const zone = (e) => e.target.closest?.('[data-tetzone], [data-droproom]');
  const mark = (z) => v.root.querySelectorAll('[data-tetzone], [data-droproom]').forEach((el) => el.classList.toggle('is-over', el === z));
  // Тягнемо кружечок: себе — між кімнатами, колегу — з офісу в дорадчу (покликати)
  v.root.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('li[data-drag-uid]');
    if (!li) return;
    e.dataTransfer.setData('application/x-pmg-user', JSON.stringify({ id: li.dataset.dragUid, name: li.dataset.dragName, room: li.dataset.dragFrom || 'office', self: !!li.dataset.dragSelf }));
    e.dataTransfer.effectAllowed = 'copyMove';
    try { e.dataTransfer.setDragImage(li, 18, 18); } catch (_) { /* старий браузер */ }
    li.classList.add('is-lifted');
    v.dragging = true;
    v.root.classList.add('is-dragging');
  });
  v.root.addEventListener('dragend', () => {
    v.dragging = false;
    v.root.classList.remove('is-dragging', 'is-drop');
    mark(null);
    v.root.querySelectorAll('.is-lifted').forEach((el) => el.classList.remove('is-lifted'));
    if (v.dirty) render();
  });
  v.root.addEventListener('dragover', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    const z = zone(e);
    e.dataTransfer.dropEffect = z ? 'move' : 'copy';
    mark(z);
    v.root.classList.toggle('is-drop', !z && !v.dragging);
  });
  v.root.addEventListener('dragleave', (e) => {
    if (!v.root.contains(e.relatedTarget)) { v.root.classList.remove('is-drop'); mark(null); }
  });
  v.root.addEventListener('drop', (e) => {
    v.root.classList.remove('is-drop', 'is-dragging');
    const z = zone(e);
    mark(null);
    v.dragging = false;
    const raw = e.dataTransfer.getData('application/x-pmg-user');
    if (!raw) return;
    e.preventDefault();
    let u = null;
    try { u = JSON.parse(raw); } catch (_) { return; }   // не наш формат
    const self = u.self || (u.id && u.id === v.me?.id);
    if (z?.hasAttribute('data-tetzone')) {
      if (self) goTet(); else callTet({ uid: u.id, name: u.name });
    } else if (z?.dataset.droproom === 'office') {
      if (self) { if (u.room === 'tet') goOffice(); }
      else if (!u.room) invite(u);                       // зі списку «в мережі» — покликати в офіс
    } else if (!u.room) invite(u);
    if (v.dirty) render();
  });
}

/** Покликати колегу в кімнату, де ми зараз: він отримає «Зайти / Ні». */
function invite(u) {
  if (!u?.id) return;
  if (v.demo) return v.toast(`У демо не кличемо. Тут ${u.name} отримав(-ла) б «Зайти / Ні»`);
  if (!v.dept || v.dept === ALL) return v.toast('Кімнату відділу не визначено — кликати нікуди', true);
  if ((v.vs?.members || []).some((m) => m.name === u.name)) return v.toast(`${u.name} уже в кімнаті`);
  v.invited.set(u.id, Date.now());
  window.dispatchEvent(new CustomEvent('pmg:voice-invite-send',
    { detail: { to: u.id, from_id: v.me.id, from_name: v.name, dept: v.dept } }));
  v.toast(`🎙 Покликали ${u.name} — чекаємо відповіді`);
}

/** «Зайти» на запрошення: голос — у цю вкладку, далі свій відділ одразу, чужий — через стук. */
async function acceptInvite(p) {
  if (!v.eng || !p?.dept) return;
  lsSet(LS_OFF, null);
  if (v.elsewhere) takeOver();
  if (p.dept === v.home) {
    if (v.visit) await endVisit(false);
    v.dept = v.home;
    await openRoom();
    if (v.vs && !v.vs.inRoom && !v.elsewhere) await v.eng.enter();
    return;
  }
  if (v.visit?.dept === p.dept && v.visit.status === 'in') return;
  if (v.visit) await endVisit(false);
  await knock(p.dept);
}

/** Пустити / не пускати — може будь-хто з відділу. */
async function decide(id, ok) {
  const { error } = await v.sb.from('voice_knocks')
    .update({ status: ok ? 'ok' : 'no', decided_by_name: v.name, decided_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'wait');
  if (error) return v.toast('Не вдалося: ' + error.message, true);
  v.knocks = v.knocks.filter((k) => k.id !== id);
  render();
}

/** Постукати в кімнату іншого відділу (керівництво заходить одразу). */
async function knock(dept) {
  v.showDepts = false;
  if (LEAD.includes(v.role)) return goVisit(dept, null);
  const topic = await topicFor(dept);
  const { data, error } = await v.sb.from('voice_knocks')
    .insert({ topic, room_label: dept, name: v.name, from_dept: v.home || null }).select().single();
  if (error) {
    const rls = /row-level security|42501/i.test(error.message || error.code || '');
    return v.toast(rls ? 'Вас нещодавно вивели з цієї кімнати — постукайте за кілька хвилин' : 'Не вдалося постукати: ' + error.message, true);
  }
  v.visit = { dept, id: data.id, status: 'wait' };
  listenMyKnock(data.id, dept);
  render();
}

/**
 * Відповідь на наш стук: поки чекаємо — «пустили» / «ні»; уже в гостях — нас вивели
 * ('out', а без міграції 17.11 — 'gone', який ставимо не ми: свій 'gone' endVisit ставить, уже відписавшись).
 */
function listenMyKnock(id, dept) {
  if (v.myKnockCh) v.sb.removeChannel(v.myKnockCh);
  v.myKnockCh = v.sb.channel('myknock:' + id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'voice_knocks', filter: `id=eq.${id}` }, (p) => {
      const k = p.new;
      if (!v.visit || v.visit.id !== k.id) return;
      if (v.visit.status === 'wait') {
        if (k.status === 'ok') { v.toast(`✅ ${k.decided_by_name || 'Колеги'} впустили вас у кімнату`); goVisit(dept, k.id); }
        else if (k.status === 'no') { v.toast(`Відділ «${dept}» каже: не зараз`, true); endVisit(false); }
      } else if (k.status === 'out' || k.status === 'gone') {
        v.toast(`🚪 ${k.out_by_name || 'Господарі кімнати'} вивели вас із кімнати відділу «${dept}»`, true);
        endVisit(true, true);
      }
    })
    .subscribe();
}

/** Пустили — голос переходить у кімнату відділу-господаря. */
async function goVisit(dept, id) {
  v.visit = { dept, id, status: 'in' };
  v.dept = dept;
  lsSet(LS_OFF, null);
  roomChanged();
  await openRoom();
}

/** Скасувати стук або повернутися до свого відділу; дозвіл знімається (якщо нас вивели — уже знято). */
async function endVisit(back = true, kicked = false) {
  const vis = v.visit;
  v.visit = null;
  if (v.myKnockCh) { v.sb.removeChannel(v.myKnockCh); v.myKnockCh = null; }
  if (vis?.id && !kicked) await v.sb.from('voice_knocks').update({ status: 'gone' }).eq('id', vis.id);
  if (v.dept !== v.home) { v.dept = v.home; roomChanged(); if (back) await openRoom(); else openRoom(); }
  render();
}

/** Сторінка (spravy.js) перемикає під панеллю чат на кімнату, де ми зараз. */
function roomChanged() {
  window.dispatchEvent(new CustomEvent('pmg:voice-room', { detail: { dept: v.dept, home: v.home } }));
}

/** Прийшли з «Дверей відділів» (../home-doors.js): свої двері, впустили за стуком або керівництво. */
async function acceptDoor(id, dept) {
  if (!v.eng) return;
  if (id === 'home' || (dept && dept === v.home)) {
    if (!v.home) return;                         // відділу в профілі нема — панель сама підкаже
    if (v.visit) await endVisit(false);
    if (v.dept !== v.home) { v.dept = v.home; roomChanged(); if (!v.elsewhere) await openRoom(); }
    if (v.elsewhere) return takeOver();
    if (v.vs && !v.vs.inRoom) await v.eng.enter();
    return;
  }
  if (id) {
    const { data: k } = await v.sb.from('voice_knocks').select('*').eq('id', id).maybeSingle();
    if (!k || k.user_id !== v.me.id || k.status !== 'ok' || !(v.depts || []).includes(k.room_label)) {
      return v.toast('Дозвіл зайти вже не дійсний — постукайте ще раз', true);
    }
    if (k.room_label === v.home) return acceptDoor('home');
    if (v.visit) await endVisit(false);
    await goVisit(k.room_label, k.id);
    listenMyKnock(k.id, k.room_label);
  } else if (dept && LEAD.includes(v.role) && (v.depts || []).includes(dept)) {
    if (v.visit) await endVisit(false);
    await goVisit(dept, null);
  } else return;
  if (v.elsewhere) takeOver();
  render();
}

/** «Вивести» гостя, якого впустили за стуком, — може будь-хто з відділу. */
async function kick(uid) {
  const g = v.guests.get(uid);
  if (!g) return;
  const who = g.name || 'Гостя';
  if (!confirm(`Вивести ${who} з кімнати відділу?`)) return;
  let { error } = await v.sb.from('voice_knocks')
    .update({ status: 'out', out_by_name: v.name, out_at: new Date().toISOString() }).eq('id', g.id);
  // Без migration_2026-11-17_voice_doors.sql статусу 'out' немає — 'gone' знімає дозвіл так само
  if (error) ({ error } = await v.sb.from('voice_knocks').update({ status: 'gone' }).eq('id', g.id));
  if (error) return v.toast('Не вдалося вивести: ' + error.message, true);
  v.guests.delete(uid);
  v.toast(`🚪 ${who} — виведено з кімнати`);
  render();
}

/* ───────────────────────── кімната ───────────────────────── */

async function topicFor(dept) {
  if (dept === ALL) return 'voice:all';  // кімната департаменту (migration_2026-11-03b_voice_room_all.sql)
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dept));
  return 'voice:dept:' + [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const roomTitle = () => (v.tet ? '🤝 Дорадча кімната' : officeTitle());

async function openRoom() {
  if (v.tet) {
    v.noDept = false;
    const office = await topicFor(v.tet.dept || v.dept);
    await peekRoom(null);                    // один канал двічі в одному клієнті не тримаємо
    await v.eng.join(v.tet.topic, roomTitle(), { listen: false });
    peekRoom(office);                        // офіс — підглядаємо, хто там
    return;
  }
  v.noDept = !v.dept;
  if (v.noDept) { await peekRoom(null); await v.eng.leave(true); return render(); }
  const topic = await topicFor(v.dept);
  const tetPeek = v.dept !== ALL ? topic.replace('voice:dept:', 'voice:tet:') : '';
  if (v.peekTopic === topic) await peekRoom(null);
  // Рушій сам перемикає кімнату: мікрофон і звук лишаються, як були.
  // З 19.11.2026 вкладка розділу в ефір сама не йде — голос у голосовому вікні (крім запасного v.local)
  await v.eng.join(topic, roomTitle(), { listen: !v.win && (v.elsewhere || !v.local) });
  peekRoom(tetPeek);                         // дорадча — підглядаємо, хто там
}

/** Зайти в кімнату (кнопка «Увійти»). */
async function joinRoom() {
  if (v.demo) return v.vs.inRoom ? null : demoAct('join');
  if (!v.win && v.mode !== 'voice') return requestVoice(v.ask || (v.dept === ALL ? { room: 'all' } : {}));
  if (v.elsewhere) { lsSet(LS_OFF, null); return takeOver(); }
  lsSet(LS_OFF, null);
  v.eng.unlock();
  await v.eng.enter();
}

/* ───────────────────────── дорадча кімната відділу (25.11.2026, друга версія) ───────────────────────── */

/**
 * Друга кімната відділу поруч з офісом: канал 'voice:tet:<той самий хеш, що й voice:dept:>'
 * (migration_2026-11-25b_voice_tet_room.sql — заходять ті самі, що й в офіс). Перша версія садила кожного,
 * хто заходив сам, у власний канал 1:1 — і люди не бачили одне одного («ми заходимо в різні кімнати»).
 *
 * - Зайти: «🤝 Зайти» на картці або перетягнути свій кружечок з офісу в дорадчу; назад — «← До офісу» чи
 *   кружечок назад в офіс.
 * - Покликати: колегу перетягують з офісу (чи зі списку «в мережі») в дорадчу або тиснуть 🤝 біля імені —
 *   він отримує «Зайти / Не зараз» (через «в мережі», auth-v2.js), а ми самі переходимо туди.
 * - Обидві картки завжди показують, хто де: кімнату, в якій ми, — рушій; другу — «підглядання» (peekRoom):
 *   присутність її каналу без власного запису (нас там не видно).
 */
const tetTopicFor = async (dept) => (await topicFor(dept)).replace('voice:dept:', 'voice:tet:');
const canTetRoom = () => !!v.dept && v.dept !== ALL && !v.noDept;
// Чужий «голос» (інша вкладка чи старе вікно). Вкладка, що сама тримає голос, чує в link.js власний стан —
// його за чужий не рахуємо
const otherWin = () => (holds() ? null : voiceWin());
const officeTitle = () => v.follow || (v.dept === ALL ? 'Кімната департаменту'
  : v.visit?.status === 'in' ? `В гостях: ${cap(v.dept)}` : 'Голосовий офіс відділу');

/** Підглядаємо присутність другої кімнати (без власного запису). null — перестати. */
async function peekRoom(topic) {
  if (v.demo || !v.sb) return;
  topic = topic || '';
  if (topic === v.peekTopic) return;
  const old = v.peekCh;
  v.peekCh = null;
  v.peekTopic = topic;
  v.peek = [];
  if (old) { try { await v.sb.removeChannel(old); } catch (_) { /* уже закрито */ } }
  if (!topic) return render();
  const ch = v.sb.channel(topic, { config: { private: true, presence: { key: 'peek-' + Math.random().toString(36).slice(2, 10) } } });
  v.peekCh = ch;
  ch.on('presence', { event: 'sync' }, () => {
    if (ch !== v.peekCh) return;
    v.peek = Object.values(ch.presenceState() || {}).map((a) => a[a.length - 1]).filter((m) => m && m.uid);
    render();
  }).subscribe();
}

/** Учасники другої кімнати — у вигляді, який розуміє personHTML. */
const peekMembers = () => v.peek.map((m, i) => ({ key: 'pk' + i, uid: m.uid, name: m.name, muted: m.muted, deaf: m.deaf, dev: m.dev, hero: m.hero || '', me: m.uid === v.me?.id, peek: true }));

/** Повідомлення кімнати (рушій, broadcast 'room'): запрошення зі старого голосового вікна, відмова. */
function onRoomMsg(p) {
  if (!p || !v.me || p.to !== v.me.id) return;
  if (p.t === 'tet') {
    if (v.tet || otherWin()?.tet) return;     // ми вже в дорадчій
    const at = Date.now();
    v.tetAsk = { from_id: p.from_id, from_name: p.from_name || 'Колега', dept: p.dept || '', at };
    if (holds()) v.toast(`🤝 ${v.tetAsk.from_name} кличе вас у дорадчу кімнату`);
    setTimeout(() => { if (v.tetAsk?.at === at) { v.tetAsk = null; render(); } }, TET_WAIT);
    render();
  } else if (p.t === 'tet-reply' && !p.ok) {
    tetDeclined({ uid: p.from_id, name: p.from_name });
  }
}

/** Колега відповів «Не зараз» — лише скажемо (дорадча — звичайна кімната, нас звідти не виводить). */
function tetDeclined(d) {
  if (!d) return;
  v.toast(`${d.name || 'Колега'}: «не зараз»`, true);
}

/**
 * Опинитися в дорадчій: голос тримає інша вкладка — команда їй; не в голосі — заходимо (у кліку — зі
 * значком «В ефірі» поверх усіх вікон); у голосі — переходимо.
 */
function goTet(dept) {
  if (v.demo) return v.toast('У демо не заходимо. Тут ви перейшли б у дорадчу кімнату відділу');
  if (otherWin()) return sendVoiceCmd('intent', { tet_room: dept || v.dept || '1' });
  if (!holds() || v.mode !== 'voice') return requestVoice({ tet_room: dept || v.dept || '1' });
  return enterTetRoom(dept);
}

/** Покликати колегу в дорадчу (перетягування чи 🤝) — і самим перейти туди. */
async function callTet(u) {
  if (!u?.uid) return;
  if (u.uid === v.me?.id) return goTet();
  const name = u.name || 'Колега';
  if (v.demo) return v.toast(`У демо не кличемо. Тут ${name} отримав(-ла) б «Зайти / Не зараз», а ви перейшли б у дорадчу кімнату`);
  if (!canTetRoom()) return v.toast('Дорадча кімната — у відділу; у кімнаті департаменту її немає', true);
  // Запрошення — через «в мережі»: дійде, на якій би сторінці порталу колега не був. У старому голосовому
  // вікні «в мережі» немає — там кличемо повідомленням кімнати
  if (v.win) await v.eng.say({ t: 'tet', to: u.uid, from_id: v.me.id, from_name: v.name, dept: v.dept });
  else window.dispatchEvent(new CustomEvent('pmg:voice-invite-send', { detail: { to: u.uid, from_id: v.me.id, from_name: v.name, dept: v.dept, tet: 1 } }));
  v.toast(`🤝 Покликали ${name} у дорадчу кімнату`);
  if (!v.tet && !otherWin()?.tet) await goTet(v.dept);
}

/** «Зайти» / «Не зараз» на запрошення в панелі. */
async function answerTet(ok) {
  const a = v.tetAsk;
  v.tetAsk = null;
  if (!a || v.demo) return render();
  if (!ok) {
    await v.eng.say({ t: 'tet-reply', to: a.from_id, from_id: v.me.id, from_name: v.name, ok: false });
    if (otherWin()) sendVoiceCmd('intent', { tet_no: '1' });
    return render();
  }
  return goTet(a.dept || v.dept);
}

/** Перейти в дорадчу кімнату відділу (dept — чия; за замовчуванням той, де ми зараз). */
async function enterTetRoom(dept) {
  const d = dept && dept !== '1' && (v.depts || []).includes(dept) ? dept : v.dept;
  if (!d || d === ALL) return v.toast('Дорадча кімната — у відділу; у кімнаті департаменту її немає', true);
  v.tetAsk = null;
  if (d !== v.dept && v.visit) await endVisit(false);
  v.tet = { topic: await tetTopicFor(d), dept: d, since: Date.now() };
  await openRoom();
  if (v.eng.state && !v.eng.state.inRoom) await v.eng.enter();
  publishHost(true);
  render();
}

/** Назад в офіс відділу. */
async function leaveTet(msg, bad) {
  if (!v.tet) return;
  v.tet = null;
  if (msg) v.toast(msg, bad);
  if (v.meet?.active) await v.meet.finish();
  await openRoom();
  if (v.eng.state && !v.eng.state.inRoom) await v.eng.enter();
  publishHost(true);
  render();
}

/** Назад в офіс — тут чи в тій вкладці, що тримає голос. */
function goOffice() {
  if (otherWin()) return sendVoiceCmd('intent', {});
  return leaveTet();
}

function watchTet(s) {
  if (!v.tet || !holds() || s.topic !== v.tet.topic) return;
  if (s.status === 'error') leaveTet('Дорадча кімната ще закрита: потрібна міграція бази (migration_2026-11-25b_voice_tet_room.sql)', true);
}

/** Запрошення на тет-а-тет у панелі (нас кличуть). */
function tetHTML() {
  if (!v.tetAsk) return '';
  return `<ul class="spv-knocks"><li class="spv-knock">
      <span>🤝 <b>${esc(v.tetAsk.from_name)}</b> кличе вас у дорадчу кімнату</span>
      <button type="button" class="spv-btn is-on" data-act="tetok">Зайти</button>
      <button type="button" class="spv-btn spv-ghost" data-act="tetno">Не зараз</button>
    </li></ul>`;
}

/**
 * Дві картки поруч: «🎙 Голосовий офіс відділу» і «🤝 Дорадча кімната». Кожна показує, хто в ній. Ми — в одній
 * (світиться, «в ефірі»); в другу можна перетягнути себе чи колегу.
 */
function roomsHTML(s, w, list) {
  const inTet = !!v.tet || !!w?.tet;
  const engineIsTet = !!v.tet;                   // рушій цієї вкладки зараз у дорадчій
  const peek = peekMembers();
  const officeList = engineIsTet ? peek : list;
  const tetList = engineIsTet ? list : peek;
  const liveHere = (s.status === 'live' && s.inRoom) || !!w?.inRoom;
  const officeLive = liveHere && !inTet;
  const tetLive = liveHere && inTet;
  const chips = (arr, from) => arr.map((m) => personHTML(m, s, w, from)).join('');
  const count = (arr) => (arr.length ? `${arr.length} ${plural(arr.length)}` : 'Поки нікого');

  const office = `<section class="spv-room is-office${officeLive ? ' is-live' : ''}" data-droproom="office">
      <header class="spv-room-head"><span class="spv-room-ico" aria-hidden="true">🎙</span>
        <span class="spv-room-title"><b>${esc(officeTitle())}</b><small>${count(officeList)}${officeLive ? ' · <span class="spv-live-txt">в ефірі</span>' : ''}</small></span>
        <span class="spv-dot${officeLive ? ' is-live' : ''}" aria-hidden="true"></span></header>
      <ul class="spv-people" aria-label="Хто в офісі">${chips(officeList, 'office')}</ul>
    </section>`;
  if (!canTetRoom()) return `<div class="spv-rooms is-single">${office}</div>`;

  const foot = inTet
    ? `<button type="button" class="spv-btn" data-act="${engineIsTet ? 'tetback' : 'wback'}" title="Повернутися в голосовий офіс відділу">← До офісу</button>`
    : '<button type="button" class="spv-btn spv-tet-in" data-act="tetsolo" title="Зайти в дорадчу кімнату — колегу можна покликати потім">🤝 Зайти</button>';
  const tet = `<section class="spv-room is-tet${tetLive ? ' is-live is-busy' : ''}" data-tetzone aria-label="Дорадча кімната: перетягніть сюди себе чи колегу">
      <header class="spv-room-head"><span class="spv-room-ico" aria-hidden="true">🤝</span>
        <span class="spv-room-title"><b>Дорадча кімната</b><small>${tetList.length ? count(tetList) : 'Розмова віч-на-віч'}${tetLive ? ' · <span class="spv-live-txt">ви тут</span> · офіс вас не чує' : ''}</small></span>
        ${tetLive ? '<span class="spv-dot is-live" aria-hidden="true"></span>' : ''}</header>
      ${tetList.length ? `<ul class="spv-people" aria-label="Хто в дорадчій">${chips(tetList, 'tet')}</ul>` : ''}
      <p class="spv-room-drop">${inTet ? 'Перетягніть сюди колегу з офісу чи зі списку «в мережі» — він отримає запрошення' : 'Перетягніть сюди себе чи колегу з офісу'}</p>
      <div class="spv-room-foot">${foot}</div>
    </section>`;
  return `<div class="spv-rooms">${office}${tet}</div>`;
}

/** Що можна перетягнути: себе (між кімнатами, якщо ми в голосі) і колегу з офісу (покликати в дорадчу). */
function dragAttr(m, w, from) {
  if (v.demo ? false : !canTetRoom()) return '';
  const inVoice = v.demo || (holds() && v.mode === 'voice') || !!w?.inRoom;
  const mine = m.me || (m.uid && m.uid === v.me?.id);
  if (mine && !inVoice) return '';
  if (!mine && (from !== 'office' || !m.uid)) return '';
  return ` draggable="true" data-drag-uid="${esc(m.uid || v.me?.id || 'me')}" data-drag-name="${esc(m.name || '')}" data-drag-from="${from}"${mine ? ' data-drag-self="1"' : ''}`;
}

/** Герой учасника: спрайт + власний ритм кліпання (від uid, щоб усі не кліпали разом). */
function heroHTML(m) {
  const seed = [...String(m.uid || m.key || m.name || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7);
  const id = (m.me ? (myHero() || m.hero) : m.hero) || (v.demo ? HEROES[seed % HEROES.length].id : '');   // у демо — різні герої для наочності
  const isNew = !v.heroSeen.has(m.key);
  v.heroSeen.add(m.key);
  return `<span class="spv-hero${isNew ? ' is-new' : ''}" aria-hidden="true" style="--hero:url('${heroUrl(id)}');--blink:${(4 + (seed % 40) / 10).toFixed(1)}s;--blink-d:${-(seed % 50) / 10}s">
      <i class="spv-hero-blink"></i>${m.sharing ? '<i class="spv-hero-badge">🖥</i>' : ''}</span>`;
}

/** Перемикач вигляду кімнати й вибір свого героя. */
function viewBarHTML() {
  const hero = heroView();
  const mine = myHero();
  const pick = hero && v.heroPick ? `<div class="spv-heropick" role="listbox" aria-label="Оберіть свого героя">
      ${HEROES.map((h) => `<button type="button" class="spv-heropick-i${(mine || 'base') === h.id ? ' is-on' : ''}" data-act="hero" data-hero="${h.id}" role="option" aria-selected="${(mine || 'base') === h.id}" title="${esc(h.name)}">
        <span class="spv-hero is-still" style="--hero:url('${heroUrl(h.id)}')"></span><small>${esc(h.name)}</small></button>`).join('')}
    </div>` : '';
  return `<div class="spv-viewbar">
      <div class="spv-seg" role="group" aria-label="Вигляд кімнати">
        <button type="button" data-act="view" data-view="plain" aria-pressed="${!hero}" title="Кружечки з ініціалами">Звичайний</button>
        <button type="button" data-act="view" data-view="hero" aria-pressed="${hero}" title="3D-герої: дихають, говорять, кліпають">Просунутий</button>
      </div>
      ${hero ? `<button type="button" class="spv-btn spv-ghost spv-myhero" data-act="heropick" aria-expanded="${!!v.heroPick}" title="Оберіть, яким героєм вас бачать колеги">🧩 Мій герой</button>` : ''}
    </div>${pick}`;
}

/** Кружечок учасника (і в кімнаті, де ми, і в тій, куди підглядаємо). */
function personHTML(m, s, w, from) {
  const st = m.viaWin || m.peek ? 'ok' : m.state;
  const hero = heroView();
  const sleepy = hero && m.me && s.idleWarn;
  const cls = ['spv-person', m.me && 'is-me', m.muted && 'is-muted', m.deaf && 'is-deaf', st === 'bad' && 'is-bad', st === 'wait' && 'is-wait',
    hero && 'is-hero', sleepy && 'is-sleepy', hero && m.sharing && 'is-sharing'].filter(Boolean).join(' ');
  const ni = netInfo(m);
  const flags = [`${m.deaf ? 'звук вимкнено' : m.muted ? 'мікрофон вимкнено' : 'мікрофон увімкнено'}${!m.me && !m.peek && STATE_HINT[st] ? ' · ' + STATE_HINT[st] : ''}`, ni.tip].filter(Boolean).join(' · ');
  const drag = dragAttr(m, w, from);
  const tetBtn = !m.me && m.uid && m.uid !== v.me?.id && from === 'office' && canTetRoom()
    ? `<button type="button" class="spv-kick" data-act="tet" data-uid="${esc(m.uid)}" data-name="${esc(m.name || '')}" title="Покликати ${esc(m.name || 'колегу')} у дорадчу кімнату">🤝</button>` : '';
  // data-vk — за ним рушій підсвічує того, хто говорить
  return `<li class="${cls}${drag ? ' is-draggable' : ''}"${drag} data-vk="${esc(m.key)}" title="${esc(m.name)}${m.me ? ' (ви)' : ''} — ${esc(flags)}${drag ? ' · можна перетягнути' : ''}">
      ${hero ? heroHTML(m) : `<span class="spv-ava" aria-hidden="true">${esc(initials(m.name))}</span>`}
      <span class="spv-name">${esc(m.name || 'Без імені')}${m.me ? ' <i>(ви)</i>' : ''}</span>
      ${m.deaf ? '<span class="spv-flag" aria-label="звук вимкнено">🔕</span>' : m.muted ? '<span class="spv-flag" aria-label="мікрофон вимкнено">🔇</span>' : '<span class="spv-flag" aria-label="мікрофон увімкнено">🎙</span>'}
      ${ni.dev ? `<span class="spv-flag" aria-label="${esc(ni.devTip)}">${ni.dev}</span>` : ''}
      ${ni.ping && s.inRoom && !m.peek ? `<span class="spv-ping is-${ni.cls}">${esc(ni.ping)}</span>` : ''}
      ${st === 'bad' ? '<span class="spv-flag" aria-label="немає з\'єднання">⚠</span>' : ''}
      ${tetBtn}
      ${!m.peek && canKick(m) ? `<button type="button" class="spv-kick" data-act="kick" data-uid="${esc(m.uid)}" title="Вивести гостя з кімнати відділу (дозвіл зайти знімається)">Вивести</button>` : ''}
    </li>`;
}

/** Вкладка: хто показує екран (відео — у голосовому вікні) і кнопка «Дивитися» в окремому вікні. */
function presenterHTML(s, w) {
  const pr = s.presenter;
  if (!pr) return '';
  if (!w) {
    if (pr.me) return '';
    const inside = holds() && s.inRoom;
    return `<ul class="spv-knocks"><li class="spv-knock">
      <span>🖥 <b>${esc(pr.name || 'Колега')}</b> показує екран</span>
      <button type="button" class="spv-btn is-on" data-act="watch" title="Екран колеги в окремому вікні: розгорнути, згорнути, на весь екран${inside ? '' : '. Голос не вмикається'}">⧉ ${inside ? 'Окреме вікно' : 'Дивитися'}</button>
    </li></ul>`;
  }
  const uid = (s.members || []).find((m) => m.key === pr.key)?.uid;
  if (uid && uid === v.me?.id) return '<p class="spv-note">🖥 Ви показуєте екран (з голосового вікна). Зупинити — кнопкою 🖥 у голосовому вікні.</p>';
  return `<ul class="spv-knocks"><li class="spv-knock">
      <span>🖥 <b>${esc(pr.name || 'Колега')}</b> показує екран</span>
      <button type="button" class="spv-btn is-on" data-act="wscreenwin" title="Екран колеги в окремому вікні: розгорнути, згорнути, на весь екран">⧉ Дивитися</button>
    </li></ul>`;
}

/**
 * «Показати екран» у вкладці «Справ» (25.11.2026: «зроби це окремою дією, без вікна, яке вискакує»).
 * Браузер дозволяє почати показ лише в кліку тієї сторінки, що питає, — тож екран захоплює сама вкладка
 * й віддає доріжку голосовому вікну, яке вона відкрила (link.js voiceWinRef). Показ живе, поки жива ця
 * вкладка. Вікно відкрила інша вкладка — почати можна кнопкою екрана на значку «В ефірі».
 */
async function shareFromTab() {
  const w = voiceWin();
  if (w?.sharing) return sendVoiceCmd('screen');            // зупинити
  const win = voiceWinRef();
  if (!win || typeof win.__pmgVoiceShare !== 'function') {
    return v.toast('Почніть показ кнопкою екрана на значку «В ефірі» — голосове вікно відкрила інша вкладка', true);
  }
  let s;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 } }, audio: false });
  } catch (_) { return; }                                   // людина передумала у вікні вибору
  const t = s.getVideoTracks()[0];
  let r = '';
  try { r = await win.__pmgVoiceShare(t); } catch (_) { r = ''; }
  if (r !== 'ok') {
    try { t.stop(); } catch (_) { /* уже */ }
    return v.toast('Не вдалося почати показ звідси — натисніть кнопку екрана на значку «В ефірі»', true);
  }
  v.toast('🖥 Колеги бачать ваш екран. Показ іде з цієї вкладки — не закривайте її; зупинити — тією ж кнопкою');
}

/* ───────────────────────── голос у вкладці + значок поверх усіх вікон (25.11.2026) ───────────────────────── */

/**
 * Користувач: «а може значок «В ефірі» відразу закріплюватись поверх вікон? і знову не іконка акуратна,
 * а некрасиве вікно висить». Значок поверх усіх програм (Document PiP) браузер відкриває лише в кліку тієї
 * сторінки, що тримає голос. Тож голос тепер живе у вкладці «Справ» (чи кабінету): клік «Увійти» — і в тому
 * ж кліку з'являється значок. Окремого голосового вікна з рамкою браузера більше немає. Ціна, погоджена з
 * власником: цю вкладку тримати відкритою (піти з неї — портал попередить).
 *
 * Вкладка з голосом сама каже іншим вкладкам порталу, що вона в ефірі (той самий канал, що й голосове вікно:
 * ../voice/link.js — стан і команди), тож бейдж «В ефірі» й кнопки в інших вкладках працюють, як раніше.
 *
 * Режими вкладки (v.mode): 'voice' — у голосі; 'screen' — лише показує екран (без голосу: мікрофон і звук
 * вимкнено); 'watch' — лише дивиться чужий екран. Показ екрана — окрема кнопка, від голосу не залежить.
 */

function hostSpeaking() {
  const s = v.vs;
  if (!s || !v.root) return [];
  const keys = new Set([...v.root.querySelectorAll('[data-vk].is-speaking')].map((el) => el.dataset.vk));
  return (s.members || []).filter((m) => keys.has(m.key)).map((m) => (m.me ? 'ви' : (m.name || '').split(/\s+/).slice(0, 2).join(' ')));
}

/** Стан для значка поверх усіх вікон і для інших вкладок (як у ../voice/voice-window.js). */
function hostState() {
  const s = v.vs;
  const inRoom = !!(s && s.inRoom && s.status === 'live');
  return {
    alive: v.mode === 'voice',
    host: 'tab',
    inRoom,
    status: s?.status || 'idle',
    label: roomTitle(),
    topic: s?.topic || '',
    dept: v.dept,
    muted: s ? !!s.muted : true,
    deaf: !!s?.deaf,
    count: s?.members?.length || 0,
    people: (s?.members || []).map((m) => (m.me ? `${m.name || 'ви'} (ви)` : m.name || 'Без імені')),
    speaking: hostSpeaking(),
    needGesture: !!s?.needGesture,
    idleWarn: !!s?.idleWarn,
    idleLeft: s?.idleLeft || 0,
    tet: v.tet ? 'дорадча' : '',
    tetAsk: v.tetAsk?.from_id || '',
    pip: !!v.pip?.isOpen,
    sharing: !!s?.sharing,
    canShare: false              // показ екрана — окрема кнопка, на значку його немає
  };
}

let hostLast = '';
function publishHost(force = false) {
  if (!v.bus) return;
  if (v.mode !== 'voice') {
    if (hostLast !== 'off') { hostLast = 'off'; v.bus.postMessage({ type: 'state', alive: false }); }
    v.pip?.close();
    return;
  }
  const st = hostState();
  const key = JSON.stringify(st);
  v.pip?.update();
  if (!force && key === hostLast) return;
  hostLast = key;
  v.bus.postMessage({ type: 'state', ...st });
}

/** Вкладка тримає голос: слухаємо команди інших вкладок (бейдж «В ефірі», кнопки «Справ», двері на головній). */
function setupHost() {
  if (v.bus || !window.BroadcastChannel) return;
  v.bus = new BroadcastChannel(BUS);
  v.bus.onmessage = async (e) => {
    const m = e.data;
    if (v.mode !== 'voice') return;
    if (m?.type === 'ask') return publishHost(true);
    if (m?.type !== 'cmd') return;
    v.eng.unlock();
    if (m.cmd === 'mic') await v.eng.toggleMic();
    else if (m.cmd === 'deaf') await v.eng.toggleDeaf();
    else if (m.cmd === 'leave') await leaveVoice();
    else if (m.cmd === 'focus') { try { window.focus(); } catch (_) { /* браузер не дав */ } }
    else if (m.cmd === 'intent') await applyIntent(m.params || {});
    else if (m.cmd === 'screen') { if (v.vs?.sharing) await v.eng.toggleShare(); }
    else if (m.cmd === 'screenwin') v.scr.open();
    else if (m.cmd === 'hero') { v.eng.setHero?.(m.params?.id || ''); render(); }
    publishHost(true);
  };
  setInterval(() => publishHost(true), HEARTBEAT);
  setInterval(() => { if (v.mode === 'voice') publishHost(); }, 300);   // хто говорить — на значок
  window.addEventListener('pagehide', () => v.bus?.postMessage({ type: 'state', alive: false }));
  // Піти з вкладки, яка тримає голос чи показ, — розмова обірветься: браузер перепитає
  window.addEventListener('beforeunload', (e) => {
    if (!v.local || !v.mode || !v.vs?.inRoom) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

/** Кнопки значка поверх усіх вікон. */
async function pipAct(cmd) {
  v.eng.unlock();
  if (cmd === 'mic') {
    if (v.vs?.deaf) await v.eng.toggleDeaf();     // звук вимкнено — повертаємо і звук, і мікрофон
    else await v.eng.toggleMic();
  } else if (cmd === 'panel') {
    try { window.focus(); } catch (_) { /* браузер не дав */ }
    v.root?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (cmd === 'leave') {
    await leaveVoice();
  } else if (cmd === 'here') {
    v.eng.stillHere();
  }
  publishHost(true);
}

/** Значок поверх усіх вікон — ВИКЛИКАТИ СИНХРОННО В КЛІКУ (вимога браузера). */
function startPip() {
  if (!v.pip) v.pip = createPip({ getState: hostState, act: pipAct, onToggle: () => publishHost(true) });
  if (v.pip.supported && !v.pip.isOpen) v.pip.open();
}

/** Вийти з голосу у вкладці: нарада зберігається, значок зникає, вкладка — «лише дивлюся». */
async function leaveVoice() {
  if (v.meet?.active) {
    if (!confirm('Іде запис наради. Завершити нараду й зберегти запис?')) return;
    await v.meet.finish();
  }
  if (v.tet) v.tet = null;
  if (v.vs?.sharing) await v.eng.toggleShare();
  lsSet(LS_OFF, '1');
  v.mode = '';
  v.local = false;
  publishHost(true);
  await openRoom();
  await v.eng.exit();
  render();
}

/* ───────────────────────── показ екрана — окремо від голосу (25.11.2026) ───────────────────────── */

const waitFor = async (ok, ms) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 120)); return ok(); };

/**
 * Зайти в кімнату без голосу (показ чи перегляд екрана): мікрофон і звук вимкнено. Кімната та сама —
 * відео ходить тими самими з'єднаннями, тож нових каналів і міграцій немає.
 */
async function joinSilent(mode) {
  if (v.elsewhere) { takeOver(); await waitFor(() => v.holder, 3000); }
  v.local = true;
  v.mode = mode;
  lsSet(LS_OFF, null);
  await openRoom();
  if (v.eng.state && !v.eng.state.inRoom) await v.eng.enter();
  await waitFor(() => v.eng.state?.status === 'live' && v.eng.state?.inRoom, 10000);
  if (v.eng.state?.inRoom && !v.eng.state.deaf) await v.eng.toggleDeaf();
  return !!v.eng.state?.inRoom;
}

/** Показ скінчився, перегляд закрито — виходимо з кімнати (якщо були там лише заради екрана). */
async function leaveSilent() {
  if (v.mode !== 'screen' && v.mode !== 'watch') return;
  v.mode = '';
  v.local = false;
  v.watch = null;
  await openRoom();
  await v.eng.exit();
  render();
}

/** «Показати екран» / «Зупинити показ». Екран захоплює ця вкладка у своєму кліку. */
async function shareScreen() {
  if (v.vs?.sharing) {
    await v.eng.toggleShare();
    if (v.mode === 'screen') await leaveSilent();
    return render();
  }
  if (!holds() && voiceWin()) return v.toast('Ви в голосі в іншій вкладці порталу — почніть показ там', true);
  let s;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 } }, audio: false });
  } catch (_) { return; }                                   // людина передумала у вікні вибору
  const t = s.getVideoTracks()[0];
  if (!t) return;
  v.scrStarting = true;
  try {
    if (!holds() || !v.vs?.inRoom) {
      if (!(await joinSilent('screen'))) {
        t.stop();
        await leaveSilent();
        return v.toast('Не вдалося зайти в кімнату відділу — спробуйте ще раз', true);
      }
    }
    const r = await v.eng.shareTrack(t);
    if (r !== 'ok') {
      try { t.stop(); } catch (_) { /* уже */ }
      if (v.mode === 'screen') await leaveSilent();
      return v.toast('Не вдалося почати показ — спробуйте ще раз', true);
    }
    v.toast(v.mode === 'screen'
      ? '🖥 Колеги у відділі бачать ваш екран. Голос вимкнено. Зупинити — «Зупинити показ»'
      : '🖥 Колеги бачать ваш екран. Зупинити — «Зупинити показ»');
  } finally {
    v.scrStarting = false;
    render();
  }
}

/** «Дивитися» чужий екран: вікно — одразу, в кліку (інакше браузер заблокує), далі заходимо без голосу. */
async function watchScreen() {
  if (holds() && v.vs?.inRoom) { v.scr.open(true); return; }
  if (!holds() && voiceWin()) { focusVoiceWindow(); return sendVoiceCmd('screenwin'); }
  v.scr.open(true);
  v.watch = { since: Date.now(), saw: false };
  if (!(await joinSilent('watch'))) {
    v.scr.close();
    await leaveSilent();
    v.toast('Не вдалося підключитися до показу — спробуйте ще раз', true);
  }
}

/** Режими без голосу закінчуються самі: показ зупинили в панелі браузера, показ колеги скінчився, вікно закрили. */
function watchSilent(s) {
  if (s.status !== 'live' || !s.inRoom) return;
  if (v.mode === 'screen' && !s.sharing && !v.scrStarting) { leaveSilent(); return; }
  if (v.mode !== 'watch' || !v.watch) return;
  if (s.presenter && !s.presenter.me) v.watch.saw = true;
  const gone = v.watch.saw && !s.presenter;
  const closed = !v.scr.isOpen && Date.now() - v.watch.since > 4000;
  if (gone || closed) leaveSilent();
}

/** Колега почав показ, а ми не в кімнаті — підказка (рушій сам тостить лише тим, хто в кімнаті). */
function notePresenter(s) {
  const k = s.presenter && !s.presenter.me ? s.presenter.key : '';
  if (k === v.seenPresenter) return;
  v.seenPresenter = k;
  if (k && !s.inRoom && !v.demo) v.toast(`🖥 ${s.presenter.name || 'Колега'} показує екран — «Дивитися» в панелі голосу`);
}

/* ───────────────────────── панель ───────────────────────── */

async function onClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'stillhere') { v.eng?.stillHere(); return; }
  if (act === 'micpick') return openMicPicker(v.demo ? null : v.eng, { toast: v.toast });
  if (act === 'visit') { v.showDepts = !v.showDepts; return render(); }
  if (v.demo && ['knock', 'unvisit'].includes(act)) return v.toast('У демо стук не працює');
  if (v.demo && ['kok', 'kno', 'kick', 'greetdemo', 'chimedemo'].includes(act)) return demoAct(act, b.dataset);
  if (act === 'knock') return knock(b.dataset.dept);
  if (act === 'kick') return kick(b.dataset.uid);
  if (act === 'unvisit') return endVisit(true);
  if (act === 'home') return applyIntent({});
  if (act === 'kok' || act === 'kno') return decide(b.dataset.id, act === 'kok');
  // Дорадча кімната
  if (act === 'tet') return callTet({ uid: b.dataset.uid, name: b.dataset.name });
  if (act === 'tetok' || act === 'tetno') return answerTet(act === 'tetok');
  if (act === 'tetback') return goOffice();
  if (act === 'tetsolo') return goTet();
  if (act === 'view') { lsWrite(VIEW_LS, b.dataset.view === 'hero' ? 'hero' : ''); if (b.dataset.view !== 'hero') v.heroPick = false; return render(); }
  if (act === 'heropick') { v.heroPick = !v.heroPick; return render(); }
  if (act === 'hero') {
    const id = b.dataset.hero;
    lsWrite('pmg-voice-hero', id);
    v.eng?.setHero?.(id);                   // рушій перешле колегам (присутність)
    if (!holds() && voiceWin()) sendVoiceCmd('hero', { id });
    v.heroPick = false;
    v.toast(`🧩 Ваш герой — «${HEROES.find((h) => h.id === id)?.name || ''}». Колеги побачать його в просунутому вигляді`);
    return render();
  }
  if (v.demo) return demoAct(act);
  // Голос у голосовому вікні — кнопки панелі вкладки керують ним
  if (act === 'wmic') return sendVoiceCmd('mic');
  if (act === 'wleave') return sendVoiceCmd('leave');
  if (act === 'wfocus') return focusVoiceWindow();
  if (act === 'wback') return sendVoiceCmd('intent', {});
  if (act === 'wscreen') return shareFromTab();
  if (act === 'share') return shareScreen();
  if (act === 'watch') return watchScreen();
  if (act === 'wscreenwin') { focusVoiceWindow(); return sendVoiceCmd('screenwin'); }
  if (act === 'leave' && v.win) return leaveWin();
  v.eng.unlock();
  if (act === 'mic') await v.eng.toggleMic();
  else if (act === 'deaf') await v.eng.toggleDeaf();
  else if (act === 'screen') { await v.eng.toggleShare(); render(); }
  else if (act === 'meet') { await v.meet.start({ topic: v.eng.topic, label: roomTitle() }); render(); }
  else if (act === 'meetend') { await v.meet.finish(); render(); }
  else if (act === 'leave' && v.tet && !v.win) await leaveTet();
  else if (act === 'leave' && !v.win) await leaveVoice();
  else if (act === 'leave') {
    // Ви записуєте нараду — вихід її завершує (інакше запис пропаде)
    if (v.meet.active) {
      if (!confirm('Іде запис наради. Завершити нараду й зберегти запис?')) return;
      await v.meet.finish();
    }
    lsSet(LS_OFF, '1');
    v.local = false;
    await v.eng.exit();
  }
  else if (act === 'join') await joinRoom();
}

const STATE_HINT = { ok: 'на зв\'язку', wait: 'з\'єднуємо…', bad: 'немає прямого з\'єднання — потрібен ретранслятор', off: '' };

function render() {
  if (!v.root) return;
  if (v.dragging) { v.dirty = true; return; }
  v.dirty = false;
  const s = v.vs || { status: 'idle', members: [], inRoom: false, muted: true, deaf: false };
  // Вкладка без голосу: «я» в кімнаті — це голосове вікно (інший ключ, той самий uid)
  const tabOnly = !v.win && !v.local && !v.demo;
  const voiceOn = v.win || v.demo || (v.local && v.mode === 'voice');   // у голосі (а не лише показ / перегляд екрана)
  const w = tabOnly ? voiceWin() : null;
  const list = s.members.map((m) => (!m.me && tabOnly && m.uid && m.uid === v.me?.id ? { ...m, me: true, viaWin: true } : m))
    .sort((a, b) => (a.me ? -1 : b.me ? 1 : (a.name || '').localeCompare(b.name || '', 'uk')));
  const others = list.filter((m) => !m.me).length;

  let note = '';
  if (v.noDept) note = 'У профілі не вказано відділ. Голос усього департаменту — у «Чаті департаменту» (посилання вгорі).';
  else if (v.visit?.status === 'wait') note = `🚪 Стукаємо до відділу «${cap(v.visit.dept)}» — чекаємо, поки хтось пустить.`;
  else if (w && v.follow) note = `🚪 Ви в гостях: голос в окремому вікні («⧉ Вікно голосу»). Нижче — хто зараз у цій кімнаті.`;
  else if (w) note = !w.inRoom ? 'Заходимо в кімнату…' : w.host === 'tab' ? `🎙 Ви в ефірі в іншій вкладці порталу («${w.label || 'кімната'}»). Тут видно, хто в кімнаті.` : `🎙 Ви в ефірі — голос в окремому вікні («${w.label || 'кімната'}»).`;
  else if (tabOnly && v.ask) note = v.ask.tet ? '🤝 Вас кличуть у дорадчу кімнату — натисніть «Зайти».' : v.ask.voice_invite ? '🎙 Вас кличуть у голосову кімнату — натисніть «Зайти».' : '🚪 Двері відчинено — натисніть «Зайти».';
  else if (v.elsewhere && !tabOnly) note = `Голос відкрито в іншій вкладці порталу («Справи» чи кабінет). Тут видно, хто в кімнаті${list.length ? `: ${list.length}` : ''}.`;
  else if (s.status === 'joining' || s.status === 'idle') note = 'Заходимо в кімнату…';
  else if (s.status === 'error') note = s.error;
  else if (!list.length) note = 'У кімнаті нікого. Зайдіть — колеги побачать вас, коли відкриють «Справи».';
  else if (s.inRoom && !others) note = 'Поки що ви тут самі.';
  else if (!s.inRoom) note = `Ви не в кімнаті. Зараз тут: ${list.length}.`;
  if (s.status === 'live' && list.length >= MANY) note = `У кімнаті ${list.length} — пряма схема може не витягнути, звук може рватися.`;
  if (v.tet && s.status === 'live') note = others ? '' : '🤝 Ви в дорадчій самі. Перетягніть сюди колегу з офісу чи зі списку «в мережі» — він отримає запрошення.';
  if (w?.tet) note = '';
  if (v.mode === 'screen' && s.sharing) note = '🖥 Ви показуєте екран без голосу: колеги бачать екран, мікрофон і звук вимкнено.';
  if (v.mode === 'watch') note = '🖥 Дивитеся екран колеги в окремому вікні — без голосу.';
  if (s.inRoom && s.micSilent && voiceOn) note = '⚠ Ваш мікрофон нічого не передає — колеги вас не чують. Оберіть інший кнопкою «⚙».';

  const winBtns = w
    ? `<button type="button" class="spv-btn${w.muted ? '' : ' is-on'}" data-act="wmic" aria-pressed="${!w.muted}"
         title="${w.muted ? 'Увімкнути мікрофон у голосовому вікні' : 'Вимкнути мікрофон'}">${w.muted ? '🎙 Говорити' : '🎙 Мікрофон увімк.'}</button>
       ${w?.host === 'tab' ? '' : '<button type="button" class="spv-btn spv-ghost" data-act="wfocus" title="Показати голосове вікно поверх інших">⧉ Вікно голосу</button>'}
       <button type="button" class="spv-btn spv-ghost" data-act="wleave" title="Вийти з кімнати й закрити голосове вікно">Вийти</button>`
    : `<button type="button" class="spv-btn spv-join" data-act="join"
         title="Голос у цій вкладці, значок «В ефірі» — поверх усіх вікон. Вкладку тримайте відкритою">${v.ask ? '🎙 Зайти' : '🎙 Увійти в кімнату'}</button>`;
  const btns = tabOnly ? (w || s.status === 'live' || v.ask ? winBtns : '') : s.inRoom && s.status === 'live' && voiceOn
    ? `<button type="button" class="spv-btn${s.muted ? '' : ' is-on'}" data-act="mic" aria-pressed="${!s.muted}"
         title="${s.muted ? 'Увімкнути мікрофон — вас почують' : 'Вимкнути мікрофон'}">${s.muted ? '🎙 Говорити' : '🎙 Мікрофон увімк.'}</button>
       ${!s.muted ? `<label class="spv-keep" title="Зазвичай після 5 хвилин тиші мікрофон вимикається сам (за 3 хвилини до того — попередження)"><input type="checkbox" data-keep${s.keepMic ? ' checked' : ''}> не вимикати сам</label>` : ''}
       <button type="button" class="spv-btn spv-icon${s.deaf ? ' is-off' : ''}" data-act="deaf" aria-pressed="${s.deaf}"
         title="${s.deaf ? 'Увімкнути звук' : 'Вимкнути звук (і мікрофон)'}">${s.deaf ? '🔕' : '🎧'}</button>
       <button type="button" class="spv-btn spv-icon${s.micSilent ? ' is-off' : ''}" data-act="micpick" title="Обрати мікрофон і перевірити, чи він вас чує">⚙</button>
       ${v.demo ? `<button type="button" class="spv-btn spv-ghost" data-act="greetdemo" title="Демо: колега заходить у голосову кімнату вперше за день — привітання на ім'я">▶ Перший вхід</button>
       <button type="button" class="spv-btn spv-ghost" data-act="chimedemo" title="Демо: колега заходить удруге за день — мелодійний дзвінок">▶ Повторний вхід</button>` : ''}
       ${s.canRecord && !(s.recording && !s.recording.me) ? (s.recording?.me
         ? '<button type="button" class="spv-btn spv-rec is-on" data-act="meetend" aria-pressed="true" title="Іде запис. Натисніть, щоб зупинити й зберегти нараду — протокол підготує Claude"><i class="rec-dot" aria-hidden="true"></i>Кінець наради</button>'
         : '<button type="button" class="spv-btn spv-rec" data-act="meet" aria-pressed="false" title="Почати нараду: увімкнеться запис, усіх у кімнаті буде попереджено"><i class="rec-dot" aria-hidden="true"></i>Нарада</button>') : ''}
       <button type="button" class="spv-btn spv-ghost" data-act="leave" title="${v.win ? 'Вийти з кімнати й закрити голосове вікно' : 'Вийти з кімнати; запамʼятаємо до наступного «Увійти»'}">Вийти</button>`
    : s.status === 'live'
      ? (v.elsewhere
        ? '<button type="button" class="spv-btn spv-join" data-act="join" title="Голос перейде сюди, а в іншій вкладці стане «лише дивлюся»">🎧 Перенести голос сюди</button>'
        : '<button type="button" class="spv-btn spv-join" data-act="join" title="Голос у цій вкладці, значок «В ефірі» — поверх усіх вікон. Вкладку тримайте відкритою">🎙 Увійти в кімнату</button>')
      : '';

  // Пульс кнопок прив'язано до годинника: панель перемальовується що кілька секунд, і без цього анімація
  // щоразу починалася б спочатку — «нервово смикалась» (25.11.2026)
  v.root.style.setProperty('--pulse-t', (performance.now() / 1000).toFixed(2));
  v.root.innerHTML = `<div class="spv-main">
    ${viewBarHTML()}
    ${roomsHTML(s, w, list)}
    ${s.recording ? `<p class="spv-recbar">🔴 Іде запис наради · ${s.recording.me ? 'записуєте ви' : 'увімкнув(-ла) ' + esc(s.recording.name)} · з ${new Date(s.recording.since).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</p>` : ''}
    ${note ? `<p class="spv-note${s.status === 'error' || (s.inRoom && s.micSilent) ? ' is-bad' : ''}">${esc(note)}</p>` : ''}
    ${s.needGesture ? '<button type="button" class="spv-btn spv-sound" data-act="sound">🔊 Натисніть, щоб чути колег</button>' : ''}
    ${idleHTML(s, voiceOn)}
    ${knocksHTML()}
    ${tetHTML()}
    ${presenterHTML(s, w)}
    <div class="spv-actions">${screenBtnHTML(s, w)}${btns}${visitBtnsHTML(s)}</div>
    ${v.showDepts ? deptsHTML() : ''}</div>`;
}

/** Довго мовчите з увімкненим мікрофоном — попередження з відліком (рушій вимкне мікрофон сам). */
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function idleHTML(s, voiceOn) {
  if (!s.idleWarn || !voiceOn) return '';
  return `<ul class="spv-knocks"><li class="spv-knock spv-idle" role="alert">
      <span>🤫 Ви давно мовчите, а мікрофон увімкнено — вимкнемо його за <b>${mmss(s.idleLeft || 0)}</b></span>
      <button type="button" class="spv-btn is-on" data-act="stillhere">Я тут, лишити</button>
      <label class="spv-keep"><input type="checkbox" data-keep${s.keepMic ? ' checked' : ''}> не вимикати автоматично</label>
    </li></ul>`;
}

/** «Показати екран» — окрема кнопка, від голосу не залежить (25.11.2026). */
function screenBtnHTML(s, w) {
  if (v.noDept || !(s.canShare || v.demo)) return '';
  const on = !!s.sharing || !!w?.sharing;
  const act = !holds() && w ? 'wscreen' : 'share';
  return `<button type="button" class="spv-btn spv-share${on ? ' is-on' : ''}" data-act="${act}" aria-pressed="${on}"
    title="${on ? 'Зупинити показ екрана' : 'Показати колегам у відділі свій екран, вікно чи вкладку — голос вмикати не треба'}"><svg class="spv-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4M12 13.5V8M9.5 10.5 12 8l2.5 2.5"/></svg>${on ? 'Зупинити показ' : 'Показати екран'}</button>`;
}

/** Гість нашої кімнати, впущений за стуком: вивести може будь-хто з відділу (не з чужої кімнати). */
function canKick(m) {
  if (m.me || !m.uid || v.visit || v.dept !== v.home) return false;
  return v.guests.has(m.uid) || (v.demo && m.guest);
}

/** Хто стукає в нашу кімнату — пустити може будь-хто з відділу. */
function knocksHTML() {
  if (!v.knocks.length) return '';
  return `<ul class="spv-knocks">${v.knocks.map((k) => `<li class="spv-knock">
      <span>🚪 <b>${esc(k.name || 'Колега')}</b>${k.from_dept ? ` <i>(${esc(k.from_dept)})</i>` : ''} просить зайти</span>
      <button type="button" class="spv-btn is-on" data-act="kok" data-id="${esc(k.id)}">Впустити</button>
      <button type="button" class="spv-btn spv-ghost" data-act="kno" data-id="${esc(k.id)}">Не зараз</button>
    </li>`).join('')}</ul>`;
}

/** «🚪 В гості» / «Скасувати стук» / «← До свого відділу». */
function visitBtnsHTML(s) {
  if (!v.demo && v.noKnock && !LEAD.includes(v.role)) return '';
  if (!v.home || v.home === ALL || !v.depts?.length || v.elsewhere) return '';
  if (!v.demo && !v.win && !v.local) return '';   // гостювання — у голосовому вікні (там голос)
  if (v.tet) return '';   // «← До відділу» — у зоні дорадчої кімнати
  // Вікно перейшло в кімнату департаменту — шлях назад до свого відділу
  if (v.dept === ALL) return '<button type="button" class="spv-btn" data-act="home" title="Перейти в голосову кімнату свого відділу">← До свого відділу</button>';
  if (v.visit?.status === 'wait') return '<button type="button" class="spv-btn spv-ghost" data-act="unvisit">Скасувати стук</button>';
  if (v.visit?.status === 'in') return '<button type="button" class="spv-btn" data-act="unvisit" title="Повернутися в кімнату свого відділу">← До свого відділу</button>';
  if (s.status !== 'live') return '';
  return `<button type="button" class="spv-btn spv-ghost${v.showDepts ? ' is-on' : ''}" data-act="visit" aria-expanded="${v.showDepts}"
    title="Зайти в голосову кімнату іншого відділу департаменту — там вас мають пустити">🚪 В гості</button>`;
}

function deptsHTML() {
  const list = v.depts.filter((d) => d !== v.home);
  return `<div class="spv-visit" role="group" aria-label="Кімнати інших відділів">
    <span class="spv-visit-hint">${LEAD.includes(v.role) ? 'Зайти в кімнату відділу:' : 'Постукати в кімнату відділу — зайдете, коли хтось із них пустить:'}</span>
    ${list.map((d) => `<button type="button" class="spv-btn spv-ghost" data-act="knock" data-dept="${esc(d)}">${esc(cap(d))}</button>`).join('')}
  </div>`;
}

function plural(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'учасник';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'учасники';
  return 'учасників';
}

/* ───────────────────────── демо (?demo=1) ───────────────────────── */

function demo() {
  v.vs = {
    status: 'live', inRoom: true, muted: true, deaf: false, micBeforeDeaf: false, needGesture: false,
    members: [
      { key: 'me', name: v.name || 'Демо-користувач', muted: true, deaf: false, me: true, state: 'ok', dev: 'pc' },
      { key: 'd1', uid: 'demo-d1', name: 'Олена Приклад', muted: false, deaf: false, state: 'ok', dev: 'pc', net: { rtt: 42, loss: 0, relay: false } },
      { key: 'd2', uid: 'demo-d2', name: 'Петро Зразок', muted: true, deaf: false, state: 'ok', dev: 'mob', net: { rtt: 420, loss: 0.1, relay: true } },
      // Гість з іншого відділу, якого впустили за стуком: біля нього «Вивести»
      { key: 'd3', uid: 'demo-guest', guest: true, name: 'Марко Гість', muted: true, deaf: false, state: 'ok', dev: 'pc', net: { rtt: 60, loss: 0, relay: false } }
    ]
  };
  // Демо дорадчої: там уже хтось є (друга кімната — «підглядання»)
  v.peek = [{ uid: 'demo-t1', name: 'Наталія Приклад', muted: false, deaf: false, dev: 'pc' }];
  // Демо стуку: колега з іншого відділу просить зайти
  v.knocks = [{ id: 'k1', name: 'Ірина Взірець', from_dept: 'розрахунок вартості медичних послуг' }];
  render();
  // Імітація: «Олена» час від часу говорить
  setInterval(() => {
    const el = v.root.querySelector('[data-vk="d1"]');
    if (el) el.classList.toggle('is-speaking', Math.random() > 0.5);
  }, 700);
}

function demoAct(act, ds = {}) {
  const s = v.vs;
  const me = s.members.find((m) => m.me);
  if (act === 'kok' || act === 'kno') {
    const k = v.knocks.find((x) => x.id === ds.id);
    v.knocks = v.knocks.filter((x) => x.id !== ds.id);
    if (k && act === 'kok') s.members.push({ key: 'd4', uid: 'demo-guest2', guest: true, name: k.name, muted: true, deaf: false, state: 'ok', dev: 'pc' });
    v.toast(act === 'kok' ? `✅ ${k?.name || 'Гість'} заходить у кімнату` : `${k?.name || 'Гостю'} відповіли «Не зараз»`);
  }
  if (act === 'kick') {
    const g = s.members.find((m) => m.uid === ds.uid);
    s.members = s.members.filter((m) => m.uid !== ds.uid);
    v.toast(`🚪 ${g?.name || 'Гостя'} — виведено з кімнати`);
  }
  // Демо звуку входу: той самий запис, що в рушії (../zviazok/greet.js)
  if (act === 'greetdemo' || act === 'chimedemo') {
    s.members = s.members.filter((m) => m.key !== 'dd');
    s.members.push({ key: 'dd', name: 'Олена Приклад-друга', muted: true, deaf: false, state: 'ok', dev: 'pc' });
    const g = greetFor('Олена');
    if (act === 'greetdemo') v.toast(`🎉 ${g.text}`); else v.toast('🎧 Олена Приклад-друга — у кімнаті');
    if (!s.deaf) playClip(act === 'greetdemo' ? g.src : CHIME, act === 'greetdemo' ? 0.9 : 0.7).catch(() => {});
  }
  if (act === 'mic') { s.muted = !s.muted; if (!s.muted) s.deaf = false; }
  if (act === 'deaf') {
    s.deaf = !s.deaf;
    if (s.deaf) { s.micBeforeDeaf = !s.muted; s.muted = true; } else if (s.micBeforeDeaf) { s.muted = false; s.micBeforeDeaf = false; }
  }
  if (me) Object.assign(me, { muted: s.muted, deaf: s.deaf });
  if (act === 'leave') { s.inRoom = false; s.members = s.members.filter((m) => !m.me); }
  if (act === 'join') { s.inRoom = true; s.members.unshift({ key: 'me', name: v.name || 'Демо-користувач', muted: s.muted, deaf: s.deaf, me: true, state: 'ok' }); }
  render();
}
