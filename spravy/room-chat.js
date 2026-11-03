/**
 * Текстовий канал кімнати відділу — повідомлення й файли під голосовою кімнатою «Справ».
 *
 * Окремої таблиці немає: це кімната ВІДДІЛУ з чату порталу (chat_rooms.dept = назва
 * відділу, категорія «📁 Відділи»). Ті самі повідомлення видно і тут, і в розділі
 * «Чат» — це одна розмова, а не копія. Тому й формат файлового повідомлення той
 * самий, що в chat/chat.js: `📎 [Файл: назва (розмір)](URL сховища)` у приватному
 * бакеті chat-attachments, до 10 МБ. Змінюєте формат там — змініть і тут.
 *
 * Права — RLS чату: читати й писати може будь-який співробітник (не гість), видаляти —
 * лише своє. Кімнати відділів у чаті публічні для всього департаменту — це рішення
 * чату, а не цього модуля.
 */

const FILE_LIMIT = 10 * 1024 * 1024;  // як у chat/chat.js
const BUCKET = 'chat-attachments';
const PAGE = 60;                      // скільки останніх повідомлень показуємо
const LS_OPEN = 'spravy-chat-open';
const ALL = '*';                      // «відділ» = увесь департамент (перемикач у spravy.js)
const FILE_RE = /^📎 \[Файл:\s*([^\]]+)\]\(([^)]+)\)/;
const STORAGE_RE = /\/storage\/v1\/object\/public\/([^/]+)\/([^?]+)/;
const IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, val) => { try { localStorage.setItem(k, val); } catch (_) { /* приватний режим */ } };

const c = {
  root: null,
  demo: false,
  sb: null,
  me: null,
  name: '',
  dept: '',
  toast: () => {},
  room: null,       // { id, name }
  msgs: [],
  ch: null,
  open: false,
  unread: 0,
  sending: false,
  signed: new Map() // шлях у сховищі → підписаний URL (живе годину)
};

/* ───────────────────────── публічне ───────────────────────── */

/** opts: { sb, me, name, dept, toast } або { demo: true, name }. */
export function initRoomChat(opts) {
  c.root = document.getElementById('spChat');
  if (!c.root) return;
  Object.assign(c, opts);
  c.open = lsGet(LS_OPEN) === '1';
  c.root.hidden = false;
  c.root.innerHTML = skeleton();
  wire();
  if (c.demo) return demo();
  loadRoom();
}

/** Керівництво перемкнуло відділ — показуємо чат того відділу. */
export function setRoomChatDept(dept) {
  if (c.demo || !c.root || dept === c.dept) return;
  c.dept = dept;
  loadRoom();
}

/* ───────────────────────── дані ───────────────────────── */

