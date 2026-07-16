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

let feedList = [];
let activeCategory = 'all';

const byId = (id) => document.getElementById(id);

async function init() {
  await Promise.all([loadFeed(), loadChannels()]);

  const searchInput = byId('feedSearch');
  if (searchInput) searchInput.addEventListener('input', filterAndRender);

  const tabs = byId('categoryTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.category-tab');
      if (!btn) return;
      activeCategory = btn.dataset.cat;
      tabs.querySelectorAll('.category-tab').forEach(t => t.classList.toggle('active', t === btn));
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

  feedList = allNews;
  filterAndRender();
  renderStats();
}

function filterAndRender() {
  const searchVal = byId('feedSearch') ? byId('feedSearch').value.toLowerCase().trim() : '';

  const filtered = feedList.filter(n => {
    const matchesCategory = activeCategory === 'all' || n.category === activeCategory;
    const matchesSearch = !searchVal ||
      (n.title && n.title.toLowerCase().includes(searchVal)) ||
      (n.summary && n.summary.toLowerCase().includes(searchVal)) ||
      (n.source_name && n.source_name.toLowerCase().includes(searchVal)) ||
      (n.tags && n.tags.some(tag => tag.toLowerCase().includes(searchVal)));
    return matchesCategory && matchesSearch;
  });

  renderGrid(filtered);
  const countEl = byId('feedCount');
  if (countEl) countEl.textContent = `Знайдено новин: ${filtered.length}`;
}

function renderGrid(list) {
  const container = byId('feedGrid');
  if (!container) return;
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<div class="no-results">Новин не знайдено. Стрічка наповнюється автоматично за розкладом.</div>';
    return;
  }

  list.forEach(n => {
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
