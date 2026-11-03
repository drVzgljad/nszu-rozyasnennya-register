/**
 * «Чат департаменту» — одна розмова на весь департамент: текст і голос.
 *
 * З 03.11.2026 (рішення власника) — лише головна стрічка «Робочий чат департаменту».
 * Кімнати й особисті діалоги з інтерфейсу прибрано: чати відділів живуть у «Справах»
 * (spravy/room-chat.js), а тут — максимально просто: стрічка, «У мережі» і одна
 * кнопка «🎙 Голос». Рядки кімнат і діалогів у базі лишилися, їх ніхто не видаляв.
 *
 * Дані — ті самі таблиці, що й у старому чаті:
 *   chat_messages  — головна стрічка = room_id і recipient_id порожні;
 *   chat_reactions — реакції.
 * Ту саму стрічку видно й у «Справах» → кімната «Департамент» (spravy/room-chat.js):
 * одна розмова, а не копія. Формат файлового повідомлення спільний:
 * `📎 [Файл: назва (розмір)](URL сховища)`, бакет приватний.
 *
 * Голос — voice.js, канал 'voice:all' (той самий, що «Департамент» у «Справах»).
 * На сторінці канал відкрито в режимі «лише дивлюся»: видно, хто в голосі, тебе — ні.
 * «🎙 Голос» = зайти й одразу говорити (мікрофон умикаємо, бо це свідома дія);
 * ще раз — вийти. Звук входу/виходу колег дає рушій.
 *
 * Галочка в «У мережі» (localStorage 'pmg-voice-glow') — чи «дихає» кнопка
 * «Чат департаменту» на інших сторінках порталу, коли хтось у голосі (auth-v2.js).
 *
 * Права — RLS (schema.sql, migration_2026-07-23c_chat_channels.sql,
 * migration_2026-11-03d_chat_voice_rooms.sql): читати й писати — співробітники,
 * змінювати й видаляти — своє; закріплювати — функція chat_set_pin. Голос головної
 * стрічки відкритий уже міграцією 03b. Без 03d сторінка працює, лише без відповідей
 * (вони стають цитатою в тексті) і позначки «змінено».
 *
 * ?demo=1 — демо без бази (вигадані люди й повідомлення) для перевірки вигляду.
 * ?mode=popup — плаваюче вікно.
 */

import { createVoice, MANY } from './voice.js?v=20261103g';
import { createMeeting } from './meeting.js?v=20261103a';
import { createStage } from './stage.js?v=20261103a';
import { QUICK, buildPicker, emojiOnly } from './emoji.js?v=20261103a';

