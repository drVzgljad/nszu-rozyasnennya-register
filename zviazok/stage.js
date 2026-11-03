/**
 * «Сцена» показу екрана — ОДНА на два розділи: «Чат департаменту» (zviazok.js) і
 * кімнату в «Справах» (spravy/voice.js). Сама нічого не знає про WebRTC: отримує
 * знімок стану рушія ./voice.js (поле presenter) і малює відео того, хто показує.
 *
 *   const stage = createStage(host, { onStop: () => voice.toggleShare() });
 *   stage.update(voiceState);      // з onChange рушія
 *
 * Відео — один постійний <video>: srcObject міняємо, лише коли змінився потік,
 * інакше картинка блимала б на кожному перемальовуванні панелі. Свій показ не
 * дзеркалимо (тунель із вікон) — лише напис і «Зупинити показ». Стилі — тут же:
 * компонент самодостатній, кольори — з ролей теми порталу (--surface, --line…).
 */

const CSS = `
.pmg-stage { margin: 0 0 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface);
  color: var(--ink); overflow: hidden; }
.pmg-stage[hidden] { display: none; }
.pmg-stage-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; font-size: 14px;
  border-bottom: 1px solid var(--line); }
.pmg-stage-head strong { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmg-stage-dot { width: 9px; height: 9px; border-radius: 50%; background: #e5484d; flex: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, #e5484d 25%, transparent); }
.pmg-stage-btn { font: inherit; font-size: 13px; font-weight: 700; padding: 6px 10px; border-radius: 9px;
  border: 1px solid var(--line); background: var(--soft); color: var(--ink); cursor: pointer; white-space: nowrap; }
.pmg-stage-btn:hover { border-color: var(--accent); }
.pmg-stage-btn.is-stop { color: #fff; background: #c2383d; border-color: #c2383d; }
.pmg-stage-body { background: #0b0f17; display: grid; place-items: center; }
.pmg-stage-body[hidden] { display: none; }
.pmg-stage video { display: block; width: 100%; max-height: min(70vh, 720px); object-fit: contain; background: #0b0f17; }
.pmg-stage-wait { color: #cbd5e1; font-size: 13px; padding: 28px 12px; text-align: center; }
.pmg-stage-wait[hidden] { display: none; }
.pmg-stage-self { padding: 10px 12px; font-size: 13px; color: var(--muted); }
.pmg-stage-self[hidden] { display: none; }
`;

let styled = false;

export function createStage(host, { onStop = () => {} } = {}) {
  if (!styled) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
    styled = true;
  }
  host.classList.add('pmg-stage');
  host.hidden = true;
  host.setAttribute('aria-label', 'Показ екрана');
  host.innerHTML = `
    <div class="pmg-stage-head">
      <span class="pmg-stage-dot" aria-hidden="true"></span>
      <strong></strong>
      <button type="button" class="pmg-stage-btn" data-st="full" title="На весь екран">⛶ На весь екран</button>
      <button type="button" class="pmg-stage-btn" data-st="fold" aria-expanded="true">Згорнути</button>
      <button type="button" class="pmg-stage-btn is-stop" data-st="stop">⏹ Зупинити показ</button>
    </div>
    <div class="pmg-stage-body">
      <video autoplay playsinline muted></video>
      <p class="pmg-stage-wait">Чекаємо на зображення…</p>
    </div>
    <p class="pmg-stage-self">Колеги бачать ваш екран. Щоб показати інше вікно, зупиніть показ і почніть знову.</p>`;
  const q = (s) => host.querySelector(s);
  const video = q('video');
  let folded = false;
  let cur = null;   // поточний потік у <video>

  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    if (b.dataset.st === 'stop') onStop();
    if (b.dataset.st === 'full') (video.requestFullscreen || video.webkitRequestFullscreen)?.call(video);
    if (b.dataset.st === 'fold') {
      folded = !folded;
      b.textContent = folded ? 'Розгорнути' : 'Згорнути';
      b.setAttribute('aria-expanded', String(!folded));
      paint();
    }
  });
  video.addEventListener('playing', () => { q('.pmg-stage-wait').hidden = true; });

  let last = null;
  function paint() {
    const pr = last;
    host.hidden = !pr;
    if (!pr) return;
    q('strong').textContent = pr.me ? '🖥 Ви показуєте екран' : `🖥 ${pr.name || 'Колега'} показує екран`;
    q('[data-st="stop"]').hidden = !pr.me;
    q('[data-st="full"]').hidden = pr.me || folded;
    q('[data-st="fold"]').hidden = pr.me;
    q('.pmg-stage-self').hidden = !pr.me;
    q('.pmg-stage-body').hidden = pr.me || folded;
  }

  function update(state) {
    const pr = state?.presenter || null;
    last = pr;
    const stream = pr && !pr.me ? pr.stream : null;
    if (stream !== cur) {
      cur = stream;
      video.srcObject = stream;
      q('.pmg-stage-wait').hidden = !!(stream && !video.paused);
      if (stream) video.play().catch(() => {});
    }
    if (!pr) folded = false;
    paint();
  }

  return { update };
}
