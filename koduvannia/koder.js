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
 *   точна група      — grouper.js (той самий модуль, що на сторінці «Групер ДСГ»).
 *   послуги ЕСОЗ     — classifiers/data/esoz (картки), algorithms/data/ambulatory_9.json
 *                      (як послугу обліковують у пакеті 9: клас, хто надає, коди спостережень);
 *   LOINC            — classifiers/data/loinc/loinc_pmg.json: назви лише тих кодів, що
 *                      трапляються в документах НСЗУ. Повний довідник — окрема сторінка.
 * Дані, потрібні не кожному запиту (картки ЕСОЗ, пакет 9, LOINC), довантажуються за першою
 * потребою — див. need().
 * Рівень «Групер»: тим, хто ввійшов у портал, Кодер показує точну групу з урахуванням
 * супутніх діагнозів — правила групування лежать у базі під замком. Без входу — лише
 * перелік можливих груп за Таблицею співставлення.
 * Рівень «Тариф»: базова сума плюс «Умови випадку» — коефіцієнти пункту 38, які рахує
 * спільний модуль pmg-tariff.js.
 * Перевірка тексту: якщо в поле вставлено абзац чи цілий лист, Кодер знаходить у ньому всі
 * коди й про кожен каже, чи є він у класифікаторі і як набраний (див. scanText). Текст
 * опрацьовується лише в браузері; в адресу сторінки й у сховище він не потрапляє.
 */
