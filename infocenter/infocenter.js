import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORY_META = {
  political: { label: '🏛 Політичні', cls: 'cat-political' },
  medical:   { label: '⚕️ Медичні', cls: 'cat-medical' },
  legal:     { label: '⚖️ Юридичні', cls: 'cat-legal' },
  financial: { label: '💰 Фінансові', cls: 'cat-financial' }
};

// Швидкі фільтри за джерелами/темами
const QUICK_FILTERS = {
  pmg:  (n) => n.relevance === 'high' ||
               (n.tags || []).some(t => /пмг|медичн.*гарант/i.test(t)) ||
               /пмг|медичн\w* гарант/i.test(n.title || ''),
  nszu: (n) => /нсзу/i.test(n.source_name || '') || /нсзу/i.test(n.title || ''),
  moz:  (n) => /моз|цгз/i.test(n.source_name || '') || /\bмоз\b/i.test(n.title || ''),
  // Telegram-спільноти: Медиторія (БПР/навчання) та Користувачі МІС Health24 (ЕСОЗ/МІС)
  community: (n) => /медитор|health24/i.test(n.source_name || '') ||
                    (n.tags || []).some(t => /\bміс\b|есоз|health24/i.test(t))
};

const PAGE_SIZE = 24;

let feedList = [];
let activeCategory = 'all';
let activeQuick = null;
let activePeriodDays = null; // null = увесь час
let visibleCount = PAGE_SIZE;

const byId = (id) => document.getElementById(id);

async function init() {
  await Promise.all([loadFeed(), loadChannels()]);

  const searchInput = byId('feedSearch');
  if (searchInput) searchInput.addEventListener('input', () => { visibleCount = PAGE_SIZE; filterAndRender(); });

  const tabs = byId('categoryTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.category-tab');
      if (!btn) return;
      activeCategory = btn.dataset.cat;
      tabs.querySelectorAll('.category-tab').forEach(t => t.classList.toggle('active', t === btn));
      visibleCount = PAGE_SIZE;
      filterAndRender();
    });
  }

  const quick = byId('quickFilters');
  if (quick) {
    quick.addEventListener('click', (e) => {
      const btn = e.target.closest('.quick-filter');
      if (!btn) return;
      activeQuick = activeQuick === btn.dataset.quick ? null : btn.dataset.quick;
      quick.querySelectorAll('.quick-filter').forEach(b =>
        b.classList.toggle('active', b.dataset.quick === activeQuick));
      visibleCount = PAGE_SIZE;
      filterAndRender();
    });
  }

  const periods = byId('periodFilters');
  if (periods) {
    periods.addEventListener('click', (e) => {
      const btn = e.target.closest('.period-pill');
      if (!btn) return;
      activePeriodDays = btn.dataset.days === 'all' ? null : parseInt(btn.dataset.days, 10);
      periods.querySelectorAll('.period-pill').forEach(b => b.classList.toggle('active', b === btn));
      visibleCount = PAGE_SIZE;
      filterAndRender();
    });
  }
}

async function loadFeed() {
  let dbNews = [];
  let localNews = [];

  // 1. Try loading from Supabase (live feed shared by all users)
  try {
    const { data, error } = await sb.from('infocenter_news')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(300);
    if (!error && data) dbNews = data;
  } catch (e) {
    console.error('Error loading infocenter news from Supabase:', e);
  }

  // 2. Local JSON fallback (produced by the aggregator)
  try {
    const res = await fetch('data/feed.json');
    if (res.ok) localNews = await res.json();
  } catch (e) {
    console.warn('Local feed.json not found or failed to load:', e);
  }

  // 3. Merge, deduplicating by source_url
  const allNews = [...dbNews];
  const seenUrls = new Set(dbNews.map(n => n.source_url));
  localNews.forEach(ln => {
    if (!seenUrls.has(ln.source_url)) allNews.push(ln);
  });

  allNews.sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));

  // Дайджести «Головне за 12 годин» — окрема панель, зі стрічки виключаються
  const digests = allNews.filter(n => n.source_name === DIGEST_SOURCE);
  feedList = allNews.filter(n => n.source_name !== DIGEST_SOURCE);
  renderDigest(digests[0] || null);
  filterAndRender();
  renderStats();
  renderUpdateTime();
}

