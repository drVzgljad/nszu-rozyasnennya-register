// Групер ДСГ — дзеркало 20_кодування/grouper/predict.py (а той спирається на
// rules.py і mapping.py). Будь-яка зміна логіки тут має повторювати зміну там,
// інакше сторінка почне розходитись із тим, що ми виміряли. Розбіжність ловить
// 20_кодування/grouper/check_js_parity.py: він проганяє ті самі випадки через
// цей файл у Node і через predict.py й вимагає повного збігу.
//
// Правила НЕ лежать файлами в теці розділу. Репозиторій деплою публічний, і
// json звідти віддається будь-кому в обхід оверлея «Доступ обмежено» — а це
// наша реконструкція, здобута зі статистики службової бази. Тому вони живуть
// у таблиці grouper_rules під RLS: замок стоїть на сервері, а не у верстці.
// Те саме рішення, що для pmg_rules у koduvannia.js.
//
// Таблицю співставлення (data/core.json, dx.json, iv.json) сторінка читає
// звичайними файлами: це офіційний документ, він і так відкритий у розділі
// «Кодування випадку».

// Версія логіки, яку вміє цей файл. upload_supabase.py звіряє її з версією
// правил і не дасть залити правила, новіші за задеплоєну сторінку.
export const LOGIC_VERSION = 2;

const SB_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SB_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const MAP_V = 'v=40';     // та сама мітка, що в koduvannia.js: файли спільні

let DX, IV, GI, RANK, MODAL, TREES, GROUPS, META, H, MAP;
let VERSION = 1;          // версія ПРАВИЛ у базі: сторінка вміє обидві
let MIN_APPLY = 0.85;     // поріг чистоти листка дерева
let WITH_CODES = false;   // ознаки iv:<код> у деревах

// Pre-MDC: групи, які визначає втручання незалежно від ОДК. Порядок на
// випадок кількох — як у predict.PRE_MDC.
const PRE_MDC = ['A40', 'A13', 'A14', 'A15'];
// Групи, для яких правило 801 не діє (пологи) — predict.NO_801.
const NO_801 = new Set(['O67']);
const STRUCTURAL = new Set(['pre-mdc', '801']);

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const get = (o, k) => (o && has(o, k) ? o[k] : undefined);

/* Формат сховища токена плаває від версії бібліотеки: один ключ; той самий,
   розрізаний на «.0»/«.1»; значення в обгортці «base64-». Не припускаємо
   формат, а перебираємо — те саме місце, де замок колись не відкривався
   залогіненому користувачеві. Копія з koduvannia.js. */
function sbToken() {
  try {
    const keys = Object.keys(localStorage)
      .filter(k => /^sb-.+-auth-token(\.\d+)?$/.test(k))
      .sort((a, b) => {
        const n = k => { const m = k.match(/\.(\d+)$/); return m ? +m[1] : -1; };
        return n(a) - n(b);
      });
    if (!keys.length) return null;
    let raw = keys.map(k => localStorage.getItem(k) || '').join('');
    if (raw.startsWith('base64-')) {
      const bin = atob(raw.slice(7));
      raw = new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
    }
    const s = JSON.parse(raw);
    return (s && (s.access_token ||
                  (s.currentSession && s.currentSession.access_token))) || null;
  } catch (e) { return null; }
}

/* Лише для локальної перевірки. Правил у теці сайту немає і бути не може, тож
   без логіна сторінку не побачити. На localhost параметр
   ?rules=http://localhost:ПОРТ/ дає взяти блоки з локального сервера, що
   роздає 20_кодування/grouper/data/portal/. На бойовому хості гілка мертва. */
function devRulesBase() {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return null;
  const u = new URLSearchParams(location.search).get('rules');
  return u && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(u) ? u : null;
}

async function loadJson(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(path);
      if (r.ok) return await r.json();
    } catch (e) { /* локальний сервер рве з'єднання на великих файлах */ }
    await new Promise(s => setTimeout(s, 250 * (i + 1)));
  }
  throw new Error(`не вдалося прочитати ${path}`);
}

const BLOCKS_V1 = ['dx_index', 'iv_index', 'hierarchy', 'combo_rules', 'groups_lite', 'meta'];

