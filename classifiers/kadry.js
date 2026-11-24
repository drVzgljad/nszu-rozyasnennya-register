/* ============================================================
   «Кадри» — єдиний вхід кадрового контуру (з 20.11.2026; до того — проба
   «Кадровий ланцюжок»).

   Питання, на яке відповідає сторінка: якщо взяти ОДНУ річ — пакет,
   спеціальність, посаду, характеристику чи код — що з неї випливає в усіх
   інших реєстрах. П'ять ланок, чотири різні акти, і на кожному переході
   частина позицій губиться — саме це й малюємо.

   Обхід іде в ОБИДВА боки від того, що ввели. Від спеціальності — праворуч
   (які посади, характеристики, коди), від коду — ліворуч (яка характеристика,
   посада, спеціальність), від посади — в обидва. Тому «якір» може стояти в
   будь-якій колонці, і саме він підсвічений на схемі.

   Пошук — спільний модуль порталу (pmg-code-search.js, сфера словника «kadry»):
   слова в будь-якому відмінку й порядку, побутові назви («медсестра», «логопед»).
   Якщо запит підходить кільком назвам, сторінка показує перелік на вибір, а не
   бере першу-ліпшу.

   Дані: data/kadry/graph.json — повний граф. Тут він доречний: сторінка ходить
   усіма п'ятьма типами вузлів і всіма відношеннями, тож зрізами вийшло б
   десять запитів замість одного.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Підпис під вікном — акт, який цю ланку встановлює. Беремо з реєстру джерел
  // у графі, щоб не тримати другий список актів у сторінці.
  const SRC_KEY = { req: "pkgreq", post: "post", dkhp: "dkhp", code: "code", spec: "spec", atest: "atest" };

  // Порядок ланок. Ліворуч — право працювати, праворуч — облік у ЕСОЗ.
  const LAYERS = ["spec", "post", "dkhp", "code"];
  const REL = { spec: "spec_post", post: "post_dkhp", dkhp: "dkhp_code" };

  let G = null, N = null, OUT = null, IN = null;
  let SEARCH = [];                       // легкий індекс для пошуку
  let current = null, anchor = null;
  const openSet = new Set();          // які секції розкриті

  function boot() {
    fetch("data/kadry/graph.json")
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((g) => {
        G = g;
        N = new Map(g.nodes.map((n) => [n.id, n]));
        OUT = new Map(); IN = new Map();
        g.edges.forEach((e) => { push(OUT, e.from, e); push(IN, e.to, e); });
        buildSearch();
        fillPicker();
        wireSearch();
        wireChoices();
        if (window.PMG_FIND) PMG_FIND.ready();
        const q = new URLSearchParams(location.search);
        const pkg = q.get("package"), node = q.get("id"), text = q.get("q");
        if (node && N.has(node)) setAnchor({ kind: "node", id: node });
        else if (text) {
          // спершу словник побутових назв: з ним «логопед» — це не лише код НСЗУ, а й посада
          $("#kdSearch").value = text;
          const go = () => pickBest(text);
          if (window.PMG_FIND) PMG_FIND.ready().then(go); else go();
        }
        else {
          const sel = $("#kdPkg");
          sel.value = pkg && [...sel.options].some((o) => o.value === pkg)
            ? pkg : (sel.options[1] ? sel.options[1].value : "");
          setAnchor({ kind: "pkg", id: sel.value });
        }
      })
      .catch((e) => {
        // Помилку видно в консолі: інакше будь-яка похибка в малюванні
        // виглядає як «не завантажилися дані», хоча дані вже тут.
        console.error("Кадровий ланцюжок:", e);
        $("#kdFigure").innerHTML =
          '<p class="kd-error">Не вдалося побудувати ланцюжок. Подробиці — у консолі.</p>';
      });
  }

  function push(m, k, v) { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }
  const out = (id, rel) => (OUT.get(id) || []).filter((e) => e.rel === rel);
  const inc = (id, rel) => (IN.get(id) || []).filter((e) => e.rel === rel);
  const pkgSort = (a, b) => (+a || 999) - (+b || 999);

  function fillPicker() {
    const sel = $("#kdPkg");
    sel.innerHTML = '<option value="">— оберіть пакет —</option>' +
      Object.keys(G.packages).sort(pkgSort).map((no) =>
        `<option value="${esc(no)}">№ ${esc(no)} · ${esc(G.packages[no])}</option>`).join("");
    sel.addEventListener("change", () => {
      if (sel.value) { $("#kdSearch").value = ""; setAnchor({ kind: "pkg", id: sel.value }); }
    });
  }

  // ── пошук за назвою ─────────────────────────────────────────────────────
  const TYPE_WORD = {
    spec: "спеціальність", post: "посада",
    dkhp: "характеристика ДКХП", code: "код НСЗУ",
    atest: "спеціальність або профіль Номенклатури атестації",
  };

  function buildSearch() {
    const norm = (t) => (window.PMG_SEARCH ? PMG_SEARCH.text(t) : t.toLowerCase());
    SEARCH = G.nodes
      .filter((n) => LAYERS.includes(n.type))
      .map((n) => ({ id: n.id, type: n.type, name: n.name, low: n.name.toLowerCase(), _t: norm(n.name),
                     code: n.type === "code" ? n.id.split(":")[1].toLowerCase() : "" }));
  }

  /** Код НСЗУ шукається і як «P37», і як «p 37», і з кириличною «Р». */
  const asCode = (s) => (window.PMG_SEARCH ? PMG_SEARCH.code(s) : s.replace(/\s+/g, "")).toLowerCase();

  /** Кандидати. Спершу збіг за підрядком, і серед них ті, у кого запит на
   *  початку назви — інакше «сестра» видає спершу «Головна медична сестра», а
   *  не «Сестра медична». Далі — те, що знайшов спільний пошук порталу: слова в
   *  іншому відмінку чи порядку («кардіолога») і побутові назви зі словника
   *  («медсестра» → «сестра медична»). */
  function find(q) {
    const s = q.toLowerCase().trim().replace(/\s+/g, " ");
    if (s.length < 2) return { items: [], note: "" };
    const code = asCode(s);
    const hit = SEARCH.filter((x) => x.low.includes(s) || (x.code && x.code === code));
    // запит як окреме слово назви («терапевт» у «Лікар-терапевт») важить більше, ніж шматок
    // слова («Ерготерапевт»); далі — запит на початку назви, далі коротші назви
    const rank = (x) => (x.low.split(/[^0-9a-zа-яґєії']+/).includes(s) ? 0 : x.low.startsWith(s) ? 1 : 2);
    hit.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length);
    let note = "";
    if (window.PMG_FIND) {
      const r = PMG_FIND.search(SEARCH, q, { scope: "kadry" });
      const have = new Set(hit);
      const extra = r.items.filter((x) => !have.has(x.e))
        .sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length).map((x) => x.e);
      if (extra.length) { hit.push(...extra); note = r.note || ""; }
    }
    return { items: hit, note };
  }
  const suggest = (q) => find(q).items.slice(0, 12);

  function wireSearch() {
    const inp = $("#kdSearch"), list = $("#kdSuggest");
    let items = [], cursor = -1;

    const close = () => { list.hidden = true; inp.setAttribute("aria-expanded", "false"); cursor = -1; };
    const render = () => {
      if (!items.length) { close(); return; }
      list.innerHTML = items.map((x, i) => `
        <li role="option" data-i="${i}" aria-selected="${i === cursor}"
            class="${i === cursor ? "on" : ""}">
          <span class="kd-sg-n">${esc(x.name)}</span>
          <span class="kd-sg-t">${esc(x.type === "code" ? x.id.split(":")[1] : TYPE_WORD[x.type])}</span>
        </li>`).join("");
      list.hidden = false;
      inp.setAttribute("aria-expanded", "true");
    };
    const choose = (i) => {
      const x = items[i]; if (!x) return;
      inp.value = x.name; close(); $("#kdPkg").value = "";
      setAnchor({ kind: "node", id: x.id });
    };

    inp.addEventListener("input", () => { items = suggest(inp.value); cursor = -1; render(); });
    inp.addEventListener("keydown", (e) => {
      if (list.hidden && e.key !== "Enter") return;
      if (e.key === "ArrowDown") { cursor = Math.min(cursor + 1, items.length - 1); render(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { cursor = Math.max(cursor - 1, 0); render(); e.preventDefault(); }
      else if (e.key === "Enter") { e.preventDefault(); cursor >= 0 ? choose(cursor) : pickBest(inp.value); }
      else if (e.key === "Escape") close();
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) { e.preventDefault(); choose(+li.dataset.i); }
    });
    inp.addEventListener("blur", () => setTimeout(close, 120));
  }

  /** Яку з однойменних позицій брати якорем: посада зв'язана з усіма ланками. */
  const TYPE_RANK = { post: 0, spec: 1, dkhp: 2, code: 3 };

  /** Увели запит і натиснули Enter. Точна назва чи код — одразу ланцюжок.
   *  Кілька різних назв — перелік на вибір: мовчки брати найкоротшу означало б
   *  на «терапевт» показати терапевта мови і мовлення. */
  function pickBest(text) {
    const raw = String(text || "").trim();
    const pk = raw.match(/^пакет\s*№?\s*(\d{1,2})$/i);
    if (pk && G.packages[pk[1]]) {
      $("#kdSearch").value = ""; $("#kdPkg").value = pk[1];
      setAnchor({ kind: "pkg", id: pk[1] });
      return;
    }
    const { items, note } = find(raw);
    const blank = () => { anchor = null; current = null; $("#kdSummary").innerHTML = ""; $("#kdDetail").hidden = true; };
    if (!items.length) {
      blank();
      $("#kdFigure").innerHTML =
        `<p class="kd-error">За запитом «${esc(raw)}» нічого не знайдено —
         ні спеціальності, ні посади, ні характеристики, ні коду.</p>`;
      return;
    }
    const low = raw.toLowerCase().replace(/\s+/g, " "), code = asCode(low);
    const exact = items.filter((x) => x.low === low || (x.code && x.code === code))
      .sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type]);
    const names = new Map();                 // назва → позиції з цією назвою в різних реєстрах
    items.forEach((x) => { const k = x.low; if (!names.has(k)) names.set(k, []); names.get(k).push(x); });
    // точна назва чи код — одразу ланцюжок; але якщо словник підказує ще й іншу назву
    // («логопед» — це і код НСЗУ, і посада «Терапевт мови і мовлення»), даємо вибрати
    if ((exact.length && !note) || names.size === 1) {
      const x = exact[0] || items.slice().sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type])[0];
      $("#kdSearch").value = x.name; $("#kdPkg").value = "";
      setAnchor({ kind: "node", id: x.id });
      return;
    }
    blank();
    const CAP = 40;
    const rows = [...names.values()].slice(0, CAP).map((list) => {
      const best = list.slice().sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type])[0];
      const kinds = [...new Set(list.map((x) => (x.type === "code" ? "код НСЗУ " + x.id.split(":")[1] : TYPE_WORD[x.type])))];
      return `<button type="button" class="kd-choice" data-pick="${esc(best.id)}">
        <b>${esc(best.name)}</b><span>${esc(kinds.join(" · "))}</span></button>`;
    }).join("");
    $("#kdFigure").innerHTML = `<div class="kd-choices">
      <p class="kd-choices-h">За запитом «${esc(raw)}» знайдено ${nf(names.size)} — оберіть, з чого будувати ланцюжок${
        names.size > CAP ? ` (показано перші ${CAP}; уточніть запит)` : ""}:</p>
      ${note ? `<p class="kd-hint">${esc(note)}</p>` : ""}${rows}</div>`;
  }

  /** Перелік на вибір і приклади під полем — кліки ловимо один раз, на документі. */
  function wireChoices() {
    document.addEventListener("click", (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      const pick = t.closest("[data-pick]");
      if (pick && N.has(pick.dataset.pick)) {
        const n = N.get(pick.dataset.pick);
        $("#kdSearch").value = n.name; $("#kdPkg").value = "";
        setAnchor({ kind: "node", id: n.id });
        return;
      }
      const ex = t.closest("[data-kdq]");
      if (ex) { $("#kdSearch").value = ex.dataset.kdq; pickBest(ex.dataset.kdq); }
    });
  }

  function openBox(key) {
    openSet.add(key);
    renderSections();
    const el = $(`.kd-sec[data-key="${key}"]`);
    // у вимогах ведемо одразу до першого збігу, а не до заголовка секції
    const hit = el && $("mark.kd-hit", el);
    if (hit) hit.scrollIntoView({ behavior: "smooth", block: "center" });
    else if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function setAnchor(a, keepOpen) {
    anchor = a;
    // адресу оновлюємо, щоб посиланням можна було поділитися
    try {
      const u = new URL(location.href);
      ["q", "id", "package"].forEach((k) => u.searchParams.delete(k));
      if (a && a.id) u.searchParams.set(a.kind === "pkg" ? "package" : "id", a.id);
      history.replaceState(null, "", u);
    } catch (e) { /* без історії — не біда */ }
    // Розкриті секції лишаються розкритими: людина щойно їх відкрила, і
    // згортати все під ногами через перехід — втратити місце.
    if (!keepOpen) { /* набір openSet зберігаємо навмисно */ }
    draw();
  }

  /** Перехід за рядком нижньої панелі. Відкрите вікно НЕ закриваємо: людина
   *  щойно дивилася список, і згорнути його під ногами — втратити контекст. */
  function goTo(id) {
    const n = N.get(id);
    if (!n) return;
    $("#kdSearch").value = n.type === "pkgreq" ? "" : n.name;
    $("#kdPkg").value = "";
    setAnchor({ kind: "node", id }, true);
  }

  /** Обхід ланцюжка від будь-якої точки — в обидва боки.
   *
   *  Якір може стояти в будь-якій колонці: від спеціальності розповзаємося
   *  праворуч (посади → характеристики → коди), від коду — ліворуч, від посади
   *  — в обидва боки. Пакет заходить через свої кадрові вимоги і сідає на
   *  колонку посад.
   *
   *  Втрати рахуються ВІД ТОГО, ЩО В КАДРІ. Якщо зайшли з коду, посади в кадрі
   *  — лише ті, що ведуть до нього, і «0 без характеристики» тут правда саме
   *  для цієї вибірки, а не для всього Переліку. */
  function walkFrom(a) {
    const S = { spec: new Set(), post: new Set(), dkhp: new Set(), code: new Set() };
    const reqs = new Set();
    let start;

    // Набір вимог фіксований, коли зайшли з пакета або з однієї вимоги: тоді
    // решта вимог на ті самі посади в кадр не потрапляє — питання ж було про
    // цю вимогу, а не про всі.
    let fixedReqs = false;
    if (a.kind === "pkg") {
      G.nodes.forEach((n) => { if (n.type === "pkgreq" && n.package === a.id) reqs.add(n.id); });
      reqs.forEach((r) => out(r, "req_post").forEach((e) => S.post.add(e.to)));
      start = LAYERS.indexOf("post");
      fixedReqs = true;
    } else if (N.get(a.id).type === "pkgreq") {
      reqs.add(a.id);
      out(a.id, "req_post").forEach((e) => S.post.add(e.to));
      start = LAYERS.indexOf("post");
      fixedReqs = true;
    } else if (N.get(a.id).type === "atest") {
      // Зайшли із запису Номенклатури атестації: він сідає на колонку посад.
      out(a.id, "atest_post").forEach((e) => S.post.add(e.to));
      start = LAYERS.indexOf("post");
    } else {
      const n = N.get(a.id);
      S[n.type].add(a.id);
      start = LAYERS.indexOf(n.type);
    }

    for (let i = start; i > 0; i--) {
      const rel = REL[LAYERS[i - 1]];
      S[LAYERS[i]].forEach((id) => inc(id, rel).forEach((e) => S[LAYERS[i - 1]].add(e.from)));
    }
    for (let i = start; i < LAYERS.length - 1; i++) {
      const rel = REL[LAYERS[i]];
      S[LAYERS[i]].forEach((id) => out(id, rel).forEach((e) => S[LAYERS[i + 1]].add(e.to)));
    }
    // Вимога пакета веде і на посаду Переліку (req_post), і прямо на
    // характеристику ДКХП (req_dkhp). До 24.11.2026 друге ребро тут не
    // читалось, і характеристика без посади в Переліку № 1065 («Лікар-терапевт
    // підлітковий», «Лаборант КДЛ», «Лікар-невропатолог» — 14 таких) показувала
    // «жоден пакет цього не вимагає», хоча картка Довідника поруч казала про
    // 2–13 пакетів. Беремо обидва ребра — так само, як рахує картка.
    if (!fixedReqs) {
      S.post.forEach((p) => inc(p, "req_post").forEach((e) => reqs.add(e.from)));
      S.dkhp.forEach((d) => inc(d, "req_dkhp").forEach((e) => reqs.add(e.from)));
    } else {
      // Із пакета чи вимоги: характеристики, які вимога називає напряму, а
      // через посаду до них не дійти, — теж у кадрі (разом зі своїми кодами).
      reqs.forEach((r) => out(r, "req_dkhp").forEach((e) => {
        if (S.dkhp.has(e.to)) return;
        S.dkhp.add(e.to);
        out(e.to, "dkhp_code").forEach((c) => S.code.add(c.to));
      }));
    }

    // Атестація (наказ МОЗ № 650): за якою спеціальністю чи профілем Номенклатури атестуються
    // посади в кадрі. Бічна ланка від посад, тому в LAYERS її немає.
    const atest = new Set();
    if (N.get(a.id) && N.get(a.id).type === "atest") atest.add(a.id);
    else S.post.forEach((p) => inc(p, "atest_post").forEach((e) => atest.add(e.from)));

    const noNext = (ids, rel) => [...ids].filter((id) => !out(id, rel).length);
    const reqArr = [...reqs].sort(byReqId);
    return {
      anchorKey: a.kind === "pkg" || N.get(a.id).type === "pkgreq"
        ? "req" : N.get(a.id).type,
      req: reqArr, post: [...S.post], dkhp: [...S.dkhp], code: [...S.code], spec: [...S.spec],
      atest: [...atest].sort((x, y) => (N.get(x).name || "").localeCompare(N.get(y).name || "", "uk")),
      lost: {
        req: noNext(reqArr, "req_post"),
        post: noNext(S.post, "post_dkhp"),
        dkhp: noNext(S.dkhp, "dkhp_code"),
        spec: [...S.post].filter((p) => !inc(p, "spec_post").length),
        atest: [...S.post].filter((p) => !inc(p, "atest_post").length),
      },
      critical: reqArr.filter((id) => (N.get(id) || {}).critical),
      tone: reqArr.reduce((acc, id) => {
        const t = (N.get(id) || {}).tone || "ok"; acc[t] = (acc[t] || 0) + 1; return acc;
      }, {}),
    };
  }

  function byReqId(a, b) {
    const pa = +N.get(a).package, pb = +N.get(b).package;
    return (pa || 999) - (pb || 999) || a.localeCompare(b);
  }

  /** Короткий підпис акта під вікном: «постанова КМУ від 31.12.2025 № 1808»
   *  → «ПКМУ № 1808». Обрізати довгу назву трьома крапками не можна — саме
   *  номер акта й несе тут сенс, а він стоїть у кінці. */
  /** Статус акта на день перегляду: рядок у даних міг застаріти з дня збірки. */
  function liveStatus(t) {
    if (!t || !t.status) return "";
    if (t.status === "набирає чинності" && t.valid_from &&
        new Date().toISOString().slice(0, 10) >= t.valid_from) return "чинний";
    return t.status;
  }

  function actLabel(key) {
    const t = G.node_types[SRC_KEY[key]] || {};
    if (!t.act_title) return trim((t.source || "").split(" — ")[0], 28);
    const m = /^(.+?)\s+від\s+[\d.]+\s+(№\s*[\d\-/]+)/.exec(t.act_title);
    if (!m) return trim(t.act_title, 28);
    return `${m[1].replace(/^постанова КМУ$/, "ПКМУ")} ${m[2]}`;
  }

  // ── малювання ───────────────────────────────────────────────────────────
  //
  // Схема на HTML, а не на SVG, і це навмисно: у вікні має стояти сам зміст —
  // назва посади, назва характеристики, код, — а не число. SVG не переносить
  // рядки, тож довгі назви довелося б або різати, або міряти вручну. Сітка
  // CSS заодно вирівнює вікна й стрілки між ними сама.

  // Скільки назв показуємо просто у вікні. Більше — і вікно перетворюється на
  // список; тоді чесніше показати число і відкрити список натисканням.
  const SHOW_MAX = 3;

  const TITLES_BOX = {
    req: "Кадрові вимоги", spec: "Спеціальності",
    post: "Посади", dkhp: "Характеристики", code: "Коди НСЗУ", atest: "Атестація",
  };

  function draw() {
    if (!anchor || !anchor.id) {
      $("#kdFigure").innerHTML = ""; $("#kdSummary").innerHTML = "";
      $("#kdDetail").hidden = true; return;
    }
    current = walkFrom(anchor);
    current.hitKeys = hitKeys(current);
    renderSummary(current);
    $("#kdFigure").innerHTML = figureHTML(current) + critNoteHTML(current);
    $("#kdFigure").querySelectorAll("[data-box]").forEach((b) =>
      b.addEventListener("click", () => openBox(b.dataset.box)));
    renderSections();
  }

  /** Рядок над схемою: що саме зараз показано і чи є з ним проблема. */
  function renderSummary(w) {
    if (anchor.kind === "pkg") {
      const t = w.tone, bad = (t.warn || 0) + (t.risk || 0);
      $("#kdSummary").innerHTML = `
        <div class="kd-sum-line"><b>${nf(w.req.length)}</b> ${
          plural(w.req.length, "кадрова вимога", "кадрові вимоги", "кадрових вимог")}</div>
        ${bad ? `<div class="kd-sum-warn">${nf(bad)} із них ${
          plural(bad, "має", "мають", "мають")} посади поза Переліком МОЗ</div>`
        : '<div class="kd-sum-ok">усі вимоги виконувані посадами з Переліку МОЗ</div>'}
        <button id="kdChecklist" type="button" class="kd-checklist"
          title="Скопіювати вимоги пакета списком із квадратиками — звірити зі штатним розписом чи вкласти в лист">⧉ Чекліст вимог</button>`;
      $("#kdChecklist").addEventListener("click", copyChecklist);
      return;
    }
    const n = N.get(anchor.id);
    if (n.type === "pkgreq") {
      const t = n.tone || "ok";
      $("#kdSummary").innerHTML = `
        <div class="kd-sum-line"><b>${esc(trim(n.name, 70))}</b></div>
        <div class="kd-sum-kind">кадрова вимога пакета № ${esc(n.package)}${
          n.critical ? " · критична" : ""}</div>
        <div class="${t === "ok" ? "kd-sum-ok" : "kd-sum-warn"}">${
          esc((G.tones || {})[t] || "")}</div>`;
      return;
    }
    const pk = new Set(w.req.map((id) => N.get(id).package));
    const t = G.node_types[n.type] || {};
    $("#kdSummary").innerHTML = `
      <div class="kd-sum-line"><b>${esc(trim(n.name, 60))}</b></div>
      <div class="kd-sum-kind">${esc(TYPE_WORD[n.type])} · ${esc(actLabel(n.type))}${
        liveStatus(t) ? " · " + esc(liveStatus(t)) : ""}</div>
      ${pk.size ? `<div class="kd-sum-ok">трапляється у ${nf(pk.size)} ${
        plural(pk.size, "пакеті", "пакетах", "пакетах")} ПМГ-2026</div>`
      : '<div class="kd-sum-kind">жоден пакет ПМГ-2026 цього не вимагає</div>'}
      ${n.type === "dkhp" ? `<a class="kd-checklist kd-dkhp-sum" href="${esc(dkhpHref(n.id))}"
          data-dkhp="${esc(n.id)}">📖 Текст характеристики${n.page ? " · с. " + esc(n.page) + " Довідника" : ""}</a>` : ""}`;
  }

  /** Чекліст вимог обраного пакета — текстом у буфер. Інструмент
   *  контрактування: звірити зі штатним розписом, вкласти в лист ЗОЗ,
   *  роздрукувати. Рядок вимоги — ДОСЛІВНИЙ (raw зі специфікації): чекліст
   *  піде за межі порталу, і переказувати акт своїми словами там не можна. */
  function copyChecklist() {
    if (!current || anchor.kind !== "pkg") return;
    const ids = [...current.req].sort(byReqId);
    const scopes = new Map();
    ids.forEach((id) => {
      const n = N.get(id) || {};
      const key = n.scope || "";
      if (!scopes.has(key)) scopes.set(key, []);
      scopes.get(key).push("▢ " + (n.critical ? "[критична] " : "") + (n.raw || n.name));
    });
    const lines = [
      `Кадрові вимоги пакета № ${anchor.id} «${(G.packages || {})[anchor.id] || ""}»`,
      "Специфікації ПМГ-2026 (постанова КМУ від 31.12.2025 № 1808), блок «Спеціалісти»",
      `Звірено з НавігаторПМГ26 · ${new Date().toLocaleDateString("uk-UA")}`,
      "",
    ];
    scopes.forEach((rows, scope) => {
      if (scope) lines.push(scope + ":");
      lines.push(...rows, "");
    });
    lines.push("Позначки: ▢ — звірити; [критична] — вимога умов закупівлі " +
      "(невідповідність — підстава відхилити пропозицію, п. 20 Порядку, ПКМУ № 410).");
    navigator.clipboard && navigator.clipboard.writeText(lines.join("\n"));
    const b = $("#kdChecklist");
    if (b) {
      b.textContent = `✓ Скопійовано (${ids.length})`;
      setTimeout(() => (b.textContent = "⧉ Чекліст вимог"), 1600);
    }
  }

  /** Вміст вікна: назви, поки їх мало, і число, коли їх багато. */
  function boxBody(key, ids) {
    if (!ids.length) {
      return `<div class="kd-none">${esc(emptyWhy(key))}</div>`;
    }
    if (ids.length <= SHOW_MAX) {
      return `<div class="kd-vals">${ids.map((id) => {
        const n = N.get(id) || {};
        const extra = key === "code" ? `<span class="kd-code">${esc(id.split(":")[1])}</span>`
          : key === "dkhp" && n.page ? `<span class="kd-sub">с. ${esc(n.page)} Довідника</span>`
          : key === "post" && n.no ? `<span class="kd-sub">позиція № ${esc(n.no)}</span>`
          : key === "spec" && n.sec ? `<span class="kd-sub">${esc(secLabel(n.sec))}</span>`
          : key === "atest" ? `<span class="kd-sub">${n.kind === "profile" ? "профіль роботи" : "спеціальність Номенклатури"}</span>`
          : key === "req" ? `<span class="kd-sub">пакет № ${esc(n.package)}</span>` : "";
        const sp = key === "req" ? hitSpans(id, n.name || id) : [];
        return `<div class="kd-val${sp.length ? " hit" : ""}"><span class="kd-val-n">${
          snippetHTML(n.name || id, sp, 90)}</span>${extra}</div>`;
      }).join("")}</div>`;
    }
    const sample = ids.slice(0, 2).map((id) => trim((N.get(id) || {}).name || id, 34));
    return `<div class="kd-many">
        <span class="kd-cnt-big">${nf(ids.length)}</span>
        <span class="kd-cnt-word">${esc(countWord(key, ids.length))}</span>
        <span class="kd-sample">${esc(sample.join(" · "))} …</span>
      </div>`;
  }

  /** Підпис розділу Додатка 7 — з реєстру підписів у графі, не свій список. */
  function secLabel(k) { return ((G.labels || {}).sec || {})[k] || k; }

  function countWord(key, n) {
    if (key === "req") return plural(n, "вимога", "вимоги", "вимог");
    if (key === "post") return plural(n, "посада", "посади", "посад");
    if (key === "dkhp") return plural(n, "характеристика", "характеристики", "характеристик");
    if (key === "code") return plural(n, "код", "коди", "кодів");
    if (key === "atest") return plural(n, "запис Номенклатури", "записи Номенклатури", "записів Номенклатури");
    return plural(n, "спеціальність", "спеціальності", "спеціальностей");
  }

  function emptyWhy(key) {
    // Характеристика без посади в Переліку: порожні посади й спеціальності —
    // це не «нічого не знайдено», а відсутній запис у Переліку № 1065.
    const noPost = current && !current.post.length && current.dkhp.length;
    if (noPost && key === "post") return "у Переліку МОЗ № 1065 такої посади немає";
    if (noPost && key === "spec") return "посади в Переліку немає — немає й спеціальності";
    return key === "dkhp" ? "характеристики в ДКХП немає"
      : key === "code" ? "коду НСЗУ немає"
      : key === "spec" ? "жодна спеціальність не веде на цю посаду"
      : key === "req" ? "жоден пакет цього не вимагає"
      : key === "atest" ? "у Номенклатурі атестації відповідника немає"
      : "немає";
  }

  function boxHTML(key, ids, lostText) {
    const on = current && current.anchorKey === key ? " on" : "";
    const empty = ids.length ? "" : " empty";
    // Вікно вимог виділяємо, коли серед них є критичні: це єдина ланка, де
    // невідповідність б'є не по зручності, а по договору.
    const crit = key === "req" && current && current.critical.length
      ? current.critical.length : 0;
    return `
      <div class="kd-cell">
        <button type="button" class="kd-box${on}${empty}${crit ? " crit" : ""}" data-box="${key}"
                aria-label="${esc(TITLES_BOX[key])}: ${ids.length}${
                  crit ? ", з них критичних " + crit : ""}">
          <span class="kd-box-head">
            <span class="kd-box-title">${esc(TITLES_BOX[key])}</span>
            ${crit ? `<span class="kd-box-crit">${nf(crit)} ${
              plural(crit, "критична", "критичні", "критичних")}</span>` : ""}
            ${ids.length > SHOW_MAX ? "" : `<span class="kd-box-n">${nf(ids.length)}</span>`}
          </span>
          ${boxBody(key, ids)}
          <span class="kd-box-src">${esc(actLabel(key))}</span>
        </button>
        ${lostText ? `<div class="kd-lost">${esc(lostText)}</div>` : ""}
      </div>`;
  }

  /** Виноска про критичність. Показуємо лише коли в кадрі є критичні вимоги.
   *
   *  Формулювання звірене по самій постанові № 410, і там є несподіванка:
   *  зірочка у специфікації посилається на пункт 5 Порядку, а той КРИТЕРІЇВ
   *  поділу не містить — лише уповноважує НСЗУ визначати умови закупівлі.
   *  Тому пишемо «рівень встановлює НСЗУ в умовах закупівлі», а не
   *  «за пунктом 5 критичними вважаються…». Наслідки — пункти 16, 20 і 22,
   *  цитовані по чинній редакції від 08.05.2026. */
  function critNoteHTML(w) {
    if (!w.critical.length) return "";
    return `
      <div class="kd-note">
        <div class="kd-note-h">Чому «критична» — і що буде за невідповідність</div>
        <div class="kd-note-body">

        <p><b>Що це.</b> Рівень вимоги встановлює НСЗУ в умовах закупівлі; у
        специфікації такі вимоги позначені зірочкою. Зірочка веде на пункт 5
        Порядку (постанова КМУ від 25.04.2018 № 410), але сам пункт критеріїв
        поділу не містить — він лише уповноважує НСЗУ визначати умови щодо
        наявності персоналу. Критерії живуть в умовах закупівлі, не в постанові.</p>

        <p><b>Чому це не формальність.</b> Подаючи пропозицію (пункт 16) і
        підписуючи договір (пункт 22), заклад <b>власним підписом підтверджує</b>,
        що відповідає умовам закупівлі та спроможний надавати послуги згідно зі
        специфікацією. Тобто кадрова вимога — це твердження закладу про себе,
        а не побажання НСЗУ.</p>

        <p><b>Що буде за невідповідність</b> (пункт 20). НСЗУ протягом трьох
        робочих днів надсилає повідомлення про виправлення помилок. Усунути
        недоліки треба <b>до граничного строку подання пропозицій</b> з
        оголошення; якщо повідомлення надійшло вже після цієї дати — є два
        робочі дні на оновлену пропозицію. Подане пізніше <b>не розглядається</b>,
        тобто пропозиція просто випадає з відбору. Якщо пропозицій, які
        відповідають умовам, не буде взагалі, НСЗУ переглядає умови й оголошує
        повторно (пункт 21).</p>

        <p><b>Що треба зробити.</b> Мати названу посаду у штатному розписі — у
        кількості й за місцем роботи, як написано в самій умові («щонайменше
        N осіб», «за основним місцем роботи в цьому ЗОЗ»), і могти це
        підтвердити. Якщо посади ще немає, пункт 16 дозволяє в окремих випадках,
        <i>прямо визначених в оголошенні</i>, подати пропозицію із зобов'язанням
        виконати умову протягом визначеного строку. З 01.09.2026 вводити можна
        лише посади з Переліку МОЗ № 1065 — пункт 32 Ліцензійних умов.</p>

        </div>
        <p class="kd-note-src">Постанова КМУ від 25.04.2018 № 410, Порядок
        укладення, зміни та припинення договору — редакція від 08.05.2026.</p>
      </div>`;
  }

  function figureHTML(w) {
    const lost = (arr, one, few, many, tail) =>
      arr.length ? `${arr.length} ${plural(arr.length, one, few, many)} ${tail}` : "";
    const ar = '<div class="kd-ar" aria-hidden="true">→</div>';
    return `
      <div class="kd-grid">
        <div class="kd-top">
          ${boxHTML("req", w.req, lost(w.lost.req, "вимога", "вимоги", "вимог", "без посади"))}
          <div class="kd-ar down" aria-hidden="true">↓</div>
        </div>
        <div class="kd-row">
          ${boxHTML("spec", w.spec,
            lost(w.lost.spec, "посада", "посади", "посад", "без спеціальності"))}
          ${ar}
          ${boxHTML("post", w.post,
            lost(w.lost.post, "посада", "посади", "посад", "без характеристики"))}
          ${ar}
          ${boxHTML("dkhp", w.dkhp,
            lost(w.lost.dkhp, "характеристика", "характеристики", "характеристик", "без коду"))}
          ${ar}
          ${boxHTML("code", w.code, "")}
        </div>
        <div class="kd-bottom">
          <div class="kd-ar down" aria-hidden="true">↓</div>
          ${boxHTML("atest", w.atest,
            lost(w.lost.atest, "посада", "посади", "посад", "без відповідника в Номенклатурі"))}
        </div>
      </div>`;
  }

  // ── розкривні секції під схемою ─────────────────────────────────────────
  //
  // По секції на кожне вікно, і кожна відкривається окремо: так видно, скажімо,
  // усі вимоги на «Ендоскопію» і поруч — саму характеристику. Спільна панель
  // цього не давала: вона показувала щось одне.

  const TITLES = {
    req: "Кадрові вимоги пакетів",
    spec: "Спеціальності, за якими видається ліцензія",
    post: "Посади, які треба ввести у штатний розпис",
    dkhp: "Кваліфікаційні характеристики",
    code: "Коди посад НСЗУ",
    atest: "Атестація: спеціальність або профіль роботи за Номенклатурою",
  };
  const ORDER = ["req", "spec", "post", "dkhp", "code", "atest"];

  /** Пояснення до розділу атестації — з даних графа (atest_info), не свій текст про акт. */
  function atestNoteHTML(w) {
    const info = G.atest_info || {}, act = info.act || {}, bpr = info.bpr || {};
    const pts = (x, label) => (x && x.per_year
      ? `${label} — ${x.per_year} балів безперервного професійного розвитку на рік` : "");
    const lines = [pts(bpr.professional, "професіонали"), pts(bpr.fakhivets, "фахівці")].filter(Boolean);
    return `<p class="kd-empty kd-atest-note">Зіставлення посади із записом Номенклатури (додаток 1 до Порядку
      проведення атестації, ${esc(act.title || "наказ МОЗ № 650")}) обчислено за професійними кваліфікаціями
      обох актів. ${act.note_war ? esc(act.note_war) + "." : ""}
      ${lines.length ? "Вимоги Порядку: " + esc(lines.join("; ")) + "." : ""}
      ${w.lost.atest.length ? `Посад у кадрі без відповідника: ${nf(w.lost.atest.length)} — для керівних і
        суто адміністративних посад атестаційної спеціальності може не бути за визначенням.` : ""}
      Бали й перехідні норми для конкретної посади — в її картці на сторінці «Спеціальності та посади».</p>`;
  }

  function renderSections() {
    const w = current, d = $("#kdDetail");
    d.hidden = false;
    d.innerHTML = ORDER.map((key) => sectionHTML(key, w)).join("");
    d.querySelectorAll("[data-goto]").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); goTo(b.dataset.goto); }));
    // Запам'ятовуємо, що було розкрито, щоб перемальовування не згортало все.
    d.querySelectorAll("details").forEach((el) =>
      el.addEventListener("toggle", () => {
        if (el.open) openSet.add(el.dataset.key); else openSet.delete(el.dataset.key);
      }));
  }

  function sectionHTML(key, w) {
    const ids = w[key] || [];
    const t = G.node_types[SRC_KEY[key]] || {};
    const lostSet = new Set(
      key === "req" ? w.lost.req : key === "post" ? w.lost.post :
      key === "dkhp" ? w.lost.dkhp : []);
    const open = openSet.has(key) ? " open" : "";
    return `
      <details class="kd-sec" data-key="${key}"${open}>
        <summary>
          <span class="kd-sec-t">${esc(TITLES[key])}</span>
          <span class="kd-sec-n">${nf(ids.length)}</span>
          <span class="kd-sec-act">${esc(t.act_title || t.source || "")}${
            liveStatus(t) ? " · " + esc(liveStatus(t)) : ""}</span>
        </summary>
        ${ids.length
          ? `<ul class="kd-list">${hitsFirst(key, ids).map((id) => rowHTML(key, id, lostSet)).join("")}</ul>`
          : `<p class="kd-empty">${esc(emptyWhy(key))}.</p>`}
        ${key === "atest" ? atestNoteHTML(w) : ""}
      </details>`;
  }

  /** Рядок секції. Для кожного типу показуємо те, заради чого його й відкривають:
   *  у вимоги — пакет, дослівний текст і умову, у посади — кваліфікацію, у
   *  характеристики — місце в Довіднику, у коду — сам код. */
  function rowHTML(key, id, lostSet) {
    const n = N.get(id) || {};
    const gone = lostSet.has(id);
    const here = anchor.kind === "node" && anchor.id === id;
    let body = "";

    const reqHits = key === "req" ? hitSpans(id, n.raw || n.name || "") : [];
    if (key === "req") {
      body = `
        <span class="kd-r-head">
          <span class="kd-pkg">Пакет № ${esc(n.package)}</span>
          <span class="kd-pkgname">${esc(G.packages[n.package] || "")}</span>
          ${n.critical ? '<span class="kd-flag">критична</span>' : ""}
          ${n.tone && n.tone !== "ok"
            ? `<span class="kd-flag warn">${esc(toneWord(n.tone))}</span>` : ""}
        </span>
        <span class="kd-r-raw">${markHTML(n.raw || n.name || "", reqHits)}</span>
        ${n.tone_why
          ? `<span class="kd-r-why">${esc(n.tone_why)}</span>`
          : n.tone && n.tone !== "ok" && G.tones && G.tones[n.tone]
            ? `<span class="kd-r-why">${esc(G.tones[n.tone])}</span>`
            : ""}
        ${n.orphans && n.orphans.length
          ? `<span class="kd-r-orphan">Поза Переліком МОЗ: ${esc(n.orphans.join(", "))}</span>`
          : ""}`;
    } else {
      const sub = key === "spec"
          ? [secLabel(n.sec), (n.kinds || []).join(", ")].filter(Boolean).join(" · ")
        : key === "post"
          ? [partLabel(n.part), n.no ? "позиція № " + n.no : "", n.qual].filter(Boolean).join(" · ")
        : key === "dkhp"
          ? [n.sub || n.section, n.page ? "с. " + n.page + " Довідника" : ""].filter(Boolean).join(" · ")
        : key === "atest"
          ? [n.kind === "profile" ? "профіль роботи" : "спеціальність Номенклатури",
             (n.quals || []).length ? "кваліфікація: " + n.quals.join(", ") : "",
             (n.base_specs || []).length ? "на базі спеціальностей: " + n.base_specs.join(", ") : "",
             (n.path || []).slice(-1)[0]].filter(Boolean).join(" · ")
        : n.kind === "status" ? "юридичний статус, не посада"
        : n.kind === "admin" ? "загальноадміністративна посада" : "";
      body = `
        <span class="kd-r-head">
          ${key === "code" ? `<span class="kd-code">${esc(id.split(":")[1])}</span>` : ""}
          <span class="kd-r-name">${esc(n.name || id)}</span>
          ${gone ? `<span class="kd-flag">${esc(lostWhy(key))}</span>` : ""}
        </span>
        ${sub ? `<span class="kd-r-sub">${esc(trim(sub, 220))}</span>` : ""}`;
    }

    return `<li${key === "dkhp" ? ' class="kd-li-dkhp"' : ""}>
      <button type="button" class="kd-item${gone ? " gone" : ""}${here ? " here" : ""}${reqHits.length ? " hit" : ""}"
              data-goto="${esc(id)}" ${here ? 'aria-current="true"' : ""}>${body}</button>
      ${key === "dkhp" ? dkhpOpenHTML(id, n) : ""}
    </li>`;
  }

  /* ── Підсвічування в тексті вимоги того, що шукали ─────────────────────
     Вимога пакета часто перелічує десятки посад через «та/або», і серед
     них не видно ту, заради якої вимогу показано (24.11.2026: «лікар-терапевт
     підлітковий» — третя з 80 у вимозі 9-01). Що підсвічувати, беремо не зі
     слів запиту, а з того, ЧЕРЕЗ ЩО вимога потрапила в кадр: назви посад і
     характеристик кадру і формулювання вимоги на ребрі req_dkhp (alt), — тож
     «Сестра медична/брат медичний» знайдеться й тоді, коли посада в Переліку
     записана як «Сестра медична (брат медичний)». Порівнюємо за ключем без
     розділових знаків, рядки — через PMG_SEARCH.text (довжину він зберігає,
     тож позиції збігу лягають на оригінал). */
  const norm = (s) => (window.PMG_SEARCH ? PMG_SEARCH.text(s) : String(s || "").toLowerCase());
  const hitKey = (s) => norm(s).replace(/[^a-zа-яіїєґ0-9]/g, "");
  const LETTER = /[a-zа-яіїєґ0-9]/;

  /** Ключі того, що в кадрі. Для входу з пакета чи вимоги — нічого: там
   *  показують усі вимоги пакета, підсвічувати нема чого. */
  function hitKeys(w) {
    const keys = new Set();
    if (!anchor || anchor.kind === "pkg" || w.anchorKey === "req") return keys;
    const dk = new Set(w.dkhp);
    w.post.concat(w.dkhp).forEach((id) => keys.add(hitKey((N.get(id) || {}).name)));
    w.req.forEach((r) => out(r, "req_dkhp").forEach((e) => {
      if (dk.has(e.to) && e.alt) keys.add(hitKey(e.alt));
    }));
    keys.delete("");
    return keys;
  }

  /** Відрізки рядка, які треба виділити: [початок, кінець). Рядок ділимо на
   *  формулювання вимоги (alts) — найдовші першими й без перекриттів, — і
   *  виділяємо ті, чий ключ є серед ключів кадру. Тому «лікар-терапевт» не
   *  засвітиться всередині «лікар-терапевт підлітковий». */
  function hitSpans(reqId, str) {
    const keys = current && current.hitKeys;
    if (!keys || !keys.size || !str) return [];
    const r = N.get(reqId) || {};
    const s = norm(str);
    const cand = new Set((r.alts || []).map((a) => String(a).trim()).filter(Boolean));
    // назви з кадру — на випадок, коли формулювання вимоги в alts немає
    current.post.concat(current.dkhp).forEach((id) => cand.add((N.get(id) || {}).name || ""));
    out(reqId, "req_dkhp").forEach((e) => e.alt && cand.add(e.alt));
    const taken = [], hits = [];
    [...cand].filter((c) => c.length > 2)
      .sort((a, b) => b.length - a.length)
      .forEach((c) => {
        const t = norm(c), mark = keys.has(hitKey(c));
        for (let i = s.indexOf(t); i >= 0; i = s.indexOf(t, i + 1)) {
          const j = i + t.length;
          if (LETTER.test(s[i - 1] || "") || LETTER.test(s[j] || "")) continue;
          if (taken.some(([a, b]) => i < b && j > a)) continue;
          taken.push([i, j]);
          if (mark) hits.push([i, j]);
        }
      });
    return hits.sort((a, b) => a[0] - b[0]);
  }

  /** Вимоги зі збігом — нагору (порядок усередині зберігається). */
  function hitsFirst(key, ids) {
    if (key !== "req" || !current || !current.hitKeys || !current.hitKeys.size) return ids;
    const has = (id) => hitSpans(id, (N.get(id) || {}).raw || (N.get(id) || {}).name || "").length > 0;
    const yes = ids.filter(has);
    return yes.concat(ids.filter((id) => !yes.includes(id)));
  }

  /** Рядок з <mark> на відрізках; решта екранується. */
  function markHTML(str, spans) {
    let html = "", at = 0;
    spans.forEach(([a, b]) => {
      html += esc(str.slice(at, a)) + "<mark class=\"kd-hit\">" + esc(str.slice(a, b)) + "</mark>";
      at = b;
    });
    return html + esc(str.slice(at));
  }

  /** Для вікна схеми: шматок довкола першого збігу, а не перші 90 знаків —
   *  інакше збіг на 400-му знаку у вікно не потрапляє взагалі. */
  function snippetHTML(str, spans, max) {
    if (!spans.length) return esc(trim(str, max));
    const [a, b] = spans[0];
    const room = Math.max(0, max - (b - a));
    let from = Math.max(0, a - Math.floor(room / 3));
    let to = Math.min(str.length, b + room - (a - from));
    // різати по словах, а не посеред слова
    if (from > 0) { const sp = str.indexOf(" ", from); if (sp >= 0 && sp < a) from = sp + 1; }
    if (to < str.length) { const sp = str.lastIndexOf(" ", to); if (sp > b) to = sp; }
    const inside = spans.filter(([x, y]) => x >= from && y <= to).map(([x, y]) => [x - from, y - from]);
    return (from > 0 ? "…" : "") + markHTML(str.slice(from, to), inside) + (to < str.length ? "…" : "");
  }

  /* ── Характеристика ДКХП у вікні поверх «Кадрів» ───────────────────────
     Рядок характеристики переставляє ланцюжок на цю ланку — це навігація
     схемою. Сам текст Довідника живе на сторінці «Характеристики ДКХП-78»
     (posady.html), і перехід туди губив зібраний у «Кадрах» ланцюжок. Тому
     текст відкривається окремим вікном: та сама сторінка в режимі ?embed=1
     (лише картка). Звичайне посилання лишається посиланням — Ctrl+клік,
     середня кнопка й «відкрити в новій вкладці» працюють як завжди. */
  const dkhpHref = (id, embed) =>
    "posady.html?id=" + encodeURIComponent(id) + (embed ? "&embed=1" : "");

  function dkhpOpenHTML(id, n) {
    return `<a class="kd-dkhp-open" href="${esc(dkhpHref(id))}" data-dkhp="${esc(id)}"
        title="Відкрити кваліфікаційну характеристику у вікні">📖 ${
        n.page ? "с.&nbsp;" + esc(n.page) : "Текст"}</a>`;
  }

  let dlg = null;
  function dkhpDialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "kd-dlg";
    dlg.setAttribute("aria-labelledby", "kdDlgTitle");
    dlg.innerHTML = `
      <div class="kd-dlg-bar">
        <div class="kd-dlg-t">
          <b id="kdDlgTitle"></b>
          <span id="kdDlgSub"></span>
        </div>
        <a class="kd-dlg-btn" id="kdDlgFull" target="_blank" rel="noopener">↗ Відкрити повністю</a>
        <button type="button" class="kd-dlg-btn kd-dlg-x" id="kdDlgClose" aria-label="Закрити">✕ Закрити</button>
      </div>
      <iframe class="kd-dlg-frame" id="kdDlgFrame" title="Кваліфікаційна характеристика"></iframe>`;
    document.body.appendChild(dlg);
    const close = () => dlg.close();
    $("#kdDlgClose", dlg).addEventListener("click", close);
    // клік по затемненню (поза рамкою) — теж закрити
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    dlg.addEventListener("close", () => {
      document.documentElement.classList.remove("kd-dlg-on");
      $("#kdDlgFrame", dlg).src = "about:blank";
    });
    return dlg;
  }

  function openDkhp(id) {
    const n = N.get(id);
    if (!n) return;
    const d = dkhpDialog();
    $("#kdDlgTitle", d).textContent = n.name || id;
    $("#kdDlgSub", d).textContent = ["ДКХП-78", n.page ? "с. " + n.page + " Довідника" : "", n.sub || n.section]
      .filter(Boolean).join(" · ");
    $("#kdDlgFull", d).href = dkhpHref(id);
    $("#kdDlgFrame", d).src = dkhpHref(id, true);
    document.documentElement.classList.add("kd-dlg-on");
    if (typeof d.showModal === "function") d.showModal();
    else { location.href = dkhpHref(id); return; } // старий браузер без <dialog>
    $("#kdDlgClose", d).focus();
  }

  // Один слухач на всю сторінку: кнопки з'являються й зникають з кожним перемальовуванням.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[data-dkhp]");
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    openDkhp(a.dataset.dkhp);
  });

  function partLabel(k) { return ((G.labels || {}).part || {})[k] || k || ""; }

  function lostWhy(key) {
    return key === "req" ? "не зіставлено з Переліком"
      : key === "post" ? "немає характеристики в ДКХП"
      : "немає коду НСЗУ";
  }
  function toneWord(t) {
    return t === "risk" ? "не зіставлено" : "звужений вибір";
  }
  function ua(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || "");
  }
  function trim(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
