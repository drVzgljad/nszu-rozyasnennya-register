/**
 * «Двері відділів» на головній (17.11.2026, задум користувача): невеликий ряд дверей із назвами
 * відділів департаменту. Двері ведуть у ВЖЕ наявні кімнати відділів — голос і чат у «Справах»
 * (spravy/voice.js, spravy/room-chat.js). Нових кімнат і web-push тут немає: стук — це рядок
 * voice_knocks (migration_2026-11-10b_voice_knock.sql), який кімната відділу бачить через Realtime.
 *
 * - Свої двері — одразу: spravy/?door=home (панель голосу заходить у кімнату свого відділу).
 * - Чужі двері — стук: анімація й «тук-тук», рядок voice_knocks (status 'wait'). Хтось із того
 *   відділу натискає «Впустити» (у «Справах», кабінеті чи тут, на своїх дверях) — двері відчиняються
 *   й ведуть у spravy/?door=<id стуку>; «Не зараз» — двері лишаються зачиненими.
 * - Керівництво (admin / director / deputy_director) заходить у будь-які двері без стуку, як і в
 *   панелі «🚪 В гості»: spravy/?door_dept=<відділ>. Привітання директорки й заступниці грає кімната
 *   (spravy/voice.js, assets/greet-*.mp3), а не головна.
 * - На своїх дверях видно, хто стукає, з кнопками «Впустити» / «Не зараз».
 * - Без таблиці voice_knocks двері видно, свої відчиняються, а чужі пишуть, що стук ще не ввімкнено.
 * - Демо без логіна: index.html?demo=1 (стук «впускає» вигаданий колега).
 * - «Конференц-хол» (24.11.2026, на прохання користувача): подвійні двері під рядом відділів — спільна
 *   кімната всього департаменту. Це ТА САМА кімната 'voice:all' (голос «Чату департаменту», RLS
 *   migration_2026-11-03b_voice_room_all.sql): нових таблиць і каналів немає. Стуку немає — заходять усі.
 *   Клік відкриває голосове вікно з наміром { room: 'all' }; браузер не дав вікна — «Чат департаменту».
 *   Хто зараз у залі — з присутності каналу, яку вже дивиться auth-v2.js (подія 'pmg:dept-voice'):
 *   другий канал 'voice:all' з того самого клієнта закрив би перший. Чи ви в залі — каже голосове вікно.
 * Стилі — home-doors.css (власний шар змінних --hd-*, темна тема під :root.dark-theme).
 */

// Ті самі відділи, що в spravy/spravy.js (DEPARTMENTS): кімната = хеш назви відділу
const DEPTS = [
  ['стратегічного розвитку програми медичних гарантій', 'Стратегічний розвиток ПМГ'],
  ['наукова та клінічна експертиза', 'Клінічна експертиза'],
  ['розвиток програми реімбурсації', 'Реімбурсація'],
  ['взаємодія з надавачами медичних послуг', 'Взаємодія з надавачами'],
  ['розрахунок вартості медичних послуг', 'Розрахунок вартості'],
  ['робота з електронними медичними даними', 'Електронні медичні дані']
];
import { openVoiceWindow, voiceWin, onVoiceWin } from './voice/link.js?v=20261125c';

const LEAD = ['admin', 'director', 'deputy_director'];
const ROOM_URL = 'spravy/index.html';
const HALL_URL = 'zviazok/index.html';  // запасний шлях у кімнату департаменту, якщо браузер не дав вікна
const HALL_TOPIC = 'voice:all';
const HALL_SHOW = 6;                     // стільки облич у залі показуємо, решта — «+N»
const WAIT_MAX = 30 * 60e3;          // стук старший за 30 хв кімната вже не показує
const MISSING = /relation .* does not exist|could not find the table|PGRST205|42P01/i;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const d = {
  el: null,
  sb: null,
  demo: false,
  me: null,           // { id, name, role, dept }
  noKnock: false,     // таблиці voice_knocks ще немає
  door: {},           // dept → { state: 'wait' | 'ok' | 'no' | 'info', id, text }
  knocks: [],         // хто стукає в мої двері
  chMine: null,       // Realtime: стуки в мої двері
  chOut: {},          // Realtime: відповідь на мій стук (dept → channel)
  timers: {},
  knocking: new Set(), // двері, у які саме зараз стукаємо (анімація)
  hall: [],           // хто в конференц-холі: [{ uid, name, muted }]
  hallMine: false,    // я в залі (голосове вікно в кімнаті департаменту)
  offWin: null,       // відписка від стану голосового вікна
  mounted: false
};