async function loadRoom() {
  if (c.ch) { try { await c.sb.removeChannel(c.ch); } catch (_) { /* уже закрито */ } c.ch = null; }
  c.msgs = [];
  c.unread = 0;
  c.room = null;
  renderHead();
  notice('Завантаження…');
  let q = c.sb.from('chat_messages').select('id, created_at, user_id, user_name, message_text');
  if (c.dept === ALL) {
    // Департамент — головна стрічка «Робочого чату Департаменту» (chat/chat.js, type 'group'):
    // без кімнати й без адресата
    c.room = { id: null, name: 'Робочий чат Департаменту' };
    q = q.is('room_id', null).is('recipient_id', null);
  } else {
    const { data: room, error } = await c.sb.from('chat_rooms').select('id, name').eq('dept', c.dept).limit(1).maybeSingle();
    if (error || !room) {
      notice('У чаті порталу ще немає кімнати цього відділу. Перемкніться на «Департамент».');
      return;
    }
    c.room = room;
    q = q.eq('room_id', room.id);
  }
  const { data, error: e2 } = await q.order('created_at', { ascending: false }).limit(PAGE);
  if (e2) { notice('Не вдалося завантажити повідомлення: ' + e2.message); return; }
  c.msgs = (data || []).reverse();
  renderHead();
  renderList(true);
  // Фільтр «room_id is null» Realtime не вміє — для стрічки департаменту перевіряємо в onChange
  const filter = c.room.id ? { filter: `room_id=eq.${c.room.id}` } : {};
  c.ch = c.sb.channel('spravy-chat-' + (c.room.id || 'all'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', ...filter }, onChange)
    .subscribe();
}

/** Повідомлення з цього каналу? (для стрічки департаменту Realtime шле всі зміни таблиці) */
const ours = (m) => (c.room?.id ? m.room_id === c.room.id : !m.room_id && !m.recipient_id);

function onChange({ eventType, new: n, old: o }) {
  if (eventType === 'INSERT') {
    if (!ours(n) || c.msgs.some((m) => m.id === n.id)) return;
    c.msgs.push(n);
    if (n.user_id !== c.me?.id && (!c.open || document.hidden)) c.unread++;
  } else if (eventType === 'UPDATE') {
    const m = c.msgs.find((x) => x.id === n.id);
    if (!m) return;
    Object.assign(m, n);
  } else if (eventType === 'DELETE') {
    if (!c.msgs.some((m) => m.id === o.id)) return;
    c.msgs = c.msgs.filter((m) => m.id !== o.id);
  }
  renderHead();
  renderList(eventType === 'INSERT');
}

async function sendText(text) {
  if (!text.trim() || !c.room || c.sending) return false;
  c.sending = true;
  const row = { user_id: c.me.id, user_name: c.name, message_text: text.trim(), room_id: c.room.id };
  let ok = true;
  if (c.demo) {
    onChange({ eventType: 'INSERT', new: { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() } });
  } else {
    const { data, error } = await c.sb.from('chat_messages').insert(row).select('id, created_at, user_id, user_name, message_text');
    if (error) { c.toast('Повідомлення не надіслано: ' + error.message, true); ok = false; }
    // Realtime може запізнитися — показуємо одразу
    else if (data?.[0]) onChange({ eventType: 'INSERT', new: data[0] });
  }
  c.sending = false;
  return ok;
}

async function sendFiles(files) {
  if (!c.room) return;
  for (const f of files) {
    if (f.size > FILE_LIMIT) { c.toast(`«${f.name}» більший за 10 МБ — не надіслано.`, true); continue; }
    const name = f.name || `зображення-${Date.now()}.png`;
    if (c.demo) { await sendText(`📎 [Файл: ${name} (${bytes(f.size)})](#demo)`); continue; }
    setBusy(`Завантаження «${name}»…`);
    const ext = (name.split('.').pop() || 'bin').toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await c.sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
    if (error) { setBusy(''); c.toast(`«${name}» не завантажено: ${error.message}`, true); continue; }
    const { data: { publicUrl } } = c.sb.storage.from(BUCKET).getPublicUrl(path);
    await sendText(`📎 [Файл: ${name} (${bytes(f.size)})](${publicUrl})`);
    setBusy('');
  }
}

async function removeMsg(id) {
  if (!confirm('Видалити повідомлення?')) return;
  if (c.demo) return onChange({ eventType: 'DELETE', old: { id } });
  const { error } = await c.sb.from('chat_messages').delete().eq('id', id);
  if (error) c.toast('Не видалено: ' + error.message, true);
  else onChange({ eventType: 'DELETE', old: { id } });
}

/** Бакет приватний: відкриваємо через підписане посилання на годину (як chat.js). */
async function signed(url) {
  const m = (url || '').match(STORAGE_RE);
  if (!m) return url;
  const key = m[1] + '/' + m[2];
  const hit = c.signed.get(key);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data } = await c.sb.storage.from(m[1]).createSignedUrl(decodeURIComponent(m[2]), 3600);
  if (!data?.signedUrl) return url;
  c.signed.set(key, { url: data.signedUrl, until: Date.now() + 55 * 60000 });
  return data.signedUrl;
}

/* ───────────────────────── вигляд ───────────────────────── */

function skeleton() {
  return `
    <button type="button" class="spc-head" aria-expanded="false">
      <span class="spc-title">💬 Чат відділу</span>
      <span class="spc-badge" hidden></span>
      <span class="spc-last"></span>
      <span class="spc-caret" aria-hidden="true">▾</span>
    </button>
    <div class="spc-body" hidden>
      <div class="spc-list" role="log" aria-live="polite" aria-label="Повідомлення відділу"></div>
      <p class="spc-busy" hidden></p>
      <form class="spc-form">
        <label class="spc-attach" title="Надіслати файл (до 10 МБ). Можна й перетягнути у чат або вставити Ctrl+V">
          📎<input type="file" multiple hidden>
        </label>
        <textarea rows="1" placeholder="Повідомлення відділу… Enter — надіслати, Shift+Enter — новий рядок" aria-label="Повідомлення"></textarea>
        <button type="submit" class="spv-btn spv-join">Надіслати</button>
      </form>
      <div class="spc-foot">Ті самі повідомлення — у розділі <a href="../chat/">Чат</a>, кімната відділу.</div>
      <div class="spc-drop" hidden>Відпустіть, щоб надіслати файл</div>
    </div>`;
}

const q = (sel) => c.root.querySelector(sel);

function wire() {
  q('.spc-head').addEventListener('click', () => setOpen(!c.open));
  const ta = q('textarea');
  const form = q('.spc-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value;
    if (await sendText(text)) { ta.value = ''; autosize(ta); }
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  ta.addEventListener('input', () => autosize(ta));
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); sendFiles(files); }
  });
  q('input[type=file]').addEventListener('change', (e) => { sendFiles([...e.target.files]); e.target.value = ''; });

  const body = q('.spc-body');
  const drop = q('.spc-drop');
  let depth = 0;
  body.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; drop.hidden = false; } });
  body.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
  body.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  body.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    sendFiles([...e.dataTransfer.files]);
  });

  q('.spc-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) return removeMsg(del.dataset.del);
    const a = e.target.closest('a[data-file]');
    if (!a) return;
    e.preventDefault();
    if (c.demo) return c.toast('Демо: файл не завантажувався');
    const w = window.open('', '_blank');
    const url = await signed(a.dataset.file);
    if (w) w.location = url; else window.open(url, '_blank');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && c.open) { c.unread = 0; renderHead(); } });
}

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
}

