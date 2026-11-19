/* Кодер — одна вкладка на весь ланцюжок:
 *   діагноз (НК 025) → ОДК → втручання (НК 026) → групер → ДСГ → Таблиця співставлення → тариф.
 *
 * Вхід з будь-якого рівня: код діагнозу, код втручання, «ДСГ I10», «ОДК 8», «пакет 4»
 * або слова. Сторінка нічого не рахує по-своєму:
 *   назви            — індекси НК 025 / НК 026 (classifiers/data);
 *   ОДК, групи, ваги — koduvannia/data/core.json, dx.json, iv.json (з Таблиці співставлення
 *                      й постанови 1808);
 *   сума             — pmg-tariff.js (той самий розрахунок, що в «Кодуванні випадку»);
 *   пошук за словами — pmg-code-search.js.
 * Рівень «Групер» тут — лише перелік можливих груп за Таблицею співставлення. Точний
 * вибір групи робить сторінка «Групер ДСГ» (правила під логіном), і Кодер туди веде.
 */
(function () {
  'use strict';

  const V = 'v=20261119a';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d) => Number(n).toLocaleString('uk-UA', d == null ? {} : { minimumFractionDigits: d, maximumFractionDigits: d });
  const kf = (v) => String(v).replace('.', ',');
  const LEVELS = [
    ['dx', 'Діагноз'], ['odk', 'ОДК'], ['iv', 'Втручання'], ['grouper', 'Групер'],
    ['drg', 'ДСГ'], ['service', 'Таблиця співставлення'], ['tariff', 'Тариф'],
  ];
  const RE_ICD = /^[A-Z]\d{2}(\.\d{1,2})?$/;
  const RE_ACHI = /^\d{5}-\d{2}$/;
  const RE_ESOZ = /^[A-Z]\d{5}$/;

  let CORE, DX, IV, VAL, NK025, NK026, SVC, BY_ICD, BY_ACHI, ESOZ;
  const N25 = new Map(), N26 = new Map(), GROUP = new Map(), ODKN = new Map(), ESOZM = new Map();
  let NOTES = null;                 // накази 377, 182, роз'яснення — довантажуються після першої відповіді
  let hidden = new Set();

  try { hidden = new Set(JSON.parse(localStorage.getItem('koder-hidden') || '[]')); } catch (e) { /* без сховища */ }

  /* Завантаження з обмеженням часу й повтором: обірване з'єднання інколи не дає помилки,
     а просто мовчить — тоді сторінка назавжди лишалась би на «Завантаження…». */
  async function get(url) {
    const full = url + (url.includes('?') ? '&' : '?') + V;
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetch(full, { signal: ctl.signal });
        if (!r.ok) throw new Error(url + ' ' + r.status);
        return await r.json();
      } catch (e) {
        last = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw last;
  }

  // ── завантаження ─────────────────────────────────────────────────────
  async function boot() {
    renderLevelChips();
    bind();
    try {
      [CORE, DX, IV, VAL, SVC, BY_ICD, BY_ACHI] = await Promise.all([
        get('data/core.json'), get('data/dx.json'), get('data/iv.json'), get('data/validate.json'),
        get('../mapping/data/services_lite.json'), get('../mapping/data/by_icd.json'),
        get('../mapping/data/by_achi.json'),
      ]);
      [NK025, NK026, ESOZ] = await Promise.all([
        get('../classifiers/data/nk025_index.json'), get('../classifiers/data/nk026_index.json'),
        get('../classifiers/data/esoz/esoz_index.json'),
      ]);
    } catch (e) {
      $('krStatus').innerHTML = '<span class="kr-err">Не вдалося завантажити довідники. Оновіть сторінку.</span>';
      return;
    }
    for (const e of NK025) { e._t = PMG_SEARCH.text(e.n); N25.set(e.c, e); }
    for (const e of NK026) { e._t = PMG_SEARCH.text(e.n); N26.set(e.c, e); }
    for (const e of ESOZ) ESOZM.set(e.c, e);
    CORE.groups.forEach((g, i) => { g._i = i; g._t = PMG_SEARCH.text(g.t); GROUP.set(g.c, g); });
    CORE.odk.forEach((o, i) => { o._i = i; ODKN.set(PMG_SEARCH.code(o.num), o); });
    if (window.PMG_FIND) PMG_FIND.ready().then(() => { if ($('krQ').value.trim()) run(); });

    const q = new URLSearchParams(location.search).get('q') || new URLSearchParams(location.search).get('code');
    if (q) $('krQ').value = q;
    run();
  }

  function loadNotes() {
    if (NOTES) return Promise.resolve(NOTES);
    return Promise.all([
      get('../algorithms/data/rehab_182.json').catch(() => null),
      get('../algorithms/data/algorithms_377.json').catch(() => null),
      get('../rozjasnennya/data/codes_index.json').catch(() => null),
    ]).then(([r182, a377, roz]) => {
      const n = { r182: new Map(), a377: new Map(), roz: (roz && roz.index) || {}, wording: [] };
      if (r182) {
        n.wording = r182.wordings || [];
        for (const x of r182.records || []) n.r182.set(x.code, x);
      }
      if (a377) {
        for (const x of a377.records || []) {
          if (!n.a377.has(x.code)) n.a377.set(x.code, []);
          n.a377.get(x.code).push(x);
        }
      }
      NOTES = n;
      return n;
    });
  }

  // ── розбір запиту ────────────────────────────────────────────────────
  function parse(raw) {
    const text = raw.trim();
    if (!text) return { kind: 'empty' };
    let m;
    if ((m = text.match(/^(?:дсг|drg)\s*[:·]?\s*(\S+)$/i))) {
      const c = PMG_SEARCH.code(m[1]);
      return GROUP.has(c) ? { kind: 'drg', code: c } : { kind: 'unknown', what: `ДСГ ${m[1]}` };
    }
    if ((m = text.match(/^одк\s*[:·]?\s*(\d{1,2}\s*-?\s*[a-zа-я]?)$/i))) {
      const num = PMG_SEARCH.code(m[1]).replace('-', '');
      return ODKN.has(num) ? { kind: 'odk', num } : { kind: 'unknown', what: `ОДК ${m[1]}` };
    }
    if ((m = text.match(/^пакет\s*№?\s*(\d{1,2})$/i))) return { kind: 'package', num: m[1] };

    const parts = text.split(/[\s,;]+/).filter(Boolean);
    const dx = [], iv = [], other = [];
    for (const p of parts) {
      const c = PMG_SEARCH.code(p);
      if (RE_ICD.test(c)) dx.push(c);
      else if (RE_ACHI.test(c)) iv.push(c);
      else other.push(p);
    }
    if (!other.length && (dx.length || iv.length)) return { kind: 'case', dx, iv };
    if (parts.length === 1) {
      const c = PMG_SEARCH.code(parts[0]);
      if (RE_ESOZ.test(c) && ESOZM.has(c)) return { kind: 'esoz', code: c };
      if (GROUP.has(c)) return { kind: 'drg', code: c };
    }
    return { kind: 'words', text };
  }

  // ── дані рівнів ──────────────────────────────────────────────────────
  const decode = (x) => (x < 0 ? { i: -x - 1, cond: true } : { i: x, cond: false });
  /* У dx.json ОДК записано ПОРЯДКОВИМ номером у core.odk (21 = «ОДК 21A», 22 = «ОДК 21B»),
     а в групах — порядковим номером у core.mdc. Власний номер ОДК беремо лише з об'єкта. */
  const dxOdk = (code) => (DX[code] ? DX[code][0].map((i) => CORE.odk[i]).filter(Boolean) : []);
  const groupOdk = (g) => (g.mdc || []).map((mi) => CORE.odk.find((o) => o.mdc === CORE.mdc[mi])).filter(Boolean);
  const inGrid = (g) => g && (g.a === 'appendix-1' || g.a === 'appendix-2');

  function dxGroups(code) {
    const d = DX[code];
    if (!d) return [];
    const list = d[3] === 0 ? d[2] : d[3];
    return list.map(decode).map((x) => CORE.groups[x.i]).filter(inGrid);
  }

  function ivGroupsIn(code, odks) {
    const rec = IV[code];
    if (!rec) return [];
    const want = odks.map((o) => o.mdc);
    return rec[1].map((i) => CORE.groups[i]).filter(inGrid)
      .filter((g) => !want.length || (g.mdc || []).some((mi) => want.includes(CORE.mdc[mi])));
  }

  /** Можливі групи випадку за Таблицею співставлення (не групер!). */
  function candidates(dx, ivs) {
    const odk = dxOdk(dx);
    if (!ivs.length) {
      return { groups: dxGroups(dx), rule: 'Втручань немає — група визначається основним діагнозом.' };
    }
    const set = new Map();
    let gi = false, known = 0;
    for (const c of ivs) {
      const rec = IV[c];
      if (!rec) continue;
      known++;
      if (rec[2]) gi = true;
      for (const g of ivGroupsIn(c, odk)) set.set(g.c, g);
    }
    if (set.size) return { groups: [...set.values()], rule: 'Втручання веде до цих груп у межах ОДК основного діагнозу.' };
    if (gi && GROUP.has('801')) {
      return { groups: [GROUP.get('801')], rule: 'Втручання загальне і не належить до ОДК діагнозу — група 801.' };
    }
    return {
      groups: dxGroups(dx),
      rule: known ? 'Втручання не веде до жодної групи в ОДК цього діагнозу — лишається група за діагнозом.'
        : 'Втручання не бере участі в групуванні — група за діагнозом.',
    };
  }

  /** Одна група на корінь (варіант «до 24 годин» ховаємо за основною), важчі — вище. */
  const roots = (groups) => {
    const seen = new Map();
    for (const g of groups) {
      const old = seen.get(g.root);
      if (!old || (old.sfx && !g.sfx)) seen.set(g.root, g);
    }
    return [...seen.values()].sort((a, b) => (b.k[0] || 0) - (a.k[0] || 0));
  };

  function limits(code, isIv) {
    const out = [];
    if (!VAL) return out;
    if (!isIv) {
      const age = VAL.ageDx.find((x) => x[0] === code);
      if (age && VAL.ageUa[age[1]]) out.push('вік: ' + VAL.ageUa[age[1]].join(', '));
      const sex = VAL.sexDx.find((x) => x[0] === code);
      if (sex) out.push(sex[1] === 'FEML' ? 'лише жінки' : 'лише чоловіки');
      if (VAL.exclUncond.includes(code)) out.push('як супутній тяжкості випадку не підвищує');
    } else {
      const sex = VAL.sexIv.find((x) => x[0] === code);
      if (sex) out.push(sex[1] === 'FEML' ? 'лише жінки' : 'лише чоловіки');
      if (VAL.obstIv.includes(code)) out.push('акушерське втручання');
    }
    return out;
  }

  function sum(g) {
    try {
      const res = PMG_TARIFF.calcCase(g, CORE, { share: true, balance: true });
      return { total: res.total, formula: PMG_TARIFF.formulaText(res) };
    } catch (e) { return null; }
  }

  // ── розмітка ─────────────────────────────────────────────────────────
  const chip = (code, q, title) =>
    `<button type="button" class="kr-code" data-q="${esc(q || code)}"${title ? ` title="${esc(title)}"` : ''}>${esc(code)}</button>`;
  const more = (href, text) => `<a class="kr-go" href="${esc(href)}">${esc(text)} →</a>`;
  const tag = (t, cls) => `<span class="kr-tag${cls ? ' ' + cls : ''}">${esc(t)}</span>`;

  function level(key, body, opts) {
    const i = LEVELS.findIndex((l) => l[0] === key);
    if (hidden.has(key)) return '';
    const o = opts || {};
    return `<section class="kr-level${o.entry ? ' kr-entry' : ''}${o.empty ? ' kr-empty' : ''}" data-level="${key}">
      <div class="kr-n" aria-hidden="true">${i + 1}</div>
      <div class="kr-body">
        <h2>${esc(LEVELS[i][1])}${o.entry ? ' <span class="kr-entrytag">вхід</span>' : ''}
          ${o.src ? `<span class="kr-src">${esc(o.src)}</span>` : ''}</h2>
        ${body}
      </div>
    </section>`;
  }

  function dxLine(code) {
    const e = N25.get(code);
    const inChain = !!DX[code];
    const tags = [];
    if (!e) tags.push(tag(inChain ? 'немає в НК 025:2021, є в 11-му виданні' : 'немає в НК 025', 'kr-warn'));
    limits(code, false).forEach((t) => tags.push(tag(t)));
    return `<div class="kr-row"><span class="kr-c">${esc(code)}</span>
      <span class="kr-t">${esc(e ? e.n : 'назви в класифікаторі немає')} ${tags.join(' ')}</span></div>`;
  }

  function ivLine(code) {
    const e = N26.get(code);
    const rec = IV[code];
    const tags = [];
    if (!e) tags.push(tag(rec ? 'немає в НК 026:2021, є в 11-му виданні' : 'немає в НК 026', 'kr-warn'));
    if (e && e.pk && e.pk.length) tags.push(tag('пакети: ' + e.pk.join(', ')));
    if (rec && rec[2]) tags.push(tag('загальне втручання'));
    if (!rec) tags.push(tag('у групуванні не бере участі'));
    limits(code, true).forEach((t) => tags.push(tag(t)));
    return `<div class="kr-row"><span class="kr-c">${esc(code)}</span>
      <span class="kr-t">${esc(e ? e.n : 'назви в класифікаторі немає')} ${tags.join(' ')}</span></div>`;
  }

  function odkBlock(odks) {
    if (!odks.length) return '<p class="kr-none">Діагноз не віднесено до жодної ОДК Таблиці співставлення.</p>';
    return odks.map((o) => `<div class="kr-row">${chip(o.id, o.id)}
        <span class="kr-t">${esc(o.name)} ${tag(nf(o.n) + ' діагнозів')}</span></div>`).join('');
  }

  function drgRows(groups) {
    return groups.map((g) => {
      const k = g.k || [];
      const extra = [];
      if (k[1] != null) extra.push('діти ' + kf(k[1]));
      if (k[2] != null) extra.push('травма ' + kf(k[2]));
      const variant = CORE.groups.some((x) => x.root === g.root && x.sfx) && !g.sfx ? tag('є варіант «до 24 годин»') : '';
      return `<div class="kr-row">${chip(g.c, 'ДСГ ' + g.c)}
        <span class="kr-t">${esc(g.t)} ${tag('вага ' + kf(k[0]))} ${extra.map((x) => tag(x)).join(' ')}
          ${tag(CORE.appendixLabel[g.a] || g.a)} ${variant}</span></div>`;
    }).join('');
  }

  function serviceRows(groups, extraIds) {
    const codes = new Set(groups.map((g) => g.root));
    const rows = SVC.filter((s) => s.c && codes.has(s.c));
    let html = rows.map((s) => `<div class="kr-row"><span class="kr-c">${esc(s.c)}</span>
      <span class="kr-t">${esc(s.n)} ${s.p.map((p) => chip('пакет ' + p, 'пакет ' + p)).join(' ')}
        ${more('../mapping/index.html?service=' + s.i, 'рядок Таблиці')}</span></div>`).join('');
    const others = (extraIds || []).map((i) => SVC[i]).filter((s) => s && !rows.includes(s));
    if (others.length) {
      html += `<details class="kr-fold"${rows.length ? '' : ' open'}><summary>${rows.length ? 'Ще ' : ''}${nf(others.length)} ${others.length === 1 ? 'послуга' : 'послуг'} Таблиці з цим кодом</summary>` +
        others.slice(0, 40).map((s) => `<div class="kr-row"><span class="kr-c">${esc(s.c || '—')}</span>
          <span class="kr-t">${esc(s.n.length > 150 ? s.n.slice(0, 150) + '…' : s.n)} ${s.p.map((p) => tag('пакет ' + p)).join(' ')}</span></div>`).join('') +
        '</details>';
    }
    return html || '<p class="kr-none">Послуги Таблиці співставлення для цих груп не знайдено.</p>';
  }

  function tariffRows(groups) {
    return groups.map((g) => {
      const s = sum(g);
      if (!s) return '';
      return `<div class="kr-row"><span class="kr-c">${esc(g.c)}</span>
        <span class="kr-t"><b class="kr-sum">${nf(s.total, 2)} грн</b>
          <span class="kr-formula">${esc(s.formula)}</span></span></div>`;
    }).join('') + `<p class="kr-fine">Базова сума: ставка ${nf(CORE.rate.case)} грн × вага × частка застосування.
      Вікові, травматичні та інші коефіцієнти пункту 38 тут не враховано.</p>`;
  }

  // ── відповіді ────────────────────────────────────────────────────────
  function renderCase(p) {
    const dx = p.dx[0];
    const addDx = p.dx.slice(1);
    const ivs = p.iv;
    let html = '';
    const q = encodeURIComponent($('krQ').value.trim());

    if (dx) {
      const d = DX[dx];
      const cand = candidates(dx, ivs);
      const groups = roots(cand.groups);
      html += level('dx', dxLine(dx) +
        (addDx.length ? `<p class="kr-fine">Супутні:</p>${addDx.map(dxLine).join('')}` : '') +
        `<div id="krNotes" class="kr-notes"></div>` +
        more('../classifiers/index.html?code=' + encodeURIComponent(dx), 'паспорт коду в НК 025'),
        { entry: true, src: 'НК 025:2021' });
      html += level('odk', odkBlock(dxOdk(dx)), { src: 'Таблиця співставлення, таблиця 2' });
      html += level('iv', ivs.length ? ivs.map(ivLine).join('') +
        more('../classifiers/nk026.html?code=' + encodeURIComponent(ivs[0]), 'паспорт коду в НК 026')
        : '<p class="kr-none">Втручання не вказано. Допишіть код НК 026 через пробіл — побачите хірургічну групу.</p>',
        { src: 'НК 026:2021', empty: !ivs.length, entry: !!ivs.length });
      html += level('grouper', `<p>${esc(cand.rule)}</p>` +
        (groups.length > 1 ? `<p class="kr-fine">Можливих груп ${groups.length}. Котру з них обере ЕСОЗ, визначають правила групування.</p>` : '') +
        (addDx.length ? '<p class="kr-fine">Супутні діагнози тут не враховано: інколи саме вони змінюють групу.</p>' : '') +
        more('grouper.html', 'точне групування — Групер ДСГ (потрібен вхід)'),
        { src: 'попередньо, за Таблицею співставлення' });
      html += level('drg', groups.length ? drgRows(groups)
        : '<p class="kr-none">Цей діагноз не веде до жодної групи з вагою в постанові.</p>',
        { src: 'постанова № 1808, додатки 1 і 2' });
      html += level('service', serviceRows(groups, BY_ICD[dx]), { src: 'Таблиця співставлення, таблиця 1' });
      html += level('tariff', groups.length ? tariffRows(groups) +
        more('index.html?q=' + q, 'повний розрахунок з коефіцієнтами — Кодування випадку')
        : '<p class="kr-none">Немає групи — немає суми.</p>', { src: 'постанова № 1808, пункти 34 і 38' });
      return html;
    }

    // лише втручання
    const groups = roots([].concat(...ivs.map((c) => ivGroupsIn(c, []))));
    const odk = [...new Set([].concat(...groups.map(groupOdk)))];
    html += level('dx', '<p class="kr-none">Діагноз не вказано. Допишіть код НК 025 — ланцюжок звузиться до його ОДК.</p>', { empty: true, src: 'НК 025:2021' });
    html += level('odk', odk.length ? `<p class="kr-fine">Втручання працює в цих ОДК:</p>` + odkBlock(odk)
      : '<p class="kr-none">Втручання не належить до жодної ОДК.</p>', { src: 'Таблиця співставлення' });
    html += level('iv', ivs.map(ivLine).join('') + `<div id="krNotes" class="kr-notes"></div>` +
      more('../classifiers/nk026.html?code=' + encodeURIComponent(ivs[0]), 'паспорт коду в НК 026'),
      { entry: true, src: 'НК 026:2021' });
    html += level('grouper', '<p>Група залежить від основного діагнозу: втручання дає групу лише в межах його ОДК.</p>' +
      more('grouper.html', 'Групер ДСГ (потрібен вхід)'), { src: 'попередньо, за Таблицею співставлення' });
    html += level('drg', groups.length ? drgRows(groups) : '<p class="kr-none">Втручання не веде до груп з вагою в постанові.</p>',
      { src: 'постанова № 1808, додатки 1 і 2' });
    html += level('service', serviceRows(groups, BY_ACHI[ivs[0]]), { src: 'Таблиця співставлення, таблиця 1' });
    html += level('tariff', groups.length ? tariffRows(groups) : '<p class="kr-none">Немає групи — немає суми.</p>',
      { src: 'постанова № 1808, пункти 34 і 38' });
    return html;
  }

  function codeList(codes, map, label) {
    const CAP = 60;
    const rows = codes.slice(0, CAP).map((c) => chip(c, c, (map.get(c) || {}).n)).join(' ');
    return `<p class="kr-fine">${esc(label)}: ${nf(codes.length)}${codes.length > CAP ? `, показано перші ${CAP}` : ''}</p>
      <div class="kr-chips">${rows}</div>`;
  }

  function renderDrg(p) {
    const g = GROUP.get(p.code);
    const same = CORE.groups.filter((x) => x.root === g.root && inGrid(x));
    const dxs = Object.keys(DX).filter((c) => dxGroups(c).some((x) => x.root === g.root));
    const ivs = Object.keys(IV).filter((c) => (IV[c][1] || []).some((i) => CORE.groups[i].root === g.root));
    const amb = N25.has(p.code) ? `<p class="kr-fine">${esc(p.code)} — це ще й код діагнозу «${esc(N25.get(p.code).n)}».
      ${chip('показати діагноз ' + p.code, p.code)}</p>` : '';
    let html = '';
    html += level('dx', dxs.length ? codeList(dxs, N25, 'Діагнозів, що ведуть у групу як основні')
      : '<p class="kr-none">Жоден діагноз не веде в групу напряму — вона визначається втручанням.</p>', { src: 'Таблиця співставлення' });
    html += level('odk', odkBlock(groupOdk(g)), { src: 'Таблиця співставлення' });
    html += level('iv', ivs.length ? codeList(ivs, N26, 'Втручань, що ведуть у групу')
      : '<p class="kr-none">Група терапевтична: втручання для неї не потрібне.</p>', { src: 'Таблиця співставлення' });
    html += level('grouper', '<p>Потрапити в групу можна, якщо основний діагноз належить до її ОДК, а втручання — до її переліку.</p>' +
      more('grouper.html', 'Групер ДСГ (потрібен вхід)'), { src: 'попередньо' });
    html += level('drg', amb + drgRows(same) + more('../drg/index.html?code=' + encodeURIComponent(g.root), 'паспорт групи в Інструментах ДСГ'),
      { entry: true, src: 'постанова № 1808, додатки 1 і 2' });
    html += level('service', serviceRows([g]), { src: 'Таблиця співставлення, таблиця 1' });
    html += level('tariff', tariffRows(same), { src: 'постанова № 1808, пункти 34 і 38' });
    return html;
  }

  function renderOdk(p) {
    const o = ODKN.get(p.num);
    const groups = roots(CORE.groups.filter((g) => inGrid(g) && groupOdk(g).includes(o)));
    const dxs = Object.keys(DX).filter((c) => DX[c][0].includes(o._i));
    let html = '';
    html += level('dx', codeList(dxs, N25, 'Діагнозів в ОДК'), { src: 'Таблиця співставлення, таблиця 2' });
    html += level('odk', `<div class="kr-row"><span class="kr-c">${esc(o.id)}</span><span class="kr-t">${esc(o.name)}</span></div>` +
      more('../mapping/index.html?odk=' + encodeURIComponent(o.id), 'склад ОДК у Таблиці співставлення'),
      { entry: true, src: 'Таблиця співставлення, таблиця 2' });
    html += level('drg', groups.length ? `<p class="kr-fine">Груп у цій ОДК: ${groups.length}</p>` + drgRows(groups)
      : '<p class="kr-none">У цій ОДК немає груп з вагою в постанові.</p>', { src: 'постанова № 1808' });
    return html;
  }

  function renderPackage(p) {
    const rows = SVC.filter((s) => s.p.includes(p.num));
    if (!rows.length) return `<p class="kr-none">У Таблиці співставлення немає послуг пакета ${esc(p.num)}.</p>`;
    const body = rows.slice(0, 120).map((s) => `<div class="kr-row">${s.c && GROUP.has(s.c) ? chip(s.c, 'ДСГ ' + s.c) : `<span class="kr-c">${esc(s.c || '—')}</span>`}
      <span class="kr-t">${esc(s.n.length > 160 ? s.n.slice(0, 160) + '…' : s.n)}
        ${s.k && s.k[0] && s.k[0].k[0] ? tag('вага ' + s.k[0].k[0]) : ''}</span></div>`).join('');
    return level('service', `<p class="kr-fine">Послуг пакета ${esc(p.num)} у Таблиці співставлення: ${nf(rows.length)}</p>${body}` +
      more('../mapping/index.html', 'Таблиця співставлення'), { entry: true, src: 'Таблиця співставлення, таблиця 1' });
  }

  function renderEsoz(p) {
    const e = ESOZM.get(p.code);
    const alt = e.v > 1 ? '<p class="kr-fine">У листах НСЗУ ця послуга названа інакше — варіанти в довіднику ЕСОЗ.</p>' : '';
    return `<section class="kr-level kr-entry"><div class="kr-n" aria-hidden="true">•</div><div class="kr-body">
      <h2>Послуга ЕСОЗ <span class="kr-src">назва — за переліком у виданні НК 026</span></h2>
      <div class="kr-row"><span class="kr-c">${esc(e.c)}</span><span class="kr-t">${esc(e.n)}
        ${e.t && /[а-яіїє]/i.test(e.t) ? tag(e.t) : ''} ${(e.p || []).map((x) => chip('пакет ' + x, 'пакет ' + x)).join(' ')}</span></div>
      ${alt}${more('../classifiers/esoz.html?code=' + encodeURIComponent(e.c), 'картка в довіднику ЕСОЗ')}
    </div></section>`;
  }

  function renderWords(p) {
    const blocks = [];
    let notes = [];
    const one = (title, list, map, toQ, getName) => {
      const r = PMG_FIND.search(list, p.text);
      if (!r.items.length) return;
      if (r.note) notes.push(r.note);
      r.items.sort((a, b) => b.score - a.score || (a.e.c < b.e.c ? -1 : 1));
      const CAP = 12;
      blocks.push(`<section class="kr-found"><h2>${esc(title)} <span class="kr-src">${nf(r.items.length)}</span></h2>` +
        r.items.slice(0, CAP).map((x) => `<button type="button" class="kr-hit" data-q="${esc(toQ(x.e))}">
          <span class="kr-c">${esc(x.e.c)}</span><span class="kr-t">${esc(getName(x.e))}</span></button>`).join('') +
        (r.items.length > CAP ? `<p class="kr-fine">Показано ${CAP} з ${nf(r.items.length)}. Уточніть запит або відкрийте довідник.</p>` : '') +
        '</section>');
    };
    one('Діагнози · НК 025', NK025, N25, (e) => e.c, (e) => e.n);
    one('Втручання · НК 026', NK026.filter((e) => RE_ACHI.test(e.c)), N26, (e) => e.c, (e) => e.n);
    one('Групи · ДСГ', CORE.groups.filter((g) => inGrid(g) && !g.sfx), GROUP, (g) => 'ДСГ ' + g.c, (g) => g.t);
    if (!blocks.length) return `<p class="kr-none">За словами «${esc(p.text)}» нічого не знайдено ні в НК 025, ні в НК 026, ні серед ДСГ.</p>`;
    notes = [...new Set(notes)];
    return (notes.length ? `<p class="kr-fine">${esc(notes.join(' · '))}</p>` : '') + blocks.join('');
  }

  function welcome() {
    return `<div class="kr-welcome">
      <p>Уведіть код — побачите весь його шлях: до якої ОДК належить, у які групи веде, якою послугою
        Таблиці співставлення закривається і скільки це в гривнях.</p>
      <p>Починати можна з будь-якого рівня: з діагнозу, втручання, групи, ОДК чи пакета. Не знаєте коду —
        пишіть словами.</p>
    </div>`;
  }

  // ── примітки до рівня (накази, листи) ────────────────────────────────
  function fillNotes(codes) {
    const box = $('krNotes');
    if (!box) return;
    loadNotes().then((n) => {
      if ($('krNotes') !== box) return;
      const out = [];
      for (const c of codes) {
        const r = n.r182.get(c);
        if (r) {
          const w = n.wording[r.w];
          out.push(`${esc(c)} · наказ № 182 (реабілітація): ${esc((r.cats || []).join(', '))}` +
            (w ? `; основним — ${esc(String(w.text || w).toLowerCase())}` : '') +
            ` ${more('../algorithms/rehab.html', 'наказ 182')}`);
        }
        const a = n.a377.get(c);
        if (a) out.push(`${esc(c)} · наказ № 377: ${esc([...new Set(a.map((x) => x.source_title))].join('; '))} ${more('../algorithms/index.html?code=' + encodeURIComponent(c), 'наказ 377')}`);
        const kind = RE_ACHI.test(c) ? 'achi' : 'icd';
        const docs = (n.roz[kind] || {})[c];
        if (docs && docs.length) out.push(`${esc(c)} · згадано в роз'ясненнях НСЗУ: ${nf(docs.length)} ${more('../rozjasnennya/index.html?doc=' + docs[0].d, 'відкрити перше')}`);
      }
      box.innerHTML = out.length ? '<p class="kr-fine">Примітки до коду:</p><ul>' + out.map((x) => `<li>${x}</li>`).join('') + '</ul>' : '';
    });
  }

  // ── керування ────────────────────────────────────────────────────────
  function run() {
    if (!CORE) return;
    const raw = $('krQ').value;
    const p = parse(raw);
    let html = '', status = '';
    const url = new URL(location.href);
    if (raw.trim()) url.searchParams.set('q', raw.trim()); else url.searchParams.delete('q');
    url.searchParams.delete('code');
    history.replaceState(null, '', url);

    if (p.kind === 'empty') { html = welcome(); }
    else if (p.kind === 'unknown') { html = `<p class="kr-none">${esc(p.what)} — такого коду немає.</p>`; }
    else if (p.kind === 'case') {
      const badDx = p.dx.filter((c) => !N25.has(c) && !DX[c]);
      const badIv = p.iv.filter((c) => !N26.has(c) && !IV[c]);
      if (badDx.length || badIv.length) {
        status = `<span class="kr-err">Немає в класифікаторах: ${esc(badDx.concat(badIv).join(', '))}. Перевірте код.</span>`;
      }
      const dx = p.dx.filter((c) => !badDx.includes(c)), iv = p.iv.filter((c) => !badIv.includes(c));
      if (dx.length || iv.length) {
        html = renderCase({ dx, iv });
        if (dx.length === 1 && !iv.length && GROUP.has(dx[0])) {
          status += ` ${esc(dx[0])} — це ще й код ДСГ «${esc(GROUP.get(dx[0]).t)}». ${chip('показати групу', 'ДСГ ' + dx[0])}`;
        }
      }
    }
    else if (p.kind === 'drg') html = renderDrg(p);
    else if (p.kind === 'odk') html = renderOdk(p);
    else if (p.kind === 'package') html = renderPackage(p);
    else if (p.kind === 'esoz') html = renderEsoz(p);
    else html = renderWords(p);

    $('krStatus').innerHTML = status;
    $('krOut').innerHTML = html;
    if (p.kind === 'case') fillNotes(p.dx.concat(p.iv).slice(0, 4));
  }

  function renderLevelChips() {
    $('krLevels').innerHTML = LEVELS.map(([k, t], i) =>
      `<button type="button" class="kr-lv" data-level="${k}" aria-pressed="${!hidden.has(k)}">${i + 1} ${esc(t)}</button>`).join('');
  }

  function bind() {
    let timer = 0;
    $('krQ').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 220); });
    $('krQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(); } });
    $('krClear').addEventListener('click', () => { $('krQ').value = ''; run(); $('krQ').focus(); });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (b) {
        $('krQ').value = b.dataset.q.trim();
        run();
        window.scrollTo({ top: $('krQ').getBoundingClientRect().top + window.scrollY - 90 });
        return;
      }
      const lv = e.target.closest('.kr-lv');
      if (lv) {
        const k = lv.dataset.level;
        if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
        try { localStorage.setItem('koder-hidden', JSON.stringify([...hidden])); } catch (err) { /* без сховища */ }
        renderLevelChips();
        run();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
