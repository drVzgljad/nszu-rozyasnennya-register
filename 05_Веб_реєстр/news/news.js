import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let newsList = [];
let selectedNews = null;

const byId = (id) => document.getElementById(id);

async function init() {
  await loadNews();

  // Event listener for search
  const searchInput = byId("newsSearch");
  if (searchInput) {
    searchInput.addEventListener("input", filterAndRender);
  }

  const closeBtn = byId("closeNewsBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", showDefaultState);
  }

  // Setup news publishing
  await checkPublishAccess();
  setupPublishModal();

  // Listen for auth changes to update publish button visibility
  sb.auth.onAuthStateChange(async (_event, session) => {
    if (session && session.user) {
      currentUser = session.user;
      const { data } = await sb.from('profiles').select('role').eq('id', currentUser.id).single();
      currentUserRole = data?.role ?? null;
    } else {
      currentUser = null;
      currentUserRole = null;
    }
    togglePublishButtonVisibility();
  });
}

async function loadNews() {
  const { data, error } = await sb.from('news').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Error loading news:', error);
    const countEl = byId("newsCount");
    if (countEl) countEl.textContent = "Помилка завантаження новин";
    return;
  }
  newsList = data || [];
  filterAndRender();
  renderStats();

  // URL Parameter selection to support deep links from the homepage digest
  const params = new URLSearchParams(window.location.search);
  const newsId = params.get("id");
  if (newsId) {
    const found = newsList.find(n => n.id === newsId);
    if (found) {
      selectNews(found);
    }
  }
}

function filterAndRender() {
  const searchVal = byId("newsSearch") ? byId("newsSearch").value.toLowerCase().trim() : "";

  const filtered = newsList.filter(n => {
    const matchesSearch = !searchVal || 
      (n.title && n.title.toLowerCase().includes(searchVal)) || 
      (n.summary && n.summary.toLowerCase().includes(searchVal)) || 
      (n.content && n.content.toLowerCase().includes(searchVal)) ||
      (n.tags && n.tags.some(tag => tag.toLowerCase().includes(searchVal)));
    
    return matchesSearch;
  });

  renderGrid(filtered);
  const countEl = byId("newsCount");
  if (countEl) countEl.textContent = `Знайдено новин: ${filtered.length}`;
}

function renderGrid(list) {
  const container = byId("newsGrid");
  if (!container) return;
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = '<div class="no-results">Аналітичних матеріалів не знайдено.</div>';
    return;
  }

  list.forEach(n => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `news-card ${selectedNews && selectedNews.id === n.id ? "active" : ""}`;
    card.dataset.id = n.id;

    // Tags rendering with importance status badge
    let tagsHtml = "";
    let importanceBadge = "";
    if (n.importance === 'urgent') {
      importanceBadge = `<span class="category-badge importance-urgent-badge"><span class="pulse-dot"></span> Терміново</span>`;
    } else if (n.importance === 'important') {
      importanceBadge = `<span class="category-badge importance-important-badge">⚠️ Важливо</span>`;
    } else {
      importanceBadge = `<span class="category-badge importance-normal-badge">Новина</span>`;
    }

    if (n.tags && Array.isArray(n.tags)) {
      tagsHtml = importanceBadge + n.tags.map(t => `<span class="category-badge">${escapeHtml(t)}</span>`).join("");
    } else {
      tagsHtml = importanceBadge;
    }

    card.innerHTML = `
      <div class="card-tags">${tagsHtml}</div>
      <strong>${escapeHtml(n.title)}</strong>
      <p>${escapeHtml(n.summary || "")}</p>
      <div class="card-date">${formatDate(n.created_at)}</div>
    `;

    card.addEventListener("click", () => selectNews(n));
    container.appendChild(card);
  });
}

