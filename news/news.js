import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY));

let newsList = [];
let localNewsList = [];
let selectedNews = null;
let modalMode = 'create';

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

  const deleteBtn = byId("deleteNewsBtn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", handleDeleteNews);
  }

  const editBtn = byId("editNewsBtn");
  if (editBtn) {
    editBtn.addEventListener("click", handleEditNewsClick);
  }

  // Listen for auth changes to update publish/delete/edit buttons visibility
  sb.auth.onAuthStateChange(async (_event, session) => {
    if (session && session.user) {
      currentUser = session.user;
      const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
      currentUserRole = data?.role ?? null;
      currentUserIsClerk = data?.is_clerk === true;
    } else {
      currentUser = null;
      currentUserRole = null;
      currentUserIsClerk = false;
    }
    togglePublishButtonVisibility();
    toggleEditAndDeleteButtons();
  });
}

async function loadNews() {
  let dbNews = [];
  let localNews = [];
  
  // 1. Try loading from Supabase
  try {
    const { data, error } = await sb.from('news').select('*').order('created_at', { ascending: false });
    if (!error && data) {
      dbNews = data;
    } else {
      console.warn('Supabase news load failed or empty, fallback to local');
    }
  } catch (e) {
    console.error('Error loading news from Supabase:', e);
  }
  
  // 2. Load from local JSON
  try {
    const res = await fetch('data/news.json');
    if (res.ok) {
      localNews = await res.json();
      localNewsList = localNews;
    }
  } catch (e) {
    console.warn('Local news file not found or failed to load:', e);
  }
  
  // 3. Merge news (avoiding duplicate IDs)
  const allNews = [...dbNews];
  const dbIds = new Set(dbNews.map(n => n.id));
  
  localNews.forEach(ln => {
    if (!dbIds.has(ln.id)) {
      allNews.push(ln);
    }
  });
  
  // Sort all news by created_at descending
  allNews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  newsList = allNews;
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

  // Toggle edit and delete buttons
  toggleEditAndDeleteButtons();

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

  // Convert markdown links [text](url) to HTML anchors
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

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
// Діловод департаменту публікує та редагує оголошення нарівні з керівництвом
let currentUserIsClerk = false;

async function checkPublishAccess() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session && session.user) {
      currentUser = session.user;
      const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
      currentUserRole = data?.role ?? null;
      currentUserIsClerk = data?.is_clerk === true;
      togglePublishButtonVisibility();
      toggleEditAndDeleteButtons();
    } else {
      currentUser = null;
      currentUserRole = null;
      currentUserIsClerk = false;
      togglePublishButtonVisibility();
      toggleEditAndDeleteButtons();
    }
  } catch (e) {
    console.error("Error checking publish access:", e);
  }
}

function togglePublishButtonVisibility() {
  const allowedRoles = ['manager', 'deputy_director', 'director', 'admin'];
  const btn = byId("createNewsBtn");
  if (btn) {
    if (currentUser && (allowedRoles.includes(currentUserRole) || currentUserIsClerk)) {
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
      modalMode = 'create';
      const modalTitle = document.querySelector("#publishModal h2");
      if (modalTitle) modalTitle.textContent = "➕ Створити аналітичну новину";
      
      const submitBtn = document.querySelector("#publishForm button[type='submit']");
      if (submitBtn) submitBtn.textContent = "Опублікувати новину";
      
      modal.style.display = "flex";
    });
  }

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
    submitBtn.textContent = modalMode === 'edit' ? "Збереження..." : "Публікація...";
  }

  try {
    if (modalMode === 'edit') {
      const isLocal = localNewsList.some(n => n.id === selectedNews.id);
      if (isLocal) {
        const idx = localNewsList.findIndex(n => n.id === selectedNews.id);
        if (idx !== -1) {
          const updatedItem = {
            ...localNewsList[idx],
            title,
            summary,
            content,
            importance,
            tags,
            image_url: imageUrl || null
          };
          
          try {
            // 1. Try to save locally via server API (works on local development server)
            const res = await fetch('/api/save-data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: 'news.json',
                data: [...localNewsList.slice(0, idx), updatedItem, ...localNewsList.slice(idx + 1)]
              })
            });
            if (!res.ok) throw new Error('Local save endpoint returned error');
            localNewsList[idx] = updatedItem;
            alert("Новину успішно відредаговано локально!");
          } catch (localErr) {
            console.warn('Failed to save locally, performing cloud fallback upsert:', localErr);
            // 2. Fallback to Supabase upsert (works on live site rpe-pmg.org.ua)
            const { error } = await sb.from('news').upsert([updatedItem]);
            if (error) throw error;
            alert("Збережено в хмару Supabase (оскільки локальний сервер недоступний на цьому домені)!");
          }
        }
      } else {
        const { error } = await sb.from('news').update({
          title,
          summary,
          content,
          importance,
          tags,
          image_url: imageUrl || null
        }).eq('id', selectedNews.id);
        
        if (error) throw error;
        alert("Новину успішно відредаговано в хмарі!");
      }
      
      const currentId = selectedNews.id;
      
      // Reset form and close modal
      closeModal();
      
      // Reload news list
      await loadNews();
      
      // Re-select the edited item
      const updated = newsList.find(n => n.id === currentId);
      if (updated) {
        selectNews(updated);
      }
      
    } else {
      // Create mode
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
      
      if (error) throw error;
      
      // Reset form and close modal
      closeModal();
      
      // Reload news list
      await loadNews();
      
      alert("Новину успішно опубліковано!");
    }
  } catch (err) {
    console.error("Submit error:", err);
    alert("Сталася помилка: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = modalMode === 'edit' ? "Зберегти зміни" : "Опублікувати новину";
    }
  }
}

