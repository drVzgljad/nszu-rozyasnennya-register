/* ============================================================
   Номенклатура медичних виробів НК 031:2024 (EMDN) — фронтенд.
   Каскад (Категорія → Група → Позиція) по семирівневому дереву
   + миттєвий і пакетний пошук + паспорт позиції з містком до НК 024.
   Vanilla JS. Дані: data/nk031/nk031_meta.json + nk031_index.json
                    + data/nk031/xwalk/<NN>.json (місток до НК 024, ліниво по категоріях).
   Запис індексу: [code, name, catId, level, leaf]
   Ієрархію відновлюємо обрізанням коду: рівень N = літера + (N-1)*2 цифр.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const CODE_RE = /^[A-ZА-Я][0-9]{0,12}$/i;
  const BACK_PAGE = "/classifiers/nk031.html";
  /** Хвіст для перехресних посилань: щоб на чужій сторінці була кнопка «Назад». */
  function backTail(code) {
    return "&back=" + encodeURIComponent(BACK_PAGE + "?code=" + code) +
      "&backLabel=" + encodeURIComponent("до коду " + code);
  }

  // Колонки запису індексу
  const C = { CODE: 0, NAME: 1, CAT: 2, LVL: 3, LEAF: 4 };
  const LVL_NAME = ["", "категорія", "група", "тип", "деталізація 1",
    "деталізація 2", "деталізація 3", "деталізація 4"];

  let META = null, INDEX = null, ready = false;
  let openedCode = null;
  const byCode = new Map();        // код → запис
  const byCat = new Map();         // id категорії → [записи] (у порядку переліку)
  const kids = new Map();          // код → [записи-нащадки наступного рівня]
  const catById = new Map();
  const XW = new Map();            // id категорії → { код: [[код НК 024, бал, назва], …] }
  const xwLoads = new Map();
  let TXT = null;                  // назва в нижньому регістрі — для пошуку
  let lastBatchFound = [];
  let readerEmptyHTML = "";

  const el = {
    stats: $("#emStats"), search: $("#emSearch"), count: $("#emCount"),
    clear: $("#emClear"), results: $("#emResults"), reader: $("#emReader"),
    layout: $(".nk-layout"), levelFilter: $("#levelFilter"),
    onlyLeaf: $("#onlyLeaf"), onlyXw: $("#onlyXw"),
    selCat: $("#selCat"), selGroup: $("#selGroup"), selCode: $("#selCode"),
    batch: $("#emBatch"), batchRun: $("#emBatchRun"),
    batchCopy: $("#emBatchCopy"), batchClear: $("#emBatchClear"),
    issues: $("#emIssues"), issuesBody: $("#emIssuesBody"),
  };

  // ══════════════════════════════════════════════════════════
  // Завантаження
  // ══════════════════════════════════════════════════════════
  async function boot() {
    readerEmptyHTML = el.reader.innerHTML;
    try {
      META = await fetch("data/nk031/nk031_meta.json").then((r) => r.json());
    } catch (e) {
      el.count.textContent = "Не вдалося завантажити класифікатор.";
      return;
    }
    (META.categories || []).forEach((c) => catById.set(c.id, c));
    renderStats();
    renderIssues();
    populateCats();
    wireUI();

    fetch("data/nk031/nk031_index.json")
      .then((r) => r.json())
      .then((idx) => { INDEX = idx; buildMaps(); ready = true; onReady(); })
      .catch(() => { el.count.textContent = "Індекс пошуку недоступний."; });
  }

  /** Батьківський код: обрізаємо по дві цифри, поки не знайдемо наявну позицію. */
  function parentCode(code) {
    for (let k = code.length - 2; k >= 1; k -= 2) {
      const p = code.slice(0, k);
      if (byCode.has(p)) return p;
    }
    return null;
  }

  function buildMaps() {
    TXT = new Array(INDEX.length);
    for (let i = 0; i < INDEX.length; i++) {
      const e = INDEX[i];
      byCode.set(e[C.CODE], e);
      const b = byCat.get(e[C.CAT]);
      if (b) b.push(e); else byCat.set(e[C.CAT], [e]);
      TXT[i] = e[C.NAME].toLowerCase();
    }
    for (const e of INDEX) {
      const p = parentCode(e[C.CODE]);
      if (!p) continue;
      const b = kids.get(p);
      if (b) b.push(e); else kids.set(p, [e]);
    }
  }

  function onReady() {
    el.count.textContent = idleCount();
    const q = new URLSearchParams(location.search);
    const raw = (q.get("code") || q.get("q") || "").trim();
    if (!raw) return;
    const code = raw.replace(/\s+/g, "").toUpperCase();
    if (byCode.has(code)) { openCode(code); syncCascade(code); }
    else { el.search.value = raw; runSearch(); }
  }

  const idleCount = () => nf(INDEX.length) + " позицій · оберіть категорію або введіть запит";

  // ══════════════════════════════════════════════════════════
  // Статистика і зауваги до джерела
  // ══════════════════════════════════════════════════════════
  function renderStats() {
    const cards = [
      ["Усього позицій", META.total || 0],
      ["Найнижчого рівня", META.leaves || 0],
      ["Категорій", (META.categories || []).length],
      ["Рівнів ієрархії", Object.keys(META.levels || {}).length],
    ];
    el.stats.innerHTML = cards.map(([k, v]) =>
      `<div class="stat"><span class="stat-num">${nf(v)}</span><span class="stat-key">${k}</span></div>`
    ).join("");
  }

  /** Дефекти самого офіційного видання — краще показати, ніж мовчки згладити. */
  function renderIssues() {
    const is = META.issues || {};
    const parts = [];
    (is.rows_without_code || []).forEach((d) =>
      parts.push(`<li>Рядок <b>№ ${d.id}</b> (с. ${d.page}) — «${esc(d.name)}» — у джерелі
        немає коду, рівня й ознаки найнижчого рівня. До переліку не включено.</li>`));
    (is.false_leaves || []).forEach((d) =>
      parts.push(`<li><button class="linkish" data-goto="${d.code}">${d.code}</button>
        — ${esc(d.issue)}.</li>`));
    if (is.duplicate_names)
      parts.push(`<li>Повних дублікатів назв у межах категорії: <b>${is.duplicate_names}</b>
        (наприклад, ${Object.entries(is.duplicate_examples || {}).slice(0, 2)
          .map(([codes, name]) => `${esc(codes)} — «${esc(name)}»`).join("; ")}).</li>`);
    if (is.id_gaps)
      parts.push(`<li>Нумерація рядків рвана: ${is.id_gap_runs} розрив(ів),
        ${is.id_gaps} пропущених ідентифікаторів із ${nf(is.max_id)} — позиції вилучали,
        номери лишали.</li>`);
    if (!parts.length) return;
    el.issuesBody.innerHTML = `<ul class="em-issue-list">${parts.join("")}</ul>
      <p class="casc-note">Перелічене — не помилки цього довідника, а розбіжності в самому
         офіційному виданні НК 031:2024. Показуємо, щоб не було сюрпризів при звірці.</p>`;
    el.issues.hidden = false;
  }

  // ══════════════════════════════════════════════════════════
  // Каскад
  // ══════════════════════════════════════════════════════════
  const ph = (t) => `<option value="">— ${t} —</option>`;
  function resetSel(sel, placeholder) { sel.innerHTML = ph(placeholder); sel.disabled = true; sel.value = ""; }

  function populateCats() {
    const opts = [ph("оберіть категорію")];
    for (const c of META.categories || []) {
      opts.push(`<option value="${c.id}">${esc(c.letter)} · ${esc(trim(c.name, 70))} · ${nf(c.count)}</option>`);
    }
    el.selCat.innerHTML = opts.join("");
    el.selCat.disabled = false;
  }

  const rootOf = (catId) => (byCat.get(catId) || []).find((e) => e[C.LVL] === 1) || null;
  const groupsOf = (catId) => {
    const root = rootOf(catId);
    return root ? (kids.get(root[C.CODE]) || []) : [];
  };

  /** Усі нащадки позиції в порядку переліку (сама позиція першою). */
  function subtree(code, out) {
    out = out || [];
    const e = byCode.get(code);
    if (e) out.push(e);
    for (const k of kids.get(code) || []) subtree(k[C.CODE], out);
    return out;
  }

  function fillGroups(catId) {
    if (!ready) { el.selGroup.innerHTML = ph("індекс вантажиться…"); el.selGroup.disabled = true; return; }
    const gs = groupsOf(catId);
    const opts = [ph(gs.length ? "оберіть групу" : "немає груп")];
    for (const g of gs) {
      const n = subtree(g[C.CODE]).length;
      opts.push(`<option value="${g[C.CODE]}">${g[C.CODE]} · ${esc(trim(g[C.NAME], 90))}${n > 1 ? " · " + nf(n) : ""}</option>`);
    }
    el.selGroup.innerHTML = opts.join("");
    el.selGroup.disabled = gs.length === 0;
  }

  function fillCodes(groupCode) {
    const list = subtree(groupCode);
    const opts = [ph(list.length ? "оберіть позицію" : "немає позицій")];
    for (const e of list) {
      const pad = "  ".repeat(Math.max(0, e[C.LVL] - 2));
      opts.push(`<option value="${e[C.CODE]}">${pad}${e[C.CODE]} · ${esc(trim(e[C.NAME], 90))}${e[C.LEAF] ? "" : " ▸"}</option>`);
    }
    el.selCode.innerHTML = opts.join("");
    el.selCode.disabled = list.length === 0;
  }

  function wireCascade() {
    el.selCat.addEventListener("change", () => {
      resetSel(el.selCode, "оберіть групу");
      const id = el.selCat.value;
      if (id === "") { resetSel(el.selGroup, "оберіть категорію"); showResults([], "категорію не обрано"); return; }
      fillGroups(+id);
      const c = catById.get(+id);
      showResults(applyFilters(byCat.get(+id) || []), c ? `категорія ${c.letter}` : "");
      const root = rootOf(+id);
      if (root) openCode(root[C.CODE]);
    });
    el.selGroup.addEventListener("change", () => {
      const code = el.selGroup.value;
      if (!code) { resetSel(el.selCode, "оберіть групу"); return; }
      fillCodes(code);
      const list = subtree(code);
      showResults(applyFilters(list), `група ${code}`);
      openCode(code);
    });
    el.selCode.addEventListener("change", () => {
      if (el.selCode.value) openCode(el.selCode.value);
    });
  }

  /** Показати каскадний вибір для коду (з пошуку або глибокого лінку). */
  function syncCascade(code) {
    if (!ready) return;
    const e = byCode.get(code); if (!e) return;
    el.selCat.value = String(e[C.CAT]);
    fillGroups(e[C.CAT]);
    // група — предок 2-го рівня
    let g = e;
    while (g && g[C.LVL] > 2) g = byCode.get(parentCode(g[C.CODE]) || "");
    if (!g || g[C.LVL] < 2) { resetSel(el.selCode, "оберіть групу"); return; }
    el.selGroup.value = g[C.CODE];
    fillCodes(g[C.CODE]);
    el.selCode.value = code;
  }

  // ══════════════════════════════════════════════════════════
  // Пошук
  // ══════════════════════════════════════════════════════════
  function applyFilters(list) {
    const lvl = +el.levelFilter.value || 0;
    let out = list;
    if (el.onlyLeaf.checked) out = out.filter((e) => e[C.LEAF]);
    if (lvl) out = out.filter((e) => e[C.LVL] === lvl);
    if (el.onlyXw.checked) out = out.filter((e) => hasXw(e));
    return out;
  }

  /** Чи є місток до НК 024 — знаємо лише для вже завантажених категорій. */
  function hasXw(e) {
    const m = XW.get(e[C.CAT]);
    if (!m) { loadXw(e[C.CAT]); return true; }   // ще не знаємо — не ховаємо
    return !!m[e[C.CODE]];
  }

  let searchTimer = null;
  function wireUI() {
    wireCascade();
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 140);
    });
    el.levelFilter.addEventListener("change", refilter);
    el.onlyLeaf.addEventListener("change", refilter);
    el.onlyXw.addEventListener("change", () => {
      if (el.onlyXw.checked) {
        // щоб фільтр був чесним, підвантажуємо містки видимих категорій
        const cats = el.selCat.value ? [+el.selCat.value] : (META.categories || []).map((c) => c.id);
        Promise.all(cats.map(loadXw)).then(refilter);
      }
      refilter();
    });
    el.clear.addEventListener("click", resetForm);
    el.batchRun.addEventListener("click", () => {
      if (!ready) { el.count.textContent = "Індекс ще вантажиться…"; return; }
      const terms = splitTerms(el.batch.value);
      if (!terms.length) { el.count.textContent = "Введіть коди або назви у поле пакетного пошуку."; return; }
      el.search.value = "";
      runBatch(terms);
    });
    el.batch.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") { ev.preventDefault(); el.batchRun.click(); }
    });
    el.batchClear.addEventListener("click", () => {
      el.batch.value = ""; el.batchCopy.hidden = true; lastBatchFound = [];
      el.results.hidden = true; el.results.innerHTML = "";
      el.count.textContent = ready ? idleCount() : "Завантаження…";
    });
    el.batchCopy.addEventListener("click", () => {
      const text = lastBatchFound.map((r) => `${r.code}\t${r.name}`).join("\n");
      navigator.clipboard && navigator.clipboard.writeText(text);
      el.batchCopy.textContent = "✓ Скопійовано (" + lastBatchFound.length + ")";
      setTimeout(() => (el.batchCopy.textContent = "⧉ Копіювати знайдене"), 1500);
    });
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
  }

  /** Перезастосувати фільтри до поточного виду. */
  function refilter() {
    if (!ready) return;
    if (el.search.value.trim() || el.batch.value.trim()) { runSearch(); return; }
    if (el.selGroup.value) {
      showResults(applyFilters(subtree(el.selGroup.value)), `група ${el.selGroup.value}`);
    } else if (el.selCat.value !== "") {
      const c = catById.get(+el.selCat.value);
      showResults(applyFilters(byCat.get(+el.selCat.value) || []), c ? `категорія ${c.letter}` : "");
    } else {
      runSearch();
    }
  }

  function runSearch() {
    const raw = el.search.value.trim();
    const filtering = !!el.levelFilter.value || el.onlyLeaf.checked || el.onlyXw.checked;
    if (!raw && !filtering) {
      el.results.hidden = true; el.batchCopy.hidden = true; lastBatchFound = [];
      if (ready) el.count.textContent = idleCount();
      return;
    }
    if (!ready) { el.count.textContent = "Індекс ще вантажиться…"; return; }

    const inline = splitTerms(raw);
    if (inline.length > 1) { runBatch(inline); return; }
    el.batchCopy.hidden = true; lastBatchFound = [];

    const q = raw.toLowerCase();
    const qCode = raw.replace(/\s+/g, "").toUpperCase();
    const looksCode = CODE_RE.test(qCode) && qCode.length > 1;
    const words = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < INDEX.length; i++) {
      const e = INDEX[i];
      let score = 0;
      if (!raw) score = 10;
      else if (looksCode) {
        if (e[C.CODE] === qCode) score = 100;
        else if (e[C.CODE].startsWith(qCode)) score = 70;
        else if (TXT[i].includes(q)) score = 20;
      } else {
        const pos = TXT[i].indexOf(q);
        if (pos === 0) score = 60;
        else if (pos > 0) score = /[\s(«/–-]/.test(TXT[i][pos - 1]) ? 45 : 30;
        else if (words.length > 1 && words.every((w) => TXT[i].includes(w))) score = 15;
      }
      if (score > 0) out.push([score, e]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1][C.CODE].localeCompare(b[1][C.CODE]));
    showResults(applyFilters(out.map((x) => x[1])), raw || "фільтр");
  }

  const CAP = 500;
  function showResults(list, what) {
    el.count.textContent = list.length
      ? `Знайдено ${nf(list.length)}${list.length > CAP ? " · показано " + CAP : ""}${what ? " · " + what : ""}`
      : "Нічого не знайдено" + (what ? " · " + what : "");
    el.results.innerHTML = list.slice(0, CAP).map(resultRow).join("");
    el.results.hidden = false;
  }

  function resultRow(e) {
    const c = catById.get(e[C.CAT]);
    return `<button class="rrow lvl-${e[C.LVL]}" type="button" data-code="${e[C.CODE]}">
      <span class="tcode code">${e[C.CODE]}</span>
      <span class="rmain"><span class="tname">${esc(e[C.NAME])}</span>
        <span class="rmeta">рівень ${e[C.LVL]} · ${LVL_NAME[e[C.LVL]] || ""}${c ? " · категорія " + esc(c.letter) : ""}</span></span>
      ${e[C.LEAF] ? '<span class="em-dot em-leaf" title="Найнижчий рівень — цією позицією можна ідентифікувати конкретний виріб">найнижчий</span>'
        : '<span class="em-dot em-node" title="Вузол дерева: має підпозиції, для ідентифікації виробу не використовується">вузол</span>'}
    </button>`;
  }

  // ── Пакетний пошук ────────────────────────────────────────
  function splitTerms(raw) {
    const parts = String(raw || "").split(/[,;\n\t]+/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const toks = p.split(/\s+/);
      const allCode = toks.length > 1 && toks.every((t) => CODE_RE.test(t));
      if (allCode) out.push(...toks); else out.push(p);
    }
    return out;
  }

  function matchTerm(term) {
    const qCode = term.replace(/\s+/g, "").toUpperCase();
    let matches;
    if (CODE_RE.test(qCode) && qCode.length > 1) {
      const exact = byCode.get(qCode);
      matches = exact ? [exact] : INDEX.filter((e) => e[C.CODE].startsWith(qCode));
    } else {
      const q = term.toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      matches = INDEX.filter((e, i) =>
        TXT[i].includes(q) || (words.length > 1 && words.every((w) => TXT[i].includes(w))));
    }
    return applyFilters(matches);
  }

  function runBatch(terms) {
    if (!ready) { el.count.textContent = "Індекс ще вантажиться…"; return; }
    lastBatchFound = [];
    let foundTerms = 0, total = 0;
    const PER = 25;
    const blocks = terms.map((term) => {
      const m = matchTerm(term);
      if (m.length) { foundTerms++; total += m.length; }
      m.forEach((e) => lastBatchFound.push({ code: e[C.CODE], name: e[C.NAME] }));
      const head = `<div class="batch-head ${m.length ? "" : "nomatch"}">
          <span>${m.length ? "🔹" : "❌"} ${esc(term)}</span>
          <span class="batch-badge">${m.length ? nf(m.length) + (m.length > PER ? " · показано " + PER : "") : "не знайдено"}</span>
        </div>`;
      return `<div class="batch-group">${head}${m.slice(0, PER).map(resultRow).join("")}</div>`;
    });
    el.count.textContent = `Пакетно: ${terms.length} запит(ів) · збіги у ${foundTerms}/${terms.length} · усього ${nf(total)}`;
    el.results.innerHTML = blocks.join("");
    el.results.hidden = false;
    el.batchCopy.hidden = lastBatchFound.length === 0;
  }

  el.results.addEventListener("click", (ev) => {
    const b = ev.target.closest(".rrow");
    if (!b) return;
    openCode(b.dataset.code); syncCascade(b.dataset.code); markActive(b);
  });

  // ══════════════════════════════════════════════════════════
  // Місток до НК 024 (ліниво по категоріях)
  // ══════════════════════════════════════════════════════════
  function loadXw(catId) {
    if (XW.has(catId)) return Promise.resolve(XW.get(catId));
    if (xwLoads.has(catId)) return xwLoads.get(catId);
    const p = fetch("data/nk031/xwalk/" + String(catId).padStart(2, "0") + ".json")
      .then((r) => r.json())
      .then((d) => { XW.set(catId, d); return d; })
      .catch(() => { xwLoads.delete(catId); return null; });
    xwLoads.set(catId, p);
    return p;
  }

  // ══════════════════════════════════════════════════════════
  // Паспорт позиції
  // ══════════════════════════════════════════════════════════
  function openCode(code) {
    const e = byCode.get(code);
    if (!e) return;
    openedCode = code;
    renderReader(e, XW.get(e[C.CAT]));
    if (!XW.has(e[C.CAT])) {
      loadXw(e[C.CAT]).then((d) => { if (d && openedCode === code) renderReader(e, d); });
    }
  }

  function ancestors(e) {
    const out = [];
    let p = parentCode(e[C.CODE]);
    while (p) { out.unshift(byCode.get(p)); p = parentCode(p); }
    return out.filter(Boolean);
  }

  function renderReader(e, xw) {
    const c = catById.get(e[C.CAT]);
    const path = ancestors(e);
    const children = kids.get(e[C.CODE]) || [];
    const parent = path.length ? path[path.length - 1] : null;
    const sibs = parent ? (kids.get(parent[C.CODE]) || []).filter((s) => s !== e) : [];
    const matches = xw ? (xw[e[C.CODE]] || null) : undefined;

    const crumbs = path.map((a) =>
      `<span class="crumb"><button class="linkish" data-goto="${a[C.CODE]}"><b>${a[C.CODE]}</b>
        ${esc(trim(a[C.NAME], 60))}</button></span>`);

    const leafBlock = e[C.LEAF]
      ? `<div class="em-note em-ok">Найнижчий рівень: цією позицією можна ідентифікувати
           конкретний медичний виріб.</div>`
      : `<div class="em-note em-warn">Вузол дерева: має підпозиції. Для ідентифікації виробу
           слід обрати позицію найнижчого рівня нижче за списком.</div>`;

    const childBlock = children.length
      ? `<div class="reader-block"><h3>Підпозиції <span class="src">наступний рівень</span></h3>
          <div class="chip-list">${children.map((k) =>
        `<button class="subchip" data-goto="${k[C.CODE]}"><b>${k[C.CODE]}</b> ${esc(trim(k[C.NAME], 90))}</button>`).join("")}</div></div>`
      : "";

    const sibBlock = sibs.length
      ? `<div class="reader-block"><h3>Сусідні позиції <span class="src">той самий батьківський код</span></h3>
          <div class="chip-list">${sibs.slice(0, 40).map((s) =>
        `<button class="subchip" data-goto="${s[C.CODE]}"><b>${s[C.CODE]}</b> ${esc(trim(s[C.NAME], 90))}</button>`).join("")}
          ${sibs.length > 40 ? `<span class="muted">…та ще ${nf(sibs.length - 40)}</span>` : ""}</div></div>`
      : "";

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code">${e[C.CODE]}</div>
        <div class="reader-level">Рівень ${e[C.LVL]} · ${LVL_NAME[e[C.LVL]] || ""}</div>
        <button class="copy-btn" type="button" data-copy="${escAttr(e[C.CODE] + " — " + e[C.NAME])}" title="Скопіювати код і назву">⧉ Копіювати</button>
      </div>
      <h2 class="reader-name">${esc(e[C.NAME])}</h2>
      ${leafBlock}
      <div class="reader-crumbs">${crumbs.join('<span class="sep">›</span>')}</div>
      ${childBlock}
      ${xwalkBlock(e, matches)}
      ${sibBlock}
      ${renderLinks(e)}
      <div class="reader-foot">НК 031:2024 · EMDN · наказ Мінекономіки від 24.09.2024 № 23992${c ? " · категорія " + esc(c.letter) : ""}</div>`;
    setTab("reader");
  }

  /** Місток до НК 024: обчислена подібність назв, не офіційне зіставлення. */
  function xwalkBlock(e, matches) {
    if (matches === undefined) {
      return `<div class="reader-block"><h3>Ймовірні відповідники в НК 024 (GMDN)</h3>
        <p class="muted">Шукаю відповідники…</p></div>`;
    }
    const head = `<h3>Ймовірні відповідники в НК 024 (GMDN)
        <span class="src">за подібністю назв — не офіційне зіставлення</span></h3>`;
    if (!matches || !matches.length) {
      return `<div class="reader-block">${head}
        <p class="muted">Схожих назв у НК 024 не знайдено. Це нормально: номенклатури побудовані
           по-різному, а офіційної таблиці переходу EMDN ↔ GMDN не існує.</p>
        <a class="xlink" href="nk024.html?q=${encodeURIComponent(keyWords(e[C.NAME]))}${backTail(e[C.CODE])}">
          <span class="xico">🩹</span>Пошукати в НК 024 вручну</a></div>`;
    }
    const rows = matches.map(([code, score, name]) => `
      <a class="em-xw" href="nk024.html?code=${encodeURIComponent(code)}${backTail(e[C.CODE])}">
        <span class="em-xw-score ${score >= 0.7 ? "hi" : score >= 0.5 ? "mid" : "low"}"
              title="Оцінка подібності назв: ${Math.round(score * 100)} %">${Math.round(score * 100)}%</span>
        <span class="em-xw-code code">${code}</span>
        <span class="em-xw-name">${esc(name)}</span></a>`).join("");
    return `<div class="reader-block">${head}<div class="em-xw-list">${rows}</div>
      <p class="casc-note">Офіційного зіставлення EMDN ↔ GMDN не існує: Єврокомісія такої
         таблиці не видавала (MDCG 2021-12), тож відповідники тут обчислені за подібністю
         українських назв і потребують перевірки експертом. Обидва класифікатори чинні
         одночасно й обидва названо в пункті 9 постанови 1808.</p></div>`;
  }

  const keyWords = (name) => name.split(/[,(–-]/)[0].trim().toLowerCase().slice(0, 50);

  function renderLinks(e) {
    const name = encodeURIComponent(keyWords(e[C.NAME]));
    const items = [
      ["🩹", "Медвироби НК 024", `nk024.html?q=${name}${backTail(e[C.CODE])}`],
      ["📋", "Табелі оснащення", `tabel.html?q=${name}${backTail(e[C.CODE])}`],
      ["📦", "Пакети ПМГ-2026", `../pakety/index.html?q=${name}`],
      ["📜", "Постанова 1808", `../postanova/index.html?q=${name}`],
      ["📄", "Роз'яснення НСЗУ", `../rozjasnennya/index.html?q=${name}`],
      ["🏥", "Стандарти ДЕЦ МОЗ", `../dec/index.html?q=${name}`],
    ];
    return `<div class="reader-block">
      <h3>Переходи до пов'язаних розділів <span class="src">пошук за назвою виробу</span></h3>
      <div class="link-grid">${items.map(([i, t, h]) =>
      `<a class="xlink" href="${h}"><span class="xico">${i}</span>${t}</a>`).join("")}</div>
      <p class="casc-note">Власної прив'язки до пакетів ПМГ номенклатура не має: у Таблиці
         співставлення пакети закріплено за кодами НК&nbsp;025 і НК&nbsp;026. НК&nbsp;031
         застосовується разом з ними — за пунктом&nbsp;9 постанови&nbsp;1808.</p>
    </div>`;
  }

  document.addEventListener("click", (ev) => {
    const goto = ev.target.closest("[data-goto]");
    if (goto) {
      const c = goto.dataset.goto;
      if (byCode.has(c)) { openCode(c); syncCascade(c); }
      return;
    }
    const cp = ev.target.closest("[data-copy]");
    if (cp) {
      navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy);
      cp.textContent = "✓ Скопійовано"; setTimeout(() => (cp.textContent = "⧉ Копіювати"), 1400);
    }
  });

  // ══════════════════════════════════════════════════════════
  // Допоміжне
  // ══════════════════════════════════════════════════════════
  function resetForm() {
    el.search.value = ""; el.levelFilter.value = "";
    el.onlyLeaf.checked = false; el.onlyXw.checked = false;
    el.batch.value = ""; lastBatchFound = []; el.batchCopy.hidden = true;
    el.selCat.value = "";
    resetSel(el.selGroup, "оберіть категорію");
    resetSel(el.selCode, "оберіть групу");
    el.results.hidden = true; el.results.innerHTML = "";
    el.reader.classList.add("reader-empty");
    el.reader.innerHTML = readerEmptyHTML;
    openedCode = null;
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
    $$("#mobileTabs .mobile-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  }
  function trim(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  boot();
})();
