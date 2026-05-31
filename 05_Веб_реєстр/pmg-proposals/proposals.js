import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let proposalsList = [];
let selectedProposal = null;
let packagesMap = {}; // mapping number -> title

const byId = (id) => document.getElementById(id);

async function init() {
  await loadPackages();
  await loadProposals();

  // Event listeners
  byId("proposalSearch").addEventListener("input", filterAndRender);
  byId("packageFilter").addEventListener("change", filterAndRender);
  byId("addProposalBtn").addEventListener("click", showProposalForm);
  byId("cancelProposalBtn").addEventListener("click", showDefaultState);
  byId("newProposalForm").addEventListener("submit", handleProposalSubmit);
  byId("voteBtn").addEventListener("click", () => {
    if (selectedProposal) handleUpvote(selectedProposal);
  });
}

async function loadPackages() {
  try {
    const res = await fetch("../pakety/data/packages_2026.json");
    if (!res.ok) throw new Error("Could not load packages JSON");
    const payload = await res.json();
    const packages = payload.packages || [];
    
    const filter = byId("packageFilter");
    const select = byId("pPackage");
    
    packages.forEach(pkg => {
      packagesMap[pkg.number] = pkg.title;
      const opt = `<option value="${pkg.number}">Пакет ${pkg.number}: ${pkg.title.substring(0, 50)}...</option>`;
      filter.insertAdjacentHTML('beforeend', opt);
      select.insertAdjacentHTML('beforeend', opt);
    });
  } catch (err) {
    console.warn("Failed to load packages list", err);
  }
}

async function loadProposals() {
  const { data, error } = await sb.from('proposals').select('*').order('upvotes', { ascending: false });
  if (error) {
    console.error('Error loading proposals:', error);
    byId("proposalCount").textContent = "Помилка завантаження";
    return;
  }
  proposalsList = data || [];
  filterAndRender();
  renderStats();
}

function filterAndRender() {
  const searchVal = byId("proposalSearch").value.toLowerCase().trim();
  const pkgVal = byId("packageFilter").value;

  const filtered = proposalsList.filter(p => {
    const matchesSearch = !searchVal || 
      (p.title && p.title.toLowerCase().includes(searchVal)) || 
      (p.description && p.description.toLowerCase().includes(searchVal)) ||
      (p.user_name && p.user_name.toLowerCase().includes(searchVal));
    
    const matchesPkg = !pkgVal || p.package_id === pkgVal;
    
    return matchesSearch && matchesPkg;
  });

  renderCards(filtered);
  byId("proposalCount").textContent = `Знайдено пропозицій: ${filtered.length}`;
}

function renderCards(list) {
  const container = byId("proposalCards");
  container.innerHTML = "";
  
  if (list.length === 0) {
    container.innerHTML = '<div class="no-results">Пропозицій не знайдено.</div>';
    return;
  }

  list.forEach(p => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `proposal-card ${selectedProposal && selectedProposal.id === p.id ? "active" : ""}`;
    card.dataset.id = p.id;

    const pkgTitle = packagesMap[p.package_id] || `Пакет ${p.package_id}`;
    
    card.innerHTML = `
      <div class="proposal-card-content">
        <strong>${escapeHtml(p.title)}</strong>
        <p>Пакет ${escapeHtml(p.package_id)} · Автор: ${escapeHtml(p.user_name || "Користувач")}</p>
      </div>
      <div class="proposal-card-votes">
        ${p.upvotes || 0}
        <span>ГОЛОСІВ</span>
      </div>
    `;

    card.addEventListener("click", () => selectProposal(p));
    container.appendChild(card);
  });
}

