/* ══════════════ ПРИЛАДОВА ПАНЕЛЬ ПАКЕТА (signals.js, 21.09.2026) ══════════════
   Як в авто: панель мовчить, поки все гаразд; проблема — лампочка і короткий
   напис; клік веде в блок паспорта з подробицями, а там — «детально».

   Дані — data/alerts.json (D:\pmg-data\31_аналітика_пакета\build_alerts.py).
   Правила й пороги живуть там само, в indicators.py: тут лише показ. Єдине, що
   рахує браузер, — свіжість джерел від їхніх дат, бо вона змінюється з часом
   без перезбирання (те саме правило, що й лампочки якості в панелі).

   Два місця на сторінці:
   • смуга #pkgSignals у шапці паспорта — сигнали обраного пакета;
   • крапки в бічному переліку пакетів + перемикач «лише з сигналами».
   ──────────────────────────────────────────────────────────────────────── */
(() => {
"use strict";

const S = { data: null, loading: null, pkg: null, only: false, open: false };
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ST = () => (typeof passportState !== "undefined" ? passportState : {});

const PR = new Intl.PluralRules("uk-UA");
const plural = (n, one, few, many) => {
  const f = PR.select(Math.round(n));
  return f === "one" ? one : f === "few" ? few : many;
};

/* Тип норми словом: без нього лампочка читається як «погано», а це лише
   «відхилення від такої-то бази». */
const TYPE_WORD = { "Н": "норма", "С": "порівняння", "І": "динаміка", "Т": "дані" };
const STATE_WORD = { red: "горить червоним", amber: "горить", ok: "у нормі", na: "не перевіряється" };

/* ── Свіжість джерел: правило користувача 13.09.2026 ──────────────── */
const FRESH_WORD = { ok: "актуальні", warn: "треба оновити", bad: "неактуальні", na: "немає даних" };
const freshCount = (n, st) => st === "bad"
  ? `${n} ${plural(n, "неактуальне", "неактуальні", "неактуальних")}`
  : `${n} ${plural(n, "треба оновити", "треба оновити", "треба оновити")}`;
function monthsAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - n);
  return d;
}
function isoDate(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
const dmy = (d) => d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}` : "—";
function fresh(date) {
  if (!date) return "na";
  return date >= monthsAgo(1) ? "ok" : date >= monthsAgo(3) ? "warn" : "bad";
}

/* ── Дані ──────────────────────────────────────────────────────────── */
function load() {
  if (S.loading) return S.loading;
  S.loading = fetch("data/alerts.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d) => {
      S.data = d && d.pkgs ? d : null;
      decorateAll();
      sidebarBar();
      if (S.pkg) render(S.pkg);
      return S.data;
    });
  return S.loading;
}

/* ── Перехід до блока-пояснення ────────────────────────────────────── */
function go(id) {
  const el = $(id);
  if (!el) return;
  const pane = el.closest(".tab-pane");
  if (pane && !pane.classList.contains("active")) {
    const btn = document.querySelector(`.tab-link[data-tab="${pane.id.replace(/^tab-/, "")}"]`);
    if (btn) btn.click();
  }
  for (let p = el; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("sg-flash");
  setTimeout(() => el.classList.remove("sg-flash"), 1800);
}

/* ── Смуга в шапці паспорта ───────────────────────────────────────── */
function chip(o) {
  const type = o.type ? `<b class="sg-t" title="${esc((S.data.types || {})[o.type] || "")}">${esc(TYPE_WORD[o.type] || o.type)}</b>` : "";
  return `<button type="button" class="sg-chip is-${esc(o.s)}${o.sys ? " is-sys" : ""}" data-sg-go="${esc(o.go || "")}"
      title="${esc(o.title)}"><i aria-hidden="true"></i><span class="sg-x">${esc(o.short)}</span>${type}</button>`;
}

function systemChips() {
  const out = [];
  const srcs = (S.data.sources || []).map((s) => ({ ...s, st: fresh(isoDate(s.date)) }));
  const bad = srcs.filter((s) => s.st === "bad"), warn = srcs.filter((s) => s.st === "warn");
  if (bad.length || warn.length) {
    const parts = [];
    if (bad.length) parts.push(freshCount(bad.length, "bad"));
    if (warn.length) parts.push(freshCount(warn.length, "warn"));
    const list = srcs.filter((s) => s.st !== "ok")
      .map((s) => `${s.title}: ${dmy(isoDate(s.date))} — ${FRESH_WORD[s.st]}`).join("\n");
    out.push({ s: bad.length ? "red" : "amber", sys: true, go: "apQualityDetails", type: "Т",
      short: `джерела: ${parts.join(", ")}`,
      title: `Свіжість джерел даних порталу (однакова для всіх пакетів).\n${list}\nПравило: до 1 міс. — актуальні, до 3 міс. — треба оновити, старші — неактуальні.` });
  }
  (S.data.system || []).filter((r) => r.s === "red" || r.s === "amber").forEach((r) => {
    const rule = (S.data.rules || {})[r.id] || {};
    out.push({ s: r.s, sys: true, go: rule.go || "apQualityDetails", type: rule.type, short: r.short,
      title: `${rule.t || ""}. ${r.text}` });
  });
  return out;
}

function staleNote() {
  const cd = ST().contractsData || {};
  const a = S.data.data || {};
  if (!cd.source_date || !a.net || cd.source_date === a.net) return "";
  return `<p class="sg-stale">Сигнали пораховано на реєстрі договорів від ${esc(a.net)}, а паспорт показує реєстр від ${esc(cd.source_date)} — їх треба перезібрати.</p>`;
}

function moreHtml(rec) {
  const rules = S.data.rules || {};
  const row = (st, r, body) => {
    const rule = rules[r.id] || {};
    return `<li class="sg-li is-${st}"><i aria-hidden="true"></i><div>
        <p class="sg-li-h"><b>${esc(rule.t || r.id)}</b> <span class="sg-t" title="${esc((S.data.types || {})[rule.type] || "")}">${esc(TYPE_WORD[rule.type] || "")}</span>
          <span class="sg-li-st">${esc(STATE_WORD[st] || "")}</span></p>
        ${body}
        <p class="sg-rule">Правило: ${esc(rule.rule || "—")}</p>
      </div></li>`;
  };
  const on = rec.on.map((r) => row(r.s, r, `<p>${esc(r.text)}</p>${rules[r.id] && rules[r.id].go ? `<button type="button" class="sg-link" data-sg-go="${esc(rules[r.id].go)}">до блока в паспорті →</button>` : ""}`)).join("");
  const na = rec.na.map((r) => row("na", r, `${r.text ? `<p>${esc(r.text)}</p>` : ""}<p class="sg-need"><b>Бракує:</b> ${esc(r.need)}</p>`)).join("");
  const ok = rec.ok.map((r) => row("ok", r, `<p>${esc(r.text || r.short)}</p>`)).join("");
  const off = rec.off.map((id) => esc((rules[id] || {}).t || id)).join(", ");
  return `
    ${on ? `<h4 class="sg-sub">Горить</h4><ul class="sg-ul">${on}</ul>` : ""}
    ${na ? `<h4 class="sg-sub">Не перевіряється — бракує даних</h4><ul class="sg-ul">${na}</ul>` : ""}
    ${ok ? `<h4 class="sg-sub">Перевірено, у нормі</h4><ul class="sg-ul">${ok}</ul>` : ""}
    ${off ? `<p class="sg-off"><b>До пакета не застосовується:</b> ${off}.</p>` : ""}
    <p class="sg-foot">Перевірено ${esc(dmy(isoDate(S.data.built)))} на даних: реєстр договорів ${esc(S.data.data.net || "—")}${S.data.data.net_prev ? ` (попередній зріз для порівняння — ${esc(dmy(isoDate(S.data.data.net_prev)))})` : ""}, оплати ДІТ ${esc(S.data.data.pay || "—")}, обсяги ЕСОЗ ${esc(S.data.data.vol || "—")}. ${esc(S.data.draft || "")}</p>`;
}

function render(num) {
  S.pkg = String(num);
  const box = $("pkgSignals");
  if (!box) return;
  if (!S.data) {
    box.hidden = true;
    load();
    return;
  }
  const rec = S.data.pkgs[S.pkg];
  if (!rec) { box.hidden = true; return; }
  const rules = S.data.rules || {};
  const checked = rec.on.length + rec.ok.length;
  const pkgChips = rec.on.map((r) => {
    const rule = rules[r.id] || {};
    return chip({ s: r.s, go: rule.go, type: rule.type, short: r.short, title: `${rule.t || r.id}. ${r.text}` });
  }).join("");
  const naChip = rec.na.length
    ? `<button type="button" class="sg-chip is-na" data-sg-more title="${esc(rec.na.map((r) => `${(rules[r.id] || {}).t || r.id}: бракує — ${r.need}`).join("\n"))}"><i aria-hidden="true"></i><span class="sg-x">${rec.na.length} ${plural(rec.na.length, "не перевіряється", "не перевіряються", "не перевіряються")}</span></button>`
    : "";
  const sys = systemChips().map(chip).join("");
  const lead = rec.on.length
    ? `<span class="sg-h">Сигнали пакета</span>`
    : `<span class="sg-quiet"><i aria-hidden="true"></i>Сигналів пакета немає</span>`;
  box.innerHTML = `
    <div class="sg${rec.on.length ? "" : " is-quiet"}" role="region" aria-label="Сигнали пакета ${esc(S.pkg)}">
      ${lead}${pkgChips}${naChip}
      ${sys ? `<span class="sg-sys"><span class="sg-sys-h">Дані порталу</span>${sys}</span>` : ""}
      <button type="button" class="sg-toggle" data-sg-more aria-expanded="${S.open}">перевірено ${checked} ${plural(checked, "правило", "правила", "правил")} · ${esc(dmy(isoDate(S.data.built)))}<span aria-hidden="true">${S.open ? " ▴" : " ▾"}</span></button>
    </div>
    ${staleNote()}
    <div class="sg-more" ${S.open ? "" : "hidden"}>${moreHtml(rec)}</div>`;
  box.hidden = false;
}

/* ── Бічний перелік пакетів ───────────────────────────────────────── */
function decorate(card, num) {
  if (!card) return;
  const old = card.querySelector(".sg-dots");
  if (old) old.remove();
  const rec = S.data && S.data.pkgs[String(num)];
  const on = rec ? rec.on : [];
  card.classList.toggle("has-sig", on.length > 0);
  if (!on.length) return;
  const red = on.filter((r) => r.s === "red").length;
  const span = document.createElement("span");
  span.className = "sg-dots" + (red ? " is-red" : "");
  span.title = on.map((r) => `• ${r.short}`).join("\n");
  span.innerHTML = `<i aria-hidden="true"></i><b>${on.length}</b><span class="sg-vh">${on.length} ${plural(on.length, "сигнал", "сигнали", "сигналів")}</span>`;
  card.appendChild(span);
}

function decorateAll() {
  document.querySelectorAll("#sidebarPackageList .sidebar-pkg-card").forEach((card) => {
    const n = card.querySelector(".sidebar-pkg-num");
    if (n) decorate(card, n.textContent.trim());
  });
}

function sidebarBar() {
  const host = document.querySelector(".passport-sidebar .sidebar-search");
  if (!host || !S.data) return;
  let bar = $("sgSide");
  const lit = Object.values(S.data.pkgs).filter((r) => r.on.length).length;
  const total = Object.keys(S.data.pkgs).length;
  if (!bar) {
    bar = document.createElement("button");
    bar.type = "button";
    bar.id = "sgSide";
    bar.className = "sg-side";
    host.appendChild(bar);
  }
  bar.setAttribute("aria-pressed", String(S.only));
  bar.innerHTML = `<i aria-hidden="true"></i><span>Сигнали: <b>${lit}</b> ${plural(lit, "пакет", "пакети", "пакетів")} із ${total}</span>` +
    `<span class="sg-side-a">${S.only ? "показати всі" : "лише з сигналами"}</span>`;
  const list = $("sidebarPackageList");
  if (list) list.classList.toggle("sg-only", S.only);
}

/* ── Події ─────────────────────────────────────────────────────────── */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-sg-go], [data-sg-more], #sgSide");
  if (!t) return;
  if (t.id === "sgSide") {
    S.only = !S.only;
    sidebarBar();
    return;
  }
  if (t.hasAttribute("data-sg-more")) {
    S.open = !S.open;
    if (S.pkg) render(S.pkg);
    return;
  }
  const id = t.getAttribute("data-sg-go");
  if (id) go(id);
});

window.PkgSignals = { load, render, decorate, go, state: S };

// Скрипт вантажиться з defer після passport.js: якщо перелік і пакет уже
// намальовані — підхоплюємо їх, інакше гачки passport.js покличуть нас самі.
load().then(() => {
  const sel = ST().selectedPackage;
  if (sel && !S.pkg) render(sel.number);
});
})();
