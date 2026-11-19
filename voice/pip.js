/**
 * Міні-вікно голосу поверх УСІХ вікон (19.11.2026) — Document Picture-in-Picture (Chrome / Edge 116+).
 * Користувач: «зроби компактну, акуратненьку версію окошка голосового чату яка висить поверх всіх окон».
 *
 * Що в ньому: кімната й «в ефірі», кружечки учасників (ініціали; хто говорить — зелене кільце,
 * у кого вимкнено мікрофон — червона позначка), хто говорить зараз, кнопки мікрофона, звуку,
 * «повна панель» і «Вийти». Його відкриває голосове вікно, тож міні-вікно живе, поки триває розмова,
 * і не залежить від вкладок порталу. Закрили міні-вікно — розмова триває.
 *
 * Відкрити можна лише на клік (вимога браузера) — кнопка «📌 Міні-вікно поверх усіх» у голосовому вікні.
 * Де Chrome дозволяє автоматичний PiP для дзвінків (mediaSession 'enterpictureinpicture'), воно
 * вискакує саме, коли людина йде з голосового вікна в іншу програму.
 * Де Document PiP немає (Firefox, телефони) — бейдж «в ефірі» на сторінках порталу (auth-v2.js).
 */

const W = 284;
const H = 118;
const MAX_FACES = 7;

const CSS = `
:root{--bg:#ffffff;--ink:#1f3347;--muted:#647688;--line:#dbe6ee;--btn:#f2f6f9;--btn-h:#e6eef4;
  --on:#15803d;--on-bg:#dcfce7;--off:#b91c1c;--off-bg:#fee2e2;--live:#dc2626;--ring:#22c55e}
:root.dark{--bg:#111827;--ink:#f3f4f6;--muted:#9ca3af;--line:#2a3443;--btn:#1f2937;--btn-h:#283447;
  --on:#86efac;--on-bg:#14532d;--off:#fca5a5;--off-bg:#4c1414;--live:#ef4444;--ring:#4ade80}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:12.5px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  display:flex;flex-direction:column;justify-content:space-between;gap:6px;padding:8px 10px 9px;overflow:hidden;user-select:none}
.top{display:flex;align-items:center;gap:7px;min-width:0}
.dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--muted)}
.dot.on{background:var(--live);animation:p 1.8s ease-out infinite}
@keyframes p{0%{box-shadow:0 0 0 0 rgba(239,68,68,.55)}70%{box-shadow:0 0 0 6px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
.room{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.cnt{flex:none;color:var(--muted);font-variant-numeric:tabular-nums}
.faces{display:flex;align-items:center;gap:5px;min-height:30px}
.face{position:relative;flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;
  font-size:11px;font-weight:700;letter-spacing:.02em;color:#fff;transition:box-shadow .15s}
.face.me{outline:1.5px solid var(--ink);outline-offset:1.5px}
.face.sp{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--ring)}
.face.me.sp{outline-color:transparent}
.face .m{position:absolute;right:-3px;bottom:-3px;width:13px;height:13px;border-radius:50%;
  background:var(--off);border:2px solid var(--bg);display:grid;place-items:center}
.face .m::before{content:"";width:5px;height:1.5px;background:var(--bg);border-radius:1px}
.more{flex:none;height:30px;min-width:30px;padding:0 6px;border-radius:15px;display:grid;place-items:center;
  background:var(--btn);color:var(--muted);font-weight:600}
.empty{color:var(--muted)}
.bar{display:flex;align-items:center;gap:5px;min-width:0}
button{flex:none;height:28px;min-width:28px;padding:0 8px;border:1px solid var(--line);border-radius:14px;
  background:var(--btn);color:var(--ink);font:inherit;cursor:pointer;display:inline-grid;place-items:center}
button:hover{background:var(--btn-h)}
button:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
button.ic{padding:0;width:28px}
button.mic.on{background:var(--on-bg);border-color:transparent;color:var(--on)}
button.mic.off{background:var(--off-bg);border-color:transparent;color:var(--off)}
button.leave{background:var(--live);border-color:transparent;color:#fff;font-weight:600}
button.leave:hover{filter:brightness(1.08)}
button.wake{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--on-bg);color:var(--on);border-color:transparent}
.talk{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);padding:0 2px}
.talk b{color:var(--ink);font-weight:600}
svg{width:15px;height:15px;display:block}
@media (prefers-reduced-motion:reduce){.dot.on{animation:none}.face{transition:none}}
`;

