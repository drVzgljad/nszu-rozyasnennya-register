/**
 * «Обстановка» на головній для залогінених: годинник, погода, повітряна
 * тривога, графік відключень світла. Стилі — home-live.css.
 *
 * Джерела (усі без ключів):
 *   погода   — api.open-meteo.com напряму;
 *   тривога  — воркер pmg-alerts (tools/alerts-worker): siren.pp.ua + стрічка
 *              Повітряних сил; браузер ці джерела напряму не читає (CORS);
 *   світло   — дзеркало графіків ДТЕК github.com/Baskerville42/outage-data-ua
 *              (лише м. Київ, Київщина, Дніпропетровщина, Одещина).
 * Вибране місце (область і черга) — таблиця user_home_settings, поки її
 * немає — localStorage.
 */

const ALERTS_URL = 'https://pmg-alerts.doktorvzgljad.workers.dev/';
const OUTAGE_URL = 'https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/';
const MAP_URL = 'assets/ua-oblasts.json';
const TZ = 'Europe/Kyiv';
const LS_KEY = 'pmg-home-place';
const ALERT_POLL_MS = 30000;
const WEATHER_POLL_MS = 15 * 60000;
const POWER_POLL_MS = 10 * 60000;
const LONG_ALERT_DAYS = 30; // довша за місяць тривога — фон окупованих територій, не подія
// Без власного вибору — офіс: черга за адресою з довідника Yasno
// (app.yasno.ua …/addresses/v2/group, просп. Степана Бандери, 19 → група 10.1, перевірено 03.11.2026).
// Відомчої назви тут свідомо немає: головна не має натякати на належність порталу.
const OFFICE = { oblast: 'М.КИЇВ', queue: 'GPV10.1', label: 'Офіс · просп. Степана Бандери, 19' };

// Обласний центр: для погоди і підпису. Для окупованих центрів — найближче
// місто, де працюють державні служби області.
const PLACES = {
  'М.КИЇВ': ['м. Київ', 'Київ', 50.4501, 30.5234],
  'ВІННИЦЬКА': ['Вінницька область', 'Вінниця', 49.2331, 28.4682],
  'ВОЛИНСЬКА': ['Волинська область', 'Луцьк', 50.7472, 25.3254],
  'ДНІПРОПЕТРОВСЬКА': ['Дніпропетровська область', 'Дніпро', 48.4647, 35.0462],
  'ДОНЕЦЬКА': ['Донецька область', 'Краматорськ', 48.7389, 37.5844],
  'ЖИТОМИРСЬКА': ['Житомирська область', 'Житомир', 50.2547, 28.6587],
  'ЗАКАРПАТСЬКА': ['Закарпатська область', 'Ужгород', 48.6208, 22.2879],
  'ЗАПОРІЗЬКА': ['Запорізька область', 'Запоріжжя', 47.8388, 35.1396],
  'ІВАНО-ФРАНКІВСЬКА': ['Івано-Франківська область', 'Івано-Франківськ', 48.9226, 24.7111],
  'КИЇВСЬКА': ['Київська область', 'Біла Церква', 49.7968, 30.1311],
  'КІРОВОГРАДСЬКА': ['Кіровоградська область', 'Кропивницький', 48.5079, 32.2623],
  'ЛУГАНСЬКА': ['Луганська область', 'Сєвєродонецьк', 48.9483, 38.4917],
  'ЛЬВІВСЬКА': ['Львівська область', 'Львів', 49.8397, 24.0297],
  'МИКОЛАЇВСЬКА': ['Миколаївська область', 'Миколаїв', 46.9750, 31.9946],
  'ОДЕСЬКА': ['Одеська область', 'Одеса', 46.4825, 30.7233],
  'ПОЛТАВСЬКА': ['Полтавська область', 'Полтава', 49.5883, 34.5514],
  'РІВНЕНСЬКА': ['Рівненська область', 'Рівне', 50.6199, 26.2516],
  'СУМСЬКА': ['Сумська область', 'Суми', 50.9077, 34.7981],
  'ТЕРНОПІЛЬСЬКА': ['Тернопільська область', 'Тернопіль', 49.5535, 25.5948],
  'ХАРКІВСЬКА': ['Харківська область', 'Харків', 49.9935, 36.2304],
  'ХЕРСОНСЬКА': ['Херсонська область', 'Херсон', 46.6354, 32.6169],
  'ХМЕЛЬНИЦЬКА': ['Хмельницька область', 'Хмельницький', 49.4229, 26.9871],
  'ЧЕРКАСЬКА': ['Черкаська область', 'Черкаси', 49.4444, 32.0598],
  'ЧЕРНІВЕЦЬКА': ['Чернівецька область', 'Чернівці', 48.2921, 25.9358],
  'ЧЕРНІГІВСЬКА': ['Чернігівська область', 'Чернігів', 51.4982, 31.2893],
  'АР КРИМ': ['Автономна Республіка Крим', 'Сімферополь', 44.9521, 34.1024],
  'М.СЕВАСТОПОЛЬ': ['м. Севастополь', 'Севастополь', 44.6166, 33.5254]
};

