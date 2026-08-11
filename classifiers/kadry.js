/* ============================================================
   Кадровий ланцюжок пакета — проба візуалізації.

   Питання, на яке відповідає сторінка: якщо взяти ОДНУ річ — пакет,
   спеціальність, посаду, характеристику чи код — що з неї випливає в усіх
   інших реєстрах. П'ять ланок, чотири різні акти, і на кожному переході
   частина позицій губиться — саме це й малюємо.

   Обхід іде в ОБИДВА боки від того, що ввели. Від спеціальності — праворуч
   (які посади, характеристики, коди), від коду — ліворуч (яка характеристика,
   посада, спеціальність), від посади — в обидва. Тому «якір» може стояти в
   будь-якій колонці, і саме він підсвічений на схемі.

   Дані: data/kadry/graph.json — повний граф. Тут він доречний: сторінка ходить
   усіма п'ятьма типами вузлів і всіма відношеннями, тож зрізами вийшло б
   десять запитів замість одного.
   ============================================================ */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Підпис під вікном — акт, який цю ланку встановлює. Беремо з реєстру джерел
  // у графі, щоб не тримати другий список актів у сторінці.
  const SRC_KEY = { req: "pkgreq", post: "post", dkhp: "dkhp", code: "code", spec: "spec" };

  // Порядок ланок. Ліворуч — право працювати, праворуч — облік у ЕСОЗ.
  const LAYERS = ["spec", "post", "dkhp", "code"];
  const REL = { spec: "spec_post", post: "post_dkhp", dkhp: "dkhp_code" };

  let G = null, N = null, OUT = null, IN = null;
  let SEARCH = [];                       // легкий індекс для пошуку
  let current = null, anchor = null;
  const openSet = new Set();          // які секції розкриті

  function boot() {
    fetch("data/kadry/graph.json")
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((g) => {
        G = g;
        N = new Map(g.nodes.map((n) => [n.id, n]));
        OUT = new Map(); IN = new Map();
        g.edges.forEach((e) => { push(OUT, e.from, e); push(IN, e.to, e); });
        buildSearch();
        fillPicker();
        wireSearch();
        const q = new URLSearchParams(location.search);
        const pkg = q.get("package"), node = q.get("id"), text = q.get("q");
        if (node && N.has(node)) setAnchor({ kind: "node", id: node });
        else if (text) { $("#kdSearch").value = text; pickBest(text); }
        else {
          const sel = $("#kdPkg");
          sel.value = pkg && [...sel.options].some((o) => o.value === pkg)
            ? pkg : (sel.options[1] ? sel.options[1].value : "");
          setAnchor({ kind: "pkg", id: sel.value });
        }
      })
      .catch((e) => {
        // Помилку видно в консолі: інакше будь-яка похибка в малюванні
        // виглядає як «не завантажилися дані», хоча дані вже тут.
        console.error("Кадровий ланцюжок:", e);
        $("#kdFigure").innerHTML =
          '<p class="kd-error">Не вдалося побудувати ланцюжок. Подробиці — у консолі.</p>';
      });
  }

  function push(m, k, v) { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }
  const out = (id, rel) => (OUT.get(id) || []).filter((e) => e.rel === rel);
  const inc = (id, rel) => (IN.get(id) || []).filter((e) => e.rel === rel);
  const pkgSort = (a, b) => (+a || 999) - (+b || 999);

  function fillPicker() {
    const sel = $("#kdPkg");
    sel.innerHTML = '<option value="">— оберіть пакет —</option>' +
      Object.keys(G.packages).sort(pkgSort).map((no) =>
        `<option value="${esc(no)}">№ ${esc(no)} · ${esc(G.packages[no])}</option>`).join("");
    sel.addEventListener("change", () => {
      if (sel.value) { $("#kdSearch").value = ""; setAnchor({ kind: "pkg", id: sel.value }); }
    });
  }

  // ── пошук за назвою ─────────────────────────────────────────────────────
  const TYPE_WORD = {
    spec: "спеціальність", post: "посада",
    dkhp: "характеристика ДКХП", code: "код НСЗУ",
  };

  function buildSearch() {
    SEARCH = G.nodes
      .filter((n) => LAYERS.includes(n.type))
      .map((n) => ({ id: n.id, type: n.type, name: n.name, low: n.name.toLowerCase(),
                     code: n.type === "code" ? n.id.split(":")[1].toLowerCase() : "" }));
  }

  /** Кандидати за підрядком. Спершу ті, у кого запит на початку назви —
   *  інакше «сестра» видає спершу «Головна медична сестра», а не «Сестра
   *  медична». Код НСЗУ шукається і як «P37», і як «p 37». */
  function suggest(q) {
    const s = q.toLowerCase().trim().replace(/\s+/g, " ");
    if (s.length < 2) return [];
    const code = s.replace(/\s+/g, "");
    const hit = SEARCH.filter((x) => x.low.includes(s) || (x.code && x.code === code));
    hit.sort((a, b) => {
      const ai = a.low.startsWith(s) ? 0 : 1, bi = b.low.startsWith(s) ? 0 : 1;
      return ai - bi || a.name.length - b.name.length;
    });
    return hit.slice(0, 12);
  }

  function wireSearch() {
    const inp = $("#kdSearch"), list = $("#kdSuggest");
    let items = [], cursor = -1;

    const close = () => { list.hidden = true; inp.setAttribute("aria-expanded", "false"); cursor = -1; };
    const render = () => {
      if (!items.length) { close(); return; }
      list.innerHTML = items.map((x, i) => `
        <li role="option" data-i="${i}" aria-selected="${i === cursor}"
            class="${i === cursor ? "on" : ""}">
          <span class="kd-sg-n">${esc(x.name)}</span>
          <span class="kd-sg-t">${esc(x.type === "code" ? x.id.split(":")[1] : TYPE_WORD[x.type])}</span>
        </li>`).join("");
      list.hidden = false;
      inp.setAttribute("aria-expanded", "true");
    };
    const choose = (i) => {
      const x = items[i]; if (!x) return;
      inp.value = x.name; close(); $("#kdPkg").value = "";
      setAnchor({ kind: "node", id: x.id });
    };

    inp.addEventListener("input", () => { items = suggest(inp.value); cursor = -1; render(); });
    inp.addEventListener("keydown", (e) => {
      if (list.hidden && e.key !== "Enter") return;
      if (e.key === "ArrowDown") { cursor = Math.min(cursor + 1, items.length - 1); render(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { cursor = Math.max(cursor - 1, 0); render(); e.preventDefault(); }
      else if (e.key === "Enter") { e.preventDefault(); cursor >= 0 ? choose(cursor) : pickBest(inp.value); }
      else if (e.key === "Escape") close();
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) { e.preventDefault(); choose(+li.dataset.i); }
    });
    inp.addEventListener("blur", () => setTimeout(close, 120));
  }

  /** Вставили назву цілком і натиснули Enter — беремо найкращий збіг. */
  function pickBest(text) {
    const hits = suggest(text);
    if (!hits.length) {
      $("#kdFigure").innerHTML =
        `<p class="kd-error">За запитом «${esc(text)}» нічого не знайдено —
         ні спеціальності, ні посади, ні характеристики, ні коду.</p>`;
      $("#kdSummary").innerHTML = ""; $("#kdDetail").hidden = true;
      return;
    }
    $("#kdSearch").value = hits[0].name; $("#kdPkg").value = "";
    setAnchor({ kind: "node", id: hits[0].id });
  }

  function openBox(key) {
    openSet.add(key);
    renderSections();
    const el = $(`.kd-sec[data-key="${key}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function setAnchor(a, keepOpen) {
    anchor = a;
    // Розкриті секції лишаються розкритими: людина щойно їх відкрила, і
    // згортати все під ногами через перехід — втратити місце.
    if (!keepOpen) { /* набір openSet зберігаємо навмисно */ }
    draw();
  }

  /** Перехід за рядком нижньої панелі. Відкрите вікно НЕ закриваємо: людина
   *  щойно дивилася список, і згорнути його під ногами — втратити контекст. */
  function goTo(id) {
    const n = N.get(id);
    if (!n) return;
    $("#kdSearch").value = n.type === "pkgreq" ? "" : n.name;
    $("#kdPkg").value = "";
    setAnchor({ kind: "node", id }, true);
  }

  /** Обхід ланцюжка від будь-якої точки — в обидва боки.
   *
   *  Якір може стояти в будь-якій колонці: від спеціальності розповзаємося
   *  праворуч (посади → характеристики → коди), від коду — ліворуч, від посади
   *  — в обидва боки. Пакет заходить через свої кадрові вимоги і сідає на
   *  колонку посад.
   *
   *  Втрати рахуються ВІД ТОГО, ЩО В КАДРІ. Якщо зайшли з коду, посади в кадрі
   *  — лише ті, що ведуть до нього, і «0 без характеристики» тут правда саме
   *  для цієї вибірки, а не для всього Переліку. */
  function walkFrom(a) {
    const S = { spec: new Set(), post: new Set(), dkhp: new Set(), code: new Set() };
    const reqs = new Set();
    let start;

    // Набір вимог фіксований, коли зайшли з пакета або з однієї вимоги: тоді
    // решта вимог на ті самі посади в кадр не потрапляє — питання ж було про
    // цю вимогу, а не про всі.
    let fixedReqs = false;
    if (a.kind === "pkg") {
      G.nodes.forEach((n) => { if (n.type === "pkgreq" && n.package === a.id) reqs.add(n.id); });
      reqs.forEach((r) => out(r, "req_post").forEach((e) => S.post.add(e.to)));
      start = LAYERS.indexOf("post");
      fixedReqs = true;
    } else if (N.get(a.id).type === "pkgreq") {
      reqs.add(a.id);
      out(a.id, "req_post").forEach((e) => S.post.add(e.to));
      start = LAYERS.indexOf("post");
      fixedReqs = true;
    } else {
      const n = N.get(a.id);
      S[n.type].add(a.id);
      start = LAYERS.indexOf(n.type);
    }

    for (let i = start; i > 0; i--) {
      const rel = REL[LAYERS[i - 1]];
      S[LAYERS[i]].forEach((id) => inc(id, rel).forEach((e) => S[LAYERS[i - 1]].add(e.from)));
    }
    for (let i = start; i < LAYERS.length - 1; i++) {
      const rel = REL[LAYERS[i]];
      S[LAYERS[i]].forEach((id) => out(id, rel).forEach((e) => S[LAYERS[i + 1]].add(e.to)));
    }
    if (!fixedReqs) {
      S.post.forEach((p) => inc(p, "req_post").forEach((e) => reqs.add(e.from)));
    }

    const noNext = (ids, rel) => [...ids].filter((id) => !out(id, rel).length);
    const reqArr = [...reqs].sort(byReqId);
    return {
      anchorKey: a.kind === "pkg" || N.get(a.id).type === "pkgreq"
        ? "req" : N.get(a.id).type,
      req: reqArr, post: [...S.post], dkhp: [...S.dkhp], code: [...S.code], spec: [...S.spec],
      lost: {
        req: noNext(reqArr, "req_post"),
        post: noNext(S.post, "post_dkhp"),
        dkhp: noNext(S.dkhp, "dkhp_code"),
        spec: [...S.post].filter((p) => !inc(p, "spec_post").length),
      },
      critical: reqArr.filter((id) => (N.get(id) || {}).critical),
      tone: reqArr.reduce((acc, id) => {
        const t = (N.get(id) || {}).tone || "ok"; acc[t] = (acc[t] || 0) + 1; return acc;
      }, {}),
    };
  }

  function byReqId(a, b) {
    const pa = +N.get(a).package, pb = +N.get(b).package;
    return (pa || 999) - (pb || 999) || a.localeCompare(b);
  }

  /** Короткий підпис акта під вікном: «постанова КМУ від 31.12.2025 № 1808»
   *  → «ПКМУ № 1808». Обрізати довгу назву трьома крапками не можна — саме
   *  номер акта й несе тут сенс, а він стоїть у кінці. */
  function actLabel(key) {
    const t = G.node_types[SRC_KEY[key]] || {};
    if (!t.act_title) return trim((t.source || "").split(" — ")[0], 28);
    const m = /^(.+?)\s+від\s+[\d.]+\s+(№\s*[\d\-/]+)/.exec(t.act_title);
    if (!m) return trim(t.act_title, 28);
    return `${m[1].replace(/^постанова КМУ$/, "ПКМУ")} ${m[2]}`;
  }

  // ── малювання ───────────────────────────────────────────────────────────
  //
  // Схема на HTML, а не на SVG, і це навмисно: у вікні має стояти сам зміст —
  // назва посади, назва характеристики, код, — а не число. SVG не переносить
  // рядки, тож довгі назви довелося б або різати, або міряти вручну. Сітка
  // CSS заодно вирівнює вікна й стрілки між ними сама.

  // Скільки назв показуємо просто у вікні. Більше — і вікно перетворюється на
  // список; тоді чесніше показати число і відкрити список натисканням.
  const SHOW_MAX = 3;

  const TITLES_BOX = {
    req: "Кадрові вимоги", spec: "Спеціальності",
    post: "Посади", dkhp: "Характеристики", code: "Коди НСЗУ",
  };

  function draw() {
    if (!anchor || !anchor.id) {
      $("#kdFigure").innerHTML = ""; $("#kdSummary").innerHTML = "";
      $("#kdDetail").hidden = true; return;
    }
    current = walkFrom(anchor);
    renderSummary(current);
    $("#kdFigure").innerHTML = figureHTML(current) + critNoteHTML(current);
    $("#kdFigure").querySelectorAll("[data-box]").forEach((b) =>
      b.addEventListener("click", () => openBox(b.dataset.box)));
    renderSections();
  }

  /** Рядок над схемою: що саме зараз показано і чи є з ним проблема. */
  function renderSummary(w) {
    if (anchor.kind === "pkg") {
      const t = w.tone, bad = (t.warn || 0) + (t.risk || 0);
      $("#kdSummary").innerHTML = `
        <div class="kd-sum-line"><b>${nf(w.req.length)}</b> ${
          plural(w.req.length, "кадрова вимога", "кадрові вимоги", "кадрових вимог")}</div>
        ${bad ? `<div class="kd-sum-warn">${nf(bad)} із них ${
          plural(bad, "має", "мають", "мають")} посади поза Переліком МОЗ</div>`
        : '<div class="kd-sum-ok">усі вимоги виконувані посадами з Переліку МОЗ</div>'}`;
      return;
    }
    const n = N.get(anchor.id);
    if (n.type === "pkgreq") {
      const t = n.tone || "ok";
      $("#kdSummary").innerHTML = `
        <div class="kd-sum-line"><b>${esc(trim(n.name, 70))}</b></div>
        <div class="kd-sum-kind">кадрова вимога пакета № ${esc(n.package)}${
          n.critical ? " · критична" : ""}</div>
        <div class="${t === "ok" ? "kd-sum-ok" : "kd-sum-warn"}">${
          esc((G.tones || {})[t] || "")}</div>`;
      return;
    }
    const pk = new Set(w.req.map((id) => N.get(id).package));
    const t = G.node_types[n.type] || {};
    $("#kdSummary").innerHTML = `
      <div class="kd-sum-line"><b>${esc(trim(n.name, 60))}</b></div>
      <div class="kd-sum-kind">${esc(TYPE_WORD[n.type])} · ${esc(actLabel(n.type))}${
        t.status ? " · " + esc(t.status) : ""}</div>
      ${pk.size ? `<div class="kd-sum-ok">трапляється у ${nf(pk.size)} ${
        plural(pk.size, "пакеті", "пакетах", "пакетах")} ПМГ-2026</div>`
      : '<div class="kd-sum-kind">жоден пакет ПМГ-2026 цього не вимагає</div>'}`;
  }

  /** Вміст вікна: назви, поки їх мало, і число, коли їх багато. */
  function boxBody(key, ids) {
    if (!ids.length) {
      return `<div class="kd-none">${esc(emptyWhy(key))}</div>`;
    }
    if (ids.length <= SHOW_MAX) {
      return `<div class="kd-vals">${ids.map((id) => {
        const n = N.get(id) || {};
        const extra = key === "code" ? `<span class="kd-code">${esc(id.split(":")[1])}</span>`
          : key === "dkhp" && n.page ? `<span class="kd-sub">с. ${esc(n.page)} Довідника</span>`
          : key === "post" && n.no ? `<span class="kd-sub">позиція № ${esc(n.no)}</span>`
          : key === "spec" && n.sec ? `<span class="kd-sub">${esc(secLabel(n.sec))}</span>`
          : key === "req" ? `<span class="kd-sub">пакет № ${esc(n.package)}</span>` : "";
        return `<div class="kd-val"><span class="kd-val-n">${
          esc(trim(n.name || id, 90))}</span>${extra}</div>`;
      }).join("")}</div>`;
    }
    const sample = ids.slice(0, 2).map((id) => trim((N.get(id) || {}).name || id, 34));
    return `<div class="kd-many">
        <span class="kd-cnt-big">${nf(ids.length)}</span>
        <span class="kd-cnt-word">${esc(countWord(key, ids.length))}</span>
        <span class="kd-sample">${esc(sample.join(" · "))} …</span>
      </div>`;
  }

  /** Підпис розділу Додатка 7 — з реєстру підписів у графі, не свій список. */
  function secLabel(k) { return ((G.labels || {}).sec || {})[k] || k; }

  function countWord(key, n) {
    if (key === "req") return plural(n, "вимога", "вимоги", "вимог");
    if (key === "post") return plural(n, "посада", "посади", "посад");
    if (key === "dkhp") return plural(n, "характеристика", "характеристики", "характеристик");
    if (key === "code") return plural(n, "код", "коди", "кодів");
    return plural(n, "спеціальність", "спеціальності", "спеціальностей");
  }

  function emptyWhy(key) {
    return key === "dkhp" ? "характеристики в ДКХП немає"
      : key === "code" ? "коду НСЗУ немає"
      : key === "spec" ? "жодна спеціальність не веде на цю посаду"
      : key === "req" ? "жоден пакет цього не вимагає"
      : "немає";
  }

  function boxHTML(key, ids, lostText) {
    const on = current && current.anchorKey === key ? " on" : "";
    const empty = ids.length ? "" : " empty";
    // Вікно вимог виділяємо, коли серед них є критичні: це єдина ланка, де
    // невідповідність б'є не по зручності, а по договору.
    const crit = key === "req" && current && current.critical.length
      ? current.critical.length : 0;
    return `
      <div class="kd-cell">
        <button type="button" class="kd-box${on}${empty}${crit ? " crit" : ""}" data-box="${key}"
                aria-label="${esc(TITLES_BOX[key])}: ${ids.length}${
                  crit ? ", з них критичних " + crit : ""}">
          <span class="kd-box-head">
            <span class="kd-box-title">${esc(TITLES_BOX[key])}</span>
            ${crit ? `<span class="kd-box-crit">${nf(crit)} ${
              plural(crit, "критична", "критичні", "критичних")}</span>` : ""}
            ${ids.length > SHOW_MAX ? "" : `<span class="kd-box-n">${nf(ids.length)}</span>`}
          </span>
          ${boxBody(key, ids)}
          <span class="kd-box-src">${esc(actLabel(key))}</span>
        </button>
        ${lostText ? `<div class="kd-lost">${esc(lostText)}</div>` : ""}
      </div>`;
  }

  /** Виноска про критичність. Показуємо лише коли в кадрі є критичні вимоги.
   *
   *  Формулювання звірене по самій постанові № 410, і там є несподіванка:
   *  зірочка у специфікації посилається на пункт 5 Порядку, а той КРИТЕРІЇВ
   *  поділу не містить — лише уповноважує НСЗУ визначати умови закупівлі.
   *  Тому пишемо «рівень встановлює НСЗУ в умовах закупівлі», а не
   *  «за пунктом 5 критичними вважаються…». Наслідки — пункти 16, 20 і 22,
   *  цитовані по чинній редакції від 08.05.2026. */
  function critNoteHTML(w) {
    if (!w.critical.length) return "";
    return `
      <div class="kd-note">
        <div class="kd-note-h">Чому «критична» — і що буде за невідповідність</div>
        <div class="kd-note-body">

        <p><b>Що це.</b> Рівень вимоги встановлює НСЗУ в умовах закупівлі; у
        специфікації такі вимоги позначені зірочкою. Зірочка веде на пункт 5
        Порядку (постанова КМУ від 25.04.2018 № 410), але сам пункт критеріїв
        поділу не містить — він лише уповноважує НСЗУ визначати умови щодо
        наявності персоналу. Критерії живуть в умовах закупівлі, не в постанові.</p>

        <p><b>Чому це не формальність.</b> Подаючи пропозицію (пункт 16) і
        підписуючи договір (пункт 22), заклад <b>власним підписом підтверджує</b>,
        що відповідає умовам закупівлі та спроможний надавати послуги згідно зі
        специфікацією. Тобто кадрова вимога — це твердження закладу про себе,
        а не побажання НСЗУ.</p>

        <p><b>Що буде за невідповідність</b> (пункт 20). НСЗУ протягом трьох
        робочих днів надсилає повідомлення про виправлення помилок. Усунути
        недоліки треба <b>до граничного строку подання пропозицій</b> з
        оголошення; якщо повідомлення надійшло вже після цієї дати — є два
        робочі дні на оновлену пропозицію. Подане пізніше <b>не розглядається</b>,
        тобто пропозиція просто випадає з відбору. Якщо пропозицій, які
        відповідають умовам, не буде взагалі, НСЗУ переглядає умови й оголошує
        повторно (пункт 21).</p>

        <p><b>Що треба зробити.</b> Мати названу посаду у штатному розписі — у
        кількості й за місцем роботи, як написано в самій умові («щонайменше
        N осіб», «за основним місцем роботи в цьому ЗОЗ»), і могти це
        підтвердити. Якщо посади ще немає, пункт 16 дозволяє в окремих випадках,
        <i>прямо визначених в оголошенні</i>, подати пропозицію із зобов'язанням
        виконати умову протягом визначеного строку. З 01.09.2026 вводити можна
        лише посади з Переліку МОЗ № 1065 — пункт 32 Ліцензійних умов.</p>

        </div>
        <p class="kd-note-src">Постанова КМУ від 25.04.2018 № 410, Порядок
        укладення, зміни та припинення договору — редакція від 08.05.2026.</p>
      </div>`;
  }

  function figureHTML(w) {
    const lost = (arr, one, few, many, tail) =>
      arr.length ? `${arr.length} ${plural(arr.length, one, few, many)} ${tail}` : "";
    const ar = '<div class="kd-ar" aria-hidden="true">→</div>';
    return `
      <div class="kd-grid">
        <div class="kd-top">
          ${boxHTML("req", w.req, lost(w.lost.req, "вимога", "вимоги", "вимог", "без посади"))}
          <div class="kd-ar down" aria-hidden="true">↓</div>
        </div>
        <div class="kd-row">
          ${boxHTML("spec", w.spec,
            lost(w.lost.spec, "посада", "посади", "посад", "без спеціальності"))}
          ${ar}
          ${boxHTML("post", w.post,
            lost(w.lost.post, "посада", "посади", "посад", "без характеристики"))}
          ${ar}
          ${boxHTML("dkhp", w.dkhp,
            lost(w.lost.dkhp, "характеристика", "характеристики", "характеристик", "без коду"))}
          ${ar}
          ${boxHTML("code", w.code, "")}
        </div>
      </div>`;
  }

  // ── розкривні секції під схемою ─────────────────────────────────────────
  //
  // По секції на кожне вікно, і кожна відкривається окремо: так видно, скажімо,
  // усі вимоги на «Ендоскопію» і поруч — саму характеристику. Спільна панель
  // цього не давала: вона показувала щось одне.

  const TITLES = {
    req: "Кадрові вимоги пакетів",
    spec: "Спеціальності, за якими видається ліцензія",
    post: "Посади, які треба ввести у штатний розпис",
    dkhp: "Кваліфікаційні характеристики",
    code: "Коди посад НСЗУ",
  };
  const ORDER = ["req", "spec", "post", "dkhp", "code"];

  function renderSections() {
    const w = current, d = $("#kdDetail");
    d.hidden = false;
    d.innerHTML = ORDER.map((key) => sectionHTML(key, w)).join("");
    d.querySelectorAll("[data-goto]").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); goTo(b.dataset.goto); }));
    // Запам'ятовуємо, що було розкрито, щоб перемальовування не згортало все.
    d.querySelectorAll("details").forEach((el) =>
      el.addEventListener("toggle", () => {
        if (el.open) openSet.add(el.dataset.key); else openSet.delete(el.dataset.key);
      }));
  }

  function sectionHTML(key, w) {
    const ids = w[key] || [];
    const t = G.node_types[SRC_KEY[key]] || {};
    const lostSet = new Set(
      key === "req" ? w.lost.req : key === "post" ? w.lost.post :
      key === "dkhp" ? w.lost.dkhp : []);
    const open = openSet.has(key) ? " open" : "";
    return `
      <details class="kd-sec" data-key="${key}"${open}>
        <summary>
          <span class="kd-sec-t">${esc(TITLES[key])}</span>
          <span class="kd-sec-n">${nf(ids.length)}</span>
          <span class="kd-sec-act">${esc(t.act_title || t.source || "")}${
            t.status ? " · " + esc(t.status) : ""}</span>
        </summary>
        ${ids.length
          ? `<ul class="kd-list">${ids.map((id) => rowHTML(key, id, lostSet)).join("")}</ul>`
          : `<p class="kd-empty">${esc(emptyWhy(key))}.</p>`}
      </details>`;
  }

  /** Рядок секції. Для кожного типу показуємо те, заради чого його й відкривають:
   *  у вимоги — пакет, дослівний текст і умову, у посади — кваліфікацію, у
   *  характеристики — місце в Довіднику, у коду — сам код. */
  function rowHTML(key, id, lostSet) {
    const n = N.get(id) || {};
    const gone = lostSet.has(id);
    const here = anchor.kind === "node" && anchor.id === id;
    let body = "";

    if (key === "req") {
      body = `
        <span class="kd-r-head">
          <span class="kd-pkg">Пакет № ${esc(n.package)}</span>
          <span class="kd-pkgname">${esc(G.packages[n.package] || "")}</span>
          ${n.critical ? '<span class="kd-flag">критична</span>' : ""}
          ${n.tone && n.tone !== "ok"
            ? `<span class="kd-flag warn">${esc(toneWord(n.tone))}</span>` : ""}
        </span>
        <span class="kd-r-raw">${esc(n.raw || n.name)}</span>
        ${n.tone_why
          ? `<span class="kd-r-why">${esc(n.tone_why)}</span>`
          : n.tone && n.tone !== "ok" && G.tones && G.tones[n.tone]
            ? `<span class="kd-r-why">${esc(G.tones[n.tone])}</span>`
            : ""}
        ${n.orphans && n.orphans.length
          ? `<span class="kd-r-orphan">Поза Переліком МОЗ: ${esc(n.orphans.join(", "))}</span>`
          : ""}`;
    } else {
      const sub = key === "spec"
          ? [secLabel(n.sec), (n.kinds || []).join(", ")].filter(Boolean).join(" · ")
        : key === "post"
          ? [partLabel(n.part), n.no ? "позиція № " + n.no : "", n.qual].filter(Boolean).join(" · ")
        : key === "dkhp"
          ? [n.sub || n.section, n.page ? "с. " + n.page + " Довідника" : ""].filter(Boolean).join(" · ")
        : n.kind === "status" ? "юридичний статус, не посада"
        : n.kind === "admin" ? "загальноадміністративна посада" : "";
      body = `
        <span class="kd-r-head">
          ${key === "code" ? `<span class="kd-code">${esc(id.split(":")[1])}</span>` : ""}
          <span class="kd-r-name">${esc(n.name || id)}</span>
          ${gone ? `<span class="kd-flag">${esc(lostWhy(key))}</span>` : ""}
        </span>
        ${sub ? `<span class="kd-r-sub">${esc(trim(sub, 220))}</span>` : ""}`;
    }

    return `<li>
      <button type="button" class="kd-item${gone ? " gone" : ""}${here ? " here" : ""}"
              data-goto="${esc(id)}" ${here ? 'aria-current="true"' : ""}>${body}</button>
    </li>`;
  }

  function partLabel(k) { return ((G.labels || {}).part || {})[k] || k || ""; }

  function lostWhy(key) {
    return key === "req" ? "не зіставлено з Переліком"
      : key === "post" ? "немає характеристики в ДКХП"
      : "немає коду НСЗУ";
  }
  function toneWord(t) {
    return t === "risk" ? "не зіставлено" : "звужений вибір";
  }
  function ua(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || "");
  }
  function trim(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