// Іконки — рядками SVG, щоб не залежати від емодзі системи (у PiP вони різного розміру)
const I = {
  micOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/></svg>',
  ear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
  earOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 14v-2a8 8 0 0 1 12.5-6.6M20 12v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M3 3l18 18"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>'
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** «Ткач Олександр Іванович» → «ТО»; «Юлька» → «Ю». */
function initials(name) {
  const w = String(name || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}

/** Колір кружечка — сталий для людини (від імені), спокійний і читабельний з білими літерами. */
function hue(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h} 42% 46%)`;
}

/**
 * getState() → { inRoom, label, muted, deaf, count, speaking[], needGesture,
 *                members: [{ name, me, muted, sp }] };
 * act(cmd) — 'mic' | 'deaf' | 'leave' | 'focus' | 'wake'.
 */
export function createPip({ getState, act, onToggle = () => {} }) {
  const supported = typeof window.documentPictureInPicture !== 'undefined';
  let pw = null;
  let opening = null;
  let lastHtml = '';

  async function open() {
    if (!supported) return false;
    if (pw) return true;
    if (opening) return opening;
    opening = (async () => {
      try {
        pw = await window.documentPictureInPicture.requestWindow({ width: W, height: H, disallowReturnToOpener: true });
      } catch (_) { pw = null; return false; }
      const st = pw.document.createElement('style');
      st.textContent = CSS;
      pw.document.head.append(st);
      // Тема — та сама, що в голосовому вікні (а там — як на порталі)
      if (document.documentElement.classList.contains('dark-theme')) pw.document.documentElement.classList.add('dark');
      pw.document.documentElement.lang = 'uk';
      pw.document.title = 'Голос · НавігаторПМГ26';
      pw.document.body.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-pm]');
        if (b) act(b.dataset.pm);
      });
      pw.addEventListener('pagehide', () => { pw = null; lastHtml = ''; onToggle(false); });
      lastHtml = '';
      update();
      onToggle(true);
      return true;
    })();
    try { return await opening; } finally { opening = null; }
  }

  function facesHtml(list) {
    if (!list.length) return '<span class="empty">У кімнаті поки нікого</span>';
    // Себе — першим, далі ті, хто говорить, решта — як прийшли
    const sorted = [...list].sort((a, b) => (b.me - a.me) || (b.sp - a.sp));
    const shown = sorted.length > MAX_FACES ? sorted.slice(0, MAX_FACES - 1) : sorted;
    const rest = sorted.length - shown.length;
    return shown.map((m) => {
      const tip = `${m.name || 'Без імені'}${m.me ? ' (ви)' : ''}${m.muted ? ' · мікрофон вимкнено' : ''}${m.sp ? ' · говорить' : ''}`;
      return `<span class="face${m.me ? ' me' : ''}${m.sp ? ' sp' : ''}" style="background:${hue(m.name)}" title="${esc(tip)}">${esc(initials(m.name))}${m.muted ? '<i class="m"></i>' : ''}</span>`;
    }).join('') + (rest > 0 ? `<span class="more" title="${esc(sorted.slice(shown.length).map((m) => m.name).join(', '))}">+${rest}</span>` : '');
  }

  function update() {
    if (!pw) return;
    const s = getState();
    const list = s.members || [];
    const talk = s.needGesture
      ? '<button type="button" data-pm="wake" class="wake" title="Браузер приглушив звук — натисніть, щоб чути співрозмовників">🔊 Чути всіх</button>'
      : `<span class="talk" title="${esc(s.speaking?.length ? 'Говорить: ' + s.speaking.join(', ') : '')}">${s.speaking?.length
        ? `<b>${esc(s.speaking.slice(0, 2).join(', '))}</b>${s.speaking.length > 2 ? ` +${s.speaking.length - 2}` : ''}`
        : s.deaf ? 'Звук вимкнено' : s.muted ? 'Вас не чути' : s.inRoom ? 'Тиша' : 'Не в ефірі'}</span>`;
    const html = `<div class="top"><span class="dot${s.inRoom ? ' on' : ''}" title="${s.inRoom ? 'В ефірі' : 'Не в ефірі'}"></span>
        <span class="room" title="${esc(s.label)}">${esc(s.label)}</span>
        <span class="cnt" title="У кімнаті">${list.length || s.count || 0} 👤</span></div>
      <div class="faces">${facesHtml(list)}</div>
      <div class="bar">
        <button type="button" data-pm="mic" class="ic mic ${s.muted ? 'off' : 'on'}" title="${s.muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}" aria-label="${s.muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}">${s.muted ? I.micOff : I.micOn}</button>
        <button type="button" data-pm="deaf" class="ic" title="${s.deaf ? 'Увімкнути звук' : 'Вимкнути звук (і мікрофон)'}" aria-label="${s.deaf ? 'Увімкнути звук' : 'Вимкнути звук'}">${s.deaf ? I.earOff : I.ear}</button>
        ${talk}
        <button type="button" data-pm="focus" class="ic" title="Повна панель голосу" aria-label="Повна панель голосу">${I.full}</button>
        <button type="button" data-pm="leave" class="leave" title="Вийти з кімнати">Вийти</button>
      </div>`;
    if (html === lastHtml) return;
    lastHtml = html;
    pw.document.body.innerHTML = html;
  }

  /** Автоматичне міні-вікно, коли людина йде з голосового вікна (Chrome для дзвінків; деінде мовчки не спрацює). */
  try {
    navigator.mediaSession?.setActionHandler?.('enterpictureinpicture', () => { if (getState().inRoom) open(); });
  } catch (_) { /* браузер не знає такої дії */ }

  return {
    supported,
    open,
    update,
    close: () => { try { pw?.close(); } catch (_) { /* уже закрите */ } },
    get isOpen() { return !!pw; }
  };
}
