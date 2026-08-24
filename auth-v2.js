import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Run theme initialization immediately to prevent flash of white screen
(function() {
  const savedTheme = localStorage.getItem('portal-theme') || 'light';
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark-theme');
  }
})();

/* ── Знімок стану для миттєвого старту ──────────────────────────────────
   Портал перемальовувався тричі поспіль, і це було видно оком:
     1) ~0,15 с — порожня смуга меню заповнюється (чекала на мережний запит
        ролі в profiles);
     2) ~0,30 с — головна перекидається з гостьового макета в «залогінений»
        (клас home-logged-in), на мобільному при цьому зникає півсторінки;
     3) ~0,45 с — згори виїжджає смужка днів народження і зсуває все вниз.
   Лікуємо не швидкістю запитів, а порядком: після кожного визначення ролі
   кладемо знімок у localStorage і на наступному заході застосовуємо його ДО
   першого малювання — тим самим прийомом, що й тема вище. Сервер потім лише
   підтверджує знімок, і тоді не смикається взагалі нічого. */
const BOOT_KEY = 'portal-boot-v1';
const BOOT_BDAY_KEY = 'portal-boot-bday-h';
const BOOT_DASH_KEY = 'portal-boot-dash-h';

/** Чи лежить у сховищі сесія supabase-js. Ключ шукаємо регуляркою, а не
 *  константою: у наступній версії клієнта назва може змінитися, і жорсткий
 *  ключ тихо повернув би нас до миготіння. */
function hasStoredSession() {
  try {
    return Object.keys(localStorage).some(k => /^sb-.+-auth-token$/.test(k));
  } catch (e) { return false; }
}

/** Знімок дійсний лише поки є сесія: вийшли в сусідній вкладці — і ми знову
 *  малюємо гостя, а не чужий кабінет. */
function readBoot() {
  try {
    if (!hasStoredSession()) return null;
    return JSON.parse(localStorage.getItem(BOOT_KEY) || 'null');
  } catch (e) { return null; }
}

function saveBoot() {
  try {
    if (!user) { localStorage.removeItem(BOOT_KEY); return; }
    localStorage.setItem(BOOT_KEY, JSON.stringify({
      uid: user.id,
      role, isHead, isClerk,
      name: user.user_metadata?.full_name || user.user_metadata?.name ||
            user.email?.split('@')[0] || ''
    }));
  } catch (e) { /* приватний режим — просто без миттєвого старту */ }
}

const boot = readBoot();

// Модуль відкладений (type="module"), тож тут документ уже розібраний і
// document.body існує — але браузер ще не малював.
(function applyBootSnapshot() {
  const root = document.documentElement;
  root.dataset.auth = boot ? 'user' : 'guest';
  if (boot?.role) root.dataset.role = boot.role;

  const metrics = document.getElementById('home-metrics');
  if (!metrics || !boot) return;  // не головна або гість — далі нема чого чіпати

  const ROLES = ['guest', 'expert', 'manager', 'deputy_director', 'director', 'admin'];
  if (ROLES.indexOf(boot.role) < ROLES.indexOf('expert')) return;

  document.body.classList.add('home-logged-in');
  metrics.style.display = 'block';

  // Смужка днів народження приходить окремим запитом і зсуває сторінку вниз.
  // Тримаємо для неї місце рівно тієї висоти, яку вона мала минулого разу.
  const bdayHeight = parseInt(localStorage.getItem(BOOT_BDAY_KEY) || '0', 10);
  const strip = document.getElementById('birthday-strip');
  if (strip && bdayHeight > 0) strip.style.minHeight = bdayHeight + 'px';
})();

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let user = null;
let role = null; // null = guest | 'registered' | 'full'
let isHead = false;
// Діловод департаменту: ортогонально до role — ширші повноваження
// (доручення по всіх відділах, оголошення, табель), але НЕ права керівника
let isClerk = false;
// Прохід малювання за знімком: розмітку будуємо, у мережу не ходимо
let bootPaint = false;

// Єдиний перелік підтек порталу: якщо сторінка лежить в одній з них,
// відносні посилання на кореневі ресурси потребують префікса '../'.
//
// ⚠️ НОВИЙ РОЗДІЛ ОБОВ'ЯЗКОВО ДОДАВАТИ СЮДИ. Забути легко, а наслідок брутальний
// і не схожий на причину: сторінка розділу відкривається й виглядає справною, але
// префікс стає './', і КОЖНЕ посилання меню веде в неї саму — /drg/classifiers/
// index.html замість /classifiers/index.html, тобто 404 на будь-якому переході.
// Після перезавантаження з кореня все знову працює, тож збій легко списати на
// кеш. Спіймано 09.08.2026 на розділі «Інструменти ДСГ» (drg), який тут забули.
const PORTAL_SUBDIRS = [
  'algorithms', 'bloknot', 'cabinet', 'chat', 'classifiers', 'dec', 'drg', 'expert-proposals', 'infocenter',
  'koduvannia', 'map', 'mapping', 'news', 'pakety', 'passport', 'pilots', 'pmg-proposals', 'postanova',
  'regulatory', 'relax', 'reminders', 'rentgen', 'rozjasnennya', 'skod', 'zoz-dogovr', 'zoz-poshuk',
  'zoz-questions'
];

function isInPortalSubdir() {
  return window.location.pathname.split('/').some(part => PORTAL_SUBDIRS.includes(part.toLowerCase()));
}

function getPathPrefix() {
  return isInPortalSubdir() ? '../' : './';
}

// Глобальний пошук «одне вікно» (Ctrl+K) — модуль вантажиться ліниво при першому виклику
let globalSearchModule = null;
async function openGlobalSearch() {
  try {
    if (!globalSearchModule) {
      // Шлях відносно МОДУЛЯ auth-v2.js (обидва лежать у корені), а не сторінки
      globalSearchModule = await import('./global-search.js?v=20260810b');
    }
    globalSearchModule.open(getPathPrefix());
  } catch (err) {
    console.error('Global search failed to load:', err);
  }
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyK') {
    e.preventDefault();
    openGlobalSearch();
  }
});

function hasAccess(required) {
  if (!required) return true;
  if (!user) return false;
  
  let req = required;
  if (req === 'registered' || req === 'full') {
    req = 'expert';
  }
  
  // Director possesses full administrative rights
  let currentRole = role;
  if (currentRole === 'director') {
    currentRole = 'admin';
  }
  if (req === 'director') {
    req = 'admin';
  }
  
  // Діловод департаменту працює з дорученнями всіх відділів, тож сторінки
  // рівня 'manager' (СКО-Д «Доручення») йому відкриті. Вище — ні: рівні
  // deputy_director / admin лишаються за керівництвом.
  if (isClerk && req === 'manager') return true;

  const rolesOrder = ['guest', 'expert', 'manager', 'deputy_director', 'admin'];
  const userRoleIndex = rolesOrder.indexOf(currentRole);
  const requiredRoleIndex = rolesOrder.indexOf(req);
  
  if (userRoleIndex === -1 || requiredRoleIndex === -1) return false;
  return userRoleIndex >= requiredRoleIndex;
}

async function fetchRole() {
  if (!user) { role = null; isHead = false; isClerk = false; return; }
  // select('*') навмисно: поки міграція is_clerk не застосована, перелік колонок
  // поіменно повернув би помилку — і всі користувачі стали б гостями
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).single();
  // Роль визначає ВИКЛЮЧНО запис у profiles (керується адміністратором);
  // жодних клієнтських авто-підвищень за ключовими словами в email.
  role = data?.role ?? 'guest';
  isHead = data?.is_head ?? false;
  isClerk = data?.is_clerk ?? false;
}

