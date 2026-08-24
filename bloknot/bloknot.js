/* ============================================================
   Розділ «Робочий блокнот»
   Дані статичні (зібрані build_bloknot.py), стан — у location.hash,
   щоб кейс можна було кинути посиланням у чат.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  index: [],
  links: null,
  cases: new Map(),   // id → повний кейс (довантажується на вимогу)
  tags: new Set(),
  filterTag: null,
  query: '',
  gallery: [],
  shot: 0,
};

/* ---------- завантаження ---------- */

async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function getCase(id) {
  if (state.cases.has(id)) return state.cases.get(id);
  const data = await getJSON(`data/case-${id}.json`);
  state.cases.set(id, data);
  return data;
}

/* ---------- список кейсів ---------- */

function renderTags() {
  const box = $('tagFilter');
  box.innerHTML = '';
  [...state.tags].sort().forEach((t) => {
    const b = el('button', 'bl-chip', t);
    b.type = 'button';
    if (state.filterTag === t) b.classList.add('is-on');
    b.addEventListener('click', () => {
      state.filterTag = state.filterTag === t ? null : t;
      renderTags();
      renderList();
    });
    box.appendChild(b);
  });
}

function matches(c) {
  if (state.filterTag && !c.tags.includes(state.filterTag)) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [c.title, c.subtitle, c.teaser, c.tags.join(' '), c.id].join(' ').toLowerCase();
  return hay.includes(q);
}

function renderList() {
  const grid = $('caseGrid');
  grid.innerHTML = '';
  const rows = state.index.filter(matches);
  if (!rows.length) {
    grid.appendChild(el('p', 'bl-empty', 'За цим запитом кейсів немає.'));
    return;
  }
  rows.forEach((c) => {
    const card = el('button', 'bl-card');
    card.type = 'button';
    if (c.cover) {
      const img = el('img', 'bl-card-cover');
      img.src = c.cover;
      img.alt = '';
      img.loading = 'lazy';
      card.appendChild(img);
    }
    const body = el('div', 'bl-card-body');
    body.appendChild(el('h3', null, c.title));
    if (c.subtitle) body.appendChild(el('p', 'bl-card-sub', c.subtitle));
    if (c.teaser) body.appendChild(el('p', 'bl-card-teaser', c.teaser));

    const n = c.counts;
    const counts = el('div', 'bl-counts');
    counts.appendChild(el('span', null, `${n.achi} кодів`));
    counts.appendChild(el('span', null, `${n.packages} пакетів`));
    counts.appendChild(el('span', null, `${n.media} візуалізацій`));
    if (n.open) counts.appendChild(el('span', null, `${n.open} хвостів`));
    body.appendChild(counts);

    const foot = el('div', 'bl-card-foot');
    const st = el('span', 'bl-status', c.status);
    st.dataset.s = c.status;
    foot.appendChild(st);
    c.tags.slice(0, 3).forEach((t) => foot.appendChild(el('span', 'bl-tag', t)));
    body.appendChild(foot);

    card.appendChild(body);
    card.addEventListener('click', () => { location.hash = `#/case/${c.id}`; });
    grid.appendChild(card);
  });
}

/* ---------- деталь кейса ---------- */

function block(title, node) {
  const b = el('section', 'bl-block');
  b.appendChild(el('h3', null, title));
  b.appendChild(node);
  return b;
}

function refCard(item, opts = {}) {
  const a = el('a', 'bl-ref');
  a.href = item.href;
  a.appendChild(el('span', 'bl-ref-code', opts.code || item.code || item.num));
  a.appendChild(el('span', 'bl-ref-name', opts.name || item.name));
  if (opts.extra) {
    const x = el('span', 'bl-ref-extra');
    x.innerHTML = opts.extra;
    a.appendChild(x);
  }
  if (opts.gap) a.dataset.gap = '1';
  return a;
}

