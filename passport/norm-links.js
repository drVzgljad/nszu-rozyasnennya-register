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
  // word — видимий підпис на значку: абревіатура сама по собі змушувала
  // чекати тултіп, тому рівень підписаний словами прямо в рядку
  const LEVELS = {
    'A':  { cls: 'a', word: 'пряма норма', title: 'Пряма норма: імперативний акт встановлює вимогу' },
    'B':  { cls: 'b', word: 'галузевий стандарт', title: 'Норма є в галузевому стандарті, пакет реквізиту не назвав' },
    'C':  { cls: 'c', word: 'загальна норма', title: 'Лише загальна норма (ліцумови тощо)' },
    'D':  { cls: 'd', word: 'без підстави', title: 'Профільної норми немає — вимога НСЗУ без наказу' },
    '?':  { cls: 'q', word: 'заголовок', title: 'Заголовок або уламок тексту, не вимога' },
    // рівні зі знаком питання — невичитані кандидати (якщо трапляться в даних)
    'A?': { cls: 'a', word: 'пряма норма?', title: 'Пряма норма — кандидат на вичитку' },
    'B?': { cls: 'b', word: 'галузевий стандарт?', title: 'Галузевий стандарт — кандидат на вичитку' },
    'C?': { cls: 'c', word: 'загальна норма?', title: 'Загальна норма — кандидат на вичитку' },
  };

  // Повні назви актів — випадають миттєвою легендою при наведенні на реквізит.
  // Ключ — номер акта; дата в реквізиті страхує від колізій номерів.
  const ACT_TITLES = [
    [/№\s*1936/, 'Про затвердження уніфікованого клінічного протоколу «Гострий коронарний синдром з елевацією сегмента ST»'],
    [/№\s*1957/, 'Про затвердження уніфікованого клінічного протоколу «Гострий коронарний синдром без елевації сегмента ST»'],
    [/№\s*1091/, 'Про затвердження Порядку організації надання медичної допомоги пацієнтам із гострим мозковим інсультом'],
    [/№\s*1070/, 'Про затвердження Стандарту медичної допомоги «Ішемічний інсульт»'],
    [/№\s*9\b/, 'Про затвердження Стандартів медичної допомоги «Надання допомоги при спонтанному внутрішньомозковому крововиливі»'],
    [/№\s*275\b/, 'Про затвердження та впровадження медико-технологічних документів зі стандартизації медичної допомоги при геморагічному інсульті'],
    [/№\s*586\b/, 'Про затвердження Порядку направлення пацієнтів до закладів охорони здоров’я та ФОП, які одержали ліцензію на провадження господарської діяльності з медичної практики'],
    [/№\s*587\b/, 'Деякі питання ведення Реєстру медичних записів, записів про направлення та рецептів в електронній системі охорони здоров’я'],
    [/№\s*592\b/, 'Про затвердження Порядку допуску відвідувачів до пацієнтів, які перебувають на стаціонарному лікуванні у відділенні інтенсивної терапії'],
    [/№\s*2559/, 'Про затвердження Порядку констатації та діагностичних критеріїв смерті мозку людини'],
    [/№\s*110\b/, 'Про затвердження форм первинної облікової документації та інструкцій щодо їх заповнення (форма 003/о — Медична карта стаціонарного хворого)'],
    [/№\s*1268/, 'Питання організації реабілітації у сфері охорони здоров’я'],
    [/№\s*285\b/, 'Про затвердження Ліцензійних умов провадження господарської діяльності з медичної практики'],
    [/№\s*333\b/, 'Деякі питання державного регулювання цін на лікарські засоби і вироби медичного призначення (Національний перелік основних ЛЗ)'],
    [/№\s*1614/, 'Про організацію профілактики інфекцій та інфекційного контролю в закладах охорони здоров’я'],
  ];

  function actTitle(ref) {
    const hit = ACT_TITLES.find(([re]) => re.test(ref));
    return hit ? hit[1] : '';
  }

  function key(t) {
    return String(t).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Підсвітка в тексті норми слів, спільних із пунктом пакета.
  // hl — основи слів пункта (6 символів, як у зіставлювачі), пораховані білдером.
  function markHtml(text, hl) {
    if (!hl || !hl.length) return esc(text);
    const set = new Set(hl);
    return String(text).split(/([А-Яа-яІіЇїЄєҐґA-Za-z’']+)/).map(tok => {
      if (!/^[А-Яа-яІіЇїЄєҐґA-Za-z’']/.test(tok)) return esc(tok);
      const clean = tok.toLowerCase().replace(/[^а-яіїєґa-z0-9]/g, '');
      return clean.length >= 4 && set.has(clean.slice(0, 6))
        ? `<mark class="norm-hl">${esc(tok)}</mark>` : esc(tok);
    }).join('');
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

  function entry(data, sectionKey, ord, text, precomputedKey) {
    if (!data) return null;
    const list = data.sections && data.sections[sectionKey];
    if (!list) return null;
    const e = list.find(x => x.o === ord);
    if (!e) return null;
    // precomputedKey — відбиток чистого тексту пакета, знятий ДО того, як
    // SpecLinks домалює в DOM свої мітки (інакше «аналізаторЕСОЗ 8 кодів»
    // не збігається і значок зникає)
    return e.k === (precomputedKey || key(text)) ? e : null;
  }

  function badge(e) {
    const meta = LEVELS[e.lv] || LEVELS['?'];
    const n = e.c.length;
    return `<button type="button" class="norm-badge norm-${meta.cls}"
      data-norm="1" title="${esc(meta.title)}${n ? ` · норм: ${n}` : ''}"
      aria-expanded="false">${esc(e.lv)}<span class="norm-bw"> ${esc(meta.word)}</span></button>`;
  }

  function panel(e) {
    const cands = e.c.length
      ? `<ol class="norm-list">${e.c.map(c => `
          <li class="norm-item">
            <div class="norm-head">
              <span class="norm-act"${actTitle(c.a) ? ` data-t="${esc(actTitle(c.a))}" tabindex="0"` : ''}>${esc(c.a)}</span>
              <span class="norm-path">${esc(c.p)}</span>
              <span class="norm-score">збіг ${esc(c.s)}</span>
            </div>
            <p class="norm-text">${markHtml(c.t, e.hl)}</p>
          </li>`).join('')}</ol>`
      : '<p class="norm-none">Норми-кандидата в корпусі немає.</p>';
    return `<div class="norm-panel" hidden><p class="norm-note">${esc(e.note)}</p>${cands}</div>`;
  }

  function legend(data) {
    const s = data.stats || {};
    const order = ['A', 'B', 'C', 'D', '?', 'A?', 'B?', 'C?'];
    const chips = order.filter(k => s[k]).map(k =>
      `<span class="norm-chip norm-${LEVELS[k].cls}" title="${esc(LEVELS[k].title)}">
         ${esc(k)} ${esc(LEVELS[k].word)} <b>${s[k]}</b></span>`).join('');
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

  window.NormLinks = { load, entry, badge, panel, legend, key };
})();
