/**
 * Зв'язок сторінок порталу з «Голосовим вікном» (19.11.2026, на прохання користувача:
 * «щоб коли ти зайшов в голосовий чат, була можливість серфити по порталу та інтернету, закривати вікна»).
 *
 * Голос живе в окремому вікні /voice/ (voice-window.js), а не у вкладці розділу: перехід на іншу
 * сторінку, закриття вкладки порталу чи сторонні сайти розмову не рвуть. Сторінки порталу
 * (auth-v2.js — бейдж «в ефірі», «Справи», кабінет, чат, двері на головній) лише:
 *  - бачать стан вікна: BroadcastChannel BUS, повідомлення { type: 'state', … } на кожну зміну
 *    й раз на HEARTBEAT мс; вікно, що мовчить довше за DEAD мс, вважаємо закритим;
 *  - шлють йому команди: { type: 'cmd', cmd: 'mic' | 'deaf' | 'leave' | 'focus' | 'intent', params }.
 * Усе — в межах одного браузера, без бази й без сповіщень.
 *
 * openVoiceWindow() викликати СИНХРОННО в обробнику кліку: браузер відкриває вікна лише на дію
 * людини. Вікно вже живе — йому йде намір (intent), нове не відкриваємо. Повертає 'sent' | 'opened' | null
 * (null — браузер заблокував вікно; тоді розділ бере голос у свою вкладку, як було до 19.11).
 */

export const WIN_NAME = 'pmg-voice';
export const BUS = 'pmg-voice-win';
export const HEARTBEAT = 3000;
const DEAD = 8000;
const FEATURES = 'popup,width=420,height=660';

let last = null;          // останній стан вікна або null
let ref = null;           // вікно, яке відкрила ЦЯ вкладка (щоб показати його поверх)
const subs = new Set();
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(BUS) : null;

function notify() { subs.forEach((fn) => { try { fn(last); } catch (_) { /* чужий обробник */ } }); }

if (bc) {
  bc.addEventListener('message', (e) => {
    const m = e.data;
    if (m?.type !== 'state') return;
    last = m.alive ? { ...m, at: Date.now() } : null;
    notify();
  });
  bc.postMessage({ type: 'ask' });
  setInterval(() => { if (last && Date.now() - last.at > DEAD) { last = null; notify(); } }, 2000);
}

/** Стан голосового вікна: { inRoom, status, label, topic, dept, muted, deaf, count, speaking[] } або null. */
export const voiceWin = () => last;

/** Підписатися на стан вікна; одразу викликає з поточним. Повертає «відписатися». */
export function onVoiceWin(fn) {
  subs.add(fn);
  fn(last);
  return () => subs.delete(fn);
}

export function sendVoiceCmd(cmd, params = {}) {
  bc?.postMessage({ type: 'cmd', cmd, params });
}

/** Показати голосове вікно поверх інших (якщо його відкрила ця вкладка — напряму, інакше просимо саме вікно). */
export function focusVoiceWindow() {
  if (ref && !ref.closed) { try { ref.focus(); return; } catch (_) { /* інший origin — неможливо */ } }
  sendVoiceCmd('focus');
}

/**
 * Зайти в голос: params — намір для вікна (room: 'all', mic: '1', door, door_dept, voice_invite, knock).
 * Без params — кімната свого відділу.
 */
export function openVoiceWindow(params = {}) {
  if (last) { sendVoiceCmd('intent', params); focusVoiceWindow(); return 'sent'; }
  const u = new URL('/voice/', location.origin);
  Object.entries(params).forEach(([k, val]) => { if (val != null && val !== '') u.searchParams.set(k, typeof val === 'string' ? val : JSON.stringify(val)); });
  let w = null;
  try { w = window.open(u.href, WIN_NAME, FEATURES); } catch (_) { w = null; }
  if (!w) return null;
  ref = w;
  return 'opened';
}
