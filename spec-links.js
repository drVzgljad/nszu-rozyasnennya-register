// ═══════════════════════════════════════════════════════════════
// Лінкування довідників просто в тексті вимог пакета ПМГ-2026
//
// Вимога у специфікації — це рядок «Що саме – скільки і на яких умовах».
// Раніше і посада, і апарат були голим текстом: щоб дізнатися, що вони
// означають, треба було йти в довідник і шукати руками. Тепер назва у
// вимозі веде просто на паспорт — кваліфікаційну характеристику ДКХП-78
// для посади, картку виробу з кандидатами НК 024 / НК 031 / табелів для
// обладнання.
//
// Координати назв рахують білдери (classifiers/build_posady.py і
// classifiers/build_equipment.py) і кладуть у *_pkg.json. Сторінка НЕ
// розбирає вимогу вдруге: другий парсер того самого неминуче розійшовся б
// із першим. Формат обох карт однаковий:
//   pkgs[номер пакета] = [{h: голова вимоги дослівно,
//                          p: [[зсув, довжина, id], …]}]
// Голову шукаємо в тексті пункту через indexOf, зсуви — від її початку.
// Тому посилання не потрапляє в хвіст умови, де те саме названо в іншому
// відмінку («…за наявності лікаря-анестезіолога»).
//
// Підключення: <script src="../spec-links.js?v=…" defer></script> ПЕРЕД
// скриптом сторінки. Далі SpecLinks.load(cb) і SpecLinks.render(...).
// ═══════════════════════════════════════════════════════════════
(function () {
  "use strict";

  // Шляхи рахуємо від самого файлу, а не від сторінки: модуль лежить у
  // корені, а споживачі — на різній глибині.
  var BASE = (document.currentScript && document.currentScript.src) || location.href;

  // Ключ розділу специфікації → де брати карту і куди вести.
  var KINDS = {
    specialists: {
      data: "classifiers/data/posady/posady_pkg.json",
      page: "classifiers/posady.html",
      cls: "posada-link",
      hint: "Кваліфікаційна характеристика: ",
      fallback: "Кваліфікаційна характеристика ДКХП-78",
    },
    equipment: {
      data: "classifiers/data/equipment/equipment_pkg.json",
      page: "classifiers/obladnannia.html",
      cls: "device-link",
      hint: "Вимога до обладнання: ",
      fallback: "Картка вимоги до обладнання",
    },
  };
  Object.keys(KINDS).forEach(function (k) {
    KINDS[k].dataUrl = new URL(KINDS[k].data, BASE).href;
    KINDS[k].pageUrl = new URL(KINDS[k].page, BASE).href;
    KINDS[k].map = null;
    KINDS[k].pending = null;
  });

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fetchKind(k) {
    if (k.map || k.failed) return Promise.resolve(k.map);
    if (!k.pending) {
      k.pending = fetch(k.dataUrl)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (d) { k.map = d; return d; })
        .catch(function () {
          // Довідники — прикраса поверх вимог, а не їх умова. Не завантажилися —
          // сторінка й далі показує чистий текст специфікації.
          k.failed = true;
          return null;
        });
    }
    return k.pending;
  }

  function load(onReady) {
    var all = Promise.all(Object.keys(KINDS).map(function (n) { return fetchKind(KINDS[n]); }));
    if (onReady) all.then(function () { onReady(); });
    return all;
  }

  // Позиції назв у тексті одного пункту вимог.
  function spansFor(text, pkgNumber, k) {
    if (!k.map || !text) return [];
    var rows = k.map.pkgs[String(pkgNumber)];
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
    for (var m = 0; m < found.length; m++) {
      if (found[m].s >= last) { out.push(found[m]); last = found[m].e; }
    }
    return out;
  }

  // Хвіст ?back=… — на сторінці довідника з'явиться кнопка повернення сюди
  // (домовленість порталу, читає auth-v2.js).
  function back(pkgNumber) {
    return "&back=" + encodeURIComponent(location.pathname + location.search) +
      "&backLabel=" + encodeURIComponent("до вимог пакета " + pkgNumber);
  }

  /**
   * Текст пункту → HTML із посиланнями на паспорти довідника.
   * kind — ключ розділу специфікації ("specialists" або "equipment").
   * fmt — форматер сторінки (екранування + підсвітка пошуку). Він
   * застосовується до КОЖНОГО шматка окремо, тож розмітка посилання не
   * потрапляє під заміну і <mark> не рве href.
   */
  function render(text, pkgNumber, fmt, kind) {
    var k = KINDS[kind || "specialists"];
    var format = fmt || escapeHtml;
    if (!k) return format(text);
    var spans = spansFor(text, pkgNumber, k);
    if (!spans.length) return format(text);

    var html = "", pos = 0;
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      var name = (k.map.names && k.map.names[sp.id]) || "";
      html += format(text.slice(pos, sp.s));
      html += '<a class="' + k.cls + '" href="' + escapeHtml(k.pageUrl) + "?id=" +
        encodeURIComponent(sp.id) + back(pkgNumber) + '" title="' +
        escapeHtml(name ? k.hint + name : k.fallback) + '">' +
        format(text.slice(sp.s, sp.e)) + "</a>";
      pos = sp.e;
    }
    return html + format(text.slice(pos));
  }

  /** Чи є в цьому пакеті що лінкувати в цьому розділі специфікації. */
  function has(pkgNumber, kind) {
    var k = KINDS[kind || "specialists"];
    return !!(k && k.map && k.map.pkgs[String(pkgNumber)]);
  }

  window.SpecLinks = { load: load, render: render, has: has, KINDS: Object.keys(KINDS) };
})();