/* ───────────────────────── публічне ───────────────────────── */

/** Показати двері. opts: { sb, userId } або { demo: true }. */
export async function showHomeDoors(opts) {
  d.el = document.getElementById('home-doors');
  if (!d.el) return;
  hideHomeDoors();
  d.el.addEventListener('click', onClick);
  d.mounted = true;
  d.demo = !!opts.demo;
  preloadKnock();
  if (d.demo) {
    d.me = { id: 'demo', name: 'Демо-користувач', role: 'expert', dept: DEPTS[1][0] };
    d.knocks = [{ id: 'dk1', name: 'Олена Приклад', from_dept: DEPTS[4][0] }];
    d.hall = [{ uid: 'h1', name: 'Петро Зразок', muted: false }, { uid: 'h2', name: 'Ірина Вигадана', muted: true },
      { uid: 'h3', name: 'Марта Довгопрізвищенко-Приклад', muted: true }];
    return render();
  }
  d.sb = opts.sb;
  const { data: p } = await d.sb.from('profiles').select('role, full_name, "Section"').eq('id', opts.userId).maybeSingle();
  if (!d.mounted || !p || p.role === 'guest') return;
  const dept = DEPTS.some(([n]) => n === p.Section) ? p.Section : '';
  d.me = { id: opts.userId, name: p.full_name || 'Колега', role: p.role || '', dept };
  d.hall = window.__pmgDeptVoice?.people || [];
  window.addEventListener('pmg:dept-voice', onHall);
  d.offWin = onVoiceWin(onWin);
  render();
  watchMyDoor();
  window.addEventListener('pagehide', onLeave);
}

export function hideHomeDoors() {
  if (!d.el) d.el = document.getElementById('home-doors');
  if (d.el) { d.el.hidden = true; d.el.innerHTML = ''; d.el.removeEventListener('click', onClick); }
  if (d.sb) {
    if (d.chMine) d.sb.removeChannel(d.chMine);
    Object.values(d.chOut).forEach((ch) => d.sb.removeChannel(ch));
  }
  Object.values(d.timers).forEach(clearTimeout);
  window.removeEventListener('pagehide', onLeave);
  window.removeEventListener('pmg:dept-voice', onHall);
  d.offWin?.();
  Object.assign(d, { chMine: null, chOut: {}, timers: {}, door: {}, knocks: [], mounted: false, noKnock: false,
    hall: [], hallMine: false, offWin: null });
}

/* ───────────────────────── кімнати ───────────────────────── */

async function topicFor(dept) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dept));
  return 'voice:dept:' + [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const shortName = (dept) => (DEPTS.find(([n]) => n === dept) || [dept, dept])[1];
const isLead = () => LEAD.includes(d.me?.role);

/**
 * Зайти в кімнату (19.11.2026): голос відкривається в голосовому вікні (voice/link.js), щоб розмова не рвалась,
 * поки людина ходить порталом. Вікно відкривається лише на клік; браузер не дав — як раніше, у «Справи».
 */
function go(params) {
  if (openVoiceWindow(params)) return;
  const u = new URL(ROOM_URL, location.href);
  Object.entries(params).forEach(([k, val]) => u.searchParams.set(k, val));
  location.href = u.href;
}

/* ───────────────────────── мої двері: хто стукає ───────────────────────── */

async function watchMyDoor() {
  if (!d.me.dept) return;
  const topic = await topicFor(d.me.dept);
  const since = new Date(Date.now() - WAIT_MAX).toISOString();
  const { data, error } = await d.sb.from('voice_knocks').select('id, user_id, name, from_dept, status, created_at')
    .eq('topic', topic).eq('status', 'wait').gte('created_at', since).order('created_at');
  if (!d.mounted) return;
  if (error) { d.noKnock = MISSING.test(error.message || error.code || ''); return render(); }
  d.knocks = (data || []).filter((k) => k.user_id !== d.me.id);
  render();
  d.chMine = d.sb.channel('home-knocks:' + topic)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_knocks', filter: `topic=eq.${topic}` }, (p) => {
      const k = p.new;
      if (!k?.id) return;
      const was = d.knocks.some((x) => x.id === k.id);
      d.knocks = d.knocks.filter((x) => x.id !== k.id);
      if (k.status === 'wait' && k.user_id !== d.me.id) {
        d.knocks.push(k);
      }
      render();
      if (k.status === 'wait' && k.user_id !== d.me.id && !was) { knockSound(0.5); flash(d.me.dept); }
    })
    .subscribe();
}

