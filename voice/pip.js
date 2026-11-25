/**
 * Значок голосу поверх УСІХ вікон і програм — Document Picture-in-Picture (Chrome / Edge 116+).
 * 19.11.2026 — перше міні-вікно з кружечками учасників; 25.11.2026 — лише значок «В ефірі»
 * (./pill.js): «головна функція візуальна — бачити, що ти в ефірі, і швидко ввімкнути чи вимкнути
 * голос. Головне, щоб воно було нагорі весь час».
 *
 * Відкрити можна лише кліком у голосовому вікні (вимога браузера): перший будь-який клік у ньому
 * закріплює значок сам (voice-window.js). Значок живе, поки відкрите голосове вікно, — те можна
 * згорнути. Де Chrome дозволяє автоматичний PiP для дзвінків (mediaSession 'enterpictureinpicture'),
 * значок вискакує й сам. Де Document PiP немає (Firefox, телефони) — бейдж на сторінках порталу.
 */
import { PILL_CSS, pillHTML } from './pill.js?v=20261125b';

const W = 340;
const H = 60;

/**
 * getState() — стан голосового вікна (див. pill.js); act(cmd) — 'mic' | 'panel' | 'leave' | 'wake'.
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
      st.textContent = PILL_CSS + 'html,body{margin:0;height:100%;overflow:hidden;background:#111827}.pill{height:100%}';
      pw.document.head.append(st);
      pw.document.documentElement.lang = 'uk';
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
    const html = pillHTML(getState());
    if (html === lastHtml) return;
    lastHtml = html;
    pw.document.body.innerHTML = html;
  }

  /** Автоматичний значок, коли людина йде з голосового вікна (Chrome для дзвінків; деінде мовчки не спрацює). */
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
