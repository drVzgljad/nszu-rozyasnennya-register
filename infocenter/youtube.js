const VERDICT_META = {
  confirmed:    { label: '✅ Підтверджено', chip: 'vc-confirmed', row: 'row-confirmed' },
  questionable: { label: '⚠️ Сумнівно', chip: 'vc-questionable', row: 'row-questionable' },
  false:        { label: '❌ Хибно / застаріло', chip: 'vc-false', row: 'row-false' }
};

const STATUS_META = {
  analyzed:    { label: 'Проаналізовано', cls: 'st-analyzed' },
  transcribed: { label: 'В черзі на аналіз', cls: 'st-transcribed' },
  pending:     { label: 'Очікує', cls: 'st-pending' }
};

let videoIndex = [];
let channels = [];
let activeChannel = 'all';
let selectedVideoId = null;
const analysisCache = new Map();

const byId = (id) => document.getElementById(id);

async function init() {
  await loadData();

  const params = new URLSearchParams(window.location.search);
  const channelParam = params.get('channel');
  if (channelParam && channels.some(c => c.handle === channelParam)) {
    activeChannel = channelParam;
  }

  renderChannelTabs();
  filterAndRender();
  renderStats();

  const searchInput = byId('ytSearch');
  if (searchInput) searchInput.addEventListener('input', filterAndRender);

  const onlyAnalyzed = byId('onlyAnalyzed');
  if (onlyAnalyzed) onlyAnalyzed.addEventListener('change', filterAndRender);

  const closeBtn = byId('closeVideoBtn');
  if (closeBtn) closeBtn.addEventListener('click', showDefaultState);

  const videoParam = params.get('video');
  if (videoParam) {
    const found = videoIndex.find(v => v.video_id === videoParam);
    if (found) selectVideo(found);
  }
}

async function loadData() {
  try {
    const res = await fetch('data/youtube_channels.json');
    if (res.ok) channels = await res.json();
  } catch (e) { console.warn('youtube_channels.json load failed:', e); }

  try {
    const res = await fetch('data/youtube_index.json');
    if (res.ok) videoIndex = await res.json();
  } catch (e) { console.warn('youtube_index.json load failed:', e); }

  videoIndex.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
}

function renderChannelTabs() {
  const tabs = byId('channelTabs');
  if (!tabs) return;

  channels.forEach(ch => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-tab';
    btn.dataset.channel = ch.handle;
    btn.textContent = ch.name;
    tabs.appendChild(btn);
  });

  tabs.querySelectorAll('.category-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.channel === activeChannel);
  });

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.category-tab');
    if (!btn) return;
    activeChannel = btn.dataset.channel;
    tabs.querySelectorAll('.category-tab').forEach(t => t.classList.toggle('active', t === btn));
    filterAndRender();
  });
}

function filterAndRender() {
  const searchVal = byId('ytSearch') ? byId('ytSearch').value.toLowerCase().trim() : '';
  const onlyAnalyzed = byId('onlyAnalyzed') ? byId('onlyAnalyzed').checked : false;

  const filtered = videoIndex.filter(v => {
    const matchesChannel = activeChannel === 'all' || v.channel_handle === activeChannel;
    const matchesStatus = !onlyAnalyzed || v.status === 'analyzed';
    const matchesSearch = !searchVal ||
      (v.title && v.title.toLowerCase().includes(searchVal)) ||
      (v.topics && v.topics.some(t => t.toLowerCase().includes(searchVal)));
    return matchesChannel && matchesStatus && matchesSearch;
  });

  renderList(filtered);
  const countEl = byId('ytCount');
  if (countEl) countEl.textContent = `Знайдено відео: ${filtered.length}`;
}

