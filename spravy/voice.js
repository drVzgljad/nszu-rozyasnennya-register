/**
 * Голосова кімната відділу — постійна «кімната» на кшталт Discord у розділі «Справи».
 *
 * Відкрив сторінку — і ти в кімнаті свого відділу: видно, хто ще тут, чути тих,
 * хто говорить. Мікрофон за замовчуванням ВИМКНЕНИЙ — щоб розмова в кабінеті
 * випадково не пішла колегам; говорити — кнопкою «Мікрофон». «Вийти» запамʼятовується
 * в цьому браузері: наступного разу сторінка лише покаже, хто в кімнаті.
 *
 * Як це влаштовано:
 * - Голос іде НАПРЯМУ між браузерами (WebRTC, кожен з кожним) і нікуди не пишеться.
 *   Для відділу на 3–10 людей цього досить; більше — кожен тягне N−1 потоків.
 * - Хто в кімнаті і рукостискання з'єднань — через приватний канал Supabase Realtime
 *   'voice:dept:<хеш відділу>'. Впускає в нього лише свій відділ і керівництво
 *   (RLS на realtime.messages, migration_2026-11-03_voice_room.sql).
 * - Кожна вкладка — окремий учасник (ключ presence випадковий). Пропозицію з'єднання
 *   робить той, у кого ключ менший, — так двоє ніколи не дзвонять одне одному одночасно.
 * - Мікрофон вмикається заміною доріжки (replaceTrack) без повторного рукостискання.
 *   Вимкнений мікрофон зупиняється зовсім — індикатор запису в браузері гасне.
 * - Якщо мережа не пускає пряме з'єднання, звук іде через Cloudflare TURN. Тимчасові
 *   ключі видає воркер tools/voice-turn (VOICE_TURN_URL нижче). Без нього — лише STUN.
 * - «📣 Запросити» і «Загальний збір» — спільний діалог ../zviazok/invite.js (той самий,
 *   що в «Чаті департаменту»): запрошення в чат і Web Push на телефон. Посилання з
 *   запрошення — ?room=dept|all&voice=1: відкриває цю кімнату й заходить у неї.
 */

// Адреса воркера tools/voice-turn після `wrangler deploy`. Порожньо — без ретранслятора.
const VOICE_TURN_URL = 'https://pmg-voice-turn.doktorvzgljad.workers.dev';
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const MANY = 10;               // з такої кількості попереджаємо: пряма схема важчає
const RETRIES = 3;             // скільки разів перепідключати зірване з'єднання
const SPEAK_LEVEL = 0.035;     // поріг RMS, з якого вважаємо, що людина говорить
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
  topic: '',
  ch: null,
  key: '',             // ключ presence цієї вкладки
  status: 'idle',      // idle · joining · live · error
  error: '',
  inRoom: false,       // ми в кімнаті (track), а не лише дивимося
  members: new Map(),  // key → { uid, name, muted, deaf }
  peers: new Map(),    // key → { pc, sender, audio, tries, speaking }
  mic: null,           // MediaStreamTrack або null
  muted: true,
  deaf: false,
  micBeforeDeaf: false, // чи говорив до «вимкнути звук» — щоб повернути мікрофон
  ice: STUN,
  iceUntil: 0,
  ctx: null,           // AudioContext для індикатора «говорить»
  meters: new Map(),   // key ('me' або ключ peer) → AnalyserNode
  needGesture: false,  // браузер не дав відтворити звук без кліку
  timer: null
};

/* ───────────────────────── публічне ───────────────────────── */

/** Запустити кімнату. opts: { sb, me, name, dept, toast } або { demo: true, name }. */
export function initVoice(opts) {
  v.root = document.getElementById('spVoice');
  if (!v.root || !window.RTCPeerConnection) return;
  Object.assign(v, opts);
  v.root.hidden = false;
  v.root.addEventListener('click', onClick);
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);
  // Кнопки з текстового каналу під кімнатою (room-chat.js)
  document.addEventListener('spravy:invite', () => openInviteDialog());
  document.addEventListener('spravy:join-voice', () => joinRoom());
  if (v.demo) return demo();
  window.addEventListener('pagehide', () => leaveChannel(true));
  // Прийшли за запрошенням (?voice=1) — заходимо, навіть якщо раніше натискали «Вийти»
  if (new URLSearchParams(location.search).get('voice') === '1') lsSet(LS_OFF, null);
  v.inRoom = lsGet(LS_OFF) !== '1';
  openChannel();
}

