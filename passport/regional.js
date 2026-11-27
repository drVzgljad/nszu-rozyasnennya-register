// ═══════════════════════════════════════════════════════════════
// Паспорт пакета · блок «Звіт НСЗУ щодо стану реалізації ПМГ» (27.11.2026)
//
// Дані — публічні обласні звіти НСЗУ (архів документів, тип «Аналітичні
// звіти»), які НСЗУ замінює приблизно раз на місяць. Збирає їх
// tools/build_passport_regional.py → passport/data/regional/ (набір
// passport_regional у реєстрі джерел). Тут — лише агрегати по країні й
// областях, без закладів.
//
// Блок іде за зрізом панелі «Як працює пакет»: вибрали область на карті —
// числа стають обласними. Перемальовує його сама панель (draw()), тож
// окремої підписки на зріз немає.
//
// Синхронізація з «Довідниками»: вимога до персоналу веде в «Кадри», ДСГ —
// у «Кодер», нижній рядок — у Кадри / Обладнання / Кодер за пакетом. Свого
// розбору посад чи ДСГ тут немає: сторінки довідників шукають самі.
// ═══════════════════════════════════════════════════════════════
(function () {
  "use strict";

  const R = { idx: null, idxP: null, pkg: null, data: null, tried: null };
  const NB = " ";
  const MON = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => Math.round(v || 0).toLocaleString("uk-UA");
  const pct = (a, b, d) => (b ? (a / b * 100).toFixed(d == null ? 1 : d).replace(".", ",") + NB + "%" : "—");
  const mln = (v) => (v / 1e6).toLocaleString("uk-UA", { maximumFractionDigits: v >= 1e9 ? 0 : 1 }) + NB + "млн" + NB + "₴";
  const big = (v) => v >= 1e6 ? (v / 1e6).toLocaleString("uk-UA", { maximumFractionDigits: 1 }) + NB + "млн"
    : v >= 1e4 ? (v / 1e3).toLocaleString("uk-UA", { maximumFractionDigits: 0 }) + NB + "тис." : num(v);

  function oblName(o) {
    if (!o) return "Україна";
    if (o === "М.КИЇВ") return "м. Київ";
    if (o === "М.СЕВАСТОПОЛЬ") return "м. Севастополь";
    if (o === "АВТОНОМНА РЕСПУБЛІКА КРИМ") return "АР Крим";
    return o.toLowerCase().replace(/(^|[-\s])(\S)/gu, (m, p, ch) => p + ch.toUpperCase()) + " область";
  }
  const scopeObl = () => {
    const ap = window.AnalyticsPanel && window.AnalyticsPanel.state;
    return ap && ap.scope ? ap.scope.obl || null : null;
  };

  // Довідники — шляхи від сторінки паспорта
  const LINK = {
    kadry: (p, q) => `../classifiers/kadry.html?${q ? "q=" + encodeURIComponent(q) : "package=" + encodeURIComponent(p)}`,
    koder: (q) => `../koduvannia/koder.html?q=${encodeURIComponent(q)}`,
    obl: (p) => `../classifiers/obladnannia.html?q=${encodeURIComponent("пакет " + p)}`,
  };

  /** Перша посада з тексту вимоги: «Лікар-невропатолог та/або …» → «Лікар-невропатолог».
   *  Крос-перевірки («Перевірка загальної кількості…») посадою не є — тоді null. */
  function firstPost(t) {
    if (/^перевірка|^наявність|^кількість/i.test(t)) return null;
    const s = t.split(/\s+та\/або\s+|\s+або\s+|\s*\(|,|;/)[0].trim();
    return s.length > 3 ? s : null;
  }

  /* ── Завантаження ─────────────────────────────────────────────── */
  function loadIndex() {
    if (!R.idxP) {
      // ?t= — повз кеш service worker'а: індекс малий, а від нього залежить, який випуск вантажити
      R.idxP = fetch(`data/regional/index.json?t=${Date.now()}`, { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((d) => {
          R.idx = d;
          if (window.AnalyticsPanel && window.AnalyticsPanel.redraw) window.AnalyticsPanel.redraw();
          return d;
        });
    }
    return R.idxP;
  }

  async function render(pkgNum) {
    const p = String(pkgNum);
    R.pkg = p; R.data = null; R.tried = null;
    draw();
    const idx = await loadIndex();
    if (R.pkg !== p) return;
    if (!idx || !idx.packages || !idx.packages[p]) { R.tried = p; draw(); return; }
    // ?v= — дата випуску: свіжий випуск = нова адреса, повз кеш service worker
    const d = await fetch(`data/regional/pkg_${encodeURIComponent(p)}.json?v=${encodeURIComponent(idx.formed_iso)}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (R.pkg !== p) return;
    R.data = d; R.tried = p;
    draw();
  }

  /** Для реєстру джерел панелі (лампочка «Якість даних»). */
  function meta() {
    if (!R.idx) return null;
    const [d, m, y] = R.idx.formed.split(".").map(Number);
    return { formed: R.idx.formed, date: new Date(y, m - 1, d), source: R.idx.source,
      has: R.pkg && R.idx.packages ? R.idx.packages[R.pkg] || null : null };
  }

  /* ── Повні місяці 2026: хвіст, що ще вноситься/оплачується, відкидаємо ── */
  function fullMonths(series) {
    const ks = Object.keys(series).filter((k) => k.length === 7).sort();
    const vals = ks.map((k) => series[k]);
    let n = ks.length;
    while (n > 2) {
      const prev = vals.slice(0, n - 1).slice(-6).sort((a, b) => a - b);
      const med = prev[Math.floor(prev.length / 2)] || 0;
      if (vals[n - 1] < med * 0.8) n--; else break;
    }
    return { full: ks.slice(0, n), tail: ks.slice(n) };
  }
  const monLbl = (k) => `${MON[+k.slice(5) - 1]}${NB}${k.slice(0, 4)}`;
  const span = (ks) => ks.length ? (ks.length === 1 ? monLbl(ks[0]) : `${MON[+ks[0].slice(5) - 1]}–${monLbl(ks[ks.length - 1])}`) : "—";

  /* ── Обсяги й оплати за роками ────────────────────────────────── */
  function volHtml(d, obl) {
    const e = d.emz;
    if (!e) return "";
    const src = obl ? (e.o && e.o[obl]) : null;
    if (obl && !src) return `<p class="rg-empty">У звіті немає обсягів за цим пакетом в області.</p>`;
    const t = e.t;
    const m26 = Object.keys(t).filter((k) => k.startsWith("2026-")).sort();
    const fm = fullMonths(Object.fromEntries(m26.map((k) => [k, t[k][1] || t[k][0]])));
    const sum = (ks, i) => ks.reduce((a, k) => a + (t[k] ? t[k][i] : 0), 0);
    const yr = (y, i) => obl ? (src[y] ? src[y][i] : 0) : (t[y] ? t[y][i] : 0);
    // Обласний 2026 у файлі — сума всіх місяців (з неповним хвостом), тому позначаємо
    const v26 = (i) => obl ? yr("2026", i) : sum(fm.full, i);
    const same = e.t["2024"] && e.t["2024"][0] === e.t["2024"][1];
    const rows = [["2024", yr("2024", 0), yr("2024", 1)], ["2025", yr("2025", 0), yr("2025", 1)],
      [`2026 · ${obl ? span(m26) : span(fm.full)}`, v26(0), v26(1)]];
    const avg25 = yr("2025", same ? 0 : 1) / 12;
    const n26 = obl ? m26.length : fm.full.length;
    const avg26 = n26 ? v26(same ? 0 : 1) / n26 : 0;
    // Область — без порівняння: у файлі обласний 2026 з неповним останнім місяцем
    const ch = !obl && avg25 && avg26 ? (avg26 / avg25 - 1) * 100 : null;
    const spark = !obl && fm.full.length > 2 ? sparkSvg(fm.full.map((k) => t[k][same ? 0 : 1])) : "";
    let pay = "";
    if (!obl && d.pay) {
      const Y = Object.keys(d.pay).sort();
      const pm = fullMonths(Object.fromEntries(d.pay["2026"] ? d.pay["2026"].map((v, i) => [`2026-${String(i + 1).padStart(2, "0")}`, v]).filter(([, v]) => v) : []));
      const k = pm.full.length;
      pay = `<tr><th scope="row">Оплати НСЗУ <small>звірка; для документів — таблиця ДІТ</small></th>${Y.map((y) => {
        const a = d.pay[y], tot = a.reduce((s, v) => s + v, 0);
        return y === "2026" ? `<td class="n">${esc(mln(a.slice(0, k).reduce((s, v) => s + v, 0)))}<small>${esc(span(pm.full))}</small></td>`
          : `<td class="n">${esc(mln(tot))}</td>`;
      }).join("")}</tr>`;
      pay = `<div class="ap-table-wrap"><table class="ap-table rg-tbl"><thead><tr><th></th>${Y.map((y) => `<th class="n">${y}</th>`).join("")}</tr></thead><tbody>${pay}</tbody></table></div>`;
    }
    return `<section class="rg-sec">
      <h5>Обсяги за роками ${ch != null ? `<span class="rg-chip ${ch >= 0 ? "is-up" : "is-down"}">${ch >= 0 ? "+" : ""}${ch.toFixed(1).replace(".", ",")}${NB}% у середньому на місяць до 2025</span>` : ""}</h5>
      <div class="rg-vol">
        <div class="ap-table-wrap"><table class="ap-table rg-tbl">
          <thead><tr><th>Рік</th><th class="n">ЕМЗ</th>${same ? "" : `<th class="n">Послуги</th>`}</tr></thead>
          <tbody>${rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th><td class="n">${esc(num(r[1]))}</td>${same ? "" : `<td class="n">${esc(num(r[2]))}</td>`}</tr>`).join("")}</tbody>
        </table></div>
        ${spark ? `<figure class="rg-spark">${spark}<figcaption>${same ? "ЕМЗ" : "послуги"} помісячно, ${esc(span(fm.full))}</figcaption></figure>` : ""}
      </div>
      ${fm.tail.length && !obl ? `<p class="rg-note">${esc(fm.tail.map(monLbl).join(", "))} ще вносяться в ЕСОЗ — у підсумки 2026 не входять.</p>` : ""}
      ${obl ? `<p class="rg-note">Обласний 2026 — усі місяці у звіті, разом з неповним останнім.</p>` : ""}
      ${pay}
    </section>`;
  }

  function sparkSvg(vals) {
    const W = 220, H = 44, pad = 3, max = Math.max(...vals), min = Math.min(...vals) * 0.9;
    const x = (i) => pad + i * (W - 2 * pad) / Math.max(vals.length - 1, 1);
    const y = (v) => H - pad - (v - min) / Math.max(max - min, 1) * (H - 2 * pad);
    const dd = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    return `<svg class="ap-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${dd}" class="ap-spark-l"/></svg>`;
  }

  /* ── Невідповідності вимогам до персоналу ─────────────────────── */
  function staffHtml(d, obl) {
    const s = d.staff;
    const months = (R.idx && R.idx.staff_months) || [];
    const head = `<h5>Невідповідності вимогам до персоналу <small>${esc(span(months))}</small></h5>`;
    if (!s) return `<section class="rg-sec">${head}<p class="rg-empty">За цим пакетом у звіті невідповідностей немає.</p></section>`;
    const z = obl ? (s.o[obl] || 0) : s.z;
    const reqs = s.reqs.map((r) => ({ ...r, zz: obl ? (r.o[obl] || 0) : r.z })).filter((r) => r.zz > 0);
    if (!reqs.length) return `<section class="rg-sec">${head}<p class="rg-empty">В області невідповідностей за цим пакетом не зафіксовано.</p></section>`;
    const lastM = months[months.length - 1];
    const nowZ = !obl && lastM ? (s.m[lastM] || 0) : null;
    const max = Math.max(...reqs.map((r) => r.zz), 1);
    const shown = reqs.slice(0, 12);
    const row = (r) => {
      const post = firstPost(r.t);
      const href = LINK.kadry(d.p, post);
      return `<tr>
        <th scope="row"><span class="rg-code">${esc(r.c)}</span> <a href="${esc(href)}" class="rg-link" title="${esc(post ? "«Кадри»: " + post : "«Кадри»: вимоги пакета")}">${esc(r.t.length > 120 ? r.t.slice(0, 117) + "…" : r.t)}</a>
          <small>${esc(r.l)}</small></th>
        <td class="rg-barc"><span class="ap-kbar"><i style="width:${(r.zz / max * 100).toFixed(1)}%"></i></span></td>
        <td class="n">${esc(num(r.zz))}</td>
        ${obl ? "" : `<td class="n">${esc(num(r.d))}</td><td class="n">${esc(num(lastM && r.m[lastM] || 0))}</td>`}</tr>`;
    };
    const table = (list) => `<div class="ap-table-wrap"><table class="ap-table rg-tbl rg-staff">
      <thead><tr><th>Вимога (посилання — у «Кадри»)</th><th></th><th class="n">Закладів</th>${obl ? "" : `<th class="n">Днів разом</th><th class="n">${esc(lastM ? monLbl(lastM) : "")}</th>`}</tr></thead>
      <tbody>${list.map(row).join("")}</tbody></table></div>`;
    return `<section class="rg-sec">${head}
      <p class="rg-lead">${esc(num(z))} ${plural(z, "заклад мав", "заклади мали", "закладів мали")} хоча б один день невідповідності${nowZ != null ? `; у ${esc(monLbl(lastM))} — ${esc(num(nowZ))}` : ""}. Найчастіше — ${esc(firstPost(reqs[0].t) || reqs[0].t)}.</p>
      ${table(shown)}
      ${reqs.length > shown.length ? `<details class="ap-inline-more"><summary>усі вимоги · ${reqs.length}</summary>${table(reqs.slice(shown.length))}</details>` : ""}
      <p class="rg-note">Невідповідність — днів, коли в ЕСОЗ заклад не мав працівника, якого вимагає умова закупівлі. Текст вимоги — у вкладці <a href="#" data-rg-tab="requirements">«Вимоги закупівлі»</a>.</p>
    </section>`;
  }

  /* ── Хірургія одного дня за ДСГ (пакети 3, 47) ─────────────────── */
  function dsgHtml(d, obl) {
    if (!d.dsg) return "";
    const rows = Object.entries(d.dsg).map(([c, v]) => {
      const pick = (y) => obl ? ((v.o[obl] || {})[y] || [0, 0]) : (y === "2026"
        ? Object.entries(v.p).filter(([k]) => k.startsWith("2026-")).reduce((a, [, x]) => [a[0] + x[0], a[1] + x[1]], [0, 0])
        : v.p[y] || [0, 0]);
      return { c, t: v.t, a25: pick("2025"), a26: pick("2026") };
    }).filter((r) => r.a25[0] + r.a26[0] > 0).sort((a, b) => b.a25[0] - a.a25[0]);
    if (!rows.length) return "";
    const tot = (k, i) => rows.reduce((a, r) => a + r[k][i], 0);
    const share25 = pct(tot("a25", 1), tot("a25", 0)), share26 = pct(tot("a26", 1), tot("a26", 0));
    const shown = rows.slice(0, 15);
    const tr = (r) => `<tr><th scope="row"><a class="rg-link rg-code" href="${esc(LINK.koder("ДСГ " + r.c))}" title="«Кодер»: ДСГ ${esc(r.c)}">${esc(r.c)}</a> ${esc(r.t)}</th>
      <td class="n">${esc(num(r.a25[0]))}</td><td class="n">${esc(pct(r.a25[1], r.a25[0], 0))}</td><td class="n">${esc(pct(r.a26[1], r.a26[0], 0))}</td></tr>`;
    const table = (list) => `<div class="ap-table-wrap"><table class="ap-table rg-tbl">
      <thead><tr><th>ДСГ (посилання — у «Кодер»)</th><th class="n">ЕМЗ 2025</th><th class="n">1 день, 2025</th><th class="n">1 день, 2026</th></tr></thead>
      <tbody>${list.map(tr).join("")}</tbody></table></div>`;
    return `<section class="rg-sec"><h5>Хірургія одного дня за ДСГ</h5>
      <p class="rg-lead">Тривалістю один день — ${esc(share25)} хірургічних ЕМЗ 2025 року і ${esc(share26)} у 2026 році (${esc(rows.length)} ДСГ). Розріз за ДСГ спільний для пакетів 3 і 47: у звіті він не поділений за пакетами.</p>
      ${table(shown)}
      ${rows.length > shown.length ? `<details class="ap-inline-more"><summary>усі ДСГ · ${rows.length}</summary>${table(rows.slice(shown.length))}</details>` : ""}
    </section>`;
  }

  /* ── Маршрут: інсульт (5) / інфаркт (6) ───────────────────────── */
  function routeHtml(d, obl) {
    const r = d.route;
    if (!r) return "";
    const C = Object.fromEntries(r.cols.map((c, i) => [c, i]));
    const yrs = ["2024", "2025", "2026"];
    const get = (y) => obl ? ((r.o[obl] || {})[y]) : r.t[y];
    const lastM = Object.keys(r.t).filter((k) => k.length === 7).sort().pop();
    const stroke = d.p === "5";
    const lines = stroke ? [
      ["Випадків інсульту", (v) => num(v[C.stroke])],
      ["з них ішемічних", (v) => num(v[C.isch])],
      ["тромболізис при ішемічному", (v) => pct(v[C.isch_tl], v[C.isch])],
      ["померли в стаціонарі", (v) => pct(v[C.stroke_death], v[C.stroke])],
      ["30-денна летальність", (v) => pct(v[C.stroke_death30], v[C.stroke])],
      ["екстрена госпіталізація", (v) => pct(v[C.stroke_emerg], v[C.stroke])],
    ] : [
      ["Випадків інфаркту", (v) => num(v[C.mi])],
      ["стентування", (v) => pct(v[C.stent], v[C.mi])],
      ["померли в стаціонарі", (v) => pct(v[C.mi_death], v[C.mi])],
      ["30-денна летальність", (v) => pct(v[C.mi_death30], v[C.mi])],
      ["екстрена госпіталізація", (v) => pct(v[C.mi_emerg], v[C.mi])],
    ];
    const cols = yrs.filter((y) => get(y));
    if (!cols.length) return "";
    return `<section class="rg-sec"><h5>Маршрут пацієнта з гострим ${stroke ? "інсультом" : "інфарктом міокарда"}</h5>
      <div class="ap-table-wrap"><table class="ap-table rg-tbl">
        <thead><tr><th></th>${cols.map((y) => `<th class="n">${y === "2026" ? `2026 · до ${esc(monLbl(lastM))}` : y}</th>`).join("")}</tr></thead>
        <tbody>${lines.map(([l, f]) => `<tr><th scope="row">${esc(l)}</th>${cols.map((y) => `<td class="n">${esc(f(get(y)))}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
      <p class="rg-note">Усі заклади, що лікували, — і з договором на пакет ${esc(d.p)}, і без нього. 30-денна летальність — смерть протягом 30 днів від госпіталізації; останній місяць ще дораховується.</p>
    </section>`;
  }

  /* ── Пологи (7) ───────────────────────────────────────────────── */
  function birthsHtml(d, obl) {
    const b = d.births;
    if (!b) return "";
    const C = Object.fromEntries(b.cols.map((c, i) => [c, i]));
    const agg = (y) => {
      if (obl) return (b.o[obl] || {})[y];
      const ks = Object.keys(b.t).filter((k) => k.startsWith(y + "-"));
      return ks.length ? ks.reduce((a, k) => a.map((v, i) => v + b.t[k][i]), b.cols.map(() => 0)) : null;
    };
    const m26 = Object.keys(b.t).filter((k) => k.startsWith("2026-")).sort();
    const cols = ["2024", "2025", "2026"].filter((y) => agg(y));
    const lines = [
      ["Пологів", (v) => num(v[C.births])],
      ["кесарів розтин", (v) => pct(v[C.cs], v[C.births])],
      ["передчасні 20–33 тижні", (v) => pct(v[C.preterm], v[C.births])],
      ["прееклампсія важкого ступеня", (v) => pct(v[C.preecl], v[C.births])],
      ["гестаційний діабет", (v) => pct(v[C.gdm], v[C.births])],
      ["рубець на матці", (v) => pct(v[C.scar], v[C.births])],
      ["антенатальна загибель плода", (v) => num(v[C.antenatal])],
    ];
    return `<section class="rg-sec"><h5>Пологи та ускладнення</h5>
      <div class="ap-table-wrap"><table class="ap-table rg-tbl">
        <thead><tr><th></th>${cols.map((y) => `<th class="n">${y === "2026" ? `2026 · ${esc(span(m26))}` : y}</th>`).join("")}</tr></thead>
        <tbody>${lines.map(([l, f]) => `<tr><th scope="row">${esc(l)}</th>${cols.map((y) => `<td class="n">${esc(f(agg(y)))}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
      <p class="rg-note">Частки — від усіх пологів; останній місяць ще вноситься.</p>
    </section>`;
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  }

  /* ── Картка ───────────────────────────────────────────────────── */
  function draw() {
    const box = $("apRegional");
    if (!box) return;
    const p = R.pkg;
    if (!p) { box.innerHTML = ""; return; }
    const refs = `<nav class="rg-refs" aria-label="Довідники за пакетом">
      <span>Довідники за пакетом ${esc(p)}:</span>
      <a href="${esc(LINK.kadry(p))}">👥 Кадри</a>
      <a href="${esc(LINK.obl(p))}">🩻 Обладнання</a>
      <a href="${esc(LINK.koder("пакет " + p))}">🧭 Кодер</a></nav>`;
    if (!R.data) {
      box.innerHTML = R.tried === p
        ? `<header class="ap-card-h"><h4>Звіт НСЗУ щодо стану реалізації ПМГ</h4></header>
           <p class="ap-empty">${R.idx ? "У звіті НСЗУ даних за цим пакетом немає." : "Дані звіту НСЗУ не завантажилися."}</p>${refs}`
        : '<div class="ap-skel"><i></i><i></i><i></i></div>';
      return;
    }
    const d = R.data, obl = scopeObl();
    const ap = window.AnalyticsPanel && window.AnalyticsPanel.state;
    const below = ap && ap.scope && (ap.scope.hrom || ap.scope.place);
    const safe = (fn) => { try { return fn(d, obl); } catch (e) { console.warn("звіт НСЗУ:", fn.name, e); return ""; } };
    box.innerHTML = `
      <header class="ap-card-h">
        <h4>Звіт НСЗУ щодо стану реалізації ПМГ: ${esc(oblName(obl))}</h4>
        <p class="ap-prov">випуск від ${esc(d.formed)} · <a href="${esc(R.idx.source.url)}" target="_blank" rel="noopener">обласні аналітичні звіти НСЗУ</a> · лише агрегати по країні й областях${below ? " · нижче області звіт не ділиться — показано область" : ""}</p>
      </header>
      ${safe(volHtml)}${safe(staffHtml)}${safe(dsgHtml)}${safe(routeHtml)}${safe(birthsHtml)}
      ${refs}`;
    box.querySelectorAll("[data-rg-tab]").forEach((a) => a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const t = document.querySelector(`.tab-link[data-tab="${a.dataset.rgTab}"]`);
      if (t) { t.click(); t.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }));
  }

  loadIndex();
  window.PkgRegional = { render, draw, meta };
})();