// Де є машиночитний графік відключень (ДТЕК) і де шукати решту
const POWER_DATA = {
  'М.КИЇВ': { file: 'kyiv', who: 'ДТЕК Київські електромережі' },
  'КИЇВСЬКА': { file: 'kyiv-region', who: 'ДТЕК Київські регіональні електромережі' },
  'ДНІПРОПЕТРОВСЬКА': { file: 'dnipro', who: 'ДТЕК Дніпровські електромережі' },
  'ОДЕСЬКА': { file: 'odesa', who: 'ДТЕК Одеські електромережі' }
};
const POWER_SITES = {
  'ВІННИЦЬКА': ['Вінницяобленерго', 'https://voe.com.ua/'],
  'ВОЛИНСЬКА': ['Волиньобленерго', 'https://energy.volyn.ua/'],
  'ДОНЕЦЬКА': ['ДТЕК Донецькі електромережі', 'https://www.dtek-dem.com.ua/'],
  'ЖИТОМИРСЬКА': ['Житомиробленерго', 'https://ztoe.com.ua/'],
  'ЗАКАРПАТСЬКА': ['Закарпаттяобленерго', 'https://zakarpat.energy/'],
  'ЗАПОРІЗЬКА': ['Запоріжжяобленерго', 'https://zoe.com.ua/'],
  'ІВАНО-ФРАНКІВСЬКА': ['Прикарпаттяобленерго', 'https://svitlo.oe.if.ua/'],
  'КІРОВОГРАДСЬКА': ['Кіровоградобленерго', 'https://kiroe.com.ua/'],
  'ЛЬВІВСЬКА': ['Львівобленерго', 'https://poweron.loe.lviv.ua/'],
  'ПОЛТАВСЬКА': ['Полтаваобленерго', 'https://www.poe.pl.ua/'],
  'РІВНЕНСЬКА': ['Рівнеобленерго', 'https://www.roe.vsei.ua/'],
  'СУМСЬКА': ['Сумиобленерго', 'https://soe.com.ua/'],
  'ТЕРНОПІЛЬСЬКА': ['Тернопільобленерго', 'https://toe.com.ua/'],
  'ХАРКІВСЬКА': ['Харківобленерго', 'https://oblenergo.kharkiv.ua/'],
  'ХЕРСОНСЬКА': ['Херсонобленерго', 'https://ksoe.com.ua/'],
  'ХМЕЛЬНИЦЬКА': ['Хмельницькобленерго', 'https://hoe.com.ua/'],
  'ЧЕРКАСЬКА': ['Черкасиобленерго', 'https://www.cherkasyoblenergo.com/'],
  'ЧЕРНІВЕЦЬКА': ['Чернівціобленерго', 'https://oblenergo.cv.ua/']
};

const ALERT_TYPES = {
  AIR: 'Повітряна тривога', ARTILLERY: 'Загроза артобстрілу', URBAN_FIGHTS: 'Вуличні бої',
  CHEMICAL: 'Хімічна загроза', NUCLEAR: 'Радіаційна загроза', INFO: 'Інформація'
};

// Тип загрози: підпис, колір (змінна з home-live.css) і силует для мапи та стрічки
const KINDS = {
  ballistic: { label: 'Балістика', d: 'M3 20 Q8 4 19 7', head: [19, 7], stroke: true },
  missile: { label: 'Ракети', d: 'M12 2c2.6 2.1 3.6 5 3.6 8.2v5.4l2.4 3.4H6l2.4-3.4v-5.4C8.4 7 9.4 4.1 12 2z' },
  kab: { label: 'КАБи', d: 'M12 2.5c2.3 0 3.6 2.6 3.6 6v6.2l2.4 3.3v2.5H6V18l2.4-3.3V8.5c0-3.4 1.3-6 3.6-6z' },
  jet: { label: 'Реактивні БпЛА', d: 'M12 2 20.5 17 12 13.8 3.5 17zM10.6 15l1.4 7 1.4-7z' },
  drone: { label: 'Ударні БпЛА', d: 'M12 3.5 21 19l-9-3.6L3 19z' },
  aviation: { label: 'Авіація', d: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z' },
  other: { label: 'Інше', d: 'M11 6h2v8h-2zm0 10h2v2h-2z' }
};

const WMO = {
  0: ['Ясно', 'clear'], 1: ['Переважно ясно', 'clear'], 2: ['Мінлива хмарність', 'partly'],
  3: ['Хмарно', 'cloudy'], 45: ['Туман', 'fog'], 48: ['Паморозь і туман', 'fog'],
  51: ['Слабка мряка', 'drizzle'], 53: ['Мряка', 'drizzle'], 55: ['Густа мряка', 'drizzle'],
  56: ['Крижана мряка', 'drizzle'], 57: ['Крижана мряка', 'drizzle'],
  61: ['Невеликий дощ', 'rain'], 63: ['Дощ', 'rain'], 65: ['Сильний дощ', 'rain'],
  66: ['Крижаний дощ', 'rain'], 67: ['Крижаний дощ', 'rain'],
  71: ['Невеликий сніг', 'snow'], 73: ['Сніг', 'snow'], 75: ['Сильний сніг', 'snow'], 77: ['Снігова крупа', 'snow'],
  80: ['Короткочасний дощ', 'rain'], 81: ['Злива', 'rain'], 82: ['Сильна злива', 'rain'],
  85: ['Снігопад', 'snow'], 86: ['Сильний снігопад', 'snow'],
  95: ['Гроза', 'storm'], 96: ['Гроза з градом', 'storm'], 99: ['Гроза з сильним градом', 'storm']
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (root, sel) => root.querySelector(sel);

/* ── Київський час ───────────────────────────────────────────── */
const kyivFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
});
function kyivNow(d = new Date()) {
  const p = Object.fromEntries(kyivFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second,
    dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1
  };
}
const hhmm = (iso) => new Date(iso).toLocaleTimeString('uk-UA', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const pad = (n) => String(n).padStart(2, '0');

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
function duration(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return 'щойно';
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d >= 2) return `${d} ${plural(d, 'день', 'дні', 'днів')}`;
  if (d === 1) return `1 день ${h} год`;
  return h ? `${h} год ${m} хв` : `${m} хв`;
}
function sinceLabel(iso) {
  const t = new Date(iso);
  const sameDay = t.toLocaleDateString('uk-UA', { timeZone: TZ }) === new Date().toLocaleDateString('uk-UA', { timeZone: TZ });
  return sameDay ? `з ${hhmm(iso)}`
    : `з ${t.toLocaleDateString('uk-UA', { timeZone: TZ, day: 'numeric', month: 'long', year: Date.now() - t > 300 * 864e5 ? 'numeric' : undefined })}`;
}

/* ── Збереження вибору місця ─────────────────────────────────── */
let sb = null, userId = null, tableMissing = false;
function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}
function writeLocal(p) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* приватне вікно */ }
}
async function loadPlace() {
  let place = readLocal() || { oblast: OFFICE.oblast, queue: OFFICE.queue };
  if (!sb || !userId) return place;
  try {
    const { data, error } = await sb.from('user_home_settings').select('home_place').eq('user_id', userId).maybeSingle();
    if (error) { tableMissing = true; return place; }
    if (data?.home_place?.oblast && PLACES[data.home_place.oblast]) {
      place = { oblast: data.home_place.oblast, queue: data.home_place.queue || null };
      writeLocal(place);
    } else if (readLocal()) {
      // Вибір зроблено ще до міграції — переносимо його в профіль
      savePlace(place);
    }
  } catch { tableMissing = true; }
  return place;
}
async function savePlace(p) {
  writeLocal(p);
  if (!sb || !userId || tableMissing) return;
  const { error } = await sb.from('user_home_settings')
    .upsert({ user_id: userId, home_place: p, updated_at: new Date().toISOString() });
  if (error) tableMissing = true;
}

