// ═══════════════════════════════════════════════════════════════
// Розподіл пакетів ПМГ-2026 між експертами відділу
// Особиста смарт-сторінка + загальна інформаційна сторінка
// Джерело даних: робоча таблиця відділу (Google Sheets, лип. 2026)
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Експерти відділу ────────────────────────────────────────────
const EXPERTS = {
  savka:  { short: 'Савка Ю.',        full: 'Савка Юлія Іванівна',        surname: 'Савка',        color: '#2f6b9e' },
  isaiuk: { short: 'Ісаюк В.',        full: 'Ісаюк Вікторія Миколаївна',  surname: 'Ісаюк',        color: '#0e7c6b' },
  vesel:  { short: 'Веселовський М.', full: 'Веселовський М.',            surname: 'Веселовський', color: '#7c53c9' },
  tkach:  { short: 'Ткач К.',         full: 'Ткач Костянтин Дмитрович',   surname: 'Ткач',         color: '#c2711f' },
  koval:  { short: 'Ковальова О.',    full: 'Ковальова Олена Михайлівна', surname: 'Ковальова',    color: '#b3366b' },
  artom:  { short: 'Артьомова Н.',    full: 'Артьомова Наталія',          surname: 'Артьомова',    color: '#5468c4' },
  volosh: { short: 'Волошина А.',     full: 'Волошина Альбіна Миколаївна', surname: 'Волошина',    color: '#3f7d4e' },
};

