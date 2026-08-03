/* Service worker порталу НавігаторПМГ26.
   Стратегія: HTML — network-first (щоб оновлення доїжджали одразу),
   статика — cache-first із фоновим оновленням (версії ?v= у HTML).
   Запити до Supabase та інших доменів не перехоплюються. */
// v7 (29.07.2026): підняли версію, щоб activate вимів старі записи —
// інакше оновлені файли зі зміненим ?v= доїжджають, а сусідні лишаються старими
// v8 (30.07.2026): фірмовий фон НСЗУ — brand.css, кропи фону, круглі іконки
// v10 (03.08.2026): новий розділ «Посади» (ДКХП-78 + коди НСЗУ + кадрові
//   вимоги пакетів) і новий пункт у вкладці «Коди» — піднято, щоб activate
//   вимів старі записи auth-v2.js і map.js
// v9 (30.07.2026): чотири виправлення «сторінка відкрилась з другого разу» —
//   1) прибрано skipWaiting()/clients.claim() — ГОЛОВНА причина, див. нижче;
//   2) невдала навігація більше НЕ підміняє сторінку головною;
//   3) мережа для навігації обмежена таймаутом, далі йде кеш цієї ж сторінки;
//   4) URL із cache-buster (?t=1785442158836) не осідають у Cache Storage.
const CACHE = 'pmg-portal-v10';
// Скільки чекати на мережу під час навігації, перш ніж показати збережену копію.
// GitHub Pages під навантаженням віддає HTML секундами — без цього ліміту вкладка
// просто висить білою, і користувач тисне посилання вдруге.
const NAV_TIMEOUT_MS = 3500;
const CORE = [
  '/',
  '/index.html',
  '/portal.css',
  '/styles.css',
  '/auth-v2.css',
  '/brand.css',
  '/assets/icon-round-192.png',
  '/assets/bg-nszu-wide.webp',
  '/assets/nszu-shield.svg'
];

// ⚠️ НЕ додавати сюди skipWaiting() і clients.claim() у activate.
//
// Саме через них портал «відкривався з другого разу». Після кожного деплою
// сторінка, яку людина відкривала В ЦЮ МИТЬ, тягнула новий sw.js; той ставав
// активним негайно, старий воркер браузер обривав — а разом з ним і всі
// запити сторінки, які старий воркер саме обслуговував через respondWith.
// Сторінка отримувала «Failed to fetch» на своїх даних і малювала порожнечу
// («Не вдалося завантажити індекс постанови»). Друга спроба вже йшла через
// новий воркер і працювала. Відтворено локально 30.07.2026.
//
// Тепер новий воркер чекає у waiting і перебирає керування на НАСТУПНОМУ
// переході — сторінки в порталі й так перезавантажуються цілком, а свіжість
// файлів забезпечують версії ?v= в HTML, не воркер.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('pmg-portal-') && k !== CACHE).map((k) => caches.delete(k))
    ))
  );
});

// Кілька сторінок навмисно ходять по дані з міткою часу (?t=1785442158836),
// щоб обійти кеш. Для Cache Storage кожна така мітка — НОВИЙ ключ, тому за
// місяці користування там осідали сотні копій одного файлу і сховище пухло.
// Такі відповіді віддаємо з мережі, але не зберігаємо.
function isCacheBusted(url) {
  for (const value of url.searchParams.values()) {
    if (/^\d{13}$/.test(value)) return true; // Date.now()
  }
  return false;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase/CDN — напряму

  // Великі дані-шари LOINC (до ~17 МБ) — напряму в мережу, без клонування й
  // кешування в Cache Storage: інакше SW роздуває сховище і на слабких пристроях
  // може обірвати велике завантаження. HTTP-кеш браузера тут достатній.
  if (url.pathname.startsWith('/classifiers/data/loinc/loinc_data_')) return;

  if (req.mode === 'navigate') {
    // no-cache: GitHub Pages ставить max-age=600, без цього браузер до 10 хв
    // показує стару сторінку; ревалідація за ETag — дешева
    e.respondWith(navigateWithFallback(req));
    return;
  }

  // Дані роз'яснень оновлюються щодоби (звірка з архівом НСЗУ), тому тут
  // cache-first неприпустимий: користувач бачив би вчорашній стан аж до
  // другого заходу на сторінку. Мережа перша, кеш — запасний варіант.
  if (url.pathname.startsWith('/rozjasnennya/data/')) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (isCacheBusted(url)) return; // мітка часу — повз кеш, напряму в мережу

  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Навігація: мережа перша, але з таймаутом і БЕЗ підміни сторінки.
//
// Раніше на будь-яку помилку мережі віддавався '/index.html' — тож клік по
// «Постанові» на слабкому зв'язку мовчки показував головну під адресою
// /postanova/. Виглядало як «сторінка не відкрилась», людина тиснула вдруге,
// і другий раз спрацьовував. Тепер запасний варіант — збережена копія САМЕ
// цієї сторінки, а якщо її нема — чесне повідомлення про офлайн.
async function navigateWithFallback(req) {
  const cachedPage = () => caches.match(req, { ignoreSearch: true });

  // Запит один: при спрацюванні таймаута ми не кидаємо його, а лише перестаємо
  // чекати. Якщо збереженої копії немає — повертаємось до цієї ж обіцянки.
  const fromNetwork = fetch(req, { cache: 'no-cache' }).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    return res;
  });
  // Якщо ми вже віддали копію з кешу, а мережа впаде пізніше — це не помилка
  // сторінки, тож глушимо, щоб не було unhandled rejection у воркері.
  fromNetwork.catch(() => {});

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NAV_TIMEOUT_MS);
  });

  try {
    const res = await Promise.race([fromNetwork, timeout]);
    clearTimeout(timer);
    if (res) return res;
    // мережа не встигла — показуємо збережену сторінку, якщо вона є
    return (await cachedPage()) || (await fromNetwork);
  } catch (err) {
    clearTimeout(timer);
    const cached = await cachedPage();
    if (cached) return cached;
    return new Response(
      `<!doctype html><html lang="uk"><meta charset="utf-8">
       <meta name="viewport" content="width=device-width, initial-scale=1">
       <title>Немає зв'язку — НавігаторПМГ26</title>
       <body style="font-family:system-ui,sans-serif; max-width:520px; margin:18vh auto; padding:0 24px; text-align:center; color:#1f3347;">
         <h1 style="font-size:20px;">Сторінка недоступна офлайн</h1>
         <p style="color:#647688; line-height:1.6;">Цей розділ ще не збережено на пристрої, а зв'язку з мережею зараз немає.</p>
         <p><a href="/" style="color:#0284c7; font-weight:700;">На головну</a> &nbsp;·&nbsp;
            <a href="javascript:location.reload()" style="color:#0284c7; font-weight:700;">Спробувати ще раз</a></p>
       </body></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