/* ── Каркас ──────────────────────────────────────────────────── */
let root = null, place = null, mounted = false;
const timers = [];
const state = { weather: null, alerts: null, map: null, power: {} };

function skeleton() {
  root.innerHTML = `
    <div class="hl-head">
      <button type="button" class="hl-place" data-act="place" title="Змінити область і чергу">📍 <span data-f="place"></span> ▾</button>
    </div>
    <div class="hl-grid">
      <article class="hl-card hl-clock" aria-label="Київський час">
        <h3><span>Київ · час</span></h3>
        <div class="hl-clock-body">
          <svg class="hl-dial" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="face" cx="50" cy="50" r="46"/>
            ${Array.from({ length: 60 }, (_, i) => {
              const major = i % 5 === 0, a = i * 6 * Math.PI / 180, r1 = major ? 36 : 40, r2 = 43;
              return `<line class="tick${major ? ' major' : ''}" x1="${(50 + r1 * Math.sin(a)).toFixed(2)}" y1="${(50 - r1 * Math.cos(a)).toFixed(2)}" x2="${(50 + r2 * Math.sin(a)).toFixed(2)}" y2="${(50 - r2 * Math.cos(a)).toFixed(2)}"/>`;
            }).join('')}
            <line class="hand h" data-f="hh" x1="50" y1="50" x2="50" y2="27"/>
            <line class="hand m" data-f="mh" x1="50" y1="50" x2="50" y2="17"/>
            <line class="hand s" data-f="sh" x1="50" y1="58" x2="50" y2="13"/>
            <circle class="pin" cx="50" cy="50" r="2.6"/>
          </svg>
          <div class="hl-digits">
            <div class="hl-time" data-f="time"></div>
            <div class="hl-date" data-f="date"></div>
            <div class="hl-date-sub" data-f="datesub"></div>
          </div>
        </div>
        <div class="hl-sun" data-f="sun">Схід і захід сонця з'являться разом із погодою</div>
      </article>

      <article class="hl-card hl-weather" aria-label="Погода">
        <h3><span>Погода · <span data-f="city"></span></span><span class="hl-hclock" aria-hidden="true"><b data-f="htime"></b><span data-f="hdate"></span></span></h3>
        <div data-f="wx"><div class="hl-muted">Завантажую прогноз…</div></div>
      </article>

      <article class="hl-card hl-power" aria-label="Відключення світла">
        <h3><span>Світло · графік відключень</span><span data-f="pwq"></span></h3>
        <div data-f="pw"><div class="hl-muted">Завантажую графік…</div></div>
      </article>

      <article class="hl-card hl-alert" aria-label="Повітряна тривога">
        <h3><span>Повітряна тривога</span><span class="hl-alert-tools"><span class="hl-muted" data-f="aupd"></span><button type="button" class="hl-place hl-place-in" data-act="place" title="Змінити область і чергу">📍 <span data-f="place"></span> ▾</button></span></h3>
        <div class="hl-alert-body">
          <div class="hl-map" data-f="map"><div class="hl-muted">Завантажую мапу…</div></div>
          <div class="hl-aside" data-f="aside"><div class="hl-muted">Завантажую стан тривог…</div></div>
        </div>
      </article>
    </div>`;
  if (!root.dataset.bound) {
    root.dataset.bound = '1';
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
  }
}

function onClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'place') openPlaceDialog();
  const ob = e.target.closest('.ob');
  if (ob && ob.dataset.key && ob.dataset.key !== place.oblast) {
    // Клік по області на мапі — швидкий спосіб змінити своє місце
    setPlace({ oblast: ob.dataset.key, queue: null });
  }
}
function onChange(e) {
  if (e.target.matches('[data-f="queue"]')) setPlace({ ...place, queue: e.target.value });
}
function setPlace(p) {
  const oblastChanged = p.oblast !== place.oblast;
  place = p;
  savePlace(p);
  renderPlace();
  if (oblastChanged) loadWeather();
  loadPower();
  renderAlerts();
}
function renderPlace() {
  root.querySelectorAll('[data-f="place"]').forEach((el) => { el.textContent = PLACES[place.oblast][0]; });
  $(root, '[data-f="city"]').textContent = PLACES[place.oblast][1];
}

function openPlaceDialog() {
  let dlg = document.getElementById('hl-place-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'hl-place-dialog';
    dlg.className = 'hl-dialog';
    document.body.appendChild(dlg);
  }
  const opts = Object.entries(PLACES)
    .sort((a, b) => (a[0] === 'М.КИЇВ' ? -1 : b[0] === 'М.КИЇВ' ? 1 : a[1][0].localeCompare(b[1][0], 'uk')))
    .map(([k, v]) => `<option value="${esc(k)}"${k === place.oblast ? ' selected' : ''}>${esc(v[0])}${POWER_DATA[k] ? ' · є графік світла' : ''}</option>`).join('');
  dlg.innerHTML = `
    <form method="dialog">
      <h4>📍 Моє місце</h4>
      <label for="hl-dlg-oblast">Область</label>
      <select class="hl-select" id="hl-dlg-oblast">${opts}</select>
      <p>Від області залежать погода (за обласним центром), виділення на мапі тривог і графік світла.
        Чергу відключень оберете в панелі «Світло». ${tableMissing ? 'Вибір зберігається в цьому браузері.' : 'Вибір зберігається у вашому профілі.'}</p>
      <div class="hl-dialog-actions">
        <button class="hl-btn" value="cancel">Скасувати</button>
        <button class="hl-btn primary" value="ok">Зберегти</button>
      </div>
    </form>`;
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const v = dlg.querySelector('#hl-dlg-oblast').value;
    if (v !== place.oblast) setPlace({ oblast: v, queue: null });
  };
  if (typeof dlg.showModal === 'function') dlg.showModal();
}