const QS = new URLSearchParams(location.search);
const DEMO = QS.get('demo') === '1';
const POPUP = QS.get('mode') === 'popup';
const TOPIC = 'voice:all';
const TITLE = 'Робочий чат департаменту';
const PAGE = 300;              // скільки останніх повідомлень беремо на старті
const OLDER = 100;             // догрузка «раніші»
const FILE_LIMIT = 10 * 1024 * 1024;
const BUCKET = 'chat-attachments';
const FILE_RE = /^📎 \[Файл:\s*([^\]]+)\]\(([^)]+)\)/;
const STORAGE_RE = /\/storage\/v1\/object\/public\/([^/]+)\/([^?]+)/;
const IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const LEADERS = ['manager', 'deputy_director', 'director', 'admin'];
const LS_READ = 'zv-read';
const LS_NOTIF = 'chat_notifications_enabled'; // ключ старого чату — щоб вимкнене лишилося вимкненим
const LS_GLOW = 'pmg-voice-glow';              // '0' — не підсвічувати кнопку чату (читає auth-v2.js)

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* приватний режим */ } };
const initials = (n) => (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const shortName = (n) => { const p = (n || '').split(/\s+/).filter(Boolean); return p.length > 1 ? `${p[0]} ${p[1][0]}.` : (p[0] || 'Колега'); };
const hhmm = (d) => d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
const missingCol = (e) => e && (e.code === '42703' || e.code === 'PGRST204' || /column|schema cache/i.test(e.message || ''));
const isMain = (m) => !m.room_id && !m.recipient_id;
const wide = () => matchMedia('(min-width: 981px)').matches && !POPUP;

const S = {
  sb: null,
  me: null,
  name: '',
  role: 'expert',
  msgs: [],               // повідомлення головної стрічки, за часом
  byId: new Map(),
  rx: new Map(),          // id повідомлення → [реакції]
  rxMsg: new Map(),       // id реакції → id повідомлення (DELETE з Realtime несе лише id)
  read: lsGet(LS_READ, null),
  online: new Map(),      // uid → ім'я
  editing: null,
  replyTo: null,
  hasReply: true,         // чи є колонки міграції 03d (з'ясовується з першої помилки)
  hasEdited: true,
  exhausted: false,       // раніших повідомлень уже немає
  voice: null,
  vs: null,               // стан голосу (знімок із voice.js)
  pinsOpen: false,
  asideOpen: false,
  dbStatus: 'connecting',
  signed: new Map(),
  pickerFor: null,        // 'input' або id повідомлення (реакція)
  busyVoice: false
};

/* ───────────────────────── непрочитане ───────────────────────── */

const lastAt = () => S.msgs[S.msgs.length - 1]?.created_at || null;
const unread = () => S.msgs.filter((m) => m.user_id !== S.me?.id && (!S.read || m.created_at > S.read)).length;
function markRead() {
  const at = lastAt();
  if (!at || S.read === at) return;
  S.read = at;
  lsSet(LS_READ, at);
  renderTitle();
}
function renderTitle() {
  const n = unread();
  document.title = `${n ? `(${n}) ` : ''}Чат департаменту | НавігаторПМГ26`;
}

/* ───────────────────────── дані: справжня база ───────────────────────── */

const mainOnly = (q) => q.is('room_id', null).is('recipient_id', null);

const api = {
  async loadAll() {
    const { data, error } = await mainOnly(S.sb.from('chat_messages').select('*')).order('created_at', { ascending: false }).limit(PAGE);
    if (error) throw error;
    (data || []).reverse().forEach(addMsg);
    if ((data || []).length < PAGE) S.exhausted = true;
    await api.loadRx(S.msgs.map((m) => m.id));
  },
  async loadRx(ids) {
    for (let i = 0; i < ids.length; i += 120) {
      const { data } = await S.sb.from('chat_reactions').select('*').in('message_id', ids.slice(i, i + 120));
      (data || []).forEach(addRx);
    }
  },
  async older(before) {
    const { data, error } = await mainOnly(S.sb.from('chat_messages').select('*').lt('created_at', before)).order('created_at', { ascending: false }).limit(OLDER);
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
  }
};

/* ───────────────────────── стан повідомлень ───────────────────────── */

function addMsg(m) {
  if (!m?.id || !isMain(m) || S.byId.has(m.id)) return false;
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
  if (!S.byId.has(id)) return false;
  S.byId.delete(id);
  S.msgs = S.msgs.filter((m) => m.id !== id);
  S.rx.delete(id);
  return true;
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
        if (patchMsg(n)) renderLog();
      } else if (eventType === 'DELETE') {
        if (dropMsg(o.id)) { renderLog(); renderTitle(); }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, ({ eventType, new: n, old: o }) => {
      if (eventType === 'INSERT' && S.byId.has(n.message_id)) { addRx(n); renderLog(); }
      if (eventType === 'DELETE') { const mid = dropRx(o.id); if (mid && S.byId.has(mid)) renderLog(); }
    })
    .subscribe((status) => {
      S.dbStatus = status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'connecting';
      renderStatus();
      // Після обриву зв'язку могли загубитися повідомлення — дочитуємо пропущене
      if (status === 'SUBSCRIBED' && S.msgs.length) catchUp();
    });
  window.addEventListener('pagehide', () => S.sb.removeChannel(ch));
}

async function catchUp() {
  const last = lastAt();
  if (!last) return;
  const { data } = await mainOnly(S.sb.from('chat_messages').select('*').gt('created_at', last)).order('created_at').limit(200);
  let any = false;
  (data || []).forEach((m) => { if (addMsg(m)) any = true; });
  if (any) { renderLog(); renderTitle(); }
}

