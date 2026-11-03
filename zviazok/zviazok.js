/**
 * «Чат департаменту» — текст і голос у кожній кімнаті (замість старого chat/).
 *
 * Дані — ті самі таблиці, що й у старому чаті, тож уся історія на місці:
 *   chat_messages  — повідомлення: головна стрічка (room_id і recipient_id порожні),
 *                    кімната (room_id), особистий діалог (recipient_id);
 *   chat_rooms     — кімнати: відкриті (is_public, з категорією) і закриті (member_ids);
 *   chat_reactions — реакції; chat_pings — «покличи в голос».
 * Ті самі повідомлення видно й у «Справах відділу» (spravy/room-chat.js): кімната
 * відділу і головна стрічка — одна розмова, а не копія. Формат файлового
 * повідомлення спільний: `📎 [Файл: назва (розмір)](URL сховища)`, бакет приватний.
 *
 * Голос — voice.js (WebRTC + Cloudflare TURN, той самий механізм, що в «Справах»).
 * Хто в голосі якої відкритої кімнати — канал присутності 'voice:lobby'.
 * Хто взагалі в мережі — присутність порталу, яку веде auth-v2.js (подія pmg:presence).
 *
 * Права — RLS (schema.sql, migration_2026-07-23c_chat_channels.sql,
 * migration_2026-11-03d_chat_voice_rooms.sql): читати й писати — співробітники,
 * змінювати й видаляти — своє; кімнату — творець або адмін/директор; закріплювати —
 * функція chat_set_pin. Без міграції 03d сторінка працює, лише без відповідей,
 * позначки «змінено» і голосу в кімнатах — і каже про це, а не мовчить.
 *
 * ?demo=1 — демо без бази (вигадані люди й повідомлення) для перевірки вигляду.
 * ?c=main | room:<uuid> | dm:<uuid> — відкрити розмову. ?mode=popup — плаваюче вікно.
 */

import { createVoice, voiceTopic, MANY } from './voice.js?v=20261103d';
import { QUICK, buildPicker, emojiOnly } from './emoji.js?v=20261103a';

