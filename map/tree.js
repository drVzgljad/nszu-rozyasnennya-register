/* ============================================================
   Дерево сайту — графічний інтерактивний вигляд Карти порталу.
   Горизонтальне collapsible-дерево: SVG-гілки + HTML-вузли.
   Vanilla JS. Активується перемикачем «Дерево» на сторінці map/.
   ============================================================ */
(function () {
  "use strict";

  const ROLE_BADGE = {
    guest: { t: "всім", cls: "role-guest" },
    expert: { t: "співроб.", cls: "role-expert" },
    manager: { t: "керівн.", cls: "role-manager" },
  };

  // Дерево структури порталу (корінь → кластери → розділи)
  const TREE = {
    name: "НавігаторПМГ26", icon: "🧭", root: true,
    children: [
      {
        name: "Нормативно-довідковий центр", icon: "📚", tone: "b",
        children: [
          { name: "Роз'яснення НСЗУ", icon: "📄", path: "rozjasnennya.html", role: "guest" },
          { name: "Семантичний AI-пошук", icon: "💡", path: "rozjasnennya_semantic.html", role: "guest" },
          { name: "Пакетний навігатор 2026", icon: "📦", path: "pakety/index.html", role: "guest" },
          { name: "Паспорт пакета", icon: "🪪", path: "passport/index.html", role: "guest" },
          { name: "Пілотні проєкти", icon: "🧪", path: "pilots/index.html", role: "guest" },
          { name: "Постанова № 1808", icon: "📜", path: "postanova/index.html", role: "guest" },
          { name: "Алгоритми (Наказ 377)", icon: "🧮", path: "algorithms/index.html", role: "expert" },
          { name: "Кодування реабілітації (Наказ 182)", icon: "🦼", path: "algorithms/rehab.html", role: "guest" },
          { name: "Кодування амбулаторки", icon: "🏥", path: "algorithms/ambulatory.html", role: "guest" },
          { name: "Критерії госпіталізації (Наказ 1044)", icon: "🏥", path: "gospitalizatsiya/index.html", role: "expert" },
          { name: "Нормативна база", icon: "⚖️", path: "regulatory/index.html", role: "guest" },
          { name: "Рентген і ДІВ", icon: "☢️", path: "rentgen/index.html", role: "guest" },
          { name: "ДЕЦ МОЗ", icon: "🏥", path: "dec/index.html", role: "guest" },
          { name: "Договори ЗОЗ", icon: "📑", path: "zoz-dogovr/index.html", role: "guest" },
        ],
      },
      {
        name: "Довідники та класифікатори", icon: "📚", tone: "g",
        children: [
          { name: "Хвороби (НК 025)", icon: "🩺", path: "classifiers/index.html", role: "guest" },
          { name: "Інтервенції (НК 026)", icon: "🔬", path: "classifiers/nk026.html", role: "guest" },
          { name: "Лабораторні (LOINC)", icon: "🧪", path: "classifiers/loinc.html", role: "guest" },
          { name: "Медвироби (НК 024)", icon: "🩹", path: "classifiers/nk024.html", role: "guest" },
          { name: "Номенклатура (НК 031)", icon: "🧾", path: "classifiers/nk031.html", role: "guest" },
          { name: "Табелі оснащення", icon: "📋", path: "classifiers/tabel.html", role: "guest" },
          { name: "Обладнання у вимогах", icon: "🩻", path: "classifiers/obladnannia.html", role: "guest" },
          { name: "Посади (ДКХП-78)", icon: "👥", path: "classifiers/posady.html", role: "guest" },
          { name: "Таблиця співставлення", icon: "🔗", path: "mapping/index.html", role: "guest" },
        ],
      },
      {
        name: "Робота відділу", icon: "🧭", tone: "b",
        children: [
          { name: "Особистий кабінет", icon: "👤", path: "cabinet/index.html", role: "expert" },
          { name: "Планувальник", icon: "🗓️", path: "cabinet/planner.html", role: "expert" },
          { name: "Доручення (СКО-Д)", icon: "✅", path: "skod/tasks.html", role: "manager" },
          { name: "Звіти та аналітика", icon: "📊", path: "skod/reports.html", role: "expert" },
          { name: "Структура департаменту", icon: "👥", path: "dept-tree.html", role: "expert" },
          { name: "Терміни звітування", icon: "⏰", path: "reminders/index.html", role: "expert" },
        ],
      },
      {
        name: "Інформація та комунікації", icon: "💬", tone: "g",
        children: [
          { name: "Робочий чат", icon: "💬", path: "chat/index.html", role: "expert" },
          { name: "Новини та аналітика", icon: "📰", path: "news/index.html", role: "expert" },
          { name: "Інфоцентр", icon: "📡", path: "infocenter/index.html", role: "expert" },
        ],
      },
      {
        name: "Взаємодія та експертиза", icon: "🤝", tone: "b",
        children: [
          { name: "Запитання ЗОЗ", icon: "❓", path: "zoz-questions/index.html", role: "expert" },
          { name: "Пропозиції до ПМГ", icon: "🗳️", path: "pmg-proposals/index.html", role: "expert" },
          { name: "Пропозиції робочих груп", icon: "⚖️", path: "expert-proposals/index.html", role: "expert" },
        ],
      },
      {
        name: "Сервіс і зручності", icon: "🌿", tone: "g",
        children: [
          { name: "Глобальний пошук (Ctrl+K)", icon: "🔍", path: null, role: "guest" },
          { name: "Встановлення застосунку", icon: "📱", path: null, role: "guest" },
          { name: "Хвилинка відпочинку", icon: "🌿", path: "relax/index.html", role: "expert" },
        ],
      },
    ],
  };

  // Геометрія
  const STEP = 40;                 // вертикальний крок між листками
  const X = { root: 16, cluster: 330, leaf: 636 };
  const W = { root: 220, cluster: 250, leaf: 250 };
  const collapsed = Object.create(null);

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const avg = (a) => a.reduce((s, n) => s + n, 0) / (a.length || 1);
  const prefixFor = (p) => "../" + p;

  // Обчислення позицій
  function layout() {
    let slot = 0;
    TREE.children.forEach((cl) => {
      if (collapsed[cl.name]) {
        cl._y = slot * STEP + STEP / 2;
        slot++;
      } else {
        const ys = [];
        cl.children.forEach((s) => {
          s._y = slot * STEP + STEP / 2;
          ys.push(s._y);
          slot++;
        });
        cl._y = avg(ys);
      }
    });
    TREE._y = avg(TREE.children.map((c) => c._y));
    return slot * STEP; // повна висота
  }

  // Горизонтальна крива між (x1,y1) і (x2,y2)
  function link(x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  function nodeHTML(node, level) {
    const x = level === 0 ? X.root : level === 1 ? X.cluster : X.leaf;
    const w = level === 0 ? W.root : level === 1 ? W.cluster : W.leaf;
    if (level === 0) {
      return `<a class="tn tn-root" href="../index.html" style="left:${x}px;top:${node._y}px;width:${w}px" title="На головну">
        <span class="tn-ico">${node.icon}</span><span class="tn-name">${esc(node.name)}</span></a>`;
    }
    if (level === 1) {
      const cnt = node.children.length;
      const isC = collapsed[node.name];
      return `<button type="button" class="tn tn-cluster tone-${node.tone}${isC ? " is-collapsed" : ""}" data-cluster="${esc(node.name)}" style="left:${x}px;top:${node._y}px;width:${w}px">
        <span class="tn-ico">${node.icon}</span>
        <span class="tn-name">${esc(node.name)}</span>
        <span class="tn-count">${cnt}</span>
        <span class="tn-caret">${isC ? "▸" : "▾"}</span></button>`;
    }
    const badge = ROLE_BADGE[node.role] || ROLE_BADGE.guest;
    const tag = node.path ? "a" : "div";
    const href = node.path ? ` href="${esc(prefixFor(node.path))}"` : "";
    return `<${tag} class="tn tn-leaf${node.path ? "" : " tn-static"}"${href} style="left:${x}px;top:${node._y}px;width:${w}px" title="${esc(node.name)}">
      <span class="tn-ico">${node.icon}</span>
      <span class="tn-name">${esc(node.name)}</span>
      <span class="tn-badge ${badge.cls}">${badge.t}</span></${tag}>`;
  }

  function render(container) {
    const h = layout();
    const totalW = X.leaf + W.leaf + 24;
    const totalH = Math.max(h, TREE._y * 2) + 20;

    // SVG-гілки
    const paths = [];
    TREE.children.forEach((cl) => {
      paths.push(`<path class="tl tl-cluster tone-${cl.tone}" d="${link(X.root + W.root, TREE._y, X.cluster, cl._y)}"/>`);
      if (!collapsed[cl.name]) {
        cl.children.forEach((s) => {
          paths.push(`<path class="tl tl-leaf tone-${cl.tone}" d="${link(X.cluster + W.cluster, cl._y, X.leaf, s._y)}"/>`);
        });
      }
    });

    // Вузли
    const nodes = [nodeHTML(TREE, 0)];
    TREE.children.forEach((cl) => {
      nodes.push(nodeHTML(cl, 1));
      if (!collapsed[cl.name]) cl.children.forEach((s) => nodes.push(nodeHTML(s, 2)));
    });

    container.style.width = totalW + "px";
    container.style.height = totalH + "px";
    container.innerHTML =
      `<svg class="tree-links" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">${paths.join("")}</svg>` +
      nodes.join("");
  }

  let inited = false;
  let stage = null;

  function init() {
    if (inited) return;
    inited = true;
    stage = document.getElementById("map-tree-stage");
    if (!stage) return;
    render(stage);

    // Клік по кластеру — згорнути/розгорнути
    stage.addEventListener("click", (e) => {
      const btn = e.target.closest(".tn-cluster");
      if (!btn) return;
      const name = btn.dataset.cluster;
      collapsed[name] = !collapsed[name];
      render(stage);
    });

    // Контроли «розгорнути / згорнути все»
    const expandAll = document.getElementById("tree-expand");
    const collapseAll = document.getElementById("tree-collapse");
    if (expandAll) expandAll.addEventListener("click", () => {
      TREE.children.forEach((c) => (collapsed[c.name] = false));
      render(stage);
    });
    if (collapseAll) collapseAll.addEventListener("click", () => {
      TREE.children.forEach((c) => (collapsed[c.name] = true));
      render(stage);
    });

  }

  // Перемикач вигляду + повноекранне дерево
  document.addEventListener("DOMContentLoaded", () => {
    const btnCards = document.getElementById("view-cards");
    const btnTree = document.getElementById("view-tree");
    const cardsView = document.getElementById("view-cards-panel");
    const treeView = document.getElementById("view-tree-panel");
    const exitBtn = document.getElementById("tree-exit-fs");
    if (!btnTree || !treeView) return;

    const setFS = (on) => {
      treeView.classList.toggle("is-fs", on);
      document.body.classList.toggle("tree-fs-lock", on);
      if (exitBtn) exitBtn.hidden = !on;
      try {
        if (on && !document.fullscreenElement && treeView.requestFullscreen) treeView.requestFullscreen();
        else if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
      } catch (e) { /* native fullscreen недоступний — лишається CSS-overlay */ }
    };

    const show = (mode) => {
      const tree = mode === "tree";
      treeView.hidden = !tree;
      if (cardsView) cardsView.hidden = tree;
      btnTree.classList.toggle("is-active", tree);
      if (btnCards) btnCards.classList.toggle("is-active", !tree);
      document.getElementById("map-controls-panel")?.toggleAttribute("hidden", tree);
      if (tree) { init(); setFS(true); }   // дерево одразу на весь екран
      else setFS(false);
    };

    btnTree.addEventListener("click", () => show("tree"));
    if (btnCards) btnCards.addEventListener("click", () => show("cards"));
    // Вихід із повноекранного дерева (кнопка ✕ або Esc) → повертаємось до карток
    if (exitBtn) exitBtn.addEventListener("click", () => show("cards"));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && treeView.classList.contains("is-fs")) show("cards");
    });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && treeView.classList.contains("is-fs")) show("cards");
    });
  });
})();
