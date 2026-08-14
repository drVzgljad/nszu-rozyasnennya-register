/* ============================================================
   Коди ЕСОЗ — внутрішній довідник.
   Vanilla JS. Дані: data/esoz/esoz_meta.json  — підсумки й застереження
                     data/esoz/esoz_index.json — легкий список
                     data/esoz/esoz_cards.json — картки (ліниво)
   Пастка, заради якої існує нормалізація: у документах коди набрані
   змішано — кирилична «А» і латинська «A» виглядають однаково. Той самий
   набір двійників, що й у build_esoz.py.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const HOMOGLYPH = {
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I",
    "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X",
    "У": "Y", "Ѕ": "S",
  };
  const CODE_RE = /^[A-Z]\d{1,5}$|^P\d{1,3}$/;

  /** Кирилиця → латиниця у верхньому регістрі. */
  function normCode(raw) {
    return String(raw || "").trim().toUpperCase()
      .split("").map((ch) => HOMOGLYPH[ch] || ch).join("");
  }
  function hasHomoglyph(raw) {
    return String(raw || "").toUpperCase().split("").some((ch) => HOMOGLYPH[ch]);
  }

  let META = null, INDEX = null, CARDS = null, cardsPromise = null;
  let openedCode = null, readerEmptyHTML = "";
  const el = {};

  // ══════════════════════════════════════════════════════════
  function boot() {
    [["search", "#esSearch"], ["count", "#esCount"], ["clear", "#esClear"],
     ["results", "#esResults"], ["reader", "#esReader"], ["stats", "#esStats"],
     ["kind", "#esKind"], ["cat", "#esCat"], ["pkg", "#esPkg"],
     ["onlyRoz", "#onlyRoz"], ["onlyConflict", "#onlyConflict"], ["onlyNote", "#onlyNote"],
     ["issues", "#esIssues"], ["issuesBody", "#esIssuesBody"],
     ["homoglyph", "#esHomoglyph"], ["layout", ".nk-layout"]].forEach(([k, sel]) => (el[k] = $(sel)));

    readerEmptyHTML = el.reader.innerHTML;

    Promise.all([
      fetch("data/esoz/esoz_meta.json").then((r) => r.json()),
      fetch("data/esoz/esoz_index.json").then((r) => r.json()),
    ]).then(([meta, index]) => {
      META = meta;
      INDEX = index;
      onReady();
    }).catch(() => {
      el.count.textContent = "Не вдалося завантажити довідник кодів ЕСОЗ.";
    });
  }

  function onReady() {
    renderStats();
    fillSelects();
    renderIssues();
    bind();

    const q = new URLSearchParams(location.search);
    const code = q.get("code");
    if (code) {
      el.search.value = code;
      apply();
      openCard(normCode(code));
    } else {
      apply();
    }
  }

  // ── Шапка ────────────────────────────────────────────────
  function renderStats() {
    const c = META.counts || {};
    const cells = [
      [nf(c.services || 0), "кодів послуг"],
      [nf(c.positions || 0), "кодів посад"],
      [nf(c.with_packages || 0), "прив'язані до пакетів"],
      [nf(c.with_mentions || 0), "згадані в роз'ясненнях"],
    ];
    el.stats.innerHTML = cells.map(([v, l]) =>
      `<div class="stat"><b>${v}</b><span>${esc(l)}</span></div>`).join("");
  }

  function fillSelects() {
    (META.categories || []).forEach((cat) => {
      const o = document.createElement("option");
      o.value = cat; o.textContent = cat;
      el.cat.appendChild(o);
    });
    const pkgs = new Set();
    INDEX.forEach((e) => (e.p || []).forEach((p) => pkgs.add(p)));
    Array.from(pkgs).sort((a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999))
      .forEach((p) => {
        const o = document.createElement("option");
        o.value = p; o.textContent = "Пакет " + p;
        el.pkg.appendChild(o);
      });
  }

  function renderIssues() {
    const c = META.counts || {};
    el.issuesBody.innerHTML = `
      <p><strong>Це реконструкція, а не офіційний класифікатор.</strong> ${esc(META.disclaimer || "")}</p>
      <ul>
        <li>Зібрано з ${(META.sources || []).length} джерел: ${
          (META.sources || []).map((s) => esc(s.label)).join(", ")}.</li>
        <li><strong>${nf(c.conflicting_names || 0)}</strong> кодів мають різні назви в різних джерелах —
            у картці показано всі варіанти із зазначенням джерела, без мовчазного вибору одного.</li>
        <li><strong>${nf(c.with_note || 0)}</strong> кодів супроводжуються застереженням із таблиці
            співставлення (наприклад, «після впровадження відповідних кодів спостережень») —
            тобто на сьогодні код не застосовується.</li>
        <li>Коди в документах набрані змішано кирилицею й латиницею. Пошук нормалізує введене
            автоматично, тож <code>А37001</code> і <code>A37001</code> дадуть однаковий результат.</li>
        <li>Станом на ${esc(META.generated || "")}.</li>
      </ul>`;
  }

  // ── Фільтрація ───────────────────────────────────────────
  function apply() {
    const raw = el.search.value.trim();
    const normed = normCode(raw);
    const isCodeQuery = CODE_RE.test(normed);
    const needle = raw.toLowerCase();

    if (raw && hasHomoglyph(raw) && isCodeQuery) {
      el.homoglyph.hidden = false;
      el.homoglyph.innerHTML = `Ви набрали кирилицею — шукаємо за нормалізованим кодом <code>${esc(normed)}</code>.`;
    } else {
      el.homoglyph.hidden = true;
    }

    const kind = el.kind.value, cat = el.cat.value, pkg = el.pkg.value;
    const rows = INDEX.filter((e) => {
      if (kind && e.k !== kind) return false;
      if (cat && e.t !== cat) return false;
      if (pkg && !(e.p || []).includes(pkg)) return false;
      if (el.onlyRoz.checked && !e.r) return false;
      if (el.onlyConflict.checked && (e.v || 1) < 2) return false;
      if (el.onlyNote.checked && !NOTE_SET.has(e.c)) return false;
      if (!raw) return true;
      if (isCodeQuery && e.c.startsWith(normed)) return true;
      return e.c.toLowerCase().includes(needle) || (e.n || "").toLowerCase().includes(needle);
    });

    renderResults(rows, raw, normed, isCodeQuery);
  }

  // Коди із застереженням дізнаємося з карток; поки не завантажені — фільтр порожній.
  const NOTE_SET = new Set();

  function renderResults(rows, raw, normed, isCodeQuery) {
    el.count.textContent = rows.length
      ? `Знайдено: ${nf(rows.length)}`
      : "Нічого не знайдено — спробуйте інший код або слово з назви.";
    el.results.hidden = !rows.length;
    if (!rows.length) { el.results.innerHTML = ""; return; }

    const shown = rows.slice(0, 400);
    el.results.innerHTML = shown.map((e) => {
      const badge = e.k === "position" ? "посада" : (e.t || "послуга");
      const pk = (e.p || []).length ? `<span class="es-tag">пакети: ${esc((e.p || []).join(", "))}</span>` : "";
      const rz = e.r ? `<span class="es-tag">роз'яснень: ${e.r}</span>` : "";
      const cf = (e.v || 1) > 1 ? `<span class="es-tag es-tag-warn">назв: ${e.v}</span>` : "";
      return `<button class="es-row${openedCode === e.c ? " is-open" : ""}" type="button" data-code="${esc(e.c)}">
        <span class="es-code">${esc(e.c)}</span>
        <span class="es-body">
          <span class="es-name">${esc(e.n || "— назви немає —")}</span>
          <span class="es-meta"><span class="es-tag es-tag-kind">${esc(badge)}</span>${pk}${rz}${cf}</span>
        </span>
      </button>`;
    }).join("") + (rows.length > shown.length
      ? `<p class="es-more">Показано перші ${nf(shown.length)} з ${nf(rows.length)} — уточніть запит.</p>`
      : "");
  }

  // ── Картка ───────────────────────────────────────────────
  function loadCards() {
    if (cardsPromise) return cardsPromise;
    cardsPromise = fetch("data/esoz/esoz_cards.json")
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((d) => {
        CARDS = d;
        Object.keys(d).forEach((k) => { if (d[k] && d[k].note) NOTE_SET.add(k); });
        return d;
      })
      .catch((err) => {
        // Скидаємо кеш обіцянки: інакше один невдалий запит назавжди
        // заблокував би відкриття карток — наступний клік просто
        // отримував би ту саму відхилену обіцянку.
        cardsPromise = null;
        throw err;
      });
    return cardsPromise;
  }

  function openCard(code) {
    loadCards().then(() => {
      const card = CARDS[code];
      if (!card) return;
      openedCode = code;
      el.reader.classList.remove("reader-empty");
      el.reader.innerHTML = renderCard(card);
      if (el.layout) el.layout.dataset.active = "reader";
      document.querySelectorAll(".es-row").forEach((b) =>
        b.classList.toggle("is-open", b.dataset.code === code));
      el.reader.scrollTop = 0;
    }).catch(() => {
      el.reader.classList.remove("reader-empty");
      el.reader.innerHTML = `<p class="es-warn es-warn-strong">Не вдалося завантажити картки кодів.
        Перевірте зʼєднання і спробуйте ще раз — повторний клік по коду запустить нову спробу.</p>`;
    });
  }

  function renderCard(c) {
    const kindLabel = c.k === "position" ? "Посада ЕСОЗ" : "Код послуги ЕСОЗ";

    const names = (c.names || []).map((n, i) => `
      <li class="es-nameitem${i === 0 ? " is-primary" : ""}">
        <span class="es-nametext">${esc(n.n)}</span>
        <span class="es-namesrc">${esc((n.src || []).join(" · "))}</span>
      </li>`).join("");

    const conflict = (c.names || []).length > 1
      ? `<p class="es-warn">Джерела дають різні назви для цього коду. Нижче — усі варіанти;
         першим стоїть той, що трапляється в найбільшій кількості джерел.</p>` : "";

    const note = c.note
      ? `<p class="es-warn es-warn-strong">Застереження таблиці співставлення: ${esc(c.note)}</p>` : "";

    const svc = (c.services || []).length ? `
      <section class="es-block">
        <h3>Де трапляється в таблиці співставлення</h3>
        <ul class="es-list">${(c.services || []).map((s) => `
          <li><span class="es-svc">${esc(s.s)}</span>${
            (s.p || []).length
              ? `<span class="es-pkgs">${(s.p || []).map((p) =>
                  `<a href="../pakety/index.html?package=${encodeURIComponent(p)}">пакет ${esc(p)}</a>`).join(" ")}</span>`
              : ""}</li>`).join("")}</ul>
      </section>` : "";

    const men = (c.mentions || []).length ? `
      <section class="es-block">
        <h3>Роз'яснення НСЗУ, що згадують код</h3>
        <ul class="es-list">${(c.mentions || [])
          .slice()
          .sort((a, b) => (b.n || 0) - (a.n || 0))
          .map((m) => `
          <li><a href="../rozjasnennya/index.html?doc=${encodeURIComponent(m.d)}">${
            esc(m.t || ("Документ № " + m.d))}</a>
            <span class="es-times">згадок: ${m.n}</span></li>`).join("")}</ul>
      </section>` : "";

    return `
      <div class="es-cardhead">
        <div class="es-cardcode">${esc(c.c)}</div>
        <div class="es-cardkind">${esc(kindLabel)}${c.t ? " · " + esc(c.t) : ""}</div>
      </div>
      ${note}
      <section class="es-block">
        <h3>Назва${(c.names || []).length > 1 ? " (варіанти)" : ""}</h3>
        ${conflict}
        <ul class="es-names">${names || "<li>— назви немає —</li>"}</ul>
      </section>
      ${svc}
      ${men}
      <p class="es-foot">Джерело назв і зв'язків — документи НСЗУ, зібрані білдером
         <code>build_esoz.py</code>. Це не офіційний класифікатор.</p>`;
  }

  // ── Події ────────────────────────────────────────────────
  function bind() {
    let t = null;
    el.search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(apply, 120);
    });
    [el.kind, el.cat, el.pkg].forEach((s) => s.addEventListener("change", apply));
    [el.onlyRoz, el.onlyConflict, el.onlyNote].forEach((c) =>
      c.addEventListener("change", () => {
        if (c === el.onlyNote && !CARDS) { loadCards().then(apply); return; }
        apply();
      }));

    el.clear.addEventListener("click", () => {
      el.search.value = "";
      el.kind.value = ""; el.cat.value = ""; el.pkg.value = "";
      el.onlyRoz.checked = el.onlyConflict.checked = el.onlyNote.checked = false;
      el.homoglyph.hidden = true;
      openedCode = null;
      el.reader.classList.add("reader-empty");
      el.reader.innerHTML = readerEmptyHTML;
      apply();
    });

    el.results.addEventListener("click", (e) => {
      const btn = e.target.closest(".es-row");
      if (btn) openCard(btn.dataset.code);
    });

    document.querySelectorAll(".mobile-tab").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll(".mobile-tab").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        if (el.layout) el.layout.dataset.active = b.dataset.tab;
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