/** Впустити / не зараз — будь-хто з відділу (RLS: voice_room_member). */
async function decide(id, ok) {
  if (d.demo) {
    d.knocks = d.knocks.filter((k) => k.id !== id);
    return render(ok ? 'Олена Приклад отримала б «Впустили» і зайшла в кімнату' : 'Олені Приклад відповіли б «Не зараз»');
  }
  const { error } = await d.sb.from('voice_knocks')
    .update({ status: ok ? 'ok' : 'no', decided_by_name: d.me.name, decided_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'wait');
  d.knocks = d.knocks.filter((k) => k.id !== id);
  render(error ? 'Не вдалося: ' + error.message : ok ? 'Впустили — колега заходить у кімнату відділу' : '');
}

/* ───────────────────────── чужі двері: стук ───────────────────────── */

async function knock(dept) {
  const st = d.door[dept];
  if (st?.state === 'wait' || st?.state === 'ok' || d.knocking.has(dept)) return;
  // Спершу стук (анімація + звук), потім уже «чекаємо»: render() перемалював би двері посеред анімації
  d.knocking.add(dept);
  animate(dept, 'is-knocking', 1000);
  knockSound(1);
  await new Promise((r) => setTimeout(r, 950));
  d.knocking.delete(dept);
  if (!d.mounted) return;
  if (d.demo) {
    setDoor(dept, { state: 'wait' });
    d.timers[dept] = setTimeout(() => {
      setDoor(dept, { state: 'ok', text: 'Впустив(-ла) Петро Зразок' });
      d.timers[dept] = setTimeout(() => setDoor(dept, { state: 'info', text: 'У демо далі не ведемо: тут відкрилася б кімната відділу' }), 1600);
    }, 2600);
    return;
  }
  if (d.noKnock) return setDoor(dept, { state: 'info', text: 'Стук ще не ввімкнено — кімнату відділу чекає міграція' });
  const topic = await topicFor(dept);
  const { data, error } = await d.sb.from('voice_knocks')
    .insert({ topic, room_label: dept, name: d.me.name, from_dept: d.me.dept || null }).select('id').single();
  if (error) {
    if (MISSING.test(error.message || '')) { d.noKnock = true; return setDoor(dept, { state: 'info', text: 'Стук ще не ввімкнено — кімнату відділу чекає міграція' }); }
    const rls = /row-level security|42501/i.test(error.message || error.code || '');
    return setDoor(dept, { state: 'no', text: rls ? 'Вас нещодавно вивели — постукайте за кілька хвилин' : 'Не вдалося постукати' });
  }
  setDoor(dept, { state: 'wait', id: data.id });
  d.chOut[dept] = d.sb.channel('home-myknock:' + data.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'voice_knocks', filter: `id=eq.${data.id}` }, (p) => answer(dept, p.new))
    .subscribe();
  // Запасний шлях, якщо Realtime мовчить: раз на 8 с перепитуємо
  const poll = async () => {
    if (d.door[dept]?.state !== 'wait' || d.door[dept]?.id !== data.id) return;
    const { data: k } = await d.sb.from('voice_knocks').select('status, decided_by_name').eq('id', data.id).maybeSingle();
    if (k && k.status !== 'wait') return answer(dept, { id: data.id, ...k });
    d.timers[dept] = setTimeout(poll, 8000);
  };
  d.timers[dept] = setTimeout(poll, 8000);
  d.timers[dept + ':max'] = setTimeout(() => cancel(dept, 'Ніхто не відчинив — спробуйте пізніше'), WAIT_MAX);
}

