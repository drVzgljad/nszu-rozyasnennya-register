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
 * - 🤝 Дорадча кімната (25.11.2026): під списком учасників — зона «Дорадча кімната». Начальник (manager і
 *   вище) перетягує в неї колегу з кімнати відділу чи зі списку «в мережі» (або тисне 🤝 біля імені) і сам
 *   переходить туди чекати; колега отримує «Зайти / Ні». Канал — 1:1 'voice:dm:<uuid>:<uuid>', за RLS лише
 *   двоє (migration_2026-11-25_voice_tet.sql). «← До відділу» — назад; відмова, вихід співрозмовника чи
 *   «ніхто не прийшов» за TET_WAIT повертають самі.
 * - Показ екрана з вкладки (25.11.2026): у вкладці «Справ» і кабінету знову є 🖥 — команда йде у вікно, а
 *   там браузер вимагає клік: вікно просить «🖥 Обрати, що показати». Екран спікера відкривається в
 *   окремому вікні (../voice/screen-win.js) — розгорнути, згорнути, на весь екран.
 */

import { createVoice, netInfo } from '../zviazok/voice.js?v=20261125a';
import { greetFor, playClip, CHIME } from '../zviazok/greet.js?v=20261117a';
import { openMicPicker } from '../zviazok/mic-picker.js?v=20261106a';
import { createMeeting } from '../zviazok/meeting.js?v=20261103a';
import { createStage } from '../zviazok/stage.js?v=20261125a';
import { createScreenWin } from '../voice/screen-win.js?v=20261125a';
import { openVoiceWindow, voiceWin, onVoiceWin, sendVoiceCmd, focusVoiceWindow } from '../voice/link.js?v=20261125b';