function applyAccess() {
  const isInSubdir = isInPortalSubdir();
  const prefix = isInSubdir ? '../' : './';
  const currentPath = window.location.pathname.toLowerCase();

  // Update standalone Chat button in top nav
  const chatBtn = document.getElementById('auth-chat-btn');
  if (chatBtn) {
    chatBtn.href = prefix + 'chat/index.html';
    const hasChatAccess = hasAccess('expert');
    if (!hasChatAccess) {
      chatBtn.style.display = 'none';
    } else {
      chatBtn.style.display = '';
      chatBtn.classList.remove('is-locked');
      chatBtn.innerHTML = `Робочий чат`;
      chatBtn.onclick = null;
    }
  }

  // Update standalone Personal Cabinet button in top nav
  const cabinetBtn = document.getElementById('auth-cabinet-btn');
  if (cabinetBtn) {
    cabinetBtn.href = prefix + 'cabinet/index.html';
    const hasCabinetAccess = hasAccess('expert');
    if (!hasCabinetAccess) {
      cabinetBtn.style.display = 'none';
    } else {
      cabinetBtn.style.display = '';
      cabinetBtn.classList.remove('is-locked');
      cabinetBtn.innerHTML = `👤 Особистий кабінет`;
      cabinetBtn.onclick = null;
    }
  }

  // Update standalone SKOD Tasks button in top nav
  const tasksBtn = document.getElementById('auth-tasks-btn');
  if (tasksBtn) {
    tasksBtn.href = prefix + 'skod/tasks.html';
    const hasTasksAccess = hasAccess('manager');
    if (!hasTasksAccess) {
      tasksBtn.style.display = 'none';
    } else {
      tasksBtn.style.display = '';
      tasksBtn.classList.remove('is-locked');
      tasksBtn.innerHTML = `Доручення`;
      tasksBtn.onclick = null;
    }
  }

  // Update standalone Regulatory Admin button in top nav
  const regulatoryBtn = document.getElementById('auth-regulatory-btn');
  if (regulatoryBtn) {
    regulatoryBtn.href = prefix + 'regulatory/admin.html';
    const hasRegAccess = hasAccess('expert');
    if (!hasRegAccess) {
      regulatoryBtn.style.display = 'none';
    } else {
      regulatoryBtn.style.display = '';
      regulatoryBtn.classList.remove('is-locked');
      regulatoryBtn.innerHTML = `Управління нормами`;
      regulatoryBtn.onclick = null;
    }
  }

  const btn = document.getElementById('auth-nav-btn');
  if (btn) {
    if (user) {
      const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
      btn.textContent = displayName;
      btn.classList.add('is-signed-in');
      btn.title = 'Натисніть для виходу';
    } else {
      btn.textContent = 'Увійти';
      btn.classList.remove('is-signed-in');
      btn.title = '';
    }
  }

  // Update role badge next to the button.
  // Кольори бейджа живуть у auth-v2.css (.auth-role-badge.role-*) — тут лише
  // підпис і клас ролі. Інлайнові стилі колись ставили як запобіжник проти
  // застарілого кешу CSS, але інлайн б'є і темну тему: бейдж лишався світлим
  // на кожній сторінці. Свіжість CSS тепер тримається на ?v= і версії SW.
  const badge = document.getElementById('auth-role-badge');
  if (badge) {
    const roleLabels = {
      guest: 'Гість',
      expert: 'Експерт',
      manager: 'Керівник',
      deputy_director: 'Заступник',
      director: 'Директор',
      admin: 'Адмін'
    };
    let roleKey = 'guest';
    if (user) {
      roleKey = (isClerk && !['deputy_director', 'director', 'admin'].includes(role))
        ? 'clerk'
        : (roleLabels[role] ? role : 'guest');
    }
    badge.textContent = roleKey === 'clerk' ? 'Діловод' : roleLabels[roleKey];
    badge.className = 'auth-role-badge role-' + roleKey;
  }

  // Show/hide daily status chip next to access status button
  const statusChip = document.getElementById('portal-status-chip');
  if (statusChip) {
    if (user && role !== 'guest') {
      statusChip.style.display = 'inline-flex';
      const statsLink = document.getElementById('view-status-stats-link');
      if (statsLink) {
        statsLink.href = prefix + 'skod/reports.html?type=statuses';
      }
    } else {
      statusChip.style.display = 'none';
    }
  }

  // Show/hide role-gated elements
  document.querySelectorAll('[data-role]').forEach(el => {
    el.style.display = hasAccess(el.dataset.role) ? '' : 'none';
  });

  // Dynamic navigation links injection
  function isActive(itemPath) {
    const normalized = itemPath.replace(/^\.\.\/|^\.\//, '');
    const segments = normalized.split('/');
    
    if (normalized === 'index.html') {
      const isSub = [...PORTAL_SUBDIRS, 'rozjasnennya.html', 'dept-tree.html'].some(s => currentPath.includes(s));
      return !isSub && (currentPath.endsWith('/') || currentPath.endsWith('index.html'));
    }
    
    // Розділ роз'яснень: нова тека rozjasnennya/ і стара сторінка-редирект
    // rozjasnennya.html — це один і той самий пункт меню.
    if (normalized.startsWith('rozjasnennya')) {
      return currentPath.includes('rozjasnennya') && !currentPath.includes('_semantic');
    }
    
    // Довідники: у теці classifiers/ живе вісім різних сторінок, тож збіг лише
    // за текою підсвітив би одразу всі пункти підменю. Звіряємо ім'я файлу, а
    // для «Посад» — ще й ?view=, бо три пункти ведуть на одну сторінку.
    if (segments[0] === 'classifiers' && segments.length === 2) {
      const [file, query] = segments[1].split('?');
      const here = file === 'index.html'
        ? (currentPath.endsWith('/classifiers/') || currentPath.endsWith('/classifiers/index.html'))
        : currentPath.endsWith('/' + file);
      if (!here) return false;
      const wanted = new URLSearchParams(query || '').get('view') || '';
      const opened = new URLSearchParams(window.location.search).get('view') || '';
      return wanted === opened;
    }

    if (normalized === 'pakety/report.html') {
      return currentPath.includes('report.html');
    }
    
    if (normalized === 'pakety/collector.html') {
      return currentPath.includes('collector.html');
    }
    
    if (normalized === 'pakety/index.html') {
      return currentPath.includes('/pakety/') && !currentPath.includes('report.html') && !currentPath.includes('collector.html');
    }

    // Загальне правило — збіг за текою розділу. Звіряємо саме сегменти шляху:
    // includes() вважав /mapping/ (Таблиця співставлення) частиною /map/
    // (Карта порталу), і на таблиці підсвічувалися обидва пункти.
    const parts = currentPath.split('/');
    if (!parts.includes(segments[0])) return false;

    const file = (segments[1] || '').split('?')[0];
    if (segments.length === 2 && file) {
      // Картка доручення пункту меню не має — світить свого батька
      const parentOf = { 'task-detail.html': 'tasks.html' };
      const last = parts[parts.length - 1];
      const here = parentOf[last] || last;
      // Сторінки з власним пунктом меню не віддають підсвітку сусідам по теці:
      // на cabinet/planner.html активний «Планувальник», а не «Внесення роботи».
      const ownItem = ['planner.html', 'rehab.html', 'linker.html'];
      return file === 'index.html' ? !ownItem.includes(here) : here === file;
    }
    return true;
  }

  /**
   * Кнопка «Назад» у навігації — спільна для всіх розділів.
   *
   * Портал побудований на перехресних переходах (код НК 026 → пакет → постанова),
   * і без явного повернення користувач «застрягає»: кнопка браузера непомітна,
   * а на мобільному її часто немає взагалі. Пріоритет джерел:
   *   1) ?back=<відносний шлях>&backLabel=<підпис> — коли розділ знає, куди вести;
   *   2) document.referrer того ж походження — тоді просто history.back().
   */
  const appendBackLink = (container) => {
    // Головна — корінь порталу, а не сторінка, куди «зайшли звідкись». Referrer
    // тут є майже завжди (зайшли в розділ → тицьнули логотип), і кнопка
    // «Назад» щоразу пропонувала повернутися в розділ, який щойно покинули.
    if (isActive('index.html')) {
      document.getElementById('mobile-back-btn')?.remove();
      return;
    }

    const params = new URLSearchParams(location.search);
    const back = params.get('back');
    const label = params.get('backLabel');
    let href = null;
    if (back && !/^(https?:)?\/\//i.test(back) && !back.startsWith('//')) {
      href = back;  // лише відносні шляхи — щоб параметр не став відкритим редиректом
    } else if (document.referrer) {
      try {
        const ref = new URL(document.referrer);
        if (ref.origin === location.origin && ref.href !== location.href) href = '';
      } catch (e) { /* некоректний referrer — просто без кнопки */ }
    }
    if (href === null) return;

    const text = '← ' + (label ? label : 'Назад');
    const make = (cls) => {
      const btn = document.createElement(href ? 'a' : 'button');
      btn.className = cls;
      btn.textContent = text;
      if (href) btn.href = href;
      else { btn.type = 'button'; btn.addEventListener('click', () => history.back()); }
      return btn;
    };
    const inNav = make('nav-back');
    container.appendChild(inNav);

    // На вужчих екранах уся ця навігація прихована на користь таббара,
    // тож там кнопка живе окремо — плаваючою над таббаром.
    document.getElementById('mobile-back-btn')?.remove();
    const float = make('nav-back-float');
    float.id = 'mobile-back-btn';
    document.body.appendChild(float);

    // Деякі розділи (напр. «Паспорт пакета») ховають цю шапку і на десктопі —
    // там кнопка в навігації не відрендериться взагалі. Перевіряємо після
    // розкладки і повторюємо на зміну ширини: стилі та авторизація доїжджають
    // асинхронно, тож одного заміру мало.
    const syncFloat = () => {
      float.classList.toggle('nav-back-float--always', !inNav.offsetWidth);
    };
    requestAnimationFrame(syncFloat);
    setTimeout(syncFloat, 400);
    window.addEventListener('resize', syncFloat);
  };

  const navContainer = document.querySelector('nav.section-switch:not(.top-auth)') || document.querySelector('.top-nav');
  if (navContainer) {
    navContainer.innerHTML = ''; // Rebuild dynamically

    // На самій головній кнопка «Головна» зайва: туди веде і логотип у шапці,
    // і 🏠 в мобільному таббарі. На решті сторінок вона лишається.
    const coreItems = [
      { text: 'Головна', path: 'index.html', hideWhenActive: true }
    ];

    // «Пакети» — усе, що стосується пакета медичних послуг: сам пакет, його
    // паспорт, роз'яснення НСЗУ до нього, пілоти поза постановою 1808 і архів
    // минулих років. Роз'яснення, паспорт і архів були розкидані по трьох
    // різних місцях меню, хоча шукають їх там само, де й пакет.
    const packagesItems = [
      { text: '📗 Пакети ПМГ 2026', path: 'pakety/index.html' },
      { text: '🪪 Паспорт пакета', path: 'passport/index.html' },
      { text: '📄 Роз\'яснення НСЗУ', path: 'rozjasnennya/index.html' },
      { text: '🧪 Пілотні проєкти', path: 'pilots/index.html' },
      { text: '🗃️ Архів пакетів ПМГ', path: 'pakety/collector.html' }
    ];

    // Довідники — вкладка з підменю. Дев'ять сторінок одним списком уже не
    // читалися: «табелі оснащення» і «посади» — не коди, а НК 024 і НК 031
    // губилися серед кодів хвороб. Тому три смислові гнізда: чим кодують
    // випадок, чим його оснащують і хто його надає.
    const referenceItems = [
      {
        text: '🩺 Коди', items: [
          { text: 'Хвороби · НК 025', path: 'classifiers/index.html' },
          { text: 'Інтервенції · НК 026', path: 'classifiers/nk026.html' },
          { text: 'Лабораторні · LOINC', path: 'classifiers/loinc.html' },
          // Внутрішній: реконструкція з документів, не офіційний класифікатор
          { text: 'Коди ЕСОЗ · внутрішній', path: 'classifiers/esoz.html', role: 'expert' }
        ]
      },
      {
        text: '🩻 Обладнання', items: [
          { text: 'Медвироби · НК 024', path: 'classifiers/nk024.html' },
          { text: 'Номенклатура · НК 031', path: 'classifiers/nk031.html' },
          { text: 'Табелі оснащення', path: 'classifiers/tabel.html' },
          { text: 'Обладнання у вимогах ПМГ', path: 'classifiers/obladnannia.html' }
        ]
      },
      {
        // Гніздо було на шість пунктів, після аудиту 12.08.2026 стало п'ять,
        // а 18.08.2026 — два. Що прибрано і чому:
        //   «Посади у вимогах ПМГ» (?view=pkg) — це не сторінка, а галочка
        //     «лише посади, які є вимогою» на тій самій сторінці, і галочка
        //     стоїть на видноті в лівій панелі;
        //   «Коди посад НСЗУ» (?view=codes) — теж та сама сторінка, але
        //     список інший (286 кодів за номером, з них 46 без характеристики),
        //     тож пункт не викинуто, а переїхав ПЕРЕМИКАЧЕМ на саму сторінку;
        //   «Кадровий ланцюжок» — знято з навігації за рішенням від 18.08.2026
        //     (сторінка лишається за прямим URL, вона робоча, але позначена
        //     «Проба» і в роботі не прижилася).
        text: '👥 Посади', items: [
          { text: 'Спеціальності та посади · ліцензія і штат', path: 'classifiers/specialnosti.html' },
          { text: 'Довідник характеристик ДКХП-78', path: 'classifiers/posady.html' }
        ]
      },
      {
        // Четверте гніздо — за аудитом 17.08.2026 (Аудит_Довідники_кодування.md).
        // Раніше тут висіли чотири пункти розсипом, а правила кодування (377,
        // 182, амбулаторка) жили в «Документах» — тобто тема була розкладена
        // по трьох місцях меню, амбулаторка ж не мала входу взагалі. Тепер
        // усе кодування збирається за задачею; 377 і 182 навмисно продубльовані
        // з «Документами»: там вони як документи, тут — як задача.
        // Назви — з поясненням після «·», щоб не вгадувати межі розділів.
        // Пілот з меню знято: він повністю поглинутий «Кодуванням випадку»,
        // сторінка лишається живою за прямим посиланням.
        // Службові пункти позначені role: 'expert' — це наші власні побудови,
        // а не офіційні документи, і показувати гостю вхід, за яким на нього
        // чекає «Доступ обмежено», немає сенсу. Відкритими лишаються Таблиця
        // співставлення, 377 і 182: то офіційні джерела.
        text: '🧭 Кодування', items: [
          { text: 'Кодування випадку · від коду до тарифу', path: 'koduvannia/index.html', role: 'expert' },
          { text: 'Групер ДСГ · випадок → група', path: 'koduvannia/grouper.html', role: 'expert' },
          { text: 'Інструменти ДСГ · тарифи й аномалії', path: 'drg/index.html', role: 'expert' },
          { text: 'Таблиця співставлення · код ↔ пакет', path: 'mapping/index.html' },
          { text: 'Правила: наказ 377', path: 'algorithms/index.html' },
          { text: 'Кодування реабілітації · наказ 182', path: 'algorithms/rehab.html' },
          { text: 'Кодування амбулаторки · пакет 9', path: 'algorithms/ambulatory.html', role: 'expert' }
        ]
      }
    ];

    // Довідково-нормативні розділи — згруповані в дропдаун «Документи».
    // Накази НСЗУ винесені у власне гніздо: їх уже два, і поруч у списку вони
    // читаються як два різні розділи, хоча це один тип документа.
    const documentsItems = [
      {
        text: '📜 Постанови ПМГ', items: [
          { text: 'Постанова 1808 · Порядок 2026', path: 'postanova/index.html' },
          { text: 'Тарифи 2025 ↔ 2026 · порівняння', path: 'postanova/porivnyannya.html' }
        ]
      },
      {
        text: '📜 Накази НСЗУ', items: [
          { text: 'Наказ 377 · Алгоритми та правила', path: 'algorithms/index.html' },
          { text: 'Наказ 182 · Кодування реабілітації', path: 'algorithms/rehab.html' }
        ]
      },
      { text: 'Нормативна база', path: 'regulatory/index.html' },
      { text: '🩻 Рентген і ДІВ', path: 'rentgen/index.html' },
      { text: 'ДЕЦ МОЗ', path: 'dec/index.html' },
      { text: 'Укладені договори', path: 'zoz-dogovr/index.html' },
      { text: '🏥 Хто це лікує', path: 'zoz-poshuk/index.html' }
    ];

    const tailItems = [
      { text: '📡 Інфоцентр', path: 'infocenter/index.html', role: 'expert' },
      { text: 'Структура Департаменту', path: 'dept-tree.html', role: 'expert' },
      { text: 'Робочий чат', path: 'chat/index.html', isChat: true, role: 'expert' }
    ];

    // «Сервіси» — робочі інструменти департаменту. Тринадцять пунктів одним
    // списком уже не читалися: три рядки «СКО-Д (…)» займали чверть меню, а
    // «Інфоцентр» дублював вкладку праворуч. Тепер гнізда за тим самим поділом,
    // що й кластери карти порталу: робота → взаємодія → інструменти.
    const servicesItems = [
      { text: '🗺️ Карта порталу', path: 'map/index.html' },
      // Розбори кейсів: питання → з'ясоване → рішення → хвости, з посиланнями
      // в розділи порталу. Заведено 24.08.2026 (перший кейс — 90724-00/31548-00).
      { text: '🗒️ Робочий блокнот', path: 'bloknot/index.html', role: 'expert' },
      {
        text: '🧭 СКО-Д', items: [
          { text: 'Внесення роботи', path: 'cabinet/index.html', role: 'expert' },
          { text: 'Планувальник', path: 'cabinet/planner.html', role: 'expert' },
          { text: 'Звіти та аналітика', path: 'skod/reports.html', role: 'expert' },
          { text: 'Доручення', path: 'skod/tasks.html', role: 'manager' }
        ]
      },
      {
        text: '🗳️ Взаємодія', items: [
          { text: 'Питання ЗОЗ', path: 'zoz-questions/index.html', role: 'expert' },
          { text: 'Пропозиції ПМГ', path: 'pmg-proposals/index.html', role: 'expert' },
          { text: 'Пропозиції робочих груп', path: 'expert-proposals/index.html', role: 'expert' }
        ]
      },
      {
        text: '🛠️ Інструменти', items: [
          { text: 'Машина пошуку', path: 'pakety/report.html', role: 'expert' },
          { text: 'Конструктор зв\'язків', path: 'dec/linker.html', role: 'expert' }
        ]
      },
      { text: '⏰ Календар нагадувань', path: 'reminders/index.html', role: 'expert' },
      { text: '📰 Новини', path: 'news/index.html', role: 'expert' },
      { text: '🌿 Хвилинка відпочинку', path: 'relax/index.html', role: 'expert' }
    ];

    const appendNavLinks = (items) => {
      items.forEach(item => {
        if (item.role && !hasAccess(item.role)) {
          return; // Hide completely
        }
        if (item.hideWhenActive && isActive(item.path)) {
          return; // Посилання на сторінку, де ми вже стоїмо
        }
        const a = document.createElement('a');
        a.href = prefix + item.path;

        if (item.isChat) {
          a.className = 'nav-chat-btn';
        }
        a.textContent = item.text;

        if (isActive(item.path)) {
          a.classList.add('active');
          a.setAttribute('aria-current', 'page');
        }
        navContainer.appendChild(a);
      });
    };

    /** Посилання всередині дропдауна — і в меню, і в підменю однакове. */
    const makeMenuLink = (item) => {
      const a = document.createElement('a');
      a.href = prefix + item.path;
      a.innerHTML = `<span>${item.text}</span>`;
      if (isActive(item.path)) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
      return a;
    };

    /**
     * Пільгова секунда перед закриттям меню.
     *
     * Меню відкривається наведенням, а закривалося чистим CSS - миттєво, щойно
     * курсор виходив за межі елемента. На шляху до потрібного пункту курсор
     * майже завжди зрізає кут (а в гніздо другого рівня йде по діагоналі),
     * на мить втрачає зону - і меню зникає просто під рукою. Тому вихід лише
     * запускає таймер: клас hover-open тримає меню відкритим ще секунду, і
     * повернення курсора цей таймер скасовує.
     *
     * CSS-правило :hover лишається на місці - воно й далі відкриває меню;
     * hover-open тільки не дає йому закритися одразу.
     */
    const NAV_HOVER_GRACE = 1000;

    const navCloseNow = (el) => {
      clearTimeout(el._navCloseTimer);
      el._navCloseTimer = null;
      el.classList.remove('hover-open');
      if (typeof el._navClose === 'function') el._navClose();
    };
    const navHold = (el) => {
      clearTimeout(el._navCloseTimer);
      el._navCloseTimer = null;
      el.classList.add('hover-open');
    };
    const navReleaseLater = (el) => {
      clearTimeout(el._navCloseTimer);
      el._navCloseTimer = setTimeout(() => navCloseNow(el), NAV_HOVER_GRACE);
    };

    /**
     * Гніздо другого рівня: заголовок у меню + випадайка збоку.
     * Наведення відкриває саме так, як увесь дропдаун вище, а клік
     * лишає меню відкритим — інакше на тач-екранах у гніздо не зайти.
     */
    const makeSubgroup = (group) => {
      const wrap = document.createElement('div');
      wrap.className = 'nav-subgroup';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-subgroup-btn';
      if (group.items.some(sub => isActive(sub.path))) btn.classList.add('active');
      btn.innerHTML = `<span>${group.text}</span><span class="nav-subgroup-arrow">▸</span>`;
      btn.setAttribute('aria-label', group.text);
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');

      const submenu = document.createElement('div');
      submenu.className = 'nav-submenu';
      group.items.forEach(sub => submenu.appendChild(makeMenuLink(sub)));

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = submenu.classList.toggle('show');
        btn.setAttribute('aria-expanded', String(open));
      });

      wrap.addEventListener('mouseenter', () => navHold(wrap));
      wrap.addEventListener('mouseleave', () => navReleaseLater(wrap));

      wrap.appendChild(btn);
      wrap.appendChild(submenu);
      return wrap;
    };

    const appendDropdown = (label, items) => {
      const visibleItems = items
        .map(item => item.items
          ? { ...item, items: item.items.filter(sub => hasAccess(sub.role)) }
          : item)
        .filter(item => item.items ? item.items.length > 0 : hasAccess(item.role));
      if (visibleItems.length === 0) return;

      const itemActive = (item) => item.items
        ? item.items.some(sub => isActive(sub.path))
        : isActive(item.path);
      const isDropdownActive = visibleItems.some(itemActive);

      const dropdownDiv = document.createElement('div');
      dropdownDiv.className = 'nav-dropdown';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-dropdown-btn';
      if (isDropdownActive) btn.classList.add('active');
      btn.innerHTML = `${label} <span class="nav-dropdown-arrow">▼</span>`;

      const menuDiv = document.createElement('div');
      menuDiv.className = 'nav-dropdown-menu';

      visibleItems.forEach(item => {
        menuDiv.appendChild(item.items ? makeSubgroup(item) : makeMenuLink(item));
      });

      // Гніздо, відкрите кліком, не має лишатися відкритим після того, як
      // курсор пішов із меню: інакше наступне наведення на вкладку одразу
      // вивалює чуже підменю. Тепер це робиться після пільгової секунди.
      dropdownDiv._navClose = () => {
        menuDiv.querySelectorAll('.nav-subgroup').forEach(sub => navCloseNow(sub));
        menuDiv.querySelectorAll('.nav-submenu.show').forEach(sub => {
          sub.classList.remove('show');
          sub.previousElementSibling?.setAttribute('aria-expanded', 'false');
        });
      };

      dropdownDiv.addEventListener('mouseenter', () => {
        // Сусідні вкладки гасимо негайно: під час пільгової секунди інакше
        // висіли б два розгорнуті меню одночасно.
        navContainer.querySelectorAll('.nav-dropdown.hover-open').forEach(other => {
          if (other !== dropdownDiv) navCloseNow(other);
        });
        navHold(dropdownDiv);
      });
      dropdownDiv.addEventListener('mouseleave', () => navReleaseLater(dropdownDiv));

      dropdownDiv.appendChild(btn);
      dropdownDiv.appendChild(menuDiv);
      navContainer.appendChild(dropdownDiv);
    };

    // Клік повз меню закриває його одразу: чекати секунду там, де намір
    // очевидний, було б навпаки незручно. Вішається один раз на документ.
    if (!document._navGraceBound) {
      document._navGraceBound = true;
      document.addEventListener('pointerdown', (e) => {
        document.querySelectorAll('.nav-dropdown.hover-open, .nav-subgroup.hover-open')
          .forEach(el => { if (!el.contains(e.target)) navCloseNow(el); });
      }, true);
    }

    // Головна · Пакети ▼ · Довідники ▼ · Документи ▼ · Сервіси ▼ · Інфоцентр ·
    // Структура Департаменту · Робочий чат.
    // Зліва направо: зміст ПМГ (пакет → чим його кодують → на чому стоїть),
    // далі робочі сервіси, і аж потім усе, що про сам департамент.
    appendBackLink(navContainer);
    appendNavLinks(coreItems);
    appendDropdown('Пакети', packagesItems);
    appendDropdown('📚 Довідники', referenceItems);
    appendDropdown('Документи', documentsItems);
    appendDropdown('Сервіси', servicesItems);
    appendNavLinks(tailItems);
  }

  // Мобільна нижня панель навігації (стилі в auth-v2.css)
  buildMobileTabbar(prefix, hasAccess, isActive);

  // Мобільний макет шапки: банер департаменту + статус окремим рядком
  applyMobileHeaderLayout();

  // Page-level guard
  const required = document.body.dataset.requiredRole;
  if (required && !hasAccess(required)) {
    const overlay = document.getElementById('access-denied-overlay');
    if (overlay) {
      const msg = document.getElementById('access-denied-msg');
      if (msg) {
        if (required === 'expert') {
          msg.textContent = 'Ця сторінка доступна лише для співробітників департаменту.';
        } else if (required === 'manager') {
          msg.textContent = 'Ця сторінка доступна лише для керівництва (Директор, Заступники, Начальники відділів та Адміністратор).';
        } else {
          msg.textContent = 'Ця сторінка доступна лише для авторизованих користувачів.';
        }
      }
      overlay.style.display = 'flex';
    }
  }

  // Inject User Dashboard banner below header
  const header = document.querySelector('header.top');
  let dashboard = document.getElementById('user-task-dashboard');
  if (dashboard) dashboard.remove();
  dashboard = null;

  // Дашборд не потрібен: на головній є «Мій робочий стан», в особистому кабінеті — власні метрики,
  // на сторінках доручень і звітів — власний зміст (дашборд його лише дублював)
  const isHomePage = !isInSubdir && document.getElementById('home-metrics') !== null;
  const isCabinetPage = currentPath.includes('cabinet');
  const isTasksPage = currentPath.includes('skod/tasks') || currentPath.includes('skod/reports');
  const isMapPage = currentPath.includes('/map/') || currentPath.endsWith('/map');
  // Пілотні проєкти — довідкова сторінка з власним банером розділу; смуга
  // «Вітаємо… активні доручення» тут лише відтісняла зміст униз
  const isPilotsPage = currentPath.includes('/pilots');

  let alertBanner = document.getElementById('user-news-alert-banner');
  if (header) {
    if (!user || role === 'guest' || currentPath.includes('passport')) {
      if (alertBanner) alertBanner.remove();
    } else {
      if (!isHomePage && !isCabinetPage && !isTasksPage && !isMapPage && !isPilotsPage) {
        dashboard = document.createElement('div');
        dashboard.id = 'user-task-dashboard';
        dashboard.className = 'user-task-dashboard';
        header.insertAdjacentElement('afterend', dashboard);
        // Тримаємо під смугу місце тієї висоти, яку вона мала минулого разу:
        // її зміст приходить після трьох запитів, і без резерву поява смуги
        // зсувала весь зміст сторінки вниз. Резерв знімає сам renderDashboard,
        // щойно напише зміст. Робимо це на обох проходах: справжній прохід
        // перестворює елемент, тож інакше резерв зник би саме перед показом.
        try {
          const h = parseInt(localStorage.getItem(BOOT_DASH_KEY) || '0', 10);
          if (h > 0) dashboard.style.minHeight = h + 'px';
        } catch (e) { /* приватний режим — без резерву */ }
        // На проході за знімком у мережу не йдемо: справжній прохід зробить це
        // за кілька десятків мілісекунд
        if (!bootPaint) renderDashboard(dashboard, prefix);
      }

      if (!alertBanner) {
        alertBanner = document.createElement('div');
        alertBanner.id = 'user-news-alert-banner';
      }
      (dashboard || header).insertAdjacentElement('afterend', alertBanner);
      if (!bootPaint) renderAlertBanner(alertBanner, prefix);
    }
  }

  // Show/hide online chip for guests and unregistered users
  const onlineChip = document.getElementById('portal-online-chip');
  if (onlineChip) {
    if (user && role !== 'guest') {
      onlineChip.style.display = '';
    } else {
      onlineChip.style.display = 'none';
    }
  }
}