function selectProposal(p) {
  selectedProposal = p;
  renderCards(proposalsList);
  
  byId("panelEmptyState").style.display = "none";
  byId("proposalFormContainer").style.display = "none";
  
  const viewer = byId("proposalDetailViewer");
  viewer.style.display = "flex";
  byId("voteStatusMsg").textContent = "";

  const pkgTitle = packagesMap[p.package_id] || `Пакет ${p.package_id}`;
  byId("detPackage").textContent = `Пакет ${p.package_id}: ${pkgTitle}`;
  byId("detProposalTitle").textContent = p.title;
  byId("detAuthor").textContent = `Подано: ${p.user_name || "Користувач"} · ${formatDate(p.created_at)}`;
  byId("detDesc").textContent = p.description;
  byId("detVoteCount").textContent = p.upvotes || 0;

  // Smooth scroll for mobile layout
  if (window.innerWidth <= 1040) {
    byId("proposalPanelSide").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showProposalForm() {
  selectedProposal = null;
  renderCards(proposalsList);
  
  byId("panelEmptyState").style.display = "none";
  byId("proposalDetailViewer").style.display = "none";
  
  byId("proposalFormContainer").style.display = "block";
  byId("formStatus").textContent = "";
  byId("newProposalForm").reset();

  if (window.innerWidth <= 1040) {
    byId("proposalPanelSide").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showDefaultState() {
  selectedProposal = null;
  renderCards(proposalsList);
  
  byId("proposalFormContainer").style.display = "none";
  byId("proposalDetailViewer").style.display = "none";
  byId("panelEmptyState").style.display = "flex";
}

async function handleProposalSubmit(e) {
  e.preventDefault();
  const pkgId = byId("pPackage").value;
  const title = byId("pTitle").value.trim();
  const description = byId("pDesc").value.trim();
  const statusEl = byId("formStatus");
  const submitBtn = byId("submitProposalBtn");

  if (!title || !description || !pkgId) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Опублікування...';
  statusEl.textContent = '';

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = 'Помилка: Ви не авторизовані!';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Опублікувати пропозицію';
    return;
  }

  const profileName = session.user.user_metadata?.full_name || session.user.email.split('@')[0];

  const { error } = await sb.from('proposals').insert({
    user_id: session.user.id,
    user_name: profileName,
    package_id: pkgId,
    title: title,
    description: description,
    upvotes: 0,
    voted_users: []
  });

  submitBtn.disabled = false;
  submitBtn.textContent = 'Опублікувати пропозицію';

  if (error) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = error.message;
  } else {
    statusEl.style.color = 'var(--teal, #08705e)';
    statusEl.textContent = 'Пропозицію успішно опубліковано!';
    byId("newProposalForm").reset();
    setTimeout(() => {
      showDefaultState();
      loadProposals();
    }, 1500);
  }
}

async function handleUpvote(proposal) {
  const statusEl = byId("voteStatusMsg");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = 'Авторизуйтесь для голосування';
    return;
  }
  
  const userId = session.user.id;
  let votedUsers = [];
  
  if (proposal.voted_users) {
    votedUsers = Array.isArray(proposal.voted_users) 
      ? proposal.voted_users 
      : JSON.parse(proposal.voted_users);
  }
  
  if (votedUsers.includes(userId)) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = 'Ви вже підтримали цю пропозицію!';
    return;
  }
  
  votedUsers.push(userId);
  const newUpvotes = (proposal.upvotes || 0) + 1;
  
  const { error } = await sb.from('proposals')
    .update({
      upvotes: newUpvotes,
      voted_users: votedUsers
    })
    .eq('id', proposal.id);
    
  if (error) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = error.message;
  } else {
    // Update local state
    proposal.upvotes = newUpvotes;
    proposal.voted_users = votedUsers;
    byId("detVoteCount").textContent = newUpvotes;
    
    statusEl.style.color = 'var(--teal, #08705e)';
    statusEl.textContent = 'Дякуємо! Пропозицію підтримано.';
    
    // Refresh lists
    loadProposals();
  }
}

function renderStats() {
  const container = byId("proposalsStats");
  if (!container) return;

  const total = proposalsList.length;
  const totalVotes = proposalsList.reduce((acc, p) => acc + (p.upvotes || 0), 0);
  const mostPopular = total > 0 ? proposalsList[0].upvotes || 0 : 0;

  container.innerHTML = `
    <div class="stat">
      <strong>${total}</strong>
      <span>Всього ініціатив</span>
    </div>
    <div class="stat">
      <strong>${totalVotes}</strong>
      <span>Підтримок колег</span>
    </div>
    <div class="stat">
      <strong>${mostPopular}</strong>
      <span>Макс. голосів</span>
    </div>
  `;
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

document.addEventListener("DOMContentLoaded", init);