// ── Матриця розподілу: основні пакети ПМГ-2026 ─────────────────
// num — № пакета за постановою 1808; resp — відповідальний (аналіз, пакети); dup — дублер (відповіді на листи)
const MAIN = [
  { num: '1',  title: 'Первинна медична допомога', resp: 'savka', dup: 'savka' },
  { num: '2',  title: 'Екстрена медична допомога', resp: 'isaiuk', dup: 'isaiuk' },
  { num: '3',  title: 'Хірургічні операції дорослим та дітям у стаціонарних умовах', resp: 'vesel', dup: 'vesel' },
  { num: '4',  title: 'Стаціонарна допомога дорослим та дітям без проведення хірургічних операцій', resp: 'vesel', dup: 'vesel' },
  { num: '5',  title: 'Медична допомога при гострому мозковому інсульті', resp: 'tkach', dup: 'tkach' },
  { num: '6',  title: 'Медична допомога при гострому інфаркті міокарда', resp: 'tkach', dup: 'tkach' },
  { num: '7',  title: 'Медична допомога при пологах', resp: 'tkach', dup: 'tkach' },
  { num: '8',  title: 'Медична допомога новонародженим у складних неонатальних випадках', resp: 'koval', dup: 'savka' },
  { num: '9',  title: 'Профілактика, діагностика, спостереження та лікування в амбулаторних умовах', resp: 'koval', dup: 'isaiuk' },
  { num: '10', title: 'Мамографія', resp: 'isaiuk', dup: 'isaiuk' },
  { num: '11', title: 'Гістероскопія', resp: 'tkach', dup: 'tkach' },
  { num: '12', title: 'Езофагогастродуоденоскопія', resp: 'tkach', dup: 'tkach' },
  { num: '13', title: 'Колоноскопія', resp: 'tkach', dup: 'tkach' },
  { num: '14', title: 'Цистоскопія', resp: 'tkach', dup: 'tkach' },
  { num: '15', title: 'Бронхоскопія', resp: 'tkach', dup: 'tkach' },
  { num: '16', title: 'Лікування пацієнтів методом гемодіалізу в амбулаторних умовах', resp: 'vesel', dup: 'vesel' },
  { num: '17', title: 'Хіміотерапевтичне лікування та супровід пацієнтів з онкологічними захворюваннями у стаціонарних та амбулаторних умовах', resp: 'artom', dup: 'savka' },
  { num: '18', title: 'Радіологічне лікування та супровід пацієнтів з онкологічними захворюваннями в стаціонарних та амбулаторних умовах', resp: 'artom', dup: 'savka' },
  { num: '19', title: 'Психіатрична допомога дорослим та дітям у стаціонарних умовах', resp: 'savka', dup: 'savka' },
  { num: '20', title: 'Діагностика та лікування дорослих і дітей, хворих на туберкульоз, у стаціонарних та амбулаторних умовах', resp: 'savka', dup: 'savka' },
  { num: '21', title: 'Діагностика, лікування та супровід осіб із вірусом імунодефіциту людини (та підозрою на ВІЛ)', resp: 'savka', dup: 'savka' },
  { num: '22', title: 'Лікування осіб із психічними та поведінковими розладами внаслідок вживання опіоїдів із використанням препаратів замісної підтримувальної терапії', resp: 'savka', dup: 'savka' },
  { num: '23', title: 'Стаціонарна паліативна медична допомога дорослим та дітям', resp: 'tkach', dup: 'tkach' },
  { num: '24', title: 'Мобільна паліативна медична допомога дорослим і дітям', resp: 'tkach', dup: 'tkach' },
  { num: '25', title: 'Медична реабілітація немовлят, які народилися передчасно та/або хворими, протягом перших трьох років життя', resp: 'koval', dup: 'volosh' },
  { num: '34', title: 'Стоматологічна допомога дорослим та дітям', resp: 'vesel', dup: 'vesel' },
  { num: '35', title: 'Ведення вагітності в амбулаторних умовах', resp: 'tkach', dup: 'tkach' },
  { num: '37', title: 'Лікування пацієнтів методом перитонеального діалізу в амбулаторних умовах', resp: 'vesel', dup: 'vesel' },
  { num: '38', title: 'Лікування та супровід пацієнтів з гематологічними та онкогематологічними захворюваннями в стаціонарних та амбулаторних умовах', resp: 'artom', dup: 'savka' },
  { num: '42', title: 'Готовність закладу охорони здоров’я до надання медичної допомоги в надзвичайних ситуаціях', resp: 'isaiuk', dup: 'isaiuk' },
  { num: '47', title: 'Хірургічні операції дорослим та дітям в умовах стаціонару одного дня', resp: 'vesel', dup: 'vesel' },
  { num: '48', title: 'Неонатальний скринінг', resp: 'koval', dup: 'savka' },
  { num: '49', title: 'Забезпечення збереження кадрового потенціалу для надання медичної допомоги населенню, яке перебуває на територіях бойових дій', resp: 'isaiuk', dup: 'isaiuk' },
  { num: '50', title: 'Забезпечення кадрового потенціалу системи охорони здоров’я шляхом організації надання медичної допомоги із залученням лікарів-інтернів', resp: 'isaiuk', dup: 'isaiuk' },
  { num: '53', title: 'Реабілітаційна допомога дорослим та дітям у стаціонарних умовах', resp: 'koval', dup: 'tkach' },
  { num: '54', title: 'Реабілітаційна допомога дорослим та дітям у амбулаторних умовах', resp: 'koval', dup: 'tkach' },
  { num: '55', title: 'Секційне дослідження', resp: 'isaiuk', dup: 'isaiuk' },
  { num: '57', title: 'Готовність та забезпечення надання медичної допомоги населенню, яке перебуває на території, де ведуться бойові дії', resp: 'isaiuk', dup: 'isaiuk' },
  { num: '60', title: 'Медичний огляд осіб, який організовується територіальними центрами комплектування та соціальної підтримки', resp: 'savka', dup: 'savka' },
  { num: '63', title: 'Лікування безпліддя за допомогою допоміжних репродуктивних технологій (запліднення in vitro)', resp: 'koval', dup: 'tkach' },
  { num: '64', title: 'Лікування дорослих та дітей методом трансплантації органів', resp: 'artom', dup: 'savka' },
  { num: '65', title: 'Лікування дорослих та дітей методом трансплантації гемопоетичних стовбурових клітин', resp: 'artom', dup: 'savka' },
  { num: '68', title: 'Перехідне фінансове забезпечення надання медичних послуг закладами охорони здоров’я', resp: 'isaiuk', dup: 'isaiuk' },
  { num: '70', title: 'Проведення досліджень з радіоізотопної медичної візуалізації та діагностики (позитронно-емісійної томографії)', resp: 'artom', dup: 'savka' },
  { num: '72', title: 'Психосоціальна та психіатрична допомога дорослим та дітям, що надається в центрах ментального (психічного) здоров’я та мобільними мультидисциплінарними командами', resp: 'savka', dup: 'savka' },
  { num: '86', title: 'Медична допомога дітям, які потребують лікування та постійного спостереження', resp: 'koval', dup: 'tkach' },
];