function renderRefs(refs) {
  const wrap = el('div');

  if (refs.achi.length) {
    const g = el('div', 'bl-refgroup');
    g.appendChild(el('h4', null, 'Медичні інтервенції · НК 026 → облік у пакеті 9'));
    const list = el('div', 'bl-reflist');
    refs.achi.forEach((c) => {
      // без пакета — головна знахідка кейса, підсвічуємо
      const gap = !c.pkgs || !c.pkgs.length;
      let extra;
      if (c.cls) {
        const pos = (c.pos || []).map((p) => p.c).join(', ');
        extra = `<b>${c.cls}</b>${pos ? ' · ' + pos : ''}`;
      } else if (gap) {
        extra = 'у жодному пакеті не обліковується';
      }
      const card = refCard(c, { extra, gap });
      // якщо код обліковується в пакеті 9 — ведемо у довідник обліку, не в класифікатор
      if (c.href9) card.href = c.href9;
      list.appendChild(card);
    });
    g.appendChild(list);
    wrap.appendChild(g);
  }

  if (refs.packages.length) {
    const g = el('div', 'bl-refgroup');
    g.appendChild(el('h4', null, 'Пакети медичних послуг → паспорт'));
    const list = el('div', 'bl-reflist');
    refs.packages.forEach((p) => list.appendChild(
      refCard(p, { code: `Пакет ${p.num}`, name: p.name })));
    g.appendChild(list);
    wrap.appendChild(g);
  }

  if (refs.positions.length) {
    const g = el('div', 'bl-refgroup');
    g.appendChild(el('h4', null, 'Посади за довідником ЕСОЗ'));
    const list = el('div', 'bl-reflist');
    refs.positions.forEach((p) => list.appendChild(refCard(p)));
    g.appendChild(list);
    wrap.appendChild(g);
  }

  if (refs.rules377.length) {
    const g = el('div', 'bl-refgroup');
    g.appendChild(el('h4', null, 'Правила наказу НСЗУ № 377'));
    const list = el('div', 'bl-reflist');
    refs.rules377.forEach((r) => list.appendChild(refCard(r)));
    g.appendChild(list);
    wrap.appendChild(g);
  }

  if (refs.acts && refs.acts.length) {
    const g = el('div', 'bl-refgroup');
    g.appendChild(el('h4', null, 'Нормативні акти, на яких стоїть розбір'));
    const list = el('div', 'bl-reflist');
    refs.acts.forEach((a) => {
      const d = el('div', 'bl-refplain');
      d.appendChild(document.createTextNode(a.label + ' '));
      if (a.note) d.appendChild(el('span', null, '· ' + a.note));
      list.appendChild(d);
    });
    g.appendChild(list);
    wrap.appendChild(g);
  }

  if (refs.sections && refs.sections.length) {
    const g = el('div', 'bl-refgroup');
    g.appendChild(el('h4', null, 'Розділи порталу, де копати далі'));
    const list = el('div', 'bl-reflist');
    refs.sections.forEach((s) => list.appendChild(
      refCard({ href: '../' + s.href }, { code: s.label, name: s.note || '' })));
    g.appendChild(list);
    wrap.appendChild(g);
  }

  return wrap;
}

function renderGallery(media, note) {
  const wrap = el('div');
  const grid = el('div', 'bl-gallery');
  media.forEach((m, i) => {
    const btn = el('button', 'bl-shot');
    btn.type = 'button';
    const img = el('img');
    img.src = m.thumb;
    img.alt = m.caption || '';
    img.loading = 'lazy';
    btn.appendChild(img);
    // не figcaption: він допустимий лише всередині figure, а плитка — кнопка
    btn.appendChild(el('span', 'bl-shot-cap', m.caption || ''));
    btn.addEventListener('click', () => openLightbox(media, i));
    grid.appendChild(btn);
  });
  wrap.appendChild(grid);
  if (note) wrap.appendChild(el('p', 'bl-note', note));
  return wrap;
}