/** Керівництво перемкнуло відділ — переходимо в кімнату того відділу. */
export async function setVoiceDept(dept) {
  if (v.demo || !v.root || dept === v.dept) return;
  await leaveChannel(true);
  v.dept = dept;
  openChannel();
}

/* ───────────────────────── канал кімнати ───────────────────────── */

async function topicFor(dept) {
  if (dept === ALL) return 'voice:all';  // кімната департаменту (migration_2026-11-03b_voice_room_all.sql)
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dept));
  return 'voice:dept:' + [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const meta = () => ({ uid: v.me?.id, name: v.name, muted: v.muted, deaf: v.deaf });

async function openChannel() {
  if (!v.dept) { v.status = 'error'; v.error = 'У профілі не вказано відділ.'; return render(); }
  v.status = 'joining';
  v.error = '';
  render();
  v.topic = await topicFor(v.dept);
  v.key = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await ensureIce();
  const ch = v.sb.channel(v.topic, {
    config: { private: true, broadcast: { self: false }, presence: { key: v.key } }
  });
  v.ch = ch;
  ch.on('presence', { event: 'sync' }, onSync)
    .on('presence', { event: 'join' }, ({ key }) => { if (key !== v.key && v.inRoom) chime(true); })
    .on('presence', { event: 'leave' }, ({ key }) => { if (key !== v.key && v.inRoom) chime(false); })
    .on('broadcast', { event: 'sig' }, ({ payload }) => onSignal(payload))
    .subscribe(async (status, err) => {
      if (ch !== v.ch) return;
      if (status === 'SUBSCRIBED') {
        v.status = 'live';
        if (v.inRoom) await ch.track(meta());
        render();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        v.status = 'error';
        const m = String(err?.message || err || '');
        v.error = /unauthori|permission|denied/i.test(m)
          ? 'Кімната ще закрита: потрібна міграція migration_2026-11-03_voice_room.sql.'
          : 'Немає зв\'язку з кімнатою. Спробуємо ще раз за хвилину.';
        render();
        if (!/міграція/.test(v.error)) setTimeout(() => { if (v.ch === ch) { leaveChannel(true).then(openChannel); } }, 60000);
      }
    });
  clearInterval(v.timer);
  v.timer = setInterval(tick, 150);
}

async function leaveChannel(quiet) {
  for (const k of [...v.peers.keys()]) dropPeer(k, true);
  const ch = v.ch;
  v.ch = null;
  v.members.clear();
  if (ch) {
    try { await ch.untrack(); } catch (_) { /* канал уже закрито */ }
    try { await v.sb.removeChannel(ch); } catch (_) { /* те саме */ }
  }
  if (!quiet) render();
}

function onSync() {
  const st = v.ch?.presenceState() || {};
  v.members = new Map(Object.entries(st).map(([k, arr]) => [k, arr[arr.length - 1] || {}]));
  if (v.inRoom && v.members.has(v.key)) {
    // Дзвонить той, у кого ключ менший; другий чекає пропозиції
    for (const k of v.members.keys()) {
      if (k !== v.key && !v.peers.has(k) && v.key < k) callPeer(k);
    }
  }
  for (const k of [...v.peers.keys()]) if (!v.members.has(k)) dropPeer(k);
  render();
}

function send(to, msg) {
  v.ch?.send({ type: 'broadcast', event: 'sig', payload: { ...msg, from: v.key, to } });
}

async function onSignal(m) {
  if (!m || m.to !== v.key || !v.inRoom) return;
  const k = m.from;
  try {
    if (m.type === 'offer') {
      // Нова пропозиція від того самого учасника = перепідключення: старе з'єднання геть
      if (v.peers.has(k)) dropPeer(k);
      const p = makePeer(k);
      await p.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      const tr = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
      if (tr) {
        tr.direction = 'sendrecv';
        p.sender = tr.sender;
        if (v.mic) await p.sender.replaceTrack(v.mic);
      }
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      send(k, { type: 'answer', sdp: p.pc.localDescription.sdp });
      flushIce(p);
    } else if (m.type === 'answer') {
      const p = v.peers.get(k);
      if (!p || p.pc.signalingState !== 'have-local-offer') return;
      await p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      flushIce(p);
    } else if (m.type === 'ice') {
      const p = v.peers.get(k);
      if (!p) return;
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.cand);
      else p.pendingIce.push(m.cand);
    } else if (m.type === 'bye') {
      dropPeer(k);
    }
  } catch (e) {
    console.warn('[voice]', m.type, e);
  }
  render();
}

