/* Питання ЗОЗ — шпаргалка ранкових зустрічей.
   Дані: Supabase, таблиця meeting_questions (RLS: авторизовані, крім гостей;
   сід генерує build_questions_data.py -> _seeds_local). Після першого
   завантаження корпус кешується в localStorage: повторні відкриття миттєві,
   свіжі дані підтягуються тихо у фоні. Пошук і аналітика повністю на клієнті. */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const CACHE_KEY = 'mq_shpargalka_v1';

const THEMES = {
  coding: "Кодування",
  tariffs: "Тарифи й оплата",
  package: "Умови пакетів",
  esoz: "ЕСОЗ / МІС",
  reports: "Звіти й розшифровки",
  contracts: "Договори",
  staff: "Кадри",
  monitoring: "Моніторинг",
  referrals: "Направлення",
  screening: "Скринінги",
  other: "Інше",
};
const STATUSES = { f: "Повна", p: "Часткова", n: "Без відповіді" };
const SRC = { c: "чат зустрічі", f: "опитувальник" };
const MONTH_NAMES = ["Січень", "Лютий", "Березень", "Квітень", "Травень",
  "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
const PAGE = 120;

let items = [];
let filtered = [];
let selected = null;
let shown = PAGE;
const state = { q: "", theme: "", st: "", src: "", mil: false, pkg: "" };

const byId = (id) => document.getElementById(id);

/* ---------- ініціалізація ---------- */

function mapRow(r) {
  return {
    i: r.qid,
    d: r.qdate || "",
    s: r.src === "chat" ? "c" : "f",
    t: r.theme,
    u: r.sub || "",
    p: r.pkg || "",
    n: r.pkg_nums || [],
    st: r.status === "full" ? "f" : r.status === "partial" ? "p" : "n",
    m: r.mil ? 1 : 0,
    g: r.gist || "",
    q: r.question,
    a: r.answer || "",
  };
}

async function fetchFresh() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: "auth" };
  const { data, error } = await sb
    .from("meeting_questions")
    .select("*")
    .order("qid")
    .range(0, 4999);
  if (error) return { error: error.message };
  return { rows: data.map(mapRow) };
}

/* Дані на місці (з кешу або з бази) — перерахувати чіпи, статистику, видачу. */
function hydrate() {
  items.forEach((it) => {
    it._hay = (it.q + " " + it.a + " " + it.g + " " + it.u + " " + it.p).toLowerCase();
  });
  buildChips();
  renderHeroStats();
  renderAnalytics();
  applyFilters();
}

async function init() {
  bindEvents();

  let cachedStr = null;
  try { cachedStr = localStorage.getItem(CACHE_KEY); } catch { /* private mode */ }
  if (cachedStr) {
    try {
      items = JSON.parse(cachedStr);
      hydrate();
    } catch { cachedStr = null; }
  }

  const fresh = await fetchFresh();
  if (fresh.rows) {
    const freshStr = JSON.stringify(fresh.rows);
    if (freshStr !== cachedStr) {
      items = fresh.rows;
      hydrate();
      try { localStorage.setItem(CACHE_KEY, freshStr); } catch { /* quota */ }
    }
  } else if (!items.length) {
    byId("questionCount").textContent = fresh.error === "auth"
      ? "Увійдіть у портал — шпаргалка доступна зареєстрованим"
      : "Не вдалося завантажити дані: " + fresh.error;
  }
}

function bindEvents() {
  byId("questionSearch").addEventListener("input", debounce(onSearchInput, 90));
  byId("resetFilters").addEventListener("click", resetAll);
  byId("showMoreBtn").addEventListener("click", () => { shown += PAGE; renderCards(); });
  byId("copyAnswerBtn").addEventListener("click", () => copyText(answerClipboard(false), "copyAnswerBtn"));
  byId("copyBothBtn").addEventListener("click", () => copyText(answerClipboard(true), "copyBothBtn"));

  document.querySelectorAll(".qtab").forEach((btn) =>
    btn.addEventListener("click", () => switchView(btn.dataset.view)));

  document.addEventListener("keydown", (e) => {
    const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
    if (e.key === "/" && !inField) { e.preventDefault(); byId("questionSearch").focus(); }
    if (e.key === "Escape" && state.q) {
      byId("questionSearch").value = "";
      state.q = "";
      applyFilters();
    }
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function onSearchInput() {
  state.q = byId("questionSearch").value.trim().toLowerCase();
  applyFilters();
}

function switchView(view) {
  document.querySelectorAll(".qtab").forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active);
  });
  byId("viewSearch").hidden = view !== "search";
  byId("viewStats").hidden = view !== "stats";
}

/* ---------- чіпи-фільтри ---------- */