async function renderCase(id) {
  let c;
  try {
    c = await getCase(id);
  } catch (e) {
    $('caseDetail').innerHTML = '';
    $('caseDetail').appendChild(el('p', 'bl-empty', 'Кейс не знайдено.'));
    return;
  }
  const d = $('caseDetail');
  d.innerHTML = '';

  d.appendChild(el('h2', null, c.title));
  if (c.subtitle) d.appendChild(el('p', 'bl-detail-sub', c.subtitle));

  const meta = el('div', 'bl-meta');
  const st = el('span', 'bl-status', c.status);
  st.dataset.s = c.status;
  meta.appendChild(st);
  (c.tags || []).forEach((t) => meta.appendChild(el('span', 'bl-tag', t)));
  meta.appendChild(el('span', 'bl-meta-date', `заведено ${c.opened} · оновлено ${c.updated}`));
  d.appendChild(meta);

  if (c.source && c.source.length) {
    const box = el('div', 'bl-src');
    c.source.forEach((s) => {
      const row = el('div', 'bl-src-row');
      row.appendChild(el('b', null, s.who));
      const tail = [s.kind, s.date, s.note].filter(Boolean).join(' · ');
      row.appendChild(el('span', null, ' — ' + tail));
      box.appendChild(row);
    });
    d.appendChild(block('Звідки взявся кейс', box));
  }

  if (c.questions && c.questions.length) {
    const ol = el('ol', 'bl-qlist');
    c.questions.forEach((q) => ol.appendChild(el('li', null, q)));
    d.appendChild(block('Що спитали', ol));
  }

  if (c.sections && c.sections.length) {
    const box = el('div');
    c.sections.forEach((s) => {
      const sec = el('div', 'bl-sec');
      sec.dataset.k = s.kind || 'finding';
      sec.appendChild(el('h4', null, s.h));
      (s.p || []).forEach((p) => sec.appendChild(el('p', null, p)));
      box.appendChild(sec);
    });
    d.appendChild(block('Розбір', box));
  }

  if (c.money && c.money.length) {
    const wrap = el('div', 'bl-money-wrap');
    const t = el('table', 'bl-money');
    const thead = el('thead');
    const hr = el('tr');
    ['Клас медичних послуг', 'Коефіцієнт', 'Грн за послугу'].forEach((h) => hr.appendChild(el('th', null, h)));
    thead.appendChild(hr);
    t.appendChild(thead);
    const tb = el('tbody');
    c.money.forEach((m) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, m.label));
      tr.appendChild(el('td', null, m.coef));
      tr.appendChild(el('td', null, m.uah));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    d.appendChild(block('Гроші: ставка 155 грн × коефіцієнт класу', wrap));
  }

  if (c.decision && c.decision.what && c.decision.what.length) {
    const box = el('div', 'bl-decision');
    const ol = el('ol');
    c.decision.what.forEach((w) => ol.appendChild(el('li', null, w)));
    box.appendChild(ol);
    d.appendChild(block(`Що вирішили${c.decision.date ? ' · діє з ' + c.decision.date : ''}`, box));
  }

  if (c.open_items && c.open_items.length) {
    const ul = el('ul', 'bl-open');
    c.open_items.forEach((o) => ul.appendChild(el('li', null, o)));
    d.appendChild(block('Що лишилося', ul));
  }

  if (c.media && c.media.length) {
    d.appendChild(block('Візуалізація', renderGallery(c.media, c.media_note)));
  }

  if (c.refs) d.appendChild(block('Звʼязки з екосистемою', renderRefs(c.refs)));

  if (c.docs && c.docs.length) {
    const wrap = el('div');
    const ul = el('ul', 'bl-docs');
    c.docs.forEach((doc) => {
      const li = el('li', 'bl-doc');
      li.appendChild(el('span', 'bl-doc-kind', doc.kind));
      li.appendChild(el('span', null, doc.name));
      li.appendChild(el('span', 'bl-doc-file', `${doc.file}${doc.date ? ' · ' + doc.date : ''}`));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    if (c.docs_note) wrap.appendChild(el('p', 'bl-note', c.docs_note));
    d.appendChild(block('Документи, які вийшли з кейса', wrap));
  }
}

/* ---------- зворотний покажчик ---------- */

const GROUP_TITLES = {
  achi: 'Медичні інтервенції',
  packages: 'Пакети',
  positions: 'Посади',
  rules377: 'Правила наказу 377',
};

// куди веде сама позиція покажчика — ті самі адреси, що й у картках кейса
const GROUP_HREF = {
  achi: (k) => `../classifiers/nk026.html?code=${k}`,
  packages: (k) => `../passport/index.html?package=${k}`,
  positions: () => '../classifiers/posady.html',
  rules377: (k) => `../algorithms/index.html?q=${k}`,
};

function renderLinks() {
  const box = $('linkGroups');
  box.innerHTML = '';
  const titleById = new Map(state.index.map((c) => [c.id, c.title]));

  Object.entries(GROUP_TITLES).forEach(([key, title]) => {
    const data = state.links[key] || {};
    const keys = Object.keys(data);
    if (!keys.length) return;
    const col = el('div', 'bl-linkcol');
    col.appendChild(el('h3', null, `${title} · ${keys.length}`));
    keys.sort().forEach((k) => {
      const row = el('div', 'bl-linkrow');
      const head = el('div');
      const link = el('a', null, key === 'packages' ? `Пакет ${k}` : k);
      link.href = GROUP_HREF[key](k);
      head.appendChild(link);
      row.appendChild(head);
      if (data[k].label) row.appendChild(el('p', null, data[k].label));
      const cases = el('p', 'bl-linkcases');
      data[k].cases.forEach((cid, i) => {
        if (i) cases.appendChild(document.createTextNode(', '));
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = titleById.get(cid) || cid;
        b.addEventListener('click', () => { location.hash = `#/case/${cid}`; });
        cases.appendChild(b);
      });
      row.appendChild(cases);
      col.appendChild(row);
    });
    box.appendChild(col);
  });
}

/* ---------- лайтбокс ---------- */

function openLightbox(media, i) {
  state.gallery = media;
  state.shot = i;
  paintShot();
  $('lightbox').hidden = false;
  $('lbClose').focus();
}

function paintShot() {
  const m = state.gallery[state.shot];
  if (!m) return;
  $('lbImg').src = m.src;
  $('lbImg').alt = m.caption || '';
  $('lbCap').textContent = `${m.caption || ''} · ${state.shot + 1} з ${state.gallery.length}`;
}

function stepShot(d) {
  if (!state.gallery.length) return;
  state.shot = (state.shot + d + state.gallery.length) % state.gallery.length;
  paintShot();
}

function closeLightbox() { $('lightbox').hidden = true; }

/* ---------- маршрутизація ---------- */

function setTab(name) {
  const cases = name === 'cases';
  $('tabCases').classList.toggle('is-active', cases);
  $('tabLinks').classList.toggle('is-active', !cases);
  $('tabCases').setAttribute('aria-selected', String(cases));
  $('tabLinks').setAttribute('aria-selected', String(!cases));
  $('viewCases').classList.toggle('is-visible', cases);
  $('viewCases').hidden = !cases;
  $('viewLinks').classList.toggle('is-visible', !cases);
  $('viewLinks').hidden = cases;
}

async function route() {
  const m = location.hash.match(/^#\/case\/([\w-]+)$/);
  const detail = $('caseDetail');
  const toolbar = $('listToolbar');
  const grid = $('caseGrid');

  if (m) {
    setTab('cases');
    toolbar.hidden = true;
    grid.hidden = true;
    detail.hidden = false;
    $('backBtn').hidden = false;
    $('crumbs').textContent = 'Кейси → розбір';
    await renderCase(m[1]);
    detail.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (location.hash === '#/links') {
    setTab('links');
    $('backBtn').hidden = true;
    $('crumbs').textContent = 'Звʼязки з екосистемою';
    return;
  }

  setTab('cases');
  toolbar.hidden = false;
  grid.hidden = false;
  detail.hidden = true;
  $('backBtn').hidden = true;
  $('crumbs').textContent = `Кейсів у блокноті: ${state.index.length}`;
}

/* ---------- старт ---------- */

async function init() {
  const [idx, links] = await Promise.all([
    getJSON('data/cases.json'),
    getJSON('data/links.json'),
  ]);
  state.index = idx.cases || [];
  state.links = links || {};
  state.index.forEach((c) => (c.tags || []).forEach((t) => state.tags.add(t)));

  const totals = state.index.reduce((a, c) => {
    a.media += c.counts.media;
    a.open += c.counts.open;
    a.links += c.counts.achi + c.counts.packages + c.counts.positions + c.counts.rules;
    return a;
  }, { media: 0, open: 0, links: 0 });
  $('statCases').textContent = state.index.length;
  $('statLinks').textContent = totals.links;
  $('statMedia').textContent = totals.media;
  $('statOpen').textContent = totals.open;

  renderTags();
  renderList();
  renderLinks();

  $('caseSearch').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderList();
  });
  $('tabCases').addEventListener('click', () => { location.hash = ''; route(); });
  $('tabLinks').addEventListener('click', () => { location.hash = '#/links'; });
  $('backBtn').addEventListener('click', () => { location.hash = ''; route(); });
  $('lbClose').addEventListener('click', closeLightbox);
  $('lbPrev').addEventListener('click', () => stepShot(-1));
  $('lbNext').addEventListener('click', () => stepShot(1));
  $('lightbox').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if ($('lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepShot(-1);
    if (e.key === 'ArrowRight') stepShot(1);
  });
  window.addEventListener('hashchange', route);
  route();
}

init().catch((e) => {
  console.error(e);
  $('caseGrid').appendChild(el('p', 'bl-empty', 'Не вдалося завантажити дані блокнота.'));
});
