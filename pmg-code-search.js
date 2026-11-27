/* Пошук за словами в довідниках кодів — один модуль на весь портал.
 *
 * Аудит джерел 19.11.2026: пошук НК 025 і НК 026 знаходив лише точну фразу.
 * «перелом стегна», «рак молочної залози», «видалення жовчного міхура» давали
 * «Нічого не знайдено», бо в назві стоїть «Перелом стегнової кістки»,
 * «Злоякісне новоутворення…», «Холецистектомія». Пошук до того ж був написаний
 * окремо в кожному розділі. Тут — одна реалізація з чотирма щаблями:
 *
 *   1. фраза цілком            — як було, ці результати завжди зверху;
 *   2. усі слова в будь-якому порядку, з урахуванням відмінка («стегна» ~ «стегнової»);
 *   3. словник синонімів і абревіатур (data/search_synonyms.json): «рак» → «злоякісне
 *      новоутворення», «ДЦП» → «церебральний параліч»;
 *   3а. інше прочитання запиту (PMG_SEARCH.variants): не та розкладка, латиниця, російські літери;
 *   3б. схоже написання (з 27.11.2026): слово, якого немає в жодній назві, замінюється найближчим
 *      словом довідника — «карбамазепин» → «карбамазепін», «целякія» → «целіакія»;
 *   4. якщо якогось слова немає в жодній назві — пошук без нього, з чесною приміткою.
 *
 * Для розділів, що шукають підрядком (навігатор пакетів, постанова), є PMG_FIND.rewrite(raw, voc):
 * переписує запит тими самими щаблями у слова, які в текстах розділу справді є, і каже, що змінено.
 *
 * Підключати звичайним <script> ПІСЛЯ pmg-search-norm.js і ДО скрипта розділу:
 *   <script src="../pmg-search-norm.js?v=1" defer></script>
 *   <script src="../pmg-code-search.js?v=20261119a" defer></script>
 *
 * PMG_FIND.search(list, raw, opts) → { items: [{e, score, via}], note }
 *     list — масив записів; opts.text(e) — нормалізована назва (типово e._t);
 *     opts.scope — сфера словника: групи з полем scope («kadry» — посади й спеціальності,
 *              «equipment» — обладнання; розділи без власних груп передають свою назву,
 *              щоб словник кодів до них не застосовувався)
 *              працюють лише в пошуку з тією самою сферою, групи без scope — у пошуку кодів;
 *     via  — пояснення для результатів зі словника («рак → злоякісне новоутворення»);
 *     note — рядок для користувача, коли спрацював щабель 3 або 4.
 * PMG_FIND.extra(list, raw, have, opts) → { items: [запис,…], note } — для розділів зі своїм
 *     ранжуванням (НК 024, НК 031, табелі, LOINC, посади): записи, яких розділ сам не знайшов
 *     (have — Set знайденого), найкращі перші. Розділ дописує їх у кінець свого списку.
 * PMG_FIND.ready() → Promise, що завершується, коли словник завантажено (або не вдалося —
 *     тоді пошук працює без щабля 3).
 * PMG_FIND.setSynonyms(dict) — для тестів у Node (tools/check_search.js).
 *
 * Правило розділу 9 AGENTS.md: пошук за словами в новому розділі — через цей модуль,
 * не копією. Зміна логіки — після `node tools/check_search.js`.
 */
