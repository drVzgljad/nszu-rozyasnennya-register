/* ============================================================
   Розділ «Критерії госпіталізації» (наказ МОЗ від 30.07.2026 № 1044)

   Три режими:
     Розбір    — що документ означає для ПМГ (data/analysis.json)
     Стандарт  — повний текст із деревом і пошуком (data/standard.json)
     Вебінар   — відповіді МОЗ 06.08.2026 (data/webinar.json)

   Адресація: ?tab=standard&block=I-17 відкриває конкретний пункт і
   підсвічує його — саме такі посилання йдуть у листи, тому вони мають
   переживати перезавантаження сторінки.
   ============================================================ */
(function () {
  "use strict";

  const YT = "https://www.youtube.com/watch?v=vDyRMsb4m5U";

  let STD = null, AN = null, WEB = null;
  let blockIndex = new Map();   // id блоку → {block, section}
  let curSection = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- завантаження ---------- */

  async function boot() {
    try {
      // Свідомо послідовно, а не Promise.all: standard.json важить 270 КБ, і
      // при трьох паралельних запитах локальний сервер віддає йому
      // ERR_CONNECTION_RESET — сторінка тоді назавжди лишається на
      // «Завантаження…». Виграш від паралелі тут — десятки мілісекунд,
      // ціна — розділ, що іноді не відкривається.
      STD = await getJson("data/standard.json");
      AN = await getJson("data/analysis.json");
      WEB = await getJson("data/webinar.json");
    } catch (err) {
      const msg = `<div class="gp-empty"><div class="gp-empty-ico">⚠️</div>
        <h2>Не вдалося завантажити дані розділу</h2>
        <p>${esc(err.message)}</p></div>`;
      $("analysisBody").innerHTML = msg;
      $("tree").innerHTML = msg;
      $("webinarBody").innerHTML = msg;
      return;
    }

    for (const sec of STD.sections) {
      for (const b of sec.blocks) blockIndex.set(b.id, { block: b, section: sec });
    }

    fillStats();
    renderAnalysis();
    renderTree();
    renderWebinar();
    wireTabs();
    wireSearch();
    applyUrl();
  }

  async function getJson(path, attempt) {
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      if ((attempt || 0) < 1) return getJson(path, (attempt || 0) + 1);
      throw new Error(`${path}: ${err.message}`);
    }
  }

  function fillStats() {
    const secIV = STD.sections.find((s) => s.id === "IV");
    const secV = STD.sections.find((s) => s.id === "V");
    // Соціальні показання — пункти-крапки під «3. Перелік соціальних
    // показань», тобто все, що йде після нього до кінця розділу.
    const iAfter = secV.blocks.findIndex((b) => b.marker === "3.");
    const social = secV.blocks.slice(iAfter + 1).filter((b) => b.kind === "bullet").length;

    $("statSections").textContent = STD.sections.length;
    $("statBlocks").textContent = STD.sections.reduce((n, s) => n + s.blocks.length, 0);
    $("statStates").textContent = secIV.blocks.filter((b) => b.kind === "num").length;
    $("statSocial").textContent = social;
    if (STD.meta && STD.meta.generated) {
      const [y, m, d] = STD.meta.generated.split("-");
      $("footerFresh").textContent = `${d}.${m}.${y}`;
    }
  }

  /* ---------- режим 1: розбір ---------- */

  function refLink(id, label) {
    if (!id || !blockIndex.has(id)) return "";
    return `<button class="gp-link" data-goto="${esc(id)}">📖 ${esc(label || id)}</button>`;
  }

  function ytLink(sec) {
    if (sec == null) return "";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const stamp = (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + ":" + String(s).padStart(2, "0");
    return `<a class="gp-link" href="${YT}&t=${sec}s" target="_blank" rel="noopener">🎙️ вебінар ${stamp}</a>`;
  }

  function renderAnalysis() {
    const v = AN.verdict;
    const parts = [];

    parts.push(`<div class="gp-verdict">
      <p class="gp-verdict-lead">${esc(v.lead)}</p>
      <ul class="gp-vpoints">${v.points.map((p) => `
        <li class="gp-vpoint">
          <span class="gp-badge ${p.kind}">${p.kind === "norm" ? "норма" : "наша оцінка"}</span>
          <span>${esc(p.text)} ${refLink(p.ref, p.reflabel)}</span>
        </li>`).join("")}</ul>
    </div>`);

    parts.push(`<h2 class="gp-h2">Чотири маршрути обґрунтування</h2>
      <p class="gp-h2-note">${esc(AN.routes.lead)}</p>
      <div class="gp-routes">${AN.routes.items.map((r) => `
        <button class="gp-route" data-section="${esc(r.sec)}" type="button">
          <span class="gp-route-top">
            <span class="gp-route-n">${esc(r.n)}</span>
            <h3>${esc(r.title)}</h3>
            <span class="gp-route-sec">розд. ${esc(r.sec)}</span>
          </span>
          <p>${esc(r.text)}</p>
          <span class="gp-route-count">${esc(String(r.count))} ${plural(r.count, "позиція", "позиції", "позицій")} →</span>
        </button>`).join("")}</div>`);

    const sc = AN.scope;
    parts.push(`<h2 class="gp-h2">Периметр документа</h2>
      <div class="gp-scope">
        <div class="gp-scope-card">
          <h3>Що охоплює</h3>
          <ul>${sc.covers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        </div>
        <div class="gp-scope-card is-out">
          <h3>Чого прямо не стосується ${refLink(sc.ref, "п. 6 розд. І")}</h3>
          <ul>${sc.notcovers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        </div>
      </div>
      <p class="gp-scope-note">${esc(sc.note)}</p>`);

    // Вузли тертя, згруповані так, як їх задано в даних
    const groups = [];
    for (const f of AN.friction) {
      let g = groups.find((x) => x.name === f.group);
      if (!g) groups.push((g = { name: f.group, items: [] }));
      g.items.push(f);
    }
    parts.push(`<h2 class="gp-h2">Вузли тертя</h2>
      <p class="gp-h2-note">Кожен вузол: що написано в акті → що це означає для ПМГ → що з цим робити.
        Перше — норма, друге і третє — наша оцінка.</p>`);
    for (const g of groups) {
      parts.push(`<div class="gp-fgroup"><h3>${esc(g.name)}</h3><div class="gp-fnodes">${
        g.items.map(renderNode).join("")}</div></div>`);
    }

    parts.push(`<h2 class="gp-h2">Чинність</h2>
      <div class="gp-validity">
        <div class="gp-row"><span class="gp-badge norm">норма</span><p>${esc(AN.validity.norm)}</p></div>
        <div class="gp-row ours"><span class="gp-badge ours">наша оцінка</span><p>${esc(AN.validity.ours)}</p></div>
      </div>`);

    parts.push(`<h2 class="gp-h2">Що лишилося зробити</h2>
      <ul class="gp-debts">${AN.debts.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>`);

    $("analysisBody").innerHTML = parts.join("");

    $("analysisBody").addEventListener("click", (e) => {
      const head = e.target.closest(".gp-fhead");
      if (head) { head.closest(".gp-fnode").classList.toggle("is-open"); return; }
      const route = e.target.closest(".gp-route");
      if (route) { openSection(route.dataset.section); return; }
      const goto = e.target.closest("[data-goto]");
      if (goto) gotoBlock(goto.dataset.goto);
    });
  }

  function renderNode(f) {
    const refs = [refLink(f.ref, f.reflabel), ytLink(f.webinar)].filter(Boolean).join("");
    return `<div class="gp-fnode${f.warn ? " is-warn" : ""}">
      <button class="gp-fhead" type="button">
        <span class="gp-fchev" aria-hidden="true">▶</span>
        <h4>${esc(f.title)}</h4>
      </button>
      <div class="gp-fbody">
        <div class="gp-row"><span class="gp-badge norm">норма</span><p>${esc(f.norm)}</p></div>
        ${refs ? `<div style="margin:-4px 0 12px 0">${refs}</div>` : ""}
        <div class="gp-row ours"><span class="gp-badge ours">наша оцінка</span><p>${esc(f.ours)}</p></div>
        <p class="gp-action"><b>Що з цим робити.</b> ${esc(f.action)}</p>
      </div>
    </div>`;
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* ---------- режим 2: текст стандарту ---------- */

  function renderTree() {
    const nodes = [
      { key: "order", num: "", title: "Наказ № 1044", count: STD.order.length },
      { key: "abbrev", num: "", title: "Перелік скорочень", count: STD.abbrev.length },
      ...STD.sections.map((s) => ({ key: s.id, num: s.id + ".", title: s.title, count: s.blocks.length })),
      { key: "sources", num: "", title: "Перелік джерел", count: STD.sources.length },
    ];
    $("tree").innerHTML = nodes.map((n) => `
      <button class="gp-tnode" data-key="${esc(n.key)}" type="button">
        <span class="gp-tcount">${n.count}</span>
        ${n.num ? `<span class="gp-tnum">${esc(n.num)}</span>` : ""}${esc(n.title)}
      </button>`).join("");
    $("tree").addEventListener("click", (e) => {
      const b = e.target.closest(".gp-tnode");
      if (b) openSection(b.dataset.key);
    });
  }

  // openSection = «перемкнути вкладку і показати розділ», renderSection =
  // тільки друга половина. Розділяти обовʼязково: коли switchTab сам кликав
  // openSection для розділу за замовчуванням, а openSection першим рядком
  // кликав switchTab, виходила нескінченна рекурсія — вкладка «Стандарт»
  // мовчки не відкривалася взагалі.
  function openSection(key, opts) {
    switchTab("standard", { silent: true });
    renderSection(key, opts);
  }

  function renderSection(key, opts) {
    curSection = key;
    for (const b of $("tree").querySelectorAll(".gp-tnode")) {
      b.classList.toggle("is-active", b.dataset.key === key);
    }
    const reader = $("reader");

    if (key === "order") {
      reader.innerHTML = `<h2>Наказ МОЗ від ${esc(STD.meta.order_date)} № ${esc(STD.meta.order_no)}</h2>
        <p class="gp-reader-sub">${esc(STD.meta.order_title)}</p>
        ${STD.order.map((p) => `<p class="gp-b gp-b-para">${esc(p)}</p>`).join("")}`;
    } else if (key === "abbrev") {
      reader.innerHTML = `<h2>Перелік скорочень</h2>
        <p class="gp-reader-sub">${STD.abbrev.length} ${plural(STD.abbrev.length, "позиція", "позиції", "позицій")} зі Стандарту</p>
        <dl class="gp-abbr">${STD.abbrev.map((a) =>
          `<dt>${esc(a.short)}</dt><dd>${esc(a.full)}</dd>`).join("")}</dl>`;
    } else if (key === "sources") {
      reader.innerHTML = `<h2>Перелік джерел</h2>
        <p class="gp-reader-sub">${STD.sources.length} ${plural(STD.sources.length, "позиція", "позиції", "позицій")}: нормативно-правові акти
          (1–14) і наукові джерела, використані при підготовці Стандарту</p>
        ${STD.sources.map((s, i) => `<p class="gp-b gp-b-src">${i + 1}. ${esc(s)}</p>`).join("")}`;
    } else {
      const sec = STD.sections.find((s) => s.id === key);
      if (!sec) return;
      reader.innerHTML = `<h2>${esc(sec.id)}. ${esc(sec.title)}</h2>
        <p class="gp-reader-sub">${sec.blocks.length} ${plural(sec.blocks.length, "пункт", "пункти", "пунктів")}
          · наведіть на пункт, щоб узяти посилання на нього</p>
        ${sec.blocks.map(renderBlock).join("")}`;
    }

    if (!opts || !opts.silent) setUrl({ tab: "standard", section: key });
    if (!opts || !opts.keepScroll) reader.focus({ preventScroll: true });
    highlightCurrentQuery();
  }

  function blockHtml(b, toks) {
    const m = b.marker ? `<span class="gp-m">${esc(b.marker)}</span> ` : "";
    const acts = b.acts && b.acts.length
      ? `<span class="gp-acts">${b.acts.map((a) => `<span class="gp-act">${esc(a)}</span>`).join("")}</span>`
      : "";
    const body = toks && toks.length ? highlight(b.text, toks) : esc(b.text);
    return `${m}${body}
      <button class="gp-anchor" data-copy="${esc(b.id)}" title="Скопіювати посилання на пункт">🔗</button>
      ${acts}`;
  }

  function renderBlock(b) {
    return `<p class="gp-b gp-b-${b.kind}" id="b-${esc(b.id)}" data-id="${esc(b.id)}">${blockHtml(b)}</p>`;
  }

  function gotoBlock(id) {
    const rec = blockIndex.get(id);
    if (!rec) return;
    switchTab("standard", { silent: true });
    if (curSection !== rec.section.id) renderSection(rec.section.id, { silent: true, keepScroll: true });
    const el = document.getElementById("b-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Знімаємо підсвітку з усіх, а не лише з цільового: анімація
    // закінчується, а клас лишається, і через кілька переходів у розділі
    // «світиться» половина пунктів.
    for (const p of $("reader").querySelectorAll(".gp-b.is-flash")) p.classList.remove("is-flash");
    void el.offsetWidth;              // перезапуск анімації
    el.classList.add("is-flash");
    setUrl({ tab: "standard", section: rec.section.id, block: id });
  }

  /* ---------- пошук ---------- */

  function wireSearch() {
    const input = $("q");
    let t = null;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(runSearch, 160);
      $("qClear").hidden = !input.value;
    });
    $("qClear").addEventListener("click", () => {
      input.value = ""; $("qClear").hidden = true; runSearch(); input.focus();
    });
    $("reader").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-copy]");
      if (!btn) return;
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set("tab", "standard");
      url.searchParams.set("block", btn.dataset.copy);
      const text = url.toString();
      const done = () => { btn.textContent = "✓"; setTimeout(() => { btn.textContent = "🔗"; }, 1200); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt("Посилання:", text));
      else prompt("Посилання:", text);
    });
  }

  // fold() зберігає довжину рядка (лише регістр і варіанти апострофа), тому
  // індекси збігу можна прикладати до оригіналу. norm() додатково стискає
  // пробіли — для порівняння годиться, для координат ні.
  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  function fold(s) {
    // Нижні індекси зводяться до звичайних цифр: у стандарті пишеться
    // «SpO₂» і «FiO₂», а з клавіатури набирають «SpO2». Заміна символ у
    // символ, довжина не змінюється — індекси збігу лишаються дійсними.
    return s.toLowerCase().replace(/[ʼ’`]/g, "'")
      .replace(/[₀-₉]/g, (c) => String(SUB.indexOf(c)));
  }
  function norm(s) {
    return fold(s).replace(/\s+/g, " ");
  }

  // Пошук по українському тексту без стемінгу знаходить «денний стаціонар»
  // рівно нуль разів: у стандарті це «денного стаціонару» і «денним
  // стаціонаром». Тому кожне слово довше за пʼять літер шукається без
  // двох останніх — груба, але робоча заміна морфології.
  function toks(raw) {
    return norm(raw)
      .split(/[^0-9a-zа-яіїєґ'’ʼ]+/i)
      .filter((t) => t.length >= 3)
      .map((t) => (t.length > 5 ? t.slice(0, t.length - 2) : t));
  }

  const WORD = /[0-9₀-₉a-zа-яіїєґ'’ʼ]/i;

  // Корінь шукається ТІЛЬКИ з початку слова. Інакше «денн» знаходиться в
  // «переве-денн-я», і запит «денний стаціонар» тягне пів розділу І.
  function starts(hay, t) {
    const out = [];
    let i = hay.indexOf(t);
    while (i >= 0) {
      if (i === 0 || !WORD.test(hay[i - 1])) out.push(i);
      i = hay.indexOf(t, i + 1);
    }
    return out;
  }

  function matches(text, list) {
    const hay = fold(text);
    return list.every((x) => starts(hay, x).length > 0);
  }

  function highlight(text, list) {
    const hay = fold(text);
    const spans = [];
    for (const t of list) {
      for (const i of starts(hay, t)) spans.push([i, i + t.length]);
    }
    if (!spans.length) return esc(text);
    // Шукали обрізаний корінь, а підсвічувати треба ціле слово: «денн» і
    // «стаціон» посеред речення читаються як помилка верстки.
    for (const s of spans) {
      while (s[1] < text.length && WORD.test(text[s[1]])) s[1]++;
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [spans[0]];
    for (const s of spans.slice(1)) {
      const last = merged[merged.length - 1];
      if (s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
      else merged.push(s);
    }
    let out = "", pos = 0;
    for (const [a, b] of merged) {
      out += esc(text.slice(pos, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>";
      pos = b;
    }
    return out + esc(text.slice(pos));
  }

  function runSearch() {
    const raw = $("q").value.trim();
    const hits = $("hits");
    if (raw.length < 2) {
      hits.hidden = true;
      highlightCurrentQuery();   // порожній запит = зняти всі підсвітки
      return;
    }
    const list = toks(raw);
    if (!list.length) { hits.hidden = true; return; }
    const perSection = new Map();
    let total = 0;
    for (const sec of STD.sections) {
      const n = sec.blocks.filter((b) => matches(b.text, list)).length;
      if (n) { perSection.set(sec.id, n); total += n; }
    }
    hits.hidden = false;
    hits.innerHTML = total
      ? `Знайдено <b>${total}</b> ${plural(total, "пункт", "пункти", "пунктів")}: ` +
        [...perSection].map(([id, n]) =>
          `<button class="gp-link" data-section="${id}">розд. ${id} — ${n}</button>`).join(" ")
      : "Нічого не знайдено. Спробуйте коротший запит або інше слово.";
    hits.onclick = (e) => {
      const b = e.target.closest("[data-section]");
      if (b) openSection(b.dataset.section);
    };
    highlightCurrentQuery();
  }

  // Підсвітка перемальовує абзац цілком із даних (blockHtml), а не ріже
  // готовий DOM: інакше кнопка-якір і мітки актів злітають після першої ж
  // букви в пошуку.
  function highlightCurrentQuery() {
    const raw = $("q").value.trim();
    const list = raw.length >= 2 ? toks(raw) : [];
    for (const el of $("reader").querySelectorAll(".gp-b")) {
      const rec = el.dataset.id ? blockIndex.get(el.dataset.id) : null;
      if (!rec) continue;
      const hit = list.length > 0 && matches(rec.block.text, list);
      el.classList.toggle("is-hit", hit);
      el.innerHTML = blockHtml(rec.block, hit ? list : null);
    }
  }

  /* ---------- режим 3: вебінар ---------- */

  function renderWebinar() {
    const m = WEB.meta;
    const parts = [`<div class="gp-wmeta">
      <h2>${esc(m.title)}</h2>
      <div class="gp-wfacts">
        <span><b>${esc(m.date)}</b>, ${esc(m.started)}</span>
        <span>${esc(m.channel)}</span>
        <span><b>${m.views_at_capture.toLocaleString("uk-UA")}</b> переглядів на ${esc(m.captured)}</span>
        <span>${esc(m.questions_reported)}</span>
        <a class="gp-link" href="${esc(m.url)}" target="_blank" rel="noopener">🎙️ дивитися запис</a>
      </div>
      <ul class="gp-wspeakers">${m.speakers.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <p class="gp-wdisc">${esc(m.disclaimer)}</p>
    </div>`];

    for (const g of WEB.groups) {
      parts.push(`<div class="gp-wgroup">
        <h3><span aria-hidden="true">${esc(g.icon)}</span> ${esc(g.title)}</h3>
        ${g.note ? `<p class="gp-wgroup-note">${esc(g.note)}</p>` : ""}
        ${g.items.map((it) => `
          <div class="gp-qa${it.warn ? " is-warn" : ""}">
            <h4>${esc(it.q)}</h4>
            <p class="gp-qa-a">${esc(it.a)}</p>
            ${it.note ? `<p class="gp-note">${esc(it.note)}</p>` : ""}
            ${it.warn ? `<p class="gp-note is-warn">${esc(it.warn)}</p>` : ""}
            <div class="gp-qa-foot">
              <span class="gp-who">${esc(it.who)}</span>
              ${ytLink(it.t)}
            </div>
          </div>`).join("")}
      </div>`);
    }
    $("webinarBody").innerHTML = parts.join("");
  }

  /* ---------- вкладки й адреса ---------- */

  const TABS = {
    analysis: { btn: "tabAnalysis", view: "viewAnalysis" },
    standard: { btn: "tabStandard", view: "viewStandard" },
    webinar: { btn: "tabWebinar", view: "viewWebinar" },
  };

  function switchTab(name, opts) {
    for (const [k, t] of Object.entries(TABS)) {
      const on = k === name;
      $(t.btn).classList.toggle("is-active", on);
      $(t.btn).setAttribute("aria-selected", String(on));
      $(t.view).classList.toggle("is-visible", on);
      $(t.view).hidden = !on;
    }
    if (name === "standard" && !curSection) renderSection("I", { silent: true });
    if (!opts || !opts.silent) setUrl({ tab: name, section: name === "standard" ? curSection : null });
  }

  function wireTabs() {
    for (const [k, t] of Object.entries(TABS)) {
      $(t.btn).addEventListener("click", () => switchTab(k));
    }
  }

  function setUrl(state) {
    const u = new URL(location.href);
    u.search = "";
    if (state.tab && state.tab !== "analysis") u.searchParams.set("tab", state.tab);
    if (state.block) u.searchParams.set("block", state.block);
    else if (state.section) u.searchParams.set("section", state.section);
    history.replaceState(null, "", u);
  }

  function applyUrl() {
    const p = new URLSearchParams(location.search);
    const block = p.get("block");
    if (block && blockIndex.has(block)) { switchTab("standard", { silent: true }); gotoBlock(block); return; }
    const section = p.get("section");
    if (section) { switchTab("standard", { silent: true }); renderSection(section, { silent: true }); return; }
    const tab = p.get("tab");
    if (tab && TABS[tab]) switchTab(tab, { silent: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