function answer(dept, k) {
  const st = d.door[dept];
  if (!st || st.state !== 'wait' || st.id !== k.id) return;
  if (k.status === 'ok') {
    // Голосове вікно вже відкрите — заходимо самі; ні — вікно відкриється кліком на двері (браузер вимагає дії людини)
    const auto = !!voiceWin();
    setDoor(dept, { state: 'ok', id: k.id, text: `Впустив(-ла) ${k.decided_by_name || 'колега'}${auto ? '' : ' — натисніть двері, щоб зайти'}` });
    if (auto) setTimeout(() => go({ door: k.id }), 1100);
  } else if (k.status === 'no') {
    setDoor(dept, { state: 'no', text: 'Не зараз' });
    d.timers[dept] = setTimeout(() => setDoor(dept, null), 6000);
  }
}

async function cancel(dept, text = '') {
  const st = d.door[dept];
  if (d.chOut[dept]) { d.sb?.removeChannel(d.chOut[dept]); delete d.chOut[dept]; }
  clearTimeout(d.timers[dept]); clearTimeout(d.timers[dept + ':max']);
  setDoor(dept, text ? { state: 'info', text } : null);
  if (!d.demo && st?.id && st.state === 'wait') await d.sb.from('voice_knocks').update({ status: 'gone' }).eq('id', st.id).eq('status', 'wait');
}

/** Пішли з головної, поки стукали, — стук знімаємо (у кімнаті не висітиме «просить зайти»). */
function onLeave() {
  Object.entries(d.door).forEach(([dept, st]) => { if (st?.state === 'wait') cancel(dept); });
}

/* ───────────────────────── відкрити двері ───────────────────────── */

function enter(dept) {
  const own = dept === d.me.dept;
  animate(dept, 'is-open', 2000);
  if (d.demo) return setTimeout(() => setDoor(dept, { state: 'info', text: own ? 'Тут відкрилася б кімната вашого відділу' : 'Керівництво заходить без стуку' }), 700);
  // Вікно — одразу, ще в кліку (інакше браузер його заблокує); анімація дверей грає поруч
  const p = own ? { door: 'home' } : { door_dept: dept };
  if (openVoiceWindow(p)) return;
  setTimeout(() => go(p), 650);
}

/* ───────────────────────── конференц-хол ───────────────────────── */

function onHall(e) {
  d.hall = e.detail?.people || [];
  renderHall();
}

function onWin(st) {
  const mine = !!(st?.inRoom && st.topic === HALL_TOPIC);
  if (mine === d.hallMine) return;
  d.hallMine = mine;
  renderHall();
}

/** Зайти в зал: вікно — одразу, ще в кліку (інакше браузер його заблокує). */
function enterHall() {
  const el = d.el?.querySelector('.hd-hall-door');
  if (el) { el.classList.remove('is-open'); void el.offsetWidth; el.classList.add('is-open'); setTimeout(() => el.classList.remove('is-open'), 2000); }
  if (d.demo) return setTimeout(() => render('Конференц-хол: тут відкрилася б кімната департаменту'), 700);
  if (openVoiceWindow({ room: 'all' })) return;
  setTimeout(() => { location.href = new URL(HALL_URL, location.href).href; }, 650);
}