const DIGEST_SOURCE = 'Головне за 12 годин';

function linkifyEscaped(text) {
  // Спочатку екрануємо, потім перетворюємо URL на посилання і переноси на <br>
  const escaped = escapeHtml(text || '');
  return escaped
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}

function renderDigest(digest) {
  const panel = byId('digestPanel');
  if (!panel) return;
  if (!digest) {
    panel.style.display = 'none';
    return;
  }
  const when = new Date(digest.published_at || digest.created_at);
  const freshHours = (Date.now() - when) / 36e5;
  const stale = isNaN(freshHours) || freshHours > 24;
  panel.innerHTML = `
    <div class="digest-head">
      <h2>${escapeHtml(digest.title)}</h2>
      ${stale ? '<span class="digest-stale">архівний випуск</span>' : ''}
    </div>
    <div class="digest-body">${linkifyEscaped(digest.summary)}</div>`;
  panel.style.display = 'block';
}

function renderUpdateTime() {
  const el = byId('updateTimeText');
  if (!el) return;
  let latest = null;
  feedList.forEach(n => {
    const d = new Date(n.created_at || n.published_at);
    if (!isNaN(d) && (!latest || d > latest)) latest = d;
  });
  if (!latest) { el.textContent = 'Даних ще немає'; return; }

  const now = new Date();
  const time = latest.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const sameDay = latest.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay) {
    el.textContent = `Оновлено сьогодні о ${time}`;
  } else if (latest.toDateString() === yesterday.toDateString()) {
    el.textContent = `Оновлено вчора о ${time}`;
  } else {
    el.textContent = `Оновлено ${formatDate(latest.toISOString())} о ${time}`;
  }
}

function filterAndRender() {
  const searchVal = byId('feedSearch') ? byId('feedSearch').value.toLowerCase().trim() : '';

  let cutoff = null;
  if (activePeriodDays) {
    cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (activePeriodDays - 1));
  }

  const filtered = feedList.filter(n => {
    const matchesCategory = activeCategory === 'all' || n.category === activeCategory;
    const matchesQuick = !activeQuick || QUICK_FILTERS[activeQuick](n);
    const itemDate = new Date(n.published_at || n.created_at);
    const matchesPeriod = !cutoff || (!isNaN(itemDate) && itemDate >= cutoff);
    const matchesSearch = !searchVal ||
      (n.title && n.title.toLowerCase().includes(searchVal)) ||
      (n.summary && n.summary.toLowerCase().includes(searchVal)) ||
      (n.source_name && n.source_name.toLowerCase().includes(searchVal)) ||
      (n.tags && n.tags.some(tag => tag.toLowerCase().includes(searchVal)));
    return matchesCategory && matchesQuick && matchesPeriod && matchesSearch;
  });

  renderGrid(filtered);
  const countEl = byId('feedCount');
  if (countEl) {
    const shown = Math.min(visibleCount, filtered.length);
    countEl.textContent = filtered.length > shown
      ? `Показано ${shown} з ${filtered.length} новин`
      : `Знайдено новин: ${filtered.length}`;
  }
}