const QS = new URLSearchParams(location.search);
const DEMO = QS.get('demo') === '1';
const POPUP = QS.get('mode') === 'popup';
const PAGE = 500;              // скільки останніх повідомлень (усіх розмов) беремо на старті
const OLDER = 100;             // догрузка «раніші» в одній розмові
const FILE_LIMIT = 10 * 1024 * 1024;
const BUCKET = 'chat-attachments';
const FILE_RE = /^📎 \[Файл:\s*([^\]]+)\]\(([^)]+)\)/;
const STORAGE_RE = /\/storage\/v1\/object\/public\/([^/]+)\/([^?]+)/;
const IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const CATS = ['📢 Загальне', '📁 Відділи', '📋 Робота', '❓ Взаємодія', '☕ Позаробоче'];
const LEADERS = ['manager', 'deputy_director', 'director', 'admin'];
const ROOM_ADMINS = ['admin', 'director'];   // так у RLS chat_rooms (update/delete)
const ROOM_ICONS = ['💬', '📋', '📦', '⚖️', '📊', '🩺', '🧪', '💊', '🏥', '🎯', '💡', '🛠️', '📣', '🤝', '☕', '🌿', '🔬', '🗂️'];
const LS_READ = 'zv-read';
const LS_MUTE = 'zv-muted';
const LS_NOTIF = 'chat_notifications_enabled'; // ключ старого чату — щоб вимкнене лишилося вимкненим
const LS_LAST = 'zv-last';
const LS_FOLD = 'zv-fold';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* приватний режим */ } };
const initials = (n) => (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const shortName = (n) => { const p = (n || '').split(/\s+/).filter(Boolean); return p.length > 1 ? `${p[0]} ${p[1][0]}.` : (p[0] || 'Колега'); };
const hhmm = (d) => d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
const missingCol = (e) => e && (e.code === '42703' || e.code === 'PGRST204' || /column|schema cache/i.test(e.message || ''));

const S = {
  sb: null,
  me: null,
  name: '',
  role: 'expert',
  dept: '',
  rooms: [],
  people: [],             // співробітники (profiles без гостей) — для діалогів і учасників
  msgs: [],               // усі завантажені повідомлення, за часом
  byId: new Map(),
  rx: new Map(),          // id повідомлення → [реакції]
  rxMsg: new Map(),       // id реакції → id повідомлення (DELETE з Realtime несе лише id)
  chan: { kind: 'main' },
  read: lsGet(LS_READ, null),
  muted: new Set(lsGet(LS_MUTE, [])),
  fold: new Set(lsGet(LS_FOLD, [])),
  online: new Map(),      // uid → ім'я
  lobby: new Map(),       // канал голосу → [{ uid, name, muted }]
  lobbyCh: null,
  lobbyKey: crypto.randomUUID().slice(0, 12),
  editing: null,
  replyTo: null,
  hasReply: true,         // чи є колонки міграції 03d (з'ясовується з першої помилки)
  hasEdited: true,
  exhausted: new Set(),   // розмови, де раніших повідомлень уже немає
  voice: null,
  vs: null,               // стан голосу (знімок із voice.js)
  pinsOpen: false,
  asideOpen: false,
  dbStatus: 'connecting',
  signed: new Map(),
  pickerFor: null,        // 'input' або id повідомлення (реакція)
  firstBoot: false
};

/* ───────────────────────── розмови ───────────────────────── */

const keyOf = (c) => (c.kind === 'room' ? 'room:' + c.id : c.kind === 'dm' ? 'dm:' + c.uid : 'main');
function parseKey(k) {
  if (!k || k === 'main') return { kind: 'main' };
  const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
  if (kind === 'room') return { kind: 'room', id };
  if (kind === 'dm') return { kind: 'dm', uid: id };
  return { kind: 'main' };
}
function msgKey(m) {
  if (m.room_id) return 'room:' + m.room_id;
  if (m.recipient_id) return 'dm:' + (m.user_id === S.me?.id ? m.recipient_id : m.user_id);
  return 'main';
}
const roomOf = (id) => S.rooms.find((r) => r.id === id);
function nameOf(uid) {
  if (!uid) return 'Колега';
  if (uid === S.me?.id) return S.name;
  const p = S.people.find((x) => x.id === uid);
  if (p?.full_name) return p.full_name;
  const m = S.msgs.find((x) => x.user_id === uid && x.user_name);
  return m?.user_name || S.online.get(uid) || 'Колега';
}
function chanInfo(c) {
  if (c.kind === 'room') {
    const r = roomOf(c.id);
    if (!r) return { icon: '#', title: 'Кімната', topic: '' };
    return { icon: r.is_public ? (r.icon || '#') : '🔒', title: r.name, topic: r.topic || (r.is_public ? '' : `Закрита кімната · ${(r.member_ids || []).length} учасн.`), room: r };
  }
  if (c.kind === 'dm') return { icon: '👤', title: nameOf(c.uid), topic: 'Особистий діалог — бачите лише ви двоє' };
  return { icon: '💬', title: 'Робочий чат департаменту', topic: 'Головна стрічка для всіх співробітників' };
}
const msgsOf = (key) => S.msgs.filter((m) => msgKey(m) === key);
const topicOf = (c) => voiceTopic(c, S.me?.id);
/** Канал голосу видно в «лобі» лише для відкритих розмов: закрита кімната і діалог — не для всіх очей. */
const lobbyTopic = (c) => (c.kind === 'main' || (c.kind === 'room' && roomOf(c.id)?.is_public) ? topicOf(c) : null);

/* ───────────────────────── непрочитане ───────────────────────── */

function lastAt(key) {
  const list = msgsOf(key);
  return list.length ? list[list.length - 1].created_at : null;
}
function unread(key) {
  const since = S.read?.[key];
  return S.msgs.filter((m) => msgKey(m) === key && m.user_id !== S.me?.id && (!since || m.created_at > since)).length;
}
function markRead(key) {
  const at = lastAt(key);
  if (!at || S.read[key] === at) return;
  S.read[key] = at;
  lsSet(LS_READ, S.read);
  renderSide();
  renderTitle();
}
function renderTitle() {
  const keys = new Set(S.msgs.map(msgKey));
  let n = 0;
  keys.forEach((k) => { if (!S.muted.has(k)) n += unread(k); });
  document.title = `${n ? `(${n}) ` : ''}Чат департаменту | НавігаторПМГ26`;
}

/* ───────────────────────── дані: справжня база ───────────────────────── */

const api = {
  async loadAll() {
    const [rooms, people, msgs] = await Promise.all([
      S.sb.from('chat_rooms').select('*'),
      S.sb.from('profiles').select('id, full_name, role, Section').neq('role', 'guest'),
      S.sb.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(PAGE)
    ]);
    if (msgs.error) throw msgs.error;
    S.rooms = rooms.data || [];
    S.people = (people.data || []).filter((p) => p.full_name).sort((a, b) => a.full_name.localeCompare(b.full_name, 'uk'));
    (msgs.data || []).reverse().forEach(addMsg);
    await api.loadRx(S.msgs.map((m) => m.id));
  },
  async loadRx(ids) {
    for (let i = 0; i < ids.length; i += 120) {
      const { data } = await S.sb.from('chat_reactions').select('*').in('message_id', ids.slice(i, i + 120));
      (data || []).forEach(addRx);
    }
  },
  async older(key, before) {
    const c = parseKey(key);
    let q = S.sb.from('chat_messages').select('*').lt('created_at', before);
    if (c.kind === 'room') q = q.eq('room_id', c.id);
    else if (c.kind === 'dm') q = q.is('room_id', null).or(`and(user_id.eq.${S.me.id},recipient_id.eq.${c.uid}),and(user_id.eq.${c.uid},recipient_id.eq.${S.me.id})`);
    else q = q.is('room_id', null).is('recipient_id', null);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(OLDER);
    if (error) throw error;
    (data || []).forEach(addMsg);
    await api.loadRx((data || []).map((m) => m.id));
    return (data || []).length;
  },
  async insert(row) {
    let { data, error } = await S.sb.from('chat_messages').insert(row).select();
    if (error && row.reply_to && missingCol(error)) {
      // Міграції 03d ще немає: відповідь перетворюємо на цитату в тексті
      S.hasReply = false;
      const src = S.byId.get(row.reply_to);
      const quote = src ? `↩ ${shortName(src.user_name)}: «${preview(src.message_text, 60)}»\n` : '';
      const { reply_to, ...rest } = row;
      ({ data, error } = await S.sb.from('chat_messages').insert({ ...rest, message_text: quote + rest.message_text }).select());
    }
    if (error) throw error;
    return data?.[0];
  },
  async update(id, text) {
    let patch = { message_text: text };
    if (S.hasEdited) patch.edited_at = new Date().toISOString();
    let { data, error } = await S.sb.from('chat_messages').update(patch).eq('id', id).select();
    if (error && missingCol(error)) {
      S.hasEdited = false;
      patch = { message_text: text };
      ({ data, error } = await S.sb.from('chat_messages').update(patch).eq('id', id).select());
    }
    if (error) throw error;
    if (!data?.length) throw new Error('редагувати можна лише свої повідомлення');
    return data[0];
  },
  async remove(id) {
    const { error } = await S.sb.from('chat_messages').delete().eq('id', id);
    if (error) throw error;
  },
  async react(msgId, emoji) {
    const { data, error } = await S.sb.from('chat_reactions').insert({ message_id: msgId, user_id: S.me.id, user_name: S.name, emoji }).select();
    if (error) throw error;
    return data?.[0];
  },
  async unreact(id) {
    const { error } = await S.sb.from('chat_reactions').delete().eq('id', id);
    if (error) throw error;
  },
  async pin(id, top) {
    const { error } = await S.sb.rpc('chat_set_pin', { p_id: id, p_top: top });
    if (!error) return;
    // Функції ще немає (міграція 03d) — своє можна закріпити й напряму
    if (error.code === 'PGRST202' || /function/i.test(error.message)) {
      const { data, error: e2 } = await S.sb.from('chat_messages').update({ is_top: top }).eq('id', id).select('id');
      if (e2) throw e2;
      if (!data?.length) throw new Error('до міграції 03d закріпити можна лише своє повідомлення');
      return;
    }
    throw error;
  },
  async createRoom(row) {
    const { data, error } = await S.sb.from('chat_rooms').insert(row).select();
    if (error) throw error;
    return data?.[0];
  },
  async updateRoom(id, patch) {
    const { data, error } = await S.sb.from('chat_rooms').update(patch).eq('id', id).select();
    if (error) throw error;
    if (!data?.length) throw new Error('змінювати кімнату може її творець або адміністратор');
    return data[0];
  },
  async deleteRoom(id) {
    const { error } = await S.sb.from('chat_rooms').delete().eq('id', id);
    if (error) throw error;
  },
  async upload(file, name) {
    const ext = (name.split('.').pop() || 'bin').toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await S.sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (error) throw error;
    return S.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  },
  /** Бакет приватний: файл відкриваємо підписаним посиланням на годину. */
  async signed(url) {
    const m = (url || '').match(STORAGE_RE);
    if (!m) return url;
    const key = m[1] + '/' + m[2];
    const hit = S.signed.get(key);
    if (hit && hit.until > Date.now()) return hit.url;
    const { data } = await S.sb.storage.from(m[1]).createSignedUrl(decodeURIComponent(m[2]), 3600);
    if (!data?.signedUrl) return url;
    S.signed.set(key, { url: data.signedUrl, until: Date.now() + 55 * 60000 });
    return data.signedUrl;
  },
  async ping(uids, c, label) {
    const rows = uids.map((uid) => ({
      sender_id: S.me.id, sender_name: S.name, recipient_id: uid,
      room_id: c.kind === 'room' ? c.id : null, room_name: label, note: 'voice|' + keyOf(c)
    }));
    const { error } = await S.sb.from('chat_pings').insert(rows);
    if (error) throw error;
  },
  async seen(id) {
    await S.sb.from('chat_pings').update({ seen: true }).eq('id', id);
  }
};

/* ───────────────────────── стан повідомлень ───────────────────────── */

function addMsg(m) {
  if (!m?.id || S.byId.has(m.id)) return false;
  S.byId.set(m.id, m);
  // Вставляємо на своє місце за часом (догрузка «раніших» приходить зверху)
  let i = S.msgs.length;
  while (i > 0 && S.msgs[i - 1].created_at > m.created_at) i--;
  S.msgs.splice(i, 0, m);
  return true;
}
function patchMsg(n) {
  const m = S.byId.get(n.id);
  if (m) Object.assign(m, n);
  return m;
}
function dropMsg(id) {
  if (!S.byId.has(id)) return;
  S.byId.delete(id);
  S.msgs = S.msgs.filter((m) => m.id !== id);
  S.rx.delete(id);
}
function addRx(r) {
  if (!r?.id || S.rxMsg.has(r.id)) return;
  S.rxMsg.set(r.id, r.message_id);
  if (!S.rx.has(r.message_id)) S.rx.set(r.message_id, []);
  S.rx.get(r.message_id).push(r);
}
function dropRx(id) {
  const mid = S.rxMsg.get(id);
  if (!mid) return;
  S.rxMsg.delete(id);
  S.rx.set(mid, (S.rx.get(mid) || []).filter((r) => r.id !== id));
  return mid;
}

/* ───────────────────────── Realtime ───────────────────────── */

function subscribe() {
  const ch = S.sb.channel('zv-db')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, ({ eventType, new: n, old: o }) => {
      if (eventType === 'INSERT') {
        if (addMsg(n)) onIncoming(n);
      } else if (eventType === 'UPDATE') {
        if (patchMsg(n)) refreshFor(msgKey(n));
      } else if (eventType === 'DELETE') {
        const m = S.byId.get(o.id);
        if (!m) return;
        dropMsg(o.id);
        refreshFor(msgKey(m));
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, ({ eventType, new: n, old: o }) => {
      if (eventType === 'INSERT' && S.byId.has(n.message_id)) { addRx(n); refreshFor(msgKey(S.byId.get(n.message_id))); }
      if (eventType === 'DELETE') { const mid = dropRx(o.id); if (mid && S.byId.has(mid)) refreshFor(msgKey(S.byId.get(mid))); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_rooms' }, async () => {
      const { data } = await S.sb.from('chat_rooms').select('*');
      if (data) S.rooms = data;
      if (S.chan.kind === 'room' && !roomOf(S.chan.id)) openChan({ kind: 'main' });
      renderAll();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_pings', filter: `recipient_id=eq.${S.me.id}` }, ({ new: p }) => onPing(p))
    .subscribe((status) => {
      S.dbStatus = status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'connecting';
      renderMe();
      // Після обриву зв'язку могли загубитися повідомлення — дочитуємо пропущене
      if (status === 'SUBSCRIBED' && S.msgs.length) catchUp();
    });
  window.addEventListener('pagehide', () => S.sb.removeChannel(ch));
}

async function catchUp() {
  const last = S.msgs[S.msgs.length - 1]?.created_at;
  if (!last) return;
  const { data } = await S.sb.from('chat_messages').select('*').gt('created_at', last).order('created_at').limit(200);
  let any = false;
  (data || []).forEach((m) => { if (addMsg(m)) any = true; });
  if (any) renderAll(true);
}

function refreshFor(key) {
  if (key === keyOf(S.chan)) renderLog();
  renderSide();
  renderTitle();
}

function onIncoming(m) {
  const key = msgKey(m);
  const here = key === keyOf(S.chan) && !document.hidden && isChatVisible();
  refreshFor(key);
  if (m.user_id === S.me?.id) return;
  if (here && nearBottom()) { markRead(key); return; }
  if (S.muted.has(key)) return;
  // Особисте й головна стрічка — завжди; кімнати — як у старому чаті, теж усі
  alertIncoming(m, chanInfo(parseKey(key)).title);
}

/* ───────────────────────── присутність ───────────────────────── */

/** Хто на порталі — з присутності auth-v2.js (той самий канал, що «в мережі» в шапці). */
function readPresence(state) {
  S.online = new Map();
  Object.values(state || {}).forEach((arr) => {
    const p = arr?.[0];
    if (p?.user_id && p.user_name) S.online.set(p.user_id, p.user_name);
  });
  if (S.me) S.online.set(S.me.id, S.name);
  renderAside();
  renderSide();
}

/** «Лобі» голосу: хто в голосі якої відкритої розмови (для списку кімнат і шапки). */
function openLobby() {
  const ch = S.sb.channel('voice:lobby', { config: { private: true, presence: { key: S.lobbyKey } } });
  S.lobbyCh = ch;
  ch.on('presence', { event: 'sync' }, () => {
    S.lobby = new Map();
    Object.values(ch.presenceState() || {}).forEach((arr) => {
      const p = arr?.[arr.length - 1];
      if (!p?.topic) return;
      if (!S.lobby.has(p.topic)) S.lobby.set(p.topic, []);
      S.lobby.get(p.topic).push(p);
    });
    renderSide();
    renderVoice();
  }).subscribe((status) => { if (status === 'SUBSCRIBED') trackLobby(); });
}

function trackLobby() {
  if (!S.lobbyCh) return;
  const vs = S.vs;
  const c = vs?.chan;
  const topic = vs && vs.status !== 'idle' && c ? lobbyTopic(c) : null;
  if (topic) S.lobbyCh.track({ uid: S.me.id, name: S.name, topic, muted: vs.muted }).catch(() => {});
  else S.lobbyCh.untrack().catch(() => {});
}

/** Хто в голосі розмови c: якщо ми там — точний список із голосового каналу, інакше — з лобі. */
function voiceMembers(c) {
  const t = topicOf(c);
  if (S.vs?.topic === t) return S.vs.members;
  const seen = new Set();
  return (S.lobby.get(t) || []).filter((p) => !seen.has(p.uid) && seen.add(p.uid)).map((p) => ({ ...p, key: p.uid }));
}

/* ───────────────────────── голос ───────────────────────── */

/** quiet — не кликати співрозмовника в діалозі (уже покликаний). */
async function joinVoice(c = S.chan, quiet) {
  const info = chanInfo(c);
  S.vsChan = c;
  await S.voice.join(topicOf(c), info.title);
  // Діалог 1:1 у «лобі» не світимо, тож співрозмовника кличемо напряму (chat_pings)
  if (c.kind === 'dm' && !DEMO && !quiet) api.ping([c.uid], c, S.name).catch(() => {});
}

function onVoice(vs) {
  S.vs = { ...vs, chan: vs.status === 'idle' ? null : S.vsChan };
  trackLobby();
  renderVoice();
  renderSide();
  if (vs.members.length >= MANY && vs.status === 'live') toast(`У голосі ${vs.members.length} — пряма схема може не витягнути, звук може рватися.`);
}

function onPing(p) {
  if (!p || p.seen) return;
  const [kind, key] = String(p.note || '').split('|');
  if (kind !== 'voice') return;
  const c = parseKey(key === 'dm:' + p.recipient_id ? 'dm:' + p.sender_id : key);
  const where = c.kind === 'dm' ? 'на розмову' : `у голос «${p.room_name || chanInfo(c).title}»`;
  sound();
  notify(`${p.sender_name} кличе ${where}`, 'Натисніть, щоб приєднатися', () => { openChan(c); joinVoice(c); });
  toast(`📣 ${p.sender_name} кличе ${where}`, false, {
    label: 'Приєднатися',
    run: () => { openChan(c); joinVoice(c); }
  });
  if (!DEMO) api.seen(p.id).catch(() => {});
}

/* ───────────────────────── сповіщення ───────────────────────── */

const notifOn = () => lsGet(LS_NOTIF, true) !== false;

function sound() {
  if (!notifOn()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = sound.ctx || (sound.ctx = new AC());
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    [[587.33, 0, 0.12], [880, 0.07, 0.18]].forEach(([f, at, len]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + at;
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + len);
    });
  } catch (_) { /* без звуку */ }
}

function notify(title, body, onClick) {
  if (!notifOn() || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, icon: '../assets/icon-192.png', tag: 'zv-' + title, renotify: true });
    n.onclick = () => { window.focus(); n.close(); onClick?.(); };
  } catch (_) { /* мобільний Chrome вимагає SW для сповіщень — лишається звук */ }
}

function alertIncoming(m, where) {
  sound();
  const c = parseKey(msgKey(m));
  notify(c.kind === 'dm' ? `${m.user_name}` : `${m.user_name} · ${where}`, preview(m.message_text, 120), () => openChan(c));
}

async function toggleNotif() {
  if ('Notification' in window && Notification.permission === 'default') {
    const p = await Notification.requestPermission();
    lsSet(LS_NOTIF, p === 'granted');
    if (p === 'granted') sound();
  } else if ('Notification' in window && Notification.permission === 'denied' && !notifOn()) {
    toast('Сповіщення заблоковані в налаштуваннях браузера для цього сайту. Звук можна ввімкнути й так.', true);
    lsSet(LS_NOTIF, true);
  } else {
    lsSet(LS_NOTIF, !notifOn());
    if (notifOn()) sound();
  }
  renderMe();
}

/* ───────────────────────── дії з повідомленнями ───────────────────────── */

/** Нове повідомлення в поточну розмову (з відповіддю, якщо її вибрано). */
async function post(text) {
  const c = S.chan;
  const row = { user_id: S.me.id, user_name: S.name, message_text: text };
  if (c.kind === 'room') row.room_id = c.id;
  if (c.kind === 'dm') row.recipient_id = c.uid;
  if (S.replyTo && S.hasReply) row.reply_to = S.replyTo;
  else if (S.replyTo) {
    const src = S.byId.get(S.replyTo);
    if (src) row.message_text = `↩ ${shortName(src.user_name)}: «${preview(src.message_text, 60)}»\n${text}`;
  }
  const m = await api.insert(row);
  if (m) addMsg(m);
  setReply(null);
  renderLog(true);
  renderSide();
  markRead(keyOf(c));
}

async function send() {
  const ta = $('zvInput');
  const text = ta.value.trim();
  if (!text) return;
  const btn = $('zvSend');
  btn.disabled = true;
  try {
    if (S.editing) {
      patchMsg(await api.update(S.editing, text));
      setEditing(null);
      renderLog();
    } else {
      await post(text);
      ta.value = '';
      autosize(ta);
    }
  } catch (e) {
    toast('Не надіслано: ' + (e.message || e), true);
  }
  btn.disabled = false;
  ta.focus();
}

async function sendFiles(files) {
  for (const f of files) {
    if (f.size > FILE_LIMIT) { toast(`«${f.name}» більший за 10 МБ — не надіслано.`, true); continue; }
    const name = f.name || `зображення-${Date.now()}.png`;
    busy(`Завантаження «${name}»…`);
    try {
      const url = await api.upload(f, name);
      await post(`📎 [Файл: ${name} (${bytes(f.size)})](${url})`);
    } catch (e) {
      toast(`«${name}» не завантажено: ${e.message || e}`, true);
    }
    busy('');
  }
}

async function toggleReaction(msgId, emoji) {
  const mine = (S.rx.get(msgId) || []).find((r) => r.user_id === S.me.id && r.emoji === emoji);
  try {
    if (mine) { await api.unreact(mine.id); dropRx(mine.id); }
    else { const r = await api.react(msgId, emoji); if (r) addRx(r); }
  } catch (e) {
    toast('Реакцію не збережено: ' + (e.message || e), true);
  }
  renderLog();
}

async function removeMsg(id) {
  if (!confirm('Видалити повідомлення? Його не стане в усіх.')) return;
  try {
    await api.remove(id);
    dropMsg(id);
    renderLog();
    renderSide();
  } catch (e) {
    toast('Не видалено: ' + (e.message || e), true);
  }
}

const canPin = (m) => {
  if (m.recipient_id) return false;
  const r = m.room_id ? roomOf(m.room_id) : null;
  return m.user_id === S.me.id || LEADERS.includes(S.role) || (r && (r.created_by === S.me.id || !r.is_public));
};

async function togglePin(id) {
  const m = S.byId.get(id);
  if (!m) return;
  try {
    await api.pin(id, !m.is_top);
    m.is_top = !m.is_top;
    renderLog();
    renderPins();
  } catch (e) {
    toast('Не закріплено: ' + (e.message || e), true);
  }
}

function setReply(id) {
  S.replyTo = id;
  if (id) S.editing = null;
  renderBanner();
  if (id) $('zvInput').focus();
}

function setEditing(id) {
  S.editing = id;
  const ta = $('zvInput');
  if (id) {
    S.replyTo = null;
    ta.value = S.byId.get(id)?.message_text || '';
    autosize(ta);
    ta.focus();
  } else {
    ta.value = '';
    autosize(ta);
  }
  renderBanner();
}

/* ───────────────────────── перемикання розмов ───────────────────────── */

function openChan(c, fromUrl) {
  if (c.kind === 'room' && !roomOf(c.id)) c = { kind: 'main' };
  if (c.kind === 'dm' && c.uid === S.me?.id) c = { kind: 'main' };
  S.chan = c;
  S.pinsOpen = false;
  setEditing(null);
  setReply(null);
  lsSet(LS_LAST, keyOf(c));
  if (!fromUrl && !POPUP) history.replaceState(null, '', `?${DEMO ? 'demo=1&' : ''}c=${encodeURIComponent(keyOf(c))}`);
  document.body.classList.add('zv-in-chat');
  renderAll(true);
  if (nearBottom()) markRead(keyOf(c));
  if (matchMedia('(min-width: 981px)').matches) $('zvInput').focus({ preventScroll: true });
}

async function loadOlder() {
  const key = keyOf(S.chan);
  const first = msgsOf(key)[0];
  if (!first) return;
  const log = $('zvLog');
  const h = log.scrollHeight;
  try {
    const n = DEMO ? 0 : await api.older(key, first.created_at);
    if (n < OLDER) S.exhausted.add(key);
  } catch (e) {
    toast('Не вдалося догрузити: ' + (e.message || e), true);
  }
  renderLog();
  log.scrollTop = log.scrollHeight - h;
}

/* ───────────────────────── кімнати: створення й налаштування ───────────────────────── */

const canManage = (r) => r && (r.created_by === S.me?.id || ROOM_ADMINS.includes(S.role));

function roomDialog(room) {
  const dlg = $('zvDialog');
  const isNew = !room;
  const r = room || { name: '', icon: '💬', category: '📋 Робота', topic: '', is_public: true, member_ids: [S.me.id] };
  const members = new Set(r.member_ids || []);
  members.add(S.me.id);
  dlg.innerHTML = `
    <form method="dialog" class="zv-form-room">
      <h2>${isNew ? 'Нова кімната' : 'Налаштування кімнати'}</h2>
      <p class="zv-dlg-lead">У кожній кімнаті є текст і голос. ${isNew ? 'Створити кімнату може будь-який співробітник.' : ''}</p>
      <label class="zv-field"><span>Назва</span>
        <input name="name" required maxlength="60" value="${esc(r.name)}" placeholder="Напр.: Пакет 9 — робоча група"></label>
      <div class="zv-field"><span>Значок</span>
        <div class="zv-icons" role="radiogroup" aria-label="Значок кімнати">${ROOM_ICONS.map((i) =>
          `<label><input type="radio" name="icon" value="${i}" ${i === (r.icon || '💬') ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div></div>
      <label class="zv-field"><span>Про що кімната <i>(необов'язково)</i></span>
        <input name="topic" maxlength="140" value="${esc(r.topic || '')}" placeholder="Одним рядком — видно в шапці кімнати"></label>
      <fieldset class="zv-field zv-vis"><legend>Хто бачить</legend>
        <label><input type="radio" name="vis" value="public" ${r.is_public ? 'checked' : ''}> <b>Відкрита</b> — увесь департамент</label>
        <label><input type="radio" name="vis" value="private" ${r.is_public ? '' : 'checked'}> <b>Закрита</b> — лише вибрані люди</label>
      </fieldset>
      <label class="zv-field zv-cat"><span>Розділ у списку</span>
        <select name="category">${CATS.map((c) => `<option ${c === (r.category || '📋 Робота') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <div class="zv-field zv-members-pick"><span>Учасники <i>(ви — завжди)</i></span>
        <input type="search" class="zv-people-q" placeholder="Знайти колегу…" aria-label="Пошук колеги">
        <div class="zv-people">${S.people.filter((p) => p.id !== S.me.id).map((p) =>
          `<label data-n="${esc(p.full_name.toLowerCase())}"><input type="checkbox" name="m" value="${p.id}" ${members.has(p.id) ? 'checked' : ''}> ${esc(p.full_name)}</label>`).join('') || '<p class="zv-muted">Список колег недоступний.</p>'}</div></div>
      <div class="zv-dlg-actions">
        ${!isNew && canManage(room) ? '<button type="button" class="zv-btn zv-danger" data-act="del">Видалити кімнату</button>' : ''}
        <span class="zv-grow"></span>
        <button type="button" class="zv-btn" data-act="close">Скасувати</button>
        <button type="submit" class="zv-btn zv-primary">${isNew ? 'Створити' : 'Зберегти'}</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  const syncVis = () => {
    const pub = form.vis.value === 'public';
    form.querySelector('.zv-cat').hidden = !pub;
    form.querySelector('.zv-members-pick').hidden = pub;
  };
  form.addEventListener('change', syncVis);
  syncVis();
  form.querySelector('.zv-people-q').addEventListener('input', (e) => {
    const s = e.target.value.trim().toLowerCase();
    form.querySelectorAll('.zv-people label').forEach((l) => { l.hidden = s && !l.dataset.n.includes(s); });
  });
  form.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'close') dlg.close();
    if (a === 'del') {
      if (!confirm(`Видалити кімнату «${room.name}»? Усі її повідомлення зникнуть назавжди.`)) return;
      try {
        await api.deleteRoom(room.id);
        S.rooms = S.rooms.filter((x) => x.id !== room.id);
        S.msgs = S.msgs.filter((m) => m.room_id !== room.id);
        dlg.close();
        openChan({ kind: 'main' });
      } catch (err) { toast('Не видалено: ' + (err.message || err), true); }
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pub = form.vis.value === 'public';
    const row = {
      name: form.name.value.trim(),
      icon: form.icon.value || '💬',
      topic: form.topic.value.trim() || null,
      is_public: pub,
      category: pub ? form.category.value : null,
      member_ids: pub ? (r.member_ids?.length ? r.member_ids : [S.me.id]) : [S.me.id, ...[...form.querySelectorAll('[name=m]:checked')].map((x) => x.value)]
    };
    if (!row.name) return;
    try {
      let saved;
      if (isNew) saved = await api.createRoom({ ...row, created_by: S.me.id, sort_order: 100 });
      else saved = await api.updateRoom(room.id, row);
      S.rooms = S.rooms.filter((x) => x.id !== saved.id).concat(saved);
      dlg.close();
      openChan({ kind: 'room', id: saved.id });
      toast(isNew ? `Кімнату «${saved.name}» створено.` : 'Збережено.');
    } catch (err) {
      toast('Не збережено: ' + (err.message || err), true);
    }
  });
  dlg.showModal();
  form.name.focus();
}

/** Новий особистий діалог: вибір колеги. */
function peopleDialog() {
  const dlg = $('zvDialog');
  const list = S.people.filter((p) => p.id !== S.me.id)
    .sort((a, b) => (S.online.has(b.id) - S.online.has(a.id)) || a.full_name.localeCompare(b.full_name, 'uk'));
  dlg.innerHTML = `
    <form method="dialog" class="zv-form-people">
      <h2>Новий особистий діалог</h2>
      <p class="zv-dlg-lead">Повідомлення бачите лише ви двоє.</p>
      <input type="search" class="zv-people-q" placeholder="Знайти колегу…" aria-label="Пошук колеги">
      <div class="zv-people zv-people-pick">${list.map((p) => `
        <button type="button" class="zv-person" data-uid="${p.id}" data-n="${esc(p.full_name.toLowerCase())}">
          <span class="zv-ava" aria-hidden="true">${esc(initials(p.full_name))}</span>
          <span class="zv-person-name">${esc(p.full_name)}</span>
          ${S.online.has(p.id) ? '<span class="zv-on" title="у мережі"></span>' : ''}
        </button>`).join('') || '<p class="zv-muted">Немає кого показати.</p>'}</div>
      <div class="zv-dlg-actions"><span class="zv-grow"></span><button type="button" class="zv-btn" data-act="close">Скасувати</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  filterPeople(form);
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-act=close]')) return dlg.close();
    const b = e.target.closest('.zv-person');
    if (b) { dlg.close(); openChan({ kind: 'dm', uid: b.dataset.uid }); }
  });
  dlg.showModal();
  form.querySelector('.zv-people-q').focus();
}

function filterPeople(form) {
  form.querySelector('.zv-people-q').addEventListener('input', (e) => {
    const s = e.target.value.trim().toLowerCase();
    form.querySelectorAll('.zv-person').forEach((l) => { l.hidden = s && !l.dataset.n.includes(s); });
  });
}

/* ───────────────────────── вигляд: список розмов ───────────────────────── */

function sideItem(c, { icon, title, sub, lock }) {
  const key = keyOf(c);
  const n = unread(key);
  const mute = S.muted.has(key);
  const active = key === keyOf(S.chan);
  const vm = voiceMembers(c);
  return `<li>
    <button type="button" class="zv-item${active ? ' is-active' : ''}${n && !mute ? ' is-unread' : ''}" data-key="${esc(key)}"${active ? ' aria-current="true"' : ''}>
      <span class="zv-item-ico" aria-hidden="true">${esc(icon)}</span>
      <span class="zv-item-name">${esc(title)}${lock ? ' <i class="zv-lock" title="Закрита кімната">🔒</i>' : ''}</span>
      ${sub ? `<span class="zv-item-sub">${sub}</span>` : ''}
      ${vm.length ? `<span class="zv-item-voice" title="У голосі: ${esc(vm.map((m) => m.name).join(', '))}">🔊 ${vm.length}</span>` : ''}
      ${mute ? '<span class="zv-item-mute" title="Сповіщення вимкнено">🔕</span>' : n ? `<span class="zv-badge" aria-label="непрочитаних: ${n}">${n > 99 ? '99+' : n}</span>` : ''}
    </button>
    ${vm.length ? `<ul class="zv-item-people" aria-label="У голосі">${vm.slice(0, 6).map((m) =>
      `<li data-vk="${esc(m.key)}"><span class="zv-ava zv-ava-xs" aria-hidden="true">${esc(initials(m.name))}</span>${esc(shortName(m.name))}${m.muted ? ' <i aria-label="мікрофон вимкнено">🔇</i>' : ''}</li>`).join('')}${vm.length > 6 ? `<li class="zv-muted">ще ${vm.length - 6}</li>` : ''}</ul>` : ''}
  </li>`;
}

function renderSide() {
  const box = $('zvList');
  if (!box || !S.me) return;
  const q = ($('zvFilter')?.value || '').trim().toLowerCase();
  const hit = (t) => !q || t.toLowerCase().includes(q);
  const myDept = (S.dept || '').toLowerCase();
  let html = '';
  // Головна стрічка — перша, як «Загальний» у старому чаті
  if (hit('Робочий чат департаменту загальний')) {
    html += `<ul class="zv-group">${sideItem({ kind: 'main' }, { icon: '💬', title: 'Робочий чат департаменту' })}</ul>`;
  }

  // Відкриті кімнати за категоріями. Відкрита «Загальний» — порожній дублікат головної стрічки
  const pub = S.rooms.filter((r) => r.is_public && r.name !== 'Загальний');
  const byCat = {};
  pub.forEach((r) => { const c = CATS.includes(r.category) ? r.category : '📋 Робота'; (byCat[c] = byCat[c] || []).push(r); });
  CATS.forEach((cat) => {
    const list = (byCat[cat] || []).filter((r) => hit(r.name)).sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.name.localeCompare(b.name, 'uk'));
    if (!list.length) return;
    const folded = S.fold.has(cat) && !q;
    html += `<div class="zv-cat-head"><button type="button" data-fold="${esc(cat)}" aria-expanded="${!folded}">${esc(cat)}<span aria-hidden="true">${folded ? '▸' : '▾'}</span></button></div>`;
    if (!folded) {
      html += `<ul class="zv-group">${list.map((r) => sideItem({ kind: 'room', id: r.id }, {
        icon: r.icon || '#', title: r.name, sub: r.dept && myDept && r.dept.toLowerCase() === myDept ? '<b class="zv-mine" title="Ваш відділ">● ваш відділ</b>' : ''
      })).join('')}</ul>`;
    }
  });

  // Закриті кімнати й особисті діалоги
  const priv = S.rooms.filter((r) => !r.is_public && hit(r.name));
  const dms = new Map();
  S.msgs.forEach((m) => {
    if (m.room_id || !m.recipient_id) return;
    const other = m.user_id === S.me.id ? m.recipient_id : m.user_id;
    if (other !== S.me.id) dms.set(other, m.created_at);
  });
  if (S.chan.kind === 'dm' && !dms.has(S.chan.uid)) dms.set(S.chan.uid, '');
  const dmList = [...dms.entries()].sort((a, b) => (b[1] || '').localeCompare(a[1] || '')).map(([uid]) => uid).filter((uid) => hit(nameOf(uid)));
  html += `<div class="zv-cat-head"><span>👤 Особисті</span><button type="button" class="zv-mini" data-act="new-dm" title="Новий особистий діалог" aria-label="Новий особистий діалог">＋</button></div>`;
  html += `<ul class="zv-group">${priv.map((r) => sideItem({ kind: 'room', id: r.id }, { icon: r.icon || '👥', title: r.name, lock: true })).join('')}${
    dmList.map((uid) => sideItem({ kind: 'dm', uid }, { icon: S.online.has(uid) ? '🟢' : '👤', title: nameOf(uid) })).join('')}</ul>`;
  if (!priv.length && !dmList.length) html += '<p class="zv-side-empty">Натисніть ＋ або на колегу в списку «У мережі», щоб написати особисто.</p>';
  box.innerHTML = html;
}

/* ───────────────────────── вигляд: шапка, голос, закріплене ───────────────────────── */

function renderHead() {
  const c = S.chan;
  const info = chanInfo(c);
  const pins = msgsOf(keyOf(c)).filter((m) => m.is_top).length;
  const inHere = S.vs?.topic === topicOf(c) && S.vs.status !== 'idle';
  const vm = voiceMembers(c);
  $('zvHeadIco').textContent = info.icon;
  $('zvHeadTitle').textContent = info.title;
  $('zvHeadTopic').textContent = info.topic || '';
  $('zvHeadTopic').hidden = !info.topic;
  const vb = $('zvVoiceBtn');
  vb.classList.toggle('is-on', inHere);
  vb.setAttribute('aria-pressed', String(inHere));
  vb.innerHTML = inHere ? '🔊 <span>У голосі</span>' : `🎙 <span>Голос${vm.length ? ` · ${vm.length}` : ''}</span>`;
  vb.title = inHere ? 'Ви в голосі цієї розмови' : c.kind === 'dm' ? 'Голосова розмова з колегою' : 'Приєднатися до голосу цієї кімнати';
  const pb = $('zvPinsBtn');
  pb.hidden = c.kind === 'dm';
  pb.innerHTML = `📌${pins ? `<span>${pins}</span>` : ''}`;
  pb.setAttribute('aria-expanded', String(S.pinsOpen));
  $('zvSettingsBtn').hidden = !(c.kind === 'room' && canManage(roomOf(c.id)));
  const key = keyOf(c);
  const mb = $('zvMuteBtn');
  mb.textContent = S.muted.has(key) ? '🔕' : '🔔';
  mb.title = S.muted.has(key) ? 'Сповіщення з цієї розмови вимкнено — увімкнути' : 'Вимкнути сповіщення з цієї розмови';
  mb.setAttribute('aria-pressed', String(S.muted.has(key)));
  $('zvPopupBtn').hidden = POPUP;
  const ta = $('zvInput');
  // На телефоні довгий підпис переноситься й вилазить за однорядкове поле
  ta.placeholder = matchMedia('(max-width: 600px)').matches ? 'Повідомлення…' : c.kind === 'dm' ? `Повідомлення для ${shortName(info.title)}…` : c.kind === 'room' ? `Повідомлення в «${info.title}»…` : 'Повідомлення всьому департаменту…';
}

function voiceBtns(compact) {
  const vs = S.vs;
  return `<button type="button" class="zv-btn zv-vbtn${vs.muted ? '' : ' is-on'}" data-act="mic" aria-pressed="${!vs.muted}" title="${vs.muted ? 'Увімкнути мікрофон — вас почують' : 'Вимкнути мікрофон'}">${vs.muted ? '🎙' : '🎙'}${compact ? '' : `<span>${vs.muted ? 'Говорити' : 'Мікрофон увімк.'}</span>`}</button>
    <button type="button" class="zv-btn zv-vbtn${vs.deaf ? ' is-off' : ''}" data-act="deaf" aria-pressed="${vs.deaf}" title="${vs.deaf ? 'Увімкнути звук' : 'Вимкнути звук (і мікрофон)'}">${vs.deaf ? '🔕' : '🎧'}</button>
    <button type="button" class="zv-btn zv-vbtn zv-leave" data-act="leave-voice" title="Вийти з голосу">✕${compact ? '' : '<span>Вийти</span>'}</button>`;
}

function renderVoice() {
  renderHead();
  const c = S.chan;
  const strip = $('zvStrip');
  const vs = S.vs;
  const inHere = vs && vs.status !== 'idle' && vs.topic === topicOf(c);
  const vm = voiceMembers(c);
  if (inHere) {
    const people = vs.members.slice().sort((a, b) => (b.me - a.me) || (a.name || '').localeCompare(b.name || '', 'uk'));
    strip.hidden = false;
    strip.innerHTML = `
      <ul class="zv-vpeople" aria-label="У голосі">${people.map((m) => `
        <li class="zv-vp${m.muted ? ' is-muted' : ''}${m.state === 'bad' ? ' is-bad' : ''}${m.state === 'wait' ? ' is-wait' : ''}" data-vk="${esc(m.key)}"
            title="${esc(m.name)}${m.me ? ' (ви)' : ''} — ${m.deaf ? 'звук вимкнено' : m.muted ? 'мікрофон вимкнено' : 'говорить'}${m.state === 'bad' ? ' · немає з\'єднання' : m.state === 'wait' ? ' · з\'єднуємо…' : ''}">
          <span class="zv-ava" aria-hidden="true">${esc(initials(m.name))}</span>
          <span class="zv-vp-name">${esc(shortName(m.name))}${m.me ? ' <i>(ви)</i>' : ''}</span>
          ${m.deaf ? '<span aria-label="звук вимкнено">🔕</span>' : m.muted ? '<span aria-label="мікрофон вимкнено">🔇</span>' : ''}${m.state === 'bad' ? '<span aria-label="немає з\'єднання">⚠</span>' : ''}
        </li>`).join('')}</ul>
      ${vs.status === 'joining' ? '<p class="zv-vnote">Заходимо в голос…</p>' : ''}
      ${vs.status === 'error' ? `<p class="zv-vnote is-bad">${esc(vs.error)}</p>` : ''}
      ${vs.status === 'live' && people.length < 2 ? `<p class="zv-vnote">Поки що ви тут самі. ${c.kind === 'dm' ? 'Колезі надіслано запрошення.' : ''}</p>` : ''}
      ${vs.needGesture ? '<button type="button" class="zv-btn" data-act="sound">🔊 Натисніть, щоб чути колег</button>' : ''}
      <div class="zv-vctl">${voiceBtns(false)}</div>`;
  } else if (vm.length) {
    strip.hidden = false;
    strip.innerHTML = `
      <ul class="zv-vpeople is-peek" aria-label="Зараз у голосі">${vm.map((m) => `
        <li class="zv-vp${m.muted ? ' is-muted' : ''}" data-vk="${esc(m.key)}" title="${esc(m.name)}"><span class="zv-ava" aria-hidden="true">${esc(initials(m.name))}</span><span class="zv-vp-name">${esc(shortName(m.name))}</span></li>`).join('')}</ul>
      <div class="zv-vctl"><span class="zv-vnote">Зараз у голосі: ${vm.length}</span><button type="button" class="zv-btn zv-primary" data-act="join-voice">🎙 Приєднатися</button></div>`;
  } else {
    strip.hidden = true;
    strip.innerHTML = '';
  }

  // Док голосу внизу списку розмов — видно, де ми в голосі, навіть з іншої кімнати
  const dock = $('zvDock');
  if (vs && vs.status !== 'idle') {
    dock.hidden = false;
    dock.innerHTML = `
      <button type="button" class="zv-dock-where" data-act="goto-voice" title="Перейти до розмови">
        <span class="zv-dot${vs.status === 'live' ? ' is-live' : ''}${vs.status === 'error' ? ' is-bad' : ''}" aria-hidden="true"></span>
        <span><b>${vs.status === 'error' ? 'Голос: помилка' : vs.status === 'joining' ? 'З\'єднуємо…' : 'У голосі'}</b><small>${esc(vs.label)} · ${vs.members.length}</small></span>
      </button>
      <div class="zv-dock-ctl">${voiceBtns(true)}</div>`;
  } else {
    dock.hidden = true;
    dock.innerHTML = '';
  }
  document.body.classList.toggle('zv-has-dock', !!(vs && vs.status !== 'idle'));
}

function renderPins() {
  const box = $('zvPins');
  const list = msgsOf(keyOf(S.chan)).filter((m) => m.is_top);
  box.hidden = !S.pinsOpen;
  if (!S.pinsOpen) return;
  box.innerHTML = `<h3>📌 Важливе в цій розмові</h3>${list.length ? `<ul>${list.map((m) => `
    <li><button type="button" class="zv-pin" data-goto="${m.id}"><b>${esc(shortName(m.user_name))}</b> ${esc(preview(m.message_text, 90))}</button>
    ${canPin(m) ? `<button type="button" class="zv-mini" data-unpin="${m.id}" title="Відкріпити" aria-label="Відкріпити">✕</button>` : ''}</li>`).join('')}</ul>`
    : '<p class="zv-muted">Нічого не закріплено. Наведіть на повідомлення й натисніть 📌.</p>'}`;
}

function renderBanner() {
  const b = $('zvBanner');
  const id = S.editing || S.replyTo;
  if (!id) { b.hidden = true; return; }
  const m = S.byId.get(id);
  b.hidden = false;
  b.innerHTML = `<span>${S.editing ? '✏️ Редагування' : `↩ Відповідь <b>${esc(shortName(m?.user_name))}</b>`}: ${esc(preview(m?.message_text, 80))}</span>
    <button type="button" class="zv-mini" data-act="cancel-banner" aria-label="Скасувати">✕</button>`;
}

/* ───────────────────────── вигляд: стрічка повідомлень ───────────────────────── */

function nearBottom() {
  const log = $('zvLog');
  return log.scrollHeight - log.scrollTop - log.clientHeight < 90;
}
function isChatVisible() {
  return matchMedia('(min-width: 981px)').matches || document.body.classList.contains('zv-in-chat');
}

function renderLog(stick) {
  const log = $('zvLog');
  const key = keyOf(S.chan);
  const list = msgsOf(key);
  const wasNear = nearBottom();
  if (!list.length) {
    log.innerHTML = `<div class="zv-empty"><span aria-hidden="true">${esc(chanInfo(S.chan).icon)}</span>
      <p>${S.chan.kind === 'dm' ? 'Напишіть перше повідомлення — бачите лише ви двоє.' : 'Тут ще тихо. Напишіть першим або зайдіть у голос.'}</p></div>`;
    renderPins();
    return;
  }
  const since = S.read?.[key];
  let day = '';
  let prev = null;
  let newMark = false;
  let html = S.exhausted.has(key) || DEMO
    ? '<p class="zv-start">Початок розмови</p>'
    : '<button type="button" class="zv-btn zv-older" data-act="older">Показати раніші повідомлення</button>';
  list.forEach((m) => {
    const d = new Date(m.created_at);
    const dk = d.toDateString();
    if (dk !== day) { day = dk; html += `<div class="zv-day"><span>${esc(dayLabel(d))}</span></div>`; prev = null; }
    if (!newMark && since && m.created_at > since && m.user_id !== S.me.id) {
      newMark = true;
      html += '<div class="zv-new"><span>Нові повідомлення</span></div>';
      prev = null;
    }
    // Кілька повідомлень поспіль від однієї людини за 5 хв — без повтору імені
    const cont = prev && prev.user_id === m.user_id && d - new Date(prev.created_at) < 5 * 60000 && !m.reply_to;
    prev = m;
    html += msgHtml(m, cont);
  });
  log.innerHTML = html;
  // Відкрили розмову з непрочитаним, якого більше за екран — стаємо на позначку «Нові»
  const mark = stick && log.querySelector('.zv-new');
  if (mark && log.scrollHeight - mark.offsetTop > log.clientHeight) log.scrollTop = mark.offsetTop - 48;
  else if (stick || wasNear) log.scrollTop = log.scrollHeight;
  log.querySelectorAll('img[data-src]').forEach(async (img) => {
    img.src = DEMO ? img.dataset.src : await api.signed(img.dataset.src);
    img.removeAttribute('data-src');
  });
  renderPins();
}

function msgHtml(m, cont) {
  const mine = m.user_id === S.me.id;
  const big = emojiOnly(m.message_text);
  const rx = S.rx.get(m.id) || [];
  const groups = new Map();
  rx.forEach((r) => { if (!groups.has(r.emoji)) groups.set(r.emoji, []); groups.get(r.emoji).push(r); });
  const src = m.reply_to ? S.byId.get(m.reply_to) : null;
  const d = new Date(m.created_at);
  return `<article class="zv-msg${mine ? ' is-mine' : ''}${cont ? ' is-cont' : ''}${m.is_top ? ' is-top' : ''}${big ? ' is-big' : ''}" data-id="${m.id}" tabindex="-1">
    ${cont ? `<time class="zv-ghost-time" datetime="${esc(m.created_at)}">${hhmm(d)}</time>` : `<span class="zv-ava" aria-hidden="true">${esc(initials(m.user_name))}</span>`}
    <div class="zv-msg-main">
      ${cont ? '' : `<header class="zv-meta"><b>${esc(m.user_name || 'Колега')}</b><time datetime="${esc(m.created_at)}" title="${esc(d.toLocaleString('uk-UA'))}">${hhmm(d)}</time>${m.is_top ? '<span class="zv-flag">📌 важливе</span>' : ''}</header>`}
      ${m.reply_to ? `<button type="button" class="zv-quote" data-goto="${m.reply_to}">${src ? `<b>${esc(shortName(src.user_name))}</b> ${esc(preview(src.message_text, 90))}` : '<i>повідомлення видалено або ще не завантажене</i>'}</button>` : ''}
      <div class="zv-text">${body(m.message_text)}${m.edited_at ? ' <small class="zv-edited" title="' + esc(new Date(m.edited_at).toLocaleString('uk-UA')) + '">(змінено)</small>' : ''}</div>
      ${groups.size ? `<div class="zv-rx">${[...groups.entries()].map(([e, list]) => {
        const my = list.some((r) => r.user_id === S.me.id);
        return `<button type="button" class="zv-rx-pill${my ? ' is-mine' : ''}" data-rx="${esc(e)}" aria-pressed="${my}" title="${esc(list.map((r) => r.user_name).join(', '))}">${esc(e)}<span>${list.length}</span></button>`;
      }).join('')}<button type="button" class="zv-rx-pill zv-rx-add" data-act="react" title="Додати реакцію" aria-label="Додати реакцію">＋</button></div>` : ''}
    </div>
    <div class="zv-acts" role="toolbar" aria-label="Дії з повідомленням">
      ${QUICK.slice(0, 3).map((e) => `<button type="button" data-rx="${e}" title="Реакція ${e}">${e}</button>`).join('')}
      <button type="button" data-act="react" title="Інша реакція" aria-label="Інша реакція">😀</button>
      <button type="button" data-act="reply" title="Відповісти" aria-label="Відповісти">↩</button>
      ${canPin(m) ? `<button type="button" data-act="pin" title="${m.is_top ? 'Відкріпити' : 'Закріпити як важливе'}" aria-label="${m.is_top ? 'Відкріпити' : 'Закріпити'}">📌</button>` : ''}
      ${mine && !FILE_RE.test(m.message_text) ? '<button type="button" data-act="edit" title="Редагувати" aria-label="Редагувати">✏️</button>' : ''}
      ${mine ? '<button type="button" data-act="del" title="Видалити" aria-label="Видалити">🗑</button>' : ''}
    </div>
  </article>`;
}

function body(text) {
  const f = (text || '').match(FILE_RE);
  if (f) {
    const desc = f[1];
    const cut = desc.lastIndexOf('(');
    const name = cut > 0 ? desc.slice(0, cut).trim() : desc;
    const size = cut > 0 ? desc.slice(cut + 1, -1).trim() : '';
    const ext = name.split('.').pop().toLowerCase();
    if (IMG_EXT.includes(ext)) {
      return `<a class="zv-file zv-file-img" href="#" data-file="${esc(f[2])}" title="Відкрити «${esc(name)}»"><img data-src="${esc(f[2])}" alt="${esc(name)}" loading="lazy"><span>${esc(name)} · ${esc(size)}</span></a>`;
    }
    const icon = ext === 'pdf' ? '📕' : ['doc', 'docx'].includes(ext) ? '📘' : ['xls', 'xlsx', 'csv'].includes(ext) ? '📗' : ['ppt', 'pptx'].includes(ext) ? '📙' : '📄';
    return `<a class="zv-file" href="#" data-file="${esc(f[2])}" title="Відкрити «${esc(name)}»"><span class="zv-file-ico" aria-hidden="true">${icon}</span><span class="zv-file-name">${esc(name)}</span><small>${esc(size)}</small></a>`;
  }
  return esc(text)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
    .replace(/\n/g, '<br>');
}

function preview(t, n = 70) {
  const f = (t || '').match(FILE_RE);
  const s = f ? '📎 ' + f[1].replace(/\s*\([^)]*\)\s*$/, '') : (t || '').replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function dayLabel(d) {
  const t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Сьогодні';
  if (d.toDateString() === y.toDateString()) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}
function bytes(n) {
  if (!n) return '0 B';
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return parseFloat((n / 1024 ** i).toFixed(1)) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
}

/* ───────────────────────── вигляд: хто тут ───────────────────────── */

function renderAside() {
  const box = $('zvAsideList');
  if (!box || !S.me) return;
  const c = S.chan;
  const r = c.kind === 'room' ? roomOf(c.id) : null;
  let people;
  let title;
  if (r && !r.is_public) {
    title = `Учасники · ${(r.member_ids || []).length}`;
    people = (r.member_ids || []).map((uid) => ({ uid, name: nameOf(uid) }));
  } else {
    title = `У мережі · ${S.online.size}`;
    people = [...S.online.entries()].map(([uid, name]) => ({ uid, name }));
  }
  people.sort((a, b) => (b.uid === S.me.id) - (a.uid === S.me.id) || (S.online.has(b.uid) - S.online.has(a.uid)) || a.name.localeCompare(b.name, 'uk'));
  $('zvAsideTitle').textContent = title;
  box.innerHTML = people.map((p) => {
    const me = p.uid === S.me.id;
    return `<li><button type="button" class="zv-person" data-dm="${me ? '' : p.uid}" ${me ? 'disabled' : `title="Написати особисто: ${esc(p.name)}"`}>
      <span class="zv-ava" aria-hidden="true">${esc(initials(p.name))}</span>
      <span class="zv-person-name">${esc(p.name)}${me ? ' <i>(ви)</i>' : ''}</span>
      ${S.online.has(p.uid) ? '<span class="zv-on" title="у мережі"></span>' : ''}
    </button></li>`;
  }).join('') || '<li class="zv-muted">Нікого не видно.</li>';
  $('zvAside').classList.toggle('is-open', S.asideOpen);
  $('zvPeopleBtn').setAttribute('aria-expanded', String(S.asideOpen));
}

function renderMe() {
  const st = $('zvStatus');
  if (!st) return;
  const ok = S.dbStatus === 'live';
  st.innerHTML = `<span class="zv-dot${ok ? ' is-live' : S.dbStatus === 'error' ? ' is-bad' : ''}" aria-hidden="true"></span>${ok ? 'На зв\'язку' : S.dbStatus === 'error' ? 'Немає зв\'язку' : 'Підключення…'}`;
  const nb = $('zvNotifBtn');
  const denied = 'Notification' in window && Notification.permission === 'denied';
  nb.textContent = notifOn() ? (denied ? '🔔 Лише звук' : '🔔 Сповіщення') : '🔕 Без сповіщень';
  nb.setAttribute('aria-pressed', String(notifOn()));
  nb.title = notifOn() ? 'Звук і сповіщення про нові повідомлення увімкнено — вимкнути' : 'Увімкнути звук і сповіщення';
}

function renderAll(stick) {
  renderSide();
  renderVoice();
  renderLog(stick);
  renderAside();
  renderBanner();
  renderTitle();
}

/* ───────────────────────── дрібниці інтерфейсу ───────────────────────── */

function toast(text, bad, action) {
  const t = $('zvToast');
  t.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="zv-btn zv-primary">${esc(action.label)}</button>` : ''}`;
  t.classList.toggle('is-bad', !!bad);
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, action ? 20000 : 3600);
}

function busy(text) {
  const b = $('zvBusy');
  b.textContent = text;
  b.hidden = !text;
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
}

let picker = null;
function openPicker(anchor, forWhat) {
  if (!picker) {
    picker = buildPicker((e) => {
      if (S.pickerFor === 'input') {
        const ta = $('zvInput');
        const a = ta.selectionStart ?? ta.value.length;
        const b = ta.selectionEnd ?? a;
        ta.value = ta.value.slice(0, a) + e + ta.value.slice(b);
        ta.selectionStart = ta.selectionEnd = a + e.length;
        ta.focus();
        autosize(ta);
      } else if (S.pickerFor) {
        toggleReaction(S.pickerFor, e);
        picker.hidden = true;
      }
    });
    document.body.append(picker);
  }
  if (!picker.hidden && S.pickerFor === forWhat) { picker.hidden = true; return; }
  S.pickerFor = forWhat;
  picker.refresh();
  picker.hidden = false;
  // Поруч із кнопкою, але в межах вікна; на телефоні CSS робить із нього шторку знизу
  const r = anchor.getBoundingClientRect();
  const w = picker.offsetWidth || 320;
  const h = picker.offsetHeight || 340;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  const top = r.top - h - 8 > 8 ? r.top - h - 8 : Math.min(r.bottom + 8, window.innerHeight - h - 8);
  picker.style.left = left + 'px';
  picker.style.top = Math.max(8, top) + 'px';
  if (matchMedia('(min-width: 600px)').matches) picker.querySelector('.zv-emoji-q').focus({ preventScroll: true });
}

function flash(id) {
  const el = $('zvLog').querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!el) return toast('Це повідомлення старіше за завантажені — натисніть «Показати раніші».');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 1600);
}