function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  document.getElementById('auth-login-form').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('auth-reg-form').style.display   = tab === 'register' ? '' : 'none';
  document.getElementById('login-error').textContent = '';
  const regErr = document.getElementById('reg-error');
  regErr.textContent = '';
  regErr.style.color = '';
}

function openModal(tab = 'login') {
  document.getElementById('auth-overlay').style.display = 'flex';
  switchTab(tab);
}

function closeModal() {
  document.getElementById('auth-overlay').style.display = 'none';
}

async function onLogin(e) {
  e.preventDefault();
  const btn = e.submitter;
  const errEl = document.getElementById('login-error');
  btn.disabled = true;
  btn.textContent = 'Завантаження...';
  const { error } = await sb.auth.signInWithPassword({
    email:    document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-pass').value,
  });
  btn.disabled = false;
  btn.textContent = 'Увійти';
  if (error) {
    errEl.textContent = error.message.includes('Invalid')
      ? 'Невірний email або пароль'
      : error.message;
  } else {
    closeModal();
  }
}

async function onRegister(e) {
  e.preventDefault();
  const btn = e.submitter;
  const errEl = document.getElementById('reg-error');
  btn.disabled = true;
  btn.textContent = 'Реєстрація...';
  const { error } = await sb.auth.signUp({
    email:    document.getElementById('reg-email').value.trim(),
    password: document.getElementById('reg-pass').value,
    options:  { data: {
      full_name:    document.getElementById('reg-name').value.trim(),
      department:   document.getElementById('reg-dept').value,
      position:     document.getElementById('reg-dept').value === 'Гість (інший департамент)'
                      ? '' : document.getElementById('reg-position').value,
      organization: 'Департамент стратегії універсального охоплення населення медичними послугами'
    }},
  });
  btn.disabled = false;
  btn.textContent = 'Зареєструватись';
  if (error) {
    errEl.style.color = '';
    errEl.textContent = error.message;
  } else {
    errEl.style.color = 'var(--teal, #087e82)';
    errEl.textContent = 'Лист підтвердження надіслано на вашу пошту.';
    e.target.reset();
  }
}

