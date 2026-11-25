/**
 * Значок «В ефірі» (25.11.2026) — один вигляд для двох місць: компактне голосове вікно (voice-window.js)
 * і вікно поверх усіх програм (pip.js, Document Picture-in-Picture). Користувач: «лишив би тільки оце
 * маленьке, щоб було поверх усіх вікон: бачити, що ти в ефірі, і швидко ввімкнути чи вимкнути голос».
 *
 * Той самий вигляд, що й бейдж на сторінках порталу (auth-v2.js, .pmg-onair): темна «пігулка»,
 * червона точка, кімната, хто говорить, мікрофон, повна панель, вийти.
 * Кнопки мають data-pm: 'mic' | 'panel' | 'leave' | 'wake' | 'pin'. Обробляє той, хто вставив.
 */

export const PILL_CSS = `
.pill{--bg:#111827;--ink:#f3f4f6;--muted:#9ca3af;--line:#374151;--btn:#1f2937;--live:#ef4444;--on:#22c55e;
  display:flex;align-items:center;gap:8px;min-width:0;padding:6px 6px 6px 12px;background:var(--bg);color:var(--ink);
  font:13px/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;user-select:none}
.pill .dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--muted)}
.pill.is-live .dot{background:var(--live);animation:pill-p 1.6s ease-out infinite}
@keyframes pill-p{0%{box-shadow:0 0 0 0 rgba(239,68,68,.6)}70%{box-shadow:0 0 0 7px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
.pill .txt{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}
.pill .txt b{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.pill.is-live .txt b{color:#fca5a5}
.pill .room,.pill .talk{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill .room{color:var(--muted)}
.pill .talk{color:#86efac}
.pill button{flex:none;width:32px;height:32px;padding:0;border-radius:50%;border:1px solid var(--line);background:var(--btn);
  color:var(--ink);font:inherit;font-size:15px;line-height:1;cursor:pointer;display:inline-grid;place-items:center}
.pill button:hover{border-color:var(--muted)}
.pill button:focus-visible{outline:2px solid var(--on);outline-offset:1px}
.pill button.mic{width:40px;height:40px;background:#14532d;border-color:var(--on);color:#bbf7d0}
.pill.is-muted button.mic{background:#450a0a;border-color:var(--live);color:#fecaca}
.pill button.wake{width:auto;padding:0 10px;border-radius:16px;background:#14532d;border-color:var(--on);font-size:12.5px}
.pill button.pin{border-color:#38bdf8;color:#7dd3fc}
.pill svg{width:18px;height:18px;display:block}
@media (prefers-reduced-motion:reduce){.pill.is-live .dot{animation:none}}
`;

const MIC_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const MIC_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/></svg>';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * s — стан голосового вікна (voice-window.js state()): inRoom, status, label, muted, deaf, count, speaking[],
 * people[], needGesture. opts.pin — показати «📌 поверх усіх вікон».
 */
export function pillHTML(s, opts = {}) {
  const live = !!s.inRoom;
  const head = live ? 'В ефірі' : s.status === 'joining' || s.status === 'idle' ? 'Заходимо…' : s.status === 'error' ? 'Немає зв\'язку' : 'Не в ефірі';
  const talk = s.speaking?.length ? `🗣 ${s.speaking.slice(0, 2).join(', ')}${s.speaking.length > 2 ? ` +${s.speaking.length - 2}` : ''}` : '';
  const tip = `${s.label || ''}${s.people?.length ? ' — ' + s.people.join(', ') : ''}`;
  const micTip = s.deaf ? 'Звук вимкнено — увімкнути мікрофон і звук' : s.muted ? 'Мікрофон вимкнено — увімкнути' : 'Мікрофон увімкнено — вимкнути';
  return `<div class="pill${live ? ' is-live' : ''}${s.muted ? ' is-muted' : ''}" role="status">
    <span class="dot" aria-hidden="true"></span>
    <span class="txt" title="${esc(tip)}"><b>${head}</b><span class="room">${esc(s.label || 'Голос')}${s.count ? ` · 👥 ${s.count}` : ''}</span>${talk ? `<span class="talk">${esc(talk)}</span>` : ''}</span>
    ${s.needGesture ? '<button type="button" class="wake" data-pm="wake" title="Браузер приглушив звук — натисніть, щоб чути колег">🔊 Чути</button>' : ''}
    <button type="button" class="mic" data-pm="mic" aria-pressed="${!s.muted}" title="${micTip}" aria-label="${micTip}">${s.muted ? MIC_OFF : MIC_ON}</button>
    ${opts.pin ? '<button type="button" class="pin" data-pm="pin" title="Закріпити значок поверх усіх вікон і програм">📌</button>' : ''}
    <button type="button" data-pm="panel" title="Повна панель: хто в кімнаті, екран, дорадча кімната, нарада" aria-label="Повна панель">⤢</button>
    <button type="button" data-pm="leave" title="Вийти з голосової кімнати" aria-label="Вийти">✕</button>
  </div>`;
}
