import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let questionsList = [];
let selectedQuestion = null;

// Categories map
const CATEGORIES = {
  contracting: "Контрактування ЗОЗ",
  coding: "Кодування та ЕМЗ",
  billing: "Оплата та тарифи",
  technical: "Технічні вимоги",
  other: "Інші питання"
};

const byId = (id) => document.getElementById(id);

async function init() {
  await loadQuestions();
  
  // Event listeners
  byId("questionSearch").addEventListener("input", filterAndRender);
  byId("categoryFilter").addEventListener("change", filterAndRender);
  byId("askQuestionBtn").addEventListener("click", showQuestionForm);
  byId("cancelQuestionBtn").addEventListener("click", showDefaultState);
  byId("newQuestionForm").addEventListener("submit", handleQuestionSubmit);
}

async function loadQuestions() {
  const { data, error } = await sb.from('questions').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Error loading questions:', error);
    byId("questionCount").textContent = "Помилка завантаження";
    return;
  }
  questionsList = data || [];
  filterAndRender();
  renderStats();
}

function filterAndRender() {
  const searchVal = byId("questionSearch").value.toLowerCase().trim();
  const catVal = byId("categoryFilter").value;

  const filtered = questionsList.filter(q => {
    const matchesSearch = !searchVal || 
      (q.question_text && q.question_text.toLowerCase().includes(searchVal)) || 
      (q.answer_text && q.answer_text.toLowerCase().includes(searchVal)) ||
      (q.user_name && q.user_name.toLowerCase().includes(searchVal)) ||
      (q.organization && q.organization.toLowerCase().includes(searchVal));
    
    const matchesCat = !catVal || q.category === catVal;
    
    return matchesSearch && matchesCat;
  });

  renderCards(filtered);
  byId("questionCount").textContent = `Знайдено запитань: ${filtered.length}`;
}

function renderCards(list) {
  const container = byId("questionCards");
  container.innerHTML = "";
  
  if (list.length === 0) {
    container.innerHTML = '<div class="no-results">Запитань не знайдено.</div>';
    return;
  }

  list.forEach(q => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `question-card ${selectedQuestion && selectedQuestion.id === q.id ? "active" : ""}`;
    card.dataset.id = q.id;

    const shortText = q.question_text.length > 120 
      ? q.question_text.substring(0, 120) + "..." 
      : q.question_text;

    const catLabel = CATEGORIES[q.category] || "Інше";
    const statusText = q.status === 'answered' ? 'Відповідь надана' : 'На розгляді';
    const statusClass = q.status === 'answered' ? 'status-answered' : 'status-pending';

    card.innerHTML = `
      <strong>${escapeHtml(shortText)}</strong>
      <div class="card-meta-row">
        <span class="category-badge">${escapeHtml(catLabel)}</span>
        <span class="status-badge ${statusClass}">${statusText}</span>
      </div>
    `;

    card.addEventListener("click", () => selectQuestion(q));
    container.appendChild(card);
  });
}

function selectQuestion(q) {
  selectedQuestion = q;
  renderCards(questionsList); // Update active state class on list
  
  // Hide other panels, show detail
  byId("panelEmptyState").style.display = "none";
  byId("questionFormContainer").style.display = "none";
  
  const viewer = byId("questionDetailViewer");
  viewer.style.display = "flex";

  byId("detCategory").textContent = CATEGORIES[q.category] || q.category;
  byId("detQuestionTitle").textContent = q.question_text.substring(0, 50) + (q.question_text.length > 50 ? "..." : "");
  byId("detAuthor").textContent = `Автор: ${q.user_name || "Користувач"} (${q.organization || "Не вказано"}) · ${formatDate(q.created_at)}`;
  byId("detText").textContent = q.question_text;

  const answerSection = byId("detAnswerSection");
  if (q.status === 'answered' && q.answer_text) {
    answerSection.style.display = "block";
    byId("detAnswer").textContent = q.answer_text;
    byId("detAnswerDate").textContent = `Надано експертами Департаменту: ${formatDate(q.answered_at)}`;
  } else {
    answerSection.style.display = "block";
    byId("detAnswer").innerHTML = `<em>Запит на опрацюванні у спеціалістів Департаменту. Офіційну відповідь буде опубліковано найближчим часом.</em>`;
    byId("detAnswerDate").textContent = "";
  }

  // Smooth scroll for mobile layout
  if (window.innerWidth <= 1040) {
    byId("questionPanelSide").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showQuestionForm() {
  selectedQuestion = null;
  renderCards(questionsList);
  
  byId("panelEmptyState").style.display = "none";
  byId("questionDetailViewer").style.display = "none";
  
  byId("questionFormContainer").style.display = "block";
  byId("formStatus").textContent = "";
  byId("newQuestionForm").reset();

  if (window.innerWidth <= 1040) {
    byId("questionPanelSide").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showDefaultState() {
  selectedQuestion = null;
  renderCards(questionsList);
  
  byId("questionFormContainer").style.display = "none";
  byId("questionDetailViewer").style.display = "none";
  byId("panelEmptyState").style.display = "flex";
}

async function handleQuestionSubmit(e) {
  e.preventDefault();
  const category = byId("qCategory").value;
  const text = byId("qText").value.trim();
  const statusEl = byId("formStatus");
  const submitBtn = byId("submitQuestionBtn");

  if (!text) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Надсилання...';
  statusEl.textContent = '';

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = 'Помилка: Ви не авторизовані!';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Надіслати запит';
    return;
  }

  const profileName = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
  const profileOrg = session.user.user_metadata?.organization || 'Не вказано';

  const { error } = await sb.from('questions').insert({
    user_id: session.user.id,
    user_name: profileName,
    organization: profileOrg,
    category: category,
    question_text: text,
    status: 'pending'
  });

  submitBtn.disabled = false;
  submitBtn.textContent = 'Надіслати запит';

  if (error) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = error.message;
  } else {
    statusEl.style.color = 'var(--teal, #08705e)';
    statusEl.textContent = 'Ваше запитання надіслано! Воно з\'явиться в списку після надання відповіді Департаментом.';
    byId("newQuestionForm").reset();
    setTimeout(() => {
      showDefaultState();
      loadQuestions();
    }, 2000);
  }
}

function renderStats() {
  const container = byId("questionsStats");
  if (!container) return;

  const total = questionsList.length;
  const answered = questionsList.filter(q => q.status === 'answered').length;
  const pending = total - answered;

  container.innerHTML = `
    <div class="stat">
      <strong>${total}</strong>
      <span>Всього питань</span>
    </div>
    <div class="stat">
      <strong>${answered}</strong>
      <span>З відповідями</span>
    </div>
    <div class="stat">
      <strong>${pending}</strong>
      <span>На розгляді</span>
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