/* ── Годинник ────────────────────────────────────────────────── */
let lastSec = -1;
function tick() {
  const k = kyivNow();
  if (k.s === lastSec) return;
  lastSec = k.s;
  const daySec = k.h * 3600 + k.mi * 60 + k.s;
  // Кути накопичувальні: секундна стрілка не відкручується назад на 59→0
  const sh = $(root, '[data-f="sh"]');
  if (k.s === 0) {
    sh.style.transition = 'none';
    sh.style.transform = 'rotate(0deg)';
    sh.getBoundingClientRect();
    sh.style.transition = '';
  } else {
    sh.style.transform = `rotate(${k.s * 6}deg)`;
  }
  $(root, '[data-f="mh"]').style.transform = `rotate(${(k.mi + k.s / 60) * 6}deg)`;
  $(root, '[data-f="hh"]').style.transform = `rotate(${(daySec / 3600) * 30}deg)`;
  $(root, '[data-f="htime"]').textContent = `${pad(k.h)}:${pad(k.mi)}`;
  $(root, '[data-f="time"]').innerHTML = `${pad(k.h)}<span class="colon">:</span>${pad(k.mi)}<span class="sec">${pad(k.s)}</span>`;
  if (k.s === 0 || !$(root, '[data-f="date"]').textContent) {
    const now = new Date();
    const wd = now.toLocaleDateString('uk-UA', { timeZone: TZ, weekday: 'long' });
    const dm = now.toLocaleDateString('uk-UA', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
    $(root, '[data-f="date"]').textContent = `${wd[0].toUpperCase()}${wd.slice(1)}, ${dm}`;
    $(root, '[data-f="hdate"]').textContent = `${now.toLocaleDateString('uk-UA', { timeZone: TZ, weekday: 'short' })}, ${now.toLocaleDateString('uk-UA', { timeZone: TZ, day: 'numeric', month: 'long' })}`;
    const utc = Date.UTC(k.y, k.mo - 1, k.d);
    const doy = Math.round((utc - Date.UTC(k.y, 0, 1)) / 864e5) + 1;
    const th = new Date(utc + (4 - k.dow) * 864e5); // ISO-тиждень: четвер того ж тижня
    const week = Math.ceil(((th - Date.UTC(th.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
    $(root, '[data-f="datesub"]').textContent = `${week}-й тиждень · ${doy}-й день року`;
    renderAlertTimes();
  }
}

/* ── Погода ──────────────────────────────────────────────────── */
function wxIcon(code, isDay, small = false) {
  const kind = (WMO[code] || ['', 'cloudy'])[1];
  const sun = `<g><g class="sun-rays">${Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4;
    return `<line x1="${32 + 17 * Math.cos(a)}" y1="${32 + 17 * Math.sin(a)}" x2="${32 + 23 * Math.cos(a)}" y2="${32 + 23 * Math.sin(a)}"/>`;
  }).join('')}</g><circle class="sun-core" cx="32" cy="32" r="11"/></g>`;
  const moon = `<g><path class="moon" d="M38 14a16 16 0 1 0 12 26A13 13 0 0 1 38 14z"/>${small ? '' : '<circle class="star" cx="14" cy="16" r="1.6"/><circle class="star" cx="22" cy="8" r="1.2"/><circle class="star" cx="52" cy="12" r="1.4"/>'}</g>`;
  const cloud = (cls = '', dx = 0, dy = 0) => `<path class="cloud ${cls}" transform="translate(${dx} ${dy})" d="M20 46a8 8 0 0 1-.5-16a12 12 0 0 1 23-4a11 11 0 0 1 7.5 20z"/>`;
  const skyBody = isDay ? sun : moon;
  let inner;
  switch (kind) {
    case 'clear': inner = skyBody; break;
    case 'partly': inner = `<g transform="translate(-8 -8) scale(.85)">${skyBody}</g>${cloud('', 4, 6)}`; break;
    case 'cloudy': inner = `${cloud('back', -8, -6)}${cloud('', 2, 2)}`; break;
    case 'fog': inner = `${cloud('back', 0, -8)}<line class="fog" x1="12" y1="46" x2="52" y2="46"/><line class="fog" x1="16" y1="53" x2="48" y2="53"/>`; break;
    case 'drizzle':
    case 'rain': inner = `${cloud('dark', 0, -6)}<line class="drop" x1="24" y1="46" x2="22" y2="52"/><line class="drop" x1="33" y1="46" x2="31" y2="52"/><line class="drop" x1="42" y1="46" x2="40" y2="52"/>`; break;
    case 'snow': inner = `${cloud('', 0, -6)}<circle class="flake" cx="24" cy="48" r="2.4"/><circle class="flake" cx="33" cy="50" r="2.4"/><circle class="flake" cx="42" cy="48" r="2.4"/>`; break;
    case 'storm': inner = `${cloud('dark', 0, -6)}<path class="bolt" d="M34 40l-8 12h6l-3 9 10-13h-6l4-8z"/>`; break;
    default: inner = cloud();
  }
  return `<svg class="wxi" viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;
}
function wxMood(code, isDay) {
  const kind = (WMO[code] || ['', 'cloudy'])[1];
  if (kind === 'clear' || kind === 'partly') return isDay ? 'wx-clear-day' : 'wx-clear-night';
  return { cloudy: 'wx-cloudy', fog: 'wx-fog', drizzle: 'wx-rain', rain: 'wx-rain', snow: 'wx-snow', storm: 'wx-storm' }[kind] || 'wx-cloudy';
}
const WIND = ['пн', 'пн-сх', 'сх', 'пд-сх', 'пд', 'пд-зх', 'зх', 'пн-зх'];

async function loadWeather() {
  const [, , lat, lon] = PLACES[place.oblast];
  const box = $(root, '[data-f="wx"]');
  try {
    const q = new URLSearchParams({
      latitude: lat, longitude: lon, timezone: TZ, forecast_days: '2', wind_speed_unit: 'ms',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m',
      hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
      daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max'
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!r.ok) throw new Error(r.status);
    state.weather = await r.json();
    renderWeather();
  } catch (e) {
    console.warn('home-live: погода', e);
    if (!state.weather) box.innerHTML = '<div class="hl-muted">Прогноз зараз недоступний — спробую ще раз за кілька хвилин.</div>';
  }
}
function renderWeather() {
  const w = state.weather, c = w.current;
  const card = $(root, '.hl-weather');
  card.className = `hl-card hl-weather ${wxMood(c.weather_code, c.is_day)}`;
  const [desc] = WMO[c.weather_code] || ['—'];
  // Найближчі 18 годин через 3: «коротко на день»
  const nowIdx = Math.max(0, w.hourly.time.findIndex((t) => t >= c.time.slice(0, 13) + ':00'));
  const hours = [];
  for (let i = nowIdx + 1; i < w.hourly.time.length && hours.length < 6; i += 3) hours.push(i);
  const t = (v) => `${Math.round(v) > 0 ? '+' : ''}${Math.round(v)}°`;
  const d = w.daily;
  $(root, '[data-f="wx"]').innerHTML = `
    <div class="hl-wx-now">
      <div class="hl-wx-icon">${wxIcon(c.weather_code, c.is_day)}</div>
      <div>
        <div class="hl-wx-temp">${t(c.temperature_2m)}</div>
        <div class="hl-wx-desc">${esc(desc)}</div>
        <div class="hl-wx-meta hl-muted">Відчувається як ${t(c.apparent_temperature)} · 💨 ${Math.round(c.wind_speed_10m)} м/с ${WIND[Math.round(c.wind_direction_10m / 45) % 8]} · 💧 ${c.relative_humidity_2m}%</div>
      </div>
    </div>
    <div class="hl-wx-hours">${hours.map((i) => `
      <div class="hl-wx-hour" title="${esc((WMO[w.hourly.weather_code[i]] || ['—'])[0])}">
        <span class="hl-muted">${w.hourly.time[i].slice(11, 16)}</span>
        ${wxIcon(w.hourly.weather_code[i], w.hourly.is_day[i], true)}
        <span class="t">${t(w.hourly.temperature_2m[i])}</span>
        <span class="p">${w.hourly.precipitation_probability[i] >= 20 ? `${w.hourly.precipitation_probability[i]}%` : '&nbsp;'}</span>
      </div>`).join('')}
    </div>
    <div class="hl-wx-day">Сьогодні: <b>${t(d.temperature_2m_min[0])} … ${t(d.temperature_2m_max[0])}</b>${d.precipitation_probability_max[0] >= 20 ? ` · ймовірність опадів ${d.precipitation_probability_max[0]}%` : ' · без опадів'} · завтра ${t(d.temperature_2m_min[1])} … ${t(d.temperature_2m_max[1])}</div>
    <div class="hl-src">Open-Meteo · оновлено ${c.time.slice(11, 16)}</div>`;
  const rise = d.sunrise[0].slice(11, 16), set = d.sunset[0].slice(11, 16);
  const len = (new Date(d.sunset[0]) - new Date(d.sunrise[0])) / 60000;
  $(root, '[data-f="sun"]').innerHTML = `🌅 <b>${rise}</b> → 🌇 <b>${set}</b> · світловий день ${Math.floor(len / 60)} год ${Math.round(len % 60)} хв <span class="hl-muted">(${esc(PLACES[place.oblast][1])})</span>`;
}

/* ── Світло ──────────────────────────────────────────────────── */
// Значення джерела → дві половини години: on / off / maybe
const HALVES = {
  yes: ['on', 'on'], no: ['off', 'off'], first: ['off', 'on'], second: ['on', 'off'],
  maybe: ['maybe', 'maybe'], mfirst: ['maybe', 'on'], msecond: ['on', 'maybe']
};
function dayHalves(hours) {
  const out = [];
  for (let h = 1; h <= 24; h++) out.push(...(HALVES[hours?.[h] ?? hours?.[String(h)]] || ['on', 'on']));
  return out;
}

async function loadPower() {
  const box = $(root, '[data-f="pw"]');
  const src = POWER_DATA[place.oblast];
  if (!src) { $(root, '[data-f="pwq"]').innerHTML = ''; renderPowerUnsupported(box); return; }
  try {
    let d = state.power[src.file];
    if (!d || Date.now() - d._at > POWER_POLL_MS - 5000) {
      const r = await fetch(`${OUTAGE_URL}${src.file}.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      d = await r.json();
      d._at = Date.now();
      state.power[src.file] = d;
    }
    renderPower(d, src);
  } catch (e) {
    console.warn('home-live: світло', e);
    box.innerHTML = '<div class="hl-note">Графік зараз не завантажився. Спробую ще раз за кілька хвилин.</div>';
  }
}
function renderPowerUnsupported(box) {
  const site = POWER_SITES[place.oblast];
  const name = PLACES[place.oblast][0];
  const occupied = ['ЛУГАНСЬКА', 'АР КРИМ', 'М.СЕВАСТОПОЛЬ'].includes(place.oblast);
  box.innerHTML = `
    <div class="hl-note">
      ${occupied
        ? `Для регіону «${esc(name)}» графіків відключень немає.`
        : `Для регіону «${esc(name)}» обленерго не публікує графік у відкритому машиночитному вигляді, тож показати свою чергу тут не вийде.
           ${site ? `Актуальний графік — на сайті <a href="${site[1]}" target="_blank" rel="noopener">${esc(site[0])} ↗</a>.`
                  : `Пошукайте графік на сайті свого обленерго.`}`}
    </div>
    <div class="hl-src">Машиночитні графіки зараз є для м. Києва, Київщини, Дніпропетровщини й Одещини (ДТЕК).</div>`;
}
function renderPower(d, src) {
  const box = $(root, '[data-f="pw"]');
  const names = d.preset?.sch_names || {};
  const fact = d.fact || {};
  // Ключі fact.data — київська північ у секундах. Після опівночі джерело ще
  // якийсь час тримає вчорашній «today», тож день шукаємо за датою, а не за ним
  const kyivDate = (ms) => new Date(ms).toLocaleDateString('uk-UA', { timeZone: TZ });
  const dayKey = (ms) => Object.keys(fact.data || {}).find((key) => kyivDate(+key * 1000 + 3 * 3600e3) === kyivDate(ms));
  const todayFact = fact.data?.[dayKey(Date.now())] || null;
  const tomorrowFact = fact.data?.[dayKey(Date.now() + 864e5)] || null;
  const groups = Object.keys(todayFact || d.preset?.data || {})
    .sort((a, b) => a.localeCompare(b, 'uk', { numeric: true }));
  if (!groups.length) { box.innerHTML = '<div class="hl-note">У джерелі зараз немає графіка для цього регіону.</div>'; return; }
  const isOffice = place.oblast === OFFICE.oblast;
  const wanted = place.queue || (isOffice ? OFFICE.queue : null);
  const queue = groups.includes(wanted) ? wanted : null;
  const qName = (g) => `${names[g] || g.replace('GPV', 'Черга ')}${isOffice && g === OFFICE.queue ? ' · офіс' : ''}`;
  const select = `<select class="hl-select" data-f="queue" aria-label="Моя черга"${isOffice && queue === OFFICE.queue ? ` title="${esc(OFFICE.label)}"` : ''}>
      ${queue ? '' : '<option value="" selected>Оберіть свою чергу…</option>'}
      ${groups.map((g) => `<option value="${esc(g)}"${g === queue ? ' selected' : ''}>${esc(qName(g))}</option>`).join('')}
    </select>`;
  const srcLine = `<div class="hl-src">${esc(src.who)} · графік від ${esc(fact.update || d.preset?.updateFact || '—')} · <a href="https://github.com/Baskerville42/outage-data-ua" target="_blank" rel="noopener">outage-data-ua</a></div>`;
  // Вибір черги — у заголовку картки: так графік не росте вниз і вміщається в екран
  $(root, '[data-f="pwq"]').innerHTML = select;
  if (!queue) {
    box.innerHTML = `<div class="hl-note">Оберіть свою чергу вгорі картки — і тут з'явиться, коли світло є, а коли ні. Черга — у квитанції, особовому кабінеті або на сайті ДТЕК.</div>${srcLine}`;
    return;
  }
  const k = kyivNow();
  const planned = !todayFact?.[queue];
  const today = dayHalves(todayFact?.[queue] || d.preset?.data?.[queue]?.[k.dow]);
  const tomorrow = tomorrowFact?.[queue] ? dayHalves(tomorrowFact[queue]) : null;
  const nowIdx = k.h * 2 + (k.mi >= 30 ? 1 : 0);
  const seq = today.concat(tomorrow || []);
  const cur = seq[nowIdx];
  let j = nowIdx;
  while (j < seq.length && seq[j] === cur) j++;
  const slotTime = (idx) => `${pad(Math.floor((idx % 48) / 2))}:${idx % 2 ? '30' : '00'}`;
  const inMin = (j * 30) - (k.h * 60 + k.mi);
  const nextTxt = j >= seq.length
    ? (cur === 'on' ? 'Відключень до кінця графіка не заплановано' : 'До кінця графіка без змін')
    : `${cur === 'on' ? 'Можливе відключення' : 'Світло за графіком повернеться'} о ${slotTime(j)}${j >= 48 ? ' (завтра)' : ''} · через ${duration(inMin * 60000)}`;
  const main = { on: 'Зараз світло є', off: 'Зараз відключення', maybe: 'Зараз можливе відключення' }[cur];
  const offHours = today.filter((x) => x === 'off').length / 2;
  const bar = (arr, withNow) => `<div class="hl-bar" role="img" aria-label="Графік на добу">
      ${arr.map((x, i) => `<i class="${x}" title="${slotTime(i)}–${slotTime(i + 1)}: ${{ on: 'світло є', off: 'відключення', maybe: 'можливе відключення' }[x]}"></i>`).join('')}
      ${withNow ? `<span class="now" style="left: calc(${((k.h * 60 + k.mi) / 1440) * 100}% - 1px)"></span>` : ''}
    </div>
    <div class="hl-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>`;
  box.innerHTML = `
    <div class="hl-pw-status">
      <div class="hl-bulb ${cur === 'on' ? 'on' : 'off'}" aria-hidden="true">💡</div>
      <div><div class="hl-pw-main">${main}</div><div class="hl-pw-next">${nextTxt}</div>
        <div class="hl-pw-next hl-pw-where">📍 ${isOffice && queue === OFFICE.queue ? `${esc(OFFICE.label)} · ` : ''}${esc(names[queue] || queue)}</div></div>
    </div>
    <div class="hl-pw-row">
      <div class="hl-pw-row-lbl"><span>Сьогодні${planned ? ' · за тижневим планом' : ''}</span><span>без світла ${String(offHours).replace('.', ',')} год</span></div>
      ${bar(today, true)}
    </div>
    ${tomorrow ? `<div class="hl-pw-row"><div class="hl-pw-row-lbl"><span>Завтра</span><span>без світла ${String(tomorrow.filter((x) => x === 'off').length / 2).replace('.', ',')} год</span></div>${bar(tomorrow, false)}</div>` : ''}
    <div class="hl-legend">
      <span><i style="background: var(--hl-on)"></i>світло є</span>
      <span><i style="background: var(--hl-off)"></i>відключення</span>
      <span><i style="background: repeating-linear-gradient(135deg, var(--hl-maybe) 0 3px, transparent 3px 6px)"></i>можливе</span>
    </div>
    ${srcLine}`;
}

/* ── Повітряна тривога ───────────────────────────────────────── */
function glyph(kind, x, y, size) {
  const g = KINDS[kind] || KINDS.other;
  const s = size / 24;
  const t = `transform="translate(${(x - size / 2).toFixed(1)} ${(y - size / 2).toFixed(1)}) scale(${s.toFixed(3)})"`;
  if (g.stroke) {
    return `<g ${t}><path class="mk-glyph stroke" d="${g.d}"/><circle class="mk-glyph" cx="${g.head[0]}" cy="${g.head[1]}" r="3"/></g>`;
  }
  return `<path class="mk-glyph" ${t} d="${g.d}"/>`;
}
function kindIcon(kind) {
  const g = KINDS[kind] || KINDS.other;
  const body = g.stroke
    ? `<path d="${g.d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="${g.head[0]}" cy="${g.head[1]}" r="3" fill="currentColor"/>`
    : `<path d="${g.d}" fill="currentColor"/>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
const kindColor = (kind) => `var(--hl-k-${KINDS[kind] ? kind : 'other'})`;

async function loadMap() {
  try {
    const r = await fetch(MAP_URL);
    state.map = await r.json();
  } catch (e) {
    console.warn('home-live: мапа', e);
  }
}
async function loadAlerts() {
  try {
    const r = await fetch(ALERTS_URL);
    if (!r.ok) throw new Error(r.status);
    state.alerts = await r.json();
    state.alertsAt = Date.now();
  } catch (e) {
    console.warn('home-live: тривоги', e);
    state.alertsError = true;
  }
  renderAlerts();
}

function oblastLevel(o) {
  if (!o || o.level === 'none') return 'none';
  if (o.level === 'full' && o.since && Date.now() - new Date(o.since) > LONG_ALERT_DAYS * 864e5) return 'long';
  return o.level;
}

function renderAlerts() {
  if (!root) return;
  const a = state.alerts;
  const aside = $(root, '[data-f="aside"]');
  const mapBox = $(root, '[data-f="map"]');
  if (!a || !a.oblasts) {
    aside.innerHTML = `<div class="hl-note">${state.alertsError ? 'Стан тривог зараз недоступний. Перевірте офіційний застосунок «Повітряна тривога». Спробую ще раз за пів хвилини.' : 'Завантажую стан тривог…'}</div>`;
    return;
  }
  const recent = (a.threats || []).filter((t) => Date.now() - new Date(t.at) < 45 * 60000);

  // Мапа
  if (state.map) {
    const [, , vw, vh] = state.map.meta.viewBox.split(' ').map(Number);
    const paths = Object.entries(state.map.oblasts).map(([k, o]) => {
      const lvl = oblastLevel(a.oblasts[k]);
      return `<path class="ob ${lvl}${k === place.oblast ? ' me' : ''}" data-key="${esc(k)}" d="${o.d}"/>`;
    }).join('');
    // Обраний регіон — поверх сусідів, щоб його обвідку не перекривали
    const markers = [];
    const seen = new Set();
    recent.forEach((t) => t.oblasts.forEach((k) => {
      const id = `${k}|${t.kind}`;
      const o = state.map.oblasts[k];
      if (!o || seen.has(id)) return;
      seen.add(id);
      const n = markers.filter((m) => m.k === k).length;
      markers.push({ k, kind: t.kind, x: o.cx + n * 44, y: o.cy - 4 });
    }));
    mapBox.innerHTML = `
      <svg viewBox="0 0 ${vw} ${vh}" role="img" aria-label="Мапа тривог за областями">
        <defs>
          <pattern id="hl-hatch-part" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="var(--hl-map-calm)"/><rect width="5" height="10" fill="var(--hl-map-part)"/>
          </pattern>
          <pattern id="hl-hatch-long" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="9" height="9" fill="var(--hl-map-calm)"/><rect width="3" height="9" fill="var(--hl-map-long)"/>
          </pattern>
        </defs>
        ${paths}
        ${markers.map((m) => `
          <g class="mk">
            <circle class="mk-ring" cx="${m.x}" cy="${m.y}" r="22" style="stroke: ${kindColor(m.kind)}"/>
            <circle class="mk-dot" cx="${m.x}" cy="${m.y}" r="20" style="fill: ${kindColor(m.kind)}"/>
            ${glyph(m.kind, m.x, m.y, 24)}
          </g>`).join('')}
      </svg>
      <div class="hl-map-tip" hidden></div>
      <div class="hl-legend">
        <span><i style="background: var(--hl-map-full)"></i>тривога в області</span>
        <span><i style="background: repeating-linear-gradient(45deg, var(--hl-map-part) 0 4px, var(--hl-map-calm) 4px 8px)"></i>у частині районів</span>
        <span><i style="background: repeating-linear-gradient(45deg, var(--hl-map-long) 0 3px, var(--hl-map-calm) 3px 7px)"></i>триває понад місяць</span>
        <span><i style="background: var(--hl-map-calm)"></i>спокійно</span>
      </div>`;
    bindMapTips(mapBox);
  }

  // Моя область
  const mine = a.oblasts[place.oblast] || { level: 'none', types: [], parts: [] };
  const lvl = oblastLevel(mine);
  const stateTxt = {
    full: 'Повітряна тривога',
    long: 'Повітряна тривога (тривала)',
    part: 'Тривога в частині області',
    none: mine.types?.length ? 'Повітряної тривоги немає' : 'Тривоги немає'
  }[lvl];
  // Тривога у своїй області — вогник біжить по краю картки (home-live.css, .is-alarm).
  // Тривалий фон окупованих територій вогника не вмикає: це не подія
  $(root, '.hl-alert').classList.toggle('is-alarm', lvl === 'full' || lvl === 'part');
  const otherTypes = (mine.types || []).filter((t) => t !== 'AIR');
  const myThreats = (a.threats || []).filter((t) => t.oblasts.includes(place.oblast) && Date.now() - new Date(t.at) < 90 * 60000);
  const myKinds = [...new Set(myThreats.map((t) => t.kind))];
  const parts = (mine.parts || []).filter((p) => p.type === 'AIR');
  const fullCount = Object.values(a.oblasts).filter((o) => oblastLevel(o) === 'full').length;
  const partCount = Object.values(a.oblasts).filter((o) => oblastLevel(o) === 'part').length;
  const feed = (a.threats || []).slice(0, 7);

  aside.innerHTML = `
    <div class="hl-me ${lvl === 'long' ? 'full' : lvl}">
      <span class="hl-me-dot" aria-hidden="true"></span>
      <div>
        <div class="hl-me-place">${esc(PLACES[place.oblast][0])}</div>
        <div class="hl-me-state">${stateTxt}</div>
        <div class="hl-me-since" data-since="${lvl === 'full' || lvl === 'long' ? esc(mine.since || '') : ''}"></div>
      </div>
    </div>
    ${myKinds.length || otherTypes.length ? `<div class="hl-sub">Згадки вашого регіону за 1,5 год</div><div class="hl-chips">
      ${myKinds.map((k) => `<span class="hl-chip" style="color: ${kindColor(k)}">${kindIcon(k)}${esc(KINDS[k]?.label || 'Загроза')}</span>`).join('')}
      ${otherTypes.map((t) => `<span class="hl-chip">⚠ ${esc(ALERT_TYPES[t] || t)}</span>`).join('')}
    </div>` : ''}
    ${lvl === 'part' && parts.length ? `<ul class="hl-parts">${parts.slice(0, 5).map((p) => `<li><span>${esc(p.name)}</span><span data-since="${esc(p.since)}"></span></li>`).join('')}${parts.length > 5 ? `<li><span class="hl-muted">і ще ${parts.length - 5}</span><span></span></li>` : ''}</ul>` : ''}
    <div class="hl-summary">Зараз тривога в <b>${fullCount}</b> ${plural(fullCount, 'області', 'областях', 'областях')} повністю й у <b>${partCount}</b> — частково.</div>
    <div class="hl-sub">Загрози за даними Повітряних сил</div>
    ${feed.length ? `<ul class="hl-feed">${feed.map((t) => `
      <li class="${t.oblasts.includes(place.oblast) ? 'mine' : ''}">
        <span class="ic" style="color: ${kindColor(t.kind)}; background: color-mix(in srgb, ${kindColor(t.kind)} 14%, transparent)">${kindIcon(t.kind)}</span>
        <time datetime="${esc(t.at)}">${hhmm(t.at)}</time>
        <span class="tx"><span class="kind" style="color: ${kindColor(t.kind)}">${esc(KINDS[t.kind]?.label || 'Інше')}</span>${esc(t.text)}</span>
      </li>`).join('')}</ul>` : '<div class="hl-muted" style="font-size: 13px">За останні три години повідомлень про загрози немає.</div>'}
    <div class="hl-src">Стан тривог — API «Повітряна тривога» (через ${esc(a.sources?.state || '—')}); загрози — стрічка Повітряних сил ЗСУ, тип визначено автоматично за текстом, тож це орієнтир, а не офіційний сигнал. Укриття — за сиреною й офіційним застосунком.</div>`;
  renderAlertTimes();
}
function renderAlertTimes() {
  if (!root) return;
  root.querySelectorAll('[data-since]').forEach((el) => {
    const iso = el.dataset.since;
    if (!iso) { el.textContent = ''; return; }
    el.textContent = el.classList.contains('hl-me-since')
      ? `Триває ${duration(Date.now() - new Date(iso))} · ${sinceLabel(iso)}`
      : sinceLabel(iso);
  });
  const upd = $(root, '[data-f="aupd"]');
  if (upd && state.alerts?.updated) upd.textContent = `оновлено ${hhmm(state.alerts.updated)}`;
}
function bindMapTips(mapBox) {
  const tip = $(mapBox, '.hl-map-tip');
  const svg = $(mapBox, 'svg');
  svg.addEventListener('pointermove', (e) => {
    const ob = e.target.closest('.ob');
    if (!ob || e.pointerType === 'touch') { tip.hidden = true; return; }
    const k = ob.dataset.key;
    const o = state.alerts?.oblasts?.[k];
    const lvl = oblastLevel(o);
    const kinds = [...new Set((state.alerts?.threats || []).filter((t) => t.oblasts.includes(k) && Date.now() - new Date(t.at) < 90 * 60000).map((t) => KINDS[t.kind]?.label))].filter(Boolean);
    tip.innerHTML = `<b>${esc(PLACES[k]?.[0] || k)}</b><br>${{
      full: `Тривога ${o?.since ? `· ${duration(Date.now() - new Date(o.since))}` : ''}`,
      long: `Тривога ${o?.since ? sinceLabel(o.since) : ''}`,
      part: `Тривога в ${o.parts.filter((p) => p.type === 'AIR').length} ${plural(o.parts.filter((p) => p.type === 'AIR').length, 'районі чи громаді', 'районах чи громадах', 'районах чи громадах')}`,
      none: 'Тривоги немає'
    }[lvl]}${kinds.length ? `<br>${esc(kinds.join(', '))}` : ''}<br><span class="hl-muted">Клік — зробити своєю областю</span>`;
    const box = mapBox.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    tip.style.left = `${Math.min(x + 14, box.width - 200)}px`;
    tip.style.top = `${y + 14}px`;
    tip.hidden = false;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
}

/* ── Життєвий цикл ───────────────────────────────────────────── */
function every(ms, fn) {
  // У прихованій вкладці не смикаємо мережу — надолужимо, коли повернуться
  const id = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms);
  timers.push(id);
}
function onVisible() {
  if (!mounted || document.visibilityState !== 'visible') return;
  if (Date.now() - (state.alertsAt || 0) > ALERT_POLL_MS) loadAlerts();
}

export async function showHomeLive(opts = {}) {
  root = document.getElementById('home-live');
  if (!root) return;
  sb = opts.sb || null;
  userId = opts.userId || null;
  if (mounted) { root.hidden = false; return; }
  mounted = true;
  // Висота шапки — для розкладки «в одне вікно» (index.html, --home-top)
  const header = document.querySelector('header.top');
  if (header && window.ResizeObserver) {
    new ResizeObserver(() => document.documentElement.style.setProperty('--home-top', `${header.offsetHeight}px`)).observe(header);
  }
  place = readLocal() || { oblast: OFFICE.oblast, queue: OFFICE.queue };
  skeleton();
  renderPlace();
  root.hidden = false;
  tick();
  timers.push(setInterval(tick, 250));
  loadWeather();
  loadPower();
  await loadMap();
  loadAlerts();
  every(ALERT_POLL_MS, loadAlerts);
  every(WEATHER_POLL_MS, loadWeather);
  every(POWER_POLL_MS, loadPower);
  // Межа півгодини змінює стан світла — перемальовуємо без мережі
  every(60000, () => { if (POWER_DATA[place.oblast] && state.power[POWER_DATA[place.oblast].file]) renderPower(state.power[POWER_DATA[place.oblast].file], POWER_DATA[place.oblast]); });
  document.addEventListener('visibilitychange', onVisible);

  // Вибір із профілю може відрізнятися від локального — підтягуємо й перемальовуємо
  const fromProfile = await loadPlace();
  if (fromProfile.oblast !== place.oblast || fromProfile.queue !== place.queue) {
    const changed = fromProfile.oblast !== place.oblast;
    place = fromProfile;
    renderPlace();
    if (changed) loadWeather();
    loadPower();
    renderAlerts();
  }
}

export function hideHomeLive() {
  const el = document.getElementById('home-live');
  if (el) el.hidden = true;
  if (!mounted) return;
  timers.splice(0).forEach(clearInterval);
  document.removeEventListener('visibilitychange', onVisible);
  mounted = false;
  if (el) el.innerHTML = '';
}