function flushIce(p) {
  const list = p.pendingIce.splice(0);
  list.forEach((c) => p.pc.addIceCandidate(c).catch(() => {}));
}

/* ───────────────────────── з'єднання з учасником ───────────────────────── */

function makePeer(k) {
  const pc = new RTCPeerConnection({ iceServers: v.ice });
  const audio = new Audio();
  audio.autoplay = true;
  audio.muted = v.deaf;
  v.root.querySelector('.spv-sink')?.append(audio);
  const p = { pc, sender: null, audio, tries: v.peers.get(k)?.tries || 0, pendingIce: [], speaking: false };
  pc.onicecandidate = (e) => { if (e.candidate) send(k, { type: 'ice', cand: e.candidate.toJSON() }); };
  pc.ontrack = (e) => {
    audio.srcObject = e.streams[0] || new MediaStream([e.track]);
    playAudio(audio);
    addMeter(k, audio.srcObject);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') p.tries = 0;
    if (pc.connectionState === 'failed') retryPeer(k);
    render();
  };
  v.peers.set(k, p);
  return p;
}

async function callPeer(k) {
  const p = makePeer(k);
  const tr = p.pc.addTransceiver(v.mic || 'audio', { direction: 'sendrecv' });
  p.sender = tr.sender;
  await p.pc.setLocalDescription(await p.pc.createOffer());
  send(k, { type: 'offer', sdp: p.pc.localDescription.sdp });
}

function retryPeer(k) {
  const p = v.peers.get(k);
  if (!p || v.key > k) return; // перепідключає той, хто дзвонив
  if (p.tries >= RETRIES) { p.gaveUp = true; render(); return; }
  const tries = p.tries + 1;
  setTimeout(async () => {
    if (!v.inRoom || !v.members.has(k) || v.peers.get(k) !== p) return;
    // Без «bye»: нова пропозиція сама замінить старе з'єднання на тому боці
    dropPeer(k);
    await ensureIce();
    await callPeer(k);
    const np = v.peers.get(k);
    if (np) np.tries = tries;
  }, 1500 * tries);
}

/** Закрити з'єднання з учасником. sayBye — коли йдемо самі: хай той бік не чекає таймауту. */
function dropPeer(k, sayBye) {
  const p = v.peers.get(k);
  if (!p) return;
  if (sayBye) send(k, { type: 'bye' });
  try { p.pc.close(); } catch (_) { /* уже закрито */ }
  if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
  v.meters.delete(k);
  v.peers.delete(k);
}

