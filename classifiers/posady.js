/* ============================================================
   Посади в охороні здоров'я — фронтенд.
   Каскад (Розділ → Підрозділ → Посада) по ДКХП, випуск 78,
   миттєвий і пакетний пошук за назвою та кодом НСЗУ,
   паспорт посади з кадровими вимогами пакетів ПМГ-2026.
   Vanilla JS. Дані: data/posady/posady_meta.json  — підсумки й зауваги
                     data/posady/posady_index.json — легкий список
                     data/posady/posady_codes.json — коди НСЗУ P1–P286
                     data/posady/posady_cards.json — паспорти (ліниво)
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

  let META = null, INDEX = null, CODES = null, CARDS = null;
  let ready = false, cardsPromise = null;
  let openedId = null, lastBatchFound = [];
  let readerEmptyHTML = "";

  const byId = new Map();          // id характеристики → запис індексу
  const codesByDkhp = new Map();   // id характеристики → [записи кодів]
  const orphans = [];              // коди без характеристики — теж шукаємо
  const sections = [];             // [{name, subs: [{name, items}], items}]

  const el = {};

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

    Promise.all([
      fetch("data/posady/posady_meta.json").then((r) => r.json()),
      fetch("data/posady/posady_index.json").then((r) => r.json()),
      fetch("data/posady/posady_codes.json").then((r) => r.json()),
    ]).then(([meta, index, codes]) => {
      META = meta; INDEX = index; CODES = codes;
      buildMaps();
      renderStats();
      renderIssues();
      populateSections();
      ready = true;
      onReady();
    }).catch((e) => {
      el.count.textContent = "Не вдалося завантажити довідник";
      console.error(e);
    });
  }

  /** Паспорти важкі — вантажимо один раз, коли знадобився перший. */
  function loadCards() {
    if (!cardsPromise) {
      cardsPromise = fetch("data/posady/posady_cards.json")
        .then((r) => r.json()).then((d) => (CARDS = d));
    }
    return cardsPromise;
  }

  function buildMaps() {
    INDEX.forEach((e) => byId.set(e.id, e));
    CODES.forEach((c) => {
      if (c.dkhp && byId.has(c.dkhp)) {
        const b = codesByDkhp.get(c.dkhp);
        if (b) b.push(c); else codesByDkhp.set(c.dkhp, [c]);
      } else if (!c.dkhp) {
        orphans.push(c);
      }
    });

    const secIdx = new Map();
    INDEX.forEach((e) => {
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

  function onReady() {
    el.count.textContent = idleCount();
    const q = new URLSearchParams(location.search);
    const id = (q.get("id") || "").trim();
    const raw = (q.get("code") || q.get("q") || "").trim();

    // Вхід із меню «Довідники → Посади»: три пункти ведуть на цю саму сторінку,
    // різниця лише в увімкненому фільтрі — сторінка одна, а входи різні.
    const view = (q.get("view") || "").trim();
    const viewBox = { codes: el.onlyCode, pkg: el.onlyPkg, gap: el.onlyGap }[view];
    if (viewBox) { viewBox.checked = true; refilter(); }

    if (id && byId.has(id)) { openCard(id); syncCascade(id); return; }
    if (raw) { el.search.value = raw; runSearch(); }
  }

  const idleCount = () =>
    nf(INDEX.length) + " кваліфікаційних характеристик · " + nf(CODES.length) +
    " кодів НСЗУ · оберіть розділ або введіть запит";

  // ══════════════════════════════════════════════════════════
  // Статистика і зауваги
  // ══════════════════════════════════════════════════════════
  function renderStats() {
    const c = META.counts || {};
    const cards = [
      ["Характеристик ДКХП", c.entries || 0],
      ["Кодів посад НСЗУ", c.codes || 0],
      ["Посад у пакетах ПМГ", c.pkg_positions || 0],
      ["Пакетів із кадровою вимогою", c.packages_with_staff || 0],
    ];
    el.stats.innerHTML = cards.map(([k, v]) =>
      `<div class="stat"><span class="stat-num">${nf(v)}</span><span class="stat-key">${k}</span></div>`
    ).join("");
  }

  /** Розбіжності між джерелами краще показати, ніж мовчки згладити. */
  function renderIssues() {
    const parts = [];
    (META.notes || []).forEach((n) => parts.push(`<li>${esc(n)}</li>`));

    const al = META.aliases || [];
    if (al.length) {
      parts.push(`<li><b>Застарілі назви в кодах НСЗУ (${al.length}).</b> Паспорт відкривається
        від чинної назви: ` + al.map((a) =>
        `<span class="po-alias">${esc(a.code)} «${esc(a.name)}» → «${esc(a.current)}»</span>`
      ).join(", ") + ".</li>");
    }

    const lac = META.lacunae || [];
    if (lac.length) {
      parts.push(`<li><b>Коди без кваліфікаційної характеристики (${lac.length}).</b>
        Посада є в довіднику кодів НСЗУ, але Випуск 78 її не описує: ` +
        lac.map((l) => `${esc(l.code)} «${esc(l.name)}»`).join("; ") + ".</li>");
    }

    const un = META.pkg_unmatched || [];
    if (un.length) {
      parts.push(`<li><b>Кадрові вимоги пакетів без відповідної характеристики (${un.length}).</b>
        У специфікаціях названо: ` + un.map((u) =>
        `«${esc(u.name)}»${u.hits > 1 ? " ×" + u.hits : ""}`).join("; ") + ".</li>");
    }

    (META.no_block || []).forEach((d) => parts.push(
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
      const tail = [e.codes.length ? e.codes[0] : "", e.pkgs.length ? "📦 " + e.pkgs.length : ""]
        .filter(Boolean).join(" · ");
      opts.push(`<option value="${escAttr(e.id)}">${esc(trim(e.name, 88))}${tail ? " · " + tail : ""}</option>`);
    });
    el.selPost.innerHTML = opts.join("");
    el.selPost.disabled = false;
  }

  function currentList() {
    const si = el.selSection.value;
    if (si === "") return INDEX;
    const s = sections[+si];
    if (!s) return INDEX;
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
    el.selPost.value = id;
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
        `${r.codes.join(" ") || "—"}\t${r.name}`).join("\n");
      navigator.clipboard && navigator.clipboard.writeText(text);
      el.batchCopy.textContent = "✓ Скопійовано (" + lastBatchFound.length + ")";
      setTimeout(() => (el.batchCopy.textContent = "⧉ Копіювати знайдене"), 1500);
    });
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
  }

  function applyFilters(list) {
    let out = list;
    if (el.onlyPkg.checked) out = out.filter((e) => e.pkgs && e.pkgs.length);
    if (el.onlyCode.checked) out = out.filter((e) => e.codes && e.codes.length);
    return out;
  }

  function refilter() {
    if (!ready) return;
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
        c.code.toLowerCase() === q.replace(/\s+/g, ""));
    }
    el.count.textContent = nf(rows.length) + " кодів без кваліфікаційної характеристики" +
      (q ? ` · запит «${el.search.value.trim()}»` : "");
    el.results.hidden = false;
    el.results.innerHTML = rows.map((c) => `
      <button class="rrow po-gap" type="button" data-code="${escAttr(c.code)}">
        <span class="tcode code">${esc(c.code)}</span>
        <span class="rmain">
          <span class="tname">${esc(c.name)}</span>
          <span class="rmeta">немає характеристики в ДКХП, випуск 78</span>
        </span>
      </button>`).join("");
    el.results.querySelectorAll(".rrow").forEach((r) =>
      r.addEventListener("click", () => openGap(r.dataset.code)));
  }

  function matches(e, q) {
    return e.name.toLowerCase().includes(q) ||
      // Назви кодів НСЗУ, що не збіглися з назвою характеристики: хто шукає
      // «провізор», має вийти на «Фармацевта», а не на порожній результат.
      (e.alt || []).some((a) => a.toLowerCase().includes(q)) ||
      (e.codes || []).some((c) => c.toLowerCase() === q);
  }

  function runSearch() {
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
      const hit = CODES.find((c) => c.code === code);
      if (hit && hit.dkhp && byId.has(hit.dkhp)) { openCard(hit.dkhp); syncCascade(hit.dkhp); }
      else if (hit) { openGap(code); }
      list = INDEX.filter((e) => (e.codes || []).includes(code));
      if (!list.length && hit) {
        el.count.textContent = `Код ${code} — «${hit.name}»`;
        el.results.hidden = true;
        return;
      }
    } else {
      list = INDEX.filter((e) => matches(e, q));
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
        ? INDEX.filter((e) => (e.codes || []).includes(it.toUpperCase().replace(/\s+/g, "")))
        : INDEX.filter((e) => matches(e, q));
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
    el.results.innerHTML = list.map(rowHTML).join("") + gaps.map((c) => `
      <button class="rrow po-gap" type="button" data-code="${escAttr(c.code)}">
        <span class="tcode code">${esc(c.code)}</span>
        <span class="rmain">
          <span class="tname">${esc(c.name)}</span>
          <span class="rmeta">немає характеристики в ДКХП</span>
        </span>
      </button>`).join("");
    wireRows();
  }

  function rowHTML(e) {
    const badges = [];
    if (e.codes && e.codes.length) {
      badges.push(`<span class="po-code">${e.codes.map(esc).join(" · ")}</span>`);
    }
    if (e.pkgs && e.pkgs.length) {
      badges.push(`<span class="po-pkgn">📦 ${e.pkgs.length}</span>`);
    }
    const meta = [trim(e.sub || e.section || "", 70)];
    if (e.alt && e.alt.length) meta.push("у кодах НСЗУ: " + e.alt.join(", "));
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
    openedId = id;
    setTab("reader");
    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `<div class="po-loading">Завантаження паспорта…</div>`;
    loadCards().then(() => {
      if (openedId !== id) return;
      const card = CARDS[id];
      if (!card) { el.reader.innerHTML = `<div class="po-loading">Паспорт не знайдено</div>`; return; }
      renderCard(card);
      el.reader.scrollTop = 0;
    });
  }

  function renderCard(card) {
    const crumbs = [card.section, card.sub].filter(Boolean)
      .map((s) => `<span>${esc(s)}</span>`).join('<span class="sep">›</span>');
    const codes = codesByDkhp.get(card.id) || [];

    el.reader.innerHTML = `
      <div class="reader-crumbs">${crumbs}</div>
      <h2 class="po-title">${esc(card.name)}</h2>
      <div class="po-meta">
        № ${card.num} у підрозділі · с. ${card.page} Довідника
      </div>
      ${codesHTML(codes)}
      ${pkgHTML(card)}
      ${BLOCK_ORDER.filter((b) => card.blocks[b]).map((b) => blockHTML(b, card.blocks[b])).join("")}
      ${ordersHTML(card)}
      ${linksHTML(card)}`;

    el.reader.querySelectorAll(".copy-btn").forEach((b) =>
      b.addEventListener("click", () => {
        navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy);
        const t = b.textContent; b.textContent = "✓ Скопійовано";
        setTimeout(() => (b.textContent = t), 1400);
      }));
  }

  function codesHTML(codes) {
    if (!codes.length) {
      return `<div class="reader-block po-nocode">
        <h3>Код посади НСЗУ</h3>
        <p class="muted">Для цієї посади в довіднику «Коди посад НСЗУ 2026» окремого коду немає.</p>
      </div>`;
    }
    return `<div class="reader-block">
      <h3>Код посади НСЗУ <span class="muted">— для кодування працівника в ЕСОЗ</span></h3>
      <div class="po-codes">${codes.map((c) => `
        <div class="po-codecard${c.alias_of ? " legacy" : ""}">
          <span class="tcode code">${esc(c.code)}</span>
          <span class="po-codename">${esc(c.name)}</span>
          ${c.alias_of ? `<span class="po-legacy">назва застаріла — чинна характеристика
             зветься «${esc(c.alias_of)}»</span>` : ""}
          <button class="copy-btn" type="button" data-copy="${escAttr(c.code)}">⧉ Копіювати</button>
        </div>`).join("")}</div>
    </div>`;
  }

  function pkgHTML(card) {
    const rows = card.pkg_rows || [];
    if (!rows.length) {
      return `<div class="reader-block po-nopkg">
        <h3>Кадрова вимога пакетів ПМГ-2026</h3>
        <p class="muted">У блоці «Спеціалісти» специфікацій пакетів на 2026 рік ця посада
           не названа. Це не означає, що ЗОЗ не може її мати — лише те, що вона не є
           умовою закупівлі жодного пакета.</p>
      </div>`;
    }
    const byPkg = new Map();
    rows.forEach((r) => {
      const b = byPkg.get(r.pkg);
      if (b) b.push(r); else byPkg.set(r.pkg, [r]);
    });
    const crit = rows.filter((r) => r.critical).length;
    return `<div class="reader-block po-pkgblock">
      <h3>Кадрова вимога пакетів ПМГ-2026
        <span class="muted">— ${byPkg.size} ${plural(byPkg.size, "пакет", "пакети", "пакетів")}, ${
          rows.length} ${plural(rows.length, "вимога", "вимоги", "вимог")}${
          crit ? " (критичних: " + crit + ")" : ""}</span></h3>
      <div class="po-pkglist">${Array.from(byPkg.entries()).map(([num, list]) => `
        <div class="po-pkgrow">
          <a class="pk-pkg" href="../passport/index.html?package=${encodeURIComponent(num)}${
            backTail(card.id, card.name)}" title="Паспорт пакета № ${esc(num)}">Пакет № ${esc(num)}</a>
          <div class="po-pkgbody">
            <div class="po-pkgtitle">${esc(list[0].title || "")}</div>
            ${list.map((r) => `<div class="po-pkgcond${r.critical ? " crit" : ""}">
              ${r.scope ? `<b>${esc(r.scope)}:</b> ` : ""}${esc(r.name)} — ${esc(r.cond)}
            </div>`).join("")}
          </div>
        </div>`).join("")}</div>
    </div>`;
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
    return `<div class="reader-block po-block">
      <h3>${esc(BLOCK_TITLE[name] || name)}</h3>
      ${body}
    </div>`;
  }

  function ordersHTML(card) {
    const o = card.orders || [];
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
    const c = CODES.find((x) => x.code === code);
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
      <div class="po-meta">Код <b>${esc(c.code)}</b></div>
      <div class="reader-block po-nocode">
        <h3>Кваліфікаційної характеристики немає</h3>
        <p>${why}</p>
      </div>
      <div class="reader-block po-links">
        <h3>Куди далі</h3>
        <div class="link-grid">
          <a class="xlink" href="../pakety/index.html?q=${encodeURIComponent(c.name)}">
            <span class="xico">📦</span>Шукати посаду в пакетах ПМГ-2026</a>
          <a class="xlink" href="?onlyGap=1"><span class="xico">📄</span>Усі коди без характеристики</a>
        </div>
      </div>`;
    el.reader.scrollTop = 0;
  }

  // ══════════════════════════════════════════════════════════
  // Допоміжне
  // ══════════════════════════════════════════════════════════
  function resetForm() {
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
