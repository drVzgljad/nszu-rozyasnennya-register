/* ============================================================
   Табелі оснащення закладів охорони здоров'я — фронтенд розділу.
   Реєстр наказів МОЗ + повні табелі там, де є офіційний текст.
   Каскад (Наказ → Профіль підрозділу → Позиція), пошук по всіх
   документах одразу, картка профілю з копіюванням табеля.
   Vanilla JS. Дані: data/tabel/registry.json + data/tabel/doc_<id>.json.
   Запис позиції: [id, назва, кількості[], табель, розділ, підрозділ, статус]
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    return nf(n) + " " + (a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many);
  }
  const positions = (n) => plural(n, "позиція", "позиції", "позицій");
  const BACK_PAGE = "/classifiers/tabel.html";
  const backTail = (doc, id) =>
    "&back=" + encodeURIComponent(`${BACK_PAGE}?doc=${doc}&item=${id}`) +
    "&backLabel=" + encodeURIComponent("до табеля оснащення");

  const C = { ID: 0, NAME: 1, QTY: 2, TBL: 3, SEC: 4, SUB: 5, ST: 6, NOTE: 7 };

  // Версія даних = версія самого скрипта: інакше після перезбирання табелів
  // браузер віддає старий registry.json із кешу.
  const V = (document.currentScript && (document.currentScript.src.split("?v=")[1] || "")) || "";
  const dataUrl = (name, ver) => "data/tabel/" + name + (ver ? "?v=" + encodeURIComponent(ver) : "");

  let REG = null;
  const DOCS = new Map();          // id → запис реєстру
  const LOADED = new Map();        // id → {items, byId, bySec, txt}
  let curDoc = null;               // активний документ (id)
  let opened = null;               // {type:'item'|'section'|'registry', …}
  let lastBatchFound = [];

  const el = {
    stats: $("#tbStats"), search: $("#tbSearch"), count: $("#tbCount"),
    clear: $("#tbClear"), results: $("#tbResults"), reader: $("#tbReader"),
    layout: $(".nk-layout"), hideExcluded: $("#hideExcluded"), searchAll: $("#searchAll"),
    selDoc: $("#selDoc"), selSection: $("#selSection"), selItem: $("#selItem"),
    batch: $("#tbBatch"), batchRun: $("#tbBatchRun"),
    batchCopy: $("#tbBatchCopy"), batchClear: $("#tbBatchClear"),
  };

  // ══════════════════════════════════════════════════════════
  async function boot() {
    try {
      REG = await fetch(dataUrl("registry.json", V)).then((r) => r.json());
    } catch (e) {
      el.count.textContent = "Не вдалося завантажити реєстр табелів.";
      return;
    }
    REG.docs.forEach((d) => DOCS.set(d.id, d));
    renderStats();
    populateDocs();
    wireUI();
    showRegistry();

    const q = new URLSearchParams(location.search);
    const doc = (q.get("doc") || "").trim();
    const item = (q.get("item") || "").trim();
    const text = (q.get("q") || "").trim();
    if (doc && DOCS.has(doc) && DOCS.get(doc).has_text) {
      await selectDoc(doc);
      if (item) { openItem(item); syncCascade(item); return; }
    }
    if (text) { el.search.value = text; runSearch(); }
    else el.count.textContent = idleCount();
  }

  const withText = () => REG.docs.filter((d) => d.has_text);
  const totalItems = () => withText().reduce((n, d) => n + d.total, 0);
  const idleCount = () => positions(totalItems()) + " у " + withText().length +
    " наказах · оберіть табель або введіть запит";

  function renderStats() {
    const secs = withText().reduce((n, d) => n + (d.sections || 0), 0);
    const cards = [
      ["Наказів у реєстрі", REG.docs.length],
      ["Позицій табелів", totalItems()],
      ["Профілів підрозділів", secs],
      ["Пакетів ПМГ з вимогою", ((REG.pmg || {}).packages || []).length],
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

  function populateDocs() {
    const opts = [ph("усі накази — показати реєстр")];
    for (const d of REG.docs) {
      const tail = d.has_text ? ` (${nf(d.total)})` : " · лише реквізити";
      opts.push(`<option value="${d.id}"${d.has_text ? "" : " disabled"}>№ ${d.number} від ${d.date} · ${esc(trim(d.short, 60))}${tail}</option>`);
    }
    el.selDoc.innerHTML = opts.join("");
    el.selDoc.disabled = false;
  }

  /** Профілі одного наказу: optgroup = табель, option = розділ. */
  function fillSections(docId) {
    const d = DOCS.get(docId);
    if (!d || !d.has_text) { resetSel(el.selSection, "оберіть наказ"); return; }
    const parts = [ph("усі профілі наказу")];
    for (const t of d.tables) {
      const label = esc(trim(t.short || t.title, 80));
      parts.push(`<optgroup label="${label}">`);
      for (const s of t.sections) {
        const tail = s.status ? ` · ${s.status}` : ` (${nf(s.count)})`;
        parts.push(`<option value="${escAttr(s.id)}">${esc(trim(s.title, 70))}${tail}</option>`);
      }
      parts.push("</optgroup>");
    }
    el.selSection.innerHTML = parts.join("");
    el.selSection.disabled = false;
  }

  function fillItems(secId) {
    const list = visible(sectionItems(secId));
    const opts = [ph(list.length ? "оберіть позицію" : "немає позицій")];
    for (const e of list) opts.push(`<option value="${escAttr(e[C.ID])}">${esc(trim(e[C.NAME], 100))}</option>`);
    el.selItem.innerHTML = opts.join("");
    el.selItem.disabled = list.length === 0;
  }

  async function selectDoc(docId) {
    curDoc = docId;
    await ensureLoaded(docId);
    fillSections(docId);
    resetSel(el.selItem, "оберіть профіль");
    el.selDoc.value = docId;
    openDocCard(docId);
    showResults(visible(LOADED.get(docId).items), DOCS.get(docId).short);
  }

  function wireCascade() {
    el.selDoc.addEventListener("change", async () => {
      const id = el.selDoc.value;
      if (!id) {
        curDoc = null;
        resetSel(el.selSection, "оберіть наказ");
        resetSel(el.selItem, "оберіть профіль");
        el.results.hidden = true; el.results.innerHTML = "";
        showRegistry();
        el.count.textContent = idleCount();
        return;
      }
      await selectDoc(id);
    });
    el.selSection.addEventListener("change", () => {
      const sec = el.selSection.value;
      if (!sec) {
        resetSel(el.selItem, "оберіть профіль");
        if (curDoc) showResults(visible(LOADED.get(curDoc).items), DOCS.get(curDoc).short);
        return;
      }
      fillItems(sec);
      openSection(curDoc, sec);
    });
    el.selItem.addEventListener("change", () => {
      if (el.selItem.value) openItem(el.selItem.value);
    });
  }

  // ══════════════════════════════════════════════════════════
  // Дані документів
  // ══════════════════════════════════════════════════════════
  async function ensureLoaded(docId) {
    if (LOADED.has(docId)) return LOADED.get(docId);
    const d = DOCS.get(docId);
    el.count.textContent = "Завантажую табель…";
    const items = await fetch(dataUrl(d.file, REG.generated)).then((r) => r.json());
    const byId = new Map(), bySec = new Map();
    const txt = items.map((e) => e[C.NAME].toLowerCase());
    items.forEach((e) => {
      byId.set(e[C.ID], e);
      const b = bySec.get(e[C.SEC]);
      if (b) b.push(e); else bySec.set(e[C.SEC], [e]);
    });
    const rec = { items, byId, bySec, txt };
    LOADED.set(docId, rec);
    return rec;
  }

  /** Для пошуку по всіх документах одразу — довантажуємо решту (файли невеликі). */
  async function loadAll() {
    await Promise.all(withText().map((d) => ensureLoaded(d.id)));
  }

  const docOf = (id) => id.split("-")[0];
  const itemById = (id) => (LOADED.get(docOf(id)) || {}).byId?.get(id);
  const sectionItems = (secId, docId = curDoc) => (LOADED.get(docId) || {}).bySec?.get(secId) || [];

  function sectionMeta(docId, secId) {
    const d = DOCS.get(docId);
    for (const t of d.tables || []) {
      const s = (t.sections || []).find((x) => x.id === secId);
      if (s) return { sec: s, tbl: t };
    }
    return { sec: null, tbl: null };
  }

  const visible = (list) => el.hideExcluded.checked ? list.filter((e) => !e[C.ST]) : list;

  // ══════════════════════════════════════════════════════════
  // Пошук
  // ══════════════════════════════════════════════════════════
  let searchTimer = null;
  function wireUI() {
    wireCascade();
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 150);
    });
    el.searchAll.addEventListener("change", runSearch);
    el.hideExcluded.addEventListener("change", refilter);
    el.clear.addEventListener("click", resetForm);
    el.batchRun.addEventListener("click", async () => {
      const terms = splitTerms(el.batch.value);
      if (!terms.length) { el.count.textContent = "Введіть назви у поле пакетного пошуку."; return; }
      el.search.value = "";
      await scope();
      runBatch(terms);
    });
    el.batch.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") { ev.preventDefault(); el.batchRun.click(); }
    });
    el.batchClear.addEventListener("click", () => {
      el.batch.value = ""; el.batchCopy.hidden = true; lastBatchFound = [];
      el.results.hidden = true; el.results.innerHTML = "";
      el.count.textContent = idleCount();
    });
    el.batchCopy.addEventListener("click", () => {
      copy(lastBatchFound.map((r) => `${r.name}\t${r.qty}\t${r.where}`).join("\n"),
        el.batchCopy, "⧉ Копіювати знайдене", "✓ Скопійовано (" + lastBatchFound.length + ")");
    });
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
  }

  /** Набір документів для пошуку: усі або лише поточний. */
  async function scope() {
    if (el.searchAll.checked || !curDoc) { await loadAll(); return withText().map((d) => d.id); }
    await ensureLoaded(curDoc);
    return [curDoc];
  }

  function refilter() {
    if (el.search.value.trim() || el.batch.value.trim()) { runSearch(); return; }
    if (el.selSection.value) { fillItems(el.selSection.value); openSection(curDoc, el.selSection.value); }
    else if (curDoc) showResults(visible(LOADED.get(curDoc).items), DOCS.get(curDoc).short);
  }

  async function runSearch() {
    const raw = el.search.value.trim();
    if (!raw) {
      el.results.hidden = true; el.batchCopy.hidden = true; lastBatchFound = [];
      el.count.textContent = idleCount();
      return;
    }
    const ids = await scope();
    const inline = splitTerms(raw);
    if (inline.length > 1) { runBatch(inline); return; }
    el.batchCopy.hidden = true; lastBatchFound = [];

    const q = raw.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (const id of ids) {
      const rec = LOADED.get(id);
      for (let i = 0; i < rec.items.length; i++) {
        const e = rec.items[i];
        if (el.hideExcluded.checked && e[C.ST]) continue;
        const pos = rec.txt[i].indexOf(q);
        let score = 0;
        if (pos === 0) score = 60;
        else if (pos > 0) score = /[\s(«]/.test(rec.txt[i][pos - 1]) ? 45 : 30;
        else if (words.length > 1 && words.every((w) => rec.txt[i].includes(w))) score = 15;
        if (score > 0) out.push([score, e]);
      }
    }
    out.sort((a, b) => b[0] - a[0] || a[1][C.NAME].localeCompare(b[1][C.NAME], "uk"));
    showResults(out.map((x) => x[1]), raw + (ids.length > 1 ? ` · у ${ids.length} наказах` : ""));
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
    const docId = docOf(e[C.ID]);
    const { sec } = sectionMeta(docId, e[C.SEC]);
    const d = DOCS.get(docId);
    const where = `${sec ? trim(sec.title, 42) : ""} · наказ № ${d.number}`;
    return `<button class="rrow" type="button" data-item="${escAttr(e[C.ID])}">
      <span class="tb-qty">${esc(qtyShort(e))}</span>
      <span class="rmain"><span class="tname">${esc(e[C.NAME])}</span>
        <span class="rmeta">${esc(where)}</span></span>
      ${e[C.ST] ? `<span class="tb-out" title="${escAttr(e[C.ST])}">виключено</span>` : ""}
    </button>`;
  }

  function qtyShort(e) {
    const q = (e[C.QTY] || []).filter((x) => x !== "" && x !== "-");
    if (!q.length) return "—";
    return q.length === 1 ? q[0] : q.join(" / ");
  }

  // ── Пакетний пошук ────────────────────────────────────────
  const splitTerms = (raw) =>
    String(raw || "").split(/[,;\n\t]+/).map((s) => s.trim()).filter(Boolean);

  function runBatch(terms) {
    lastBatchFound = [];
    const ids = el.searchAll.checked || !curDoc ? withText().map((d) => d.id) : [curDoc];
    let foundTerms = 0, total = 0;
    const PER = 20;
    const blocks = terms.map((term) => {
      const q = term.toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const m = [];
      for (const id of ids) {
        const rec = LOADED.get(id);
        if (!rec) continue;
        rec.items.forEach((e, i) => {
          if (el.hideExcluded.checked && e[C.ST]) return;
          if (rec.txt[i].includes(q) || (words.length > 1 && words.every((w) => rec.txt[i].includes(w)))) m.push(e);
        });
      }
      if (m.length) { foundTerms++; total += m.length; }
      m.forEach((e) => {
        const docId = docOf(e[C.ID]);
        const { sec } = sectionMeta(docId, e[C.SEC]);
        lastBatchFound.push({
          name: e[C.NAME], qty: (e[C.QTY] || []).join(" / "),
          where: `наказ № ${DOCS.get(docId).number}, ${sec ? sec.title : ""}`,
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
  // Права панель: реєстр
  // ══════════════════════════════════════════════════════════
  function showRegistry() {
    opened = { type: "registry" };
    const cards = REG.docs.map((d) => `
      <div class="tb-card${d.has_text ? "" : " tb-card-nodata"}">
        <div class="tb-card-head">
          <span class="tb-card-no">№ ${esc(d.number)}</span>
          <span class="tb-card-date">від ${esc(d.date)}</span>
          <span class="tb-card-kind">${esc(d.kind)}</span>
        </div>
        <div class="tb-card-title">${esc(d.short)}</div>
        <div class="tb-card-profile">${esc(d.profile || "")}</div>
        <div class="tb-card-meta">${esc(d.edition || "")} · ${esc(d.status || "")}</div>
        <div class="tb-card-actions">
          ${d.has_text
            ? `<button class="tb-open" type="button" data-open="${d.id}">Відкрити табель · ${positions(d.total)}</button>`
            : `<span class="tb-nodata">${esc(d.text_note || "Текст не завантажено")}</span>`}
          <a class="tb-src" href="${escAttr(d.url)}" target="_blank" rel="noopener">Офіційне джерело ↗</a>
        </div>
      </div>`).join("");

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code tb-sec">📋</div>
        <div class="reader-level">Реєстр табелів оснащення</div>
      </div>
      <h2 class="reader-name">Накази МОЗ про табелі та примірні табелі</h2>
      <div class="reader-crumbs">
        <span class="crumb">${nf(REG.docs.length)} документів</span>
        <span class="sep">›</span>
        <span class="crumb">з повним текстом — ${nf(withText().length)}</span>
        <span class="sep">›</span>
        <span class="crumb">${positions(totalItems())}</span>
      </div>
      <div class="tb-cards">${cards}</div>
      ${renderPmgBlock()}
      <div class="reader-foot">Реєстр оновлюється разом із розділом; реквізити звірено з офіційними публікаціями.</div>`;
    setTab("reader");
  }

  // ══════════════════════════════════════════════════════════
  // Картка документа
  // ══════════════════════════════════════════════════════════
  function openDocCard(docId) {
    const d = DOCS.get(docId);
    opened = { type: "doc", doc: docId };
    const tables = (d.tables || []).map((t) => `
      <div class="tb-tblblock">
        <h4>${esc(t.short || t.title)}</h4>
        <div class="chip-list">${t.sections.map((s) =>
          `<button class="subchip${s.status ? " subchip-out" : ""}" data-goto-section="${escAttr(s.id)}">
             ${esc(trim(s.title, 60))} <b>${s.status ? "—" : nf(s.count)}</b></button>`).join("")}</div>
      </div>`).join("");
    const amend = (d.amendments || []).length
      ? `<div class="reader-block"><h3>Зміни до наказу</h3><ul class="tb-amend">${
          d.amendments.map((a) => `<li><b>№ ${esc(a.number)}</b> від ${esc(a.date)} — ${esc(a.effect)}</li>`).join("")
        }</ul></div>` : "";

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code tb-sec">№ ${esc(d.number)}</div>
        <div class="reader-level">${esc(d.kind)} · ${esc(d.date)}</div>
        <button class="copy-btn" type="button" data-back-registry>← До реєстру</button>
      </div>
      <h2 class="reader-name">${esc(d.title)}</h2>
      <div class="reader-crumbs">
        <span class="crumb">${esc(d.authority)}</span>
        <span class="sep">›</span><span class="crumb">${esc(d.edition || "")}</span>
        <span class="sep">›</span><span class="crumb">${esc(d.status || "")}</span>
      </div>
      ${d.edition_note ? `<div class="tb-group-note">${esc(d.edition_note)}</div>` : ""}
      <div class="reader-block"><h3>Профілі підрозділів <span class="src">оберіть, щоб побачити табель цілком</span></h3>${tables}</div>
      ${amend}
      <div class="reader-block"><h3>Джерело</h3>
        <div class="link-grid"><a class="xlink" href="${escAttr(d.url)}" target="_blank" rel="noopener">
          <span class="xico">🔗</span>Офіційний текст акта</a></div>
      </div>
      ${renderPmgBlock()}
      <div class="reader-foot">${esc(d.authority)} · наказ № ${esc(d.number)} від ${esc(d.date)}</div>`;
    setTab("reader");
  }

  // ══════════════════════════════════════════════════════════
  // Картка профілю — табель цілком
  // ══════════════════════════════════════════════════════════
  function openSection(docId, secId) {
    const { sec, tbl } = sectionMeta(docId, secId);
    if (!sec) return;
    opened = { type: "section", doc: docId, sec: secId };
    const d = DOCS.get(docId);
    const all = sectionItems(secId, docId);
    const list = visible(all);
    showResults(list, sec.title);

    const labels = sec.qty_labels || ["Кількість"];
    const hasNote = list.some((e) => e[C.NOTE]);
    const head = `<tr><th class="tb-th-name">Найменування</th>${
      labels.map((l) => `<th>${esc(l)}</th>`).join("")}${
      hasNote ? '<th class="tb-th-note">Опис вимоги</th>' : ""}</tr>`;
    let lastSub = null;
    const rows = list.map((e) => {
      const q = e[C.QTY] || [];
      const cells = labels.map((_, i) =>
        `<td>${esc(q[i] !== undefined && q[i] !== "" ? q[i] : (q.length === 1 && i === 0 ? q[0] : "—"))}</td>`).join("");
      let sub = "";
      if (e[C.SUB] && e[C.SUB] !== lastSub) {
        sub = `<tr class="tb-subrow"><td colspan="${labels.length + 1}">${esc(e[C.SUB])}</td></tr>`;
      }
      lastSub = e[C.SUB];
      return sub + `<tr class="${e[C.ST] ? "tb-r-out" : ""}" data-item="${escAttr(e[C.ID])}">
        <td class="tb-td-name">${esc(e[C.NAME])}</td>
        ${e[C.ST] ? `<td colspan="${labels.length}" class="tb-out-cell">${esc(e[C.ST])}</td>` : cells}
        ${hasNote ? `<td class="tb-td-note">${esc(e[C.NOTE] || "")}</td>` : ""}
      </tr>`;
    }).join("");

    const notes = (sec.notes || []).length
      ? `<div class="reader-block"><h3>Зміни до розділу</h3><p class="muted">${esc(compactNotes(sec.notes))}</p></div>` : "";

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code tb-sec">📋</div>
        <div class="reader-level">Профіль · наказ № ${esc(d.number)}</div>
        <button class="copy-btn" type="button" data-copy-section="${escAttr(secId)}">⧉ Копіювати табель</button>
      </div>
      <h2 class="reader-name">${esc(sec.title)}</h2>
      <div class="reader-crumbs">
        <span class="crumb"><a data-back-doc>${esc(trim(d.short, 46))}</a></span>
        ${tbl ? `<span class="sep">›</span><span class="crumb">${esc(trim(tbl.short || tbl.title, 46))}</span>` : ""}
        ${sec.beds ? `<span class="sep">›</span><span class="crumb">норматив на <b>${esc(sec.beds)}</b> місць</span>` : ""}
        <span class="sep">›</span><span class="crumb">${positions(sec.count)}${sec.excluded ? ` · ${nf(sec.excluded)} виключено` : ""}</span>
      </div>
      ${sec.status ? `<div class="tb-status-note">${esc(sec.status === "втратив чинність"
        ? "Розділ втратив чинність — див. зміни нижче."
        : "Усі позиції розділу виключено пізнішими змінами.")}</div>` : ""}
      ${sec.qty_group ? `<div class="tb-group-note">Колонки кількості — за показником «${esc(sec.qty_group)}».</div>` : ""}
      ${list.length ? `<div class="reader-block"><h3>Табель профілю <span class="src">${positions(list.length)}</span></h3>
        <div class="tb-tablewrap"><table class="tb-table">${head}${rows}</table></div></div>` : ""}
      ${notes}
      ${renderPmgBlock()}
      <div class="reader-foot">Наказ МОЗ № ${esc(d.number)} від ${esc(d.date)} · ${esc(sec.title)}</div>`;
    setTab("reader");
  }

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
    const e = itemById(id);
    if (!e) return;
    const docId = docOf(id);
    const d = DOCS.get(docId);
    opened = { type: "item", doc: docId, id };
    const { sec, tbl } = sectionMeta(docId, e[C.SEC]);
    const labels = (sec && sec.qty_labels) || ["Кількість"];
    const q = e[C.QTY] || [];
    const sibs = visible(sectionItems(e[C.SEC], docId)).filter((x) => x !== e);

    const qtyHtml = e[C.ST]
      ? `<div class="tb-status-note">Позицію ${esc(e[C.ST])}.</div>`
      : `<div class="reader-block"><h3>Нормативна кількість${sec && sec.qty_group ? ` <span class="src">за показником «${esc(sec.qty_group)}»</span>` : ""}</h3>
          <div class="tb-qtygrid">${labels.map((l, i) =>
        `<div class="tb-qtycell"><span class="tb-qk">${esc(l)}</span><span class="tb-qv">${esc(q[i] !== undefined && q[i] !== "" ? q[i] : "—")}</span></div>`).join("")}</div>
        </div>`;

    const term = searchTerm(e[C.NAME]);
    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code tb-sec">📌</div>
        <div class="reader-level">Позиція · наказ № ${esc(d.number)}</div>
        <button class="copy-btn" type="button" data-copy="${escAttr(e[C.NAME] + " — " + q.join(" / "))}">⧉ Копіювати</button>
      </div>
      <h2 class="reader-name">${esc(e[C.NAME])}</h2>
      <div class="reader-crumbs">
        <span class="crumb"><a data-back-doc>${esc(trim(d.short, 42))}</a></span>
        <span class="sep">›</span>
        <span class="crumb"><a data-goto-section="${escAttr(e[C.SEC])}">${esc(trim(sec ? sec.title : "", 48))}</a></span>
        ${e[C.SUB] ? `<span class="sep">›</span><span class="crumb">${esc(e[C.SUB])}</span>` : ""}
      </div>
      ${qtyHtml}
      ${e[C.NOTE] ? `<div class="reader-block"><h3>Опис вимоги <span class="src">як у табелі</span></h3>
        <p class="tb-note">${esc(e[C.NOTE])}</p></div>` : ""}
      <div class="reader-block">
        <h3>Що це за виріб <span class="src">пошук у класифікаторі медичних виробів</span></h3>
        <div class="link-grid">
          <a class="xlink" href="nk024.html?q=${encodeURIComponent(term)}${backTail(docId, id)}">
            <span class="xico">🩹</span>Знайти в НК 024</a>
          <a class="xlink" href="../pakety/index.html?q=${encodeURIComponent(term)}">
            <span class="xico">📦</span>Пакети ПМГ-2026</a>
          <a class="xlink" href="../dec/index.html?q=${encodeURIComponent(term)}">
            <span class="xico">🏥</span>Стандарти ДЕЦ МОЗ</a>
          <a class="xlink" href="../rozjasnennya/index.html?q=${encodeURIComponent(term)}">
            <span class="xico">📄</span>Роз'яснення НСЗУ</a>
        </div>
        <p class="casc-note">Табелі називають вироби мовою свого року, класифікатор НК 024 —
           мовою GMDN. Тому пошук іде за ключовим словом назви, а не за точним збігом.</p>
      </div>
      ${sibs.length ? `<div class="reader-block"><h3>Інші позиції профілю <span class="src">${nf(sibs.length)}</span></h3>
        <div class="chip-list">${sibs.slice(0, 40).map((x) =>
        `<button class="subchip" data-goto="${escAttr(x[C.ID])}">${esc(trim(x[C.NAME], 70))}</button>`).join("")}
        ${sibs.length > 40 ? `<span class="muted">…та ще ${nf(sibs.length - 40)}</span>` : ""}</div></div>` : ""}
      <div class="reader-foot">Наказ МОЗ № ${esc(d.number)} від ${esc(d.date)}${tbl ? " · " + esc(trim(tbl.short || tbl.title, 60)) : ""}</div>`;
    setTab("reader");
  }

  const searchTerm = (name) => name.split(/[,(]/)[0].trim().split(/\s+/).slice(0, 2).join(" ");

  function renderPmgBlock() {
    const p = REG.pmg || {};
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

  // ══════════════════════════════════════════════════════════
  el.reader.addEventListener("click", async (ev) => {
    const openDoc = ev.target.closest("[data-open]");
    if (openDoc) { await selectDoc(openDoc.dataset.open); return; }
    if (ev.target.closest("[data-back-registry]")) {
      el.selDoc.value = ""; curDoc = null;
      resetSel(el.selSection, "оберіть наказ");
      resetSel(el.selItem, "оберіть профіль");
      el.results.hidden = true;
      showRegistry();
      return;
    }
    if (ev.target.closest("[data-back-doc]")) {
      el.selSection.value = ""; resetSel(el.selItem, "оберіть профіль");
      openDocCard(curDoc);
      showResults(visible(LOADED.get(curDoc).items), DOCS.get(curDoc).short);
      return;
    }
    const gs = ev.target.closest("[data-goto-section]");
    if (gs) {
      el.selSection.value = gs.dataset.gotoSection;
      fillItems(gs.dataset.gotoSection);
      openSection(curDoc, gs.dataset.gotoSection);
      return;
    }
    const goto = ev.target.closest("[data-goto]");
    if (goto) { openItem(goto.dataset.goto); syncCascade(goto.dataset.goto); return; }
    const cs = ev.target.closest("[data-copy-section]");
    if (cs) {
      const secId = cs.dataset.copySection;
      const { sec } = sectionMeta(curDoc, secId);
      const d = DOCS.get(curDoc);
      const labels = (sec && sec.qty_labels) || ["Кількість"];
      const rows = visible(sectionItems(secId)).map((e) =>
        e[C.NAME] + "\t" + (e[C.ST] ? e[C.ST] : (e[C.QTY] || []).join("\t")));
      const text = [`Наказ МОЗ № ${d.number} від ${d.date}. ${sec ? sec.title : ""}`,
        "Найменування\t" + labels.join("\t"), ...rows].join("\n");
      copy(text, cs, "⧉ Копіювати табель", "✓ Скопійовано");
      return;
    }
    const cp = ev.target.closest("[data-copy]");
    if (cp) copy(cp.dataset.copy, cp, "⧉ Копіювати", "✓ Скопійовано");
    const row = ev.target.closest("tr[data-item]");
    if (row) { openItem(row.dataset.item); syncCascade(row.dataset.item); }
  });

  function syncCascade(id) {
    const e = itemById(id);
    if (!e) return;
    const docId = docOf(id);
    if (curDoc !== docId) {
      curDoc = docId;
      el.selDoc.value = docId;
      fillSections(docId);
    }
    el.selSection.value = e[C.SEC];
    fillItems(e[C.SEC]);
    el.selItem.value = id;
  }

  function copy(text, btn, idle, done) {
    navigator.clipboard && navigator.clipboard.writeText(text);
    btn.textContent = done;
    setTimeout(() => (btn.textContent = idle), 1500);
  }

  function resetForm() {
    el.search.value = ""; el.hideExcluded.checked = true; el.searchAll.checked = true;
    el.batch.value = ""; lastBatchFound = []; el.batchCopy.hidden = true;
    el.selDoc.value = ""; curDoc = null;
    resetSel(el.selSection, "оберіть наказ");
    resetSel(el.selItem, "оберіть профіль");
    el.results.hidden = true; el.results.innerHTML = "";
    showRegistry();
    el.count.textContent = idleCount();
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