function chip(label, value, group, count) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.dataset.group = group;
  b.dataset.value = value;
  b.innerHTML = count != null
    ? `${escapeHtml(label)} <span class="chip-count">${count}</span>`
    : escapeHtml(label);
  b.addEventListener("click", () => {
    if (group === "mil") state.mil = !state.mil;
    else state[group] = state[group] === value ? "" : value;
    applyFilters();
  });
  return b;
}

function buildChips() {
  ["themeChips", "statusChips", "extraChips", "pkgChips"].forEach((id) => { byId(id).innerHTML = ""; });

  const themeCounts = countBy(items, (it) => it.t);
  const themeBox = byId("themeChips");
  Object.keys(THEMES)
    .sort((a, b2) => (themeCounts[b2] || 0) - (themeCounts[a] || 0))
    .forEach((t) => themeBox.appendChild(chip(THEMES[t], t, "theme", themeCounts[t] || 0)));

  const stBox = byId("statusChips");
  ["f", "p", "n"].forEach((s) =>
    stBox.appendChild(chip(STATUSES[s], s, "st", items.filter((i) => i.st === s).length)));
  stBox.querySelectorAll(".chip").forEach((c) => c.classList.add("chip-st", "chip-st-" + c.dataset.value));

  const exBox = byId("extraChips");
  exBox.appendChild(chip("Чат", "c", "src", items.filter((i) => i.s === "c").length));
  exBox.appendChild(chip("Опитувальник", "f", "src", items.filter((i) => i.s === "f").length));
  exBox.appendChild(chip("Військові", "1", "mil", items.filter((i) => i.m).length));

  const pkgCounts = {};
  items.forEach((it) => it.n.forEach((p) => { pkgCounts[p] = (pkgCounts[p] || 0) + 1; }));
  const top = Object.entries(pkgCounts).sort((a, b2) => b2[1] - a[1]).slice(0, 14);
  const pkgBox = byId("pkgChips");
  top.forEach(([p, c]) =>
    pkgBox.appendChild(chip(p === "ПМД" ? "ПМД" : "П." + p, p, "pkg", c)));
}

function syncChips() {
  document.querySelectorAll(".chip").forEach((c) => {
    const g = c.dataset.group;
    const on = g === "mil" ? state.mil : state[g] === c.dataset.value;
    c.classList.toggle("active", on);
  });
}

function resetAll() {
  state.q = ""; state.theme = ""; state.st = ""; state.src = ""; state.mil = false; state.pkg = "";
  byId("questionSearch").value = "";
  applyFilters();
}

/* ---------- фільтрація і ранжування ---------- */

function applyFilters() {
  const tokens = state.q ? state.q.split(/\s+/).filter(Boolean) : [];

  filtered = items.filter((it) => {
    if (state.theme && it.t !== state.theme) return false;
    if (state.st && it.st !== state.st) return false;
    if (state.src && it.s !== state.src) return false;
    if (state.mil && !it.m) return false;
    if (state.pkg && !it.n.includes(state.pkg)) return false;
    return tokens.every((tok) => it._hay.includes(tok));
  });

  if (tokens.length) {
    filtered.forEach((it) => {
      let score = 0;
      const q = it.q.toLowerCase(), g = it.g.toLowerCase();
      tokens.forEach((tok) => {
        if (q.includes(tok)) score += 3;
        if (g.includes(tok)) score += 2;
      });
      it._score = score;
    });
    filtered.sort((a, b) => b._score - a._score || (b.d > a.d ? 1 : -1));
  } else {
    filtered.sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : 0));
  }

  shown = PAGE;
  syncChips();
  renderCards();
}

/* ---------- список ---------- */

function renderCards() {
  const box = byId("questionCards");
  box.innerHTML = "";
  byId("questionCount").textContent = `Знайдено: ${filtered.length} із ${items.length}`;

  if (!filtered.length) {
    box.innerHTML = '<div class="no-results">Нічого не знайдено. Спробуйте коротший запит або скиньте фільтри.</div>';
    byId("showMoreBtn").hidden = true;
    return;
  }

  const tokens = state.q ? state.q.split(/\s+/).filter(Boolean) : [];
  filtered.slice(0, shown).forEach((it) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "question-card" + (selected && selected.i === it.i ? " active" : "");
    const title = it.g || it.q.slice(0, 110);
    card.innerHTML = `
      <strong>${highlight(title, tokens)}</strong>
      <div class="card-snippet">${highlight(snippet(it, tokens), tokens)}</div>
      <div class="card-meta-row">
        <span class="card-badges">
          <span class="category-badge">${escapeHtml(THEMES[it.t] || it.t)}</span>
          ${it.n.length ? `<span class="pkg-badge">${escapeHtml(it.n.map(p => p === "ПМД" ? p : "П." + p).join(" "))}</span>` : ""}
          ${it.m ? '<span class="mil-badge">військові</span>' : ""}
        </span>
        <span class="card-right">
          <span class="status-badge st-${it.st}">${STATUSES[it.st]}</span>
          <span class="card-date">${fmtDate(it.d)}</span>
        </span>
      </div>`;
    card.addEventListener("click", () => select(it));
    box.appendChild(card);
  });

  byId("showMoreBtn").hidden = filtered.length <= shown;
  byId("showMoreBtn").textContent = `Показати ще (${Math.min(PAGE, filtered.length - shown)})`;
}