function openPopup() {
  const url = new URL(location.href);
  url.search = '';
  if (DEMO) url.searchParams.set('demo', '1');
  url.searchParams.set('mode', 'popup');
  url.searchParams.set('c', keyOf(S.chan));
  const w = 440;
  const h = 680;
  const win = window.open(url.toString(), 'zv_popup', `width=${w},height=${h},left=${screen.width - w - 40},top=80,menubar=no,status=no,toolbar=no,location=no,resizable=yes`);
  if (!win) toast('Браузер заблокував вікно: дозвольте спливні вікна для цього сайту.', true);
}

/* ───────────────────────── події ───────────────────────── */

function wire() {
  const ta = $('zvInput');
  $('zvForm').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape' && (S.editing || S.replyTo)) { setEditing(null); setReply(null); }
    // ↑ у порожньому полі — редагувати своє останнє (як у Slack/Discord)
    if (e.key === 'ArrowUp' && !ta.value) {
      const last = msgsOf(keyOf(S.chan)).filter((m) => m.user_id === S.me.id && !FILE_RE.test(m.message_text)).pop();
      if (last) { e.preventDefault(); setEditing(last.id); }
    }
  });
  ta.addEventListener('input', () => autosize(ta));
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); sendFiles(files); }
  });
  $('zvFile').addEventListener('change', (e) => { sendFiles([...e.target.files]); e.target.value = ''; });
  $('zvEmojiBtn').addEventListener('click', (e) => openPicker(e.currentTarget, 'input'));

  // Перетягування файлів у розмову
  const main = $('zvMain');
  const drop = $('zvDrop');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  main.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; drop.hidden = false; } });
  main.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
  main.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  main.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    sendFiles([...e.dataTransfer.files]);
  });

  $('zvSide').addEventListener('click', (e) => {
    const it = e.target.closest('[data-key]');
    if (it) return openChan(parseKey(it.dataset.key));
    const f = e.target.closest('[data-fold]');
    if (f) {
      const cat = f.dataset.fold;
      S.fold.has(cat) ? S.fold.delete(cat) : S.fold.add(cat);
      lsSet(LS_FOLD, [...S.fold]);
      return renderSide();
    }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'new-dm') peopleDialog();
    if (a === 'new-room') roomDialog(null);
    if (a === 'notif') toggleNotif();
    voiceAct(a);
  });
  $('zvFilter').addEventListener('input', renderSide);

  document.querySelector('.zv-head').addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'back') { document.body.classList.remove('zv-in-chat'); renderSide(); }
    if (a === 'voice') {
      const inHere = S.vs?.topic === topicOf(S.chan) && S.vs.status !== 'idle';
      if (inHere) S.voice.leave(); else joinVoice();
    }
    if (a === 'pins') { S.pinsOpen = !S.pinsOpen; renderHead(); renderPins(); }
    if (a === 'people') { S.asideOpen = !S.asideOpen; renderAside(); }
    if (a === 'settings') roomDialog(roomOf(S.chan.id));
    if (a === 'mute') {
      const k = keyOf(S.chan);
      S.muted.has(k) ? S.muted.delete(k) : S.muted.add(k);
      lsSet(LS_MUTE, [...S.muted]);
      renderHead();
      renderSide();
      renderTitle();
    }
    if (a === 'popup') openPopup();
  });

  $('zvStrip').addEventListener('click', (e) => voiceAct(e.target.closest('[data-act]')?.dataset.act));

  $('zvPins').addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { S.pinsOpen = false; renderHead(); renderPins(); return flash(g.dataset.goto); }
    const u = e.target.closest('[data-unpin]');
    if (u) togglePin(u.dataset.unpin);
  });

  $('zvBanner').addEventListener('click', (e) => {
    if (e.target.closest('[data-act=cancel-banner]')) { setEditing(null); setReply(null); }
  });

  $('zvLog').addEventListener('click', async (e) => {
    if (e.target.closest('[data-act=older]')) return loadOlder();
    const art = e.target.closest('.zv-msg');
    const g = e.target.closest('[data-goto]');
    if (g) return flash(g.dataset.goto);
    const file = e.target.closest('a[data-file]');
    if (file) {
      e.preventDefault();
      if (DEMO) return toast('Демо: файл не завантажувався.');
      const w = window.open('', '_blank');
      const url = await api.signed(file.dataset.file);
      if (w) w.location = url; else window.open(url, '_blank');
      return;
    }
    if (!art) return;
    const id = art.dataset.id;
    const rx = e.target.closest('[data-rx]');
    if (rx) return toggleReaction(id, rx.dataset.rx);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'react') return openPicker(e.target.closest('button'), id);
    if (act === 'reply') return setReply(id);
    if (act === 'edit') return setEditing(id);
    if (act === 'pin') return togglePin(id);
    if (act === 'del') return removeMsg(id);
    // На дотиковому екрані наведення немає: дотик показує панель дій
    if (!e.target.closest('a, button')) {
      $('zvLog').querySelectorAll('.zv-msg.is-touched').forEach((x) => x !== art && x.classList.remove('is-touched'));
      art.classList.toggle('is-touched');
    }
  });
  $('zvLog').addEventListener('scroll', () => { if (nearBottom() && !document.hidden) markRead(keyOf(S.chan)); }, { passive: true });

  $('zvAside').addEventListener('click', (e) => {
    const p = e.target.closest('[data-dm]');
    if (p?.dataset.dm) { S.asideOpen = false; openChan({ kind: 'dm', uid: p.dataset.dm }); }
    if (e.target.closest('[data-act=close-aside]')) { S.asideOpen = false; renderAside(); }
  });

  document.addEventListener('click', (e) => {
    if (picker && !picker.hidden && !picker.contains(e.target) && !e.target.closest('#zvEmojiBtn, [data-act=react]')) picker.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picker && !picker.hidden) picker.hidden = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && nearBottom()) markRead(keyOf(S.chan));
  });
  window.addEventListener('pmg:presence', (e) => readPresence(e.detail));
  // Підпис колонки ще не має сенсу без входу — нижче він з'явиться
}

