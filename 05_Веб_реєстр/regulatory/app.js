/* ============================================================
   Нормативно-правова база — сервіс v2
   Логіка: Пошуковий хаб → Робоче місце документа
   Дані: data/regulatory_documents.json (реєстр)
         data/search_index.json (фрагменти повних текстів)
   ============================================================ */

const state = {
  docs: [],            // реєстр документів
  chunksByNumber: {},  // фрагменти, згруповані за document_number
  visible: [],         // результат фільтрації хабу
  hits: {},            // doc.id -> к-ть фрагментів, що містять запит
  selected: null,      // відкритий документ
  docChunks: [],       // фрагменти відкритого документа (в порядку файла)
  tree: null,          // дерево структури відкритого документа
  activePath: "",      // обраний вузол дерева (префікс шляху)
  inQuery: "",         // пошук всередині документа
  fnFilter: "",        // фільтр за юридичною функцією
  keyMoments: false,   // режим «Ключові вимоги»
  matchEls: [],        // позиції збігів (елементи <mark>)
  matchIdx: -1,
  passportCollapsed: false
};

const el = (id) => document.getElementById(id);

const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

/* ---------------- Довідники відображення ---------------- */

function typePillClass(type) {
  const t = (type || "").toLowerCase();
  if (t === "закон") return "t-zakon";
  if (t.includes("постанова")) return "t-postanova";
  if (t.includes("наказ моз")) return "t-nakaz-moz";
  if (t.includes("наказ нсзу")) return "t-nakaz-nszu";
  return "t-other";
}

function statusPill(status) {
  const s = (status || "").toLowerCase();
  if (s === "чинний") return `<span class="pill s-active">✓ чинний</span>`;
  if (s === "проєкт") return `<span class="pill s-draft">проєкт</span>`;
  if (s.includes("втрат")) return `<span class="pill s-expired">втратив чинність</span>`;
  return `<span class="pill t-other">${escapeHtml(status || "—")}</span>`;
}

function fnBadgeClass(fn) {
  const f = (fn || "").toLowerCase();
  if (f.includes("обов")) return "obligation";
  if (f.includes("заборон")) return "prohibition";
  if (f.includes("право")) return "right";
  if (f.includes("процедур")) return "procedure";
  if (f.includes("визначен")) return "definition";
  if (f.includes("затвердж")) return "approval";
  return "";
}

