/* ============================================================
   Спеціальності та посади — фронтенд.
   Два реєстри в одному вікні: Додаток 7 до Ліцензійних умов (за чим ліцензія)
   і Перелік професій/посад МОЗ № 1065 (що можна вписати у штатний розпис).
   Vanilla JS. Дані: data/spec/spec_meta.json  — підсумки, рівні збігу, вади
                     data/spec/spec_index.json — легкий список обох реєстрів
                     data/spec/spec_cards.json — паспорти (ліниво)
                     data/spec/spec_pkg.json   — кадрові вимоги пакетів (ліниво)
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const MATCH_TAG = {
    exact: "точний", manual: "звірено вручну",
    root: "за коренем", morph: "за основами", none: "немає пари",
  };
  const PART_LABEL = {
    base: "Розділ 1 · базові посади",
    profile: "Розділ 2 · за профілями роботи",
  };

  let META = null, INDEX = null, CARDS = null, PKG = null;
  let cardsPromise = null, pkgPromise = null, openedId = null, readerEmptyHTML = "";
  let registry = "s";
  const byId = new Map();
  const el = {};

  // ══════════════════════════════════════════════════════════
  function boot() {
    [["search", "#spSearch"], ["count", "#spCount"], ["clear", "#spClear"],
     ["results", "#spResults"], ["reader", "#spReader"], ["stats", "#spStats"],
     ["banner", "#specBanner"], ["selSec", "#selSec"], ["selKind", "#selKind"],
     ["selPart", "#selPart"], ["selPkg", "#selPkg"], ["onlyNoPost", "#onlyNoPost"],
     ["onlyCross", "#onlyCross"], ["onlyPkg", "#onlyPkg"], ["onlyReg", "#onlyReg"],
     ["cntS", "#cntS"], ["cntP", "#cntP"], ["issues", "#spIssues"],
     ["issuesBody", "#spIssuesBody"], ["layout", ".nk-layout"]]
      .forEach(([k, sel]) => (el[k] = $(sel)));

    readerEmptyHTML = el.reader.innerHTML;

    Promise.all([
      fetch("data/spec/spec_meta.json").then((r) => r.json()),
      fetch("data/spec/spec_index.json").then((r) => r.json()),
    ]).then(([meta, index]) => {
      META = meta;
      INDEX = index;
      INDEX.forEach((e) => byId.set(e.id, e));
      onReady();
    }).catch(() => {
      el.count.textContent = "Не вдалося завантажити реєстр спеціальностей.";
    });
  }

  function loadCards() {
    if (CARDS) return Promise.resolve(CARDS);
    if (!cardsPromise) {
      cardsPromise = fetch("data/spec/spec_cards.json")
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((d) => (CARDS = d))
        .catch((err) => {
          // Без скидання проміса панель лишалася б порожньою назавжди:
          // відхилений проміс кешується, і наступний клік нічого не малює.
          cardsPromise = null;
          throw err;
        });
    }
    return cardsPromise;
  }

  function loadPkg() {
    if (PKG) return Promise.resolve(PKG);
    if (!pkgPromise) {
      pkgPromise = fetch("data/spec/spec_pkg.json")
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((d) => (PKG = d))
        .catch((err) => { pkgPromise = null; throw err; });
    }
    return pkgPromise;
  }

  function onReady() {
    renderBanner();
    renderStats();
    renderIssues();
    populateSelects();
    wireUI();
    applyRegistry();

    const q = new URLSearchParams(location.search);
    if (q.get("reg") === "p") switchRegistry("p");
    const pkg = q.get("package");
    if (pkg) el.selPkg.value = pkg;
    const text = q.get("q");
    if (text) el.search.value = text;
    refilter();
    const id = q.get("id");
    if (id && byId.has(id)) openCard(id);
  }

  // ══════════════════════════════════════════════════════════
  function renderBanner() {
    const d = META.source.dodatok7;
    if (d.status !== "набирає чинності") return;
    el.banner.hidden = false;
    el.banner.innerHTML =
      `⏳ Перелік спеціальностей показано в редакції, яка <b>ще не діє</b>: ` +
      `постанова КМУ від 24.06.2026 № 813 набирає чинності <b>${esc(d.effective_from)}</b> ` +
      `(опубліковано ${esc(d.published)}). До цієї дати чинний попередній Додаток 7 ` +
      `у редакції постанови № 781 — там ще «молодші спеціалісти з медичною освітою» ` +
      `і «фахівці з реабілітації».`;
  }

  function renderStats() {
    const c = META.counts;
    el.stats.innerHTML = [
      [nf(c.specialties), "спеціальностей у Додатку 7"],
      [nf(c.posts), "позицій у Переліку МОЗ № 1065"],
      [nf(c.specialties - (META.unmatched || []).length), "спеціальностей мають посаду"],
      [nf(c.packages_with_staff), "пакетів із кадровими вимогами"],
      [nf(c.staff_unmatched), "вимог поза Переліком МОЗ"],
    ].map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${esc(l)}</span></div>`).join("");
    el.cntS.textContent = nf(c.specialties);
    el.cntP.textContent = nf(c.posts);
  }

  function renderIssues() {
    const d = META.source_defects || [];
    if (!d.length) return;
    el.issues.hidden = false;
    el.issuesBody.innerHTML = d.map((x) =>
      `<h4>${esc(x.source)}</h4><p>${esc(x.issue)}</p>` +
      `<ul>${x.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join("");
  }

  function populateSelects() {
    const labels = META.section_labels || {};
    el.selSec.innerHTML = '<option value="">— усі розділи —</option>' +
      Object.entries(META.counts.sections).map(([k, n]) =>
        `<option value="${esc(k)}">${esc(labels[k] || k)} (${n})</option>`).join("");

    const kinds = new Set();
    INDEX.forEach((e) => (e.k || []).forEach((k) => kinds.add(k)));
    el.selKind.innerHTML = '<option value="">— будь-який —</option>' +
      Array.from(kinds).sort().map((k) =>
        `<option value="${esc(k)}">${esc(k)}</option>`).join("");

    // Пакети підтягуємо тільки коли вони вже завантажені — до того селект
    // лишається з однією опцією, але фільтр по ньому й не потрібен.
    loadPkg().then((pkg) => {
      const sorted = pkg.slice().sort((a, b) => (+a.package || 999) - (+b.package || 999));
      el.selPkg.innerHTML = '<option value="">— будь-який —</option>' +
        sorted.map((p) =>
          `<option value="${esc(p.package)}">№ ${esc(p.package)} · ${esc(trim(p.name, 46))}</option>`)
          .join("");
    }).catch(() => { /* фільтр по пакету просто лишиться порожнім */ });
  }

  function trim(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  // ══════════════════════════════════════════════════════════
  function wireUI() {
    $$(".spec-tab").forEach((b) =>
      b.addEventListener("click", () => switchRegistry(b.dataset.reg)));

    let t = null;
    el.search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(refilter, 140);
    });
    [el.selSec, el.selKind, el.selPart, el.selPkg, el.onlyNoPost, el.onlyCross,
     el.onlyPkg, el.onlyReg].forEach((c) => c && c.addEventListener("change", refilter));

    el.clear.addEventListener("click", () => {
      el.search.value = "";
      [el.selSec, el.selKind, el.selPart, el.selPkg].forEach((s) => (s.value = ""));
      [el.onlyNoPost, el.onlyCross, el.onlyPkg, el.onlyReg].forEach((c) => (c.checked = false));
      refilter();
    });

    $$(".mobile-tab").forEach((b) => b.addEventListener("click", () => {
      $$(".mobile-tab").forEach((x) => x.classList.toggle("active", x === b));
      el.layout.dataset.active = b.dataset.tab;
    }));
  }

  function switchRegistry(reg) {
    registry = reg;
    $$(".spec-tab").forEach((b) => {
      const on = b.dataset.reg === reg;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    applyRegistry();
    refilter();
  }

  /** Показує лише ті фільтри, які мають сенс для активного реєстру. */
  function applyRegistry() {
    $$("[data-for]").forEach((n) => {
      n.hidden = n.dataset.for !== registry;
    });
    el.onlyReg.hidden = false;
  }

  // ══════════════════════════════════════════════════════════
  function refilter() {
    const q = el.search.value.trim().toLowerCase();
    const sec = el.selSec.value, kind = el.selKind.value;
    const part = el.selPart.value, pkg = el.selPkg.value;

    let list = INDEX.filter((e) => e.t === registry);
    if (q) list = list.filter((e) => e.n.toLowerCase().includes(q));
    if (registry === "s") {
      if (sec) list = list.filter((e) => e.sec === sec);
      if (kind) list = list.filter((e) => (e.k || []).includes(kind));
      if (el.onlyNoPost.checked) list = list.filter((e) => !e.p);
      if (el.onlyCross.checked) list = list.filter((e) => e.x);
    } else {
      if (part) list = list.filter((e) => e.sec === part);
      if (el.onlyReg.checked) list = list.filter((e) => e.r);
    }

    // Фільтри «є в пакетах» і «конкретний пакет» вимагають карток —
    // тільки там лежить зв'язок із пакетами.
    if (pkg || el.onlyPkg.checked) {
      loadCards().then(() => {
        let l2 = list.filter((e) => {
          const p = (CARDS[e.id] || {}).packages || [];
          return pkg ? p.includes(pkg) : p.length > 0;
        });
        paint(l2);
      }).catch(() => paint(list));
      return;
    }
    paint(list);
  }

  function paint(list) {
    const noun = registry === "s"
      ? ["спеціальність", "спеціальності", "спеціальностей"]
      : ["позиція", "позиції", "позицій"];
    el.count.textContent = `${nf(list.length)} ${plural(list.length, ...noun)}`;
    el.results.hidden = list.length === 0;
    if (!list.length) {
      el.results.innerHTML = "";
      return;
    }
    el.results.innerHTML = list.slice(0, 400).map(rowHTML).join("") +
      (list.length > 400
        ? `<p class="eq-more">Показано перші 400 із ${nf(list.length)} — уточніть пошук.</p>`
        : "");
    $$(".rrow", el.results).forEach((b) =>
      b.addEventListener("click", () => openCard(b.dataset.id)));
    if (openedId) {
      const a = $(`.rrow[data-id="${cssEsc(openedId)}"]`, el.results);
      if (a) a.classList.add("active");
    }
  }

  function rowHTML(e) {
    if (e.t === "s") {
      const kinds = (e.k || []).map((k) =>
        `<span class="sp-kind k-${esc(k)}">${esc(k)}</span>`).join("");
      const m = e.m || "none";
      const tag = e.x
        ? '<span class="sp-tag cross">інший рівень</span>'
        : `<span class="sp-tag m-${esc(m)}">${esc(MATCH_TAG[m] || m)}</span>`;
      return `<button class="rrow" type="button" data-id="${esc(e.id)}">
          <span class="rmain">
            <span class="tname">${esc(e.n)}</span>
            <span class="sp-kinds">${kinds}</span>
          </span>${tag}</button>`;
    }
    const meta = [PART_LABEL[e.sec] || e.sec];
    if (e.s) meta.push(`${e.s} ${plural(e.s, "спеціальність", "спеціальності", "спеціальностей")}`);
    return `<button class="rrow" type="button" data-id="${esc(e.id)}">
        <span class="rmain">
          <span class="tname">${esc(e.n)}</span>
          <span class="rmeta">${esc(meta.join(" · "))}</span>
        </span>
        ${e.r ? '<span class="sp-tag reg">дод. регулювання</span>' : ""}</button>`;
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // ══════════════════════════════════════════════════════════
  function openCard(id) {
    openedId = id;
    $$(".rrow", el.results).forEach((b) => b.classList.toggle("active", b.dataset.id === id));
    el.reader.classList.remove("reader-empty");
    el.reader.innerHTML = '<p class="po-loading">Завантаження паспорта…</p>';
    if (window.matchMedia("(max-width: 720px)").matches) {
      el.layout.dataset.active = "reader";
      $$(".mobile-tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === "reader"));
    }
    Promise.all([loadCards(), loadPkg()])
      .then(() => {
        const c = CARDS[id];
        if (!c) throw new Error("немає картки");
        el.reader.innerHTML = c.kinds ? specCardHTML(id, c) : postCardHTML(id, c);
        $$("[data-goto]", el.reader).forEach((b) =>
          b.addEventListener("click", () => {
            const target = b.dataset.goto;
            switchRegistry(target.startsWith("S") ? "s" : "p");
            el.search.value = "";
            refilter();
            openCard(target);
          }));
        el.reader.scrollTop = 0;
      })
      .catch(() => {
        el.reader.innerHTML =
          '<p class="sp-empty">Не вдалося завантажити паспорт. Спробуйте ще раз.</p>';
      });
  }

  function linkBtn(id, name, sub) {
    return `<button class="sp-link" type="button" data-goto="${esc(id)}">
        <span><span class="sp-linkname">${esc(name)}</span>${
          sub ? `<span class="sp-linkpath">${esc(sub)}</span>` : ""}</span>
        <span class="sp-tag m-root">відкрити</span></button>`;
  }

  function specCardHTML(id, c) {
    const labels = META.section_labels || {};
    const kinds = (c.kinds || []).map((k) =>
      `<span class="sp-kind k-${esc(k)}">${esc(k)}</span>`).join("");

    let posts;
    if (!c.posts.length) {
      posts = `<div class="sp-empty">У Переліку професій (посад) МОЗ № 1065 посади під цю
        спеціальність немає. Заклад не зможе ввести відповідну посаду у штатний розпис —
        пункт 32 Ліцензійних умов дозволяє тільки посади з Переліку.</div>`;
    } else {
      posts = `<div class="sp-links">${c.posts.map((pid) => {
        const p = CARDS[pid] || {};
        return linkBtn(pid, p.name || pid, (p.path || []).slice(-1)[0] || "");
      }).join("")}</div>`;
      if (c.cross) {
        posts += `<div class="sp-empty" style="margin-top:9px">Знайдено лише посаду
          <b>іншого рівня</b>: спеціальність належить до розділу «${esc(labels[c.sec] || c.sec)}»,
          а посада — лікарська. Рівноцінної посади свого рівня Перелік МОЗ не містить.</div>`;
      }
    }

    const also = (c.also_in || []).length
      ? `<div class="reader-block"><h3>Та сама назва в інших розділах</h3>
         <div class="sp-links">${c.also_in.map((sec) => {
           const twin = INDEX.find((e) => e.t === "s" && e.n === c.name && e.sec === sec);
           return twin ? linkBtn(twin.id, c.name, labels[sec] || sec) : "";
         }).join("")}</div>
         <p class="sp-sub" style="margin-top:8px">Таблиця Додатка 7 не має ідентифікаторів
         рядків, тому розрізнити ці позиції можна лише за розділом.</p></div>`
      : "";

    return `
      <h2 class="sp-title">${esc(c.name)}</h2>
      <p class="sp-sub">${esc(labels[c.sec] || c.sec)} · Додаток 7 до Ліцензійних умов
        у редакції ПКМУ від 24.06.2026 № 813</p>
      <div class="sp-kinds" style="margin:10px 0 0">${kinds}</div>

      <div class="reader-block">
        <h3>Вид медичної та реабілітаційної допомоги</h3>
        <p class="sp-sub">За цією спеціальністю ліцензія дає право надавати:
          <b>${esc((c.kinds || []).join(", ") || "—")}</b>.</p>
      </div>

      <div class="reader-block">
        <h3>Посада за Переліком МОЗ № 1065${
          c.match ? ` <span class="sp-tag m-${esc(c.match)}">${
            esc(MATCH_TAG[c.match] || c.match)}</span>` : ""}</h3>
        ${posts}
      </div>
      ${also}
      ${pkgBlockHTML(c.packages)}`;
  }

  function postCardHTML(id, c) {
    const labels = META.section_labels || {};
    const specs = c.specs && c.specs.length
      ? `<div class="sp-links">${c.specs.map((sid) => {
          const s = CARDS[sid] || {};
          return linkBtn(sid, s.name || sid, labels[s.sec] || "");
        }).join("")}</div>`
      : `<div class="sp-empty">Жодна спеціальність Додатка 7 на цю посаду не виводить.
         Це нормально для адміністративних, технічних і допоміжних посад — ліцензія
         видається не на них.</div>`;

    const notes = (c.notes || []).length
      ? `<p class="sp-sub" style="margin-top:8px">У Переліку до цієї позиції є виноска
         № ${c.notes.join(", № ")} — дивіться примітки до наказу МОЗ № 1065.</p>`
      : "";

    return `
      <h2 class="sp-title">${esc(c.name)}</h2>
      <p class="sp-sub">${esc(PART_LABEL[c.part] || c.part)} · позиція № ${esc(c.no)}</p>
      <p class="sp-path">${esc((c.path || []).join(" → "))}</p>

      <div class="reader-block">
        <h3>Професійна кваліфікація для доступу</h3>
        ${c.qual
          ? `<div class="sp-qual">${esc(c.qual)}</div>`
          : `<div class="sp-empty">У Переліку графа кваліфікації для цієї позиції порожня —
             вимоги визначає професійний стандарт, а за його відсутності ДКХП, випуск 78.</div>`}
        <p class="sp-sub" style="margin-top:8px">${c.regulated
          ? "Професія належить до тих, для яких запроваджено <b>додаткове регулювання</b>."
          : "Додаткового регулювання для цієї професії не запроваджено."}</p>
        ${notes}
      </div>

      <div class="reader-block">
        <h3>Спеціальності Додатка 7, які ведуть на цю посаду</h3>
        ${specs}
      </div>
      ${pkgBlockHTML(c.packages)}`;
  }

  function pkgBlockHTML(nums) {
    if (!nums || !nums.length) {
      return `<div class="reader-block"><h3>Кадрові вимоги пакетів ПМГ-2026</h3>
        <div class="sp-empty">У блоці «Спеціалісти» жодного пакета ця позиція не згадується.</div>
        </div>`;
    }
    const rows = nums.map((n) => {
      const p = (PKG || []).find((x) => x.package === n);
      if (!p) return "";
      const lines = p.matched
        .filter((m) => m.posts.some((pid) => {
          const card = CARDS[openedId] || {};
          return pid === openedId || (card.posts || []).includes(pid);
        }))
        .map((m) => `<div class="sp-pkgline">${esc(m.line)}</div>`).join("");
      return `<div class="sp-pkgrow">
          <a href="../pakety/index.html?package=${esc(n)}" class="sp-pkgtitle">
            <span class="sp-pkgn">${esc(n)}</span>${esc(p.name)}</a>
          ${lines}</div>`;
    }).join("");
    return `<div class="reader-block"><h3>Кадрові вимоги пакетів ПМГ-2026
      <span class="sp-tag m-root">${nums.length}</span></h3>
      <div class="sp-pkglist">${rows}</div></div>`;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
