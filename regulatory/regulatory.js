/* ============================================================
   Розділ «Нормативна база» — за архітектурою розділу «Рентген і ДІВ».

   Замість хаба з шістьма фільтрами і «робочого місця» з нарізкою на
   фрагменти: постійне дерево «група → акт → структура» зліва, суцільна
   читалка з якорями справа, один рядок пошуку зверху. Кожен екран має
   адресу (#doc/<key>/<node>), тому працює «назад» і посилання на пункт
   можна кинути в лист чи в паспорт пакета.

   Дані: data/index.json (легкий перелік), data/search.json (підписи
   вузлів), data/docs/<key>.json — ліниво, по кліку.
   Збирає tools/build_regulatory.py. Тлумачень тут немає — лише текст.
   ============================================================ */
(() => {
  'use strict';

  const DATA = 'data/';
  const TREE_MAX = 160;            // скільки вузлів показувати в дереві без «усі»

  const state = {
    index: null,
    search: null,
    docCache: new Map(),
    openKey: null,
    chip: 'all',
    query: '',
    expanded: new Set(),
    closedGroups: new Set(),
    route: { key: null, node: null },
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[’'`ʼ]/g, "'").replace(/\s+/g, ' ');
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    return b === 1 ? one : many;
  };
  const dateUa = (iso) => iso && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : (iso || '');

  function highlight(text, q) {
    if (!q) return esc(text);
    const t = String(text ?? '');
    const nq = norm(q);
    if (!nq) return esc(t);
    // норма й оригінал однакової довжини (замінюємо символ на символ),
    // тож індекси збігаються
    const nt = t.toLowerCase().replace(/[’'`ʼ]/g, "'");
    let out = '', i = 0, k;
    while ((k = nt.indexOf(nq, i)) >= 0) {
      out += esc(t.slice(i, k)) + '<mark>' + esc(t.slice(k, k + nq.length)) + '</mark>';
      i = k + nq.length;
    }
    return out + esc(t.slice(i));
  }

  async function getJSON(path, attempt = 0) {
    // /data/ ходить без ?v=; no-cache = обов'язкова ревалідація, а не
    // відмова від кешу (304 майже безкоштовний). Одна повторна спроба:
    // обрив з'єднання на великому JSON — не привід показувати порожнє дерево.
    try {
      const r = await fetch(path, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      if (attempt < 1) {
        await new Promise((res) => setTimeout(res, 500));
        return getJSON(path, attempt + 1);
      }
      throw err;
    }
  }

  async function getDoc(key) {
    if (state.docCache.has(key)) return state.docCache.get(key);
    const doc = await getJSON(`${DATA}docs/${key}.json`);
    state.docCache.set(key, doc);
    return doc;
  }

  const docByKey = (key) => state.index.documents.find((d) => d.key === key) || null;
  const docById = (id) => state.index.documents.find((d) => d.id === id) || null;

  /* ================= маршрутизація ================= */

  // #doc/<key>/<node> — основна адреса (на неї посилаються паспорти);
  // #/doc/<key>/<node> — форма, як у розділі «Рентген», теж приймається;
  // #doc=<uuid> — стара адреса розділу, переводимо на ключ акта.
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    if (!h) return { key: null, node: null };
    const legacy = h.match(/^doc=([^&/]+)/);
    if (legacy) {
      const d = docById(decodeURIComponent(legacy[1]));
      return { key: d ? d.key : null, node: null, legacy: true };
    }
    const [a, b, c] = h.split('/');
    if (a === 'doc') return { key: b ? decodeURIComponent(b) : null, node: c ? decodeURIComponent(c) : null };
    // чужий якір (#top від портального «↑ Верх») стан не міняє
    return { ...state.route };
  }

  const hashFor = (key, node) => key ? `#doc/${key}${node ? '/' + node : ''}` : '#';
  const go = (hash) => { location.hash = hash; };

  async function applyRoute() {
    const r = parseHash();
    if (r.legacy && r.key) { history.replaceState(null, '', hashFor(r.key)); }
    state.route = { key: r.key, node: r.node };
    if (r.key) await openDoc(r.key, r.node);
    else { state.openKey = null; resetReader(); renderTree(); window.scrollTo(0, 0); }
  }

  /* ================= дерево ================= */

  function docMatches(d, q) {
    return norm(d.title).includes(q) || norm(String(d.num)).includes(q) ||
      norm(`${d.kind} № ${d.num}`).includes(q) || norm(d.key).includes(q);
  }

  function hitIdsFor(key) {
    // без запиту — null (показуємо структуру); із запитом — id вузлів-збігів.
    // Якщо текст акта вже завантажено, шукаємо і по тілу пунктів, а не лише
    // по підписах: підпис — це перші 100 знаків, тіло — весь пункт.
    if (!state.query) return null;
    const q = norm(state.query);
    const doc = state.docCache.get(key);
    if (doc) {
      return new Set(doc.nodes.filter((n) =>
        norm(n.title).includes(q) || norm(n.label).includes(q) || norm(n.text).includes(q)).map((n) => n.id));
    }
    return new Set(state.search.filter(([k, , label, title]) =>
      k === key && (norm(label).includes(q) || norm(title).includes(q))).map((r) => r[1]));
  }

  function docsForView() {
    let docs = state.index.documents;
    if (state.chip === 'text') docs = docs.filter((d) => d.nodes > 0);
    if (state.chip === 'pkg') docs = docs.filter((d) => d.packages.length > 0);
    if (state.query) {
      const q = norm(state.query);
      docs = docs.filter((d) => docMatches(d, q) || hitIdsFor(d.key).size > 0);
    }
    return docs;
  }

  function renderTree() {
    const host = $('tree');
    const docs = docsForView();
    if (!docs.length) {
      host.innerHTML = '<div class="rg-empty" style="padding:32px 12px"><p>За цим запитом нічого ' +
        'не знайшлося. Спробуйте коротше слово: пошук іде за назвами актів і підписами пунктів, ' +
        'а у відкритому акті — по всьому тексту.</p></div>';
      return;
    }
    const byGroup = new Map();
    docs.forEach((d) => {
      if (!byGroup.has(d.group)) byGroup.set(d.group, []);
      byGroup.get(d.group).push(d);
    });
    let html = '';
    if (state.query) {
      const total = docs.reduce((s, d) => s + (hitIdsFor(d.key) || new Set()).size, 0);
      html += `<div class="rg-count">Знайдено ${total} ${plural(total, 'збіг', 'збіги', 'збігів')} у ${docs.length} ${plural(docs.length, 'акті', 'актах', 'актах')}</div>`;
    }
    for (const g of state.index.groups) {
      const list = byGroup.get(g.key);
      if (!list) continue;
      const closed = state.closedGroups.has(g.key) && !state.query;
      html += `<button class="rg-group${closed ? ' is-closed' : ''}" type="button" data-act="group" data-group="${esc(g.key)}"
        aria-expanded="${!closed}"><span>${esc(g.title)}</span><i>${list.length}</i></button>`;
      if (closed) continue;
      for (const d of list) {
        const open = state.openKey === d.key;
        const dead = d.in_force ? '' : ' <span class="rg-dead">❗ нечинний</span>';
        const card = d.nodes ? '' : ' <span class="rg-cardmark" title="Лише картка: повний текст в іншому розділі або на rada">картка</span>';
        html += `<div class="rg-doc${open ? ' is-open' : ''}" data-key="${esc(d.key)}">
          <a class="rg-doc-btn" href="${hashFor(d.key)}">
            <span class="rg-doc-num">${esc(d.kind)} № ${esc(d.num)}</span>
            <span class="rg-doc-name">${highlight(d.title, state.query)}${dead}${card}</span>
          </a>
          <div class="rg-nodes" data-nodes="${esc(d.key)}"></div>
        </div>`;
      }
    }
    host.innerHTML = html;
    if (state.openKey) {
      renderNodeList(state.openKey);
      // відкритий акт має бути видно в дереві, а не десь у сьомій групі
      const el = host.querySelector('.rg-doc.is-open');
      if (el) host.scrollTop = Math.max(0, el.offsetTop - host.offsetTop - 12);
    }
  }

  function treeLevelFor(nodes) {
    // глибина, на якій дерево ще лишається деревом, а не полотном. Стартуємо
    // з найменшого рівня, що є в акті: у постанов без розділів усі пункти
    // лежать на рівні 2 («акт / п. 1»), і від рівня 1 дерево було б порожнім.
    let L = Math.min(...nodes.map((n) => n.level));
    while (L < 6 && nodes.filter((n) => n.level <= L + 1).length <= TREE_MAX) L++;
    return L;
  }

  async function renderNodeList(key) {
    const host = document.querySelector(`[data-nodes="${CSS.escape(key)}"]`);
    if (!host) return;
    const entry = docByKey(key);
    if (!entry || !entry.nodes) return;
    let doc;
    try { doc = await getDoc(key); } catch { return; }
    const hits = hitIdsFor(key);
    let nodes = doc.nodes;
    if (hits) nodes = nodes.filter((n) => hits.has(n.id));
    else nodes = nodes.filter((n) => n.level <= treeLevelFor(doc.nodes));
    const expanded = state.expanded.has(key);
    const shown = expanded ? nodes : nodes.slice(0, TREE_MAX);
    const cur = state.route.node;
    host.innerHTML = shown.map((n) => `
      <a class="rg-node lvl-${n.level}${n.id === cur ? ' is-current' : ''}" href="${hashFor(key, n.id)}" data-id="${esc(n.id)}">
        ${n.label ? `<b>${esc(n.label)}</b> · ` : ''}${highlight(n.title, state.query)}
      </a>`).join('') +
      (nodes.length > shown.length
        ? `<button class="rg-node-more" type="button" data-act="more" data-key="${esc(key)}">↓ показати всі (${nodes.length})</button>`
        : '');
  }

  /* ================= читалка ================= */

  function resetReader() {
    $('reader').innerHTML = `<div class="rg-empty">
      <div class="rg-empty-ico" aria-hidden="true">⚖️</div>
      <h2>Оберіть акт зліва</h2>
      <p>Документ відкриється суцільним текстом із якорями на пункти. Кожен акт і кожен пункт
      мають власну адресу — її можна кинути в лист або в паспорт пакета.</p></div>`;
  }

  function badgeHTML(d) {
    return `<span class="rg-badge ${d.in_force ? 'ok' : 'no'}">${esc(d.status || (d.in_force ? 'чинний' : 'нечинний'))}</span>`;
  }

  function packagesHTML(d) {
    if (!d.packages || !d.packages.length) return '';
    const total = d.packages.reduce((s, p) => s + p.refs, 0);
    return `<div class="rg-pkgbox">
      <div class="rg-pkg-cap">📦 На цей акт спираються пакети ПМГ-2026</div>
      <div class="rg-pkg-list">${d.packages.map((p) =>
        `<a class="rg-pkg" href="../passport/index.html?package=${encodeURIComponent(p.n)}"
            title="${p.refs} ${plural(p.refs, 'посилання', 'посилання', 'посилань')} у вимогах пакета">Пакет ${esc(p.n)}<i>${p.refs}</i></a>`).join('')}</div>
      <div class="rg-pkg-hint">${total} ${plural(total, 'посилання', 'посилання', 'посилань')} у вкладці «Вимоги закупівлі» паспортів — шар нормативного підкріплення, а не норма закону.</div>
    </div>`;
  }

  function ownersHTML(d, full) {
    if (!d.owners || !d.owners.length) return '';
    return `<div class="rg-owners">
      <div class="rg-pkg-cap">🧭 ${full ? 'Повний текст і інструменти — в іншому розділі' : 'Цей акт має власний розділ'}</div>
      <div class="rg-owner-list">${d.owners.map((o) =>
        `<a class="rg-owner" href="${esc(o.href)}">${esc(o.label)} →</a>`).join('')}</div>
    </div>`;
  }

  function headHTML(d, m) {
    const g = state.index.groups.find((x) => x.key === d.group);
    const url = d.url && !d.url_is_search ? d.url : null;
    const search = d.url && d.url_is_search ? d.url : null;
    return `<div class="rg-doc-head">
      <div class="rg-doc-kind">${esc(d.kind)} № ${esc(d.num)} від ${esc(dateUa(d.date))}${g ? ' · ' + esc(g.title) : ''}</div>
      <h2 class="rg-doc-title">${esc(d.title)}</h2>
      <div class="rg-meta">
        ${badgeHTML(d)}
        ${m && m.revision ? `<span>Редакція: <b>${esc(m.revision)}</b></span>` : ''}
        ${m && m.revision_basis ? `<span>Підстава: <b>${esc(m.revision_basis)}</b></span>` : ''}
        ${m && m.amendments_count ? `<span>Змін: <b>${esc(m.amendments_count)}</b></span>` : ''}
        ${m && m.registry ? `<span>Реєстр МТД: <b>${esc(m.registry)}</b></span>` : ''}
        ${m && m.pages ? `<span>Сторінок: <b>${esc(m.pages)}</b></span>` : ''}
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${url.includes('dec.gov.ua') ? 'Оригінал на dec.gov.ua ↗' : 'Перевірити на zakon.rada ↗'}</a>` : ''}
        ${search ? `<a href="${esc(search)}" target="_blank" rel="noopener">Пошук на zakon.rada ↗</a>` : ''}
        <button class="rg-copy" type="button" data-act="copylink" title="Скопіювати посилання на цей екран">🔗 посилання</button>
      </div>
    </div>`;
  }

  function renderCard(d) {
    // Акт без корпусу: чесна картка замість порожнього «робочого місця».
    let html = headHTML(d, null);
    html += ownersHTML(d, true);
    if (!d.owners.length) {
      html += `<div class="rg-source">Повного тексту цього акта в корпусі порталу ще немає${
        d.url && !d.url_is_search ? ' — читати на zakon.rada за посиланням вище' : ''}. Картка веде лише реквізити й зв'язки з пакетами.</div>`;
    }
    html += packagesHTML(d);
    if (d.summary) html += `<div class="rg-preamble">${esc(d.summary)}</div>`;
    $('reader').innerHTML = html;
  }

  async function openDoc(key, scrollToId) {
    const d = docByKey(key);
    if (!d) { go('#'); return; }
    state.openKey = key;
    if (!d.nodes) {
      renderCard(d);
      renderTree();
      afterOpen(null);
      return;
    }
    let doc;
    try {
      doc = await getDoc(key);
    } catch (err) {
      $('reader').innerHTML = `<div class="rg-alert"><b>Текст акта не завантажився.</b><br>${esc(err.message)}.
        <button class="rg-chip" type="button" data-act="retry" data-key="${esc(key)}" style="margin-top:10px">Спробувати ще раз</button></div>`;
      renderTree();
      return;
    }
    const m = doc.meta;
    let html = headHTML(d, m);

    if (!d.in_force && m.repeal_note) {
      html += `<div class="rg-alert"><b>Акт нечинний — не посилатися в листі.</b><br>${esc(m.repeal_note)}</div>`;
    }
    html += ownersHTML(d, false);
    html += packagesHTML(d);

    if (m.source === 'dec.gov.ua') {
      html += `<div class="rg-source">Стандарти медичної допомоги, УКПМД і клінічні настанови МОЗ у Мін'юсті не
        реєструються — на zakon.rada їх немає. Джерело тексту — Державний експертний центр МОЗ (dec.gov.ua),
        Реєстр медико-технологічних документів. Чинність звіряти на картці МТД у ДЕЦ.</div>`;
    }
    if (m.text_source === 'legacy') {
      html += `<div class="rg-source">Текст узято зі старого індексу розділу (розбиття на фрагменти — попереднього конвеєра),
        тому нумерація пунктів може повторюватися там, де в акті починається новий затверджений документ.
        Точну редакцію звіряти на zakon.rada.</div>`;
    }
    if (m.note) html += `<div class="rg-source">${esc(m.note)}</div>`;
    if (m.parts) {
      html += `<div class="rg-source">Наказ затвердив ${m.parts.length} ${plural(m.parts.length, 'документ', 'документи', 'документів')} —
        кожен показано окремою частиною: ${m.parts.map((p) => esc(p.title || p.rada_id)).join('; ')}.</div>`;
    }
    if (m.amendments_raw) {
      html += `<details class="rg-fold"><summary>Перелік змін до акта</summary><div class="rg-amend">${esc(m.amendments_raw)}</div></details>`;
    }
    if (doc.preamble) html += `<div class="rg-preamble">${esc(doc.preamble)}</div>`;

    // суцільний текст із якорями. Крихта-роздільник з'являється там, де
    // змінюється «батько» вузла і його не було заголовком щойно вище:
    // у стандартів ДЕЦ і ДКХП батьківський шлях — єдиний орієнтир.
    let prevParent = null, prevPath = null;
    const q = state.query;
    html += doc.nodes.map((n) => {
      let s = '';
      if (n.parent && n.parent !== prevParent && n.parent !== prevPath) {
        s += `<div class="rg-crumb">${esc(n.parent)}</div>`;
      }
      prevParent = n.parent; prevPath = n.path;
      const heading = !n.text;
      // Підпис пункту зібрано з його перших слів — у дереві це орієнтир, а в
      // читалці над тим самим текстом він лише дублює абзац. Показуємо його
      // тільки там, де це справжня назва (стаття, розділ, табель).
      const auto = !heading && norm(n.text).startsWith(norm(n.title.replace(/…$/, '')).slice(0, 40));
      // довгий підпис («Положення протоколу», «Завдання та обов'язки») — не
      // номер, а заголовок блоку: йде окремим рядком над текстом
      const longLabel = n.label.length > 16;
      s += `<section class="rg-sec lvl-${n.level}${heading ? ' is-heading' : ''}${auto ? ' is-auto' : ''}${longLabel ? ' is-long' : ''}" id="sec-${esc(n.id)}">
        <div class="rg-sec-head">
          ${n.label ? `<span class="rg-sec-num">${esc(n.label)}</span>` : '<span class="rg-sec-num rg-sec-num-empty"></span>'}
          <span class="rg-sec-title">${auto ? '' : highlight(n.title, q)}</span>
          <a class="rg-anchor" href="${hashFor(key, n.id)}" title="Посилання на цей пункт" aria-label="Посилання на пункт">§</a>
        </div>
        ${heading ? '' : `<div class="rg-sec-body">${highlight(n.text, q)}</div>`}
      </section>`;
      return s;
    }).join('');

    $('reader').innerHTML = html;
    renderTree();
    afterOpen(scrollToId);
  }

  function afterOpen(scrollToId) {
    if (scrollToId) { gotoNode(scrollToId); return; }
    // на вузькому екрані дерево стоїть над читалкою — довозимо до тексту,
    // інакше після кліку людина бачить те саме дерево і думає, що нічого
    // не сталося
    if (window.matchMedia('(max-width: 900px)').matches) {
      $('reader').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo(0, 0);
    }
  }

  function gotoNode(id) {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    document.querySelectorAll('.rg-sec.is-hit').forEach((e) => e.classList.remove('is-hit'));
    el.classList.add('is-hit');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelectorAll('.rg-node.is-current').forEach((e) => e.classList.remove('is-current'));
    const btn = document.querySelector(`.rg-node[data-id="${CSS.escape(id)}"]`);
    if (btn) btn.classList.add('is-current');
  }

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 1600);
  }

  /* ================= події ================= */

  function wire() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'more') {
        state.expanded.add(t.dataset.key);
        renderNodeList(t.dataset.key);
      } else if (act === 'group') {
        const g = t.dataset.group;
        if (state.closedGroups.has(g)) state.closedGroups.delete(g); else state.closedGroups.add(g);
        renderTree();
      } else if (act === 'retry') {
        state.docCache.delete(t.dataset.key);
        openDoc(t.dataset.key, state.route.node);
      } else if (act === 'copylink') {
        const url = location.href.replace(/#.*$/, '') + hashFor(state.route.key, state.route.node);
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
          .then(() => toast('Посилання скопійовано'), () => toast(url));
      }
    });

    let timer;
    const onQuery = (v) => {
      state.query = v.trim();
      $('qClear').hidden = !state.query;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        renderTree();
        // у відкритому акті підсвічуємо збіги в самому тексті
        if (state.openKey && docByKey(state.openKey)?.nodes) await openDoc(state.openKey, null);
      }, 180);
    };
    $('q').addEventListener('input', (e) => onQuery(e.target.value));
    $('qClear').addEventListener('click', () => { $('q').value = ''; onQuery(''); });

    document.querySelectorAll('.rg-chip[data-chip]').forEach((c) => {
      c.addEventListener('click', () => {
        document.querySelectorAll('.rg-chip[data-chip]').forEach((x) => x.classList.remove('is-on'));
        c.classList.add('is-on');
        state.chip = c.dataset.chip;
        renderTree();
      });
    });

    window.addEventListener('hashchange', applyRoute);
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== $('q') &&
          !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $('q').focus(); }
    });
  }

  /* ================= старт ================= */

  async function init() {
    try {
      const [index, search] = await Promise.all([
        getJSON(`${DATA}index.json`),
        getJSON(`${DATA}search.json`),
      ]);
      state.index = index;
      state.search = search;

      $('statDocs').textContent = index.documents.length;
      $('statText').textContent = index.with_text;
      $('statNodes').textContent = index.built_nodes.toLocaleString('uk-UA');
      $('statPkg').textContent = index.packages.length;

      // старі адреси: ?doc=<uuid> (з інших розділів) і ?q=<слово> (з «Посад»)
      const params = new URLSearchParams(location.search);
      const legacyId = params.get('doc');
      if (legacyId && !location.hash) {
        const d = docById(legacyId);
        if (d) history.replaceState(null, '', location.pathname + hashFor(d.key));
      }
      const q = params.get('q');
      if (q) { $('q').value = q; state.query = q.trim(); $('qClear').hidden = !state.query; }

      wire();
      await applyRoute();
    } catch (err) {
      $('tree').innerHTML = `<div class="rg-loading">Не вдалося завантажити дані: ${esc(err.message)}</div>`;
      console.error(err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