function fmtDate(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function docChunks(doc) {
  return state.chunksByNumber[doc.document_number] || [];
}

/* ============================================================
   VIEW 1 — ПОШУКОВИЙ ХАБ
   ============================================================ */

function hubFilters() {
  return {
    query: el("hubSearch").value.trim().toLowerCase(),
    type: el("f-type").value,
    status: el("f-status").value,
    category: el("f-category").value,
    year: el("f-year").value,
    number: el("f-number").value.trim().toLowerCase(),
    text: el("f-text").value,
    sort: el("f-sort").value
  };
}

function applyHubFilters() {
  const f = hubFilters();
  state.hits = {};

  let list = state.docs.filter((doc) => {
    if (f.type && doc.document_type !== f.type) return false;
    if (f.status && doc.status !== f.status) return false;
    if (f.category && doc.category !== f.category) return false;
    if (f.year && !(doc.adoption_date || "").startsWith(f.year)) return false;
    if (f.number && !(doc.document_number || "").toLowerCase().includes(f.number)) return false;
    const hasText = docChunks(doc).length > 0;
    if (f.text === "yes" && !hasText) return false;
    if (f.text === "no" && hasText) return false;

    if (f.query) {
      const meta = [
        doc.title, doc.document_number, doc.document_type,
        doc.category, doc.content, doc.adoption_date, fmtDate(doc.adoption_date)
      ].join(" ").toLowerCase();
      const metaHit = f.query.split(/\s+/).every((w) => meta.includes(w));

      // Глибокий пошук: рахуємо фрагменти повного тексту, що містять усі слова
      let deepHits = 0;
      if (f.query.length >= 3) {
        const words = f.query.split(/\s+/).filter((w) => w.length >= 2);
        if (words.length) {
          for (const ch of docChunks(doc)) {
            const txt = (ch.text_original || "").toLowerCase();
            if (words.every((w) => txt.includes(w))) deepHits++;
          }
        }
      }
      if (deepHits > 0) state.hits[doc.id] = deepHits;
      if (!metaHit && deepHits === 0) return false;
    }
    return true;
  });

  // Сортування
  const q = f.query;
  list.sort((a, b) => {
    if (f.sort === "title") return (a.title || "").localeCompare(b.title || "", "uk");
    if (f.sort === "date-asc") return (a.adoption_date || "").localeCompare(b.adoption_date || "");
    if (f.sort === "relevance" && q) {
      const score = (d) => {
        let s = 0;
        if ((d.title || "").toLowerCase().includes(q)) s += 100;
        if ((d.document_number || "").toLowerCase().includes(q)) s += 80;
        s += (state.hits[d.id] || 0);
        return s;
      };
      return score(b) - score(a);
    }
    return (b.adoption_date || "").localeCompare(a.adoption_date || ""); // date-desc
  });

  state.visible = list;
  renderHub();
}

function renderHub() {
  const f = hubFilters();
  const grid = el("docGrid");
  const total = state.visible.length;

  el("hubSearchWrap").classList.toggle("has-query", !!f.query);
  el("resultLine").innerHTML = total
    ? `Знайдено: <strong>${total}</strong> ${pluralDocs(total)}${f.query ? ` за запитом «<strong>${escapeHtml(f.query)}</strong>»` : ""}`
    : "За цими умовами документів немає";
  el("hubEmpty").style.display = total ? "none" : "block";

  grid.innerHTML = state.visible.map((doc) => {
    const hits = state.hits[doc.id] || 0;
    const hasText = docChunks(doc).length > 0;
    const snippet = doc.content || "";
    return `
      <button class="doc-tile" type="button" data-id="${doc.id}">
        <span class="tile-tags">
          <span class="pill ${typePillClass(doc.document_type)}">${escapeHtml(doc.document_type || "Акт")}</span>
          ${statusPill(doc.status)}
          ${hasText ? `<span class="pill has-text">📖 повний текст</span>` : ""}
        </span>
        <span class="tile-title">${highlight(doc.title, f.query)}</span>
        <span class="tile-req">№ ${escapeHtml(doc.document_number || "б/н")} · від ${fmtDate(doc.adoption_date)} · ${escapeHtml(doc.category || "—")}</span>
        ${snippet ? `<span class="tile-snippet">${highlight(snippet, f.query)}</span>` : ""}
        ${hits ? `<span class="tile-hits">Запит знайдено у ${hits} ${pluralFragments(hits)} тексту</span>` : ""}
        <span class="tile-foot">
          <span>${hasText ? `${docChunks(doc).length} фрагментів` : "лише картка документа"}</span>
          <span class="tile-open">Відкрити →</span>
        </span>
      </button>`;
  }).join("");

  grid.querySelectorAll(".doc-tile").forEach((tile) => {
    tile.addEventListener("click", () => openDoc(tile.dataset.id, hubFilters().query));
  });
}

function pluralDocs(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "документ";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "документи";
  return "документів";
}
function pluralFragments(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "фрагменті";
  return "фрагментах";
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return escapeHtml(text);
  let html = escapeHtml(text);
  for (const w of words) {
    const esc = w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    try { html = html.replace(new RegExp(`(${esc})`, "gi"), "<mark>$1</mark>"); } catch (e) { /* ignore */ }
  }
  return html;
}

/* ============================================================
   VIEW 2 — РОБОЧЕ МІСЦЕ ДОКУМЕНТА
   ============================================================ */

function openDoc(id, presetQuery = "") {
  const doc = state.docs.find((d) => d.id === id);
  if (!doc) return;
  state.selected = doc;
  state.docChunks = docChunks(doc);
  state.activePath = "";
  state.fnFilter = "";
  state.keyMoments = false;
  state.inQuery = presetQuery && state.hits[doc.id] ? presetQuery : "";
  state.passportCollapsed = false;

  location.hash = `doc=${encodeURIComponent(id)}`;

  el("view-hub").classList.remove("visible");
  el("view-doc").classList.add("visible");
  window.scrollTo(0, 0);

  el("wsTitle").textContent = doc.title;
  el("inSearch").value = state.inQuery;
  el("keyMomentsBtn").classList.remove("on");
  renderPassport(doc);
  buildFnFilter();
  buildTree();
  renderChunks();
}

function closeDoc() {
  state.selected = null;
  history.replaceState(null, "", location.pathname + location.search);
  el("view-doc").classList.remove("visible");
  el("view-hub").classList.add("visible");
  window.scrollTo(0, 0);
}

/* ---------------- Паспорт документа ---------------- */

function renderPassport(doc) {
  const chunks = state.docChunks;
  const fnStats = {};
  for (const ch of chunks) {
    const fn = ch.legal_function || "Інше";
    if (fn !== "Інше" && fn !== "None") fnStats[fn] = (fnStats[fn] || 0) + 1;
  }
  const fnLine = Object.entries(fnStats)
    .sort((a, b) => b[1] - a[1])
    .map(([fn, n]) => `<span class="fn-badge ${fnBadgeClass(fn)}">${escapeHtml(fn)}: ${n}</span>`)
    .join(" ");

  const topics = [...new Set(chunks.flatMap((c) => c.topics || []))].slice(0, 6);
  const authority = chunks[0]?.authority || authorityByType(doc.document_type);

  el("wsPassport").innerHTML = `
    <div class="ws-passport-head">
      <div class="ws-passport-tags">
        <span class="pill ${typePillClass(doc.document_type)}">${escapeHtml(doc.document_type || "Акт")}</span>
        ${statusPill(doc.status)}
        <span class="pill t-other">№ ${escapeHtml(doc.document_number || "б/н")}</span>
        <span class="pill t-other">від ${fmtDate(doc.adoption_date)}</span>
      </div>
      <div class="ws-passport-actions">
        ${doc.document_url ? `<a class="btn-link primary" href="${escapeHtml(doc.document_url)}" target="_blank" rel="noopener">⚖️ Перевірити чинність на rada.gov.ua</a>` : ""}
        ${doc.file_url ? `<a class="btn-link" href="${escapeHtml(doc.file_url)}" target="_blank" rel="noopener">📄 Локальна копія</a>` : ""}
        <button class="btn-link" id="copyReqBtn" type="button" title="Скопіювати реквізити документа">📋 Реквізити</button>
      </div>
    </div>
    <div class="passport-details" id="passportDetails">
      <div class="ws-passport-grid">
        <div class="pp-item"><div class="pp-label">Орган, що видав</div><div class="pp-value">${escapeHtml(authority)}</div></div>
        <div class="pp-item"><div class="pp-label">Напрям / тема</div><div class="pp-value">${escapeHtml(doc.category || "—")}</div></div>
        <div class="pp-item"><div class="pp-label">Дата прийняття</div><div class="pp-value">${fmtDate(doc.adoption_date)}</div></div>
        <div class="pp-item"><div class="pp-label">Статус</div><div class="pp-value">${escapeHtml(doc.status || "—")}</div></div>
        <div class="pp-item"><div class="pp-label">Обсяг тексту</div><div class="pp-value">${chunks.length ? chunks.length + " фрагментів" : "повний текст недоступний"}</div></div>
        <div class="pp-item"><div class="pp-label">Оновлено в базі</div><div class="pp-value">${fmtDate(doc.updated_at)} ${doc.updated_by_name ? "· " + escapeHtml(doc.updated_by_name) : ""}</div></div>
      </div>
      ${doc.content ? `<p class="ws-passport-desc">${escapeHtml(doc.content)}</p>` : ""}
      ${fnLine ? `<div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;"><span style="font-size:11px; font-weight:800; text-transform:uppercase; color:var(--muted);">Юридичні акценти:</span> ${fnLine}</div>` : ""}
      ${topics.length ? `<div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;"><span style="font-size:11px; font-weight:800; text-transform:uppercase; color:var(--muted);">Теми:</span> ${topics.map((t) => `<span class="pill t-other" style="text-transform:none;">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    </div>
    <button class="ws-passport-toggle" id="passportToggle" type="button">▲ Згорнути довідку</button>
  `;

  el("copyReqBtn").addEventListener("click", () => {
    const req = `${doc.document_type} № ${doc.document_number} від ${fmtDate(doc.adoption_date)} «${doc.title}» (${doc.status})${doc.document_url ? "\n" + doc.document_url : ""}`;
    copyToClipboard(req, "Реквізити скопійовано");
  });
  el("passportToggle").addEventListener("click", () => {
    state.passportCollapsed = !state.passportCollapsed;
    el("passportDetails").style.display = state.passportCollapsed ? "none" : "";
    el("passportToggle").textContent = state.passportCollapsed ? "▼ Розгорнути довідку" : "▲ Згорнути довідку";
  });
}

function authorityByType(type) {
  const t = (type || "").toLowerCase();
  if (t === "закон") return "Верховна Рада України";
  if (t.includes("постанова")) return "Кабінет Міністрів України";
  if (t.includes("моз")) return "МОЗ України";
  if (t.includes("нсзу")) return "НСЗУ";
  return "—";
}

/* ---------------- Дерево структури ---------------- */

function buildTree() {
  const root = { label: "", children: new Map(), count: 0, path: "" };
  for (const ch of state.docChunks) {
    const segs = (ch.path || "Документ").split(" / ");
    let node = root;
    let acc = [];
    root.count++;
    for (const seg of segs) {
      acc.push(seg);
      if (!node.children.has(seg)) {
        node.children.set(seg, { label: seg, children: new Map(), count: 0, path: acc.join(" / ") });
      }
      node = node.children.get(seg);
      node.count++;
    }
  }
  state.tree = root;
  renderTree();
}

function renderTree() {
  const tree = el("wsTree");
  if (!state.docChunks.length) {
    tree.innerHTML = `<div class="ws-tree-head">Структура</div>
      <p style="font-size:12.5px; color:var(--muted); padding:6px 8px; line-height:1.5;">
      Повний текст цього документа ще не завантажено до бази. Доступна лише картка документа.</p>`;
    return;
  }
  let html = `<div class="ws-tree-head">
      <span>Структура документа</span>
      <button class="crumb-reset" id="treeAll" type="button" style="font-size:11px;">Увесь текст</button>
    </div>`;
  html += renderTreeNodes(state.tree, 0);
  tree.innerHTML = html;

  tree.querySelector("#treeAll")?.addEventListener("click", () => setActivePath(""));
  tree.querySelectorAll(".tree-caret:not(.leaf)").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      btn.classList.toggle("open");
      btn.closest(".tree-node").querySelector(":scope > .tree-children")?.classList.toggle("open");
    });
  });
  tree.querySelectorAll(".tree-label").forEach((btn) => {
    btn.addEventListener("click", () => setActivePath(btn.dataset.path));
  });
  markActiveTreeRow();
}

function renderTreeNodes(node, depth) {
  let html = "";
  for (const child of node.children.values()) {
    const hasKids = child.children.size > 0;
    const isTop = depth === 0;
    html += `<div class="tree-node">
      <div class="tree-row" data-path="${escapeHtml(child.path)}">
        <button class="tree-caret ${hasKids ? (isTop ? "open" : "") : "leaf"}" type="button" aria-label="Розгорнути">▶</button>
        <button class="tree-label" type="button" data-path="${escapeHtml(child.path)}" title="${escapeHtml(child.path)}">${escapeHtml(child.label)}</button>
        <span class="tree-count">${child.count}</span>
      </div>
      ${hasKids ? `<div class="tree-children ${isTop ? "open" : ""}">${renderTreeNodes(child, depth + 1)}</div>` : ""}
    </div>`;
  }
  return html;
}

function setActivePath(path) {
  state.activePath = path;
  markActiveTreeRow();
  renderChunks();
}

function markActiveTreeRow() {
  document.querySelectorAll("#wsTree .tree-row").forEach((row) => {
    row.classList.toggle("active", row.dataset.path === state.activePath && state.activePath !== "");
  });
  const crumb = el("wsCrumb");
  if (state.activePath) {
    crumb.style.display = "";
    el("crumbPath").textContent = "📍 " + state.activePath;
  } else {
    crumb.style.display = "none";
  }
}

/* ---------------- Фільтр юридичних функцій ---------------- */

function buildFnFilter() {
  const sel = el("fnFilter");
  const fns = [...new Set(state.docChunks.map((c) => c.legal_function).filter((f) => f && f !== "None" && f !== "Інше"))];
  sel.innerHTML = `<option value="">Усі типи норм</option>` +
    fns.sort((a, b) => a.localeCompare(b, "uk")).map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
  sel.value = "";
}

/* ---------------- Рендер фрагментів ---------------- */

function visibleChunks() {
  const q = state.inQuery.trim().toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length >= 2);
  return state.docChunks.filter((ch) => {
    if (state.activePath) {
      const p = ch.path || "";
      if (p !== state.activePath && !p.startsWith(state.activePath + " / ")) return false;
    }
    if (state.fnFilter && (ch.legal_function || "") !== state.fnFilter) return false;
    if (state.keyMoments) {
      const f = (ch.legal_function || "").toLowerCase();
      if (!f.includes("обов") && !f.includes("заборон")) return false;
    }
    if (words.length) {
      const txt = ((ch.text_original || "") + " " + (ch.path || "")).toLowerCase();
      if (!words.every((w) => txt.includes(w))) return false;
    }
    return true;
  });
}

function renderChunks() {
  const wrap = el("wsChunks");
  const doc = state.selected;
  if (!doc) return;

  if (!state.docChunks.length) {
    wrap.innerHTML = `<div class="ws-notext">
      <div class="ico">📄</div>
      <h3>Повний текст недоступний у базі</h3>
      <p>Скористайтесь офіційним джерелом${doc.document_url ? `: <a href="${escapeHtml(doc.document_url)}" target="_blank" rel="noopener">відкрити на zakon.rada.gov.ua →</a>` : "."}</p>
      ${doc.file_url ? `<p><a href="${escapeHtml(doc.file_url)}" target="_blank" rel="noopener">Або відкрийте локальну копію →</a></p>` : ""}
    </div>`;
    updateMatchNav([]);
    return;
  }

  const list = visibleChunks();
  const q = state.inQuery.trim();

  if (!list.length) {
    wrap.innerHTML = `<div class="ws-notext">
      <div class="ico">🔍</div>
      <h3>Збігів не знайдено</h3>
      <p>Змініть запит, тип норми або оберіть інший розділ структури.</p>
    </div>`;
    updateMatchNav([]);
    return;
  }

  wrap.innerHTML = list.map((ch, i) => {
    const fn = ch.legal_function || "";
    const showFn = fn && fn !== "None" && fn !== "Інше";
    const fnCls = fnBadgeClass(fn);
    return `
    <article class="chunk ${fnCls ? "f-" + fnCls : ""}" data-idx="${i}" id="chunk-${i}">
      <div class="chunk-head">
        <button class="chunk-path" type="button" data-path="${escapeHtml(ch.path || "")}" title="Перейти до цього розділу в структурі">${escapeHtml(ch.path || "Документ")}</button>
        ${showFn ? `<span class="fn-badge ${fnCls}">${escapeHtml(fn)}</span>` : ""}
      </div>
      <div class="chunk-text">${highlight(ch.text_original || "", q)}</div>
      <div class="chunk-tools">
        <button type="button" class="copy-text" title="Скопіювати текст фрагмента">📋 Текст</button>
        <button type="button" class="copy-cite" title="Скопіювати з реквізитами для офіційної відповіді">🔖 З посиланням</button>
      </div>
    </article>`;
  }).join("");

  // обробники
  wrap.querySelectorAll(".chunk").forEach((node) => {
    const ch = list[Number(node.dataset.idx)];
    node.querySelector(".copy-text").addEventListener("click", () => {
      copyToClipboard(ch.text_original || "", "Текст фрагмента скопійовано");
    });
    node.querySelector(".copy-cite").addEventListener("click", () => {
      const doc = state.selected;
      const cite = `${ch.text_original || ""}\n\n— ${doc.document_type} № ${doc.document_number} від ${fmtDate(doc.adoption_date)} «${doc.title}», ${ch.path || ""}${doc.document_url ? "\n" + doc.document_url : ""}`;
      copyToClipboard(cite, "Фрагмент з реквізитами скопійовано");
    });
    node.querySelector(".chunk-path").addEventListener("click", (e) => {
      setActivePath(e.currentTarget.dataset.path);
    });
  });

  // навігація по збігах
  updateMatchNav([...wrap.querySelectorAll("mark")]);
}

/* ---------------- Навігація по збігах пошуку ---------------- */

function updateMatchNav(marks) {
  state.matchEls = marks;
  state.matchIdx = marks.length ? 0 : -1;
  const nav = el("inSearchNav");
  if (!state.inQuery.trim() || !marks.length) {
    nav.style.display = state.inQuery.trim() ? "" : "none";
    el("matchCount").textContent = state.inQuery.trim() ? "0" : "";
    return;
  }
  nav.style.display = "";
  highlightCurrentMatch(false);
}

function highlightCurrentMatch(scroll = true) {
  state.matchEls.forEach((m) => m.classList.remove("current"));
  if (state.matchIdx < 0 || !state.matchEls.length) return;
  const cur = state.matchEls[state.matchIdx];
  cur.classList.add("current");
  el("matchCount").textContent = `${state.matchIdx + 1} / ${state.matchEls.length}`;
  if (scroll) cur.scrollIntoView({ block: "center", behavior: "smooth" });
}

function gotoMatch(delta) {
  if (!state.matchEls.length) return;
  state.matchIdx = (state.matchIdx + delta + state.matchEls.length) % state.matchEls.length;
  highlightCurrentMatch(true);
}

/* ---------------- Буфер обміну ---------------- */

let toastTimer;
function copyToClipboard(text, message) {
  const done = () => {
    const toast = el("copyToast");
    toast.textContent = message || "Скопійовано";
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0;";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
  done();
}

/* ============================================================
   ІНІЦІАЛІЗАЦІЯ
   ============================================================ */

function populateHubFilters(data) {
  const fill = (id, values) => {
    const sel = el(id);
    const first = sel.querySelector("option");
    sel.innerHTML = "";
    sel.appendChild(first);
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = v;
      sel.appendChild(opt);
    }
  };
  fill("f-type", data.types || [...new Set(state.docs.map((d) => d.document_type))].sort());
  fill("f-status", data.statuses || [...new Set(state.docs.map((d) => d.status))].sort());
  fill("f-category", (data.categories || [...new Set(state.docs.map((d) => d.category))]).sort((a, b) => a.localeCompare(b, "uk")));
  const years = data.years || [...new Set(state.docs.map((d) => (d.adoption_date || "").slice(0, 4)).filter(Boolean))];
  fill("f-year", [...years].sort((a, b) => b.localeCompare(a)));
}

function renderStats() {
  const total = state.docs.length;
  const active = state.docs.filter((d) => d.status === "чинний").length;
  const fragments = Object.values(state.chunksByNumber).reduce((s, arr) => s + arr.length, 0);
  const withText = state.docs.filter((d) => docChunks(d).length > 0).length;
  el("stats").innerHTML = `
    <div class="stat"><strong>${total}</strong><span>документів</span></div>
    <div class="stat"><strong>${active}</strong><span>чинних актів</span></div>
    <div class="stat"><strong>${withText}</strong><span>з повним текстом</span></div>
    <div class="stat"><strong>${fragments}</strong><span>фрагментів норм</span></div>`;
}

function bindEvents() {
  const rerun = debounce(applyHubFilters, 220);
  el("hubSearch").addEventListener("input", rerun);
  el("hubSearchClear").addEventListener("click", () => { el("hubSearch").value = ""; applyHubFilters(); el("hubSearch").focus(); });
  ["f-type", "f-status", "f-category", "f-year", "f-text", "f-sort"].forEach((id) => el(id).addEventListener("change", applyHubFilters));
  el("f-number").addEventListener("input", rerun);
  el("resetFilters").addEventListener("click", () => {
    el("hubSearch").value = "";
    ["f-type", "f-status", "f-category", "f-year", "f-text"].forEach((id) => { el(id).value = ""; });
    el("f-number").value = "";
    el("f-sort").value = "date-desc";
    applyHubFilters();
  });

  el("btnBack").addEventListener("click", closeDoc);

  const rerenderDoc = debounce(() => {
    state.inQuery = el("inSearch").value;
    renderChunks();
  }, 200);
  el("inSearch").addEventListener("input", rerenderDoc);
  el("inSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
  });
  el("matchPrev").addEventListener("click", () => gotoMatch(-1));
  el("matchNext").addEventListener("click", () => gotoMatch(1));

  el("fnFilter").addEventListener("change", (e) => { state.fnFilter = e.target.value; renderChunks(); });
  el("keyMomentsBtn").addEventListener("click", () => {
    state.keyMoments = !state.keyMoments;
    el("keyMomentsBtn").classList.toggle("on", state.keyMoments);
    renderChunks();
  });
  el("crumbReset").addEventListener("click", () => setActivePath(""));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selected) closeDoc();
    if (e.key === "/" && !state.selected && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      el("hubSearch").focus();
    }
  });
}

function openFromHash() {
  const m = location.hash.match(/doc=([^&]+)/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (state.docs.some((d) => d.id === id)) openDoc(id);
  }
}

/* Окремі файли документів: data/docs/<номер>.json
   ("/" та "\" у номері замінюються на "_").
   Файл — масив фрагментів або об'єкт { fragments: [...] }.
   Згенеровані ШІ файли мають пріоритет над search_index.json. */
function docFileName(number) {
  return String(number).replace(/[\/\\]/g, "_") + ".json";
}

function normalizeChunks(raw, doc) {
  const arr = Array.isArray(raw) ? raw : (raw?.fragments || raw?.chunks || []);
  return arr
    .filter((ch) => ch && (ch.text_original || ch.text))
    .map((ch, i) => ({
      document_id: ch.document_id || doc.id,
      chunk_id: ch.chunk_id || `${doc.document_number}_f${i + 1}`,
      document_type: ch.document_type || doc.document_type,
      document_number: doc.document_number,
      document_date: ch.document_date || doc.adoption_date,
      authority: ch.authority || authorityByType(doc.document_type),
      path: ch.path || "Документ",
      text_original: ch.text_original || ch.text,
      topics: Array.isArray(ch.topics) ? ch.topics : [],
      keywords: Array.isArray(ch.keywords) ? ch.keywords : [],
      legal_function: ch.legal_function || "Інше",
      related_documents: Array.isArray(ch.related_documents) ? ch.related_documents : [],
      citation: ch.citation || `${(doc.document_type || "").toLowerCase()} № ${doc.document_number}`,
      can_be_used_in_official_answer: ch.can_be_used_in_official_answer !== false
    }));
}

async function loadPerDocFiles() {
  const jobs = state.docs
    .filter((doc) => doc.document_number)
    .map(async (doc) => {
      try {
        const resp = await fetch("data/docs/" + encodeURIComponent(docFileName(doc.document_number)) + "?v=" + Date.now());
        if (!resp.ok) return;
        let text = await resp.text();
        // прибираємо можливі ```json-огорожі та BOM від ШІ-генерації
        text = text.replace(/^﻿/, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const chunks = normalizeChunks(JSON.parse(text), doc);
        if (chunks.length) {
          state.chunksByNumber[doc.document_number] = chunks;
          console.log(`Документ № ${doc.document_number}: завантажено ${chunks.length} фрагментів з data/docs/`);
        }
      } catch (err) {
        console.warn(`data/docs/${docFileName(doc.document_number)}: файл не завантажено`, err.message);
      }
    });
  await Promise.allSettled(jobs);
}

async function init() {
  bindEvents();
  try {
    const regResp = await fetch("data/regulatory_documents.json?v=" + Date.now());
    const data = await regResp.json();
    state.docs = data.documents || [];

    // індекс фрагментів — великий файл, тягнемо після реєстру
    try {
      const idxResp = await fetch("data/search_index.json");
      if (idxResp.ok) {
        const chunks = await idxResp.json();
        for (const ch of chunks) {
          const key = ch.document_number;
          if (!key) continue;
          (state.chunksByNumber[key] = state.chunksByNumber[key] || []).push(ch);
        }
      }
    } catch (err) {
      console.error("Не вдалося завантажити search_index.json:", err);
    }

    // окремі файли документів мають пріоритет
    await loadPerDocFiles();

    populateHubFilters(data);
    renderStats();
    applyHubFilters();
    openFromHash();
  } catch (err) {
    console.error("Помилка завантаження бази:", err);
    el("resultLine").textContent = "Не вдалося завантажити дані бази.";
  }
}

document.addEventListener("DOMContentLoaded", init);
