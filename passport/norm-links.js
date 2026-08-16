/**
 * NormLinks — шар нормативного підкріплення на вкладці «Вимоги закупівлі».
 *
 * Для кожного пункту пакета показує рівень (A/B/C/D) і норму, на якій пункт
 * стоїть: реквізит акта, шлях до пункту та його текст.
 *
 * Дані: passport/data/norms/<номер пакета>.json — будуються пайплайном
 * passport/norms/ (див. README там же).
 *
 * Прив'язка йде за парою «розділ + порядковий номер», але перед показом
 * звіряється відбиток тексту. Якщо пакет перезібрали і текст пункту змінився,
 * значок не малюється взагалі — краще нічого, ніж прив'язка не до того пункту.
 */
(function () {
  'use strict';

  const CACHE = new Map();          // номер пакета → дані або null
  const LEVELS = {
    'A?': { cls: 'a', title: 'Пряма норма — кандидат на вичитку' },
    'B?': { cls: 'b', title: 'Галузевий стандарт — кандидат на вичитку' },
    'C?': { cls: 'c', title: 'Загальна норма — кандидат на вичитку' },
    'C':  { cls: 'c', title: 'Загальна норма (висновок за правилом)' },
    'D':  { cls: 'd', title: 'Підстави немає (висновок за правилом)' },
    '?':  { cls: 'q', title: 'Заголовок або надто короткий пункт' },
  };

  function key(t) {
    return String(t).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function load(pkgNum) {
    if (CACHE.has(pkgNum)) return CACHE.get(pkgNum);
    let data = null;
    try {
      const r = await fetch(`data/norms/${encodeURIComponent(pkgNum)}.json`, { cache: 'no-cache' });
      if (r.ok) data = await r.json();
    } catch (e) {
      data = null;                  // немає файлу — просто немає шару
    }
    CACHE.set(pkgNum, data);
    return data;
  }

  function entry(data, sectionKey, ord, text) {
    if (!data) return null;
    const list = data.sections && data.sections[sectionKey];
    if (!list) return null;
    const e = list.find(x => x.o === ord);
    if (!e) return null;
    return e.k === key(text) ? e : null;   // текст роз'їхався — мовчимо
  }

  function badge(e) {
    const meta = LEVELS[e.lv] || LEVELS['?'];
    const n = e.c.length;
    return `<button type="button" class="norm-badge norm-${meta.cls}"
      data-norm="1" title="${esc(meta.title)}${n ? ` · норм: ${n}` : ''}"
      aria-expanded="false">${esc(e.lv)}</button>`;
  }

  function panel(e) {
    const cands = e.c.length
      ? `<ol class="norm-list">${e.c.map(c => `
          <li class="norm-item">
            <div class="norm-head">
              <span class="norm-act">${esc(c.a)}</span>
              <span class="norm-path">${esc(c.p)}</span>
              <span class="norm-score">збіг ${esc(c.s)}</span>
            </div>
            <p class="norm-text">${esc(c.t)}</p>
          </li>`).join('')}</ol>`
      : '<p class="norm-none">Норми-кандидата в корпусі немає.</p>';
    return `<div class="norm-panel" hidden><p class="norm-note">${esc(e.note)}</p>${cands}</div>`;
  }

  function legend(data) {
    const s = data.stats || {};
    const order = ['A?', 'B?', 'C?', 'C', 'D', '?'];
    const chips = order.filter(k => s[k]).map(k =>
      `<span class="norm-chip norm-${LEVELS[k].cls}" title="${esc(LEVELS[k].title)}">
         ${esc(k)}<b>${s[k]}</b></span>`).join('');
    return `<div class="norm-legend">
      <p class="norm-legend-t">Нормативне підкріплення: зіставлено з
        <b>${data.nodes}</b> пунктами <b>${data.acts}</b> актів.
        Рівень зі знаком питання — пропозиція автомата на вичитку.</p>
      <div class="norm-chips">${chips}</div></div>`;
  }

  // Розкриття/згортання панелі — одним слухачем на контейнер
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-norm]');
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    const p = b.closest('.spec-item')?.querySelector('.norm-panel');
    if (!p) return;
    const open = p.hidden;
    p.hidden = !open;
    b.setAttribute('aria-expanded', String(open));
  });

  window.NormLinks = { load, entry, badge, panel, legend };
})();
