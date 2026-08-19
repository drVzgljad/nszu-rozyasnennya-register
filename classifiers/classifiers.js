/* ============================================================
   Класифікатор хвороб НК 025:2021 (ICD-10-AM) — фронтенд.
   Каскадна навігація (Клас → Діапазон → Код 1/2/3 порядку)
   + миттєвий текстовий пошук + паспорт коду з прив'язками.
   Vanilla JS. Дані: data/nk025_meta.json + data/nk025_index.json.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
    "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII"];
  const LEVEL_LABEL = { 3: "Код 1-го порядку (рубрика)", 4: "Код 2-го порядку (підрубрика)", 5: "Код 3-го порядку" };
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const BACK_PAGE = "/classifiers/index.html";
  /** Хвіст для перехресних посилань: щоб на чужій сторінці була кнопка «Назад». */
  function backTail(code) {
    return "&back=" + encodeURIComponent(BACK_PAGE + "?code=" + code) +
      "&backLabel=" + encodeURIComponent("до коду " + code);
  }


  let META = null, INDEX = null, indexReady = false;
  // Таблиця співставлення: медичні послуги, у яких згадано код (напряму або через ОДК)
  let SERVICES = null, BY_ICD = null, ODK = null, openedCode = null;
  const odkMembers = new Map();     // id ОДК → Set кодів
  const odkServices = new Map();    // id ОДК → [id послуг]
  const byCode = new Map();          // code → entry
  const childrenOf = new Map();      // parentCode → [entries]
  const l3ByCB = new Map();          // `${classNo}|${blockIdx}` → [l3 entries]
  const classByNo = new Map();

  // ── DOM ────────────────────────────────────────────────────
  const el = {
    stats: $("#nkStats"), search: $("#nkSearch"), onlyPmg: $("#onlyPmg"),
    level: $("#levelFilter"), count: $("#nkCount"), clear: $("#nkClear"),
    results: $("#nkResults"), reader: $("#nkReader"), layout: $(".nk-layout"),
    selClass: $("#selClass"), selBlock: $("#selBlock"),
    selL3: $("#selL3"), selL4: $("#selL4"), selL5: $("#selL5"),
    batch: $("#nkBatch"), batchRun: $("#nkBatchRun"),
    batchCopy: $("#nkBatchCopy"), batchClear: $("#nkBatchClear"),
  };
  let lastBatchFound = [];   // [{term, code, name}] для «Копіювати знайдене»
  let lastShown = [];   // поточний вид результатів: [{t: термін|null, e: запис}] — для експорту
  let exportWhat = "";  // підпис поточного виду (запит/фільтр) — йде в імʼя файлу
  let readerEmptyHTML = "";  // початковий вміст паспорта (для «Очистити форму»)

  // ══════════════════════════════════════════════════════════
  // Завантаження
  // ══════════════════════════════════════════════════════════
  async function boot() {
    readerEmptyHTML = el.reader.innerHTML;
    try {
      META = await fetch("data/nk025_meta.json").then((r) => r.json());
    } catch (e) {
      el.count.textContent = "Не вдалося завантажити класифікатор.";
      return;
    }
    META.classes.forEach((c) => classByNo.set(c.no, c));
    renderStats();
    populateClasses();
    wireUI();

    fetch("data/nk025_index.json")
      .then((r) => r.json())
      .then((idx) => { INDEX = idx; buildMaps(); indexReady = true; onIndexReady(); })
      .catch(() => { el.count.textContent = "Індекс пошуку недоступний."; })
      // Таблиця співставлення — ПІСЛЯ основного індексу: паралельно з ним три
      // додаткові файли створюють зайву конкуренцію за з'єднання, а паспорт без
      // них цілком робочий.
      .then(loadMapping);
  }

  /** Таблиця співставлення — вантажимо окремо, паспорт без неї теж працює. */
  function loadMapping() {
    const get = (n) => fetch("../mapping/data/" + n).then((r) => r.json());
    Promise.all([get("services_lite.json"), get("by_icd.json"), get("odk.json")])
      .then(([services, byIcd, odk]) => {
        SERVICES = services; BY_ICD = byIcd; ODK = odk;
        for (const o of ODK) odkMembers.set(o.id, new Set(o.codes));
        // які послуги посилаються на кожну ОДК — рахуємо один раз
        for (const s of SERVICES) {
          const refs = s.odk || [];
          for (const id of refs) {
            const bucket = odkServices.get(id);
            if (bucket) bucket.push(s.i); else odkServices.set(id, [s.i]);
          }
        }
        if (openedCode) openCode(openedCode);
      })
      .catch(() => { SERVICES = null; });
  }

  function buildMaps() {
    for (const e of INDEX) {
      byCode.set(e.c, e);
      if (e.l === 3) {
        const key = e.k + "|" + (e.b == null ? -1 : e.b);
        (l3ByCB.get(key) || l3ByCB.set(key, []).get(key)).push(e);
      } else if (e.p) {
        (childrenOf.get(e.p) || childrenOf.set(e.p, []).get(e.p)).push(e);
      }
    }
  }

  function onIndexReady() {
    el.count.textContent = "Готово · " + nf(INDEX.length) + " кодів. Оберіть клас або введіть запит.";
    // якщо діапазон уже обрано до завантаження індексу — доповнити код 1-го порядку
    if (el.selBlock.value !== "" && el.selClass.value !== "") fillL3(+el.selClass.value, el.selBlock.value);
    // глибокий лінк ?code= / ?q=
    const q = new URLSearchParams(location.search);
    const code = (q.get("code") || q.get("q") || "").trim().toUpperCase();
    if (code && byCode.has(code)) { openCode(code); syncCascade(code); }
    else if (code) { el.search.value = code; runSearch(); }
  }

  // ══════════════════════════════════════════════════════════
  // Статистика
  // ══════════════════════════════════════════════════════════
  function renderStats() {
    const L = META.levels || {};
    const cards = [
      ["Класів", 22],
      ["1-го порядку", L[3] || 0],
      ["2-го порядку", L[4] || 0],
      ["Усього кодів", META.total || 0],
    ];
    el.stats.innerHTML = cards.map(([k, v]) =>
      `<div class="stat"><span class="stat-num">${nf(v)}</span><span class="stat-key">${k}</span></div>`
    ).join("");
  }

  // ══════════════════════════════════════════════════════════
  // Каскадна навігація
  // ══════════════════════════════════════════════════════════
  const ph = (t) => `<option value="">— ${t} —</option>`;
  function resetSel(sel, placeholder) { sel.innerHTML = ph(placeholder); sel.disabled = true; sel.value = ""; }

  function populateClasses() {
    const opts = [ph("оберіть клас")];
    for (const c of META.classes) {
      opts.push(`<option value="${c.no}">Клас ${ROMAN[c.no] || c.no} · ${(c.range || "").replace("-", "–")} · ${esc(cap(c.title))}</option>`);
    }
    el.selClass.innerHTML = opts.join("");
    el.selClass.disabled = false;
  }

  function fillBlocks(no) {
    const cls = classByNo.get(no);
    if (!cls) { resetSel(el.selBlock, "оберіть клас"); return; }
    const opts = [ph("оберіть діапазон")];
    (cls.blocks || []).forEach((b, i) =>
      opts.push(`<option value="${i}">${(b.range || "").replace("-", "–")} · ${esc(cap(b.name))}</option>`));
    el.selBlock.innerHTML = opts.join("");
    el.selBlock.disabled = false;
  }

  function fillCodes(sel, entries, placeholder) {
    const opts = [ph(placeholder)];
    for (const e of entries)
      opts.push(`<option value="${e.c}">${e.c} · ${esc(e.n)}${e.pk ? " ●ПМГ" : ""}</option>`);
    sel.innerHTML = opts.join("");
    sel.disabled = entries.length === 0;
  }

  function fillL3(no, bi) {
    if (!indexReady) { el.selL3.innerHTML = ph("індекс вантажиться…"); el.selL3.disabled = true; return; }
    const rubs = (l3ByCB.get(no + "|" + bi) || []).slice().sort(byCodeAsc);
    fillCodes(el.selL3, rubs, rubs.length ? "оберіть код 1-го порядку" : "немає рубрик");
  }
  function fillL4(code) {
    const kids = (childrenOf.get(code) || []).slice().sort(byCodeAsc);
    fillCodes(el.selL4, kids, kids.length ? "оберіть код 2-го порядку" : "підкодів немає");
  }
  function fillL5(code) {
    const kids = (childrenOf.get(code) || []).slice().sort(byCodeAsc);
    fillCodes(el.selL5, kids, kids.length ? "оберіть код 3-го порядку" : "підкодів немає");
  }

  function wireCascade() {
    el.selClass.addEventListener("change", () => {
      resetSel(el.selL3, "оберіть діапазон");
      resetSel(el.selL4, "оберіть код 1-го порядку");
      resetSel(el.selL5, "оберіть код 2-го порядку");
      const no = +el.selClass.value;
      if (!no) { resetSel(el.selBlock, "оберіть клас"); return; }
      fillBlocks(no);
    });
    el.selBlock.addEventListener("change", () => {
      resetSel(el.selL4, "оберіть код 1-го порядку");
      resetSel(el.selL5, "оберіть код 2-го порядку");
      const no = +el.selClass.value, bi = el.selBlock.value;
      if (bi === "") { resetSel(el.selL3, "оберіть діапазон"); return; }
      fillL3(no, bi);
    });
    el.selL3.addEventListener("change", () => {
      resetSel(el.selL5, "оберіть код 2-го порядку");
      const code = el.selL3.value;
      if (!code) { resetSel(el.selL4, "оберіть код 1-го порядку"); return; }
      openCode(code); fillL4(code);
    });
    el.selL4.addEventListener("change", () => {
      const code = el.selL4.value;
      if (!code) { resetSel(el.selL5, "оберіть код 2-го порядку"); return; }
      openCode(code); fillL5(code);
    });
    el.selL5.addEventListener("change", () => {
      const code = el.selL5.value;
      if (code) openCode(code);
    });
  }

  // Відобразити повний шлях коду в каскаді (з пошуку / глибокого лінку)
  function syncCascade(code) {
    if (!indexReady) return;
    const e = byCode.get(code); if (!e) return;
    const { cls, p3, p4 } = ancestryOf(e); if (!cls) return;
    const bidx = p3 && p3.b != null ? p3.b : (e.l === 3 && e.b != null ? e.b : null);
    el.selClass.value = String(cls.no); fillBlocks(cls.no);
    if (bidx == null) { resetSel(el.selL3, "оберіть діапазон"); return; }
    el.selBlock.value = String(bidx); fillL3(cls.no, bidx);
    if (p3) { el.selL3.value = p3.c; fillL4(p3.c); } else resetSel(el.selL4, "оберіть код 1-го порядку");
    const l4 = e.l === 4 ? e.c : (e.l === 5 && p4 ? p4.c : null);
    if (l4) { el.selL4.value = l4; fillL5(l4); } else resetSel(el.selL5, "оберіть код 2-го порядку");
    if (e.l === 5) el.selL5.value = e.c;
  }

  // ══════════════════════════════════════════════════════════
  // Текстовий пошук
  // ══════════════════════════════════════════════════════════
  let searchTimer = null;
  function wireUI() {
    wireCascade();
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 130);
    });
    el.onlyPmg.addEventListener("change", runSearch);
    el.level.addEventListener("change", runSearch);
    el.clear.addEventListener("click", resetForm);
    // Пакетний пошук
    el.batchRun.addEventListener("click", () => {
      if (!indexReady) { el.count.textContent = "Індекс ще вантажиться…"; return; }
      const terms = splitTerms(el.batch.value);
      if (!terms.length) { el.count.textContent = "Введіть коди або назви у поле пакетного пошуку."; return; }
      el.search.value = "";
      runBatch(terms);
    });
    el.batch.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); el.batchRun.click(); }
    });
    el.batchClear.addEventListener("click", () => {
      el.batch.value = ""; el.batchCopy.hidden = true; lastBatchFound = []; lastShown = [];
      el.results.hidden = true; el.results.innerHTML = "";
      el.count.textContent = indexReady ? nf(INDEX.length) + " кодів · оберіть клас або введіть запит" : "Завантаження…";
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

  function runSearch() {
    const raw = el.search.value.trim();
    const onlyPmg = el.onlyPmg.checked;
    const lvl = el.level.value ? +el.level.value : 0;
    const active = raw.length >= 1 || onlyPmg || lvl;

    if (!active) {
      el.results.hidden = true; el.batchCopy.hidden = true; lastBatchFound = []; lastShown = [];
      if (indexReady) el.count.textContent = nf(INDEX.length) + " кодів · оберіть клас або введіть запит";
      return;
    }
    if (!indexReady) { el.count.textContent = "Індекс ще вантажиться…"; return; }

    // кілька термінів у рядку (через кому/крапку з комою або кілька кодів) → пакетний режим
    const inlineTerms = splitTerms(raw);
    if (inlineTerms.length > 1) { runBatch(inlineTerms); return; }
    el.batchCopy.hidden = true; lastBatchFound = [];

    const q = raw.toLowerCase();
    const qCode = raw.toUpperCase().replace(/\s+/g, "");
    const looksCode = /^[A-ZА-Я][0-9]/.test(qCode);
    const out = [];
    for (const e of INDEX) {
      if (onlyPmg && !e.pk) continue;
      if (lvl && e.l !== lvl) continue;
      let score = 0;
      if (looksCode) {
        if (e.c === qCode) score = 100;
        else if (e.c.startsWith(qCode)) score = 70;
        else if (q && e.n.toLowerCase().includes(q)) score = 20;
      } else if (q) {
        const nl = e.n.toLowerCase();
        if (nl.startsWith(q)) score = 60;
        else if (nl.includes(" " + q)) score = 45;
        else if (nl.includes(q)) score = 30;
        else if (e.c.toLowerCase().includes(q)) score = 15;
      } else {
        score = 10;
      }
      if (score > 0) out.push([score, e]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1].c.localeCompare(b[1].c));
    const CAP = 500;
    const shown = out.slice(0, CAP);
    lastShown = out.map(([, e]) => ({ t: null, e }));
    exportWhat = raw || "фільтр";
    el.count.textContent = out.length
      ? `Знайдено ${nf(out.length)}${out.length > CAP ? " · показано " + CAP : ""}`
      : "Нічого не знайдено";
    el.results.innerHTML = (out.length ? exportBar(out.length) : "") +
      shown.map(([, e]) => resultRow(e)).join("");
    el.results.hidden = false;
  }

  /* ── Експорт поточних результатів ─────────────────────────
     Панель над списком: копіювання всіх знайдених кодів (не лише
     показаних CAP/PER) і вивантаження таблиці Excel (.xlsx).
     Дзеркало реалізації з nk026.js. */
  function exportBar(n) {
    return `<div class="nk-export" role="toolbar" aria-label="Експорт результатів пошуку">
      <span class="exp-note">Експорт ${nf(n)} знайдених:</span>
      <button type="button" class="nk-exp" data-exp="codes" title="Скопіювати всі знайдені коди — по одному в рядку">⧉ Коди</button>
      <button type="button" class="nk-exp" data-exp="full" title="Скопіювати всі знайдені коди з назвами — код, табуляція, назва">⧉ Коди + назви</button>
      <button type="button" class="nk-exp" data-exp="xlsx" title="Сформувати і скачати таблицю Excel (.xlsx)">⬇ Excel</button>
    </div>`;
  }

  function runExport(btn) {
    if (!lastShown.length) return;
    if (btn.dataset.exp === "xlsx") { downloadXlsx(); return; }
    const codesOnly = btn.dataset.exp === "codes";
    const seen = new Set(), lines = [];
    for (const { e } of lastShown) {
      if (seen.has(e.c)) continue;
      seen.add(e.c);
      lines.push(codesOnly ? e.c : e.c + "\t" + e.n);
    }
    copyText(lines.join("\n"), btn, `✓ Скопійовано ${nf(lines.length)}`);
  }

  function copyText(text, btn, okLabel) {
    const done = () => {
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = okLabel || "✓";
      setTimeout(() => (btn.textContent = old), 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    ta.remove();
    done();
  }

  // ── Excel (.xlsx): мінімальний OOXML + zip без стиснення ──
  function downloadXlsx() {
    const hasTerms = lastShown.some((r) => r.t);
    const head = (hasTerms ? ["Запит"] : []).concat(
      ["Код", "Назва", "Рівень", "Клас", "Назва класу", "Пакети ПМГ"]);
    const widths = (hasTerms ? [22] : []).concat([10, 64, 26, 8, 44, 14]);
    const rows = lastShown.map(({ t, e }) => {
      const cls = classByNo.get(e.k);
      return (hasTerms ? [t || ""] : []).concat([
        e.c, e.n,
        LEVEL_LABEL[e.l] || "",
        cls ? (ROMAN[cls.no] || String(cls.no)) : "",
        cls ? cap(cls.title) : "",
        e.pk && e.pk.pkgs ? e.pk.pkgs.join(", ") : ""]);
    });
    const blob = new Blob(zipStore(xlsxParts(head, rows, widths)),
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const slug = exportWhat.replace(/[^0-9A-Za-z\u0400-\u04FF]+/g, "_")
      .replace(/^_+|_+$/g, "").slice(0, 40) || "eksport";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nk025_" + slug + "_" + new Date().toISOString().slice(0, 10) + ".xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function xEsc(s) {
    return String(s == null ? "" : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function xlsxParts(head, rows, widths) {
    const cols = widths.map((w, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
    const cell = (v, s) =>
      `<c t="inlineStr"${s ? ' s="1"' : ""}><is><t xml:space="preserve">${xEsc(v)}</t></is></c>`;
    const row = (vals, s) => `<row>${vals.map((v) => cell(v, s)).join("")}</row>`;
    const sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      `<cols>${cols}</cols><sheetData>${row(head, true)}${rows.map((r) => row(r)).join("")}</sheetData></worksheet>`;
    return [
      { name: "[Content_Types].xml", text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },
      { name: "_rels/.rels", text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { name: "xl/workbook.xml", text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="НК 025" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },
      { name: "xl/styles.xml", text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border/></borders>' +
        '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
        '<cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" applyFont="1"/></cellXfs>' +
        '</styleSheet>' },
      { name: "xl/worksheets/sheet1.xml", text: sheet },
    ];
  }

  /** ZIP без стиснення (method 0): достатньо для .xlsx, нуль залежностей. */
  function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [], cdir = [];
    let offset = 0, count = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.text);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      cdir.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
      count++;
    }
    let cdSize = 0;
    for (const u of cdir) cdSize += u.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, count, true); end.setUint16(10, count, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return parts.concat(cdir, [new Uint8Array(end.buffer)]);
  }

  let CRC_T = null;
  function crc32(u8) {
    if (!CRC_T) {
      CRC_T = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_T[n] = c;
      }
    }
    let c = -1;
    for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function resultRow(e) {
    const path = classByNo.has(e.k) ? `Клас ${ROMAN[e.k] || e.k}` : "";
    return `<button class="rrow lvl-${e.l}" type="button" data-code="${e.c}">
      <span class="tcode code">${e.c}</span>
      <span class="rmain"><span class="tname">${esc(e.n)}</span>
        <span class="rmeta">${LEVEL_LABEL[e.l]} · ${path}</span></span>
      ${pkChip(e)}
    </button>`;
  }

  function pkChip(e) {
    if (!e.pk) return "";
    const n = e.pk.pkgs ? e.pk.pkgs.length : 0;
    return `<span class="pk-dot" title="Код зустрічається у пакетах ПМГ (${n})">ПМГ</span>`;
  }

  // ── Пакетний пошук: кілька кодів / назв разом ─────────────
  function splitTerms(raw) {
    const parts = String(raw || "").split(/[,;\n\t]+/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const toks = p.split(/\s+/);
      // рядок з кількох код-подібних токенів через пробіл — розбити на окремі коди
      const allCode = toks.length > 1 && toks.every((t) => /^[A-ZА-Я][0-9][0-9A-ZА-Я.]*$/i.test(t));
      if (allCode) out.push(...toks); else out.push(p);
    }
    return out;
  }

  function matchTerm(term) {
    const onlyPmg = el.onlyPmg.checked, lvl = el.level.value ? +el.level.value : 0;
    const qCode = term.toUpperCase().replace(/\s+/g, "");
    const looksCode = /^[A-ZА-Я][0-9]/.test(qCode);
    let matches;
    if (looksCode) {
      const exact = byCode.get(qCode);
      matches = exact ? [exact] : INDEX.filter((e) => e.c.startsWith(qCode));
    } else {
      const q = term.toLowerCase();
      matches = INDEX.filter((e) => e.n.toLowerCase().includes(q));
    }
    if (onlyPmg) matches = matches.filter((e) => e.pk);
    if (lvl) matches = matches.filter((e) => e.l === lvl);
    return matches.slice().sort(byCodeAsc);
  }

  function runBatch(terms) {
    if (!indexReady) { el.count.textContent = "Індекс ще вантажиться…"; return; }
    lastBatchFound = [];
    lastShown = [];
    let foundTerms = 0, totalMatches = 0;
    const PER = 25;
    const blocks = terms.map((term) => {
      const m = matchTerm(term);
      if (m.length) { foundTerms++; totalMatches += m.length; }
      m.forEach((e) => { lastBatchFound.push({ code: e.c, name: e.n }); lastShown.push({ t: term, e }); });
      const head = `<div class="batch-head ${m.length ? "" : "nomatch"}">
          <span>${m.length ? "🔹" : "❌"} ${esc(term)}</span>
          <span class="batch-badge">${m.length ? nf(m.length) + (m.length > PER ? " · показано " + PER : "") : "не знайдено"}</span>
        </div>`;
      return `<div class="batch-group">${head}${m.slice(0, PER).map(resultRow).join("")}</div>`;
    });
    el.count.textContent = `Пакетно: ${terms.length} запит(ів) · збіги у ${foundTerms}/${terms.length} · усього ${nf(totalMatches)}`;
    exportWhat = "пакетний_пошук";
    el.results.innerHTML = (lastShown.length ? exportBar(lastShown.length) : "") + blocks.join("");
    el.results.hidden = false;
    el.batchCopy.hidden = lastBatchFound.length === 0;
  }

  el.results.addEventListener("click", (ev) => {
    const x = ev.target.closest(".nk-exp");
    if (x) { runExport(x); return; }
    const b = ev.target.closest(".rrow");
    if (!b) return;
    openCode(b.dataset.code); syncCascade(b.dataset.code); markActive(b);
  });

  // ══════════════════════════════════════════════════════════
  // Паспорт коду
  // ══════════════════════════════════════════════════════════
  function ancestryOf(e) {
    const cls = classByNo.get(e.k);
    let p3 = null, p4 = null;
    if (e.l === 3) p3 = e;
    else if (e.l === 4) p3 = byCode.get(e.p);
    else if (e.l === 5) { p4 = byCode.get(e.p); p3 = p4 ? byCode.get(p4.p) : null; }
    let block = null;
    const bidx = p3 && p3.b != null ? p3.b : (e.l === 3 ? e.b : null);
    if (cls && bidx != null && cls.blocks && cls.blocks[bidx]) block = cls.blocks[bidx];
    return { cls, block, p3, p4 };
  }

  function openCode(code) {
    const e = byCode.get(code);
    if (!e) return;
    openedCode = code;
    const { cls, block, p3, p4 } = ancestryOf(e);

    const crumbs = [];
    if (cls) crumbs.push(`<span class="crumb"><b>Клас ${ROMAN[cls.no] || cls.no}</b> ${esc(cap(cls.title))}</span>`);
    if (block) crumbs.push(`<span class="crumb">${esc(cap(block.name))} <em>${(block.range || "").replace("-", "–")}</em></span>`);
    if (p3 && p3.c !== code) crumbs.push(`<span class="crumb"><a data-goto="${p3.c}">${p3.c}</a> ${esc(p3.n)}</span>`);
    if (p4 && p4.c !== code) crumbs.push(`<span class="crumb"><a data-goto="${p4.c}">${p4.c}</a> ${esc(p4.n)}</span>`);

    const kids = (childrenOf.get(code) || []).slice().sort(byCodeAsc);
    const kidsHtml = kids.length
      ? `<div class="reader-block"><h3>Підпорядковані коди (${kids.length})</h3>
          <div class="chip-list">${kids.map((k) =>
        `<button class="subchip" data-goto="${k.c}"><b>${k.c}</b> ${esc(k.n)}</button>`).join("")}</div></div>`
      : "";

    const copyText = `${e.c} — ${e.n}` + (cls ? ` (Клас ${ROMAN[cls.no]}${block ? ", " + block.name : ""})` : "");

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code">${e.c}</div>
        <div class="reader-level lvl-${e.l}">${LEVEL_LABEL[e.l]}</div>
        <div class="copy-wrap">
          <button class="copy-btn" type="button" data-copy-menu
                  aria-haspopup="true" aria-expanded="false">⧉ Копіювати ▾</button>
          <div class="copy-menu" hidden>
            <button type="button" data-copy="${escAttr(e.c)}" title="${escAttr(e.c)}">
              Лише код<em>${esc(e.c)}</em></button>
            <button type="button" data-copy="${escAttr(e.c + " — " + e.n)}" title="${escAttr(e.c + " — " + e.n)}">
              Код і назву<em>${esc(e.c)} — ${esc(e.n.slice(0, 40))}${e.n.length > 40 ? "…" : ""}</em></button>
            <button type="button" data-copy="${escAttr(copyText)}" title="${escAttr(copyText)}">
              Код, назву і клас<em>…${esc(cls ? "Клас " + ROMAN[cls.no] : "")}</em></button>
          </div>
        </div>
      </div>
      <h2 class="reader-name">${esc(e.n)}</h2>
      <div class="reader-crumbs">${crumbs.join('<span class="sep">›</span>')}</div>
      ${renderPmg(e)}
      ${renderServices(e)}
      ${renderCoding(e)}
      ${renderLinks(e)}
      ${kidsHtml}
      <div class="reader-foot">НК 025:2021 · ICD-10-AM · ${LEVEL_LABEL[e.l].toLowerCase()}</div>`;
    setTab("reader");
  }

  /* Місток у тарифний бік. Аудит 17.08.2026 (дефект В3): паспорт коду знав про
     пакети й нормативку, але мовчав про те, у які діагностично-споріднені
     групи код веде і скільки це коштує, — а саме це питають найчастіше.
     Рахувати тут не беремося: для цього потрібні дані двох інших розділів.
     Даємо перехід із уже підставленим кодом, щоб відповідь була в один клік. */
  function renderCoding(e) {
    // Заголовок навмисно предметний: нижче вже є блок «Переходи до пов'язаних
    // розділів», і два сусідні блоки з навігаційними назвами читалися б як одне.
    return `<div class="reader-block">
      <h3>Група і тариф</h3>
      <div class="chip-list">
        <a class="subchip" href="../koduvannia/index.html?dx=${encodeURIComponent(e.c)}#grouper"
           title="Основний діагностичний клас, досяжні групи, тариф і перевірка коректності"
           ><b>🧭 Кодування випадку</b> клас, групи, тариф</a>
        <a class="subchip" href="../drg/index.html?code=${encodeURIComponent(e.c)}&amp;mod=passport"
           title="Паспорт коду в тарифній моделі: перелік груп із вагами й сумами"
           ><b>🧮 Інструменти ДСГ</b> ваги й суми</a>
      </div>
    </div>`;
  }

  function renderPmg(e) {
    if (!e.pk) {
      return `<div class="reader-block pmg-none">
        <h3>Пакети ПМГ <span class="src">за наказом № 377</span></h3>
        <p class="muted">Прямої згадки цього коду в переліках наказу № 377 не знайдено.
           Це не виключає застосування коду в межах пакета — дивіться медичні послуги
           Таблиці співставлення нижче.</p></div>`;
    }
    const pk = e.pk;
    const chips = (pk.pkgs || []).map((n) =>
      `<a class="pk-pkg" href="../passport/index.html?package=${encodeURIComponent(n)}${backTail(e.c)}" title="Відкрити пакет № ${n}">Пакет № ${n}</a>`).join("");
    const badges = [];
    if (pk.ad) badges.push(`<span class="pk-badge ad">дорослі</span>`);
    if (pk.ch) badges.push(`<span class="pk-badge ch">діти</span>`);
    if (pk.p4) badges.push(`<span class="pk-badge p4">лише пакет 4</span>`);
    return `<div class="reader-block pmg-yes">
      <h3>Пакети ПМГ <span class="src">за наказом № 377</span></h3>
      <div class="chip-list">${chips || '<span class="muted">—</span>'}</div>
      ${badges.length ? `<div class="badge-row">${badges.join("")}</div>` : ""}
    </div>`;
  }

  /** Медичні послуги з Таблиці співставлення: код названо прямо або він у складі ОДК. */
  function renderServices(e) {
    if (!SERVICES || !BY_ICD) return "";
    const direct = new Set(BY_ICD[e.c] || []);
    // код може підпадати під послугу через ОДК, у складі якої він перелічений
    const viaOdk = new Map();
    for (const [id, codes] of odkMembers) {
      if (!codes.has(e.c)) continue;
      for (const si of odkServices.get(id) || []) {
        if (direct.has(si)) continue;
        const bucket = viaOdk.get(si);
        if (bucket) bucket.push(id); else viaOdk.set(si, [id]);
      }
    }
    if (!direct.size && !viaOdk.size) return "";

    const row = (si, badge) => {
      const s = SERVICES[si];
      if (!s) return "";
      return `<a class="svc-row" href="../mapping/index.html?service=${si}${backTail(e.c)}"
                 title="Відкрити в Таблиці співставлення">
        <b>${esc(s.c || "—")}</b><span class="svc-name">${esc(s.n)}${coefTag(s)}${badge || ""}</span>
        <span class="svc-pkgs">${s.p.map((p) => "пакет " + p).join(", ")}</span></a>`;
    };
    const parts = [...direct].map((si) => row(si));
    for (const [si, ids] of viaOdk) {
      parts.push(row(si, ` <span class="svc-via">через ${esc(ids.join(", "))}</span>`));
    }
    const total = direct.size + viaOdk.size;
    return `<div class="reader-block svc-block">
      <h3>Медичні послуги <span class="src">за Таблицею співставлення · ${total}</span></h3>
      <div class="svc-list">${parts.join("")}</div>
    </div>`;
  }

  /** Ваговий коефіцієнт ДСГ поруч із назвою послуги (перше значення додатка). */
  function coefTag(s) {
    const first = (s.k || []).find((d) => d.k && d.k.length);
    return first ? ` <span class="svc-coef" title="Ваговий коефіцієнт ДСГ ${escAttr(first.c)} (постанова 1808)">${esc(first.k[0])}</span>` : "";
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
    const toggle = ev.target.closest("[data-copy-menu]");
    if (toggle) { setCopyMenu(toggle, toggle.getAttribute("aria-expanded") !== "true"); return; }

    const cp = ev.target.closest("[data-copy]");
    if (cp) {
      navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy);
      // Підтвердження показуємо на КНОПЦІ меню, а не на пункті: пункт зникає
      // разом із меню, і «✓ Скопійовано» ніхто б не побачив.
      const wrap = cp.closest(".copy-wrap");
      const btn = wrap && wrap.querySelector("[data-copy-menu]");
      if (btn) {
        setCopyMenu(btn, false);
        btn.textContent = "✓ Скопійовано";
        setTimeout(() => (btn.textContent = "⧉ Копіювати ▾"), 1400);
      }
    }
  });

  /** Меню «Копіювати»: код окремо, код із назвою, код із назвою та класом. */
  function setCopyMenu(btn, open) {
    const menu = btn.parentElement.querySelector(".copy-menu");
    if (!menu) return;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  }

  function closeCopyMenus() {
    el.reader.querySelectorAll("[data-copy-menu]").forEach((b) => setCopyMenu(b, false));
  }

  // Клік поза меню й Escape закривають його. Слухаємо на документі один раз:
  // паспорт перемальовується щоразу, тож вішати це в рендері означало б плодити
  // обробники на кожен відкритий код.
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".copy-wrap")) closeCopyMenus();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeCopyMenus();
  });

  // ══════════════════════════════════════════════════════════
  // Допоміжне
  // ══════════════════════════════════════════════════════════
  // Повне скидання форми: пошук, фільтри, каскад, пакетне поле, результати, паспорт
  function resetForm() {
    el.search.value = ""; el.onlyPmg.checked = false; el.level.value = "";
    el.batch.value = ""; lastBatchFound = []; lastShown = []; el.batchCopy.hidden = true;
    el.selClass.value = "";
    resetSel(el.selBlock, "оберіть клас");
    resetSel(el.selL3, "оберіть діапазон");
    resetSel(el.selL4, "оберіть код 1-го порядку");
    resetSel(el.selL5, "оберіть код 2-го порядку");
    el.results.hidden = true; el.results.innerHTML = "";
    el.reader.classList.add("reader-empty");
    el.reader.innerHTML = readerEmptyHTML;
    openedCode = null;
    el.count.textContent = indexReady
      ? nf(INDEX.length) + " кодів · оберіть клас або введіть запит"
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
  function byCodeAsc(a, b) { return a.c.localeCompare(b.c, "en"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
  function cap(s) {
    s = String(s || "");
    if (!s) return s;
    if (/[а-яґєії]/.test(s)) return s;
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  boot();
})();
