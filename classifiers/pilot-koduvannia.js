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
    const [dual, odk, sl] = await Promise.all([
      fetchJson('data/pilot_koduvannia.json'),
      fetchJson('../mapping/data/odk.json'),
      fetchJson('../mapping/data/services_lite.json'),
    ]);
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
    document.getElementById('dxBtn').onclick = () => renderDx(dx.value);
    document.getElementById('pairBtn').onclick = () => renderPair(gr.value, pd.value);
    dx.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') renderDx(dx.value); });
    for (const el of [gr, pd])
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') renderPair(gr.value, pd.value); });

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
    });
  }

  boot().catch((err) => {
    document.getElementById('statsOut').innerHTML =
      `<span class="err">Не вдалося завантажити дані: ${esc(err.message)}</span>`;
  });
})();
