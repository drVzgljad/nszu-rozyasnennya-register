// Групер ДСГ — дзеркало серверної логіки з 20_кодування/grouper/rules.py.
// Правила зібрані з відкритих додатків AR-DRG, ієрархія і комбінаційні
// дерева здобуті зі статистики фактично згрупованих випадків.
// Будь-яка зміна логіки тут має повторювати зміну в rules.py, інакше
// сторінка почне розходитись із тим, що ми виміряли.

// Правила НЕ лежать файлами в теці розділу. Репозиторій деплою публічний, і
// json звідти віддається будь-кому в обхід оверлея «Доступ обмежено» — а це
// наша реконструкція, здобута зі статистики службової бази. Тому вони живуть
// у таблиці grouper_rules під RLS: замок стоїть на сервері, а не у верстці.
// Те саме рішення, що для pmg_rules у koduvannia.js.
const SB_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SB_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';

let DX, IV, RANK, MODAL, TREES, GROUPS, META;
const MIN_APPLY = 0.85;   // поріг чистоти листка — той самий, що в learn_combos.py

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

async function boot() {
  const token = sbToken();
  if (!token) throw new Error('НЕМАЄ СЕСІЇ');
  const r = await fetch(`${SB_URL}/rest/v1/grouper_rules?select=key,payload`,
                        { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) throw new Error('СЕСІЯ ЗАСТАРІЛА');
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const rows = await r.json();
  const by = Object.fromEntries(rows.map(x => [x.key, x.payload]));
  const missing = ['dx_index', 'iv_index', 'hierarchy', 'combo_rules', 'groups_lite', 'meta']
    .filter(k => !by[k]);
  if (missing.length) throw new Error(`НЕМАЄ ПРАВИЛ: ${missing.join(', ')}`);

  DX = by.dx_index; IV = by.iv_index; GROUPS = by.groups_lite; META = by.meta;
  RANK = by.hierarchy.adrg_rank; MODAL = by.hierarchy.dx_modal; TREES = by.combo_rules.trees;
  renderMeta();
  wire();
}

// --- пошук коду: наші коди на знак довші за класифікацію-джерело,
// тому йдемо каскадом від найточнішого до кореня (G93.80 -> G93.8 -> G93)
function variants(code) {
  const c = code.trim().toUpperCase();
  const out = [c];
  const dot = c.indexOf('.');
  if (dot > 0) {
    const head = c.slice(0, dot), tail = c.slice(dot + 1);
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

const dxEntries = code => {
  for (const v of variants(code)) if (DX[v]) return DX[v];
  const kids = prefixIndex().get(code.trim().toUpperCase());
  if (!kids) return [];
  const out = [], seen = new Set();
  for (const k of kids) for (const [mdc, adrg] of DX[k]) {
    const key = `${mdc}|${adrg.join(',')}`;
    if (!seen.has(key)) { seen.add(key); out.push([mdc, adrg]); }
  }
  return out;
};
const ivEntries = code => IV[code.trim()] || [];

function parseCodes(s) {
  return (s || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
}

function candidates(main, add, ivs) {
  const ent = dxEntries(main);
  if (!ent.length) return null;
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
  return { mdcs: [...mdcs], pd, sec, ivc, all };
}

// --- ознаки випадку (дзеркало features() з learn_combos.py)
function trauma_block(code) {
  const c = code.toUpperCase();
  if (!'ST'.includes(c[0])) return null;
  const num = parseInt(c.slice(1, 3), 10);
  if (isNaN(num)) return null;
  if (c[0] === 'T') return num <= 14 ? 'T' : null;
  for (const [hi, name] of [[9, 'head'], [19, 'neck'], [29, 'thorax'],
                            [39, 'abdomen'], [69, 'upper'], [99, 'lower']])
    if (num <= hi) return name;
  return null;
}

function features(main, add, ivs) {
  const f = new Set();
  const mdcs = new Set(dxEntries(main).map(e => e[0]));
  add.forEach(c => {
    f.add('dx:' + c.split('.')[0].toUpperCase());
    dxEntries(c).forEach(([m, lst]) => {
      if (mdcs.has(m)) lst.forEach(a => f.add('dxa:' + a));
    });
  });
  ivs.forEach(c => ivEntries(c).forEach(([m, lst]) => {
    if (mdcs.has(m)) lst.forEach(a => f.add('iva:' + a));
  }));
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

// --- власне групування
function group(main, add, ivs) {
  const c = candidates(main, add, ivs);
  if (!c) return { error: `Діагноз ${main} не знайдено серед правил групування.` };
  const res = { cand: c, why: [], mdcs: c.mdcs };

  const modal = MODAL[main.trim().toUpperCase()];
  if (modal && c.all.has(modal)) {
    res.group = modal;
    res.why.push({ rule: 'модальна група', text:
      `Для діагнозу ${main} серед фактично згрупованих випадків найчастіше зустрічалась група ${modal}.` });
  } else if (c.all.size) {
    let best = null;
    c.all.forEach(a => {
      const r = RANK[a] ?? -1;
      if (!best || r > best[1]) best = [a, r];
    });
    res.group = best[0];
    res.why.push({ rule: 'попарна ієрархія', text:
      `Діагноз ${main} у навчальних даних не траплявся (або його звична група тут неможлива). ` +
      `Обрано кандидата з найвищим рангом у попарній ієрархії.` });
  }

  const tree = TREES[main.trim().toUpperCase()];
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

// --- показ
const esc = s => String(s).replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function groupCard(code) {
  const g = GROUPS[code];
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

function render(r, main) {
  const box = document.getElementById('grResult');
  box.hidden = false;
  if (r.error) { box.innerHTML = `<div class="gr-err">${esc(r.error)}</div>`; return; }

  const c = r.cand;
  const src = a => {
    const t = [];
    if (c.pd.has(a)) t.push('основний діагноз');
    if (c.sec.has(a)) t.push(`супутній ${esc(c.sec.get(a))}`);
    if (c.ivc.has(a)) t.push(`інтервенція ${esc(c.ivc.get(a))}`);
    return t.join(' · ');
  };
  const cands = [...c.all].sort().map(a => `
    <li class="${a === r.group ? 'gr-cand gr-cand-win' : 'gr-cand'}">
      <span class="gr-cc">${esc(a)}</span>
      <span class="gr-cn">${esc((GROUPS[a] || {}).t || '—')}</span>
      <span class="gr-cs">${src(a)}</span>
      ${a === r.group ? '<span class="gr-win">обрано</span>' : ''}
    </li>`).join('');

  box.innerHTML = `
    <div class="gr-head">
      <div class="gr-odk">ОДК ${c.mdcs.map(esc).join(', ')}</div>
      ${r.group ? groupCard(r.group) : '<div class="gr-err">Кандидатів не знайдено.</div>'}
    </div>
    <h3>Чому саме ця група</h3>
    <ul class="gr-why">${r.why.map(w =>
      `<li><b>${esc(w.rule)}.</b> ${esc(w.text)}</li>`).join('')}</ul>
    <h3>Усі кандидати <span class="gr-mut">(${c.all.size})</span></h3>
    <ul class="gr-cands">${cands}</ul>
    <p class="gr-foot">Ваговий коефіцієнт множиться на ставку за пролікований випадок
      і на коефіцієнти застосування — повний розрахунок у
      <a href="../drg/index.html">розділі «Інструменти ДСГ»</a>.</p>`;
}

function renderMeta() {
  const m = META, t = m.tested_on, tr = m.trained_on;
  document.getElementById('grStats').innerHTML = `
    <div class="stat"><b>${m.counts.dx_codes.toLocaleString('uk')}</b><span>діагнозів у правилах</span></div>
    <div class="stat"><b>${m.counts.iv_codes.toLocaleString('uk')}</b><span>інтервенцій</span></div>
    <div class="stat"><b>${t.accuracy_full}%</b><span>точність на перевірці</span></div>`;
  document.getElementById('grMeta').innerHTML = `
    <p><b>Правила</b> — ${esc(m.rules_source)}. Класифікації: ${esc(m.classifications)}.
       ${m.counts.dx_codes.toLocaleString('uk')} діагнозів і
       ${m.counts.iv_codes.toLocaleString('uk')} інтервенцій, ${m.counts.adrg} груп.</p>
    <p><b>Ієрархія вибору</b> здобута зі статистики: ${tr.cases.toLocaleString('uk')} фактично
       згрупованих випадків пакета ${tr.package} за ${tr.years.join('–')} роки,
       плюс ${m.combo_trees} комбінаційних дерев.</p>
    <p><b>Перевірка</b> — ${t.cases.toLocaleString('uk')} випадків за ${t.years.join(', ')} рік,
       якого навчання не бачило: базова стратегія ${t.accuracy_base}%,
       з комбінаційними правилами <b>${t.accuracy_full}%</b>.</p>`;
  document.getElementById('grLimits').innerHTML =
    m.limits.map(x => `<li>${esc(x)}</li>`).join('');
}

function run() {
  const main = document.getElementById('grMain').value.trim();
  if (!main) { document.getElementById('grMain').focus(); return; }
  render(group(main, parseCodes(document.getElementById('grAdd').value),
               parseCodes(document.getElementById('grIv').value)), main);
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

boot().catch(e => {
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
  } else if (m.startsWith('Supabase 404')) {
    text = 'Таблиці grouper_rules немає. Застосуйте міграцію ' +
           'migration_2026-08-19_grouper_rules.sql і залийте правила завантажувачем.';
  } else {
    text = `Не вдалося завантажити правила: ${esc(m)}`;
  }
  box.innerHTML = `<div class="gr-err">${text}</div>`;
});
