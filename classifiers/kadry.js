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
  let current = null, opened = null, anchor = null;

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
      .catch(() => {
        $("#kdFigure").innerHTML =
          '<p class="kd-error">Не вдалося завантажити граф кадрових сутностей.</p>';
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

  function setAnchor(a) { anchor = a; opened = null; draw(); }

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

    if (a.kind === "pkg") {
      G.nodes.forEach((n) => { if (n.type === "pkgreq" && n.package === a.id) reqs.add(n.id); });
      reqs.forEach((r) => out(r, "req_post").forEach((e) => S.post.add(e.to)));
      start = LAYERS.indexOf("post");
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
    if (a.kind !== "pkg") {
      S.post.forEach((p) => inc(p, "req_post").forEach((e) => reqs.add(e.from)));
    }

    const noNext = (ids, rel) => [...ids].filter((id) => !out(id, rel).length);
    const reqArr = [...reqs].sort(byReqId);
    return {
      anchorKey: a.kind === "pkg" ? "req" : N.get(a.id).type,
      req: reqArr, post: [...S.post], dkhp: [...S.dkhp], code: [...S.code], spec: [...S.spec],
      lost: {
        req: noNext(reqArr, "req_post"),
        post: noNext(S.post, "post_dkhp"),
        dkhp: noNext(S.dkhp, "dkhp_code"),
        spec: [...S.post].filter((p) => !inc(p, "spec_post").length),
      },
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
  const BOX = { w: 176, h: 74 };
  const COL = [20, 214, 408, 602, 796];   // п'ять колонок
  const ROW = 132;                        // верх основного ряду

  function draw() {
    if (!anchor || !anchor.id) {
      $("#kdFigure").innerHTML = ""; $("#kdSummary").innerHTML = "";
      $("#kdDetail").hidden = true; return;
    }
    current = walkFrom(anchor);
    renderSummary(current);
    $("#kdFigure").innerHTML = svg(current);
    $("#kdFigure").querySelectorAll("[data-box]").forEach((g) =>
      g.addEventListener("click", () => openBox(g.dataset.box)));
    if (opened) openBox(opened); else $("#kdDetail").hidden = true;
  }

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

  function box(key, x, y, title, count, note, lost) {
    const src = actLabel(key);
    // Якір — те, що ввели: рамка товща, щоб було видно, звідки розповзався обхід.
    const on = current && current.anchorKey === key ? " on" : "";
    return `
      <g data-box="${key}" class="kd-box${on}" tabindex="0" role="button"
         aria-label="${esc(title)}: ${count}${on ? ", звідси починається обхід" : ""}">
        <rect x="${x}" y="${y}" width="${BOX.w}" height="${BOX.h}" rx="5"/>
        <text x="${x + BOX.w / 2}" y="${y + 24}" text-anchor="middle"
              class="kd-t">${esc(title)}</text>
        <text x="${x + BOX.w / 2}" y="${y + 48}" text-anchor="middle"
              class="kd-n">${nf(count)}</text>
        <text x="${x + BOX.w / 2}" y="${y + 65}" text-anchor="middle"
              class="kd-src">${esc(trim(src, 30))}</text>
      </g>
      ${note ? `<text x="${x + BOX.w / 2}" y="${y + BOX.h + 20}" text-anchor="middle"
          class="kd-note">${esc(note)}</text>` : ""}
      ${lost ? `<text x="${x + BOX.w / 2}" y="${y + BOX.h + 20}" text-anchor="middle"
          class="kd-lost">${esc(lost)}</text>` : ""}`;
  }

  function arrow(x1, y1, x2, y2, label, up) {
    const mx = (x1 + x2) / 2;
    return `
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="kd-arrow"
            marker-end="url(#kd-ar)"/>
      ${label ? `<text x="${mx}" y="${up ? y1 - 8 : y1 - 9}" text-anchor="middle"
          class="kd-al">${esc(label)}</text>` : ""}`;
  }

  function svg(w) {
    const y = ROW;
    const cy = y + BOX.h / 2;
    // Відмінок числівника тут не декоративний: «1 посад без характеристики»
    // видно з першого погляду.
    const lost = (arr, one, few, many, tail) =>
      arr.length ? `${arr.length} ${plural(arr.length, one, few, many)} ${tail}` : "";

    return `
    <svg viewBox="0 0 990 340" role="img" class="kd-svg"
         aria-label="Ланцюжок пакета ${esc(w.pkg)}: ${w.req.length} кадрових вимог,
         ${w.post.length} посад, ${w.dkhp.length} характеристик, ${w.code.length} кодів НСЗУ">
      <defs>
        <marker id="kd-ar" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/>
        </marker>
      </defs>

      ${box("req", COL[0], y, "Кадрові вимоги", w.req.length, "",
            lost(w.lost.req, "вимога", "вимоги", "вимог", "без посади"))}
      ${box("post", COL[1], y, "Посади", w.post.length, "",
            lost(w.lost.post, "посада", "посади", "посад", "без характеристики"))}
      ${box("dkhp", COL[2], y, "Характеристики", w.dkhp.length, "",
            lost(w.lost.dkhp, "характеристика", "характеристики", "характеристик", "без коду"))}
      ${box("code", COL[3], y, "Коди НСЗУ", w.code.length, "", "")}

      ${arrow(COL[0] + BOX.w, cy, COL[1] - 6, cy,
              `${w.req.length - w.lost.req.length} з ${w.req.length}`)}
      ${arrow(COL[1] + BOX.w, cy, COL[2] - 6, cy,
              `${w.post.length - w.lost.post.length} з ${w.post.length}`)}
      ${arrow(COL[2] + BOX.w, cy, COL[3] - 6, cy,
              `${w.dkhp.length - w.lost.dkhp.length} з ${w.dkhp.length}`)}

      <!-- ліцензійна гілка: спеціальність дає право обіймати посаду -->
      ${box("spec", COL[1], y + 148, "Спеціальності", w.spec.length, "",
            lost(w.lost.spec, "посада", "посади", "посад", "без спеціальності"))}
      <line x1="${COL[1] + BOX.w / 2}" y1="${y + 148}" x2="${COL[1] + BOX.w / 2}"
            y2="${y + BOX.h + 34}" class="kd-arrow" marker-end="url(#kd-ar)"/>
      <text x="${COL[1] + BOX.w / 2 + 10}" y="${y + BOX.h + 62}" class="kd-al">
        за якою спеціальністю ліцензія</text>
    </svg>`;
  }

  // ── деталі під схемою ───────────────────────────────────────────────────
  const TITLES = {
    req: "Кадрові вимоги пакета",
    post: "Посади, які треба ввести у штатний розпис",
    dkhp: "Кваліфікаційні характеристики",
    code: "Коди посад НСЗУ",
    spec: "Спеціальності, за якими видається ліцензія",
  };

  function openBox(key) {
    opened = key;
    const w = current;
    const ids = w[key] || [];
    const d = $("#kdDetail");
    d.hidden = false;
    const lostSet = new Set(
      key === "req" ? w.lost.req : key === "post" ? w.lost.post :
      key === "dkhp" ? w.lost.dkhp : []);
    const t = G.node_types[SRC_KEY[key]] || {};

    const rows = ids.map((id) => {
      const n = N.get(id) || {};
      const gone = lostSet.has(id);
      return `<li class="${gone ? "kd-item gone" : "kd-item"}">
        <span class="kd-item-n">${esc(trim(n.name || id, 150))}</span>
        ${gone ? `<span class="kd-flag">${esc(lostWhy(key))}</span>` : ""}
        ${key === "req" && n.tone && n.tone !== "ok"
          ? `<span class="kd-flag warn">${esc(toneWord(n.tone))}</span>` : ""}
        ${key === "code" ? `<span class="kd-code">${esc(id.split(":")[1])}</span>` : ""}
      </li>`;
    }).join("");

    d.innerHTML = `
      <h2>${esc(TITLES[key])} <span class="kd-cnt">${nf(ids.length)}</span></h2>
      <p class="kd-act">${esc(t.act_title || t.source || "")}${
        t.status ? ` · <b>${esc(t.status)}</b>` : ""}${
        t.valid_from ? ` з ${esc(ua(t.valid_from))}` : ""}</p>
      ${ids.length ? `<ul class="kd-list">${rows}</ul>`
        : '<p class="kd-empty">Порожньо — ланцюжок обірвався раніше.</p>'}`;
    d.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

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