function inject() {
  // Auth elements inside nav/container
  const container = document.querySelector('.auth-container') || document.querySelector('nav.section-switch');

  // Глобальний пошук: широкий рядок між банером (top-row-1) і навігацією (top-row-2);
  // на сторінках з нестандартною шапкою — маленька кнопка в auth-контейнері
  const topInner = document.querySelector('header.top .top-inner');
  const navRow = topInner ? topInner.querySelector('.top-row-2') : null;
  if (navRow) {
    const searchRow = document.createElement('div');
    searchRow.className = 'global-search-row';
    searchRow.innerHTML = `
      <button id="global-search-btn" class="global-search-bar" type="button" title="Глобальний пошук по порталу (Ctrl+K)">
        <span class="gs-bar-icon">🔍</span>
        <span class="gs-bar-text">Пошук по порталу: пакети, постанова, роз'яснення, договори…</span>
        <kbd class="gs-btn-kbd">Ctrl K</kbd>
      </button>`;
    topInner.insertBefore(searchRow, navRow);
    searchRow.querySelector('button').addEventListener('click', openGlobalSearch);
  } else if (container) {
    const searchBtn = document.createElement('button');
    searchBtn.id = 'global-search-btn';
    searchBtn.className = 'global-search-btn';
    searchBtn.type = 'button';
    searchBtn.title = 'Глобальний пошук по порталу (Ctrl+K)';
    searchBtn.innerHTML = '🔍 <span class="gs-btn-lbl">Пошук</span><kbd class="gs-btn-kbd">Ctrl K</kbd>';
    searchBtn.addEventListener('click', openGlobalSearch);
    container.appendChild(searchBtn);
  }

  if (container) {
    // Global Online counter pill
    const onlineChip = document.createElement('div');
    onlineChip.id = 'portal-online-chip';
    onlineChip.className = 'portal-online-chip';
    onlineChip.innerHTML = `
      <span class="online-glowing-dot"></span>
      <span id="portal-online-count" class="online-count-lbl">0</span> в мережі
      <div class="online-users-dropdown" id="online-users-dropdown">
        <div class="dropdown-title">Зараз на порталі:</div>
        <ul class="dropdown-users-list" id="portal-online-users-list">
          <li>Завантаження...</li>
        </ul>
      </div>
    `;
    container.appendChild(onlineChip);

    // Theme Toggle Button
    const themeBtn = document.createElement('button');
    themeBtn.id = 'theme-toggle-btn';
    themeBtn.className = 'theme-toggle-btn';
    themeBtn.title = 'Перемикач теми (світла / темна)';
    const savedTheme = localStorage.getItem('portal-theme') || 'light';
    themeBtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    themeBtn.addEventListener('click', toggleTheme);
    container.appendChild(themeBtn);

    // News Notifications Toggle Button
    const newsNotifyBtn = document.createElement('button');
    newsNotifyBtn.id = 'news-notify-btn';
    newsNotifyBtn.className = 'news-notify-toggle-btn';
    const notificationsEnabled = localStorage.getItem('news_notifications_enabled') !== 'false';
    if (!notificationsEnabled) {
      newsNotifyBtn.classList.add('muted');
    }
    newsNotifyBtn.textContent = notificationsEnabled ? '🔔' : '🔕';
    newsNotifyBtn.title = notificationsEnabled ? 'Вимкнути сповіщення новин' : 'Увімкнути сповіщення новин';
    newsNotifyBtn.addEventListener('click', () => {
      const isCurrentlyEnabled = localStorage.getItem('news_notifications_enabled') !== 'false';
      const nextEnabled = !isCurrentlyEnabled;
      localStorage.setItem('news_notifications_enabled', nextEnabled ? 'true' : 'false');
      
      newsNotifyBtn.classList.toggle('muted', !nextEnabled);
      newsNotifyBtn.textContent = nextEnabled ? '🔔' : '🔕';
      newsNotifyBtn.title = nextEnabled ? 'Вимкнути сповіщення новин' : 'Увімкнути сповіщення новин';
      
      if (nextEnabled) {
        // Play audio alert to test
        playNewsAlertSound();
        // Request browser permission if default
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }
    });
    container.appendChild(newsNotifyBtn);

    // Role badge indicator
    const badge = document.createElement('span');
    badge.id = 'auth-role-badge';
    badge.className = 'auth-role-badge role-guest';
    badge.textContent = 'Гість';
    container.appendChild(badge);

    // Daily Status Badge/Dropdown Chip
    const statusChip = document.createElement('div');
    statusChip.id = 'portal-status-chip';
    statusChip.className = 'portal-status-chip';
    statusChip.style.display = 'none'; // Hidden by default, shown when logged in
    statusChip.innerHTML = `
      <span class="status-caption">Статус сьогодні:</span>
      <span class="status-icon">❓</span>
      <span class="status-lbl">Вкажіть статус</span>
      <div class="status-dropdown" id="portal-status-dropdown">
        <div class="status-nag-head">
          <div class="nag-eyebrow">Щоденна відмітка</div>
          <div class="nag-title">Ви ще не вказали статус на сьогодні</div>
          <div class="nag-sub">Оберіть, звідки працюєте — це одна секунда, і табель зійдеться.</div>
        </div>
        <div class="dropdown-title">Мій статус на сьогодні:</div>
        <div class="status-options-grid">
          <button class="status-opt-btn" data-status="office">🏢 Офіс</button>
          <button class="status-opt-btn" data-status="home">🏡 Вдома</button>
          <button class="status-opt-btn" data-status="sick">🏥 Лікарняний</button>
          <button class="status-opt-btn" data-status="vacation">🌴 Відпустка</button>
          <button class="status-opt-btn" data-status="agreement">🤝 За домовл.</button>
        </div>
        <div class="status-until-row" id="status-until-row" style="display:none;">
          <div class="until-title" id="status-until-title">До якої дати (включно)?</div>
          <input type="date" id="status-until-input">
          <div class="until-hint" id="status-until-hint">Статус проставиться на всі дні автоматично — щодня нічого натискати не треба.</div>
          <div class="until-actions">
            <button type="button" class="until-confirm" id="status-until-confirm">Зберегти</button>
            <button type="button" class="until-cancel" id="status-until-cancel">Скасувати</button>
          </div>
        </div>
        <div class="dropdown-divider"></div>
        <div class="dropdown-title">Присутність колег сьогодні:</div>
        <ul class="colleagues-status-list" id="colleagues-status-list">
          <li style="color: var(--muted); font-style: italic;">Завантаження...</li>
        </ul>
        <div class="dropdown-divider"></div>
        <a href="#" id="view-status-stats-link" class="status-stats-link">📊 Детальна статистика статусів</a>
        <div class="status-nag-foot">
          <button type="button" class="status-nag-later" id="status-nag-later">Пізніше — нагадати за годину</button>
        </div>
      </div>
    `;
    container.appendChild(statusChip);
    // Статус — першочергова щоденна дія, тому він стоїть перед
    // перемикачем теми, сповіщеннями та бейджем ролі у верхній панелі.
    container.insertBefore(statusChip, themeBtn);

    // Той самий обробник вішається і на саме вікно: у режимі нагадування
    // воно живе в <body>, поза чіпом, і кліки до чіпа вже не спливають.
    const onStatusClick = (e) => {
      const optBtn = e.target.closest('.status-opt-btn');
      if (optBtn) {
        e.stopPropagation();
        const selectedStatus = optBtn.dataset.status;
        if (selectedStatus === 'sick' || selectedStatus === 'vacation') {
          openStatusUntilPicker(selectedStatus);
        } else {
          hideStatusUntilPicker();
          saveUserDailyStatus(selectedStatus);
        }
        return;
      }

      const untilRow = e.target.closest('#status-until-row');
      if (untilRow) {
        e.stopPropagation();
        if (e.target.closest('#status-until-confirm')) {
          const input = document.getElementById('status-until-input');
          const untilDate = input?.value;
          if (!untilDate || untilDate < getLocalDateString()) {
            alert('Оберіть дату завершення (не раніше сьогодні).');
            return;
          }
          const pendingStatus = untilRow.dataset.pendingStatus;
          hideStatusUntilPicker();
          saveUserDailyStatus(pendingStatus, untilDate);
        } else if (e.target.closest('#status-until-cancel')) {
          hideStatusUntilPicker();
        }
        return;
      }

      const statsLink = e.target.closest('#view-status-stats-link');
      if (statsLink) {
        return;
      }

      if (e.target.closest('#status-nag-later')) {
        e.stopPropagation();
        snoozeStatusNag();
        closeStatusDropdown();
        return;
      }

      const dropdown = document.getElementById('portal-status-dropdown');
      if (dropdown) {
        e.stopPropagation();
        // Кліки в тілі великого вікна його не закривають — лише в шапці-чіпі
        if (dropdown.classList.contains('nag-mode') && dropdown.contains(e.target)) return;
        if (dropdown.classList.contains('show')) closeStatusDropdown();
        else openStatusDropdown();
      }
    };

    statusChip.addEventListener('click', onStatusClick);
    statusChip.querySelector('#portal-status-dropdown')
      ?.addEventListener('click', onStatusClick);

    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('portal-status-dropdown');
      const chip = document.getElementById('portal-status-chip');
      if (dropdown && dropdown.classList.contains('show') && chip &&
          !chip.contains(e.target) && !dropdown.contains(e.target)) {
        // Клік поза вікном: у режимі нагадування це відкладення, а не просто закриття
        if (dropdown.classList.contains('nag-mode')) snoozeStatusNag();
        closeStatusDropdown();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const dropdown = document.getElementById('portal-status-dropdown');
      if (!dropdown || !dropdown.classList.contains('show')) return;
      if (dropdown.classList.contains('nag-mode')) snoozeStatusNag();
      closeStatusDropdown();
    });

    // Standalone Chat button in top nav
    const topChatBtn = document.createElement('a');
    topChatBtn.id = 'auth-chat-btn';
    topChatBtn.className = 'auth-chat-btn';
    topChatBtn.textContent = 'Робочий чат';
    container.appendChild(topChatBtn);

    // Standalone Personal Cabinet button in top nav
    const topCabinetBtn = document.createElement('a');
    topCabinetBtn.id = 'auth-cabinet-btn';
    topCabinetBtn.className = 'auth-cabinet-btn';
    topCabinetBtn.textContent = 'Особистий кабінет';
    container.appendChild(topCabinetBtn);

    // Standalone Tasks button in top nav
    const topTasksBtn = document.createElement('a');
    topTasksBtn.id = 'auth-tasks-btn';
    topTasksBtn.className = 'auth-tasks-btn';
    topTasksBtn.textContent = 'Доручення';
    container.appendChild(topTasksBtn);

    // Standalone Regulatory Admin button in top nav
    const topRegBtn = document.createElement('a');
    topRegBtn.id = 'auth-regulatory-btn';
    topRegBtn.className = 'auth-regulatory-btn';
    topRegBtn.textContent = 'Управління нормами';
    container.appendChild(topRegBtn);

    const btn = document.createElement('button');
    btn.id = 'auth-nav-btn';
    btn.className = 'auth-nav-btn';
    btn.textContent = 'Увійти';
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-signed-in')) sb.auth.signOut();
      else openModal();
    });
    container.appendChild(btn);
  }

  // Modal + access denied
  document.body.insertAdjacentHTML('beforeend', `
<div id="auth-overlay" class="auth-overlay" style="display:none" role="dialog" aria-modal="true" aria-label="Вхід">
  <div class="auth-modal">
    <button class="auth-modal-close" id="auth-close" aria-label="Закрити">&times;</button>
    <div class="auth-brand">НавігаторПМГ26</div>
    <div class="auth-tabs" role="tablist">
      <button class="auth-tab active" data-tab="login" role="tab">Увійти</button>
      <button class="auth-tab" data-tab="register" role="tab">Реєстрація</button>
    </div>
    <form id="auth-login-form" novalidate>
      <div class="auth-field">
        <label for="login-email">Email</label>
        <input id="login-email" type="email" autocomplete="email" required>
      </div>
      <div class="auth-field">
        <label for="login-pass">Пароль</label>
        <input id="login-pass" type="password" autocomplete="current-password" required>
      </div>
      <div class="auth-error" id="login-error"></div>
      <button type="submit" class="auth-submit">Увійти</button>
    </form>
    <form id="auth-reg-form" style="display:none" novalidate>
      <div class="auth-field">
        <label for="reg-email">Email</label>
        <input id="reg-email" type="email" autocomplete="email" required>
      </div>
      <div class="auth-field">
        <label for="reg-pass">Пароль <span class="auth-hint">(мін. 6 символів)</span></label>
        <input id="reg-pass" type="password" autocomplete="new-password" minlength="6" required>
      </div>
      <div class="auth-field">
        <label for="reg-name">Ім'я та прізвище *</label>
        <input id="reg-name" type="text" autocomplete="name" required>
      </div>
      <div class="auth-field">
        <label for="reg-dept">Відділ (підрозділ) *</label>
        <select id="reg-dept" required>
          <option value="розрахунок вартості медичних послуг">розрахунок вартості медичних послуг</option>
          <option value="робота з електронними медичними даними">робота з електронними медичними даними</option>
          <option value="взаємодія з надавачами медичних послуг">взаємодія з надавачами медичних послуг</option>
          <option value="розвиток програми реімбурсації">розвиток програми реімбурсації</option>
          <option value="наукова та клінічна експертиза">наукова та клінічна експертиза</option>
          <option value="стратегічного розвитку програми медичних гарантій">стратегічного розвитку програми медичних гарантій</option>
          <option value="Гість (інший департамент)">Гість (інший департамент)</option>
        </select>
      </div>
      <div class="auth-field" id="reg-position-field">
        <label for="reg-position">Посада *</label>
        <select id="reg-position" required>
          <option value="Експерт">Експерт</option>
          <option value="Діловод департаменту">Діловод департаменту</option>
          <option value="Начальник відділу">Начальник відділу</option>
          <option value="Заступник директора">Заступник директора</option>
          <option value="Директор">Директор</option>
          <option value="Адміністратор">Адміністратор</option>
        </select>
      </div>
      <div class="auth-error" id="reg-error"></div>
      <button type="submit" class="auth-submit">Зареєструватись</button>
    </form>
  </div>
</div>
<div id="access-denied-overlay" class="access-denied-overlay" style="display:none">
  <div class="access-denied-box">
    <h2>Доступ обмежено</h2>
    <p id="access-denied-msg">Ця сторінка доступна лише для зареєстрованих користувачів.</p>
    <button class="auth-submit" id="access-denied-btn">Увійти / Зареєструватись</button>
  </div>
</div>`);

  document.getElementById('auth-close').addEventListener('click', closeModal);
  document.getElementById('auth-overlay').addEventListener('click', e => {
    if (e.target.id === 'auth-overlay') closeModal();
  });
  document.getElementById('access-denied-btn').addEventListener('click', () => openModal());
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );
  document.getElementById('auth-login-form').addEventListener('submit', onLogin);
  document.getElementById('auth-reg-form').addEventListener('submit', onRegister);

  // Auto-selection logic based on name and position
  const regName = document.getElementById('reg-name');
  const regDept = document.getElementById('reg-dept');
  const regPos = document.getElementById('reg-position');

  if (regName && regDept && regPos) {
    // Автопідстановка посад за конкретними прізвищами прибрана:
    // репозиторій публічний, тримати в ньому список керівництва не можна.
    // Роль і посаду виставляє адміністратор у profiles після реєстрації.

    regPos.addEventListener('change', () => {
      if (regPos.value === 'Заступник директора') {
        regDept.value = 'стратегічного розвитку програми медичних гарантій';
      }
    });

    // Гість з іншого департаменту: посада не вказується
    const posField = document.getElementById('reg-position-field');
    const syncGuestFields = () => {
      const isGuest = regDept.value === 'Гість (інший департамент)';
      posField.style.display = isGuest ? 'none' : '';
      regPos.required = !isGuest;
    };
    regDept.addEventListener('change', syncGuestFields);
    syncGuestFields();
  }
}

