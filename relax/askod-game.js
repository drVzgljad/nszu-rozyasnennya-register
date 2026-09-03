/* Симулятор АСКОД — міні-гра
   Мета: опрацювати якомога більше документів за 60 секунд.
   АСКОД буде заважати вікнами помилок. 5 відкритих помилок = повне зависання.
   Результати зберігаються в Supabase (таблиця askod_scores, скрипт askod_leaderboard_setup.sql). */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

(() => {
  'use strict';

  const field = document.getElementById('askodField');
  if (!field) return;

  const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
  let sb = null;
  try { sb = (window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY))); } catch (e) { console.warn('АСКОД: Supabase недоступний', e); }

  const timeEl = document.getElementById('askodTime');
  const scoreEl = document.getElementById('askodScore');
  const errEl = document.getElementById('askodErrCount');
  const titleTextEl = document.getElementById('askodTitleText');
  const modal = document.getElementById('askodModal');
  const launchBtn = document.getElementById('askodLaunchBtn');
  const closeBtn = document.getElementById('askodCloseBtn');

  const GAME_TIME = 60;
  const MAX_ERRORS = 5;
  const DOC_LIFETIME = 3600;
  const BEST_KEY = 'askodBestScore';

  const DOC_TYPES = [
    { icon: '📄', name: 'Наказ (проєкт).doc', pts: 1, errChance: 0.3 },
    { icon: '📄', name: 'Службова записка.doc', pts: 1, errChance: 0.3 },
    { icon: '📄', name: 'Лист МОЗ (терміново).doc', pts: 1, errChance: 0.3 },
    { icon: '📄', name: 'Звіт за формою 37.doc', pts: 1, errChance: 0.3 },
    { icon: '📄', name: 'Протокол наради.doc', pts: 1, errChance: 0.3 },
    { icon: '📕', name: 'Постанова № 1808.pdf', pts: 1, errChance: 0.06 },
    { icon: '📕', name: 'Специфікація пакета.pdf', pts: 1, errChance: 0.06 },
    { icon: '📕', name: 'Скан із печаткою.pdf', pts: 1, errChance: 0.06 },
  ];

  const URGENT_DOC = { icon: '🔥', name: 'ДОРУЧЕННЯ! На вчора!', pts: 3, errChance: 0.4 };

  const ERROR_MESSAGES = [
    'Редактор документів перестав працювати. Він втомився.',
    'Файл .doc не завантажено. Спробуйте пізніше. Або ніколи.',
    'Зʼєднання з сервером втрачено. Сервер про це не знає.',
    'Несподівана помилка № 0x0000АСКОД. Дуже несподівана.',
    'Триває оновлення системи. Орієнтовний час: 2–3 години.',
    'Документ заблоковано іншим користувачем. Ким — таємниця.',
    'Сесію завершено. Ви занадто швидко працювали.',
    'ЕЦП не знайдено. Пошукайте під клавіатурою.',
    'PDF відкрився з першого разу. Це підозріло. Перевірте.',
    'Памʼять переповнена спогадами про паперовий документообіг.',
  ];

  const MOCK_REPLIES = [
    'Не допомогло',
    'Ви серйозно?',
    'ОК не працює',
    'Це АСКОД, змиріться',
    'Майже…',
    'Ні.',
    'Кличте техпідтримку',
  ];

  const SUPPORT_MESSAGES = [
    'Адміністратор на місці! Може, перезавантажимо сервер?',
    'Техпідтримка відповіла з першого разу. Запамʼятайте цей день.',
    'Знайдено вільного айтішника. Діяти швидко!',
    'Сервер погодився на перемовини. Вікно можливостей відкрито!',
  ];

  const RANKS = [
    { min: 25, text: '🏆 Легенда документообігу. Вас бачили у серверній зі свічкою.' },
    { min: 18, text: '🎖️ Начальник управління. АСКОД плаче, коли ви заходите.' },
    { min: 12, text: '⭐ Головний спеціаліст. Резолюції накладаються самі.' },
    { min: 7, text: '📋 Спеціаліст. Ви опанували головну навичку — кнопку «ОК».' },
    { min: 0, text: '🌱 Стажер. Цього разу АСКОД переміг. Він завжди перемагає.' },
  ];

  let running = false;
  let score = 0;
  let timeLeft = GAME_TIME;
  let openErrors = 0;
  let timers = [];

  const rnd = (min, max) => Math.random() * (max - min) + min;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function clearAllTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function updateHud() {
    timeEl.textContent = timeLeft;
    scoreEl.textContent = score;
    errEl.textContent = openErrors + '/' + MAX_ERRORS;
    errEl.classList.toggle('hud-danger', openErrors >= MAX_ERRORS - 1);
  }

  function placeRandomly(el, w, h) {
    const fw = field.clientWidth;
    const fh = field.clientHeight;
    el.style.left = Math.round(rnd(6, Math.max(7, fw - w - 6))) + 'px';
    el.style.top = Math.round(rnd(6, Math.max(7, fh - h - 6))) + 'px';
  }

  function floatScore(x, y, text) {
    const el = document.createElement('div');
    el.className = 'askod-float-score';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    field.appendChild(el);
    later(() => el.remove(), 800);
  }

  function spawnDoc() {
    if (!running) return;
    const isUrgent = Math.random() < 0.14;
    const type = isUrgent ? URGENT_DOC : pick(DOC_TYPES);

    const doc = document.createElement('button');
    doc.type = 'button';
    doc.className = 'askod-doc' + (isUrgent ? ' urgent' : '');
    doc.innerHTML = '<span class="doc-icon">' + type.icon + '</span><span>' + type.name + '</span>';
    placeRandomly(doc, 220, 44);
    field.appendChild(doc);

    const lifetime = isUrgent ? DOC_LIFETIME * 0.6 : DOC_LIFETIME;
    later(() => doc.classList.add('expiring'), lifetime - 900);
    const expireId = later(() => doc.remove(), lifetime);

    doc.addEventListener('click', () => {
      if (!running) return;
      clearTimeout(expireId);
      const x = doc.offsetLeft + doc.offsetWidth / 2;
      const y = doc.offsetTop;
      doc.remove();
      score += type.pts;
      floatScore(x, y, '+' + type.pts);
      if (Math.random() < type.errChance) spawnError();
      updateHud();
    });

    // Наступний документ — темп зростає з часом
    const progress = 1 - timeLeft / GAME_TIME;
    later(spawnDoc, rnd(1100 - 550 * progress, 1700 - 700 * progress));
  }

  function spawnError() {
    if (!running) return;
    openErrors++;
    updateHud();

    const win = document.createElement('div');
    win.className = 'askod-error';
    const msg = pick(ERROR_MESSAGES);
    const withWait = Math.random() < 0.4;
    win.innerHTML =
      '<div class="askod-error-titlebar"><span>АСКОД — Помилка</span><span>✖</span></div>' +
      '<div class="askod-error-body"><span class="err-icon">⚠️</span><span>' + msg + '</span></div>' +
      '<div class="askod-error-actions">' +
      (withWait ? '<button type="button" data-act="wait">Чекати</button>' : '') +
      '<button type="button" data-act="ok">ОК</button></div>';
    placeRandomly(win, 250, 130);
    field.appendChild(win);

    // Кнопки у вікні помилки не працюють. Це не баг, це реалізм.
    win.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      win.classList.remove('shake');
      void win.offsetWidth;
      win.classList.add('shake');
      btn.textContent = pick(MOCK_REPLIES);
    });

    if (openErrors >= MAX_ERRORS) {
      later(freezeGameOver, 350);
      return;
    }

    // АСКОД іноді глючить сам по собі
    if (Math.random() < 0.25) later(spawnError, rnd(2000, 4500));
  }

  /* Рідкісне вікно техпідтримки — єдине, що лікує помилки */
  function scheduleSupport(minMs, maxMs) {
    later(spawnSupport, rnd(minMs || 12000, maxMs || 20000));
  }

  function spawnSupport() {
    if (!running) return;
    const win = document.createElement('div');
    win.className = 'askod-support';
    win.innerHTML =
      '<div class="askod-support-titlebar"><span>🛠️ АСКОД — Технічна підтримка</span></div>' +
      '<div class="askod-error-body"><span class="err-icon">👨‍💻</span><span>' + pick(SUPPORT_MESSAGES) + '</span></div>' +
      '<div class="askod-error-actions"><button type="button" data-act="fix">🔄 Полагодити все</button></div>';
    placeRandomly(win, 260, 140);
    field.appendChild(win);

    // Вікно можливостей дуже коротке — не проґавте
    const lifeId = later(() => {
      win.remove();
      scheduleSupport();
    }, 2500);

    win.querySelector('[data-act="fix"]').addEventListener('click', () => {
      if (!running) return;
      clearTimeout(lifeId);
      const errs = field.querySelectorAll('.askod-error');
      const fixed = errs.length;
      errs.forEach((el) => el.remove());
      openErrors = 0;
      if (fixed > 0) {
        score += fixed;
        floatScore(win.offsetLeft + 40, win.offsetTop, '+' + fixed + ' 🛠️');
      }
      win.remove();
      updateHud();
      scheduleSupport();
    });
  }

  function tick() {
    if (!running) return;
    timeLeft--;
    updateHud();
    if (timeLeft <= 0) {
      endGame(false);
      return;
    }
    later(tick, 1000);
  }

  function getRank(s) {
    for (const r of RANKS) if (s >= r.min) return r.text;
    return RANKS[RANKS.length - 1].text;
  }

  function readBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch { return 0; }
  }

  function saveBest(s) {
    try {
      if (s > readBest()) localStorage.setItem(BEST_KEY, String(s));
    } catch { /* приватний режим — і так зійде */ }
  }

  function clearField() {
    field.querySelectorAll('.askod-doc, .askod-error, .askod-support, .askod-float-score, .askod-overlay').forEach((el) => el.remove());
  }

  function showOverlay({ title, lines, rank, bsod, btnText }) {
    const ov = document.createElement('div');
    ov.className = 'askod-overlay' + (bsod ? ' bsod' : '');
    let html = '<h3>' + title + '</h3>';
    for (const l of lines) html += '<p>' + l + '</p>';
    if (rank) html += '<div class="askod-rank">' + rank + '</div>';
    html += '<div class="askod-best">🏅 Рекорд кабінету: ' + readBest() + '</div>';
    html += '<div class="askod-overlay-actions">';
    html += '<button type="button" id="askodRestart">' + (btnText || (bsod ? 'Ctrl+Alt+Del (грати ще)' : '▶️ Нова зміна')) + '</button>';
    html += '<button type="button" id="askodLbBtn" class="secondary">🏆 Таблиця лідерів</button>';
    html += '</div>';
    ov.innerHTML = html;
    field.appendChild(ov);
    ov.querySelector('#askodRestart').addEventListener('click', startGame);
    ov.querySelector('#askodLbBtn').addEventListener('click', showLeaderboard);
  }

  /* ---------- Таблиця лідерів (Supabase) ---------- */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MEDALS = ['🥇', '🥈', '🥉'];

  async function submitScore(s) {
    if (!sb) return { msg: '⚠️ Supabase недоступний — результат лишився тільки в кабінеті.' };
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return { msg: '🔑 Увійдіть на сайт, щоб змагатися за свій відділ!' };
      const { error } = await sb.from('askod_scores').insert({ user_id: user.id, score: s });
      if (error) throw error;
      return { msg: '🏆 Результат записано до таблиці лідерів!' };
    } catch (e) {
      const m = String((e && e.message) || e);
      if (m.includes('Занадто часто')) return { msg: '⏳ Занадто часто — цей результат не зараховано.' };
      if (m.includes('does not exist') || m.includes('schema cache')) return { msg: '⚠️ Таблицю лідерів ще не створено в Supabase.' };
      return { msg: '⚠️ Не вдалося зберегти: ' + esc(m) };
    }
  }

  function renderPeople(rows) {
    let h = '<div class="askod-lb-col"><h4>🎖️ Співробітники</h4><table class="askod-lb-table"><thead><tr><th></th><th>Хто</th><th>Рекорд</th></tr></thead><tbody>';
    rows.forEach((r, i) => {
      h += '<tr><td>' + (MEDALS[i] || (i + 1)) + '</td><td>' + esc(r.full_name) +
        '<span class="lb-dept">' + esc(r.department) + ' · ігор: ' + r.games_played + '</span></td>' +
        '<td class="lb-score">' + r.best_score + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function renderDepts(rows) {
    let h = '<div class="askod-lb-col"><h4>🏢 Відділи</h4><table class="askod-lb-table"><thead><tr><th></th><th>Відділ</th><th>Разом</th></tr></thead><tbody>';
    rows.forEach((r, i) => {
      h += '<tr><td>' + (MEDALS[i] || (i + 1)) + '</td><td>' + esc(r.department) +
        '<span class="lb-dept">гравців: ' + r.players + ' · кращий: ' + r.top_score + '</span></td>' +
        '<td class="lb-score">' + r.total_score + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  async function showLeaderboard() {
    clearField();
    const ov = document.createElement('div');
    ov.className = 'askod-overlay askod-lb';
    ov.innerHTML = '<h3>🏆 Дошка пошани документообігу</h3><p>Завантаження… (не хвилюйтеся, це не АСКОД — це швидко)</p>';
    field.appendChild(ov);

    let body = '';
    try {
      if (!sb) throw new Error('Supabase недоступний');
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        body = '<p>🔑 Таблиця лідерів доступна після входу на сайт. Увійдіть — і змагайтеся за честь свого відділу!</p>';
      } else {
        const [people, depts] = await Promise.all([
          sb.from('askod_leaderboard').select('*').order('best_score', { ascending: false }).limit(10),
          sb.from('askod_dept_leaderboard').select('*').order('total_score', { ascending: false }).limit(10),
        ]);
        if (people.error) throw people.error;
        if (depts.error) throw depts.error;
        if (!people.data || !people.data.length) {
          body = '<p>Поки що порожньо. Станьте першою легендою документообігу!</p>';
        } else {
          body = '<div class="askod-lb-grid">' + renderPeople(people.data) + renderDepts(depts.data || []) + '</div>';
        }
      }
    } catch (e) {
      const m = String((e && e.message) || e);
      body = '<p>' + ((m.includes('does not exist') || m.includes('schema cache'))
        ? '⚠️ Таблицю лідерів ще не створено в Supabase — виконайте скрипт askod_leaderboard_setup.sql.'
        : '⚠️ Не вдалося завантажити: ' + esc(m)) + '</p>';
    }

    if (!ov.isConnected) return; // поки вантажилося, екран уже змінили
    ov.innerHTML = '<h3>🏆 Дошка пошани документообігу</h3>' + body +
      '<div class="askod-overlay-actions"><button type="button" id="askodLbBack">⬅️ Назад</button></div>';
    ov.querySelector('#askodLbBack').addEventListener('click', showStartScreen);
  }

  function endGame(frozen) {
    running = false;
    clearAllTimers();
    saveBest(score);
    titleTextEl.textContent = 'АСКОД — Автоматизована система документообігу';
    field.querySelectorAll('.askod-doc, .askod-error, .askod-support, .askod-float-score').forEach((el) => el.remove());

    const saveLine = '<span id="askodSaveStatus" class="askod-save-status">💾 Зберігаю результат…</span>';

    if (frozen) {
      showOverlay({
        bsod: true,
        title: ':( АСКОД остаточно завис',
        lines: [
          'Відкрито забагато вікон помилок. Система пішла думати про вічне.',
          'Встигли опрацювати документів: ' + score + '.',
          'Зверніться до технічної підтримки. Вона теж чекає на відповідь від АСКОД.',
          saveLine,
        ],
        rank: getRank(score),
      });
    } else {
      showOverlay({
        title: '🔔 Робочу зміну завершено!',
        lines: ['Опрацьовано документів: <b>' + score + '</b>. АСКОД пережив цей день. Ви теж.', saveLine],
        rank: getRank(score),
      });
    }

    if (score > 0) {
      submitScore(score).then((res) => {
        const el = document.getElementById('askodSaveStatus');
        if (el) el.innerHTML = res.msg;
      });
    } else {
      const el = document.getElementById('askodSaveStatus');
      if (el) el.textContent = 'Нуль документів — нема чого записувати. Буває.';
    }
  }

  function freezeGameOver() {
    if (!running) return;
    endGame(true);
  }

  function startGame() {
    clearAllTimers();
    clearField();
    running = true;
    score = 0;
    timeLeft = GAME_TIME;
    openErrors = 0;
    titleTextEl.textContent = 'АСКОД — Автоматизована система документообігу (не відповідає)';
    updateHud();
    later(tick, 1000);
    spawnDoc();
    later(() => { if (running) spawnError(); }, rnd(3000, 6000));
    scheduleSupport(8000, 14000);
  }

  function showStartScreen() {
    clearField();
    showOverlay({
      title: '🗂️ Симулятор АСКОД',
      lines: [
        'Клацайте саме 📕 PDF-файли — вони майже не глючать. Від 📄 .doc АСКОД регулярно падає (ви знаєте, про що ми). За 🔥 термінові — потрійні бали!',
        'Помилки АСКОД закрити кнопкою «ОК» неможливо (а ви як думали?). Їх лікує лише рідкісне вікно 🛠️ техпідтримки — клацніть «Полагодити все», поки воно не зникло! Пʼять відкритих помилок — і система зависне остаточно.',
        'У вас 60 секунд робочої зміни. Хай щастить!',
      ],
      btnText: '▶️ Почати зміну',
    });
  }

  function openModal() {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    showStartScreen();
  }

  function closeModal() {
    running = false;
    clearAllTimers();
    clearField();
    modal.classList.remove('open');
    document.body.style.overflow = '';
    titleTextEl.textContent = 'АСКОД — Автоматизована система документообігу';
  }

  // Запуск «АСКОД.exe» — з обов'язковим фейковим завантаженням
  const LOADING_STEPS = ['Завантаження…', 'Підключення до сервера…', 'Сервер думає…'];
  launchBtn.addEventListener('click', () => {
    if (launchBtn.disabled) return;
    launchBtn.disabled = true;
    const hint = launchBtn.querySelector('.askod-launch-hint');
    const originalHint = hint.textContent;
    let step = 0;
    hint.textContent = LOADING_STEPS[0];
    const loadInterval = setInterval(() => {
      step++;
      if (step < LOADING_STEPS.length) {
        hint.textContent = LOADING_STEPS[step];
      } else {
        clearInterval(loadInterval);
        hint.textContent = originalHint;
        launchBtn.disabled = false;
        openModal();
      }
    }, 700);
  });

  closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });
})();
