/**
 * Голос у кімнатах «Чату департаменту» — той самий механізм, що в «Справах»
 * (spravy/voice.js): WebRTC кожен з кожним, рукостискання й присутність — через
 * приватний канал Supabase Realtime, запасний шлях — Cloudflare TURN (воркер
 * tools/voice-turn). Відмінність одна: тут кімнат багато, і людина сама вирішує,
 * у яку зайти (як у Discord). Одночасно — лише в одну.
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
 */

// Адреса воркера tools/voice-turn (та сама, що в spravy/voice.js). Порожньо — лише STUN.
export const VOICE_TURN_URL = 'https://pmg-voice-turn.doktorvzgljad.workers.dev';
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const RETRIES = 3;
const SPEAK_LEVEL = 0.035;

export const MANY = 10; // з такої кількості пряма схема кожен-з-кожним важчає

export function createVoice({ sb, me, name, toast = () => {}, onChange = () => {} }) {
  const v = {
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
    ice: STUN,
    iceUntil: 0,
    ctx: null,
    meters: new Map(),
    needGesture: false,
    timer: null,
    sink: null
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
      members: [...v.members.entries()].map(([k, m]) => ({ key: k, ...m, me: k === v.key, state: k === v.key ? 'ok' : peerState(k) }))
    };
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

  async function join(topic, label) {
    if (v.topic === topic && v.ch) return;
    if (v.ch) await leave(true);
    v.topic = topic;
    v.label = label || '';
    v.status = 'joining';
    v.error = '';
    emit();
    v.key = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await ensureIce();
    if (v.topic !== topic) return; // поки чекали ключі TURN, людина вже пішла
    const ch = sb.channel(topic, { config: { private: true, broadcast: { self: false }, presence: { key: v.key } } });
    v.ch = ch;
    ch.on('presence', { event: 'sync' }, () => onSync(ch))
      .on('presence', { event: 'join' }, ({ key }) => { if (key !== v.key) chime(true); })
      .on('presence', { event: 'leave' }, ({ key }) => { if (key !== v.key) chime(false); })
      .on('broadcast', { event: 'sig' }, ({ payload }) => onSignal(payload))
      .subscribe(async (status, err) => {
        if (ch !== v.ch) return;
        if (status === 'SUBSCRIBED') {
          v.status = 'live';
          await ch.track(meta());
          emit();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const m = String(err?.message || err || '');
          v.status = 'error';
          v.error = /unauthori|permission|denied/i.test(m)
            ? 'Голос цієї кімнати ще закритий: потрібна міграція migration_2026-11-03d_chat_voice_rooms.sql.'
            : 'Немає зв\'язку з голосовою кімнатою.';
          emit();
        }
      });
    clearInterval(v.timer);
    v.timer = setInterval(tick, 150);
    chime(true);
  }

  /** quiet — без звуку виходу (перемикання між кімнатами, закриття вкладки). */
  async function leave(quiet) {
    clearInterval(v.timer);
    for (const k of [...v.peers.keys()]) dropPeer(k, true);
    if (v.mic) { v.mic.stop(); v.mic = null; v.meters.delete('me'); }
    v.muted = true;
    const ch = v.ch;
    v.ch = null;
    v.members.clear();
    v.topic = '';
    v.label = '';
    v.status = 'idle';
    v.error = '';
    if (!quiet) chime(false);
    emit();
    if (ch) {
      try { await ch.untrack(); } catch (_) { /* канал уже закрито */ }
      try { await sb.removeChannel(ch); } catch (_) { /* те саме */ }
    }
  }

  const meta = () => ({ uid: me?.id, name, muted: v.muted, deaf: v.deaf });

  function onSync(ch) {
    if (ch !== v.ch) return;
    const st = ch.presenceState() || {};
    v.members = new Map(Object.entries(st).map(([k, arr]) => [k, arr[arr.length - 1] || {}]));
    if (v.members.has(v.key)) {
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
    if (!m || m.to !== v.key || !v.ch) return;
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
    const p = { pc, sender: null, audio, tries: v.peers.get(k)?.tries || 0, pendingIce: [], gaveUp: false };
    pc.onicecandidate = (e) => { if (e.candidate) send(k, { type: 'ice', cand: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] || new MediaStream([e.track]);
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
    await p.pc.setLocalDescription(await p.pc.createOffer());
    send(k, { type: 'offer', sdp: p.pc.localDescription.sdp });
  }

  function retryPeer(k) {
    const p = v.peers.get(k);
    if (!p || v.key > k) return; // перепідключає той, хто дзвонив
    if (p.tries >= RETRIES) { p.gaveUp = true; emit(); return; }
    const tries = p.tries + 1;
    setTimeout(async () => {
      if (!v.ch || !v.members.has(k) || v.peers.get(k) !== p) return;
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
    if (!p) return 'wait';
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
    if (!v.ch) return;
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

  function hear(on) {
    v.deaf = !on;
    v.peers.forEach((p) => { if (p.audio) p.audio.muted = !on; });
  }

  /** «Вимкнути звук» глушить і мікрофон, «Увімкнути» повертає його, як було (як у Discord). */
  async function setDeaf(deaf) {
    if (!v.ch) return;
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
    if (v.ch && v.status === 'live') v.ch.track(meta());
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

  /** Короткий звук, коли хтось зайшов або вийшов. */
  function chime(up) {
    const ctx = audioCtx();
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

  document.addEventListener('pointerdown', () => { audioCtx(); unlock(); }, true);
  document.addEventListener('keydown', unlock, true);
  window.addEventListener('pagehide', () => { if (v.ch) leave(true); });

  return {
    join,
    leave,
    toggleMic: () => setMuted(!v.muted),
    toggleDeaf: () => setDeaf(!v.deaf),
    unlock,
    get topic() { return v.topic; },
    get state() { return snapshot(); }
  };
}

/** Канал голосу для розмови: головна стрічка, кімната чату або діалог 1:1. */
export function voiceTopic(chan, myId) {
  if (chan.kind === 'main') return 'voice:all';
  if (chan.kind === 'room') return 'voice:room:' + chan.id;
  const [a, b] = [myId, chan.uid].sort();
  return `voice:dm:${a}:${b}`;
}