function onIncoming(m) {
  renderLog();
  renderTitle();
  if (m.user_id === S.me?.id) return;
  if (!document.hidden && nearBottom()) { markRead(); return; }
  sound();
  notify(m.user_name || 'Колега', preview(m.message_text, 120));
}

/* ───────────────────────── присутність ───────────────────────── */

/** Хто на порталі — з присутності auth-v2.js (той самий канал, що «в мережі» в шапці). */
function readPresence(state) {
  if (DEMO) return; // у демо люди вигадані — справжня присутність їх не перетирає
  S.online = new Map();
  Object.values(state || {}).forEach((arr) => {
    const p = arr?.[0];
    if (p?.user_id && p.user_name) S.online.set(p.user_id, p.user_name);
  });
  if (S.me) S.online.set(S.me.id, S.name);
  renderAside();
}

/* ───────────────────────── голос ───────────────────────── */

const inVoice = () => !!(S.vs && S.vs.inRoom && S.vs.status !== 'idle');

/** Хто в голосі: одна людина — один рядок, навіть якщо в неї відкрито дві вкладки. */
function voicePeople() {
  const byUid = new Map();
  (S.vs?.status === 'idle' ? [] : S.vs?.members || []).forEach((m) => {
    const id = m.uid || m.key;
    const had = byUid.get(id);
    if (!had || (m.me && !had.me)) byUid.set(id, m);
  });
  return [...byUid.values()].sort((a, b) => (b.me - a.me) || (a.name || '').localeCompare(b.name || '', 'uk'));
}

/** Одна кнопка: не в голосі — зайти й говорити; у голосі — вийти (лишаємось «дивитися»). */
async function toggleVoice() {
  if (S.busyVoice) return;
  S.busyVoice = true;
  renderVoice();
  try {
    if (inVoice()) {
      // Ви записуєте нараду — вихід її завершує (інакше запис пропаде)
      const stay = S.meet?.active && !confirm('Іде запис наради. Завершити нараду й зберегти запис?');
      if (!stay) {
        if (S.meet?.active) await S.meet.finish();
        await S.voice.exit();
      }
    } else {
      // Канал упав (мережа) — не чекаємо хвилину до повтору, перепідключаємось одразу
      if (S.voice.state.status === 'error') await S.voice.leave(true);
      if (!S.voice.topic) await S.voice.join(TOPIC, TITLE);
      else await S.voice.enter();
      if (S.voice.state.muted) await S.voice.toggleMic();
    }
  } catch (e) {
    toast('Голос: ' + (e.message || e), true);
  }
  S.busyVoice = false;
  renderVoice();
}