function setOpen(open) {
  c.open = open;
  lsSet(LS_OPEN, open ? '1' : '0');
  if (open) c.unread = 0;
  q('.spc-body').hidden = !open;
  renderHead();
  if (open) { renderList(true); q('textarea').focus({ preventScroll: true }); }
}

function setBusy(text) {
  const b = q('.spc-busy');
  b.textContent = text;
  b.hidden = !text;
}

function notice(text) {
  q('.spc-list').innerHTML = `<p class="spc-empty">${esc(text)}</p>`;
}

function renderHead() {
  const head = q('.spc-head');
  head.setAttribute('aria-expanded', String(c.open));
  q('.spc-body').hidden = !c.open;
  const badge = q('.spc-badge');
  badge.hidden = !c.unread;
  badge.textContent = c.unread > 99 ? '99+' : String(c.unread);
  const last = c.msgs[c.msgs.length - 1];
  q('.spc-last').textContent = !c.open && last ? `${shortName(last.user_name)}: ${preview(last.message_text)}` : '';
  const all = c.dept === ALL;
  q('.spc-title').textContent = all ? '💬 Чат департаменту' : '💬 Чат відділу';
  q('.spc-foot').innerHTML = `Ті самі повідомлення — у розділі <a href="../chat/">Чат</a>, ${all ? 'головна стрічка «Робочий чат Департаменту»' : 'кімната відділу'}.`;
  c.root.setAttribute('aria-label', all ? 'Чат департаменту' : 'Чат відділу');
}