function renderList(list) {
  const container = byId('ytList');
  if (!container) return;
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<div class="no-results">Відео не знайдено. Реєстр наповнюється поетапно.</div>';
    return;
  }

  list.forEach(v => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `yt-video-card ${selectedVideoId === v.video_id ? 'active' : ''}`;

    const status = STATUS_META[v.status] || STATUS_META.pending;
    const thumb = v.thumbnail_url || `https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`;

    let verdictBarHtml = '';
    if (v.status === 'analyzed' && v.stats) {
      const total = (v.stats.confirmed || 0) + (v.stats.questionable || 0) + (v.stats.false || 0);
      if (total > 0) {
        const pc = (v.stats.confirmed || 0) / total * 100;
        const pq = (v.stats.questionable || 0) / total * 100;
        const pf = (v.stats.false || 0) / total * 100;
        verdictBarHtml = `<div class="verdict-bar" title="✅ ${v.stats.confirmed || 0} · ⚠️ ${v.stats.questionable || 0} · ❌ ${v.stats.false || 0}">
          <span class="v-confirmed" style="width:${pc}%"></span>
          <span class="v-questionable" style="width:${pq}%"></span>
          <span class="v-false" style="width:${pf}%"></span>
        </div>`;
      }
    }

    card.innerHTML = `
      <img class="yt-video-thumb" src="${thumb}" alt="" loading="lazy">
      <div class="yt-video-info">
        <strong>${escapeHtml(v.title)}</strong>
        <div class="yt-video-meta">
          <span>${formatDate(v.published_at)}</span>
          ${v.duration_sec ? `<span>${formatDuration(v.duration_sec)}</span>` : ''}
          <span class="status-badge ${status.cls}">${status.label}</span>
        </div>
        ${verdictBarHtml}
      </div>
    `;

    card.addEventListener('click', () => selectVideo(v));
    container.appendChild(card);
  });
}

