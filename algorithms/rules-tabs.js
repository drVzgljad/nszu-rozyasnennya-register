/* «Правила кодування» — смуга вкладок на три документи: наказ № 377, наказ № 182 і правила
 * амбулаторки (пакет 9). У меню це один пункт; кожна вкладка — власна сторінка з тим самим
 * макетом, тому глибокі посилання (?q=, ?code=) з Кодера й роз'яснень працюють, як раніше.
 *
 * Перелік вкладок — тут і лише тут. Новий документ правил = рядок у TABS і сторінка з
 *   <nav class="rules-tabs" id="rulesTabs" aria-label="Правила кодування"></nav>
 *   <script src="rules-tabs.js?v=…"></script>
 * одразу за нею (звичайний скрипт, без defer: смуга має стояти до того, як auth-v2
 * сховає вкладки, закриті роллю, — він шукає елементи з data-role).
 *
 * Перехід на іншу вкладку переносить запит: код, уведений тут, одразу шукається там.
 */
(function () {
  'use strict';

  const TABS = [
    { id: '377', href: 'index.html', input: 'algorithmSearch', role: 'expert',
      title: 'Наказ № 377', sub: 'амбулаторно-асоційовані стани, правила обліку' },
    { id: '182', href: 'rehab.html', input: 'rehabSearch',
      title: 'Наказ № 182', sub: 'кодування реабілітації' },
    { id: 'amb', href: 'ambulatory.html', input: 'ambSearch', role: 'expert',
      title: 'Пакет 9', sub: 'кодування амбулаторки' },
  ];

  const nav = document.getElementById('rulesTabs');
  if (!nav) return;
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const cur = (TABS.find((t) => t.href === page) || TABS[0]).id;

  nav.innerHTML = '<span class="rules-label">Правила кодування</span>' + TABS.map((t) =>
    `<a class="rules-tab${t.id === cur ? ' is-active' : ''}" href="${t.href}" data-tab="${t.id}"` +
    `${t.role ? ` data-role="${t.role}"` : ''}${t.id === cur ? ' aria-current="page"' : ''}>` +
    `<b>${t.title}</b><span>${t.sub}</span></a>`).join('');

  nav.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.rules-tab');
    if (!a || a.dataset.tab === cur) return;
    const me = TABS.find((t) => t.id === cur);
    const box = me && document.getElementById(me.input);
    const q = box && box.value ? box.value.trim() : '';
    const base = a.getAttribute('href').split('?')[0];
    a.setAttribute('href', q ? base + '?q=' + encodeURIComponent(q) : base);
  });
})();