function closeModal() {
  const modal = byId("publishModal");
  const form = byId("publishForm");
  if (modal) modal.style.display = "none";
  if (form) form.reset();
}

function handleEditNewsClick() {
  if (!selectedNews) return;
  
  modalMode = 'edit';
  
  const modalTitle = document.querySelector("#publishModal h2");
  if (modalTitle) modalTitle.textContent = "✏️ Редагувати аналітичну новину";
  
  const submitBtn = document.querySelector("#publishForm button[type='submit']");
  if (submitBtn) submitBtn.textContent = "Зберегти зміни";
  
  // Fill inputs
  byId("pubTitle").value = selectedNews.title || "";
  byId("pubSummary").value = selectedNews.summary || "";
  byId("pubContent").value = selectedNews.content || "";
  byId("pubImportance").value = selectedNews.importance || "normal";
  byId("pubTags").value = selectedNews.tags ? selectedNews.tags.join(", ") : "";
  byId("pubImageUrl").value = selectedNews.image_url || "";
  
  const modal = byId("publishModal");
  if (modal) modal.style.display = "flex";
}

function toggleEditAndDeleteButtons() {
  const deleteBtn = byId("deleteNewsBtn");
  const editBtn = byId("editNewsBtn");
  
  if (deleteBtn || editBtn) {
    const allowedRoles = ['manager', 'deputy_director', 'director', 'admin'];
    const isLeadership = allowedRoles.includes(currentUserRole);
    const hasAccess = selectedNews && currentUser && isLeadership;
    // Діловод редагує оголошення, але не видаляє: у таблиці news немає автора,
    // тож обмежити його власними записами неможливо — видалення лишається керівництву
    const canEdit = selectedNews && currentUser && (isLeadership || currentUserIsClerk);

    if (deleteBtn) deleteBtn.style.display = hasAccess ? "block" : "none";
    if (editBtn) editBtn.style.display = canEdit ? "block" : "none";
  }
}

async function handleDeleteNews() {
  if (!selectedNews) return;
  
  const confirmed = confirm(`Ви впевнені, що хочете видалити новину "${selectedNews.title}"?`);
  if (!confirmed) return;
  
  const deleteBtn = byId("deleteNewsBtn");
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Видалення...";
  }

  try {
    const isLocal = localNewsList.some(n => n.id === selectedNews.id);
    if (isLocal) {
      const remainingList = localNewsList.filter(n => n.id !== selectedNews.id);
      
      try {
        const res = await fetch('/api/save-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: 'news.json',
            data: remainingList
          })
        });
        if (!res.ok) throw new Error('Local save endpoint returned error');
        localNewsList = remainingList;
        alert("Новину успішно видалено локально!");
        showDefaultState();
        await loadNews();
      } catch (localErr) {
        console.warn('Failed to delete locally, performing cloud fallback check:', localErr);
        // On live site, since we can't edit news.json directly, we try to see if it was overridden in Supabase
        const { data: dbItem } = await sb.from('news').select('id').eq('id', selectedNews.id).single();
        if (dbItem) {
          // If it exists in Supabase, we can delete it from Supabase
          const { error } = await sb.from('news').delete().eq('id', selectedNews.id);
          if (error) throw error;
          alert("Новину успішно видалено з хмари (вона знову відображатиметься у початковому локальному вигляді)!");
        } else {
          alert("На цьому домені локальний сервер недоступний. Для повного видалення цієї новини з сайту, будь ласка, видаліть її з файлу news.json у Git та відправте оновлення.");
        }
        showDefaultState();
        await loadNews();
      }
    } else {
      const { error } = await sb.from('news').delete().eq('id', selectedNews.id);
      if (error) throw error;
      
      alert("Новину успішно видалено!");
      showDefaultState();
      await loadNews();
    }
  } catch (err) {
    console.error("Delete error:", err);
    alert("Сталася неочікувана помилка при видаленні: " + err.message);
  } finally {
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = "🗑️ Видалити новину";
    }
  }
}

document.addEventListener("DOMContentLoaded", init);
