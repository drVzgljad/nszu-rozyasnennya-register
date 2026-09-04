// Інфоцентр: ядро — новини НСЗУ (data/nszu_feed.json, 2023–2026, з прив'язкою
// до пакетів), навколо — агрегатор зовнішніх джерел (Supabase + data/feed.json).
// Три поверхи: «стосується пакетів», «НСЗУ говорить», «галузь»; політика,
// право і фінанси — згорнуті внизу, щоб не заступали головне.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY));

const DIGEST_SOURCE = 'Головне за 12 годин';
const PAGE = 10;
// Джерела, які з моніторингу прибрано, але в Supabase вони живуть ще 90 днів
const DROPPED_SOURCES = /Судово-юридична газета/i;
const RU_TEXT = /[ыэъё]/i;

const state = {
  nszu: [],        // сайт НСЗУ, з nszu_feed.json
  ext: [],         // агрегатор: телеграми, галузь, решта
  packages: {},    // number → title
  days: 30,
  pkg: '',
  q: '',
  shown: { pmg: PAGE, nszu: PAGE, industry: PAGE, rest: PAGE },
};

const byId = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

const MONTHS = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'серп', 'вер', 'жовт', 'лист', 'груд'];
const fmtShort = (d) => isNaN(d) ? '' : `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;

function dayLabel(d) {
  const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Сьогодні';
  if (d.toDateString() === y.toDateString()) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

const normUrl = (u) => (u || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();

// ───────── завантаження ─────────
// Кожне джерело вантажиться окремо і мовчки: якщо одне впало, решта сторінки
// все одно малюється, а не сидить порожня з помилкою в консолі.
async function getJson(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch (e) {
    console.warn('Не вдалося завантажити', url, e);
    return null;
  }
}

const mapNszu = (items) => (items || []).map((n) => ({
  id: 'nszu:' + n.slug,
  kind: 'nszu-site',
  source: 'НСЗУ',
  title: n.title,
  url: n.url,
  image: n.image || null,
  text: n.excerpt || '',
  packages: n.packages || [],
  date: new Date(n.date + 'T12:00:00'),
}));

// Корпус новин лежить шардами за роками. Спершу — поточний рік (сторінка
// відкривається одразу), решта років довантажується у фоні по одному і
// підмальовується: періоди «рік» і «усе» повнішають за кілька секунд.
let pendingYears = [];
async function loadOlderYears() {
  for (const y of pendingYears) {
    const d = await getJson(`data/nszu_feed_${y}.json`);
    if (d) { state.nszu = state.nszu.concat(mapNszu(d.items)); renderStats(); render(); }
  }
  pendingYears = [];
}

async function loadAll() {
  const idx = await getJson('data/nszu_feed_index.json');
  const years = Object.keys((idx && idx.years) || {}).sort((a, b) => b - a);
  if (years.length) {
    const first = await getJson(`data/nszu_feed_${years[0]}.json`);
    if (first) state.nszu = mapNszu(first.items);
    pendingYears = years.slice(1);
  }
  const pkgData = await getJson('../pakety/data/packages_lite.json');
  if (pkgData) {
    (pkgData.packages || pkgData).forEach((p) => { state.packages[String(p.number)] = p.title; });
  }

  // агрегатор: Supabase (спільний для всіх) + локальний файл як запасний
  let db = [], local = [];
  try {
    const { data, error } = await sb.from('infocenter_news')
      .select('*').order('published_at', { ascending: false }).limit(400);
    if (!error && data) db = data;
  } catch (e) { console.warn('Supabase', e); }
  try {
    const r = await fetch('data/feed.json');
    if (r.ok) local = await r.json();
  } catch (e) { /* без файлу теж живемо */ }

  const seen = new Set(state.nszu.map((n) => normUrl(n.url)));
  const ext = [];
  const digests = [];
  [...db, ...local].forEach((n) => {
    const key = normUrl(n.source_url);
    if (!key || seen.has(key)) return;   // дублі й ті самі новини сайту НСЗУ
    seen.add(key);
    if (n.source_name === DIGEST_SOURCE) { digests.push(n); return; }
    if (DROPPED_SOURCES.test(n.source_name || '')) return;
    if (RU_TEXT.test((n.title || '') + (n.summary || ''))) return;
    const src = n.source_name || '';
    const isNszu = /нсзу/i.test(src);
    const isTg = /telegram/i.test(src);
    ext.push({
      id: 'ext:' + (n.id || key),
      kind: isNszu ? 'nszu-tg' : (n.category === 'medical' ? 'industry' : 'rest'),
      source: src.replace(/\s*\(Telegram\)/i, ''),
      isTg,
      title: n.title || '',
      url: n.source_url,
      image: n.image_url || null,
      text: n.summary || '',
      packages: [],
      category: n.category,
      date: new Date(n.published_at || n.created_at),
    });
  });
  state.ext = ext.filter((n) => !isNaN(n.date));
  digests.sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
  renderDigest(digests[0] || null);
}

// ───────── фільтри ─────────
function cutoff() {
  if (state.days === 'all') return null;
  const c = new Date(); c.setHours(0, 0, 0, 0); c.setDate(c.getDate() - (state.days - 1));
  return c;
}
function passes(n, c) {
  if (c && n.date < c) return false;
  if (state.pkg && !n.packages.includes(state.pkg)) return false;
  if (state.q) {
    const hay = (n.title + ' ' + n.text + ' ' + n.source).toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}
function selectAll() {
  const c = cutoff();
  const all = [...state.nszu, ...state.ext].filter((n) => passes(n, c))
    .sort((a, b) => b.date - a.date);
  return all;
}

// ───────── рендер ─────────
function chips(n) {
  if (!n.packages.length) return '';
  return `<div class="ic-chips">${n.packages.slice(0, 4).map((p) =>
    `<a href="../pakety/index.html?package=${encodeURIComponent(p)}" title="${esc(state.packages[p] || '')}"><b>${esc(p)}</b> ${esc(shortTitle(state.packages[p]))}</a>`
  ).join('')}${n.packages.length > 4 ? `<span class="ic-src">+${n.packages.length - 4}</span>` : ''}</div>`;
}
function shortTitle(t) {
  if (!t) return '';
  const s = t.charAt(0) + t.slice(1).toLowerCase();
  return s.length > 38 ? s.slice(0, 36).replace(/\s\S*$/, '') + '…' : s;
}
function srcBadge(n) {
  const cls = n.kind === 'nszu-site' ? 'is-nszu' : n.kind === 'nszu-tg' ? 'is-tg' : n.kind === 'industry' ? 'is-ind' : '';
  const icon = n.kind === 'nszu-site' ? '🏥' : n.isTg ? '✈️' : /youtube/i.test(n.source) ? '🎬' : n.kind === 'industry' ? '⚕️' : '📰';
  return `<span class="ic-src ${cls}">${icon} ${esc(n.source)}</span>`;
}
function itemCard(n) {
  const thumb = n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy">` : '';
  return `<article class="ic-item ${n.image ? '' : 'no-thumb'}">
    ${thumb}
    <div class="ic-item-body">
      <div class="ic-meta">${srcBadge(n)}<time datetime="${n.date.toISOString()}">${fmtShort(n.date)}</time></div>
      <h3><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></h3>
      ${n.text ? `<p>${esc(n.text)}</p>` : ''}
      ${chips(n)}
    </div>
  </article>`;
}

