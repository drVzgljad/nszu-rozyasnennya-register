/* «Моя чудова Квіточка» — гра-догляд за орхідеєю
   60 секунд: орхідея показує, чого хоче, — швидко натисніть правильну кнопку догляду
   (мишею або клавішами 1–6). Правильно — квітка розквітає і росте комбо.
   Неправильно чи запізно — вʼяне. Головна пастка, як у житті: перелив.
   Результати — в Supabase (orchid_scores, скрипт orchid_leaderboard_setup.sql). */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

(() => {
  'use strict';

  const field = document.getElementById('orchidField');
  if (!field) return;

  const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
  let sb = null;
  try {
    sb = window.__relaxSb || (window.__relaxSb = createClient(SUPABASE_URL, SUPABASE_KEY));
  } catch (e) { console.warn('Оранжерея: Supabase недоступний', e); }

  const stageEl = document.getElementById('orchidStage');
  const timeEl = document.getElementById('orchidTime');
  const scoreEl = document.getElementById('orchidScore');
  const comboEl = document.getElementById('orchidCombo');
  const healthFill = document.getElementById('orchidHealthFill');
  const actionsEl = document.getElementById('orchidActions');
  const modal = document.getElementById('orchidModal');
  const launchBtn = document.getElementById('orchidLaunchBtn');
  const closeBtn = document.getElementById('orchidCloseBtn');
  const soundBtn = document.getElementById('orchidSoundBtn');

  const GAME_TIME = 60;
  const MAX_HEALTH = 100;
  const BEST_KEY = 'orchidBestScore';
  const SOUND_KEY = 'orchidSound';

  const NEEDS = [
    { id: 'water', icon: '💧', text: 'Хочу пити!', btnIcon: '🚿', btnLabel: 'Полити' },
    { id: 'light', icon: '☀️', text: 'Мені мало світла…', btnIcon: '🪟', btnLabel: 'До вікна' },
    { id: 'warm', icon: '🥶', text: 'Змерзла від кондиціонера!', btnIcon: '🧣', btnLabel: 'Зігріти' },
    { id: 'air', icon: '🥵', text: 'Душно, дихати нічим!', btnIcon: '💨', btnLabel: 'Провітрити' },
    { id: 'bug', icon: '🐛', text: 'Ой! Шкідники!', btnIcon: '🧴', btnLabel: 'Обприскати' },
    { id: 'love', icon: '🥺', text: 'Щось мені сумно…', btnIcon: '💬', btnLabel: 'Комплімент' },
  ];

  const COMPLIMENTS = [
    'Ти окраса всього кабінету!',
    'Красуня ти наша!',
    'Цвіти, як бюджет у грудні!',
    'Ти краща за всі KPI разом узяті!',
    'Директорка тобою пишається!',
    'Жодна нарада без тебе не та!',
  ];

  const WRONG_MSGS = {
    water: '🚱 Перелив! Головний ворог орхідей — надмірна турбота!',
    light: '🕶️ Їй і так світло. Листя злякалось.',
    warm: '🥵 Заспекотно! Орхідея спітніла.',
    air: '🌬️ Протяг! Бутони тремтять від обурення.',
    bug: '🧴 Обприскали без потреби. Орхідея закашлялась.',
    love: '😐 Комплімент невчасно. Прозвучало підозріло.',
  };

  const RANKS = [
    { min: 200, text: '👑 Директорка орхідей. Сама пані директорка аплодує стоячи!' },
    { min: 150, text: '🌸 Фея оранжереї. Квіти шепочуть ваше імʼя.' },
    { min: 100, text: '🌿 Знавець фаленопсисів. Орхідеї вас поважають.' },
    { min: 50, text: '💧 Дбайливий садівник. Лійка в надійних руках.' },
    { min: 0, text: '🌱 Стажер оранжереї. Орхідея вижила — і це вже перемога.' },
  ];

  // Позиції квіток на стеблах (у відсотках від контейнера рослини)
  const BLOOM_SPOTS = [
    { x: 36, y: 40, s: 30 }, { x: 62, y: 33, s: 32 }, { x: 27, y: 28, s: 28 },
    { x: 70, y: 21, s: 30 }, { x: 44, y: 17, s: 34 }, { x: 57, y: 9, s: 30 },
    { x: 23, y: 15, s: 26 }, { x: 77, y: 10, s: 28 }, { x: 49, y: 2, s: 32 },
    { x: 34, y: 6, s: 26 },
  ];

  // Палітри пелюсток: [пелюстки, серединка]
  const BLOOM_COLORS = [
    ['#f472b6', '#fdf2f8'], ['#c084fc', '#f5f3ff'], ['#fb7185', '#fff1f2'],
    ['#e879f9', '#fdf4ff'], ['#f9a8d4', '#fff'],
  ];

  let running = false;
  let score = 0;
  let health = MAX_HEALTH;
  let combo = 0;
  let timeLeft = GAME_TIME;
  let activeNeeds = [];
  let timers = [];
  let plantEl = null;
  let stats = { hits: 0, wrongs: 0, missed: 0, maxCombo: 0 };

  const rnd = (min, max) => Math.random() * (max - min) + min;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function clearAllTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  /* ---------- Звук (WebAudio, делікатні дзвіночки) ---------- */

  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== '0'; } catch { /* ок */ }
  let audioCtx = null;

  function blip(freq, dur, type, gain) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.05, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (dur || 0.1));
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + (dur || 0.1));
    } catch { /* без звуку теж гра */ }
  }

  const sndGood = () => blip(520 + Math.min(combo, 8) * 45, 0.12);
  const sndBad = () => blip(150, 0.18, 'square', 0.035);
  const sndEnd = () => { blip(523, 0.15); setTimeout(() => blip(784, 0.25), 140); };

  function updateSoundBtn() {
    if (soundBtn) soundBtn.textContent = soundOn ? '🔊' : '🔇';
  }

  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      try { localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); } catch { /* ок */ }
      updateSoundBtn();
      if (soundOn) blip(660, 0.08);
    });
    updateSoundBtn();
  }

  /* ---------- HUD ---------- */

  function bump(el) {
    const chip = el.closest('.hud-chip') || el;
    chip.classList.remove('bump');
    void chip.offsetWidth;
    chip.classList.add('bump');
  }

  function updateHud() {
    timeEl.textContent = timeLeft;
    scoreEl.textContent = score;
    comboEl.textContent = combo > 1 ? 'x' + combo : '—';
    const pct = Math.max(0, health);
    healthFill.style.width = pct + '%';
    healthFill.classList.toggle('low', pct < 35);
  }

  /* ---------- Рослина ---------- */

  function bloomSvg(spot) {
    const [petal, center] = pick(BLOOM_COLORS);
    let petals = '';
    for (let a = 0; a < 360; a += 72) {
      petals += '<ellipse rx="6.2" ry="12" cy="-9" fill="' + petal + '" transform="rotate(' + (a + rnd(-8, 8)) + ')"/>';
    }
    return '<svg viewBox="-21 -21 42 42" width="' + spot.s + '" height="' + spot.s + '" aria-hidden="true"><g>' +
      petals +
      '<circle r="5" fill="' + center + '"/>' +
      '<circle r="2.4" fill="#fbbf24"/>' +
      '</g></svg>';
  }

  function renderPlant() {
    stageEl.querySelectorAll('.orchid-plant').forEach((el) => el.remove());
    plantEl = document.createElement('div');
    plantEl.className = 'orchid-plant';
    let inner =
      '<svg viewBox="0 0 240 300" aria-hidden="true">' +
      '<defs>' +
      '<linearGradient id="orchPot" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#d97a48"/><stop offset="1" stop-color="#a85327"/></linearGradient>' +
      '<linearGradient id="orchStem" x1="0" y1="1" x2="0" y2="0">' +
      '<stop offset="0" stop-color="#4d7c2a"/><stop offset="1" stop-color="#77b34c"/></linearGradient>' +
      '</defs>' +
      // горщик
      '<path d="M85 258 L155 258 L147 296 L93 296 Z" fill="url(#orchPot)"/>' +
      '<rect x="78" y="250" width="84" height="12" rx="6" fill="#c2703e"/>' +
      '<rect x="78" y="250" width="84" height="5" rx="2.5" fill="#e3925f"/>' +
      // мох
      '<ellipse cx="120" cy="252" rx="36" ry="5" fill="#65803a"/>' +
      // листя
      '<path d="M118 252 C68 242 52 210 60 194 C92 198 112 224 118 252 Z" fill="#3f9142"/>' +
      '<path d="M122 252 C172 240 186 206 178 192 C148 196 128 222 122 252 Z" fill="#4caf50"/>' +
      '<path d="M116 252 C90 236 86 214 92 202 C112 210 118 234 116 252 Z" fill="#57b85c"/>' +
      '<path d="M124 252 C150 238 156 216 150 204 C130 212 124 234 124 252 Z" fill="#49a34e"/>' +
      // стебла
      '<path d="M120 252 C118 200 103 158 86 94" stroke="url(#orchStem)" stroke-width="5.5" fill="none" stroke-linecap="round"/>' +
      '<path d="M122 252 C128 196 144 148 160 56" stroke="url(#orchStem)" stroke-width="5.5" fill="none" stroke-linecap="round"/>' +
      '<path d="M121 220 C112 190 100 170 92 150" stroke="url(#orchStem)" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '</svg>';
    for (let i = 0; i < BLOOM_SPOTS.length; i++) {
      const s = BLOOM_SPOTS[i];
      inner += '<span class="orchid-bloom" data-bloom="' + i + '" style="left:' + s.x + '%;top:' + s.y +
        '%;animation-delay:' + Math.round(rnd(0, 2000)) + 'ms">' + bloomSvg(s) + '</span>';
    }
    plantEl.innerHTML = '<div class="orchid-inner">' + inner + '</div>';
    stageEl.appendChild(plantEl);
  }

  function bloomsCount() {
    return Math.min(BLOOM_SPOTS.length, Math.floor(score / 20));
  }

  function updateBlooms() {
    if (!plantEl) return;
    const visible = bloomsCount();
    plantEl.querySelectorAll('.orchid-bloom').forEach((el, i) => {
      el.classList.toggle('visible', i < visible);
    });
  }

  function hurtPlant() {
    if (!plantEl) return;
    plantEl.classList.remove('hurt');
    void plantEl.offsetWidth;
    plantEl.classList.add('hurt');
  }

  function sparkleBurst() {
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('span');
      s.className = 'orchid-sparkle';
      s.textContent = '✨';
      s.style.left = rnd(28, 70) + '%';
      s.style.top = rnd(15, 60) + '%';
      s.style.animationDelay = (i * 70) + 'ms';
      stageEl.appendChild(s);
      later(() => s.remove(), 1000 + i * 70);
    }
  }

  /* ---------- Повідомлення ---------- */

  function toast(text, good) {
    stageEl.querySelectorAll('.orchid-toast').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'orchid-toast' + (good ? ' good' : '');
    el.textContent = text;
    stageEl.appendChild(el);
    later(() => el.remove(), 1600);
  }

  function floatScore(text) {
    const el = document.createElement('div');
    el.className = 'orchid-float-score';
    el.textContent = text;
    el.style.left = rnd(38, 58) + '%';
    el.style.top = '36%';
    stageEl.appendChild(el);
    later(() => el.remove(), 850);
  }

  /* ---------- Потреби ---------- */

  function needLifetime() {
    // Поступово меншає: 3800 мс на старті → ~2700 мс наприкінці
    return Math.round(3800 - (1 - timeLeft / GAME_TIME) * 1100);
  }

  function maxConcurrent() {
    return timeLeft > 30 ? 1 : 2;
  }

  function spawnNeed() {
    if (!running) return;
    if (activeNeeds.length < maxConcurrent()) {
      const taken = activeNeeds.map((n) => n.def.id);
      const def = pick(NEEDS.filter((n) => !taken.includes(n.id)));
      const el = document.createElement('div');
      const slot = activeNeeds.some((n) => n.slot === 'left') ? 'right' : 'left';
      el.className = 'orchid-need slot-' + slot;
      const life = needLifetime();
      el.innerHTML =
        '<span class="need-icon">' + def.icon + '</span>' +
        '<span class="need-body"><span>' + def.text + '</span>' +
        '<span class="need-timer"><span class="need-timer-fill" style="animation-duration:' + life + 'ms"></span></span></span>';
      stageEl.appendChild(el);

      const need = { def, el, slot };
      need.urgentId = later(() => el.classList.add('urgent'), Math.round(life * 0.55));
      need.expireId = later(() => missNeed(need), life);
      activeNeeds.push(need);
    }
    later(spawnNeed, rnd(1500, 2900));
  }

  function removeNeed(need) {
    clearTimeout(need.expireId);
    clearTimeout(need.urgentId);
    need.el.remove();
    activeNeeds = activeNeeds.filter((n) => n !== need);
  }

  function missNeed(need) {
    if (!running) return;
    removeNeed(need);
    combo = 0;
    health -= 14;
    stats.missed++;
    hurtPlant();
    sndBad();
    toast(need.def.icon + ' Проґавили! Орхідея образилась.');
    updateHud();
    checkWilted();
  }

  function handleCare(careId) {
    if (!running) return;
    const need = activeNeeds.find((n) => n.def.id === careId);
    if (need) {
      removeNeed(need);
      combo++;
      stats.hits++;
      stats.maxCombo = Math.max(stats.maxCombo, combo);
      const pts = 10 + Math.min(combo - 1, 5);
      score += pts;
      sndGood();
      floatScore('+' + pts + (combo > 1 ? ' 🔥' : ''));
      bump(scoreEl);
      if (careId === 'love') toast('💬 «' + pick(COMPLIMENTS) + '»', true);
      else if (combo >= 3) toast('🔥 Серія x' + combo + '! Орхідея сяє!', true);
      if (combo >= 3) sparkleBurst();
      updateBlooms();
    } else {
      combo = 0;
      stats.wrongs++;
      health -= careId === 'water' ? 12 : 8;
      hurtPlant();
      sndBad();
      toast(WRONG_MSGS[careId] || 'Орхідея цього не просила!');
      checkWilted();
    }
    updateHud();
  }

  function checkWilted() {
    if (health <= 0 && running) {
      if (plantEl) plantEl.classList.add('wilted');
      later(() => endGame(true), 500);
    }
  }

  /* ---------- Хід гри ---------- */

  function tick() {
    if (!running) return;
    timeLeft--;
    updateHud();
    if (timeLeft <= 0) {
      endGame(false);
      return;
    }
    if (timeLeft <= 5) blip(880, 0.05, 'sine', 0.02);
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
    try { if (s > readBest()) localStorage.setItem(BEST_KEY, String(s)); } catch { /* нехай */ }
  }

  function clearOverlays() {
    field.querySelectorAll('.orchid-overlay').forEach((el) => el.remove());
  }

  function clearGameElements() {
    activeNeeds.forEach((n) => { clearTimeout(n.expireId); clearTimeout(n.urgentId); });
    activeNeeds = [];
    stageEl.querySelectorAll('.orchid-need, .orchid-toast, .orchid-float-score, .orchid-sparkle').forEach((el) => el.remove());
  }

  function petalRain(ov) {
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('span');
      p.className = 'orchid-petal';
      p.textContent = pick(['🌸', '🌺', '💮']);
      p.style.left = rnd(2, 94) + '%';
      p.style.animationDuration = rnd(2.6, 4.8) + 's';
      p.style.animationDelay = rnd(0, 2) + 's';
      p.style.fontSize = rnd(14, 24) + 'px';
      ov.appendChild(p);
    }
  }

  function statsHtml() {
    const total = stats.hits + stats.wrongs + stats.missed;
    const acc = total ? Math.round((stats.hits / total) * 100) : 0;
    return '<div class="orchid-stats">' +
      '<div class="stat"><b>' + score + '</b><span>балів</span></div>' +
      '<div class="stat"><b>' + bloomsCount() + '/10</b><span>квіток</span></div>' +
      '<div class="stat"><b>x' + stats.maxCombo + '</b><span>макс. серія</span></div>' +
      '<div class="stat"><b>' + acc + '%</b><span>точність</span></div>' +
      '</div>';
  }

  function showOverlay({ title, lines, rank, btnText, lb, petals, statsBlock }) {
    const ov = document.createElement('div');
    ov.className = 'orchid-overlay' + (lb ? ' orchid-lb' : '');
    let html = '<h3>' + title + '</h3>';
    for (const l of lines) html += '<p>' + l + '</p>';
    if (statsBlock) html += statsHtml();
    if (rank) html += '<div class="orchid-rank">' + rank + '</div>';
    html += '<div class="orchid-best">🏅 Рекорд кабінету: ' + readBest() + '</div>';
    html += '<div class="orchid-overlay-actions">';
    html += '<button type="button" id="orchidRestart">' + (btnText || '🌸 Доглядати ще') + '</button>';
    html += '<button type="button" id="orchidLbBtn" class="secondary">🏆 Оранжерея слави</button>';
    html += '</div>';
    ov.innerHTML = html;
    field.appendChild(ov);
    if (petals) petalRain(ov);
    ov.querySelector('#orchidRestart').addEventListener('click', startGame);
    ov.querySelector('#orchidLbBtn').addEventListener('click', showLeaderboard);
  }

  function endGame(wilted) {
    running = false;
    clearAllTimers();
    clearGameElements();
    const prevBest = readBest();
    saveBest(score);
    if (!wilted) sndEnd();

    const saveLine = '<span id="orchidSaveStatus" class="orchid-save-status">💾 Зберігаю результат…</span>';
    const record = score > prevBest && score > 0;

    if (wilted) {
      showOverlay({
        title: '🥀 Орхідея зівʼяла…',
        lines: [
          'Вона не тримає зла, але запамʼятала. Наступного разу менше поливайте і більше слухайте.',
          saveLine,
        ],
        statsBlock: true,
        rank: getRank(score),
      });
    } else {
      showOverlay({
        title: record ? '🎉 Новий рекорд оранжереї!' : '🌸 Робочий день в оранжереї завершено!',
        lines: [
          (health >= 80 ? 'Орхідея щаслива і передає вітання!' : 'Орхідея вижила, але має запитання.'),
          saveLine,
        ],
        statsBlock: true,
        rank: getRank(score),
        petals: record || bloomsCount() >= 5,
      });
    }

    if (score > 0) {
      submitScore(score).then((res) => {
        const el = document.getElementById('orchidSaveStatus');
        if (el) el.innerHTML = res.msg;
      });
    } else {
      const el = document.getElementById('orchidSaveStatus');
      if (el) el.textContent = 'Нуль балів. Орхідея вдає, що вас не знає.';
    }
  }

  function startGame() {
    clearAllTimers();
    clearOverlays();
    clearGameElements();
    renderPlant();
    running = true;
    score = 0;
    health = MAX_HEALTH;
    combo = 0;
    timeLeft = GAME_TIME;
    stats = { hits: 0, wrongs: 0, missed: 0, maxCombo: 0 };
    updateHud();
    updateBlooms();
    later(tick, 1000);
    later(spawnNeed, 1200);
  }

  function showStartScreen() {
    clearGameElements();
    clearOverlays();
    renderPlant();
    // Демонстраційні квіти на стартовому екрані
    plantEl.querySelectorAll('.orchid-bloom').forEach((el, i) => el.classList.toggle('visible', i < 3));
    showOverlay({
      title: '🌸 Моя чудова Квіточка',
      lines: [
        'Ваша орхідея показуватиме, чого хоче: 💧 пити, ☀️ світла, 💬 комплімент… Швидко натискайте правильну кнопку догляду — мишею або клавішами <b>1–6</b>!',
        'Правильний догляд — квітка розквітає, серія 🔥 дає бонуси та іскри. Помилка чи зволікання — орхідея вʼяне. І головне: <b>не переливайте</b>!',
        'У вас 60 секунд, щоб виростити найпишнішу орхідею НСЗУ.',
      ],
      btnText: '🌱 Почати догляд',
    });
  }

  /* ---------- Кнопки догляду ---------- */

  function renderActions() {
    actionsEl.innerHTML = NEEDS.map((n, i) =>
      '<button type="button" class="orchid-care-btn" data-care="' + n.id + '">' +
      '<span class="care-icon">' + n.btnIcon + '</span><span>' + n.btnLabel + '</span>' +
      '<kbd>' + (i + 1) + '</kbd></button>'
    ).join('');
    actionsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-care]');
      if (btn) handleCare(btn.getAttribute('data-care'));
    });
  }

  /* ---------- Supabase: результати та лідери ---------- */

  async function submitScore(s) {
    if (!sb) return { msg: '⚠️ Supabase недоступний — результат лишився тільки в кабінеті.' };
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return { msg: '🔑 Увійдіть на сайт, щоб ваша орхідея потрапила до оранжереї слави!' };
      const { error } = await sb.from('orchid_scores').insert({ user_id: user.id, score: s });
      if (error) throw error;
      return { msg: '🏆 Результат записано до оранжереї слави!' };
    } catch (e) {
      const m = String((e && e.message) || e);
      if (m.includes('Занадто часто')) return { msg: '⏳ Занадто часто — цей результат не зараховано.' };
      if (m.includes('does not exist') || m.includes('schema cache')) return { msg: '⚠️ Таблицю оранжереї ще не створено в Supabase.' };
      return { msg: '⚠️ Не вдалося зберегти: ' + esc(m) };
    }
  }

  const MEDALS = ['🥇', '🥈', '🥉'];

  function renderPeople(rows) {
    let h = '<div class="askod-lb-col"><h4>🌸 Садівники</h4><table class="askod-lb-table"><thead><tr><th></th><th>Хто</th><th>Рекорд</th></tr></thead><tbody>';
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
        '<span class="lb-dept">садівників: ' + r.players + ' · кращий: ' + r.top_score + '</span></td>' +
        '<td class="lb-score">' + r.total_score + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  async function showLeaderboard() {
    clearOverlays();
    const ov = document.createElement('div');
    ov.className = 'orchid-overlay orchid-lb';
    ov.innerHTML = '<h3>🏆 Оранжерея слави</h3><p>Поливаємо дані… секундочку 🌱</p>';
    field.appendChild(ov);

    let body = '';
    try {
      if (!sb) throw new Error('Supabase недоступний');
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        body = '<p>🔑 Оранжерея слави доступна після входу на сайт. Увійдіть — і вирощуйте рекорди за свій відділ!</p>';
      } else {
        const [people, depts] = await Promise.all([
          sb.from('orchid_leaderboard').select('*').order('best_score', { ascending: false }).limit(10),
          sb.from('orchid_dept_leaderboard').select('*').order('total_score', { ascending: false }).limit(10),
        ]);
        if (people.error) throw people.error;
        if (depts.error) throw depts.error;
        if (!people.data || !people.data.length) {
          body = '<p>Поки що жодної орхідеї. Станьте першим садівником оранжереї!</p>';
        } else {
          body = '<div class="askod-lb-grid">' + renderPeople(people.data) + renderDepts(depts.data || []) + '</div>';
        }
      }
    } catch (e) {
      const m = String((e && e.message) || e);
      body = '<p>' + ((m.includes('does not exist') || m.includes('schema cache'))
        ? '⚠️ Таблицю оранжереї ще не створено в Supabase — виконайте скрипт orchid_leaderboard_setup.sql.'
        : '⚠️ Не вдалося завантажити: ' + esc(m)) + '</p>';
    }

    if (!ov.isConnected) return;
    ov.innerHTML = '<h3>🏆 Оранжерея слави</h3>' + body +
      '<div class="orchid-overlay-actions"><button type="button" id="orchidLbBack">⬅️ Назад</button></div>';
    ov.querySelector('#orchidLbBack').addEventListener('click', showStartScreen);
  }

  /* ---------- Модальне вікно ---------- */

  function openModal() {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    showStartScreen();
  }

  function closeModal() {
    running = false;
    clearAllTimers();
    clearGameElements();
    clearOverlays();
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  const LOADING_STEPS = ['Відчиняємо оранжерею…', 'Поливаємо ґрунт…', 'Будимо орхідею…'];
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
    }, 600);
  });

  closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { closeModal(); return; }
    // Гарячі клавіші догляду 1–6
    if (running && e.key >= '1' && e.key <= '6') {
      const def = NEEDS[Number(e.key) - 1];
      if (def) {
        handleCare(def.id);
        const btn = actionsEl.querySelector('[data-care="' + def.id + '"]');
        if (btn) {
          btn.classList.remove('pressed');
          void btn.offsetWidth;
          btn.classList.add('pressed');
        }
      }
    }
  });

  renderActions();
})();