const MANY = 10;               // з такої кількості попереджаємо: пряма схема важчає
const LS_OFF = 'spravy-voice-off';
const ALL = '*';               // «відділ» = увесь департамент (перемикач у spravy.js)
const LOCK = 'pmg-voice-holder';   // замок «ця вкладка тримає голос» (Web Locks)
const BC = 'pmg-voice-tabs';       // канал між вкладками: «віддай голос»
const LEAD = ['admin', 'director', 'deputy_director'];   // заходять у будь-яку кімнату без стуку
const BOSS = ['manager', ...LEAD];                        // кличуть колегу в дорадчу кімнату (тет-а-тет)
const TET_WAIT = 90e3;                                    // скільки чекаємо співрозмовника в дорадчій (як запрошення в auth-v2)
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');

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
  tet: null,           // { uid, name, topic, since, met, alone } — ми в розмові віч-на-віч
  tetAsk: null,        // { from_id, from_name, at } — нас кличуть
  dragging: false,     // начальник тягне колегу: панель не перемальовуємо, щоб не зірвати перетягування
  dirty: false,        // перемалювати, щойно перетягування скінчиться
  askShare: false,     // показ попросили з вкладки — потрібен клік у вікні
  scr: null            // окреме вікно екрана спікера (../voice/screen-win.js)
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
  setupInviteDrop();
  if (v.demo) return demo();
  const host = document.createElement('section');
  v.root.after(host);
  v.scr = createScreenWin();
  v.stage = createStage(host, { onStop: () => v.eng.toggleShare(), onPop: () => v.scr.open() });
  v.eng = createVoice({ sb: v.sb, me: v.me, name: v.name, role: v.role, toast: v.toast, onMsg: onRoomMsg, onChange: (s) => {
    v.vs = s;
    if (s.sharing) v.askShare = false;
    watchTet(s);
    render();
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
  ['room', 'mic', 'door', 'door_dept', 'voice_invite', 'knock', 'tet'].forEach((k) => { if (qs.get(k)) intent[k] = qs.get(k); });
  if (Object.keys(intent).length) {
    const u = new URL(location.href);
    Object.keys(intent).forEach((k) => u.searchParams.delete(k));
    history.replaceState(null, '', u);
  }
  if (v.win) { winStart(intent); return api(); }

  // Вкладка розділу: голос — у голосовому вікні; тут видно, хто в кімнаті, і кнопки для вікна
  window.__pmgVoice = {
    acceptInvite: (p) => { v.local = true; return acceptInvite(p); },
    acceptTet: (p) => { v.local = true; return applyIntent({ tet: JSON.stringify(p) }); }
  };
  if (Object.keys(intent).length) { v.ask = intent; lsSet(LS_OFF, null); }
  onVoiceWin((w) => {
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
    if (v.holder) { v.holder = false; v.elsewhere = true; v.local = false; openRoom(); }
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
    // Показ екрана, попрошений із вкладки: без кліку тут браузер не почне — просимо натиснути
    share: async () => {
      const r = await v.eng.toggleShare();
      if (r === 'gesture') {
        v.askShare = true;
        render();
        try { window.focus(); } catch (_) { /* браузер не дав */ }
        v.toast('Натисніть «🖥 Обрати, що показати» у цьому вікні — інакше браузер не почне показ');
      }
    },
    openScreen: () => {
      if (!v.scr.open()) v.toast('Браузер не дав відкрити вікно саме — натисніть «⧉ Окреме вікно» над екраном колеги', true);
    },
    get tet() { return v.tet ? v.tet.name : ''; },
    /** Щось у панелі вимагає дії — голосове вікно розгортає її зі значка (25.11.2026). */
    get needs() { return !!(v.tetAsk || v.askShare || v.knocks.length || v.vs?.status === 'error' || (v.tet && !v.tet.met)); },
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
  if (p.tet) { const a = parse(p.tet); if (a?.from_id) await enterTet(a.from_id, a.from_name); return; }
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
  if (openVoiceWindow(p)) return render();
  v.local = true;
  v.toast('Браузер не дав відкрити голосове вікно — голос у цій вкладці. Дозвольте спливні вікна для порталу, і розмова не обриватиметься під час переходів', true);
  applyIntent(p);
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
  const zone = (e) => e.target.closest?.('[data-tetzone]');
  // Начальник тягне колегу з кімнати відділу (рядок учасника) — у зону «Дорадча кімната»
  v.root.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('li[data-drag-uid]');
    if (!li) return;
    e.dataTransfer.setData('application/x-pmg-user', JSON.stringify({ id: li.dataset.dragUid, name: li.dataset.dragName, room: 1 }));
    e.dataTransfer.effectAllowed = 'copyMove';
    v.dragging = true;
    v.root.classList.add('is-dragging');
  });
  v.root.addEventListener('dragend', () => {
    v.dragging = false;
    v.root.classList.remove('is-dragging', 'is-drop');
    if (v.dirty) render();
  });
  v.root.addEventListener('dragover', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    const z = zone(e);
    e.dataTransfer.dropEffect = z ? 'move' : 'copy';
    v.root.querySelectorAll('[data-tetzone]').forEach((el) => el.classList.toggle('is-over', el === z));
    v.root.classList.toggle('is-drop', !z && !v.dragging);
  });
  v.root.addEventListener('dragleave', (e) => {
    if (!v.root.contains(e.relatedTarget)) {
      v.root.classList.remove('is-drop');
      v.root.querySelectorAll('[data-tetzone]').forEach((el) => el.classList.remove('is-over'));
    }
  });
  v.root.addEventListener('drop', (e) => {
    v.root.classList.remove('is-drop', 'is-dragging');
    const z = zone(e);
    v.root.querySelectorAll('[data-tetzone]').forEach((el) => el.classList.remove('is-over'));
    v.dragging = false;
    const raw = e.dataTransfer.getData('application/x-pmg-user');
    if (!raw) return;
    e.preventDefault();
    let u = null;
    try { u = JSON.parse(raw); } catch (_) { return; }   // не наш формат
    if (z) callTet({ uid: u.id, name: u.name });
    else if (!u.room) invite(u);                         // свій же рядок кинули мимо зони — нічого
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

const roomTitle = () => (v.tet ? `🤝 Дорадча: ${v.tet.name}` : '') || v.follow || (v.dept === ALL ? 'Кімната департаменту'
  : v.visit?.status === 'in' ? `В гостях: ${cap(v.dept)}` : 'Голосовий офіс відділу');

async function openRoom() {
  if (v.tet) { v.noDept = false; await v.eng.join(v.tet.topic, roomTitle(), { listen: false }); return; }
  v.noDept = !v.dept;
  if (v.noDept) { await v.eng.leave(true); return render(); }
  const topic = await topicFor(v.dept);
  // Рушій сам перемикає кімнату: мікрофон і звук лишаються, як були.
  // З 19.11.2026 вкладка розділу в ефір сама не йде — голос у голосовому вікні (крім запасного v.local)
  await v.eng.join(topic, roomTitle(), { listen: !v.win && (v.elsewhere || !v.local) });
}

/** Зайти в кімнату (кнопка «Увійти»). */
async function joinRoom() {
  if (v.demo) return v.vs.inRoom ? null : demoAct('join');
  if (!v.win && !v.local) return requestVoice(v.ask || (v.dept === ALL ? { room: 'all' } : {}));
  if (v.elsewhere) { lsSet(LS_OFF, null); return takeOver(); }
  lsSet(LS_OFF, null);
  v.eng.unlock();
  await v.eng.enter();
}

/* ───────────────────────── дорадча кімната (тет-а-тет, 25.11.2026) ───────────────────────── */

/**
 * Начальник перетягує колегу в зону «🤝 Дорадча кімната» (або 🤝 біля імені) — і сам одразу переходить
 * туди чекати. Колега отримує «Зайти / Ні»: з вкладки порталу запрошення йде через «в мережі»
 * (auth-v2.js, дійде на будь-яку сторінку), з голосового вікна — повідомленням кімнати відділу.
 * Відмова повертає начальника назад; ніхто не зайшов за TET_WAIT — теж.
 */

/** Канал 1:1 — той самий, що в дзвінку «Чату департаменту» (voiceTopic): лише двоє за RLS. */
const tetTopic = (a, b) => { const [x, y] = [a, b].sort(); return `voice:dm:${x}:${y}`; };
const isBoss = () => v.demo || BOSS.includes(v.role);
const canCallTet = () => isBoss() && !v.tet && !voiceWin()?.tet;
const canTet = (m) => !m.me && !!m.uid && m.uid !== v.me?.id && canCallTet() && (v.demo || holds() || !!voiceWin());

/** Повідомлення кімнати (рушій, broadcast 'room'): запрошення, відмова. */
function onRoomMsg(p) {
  if (!p || !v.me || p.to !== v.me.id) return;
  if (p.t === 'tet') {
    if (!holds() && !voiceWin()) return;      // нас немає в кімнаті — кликати нікуди
    if (v.tet || voiceWin()?.tet) {
      v.eng.say({ t: 'tet-reply', to: p.from_id, from_id: v.me.id, from_name: v.name, ok: false, busy: true });
      return;
    }
    const at = Date.now();
    v.tetAsk = { from_id: p.from_id, from_name: p.from_name || 'Керівник', at };
    if (holds()) {
      v.toast(`🤝 ${v.tetAsk.from_name} кличе вас у дорадчу кімнату — поговорити віч-на-віч`);
      try { window.focus(); } catch (_) { /* браузер не дав */ }
    }
    setTimeout(() => { if (v.tetAsk?.at === at) { v.tetAsk = null; render(); } }, TET_WAIT);
    render();
  } else if (p.t === 'tet-reply' && !p.ok) {
    tetDeclined({ uid: p.from_id, name: p.from_name, busy: p.busy });
  }
}

/**
 * Колега відмовився. Начальник уже в дорадчій (голос у вікні), а відмова прийшла туди, де він ще чує
 * кімнату відділу, — у вкладку (рушій «лише дивлюся» чи «в мережі»). Вкладка передає її вікну.
 */
function tetDeclined(d) {
  if (!d?.uid) return;
  if (!holds()) { if (voiceWin()?.tet) sendVoiceCmd('intent', { tet_declined: JSON.stringify(d) }); return; }
  if (!v.tet || v.tet.uid !== d.uid || v.tet.met) return;
  leaveTet(d.busy ? `${d.name || 'Колега'} зараз в іншій розмові віч-на-віч` : `${d.name || 'Колега'}: «не зараз»`, true);
}

/** Покликати колегу в дорадчу кімнату й самому перейти туди чекати. */
async function callTet(u) {
  if (!u?.uid || u.uid === v.me?.id || !canCallTet()) return;
  const name = u.name || 'Колега';
  if (v.demo) return v.toast(`У демо не кличемо. Тут ${name} отримав(-ла) б «Зайти / Ні», а ви перейшли б у дорадчу кімнату чекати`);
  if (!holds()) {
    if (!voiceWin()) return v.toast('Спершу увійдіть у кімнату відділу («🎙 Увійти в кімнату») — тоді колегу можна покликати в дорадчу', true);
    // Запрошення — через «в мережі»: дійде, на якій би сторінці порталу колега не був
    window.dispatchEvent(new CustomEvent('pmg:voice-invite-send',
      { detail: { to: u.uid, from_id: v.me.id, from_name: v.name, dept: v.dept, tet: 1 } }));
    sendVoiceCmd('intent', { tet_call: JSON.stringify({ uid: u.uid, name, sent: 1 }) });
    v.toast(`🤝 Покликали ${name} у дорадчу кімнату — чекаємо там`);
    return;
  }
  // Голосове вікно: «в мережі» тут немає — кличемо повідомленням кімнати відділу (поки ще в ній)
  if (!u.sent) await v.eng.say({ t: 'tet', to: u.uid, from_id: v.me.id, from_name: v.name });
  if (!u.sent) v.toast(`🤝 Покликали ${name} у дорадчу кімнату — чекаємо там`);
  await enterTet(u.uid, name);
}

/** «Зайти» / «Не зараз» на запрошення в панелі. Відмова — каналом кімнати відділу. */
async function answerTet(ok) {
  const a = v.tetAsk;
  v.tetAsk = null;
  if (!a || v.demo) return render();
  if (!ok) { await v.eng.say({ t: 'tet-reply', to: a.from_id, from_id: v.me.id, from_name: v.name, ok: false }); return render(); }
  if (!holds()) {
    sendVoiceCmd('intent', { tet: JSON.stringify(a) });
    focusVoiceWindow();
    return render();
  }
  await enterTet(a.from_id, a.from_name);
}

async function enterTet(uid, name) {
  v.tetAsk = null;
  if (v.visit) await endVisit(false);
  v.tet = { uid, name: name || 'Колега', topic: tetTopic(v.me.id, uid), since: Date.now(), met: false, alone: 0 };
  await openRoom();
  if (v.eng.state && !v.eng.state.inRoom) await v.eng.enter();
  render();
}

/** Назад у кімнату відділу (кнопка або сам: співрозмовник вийшов, відмовився чи не зайшов). */
async function leaveTet(msg, bad) {
  if (!v.tet) return;
  v.tet = null;
  if (msg) v.toast(msg, bad);
  if (v.meet?.active) await v.meet.finish();
  await openRoom();
  if (v.eng.state && !v.eng.state.inRoom) await v.eng.enter();
  render();
}

function watchTet(s) {
  const t = v.tet;
  if (!t || !holds() || s.topic !== t.topic) return;
  if (s.status === 'error') { leaveTet('Дорадча кімната ще закрита: потрібна міграція бази (migration_2026-11-25_voice_tet.sql)', true); return; }
  if (s.status !== 'live') return;
  const others = (s.members || []).filter((m) => !m.me).length;
  if (others) { t.met = true; t.alone = 0; return; }
  if (!t.met) {
    if (Date.now() - t.since > TET_WAIT) leaveTet(`${t.name} так і не зайшов(-ла) — повертаємось у кімнату відділу`, true);
    return;
  }
  if (t.alone) return;
  t.alone = Date.now();
  setTimeout(() => { if (v.tet === t && t.alone) leaveTet(`${t.name} вийшов(-ла) з дорадчої кімнати — повертаємось у кімнату відділу`); }, 4000);
}

/** Запрошення на тет-а-тет у панелі (нас кличуть). */
function tetHTML() {
  if (!v.tetAsk) return '';
  return `<ul class="spv-knocks"><li class="spv-knock">
      <span>🤝 <b>${esc(v.tetAsk.from_name)}</b> кличе вас у дорадчу кімнату — поговорити віч-на-віч</span>
      <button type="button" class="spv-btn is-on" data-act="tetok">Зайти</button>
      <button type="button" class="spv-btn spv-ghost" data-act="tetno">Не зараз</button>
    </li></ul>`;
}

/**
 * Картка «🤝 Дорадча кімната» поруч із карткою голосового офісу (25.11.2026: «красиво виділимо
 * голосовий офіс відділу і дорадчу кімнату, а то в очі кидається лише дорадча»). Начальнику — куди
 * перетягнути колегу; з вкладки, поки голосове вікно в дорадчій, — з ким і «← До відділу».
 * Колегам без ролі начальника картку не показуємо. Коли сама панель у дорадчій (v.tet), окремої картки
 * немає — тоді дорадча і є головна картка (roomCardHTML).
 */
function tetZoneHTML(w) {
  if (v.noDept || v.tet) return '';
  const head = (sub) => `<header class="spv-room-head"><span class="spv-room-ico" aria-hidden="true">🤝</span>
      <span class="spv-room-title"><b>Дорадча кімната</b><small>${sub}</small></span></header>`;
  if (w?.tet) {
    return `<section class="spv-room is-tet is-busy">${head(`Ви з ${esc(w.tet)} · голос у голосовому вікні`)}
      <p class="spv-room-hint">Колеги у відділі вас не чують.</p>
      <div class="spv-room-foot"><button type="button" class="spv-btn" data-act="wback" title="Вийти з дорадчої кімнати в голосовий офіс відділу">← До відділу</button></div></section>`;
  }
  if (!isBoss()) return '';
  const ready = v.demo || holds() || !!w;
  return `<section class="spv-room is-tet${ready ? '' : ' is-off'}" data-tetzone aria-label="Дорадча кімната: перетягніть сюди колегу">
      ${head('Розмова віч-на-віч')}
      <p class="spv-room-drop">${ready
        ? 'Перетягніть сюди колегу з офісу чи зі списку «в мережі»'
        : 'Увійдіть в офіс — тоді сюди можна перетягнути колегу'}</p></section>`;
}

/** Головна картка: голосовий офіс відділу (або дорадча, коли панель у ній, або гостьова кімната). */
function roomCardHTML(s, w, list, people) {
  const live = (s.status === 'live' && s.inRoom) || !!w?.inRoom;
  const tet = !!v.tet;
  const title = tet ? 'Дорадча кімната' : roomTitle();
  const sub = tet
    ? `${v.tet.met ? 'Ви з ' + esc(v.tet.name) : 'Чекаємо на ' + esc(v.tet.name) + '…'} · колеги у відділі вас не чують`
    : `${list.length ? `${list.length} ${plural(list.length)}` : 'Поки нікого'}${live ? ' · <span class="spv-live-txt">в ефірі</span>' : ''}`;
  return `<section class="spv-room ${tet ? 'is-tet is-busy' : 'is-office'}${live ? ' is-live' : ''}">
      <header class="spv-room-head"><span class="spv-room-ico" aria-hidden="true">${tet ? '🤝' : '🎙'}</span>
        <span class="spv-room-title"><b>${esc(title)}</b><small>${sub}</small></span>
        <span class="spv-dot${live ? ' is-live' : ''}" aria-hidden="true"></span></header>
      <ul class="spv-people" aria-label="Хто в кімнаті">${people}</ul>
      ${tet ? '<div class="spv-room-foot"><button type="button" class="spv-btn" data-act="tetback" title="Вийти з дорадчої кімнати в голосовий офіс відділу">← До відділу</button></div>' : ''}
    </section>`;
}

/** Вкладка: хто показує екран (відео — у голосовому вікні) і кнопка «Дивитися» в окремому вікні. */
function presenterHTML(s, w) {
  const pr = s.presenter;
  if (!pr || !w) return '';
  const uid = (s.members || []).find((m) => m.key === pr.key)?.uid;
  if (uid && uid === v.me?.id) return '<p class="spv-note">🖥 Ви показуєте екран (з голосового вікна). Зупинити — кнопкою 🖥 у голосовому вікні.</p>';
  return `<ul class="spv-knocks"><li class="spv-knock">
      <span>🖥 <b>${esc(pr.name || 'Колега')}</b> показує екран</span>
      <button type="button" class="spv-btn is-on" data-act="wscreenwin" title="Екран колеги в окремому вікні: розгорнути, згорнути, на весь екран">⧉ Дивитися</button>
    </li></ul>`;
}

/* ───────────────────────── панель ───────────────────────── */

async function onClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
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
  if (act === 'tetback') return leaveTet();
  if (v.demo) return demoAct(act);
  // Голос у голосовому вікні — кнопки панелі вкладки керують ним
  if (act === 'wmic') return sendVoiceCmd('mic');
  if (act === 'wleave') return sendVoiceCmd('leave');
  if (act === 'wfocus') return focusVoiceWindow();
  if (act === 'wback') return sendVoiceCmd('intent', {});
  if (act === 'wscreen') {
    focusVoiceWindow();
    sendVoiceCmd('screen');
    return v.toast('Оберіть у голосовому вікні, що показати колегам');
  }
  if (act === 'wscreenwin') { focusVoiceWindow(); return sendVoiceCmd('screenwin'); }
  if (act === 'leave' && v.win) return leaveWin();
  v.eng.unlock();
  if (act === 'mic') await v.eng.toggleMic();
  else if (act === 'deaf') await v.eng.toggleDeaf();
  else if (act === 'screen') { v.askShare = false; await v.eng.toggleShare(); render(); }
  else if (act === 'meet') { await v.meet.start({ topic: v.eng.topic, label: roomTitle() }); render(); }
  else if (act === 'meetend') { await v.meet.finish(); render(); }
  else if (act === 'leave' && v.tet && !v.win) await leaveTet();
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
  const w = tabOnly ? voiceWin() : null;
  const list = s.members.map((m) => (!m.me && tabOnly && m.uid && m.uid === v.me?.id ? { ...m, me: true, viaWin: true } : m))
    .sort((a, b) => (a.me ? -1 : b.me ? 1 : (a.name || '').localeCompare(b.name || '', 'uk')));
  const others = list.filter((m) => !m.me).length;

  const people = list.map((m) => {
    const st = m.viaWin ? 'ok' : m.state;
    const cls = ['spv-person', m.me && 'is-me', m.muted && 'is-muted', m.deaf && 'is-deaf', st === 'bad' && 'is-bad', st === 'wait' && 'is-wait'].filter(Boolean).join(' ');
    // Пристрій і пінг (04.11.2026) — рушій міряє їх для кожного з'єднання
    const ni = netInfo(m);
    const flags = [`${m.deaf ? 'звук вимкнено' : m.muted ? 'мікрофон вимкнено' : 'мікрофон увімкнено'}${!m.me && STATE_HINT[st] ? ' · ' + STATE_HINT[st] : ''}`, ni.tip].filter(Boolean).join(' · ');
    // data-vk — за ним рушій підсвічує того, хто говорить
    const drag = canTet(m) ? ` draggable="true" data-drag-uid="${esc(m.uid)}" data-drag-name="${esc(m.name || '')}"` : '';
    return `<li class="${cls}${drag ? ' is-draggable' : ''}"${drag} data-vk="${esc(m.key)}" title="${esc(m.name)}${m.me ? ' (ви)' : ''} — ${esc(flags)}">
      <span class="spv-ava" aria-hidden="true">${esc(initials(m.name))}</span>
      <span class="spv-name">${esc(m.name || 'Без імені')}${m.me ? ' <i>(ви)</i>' : ''}</span>
      ${m.deaf ? '<span class="spv-flag" aria-label="звук вимкнено">🔕</span>' : m.muted ? '<span class="spv-flag" aria-label="мікрофон вимкнено">🔇</span>' : '<span class="spv-flag" aria-label="мікрофон увімкнено">🎙</span>'}
      ${ni.dev ? `<span class="spv-flag" aria-label="${esc(ni.devTip)}">${ni.dev}</span>` : ''}
      ${ni.ping && s.inRoom ? `<span class="spv-ping is-${ni.cls}">${esc(ni.ping)}</span>` : ''}
      ${st === 'bad' ? '<span class="spv-flag" aria-label="немає з\'єднання">⚠</span>' : ''}
      ${canTet(m) ? `<button type="button" class="spv-kick" data-act="tet" data-uid="${esc(m.uid)}" data-name="${esc(m.name || '')}" title="Поговорити віч-на-віч: ${esc(m.name || 'колега')} отримає запрошення в дорадчу кімнату">🤝</button>` : ''}
      ${canKick(m) ? `<button type="button" class="spv-kick" data-act="kick" data-uid="${esc(m.uid)}" title="Вивести гостя з кімнати відділу (дозвіл зайти знімається)">Вивести</button>` : ''}
    </li>`;
  }).join('');

  let note = '';
  if (v.noDept) note = 'У профілі не вказано відділ. Голос усього департаменту — у «Чаті департаменту» (посилання вгорі).';
  else if (v.visit?.status === 'wait') note = `🚪 Стукаємо до відділу «${cap(v.visit.dept)}» — чекаємо, поки хтось пустить.`;
  else if (w && v.follow) note = `🚪 Ви в гостях: голос в окремому вікні («⧉ Вікно голосу»). Нижче — хто зараз у цій кімнаті.`;
  else if (w) note = w.inRoom ? `🎙 Ви в ефірі — голос в окремому вікні («${w.label || 'кімната'}»). Ходіть порталом, закривайте вкладки — розмова триває.` : 'Голосове вікно відкрито — заходимо в кімнату…';
  else if (tabOnly && v.ask) note = v.ask.tet ? '🤝 Вас кличуть у дорадчу кімнату — натисніть «Зайти».' : v.ask.voice_invite ? '🎙 Вас кличуть у голосову кімнату — натисніть «Зайти».' : '🚪 Двері відчинено — натисніть «Зайти».';
  else if (v.elsewhere && !tabOnly) note = `Голос відкрито в іншій вкладці порталу («Справи» чи кабінет). Тут видно, хто в кімнаті${list.length ? `: ${list.length}` : ''}.`;
  else if (s.status === 'joining' || s.status === 'idle') note = 'Заходимо в кімнату…';
  else if (s.status === 'error') note = s.error;
  else if (!list.length) note = 'У кімнаті нікого. Зайдіть — колеги побачать вас, коли відкриють «Справи».';
  else if (s.inRoom && !others) note = 'Поки що ви тут самі.';
  else if (!s.inRoom) note = `Ви не в кімнаті. Зараз тут: ${list.length}.`;
  if (s.status === 'live' && list.length >= MANY) note = `У кімнаті ${list.length} — пряма схема може не витягнути, звук може рватися.`;
  if (v.tet && s.status === 'live') note = others ? '' : v.tet.met ? `${v.tet.name} вийшов(-ла) — повертаємось у голосовий офіс відділу…` : `Покликали ${v.tet.name} — чекаємо до півтори хвилини.`;
  if (w?.tet) note = '';
  if (v.askShare && !s.sharing && holds()) note = '🖥 Браузер починає показ лише з кліку в цьому вікні — натисніть «Обрати, що показати».';
  if (s.inRoom && s.micSilent) note = '⚠ Ваш мікрофон нічого не передає — колеги вас не чують. Оберіть інший кнопкою «⚙».';

  const winBtns = w
    ? `<button type="button" class="spv-btn${w.muted ? '' : ' is-on'}" data-act="wmic" aria-pressed="${!w.muted}"
         title="${w.muted ? 'Увімкнути мікрофон у голосовому вікні' : 'Вимкнути мікрофон'}">${w.muted ? '🎙 Говорити' : '🎙 Мікрофон увімк.'}</button>
       ${w?.inRoom && s.canShare ? '<button type="button" class="spv-btn spv-icon" data-act="wscreen" title="Показати колегам свій екран або вікно (підтвердите в голосовому вікні)">🖥</button>' : ''}
       <button type="button" class="spv-btn spv-ghost" data-act="wfocus" title="Показати голосове вікно поверх інших">⧉ Вікно голосу</button>
       <button type="button" class="spv-btn spv-ghost" data-act="wleave" title="Вийти з кімнати й закрити голосове вікно">Вийти</button>`
    : `<button type="button" class="spv-btn spv-join" data-act="join"
         title="Голос відкриється в окремому вікні: розмова не обірветься, поки ви ходите порталом чи іншими сайтами">${v.ask ? '🎙 Зайти' : '🎙 Увійти в кімнату'}</button>`;
  const btns = tabOnly ? (w || s.status === 'live' || v.ask ? winBtns : '') : s.inRoom && s.status === 'live'
    ? `<button type="button" class="spv-btn${s.muted ? '' : ' is-on'}" data-act="mic" aria-pressed="${!s.muted}"
         title="${s.muted ? 'Увімкнути мікрофон — вас почують' : 'Вимкнути мікрофон'}">${s.muted ? '🎙 Говорити' : '🎙 Мікрофон увімк.'}</button>
       <button type="button" class="spv-btn spv-icon${s.deaf ? ' is-off' : ''}" data-act="deaf" aria-pressed="${s.deaf}"
         title="${s.deaf ? 'Увімкнути звук' : 'Вимкнути звук (і мікрофон)'}">${s.deaf ? '🔕' : '🎧'}</button>
       <button type="button" class="spv-btn spv-icon${s.micSilent ? ' is-off' : ''}" data-act="micpick" title="Обрати мікрофон і перевірити, чи він вас чує">⚙</button>
       ${v.demo ? `<button type="button" class="spv-btn spv-ghost" data-act="greetdemo" title="Демо: колега заходить у голосову кімнату вперше за день — привітання на ім'я">▶ Перший вхід</button>
       <button type="button" class="spv-btn spv-ghost" data-act="chimedemo" title="Демо: колега заходить удруге за день — мелодійний дзвінок">▶ Повторний вхід</button>` : ''}
       ${s.canShare ? (v.askShare && !s.sharing
         ? '<button type="button" class="spv-btn spv-join" data-act="screen" title="Відкриється вибір: увесь екран, вікно чи вкладка">🖥 Обрати, що показати</button>'
         : `<button type="button" class="spv-btn spv-icon${s.sharing ? ' is-on' : ''}" data-act="screen" aria-pressed="${!!s.sharing}"
         title="${s.sharing ? 'Зупинити показ екрана' : 'Показати колегам свій екран або вікно'}">🖥</button>`) : ''}
       ${s.canRecord && !(s.recording && !s.recording.me) ? (s.recording?.me
         ? '<button type="button" class="spv-btn spv-rec is-on" data-act="meetend" aria-pressed="true" title="Іде запис. Натисніть, щоб зупинити й зберегти нараду — протокол підготує Claude"><i class="rec-dot" aria-hidden="true"></i>Кінець наради</button>'
         : '<button type="button" class="spv-btn spv-rec" data-act="meet" aria-pressed="false" title="Почати нараду: увімкнеться запис, усіх у кімнаті буде попереджено"><i class="rec-dot" aria-hidden="true"></i>Нарада</button>') : ''}
       <button type="button" class="spv-btn spv-ghost" data-act="leave" title="${v.win ? 'Вийти з кімнати й закрити голосове вікно' : 'Вийти з кімнати; запамʼятаємо до наступного «Увійти»'}">Вийти</button>`
    : s.status === 'live'
      ? (v.elsewhere
        ? '<button type="button" class="spv-btn spv-join" data-act="join" title="Голос перейде сюди, а в іншій вкладці стане «лише дивлюся»">🎧 Перенести голос сюди</button>'
        : '<button type="button" class="spv-btn spv-join" data-act="join">Увійти в кімнату</button>')
      : '';

  const tetCard = tetZoneHTML(w);
  v.root.innerHTML = `<div class="spv-main">
    <div class="spv-rooms${tetCard ? '' : ' is-single'}">${roomCardHTML(s, w, list, people)}${tetCard}</div>
    ${s.recording ? `<p class="spv-recbar">🔴 Іде запис наради · ${s.recording.me ? 'записуєте ви' : 'увімкнув(-ла) ' + esc(s.recording.name)} · з ${new Date(s.recording.since).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</p>` : ''}
    ${note ? `<p class="spv-note${s.status === 'error' || (s.inRoom && s.micSilent) ? ' is-bad' : ''}">${esc(note)}</p>` : ''}
    ${s.needGesture ? '<button type="button" class="spv-btn spv-sound" data-act="sound">🔊 Натисніть, щоб чути колег</button>' : ''}
    ${knocksHTML()}
    ${tetHTML()}
    ${tabOnly ? presenterHTML(s, w) : ''}
    <div class="spv-actions">${btns}${visitBtnsHTML(s)}</div>
    ${v.showDepts ? deptsHTML() : ''}</div>`;
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