function renderLead(all) {
  const box = byId('leadBlock');
  const nszu = all.filter((n) => n.kind === 'nszu-site');
  if (!nszu.length) { box.innerHTML = ''; return new Set(); }
  const lead = nszu.find((n) => n.image) || nszu[0];
  const side = nszu.filter((n) => n !== lead).slice(0, 3);
  box.innerHTML = `
    <a class="ic-hero-card" href="${esc(lead.url)}" target="_blank" rel="noopener">
      ${lead.image ? `<img src="${esc(lead.image)}" alt="">` : ''}
      <div class="ic-hero-body">
        <div class="ic-meta" style="color:rgba(255,255,255,.85)">${srcBadge(lead)}<time>${fmtShort(lead.date)}</time></div>
        <h2>${esc(lead.title)}</h2>
        <p>${esc(lead.text)}</p>
        ${chips(lead)}
      </div>
    </a>
    <div class="ic-lead-side">${side.map((n) => `
      <a class="ic-mini" href="${esc(n.url)}" target="_blank" rel="noopener">
        ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy">` : '<div class="ic-noimg"></div>'}
        <div>
          <div class="ic-meta"><time>${fmtShort(n.date)}</time>${n.packages.length ? `<span>· пакет ${esc(n.packages.slice(0, 3).join(', '))}</span>` : ''}</div>
          <h3>${esc(n.title)}</h3>
        </div>
      </a>`).join('')}</div>`;
  return new Set([lead, ...side].map((n) => n.id));
}