async function ensureIce() {
  if (!VOICE_TURN_URL || Date.now() < v.iceUntil) return;
  try {
    const { data: { session } } = await v.sb.auth.getSession();
    const r = await fetch(VOICE_TURN_URL, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    v.ice = d.iceServers?.length ? d.iceServers : STUN;
    v.iceUntil = Date.now() + (d.ttl || 3600) * 900; // оновлюємо трохи раніше, ніж ключ спливе
  } catch (e) {
    console.warn('[voice] TURN недоступний, лише прямі з\'єднання', e);
    v.ice = STUN;
    v.iceUntil = Date.now() + 5 * 60000;
  }
}

/* ───────────────────────── мікрофон і звук ───────────────────────── */

/** quiet — не оголошувати стан у кімнаті: це зробить той, хто викликав (setDeaf). */
async function setMuted(muted, quiet) {
  if (!muted && !v.mic) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      v.mic = s.getAudioTracks()[0];
      addMeter('me', s);
    } catch (e) {
      v.toast('Браузер не дав доступу до мікрофона: дозвольте його біля адресного рядка.', true);
      return;
    }
  }
  if (muted && v.mic) {
    v.mic.stop();
    v.mic = null;
    v.meters.delete('me');
  }
  v.muted = muted;
  // Заговорив без звуку — звук повертаємо: говорити й не чути відповіді безглуздо
  if (!muted && v.deaf) {
    v.micBeforeDeaf = false;
    hear(true);
  }
  await Promise.all([...v.peers.values()].map((p) => p.sender?.replaceTrack(v.mic).catch(() => {})));
  if (!quiet) retrack();
}

function hear(on) {
  v.deaf = !on;
  v.peers.forEach((p) => { if (p.audio) p.audio.muted = !on; });
}

/**
 * «Вимкнути звук» глушить і мікрофон, а «Увімкнути звук» повертає мікрофон
 * у той стан, у якому він був до вимкнення (як у Discord).
 */
async function setDeaf(deaf) {
  if (deaf) {
    v.micBeforeDeaf = !v.muted;
    hear(false);
    if (!v.muted) await setMuted(true, true);
  } else {
    hear(true);
    if (v.micBeforeDeaf) await setMuted(false, true);
    v.micBeforeDeaf = false;
  }
  retrack();
}

function retrack() {
  if (v.ch && v.inRoom && v.status === 'live') v.ch.track(meta());
  render();
}

function playAudio(audio) {
  audio.play().catch(() => { v.needGesture = true; render(); });
}

function unlockAudio() {
  if (v.ctx?.state === 'suspended') v.ctx.resume().catch(() => {});
  if (!v.needGesture) return;
  v.needGesture = false;
  v.peers.forEach((p) => p.audio?.srcObject && playAudio(p.audio));
  render();
}

function audioCtx() {
  if (!v.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    v.ctx = new AC();
  }
  return v.ctx;
}

function addMeter(k, stream) {
  const ctx = audioCtx();
  if (!ctx || !stream.getAudioTracks().length) return;
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  v.meters.set(k, an);
}

const buf = new Uint8Array(512);
function level(an) {
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
  return Math.sqrt(sum / buf.length);
}

/** Раз на 150 мс: хто зараз говорить — підсвічуємо кружечок, не перемальовуючи панель. */
function tick() {
  if (!v.root) return;
  v.meters.forEach((an, k) => {
    const on = level(an) > SPEAK_LEVEL && !(k === 'me' && v.muted);
    const el = v.root.querySelector(`[data-k="${k === 'me' ? v.key : k}"]`);
    if (el) el.classList.toggle('is-speaking', on);
  });
}

/** Короткий звук, коли хтось зайшов або вийшов (як у Discord). */
function chime(up) {
  const ctx = v.ctx;
  if (!ctx || ctx.state !== 'running' || v.deaf) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(up ? 520 : 660, t);
  o.frequency.linearRampToValueAtTime(up ? 780 : 440, t + 0.16);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.24);
}

/* ───────────────────────── панель ───────────────────────── */

async function onClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  audioCtx();
  unlockAudio();
  const act = b.dataset.act;
  if (v.demo) return demoAct(act);
  if (act === 'mic') await setMuted(!v.muted);
  else if (act === 'deaf') await setDeaf(!v.deaf);
  else if (act === 'leave') {
    v.inRoom = false;
    lsSet(LS_OFF, '1');
    if (v.mic) await setMuted(true);
    for (const k of [...v.peers.keys()]) dropPeer(k, true);
    try { await v.ch?.untrack(); } catch (_) { /* канал закрито */ }
    chime(false);
    render();
  } else if (act === 'join') {
    await joinRoom();
  } else if (act === 'sound') {
    unlockAudio();
  } else if (act === 'invite') {
    openInviteDialog();
  }
}

