/**
 * Маркер «в ефірі» поверх УСІХ вікон (19.11.2026) — Document Picture-in-Picture (Chrome / Edge 116+).
 * Маленьке вікно: кімната, хто говорить, мікрофон, «Вийти». Його відкриває голосове вікно, тож маркер
 * живе, поки триває розмова, і не залежить від вкладок порталу. Закрили маркер — розмова триває.
 *
 * Відкрити можна лише на клік (вимога браузера) — кнопка «📌 Поверх усіх вікон». Де Chrome дозволяє
 * автоматичний PiP для дзвінків (mediaSession 'enterpictureinpicture'), маркер вискакує сам,
 * коли людина йде з голосового вікна в іншу програму.
 * Де Document PiP немає (Firefox, телефони) — бейдж «в ефірі» на сторінках порталу (auth-v2.js).
 */

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:#111827;color:#f3f4f6;font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  display:flex;flex-direction:column;justify-content:center;gap:6px;padding:8px 10px;overflow:hidden;user-select:none}
.row{display:flex;align-items:center;gap:8px;min-width:0}
.dot{flex:none;width:10px;height:10px;border-radius:50%;background:#6b7280}
.dot.on{background:#ef4444;box-shadow:0 0 0 0 rgba(239,68,68,.6);animation:p 1.6s ease-out infinite}
@keyframes p{70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
@media (prefers-reduced-motion:reduce){.dot.on{animation:none}}
.air{flex:none;font-weight:700;letter-spacing:.06em;color:#fca5a5;font-size:11px}
.room{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d1d5db}
.cnt{flex:none;color:#9ca3af}
.talk{min-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e5e7eb}
.talk i{font-style:normal;color:#9ca3af}
.talk b{color:#86efac;font-weight:600}
.btns{display:flex;gap:6px}
button{flex:1;min-width:0;padding:6px 6px;border:1px solid #374151;border-radius:8px;background:#1f2937;color:#f9fafb;
  font:inherit;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button:hover{border-color:#6b7280}
button.mic-on{background:#14532d;border-color:#22c55e}
button.mic-off{background:#450a0a;border-color:#ef4444}
button.icon{flex:none;width:36px}
button.leave{flex:none}
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** getState() → { inRoom, label, muted, deaf, count, speaking[], meSpeaking }; act(cmd) — 'mic' | 'deaf' | 'leave'. */
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
        pw = await window.documentPictureInPicture.requestWindow({ width: 300, height: 124 });
      } catch (_) { pw = null; return false; }
      const st = pw.document.createElement('style');
      st.textContent = CSS;
      pw.document.head.append(st);
      pw.document.title = 'В ефірі · НавігаторПМГ26';
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

  function update() {
    if (!pw) return;
    const s = getState();
    const talk = s.speaking?.length
      ? `🗣 <b>${esc(s.speaking.slice(0, 3).join(', '))}</b>${s.speaking.length > 3 ? ` <i>+${s.speaking.length - 3}</i>` : ''}`
      : s.deaf ? '<i>🔕 Звук вимкнено</i>' : s.muted ? '<i>Ваш мікрофон вимкнено — вас не чути</i>' : '<i>Тиша</i>';
    const html = `<div class="row"><span class="dot${s.inRoom ? ' on' : ''}"></span>
        <span class="air">${s.inRoom ? 'В ЕФІРІ' : 'НЕ В ЕФІРІ'}</span>
        <span class="room" title="${esc(s.label)}">${esc(s.label)}</span>
        <span class="cnt" title="У кімнаті">👥 ${s.count || 0}</span></div>
      <div class="talk">${talk}</div>
      <div class="btns">
        <button type="button" data-pm="mic" class="${s.muted ? 'mic-off' : 'mic-on'}" title="${s.muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}">${s.muted ? '🔇 Мікрофон вимк.' : '🎙 Мікрофон увімк.'}</button>
        <button type="button" data-pm="deaf" class="icon" title="${s.deaf ? 'Увімкнути звук' : 'Вимкнути звук (і мікрофон)'}">${s.deaf ? '🔕' : '🎧'}</button>
        <button type="button" data-pm="leave" class="leave" title="Вийти з кімнати">Вийти</button>
      </div>`;
    if (html === lastHtml) return;
    lastHtml = html;
    pw.document.body.innerHTML = html;
  }

  /** Автоматичний маркер, коли людина йде з вікна (Chrome для дзвінків; деінде мовчки не спрацює). */
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