(function (g) {
  'use strict';

  const norm = (s) => (g.PMG_SEARCH ? g.PMG_SEARCH.text(s) : String(s == null ? '' : s).toLowerCase());
  const WORD = /[0-9a-zа-яґєії']+/g;

  // ── основа слова ─────────────────────────────────────────────────────
  // Не лінгвістика, а узгоджене обрізання: одна й та сама функція застосовується і до
  // запиту, і до назв, тому «стегна», «стегно», «стегнової», «стегновий» дають одну основу.
  const ENDINGS = ['ового', 'евого', 'ього', 'ими', 'іми', 'ому', 'ого', 'ові', 'еві', 'ами', 'ями',
    'ах', 'ях', 'ів', 'їв', 'ий', 'ій', 'ої', 'ою', 'ею', 'єю', 'ам', 'ям', 'ом', 'ем', 'єм',
    'их', 'іх', 'ії', 'ія', 'ію', 'а', 'я', 'у', 'ю', 'і', 'и', 'о', 'е', 'ь', 'й', 'ї'];
  const ADJ1 = ['ов', 'ев', 'єв'];
  const ADJ2 = ['ськ', 'цьк', 'н'];
  // слова, де голосний випадає або чергується: звичайне обрізання дало б різні основи
  // (називний відмінок → непряма форма; далі слово проходить звичайне обрізання)
  const IRREG = { 'хребет': 'хребта', 'палець': 'пальця', 'камінь': 'каменя', 'корінь': 'кореня',
    'ніготь': 'нігтя', 'лікоть': 'ліктя', 'кінець': 'кінця' };
  const stemCache = new Map();

  function stem(w) {
    if (w.length <= 3 || /\d/.test(w)) return w;
    let s = stemCache.get(w);
    if (s !== undefined) return s;
    s = IRREG[w] || w;
    // побіжний голосний: «мозок» ~ «мозку», «нирок» ~ «нирки», «шлунок» ~ «шлунка»
    if (/[^аеиіоуюяєї]ок$/.test(s) && s.length >= 5) s = s.slice(0, -2) + 'к';
    else {
      for (const e of ENDINGS) {
        if (s.length - e.length >= 3 && s.endsWith(e)) { s = s.slice(0, -e.length); break; }
      }
    }
    // «недостатність» ~ «недостатності», «вагітність» ~ «вагітності»
    if (s.length > 5 && s.endsWith('іст')) s = s.slice(0, -3) + 'ост';
    for (const a of ADJ1) {
      if (s.length - a.length >= 3 && s.endsWith(a)) { s = s.slice(0, -a.length); break; }
    }
    for (const a of ADJ2) {
      if (s.length - a.length >= 4 && s.endsWith(a)) { s = s.slice(0, -a.length); break; }
    }
    stemCache.set(w, s);
    return s;
  }

  const words = (t) => t.match(WORD) || [];

  /** Готує запис до пошуку: рядки слів і основ з пробілами по краях. */
  function prep(e, text) {
    if (e._fw !== undefined) return;
    const w = words(text);
    e._fw = ' ' + w.join(' ') + ' ';
    e._fs = ' ' + w.map(stem).join(' ') + ' ';
  }

  /** Збіг одного слова запиту з назвою: 3 — саме це слово, 2 — початок слова, 1 — та сама основа. */
  function tokenTier(e, tok) {
    if (e._fw.includes(' ' + tok.t + ' ')) return 3;
    if (tok.short) return 0;                       // «КТ», «2» — лише цілим словом
    if (e._fw.includes(' ' + tok.t)) return 2;
    if (tok.s !== tok.t || tok.t.length >= 4) {
      if (e._fs.includes(' ' + tok.s + ' ')) return 1;
    }
    return 0;
  }

  // службові слова не несуть змісту: «апендицит у дитини» шукаємо як «апендицит дитини»
  const STOP = new Set(['у', 'в', 'з', 'із', 'зі', 'і', 'й', 'та', 'або', 'на', 'при', 'для', 'до', 'по',
    'від', 'без', 'що', 'як', 'це', 'а']);

  function makeTokens(text) {
    const all = words(text).map((t) => ({ t, s: stem(t), short: t.length <= 2 || /^\d+$/.test(t) }));
    const meaningful = all.filter((tok) => !STOP.has(tok.t));
    return meaningful.length ? meaningful : all;
  }

  /** Оцінка запису для одного варіанта запиту. 0 — не підходить. */
  function scoreEntry(e, text, q, tokens) {
    // щабель 1: фраза цілком — ті самі числа, що були в розділах до модуля
    const brief = 6 * Math.max(0, 1 - text.length / 160);     // коротка назва = ближче до суті
    if (text.startsWith(q)) return 60 + brief;
    if (text.includes(' ' + q)) return 45 + brief;
    if (text.includes(q)) return 30 + brief;
    // щабель 2: усі слова
    let sum = 0;
    for (const tok of tokens) {
      const tier = tokenTier(e, tok);
      if (!tier) return 0;
      sum += tier;
    }
    // 8…26: що точніші слова й коротша назва, то вище
    const exactness = sum / (tokens.length * 3);                 // 0.33…1
    return 8 + 12 * exactness + brief;
  }

  // ── словник синонімів ────────────────────────────────────────────────
  let SYN = [];          // [{keys: [[stem,…],…], to: [phrase,…], label}]
  let synPromise = null;

  function setSynonyms(dict) {
    SYN = [];
    for (const grp of (dict && dict.groups) || []) {
      const keys = (grp.q || []).map((p) => words(norm(p)).map(stem)).filter((k) => k.length);
      const to = (grp.to || []).map((p) => norm(p)).filter(Boolean);
      if (keys.length && to.length) SYN.push({ keys, to, q: grp.q, scope: grp.scope || '', grp });
    }
  }

  // ── схоже написання (опечатки) ───────────────────────────────────────
  // Слово запиту, якого немає в жодній назві, порівнюємо з усіма словами довідника за відстанню
  // редагування між ОСНОВАМИ (пропуск, зайва, переставлена чи інша літера). Пари, які плутають
  // найчастіше, коштують пів кроку: и/і/ї, е/є, г/ґ, а/о (ненаголошені), м'який знак і апостроф.
  // Поріг росте з довжиною: короткі слова не виправляємо зовсім (на «КТ» чи «рак» опечатка
  // дала б зовсім інше слово).
  const NEAR = new Set(['иі', 'іи', 'ії', 'їі', 'иї', 'їи', 'еє', 'єе', 'гґ', 'ґг', 'ао', 'оа', 'ье', 'ь\'', '\'ь']);
  function dist(a, b, max) {
    const n = a.length, m = b.length;
    if (Math.abs(n - m) > max) return max + 1;
    let prev2 = null, prev = new Array(m + 1), cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= m; j++) {
        const ca = a[i - 1], cb = b[j - 1];
        const sub = ca === cb ? 0 : NEAR.has(ca + cb) ? 0.5 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
        if (prev2 && i > 1 && j > 1 && ca === b[j - 2] && a[i - 2] === cb) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur; cur = new Array(m + 1);
    }
    return prev[m];
  }
  const allowed = (len) => (len < 4 ? 0 : len <= 5 ? 1 : len <= 8 ? 1.5 : 2);

  /** Словник слів набору текстів: {words: Set, sorted: [], stems: Map(основа → найчастіше слово)}. */
  function vocabulary(texts) {
    const count = new Map();
    for (const t of texts) for (const w of words(t)) if (w.length > 1 && !/^\d+$/.test(w)) count.set(w, (count.get(w) || 0) + 1);
    const stems = new Map();
    for (const [w, n] of count) {
      const s = stem(w);
      const old = stems.get(s);
      if (!old || old.n < n) stems.set(s, { w, n });
    }
    return { words: new Set(count.keys()), sorted: [...count.keys()].sort(), stems };
  }
  const vocabCache = new WeakMap();
  function vocabOf(list, getText) {
    let v = vocabCache.get(list);
    if (!v || v.size !== list.length) {
      v = vocabulary(list.map(getText));
      v.size = list.length;
      vocabCache.set(list, v);
    }
    return v;
  }

  /** Чи є в словнику слово, що починається з t (бінарний пошук по впорядкованому списку). */
  function hasPrefix(voc, t) {
    const a = voc.sorted;
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < t) lo = mid + 1; else hi = mid; }
    return lo < a.length && a[lo].startsWith(t);
  }

  /** Найближче за написанням слово словника: {w, s, d} або null. */
  function closest(t, voc) {
    const s = stem(t);
    const max = allowed(s.length);
    if (!max) return null;
    let best = null;
    for (const [vs, info] of voc.stems) {
      if (Math.abs(vs.length - s.length) > max) continue;
      let d = dist(s, vs, max);
      if (d > 0 && vs[0] !== s[0]) d += 0.5;            // перша літера помиляється рідше
      if (d === 0 || d > max) continue;
      if (!best || d < best.d || (d === best.d && info.n > best.n)) best = { w: info.w, s: vs, d, n: info.n };
    }
    return best;
  }

  const BASE = (function () {
    try {
      const src = g.document && g.document.currentScript && g.document.currentScript.src;
      return src ? src.replace(/[^/]*$/, '') : '';
    } catch (e) { return ''; }
  })();

  function ready() {
    if (synPromise) return synPromise;
    if (!g.fetch || !BASE) return (synPromise = Promise.resolve());
    synPromise = g.fetch(BASE + 'data/search_synonyms.json?v=20261127a')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setSynonyms(d); })
      .catch(() => {});
    return synPromise;
  }

  /** Варіанти запиту зі словника: [{text, via}] */
  function variants(tokens, scope) {
    const out = [];
    const stems = tokens.map((t) => t.s);
    for (const grp of SYN) {
      if (grp.scope !== (scope || '')) continue;
      for (let ki = 0; ki < grp.keys.length; ki++) {
        const key = grp.keys[ki];
        // слова ключа мають стояти в запиті поспіль
        let at = -1;
        for (let i = 0; i + key.length <= stems.length && at < 0; i++) {
          if (key.every((k, j) => stems[i + j] === k)) at = i;
        }
        if (at < 0) continue;
        for (let ti = 0; ti < grp.to.length; ti++) {
          const target = grp.to[ti];
          const before = tokens.slice(0, at).map((t) => t.t);
          const after = tokens.slice(at + key.length).map((t) => t.t);
          out.push({ text: before.concat([target], after).join(' '), via: `${grp.q[ki]} → ${target}`, rank: ti });
          if (out.length >= 12) return out;
        }
        break;
      }
    }
    return out;
  }

  function runVariant(list, getText, q, filter) {
    const tokens = makeTokens(q);
    const found = [];
    if (!tokens.length) return found;
    for (const e of list) {
      if (filter && !filter(e)) continue;
      const text = getText(e);
      prep(e, text);
      const score = scoreEntry(e, text, q, tokens);
      if (score > 0) found.push({ e, score });
    }
    return found;
  }

  /**
   * @param {Array} list   записи довідника
   * @param {string} raw   запит як його ввели
   * @param {{text?: function, filter?: function}} [opts]
   */
  function search(list, raw, opts) {
    const getText = (opts && opts.text) || ((e) => e._t);
    const filter = opts && opts.filter;
    const strict = !!(opts && opts.strict);       // лише щаблі 1–2: для перевірки словника
    const scope = (opts && opts.scope) || '';
    const q = norm(String(raw || '').trim()).replace(/\s+/g, ' ');
    if (!q) return { items: [], note: '' };

    const seen = new Map();          // запис → найкращий результат
    const push = (found, factor, via) => {
      for (const r of found) {
        const score = r.score * factor;
        const old = seen.get(r.e);
        if (!old || old.score < score) seen.set(r.e, { e: r.e, score, via: via || '' });
      }
    };

    push(runVariant(list, getText, q, filter), 1, '');
    const direct = seen.size;

    const tokens = makeTokens(q);
    const vias = [];
    for (const v of (strict ? [] : variants(tokens, scope))) {
      const found = runVariant(list, getText, v.text, filter);
      // перше формулювання групи — найточніше, тому йде вище за наступні
      if (found.length) { push(found, 0.5 - 0.04 * Math.min(v.rank, 5), v.via); vias.push(v.via); }
    }

    let note = '';
    if (vias.length && seen.size > direct) {
      note = 'за словником: ' + [...new Set(vias)].slice(0, 3).join('; ');
    }

    // щабель 3а: інше прочитання всього запиту — розкладка, латиниця, російські літери
    if (!strict && !seen.size && !(opts && opts._inner) && g.PMG_SEARCH && g.PMG_SEARCH.variants) {
      for (const v of g.PMG_SEARCH.variants(raw)) {
        const r = search(list, v.text, Object.assign({}, opts, { _inner: true }));
        if (r.items.length) {
          for (const x of r.items) seen.set(x.e, { e: x.e, score: x.score * 0.9, via: x.via });
          note = `${v.why}: шукаю «${v.text}»` + (r.note ? '; ' + r.note : '');
          break;
        }
      }
    }

    // щабель 3б: схоже написання — слово, якого немає в жодній назві, замінюємо найближчим
    if (!strict && !seen.size) {
      const voc = vocabOf(list, getText);
      const fixed = [];
      let unfixed = 0;
      const toks2 = tokens.map((tok) => {
        if (tok.short || voc.words.has(tok.t) || voc.stems.has(tok.s) || hasPrefix(voc, tok.t)) return tok.t;
        const c = closest(tok.t, voc);
        if (!c) { unfixed++; return tok.t; }
        fixed.push(`«${tok.t}» → «${c.w}»`);
        // основою, а не однією з форм: інакше вище стануть назви саме з цією формою слова
        return c.s.length >= 4 ? c.s : c.w;
      });
      // виправляємо, лише коли знайшлося написання для КОЖНОГО відсутнього слова: інакше запит
      // про інше (наприклад, «перелом» у переліку ліків) дав би випадкові схожі слова
      if (fixed.length && !unfixed) {
        const q2 = toks2.join(' ');
        push(runVariant(list, getText, q2, filter), 0.6, '');
        for (const v of variants(makeTokens(q2), scope)) {
          const found = runVariant(list, getText, v.text, filter);
          if (found.length) push(found, 0.3, v.via);
        }
        if (seen.size) note = 'схоже написання: ' + fixed.join(', ');
      }
    }

    // щабелі 4–5 відкидають слова. Для коротких переліків (ліки) це шкідливо: «хвороба Крона» без
    // «Крона» дала б ліки від хвороби Паркінсона. Такі розділи передають opts.noDrop.
    const noDrop = !!(opts && opts.noDrop);
    // щабель 4: слова, якого немає в жодній назві, не має сенсу вимагати
    if (!strict && !noDrop && !seen.size && tokens.length > 1) {
      const dead = tokens.filter((tok) => !list.some((e) => { prep(e, getText(e)); return tokenTier(e, tok) > 0; }));
      const alive = tokens.filter((tok) => !dead.includes(tok));
      // якщо відкинути довелося б більшість слів, результат уже не про запит — краще чесне «нічого»
      if (dead.length && alive.length >= dead.length) {
        const q2 = alive.map((t) => t.t).join(' ');
        push(runVariant(list, getText, q2, filter), 0.3, '');
        for (const v of variants(alive, scope)) {
          const found = runVariant(list, getText, v.text, filter);
          if (found.length) push(found, 0.2, v.via);
        }
        if (seen.size) {
          note = `у назвах немає ${dead.length > 1 ? 'слів' : 'слова'} ` +
            dead.map((t) => `«${t.t}»`).join(', ') + ' — показано без ' + (dead.length > 1 ? 'них' : 'нього');
        }
      }
    }

    // щабель 5: усі слова в назвах є, але разом не трапляються — показуємо без одного,
    // обираючи те слово, без якого результат найвужчий (тобто найближчий до запиту)
    if (!strict && !noDrop && !seen.size && tokens.length > 2) {
      let best = null;
      for (let i = 0; i < tokens.length; i++) {
        const q2 = tokens.filter((_, j) => j !== i).map((t) => t.t).join(' ');
        const found = runVariant(list, getText, q2, filter);
        if (found.length && (!best || found.length < best.found.length)) best = { found, dropped: tokens[i].t };
      }
      if (best) {
        push(best.found, 0.3, '');
        note = `разом ці слова в назвах не трапляються — показано без слова «${best.dropped}»`;
      }
    }

    const items = [...seen.values()];
    return { items, note };
  }

  /**
   * Переписати запит для розділу, що шукає підрядком (навігатор пакетів, постанова).
   * voc — PMG_FIND.vocabulary(тексти розділу, уже пропущені через PMG_SEARCH.text).
   * Повертає {query, changes: [{from, to, why}], note}. query — слова через пробіл; кожне з них
   * розділ шукає як підрядок, тому основа слова («стаціонарн») знаходить усі відмінки.
   * Порядок: запит як є → інше прочитання (розкладка, латиниця) → словник → інша форма слова →
   * схоже написання. Слово, для якого нічого не знайшлося, лишається як було.
   */
  function rewrite(raw, voc, opts) {
    const scopes = (opts && opts.scopes) || [''];
    const q = norm(String(raw || '').trim()).replace(/\s+/g, ' ');
    const out = { query: q, changes: [], note: '' };
    if (!q) return out;
    const known = (t) => t.length <= 2 || /^[\d.,%-]+$/.test(t) || voc.words.has(t) || hasPrefix(voc, t);
    let toks = words(q);
    if (!toks.length || toks.every(known)) return out;

    // інше прочитання всього запиту; слово варіанта рахується, якщо воно є або має схоже написання
    // (розкладка + опечатка разом: «rfh,fvfptgsy» без коми → «карамазепін» → «карбамазепін»)
    const reach = (t) => known(t) || !!closest(t, voc);
    if (g.PMG_SEARCH && g.PMG_SEARCH.variants) {
      for (const v of g.PMG_SEARCH.variants(raw)) {
        const vt = words(norm(v.text));
        if (vt.length && vt.filter(reach).length > toks.filter(reach).length) {
          out.changes.push({ from: String(raw).trim().toLowerCase(), to: vt.join(' '), why: v.why });
          toks = vt;
          break;
        }
      }
    }
    if (toks.every(known)) return finish(out, toks);

    // словник: побутова назва, абревіатура, торговельна назва → формулювання документа
    const tk = makeTokens(toks.join(' '));
    for (const scope of scopes) {
      for (const v of variants(tk, scope)) {
        const vt = words(v.text);
        if (vt.every(known)) {
          out.changes.push({ from: toks.join(' '), to: vt.join(' '), why: 'словник: ' + v.via });
          return finish(out, vt);
        }
      }
    }

    // по слову: інша форма → схоже написання
    toks = toks.map((t) => {
      if (known(t)) return t;
      const s = stem(t);
      if (s.length >= 4 && voc.stems.has(s)) {
        out.changes.push({ from: t, to: s, why: 'інша форма слова' });
        return s;
      }
      const c = closest(t, voc);
      if (c) {
        const to = c.s.length >= 4 ? c.s : c.w;
        out.changes.push({ from: t, to: c.w, term: to, why: 'схоже написання' });
        return to;
      }
      return t;
    });
    return finish(out, toks);
  }
  function finish(out, toks) {
    out.query = toks.join(' ');
    const shown = out.changes.filter((c) => c.why !== 'інша форма слова');
    if (shown.length) {
      out.note = shown.map((c) => (c.why.startsWith('словник') ? c.why
        : `${c.why}: «${c.from}» → «${c.to}»`)).join('; ');
    }
    return out;
  }

  /** Групи словника, ключ яких є в запиті (з усіма полями групи — зокрема absent). */
  function groupsFor(raw, scope) {
    const stems = makeTokens(norm(raw)).map((t) => t.s);
    return SYN.filter((x) => x.scope === (scope || '') && x.keys.some((key) => {
      for (let i = 0; i + key.length <= stems.length; i++) if (key.every((k, j) => stems[i + j] === k)) return true;
      return false;
    })).map((x) => x.grp);
  }

  /** Що спільний пошук знаходить понад те, що розділ уже знайшов сам. */
  function extra(list, raw, have, opts) {
    const r = search(list, raw, opts);
    const items = r.items.filter((x) => !have.has(x.e)).sort((a, b) => b.score - a.score).map((x) => x.e);
    return { items, note: items.length ? r.note : '' };
  }

  /** Чи всі слова запиту є в одному тексті (для розділів зі своїм ранжуванням). */
  function test(e, text, raw) {
    const tokens = makeTokens(norm(raw));
    if (!tokens.length) return false;
    prep(e, text);
    return tokens.every((tok) => tokenTier(e, tok) > 0);
  }

  g.PMG_FIND = { search, extra, test, ready, setSynonyms, stem, rewrite, vocabulary, closest, groupsFor,
    _variants: (raw, scope) => variants(makeTokens(norm(raw)), scope) };
})(typeof window !== 'undefined' ? window : globalThis);