function dayLabel(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return 'Раніше';
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return '📅 Сьогодні';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderGrid(list) {
  const container = byId('feedGrid');
  if (!container) return;
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<div class="no-results">Новин не знайдено. Стрічка наповнюється автоматично за розкладом.</div>';
    return;
  }

  const visible = list.slice(0, visibleCount);

  let currentDay = null;
  visible.forEach(n => {
    // Роздільник за днями — структурування стрічки
    const label = dayLabel(n.published_at || n.created_at);
    if (label !== currentDay) {
      currentDay = label;
      const header = document.createElement('div');
      header.className = 'day-header';
      header.textContent = label;
      container.appendChild(header);
    }
    const card = document.createElement('a');
    card.className = 'feed-card';
    card.href = n.source_url || '#';
    card.target = '_blank';
    card.rel = 'noopener';

    const cat = CATEGORY_META[n.category] || { label: n.category || 'Новина', cls: '' };
    let badges = `<span class="cat-badge ${cat.cls}">${cat.label}</span>`;
    if (n.relevance === 'high') {
      badges += `<span class="cat-badge cat-high">⭐ Важливо для ПМГ</span>`;
    }
    if (n.tags && Array.isArray(n.tags)) {
      badges += n.tags.slice(0, 3).map(t => `<span class="category-badge">${escapeHtml(t)}</span>`).join('');
    }

    card.innerHTML = `
      <div class="card-tags">${badges}</div>
      <strong>${escapeHtml(n.title)}</strong>
      <p>${escapeHtml(n.summary || '')}</p>
      <div class="card-footer">
        <span class="card-source">${escapeHtml(n.source_name || '')}</span>
        <span>${formatDate(n.published_at || n.created_at)}</span>
      </div>
    `;
    container.appendChild(card);
  });

  // «Показати ще» — щоб сторінка не розтягувалась на кілометр
  if (list.length > visibleCount) {
    const moreWrap = document.createElement('div');
    moreWrap.className = 'show-more-wrap';
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'show-more-btn';
    moreBtn.textContent = `Показати ще ${Math.min(PAGE_SIZE, list.length - visibleCount)} новин ↓ (залишилось ${list.length - visibleCount})`;
    moreBtn.addEventListener('click', () => {
      visibleCount += PAGE_SIZE;
      filterAndRender();
    });
    moreWrap.appendChild(moreBtn);
    container.appendChild(moreWrap);
  }
}

function renderStats() {
  const container = byId('feedStats');
  if (!container) return;

  const counts = { political: 0, medical: 0, legal: 0, financial: 0 };
  feedList.forEach(n => { if (counts[n.category] !== undefined) counts[n.category]++; });

  container.innerHTML = `
    <div class="stat"><strong>${feedList.length}</strong><span>Новин у стрічці</span></div>
    <div class="stat"><strong>${counts.medical}</strong><span>Медичних</span></div>
    <div class="stat"><strong>${counts.legal}</strong><span>Юридичних</span></div>
  `;
}

async function loadChannels() {
  const container = byId('ytChannelsGrid');
  if (!container) return;

  let channels = [];
  try {
    const res = await fetch('data/youtube_channels.json');
    if (res.ok) channels = await res.json();
  } catch (e) {
    console.warn('youtube_channels.json not found:', e);
  }

  if (!channels.length) {
    container.innerHTML = '<div class="no-results">Дані каналів ще не зібрано.</div>';
    return;
  }

  // Прогрес аналізу у верхній кнопці
  const topProgress = byId('ytTopProgress');
  if (topProgress) {
    const analyzed = channels.reduce((s, c) => s + (c.analyzed_videos || 0), 0);
    const total = channels.reduce((s, c) => s + (c.total_videos || 0), 0);
    topProgress.textContent = `Розібрано ${analyzed} з ${total} відео · вердикти тверджень`;
  }

  container.innerHTML = '';
  channels.forEach(ch => {
    const total = ch.total_videos || 0;
    const analyzed = ch.analyzed_videos || 0;
    const pct = total ? Math.round((analyzed / total) * 100) : 0;

    const card = document.createElement('a');
    card.className = 'yt-channel-card';
    card.href = `youtube.html?channel=${encodeURIComponent(ch.handle)}`;
    card.innerHTML = `
      <h3>🎬 ${escapeHtml(ch.name)}</h3>
      <p>${escapeHtml(ch.description || '')}</p>
      <div class="yt-progress-note">
        Проаналізовано <strong>${analyzed}</strong> з <strong>${total}</strong> відео
        <div class="yt-progress-bar"><span style="width:${pct}%"></span></div>
        ${pct}% архіву розібрано
      </div>
    `;
    container.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

document.addEventListener('DOMContentLoaded', init);
