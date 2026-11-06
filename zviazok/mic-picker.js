/**
 * Вікно «Мікрофон»: вибір пристрою й перевірка рівня (06.11.2026).
 * Спільне для «Чату департаменту» (zviazok.js) і кімнати «Справ» (spravy/voice.js) —
 * не копіюйте в розділи, підключайте звідси.
 *
 *   import { openMicPicker } from '../zviazok/mic-picker.js?v=…';
 *   openMicPicker(eng, { toast });   // eng — рушій voice.js (mics, setMic); у демо — null
 *
 * Навіщо: браузер бере «пристрій за замовчуванням» Windows, а Teams і месенджери —
 * свій вибір або «пристрій зв'язку». Тому «в Teams мене чують, а на порталі — ні».
 * Вікно відкриває власну пробну доріжку на вибраному пристрої й показує шкалу —
 * людина сама бачить, який мікрофон її чує. Пробна доріжка нікуди не передається.
 */

const CSS = `
.pmg-micpick{border:1px solid var(--line,#d6dbe1);border-radius:14px;padding:0;max-width:min(440px,calc(100vw - 32px));width:100%;
  background:var(--surface,#fff);color:var(--ink,#1d2733);box-shadow:var(--shadow,0 10px 40px rgba(0,0,0,.25))}
.pmg-micpick::backdrop{background:rgba(10,20,30,.45)}
.pmg-micpick form{margin:0;padding:18px 18px 14px;display:flex;flex-direction:column;gap:12px}
.pmg-micpick h2{margin:0;font-size:1.05rem}
.pmg-micpick p{margin:0;font-size:.86rem;line-height:1.45;color:var(--muted,#5b6775)}
.pmg-micpick ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:40vh;overflow:auto}
.pmg-micpick label{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line,#d6dbe1);border-radius:10px;cursor:pointer;font-size:.9rem;line-height:1.35}
.pmg-micpick label:has(input:checked){border-color:var(--accent,#1f6fd1);background:var(--accent-soft,rgba(31,111,209,.08))}
.pmg-micpick label small{display:block;color:var(--muted,#5b6775);font-size:.78rem}
.pmg-micpick input{margin-top:3px;accent-color:var(--accent,#1f6fd1)}
.pmg-micpick .mp-meter{height:10px;border-radius:6px;background:var(--soft,#eef1f4);overflow:hidden}
.pmg-micpick .mp-meter i{display:block;height:100%;width:0;background:var(--accent,#1f6fd1);transition:width .08s linear}
.pmg-micpick .mp-meter.is-ok i{background:#2e9d5b}
.pmg-micpick .mp-state{font-size:.84rem;min-height:1.2em}
.pmg-micpick .mp-state.is-bad{color:var(--warning-text,#9a5b00)}
.pmg-micpick .mp-state.is-ok{color:#2e9d5b}
.pmg-micpick .mp-btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.pmg-micpick button{font:inherit;font-size:.9rem;padding:8px 14px;border-radius:10px;border:1px solid var(--line,#d6dbe1);background:var(--surface,#fff);color:inherit;cursor:pointer}
.pmg-micpick button.mp-main{background:var(--accent,#1f6fd1);border-color:var(--accent,#1f6fd1);color:#fff}
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Назви службових пристроїв Chrome на Windows — людською мовою. */
function niceLabel(d, i) {
  const raw = d.label || `Мікрофон ${i + 1}`;
  const strip = (s) => s.replace(/^(Default|Communications|По умолчанию|За замовчуванням|Связь|Зв'язок)\s*-\s*/i, '');
  if (d.id === 'default') return { name: strip(raw), note: 'основний пристрій Windows — його браузер бере сам' };
  if (d.id === 'communications') return { name: strip(raw), note: 'пристрій зв\'язку Windows — його зазвичай бере Teams' };
  return { name: raw, note: '' };
}

let open = null;   // одне вікно на сторінку

export async function openMicPicker(eng, { toast = () => {} } = {}) {
  if (open) return;
  if (!navigator.mediaDevices?.getUserMedia) return toast('Цей браузер не дає вибрати мікрофон.', true);
  if (!document.getElementById('pmg-micpick-css')) {
    const st = document.createElement('style');
    st.id = 'pmg-micpick-css';
    st.textContent = CSS;
    document.head.append(st);
  }
  const dlg = document.createElement('dialog');
  dlg.className = 'pmg-micpick';
  dlg.setAttribute('aria-labelledby', 'pmgMicpickT');
  document.body.append(dlg);

  const st = { list: [], current: 'default', pick: '', test: null, ctx: null, an: null, raf: 0, heard: false, since: 0 };
  open = dlg;

  async function list() {
    if (eng?.mics) return eng.mics();
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const l = all.filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label }));
    return { list: l, current: 'default', labeled: l.some((d) => d.label) };
  }

  function stopTest() {
    cancelAnimationFrame(st.raf);
    st.test?.getTracks().forEach((t) => t.stop());
    st.test = null;
    st.an = null;
  }

  /** Пробна доріжка на вибраному пристрої + шкала рівня. */
  async function test(id) {
    stopTest();
    st.heard = false;
    st.since = performance.now();
    say('Скажіть щось — смужка має рухатися.');
    try {
      st.test = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(id && id !== 'default' ? { deviceId: { exact: id } } : {}) }
      });
    } catch (e) {
      return say(e?.name === 'NotReadableError' ? 'Цей мікрофон зайнятий іншою програмою.'
        : e?.name === 'NotAllowedError' ? 'Браузер не дав доступу: дозвольте мікрофон біля адресного рядка.'
        : 'Цей мікрофон не вмикається — оберіть інший.', 'bad');
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    st.ctx = st.ctx || new AC();
    st.ctx.resume?.().catch(() => {});
    st.an = st.ctx.createAnalyser();
    st.an.fftSize = 512;
    st.ctx.createMediaStreamSource(st.test).connect(st.an);
    const buf = new Uint8Array(512);
    const bar = dlg.querySelector('.mp-meter');
    const loop = () => {
      if (!st.an) return;
      st.an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; }
      const lv = Math.sqrt(sum / buf.length);
      bar.firstElementChild.style.width = Math.min(100, Math.round(lv * 400)) + '%';
      if (lv > 0.035 && !st.heard) {
        st.heard = true;
        bar.classList.add('is-ok');
        say('Чути! Цей мікрофон працює.', 'ok');
      } else if (!st.heard && performance.now() - st.since > 6000 && lv < 0.0008) {
        say('Звуку немає зовсім — найімовірніше, це не той мікрофон. Оберіть інший.', 'bad');
      }
      st.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function say(text, cls = '') {
    const el = dlg.querySelector('.mp-state');
    if (!el) return;
    el.textContent = text;
    el.className = 'mp-state' + (cls ? ' is-' + cls : '');
  }

  async function render() {
    const r = await list();
    st.list = r.list;
    st.current = r.current;
    if (!st.pick) st.pick = r.list.some((d) => d.id === r.current) ? r.current : (r.list[0]?.id || 'default');
    dlg.innerHTML = `<form method="dialog">
      <h2 id="pmgMicpickT">🎙 Мікрофон для голосу</h2>
      ${!r.labeled ? '<p>Браузер покаже назви мікрофонів, щойно ви дозволите доступ. Ми лише перевіримо рівень — звук нікуди не йде.</p>' : ''}
      ${r.list.length ? `<ul>${r.list.map((d, i) => {
        const n = niceLabel(d, i);
        return `<li><label><input type="radio" name="mic" value="${esc(d.id)}"${d.id === st.pick ? ' checked' : ''}>
          <span>${esc(n.name)}${d.id === st.current ? ' <small>зараз у голосі</small>' : ''}${n.note ? `<small>${esc(n.note)}</small>` : ''}</span></label></li>`;
      }).join('')}</ul>` : '<p>Мікрофонів не знайдено. Підключіть мікрофон або гарнітуру — список оновиться сам.</p>'}
      <div class="mp-meter" aria-hidden="true"><i></i></div>
      <p class="mp-state" role="status"></p>
      <p>У Teams вас чують, а тут ні? Оберіть той самий пристрій, що в Teams: часто це «пристрій зв'язку».</p>
      <div class="mp-btns">
        <button type="button" data-mp="cancel">Скасувати</button>
        <button type="submit" class="mp-main" data-mp="ok">Готово</button>
      </div></form>`;
    if (r.list.length) await test(st.pick);
    // Після першого дозволу назви з'являються — перемальовуємо один раз
    if (!r.labeled && r.list.length && st.test) {
      const r2 = await list();
      if (r2.labeled) { stopTest(); return render(); }
    }
  }

  function close() {
    stopTest();
    st.ctx?.close?.().catch(() => {});
    navigator.mediaDevices.removeEventListener?.('devicechange', onDevices);
    dlg.close();
    dlg.remove();
    open = null;
  }

  function onDevices() { stopTest(); render(); }

  dlg.addEventListener('change', (e) => {
    if (e.target.name !== 'mic') return;
    st.pick = e.target.value;
    test(st.pick);
  });
  dlg.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mp]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.mp === 'cancel') return close();
    const id = st.pick;
    stopTest();   // звільняємо пристрій, перш ніж рушій його візьме
    if (eng?.setMic && id !== st.current) {
      if (!(await eng.setMic(id))) return test(id);
      const n = niceLabel(st.list.find((d) => d.id === id) || { id, label: '' }, 0).name;
      toast(`🎙 Мікрофон: ${n}`);
    }
    close();
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  navigator.mediaDevices.addEventListener?.('devicechange', onDevices);

  dlg.showModal();
  await render();
}
