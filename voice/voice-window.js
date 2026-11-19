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
 * - Панель — та сама, що в «Справах» (../spravy/voice.js, режим win): стук і гості, «Вивести»,
 *   вибір мікрофона, показ екрана, нарада із записом, привітання. Нових кімнат немає.
 * - Намір — з адреси: ?room=all [&mic=1] (кімната департаменту), ?door=…, ?door_dept=…, ?voice_invite=…,
 *   ?knock=<відділ>; без параметрів — кімната свого відділу. Відкрите вікно отримує намір командою 'intent'.
 * - Вийшли з кімнати — вікно закривається. Закрили вікно — вийшли (рушій сам виходить на pagehide).
 * - Маркер «в ефірі» поверх усіх вікон — ./pip.js.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { initVoice } from '../spravy/voice.js?v=20261119a';
import { BUS, HEARTBEAT } from './link.js?v=20261119a';
import { createPip } from './pip.js?v=20261119a';

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

const $ = (id) => document.getElementById(id);
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(BUS) : null;
let api = null;
let pip = null;
let speaking = [];
let closed = false;

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
}

/** Що бачать вкладки порталу й маркер. */
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
    speaking,
    needGesture: !!s?.needGesture
  };
}

let lastSent = '';
function publish(force = false) {
  const st = state();
  const key = JSON.stringify(st);
  if (!force && key === lastSent) return;
  lastSent = key;
  bc?.postMessage({ type: 'state', ...st });
  pip?.update();
  $('vwDot').classList.toggle('is-live', st.inRoom);
  $('vwRoom').textContent = st.label;
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

async function onCmd(m) {
  if (!api || m?.type !== 'cmd') return;
  if (m.cmd === 'mic') await api.toggleMic();
  else if (m.cmd === 'deaf') await api.toggleDeaf();
  else if (m.cmd === 'leave') await leave();
  else if (m.cmd === 'focus') { try { window.focus(); } catch (_) { /* браузер не дав */ } pip?.update(); }
  else if (m.cmd === 'intent') await api.intent(m.params || {});
  publish(true);
}

async function leave() {
  const ok = await api.leave();
  if (ok === false) return;
}

/** Вийшли з кімнати (тут, у маркері чи з вкладки) — вікно закривається. */
function onLeave() {
  closed = true;
  publish(true);
  pip?.close();
  window.close();
  // Вікно відкрили не скриптом (набрали адресу) — закрити себе браузер не дасть
  setTimeout(() => {
    $('spVoice').hidden = true;
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
  setTimeout(() => { $('spVoice').hidden = true; message('Голос перейшов у вкладку порталу. Це вікно можна закрити.'); }, 1200);
}

async function start() {
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

  // Маркер поверх усіх вікон
  pip = createPip({
    getState: state,
    act: async (cmd) => {
      api.unlock();
      if (cmd === 'mic') await api.toggleMic();
      else if (cmd === 'deaf') await api.toggleDeaf();
      else if (cmd === 'leave') { window.focus(); await leave(); }
      publish(true);
    },
    onToggle: (on) => {
      $('vwPin').classList.toggle('is-on', on);
      $('vwPin').textContent = on ? '📌 Маркер увімкнено' : '📌 Поверх усіх вікон';
    }
  });
  const pin = $('vwPin');
  if (pip.supported) {
    pin.hidden = false;
    pin.addEventListener('click', () => (pip.isOpen ? pip.close() : pip.open()));
  } else {
    $('vwHint').textContent += ' Маркер «в ефірі» видно на кожній сторінці порталу (у цьому браузері поверх усіх програм він не вміє).';
  }
  publish(true);
}

start().catch((e) => message('Голос не запустився: ' + (e?.message || e)));
