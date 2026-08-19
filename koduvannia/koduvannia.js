/* Розділ «Кодування» — групування випадку, перевірка коректності, аудит.
 *
 * Дані:
 *   data/core.json      ОДК, групи з вагами, коефіцієнти пункту 38
 *   data/dx.json        діагноз → [наші ОДК, ОДК за AR, групи AR, наші групи, якість збігу]
 *   data/iv.json        втручання → [[ОДК, [групи]], …], наші групи, ознака GI
 *   data/validate.json  конфлікти віку і статі, виключення моделі складності
 *   data/audit.json     розбіжності нашої Таблиці співставлення з AR-DRG
 * Назви кодів — з наявних довідників, щоб не дублювати мегабайти:
 *   ../classifiers/data/nk025_index.json, nk026_index.json
 *   ../classifiers/data/pilot_koduvannia.json — ролі хрестика і зірочки
 *
 * Посилання на групу в dx/iv кодується числом: idx — звичайна,
 * -(idx+1) — умовна (у першоджерелі позначена тильдою, легенда до неї — у тілі
 * мануала, якого в нас немає).
 */
(() => {
  'use strict';

  const V = 'v=19';

  // Кириличні гомогліфи → латиниця (та сама пастка, що в ДСГ і ЕСОЗ)
  const HOMO = { 'А':'A','В':'B','С':'C','Е':'E','Н':'H','І':'I','К':'K',
                 'М':'M','О':'O','Р':'P','Т':'T','Х':'X' };
  const norm = (s) => (s || '').trim().toUpperCase()
    .replace(/[АВСЕНІКМОРТХ]/g, (ch) => HOMO[ch] || ch)
    .replace(/\s+/g, '');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
    (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  const money = (n) => n.toLocaleString('uk-UA', { minimumFractionDigits: 2,
                                                   maximumFractionDigits: 2 });
  const $ = (id) => document.getElementById(id);

  // ── завантаження ────────────────────────────────────────────────────────
  const cache = new Map();
  async function load(path) {
    if (cache.has(path)) return cache.get(path);
    const p = (async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`${path}${path.includes('?') ? '&' : '?'}${V}`,
                                { cache: 'default' });
          if (r.ok) return await r.json();
        } catch (e) { /* локальний сервер рве з'єднання на великих файлах */ }
        await new Promise((s) => setTimeout(s, 250 * (i + 1)));
      }
      throw new Error(`не вдалося прочитати ${path}`);
    })();
    cache.set(path, p);
    return p;
  }

  let CORE = null, DX = null, IV = null, VAL = null, AUD = null;
  let NDX = null, NIV = null, DUAL = null;          // назви й ролі † / *

  const coreP = () => CORE ? Promise.resolve(CORE)
    : load('data/core.json').then((d) => (CORE = d));

  async function needCase() {
    await coreP();
    if (!DX) DX = await load('data/dx.json');
    if (!IV) IV = await load('data/iv.json');
  }
  async function needVal() { await coreP(); if (!VAL) VAL = await load('data/validate.json'); }
  async function needAud() { await coreP(); if (!AUD) AUD = await load('data/audit.json'); }

  /* Ролі хрестика і зірочки — файл дрібний (104 КБ), його чекати можна. */
  async function needDual() {
    if (DUAL) return;
    DUAL = (await load('../classifiers/data/pilot_koduvannia.json')).byCode || {};
  }

  /* Назви кодів лежать у класифікаторах НК 025 і НК 026 — це мегабайти, і на
     повільному з'єднанні вони приїжджають довго. Робота розділу від них не
     залежить: вантажимо у фоні й лише перемальовуємо, коли приїхали. Так
     групер не стоїть через довідник, потрібний тільки для підпису коду. */
  let namesReady = false, redrawOnNames = null;
  function startNames() {
    if (NDX || startNames.busy) return;
    startNames.busy = true;
    Promise.all([
      load('../classifiers/data/nk025_index.json'),
      load('../classifiers/data/nk026_index.json'),
    ]).then(([a, b]) => {
      NDX = new Map(a.map((e) => [e.c, e.n]));
      NIV = new Map(b.map((e) => [e.c, e.n]));
      namesReady = true;
      if (redrawOnNames) redrawOnNames();
    }).catch(() => { /* без назв розділ лишається робочим */ })
      .finally(() => { startNames.busy = false; });
  }

  const nameDx = (c) => (NDX && NDX.get(c)) || '';
  const nameIv = (c) => (NIV && NIV.get(c)) || '';
  const namesHint = () => namesReady ? ''
    : '<p class="kd-hint">Назви кодів ще вантажаться з довідників НК 025 і НК 026 — ' +
      'щойно приїдуть, підписи зʼявляться самі.</p>';

  // ── дрібні помічники предметної області ─────────────────────────────────
  const gAt = (ref) => CORE.groups[ref < 0 ? -ref - 1 : ref];
  const isCond = (ref) => ref < 0;
  const gCode = (ref) => gAt(ref).c;

  /* Предки за префіксом: M51.1 → M51 (як у пілоті — не залежить від поля p). */
  function ancestors(code) {
    const out = [];
    let c = code;
    while (c.includes('.')) {
      const i = c.indexOf('.');
      const [rub, tail] = [c.slice(0, i), c.slice(i + 1)];
      c = tail.length > 1 ? `${rub}.${tail.slice(0, -1)}` : rub;
      out.push(c);
    }
    return out;
  }

  function dualOf(code) {
    if (!DUAL) return null;
    for (const c of [code, ...ancestors(code)]) {
      const d = DUAL[c];
      if (d) return { at: c, ...d };
    }
    return null;
  }

  const odkById = (i) => CORE.odk[i];
  const mdcName = (m) => {
    const o = CORE.odk.find((x) => x.mdc === m);
    return o ? o.name : '';
  };

  /* Індекси MDC, які відповідають нашим ОДК діагнозу. */
  function mdcIdxOf(odkIdxs) {
    const s = new Set();
    for (const i of odkIdxs) {
      const m = CORE.odk[i].mdc;
      const k = CORE.mdc.indexOf(m);
      if (k >= 0) s.add(k);
    }
    return s;
  }

  /* Тариф за пунктом 38. Формула — у спільному модулі ../pmg-tariff.js: раніше
     тут був її спрощений двійник, який не знав ні додаткових коефіцієнтів за
     підпунктами 6 і 7, ні оплати від базової ставки на добу. Тепер розділ
     рахує тим самим кодом, що й «Інструменти ДСГ». */
  function tariff(group, ready) {
    if (!group.k || !group.k[0]) return null;
    const state = { share: true, balance: true };
    if (ready && ready !== 1) state.readiness = ready;
    const res = window.PMG_TARIFF.calcCase(group, {
      rate: CORE.rate, factors: CORE.factors, fmtK: window.PMG_TARIFF.fmtK,
      appendixLabel: CORE.appendixLabel, appendixCols: CORE.appendixCols,
    }, state);
    return { w: group.k[0], sum: res.total, res };
  }

  const formula = (t) => window.PMG_TARIFF.formulaText(t.res);

  // ═══════════════ Стрічка: що нам дали і що з цим робити ═════════════════
  /* Замість п'яти вкладок з власними полями — одне поле. Тип коду визначаємо
     за довідниками, а не за формою запису: інакше не спіймати збіги на кшталт
     I10, який є і діагнозом (гіпертензія), і групою (операції на шиї та спині).
     Таких збігів у нас 30+, і мовчки вибрати за нас — найгірше, що можна
     зробити: користувач отримає впевнену відповідь не на своє питання. */
  function classify(token) {
    const kinds = [];
    if (DX[token]) kinds.push('dx');
    if (IV[token]) kinds.push('iv');
    if (CORE.groups.some((g) => g.c === token)) kinds.push('drg');
    return kinds;
  }

  function parseQuery(raw) {
    // Спершу ділимо, і лише потім нормалізуємо кожен код окремо: norm() зрізає
    // ВСІ пробіли, тож на цілому рядку він склеїв би «M51.1 40303-00» в один
    // неіснуючий код.
    const tokens = String(raw).split(/[,;]+|\s+/)
      .map((t) => norm(t)).filter(Boolean);
    const out = { dx: [], iv: [], drg: [], unknown: [], ambiguous: [] };
    const force = forced ? forced.split(':') : null;
    forced = null;
    for (const t of tokens) {
      const k = classify(t);
      if (!k.length) { out.unknown.push(t); continue; }
      if (force && force[1] === t && k.includes(force[0])) { out[force[0]].push(t); continue; }
      if (k.length > 1) out.ambiguous.push({ code: t, kinds: k });
      // За замовчуванням тлумачимо перше за пріоритетом, але про збіг скажемо
      if (k.includes('iv')) out.iv.push(t);
      else if (k.includes('dx')) out.dx.push(t);
      else out.drg.push(t);
    }
    return out;
  }

  /** Стан коефіцієнтів зі смужки параметрів. */
  function paramState() {
    const ready = parseFloat($('kdReady').value) || 1;
    const st = { share: true, balance: true };
    if (ready !== 1) st.readiness = ready;
    if ($('kdChild').checked) st.child_add = true;
    if ($('kdTrauma').checked) st.trauma_add = true;
    if ($('kdMountain').checked) st.mountain = true;
    return st;
  }

  function sumOf(group, state) {
    if (!group.k || !group.k[0]) return null;
    return window.PMG_TARIFF.calcCase(group, {
      rate: CORE.rate, factors: CORE.factors, fmtK: window.PMG_TARIFF.fmtK,
      appendixLabel: CORE.appendixLabel, appendixCols: CORE.appendixCols,
    }, state);
  }

  // ═══════════════════ 1. Групування випадку ═══════════════════════════════
  // ═══════════════ Маршрут: один вхід, одна відповідь ═════════════════════
  async function route() {
    const out = $('kdAnswer');
    const raw = $('kdQ').value.trim();
    if (!raw) { out.innerHTML = welcome(); return; }
    out.innerHTML = '<div class="kd-card kd-card-empty">Читаю довідники…</div>';
    await needCase();
    await needDual();
    await needVal();
    startNames();
    redrawOnNames = () => { if ($('kdQ').value.trim()) route().catch(() => {}); };

    const q = parseQuery(raw);
    const parts = [];

    if (q.ambiguous.length) parts.push(ambiguityNote(q));

    if (q.dx.length && q.iv.length) parts.push(await renderCase(q));
    else if (q.dx.length) parts.push(await renderDx(q.dx[0], q));
    else if (q.iv.length) parts.push(renderIv(q.iv[0]));
    else if (q.drg.length) parts.push(renderDrg(q.drg[0]));
    else parts.push(renderUnknown(q));

    out.innerHTML = parts.join('');
  }

  const welcome = () => `<div class="kd-card kd-card-empty">
    <p>Уведіть код — покажемо все, що про нього відомо. Два коди разом
      (діагноз і втручання) читаються як випадок: клас, група, тариф і
      попередження.</p></div>`;

  /* Збіг кодів між довідниками. Мовчки вибрати — означає впевнено відповісти
     не на те питання, тому показуємо обидва тлумачення й даємо перемкнути. */
  function ambiguityNote(q) {
    const label = { dx: 'діагноз', iv: 'втручання', drg: 'група ДСГ' };
    return q.ambiguous.map((a) => `<div class="kd-flag kd-flag-warn">
      <b>${esc(a.code)}</b> є одночасно як ${a.kinds.map((k) => label[k]).join(' і як ')}.
      Показую як ${esc(label[a.kinds.includes('iv') ? 'iv' : a.kinds[0]])};
      ${a.kinds.filter((k) => k !== (a.kinds.includes('iv') ? 'iv' : a.kinds[0]))
        .map((k) => `<span class="kd-ex" data-force="${esc(k)}:${esc(a.code)}">показати як ${label[k]}</span>`).join(' ')}
    </div>`).join('');
  }

  function renderUnknown(q) {
    const near = Object.keys(DX).filter((c) => c.startsWith(q.unknown[0] || '')).slice(0, 10);
    return `<div class="kd-card"><p class="kd-flag kd-flag-no">
      ${q.unknown.length ? `Коду <b>${esc(q.unknown.join(', '))}</b> немає в наших довідниках.`
        : 'Не впізнав жодного коду.'}</p>
      ${near.length ? `<p class="kd-hint">Схожі: ${near.map((c) =>
        `<span class="kd-ex" data-q="${esc(c)}">${esc(c)}</span>`).join(' ')}</p>` : ''}</div>`;
  }

  // ── ADRG і рівні всередині нього ────────────────────────────────────────
  /* Ієрархія втручань AR-DRG (Technical Specifications V10.0, розділ 5) сортує
     ADRG за вартістю від високої до низької — тому вибір найдорожчого КОРЕНЯ
     методологічно виправданий. А от рівень УСЕРЕДИНІ кореня вартістю не
     визначається ніколи: там вирішує або конкретне втручання, або обсяг
     закладу, або тривалість. Раніше ми міряли грішми обидва рівні відразу й
     тому завжди показували найдорожчий рівень — при тому, що 3 525 із 4 283
     втручань ведуть більш ніж в один рівень одного кореня. */

  const wOf = (g) => (g.k && g.k[0]) || 0;
  /* Умову рівня автори записали в дужках у самій назві: «Висока складність
     (встановлення штучного кришталика)». */
  const parenOf = (t) => { const m = /\(([^)]{6,})\)/.exec(t || ''); return m ? m[1] : null; };
  const HOURS = /(\d+\s*годин|до\s*24|доб[аи])/i;

  /** Що саме розводить рівні всередині кореня. */
  function splitKind(gs) {
    if (gs.length < 2) return { kind: 'single' };
    if (new Set(gs.map((x) => wOf(x.g))).size === 1) return { kind: 'same' };
    /* Порядок перевірок — за силою впливу на суму: обсяг закладу міняє набір
       коефіцієнтів цілком, втручання множить вагу втричі, тривалість зазвичай
       не міняє нічого. Корінь C16 має ознаки і другого, і третього типу
       (C16A «встановлення штучного кришталика» і C16-01 «до 24 годин»), і
       називати його розвилку тривалістю було б неправдою. */
    if (gs.some((x) => x.g.a === 'appendix-2')) {
      return { kind: 'volume', q: 'обсяг втручань самого закладу',
        note: `Рівень усередині цього кореня визначає не випадок, а надавач.
          Коефіцієнти додатка 2 застосовуються, якщо заклад <b>з 1 квітня по
          30 вересня 2025 р.</b> провів 50 і більше втручань за ДСГ F03, F04,
          F05, F06, F07, F09, F10, F19, F24 <b>та/або</b> 30 і більше втручань
          з відновлення кровотоку в коронарних артеріях. Період фіксований і
          історичний — поточні обсяги на це не впливають. Хто порогу не досяг,
          рахується за додатком 1. <span class="kd-src">підпункт 15 пункту 38</span>` };
    }
    const cond = gs.map((x) => parenOf(x.g.t)).find(Boolean);
    if (cond) {
      return { kind: 'intervention', q: 'наявність конкретного втручання', cond,
        note: `Вищий рівень цього кореня — це не тяжчий пацієнт, а інше
          втручання: ${esc(cond)}.` };
    }
    if (gs.some((x) => HOURS.test(x.g.t || ''))) {
      return { kind: 'duration', q: 'тривалість випадку',
        note: `Рівні цього кореня розведені тривалістю, а не складністю.
          З кодів вона не видна — її беруть з даних про випадок.` };
    }
    return { kind: 'unknown', q: 'ознака, якої немає ні в кодах, ні в назвах груп',
      note: `Чим саме розведені рівні цього кореня, ні постанова, ні Таблиця
        співставлення не кажуть. Вибрати за нас — означало б вигадати правило.` };
  }

  /* Базовий рівень кореня — той, що представляє ADRG у додатку 1. Саме його
     вартістю коректно міряти ієрархію: інакше корінь із дорогим «А»-рівнем
     обійшов би в черзі корінь, який насправді дорожчий по суті. */
  function baseOf(gs) {
    return gs.find((x) => !x.g.sfx)
        || gs.find((x) => !/[A-ZА-Я]$/.test(x.g.sfx || ''))
        || gs.slice().sort((a, b) => wOf(a.g) - wOf(b.g))[0];
  }

  /* Рівень, доказовий з кодів епізоду. Доказ рахуємо строго: серед уведених
     втручань має бути таке, що веде у вищий рівень і при цьому не веде в
     жоден нижчий. Код, який веде в обидва (42701-00 дає і C16, і C16A),
     доказом не є — інакше ми б знову вгадували на користь дорожчого. */
  function levelByCodes(gs) {
    const marked = gs.filter((x) => x.via && x.via.size);
    if (marked.length < 2) return null;
    const hi = marked.reduce((a, b) => (wOf(b.g) > wOf(a.g) ? b : a));
    const lower = marked.filter((x) => wOf(x.g) < wOf(hi.g));
    if (!lower.length) return null;
    const only = [...hi.via].filter((c) => lower.every((x) => !x.via.has(c)));
    return only.length ? { g: hi, by: only } : null;
  }

  // ── випадок: діагноз + втручання ────────────────────────────────────────
  async function renderCase(q) {
    const dxCode = q.dx[0];
    const addDx = q.dx.slice(1);
    const rec = DX[dxCode];
    const [ourOdk] = rec;
    const mdcSet = mdcIdxOf(ourOdk);
    const state = paramState();

    /* 1. Кандидати. Один код групи приходить від кількох втручань — збираємо
       всі, бо саме перелік «через що досяжна» потім і доводить, яке втручання
       вмикає вищий рівень кореня. */
    const hits = new Map();
    let anyGi = false;
    const add = (g, code, cond, src) => {
      if (!hits.has(g.c)) hits.set(g.c, { g, via: new Set(), cond: true, ours: false });
      const h = hits.get(g.c);
      h.via.add(code);
      if (!cond) h.cond = false;          // безумовною група стає від першого ж
      if (src === 'our') h.ours = true;
    };
    for (const code of q.iv) {
      const r = IV[code];
      if (!r) continue;
      const [arRows, ourIvG, gi] = r;
      if (gi) anyGi = true;
      for (const ref of ourIvG) {
        const g = gAt(ref);
        if (g.mdc && g.mdc.some((m) => mdcSet.has(m))) add(g, code, isCond(ref), 'our');
      }
      for (const [m, gl] of arRows) {
        if (!mdcSet.has(m)) continue;
        for (const ref of gl) add(gAt(ref), code, isCond(ref), 'ar');
      }
    }
    let branch = 'втручання в межах класу діагнозу';
    if (!hits.size && anyGi) {
      const g801 = CORE.groups.find((g) => g.c === '801');
      if (g801) hits.set('801', { g: g801, via: new Set(q.iv), cond: false, ours: true });
      branch = 'група 801 — загальне втручання, не пов’язане з основним діагнозом';
    }
    for (const h of hits.values()) h.t = sumOf(h.g, state);

    /* 2. Корені (ADRG). Рівні всередині кореня — не конкуренти між собою,
       а розвилка: вони описують той самий випадок з різною ознакою. */
    const roots = new Map();
    for (const h of hits.values()) {
      const r = h.g.root || h.g.c;
      if (!roots.has(r)) roots.set(r, { root: r, gs: [] });
      roots.get(r).gs.push(h);
    }
    /* Рівні кореня — властивість класифікації, а не досяжності через код:
       групи додатка 2 (F05A, F05B…) у Таблиці співставлення до втручань не
       прив'язані взагалі, тому з самих кандидатів розвилку не було б видно
       ніколи. Добудовуємо корінь із класифікації, лишаючи `via` порожнім —
       саме порожнеча й означає «цей рівень кодами не доводиться». */
    for (const R of roots.values()) {
      for (const g of CORE.groups) {
        if ((g.root || g.c) !== R.root || R.gs.some((x) => x.g.c === g.c)) continue;
        R.gs.push({ g, via: new Set(), cond: false, ours: false, t: sumOf(g, state) });
      }
    }
    for (const R of roots.values()) {
      R.gs.sort((a, b) => wOf(a.g) - wOf(b.g));
      /* Рівень бере участь у розвилці, якщо він досяжний уведеними кодами або
         якщо це додаток 2: там рівень вмикає обсяг закладу, і в Таблиці
         співставлення таких прив'язок до втручань немає взагалі. Решта
         добудованих рівнів лишається в таблиці як довідка — інакше діапазон
         роздувала б, наприклад, кератопластика C01A у випадку, де жоден код
         на неї не вказує. */
      for (const x of R.gs) x.reach = x.via.size > 0 || x.g.a === 'appendix-2';
      R.lv = R.gs.filter((x) => x.reach);
      if (!R.lv.length) R.lv = R.gs.slice();
      R.base = baseOf(R.lv);
      R.cond = R.lv.filter((x) => x.via.size).every((x) => x.cond);
      R.split = splitKind(R.lv);
      R.pick = levelByCodes(R.lv);
      R.one = R.lv.length === 1 || R.split.kind === 'same' || !!R.pick;
      R.win = R.pick ? R.pick.g : (R.lv.length === 1 ? R.lv[0] : R.base);
      R.t = R.win.t;
    }

    /* 3. Вибір ADRG — ієрархія за вартістю базового рівня (Technical
       Specifications V10.0, розділ 5, критерій 1). Умовні кандидати
       поступаються безумовним незалежно від суми. */
    const order = [...roots.values()].sort((a, b) =>
      (a.cond ? 1 : 0) - (b.cond ? 1 : 0)
      || (b.base.t ? b.base.t.total : -1) - (a.base.t ? a.base.t.total : -1));
    const top = order.find((R) => R.t) || null;

    const flags = await caseFlags(q.dx, q.iv, numOrNull($('kdAge').value), null, $('kdSex').value || null);
    const alt = altBranches(dxCode, q.iv, mdcSet, state, top ? top.win : null);

    return `<div class="kd-card">
      ${headline(top, state)}
      <div class="kd-chain">
        <span>${esc(dxCode)}</span><i>→</i>
        <span>${ourOdk.map((i) => esc(odkById(i).id)).join(', ') || '—'}</span><i>→</i>
        <span>${q.iv.map(esc).join(', ')}</span><i>→</i>
        <b>${top ? esc(top.root) : '—'}</b>
      </div>
      <p class="kd-hint">${esc(branch)}</p>
      ${hierarchyNote(order, top)}
      ${top ? levelNote(top) : ''}
      ${alt}
      ${dualFlag(dxCode)}
      ${addDxNote(addDx)}
      ${flags.join('')}
      ${drill(order, top, state)}
    </div>`;
  }

  /* Коли одне втручання задовольняє критерії кількох ADRG, епізод забирає той,
     що стоїть вище в ієрархії втручань свого ОДК. Ієрархія — фіксований
     перелік у тілі мануала, якого в нас немає; вартість базового рівня лише
     перший із чотирьох критеріїв, за якими той перелік складали, і
     специфічність його перекриває. Тому порядок нижче — апроксимація, і
     мовчати про це не можна: у MDC 02 самі автори переставили C01 з першої
     позиції на третю, тобто вартість там програла. */
  function hierarchyNote(order, top) {
    const rivals = order.filter((R) => R.t && R !== top);
    if (!top || !rivals.length) return '';
    return `<div class="kd-flag kd-flag-warn">
      <b>Критеріям цього випадку відповідає ${order.length} ${
        order.length < 5 ? 'корені' : 'коренів'} — вибрано ${esc(top.root)} за
      вартістю базового рівня.</b> Це апроксимація: справжній порядок усередині
      ОДК заданий фіксованою ієрархією втручань, якої немає ні в постанові, ні
      в Таблиці співставлення. Інші кандидати:
      ${rivals.slice(0, 4).map((R) => `<b>${esc(R.root)}</b> (${esc(R.base.g.t
        ? R.base.g.t.slice(0, 46) : '')}${(R.base.g.t || '').length > 46 ? '…' : ''},
        ${money(R.base.t.total)} грн)`).join('; ')}. Якщо клінічно випадок — це
      інший корінь, беріть його: черга за сумою тут нічого не доводить.</div>`;
  }

  /* Розвилка рівнів усередині кореня — головна зміна проти попередньої версії:
     раніше тут мовчки перемагала найдорожча гілка. */
  function levelNote(R) {
    if (R.lv.length < 2) return '';
    if (R.split.kind === 'same') {
      return `<p class="kd-hint">Корінь ${esc(R.root)} має кілька записів
        (${R.lv.map((x) => esc(x.g.c)).join(', ')}) з однаковою вагою —
        на суму вибір між ними не впливає.</p>`;
    }
    if (R.pick) {
      return `<div class="kd-flag kd-flag-ok"><b>Рівень ${esc(R.pick.g.g.c)}
        визначений кодами випадку.</b> Усередині кореня ${esc(R.root)} рівні
        розводить ${esc(R.split.q)}, і в наших даних вищий рівень досяжний лише
        через <b>${R.pick.by.map(esc).join(', ')}</b> — саме це втручання його
        й вмикає. ${R.split.cond ? `Умова рівня: ${esc(R.split.cond)}.` : ''}</div>`;
    }
    const lo = R.lv[0], hi = R.lv[R.lv.length - 1];
    return `<div class="kd-flag kd-flag-warn">
      <b>Рівень усередині кореня ${esc(R.root)} з кодів не визначається.</b>
      ${R.split.note}
      ${lo.t && hi.t ? `Залежно від рівня випадок коштує від
        <b>${money(lo.t.total)}</b> (${esc(lo.g.c)}) до
        <b>${money(hi.t.total)}</b> (${esc(hi.g.c)}) грн. Показуємо базовий
        рівень ${esc(R.base.g.c)} — не найдорожчий, бо вибір рівня вирішується
        не сумою.` : ''}</div>`;
  }

  /* Додаткові діагнози. Питання «чому вони ні на що не впливають» виникає
     першим, тому відповідаємо на нього до того, як його поставлять. */
  function addDxNote(addDx) {
    if (!addDx.length) return '';
    const uncond = VAL ? new Set(VAL.exclUncond) : new Set();
    const inScope = addDx.filter((c) => !uncond.has(c));
    return `<details class="kd-drill"><summary>додаткові діагнози:
      ${esc(addDx.join(', '))} — чому вони не змінюють групу</summary>
      <p>Основним у стрічці читається перший код, решта — додаткові. На вибір
        групи й на тариф вони не впливають, і це не спрощення розділу:
        в ПМГ-2026 моделі клінічної складності немає. В AR-DRG супутні стани
        визначають рівень DRG усередині ADRG через оцінку складності епізоду,
        але в постанову 1808 перенесено рівень ADRG (додаток 1), а 38 груп
        додатка 2 розводяться обсягом втручань закладу, а не тяжкістю пацієнта.</p>
      <p class="kd-hint">${inScope.length
        ? `У моделі складності AR-DRG рівень складності могли б отримати:
           <b>${inScope.map(esc).join(', ')}</b>.`
        : 'Жоден із цих кодів не отримав би рівня складності навіть в AR-DRG.'}
        ${addDx.length - inScope.length
          ? ` Беззастережно виключені з моделі: ${addDx.filter((c) => uncond.has(c))
              .map(esc).join(', ')}.` : ''}</p>
    </details>`;
  }

  const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

  function headline(R, state) {
    if (!R) {
      return `<p class="kd-flag kd-flag-no">Для цієї пари жодної групи не знайдено.
        Найчастіша причина — втручання не пов'язане з класом основного діагнозу.</p>`;
    }
    const g = R.win.g, t = R.t;
    const lo = R.lv[0], hi = R.lv[R.lv.length - 1];
    /* Коли рівень з кодів не визначається, показувати одну суму як остаточну
       було б тим самим обманом, тільки тихішим: даємо діапазон і базовий рівень. */
    const sum = R.one
      ? `${money(t.total)} <span>грн</span>`
      : `${money(lo.t.total)} – ${money(hi.t.total)} <span>грн</span>`;
    return `<div class="kd-head">
      <div class="kd-head-code">${esc(R.one ? g.c : R.root)}</div>
      <div class="kd-head-name">${esc(g.t || '')}</div>
      <div class="kd-head-sum${R.one ? '' : ' kd-head-sum-range'}">${sum}</div>
      <div class="kd-head-formula">${R.one
        ? esc(window.PMG_TARIFF.formulaText(t))
        : `рівень визначає ${esc(R.split.q)}; базовий рівень ${esc(R.base.g.c)} — ${
            money(R.base.t.total)} грн`}</div>
      ${g.p && g.p.length ? `<div class="kd-hint">пакети ${esc(g.p.join(', '))} ·
        ${esc(CORE.appendixLabel[g.a] || '')}</div>` : ''}
      ${R.cond ? `<div class="kd-hint">кандидат умовний: у першоджерелі цей
        ADRG позначений тильдою, тобто досяжний не за самим кодом</div>` : ''}
    </div>`;
  }

  /* Головна причина, через яку це не «панель приладів», а машина: сама показує
     те, що користувач мав би помітити. Якщо з іншим основним діагнозом те саме
     втручання веде в дорожчу групу — кажемо про це, не чекаючи запитання.
     Саме на цій різниці стояв лист Кіровоградської лікарні. */
  function altBranches(dxCode, ivCodes, mdcSet, state, top) {
    if (!top) return '';
    const partners = dualPartners(dxCode);
    if (!partners.length) return '';

    const rows = [];
    for (const p of partners) {
      const best = bestGroupFor(p, ivCodes, state);
      if (!best || best.g.c === top.g.c) continue;
      rows.push({ code: p, ...best, diff: best.t.total - top.t.total });
    }
    if (!rows.length) return '';
    rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    const r = rows[0];
    const more = r.diff > 0;

    /* Партнерів звичайно кілька, і всі ведуть в ту саму групу: G55.1 паруються
       з усіма підкодами M50 і M51. Називати один із них (M50.0 — шийний відділ)
       для поперекової операції було б просто неправильно, тому коли група й
       сума збігаються, називаємо рубрики, а не довільний підкод. */
    const same = rows.filter((x) => x.g.c === r.g.c);
    const rubrics = [...new Set(same.map((x) => x.code.split('.')[0]))];
    const who = same.length > 1
      ? `код із рубрик ${rubrics.map(esc).join(', ')}`
      : `<b>${esc(r.code)}</b>`;

    return `<div class="kd-flag kd-flag-warn">
      <b>Той самий випадок із парним діагнозом дав би іншу групу.</b>
      Код <b>${esc(dxCode)}</b> і ${who} — пара за правилом
      хрестика і зірочки: одне й те саме захворювання, записане з боку основної
      хвороби і з боку її прояву. З основним ${same.length > 1 ? 'таким кодом'
        : `<b>${esc(r.code)}</b>`} той самий
      випадок пішов би в <b>${esc(r.g.c)}</b> — ${money(r.t.total)} грн,
      тобто на <b>${money(Math.abs(r.diff))} грн</b> ${more ? 'більше' : 'менше'}.
      Саме на цій різниці й будуються спори про «примусову заміну діагнозу»:
      вибирати треба не за сумою, а за тим, який стан насправді зумовив
      потребу в лікуванні.</div>`;
  }

  /* Партнери за хрестиком і зірочкою — в обидва боки. У даних це два різні
     поля: `manif` (цей код — прояв, ось його основні) і `mainFor` (цей код —
     основний, ось його прояви). Позначки успадковуються від рубрики, тому
     M51.1 знаходить своїх партнерів через M51. */
  function dualPartners(code) {
    const d = dualOf(code);
    if (!d) return [];
    const raw = [
      ...(d.manif || []).flatMap((m) => m.codes || []),
      ...(d.mainFor || []),
      ...(d.mainOf || []).flatMap((m) => m.codes || []),
      ...(d.manifOf || []),
    ];
    const out = new Set();
    for (const p of raw) {
      if (p === code) continue;
      if (DX[p]) { out.add(p); continue; }
      // рубрика (M51) сама в переліках не стоїть — беремо її підкоди
      for (const c of Object.keys(DX)) {
        if (c.startsWith(p + '.')) { out.add(c); if (out.size > 12) break; }
      }
    }
    return [...out].slice(0, 12);
  }

  /** Найдорожча група, досяжна для пари «діагноз + втручання». */
  function bestGroupFor(dxCode, ivCodes, state) {
    const rec = DX[dxCode];
    if (!rec) return null;
    const mdcSet = mdcIdxOf(rec[0]);
    let best = null;
    for (const code of ivCodes) {
      const r = IV[code];
      if (!r) continue;
      for (const ref of r[1]) {
        const g = gAt(ref);
        if (!g.mdc || !g.mdc.some((m) => mdcSet.has(m))) continue;
        const t = sumOf(g, state);
        if (t && (!best || t.total > best.t.total)) best = { g, t };
      }
    }
    return best;
  }

  /* Чипи-питання замість вкладок: розділ показує те, по що прийшли, а решта
     розкривається на місці й лише коли спитали. */
  function drill(order, top, state) {
    /* Таблиця тепер двоярусна: спершу корені в порядку ієрархії, під кожним —
       його рівні. Плоский список ставив рівні одного кореня в чергу поруч із
       чужими ADRG, наче вони конкуренти, — вони не конкуренти. */
    const rows = order.map((R) => {
      const head = `<tr class="${R === top ? 'win' : ''}">
        <td><b>${esc(R.root)}</b>${R.cond ? ' <span class="kd-src">умовний</span>' : ''}</td>
        <td>${esc(R.base.g.t || '—')}</td>
        <td>${esc(CORE.appendixLabel[R.base.g.a] || (R.base.g.a === 'ar-only' ? 'немає в постанові' : ''))}</td>
        <td>${R.base.g.p && R.base.g.p.length ? esc(R.base.g.p.join(', ')) : '—'}</td>
        <td class="num">${R.base.t ? String(R.base.t.weight).replace('.', ',') : '—'}</td>
        <td class="num">${R.base.t ? money(R.base.t.total) : '—'}</td></tr>`;
      if (R.gs.length < 2) return head;
      const lv = R.gs.filter((x) => x !== R.base).map((x) => `<tr class="kd-lvl">
        <td>└ ${esc(x.g.c)}${R.pick && R.pick.g === x ? ' <span class="kd-src">за кодами</span>' : ''}</td>
        <td>${esc(x.g.t || '—')}</td>
        <td>${esc(CORE.appendixLabel[x.g.a] || '')}</td>
        <td>${x.via.size ? 'через ' + [...x.via].map(esc).join(', ')
          : (x.g.a === 'appendix-2' ? 'за обсягом закладу'
             : '<span class="kd-src">є в класифікації, вашими кодами не досяжний</span>')}</td>
        <td class="num">${x.t ? String(x.t.weight).replace('.', ',') : '—'}</td>
        <td class="num">${x.t ? money(x.t.total) : '—'}</td></tr>`).join('');
      return head + lv;
    }).join('');
    const steps = top ? top.t.steps.map((s) =>
      `<tr><td>${esc(s.label)}${s.sub ? ` <span class="kd-src">п. 38.${esc(s.sub)}</span>` : ''}</td>
       <td class="num">${esc(s.op)} ${esc(String(s.value).replace('.', ','))}</td></tr>`).join('') : '';
    return `<div class="kd-drill">
      <details><summary>чому саме ця група</summary>
        <p>Основний діагноз задає клас, клас відсікає всі групи втручання, крім
          «своїх». Далі корені (ADRG) шикуються за вартістю базового рівня —
          так само, як в ієрархії втручань AR-DRG, де перший критерій — вартість
          від високої до низької. Рівні всередині кореня в цю чергу не
          потрапляють: між ними вирішує ознака випадку або надавача, а не сума.
          Саме групування виконує групер ЕСОЗ — тут показано, що для цієї пари
          досяжне за Таблицею співставлення.</p>
        <div class="kd-scroll"><table class="kd-tbl">
          <thead><tr><th>Корінь і рівні</th><th>Назва</th><th>Джерело ваги</th>
            <th>Пакети / через що</th><th>Вага</th><th>Сума</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </details>
      ${top ? `<details><summary>розрахунок покроково${
          top.one ? '' : ` — рівень ${esc(top.win.g.c)}`}</summary>
        ${top.one ? '' : `<p class="kd-hint">Рівень усередині кореня з кодів не
          визначається, тож рахуємо базовий. Для іншого рівня зміниться лише
          ваговий коефіцієнт у першому рядку.</p>`}
        <div class="kd-scroll"><table class="kd-tbl"><tbody>
          <tr><td>Базова ставка на пролікований випадок <span class="kd-src">п. 34</span></td>
              <td class="num">${money(top.t.rate)}</td></tr>
          ${steps}
          <tr class="win"><td><b>Сума за випадок</b></td>
              <td class="num"><b>${money(top.t.total)}</b></td></tr>
        </tbody></table></div>
        ${top.t.unknown.length ? `<p class="kd-hint">Не враховано: ${top.t.unknown
          .map((u) => esc(u.f.label) + ' — ' + esc(u.why)).join('; ')}.</p>` : ''}
      </details>` : ''}
      <details><summary>у який пакет це впаде</summary>
        <p class="kd-hint">Умови належності до пакета — у шухляді нижче,
          розділ «Належність до пакета» (за логіном).</p>
        ${top && top.win.g.p && top.win.g.p.length
          ? `<p>За додатком постанови ця група оплачується в пакетах
             <b>${esc(top.win.g.p.join(', '))}</b>.</p>` : ''}
      </details>
    </div>`;
  }

  // ── діагноз сам по собі ─────────────────────────────────────────────────
  async function renderDx(code, q) {
    const rec = DX[code];
    const [ourOdk, arMdc, arG, ourGraw] = rec;
    const ourG = ourGraw === 0 ? arG : ourGraw;
    const state = paramState();
    const med = ourG.map((ref) => ({ g: gAt(ref), t: sumOf(gAt(ref), state) }))
      .sort((a, b) => (b.t ? b.t.total : -1) - (a.t ? a.t.total : -1));
    const flags = await caseFlags([code], [], numOrNull($('kdAge').value), null, $('kdSex').value || null);
    const arM = arMdc == null ? null : CORE.mdc[arMdc];

    return `<div class="kd-card">
      <div class="kd-head">
        <div class="kd-head-code">${esc(code)}</div>
        <div class="kd-head-name">${esc(nameDx(code))}</div>
      </div>
      ${namesHint()}
      <div class="kd-chain"><span>клас</span><i>→</i>
        <b>${ourOdk.map((i) => esc(odkById(i).id)).join(', ') || 'не входить у жоден'}</b>
        <span class="kd-src">${ourOdk.length ? esc(odkById(ourOdk[0]).name) : ''}</span></div>
      ${arM && !ourOdk.some((i) => odkById(i).mdc === arM)
        ? `<div class="kd-flag kd-flag-warn">За першоджерелом цей код належить до
           класу ${esc(arM)}, а наша Таблиця відносить інакше. Групує Таблиця —
           вона чинна, — але розбіжність варто перевірити.</div>` : ''}
      ${dualFlag(code)}
      ${flags.join('')}
      <div class="kd-drill">
        <details open><summary>куди веде без втручання</summary>
          ${med.length ? `<div class="kd-scroll"><table class="kd-tbl">
            <thead><tr><th>Група</th><th>Назва</th><th>Вага</th><th>Сума</th></tr></thead>
            <tbody>${med.map((x) => `<tr><td><b>${esc(x.g.c)}</b></td>
              <td>${esc(x.g.t || '—')}</td>
              <td class="num">${x.t ? String(x.t.weight).replace('.', ',') : '—'}</td>
              <td class="num">${x.t ? money(x.t.total) : '—'}</td></tr>`).join('')}
            </tbody></table></div>`
            : '<p class="kd-hint">Цей код сам по собі в жодну групу не веде.</p>'}
        </details>
        <details><summary>додати втручання</summary>
          <p class="kd-hint">Допишіть код втручання в стрічку через пробіл —
            і замість довідки про код побачите розрахунок випадку.</p>
          <p><span class="kd-ex" data-q="${esc(code)} 40303-00">${esc(code)} 40303-00</span></p>
        </details>
      </div>
    </div>`;
  }

  // ── втручання саме по собі ──────────────────────────────────────────────
  function renderIv(code) {
    const [arRows, ourIvG, gi] = IV[code];
    const state = paramState();
    const byOdk = arRows.map(([m, gl]) => ({
      mdc: CORE.mdc[m], name: mdcName(CORE.mdc[m]),
      groups: gl.map((ref) => ({ g: gAt(ref), t: sumOf(gAt(ref), state) })),
    }));
    return `<div class="kd-card">
      <div class="kd-head">
        <div class="kd-head-code">${esc(code)}</div>
        <div class="kd-head-name">${esc(nameIv(code))}</div>
      </div>
      ${namesHint()}
      <p>${gi ? 'Це <b>загальне втручання</b>: якщо воно не пов’язане з класом основного діагнозу, випадок піде в групу 801.' : 'Це специфічне втручання.'}</p>
      <div class="kd-flag kd-flag-warn">Саме по собі втручання групу не визначає —
        її обирає основний діагноз через клас. Допишіть діагноз у стрічку, щоб
        побачити конкретну групу й суму.</div>
      <div class="kd-drill"><details open><summary>куди веде залежно від класу діагнозу</summary>
        <div class="kd-scroll"><table class="kd-tbl">
          <thead><tr><th>Клас</th><th>Групи</th><th>Найбільша сума</th></tr></thead>
          <tbody>${byOdk.map((r) => {
            const best = r.groups.filter((x) => x.t).sort((a, b) => b.t.total - a.t.total)[0];
            return `<tr><td><b>${esc(r.mdc)}</b> <span class="kd-src">${esc(r.name)}</span></td>
              <td>${r.groups.map((x) => `<span class="kd-chip">${esc(x.g.c)}</span>`).join(' ')}</td>
              <td class="num">${best ? money(best.t.total) : '—'}</td></tr>`;
          }).join('')}</tbody></table></div>
      </details></div>
    </div>`;
  }

  // ── група ДСГ ───────────────────────────────────────────────────────────
  function renderDrg(code) {
    const g = CORE.groups.find((x) => x.c === code);
    const state = paramState();
    const t = sumOf(g, state);
    const dxFrom = [];
    for (const [c, rec] of Object.entries(DX)) {
      const gl = rec[3] === 0 ? rec[2] : rec[3];
      if (gl.some((ref) => gCode(ref) === code)) dxFrom.push(c);
      if (dxFrom.length > 400) break;
    }
    return `<div class="kd-card">
      <div class="kd-head">
        <div class="kd-head-code">${esc(g.c)}</div>
        <div class="kd-head-name">${esc(g.t || '')}</div>
        ${t ? `<div class="kd-head-sum">${money(t.total)} <span>грн</span></div>
        <div class="kd-head-formula">${esc(window.PMG_TARIFF.formulaText(t))}</div>` : ''}
      </div>
      <div class="kd-chain">
        <span>${esc(CORE.appendixLabel[g.a] || (g.a === 'ar-only' ? 'немає в постанові' : ''))}</span><i>·</i>
        <span>клас ${g.mdc && g.mdc.length ? g.mdc.map((m) => esc(CORE.mdc[m])).join(', ') : '—'}</span><i>·</i>
        <span>пакети ${g.p && g.p.length ? esc(g.p.join(', ')) : '—'}</span>
      </div>
      <div class="kd-drill"><details><summary>з яких діагнозів досяжна без втручання</summary>
        <p class="kd-hint">${dxFrom.length > 400 ? 'перші 400' : dxFrom.length + ' кодів'}</p>
        <p>${dxFrom.slice(0, 400).map((c) => `<span class="kd-ex" data-q="${esc(c)}">${esc(c)}</span>`).join(' ')}</p>
      </details></div>
    </div>`;
  }

  const step = (n, title, body) => `<div class="kd-step"><div class="kd-step-n">${n}</div>
    <div class="kd-step-b"><div class="kd-step-t">${esc(title)}</div>${body}</div></div>`;

  function chip(ref, hit) {
    const g = gAt(ref);
    const cls = isCond(ref) ? 'kd-chip-cond' : (hit ? 'kd-chip-hit' : 'kd-chip-off');
    return `<span class="kd-chip ${cls}" title="${esc(g.t || '')}">${esc(g.c)}</span>`;
  }

  function dualFlag(code) {
    const d = dualOf(code);
    if (!d) return '';
    if (d.manif && d.manif.length) {
      const codes = d.manif.flatMap((m) => m.codes || []).join(', ');
      return `<div class="kd-flag kd-flag-warn">Це <b>код прояву</b>: у назві стоїть
        хрестик при ${esc(codes)}${d.at !== code ? ` (позначку успадковано від ${esc(d.at)})` : ''}.
        За МКХ-10 первинним є код основного захворювання. Водночас пункт 3.1.3 тому 2
        допускає зворотний порядок для кодування захворюваності, коли лікували саме
        прояв, — тож сам по собі цей факт ще не робить кодування помилковим.</div>`;
    }
    return '';
  }

  // ═══════════════════ 2. Перевірка коректності ════════════════════════════
  /* У додатку D стать позначено як FEML / MALE, а не F / M. */
  const SEX = { F: 'FEML', M: 'MALE' };
  const sexUa = (s) => (s === 'MALE' ? 'чоловічої' : 'жіночої');

  /* Правила ключовані на кодах МКХ-10-АМ, а вони подекуди на знак довші за
     НК 025: у таблиці стоять P07.30, P07.31, P07.32, а користувач уводить
     P07.3. Тому спершу шукаємо точний код, а якщо його немає — дивимось
     підкоди: правило застосовуємо лише тоді, коли ВСІ підкоди кажуть одне й
     те саме. Розбіжність між підкодами — привід промовчати, а не вгадувати. */
  function lookupRule(map, code) {
    if (map.has(code)) return { v: map.get(code), via: 'exact' };
    const vals = new Set();
    const pref = code + '.';
    for (const [k, v] of map) {
      if (k.startsWith(code) && (k.length > code.length) &&
          (k.startsWith(pref) || /^\d$/.test(k[code.length]))) vals.add(v);
    }
    return vals.size === 1 ? { v: [...vals][0], via: 'subcodes' } : null;
  }
  const viaNote = (r) => r.via === 'subcodes'
    ? ' <span class="kd-src">(правило стоїть на підкодах цього коду)</span>' : '';

  async function caseFlags(dxCodes, ivCodes, age, days, sex) {
    await needVal();
    const out = [];
    const want = sex ? SEX[sex] : null;
    const ageMap = new Map(VAL.ageDx);
    const sexDx = new Map(VAL.sexDx);
    const sexIv = new Map(VAL.sexIv);
    const obst = new Set(VAL.obstIv);
    const uncond = new Set(VAL.exclUncond);
    const catUa = (lb) => (VAL.ageUa && VAL.ageUa[lb]) || [lb, ''];

    dxCodes.forEach((c, ci) => {
      const ar = lookupRule(ageMap, c);
      if (ar && (age != null || days != null)) {
        const [ua, range] = catUa(ar.v);
        if (!ageFits(ar.v, age, days)) {
          out.push(`<div class="kd-flag kd-flag-no"><b>${esc(c)}</b> — конфлікт віку:
            код призначений для категорії <b>${esc(ua)}</b>${range ? ` (${esc(range)})` : ''},
            а вказано ${age != null ? esc(String(age)) + ' р.' : esc(String(days)) + ' дн.'}
            ${viaNote(ar)}</div>`);
        }
      }
      const sr = lookupRule(sexDx, c);
      if (sr && want && sr.v !== want) {
        out.push(`<div class="kd-flag kd-flag-no"><b>${esc(c)}</b> — конфлікт статі:
          код застосовний лише для статі ${sexUa(sr.v)}.${viaNote(sr)}</div>`);
      }
      /* Виключення з моделі складності — це про роль коду як СУПУТНЬОГО стану,
         тож на основному діагнозі цей прапорець лише збиває: там код і не мав
         би підвищувати тяжкість власного ж випадку. Показуємо його додатковим
         діагнозам, а для одинокого коду лишаємо як довідку про сам код. */
      if (uncond.has(c) && (dxCodes.length === 1 || ci > 0)) {
        out.push(`<div class="kd-flag kd-flag-warn"><b>${esc(c)}</b> — код беззастережно
          виключений з моделі клінічної складності: супутнім станом він тяжкість
          випадку не підвищує.</div>`);
      }
    });
    for (const c of ivCodes) {
      const s = sexIv.get(c);
      if (s && want && s !== want) {
        out.push(`<div class="kd-flag kd-flag-no"><b>${esc(c)}</b> — втручання
          застосовне лише для статі ${sexUa(s)}.</div>`);
      }
      if (obst.has(c) && sex === 'M') {
        out.push(`<div class="kd-flag kd-flag-no"><b>${esc(c)}</b> — акушерське
          втручання при чоловічій статі пацієнта.</div>`);
      }
    }
    // умовні виключення: етіологія не рахується, якщо в випадку є її прояв
    const set = new Set(dxCodes);
    for (const [aet, man] of VAL.exclCond) {
      if (set.has(aet) && set.has(man)) {
        out.push(`<div class="kd-flag kd-flag-warn">Пара <b>${esc(aet)}</b> і
          <b>${esc(man)}</b>: за наявності коду прояву код основного захворювання
          не отримує рівня складності.</div>`);
      }
    }
    return out;
  }

  /* Межі категорій віку рахує білдер із тексту додатка D і кладе у ageBounds:
     мітка → [min років, max років або null, чи max виключний]. Невідома мітка —
     не привід кричати, тому мовчазне «підходить». */
  function ageFits(cat, years, days) {
    const b = VAL.ageBounds && VAL.ageBounds[cat];
    if (!b) return true;
    const y = years != null ? Number(years)
            : days != null ? Number(days) / 365 : null;
    if (y == null) return true;
    const [lo, hi, excl] = b;
    if (y < lo) return false;
    if (hi != null && (excl ? y >= hi : y > hi)) return false;
    return true;
  }



  // ═══════════════════ 3. Аудит ════════════════════════════════════════════
  let slice = 'odk';
  async function runAudit() {
    const out = $('aOut');
    out.innerHTML = '<div class="kd-card kd-card-empty">Читаю аудит…</div>';
    await needAud();
    const q = norm($('aQ').value);
    const c = AUD.counts;
    let html = '', n = 0;

    if (slice === 'odk') {
      const rows = AUD.odkTable.filter((r) => !q || norm(r[0]).includes(q));
      n = rows.length;
      html = `<div class="kd-scroll"><table class="kd-tbl">
        <thead><tr><th>Клас</th><th class="num">У нас кодів</th>
          <th class="num">У першоджерелі</th><th class="num">Спільних</th>
          <th class="num">Лише в нас</th><th class="num">Лише в першоджерелі</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td><b>${esc(r[0])}</b></td>
          <td class="num">${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td>
          <td class="num">${r[4]}</td><td class="num">${r[5]}</td></tr>`).join('')}</tbody></table></div>
        <p class="kd-hint">Класи 23А і 24 — українські: у моделі AR-DRG таких немає,
          тому порівнювати їх нема з чим.</p>`;
    } else if (slice === 'groups') {
      html = `<div class="kd-card"><p><b>Групи, яких немає в першоджерелі
        (${AUD.groupsOnlyOurs.length}):</b><br>${AUD.groupsOnlyOurs.map((g) =>
          `<span class="kd-chip">${esc(g)}</span>`).join(' ')}</p>
        <p style="margin-top:14px"><b>Групи першоджерела, яких немає в постанові
        (${AUD.groupsOnlyAr.length}):</b><br>${AUD.groupsOnlyAr.map((g) =>
          `<span class="kd-chip">${esc(g)}</span>`).join(' ')}</p></div>`;
      n = AUD.groupsOnlyOurs.length + AUD.groupsOnlyAr.length;
    } else {
      const src = { dxDiff: AUD.dxDiff, ivDiff: AUD.ivDiff,
                    dxMissing: AUD.dxMissing }[slice] || [];
      const rows = src.filter((r) => !q || norm(r[0]).includes(q) ||
        JSON.stringify(r).toUpperCase().includes(q));
      n = rows.length;
      const head = slice === 'dxMissing'
        ? '<tr><th>Код</th><th>Клас</th><th>Групи за першоджерелом</th></tr>'
        : '<tr><th>Код</th><th>Наші групи</th><th>За першоджерелом</th><th>Різниця</th></tr>';
      const body = rows.slice(0, 600).map((r) => {
        if (slice === 'dxMissing') {
          return `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td>
            <td>${r[2].map((g) => `<span class="kd-chip">${esc(g)}</span>`).join(' ')}</td></tr>`;
        }
        const ours = new Set(r[1]), theirs = new Set(r[2]);
        const only1 = r[1].filter((g) => !theirs.has(g));
        const only2 = r[2].filter((g) => !ours.has(g));
        return `<tr><td><b>${esc(r[0])}</b></td>
          <td>${r[1].map((g) => `<span class="kd-chip">${esc(g)}</span>`).join(' ')}</td>
          <td>${r[2].map((g) => `<span class="kd-chip">${esc(g)}</span>`).join(' ')}</td>
          <td class="kd-src">${only1.length ? `лише в нас: ${esc(only1.join(', '))}` : ''}
            ${only2.length ? `${only1.length ? '; ' : ''}лише там: ${esc(only2.join(', '))}` : ''}</td></tr>`;
      }).join('');
      html = `<div class="kd-scroll"><table class="kd-tbl"><thead>${head}</thead>
        <tbody>${body}</tbody></table></div>
        ${rows.length > 600 ? `<p class="kd-hint">Показано перші 600 рядків із
          ${rows.length}. Повний зріз — через експорт у CSV.</p>` : ''}`;
    }

    $('aCount').textContent = `${n} рядків · усього розбіжностей: діагнози ${c.dxDiff}, ` +
      `втручання ${c.ivDiff}, немає в нас ${c.dxMissing}`;
    out.innerHTML = html;
  }

  function auditCsv() {
    if (!AUD) return;
    const rows = [];
    if (slice === 'odk') {
      rows.push(['Клас', 'У нас', 'У першоджерелі', 'Спільних', 'Лише в нас', 'Лише там']);
      for (const r of AUD.odkTable) rows.push(r);
    } else if (slice === 'groups') {
      rows.push(['Бік', 'Група']);
      for (const g of AUD.groupsOnlyOurs) rows.push(['лише в постанові', g]);
      for (const g of AUD.groupsOnlyAr) rows.push(['лише в першоджерелі', g]);
    } else if (slice === 'dxMissing') {
      rows.push(['Код', 'Клас', 'Групи за першоджерелом']);
      for (const r of AUD.dxMissing) rows.push([r[0], r[1], r[2].join(' ')]);
    } else {
      const src = slice === 'dxDiff' ? AUD.dxDiff : AUD.ivDiff;
      rows.push(['Код', 'Наші групи', 'За першоджерелом']);
      for (const r of src) rows.push([r[0], r[1].join(' '), r[2].join(' ')]);
    }
    const csv = '﻿' + rows.map((r) => r.map((v) =>
      `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `kodyvannia_audyt_${slice}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ═══════════════ 4. Належність до пакета (Supabase, RLS) ═════════════════
  /* Свого клієнта Supabase НЕ заводимо — з тієї ж причини, що в drg.js: другий
     GoTrueClient на той самий ключ сховища дає два паралельні оновлення токена.
     Беремо готовий токен сесії, яку поклав auth-v2.js, і ходимо звичайним
     fetch. На відміну від замка в drg, цей — справжній: дані лежать не у
     файлах сайту, а в таблицях під політиками RLS, тож без токена сервер
     просто не віддасть рядків. */
  const SB_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
  const SB_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
  const BOOT_KEY = 'portal-boot-v1';

  /* Чи користувач узагалі увійшов — беремо зі знімка, який кладе auth-v2.js.
     Це той самий спосіб, що в drg.js, і він не залежить від того, у якому
     форматі бібліотека тримає сесію. */
  function portalUser() {
    try {
      const s = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null');
      return s && s.uid ? s : null;
    } catch (e) { return null; }
  }

  /* А ось токен доводиться діставати зі сховища бібліотеки, і формат там
     плаває від версії до версії: один ключ; той самий ключ, розрізаний на
     «.0», «.1» (довгі сесії); значення, загорнуте в «base64-». Тому не
     припускаємо формат, а перебираємо всі варіанти — саме на цьому замок
     не відкривався в залогіненого користувача. */
  function sbToken() {
    try {
      const keys = Object.keys(localStorage)
        .filter((k) => /^sb-.+-auth-token(\.\d+)?$/.test(k))
        .sort((a, b) => {
          const n = (k) => { const m = k.match(/\.(\d+)$/); return m ? +m[1] : -1; };
          return n(a) - n(b);
        });
      if (!keys.length) return null;
      let raw = keys.map((k) => localStorage.getItem(k) || '').join('');
      if (raw.startsWith('base64-')) {
        const bin = atob(raw.slice(7));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        raw = new TextDecoder('utf-8').decode(bytes);
      }
      const s = JSON.parse(raw);
      return (s && (s.access_token ||
                    (s.currentSession && s.currentSession.access_token))) || null;
    } catch (e) { return null; }
  }

  /* PostgREST віддає щонайбільше 1000 рядків за запит, і параметр limit цієї
     стелі не піднімає — його ріже налаштування сервера. Перелік діагнозів до
     однієї умови буває на 3 376 кодів, тож ходимо сторінками через заголовок
     Range, поки сторінка не виявиться неповною. */
  const PAGE = 1000;

  async function sbGet(path, paged = false) {
    const token = sbToken();
    if (!token) throw new Error('немає сесії');
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const headers = { apikey: SB_KEY, Authorization: `Bearer ${token}` };
      if (paged) headers.Range = `${from}-${from + PAGE - 1}`;
      const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers });
      if (r.status === 401 || r.status === 403)
        throw new Error('сесія застаріла — увійдіть у портал ще раз');
      if (!r.ok && r.status !== 206) throw new Error(`Supabase ${r.status}`);
      const chunk = await r.json();
      if (!paged) return chunk;
      out.push(...chunk);
      if (chunk.length < PAGE || out.length > 40000) return out;
    }
  }

  let RULES = null, pkgMode = 'byPkg';
  /* Тлумачення, нав'язане користувачем при збігу кодів («показати як групу»).
     Живе рівно один прогін: далі стрічка знову вирішує сама. */
  let forced = null;
  const dictCache = new Map();

  async function needRules() {
    if (!RULES) RULES = await sbGet('pmg_rules?select=*&order=pkg,sort_order&limit=2000');
  }

  async function dictOf(dict, tab) {
    const key = `${dict}|${tab}`;
    if (!dictCache.has(key)) {
      dictCache.set(key, sbGet(`pmg_rule_dicts?select=code,name,min_bound,max_bound` +
        `&dict=eq.${encodeURIComponent(dict)}&tab=eq.${encodeURIComponent(tab)}` +
        `&order=code`, true));
    }
    return dictCache.get(key);
  }

  /* Документ написаний назвами полів ЕСОЗ. Читати «encounter_type: 4» людині
     неможливо, тому тримаємо тут підписи українською, а технічну назву
     лишаємо дрібним сірим — вона потрібна, коли звіряєшся з самою системою. */
  const FIELD_UA = {
    class: 'Умови надання',
    service_code: 'Код послуги',
    requester_position: 'Посада того, хто направив',
    episode_type: 'Тип епізоду',
    encounter_type: 'Тип взаємодії',
    performer_position: 'Посада виконавця',
    performer_position_copy: 'Посада виконавця (додатковий перелік)',
    sr_id: 'Електронне направлення',
    paper_referral_edrpou: 'Паперове направлення',
    priority_code: 'Код пріоритетності',
    principal_diagnosis: 'Основний діагноз',
    principal_diagnosis_copy: 'Основний діагноз (додатковий перелік)',
    pdx_clinical_status: 'Клінічний статус основного діагнозу',
    add_diagnoses: 'Супутні діагнози',
    declaration_employee_id: 'Декларація з лікарем',
    action_references: 'Втручання',
    action_references_2: 'Втручання, друга умова',
    action_references_3: 'Втручання, третя умова',
    adrg: 'Діагностично-споріднена група',
    admission_source: 'Джерело госпіталізації',
    admission_weight: 'Вага при народженні',
    person_gender: 'Стать',
    age_years: 'Вік, років',
    age_days: 'Вік, днів',
    add_req: 'Додаткові вимоги',
    has_contract: 'Чинний договір за пакетом',
    has_narco: 'Ліцензія на обіг наркотичних засобів',
  };

  const VALUE_UA = {
    INPATIENT: 'стаціонар', AMB: 'амбулаторно', PHC: 'первинна медична допомога',
    TREATMENT: 'лікування', PREVENTION: 'профілактика', DG: 'діагностика',
    PALLIATIVE_CARE: 'паліативна допомога', REHAB: 'реабілітація',
    discharge: 'виписка', service_delivery_location: 'за місцем надання послуг',
    virtual: 'дистанційно', home: 'удома', field: 'виїзд',
    system_referral: 'електронне направлення', blank_referral: 'паперове направлення',
    transfer: 'переведення з іншого закладу', transfer_in_LE: 'переведення в межах закладу',
    born_in_LE: 'народжений у закладі', third_party: 'третя сторона',
    'self_сonvers': 'самозвернення', emergency: 'екстрено',
    FEMALE: 'жіноча', MALE: 'чоловіча',
    active: 'активний', remission: 'ремісія', recurrence: 'рецидив', resolved: 'вирішений',
  };

  const fieldUa = (k) => FIELD_UA[k] || k;
  const valueUa = (v) => VALUE_UA[v] || v;

  /* Поля, у яких значення умови — номер вкладки словника. Решта несе значення
     прямо («так», INPATIENT, номер пакета), і кнопку переліку їм малювати не
     треба: словника під ними немає, і вона відкривала б порожнечу. */
  const DICT_FIELDS = {
    requester_position: 'requester_position', episode_type: 'episode_type',
    encounter_type: 'encounter_type', performer_position: 'performer_position',
    performer_position_copy: 'performer_position_copy',
    principal_diagnosis: 'principal_diagnosis',
    principal_diagnosis_copy: 'principal_diagnosis_copy',
    pdx_clinical_status: 'pdx_clinical_status',
    action_references: 'action_references',
    // друга й третя умови на втручання посилаються на той самий словник
    action_references_2: 'action_references', action_references_3: 'action_references',
    adrg: 'adrg', admission_source: 'admission_source',
    admission_weight: 'admission_weight', person_gender: 'person_gender',
    age_years: 'age_years', age_days: 'age_days',
  };

  /* Дрібні переліки (вік, стать, тип епізоду…) показуємо одразу текстом —
     це кілька значень, ховати їх за кнопкою немає сенсу. Великі (діагнози,
     втручання, ДСГ) лишаються під кнопкою: там тисячі кодів. */
  const SMALL = ['episode_type', 'encounter_type', 'admission_source', 'person_gender',
                 'pdx_clinical_status', 'age_years', 'age_days', 'admission_weight'];
  let SMALLVALS = null;

  async function loadSmall() {
    if (SMALLVALS) return;
    const rows = await sbGet('pmg_rule_dicts?select=dict,tab,code,min_bound,max_bound' +
      `&dict=in.(${SMALL.join(',')})`, true);
    SMALLVALS = new Map();
    for (const r of rows) {
      const k = `${r.dict}|${r.tab}`;
      if (!SMALLVALS.has(k)) SMALLVALS.set(k, []);
      SMALLVALS.get(k).push(r);
    }
  }

  function rangeUa(r, unit) {
    const lo = r.min_bound, hi = r.max_bound;
    if (hi === 'inf' || hi === null || hi === undefined || hi === '')
      return `від ${lo} ${unit}`;
    if (lo === '0' || lo === 0) return `до ${hi} ${unit}`;
    return `${lo}–${hi} ${unit}`;
  }

  function smallHtml(field, tab) {
    const dict = DICT_FIELDS[field];
    const rows = (SMALLVALS && SMALLVALS.get(`${dict}|${tab}`)) || [];
    if (!rows.length) return null;
    const unit = field === 'age_years' ? 'р.' : field === 'age_days' ? 'дн.' : 'г';
    const parts = rows.map((r) => r.code ? valueUa(r.code) : rangeUa(r, unit));
    return [...new Set(parts)].join(' · ');
  }

  function condHtml(rule) {
    const out = [];
    for (const [k, v] of Object.entries(rule.cond || {})) {
      const label = `<b>${esc(fieldUa(k))}</b>` +
        (FIELD_UA[k] ? ` <span class="kd-src">${esc(k)}</span>` : '');
      let val;
      if (v === 'так') {
        val = 'потрібне';
      } else if (k === 'has_contract') {
        val = `пакет ${esc(v)}`;
      } else if (!DICT_FIELDS[k]) {
        val = esc(valueUa(v));
      } else {
        const inline = SMALL.includes(k) ? smallHtml(k, v) : null;
        val = inline !== null && inline !== undefined
          ? esc(inline)
          : `<button class="kd-dict-btn" data-dict="${esc(DICT_FIELDS[k])}"
                     data-tab="${esc(v)}" type="button">показати перелік</button>`;
      }
      out.push(`<div class="kd-cond">${label}: ${val}</div>`);
    }
    return out.join('') || '<span class="muted">додаткових умов немає</span>';
  }

  function renderByPkg() {
    const pkg = $('pkgSel').value;
    const rows = RULES.filter((r) => !pkg || r.pkg === pkg);
    $('pkgCount').textContent = `${rows.length} правил`;
    $('pkgOut').innerHTML = rows.length ? rows.map((r) => `
      <div class="kd-card">
        <div class="kd-step-t">пакет ${esc(r.pkg)}${r.service_code ? ' · послуга ' + esc(r.service_code) : ''}
          ${r.class ? ' · ' + esc(r.class) : ''}</div>
        <div style="margin:2px 0 8px">${esc(r.service_name || '')}</div>
        <div>${condHtml(r)}</div>
      </div>`).join('')
      : '<div class="kd-card kd-card-empty">Для цього пакета правил немає.</div>';
  }

  async function renderByCode() {
    const code = norm($('pkgQ').value);
    const out = $('pkgOut');
    if (!code) { out.innerHTML = ''; return; }
    out.innerHTML = '<div class="kd-card kd-card-empty">Шукаю…</div>';
    const hits = await sbGet('pmg_rule_dicts?select=dict,tab,name' +
      `&code=eq.${encodeURIComponent(code)}`, true);
    if (!hits.length) {
      out.innerHTML = `<div class="kd-card"><p class="kd-flag kd-flag-warn">Коду
        <b>${esc(code)}</b> немає в жодному переліку алгоритму. Це не означає, що
        послуга не належить пакету: умова могла бути задана не переліком кодів,
        а іншим полем.</p></div>`;
      return;
    }
    const where = new Set(hits.map((h) => `${h.dict}|${h.tab}`));
    const rows = RULES.filter((r) => Object.entries(r.cond || {})
      .some(([k, v]) => where.has(`${k}|${v}`)));
    const byPkg = new Map();
    for (const r of rows) {
      if (!byPkg.has(r.pkg)) byPkg.set(r.pkg, []);
      byPkg.get(r.pkg).push(r);
    }
    out.innerHTML = `
      <div class="kd-card">
        <p><b>${esc(code)}</b> ${esc(hits[0].name || '')}</p>
        <p class="kd-hint">Стоїть у переліках: ${[...where].map((w) =>
          `<span class="kd-chip">${esc(w.replace('|', ' · вкладка '))}</span>`).join(' ')}</p>
        <p>Пакети, чиї правила на ці переліки посилаються:
          ${byPkg.size ? [...byPkg.keys()].map((p) =>
            `<span class="kd-chip kd-chip-hit">пакет ${esc(p)}</span>`).join(' ')
          : '<span class="muted">жодного</span>'}</p>
      </div>
      ${[...byPkg.entries()].map(([p, rs]) => `
        <div class="kd-card"><div class="kd-step-t">пакет ${esc(p)} — ${rs.length} правил</div>
          ${rs.map((r) => `<div style="margin-top:8px">${esc(r.service_name || '')}
            <div>${condHtml(r)}</div></div>`).join('')}
        </div>`).join('')}`;
  }

  async function runPkg() {
    const user = portalUser();
    const token = sbToken();
    // Замок показуємо лише тому, хто справді не увійшов. Якщо вхід є, а токен
    // не читається — це наша біда, і сказати треба саме так, а не вдавати замок.
    const locked = !user && !token;
    $('pkgLock').hidden = !locked;
    $('pkgBody').hidden = locked;
    if (locked) return;
    if (!token) {
      $('pkgOut').innerHTML = `<div class="kd-card"><p class="kd-flag kd-flag-warn">
        Ви увійшли як <b>${esc(user.name || user.email || user.uid)}</b>, але сторінка
        не змогла прочитати ключ сесії зі сховища браузера. Найпростіше лікування —
        вийти з порталу і зайти знову. Якщо не допоможе, скажіть мені — це вже
        питання формату, у якому бібліотека тримає сесію.</p></div>`;
      return;
    }
    try {
      await loadSmall();
      await needRules();
      if (!$('pkgSel').options.length || $('pkgSel').options.length === 1) {
        const pkgs = [...new Set(RULES.map((r) => r.pkg))]
          .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
        $('pkgSel').innerHTML = '<option value="">усі пакети</option>' +
          pkgs.map((p) => `<option value="${esc(p)}">пакет ${esc(p)}</option>`).join('');
      }
      pkgMode === 'byPkg' ? renderByPkg() : await renderByCode();
    } catch (e) {
      $('pkgOut').innerHTML = `<div class="kd-card"><p class="kd-flag kd-flag-no">
        ${esc(e.message)}${/сесія|немає сесії/.test(e.message) ? '' :
        '. Якщо таблиць ще немає — застосуйте міграцію migration_2026-08-17b_pmg_rules.sql і залийте дані завантажувачем.'}</p></div>`;
    }
  }

  // ═══════════════════ каркас ══════════════════════════════════════════════
  async function stats() {
    await coreP();
    const c = CORE.meta.counts;
    $('kdStats').innerHTML = [
      [c.dx.toLocaleString('uk-UA'), 'діагнозів у ланцюзі'],
      [c.iv.toLocaleString('uk-UA'), 'втручань'],
      [c.groups, 'груп'],
      [c.odk, 'класів'],
      [c.gi.toLocaleString('uk-UA'), 'загальних втручань'],
    ].map(([n, t]) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`).join('');
  }

  /* Вкладок більше немає. Старі посилання з #grouper, #check, #rules, #audit,
     #pkg мають далі працювати, тому хеш тепер відкриває відповідну шухляду
     (а #grouper і #check просто ставлять фокус у стрічку). */
  function openDrawer(name) {
    const map = { rules: 'dr-rules', audit: 'dr-audit', pkg: 'dr-pkg' };
    if (name === 'grouper' || name === 'check') { $('kdQ').focus(); return; }
    const el = $(map[name]);
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (name === 'audit' && !AUD) runAudit();
    if (name === 'pkg') runPkg();
  }

  /* Кожен блок прив'язок — окремо. Один відсутній вузол (а розмітка тут
     перебудовувалася) не повинен обривати реєстрацію решти обробників:
     саме так після переходу на стрічку мовчки помер аудит. */
  function wire(name, fn) {
    try { fn(); } catch (e) { console.warn(`[кодування] не підключено: ${name}`, e); }
  }

  function init() {
    stats().catch(() => {});


    const go = () => route().catch((err) =>
      $('kdAnswer').innerHTML = `<div class="kd-card"><p class="kd-flag kd-flag-no">${esc(err.message)}</p></div>`);
    $('kdGo').addEventListener('click', go);
    $('kdQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    // параметри міняють лише суму — перемальовуємо мовчки, без кнопки
    for (const id of ['kdAge', 'kdSex', 'kdReady', 'kdChild', 'kdTrauma', 'kdMountain'])
      $(id).addEventListener('change', () => { if ($('kdQ').value.trim()) go(); });
    document.addEventListener('click', (e) => {
      const ex = e.target.closest('[data-q]');
      if (ex) { $('kdQ').value = ex.dataset.q; $('kdGo').click(); return; }
      const f = e.target.closest('[data-force]');
      if (f) { forced = f.dataset.force; $('kdGo').click(); }
    });


    // Шухляди рахують себе самі, коли їх відкривають. Реєструємо це РАНО:
    // якщо нижче щось відвалиться, читанка і звіти все одно працюватимуть.
    wire('шухляди', () => {
      $('dr-audit').addEventListener('toggle', function () { if (this.open && !AUD) runAudit(); });
      $('dr-pkg').addEventListener('toggle', function () { if (this.open) runPkg(); });
    });

    // Підвкладок два набори (аудит і належність), тому слухаємо кожен
    // у своїй шухляді: один спільний querySelector чіпляв би лише перший.
    wire('підвкладки аудиту', () => {
    document.querySelector('#dr-audit .kd-subtabs').addEventListener('click', (e) => {
      const b = e.target.closest('.kd-subtab');
      if (!b) return;
      slice = b.dataset.slice;
      for (const x of document.querySelectorAll('#dr-audit .kd-subtab'))
        x.classList.toggle('active', x === b);
      runAudit();
    });
    let at;
    $('aQ').addEventListener('input', () => { clearTimeout(at); at = setTimeout(runAudit, 250); });
    $('aCsv').addEventListener('click', auditCsv);
    });

    wire('належність до пакета', () => {
    document.querySelector('#dr-pkg .kd-subtabs').addEventListener('click', (e) => {
      const b = e.target.closest('.kd-subtab');
      if (!b) return;
      pkgMode = b.dataset.pkgmode;
      for (const x of document.querySelectorAll('#dr-pkg .kd-subtab'))
        x.classList.toggle('active', x === b);
      $('pkgByPkgPanel').hidden = pkgMode !== 'byPkg';
      $('pkgByCodePanel').hidden = pkgMode !== 'byCode';
      $('pkgOut').innerHTML = '';
      if (pkgMode === 'byPkg') runPkg();
    });
    $('pkgSel').addEventListener('change', () => runPkg());
    $('pkgFind').addEventListener('click', () => runPkg());
    $('pkgQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') runPkg(); });

    // розкриття переліку значень умови
    $('pkgOut').addEventListener('click', async (e) => {
      const b = e.target.closest('.kd-dict-btn');
      if (!b) return;
      const box = b.parentElement.querySelector('.kd-dict-box');
      if (box) { box.remove(); return; }
      const holder = document.createElement('div');
      holder.className = 'kd-dict-box';
      holder.textContent = 'читаю перелік…';
      b.parentElement.appendChild(holder);
      try {
        const rows = await dictOf(b.dataset.dict, b.dataset.tab);
        holder.innerHTML = rows.length
          ? `<div class="kd-hint">${rows.length} значень</div>` + rows.map((x) =>
              `<div><b>${esc(x.code || '')}</b> ${esc(x.name || '')}` +
              `${x.min_bound || x.max_bound ? ` <span class="kd-src">${esc(x.min_bound || '')}–${esc(x.max_bound || '')}</span>` : ''}</div>`).join('')
          : '<span class="muted">перелік порожній</span>';
      } catch (err) {
        holder.innerHTML = `<span class="kd-flag kd-flag-no">${esc(err.message)}</span>`;
      }
    });
    });

    const h = (location.hash || '').replace('#', '');
    if (['grouper', 'check', 'rules', 'audit', 'pkg'].includes(h)) openDrawer(h);

    /* Прихід із паспорта НК 025/026 з уже підставленим кодом: ?dx=M51.1&iv=…
       Саме заради цього переходу місток у паспорті має сенс — інакше довелося б
       уводити код удруге. */
    const q = new URLSearchParams(location.search);
    const dx = q.get('dx') || q.get('code');
    const iv = q.get('iv');
    if (dx || iv) {
      $('kdQ').value = [dx, iv].filter(Boolean).join(' ');
      go();
    } else {
      $('kdAnswer').innerHTML = welcome();
    }
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
