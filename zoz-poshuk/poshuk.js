/* Розділ «Хто це лікує»: код або назва → пакети → законтрактовані заклади.
   Дані збирає zoz-poshuk/build_zoz_search.py; тут тільки пошук і показ. */

const state = {
  index: null,      // search_index.json — що можна ввести і на які пакети веде
  data: null,       // providers.json — заклади з пакетами й адресами МНП
  query: null,      // обраний запит: {kind, code, name, pkgs}
  matched: [],      // заклади за пакетами запиту (до фільтрів)
  filtered: [],     // те, що показуємо
  filters: { package: "", oblast: "", settlement: "", ownership: "", name: "" },
  suggestions: [],
  activeSuggestion: -1,
};

const RENDER_LIMIT = 300;
const el = (id) => document.getElementById(id);

const KIND_LABEL = {
  icd: "Хвороба (НК 025)",
  achi: "Інтервенція (НК 026)",
  equip: "Обладнання у вимогах пакета",
  pkg: "Пакет ПМГ",
};

function escapeHtml(val) {
  return String(val ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

// Пошук має однаково реагувати на «КИЇВ» і «київ», на прямий і кучерявий апостроф
function norm(text) {
  return String(text ?? "").replace(/[’`´]/g, "'").toLowerCase().trim();
}

// У даних усе великими літерами: «СТРИЙ», «ЛЬВІВСЬКА». У переліку для листа
// це виглядало б криком, тому повертаємо звичайний регістр.
function titleCase(text) {
  return String(text ?? "").toLowerCase().replace(/(^|[\s\-'’.])([а-яїієґa-z])/g,
    (m, sep, ch) => sep + ch.toUpperCase());
}

function settlementLabel(sid) {
  const s = state.data.settlements[sid];
  if (!s) return "";
  const [name, , typ] = s;
  return `${typ ? typ + " " : ""}${titleCase(name)}`;
}

function oblastLabel(idx) {
  const raw = state.data.oblasts[idx] || "";
  if (/^М\./i.test(raw)) return "м. " + titleCase(raw.replace(/^М\./i, "").trim());
  return titleCase(raw) + " обл.";
}

// Повна адреса одним рядком — саме в такому вигляді її вставляють у лист
function fullAddress(addr) {
  const s = state.data.settlements[addr[0]];
  if (!s) return addr[1] || "";
  const parts = [];
  // Київ і Севастополь самі собі область — без цього виходило «М. Київ, м. Київ»
  const oblastRaw = state.data.oblasts[s[1]] || "";
  if (!/^М\./i.test(oblastRaw)) parts.push(oblastLabel(s[1]));
  parts.push(settlementLabel(addr[0]));
  if (addr[1]) parts.push(addr[1]);
  return parts.join(", ");
}

// Вимоги до обладнання формулюються реченнями на два рядки («магнітно-резонансний
// томограф (МРТ) в центрі трансплантації або на умовах оренди, або…»). У полі
// пошуку й у ланцюжку показуємо початок, повний текст лишається в підказці.
function shortName(name, limit = 90) {
  const text = String(name || "");
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + "…" : text;
}

function packageName(num) {
  return state.index.packages[num] || "";
}

// ── Пошук підказок ─────────────────────────────────────────────────────────
const RE_ICD = /^[a-zа-яїієґ]\d/i;        // I21, C50.9
const RE_ACHI = /^\d{4,5}(-\d{1,2})?$/;   // 11000-00

// Питають «МРТ», а у вимогах пакета написано «магнітно-резонансний томограф».
// Розкриваємо лише при повному збігу запиту з абревіатурою: підрядок «кт»
// сидить у сотні слів і засмітив би видачу.
const EQUIP_SYNONYMS = {
  "мрт": ["магнітно-резонанс"],
  "кт": ["комп'ютерної томографії", "комп'ютерний томограф", "комп'ютерна томографія"],
  "узд": ["ультразвук"],
  "пет": ["позитронно-емісійн"],
  "екг": ["електрокардіограф"],
  "ехокг": ["ехокардіограф"],
  "ангіо": ["ангіограф"],
  "рентген": ["рентген"],
};

function buildSuggestions(raw) {
  const q = norm(raw);
  if (q.length < 2) return [];
  const out = [];
  const push = (kind, code, name, pkgs, rank, src) => out.push({ kind, code, name, pkgs, rank, src });

  const isCodeIcd = RE_ICD.test(q);
  const isCodeAchi = RE_ACHI.test(q.replace(/\s/g, ""));

  // Пакет: «12», «пакет 12»
  const pkgMatch = q.match(/^(?:пакет\s*)?(\d{1,3})$/);
  if (pkgMatch && state.index.packages[pkgMatch[1]]) {
    push("pkg", pkgMatch[1], packageName(pkgMatch[1]), [pkgMatch[1]], 0);
  }

  for (const [code, name, pkgs, src] of state.index.icd) {
    const lc = code.toLowerCase();
    let rank = -1;
    if (isCodeIcd) {
      if (lc === q) rank = 1;
      else if (lc.startsWith(q)) rank = 2;
    }
    if (rank < 0 && !isCodeIcd && name && norm(name).includes(q)) rank = norm(name).startsWith(q) ? 3 : 4;
    if (rank > 0) push("icd", code, name, pkgs, rank + (src === "n" ? 0.1 : 0), src);
    if (out.length > 400) break;
  }

  for (const [code, name, pkgs] of state.index.achi) {
    const lc = code.toLowerCase();
    let rank = -1;
    if (isCodeAchi || /^\d/.test(q)) {
      if (lc === q) rank = 1;
      else if (lc.startsWith(q)) rank = 2;
    }
    if (rank < 0 && name && norm(name).includes(q)) rank = norm(name).startsWith(q) ? 3 : 4;
    if (rank > 0) push("achi", code, name, pkgs, rank);
    if (out.length > 800) break;
  }

  // Обладнання шукають словом («МРТ», «ангіограф»), а воно зустрічається в
  // десятку по-різному сформульованих вимог. Спершу даємо зведений пункт —
  // інакше «МРТ» відкривало б лише вимогу центру трансплантації, і людина
  // вирішила б, що томографів у країні законтрактовано на 33 заклади.
  const equipTerms = [q].concat(EQUIP_SYNONYMS[q] || []);
  const equipHits = state.index.equip.filter(([name]) => {
    const n = norm(name);
    return equipTerms.some(term => n.includes(norm(term)));
  });
  if (equipHits.length > 1) {
    const union = new Set();
    equipHits.forEach(([, pkgs]) => pkgs.forEach(n => union.add(n)));
    push("equip", "", `Усі вимоги зі словом «${raw.trim()}» — ${equipHits.length} формулювань`,
      [...union].sort((a, b) => Number(a) - Number(b)), 2.2);
  }
  equipHits.forEach(([name, pkgs]) => {
    const n = norm(name);
    push("equip", "", name, pkgs, n.startsWith(q) ? 2.5 : 3.5);
  });

  for (const [num, name] of Object.entries(state.index.packages)) {
    if (name && norm(name).includes(q)) push("pkg", num, name, [num], 4.5);
  }

  out.sort((a, b) => a.rank - b.rank || String(a.code).localeCompare(String(b.code), "uk"));
  return out.slice(0, 12);
}

function renderSuggestions() {
  const box = el("suggestBox");
  if (!state.suggestions.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.innerHTML = state.suggestions.map((s, i) => {
    // «c» у джерелі = пакети зібрані з підкодів (C50 ← C50.0…C50.9)
    const withChildren = typeof s.src === "string" && s.src.includes("c");
    const pk = s.pkgs.length
      ? `Пакети: ${s.pkgs.join(", ")}${withChildren ? " (з підкодами)" : ""}`
      : "немає договорів";
    return `
      <button type="button" class="suggest-item${i === state.activeSuggestion ? " active" : ""}" data-i="${i}" role="option">
        <span class="s-kind">${escapeHtml(KIND_LABEL[s.kind])}</span>
        <span class="s-main">${s.code ? `<b>${escapeHtml(s.code)}</b> — ` : ""}${escapeHtml(s.name || "")}</span>
        <span class="s-pkgs">${escapeHtml(pk)}</span>
      </button>`;
  }).join("");
  box.hidden = false;
}

function closeSuggestions() {
  state.suggestions = [];
  state.activeSuggestion = -1;
  renderSuggestions();
}

// ── Вибір запиту ───────────────────────────────────────────────────────────
function selectSuggestion(s) {
  if (!s) return;
  state.query = s;
  el("queryInput").value = s.code ? `${s.code} — ${shortName(s.name)}`.trim() : shortName(s.name);
  el("queryInput").title = s.name || "";
  closeSuggestions();

  const wanted = new Set(s.pkgs);
  state.matched = state.data.providers.filter(p => p.p.some(num => wanted.has(num)));

  populateFilters();
  const chainQ = el("chainQuery");
  chainQ.textContent = s.code ? `${s.code} — ${shortName(s.name, 70)}` : shortName(s.name, 70);
  chainQ.title = s.name || "";
  el("chainPackages").innerHTML = s.pkgs.length
    ? s.pkgs.map(n => `<span class="pkg-badge" title="${escapeHtml(packageName(n))}">№ ${escapeHtml(n)}</span>`).join("")
    : '<span class="pkg-badge muted">немає</span>';
  el("chainBox").hidden = false;
  el("emptyHint").hidden = true;
  el("resultsSection").hidden = false;
  applyFilters();
}

function populateFilters() {
  // Один код МКХ тягне за собою до півдюжини пакетів (I21.0 — це 3, 4, 6, 9,
  // 53, 54), а в листі зазвичай питають про один напрям. Тому пакет запиту
  // винесено окремим фільтром, з кількістю закладів одразу в підписі.
  const pkgSel = el("filterPackage");
  const pkgs = state.query ? state.query.pkgs : [];
  pkgSel.innerHTML = `<option value="">Усі пакети запиту (${pkgs.length})</option>` +
    pkgs.map(num => {
      const count = state.matched.filter(p => p.p.includes(num)).length;
      const name = packageName(num);
      return `<option value="${escapeHtml(num)}">№ ${escapeHtml(num)}${name ? " — " + escapeHtml(name) : ""} · ${count}</option>`;
    }).join("");
  state.filters.package = "";

  const oblasts = new Map();
  const ownerships = new Set();
  state.matched.forEach(p => {
    ownerships.add(p.ow || "—");
    p.a.forEach(a => {
      const s = state.data.settlements[a[0]];
      if (s) oblasts.set(s[1], oblastLabel(s[1]));
    });
  });

  const obSel = el("filterOblast");
  obSel.innerHTML = '<option value="">Усі області</option>' +
    [...oblasts.entries()].sort((a, b) => a[1].localeCompare(b[1], "uk"))
      .map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("");
  state.filters.oblast = "";

  const owSel = el("filterOwnership");
  owSel.innerHTML = '<option value="">Будь-яка</option>' +
    [...ownerships].sort((a, b) => a.localeCompare(b, "uk"))
      .map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
  state.filters.ownership = "";

  populateSettlements();
}

// Пункти залежать від області: без цього у списку висіли б усі 4 249
function populateSettlements() {
  const sel = el("filterSettlement");
  const oblastId = state.filters.oblast === "" ? null : Number(state.filters.oblast);
  const found = new Map();
  state.matched.forEach(p => p.a.forEach(a => {
    const s = state.data.settlements[a[0]];
    if (!s) return;
    if (oblastId !== null && s[1] !== oblastId) return;
    found.set(a[0], settlementLabel(a[0]) + (s[3] ? ` · ${titleCase(s[3])} р-н` : ""));
  }));
  sel.innerHTML = '<option value="">Усі населені пункти</option>' +
    [...found.entries()].sort((a, b) => a[1].localeCompare(b[1], "uk"))
      .map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("");
  state.filters.settlement = "";
}

// ── Фільтри й показ ────────────────────────────────────────────────────────
function addressesFor(p) {
  const oblastId = state.filters.oblast === "" ? null : Number(state.filters.oblast);
  const settlementId = state.filters.settlement === "" ? null : Number(state.filters.settlement);
  return p.a.filter(a => {
    const s = state.data.settlements[a[0]];
    if (!s) return false;
    if (settlementId !== null) return a[0] === settlementId;
    if (oblastId !== null) return s[1] === oblastId;
    return true;
  });
}

function applyFilters() {
  const nameQuery = norm(state.filters.name);
  state.filtered = state.matched.filter(p => {
    if (state.filters.package && !p.p.includes(state.filters.package)) return false;
    if (state.filters.ownership && (p.ow || "—") !== state.filters.ownership) return false;
    if (nameQuery && !(norm(p.n).includes(nameQuery) || norm(p.f).includes(nameQuery) || p.e.includes(nameQuery))) return false;
    return addressesFor(p).length > 0;
  });
  renderResults();
}

// «1 заклад», «2 заклади», «5 закладів» — перелік читають люди, а не машина
function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderResults() {
  const list = el("zozList");
  const total = state.filtered.length;
  const addrTotal = state.filtered.reduce((acc, p) => acc + addressesFor(p).length, 0);
  el("resultsCount").innerHTML = total
    ? `Знайдено <strong>${total}</strong> ${plural(total, "заклад", "заклади", "закладів")} · ` +
      `${addrTotal} ${plural(addrTotal, "адреса", "адреси", "адрес")} ` +
      `${plural(addrTotal, "місця", "місць", "місць")} надання послуг`
    : "За цими умовами законтрактованих закладів немає";
  el("chainCount").textContent =
    `${state.matched.length} ${plural(state.matched.length, "заклад", "заклади", "закладів")}`;

  if (!total) {
    list.innerHTML = '<div class="no-results">Спробуйте зняти фільтр області або населеного пункту.</div>';
    return;
  }

  const wanted = new Set(state.query ? state.query.pkgs : []);
  const shown = state.filtered.slice(0, RENDER_LIMIT);
  list.innerHTML = shown.map(p => {
    const addrs = addressesFor(p);
    const addrHtml = addrs.slice(0, 4).map(a => `<li>${escapeHtml(fullAddress(a))}</li>`).join("") +
      (addrs.length > 4
        ? `<li class="more">…та ще ${addrs.length - 4} ${plural(addrs.length - 4, "адреса", "адреси", "адрес")} — увійдуть у копіювання</li>`
        : "");
    const pkgHtml = p.p.map(num => {
      const hit = wanted.has(num);
      return `<span class="pkg-badge${hit ? " hit" : " dim"}" title="${escapeHtml(packageName(num))}">№ ${escapeHtml(num)}</span>`;
    }).join("");
    return `
      <article class="zoz">
        <div class="zoz-head">
          <div class="zoz-title">
            <strong>${escapeHtml(p.n)}</strong>
            <div class="zoz-sub">
              <span class="edrpou">${escapeHtml(p.e)}</span>
              <span>${escapeHtml(p.ow || "—")}</span>
              ${p.nt && p.nt !== "Не входить в спроможну мережу" ? `<span class="net">${escapeHtml(p.nt)}</span>` : ""}
            </div>
          </div>
          <div class="zoz-pkgs">${pkgHtml}</div>
        </div>
        <ul class="zoz-addr">${addrHtml}</ul>
        ${p.em ? `<div class="zoz-mail">✉ <a href="mailto:${escapeHtml(p.em)}">${escapeHtml(p.em)}</a></div>` : ""}
      </article>`;
  }).join("");

  if (total > RENDER_LIMIT) {
    list.insertAdjacentHTML("beforeend",
      `<div class="no-results soft">Показано перші ${RENDER_LIMIT} з ${total}. Копіювання та Excel беруть усі ${total}.</div>`);
  }
}

// ── Копіювання ─────────────────────────────────────────────────────────────
function queryTitle() {
  if (!state.query) return "";
  return state.query.code ? `${state.query.code} — ${state.query.name || ""}`.trim() : state.query.name;
}

function locationTitle() {
  if (state.filters.settlement !== "") return settlementLabel(Number(state.filters.settlement));
  if (state.filters.oblast !== "") return oblastLabel(Number(state.filters.oblast));
  return "Україна";
}

// Якщо в фільтрі обрано один пакет — у листі має стояти саме він, а не всі
// шість, на які вивів код МКХ
function activePackages() {
  return state.filters.package ? [state.filters.package] : state.query.pkgs;
}

function buildLetterText() {
  const pkgs = activePackages().map(n => `№ ${n}${packageName(n) ? ` «${packageName(n)}»` : ""}`).join("; ");
  const head = [
    `Заклади охорони здоров'я, законтрактовані НСЗУ за пакетом(ами) медичних послуг: ${pkgs}.`,
    // «Львівська обл.» уже з крапкою — друга виглядала б як одрук
    `Запит: ${queryTitle()}. Територія: ${locationTitle().replace(/\.$/, "")}.`,
    `Дані станом на ${state.index.source_date || "—"}.`,
    "",
  ];
  const body = state.filtered.map((p, i) => {
    const lines = [`${i + 1}. ${p.f || p.n} (ЄДРПОУ ${p.e})`];
    addressesFor(p).forEach(a => lines.push(`   ${fullAddress(a)}`));
    if (p.em) lines.push(`   Електронна пошта: ${p.em}`);
    return lines.join("\n");
  });
  return head.concat(body).join("\n");
}

function buildTableText() {
  const rows = [["ЄДРПОУ", "Назва закладу", "Область", "Населений пункт", "Адреса місця надання послуг",
    "Пакети за запитом", "Усі пакети закладу", "Електронна пошта"]];
  const wanted = new Set(activePackages());
  state.filtered.forEach(p => {
    // Заклад може мати 27 пакетів; у листі важливі ті, через які його знайшли
    const hit = p.p.filter(num => wanted.has(num)).join(", ");
    addressesFor(p).forEach(a => {
      const s = state.data.settlements[a[0]];
      rows.push([p.e, p.f || p.n, s ? oblastLabel(s[1]) : "", settlementLabel(a[0]), a[1] || "",
        hit, p.p.join(", "), p.em || ""]);
    });
  });
  return rows.map(r => r.join("\t")).join("\n");
}

async function copyToClipboard(text, note) {
  try {
    await navigator.clipboard.writeText(text);
    showNote(note);
  } catch (err) {
    // Буфер недоступний (немає дозволу чи http) — показуємо текст, щоб можна
    // було виділити вручну, інакше кнопка просто мовчить
    showNote("Не вдалося скопіювати автоматично — текст відкрито у новому вікні");
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<pre style="white-space:pre-wrap;font:14px/1.5 system-ui">${escapeHtml(text)}</pre>`);
      w.document.close();
    }
  }
}

let noteTimer = null;
function showNote(text) {
  const note = el("copyNote");
  note.textContent = text;
  note.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note.hidden = true; }, 4000);
}

function exportXlsx() {
  const rows = buildTableText().split("\n").map(r => r.split("\t"));
  const ws = XLSX.utils.aoa_to_sheet([
    [`Запит: ${queryTitle()}`],
    [`Пакети: ${activePackages().join(", ")}`],
    [`Територія: ${locationTitle()}`],
    [`Дані станом на ${state.index.source_date || "—"}`],
    [],
  ].concat(rows));
  ws["!cols"] = [{ wch: 12 }, { wch: 48 }, { wch: 20 }, { wch: 20 }, { wch: 44 }, { wch: 18 }, { wch: 26 }, { wch: 26 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Заклади");
  const stamp = (state.index.source_date || "").replace(/\./g, "-");
  XLSX.writeFile(wb, `zoz_${(state.query.code || "poshuk").replace(/[^\wа-яіїєґ-]/gi, "")}_${stamp}.xlsx`);
}

// ── Ініціалізація ──────────────────────────────────────────────────────────
function setupListeners() {
  const input = el("queryInput");
  let debounce = null;

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.suggestions = buildSuggestions(input.value);
      state.activeSuggestion = state.suggestions.length ? 0 : -1;
      renderSuggestions();
    }, 120);
  });

  input.addEventListener("keydown", (e) => {
    if (!state.suggestions.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      state.activeSuggestion = (state.activeSuggestion + delta + state.suggestions.length) % state.suggestions.length;
      renderSuggestions();
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectSuggestion(state.suggestions[Math.max(state.activeSuggestion, 0)]);
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  });

  el("suggestBox").addEventListener("click", (e) => {
    const btn = e.target.closest(".suggest-item");
    if (btn) selectSuggestion(state.suggestions[Number(btn.dataset.i)]);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".poshuk-search") && !e.target.closest(".suggest")) closeSuggestions();
  });

  document.querySelectorAll("[data-quick]").forEach(btn => {
    btn.addEventListener("click", () => runQuery(btn.dataset.quick));
  });

  el("filterPackage").addEventListener("change", (e) => {
    state.filters.package = e.target.value;
    applyFilters();
  });
  el("filterOblast").addEventListener("change", (e) => {
    state.filters.oblast = e.target.value;
    populateSettlements();
    applyFilters();
  });
  el("filterSettlement").addEventListener("change", (e) => {
    state.filters.settlement = e.target.value;
    applyFilters();
  });
  el("filterOwnership").addEventListener("change", (e) => {
    state.filters.ownership = e.target.value;
    applyFilters();
  });
  let nameDebounce = null;
  el("filterName").addEventListener("input", (e) => {
    clearTimeout(nameDebounce);
    nameDebounce = setTimeout(() => {
      state.filters.name = e.target.value;
      applyFilters();
    }, 150);
  });

  el("copyText").addEventListener("click", () =>
    copyToClipboard(buildLetterText(),
      `Скопійовано ${state.filtered.length} ${plural(state.filtered.length, "заклад", "заклади", "закладів")} у форматі для листа`));
  el("copyTable").addEventListener("click", () =>
    copyToClipboard(buildTableText(), "Таблицю скопійовано — вставляйте у Word або Excel"));
  el("exportXlsx").addEventListener("click", exportXlsx);
}

// Запит текстом: беремо найкращу підказку. Так працюють і кнопки «часто питають»,
// і посилання ?q= з інших розділів порталу
function runQuery(text) {
  el("queryInput").value = text;
  const found = buildSuggestions(text);
  if (found.length) {
    selectSuggestion(found[0]);
  } else {
    state.suggestions = [];
    renderSuggestions();
    showNote(`За запитом «${text}» нічого не знайдено`);
  }
}

async function init() {
  const [index, data] = await Promise.all([
    fetch("data/search_index.json").then(r => r.json()),
    fetch("data/providers.json").then(r => r.json()),
  ]);
  state.index = index;
  state.data = data;

  el("statProviders").textContent = data.stats.providers.toLocaleString("uk-UA");
  el("statIcd").textContent = index.icd.length.toLocaleString("uk-UA");
  el("statAchi").textContent = index.achi.length.toLocaleString("uk-UA");
  el("queryLoading").hidden = true;
  el("queryInput").disabled = false;
  if (index.source_date) {
    el("footerFresh").textContent = `станом на ${index.source_date}`;
  }

  setupListeners();

  const params = new URLSearchParams(location.search);
  const q = params.get("q") || params.get("package");
  if (q) runQuery(q);
  el("queryInput").focus();
}

document.addEventListener("DOMContentLoaded", () => {
  el("queryInput").disabled = true;
  init().catch(err => {
    console.error(err);
    el("queryLoading").textContent = "Не вдалося завантажити довідник. Оновіть сторінку.";
  });
});
