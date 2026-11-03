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
 *   'voice:all'               — головна стрічка департаменту (та сама, що в «Справах»);
 *   'voice:room:<uuid>'       — кімната чату: хто бачить кімнату, той і заходить;
 *   'voice:dm:<uuid>:<uuid>'  — дзвінок 1:1.
 *
 * Модуль нічого не малює сам: стан віддає в onChange, а «хто говорить»
 * підсвічує на будь-якому елементі з data-vk="<ключ учасника>".
 *
 * Мікрофон за замовчуванням вимкнений. Вимкнений мікрофон зупиняється зовсім —
 * індикатор запису в браузері гасне. Звук у базу не пишеться.
 *
 * Показ екрана (03.11.2026): у кожному з'єднанні — другий, відеоканал; показ вмикається
 * заміною доріжки (як мікрофон), без нового рукостискання. Відеоканал додаємо лише тим,
 * хто в присутності оголосив caps: ['screen'] — вкладка зі старою версією отримала б
 * зайвий трек і зламала б собі звук. Показує одна людина: хто почав пізніше (sharing —
 * час початку), той і показує, попередній показ зупиняється сам. Під документи:
 * contentHint 'detail', до 15 кадрів/с, до 1,5 Мбіт/с.
 */

// Адреса воркера tools/voice-turn (та сама, що в spravy/voice.js). Порожньо — лише STUN.
const VOICE_TURN_URL = 'https://pmg-voice-turn.doktorvzgljad.workers.dev';
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const RETRIES = 3;
const SPEAK_LEVEL = 0.035;
const SCREEN_BITRATE = 1500000;   // показ екрана: текст документів читається, канал не забиваємо
const SCREEN_FPS = 15;
const canShare = () => !!navigator.mediaDevices?.getDisplayMedia;

export const MANY = 10; // з такої кількості пряма схема кожен-з-кожним важчає

