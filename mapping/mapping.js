/* ============================================================
   Таблиця співставлення медичних послуг — фронтенд.
   Послуга ↔ пакет ПМГ ↔ коди НК 025 / НК 026 / ЕСОЗ ↔ ОДК.
   Клітинки з кодами показуємо ДОСЛІВНО, підсвічуючи коди як
   посилання; умови («разом з», «за винятком») лише позначаємо.
   Дані: data/mapping_meta.json, data/services.json, data/odk.json.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  /** Українська множина: 1 код · 2 коди · 5 кодів. */
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    const word = a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
    return nf(n) + " " + word;
  }
  const codes = (n) => plural(n, "код", "коди", "кодів");

  /** Хвіст для перехресних посилань: щоб на чужій сторінці була кнопка «Назад». */
  function backTail() {
    if (currentService == null) return "";
    const s = SERVICES[currentService];
    const label = "до послуги " + (s.code || trim(s.name, 28));
    return "&back=" + encodeURIComponent("/mapping/index.html?service=" + currentService) +
      "&backLabel=" + encodeURIComponent(label);
  }

  const COND_LABEL = {
    together: "разом з", except: "за винятком", absent: "за відсутності", or: "або",
  };

  let META = null, SERVICES = null, ODK = null, ready = false;
  let mode = "services";
  const odkById = new Map();

  const el = {
    stats: $("#mpStats"), search: $("#mpSearch"), searchLabel: $("#mpSearchLabel"),
    count: $("#mpCount"), clear: $("#mpClear"), results: $("#mpResults"),
    reader: $("#mpReader"), layout: $(".nk-layout"),
    selPkg: $("#selPkg"), selOdk: $("#selOdk"),
    onlyCond: $("#onlyCond"), onlyNote: $("#onlyNote"),
    filters: $("#mpFilters"), checks: $("#mpChecks"),
  };
  let readerEmptyHTML = "";
  let pendingQuery = false;   // користувач почав шукати ще до завантаження даних
  let currentService = null;  // відкрита картка — для кнопок «назад» у переходах
  let hitCode = "";           // код, за яким шукали — його підсвічуємо в картці

  // ══════════════════════════════════════════════════════════
  // Завантаження
  // ══════════════════════════════════════════════════════════
  async function boot() {
    readerEmptyHTML = el.reader.innerHTML;
    try {
      META = await fetch("data/mapping_meta.json").then((r) => r.json());
    } catch (e) {
      el.count.textContent = "Не вдалося завантажити таблицю.";
      return;
    }
    renderStats();
    populatePackages();
    wireUI();

    // Послідовно, а не Promise.all: services.json важить ~1,5 МБ, і два
    // паралельні великі завантаження ставлять з'єднання в чергу — на слабкій
    // мережі це перетворюється на «Failed to fetch».
    fetch("data/services.json")
      .then((r) => r.json())
      .then((services) => {
        SERVICES = services;
        return fetch("data/odk.json").then((r) => r.json());
      })
      .then((odk) => {
        ODK = odk;
        ODK.forEach((o) => odkById.set(o.id, o));
        populateOdk();
        ready = true;
        onReady();
      })
      .catch(() => { el.count.textContent = "Дані таблиці недоступні. Оновіть сторінку."; });
  }

  function onReady() {
    el.count.textContent = plural(SERVICES.length, "послуга", "послуги", "послуг") + " · введіть запит або оберіть пакет";
    if (pendingQuery || el.search.value.trim()) { runSearch(); return; }
    const q = new URLSearchParams(location.search);
    const raw = (q.get("q") || q.get("code") || "").trim();
    const svc = q.get("service");
    if (svc !== null && SERVICES[+svc]) { openService(+svc); return; }
    if (raw) { el.search.value = raw; runSearch(); }
  }

  function renderStats() {
    const c = META.counters || {};
    const cards = [
      ["Медичних послуг", c.services || 0],
      ["Пакетів ПМГ", c.packages || 0],
      ["Кодів НК 026", c.achi_codes || 0],
      ["ОДК", c.odk || 0],
    ];
    el.stats.innerHTML = cards.map(([k, v]) =>
      `<div class="stat"><span class="stat-num">${nf(v)}</span><span class="stat-key">${k}</span></div>`
    ).join("");
  }

  function populatePackages() {
    const opts = ['<option value="">— усі пакети —</option>'];
    for (const [num, title] of Object.entries(META.packages || {})) {
      opts.push(`<option value="${num}">Пакет ${num}${title ? " · " + esc(trim(title, 60)) : ""}</option>`);
    }
    el.selPkg.innerHTML = opts.join("");
  }

  function populateOdk() {
    const opts = ['<option value="">— будь-яка —</option>'];
    for (const o of ODK) opts.push(`<option value="${esc(o.id)}">${esc(o.id)} · ${esc(trim(o.name, 54))}</option>`);
    el.selOdk.innerHTML = opts.join("");
  }

  // ══════════════════════════════════════════════════════════
  // Пошук і список
  // ══════════════════════════════════════════════════════════
  let timer = null;
  function wireUI() {
    el.search.addEventListener("input", () => {
      clearTimeout(timer); timer = setTimeout(runSearch, 130);
    });
    [el.selPkg, el.selOdk, el.onlyCond, el.onlyNote].forEach((c) =>
      c.addEventListener("change", runSearch));
    el.clear.addEventListener("click", resetForm);
    $$(".mp-mode").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
  }

  function setMode(m) {
    mode = m;
    $$(".mp-mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    const services = m === "services";
    el.filters.hidden = !services;
    el.checks.hidden = !services;
    el.searchLabel.textContent = services
      ? "Пошук за назвою, кодом послуги або кодом класифікатора"
      : "Пошук за назвою ОДК або кодом НК 025";
    el.search.placeholder = services
      ? "Напр.: A15, EКMO, інсульт, 30294-00, I21.0, ОДК 8…"
      : "Напр.: нервової системи, опіки, I21.0…";
    el.search.value = "";
    runSearch();
  }

  /** Чи згадано код у послузі (у будь-якій із колонок). */
  function serviceHasCode(s, code) {
    return s.icd.icd.includes(code) || s.achi.achi.includes(code) ||
      s.achi.esoz.includes(code) || s.achi.loinc.includes(code);
  }

  function runSearch() {
    if (!ready) {
      // Запит, введений поки вантажаться дані, не губимо — виконаємо в onReady()
      pendingQuery = true;
      el.count.textContent = "Дані вантажаться, зачекайте секунду — пошук виконається сам…";
      return;
    }
    pendingQuery = false;
    if (mode === "odk") { runOdkSearch(); return; }

    const raw = el.search.value.trim();
    const q = raw.toLowerCase();
    const codeQ = raw.toUpperCase().replace(/\s+/g, "");
    const pkg = el.selPkg.value, odkRef = el.selOdk.value;
    const out = [];

    let byCode = false;
    for (const s of SERVICES) {
      if (pkg && !s.pkgs.includes(pkg)) continue;
      if (odkRef && !s.icd.odk.includes(odkRef) && !s.achi.odk.includes(odkRef)) continue;
      if (el.onlyCond.checked && !s.icd.cond.length && !s.achi.cond.length) continue;
      if (el.onlyNote.checked && !s.note) continue;

      let score = 10;
      if (q) {
        const name = s.name.toLowerCase();
        if (s.code && s.code.toUpperCase() === codeQ) score = 100;
        else if (serviceHasCode(s, codeQ)) { score = 90; byCode = true; }
        else if (s.code && s.code.toUpperCase().startsWith(codeQ)) score = 70;
        else if (name.startsWith(q)) score = 60;
        else if (name.includes(q)) score = 40;
        else if (s.icd.raw.toLowerCase().includes(q) || s.achi.raw.toLowerCase().includes(q)) score = 20;
        else if ((s.note || "").toLowerCase().includes(q)) score = 15;
        else score = 0;
      }
      if (score > 0) out.push([score, s]);
    }
    hitCode = byCode ? codeQ : "";
    out.sort((a, b) => b[0] - a[0] || a[1].i - b[1].i);
    show(out.map((x) => x[1]).map(serviceRow), out.length, plural(out.length, "послуга", "послуги", "послуг").replace(/^[\d\s]+/, ""));
  }

  function runOdkSearch() {
    const q = el.search.value.trim().toLowerCase();
    const codeQ = el.search.value.trim().toUpperCase().replace(/\s+/g, "");
    const hits = ODK.filter((o) => !q || o.name.toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q) || o.codes.includes(codeQ));
    hitCode = hits.some((o) => o.codes.includes(codeQ)) ? codeQ : "";
    show(hits.map((o) => odkRow(o, o.codes.includes(codeQ))), hits.length, "ОДК");
  }

  const CAP = 400;
  function show(rows, total, what) {
    el.count.textContent = total
      ? `Знайдено ${nf(total)} ${what}${total > CAP ? " · показано " + CAP : ""}`
      : "Нічого не знайдено";
    el.results.innerHTML = rows.slice(0, CAP).join("");
    el.results.hidden = false;
  }

  function serviceRow(s) {
    const cond = [...new Set([...s.icd.cond, ...s.achi.cond])];
    return `<button class="rrow" type="button" data-svc="${s.i}">
      <span class="tcode code">${s.code ? esc(s.code) : "—"}</span>
      <span class="rmain"><span class="tname">${esc(s.name)}</span>
        <span class="rmeta">${s.pkgs.map((p) => "Пакет " + p).join(" · ")}
          ${s.icd.odk.length ? " · " + s.icd.odk.join(", ") : ""}</span></span>
      ${s.achi.achi.length ? `<span class="pk-dot" title="НК 026: ${codes(s.achi.achi.length)}">026</span>` : ""}
      ${cond.length ? `<span class="pk-dot cond" title="Умови: ${cond.map((c) => COND_LABEL[c]).join(", ")}">умова</span>` : ""}
      ${s.note ? `<span class="pk-dot note" title="${escAttr(s.note)}">і</span>` : ""}
    </button>`;
  }

  /** byCode — категорія потрапила в список саме через шуканий код, а не назву.
   *  Без цього підпису незрозуміло, чому рядок тут: назва ж нічого не містить. */
  function odkRow(o, byCode) {
    return `<button class="rrow" type="button" data-odk="${escAttr(o.id)}">
      <span class="tcode code">${esc(o.id)}</span>
      <span class="rmain"><span class="tname">${esc(o.name)}</span>
        <span class="rmeta">${codes(o.codes.length)} НК 025${
      byCode ? " · містить " + esc(hitCode) : ""}</span></span>
      ${byCode ? '<span class="pk-dot hit">є код</span>' : ""}
    </button>`;
  }

  el.results.addEventListener("click", (ev) => {
    const b = ev.target.closest(".rrow");
    if (!b) return;
    $$(".rrow.active").forEach((r) => r.classList.remove("active"));
    b.classList.add("active");
    if (b.dataset.svc !== undefined) openService(+b.dataset.svc);
    else if (b.dataset.odk) openOdk(b.dataset.odk);
  });

  // ══════════════════════════════════════════════════════════
  // Картка послуги
  // ══════════════════════════════════════════════════════════
  /** Оригінальний текст клітинки з кодами-посиланнями.
   *  loincSet — коди LOINC саме цієї клітинки (за розміткою build_mapping.py);
   *  без нього шаблон «12345-6» ловив би й звичайні числа в тексті.
   *  Назву коду показує підказка при наведенні (див. розділ нижче). */
  function decorate(raw, loincSet) {
    if (!raw) return '<span class="muted">—</span>';
    const parts = [];
    let last = 0;
    const rx = /(\d{5}-\d{2})|(ОДК\s*:?\s*\d+[-–—]?[A-ZА-Яa-zа-я]?)|([A-Z]\d{5})\b|(\d{1,5}-\d)\b|([A-ZА-Я]\d{2}(?:\.\d+)?)\b/g;
    let m;
    while ((m = rx.exec(raw))) {
      parts.push(esc(raw.slice(last, m.index)));
      const t = m[0];
      if (m[1]) parts.push(link(`../classifiers/nk026.html?code=${encodeURIComponent(t)}${backTail()}`, t, "code-achi", "Код НК 026"));
      else if (m[2]) parts.push(`<button class="code-chip code-odk" data-odk-open="${escAttr(t)}"${tipTitle("Показати склад ОДК")}>${esc(t)}</button>`);
      else if (m[3]) parts.push(`<span class="code-chip code-esoz"${tipTitle("Код медичної послуги ЕСОЗ")}>${esc(t)}</span>`);
      else if (m[4]) {
        parts.push(loincSet && loincSet.has(t)
          ? link(`../classifiers/loinc.html?code=${encodeURIComponent(t)}`, t, "code-loinc", "Код LOINC — відкрити в довіднику")
          : esc(t));
      }
      else parts.push(link(`../classifiers/index.html?code=${encodeURIComponent(t)}${backTail()}`, t, "code-icd", "Код НК 025"));
      last = m.index + t.length;
    }
    parts.push(esc(raw.slice(last)));
    return parts.join("");
  }

  function link(href, text, cls, title) {
    return `<a class="code-chip ${cls}" href="${href}"${tipTitle(title)}>${esc(text)}</a>`;
  }

  function condBadges(cell) {
    if (!cell.cond.length) return "";
    return `<div class="badge-row">${cell.cond.map((c) =>
      `<span class="cond-badge" title="${escAttr((META.conditions || {})[c] || "")}">${COND_LABEL[c] || c}</span>`).join("")}</div>`;
  }

  function codeCell(title, cell, kind) {
    if (!cell.raw || cell.raw === "-") {
      return `<div class="reader-block"><h3>${title}</h3><p class="muted">У таблиці не зазначено.</p></div>`;
    }
    const stats = [];
    if (kind === "icd" && cell.icd.length) stats.push(codes(cell.icd.length) + " НК 025");
    if (kind === "achi" && cell.achi.length) stats.push(codes(cell.achi.length) + " НК 026");
    if (cell.esoz.length) stats.push(codes(cell.esoz.length) + " послуг ЕСОЗ");
    if (cell.loinc.length) stats.push(`${cell.loinc.length} LOINC`);
    if (cell.odk.length) stats.push(`ОДК: ${cell.odk.join(", ")}`);

    const ranges = cell.ranges.length
      ? `<div class="mp-ranges">Розкрито діапазони: ${cell.ranges.map((r) =>
        `<span class="range-chip">${esc(r.from)}–${esc(r.to)} <em>${nf(r.codes)}</em></span>`).join(" ")}</div>`
      : "";

    const odkBlocks = cell.odk.map((id) => {
      const o = odkById.get(id);
      if (!o) return "";
      return `<details class="mp-odk"><summary>${esc(o.id)} · ${esc(o.name)}
          <span class="odk-count">${codes(o.codes.length)}</span></summary>
        <div class="chip-list odk-codes">${o.codes.map((c) =>
        `<a class="code-chip code-icd" href="../classifiers/index.html?code=${encodeURIComponent(c)}${backTail()}">${esc(c)}</a>`).join("")}</div>
      </details>`;
    }).join("");

    return `<div class="reader-block">
      <h3>${title}${stats.length ? ` <span class="src">${esc(stats.join(" · "))}</span>` : ""}</h3>
      ${condBadges(cell)}
      <div class="mp-raw">${decorate(cell.raw, new Set(cell.loinc || []))}</div>
      ${ranges}
      ${odkBlocks}
    </div>`;
  }

  /** Вагові коефіцієнти ДСГ із додатків 1–2 постанови 1808. */
  function renderCoeffs(s) {
    const drg = s.drg || [];
    if (!drg.length) return "";
    const rows = drg.map((d) => {
      const app = d.ka === "appendix-2" ? "Додаток 2" : "Додаток 1";
      const href = `../postanova/index.html?node=${encodeURIComponent(d.ka || "appendix-1")}` +
        `&q=${encodeURIComponent(d.c)}${backTail()}`;
      if (!d.k || !d.k.length) {
        return `<div class="coef-row"><b>${esc(d.c)}</b>
          <span class="coef-title">${esc(d.t || "")}</span>
          <span class="coef-none">коефіцієнта в додатках немає</span></div>`;
      }
      // Значення прив'язані до колонок додатка; порожню клітинку не показуємо
      // зовсім — у документі це «коефіцієнта за цією колонкою немає».
      // Гілка без підписів лишається запасною: спрацює, якщо збірка колись
      // піде з суцільного тексту, де колонку встановити неможливо.
      const values = d.kl
        ? d.k.map((v, n) => (v
          ? `<span class="coef-val"><em>${esc(v)}</em>${esc(COEF_COLS[d.ka][n])}</span>` : "")).join("")
        : `<span class="coef-raw">${d.k.map(esc).join(" · ")}</span>
           <span class="coef-warn" title="У джерелі порожні клітинки не збереглися — звірте з додатком">колонки не розмічені</span>`;
      return `<div class="coef-row"><b>${esc(d.c)}</b>
        <span class="coef-title">${esc(d.t || "")}</span>
        <span class="coef-values">${values}</span>
        <a class="coef-link" href="${href}" title="Відкрити ${app} постанови 1808">${app} ↗</a></div>`;
    }).join("");
    return `<div class="reader-block coef-block">
      <h3>Вагові коефіцієнти ДСГ <span class="src">постанова 1808, додатки 1–2</span></h3>
      <div class="coef-list">${rows}</div>
    </div>`;
  }

  const COEF_COLS = {
    "appendix-1": ["ваговий", "діти", "травми"],
    "appendix-2": ["ваговий за ДСГ", "діти"],
  };

  function openService(i) {
    const s = SERVICES[i];
    if (!s) return;
    hideTip();            // стара підказка вказувала б на чип, якого вже немає
    currentService = i;
    const pkgChips = s.pkgs.map((p) => {
      const title = (META.packages || {})[p] || "";
      return `<a class="pk-pkg" href="../passport/index.html?package=${encodeURIComponent(p)}${backTail()}"
                 title="${escAttr(title || "Пакет № " + p)}">Пакет № ${p}${title ? " · " + esc(trim(title, 46)) : ""}</a>`;
    }).join("");

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code">${s.code ? esc(s.code) : "—"}</div>
        <div class="reader-level">Медична послуга</div>
        <button class="copy-btn" type="button" data-copy="${escAttr((s.code ? s.code + " — " : "") + s.name)}">⧉ Копіювати</button>
      </div>
      <h2 class="reader-name">${esc(s.name)}</h2>
      <div class="reader-block">
        <h3>Пакети ПМГ</h3>
        <div class="chip-list">${pkgChips}</div>
      </div>
      ${renderCoeffs(s)}
      ${codeCell("Коди хвороб · НК 025", s.icd, "icd")}
      ${codeCell("Коди інтервенцій · НК 026", s.achi, "achi")}
      ${s.note ? `<div class="reader-block"><h3>Додаткова інформація</h3>
          <p class="mp-note">${esc(s.note)}</p></div>` : ""}
      <div class="reader-foot">Таблиця співставлення · рядок ${s.i + 1} з ${SERVICES.length}</div>`;
    warmNames(el.reader.querySelectorAll(".mp-raw .code-chip"), 8);
    $$(".mp-odk", el.reader).forEach((d) => d.addEventListener("toggle", () => {
      if (d.open) warmNames(d.querySelectorAll(".code-chip"), 8);
    }));
    setTab("reader");
    markSearchedCode("box");
  }

  function openOdk(id) {
    const o = odkById.get(id);
    if (!o) return;
    hideTip();
    const users = SERVICES.filter((s) => s.icd.odk.includes(id) || s.achi.odk.includes(id));
    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code">${esc(o.id)}</div>
        <div class="reader-level">Об'єднана діагностична категорія</div>
      </div>
      <h2 class="reader-name">${esc(o.name)}</h2>
      <div class="reader-block">
        <h3>Послуги, що посилаються на цю ОДК <span class="src">${users.length}</span></h3>
        <div class="chip-list">${users.length
        ? users.map((s) => `<button class="subchip" data-goto-svc="${s.i}"><b>${esc(s.code || "—")}</b> ${esc(trim(s.name, 70))}</button>`).join("")
        : '<span class="muted">жодна</span>'}</div>
      </div>
      <div class="reader-block">
        <h3>Коди НК 025 <span class="src">${codes(o.codes.length)}</span></h3>
        <div class="chip-list odk-codes">${o.codes.map((c) =>
      `<a class="code-chip code-icd" href="../classifiers/index.html?code=${encodeURIComponent(c)}">${esc(c)}</a>`).join("")}</div>
      </div>`;
    warmNames(el.reader.querySelectorAll(".odk-codes .code-chip"), 8);
    setTab("reader");
    markSearchedCode("page");
  }

  el.reader.addEventListener("click", (ev) => {
    const openOdkBtn = ev.target.closest("[data-odk-open]");
    if (openOdkBtn) {
      const key = normOdk(openOdkBtn.dataset.odkOpen);
      const found = ODK.find((o) => normOdk(o.id) === key);
      if (found) { setMode("odk"); openOdk(found.id); }
      return;
    }
    const goto = ev.target.closest("[data-goto-svc]");
    if (goto) { setMode("services"); openService(+goto.dataset.gotoSvc); return; }
    const cp = ev.target.closest("[data-copy]");
    if (cp) {
      navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy);
      cp.textContent = "✓ Скопійовано"; setTimeout(() => (cp.textContent = "⧉ Копіювати"), 1400);
    }
  });

  // ══════════════════════════════════════════════════════════
  // Підказка з назвою коду
  // Наведення на чип у картці показує, що це за код. Назви лежать у
  // data/names/ шматками за префіксом коду (збирає build_mapping.py --names):
  // повні класифікатори — це 4,3 МБ, а тут під курсором довантажується один
  // шматок на кілька кілобайт, і той лише раз за сеанс.
  // ══════════════════════════════════════════════════════════
  const HOVER_TIPS = !!(window.matchMedia && window.matchMedia("(hover: hover)").matches);

  /** Нативний title лишаємо лише там, де своєї підказки не буде (сенсорний екран):
   *  інакше поверх неї вилазить друга, системна. */
  function tipTitle(text) { return HOVER_TIPS ? "" : ` title="${escAttr(text)}"`; }

  const KIND_LABEL = {
    icd: "НК 025 · хвороба", achi: "НК 026 · втручання",
    esoz: "Медична послуга ЕСОЗ", loinc: "LOINC · дослідження",
    odk: "Об'єднана діагностична категорія",
  };
  const KIND_HINT = {
    icd: "натисніть, щоб відкрити код у класифікаторі НК 025",
    achi: "натисніть, щоб відкрити код у класифікаторі НК 026",
    loinc: "натисніть, щоб відкрити код у довіднику LOINC",
    odk: "натисніть, щоб побачити склад категорії",
  };

  const nameCache = new Map();   // "icd:I21.0" → назва ("" — назви немає)
  const shardJobs = new Map();   // "icd_I2" → Promise завантаження
  let namesIndex = null, namesIndexJob = null;

  function namesReady() {
    if (namesIndex) return Promise.resolve(namesIndex);
    if (!namesIndexJob) {
      namesIndexJob = fetch("data/names/index.json")
        .then((r) => r.json())
        .catch(() => ({ shards: {} }))
        .then((j) => (namesIndex = j && j.shards ? j : { shards: {} }));
    }
    return namesIndexJob;
  }

  /** Найдовший префікс-шматок, що покриває код («I21.0» → «I2»). */
  function shardOf(kind, code) {
    const keys = (namesIndex && namesIndex.shards[kind]) || [];
    if (keys.length === 1 && keys[0] === "all") return "all";
    let best = null;
    for (const k of keys) if (code.indexOf(k) === 0 && (!best || k.length > best.length)) best = k;
    return best;
  }

  function loadShard(kind, key) {
    const id = kind + "_" + key;
    if (!shardJobs.has(id)) {
      shardJobs.set(id, fetch(`data/names/${id}.json`)
        .then((r) => r.json())
        .then((map) => Object.keys(map).forEach((c) => nameCache.set(kind + ":" + c, map[c])))
        .catch(() => {}));
    }
    return shardJobs.get(id);
  }

  /** Назва коду: рядок, якщо вона вже в пам'яті, інакше Promise з назвою. */
  function codeName(kind, code) {
    const key = kind + ":" + code;
    if (nameCache.has(key)) return nameCache.get(key);
    return namesReady().then(() => {
      const shard = shardOf(kind, code);
      if (!shard) { nameCache.set(key, ""); return ""; }
      return loadShard(kind, shard).then(() => {
        if (!nameCache.has(key)) nameCache.set(key, "");
        return nameCache.get(key);
      });
    });
  }

  const tipBox = HOVER_TIPS ? document.createElement("div") : null;
  let tipChip = null, tipTimer = null;
  if (tipBox) {
    tipBox.className = "code-tip";
    tipBox.setAttribute("role", "tooltip");
    tipBox.hidden = true;
    document.body.appendChild(tipBox);
  }

  function chipKind(node) {
    for (const k in KIND_LABEL) if (node.classList.contains("code-" + k)) return k;
    return null;
  }

  /** value: назва рядком або [код рубрики, її назва] — коли точного коду в
   *  класифікаторі немає (підкоди МКХ-10, яких НК 025 не має). */
  function fillTip(kind, code, value, pending) {
    const rubric = Array.isArray(value) ? value[0] : "";
    const name = Array.isArray(value) ? value[1] : value;
    const hint = KIND_HINT[kind];
    tipBox.innerHTML =
      `<span class="tip-kind">${esc(KIND_LABEL[kind] || "Код")}</span>` +
      `<span class="tip-code">${esc(code)}</span>` +
      `<span class="tip-name">${name ? esc(name)
        : `<em>${pending ? "шукаємо назву…" : "назви в довіднику немає"}</em>`}</span>` +
      (rubric ? `<span class="tip-note">точного коду в НК 025 немає — це назва рубрики ${esc(rubric)}</span>` : "") +
      (hint ? `<span class="tip-hint">${esc(hint)}</span>` : "");
  }

  /** Під кодом, а якщо там немає місця — над ним; у межах вікна. */
  function placeTip(chip) {
    tipBox.hidden = false;
    tipBox.style.left = "0px";
    tipBox.style.top = "0px";
    const r = chip.getBoundingClientRect(), t = tipBox.getBoundingClientRect(), pad = 8;
    const left = Math.min(Math.max(pad, r.left), Math.max(pad, window.innerWidth - t.width - pad));
    let top = r.bottom + 6;
    if (top + t.height > window.innerHeight - pad) top = Math.max(pad, r.top - t.height - 6);
    tipBox.style.left = Math.round(left) + "px";
    tipBox.style.top = Math.round(top) + "px";
  }

  function openTip(chip) {
    const kind = chipKind(chip);
    if (!kind) return;
    tipChip = chip;
    const code = chip.textContent.trim();
    if (kind === "odk") {
      const o = ODK && ODK.find((x) => normOdk(x.id) === normOdk(code));
      fillTip(kind, code, o ? `${o.name} · ${codes(o.codes.length)} НК 025` : "");
      placeTip(chip);
      return;
    }
    const found = codeName(kind, code);
    if (!found || typeof found.then !== "function") {
      fillTip(kind, code, found); placeTip(chip); return;
    }
    fillTip(kind, code, "", true);
    placeTip(chip);
    found.then((value) => {
      if (tipChip !== chip) return;        // курсор уже поїхав далі
      fillTip(kind, code, value);
      placeTip(chip);
    });
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipChip = null;
    if (tipBox) tipBox.hidden = true;
  }

  /** Тихо тягнемо шматки для кодів, що вже на екрані, — щоб перша підказка
   *  не чекала на мережу. Обмеження: картка з ОДК має коди на весь алфавіт. */
  function warmNames(nodes, cap) {
    if (!tipBox || !nodes || !nodes.length) return;
    const run = () => namesReady().then(() => {
      const want = new Set();
      for (const n of nodes) {
        const kind = chipKind(n);
        if (!kind || kind === "odk") continue;
        const shard = shardOf(kind, n.textContent.trim());
        if (shard) want.add(kind + " " + shard);
        if (want.size >= (cap || 6)) break;
      }
      want.forEach((id) => loadShard(id.split(" ")[0], id.split(" ")[1]));
    });
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 900 });
    else setTimeout(run, 60);
  }

  if (tipBox) {
    el.reader.addEventListener("mouseover", (ev) => {
      const chip = ev.target.closest(".code-chip");
      if (!chip || chip === tipChip) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => openTip(chip), 120);
    });
    el.reader.addEventListener("mouseout", (ev) => {
      if (ev.target.closest(".code-chip")) hideTip();
    });
    el.reader.addEventListener("focusin", (ev) => {
      const chip = ev.target.closest(".code-chip");
      if (chip) openTip(chip);
    });
    el.reader.addEventListener("focusout", hideTip);
    el.reader.addEventListener("click", hideTip);
    window.addEventListener("scroll", hideTip, true);
    window.addEventListener("resize", hideTip);
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") hideTip(); });
  }

  // ══════════════════════════════════════════════════════════
  // Підсвітка коду, за яким шукали
  // У картці ОДК перелік буває на 1 117 чипів — без підсвітки й прокрутки
  // незрозуміло, куди дивитися і чому категорія взагалі знайшлася.
  // ══════════════════════════════════════════════════════════
  /** scroll: "page" — довести код до середини екрана (довідник ОДК);
   *          "box"  — прокрутити лише сам перелік, не смикаючи сторінку. */
  function markSearchedCode(scroll) {
    if (!hitCode) return;
    const all = $$(".code-chip", el.reader);
    // Точний збіг, а якщо його немає — коди рубрики («I21» → I21.0, I21.1…)
    let chips = all.filter((c) => c.textContent.trim() === hitCode);
    if (!chips.length) chips = all.filter((c) => c.textContent.trim().indexOf(hitCode + ".") === 0);
    if (!chips.length) return;
    chips.forEach((c) => c.classList.add("code-hit"));

    const first = chips[0];
    const box = first.closest(".mp-raw, .odk-codes");
    if (box && box.scrollHeight > box.clientHeight) {
      const cr = first.getBoundingClientRect(), br = box.getBoundingClientRect();
      box.scrollTop += (cr.top - br.top) - (box.clientHeight - cr.height) / 2;
    }
    // Без behavior:"smooth" — плавну прокрутку браузер мовчки ігнорує, якщо
    // вкладка не малює кадри, і код лишається за межами екрана.
    if (scroll === "page") first.scrollIntoView({ block: "center" });
  }

  /** «ОДК 23-А», «ОДК 23А» → «23A» (у таблиці сусідять кирилична й латинська літери). */
  function normOdk(s) {
    return String(s).toUpperCase().replace("ОДК", "").replace(/[\s:\-–—]+/g, "")
      .replace(/[АВСЕКМНОРТХІ]/g, (c) => "ABCEKMHOPTXI"["АВСЕКМНОРТХІ".indexOf(c)]);
  }

  // ══════════════════════════════════════════════════════════
  function resetForm() {
    hideTip();
    hitCode = "";
    el.search.value = ""; el.selPkg.value = ""; el.selOdk.value = "";
    el.onlyCond.checked = false; el.onlyNote.checked = false;
    el.results.hidden = true; el.results.innerHTML = "";
    el.reader.classList.add("reader-empty");
    el.reader.innerHTML = readerEmptyHTML;
    el.count.textContent = ready
      ? plural(SERVICES.length, "послуга", "послуги", "послуг") + " · введіть запит або оберіть пакет"
      : "Завантаження…";
    setTab("browser");
    el.search.focus();
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
