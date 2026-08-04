// ═══════════════════════════════════════════════════════════════
// Лінкування довідників просто в тексті вимог пакета ПМГ-2026
//
// Кадрова вимога в специфікації — це рядок «Посада – скільки осіб і на
// яких умовах». Раніше посада була голим текстом: щоб дізнатися, що вона
// взагалі означає, треба було йти в розділ «Посади» і шукати руками.
// Тепер назва у вимозі веде просто на кваліфікаційну характеристику
// ДКХП-78 — паспорт посади з обов'язками і кваліфікаційними вимогами.
//
// Координати назв рахує білдер (classifiers/build_posady.py) і кладе в
// classifiers/data/posady/posady_pkg.json. Сторінка НЕ розбирає вимогу
// вдруге: другий парсер того самого неминуче розійшовся б із першим.
// Формат: pkgs[номер пакета] = [{h: голова вимоги дослівно,
//                               p: [[зсув, довжина, id посади], …]}]
// Голову шукаємо в тексті пункту через indexOf, зсуви — від її початку.
// Тому посилання не потрапляє в хвіст умови, де та сама посада згадана
// в іншому відмінку («…за наявності лікаря-анестезіолога»).
//
// Підключення: <script src="../spec-links.js?v=…" defer></script> ПЕРЕД
// скриптом сторінки. Далі SpecLinks.load(cb) і SpecLinks.render(...).
// ═══════════════════════════════════════════════════════════════
(function () {
  "use strict";

  // Шляхи рахуємо від самого файлу, а не від сторінки: модуль лежить у
  // корені, а споживачі — на різній глибині.
  var BASE = (document.currentScript && document.currentScript.src) || location.href;
  var DATA_URL = new URL("classifiers/data/posady/posady_pkg.json", BASE).href;
  var CARD_URL = new URL("classifiers/posady.html", BASE).href;

  var map = null;         // завантажена карта
  var pending = null;     // проміс завантаження
  var failed = false;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function load(onReady) {
    if (map || failed) {
      if (onReady && map) onReady(map);
      return pending || Promise.resolve(map);
    }
    if (!pending) {
      pending = fetch(DATA_URL)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (d) { map = d; return d; })
        .catch(function () {
          // Довідник посад — прикраса поверх вимог, а не їх умова.
          // Не завантажився — сторінка й далі показує чистий текст.
          failed = true;
          return null;
        });
    }
    if (onReady) pending.then(function (d) { if (d) onReady(d); });
    return pending;
  }

  // Позиції назв посад у тексті одного пункту вимог.
  function spansFor(text, pkgNumber) {
    if (!map || !text) return [];
    var rows = map.pkgs[String(pkgNumber)];
    if (!rows) return [];
    var found = [];
    for (var i = 0; i < rows.length; i++) {
      var base = text.indexOf(rows[i].h);
      if (base < 0) continue;
      var parts = rows[i].p;
      for (var j = 0; j < parts.length; j++) {
        found.push({
          s: base + parts[j][0],
          e: base + parts[j][0] + parts[j][1],
          id: parts[j][2],
        });
      }
    }
    if (found.length < 2) return found;
    // Голови вимог у пакеті подекуди вкладені одна в одну — беремо довшу
    // й викидаємо все, що з нею перетинається.
    found.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var out = [], last = -1;
    for (var k = 0; k < found.length; k++) {
      if (found[k].s >= last) { out.push(found[k]); last = found[k].e; }
    }
    return out;
  }

  /**
   * Текст пункту → HTML із посиланнями на паспорти посад.
   * fmt — форматер сторінки (екранування + підсвітка пошуку). Він
   * застосовується до КОЖНОГО шматка окремо, тож розмітка посилання
   * не потрапляє під заміну і <mark> не рве href.
   */
  function render(text, pkgNumber, fmt) {
    var format = fmt || escapeHtml;
    var spans = spansFor(text, pkgNumber);
    if (!spans.length) return format(text);

    var html = "", pos = 0;
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      var name = (map.names && map.names[sp.id]) || "";
      html += format(text.slice(pos, sp.s));
      html += '<a class="posada-link" href="' + escapeHtml(CARD_URL) + "?id=" +
        encodeURIComponent(sp.id) + '" title="' + escapeHtml(
          name ? "Кваліфікаційна характеристика: " + name : "Кваліфікаційна характеристика ДКХП-78"
        ) + '">' + format(text.slice(sp.s, sp.e)) + "</a>";
      pos = sp.e;
    }
    return html + format(text.slice(pos));
  }

  function has(pkgNumber) {
    return !!(map && map.pkgs[String(pkgNumber)]);
  }

  window.SpecLinks = { load: load, render: render, has: has, KEYS: ["specialists"] };
})();
