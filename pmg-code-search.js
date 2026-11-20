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
 *   4. якщо якогось слова немає в жодній назві — пошук без нього, з чесною приміткою.
 *
 * Підключати звичайним <script> ПІСЛЯ pmg-search-norm.js і ДО скрипта розділу:
 *   <script src="../pmg-search-norm.js?v=1" defer></script>
 *   <script src="../pmg-code-search.js?v=20261119a" defer></script>
 *
 * PMG_FIND.search(list, raw, opts) → { items: [{e, score, via}], note }
 *     list — масив записів; opts.text(e) — нормалізована назва (типово e._t);
 *     opts.scope — сфера словника: групи з полем scope («kadry» — посади й спеціальності,
 *              «equipment» — обладнання)
 *              працюють лише в пошуку з тією самою сферою, групи без scope — у пошуку кодів;
 *     via  — пояснення для результатів зі словника («рак → злоякісне новоутворення»);
 *     note — рядок для користувача, коли спрацював щабель 3 або 4.
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
      if (keys.length && to.length) SYN.push({ keys, to, q: grp.q, scope: grp.scope || '' });
    }
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
    synPromise = g.fetch(BASE + 'data/search_synonyms.json?v=20261120b')
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

    // щабель 4: слова, якого немає в жодній назві, не має сенсу вимагати
    if (!strict && !seen.size && tokens.length > 1) {
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
    if (!strict && !seen.size && tokens.length > 2) {
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

  /** Чи всі слова запиту є в одному тексті (для розділів зі своїм ранжуванням). */
  function test(e, text, raw) {
    const tokens = makeTokens(norm(raw));
    if (!tokens.length) return false;
    prep(e, text);
    return tokens.every((tok) => tokenTier(e, tok) > 0);
  }

  g.PMG_FIND = { search, test, ready, setSynonyms, stem, _variants: (raw) => variants(makeTokens(norm(raw))) };
})(typeof window !== 'undefined' ? window : globalThis);
