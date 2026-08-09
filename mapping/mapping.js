/* ============================================================
   Таблиця співставлення медичних послуг — фронтенд.
   Послуга ↔ пакет ПМГ ↔ коди НК 025 / НК 026 / ЕСОЗ ↔ ОДК.

   Розкладка — три колонки, як у самому документі:
     ліворуч  — пошук у колонці «Коди хвороб» (НК 025 + ОДК),
     праворуч — пошук у колонці «Коди інтервенцій» (НК 026, ЕСОЗ, LOINC),
     посередині — картка обраної послуги з усією інформацією.
   Колонки незалежні: свій запит, свої фільтри, свій список; обидві
   відкривають картку в центрі.

   Клітинки з кодами показуємо ДОСЛІВНО, підсвічуючи коди як посилання;
   умови («разом з», «за винятком») лише позначаємо.
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

  /** Підписи колонок — у списках, підказках і перекиданні запиту між ними. */
  const SIDE = {
    icd: { title: "Коди хвороб · НК 025", short: "НК 025", ico: "🩺" },
    achi: { title: "Коди інтервенцій · НК 026", short: "НК 026", ico: "🔧" },
  };
  const other = (side) => (side === "icd" ? "achi" : "icd");

  let META = null, SERVICES = null, ODK = null, ready = false;
  const odkById = new Map();
  const odkIndex = new Map();   // id → {set, rubrics} для пошуку коду «через ОДК»

  const el = {
    stats: $("#mpStats"),
    reader: $("#mpReader"), layout: $(".nk-layout"),
  };
  let readerEmptyHTML = "";
  let currentService = null;  // відкрита картка — для кнопок «назад» у переходах
  let cardHit = "";           // код, за яким шукали — його підсвічуємо в картці

  const panes = {};

  // ══════════════════════════════════════════════════════════
  // Завантаження
  // ══════════════════════════════════════════════════════════
  async function boot() {
    readerEmptyHTML = el.reader.innerHTML;
    try {
      META = await fetch("data/mapping_meta.json").then((r) => r.json());
    } catch (e) {
      eachPane((p) => (p.els.count.textContent = "Не вдалося завантажити таблицю."));
      return;
    }
    renderStats();
    initPane("icd");
    initPane("achi");
    populatePackages();
    wireTabs();

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
        ODK.forEach((o) => {
          odkById.set(o.id, o);
          const set = new Set(o.codes), rubrics = new Set();
          o.codes.forEach((c) => rubrics.add(c.split(".")[0]));
          odkIndex.set(o.id, { set, rubrics });
        });
        populateOdk();
        ready = true;
        onReady();
      })
      .catch(() => {
        eachPane((p) => (p.els.count.textContent = "Дані таблиці недоступні. Оновіть сторінку."));
      });
  }

  function onReady() {
    eachPane((p) => { p.els.count.textContent = idleCount(); });
    // Запит, введений поки вантажилися дані, не губимо
    const typed = Object.values(panes).filter((p) => p.pending || p.els.search.value.trim());
    if (typed.length) { typed.forEach(runPane); return; }

    const q = new URLSearchParams(location.search);
    const svc = q.get("service");
    if (svc !== null && SERVICES[+svc]) { openService(+svc); return; }

    const odkRef = (q.get("odk") || "").trim();
    if (odkRef) {
      const found = ODK.find((o) => normOdk(o.id) === normOdk(odkRef));
      if (found) { setMode(panes.icd, "odk"); openOdk(found.id); return; }
    }

    const raw = (q.get("q") || q.get("code") || "").trim();
    if (raw) {
      const p = panes[sniffSide(raw)];
      p.els.search.value = raw;
      runPane(p);
    }
  }

  /** У яку колонку класти зовнішній запит: код втручання / ЕСОЗ / LOINC —
   *  праворуч, усе інше (діагноз, ОДК, код чи назва послуги) — ліворуч. */
  function sniffSide(raw) {
    const t = raw.toUpperCase().replace(/\s+/g, "");
    if (/^\d{5}-\d{2}$/.test(t)) return "achi";          // НК 026
    if (/^[A-Z]\d{5}$/.test(t)) return "achi";           // послуга ЕСОЗ
    if (/^\d{1,5}-\d$/.test(t)) return "achi";           // LOINC
    return "icd";
  }

  function renderStats() {
    const c = META.counters || {};
    const cards = [
      ["Медичних послуг", c.services || 0],
      ["Пакетів ПМГ", c.packages || 0],
      ["Кодів НК 025", c.icd_codes || 0],
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
    eachPane((p) => { p.els.pkg.innerHTML = opts.join(""); });
  }

  function populateOdk() {
    const opts = ['<option value="">— будь-яка —</option>'];
    for (const o of ODK) opts.push(`<option value="${esc(o.id)}">${esc(o.id)} · ${esc(trim(o.name, 54))}</option>`);
    panes.icd.els.odk.innerHTML = opts.join("");
  }

  const idleCount = () => plural(SERVICES.length, "послуга", "послуги", "послуг") +
    " · введіть запит або оберіть пакет";

  // ══════════════════════════════════════════════════════════
  // Колонка пошуку (їх дві — ліва по хворобах, права по втручаннях)
  // ══════════════════════════════════════════════════════════
  function initPane(side) {
    const els = {
      search: $("#" + side + "Search"), label: $("#" + side + "SearchLabel"),
      count: $("#" + side + "Count"), clear: $("#" + side + "Clear"),
      results: $("#" + side + "Results"), pkg: $("#" + side + "Pkg"),
      odk: $("#" + side + "Odk"), kind: $("#" + side + "Kind"),
      cond: $("#" + side + "Cond"), codesOnly: $("#" + side + "Codes"),
      note: $("#" + side + "Note"), filters: $("#" + side + "Filters"),
      checks: $("#" + side + "Checks"), hint: $("#" + side + "Hint"),
      pane: $(".mp-pane-" + side),
    };
    const p = { side, els, mode: "services", hit: "", pending: false, timer: null };
    panes[side] = p;

    els.search.addEventListener("input", () => {
      clearTimeout(p.timer);
      p.timer = setTimeout(() => runPane(p), 130);
    });
    [els.pkg, els.odk, els.kind, els.cond, els.codesOnly, els.note].forEach((c) =>
      c && c.addEventListener("change", () => runPane(p)));
    els.clear.addEventListener("click", () => resetPane(p));
    $$(".mp-mode", els.pane).forEach((b) =>
      b.addEventListener("click", () => setMode(p, b.dataset.mode)));

    els.results.addEventListener("click", (ev) => {
      const b = ev.target.closest(".rrow");
      if (!b) return;
      $$(".rrow.active").forEach((r) => r.classList.remove("active"));
      b.classList.add("active");
      if (b.dataset.svc !== undefined) { cardHit = p.hit; openService(+b.dataset.svc); }
      else if (b.dataset.odk) { cardHit = p.hit; openOdk(b.dataset.odk); }
    });

    els.hint.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-send]");
      if (!b) return;
      const dst = panes[b.dataset.send];
      dst.els.search.value = b.dataset.q;
      if (dst.mode !== "services") setMode(dst, "services");
      else runPane(dst);
      setTab(dst.side);
      dst.els.search.focus();
    });
  }

  const eachPane = (fn) => Object.values(panes).forEach(fn);

  function setMode(p, m) {
    p.mode = m;
    $$(".mp-mode", p.els.pane).forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    const services = m === "services";
    p.els.filters.hidden = !services;
    p.els.checks.hidden = !services;
    p.els.label.textContent = services
      ? "Код хвороби, ОДК або назва послуги"
      : "Назва категорії або код НК 025";
    p.els.search.placeholder = services
      ? "Напр.: I21.0, I21, ОДК 8, інсульт, A15…"
      : "Напр.: нервової системи, опіки, I21.0, I21…";
    p.els.search.value = "";
    runPane(p);
  }

  const cellOf = (s, side) => (side === "icd" ? s.icd : s.achi);
  const cellEmpty = (cell) => !cell.raw || cell.raw === "-";
  /** Рубрика без крапки: «I21» покриває I21.0, I21.1… */
  const isRubric = (t) => /^[A-ZА-Я]\d{2}$/.test(t);

  /** Код зустрічається в клітинці цієї колонки. */
  function cellHasCode(cell, code) {
    return cell.icd.includes(code) || cell.achi.includes(code) ||
      cell.esoz.includes(code) || cell.loinc.includes(code);
  }
  function cellHasRubric(cell, code) {
    const pre = code + ".";
    return cell.icd.some((c) => c.indexOf(pre) === 0);
  }
  /** Код заведено не напряму, а через ОДК, на яку посилається клітинка.
   *  Саме так у таблиці описано більшість пакетів, тож без цієї гілки пошук
   *  за діагнозом чесно казав би «нічого не знайдено». */
  function cellViaOdk(cell, code, rubric) {
    for (const id of cell.odk) {
      const ix = odkIndex.get(id);
      if (!ix) continue;
      if (ix.set.has(code) || (rubric && ix.rubrics.has(code))) return id;
    }
    return "";
  }

  /** Оцінка збігу в межах ОДНІЄЇ колонки. score 0 — не показувати. */
  function scoreService(s, side, q, codeQ) {
    const cell = cellOf(s, side);
    const bonus = cellEmpty(cell) ? 0 : 1;   // порожня колонка — у кінець списку
    if (!q) return { score: 10 + bonus };
    if (s.code && s.code.toUpperCase() === codeQ) return { score: 100 + bonus };
    if (cellHasCode(cell, codeQ)) return { score: 92, hit: codeQ };
    const rubric = isRubric(codeQ);
    if (rubric && cellHasRubric(cell, codeQ)) return { score: 86, hit: codeQ };
    const via = cellViaOdk(cell, codeQ, rubric);
    if (via) return { score: 80, hit: codeQ, via };
    const name = s.name.toLowerCase();
    if (s.code && s.code.toUpperCase().indexOf(codeQ) === 0) return { score: 70 + bonus };
    if (name.indexOf(q) === 0) return { score: 60 + bonus };
    if (name.indexOf(q) >= 0) return { score: 40 + bonus };
    if (cell.raw.toLowerCase().indexOf(q) >= 0) return { score: 20 };
    if ((s.note || "").toLowerCase().indexOf(q) >= 0) return { score: 15 + bonus };
    return { score: 0 };
  }

  function runPane(p) {
    if (!ready) {
      p.pending = true;
      p.els.count.textContent = "Дані вантажаться, зачекайте секунду — пошук виконається сам…";
      return;
    }
    p.pending = false;
    if (p.mode === "odk") { runOdkSearch(p); return; }

    const raw = p.els.search.value.trim();
    const q = raw.toLowerCase();
    const codeQ = raw.toUpperCase().replace(/\s+/g, "");
    const pkg = p.els.pkg.value;
    const odkRef = p.els.odk ? p.els.odk.value : "";
    const kind = p.els.kind ? p.els.kind.value : "";
    const out = [];
    let hit = "";

    for (const s of SERVICES) {
      const cell = cellOf(s, p.side);
      if (pkg && !s.pkgs.includes(pkg)) continue;
      if (odkRef && !cell.odk.includes(odkRef)) continue;
      if (kind && !cell[kind].length) continue;
      if (p.els.cond && p.els.cond.checked && !cell.cond.length) continue;
      if (p.els.codesOnly && p.els.codesOnly.checked && !cell.icd.length && !cell.odk.length) continue;
      if (p.els.note && p.els.note.checked && !s.note) continue;

      const r = scoreService(s, p.side, q, codeQ);
      if (r.score > 0) { out.push([r.score, s, r.via]); if (r.hit) hit = r.hit; }
    }
    p.hit = hit;
    out.sort((a, b) => b[0] - a[0] || a[1].i - b[1].i);
    show(p, out.map((x) => serviceRow(x[1], p.side, x[2])), out.length,
      plural(out.length, "послуга", "послуги", "послуг").replace(/^[\d\s]+/, ""));
    crossHint(p, raw, q, codeQ, out.length);
  }

  function runOdkSearch(p) {
    const raw = p.els.search.value.trim();
    const q = raw.toLowerCase();
    const codeQ = raw.toUpperCase().replace(/\s+/g, "");
    const rubric = isRubric(codeQ);
    const hits = [];
    for (const o of ODK) {
      const ix = odkIndex.get(o.id);
      const byCode = !!q && (ix.set.has(codeQ) || (rubric && ix.rubrics.has(codeQ)));
      if (!q || byCode || o.name.toLowerCase().indexOf(q) >= 0 ||
        normOdk(o.id).indexOf(normOdk(raw)) === 0) hits.push([o, byCode]);
    }
    p.hit = hits.some((h) => h[1]) ? codeQ : "";
    show(p, hits.map(([o, byCode]) => odkRow(o, byCode, p.hit)), hits.length, "ОДК");
    p.els.hint.hidden = true;
  }

  const CAP = 400;
  function show(p, rows, total, what) {
    p.els.count.textContent = total
      ? `Знайдено ${nf(total)} ${what}${total > CAP ? " · показано " + CAP : ""}`
      : "Нічого не знайдено";
    p.els.results.innerHTML = rows.slice(0, CAP).join("");
    p.els.results.hidden = false;
    markActiveRows();
  }

  /** «Шукали не в тій колонці» — найчастіша розгубленість: код втручання в
   *  колонці хвороб дає порожньо. Мовчати про це не варто, тож коли своя
   *  колонка порожня, а сусідня щось знайшла, пропонуємо перекинути запит. */
  function crossHint(p, raw, q, codeQ, total) {
    const box = p.els.hint;
    if (!raw || total) { box.hidden = true; return; }
    const o = other(p.side);
    let n = 0;
    for (const s of SERVICES) if (scoreService(s, o, q, codeQ).score > 0) n++;
    if (!n) { box.hidden = true; return; }
    box.innerHTML = `<span>${SIDE[o].ico} У колонці «${esc(SIDE[o].short)}» —
      ${plural(n, "збіг", "збіги", "збігів")}.</span>
      <button type="button" data-send="${o}" data-q="${escAttr(raw)}">Шукати там →</button>`;
    box.hidden = false;
  }

  /** Рядок списку показує саме СВОЮ колонку: ліворуч — коди хвороб і ОДК,
   *  праворуч — втручання, ЕСОЗ, LOINC. Інакше два списки виглядали б однаково. */
  function serviceRow(s, side, via) {
    const cell = cellOf(s, side);
    const bits = [s.pkgs.map((p) => "Пакет " + p).join(" · ")];
    if (side === "icd") {
      if (cell.icd.length) bits.push(codes(cell.icd.length) + " НК 025");
      if (cell.odk.length) {
        bits.push(cell.odk.length > 3
          ? plural(cell.odk.length, "категорія", "категорії", "категорій") + " ОДК"
          : cell.odk.join(", "));
      }
    } else {
      if (cell.achi.length) bits.push(codes(cell.achi.length) + " НК 026");
      if (cell.esoz.length) bits.push(cell.esoz.length + " ЕСОЗ");
      if (cell.loinc.length) bits.push(cell.loinc.length + " LOINC");
    }
    if (cellEmpty(cell)) bits.push("у цій колонці не зазначено");

    return `<button class="rrow${cellEmpty(cell) ? " rrow-dim" : ""}" type="button" data-svc="${s.i}">
      <span class="tcode code">${s.code ? esc(s.code) : "—"}</span>
      <span class="rmain"><span class="tname">${esc(s.name)}</span>
        <span class="rmeta">${esc(bits.join(" · "))}</span></span>
      ${via ? `<span class="pk-dot via" title="Код заведено через категорію ${escAttr(via)}">через ОДК</span>` : ""}
      ${cell.cond.length ? `<span class="pk-dot cond" title="Умови: ${cell.cond.map((c) => COND_LABEL[c]).join(", ")}">умова</span>` : ""}
      ${s.note ? `<span class="pk-dot note" title="${escAttr(s.note)}">і</span>` : ""}
    </button>`;
  }

  /** byCode — категорія потрапила в список саме через шуканий код, а не назву.
   *  Без цього підпису незрозуміло, чому рядок тут: назва ж нічого не містить. */
  function odkRow(o, byCode, hit) {
    return `<button class="rrow" type="button" data-odk="${escAttr(o.id)}">
      <span class="tcode code">${esc(o.id)}</span>
      <span class="rmain"><span class="tname">${esc(o.name)}</span>
        <span class="rmeta">${codes(o.codes.length)} НК 025${
      byCode ? " · містить " + esc(hit) : ""}</span></span>
      ${byCode ? '<span class="pk-dot hit">є код</span>' : ""}
    </button>`;
  }

  /** Відкрита послуга підсвічується в обох списках — видно, що це той самий рядок. */
  function markActiveRows() {
    $$(".rrow.active").forEach((r) => r.classList.remove("active"));
    if (currentService == null) return;
    $$(`.rrow[data-svc="${currentService}"]`).forEach((r) => r.classList.add("active"));
  }

  function resetPane(p) {
    p.hit = "";
    p.els.search.value = "";
    p.els.pkg.value = "";
    if (p.els.odk) p.els.odk.value = "";
    if (p.els.kind) p.els.kind.value = "";
    if (p.els.cond) p.els.cond.checked = false;
    if (p.els.codesOnly) p.els.codesOnly.checked = false;
    if (p.els.note) p.els.note.checked = false;
    p.els.results.hidden = true;
    p.els.results.innerHTML = "";
    p.els.hint.hidden = true;
    p.els.count.textContent = ready ? idleCount() : "Завантаження…";
    p.els.search.focus();
  }

  // ══════════════════════════════════════════════════════════
  // Картка послуги (центральна колонка)
  // ══════════════════════════════════════════════════════════
  /** Оригінальний текст клітинки з кодами-посиланнями.
   *  loincSet — коди LOINC саме цієї клітинки (за розміткою build_mapping.py);
   *  без нього шаблон «12345-6» ловив би й звичайні числа в тексті.
   *  Назву коду показує підказка при наведенні (див. розділ нижче). */
  function decorate(raw, loincSet) {
    if (!raw) return '<span class="muted">—</span>';
    const parts = [];
    let last = 0;
    // Гілка (?:\s*[-–—]\s*\d+)? ловить діапазон «ОДК 1-22» цілим: без неї чипом
    // ставало «ОДК 1-», а «22» лишалося голим текстом.
    const rx = /(\d{5}-\d{2})|(ОДК\s*:?\s*\d+(?:\s*[-–—]\s*\d+)?[-–—]?[A-ZА-Яa-zа-я]?)|([A-Z]\d{5})\b|(\d{1,5}-\d)\b|([A-ZА-Я]\d{2}(?:\.\d+)?)\b/g;
    let m;
    while ((m = rx.exec(raw))) {
      parts.push(esc(raw.slice(last, m.index)));
      const t = m[0];
      if (m[1]) parts.push(link(`../classifiers/nk026.html?code=${encodeURIComponent(t)}${backTail()}`, t, "code-achi", "Код НК 026"));
      else if (m[2]) {
        // Діапазон («ОДК 1-22») однією карткою не відкриєш — його склад лежить
        // нижче окремими блоками, тож чип лишається просто позначкою.
        parts.push(/\d\s*[-–—]\s*\d/.test(t)
          ? `<span class="code-chip code-odk code-odk-range"${tipTitle("Діапазон категорій ОДК — склад нижче")}>${esc(t)}</span>`
          : `<button class="code-chip code-odk" data-odk-open="${escAttr(t)}"${tipTitle("Показати склад ОДК")}>${esc(t)}</button>`);
      }
      // Свого довідника послуг ЕСОЗ у порталі немає, тому код вів у нікуди й
      // лишався мертвим чипом. Тепер веде в «Хто це лікує» — там за ним видно
      // пакети й законтрактовані заклади.
      else if (m[3]) parts.push(link(`../zoz-poshuk/index.html?q=${encodeURIComponent(t)}`, t,
        "code-esoz", "Код медичної послуги ЕСОЗ — показати законтрактовані заклади"));
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
    if (cellEmpty(cell)) {
      return `<div class="reader-block mp-cell mp-cell-${kind}"><h3>${title}</h3>
        <p class="muted">У таблиці не зазначено.</p></div>`;
    }
    const stats = [];
    if (kind === "icd" && cell.icd.length) stats.push(codes(cell.icd.length) + " НК 025");
    if (kind === "achi" && cell.achi.length) stats.push(codes(cell.achi.length) + " НК 026");
    if (cell.esoz.length) stats.push(codes(cell.esoz.length) + " послуг ЕСОЗ");
    if (cell.loinc.length) stats.push(`${cell.loinc.length} LOINC`);
    // Діапазон дає два десятки категорій — перелічувати їх у шапці немає сенсу
    if (cell.odk.length) {
      stats.push(cell.odk.length > 6
        ? plural(cell.odk.length, "категорія", "категорії", "категорій") + " ОДК"
        : `ОДК: ${cell.odk.join(", ")}`);
    }

    const ranges = cell.ranges.length
      ? `<div class="mp-ranges">Розкрито діапазони: ${cell.ranges.map((r) =>
        `<span class="range-chip">${esc(r.from)}–${esc(r.to)} <em>${nf(r.codes)}</em></span>`).join(" ")}</div>`
      : "";

    // Коди категорій малюємо лише на розкриття (див. fillOdkCodes): клітинка
    // «ОДК 1-22» тягне 23 категорії — це понад 14 тисяч чипів, і вкладати їх
    // у DOM наперед означало б секунду затримки на кожній такій послузі.
    const odkBlocks = cell.odk.map((id) => {
      const o = odkById.get(id);
      if (!o) return "";
      return `<details class="mp-odk" data-odk-codes="${escAttr(o.id)}">
        <summary>${esc(o.id)} · ${esc(o.name)}
          <span class="odk-count">${codes(o.codes.length)}</span></summary>
        <div class="chip-list odk-codes"></div>
      </details>`;
    }).join("");

    return `<div class="reader-block mp-cell mp-cell-${kind}">
      <h3>${title}${stats.length ? ` <span class="src">${esc(stats.join(" · "))}</span>` : ""}</h3>
      ${condBadges(cell)}
      <div class="mp-raw">${decorate(cell.raw, new Set(cell.loinc || []))}</div>
      ${ranges}
      ${odkBlocks}
    </div>`;
  }

  /** Коди категорії — у розкритий блок; підсвітку шуканого коду теж застосовуємо
   *  тут, бо на момент відкриття картки чипів у блоці ще немає. */
  function fillOdkCodes(details) {
    const box = $(".odk-codes", details);
    const o = odkById.get(details.dataset.odkCodes);
    if (!box || !o || box.childElementCount) return;
    box.innerHTML = o.codes.map((c) =>
      `<a class="code-chip code-icd" href="../classifiers/index.html?code=${encodeURIComponent(c)}${backTail()}">${esc(c)}</a>`
    ).join("");
    markSearchedCode("box");
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
      ${codeCell("🩺 Коди хвороб · НК 025", s.icd, "icd")}
      ${codeCell("🔧 Коди інтервенцій · НК 026", s.achi, "achi")}
      ${s.note ? `<div class="reader-block"><h3>Додаткова інформація</h3>
          <p class="mp-note">${esc(s.note)}</p></div>` : ""}
      <div class="reader-foot">Таблиця співставлення · рядок ${s.i + 1} з ${SERVICES.length}</div>`;
    warmNames(el.reader.querySelectorAll(".mp-raw .code-chip"), 8);
    $$(".mp-odk", el.reader).forEach((d) => d.addEventListener("toggle", () => {
      if (!d.open) return;
      fillOdkCodes(d);
      warmNames(d.querySelectorAll(".code-chip"), 8);
    }));
    setTab("card");
    markActiveRows();
    // Шуканого коду може не бути в самій клітинці — він усередині ОДК; тоді
    // розкриваємо потрібну категорію, інакше картка виглядає так, ніби коду тут немає.
    if (!markSearchedCode("box")) revealOdkWithHit(s);
  }

  function revealOdkWithHit(s) {
    if (!cardHit) return;
    const rubric = isRubric(cardHit);
    const id = cellViaOdk(s.icd, cardHit, rubric) || cellViaOdk(s.achi, cardHit, rubric);
    if (!id) return;
    const d = $$(".mp-odk", el.reader).find((x) => x.dataset.odkCodes === id);
    if (d) d.open = true;   // toggle-слухач домалює коди й підсвітить шуканий
  }

  function openOdk(id) {
    const o = odkById.get(id);
    if (!o) return;
    hideTip();
    currentService = null;
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
    setTab("card");
    markActiveRows();
    markSearchedCode("page");
  }

  el.reader.addEventListener("click", (ev) => {
    const openOdkBtn = ev.target.closest("[data-odk-open]");
    if (openOdkBtn) {
      const key = normOdk(openOdkBtn.dataset.odkOpen);
      const found = ODK.find((o) => normOdk(o.id) === key);
      if (found) { setMode(panes.icd, "odk"); openOdk(found.id); }
      return;
    }
    const goto = ev.target.closest("[data-goto-svc]");
    if (goto) { openService(+goto.dataset.gotoSvc); return; }
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
    odkrange: "Діапазон категорій ОДК",
  };
  const KIND_HINT = {
    icd: "натисніть, щоб відкрити код у класифікаторі НК 025",
    achi: "натисніть, щоб відкрити код у класифікаторі НК 026",
    loinc: "натисніть, щоб відкрити код у довіднику LOINC",
    odk: "натисніть, щоб побачити склад категорії",
    odkrange: "склад кожної категорії — блоками нижче",
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
    if (node.classList.contains("code-odk-range")) return "odkrange";
    for (const k in KIND_LABEL) if (node.classList.contains("code-" + k)) return k;
    return null;
  }

  /** «ОДК 1-22» → реальні категорії діапазону. Правило те саме, що в
   *  build_mapping.py: номер із власною категорією бере саме її («ОДК 23»),
   *  номер без неї — усі свої літерні («21» → 21A і 21B). */
  function odkRange(text) {
    const m = /(\d+)\s*[-–—]\s*(\d+)/.exec(text);
    if (!m || !ODK) return [];
    const num = (o) => (/^\d+/.exec(normOdk(o.id)) || [""])[0];
    const out = [];
    for (let n = +m[1]; n <= +m[2]; n++) {
      const exact = ODK.find((o) => normOdk(o.id) === String(n));
      if (exact) out.push(exact);
      else out.push(...ODK.filter((o) => num(o) === String(n)));
    }
    return out;
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
    if (kind === "odkrange") {
      const list = odkRange(code);
      const total = list.reduce((n, o) => n + o.codes.length, 0);
      fillTip(kind, code, list.length
        ? `${plural(list.length, "категорія", "категорії", "категорій")} · ${codes(total)} НК 025: ${list.map((o) => o.id).join(", ")}`
        : "");
      placeTip(chip);
      return;
    }
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
   *          "box"  — прокрутити лише сам перелік, не смикаючи сторінку.
   *  Повертає true, якщо код у картці знайшовся. */
  function markSearchedCode(scroll) {
    if (!cardHit) return false;
    const all = $$(".code-chip", el.reader);
    // Точний збіг, а якщо його немає — коди рубрики («I21» → I21.0, I21.1…)
    let chips = all.filter((c) => c.textContent.trim() === cardHit);
    if (!chips.length) chips = all.filter((c) => c.textContent.trim().indexOf(cardHit + ".") === 0);
    if (!chips.length) return false;
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
    return true;
  }

  /** «ОДК 23-А», «ОДК 23А» → «23A» (у таблиці сусідять кирилична й латинська літери). */
  function normOdk(s) {
    return String(s).toUpperCase().replace("ОДК", "").replace(/[\s:\-–—]+/g, "")
      .replace(/[АВСЕКМНОРТХІ]/g, (c) => "ABCEKMHOPTXI"["АВСЕКМНОРТХІ".indexOf(c)]);
  }

  // ══════════════════════════════════════════════════════════
  // Мобільні вкладки: НК 025 · Картка · НК 026
  // ══════════════════════════════════════════════════════════
  function wireTabs() {
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
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
