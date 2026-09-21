/* ══════════════ ЩАБЛІ КАРТИ: ГРОМАДИ, ТОЧКИ, ВІЯЛО ══════════════
   Надбудова над картою покриття регіонів (passport.js → drawRegionMap).
   Показує те, чого плоска карта областей показати не може:
     область → громади → точки закладів за населеним пунктом → віяло.

   Дані беремо з панелі (panel/data/*), і вантажимо їх ЛІНИВО — лише коли
   користувач уперше зумує в область. Паспорт і без них лишається робочим.

   Межі громад лежать у тій самій проєкції і тому самому viewBox, що й
   області: Ламберт 46°/51°, меридіан 31°, вікно 0 −33 1000 750.

   Заливку рахуємо тим самим пандусом --accent/--soft, що й області, тому
   карта перемальовується разом із темою порталу.
   ──────────────────────────────────────────────────────────────── */
(() => {
"use strict";

const VB = { x: 0, y: -33, w: 1000, h: 750 };
// індекси полів у масиві providers (panel.json → provider_fields)
const P = { EDRPOU: 0, NAME: 1, OBL: 2, SETTLE: 3, X: 4, Y: 5,
            OWN: 6, NET: 7, HCODE: 8, HNAME: 9 };
// вище цієї межі віяло перестає бути вибором і стає плямою: у даних є точка
// на 178 закладів (Київ, пакет 1). Таких точок 1 %, їм лишається перелік ЗОЗ.
const FAN_MAX = 24;
const NS = "http://www.w3.org/2000/svg";
const DATA = "../panel/data";

const st = {
  oblast: null,     // область, у яку зумнуто
  hromada: null,    // громада, у яку зумнуто
  fan: null,        // ключ "x|y" розкритої точки
  pick: null,       // {x, y, r} — заклад, чий паспорт відкрито: на ньому горить лампочка
  fanNew: false,    // щойно розкрили — тільки тоді листки вилітають із центру
  hgeom: null,      // геометрія громад поточної області
  panel: null,      // panel.json
  pkg: null,        // номер пакета, за яким малюємо точки
  ctx: null,        // {pickOblast, pickProvider}
  svg: null,
  busy: false,
};
const hromCache = new Map();
let panelPromise = null;

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

/* ── дані ──────────────────────────────────────────────────────── */

/** panel.json — 2,1 МБ, тож вантажимо один раз і лише на першому зумі. */
function ensurePanel() {
  if (st.panel) return Promise.resolve(st.panel);
  if (!panelPromise) {
    panelPromise = fetch(`${DATA}/panel.json`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { st.panel = d; return d; })
      .catch(e => {
        console.warn("щаблі карти: panel.json не завантажився —", e.message);
        return null;
      });
  }
  return panelPromise;
}

function loadHromady(oblast) {
  if (hromCache.has(oblast)) return Promise.resolve(hromCache.get(oblast));
  return fetch(`${DATA}/geo/hromada/${encodeURIComponent(oblast)}.json`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { hromCache.set(oblast, d.units); return d.units; })
    .catch(e => {
      console.warn("щаблі карти: громади не завантажилися —", oblast, e.message);
      hromCache.set(oblast, null);
      return null;
    });
}

/** Рядки [providerIdx, сума] поточного пакета. Без даних — порожньо. */
function rows() {
  const d = st.panel;
  if (!d || !st.pkg) return [];
  return d.links[String(st.pkg)] || [];
}

/* ── геометрія зуму ────────────────────────────────────────────── */

/** Габарити поточного щабля. Беремо їх з файлу геометрії, а НЕ з getBBox():
 *  getBBox() потребує розкладки і мовчки віддає нулі, коли сторінку не
 *  малюють (прихована вкладка, згорнутий блок) — з таких нулів виходив
 *  масштаб 660 замість 5 і карта відлітала в нікуди. */
/* Вимоги користувача 21.09.2026:
 *  — область, у яку зумнули, займає поле карти (раніше лишалося 12 % повітря,
 *    а сама карта при зумі вилазила за своє поле на сусідні блоки сторінки —
 *    обрізання дає `.ua-map.is-zoomed { overflow: hidden }` у passport.css);
 *  — громада показується так, щоб довкола неї було видно щонайбільше ОДИН
 *    пояс сусідніх громад. */
const PAD_OBLAST = 0.96;
const PAD_HROMADA = 0.9;

/** Рамка громади за вершинами контуру: cx/cy у файлі — точка підпису, а не
 *  центр рамки, тож для зуму її не беремо. */
function pathBox(d) {
  const n = String(d || "").match(/-?\d+(?:\.\d+)?/g);
  if (!n || n.length < 2) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) {
    const x = +n[i], y = +n[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Сусіди громад поточної області: межі в геометрії HDX мають спільні
 *  вершини, тож сусіди — ті, у кого їх щонайменше дві (одна спільна точка —
 *  лише дотик кутами). Рахуємо раз на область. */
const nbCache = new WeakMap();
function neighbors(code) {
  const geo = st.hgeom;
  if (!geo) return [];
  let nb = nbCache.get(geo);
  if (!nb) {
    const owners = new Map();                   // "x,y" -> [коди]
    for (const [c, u] of Object.entries(geo)) {
      const n = String(u.d || "").match(/-?\d+(?:\.\d+)?/g) || [];
      const seen = new Set();
      for (let i = 0; i + 1 < n.length; i += 2) {
        const k = n[i] + "," + n[i + 1];
        if (seen.has(k)) continue;
        seen.add(k);
        const arr = owners.get(k);
        if (arr) arr.push(c); else owners.set(k, [c]);
      }
    }
    const pairs = new Map();                    // "a|b" -> к-сть спільних вершин
    for (const arr of owners.values()) {
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++) {
          const k = arr[i] < arr[j] ? arr[i] + "|" + arr[j] : arr[j] + "|" + arr[i];
          pairs.set(k, (pairs.get(k) || 0) + 1);
        }
    }
    nb = new Map();
    for (const [k, cnt] of pairs) {
      if (cnt < 2) continue;
      const [a, b] = k.split("|");
      if (!nb.has(a)) nb.set(a, []);
      if (!nb.has(b)) nb.set(b, []);
      nb.get(a).push(b);
      nb.get(b).push(a);
    }
    nbCache.set(geo, nb);
  }
  return nb.get(code) || [];
}

/** Вершини кожної громади поточної області: код -> Float64Array [x0,y0,x1,y1,…]. */
const vxCache = new WeakMap();
function vertices() {
  const geo = st.hgeom;
  let vx = vxCache.get(geo);
  if (!vx) {
    vx = new Map();
    for (const [c, u] of Object.entries(geo)) {
      const n = String(u.d || "").match(/-?\d+(?:\.\d+)?/g) || [];
      vx.set(c, Float64Array.from(n, Number));
    }
    vxCache.set(geo, vx);
  }
  return vx;
}

/** Куди і наскільки зумити: {s, cx, cy} у координатах viewBox або null. */
function view() {
  if (st.hromada && st.hgeom && st.hgeom[st.hromada]) {
    const hb = pathBox(st.hgeom[st.hromada].d);
    if (!hb) return null;
    const hcx = (hb.x0 + hb.x1) / 2, hcy = (hb.y0 + hb.y1) / 2;
    const hw0 = Math.max(hb.x1 - hb.x0, 0.5), hh0 = Math.max(hb.y1 - hb.y0, 0.5);
    // найбільший масштаб, за якого громада ще вміщається цілком
    const sFit = Math.min(VB.w / hw0, VB.h / hh0) * PAD_HROMADA;

    // «Щонайбільше один пояс сусідів»: віддаляємося, доки у вікно не потрапить
    // перша вершина громади, що не є сусідньою. Вікно з центром у громаді й
    // пропорціями viewBox містить точку, якщо max(|dx|/VB.w, |dy|/VB.h) ≤ 1/(2s),
    // тож найближча така вершина прямо дає найменший допустимий масштаб.
    const vx = vertices();
    const own = new Set();
    const mine = vx.get(st.hromada) || [];
    for (let i = 0; i + 1 < mine.length; i += 2) own.add(mine[i] + "," + mine[i + 1]);
    const nb = new Set(neighbors(st.hromada));
    let dmin = Infinity;
    for (const [c, arr] of vx) {
      if (c === st.hromada || nb.has(c)) continue;
      for (let i = 0; i + 1 < arr.length; i += 2) {
        if (own.has(arr[i] + "," + arr[i + 1])) continue;   // дотик кутом до самої громади
        const d = Math.max(Math.abs(arr[i] - hcx) / VB.w, Math.abs(arr[i + 1] - hcy) / VB.h);
        if (d < dmin) dmin = d;
      }
    }
    const sRing = Number.isFinite(dmin) && dmin > 0 ? 1.02 / (2 * dmin) : 0;
    // громада лишається помітною: не дрібніша за половину свого «впритул»
    const s = Math.min(sFit, Math.max(sRing, sFit * 0.5));
    return { s, cx: hcx, cy: hcy };
  }
  if (st.oblast && st.ctx && st.ctx.oblGeo) {
    const u = st.ctx.oblGeo[st.oblast];
    if (!u) return null;
    const s = Math.min(VB.w / Math.max(u.bw, 1), VB.h / Math.max(u.bh, 1)) * PAD_OBLAST;
    return { s, cx: u.cx, cy: u.cy };
  }
  return null;
}

function currentScale() {
  const v = view();
  return v ? v.s : 1;
}

function applyTransform() {
  const z = $(".ua-zoom", st.svg);
  if (!z) return;
  const v = view();
  if (!v) {
    z.style.transform = "translate(0px, 0px) scale(1)";
    z.style.setProperty("--s", 1);
    st.svg.classList.remove("is-zoomed", "is-hzoom");
    return;
  }
  z.style.transform =
    `translate(${VB.x + VB.w / 2 - v.s * v.cx}px, ${VB.y + VB.h / 2 - v.s * v.cy}px) scale(${v.s})`;
  z.style.setProperty("--s", v.s);
  st.svg.classList.add("is-zoomed");
  st.svg.classList.toggle("is-hzoom", Boolean(st.hromada));
}

/* ── громади ───────────────────────────────────────────────────── */

/** Громада -> [сума, закладів] для поточного пакета. */
function hromadaTotals() {
  const acc = new Map();
  const prov = st.panel ? st.panel.providers : null;
  if (!prov) return acc;
  const seen = new Map();          // код -> Set(pi), щоб рахувати заклади, а не рядки
  for (const [pi, sum] of rows()) {
    const q = prov[pi];
    if (!q || q[P.OBL] !== st.oblast) continue;
    const code = q[P.HCODE];
    if (!code) continue;
    const rec = acc.get(code) || [0, 0];
    rec[0] += sum;
    acc.set(code, rec);
    let s = seen.get(code);
    if (!s) { s = new Set(); seen.set(code, s); }
    s.add(pi);
  }
  for (const [code, s] of seen) acc.get(code)[1] = s.size;
  return acc;
}

function renderHromady() {
  const g = $(".ua-hroms", st.svg);
  const gl = $(".ua-hlabels", st.svg);
  if (!g || !gl) return;
  g.textContent = "";
  gl.textContent = "";
  if (!st.oblast || !st.hgeom) return;

  const totals = hromadaTotals();
  // Громади фарбуємо КІЛЬКІСТЮ закладів, а не показником верхнього перемикача:
  // обсяги послуг і населення є лише по областях, і фарбувати ними громади
  // означало б показати число, якого немає.
  //
  // Шкала рангова, не лінійна. Розподіл по громадах украй скошений: одна
  // Вінниця на 15 закладів проти шести десятків громад з одним. За лінійною
  // шкалою 95 % громад отримували 0,07 і були нерозрізненно білими. Ранг
  // розводить їх по всьому пандусу; точне число дає підказка на кожній громаді.
  const vals = [...new Set([...totals.values()].map(v => v[1]))].sort((a, b) => a - b);
  const rank = new Map(vals.map((v, i) => [v, vals.length > 1 ? i / (vals.length - 1) : 1]));
  // найменшу громаду теж видно: пандус починаємо з 0,22, а не з нуля
  const heatOf = (n) => (0.22 + 0.78 * rank.get(n)).toFixed(3);
  const sc = currentScale();
  // у відкритій громаді повністю видно лише її та перший пояс сусідів;
  // решту приглушуємо — пропорції поля 4:3 не дають відрізати їх самим зумом
  const near = st.hromada ? new Set([st.hromada, ...neighbors(st.hromada)]) : null;

  for (const [code, u] of Object.entries(st.hgeom)) {
    const rec = totals.get(code);
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", u.d);
    const far = near && !near.has(code);
    p.setAttribute("class", "ua-hrom" + (rec ? "" : " no-data") + (far ? " is-far" : ""));
    p.style.setProperty("--heat", rec ? heatOf(rec[1]) : 0);
    p.dataset.code = code;
    p.dataset.label = u.label || "";
    const tip = rec
      ? `${u.label} громада — ${rec[1]} ${plural(rec[1], "заклад", "заклади", "закладів")}`
      : `${u.label} громада — закладів за цим пакетом немає`;
    const t = document.createElementNS(NS, "title");
    t.textContent = tip;
    p.appendChild(t);
    if (st.hromada === code) p.classList.add("is-open");
    g.appendChild(p);

    // Підпис ставимо лише тому, у кого він вміщається в габарити громади:
    // інакше 60 назв злипаються в суцільну кашу.
    const label = u.label || "";
    if (!label || far) continue;
    const w = label.length * 12 * 0.52 / sc;
    if (w > (u.bw || 0)) continue;
    const tx = document.createElementNS(NS, "text");
    tx.setAttribute("x", u.cx);
    tx.setAttribute("y", u.cy + 4 / sc);
    tx.setAttribute("class", "ua-hlabel");
    tx.textContent = label;
    gl.appendChild(tx);
  }
}

/* ── точки закладів і віяло ────────────────────────────────────── */

function places() {
  const out = new Map();
  const prov = st.panel ? st.panel.providers : null;
  if (!prov || !st.oblast) return out;
  for (const [pi, sum] of rows()) {
    const q = prov[pi];
    if (!q || q[P.OBL] !== st.oblast || q[P.X] == null) continue;
    if (st.hromada && q[P.HCODE] !== st.hromada) continue;
    const key = q[P.X] + "|" + q[P.Y];
    let rec = out.get(key);
    if (!rec) {
      rec = { x: q[P.X], y: q[P.Y], sum: 0, name: q[P.SETTLE], prov: new Map() };
      out.set(key, rec);
    }
    rec.sum += sum;
    rec.prov.set(pi, (rec.prov.get(pi) || 0) + sum);
  }
  // лічильник — УНІКАЛЬНІ заклади, а не рядки-договори
  for (const rec of out.values()) {
    rec.pis = [...rec.prov.keys()];
    rec.n = rec.pis.length;
    rec.out = rec.pis.filter(pi => !prov[pi][P.NET]).length;
  }
  return out;
}

function renderDots() {
  const g = $(".ua-dots", st.svg);
  if (!g) return;
  g.textContent = "";
  if (!st.oblast) { st.fan = null; return; }

  const prov = st.panel ? st.panel.providers : null;
  if (!prov) return;
  const pl = places();

  if (st.fan && !pl.has(st.fan)) st.fan = null;
  const sel = st.fan ? pl.get(st.fan) : null;
  const fanOut = !!sel && sel.n <= FAN_MAX;

  const maxSum = Math.max(...[...pl.values()].map(r => r.sum), 1);
  const sc = currentScale();

  for (const [key, rec] of pl) {
    const isHub = key === st.fan;
    // радіус за сумою, але точка з кількома закладами не менша за 6 px:
    // інакше лічильник у ній не вміщається
    const rBySum = 3.2 + 6.5 * Math.sqrt(rec.sum / maxSum);
    const r = Math.max(rBySum, rec.n > 1 ? 6.2 : 0) / sc;
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", rec.x);
    c.setAttribute("cy", rec.y);
    c.setAttribute("r", r);
    c.setAttribute("class", "ua-dot" + (rec.out === rec.n ? " is-out" : "") +
      (isHub ? " is-hub" : sel ? " is-muted" : ""));
    c.dataset.key = key;
    c.dataset.n = rec.n;
    c.dataset.place = rec.name;
    c.dataset.pis = rec.pis.join(",");
    const tip = document.createElementNS(NS, "title");
    tip.textContent = rec.n === 1
      ? prov[rec.pis[0]][P.NAME]
      : `${shortPlace(rec.name)} — ${rec.n} ${plural(rec.n, "заклад", "заклади", "закладів")}` +
        (rec.n > FAN_MAX ? "; забагато для віяла, усі будуть у переліку ЗОЗ"
                         : isHub ? "; натисніть, щоб згорнути"
                         : "; натисніть, щоб розкрити");
    c.appendChild(tip);
    g.appendChild(c);

    if (rec.n > 1) {
      const n = document.createElementNS(NS, "text");
      n.setAttribute("x", rec.x);
      n.setAttribute("y", rec.y + 3.4 / sc);
      n.setAttribute("class", "ua-dotn" + (sel && !isHub ? " is-muted" : ""));
      n.textContent = rec.n;
      g.appendChild(n);
    }
  }

  const fanR = fanOut ? renderFan(g, sel, sc, prov) : 0;
  st.fanNew = false;

  // підписи найбільших населених пунктів
  const top = [...pl.values()].sort((a, b) => b.sum - a.sum).slice(0, 8);
  const placed = [];
  for (const rec of top) {
    if (rec === sel) continue;            // вибране місто підписуємо окремо
    if (placed.some(q => Math.hypot(q[0] - rec.x, q[1] - rec.y) < 26 / sc)) continue;
    placed.push([rec.x, rec.y]);
    addPlaceLabel(g, rec, (8 + 6.5 * Math.sqrt(rec.sum / maxSum)) / sc, sel ? " is-muted" : "");
  }
  if (sel) {
    addPlaceLabel(g, sel,
      (fanOut ? fanR + 9 : 8 + 6.5 * Math.sqrt(sel.sum / maxSum)) / sc, " is-open");
  }
  renderLamp();
}

/* Лампочка на місці відкритого закладу (21.09.2026): користувач бачив на місці
   закладу пульсуючий квадрат — підсвітку дотику браузера навколо кружка — і чекав
   на мигаючу лампочку. Тепер підсвітку вимкнено (passport.css), а на вибраному
   закладі горить кільце, що розходиться хвилями, поки відкрито паспорт закладу. */
function renderLamp() {
  const g = $(".ua-dots", st.svg);
  if (!g) return;
  $$(".ua-lamp", g).forEach(n => n.remove());
  if (!st.pick || !st.oblast) return;
  const sc = currentScale();
  const lamp = document.createElementNS(NS, "g");
  lamp.setAttribute("class", "ua-lamp");
  lamp.setAttribute("pointer-events", "none");
  const r = st.pick.r + 2.5 / sc;
  for (const cls of ["ua-lamp-glow", "ua-lamp-wave", "ua-lamp-wave is-late", "ua-lamp-ring"]) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", st.pick.x);
    c.setAttribute("cy", st.pick.y);
    c.setAttribute("r", r);
    c.setAttribute("class", cls);
    lamp.appendChild(c);
  }
  g.appendChild(lamp);
}

/** Засвітити лампочку на точці/листку (el) або погасити (null). */
function setPick(el) {
  st.pick = el ? { x: +el.getAttribute("cx"), y: +el.getAttribute("cy"), r: +el.getAttribute("r") || 0 } : null;
  renderLamp();
}

function addPlaceLabel(g, rec, dy, extra) {
  const t = document.createElementNS(NS, "text");
  t.setAttribute("x", rec.x);
  t.setAttribute("y", rec.y - dy);
  t.setAttribute("class", "ua-plabel" + extra);
  t.textContent = shortPlace(rec.name);
  g.appendChild(t);
}

/** Розкладка віяла: кільця навколо точки. Зсуви — в екранних px. */
function fanLayout(n) {
  const STEP = 13.5;                 // мінімальна відстань між листками по дузі
  const out = [];
  let i = 0, ring = 0;
  while (i < n) {
    const R = 20 + ring * 15;
    const cap = Math.max(6, Math.round(2 * Math.PI * R / STEP));
    const take = Math.min(cap, n - i);
    // сусідні кільця зсуваємо на півкроку, інакше листки стають у стовпчики
    const a0 = -Math.PI / 2 + (ring % 2 ? Math.PI / take : 0);
    for (let k = 0; k < take; k++) {
      const a = a0 + 2 * Math.PI * k / take;
      out.push([Math.cos(a) * R, Math.sin(a) * R]);
    }
    i += take;
    ring++;
  }
  return out;
}

function renderFan(g, rec, sc, prov) {
  const anim = st.fanNew;
  const list = [...rec.prov.entries()].sort((a, b) => b[1] - a[1]);
  const offs = fanLayout(list.length);
  const maxS = Math.max(...list.map(r => r[1]), 1);

  const rays = document.createElementNS(NS, "g");   // промені під листками
  g.appendChild(rays);

  list.forEach(([pi, sum], k) => {
    const [dx, dy] = offs[k];
    const lx = rec.x + dx / sc, ly = rec.y + dy / sc;

    const ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", rec.x); ln.setAttribute("y1", rec.y);
    ln.setAttribute("x2", lx);    ln.setAttribute("y2", ly);
    ln.setAttribute("class", "ua-ray" + (anim ? "" : " is-vis"));
    rays.appendChild(ln);

    const q = prov[pi];
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", lx);
    c.setAttribute("cy", ly);
    c.setAttribute("r", (2.8 + 3.0 * Math.sqrt(sum / maxS)) / sc);
    c.setAttribute("class", "ua-dot ua-leaf" + (!q[P.NET] ? " is-out" : "") +
      (anim ? "" : " is-vis"));
    c.dataset.pi = String(pi);
    c.dataset.edrpou = q[P.EDRPOU];
    const tip = document.createElementNS(NS, "title");
    tip.textContent = `${q[P.NAME]} · ЄДРПОУ ${q[P.EDRPOU]}` +
      (q[P.NET] ? "" : " · поза спроможною мережею");
    c.appendChild(tip);
    // при розкритті стартуємо в центрі — у rAF зсув знімається і листок вилітає
    if (anim) c.style.transform = `translate(${-dx / sc}px, ${-dy / sc}px)`;
    g.appendChild(c);
  });

  requestAnimationFrame(() => {
    $$(".ua-leaf, .ua-ray", g).forEach(d => d.classList.add("is-vis"));
    $$(".ua-leaf", g).forEach(d => { d.style.transform = ""; });
  });

  return Math.max(...offs.map(o => Math.hypot(o[0], o[1])), 0);
}

/* ── перехід між щаблями ───────────────────────────────────────── */

async function zoomTo(oblast, opt) {
  opt = opt || {};
  if (st.busy) return;
  st.busy = true;
  try {
    const sameObl = oblast === st.oblast;
    st.oblast = oblast;
    st.hromada = opt.hromada || null;
    st.fan = null;
    st.pick = null;

    if (oblast) {
      const d = await ensurePanel();
      if (!d) { st.oblast = null; return; }        // без даних щаблів не буде
      if (!sameObl || !st.hgeom) st.hgeom = await loadHromady(oblast);
      // поки вантажилося, користувач міг клікнути іншу область
      if (st.oblast !== oblast) return;
    } else {
      st.hgeom = null;
    }

    applyTransform();
    renderHromady();
    renderDots();
    updateBar();
  } finally {
    st.busy = false;
  }
  notify();
}

/** Щабель карти → панель «Як працює пакет» (analytics-panel.js): сходи над
 *  картою мусять показувати те саме, що вибрано на карті. */
function notify() {
  if (!st.ctx || !st.ctx.onScope) return;
  let place = null;
  if (st.fan && st.panel) {
    const [x, y] = st.fan.split("|").map(Number);
    const q = st.panel.providers.find(p => p && p[P.X] === x && p[P.Y] === y && p[P.OBL] === st.oblast);
    place = q ? q[P.SETTLE] : null;
  }
  st.ctx.onScope({ oblast: st.oblast, hromada: st.hromada, fan: st.fan, place });
}

/** Розкрити (key = "x|y") або згорнути (null) віяло ззовні — з панелі. */
function openFan(key) {
  if (!st.oblast) return;
  st.fan = key || null;
  st.fanNew = Boolean(key);
  renderDots();
}

function updateBar() {
  const bar = document.getElementById("mapDrill");
  if (!bar) return;
  bar.hidden = !st.oblast;
  const cap = document.getElementById("mapDrillWhere");
  if (!cap) return;
  if (!st.oblast) { cap.textContent = ""; return; }
  const hr = st.hromada && st.hgeom && st.hgeom[st.hromada];
  cap.textContent = hr
    ? `${hr.label} громада · клік по точці розкриє заклади міста`
    : "заливка громад — скільки закладів; клік по громаді глибше, " +
      "клік по точці — заклади міста";
}

function back() {
  if (st.fan) { st.fan = null; renderDots(); notify(); return; }
  if (st.hromada) { zoomTo(st.oblast, { hromada: null }); return; }
  if (st.oblast) zoomTo(null);
}

/* ── дрібні помічники ──────────────────────────────────────────── */

const PR = new Intl.PluralRules("uk-UA");
function plural(n, one, few, many) {
  const f = PR.select(n);
  return f === "one" ? one : f === "few" ? few : many;
}
function shortPlace(s) {
  return String(s || "").replace(/^(м\.|с\.|смт|с-ще)\s*/i, "")
    .replace(/^(.)(.*)$/, (m, a, b) => a + b.toLowerCase());
}

/* ── підключення до карти паспорта ─────────────────────────────── */

/** Викликається з drawRegionMap() після кожного перемальовування SVG:
 *  карта могла перебудуватися через зміну пакета або режиму, тому стан
 *  щаблів накладаємо на свіжий SVG наново. */
function attach(svg, ctx) {
  if (!svg) return;
  const pkgChanged = ctx && String(ctx.pkg) !== String(st.pkg);
  st.svg = svg;
  st.ctx = ctx || {};
  if (ctx) st.pkg = ctx.pkg;
  // зміна пакета скидає щаблі: у іншому пакеті інші заклади й інші громади
  if (pkgChanged) { st.oblast = null; st.hromada = null; st.fan = null; st.hgeom = null; }

  wire(svg);
  applyTransform();
  renderHromady();
  renderDots();
  updateBar();
}

let wiredBar = false;

function wire(svg) {
  if (svg.dataset.drillWired) return;
  svg.dataset.drillWired = "1";

  svg.addEventListener("click", e => {
    const leaf = e.target.closest(".ua-leaf");
    if (leaf) {
      e.stopPropagation();
      $$(".ua-leaf", svg).forEach(d => d.classList.toggle("is-picked", d === leaf));
      setPick(leaf);
      // індекс закладу передаємо поряд із кодом: у ФОП код — літерал «ФОП»,
      // і пошук за ним знаходив усіх ФОП пакета одразу
      if (st.ctx.pickProvider) st.ctx.pickProvider(leaf.dataset.edrpou, +leaf.dataset.pi);
      return;
    }
    const dot = e.target.closest(".ua-dot");
    if (dot) {
      e.stopPropagation();
      const pis = (dot.dataset.pis || "").split(",").filter(Boolean);
      if (dot.classList.contains("is-hub")) { st.fan = null; renderDots(); notify(); return; }
      if (pis.length === 1) {
        setPick(dot);
        if (st.ctx.pickProvider) {
          const prov = st.panel.providers[+pis[0]];
          st.ctx.pickProvider(prov[P.EDRPOU], +pis[0]);
        }
        return;
      }
      st.fan = dot.dataset.key;
      st.fanNew = true;
      renderDots();
      notify();
      return;
    }
    const hrom = e.target.closest(".ua-hrom");
    if (hrom) {
      e.stopPropagation();
      zoomTo(st.oblast, { hromada: st.hromada === hrom.dataset.code ? null : hrom.dataset.code });
      return;
    }
    // клік по області обробляє passport.js (фільтр переліку ЗОЗ), а зум
    // вішаємо тут, щоб не переплітати два обробники в одному місці
    const obl = e.target.closest(".ua-obl:not(.no-data)");
    if (obl && obl.dataset.oblast !== st.oblast) zoomTo(obl.dataset.oblast);
  });

  if (!wiredBar) {
    wiredBar = true;
    const b = document.getElementById("mapDrillBack");
    if (b) b.addEventListener("click", back);
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape" || !st.oblast) return;
      const card = document.querySelector(".map-card");
      if (!card || card.offsetParent === null) return;   // вкладку не видно
      back();
    });
  }
}

window.MapDrill = { attach, back, zoomTo, openFan, ensurePanel, clearPick: () => setPick(null),
  get state() { return st; } };
})();
