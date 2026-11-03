// Старий «Робочий чат» замінено «Чатом департаменту» (zviazok/), 03.11.2026.
//
// Попередній воркер віддавав index.html із кешу ПЕРШОЧЕРГОВО, тож у людини з
// установленим чатом стара сторінка жила б вічно. Браузер сам перевіряє sw.js
// при кожному заході на /chat/ — знаходить цей файл, ставить його, і він:
// стирає кеш старого чату, знімає себе й перезавантажує відкриті вкладки —
// ті потрапляють уже на сторінку-перенаправлення з мережі.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('chat-cache')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const wins = await self.clients.matchAll({ type: 'window' });
    wins.forEach((w) => w.navigate(w.url).catch(() => {}));
  })());
});