// ── Пілотні / експериментальні проєкти ─────────────────────────
const PILOTS = [
  { num: '66', title: 'Зубопротезування окремих категорій осіб, які захищають/захищали незалежність, суверенітет та територіальну цілісність України (група послуг № 1)', resp: 'vesel', dup: 'vesel', pilot: true },
  { num: '67', title: 'Стоматологічна допомога окремій категорії осіб, які захищають/захищали незалежність, суверенітет та територіальну цілісність України (група послуг № 2)', resp: 'vesel', dup: 'vesel', pilot: true },
  { num: '71', title: 'Медичні послуги із здійснення забору, кріоконсервації та зберігання репродуктивних клітин військовослужбовців та інших осіб на випадок втрати репродуктивної функції', resp: 'koval', dup: 'tkach', pilot: true },
  { num: '73', title: 'Розширені послуги з первинної медичної допомоги окремим категоріям осіб, які захищали незалежність, суверенітет та територіальну цілісність України', resp: 'savka', dup: 'savka', pilot: true },
  { num: '84', title: 'Послуги довготривалого медсестринського догляду внутрішньо переміщених осіб', resp: 'tkach', dup: 'tkach', pilot: true },
  { num: '86', title: 'Довготривалий медичний догляд окремим категоріям осіб, які захищали незалежність, суверенітет та територіальну цілісність України', resp: 'koval', dup: 'volosh', pilot: true },
];

const ALL_PACKAGES = [...MAIN, ...PILOTS];

// Пакети, для яких існує паспорт на порталі (лише основні; пілотні специфікації окремо)
const HAS_PASSPORT = new Set(MAIN.map(p => p.num));

// ── Стан ────────────────────────────────────────────────────────
let myKey = null;        // експерт, якого впізнали за акаунтом
let viewerKey = null;    // чий особистий розподіл зараз показано
let filterExpert = 'all';
let searchQ = '';

// ── Утиліти ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function initials(key) {
  const e = EXPERTS[key];
  return e ? e.surname.charAt(0) : '?';
}

function passportLink(p) {
  if (p.pilot || !HAS_PASSPORT.has(p.num)) return '';
  return `<a class="rz-card-link" href="../passport/index.html?package=${encodeURIComponent(p.num)}" title="Відкрити паспорт пакета № ${esc(p.num)}">🪪 Паспорт пакета</a>`;
}

function expertChip(key, role, clickable = true) {
  const e = EXPERTS[key];
  if (!e) return '—';
  const me = key === myKey ? ' rz-chip-me' : '';
  const tag = clickable ? 'button' : 'span';
  return `<${tag} type="button" class="rz-exp-chip${me}" data-expert="${key}" data-role="${role}" style="--exp-c:${e.color}">
    <span class="rz-exp-dot"></span>${esc(e.short)}${key === myKey ? ' <em>(ви)</em>' : ''}</${tag}>`;
}

// ── Ініціалізація ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindTabs();

  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user ?? null;
  if (!user) return; // доступ закриє auth-v2 (data-required-role="expert")

  // Впізнаємо експерта за повним ім'ям у профілі
  let fullName = user.user_metadata?.full_name || user.user_metadata?.name || '';
  try {
    const { data: prof } = await sb.from('profiles').select('full_name').eq('id', user.id).single();
    if (prof?.full_name) fullName = prof.full_name;
  } catch (_) { /* профіль необов'язковий — залишаємо metadata */ }

  myKey = Object.keys(EXPERTS).find(k => fullName.toLowerCase().includes(EXPERTS[k].surname.toLowerCase())) || null;
  viewerKey = myKey || 'savka';

  // Дозволяємо відкривати одразу потрібний режим: rozpodil.html#all / #my / ?expert=key
  const params = new URLSearchParams(location.search);
  if (params.get('expert') && EXPERTS[params.get('expert')]) viewerKey = params.get('expert');
  if (location.hash === '#all') switchTab('all');

  renderPersonRow();
  renderPersonal();
  renderLoadBars();
  renderChips();
  renderTable();

  $('rz-search').addEventListener('input', e => {
    searchQ = e.target.value.trim().toLowerCase();
    renderTable();
  });
}

// ── Вкладки Особисто / Загальний ───────────────────────────────
function bindTabs() {
  $('rz-tab-my').addEventListener('click', () => switchTab('my'));
  $('rz-tab-all').addEventListener('click', () => switchTab('all'));
}

function switchTab(tab) {
  const my = tab === 'my';
  $('rz-pane-my').style.display = my ? '' : 'none';
  $('rz-pane-all').style.display = my ? 'none' : '';
  $('rz-tab-my').classList.toggle('active', my);
  $('rz-tab-all').classList.toggle('active', !my);
  $('rz-tab-my').setAttribute('aria-selected', my);
  $('rz-tab-all').setAttribute('aria-selected', !my);
  history.replaceState(null, '', my ? '#my' : '#all');
}

