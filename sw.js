/* Service worker порталу НавігаторПМГ26.
   Стратегія: HTML — network-first (щоб оновлення доїжджали одразу),
   статика — cache-first із фоновим оновленням (версії ?v= у HTML).
   Запити до Supabase та інших доменів не перехоплюються. */
const CACHE = 'pmg-portal-v6';
const CORE = [
  '/',
  '/index.html',
  '/portal.css',
  '/styles.css',
  '/auth-v2.css',
  '/assets/icon-192.png',
  '/assets/nszu-shield.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('pmg-portal-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

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
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
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