async function renderDashboard(dashboardEl, prefix) {
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
  
  let userDept = '';
  try {
    const { data: prof } = await sb.from('profiles').select('Section, department').eq('id', user.id).single();
    userDept = prof?.Section || prof?.department || '';
  } catch(e) {}

  let userTasks = [];
  try {
    const { data } = await sb
      .from('assigned_tasks')
      .select('id, title, deadline, progress, status, description, importance, task_type, askod_number, askod_sender')
      .eq('responsible_id', user.id)
      .neq('status', 'completed')
      .order('deadline', { ascending: true });
    userTasks = (data || []).filter(t => t.status !== 'completed' && t.progress < 100);
  } catch(e) {}

  // Load active reporting reminders with warnings for the current user
  let activeReminders = [];
  try {
    let rawEvents = [];
    try {
      const { data, error } = await sb.from('reporting_events').select('*').eq('executor_id', user.id).neq('status', 'Надіслано');
      if (!error && data) rawEvents = data;
    } catch(e) {}
    
    if (rawEvents.length === 0) {
      const local = localStorage.getItem('reporting_events');
      if (local) {
        const parsed = JSON.parse(local);
        rawEvents = parsed.filter(ev => ev.executor_id === user.id && ev.status !== 'Надіслано');
      }
    }
    
    // Business days count helper
    const getBizDays = (startDate, endDate) => {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(0, 0, 0, 0);
      if (start > end) return -getBizDays(end, start);
      if (start.getTime() === end.getTime()) return 0;
      let count = 0;
      const current = new Date(start);
      while (current < end) {
        current.setDate(current.getDate() + 1);
        if (current.getDay() !== 0 && current.getDay() !== 6) count++;
      }
      return count;
    };
    
    const today = new Date();
    rawEvents.forEach(ev => {
      const deadline = new Date(ev.deadline_date);
      const bizDays = getBizDays(today, deadline);
      
      let tier = null;
      let urgency = '';
      let warningText = '';
      let badgeLabel = '';
      
      if (bizDays < 0) {
        tier = 'overdue';
        urgency = 'critical';
        warningText = `Прострочено на ${Math.abs(bizDays)} дн.`;
        badgeLabel = 'Прострочено';
      } else if (bizDays === 0) {
        tier = 'deadline';
        urgency = 'critical';
        warningText = `ДЕДЛАЙН СЬОГОДНІ!`;
        badgeLabel = 'Дедлайн';
      } else if (bizDays <= 2) {
        tier = 'warning-2';
        urgency = 'high';
        warningText = `Залишилось ${bizDays} роб. дн.`;
        badgeLabel = 'Критично';
      } else if (bizDays <= 5) {
        tier = 'warning-5';
        urgency = 'medium';
        warningText = `Залишилось ${bizDays} роб. дн.`;
        badgeLabel = 'Важливо';
      } else if (bizDays === 15) {
        tier = 'warning-15';
        urgency = 'low';
        warningText = `Залишилося 15 роб. дн.`;
        badgeLabel = 'Нагадування';
      }
      
      if (tier) {
        activeReminders.push({
          id: ev.id,
          title: ev.title,
          deadline_date: ev.deadline_date,
          warningText: warningText,
          urgency: urgency,
          badgeLabel: badgeLabel
        });
      }
    });
  } catch(e) {
    console.error("Dashboard reminders error:", e);
  }

  const showManagerAction = ['admin', 'director', 'deputy_director', 'manager'].includes(role);

  dashboardEl.innerHTML = `
    <div class="wrap dashboard-inner">
      <div class="user-info-section">
        <div class="user-greeting">
          <span class="user-welcome">Вітаємо, <strong>${displayName}</strong>!</span>
          <span class="user-dept-badge">${userDept || 'Департамент'}</span>
        </div>
      </div>
      <div class="tasks-summary-section">
        ${userTasks.length > 0 ? `
          <div class="tasks-summary-header">
            <span class="tasks-summary-lbl">📋 Активні доручення на виконанні (всього: <strong>${userTasks.length}</strong>):</span>
          </div>
          <div class="tasks-brief-list">
            ${userTasks.map((t, index) => {
              const daysLeft = Math.ceil((new Date(t.deadline) - new Date()) / (1000 * 60 * 60 * 24));
              const dateStr = new Date(t.deadline).toLocaleDateString('uk-UA');
              const dateClass = daysLeft < 0 ? 'overdue' : (daysLeft <= 3 ? 'urgent' : 'normal');
              const daysText = daysLeft < 0 ? `(Протерміновано)` : (daysLeft === 0 ? `(Сьогодні!)` : `(залишилось ${daysLeft} дн.)`);
              const collapsedAttr = index >= 3 ? 'class="task-brief-item is-collapsed-hidden" style="display: none;"' : 'class="task-brief-item"';
              
              const bulbColor = daysLeft < 0 ? 'red' : (daysLeft <= 3 ? 'yellow' : 'green');
              const askodBadge = t.task_type === 'askod' && t.askod_number
                ? `<span style="font-size:10px; font-weight:700; background:rgba(59, 130, 246, 0.15); color:var(--accent-deep); padding: 2px 6px; border-radius: 4px; font-family:monospace; margin-left: 6px; display:inline-block; vertical-align: middle;">№ ${t.askod_number}</span>`
                : '';
              
              return `
                <div ${collapsedAttr}>
                  <!-- Header Row -->
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;">
                    <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                      <span class="glow-bulb ${bulbColor}" title="Терміновість: ${daysText}"></span>
                      <span class="task-brief-title" style="font-weight: 700; font-size: 13px;" title="${t.title.replace(/"/g, '&quot;')}">
                        <span style="color: var(--accent, #3b82f6); font-family: monospace; font-weight: 800; margin-right: 4px;">№ ${index + 1}</span>
                        ${t.title}
                        ${askodBadge}
                      </span>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                      <span style="font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px;" class="task-brief-deadline ${dateClass}">до ${dateStr}</span>
                      <div class="task-brief-progress-wrapper" style="width: 80px; margin: 0; gap: 6px;">
                        <div class="task-brief-progress-bg" style="height: 5px; margin: 0;">
                          <div class="task-brief-progress-bar" style="width: ${t.progress}%"></div>
                        </div>
                        <span class="task-brief-progress-val" style="font-size: 10.5px; min-width: 25px;">${t.progress}%</span>
                      </div>
                      <span class="expand-arrow" style="font-size: 10px; color: var(--p-muted); transition: transform 0.2s;">▼</span>
                    </div>
                  </div>
                  
                  <!-- Short description preview (visible when collapsed) -->
                  <div class="task-brief-desc-preview" style="font-size: 11px; color: var(--p-muted); padding-left: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
                    ${t.description || 'Опис відсутній'}
                  </div>

                  <!-- Expanded Details Panel -->
                  <div class="task-brief-details" style="display: none; padding-top: 10px; margin-top: 8px; border-top: 1px dashed var(--p-line, #e2e8f0); font-size: 12px; color: var(--p-ink);">
                    <div style="margin-bottom: 8px; line-height: 1.4;">
                      <strong>📝 Опис доручення:</strong> 
                      <div style="margin-top: 4px; background: var(--p-soft, #f7fafc); padding: 8px 12px; border-radius: 6px; color: var(--p-ink); font-size: 11.5px; border-left: 3px solid var(--accent); white-space: pre-line;">
                        ${t.description || 'Детальний опис доручення відсутній.'}
                      </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; flex-wrap: wrap; gap: 8px;">
                      <span style="font-size: 11px; color: var(--p-muted);">
                        Важливість: <strong>${t.importance === 'critical' ? '🔴 Термінова' : (t.importance === 'important' ? '🟡 Висока' : '🟢 Звичайна')}</strong>
                        ${t.department ? ` | Підрозділ: <strong>${t.department}</strong>` : ''}
                        ${t.askod_sender ? ` | Відправник: <strong>${t.askod_sender}</strong>` : ''}
                      </span>
                      <a href="${prefix}skod/task-detail.html?id=${t.id}" class="dashboard-action-btn primary" style="padding: 5px 12px; font-size: 11px; text-decoration: none; border-radius: 6px; background: var(--accent); color: white; display: inline-flex; align-items: center; gap: 4px; font-weight: 700;">
                        🔗 Відкрити картку доручення
                      </a>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          ${userTasks.length > 3 ? `
            <div style="font-size: 11px; text-align: right; margin-top: 4px; font-weight: 600;">
              <a href="#" id="dashboard-toggle-tasks" data-expanded="false" style="color: var(--accent, #3b82f6); text-decoration: none;">...та ще ${userTasks.length - 3} активних доручень (Розгорнути)</a>
            </div>
          ` : ''}
        ` : `
          <span class="tasks-summary-lbl font-soft">📋 У вас немає активних доручень на виконанні.</span>
        `}
      </div>
      
      <div class="reminders-summary-section">
        ${activeReminders.length > 0 ? `
          <div class="tasks-summary-header">
            <span class="tasks-summary-lbl">📅 Нагадування про терміни звітування (активних: <strong>${activeReminders.length}</strong>):</span>
          </div>
          <div class="reminders-brief-list">
            ${activeReminders.map((r, index) => {
              const itemClass = r.urgency === 'critical' ? 'critical' : (r.urgency === 'high' ? 'high' : '');
              const warningBadgeClass = r.urgency === 'critical' ? 'critical' : (r.urgency === 'high' ? 'high' : (r.urgency === 'medium' ? 'medium' : 'low'));
              const collapsedAttr = index >= 3 ? `class="reminder-brief-item ${itemClass} is-collapsed-hidden" style="display: none;"` : `class="reminder-brief-item ${itemClass}"`;
              return `
                <div ${collapsedAttr}>
                  <span class="reminder-brief-title" title="${r.title}">
                    <a href="${prefix}reminders/index.html" style="color: inherit; text-decoration: none; border-bottom: 1px dashed var(--accent, #3b82f6); transition: color 0.2s;" onmouseover="this.style.color='var(--accent, #3b82f6)'" onmouseout="this.style.color='inherit'">${r.title}</a>
                  </span>
                  <span class="reminder-brief-warning ${warningBadgeClass}">${r.badgeLabel}: ${r.warningText}</span>
                </div>
              `;
            }).join('')}
          </div>
          ${activeReminders.length > 3 ? `
            <div style="font-size: 11px; text-align: right; margin-top: 4px; font-weight: 600;">
              <a href="#" id="dashboard-toggle-reminders" data-expanded="false" style="color: var(--accent, #3b82f6); text-decoration: none;">...та ще ${activeReminders.length - 3} термінів (Розгорнути)</a>
            </div>
          ` : ''}
        ` : `
          <span class="tasks-summary-lbl font-soft">📅 Усі найближчі звіти успішно надіслано.</span>
        `}
      </div>

    </div>
  `;

  // Смуга приходить після трьох запитів і досі зсувала весь зміст униз.
  // Запам'ятовуємо її висоту: наступного разу applyAccess() потримає під неї
  // місце ще на проході за знімком — так само, як під смужку днів народження.
  dashboardEl.style.minHeight = '';
  try {
    localStorage.setItem(BOOT_DASH_KEY, String(Math.round(dashboardEl.offsetHeight)));
  } catch (e) { /* приватний режим — просто без резерву місця */ }

  // Attach event listeners for expand/collapse actions
  const toggleTasksBtn = dashboardEl.querySelector('#dashboard-toggle-tasks');
  if (toggleTasksBtn) {
    toggleTasksBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const hiddenItems = dashboardEl.querySelectorAll('.task-brief-item.is-collapsed-hidden');
      const isExpanded = toggleTasksBtn.dataset.expanded === 'true';
      
      hiddenItems.forEach(item => {
        item.style.display = isExpanded ? 'none' : 'flex';
      });
      
      toggleTasksBtn.dataset.expanded = !isExpanded;
      toggleTasksBtn.textContent = isExpanded 
        ? `...та ще ${userTasks.length - 3} активних доручень (Розгорнути)` 
        : `Згорнути список доручень`;
    });
  }

  const toggleRemindersBtn = dashboardEl.querySelector('#dashboard-toggle-reminders');
  if (toggleRemindersBtn) {
    toggleRemindersBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const hiddenItems = dashboardEl.querySelectorAll('.reminder-brief-item.is-collapsed-hidden');
      const isExpanded = toggleRemindersBtn.dataset.expanded === 'true';
      
      hiddenItems.forEach(item => {
        item.style.display = isExpanded ? 'none' : 'flex';
      });
      
      toggleRemindersBtn.dataset.expanded = !isExpanded;
      toggleRemindersBtn.textContent = isExpanded 
        ? `...та ще ${activeReminders.length - 3} термінів (Розгорнути)` 
        : `Згорнути список нагадувань`;
    });
  }

  // Add interactive click delegation for task-brief-item expansion
  dashboardEl.addEventListener('click', (e) => {
    const item = e.target.closest('.task-brief-item');
    if (item) {
      // Don't toggle if the user clicked on a link or button
      if (e.target.closest('a') || e.target.closest('button')) {
        return;
      }
      const details = item.querySelector('.task-brief-details');
      if (details) {
        const isVisible = details.style.display === 'block';
        details.style.display = isVisible ? 'none' : 'block';
        item.classList.toggle('is-expanded', !isVisible);
      }
    }
  });
}

async function init() {
  inject();

  // Перший прохід — за знімком: меню, бейдж ролі та рольові елементи стають на
  // місце ще до відповіді сервера. Мережу тут не чіпаємо (див. bootPaint), бо
  // за кілька десятків мілісекунд усе одно піде справжній прохід.
  if (boot) {
    user = { id: boot.uid, email: '', user_metadata: { full_name: boot.name } };
    role = boot.role;
    isHead = boot.isHead;
    isClerk = boot.isClerk;
    bootPaint = true;
    applyAccess();
    bootPaint = false;
  }

  const { data: { session } } = await sb.auth.getSession();
  user = session?.user ?? null;
  await fetchRole();
  saveBoot();
  applyAccess();

  trackGlobalPresence();
  setupNewsRealtime();
  setupTasksRealtime();
  startMeetingReminders();

  // Daily Status Initialization
  loadUserDailyStatus();
  loadTeamPresence();
  setupRealtimeStatus();

  // Ask for browser notification permission proactively if support is available
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  sb.auth.onAuthStateChange(async (_event, session) => {
    user = session?.user ?? null;
    await fetchRole();
    saveBoot();
    applyAccess();
    trackGlobalPresence();
    setupNewsRealtime();
    setupTasksRealtime();
    startMeetingReminders();

    // Daily Status update on Auth change
    loadUserDailyStatus();
    loadTeamPresence();
    setupRealtimeStatus();
  });
}

async function renderAlertBanner(alertBanner, prefix) {
  try {
    const { data, error } = await sb
      .from('news')
      .select('id, title, importance, created_at')
      .in('importance', ['important', 'urgent'])
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.warn("Failed to load news alerts:", error);
      alertBanner.style.display = 'none';
      return;
    }

    if (!data || data.length === 0) {
      alertBanner.style.display = 'none';
      return;
    }

    alertBanner.style.display = 'block';
    
    let hasUrgent = data.some(n => n.importance === 'urgent');
    alertBanner.className = hasUrgent ? 'news-alert-banner urgent' : 'news-alert-banner important';
    
    const icon = hasUrgent ? '🚨' : '⚠️';
    const titleText = hasUrgent ? 'Увага! Термінові оголошення:' : 'Важливі оголошення:';
    
    const escapeHtml = (str) => {
      if (!str) return "";
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    const linksHtml = data.map(n => {
      const isUrgent = n.importance === 'urgent';
      const badge = isUrgent 
        ? '<span class="alert-badge urgent"><span class="pulse-dot"></span> Терміново</span>' 
        : '<span class="alert-badge important">Важливо</span>';
      return `
        <div class="news-alert-item">
          ${badge}
          <a href="${prefix}news/index.html?id=${n.id}" class="news-alert-link" target="_blank">${escapeHtml(n.title)}</a>
        </div>
      `;
    }).join('');

    alertBanner.innerHTML = `
      <div class="wrap">
        <div class="news-alert-inner">
          <div class="news-alert-title">${icon} ${titleText}</div>
          <div class="news-alert-list">
            ${linksHtml}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("Alert banner render error:", err);
    alertBanner.style.display = 'none';
  }
}

let globalPresenceChannel = null;

async function trackGlobalPresence() {
  // Unsubscribe existing channel to recreate it with the new auth state
  if (globalPresenceChannel) {
    globalPresenceChannel.unsubscribe();
    globalPresenceChannel = null;
  }

  const isChatPage = window.location.pathname.toLowerCase().includes('/chat/');
  const displayName = user ? (user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0]) : null;

  globalPresenceChannel = sb.channel('chat_room', {
    config: {
      presence: {
        key: user ? user.id : 'anonymous-' + Math.random().toString(36).substring(2, 9)
      }
    }
  });

  globalPresenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = globalPresenceChannel.presenceState();
      updateGlobalOnlineCount(state);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        if (user && !isChatPage) {
          try {
            await globalPresenceChannel.track({
              user_id: user.id,
              user_name: displayName,
              online_at: new Date().toISOString()
            });
          } catch (e) {
            console.error("Failed to track global presence:", e);
          }
        }
      }
    });
}

function updateGlobalOnlineCount(state) {
  const countLbl = document.getElementById('portal-online-count');
  const dropdownList = document.getElementById('portal-online-users-list');
  if (!countLbl || !dropdownList) return;

  const uniqueUsers = [];
  const seenIds = new Set();

  for (const key in state) {
    const presences = state[key];
    if (presences && presences.length > 0) {
      const p = presences[0];
      if (p.user_id && !seenIds.has(p.user_id)) {
        seenIds.add(p.user_id);
        uniqueUsers.push({
          id: p.user_id,
          name: p.user_name || 'Співробітник'
        });
      }
    }
  }

  countLbl.textContent = uniqueUsers.length;

  dropdownList.innerHTML = "";
  if (uniqueUsers.length === 0) {
    dropdownList.innerHTML = '<li style="color: var(--muted); font-style: italic;">Нікого немає</li>';
  } else {
    uniqueUsers.forEach(u => {
      const li = document.createElement('li');
      li.textContent = u.name;
      dropdownList.appendChild(li);
    });
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark-theme');
  localStorage.setItem('portal-theme', isDark ? 'dark' : 'light');
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.textContent = isDark ? '☀️' : '🌙';
  }
}