export function createVoice({ sb, me, name, toast = () => {}, onChange = () => {} }) {
  const v = {
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
    inRoom: true          // false — «лише дивлюся»: підписані на канал, але без присутності й звуку
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
      needGesture: v.needGesture,
      inRoom: v.inRoom,
      sharing: !!v.screen,
      canShare: canShare(),
      presenter: presenter(),
      members: [...v.members.entries()].map(([k, m]) => ({ key: k, ...m, me: k === v.key, state: k === v.key ? 'ok' : peerState(k) }))
    };
  }

  /** Хто показує екран: { key, name, me, stream } або null. stream — відео від нього (у себе — null). */
  function presenter() {
    let best = null;
    v.members.forEach((m, k) => { if (m.sharing && (!best || m.sharing > best.m.sharing)) best = { k, m }; });
    if (!best) return null;
    const me = best.k === v.key;
    return { key: best.k, name: best.m.name || '', me, stream: me ? null : v.peers.get(best.k)?.video || null };
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
        chime(true);
        const who = newPresences?.[0]?.name;
        if (who) toast(`🎧 ${who} — у кімнаті`);
      })
      .on('presence', { event: 'leave' }, ({ key, currentPresences, leftPresences }) => {
        if (key === v.key || !v.inRoom || currentPresences?.length) return;
        chime(false);
        const who = leftPresences?.[0]?.name;
        if (who) toast(`${who} — вийшов(-ла) з кімнати`);
      })
      .on('broadcast', { event: 'sig' }, ({ payload }) => onSignal(payload))
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
    if (v.inRoom) chime(true);
  }

  /** Закрити канал (перемикання кімнати, перепідключення): мікрофон і звук не чіпаємо. */
  async function closeChannel() {
    clearInterval(v.timer);
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
    if (v.mic) { v.mic.stop(); v.mic = null; v.meters.delete('me'); }
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
    if (v.status === 'live') await v.ch.track(meta());
    chime(true);
    emit();
  }

  /** З кімнати → «лише дивлюся»: канал лишається, видно, хто там. */
  async function exit() {
    if (!v.inRoom) return;
    v.inRoom = false;
    stopShare(true);
    if (v.mic) { v.mic.stop(); v.mic = null; v.meters.delete('me'); }
    v.muted = true;
    for (const k of [...v.peers.keys()]) dropPeer(k, true);
    try { await v.ch?.untrack(); } catch (_) { /* канал закрито */ }
    chime(false);
    emit();
  }

  const meta = () => ({ uid: me?.id, name, muted: v.muted, deaf: v.deaf, caps: ['screen'], sharing: v.shareSince });

  function onSync(ch) {
    if (ch !== v.ch) return;
    const st = ch.presenceState() || {};
    v.members = new Map(Object.entries(st).map(([k, arr]) => [k, arr[arr.length - 1] || {}]));
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
    const p = { pc, sender: null, vsender: null, video: null, audio, tries: v.peers.get(k)?.tries || 0, pendingIce: [], gaveUp: false };
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
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') p.tries = 0;
      if (pc.connectionState === 'failed') retryPeer(k);
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
    if (p.tries >= RETRIES) { p.gaveUp = true; emit(); return; }
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
    try { p.pc.close(); } catch (_) { /* уже закрито */ }
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
      v.ice = STUN;
      v.iceUntil = Date.now() + 5 * 60000;
    }
  }

  /* ───────── мікрофон і звук ───────── */

  async function setMuted(muted, quiet) {
    if (!v.ch || !v.inRoom) return;
    if (!muted && !v.mic) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        v.mic = s.getAudioTracks()[0];
        addMeter('me', s);
      } catch (e) {
        toast('Браузер не дав доступу до мікрофона: дозвольте його біля адресного рядка.', true);
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
    if (!muted && v.deaf) { v.micBeforeDeaf = false; hear(true); }
    await Promise.all([...v.peers.values()].map((p) => p.sender?.replaceTrack(v.mic).catch(() => {})));
    if (!quiet) retrack();
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

  async function startShare() {
    if (!v.ch || !v.inRoom || v.status !== 'live' || v.screen) return;
    if (!canShare()) {
      toast('Цей браузер не вміє показувати екран. Покажіть з комп\'ютера — Chrome або Edge.', true);
      return;
    }
    let s;
    try {
      s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: SCREEN_FPS } }, audio: false });
    } catch (_) { return; }               // людина передумала у вікні вибору
    const t = s.getVideoTracks()[0];
    if (!t) return;
    try { t.contentHint = 'detail'; } catch (_) { /* старий браузер */ }
    t.onended = () => stopShare();      // «Припинити показ» у панелі браузера
    v.screen = t;
    v.shareSince = Date.now();
    await Promise.all([...v.peers.values()].map(setScreen));
    const viewers = v.members.size - 1;
    if (viewers >= 8) toast(`Екран бачать ${viewers} людей — з одного комп'ютера показ може гальмувати.`);
    retrack();
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
    v.peers.forEach((p) => { if (p.audio) p.audio.muted = !on; });
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
    audio.play().catch(() => { v.needGesture = true; emit(); });
  }

  function unlock() {
    if (v.ctx?.state === 'suspended') v.ctx.resume().catch(() => {});
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

  /** Раз на 150 мс підсвічуємо того, хто говорить, — без перемальовування. */
  function tick() {
    v.meters.forEach((an, k) => {
      const on = level(an) > SPEAK_LEVEL && !(k === 'me' && v.muted);
      const key = k === 'me' ? v.key : k;
      document.querySelectorAll(`[data-vk="${key}"]`).forEach((el) => el.classList.toggle('is-speaking', on));
    });
  }

  /**
   * Звук входу/виходу: дві ноти, як дверний дзвінок (вхід — вгору, вихід — униз).
   * Раніше звучав ледь чутно (гучність 0,08) і лише якщо AudioContext уже «прокинувся»
   * від кліку — колега заходив беззвучно (03.11.2026). Тепер гучніше й будимо контекст:
   * після будь-якої взаємодії зі сторінкою браузер дозволяє resume() без нового кліку.
   */
  function chime(up) {
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
  document.addEventListener('keydown', unlock, true);
  window.addEventListener('pagehide', () => { if (v.ch) leave(true); });

  return {
    join,
    leave,
    enter,
    exit,
    toggleMic: () => setMuted(!v.muted),
    toggleDeaf: () => setDeaf(!v.deaf),
    toggleShare: () => (v.screen ? stopShare() : startShare()),
    unlock,
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