function onVoice(vs) {
  const n = voicePeople().length;
  S.vs = vs;
  renderVoice();
  renderAside();
  if (vs.inRoom && vs.status === 'live' && vs.members.length >= MANY && n < MANY) {
    toast(`У голосі ${vs.members.length} — пряма схема може не витягнути, звук може рватися.`);
  }
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

function notify(title, body) {
  if (!notifOn() || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden && document.hasFocus()) return;
  try {
    const n = new Notification(`${title} · Чат департаменту`, { body, icon: '../assets/icon-192.png', tag: 'zv-main', renotify: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (_) { /* мобільний Chrome вимагає SW для сповіщень — лишається звук */ }
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
  renderHead();
}

/* ───────────────────────── дії з повідомленнями ───────────────────────── */

/** Нове повідомлення (з відповіддю, якщо її вибрано). */
async function post(text) {
  const row = { user_id: S.me.id, user_name: S.name, message_text: text };
  if (S.replyTo && S.hasReply) row.reply_to = S.replyTo;
  else if (S.replyTo) {
    const src = S.byId.get(S.replyTo);
    if (src) row.message_text = `↩ ${shortName(src.user_name)}: «${preview(src.message_text, 60)}»\n${text}`;
  }
  const m = await api.insert(row);
  if (m) addMsg(m);
  setReply(null);
  renderLog(true);
  markRead();
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
  } catch (e) {
    toast('Не видалено: ' + (e.message || e), true);
  }
}

const canPin = (m) => m.user_id === S.me.id || LEADERS.includes(S.role);

async function togglePin(id) {
  const m = S.byId.get(id);
  if (!m) return;
  try {
    await api.pin(id, !m.is_top);
    m.is_top = !m.is_top;
    renderLog();
    renderHead();
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

async function loadOlder() {
  const first = S.msgs[0];
  if (!first) return;
  const log = $('zvLog');
  const h = log.scrollHeight;
  try {
    const n = DEMO ? 0 : await api.older(first.created_at);
    if (n < OLDER) S.exhausted = true;
  } catch (e) {
    toast('Не вдалося догрузити: ' + (e.message || e), true);
  }
  renderLog();
  log.scrollTop = log.scrollHeight - h;
}

/* ───────────────────────── вигляд: шапка й голос ───────────────────────── */

function renderHead() {
  const pins = S.msgs.filter((m) => m.is_top).length;
  const pb = $('zvPinsBtn');
  pb.innerHTML = `📌${pins ? `<span>${pins}</span>` : ''}`;
  pb.setAttribute('aria-expanded', String(S.pinsOpen));
  const nb = $('zvNotifBtn');
  const denied = 'Notification' in window && Notification.permission === 'denied';
  nb.textContent = notifOn() ? '🔔' : '🔕';
  nb.setAttribute('aria-pressed', String(notifOn()));
  nb.title = notifOn()
    ? `Звук${denied ? '' : ' і сповіщення'} про нові повідомлення увімкнено — вимкнути`
    : 'Увімкнути звук і сповіщення про нові повідомлення';
  $('zvPeopleBtn').querySelector('span').textContent = S.online.size || '';
  $('zvPopupBtn').hidden = POPUP;
  $('zvInput').placeholder = matchMedia('(max-width: 600px)').matches ? 'Повідомлення…' : 'Повідомлення всьому департаменту…';
}

/** Учасник голосу — однаково і в колонці, і в смузі на телефоні. */
function vpHtml(m) {
  const state = m.deaf ? 'звук вимкнено' : m.muted ? 'мікрофон вимкнено' : 'мікрофон увімкнено';
  const link = m.state === 'bad' ? ' · немає з\'єднання' : m.state === 'wait' ? ' · з\'єднуємо…' : '';
  return `<li class="zv-vp${m.muted ? ' is-muted' : ''}${m.state === 'bad' ? ' is-bad' : ''}${m.state === 'wait' ? ' is-wait' : ''}" data-vk="${esc(m.key)}" title="${esc(m.name)}${m.me ? ' (ви)' : ''} — ${state}${inVoice() ? link : ''}">
    <span class="zv-ava" aria-hidden="true">${esc(initials(m.name))}</span>
    <span class="zv-vp-name">${esc(m.name || 'Колега')}${m.me ? ' <i>(ви)</i>' : ''}</span>
    <span class="zv-vp-st">${m.deaf ? '<span aria-label="звук вимкнено">🔕</span>' : m.muted ? '<span aria-label="мікрофон вимкнено">🔇</span>' : '<span aria-label="мікрофон увімкнено">🎙</span>'}${inVoice() && m.state === 'bad' ? '<span aria-label="немає з\'єднання">⚠</span>' : ''}</span>
  </li>`;
}

function ctlHtml() {
  const vs = S.vs;
  return `<div class="zv-vctl">
    <button type="button" class="zv-btn zv-vbtn${vs.muted ? '' : ' is-on'}" data-act="mic" aria-pressed="${!vs.muted}" title="${vs.muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон — вас не чутимуть'}">${vs.muted ? '🔇' : '🎙'}<span>${vs.muted ? 'Мікрофон вимк.' : 'Мікрофон'}</span></button>
    <button type="button" class="zv-btn zv-vbtn${vs.deaf ? ' is-off' : ''}" data-act="deaf" aria-pressed="${vs.deaf}" title="${vs.deaf ? 'Увімкнути звук' : 'Вимкнути звук (і мікрофон)'}">${vs.deaf ? '🔕' : '🎧'}<span>${vs.deaf ? 'Звук вимк.' : 'Звук'}</span></button>
    ${meetBtn(vs)}
    ${vs.canShare ? `<button type="button" class="zv-btn zv-vbtn${vs.sharing ? ' is-on' : ''}" data-act="screen" aria-pressed="${!!vs.sharing}" title="${vs.sharing ? 'Зупинити показ екрана' : 'Показати колегам свій екран або вікно'}">🖥<span>${vs.sharing ? 'Показую' : 'Екран'}</span></button>` : ''}
  </div>`;
}

// «🔴 Нарада» — запис для протоколу (zviazok/meeting.js); поки пише хтось інший, кнопки немає
function meetBtn(vs) {
  if (!vs.canRecord) return '';
  if (vs.recording?.me) return '<button type="button" class="zv-btn zv-vbtn zv-rec is-on" data-act="meetend" title="Зупинити запис і зберегти нараду — протокол підготує Claude">⏹<span>Кінець наради</span></button>';
  if (vs.recording) return '';
  return '<button type="button" class="zv-btn zv-vbtn zv-rec" data-act="meet" title="Почати нараду: увімкнеться запис, усіх у кімнаті буде попереджено">🔴<span>Нарада</span></button>';
}

function recNote(vs) {
  if (!vs?.recording) return '';
  return `<p class="zv-vnote zv-recnote">🔴 Іде запис наради · ${vs.recording.me ? 'записуєте ви' : 'увімкнув(-ла) ' + esc(vs.recording.name)} · з ${new Date(vs.recording.since).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</p>`;
}

function voiceNote() {
  const vs = S.vs;
  if (!vs) return '';
  if (vs.recording) return recNote(vs);
  if (vs.status === 'error') return `<p class="zv-vnote is-bad">${esc(vs.error)}</p>`;
  if (inVoice() && vs.status === 'joining') return '<p class="zv-vnote">Заходимо в голос…</p>';
  if (inVoice() && voicePeople().length < 2) return '<p class="zv-vnote">Поки що ви тут самі — колеги почують сигнал, коли зайдуть.</p>';
  return '';
}

function renderVoice() {
  const people = voicePeople();
  const on = inVoice();
  const n = people.length;

  // Велика кнопка в шапці
  const vb = $('zvVoiceBtn');
  vb.classList.toggle('is-on', on);
  vb.classList.toggle('has-people', !on && n > 0);
  vb.setAttribute('aria-pressed', String(on));
  vb.disabled = S.busyVoice;
  vb.innerHTML = S.busyVoice
    ? '⏳ <span>Зачекайте…</span>'
    : on ? '📴 <span>Вийти з голосу</span>' : `🎙 <span>Голос</span>${n ? `<b class="zv-vcount">${n}</b>` : ''}`;
  vb.title = on ? 'Ви в ефірі. Натисніть, щоб вийти з голосу' : n ? `Зараз у голосі: ${n}. Натисніть — і ви в ефірі` : 'Натисніть — і ви в ефірі (мікрофон увімкнеться)';

  // Блок «Хто в голосі» вгорі колонки
  const box = $('zvVoiceBox');
  box.classList.toggle('is-live', n > 0);
  box.classList.toggle('is-in', on);
  box.innerHTML = `
    <h2><span class="zv-dot${n ? ' is-live' : ''}" aria-hidden="true"></span>У голосі${n ? ` · ${n}` : ''}</h2>
    ${n ? `<ul class="zv-vpeople" aria-label="Хто в голосі">${people.map(vpHtml).join('')}</ul>` : '<p class="zv-vnote">Зараз у голосі нікого. Натисніть «🎙 Голос» — і ви в ефірі.</p>'}
    ${voiceNote()}
    ${on && S.vs.needGesture ? '<button type="button" class="zv-btn" data-act="sound">🔊 Натисніть, щоб чути колег</button>' : ''}
    ${on ? ctlHtml() : ''}`;

  // Смуга під шапкою — на вузькому екрані, де колонка «У мережі» висувна
  const strip = $('zvStrip');
  if (!wide() && (on || n)) {
    strip.hidden = false;
    strip.innerHTML = `<ul class="zv-vpeople" aria-label="Хто в голосі">${people.map(vpHtml).join('')}</ul>
      ${voiceNote()}
      ${on && S.vs.needGesture ? '<button type="button" class="zv-btn" data-act="sound">🔊 Чути колег</button>' : ''}
      ${on ? ctlHtml() : ''}`;
  } else {
    strip.hidden = true;
    strip.innerHTML = '';
  }
}

function renderPins() {
  const box = $('zvPins');
  const list = S.msgs.filter((m) => m.is_top);
  box.hidden = !S.pinsOpen;
  if (!S.pinsOpen) return;
  box.innerHTML = `<h3>📌 Важливе</h3>${list.length ? `<ul>${list.map((m) => `
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

function renderLog(stick) {
  const log = $('zvLog');
  const list = S.msgs;
  const wasNear = nearBottom();
  if (!list.length) {
    log.innerHTML = '<div class="zv-empty"><span aria-hidden="true">💬</span><p>Тут ще тихо. Напишіть першим або натисніть «🎙 Голос».</p></div>';
    renderPins();
    return;
  }
  const since = S.read;
  let day = '';
  let prev = null;
  let newMark = false;
  let html = S.exhausted || DEMO
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
  // Відкрили з непрочитаним, якого більше за екран — стаємо на позначку «Нові»
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

/* ───────────────────────── вигляд: колонка «У мережі» ───────────────────────── */

function renderAside() {
  const box = $('zvAsideList');
  if (!box || !S.me) return;
  const talking = new Set(voicePeople().map((m) => m.uid));
  const people = [...S.online.entries()].map(([uid, name]) => ({ uid, name }))
    .sort((a, b) => (b.uid === S.me.id) - (a.uid === S.me.id) || (talking.has(b.uid) - talking.has(a.uid)) || a.name.localeCompare(b.name, 'uk'));
  $('zvAsideTitle').textContent = `У мережі · ${S.online.size}`;
  box.innerHTML = people.map((p) => `<li class="zv-person">
      <span class="zv-ava" aria-hidden="true">${esc(initials(p.name))}</span>
      <span class="zv-person-name">${esc(p.name)}${p.uid === S.me.id ? ' <i>(ви)</i>' : ''}</span>
      ${talking.has(p.uid) ? '<span class="zv-person-voice" title="У голосі">🎙</span>' : '<span class="zv-on" title="у мережі"></span>'}
    </li>`).join('') || '<li class="zv-muted">Нікого не видно.</li>';
  $('zvAside').classList.toggle('is-open', S.asideOpen);
  $('zvPeopleBtn').setAttribute('aria-expanded', String(S.asideOpen));
  $('zvPeopleBtn').querySelector('span').textContent = S.online.size || '';
}

function renderStatus() {
  const st = $('zvStatus');
  const ok = S.dbStatus === 'live';
  st.innerHTML = `<span class="zv-dot${ok ? ' is-live' : S.dbStatus === 'error' ? ' is-bad' : ''}" aria-hidden="true"></span>${ok ? 'На зв\'язку' : S.dbStatus === 'error' ? 'Немає зв\'язку' : 'Підключення…'}`;
}

function renderAll(stick) {
  renderHead();
  renderVoice();
  renderLog(stick);
  renderAside();
  renderBanner();
  renderTitle();
  renderStatus();
}

/* ───────────────────────── дрібниці інтерфейсу ───────────────────────── */

function toast(text, bad) {
  const t = $('zvToast');
  t.innerHTML = `<span>${esc(text)}</span>`;
  t.classList.toggle('is-bad', !!bad);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3600);
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
      const last = S.msgs.filter((m) => m.user_id === S.me.id && !FILE_RE.test(m.message_text)).pop();
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

  document.querySelector('.zv-head').addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'voice') toggleVoice();
    if (a === 'pins') { S.pinsOpen = !S.pinsOpen; renderHead(); renderPins(); }
    if (a === 'people') { S.asideOpen = !S.asideOpen; renderAside(); }
    if (a === 'notif') toggleNotif();
    if (a === 'popup') openPopup();
  });

  $('zvStrip').addEventListener('click', (e) => voiceAct(e.target.closest('[data-act]')?.dataset.act));
  $('zvVoiceBox').addEventListener('click', (e) => voiceAct(e.target.closest('[data-act]')?.dataset.act));

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
  $('zvLog').addEventListener('scroll', () => { if (nearBottom() && !document.hidden) markRead(); }, { passive: true });

  $('zvAside').addEventListener('click', (e) => {
    if (e.target.closest('[data-act=close-aside]')) { S.asideOpen = false; renderAside(); }
  });
  // Галочка: підсвічувати «Чат департаменту» на інших сторінках, коли хтось у голосі
  const glow = $('zvGlow');
  glow.checked = localStorage.getItem(LS_GLOW) !== '0';
  glow.addEventListener('change', () => {
    try { localStorage.setItem(LS_GLOW, glow.checked ? '1' : '0'); } catch (_) { /* приватний режим */ }
    toast(glow.checked ? 'Кнопка «Чат департаменту» світитиметься, коли хтось у голосі.' : 'Кнопку чату більше не підсвічуємо.');
  });

  document.addEventListener('click', (e) => {
    if (picker && !picker.hidden && !picker.contains(e.target) && !e.target.closest('#zvEmojiBtn, [data-act=react]')) picker.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picker && !picker.hidden) picker.hidden = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && nearBottom()) markRead();
  });
  // Смуга голосу є лише на вузькому екрані — перемальовуємо, коли ширина перетинає межу
  matchMedia('(min-width: 981px)').addEventListener('change', () => { renderVoice(); renderHead(); });
  window.addEventListener('pmg:presence', (e) => readPresence(e.detail));
}

function voiceAct(a) {
  if (!a) return;
  if (a === 'mic') S.voice.toggleMic();
  if (a === 'deaf') S.voice.toggleDeaf();
  if (a === 'screen') S.voice.toggleShare?.();
  if (a === 'sound') S.voice.unlock();
  if (a === 'meet') S.meet.start({ topic: TOPIC, label: TITLE }).then(renderVoice);
  if (a === 'meetend') S.meet.finish().then(renderVoice);
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

async function boot() {
  if (POPUP) document.body.classList.add('is-popup');
  wire();
  if (DEMO) return bootDemo();

  S.sb = await client();
  if (!S.sb) return notice('Не вдалося підключитися до бази. Оновіть сторінку.');
  const { data: { session } } = await S.sb.auth.getSession();
  S.me = session?.user ?? null;
  if (!S.me) return notice('Увійдіть, щоб відкрити чат департаменту.');
  const { data: prof } = await S.sb.from('profiles').select('full_name, role').eq('id', S.me.id).single();
  S.role = prof?.role || 'guest';
  if (S.role === 'guest') return notice('Чат доступний лише співробітникам департаменту.');
  S.name = prof?.full_name || S.me.user_metadata?.full_name || S.me.email.split('@')[0];
  document.body.classList.add('zv-ready');

  try {
    await api.loadAll();
  } catch (e) {
    return notice('Не вдалося завантажити чат: ' + (e.message || e));
  }
  // Перший захід: усе, що було до нього, вважаємо прочитаним — інакше стіна «непрочитаних».
  // Старий формат (об'єкт по розмовах) — беремо мітку головної стрічки
  if (S.read && typeof S.read === 'object') S.read = S.read.main || null;
  if (!S.read) { S.read = lastAt(); lsSet(LS_READ, S.read); }
  S.online.set(S.me.id, S.name);
  if (window.__pmgPresence) readPresence(window.__pmgPresence);

  // «Сцена» показу екрана — над стрічкою повідомлень (той самий компонент, що в «Справах»)
  const stageHost = document.createElement('section');
  $('zvLog').before(stageHost);
  S.stage = createStage(stageHost, { onStop: () => S.voice.toggleShare() });
  S.voice = createVoice({ sb: S.sb, me: S.me, name: S.name, toast, onChange: (vs) => { onVoice(vs); S.stage.update(vs); } });
  S.meet = createMeeting({ sb: S.sb, me: S.me, name: S.name, eng: S.voice, toast });
  subscribe();
  // Канал голосу — одразу «лише дивлюся»: видно, хто в ефірі, ще до натискання «Голос»
  S.voice.join(TOPIC, TITLE, { listen: true });
  renderAll(true);
  if (nearBottom()) markRead();
  if (wide()) $('zvInput').focus({ preventScroll: true });
}

/* ───────────────────────── демо (?demo=1) ───────────────────────── */

function bootDemo() {
  document.body.classList.add('zv-demo', 'zv-ready');
  S.me = { id: 'me' };
  S.name = 'Демо-користувач';
  S.role = 'expert';
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
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
  msgs.forEach(([id, min, uid, name, text, reply]) => addMsg({ id, created_at: ago(min), user_id: uid, user_name: name, message_text: text, reply_to: reply || null, room_id: null, recipient_id: null }));
  S.byId.get('m1').is_top = true;
  S.byId.get('m4').edited_at = ago(50);
  [['x1', 'm2', 'u1', 'Олена Приклад', '👍'], ['x2', 'm2', 'u3', 'Ірина Вигадана', '👍'], ['x3', 'm4', 'me', 'Демо-користувач', '✅'], ['x4', 'm7', 'u2', 'Петро Зразок', '❤️']]
    .forEach(([id, mid, uid, name, emoji]) => addRx({ id, message_id: mid, user_id: uid, user_name: name, emoji }));
  S.read = ago(2.5);
  S.online = new Map([['me', S.name], ['u1', 'Олена Приклад'], ['u2', 'Петро Зразок'], ['u3', 'Ірина Вигадана'], ['u4', 'Андрій Тестовий']]);
  S.dbStatus = 'live';

  // Дані — у пам'яті: ті самі обробники, що й для бази
  let n = 100;
  const now = () => new Date().toISOString();
  Object.assign(api, {
    insert: async (row) => ({ ...row, id: 'n' + n++, created_at: now(), room_id: null, recipient_id: null }),
    update: async (id, text) => ({ id, message_text: text, edited_at: now() }),
    remove: async () => {},
    react: async (mid, emoji) => ({ id: 'r' + n++, message_id: mid, user_id: 'me', user_name: S.name, emoji }),
    unreact: async () => {},
    pin: async () => {},
    upload: async () => '#demo',
    signed: async (u) => u
  });

  // Голос у демо: двоє колег уже в ефірі, звуку немає
  const others = [
    { key: 'u2', uid: 'u2', name: 'Петро Зразок', muted: false, deaf: false, state: 'ok' },
    { key: 'u3', uid: 'u3', name: 'Ірина Вигадана', muted: true, deaf: false, state: 'ok' }
  ];
  const dv = { topic: TOPIC, label: TITLE, status: 'live', error: '', key: 'me', muted: true, deaf: false, needGesture: false, inRoom: false };
  const emitV = () => onVoice({ ...dv, members: [...(dv.inRoom ? [{ key: 'me', uid: 'me', name: S.name, muted: dv.muted, deaf: dv.deaf, me: true, state: 'ok' }] : []), ...others.map((m) => ({ ...m }))] });
  S.voice = {
    get topic() { return dv.topic; },
    get state() { return { ...dv }; },
    async join() { dv.inRoom = true; emitV(); },
    async enter() { dv.inRoom = true; emitV(); },
    async exit() { Object.assign(dv, { inRoom: false, muted: true, deaf: false }); emitV(); },
    async leave() { Object.assign(dv, { inRoom: false, muted: true }); emitV(); },
    async toggleMic() { dv.muted = !dv.muted; if (!dv.muted) dv.deaf = false; emitV(); },
    async toggleDeaf() { dv.deaf = !dv.deaf; if (dv.deaf) dv.muted = true; emitV(); },
    unlock() {}
  };
  setInterval(() => {
    document.querySelectorAll('[data-vk="u2"]').forEach((el) => el.classList.toggle('is-speaking', Math.random() > 0.5));
  }, 700);

  emitV();
  renderAll(true);
}

boot();
