/* ============================================================
   Розділ «Рентген та ДІВ»

   Два принципи, від яких тут усе залежить:
   1. Дерево, а не шеренга фільтрів. Структура видна одразу, і кожен
      вузол має підпис — «п. 1.17 | Підставою на право експлуатації…»,
      а не голий номер, по якому доводиться клікати наосліп.
   2. Читалка, а не нарізка. Документ показується суцільним текстом
      із якорями; фрагменти лишаються двигуном пошуку під капотом.
   ============================================================ */
(() => {
  'use strict';

  const DATA = 'data/';
  const MAX_NODES_COLLAPSED = 14;   // скільки вузлів показати до «показати всі»

  const state = {
    index: null,
    search: null,
    packages: null,
    docCache: new Map(),
    openKey: null,
    chip: 'all',
    query: '',
    pmgOnly: false,
    expanded: new Set(),
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // нормалізація для пошуку: регістр + апострофи, яких в українських
  // текстах трапляється чотири різновиди
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[’'`ʼ]/g, "'");

  function highlight(text, q) {
    if (!q) return esc(text);
    const t = String(text);
    const i = norm(t).indexOf(norm(q));
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) +
           '</mark>' + esc(t.slice(i + q.length));
  }

  async function getJSON(path) {
    // Дані розділу ходять без ?v= (така конвенція порталу для /data/), тож без
    // цього браузер віддає вчорашній JSON новим кодом. 'no-cache' — це не
    // відмова від кешу, а обов'язкова ревалідація: незмінений файл повертає
    // 304 і майже нічого не коштує.
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  async function getDoc(key) {
    if (state.docCache.has(key)) return state.docCache.get(key);
    const doc = await getJSON(`${DATA}docs/${key}.json`);
    state.docCache.set(key, doc);
    return doc;
  }

  /* ---------------- дерево документів ---------------- */

  function docsForView() {
    let docs = state.index.documents;
    if (state.chip === 'force') docs = docs.filter((d) => d.in_force);
    if (state.chip === 'dead') docs = docs.filter((d) => !d.in_force);
    if (state.query) {
      const q = norm(state.query);
      const hitKeys = new Set(
        state.search.filter(([, , label, title]) =>
          norm(label).includes(q) || norm(title).includes(q)).map((r) => r[0]));
      docs = docs.filter((d) =>
        hitKeys.has(d.key) || norm(d.title).includes(q) || norm(String(d.num)).includes(q));
    }
    return docs;
  }

  function nodesForDoc(key) {
    if (!state.query) return null;
    const q = norm(state.query);
    return state.search.filter(([k, , label, title]) =>
      k === key && (norm(label).includes(q) || norm(title).includes(q)));
  }

  function renderTree() {
    const host = $('tree');
    const docs = docsForView();
    if (!docs.length) {
      host.innerHTML = '<div class="rt-empty" style="padding:32px 12px">' +
        '<p>За цим запитом нічого не знайшлося. Спробуйте коротше слово — ' +
        'пошук іде за назвами пунктів і статей.</p></div>';
      return;
    }

    const byContour = new Map();
    docs.forEach((d) => {
      if (!byContour.has(d.contour)) byContour.set(d.contour, []);
      byContour.get(d.contour).push(d);
    });

    let html = '';
    if (state.query) {
      const total = docs.reduce((s, d) => s + (nodesForDoc(d.key) || []).length, 0);
      html += `<div class="rt-count">Знайдено ${total} збігів у ${docs.length} актах</div>`;
    }

    for (const [contour, list] of byContour) {
      html += `<div class="rt-contour">${esc(contour)}</div>`;
      for (const d of list) {
        const open = state.openKey === d.key;
        const dead = d.in_force ? '' : ' <span class="rt-dead">❗ нечинний</span>';
        html += `<div class="rt-doc${open ? ' is-open' : ''}" data-key="${esc(d.key)}">
          <button class="rt-doc-btn" type="button" data-act="open" data-key="${esc(d.key)}">
            <span class="rt-doc-num">${esc(d.kind)} № ${esc(d.num)}</span>
            <span class="rt-doc-name">${highlight(d.title, state.query)}${dead}</span>
          </button>
          <div class="rt-nodes" data-nodes="${esc(d.key)}"></div>
        </div>`;
      }
    }
    host.innerHTML = html;
    if (state.openKey) renderNodeList(state.openKey);
  }

  async function renderNodeList(key) {
    const host = document.querySelector(`[data-nodes="${CSS.escape(key)}"]`);
    if (!host) return;
    const doc = await getDoc(key);
    const hits = nodesForDoc(key);
    let nodes = doc.nodes;
    if (hits) {
      const ids = new Set(hits.map((h) => h[1]));
      nodes = nodes.filter((n) => ids.has(n.id));
    } else {
      // без запиту показуємо лише верхні рівні — інакше 555 пунктів ОСПУ
      // перетворюють дерево на полотно
      nodes = nodes.filter((n) => n.level <= 4);
    }
    const expanded = state.expanded.has(key);
    const shown = expanded ? nodes : nodes.slice(0, MAX_NODES_COLLAPSED);

    host.innerHTML = shown.map((n) => `
      <button class="rt-node lvl-${n.level}" type="button" data-act="goto"
              data-key="${esc(key)}" data-id="${esc(n.id)}">
        <b>${esc(n.label)}</b> · ${highlight(n.title, state.query)}
      </button>`).join('') +
      (nodes.length > shown.length
        ? `<button class="rt-node-more" type="button" data-act="more" data-key="${esc(key)}">
             ↓ показати всі (${nodes.length})</button>`
        : '');
  }

  /* ---------------- читалка ---------------- */

  async function openDoc(key, scrollToId) {
    state.openKey = key;
    const doc = await getDoc(key);
    const m = doc.meta;
    const dead = !m.in_force;

    let html = `<div class="rt-doc-head">
      <div class="rt-doc-kind">${esc(m.kind)} № ${esc(m.num)} · ${esc(m.contour)}</div>
      <h2 class="rt-doc-title">${esc(m.title)}</h2>
      <div class="rt-meta">
        <span class="rt-badge ${dead ? 'no' : 'ok'}">${esc(m.status || (dead ? 'нечинний' : 'чинний'))}</span>
        ${m.revision ? `<span>Редакція: <b>${esc(m.revision)}</b></span>` : ''}
        ${m.revision_basis ? `<span>Підстава: <b>${esc(m.revision_basis)}</b></span>` : ''}
        ${m.amendments_count ? `<span>Змін: <b>${esc(m.amendments_count)}</b></span>` : ''}
        ${m.pages ? `<span>Сторінок: <b>${esc(m.pages)}</b></span>` : ''}
        ${m.source === 'dec.gov.ua'
          ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">Оригінал PDF на dec.gov.ua ↗</a>`
          : `<a href="${esc(m.url)}" target="_blank" rel="noopener">Перевірити на zakon.rada ↗</a>`}
      </div>
    </div>`;

    if (dead && m.repeal_note) {
      html += `<div class="rt-alert"><b>Акт нечинний — не посилатися в листі.</b><br>
        ${esc(m.repeal_note)}</div>`;
    }
    // Чому цього акта немає на rada: стандарти медичної допомоги та клінічні
    // настанови в Мін'юсті не реєструються, тож єдине державне джерело — ДЕЦ.
    if (m.source === 'dec.gov.ua') {
      html += `<div class="rt-source">Стандарти медичної допомоги та клінічні настанови
        МОЗ у Мін'юсті не реєструються — на zakon.rada їх немає. Джерело тексту —
        Державний експертний центр МОЗ (dec.gov.ua), Реєстр медико-технологічних
        документів. Чинність звіряти на картці МТД у ДЕЦ.</div>`;
    }
    if (!dead && m.status_curated) {
      html += `<div class="rt-source">Чинність цього акта rada не відстежує (секція
        «/rada/», відомчий наказ без реєстрації в Мін'юсті). Статус проставлено вручну
        за результатом звірки — див. примітку в реєстрі корпусу.</div>`;
    }
    if (m.amendments_raw) {
      html += `<div class="rt-amend">${esc(m.amendments_raw)}</div>`;
    }

    // Що саме в цьому акті стосується ПМГ. Для актів, де вимогою є весь
    // документ, фільтр не показуємо — інакше він удавав би точність.
    if (doc.pmg_note) {
      const part = doc.pmg_scope === 'part';
      html += `<div class="rt-pmg-box">
        <div class="rt-pmg-cap">🩻 Дотичне до вимог ПМГ</div>
        <div class="rt-pmg-note">${esc(doc.pmg_note)}</div>
        ${part ? `<button class="rt-chip rt-pmg-toggle${state.pmgOnly ? ' is-on' : ''}"
            type="button" data-act="pmgonly">Показати лише дотичні пункти (${doc.pmg_nodes})</button>
          <div class="rt-eq-hint">Відбір експертний, а не норма закону — решта тексту акта нікуди не зникає.</div>`
          : '<div class="rt-eq-hint">Тут вимогою є весь акт, тож відбирати пункти немає з чого.</div>'}
      </div>`;
    }

    if (doc.preamble) {
      html += `<div class="rt-preamble">${esc(doc.preamble)}</div>`;
    }

    // суцільний текст із якорями — документ читається як документ
    const part = doc.pmg_scope === 'part';
    const shown = (state.pmgOnly && part) ? doc.nodes.filter((n) => n.pmg) : doc.nodes;
    // позначку на пункті ставимо лише там, де вона щось розрізняє: коли
    // вимогою є весь акт, 🩻 на кожному пункті — просто шум
    html += shown.map((n) => `
      <section class="rt-sec lvl-${n.level}${n.pmg && part ? ' is-pmg' : ''}" id="sec-${esc(n.id)}">
        <div class="rt-sec-head">
          <span class="rt-sec-num">${esc(n.label)}</span>
          <span class="rt-sec-title">${highlight(n.title, state.query)}</span>
        </div>
        <div class="rt-sec-body">${highlight(n.text, state.query)}</div>
      </section>`).join('');

    $('reader').innerHTML = html;
    renderTree();
    if (scrollToId) gotoNode(scrollToId);
    else $('reader').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function gotoNode(id) {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    document.querySelectorAll('.rt-sec.is-hit').forEach((e) => e.classList.remove('is-hit'));
    el.classList.add('is-hit');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelectorAll('.rt-node.is-current').forEach((e) => e.classList.remove('is-current'));
    const btn = document.querySelector(`[data-act="goto"][data-id="${CSS.escape(id)}"]`);
    if (btn) btn.classList.add('is-current');
  }

  /* ---------------- пакети → дозвіл ---------------- */

  function renderPackages() {
    const host = $('pkgList');
    host.innerHTML = state.packages.packages.map((p) => {
      const cls = p.classes.map((c) =>
        `<span class="rt-cls ${esc(c)}">${esc(clsTitle(c))}</span>`).join('');
      return `<button class="rt-pkg-btn" type="button" data-act="pkg" data-num="${esc(p.number)}">
        <span class="rt-pkg-n">${esc(p.number)}</span>
        <span><span class="rt-pkg-name">${esc(p.title)}</span><br>${cls}</span>
      </button>`;
    }).join('');
    $('pkgCount').textContent = state.packages.packages.length;
  }

  function clsTitle(key) {
    const c = state.packages.classes.find((x) => x.key === key);
    return c ? c.title : key;
  }

  function openPackage(num) {
    const p = state.packages.packages.find((x) => x.number === num);
    if (!p) return;
    document.querySelectorAll('.rt-pkg-btn.is-current').forEach((e) => e.classList.remove('is-current'));
    const btn = document.querySelector(`[data-act="pkg"][data-num="${CSS.escape(num)}"]`);
    if (btn) btn.classList.add('is-current');

    const notes = p.classes.map((c) => {
      const info = state.packages.classes.find((x) => x.key === c);
      return info ? `<li><b>${esc(info.title)}.</b> ${esc(info.note)}</li>` : '';
    }).join('');

    let html = `<div class="rt-doc-head">
      <div class="rt-doc-kind">Пакет ${esc(p.number)} · ПМГ-2026</div>
      <h2 class="rt-doc-title">${esc(p.title)}</h2>
      <div class="rt-meta">${p.classes.map((c) =>
        `<span class="rt-cls ${esc(c)}">${esc(clsTitle(c))}</span>`).join('')}</div>
    </div>`;

    html += `<h3 class="rt-h3">Обладнання з ДІВ у вимогах пакета</h3>
      <ul class="rt-eq">${p.equipment.map((e) => `
        <li>
          <div class="rt-eq-name">${esc(e.name)}</div>
          ${e.esoz && e.esoz.length ? `
            <div class="rt-eq-esoz">
              <div class="rt-eq-esoz-cap">Вносити до Реєстру суб'єктів господарювання за кодом
                (${esc(state.packages.esoz_source.act)}):</div>
              ${e.esoz.map((z) => `<div class="rt-esoz">
                 <code>${esc(z.code)}</code><span>${esc(z.name)}</span></div>`).join('')}
              ${e.esoz.length > 1
                ? '<div class="rt-eq-hint">Вимога сформульована описово, тож типів у Переліку кілька — заклад вносить той, що відповідає фактичному апарату.</div>'
                : ''}
            </div>` : `
            <div class="rt-eq-hint">У Переліку за наказом № 697 такого типу немає — код ЕСОЗ не передбачено.</div>`}
        </li>`).join('')}</ul>`;

    if (notes) {
      html += `<div class="rt-amend"><ul style="margin:0;padding-left:18px">${notes}</ul></div>`;
    }

    html += `<h3 class="rt-h3">Що з цього випливає: ${p.permits.length} дозвільних блоків</h3>`;
    html += p.permits.map((pm) => `
      <div class="rt-permit">
        <div class="rt-permit-title">${esc(pm.title)}</div>
        <div class="rt-permit-note">${esc(pm.note)}</div>
        <div class="rt-permit-docs">${pm.docs.map((d) => `
          <button class="rt-permit-doc${d.in_force ? '' : ' dead'}" type="button"
                  data-act="jump" data-key="${esc(d.key)}">
            <span>${esc(d.kind)} № ${esc(d.num)}</span>
            <span>${esc(d.title)}</span>
            ${d.in_force ? '' : '<span class="rt-dead">❗ нечинний</span>'}
          </button>`).join('')}</div>
      </div>`).join('');

    $('pkgDetail').innerHTML = html;
    $('pkgDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- режими ---------------- */

  function setView(which) {
    const norms = which === 'norms';
    $('viewNorms').classList.toggle('is-visible', norms);
    $('viewPkg').classList.toggle('is-visible', !norms);
    $('viewNorms').hidden = !norms;
    $('viewPkg').hidden = norms;
    $('tabNorms').classList.toggle('is-active', norms);
    $('tabPkg').classList.toggle('is-active', !norms);
    $('tabNorms').setAttribute('aria-selected', String(norms));
    $('tabPkg').setAttribute('aria-selected', String(!norms));
    // «Пакет → дозвіл» — стартовий режим: експерт приходить із питанням про
    // пакет, а не з наміром почитати наказ. Тому чистий URL веде саме туди.
    location.hash = norms ? '#norms' : '';
  }

  /* ---------------- події ---------------- */

  function wire() {
    document.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'open') {
        if (state.openKey === t.dataset.key) { state.openKey = null; renderTree(); }
        else await openDoc(t.dataset.key);
      } else if (act === 'goto') {
        if (state.openKey !== t.dataset.key) await openDoc(t.dataset.key, t.dataset.id);
        else gotoNode(t.dataset.id);
      } else if (act === 'more') {
        state.expanded.add(t.dataset.key);
        renderNodeList(t.dataset.key);
      } else if (act === 'pmgonly') {
        state.pmgOnly = !state.pmgOnly;
        await openDoc(state.openKey);
      } else if (act === 'pkg') {
        openPackage(t.dataset.num);
      } else if (act === 'jump') {
        setView('norms');
        await openDoc(t.dataset.key);
      }
    });

    let timer;
    $('q').addEventListener('input', (e) => {
      state.query = e.target.value.trim();
      $('qClear').hidden = !state.query;
      clearTimeout(timer);
      timer = setTimeout(() => renderTree(), 160);
    });
    $('qClear').addEventListener('click', () => {
      $('q').value = ''; state.query = ''; $('qClear').hidden = true; renderTree();
    });

    document.querySelectorAll('.rt-chip').forEach((c) => {
      c.addEventListener('click', () => {
        document.querySelectorAll('.rt-chip').forEach((x) => x.classList.remove('is-on'));
        c.classList.add('is-on');
        state.chip = c.dataset.chip;
        renderTree();
      });
    });

    $('tabNorms').addEventListener('click', () => setView('norms'));
    $('tabPkg').addEventListener('click', () => setView('packages'));

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
    });
  }

  /* ---------------- старт ---------------- */

  async function init() {
    try {
      const [index, search, packages] = await Promise.all([
        getJSON(`${DATA}index.json`),
        getJSON(`${DATA}search.json`),
        getJSON(`${DATA}packages_div.json`),
      ]);
      state.index = index;
      state.search = search;
      state.packages = packages;

      $('statDocs').textContent = index.documents.length;
      $('statNodes').textContent = index.built_nodes.toLocaleString('uk-UA');
      $('statPkg').textContent = packages.packages.length;
      $('statDead').textContent = index.documents.filter((d) => !d.in_force).length;

      renderTree();
      renderPackages();
      wire();
      if (location.hash === '#norms') setView('norms');
    } catch (err) {
      $('tree').innerHTML = `<div class="rt-loading">Не вдалося завантажити дані: ${esc(err.message)}</div>`;
      console.error(err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
