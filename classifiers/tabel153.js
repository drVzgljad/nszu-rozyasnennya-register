/* ============================================================
   Табелі оснащення — наказ МОЗ від 05.06.1998 № 153 — фронтенд.
   Каскад (Додаток → Розділ → Позиція), миттєвий і пакетний пошук,
   картка розділу (табель профілю цілком) і картка позиції.
   Vanilla JS. Дані: data/tabel153/tabel153_meta.json + tabel153_index.json.
   Запис: [id, назва, кількості[], № додатка, римський № розділу, підрозділ, статус]
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  /** Українські числові форми: 1 позиція · 2 позиції · 5 позицій. */
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    const word = a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
    return nf(n) + " " + word;
  }
  const positions = (n) => plural(n, "позиція", "позиції", "позицій");
  const BACK_PAGE = "/classifiers/tabel153.html";
  function backTail(id) {
    return "&back=" + encodeURIComponent(BACK_PAGE + "?item=" + id) +
      "&backLabel=" + encodeURIComponent("до табеля оснащення");
  }

  const C = { ID: 0, NAME: 1, QTY: 2, APP: 3, SEC: 4, SUB: 5, ST: 6 };

  let META = null, INDEX = null, ready = false;
  const byId = new Map();
  const byKey = new Map();        // "додаток|розділ" → [позиції]
  const sectionOf = new Map();    // "додаток|розділ" → опис розділу з meta
  let TXT = null;
  let opened = null;              // {type: "item"|"section", ...}
  let lastBatchFound = [];
  let readerEmptyHTML = "";

  const el = {
    stats: $("#tbStats"), search: $("#tbSearch"), count: $("#tbCount"),
    clear: $("#tbClear"), results: $("#tbResults"), reader: $("#tbReader"),
    layout: $(".nk-layout"), hideExcluded: $("#hideExcluded"),
    selApp: $("#selApp"), selSection: $("#selSection"), selItem: $("#selItem"),
    batch: $("#tbBatch"), batchRun: $("#tbBatchRun"),
    batchCopy: $("#tbBatchCopy"), batchClear: $("#tbBatchClear"),
  };

  const key = (app, sec) => app + "|" + sec;

  // ══════════════════════════════════════════════════════════
  async function boot() {
    readerEmptyHTML = el.reader.innerHTML;
    try {
      META = await fetch("data/tabel153/tabel153_meta.json").then((r) => r.json());
    } catch (e) {
      el.count.textContent = "Не вдалося завантажити табелі.";
      return;
    }
    for (const a of META.appendices || []) {
      for (const s of a.sections || []) sectionOf.set(key(a.no, s.roman), Object.assign({ app: a.no }, s));
    }
    renderStats();
    populateApps();
    wireUI();

    fetch("data/tabel153/tabel153_index.json")
      .then((r) => r.json())
      .then((idx) => { INDEX = idx; buildMaps(); ready = true; onReady(); })
      .catch(() => { el.count.textContent = "Перелік позицій недоступний."; });
  }

  function buildMaps() {
    TXT = new Array(INDEX.length);
    for (let i = 0; i < INDEX.length; i++) {
      const e = INDEX[i];
      byId.set(e[C.ID], e);
      const k = key(e[C.APP], e[C.SEC]);
      const b = byKey.get(k);
      if (b) b.push(e); else byKey.set(k, [e]);
      TXT[i] = e[C.NAME].toLowerCase();
    }
  }

  function onReady() {
    el.count.textContent = idleCount();
    const q = new URLSearchParams(location.search);
    const item = (q.get("item") || "").trim();
    const raw = (q.get("q") || "").trim();
    if (item && byId.has(item)) { openItem(item); syncCascade(item); return; }
    if (raw) { el.search.value = raw; runSearch(); }
  }

  const idleCount = () => positions(META.total) + " · оберіть додаток і розділ або введіть запит";

  function renderStats() {
    const secs = (META.appendices || []).reduce((n, a) => n + (a.sections || []).length, 0);
    const cards = [
      ["Позицій табелів", META.total || 0],
      ["Профілів (розділів)", secs],
      ["Виключено змінами", META.excluded || 0],
      ["Пакетів ПМГ з вимогою", ((META.pmg || {}).packages || []).length],
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

  function populateApps() {
    const opts = [ph("оберіть додаток")];
    for (const a of META.appendices || []) {
      const n = (a.sections || []).reduce((s, x) => s + x.count, 0);
      opts.push(`<option value="${a.no}">Додаток ${a.no} · ${esc(shortApp(a))} (${nf(n)})</option>`);
    }
    el.selApp.innerHTML = opts.join("");
    el.selApp.disabled = false;
  }

  /** Коротка назва додатка для випадного списку. */
  function shortApp(a) {
    return a.no === 1 ? "кабінети амбулаторно-поліклінічних закладів"
                      : "стаціонарні відділення лікарень";
  }

  function fillSections(appNo) {
    const a = (META.appendices || []).find((x) => x.no === appNo);
    const list = a ? a.sections : [];
    const opts = [ph(list.length ? "оберіть розділ" : "немає розділів")];
    for (const s of list) {
      const tail = s.status ? ` · ${s.status}` : ` (${nf(s.count)})`;
      opts.push(`<option value="${s.roman}">${s.roman}. ${esc(trim(s.title, 70))}${tail}</option>`);
    }
    el.selSection.innerHTML = opts.join("");
    el.selSection.disabled = list.length === 0;
  }

  function fillItems(appNo, roman) {
    const list = visible(byKey.get(key(appNo, roman)) || []);
    const opts = [ph(list.length ? "оберіть позицію" : "немає позицій")];
    for (const e of list) {
      opts.push(`<option value="${escAttr(e[C.ID])}">${esc(trim(e[C.NAME], 100))}</option>`);
    }
    el.selItem.innerHTML = opts.join("");
    el.selItem.disabled = list.length === 0;
  }

  function wireCascade() {
    el.selApp.addEventListener("change", () => {
      resetSel(el.selItem, "оберіть розділ");
      const no = +el.selApp.value;
      if (!no) { resetSel(el.selSection, "оберіть додаток"); showResults([], "додаток не обрано"); return; }
      fillSections(no);
      showResults(visible(allOfApp(no)), `Додаток ${no}`);
    });
    el.selSection.addEventListener("change", () => {
      const roman = el.selSection.value, no = +el.selApp.value;
      if (!roman) { resetSel(el.selItem, "оберіть розділ"); showResults(visible(allOfApp(no)), `Додаток ${no}`); return; }
      fillItems(no, roman);
      openSection(no, roman);
    });
    el.selItem.addEventListener("change", () => {
      if (el.selItem.value) openItem(el.selItem.value);
    });
  }

  function allOfApp(no) {
    const a = (META.appendices || []).find((x) => x.no === no);
    if (!a) return [];
    return a.sections.flatMap((s) => byKey.get(key(no, s.roman)) || []);
  }

  function syncCascade(id) {
    const e = byId.get(id); if (!e) return;
    el.selApp.value = String(e[C.APP]);
    fillSections(e[C.APP]);
    el.selSection.value = e[C.SEC];
    fillItems(e[C.APP], e[C.SEC]);
    el.selItem.value = id;
  }

  // ══════════════════════════════════════════════════════════
  // Пошук
  // ══════════════════════════════════════════════════════════
  const visible = (list) => el.hideExcluded.checked ? list.filter((e) => !e[C.ST]) : list;

  let searchTimer = null;
  function wireUI() {
    wireCascade();
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 130);
    });
    el.hideExcluded.addEventListener("change", refilter);
    el.clear.addEventListener("click", resetForm);
    el.batchRun.addEventListener("click", () => {
      if (!ready) { el.count.textContent = "Перелік ще вантажиться…"; return; }
      const terms = splitTerms(el.batch.value);
      if (!terms.length) { el.count.textContent = "Введіть назви у поле пакетного пошуку."; return; }
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
      copy(lastBatchFound.map((r) => `${r.name}\t${r.qty}\t${r.where}`).join("\n"), el.batchCopy,
        "⧉ Копіювати знайдене", "✓ Скопійовано (" + lastBatchFound.length + ")");
    });
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
  }

  function refilter() {
    if (el.search.value.trim() || el.batch.value.trim()) { runSearch(); return; }
    if (el.selSection.value) {
      const no = +el.selApp.value, roman = el.selSection.value;
      fillItems(no, roman);
      openSection(no, roman);
    } else if (el.selApp.value) {
      showResults(visible(allOfApp(+el.selApp.value)), `Додаток ${el.selApp.value}`);
    } else {
      runSearch();
    }
  }

  function runSearch() {
    const raw = el.search.value.trim();
    if (!raw) {
      el.results.hidden = true; el.batchCopy.hidden = true; lastBatchFound = [];
      if (ready) el.count.textContent = idleCount();
      return;
    }
    if (!ready) { el.count.textContent = "Перелік ще вантажиться…"; return; }
    const inline = splitTerms(raw);
    if (inline.length > 1) { runBatch(inline); return; }
    el.batchCopy.hidden = true; lastBatchFound = [];

    const q = raw.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < INDEX.length; i++) {
      const e = INDEX[i];
      if (el.hideExcluded.checked && e[C.ST]) continue;
      const pos = TXT[i].indexOf(q);
      let score = 0;
      if (pos === 0) score = 60;
      else if (pos > 0) score = /[\s(«]/.test(TXT[i][pos - 1]) ? 45 : 30;
      else if (words.length > 1 && words.every((w) => TXT[i].includes(w))) score = 15;
      if (score > 0) out.push([score, e]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1][C.NAME].localeCompare(b[1][C.NAME], "uk"));
    showResults(out.map((x) => x[1]), raw);
  }

  const CAP = 400;
  function showResults(list, what) {
    el.count.textContent = list.length
      ? `Знайдено ${nf(list.length)}${list.length > CAP ? " · показано " + CAP : ""}${what ? " · " + what : ""}`
      : "Нічого не знайдено" + (what ? " · " + what : "");
    el.results.innerHTML = list.slice(0, CAP).map(resultRow).join("");
    el.results.hidden = false;
  }

  function resultRow(e) {
    const s = sectionOf.get(key(e[C.APP], e[C.SEC]));
    const where = s ? `Додаток ${e[C.APP]} · ${e[C.SEC]}. ${trim(s.title, 40)}` : `Додаток ${e[C.APP]}`;
    return `<button class="rrow" type="button" data-item="${escAttr(e[C.ID])}">
      <span class="tb-qty">${qtyShort(e, s)}</span>
      <span class="rmain"><span class="tname">${esc(e[C.NAME])}</span>
        <span class="rmeta">${esc(where)}${e[C.SUB] ? " · " + esc(trim(e[C.SUB], 46)) : ""}</span></span>
      ${e[C.ST] ? `<span class="tb-out" title="${escAttr(e[C.ST])}">виключено</span>` : ""}
    </button>`;
  }

  /** Компактна кількість для рядка: одне число або «3 / 4 / 5 / 6» по колонках. */
  function qtyShort(e, s) {
    const q = (e[C.QTY] || []).filter((x) => x !== "");
    if (!q.length) return "—";
    if (q.length === 1) return esc(q[0]);
    return esc(q.join(" / "));
  }

  // ── Пакетний пошук ────────────────────────────────────────
  function splitTerms(raw) {
    return String(raw || "").split(/[,;\n\t]+/).map((s) => s.trim()).filter(Boolean);
  }

  function runBatch(terms) {
    if (!ready) { el.count.textContent = "Перелік ще вантажиться…"; return; }
    lastBatchFound = [];
    let foundTerms = 0, total = 0;
    const PER = 20;
    const blocks = terms.map((term) => {
      const q = term.toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const m = INDEX.filter((e, i) => {
        if (el.hideExcluded.checked && e[C.ST]) return false;
        return TXT[i].includes(q) || (words.length > 1 && words.every((w) => TXT[i].includes(w)));
      });
      if (m.length) { foundTerms++; total += m.length; }
      m.forEach((e) => {
        const s = sectionOf.get(key(e[C.APP], e[C.SEC]));
        lastBatchFound.push({
          name: e[C.NAME], qty: (e[C.QTY] || []).join(" / "),
          where: `Додаток ${e[C.APP]}, розділ ${e[C.SEC]}${s ? " " + s.title : ""}`,
        });
      });
      const head = `<div class="batch-head ${m.length ? "" : "nomatch"}">
          <span>${m.length ? "🔹" : "❌"} ${esc(term)}</span>
          <span class="batch-badge">${m.length ? nf(m.length) + (m.length > PER ? " · показано " + PER : "") : "немає в табелях"}</span>
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
    openItem(b.dataset.item); syncCascade(b.dataset.item); markActive(b);
  });

  // ══════════════════════════════════════════════════════════
  // Картка розділу — табель профілю цілком
  // ══════════════════════════════════════════════════════════
  function openSection(appNo, roman) {
    const s = sectionOf.get(key(appNo, roman));
    if (!s) return;
    opened = { type: "section", app: appNo, roman };
    const all = byKey.get(key(appNo, roman)) || [];
    const list = visible(all);
    showResults(list, `розділ ${roman}. ${trim(s.title, 40)}`);

    const labels = s.qty_labels || ["Кількість"];
    const head = `<tr><th class="tb-th-name">Найменування</th>${
      labels.map((l) => `<th>${esc(l)}</th>`).join("")}</tr>`;
    // підрозділ (лабораторні частини) показуємо окремим заголовком, а не в кожному рядку
    let lastSub = null;
    const rows = list.map((e) => {
      const q = e[C.QTY] || [];
      const cells = labels.map((_, i) => `<td>${esc(q[i] !== undefined ? q[i] : (q.length === 1 && i === 0 ? q[0] : "—"))}</td>`).join("");
      let head = "";
      if (e[C.SUB] && e[C.SUB] !== lastSub) {
        head = `<tr class="tb-subrow"><td colspan="${labels.length + 1}">${esc(e[C.SUB])}</td></tr>`;
      }
      lastSub = e[C.SUB];
      return head + `<tr class="${e[C.ST] ? "tb-r-out" : ""}" data-item="${escAttr(e[C.ID])}">
        <td class="tb-td-name">${esc(e[C.NAME])}</td>
        ${e[C.ST] ? `<td colspan="${labels.length}" class="tb-out-cell">${esc(e[C.ST])}</td>` : cells}
      </tr>`;
    }).join("");

    const notes = (s.notes || []).length
      ? `<div class="reader-block"><h3>Зміни до розділу</h3>
          <p class="muted">${esc(compactNotes(s.notes))}</p></div>` : "";

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code tb-sec">${roman}</div>
        <div class="reader-level">Розділ табеля · Додаток ${appNo}</div>
        <button class="copy-btn" type="button" data-copy-section="${appNo}|${roman}">⧉ Копіювати табель</button>
      </div>
      <h2 class="reader-name">${esc(s.title)}</h2>
      <div class="reader-crumbs">
        <span class="crumb"><b>Додаток ${appNo}</b> ${esc(shortApp({ no: appNo }))}</span>
        ${s.beds ? `<span class="sep">›</span><span class="crumb">норматив на <b>${esc(s.beds)}</b> місць</span>` : ""}
        <span class="sep">›</span><span class="crumb">${positions(s.count)}${s.excluded ? ` · ${nf(s.excluded)} виключено` : ""}</span>
      </div>
      ${s.status ? `<div class="tb-status-note">${esc(s.status === "втратив чинність"
        ? "Розділ втратив чинність — див. зміни нижче."
        : "Усі позиції розділу виключено пізнішими змінами.")}</div>` : ""}
      ${s.qty_group ? `<div class="tb-group-note">Колонки кількості — за показником «${esc(s.qty_group)}».</div>` : ""}
      ${list.length ? `<div class="reader-block"><h3>Табель профілю <span class="src">${positions(list.length)}</span></h3>
        <div class="tb-tablewrap"><table class="tb-table">${head}${rows}</table></div></div>` : ""}
      ${notes}
      ${renderPmgBlock()}
      <div class="reader-foot">Наказ МОЗ від 05.06.1998 № 153 · Додаток ${appNo} · розділ ${roman}</div>`;
    setTab("reader");
  }

  /** «( Пункт 1 виключено … ) · ( Пункт 2 виключено … )» → короткий підсумок. */
  function compactNotes(notes) {
    const text = notes.join(" ");
    const nums = Array.from(text.matchAll(/Пункт (\d+) виключено/g)).map((m) => m[1]);
    const base = text.match(/N (\d+)\s*від ([\d.]+)/);
    if (nums.length > 3 && base) {
      return `Пункти ${nums[0]}–${nums[nums.length - 1]} (усього ${nums.length}) виключено на підставі ` +
        `наказу МОЗ № ${base[1]} від ${base[2]}.`;
    }
    return text.replace(/\s*·\s*/g, " ");
  }

  // ══════════════════════════════════════════════════════════
  // Картка позиції
  // ══════════════════════════════════════════════════════════
  function openItem(id) {
    const e = byId.get(id);
    if (!e) return;
    opened = { type: "item", id };
    const s = sectionOf.get(key(e[C.APP], e[C.SEC])) || {};
    const labels = s.qty_labels || ["Кількість"];
    const q = e[C.QTY] || [];
    const sibs = visible(byKey.get(key(e[C.APP], e[C.SEC])) || []).filter((x) => x !== e);

    const qtyHtml = e[C.ST]
      ? `<div class="tb-status-note">Позицію ${esc(e[C.ST])}.</div>`
      : `<div class="reader-block"><h3>Нормативна кількість${s.qty_group ? ` <span class="src">за показником «${esc(s.qty_group)}»</span>` : ""}</h3>
          <div class="tb-qtygrid">${labels.map((l, i) =>
        `<div class="tb-qtycell"><span class="tb-qk">${esc(l)}</span><span class="tb-qv">${esc(q[i] !== undefined ? q[i] : "—")}</span></div>`).join("")}</div>
        </div>`;

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code tb-sec">${esc(e[C.SEC])}</div>
        <div class="reader-level">Позиція табеля</div>
        <button class="copy-btn" type="button" data-copy="${escAttr(e[C.NAME] + " — " + q.join(" / "))}">⧉ Копіювати</button>
      </div>
      <h2 class="reader-name">${esc(e[C.NAME])}</h2>
      <div class="reader-crumbs">
        <span class="crumb"><b>Додаток ${e[C.APP]}</b> ${esc(shortApp({ no: e[C.APP] }))}</span>
        <span class="sep">›</span>
        <span class="crumb"><a data-goto-section="${e[C.APP]}|${e[C.SEC]}">${esc(e[C.SEC])}. ${esc(s.title || "")}</a>${s.beds ? ` · на ${esc(s.beds)} місць` : ""}</span>
        ${e[C.SUB] ? `<span class="sep">›</span><span class="crumb">${esc(e[C.SUB])}</span>` : ""}
      </div>
      ${qtyHtml}
      <div class="reader-block">
        <h3>Що це за виріб <span class="src">пошук у класифікаторі медичних виробів</span></h3>
        <div class="link-grid">
          <a class="xlink" href="nk024.html?q=${encodeURIComponent(searchTerm(e[C.NAME]))}${backTail(e[C.ID])}">
            <span class="xico">🩹</span>Знайти в НК 024</a>
          <a class="xlink" href="../pakety/index.html?q=${encodeURIComponent(searchTerm(e[C.NAME]))}">
            <span class="xico">📦</span>Пакети ПМГ-2026</a>
          <a class="xlink" href="../dec/index.html?q=${encodeURIComponent(searchTerm(e[C.NAME]))}">
            <span class="xico">🏥</span>Стандарти ДЕЦ МОЗ</a>
          <a class="xlink" href="../rozjasnennya/index.html?q=${encodeURIComponent(searchTerm(e[C.NAME]))}">
            <span class="xico">📄</span>Роз'яснення НСЗУ</a>
        </div>
        <p class="casc-note">Табель називає виріб мовою 1998 року, класифікатор НК 024 —
           мовою GMDN. Тому пошук у НК 024 йде за ключовим словом назви, а не за точним збігом.</p>
      </div>
      ${sibs.length ? `<div class="reader-block"><h3>Інші позиції розділу <span class="src">${nf(sibs.length)}</span></h3>
        <div class="chip-list">${sibs.slice(0, 40).map((x) =>
      `<button class="subchip" data-goto="${escAttr(x[C.ID])}">${esc(trim(x[C.NAME], 70))}</button>`).join("")}
        ${sibs.length > 40 ? `<span class="muted">…та ще ${nf(sibs.length - 40)}</span>` : ""}</div></div>` : ""}
      <div class="reader-foot">Наказ МОЗ від 05.06.1998 № 153 · Додаток ${e[C.APP]} · розділ ${esc(e[C.SEC])}</div>`;
    setTab("reader");
  }

  /** Ключове слово назви для пошуку в інших розділах (перші два слова без уточнень). */
  function searchTerm(name) {
    return name.split(/[,(]/)[0].trim().split(/\s+/).slice(0, 2).join(" ");
  }

  /** Спільний блок: як табель читається у ПМГ. */
  function renderPmgBlock() {
    const p = META.pmg || {};
    const pkgs = (p.packages || []).map((x) =>
      `<a class="pk-pkg" href="../passport/index.html?package=${encodeURIComponent(x.no)}"
          title="${escAttr(x.title)}">Пакет № ${x.no}</a>`).join("");
    return `<div class="reader-block tb-pmg">
      <h3>Як це читає ПМГ <span class="src">вимога специфікацій і договору</span></h3>
      <p class="muted">${esc(p.requirement || "")}</p>
      <p class="muted">${esc(p.contract || "")}</p>
      ${pkgs ? `<div class="chip-list">${pkgs}</div>` : ""}
      <p class="casc-note">${esc(p.caveat || "")}</p>
    </div>`;
  }

  el.reader.addEventListener("click", (ev) => {
    const gs = ev.target.closest("[data-goto-section]");
    if (gs) {
      const [app, roman] = gs.dataset.gotoSection.split("|");
      el.selApp.value = app; fillSections(+app);
      el.selSection.value = roman; fillItems(+app, roman);
      openSection(+app, roman);
      return;
    }
    const goto = ev.target.closest("[data-goto]");
    if (goto) { openItem(goto.dataset.goto); syncCascade(goto.dataset.goto); return; }
    const cs = ev.target.closest("[data-copy-section]");
    if (cs) {
      const [app, roman] = cs.dataset.copySection.split("|");
      const s = sectionOf.get(key(+app, roman)) || {};
      const labels = s.qty_labels || ["Кількість"];
      const rows = visible(byKey.get(key(+app, roman)) || []).map((e) =>
        e[C.NAME] + "\t" + (e[C.ST] ? e[C.ST] : (e[C.QTY] || []).join("\t")));
      const text = [`Наказ МОЗ № 153, Додаток ${app}, розділ ${roman}. ${s.title || ""}`,
        "Найменування\t" + labels.join("\t"), ...rows].join("\n");
      copy(text, cs, "⧉ Копіювати табель", "✓ Скопійовано");
      return;
    }
    const cp = ev.target.closest("[data-copy]");
    if (cp) copy(cp.dataset.copy, cp, "⧉ Копіювати", "✓ Скопійовано");
    const row = ev.target.closest("tr[data-item]");
    if (row) { openItem(row.dataset.item); syncCascade(row.dataset.item); }
  });

  // ══════════════════════════════════════════════════════════
  function copy(text, btn, idle, done) {
    navigator.clipboard && navigator.clipboard.writeText(text);
    btn.textContent = done;
    setTimeout(() => (btn.textContent = idle), 1500);
  }

  function resetForm() {
    el.search.value = ""; el.hideExcluded.checked = true;
    el.batch.value = ""; lastBatchFound = []; el.batchCopy.hidden = true;
    el.selApp.value = "";
    resetSel(el.selSection, "оберіть додаток");
    resetSel(el.selItem, "оберіть розділ");
    el.results.hidden = true; el.results.innerHTML = "";
    el.reader.classList.add("reader-empty");
    el.reader.innerHTML = readerEmptyHTML;
    opened = null;
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
