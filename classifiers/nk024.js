/* ============================================================
   Класифікатор медичних виробів НК 024:2023 (GMDN) — фронтенд.
   Каскад (Літера → Група назв → Код) + миттєвий і пакетний пошук
   + двомовний паспорт виробу (назва та опис укр./англ.).
   Vanilla JS. Дані: data/nk024/nk024_meta.json + nk024_index.json
                    + data/nk024/terms/<NN>.json (описи, ліниво по літерах).
   Запис індексу: [code, ua, en, letterId, flags]
   flags: 1 одноразовий · 2 багаторазовий · 4 IVD · 8 стерильний
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const CODE_RE = /^\d{1,5}$/;
  const BACK_PAGE = "/classifiers/nk024.html";
  /** Хвіст для перехресних посилань: щоб на чужій сторінці була кнопка «Назад». */
  function backTail(code) {
    return "&back=" + encodeURIComponent(BACK_PAGE + "?code=" + code) +
      "&backLabel=" + encodeURIComponent("до коду " + code);
  }

  // Колонки запису індексу
  const C = { CODE: 0, UA: 1, EN: 2, LET: 3, FLAG: 4 };
  const FLAGS = [
    { bit: 1, label: "одноразовий", cls: "single", tip: "В описі виробу зазначено одноразове використання" },
    { bit: 2, label: "багаторазовий", cls: "reuse", tip: "В описі виробу зазначено багаторазове використання" },
    { bit: 8, label: "стерильний", cls: "steril", tip: "В описі згадано стерильність виробу" },
    { bit: 4, label: "IVD", cls: "ivd", tip: "Виріб для діагностики in vitro (лабораторний реагент, набір, калібратор, контроль)" },
  ];
  const GROUP_CAP = 140;   // більші групи назв ділимо на підгрупи за наступним словом
  const GROUP_DEPTH = 4;   // максимум слів у ключі групи

  let META = null, INDEX = null, ready = false, LANG = "ua";
  let openedCode = null;
  const byCode = new Map();       // код → запис
  const byLetter = new Map();     // id літери → [записи]
  const letterById = new Map();
  const TERMS = new Map();        // id літери → { код: [ua, uaDesc, en, enDesc] }
  const termLoads = new Map();    // id літери → Promise
  const XW = new Map();           // id літери → { код: [[код НК 031, бал, назва], …] }
  const xwLoads = new Map();      // id літери → Promise
  let TXT = null;                 // пошуковий рядок на кожен запис (укр. + англ.)
  let groupsCache = new Map();    // id літери → [{key, label, list}]
  let lastBatchFound = [];
  let readerEmptyHTML = "";

  const el = {
    stats: $("#mdStats"), search: $("#mdSearch"), count: $("#mdCount"),
    clear: $("#mdClear"), results: $("#mdResults"), reader: $("#mdReader"),
    layout: $(".nk-layout"), flagFilter: $("#flagFilter"),
    selLetter: $("#selLetter"), selGroup: $("#selGroup"), selCode: $("#selCode"),
    batch: $("#mdBatch"), batchRun: $("#mdBatchRun"),
    batchCopy: $("#mdBatchCopy"), batchClear: $("#mdBatchClear"),
  };

  const nameOf = (e) => (LANG === "en" ? (e[C.EN] || e[C.UA]) : e[C.UA]);

  // ══════════════════════════════════════════════════════════
  // Завантаження
  // ══════════════════════════════════════════════════════════
  async function boot() {
    readerEmptyHTML = el.reader.innerHTML;
    LANG = localStorage.getItem("nk024Lang") === "en" ? "en" : "ua";
    syncLangButtons();
    try {
      META = await fetch("data/nk024/nk024_meta.json").then((r) => r.json());
    } catch (e) {
      el.count.textContent = "Не вдалося завантажити класифікатор.";
      return;
    }
    (META.letters || []).forEach((l) => letterById.set(l.id, l));
    renderStats();
    populateLetters();
    wireUI();

    fetch("data/nk024/nk024_index.json")
      .then((r) => r.json())
      .then((idx) => { INDEX = idx; buildMaps(); ready = true; onReady(); })
      .catch(() => { el.count.textContent = "Індекс пошуку недоступний."; });
  }

  function buildMaps() {
    TXT = new Array(INDEX.length);
    for (let i = 0; i < INDEX.length; i++) {
      const e = INDEX[i];
      byCode.set(e[C.CODE], e);
      const b = byLetter.get(e[C.LET]);
      if (b) b.push(e); else byLetter.set(e[C.LET], [e]);
      TXT[i] = (e[C.UA] + " ⟡ " + e[C.EN]).toLowerCase();
    }
  }

  function onReady() {
    el.count.textContent = idleCount();
    if (el.selLetter.value) fillGroups(+el.selLetter.value);
    const q = new URLSearchParams(location.search);
    const raw = (q.get("code") || q.get("q") || "").trim();
    if (!raw) return;
    const code = raw.replace(/\s+/g, "");
    if (byCode.has(code)) { openCode(code); syncCascade(code); }
    else { el.search.value = raw; runSearch(); }
  }

  const idleCount = () => nf(INDEX.length) + " кодів · оберіть літеру або введіть запит";

  // ══════════════════════════════════════════════════════════
  // Статистика
  // ══════════════════════════════════════════════════════════
  function renderStats() {
    const f = META.flags || {};
    const cards = [
      ["Усього кодів", META.total || 0],
      ["Літерних розділів", (META.letters || []).length],
      ["Для діагностики in vitro", f.ivd || 0],
      ["Одноразових виробів", f.single_use || 0],
    ];
    el.stats.innerHTML = cards.map(([k, v]) =>
      `<div class="stat"><span class="stat-num">${nf(v)}</span><span class="stat-key">${k}</span></div>`
    ).join("");
  }

  // ══════════════════════════════════════════════════════════
  // Каскад
  // ══════════════════════════════════════════════════════════
  const ph = (t) => `<option value="">— ${t} —</option>`;
  function resetSel(sel, placeholder) { sel.innerHTML = ph(placeholder); sel.disabled = true; sel.value = ""; }

  function populateLetters() {
    const opts = [ph("оберіть літеру")];
    for (const l of META.letters || []) {
      opts.push(`<option value="${l.id}">${esc(l.letter)} · ${nf(l.count)}</option>`);
    }
    el.selLetter.innerHTML = opts.join("");
    el.selLetter.disabled = false;
  }

  /** Ключ групи: перші `depth` слів української назви (порядок переліку — за українською). */
  function groupKey(name, depth) {
    return String(name || "").replace(/[«»"]/g, "").split(/[\s,;/]+/)
      .filter(Boolean).slice(0, depth).join(" ").toLowerCase();
  }

  /** Групи назв у межах літери; завеликі групи дробимо наступним словом. */
  function groupsOfLetter(id) {
    if (groupsCache.has(id)) return groupsCache.get(id);
    const out = [];
    split(byLetter.get(id) || [], 1);
    out.sort((a, b) => a.key.localeCompare(b.key, "uk"));
    groupsCache.set(id, out);
    return out;

    function split(list, depth) {
      const map = new Map();
      for (const e of list) {
        const k = groupKey(e[C.UA], depth);
        const b = map.get(k);
        if (b) b.push(e); else map.set(k, [e]);
      }
      for (const [k, sub] of map) {
        if (sub.length > GROUP_CAP && depth < GROUP_DEPTH && map.size + sub.length > 1) {
          const before = out.length;
          split(sub, depth + 1);
          if (out.length - before > 1) continue;      // дроблення дало користь
          out.length = before;                        // ні — лишаємо групу цілою
        }
        out.push({ key: k, label: sub[0][C.UA].split(/[\s,;/]+/).slice(0, depth).join(" "), list: sub, depth });
      }
    }
  }

  function fillGroups(id) {
    if (!ready) { el.selGroup.innerHTML = ph("індекс вантажиться…"); el.selGroup.disabled = true; return; }
    const groups = groupsOfLetter(id);
    const opts = [ph(groups.length ? "оберіть групу назв" : "немає кодів")];
    for (const g of groups) {
      const label = g.list.length > 1
        ? `${g.label}… (${nf(g.list.length)})`
        : `${g.list[0][C.CODE]} · ${g.list[0][C.UA]}`;
      opts.push(`<option value="${escAttr(g.key)}">${esc(trim(label, 110))}</option>`);
    }
    el.selGroup.innerHTML = opts.join("");
    el.selGroup.disabled = groups.length === 0;
  }

  function groupByKey(letterId, key) {
    return groupsOfLetter(letterId).find((g) => g.key === key) || null;
  }

  function fillCodes(letterId, key) {
    const g = groupByKey(letterId, key);
    const list = g ? g.list : [];
    const opts = [ph(list.length ? "оберіть код" : "немає кодів")];
    for (const e of list) {
      opts.push(`<option value="${e[C.CODE]}">${e[C.CODE]} · ${esc(trim(nameOf(e), 100))}</option>`);
    }
    el.selCode.innerHTML = opts.join("");
    el.selCode.disabled = list.length === 0;
  }

  function wireCascade() {
    el.selLetter.addEventListener("change", () => {
      resetSel(el.selCode, "оберіть групу");
      const id = el.selLetter.value;
      if (id === "") { resetSel(el.selGroup, "оберіть літеру"); showResults([], "літеру не обрано"); return; }
      fillGroups(+id);
      listLetter(+id);
    });
    el.selGroup.addEventListener("change", () => {
      const key = el.selGroup.value, id = +el.selLetter.value;
      if (!key) { resetSel(el.selCode, "оберіть групу"); listLetter(id); return; }
      fillCodes(id, key);
      const g = groupByKey(id, key);
      const list = g ? g.list : [];
      showResults(applyFilters(list), `група «${g ? g.label : key}»`);
      if (list.length === 1) { el.selCode.value = list[0][C.CODE]; openCode(list[0][C.CODE]); }
    });
    el.selCode.addEventListener("change", () => {
      if (el.selCode.value) openCode(el.selCode.value);
    });
  }

  function listLetter(id) {
    const l = letterById.get(id);
    showResults(applyFilters(byLetter.get(id) || []), l ? `літера ${l.letter}` : "");
  }

  /** Показати каскадний вибір для коду (з пошуку або глибокого лінку). */
  function syncCascade(code) {
    if (!ready) return;
    const e = byCode.get(code); if (!e) return;
    const id = e[C.LET];
    el.selLetter.value = String(id);
    fillGroups(id);
    const g = groupsOfLetter(id).find((gr) => gr.list.includes(e));
    if (!g) return;
    el.selGroup.value = g.key;
    fillCodes(id, g.key);
    el.selCode.value = e[C.CODE];
  }

  // ══════════════════════════════════════════════════════════
  // Пошук
  // ══════════════════════════════════════════════════════════
  function applyFilters(list) {
    const bit = +el.flagFilter.value || 0;
    return bit ? list.filter((e) => e[C.FLAG] & bit) : list;
  }

  let searchTimer = null;
  function wireUI() {
    wireCascade();
    $$(".md-lang").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 140);
    });
    el.flagFilter.addEventListener("change", refilter);
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

  /** Перезастосувати фільтр до поточного виду (пошук / перелік групи чи літери). */
  function refilter() {
    if (el.search.value.trim() || el.batch.value.trim()) { runSearch(); return; }
    if (el.selGroup.value) {
      const id = +el.selLetter.value, g = groupByKey(id, el.selGroup.value);
      showResults(applyFilters(g ? g.list : []), `група «${g ? g.label : ""}»`);
    } else if (el.selLetter.value !== "") {
      listLetter(+el.selLetter.value);
    } else {
      runSearch();
    }
  }

  function runSearch() {
    const raw = el.search.value.trim();
    const filtering = !!el.flagFilter.value;
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
    const qCode = raw.replace(/\s+/g, "");
    const looksCode = CODE_RE.test(qCode);
    // Назви виробів довгі й описові, тож кілька слів шукаємо як «усі разом, у будь-якому порядку».
    const words = q.split(/\s+/).filter(Boolean);
    const bit = +el.flagFilter.value || 0;
    const out = [];
    for (let i = 0; i < INDEX.length; i++) {
      const e = INDEX[i];
      if (bit && !(e[C.FLAG] & bit)) continue;
      let score = 0;
      if (!raw) score = 10;
      else if (looksCode) {
        if (e[C.CODE] === qCode) score = 100;
        else if (e[C.CODE].startsWith(qCode)) score = 70;
        else if (TXT[i].includes(q)) score = 20;
      } else {
        const pos = TXT[i].indexOf(q);
        if (pos === 0) score = 60;
        else if (pos > 0) score = /[\s(«]/.test(TXT[i][pos - 1]) ? 45 : 30;
        else if (words.length > 1 && words.every((w) => TXT[i].includes(w))) score = 15;
      }
      if (score > 0) out.push([score, e]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1][C.CODE].localeCompare(b[1][C.CODE]));
    showResults(out.map((x) => x[1]), raw || "фільтр");
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
    const l = letterById.get(e[C.LET]);
    const alt = LANG === "en" ? e[C.UA] : e[C.EN];
    return `<button class="rrow" type="button" data-code="${e[C.CODE]}">
      <span class="tcode code">${e[C.CODE]}</span>
      <span class="rmain"><span class="tname">${esc(nameOf(e))}</span>
        <span class="rmeta">${alt ? esc(trim(alt, 70)) : (l ? "літера " + esc(l.letter) : "")}</span></span>
      ${flagDots(e[C.FLAG])}
    </button>`;
  }

  function flagDots(f) {
    return FLAGS.filter((x) => f & x.bit).map((x) =>
      `<span class="md-dot md-${x.cls}" title="${escAttr(x.tip)}">${x.label}</span>`).join("");
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
    const qCode = term.replace(/\s+/g, "");
    let matches;
    if (CODE_RE.test(qCode)) {
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
      m.forEach((e) => lastBatchFound.push({ code: e[C.CODE], name: nameOf(e) }));
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
  // Паспорт виробу
  // ══════════════════════════════════════════════════════════
  /** Описи вантажимо ліниво — по одному файлу на літерний розділ. */
  function loadTerms(letterId) {
    if (TERMS.has(letterId)) return Promise.resolve(TERMS.get(letterId));
    if (termLoads.has(letterId)) return termLoads.get(letterId);
    const l = letterById.get(letterId);
    const p = fetch("data/nk024/terms/" + (l ? l.file : String(letterId).padStart(2, "0") + ".json"))
      .then((r) => r.json())
      .then((d) => { TERMS.set(letterId, d); return d; })
      .catch(() => { termLoads.delete(letterId); return null; });
    termLoads.set(letterId, p);
    return p;
  }

  /** Місток до НК 031 (EMDN) — теж ліниво, по тих самих літерних розділах. */
  function loadXw(letterId) {
    if (XW.has(letterId)) return Promise.resolve(XW.get(letterId));
    if (xwLoads.has(letterId)) return xwLoads.get(letterId);
    const p = fetch("data/nk024/xwalk/" + String(letterId).padStart(2, "0") + ".json")
      .then((r) => r.json())
      .then((d) => { XW.set(letterId, d); return d; })
      .catch(() => { xwLoads.delete(letterId); return null; });
    xwLoads.set(letterId, p);
    return p;
  }

  function openCode(code) {
    const e = byCode.get(code);
    if (!e) return;
    openedCode = code;
    renderReader(e, TERMS.get(e[C.LET]));
    if (!TERMS.has(e[C.LET])) {
      loadTerms(e[C.LET]).then((d) => {
        if (d && openedCode === code) renderReader(e, d);
      });
    }
    if (!XW.has(e[C.LET])) {
      loadXw(e[C.LET]).then((d) => {
        if (d && openedCode === code) renderReader(e, TERMS.get(e[C.LET]));
      });
    }
  }

  function renderReader(e, terms) {
    const rec = terms ? terms[e[C.CODE]] : null;   // [ua, uaDesc, en, enDesc]
    const l = letterById.get(e[C.LET]);
    const group = ready ? groupsOfLetter(e[C.LET]).find((g) => g.list.includes(e)) : null;
    const sibs = group ? group.list.filter((s) => s !== e) : [];

    const primary = nameOf(e);
    const secondary = LANG === "en" ? e[C.UA] : e[C.EN];
    const descUA = rec ? rec[1] : null;
    const descEN = rec ? rec[3] : null;
    const descPrimary = LANG === "en" ? descEN : descUA;
    const descSecondary = LANG === "en" ? descUA : descEN;
    const descPrimaryTitle = LANG === "en" ? "Description (English, GMDN)" : "Опис виробу (українською)";
    const descSecondaryTitle = LANG === "en" ? "Опис виробу (українською)" : "Description (English, GMDN)";

    const crumbs = [];
    if (l) crumbs.push(`<span class="crumb"><b>Літера ${esc(l.letter)}</b> ${nf(l.count)} код(ів)</span>`);
    if (group) crumbs.push(`<span class="crumb">Група <em>${esc(group.label)}</em> · ${nf(group.list.length)} код(ів)</span>`);

    const flagChips = FLAGS.filter((x) => e[C.FLAG] & x.bit);
    const flagsHtml = flagChips.length
      ? `<div class="reader-block"><h3>Ознаки виробу <span class="src">за описом у класифікаторі</span></h3>
          <div class="chip-list">${flagChips.map((x) =>
        `<span class="md-chip md-${x.cls}" title="${escAttr(x.tip)}">${x.label}</span>`).join("")}</div></div>`
      : "";

    const descBlock = (title, text) => text
      ? `<div class="reader-block"><h3>${title}</h3><p class="md-desc">${esc(text)}</p></div>`
      : "";
    const descLoading = !rec
      ? `<div class="reader-block"><h3>Опис виробу</h3><p class="muted">Завантажую опис…</p></div>` : "";

    const sibsHtml = sibs.length
      ? `<div class="reader-block"><h3>Споріднені коди групи «${esc(group.label)}» <span class="src">спільний початок назви</span></h3>
          <div class="chip-list">${sibs.slice(0, 60).map((s) =>
        `<button class="subchip" data-goto="${s[C.CODE]}"><b>${s[C.CODE]}</b> ${esc(trim(nameOf(s), 90))}</button>`).join("")}
          ${sibs.length > 60 ? `<span class="muted">…та ще ${nf(sibs.length - 60)}</span>` : ""}</div></div>`
      : "";

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code">${e[C.CODE]}</div>
        <div class="reader-level">Медичний виріб</div>
        <button class="copy-btn" type="button" data-copy="${escAttr(e[C.CODE] + " — " + primary)}" title="Скопіювати код і назву">⧉ Копіювати</button>
      </div>
      <h2 class="reader-name">${esc(primary)}</h2>
      ${secondary ? `<div class="md-secname" title="${LANG === "en" ? "Українська назва" : "Назва за номенклатурою GMDN"}">${esc(secondary)}</div>` : ""}
      <div class="reader-crumbs">${crumbs.join('<span class="sep">›</span>')}</div>
      ${flagsHtml}
      ${rec ? descBlock(descPrimaryTitle, descPrimary) + descBlock(descSecondaryTitle, descSecondary) : descLoading}
      ${sibsHtml}
      ${xwalkBlock(e)}
      ${renderLinks(e)}
      <div class="reader-foot">НК 024:2023 · GMDN · наказ Мінекономіки від 24.05.2023 № 4139${l ? " · літера " + esc(l.letter) : ""}</div>`;
    setTab("reader");
  }

  /** Ймовірні відповідники в НК 031 (EMDN) — обчислені за подібністю назв. */
  function xwalkBlock(e) {
    const map = XW.get(e[C.LET]);
    const head = `<h3>Ймовірні відповідники в НК 031 (EMDN)
        <span class="src">за подібністю назв — не офіційне зіставлення</span></h3>`;
    if (!map) {
      return `<div class="reader-block">${head}<p class="muted">Шукаю відповідники…</p></div>`;
    }
    const matches = map[e[C.CODE]];
    const q = encodeURIComponent(e[C.UA].split(/[,(]/)[0].trim().toLowerCase().slice(0, 50));
    if (!matches || !matches.length) {
      return `<div class="reader-block">${head}
        <p class="muted">Схожих назв у НК 031 не знайдено: номенклатури побудовані по-різному,
           а офіційної таблиці переходу GMDN ↔ EMDN не існує.</p>
        <a class="xlink" href="nk031.html?q=${q}${backTail(e[C.CODE])}">
          <span class="xico">🧾</span>Пошукати в НК 031 вручну</a></div>`;
    }
    const rows = matches.map(([code, score, name]) => `
      <a class="em-xw" href="nk031.html?code=${encodeURIComponent(code)}${backTail(e[C.CODE])}">
        <span class="em-xw-score ${score >= 0.7 ? "hi" : score >= 0.5 ? "mid" : "low"}"
              title="Оцінка подібності назв: ${Math.round(score * 100)} %">${Math.round(score * 100)}%</span>
        <span class="em-xw-code code">${esc(code)}</span>
        <span class="em-xw-name">${esc(name)}</span></a>`).join("");
    return `<div class="reader-block">${head}<div class="em-xw-list">${rows}</div>
      <p class="casc-note">НК 031:2024 (адаптований EMDN) чинний з 01.09.2025 паралельно з
         НК 024:2023 — жоден із них не скасовано, обидва названо в пункті 9 постанови 1808.
         Офіційного зіставлення між ними немає (MDCG 2021-12), тож відповідники обчислено за
         подібністю українських назв і вони потребують перевірки експертом.</p></div>`;
  }

  function renderLinks(e) {
    const code = encodeURIComponent(e[C.CODE]);
    const name = encodeURIComponent(e[C.UA].split(/[,(]/)[0].trim().slice(0, 50));
    const items = [
      ["🧾", "Номенклатура НК 031", `nk031.html?q=${name}${backTail(e[C.CODE])}`],
      ["📦", "Пакети ПМГ-2026", `../pakety/index.html?q=${name}`],
      ["📜", "Постанова 1808", `../postanova/index.html?q=${code}`],
      ["📄", "Роз'яснення НСЗУ", `../rozjasnennya/index.html?q=${name}`],
      ["🏥", "Стандарти ДЕЦ МОЗ", `../dec/index.html?q=${name}`],
      ["🔬", "Інтервенції НК 026", `nk026.html?q=${name}`],
      ["🧪", "LOINC (лаб. коди)", `loinc.html?q=${name}`],
    ];
    return `<div class="reader-block">
      <h3>Переходи до пов'язаних розділів <span class="src">пошук за назвою виробу</span></h3>
      <div class="link-grid">${items.map(([i, t, h]) =>
      `<a class="xlink" href="${h}"><span class="xico">${i}</span>${t}</a>`).join("")}</div>
      <p class="casc-note">Класифікатор медичних виробів не має власної прив'язки до пакетів:
         у Таблиці співставлення пакети закріплено за кодами НК&nbsp;025 і НК&nbsp;026.
         НК&nbsp;024 застосовується разом з ними — за пунктом&nbsp;9 постанови&nbsp;1808.</p>
    </div>`;
  }

  el.reader.addEventListener("click", (ev) => {
    const goto = ev.target.closest("[data-goto]");
    if (goto) { const c = goto.dataset.goto; openCode(c); syncCascade(c); return; }
    const cp = ev.target.closest("[data-copy]");
    if (cp) {
      navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy);
      cp.textContent = "✓ Скопійовано"; setTimeout(() => (cp.textContent = "⧉ Копіювати"), 1400);
    }
  });

  // ══════════════════════════════════════════════════════════
  // Мова
  // ══════════════════════════════════════════════════════════
  function setLang(lang) {
    if (lang !== "ua" && lang !== "en") return;
    LANG = lang;
    localStorage.setItem("nk024Lang", lang);
    syncLangButtons();
    if (!ready) return;
    const activeRow = $(".rrow.active");
    const activeCode = activeRow ? activeRow.dataset.code : null;
    refilter();
    if (el.selGroup.value) fillCodes(+el.selLetter.value, el.selGroup.value);
    if (openedCode) openCode(openedCode);
    if (activeCode) {
      const nr = el.results.querySelector(`.rrow[data-code="${activeCode}"]`);
      if (nr) nr.classList.add("active");
    }
  }

  function syncLangButtons() {
    $$(".md-lang").forEach((b) => b.classList.toggle("active", b.dataset.lang === LANG));
    document.documentElement.setAttribute("data-nk024-lang", LANG);
  }

  // ══════════════════════════════════════════════════════════
  // Допоміжне
  // ══════════════════════════════════════════════════════════
  function resetForm() {
    el.search.value = ""; el.flagFilter.value = "";
    el.batch.value = ""; lastBatchFound = []; el.batchCopy.hidden = true;
    el.selLetter.value = "";
    resetSel(el.selGroup, "оберіть літеру");
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