/* ── Realtime News Subscription & Alerting ──────────────── */
let newsSubscription = null;

function setupNewsRealtime() {
  if (!user || role === 'guest') return;

  if (newsSubscription) {
    sb.removeChannel(newsSubscription);
    newsSubscription = null;
  }

  newsSubscription = sb.channel('realtime_news_alerts')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'news' }, payload => {
      const newArticle = payload.new;
      if (newArticle && ['important', 'urgent'].includes(newArticle.importance)) {
        triggerNewsAlertNotification(newArticle);
        
        // Re-render the alert banner dynamically if it's on screen
        const alertBanner = document.getElementById('user-news-alert-banner');
        if (alertBanner) {
          renderAlertBanner(alertBanner, getPathPrefix());
        }
      }
    })
    .subscribe();
}

function triggerNewsAlertNotification(newsItem) {
  const notificationsEnabled = localStorage.getItem('news_notifications_enabled') !== 'false';
  if (!notificationsEnabled) return;

  if (!('Notification' in window)) return;

  playNewsAlertSound();

  const isTabHidden = document.hidden || !document.hasFocus();
  if (isTabHidden && Notification.permission === 'granted') {
    const title = newsItem.importance === 'urgent' ? '🚨 Термінове оголошення!' : '⚠️ Важливе оголошення!';
    const prefix = getPathPrefix();

    const notification = new Notification(title, {
      body: newsItem.title,
      icon: prefix + "assets/nszu-shield.svg",
      tag: "news-alert",
      renotify: true
    });

    notification.onclick = () => {
      window.focus();
      window.open(prefix + "news/index.html?id=" + newsItem.id, "_blank");
      notification.close();
    };
  }
}

function playNewsAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    const gain2 = ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(440, ctx.currentTime);
    gain1.gain.setValueAtTime(0.08, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.3);

    setTimeout(() => {
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(554.37, ctx.currentTime);
      gain2.gain.setValueAtTime(0.08, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.4);
    }, 120);
  } catch (e) {
    console.error("Audio beep error:", e);
  }
}

/* ── Нагадування про зустрічі (планувальник, поки портал відкрито) ──
 *
 * Такт і запит до бази — РІЗНІ речі, і плутати їх дорого. Раніше кожні
 * 45 секунд ішов запит у planner_events — з кожної відкритої вкладки, у
 * кожного залогіненого, цілий день, заради події, якої зазвичай сьогодні
 * немає взагалі. Це 80 запитів на годину на вкладку.
 *
 * Тепер розклад на сьогодні береться раз і лежить у пам'яті, а такт лише
 * звіряє його з годинником — без мережі. База перепитується, коли настала
 * нова доба, коли кеш застарів (розклад могли поповнити в планувальнику)
 * або коли людина повернулася на вкладку.
 *
 * ⚠️ Такт при цьому НЕ зупиняється на схованій вкладці. Саме сховану
 * вкладку нагадування й обслуговує: fireMeetingReminder показує системне
 * сповіщення саме тоді, коли document.hidden. Зупинити такт означало б
 * вимкнути функцію рівно там, де вона потрібна.
 */
let meetingReminderTimer = null;
let meetingVisibilityBound = false;
let meetingCheckInFlight = false;
let meetingCache = { day: '', events: [], at: 0 };

const MEET_TICK_MS = 30000;             // локальна звірка з годинником
const MEET_REFRESH_MS = 10 * 60 * 1000; // як часто перепитувати базу

function meetingDayKey(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startMeetingReminders() {
  if (!user || role === 'guest') return;
  if (meetingReminderTimer) { clearInterval(meetingReminderTimer); meetingReminderTimer = null; }
  meetingCache = { day: '', events: [], at: 0 };
  checkMeetingReminders();
  meetingReminderTimer = setInterval(checkMeetingReminders, MEET_TICK_MS);
  if (!meetingVisibilityBound) {
    document.addEventListener('visibilitychange', onMeetingVisibility);
    meetingVisibilityBound = true;
  }
}

function onMeetingVisibility() {
  // Повернулися на вкладку — поки її не дивилися, у планувальнику могли
  // з'явитися нові події. Скидаємо вік кешу, щоб такт їх підтягнув.
  if (document.hidden) return;
  meetingCache.at = 0;
  checkMeetingReminders();
}

async function loadTodayMeetings(dayKey) {
  const { data, error } = await sb
    .from('planner_events')
    .select('id, title, start_time, meeting_link, status')
    .eq('user_id', user.id)
    .eq('event_date', dayKey)
    .eq('status', 'planned')
    .not('start_time', 'is', null);
  return error ? null : (data || []);
}

async function checkMeetingReminders() {
  if (!user || role === 'guest') return;
  if (localStorage.getItem('news_notifications_enabled') === 'false') return;
  if (meetingCheckInFlight) return;

  const now = new Date();
  const todayStr = meetingDayKey(now);

  // Нова доба — перепитуємо завжди, навіть на схованій вкладці: це раз на
  // день. Застарілий кеш оновлюємо лише коли вкладку видно.
  const stale = meetingCache.day !== todayStr ||
    (!document.hidden && Date.now() - meetingCache.at > MEET_REFRESH_MS);

  if (stale) {
    meetingCheckInFlight = true;
    try {
      const events = await loadTodayMeetings(todayStr);
      // Мережа впала — працюємо далі на тому, що вже маємо, а не мовчимо.
      if (events !== null) meetingCache = { day: todayStr, events, at: Date.now() };
    } finally {
      meetingCheckInFlight = false;
    }
  }

  meetingCache.events.forEach(ev => {
    const parts = String(ev.start_time).split(':');
    const start = new Date(now);
    start.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
    const minsLeft = (start - now) / 60000;
    if (minsLeft > 0 && minsLeft <= 15) fireMeetingReminder(ev, 'soon', Math.max(1, Math.round(minsLeft)));
    if (minsLeft <= 0.5 && minsLeft > -2) fireMeetingReminder(ev, 'now', 0);
  });
}

function fireMeetingReminder(ev, lead, mins) {
  const key = 'meetRmd:' + ev.id + ':' + lead;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');

  playNewsAlertSound();
  const prefix = getPathPrefix();
  const safeLink = /^https?:\/\//i.test(ev.meeting_link || '') ? ev.meeting_link : null;
  const url = safeLink || (prefix + 'cabinet/planner.html');
  const title = lead === 'now' ? '🔔 Зустріч починається!' : `🔔 Зустріч через ${mins} хв`;
  const body = ev.title + (safeLink ? ' · натисніть, щоб приєднатися' : '');

  const isTabHidden = document.hidden || !document.hasFocus();
  if (isTabHidden && 'Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, {
      body,
      icon: prefix + 'assets/nszu-shield.svg',
      tag: 'meeting-' + ev.id + '-' + lead,
      renotify: true,
      requireInteraction: true
    });
    n.onclick = () => { window.focus(); window.open(url, '_blank'); n.close(); };
  } else {
    showOnScreenToast(title, body, url);
  }
}

/* ── Realtime Tasks Subscription & Alerting ──────────────── */
let tasksSubscription = null;

function setupTasksRealtime() {
  if (!user || role === 'guest') return;

  if (tasksSubscription) {
    sb.removeChannel(tasksSubscription);
    tasksSubscription = null;
  }

  tasksSubscription = sb.channel('realtime_tasks_alerts')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assigned_tasks' }, payload => {
      const newTask = payload.new;
      if (newTask && newTask.responsible_id === user.id) {
        triggerTaskAlertNotification(newTask);

        // Dynamically re-render dashboard list if present on the page
        const dashboardEl = document.getElementById('user-task-dashboard');
        if (dashboardEl) {
          renderDashboard(dashboardEl, getPathPrefix());
        }
      }
    })
    .subscribe();
}

function triggerTaskAlertNotification(task) {
  const notificationsEnabled = localStorage.getItem('news_notifications_enabled') !== 'false';
  if (!notificationsEnabled) return;

  playNewsAlertSound();

  const importanceLabels = {
    normal: '🟢 Звичайна важливість',
    important: '🟡 Висока важливість',
    critical: '🔴 Термінова важливість'
  };
  const impText = importanceLabels[task.importance] || 'Звичайна важливість';
  const title = `Нове доручення (${impText})`;

  const prefix = getPathPrefix();
  const targetUrl = prefix + "skod/task-detail.html?id=" + task.id;

  const isTabHidden = document.hidden || !document.hasFocus();
  if (isTabHidden && 'Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, {
      body: task.title,
      icon: prefix + "assets/nszu-shield.svg",
      tag: "task-alert",
      renotify: true
    });

    notification.onclick = () => {
      window.focus();
      window.open(targetUrl, "_blank");
      notification.close();
    };
  } else {
    // Show premium on-screen toast notification when page is active or permissions are not set
    showOnScreenToast(title, task.title, targetUrl);
  }
}

function showOnScreenToast(title, body, url) {
  let container = document.getElementById('portal-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'portal-toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    container.style.zIndex = '999999';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.background = 'var(--p-surface, #ffffff)';
  toast.style.color = 'var(--p-ink, #0f172a)';
  toast.style.padding = '16px 20px';
  toast.style.borderRadius = '12px';
  toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.05)';
  toast.style.border = '1.5px solid var(--p-line, #e2e8f0)';
  toast.style.minWidth = '320px';
  toast.style.maxWidth = '400px';
  toast.style.cursor = 'pointer';
  toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
  toast.style.transform = 'translateY(20px)';
  toast.style.opacity = '0';
  toast.style.display = 'flex';
  toast.style.flexDirection = 'column';
  toast.style.gap = '6px';
  toast.style.fontFamily = 'inherit';

  if (!document.getElementById('toast-animation-style')) {
    const style = document.createElement('style');
    style.id = 'toast-animation-style';
    style.textContent = `
      .portal-toast-slide {
        transform: translateY(0) !important;
        opacity: 1 !important;
      }
      .portal-toast-slide:hover {
        transform: translateY(-4px) !important;
        box-shadow: 0 12px 35px rgba(0,0,0,0.2), 0 2px 5px rgba(0,0,0,0.08) !important;
      }
    `;
    document.head.appendChild(style);
  }

  toast.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid var(--p-line); padding-bottom:6px;">
      <strong style="color:var(--accent, #3b82f6); font-size:14px; font-weight:800; display:flex; align-items:center; gap:6px;">📋 ${title}</strong>
      <button class="toast-close" style="background:none; border:none; color:var(--p-muted); font-size:18px; cursor:pointer; padding:0 4px; line-height:1;">&times;</button>
    </div>
    <div style="font-size:13px; font-weight:700; line-height:1.4; color:var(--p-ink);">${body}</div>
    <div style="font-size:11px; color:var(--accent, #3b82f6); text-align:right; font-weight:800; margin-top:4px;">Відкрити доручення &rarr;</div>
  `;

  toast.querySelector('.toast-close').addEventListener('click', (e) => {
    e.stopPropagation();
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  });

  toast.addEventListener('click', () => {
    window.open(url, '_blank');
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => toast.classList.add('portal-toast-slide'), 50);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      setTimeout(() => toast.remove(), 300);
    }
  }, 8000);
}


/* ── Daily User Status Business Logic ─────────────────────── */
let todayStatus = null;
let todayStatusUntil = null; // YYYY-MM-DD — останній день поточної відпустки/лікарняного
let statusSubscription = null;

// ── Хелпери для статусів з діапазоном дат ─────────────────────────
function isWeekendDateStr(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

function isTodayWeekend() {
  return isWeekendDateStr(getLocalDateString());
}

function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${d}.${m}`;
}

// З відсортованих рядків одного користувача рахує останній безперервний день
// того ж статусу, починаючи з сьогодні (кінець відпустки/лікарняного).
function computeStatusUntil(rows, todayStr, status) {
  const dates = rows
    .filter(r => r.status === status && r.status_date >= todayStr)
    .map(r => r.status_date)
    .sort();
  if (!dates.length || dates[0] !== todayStr) return null;
  let until = todayStr;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] === addDaysToDateStr(until, 1)) until = dates[i];
    else break;
  }
  return until === todayStr ? null : until;
}

function openStatusUntilPicker(status) {
  const row = document.getElementById('status-until-row');
  const title = document.getElementById('status-until-title');
  const input = document.getElementById('status-until-input');
  if (!row || !input) return;
  const todayStr = getLocalDateString();
  row.dataset.pendingStatus = status;
  input.min = todayStr;
  const isProlong = status === 'sick' && todayStatus === 'sick' && todayStatusUntil;
  if (status === 'sick') {
    title.textContent = isProlong
      ? `Продовжити лікарняний (зараз до ${formatDateShort(todayStatusUntil)}). Хворію до:`
      : 'Лікарняний до якої дати (включно)?';
    input.value = isProlong ? addDaysToDateStr(todayStatusUntil, 3) : addDaysToDateStr(todayStr, 3);
  } else {
    title.textContent = 'Відпустка до якої дати (включно)?';
    input.value = (todayStatus === 'vacation' && todayStatusUntil) ? todayStatusUntil : addDaysToDateStr(todayStr, 13);
  }
  row.style.display = 'block';
}

function hideStatusUntilPicker() {
  const row = document.getElementById('status-until-row');
  if (row) row.style.display = 'none';
}

/* ── Велике вікно статусу посеред екрана ───────────────────────────
   Поки статус на сьогодні не проставлений, вибір показується не
   маленьким дропдауном у кутку шапки, а вікном по центру екрана з
   підкладкою і втричі більшими кнопками: маленький чіп просто не
   помічають, і табель наприкінці місяця не сходиться.
   «Пізніше» відкладає нагадування на годину, потім воно повертається. */
const STATUS_NAG_SNOOZE_MS = 60 * 60 * 1000;
const STATUS_NAG_RECHECK_MS = 5 * 60 * 1000;
let statusNagTimer = null;
let statusDropdownHome = null; // куди повернути вікно після закриття

function isStatusNagNeeded() {
  return !!user && role !== 'guest' && !todayStatus && !isTodayWeekend();
}

function isStatusNagSnoozed() {
  try {
    const ts = Number(localStorage.getItem('status_nag_snooze') || 0);
    return Date.now() - ts < STATUS_NAG_SNOOZE_MS;
  } catch (e) {
    return false;
  }
}

