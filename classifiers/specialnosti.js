/* ============================================================
   Спеціальності та посади — фронтенд.
   Три реєстри в одному вікні: Додаток 7 до Ліцензійних умов (за чим ліцензія),
   Перелік професій/посад МОЗ № 1065 (що можна вписати у штатний розпис) і
   кадрові вимоги пакетів ПМГ-2026 (чи можна цю вимогу взагалі виконати).

   Сторінка — ВЬЮ НА СПІЛЬНИЙ ГРАФ, а не власник даних. Три вкладки — це три
   типи вузлів: spec (Додаток 7), post (Перелік МОЗ) і pkgreq (кадрова вимога
   пакета зі світлофором виконуваності). Реєстр ніде в коді не згадується —
   лише тип, — тому наступна номенклатура не потребуватиме нової сторінки.

   Дані (будує classifiers/build_kadry_graph.py):
     data/kadry/graph_index.json — шапка: підсумки, підписи, вади джерел,
                                   назви пакетів, перелік файлів з вузлами
     data/kadry/nodes_spec.json  — легкі вузли Додатка 7
     data/kadry/nodes_post.json  — легкі вузли Переліку МОЗ № 1065
   а з першою карткою — важкі поля і два відношення:
     cards_spec / cards_post / cards_pkgreq, edges_spec_post / edges_req_post
   Повний graph.json сторінка НЕ вантажить: там ще й характеристики ДКХП,
   коди НСЗУ і решта відношень, які цій сторінці не потрібні.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Вкладка ↔ тип вузла. Далі в коді реєстр не згадується — тільки тип.
  const TYPE = { s: "spec", p: "post", r: "pkgreq" };
  const REG = { spec: "s", post: "p", pkgreq: "r" };

  // Світлофор кадрової вимоги: коротка мітка для списку, повне пояснення
  // приїжджає з графа (IDX.tones) і показується в картці.
  const TONE_TAG = { ok: "виконувана", warn: "звужений вибір", risk: "не зіставлено" };
  const TONE_CLASS = { ok: "ok", warn: "cross", risk: "risk" };

  // Короткі підписи рівнів збігу для інтерфейсу. Повні пояснення лежать у
  // графі (edge_rels.spec_post.levels), але в тег вони не вміщаються.
  const MATCH_TAG = {
    exact: "точний", manual: "звірено вручну",
    root: "за коренем", morph: "за основами", none: "немає пари",
  };

  // Те, чого граф не описує: позначки, які беруться не з рівня збігу, а зі
  // стану вузла або з самого акта. Формулювання рівнів і тонів звідси НЕ
  // дублюємо — вони приїжджають із графа й писалися разом із правилом.
  const HELP = {
    none: "Жодна посада Переліку МОЗ під цю спеціальність не підійшла. Це не " +
          "вада зіставлення, а реальна прогалина: заклад не зможе ввести " +
          "відповідну посаду у штатний розпис.",
    cross: "Знайшлася лише посада іншого рівня, ніж розділ Додатка 7 — " +
           "наприклад, спеціальності професіонала відповідає лікарська посада. " +
           "Зв'язок слабший, і ховати це не можна.",
    reg: "У Переліку МОЗ № 1065 навпроти професії стоїть відмітка про " +
         "додаткове регулювання — тобто доступ до неї визначає не лише " +
         "Перелік, а й окремі вимоги.",
    crit: "Рівень вимоги за поділом умов закупівлі. Критерії поділу встановлює " +
          "пункт 5 Порядку, затвердженого постановою КМУ від 25.04.2018 № 410; " +
          "у специфікації такі вимоги позначені зірочкою. Сам критерій — в акті, " +
          "специфікація лише посилається на нього.",
  };

  let IDX = null;                    // шапка графа
  let NODES = [];                    // легкі вузли spec + post
  let CARD = null;                   // id → важкі поля вузла
  let OUT = null, IN = null;         // суміжність за напрямом
  let detailPromise = null, reqsPromise = null, openedId = null;
  let registry = "s";
  const byId = new Map();          // з префіксом типу і без — для старих посилань
  const byNode = new Map();        // id вузла будь-якого типу → легкий вузол
  const el = {};

  // ══════════════════════════════════════════════════════════
  function boot() {
    [["search", "#spSearch"], ["count", "#spCount"], ["clear", "#spClear"],
     ["results", "#spResults"], ["reader", "#spReader"], ["stats", "#spStats"],
     ["banner", "#specBanner"], ["selSec", "#selSec"], ["selKind", "#selKind"],
     ["selPart", "#selPart"], ["selPkg", "#selPkg"], ["onlyNoPost", "#onlyNoPost"],
     ["onlyCross", "#onlyCross"], ["onlyPkg", "#onlyPkg"], ["onlyReg", "#onlyReg"],
     ["selTone", "#selTone"], ["onlyCrit", "#onlyCrit"],
     ["cntS", "#cntS"], ["cntP", "#cntP"], ["cntR", "#cntR"], ["issues", "#spIssues"],
     ["issuesBody", "#spIssuesBody"], ["layout", ".nk-layout"]]
      .forEach(([k, sel]) => (el[k] = $(sel)));

    Promise.all(["graph_index.json", "nodes_spec.json", "nodes_post.json"].map(getJSON))
      .then(([idx, specs, posts]) => {
        IDX = idx;
        NODES = specs.concat(posts);
        NODES.forEach((n) => {
          byId.set(n.id, n);
          byNode.set(n.id, n);
          // Ctrl+K і зовнішні посилання ведуть сюди з ідентифікатором без
          // префікса типу («S001», «P012») — так їх зберіг глобальний пошук.
          // Приймаємо обидві форми, інакше кожне старе посилання дасть порожню
          // панель, а користувач не побачить навіть, що саме не знайшлося.
          byId.set(bare(n.id), n);
        });
        onReady();
      })
      .catch(() => {
        el.count.textContent = "Не вдалося завантажити реєстр спеціальностей.";
      });
  }

  const bare = (id) => String(id).split(":").pop();

  const DETAIL = [
    "cards_spec.json", "cards_post.json", "cards_pkgreq.json",
    "edges_spec_post.json", "edges_req_post.json",
  ];

  /** Вузли кадрових вимог — аж коли відкрили їхню вкладку або картку.
   *  На старті вони не потрібні, а це ще сто кілобайт до першого кадру. */
  function loadReqs() {
    if (!reqsPromise) {
      reqsPromise = getJSON("nodes_pkgreq.json")
        .then((rows) => {
          rows.forEach((n) => { byId.set(n.id, n); byNode.set(n.id, n); });
          NODES = NODES.concat(rows);
          return rows;
        })
        .catch((err) => { reqsPromise = null; throw err; });
    }
    return reqsPromise;
  }

  /** Важкі поля і відношення — аж коли відкривають першу картку. */
  function loadDetail() {
    if (CARD) return Promise.resolve(CARD);
    if (!detailPromise) {
      detailPromise = Promise.all([loadReqs()].concat(DETAIL.map(getJSON)))
        .then(([, cs, cp, cr, eSpecPost, eReqPost]) => {
          CARD = Object.assign({}, cs, cp, cr);
          OUT = new Map();
          IN = new Map();
          eSpecPost.concat(eReqPost).forEach((e) => {
            push(OUT, e.from, e);
            push(IN, e.to, e);
          });
          return CARD;
        })
        .catch((err) => {
          // Без скидання проміса панель лишалася б порожньою назавжди:
          // відхилений проміс кешується, і наступний клік нічого не малює.
          detailPromise = null;
          throw err;
        });
    }
    return detailPromise;
  }

  function getJSON(name) {
    return fetch("data/kadry/" + name).then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  /** Вузол цілком: легкі поля плюс важкі з картки. Легкі беремо із byNode —
   *  туди складено всі типи, які сторінка вантажить, зокрема вузли вимог, що
   *  приїжджають аж із паспортом. */
  function full(id) {
    return Object.assign({}, byNode.get(id), CARD[id]);
  }

  function push(map, key, val) {
    const a = map.get(key);
    if (a) a.push(val); else map.set(key, [val]);
  }

  const out = (id, rel) => (OUT.get(id) || []).filter((e) => e.rel === rel);
  const inc = (id, rel) => (IN.get(id) || []).filter((e) => e.rel === rel);

  function onReady() {
    renderBanner();
    renderStats();
    renderIssues();
    renderLegend();
    populateSelects();
    wireUI();
    applyRegistry();

    const q = new URLSearchParams(location.search);
    const reg = q.get("reg");
    if (reg === "p" || reg === "r") switchRegistry(reg);
    const pkg = q.get("package");
    if (pkg) el.selPkg.value = pkg;
    const text = q.get("q");
    if (text) el.search.value = text;
    refilter();
    const id = q.get("id");
    if (id && byId.has(id)) openCard(byId.get(id).id);
  }

  // ══════════════════════════════════════════════════════════
  /** ISO-дата графа → як її пишуть в актах. */
  function ua(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || "");
  }

  function renderBanner() {
    const d = IDX.node_types.spec;
    if (d.status !== "набирає чинності") return;
    el.banner.hidden = false;
    el.banner.innerHTML =
      `⏳ Перелік спеціальностей показано в редакції, яка <b>ще не діє</b>: ` +
      `постанова КМУ від 24.06.2026 № 813 набирає чинності <b>${esc(ua(d.valid_from))}</b> ` +
      `(опубліковано ${esc(d.published)}). До цієї дати чинний попередній Додаток 7 ` +
      `у редакції постанови № 781 — там ще «молодші спеціалісти з медичною освітою» ` +
      `і «фахівці з реабілітації».`;
  }

  function renderStats() {
    const c = IDX.counts;
    const withPost = c.spec - c.spec_without_post;
    // Числівник тут не декоративний: «172 спеціальностей» і «301 позицій» —
    // помилка відмінка, яку видно з першого екрана.
    el.stats.innerHTML = [
      [c.spec,
       plural(c.spec, "спеціальність", "спеціальності", "спеціальностей") +
       " у Додатку 7"],
      [c.post,
       plural(c.post, "позиція", "позиції", "позицій") + " у Переліку МОЗ № 1065"],
      [withPost,
       plural(withPost, "спеціальність має", "спеціальності мають", "спеціальностей мають") +
       " посаду"],
      [c.packages_with_staff,
       plural(c.packages_with_staff, "пакет", "пакети", "пакетів") +
       " із кадровими вимогами"],
      [c.orphan_names,
       plural(c.orphan_names, "посада", "посади", "посад") +
       " з вимог пакетів поза Переліком"],
    ].map(([n, l]) =>
      `<div class="stat"><strong>${nf(n)}</strong><span>${esc(l)}</span></div>`).join("");
    el.cntS.textContent = nf(c.spec);
    el.cntP.textContent = nf(c.post);
    el.cntR.textContent = nf(c.pkgreq);
  }

  function renderIssues() {
    const d = (IDX.notes || {}).spec || [];
    if (!d.length) return;
    el.issues.hidden = false;
    el.issuesBody.innerHTML = d.map((x) =>
      `<h4>${esc(x.source)}</h4><p>${esc(x.issue)}</p>` +
      `<ul>${x.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join("");
  }

  /** Легенда позначок активної вкладки.
   *
   *  Позначки — це стиснуті до двох слів твердження про надійність зіставлення
   *  або про стан вимоги, і без розшифровки список читається як шифр. Тексти
   *  беремо з графа там, де вони там є: рівні збігу і тони писалися разом із
   *  самим правилом, тож дублювати їх у сторінці означало б завести другу
   *  правду. */
  function renderLegend() {
    const rows = [];
    if (registry === "s") {
      const lv = ((IDX.edge_rels || {}).spec_post || {}).levels || {};
      rows.push(["", "Офіційного зіставлення спеціальність ↔ посада не існує — " +
        "місток обчислено за назвами. Позначка каже, наскільки він надійний."]);
      ["exact", "manual", "root", "morph"].forEach((k) => {
        if (lv[k]) rows.push([`<span class="sp-tag m-${k}">${esc(MATCH_TAG[k])}</span>`, lv[k]]);
      });
      rows.push([`<span class="sp-tag m-none">${esc(MATCH_TAG.none)}</span>`, HELP.none]);
      rows.push(['<span class="sp-tag cross">інший рівень</span>', HELP.cross]);
    } else if (registry === "p") {
      rows.push(['<span class="sp-tag reg">дод. регулювання</span>', HELP.reg]);
    } else {
      const tones = IDX.tones || {};
      rows.push(["", "Світлофор відповідає на одне питання: чи може заклад " +
        "виконати цю вимогу після 01.09.2026, коли посади поза Переліком МОЗ " +
        "вводити стане не можна."]);
      ["ok", "warn", "risk"].forEach((k) => {
        if (tones[k]) {
          rows.push([`<span class="sp-tag ${TONE_CLASS[k]}">${esc(TONE_TAG[k])}</span>`, tones[k]]);
        }
      });
      rows.push(["<b>критична</b>", HELP.crit]);
    }
    $("#spLegendBody").innerHTML = rows.map(([tag, text]) => tag
      ? `<div class="sp-legend-row">${tag}<span>${esc(text)}</span></div>`
      : `<p class="sp-legend-lead">${esc(text)}</p>`).join("");
  }

  function secLabel(k) { return (IDX.labels.sec || {})[k] || k; }
  function partLabel(k) { return (IDX.labels.part || {})[k] || k; }

  function populateSelects() {
    el.selSec.innerHTML = '<option value="">— усі розділи —</option>' +
      Object.entries(IDX.counts.spec_sections).map(([k, n]) =>
        `<option value="${esc(k)}">${esc(secLabel(k))} (${n})</option>`).join("");

    const kinds = new Set();
    NODES.forEach((n) => (n.kinds || []).forEach((k) => kinds.add(k)));
    el.selKind.innerHTML = '<option value="">— будь-який —</option>' +
      Array.from(kinds).sort().map((k) =>
        `<option value="${esc(k)}">${esc(k)}</option>`).join("");

    // Пакети тепер є вже на першому кадрі: їхні номери й назви приїхали в
    // шапці графа, а не з файла кадрових вимог на 360 КБ.
    el.selPkg.innerHTML = '<option value="">— будь-який —</option>' +
      Object.keys(IDX.packages).sort(byPkgNo).map((no) =>
        `<option value="${esc(no)}">№ ${esc(no)} · ${
          esc(trim(IDX.packages[no], 46))}</option>`).join("");
  }

  function byPkgNo(a, b) { return (+a || 999) - (+b || 999); }

  function trim(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  // ══════════════════════════════════════════════════════════
  function wireUI() {
    $$(".spec-tab").forEach((b) =>
      b.addEventListener("click", () => switchRegistry(b.dataset.reg)));

    let t = null;
    el.search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(refilter, 140);
    });
    [el.selSec, el.selKind, el.selPart, el.selPkg, el.selTone, el.onlyNoPost,
     el.onlyCross, el.onlyPkg, el.onlyReg, el.onlyCrit]
      .forEach((c) => c && c.addEventListener("change", refilter));

    el.clear.addEventListener("click", () => {
      el.search.value = "";
      [el.selSec, el.selKind, el.selPart, el.selPkg, el.selTone]
        .forEach((s) => (s.value = ""));
      [el.onlyNoPost, el.onlyCross, el.onlyPkg, el.onlyReg, el.onlyCrit]
        .forEach((c) => (c.checked = false));
      refilter();
    });

    $$(".mobile-tab").forEach((b) => b.addEventListener("click", () => {
      $$(".mobile-tab").forEach((x) => x.classList.toggle("active", x === b));
      el.layout.dataset.active = b.dataset.tab;
    }));
  }

  function switchRegistry(reg) {
    registry = reg;
    $$(".spec-tab").forEach((b) => {
      const on = b.dataset.reg === reg;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    applyRegistry();
    renderLegend();
    if (reg === "r" && !NODES.some((n) => n.type === "pkgreq")) {
      el.count.textContent = "Завантаження кадрових вимог…";
      loadReqs().then(refilter).catch(() => {
        el.count.textContent = "Не вдалося завантажити кадрові вимоги.";
      });
      return;
    }
    refilter();
  }

  /** Показує лише ті фільтри, які мають сенс для активної вкладки.
   *  data-for приймає кілька вкладок через пробіл: «лише те, що є кадровою
   *  вимогою пакета» доречне і для спеціальностей, і для посад, а для самих
   *  вимог безглузде — вони всі такі. */
  function applyRegistry() {
    $$("[data-for]").forEach((n) => {
      n.hidden = !n.dataset.for.split(" ").includes(registry);
    });
    el.onlyReg.hidden = false;
  }

  // ══════════════════════════════════════════════════════════
  function refilter() {
    const q = el.search.value.trim().toLowerCase();
    const sec = el.selSec.value, kind = el.selKind.value;
    const part = el.selPart.value, pkg = el.selPkg.value;
    const type = TYPE[registry];

    let list = NODES.filter((n) => n.type === type);
    if (q) list = list.filter((n) => n.name.toLowerCase().includes(q));
    if (type === "spec") {
      if (sec) list = list.filter((n) => n.sec === sec);
      if (kind) list = list.filter((n) => (n.kinds || []).includes(kind));
      if (el.onlyNoPost.checked) list = list.filter((n) => !deg(n, "post"));
      if (el.onlyCross.checked) list = list.filter((n) => n.cross);
    } else if (type === "post") {
      if (part) list = list.filter((n) => n.part === part);
      if (el.onlyReg.checked) list = list.filter((n) => n.regulated);
    } else {
      const tone = el.selTone.value;
      if (tone) list = list.filter((n) => (n.tone || "ok") === tone);
      if (el.onlyCrit.checked) list = list.filter((n) => n.critical);
    }

    // Пакети лежать просто на вузлі — обходу графа й довантаження для цих
    // двох фільтрів більше не треба.
    if (pkg) list = list.filter((n) => (n.pkg || []).includes(pkg));
    else if (el.onlyPkg.checked && type !== "pkgreq") {
      list = list.filter((n) => (n.pkg || []).length);
    }

    paint(list);
  }

  function deg(n, type) { return (n.deg || {})[type] || 0; }

  function paint(list) {
    const noun = registry === "s"
      ? ["спеціальність", "спеціальності", "спеціальностей"]
      : registry === "p"
        ? ["позиція", "позиції", "позицій"]
        : ["вимога", "вимоги", "вимог"];
    el.count.textContent = `${nf(list.length)} ${plural(list.length, ...noun)}`;
    el.results.hidden = list.length === 0;
    if (!list.length) {
      el.results.innerHTML = "";
      return;
    }
    el.results.innerHTML = list.slice(0, 400).map(rowHTML).join("") +
      (list.length > 400
        ? `<p class="eq-more">Показано перші 400 із ${nf(list.length)} — уточніть пошук.</p>`
        : "");
    $$(".rrow", el.results).forEach((b) =>
      b.addEventListener("click", () => openCard(b.dataset.id)));
    if (openedId) {
      const a = $(`.rrow[data-id="${cssEsc(openedId)}"]`, el.results);
      if (a) a.classList.add("active");
    }
  }

  function rowHTML(n) {
    if (n.type === "spec") {
      const kinds = (n.kinds || []).map((k) =>
        `<span class="sp-kind k-${esc(k)}">${esc(k)}</span>`).join("");
      const m = n.match || "none";
      const tag = n.cross
        ? `<span class="sp-tag cross" title="${esc(HELP.cross)}">інший рівень</span>`
        : `<span class="sp-tag m-${esc(m)}" title="${esc(matchHelp(m))}">${
            esc(MATCH_TAG[m] || m)}</span>`;
      return `<button class="rrow" type="button" data-id="${esc(n.id)}">
          <span class="rmain">
            <span class="tname">${esc(n.name)}</span>
            <span class="sp-kinds">${kinds}</span>
          </span>${tag}</button>`;
    }
    if (n.type === "pkgreq") return reqRowHTML(n);
    const nspec = deg(n, "spec");
    const meta = [partLabel(n.part)];
    if (nspec) meta.push(`${nspec} ${
      plural(nspec, "спеціальність", "спеціальності", "спеціальностей")}`);
    return `<button class="rrow" type="button" data-id="${esc(n.id)}">
        <span class="rmain">
          <span class="tname">${esc(n.name)}</span>
          <span class="rmeta">${esc(meta.join(" · "))}</span>
        </span>
        ${n.regulated
          ? `<span class="sp-tag reg" title="${esc(HELP.reg)}">дод. регулювання</span>`
          : ""}</button>`;
  }

  function reqRowHTML(n) {
    const tone = n.tone || "ok";
    const meta = [`Пакет № ${n.package}`, trim(IDX.packages[n.package] || "", 44)];
    if (n.critical) meta.push("критична");
    return `<button class="rrow" type="button" data-id="${esc(n.id)}">
        <span class="rmain">
          <span class="tname">${esc(trim(n.name, 130))}</span>
          <span class="rmeta">${esc(meta.filter(Boolean).join(" · "))}</span>
        </span>
        <span class="sp-tag ${esc(TONE_CLASS[tone])}" title="${
          esc((IDX.tones || {})[tone] || "")}">${esc(TONE_TAG[tone])}</span></button>`;
  }

  /** Повне пояснення рівня збігу: з графа, а для «немає пари» — своє. */
  function matchHelp(level) {
    if (level === "none") return HELP.none;
    return (((IDX.edge_rels || {}).spec_post || {}).levels || {})[level] || "";
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // ══════════════════════════════════════════════════════════
  function openCard(id) {
    const node = byId.get(id);
    if (!node) return;
    openedId = node.id;
    $$(".rrow", el.results).forEach((b) =>
      b.classList.toggle("active", b.dataset.id === openedId));
    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = '<p class="po-loading">Завантаження паспорта…</p>';
    if (window.matchMedia("(max-width: 720px)").matches) {
      el.layout.dataset.active = "reader";
      $$(".mobile-tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === "reader"));
    }
    loadDetail()
      .then(() => {
        const f = full(openedId);
        el.reader.innerHTML = node.type === "spec" ? specCardHTML(node, f)
          : node.type === "post" ? postCardHTML(node, f) : reqCardHTML(node, f);
        $$("[data-goto]", el.reader).forEach((b) =>
          b.addEventListener("click", () => {
            const target = b.dataset.goto;
            switchRegistry(REG[byId.get(target).type]);
            el.search.value = "";
            refilter();
            openCard(target);
          }));
        el.reader.scrollTop = 0;
      })
      .catch(() => {
        el.reader.innerHTML =
          '<p class="sp-empty">Не вдалося завантажити паспорт. Спробуйте ще раз.</p>';
      });
  }

  function linkBtn(id, name, sub) {
    return `<button class="sp-link" type="button" data-goto="${esc(id)}">
        <span><span class="sp-linkname">${esc(name)}</span>${
          sub ? `<span class="sp-linkpath">${esc(sub)}</span>` : ""}</span>
        <span class="sp-tag m-root">відкрити</span></button>`;
  }

  function specCardHTML(n, f) {
    const kinds = (f.kinds || []).map((k) =>
      `<span class="sp-kind k-${esc(k)}">${esc(k)}</span>`).join("");

    const postIds = out(n.id, "spec_post").map((e) => e.to);
    let posts;
    if (!postIds.length) {
      posts = `<div class="sp-empty">У Переліку професій (посад) МОЗ № 1065 посади під цю
        спеціальність немає. Заклад не зможе ввести відповідну посаду у штатний розпис —
        пункт 32 Ліцензійних умов дозволяє тільки посади з Переліку.</div>`;
    } else {
      posts = `<div class="sp-links">${postIds.map((pid) => {
        const p = full(pid);
        return linkBtn(pid, p.name || pid, (p.path || []).slice(-1)[0] || "");
      }).join("")}</div>`;
      if (n.cross) {
        posts += `<div class="sp-empty" style="margin-top:9px">Знайдено лише посаду
          <b>іншого рівня</b>: спеціальність належить до розділу «${esc(secLabel(n.sec))}»,
          а посада — лікарська. Рівноцінної посади свого рівня Перелік МОЗ не містить.</div>`;
      }
    }

    const also = (f.also_in || []).length
      ? `<div class="reader-block"><h3>Та сама назва в інших розділах</h3>
         <div class="sp-links">${f.also_in.map((sec) => {
           const twin = NODES.find((x) =>
             x.type === "spec" && x.name === f.name && x.sec === sec);
           return twin ? linkBtn(twin.id, f.name, secLabel(sec)) : "";
         }).join("")}</div>
         <p class="sp-sub" style="margin-top:8px">Таблиця Додатка 7 не має ідентифікаторів
         рядків, тому розрізнити ці позиції можна лише за розділом.</p></div>`
      : "";

    return `
      <h2 class="sp-title">${esc(f.name)}</h2>
      <p class="sp-sub">${esc(secLabel(n.sec))} · Додаток 7 до Ліцензійних умов
        у редакції ПКМУ від 24.06.2026 № 813</p>
      <div class="sp-kinds" style="margin:10px 0 0">${kinds}</div>

      <div class="reader-block">
        <h3>Вид медичної та реабілітаційної допомоги</h3>
        <p class="sp-sub">За цією спеціальністю ліцензія дає право надавати:
          <b>${esc((f.kinds || []).join(", ") || "—")}</b>.</p>
      </div>

      <div class="reader-block">
        <h3>Посада за Переліком МОЗ № 1065${
          n.match ? ` <span class="sp-tag m-${esc(n.match)}">${
            esc(MATCH_TAG[n.match] || n.match)}</span>` : ""}</h3>
        ${posts}
      </div>
      ${also}
      ${pkgBlockHTML(n, postIds)}`;
  }

  function postCardHTML(n, f) {
    const specIds = inc(n.id, "spec_post").map((e) => e.from);
    const specs = specIds.length
      ? `<div class="sp-links">${specIds.map((sid) => {
          const s = full(sid);
          return linkBtn(sid, s.name || sid, secLabel(s.sec));
        }).join("")}</div>`
      : `<div class="sp-empty">Жодна спеціальність Додатка 7 на цю посаду не виводить.
         Це нормально для адміністративних, технічних і допоміжних посад — ліцензія
         видається не на них.</div>`;

    const notes = (f.notes || []).length
      ? `<p class="sp-sub" style="margin-top:8px">У Переліку до цієї позиції є виноска
         № ${f.notes.join(", № ")} — дивіться примітки до наказу МОЗ № 1065.</p>`
      : "";

    return `
      <h2 class="sp-title">${esc(f.name)}</h2>
      <p class="sp-sub">${esc(partLabel(f.part))} · позиція № ${esc(f.no)}</p>
      <p class="sp-path">${esc((f.path || []).join(" → "))}</p>

      <div class="reader-block">
        <h3>Професійна кваліфікація для доступу</h3>
        ${f.qual
          ? `<div class="sp-qual">${esc(f.qual)}</div>`
          : `<div class="sp-empty">У Переліку графа кваліфікації для цієї позиції порожня —
             вимоги визначає професійний стандарт, а за його відсутності ДКХП, випуск 78.</div>`}
        <p class="sp-sub" style="margin-top:8px">${f.regulated
          ? "Професія належить до тих, для яких запроваджено <b>додаткове регулювання</b>."
          : "Додаткового регулювання для цієї професії не запроваджено."}</p>
        ${notes}
      </div>

      <div class="reader-block">
        <h3>Спеціальності Додатка 7, які ведуть на цю посаду</h3>
        ${specs}
      </div>
      ${pkgBlockHTML(n, [n.id])}`;
  }

  /** Паспорт кадрової вимоги: чи може заклад її виконати і ким саме.
   *
   *  Питання тут одне — п. 32 Ліцензійних умов у редакції ПКМУ № 813: із
   *  01.09.2026 посаду поза Переліком МОЗ ввести не можна, тож вимога, яка
   *  називає таку посаду, у цій частині стає невиконуваною. Тон рахує білдер,
   *  а тут ми його лише показуємо разом із причиною. */
  function reqCardHTML(n, f) {
    const tone = n.tone || "ok";
    const postIds = out(n.id, "req_post").map((e) => e.to);
    const posts = postIds.length
      ? `<div class="sp-links">${postIds.map((pid) => {
          const p = full(pid);
          return linkBtn(pid, p.name || pid, (p.path || []).slice(-1)[0] || "");
        }).join("")}</div>`
      : `<div class="sp-empty">Жодна з названих посад не зійшлася з Переліком
         професій (посад) МОЗ № 1065.</div>`;

    // Причина тону: для «risk» її дає граф окремим полем (буває, що винна
    // друкарська помилка специфікації, а не брак посади), для «warn» причина —
    // сам перелік альтернатив поза Переліком.
    const why = f.tone_why
      ? `<div class="sp-orphan" style="margin-top:9px">${esc(f.tone_why)}</div>`
      : (f.orphans || []).length
        ? `<div class="sp-orphan" style="margin-top:9px">Поза Переліком МОЗ:
           ${esc(f.orphans.join(", "))}. Виконувати доведеться через інший варіант
           переліку «та/або».</div>`
        : "";

    return `
      <h2 class="sp-title">${esc(n.name)}</h2>
      <p class="sp-sub"><a href="../pakety/index.html?package=${esc(n.package)}"
        >Пакет № ${esc(n.package)} · ${esc(IDX.packages[n.package] || "")}</a>${
        f.scope ? " · " + esc(f.scope) : ""}${n.critical ? " · критична вимога" : ""}</p>

      <div class="reader-block">
        <h3>Чи виконувана вимога
          <span class="sp-tag ${esc(TONE_CLASS[tone])}">${esc(TONE_TAG[tone])}</span></h3>
        <p class="sp-sub">${esc((IDX.tones || {})[tone] || "")}</p>
        ${why}
      </div>

      <div class="reader-block">
        <h3>Як вимога записана в специфікації</h3>
        <div class="sp-qual">${esc(f.raw || n.name)}</div>
        ${f.cond ? `<p class="sp-sub" style="margin-top:8px"><b>Умова:</b>
          ${esc(f.cond)}</p>` : ""}
      </div>

      <div class="reader-block">
        <h3>Посади Переліку МОЗ, які називає вимога${
          postIds.length ? ` <span class="sp-tag m-root">${postIds.length}</span>` : ""}</h3>
        ${posts}
      </div>`;
  }

  /** Кадрові вимоги пакетів для відкритого вузла.
   *
   *  Вимога чіпляється за ПОСАДУ, тому для спеціальності беремо вимоги її
   *  посад, а для посади — її власні. Вузли вимог приходять із графа вже
   *  розібраними, тож розбирати текст пункту тут не треба — цим зайнятий
   *  спільний парсер специфікацій. */
  function pkgBlockHTML(n, postIds) {
    const reqIds = new Set();
    postIds.forEach((pid) => inc(pid, "req_post").forEach((e) => reqIds.add(e.from)));

    const byPkg = new Map();
    Array.from(reqIds).sort().forEach((rid) => {
      const r = full(rid);
      if (!r.package) return;
      push(byPkg, r.package, r);
    });

    if (!byPkg.size) {
      return `<div class="reader-block"><h3>Кадрові вимоги пакетів ПМГ-2026</h3>
        <div class="sp-empty">У блоці «Спеціалісти» жодного пакета ця позиція не згадується.</div>
        </div>`;
    }

    const rows = Array.from(byPkg.keys()).sort(byPkgNo).map((no) => {
      const lines = byPkg.get(no).map((r) => `<div class="sp-pkgline">${
        r.critical ? '<span class="sp-tag cross">критична</span> ' : ""}${esc(r.raw)}${
        (r.orphans || []).length
          ? `<div class="sp-orphan">У цій вимозі поза Переліком МОЗ: ${
              esc(r.orphans.join(", "))}. З 01.09.2026 таку посаду ввести не можна —
              виконувати доведеться через інший варіант переліку.</div>`
          : ""}</div>`).join("");
      return `<div class="sp-pkgrow">
          <a href="../pakety/index.html?package=${esc(no)}" class="sp-pkgtitle">
            <span class="sp-pkgn">${esc(no)}</span>${esc(IDX.packages[no] || "")}</a>
          ${lines}</div>`;
    }).join("");

    return `<div class="reader-block"><h3>Кадрові вимоги пакетів ПМГ-2026
      <span class="sp-tag m-root">${byPkg.size}</span></h3>
      <div class="sp-pkglist">${rows}</div></div>`;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