function renderList(stick) {
  const list = q('.spc-list');
  if (!c.room) return;
  if (!c.msgs.length) return notice('Повідомлень ще немає. Напишіть першим — побачить увесь відділ.');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  let day = '';
  let prev = null;
  const html = c.msgs.map((m) => {
    const d = new Date(m.created_at);
    const dkey = d.toDateString();
    let sep = '';
    if (dkey !== day) { day = dkey; sep = `<div class="spc-day"><span>${esc(dayLabel(d))}</span></div>`; prev = null; }
    // Кілька повідомлень поспіль від однієї людини за 5 хв — без повтору імені
    const cont = prev && prev.user_id === m.user_id && d - new Date(prev.created_at) < 5 * 60000;
    prev = m;
    const mine = m.user_id === c.me?.id;
    return `${sep}<div class="spc-msg${mine ? ' is-mine' : ''}${cont ? ' is-cont' : ''}">
      ${cont ? '' : `<div class="spc-meta"><b>${esc(m.user_name || 'Без імені')}</b><time>${hhmm(d)}</time></div>`}
      <div class="spc-text">${body(m.message_text)}</div>
      ${mine ? `<button type="button" class="spc-del" data-del="${esc(m.id)}" title="Видалити" aria-label="Видалити повідомлення">✕</button>` : ''}
    </div>`;
  }).join('');
  list.innerHTML = html;
  if (stick || nearBottom) list.scrollTop = list.scrollHeight;
  // Прев'ю зображень — через підписані посилання
  list.querySelectorAll('img[data-src]').forEach(async (img) => {
    img.src = c.demo ? '' : await signed(img.dataset.src);
    img.removeAttribute('data-src');
  });
}

function body(text) {
  const f = (text || '').match(FILE_RE);
  if (f) {
    const desc = f[1];
    const cut = desc.lastIndexOf('(');
    const name = cut > 0 ? desc.slice(0, cut).trim() : desc;
    const size = cut > 0 ? desc.slice(cut + 1, -1).trim() : '';
    const ext = name.split('.').pop().toLowerCase();
    const img = IMG_EXT.includes(ext) && !c.demo ? `<img data-src="${esc(f[2])}" alt="" loading="lazy">` : '';
    return `<a class="spc-file" href="#" data-file="${esc(f[2])}" title="Відкрити «${esc(name)}»">${img}<span>📎 ${esc(name)}</span><small>${esc(size)}</small></a>`;
  }
  return esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, '<br>');
}

const preview = (t) => {
  const f = (t || '').match(FILE_RE);
  const s = f ? '📎 ' + f[1].replace(/\s*\([^)]*\)\s*$/, '') : (t || '');
  return s.length > 70 ? s.slice(0, 70) + '…' : s;
};
const shortName = (n) => (n || '').split(/\s+/)[0] || 'Хтось';
const hhmm = (d) => d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
function dayLabel(d) {
  const t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Сьогодні';
  if (d.toDateString() === y.toDateString()) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}
function bytes(n) {
  if (!n) return '0 B';
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return parseFloat((n / 1024 ** i).toFixed(1)) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
}

/* ───────────────────────── демо (?demo=1) ───────────────────────── */

function demo() {
  c.me = { id: 'me' };
  c.room = { id: 'demo', name: 'Демо-відділ' };
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  c.msgs = [
    { id: 'm1', created_at: ago(60 * 26), user_id: 'd1', user_name: 'Олена Приклад', message_text: 'Колеги, чернетку відповіді виклала, гляньте до обіду.' },
    { id: 'm2', created_at: ago(62), user_id: 'd2', user_name: 'Петро Зразок', message_text: '📎 [Файл: lyst_demo_v2.docx (48.2 KB)](#demo)' },
    { id: 'm3', created_at: ago(61), user_id: 'd2', user_name: 'Петро Зразок', message_text: 'Друга версія — з правками керівника.' },
    { id: 'm4', created_at: ago(3), user_id: 'me', user_name: c.name || 'Демо-користувач', message_text: 'Дякую, подивлюсь і відпишу тут.' }
  ];
  c.unread = c.open ? 0 : 2;
  renderHead();
  renderList(true);
}