function snoozeStatusNag() {
  try { localStorage.setItem('status_nag_snooze', String(Date.now())); } catch (e) {}
}

function getStatusNagBackdrop() {
  let bd = document.getElementById('status-nag-backdrop');
  if (!bd) {
    bd = document.createElement('div');
    bd.id = 'status-nag-backdrop';
    bd.className = 'status-nag-backdrop';
    document.body.appendChild(bd);
  }
  return bd;
}

function openStatusDropdown() {
  const dropdown = document.getElementById('portal-status-dropdown');
  const chip = document.getElementById('portal-status-chip');
  if (!dropdown || !chip || chip.style.display === 'none') return;

  document.querySelectorAll('.status-dropdown').forEach(d => d.classList.remove('show'));

  // Без статусу — вікно по центру; зі статусом — звичний дропдаун у шапці
  const nag = isStatusNagNeeded();
  if (nag && dropdown.parentElement !== document.body) {
    // Шапка .top має backdrop-filter, а він робить її системою координат для
    // position: fixed — усередині неї вікно центрувалося б по шапці, не по екрану
    statusDropdownHome = dropdown.parentElement;
    document.body.appendChild(dropdown);
  }
  dropdown.classList.toggle('nag-mode', nag);
  getStatusNagBackdrop().classList.toggle('show', nag);
  document.body.classList.toggle('status-nag-open', nag);

  dropdown.classList.add('show');
  loadTeamPresence();
}

function closeStatusDropdown() {
  const dropdown = document.getElementById('portal-status-dropdown');
  if (dropdown) {
    dropdown.classList.remove('show', 'nag-mode');
    if (statusDropdownHome && dropdown.parentElement === document.body) {
      statusDropdownHome.appendChild(dropdown);
    }
  }
  hideStatusUntilPicker();
  const bd = document.getElementById('status-nag-backdrop');
  if (bd) bd.classList.remove('show');
  document.body.classList.remove('status-nag-open');
}

// Саме відкриття: статусу немає, не вихідний і година відкладення минула.
function maybeOpenStatusNag() {
  if (!isStatusNagNeeded() || isStatusNagSnoozed()) return;
  const dropdown = document.getElementById('portal-status-dropdown');
  if (!dropdown || dropdown.classList.contains('show')) return;
  openStatusDropdown();
}

function startStatusNagWatch() {
  if (statusNagTimer) return;
  statusNagTimer = setInterval(maybeOpenStatusNag, STATUS_NAG_RECHECK_MS);
}

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function loadUserDailyStatus() {
  if (!user || role === 'guest') return;
  const todayStr = getLocalDateString();

  try {
    const { data, error } = await sb
      .from('user_daily_statuses')
      .select('status, status_date')
      .eq('user_id', user.id)
      .gte('status_date', todayStr)
      .order('status_date', { ascending: true });

    if (error) {
      console.warn("Failed to load user daily status:", error);
      const cached = localStorage.getItem(`daily_status_${user.id}_${todayStr}`);
      todayStatus = cached || null;
      updateStatusUI(todayStatus);
      return;
    }

    const todayRow = (data || []).find(r => r.status_date === todayStr);
    if (todayRow) {
      todayStatus = todayRow.status;
      todayStatusUntil = computeStatusUntil(data, todayStr, todayRow.status);
      localStorage.setItem(`daily_status_${user.id}_${todayStr}`, todayStatus);
      updateStatusUI(todayStatus, todayStatusUntil);
    } else {
      todayStatus = null;
      todayStatusUntil = null;
      updateStatusUI(null);
      maybeOpenStatusNag();
      startStatusNagWatch();
    }
  } catch (err) {
    console.error("Error in loadUserDailyStatus:", err);
  }
}

function updateStatusUI(status, until) {
  const chip = document.getElementById('portal-status-chip');
  if (!chip) return;

  chip.className = 'portal-status-chip';
  const iconEl = chip.querySelector('.status-icon');
  const lblEl = chip.querySelector('.status-lbl');

  // Статус зʼявився (хай навіть з іншого пристрою) — велике вікно прибираємо
  if (status && document.body.classList.contains('status-nag-open')) {
    closeStatusDropdown();
  }

  const statusConfig = {
    office: { icon: '🏢', text: 'Офіс', className: 'status-office' },
    home: { icon: '🏡', text: 'Вдома', className: 'status-home' },
    sick: { icon: '🏥', text: 'Лікарняний', className: 'status-sick' },
    vacation: { icon: '🌴', text: 'Відпустка', className: 'status-vacation' },
    agreement: { icon: '🤝', text: 'За домовл.', className: 'status-agreement' }
  };

  // Субота/неділя — у всіх вихідний, але відпустка/лікарняний важливіші за вихідний
  if (isTodayWeekend() && status !== 'sick' && status !== 'vacation') {
    iconEl.textContent = '🛌';
    lblEl.textContent = 'Вихідний';
    chip.classList.add('status-weekend');
    document.querySelectorAll('.status-opt-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });
    return;
  }

  if (status && statusConfig[status]) {
    const config = statusConfig[status];
    iconEl.textContent = config.icon;
    lblEl.textContent = until ? `${config.text} · до ${formatDateShort(until)}` : config.text;
    chip.classList.add(config.className);
  } else {
    iconEl.textContent = '❓';
    lblEl.textContent = 'Вкажіть статус';
    chip.classList.add('needs-activation');
  }

  document.querySelectorAll('.status-opt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
}

// status — код статусу; untilDate (YYYY-MM-DD, включно) — лише для sick/vacation:
// рядки пишуться на кожен день діапазону, щодня нічого натискати не треба.
async function saveUserDailyStatus(status, untilDate) {
  if (!user || role === 'guest') return;
  const todayStr = getLocalDateString();
  let displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];

  let userDept = '';
  try {
    const { data: prof } = await sb.from('profiles').select('Section, department, full_name').eq('id', user.id).single();
    userDept = prof?.Section || prof?.department || '';
    if (prof?.full_name) {
      displayName = prof.full_name;
    }
  } catch(e) {}

  try {
    const isRanged = (status === 'sick' || status === 'vacation') && untilDate && untilDate > todayStr;
    updateStatusUI(status, isRanged ? untilDate : null);

    const baseRow = {
      user_id: user.id,
      user_name: displayName,
      department: userDept,
      status: status
    };

    let rows;
    if (isRanged) {
      rows = [];
      let d = todayStr;
      let guard = 0;
      while (d <= untilDate && guard < 200) { // страховка: максимум ~пів року
        rows.push({ ...baseRow, status_date: d });
        d = addDaysToDateStr(d, 1);
        guard++;
      }
    } else {
      rows = [{ ...baseRow, status_date: todayStr }];
    }

    const { error } = await sb
      .from('user_daily_statuses')
      .upsert(rows, { onConflict: 'user_id, status_date' });

    if (error) {
      console.error("Failed to save daily status to DB:", error);
      localStorage.setItem(`daily_status_${user.id}_${todayStr}`, status);
      updateStatusUI(status);
      alert("Не вдалося зберегти статус у хмару, збережено локально.");
      return;
    }

    // Якщо людина повернулась раніше (ставить звичайний статус) або скоротила
    // діапазон — прибираємо зайві майбутні дні, щоб не висіла «хвостова» відпустка.
    const clearAfter = isRanged ? untilDate : todayStr;
    try {
      await sb
        .from('user_daily_statuses')
        .delete()
        .eq('user_id', user.id)
        .gt('status_date', clearAfter);
    } catch (e) {
      console.warn('Failed to clear future statuses:', e);
    }

    todayStatus = status;
    todayStatusUntil = isRanged ? untilDate : null;
    localStorage.setItem(`daily_status_${user.id}_${todayStr}`, status);
    updateStatusUI(todayStatus, todayStatusUntil);

    setTimeout(closeStatusDropdown, 300);
  } catch (err) {
    console.error("Error in saveUserDailyStatus:", err);
  }
}

async function loadTeamPresence() {
  if (!user) return;
  const todayStr = getLocalDateString();
  const listEl = document.getElementById('colleagues-status-list');
  if (!listEl) return;
  
  try {
    const { data: profiles, error: profErr } = await sb
      .from('profiles')
      .select('id, full_name, role')
      .neq('role', 'guest');
      
    if (profErr) {
      console.warn("Failed to load profiles for presence:", profErr);
      listEl.innerHTML = '<li style="color:var(--muted)">Помилка завантаження профілів</li>';
      return;
    }
    
    const { data: statuses, error: statErr } = await sb
      .from('user_daily_statuses')
      .select('user_id, user_name, status, status_date')
      .gte('status_date', todayStr);

    if (statErr) {
      console.warn("Failed to load daily statuses for presence:", statErr);
      listEl.innerHTML = '<li style="color:var(--muted)">Помилка завантаження статусів</li>';
      return;
    }

    const statusMap = {};
    const untilMap = {};
    const rowsByUser = {};
    statuses?.forEach(s => {
      (rowsByUser[s.user_id] = rowsByUser[s.user_id] || []).push(s);
      if (s.status_date === todayStr) statusMap[s.user_id] = s.status;
    });
    Object.keys(statusMap).forEach(uid => {
      const st = statusMap[uid];
      if (st === 'sick' || st === 'vacation') {
        untilMap[uid] = computeStatusUntil(rowsByUser[uid] || [], todayStr, st);
      }
    });

    const weekend = isTodayWeekend();
    const groups = {
      office: { title: '🏢 В офісі', names: [] },
      home: { title: '🏡 Вдома', names: [] },
      sick: { title: '🏥 Лікарняний', names: [] },
      vacation: { title: '🌴 Відпустка', names: [] },
      agreement: { title: '🤝 За домовл.', names: [] },
      weekend: { title: '🛌 Вихідний', names: [] },
      none: { title: '🔴 Не вказано', names: [] }
    };

    profiles?.forEach(p => {
      const status = statusMap[p.id];
      let name = p.full_name || 'Співробітник';
      if (untilMap[p.id]) name += ` (до ${formatDateShort(untilMap[p.id])})`;
      if (weekend && status !== 'sick' && status !== 'vacation') {
        groups.weekend.names.push(p.full_name || 'Співробітник');
      } else if (status && groups[status]) {
        groups[status].names.push(name);
      } else {
        groups.none.names.push(name);
      }
    });
    
    let html = '';
    let hasAnyData = false;
    
    for (const key in groups) {
      const g = groups[key];
      if (g.names.length > 0) {
        hasAnyData = true;
        html += `
          <div class="colleague-group">
            <div class="colleague-group-title">${g.title} (${g.names.length})</div>
            <div class="colleague-names">${g.names.join(', ')}</div>
          </div>
        `;
      }
    }
    
    if (!hasAnyData) {
      listEl.innerHTML = '<li style="color: var(--muted); font-style: italic;">Немає активних колег</li>';
    } else {
      listEl.innerHTML = html;
    }
  } catch (err) {
    console.error("Error loading team presence:", err);
    listEl.innerHTML = '<li style="color:var(--muted)">Помилка завантаження</li>';
  }
}

function setupRealtimeStatus() {
  if (!user || role === 'guest') return;
  
  if (statusSubscription) {
    sb.removeChannel(statusSubscription);
    statusSubscription = null;
  }
  
  statusSubscription = sb.channel('realtime_daily_statuses')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_daily_statuses' }, payload => {
      const todayStr = getLocalDateString();
      const newRecord = payload.new;
      const oldRecord = payload.old;
      
      const isRecordToday = (newRecord && newRecord.status_date === todayStr) || 
                            (oldRecord && oldRecord.status_date === todayStr);
                            
      if (isRecordToday) {
        loadTeamPresence();
        
        if (newRecord && newRecord.user_id === user.id) {
          todayStatus = newRecord.status;
          updateStatusUI(todayStatus);
        }
      }
    })
    .subscribe();
}

/* ── Мобільна нижня панель навігації (як у застосунках) ─────────────
   Інжектиться на кожній сторінці; перебудовується при зміні авторизації.
   Видимість керується CSS (@media max-width: 768px в auth-v2.css). */
