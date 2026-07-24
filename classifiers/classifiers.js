/* ============================================================
   Класифікатор хвороб НК 025:2021 (ICD-10-AM) — фронтенд.
   Дерево (Клас → Блок → Рубрика → Підрубрика) + миттєвий пошук
   + паспорт коду з прив'язками до пакетів ПМГ і суміжних розділів.
   Vanilla JS. Дані: data/nk025_meta.json + data/nk025_index.json.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
    "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII"];
  const LEVEL_LABEL = { 3: "Рубрика", 4: "Підрубрика", 5: "Деталізований код" };
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  let META = null, INDEX = null, indexReady = false;
  const byCode = new Map();          // code → entry
  const childrenOf = new Map();      // parentCode → [entries]
  const l3ByCB = new Map();          // `${classNo}|${blockIdx}` → [l3 entries]
  const classByNo = new Map();

  // ── DOM ────────────────────────────────────────────────────
  const el = {
    stats: $("#nkStats"), search: $("#nkSearch"), onlyPmg: $("#onlyPmg"),
    level: $("#levelFilter"), count: $("#nkCount"), clear: $("#nkClear"),
    tree: $("#nkTree"), results: $("#nkResults"), reader: $("#nkReader"),
    layout: $(".nk-layout"),
  };

  // ══════════════════════════════════════════════════════════
  // Завантаження
  // ══════════════════════════════════════════════════════════
  async function boot() {
    try {
      META = await fetch("data/nk025_meta.json").then((r) => r.json());
    } catch (e) {
      el.count.textContent = "Не вдалося завантажити класифікатор.";
      return;
    }
    META.classes.forEach((c) => classByNo.set(c.no, c));
    renderStats();
    renderClassTree();
    wireUI();

    fetch("data/nk025_index.json")
      .then((r) => r.json())
      .then((idx) => { INDEX = idx; buildMaps(); indexReady = true; onIndexReady(); })
      .catch(() => { el.count.textContent = "Індекс пошуку недоступний."; });
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
    el.count.textContent = "Готово · " + nf(INDEX.length) + " кодів. Почніть вводити або розкрийте клас.";
    // відкладений глибокий лінк ?code=
    const q = new URLSearchParams(location.search);
    const code = (q.get("code") || q.get("q") || "").trim().toUpperCase();
    if (code && byCode.has(code)) { openCode(code); revealInTree(code); }
    else if (code) { el.search.value = code; runSearch(); }
  }

  // ══════════════════════════════════════════════════════════
  // Статистика
  // ══════════════════════════════════════════════════════════
  function renderStats() {
    const L = META.levels || {};
    const cards = [
      ["Класів", 22],
      ["Рубрик", L[3] || 0],
      ["Підрубрик", (L[4] || 0)],
      ["Усього кодів", META.total || 0],
    ];
    el.stats.innerHTML = cards.map(([k, v]) =>
      `<div class="stat"><span class="stat-num">${nf(v)}</span><span class="stat-key">${k}</span></div>`
    ).join("");
  }

  // ══════════════════════════════════════════════════════════
  // Дерево класів
  // ══════════════════════════════════════════════════════════
  function pkChip(e) {
    if (!e.pk) return "";
    const n = e.pk.pkgs ? e.pk.pkgs.length : 0;
    return `<span class="pk-dot" title="Код зустрічається у пакетах ПМГ (${n})">ПМГ</span>`;
  }

  function renderClassTree() {
    el.tree.innerHTML = META.classes.map((c) => {
      const rng = c.range ? `<span class="trange">${c.range.replace("-", "–")}</span>` : "";
      return `<div class="tnode" data-kind="class" data-no="${c.no}">
        <button class="trow lvl-class" aria-expanded="false" type="button">
          <span class="tw"></span>
          <span class="tcode">Клас ${ROMAN[c.no] || c.no}</span>
          ${rng}
          <span class="tname">${esc(cap(c.title))}</span>
          <span class="tcount">${nf(c.count || 0)}</span>
        </button>
        <div class="tchildren" hidden></div>
      </div>`;
    }).join("");
  }

  function expandClass(node) {
    const no = +node.dataset.no, box = $(".tchildren", node), cls = classByNo.get(no);
    if (box.dataset.built) return;
    box.dataset.built = "1";
    const blocks = cls.blocks || [];
    box.innerHTML = blocks.map((b, i) =>
      `<div class="tnode" data-kind="block" data-class="${no}" data-bidx="${i}">
        <button class="trow lvl-block" aria-expanded="false" type="button">
          <span class="tw"></span>
          <span class="tname">${esc(cap(b.name))}</span>
          <span class="trange">${(b.range || "").replace("-", "–")}</span>
        </button>
        <div class="tchildren" hidden></div>
      </div>`).join("") || `<div class="tempty">Немає блоків</div>`;
  }

  function expandBlock(node) {
    if (!indexReady) return toast("Індекс ще вантажиться…");
    const box = $(".tchildren", node);
    if (box.dataset.built) return;
    box.dataset.built = "1";
    const key = node.dataset.class + "|" + node.dataset.bidx;
    const rubs = (l3ByCB.get(key) || []).slice().sort(byCodeAsc);
    box.innerHTML = rubs.map(rubRow).join("") || `<div class="tempty">Немає рубрик</div>`;
  }

  function expandCode(node) {
    if (!indexReady) return;
    const box = $(".tchildren", node);
    if (box.dataset.built) return;
    box.dataset.built = "1";
    const kids = (childrenOf.get(node.dataset.code) || []).slice().sort(byCodeAsc);
    box.innerHTML = kids.map(rubRow).join("");
  }

  function rubRow(e) {
    const hasKids = (childrenOf.get(e.c) || []).length > 0;
    return `<div class="tnode" data-kind="code" data-code="${e.c}" data-haskids="${hasKids ? 1 : 0}">
      <button class="trow lvl-${e.l}" type="button" aria-expanded="false">
        <span class="tw ${hasKids ? "" : "leaf"}"></span>
        <span class="tcode code">${e.c}</span>
        <span class="tname">${esc(e.n)}</span>
        ${pkChip(e)}
      </button>
      <div class="tchildren" hidden></div>
    </div>`;
  }

  // делегування кліків у дереві
  el.tree.addEventListener("click", (ev) => {
    const caret = ev.target.closest(".tw");
    const row = ev.target.closest(".trow");
    if (!row) return;
    const node = row.closest(".tnode");
    const kind = node.dataset.kind;

    if (kind === "code") {
      // каретка — розгорнути; решта рядка — відкрити паспорт
      if (caret && node.dataset.haskids === "1") { toggle(node, expandCode); return; }
      openCode(node.dataset.code);
      markActive(row);
      if (node.dataset.haskids === "1" && row.getAttribute("aria-expanded") === "false")
        toggle(node, expandCode);
      return;
    }
    toggle(node, kind === "class" ? expandClass : expandBlock);
  });

  function toggle(node, builder) {
    const row = $(".trow", node), box = $(".tchildren", node);
    const open = row.getAttribute("aria-expanded") === "true";
    if (!open) builder(node);
    row.setAttribute("aria-expanded", open ? "false" : "true");
    box.hidden = open;
    node.classList.toggle("open", !open);
  }

  // ══════════════════════════════════════════════════════════
  // Пошук
  // ══════════════════════════════════════════════════════════
  let searchTimer = null;
  function wireUI() {
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 130);
    });
    el.onlyPmg.addEventListener("change", runSearch);
    el.level.addEventListener("change", runSearch);
    el.clear.addEventListener("click", () => {
      el.search.value = ""; el.onlyPmg.checked = false; el.level.value = "";
      runSearch(); el.search.focus();
    });
    // мобільні вкладки
    $$("#mobileTabs .mobile-tab").forEach((b) =>
      b.addEventListener("click", () => setTab(b.dataset.tab)));
  }

  function runSearch() {
    const raw = el.search.value.trim();
    const onlyPmg = el.onlyPmg.checked;
    const lvl = el.level.value ? +el.level.value : 0;
    const active = raw.length >= 1 || onlyPmg || lvl;
    el.clear.hidden = !active;

    if (!active) {
      el.results.hidden = true; el.tree.hidden = false;
      if (indexReady) el.count.textContent = nf(INDEX.length) + " кодів у класифікаторі";
      return;
    }
    if (!indexReady) { el.count.textContent = "Індекс ще вантажиться…"; return; }

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
        score = 10; // лише фільтри
      }
      if (score > 0) out.push([score, e]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1].c.localeCompare(b[1].c));
    const CAP = 500;
    const shown = out.slice(0, CAP);
    el.count.textContent = out.length
      ? `Знайдено ${nf(out.length)}${out.length > CAP ? " · показано " + CAP : ""}`
      : "Нічого не знайдено";
    el.results.innerHTML = shown.map(([, e]) => resultRow(e)).join("");
    el.results.hidden = false; el.tree.hidden = true;
  }

  function resultRow(e) {
    const cls = classByNo.get(e.k);
    const path = cls ? `Клас ${ROMAN[e.k] || e.k}` : "";
    return `<button class="rrow lvl-${e.l}" type="button" data-code="${e.c}">
      <span class="tcode code">${e.c}</span>
      <span class="rmain"><span class="tname">${esc(e.n)}</span>
        <span class="rmeta">${LEVEL_LABEL[e.l]} · ${path}</span></span>
      ${pkChip(e)}
    </button>`;
  }

  el.results.addEventListener("click", (ev) => {
    const b = ev.target.closest(".rrow");
    if (!b) return;
    openCode(b.dataset.code); markActive(b);
  });

  // ══════════════════════════════════════════════════════════
  // Паспорт коду
  // ══════════════════════════════════════════════════════════
  function ancestryOf(e) {
    // повертає {cls, block, p3, p4}
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

    const pmgHtml = renderPmg(e);
    const linksHtml = renderLinks(e);
    const copyText = `${e.c} — ${e.n}` + (cls ? ` (Клас ${ROMAN[cls.no]}${block ? ", " + block.name : ""})` : "");

    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = `
      <div class="reader-head">
        <div class="reader-code">${e.c}</div>
        <div class="reader-level lvl-${e.l}">${LEVEL_LABEL[e.l]}</div>
        <button class="copy-btn" type="button" data-copy="${escAttr(copyText)}" title="Скопіювати код і назву">⧉ Копіювати</button>
      </div>
      <h2 class="reader-name">${esc(e.n)}</h2>
      <div class="reader-crumbs">${crumbs.join('<span class="sep">›</span>')}</div>
      ${pmgHtml}
      ${linksHtml}
      ${kidsHtml}
      <div class="reader-foot">НК 025:2021 · ICD-10-AM · рівень ${e.l}</div>`;
    setTab("reader");
  }

  function renderPmg(e) {
    if (!e.pk) {
      return `<div class="reader-block pmg-none">
        <h3>Пакети ПМГ</h3>
        <p class="muted">Прямої згадки цього коду в переліках наказу № 377 не знайдено.
           Це не виключає застосування коду в межах пакета — перевірте у розділах нижче.</p></div>`;
    }
    const pk = e.pk;
    const chips = (pk.pkgs || []).map((n) =>
      `<a class="pk-pkg" href="../pakety/index.html?q=${encodeURIComponent(n)}" title="Відкрити пакет № ${n}">Пакет № ${n}</a>`).join("");
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

  // делеговані дії в паспорті
  el.reader.addEventListener("click", (ev) => {
    const goto = ev.target.closest("[data-goto]");
    if (goto) { const c = goto.dataset.goto; openCode(c); revealInTree(c); return; }
    const cp = ev.target.closest("[data-copy]");
    if (cp) {
      navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy);
      cp.textContent = "✓ Скопійовано"; setTimeout(() => (cp.textContent = "⧉ Копіювати"), 1400);
    }
  });

  // ══════════════════════════════════════════════════════════
  // Допоміжне
  // ══════════════════════════════════════════════════════════
  function revealInTree(code) {
    // Розкрити гілку дерева до коду (клас → блок → рубрика → …) і підсвітити
    const e = byCode.get(code); if (!e) return;
    el.search.value = ""; el.results.hidden = true; el.tree.hidden = false; el.clear.hidden = true;
    const { cls, p3 } = ancestryOf(e);
    if (!cls) return;
    const chain = [];
    const classNode = $(`.tnode[data-kind="class"][data-no="${cls.no}"]`);
    if (!classNode) return;
    ensureOpen(classNode, expandClass);
    const bidx = p3 && p3.b != null ? p3.b : (e.l === 3 ? e.b : null);
    if (bidx == null) return;
    const blockNode = $(`.tnode[data-kind="block"][data-class="${cls.no}"][data-bidx="${bidx}"]`, classNode);
    if (!blockNode) return;
    ensureOpen(blockNode, expandBlock);
    const chainCodes = [];
    if (p3) chainCodes.push(p3.c);
    if (e.l >= 4 && p3) chainCodes.push(e.l === 5 ? byCode.get(e.p).c : e.c);
    if (e.l === 5) chainCodes.push(e.c);
    let scope = blockNode;
    for (const cc of chainCodes) {
      const n = $(`.tnode[data-code="${cc}"]`, scope);
      if (!n) break;
      if (cc !== code) ensureOpen(n, expandCode);
      scope = n;
    }
    const target = $(`.tnode[data-code="${code}"] > .trow`, blockNode) || $(`.tnode[data-code="${code}"] .trow`, blockNode);
    if (target) { markActive(target); target.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }

  function ensureOpen(node, builder) {
    const row = $(".trow", node), box = $(".tchildren", node);
    if (row.getAttribute("aria-expanded") !== "true") {
      builder(node);
      row.setAttribute("aria-expanded", "true"); box.hidden = false; node.classList.add("open");
    }
  }

  function markActive(row) {
    $$(".trow.active, .rrow.active").forEach((r) => r.classList.remove("active"));
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
    // якщо в рядку вже є малі літери — не чіпаємо (щоб не зіпсувати абревіатури: ВІЛ, ДНК)
    if (/[а-яґєії]/.test(s)) return s;
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  let toastT = null;
  function toast(msg) { el.count.textContent = msg; clearTimeout(toastT); }

  boot();
})();