async function loadBlocks() {
  const dev = devRulesBase();
  const by = {};
  if (dev) {
    for (const k of [...BLOCKS_V1, 'gi_codes']) by[k] = await loadJson(`${dev}${k}.json`);
    return by;
  }
  const token = sbToken();
  if (!token) throw new Error('НЕМАЄ СЕСІЇ');
  const r = await fetch(`${SB_URL}/rest/v1/grouper_rules?select=key,payload`,
                        { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) throw new Error('СЕСІЯ ЗАСТАРІЛА');
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  (await r.json()).forEach(x => { by[x.key] = x.payload; });
  return by;
}

async function boot() {
  const by = await loadBlocks();
  const v = (by.hierarchy && by.hierarchy.version) || 1;
  const need = v >= 2 ? [...BLOCKS_V1, 'gi_codes'] : BLOCKS_V1;
  const missing = need.filter(k => !by[k]);
  if (missing.length) throw new Error(`НЕМАЄ ПРАВИЛ: ${missing.join(', ')}`);
  if (v > LOGIC_VERSION) throw new Error(`ПРАВИЛА НОВІШІ: ${v}`);
  let map = null;
  if (v >= 2) {
    // по одному, не паралельно: два великі fetch одночасно на локальному
    // сервері дають «Failed to fetch»
    map = { core: await loadJson(`data/core.json?${MAP_V}`) };
    map.dx = await loadJson(`data/dx.json?${MAP_V}`);
    map.iv = await loadJson(`data/iv.json?${MAP_V}`);
  }
  init(by, map);
  renderMeta();
  renderHow();
  wire();
}

/* Стан групера з блоків правил. Окремо від boot(), щоб ту саму логіку можна
   було підняти в Node без браузера (check_js_parity.py). */
export function init(by, map) {
  DX = by.dx_index; IV = by.iv_index; GROUPS = by.groups_lite; META = by.meta;
  H = by.hierarchy;
  VERSION = H.version || 1;
  RANK = H.adrg_rank; MODAL = H.dx_modal; TREES = by.combo_rules.trees;
  MIN_APPLY = by.combo_rules.min_apply || 0.85;
  WITH_CODES = !!by.combo_rules.with_codes;
  GI = new Set(by.gi_codes || []);
  MAP = VERSION >= 2 ? map : null;
  PREFIX = null;
  DX_MEMO.clear(); IV_MEMO.clear(); FLAT_MEMO.clear();
}

// ── пошук коду ─────────────────────────────────────────────────────────────
// Наші коди на знак довші за класифікацію-джерело, тому йдемо каскадом від
// найточнішого до кореня (G93.80 -> G93.8 -> G93).
function variants(code) {
  const out = [code];
  const dot = code.indexOf('.');
  if (dot > 0) {
    const head = code.slice(0, dot), tail = code.slice(dot + 1);
    for (let i = tail.length - 1; i > 0; i--) out.push(`${head}.${tail.slice(0, i)}`);
    out.push(head);
  }
  return out;
}

// Друга пастка, дзеркальна до першої: наші коди бувають і КОРОТШИМИ за
// класифікацію-джерело. G82.4 «спастична тетраплегія» розписаний там як
// G82.40…G82.46, самого G82.4 немає. Без розширення такий діагноз випадає
// з правил разом з групою, до якої веде. Індекс будуємо раз при старті.
let PREFIX = null;
function prefixIndex() {
  if (PREFIX) return PREFIX;
  PREFIX = new Map();
  for (const k of Object.keys(DX)) {
    const dot = k.indexOf('.');
    if (dot < 0) continue;
    const head = k.slice(0, dot), tail = k.slice(dot + 1);
    for (let i = 1; i < tail.length; i++) {
      const key = `${head}.${tail.slice(0, i)}`;
      if (!PREFIX.has(key)) PREFIX.set(key, []);
      PREFIX.get(key).push(k);
    }
  }
  return PREFIX;
}

// Діагноз -> [[ОДК, [ADRG]], …] за додатком A (rules._dx_appendix)
function dxAppendix(code) {
  for (const v of variants(code)) if (has(DX, v)) return DX[v];
  const kids = prefixIndex().get(code);
  if (!kids) return [];
  const out = [], seen = new Set();
  for (const k of kids) for (const [mdc, adrg] of DX[k]) {
    const key = `${mdc}|${adrg.join(',')}`;
    if (!seen.has(key)) { seen.add(key); out.push([mdc, adrg]); }
  }
  return out;
}

// Індекси груп Таблиці -> Map(ОДК -> Set(корінь)). ОДК береться з групи.
function mapGroups(idx, by) {
  const { mdc, groups } = MAP.core;
  for (const i of idx) {
    const g = groups[i];
    for (const m of (g.mdc || [])) {
      if (!by.has(mdc[m])) by.set(mdc[m], new Set());
      by.get(mdc[m]).add(g.root);
    }
  }
  return by;
}

// Діагноз за Таблицею співставлення (mapping.dx_entries).
// Запис: [наші ОДК, ОДК за AR, групи AR, наші групи | 0, якість збігу];
// 0 на місці «наших груп» означає «ті самі, що в AR». Від'ємний індекс —
// умовне посилання AR, його не беремо.
function mapDx(code) {
  let e = get(MAP.dx, code);
  if (e === undefined) {
    const head = code.split('.')[0], tail = code.slice(head.length + 1);
    for (let i = tail.length - 1; i > 0 && e === undefined; i--)
      e = get(MAP.dx, `${head}.${tail.slice(0, i)}`);
    if (e === undefined) e = get(MAP.dx, head);
  }
  if (!e) return new Map();
  const own = Array.isArray(e[3]) ? e[3] : (e[2] || []);
  return mapGroups(own.filter(i => i >= 0), new Map());
}

// Втручання за Таблицею (mapping.iv_entries): розкладка за ОДК плюс плаский
// перелік — у частини кодів розкладка порожня (90665-00 -> J08).
function mapIv(code) {
  const e = get(MAP.iv, code);
  const by = new Map();
  if (!e) return by;
  const { mdc, groups } = MAP.core;
  for (const [m, idx] of (e[0] || [])) {
    if (!by.has(mdc[m])) by.set(mdc[m], new Set());
    for (const i of idx) if (i >= 0) by.get(mdc[m]).add(groups[i].root);
  }
  return mapGroups(e[1] || [], by);
}

// Корені груп із плаского переліку Таблиці (mapping.iv_flat) — для Pre-MDC.
const FLAT_MEMO = new Map();
function ivFlat(code) {
  if (!FLAT_MEMO.has(code)) {
    const e = MAP ? get(MAP.iv, code) : undefined;
    FLAT_MEMO.set(code, e ? [...new Set((e[1] || []).map(i => MAP.core.groups[i].root))] : []);
  }
  return FLAT_MEMO.get(code);
}

// Два джерела -> один перелік [[ОДК, [ADRG відсортовано]], …] (rules._merge)
function merge(appendix, table) {
  const by = new Map();
  for (const [m, lst] of appendix) {
    if (!by.has(m)) by.set(m, new Set());
    lst.forEach(a => by.get(m).add(a));
  }
  for (const [m, set] of table) {
    if (!by.has(m)) by.set(m, new Set());
    set.forEach(a => by.get(m).add(a));
  }
  return [...by].map(([m, s]) => [m, [...s].sort()]);
}

const DX_MEMO = new Map(), IV_MEMO = new Map();
function dxEntries(code) {
  if (!DX_MEMO.has(code))
    DX_MEMO.set(code, MAP ? merge(dxAppendix(code), mapDx(code)) : dxAppendix(code));
  return DX_MEMO.get(code);
}
function ivEntries(code) {
  if (!IV_MEMO.has(code)) {
    const a = get(IV, code) || [];
    IV_MEMO.set(code, MAP ? merge(a, mapIv(code)) : a);
  }
  return IV_MEMO.get(code);
}

function parseCodes(s) {
  return (s || '').split(/[,;\n]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
}

// Кандидати (rules.candidates). ОДК задає основний діагноз; додаткові
// діагнози і втручання дають кандидатів лише в межах того самого ОДК.
// sec і ivc — Map(група -> код, що до неї привів): для пояснення на екрані.
function candidates(main, add, ivs) {
  const ent = dxEntries(main);
  const mdcs = new Set(ent.map(e => e[0]));
  const pd = new Set(), sec = new Map(), ivc = new Map();
  ent.forEach(([, lst]) => lst.forEach(a => pd.add(a)));
  add.forEach(c => dxEntries(c).forEach(([m, lst]) => {
    if (mdcs.has(m)) lst.forEach(a => { if (!sec.has(a)) sec.set(a, c); });
  }));
  ivs.forEach(c => ivEntries(c).forEach(([m, lst]) => {
    if (mdcs.has(m)) lst.forEach(a => { if (!ivc.has(a)) ivc.set(a, c); });
  }));
  const all = new Set([...pd, ...sec.keys(), ...ivc.keys()]);
  return { found: ent.length > 0, mdcs: [...mdcs], pd, sec, ivc, all };
}

// Загальне втручання, не пов'язане з ОДК основного діагнозу
// (rules.unrelated_gi). Повертає сам код або null.
function unrelatedGi(main, ivs) {
  const ent = dxEntries(main);
  if (!ent.length) return null;
  const mdcs = new Set(ent.map(e => e[0]));
  for (const c of ivs)
    if (GI.has(c) && !ivEntries(c).some(([m]) => mdcs.has(m))) return c;
  return null;
}

// ── ознаки випадку для дерев (predict.features) ───────────────────────────
function trauma_block(code) {
  if (!code || !'ST'.includes(code[0])) return null;
  const num = parseInt(code.slice(1, 3), 10);
  if (isNaN(num)) return null;
  if (code[0] === 'T') return num <= 14 ? 'T' : null;
  for (const [hi, name] of [[9, 'head'], [19, 'neck'], [29, 'thorax'],
                            [39, 'abdomen'], [69, 'upper'], [99, 'lower']])
    if (num <= hi) return name;
  return null;
}

function features(main, add, ivs) {
  const f = new Set();
  const mdcs = new Set(dxEntries(main).map(e => e[0]));
  add.forEach(c => {
    f.add('dx:' + c.split('.')[0]);
    dxEntries(c).forEach(([m, lst]) => {
      if (mdcs.has(m)) lst.forEach(a => f.add('dxa:' + a));
    });
  });
  ivs.forEach(c => {
    let hit = false;
    ivEntries(c).forEach(([m, lst]) => {
      if (mdcs.has(m)) { hit = true; lst.forEach(a => f.add('iva:' + a)); }
    });
    if (hit && WITH_CODES) f.add('iv:' + c);
  });
  // у версії 1 сторінка ознаки gi не мала — лишаємо як було
  if (VERSION >= 2 && unrelatedGi(main, ivs)) f.add('gi');
  const blocks = new Set([main, ...add].map(trauma_block).filter(Boolean));
  [2, 3, 4].forEach(t => { if (blocks.size >= t) f.add(`tb>=${t}`); });
  [3, 5, 8].forEach(t => { if (add.length >= t) f.add(`nd>=${t}`); });
  return f;
}

function applyTree(node, feats, path) {
  while (node.feat !== undefined) {
    const hit = feats.has(node.feat);
    path.push({ feat: node.feat, hit });
    node = hit ? node.yes : node.no;
  }
  return { group: node.leaf, purity: node.purity || 0, n: node.n || 0 };
}

// ── щаблі (predict.tier / _norm / tierset) ─────────────────────────────────
// 's' хірургічна 01–39, 'o' інша 40–59, 'm' медична 60–99, 'x' службова
function tier(a) {
  if (!a || !/[A-Za-z]/.test(a[0])) return 'x';
  const d = a.slice(1, 3);
  if (!/^\d+$/.test(d)) return 'x';
  const n = parseInt(d, 10);
  return n < 40 ? 's' : (n < 60 ? 'o' : 'm');
}

const remapOf = a => get(H.remap || {}, a) || a;
const isValid = root => has(GROUPS, root);    // чинна сітка = ключі groups_lite

function norm(groups, want) {
  const out = new Set();
  for (const a of groups) {
    if (want && tier(a) !== want) continue;
    const b = remapOf(a);
    if (isValid(b)) out.add(b);
  }
  return out;
}

// Щабель рахується за ВИХІДНОЮ групою AR-DRG, а назва вже перекладена: O01
// «кесарів розтин» лишається на хірургічному щаблі, хоч у нашій сітці це O67.
function tierset(c) {
  for (const [src, t] of [['ivc', 's'], ['ivc', 'o'], ['pd', 'm']]) {
    const T = norm(src === 'pd' ? c.pd : c.ivc.keys(), t);
    if (T.size) return { tn: (src === 'pd' ? 'pd' : 'iv') + t, T };
  }
  return { tn: 'rest', T: norm(c.all, null) };
}

const setKey = T => [...T].sort().join('|');

function byRank(T) {
  let best = null;
  for (const a of T) {
    const r = has(RANK, a) ? RANK[a] : -1;
    if (!best || r > best[1] || (r === best[1] && a > best[0])) best = [a, r];
  }
  return best ? best[0] : null;
}

// Вибір усередині щабля (predict.pick_in_tier)
function pickInTier(main, tn, T) {
  if (!T.size) return [null, 'none'];
  if (T.size === 1) return [[...T][0], 'single'];
  const k = setKey(T);
  let g = get(H.dx_set_modal, `${main}#${k}`);
  if (g !== undefined && T.has(g)) return [g, 'dx+set'];
  g = get(MODAL, main);
  if ((tn === 'pdm' || tn === 'rest') && g !== undefined && T.has(g)) return [g, 'modal'];
  g = get(H.set_modal, k);
  if (g !== undefined && T.has(g)) return [g, 'set'];
  return [byRank(T), 'rank'];
}

// Група від додаткового діагнозу, що перебиває базову (predict.sec_override).
// -> { g, chain: [{ from, to, code }] }
function secOverride(g, c) {
  const chain = [];
  const ov = H.sec_over;
  if (!ov || g === null) return { g, chain };
  const sec = new Map();                  // перекладена група -> код діагнозу
  for (const [a, code] of c.sec) {
    const b = remapOf(a);
    if (isValid(b) && !sec.has(b)) sec.set(b, code);
  }
  for (let i = 0; i < 3; i++) {           // B71 -> B82 -> B83: ланцюжок короткий
    let best = null;
    for (const x of sec.keys()) {
      if (x === g) continue;
      const v = get(ov, `${g}>${x}`) || 0;
      if (v > 0 && (!best || v > best[0] || (v === best[0] && x > best[1]))) best = [v, x];
    }
    if (!best) break;
    chain.push({ from: g, to: best[1], code: sec.get(best[1]) });
    g = best[1];
  }
  return { g, chain };
}

// Втручання -> група Pre-MDC за пласким переліком Таблиці (predict.context)
function preMdc(ivs) {
  const pre = new Map();
  for (const c of ivs)
    for (const a of ivFlat(c)) if (PRE_MDC.includes(a) && !pre.has(a)) pre.set(a, c);
  const g = PRE_MDC.find(a => pre.has(a));
  return g ? { group: g, code: pre.get(g) } : null;
}

// Повне рішення версії 2 (predict._predict_v2).
// code — та сама мітка «щабель:причина», яку дає predict.py: за нею звіряємось.
function predictV2(main, add, ivs) {
  const c = candidates(main, add, ivs);
  const { tn, T } = tierset(c);
  const pre = preMdc(ivs);
  const gi = unrelatedGi(main, ivs);
  const r = { cand: c, tn, T, group: null, why: 'none', base: null, baseWhy: 'none',
              chain: [], pre, gi, tree: null };

  if (pre && isValid(pre.group)) {
    r.group = pre.group; r.why = 'pre-mdc'; r.tn = 'pre';
  } else if (gi && tn !== 'ivs' && ![...T].some(a => NO_801.has(a)) && isValid('801')) {
    r.group = '801'; r.why = '801'; r.tn = 'gi';
  } else {
    const [g, why] = pickInTier(main, tn, T);
    r.base = g; r.baseWhy = why;
    const s = secOverride(g, c);
    r.group = s.g; r.chain = s.chain;
    r.why = s.chain.length ? 'sec' : why;
  }

  const t = get(TREES, main);
  if (t && !STRUCTURAL.has(r.why)) {
    const path = [];
    const leaf = applyTree(t, features(main, add, ivs), path);
    const allc = norm(c.all, null);
    const ok = !!leaf.group && leaf.purity >= MIN_APPLY &&
               (allc.size === 0 || allc.has(leaf.group));
    r.tree = { ...leaf, path, applied: ok,
               inCand: allc.size === 0 || allc.has(leaf.group) };
    if (ok) {
      if (leaf.group !== r.group) r.why = 'tree';
      r.group = leaf.group;
    }
  }
  r.code = `${r.tn}:${r.why}`;
  return r;
}

// ── пояснення українською ──────────────────────────────────────────────────
const TIER_NAME = {
  ivs: 'хірургічний щабель', ivo: 'щабель інших втручань', pdm: 'медичний щабель',
  rest: 'усі кандидати', pre: 'Pre-MDC', gi: 'втручання поза ОДК',
};
const cnt = n => Number(n).toLocaleString('uk');
const codesTo = (map, T) => [...new Set([...map]
  .filter(([a]) => T.has(remapOf(a))).map(([, code]) => code))].join(', ');

function explainV2(r, main) {
  const why = [];
  const list = [...r.T].sort().join(', ');
  if (r.why === 'pre-mdc') {
    why.push({ rule: 'Pre-MDC', text:
      `Втручання ${r.pre.code} за Таблицею співставлення належить до групи ${r.pre.group}. ` +
      `Такі групи визначає саме втручання, незалежно від діагнозу.` });
    return why;
  }
  if (r.why === '801') {
    why.push({ rule: 'втручання поза ОДК', text:
      `Втручання ${r.gi} — загальне (додаток E AR-DRG) і не пов'язане з ОДК основного ` +
      `діагнозу, а хірургічних кандидатів у своєму ОДК немає. Такий випадок іде в групу 801.` });
    return why;
  }
  if (r.tn === 'ivs') why.push({ rule: 'хірургічний щабель', text:
    `Втручання ${codesTo(r.cand.ivc, r.T)} веде в хірургічну групу свого ОДК, ` +
    `тому вибір іде лише серед хірургічних кандидатів: ${list}.` });
  else if (r.tn === 'ivo') why.push({ rule: 'щабель інших втручань', text:
    `Хірургічних кандидатів немає; втручання ${codesTo(r.cand.ivc, r.T)} веде в групу ` +
    `з втручанням (номери 40–59): ${list}.` });
  else if (r.tn === 'pdm') why.push({ rule: 'медичний щабель', text:
    `Втручань, що ведуть у хірургічну чи «іншу» групу свого ОДК, немає — ` +
    `групу визначає основний діагноз ${main}: ${list}.` });
  else why.push({ rule: 'запасний щабель', text:
    `Основний діагноз не дав медичної групи, а втручання — хірургічної. ` +
    `Вибір серед усіх кандидатів: ${list || 'їх немає'}.` });

  const k = setKey(r.T);
  if (r.baseWhy === 'single') why.push({ rule: 'один кандидат', text:
    `На цьому щаблі кандидат один — ${r.base}.` });
  else if (r.baseWhy === 'dx+set') {
    const e = get(H.dx_set_modal_evidence || {}, `${main}#${k}`) || [];
    why.push({ rule: 'діагноз і набір кандидатів', text:
      `Для діагнозу ${main} з таким набором кандидатів у ${cnt(e[0])} з ${cnt(e[1])} ` +
      `фактично згрупованих випадків була група ${r.base}.` });
  } else if (r.baseWhy === 'modal') why.push({ rule: 'найчастіша група діагнозу', text:
    `Для діагнозу ${main} серед фактично згрупованих випадків найчастіше була група ${r.base}.` });
  else if (r.baseWhy === 'set') {
    const e = get(H.set_modal_evidence || {}, k) || [];
    why.push({ rule: 'набір кандидатів', text:
      `З таким набором кандидатів у ${cnt(e[0])} з ${cnt(e[1])} фактично згрупованих ` +
      `випадків була група ${r.base}.` });
  } else if (r.baseWhy === 'rank') why.push({ rule: 'попарний ранг', text:
    `Такого набору кандидатів у навчальних даних не було. Обрано ${r.base} — групу з ` +
    `найвищим попарним рангом. Це здогад, а не перевірене правило.` });

  r.chain.forEach(s => {
    const e = get(H.sec_over_evidence || {}, `${s.from}>${s.to}`) || [];
    why.push({ rule: 'додатковий діагноз', text:
      `Додатковий діагноз ${s.code} веде в групу ${s.to}. У ${cnt(e[0])} з ${cnt(e[1])} ` +
      `фактично згрупованих випадків вона перебивала групу ${s.from}.` });
  });

  if (r.tree) {
    const t = r.tree;
    const path = t.path.map(p => `${p.hit ? 'є' : 'немає'} ${p.feat}`).join(', ');
    if (t.applied) why.push({ rule: 'комбінаційне правило', text:
      `Спрацювало дерево рішень для ${main}: ${path} → ${t.group} ` +
      `(чистота ${Math.round(t.purity * 100)}%, ${cnt(t.n)} випадків).` });
    else if (t.group) why.push({ rule: 'дерево не застосоване', text:
      `Комбінаційне дерево для ${main} дало ${t.group}, але ` +
      (t.purity < MIN_APPLY
        ? `його впевненість ${Math.round(t.purity * 100)}% нижча за поріг ${MIN_APPLY * 100}%.`
        : `цієї групи немає серед кандидатів.`) });
  }

  const from = [...r.cand.all].filter(a => remapOf(a) === r.group && a !== r.group);
  if (from.length) why.push({ rule: 'українська сітка', text:
    `${from.sort().join(', ')} — ${from.length > 1 ? 'групи' : 'група'} AR-DRG, ` +
    `${from.length > 1 ? 'яких' : 'якої'} немає в сітці постанови 1808. ` +
    `В українській сітці це ${r.group}.` });
  return why;
}

// ── версія 1: логіка до 10.11.2026, для правил, залитих раніше ─────────────
function groupV1(main, add, ivs) {
  const c = candidates(main, add, ivs);
  if (!c.found) return { error: `Діагноз ${main} не знайдено серед правил групування.` };
  const res = { cand: c, why: [], mdcs: c.mdcs, T: c.all, code: 'v1' };

  const modal = get(MODAL, main);
  if (modal && c.all.has(modal)) {
    res.group = modal;
    res.why.push({ rule: 'модальна група', text:
      `Для діагнозу ${main} серед фактично згрупованих випадків найчастіше зустрічалась група ${modal}.` });
  } else if (c.all.size) {
    // за рівного рангу версія 1 брала першого за порядком появи, а не
    // більшого за назвою, як byRank, — лишаємо як було
    let best = null;
    c.all.forEach(a => {
      const r = has(RANK, a) ? RANK[a] : -1;
      if (!best || r > best[1]) best = [a, r];
    });
    res.group = best[0];
    res.why.push({ rule: 'попарна ієрархія', text:
      `Діагноз ${main} у навчальних даних не траплявся (або його звична група тут неможлива). ` +
      `Обрано кандидата з найвищим рангом у попарній ієрархії.` });
  }

  const tree = get(TREES, main);
  if (tree) {
    const path = [];
    const t = applyTree(tree, features(main, add, ivs), path);
    res.tree = { ...t, path };
    if (t.group && t.purity >= MIN_APPLY && c.all.has(t.group)) {
      res.group = t.group;
      res.why.unshift({ rule: 'комбінаційне правило', text:
        `Спрацювало дерево рішень для ${main}: ` +
        path.map(p => `${p.hit ? 'є' : 'немає'} ${p.feat}`).join(', ') +
        ` → ${t.group} (чистота ${Math.round(t.purity * 100)}%, ${t.n} випадків).` });
    } else if (t.group) {
      res.why.push({ rule: 'дерево не застосоване', text:
        `Комбінаційне дерево для ${main} дало ${t.group}, але ` +
        (t.purity < MIN_APPLY
          ? `його впевненість ${Math.round(t.purity * 100)}% нижча за поріг ${MIN_APPLY * 100}%.`
          : `цієї групи немає серед кандидатів.`) });
    }
  }
  return res;
}

// ── власне групування ──────────────────────────────────────────────────────
// main — рядок, add і ivs — масиви кодів. Повертає group, code (мітка для
// звірки з predict.py), why (пояснення), cand, T (набір щабля).
export function group(main, add, ivs) {
  main = (main || '').trim().toUpperCase();
  add = add.map(x => x.trim().toUpperCase()).filter(Boolean);
  ivs = ivs.map(x => x.trim().toUpperCase()).filter(Boolean);
  if (VERSION < 2) return groupV1(main, add, ivs);
  const r = predictV2(main, add, ivs);
  if (!r.cand.found && !r.group)
    return { error: `Діагноз ${main} не знайдено серед правил групування.`, code: r.code };
  const why = explainV2(r, main);
  const short = [main, ...add].filter(isShortCode);
  if (short.length) why.push({ rule: 'неповний код', text:
    short.map(c => `${c} (у класифікації є лише ${shortKids(c)})`).join('; ') +
    '. Для неповного коду взято всі детальніші варіанти одразу, тому група може ' +
    'бути неточною. Введіть код повністю.' });
  return { group: r.group, code: r.code, why, cand: r.cand,
           mdcs: r.cand.mdcs, T: r.T, tn: r.tn };
}

// Код, якого в додатку A немає ні самого, ні коротшого, але є детальніші:
// G82.4 -> G82.40…G82.46. На групу це не впливає (логіка та сама, що в
// predict.py), але користувач мусить знати, що відповідь зібрана з кількох кодів.
function isShortCode(code) {
  return !variants(code).some(v => has(DX, v)) && prefixIndex().has(code);
}
function shortKids(code) {
  const k = [...prefixIndex().get(code)].sort();
  return k.length > 2 ? `${k[0]}…${k[k.length - 1]}` : k.join(', ');
}

// ── показ ──────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function groupCard(code) {
  const g = get(GROUPS, code);
  if (!g) return `<div class="gr-gcard gr-gcard-un"><b>${esc(code)}</b>
    <span class="gr-mut">немає в чинній сітці постанови 1808</span></div>`;
  const vars = g.v.map(v => {
    const k = (v.k || []).filter(x => x !== null && x !== undefined);
    return `<span class="gr-var"><b>${esc(v.c)}</b>${k.length
      ? ` · ваги ${k.map(x => x.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')).join(' / ')}`
      : ' · ваги не задано'}</span>`;
  }).join('');
  return `<div class="gr-gcard"><div class="gr-gname"><b>${esc(code)}</b> — ${esc(g.t)}</div>
    <div class="gr-vars">${vars}</div></div>`;
}

function render(r) {
  const box = document.getElementById('grResult');
  box.hidden = false;
  if (r.error) { box.innerHTML = `<div class="gr-err">${esc(r.error)}</div>`; return; }

  const c = r.cand, v2 = VERSION >= 2;
  const src = a => {
    const t = [];
    if (c.pd.has(a)) t.push('основний діагноз');
    if (c.sec.has(a)) t.push(`супутній ${esc(c.sec.get(a))}`);
    if (c.ivc.has(a)) t.push(`інтервенція ${esc(c.ivc.get(a))}`);
    return t.join(' · ');
  };
  const cands = [...c.all].sort().map(a => {
    const b = v2 ? remapOf(a) : a;
    const win = b === r.group;
    const g = get(GROUPS, b);
    let tag = '';
    if (win) tag = '<span class="gr-win">обрано</span>';
    else if (v2 && !g) tag = '<span class="gr-out">поза сіткою 1808</span>';
    else if (v2 && !r.T.has(b)) tag = '<span class="gr-out">поза щаблем</span>';
    return `
    <li class="gr-cand${win ? ' gr-cand-win' : ''}${!win && v2 && !r.T.has(b) ? ' gr-cand-off' : ''}">
      <span class="gr-cc">${esc(a)}${b !== a ? ` → ${esc(b)}` : ''}</span>
      <span class="gr-cn">${esc((g || {}).t || '—')}</span>
      <span class="gr-cs">${src(a)}</span>
      ${tag}
    </li>`;
  }).join('');

  box.innerHTML = `
    <div class="gr-head">
      ${c.mdcs.length ? `<div class="gr-odk">ОДК ${c.mdcs.map(esc).join(', ')}</div>` : ''}
      ${v2 && r.tn ? `<div class="gr-odk">${esc(TIER_NAME[r.tn] || r.tn)}</div>` : ''}
      ${r.group ? groupCard(r.group) : '<div class="gr-err">Кандидатів не знайдено.</div>'}
    </div>
    <h3>Чому саме ця група</h3>
    <ul class="gr-why">${r.why.map(w =>
      `<li><b>${esc(w.rule)}.</b> ${esc(w.text)}</li>`).join('')}</ul>
    <h3>Усі кандидати <span class="gr-mut">(${c.all.size})</span></h3>
    <ul class="gr-cands">${cands || '<li class="gr-mut">немає</li>'}</ul>
    <p class="gr-foot">Ваговий коефіцієнт множиться на ставку за пролікований випадок
      і на коефіцієнти застосування — повний розрахунок у
      <a href="../drg/index.html">розділі «Інструменти ДСГ»</a>.</p>`;
}

const pct = x => x.toLocaleString('uk', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function renderMeta() {
  const m = META;
  const head = `
    <div class="stat"><b>${cnt(m.counts.dx_codes)}</b><span>діагнозів у правилах</span></div>
    <div class="stat"><b>${cnt(m.counts.iv_codes)}</b><span>інтервенцій</span></div>`;
  const src = `<p><b>Правила</b> — ${esc(m.rules_source)} і Таблиця співставлення медичних
       послуг. Класифікації: ${esc(m.classifications)}.
       ${cnt(m.counts.dx_codes)} діагнозів і ${cnt(m.counts.iv_codes)} інтервенцій,
       ${m.counts.adrg} груп.</p>`;
  if ((m.version || 1) < 2) {
    const t = m.tested_on, tr = m.trained_on;
    document.getElementById('grStats').innerHTML = head +
      `<div class="stat"><b>${t.accuracy_full}%</b><span>точність на перевірці</span></div>`;
    document.getElementById('grMeta').innerHTML = src + `
      <p><b>Ієрархія вибору</b> здобута зі статистики: ${cnt(tr.cases)} фактично
         згрупованих випадків, плюс ${m.combo_trees} комбінаційних дерев.</p>
      <p><b>Перевірка</b> — ${cnt(t.cases)} випадків за ${t.years.join(', ')} рік,
         якого навчання не бачило: базова стратегія ${t.accuracy_base}%,
         з комбінаційними правилами <b>${t.accuracy_full}%</b>.</p>`;
  } else {
    // головне число — найгірша точність серед пакетів, де перевірка чогось варта
    const big = m.packages.filter(p => p.hold_n >= 1000);
    const worst = Math.min(...big.map(p => p.hold_acc));
    document.getElementById('grStats').innerHTML = head +
      `<div class="stat"><b>від ${pct(worst)}%</b><span>точність на перевірці, за пакетами</span></div>`;
    const rows = m.packages.map(p => `
      <tr><td>${esc(p.pkg)} — ${esc(p.name)}</td>
          <td class="gr-num">${cnt(p.hold_n)}</td>
          <td class="gr-num">${p.hold_acc === null ? '—' : pct(p.hold_acc) + '%'}</td>
          <td class="gr-mut">${esc(p.split)}</td></tr>`).join('');
    document.getElementById('grMeta').innerHTML = src + `
      <p><b>Порядок вибору</b> (хірургічна група → 801 → інша → медична) — з першоджерела.
         <b>Вибір серед кількох кандидатів</b> здобуто зі статистики: ${cnt(m.trained_cases)}
         фактично згрупованих випадків, ${cnt(m.rules.dx_set + m.rules.set)} записів таблиць
         вибору, ${m.rules.sec} пар «додатковий діагноз перебиває групу»
         і ${m.rules.trees} комбінаційних дерев.</p>
      <p><b>Перевірка</b> — на випадках, яких навчання не бачило. Менш як тисяча випадків
         показує напрямок, але точності не доводить.</p>
      <div class="gr-tablewrap"><table class="gr-table">
        <thead><tr><th>Пакет</th><th class="gr-num">Випадків у перевірці</th>
          <th class="gr-num">Збіг групи</th><th>Як відкладено перевірку</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }
  document.getElementById('grLimits').innerHTML =
    m.limits.map(x => `<li>${esc(x)}</li>`).join('');
}

const HOW_V1 = [
  ['ОДК за основним діагнозом.', 'Додаток A класифікації дає для коду одну або кілька основних діагностичних категорій.'],
  ['Кандидати.', 'Групи, у які веде основний діагноз, плюс ті, у які ведуть супутні діагнози та інтервенції — але лише в межах того самого ОДК.'],
  ['Комбінаційне правило.', 'Якщо для цього діагнозу здобуте дерево рішень і воно певне (чистота ≥ 85%) — застосовуємо його.'],
  ['Модальна група.', 'Інакше беремо групу, яка для цього діагнозу найчастіше зустрічалась у фактично згрупованих випадках.'],
  ['Ранг.', 'Якщо діагноз не траплявся — обираємо кандидата з найвищим рангом у попарній ієрархії.'],
];
const HOW_V2 = [
  ['ОДК за основним діагнозом.', 'Додаток A класифікації і Таблиця співставлення дають для коду одну або кілька основних діагностичних категорій. Втручання і супутні діагнози дають кандидатів лише в межах цього ОДК.'],
  ['Pre-MDC.', 'Тривала вентиляція, трахеостомія чи ЕКМО за Таблицею співставлення ведуть у групи A13–A15 і A40 незалежно від діагнозу.'],
  ['Хірургічний щабель.', 'Якщо є втручання, що веде в хірургічну групу (номери 01–39) свого ОДК, вибір іде лише серед таких груп.'],
  ['Група 801.', 'Якщо хірургічних кандидатів немає, але є загальне втручання, не пов\'язане з ОДК основного діагнозу, — це група 801. Виняток — пологи.'],
  ['Інші втручання.', 'Далі — групи з втручанням без операційної (номери 40–59).'],
  ['Медичний щабель.', 'Якщо нічого з цього немає, групу визначає основний діагноз. Супутні діагнози самі групу не задають.'],
  ['Кілька кандидатів на щаблі.', 'Вибір здобуто зі статистики фактично згрупованих випадків: спершу за парою «діагноз і набір кандидатів», далі за самим набором, наостанок за попарним рангом.'],
  ['Додатковий діагноз.', 'Пара- чи тетраплегія або важкий опік серед супутніх діагнозів перебивають групу за основним діагнозом — це теж видно зі статистики.'],
  ['Комбінаційне правило.', 'Для кількох діагнозів є дерево рішень; воно застосовується, якщо певне (чистота ≥ 85%).'],
  ['Українська сітка.', 'Група мусить бути в додатках 1–2 постанови 1808. Австралійські групи пологів (O01, O02, O60) в українській сітці — одна група O67.'],
];

function renderHow() {
  const el = document.getElementById('grHow');
  if (!el) return;
  el.innerHTML = (VERSION >= 2 ? HOW_V2 : HOW_V1)
    .map(([b, t]) => `<li><b>${esc(b)}</b> ${esc(t)}</li>`).join('');
}

function run() {
  const main = document.getElementById('grMain').value.trim();
  if (!main) { document.getElementById('grMain').focus(); return; }
  render(group(main, parseCodes(document.getElementById('grAdd').value),
               parseCodes(document.getElementById('grIv').value)));
}

function wire() {
  document.getElementById('grGo').addEventListener('click', run);
  ['grMain', 'grAdd', 'grIv'].forEach(id =>
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') run();
    }));
  document.querySelectorAll('.gr-ex').forEach(el =>
    el.addEventListener('click', () => {
      document.getElementById('grMain').value = el.dataset.main || '';
      document.getElementById('grAdd').value = el.dataset.add || '';
      document.getElementById('grIv').value = el.dataset.iv || '';
      run();
    }));
}

// У Node (звірка з predict.py) сторінки немає — лише логіка.
if (typeof document !== 'undefined') boot().catch(e => {
  const box = document.getElementById('grResult');
  box.hidden = false;
  const m = e.message || '';
  let text;
  if (m === 'НЕМАЄ СЕСІЇ' || m === 'СЕСІЯ ЗАСТАРІЛА') {
    // Оверлей auth-v2.js уже закриває сторінку, але якщо сесія протухла на
    // відкритій вкладці — людина бачить порожню форму й не розуміє чому.
    text = 'Правила групера доступні лише авторизованим співробітникам. ' +
           'Увійдіть у портал і оновіть сторінку.';
  } else if (m.startsWith('НЕМАЄ ПРАВИЛ')) {
    text = `У базі бракує блоків правил (${esc(m.split(': ')[1] || '')}). ` +
           'Залийте їх завантажувачем 20_кодування/grouper/upload_supabase.py.';
  } else if (m.startsWith('ПРАВИЛА НОВІШІ')) {
    text = 'У базі правила новішої версії, ніж уміє ця сторінка. Оновіть сторінку ' +
           '(Ctrl+F5); якщо не допоможе — сторінку ще не задеплоєно.';
  } else if (m.startsWith('Supabase 404')) {
    text = 'Таблиці grouper_rules немає. Застосуйте міграцію ' +
           'migration_2026-08-19_grouper_rules.sql і залийте правила завантажувачем.';
  } else {
    text = `Не вдалося завантажити правила: ${esc(m)}`;
  }
  box.innerHTML = `<div class="gr-err">${text}</div>`;
});
