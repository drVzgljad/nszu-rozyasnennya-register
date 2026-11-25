/**
 * Вікно показу екрана (25.11.2026). Сам нічого не з'єднує: відео віддає голосове вікно, що його
 * відкрило (./screen-win.js), — викликом window.pmgShow({ name, stream } | null).
 *
 * Розмір вікна: «▁ Згорнути» — маленьке вікно в правому нижньому кутку, «▢ Розгорнути» — на весь
 * робочий стіл, «▭ Звичайне» — як було; «⛶ На весь екран» (F, подвійний клік) — повноекранний режим
 * браузера, вихід — Esc. Міняти розмір і місце браузер дозволяє лише вікну, яке відкрив скрипт, — це
 * саме такий випадок. Звичайне згортання вікна системою (кнопка «—» у рамці) теж працює.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const video = $('scVideo');
  const msg = $('scMsg');
  let cur = null;
  let size = 'normal';
  let normal = null;     // { x, y, w, h } — звичайне вікно, щоб повернутись
  let endTimer = 0;

  function say(text) { msg.textContent = text; msg.hidden = !text; }

  window.pmgShow = function (p) {
    clearTimeout(endTimer);
    if (!p || !p.stream) {
      cur = null;
      video.srcObject = null;
      document.title = '🖥 Показ завершено · НавігаторПМГ26';
      $('scWho').textContent = 'Показ завершено';
      say('Показ екрана завершено. Вікно закриється саме.');
      endTimer = setTimeout(() => window.close(), 2500);
      return;
    }
    $('scWho').textContent = `🖥 ${p.name || 'Колега'} показує екран`;
    document.title = `🖥 ${p.name || 'Колега'} · показ екрана`;
    if (cur !== p.stream) {
      cur = p.stream;
      video.srcObject = p.stream;
      say(video.readyState >= 2 ? '' : 'Чекаємо на зображення…');
      video.play().catch(() => {});
    }
  };
  video.addEventListener('playing', () => say(''));

  function area() {
    const s = window.screen;
    return { x: s.availLeft || 0, y: s.availTop || 0, w: s.availWidth || 1280, h: s.availHeight || 800 };
  }
  function place(x, y, w, h) {
    try { window.resizeTo(w, h); window.moveTo(x, y); } catch (_) { /* браузер не дав */ }
  }
  function setSize(next) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (size === 'normal') normal = { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight };
    const a = area();
    if (next === 'mini') {
      const w = Math.min(480, a.w), h = 300;
      place(a.x + a.w - w - 16, a.y + a.h - h - 16, w, h);
    } else if (next === 'max') {
      place(a.x, a.y, a.w, a.h);
    } else if (normal) {
      place(normal.x, normal.y, normal.w, normal.h);
    }
    size = next;
    document.body.classList.toggle('is-mini', size === 'mini');
    document.querySelector('[data-sc="normal"]').hidden = size === 'normal';
    document.querySelector('[data-sc="max"]').hidden = size === 'max';
    try { window.focus(); } catch (_) { /* браузер не дав */ }
  }

  function toggleFull() {
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => document.body.classList.toggle('is-full', !!document.fullscreenElement));

  $('scBar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sc]');
    if (!b) return;
    if (b.dataset.sc === 'full') toggleFull();
    else setSize(b.dataset.sc);
  });
  video.addEventListener('dblclick', toggleFull);
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFull();
  });

  // Голосове вікно закрили — показувати нічого
  setInterval(() => {
    if (!window.opener || window.opener.closed) {
      say('Голосове вікно закрито — показ недоступний.');
      setTimeout(() => window.close(), 1500);
    }
  }, 2000);

  try { window.opener?.__pmgScreen?.ready(window); } catch (_) { /* відкрили не з порталу */ }
  if (!window.opener) say('Це вікно відкривається саме, коли колега в голосовій кімнаті показує екран.');
})();
