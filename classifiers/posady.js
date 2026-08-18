/* ============================================================
   Посади в охороні здоров'я — фронтенд.
   Каскад (Розділ → Підрозділ → Посада) по ДКХП, випуск 78,
   миттєвий і пакетний пошук за назвою та кодом НСЗУ,
   паспорт посади з кадровими вимогами пакетів ПМГ-2026.

   Сторінка — ВЬЮ НА СПІЛЬНИЙ ГРАФ, а не власник даних. Характеристика, код
   НСЗУ і кадрова вимога — це три типи вузлів (dkhp, code, pkgreq), а «код
   кодує характеристику» і «вимога називає характеристику» — два відношення.
   Своїх файлів у сторінки більше немає.

   Дані (будує classifiers/build_kadry_graph.py):
     graph_index.json      — шапка: підсумки, зауваги до джерел, назви пакетів
     nodes_dkhp.json       — легкі вузли характеристик (список і каскад)
     nodes_code.json       — легкі вузли кодів НСЗУ
     edges_dkhp_code.json  — потрібне вже на першому кадрі: код видно в рядку
                             списку, і пошук за «P37» має спрацювати одразу
   з першим паспортом:
     cards_dkhp / cards_code / cards_pkgreq, edges_req_dkhp, text_dkhp.json

   ТЕКСТ ХАРАКТЕРИСТИК лежить окремо (text_dkhp.json, 3 МБ): це тіло
   документа, а не сутність графа, і тягнути його заради списку немає за що.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const CODE_RE = /^[Pp]\s*\d{1,3}$/;
  const BACK_PAGE = "/classifiers/posady.html";

  /** Хвіст для перехресних посилань: щоб на чужій сторінці була кнопка «Назад». */
  function backTail(id, label) {
    return "&back=" + encodeURIComponent(BACK_PAGE + "?id=" + encodeURIComponent(id)) +
      "&backLabel=" + encodeURIComponent("до посади «" + label + "»");
  }

  const BLOCK_TITLE = {
    duties: "Завдання та обов'язки",
    knowledge: "Повинен знати",
    req: "Кваліфікаційні вимоги",
    intro: "Загальне",
  };
  const BLOCK_ORDER = ["intro", "duties", "knowledge", "req"];

  // Текст Довідника тягнемо ОКРЕМО від решти паспорта. Він на 3 МБ — уп'ятеро
  // важчий за все інше разом, — і поки він їде, показувати порожнє вікно немає
  // за що: код НСЗУ і кадрові вимоги пакетів уже є. Тому спершу малюємо
  // паспорт без тексту, а тоді дошиваємо характеристику. Заодно зникає
  // проблема локального сервера, який рве саме цей файл, коли поруч інші.
  const DETAIL = [
    "cards_dkhp.json", "cards_code.json", "cards_pkgreq.json",
    // Легкі вузли вимог теж потрібні: номер пакета і мітка «критична» лежать
    // саме там, а не у важких полях.
    "nodes_pkgreq.json", "edges_req_dkhp.json",
  ];

  let IDX = null;                  // шапка графа
  let DKHP = [], CODES = [];       // легкі вузли двох типів
  let CARD = null, TEXT = null;    // важкі поля вузлів і текст характеристик
  let REQ = null;                  // id характеристики → ребра від вимог
  let textState = "idle";          // idle | pending | ready | failed
  let ready = false, detailPromise = null, textPromise = null;
  let openedId = null, lastBatchFound = [];
  let readerEmptyHTML = "";
  // Режим «реєстр кодів НСЗУ»: пункт меню view=codes показує ВСІ коди
  // довідника, разом із тими, для яких Випуск 78 характеристики не має.
  // Раніше цей пункт вмикав фільтр по характеристиках — і 46 кодів без
  // характеристики з «реєстру кодів» мовчки випадали.
  let codesMode = false;

  const byNode = new Map();        // id вузла будь-якого типу → легкий вузол
  const byId = new Map();          // id характеристики (з префіксом і без)
  const byCode = new Map();        // «P37» → легкий вузол коду
  const codesOf = new Map();       // id характеристики → [вузли кодів]
  const dkhpOfCode = new Map();    // id коду → id характеристики
  const orphans = [];              // коди без характеристики — теж шукаємо
  const sections = [];             // [{name, subs: Map, items}]

  const el = {};

  const bare = (id) => String(id).split(":").pop();

  function getJSON(name) {
    return fetch("data/kadry/" + name).then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  // ══════════════════════════════════════════════════════════
  // Завантаження
  // ══════════════════════════════════════════════════════════
  function boot() {
    [
      ["search", "#poSearch"], ["count", "#poCount"], ["clear", "#poClear"],
      ["results", "#poResults"], ["reader", "#poReader"], ["stats", "#poStats"],
      ["batch", "#poBatch"], ["batchRun", "#poBatchRun"], ["batchCopy", "#poBatchCopy"],
      ["batchClear", "#poBatchClear"], ["selSection", "#selSection"], ["selSub", "#selSub"],
      ["selPost", "#selPost"], ["onlyPkg", "#onlyPkg"], ["onlyCode", "#onlyCode"],
      ["onlyGap", "#onlyGap"], ["issues", "#poIssues"], ["issuesBody", "#poIssuesBody"],
      ["layout", ".nk-layout"],
    ].forEach(([k, sel]) => (el[k] = $(sel)));

    readerEmptyHTML = el.reader.innerHTML;
    wireUI();

    Promise.all(["graph_index.json", "nodes_dkhp.json", "nodes_code.json",
                 "edges_dkhp_code.json"].map(getJSON))
      .then(([idx, dkhp, codes, edges]) => {
        IDX = idx; DKHP = dkhp; CODES = codes;
        buildMaps(edges);
        renderStats();
        renderIssues();
        populateSections();
        ready = true;
        onReady();
      })
      .catch((e) => {
        el.count.textContent = "Не вдалося завантажити довідник";
        console.error(e);
      });
  }

  /** Паспорти важкі — вантажимо один раз, коли знадобився перший. */
  function loadDetail() {
    if (CARD) return Promise.resolve(CARD);
    if (!detailPromise) {
      detailPromise = Promise.all(DETAIL.map(getJSON))
        .then(([cd, cc, cr, nReq, eReqDkhp]) => {
          CARD = Object.assign({}, cd, cc, cr);
          nReq.forEach((n) => byNode.set(n.id, n));
          REQ = new Map();
          eReqDkhp.forEach((e) => {
            const a = REQ.get(e.to);
            if (a) a.push(e); else REQ.set(e.to, [e]);
          });
          return CARD;
        })
        .catch((err) => {
          detailPromise = null;
          throw err;
        });
    }
    return detailPromise;
  }

  function loadText() {
    if (!textPromise) {
      textState = "pending";
      textPromise = getJSON("text_dkhp.json")
        .then((t) => { TEXT = t; textState = "ready"; return t; })
        .catch((err) => {
          textPromise = null;
          textState = "failed";
          throw err;
        });
    }
    return textPromise;
  }

  /** Вузол цілком: легкі поля плюс важкі з картки. Легкі беремо із byNode —
   *  туди складено всі типи, які сторінка вантажить, незалежно від того, коли
   *  саме вони приїхали. */
  function full(id) {
    return Object.assign({}, byNode.get(id), CARD[id]);
  }

  function buildMaps(edges) {
    DKHP.concat(CODES).forEach((n) => byNode.set(n.id, n));
    DKHP.forEach((e) => { byId.set(e.id, e); byId.set(bare(e.id), e); });
    CODES.forEach((c) => byCode.set(bare(c.id), c));

    edges.forEach((e) => {
      const c = byCode.get(bare(e.to));
      if (!c || !byId.has(e.from)) return;
      dkhpOfCode.set(e.to, e.from);
      const b = codesOf.get(e.from);
      if (b) b.push(c); else codesOf.set(e.from, [c]);
    });
    // Довідник кодів нумерований, і в паспорті вони мають стояти по порядку:
    // рядкове сортування давало б P1, P10, P100, P11.
    codesOf.forEach((list) => list.sort((a, b) => +bare(a.id).slice(1) - +bare(b.id).slice(1)));

    CODES.forEach((c) => { if (!dkhpOfCode.has(c.id)) orphans.push(c); });

    const secIdx = new Map();
    DKHP.forEach((e) => {
      let s = secIdx.get(e.section);
      if (!s) {
        s = { name: e.section, items: [], subs: new Map() };
        secIdx.set(e.section, s);
        sections.push(s);
      }
      s.items.push(e);
      if (e.sub) {
        const list = s.subs.get(e.sub);
        if (list) list.push(e); else s.subs.set(e.sub, [e]);
      }
    });
  }

  const codeStrings = (id) => (codesOf.get(id) || []).map((c) => bare(c.id));
  const pkgsOf = (e) => e.pkg || [];

  function onReady() {
    el.count.textContent = idleCount();
    const q = new URLSearchParams(location.search);
    const id = (q.get("id") || "").trim();
    const raw = (q.get("code") || q.get("q") || "").trim();

    // Вхід із меню «Довідники → Посади»: кілька пунктів ведуть на цю саму
    // сторінку, різниця лише в увімкненому виді — сторінка одна, а входи різні.
    const view = (q.get("view") || "").trim();
    if (view === "codes") {
      codesMode = true;
      syncViewTabs();
      showCodes();
    } else {
      const viewBox = { pkg: el.onlyPkg, gap: el.onlyGap }[view];
      if (viewBox) { viewBox.checked = true; refilter(); }
    }

    if (id && byId.has(id)) {
      const node = byId.get(id);
      openCard(node.id);
      syncCascade(node.id);
      return;
    }
    if (raw) { el.search.value = raw; runSearch(); }
  }

  const idleCount = () =>
    nf(DKHP.length) + " кваліфікаційних характеристик · " + nf(CODES.length) +
    " кодів НСЗУ · оберіть розділ або введіть запит";

  // ══════════════════════════════════════════════════════════
  // Статистика і зауваги
  // ══════════════════════════════════════════════════════════
  function renderStats() {
    const c = IDX.counts || {};
    // Числа тут — дієві, а не бібліографічні: скільки посад реально працює
    // у вимогах пакетів і де кадровий контур болить (9 посад із вимог, яких
    // Перелік МОЗ не знає). Розміри довідників видно в самих списках.
    const cards = [
      ["Посад у вимогах пакетів ПМГ", c.dkhp_in_packages || 0],
      ["Пакетів із кадровою вимогою", c.packages_with_staff || 0],
      ["Кодів НСЗУ для ЕСОЗ", c.code || 0],
      ["Посад з вимог поза Переліком МОЗ", c.orphan_names || 0],
    ];
    const tD = $("#cntD"), tC = $("#cntC");
    if (tD) tD.textContent = nf(DKHP.length);
    if (tC) tC.textContent = nf(CODES.length);
    el.stats.innerHTML = cards.map(([k, v]) =>
      `<div class="stat"><span class="stat-num">${nf(v)}</span><span class="stat-key">${k}</span></div>`
    ).join("");
  }

  /** Розбіжності між джерелами краще показати, ніж мовчки згладити. */
  function renderIssues() {
    const N = (IDX.notes || {}).dkhp || {};
    const parts = [];
    (N.notes || []).forEach((n) => parts.push(`<li>${esc(n)}</li>`));

    // Довгі переліки — за розкривачкою: пункт каже, СКІЛЬКИ і ЩО це означає,
    // а поіменний список читає той, кому він справді потрібен. Розгорнуті,
    // вони перетворювали зауваги на стіну в три тисячі знаків.
    const al = N.aliases || [];
    if (al.length) {
      parts.push(`<li><details class="po-subfold"><summary><b>Застарілі назви в кодах НСЗУ
        (${al.length}).</b> Паспорт відкривається від чинної назви — розгорнути
        перелік</summary><p>` + al.map((a) =>
        `<span class="po-alias">${esc(a.code)} «${esc(a.name)}» → «${esc(a.current)}»</span>`
      ).join(", ") + ".</p></details></li>");
    }

    const lac = N.lacunae || [];
    if (lac.length) {
      parts.push(`<li><details class="po-subfold"><summary><b>Коди без кваліфікаційної
        характеристики (${lac.length}).</b> Посада є в довіднику кодів НСЗУ, але Випуск 78
        її не описує — розгорнути перелік</summary><p>` +
        lac.map((l) => `${esc(l.code)} «${esc(l.name)}»`).join("; ") + ".</p></details></li>");
    }

    const un = N.pkg_unmatched || [];
    if (un.length) {
      parts.push(`<li><b>Кадрові вимоги пакетів без відповідної характеристики (${un.length}).</b>
        У специфікаціях названо: ` + un.map((u) =>
        `«${esc(u.name)}»${u.hits > 1 ? " ×" + u.hits : ""}`).join("; ") + ".</li>");
    }

    (N.no_block || []).forEach((d) => parts.push(
      `<li><b>Дефект зведеного тексту Довідника.</b> У характеристиці «${esc(d.name)}»
       (с.&nbsp;${d.page}) мітку блоку «Кваліфікаційні вимоги» втоплено всередину абзацу,
       тож окремим блоком вона тут не виділяється — див. кінець розділу
       «Повинен знати».</li>`));

    if (!parts.length) return;
    el.issuesBody.innerHTML = "<ul>" + parts.join("") + "</ul>";
    el.issues.hidden = false;
  }

  // ══════════════════════════════════════════════════════════
  // Каскад
  // ══════════════════════════════════════════════════════════
  const ph = (t) => `<option value="">— ${t} —</option>`;
  function resetSel(sel, placeholder) {
    sel.innerHTML = ph(placeholder); sel.disabled = true; sel.value = "";
  }

  function populateSections() {
    const opts = [ph("усі розділи")];
    sections.forEach((s, i) =>
      opts.push(`<option value="${i}">${esc(s.name)} · ${nf(s.items.length)}</option>`));
    el.selSection.innerHTML = opts.join("");
    el.selSection.disabled = false;
  }

  function fillSubs(si) {
    const s = sections[si];
    if (!s || !s.subs.size) {
      resetSel(el.selSub, "підрозділів немає");
      return;
    }
    const opts = [ph("усі підрозділи")];
    Array.from(s.subs.entries()).forEach(([name, list]) =>
      opts.push(`<option value="${escAttr(name)}">${esc(trim(name, 80))} · ${nf(list.length)}</option>`));
    el.selSub.innerHTML = opts.join("");
    el.selSub.disabled = false;
  }

  function fillPosts(list) {
    if (!list || !list.length) { resetSel(el.selPost, "оберіть розділ"); return; }
    const opts = [ph("усі посади")];
    list.forEach((e) => {
      const codes = codeStrings(e.id);
      const pkgs = pkgsOf(e);
      const tail = [codes.length ? codes[0] : "", pkgs.length ? "📦 " + pkgs.length : ""]
        .filter(Boolean).join(" · ");
      opts.push(`<option value="${escAttr(e.id)}">${esc(trim(e.name, 88))}${tail ? " · " + tail : ""}</option>`);
    });
    el.selPost.innerHTML = opts.join("");
    el.selPost.disabled = false;
  }

  function currentList() {
    const si = el.selSection.value;
    if (si === "") return DKHP;
    const s = sections[+si];
    if (!s) return DKHP;
    const sub = el.selSub.value;
    return sub ? (s.subs.get(sub) || []) : s.items;
  }

  function wireCascade() {
    el.selSection.addEventListener("change", () => {
      const si = el.selSection.value;
      if (si === "") {
        resetSel(el.selSub, "оберіть розділ");
        resetSel(el.selPost, "оберіть розділ");
        refilter();
        return;
      }
      fillSubs(+si);
      fillPosts(sections[+si].items);
      refilter();
    });
    el.selSub.addEventListener("change", () => {
      fillPosts(currentList());
      refilter();
    });
    el.selPost.addEventListener("change", () => {
      if (el.selPost.value) openCard(el.selPost.value);
    });
  }

  function syncCascade(id) {
    const e = byId.get(id);
    if (!e) return;
    const si = sections.findIndex((s) => s.name === e.section);
    if (si < 0) return;
    el.selSection.value = String(si);
    fillSubs(si);
    if (e.sub) el.selSub.value = e.sub;
    fillPosts(currentList());
    el.selPost.value = e.id;
  }

  // ══════════════════════════════════════════════════════════
  // Пошук і список
  // ══════════════════════════════════════════════════════════
  let searchTimer = null;

  function wireUI() {
    wireCascade();
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 140);
    });
    [el.onlyPkg, el.onlyCode, el.onlyGap].forEach((c) =>
      c.addEventListener("change", refilter));
    el.clear.addEventListener("click", resetForm);
    el.batchRun.addEventListener("click", runBatch);
    el.batchClear.addEventListener("click", () => {
      el.batch.value = ""; lastBatchFound = []; el.batchCopy.hidden = true;
      el.results.hidden = true; el.results.innerHTML = "";
      el.count.textContent = ready ? idleCount() : "Завантаження…";
    });
    el.batchCopy.addEventListener("click", () => {
      const text = lastBatchFound.map((r) =>
        `${codeStrings(r.id).join(" ") || "—"}\t${r.name}`).join("\n");
      navigator.clipboard && navigator.clipboard.writeText(text);
      el.batchCopy.textContent = "✓ Скопійовано (" + lastBatchFound.length + ")";
      setTimeout(() => (el.batchCopy.textContent = "⧉ Копіювати знайдене"), 1500);
    });
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
    $$(".po-tab").forEach((b) =>
      b.addEventListener("click", () => setView(b.dataset.view)));
  }

  /** Вкладки реєстрів. codesMode міняють ще й refilter/resetForm (дотик до
   *  каскаду чи чекбоксів — це вже робота зі списком характеристик), тож
   *  вигляд вкладок зводимо в одному місці й кличемо звідусіль. */
  function syncViewTabs() {
    $$(".po-tab").forEach((b) => {
      const on = (b.dataset.view === "codes") === codesMode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function setView(mode) {
    if (mode === "codes") {
      if (codesMode) return;
      codesMode = true;
      el.onlyGap.checked = false;
      syncViewTabs();
      showCodes();
    } else {
      if (!codesMode) return;
      refilter();          // сам скидає codesMode і синхронізує вкладки
    }
  }

  function applyFilters(list) {
    let out = list;
    if (el.onlyPkg.checked) out = out.filter((e) => pkgsOf(e).length);
    if (el.onlyCode.checked) out = out.filter((e) => codesOf.has(e.id));
    return out;
  }

  function refilter() {
    if (!ready) return;
    // Дотик до каскаду чи чекбоксів — це вже робота зі списком характеристик:
    // режим реєстру кодів на цьому закінчується.
    codesMode = false;
    syncViewTabs();
    if (el.onlyGap.checked) { showGaps(); return; }
    if (el.search.value.trim() || el.batch.value.trim()) { runSearch(); return; }
    const list = applyFilters(currentList());
    const si = el.selSection.value;
    if (si === "" && !el.onlyPkg.checked && !el.onlyCode.checked) {
      el.results.hidden = true;
      el.count.textContent = idleCount();
      return;
    }
    const label = si === "" ? "з фільтром" : (el.selSub.value || sections[+si].name);
    showResults(list, label);
  }

  /** Коди НСЗУ, для яких Випуск 78 характеристики не дає. */
  function showGaps() {
    const q = el.search.value.trim().toLowerCase();
    let rows = orphans.filter((c) => c.kind === "position");
    if (q) {
      rows = rows.filter((c) => c.name.toLowerCase().includes(q) ||
        bare(c.id).toLowerCase() === q.replace(/\s+/g, ""));
    }
    el.count.textContent = nf(rows.length) + " кодів без кваліфікаційної характеристики" +
      (q ? ` · запит «${el.search.value.trim()}»` : "");
    el.results.hidden = false;
    el.results.innerHTML = rows.map((c) => gapRowHTML(c, "немає характеристики в ДКХП, випуск 78")).join("");
    el.results.querySelectorAll(".rrow").forEach((r) =>
      r.addEventListener("click", () => openGap(r.dataset.code)));
  }

  /** Реєстр «Коди посад НСЗУ 2026» повністю — 286 кодів по порядку, разом із
   *  тими, для яких Випуск 78 характеристики не дає. Клік веде або в паспорт
   *  характеристики, або в пояснення, чому характеристики немає. */
  function showCodes() {
    const raw = el.search.value.trim();
    const q = raw.toLowerCase().replace(/\s+/g, " ");
    const qcode = raw.toUpperCase().replace(/\s+/g, "");
    let rows = CODES.slice().sort((a, b) => +bare(a.id).slice(1) - +bare(b.id).slice(1));
    if (raw) {
      rows = rows.filter((c) => c.name.toLowerCase().includes(q) || bare(c.id) === qcode);
    }
    el.count.textContent = nf(rows.length) + " " +
      plural(rows.length, "код", "коди", "кодів") +
      " довідника «Коди посад НСЗУ 2026»" +
      (raw ? ` · запит «${raw}»` : " · ними ЗОЗ кодує працівників в ЕСОЗ");
    el.results.hidden = false;
    el.results.innerHTML = rows.map((c) => {
      const did = dkhpOfCode.get(c.id);
      const target = did ? byNode.get(did) : null;
      const meta = target
        ? (target.name === c.name
            ? "кваліфікаційна характеристика — у паспорті"
            : `характеристика ДКХП: «${target.name}»`)
        : "без кваліфікаційної характеристики у Випуску 78";
      return `
      <button class="rrow${target ? "" : " po-gap"}" type="button" ${target
        ? `data-id="${escAttr(did)}"` : `data-code="${escAttr(bare(c.id))}"`}>
        <span class="tcode code">${esc(bare(c.id))}</span>
        <span class="rmain">
          <span class="tname">${esc(c.name)}</span>
          <span class="rmeta">${esc(meta)}</span>
        </span>
      </button>`;
    }).join("");
    wireRows();
  }

  function gapRowHTML(c, note) {
    return `
      <button class="rrow po-gap" type="button" data-code="${escAttr(bare(c.id))}">
        <span class="tcode code">${esc(bare(c.id))}</span>
        <span class="rmain">
          <span class="tname">${esc(c.name)}</span>
          <span class="rmeta">${esc(note)}</span>
        </span>
      </button>`;
  }

  function matches(e, q) {
    return e.name.toLowerCase().includes(q) ||
      // Назви кодів НСЗУ, що не збіглися з назвою характеристики: хто шукає
      // «провізор», має вийти на «Фармацевта», а не на порожній результат.
      (e.alt || []).some((a) => a.toLowerCase().includes(q)) ||
      // Назви тієї самої посади в Переліку МОЗ № 1065: хто шукає «невролога»,
      // має вийти на невропатолога — вимогу семи пакетів, — а не на самого
      // лише дитячого невролога.
      (e.syn || []).some((a) => a.toLowerCase().includes(q)) ||
      codeStrings(e.id).some((c) => c.toLowerCase() === q);
  }

  function runSearch() {
    // У режимі реєстру кодів пошук фільтрує самі коди, а не характеристики.
    if (codesMode) { showCodes(); return; }
    const raw = el.search.value.trim();
    const filtering = el.onlyPkg.checked || el.onlyCode.checked || el.onlyGap.checked;
    if (el.onlyGap.checked) { showGaps(); return; }
    if (!raw && !filtering) {
      el.results.hidden = true; el.batchCopy.hidden = true; lastBatchFound = [];
      if (ready) el.count.textContent = idleCount();
      return;
    }
    if (!ready) { el.count.textContent = "Довідник ще вантажиться…"; return; }
    if (!raw) { refilter(); return; }

    const q = raw.toLowerCase().replace(/\s+/g, " ");
    let list;
    if (CODE_RE.test(raw)) {
      const code = raw.toUpperCase().replace(/\s+/g, "");
      const hit = byCode.get(code);
      const target = hit && dkhpOfCode.get(hit.id);
      if (target) { openCard(target); syncCascade(target); }
      else if (hit) { openGap(code); }
      list = DKHP.filter((e) => codeStrings(e.id).includes(code));
      if (!list.length && hit) {
        el.count.textContent = `Код ${code} — «${hit.name}»`;
        el.results.hidden = true;
        return;
      }
    } else {
      list = DKHP.filter((e) => matches(e, q));
    }
    list = applyFilters(list);

    // Коди без характеристики теж мають знаходитись — інакше «масажист»
    // виглядає як відсутній у природі.
    const gaps = CODE_RE.test(raw) ? [] :
      orphans.filter((c) => c.name.toLowerCase().includes(q));

    showResults(list, `запит «${raw}»`, gaps);
  }

  function runBatch() {
    if (!ready) return;
    const items = el.batch.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    const groups = [], found = [];
    items.forEach((it) => {
      const q = it.toLowerCase();
      const hits = CODE_RE.test(it)
        ? DKHP.filter((e) => codeStrings(e.id).includes(it.toUpperCase().replace(/\s+/g, "")))
        : DKHP.filter((e) => matches(e, q));
      groups.push({ q: it, hits });
      hits.forEach((h) => found.push(h));
    });
    lastBatchFound = found;
    el.batchCopy.hidden = !found.length;
    el.results.hidden = false;
    el.count.textContent = `Пакетний пошук: ${items.length} запитів, ${nf(found.length)} збігів`;
    el.results.innerHTML = groups.map((g) => `
      <div class="batch-group">
        <div class="batch-head${g.hits.length ? "" : " nomatch"}">
          <span>${esc(g.q)}</span>
          <span class="batch-badge">${g.hits.length ? g.hits.length + " збіг(ів)" : "не знайдено"}</span>
        </div>
        ${g.hits.map(rowHTML).join("")}
      </div>`).join("");
    wireRows();
    setTab("browser");
  }

  function showResults(list, label, gaps) {
    gaps = gaps || [];
    const total = list.length + gaps.length;
    el.count.textContent = total
      ? `${nf(total)} знайдено · ${esc(label)}`
      : `Нічого не знайдено · ${esc(label)}`;
    el.results.hidden = false;
    el.results.innerHTML = list.map(rowHTML).join("") +
      gaps.map((c) => gapRowHTML(c, "немає характеристики в ДКХП")).join("");
    wireRows();
  }

  function rowHTML(e) {
    const badges = [];
    const codes = codeStrings(e.id);
    if (codes.length) {
      badges.push(`<span class="po-code">${codes.map(esc).join(" · ")}</span>`);
    }
    const pkgs = pkgsOf(e);
    if (pkgs.length) {
      badges.push(`<span class="po-pkgn">📦 ${pkgs.length}</span>`);
    }
    const meta = [trim(e.sub || e.section || "", 70)];
    if (e.alt && e.alt.length) meta.push("у кодах НСЗУ: " + e.alt.join(", "));
    if (e.syn && e.syn.length) meta.push("у Переліку МОЗ: " + e.syn.join(", "));
    return `
      <button class="rrow" type="button" data-id="${escAttr(e.id)}">
        <span class="rmain">
          <span class="tname">${esc(e.name)}</span>
          <span class="rmeta">${esc(meta.join(" · "))}</span>
        </span>
        ${badges.join("")}
      </button>`;
  }

  function wireRows() {
    el.results.querySelectorAll(".rrow[data-id]").forEach((r) =>
      r.addEventListener("click", () => { markActive(r); openCard(r.dataset.id); }));
    el.results.querySelectorAll(".rrow[data-code]").forEach((r) =>
      r.addEventListener("click", () => { markActive(r); openGap(r.dataset.code); }));
  }

  // ══════════════════════════════════════════════════════════
  // Паспорт посади
  // ══════════════════════════════════════════════════════════
  function openCard(id) {
    const node = byId.get(id);
    if (!node) return;
    openedId = node.id;
    setTab("reader");
    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `<div class="po-loading">Завантаження паспорта…</div>`;
    loadDetail().then(() => {
      if (openedId !== node.id) return;
      renderCard(full(node.id));
      el.reader.scrollTop = 0;
      if (textState !== "ready") {
        // Текст Довідника дошиваємо, коли доїде. Якщо за цей час відкрили
        // іншу посаду — перемальовує вже її власний виклик, не цей.
        loadText()
          .then(() => { if (openedId === node.id) renderCard(full(node.id)); })
          .catch(() => { if (openedId === node.id) renderCard(full(node.id)); });
      }
    }).catch(() => {
      el.reader.innerHTML = `<div class="po-loading">Не вдалося завантажити паспорт</div>`;
    });
  }

  function renderCard(card) {
    const crumbs = [card.section, card.sub].filter(Boolean)
      .map((s) => `<span>${esc(s)}</span>`).join('<span class="sep">›</span>');
    const text = TEXT ? (TEXT[card.id] || { blocks: {}, orders: [] }) : null;

    el.reader.innerHTML = `
      <div class="reader-crumbs">${crumbs}</div>
      <h2 class="po-title">${esc(card.name)}</h2>
      <div class="po-meta">
        № ${card.num} у підрозділі · с. ${card.page} Довідника
      </div>
      ${codesHTML(card.id)}
      ${perelikHTML(card)}
      ${atestHTML(card)}
      ${pkgHTML(card)}
      ${text
        ? BLOCK_ORDER.filter((b) => text.blocks[b])
            .map((b) => blockHTML(b, text.blocks[b])).join("") + ordersHTML(text.orders)
        : textPlaceholderHTML()}
      ${linksHTML(card)}`;

    el.reader.querySelectorAll(".copy-btn").forEach((b) =>
      b.addEventListener("click", () => {
        navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy);
        const t = b.textContent; b.textContent = "✓ Скопійовано";
        setTimeout(() => (b.textContent = t), 1400);
      }));
  }

  function textPlaceholderHTML() {
    return `<div class="reader-block po-block">
      <h3>Кваліфікаційна характеристика</h3>
      <p class="muted">${textState === "failed"
        ? "Текст Довідника не завантажився. Решта паспорта — код НСЗУ і кадрові " +
          "вимоги пакетів — показана вище; спробуйте відкрити посаду ще раз."
        : "Завантаження тексту Довідника…"}</p>
    </div>`;
  }

  function codesHTML(id) {
    const codes = codesOf.get(id) || [];
    if (!codes.length) {
      return `<div class="reader-block po-nocode">
        <h3>Код посади НСЗУ</h3>
        <p class="muted">Для цієї посади в довіднику «Коди посад НСЗУ 2026» окремого коду немає.</p>
      </div>`;
    }
    return `<div class="reader-block">
      <h3>Код посади НСЗУ <span class="muted">— для кодування працівника в ЕСОЗ</span></h3>
      <div class="po-codes">${codes.map((c) => {
        const alias = (CARD[c.id] || {}).alias_of;
        const code = bare(c.id);
        return `
        <div class="po-codecard${alias ? " legacy" : ""}">
          <span class="tcode code">${esc(code)}</span>
          <span class="po-codename">${esc(c.name)}</span>
          ${alias ? `<span class="po-legacy">назва застаріла — чинна характеристика
             зветься «${esc(alias)}»</span>` : ""}
          <button class="copy-btn" type="button" data-copy="${escAttr(code)}">⧉ Копіювати</button>
        </div>`; }).join("")}</div>
    </div>`;
  }

  /** Позиції Переліку професій МОЗ № 1065, що відповідають характеристиці:
   *  якою назвою і під яким номером посаду вводять у штатний розпис. З
   *  01.09.2026 Перелік закритий (п. 32 Ліцензійних умов у ред. ПКМУ № 813),
   *  тож для паспорта це найпрактичніше питання. Зіставлення обчислене за
   *  назвами — офіційного між актами не існує, і приховувати це не можна. */
  function perelikHTML(card) {
    const rows = card.perelik || [];
    if (!rows.length) {
      return `<div class="reader-block po-nocode">
        <h3>Перелік професій МОЗ № 1065 <span class="muted">— назва для штатного розпису</span></h3>
        <p class="muted">Серед 301 позиції Переліку відповідника цієї назви не знайдено
           (зіставлення обчислене за назвами, офіційного немає). З 01.09.2026 у штатний
           розпис можна вводити лише посади з Переліку — п. 32 Ліцензійних умов у редакції
           постанови КМУ № 813.</p>
      </div>`;
    }
    return `<div class="reader-block">
      <h3>Перелік професій МОЗ № 1065 <span class="muted">— назва для штатного розпису</span></h3>
      <div class="po-codes">${rows.map((r) => `
        <div class="po-codecard${r.renamed ? " legacy" : ""}">
          <span class="tcode code">№ ${esc(r.no)}</span>
          <a class="po-codename po-plink" title="Відкрити позицію в Переліку МОЗ № 1065"
             href="specialnosti.html?reg=p&q=${encodeURIComponent(r.name)}">${esc(r.name)}</a>
          ${r.renamed ? `<span class="po-legacy">Довідник характеристик тримає стару назву;
             у Переліку посада стоїть під новою після перейменування (наказ МОЗ № 805 від
             10.04.2019). Офіційного зіставлення актів немає.</span>` : ""}
          ${r.level ? `<span class="po-legacy">зіставлено ${r.level === "alias"
             ? "через словник синонімів" : "м'яким збігом назв"} — не дослівно</span>` : ""}
        </div>`).join("")}</div>
    </div>`;
  }

  /** Атестація і БПР за наказом МОЗ від 16.04.2025 № 650. Номенклатура
   *  (додаток 1 до Порядку) атестує ПОСАДИ Переліку, тож характеристика
   *  отримує це через свої посади — поле atest збирає білдер. Числа БПР —
   *  з розділу VIII Порядку; воєнний нюанс обов'язковий: сам процес
   *  атестації відкладено, і мовчати про це означало б лякати людей
   *  строками, які зараз не йдуть. */
  function atestHTML(card) {
    const info = IDX.atest_info || {}, act = info.act || {};
    const title = act.title || "наказ МОЗ від 16.04.2025 № 650";
    if (card.atest_excluded) {
      return `<div class="reader-block po-nocode">
        <h3>Атестація <span class="muted">— ${esc(title)}</span></h3>
        <p class="muted">Посади цієї характеристики належать до підрозділу V розділу 1
           Переліку № 1065 («інші професії») — Порядок проведення атестації на них
           не поширюється (п. 1 розділу I Порядку).</p>
      </div>`;
    }
    const rows = card.atest || [];
    if (!rows.length) return "";
    const spec = rows.filter((r) => r.kind === "spec");
    const prof = rows.filter((r) => r.kind === "profile");
    const b = (info.bpr || {})[card.section === "ФАХІВЦІ" ? "fakhivets"
                                                         : "professional"] || {};
    const years = (info.bpr || {}).period_max_years || 5;
    const ladder = Object.entries(b.transition || {})
      .map(([y, v]) => `${v} — у ${y}`).join(", ");
    return `<details class="reader-block po-fold">
      <summary><h3>Атестація і БПР <span class="muted">— ${esc(title)}${
        act.revision ? ", ред. " + esc(String(act.revision).split(" ")[0]) : ""}</span></h3></summary>
      ${spec.length ? `<p class="po-atest-line">Атестується за ${spec.length > 1
        ? "спеціальностями" : "спеціальністю"} Номенклатури (додаток 1 до Порядку):
        <b>${spec.map((r) => esc(r.name)).join("</b>, <b>")}</b>.</p>` : ""}
      ${prof.length ? `<p class="po-atest-line">Профіл${prof.length > 1 ? "і" : "ь"}
        роботи (субспеціалізація): ${prof.map((r) => esc(r.name)).join("; ")}.</p>` : ""}
      ${b.per_year ? `<p class="po-atest-line">Бали БПР: щороку не менше
        <b>${b.per_year}</b>; з 2029 року — не менше <b>${b.period_from_2029}</b>
        сумарно за атестаційний період (не довший за ${years} років); на випадок
        відновлення атестації у 2026–2028 діють перехідні пороги: ${esc(ladder)}.</p>` : ""}
      <p class="muted po-atest-note">${esc(act.note_war || "")}. Зіставлення
         «посада ↔ Номенклатура» обчислене за професійними кваліфікаціями двох
         актів МОЗ.</p>
    </details>`;
  }

  /** Кадрові вимоги пакетів, які називають цю характеристику.
   *
   *  Ребро несе АЛЬТЕРНАТИВУ, якою вимога дотяглася сюди, тож одна вимога
   *  буває тут двічі: «Лікар-психолог … або психолог» називає цю посаду і
   *  прямо, і узагальнено. Це два різні твердження, і зводити їх в одне не
   *  можна. */
  function pkgHTML(card) {
    const rows = (REQ.get(card.id) || []).map((e) => {
      const r = full(e.from);
      return {
        pkg: r.package, scope: r.scope, cond: r.cond, critical: r.critical,
        name: e.alt, alts: (r.alts || []).length, key: e.from,
      };
    });
    if (!rows.length) {
      return `<div class="reader-block po-nopkg">
        <h3>Кадрова вимога пакетів ПМГ-2026</h3>
        <p class="muted">У блоці «Спеціалісти» специфікацій пакетів на 2026 рік ця посада
           не названа. Це не означає, що ЗОЗ не може її мати — лише те, що вона не є
           умовою закупівлі жодного пакета.</p>
      </div>`;
    }
    rows.sort((a, b) => (+a.pkg || 999) - (+b.pkg || 999) || a.key.localeCompare(b.key));
    const byPkg = new Map();
    rows.forEach((r) => {
      const b = byPkg.get(r.pkg);
      if (b) b.push(r); else byPkg.set(r.pkg, [r]);
    });
    const crit = rows.filter((r) => r.critical).length;
    // Розкривачка (як у блоків Довідника): у ходових посад тут по півтора
    // десятка пакетів, і решта паспорта — код НСЗУ, Перелік № 1065,
    // кваліфікаційна характеристика — їде за нижній край екрана.
    return `<details class="reader-block po-pkgblock po-fold">
      <summary><h3>Кадрова вимога пакетів ПМГ-2026
        <span class="muted">— ${byPkg.size} ${plural(byPkg.size, "пакет", "пакети", "пакетів")}, ${
          rows.length} ${plural(rows.length, "вимога", "вимоги", "вимог")}${
          crit ? " (критичних: " + crit + ")" : ""}</span></h3></summary>
      <div class="po-pkglist">${Array.from(byPkg.entries()).map(([num, list]) => `
        <div class="po-pkgrow">
          <a class="pk-pkg" href="../passport/index.html?package=${encodeURIComponent(num)}${
            backTail(card.id, card.name)}" title="Паспорт пакета № ${esc(num)}">Пакет № ${esc(num)}</a>
          <div class="po-pkgbody">
            <div class="po-pkgtitle">${esc(IDX.packages[num] || "")}</div>
            ${list.map((r) => `<div class="po-pkgcond${r.critical ? " crit" : ""}">
              ${r.scope ? `<b>${esc(r.scope)}:</b> ` : ""}${esc(r.name)}${r.alts > 1
                ? ` <span class="po-combo" title="У вимозі пакета ця посада стоїть у переліку взаємозамінних
                     («та/або»), тож умова стосується переліку загалом, а не цієї посади окремо">одна
                     з ${r.alts} посад переліку «та/або»</span>`
                : ""}${condHTML(r.cond)}
            </div>`).join("")}
          </div>
        </div>`).join("")}</div>
    </details>`;
  }

  /** Умова вимоги. Короткі — як були, у рядок; довгі (умови на пів сотні
   *  посад тягнуть по 250+ знаків і повторюються майже дослівно) — за
   *  розкривачкою з початком тексту в заголовку. Повний текст нікуди не
   *  зникає: він на один клік, і копіюється як був у специфікації. */
  function condHTML(cond) {
    if (!cond) return "";
    if (cond.length <= 110) return " — " + esc(cond);
    return `<details class="po-cond"><summary>${esc(trim(cond, 96))}</summary>
      <p>${esc(cond)}</p></details>`;
  }

  function blockHTML(name, paras) {
    const body = paras.map((p) => {
      if (p.note) return `<p class="po-note">${esc(p.t)}</p>`;
      if (p.variant) return `<h4 class="po-variant">${esc(p.t)}</h4>`;
      let t = p.t;
      // Мітку блоку («Завдання та обов'язки.») не дублюємо в тексті.
      if (p.lead && t.startsWith(p.lead)) {
        const rest = t.slice(p.lead.length).replace(/^[\s:.—-]+/, "");
        if (!rest) return "";
        const isLabel = BLOCK_TITLE[name] && p.lead.startsWith(BLOCK_TITLE[name]);
        return isLabel ? `<p>${esc(rest)}</p>`
          : `<p><b>${esc(p.lead.replace(/:$/, ""))}:</b> ${esc(rest)}</p>`;
      }
      return `<p>${esc(t)}</p>`;
    }).join("");
    // Усі блоки паспорта згорнуті за замовчуванням, і текст Довідника теж:
    // у ходової посади розгорнутий паспорт — це кілька екранів, а потрібен
    // зазвичай один блок. Підсумки в заголовках (скільки пакетів, який
    // наказ) видно й згорнутими, тож обирати є з чого не розкриваючи.
    return `<details class="reader-block po-block po-fold">
      <summary><h3>${esc(BLOCK_TITLE[name] || name)}</h3></summary>
      ${body}
    </details>`;
  }

  function ordersHTML(orders) {
    const o = orders || [];
    if (!o.length) return "";
    return `<div class="reader-block po-orders">
      <h3>Чим змінювалась ця характеристика <span class="muted">— ${o.length} ${
        plural(o.length, "наказ", "накази", "наказів")} МОЗ</span></h3>
      <div class="chip-list">${o.map((x) =>
        `<span class="subchip">№ ${esc(x.num)} <b>від ${esc(x.date)}</b></span>`).join("")}</div>
    </div>`;
  }

  function linksHTML(card) {
    const q = encodeURIComponent(card.name);
    const links = [
      ["📦", "Шукати посаду в пакетах ПМГ-2026", `../pakety/index.html?q=${q}`],
      ["📋", "Табелі оснащення", `tabel.html?q=${q}`],
      ["📄", "Роз'яснення НСЗУ", `../rozjasnennya/index.html?q=${q}`],
      ["⚖️", "Нормативна база", `../regulatory/index.html?q=${q}`],
    ];
    return `<div class="reader-block po-links">
      <h3>Куди далі</h3>
      <div class="link-grid">${links.map(([ico, label, href]) =>
        `<a class="xlink" href="${href}"><span class="xico">${ico}</span>${esc(label)}</a>`).join("")}
      </div>
    </div>`;
  }

  /** Паспорт-заглушка для коду, якого Випуск 78 не описує. */
  function openGap(code) {
    const c = byCode.get(code);
    if (!c) return;
    openedId = null;
    setTab("reader");
    el.reader.classList.remove("reader-empty");
    const why = c.kind === "status"
      ? `Це не посада, а юридичний статус особи (виконувач обов'язків, ФОП, ліквідатор
         тощо). Довідник кваліфікаційних характеристик такі позиції не описує за визначенням.`
      : c.kind === "admin"
        ? `Це загальноадміністративна посада. Випуск 78 «Охорона здоров'я» описує лише
           професії, специфічні для галузі; загальні посади шукайте у випуску 1 Довідника.`
        : `Посада є в довіднику кодів НСЗУ, але кваліфікаційної характеристики у Випуску 78
           для неї немає — ні під цією назвою, ні під синонімом.`;
    el.reader.innerHTML = `
      <div class="reader-crumbs"><span>Коди посад НСЗУ 2026</span></div>
      <h2 class="po-title">${esc(c.name)}</h2>
      <div class="po-meta">Код <b>${esc(code)}</b></div>
      <div class="reader-block po-nocode">
        <h3>Кваліфікаційної характеристики немає</h3>
        <p>${why}</p>
      </div>
      <div class="reader-block po-links">
        <h3>Куди далі</h3>
        <div class="link-grid">
          <a class="xlink" href="../pakety/index.html?q=${encodeURIComponent(c.name)}">
            <span class="xico">📦</span>Шукати посаду в пакетах ПМГ-2026</a>
          <a class="xlink" href="?view=gap"><span class="xico">📄</span>Усі коди без характеристики</a>
        </div>
      </div>`;
    el.reader.scrollTop = 0;
  }

  // ══════════════════════════════════════════════════════════
  // Допоміжне
  // ══════════════════════════════════════════════════════════
  function resetForm() {
    codesMode = false;
    syncViewTabs();
    el.search.value = "";
    el.onlyPkg.checked = false; el.onlyCode.checked = false; el.onlyGap.checked = false;
    el.batch.value = ""; lastBatchFound = []; el.batchCopy.hidden = true;
    el.selSection.value = "";
    resetSel(el.selSub, "оберіть розділ");
    resetSel(el.selPost, "оберіть розділ");
    el.results.hidden = true; el.results.innerHTML = "";
    el.reader.classList.add("reader-empty");
    el.reader.innerHTML = readerEmptyHTML;
    openedId = null;
    el.count.textContent = ready ? idleCount() : "Завантаження…";
    setTab("browser");
    el.search.focus();
  }

  function markActive(row) {
    $$(".rrow.active").forEach((r) => r.classList.remove("active"));
    row.classList.add("active");
  }
  function setTab(tab) {
    if (!el.layout) return;
    el.layout.dataset.active = tab;
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === tab));
  }
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function trim(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  boot();
})();
