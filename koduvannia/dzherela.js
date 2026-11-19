/* Джерела довідників (код, обладнання, кадри) — сторінка порталу.
 *
 * Дані: data/sources.json          рівні, джерела, відомі розбіжності
 *       data/sources_journal.json  журнал правок (вантажиться, коли його відкрили)
 * Обидва збирає tools/sources_public.py з реєстру джерел. Сторінка нічого не рахує
 * сама: вона лише показує те, що знайшла звірка джерел під час збірки.
 */
(function () {
  'use strict';

  const DATA_V = '20261119b';           // піднімати разом із перезбіркою даних
  const KIND = {
    normative: 'нормативний акт',
    nszu: 'документ НСЗУ',
    reference: 'довідково, не підстава для оплати',
    reconstruction: 'відновлено з даних',
    own: 'ведеться відділом',
  };
  const FIX = { homoglyph: 'латинська літера в слові', 'cyr-code': 'кирилиця в коді' };
  const JOURNAL_CAP = 200;
  // назви файлів даних у переліку розбіжностей → людські назви
  const FILE_LABEL = {
    resolution_1808: 'Постанова № 1808 (2026 рік), дані розділу «Постанова»',
    resolution_1503: 'Постанова № 1503 (2025 рік)',
    comparison_2025_2026: 'Порівняння постанов 2025 ↔ 2026',
  };
  const groupLabel = (g) => {
    const key = g.replace(/\.json$/, '').replace(/^.*\//, '');
    return FILE_LABEL[key] || key;
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n) => Number(n).toLocaleString('uk-UA');
  const norm = (s) => (window.PMG_SEARCH ? window.PMG_SEARCH.text(s) : String(s).toLowerCase());

  let DB = null;
  let JOURNAL = null;
  const SRC = {};

  function sourceCard(s) {
    const rows = [];
    if (s.canon) rows.push(['Головне для', esc(s.canon)]);
    if (s.edition) rows.push(['Редакція', esc(s.edition)]);
    if (s.built) rows.push(['Дані зібрано', esc(s.built)]);
    if (s.facts && s.facts.length) {
      rows.push(['Обсяг', '<span class="dz-facts">' +
        s.facts.map(([k, v]) => `<span><b>${esc(v)}</b> ${esc(k)}</span>`).join('') + '</span>']);
    }
    if (s.fixes) {
      const kinds = Object.entries(s.fixes.kinds).map(([k, n]) => `${esc(FIX[k] || k)} — ${nf(n)}`).join('; ');
      rows.push(['Правок у журналі', `<a href="#dzJournal" data-journal="${esc(s.id)}">${nf(s.fixes.count)}</a> (${kinds})`]);
    }
    if (s.note) rows.push(['Застереження', esc(s.note)]);
    return `<span class="dz-kind dz-kind--${esc(s.kind)}">${esc(KIND[s.kind] || s.kind)}</span>
      <dl class="dz-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${s.readable ? `<a class="dz-open" href="../${esc(s.readable)}">Відкрити джерело на порталі →</a>` : ''}`;
  }

  function levelsHtml(levels) {
    return levels.map((lv) => {
      const s = SRC[lv.source];
      const sub = [s.edition, s.built ? 'зібрано ' + s.built : ''].filter(Boolean).join(' · ');
      return `<details class="dz-level">
        <summary>
          <span class="dz-n">${lv.n}</span>
          <span class="dz-lt">${esc(lv.title)}<span class="dz-lw">${esc(lv.what)}</span></span>
          <span class="dz-ls">${esc(s.title)}<span class="dz-le">${esc(sub)}</span></span>
          <span class="dz-chev" aria-hidden="true">›</span>
        </summary>
        <div class="dz-body">${sourceCard(s)}</div>
      </details>`;
    }).join('');
  }

  // Три ланцюжки: код, обладнання, кадри. У кожного — рівні й примітки до них.
  function renderChains() {
    const chains = DB.chains || [{ key: 'code', title: 'Код', question: '', levels: DB.levels }];
    $('dzChains').innerHTML = chains.map((ch) => {
      const inChain = new Set(ch.levels.map((lv) => lv.source));
      const notes = DB.sources.filter((s) => (s.chain || 'code') === ch.key && !inChain.has(s.id));
      const path = ch.levels.map((lv) => esc(lv.title)).join(' → ');
      return `<section class="dz-chainbox" id="dz-${esc(ch.key)}" aria-labelledby="dzH-${esc(ch.key)}">
        <h2 id="dzH-${esc(ch.key)}">${esc(ch.title)}${ch.question
          ? `<span class="dz-q">${esc(ch.question)}</span>` : ''}</h2>
        <p class="dz-sub">${path}</p>
        <div class="dz-chain">${levelsHtml(ch.levels)}</div>
        ${notes.length ? `<h3 class="dz-noteh">Примітки до рівнів</h3>
        <div class="dz-notes">${notes.map((s) =>
          `<article class="dz-note"><h3>${esc(s.title)}</h3>${
            s.role ? `<p class="dz-role">${esc(s.role)}</p>` : ''}${sourceCard(s)}</article>`).join('')}</div>` : ''}
      </section>`;
    }).join('');
    $('dzToc').innerHTML = chains.map((ch) =>
      `<a href="#dz-${esc(ch.key)}">${esc(ch.title)}<span>${ch.levels.length} ${
        ch.levels.length < 5 ? 'рівні' : 'рівнів'}</span></a>`).join('');
  }

  // «Таблиця співставлення: E12.62» → група «Таблиця співставлення», код «E12.62»
  function renderChecks() {
    $('dzChecks').innerHTML = DB.checks.map((c) => {
      const n = c.items.length;
      let body = c.about ? `<p>${esc(c.about)}</p>` : '';
      if (!n) {
        body += '<p>Розбіжностей немає.</p>';
      } else if (c.id === 'names') {
        body += '<ul class="dz-rows">' + c.items.map((it) =>
          `<li>${esc(it.k)}<small>${esc(it.n)}</small></li>`).join('') + '</ul>';
      } else {
        const groups = new Map();
        const loose = [];
        for (const it of c.items) {
          const i = it.k.indexOf(': ');
          const code = i > 0 ? it.k.slice(i + 2) : '';
          if (i > 0 && /^[\wА-ЯІЇЄҐ.\-]+$/.test(code)) {
            const g = it.k.slice(0, i);
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(it);
          } else {
            loose.push(it);
          }
        }
        for (const [g, items] of groups) {
          const why = [...new Set(items.map((it) => it.n))].join('; ');
          body += `<div class="dz-grp"><b>${esc(groupLabel(g))}</b> — ${nf(items.length)}
            <small class="dz-was">(${esc(why)})</small>
            <div class="dz-codes">${items.map((it) =>
              `<span class="dz-code" title="${esc(it.n)}">${esc(it.k.slice(it.k.indexOf(': ') + 2))}</span>`).join('')}</div></div>`;
        }
        if (loose.length) {
          body += '<ul class="dz-rows">' + loose.map((it) =>
            `<li>${esc(it.k)}${it.n ? `<small>${esc(it.n)}</small>` : ''}</li>`).join('') + '</ul>';
        }
      }
      return `<details class="dz-check">
        <summary><span class="dz-cnt${n ? '' : ' dz-cnt--zero'}">${nf(n)}</span><span>${esc(c.title)}</span></summary>
        <div class="dz-check-body">${body}</div>
      </details>`;
    }).join('');
  }

  // ── журнал ──
  function markDiff(was, now) {
    // підсвітити символи, що змінились (рядки однакової довжини — заміна літер)
    if (was.length !== now.length) return [esc(was), esc(now)];
    let a = '', b = '';
    for (let i = 0; i < was.length; i++) {
      if (was[i] === now[i]) { a += esc(was[i]); b += esc(now[i]); }
      else { a += `<mark>${esc(was[i])}</mark>`; b += `<mark>${esc(now[i])}</mark>`; }
    }
    return [a, b];
  }

  function renderJournal() {
    if (!JOURNAL) return;
    const src = $('dzJSrc').value, kind = $('dzJKind').value, q = norm($('dzJQ').value.trim());
    const rows = JOURNAL.rows.filter((r) =>
      (!src || r[0] === src) && (!kind || r[1] === kind) &&
      (!q || norm(r[2] + ' ' + r[3] + ' ' + r[4]).includes(q)));
    $('dzJCount').textContent = rows.length
      ? `Записів: ${nf(rows.length)}` + (rows.length > JOURNAL_CAP ? ` · показано перші ${JOURNAL_CAP}` : '')
      : 'Нічого не знайдено';
    $('dzJRows').innerHTML = rows.slice(0, JOURNAL_CAP).map((r) => {
      const [a, b] = markDiff(r[3], r[4]);
      const times = r[5] > 1 ? ` <span class="dz-was">× ${nf(r[5])}</span>` : '';
      return `<tr><td>${esc(shortTitle(r[0]))}</td><td>${esc(r[2])}</td>
        <td class="dz-was">${a}</td><td>${b}${times}</td></tr>`;
    }).join('');
  }

  function shortTitle(id) {
    return { nk025: 'НК 025', nk026: 'НК 026', mapping: 'Таблиця співставлення', letters: 'Листи НСЗУ' }[id] ||
      (SRC[id] ? SRC[id].title : id);
  }

  async function openJournal(preset) {
    const box = $('dzJournal');
    box.open = true;
    if (!JOURNAL) {
      $('dzJCount').textContent = 'Завантаження…';
      try {
        JOURNAL = await (await fetch(`data/sources_journal.json?v=${DATA_V}`)).json();
      } catch (e) {
        $('dzJCount').textContent = 'Не вдалося завантажити журнал. Оновіть сторінку.';
        return;
      }
      const ids = [...new Set(JOURNAL.rows.map((r) => r[0]))];
      $('dzJSrc').insertAdjacentHTML('beforeend',
        ids.map((id) => `<option value="${esc(id)}">${esc(shortTitle(id))}</option>`).join(''));
      const kinds = [...new Set(JOURNAL.rows.map((r) => r[1]))];
      $('dzJKind').insertAdjacentHTML('beforeend',
        kinds.map((k) => `<option value="${esc(k)}">${esc(FIX[k] || k)}</option>`).join(''));
    }
    if (preset !== undefined) $('dzJSrc').value = preset;
    renderJournal();
  }

  function renderStats() {
    const known = DB.checks.reduce((n, c) => n + c.items.length, 0);
    const cells = [
      [(DB.chains || [1]).length, 'ланцюжки'],
      [DB.sources.length, 'джерел'],
      [nf(DB.journalTotal), 'записів у журналі правок'],
      [nf(known), 'відомих розбіжностей'],
    ];
    $('dzStats').innerHTML = cells.map(([v, t]) =>
      `<div class="stat"><strong>${esc(v)}</strong><span>${esc(t)}</span></div>`).join('');
    $('dzJournalN').textContent = `${nf(DB.journalTotal)} записів`;
    const d = DB.generated.split('-').reverse().join('.');
    $('dzFoot').textContent = `Звірку джерел виконано ${d}. Нових розбіжностей немає.`;
  }

  async function init() {
    try {
      DB = await (await fetch(`data/sources.json?v=${DATA_V}`)).json();
    } catch (e) {
      $('dzChains').innerHTML = '<div class="dz-err">Не вдалося завантажити дані про джерела. Оновіть сторінку.</div>';
      return;
    }
    DB.sources.forEach((s) => { SRC[s.id] = s; });
    renderStats();
    renderChains();
    renderChecks();

    $('dzJournal').addEventListener('toggle', () => { if ($('dzJournal').open) openJournal(); });
    ['dzJSrc', 'dzJKind'].forEach((id) => $(id).addEventListener('change', renderJournal));
    $('dzJQ').addEventListener('input', renderJournal);
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-journal]');
      if (!a) return;
      e.preventDefault();
      openJournal(a.dataset.journal).then(() => $('dzJournal').scrollIntoView({ block: 'start' }));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
