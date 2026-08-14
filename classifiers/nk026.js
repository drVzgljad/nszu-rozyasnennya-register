/* ============================================================
   Класифікатор медичних інтервенцій НК 026:2021 (ACHI) — фронтенд.
   Каскад (Розділ → Родина кодів → Код) + миттєвий і пакетний пошук
   + паспорт коду з прив'язками до пакетів ПМГ і наказу № 377.
   Vanilla JS. Дані: data/nk026_meta.json + data/nk026_index.json.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const CODE_RE = /^\d{1,5}(-\d{0,2})?$/;   // повний або частковий код (39721, 39721-0, 39721-00)
  // Друга родина кодів того самого видання — перелік послуг ЕСОЗ (A38003).
  // Без цього патерну запит «A38003» не вважався кодом і не знаходився зовсім.
  const ESOZ_RE = /^[A-Z]\d{1,5}$/;
  // У самих даних два коди набрані кириличною «А» (А67007, А67008), тож
  // нормалізуємо і сховище, і запит — інакше їх не знайти жодним набором.
  const HOMOGLYPH = { "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I",
                      "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X" };
  const normEsozCode = (s) => String(s || "").trim().toUpperCase()
    .split("").map((ch) => HOMOGLYPH[ch] || ch).join("");
  const isCodeQuery = (q) => CODE_RE.test(q) || ESOZ_RE.test(q);
  const BACK_PAGE = "/classifiers/nk026.html";
  /** Хвіст для перехресних посилань: щоб на чужій сторінці була кнопка «Назад». */
  function backTail(code) {
    return "&back=" + encodeURIComponent(BACK_PAGE + "?code=" + code) +
      "&backLabel=" + encodeURIComponent("до коду " + code);
  }


  let META = null, INDEX = null, ready = false;
  let SERVICES = null;             // Таблиця співставлення: id → {c, n, p}
  let openedCode = null;           // код, відкритий у паспорті (для перемальовки)
  const byCode = new Map();        // код → запис
  const byChapter = new Map();     // № розділу → [записи] (у порядку переліку)
  const familyOf = new Map();      // корінь → [записи]
  const chapterByNo = new Map();

  const el = {
    stats: $("#ivStats"), search: $("#ivSearch"), count: $("#ivCount"),
    clear: $("#ivClear"), results: $("#ivResults"), reader: $("#ivReader"),
    layout: $(".nk-layout"),
    onlyPmg: $("#onlyPmg"), only377: $("#only377"),
    selChapter: $("#selChapter"), selFamily: $("#selFamily"), selCode: $("#selCode"),
    batch: $("#ivBatch"), batchRun: $("#ivBatchRun"),
    batchCopy: $("#ivBatchCopy"), batchClear: $("#ivBatchClear"),
  };
  let lastBatchFound = [];
  let readerEmptyHTML = "";

  // ══════════════════════════════════════════════════════════
  // Завантаження
  // ══════════════════════════════════════════════════════════
  async function boot() {
    readerEmptyHTML = el.reader.innerHTML;
    try {
      META = await fetch("data/nk026_meta.json").then((r) => r.json());
    } catch (e) {
      el.count.textContent = "Не вдалося завантажити класифікатор.";
      return;
    }
    (META.chapters || []).forEach((c) => chapterByNo.set(c.no, c));
    renderStats();
    populateChapters();
    wireUI();

    fetch("data/nk026_index.json")
      .then((r) => r.json())
      .then((idx) => Promise.resolve(loadEsozServices()).then((extra) => idx.concat(extra)))
      .then((idx) => { INDEX = idx; buildMaps(); ready = true; onReady(); })
      .catch(() => { el.count.textContent = "Індекс пошуку недоступний."; })
      .then(loadServices);
  }

  /** Перелік послуг ЕСОЗ із того самого видання НК 026 — коди виду A38003.
      Документи НСЗУ посилаються на них як «код за НК_26», але в
      nk026_index.json їх немає: білдер відсипає їх окремо в esoz_names.json.
      Тому пошук за таким кодом не давав нічого. Підмішуємо їх в індекс
      із ch: 0 (поза розділами) і прапорцем es. */
  function loadEsozServices() {
    return fetch("data/esoz_names.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((map) => Object.entries(map || {}).map(([c, n]) =>
        ({ c: normEsozCode(c), n: String(n), ch: 0, es: 1 })))
      .catch(() => []);
  }

  /** Назви медичних послуг для паспорта — вантажимо після основного індексу. */
  function loadServices() {
    fetch("../mapping/data/services_lite.json")
      .then((r) => r.json())
      .then((list) => {
        SERVICES = list;
        // паспорт міг відкритися з глибокого лінку раніше, ніж доїхав цей файл
        if (openedCode) openCode(openedCode);
      })
      .catch(() => { SERVICES = null; });
  }

  function buildMaps() {
    for (const e of INDEX) {
      byCode.set(e.c, e);
      // Послуги ЕСОЗ не мають ні розділу, ні родини «корінь-**» — у каскад
      // і в перелік споріднених кодів вони не потрапляють.
      if (e.es) continue;
      const ch = byChapter.get(e.ch);
      if (ch) ch.push(e); else byChapter.set(e.ch, [e]);
      const root = e.c.split("-")[0];
      const fam = familyOf.get(root);
      if (fam) fam.push(e); else familyOf.set(root, [e]);
    }
  }

  function onReady() {
    el.count.textContent = nf(INDEX.length) + " кодів · оберіть розділ або введіть запит";
    if (el.selChapter.value) fillFamilies(+el.selChapter.value);
    const q = new URLSearchParams(location.search);
    const raw = (q.get("code") || q.get("q") || "").trim();
    if (!raw) return;
    const code = normEsozCode(raw.replace(/\s+/g, ""));
    if (byCode.has(code)) { openCode(code); syncCascade(code); }
    else { el.search.value = raw; runSearch(); }
  }

  // ══════════════════════════════════════════════════════════
  // Статистика
  // ══════════════════════════════════════════════════════════
  function renderStats() {
    const cards = [
      ["Розділів", (META.chapters || []).length],
      ["Родин кодів", META.families || 0],
      ["У пакетах ПМГ", META.with_pmg || 0],
      ["Усього кодів", META.total || 0],
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

  function populateChapters() {
    const opts = [ph("оберіть розділ")];
    for (const c of META.chapters || []) {
      opts.push(`<option value="${c.no}">Розділ ${c.no} · ${esc(c.title)} (${nf(c.count)})</option>`);
    }
    el.selChapter.innerHTML = opts.join("");
    el.selChapter.disabled = false;
  }

  /** Родини (спільний 5-значний корінь) у межах розділу, у порядку переліку. */
  function familiesOfChapter(no) {
    const seen = new Map();
    for (const e of byChapter.get(no) || []) {
      const root = e.c.split("-")[0];
      const bucket = seen.get(root);
      if (bucket) bucket.push(e); else seen.set(root, [e]);
    }
    return Array.from(seen, ([root, list]) => ({ root, list }));
  }

  function fillFamilies(no) {
    if (!ready) { el.selFamily.innerHTML = ph("індекс вантажиться…"); el.selFamily.disabled = true; return; }
    const fams = familiesOfChapter(no);
    const opts = [ph(fams.length ? "оберіть родину кодів" : "немає кодів")];
    for (const f of fams) {
      const label = f.list.length > 1 ? `${f.root}-** · ${f.list[0].n} (${f.list.length})` : `${f.list[0].c} · ${f.list[0].n}`;
      opts.push(`<option value="${f.root}">${esc(trim(label, 110))}</option>`);
    }
    el.selFamily.innerHTML = opts.join("");
    el.selFamily.disabled = fams.length === 0;
  }

  /** Коди родини, обмежені поточним розділом (той самий корінь може траплятися в кількох розділах). */
  function familyCodes(root, chapterNo) {
    let list = familyOf.get(root) || [];
    if (chapterNo) list = list.filter((e) => e.ch === chapterNo);
    return list;
  }

  function fillCodes(root, chapterNo) {
    const list = familyCodes(root, chapterNo);
    const opts = [ph(list.length ? "оберіть код" : "немає кодів")];
    for (const e of list) opts.push(`<option value="${e.c}">${e.c} · ${esc(trim(e.n, 100))}${e.pk ? " ●ПМГ" : ""}</option>`);
    el.selCode.innerHTML = opts.join("");
    el.selCode.disabled = list.length === 0;
  }

  function wireCascade() {
    el.selChapter.addEventListener("change", () => {
      resetSel(el.selCode, "оберіть родину");
      const no = +el.selChapter.value;
      if (!no) { resetSel(el.selFamily, "оберіть розділ"); showResults([], "розділ не обрано"); return; }
      fillFamilies(no);
      listChapter(no);
    });
    el.selFamily.addEventListener("change", () => {
      const root = el.selFamily.value, no = +el.selChapter.value;
      if (!root) { resetSel(el.selCode, "оберіть родину"); if (no) listChapter(no); return; }
      fillCodes(root, no);
      const list = familyCodes(root, no);
      showResults(list, `родина ${root}-**`);
      if (list.length === 1) { el.selCode.value = list[0].c; openCode(list[0].c); }
    });
    el.selCode.addEventListener("change", () => {
      if (el.selCode.value) openCode(el.selCode.value);
    });
  }

  function listChapter(no) {
    const list = byChapter.get(no) || [];
    showResults(applyFilters(list), `розділ ${no}`);
  }

  /** Показати каскадний вибір для коду (з пошуку або глибокого лінку). */
  function syncCascade(code) {
    if (!ready) return;
    const e = byCode.get(code); if (!e) return;
    el.selChapter.value = String(e.ch);
    fillFamilies(e.ch);
    const root = e.c.split("-")[0];
    el.selFamily.value = root;
    fillCodes(root, e.ch);
    el.selCode.value = e.c;
  }

  // ══════════════════════════════════════════════════════════
  // Пошук
  // ══════════════════════════════════════════════════════════
  function applyFilters(list) {
    if (el.onlyPmg.checked) list = list.filter((e) => e.pk);
    if (el.only377.checked) list = list.filter((e) => e.o3);
    return list;
  }

  let searchTimer = null;
  function wireUI() {
    wireCascade();
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 130);
    });
    el.onlyPmg.addEventListener("change", refilter);
    el.only377.addEventListener("change", refilter);
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
      el.count.textContent = ready ? nf(INDEX.length) + " кодів · оберіть розділ або введіть запит" : "Завантаження…";
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

  /** Перезастосувати фільтри до поточного виду (пошук / перелік розділу). */
  function refilter() {
    if (el.search.value.trim() || el.batch.value.trim()) { runSearch(); return; }
    if (el.selFamily.value) {
      const list = familyCodes(el.selFamily.value, +el.selChapter.value);
      showResults(applyFilters(list), `родина ${el.selFamily.value}-**`);
    } else if (el.selChapter.value) {
      listChapter(+el.selChapter.value);
    } else {
      runSearch();
    }
  }

  function runSearch() {
    const raw = el.search.value.trim();
    const filtering = el.onlyPmg.checked || el.only377.checked;
    if (!raw && !filtering) {
      el.results.hidden = true; el.batchCopy.hidden = true; lastBatchFound = [];
      if (ready) el.count.textContent = nf(INDEX.length) + " кодів · оберіть розділ або введіть запит";
      return;
    }
    if (!ready) { el.count.textContent = "Індекс ще вантажиться…"; return; }

    const inline = splitTerms(raw);
    if (inline.length > 1) { runBatch(inline); return; }
    el.batchCopy.hidden = true; lastBatchFound = [];

    const q = raw.toLowerCase();
    const qCode = normEsozCode(raw.replace(/\s+/g, ""));
    const looksCode = isCodeQuery(qCode);
    const out = [];
    for (const e of applyFilters(INDEX)) {
      let score = 0;
      if (!raw) score = 10;
      else if (looksCode) {
        if (e.c === qCode) score = 100;
        else if (e.c.startsWith(qCode)) score = 70;
        else if (e.n.toLowerCase().includes(q)) score = 20;
      } else {
        const nl = e.n.toLowerCase();
        if (nl.startsWith(q)) score = 60;
        else if (nl.includes(" " + q)) score = 45;
        else if (nl.includes(q)) score = 30;
      }
      if (score > 0) out.push([score, e]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1].c.localeCompare(b[1].c, "en"));
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
    const ch = chapterByNo.get(e.ch);
    // Послуги ЕСОЗ розділу не мають — інакше в рядку світився б «Розділ 0».
    const meta = e.es
      ? "Перелік послуг ЕСОЗ"
      : `Розділ ${e.ch}${ch ? " · " + esc(trim(ch.title, 46)) : ""}`;
    return `<button class="rrow" type="button" data-code="${e.c}">
      <span class="tcode code">${e.c}</span>
      <span class="rmain"><span class="tname">${esc(e.n)}</span>
        <span class="rmeta">${meta}</span></span>
      ${e.pk ? `<span class="pk-dot" title="Код у переліках пакетів ПМГ (${e.pk.length})">ПМГ</span>` : ""}
      ${e.o3 ? `<span class="pk-dot o377" title="Код згадано в наказі № 377">377</span>` : ""}
    </button>`;
  }

  // ── Пакетний пошук ────────────────────────────────────────
  function splitTerms(raw) {
    const parts = String(raw || "").split(/[,;\n\t]+/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const toks = p.split(/\s+/);
      const allCode = toks.length > 1 && toks.every((t) => isCodeQuery(normEsozCode(t)));
      if (allCode) out.push(...toks); else out.push(p);
    }
    return out;
  }

  function matchTerm(term) {
    const qCode = normEsozCode(term.replace(/\s+/g, ""));
    let matches;
    if (isCodeQuery(qCode)) {
      const exact = byCode.get(qCode);
      matches = exact ? [exact] : INDEX.filter((e) => e.c.startsWith(qCode));
    } else {
      const q = term.toLowerCase();
      matches = INDEX.filter((e) => e.n.toLowerCase().includes(q));
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
      m.forEach((e) => lastBatchFound.push({ code: e.c, name: e.n }));
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
  // Паспорт коду
  // ══════════════════════════════════════════════════════════
  function openCode(code) {
    const e = byCode.get(code);
    if (!e) return;
    openedCode = code;

    // Послуга ЕСОЗ: ні розділу, ні родини — свій, простіший паспорт.
    if (e.es) {
      el.reader.classList.remove("reader-empty");
      el.reader.innerHTML = `
        <div class="reader-head">
          <div class="reader-code">${esc(e.c)}</div>
          <div class="reader-level">Послуга ЕСОЗ</div>
          <button class="copy-btn" type="button" data-copy="${escAttr(e.c + " — " + e.n)}" title="Скопіювати код і назву">⧉ Копіювати</button>
        </div>
        <h2 class="reader-name">${esc(e.n)}</h2>
        <div class="reader-block">
          <p class="muted">Код із переліку послуг ЕСОЗ, наведеного в тому самому виданні
             НК 026:2021. Документи НСЗУ посилаються на такі коди як «код за НК_26».
             Це не код медичної інтервенції: розділу, родини та прив'язки до наказу № 377
             він не має.</p>
          <p><a class="xlink" href="esoz.html?code=${encodeURIComponent(e.c)}">
             Відкрити картку у довіднику кодів ЕСОЗ →</a></p>
        </div>
        <div class="reader-foot">НК 026:2021 · перелік послуг ЕСОЗ</div>`;
      setTab("reader");
      return;
    }

    const ch = chapterByNo.get(e.ch);
    const root = e.c.split("-")[0];
    const sibs = familyCodes(root, e.ch).filter((s) => s.c !== e.c);

    const crumbs = [];
    if (ch) crumbs.push(`<span class="crumb"><b>Розділ ${ch.no}</b> ${esc(ch.title)}</span>`);
    crumbs.push(`<span class="crumb">Родина <em>${root}-**</em> · ${familyCodes(root, e.ch).length} код(ів)</span>`);

    const sibsHtml = sibs.length
      ? `<div class="reader-block"><h3>Споріднені коди родини ${root}-** <span class="src">той самий корінь</span></h3>
          <div class="chip-list">${sibs.map((s) =>
        `<button class="subchip" data-goto="${s.c}"><b>${s.c}</b> ${esc(s.n)}</button>`).join("")}</div></div>`
      : "";

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code">${e.c}</div>
        <div class="reader-level">Медична інтервенція</div>
        <button class="copy-btn" type="button" data-copy="${escAttr(e.c + " — " + e.n)}" title="Скопіювати код і назву">⧉ Копіювати</button>
      </div>
      <h2 class="reader-name">${esc(e.n)}</h2>
      <div class="reader-crumbs">${crumbs.join('<span class="sep">›</span>')}</div>
      ${renderPmg(e)}
      ${renderServices(e)}
      ${render377(e)}
      ${sibsHtml}
      ${renderLinks(e)}
      <div class="reader-foot">НК 026:2021 · ACHI · розділ ${e.ch}${ch ? " · " + esc(ch.title) : ""}</div>`;
    setTab("reader");
  }

  function renderPmg(e) {
    if (!e.pk) {
      return `<div class="reader-block pmg-none">
        <h3>Пакети ПМГ</h3>
        <p class="muted">У Таблиці співставлення 2026 цей код не закріплено за жодним пакетом.
           Це не виключає застосування коду в межах пакета — перевірте умови пакета та специфікацію.</p></div>`;
    }
    const chips = e.pk.map((n) => {
      const title = (META.packages || {})[n] || "";
      return `<a class="pk-pkg" href="../passport/index.html?package=${encodeURIComponent(n)}${backTail(e.c)}"
                 title="${escAttr(title || "Відкрити пакет № " + n)}">Пакет № ${n}${title ? " · " + esc(trim(title, 44)) : ""}</a>`;
    }).join("");
    return `<div class="reader-block pmg-yes">
      <h3>Пакети ПМГ <span class="src">за Таблицею співставлення 2026</span></h3>
      <div class="chip-list">${chips}</div>
    </div>`;
  }

  /** Медичні послуги з Таблиці співставлення, у яких згадано цей код. */
  function renderServices(e) {
    if (!e.sv || !e.sv.length || !SERVICES) return "";
    const rows = e.sv.map((id) => {
      const s = SERVICES[id];
      if (!s) return "";
      return `<a class="svc-row" href="../mapping/index.html?service=${id}${backTail(e.c)}"
                 title="Відкрити в Таблиці співставлення">
        <b>${esc(s.c || "—")}</b><span class="svc-name">${esc(s.n)}${coefTag(s)}</span>
        <span class="svc-pkgs">${s.p.map((p) => "пакет " + p).join(", ")}</span></a>`;
    }).join("");
    return `<div class="reader-block svc-block">
      <h3>Медичні послуги <span class="src">за Таблицею співставлення</span></h3>
      <div class="svc-list">${rows}</div>
    </div>`;
  }

  /** Ваговий коефіцієнт ДСГ поруч із назвою послуги (перше значення додатка). */
  function coefTag(s) {
    const first = (s.k || []).find((d) => d.k && d.k.length);
    return first ? ` <span class="svc-coef" title="Ваговий коефіцієнт ДСГ ${escAttr(first.c)} (постанова 1808)">${esc(first.k[0])}</span>` : "";
  }

  function render377(e) {
    if (!e.o3) return "";
    const rows = e.o3.map((r) => {
      const rule = String(r.code || "");
      const href = `../algorithms/index.html?code=${encodeURIComponent(rule)}`;
      return `<li><a class="o377-row" href="${href}"
                 title="${escAttr("Відкрити правило " + (rule || "наказу № 377") + " у розділі «Наказ № 377»")}">
        <b>${esc(rule || "—")}</b> ${esc(trim(r.name, 150))}
        ${(r.pkgs || []).length ? `<span class="o377-pkgs">пакети: ${r.pkgs.map(esc).join(", ")}</span>` : ""}</a></li>`;
    }).join("");
    return `<div class="reader-block o377-block">
      <h3>Наказ № 377 <span class="src">правила та алгоритми, де згадано код</span></h3>
      <ul class="o377-list">${rows}</ul>
      <a class="xlink o377-more" href="../algorithms/index.html?q=${encodeURIComponent(e.c)}">
        <span class="xico">🧮</span>Відкрити в розділі «Наказ № 377»</a>
    </div>`;
  }

  function renderLinks(e) {
    const code = encodeURIComponent(e.c);
    const name = encodeURIComponent(e.n.slice(0, 60));
    const items = [
      ["🧮", "Наказ № 377", `../algorithms/index.html?q=${code}`],
      ["📦", "Пакети ПМГ-2026", `../pakety/index.html?q=${code}`],
      ["📜", "Постанова 1808", `../postanova/index.html?q=${code}`],
      ["🏥", "Стандарти ДЕЦ МОЗ", `../dec/index.html?q=${name}`],
      ["📄", "Роз'яснення НСЗУ", `../rozjasnennya.html?q=${code}`],
      ["🩺", "Хвороби НК 025", `index.html`],
    ];
    return `<div class="reader-block">
      <h3>Переходи до пов'язаних розділів</h3>
      <div class="link-grid">${items.map(([i, t, h]) =>
        `<a class="xlink" href="${h}"><span class="xico">${i}</span>${t}</a>`).join("")}</div>
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
  // Допоміжне
  // ══════════════════════════════════════════════════════════
  function resetForm() {
    el.search.value = ""; el.onlyPmg.checked = false; el.only377.checked = false;
    el.batch.value = ""; lastBatchFound = []; el.batchCopy.hidden = true;
    el.selChapter.value = "";
    resetSel(el.selFamily, "оберіть розділ");
    resetSel(el.selCode, "оберіть родину");
    el.results.hidden = true; el.results.innerHTML = "";
    el.reader.classList.add("reader-empty");
    el.reader.innerHTML = readerEmptyHTML;
    openedCode = null;
    el.count.textContent = ready
      ? nf(INDEX.length) + " кодів · оберіть розділ або введіть запит"
      : "Завантаження…";
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