function snippet(it, tokens) {
  const text = it.q;
  if (!tokens.length) return text.length > 180 ? text.slice(0, 180) + "…" : text;
  const low = text.toLowerCase();
  let pos = -1;
  for (const tok of tokens) { const p = low.indexOf(tok); if (p >= 0) { pos = p; break; } }
  if (pos < 0) {
    const lowA = it.a.toLowerCase();
    for (const tok of tokens) {
      const p = lowA.indexOf(tok);
      if (p >= 0) {
        const start = Math.max(0, p - 60);
        return "У відповіді: " + (start ? "…" : "") + it.a.slice(start, start + 170) + "…";
      }
    }
    return text.slice(0, 180) + "…";
  }
  const start = Math.max(0, pos - 60);
  return (start ? "…" : "") + text.slice(start, start + 180) + (start + 180 < text.length ? "…" : "");
}

/* ---------- деталі ---------- */

function select(it) {
  selected = it;
  renderCards();

  byId("panelEmptyState").style.display = "none";
  const viewer = byId("questionDetailViewer");
  viewer.style.display = "flex";

  const tokens = state.q ? state.q.split(/\s+/).filter(Boolean) : [];

  byId("detBadges").innerHTML = `
    <span class="category-badge">${escapeHtml(THEMES[it.t] || it.t)}</span>
    ${it.p ? `<span class="pkg-badge">${escapeHtml(it.p)}</span>` : ""}
    ${it.m ? '<span class="mil-badge">військові</span>' : ""}
    <span class="status-badge st-${it.st}">${STATUSES[it.st]}</span>`;
  byId("detQuestionTitle").textContent = it.g || "Питання закладу";
  byId("detMeta").textContent = `${fmtDate(it.d, true)} · ${SRC[it.s]}${it.u ? " · " + it.u : ""}`;
  byId("detText").innerHTML = highlight(it.q, tokens);

  const ansBox = byId("detAnswer");
  if (it.a) {
    ansBox.classList.remove("answer-missing");
    ansBox.innerHTML = highlight(it.a, tokens);
  } else {
    ansBox.classList.add("answer-missing");
    ansBox.innerHTML = "<em>Відповідь не зафіксована. Питання можна підняти на наступній зустрічі.</em>";
  }
  byId("copyAnswerBtn").disabled = !it.a;

  if (window.innerWidth <= 1040) {
    byId("questionPanelSide").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function answerClipboard(withQuestion) {
  if (!selected) return "";
  return withQuestion
    ? `Питання (${fmtDate(selected.d)}): ${selected.q}\n\nВідповідь НСЗУ: ${selected.a}`
    : selected.a;
}

async function copyText(text, btnId) {
  if (!text) return;
  const btn = byId(btnId);
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Скопійовано ✓";
  } catch {
    btn.textContent = "Не вдалося скопіювати";
  }
  setTimeout(() => { btn.textContent = original; }, 1600);
}

/* ---------- статистика в шапці ---------- */

function renderHeroStats() {
  const total = items.length;
  const full = items.filter((i) => i.st === "f").length;
  const none = items.filter((i) => i.st === "n").length;
  const meetings = new Set(items.filter((i) => i.s === "c").map((i) => i.d)).size;
  byId("questionsStats").innerHTML = `
    <div class="stat"><strong>${total}</strong><span>питань</span></div>
    <div class="stat"><strong>${meetings}</strong><span>зустрічей</span></div>
    <div class="stat"><strong>${full}</strong><span>повних відповідей</span></div>
    <div class="stat"><strong>${none}</strong><span>без відповіді</span></div>`;
}

/* ---------- аналітика ---------- */

function countBy(arr, fn) {
  const out = {};
  arr.forEach((x) => { const k = fn(x); out[k] = (out[k] || 0) + 1; });
  return out;
}

function hbarRow(label, value, max, extraClass, title) {
  const w = max ? Math.max(1.5, (value / max) * 100) : 0;
  return `
    <div class="hbar-row"${title ? ` title="${escapeHtml(title)}"` : ""}>
      <span class="hbar-label">${escapeHtml(label)}</span>
      <div class="hbar-track"><div class="hbar-fill ${extraClass || ""}" style="width:${w}%"></div></div>
      <span class="hbar-val">${value}</span>
    </div>`;
}

function renderAnalytics() {
  const total = items.length;
  const cnt = (st) => items.filter((i) => i.st === st).length;
  const pct = (v) => Math.round((v / total) * 100) + "%";
  const milCount = items.filter((i) => i.m).length;

  byId("statTiles").innerHTML = `
    <div class="stat-tile"><div class="tile-val">${total}</div><div class="tile-label">питань за пів року</div></div>
    <div class="stat-tile"><div class="tile-val tile-f">${cnt("f")}</div><div class="tile-label">повних відповідей · ${pct(cnt("f"))}</div></div>
    <div class="stat-tile"><div class="tile-val tile-p">${cnt("p")}</div><div class="tile-label">часткових · ${pct(cnt("p"))}</div></div>
    <div class="stat-tile"><div class="tile-val tile-n">${cnt("n")}</div><div class="tile-label">без відповіді · ${pct(cnt("n"))}</div></div>
    <div class="stat-tile"><div class="tile-val">${milCount}</div><div class="tile-label">про військових і ВПО</div></div>`;

  const themeCounts = countBy(items, (i) => i.t);
  const themeEntries = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]);
  const maxTheme = themeEntries[0][1];
  byId("chartThemes").innerHTML = themeEntries
    .map(([t, c]) => hbarRow(THEMES[t] || t, c, maxTheme, "", `${THEMES[t]}: ${c} (${pct(c)})`))
    .join("");

  byId("monthsLegend").innerHTML = ["f", "p", "n"]
    .map((s) => `<span class="legend-item"><span class="legend-dot st-${s}"></span>${STATUSES[s]}</span>`)
    .join("");
  const byMonth = {};
  items.forEach((i) => {
    if (!i.d) return;
    const m = i.d.slice(0, 7);
    (byMonth[m] = byMonth[m] || { f: 0, p: 0, n: 0 })[i.st]++;
  });
  const months = Object.keys(byMonth).sort();
  const maxMonth = Math.max(...months.map((m) => byMonth[m].f + byMonth[m].p + byMonth[m].n));
  byId("chartMonths").innerHTML = months.map((m) => {
    const d = byMonth[m];
    const sum = d.f + d.p + d.n;
    const label = MONTH_NAMES[parseInt(m.slice(5), 10) - 1] || m;
    const segs = ["f", "p", "n"]
      .filter((s) => d[s] > 0)
      .map((s) => `<span class="seg st-${s}" style="width:${(d[s] / maxMonth) * 100}%" title="${STATUSES[s]}: ${d[s]}"></span>`)
      .join("");
    return `
      <div class="hbar-row" title="${escapeHtml(label)}: ${sum} (повна ${d.f} - часткова ${d.p} - без відповіді ${d.n})">
        <span class="hbar-label">${escapeHtml(label)}</span>
        <div class="hbar-track stacked">${segs}</div>
        <span class="hbar-val">${sum}</span>
      </div>`;
  }).join("");

  const pkgCounts = {};
  items.forEach((it) => it.n.forEach((p) => { pkgCounts[p] = (pkgCounts[p] || 0) + 1; }));
  const pkgTop = Object.entries(pkgCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const maxPkg = pkgTop.length ? pkgTop[0][1] : 0;
  byId("chartPkgs").innerHTML = pkgTop
    .map(([p, c]) => hbarRow(p === "ПМД" ? "ПМД" : "Пакет " + p, c, maxPkg))
    .join("");

  const subCounts = countBy(items.filter((i) => i.u), (i) => i.u.toLowerCase());
  const subTop = Object.entries(subCounts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const maxSub = subTop.length ? subTop[0][1] : 0;
  byId("chartSubs").innerHTML = subTop.length
    ? subTop.map(([s, c]) => hbarRow(s, c, maxSub)).join("")
    : '<div class="no-results">Повторюваних підтем не знайдено.</div>';
}

/* ---------- утиліти ---------- */

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/* Підсвітка збігів: спочатку екрануємо, потім загортаємо токени в <mark>.
   Сентинели з Private Use Area, щоб не конфліктувати з текстом. */
const HL_OPEN = "\uE000", HL_CLOSE = "\uE001";
function highlight(text, tokens) {
  let safe = escapeHtml(text);
  if (!tokens || !tokens.length) return safe;
  [...tokens].sort((a, b) => b.length - a.length).forEach((tok) => {
    if (tok.length < 2) return;
    const rx = new RegExp(escapeRegex(escapeHtml(tok)), "gi");
    safe = safe.replace(rx, (m) => HL_OPEN + m + HL_CLOSE);
  });
  return safe
    .replaceAll(HL_OPEN, '<mark class="qmark">')
    .replaceAll(HL_CLOSE, "</mark>");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fmtDate(iso, long) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("uk-UA", long
    ? { day: "numeric", month: "long", year: "numeric" }
    : { day: "2-digit", month: "2-digit", year: "2-digit" });
}

document.addEventListener("DOMContentLoaded", init);