const initials = (name) => (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function hallWho() {
  const n = d.hall.length;
  if (!n) return `<span class="hd-hall-empty">${d.hallMine ? 'Ви в залі' : 'Порожньо — зайдіть першим, колеги побачать'}</span>`;
  const faces = d.hall.slice(0, HALL_SHOW).map((p) => `<li class="hd-face${p.muted ? ' is-muted' : ''}" title="${esc(p.name)}${p.muted ? ' · мікрофон вимкнено' : ''}">
      <span class="hd-ava" aria-hidden="true">${esc(initials(p.name))}</span><span class="hd-face-name">${esc(p.name)}</span></li>`).join('');
  const more = n > HALL_SHOW ? `<li class="hd-face is-more">+${n - HALL_SHOW}</li>` : '';
  return `<ul class="hd-faces" aria-label="Зараз у конференц-холі: ${n}">${faces}${more}</ul>`;
}

function hallCount() {
  const n = d.hall.length;
  return n ? `У залі: ${n}${d.hallMine ? ' · ви тут' : ''}` : (d.hallMine ? 'Ви тут' : 'Порожньо');
}

const hallBubble = () => (d.hallMine ? 'Ви тут' : d.hall.length ? 'Заходьте' : 'Відкрито');

/** Оновити лише «хто в залі» — двері не перемальовуємо, щоб не обірвати анімацію. */
function renderHall() {
  const box = d.el?.querySelector('.hd-hall');
  if (!box) return;
  box.classList.toggle('is-live', d.hall.length > 0);
  box.classList.toggle('is-mine', d.hallMine);
  box.querySelector('.hd-hall-who').innerHTML = hallWho();
  box.querySelector('.hd-hall-count').textContent = hallCount();
  box.querySelector('.hd-bubble').textContent = hallBubble();
}

function hallHtml() {
  const tip = 'Конференц-хол — кімната всього департаменту: заходять усі, без стуку';
  return `<div class="hd-hall${d.hall.length ? ' is-live' : ''}${d.hallMine ? ' is-mine' : ''}">
      <button type="button" class="hd-door hd-hall-door" data-act="hall" title="${esc(tip)}" aria-label="${esc(tip)}">
        <span class="hd-scene" aria-hidden="true">
          <span class="hd-room"></span>
          <span class="hd-leaf is-l"><span class="hd-panel"></span><span class="hd-panel"></span><span class="hd-handle"></span></span>
          <span class="hd-leaf is-r"><span class="hd-panel"></span><span class="hd-panel"></span><span class="hd-handle"></span></span>
          <span class="hd-spill"></span>
        </span>
        <span class="hd-bubble" aria-hidden="true">${esc(hallBubble())}</span>
      </button>
      <div class="hd-hall-info">
        <div class="hd-hall-top"><b class="hd-hall-name">Конференц-хол</b><span class="hd-hall-count">${esc(hallCount())}</span></div>
        <div class="hd-hall-who">${hallWho()}</div>
      </div>
    </div>`;
}

/* ───────────────────────── розмітка ───────────────────────── */

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, dept, id } = b.dataset;
  if (act === 'hall') return enterHall();
  if (act === 'door') {
    // Впустили за стуком — двері відчинені: клік відкриває голосове вікно
    const st = d.door[dept];
    if (st?.state === 'ok' && st.id && !d.demo) { animate(dept, 'is-open', 2000); setDoor(dept, null); return go({ door: st.id }); }
    if (dept === d.me.dept || isLead()) return enter(dept);
    return knock(dept);
  }
  if (act === 'cancel') return cancel(dept);
  if (act === 'kok' || act === 'kno') return decide(id, act === 'kok');
}

function setDoor(dept, st) {
  if (st) d.door[dept] = st; else delete d.door[dept];
  render();
}

