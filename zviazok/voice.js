/**
 * Рушій голосових кімнат порталу — ОДИН на два розділи: «Чат департаменту»
 * (zviazok.js) і кімнату відділу в «Справах» (spravy/voice.js — там лише панель).
 * WebRTC кожен з кожним, рукостискання й присутність — через приватний канал
 * Supabase Realtime, запасний шлях — Cloudflare TURN (воркер tools/voice-turn).
 * Одночасно — лише в одній кімнаті.
 *
 * Два режими в каналі кімнати: «у кімнаті» (присутність + звук) і «лише дивлюся»
 * (бачиш, хто там, тебе не видно й не чути) — join(…, { listen: true }), а далі
 * enter() / exit(). «Справи» відкривають кімнату відділу так одразу при вході.
 *
 * Канали (RLS — migration_2026-11-03d_chat_voice_rooms.sql):
 *   'voice:all'               — кімната департаменту (лише «Чат департаменту», з 04.11.2026);
 *   'voice:room:<uuid>'       — кімната чату: хто бачить кімнату, той і заходить;
 *   'voice:dm:<uuid>:<uuid>'  — дзвінок 1:1.
 *
 * Звук входу (17.11.2026, ./greet.js): перший вхід людини за день — привітання на ім'я
 * («Вітаємо пані Олену!»), решта входів — мелодійний дзвінок. Чи вхід перший, вирішує вкладка того,
 * хто заходить, і передає в присутності (поле hi = дата); керівництву (поле lead) — привітання на кожен
 * вхід, не частіше ніж раз на 10 хв. Вихід — як і раніше, дві ноти вниз.
 *
 * Вирівнювання гучності (25.11.2026): голос кожного колеги йде через власний підсилювач (Web Audio):
 * рушій міряє, наскільки голосно людина говорить, і плавно підтягує тихих та притишує гучних до
 * одного рівня (×0,5…×4), а компресор зрізає раптові вигуки. Вмикається галочкою у вікні
 * «Мікрофон» (localStorage 'pmg-voice-level', за замовчуванням увімкнено). Поки AudioContext
 * «спить» (браузер ще не бачив кліку), звук іде звичайним шляхом — без вирівнювання, але не зникає.
 * Свій мікрофон браузер вирівнює сам (autoGainControl).
 *
 * Модуль нічого не малює сам: стан віддає в onChange, а «хто говорить»
 * підсвічує на будь-якому елементі з data-vk="<ключ учасника>".
 *
 * Мікрофон за замовчуванням вимкнений. Вимкнений мікрофон зупиняється зовсім —
 * індикатор запису в браузері гасне. Звук у базу не пишеться.
 *
 * Вибір мікрофона (06.11.2026): mics() / setMic(id), вибір пам'ятає браузер
 * (localStorage 'pmg-voice-mic'); вікно вибору з перевіркою рівня — mic-picker.js.
 * Мікрофон, що з увімкнення 8 с не дав жодного звуку, — micSilent у стані
 * й запис 'mic_silent' у журнал проблем.
 *
 * Показ екрана (03.11.2026): у кожному з'єднанні — другий, відеоканал; показ вмикається
 * заміною доріжки (як мікрофон), без нового рукостискання. Відеоканал додаємо лише тим,
 * хто в присутності оголосив caps: ['screen'] — вкладка зі старою версією отримала б
 * зайвий трек і зламала б собі звук. Показує одна людина: хто почав пізніше (sharing —
 * час початку), той і показує, попередній показ зупиняється сам. Під документи:
 * contentHint 'detail', до 15 кадрів/с, до 1,5 Мбіт/с.
 * Почати показ браузер дозволяє лише в кліку в ЦЬОМУ вікні: команда з іншої вкладки (BroadcastChannel)
 * дає відповідь 'gesture' — панель тоді просить натиснути кнопку тут (25.11.2026).
 *
 * Повідомлення кімнати (25.11.2026): say(payload) — broadcast 'room' усім у каналі (і тим, хто «лише
 * дивиться»), приходить в onMsg(payload). Ним «Справи» кличуть колегу в дорадчу кімнату (тет-а-тет).
 */

import { greetFor, firstEntryToday, today, playClip, preloadChime, CHIME, ALWAYS } from './greet.js?v=20261117a';

// Адреса воркера tools/voice-turn (та сама, що в spravy/voice.js). Порожньо — лише STUN.
const VOICE_TURN_URL = 'https://pmg-voice-turn.doktorvzgljad.workers.dev';
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const RETRIES = 3;
const SPEAK_LEVEL = 0.035;
const SCREEN_BITRATE = 1500000;   // показ екрана: текст документів читається, канал не забиваємо
const SCREEN_FPS = 15;
const canShare = () => !!navigator.mediaDevices?.getDisplayMedia;

export const MANY = 10; // з такої кількості пряма схема кожен-з-кожним важчає

/* Пристрій і браузер (04.11.2026): видно в кімнаті й пишеться в журнал проблем.
   iPad у Safari називає себе «Macintosh» — його видає сенсорний екран */
const UA = navigator.userAgent || '';
const DEVICE = (navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobi/i.test(UA))
  || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1) ? 'mob' : 'pc';
const BROWSER = [
  [['Edge', /Edg\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Firefox', /Firefox\/(\d+)/], ['Chrome', /Chrome\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]]
    .map(([n, re]) => { const x = UA.match(re); return x ? `${n} ${x[1]}` : ''; }).find(Boolean) || 'інший',
  /Windows/.test(UA) ? 'Windows' : /Android/.test(UA) ? 'Android' : /iPhone|iPad|iPod/.test(UA) ? 'iOS' : /Mac/.test(UA) ? 'macOS' : /Linux/.test(UA) ? 'Linux' : ''
].filter(Boolean).join(' · ');

const STATS_MS = 3000;          // як часто міряємо пінг і втрати
const PING_BAD = 400;           // мс — уже заважає говорити
const LOSS_BAD = 0.08;          // 8 % втрачених пакетів — звук «булькає»
const SLOW_MS = 20000;          // за 20 с так і не з'єдналися — проблема
const ISSUE_LS = 'pmg-voice-issues';
const ISSUE_GAP = 5 * 60000;    // одна й та сама проблема з тим самим колегою — не частіше

/* Вибір мікрофона (06.11.2026). Браузер бере «пристрій за замовчуванням» Windows, а Teams і
   месенджери — свій вибір або «пристрій зв'язку»: мікрофон «працює всюди, крім порталу».
   Вибір живе в цьому браузері. «Тихий» мікрофон — той, що з увімкнення не дав жодного звуку
   (рівень ≈ 0, як у вимкненого чи не того пристрою); у тихій кімнаті живий мікрофон
   однаково шумить, тож хибних тривог не дає. Раз почули звук — для цієї доріжки більше не перевіряємо. */
const MIC_LS = 'pmg-voice-mic';
const SILENT_MS = 8000;
const SILENT_LEVEL = 0.0008;

/* Довга тиша з увімкненим мікрофоном (25.11.2026): «якщо довго тиша — попередження про включений мікрофон,
   а потім через 3 хвилини відключай; і відразу галочку "не відключати"». Мовчите IDLE_WARN — попередження
   з відліком (панель і значок «В ефірі»), ще 3 хвилини — мікрофон вимикається сам. Будь-яке слово, «Я тут»
   (stillHere) чи галочка (setKeepMic, пам'ятає браузер) це скасовують. */
const IDLE_WARN = 2 * 60e3;
const IDLE_OFF = IDLE_WARN + 3 * 60e3;
const KEEP_LS = 'pmg-voice-keepmic';
const LEVEL_LS = 'pmg-voice-level';   // '0' — вирівнювання гучності колег вимкнено
const LEVEL_TARGET = 0.09;            // рівень мовлення (RMS), до якого підтягуємо кожного
const LEVEL_MIN = 0.5, LEVEL_MAX = 4;
const HERO_LS = 'pmg-voice-hero';   // герой (просунутий вигляд кімнати) — обирає кожен сам, іде в присутність
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } };
const lsSet = (k, val) => { try { val ? localStorage.setItem(k, val) : localStorage.removeItem(k); } catch (_) { /* приватне вікно */ } };