// ── Особиста сторінка ──────────────────────────────────────────
function renderPersonRow() {
  const row = $('rz-person-row');
  const label = myKey ? 'Подивитись розподіл колеги:' : 'Оберіть експерта:';
  row.innerHTML = `<span class="rz-person-lbl">${label}</span>` +
    Object.keys(EXPERTS).map(k => {
      const e = EXPERTS[k];
      const active = k === viewerKey ? ' active' : '';
      const me = k === myKey ? ' <em>(ви)</em>' : '';
      return `<button type="button" class="rz-person-btn${active}" data-key="${k}" style="--exp-c:${e.color}">
        <span class="rz-person-ava">${esc(initials(k))}</span>${esc(e.surname)}${me}</button>`;
    }).join('');

  row.querySelectorAll('.rz-person-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewerKey = btn.dataset.key;
      renderPersonRow();
      renderPersonal();
    });
  });
}

function renderPersonal() {
  const e = EXPERTS[viewerKey];
  const resp = ALL_PACKAGES.filter(p => p.resp === viewerKey);
  const dup = ALL_PACKAGES.filter(p => p.dup === viewerKey && p.resp !== viewerKey);
  const pilots = resp.filter(p => p.pilot).length;

  $('rz-id-avatar').textContent = initials(viewerKey);
  $('rz-id-avatar').style.background = e.color;
  $('rz-id-name').textContent = e.full + (viewerKey === myKey ? ' — це ви' : '');
  $('rz-id-summary').textContent = resp.length
    ? `Відповідає за аналіз ${resp.length} пакет${plural(resp.length)}${pilots ? `, з них ${pilots} — пілотні проєкти` : ''}${dup.length ? `; дублює відповіді на листи ще у ${dup.length}` : ''}.`
    : `Не є основним відповідальним, але дублює відповіді на листи у ${dup.length} пакет${plural(dup.length)}.`;

  $('rz-m-resp').textContent = resp.length;
  $('rz-m-dup').textContent = dup.length;
  $('rz-m-pilot').textContent = pilots;

  $('rz-my-resp').innerHTML = resp.length
    ? resp.map(p => packageCard(p, 'resp')).join('')
    : '<div class="rz-empty">Немає пакетів на основній відповідальності.</div>';

  $('rz-dup-section').style.display = dup.length ? '' : 'none';
  $('rz-my-dup').innerHTML = dup.map(p => packageCard(p, 'dup')).join('');

  // Клік по чипу колеги на картці — перейти до його особистої сторінки
  document.querySelectorAll('#rz-pane-my .rz-exp-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      viewerKey = chip.dataset.expert;
      renderPersonRow();
      renderPersonal();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function packageCard(p, role) {
  const other = role === 'resp' ? p.dup : p.resp;
  const otherLbl = role === 'resp' ? 'Дублер (листи)' : 'Відповідальний';
  const showOther = other !== viewerKey;
  return `<article class="rz-card${p.pilot ? ' rz-card-pilot' : ''}">
    <div class="rz-card-top">
      <span class="rz-num${p.pilot ? ' pilot' : ''}" title="${p.pilot ? 'Пілотний / експериментальний проєкт' : 'Пакет ПМГ-2026'}">№ ${esc(p.num)}</span>
      ${p.pilot ? '<span class="rz-pilot-badge">🧪 пілот</span>' : ''}
    </div>
    <h4 class="rz-card-title">${esc(p.title)}</h4>
    <div class="rz-card-foot">
      ${showOther ? `<span class="rz-card-other">${otherLbl}: ${expertChip(other, 'switch')}</span>` : '<span class="rz-card-other rz-solo">Веде повністю самостійно</span>'}
      ${passportLink(p)}
    </div>
  </article>`;
}

function plural(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return '';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'и';
  return 'ів';
}

// ── Загальна сторінка: навантаження ────────────────────────────
function renderLoadBars() {
  const counts = Object.keys(EXPERTS).map(k => ({
    key: k,
    resp: ALL_PACKAGES.filter(p => p.resp === k).length,
    dup: ALL_PACKAGES.filter(p => p.dup === k && p.resp !== k).length,
  })).filter(c => c.resp + c.dup > 0)
    .sort((a, b) => (b.resp + b.dup) - (a.resp + a.dup));

  const max = Math.max(...counts.map(c => c.resp + c.dup));

  $('rz-load-bars').innerHTML = counts.map(c => {
    const e = EXPERTS[c.key];
    const active = filterExpert === c.key ? ' active' : '';
    return `<button type="button" class="rz-load-row${active}" data-key="${c.key}" title="Відфільтрувати таблицю: ${esc(e.short)}">
      <span class="rz-load-name"><span class="rz-person-ava" style="--exp-c:${e.color}">${esc(initials(c.key))}</span>${esc(e.surname)}${c.key === myKey ? ' <em>(ви)</em>' : ''}</span>
      <span class="rz-load-track">
        <span class="rz-load-seg" style="width:${(c.resp / max) * 100}%;background:${e.color}"></span>
        <span class="rz-load-seg dup" style="width:${(c.dup / max) * 100}%;background:${e.color}"></span>
      </span>
      <span class="rz-load-count">${c.resp}${c.dup ? ` <em>+${c.dup}</em>` : ''}</span>
    </button>`;
  }).join('');

  $('rz-load-bars').querySelectorAll('.rz-load-row').forEach(rowEl => {
    rowEl.addEventListener('click', () => {
      filterExpert = filterExpert === rowEl.dataset.key ? 'all' : rowEl.dataset.key;
      renderLoadBars();
      renderChips();
      renderTable();
    });
  });
}

// ── Загальна сторінка: фільтри ─────────────────────────────────
function renderChips() {
  const chips = [{ key: 'all', label: `Всі пакети · ${ALL_PACKAGES.length}` }]
    .concat(Object.keys(EXPERTS)
      .map(k => ({ key: k, n: ALL_PACKAGES.filter(p => p.resp === k || p.dup === k).length }))
      .filter(c => c.n > 0)
      .map(c => ({ key: c.key, label: `${EXPERTS[c.key].surname} · ${c.n}` })));

  $('rz-chips').innerHTML = chips.map(c => {
    const e = EXPERTS[c.key];
    const style = e ? ` style="--exp-c:${e.color}"` : '';
    return `<button type="button" class="rz-filter-chip${filterExpert === c.key ? ' active' : ''}" data-key="${c.key}"${style}>${esc(c.label)}</button>`;
  }).join('');

  $('rz-chips').querySelectorAll('.rz-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      filterExpert = chip.dataset.key;
      renderLoadBars();
      renderChips();
      renderTable();
    });
  });
}