async function selectVideo(v) {
  selectedVideoId = v.video_id;
  filterAndRender();

  const emptyState = byId('ytEmptyState');
  if (emptyState) emptyState.style.display = 'none';
  const viewer = byId('ytDetailViewer');
  if (viewer) viewer.style.display = 'block';

  byId('vidTitle').textContent = v.title;

  const channelName = (channels.find(c => c.handle === v.channel_handle) || {}).name || v.channel_handle;
  byId('vidMeta').innerHTML = `
    <span>📺 ${escapeHtml(channelName)}</span>
    <span>📅 ${formatDate(v.published_at)}</span>
    ${v.duration_sec ? `<span>⏱ ${formatDuration(v.duration_sec)}</span>` : ''}
  `;

  const watchBtn = byId('watchOnYoutube');
  if (watchBtn) watchBtn.href = v.url || `https://www.youtube.com/watch?v=${v.video_id}`;

  const verdictsEl = byId('vidVerdicts');
  const summaryEl = byId('vidSummary');
  const claimsEl = byId('vidClaimsBlock');
  verdictsEl.innerHTML = '';
  summaryEl.innerHTML = '';
  claimsEl.innerHTML = '';

  if (v.status !== 'analyzed') {
    const statusLabel = v.status === 'transcribed'
      ? 'Транскрипт відео отримано, детальний аналіз буде додано найближчим часом.'
      : 'Це відео ще в черзі на обробку. Архів каналів розбирається поетапно, починаючи з найновіших та найважливіших для ПМГ відео.';
    summaryEl.innerHTML = `<div class="pending-note">⏳ ${statusLabel}</div>`;
    if (window.innerWidth <= 1040) byId('ytPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  summaryEl.innerHTML = '<div class="pending-note">Завантаження аналізу...</div>';

  let analysis = analysisCache.get(v.video_id);
  if (!analysis) {
    try {
      const res = await fetch(`data/analyses/${encodeURIComponent(v.video_id)}.json`);
      if (res.ok) {
        analysis = await res.json();
        analysisCache.set(v.video_id, analysis);
      }
    } catch (e) { console.error('Analysis load failed:', e); }
  }

  if (!analysis) {
    summaryEl.innerHTML = '<div class="pending-note">Не вдалося завантажити файл аналізу.</div>';
    return;
  }

  // Verdict summary chips
  const stats = analysis.stats || {};
  verdictsEl.innerHTML = `
    <span class="verdict-chip vc-confirmed">✅ Підтверджено: ${stats.confirmed || 0}</span>
    <span class="verdict-chip vc-questionable">⚠️ Сумнівно: ${stats.questionable || 0}</span>
    <span class="verdict-chip vc-false">❌ Хибно: ${stats.false || 0}</span>
  `;

  summaryEl.innerHTML = formatRichText(analysis.summary || '');

  // Claims table
  if (analysis.claims && analysis.claims.length) {
    const rows = analysis.claims.map(c => {
      const verdict = VERDICT_META[c.verdict] || VERDICT_META.questionable;
      const refsHtml = (c.references || []).map(r => {
        const label = escapeHtml(`${r.doc}${r.norm ? ', ' + r.norm : ''}`);
        if (r.url_internal) return `<a href="${escapeHtml(r.url_internal)}" target="_blank">${label}</a>`;
        if (r.url_external) return `<a href="${escapeHtml(r.url_external)}" target="_blank" rel="noopener">${label}</a>`;
        return label;
      }).join(' · ');

      return `<tr class="${verdict.row}">
        <td><span class="ts-badge">${escapeHtml(c.timestamp || '—')}</span></td>
        <td>
          ${escapeHtml(c.claim_text)}
          ${c.quote ? `<span class="claim-quote">«${escapeHtml(c.quote)}»</span>` : ''}
        </td>
        <td style="white-space:nowrap;"><strong>${verdict.label}</strong></td>
        <td>
          ${escapeHtml(c.verdict_reason || '')}
          ${refsHtml ? `<div class="claim-refs">📖 ${refsHtml}</div>` : ''}
        </td>
      </tr>`;
    }).join('');

    claimsEl.innerHTML = `
      <h3 style="margin:22px 0 0; font-size:17px; color:var(--ink);">Перевірка тверджень (${analysis.claims.length})</h3>
      <div class="claims-table-wrap">
        <table class="claims-table">
          <thead><tr><th>Час</th><th>Твердження</th><th>Вердикт</th><th>Обґрунтування та джерела</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } else {
    claimsEl.innerHTML = '<div class="pending-note">У цьому відео не виявлено тверджень, що потребують перевірки (навчальний/оглядовий контент).</div>';
  }

  if (window.innerWidth <= 1040) byId('ytPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showDefaultState() {
  selectedVideoId = null;
  filterAndRender();
  const emptyState = byId('ytEmptyState');
  if (emptyState) emptyState.style.display = 'flex';
  const viewer = byId('ytDetailViewer');
  if (viewer) viewer.style.display = 'none';
}

function renderStats() {
  const container = byId('ytStats');
  if (!container) return;

  const total = videoIndex.length;
  const analyzed = videoIndex.filter(v => v.status === 'analyzed').length;
  let claimsTotal = 0, falseTotal = 0;
  videoIndex.forEach(v => {
    if (v.stats) {
      claimsTotal += (v.stats.confirmed || 0) + (v.stats.questionable || 0) + (v.stats.false || 0);
      falseTotal += (v.stats.false || 0);
    }
  });

  container.innerHTML = `
    <div class="stat"><strong>${total}</strong><span>Відео в реєстрі</span></div>
    <div class="stat"><strong>${analyzed}</strong><span>Проаналізовано</span></div>
    <div class="stat"><strong>${claimsTotal}</strong><span>Перевірених тверджень</span></div>
  `;
}

function formatRichText(text) {
  if (!text) return '';
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  return escaped.split(/\n\n+/).map(p => {
    if (p.trim().startsWith('- ') || p.trim().startsWith('* ')) {
      const items = p.split(/\n[-*]\s+/).map(item => `<li>${item.replace(/^[-*]\s+/, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    if (p.startsWith('### ')) return `<h3>${p.substring(4)}</h3>`;
    if (p.startsWith('## ')) return `<h3>${p.substring(3)}</h3>`;
    if (p.startsWith('&gt; ')) return `<blockquote>${p.replace(/^&gt;\s+/, '')}</blockquote>`;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
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
  if (isNaN(date)) return isoString;
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', init);
