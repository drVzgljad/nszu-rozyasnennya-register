/* ============================================================
   LOINC — довідник лабораторних та клінічних спостережень.
   Двомовний (UA/EN), каскад Тип → Клас, миттєвий пошук, паспорт коду.
   Vanilla JS. Дані: data/loinc/loinc_meta.json + data/loinc/loinc_data_<ct>.json
   Запис (array): [num, comp, prop, time, sys, scale, method, uaSlots[6],
                   cls, us, rank, st, units, cons, def, cpr]
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  // Колонки запису
  const C = { NUM: 0, COMP: 1, PROP: 2, TIME: 3, SYS: 4, SCALE: 5, METHOD: 6,
              UA: 7, CLS: 8, US: 9, RANK: 10, ST: 11, UNITS: 12, CONS: 13, DEF: 14, CPR: 15 };
  const AX = [C.COMP, C.PROP, C.TIME, C.SYS, C.SCALE, C.METHOD]; // порядок осей = порядок uaSlots
  const AX_LABEL = ["Компонент (що вимірюється)", "Властивість", "Час",
                    "Система (біоматеріал)", "Шкала", "Метод"];
  const ST_MAP = {
    A: { ua: "Чинний", en: "ACTIVE", cls: "ok" },
    T: { ua: "Пробний", en: "TRIAL", cls: "trial" },
    D: { ua: "Застарілий", en: "DEPRECATED", cls: "dep" },
    X: { ua: "Не рекомендований", en: "DISCOURAGED", cls: "dep" },
  };
  // Бейдж якості української назви (us: 3 офіц / 2 повна складена / 1 часткова / 0 EN)
  const US_BADGE = {
    3: { t: "офіційний переклад", cls: "off", tip: "Офіційний український мовний варіант LOINC" },
    2: { t: "авто-переклад", cls: "auto", tip: "Складено автоматично з офіційного глосарію LOINC (неофіційно)" },
    1: { t: "авто-переклад · частковий", cls: "auto", tip: "Частину осей складено автоматично; решта — англійською (неофіційно)" },
    0: { t: "лише англійською", cls: "en", tip: "Українського відповідника ще немає" },
  };

  let META = null, LANG = "ua";
  const DATA = new Map();      // ctId → records[]
  const byNum = new Map();     // num → record
  let WORK = [], WORKTXT = []; // активний робочий набір + пошукові рядки
  let readerEmptyHTML = "";

  const el = {
    stats: $("#loStats"), ver: $("#loVer"), license: $("#loLicense"),
    search: $("#loSearch"), classType: $("#loClassType"), cls: $("#loClass"),
    onlyUA: $("#loOnlyUA"), onlyActive: $("#loActive"),
    count: $("#loCount"), clear: $("#loClear"),
    results: $("#loResults"), reader: $("#loReader"), layout: $(".nk-layout"),
  };

  // ── Доступ до осей з урахуванням мови ──────────────────────
  const axEN = (r, i) => r[AX[i]] || "";
  const axUAonly = (r, i) => (r[C.UA] && r[C.UA][i]) || "";           // «» якщо нема перекладу
  const axUA = (r, i) => axUAonly(r, i) || axEN(r, i);               // з фолбеком на EN
  const ax = (r, i) => (LANG === "ua" ? axUA(r, i) : axEN(r, i));

  // Довга назва коду в поточній мові (компонент-центрична)
  function longName(r, lang) {
    const g = lang === "en" ? (i) => axEN(r, i) : (i) => axUA(r, i);
    const comp = g(0), prop = g(1), sys = g(3), scale = g(4), meth = g(5);
    let s = comp || "(без компонента)";
    if (prop) s += ` [${prop}]`;
    if (sys) s += ` — ${sys}`;
    const tail = [scale, meth].filter(Boolean).join(", ");
    if (tail) s += ` · ${tail}`;
    return s;
  }

  // ══════════════════════════════════════════════════════════
  async function boot() {
    readerEmptyHTML = el.reader.innerHTML;
    LANG = localStorage.getItem("loincLang") === "en" ? "en" : "ua";
    syncLangButtons();
    try {
      META = await fetch("data/loinc/loinc_meta.json").then((r) => r.json());
    } catch (e) {
      el.count.textContent = "Не вдалося завантажити довідник LOINC.";
      return;
    }
    if (el.ver) el.ver.textContent = META.version || "";
    if (el.license && META.license) el.license.textContent = META.license +
      " Українські назви поза офіційним мовним варіантом складено автоматично і не є офіційним перекладом.";
    renderStats();
    populateClassTypes();
    wireUI();
    el.count.textContent = nf(META.total) + " кодів · оберіть тип і клас або введіть запит";
  }

  function renderStats() {
    const cards = [
      ["Усього кодів", META.total || 0],
      ["Українською (офіц.)", META.ua_official || 0],
      ["Українською (усього)", META.ua_full || 0],
      ["Реліз LOINC", META.version || "—"],
    ];
    el.stats.innerHTML = cards.map(([k, v]) =>
      `<div class="stat"><span class="stat-num">${typeof v === "number" ? nf(v) : v}</span><span class="stat-key">${k}</span></div>`
    ).join("");
  }

  // ── Каскад: Тип класу → Клас ───────────────────────────────
  const ph = (t) => `<option value="">— ${t} —</option>`;

  function populateClassTypes() {
    const opts = [ph("оберіть тип")];
    for (const ct of META.classtypes) {
      opts.push(`<option value="${ct.id}">${esc(LANG === "ua" ? ct.ua : ct.en)} · ${nf(ct.count)}</option>`);
    }
    opts.push(`<option value="all">Усі типи · ${nf(META.total)} (важче)</option>`);
    el.classType.innerHTML = opts.join("");
    el.classType.disabled = false;
    // за замовчуванням — лабораторні (тип 1), якщо є
    const hasLab = META.classtypes.some((c) => c.id === "1");
    el.classType.value = hasLab ? "1" : (META.classtypes[0] ? META.classtypes[0].id : "");
    populateClasses();
  }

  function classesFor(ctId) {
    if (ctId === "all") {
      const out = [];
      META.classtypes.forEach((ct) => ct.classes.forEach((c) => out.push(c)));
      return out;
    }
    const ct = META.classtypes.find((c) => c.id === ctId);
    return ct ? ct.classes : [];
  }

  function populateClasses() {
    const ctId = el.classType.value;
    const classes = classesFor(ctId);
    const opts = [ph(classes.length ? "усі класи цього типу" : "оберіть тип")];
    for (const c of classes) {
      const name = LANG === "ua" && c.ua ? c.ua : c.code;
      const uaTag = c.ua_full ? ` · ${nf(c.ua_full)} укр.` : "";
      opts.push(`<option value="${esc(c.code)}">${esc(name)} · ${nf(c.count)}${uaTag}</option>`);
    }
    el.cls.innerHTML = opts.join("");
    el.cls.disabled = classes.length === 0;
  }

  // ── Лениве завантаження шарів даних ────────────────────────
  function fileFor(ctId) {
    const ct = META.classtypes.find((c) => c.id === ctId);
    return ct ? ct.file : `loinc_data_${ctId}.json`;
  }

  async function ensureLoaded(ctId) {
    const ids = ctId === "all" ? META.classtypes.map((c) => c.id) : [ctId];
    const missing = ids.filter((id) => !DATA.has(id));
    if (missing.length) {
      el.count.textContent = "Завантажую дані…";
      await Promise.all(missing.map(async (id) => {
        const recs = await fetch("data/loinc/" + fileFor(id)).then((r) => r.json());
        DATA.set(id, recs);
        for (const r of recs) byNum.set(r[C.NUM], r);
      }));
    }
    // зібрати робочий набір
    WORK = [];
    for (const id of ids) WORK = WORK.concat(DATA.get(id) || []);
    buildWorkText();
  }

  function buildWorkText() {
    WORKTXT = new Array(WORK.length);
    for (let i = 0; i < WORK.length; i++) {
      const r = WORK[i];
      let t = r[C.NUM] + " ";
      for (let a = 0; a < 6; a++) { t += axEN(r, a) + " " + axUAonly(r, a) + " "; }
      WORKTXT[i] = t.toLowerCase();
    }
  }

  // ── Обробники каскаду ──────────────────────────────────────
  async function onClassTypeChange() {
    populateClasses();
    el.results.hidden = true; el.results.innerHTML = "";
    await ensureLoaded(el.classType.value);
    // якщо клас уже обрано — показати його, інакше топ-поширені
    if (el.cls.value) listClass(el.cls.value);
    else if (el.search.value.trim()) runSearch();
    else showCommon();
  }

  async function onClassChange() {
    await ensureLoaded(el.classType.value);
    if (el.cls.value) listClass(el.cls.value);
    else showCommon();
  }

  // ── Списки ─────────────────────────────────────────────────
  function passFilters(r) {
    if (el.onlyActive.checked && r[C.ST] !== "A") return false;
    if (el.onlyUA.checked && r[C.US] < 2) return false;
    return true;
  }

  function showCommon() {
    const rows = WORK.filter((r) => r[C.RANK] > 0 && passFilters(r))
      .sort((a, b) => a[C.RANK] - b[C.RANK]).slice(0, 200);
    const label = "Найпоширеніші дослідження";
    el.count.textContent = rows.length
      ? `${label} · показано ${nf(rows.length)}`
      : `${nf(WORK.length)} кодів у наборі · введіть запит або оберіть клас`;
    el.results.innerHTML = rows.length
      ? `<div class="lo-listhead">${label}</div>` + rows.map(resultRow).join("")
      : "";
    el.results.hidden = rows.length === 0;
  }

  function listClass(code) {
    const rows = WORK.filter((r) => r[C.CLS] === code && passFilters(r))
      .sort(byRankThenNum);
    const cinfo = classesFor(el.classType.value).find((c) => c.code === code);
    const cname = cinfo && LANG === "ua" && cinfo.ua ? cinfo.ua : code;
    el.count.textContent = `Клас ${esc0(code)} · ${esc0(cname)} · ${nf(rows.length)}`;
    const CAP = 800;
    el.results.innerHTML = `<div class="lo-listhead">${esc(cname)} <span>(${esc(code)})</span></div>` +
      rows.slice(0, CAP).map(resultRow).join("") +
      (rows.length > CAP ? `<div class="tempty">…показано ${CAP} з ${nf(rows.length)}. Уточніть пошуком.</div>` : "");
    el.results.hidden = false;
  }

  // ── Пошук ──────────────────────────────────────────────────
  let searchTimer = null;
  function runSearch() {
    const raw = el.search.value.trim();
    if (!raw) {
      if (el.cls.value) listClass(el.cls.value); else showCommon();
      return;
    }
    if (!WORK.length) { el.count.textContent = "Завантажую дані…"; return; }
    const q = raw.toLowerCase();
    const qCode = raw.replace(/\s+/g, "");
    const looksCode = /^\d+-?\d*$/.test(qCode);
    const out = [];
    for (let i = 0; i < WORK.length; i++) {
      const r = WORK[i];
      if (!passFilters(r)) continue;
      let score = 0;
      const num = r[C.NUM];
      if (looksCode && (num === qCode || num.replace("-", "") === qCode)) score = 100;
      else if (looksCode && num.startsWith(qCode)) score = 70;
      else {
        const pos = WORKTXT[i].indexOf(q);
        if (pos === 0) score = 55;
        else if (pos > 0) score = WORKTXT[i][pos - 1] === " " ? 45 : 30;
      }
      if (score > 0) out.push([score + Math.min(r[C.RANK] ? 5 : 0, 5), r]);
    }
    out.sort((a, b) => b[0] - a[0] ||
      (a[1][C.RANK] || 9e9) - (b[1][C.RANK] || 9e9) || a[1][C.NUM].localeCompare(b[1][C.NUM]));
    const CAP = 600;
    el.count.textContent = out.length
      ? `Знайдено ${nf(out.length)}${out.length > CAP ? " · показано " + CAP : ""}`
      : "Нічого не знайдено";
    el.results.innerHTML = out.slice(0, CAP).map(([, r]) => resultRow(r)).join("");
    el.results.hidden = false;
  }

  function resultRow(r) {
    const badge = US_BADGE[r[C.US]];
    const name = longName(r, LANG);
    return `<button class="rrow" type="button" data-num="${esc(r[C.NUM])}">
      <span class="tcode code">${esc(r[C.NUM])}</span>
      <span class="rmain"><span class="tname">${esc(name)}</span>
        <span class="rmeta">${esc(r[C.CLS])}${r[C.RANK] ? " · рейтинг " + r[C.RANK] : ""}</span></span>
      <span class="lo-ub lo-ub-${badge.cls}" title="${escAttr(badge.tip)}">${badge.t}</span>
    </button>`;
  }

  // ── Паспорт коду ───────────────────────────────────────────
  function openNum(num) {
    const r = byNum.get(num);
    if (!r) return;
    const badge = US_BADGE[r[C.US]];
    const st = ST_MAP[r[C.ST]] || ST_MAP.A;
    const primary = longName(r, LANG);
    const secLang = LANG === "ua" ? "en" : "ua";
    const secondary = longName(r, secLang);

    // таблиця осей
    const axRows = AX.map((_, i) => {
      const en = axEN(r, i), ua = axUAonly(r, i);
      const uaCell = ua
        ? `<span class="lo-ua">${esc(ua)}</span>`
        : `<span class="lo-ua muted">${en ? esc(en) + " (не перекладено)" : "—"}</span>`;
      return `<tr>
        <th>${AX_LABEL[i]}</th>
        <td>${uaCell}</td>
        <td class="lo-en">${en ? esc(en) : "—"}</td>
      </tr>`;
    }).join("");

    const meta = [];
    const cinfo = classesFor(el.classType.value).find((c) => c.code === r[C.CLS]);
    const cname = cinfo && cinfo.ua ? `${cinfo.ua} (${r[C.CLS]})` : r[C.CLS];
    meta.push(["Клас LOINC", esc(cname)]);
    if (r[C.UNITS]) meta.push(["Приклад одиниць", esc(r[C.UNITS])]);
    if (r[C.RANK]) meta.push(["Рейтинг вживаності", "#" + r[C.RANK] + " (що менше — то поширеніший)"]);
    if (r[C.CONS]) meta.push(["Побутова назва (EN)", esc(r[C.CONS])]);
    const metaHtml = meta.map(([k, v]) =>
      `<div class="lo-metarow"><span class="lo-mk">${k}</span><span class="lo-mv">${v}</span></div>`).join("");

    const defHtml = r[C.DEF]
      ? `<div class="reader-block"><h3>Визначення (LOINC, EN)</h3><p class="muted">${esc(r[C.DEF])}</p></div>` : "";
    const cprHtml = r[C.CPR]
      ? `<div class="reader-block"><h3>Сторонні авторські права</h3><p class="muted">${esc(r[C.CPR])}</p></div>` : "";

    const copyText = `${r[C.NUM]} — ${primary}`;
    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code">${esc(r[C.NUM])}</div>
        <span class="lo-status lo-st-${st.cls}" title="Статус LOINC">${st.ua}</span>
        <span class="lo-ub lo-ub-${badge.cls}" title="${escAttr(badge.tip)}">${badge.t}</span>
        <button class="copy-btn" type="button" data-copy="${escAttr(copyText)}" title="Скопіювати код і назву">⧉ Копіювати</button>
      </div>
      <h2 class="reader-name">${esc(primary)}</h2>
      <div class="lo-secname" title="${LANG === "ua" ? "Англійська назва LOINC" : "Українська назва"}">${esc(secondary)}</div>

      <div class="reader-block">
        <h3>Осі LOINC (Fully-Specified Name)</h3>
        <table class="lo-axes">
          <thead><tr><th>Ось</th><th>Українською</th><th>LOINC (EN)</th></tr></thead>
          <tbody>${axRows}</tbody>
        </table>
      </div>

      <div class="reader-block">
        <h3>Характеристики</h3>
        <div class="lo-meta">${metaHtml}</div>
      </div>
      ${defHtml}
      ${cprHtml}
      <div class="reader-block">
        <h3>Джерело</h3>
        <div class="link-grid">
          <a class="xlink" href="https://loinc.org/${encodeURIComponent(r[C.NUM])}/" target="_blank" rel="noopener">
            <span class="xico">🔗</span>Відкрити на loinc.org</a>
        </div>
      </div>
      <div class="reader-foot">LOINC® ${META.version || ""} · Regenstrief Institute · довідковий інструмент, не офіційний класифікатор України</div>`;
    setTab("reader");
  }

  // ── Події ──────────────────────────────────────────────────
  function wireUI() {
    $$(".lo-lang").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
    el.classType.addEventListener("change", onClassTypeChange);
    el.cls.addEventListener("change", onClassChange);
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        if (!WORK.length) await ensureLoaded(el.classType.value);
        runSearch();
      }, 150);
    });
    el.onlyUA.addEventListener("change", refreshList);
    el.onlyActive.addEventListener("change", refreshList);
    el.clear.addEventListener("click", resetForm);

    el.results.addEventListener("click", (ev) => {
      const b = ev.target.closest(".rrow");
      if (!b) return;
      openNum(b.dataset.num); markActive(b);
    });
    el.reader.addEventListener("click", (ev) => {
      const cp = ev.target.closest("[data-copy]");
      if (cp) {
        navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy);
        cp.textContent = "✓ Скопійовано"; setTimeout(() => (cp.textContent = "⧉ Копіювати"), 1400);
      }
    });
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
  }

  function refreshList() {
    if (el.search.value.trim()) runSearch();
    else if (el.cls.value) listClass(el.cls.value);
    else showCommon();
  }

  function setLang(lang) {
    if (lang !== "ua" && lang !== "en") return;
    LANG = lang;
    localStorage.setItem("loincLang", lang);
    syncLangButtons();
    // запам'ятати активний код ДО перемальовування списку (інакше рядок зникне)
    const activeRow = $(".rrow.active");
    const activeNum = activeRow ? activeRow.dataset.num : null;
    // перемалювати каскад (мова назв типів/класів)
    const ctSel = el.classType.value, clSel = el.cls.value;
    populateClassTypes();
    if (ctSel) el.classType.value = ctSel;
    populateClasses();
    if (clSel) el.cls.value = clSel;
    refreshList();
    // відновити паспорт і підсвітку активного рядка вже в новій мові
    if (activeNum) {
      openNum(activeNum);
      const nr = el.results.querySelector('.rrow[data-num="' +
        (window.CSS && CSS.escape ? CSS.escape(activeNum) : activeNum) + '"]');
      if (nr) nr.classList.add("active");
    }
  }

  function syncLangButtons() {
    $$(".lo-lang").forEach((b) => b.classList.toggle("active", b.dataset.lang === LANG));
    document.documentElement.setAttribute("data-loinc-lang", LANG);
  }

  function resetForm() {
    el.search.value = "";
    el.onlyUA.checked = false; el.onlyActive.checked = true;
    el.cls.value = "";
    el.results.hidden = true; el.results.innerHTML = "";
    el.reader.classList.add("reader-empty");
    el.reader.innerHTML = readerEmptyHTML;
    el.count.textContent = WORK.length
      ? nf(WORK.length) + " кодів у наборі · оберіть клас або введіть запит"
      : nf(META.total) + " кодів · оберіть тип і клас або введіть запит";
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
  function byRankThenNum(a, b) {
    return (a[C.RANK] ? 0 : 1) - (b[C.RANK] ? 0 : 1) ||
      (a[C.RANK] || 0) - (b[C.RANK] || 0) || a[C.NUM].localeCompare(b[C.NUM]);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function esc0(s) { return esc(s); }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  boot();
})();
