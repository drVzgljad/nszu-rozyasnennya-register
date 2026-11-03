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
 * - «📣 Запросити» і «Загальний збір» — спільний діалог ../zviazok/invite.js (той самий,
 *   що в «Чаті департаменту»): запрошення в чат і Web Push на телефон. Посилання з
 *   запрошення — ?room=dept|all&voice=1: відкриває цю кімнату й заходить у неї.
 */

import { createVoice } from '../zviazok/voice.js?v=20261103c';

const MANY = 10;               // з такої кількості попереджаємо: пряма схема важчає
const LS_OFF = 'spravy-voice-off';
const ALL = '*';               // «відділ» = увесь департамент (перемикач у spravy.js)

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
  vs: null,            // його знімок стану: status, error, inRoom, muted, deaf, needGesture, members
  noDept: false
};

/* ───────────────────────── публічне ───────────────────────── */

/** Запустити кімнату. opts: { sb, me, name, dept, toast } або { demo: true, name }. */
export function initVoice(opts) {
  v.root = document.getElementById('spVoice');
  if (!v.root || !window.RTCPeerConnection) return;
  Object.assign(v, opts);
  v.root.hidden = false;
  v.root.addEventListener('click', onClick);
  // Кнопки з текстового каналу під кімнатою (room-chat.js)
  document.addEventListener('spravy:invite', () => openInviteDialog());
  document.addEventListener('spravy:join-voice', () => joinRoom());
  if (v.demo) return demo();
  // Прийшли за запрошенням (?voice=1) — заходимо, навіть якщо раніше натискали «Вийти»
  if (new URLSearchParams(location.search).get('voice') === '1') lsSet(LS_OFF, null);
  v.eng = createVoice({ sb: v.sb, me: v.me, name: v.name, toast: v.toast, onChange: (s) => { v.vs = s; render(); } });
  openRoom();
}

/** Керівництво перемкнуло відділ або «Мій відділ | Департамент» — переходимо в ту кімнату. */
export async function setVoiceDept(dept) {
  if (v.demo || !v.root || dept === v.dept) return;
  v.dept = dept;
  openRoom();
}

/* ───────────────────────── кімната ───────────────────────── */

async function topicFor(dept) {
  if (dept === ALL) return 'voice:all';  // кімната департаменту (migration_2026-11-03b_voice_room_all.sql)
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dept));
  return 'voice:dept:' + [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const roomTitle = () => (v.dept === ALL ? 'Кімната департаменту' : 'Кімната відділу');

async function openRoom() {
  v.noDept = !v.dept;
  if (v.noDept) { await v.eng.leave(true); return render(); }
  const topic = await topicFor(v.dept);
  // Рушій сам перемикає кімнату: мікрофон і звук лишаються, як були
  await v.eng.join(topic, roomTitle(), { listen: lsGet(LS_OFF) === '1' });
}

/** Зайти в кімнату (кнопка «Увійти» або «Приєднатися» на картці збору в чаті). */
async function joinRoom() {
  if (v.demo) return v.vs.inRoom ? null : demoAct('join');
  lsSet(LS_OFF, null);
  v.eng.unlock();
  await v.eng.enter();
}

/* ───────────────────────── панель ───────────────────────── */

async function onClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (v.demo) return demoAct(act);
  v.eng.unlock();
  if (act === 'mic') await v.eng.toggleMic();
  else if (act === 'deaf') await v.eng.toggleDeaf();
  else if (act === 'leave') { lsSet(LS_OFF, '1'); await v.eng.exit(); }
  else if (act === 'join') await joinRoom();
  else if (act === 'invite') openInviteDialog();
}

/** «📣 Запросити» / «Загальний збір» — діалог спільний із «Чатом департаменту». */
async function openInviteDialog() {
  const { openInvite, GATHER_TEXT } = await import('../zviazok/invite.js?v=20261103c');
  const all = v.dept === ALL;
  const where = all ? 'all' : 'dept';
  openInvite({
    sb: v.sb, me: v.me || { id: 'me' }, name: v.name, demo: v.demo,
    title: all ? 'Кімната департаменту' : v.dept ? `Кімната відділу (${v.dept})` : 'Кімната відділу',
    scope: all ? { kind: 'all' } : { kind: 'dept', dept: v.dept },
    here: new Set((v.vs?.members || []).map((m) => m.uid)),
    url: `${location.origin}/spravy/index.html?room=${where}&voice=1`,
    pushKey: 'spravy:' + where,
    pingKey: 'spravy:' + where,
    onJoin: () => joinRoom(),
    // Оголошення збору — у текстовий канал під кімнатою (room-chat.js покаже його сам)
    onGather: async () => {
      if (v.demo) return;
      let roomId = null;
      if (!all) {
        const { data } = await v.sb.from('chat_rooms').select('id').eq('dept', v.dept).limit(1).maybeSingle();
        if (!data) return;
        roomId = data.id;
      }
      await v.sb.from('chat_messages').insert({ user_id: v.me.id, user_name: v.name, message_text: GATHER_TEXT, room_id: roomId });
    },
    toast: v.toast
  });
}

const STATE_HINT = { ok: 'на зв\'язку', wait: 'з\'єднуємо…', bad: 'немає прямого з\'єднання — потрібен ретранслятор', off: '' };