function voiceAct(a) {
  if (!a) return;
  if (a === 'join-voice') joinVoice();
  if (a === 'leave-voice') S.voice.leave();
  if (a === 'mic') S.voice.toggleMic();
  if (a === 'deaf') S.voice.toggleDeaf();
  if (a === 'sound') S.voice.unlock();
  if (a === 'goto-voice' && S.vs?.chan) openChan(S.vs.chan);
}

/* ───────────────────────── старт ───────────────────────── */

async function client() {
  // auth-v2.js — модуль і може підвантажитися пізніше за цей скрипт
  for (let i = 0; i < 40 && !window.__pmgSb; i++) await new Promise((r) => setTimeout(r, 150));
  return window.__pmgSb || null;
}

function notice(text) {
  $('zvLog').innerHTML = `<div class="zv-empty"><span aria-hidden="true">💬</span><p>${esc(text)}</p></div>`;
}

function firstChan() {
  const want = QS.get('c') || lsGet(LS_LAST, 'main');
  return parseKey(want);
}

async function boot() {
  if (POPUP) document.body.classList.add('is-popup');
  wire();
  if (DEMO) return bootDemo();

  S.sb = await client();
  if (!S.sb) return notice('Не вдалося підключитися до бази. Оновіть сторінку.');
  const { data: { session } } = await S.sb.auth.getSession();
  S.me = session?.user ?? null;
  if (!S.me) return notice('Увійдіть, щоб відкрити чат департаменту.');
  const { data: prof } = await S.sb.from('profiles').select('full_name, role, Section, department').eq('id', S.me.id).single();
  S.role = prof?.role || 'guest';
  if (S.role === 'guest') return notice('Чат доступний лише співробітникам департаменту.');
  S.name = prof?.full_name || S.me.user_metadata?.full_name || S.me.email.split('@')[0];
  S.dept = prof?.Section || prof?.department || '';
  document.body.classList.add('zv-ready');

  try {
    await api.loadAll();
  } catch (e) {
    return notice('Не вдалося завантажити чат: ' + (e.message || e));
  }
  // Перший захід: усе, що було до нього, вважаємо прочитаним — інакше стіна «непрочитаних»
  if (!S.read) {
    S.read = {};
    new Set(S.msgs.map(msgKey)).forEach((k) => { S.read[k] = lastAt(k); });
    lsSet(LS_READ, S.read);
  }
  S.online.set(S.me.id, S.name);
  if (window.__pmgPresence) readPresence(window.__pmgPresence);

  S.voice = createVoice({ sb: S.sb, me: S.me, name: S.name, toast, onChange: onVoice });
  subscribe();
  openLobby();
  renderMe();
  openChan(firstChan(), true);
  if (!matchMedia('(min-width: 981px)').matches && !QS.get('c')) document.body.classList.remove('zv-in-chat');
  // Дзвінки в особистому діалозі, що прийшли, поки сторінка була закрита (за останні 10 хв)
  const { data: pings } = await S.sb.from('chat_pings').select('*').eq('recipient_id', S.me.id).eq('seen', false)
    .gt('created_at', new Date(Date.now() - 10 * 60000).toISOString()).order('created_at', { ascending: false }).limit(1);
  (pings || []).forEach(onPing);
}