function renderSection(key, sectionId, items, grouped) {
  const sec = byId(sectionId);
  const list = sec.querySelector('.ic-list');
  const count = sec.querySelector('.ic-count');
  const more = sec.querySelector('.ic-more');
  sec.classList.toggle('is-empty', !items.length);
  count.textContent = items.length ? `${items.length}` : '';
  const shown = items.slice(0, state.shown[key]);
  if (!shown.length) { list.innerHTML = ''; more.hidden = true; return; }
  let html = '', lastDay = '';
  shown.forEach((n) => {
    if (grouped) {
      const d = dayLabel(n.date);
      if (d !== lastDay) { html += `<div class="ic-day">${esc(d)}</div>`; lastDay = d; }
    }
    html += itemCard(n);
  });
  list.innerHTML = html;
  more.hidden = shown.length >= items.length;
  more.textContent = `Показати ще (${items.length - shown.length})`;
  more.onclick = () => { state.shown[key] += PAGE * 2; render(); };
}

function renderSide(all) {
  const week = new Date(); week.setHours(0, 0, 0, 0); week.setDate(week.getDate() - 6);
  const everything = [...state.nszu, ...state.ext];
  const w = everything.filter((n) => n.date >= week);
  const wNszu = w.filter((n) => n.kind === 'nszu-site' || n.kind === 'nszu-tg');
  const wPmg = w.filter((n) => n.packages.length);
  byId('weekBlock').innerHTML = `
    <h3>Тиждень у цифрах</h3>
    <div class="ic-week">
      <div><strong>${wNszu.length}</strong><span>публікацій НСЗУ і Академії за 7 днів</span></div>
      <div><strong>${wPmg.length}</strong><span>з них стосуються конкретних пакетів</span></div>
      <div><strong>${w.filter((n) => n.kind === 'industry').length}</strong><span>галузевих новин</span></div>
      <div><strong>${state.nszu.length}</strong><span>новин НСЗУ у корпусі з 2023 року</span></div>
    </div>`;

  // пакети, про які говорять — за обраний період, а не за весь корпус
  const counts = {};
  all.filter((n) => n.kind === 'nszu-site').forEach((n) => n.packages.forEach((p) => { counts[p] = (counts[p] || 0) + 1; }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = top.length ? top[0][1] : 1;
  byId('topPackages').innerHTML = `
    <h3>Пакети, про які говорять</h3>
    <p class="ic-card-sub">${state.days === 'all' ? 'за весь корпус' : `за ${state.days === 365 ? 'рік' : state.days + ' днів'}`}</p>
    ${top.length ? `<div class="ic-pkgs">${top.map(([p, c]) => `
      <a href="../pakety/index.html?package=${encodeURIComponent(p)}">
        <b>${esc(p)}</b><span>${esc(shortTitle(state.packages[p]))}</span><em>${c}</em>
        <div class="ic-bar"><i style="width:${Math.round(c / max * 100)}%"></i></div>
      </a>`).join('')}</div>` : '<p class="ic-card-sub">За цей період згадок пакетів немає.</p>'}`;

  const srcCounts = {};
  everything.forEach((n) => { srcCounts[n.source] = (srcCounts[n.source] || 0) + 1; });
  const srcs = Object.entries(srcCounts).sort((a, b) => b[1] - a[1]);
  byId('sourcesBlock').innerHTML = `
    <h3>Джерела</h3>
    <div class="ic-sources">${srcs.map(([s, c]) => `<div><span>${esc(s)}</span><em>${c}</em></div>`).join('')}</div>`;
}

function renderStats() {
  const box = byId('feedStats');
  if (!box) return;
  const linked = state.nszu.filter((n) => n.packages.length).length;
  const pk = new Set(); state.nszu.forEach((n) => n.packages.forEach((p) => pk.add(p)));
  box.innerHTML = `
    <div class="stat"><strong>${state.nszu.length}</strong><span>новин НСЗУ, 2023–2026</span></div>
    <div class="stat"><strong>${linked}</strong><span>прив'язано до пакетів</span></div>
    <div class="stat"><strong>${pk.size}</strong><span>пакетів із новинами</span></div>`;
}

function renderDigest(d) {
  const p = byId('digestPanel');
  if (!d) { p.classList.remove('is-on'); return; }
  const when = new Date(d.published_at || d.created_at);
  const stale = isNaN(when) || (Date.now() - when) / 36e5 > 24;
  const body = esc(d.summary || '')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
  p.innerHTML = `<h2>${esc(d.title)}${stale ? '<span class="ic-digest-stale">архівний випуск</span>' : ''}</h2><div class="ic-digest-body">${body}</div>`;
  p.classList.add('is-on');
}

function render() {
  const all = selectAll();
  const used = renderLead(all);
  const rest = all.filter((n) => !used.has(n.id));
  renderSection('pmg', 'secPmg', rest.filter((n) => n.kind === 'nszu-site' && n.packages.length), false);
  renderSection('nszu', 'secNszu', rest.filter((n) => (n.kind === 'nszu-site' && !n.packages.length) || n.kind === 'nszu-tg'), true);
  renderSection('industry', 'secIndustry', rest.filter((n) => n.kind === 'industry'), true);
  renderSection('rest', 'secRest', rest.filter((n) => n.kind === 'rest'), true);
  renderSide(all);
  if (!all.length) {
    byId('secNszu').classList.remove('is-empty');
    byId('secNszu').querySelector('.ic-list').innerHTML = '<div class="ic-empty">За цими умовами нічого не знайдено — розширте період або зніміть фільтр пакета.</div>';
  }
}

// ───────── YouTube МІС (компактно) ─────────
async function loadChannels() {
  const box = byId('ytChannelsGrid');
  if (!box) return;
  let channels = [];
  try { const r = await fetch('data/youtube_channels.json'); if (r.ok) channels = await r.json(); } catch (e) { /* */ }
  if (!channels.length) { box.innerHTML = ''; return; }
  box.innerHTML = channels.map((ch) => {
    const total = ch.total_videos || 0, done = ch.analyzed_videos || 0;
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<a class="yt-channel-card" href="youtube.html?channel=${encodeURIComponent(ch.handle)}">
      <h3>${esc(ch.name)}</h3>
      <div class="yt-progress-note">розібрано ${done} з ${total} відео
        <div class="yt-progress-bar"><span style="width:${pct}%"></span></div></div>
    </a>`;
  }).join('');
}

// ───────── ініціалізація ─────────
function resetShown() { state.shown = { pmg: PAGE, nszu: PAGE, industry: PAGE, rest: PAGE }; }

async function init() {
  await loadAll();
  await loadChannels();

  const sel = byId('packageSelect');
  Object.keys(state.packages).sort((a, b) => a - b).forEach((p) => {
    const o = document.createElement('option');
    o.value = p; o.textContent = `${p} · ${shortTitle(state.packages[p])}`;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => { state.pkg = sel.value; resetShown(); render(); });

  byId('feedSearch').addEventListener('input', (e) => {
    state.q = e.target.value.trim().toLowerCase(); resetShown(); render();
  });

  byId('periodPills').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.days = b.dataset.days === 'all' ? 'all' : parseInt(b.dataset.days, 10);
    byId('periodPills').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    resetShown(); render();
  });

  // ?package=N з інших сторінок
  const q = new URLSearchParams(location.search).get('package');
  if (q && state.packages[q]) { state.pkg = q; sel.value = q; state.days = 'all';
    byId('periodPills').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.days === 'all')); }

  renderStats();
  render();
  loadOlderYears();
}

document.addEventListener('DOMContentLoaded', init);