/** Зайти в кімнату (кнопка «Увійти» або «Приєднатися» на картці збору в чаті). */
async function joinRoom() {
  audioCtx();
  unlockAudio();
  if (v.demo) return v.inRoom ? null : demoAct('join');
  if (v.inRoom) return;
  v.inRoom = true;
  lsSet(LS_OFF, null);
  if (v.status === 'live') await v.ch.track(meta());
  else if (!v.ch) openChannel();
  chime(true);
  render();
}

/** «📣 Запросити» / «Загальний збір» — діалог спільний із «Чатом департаменту». */
async function openInviteDialog() {
  const { openInvite, GATHER_TEXT } = await import('../zviazok/invite.js?v=20261103a');
  const all = v.dept === ALL;
  const where = all ? 'all' : 'dept';
  openInvite({
    sb: v.sb, me: v.me || { id: 'me' }, name: v.name, demo: v.demo,
    title: all ? 'Кімната департаменту' : v.dept ? `Кімната відділу (${v.dept})` : 'Кімната відділу',
    scope: all ? { kind: 'all' } : { kind: 'dept', dept: v.dept },
    here: new Set([...v.members.values()].map((m) => m.uid)),
    url: `${location.origin}/spravy/index.html?room=${where}&voice=1`,
    pushKey: 'spravy:' + where,
    pingKey: 'spravy:' + where,
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

function peerState(k) {
  const p = v.peers.get(k);
  if (!p) return v.inRoom ? 'wait' : 'off';
  if (p.gaveUp) return 'bad';
  const s = p.pc.connectionState;
  if (s === 'connected') return 'ok';
  if (s === 'failed') return 'bad';
  return 'wait';
}
const STATE_HINT = { ok: 'на зв\'язку', wait: 'з\'єднуємо…', bad: 'немає прямого з\'єднання — потрібен ретранслятор', off: '' };

function render() {
  if (!v.root) return;
  if (!v.root.querySelector('.spv-sink')) {
    v.root.innerHTML = '<div class="spv-main"></div><div class="spv-sink" hidden></div>';
  }
  const main = v.root.querySelector('.spv-main');
  const list = [...v.members.entries()].sort(([a, x], [b, y]) => (a === v.key ? -1 : b === v.key ? 1 : (x.name || '').localeCompare(y.name || '', 'uk')));
  const others = list.filter(([k]) => k !== v.key).length;

  const people = list.map(([k, m]) => {
    const me = k === v.key;
    const st = me ? 'ok' : peerState(k);
    const cls = ['spv-person', me && 'is-me', m.muted && 'is-muted', m.deaf && 'is-deaf', st === 'bad' && 'is-bad', st === 'wait' && 'is-wait'].filter(Boolean).join(' ');
    const flags = `${m.deaf ? 'звук вимкнено' : m.muted ? 'мікрофон вимкнено' : 'мікрофон увімкнено'}${!me && STATE_HINT[st] ? ' · ' + STATE_HINT[st] : ''}`;
    return `<li class="${cls}" data-k="${esc(k)}" title="${esc(m.name)}${me ? ' (ви)' : ''} — ${esc(flags)}">
      <span class="spv-ava" aria-hidden="true">${esc(initials(m.name))}</span>
      <span class="spv-name">${esc(m.name || 'Без імені')}${me ? ' <i>(ви)</i>' : ''}</span>
      ${m.deaf ? '<span class="spv-flag" aria-label="звук вимкнено">🔕</span>' : m.muted ? '<span class="spv-flag" aria-label="мікрофон вимкнено">🔇</span>' : ''}
      ${st === 'bad' ? '<span class="spv-flag" aria-label="немає з\'єднання">⚠</span>' : ''}
    </li>`;
  }).join('');

  let note = '';
  if (v.status === 'joining') note = 'Заходимо в кімнату…';
  else if (v.status === 'error') note = v.error;
  else if (!list.length) note = 'У кімнаті нікого. Зайдіть — колеги побачать вас, коли відкриють «Справи».';
  else if (v.inRoom && !others) note = 'Поки що ви тут самі.';
  else if (!v.inRoom) note = `Ви не в кімнаті. Зараз тут: ${list.length}.`;
  if (v.status === 'live' && list.length >= MANY) note = `У кімнаті ${list.length} — пряма схема може не витягнути, звук може рватися.`;

  const btns = v.inRoom && v.status === 'live'
    ? `<button type="button" class="spv-btn${v.muted ? '' : ' is-on'}" data-act="mic" aria-pressed="${!v.muted}"
         title="${v.muted ? 'Увімкнути мікрофон — вас почують' : 'Вимкнути мікрофон'}">${v.muted ? '🎙 Говорити' : '🎙 Мікрофон увімк.'}</button>
       <button type="button" class="spv-btn spv-icon${v.deaf ? ' is-off' : ''}" data-act="deaf" aria-pressed="${v.deaf}"
         title="${v.deaf ? 'Увімкнути звук' : 'Вимкнути звук (і мікрофон)'}">${v.deaf ? '🔕' : '🎧'}</button>
       <button type="button" class="spv-btn spv-ghost" data-act="leave" title="Вийти з кімнати; запамʼятаємо до наступного «Увійти»">Вийти</button>
       <button type="button" class="spv-btn spv-ghost" data-act="invite" title="Покликати колег у голос або оголосити загальний збір">📣 Запросити</button>`
    : v.status === 'live'
      ? '<button type="button" class="spv-btn spv-join" data-act="join">Увійти в кімнату</button>'
      : '';

  main.innerHTML = `
    <div class="spv-head">
      <span class="spv-dot ${v.status === 'live' && v.inRoom ? 'is-live' : ''}" aria-hidden="true"></span>
      <strong>${v.dept === ALL ? 'Кімната департаменту' : 'Кімната відділу'}</strong>
      <span class="spv-count">${list.length ? `${list.length} ${plural(list.length)}` : ''}</span>
    </div>
    <ul class="spv-people" aria-label="Хто в кімнаті">${people}</ul>
    ${note ? `<p class="spv-note${v.status === 'error' ? ' is-bad' : ''}">${esc(note)}</p>` : ''}
    ${v.needGesture ? '<button type="button" class="spv-btn spv-sound" data-act="sound">🔊 Натисніть, щоб чути колег</button>' : ''}
    <div class="spv-actions">${btns}</div>`;
}

function plural(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'учасник';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'учасники';
  return 'учасників';
}

/* ───────────────────────── демо (?demo=1) ───────────────────────── */

function demo() {
  v.status = 'live';
  v.inRoom = true;
  v.key = 'me';
  v.members = new Map([
    ['me', { name: v.name || 'Демо-користувач', muted: true, deaf: false }],
    ['d1', { name: 'Олена Приклад', muted: false, deaf: false }],
    ['d2', { name: 'Петро Зразок', muted: true, deaf: false }]
  ]);
  render();
  // Імітація: «Олена» час від часу говорить
  setInterval(() => {
    const el = v.root.querySelector('[data-k="d1"]');
    if (el) el.classList.toggle('is-speaking', Math.random() > 0.5);
  }, 700);
}

function demoAct(act) {
  const me = v.members.get('me');
  if (act === 'mic') { v.muted = !v.muted; me.muted = v.muted; if (!v.muted) { v.deaf = false; me.deaf = false; } }
  if (act === 'deaf') {
    v.deaf = !v.deaf;
    if (v.deaf) { v.micBeforeDeaf = !v.muted; v.muted = true; } else if (v.micBeforeDeaf) { v.muted = false; v.micBeforeDeaf = false; }
    me.deaf = v.deaf;
    me.muted = v.muted;
  }
  if (act === 'leave') { v.inRoom = false; v.members.delete('me'); }
  if (act === 'join') { v.inRoom = true; v.members.set('me', { name: v.name || 'Демо-користувач', muted: v.muted, deaf: v.deaf }); }
  if (act === 'invite') openInviteDialog();
  render();
}
