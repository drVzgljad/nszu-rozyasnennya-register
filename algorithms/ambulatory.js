/* Кодування амбулаторки (пакет 9).

   Дані — algorithms/data/ambulatory_9.json, зібрані build_ambulatory.py із
   додатків до листів НСЗУ. Сторінка нічого не додумує: усе, що показано,
   має джерело — id документа в розділі роз'яснень, аркуш і номер рядка.

   Чинний шар (лист 2026 року з Додатками 1 і 2) лежить у records.
   Застереження попередніх листів — у flags, ключ — код інтервенції. */

const state = {
  data: null,
  visible: [],
  selected: null,
  odk: "",
};

const byId = (id) => document.getElementById(id);
const norm = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();

function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function highlight(value, query) {
  const safe = esc(value);
  if (!query || query.length < 2) return safe;
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

function formatDate(value) {
  if (!value) return "";
  const [y, m, d] = String(value).split("-");
  return d ? `${d}.${m}.${y}` : value;
}

/* Куди веде код. Розрізняємо за формою: 11700-00 — інтервенція НК 026,
   T67002 — код послуги ЕСОЗ, 718-7 — LOINC, E11.9 — діагноз НК 025. */
function codeKind(code) {
  if (/^\d{4,5}-\d{2}$/.test(code)) return "achi";
  if (/^\d{3,6}-\d$/.test(code)) return "loinc";
  if (/^[A-ZА-ЯІЇЄҐ]\d{5}$/.test(code)) return "esoz";
  if (/^[A-Z]\d{2}(\.\d{1,2})?$/.test(code)) return "icd";
  if (/^[PР]\d{1,3}$/.test(code)) return "position";
  return "";
}

function codeHref(code) {
  const q = encodeURIComponent(code);
  switch (codeKind(code)) {
    case "achi": return `../classifiers/nk026.html?q=${q}`;
    case "loinc": return `../classifiers/loinc.html?q=${q}`;
    case "icd": return `../classifiers/index.html?q=${q}`;
    case "esoz": return `../mapping/index.html?q=${q}`;
    default: return null;
  }
}

function codeBadge(code, title) {
  const href = codeHref(code);
  const label = `<span class="code-badge" title="${esc(title || "")}">${esc(code)}</span>`;
  if (!href) return label;
  return `<span class="code-badge-pair">${label}<a class="code-badge-open" href="${href}"
    target="_blank" rel="noopener" title="Відкрити код у класифікаторі">↗</a></span>`;
}

const docHref = (docId) => `../rozjasnennya/index.html?doc=${docId}`;
const blockHref = (docId, block) => `../rozjasnennya/index.html?doc=${docId}&b=${block}`;

/* ── шапка й довідкові панелі ───────────────────────────────── */
function renderStats() {
  const { totals, basis, services } = state.data;
  byId("ambStats").innerHTML = [
    [totals.records, "рядків правил"],
    [totals.codes, "унікальних кодів"],
    [totals.flagged, "кодів із застереженням"],
    [services.length, "сервісів"],
    [formatDate(basis.letter.date) || "—", "чинний лист"],
  ].map(([value, label]) =>
    `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join("");
}

function renderBasis() {
  const { letter, attachments } = state.data.basis;
  const card = (item) => `<a class="source-card" href="${docHref(item.doc)}">
      <strong>${esc(item.role)}</strong>
      <span>${esc(item.title)}</span>
      <em>${esc([item.number ? `№ ${item.number}` : "", formatDate(item.date),
                 item.rows ? `${item.rows} рядків у ${item.tables} таблицях` : ""]
        .filter(Boolean).join(" · "))}</em>
    </a>`;
  byId("ambBasis").innerHTML = [letter, ...attachments].map(card).join("");
}

function renderLegend() {
  byId("ambFlagLegend").innerHTML = state.data.flag_catalogue.map((flag) => `
    <div class="amb-legend-item">
      <span class="algorithm-pill amb-flag amb-flag--${esc(flag.key)}">${esc(flag.title)}</span>
      <span class="amb-legend-count">${flag.count} кодів</span>
      <p>${esc(flag.note)}</p>
      <a href="${docHref(flag.source.doc)}">${esc(flag.source.title.slice(0, 110))}</a>
    </div>`).join("");
}

function renderRules() {
  byId("ambRules").innerHTML = state.data.rules.map((rule) => `
    <details class="amb-rule">
      <summary>
        <span class="amb-rule-state amb-rule-state--${rule.state === "чинне" ? "live" : "old"}">${esc(rule.state)}</span>
        ${esc(rule.headline)}
        <em>${esc([rule.number ? `№ ${rule.number}` : "", formatDate(rule.date),
          rule.effective_from && rule.effective_from !== rule.date
            ? `діє з ${formatDate(rule.effective_from)}` : ""].filter(Boolean).join(" · "))}</em>
      </summary>
      <ol class="amb-rule-items">
        ${rule.items.map((item) => `<li>${esc(item.text)}
          <a class="amb-rule-anchor" href="${blockHref(rule.doc, item.b)}"
             title="Відкрити цей абзац у першоджерелі">→ у листі</a></li>`).join("")}
      </ol>
    </details>`).join("");
}

/* ── фільтри ────────────────────────────────────────────────── */
function fillFilters() {
  byId("ambService").innerHTML = '<option value="">Усі сервіси</option>' +
    state.data.services.map((s) =>
      `<option value="${esc(s.key)}">${esc(s.name)} (${s.count})</option>`).join("");
  byId("ambFlag").innerHTML = '<option value="">Будь-які</option>' +
    '<option value="*">Лише з застереженнями</option>' +
    state.data.flag_catalogue.map((f) =>
      `<option value="${esc(f.key)}">${esc(f.title)} (${f.count})</option>`).join("");
  fillClasses();
}

function fillClasses() {
  const service = byId("ambService").value;
  const source = state.data.services.filter((s) => !service || s.key === service);
  const classes = new Map();
  source.forEach((s) => s.classes.forEach(([name, count]) =>
    classes.set(name, (classes.get(name) || 0) + count)));
  const current = byId("ambClass").value;
  byId("ambClass").innerHTML = '<option value="">Усі класи</option>' +
    [...classes.entries()].sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `<option value="${esc(name)}">${esc(name)} (${count})</option>`).join("");
  if ([...classes.keys()].includes(current)) byId("ambClass").value = current;
}

/* Збірка вже звела застереження і за кодом інтервенції, і за кодами
   спостереження (поле on). Падаємо на пошук за кодом лише для сумісності
   зі старим файлом даних. */
function flagsOf(record) {
  return record.flags || state.data.flags[record.code] || [];
}

function haystack(record) {
  if (record._h) return record._h;
  record._h = norm([record.code, record.name, record.class, record.report_code,
    record.report_name, record.obs_name, record.note, record.pos_name, record.dx_name,
    (record.obs || []).join(" "), (record.pos || []).join(" "),
    (record.dx || []).join(" "), (record.odk || []).join(" ")].filter(Boolean).join(" "));
  return record._h;
}

function apply() {
  const query = norm(byId("ambSearch").value);
  const service = byId("ambService").value;
  const klass = byId("ambClass").value;
  const flag = byId("ambFlag").value;

  state.visible = state.data.records.filter((record) => {
    if (state.odk && !(record.odk || []).includes(state.odk)) return false;
    if (service && record.sv !== service) return false;
    if (klass && (record.class || "—") !== klass) return false;
    if (flag) {
      const own = flagsOf(record);
      if (flag === "*" ? !own.length : !own.some((f) => f.key === flag)) return false;
    }
    return !query || haystack(record).includes(query);
  });

  // Фільтр за ОДК ставиться з бічної панелі, а не з випадайки, тому його
  // видно тільки тут: без цього «Знайдено 96» виглядає як збій пошуку.
  const odkTag = state.odk ? ` · ОДК ${state.odk}` : "";
  byId("ambCount").textContent = state.visible.length
    ? `Знайдено ${state.visible.length}${odkTag}`
    : `Нічого не знайдено${odkTag}`;
  document.querySelectorAll("#ambOdk details.amb-odk").forEach((item) => {
    item.classList.toggle("amb-odk--active", item.dataset.odk === state.odk);
  });
  byId("mobileCount").textContent = state.visible.length ? `(${state.visible.length})` : "";
  renderCards(query);
}

/* ── ОДК і посади: голий код нічого не каже ─────────────────────────
   У додатку ОДК стоїть номером («9»), а посада — кодом («P157»). Щоб
   зрозуміти рядок, доводилося тримати два довідники в іншій вкладці.
   Назви тепер приходять у даних, а переліки діагнозів довантажуються
   з mapping/data/odk.json лише тоді, коли ОДК справді розкрили. */

const odkInfo = (value) => (state.data.odk_names || {})[value] || null;
const posName = (code) => (state.data.pos_names || {})[code] || "";

function odkBadge(value) {
  const info = odkInfo(value);
  const title = info ? `${info.id} — ${info.name}` : "У довіднику ОДК такого номера немає";
  return `<span class="code-badge${info ? " code-badge--known" : ""}" title="${esc(title)}">${esc(value)}</span>`;
}

let odkCodesCache = null;
async function loadOdkCodes() {
  if (!odkCodesCache) {
    const response = await fetch("../mapping/data/odk.json");
    const list = await response.json();
    odkCodesCache = {};
    list.forEach((entry) => { odkCodesCache[entry.id] = entry.codes || []; });
  }
  return odkCodesCache;
}

function renderOdkPanel() {
  const host = byId("ambOdk");
  if (!host) return;
  const names = state.data.odk_names || {};
  const counts = {};
  state.data.records.forEach((record) => {
    (record.odk || []).forEach((value) => { counts[value] = (counts[value] || 0) + 1; });
  });
  const listed = Object.keys(names).sort((a, b) => Number(a) - Number(b));
  if (!listed.length) { host.innerHTML = ""; return; }

  host.innerHTML = listed.map((value) => {
    const info = names[value];
    return `<details class="amb-odk" data-odk="${esc(value)}">
      <summary>
        <span class="code-badge code-badge--known">${esc(value)}</span>
        <span class="amb-odk-name">${esc(info.name)}</span>
        <em>${counts[value] || 0} рядків</em>
      </summary>
      <div class="amb-odk-body">
        <p class="amb-dim">${esc(info.id)} · ${info.codes} діагнозів у довіднику</p>
        <div class="amb-odk-codes">Завантажую…</div>
        <button class="action" type="button" data-odk-filter="${esc(value)}">Показати рядки з цим ОДК</button>
      </div>
    </details>`;
  }).join("");

  host.querySelectorAll("details.amb-odk").forEach((details) => {
    details.addEventListener("toggle", async () => {
      if (!details.open || details.dataset.loaded) return;
      details.dataset.loaded = "1";
      const info = names[details.dataset.odk];
      const box = details.querySelector(".amb-odk-codes");
      try {
        const all = await loadOdkCodes();
        const ids = info.ids || [info.id];
        const codes = ids.flatMap((id) => all[id] || []);
        box.innerHTML = codes.length
          ? codes.map((code) => `<a class="code-badge" href="../classifiers/index.html?q=${encodeURIComponent(code)}"
              target="_blank" rel="noopener">${esc(code)}</a>`).join(" ")
          : '<span class="amb-dim">Перелік діагнозів для цього ОДК у довіднику відсутній.</span>';
      } catch (error) {
        box.innerHTML = '<span class="amb-dim">Не вдалося завантажити перелік діагнозів.</span>';
        console.error(error);
      }
    });
  });

  host.querySelectorAll("[data-odk-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      byId("ambSearch").value = "";
      byId("ambService").value = "";
      byId("ambFlag").value = "";
      fillClasses();
      state.odk = button.dataset.odkFilter;
      apply();
      if (window.matchMedia("(max-width: 1180px)").matches) setTab("results");
    });
  });
}

/* ── скільки послуга важить в оплаті (пункт 62 Порядку) ─────
   Пакет 9 не має ціни за інтервенцію: тариф — глобальна ставка на місяць.
   Тому рахуємо чесно: ставка × коефіцієнт класу — це внесок ОДНІЄЇ послуги
   у річний розрахунок ставки, і 1/12 від нього — у ставку на місяць.
   Ніде не пишемо «тариф за послугу», бо такого в пакеті 9 не існує. */

/* Дзеркало norm_key() з tariff_p62.py. Міняти треба обидві разом. */
function normKey(value) {
  return String(value || "").toLowerCase()
    .replace(/[\u2019\u02bc`]/g, "'")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

const money = (value) => value.toLocaleString("uk-UA",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const coefText = (value) => String(value).replace(".", ",");

/* → {kind, coef|options, amount, basis, note} або null, якщо блоку тарифу немає */
function tariffFor(record) {
  const t = state.data.tariff;
  if (!t) return null;
  const cls = normKey(record.class);

  const ambiguous = t.ambiguous && t.ambiguous[cls];
  if (ambiguous) {
    return {
      kind: "ambiguous",
      options: ambiguous.options.map((pair) => ({
        label: pair[0], coef: pair[1], amount: t.rate * pair[1],
      })),
      basis: (t.by_service[record.sv] || {}).caption || "",
      note: ambiguous.note,
    };
  }

  if (record.sv === "lab") {
    const lab = t.by_service.lab || {};
    const raw = normKey(record.category);
    const category = (lab.alias || {})[raw] || raw;
    const special = (lab.special || {})[category];
    if (special) return { kind: "special", basis: lab.caption, note: special };

    const coef = ((lab.matrix || {})[cls] || {})[category];
    if (coef === undefined) {
      return {
        kind: "unknown",
        basis: lab.caption,
        note: record.category
          ? "Для напряму «" + record.class + "» пункт 62 не називає коефіцієнта за категорією «"
            + record.category + "»."
          : "Додаток 2 не зазначає категорії дослідження, тому коефіцієнт пункту 62 "
            + "не визначається однозначно.",
      };
    }
    const exception = (lab.exceptions || {})[cls];
    let note = "";
    if (exception && category === "високоспецифічний") {
      note = "Пункт 62 виводить із цієї категорії " + exception.count
        + " окремих досліджень з коефіцієнтами від " + coefText(exception.min)
        + " до " + coefText(exception.max)
        + ". У Порядку вони названі текстом дослідження, а не кодом, тому звіряйте за переліком.";
    } else if (lab.note && cls === "інші") {
      note = lab.note;
    }
    return {
      kind: "value",
      coef,
      amount: t.rate * coef,
      /* показуємо категорію, за якою реально взято коефіцієнт: у додатку 2
         трапляється написання «Високоспецифчний», і воно виглядало б як наша описка */
      basis: lab.caption + " · " + record.class + " · " + category,
      note,
    };
  }

  const entry = t.by_service[record.sv];
  const coef = entry && entry.classes ? entry.classes[cls] : undefined;
  if (coef === undefined) {
    return {
      kind: "unknown",
      basis: (entry || {}).caption || "",
      note: record.class
        ? "Класу «" + record.class + "» у таблицях пункту 62 немає."
        : "Додаток 1 не зазначає класу, тому коефіцієнт пункту 62 не визначається.",
    };
  }
  return {
    kind: "value",
    coef,
    amount: t.rate * coef,
    basis: entry.caption + " · " + record.class,
    note: "",
  };
}

function tariffSource(t) {
  return '<p class="amb-tariff-source"><a href="' + t.source.href + '">Пункт '
    + esc(t.source.point) + ' Порядку</a> · ставка на медичну послугу ' + money(t.rate)
    + ' грн · <a href="' + t.source.compare_href + '">коефіцієнти 2025 ↔ 2026</a></p>';
}

function tariffBlock(record) {
  const t = state.data.tariff;
  const calc = tariffFor(record);
  if (!t || !calc) return "";
  const head = '<div class="amb-section-title">Скільки це важить в оплаті</div>';

  if (calc.kind === "value") {
    return head + '<div class="amb-tariff">'
      + '<div class="amb-tariff-sum"><b>' + money(calc.amount) + ' грн</b>'
      + '<span>= ' + money(t.rate) + ' × ' + coefText(calc.coef) + '</span></div>'
      + '<div class="amb-tariff-grid">'
      + row("Коефіцієнт класу", '<b>' + coefText(calc.coef) + '</b> <span class="amb-dim">'
          + esc(calc.basis) + '</span>')
      + row("Внесок у річний розрахунок", money(calc.amount) + ' грн за одну послугу '
          + esc(t.base_year) + ' року')
      + row("У ставці на місяць", money(calc.amount / 12) + ' грн')
      + '</div>'
      + (calc.note ? '<p class="amb-tariff-note">' + esc(calc.note) + '</p>' : "")
      + '<p class="amb-tariff-caveat">' + esc(t.caveat) + '</p>'
      + tariffSource(t) + '</div>';
  }

  if (calc.kind === "ambiguous") {
    const options = calc.options.map((option) =>
      '<div class="amb-tariff-sum amb-tariff-sum--alt"><b>' + money(option.amount) + ' грн</b>'
      + '<span>' + esc(option.label) + ' · = ' + money(t.rate) + ' × '
      + coefText(option.coef) + '</span></div>').join("");
    return head + '<div class="amb-tariff">' + options
      + '<p class="amb-tariff-note">' + esc(calc.note) + '</p>'
      + '<p class="amb-tariff-caveat">' + esc(t.caveat) + '</p>'
      + tariffSource(t) + '</div>';
  }

  return head + '<div class="amb-tariff amb-tariff--muted">'
    + '<p class="amb-tariff-note">' + esc(calc.note) + '</p>'
    + tariffSource(t) + '</div>';
}

/* Коротка мітка для картки списку: «×3,8 · 589,00 ₴» */
function tariffPill(record) {
  const calc = tariffFor(record);
  if (!calc || calc.kind !== "value") return "";
  const hint = money(state.data.tariff.rate) + " грн × " + coefText(calc.coef)
    + " — внесок однієї послуги у річний розрахунок глобальної ставки";
  return '<span class="amb-tariff-pill" title="' + esc(hint) + '">×'
    + coefText(calc.coef) + ' · ' + money(calc.amount) + ' ₴</span>';
}

function renderTariffPanel() {
  const t = state.data.tariff;
  const host = byId("ambTariff");
  if (!host) return;
  if (!t) { host.innerHTML = ""; return; }
  host.innerHTML = '<p class="amb-tariff-formula">' + esc(t.formula) + '</p>'
    + '<div class="amb-tariff-grid">'
    + row("Ставка на медичну послугу", '<b>' + money(t.rate) + ' грн</b>')
    + row("База розрахунку", 'обсяги ' + esc(t.base_year) + ' року за даними ЕСОЗ')
    + '</div>'
    + '<p class="amb-tariff-caveat">' + esc(t.caveat) + '</p>'
    + '<p class="amb-tariff-source"><a href="' + t.source.href + '">'
    + esc(t.source.chapter) + ', пункт ' + esc(t.source.point) + '</a> · '
    + '<a href="' + t.source.compare_href + '">коефіцієнти 2025 ↔ 2026</a></p>';
}

/* ── список ─────────────────────────────────────────────────── */
const SERVICE_NAME = {};

function renderCards(query) {
  const cards = state.visible.slice(0, 400).map((record) => {
    const own = flagsOf(record);
    const pills = own.map((f) => {
      const meta = state.data.flag_catalogue.find((c) => c.key === f.key);
      return `<span class="algorithm-pill amb-flag amb-flag--${esc(f.key)}">${esc(meta ? meta.title : f.key)}</span>`;
    }).join("");
    return `<button class="algorithm-card${state.selected === record.i ? " active" : ""}"
        type="button" data-index="${record.i}">
      <div class="algorithm-card-header">
        <span class="algorithm-code">${highlight(record.code, query)}</span>
        <em>${esc(SERVICE_NAME[record.sv] || record.sv)}${record.class ? ` · ${esc(record.class)}` : ""}</em>
      </div>
      <div class="algorithm-card-main">
        <strong>${highlight(record.name || record.dx_name || "—", query)}</strong>
        ${pills || tariffPill(record) ? `<div class="amb-pill-row">${pills}${tariffPill(record)}</div>` : ""}
      </div>
    </button>`;
  }).join("");

  byId("ambCards").innerHTML = cards || emptyHint(query);
  if (state.visible.length > 400) {
    byId("ambCards").insertAdjacentHTML("beforeend",
      `<p class="amb-more">Показано перші 400 із ${state.visible.length}. Звузьте пошук.</p>`);
  }
  byId("ambCards").querySelectorAll("[data-index]").forEach((button) =>
    button.addEventListener("click", () => select(Number(button.dataset.index))));
}

/* Порожня видача — це теж відповідь. Код, який лежить у переліку застережень,
   але якого немає в чинних таблицях 2026 року, — окремий випадок: він не
   «не знайдений», а виведений із чинних переліків. Мовчати про це не можна:
   саме через такі коди й виникають питання «чому не оплатили». */
function emptyHint(query) {
  const code = (query || "").toUpperCase().trim();
  const own = state.data.flags[code] || state.data.flags[query] || [];
  if (!own.length) {
    return '<p class="reader-empty">Нічого не знайдено. Спробуйте інший код або зніміть фільтри.</p>';
  }
  const lines = own.map((f) => {
    const meta = state.data.flag_catalogue.find((c) => c.key === f.key) || {};
    return `<li><b>${esc(meta.title || f.key)}</b> — ${esc(f.detail || meta.note || "")}
      <a href="${docHref((meta.source || {}).doc)}">джерело</a></li>`;
  }).join("");
  return `<div class="amb-warn">
    <span class="algorithm-pill amb-flag">Немає в чинних переліках 2026 року</span>
    <p>Коду <b>${esc(query)}</b> немає в Додатках 1–2 до чинного листа, але він згадується
       в застереженнях попередніх листів:</p>
    <ul class="amb-rule-items">${lines}</ul></div>`;
}

/* ── паспорт коду ───────────────────────────────────────────── */
function row(label, value) {
  if (!value || (Array.isArray(value) && !value.length)) return "";
  const body = Array.isArray(value) ? value.join(" ") : value;
  return `<div class="amb-row"><span class="amb-row-label">${esc(label)}</span>
    <span class="amb-row-value">${body}</span></div>`;
}

function select(index) {
  state.selected = index;
  const record = state.data.records[index];
  const own = flagsOf(record);
  const source = state.data.basis.attachments.find((a) => a.doc === record.src.doc)
    || state.data.basis.letter;

  /* Перелік діагнозів у класі «Консультування» буває на дві сотні кодів —
     розгорнутим він з'їдає всю панель, тож ховаємо хвіст під розкривачку. */
  const badges = (record.dx || []).map((code) => {
    const odk = state.data.odk23[code];
    return codeBadge(code, odk ? `${odk.name} · ОДК ${odk.mdc}` : "");
  });
  const VISIBLE = 24;
  const diagnoses = badges.length <= VISIBLE ? badges.join(" ")
    : `${badges.slice(0, VISIBLE).join(" ")}
       <details class="amb-more-codes"><summary>ще ${badges.length - VISIBLE}</summary>
       ${badges.slice(VISIBLE).join(" ")}</details>`;

  const flagBlock = own.length ? `
    <div class="amb-section-title">Застереження, які діють на цей код</div>
    ${own.map((f) => {
      const meta = state.data.flag_catalogue.find((c) => c.key === f.key) || {};
      /* У переліках-джерелах другий стовпець — це назва інтервенції. Коли вона
         збігається з назвою коду, повторювати її нема сенсу: показуємо, що
         означає сам прапорець. Причина неоплати — навпаки, завжди по суті. */
      const detail = norm(f.detail) && norm(f.detail) !== norm(record.name)
        ? f.detail : meta.note;
      /* Заборона без дати — половина відповіді. Якщо код при цьому є в
         переліку 2025 року, це майже завжди означає, що заборона з додатка
         2023-го вже не діяла. Кажемо це прямо, але як довід, а не як вирок. */
      const dated = f.key === "not_paid" && record.seen_2025 && state.data.layer_2025
        ? `<p class="amb-resolved">Цей код є і в переліку ${esc(state.data.layer_2025.letter)},
             і в чинному переліку 2026 — застереження 2023 року, найпевніше, вже не діє.
             Рішення за експертом: самого листа НСЗУ не публікувала.</p>` : "";
      return `<div class="amb-warn">
        <span class="algorithm-pill amb-flag amb-flag--${esc(f.key)}">${esc(meta.title || f.key)}</span>
        ${f.on ? `<span class="amb-dim">на коді спостереження ${esc(f.on)}</span>` : ""}
        <p>${esc(detail || "")}</p>
        ${dated}
        <a href="${docHref((meta.source || {}).doc)}">Джерело: ${esc((meta.source || {}).title || "")}</a>
      </div>`;
    }).join("")}` : "";

  byId("ambReader").classList.remove("reader-empty");
  byId("ambReader").innerHTML = `
    <h2>${esc(record.code)}</h2>
    <p class="amb-name">${esc(record.name || record.dx_name || "")}</p>
    <div class="algorithm-meta">
      <span class="algorithm-pill">${esc(SERVICE_NAME[record.sv] || record.sv)}</span>
      ${record.class ? `<span class="algorithm-pill">${esc(record.class)}</span>` : ""}
      ${record.category ? `<span class="algorithm-pill">${esc(record.category)}</span>` : ""}
      ${record.change ? `<span class="algorithm-pill algorithm-pill--change">${esc(record.change)}</span>` : ""}
    </div>
    ${row("Група", record.group ? esc(record.group) : "")}
    ${row("Код діагностичного звіту", record.report_code
      ? `${codeBadge(record.report_code)} ${esc(record.report_name || "")}` : "")}
    ${row("Коди спостереження", (record.obs || []).length
      ? `${(record.obs || []).map((c) => codeBadge(c)).join(" ")} <span class="amb-dim">${esc(record.obs_name || "")}</span>` : "")}
    ${row("ОДК", (record.odk || []).map((c) => odkBadge(c)).join(" "))}
    ${row("Діагнози", diagnoses)}
    ${row("Посади", (record.pos || []).map((c) => {
      const name = posName(c);
      return `<span class="code-badge${name ? " code-badge--known" : ""}"
        title="${esc(name || "Назви посади в довіднику немає")}">${esc(c)}</span>`;
    }).join(" ") + (record.pos_name ? ` <span class="amb-dim">${esc(record.pos_name)}</span>` : ""))}
    ${row("Направлення від сімейного лікаря", record.referral ? esc(record.referral) : "")}
    ${row("Анестезія", record.anesthesia ? esc(record.anesthesia) : "")}
    ${row("Група пацієнтів", record.group && record.sv !== "lab" ? esc(record.group) : "")}
    ${row("Додаткові інтервенції", record.extra ? esc(record.extra) : "")}
    ${row("Примітка листа", record.note ? esc(record.note) : "")}
    ${flagBlock}
    ${tariffBlock(record)}
    <div class="amb-section-title">Звідки це</div>
    <div class="amb-source">
      <a class="action" href="${docHref(record.src.doc)}">
        ${esc(source.role || "Документ")} — ${esc(source.title || "")}
      </a>
      <span class="amb-dim">аркуш «${esc(record.src.sheet)}», рядок ${record.src.row}</span>
    </div>
    <div class="algorithm-actions">
      <button class="action primary" type="button" id="ambCopy">Скопіювати висновок</button>
    </div>`;

  byId("ambCopy").addEventListener("click", () => copySummary(record, own));
  renderCards(norm(byId("ambSearch").value));
  if (window.matchMedia("(max-width: 1180px)").matches) setTab("reader");
}

/* Рядок про коефіцієнт для «Скопіювати висновок». */
function tariffLine(record) {
  const calc = tariffFor(record);
  if (!calc || calc.kind !== "value") return "";
  return "Коефіцієнт класу (пункт 62): " + coefText(calc.coef)
    + " — внесок однієї послуги у річний розрахунок глобальної ставки "
    + money(calc.amount) + " грн (" + money(state.data.tariff.rate) + " × "
    + coefText(calc.coef) + "). Це не ціна за випадок.";
}

function copySummary(record, own) {
  const letter = state.data.basis.letter;
  const lines = [
    `${record.code} — ${record.name || record.dx_name || ""}`,
    `Сервіс: ${SERVICE_NAME[record.sv] || record.sv}${record.class ? ` / ${record.class}` : ""}`,
    (record.pos || []).length ? `Посади: ${record.pos.join(", ")}` : "",
    (record.obs || []).length ? `Коди спостереження: ${record.obs.join(", ")}` : "",
    (record.odk || []).length ? `ОДК: ${record.odk.join(", ")}` : "",
    record.referral ? `Направлення від сімейного лікаря: ${record.referral}` : "",
    tariffLine(record),
    own.length ? `Застереження: ${own.map((f) => {
      const meta = state.data.flag_catalogue.find((c) => c.key === f.key) || {};
      return `${meta.title || f.key}${f.detail ? ` (${f.detail})` : ""}`;
    }).join("; ")}` : "",
    `Підстава: лист НСЗУ ${letter.number || ""} від ${formatDate(letter.date)}, `
      + `${record.src.doc === state.data.basis.letter.doc ? "текст листа" : "додаток"}, `
      + `аркуш «${record.src.sheet}»`,
  ].filter(Boolean);
  navigator.clipboard.writeText(lines.join("\n")).then(() => {
    const button = byId("ambCopy");
    button.textContent = "Скопійовано ✓";
    setTimeout(() => { button.textContent = "Скопіювати висновок"; }, 1600);
  });
}

/* ── мобільні вкладки ───────────────────────────────────────── */
function setTab(tab) {
  document.querySelector(".algorithms-layout").dataset.active = tab;
  document.querySelectorAll(".mobile-tab").forEach((button) =>
    button.classList.toggle("active", button.dataset.tab === tab));
}

/* ── старт ──────────────────────────────────────────────────── */
async function init() {
  const response = await fetch(`data/ambulatory_9.json?v=${Date.now()}`);
  state.data = await response.json();
  state.data.services.forEach((s) => { SERVICE_NAME[s.key] = s.name; });

  renderStats();
  renderBasis();
  renderLegend();
  renderRules();
  renderTariffPanel();
  renderOdkPanel();
  fillFilters();

  byId("ambSearch").addEventListener("input", apply);
  byId("ambService").addEventListener("change", () => { fillClasses(); apply(); });
  byId("ambClass").addEventListener("change", apply);
  byId("ambFlag").addEventListener("change", apply);
  byId("ambClear").addEventListener("click", () => {
    byId("ambSearch").value = "";
    byId("ambService").value = "";
    byId("ambFlag").value = "";
    state.odk = "";
    fillClasses();
    apply();
  });
  document.querySelectorAll(".mobile-tab").forEach((button) =>
    button.addEventListener("click", () => setTab(button.dataset.tab)));

  apply();

  const query = new URLSearchParams(location.search).get("q");
  if (query) {
    byId("ambSearch").value = query;
    apply();
    if (state.visible.length) select(state.visible[0].i);
  }
}

init().catch((error) => {
  byId("ambCount").textContent = "Не вдалося завантажити дані розділу.";
  console.error(error);
});
