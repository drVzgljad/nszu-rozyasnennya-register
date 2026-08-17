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

  const V = 'v=5';

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

  // ── тариф за пунктом 38 ─────────────────────────────────────────────────
  function tariff(group, ready) {
    const w = group.k && group.k[0];
    if (!w) return null;
    const share = (CORE.factors.find((f) => f.id === 'share') || { value: 0.55 }).value;
    const bal = (CORE.factors.find((f) => f.id === 'balance') || { value: 1 }).value;
    const base = CORE.rate.case;
    const sum = base * w * share * bal * ready;
    return { base, w, share, bal, ready, sum };
  }

  const formula = (t) => `${t.base} × ${String(t.w).replace('.', ',')} × ` +
    `${String(t.share).replace('.', ',')} × ${String(t.bal).replace('.', ',')}` +
    (t.ready !== 1 ? ` × ${String(t.ready).replace('.', ',')}` : '') +
    ` = ${money(t.sum)} грн`;

  // ═══════════════════ 1. Групування випадку ═══════════════════════════════
  async function runGrouper() {
    const out = $('gOut');
    out.innerHTML = '<div class="kd-card kd-card-empty">Читаю довідники…</div>';
    await needCase();
    await needDual();
    startNames();
    redrawOnNames = () => { if ($('gDx').value) runGrouper().catch(() => {}); };

    const dxCode = norm($('gDx').value);
    const ivCodes = norm($('gIv').value).split(',').map((s) => s.trim()).filter(Boolean);
    const ready = parseFloat($('gReady').value) || 1;
    const age = $('gAge').value === '' ? null : Number($('gAge').value);
    const sex = $('gSex').value || null;

    if (!dxCode) {
      out.innerHTML = '<div class="kd-card kd-card-empty">Уведіть основний діагноз.</div>';
      return;
    }
    const rec = DX[dxCode];
    if (!rec) {
      const near = Object.keys(DX).filter((c) => c.startsWith(dxCode)).slice(0, 8);
      out.innerHTML = `<div class="kd-card"><p class="kd-flag kd-flag-no">Коду
        <b>${esc(dxCode)}</b> немає ні в Таблиці співставлення, ні в переліках
        основних діагностичних класів. Випадок із таким основним діагнозом у ДСГ
        не групується.</p>${near.length ? `<p class="kd-hint">Схожі коди:
        ${near.map((c) => `<span class="kd-chip" data-dx="${esc(c)}">${esc(c)}</span>`).join(' ')}</p>` : ''}</div>`;
      return;
    }

    const [ourOdk, arMdc, arG, ourGraw, kind] = rec;
    const ourG = ourGraw === 0 ? arG : ourGraw;
    const mdcSet = mdcIdxOf(ourOdk);
    const parts = [];
    let sn = 0;

    // крок 1 — діагноз
    parts.push(step(++sn, 'Основний стан', `
      <div class="kd-code">${esc(dxCode)}</div>
      <div>${esc(nameDx(dxCode))}</div>
      ${namesHint()}
      ${dualFlag(dxCode)}`));

    // крок 2 — основний діагностичний клас
    const odkHtml = ourOdk.length
      ? ourOdk.map((i) => `<span class="kd-chip kd-chip-hit">${esc(odkById(i).id)}
          <span class="kd-src">${esc(odkById(i).name)}</span></span>`).join(' ')
      : '<span class="kd-chip">не входить у жоден клас</span>';
    const arM = arMdc == null ? null : CORE.mdc[arMdc];
    const arNote = arM && !ourOdk.some((i) => odkById(i).mdc === arM)
      ? `<div class="kd-flag kd-flag-warn">За першоджерелом цей код належить до
         класу <b>${esc(arM)}</b> (${esc(mdcName(arM))}), а наша Таблиця відносить
         його інакше. Групування піде за нашою Таблицею — вона й є чинною
         підставою, — але розбіжність варто перевірити.</div>`
      : '';
    parts.push(step(++sn, 'Основний діагностичний клас', odkHtml + arNote));

    // крок 3 — втручання
    const reachable = new Map();          // код групи → {ref, why}
    if (!ivCodes.length) {
      for (const ref of ourG) reachable.set(gCode(ref), { ref, why: 'медична група діагнозу' });
      parts.push(step(++sn, 'Втручання', `<p class="muted">Втручань не вказано — випадок
        іде «медичною» гілкою: група береться з переліку самого діагнозу.</p>`));
    } else {
      const rows = [];
      for (const code of ivCodes) {
        const r = IV[code];
        if (!r) {
          rows.push(`<div><b>${esc(code)}</b> — коду немає ні в Таблиці
            співставлення, ні в додатку B першоджерела.</div>`);
          continue;
        }
        const [arRows, ourIvG, gi] = r;
        const arHit = [];
        for (const [m, gl] of arRows) if (mdcSet.has(m)) arHit.push(...gl);
        const ourHit = ourIvG.filter((ref) => {
          const g = gAt(ref);
          return g.mdc && g.mdc.some((m) => mdcSet.has(m));
        });
        for (const ref of ourHit) reachable.set(gCode(ref), { ref, why: `втручання ${code}` });
        for (const ref of arHit) {
          if (!reachable.has(gCode(ref)))
            reachable.set(gCode(ref), { ref, why: `втручання ${code} (лише за AR-DRG)`, arOnly: true });
        }
        const chips = (list) => list.length
          ? list.map((ref) => chip(ref, true)).join(' ')
          : '<span class="kd-chip kd-chip-off">жодної в цьому класі</span>';
        rows.push(`<div style="margin-bottom:10px">
          <div><b>${esc(code)}</b> ${esc(nameIv(code))}
            ${gi ? '<span class="kd-chip">загальне втручання</span>' : ''}</div>
          <div class="kd-step-t" style="margin-top:4px">у межах класу діагнозу</div>
          <div>${chips(ourHit)}</div>
          <div class="kd-step-t" style="margin-top:4px">усі групи цього втручання</div>
          <div>${ourIvG.map((ref) => chip(ref, ourHit.includes(ref))).join(' ')}</div>
        </div>`);
      }
      parts.push(step(++sn, 'Втручання епізоду', rows.join('')));

      // 801 — загальне втручання не з того класу
      if (!reachable.size) {
        const anyGi = ivCodes.some((c) => IV[c] && IV[c][2]);
        if (anyGi) {
          const g801 = CORE.groups.findIndex((g) => g.c === '801');
          if (g801 >= 0) reachable.set('801', { ref: g801, why: 'загальне втручання не з класу діагнозу' });
          parts.push(step(++sn, 'Група 801', `<p>Жодне з втручань не пов'язане з класом
            основного діагнозу, і принаймні одне з них є загальним. Такий випадок
            моделлю відноситься до групи <b>801</b> «Загальні втручання, не пов'язані
            з основним діагнозом».</p>`));
        } else {
          for (const ref of ourG) reachable.set(gCode(ref), { ref, why: 'медична група діагнозу' });
          parts.push(step(++sn, 'Гілка', `<p class="muted">Втручання не веде в групу в
            межах цього класу і не є загальним — лишається «медична» гілка діагнозу.</p>`));
        }
      }
    }

    // крок 5 — досяжні групи і тариф
    const list = [...reachable.values()]
      .map((x) => ({ ...x, g: gAt(x.ref), t: tariff(gAt(x.ref), ready) }))
      .sort((a, b) => (b.t ? b.t.sum : -1) - (a.t ? a.t.sum : -1));
    if (list.length) {
      const rows = list.map((x, i) => `<tr class="${i === 0 && x.t ? 'win' : ''}">
        <td><b>${esc(x.g.c)}</b>${isCond(x.ref) ? ' <span class="kd-src">умовно</span>' : ''}</td>
        <td>${esc(x.g.t || '—')}</td>
        <td>${esc(CORE.appendixLabel[x.g.a] || (x.g.a === 'ar-only' ? 'немає в постанові' : x.g.a))}</td>
        <td>${x.g.p.length ? esc(x.g.p.join(', ')) : '—'}</td>
        <td class="num">${x.t ? String(x.t.w).replace('.', ',') : '—'}</td>
        <td class="num">${x.t ? money(x.t.sum) : '—'}</td>
        <td class="kd-src">${esc(x.why)}</td></tr>`).join('');
      const top = list.find((x) => x.t);
      const diff = list.filter((x) => x.t).length > 1
        ? list.filter((x) => x.t)[0].t.sum - list.filter((x) => x.t).slice(-1)[0].t.sum : 0;
      parts.push(step(++sn, 'Досяжні групи і тариф', `
        <div class="kd-scroll"><table class="kd-tbl">
          <thead><tr><th>Група</th><th>Назва</th><th>Джерело ваги</th><th>Пакети</th>
            <th>Вага</th><th>Сума, грн</th><th>Звідки</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        ${top ? `<div class="kd-formula">${esc(formula(top.t))}</div>` : ''}
        ${diff > 0 ? `<div class="kd-flag kd-flag-warn">Різниця між найдорожчою і
          найдешевшою досяжною групою — <b>${money(diff)} грн</b> на випадок. Саме
          вона й стає предметом спорів про «примусову заміну діагнозу».</div>` : ''}
        <p class="kd-hint">Рівні складності всередині групи (суфікси A, B, C) тут не
          рахуються: значень, за якими модель ділить групу на рівні, у відкритих
          джерелах немає. Остаточну групу визначає групер ЕСОЗ.</p>`));
    } else {
      parts.push(step(++sn, 'Досяжні групи', `<p class="kd-flag kd-flag-no">Жодної групи
        не знайдено. Найчастіша причина — втручання не пов'язане з класом основного
        діагнозу.</p>`));
    }

    // прапорці перевірки
    const flags = await caseFlags([dxCode], ivCodes, age, null, sex);
    parts.push(flags.length
      ? step(++sn, 'Перевірка коректності', flags.join(''))
      : step(++sn, 'Перевірка коректності',
             '<div class="kd-flag kd-flag-ok">Конфліктів віку, статі та виключень не знайдено.</div>'));

    out.innerHTML = `<div class="kd-card">${parts.join('')}</div>`;
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

    for (const c of dxCodes) {
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
      if (uncond.has(c)) {
        out.push(`<div class="kd-flag kd-flag-warn"><b>${esc(c)}</b> — код беззастережно
          виключений з моделі клінічної складності: супутнім станом він тяжкість
          випадку не підвищує.</div>`);
      }
    }
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

  async function runCheck() {
    const out = $('cOut');
    out.innerHTML = '<div class="kd-card kd-card-empty">Читаю правила…</div>';
    await needCase(); await needVal(); await needDual();
    startNames();
    const codes = norm($('cQ').value).split(',').map((s) => s.trim()).filter(Boolean);
    const age = $('cAge').value === '' ? null : Number($('cAge').value);
    const days = $('cDays').value === '' ? null : Number($('cDays').value);
    const sex = $('cSex').value || null;
    if (!codes.length) { out.innerHTML = '<div class="kd-card kd-card-empty">Уведіть коди випадку.</div>'; return; }

    // тип коду визначаємо за формою (втручання ACHI — 5 цифр, дефіс, 2 цифри),
    // бо довідник назв може ще не приїхати
    const isIv = (c) => /^\d{5}-\d{2}$/.test(c) || !!IV[c];
    const dxCodes = codes.filter((c) => !isIv(c));
    const ivCodes = codes.filter(isIv);
    const unknown = codes.filter((c) => !DX[c] && !IV[c]);
    const flags = await caseFlags(dxCodes, ivCodes, age, days, sex);

    out.innerHTML = `<div class="kd-card">
      <p class="kd-hint">Розібрано: діагнози ${dxCodes.map((c) => `<b>${esc(c)}</b>`).join(', ') || '—'};
        втручання ${ivCodes.map((c) => `<b>${esc(c)}</b>`).join(', ') || '—'}
        ${unknown.length ? `; немає в Таблиці співставлення: ${unknown.map(esc).join(', ')}` : ''}</p>
      ${flags.length ? flags.join('')
        : '<div class="kd-flag kd-flag-ok">За таблицями конфліктів віку, статі та виключень зауважень немає.</div>'}
      ${dxCodes.map((c) => dualFlag(c)).join('')}
    </div>`;
  }

  async function runRuleLookup() {
    const box = $('rOut');
    const code = norm($('rQ').value);
    if (!code) { box.innerHTML = ''; return; }
    await needVal();
    const hits = [];
    const cat = lookupRule(new Map(VAL.ageDx), code);
    if (cat) {
      const [ua, range] = (VAL.ageUa && VAL.ageUa[cat.v]) || [cat.v, ''];
      hits.push(`<li>вікова категорія <b>${esc(ua)}</b>${range ? ` — ${esc(range)}` : ''}${viaNote(cat)}</li>`);
    }
    const sd = lookupRule(new Map(VAL.sexDx), code);
    if (sd) hits.push(`<li>лише для статі <b>${sexUa(sd.v)}</b> (діагноз)${viaNote(sd)}</li>`);
    const si = lookupRule(new Map(VAL.sexIv), code);
    if (si) hits.push(`<li>лише для статі <b>${sexUa(si.v)}</b> (втручання)${viaNote(si)}</li>`);
    if (VAL.obstIv.includes(code)) hits.push('<li>акушерське втручання</li>');
    if (VAL.exclUncond.includes(code)) hits.push('<li>беззастережно виключений з моделі клінічної складності</li>');
    const cond = VAL.exclCond.filter(([a, m]) => a === code || m === code);
    for (const [a, m] of cond.slice(0, 12)) {
      hits.push(a === code
        ? `<li>не отримує рівня складності, якщо у випадку є <b>${esc(m)}</b></li>`
        : `<li>своєю присутністю знімає рівень складності з <b>${esc(a)}</b></li>`);
    }
    box.innerHTML = hits.length
      ? `<div class="kd-card"><b>${esc(code)}</b><ul>${hits.join('')}</ul></div>`
      : `<div class="kd-card kd-card-empty">Для ${esc(code)} обмежень у таблицях немає.</div>`;
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

  function switchTab(mod) {
    for (const b of document.querySelectorAll('.kd-tab')) {
      const on = b.dataset.mod === mod;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const s of document.querySelectorAll('.kd-mod'))
      s.hidden = s.id !== `mod-${mod}`;
    if (mod === 'audit' && !AUD) runAudit();
    location.hash = mod;
  }

  function init() {
    stats().catch(() => {});

    document.querySelector('.kd-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.kd-tab');
      if (b) switchTab(b.dataset.mod);
    });

    $('gRun').addEventListener('click', () => runGrouper().catch(err =>
      $('gOut').innerHTML = `<div class="kd-card"><p class="kd-flag kd-flag-no">${esc(err.message)}</p></div>`));
    for (const el of ['gDx', 'gIv'])
      $(el).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('gRun').click(); });
    document.addEventListener('click', (e) => {
      const d = e.target.closest('[data-case]');
      if (d) {
        const [dx, iv] = d.dataset.case.split('|');
        $('gDx').value = dx; $('gIv').value = iv || '';
        $('gRun').click();
        return;
      }
      const c = e.target.closest('[data-dx]');
      if (c) { $('gDx').value = c.dataset.dx; $('gRun').click(); }
      const ch = e.target.closest('[data-check]');
      if (ch) {
        const [codes, age, sex] = ch.dataset.check.split('|');
        $('cQ').value = codes; $('cAge').value = age || ''; $('cSex').value = sex || '';
        $('cRun').click();
      }
    });

    $('cRun').addEventListener('click', () => runCheck().catch(err =>
      $('cOut').innerHTML = `<div class="kd-card"><p class="kd-flag kd-flag-no">${esc(err.message)}</p></div>`));
    $('cQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('cRun').click(); });
    let rt;
    $('rQ').addEventListener('input', () => { clearTimeout(rt); rt = setTimeout(runRuleLookup, 220); });

    document.querySelector('.kd-subtabs').addEventListener('click', (e) => {
      const b = e.target.closest('.kd-subtab');
      if (!b) return;
      slice = b.dataset.slice;
      for (const x of document.querySelectorAll('.kd-subtab')) x.classList.toggle('active', x === b);
      runAudit();
    });
    let at;
    $('aQ').addEventListener('input', () => { clearTimeout(at); at = setTimeout(runAudit, 250); });
    $('aCsv').addEventListener('click', auditCsv);

    const h = (location.hash || '').replace('#', '');
    if (['grouper', 'check', 'rules', 'audit'].includes(h)) switchTab(h);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