function animate(dept, cls, ms) {
  const el = d.el?.querySelector(`.hd-door[data-dept="${CSS.escape(dept)}"]`);
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;          // перезапуск анімації
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

function flash(dept) { animate(dept, 'is-flash', 1000); }

function render(note = '') {
  if (!d.el || !d.me) return;
  const lead = isLead();
  const doors = DEPTS.map(([full, short]) => {
    const own = full === d.me.dept;
    const st = d.door[full];
    const cls = ['hd-door', own && 'is-own', st && 'is-' + st.state].filter(Boolean).join(' ');
    const tip = own ? `Відділ ${full} — ваші двері: заходите одразу`
      : lead ? `Відділ ${full} — керівництво заходить без стуку`
        : `Відділ ${full} — постукати й зайти, коли впустять`;
    const bubble = st?.state === 'wait' ? 'Чекаємо…' : st?.state === 'ok' ? 'Заходьте!' : st?.state === 'no' ? 'Не зараз' : own ? 'Ваші' : 'Тук-тук';
    const mine = own && d.knocks.length ? `<span class="hd-badge" aria-label="Стукають: ${d.knocks.length}">${d.knocks.length}</span>` : '';
    return `<div class="hd-cell">
      <button type="button" class="${cls}" data-act="door" data-dept="${esc(full)}" title="${esc(tip)}" aria-label="${esc(tip)}">
        <span class="hd-scene" aria-hidden="true">
          <span class="hd-room"></span>
          <span class="hd-leaf"><span class="hd-panel"></span><span class="hd-panel"></span><span class="hd-panel"></span><span class="hd-panel"></span><span class="hd-handle"></span></span>
          <span class="hd-rings"><i></i><i></i><i></i></span>
          <span class="hd-crack"></span>
          <span class="hd-spill"></span>
        </span>
        <span class="hd-bubble" aria-hidden="true">${esc(bubble)}</span>
        ${mine}
        <span class="hd-plate">${esc(short)}</span>
      </button>
      ${st?.state === 'wait' ? `<button type="button" class="hd-cancel" data-act="cancel" data-dept="${esc(full)}" title="Скасувати стук">✕</button>` : ''}
    </div>`;
  }).join('');

  const stateNote = Object.entries(d.door).map(([dept, st]) => st?.text ? `<p class="hd-note is-${esc(st.state)}"><b>${esc(shortName(dept))}:</b> ${esc(st.text)}</p>` : '').join('');
  const knocks = d.knocks.length ? `<ul class="hd-knocks" aria-label="Стукають у ваші двері">${d.knocks.map((k) => `<li>
      <span>🚪 <b>${esc(k.name || 'Колега')}</b>${k.from_dept ? ` <i>(${esc(shortName(k.from_dept))})</i>` : ''} стукає</span>
      <button type="button" class="hd-btn is-ok" data-act="kok" data-id="${esc(k.id)}">Впустити</button>
      <button type="button" class="hd-btn" data-act="kno" data-id="${esc(k.id)}">Не зараз</button>
    </li>`).join('')}</ul>` : '';
  const hint = lead ? 'Керівництво заходить у будь-які двері без стуку'
    : d.me.dept ? 'Свої — одразу, до інших — постукайте' : 'Постукайте — зайдете, коли впустять';

  d.el.innerHTML = `<div class="hd-head">
      <h2 class="hd-title">🚪 Департамент в ГОЛОСІ</h2>
      <span class="hd-hint">${esc(hint)}${d.demo ? ' · демо' : ''}</span>
    </div>
    <div class="hd-row">${doors}</div>
    ${hallHtml()}
    ${knocks}${stateNote}${note ? `<p class="hd-note">${esc(note)}</p>` : ''}`;
  d.el.hidden = false;
}

/* ───────────────────────── звук стуку ───────────────────────── */

// Справжній стук у дерев'яні двері (ElevenLabs Sound Effects, обрізано й вирівняно гучність):
// три удари на 70 / 330 / 585 мс — під них розписано анімацію hd-knock у home-doors.css.
const KNOCK_URL = new URL('assets/door-knock.mp3?v=20261117a', import.meta.url).href;
let actx = null;
let knockBuf = null;   // Promise<AudioBuffer | null>

/** Розкодувати звук заздалегідь — без AudioContext (його браузер дає лише після жесту). */
function preloadKnock() {
  if (knockBuf || !window.OfflineAudioContext) return;
  knockBuf = fetch(KNOCK_URL).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
    .then((ab) => new OfflineAudioContext(1, 1, 44100).decodeAudioData(ab))
    .catch(() => null);
}

/** Стук: буфер через WebAudio (точно в такт анімації); не вийшло — HTMLAudio; і так ні — синтез. */
async function knockSound(vol = 1) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    preloadKnock();
    const buf = await knockBuf;
    if (buf) {
      const src = actx.createBufferSource();
      const g = actx.createGain();
      g.gain.value = vol;
      src.buffer = buf;
      src.connect(g).connect(actx.destination);
      src.start();
      return;
    }
  } catch (_) { /* далі — запасні шляхи */ }
  try {
    const a = new Audio(KNOCK_URL);
    a.volume = Math.min(1, vol);
    await a.play();
  } catch (_) { synthKnock(vol); }
}

/** Запасний стук — три глухі удари синтезом WebAudio. */
function synthKnock(vol = 1) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime + 0.02;
    [0.05, 0.31, 0.565].forEach((dt, i) => {
      const t = t0 + dt;
      const o = actx.createOscillator();
      const g = actx.createGain();
      const f = actx.createBiquadFilter();
      o.type = 'triangle';
      o.frequency.setValueAtTime(190 - i * 12, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
      f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55 * vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(f).connect(g).connect(actx.destination);
      o.start(t); o.stop(t + 0.14);
    });
  } catch (_) { /* без звуку — не біда */ }
}