/* ───────────────────────── демо (?demo=1) ───────────────────────── */

function bootDemo() {
  document.body.classList.add('zv-demo', 'zv-ready');
  S.me = { id: 'me' };
  S.name = 'Демо-користувач';
  S.role = 'expert';
  S.dept = 'демо-відділ';
  S.read = {};
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  S.people = [
    { id: 'me', full_name: 'Демо-користувач' },
    { id: 'u1', full_name: 'Олена Приклад' },
    { id: 'u2', full_name: 'Петро Зразок', Section: 'демо-відділ' },
    { id: 'u3', full_name: 'Ірина Вигадана', Section: 'демо-відділ' },
    { id: 'u4', full_name: 'Андрій Тестовий' }
  ];
  S.rooms = [
    { id: 'r1', name: 'Оголошення', category: '📢 Загальне', icon: '📣', is_public: true, sort_order: 2, created_by: 'u1', member_ids: [] },
    { id: 'r2', name: 'Демо-відділ', category: '📁 Відділи', icon: '🔬', is_public: true, dept: 'демо-відділ', sort_order: 1, member_ids: [] },
    { id: 'r3', name: 'Пакети ПМГ-2026', category: '📋 Робота', icon: '📦', is_public: true, sort_order: 1, topic: 'Специфікації, тарифи, зміни до пакетів', member_ids: [] },
    { id: 'r4', name: 'Флуд / позаробоче', category: '☕ Позаробоче', icon: '☕', is_public: true, sort_order: 1, member_ids: [] },
    { id: 'r5', name: 'Робоча група (демо)', icon: '🤝', is_public: false, created_by: 'me', member_ids: ['me', 'u1', 'u3'] }
  ];
  const msgs = [
    ['m1', 60 * 26, 'u1', 'Олена Приклад', 'Колеги, доброго ранку! Нагадую про нараду о 14:00 👋'],
    ['m2', 60 * 25, 'u2', 'Петро Зразок', 'Буду, дякую 👍'],
    ['m3', 62, 'u2', 'Петро Зразок', '📎 [Файл: lyst_demo_v2.docx (48.2 KB)](#demo)'],
    ['m4', 61, 'u2', 'Петро Зразок', 'Друга версія — з правками керівника. Подивіться, будь ласка, п. 3.'],
    ['m5', 20, 'u3', 'Ірина Вигадана', 'Подивилась, по п. 3 є зауваження — напишу в документі.', 'm4'],
    ['m6', 3, 'me', 'Демо-користувач', 'Дякую, подивлюсь і відпишу тут.'],
    ['m7', 2, 'u1', 'Олена Приклад', '🎉🎉'],
    ['m8', 1, 'u4', 'Андрій Тестовий', 'Хтось бачив нову редакцію специфікації?']
  ];
  msgs.forEach(([id, min, uid, name, text, reply]) => addMsg({ id, created_at: ago(min), user_id: uid, user_name: name, message_text: text, reply_to: reply || null, room_id: id === 'm8' ? 'r3' : null }));
  addMsg({ id: 'd1', created_at: ago(5), user_id: 'u1', user_name: 'Олена Приклад', message_text: 'Можна тебе на хвилинку в голос?', recipient_id: 'me' });
  S.byId.get('m1').is_top = true;
  S.byId.get('m4').edited_at = ago(50);
  [['x1', 'm2', 'u1', 'Олена Приклад', '👍'], ['x2', 'm2', 'u3', 'Ірина Вигадана', '👍'], ['x3', 'm4', 'me', 'Демо-користувач', '✅'], ['x4', 'm7', 'u2', 'Петро Зразок', '❤️']]
    .forEach(([id, mid, uid, name, emoji]) => addRx({ id, message_id: mid, user_id: uid, user_name: name, emoji }));
  S.msgs.forEach((m) => { if (m.id !== 'm8' && m.id !== 'd1') S.read[msgKey(m)] = m.created_at; });
  S.read.main = ago(2.5);
  S.online = new Map([['me', S.name], ['u1', 'Олена Приклад'], ['u2', 'Петро Зразок'], ['u3', 'Ірина Вигадана']]);
  S.lobby = new Map([['voice:room:r2', [{ uid: 'u2', name: 'Петро Зразок', muted: false, topic: 'voice:room:r2' }, { uid: 'u3', name: 'Ірина Вигадана', muted: true, topic: 'voice:room:r2' }]]]);
  S.dbStatus = 'live';

  // Дані — у пам'яті: ті самі обробники, що й для бази
  let n = 100;
  const now = () => new Date().toISOString();
  Object.assign(api, {
    insert: async (row) => ({ ...row, id: 'n' + n++, created_at: now() }),
    update: async (id, text) => ({ id, message_text: text, edited_at: now() }),
    remove: async () => {},
    react: async (mid, emoji) => ({ id: 'r' + n++, message_id: mid, user_id: 'me', user_name: S.name, emoji }),
    unreact: async () => {},
    pin: async () => {},
    createRoom: async (row) => ({ ...row, id: 'room' + n++ }),
    updateRoom: async (id, patch) => ({ ...roomOf(id), ...patch }),
    deleteRoom: async () => {},
    upload: async () => '#demo',
    signed: async (u) => u
  });

  // Голос у демо: учасники вигадані, звуку немає
  const demoVoice = { topic: '', label: '', status: 'idle', muted: true, deaf: false, members: [], key: 'me' };
  const emitV = () => onVoice({ ...demoVoice, members: demoVoice.members.map((m) => ({ ...m })) });
  S.voice = {
    async join(topic, label) {
      Object.assign(demoVoice, { topic, label, status: 'live', muted: true, deaf: false });
      const others = (S.lobby.get(topic) || []).map((p) => ({ key: p.uid, uid: p.uid, name: p.name, muted: p.muted, state: 'ok' }));
      demoVoice.members = [{ key: 'me', uid: 'me', name: S.name, muted: true, deaf: false, me: true, state: 'ok' }, ...others];
      S.lobby.delete(topic);
      emitV();
    },
    async leave() { Object.assign(demoVoice, { topic: '', label: '', status: 'idle', members: [] }); emitV(); },
    toggleMic() { demoVoice.muted = !demoVoice.muted; if (!demoVoice.muted) demoVoice.deaf = false; syncMe(); },
    toggleDeaf() { demoVoice.deaf = !demoVoice.deaf; if (demoVoice.deaf) demoVoice.muted = true; syncMe(); },
    unlock() {}
  };
  function syncMe() {
    const me = demoVoice.members.find((m) => m.me);
    if (me) Object.assign(me, { muted: demoVoice.muted, deaf: demoVoice.deaf });
    emitV();
  }
  setInterval(() => {
    document.querySelectorAll('[data-vk="u2"]').forEach((el) => el.classList.toggle('is-speaking', Math.random() > 0.5));
  }, 700);

  renderMe();
  openChan(firstChan(), true);
  if (!matchMedia('(min-width: 981px)').matches && !QS.get('c')) document.body.classList.remove('zv-in-chat');
}

boot();