// ── Загальна сторінка: таблиця ─────────────────────────────────
function renderTable() {
  const match = p => {
    if (filterExpert !== 'all' && p.resp !== filterExpert && p.dup !== filterExpert) return false;
    if (!searchQ) return true;
    return p.title.toLowerCase().includes(searchQ)
      || p.num.includes(searchQ)
      || EXPERTS[p.resp].short.toLowerCase().includes(searchQ)
      || EXPERTS[p.dup].short.toLowerCase().includes(searchQ);
  };

  const main = MAIN.filter(match);
  const pilots = PILOTS.filter(match);

  const row = p => `<tr${p.pilot ? ' class="rz-row-pilot"' : ''}>
    <td class="rz-td-num">${
      (!p.pilot && HAS_PASSPORT.has(p.num))
        ? `<a class="rz-num" href="../passport/index.html?package=${encodeURIComponent(p.num)}" title="Паспорт пакета № ${esc(p.num)}">№ ${esc(p.num)}</a>`
        : `<span class="rz-num pilot">№ ${esc(p.num)}</span>`
    }</td>
    <td class="rz-td-title">${esc(p.title)}${p.pilot ? ' <span class="rz-pilot-badge">🧪 пілот</span>' : ''}</td>
    <td>${expertChip(p.resp, 'filter')}</td>
    <td>${p.dup === p.resp ? '<span class="rz-same">— той самий</span>' : expertChip(p.dup, 'filter')}</td>
  </tr>`;

  const sectionRow = label => `<tr class="rz-section-row"><td colspan="4">${label}</td></tr>`;

  let html = '';
  if (main.length) html += main.map(row).join('');
  if (pilots.length) html += sectionRow('🧪 Пілотні / експериментальні проєкти') + pilots.map(row).join('');

  $('rz-table-body').innerHTML = html;
  $('rz-empty').style.display = html ? 'none' : '';

  // Чип експерта в таблиці: клік — фільтр, повторний — особиста сторінка
  $('rz-table-body').querySelectorAll('.rz-exp-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const k = chip.dataset.expert;
      if (filterExpert === k) {
        viewerKey = k;
        renderPersonRow();
        renderPersonal();
        switchTab('my');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        filterExpert = k;
        renderLoadBars();
        renderChips();
        renderTable();
      }
    });
  });
}