function render() {
  if (!v.root) return;
  const s = v.vs || { status: 'idle', members: [], inRoom: false, muted: true, deaf: false };
  const list = s.members.slice().sort((a, b) => (a.me ? -1 : b.me ? 1 : (a.name || '').localeCompare(b.name || '', 'uk')));
  const others = list.filter((m) => !m.me).length;

  const people = list.map((m) => {
    const st = m.state;
    const cls = ['spv-person', m.me && 'is-me', m.muted && 'is-muted', m.deaf && 'is-deaf', st === 'bad' && 'is-bad', st === 'wait' && 'is-wait'].filter(Boolean).join(' ');
    const flags = `${m.deaf ? 'звук вимкнено' : m.muted ? 'мікрофон вимкнено' : 'мікрофон увімкнено'}${!m.me && STATE_HINT[st] ? ' · ' + STATE_HINT[st] : ''}`;
    // data-vk — за ним рушій підсвічує того, хто говорить
    return `<li class="${cls}" data-vk="${esc(m.key)}" title="${esc(m.name)}${m.me ? ' (ви)' : ''} — ${esc(flags)}">
      <span class="spv-ava" aria-hidden="true">${esc(initials(m.name))}</span>
      <span class="spv-name">${esc(m.name || 'Без імені')}${m.me ? ' <i>(ви)</i>' : ''}</span>
      ${m.deaf ? '<span class="spv-flag" aria-label="звук вимкнено">🔕</span>' : m.muted ? '<span class="spv-flag" aria-label="мікрофон вимкнено">🔇</span>' : ''}
      ${st === 'bad' ? '<span class="spv-flag" aria-label="немає з\'єднання">⚠</span>' : ''}
    </li>`;
  }).join('');

  let note = '';
  if (v.noDept) note = 'У профілі не вказано відділ.';
  else if (s.status === 'joining' || s.status === 'idle') note = 'Заходимо в кімнату…';
  else if (s.status === 'error') note = s.error;
  else if (!list.length) note = 'У кімнаті нікого. Зайдіть — колеги побачать вас, коли відкриють «Справи».';
  else if (s.inRoom && !others) note = 'Поки що ви тут самі.';
  else if (!s.inRoom) note = `Ви не в кімнаті. Зараз тут: ${list.length}.`;
  if (s.status === 'live' && list.length >= MANY) note = `У кімнаті ${list.length} — пряма схема може не витягнути, звук може рватися.`;

  const btns = s.inRoom && s.status === 'live'
    ? `<button type="button" class="spv-btn${s.muted ? '' : ' is-on'}" data-act="mic" aria-pressed="${!s.muted}"
         title="${s.muted ? 'Увімкнути мікрофон — вас почують' : 'Вимкнути мікрофон'}">${s.muted ? '🎙 Говорити' : '🎙 Мікрофон увімк.'}</button>
       <button type="button" class="spv-btn spv-icon${s.deaf ? ' is-off' : ''}" data-act="deaf" aria-pressed="${s.deaf}"
         title="${s.deaf ? 'Увімкнути звук' : 'Вимкнути звук (і мікрофон)'}">${s.deaf ? '🔕' : '🎧'}</button>
       <button type="button" class="spv-btn spv-ghost" data-act="leave" title="Вийти з кімнати; запамʼятаємо до наступного «Увійти»">Вийти</button>
       <button type="button" class="spv-btn spv-ghost" data-act="invite" title="Покликати колег у голос або оголосити загальний збір">📣 Запросити</button>`
    : s.status === 'live'
      ? '<button type="button" class="spv-btn spv-join" data-act="join">Увійти в кімнату</button>'
      : '';

  v.root.innerHTML = `<div class="spv-main">
    <div class="spv-head">
      <span class="spv-dot ${s.status === 'live' && s.inRoom ? 'is-live' : ''}" aria-hidden="true"></span>
      <strong>${roomTitle()}</strong>
      <span class="spv-count">${list.length ? `${list.length} ${plural(list.length)}` : ''}</span>
    </div>
    <ul class="spv-people" aria-label="Хто в кімнаті">${people}</ul>
    ${note ? `<p class="spv-note${s.status === 'error' ? ' is-bad' : ''}">${esc(note)}</p>` : ''}
    ${s.needGesture ? '<button type="button" class="spv-btn spv-sound" data-act="sound">🔊 Натисніть, щоб чути колег</button>' : ''}
    <div class="spv-actions">${btns}</div></div>`;
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
      { key: 'me', name: v.name || 'Демо-користувач', muted: true, deaf: false, me: true, state: 'ok' },
      { key: 'd1', name: 'Олена Приклад', muted: false, deaf: false, state: 'ok' },
      { key: 'd2', name: 'Петро Зразок', muted: true, deaf: false, state: 'ok' }
    ]
  };
  render();
  // Імітація: «Олена» час від часу говорить
  setInterval(() => {
    const el = v.root.querySelector('[data-vk="d1"]');
    if (el) el.classList.toggle('is-speaking', Math.random() > 0.5);
  }, 700);
}

function demoAct(act) {
  const s = v.vs;
  const me = s.members.find((m) => m.me);
  if (act === 'mic') { s.muted = !s.muted; if (!s.muted) s.deaf = false; }
  if (act === 'deaf') {
    s.deaf = !s.deaf;
    if (s.deaf) { s.micBeforeDeaf = !s.muted; s.muted = true; } else if (s.micBeforeDeaf) { s.muted = false; s.micBeforeDeaf = false; }
  }
  if (me) Object.assign(me, { muted: s.muted, deaf: s.deaf });
  if (act === 'leave') { s.inRoom = false; s.members = s.members.filter((m) => !m.me); }
  if (act === 'join') { s.inRoom = true; s.members.unshift({ key: 'me', name: v.name || 'Демо-користувач', muted: s.muted, deaf: s.deaf, me: true, state: 'ok' }); }
  if (act === 'invite') openInviteDialog();
  render();
}
