/* ПІЛОТ: подвійне кодування («хрестик — зірочка») + сумісність ДСГ × діагноз.
 * Автономна сторінка. Читає наявні дані, нічого не пише і не змінює:
 *   data/nk025_index.json          — коди й назви НК 025 (як у classifiers.js)
 *   data/pilot_koduvannia.json     — пари † / * (окремий пілотний конвеєр)
 *   ../mapping/data/odk.json       — склад ОДК за кодами
 *   ../mapping/data/services_lite.json — послуги: ДСГ, ОДК, ваги
 */
(() => {
  'use strict';

  // Кириличні гомогліфи -> латиниця (та сама пастка, що в ДСГ 1503 та ЕСОЗ)
  const HOMO = { 'А':'A','В':'B','С':'C','Е':'E','Н':'H','І':'I','К':'K',
                 'М':'M','О':'O','Р':'P','Т':'T','Х':'X' };
  const norm = (s) => (s || '').trim().toUpperCase()
    .replace(/[АВСЕНІКМОРТХ]/g, (ch) => HOMO[ch] || ch)
    .replace(/\s+/g, '');

  const esc = (s) => String(s).replace(/[&<>"]/g,
    (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  let IDX = new Map();      // код -> запис НК 025
  let KIDS = new Map();     // рубрика -> [підкоди]
  let DUAL = {};            // byCode пілотного шару
  let META = null;
  let ODK = [];             // [{id, name, set}]
  let GROUPS = new Map();   // код ДСГ -> {name, odk:[ids], w, pkgs, main}
  let ACHI = new Map();     // код НК 026 -> {c, n, pk, sv}
  let SVC_BY_I = new Map(); // індекс послуги -> запис services_lite

  /* Предки за префіксом: M90.60 -> M90.6 -> M90 (не залежить від поля p). */
  function ancestors(code) {
    const out = [];
    let c = code;
    while (c.includes('.')) {
      const [rub, tail] = [c.slice(0, c.indexOf('.')), c.slice(c.indexOf('.') + 1)];
      c = tail.length > 1 ? `${rub}.${tail.slice(0, -1)}` : rub;
      out.push(c);
    }
    return out;
  }

  /* Ролі подвійного кодування: свої + успадковані від рубрики. */
  function dualOf(code) {
    const merged = { manif: [], mainFor: [], mainOf: [], manifOf: [] };
    for (const c of [code, ...ancestors(code)]) {
      const d = DUAL[c];
      if (!d) continue;
      const from = c === code ? '' : c;
      for (const r of d.manif || []) merged.manif.push({ ...r, from });
      for (const x of d.mainFor || []) merged.mainFor.push({ code: x, from });
      for (const r of d.mainOf || []) merged.mainOf.push({ ...r, from });
      for (const x of d.manifOf || []) merged.manifOf.push({ code: x, from });
    }
    return merged;
  }

  /* ОДК коду: точне членство; для рубрики — об'єднання за підкодами. */
  function odkOf(code) {
    const direct = ODK.filter((o) => o.set.has(code)).map((o) => o.id);
    if (direct.length) return { ids: direct, via: 'exact' };
    const kids = KIDS.get(code) || [];
    const agg = new Set();
    for (const k of kids)
      for (const o of ODK) if (o.set.has(k)) agg.add(o.id);
    return { ids: [...agg], via: agg.size ? 'children' : 'none' };
  }

  const odkName = (id) => (ODK.find((o) => o.id === id) || { name: '?' }).name;

  function groupsForOdk(ids) {
    const out = [];
    for (const [c, g] of GROUPS) {
      if (!g.main) continue;                     // варіанти I10-01 не дублюємо
      if (g.odk.some((id) => ids.includes(id))) out.push({ c, ...g });
    }
    return out.sort((a, b) => a.c.localeCompare(b.c, 'uk'));
  }

  // ── Паспорт діагнозу ──────────────────────────────────────────────────────
  function renderDx(raw) {
    const box = document.getElementById('dxOut');
    const code = norm(raw);
    if (!code) { box.innerHTML = ''; return; }
    const e = IDX.get(code);
    if (!e) {
      const near = [...IDX.keys()].filter((c) => c.startsWith(code)).slice(0, 6);
      box.innerHTML = `<p class="err">Коду ${esc(code)} немає в НК 025.</p>` +
        (near.length ? `<p class="mut small">Схожі: ${near.map((c) =>
          `<span class="chip" data-dx="${c}">${c}</span>`).join(' ')}</p>` : '');
      return;
    }
    const d = dualOf(code);
    const o = odkOf(code);
    let html = `<p style="margin:14px 0 4px"><span class="codebig">${esc(e.c)}</span></p>
      <p style="margin:0 0 8px">${esc(e.n)}</p>`;

    // Ролі † / *
    if (d.manif.length) {
      const refs = d.manif.map((r) =>
        `${esc(r.raw)}${r.from ? ` <span class="mut small">(з рубрики ${r.from})</span>` : ''}` +
        (r.notes ? ` <span class="mut small">[${esc(r.notes.join('; '))}]</span>` : ''))
        .join('; ');
      html += `<div><span class="badge b-red">Код прояву — основним діагнозом не зазначається</span></div>
        <p class="small" style="margin:6px 0 0">Основний діагноз обирати з: ${refs}.
        Сам код ${esc(code)} може стояти лише додатковим.</p>`;
    }
    if (d.manifOf.length) {
      html += `<div style="margin-top:6px"><span class="badge b-red">Позначений зіркою як прояв</span>
        <span class="small">до: ${d.manifOf.map((x) =>
          `<span class="chip" data-dx="${x.code}">${x.code}</span>`).join(' ')}</span></div>`;
    }
    if (d.mainFor.length) {
      html += `<div style="margin-top:6px"><span class="badge b-grn">Може бути основним діагнозом</span>
        <span class="small">коди прояву до нього: ${d.mainFor.slice(0, 12).map((x) =>
          `<span class="chip" data-dx="${x.code}">${x.code}</span>`).join(' ')}${
          d.mainFor.length > 12 ? ` <span class="mut">і ще ${d.mainFor.length - 12}</span>` : ''}</span></div>`;
    }
    if (d.mainOf.length) {
      const refs = d.mainOf.map((r) => esc(r.raw)).join('; ');
      html += `<div style="margin-top:6px"><span class="badge b-grn">Основний (хрестиковий бік)</span>
        <span class="small">його прояви: ${refs}</span></div>`;
    }
    if (!d.manif.length && !d.mainFor.length && !d.mainOf.length && !d.manifOf.length) {
      html += `<div><span class="badge b-gray">Подвійне кодування цього коду не стосується</span></div>`;
    }

    // ОДК
    if (o.ids.length) {
      html += `<dl><dt>ОДК</dt><dd>${o.ids.map((id) =>
        `<span class="badge b-amb">${esc(id)}</span> ${esc(odkName(id))}`).join('<br>')}${
        o.via === 'children' ? ' <span class="mut small">(за підрубриками)</span>' : ''}</dd>`;
      const gr = groupsForOdk(o.ids);
      html += `<dt>Досяжні ДСГ пакета 3/47 через ці ОДК
        <span class="mut small">(${gr.length})</span></dt><dd>${
        gr.map((g) => `<span class="chip" data-gr="${g.c}" title="${esc(g.name)}">${g.c}
          <span class="w">${esc(g.w || '')}</span></span>`).join(' ') || '—'}</dd></dl>`;
    } else {
      html += `<dl><dt>ОДК</dt><dd class="mut">У переліках ОДК Таблиці співставлення цього коду немає.</dd></dl>`;
    }
    box.innerHTML = html;
  }

  // ── Пара ДСГ × діагноз ───────────────────────────────────────────────────
  function renderPair(grRaw, dxRaw) {
    const box = document.getElementById('pairOut');
    const gcode = norm(grRaw).split('—')[0];
    const dcode = norm(dxRaw);
    if (!gcode || !dcode) { box.innerHTML = ''; return; }
    const g = GROUPS.get(gcode);
    if (!g) { box.innerHTML = `<p class="err">ДСГ ${esc(gcode)} немає серед хірургічних груп Таблиці співставлення.</p>`; return; }
    const e = IDX.get(dcode);
    if (!e) { box.innerHTML = `<p class="err">Коду ${esc(dcode)} немає в НК 025.</p>`; return; }

    const d = dualOf(dcode);
    const o = odkOf(dcode);
    const shared = g.odk.filter((id) => o.ids.includes(id));
    let html = '';

    if (d.manif.length) {
      const refs = d.manif.map((r) => esc(r.raw)).join('; ');
      html += `<div class="verdict v-warn"><b>${esc(dcode)} — код прояву.</b>
        Основним діагнозом він не зазначається (основний: ${refs}), тож будь-яка
        пара з ним як з основним некоректна за правилами МКХ-10 незалежно від ОДК.</div>`;
    }

    if (shared.length) {
      html += `<div class="verdict v-ok"><b>${esc(gcode)} × ${esc(dcode)} — сумісні.</b>
        Спільний клас: ${shared.map((id) => `${esc(id)} «${esc(odkName(id))}»`).join(', ')}.
        Ваговий коефіцієнт групи ${esc(gcode)}: <b>${esc(g.w || '—')}</b>${
        g.pkgs ? ` (пакети ${esc(g.pkgs.join(', '))})` : ''}. У Довіднику МІС ця пара знайдеться.</div>`;
    } else {
      html += `<div class="verdict v-no"><b>${esc(gcode)} × ${esc(dcode)} — несумісні.</b>
        Група ${esc(gcode)} досяжна лише з ${g.odk.map((id) =>
          `${esc(id)} «${esc(odkName(id))}»`).join(', ')}, а код ${esc(dcode)} належить до ${
        o.ids.length ? o.ids.map((id) => `${esc(id)} «${esc(odkName(id))}»`).join(', ') : '(не знайдено в ОДК)'}.
        Саме така пара у фільтрі Довідника МІС дає «Нічого не знайдено за вашими
        параметрами пошуку» — тариф існує, але в групі з іншої ОДК.</div>`;
      const gr = groupsForOdk(o.ids);
      if (gr.length) {
        html += `<p class="small" style="margin:8px 0 0">ДСГ, досяжні з ${esc(dcode)}: ${
          gr.slice(0, 14).map((x) => `<span class="chip" data-gr="${x.c}" title="${esc(x.name)}">${x.c}
            <span class="w">${esc(x.w || '')}</span></span>`).join(' ')}${
          gr.length > 14 ? ` <span class="mut">і ще ${gr.length - 14}</span>` : ''}</p>`;
      }
    }
    box.innerHTML = html;
  }

  // ── Розрахунок випадку ───────────────────────────────────────────────────
  /* Ланцюг за Порядком-2026:
   *   базова ставка 8735 грн (п.34, пакети 3/4/47)
   *   x ваговий коефіцієнт ДСГ (додаток 1, кол. 3)
   *   x частка застосування 0,55 (п.38 пп.1)
   *   x коефіцієнт збалансованості бюджету 1 (п.38 пп.2, станом на 01.01.2026)
   *   x коефіцієнт готовності 1,2 дорослим / 1,3 дітям (п.38 пп.4) — за вибором
   * Додаткові коефіцієнти за дітей (пп.6) і за травми (пп.7) за текстом Порядку
   * ДОДАЮТЬСЯ до вагового, а не множаться.
   * Звірено 17.08.2026: 8735 x 5,299 x 0,55 x 1,2 = 30 549,2649 — точний збіг
   * із «Ціна, грн» Довідника ДСГ у МІС (лист вх. 15577-13-26). */
  const BASE = 8735, SHARE = 0.55, BALANCE = 1;

  const num = (s) => {
    const v = parseFloat(String(s || '').replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(v) ? v : null;
  };
  const money = (v) => v.toLocaleString('uk-UA',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dec = (v) => String(v).replace('.', ',');

  function renderCase(ivRaw, dxRaw) {
    const box = document.getElementById('caseOut');
    const icode = norm(ivRaw).replace(/[^\dA-Z-]/g, '');
    const dcode = norm(dxRaw);
    if (!icode && !dcode) { box.innerHTML = ''; return; }
    const iv = ACHI.get(icode);
    if (!iv) { box.innerHTML = `<p class="err">Інтервенції ${esc(icode)} немає в НК 026.</p>`; return; }
    const e = dcode ? IDX.get(dcode) : null;
    if (dcode && !e) { box.innerHTML = `<p class="err">Коду ${esc(dcode)} немає в НК 025.</p>`; return; }

    const ready = parseFloat(document.getElementById('readySel').value) || 1;
    const useKids = document.getElementById('addKids').checked;
    const useTrauma = document.getElementById('addTrauma').checked;
    const d = e ? dualOf(dcode) : null;
    const o = e ? odkOf(dcode) : { ids: [] };

    let html = `<p style="margin:14px 0 2px"><span class="codebig">${esc(iv.c)}</span>
      &nbsp;${esc(iv.n)}</p>
      <p class="small mut" style="margin:0 0 4px">Пакети: ${esc((iv.pk || []).join(', ') || '—')}</p>`;
    if (e) {
      html += `<p style="margin:6px 0 0"><b>${esc(e.c)}</b> ${esc(e.n)}</p>`;
      if (d.manif.length) {
        html += `<div style="margin-top:5px"><span class="badge b-red">Основним діагнозом не зазначається</span>
          <span class="small">основний обирати з: ${d.manif.map((r) => esc(r.raw)).join('; ')}</span></div>`;
      }
      if (o.ids.length) {
        html += `<p class="small" style="margin:5px 0 0">${o.ids.map((id) =>
          `<span class="badge b-amb">${esc(id)}</span> ${esc(odkName(id))}`).join(' ')}</p>`;
      }
    }

    // Досяжні ДСГ інтервенції
    const rows = (iv.sv || []).map((i) => SVC_BY_I.get(i)).filter(Boolean)
      .filter((s) => s.c)
      .map((s) => {
        const k = (s.k && s.k[0] && s.k[0].k) || [];
        const w = num(k[0]);
        const addK = num(k[1]), addT = num(k[2]);
        let eff = w;
        const parts = [];
        if (w !== null) parts.push(dec(w));
        if (useKids && addK !== null) { eff += addK; parts.push(`+ ${dec(addK)}`); }
        if (useTrauma && addT !== null) { eff += addT; parts.push(`+ ${dec(addT)}`); }
        const fit = e ? s.odk.some((id) => o.ids.includes(id)) : null;
        return { s, w, addK, addT, eff, parts, fit,
                 sum: eff === null ? null : BASE * eff * SHARE * BALANCE * ready };
      });
    if (!rows.length) {
      box.innerHTML = html + `<p class="mut">Ця інтервенція не веде до жодної ДСГ пакетів 3/47.</p>`;
      return;
    }
    rows.sort((a, b) => (b.sum || 0) - (a.sum || 0));

    html += `<table class="calc"><tr><th>ДСГ</th><th>Назва</th><th>ОДК</th>
      <th>Вага</th><th>Тариф, грн</th>${e ? '<th>Діагноз</th>' : ''}</tr>` +
      rows.map((r) => `<tr class="${r.fit === true ? 'yes' : r.fit === false ? 'no' : ''}">
        <td><b>${esc(r.s.c)}</b></td><td>${esc(r.s.n)}</td>
        <td class="small">${esc(r.s.odk.join(', ') || '—')}</td>
        <td class="num">${esc(r.parts.join(' ') || '—')}</td>
        <td class="num">${r.sum === null ? '—' : esc(money(r.sum))}</td>
        ${e ? `<td class="small">${r.fit ? 'сумісний' : 'несумісний'}</td>` : ''}
      </tr>`).join('') + `</table>`;

    if (e) {
      const ok = rows.filter((r) => r.fit && r.sum !== null);
      if (!ok.length) {
        html += `<div class="verdict v-no">Жодна з груп цієї інтервенції не сумісна з
          ${esc(dcode)} за ОДК — перевірте основний діагноз.</div>`;
      } else if (d.manif.length) {
        /* Головне порівняння: код прояву як основний (так закодував заклад)
         * проти коректного основного з хрестикового боку. Саме ця різниця і є
         * «ціною питання» у спорах про автоматичний моніторинг. */
        const alt = new Map();
        for (const ref of d.manif)
          for (const t of ref.codes) {
            const ao = odkOf(t);
            const hit = rows.filter((r) => r.sum !== null &&
              r.s.odk.some((id) => ao.ids.includes(id)));
            if (hit.length) alt.set(t, hit.sort((x, y) => y.sum - x.sum)[0]);
          }
        const best = ok[0];
        if (alt.size) {
          // M50 і M51 ведуть до тієї самої групи — зводимо в один рядок
          const merged = new Map();
          for (const [code, r] of alt) {
            const key = `${r.s.c}|${r.sum}`;
            if (!merged.has(key)) merged.set(key, { codes: [], r });
            merged.get(key).codes.push(code);
          }
          const lines = [...merged.values()].map(({ codes, r }) => {
            const diff = best.sum - r.sum;
            return `<li><b>${esc(codes.join(', '))}</b> → ${esc(r.s.c)} «${esc(r.s.n)}»:
              <b>${esc(money(r.sum))} грн</b>
              <span class="mut">(різниця ${diff >= 0 ? '−' : '+'}${esc(money(Math.abs(diff)))} грн)</span></li>`;
          }).join('');
          html += `<div class="verdict v-warn">
            <b>${esc(dcode)} як основний діагноз дає ${esc(best.s.c)} — ${esc(money(best.sum))} грн</b>,
            але за правилами МКХ-10 основним він бути не може. З коректним основним:
            <ul style="margin:6px 0 0">${lines}</ul></div>`;
        } else {
          html += `<div class="verdict v-warn">
            ${esc(dcode)} веде до ${esc(best.s.c)} — ${esc(money(best.sum))} грн, проте
            основним діагнозом не зазначається. Коректний основний
            (${d.manif.map((r) => esc(r.raw)).join('; ')}) до груп цієї інтервенції не веде.</div>`;
        }
      } else {
        html += `<div class="verdict v-ok">З основним діагнозом <b>${esc(dcode)}</b>
          досяжні: ${ok.map((r) => `<b>${esc(r.s.c)}</b> — ${esc(money(r.sum))} грн`).join(', ')}.</div>`;
      }
    }

    const sample = rows.find((r) => r.fit && r.sum !== null) ||
                   rows.find((r) => r.sum !== null);
    if (sample) {
      // при додаткових коефіцієнтах суму ваг обов'язково в дужки,
      // інакше «8735 × 3,114 + 1,5413 × 0,55» читається двозначно
      const wTxt = sample.parts.length > 1
        ? `(${sample.parts.join(' ')})` : sample.parts.join(' ');
      html += `<div class="formula">${esc(dec(BASE))} (ставка, п.34)
        × ${esc(wTxt)} (вага ДСГ ${esc(sample.s.c)}, дод. 1)
        × ${esc(dec(SHARE))} (частка, п.38 пп.1)
        × ${esc(dec(BALANCE))} (збалансованість, пп.2)${ready !== 1
          ? ` × ${esc(dec(ready))} (готовність, пп.4)` : ''}
        = ${esc(money(sample.sum))} грн</div>
        <p class="small mut" style="margin:7px 0 0">Розрахунок базовий: інші коефіцієнти
        п.38 залежать від обставин випадку (гірський, інтенсивна терапія, тривалість
        поза референтними значеннями, амбулаторно-асоційовані стани) і тут не враховані.
        Додаткові коефіцієнти за дітей і травми за текстом Порядку додаються до вагового.</p>`;
    }
    box.innerHTML = html;
  }

  // ── Статистика ───────────────────────────────────────────────────────────
  function renderStats() {
    const m = META;
    const fixes = m.fixes.map((f) =>
      `<tr><td>${esc(f.code)}</td><td>${esc(f.raw)}</td><td>${esc(f.norm)}</td></tr>`).join('');
    document.getElementById('statsOut').innerHTML = `
      Розібрано дужкових посилань: <b>${m.groups_dagger}</b> із †
      (усі ${m.names_with_dagger} назв) та <b>${m.groups_aster}</b> із *.
      Кодів із ролями: <b>${m.codes_flagged}</b>. Нерозв'язаних посилань:
      <b>${m.unresolved.length}</b>. Збірка: ${esc(m.built)}, джерело — ${esc(m.source)}.
      <details><summary>Виправлення OCR/гомогліфів (${m.fixes.length}) і відкати (${m.fallbacks})</summary>
        <table><tr><th>Код</th><th>У класифікаторі</th><th>Прочитано як</th></tr>${fixes}</table>
        <p>Відкат: у P75 посилання на E84.1, якої в НК 025 немає, — взято рубрику E84.</p>
      </details>`;
  }

  // ── Завантаження і події ─────────────────────────────────────────────────
  /* Локальний python-сервер під конкуренцією скидає з'єднання на великому
   * файлі (ERR_CONNECTION_RESET), а голі URL можуть віддаватися з битого
   * дискового кешу (ERR_ABORTED) — виміряно 17.08.2026. Тому: ?v= проти
   * кешу, до 3 спроб, і великий індекс вантажиться окремо від дрібних. */
  async function fetchJson(url, tries = 3) {
    for (let i = 1; ; i++) {
      try {
        const r = await fetch(`${url}?v=pilot1&t=${i}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        if (i >= tries) throw new Error(`${url}: ${e.message}`);
        await new Promise((res) => setTimeout(res, 150 * i));
      }
    }
  }

  async function boot() {
    const idx = await fetchJson('data/nk025_index.json');
    const nk026 = await fetchJson('data/nk026_index.json');
    const [dual, odk, sl] = await Promise.all([
      fetchJson('data/pilot_koduvannia.json'),
      fetchJson('../mapping/data/odk.json'),
      fetchJson('../mapping/data/services_lite.json'),
    ]);
    for (const a of nk026) ACHI.set(a.c, a);
    for (const e of idx) {
      IDX.set(e.c, e);
      if (e.c.includes('.')) {
        const rub = e.c.slice(0, e.c.indexOf('.'));
        if (!KIDS.has(rub)) KIDS.set(rub, []);
        KIDS.get(rub).push(e.c);
      }
    }
    DUAL = dual.byCode; META = dual.meta;
    ODK = odk.map((o) => ({ id: o.id, name: o.name, set: new Set(o.codes) }));
    for (const s of sl) {
      SVC_BY_I.set(s.i, s);
      if (!s.c) continue;
      const w = s.k && s.k[0] && s.k[0].k ? s.k[0].k[0] : '';
      GROUPS.set(s.c, { name: s.n, odk: s.odk || [], w, pkgs: s.p, main: true });
      for (const kk of s.k || []) {
        if (kk.c && kk.c !== s.c && !GROUPS.has(kk.c))
          GROUPS.set(kk.c, { name: kk.t, odk: s.odk || [],
                             w: kk.k ? kk.k[0] : '', pkgs: s.p, main: false });
      }
    }
    const dl = document.getElementById('grList');
    dl.innerHTML = [...GROUPS].filter(([, g]) => g.main)
      .sort((a, b) => a[0].localeCompare(b[0], 'uk'))
      .map(([c, g]) => `<option value="${c}">${c} — ${esc(g.name)}</option>`).join('');
    renderStats();

    const dx = document.getElementById('dxInput');
    const gr = document.getElementById('grInput');
    const pd = document.getElementById('pdInput');
    const iv = document.getElementById('ivInput');
    const cd = document.getElementById('cdInput');
    const recalc = () => renderCase(iv.value, cd.value);
    document.getElementById('dxBtn').onclick = () => renderDx(dx.value);
    document.getElementById('pairBtn').onclick = () => renderPair(gr.value, pd.value);
    document.getElementById('caseBtn').onclick = recalc;
    dx.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') renderDx(dx.value); });
    for (const el of [gr, pd])
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') renderPair(gr.value, pd.value); });
    for (const el of [iv, cd])
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') recalc(); });
    // перемикачі коефіцієнтів перераховують уже показаний випадок
    for (const id of ['readySel', 'addKids', 'addTrauma'])
      document.getElementById(id).addEventListener('change', () => {
        if (iv.value) recalc();
      });

    document.body.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-dx],[data-gr],[data-demo],[data-demo-pair]');
      if (!t) return;
      if (t.dataset.dx) { dx.value = t.dataset.dx; renderDx(t.dataset.dx); }
      if (t.dataset.gr) { gr.value = t.dataset.gr; if (pd.value) renderPair(t.dataset.gr, pd.value); }
      if (t.dataset.demo) { dx.value = t.dataset.demo; renderDx(t.dataset.demo); }
      if (t.dataset.demoPair) {
        const [g, d] = t.dataset.demoPair.split('|');
        gr.value = g; pd.value = d; renderPair(g, d);
      }
      if (t.dataset.demoCase) {
        const [a, d] = t.dataset.demoCase.split('|');
        iv.value = a; cd.value = d; renderCase(a, d);
      }
    });
  }

  /* Кнопки замкнені, поки не приїхали довідники: НК 025 і НК 026 разом ~4 МБ,
   * і клік по недовантажених даних інакше мовчки нічого не робив. */
  const BTNS = ['dxBtn', 'pairBtn', 'caseBtn'];
  for (const id of BTNS) {
    const b = document.getElementById(id);
    if (b) { b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Завантаження…'; }
  }
  boot().then(() => {
    for (const id of BTNS) {
      const b = document.getElementById(id);
      if (b) { b.disabled = false; b.textContent = b.dataset.label; }
    }
  }).catch((err) => {
    document.getElementById('statsOut').innerHTML =
      `<span class="err">Не вдалося завантажити дані: ${esc(err.message)}</span>`;
    for (const id of BTNS) {
      const b = document.getElementById(id);
      if (b) b.textContent = 'Дані не завантажились';
    }
  });
})();
