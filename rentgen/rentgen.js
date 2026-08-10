/* ============================================================
   Розділ «Рентген та ДІВ»

   Три принципи, від яких тут усе залежить:
   1. Спершу питання, потім акти. Стартовий екран — розбори рішень
      («чи вводити пересувний мамограф»), а не перелік наказів. Норми
      лежать на третій вкладці й відкриваються з кроку розбору.
   2. Кожен екран має адресу. Усе, що відкривається, змінює hash:
      #/case/…, #/pkg/…, #/doc/…. Тому кнопка «назад» у браузері працює,
      а посилання на конкретний пункт акта можна кинути в лист.
   3. Дерево, а не шеренга фільтрів; читалка, а не нарізка. Структура
      видна одразу, кожен вузол має підпис, документ показується суцільним
      текстом із якорями.
   ============================================================ */
(() => {
  'use strict';

  const DATA = 'data/';
  const MAX_NODES_COLLAPSED = 14;   // скільки вузлів показати до «показати всі»

  const state = {
    index: null,
    search: null,
    packages: null,
    // Аналітичний шар: розбори рішень і паспорт оплати пакета. Необов'язковий —
    // якщо файла немає, розділ працює як довідник без вкладки «Рішення».
    analytics: null,
    // Майбутні зміни: акт опубліковано, але він ще не діє. Текст акта в
    // корпусі лишається чинною редакцією — накладка лише позначає пункти,
    // які зміняться, і показує майбутню редакцію поруч. Див.
    // 17_рентген_НПБ/build_pending.py.
    pending: null,
    docCache: new Map(),
    openKey: null,
    chip: 'all',
    query: '',
    pmgOnly: false,
    expanded: new Set(),
    route: { view: 'cases' },
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // нормалізація для пошуку: регістр + апострофи, яких в українських
  // текстах трапляється чотири різновиди
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[’'`ʼ]/g, "'");

  const money = (n) => n.toLocaleString('uk-UA', { minimumFractionDigits: 2,
                                                  maximumFractionDigits: 2 });

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

  /* ================= маршрутизація ================= */

  /* Один екран — одна адреса. Без цього розділ мав ваду, за яку його й
     лаяли: акт розкривався, а повернутися до попереднього стану було нічим —
     «назад» виводило зі сторінки. */
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    if (!h) return { view: 'cases' };
    const [a, b, c] = h.split('/');
    if (a === 'norms') return { view: 'norms' };
    if (a === 'pkg') return { view: 'pkg', num: b || null };
    if (a === 'case') return { view: 'cases', caseId: b || null };
    if (a === 'doc') return { view: 'norms', key: b || null, node: c || null };
    // Чужий якір (портальне «↑ Верх» — це #top) не має скидати екран:
    // інакше кнопка «нагору» викидала б із відкритого акта на стартову.
    return { ...state.route };
  }

  const routeHash = (r) => {
    if (r.view === 'norms') return r.key ? `#/doc/${r.key}${r.node ? '/' + r.node : ''}` : '#/norms';
    if (r.view === 'pkg') return r.num ? `#/pkg/${r.num}` : '#/pkg';
    return r.caseId ? `#/case/${r.caseId}` : '#/';
  };

  const go = (hash) => { location.hash = hash; };

  function crumbs(route) {
    const trail = [{ label: '🧭 Рішення', hash: '#/' }];
    if (route.view === 'cases' && route.caseId) {
      const c = caseById(route.caseId);
      trail.push({ label: c ? c.title : route.caseId });
    }
    if (route.view === 'pkg') {
      trail.length = 0;
      trail.push({ label: '🩻 Пакети', hash: '#/pkg' });
      if (route.num) {
        const p = state.packages.packages.find((x) => x.number === route.num);
        trail.push({ label: `Пакет ${route.num}${p ? ' · ' + shortTitle(p.title) : ''}` });
      }
    }
    if (route.view === 'norms') {
      trail.length = 0;
      trail.push({ label: '📖 Норми', hash: '#/norms' });
      if (route.key) {
        const d = state.index.documents.find((x) => x.key === route.key);
        trail.push({ label: d ? `${d.kind} № ${d.num}` : route.key });
      }
    }
    const html = trail.map((t, i) => {
      const last = i === trail.length - 1;
      const el = t.hash && !last
        ? `<a href="${esc(t.hash)}">${esc(t.label)}</a>`
        : `<span>${esc(t.label)}</span>`;
      return el + (last ? '' : '<i aria-hidden="true">›</i>');
    }).join('');
    $('crumbs').innerHTML = html;
    // «Назад» показуємо лише там, де є куди повертатися всередині розділу
    $('backBtn').hidden = trail.length < 2;
  }

  const shortTitle = (t) => {
    const s = t.charAt(0) + t.slice(1).toLowerCase();
    return s.length > 42 ? s.slice(0, 40).trim() + '…' : s;
  };

  const caseById = (id) =>
    (state.analytics ? state.analytics.cases : []).find((c) => c.id === id) || null;

  const casesForPackage = (num) =>
    (state.analytics ? state.analytics.cases : []).filter((c) => c.package === num);

  async function applyRoute() {
    const r = parseHash();
    state.route = r;
    const view = r.view;
    [['viewCases', 'cases'], ['viewPkg', 'pkg'], ['viewNorms', 'norms']].forEach(([id, v]) => {
      $(id).classList.toggle('is-visible', view === v);
      $(id).hidden = view !== v;
    });
    [['tabCases', 'cases'], ['tabPkg', 'pkg'], ['tabNorms', 'norms']].forEach(([id, v]) => {
      $(id).classList.toggle('is-active', view === v);
      $(id).setAttribute('aria-selected', String(view === v));
    });
    crumbs(r);

    if (view === 'cases') {
      if (r.caseId) renderCase(r.caseId);
      else renderCaseList();
    } else if (view === 'pkg') {
      renderPackages();
      if (r.num) openPackage(r.num);
      else resetPkgDetail();
    } else {
      renderTree();
      if (r.key) await openDoc(r.key, r.node);
      else resetReader();
    }
    // Нагору — крім переходу на конкретний пункт: там прокручує gotoNode,
    // і два скроли підряд дали б смикання.
    if (!r.node) window.scrollTo(0, 0);
  }

  /* ================= вкладка «Рішення» ================= */

  const TONE_ICON = { ok: '✔', warn: '▲', risk: '■' };
  const LEVEL_LABEL = { high: 'високий', mid: 'середній', low: 'низький' };

  function renderCaseList() {
    const host = $('caseGrid');
    host.hidden = false;
    $('caseDetail').hidden = true;
    $('casesLead').hidden = false;
    if (!state.analytics) {
      host.innerHTML = '<div class="rt-loading">Аналітичний шар не завантажився.</div>';
      return;
    }
    host.innerHTML = state.analytics.cases.map((c) => `
      <button class="rt-case" type="button" data-act="case" data-id="${esc(c.id)}">
        <span class="rt-case-ico" aria-hidden="true">${esc(c.icon)}</span>
        <span class="rt-case-body">
          <span class="rt-case-q">${esc(c.question)}</span>
          <span class="rt-case-verdict tone-${esc(c.verdict.tone)}">
            ${esc(TONE_ICON[c.verdict.tone] || '•')} ${esc(c.verdict.headline)}</span>
          <span class="rt-case-meta">
            <b>Пакет ${esc(c.package)}</b>
            <span>${c.steps.length} ${plural(c.steps.length, 'крок', 'кроки', 'кроків')}</span>
            <span>${c.risks.length} ${plural(c.risks.length, 'ризик', 'ризики', 'ризиків')}</span>
            ${c.money ? `<span>${esc(money(c.money.rate))} грн ${esc(c.money.unit)}</span>` : ''}
          </span>
        </span>
        <span class="rt-case-go" aria-hidden="true">→</span>
      </button>`).join('');
  }

  function locksHTML(v) {
    return `<div class="rt-verdict tone-${esc(v.tone)}">
      <div class="rt-verdict-head">${esc(TONE_ICON[v.tone] || '•')} ${esc(v.headline)}</div>
      <div class="rt-locks">${v.locks.map((l) => `
        <div class="rt-lock tone-${esc(l.tone)}">
          <div class="rt-lock-t">${esc(l.title)}</div>
          <div class="rt-lock-x">${esc(l.text)}</div>
        </div>`).join('')}</div>
    </div>`;
  }

  function stepsHTML(steps) {
    return `<ol class="rt-steps">${steps.map((s) => `
      <li class="rt-step${s.optional ? ' is-opt' : ''}">
        <div class="rt-step-n">${s.n}</div>
        <div class="rt-step-main">
          <div class="rt-step-t">${esc(s.title)}${
            s.optional ? '<span class="rt-step-opt">лише для однієї гілки</span>' : ''}</div>
          <div class="rt-step-facts">
            <span><b>Хто:</b> ${esc(s.who)}</span>
            <span><b>Строк:</b> ${esc(s.term)}</span>
            <span><b>Результат:</b> ${esc(s.out)}</span>
          </div>
          <div class="rt-step-x">${esc(s.text)}</div>
          ${s.docs.length ? `<div class="rt-step-docs">${s.docs.map((d) => `
            <a class="rt-normlink" href="#/doc/${esc(d.key)}${d.node ? '/' + esc(d.node) : ''}">
              ${esc(d.label)} →</a>`).join('')}</div>` : ''}
        </div>
      </li>`).join('')}</ol>`;
  }

  function moneyHTML(m) {
    if (!m) return '';
    const total = m.rate * m.calc.per_day * m.calc.days;
    return `<div class="rt-moneybox">
      <div class="rt-money-rate">
        <b>${esc(money(m.rate))} грн</b><span>${esc(m.unit)}</span>
        <i>${esc(m.source)}</i>
      </div>
      <div class="rt-money-rules">
        <p>${esc(m.planned)}</p>
        <p>${esc(m.fact)}</p>
        <p class="rt-money-flag">${esc(m.extra)}</p>
      </div>
      <div class="rt-calc" data-rate="${m.rate}">
        <div class="rt-calc-cap">Прикинути обсяг</div>
        <label>досліджень на день
          <input type="number" min="0" max="200" step="1" id="calcDay" value="${m.calc.per_day}"></label>
        <label>виїзних днів на місяць
          <input type="number" min="0" max="31" step="1" id="calcDays" value="${m.calc.days}"></label>
        <div class="rt-calc-out">
          <span id="calcCount">${m.calc.per_day * m.calc.days}</span> досліджень ·
          <b id="calcSum">${money(total)}</b> грн на місяць
        </div>
        <div class="rt-calc-note">Це виручка за тарифом, а не прибуток: пальне,
          бригада й амортизація в ставку не закладені.</div>
      </div>
    </div>`;
  }

  function exemptHTML() {
    const e = state.analytics.exempt;
    return `<div class="rt-exempt">
      <div class="rt-exempt-head">
        <b>${esc(e.act.label)}</b> — 15 типів мамографів, звільнених від ліцензування
        <span class="rt-badge ok">чинний · ред. ${esc(e.act.revision)}</span>
      </div>
      <ol class="rt-exempt-list">${e.mammographs.map((m) =>
        `<li>${esc(m)}</li>`).join('')}</ol>
      <div class="rt-exempt-foot">
        <div><b>Ще в переліку:</b> ${e.other_groups.map(esc).join('; ')}.</div>
        <div><b>Ніколи не звільняються:</b> ${e.never.map(esc).join('; ')}.</div>
        <div class="rt-warnline">${esc(e.act.note)}</div>
      </div>
    </div>`;
  }

  function renderCase(id) {
    const c = caseById(id);
    const host = $('caseDetail');
    const grid = $('caseGrid');
    if (!c) { go('#/'); return; }
    grid.hidden = true;
    host.hidden = false;
    $('casesLead').hidden = true;

    const pkg = state.packages.packages.find((p) => p.number === c.package);
    const pay = state.analytics.payment[c.package];

    host.innerHTML = `
      <div class="rt-case-head">
        <div class="rt-doc-kind">Розбір рішення · пакет ${esc(c.package)}${
          pkg ? ' · ' + esc(shortTitle(pkg.title)) : ''}</div>
        <h2 class="rt-doc-title">${esc(c.question)}</h2>
        <p class="rt-case-lead">${esc(c.lead)}</p>
        <div class="rt-case-links">
          <a class="rt-normlink" href="#/pkg/${esc(c.package)}">Дозволи пакета ${esc(c.package)} →</a>
          ${pay ? `<span class="rt-tag">Оплата: ${esc(pay.model || 'глава ' + pay.chapter +
            ' постанови № 1808')}</span>` : ''}
        </div>
      </div>

      ${locksHTML(c.verdict)}

      <h3 class="rt-h3">Порядок дій</h3>
      ${stepsHTML(c.steps)}

      ${c.money ? '<h3 class="rt-h3">Гроші</h3>' + moneyHTML(c.money) : ''}

      <h3 class="rt-h3">Що це змінює для пакета</h3>
      <div class="rt-impact">${c.impact.map((i) => `
        <div class="rt-imp"><div class="rt-imp-t">${esc(i.title)}</div>
          <div class="rt-imp-x">${esc(i.text)}</div></div>`).join('')}</div>

      <h3 class="rt-h3">Ризики і прогалини</h3>
      <div class="rt-risks">${c.risks.map((r) => `
        <div class="rt-risk lvl-${esc(r.level)}">
          <div class="rt-risk-t"><span>${esc(LEVEL_LABEL[r.level] || r.level)}</span>
            ${esc(r.title)}</div>
          <div class="rt-risk-x">${esc(r.text)}</div>
        </div>`).join('')}</div>

      ${c.show_exempt_list ? '<h3 class="rt-h3">Перелік типів</h3>' + exemptHTML() : ''}

      <h3 class="rt-h3">Підстави</h3>
      <div class="rt-srcs">${c.sources.map((s) => `
        <a class="rt-src" href="#/doc/${esc(s.key)}${s.node ? '/' + esc(s.node) : ''}">
          ${esc(s.label)}</a>`).join('')}</div>`;

    wireCalc();
  }

  function wireCalc() {
    const box = document.querySelector('.rt-calc');
    if (!box) return;
    const rate = Number(box.dataset.rate);
    const recalc = () => {
      const n = Math.max(0, Number($('calcDay').value) || 0) *
                Math.max(0, Number($('calcDays').value) || 0);
      $('calcCount').textContent = n;
      $('calcSum').textContent = money(n * rate);
    };
    $('calcDay').addEventListener('input', recalc);
    $('calcDays').addEventListener('input', recalc);
  }

  /* ================= дерево документів ================= */

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
          <a class="rt-doc-btn" href="#/doc/${esc(d.key)}">
            <span class="rt-doc-num">${esc(d.kind)} № ${esc(d.num)}</span>
            <span class="rt-doc-name">${highlight(d.title, state.query)}${dead}</span>
          </a>
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
    let doc;
    try { doc = await getDoc(key); } catch { return; }
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
      <a class="rt-node lvl-${n.level}" href="#/doc/${esc(key)}/${esc(n.id)}"
         data-id="${esc(n.id)}">
        <b>${esc(n.label)}</b> · ${highlight(n.title, state.query)}
      </a>`).join('') +
      (nodes.length > shown.length
        ? `<button class="rt-node-more" type="button" data-act="more" data-key="${esc(key)}">
             ↓ показати всі (${nodes.length})</button>`
        : '');
  }

  /* ================= читалка ================= */

  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    return b === 1 ? one : many;
  };

  const ACTION_TAG = {
    replace: 'нова редакція',
    amend: 'зміна',
    add: 'доповнення',
    delete: 'виключається',
  };

  function pendingFor(key) {
    const p = state.pending;
    return p && p.doc === key && p.act.status === 'pending' ? p : null;
  }

  function pendingBoxHTML(p) {
    const a = p.act;
    const c = p.counts;
    // Три пункти живуть у корпусі всередині сусідніх (rada не виділяє
    // 9-1, 26-1 і 26-2 окремими вузлами) — про них кажемо окремим рядком,
    // інакше вони просто зникли б із переліку змін.
    const orphans = p.changes.filter((x) => !x.node);
    return `<div class="rt-pending">
      <div class="rt-pending-cap">⏳ Акт змінюється: ${esc(a.kind || 'постанова КМУ')}
        № ${esc(a.number)} від ${esc(a.date)}</div>
      <div class="rt-pending-body">
        <p>${esc(a.status_note)}</p>
        <p><b>Набирає чинності ${esc(a.effective_from)}.</b> Опубліковано:
          ${esc(a.published)}. Зачеплено <b>${c.nodes_touched}</b> ${
            plural(c.nodes_touched, 'пункт', 'пункти', 'пунктів')}
          із ${c.nodes_total}: нових редакцій — ${c.by_action.replace || 0},
          точкових змін — ${c.by_action.amend || 0},
          доповнень — ${c.by_action.add || 0},
          виключено — ${c.by_action.delete || 0}.</p>
        ${orphans.length ? `<p class="rt-pending-orphan">Ще ${orphans.length}
          зміни стосуються пунктів, які rada не подає окремими вузлами
          (${esc(orphans.map((o) => o.point).join(', '))}) — їх видно лише
          в тексті самої постанови.</p>` : ''}
        <a href="${esc(a.url)}" target="_blank" rel="noopener">Текст постанови
          № ${esc(a.number)} на zakon.rada ↗</a>
      </div>
    </div>`;
  }

  function changeHTML(ch) {
    const scope = ch.scope ? `<span class="rt-ch-scope">${esc(ch.scope)}</span>` : '';
    const now = ch.now
      ? `<div class="rt-ch-now"><div class="rt-ch-now-cap">Редакція з ${
          esc(state.pending.act.effective_from)}</div>${
          esc(ch.now).replace(/\n/g, '<br>')}</div>`
      : '';
    const link = ch.link
      ? `<a class="rt-ch-link" href="${esc(ch.link.href)}">${esc(ch.link.text)} →</a>`
      : '';
    return `<div class="rt-change">
      <div class="rt-ch-head">${esc(ACTION_TAG[ch.action] || ch.action)}${scope}</div>
      <div class="rt-ch-sum">${esc(ch.summary)}</div>
      ${now}${link}
    </div>`;
  }

  function resetReader() {
    state.openKey = null;
    $('reader').innerHTML = `<div class="rt-empty">
      <div class="rt-empty-ico" aria-hidden="true">📖</div>
      <h2>Оберіть акт зліва</h2>
      <p>Документ відкриється суцільним текстом — так, як він читається, а не
      нарізкою на фрагменти. Кожен акт має власну адресу, тож посилання на
      пункт можна кинути в лист.</p></div>`;
  }

  async function openDoc(key, scrollToId) {
    state.openKey = key;
    let doc;
    try {
      doc = await getDoc(key);
    } catch (err) {
      // Мовчазна порожня читалка — найгірший варіант: людина думає, що акт
      // порожній. Кажемо прямо і даємо кнопку, бо це майже завжди мережа.
      $('reader').innerHTML = `<div class="rt-alert">
        <b>Текст акта не завантажився.</b><br>${esc(err.message)}.
        <button class="rt-chip" type="button" data-act="retry" data-key="${esc(key)}"
                style="margin-top:10px">Спробувати ще раз</button></div>`;
      return;
    }
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
    // Простирадло «Із змінами, внесеними згідно з…» ховаємо під підпис: воно
    // потрібне разів на десять відкриттів, а місця з'їдає більше за преамбулу.
    if (m.amendments_raw) {
      html += `<details class="rt-fold"><summary>Перелік змін до акта</summary>
        <div class="rt-amend">${esc(m.amendments_raw)}</div></details>`;
    }

    const pend = pendingFor(key);
    if (pend) html += pendingBoxHTML(pend);

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
    const byNode = new Map();
    if (pend) pend.changes.forEach((c) => c.node && byNode.set(c.node, c));

    html += shown.map((n) => {
      const ch = byNode.get(n.id);
      return `
      <section class="rt-sec lvl-${n.level}${n.pmg && part ? ' is-pmg' : ''}${
        ch ? ' is-pending pend-' + esc(ch.action) : ''}" id="sec-${esc(n.id)}">
        <div class="rt-sec-head">
          <span class="rt-sec-num">${esc(n.label)}</span>
          <span class="rt-sec-title">${highlight(n.title, state.query)}</span>
          ${ch ? `<span class="rt-pend-tag">${esc(ACTION_TAG[ch.action] || ch.action)} з ${
            esc(pend.act.effective_from)}</span>` : ''}
        </div>
        <div class="rt-sec-body">${highlight(n.text, state.query)}</div>
        ${ch ? changeHTML(ch) : ''}
      </section>`;
    }).join('');

    $('reader').innerHTML = html;
    renderTree();
    if (scrollToId) gotoNode(scrollToId);
  }

  function gotoNode(id) {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    document.querySelectorAll('.rt-sec.is-hit').forEach((e) => e.classList.remove('is-hit'));
    el.classList.add('is-hit');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelectorAll('.rt-node.is-current').forEach((e) => e.classList.remove('is-current'));
    const btn = document.querySelector(`.rt-node[data-id="${CSS.escape(id)}"]`);
    if (btn) btn.classList.add('is-current');
  }

  /* ================= пакети → дозвіл ================= */

  function renderPackages() {
    const host = $('pkgList');
    host.innerHTML = state.packages.packages.map((p) => {
      const cls = p.classes.map((c) =>
        `<span class="rt-cls ${esc(c)}">${esc(clsTitle(c))}</span>`).join('');
      const cur = state.route.num === p.number ? ' is-current' : '';
      return `<a class="rt-pkg-btn${cur}" href="#/pkg/${esc(p.number)}">
        <span class="rt-pkg-n">${esc(p.number)}</span>
        <span><span class="rt-pkg-name">${esc(shortTitle(p.title))}</span><br>${cls}</span>
      </a>`;
    }).join('');
    $('pkgCount').textContent = state.packages.packages.length;
  }

  function clsTitle(key) {
    const c = state.packages.classes.find((x) => x.key === key);
    return c ? c.title : key;
  }

  function resetPkgDetail() {
    $('pkgDetail').innerHTML = `<div class="rt-empty">
      <div class="rt-empty-ico" aria-hidden="true">🩻</div>
      <h2>Оберіть пакет</h2>
      <p>Для кожного пакета — обладнання-ДІВ, коди ЕСОЗ і повний ланцюжок
      дозволів. Нечинні акти позначено, щоб вони не потрапили в лист.</p></div>`;
  }

  function openPackage(num) {
    const p = state.packages.packages.find((x) => x.number === num);
    if (!p) { go('#/pkg'); return; }
    const pay = state.analytics ? state.analytics.payment[num] : null;
    const cases = casesForPackage(num);

    let html = `<div class="rt-doc-head">
      <div class="rt-doc-kind">Пакет ${esc(p.number)} · ПМГ-2026</div>
      <h2 class="rt-doc-title">${esc(shortTitle(p.title))}</h2>
      <div class="rt-meta">${p.classes.map((c) =>
        `<span class="rt-cls ${esc(c)}">${esc(clsTitle(c))}</span>`).join('')}</div>
    </div>`;

    // Верхні плитки: три числа, за якими зазвичай і приходять.
    html += `<div class="rt-tiles">
      <div class="rt-tile"><span>${esc(p.equipment.length)}</span>
        ${plural(p.equipment.length, 'позиція обладнання', 'позиції обладнання',
                 'позицій обладнання')}</div>
      <div class="rt-tile"><span>${esc(p.permits.length)}</span>
        ${plural(p.permits.length, 'дозвільний блок', 'дозвільні блоки',
                 'дозвільних блоків')}</div>
      ${pay ? `<div class="rt-tile rt-tile-wide"><span>Глава ${esc(pay.chapter)}</span>
        ${esc(pay.model || 'постанови КМУ № 1808')}</div>` : ''}
    </div>`;

    if (cases.length) {
      html += `<div class="rt-caselinks">${cases.map((c) =>
        `<a class="rt-caselink" href="#/case/${esc(c.id)}">
           <b>${esc(c.icon)} ${esc(c.title)}</b>
           <span>${esc(c.question)}</span></a>`).join('')}</div>`;
    }

    html += `<h3 class="rt-h3">Обладнання з ДІВ у вимогах пакета</h3>
      <ul class="rt-eq">${p.equipment.map((e) => `
        <li>
          <div class="rt-eq-name">${esc(e.name)}</div>
          ${e.esoz && e.esoz.length ? `
            <div class="rt-eq-esoz">
              <div class="rt-eq-esoz-cap">Код для Реєстру суб'єктів господарювання
                (${esc(state.packages.esoz_source.act)}):</div>
              ${e.esoz.map((z) => `<div class="rt-esoz">
                 <code>${esc(z.code)}</code><span>${esc(z.name)}</span></div>`).join('')}
              ${e.esoz.length > 1
                ? '<div class="rt-eq-hint">Вимога сформульована описово, тож типів у Переліку кілька — заклад вносить той, що відповідає фактичному апарату.</div>'
                : ''}
            </div>` : `
            <div class="rt-eq-hint">У Переліку за наказом № 697 такого типу немає — код ЕСОЗ не передбачено.</div>`}
        </li>`).join('')}</ul>`;

    html += `<h3 class="rt-h3">Дозвільні блоки</h3>`;
    // Кожен блок згорнутий: розгорнутими сімома простирадлами сторінку й
    // ганили. Видно назву й акти; пояснення — під підписом.
    html += p.permits.map((pm) => `
      <details class="rt-permit">
        <summary>
          <span class="rt-permit-title">${esc(pm.title)}</span>
          <span class="rt-permit-count">${pm.docs.length} ${
            plural(pm.docs.length, 'акт', 'акти', 'актів')}${
            pm.docs.some((d) => !d.in_force) ? ' · ❗ є нечинний' : ''}</span>
        </summary>
        <div class="rt-permit-note">${esc(pm.note)}</div>
        <div class="rt-permit-docs">${pm.docs.map((d) => `
          <a class="rt-permit-doc${d.in_force ? '' : ' dead'}" href="#/doc/${esc(d.key)}">
            <span>${esc(d.kind)} № ${esc(d.num)}</span>
            <span>${esc(d.title)}</span>
            ${d.in_force ? '' : '<span class="rt-dead">❗ нечинний</span>'}
          </a>`).join('')}</div>
      </details>`).join('');

    const notes = p.classes.map((c) => {
      const info = state.packages.classes.find((x) => x.key === c);
      return info ? `<li><b>${esc(info.title)}.</b> ${esc(info.note)}</li>` : '';
    }).join('');
    if (notes) {
      html += `<details class="rt-fold"><summary>Чому саме такий набір дозволів</summary>
        <div class="rt-amend"><ul style="margin:0;padding-left:18px">${notes}</ul></div></details>`;
    }

    $('pkgDetail').innerHTML = html;
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
      } else if (act === 'pmgonly') {
        state.pmgOnly = !state.pmgOnly;
        openDoc(state.openKey);
      } else if (act === 'case') {
        go(`#/case/${t.dataset.id}`);
      } else if (act === 'retry') {
        state.docCache.delete(t.dataset.key);
        openDoc(t.dataset.key, state.route.node);
      }
    });

    $('backBtn').addEventListener('click', () => {
      if (history.length > 1) history.back();
      else go(state.route.view === 'norms' ? '#/norms'
             : state.route.view === 'pkg' ? '#/pkg' : '#/');
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

    document.querySelectorAll('.rt-chip[data-chip]').forEach((c) => {
      c.addEventListener('click', () => {
        document.querySelectorAll('.rt-chip[data-chip]').forEach((x) => x.classList.remove('is-on'));
        c.classList.add('is-on');
        state.chip = c.dataset.chip;
        renderTree();
      });
    });

    $('tabCases').addEventListener('click', () => go('#/'));
    $('tabPkg').addEventListener('click', () => go('#/pkg'));
    $('tabNorms').addEventListener('click', () => go('#/norms'));

    window.addEventListener('hashchange', applyRoute);

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== $('q') &&
          state.route.view === 'norms') { e.preventDefault(); $('q').focus(); }
    });
  }

  /* ================= старт ================= */

  async function init() {
    try {
      const [index, search, packages, pending, analytics] = await Promise.all([
        getJSON(`${DATA}index.json`),
        getJSON(`${DATA}search.json`),
        getJSON(`${DATA}packages_div.json`),
        // Накладки необов'язкові: якщо жодного акта на підході немає, файла
        // просто не буде, і розділ має працювати як раніше.
        getJSON(`${DATA}pending_amendments.json`).catch(() => null),
        getJSON(`${DATA}analytics.json`).catch(() => null),
      ]);
      state.index = index;
      state.search = search;
      state.packages = packages;
      state.pending = pending;
      state.analytics = analytics;

      $('statDocs').textContent = index.documents.length;
      $('statNodes').textContent = index.built_nodes.toLocaleString('uk-UA');
      $('statPkg').textContent = packages.packages.length;
      $('statCases').textContent = analytics ? analytics.cases.length : '—';
      if (!analytics) $('tabCases').hidden = true;

      wire();
      await applyRoute();
    } catch (err) {
      $('tree').innerHTML = `<div class="rt-loading">Не вдалося завантажити дані: ${esc(err.message)}</div>`;
      console.error(err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
