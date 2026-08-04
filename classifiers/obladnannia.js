/* ============================================================
   Обладнання у вимогах ПМГ-2026 — фронтенд.
   Реєстр вимог до обладнання з 43 пакетів + кандидати з НК 024,
   НК 031 і табелів оснащення.
   Vanilla JS. Дані: data/equipment/equipment_meta.json  — підсумки й зауваги
                     data/equipment/equipment_index.json — легкий список
                     data/equipment/equipment_cards.json — картки (ліниво)
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const BACK_PAGE = "/classifiers/obladnannia.html";

  /** Хвіст для перехресних посилань: на чужій сторінці буде кнопка «Назад». */
  function backTail(id, label) {
    return "&back=" + encodeURIComponent(BACK_PAGE + "?id=" + encodeURIComponent(id)) +
      "&backLabel=" + encodeURIComponent("до виробу «" + trim(label, 40) + "»");
  }

  // Куди веде кандидат із кожного довідника.
  const REF_PAGE = {
    nk024: (c) => "nk024.html?code=" + encodeURIComponent(c),
    nk031: (c) => "nk031.html?code=" + encodeURIComponent(c),
  };
  const REF_LABEL = {
    nk024: "НК 024:2023 (GMDN)",
    nk031: "НК 031:2024 (EMDN)",
    tabel148: "Табель, наказ МОЗ № 148",
    tabel153: "Табель, наказ МОЗ № 153",
    tabel158: "Табель, наказ МОЗ № 158",
    tabel951: "Табель, наказ МОЗ № 951",
    tabel995: "Табель, наказ МОЗ № 995",
  };
  const BAND_HINT = {
    "точний": "назви збігаються дослівно або майже дослівно",
    "ймовірний": "назви близькі, але не тотожні — перевірте зміст позиції",
    "ширший": "довідник називає рід, специфікація — вид із уточненнями",
  };

  let META = null, INDEX = null, CARDS = null;
  let cardsPromise = null, openedId = null, readerEmptyHTML = "";
  const byId = new Map();
  const el = {};

  // ══════════════════════════════════════════════════════════
  function boot() {
    [["search", "#eqSearch"], ["count", "#eqCount"], ["clear", "#eqClear"],
     ["results", "#eqResults"], ["reader", "#eqReader"], ["stats", "#eqStats"],
     ["selPkg", "#selPkg"], ["selBand", "#selBand"], ["onlyCrit", "#onlyCrit"],
     ["onlyMany", "#onlyMany"], ["issues", "#eqIssues"], ["issuesBody", "#eqIssuesBody"],
     ["layout", ".nk-layout"]].forEach(([k, sel]) => (el[k] = $(sel)));

    readerEmptyHTML = el.reader.innerHTML;

    Promise.all([
      fetch("data/equipment/equipment_meta.json").then((r) => r.json()),
      fetch("data/equipment/equipment_index.json").then((r) => r.json()),
    ]).then(([meta, index]) => {
      META = meta;
      INDEX = index;
      INDEX.forEach((e) => byId.set(e.id, e));
      onReady();
    }).catch(() => {
      el.count.textContent = "Не вдалося завантажити реєстр обладнання.";
    });
  }

  function loadCards() {
    if (CARDS) return Promise.resolve(CARDS);
    if (!cardsPromise) {
      cardsPromise = fetch("data/equipment/equipment_cards.json")
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((d) => (CARDS = d))
        .catch((err) => {
          // Без цього обриву панель просто лишалася б порожньою назавжди:
          // проміс відхилено, і жоден наступний клік уже нічого не малює.
          cardsPromise = null;
          throw err;
        });
    }
    return cardsPromise;
  }

  function onReady() {
    renderStats();
    renderIssues();
    populatePkgs();
    wireUI();
    refilter();

    const q = new URLSearchParams(location.search);
    const id = q.get("id");
    const pkg = q.get("package");
    if (pkg) { el.selPkg.value = pkg; refilter(); }
    if (id && byId.has(id)) openCard(id);
    const text = q.get("q");
    if (text) { el.search.value = text; refilter(); }
  }

  // ══════════════════════════════════════════════════════════
  function renderStats() {
    const c = META.counts;
    el.stats.innerHTML = [
      [nf(c.mentions), "згадок обладнання у специфікаціях"],
      [nf(c.entries), "унікальних вимог"],
      [nf(c.packages), "пакетів ПМГ-2026"],
      [nf(c.exact + c.likely + c.broader), "вимог із кандидатом у довіднику"],
    ].map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${esc(l)}</span></div>`).join("");
  }

  function renderIssues() {
    const c = META.counts;
    const notes = (META.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
    const top = (META.top_unmatched || []).slice(0, 12)
      .map((u) => `<li><b>${esc(u.name)}</b> — ${u.hits} ${plural(u.hits, "згадка", "згадки", "згадок")}
                   у ${u.pkgs} ${plural(u.pkgs, "пакеті", "пакетах", "пакетах")}</li>`).join("");
    el.issuesBody.innerHTML = `
      <p class="eq-note">Зв'язок вимоги з довідником обчислено за назвами: офіційного зіставнення
         специфікацій із НК 024, НК 031 чи табелями не існує. Тому це <b>кандидати</b>, а не коди
         вимоги. Точних збігів ${c.exact}, ймовірних ${c.likely}, ширших ${c.broader};
         без кандидатів лишилося ${c.unmatched} ${plural(c.unmatched, "вимога", "вимоги", "вимог")}.</p>
      <ul>${notes}</ul>
      ${top ? `<p class="eq-note"><b>Найчастіші вимоги, яким відповідника не знайшлося:</b></p>
      <ul class="eq-unmatched">${top}</ul>` : ""}`;
    el.issues.hidden = false;
  }

  function populatePkgs() {
    const seen = new Map();
    INDEX.forEach((e) => e.pkgs.forEach((p) => seen.set(p, (seen.get(p) || 0) + 1)));
    const nums = Array.from(seen.keys()).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    el.selPkg.innerHTML = '<option value="">— усі пакети —</option>' +
      nums.map((n) => `<option value="${escAttr(n)}">Пакет ${esc(n)} — ${seen.get(n)} ${
        plural(seen.get(n), "вимога", "вимоги", "вимог")}</option>`).join("");
  }

  function wireUI() {
    el.search.addEventListener("input", refilter);
    el.selPkg.addEventListener("change", refilter);
    el.selBand.addEventListener("change", refilter);
    el.onlyCrit.addEventListener("change", refilter);
    el.onlyMany.addEventListener("change", refilter);
    el.clear.addEventListener("click", () => {
      el.search.value = "";
      el.selPkg.value = "";
      el.selBand.value = "";
      el.onlyCrit.checked = el.onlyMany.checked = false;
      refilter();
    });
    $$(".mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
  }

  // ══════════════════════════════════════════════════════════
  function refilter() {
    const q = el.search.value.trim().toLowerCase();
    const pkg = el.selPkg.value;
    const band = el.selBand.value;
    const list = INDEX.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (pkg && !e.pkgs.includes(pkg)) return false;
      if (band && (e.band || "—") !== band) return false;
      if (el.onlyCrit.checked && !e.critical) return false;
      if (el.onlyMany.checked && e.pkgs.length < 5) return false;
      return true;
    });
    showResults(list);
  }

  function showResults(list) {
    el.count.textContent = list.length
      ? `${nf(list.length)} ${plural(list.length, "вимога", "вимоги", "вимог")}`
      : "Нічого не знайдено";
    el.results.hidden = !list.length;
    el.results.innerHTML = list.slice(0, 400).map(rowHTML).join("") +
      (list.length > 400 ? `<p class="eq-more">Показано перші 400 із ${nf(list.length)} —
        уточніть пошук.</p>` : "");
    wireRows();
  }

  function rowHTML(e) {
    const band = e.band || "—";
    const meta = [
      `${e.pkgs.length} ${plural(e.pkgs.length, "пакет", "пакети", "пакетів")}`,
      `${e.hits} ${plural(e.hits, "згадка", "згадки", "згадок")}`,
    ];
    if (e.kind === "умова") meta.push("умова, не виріб");
    return `
      <button class="rrow" type="button" data-id="${escAttr(e.id)}">
        <span class="rmain">
          <span class="tname">${esc(e.name)}</span>
          <span class="rmeta">${esc(meta.join(" · "))}</span>
        </span>
        ${e.critical ? '<span class="eq-tag crit">критична</span>' : ""}
        <span class="eq-tag band-${bandClass(band)}">${
          esc(band === "—" ? "без довідника" : band)}</span>
      </button>`;
  }

  function bandClass(b) {
    return b === "точний" ? "exact" : b === "ймовірний" ? "likely"
      : b === "ширший" ? "broad" : "none";
  }

  function wireRows() {
    $$(".rrow[data-id]", el.results).forEach((r) =>
      r.addEventListener("click", () => { markActive(r); openCard(r.dataset.id); }));
  }

  function markActive(row) {
    $$(".rrow", el.results).forEach((r) => r.classList.remove("active"));
    if (row) row.classList.add("active");
  }

  // ══════════════════════════════════════════════════════════
  function openCard(id) {
    openedId = id;
    setTab("reader");
    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = '<p class="eq-note">Завантажуємо картку…</p>';
    loadCards().then((cards) => {
      if (openedId !== id) return;
      const card = cards[id];
      if (!card) { el.reader.innerHTML = readerEmptyHTML; return; }
      renderCard(card);
      const u = new URL(location.href);
      u.searchParams.set("id", id);
      history.replaceState(null, "", u);
    }).catch(() => {
      el.reader.innerHTML = `<p class="eq-note">Не вдалося завантажити картки виробів.
        Перевірте зв'язок і спробуйте ще раз — перелік ліворуч працює й без них.</p>`;
    });
  }

  function renderCard(card) {
    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-crumbs">
        <span class="crumb">${card.kind === "умова"
          ? "Умова закупівлі — не медичний виріб" : "Вимога до обладнання"}</span>
        ${card.critical ? '<span class="crumb"><b>критична вимога</b></span>' : ""}
      </div>
      <h2 class="reader-name">${esc(card.name)}</h2>
      ${aliasHTML(card)}
      ${refsHTML(card)}
      ${pkgHTML(card)}`;
  }

  function aliasHTML(card) {
    if (!card.aliases || !card.aliases.length) return "";
    return `<details class="eq-aliases"><summary>Інші написання тієї самої вимоги —
      ${card.aliases.length}</summary><ul>${
      card.aliases.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
      <p class="eq-note">Специфікації різних пакетів пишуть той самий виріб по-різному; тут вони
         зведені в одну позицію.</p></details>`;
  }

  function refsHTML(card) {
    if (card.kind === "умова") {
      return `<section class="reader-block"><h3>Довідники</h3>
        <p class="eq-note">Ця вимога описує умову роботи закладу, а не медичний виріб, тож у
           класифікаторах виробів їй нічого не відповідає.</p></section>`;
    }
    if (!card.refs || !card.refs.length) {
      return `<section class="reader-block"><h3>Кандидати з довідників</h3>
        <p class="eq-note">Жодна позиція НК 024, НК 031 чи табелів оснащення не зійшлася з цією
           назвою. Найчастіша причина — специфікація описує виріб функціонально
           («система моніторингу фізіологічних показників одного пацієнта»), а довідник називає
           його інакше. Шукайте вручну:
           <a href="nk024.html?q=${encodeURIComponent(card.name)}">у НК 024</a>,
           <a href="nk031.html?q=${encodeURIComponent(card.name)}">у НК 031</a>,
           <a href="tabel.html?q=${encodeURIComponent(card.name)}">у табелях</a>.</p></section>`;
    }
    const rows = card.refs.map((r) => {
      const href = REF_PAGE[r.src]
        ? REF_PAGE[r.src](r.code) + backTail(card.id, card.name)
        : "tabel.html?doc=" + encodeURIComponent(r.src.replace("tabel", "")) +
          "&item=" + encodeURIComponent(r.code) + backTail(card.id, card.name);
      return `<a class="eq-ref band-${bandClass(r.band)}" href="${escAttr(href)}">
        <span class="eq-ref-src">${esc(REF_LABEL[r.src] || r.src)}</span>
        <span class="eq-ref-name">${esc(r.name)}</span>
        <span class="eq-ref-foot"><code>${esc(r.code)}</code>
          <span class="eq-tag band-${bandClass(r.band)}" title="${escAttr(BAND_HINT[r.band] || "")}">${
            esc(r.band)}${r.band === "ширший" ? "" : " · " + r.score}</span></span></a>`;
    }).join("");
    return `<section class="reader-block"><h3>Кандидати з довідників</h3>
      <div class="eq-refs">${rows}</div>
      <p class="eq-note">Зіставлення обчислене за назвами — офіційного зв'язку специфікацій із
         класифікаторами не існує. Перевіряйте зміст позиції, перш ніж посилатися на код.</p>
      </section>`;
  }

  function pkgHTML(card) {
    const byPkg = new Map();
    card.rows.forEach((r) => {
      if (!byPkg.has(r.pkg)) byPkg.set(r.pkg, { title: r.title, rows: [] });
      byPkg.get(r.pkg).rows.push(r);
    });
    const nums = Array.from(byPkg.keys()).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const crit = card.rows.filter((r) => r.critical).length;
    const body = nums.map((n) => {
      const g = byPkg.get(n);
      const lines = g.rows.map((r) => `<div class="eq-req">
        ${r.scope ? `<span class="eq-scope">${esc(r.scope)}</span>` : ""}
        ${r.qty ? `<span class="eq-qty">${esc(r.qty)}</span>` : ""}
        ${r.critical ? '<span class="eq-tag crit">критична</span>' : ""}
      </div>`).join("");
      return `<div class="eq-pkg">
        <a class="eq-pkg-head" href="../passport/index.html?package=${encodeURIComponent(n)}">
          <b>Пакет ${esc(n)}</b> ${esc(trim(g.title || "", 70))}</a>
        ${lines}
        <a class="eq-pkg-spec" href="../pakety/index.html?package=${encodeURIComponent(n)}&section=equipment">
          відкрити блок обладнання у специфікації →</a>
      </div>`;
    }).join("");
    // Вимог більше, ніж пакетів: той самий виріб пакет вимагає окремо в
    // операційній, в палаті інтенсивної терапії і «у ЗОЗ».
    return `<section class="reader-block"><h3>Де це вимагають —
      ${nums.length} ${plural(nums.length, "пакет", "пакети", "пакетів")},
      ${card.rows.length} ${plural(card.rows.length, "вимога", "вимоги", "вимог")}${
        crit ? `, з них критичних ${crit}` : ""}</h3>
      <div class="eq-pkgs">${body}</div></section>`;
  }

  // ══════════════════════════════════════════════════════════
  function setTab(tab) {
    el.layout.dataset.active = tab;
    $$(".mobile-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    return b === 1 ? one : many;
  }

  function trim(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  document.addEventListener("DOMContentLoaded", boot);
})();