function selectNews(n) {
  selectedNews = n;
  renderGrid(newsList); // update active states

  const emptyState = byId("panelEmptyState");
  if (emptyState) emptyState.style.display = "none";

  const viewer = byId("newsDetailViewer");
  if (viewer) viewer.style.display = "flex";

  // Set detail views
  const titleEl = byId("detTitle");
  if (titleEl) titleEl.textContent = n.title;

  const dateEl = byId("detDate");
  if (dateEl) dateEl.textContent = formatDate(n.created_at);

  const coverEl = byId("detCover");
  if (coverEl) {
    if (n.image_url) {
      coverEl.src = n.image_url;
      coverEl.style.display = "block";
    } else {
      coverEl.style.display = "none";
    }
  }

  const tagsEl = byId("detTags");
  if (tagsEl) {
    let importanceBadge = "";
    if (n.importance === 'urgent') {
      importanceBadge = `<span class="category-badge importance-urgent-badge"><span class="pulse-dot"></span> Терміново</span>`;
    } else if (n.importance === 'important') {
      importanceBadge = `<span class="category-badge importance-important-badge">⚠️ Важливо</span>`;
    } else {
      importanceBadge = `<span class="category-badge importance-normal-badge">Новина</span>`;
    }

    let tagsHtml = importanceBadge;
    if (n.tags && Array.isArray(n.tags)) {
      tagsHtml += n.tags.map(t => `<span class="category-badge">${escapeHtml(t)}</span>`).join("");
    }
    tagsEl.innerHTML = tagsHtml;
  }

  const contentEl = byId("detContent");
  if (contentEl) {
    // Render markdown-like elements simply
    contentEl.innerHTML = formatRichText(n.content);
  }

  // Mobile layout scrolling
  if (window.innerWidth <= 1040) {
    const sidePanel = byId("newsPanelSide");
    if (sidePanel) sidePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showDefaultState() {
  selectedNews = null;
  renderGrid(newsList);

  const emptyState = byId("panelEmptyState");
  if (emptyState) emptyState.style.display = "flex";

  const viewer = byId("newsDetailViewer");
  if (viewer) viewer.style.display = "none";
}

function renderStats() {
  const container = byId("newsStats");
  if (!container) return;

  const total = newsList.length;
  container.innerHTML = `
    <div class="stat">
      <strong>${total}</strong>
      <span>Аналітичних оглядів</span>
    </div>
  `;
}

function formatRichText(text) {
  if (!text) return "";
  // Escape html tags to prevent injections but format some markdown simple structures
  let escaped = escapeHtml(text);

  // Convert double newlines to paragraph tags
  let paras = escaped.split(/\n\n+/).map(p => {
    // If starts with * or - for lists
    if (p.trim().startsWith('- ') || p.trim().startsWith('* ')) {
      const items = p.split(/\n[-*]\s+/).map(item => {
        // remove initial bullet if any
        let clean = item.replace(/^[-*]\s+/, '');
        return `<li>${clean}</li>`;
      }).join('');
      return `<ul>${items}</ul>`;
    }
    // If starts with ###
    if (p.startsWith('### ')) {
      return `<h3>${p.substring(4)}</h3>`;
    }
    // If starts with ##
    if (p.startsWith('## ')) {
      return `<h2>${p.substring(3)}</h2>`;
    }
    // If starts with > blockquote
    if (p.startsWith('&gt; ') || p.startsWith('> ')) {
      let quoteText = p.replace(/^(&gt;|>)\s+/, '');
      return `<blockquote>${quoteText}</blockquote>`;
    }
    return `<p>${p.replace(/\n/g, "<br>")}</p>`;
  }).join('');

  return paras;
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

let currentUser = null;
let currentUserRole = null;

async function checkPublishAccess() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && session.user) {
      currentUser = session.user;
      const { data } = await sb.from('profiles').select('role').eq('id', currentUser.id).single();
      currentUserRole = data?.role ?? null;
      togglePublishButtonVisibility();
    } else {
      currentUser = null;
      currentUserRole = null;
      togglePublishButtonVisibility();
    }
  } catch (e) {
    console.error("Error checking publish access:", e);
  }
}

function togglePublishButtonVisibility() {
  const allowedRoles = ['manager', 'deputy_director', 'director', 'admin'];
  const btn = byId("createNewsBtn");
  if (btn) {
    if (currentUser && allowedRoles.includes(currentUserRole)) {
      btn.style.display = "block";
    } else {
      btn.style.display = "none";
    }
  }
}

function setupPublishModal() {
  const openBtn = byId("createNewsBtn");
  const modal = byId("publishModal");
  const closeBtn = byId("closePublishModalBtn");
  const cancelBtn = byId("cancelPublishBtn");
  const form = byId("publishForm");

  if (openBtn && modal) {
    openBtn.addEventListener("click", () => {
      modal.style.display = "flex";
    });
  }

  const closeModal = () => {
    if (modal) modal.style.display = "none";
    if (form) form.reset();
  };

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  // Close modal when clicking outside the card
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });
  }

  if (form) {
    form.addEventListener("submit", handlePublishSubmit);
  }
}

async function handlePublishSubmit(e) {
  e.preventDefault();
  
  const title = byId("pubTitle").value.trim();
  const summary = byId("pubSummary").value.trim();
  const content = byId("pubContent").value.trim();
  const importance = byId("pubImportance").value;
  const tagsStr = byId("pubTags").value.trim();
  const imageUrl = byId("pubImageUrl").value.trim();
  
  const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(t => t.length > 0) : [];
  
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Публікація...";
  }

  try {
    const { error } = await sb.from('news').insert([
      {
        title,
        summary,
        content,
        importance,
        tags,
        image_url: imageUrl || null
      }
    ]);
    
    if (error) {
      alert("Помилка публікації новини: " + error.message);
      return;
    }
    
    // Reset form and close modal
    byId("publishForm").reset();
    byId("publishModal").style.display = "none";
    
    // Reload news list
    await loadNews();
    
    alert("Новину успішно опубліковано!");
  } catch (err) {
    console.error("Publish error:", err);
    alert("Сталася неочікувана оновлення/публікація.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Опублікувати новину";
    }
  }
}

document.addEventListener("DOMContentLoaded", init);