/**
 * Коротка інформація про учасника для панелей (чат і «Справи»): пристрій, пінг, маршрут.
 * ping — від мене до нього (у себе — середній до всіх). cls: good · mid · bad.
 */
export function netInfo(m) {
  const dev = m.dev === 'mob' ? '📱' : m.dev === 'pc' ? '💻' : '';
  const devTip = m.dev === 'mob' ? 'з телефона' : m.dev === 'pc' ? 'з комп\'ютера' : '';
  const n = m.net;
  if (!n || n.rtt == null) return { dev, devTip, ping: '', cls: '', tip: devTip };
  const cls = n.rtt < 150 ? 'good' : n.rtt < 300 ? 'mid' : 'bad';
  const parts = [devTip, `пінг ${n.rtt} мс${m.me ? ' (середній до колег)' : ''}`];
  if (n.loss) parts.push(`втрати звуку ${Math.round(n.loss * 100)} %`);
  if (n.relay) parts.push('через ретранслятор');
  return { dev, devTip, ping: `${n.rtt} мс`, cls, tip: parts.filter(Boolean).join(' · ') };
}

const GREET_AGAIN = 10 * 60e3;   // керівництво вітаємо на ім'я не частіше

export function createVoice({ sb, me, name, role = '', toast = () => {}, onChange = () => {}, onMsg = () => {} }) {
  const v = {
    hi: '',            // мій вхід сьогодні перший — дата (іде в присутність, кімната вітає на ім'я)
    greeted: new Map(), // кого вже вітали на ім'я: uid → час (керівництво — не частіше ніж раз на 10 хв)
    since: 0,          // коли канал став live — перші 3 с join-и = «хто вже був», без звуку
    topic: '',
    label: '',
    ch: null,
    key: '',
    status: 'idle',      // idle · joining · live · error
    error: '',
    members: new Map(),  // key → { uid, name, muted, deaf }
    peers: new Map(),    // key → { pc, sender, audio, tries, pendingIce, gaveUp }
    mic: null,
    micId: lsGet(MIC_LS),  // вибраний пристрій ('' — за замовчуванням)
    micSince: 0,           // скільки мікрофон уже слухаємо (лише поки AudioContext працює)
    micHeard: false,       // з увімкнення був хоч якийсь звук
    micSilent: false,      // увімкнений, але нічого не передає
    lastVoice: 0,          // коли востаннє чули наш голос (довга тиша — попередження й вимкнення)
    idleWarn: false,       // попереджаємо: мовчите з увімкненим мікрофоном
    idleLeft: 0,           // скільки секунд до автоматичного вимкнення
    keepMic: lsGet(KEEP_LS) === '1',   // «не вимикати мікрофон автоматично»
    leveling: lsGet(LEVEL_LS) !== '0', // вирівнювати гучність колег
    out: null,                         // спільний вихід підсилювачів (Web Audio)
    muted: true,
    deaf: false,
    micBeforeDeaf: false,
    screen: null,        // MediaStreamTrack показу екрана або null
    shareSince: 0,       // коли почали показ — пізніший показ перемагає
    presenter: '',       // ключ того, хто зараз показує (для тосту «показує екран»)
    ice: STUN,
    iceUntil: 0,
    ctx: null,
    meters: new Map(),
    needGesture: false,
    timer: null,
    sink: null,
    inRoom: true,         // false — «лише дивлюся»: підписані на канал, але без присутності й звуку
    rec: null,            // запис наради в ЦЬОМУ браузері: { since, sources: Map(key → запис), done: [] }
    recSeen: '',          // ключ того, чий запис ми вже оголосили (тост і сигнал — один раз)
    statTimer: null,      // раз на STATS_MS — пінг і втрати по кожному з'єднанню
    issued: new Map(),    // «вид|колега» → коли востаннє записали (не засмічуємо журнал)
    flushAt: 0            // коли можна знову пробувати досилати журнал
  };

  const emit = () => onChange(snapshot());

  function snapshot() {
    return {
      topic: v.topic,
      label: v.label,
      status: v.status,
      error: v.error,
      key: v.key,
      muted: v.muted,
      deaf: v.deaf,
      micSilent: v.micSilent,
      idleWarn: v.idleWarn,
      idleLeft: v.idleWarn ? v.idleLeft : 0,
      keepMic: v.keepMic,
      leveling: v.leveling,
      micLabel: v.mic?.label || '',
      needGesture: v.needGesture,
      inRoom: v.inRoom,
      sharing: !!v.screen,
      canShare: canShare(),
      presenter: presenter(),
      recording: recorder(),
      canRecord: typeof window.MediaRecorder !== 'undefined',
      members: [...v.members.entries()].map(([k, m]) => ({
        key: k, ...m, me: k === v.key, state: k === v.key ? 'ok' : peerState(k),
        net: k === v.key ? myNet() : v.peers.get(k)?.net || null
      }))
    };
  }

  /** У себе — середній пінг до всіх, з ким з'єднані (видно, чи погано саме в мене). */
  function myNet() {
    const nets = [...v.peers.values()].map((p) => p.net).filter((n) => n && n.rtt != null);
    if (!nets.length) return null;
    return {
      rtt: Math.round(nets.reduce((s, n) => s + n.rtt, 0) / nets.length),
      loss: Math.max(...nets.map((n) => n.loss || 0)),
      relay: nets.some((n) => n.relay)
    };
  }

  /* ───────── журнал проблем (migration_2026-11-04_voice_issues.sql) ───────── */

  /**
   * Записати проблему. Пишемо лише технічні ознаки — не звук і не вміст розмови.
   * Немає таблиці чи мережі — запис чекає в localStorage і досилається пізніше.
   */
  function issue(kind, { peer, ...detail } = {}) {
    const tag = kind + '|' + (peer || '');
    if (Date.now() - (v.issued.get(tag) || 0) < ISSUE_GAP) return;
    v.issued.set(tag, Date.now());
    const row = {
      happened_at: new Date().toISOString(),
      user_name: name || null,
      topic: v.topic || null,
      kind,
      peer_name: peer ? (v.members.get(peer)?.name || null) : null,
      device: DEVICE,
      detail: {
        ...detail,
        browser: BROWSER,
        turn: v.ice.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u))),
        in_room: v.members.size,
        online: navigator.onLine,
        net_type: navigator.connection?.effectiveType || undefined
      }
    };
    console.warn('[voice] проблема:', kind, row);
    const q = readQueue();
    q.push(row);
    saveQueue(q);
    flushIssues();
  }

  function readQueue() {
    try { return JSON.parse(localStorage.getItem(ISSUE_LS) || '[]'); } catch (_) { return []; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(ISSUE_LS, JSON.stringify(q.slice(-50))); } catch (_) { /* приватне вікно */ }
  }

  async function flushIssues() {
    if (Date.now() < v.flushAt || !me?.id) return;
    const q = readQueue();
    if (!q.length) return;
    v.flushAt = Date.now() + 30000;   // поки шлемо (і якщо не вийде) — не частіше
    try {
      const { error } = await sb.from('voice_issues').insert(q);
      if (error) throw error;
      // Поки слали, могли додатися нові — лишаємо лише їх
      saveQueue(readQueue().slice(q.length));
      v.flushAt = 0;
    } catch (e) {
      // Таблиці ще нема (міграцію не застосовано) — повторимо при наступному вході
      if (/voice_issues|42P01|PGRST20/.test(String(e?.message || e?.code || e))) v.flushAt = Date.now() + 10 * 60000;
    }
  }

  /* ───────── пінг і втрати ───────── */

  async function readStats(k, p) {
    if (p.pc.connectionState !== 'connected') {
      // Довго не з'єднуємось — записуємо один раз (повтори з'єднання робить retryPeer)
      if (!p.slowLogged && Date.now() - p.born > SLOW_MS && !p.gaveUp) {
        p.slowLogged = true;
        issue('slow_connect', { peer: k, ice: p.pc.iceConnectionState, conn: p.pc.connectionState, gathering: p.pc.iceGatheringState, tries: p.tries });
      }
      return;
    }
    let st;
    try { st = await p.pc.getStats(); } catch (_) { return; }
    let pair = null;
    st.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId) || pair; });
    if (!pair) st.forEach((r) => { if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded'))) pair = r; });
    let lost = 0, recv = 0;
    st.forEach((r) => { if (r.type === 'inbound-rtp' && (r.kind || r.mediaType) === 'audio') { lost += r.packetsLost || 0; recv += r.packetsReceived || 0; } });
    const lc = pair && st.get(pair.localCandidateId);
    const rc = pair && st.get(pair.remoteCandidateId);
    const rtt = pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
    // Втрати — за останній проміжок, а не за всю розмову (і лише коли звук справді йшов)
    const prev = p.cnt || { lost: 0, recv: 0 };
    const dl = Math.max(0, lost - prev.lost), dr = Math.max(0, recv - prev.recv);
    p.cnt = { lost, recv };
    const loss = dl + dr >= 50 ? dl / (dl + dr) : 0;
    const relay = lc?.candidateType === 'relay' || rc?.candidateType === 'relay';
    p.net = { rtt, loss, relay };
    // Стійкі проблеми — у журнал: три виміри поспіль із великим пінгом, два — з втратами
    p.badPing = rtt != null && rtt > PING_BAD ? (p.badPing || 0) + 1 : 0;
    p.badLoss = loss > LOSS_BAD ? (p.badLoss || 0) + 1 : 0;
    const info = { rtt, loss: Math.round(loss * 1000) / 10, relay, route: `${lc?.candidateType || '?'}→${rc?.candidateType || '?'}`, proto: lc?.protocol || lc?.relayProtocol };
    if (p.badPing === 3) issue('high_ping', { peer: k, ...info });
    if (p.badLoss === 2) issue('packet_loss', { peer: k, ...info });
  }

  async function statsTick() {
    if (!v.inRoom || !v.peers.size) return;
    await Promise.all([...v.peers.entries()].map(([k, p]) => readStats(k, p)));
    emit();
  }

  /** Хто показує екран: { key, name, me, stream } або null. stream — відео від нього (у себе — null). */
  function presenter() {
    let best = null;
    v.members.forEach((m, k) => { if (m.sharing && (!best || m.sharing > best.m.sharing)) best = { k, m }; });
    if (!best) return null;
    const me = best.k === v.key;
    return { key: best.k, name: best.m.name || '', me, stream: me ? null : v.peers.get(best.k)?.video || null };
  }

  /** Хто записує нараду: { key, name, me, since } або null (пише один — той, хто натиснув «Нарада»). */
  function recorder() {
    let best = null;
    v.members.forEach((m, k) => { if (m.rec && (!best || m.rec < best.m.rec)) best = { k, m }; });
    return best ? { key: best.k, name: best.m.name || '', me: best.k === v.key, since: best.m.rec } : null;
  }

  function sinkEl() {
    if (!v.sink) {
      v.sink = document.createElement('div');
      v.sink.hidden = true;
      document.body.append(v.sink);
    }
    return v.sink;
  }

  /* ───────── вхід / вихід ───────── */

  /**
   * Відкрити канал кімнати. opts.listen — лише дивитися (без присутності й звуку);
   * без opts — зайти. Уже в іншій кімнаті — перемикаємось, мікрофон і звук лишаються як були.
   */
  async function join(topic, label, opts = {}) {
    if (v.topic === topic && v.ch) {
      if ('listen' in opts) await (opts.listen ? exit() : enter());
      return;
    }
    if (v.ch) await closeChannel();
    v.inRoom = !opts.listen;
    v.topic = topic;
    v.label = label || '';
    v.status = 'joining';
    v.error = '';
    emit();
    v.key = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await ensureIce();
    if (v.topic !== topic || v.ch) return; // поки чекали ключі TURN, людина вже пішла або перемкнулась
    const ch = sb.channel(topic, { config: { private: true, broadcast: { self: false }, presence: { key: v.key } } });
    v.ch = ch;
    ch.on('presence', { event: 'sync' }, () => onSync(ch))
      // Хтось зайшов чи вийшов — звук і тост. Перемикання мікрофона теж приходить як join/leave
      // того самого ключа (currentPresences не порожній) — на нього мовчимо. Стан, що прийшов
      // одразу після входу (усі, хто вже був у кімнаті), теж не дзвонить: це не «зайшли щойно».
      .on('presence', { event: 'join' }, ({ key, currentPresences, newPresences }) => {
        if (key === v.key || !v.inRoom || currentPresences?.length || Date.now() - v.since < 3000) return;
        arrive(newPresences?.[0] || {});
      })
      .on('presence', { event: 'leave' }, ({ key, currentPresences, leftPresences }) => {
        if (key === v.key || !v.inRoom || currentPresences?.length) return;
        chime(false);
        const who = leftPresences?.[0]?.name;
        if (who) toast(`${who} — вийшов(-ла) з кімнати`);
      })
      .on('broadcast', { event: 'sig' }, ({ payload }) => onSignal(payload))
      .on('broadcast', { event: 'room' }, ({ payload }) => {
        if (ch !== v.ch) return;
        try { onMsg(payload || {}); } catch (e) { console.warn('[voice] onMsg', e); }
      })
      .subscribe(async (status, err) => {
        if (ch !== v.ch) return;
        if (status === 'SUBSCRIBED') {
          v.status = 'live';
          v.since = Date.now();
          if (v.inRoom) await ch.track(meta());
          emit();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const m = String(err?.message || err || '');
          const closed = /unauthori|permission|denied/i.test(m);
          issue('channel_error', { msg: m.slice(0, 200) || status, closed });
          v.status = 'error';
          v.error = closed
            ? 'Голосова кімната ще закрита: потрібна міграція (migration_2026-11-03*.sql).'
            : 'Немає зв\'язку з кімнатою. Спробуємо ще раз за хвилину.';
          emit();
          // Обрив мережі — пробуємо знову; закрита політиками кімната сама не відкриється
          if (!closed) {
            setTimeout(() => {
              if (v.ch !== ch) return;
              const [t, l, listen] = [v.topic, v.label, !v.inRoom];
              closeChannel().then(() => join(t, l, { listen }));
            }, 60000);
          }
        }
      });
    clearInterval(v.timer);
    v.timer = setInterval(tick, 150);
    clearInterval(v.statTimer);
    v.statTimer = setInterval(statsTick, STATS_MS);
    if (v.inRoom) selfArrive();
    flushIssues();   // недосланий журнал проблем з минулих разів
  }

  /** Закрити канал (перемикання кімнати, перепідключення): мікрофон і звук не чіпаємо. */
  async function closeChannel() {
    clearInterval(v.timer);
    clearInterval(v.statTimer);
    stopShare(true);
    for (const k of [...v.peers.keys()]) dropPeer(k, true);
    const ch = v.ch;
    v.ch = null;
    v.members.clear();
    v.topic = '';
    if (ch) {
      try { await ch.untrack(); } catch (_) { /* канал уже закрито */ }
      try { await sb.removeChannel(ch); } catch (_) { /* те саме */ }
    }
  }

  /** Вийти з голосу зовсім. quiet — без звуку виходу (закриття вкладки). */
  async function leave(quiet) {
    const was = v.inRoom && v.status !== 'idle';
    await closeChannel();
    stopMic();
    v.muted = true;
    v.label = '';
    v.status = 'idle';
    v.error = '';
    if (!quiet && was) chime(false);
    emit();
  }

  /** «Лише дивлюся» → у кімнату. */
  async function enter() {
    if (!v.ch || v.inRoom) return;
    v.inRoom = true;
    selfArrive();
    if (v.status === 'live') await v.ch.track(meta());
    emit();
  }

  /** З кімнати → «лише дивлюся»: канал лишається, видно, хто там. */
  async function exit() {
    if (!v.inRoom) return;
    v.inRoom = false;
    stopShare(true);
    stopMic();
    v.muted = true;
    for (const k of [...v.peers.keys()]) dropPeer(k, true);
    try { await v.ch?.untrack(); } catch (_) { /* канал закрито */ }
    chime(false);
    emit();
  }

  const meta = () => ({ uid: me?.id, name, muted: v.muted, deaf: v.deaf, dev: DEVICE, caps: ['screen'], sharing: v.shareSince, rec: v.rec?.since || 0,
    hi: v.hi, lead: ALWAYS.includes(role) ? 1 : 0, hero: lsGet(HERO_LS) });

  function onSync(ch) {
    if (ch !== v.ch) return;
    const st = ch.presenceState() || {};
    v.members = new Map(Object.entries(st).map(([k, arr]) => [k, arr[arr.length - 1] || {}]));
    // Почався запис наради — кожному в кімнаті (і тому, хто зайшов посеред наради) сигнал і тост.
    // Попередити всіх, що йде запис, — обов'язково
    const rc = recorder();
    if (rc && rc.key !== v.recSeen) {
      v.recSeen = rc.key;
      if (!rc.me && v.inRoom) {
        warnTone();
        toast(`🔴 Іде запис наради (увімкнув(-ла) ${rc.name}). Усе сказане в кімнаті записується.`);
      }
    } else if (!rc && v.recSeen) {
      if (v.inRoom && v.recSeen !== v.key) toast('⏹ Запис наради завершено');   // ініціатору скаже meeting.js
      v.recSeen = '';
    }
    // Показ екрана: одна людина за раз — хтось почав пізніше за нас, наш показ зупиняється
    const pr = presenter();
    if (v.screen && pr && !pr.me) {
      v.presenter = pr.key;           // до stopShare: повторна синхронізація не скаже «показує» ще раз
      stopShare();
      toast(`🖥 ${pr.name} почав(-ла) показ — ваш показ зупинено`);
    } else if (pr && !pr.me && pr.key !== v.presenter && v.inRoom) {
      toast(`🖥 ${pr.name} показує екран`);
    }
    v.presenter = pr?.key || '';
    if (v.inRoom && v.members.has(v.key)) {
      // Дзвонить той, у кого ключ менший; другий чекає пропозиції — так двоє
      // ніколи не дзвонять одне одному одночасно
      for (const k of v.members.keys()) if (k !== v.key && !v.peers.has(k) && v.key < k) callPeer(k);
    }
    for (const k of [...v.peers.keys()]) if (!v.members.has(k)) dropPeer(k);
    emit();
  }

  function send(to, msg) {
    v.ch?.send({ type: 'broadcast', event: 'sig', payload: { ...msg, from: v.key, to } });
  }

  async function onSignal(m) {
    if (!m || m.to !== v.key || !v.ch || !v.inRoom) return;
    const k = m.from;
    try {
      if (m.type === 'offer') {
        if (v.peers.has(k)) dropPeer(k); // нова пропозиція = перепідключення
        const p = makePeer(k);
        await p.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        const tr = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
        if (tr) {
          tr.direction = 'sendrecv';
          p.sender = tr.sender;
          if (v.mic) await p.sender.replaceTrack(v.mic);
        }
        // Відеоканал показу екрана — лише якщо той, хто дзвонить, його запропонував
        const vt = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video');
        if (vt) {
          vt.direction = 'sendrecv';
          p.vsender = vt.sender;
          if (v.screen) await setScreen(p);
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
    emit();
  }

  function flushIce(p) {
    p.pendingIce.splice(0).forEach((c) => p.pc.addIceCandidate(c).catch(() => {}));
  }

  /* ───────── з'єднання з учасником ───────── */

  function makePeer(k) {
    const pc = new RTCPeerConnection({ iceServers: v.ice });
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = v.deaf;
    sinkEl().append(audio);
    const p = { pc, sender: null, vsender: null, video: null, audio, tries: v.peers.get(k)?.tries || 0, pendingIce: [], gaveUp: false,
      born: Date.now(), net: null, cnt: null, slowLogged: false };
    pc.onicecandidate = (e) => { if (e.candidate) send(k, { type: 'ice', cand: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (e.track.kind === 'video') {
        // Відео показу екрана: трек є від початку з'єднання, кадри йдуть, лише поки людина показує
        p.video = new MediaStream([e.track]);
        e.track.onunmute = emit;
        emit();
        return;
      }
      audio.srcObject = new MediaStream([e.track]);
      playAudio(audio);
      addMeter(k, audio.srcObject);
      levelPeer(p);
      if (v.rec) recAttach(k, audio.srcObject);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') p.tries = 0;
      if (pc.connectionState === 'failed') {
        issue('peer_failed', { peer: k, tries: p.tries, ice: pc.iceConnectionState, last: p.net });
        retryPeer(k);
      }
      emit();
    };
    v.peers.set(k, p);
    return p;
  }

  async function callPeer(k) {
    const p = makePeer(k);
    const tr = p.pc.addTransceiver(v.mic || 'audio', { direction: 'sendrecv' });
    p.sender = tr.sender;
    if (v.members.get(k)?.caps?.includes('screen')) {
      const vt = p.pc.addTransceiver(v.screen || 'video', { direction: 'sendrecv' });
      p.vsender = vt.sender;
    }
    await p.pc.setLocalDescription(await p.pc.createOffer());
    if (v.screen && p.vsender) setScreen(p);
    send(k, { type: 'offer', sdp: p.pc.localDescription.sdp });
  }

  function retryPeer(k) {
    const p = v.peers.get(k);
    if (!p || v.key > k) return; // перепідключає той, хто дзвонив
    if (p.tries >= RETRIES) {
      p.gaveUp = true;
      issue('peer_gave_up', { peer: k, tries: p.tries, ice: p.pc.iceConnectionState });
      emit();
      return;
    }
    const tries = p.tries + 1;
    setTimeout(async () => {
      if (!v.ch || !v.inRoom || !v.members.has(k) || v.peers.get(k) !== p) return;
      dropPeer(k);
      await ensureIce();
      await callPeer(k);
      const np = v.peers.get(k);
      if (np) np.tries = tries;
    }, 1500 * tries);
  }

  function dropPeer(k, sayBye) {
    const p = v.peers.get(k);
    if (!p) return;
    if (sayBye) send(k, { type: 'bye' });
    recDetach(k);
    try { p.pc.close(); } catch (_) { /* уже закрито */ }
    unlevel(p);
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    v.meters.delete(k);
    v.peers.delete(k);
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

  async function ensureIce() {
    if (!VOICE_TURN_URL || Date.now() < v.iceUntil) return;
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(VOICE_TURN_URL, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      v.ice = d.iceServers?.length ? d.iceServers : STUN;
      v.iceUntil = Date.now() + (d.ttl || 3600) * 900; // оновлюємо трохи раніше, ніж ключ спливе
    } catch (e) {
      console.warn('[voice] TURN недоступний, лише прямі з\'єднання', e);
      issue('turn_down', { msg: String(e?.message || e).slice(0, 200) });
      v.ice = STUN;
      v.iceUntil = Date.now() + 5 * 60000;
    }
  }

  /* ───────── мікрофон і звук ───────── */

  /** Відкрити мікрофон: вибраний пристрій, а якщо його вже нема — основний. */
  async function openMic() {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (v.micId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: v.micId } } });
      } catch (e) {
        if (!/Overconstrained|NotFound/.test(e?.name || '')) throw e;
        // Навушники відключили, змінили порт — беремо основний і вибір забуваємо
        v.micId = '';
        lsSet(MIC_LS, '');
        toast('Вибраного мікрофона немає — беремо основний. Інший можна обрати кнопкою «⚙».');
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: base });
  }

  /** Поставити доріжку мікрофона «в роботу»: індикатор, запис, перевірка тиші, відключення. */
  function useMic(s) {
    const t = s.getAudioTracks()[0];
    v.mic = t;
    v.meters.delete('me');
    addMeter('me', s);
    if (v.rec) recAttach('me', s);
    v.micSince = 0;
    v.micHeard = false;
    v.micSilent = false;
    // Висмикнули навушники — пробуємо підхопити інший мікрофон, а не мовчимо
    t.onended = () => {
      if (v.mic !== t) return;
      issue('mic_lost', { label: (t.label || '').slice(0, 80) });
      stopMic();
      if (v.muted || !v.ch) return;
      toast('Мікрофон відключився — пробуємо інший.', true);
      v.micId = '';
      openMic().then((s2) => {
        if (v.mic || v.muted || !v.ch) return s2.getTracks().forEach((x) => x.stop());
        useMic(s2);
        return Promise.all([...v.peers.values()].map((p) => p.sender?.replaceTrack(v.mic).catch(() => {})));
      }).catch(() => { v.muted = true; toast('Мікрофона немає — підключіть його й увімкніть знову.', true); }).finally(retrack);
    };
  }

  function stopMic() {
    if (!v.mic) return;
    recDetach('me');
    v.mic.onended = null;
    v.mic.stop();
    v.mic = null;
    v.meters.delete('me');
    v.micSilent = false;
  }

  /** Список мікрофонів. Назви браузер дає лише після дозволу на мікрофон (labeled). */
  async function mics() {
    const all = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
    const list = all.filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label }));
    // Свій вибір — як є; «за замовчуванням» з увімкненим мікрофоном — справжній пристрій під ним
    return { list, current: v.micId || v.mic?.getSettings?.().deviceId || 'default', labeled: list.some((d) => d.label) };
  }

  /** Обрати мікрофон. Увімкнений — міняємо доріжку в усіх з'єднаннях на ходу. */
  async function setMic(id) {
    const prev = v.micId;
    v.micId = id === 'default' ? '' : (id || '');
    if (!v.mic || v.muted) { lsSet(MIC_LS, v.micId); emit(); return true; }
    let s;
    try { s = await openMic(); } catch (e) {
      v.micId = prev;
      toast(e?.name === 'NotReadableError' ? 'Цей мікрофон зайнятий іншою програмою.' : 'Не вдалося увімкнути цей мікрофон.', true);
      return false;
    }
    lsSet(MIC_LS, v.micId);
    stopMic();
    useMic(s);
    await Promise.all([...v.peers.values()].map((p) => p.sender?.replaceTrack(v.mic).catch(() => {})));
    emit();
    return true;
  }

  /**
   * Мікрофон увімкнено, а звуку з нього немає SILENT_MS — колеги нас не чують.
   * Рахуємо час лише поки AudioContext працює: «приспаний» контекст теж дає нулі.
   */
  function checkSilence(dt) {
    if (!v.mic || v.muted || v.micHeard) return;
    const an = v.meters.get('me');
    if (!an || v.ctx?.state !== 'running') return;
    if (!v.mic.muted && level(an) > SILENT_LEVEL) {
      v.micHeard = true;
      if (v.micSilent) { v.micSilent = false; emit(); }
      return;
    }
    v.micSince += dt;
    if (v.micSilent || v.micSince < SILENT_MS) return;
    v.micSilent = true;
    toast('Ваш мікрофон нічого не передає — колеги вас не чують. Оберіть інший кнопкою «⚙».', true);
    const t = v.mic;
    mics().then(({ list }) => issue('mic_silent', {
      label: (t.label || '').slice(0, 80),
      chosen: !!v.micId,
      track_muted: t.muted,
      inputs: list.length
    }));
    emit();
  }

  async function setMuted(muted, quiet) {
    if (!v.ch || !v.inRoom) return;
    if (!muted && !v.mic) {
      try {
        useMic(await openMic());
      } catch (e) {
        // NotAllowedError — заборонив людина чи система; NotFoundError — мікрофона немає;
        // NotReadableError — мікрофон зайнятий іншою програмою (Teams, Zoom)
        issue('mic_denied', { err: e?.name || '', msg: String(e?.message || '').slice(0, 200), chosen: !!v.micId });
        toast(e?.name === 'NotFoundError' ? 'Мікрофон не знайдено: підключіть його й спробуйте ще раз.'
          : e?.name === 'NotReadableError' ? 'Мікрофон зайнятий іншою програмою (Teams, Zoom?) — закрийте її або оберіть інший кнопкою «⚙».'
          : 'Браузер не дав доступу до мікрофона: дозвольте його біля адресного рядка.', true);
        return;
      }
    }
    if (muted) stopMic();
    const was = v.muted;
    v.muted = muted;
    if (was !== muted && !quiet) micClick(!muted);   // коротке «тік»: угору — увімкнули, униз — вимкнули
    v.lastVoice = Date.now();
    v.idleWarn = false;
    // Заговорив без звуку — звук повертаємо: говорити й не чути відповіді безглуздо
    if (!muted && v.deaf) { v.micBeforeDeaf = false; hear(true); }
    await Promise.all([...v.peers.values()].map((p) => p.sender?.replaceTrack(v.mic).catch(() => {})));
    if (!quiet) retrack();
  }

  /* ───────── запис наради ───────── */

  // Кожен голос — окрема доріжка (свій мікрофон і кожен учасник): у протоколі точно відомо,
  // хто що сказав, і не треба вгадувати голоси. Час доріжки — зсув від початку наради.
  const REC_MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';

  function recAttach(k, stream) {
    if (!v.rec || !stream?.getAudioTracks().length) return;
    recDetach(k);
    const mem = k === 'me' ? { uid: me?.id, name } : (v.members.get(k) || {});
    let mr;
    try {
      mr = new MediaRecorder(new MediaStream(stream.getAudioTracks()), REC_MIME ? { mimeType: REC_MIME, audioBitsPerSecond: 32000 } : {});
    } catch (_) { return; }
    const src = { k, mr, chunks: [], start: Date.now(), uid: mem.uid || null, name: mem.name || '' };
    const rec = v.rec;
    src.stopped = new Promise((res) => {
      mr.onstop = () => {
        const blob = new Blob(src.chunks, { type: mr.mimeType || REC_MIME || 'audio/webm' });
        if (blob.size) rec.done.push({ uid: src.uid, name: src.name || v.members.get(k)?.name || '', offset_ms: src.start - rec.since, dur_ms: Date.now() - src.start, blob });
        res();
      };
    });
    mr.ondataavailable = (e) => { if (e.data?.size) src.chunks.push(e.data); };
    mr.start(10000);
    rec.sources.set(k, src);
  }

  function recDetach(k) {
    const src = v.rec?.sources.get(k);
    if (!src) return;
    v.rec.sources.delete(k);
    if (!src.name) src.name = v.members.get(k)?.name || '';
    try { src.mr.stop(); } catch (_) { /* уже зупинено */ }
    v.rec.pending.push(src.stopped);
  }

  /** «🔴 Нарада»: почати запис у цьому браузері. Усім у кімнаті прийде попередження. */
  function startRecording() {
    if (v.rec || !v.ch || !v.inRoom || v.status !== 'live' || !window.MediaRecorder) return false;
    v.rec = { since: Date.now(), sources: new Map(), done: [], pending: [] };
    v.recSeen = v.key;
    v.peers.forEach((p, k) => { if (p.audio?.srcObject) recAttach(k, p.audio.srcObject); });
    if (v.mic) recAttach('me', new MediaStream([v.mic]));
    warnTone();
    retrack();
    return true;
  }

  /** «⏹ Кінець наради»: зупинити запис і віддати доріжки { since, until, tracks: [{ uid, name, offset_ms, dur_ms, blob }] }. */
  async function stopRecording() {
    const rec = v.rec;
    if (!rec) return null;
    [...rec.sources.keys()].forEach(recDetach);
    await Promise.all(rec.pending);
    v.rec = null;
    retrack();
    return { since: rec.since, until: Date.now(), mime: REC_MIME, tracks: rec.done.sort((a, b) => a.offset_ms - b.offset_ms) };
  }

  /** Сигнал «іде запис»: три короткі однакові ноти — не сплутати з дзвоником входу. */
  function warnTone() {
    const ctx = audioCtx();
    if (!ctx) return;
    const play = () => {
      const t = ctx.currentTime;
      [0, 0.22, 0.44].forEach((d) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(880, t + d);
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(t + d);
        o.stop(t + d + 0.17);
      });
    };
    if (ctx.state === 'running') play();
    else ctx.resume().then(play).catch(() => {});
  }

  /* ───────── показ екрана ───────── */

  async function setScreen(p) {
    if (!p.vsender) return;
    await p.vsender.replaceTrack(v.screen).catch(() => {});
    if (!v.screen) return;
    try {
      const prm = p.vsender.getParameters();
      if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
      prm.encodings[0].maxBitrate = SCREEN_BITRATE;
      prm.encodings[0].maxFramerate = SCREEN_FPS;
      await p.vsender.setParameters(prm);
    } catch (_) { /* браузер не дав змінити параметри — піде з типовими */ }
  }

  /** Повертає 'ok' | 'gesture' (потрібен клік у цьому вікні) | '' (не вийшло або людина передумала). */
  async function startShare() {
    if (!v.ch || !v.inRoom || v.status !== 'live' || v.screen) return '';
    if (navigator.userActivation && !navigator.userActivation.isActive && canShare()) return 'gesture';
    if (!canShare()) {
      toast('Цей браузер не вміє показувати екран. Покажіть з комп\'ютера — Chrome або Edge.', true);
      return;
    }
    let s;
    try {
      s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: SCREEN_FPS } }, audio: false });
    } catch (e) { return e?.name === 'InvalidStateError' ? 'gesture' : ''; }   // людина передумала у вікні вибору
    return useScreen(s.getVideoTracks()[0]);
  }

  /**
   * Показати вже захоплену доріжку екрана (25.11.2026). Захопити може й вкладка порталу — у своєму кліку,
   * без голосового вікна, — і віддати доріжку сюди (shareTrack). Показ живе, поки жива та вкладка.
   */
  async function useScreen(t) {
    if (!t || !v.ch || !v.inRoom || v.status !== 'live') { try { t?.stop(); } catch (_) { /* уже */ } return ''; }
    if (v.screen) stopShare(true);
    try { t.contentHint = 'detail'; } catch (_) { /* старий браузер */ }
    t.onended = () => stopShare();      // «Припинити показ» у панелі браузера
    v.screen = t;
    v.shareSince = Date.now();
    await Promise.all([...v.peers.values()].map(setScreen));
    const viewers = v.members.size - 1;
    if (viewers >= 8) toast(`Екран бачать ${viewers} людей — з одного комп'ютера показ може гальмувати.`);
    retrack();
    return 'ok';
  }

  /** quiet — без оновлення присутності (вихід із кімнати, перемикання). */
  function stopShare(quiet) {
    if (!v.screen) return;
    v.screen.onended = null;
    v.screen.stop();
    v.screen = null;
    v.shareSince = 0;
    v.peers.forEach((p) => { p.vsender?.replaceTrack(null).catch(() => {}); });
    if (!quiet) retrack();
  }

  function hear(on) {
    v.deaf = !on;
    v.peers.forEach((p) => { if (p.audio) p.audio.muted = !on || !!p.lv; });
    if (v.out) v.out.gain.value = on ? 1 : 0;
  }

  /** «Вимкнути звук» глушить і мікрофон, «Увімкнути» повертає його, як було (як у Discord). */
  async function setDeaf(deaf) {
    if (!v.ch || !v.inRoom) return;
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
    emit();
  }

  function playAudio(audio) {
    audio.play().catch((e) => { v.needGesture = true; issue('need_gesture', { err: e?.name || '' }); emit(); });
  }

  function unlock() {
    if (v.ctx?.state === 'suspended') v.ctx.resume().then(levelAll).catch(() => {});
    if (!v.needGesture) return;
    v.needGesture = false;
    v.peers.forEach((p) => p.audio?.srcObject && playAudio(p.audio));
    emit();
  }

  function audioCtx() {
    if (!v.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      v.ctx = new AC();
      v.ctx.onstatechange = levelAll;   // «заснув» — граємо через елемент, «прокинувся» — знову вирівнюємо
    }
    return v.ctx;
  }

  /* ───────── вирівнювання гучності колег ───────── */

  /**
   * Голос колеги: потік → підсилювач → компресор → спільний вихід. Елемент <audio> лишається
   * підключеним, але приглушеним: без нього Chrome не віддає звук віддаленого потоку в Web Audio.
   * Поки контекст не працює — граємо через сам елемент, щоб не лишити людину без звуку.
   */
  function levelPeer(p) {
    const ctx = v.ctx;
    const want = v.leveling && ctx?.state === 'running' && p.audio?.srcObject?.getAudioTracks().length;
    if (!want) return unlevel(p);
    if (p.lv?.stream === p.audio.srcObject) return;
    unlevel(p);
    if (!v.out) {
      v.out = ctx.createGain();
      v.out.gain.value = v.deaf ? 0 : 1;
      v.out.connect(ctx.destination);
    }
    try {
      const src = ctx.createMediaStreamSource(p.audio.srcObject);
      const gain = ctx.createGain();
      gain.gain.value = p.lvGain || 1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;
      src.connect(gain).connect(comp).connect(v.out);
      p.lv = { stream: p.audio.srcObject, src, gain, comp };
      p.audio.muted = true;
    } catch (e) {
      issue('level_fail', { err: e?.name || '' });
      unlevel(p);
    }
  }

  function unlevel(p) {
    if (p.lv) {
      try { p.lv.src.disconnect(); p.lv.comp.disconnect(); } catch (_) { /* уже відключено */ }
      p.lv = null;
    }
    if (p.audio) p.audio.muted = v.deaf;
  }

  function levelAll() { v.peers.forEach(levelPeer); }

  /** Раз на такт: хто зараз говорить — підправляємо його підсилення до спільного рівня. */
  function adjustLevel(p, l) {
    if (!p.lv || l < SPEAK_LEVEL * 0.4) return;                        // нижчий поріг: тихого теж треба почути, щоб підсилити
    p.lvSpeech = p.lvSpeech ? p.lvSpeech * 0.92 + l * 0.08 : l;     // середній рівень мовлення людини
    const g = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, LEVEL_TARGET / p.lvSpeech));
    p.lvGain = g;
    p.lv.gain.gain.setTargetAtTime(g, v.ctx.currentTime, 0.6);
  }

  // Галочку зняли/поставили в іншій вкладці (голосове вікно) — підхоплюємо
  window.addEventListener('storage', (e) => {
    if (e.key !== LEVEL_LS) return;
    v.leveling = e.newValue !== '0';
    levelAll();
    emit();
  });

  function setLeveling(on) {
    v.leveling = !!on;
    lsSet(LEVEL_LS, on ? '' : '0');
    if (on) unlock();
    levelAll();
    emit();
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

  /** Раз на 150 мс підсвічуємо того, хто говорить, — без перемальовування. */
  function tick() {
    v.meters.forEach((an, k) => {
      const l = level(an);
      if (k !== 'me') { const p = v.peers.get(k); if (p) adjustLevel(p, l); }
      const on = l > SPEAK_LEVEL && !(k === 'me' && v.muted);
      const key = k === 'me' ? v.key : k;
      // data-lvl — розкриття рота героя: 0 закритий, 1 трохи, 2 широко (чергуємо, щоб рот «балакав»)
      const lvl = !on ? '0' : (v.flap = !v.flap) ? '1' : l > SPEAK_LEVEL * 3 ? '2' : '0';
      document.querySelectorAll(`[data-vk="${key}"]`).forEach((el) => {
        el.classList.toggle('is-speaking', on);
        if (el.dataset.lvl !== lvl) el.dataset.lvl = lvl;
      });
    });
    checkSilence(150);
    checkIdle();
  }

  /** Довга тиша з увімкненим мікрофоном: попередження, далі — вимикаємо (якщо не стоїть «не вимикати»). */
  function checkIdle() {
    const now = Date.now();
    const quiet = () => { if (v.idleWarn) { v.idleWarn = false; emit(); } v.lastVoice = now; };
    if (!v.mic || v.muted || !v.inRoom || v.keepMic) return quiet();
    const an = v.meters.get('me');
    // «Приспаний» AudioContext дає нулі — тишею це не рахуємо
    if (!an || v.ctx?.state !== 'running' || !v.lastVoice) return quiet();
    if (level(an) > SPEAK_LEVEL) return quiet();
    const idle = now - v.lastVoice;
    if (idle >= IDLE_OFF) {
      v.idleWarn = false;
      setMuted(true);
      toast('🔇 Мікрофон вимкнено: ви мовчали понад 5 хвилин. Увімкнути — кнопкою мікрофона', true);
      return;
    }
    if (idle < IDLE_WARN) return;
    const left = Math.ceil((IDLE_OFF - idle) / 1000);
    if (!v.idleWarn) {
      v.idleWarn = true;
      toast('🤫 Ви давно мовчите, а мікрофон увімкнено — за 3 хвилини вимкнемо його');
    }
    if (left !== v.idleLeft) { v.idleLeft = left; emit(); }
  }

  /**
   * Звук входу/виходу: дві ноти, як дверний дзвінок (вхід — вгору, вихід — униз).
   * Раніше звучав ледь чутно (гучність 0,08) і лише якщо AudioContext уже «прокинувся»
   * від кліку — колега заходив беззвучно (03.11.2026). Тепер гучніше й будимо контекст:
   * після будь-якої взаємодії зі сторінкою браузер дозволяє resume() без нового кліку.
   */
  function chime(up) {
    if (v.deaf) return;
    // Вхід — мелодійний дзвінок записом; не вийшло (браузер не дав грати) — дві ноти синтезом
    if (up) { playClip(CHIME, 0.7).catch(() => synthChime(true)); return; }
    synthChime(false);
  }

  /**
   * Хтось зайшов у кімнату, де я: перший вхід за день (його hi = сьогодні) чи керівництво — привітання
   * на ім'я, решта — дзвінок. Записане привітання є не для всіх імен (./greet.js) — тоді дзвінок.
   */
  function arrive(m) {
    const g = greetFor(m.name);
    const key = m.uid || m.name || '';
    const byName = g && (m.hi === today() || (m.lead && Date.now() - (v.greeted.get(key) || 0) > GREET_AGAIN));
    if (byName) {
      v.greeted.set(key, Date.now());
      toast(`🎉 ${g.text}`);
      if (!v.deaf) playClip(g.src).catch(() => chime(true));
      return;
    }
    chime(true);
    if (m.name) toast(`🎧 ${m.name} — у кімнаті`);
  }

  /** Я зайшов(-ла): перший раз за день (чи я з керівництва) — чую своє привітання, інакше — дзвінок. */
  function selfArrive() {
    const first = firstEntryToday();
    v.hi = first ? today() : '';
    const g = greetFor(name);
    const lead = ALWAYS.includes(role) && Date.now() - (v.greeted.get(me?.id) || 0) > GREET_AGAIN;
    if (g && (first || lead)) {
      v.greeted.set(me?.id, Date.now());
      toast(`🎉 ${g.text}`);
      if (!v.deaf) playClip(g.src).catch(() => chime(true));
      return;
    }
    chime(true);
  }

  /**
   * Коротке «тік» на мікрофон (25.11.2026: «на клік "Говорити" коротенький звук і на обратну дію теж»):
   * увімкнули — дві дуже короткі ноти вгору, вимкнули — вниз. Тихо (0,12), ~0,12 с, чути лише вам.
   */
  function micClick(on) {
    const ctx = audioCtx();
    if (!ctx || v.deaf) return;
    const play = () => {
      const t = ctx.currentTime;
      (on ? [880, 1320] : [1320, 880]).forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const s = t + i * 0.06;
        o.type = 'sine';
        o.frequency.setValueAtTime(f, s);
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.12, s + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.06);
        o.connect(g).connect(ctx.destination);
        o.start(s);
        o.stop(s + 0.07);
      });
    };
    if (ctx.state === 'running') play();
    else ctx.resume().then(play).catch(() => {});
  }

  /** Дві ноти, як дверний дзвінок (вгору — вхід, униз — вихід). Для входу — запасний варіант. */
  function synthChime(up) {
    const ctx = audioCtx();
    if (!ctx || v.deaf) return;
    const play = () => {
      const t = ctx.currentTime;
      const notes = up ? [659.25, 987.77] : [987.77, 659.25];   // E5 → B5 / B5 → E5
      notes.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const s = t + i * 0.16;
        o.type = 'triangle';
        o.frequency.setValueAtTime(f, s);
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.3, s + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.32);
        o.connect(g).connect(ctx.destination);
        o.start(s);
        o.stop(s + 0.34);
      });
    };
    if (ctx.state === 'running') play();
    else ctx.resume().then(play).catch(() => {});
  }

  document.addEventListener('pointerdown', () => { audioCtx(); unlock(); }, true);
  preloadChime();
  document.addEventListener('keydown', unlock, true);
  window.addEventListener('pagehide', () => { if (v.ch) leave(true); });

  return {
    join,
    leave,
    enter,
    exit,
    toggleMic: () => setMuted(!v.muted),
    mics,
    setMic,
    toggleDeaf: () => setDeaf(!v.deaf),
    toggleShare: async () => { if (v.screen) { stopShare(); return 'off'; } return startShare(); },
    shareTrack: (t) => useScreen(t),
    /** Повідомлення всім у каналі кімнати (broadcast 'room'); проміс — коли сервер прийняв. */
    say: (payload) => (v.ch ? v.ch.send({ type: 'broadcast', event: 'room', payload: { ...payload, from_key: v.key } }) : Promise.resolve('closed')),
    startRecording,
    stopRecording,
    get recording() { return !!v.rec; },
    unlock,
    /** «Я тут» — скинути відлік тиші. */
    stillHere: () => { v.lastVoice = Date.now(); v.idleWarn = false; emit(); },
    /** Галочка «не вимикати мікрофон автоматично» (пам'ятає браузер). */
    /** Вирівнювання гучності колег (пам'ятає браузер; інші вкладки підхоплюють через 'storage'). */
    get leveling() { return v.leveling; },
    setLeveling,
    setKeepMic: (on) => { v.keepMic = !!on; lsSet(KEEP_LS, on ? '1' : ''); v.lastVoice = Date.now(); v.idleWarn = false; emit(); },
    /** Обраний герой: пам'ятає браузер, колеги бачать його через присутність кімнати. */
    get hero() { return lsGet(HERO_LS); },
    setHero: (id) => { lsSet(HERO_LS, id || ''); retrack(); emit(); },
    get topic() { return v.topic; },
    get state() { return snapshot(); },
    // Для перевірок (два екземпляри на одній сторінці): з'єднання й лічильники байтів
    get debug() { return v; }
  };
}

/** Канал голосу для розмови: головна стрічка, кімната чату або діалог 1:1. */
export function voiceTopic(chan, myId) {
  if (chan.kind === 'main') return 'voice:all';
  if (chan.kind === 'room') return 'voice:room:' + chan.id;
  const [a, b] = [myId, chan.uid].sort();
  return `voice:dm:${a}:${b}`;
}