(function () {
  'use strict';

  const V = 'v=20261119a';
  const GROUPER = './grouper.js?v=20261120a';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d) => Number(n).toLocaleString('uk-UA', d == null ? {} : { minimumFractionDigits: d, maximumFractionDigits: d });
  const kf = (v) => String(v).replace('.', ',');
  const days = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'доба' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'доби' : 'діб');
  const LEVELS = [
    ['dx', 'Діагноз'], ['odk', 'ОДК'], ['iv', 'Втручання'], ['grouper', 'Групер'],
    ['drg', 'ДСГ'], ['service', 'Таблиця співставлення'], ['tariff', 'Тариф'],
  ];
  const RE_ICD = /^[A-Z]\d{2}(\.\d{1,2})?$/;
  const RE_ACHI = /^\d{5}-\d{2}$/;
  const RE_ESOZ = /^[A-Z]\d{5}$/;
  const RE_POS = /^P\d{1,3}$/;          // посада ЕСОЗ; P10…P99 виглядають як код НК 025
  const RE_LOINC = /^\d{1,7}-\d$/;      // у НК 026 після дефіса дві цифри, у LOINC — одна

  let CORE, DX, IV, VAL, NK025, NK026, SVC, BY_ICD, BY_ACHI, ESOZ;
  const N25 = new Map(), N26 = new Map(), GROUP = new Map(), ODKN = new Map(), ESOZM = new Map();
  let NOTES = null;                 // накази 377, 182, роз'яснення — довантажуються після першої відповіді
  let notesWait = null;
  let hidden = new Set();
  let EXACT = null;                 // модуль grouper.js із піднятими правилами
  let exactState = 'idle';          // idle · loading · ready · guest · error
  let exactInfo = {};               // версія правил і дата, або текст помилки
  const COND = {};                  // «Умови випадку»: id коефіцієнта пункту 38 → значення
  let condOpen = false;
  let mode = '';                    // вид останньої відповіді (parse().kind)
  let lastText = null;              // текст, з якого перейшли до картки коду; живе лише в пам'яті сторінки
  let ESOZ_LETTERS = new Set();     // з яких літер починаються коди послуг ЕСОЗ

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
    for (const e of ESOZ) { e._t = PMG_SEARCH.text(e.n); ESOZM.set(e.c, e); }
    ESOZ_LETTERS = new Set(ESOZ.filter((e) => RE_ESOZ.test(e.c)).map((e) => e.c[0]));
    CORE.groups.forEach((g, i) => { g._i = i; g._t = PMG_SEARCH.text(g.t); GROUP.set(g.c, g); });
    CORE.odk.forEach((o, i) => { o._i = i; ODKN.set(PMG_SEARCH.code(o.num), o); });
    if (window.PMG_FIND) PMG_FIND.ready().then(() => { if ($('krQ').value.trim()) run(); });

    const q = new URLSearchParams(location.search).get('q') || new URLSearchParams(location.search).get('code');
    if (q) $('krQ').value = q;
    fit();
    run();
    loadExact();
  }

  /* Точний групер. Логіка — у grouper.js, тут лише виклик: копії правил вибору групи
     в Кодері немає. Правила модуль бере з бази під замком, тож без входу в портал
     він чесно відмовляє, і рівень «Групер» лишається попереднім. */
  function loadExact() {
    exactState = 'loading';
    let mod;
    Promise.resolve()
      .then(() => import(GROUPER))
      .then((m) => { mod = m; return m.load({ core: CORE, dx: DX, iv: IV }); })
      .then((info) => { EXACT = mod; exactInfo = info || {}; exactState = 'ready'; })
      .catch((e) => {
        const msg = String((e && e.message) || e || '');
        exactState = /НЕМАЄ СЕСІЇ|СЕСІЯ ЗАСТАРІЛА/.test(msg) ? 'guest' : 'error';
        exactInfo = { error: msg };
      })
      .then(() => { if ($('krQ').value.trim()) run(); });
  }

  function exact(dx, add, ivs) {
    if (!EXACT) return null;
    try { return EXACT.group(dx, add, ivs); } catch (e) { return { error: 'Групер не зміг опрацювати цей випадок.' }; }
  }

  /* Дані, потрібні не кожному запиту. need('cards', 'amb') повертає true, коли все названо
     вже на місці (або не завантажилось — тоді відповідь будується без цього шматка);
     інакше запускає завантаження і після нього перемальовує відповідь. */
  const LAZY = {
    cards: { url: '../classifiers/data/esoz/esoz_cards.json' },
    amb: { url: '../algorithms/data/ambulatory_9.json', prep: indexAmb },
    loinc: { url: '../classifiers/data/loinc/loinc_pmg.json', prep: indexLoinc },
    docs: { url: '../rozjasnennya/data/index.json', prep: (d) => new Map((d.documents || []).map((x) => [x.id, x.title || ''])) },
  };

  function need(...keys) {
    let ready = true;
    for (const k of keys) {
      const z = LAZY[k];
      if (z.data || z.failed) continue;
      ready = false;
      if (!z.wait) {
        z.wait = get(z.url).then((d) => { z.data = z.prep ? z.prep(d) : d; }, () => { z.failed = true; })
          .then(() => { z.wait = null; run(); });
      }
    }
    return ready;
  }

  const pushTo = (map, key, v) => { if (!map.has(key)) map.set(key, []); map.get(key).push(v); };

  /* Пакет 9: рядки додатків чинного листа НСЗУ. Індекси — за кодом послуги, за кодом
     спостереження (LOINC) і за посадою, що надає послугу. */
  function indexAmb(a) {
    const x = { byCode: new Map(), byObs: new Map(), byPos: new Map(), flags: a.flags || {},
      letter: (a.basis || {}).letter || {}, pos: a.pos_names || {}, odk: a.odk_names || {},
      sv: new Map((a.services || []).map((s) => [s.key, s.name])),
      flag: new Map((a.flag_catalogue || []).map((f) => [f.key, f.title])) };
    for (const r of a.records || []) {
      pushTo(x.byCode, r.code, r);
      for (const o of r.obs || []) if (RE_LOINC.test(o)) pushTo(x.byObs, o, r);
      for (const ps of r.pos || []) pushTo(x.byPos, ps, r);
    }
    return x;
  }

  function indexLoinc(d) {
    d.list = Object.keys(d.codes).map((c) => ({ c, n: d.codes[c].n, _t: PMG_SEARCH.text(d.codes[c].n + ' · ' + d.codes[c].e) }));
    return d;
  }

  function loadNotes() {
    if (NOTES) return Promise.resolve(NOTES);
    if (notesWait) return notesWait;
    return notesWait = Promise.all([
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
    if ((m = text.match(/^(?:посада|есоз|esoz)\s*[:·]?\s*(\S+)$/i))) {
      const c = PMG_SEARCH.code(m[1]);
      return ESOZM.has(c) ? { kind: 'esoz', code: c } : { kind: 'unknown', what: `Код ЕСОЗ ${m[1]}` };
    }
    if ((m = text.match(/^(?:loinc|лоінк|лоїнк)\s*[:·]?\s*(\S+)$/i))) {
      const c = PMG_SEARCH.code(m[1]);
      return RE_LOINC.test(c) ? { kind: 'loinc', code: c } : { kind: 'unknown', what: `Код LOINC ${m[1]}` };
    }

    const parts = text.split(/[\s,;]+/).filter(Boolean);
    if (parts.length === 1) {
      const c = PMG_SEARCH.code(parts[0]);
      if (RE_LOINC.test(c)) return { kind: 'loinc', code: c };
      // посада ЕСОЗ, якщо такого коду діагнозу немає (P8, P126; P13 — діагноз, посада через «посада P13»)
      if (RE_POS.test(c) && ESOZM.has(c) && !N25.has(c) && !DX[c]) return { kind: 'esoz', code: c };
    }
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
      if (RE_ESOZ.test(c)) return { kind: 'unknown', what: `Код послуги ЕСОЗ ${c}`, why: 'у довіднику, зібраному з документів НСЗУ, такого немає' };
    }
    // абзац або лист: якщо в ньому є хоч один код — перевіряємо коди, а не шукаємо за словами
    if (isText(text)) {
      const scan = scanText(text);
      if (scan.items.length) return { kind: 'text', text, scan };
    }
    return { kind: 'words', text };
  }

  // ── перевірка кодів у тексті ─────────────────────────────────────────
  /* Людина вставляє абзац або цілий лист — Кодер знаходить у ньому коди й про кожен каже,
     чи є він у своєму класифікаторі і як набраний. Розпізнаються коди, набрані великими
     літерами. Чи велика літера — кириличний двійник латинської, вирішує PMG_SEARCH.code:
     власної таблиці літер тут немає. Дати, номери листів, суми й телефони відсіюються
     межами (що стоїть упритул до запису) і контрольною цифрою LOINC. */
  const TXT_MIN = 7;                               // від скількох слів запит — це вже текст
  const AL = '0-9A-Za-zА-Яа-яІЇЄҐіїєґ';
  const UP = 'A-ZА-ЯІЇЄҐ';
  const RE_AL = new RegExp('[' + AL + ']');
  const ICD_SRC = '[' + UP + ']\\d{2}(?:\\.\\d{1,2})?';
  // порядок — це першість: запис, який забрав свій шматок тексту, нижчим у переліку не дістається
  const TEXT_PATTERNS = [
    ['odk', new RegExp('(?:ОДК|одк)\\s*№?\\s*(\\d{1,2}[' + UP + ']?)', 'g')],
    ['drgnum', /(?:ДСГ|дсг|DRG|drg)\s*[:№]?\s*(\d{3}(?:\.\d)?)/g],        // 801, 961.0 — лише після слова
    ['achi', /\d{5}-\d{2}/g],
    ['dash1', /\d{1,7}-\d/g],                                           // LOINC або обірваний код НК 026
    ['esoz', new RegExp('[' + UP + ']\\d{5}', 'g')],
    ['range', new RegExp('(' + ICD_SRC + ')\\s?-\\s?(' + ICD_SRC + ')', 'g')],
    ['drgx', new RegExp('[' + UP + ']\\d{2}(?:[' + UP + '](?:-\\d{2})?|-\\d{2}|-[' + UP + '])', 'g')],  // C16A, B06-01, B02-A
    ['icd', new RegExp(ICD_SRC, 'g')],
    ['pos', new RegExp('[' + UP + ']\\d{1,3}', 'g')],
  ];
  const RE_CTX_DRG = /(?:дсг|drg|діагностично-споріднен\S*\s+груп\S*)\s*[:«"“(№]?\s*$/i;
  const RE_CTX_GROUP = /груп\S{0,3}\s*[:«"“(]?\s*$/i;
  const RE_CTX_POS = /посад\S*\s*(?:есоз\s*)?[:«"“(]?\s*$/i;
  const RE_CTX_ESOZ = /(?:послуг\S*|есоз|esoz)\s*[:«"“(]?\s*$/i;
  const RE_CTX_LOINC = /(?:loinc|лоінк|лоїнк)[^.;\n]{0,24}$/i;
  const RE_CTX_VITAMIN = /(?:вітамін\S*|vitamin\S*|віт\.)\s*$/i;
  const RE_CHAIN = /^\s*(?:[,;/]|та|і|й|або|чи)?\s*$/i;                  // «ДСГ I10, I68 та B01»
  const KIND = { icd: 'НК 025', range: 'діапазон НК 025', achi: 'НК 026', drg: 'ДСГ', odk: 'ОДК',
    esoz: 'послуга ЕСОЗ', pos: 'посада ЕСОЗ', loinc: 'LOINC' };
  const KIND_ORDER = Object.keys(KIND);

  const isText = (s) => /\S\s*\n\s*\S/.test(s) || s.trim().split(/\s+/).filter(Boolean).length >= TXT_MIN;
  const plural = (n, f) => f[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 1 : 2];

  /* Контрольна цифра LOINC (алгоритм Луна). «3-5 днів» чи «стаття 351-1» її не проходять. */
  function luhn(code) {
    const [num, d] = code.split('-');
    let sum = 0;
    [...num].reverse().forEach((ch, i) => { let v = +ch; if (i % 2 === 0) { v *= 2; if (v > 9) v -= 9; } sum += v; });
    return (10 - sum % 10) % 10 === +d;
  }

  /* Що стоїть упритул до запису: «19198-08-26» і «10473/8-15-26» — номери листів, «2026-11-20» —
     дата, «В12-дефіцитна» — вітамін, а не коди. */
  function edges(kind, t, a, b, taken) {
    const p = t[a - 1] || '', n = t[b] || '', n2 = t[b + 1] || '';
    if (RE_AL.test(p) || RE_AL.test(n)) return false;
    if (kind === 'achi' || kind === 'dash1') {
      if (p === '-' || n === '-') return false;
      // після косої риски — лише якщо перед нею теж код втручання («30445-00/30446-00»)
      if (p === '/' && !(kind === 'achi' && taken.some((s) => s[1] === a - 1))) return false;
      if (kind === 'dash1' && (/[.,]/.test(p) || (/[.,]/.test(n) && /\d/.test(n2)))) return false;
      return true;
    }
    if (p === '-') return false;
    if (n === '.' && /\d/.test(n2)) return false;
    if (kind === 'icd' && n === '-' && RE_AL.test(n2)) return false;
    return true;
  }

  function icdCheck(code) {
    const e = N25.get(code);
    if (e) return { name: e.n, flags: [] };
    if (DX[code]) return { name: '', flags: [['ed11', 'немає в НК 025:2021, є в 11-му виданні']] };
    let up = code, near = null;
    while (up.length > 3 && !near) { up = up.slice(0, -1).replace(/\.$/, ''); if (N25.has(up)) near = [up]; }
    return { name: '', flags: [['none', 'коду немає в НК 025']], near };
  }

  function rangeItem(a, b) {
    const flags = [];
    const lo = a < b ? a : b, hi = (a < b ? b : a) + '￿';
    const plain = !a.includes('.') && !b.includes('.');
    let count = 0;
    for (const e of NK025) if (e.c >= lo && e.c <= hi && (!plain || e.c.length === 3)) count++;
    if (a > b) flags.push(['rev', 'межі діапазону переставлено']);
    const miss = [a, b].filter((c) => !N25.has(c) && !DX[c]);
    if (miss.length) flags.push(['end', (miss.length > 1 ? 'меж ' : 'межі ') + miss.join(' і ') + ' немає в НК 025']);
    return { kind: 'range', code: a + '-' + b, ends: [a, b].filter((c) => N25.has(c) || DX[c]), flags,
      name: `у діапазоні ${nf(count)} ${plain ? plural(count, ['рубрика', 'рубрики', 'рубрик']) : plural(count, ['код', 'коди', 'кодів'])} НК 025` };
  }

  /* Один знайдений запис → що це за код і що з ним не так. null — це не код. */
  function classify(c, lead, chained, prev, L, loincCtx) {
    const ctx = (re, name) => re.test(lead) || (chained && prev.ctx === name);
    const none = (kind, code, why, extra) => Object.assign({ kind, code, name: '', flags: [['none', why]] }, extra);
    if (c.kind === 'odk') {
      const o = ODKN.get(PMG_SEARCH.code(c.raw));
      return o ? { kind: 'odk', code: o.id, name: o.name, q: o.id, flags: [] }
        : none('odk', 'ОДК ' + c.raw, 'такої ОДК немає в Таблиці співставлення');
    }
    if (c.kind === 'drgnum') {
      const g = GROUP.get(c.raw);
      return g ? { kind: 'drg', code: g.c, name: g.t, q: 'ДСГ ' + g.c, flags: [], ctx: 'drg' }
        : none('drg', c.raw, 'такої діагностично-спорідненої групи немає', { ctx: 'drg' });
    }
    if (c.kind === 'achi') {
      const e = N26.get(c.raw);
      if (e) return { kind: 'achi', code: c.raw, name: e.n, q: c.raw, flags: [] };
      if (IV[c.raw]) return { kind: 'achi', code: c.raw, name: '', q: c.raw, flags: [['ed11', 'немає в НК 026:2021, є в 11-му виданні']] };
      return none('achi', c.raw, 'коду немає в НК 026', { near: NK026.filter((x) => x.c.startsWith(c.raw.slice(0, 6))).map((x) => x.c).slice(0, 8) });
    }
    if (c.kind === 'dash1') {
      const e = L && L.codes[c.raw];
      if (e) return { kind: 'loinc', code: c.raw, name: e.n, q: c.raw, flags: [], ctx: 'loinc' };
      const num = c.raw.split('-')[0];
      if (num.length === 5) {
        const full = [...new Set(NK026.map((x) => x.c).concat(Object.keys(IV)).filter((x) => x.startsWith(c.raw)))];
        if (full.length) {
          return { kind: 'achi', code: c.raw, name: '', near: full.slice(0, 8),
            flags: [['cut', 'обірваний код: після дефіса в НК 026 дві цифри']] };
        }
      }
      const unsure = { kind: 'loinc', code: c.raw, name: '', flags: [], ctx: 'loinc', loose: true };
      if (ctx(RE_CTX_LOINC, 'loinc')) {
        return luhn(c.raw) ? unsure : none('loinc', c.raw, 'такого коду LOINC не існує: не сходиться контрольна цифра', { ctx: 'loinc' });
      }
      return loincCtx && num.length >= 3 && luhn(c.raw) ? unsure : null;
    }
    if (c.kind === 'range') {
      const a = PMG_SEARCH.code(c.m[1]), b = PMG_SEARCH.code(c.m[2]);
      return RE_ICD.test(a) && RE_ICD.test(b) ? rangeItem(a, b) : null;
    }
    const code = PMG_SEARCH.code(c.raw);
    if (!/^[A-Z0-9.-]+$/.test(code)) return null;          // лишилась кирилиця без латинського двійника — це не код
    if (c.kind === 'esoz') {
      const e = ESOZM.get(code);
      if (e) return { kind: 'esoz', code, name: e.n, q: code, flags: [], ctx: 'esoz' };
      return ESOZ_LETTERS.has(code[0]) || ctx(RE_CTX_ESOZ, 'esoz')
        ? none('esoz', code, 'у довіднику ЕСОЗ, зібраному з документів НСЗУ, такого коду немає', { ctx: 'esoz' }) : null;
    }
    const hard = ctx(RE_CTX_DRG, 'drg');
    const drg = (g) => ({ kind: 'drg', code: g.c, name: g.t, q: 'ДСГ ' + g.c, flags: [], ctx: 'drg' });
    if (c.kind === 'drgx') {
      if (GROUP.has(code)) return drg(GROUP.get(code));
      const r = code.match(/^([A-Z])(\d{2})-(\d{2})$/);                // «I60-64» — скорочений діапазон
      if (r && !hard && +r[3] > +r[2]) return rangeItem(r[1] + r[2], r[1] + r[3]);
      return hard ? none('drg', code, 'такої діагностично-спорідненої групи немає', { ctx: 'drg' }) : null;
    }
    const pos = (ok) => (ok ? { kind: 'pos', code, name: ESOZM.get(code).n, q: 'посада ' + code, flags: [], ctx: 'pos' }
      : none('pos', code, 'такої посади в довіднику ЕСОЗ немає', { ctx: 'pos' }));
    if (c.kind === 'pos') {
      if (!RE_POS.test(code)) return null;
      const named = ctx(RE_CTX_POS, 'pos');
      // без слова «посада» — лише тризначні коди (P104): «P8» чи «Р2» можуть бути чим завгодно
      if (ESOZM.has(code) && (named || code.length === 4)) return pos(true);
      return named ? pos(false) : null;
    }
    // c.kind === 'icd'
    if (!RE_ICD.test(code) || RE_CTX_VITAMIN.test(lead)) return null;
    const bare = !code.includes('.');
    if (bare && GROUP.has(code) && (hard || RE_CTX_GROUP.test(lead))) return drg(GROUP.get(code));
    if (bare && hard) return none('drg', code, 'такої діагностично-спорідненої групи немає', { ctx: 'drg' });
    if (RE_POS.test(code) && ctx(RE_CTX_POS, 'pos')) return pos(ESOZM.has(code));
    const r = icdCheck(code);
    const absent = r.flags.some((f) => f[0] === 'none');
    if (bare && absent) {
      if (GROUP.has(code)) return drg(GROUP.get(code));
      if (RE_POS.test(code) && ESOZM.has(code)) return pos(true);
    }
    return { kind: 'icd', code, name: r.name, q: absent ? '' : code, flags: r.flags, near: r.near };
  }

  /** Усі коди в тексті. Повертає { items, mentions, wait, raw }: один запис на код, з лічильником згадок. */
  function scanText(raw) {
    const text = raw.replace(/[‐‑‒–—−]/g, '-').replace(/ /g, ' ');   // довжина рядка не міняється
    const taken = [], cands = [];
    const free = (a, b) => !taken.some((s) => a < s[1] && b > s[0]);
    for (const [kind, re] of TEXT_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        // у «ОДК 8» і «ДСГ 801» код — дужка в кінці, слово перед нею — лише ознака
        const led = kind === 'odk' || kind === 'drgnum';
        const str = led ? m[1] : m[0];
        const a = m.index + m[0].length - str.length, b = a + str.length;
        if (led && RE_AL.test(text[m.index - 1] || '')) continue;
        if (!free(a, b) || !edges(kind, text, a, b, taken)) continue;
        taken.push([a, b]);
        cands.push({ kind, a, b, raw: str, m });
      }
    }
    cands.sort((x, y) => x.a - y.a);

    // LOINC: назви — у витягу, який довантажується за потребою; після нього відповідь перемалюється
    const dashy = cands.filter((c) => c.kind === 'dash1');
    const wait = dashy.length ? !need('loinc') : false;
    const L = LAZY.loinc.data;
    const loincCtx = /loinc|лоінк|лоїнк/i.test(text) || dashy.some((c) => L && L.codes[c.raw]);

    const byKey = new Map();
    let prev = null, mentions = 0;
    for (const c of cands) {
      const lead = text.slice(Math.max(0, c.a - 60), c.a);
      const chained = !!prev && RE_CHAIN.test(text.slice(prev.b, c.a));
      const hit = classify(c, lead, chained, prev, L, loincCtx);
      if (!hit) continue;
      hit.b = c.b;
      prev = hit;
      mentions++;
      // кирилиця: запис після нормалізації відрізняється від набраного (ОДК і числові коди не чіпаємо)
      const typed = c.raw.toUpperCase().replace(/\s+/g, '');
      const cyr = !['odk', 'loinc', 'achi'].includes(hit.kind) && c.kind !== 'drgnum' && PMG_SEARCH.code(c.raw) !== typed
        ? [...typed].filter((ch) => ch.charCodeAt(0) > 127) : [];
      const key = hit.kind + '|' + hit.code;
      let it = byKey.get(key);
      if (!it) { it = Object.assign(hit, { n: 0, a: c.a, at: [c.a, c.b], cyrN: 0, cyrL: new Set() }); byKey.set(key, it); }
      it.n++;
      if (cyr.length) {
        if (!it.cyrN) it.at = [c.a, c.b];                  // у витягу показуємо місце з кирилицею
        it.cyrN++;
        cyr.forEach((ch) => it.cyrL.add(ch));
      }
    }
    const items = [...byKey.values()];
    for (const it of items) {
      if (!it.cyrN) continue;
      const l = [...it.cyrL];
      it.flags.push(['cyr', `набрано кирилицею: ${l.length > 1 ? 'літери' : 'літера'} ${l.map((x) => '«' + x + '»').join(', ')}` +
        (it.cyrN < it.n ? ` — у ${it.cyrN} з ${it.n} згадок` : '')]);
    }
    return { items, mentions, wait, raw };
  }

  /* Шматок тексту довкола коду — щоб знайти місце в листі. Лишається на екрані, нікуди не йде. */
  function snippet(raw, a, b) {
    let from = Math.max(0, a - 44), to = Math.min(raw.length, b + 44);
    if (from > 0) { const sp = raw.indexOf(' ', from); if (sp > -1 && sp < a) from = sp + 1; }
    if (to < raw.length) { const sp = raw.lastIndexOf(' ', to); if (sp >= b) to = sp; }
    const flat = (s) => esc(s.replace(/\s+/g, ' '));
    return `<span class="kr-snip">${from > 0 ? '…' : ''}${flat(raw.slice(from, a))}<mark>${esc(raw.slice(a, b))}</mark>${flat(raw.slice(b, to))}${to < raw.length ? '…' : ''}</span>`;
  }

  function renderText(p) {
    const s = p.scan;
    const row = (x) => {
      const bad = x.flags.length > 0;
      const near = (x.near || []).length
        ? ` <span class="kr-near">${x.flags.some((f) => f[0] === 'cut') ? 'повний код' : x.kind === 'icd' ? 'найближчий наявний код' : 'у цьому блоці є'}: ${
          x.near.map((c) => chip(c, c, ((x.kind === 'icd' ? N25 : N26).get(c) || {}).n)).join(' ')}</span>` : '';
      const ends = x.kind === 'range' && x.ends.length ? ` <span class="kr-near">межі: ${x.ends.map((c) => chip(c, c, (N25.get(c) || {}).n)).join(' ')}</span>` : '';
      const loose = x.loose ? ` ${tag('не перевірено')} у документах НСЗУ цього коду немає, а повного довідника Кодер не тримає.
        ${more('../classifiers/loinc.html?code=' + encodeURIComponent(x.code), 'перевірити в довіднику LOINC')}` : '';
      return `<div class="kr-row${bad ? ' kr-flagged' : ''}">${x.q ? chip(x.code, x.q, 'відкрити картку коду') : `<span class="kr-c">${esc(x.code)}</span>`}
        <span class="kr-t">${esc(x.name)} ${tag(KIND[x.kind])} ${x.n > 1 ? tag('згадок: ' + x.n) : ''}
          ${x.flags.map((f) => tag(f[1], 'kr-warn')).join(' ')}${near}${ends}${loose}${bad || x.loose ? snippet(s.raw, x.at[0], x.at[1]) : ''}</span></div>`;
    };
    const order = (x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || x.a - y.a;
    const bad = s.items.filter((x) => x.flags.length).sort((x, y) => x.a - y.a);
    const loose = s.items.filter((x) => !x.flags.length && x.loose).sort((x, y) => x.a - y.a);
    const fine = s.items.filter((x) => !x.flags.length && !x.loose).sort(order);
    const CAP = 200;
    const block = (title, list, cls) => (list.length ? `<section class="kr-found${cls ? ' ' + cls : ''}"><h2>${esc(title)} <span class="kr-src">${nf(list.length)}</span></h2>
      ${list.slice(0, CAP).map(row).join('')}${list.length > CAP ? `<p class="kr-fine">Показано перші ${CAP}.</p>` : ''}</section>` : '');
    const WHAT = [['none', 'немає в класифікаторі'], ['cut', 'обірваний'], ['cyr', 'набрано кирилицею'],
      ['ed11', 'лише в 11-му виданні'], ['end', 'межі діапазону немає'], ['rev', 'межі переставлено']];
    const parts = WHAT.map(([k, t]) => [t, bad.filter((x) => x.flags.some((f) => f[0] === k)).length]).filter((x) => x[1]);
    return `<section class="kr-found kr-text">
        <h2>Перевірка кодів у тексті <span class="kr-src">текст опрацьовано у вашому браузері: він нікуди не надсилається і не зберігається</span></h2>
        <p class="kr-tsum"><b>Знайдено кодів: ${nf(s.items.length)}</b>
          ${bad.length ? `<b class="kr-tbad">з вадою: ${nf(bad.length)}</b>` : '<b class="kr-tgood">вад не знайдено</b>'}
          ${s.mentions > s.items.length ? `<span class="kr-fine">згадок у тексті: ${nf(s.mentions)}</span>` : ''}</p>
        ${parts.length ? `<p class="kr-chips">${parts.map(([t, n]) => tag(`${t}: ${n}`, 'kr-warn')).join(' ')}</p>` : ''}
        ${loose.length ? `<p class="kr-fine">Не перевірено: ${nf(loose.length)} — схожі на коди LOINC, яких немає у витягу Кодера.</p>` : ''}
        ${s.wait ? '<p class="kr-fine">Завантажую назви лабораторних кодів…</p>' : ''}
        <p class="kr-fine">Кнопка з кодом відкриває його картку; назад веде кнопка «до перевірки тексту».</p>
      </section>` +
      block('З вадою', bad, 'kr-textbad') + block('Не перевірено', loose) + block('Без зауважень', fine) +
      `<p class="kr-fine">Кодер перевіряє, чи є код у класифікаторі і як його набрано. Чи доречний код у цьому місці тексту —
        не перевіряє. Коди, записані малими літерами, і коди втручань без дефіса в тексті не розпізнаються.
        ${bad.some((x) => x.kind === 'achi' && x.flags.some((f) => f[0] === 'none')) ? 'Повного переліку втручань 11-го видання в Кодері немає: код, якого немає в НК 026, звірте з джерелом.' : ''}</p>`;
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

  function calc(g) {
    try {
      return PMG_TARIFF.calcCase(g, CORE, Object.assign({ share: true, balance: true }, COND));
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
    const active = Object.keys(COND).length;
    return groups.map((g) => {
      const res = calc(g);
      if (!res) return '';
      const per = res.perDay.map((p) => `<span class="kr-formula">+ ${esc(p.f.label)}: ${p.days} ${days(p.days)} × ${kf(p.f.value)} × ${nf(res.rate)}
        = ${nf(p.sum, 2)} грн — поверх випадку, без частки застосування</span>`).join('');
      const warn = res.unknown.map((u) => `<span class="kr-condwarn">Не враховано «${esc(u.f.label)}»: ${esc(u.why)}.</span>`).join('');
      return `<div class="kr-row"><span class="kr-c">${esc(g.c)}</span>
        <span class="kr-t"><b class="kr-sum">${nf(res.perDay.length ? res.grand : res.total, 2)} грн</b>
          <span class="kr-formula">${esc(PMG_TARIFF.formulaText(res))}</span>${per}${warn}</span></div>`;
    }).join('') + condPanel(groups[0]) + (active
      ? `<p class="kr-fine">Сума з позначеними умовами. Чи має заклад право на коефіцієнт, визначають умови
          пункту 38 і договір — Кодер цього не перевіряє.</p>`
      : `<p class="kr-fine">Базова сума: ставка ${nf(CORE.rate.case)} грн × вага × частка застосування.
          Вік, травму, тривалість лікування чи інтенсивну терапію додають «Умови випадку».</p>`);
  }

  /* «Умови випадку» — перемикачі коефіцієнтів пункту 38. Перелік, значення й підписи
     беруться з core.json (постанова 1808), рахує pmg-tariff.js; тут лише форма. */
  function condPanel(g) {
    if (!g) return '';
    const pk = new Set(g.p || []);
    const items = CORE.factors.map((f) => {
      if (f.stage === 'final' || !['mul', 'addw', 'altw_days', 'rateday'].includes(f.kind)) return '';
      const otherPkg = f.packages && f.packages.length && pk.size && !f.packages.some((p) => pk.has(p));
      const noCol = f.kind === 'addw' && g.k[f.column] == null;
      const noDrg = f.drg && !f.drg.includes(g.c);
      const noShort = f.kind === 'altw_days' && !(CORE.shortStay && CORE.shortStay[g.root || g.c]);
      const off = otherPkg || noCol || noDrg || noShort;
      const why = otherPkg ? `лише ${f.packages.length > 1 ? 'пакети' : 'пакет'} ${f.packages.join(', ')}`
        : noCol ? `для ${g.c} у додатку значення немає`
        : noDrg ? `лише ДСГ ${f.drg.join(', ')}`
        : noShort ? `для ${g.c} значення не відновлено` : '';
      const id = esc(f.id), v = off ? '' : COND[f.id], dis = off ? ' disabled' : '';
      let ctl, val = '';
      if (f.kind === 'mul' && f.options) {
        ctl = `<select data-cond="${id}"${dis}><option value="">ні</option>${f.options.map((o) =>
          `<option value="${o.value}"${Number(v) === o.value ? ' selected' : ''}>${esc(o.label)} × ${kf(o.value)}</option>`).join('')}</select>`;
      } else if (f.kind === 'mul' || f.kind === 'addw') {
        ctl = `<input type="checkbox" data-cond="${id}"${v ? ' checked' : ''}${dis}>`;
        val = f.kind === 'mul' ? `× ${kf(f.value)}` : (g.k[f.column] != null ? `+ ${kf(g.k[f.column])} до ваги` : '');
      } else {
        ctl = `<input type="number" min="0" max="${f.max_days || 30}" step="1" inputmode="numeric" placeholder="діб"
          data-cond="${id}" value="${v ? esc(v) : ''}"${dis}>`;
        val = f.kind === 'rateday'
          ? `${kf(f.value)} ставки за добу${f.from_day ? `, з ${f.from_day}-ї доби` : ''}${f.max_days ? `, не більше ${f.max_days}` : ''}`
          : 'замість ваги: за втручання + за кожен день';
      }
      return `<label class="kr-conditem${off ? ' kr-off' : ''}" title="${esc(f.note || '')}">${ctl}
        <span><b>пп. ${esc(f.sub)}</b> ${esc(f.label)}${val ? ` <i>${esc(val)}</i>` : ''}${why ? ` <em>${esc(why)}</em>` : ''}</span></label>`;
    }).join('');
    const n = Object.keys(COND).length;
    return `<details class="kr-cond" id="krCond"${condOpen || n ? ' open' : ''}>
      <summary>Умови випадку${n ? ` · позначено ${n}` : ' — вік, травма, тривалість, інтенсивна терапія'}</summary>
      <div class="kr-condgrid">${items}</div>
      <p class="kr-fine">Тут не рахується: кілька операцій при травмі чи на парних органах (пп. 11) — який коефіцієнт
        ділиться, визначають алгоритми НСЗУ; кардіохірургічні ваги додатка 2 (пп. 15) — це окремий рядок групи.
        Коефіцієнти короткого лікування (пп. 9-10) відновлено з фактичних оплат, у постанові їх немає.
        ${n ? '<button type="button" class="kr-reset" data-cond-reset>скинути умови</button>' : ''}</p>
    </details>`;
  }

  /* Рівень «Групер»: точна група для тих, хто ввійшов, інакше — попередня за Таблицею. */
  function grouperBlock(ex, exGroup, cand, table, addDx) {
    const byTable = `<p>${esc(cand.rule)}</p>` +
      (table.length > 1 ? `<p class="kr-fine">Можливих груп ${table.length}. Котру з них обере ЕСОЗ, визначають правила групування.</p>` : '');
    const link = more('grouper.html', 'усі кандидати й щаблі — Групер ДСГ');
    if (ex && exGroup) {
      const stamp = [exactInfo.version ? 'версія правил ' + exactInfo.version : '',
        exactInfo.uploaded ? 'оновлено ' + new Date(exactInfo.uploaded).toLocaleDateString('uk-UA') : ''].filter(Boolean).join(', ');
      return `<p class="kr-exact">${chip(exGroup.c, 'ДСГ ' + exGroup.c)} <b>${esc(exGroup.t)}</b> ${tag('точне групування')}</p>
        <ul class="kr-why">${(ex.why || []).map((w) => `<li><b>${esc(w.rule)}.</b> ${esc(w.text)}</li>`).join('')}</ul>
        <p class="kr-fine">Групу визначено правилами групера з урахуванням супутніх діагнозів${stamp ? ' (' + esc(stamp) + ')' : ''}.
          Це відтворення логіки ЕСОЗ, звірене на фактично згрупованих випадках; остаточну групу визначає ЕСОЗ.</p>${link}`;
    }
    if (ex && ex.group) {
      return `<p class="kr-fine">Групер дав групу ${esc(ex.group)}, але в сітці постанови № 1808 її немає. Нижче — групи за Таблицею співставлення.</p>${byTable}${link}`;
    }
    if (ex && ex.error) return `<p class="kr-fine">${esc(ex.error)} Нижче — групи за Таблицею співставлення.</p>${byTable}${link}`;
    const sec = addDx.length ? '<p class="kr-fine">Супутні діагнози тут не враховано: інколи саме вони змінюють групу.</p>' : '';
    const note = exactState === 'loading' ? '<p class="kr-fine">Завантажую правила групера…</p>'
      : exactState === 'error' ? `<p class="kr-fine">Правила групера не завантажились (${esc(exactInfo.error || 'помилка')}); показано групи за Таблицею.</p>`
      : '<p class="kr-fine">Точну групу з урахуванням супутніх діагнозів Кодер показує тим, хто ввійшов у портал.</p>';
    return byTable + sec + note + more('grouper.html', 'точне групування — Групер ДСГ (потрібен вхід)');
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
      const table = roots(cand.groups);
      const ex = exact(dx, addDx, ivs);
      const exGroup = ex && ex.group
        ? roots(CORE.groups.filter((g) => g.root === ex.group && inGrid(g)))[0] : null;
      const groups = exGroup ? [exGroup] : table;
      const others = exGroup ? table.filter((g) => g.root !== exGroup.root) : [];
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
      html += level('grouper', grouperBlock(ex, exGroup, cand, table, addDx),
        { src: exGroup ? 'точно, за правилами групування' : 'попередньо, за Таблицею співставлення' });
      html += level('drg', groups.length ? drgRows(groups) +
          (others.length ? `<details class="kr-fold"><summary>Інші групи, можливі за Таблицею співставлення: ${others.length}</summary>${drgRows(others)}</details>` : '')
        : '<p class="kr-none">Цей діагноз не веде до жодної групи з вагою в постанові.</p>',
        { src: 'постанова № 1808, додатки 1 і 2' });
      html += level('service', serviceRows(groups, BY_ICD[dx]), { src: 'Таблиця співставлення, таблиця 1' });
      html += level('tariff', groups.length ? tariffRows(groups) +
        more('index.html?q=' + q, 'покроковий розрахунок і перевірки кодування — Кодування випадку')
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

  // ── поза ланцюжком: послуги й посади ЕСОЗ, LOINC ───────────────────────
  const side = (title, src, body, entry) => `<section class="kr-level${entry ? ' kr-entry' : ''}">
    <div class="kr-n" aria-hidden="true">•</div><div class="kr-body">
      <h2>${esc(title)}${entry ? ' <span class="kr-entrytag">вхід</span>' : ''}${src ? ` <span class="kr-src">${esc(src)}</span>` : ''}</h2>
      ${body}</div></section>`;
  const fold = (rows, cap, label) => (rows.length <= cap ? rows.join('')
    : rows.slice(0, cap).join('') + `<details class="kr-fold"><summary>Ще ${nf(rows.length - cap)} ${esc(label)}</summary>${rows.slice(cap, cap + 300).join('')}</details>`);
  const uniq = (list) => [...new Set(list.filter(Boolean))];
  const anyCode = (c) => (RE_LOINC.test(c) || RE_ACHI.test(c) || (RE_ESOZ.test(c) && ESOZM.has(c)) ? chip(c, c)
    : `<span class="kr-c">${esc(c)}</span>`);
  const letterSrc = (A) => (A.letter.number ? `лист НСЗУ № ${A.letter.number}, додатки` : 'чинний лист НСЗУ про пакет 9');
  const flagTags = (A, flags) => (flags || []).map((f) =>
    tag((A.flag.get(f.key) || f.key) + (f.detail ? ': ' + f.detail : '') + (f.on ? ` (${f.on})` : ''), 'kr-warn')).join(' ');
  const mentionRows = (list, title) => list.slice().sort((x, y) => (y.n || 0) - (x.n || 0)).map((m) =>
    `<div class="kr-row"><span class="kr-c">згадок: ${nf(m.n || 1)}</span><span class="kr-t">
      <a href="../rozjasnennya/index.html?doc=${encodeURIComponent(m.d)}">${esc(title(m) || 'Документ № ' + m.d)}</a></span></div>`);

  /* Як послугу обліковують у пакеті 9 — рядки додатків чинного листа, без домислів. */
  function esozIn9(code) {
    const A = LAZY.amb.data;
    const recs = A ? A.byCode.get(code) || [] : [];
    if (!recs.length) return '';
    const bySv = new Map();
    recs.forEach((r) => pushTo(bySv, r.sv, r));
    let html = '';
    for (const [sv, list] of bySv) {
      const cls = uniq(list.map((r) => r.class)), grp = uniq(list.map((r) => r.group));
      html += `<p class="kr-fine"><b>${esc(A.sv.get(sv) || sv)}</b>${cls.length ? ' · клас: ' + esc(cls.slice(0, 8).join(', ')) + (cls.length > 8 ? '…' : '') : ''}${
        grp.length && grp.length <= 4 ? ' · група: ' + esc(grp.join(', ')) : ''} · рядків у додатку: ${nf(list.length)}</p>`;
      if (sv === 'lab') {
        html += '<p class="kr-fine">Результат записують кодом спостереження LOINC:</p>' + fold(list.map((r) => {
          const obs = r.obs || [];
          const code1 = obs.find((o) => RE_LOINC.test(o));
          const text = r.obs_name || obs.find((o) => !RE_LOINC.test(o)) || r.report_name || r.name;
          return `<div class="kr-row">${code1 ? chip(code1, code1) : '<span class="kr-c">—</span>'}
            <span class="kr-t">${esc(text)} ${code1 ? '' : tag('коду спостереження в додатку немає')}
              ${r.category ? tag(String(r.category).toLowerCase()) : ''} ${r.referral === 'так' ? tag('за направленням') : ''}
              ${r.note ? tag(r.note) : ''} ${flagTags(A, r.flags)}</span></div>`;
        }), 10, 'рядків');
      } else {
        const pos = uniq([].concat(...list.map((r) => r.pos || [])));
        const odk = uniq([].concat(...list.map((r) => r.odk || [])));
        if (pos.length) {
          html += `<p class="kr-fine">Хто надає (посади ЕСОЗ): ${nf(pos.length)}</p><div class="kr-chips">${
            pos.slice(0, 40).map((c) => chip(c, 'посада ' + c, A.pos[c] || (ESOZM.get(c) || {}).n)).join(' ')}</div>`;
        }
        // у полі ОДК додатка стоять і номери ОДК, і окремі діагнози, і «Всі»
        const nums = odk.filter((o) => A.odk[o]), dxs = odk.filter((o) => RE_ICD.test(o));
        const rest = odk.filter((o) => !A.odk[o] && !RE_ICD.test(o));
        if (nums.length || rest.length) {
          html += `<p class="kr-fine">ОДК діагнозів: ${nums.map((o) => chip('ОДК ' + o, 'ОДК ' + o, A.odk[o].name)).join(' ')}
            ${esc(rest.map((o) => (/^всі$/i.test(o) ? 'усі ОДК' : o)).join(', '))}</p>`;
        }
        if (dxs.length) html += `<p class="kr-fine">Окремі діагнози: ${dxs.slice(0, 40).map((o) => chip(o, o)).join(' ')}</p>`;
        const fl = flagTags(A, [].concat(...list.map((r) => r.flags || []))
          .filter((f, i, all) => all.findIndex((g) => g.key === f.key && g.detail === f.detail) === i));
        if (fl) html += `<p class="kr-fine">${fl}</p>`;
      }
    }
    return side('Пакет 9: як обліковується', letterSrc(A), html +
      more('../algorithms/ambulatory.html?q=' + encodeURIComponent(code), 'усі правила — Кодування амбулаторки'));
  }

  function renderEsoz(p) {
    const e = ESOZM.get(p.code);
    const settled = need('cards', 'amb');
    const card = (LAZY.cards.data || {})[p.code];
    const A = LAZY.amb.data;
    const isPos = e.k === 'position';
    const names = card && card.names && card.names.length > 1
      ? `<p class="kr-fine">Джерела називають цей код по-різному:</p><ul class="kr-why">${card.names.map((n) =>
          `<li>${esc(n.n)} <span class="kr-fine">— ${esc((n.src || []).join(', '))}</span></li>`).join('')}</ul>` : '';
    const note = card && card.note ? `<p>${tag('Застереження Таблиці співставлення: ' + card.note, 'kr-warn')}</p>` : '';
    let html = side(isPos ? 'Посада ЕСОЗ' : 'Послуга ЕСОЗ', 'зібрано з документів НСЗУ; офіційного довідника немає',
      `<div class="kr-row"><span class="kr-c">${esc(e.c)}</span><span class="kr-t">${esc(e.n || 'назви немає')}
        ${e.t && /[а-яіїє]/i.test(e.t) ? tag(e.t) : ''} ${(e.p || []).map((x) => chip('пакет ' + x, 'пакет ' + x)).join(' ')}</span></div>
      ${note}${names}${settled ? '' : '<p class="kr-fine">Завантажую картку…</p>'}
      ${more('../classifiers/esoz.html?code=' + encodeURIComponent(e.c), 'картка в довіднику ЕСОЗ')}`, true);
    if (!settled) return html;
    if (isPos) {
      const recs = A ? A.byPos.get(p.code) || [] : [];
      const seen = new Map();
      recs.forEach((r) => { if (!seen.has(r.code)) seen.set(r.code, r); });
      if (seen.size) {
        html += side('Пакет 9: які послуги надає', letterSrc(A), fold([...seen.values()].map((r) =>
          `<div class="kr-row">${anyCode(r.code)}<span class="kr-t">${esc(r.name)} ${tag(A.sv.get(r.sv) || r.sv)}</span></div>`), 12, 'послуг'));
      }
    } else {
      html += esozIn9(p.code);
      if (card && (card.services || []).length) {
        html += side('Таблиця співставлення', 'таблиця 1', card.services.map((s) =>
          `<div class="kr-row"><span class="kr-c">${(s.p || []).map((x) => 'пакет ' + esc(x)).join(', ') || '—'}</span>
            <span class="kr-t">${esc(s.s)}</span></div>`).join('') +
          more('../mapping/index.html?q=' + encodeURIComponent(p.code), 'рядки Таблиці з цим кодом'));
      }
    }
    if (card && (card.mentions || []).length) {
      html += side("Роз'яснення НСЗУ, що згадують код", nf(card.mentions.length), fold(mentionRows(card.mentions, (m) => m.t), 6, 'документів'));
    }
    return html;
  }

  const LOINC_ST = { T: 'пробний код', D: 'застарілий код', X: 'не рекомендований' };
  const LOINC_US = { 3: 'офіційний переклад', 2: 'авто-переклад', 1: 'авто-переклад, частковий' };

  function renderLoinc(p) {
    const code = p.code;
    const settled = need('loinc', 'amb', 'docs');
    if (!NOTES) loadNotes().then(run);
    const L = LAZY.loinc.data, A = LAZY.amb.data;
    const full = more('../classifiers/loinc.html?code=' + encodeURIComponent(code), 'паспорт коду в довіднику LOINC');
    if (!settled || !NOTES) {
      return side('Лабораторний код · LOINC', '', `<div class="kr-row"><span class="kr-c">${esc(code)}</span>
        <span class="kr-t">Завантажую довідник…</span></div>${full}`, true);
    }
    const e = L && L.codes[code];
    const ver = L ? 'LOINC ' + L.version : 'LOINC';
    let head;
    if (e) {
      const tags = [tag((L.classes[e.c] || e.c) + ' · ' + e.t)];
      if (LOINC_ST[e.st]) tags.push(tag(LOINC_ST[e.st], 'kr-warn'));
      if (e.un) tags.push(tag('одиниці: ' + e.un));
      if (LOINC_US[e.us]) tags.push(tag(LOINC_US[e.us]));
      head = `<div class="kr-row"><span class="kr-c">${esc(code)}</span><span class="kr-t">${esc(e.n)} ${tags.join(' ')}</span></div>
        <p class="kr-fine">Англійською: ${esc(e.e)}</p>`;
    } else if (L && (L.absent || []).includes(code)) {
      head = `<div class="kr-row"><span class="kr-c">${esc(code)}</span><span class="kr-t">${tag('у ' + ver + ' такого коду немає', 'kr-warn')}
        У документах НСЗУ код ужито, але в довіднику цієї версії його немає: помилка набору або код новіший за наш реліз.</span></div>`;
    } else {
      head = `<div class="kr-row"><span class="kr-c">${esc(code)}</span><span class="kr-t">У документах НСЗУ про програму медичних гарантій
        цей код не трапляється.</span></div>
        <p class="kr-fine">Кодер тримає назви лише тих кодів LOINC, що є в документах НСЗУ${L ? `: ${nf(L.list.length)} із ${nf(L.total)}` : ''}.
          Решту шукайте в повному довіднику.</p>`;
    }
    let html = side('Лабораторний код · LOINC', ver, head + full, true);

    const used = A ? A.byObs.get(code) || [] : [];
    const own = A ? A.byCode.get(code) || [] : [];
    const fl = A ? flagTags(A, A.flags[code]) : '';
    if (used.length || own.length || fl) {
      const seen = new Map();
      used.forEach((r) => { if (!seen.has(r.code + '|' + r.name)) seen.set(r.code + '|' + r.name, r); });
      const rows = [...seen.values()].map((r) => `<div class="kr-row">${anyCode(r.code)}
        <span class="kr-t">${esc(r.name)} ${tag(A.sv.get(r.sv) || r.sv)} ${r.class ? tag(r.class) : ''}
          ${r.category ? tag(String(r.category).toLowerCase()) : ''} ${r.referral === 'так' ? tag('за направленням') : ''}</span></div>`);
      const self = own.map((r) => `<div class="kr-row"><span class="kr-c">${esc(code)}</span>
        <span class="kr-t">Обліковується як послуга: ${esc(r.name)} ${tag(A.sv.get(r.sv) || r.sv)} ${r.class ? tag(r.class) : ''}
          ${r.note ? tag(r.note) : ''}</span></div>`);
      html += side('Пакет 9: де цей код потрібен', letterSrc(A),
        (rows.length ? `<p class="kr-fine">Код спостереження для ${rows.length === 1 ? 'послуги' : 'послуг'}:</p>` + fold(rows, 10, 'послуг') : '') +
        self.join('') + (fl ? `<p class="kr-fine">${fl}</p>` : '') +
        more('../algorithms/ambulatory.html?q=' + encodeURIComponent(code), 'усі правила — Кодування амбулаторки'));
    }
    const docs = ((NOTES.roz || {}).loinc || {})[code] || [];
    if (docs.length) {
      const T = LAZY.docs.data;
      html += side("Роз'яснення НСЗУ, що згадують код", nf(docs.length), fold(mentionRows(docs, (m) => (T ? T.get(m.d) : '')), 6, 'документів'));
    }
    return html;
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
    one('Послуги й посади · ЕСОЗ', ESOZ, ESOZM, (e) => (e.k === 'position' ? 'посада ' + e.c : e.c), (e) => e.n);
    // LOINC: лише коди з документів НСЗУ; увесь довідник (109 тис.) — на власній сторінці
    need('loinc');
    const L = LAZY.loinc.data;
    const before = blocks.length;
    if (L) one('Лабораторні · LOINC у документах НСЗУ', L.list, null, (e) => e.c, (e) => e.n);
    // довгий текст в адресу іншої сторінки не переносимо: у листах бувають персональні дані
    const allLoinc = isText(p.text) ? more('../classifiers/loinc.html', 'довідник LOINC')
      : more('../classifiers/loinc.html?q=' + encodeURIComponent(p.text),
        `шукати «${p.text}» в усьому LOINC${L ? ' — ' + nf(L.total) + ' кодів' : ''}`);
    if (blocks.length > before) blocks[blocks.length - 1] = blocks[blocks.length - 1].replace('</section>', allLoinc + '</section>');
    if (!blocks.length && isText(p.text)) {
      return `<p class="kr-none">Кодів у цьому тексті Кодер не знайшов, і за його словами в довідниках нічого немає.
        Щоб знайти код за словами, залиште в полі два-три слова.</p>`;
    }
    if (!blocks.length) {
      return `<p class="kr-none">За словами «${esc(p.text)}» нічого не знайдено ні в НК 025, ні в НК 026, ні серед ДСГ,
        кодів ЕСОЗ і лабораторних кодів із документів НСЗУ.</p>${allLoinc}`;
    }
    notes = [...new Set(notes)];
    return (notes.length ? `<p class="kr-fine">${esc(notes.join(' · '))}</p>` : '') + blocks.join('') +
      (blocks.length > before ? '' : `<p class="kr-fine">Шукаєте лабораторний показник? ${allLoinc}</p>`);
  }

  function welcome() {
    return `<div class="kr-welcome">
      <p>Уведіть код — побачите весь його шлях: до якої ОДК належить, у які групи веде, якою послугою
        Таблиці співставлення закривається і скільки це в гривнях.</p>
      <p>Починати можна з будь-якого рівня: з діагнозу, втручання, групи, ОДК чи пакета. Не знаєте коду —
        пишіть словами.</p>
      <p>Код послуги чи посади ЕСОЗ і лабораторний код LOINC теж можна: Кодер покаже, як послугу обліковують
        у пакеті 9, якими кодами спостережень записують результат і де про це писала НСЗУ.</p>
      <p>Можна вставити й абзац або цілий текст листа: Кодер знайде в ньому всі коди й покаже, яких немає
        в класифікаторах, які набрано кирилицею чи обірвано. Текст лишається у вашому браузері.</p>
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
    // Абзац чи лист в адресу сторінки не пишемо (у листах бувають персональні дані) —
    // лише короткі запити й переліки кодів.
    if (raw.trim() && (!isText(raw) || p.kind === 'case')) url.searchParams.set('q', raw.trim()); else url.searchParams.delete('q');
    url.searchParams.delete('code');
    history.replaceState(null, '', url);
    mode = p.kind;
    if (p.kind === 'text') lastText = null;
    document.body.classList.toggle('kr-textmode', p.kind === 'text');   // рівні ланцюжка тут ні до чого — ховаємо

    if (p.kind === 'empty') { html = welcome(); }
    else if (p.kind === 'unknown') { html = `<p class="kr-none">${esc(p.what)} — ${esc(p.why || 'такого коду немає')}.</p>`; }
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
        if (dx.length === 1 && !iv.length && ESOZM.has(dx[0])) {
          status += ` ${esc(dx[0])} — це ще й код посади ЕСОЗ «${esc(ESOZM.get(dx[0]).n)}». ${chip('показати посаду', 'посада ' + dx[0])}`;
        }
      }
    }
    else if (p.kind === 'drg') html = renderDrg(p);
    else if (p.kind === 'odk') html = renderOdk(p);
    else if (p.kind === 'package') html = renderPackage(p);
    else if (p.kind === 'esoz') html = renderEsoz(p);
    else if (p.kind === 'loinc') html = renderLoinc(p);
    else if (p.kind === 'text') {
      html = renderText(p);
      status = `Перевірено текст: кодів — ${nf(p.scan.items.length)}, з вадою — ${nf(p.scan.items.filter((x) => x.flags.length).length)}.`;
    }
    else html = renderWords(p);

    if (lastText != null && p.kind !== 'text') {
      status = '<button type="button" class="kr-back" data-back>← до перевірки тексту</button> ' + status;
    }
    $('krStatus').innerHTML = status;
    $('krOut').innerHTML = html;
    if (p.kind === 'case') fillNotes(p.dx.concat(p.iv).slice(0, 4));
  }

  function renderLevelChips() {
    $('krLevels').innerHTML = LEVELS.map(([k, t], i) =>
      `<button type="button" class="kr-lv" data-level="${k}" aria-pressed="${!hidden.has(k)}">${i + 1} ${esc(t)}</button>`).join('');
  }

  /* Поле багаторядкове (у нього вставляють і текст листа) і росте разом із вмістом;
     найбільшу висоту задає koder.css. */
  function fit() {
    const q = $('krQ');
    q.style.height = 'auto';
    q.style.height = (q.scrollHeight + (q.offsetHeight - q.clientHeight)) + 'px';
  }

  function bind() {
    let timer = 0;
    $('krQ').addEventListener('input', () => { lastText = null; fit(); clearTimeout(timer); timer = setTimeout(run, 220); });
    // Enter — показати відповідь, як і раніше; новий рядок — Shift+Enter
    $('krQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); clearTimeout(timer); run(); }
    });
    $('krClear').addEventListener('click', () => { $('krQ').value = ''; lastText = null; fit(); run(); $('krQ').focus(); });
    window.addEventListener('resize', fit);
    // «Умови випадку»: зміна перемикача перераховує суму; стан живе, доки відкрита сторінка
    document.addEventListener('change', (e) => {
      const c = e.target.closest && e.target.closest('[data-cond]');
      if (!c) return;
      const v = c.type === 'checkbox' ? c.checked : Number(c.value) || 0;
      if (v) COND[c.dataset.cond] = v; else delete COND[c.dataset.cond];
      condOpen = true;
      run();
    });
    document.addEventListener('toggle', (e) => { if (e.target && e.target.id === 'krCond') condOpen = e.target.open; }, true);
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-cond-reset]')) {
        Object.keys(COND).forEach((k) => delete COND[k]);
        run();
        return;
      }
      if (e.target.closest('[data-back]')) {
        if (lastText != null) $('krQ').value = lastText;
        fit();
        run();
        return;
      }
      const b = e.target.closest('[data-q]');
      if (b) {
        // з перевірки тексту — до картки коду: текст тримаємо в пам'яті сторінки, щоб повернутись
        if (mode === 'text') lastText = $('krQ').value;
        $('krQ').value = b.dataset.q.trim();
        fit();
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
