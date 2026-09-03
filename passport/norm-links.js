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
    // пакет 18 «Радіологічне лікування» — радіаційний контур.
    // ⚠ Стоїть ПЕРШИМ навмисно: actTitle бере перший збіг, а номери 153 і 125
    // є і в МОЗ, і в ДІЯР. Тому ці три шаблони кваліфіковані органом видання —
    // без цього наказ ДІЯР № 153 отримав би назву табелів оснащення МОЗ.
    [/Наказ ДІЯР.*№\s*153\b/, 'Положення про перелік та вимоги щодо форми і змісту документів для отримання ліцензії на провадження діяльності з використання джерел іонізуючого випромінювання'],
    [/Наказ ДІЯР.*№\s*125\b/, 'Вимоги та умови безпеки (ліцензійні умови) провадження діяльності з використання джерел іонізуючого випромінювання'],
    [/Наказ ДІЯР.*№\s*138\b/, 'Про затвердження Переліку джерел іонізуючого випромінювання, діяльність по використанню яких звільняється від ліцензування'],
    [/№\s*39\/95/, 'Про використання ядерної енергії та радіаційну безпеку'],
    [/№\s*60\/95/, 'Про наркотичні засоби, психотропні речовини і прекурсори'],
    [/№\s*15\/98/, 'Про захист людини від впливу іонізуючого випромінювання'],
    [/№\s*1370-XIV/, 'Про дозвільну діяльність у сфері використання ядерної енергії'],
    [/№\s*1314-VII/, 'Про метрологію та метрологічну діяльність (повірка засобів вимірювальної техніки)'],
    [/№\s*845\b/, 'Про систему онкологічної допомоги населенню України (Положення про онкологічний заклад, облік хворих і канцер-реєстр)'],
    [/№\s*54\b/, 'ОСПУ-2005. Основні санітарні правила забезпечення радіаційної безпеки України'],
    [/№\s*1718\b/, 'Деякі питання державного регулювання діяльності з використання джерел іонізуючого випромінювання (Державний регістр ДІВ)'],
    [/№\s*1174\b/, 'Про затвердження критеріїв, за якими діяльність з використання джерел іонізуючого випромінювання звільняється від ліцензування'],
    [/№\s*949\b/, 'Про внесення змін до постанови КМУ № 1718 (державна реєстрація ДІВ, облік індивідуальних доз опромінення)'],
    [/№\s*753\b/, 'Про затвердження Технічного регламенту щодо медичних виробів'],
    [/№\s*366-р/, 'Про схвалення Національної стратегії із створення безбар’єрного простору в Україні на період до 2030 року'],
    // пакети 3–4 «Хірургія» і «Стаціонар без операцій»
    [/№\s*153\b/, 'Про затвердження табелів оснащення виробами медичного призначення структурних підрозділів закладів охорони здоров’я'],
    [/№\s*751\b/, 'Про створення та впровадження медико-технологічних документів зі стандартизації медичної допомоги (апарат галузевих стандартів)'],
    // пакет 63 «Лікування безпліддя (ДРТ)»
    [/№\s*787\b/, 'Про затвердження Порядку застосування допоміжних репродуктивних технологій в Україні'],
    // пакети 23–24 «Паліативна допомога»
    [/№\s*1308/, 'Про удосконалення організації надання паліативної допомоги в Україні (Порядок надання паліативної допомоги)'],
    [/№\s*643\b/, 'Про затвердження Стандартів медичної допомоги «Хронічний больовий синдром у дорослих та дітей»'],
    // пакет 8 «Складні неонатальні випадки»
    [/№\s*783\b/, 'Про затвердження Уніфікованого клінічного протоколу вторинної (спеціалізованої) та третинної (високоспеціалізованої) медичної допомоги «Жовтяниця новонароджених дітей»'],
    [/№\s*873\b/, 'Про затвердження Уніфікованого клінічного протоколу вторинної (спеціалізованої) та третинної (високоспеціалізованої) медичної допомоги «Респіраторний дистрес-синдром у передчасно народжених дітей»'],
    [/№\s*870\b/, 'Про затвердження Уніфікованого клінічного протоколу вторинної (спеціалізованої) та третинної (високоспеціалізованої) медичної допомоги «Ентеральне харчування недоношених немовлят»'],
    [/№\s*650\b/, 'Про затвердження Уніфікованого клінічного протоколу вторинної (спеціалізованої) та третинної (високоспеціалізованої) медичної допомоги «Парентеральне харчування новонароджених»'],
    [/№\s*1024\b/, 'Про затвердження Порядку транспортування новонароджених дітей високого перинатального ризику в Україні'],
    [/№\s*1864\b/, 'Про затвердження Порядку надання медичної допомоги з катамнестичного спостереження за новонародженими та дітьми віком до чотирьох років із групи ризику'],
    // пакет 7 «Пологи»
    [/№\s*170\b/, 'Про затвердження Уніфікованого клінічного протоколу первинної, вторинної (спеціалізованої), третинної (високоспеціалізованої) медичної допомоги «Фізіологічні пологи»'],
    [/№\s*8\b/, 'Про затвердження Уніфікованого клінічного протоколу первинної, вторинної (спеціалізованої) та третинної (високоспеціалізованої) медичної допомоги «Кесарів розтин»'],
    [/№\s*536\b/, 'Про затвердження Уніфікованого клінічного протоколу спеціалізованої медичної допомоги «Початкова, реанімаційна та післяреанімаційна допомога новонародженим»'],
    [/№\s*692\b/, 'Про затвердження клінічної настанови та стандартів медичної допомоги «Профілактика передачі ВІЛ від матері до дитини»'],
    [/№\s*227\b/, 'Про затвердження стандартів медичної допомоги «Пульсоксиметричний скринінг критичних вроджених вад серця у новонароджених»'],
    [/№\s*1437/, 'Про затвердження стандартів медичної допомоги «Нормальна вагітність»'],
    [/№\s*1533/, 'Про затвердження Стандарту медичної допомоги «Передчасний розрив плідних оболонок»'],
    [/№\s*599\b/, 'Про затвердження Порядку організації надання перинатальної та неонатальної допомоги'],
    [/№\s*2142/, 'Про забезпечення розширення неонатальних скринінгових програм для новонароджених (Порядок розширеного неонатального скринінгу, 21 захворювання)'],
    [/№\s*736\b/, 'Про затвердження Порядку надання медичної допомоги з організації скринінгу та діагностики порушень слуху у дітей'],
    [/№\s*951\b/, 'Про затвердження Примірних табелів оснащення обладнанням, медичною технікою та виробами медичного призначення (акушерсько-гінекологічна допомога)'],
    [/№\s*595\b/, 'Про порядок проведення профілактичних щеплень в Україні (Календар профілактичних щеплень)'],
    [/№\s*691\b/, 'Про реалізацію експериментального проекту щодо створення комплексної послуги «єМалятко»'],
    [/№\s*67\b/, 'Про затвердження форм первинної облікової документації в закладах, що надають медичну допомогу вагітним, роділлям та породіллям (форми 096/о, 097/о)'],
    [/№\s*1254/, 'Про затвердження Положення про інтернатуру та вторинну лікарську (провізорську) спеціалізацію'],
    // пакети 5 і 6
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
    // пакет 1 «Первинна медична допомога»
    [/№\s*504\b/, 'Про затвердження Порядку надання первинної медичної допомоги (додаток 1 — перелік послуг ПМД, додаток 2 — скринінги для груп ризику, додаток 3 — перелік лабораторних та інструментальних досліджень)'],
    [/№\s*503\b/, 'Про затвердження Порядку вибору лікаря, який надає первинну медичну допомогу, та форми декларації про вибір лікаря'],
    [/№\s*148\b/, 'Про затвердження Примірного табеля матеріально-технічного оснащення закладів охорони здоров’я та ФОП, які надають первинну медичну допомогу'],
    [/№\s*410\b/, 'Про договори про медичне обслуговування населення за програмою медичних гарантій (Порядок укладення договорів, Типова форма договору)'],
    [/№\s*2118/, 'Про організацію надання психосоціальної допомоги населенню'],
    [/№\s*1652/, 'Деякі питання проведення скринінгів здоров’я для осіб віком від 40 років'],
    [/№\s*102\b/, 'Про затвердження Стандартів медичної допомоги «Туберкульоз»'],
    [/№\s*302\b/, 'Про затвердження Порядку організації виявлення та діагностики туберкульозу та латентної туберкульозної інфекції'],
    [/№\s*278\b/, 'Про затвердження Порядку проведення та документування результатів медичного обстеження постраждалих осіб від домашнього насильства та надання їм медичної допомоги'],
    [/№\s*752\b/, 'Про порядок контролю якості медичної допомоги'],
    // пакет 9 «Профілактика, діагностика, спостереження та лікування в амбулаторних умовах»
    [/№\s*2801\b/, 'Основи законодавства України про охорону здоров’я'],
    [/№\s*5081\b/, 'Про екстрену медичну допомогу'],
    [/№\s*1489\b/, 'Про психіатричну допомогу'],
    [/№\s*2168\b/, 'Про державні фінансові гарантії медичного обслуговування населення'],
    [/№\s*411\b/, 'Деякі питання електронної системи охорони здоров’я (Порядок функціонування ЕСОЗ, перелік реєстрів)'],
    [/№\s*174\b/, 'Деякі питання організації спроможної мережі закладів охорони здоров’я (надкластерні, кластерні та загальні заклади)'],
    [/№\s*31\b/, 'Про затвердження Порядку здійснення медичного обслуговування учнів закладів загальної середньої освіти'],
    [/№\s*1338/, 'Деякі питання запровадження оцінювання повсякденного функціонування особи'],
    [/№\s*2003/, 'Про затвердження Порядків та періодичності проведення профілактичних медичних оглядів певних категорій дітей'],
    [/№\s*385\b/, 'Про затвердження переліків закладів охорони здоров’я, лікарських, провізорських посад та посад фахівців з базовою вищою освітою'],
    [/№\s*1066/, 'Деякі питання формування медичних висновків про тимчасову непрацездатність в електронній системі охорони здоров’я'],
    [/№\s*681\b/, 'Про затвердження нормативних документів щодо застосування телемедицини у сфері охорони здоров’я'],
    [/№\s*340\b/, 'Про удосконалення організації служби променевої діагностики та променевої терапії (положення про кабінети, штатні нормативи)'],
    [/№\s*294\b/, 'ДСанПіН 6.6.3-150-2007. Гігієнічні вимоги до влаштування та експлуатації рентгенівських кабінетів'],
    [/№\s*117\b/, 'Довідник кваліфікаційних характеристик професій працівників, Випуск 78 «Охорона здоров’я»'],
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
    if (e.k !== (precomputedKey || key(text))) return null;
    e.vk = sectionKey + '|' + e.k;   // ключ пункту для валідації експертами
    return e;
  }


  // Стан пункту для діагностики: 'ok' — значок є; 'none' — пункт поза шкалою
  // (у даних його немає, це нормально для довідникових переліків); 'stale' —
  // пункт є, але текст пакета змінився і відбиток не збігся (дані перезібрати).
  function status(data, sectionKey, ord, text, precomputedKey) {
    if (!data) return 'none';
    const list = data.sections && data.sections[sectionKey];
    const e = list && list.find(x => x.o === ord);
    if (!e) return 'none';
    return e.k === (precomputedKey || key(text)) ? 'ok' : 'stale';
  }

  function badge(e) {
    const meta = LEVELS[e.lv] || LEVELS['?'];
    const n = e.c.length;
    return `<button type="button" class="norm-badge norm-${meta.cls}"
      data-norm="1" title="${esc(meta.title)}${n ? ` · норм: ${n}` : ''}"
      aria-expanded="false">${esc(e.lv)}<span class="norm-bw"> ${esc(meta.word)}</span></button>`;
  }

  function panel(e) {
    // голосування — під КОЖНОЮ нормою окремо: ключ = пункт + акт + шлях норми
    const voteRow = (c, i) => `<div class="norm-vote" data-vk="${esc((e.vk || '') + '|' + key(c.a + '~' + c.p))}"${i === 0 ? ' data-anchor="1"' : ''} hidden>
      <button type="button" class="norm-vote-btn norm-vote-up" data-v="1" title="Підтверджую цю норму">✓</button>
      <span class="norm-vote-n norm-vote-nup">0</span>
      <button type="button" class="norm-vote-btn norm-vote-down" data-v="-1" title="Не згоден із цією нормою">✗</button>
      <span class="norm-vote-n norm-vote-ndown">0</span>
      <span class="norm-vote-pctline"></span>
    </div>`;
    const suggBlock = `<div class="norm-sugg" data-vk="${esc(e.vk || '')}" hidden>
      <button type="button" class="norm-sugg-toggle" title="Запропонувати нормативний акт/пункт під цей пункт пакета">➕ запропонувати норму</button>
      <div class="norm-sugg-form" hidden>
        <textarea class="norm-sugg-text" rows="2" maxlength="1000"
          placeholder="Реквізит акта, пункт і чому він сюди пасує (напр.: наказ МОЗ від … № …, п. 5 розділу II — встановлює …)"></textarea>
        <button type="button" class="norm-sugg-send">Надіслати</button>
      </div>
      <ul class="norm-sugg-list" hidden></ul>
    </div>`;
    const cands = e.c.length
      ? `<ol class="norm-list">${e.c.map((c, i) => `
          <li class="norm-item">
            <div class="norm-head">
              <span class="norm-act"${actTitle(c.a) ? ` data-t="${esc(actTitle(c.a))}" tabindex="0"` : ''}>${esc(c.a)}</span>
              <span class="norm-path">${esc(c.p)}</span>
              <span class="norm-score">збіг ${esc(c.s)}</span>
            </div>
            <p class="norm-text">${markHtml(c.t, e.hl)}</p>
            ${voteRow(c, i)}
          </li>`).join('')}</ol>`
      : '<p class="norm-none">Норми-кандидата в корпусі немає.</p>';
    return `<div class="norm-panel" hidden><p class="norm-note">${esc(e.note)}</p>${cands}${suggBlock}</div>`;
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

  window.NormLinks = { load, entry, status, badge, panel, legend, key, votes: null };

  // ── Валідація прив'язок і пропозиції норм (Supabase) ────────
  // Голос ✓/✗ на пункт від експерта, відсоток підтримки біля значка,
  // «➕ норма» — пропозиція акта/пункту в norm_suggestions (обробляється
  // офлайн конвеєром 18_нормативне_підкріплення).
  const SB_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
  const SB_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';

  const V = {
    sb: null, user: null, pkg: null,
    votes: new Map(),        // vk → {up, down, mine}
    suggs: new Map(),        // vk → [{id, suggestion, user_name, status, mine}]

    async init(pkg, container) {
      this.pkg = String(pkg);
      try {
        const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        this.sb = window.__pmgSb || (window.__pmgSb = mod.createClient(SB_URL, SB_KEY));
        const { data: { session } } = await this.sb.auth.getSession();
        this.user = session?.user || null;
        this.name = await this.resolveName();
        const [vr, sr] = await Promise.all([
          this.sb.from('norm_validations').select('item_k, verdict, user_id').eq('pkg', this.pkg),
          this.sb.from('norm_suggestions').select('id, item_k, suggestion, user_name, status, user_id').eq('pkg', this.pkg),
        ]);
        if (vr.error) throw vr.error;          // таблиці ще немає → тихо виходимо
        this.votes.clear();
        for (const r of vr.data) {
          const v = this.votes.get(r.item_k) || { up: 0, down: 0, mine: 0 };
          if (r.verdict > 0) v.up++; else v.down++;
          if (this.user && r.user_id === this.user.id) v.mine = r.verdict;
          this.votes.set(r.item_k, v);
        }
        this.suggs.clear();
        for (const r of (sr.data || [])) {
          const list = this.suggs.get(r.item_k) || [];
          list.push({ id: r.id, suggestion: r.suggestion, user_name: r.user_name,
                      status: r.status, mine: this.user && r.user_id === this.user.id });
          this.suggs.set(r.item_k, list);
        }
        container.querySelectorAll('.norm-vote[data-vk]').forEach(el => {
          el.hidden = false;
          this.paint(el);
        });
        container.querySelectorAll('.norm-sugg[data-vk]').forEach(el => {
          el.hidden = false;
          this.paintSugg(el);
        });
        this.wire(container);
        this.summary(container);
      } catch (err) {
        console.info('NormLinks: валідація вимкнена —', err.message || err);
      }
    },

    // ПІБ за конвенцією порталу (як у cabinet/rozpodil.js): спершу метадані
    // сесії, потім таблиця profiles. На email НЕ відкочуємося — у спільному
    // списку пропозицій колеги мають бачити прізвище, а не пошту.
    async resolveName() {
      if (!this.user) return '';
      const meta = this.user.user_metadata || {};
      if (meta.full_name || meta.name) return meta.full_name || meta.name;
      try {
        const { data } = await this.sb.from('profiles').select('full_name').eq('id', this.user.id).single();
        if (data?.full_name) return data.full_name;
      } catch (e) { /* профілю немає — лишаємо порожнім */ }
      return '';
    },

    paint(el) {
      const vk = el.dataset.vk;
      const v = this.votes.get(vk) || { up: 0, down: 0, mine: 0 };
      el.querySelector('.norm-vote-nup').textContent = v.up;
      el.querySelector('.norm-vote-ndown').textContent = v.down;
      el.querySelector('.norm-vote-up').classList.toggle('is-mine', v.mine === 1);
      el.querySelector('.norm-vote-down').classList.toggle('is-mine', v.mine === -1);
      const total = v.up + v.down;
      const pct = total ? Math.round(v.up / total * 100) : null;
      el.querySelector('.norm-vote-pctline').textContent =
        total ? `${pct}% підтримки (${total} ${total === 1 ? 'голос' : total < 5 ? 'голоси' : 'голосів'})` : 'ще ніхто не голосував';
      // відсоток біля значка рівня — від ЯКІРНОЇ норми (першої в списку)
      if (el.dataset.anchor) {
        const badge = el.closest('.spec-item')?.querySelector('.norm-badge');
        if (badge) {
          let chip = badge.querySelector('.norm-vote-pct');
          if (total) {
            if (!chip) { chip = document.createElement('span'); chip.className = 'norm-vote-pct'; badge.appendChild(chip); }
            chip.textContent = ` ${pct}%`;
            chip.classList.toggle('is-low', pct < 50);
          } else if (chip) chip.remove();
        }
      }
    },

    paintSugg(el) {
      const vk = el.dataset.vk;
      const list = this.suggs.get(vk) || [];
      const ul = el.querySelector('.norm-sugg-list');
      ul.hidden = !list.length;
      ul.innerHTML = list.map(s =>
        `<li class="norm-sugg-item${s.status !== 'new' ? ' is-' + s.status : ''}">
           <span class="norm-sugg-body">${esc(s.suggestion)}</span>
           <span class="norm-sugg-meta">${esc(s.user_name || '')}${s.status === 'accepted' ? ' · враховано' : s.status === 'rejected' ? ' · відхилено' : ''}</span>
         </li>`).join('');
    },

    wire(container) {
      if (container.dataset.normVotesWired) return;
      container.dataset.normVotesWired = '1';
      container.addEventListener('click', async ev => {
        const bar = ev.target.closest('.norm-vote[data-vk], .norm-sugg[data-vk]');
        if (!bar) return;
        const vk = bar.dataset.vk;

        const vb = ev.target.closest('.norm-vote-btn');
        if (vb) {
          ev.stopPropagation();
          if (!this.user) { alert('Щоб голосувати, увійдіть у портал.'); return; }
          const verdict = Number(vb.dataset.v);
          const cur = this.votes.get(vk) || { up: 0, down: 0, mine: 0 };
          try {
            if (cur.mine === verdict) {
              await this.sb.from('norm_validations').delete()
                .match({ pkg: this.pkg, item_k: vk, user_id: this.user.id });
              if (verdict > 0) cur.up--; else cur.down--;
              cur.mine = 0;
            } else {
              const { error } = await this.sb.from('norm_validations').upsert({
                pkg: this.pkg, item_k: vk, verdict,
                user_id: this.user.id,
                user_name: this.name || '',
              }, { onConflict: 'pkg,item_k,user_id' });
              if (error) throw error;
              if (cur.mine === 1) cur.up--; if (cur.mine === -1) cur.down--;
              if (verdict > 0) cur.up++; else cur.down++;
              cur.mine = verdict;
            }
            this.votes.set(vk, cur);
            this.paint(bar);
            this.summary(container);
          } catch (err) { alert('Не вдалося зберегти голос: ' + (err.message || err)); }
          return;
        }

        if (ev.target.closest('.norm-sugg-toggle')) {
          ev.stopPropagation();
          if (!this.user) { alert('Щоб запропонувати норму, увійдіть у портал.'); return; }
          const form = bar.querySelector('.norm-sugg-form');
          form.hidden = !form.hidden;
          if (!form.hidden) form.querySelector('.norm-sugg-text').focus();
          return;
        }

        if (ev.target.closest('.norm-sugg-send')) {
          ev.stopPropagation();
          const form = bar.querySelector('.norm-sugg-form');
          const ta = form.querySelector('.norm-sugg-text');
          const text = ta.value.trim();
          if (text.length < 5) { ta.focus(); return; }
          try {
            const { error } = await this.sb.from('norm_suggestions').insert({
              pkg: this.pkg, item_k: vk, suggestion: text,
              user_id: this.user.id,
              user_name: this.name || '',
            });
            if (error) throw error;
            const list = this.suggs.get(vk) || [];
            list.push({ suggestion: text, user_name: 'ви', status: 'new', mine: true });
            this.suggs.set(vk, list);
            ta.value = ''; form.hidden = true;
            this.paintSugg(bar);
          } catch (err) { alert('Не вдалося надіслати пропозицію: ' + (err.message || err)); }
        }
      });
    },

    summary(container) {
      const legend = container.querySelector('.norm-legend');
      if (!legend) return;
      let voted = 0, sumPct = 0, total = 0;
      for (const v of this.votes.values()) {
        const t = v.up + v.down;
        if (!t) continue;
        voted++; total += t; sumPct += v.up / t * 100;
      }
      let line = legend.querySelector('.norm-valid-summary');
      if (!line) {
        line = document.createElement('p');
        line.className = 'norm-valid-summary';
        legend.appendChild(line);
      }
      line.textContent = voted
        ? `Валідація експертів: оцінено ${voted} прив'язок, середня підтримка ${Math.round(sumPct / voted)}% (${total} голосів).`
        : 'Валідація експертів: голосів ще немає — розкрийте пункт і поставте ✓ або ✗.';
    },
  };

  window.NormLinks.votes = V;
})();