function buildMobileTabbar(prefix, hasAccess, isActive) {
  document.getElementById('mobile-tabbar')?.remove();
  document.getElementById('mobile-more-sheet')?.remove();
  document.body.classList.add('has-mobile-tabbar');

  const isExpert = hasAccess('expert');

  // 4 основні вкладки + «Ще»
  const tabs = isExpert ? [
    { icon: '🏠', label: 'Головна', path: 'index.html' },
    { icon: '🔍', label: 'Пошук', action: 'search' },
    { icon: '📋', label: 'Кабінет', path: 'cabinet/index.html' },
    { icon: '🗓️', label: 'План', path: 'cabinet/planner.html' },
    { icon: '☰', label: 'Ще', action: 'more' }
  ] : [
    { icon: '🏠', label: 'Головна', path: 'index.html' },
    { icon: '🔍', label: 'Пошук', action: 'search' },
    { icon: '📄', label: 'Реєстр', path: 'rozjasnennya/index.html' },
    { icon: '📦', label: 'Пакети', path: 'pakety/index.html' },
    { icon: '☰', label: 'Ще', action: 'more' }
  ];

  // Повний список розділів для шторки «Ще»
  const moreSections = [
    { icon: '🗺️', label: 'Карта порталу', path: 'map/index.html' },
    { icon: '📄', label: 'Роз\'яснення', path: 'rozjasnennya/index.html' },
    { icon: '💡', label: 'AI-пошук', path: 'rozjasnennya_semantic.html' },
    { icon: '📦', label: 'Пакети 2026', path: 'pakety/index.html' },
    { icon: '🪪', label: 'Паспорт пакета', path: 'passport/index.html' },
    { icon: '🧪', label: 'Пілотні проєкти', path: 'pilots/index.html' },
    { icon: '📜', label: 'Постанова 1808', path: 'postanova/index.html' },
    { icon: '↔️', label: 'Тарифи 2025 ↔ 2026', path: 'postanova/porivnyannya.html' },
    { icon: '🧮', label: 'Наказ 377', path: 'algorithms/index.html' },
    { icon: '⚖️', label: 'Нормативна база', path: 'regulatory/index.html' },
    { icon: '☢️', label: 'Рентген і ДІВ', path: 'rentgen/index.html' },
    { icon: '🏥', label: 'ДЕЦ МОЗ', path: 'dec/index.html' },
    { icon: '🩺', label: 'Хвороби · НК 025', path: 'classifiers/index.html' },
    { icon: '🔬', label: 'Інтервенції · НК 026', path: 'classifiers/nk026.html' },
    { icon: '🩹', label: 'Медвироби · НК 024', path: 'classifiers/nk024.html' },
    { icon: '🧾', label: 'Номенклатура · НК 031', path: 'classifiers/nk031.html' },
    { icon: '📋', label: 'Табелі оснащення', path: 'classifiers/tabel.html' },
    { icon: '🩻', label: 'Обладнання у вимогах', path: 'classifiers/obladnannia.html' },
    { icon: '🧪', label: 'LOINC (лаб. коди)', path: 'classifiers/loinc.html' },
    { icon: '👥', label: 'Посади · ДКХП-78', path: 'classifiers/posady.html' },
    { icon: '🪪', label: 'Спеціальності та посади', path: 'classifiers/specialnosti.html' },
    { icon: '🔗', label: 'Таблиця співставлення', path: 'mapping/index.html' },
    { icon: '🧮', label: 'Інструменти ДСГ', path: 'drg/index.html' },
    { icon: '🧭', label: 'Кодування випадку', path: 'koduvannia/index.html' },
    { icon: '🦼', label: 'Наказ 182 · Кодування реабілітації', path: 'algorithms/rehab.html' },
    { icon: '🏥', label: 'Кодування амбулаторки · пакет 9', path: 'algorithms/ambulatory.html' },
    { icon: '🗄️', label: 'Коди ЕСОЗ · внутрішній', path: 'classifiers/esoz.html', role: 'expert' },
    { icon: '📑', label: 'Договори ЗОЗ', path: 'zoz-dogovr/index.html' },
    { icon: '🏥', label: 'Хто це лікує', path: 'zoz-poshuk/index.html' },
    { icon: '👤', label: 'Кабінет', path: 'cabinet/index.html', role: 'expert' },
    { icon: '🗓️', label: 'Планувальник', path: 'cabinet/planner.html', role: 'expert' },
    { icon: '📊', label: 'Звіти СКО-Д', path: 'skod/reports.html', role: 'expert' },
    { icon: '✅', label: 'Доручення', path: 'skod/tasks.html', role: 'manager' },
    { icon: '👥', label: 'Структура Департаменту', path: 'dept-tree.html', role: 'expert' },
    { icon: '💬', label: 'Робочий чат', path: 'chat/index.html', role: 'expert' },
    { icon: '📰', label: 'Новини', path: 'news/index.html', role: 'expert' },
    { icon: '📡', label: 'Інфоцентр', path: 'infocenter/index.html', role: 'expert' },
    { icon: '⏰', label: 'Нагадування', path: 'reminders/index.html', role: 'expert' },
    { icon: '❓', label: 'Питання ЗОЗ', path: 'zoz-questions/index.html', role: 'expert' },
    { icon: '🗳️', label: 'Пропозиції ПМГ', path: 'pmg-proposals/index.html', role: 'expert' },
    { icon: '🤝', label: 'Пропозиції РГ', path: 'expert-proposals/index.html', role: 'expert' },
    { icon: '🌿', label: 'Відпочинок', path: 'relax/index.html', role: 'expert' }
  ].filter(s => hasAccess(s.role));

  const bar = document.createElement('nav');
  bar.id = 'mobile-tabbar';
  bar.setAttribute('aria-label', 'Мобільна навігація');
  tabs.forEach(t => {
    const el = document.createElement(t.path ? 'a' : 'button');
    el.className = 'mtab';
    if (t.path) {
      el.href = prefix + t.path;
      if (isActive(t.path)) el.classList.add('active');
    } else {
      el.type = 'button';
    }
    el.innerHTML = `<span class="mtab-icon">${t.icon}</span><span class="mtab-lbl">${t.label}</span>`;
    if (t.action === 'search') el.addEventListener('click', openGlobalSearch);
    if (t.action === 'more') el.addEventListener('click', toggleMobileMoreSheet);
    bar.appendChild(el);
  });
  document.body.appendChild(bar);

  // Шторка «Ще»
  const sheet = document.createElement('div');
  sheet.id = 'mobile-more-sheet';
  sheet.innerHTML = `
    <div class="mms-backdrop"></div>
    <div class="mms-panel" role="dialog" aria-label="Усі розділи порталу">
      <div class="mms-grip"></div>
      <div class="mms-title">Усі розділи</div>
      <div class="mms-grid">
        ${moreSections.map(s => `
          <a class="mms-item${isActive(s.path) ? ' active' : ''}" href="${prefix}${s.path}">
            <span class="mms-icon">${s.icon}</span>
            <span class="mms-lbl">${s.label}</span>
          </a>`).join('')}
      </div>
      <div class="mms-title mms-settings-title">⚙️ Налаштування</div>
      <div class="mms-grid mms-settings-grid">
        <button type="button" class="mms-item" id="mms-theme-tile">
          <span class="mms-icon">🌙</span>
          <span class="mms-lbl">Темна тема</span>
        </button>
        <button type="button" class="mms-item" id="mms-notify-tile">
          <span class="mms-icon">🔔</span>
          <span class="mms-lbl">Сповіщення</span>
        </button>
        <button type="button" class="mms-item" id="mms-install-tile"${isStandaloneApp() ? ' style="display:none;"' : ''}>
          <span class="mms-icon">📲</span>
          <span class="mms-lbl">Встановити додаток</span>
        </button>
      </div>
    </div>
  `;
  sheet.querySelector('.mms-backdrop').addEventListener('click', toggleMobileMoreSheet);
  document.body.appendChild(sheet);

  // Плитки налаштувань керують тими самими кнопками, що сховані з планки
  const themeTile = sheet.querySelector('#mms-theme-tile');
  const notifyTile = sheet.querySelector('#mms-notify-tile');
  const updateSettingsTiles = () => {
    const dark = document.documentElement.classList.contains('dark-theme') ||
                 document.body.classList.contains('dark-theme');
    themeTile.querySelector('.mms-icon').textContent = dark ? '☀️' : '🌙';
    themeTile.querySelector('.mms-lbl').textContent = dark ? 'Світла тема' : 'Темна тема';
    const notifyOn = localStorage.getItem('news_notifications_enabled') !== 'false';
    notifyTile.querySelector('.mms-icon').textContent = notifyOn ? '🔔' : '🔕';
    notifyTile.querySelector('.mms-lbl').textContent = notifyOn ? 'Сповіщення: увімк.' : 'Сповіщення: вимк.';
  };
  updateSettingsTiles();
  themeTile.addEventListener('click', () => {
    document.getElementById('theme-toggle-btn')?.click();
    setTimeout(updateSettingsTiles, 50);
  });
  notifyTile.addEventListener('click', () => {
    document.getElementById('news-notify-btn')?.click();
    setTimeout(updateSettingsTiles, 50);
  });

  // Плитка встановлення веб-додатка (без спливаючих запрошень)
  const installTile = sheet.querySelector('#mms-install-tile');
  if (installTile) {
    installTile.addEventListener('click', () => {
      if (document.getElementById('mobile-more-sheet')?.classList.contains('open')) toggleMobileMoreSheet();
      handleInstallClick();
    });
  }
}

/* ── Мобільний макет шапки ──────────────────────────────────────────
   1) Банер з назвою департаменту над планкою (лише ≤980px, через CSS).
   2) Кнопка статусу переїжджає з планки в окремий повноширинний рядок
      під шапкою — дропдаун відкривається в межах екрана. */
let mobileLayoutResizeHooked = false;

function applyMobileHeaderLayout() {
  const isMobile = window.matchMedia('(max-width: 980px)').matches;

  // Банер департаменту — створюємо один раз, видимість керує CSS
  const headerEl = document.querySelector('header.top') || document.querySelector('header.hero');
  if (headerEl && !document.getElementById('mobile-dept-banner')) {
    const banner = document.createElement('div');
    banner.id = 'mobile-dept-banner';
    banner.innerHTML = `
      <span class="mdb-agency">НСЗУ</span>
      <span class="mdb-name">Департамент стратегії універсального охоплення населення медичними послугами</span>`;
    headerEl.parentElement.insertBefore(banner, headerEl);
  }

  // Кнопка статусу окремим рядком
  const chip = document.getElementById('portal-status-chip');
  if (chip) {
    let rowEl = document.getElementById('mobile-status-row');
    if (isMobile) {
      if (!rowEl) {
        rowEl = document.createElement('div');
        rowEl.id = 'mobile-status-row';
        const anchor = document.querySelector('header.top') || document.querySelector('.nav-row-1');
        if (anchor) anchor.insertAdjacentElement('afterend', rowEl);
        else document.body.prepend(rowEl);
      }
      if (chip.parentElement !== rowEl) rowEl.appendChild(chip);
      // Рядок видно лише коли чіп видимий (гостям статус не показуємо)
      rowEl.style.display = (chip.style.display === 'none') ? 'none' : 'block';
    } else if (rowEl) {
      const authNav = document.querySelector('.top-auth') ||
                      document.querySelector('.auth-container nav.section-switch');
      if (authNav && chip.parentElement === rowEl) authNav.appendChild(chip);
      rowEl.remove();
    }
  }

  if (!mobileLayoutResizeHooked) {
    mobileLayoutResizeHooked = true;
    window.matchMedia('(max-width: 980px)').addEventListener('change', applyMobileHeaderLayout);
  }
}

function toggleMobileMoreSheet() {
  const sheet = document.getElementById('mobile-more-sheet');
  if (!sheet) return;
  const willOpen = !sheet.classList.contains('open');
  sheet.classList.toggle('open', willOpen);
  document.getElementById('mobile-tabbar')?.querySelectorAll('.mtab').forEach(t => {
    if (t.querySelector('.mtab-lbl')?.textContent === 'Ще') t.classList.toggle('active', willOpen);
  });
}

// ── PWA: реєстрація service worker (працює на будь-якій сторінці порталу) ──
if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') &&
    !location.pathname.startsWith('/chat/')) { // чат має власний SW зі своїм scope
  // Версія в URL обов'язкова: GitHub Pages віддає sw.js із max-age=600, тож без
  // неї браузер до десяти хвилин не помічає, що воркер змінився, і продовжує
  // роздавати старі файли з кешу. Змінений URL змушує перевірити одразу.
  // ПРИ ЗМІНІ sw.js ПІДНІМАТИ ЦЮ ВЕРСІЮ РАЗОМ З CACHE усередині воркера.
  navigator.serviceWorker.register('/sw.js?v=51').catch(() => {});

  // Перезавантаження на controllerchange прибрано 30.07.2026 разом зі
  // skipWaiting() у воркері (див. коментар у sw.js). Новий воркер більше не
  // втручається в сторінку, яку людина відкриває саме зараз, а перебирає
  // керування на наступному переході — перезавантажувати нема чого.
}

// ── PWA: встановлення БЕЗ спливаючих запрошень ─────────────────────
// Жодних авто-банерів. Кнопка «Встановити веб-додаток» — у футері та в
// мобільній панелі «Ще». Натискання: Android/Chrome — рідне вікно
// встановлення; iOS — інструкція «Поділитися → На початковий екран».
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();            // не показуємо автоматичне запрошення
  deferredInstallPrompt = e;     // зберігаємо для кнопки
  refreshInstallControls();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  refreshInstallControls();
});

function isIosDevice() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ маскується під Macintosh — визначаємо за сенсорним екраном
  return /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  return window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}

// Клік по будь-якій кнопці встановлення
async function handleInstallClick() {
  if (isStandaloneApp()) return;
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (_) {}
    deferredInstallPrompt = null;
    refreshInstallControls();
    return;
  }
  if (isIosDevice()) { showIosInstallInstructions(); return; }
  // Десктоп/інші браузери без готового запрошення
  alert('Щоб встановити застосунок, відкрийте меню браузера (⋮) і оберіть «Встановити застосунок» / «Install app».');
}

// Інструкція для iOS — лише за кліком користувача (не спливає сама)
function showIosInstallInstructions() {
  document.getElementById('pwa-ios-modal')?.remove();
  const shareIcon = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>';
  const overlay = document.createElement('div');
  overlay.id = 'pwa-ios-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#fff;color:#1e293b;border-radius:16px;max-width:380px;width:100%;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.35);font-size:14px;line-height:1.55;">
      <div style="font-size:16px;font-weight:800;margin-bottom:10px;">📲 Встановлення на iPhone/iPad</div>
      <p style="margin:0 0 8px;">У Safari натисніть кнопку ${shareIcon} <b>Поділитися</b> (унизу екрана).</p>
      <p style="margin:0 0 8px;">Прокрутіть і оберіть <b>«На початковий екран»</b> (Add to Home Screen).</p>
      <p style="margin:0 0 16px;">Підтвердіть — <b>«Додати»</b>. Іконка порталу з'явиться на екрані «Домівка».</p>
      <button id="pwa-ios-modal-ok" style="width:100%;border:none;border-radius:10px;background:#2f6b9e;color:#fff;font:inherit;font-weight:700;padding:11px;cursor:pointer;">Зрозуміло</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#pwa-ios-modal-ok').addEventListener('click', close);
}

// Вставити кнопку «Встановити веб-додаток» у нижній банер (футер)
function injectFooterInstallButton() {
  if (isStandaloneApp()) return;                       // уже встановлено
  const base = document.querySelector('.p-foot-base');
  if (!base || document.getElementById('pwa-install-foot')) return;
  const btn = document.createElement('button');
  btn.id = 'pwa-install-foot';
  btn.type = 'button';
  btn.textContent = '📲 Встановити веб-додаток';
  btn.style.cssText = 'border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.10);color:#e6f0f8;font:inherit;font-size:12.5px;font-weight:700;padding:7px 14px;border-radius:9px;cursor:pointer;white-space:nowrap;';
  btn.addEventListener('click', handleInstallClick);
  base.appendChild(btn);
}

// Показати/сховати всі кнопки встановлення відповідно до стану
function refreshInstallControls() {
  const installed = isStandaloneApp();
  document.getElementById('pwa-install-foot')?.style.setProperty('display', installed ? 'none' : '');
  const tile = document.getElementById('mms-install-tile');
  if (tile) tile.style.display = installed ? 'none' : '';
}

// Вставляємо кнопку одразу, щойно DOM готовий (футер — статична розмітка)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFooterInstallButton);
} else {
  injectFooterInstallButton();
}

document.addEventListener('DOMContentLoaded', init);

// ── Стежка навігації (плаваючий навігатор пройдених сторінок) ──
// Шлях розв'язується відносно auth-v2.js (корінь сайту), тож працює
// з будь-якої вкладеної сторінки. Помилка завантаження не критична.
import('./nav-trail.js?v=20260805a').catch(() => {});
import('./code-basket.js?v=20260819b').catch(() => {});
