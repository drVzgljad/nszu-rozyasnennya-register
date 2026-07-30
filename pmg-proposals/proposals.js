import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let proposalsList = [];
let selectedProposal = null;
let packagesMap = {}; // mapping number -> title

const LETTERS_BUCKET = 'proposal-letters';
const MAX_LETTER_SIZE = 20 * 1024 * 1024; // 20 МБ

const TOPIC_LABELS = {
  'zahalne': 'ПМГ — загальні питання',
  'zmina-paketu': 'Зміна пакета',
  'novyi-paket': 'Новий пакет',
  'taryfy': 'Тарифи'
};

const RESPONSE_LABELS = {
  'sluzhbova': 'Службова записка керівництву',
  'rozjasnennya': "Роз'яснення НСЗУ",
  'lyst': 'Лист-відповідь заявнику',
  'zmina-postanovy': 'Зміни до постанови ПМГ',
  'zmina-spec': 'Зміни до специфікацій / умов закупівлі',
  'moz': 'Передати на розгляд МОЗ',
  'bez-reahuvannya': 'Без реагування (до відома)'
};

const isProcessed = (p) => !!(p.processed_at || p.analysis || p.implementation || p.risks ||
  (Array.isArray(p.response_types) && p.response_types.length));

const byId = (id) => document.getElementById(id);

async function init() {
  await loadPackages();
  await loadProposals();

  // Event listeners
  byId("proposalSearch").addEventListener("input", filterAndRender);
  byId("packageFilter").addEventListener("change", filterAndRender);
  byId("topicFilter").addEventListener("change", filterAndRender);
  byId("addProposalBtn").addEventListener("click", showProposalForm);
  byId("cancelProposalBtn").addEventListener("click", showDefaultState);
  byId("newProposalForm").addEventListener("submit", handleProposalSubmit);
  byId("upvoteBtn").addEventListener("click", () => {
    if (selectedProposal) handleVote(selectedProposal, 'up');
  });
  byId("downvoteBtn").addEventListener("click", () => {
    if (selectedProposal) handleVote(selectedProposal, 'down');
  });
  byId("btnResInWork").addEventListener("click", () => {
    if (selectedProposal) handleResolution(selectedProposal, 'in_work');
  });
  byId("btnResReject").addEventListener("click", () => {
    if (selectedProposal) handleResolution(selectedProposal, 'rejected');
  });
  byId("btnResReset").addEventListener("click", () => {
    if (selectedProposal) handleResolution(selectedProposal, 'null');
  });
  byId("editProcessingBtn").addEventListener("click", showProcessingForm);
  byId("cancelProcessingBtn").addEventListener("click", () => {
    if (selectedProposal) renderProcessing(selectedProposal);
  });
  byId("processingForm").addEventListener("submit", handleProcessingSubmit);
  byId("toggleDescFullscreenBtn").addEventListener("click", showDescriptionModal);
  byId("descModalCloseBtn").addEventListener("click", hideDescriptionModal);
  byId("descModalBackdrop").addEventListener("click", hideDescriptionModal);
}

async function loadPackages() {
  try {
    // Для випадаючих списків потрібні тільки номер і назва — короткий перелік
    // на 7 КБ замість повного файла пакетів на 4,3 МБ
    let res = await fetch("../pakety/data/packages_lite.json");
    if (!res.ok) res = await fetch("../pakety/data/packages_2026.json");
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
  const topicVal = byId("topicFilter").value;

  const filtered = proposalsList.filter(p => {
    const matchesSearch = !searchVal ||
      (p.title && p.title.toLowerCase().includes(searchVal)) ||
      (p.description && p.description.toLowerCase().includes(searchVal)) ||
      (p.user_name && p.user_name.toLowerCase().includes(searchVal)) ||
      (p.submitter && p.submitter.toLowerCase().includes(searchVal)) ||
      (p.letter_number && p.letter_number.toLowerCase().includes(searchVal));

    const matchesPkg = !pkgVal || p.package_id === pkgVal;
    const matchesTopic = !topicVal || p.topic === topicVal;

    return matchesSearch && matchesPkg && matchesTopic;
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

    const resolutionBadge = p.resolution === 'in_work'
      ? '<span class="resolution-badge in-work">📥 В роботу</span>'
      : p.resolution === 'rejected'
      ? '<span class="resolution-badge rejected">❌ Відхилено</span>'
      : '';

    const metaParts = [];
    if (p.topic && TOPIC_LABELS[p.topic]) metaParts.push(TOPIC_LABELS[p.topic]);
    if (p.package_id) metaParts.push(`Пакет ${escapeHtml(p.package_id)}`);
    metaParts.push(`Пропонує: ${escapeHtml(p.submitter || p.user_name || "Користувач")}`);

    const letterBadge = p.letter_number
      ? `<span class="letter-badge">📄 Лист № ${escapeHtml(p.letter_number)}</span>`
      : '';

    const processedBadge = isProcessed(p)
      ? '<span class="processed-badge">🛠 Опрацьовано</span>'
      : '';

    card.innerHTML = `
      <div class="proposal-card-content">
        <strong>${escapeHtml(p.title)}</strong>
        <div class="proposal-card-meta">
          <p>${metaParts.join(' · ')}</p>
          <div class="card-badges">${letterBadge}${processedBadge}${resolutionBadge}</div>
        </div>
      </div>
      <div class="proposal-card-votes">
        ${p.upvotes || 0}
        <span>АКТУАЛЬНО</span>
      </div>
    `;

    card.addEventListener("click", () => selectProposal(p));
    container.appendChild(card);
  });
}

async function selectProposal(p) {
  selectedProposal = p;
  renderCards(proposalsList);
  
  byId("panelEmptyState").style.display = "none";
  byId("proposalFormContainer").style.display = "none";
  
  const viewer = byId("proposalDetailViewer");
  viewer.style.display = "flex";
  byId("voteStatusMsg").textContent = "";
  byId("resolutionStatusMsg").textContent = "";

  // Topic badge
  const topicEl = byId("detTopic");
  if (p.topic && TOPIC_LABELS[p.topic]) {
    topicEl.textContent = TOPIC_LABELS[p.topic];
    topicEl.style.display = "inline-flex";
  } else {
    topicEl.style.display = "none";
  }

  // Package badge
  if (p.package_id) {
    const pkgTitle = packagesMap[p.package_id] || `Пакет ${p.package_id}`;
    byId("detPackage").textContent = `Пакет ${p.package_id}: ${pkgTitle}`;
    byId("detPackage").style.display = "inline-flex";
  } else {
    byId("detPackage").style.display = "none";
  }

  byId("detProposalTitle").textContent = p.title;

  const authorParts = [];
  if (p.submitter) authorParts.push(`Пропонує: ${p.submitter}`);
  authorParts.push(`Вніс до реєстру: ${p.user_name || "Користувач"} · ${formatDate(p.created_at)}`);
  byId("detAuthor").textContent = authorParts.join(" — ");

  // Letter info (number, date, attachment link)
  const letterInfo = byId("detLetterInfo");
  if (p.letter_number || p.letter_date || p.letter_url) {
    let letterText = "📄 Лист";
    if (p.letter_number) letterText += ` № ${p.letter_number}`;
    if (p.letter_date) letterText += ` від ${formatDate(p.letter_date)}`;
    byId("detLetterText").textContent = letterText;

    const link = byId("detLetterLink");
    if (p.letter_url) {
      link.href = p.letter_url;
      link.style.display = "inline-flex";
    } else {
      link.style.display = "none";
    }
    letterInfo.style.display = "flex";
  } else {
    letterInfo.style.display = "none";
  }

  byId("detDesc").textContent = p.description;

  renderProcessing(p);

  // Show upvotes and downvotes
  byId("detUpvotes").textContent = p.upvotes || 0;
  byId("detDownvotes").textContent = p.downvotes || 0;

  // Show resolution status
  const resLabels = {
    'in_work': '📥 В роботу',
    'rejected': '❌ Відхилено'
  };
  byId("detResolution").textContent = resLabels[p.resolution] || 'Немає';

  // Check director/admin role for resolution actions visibility
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single();
    const isDirector = (profile?.role === 'director' || profile?.role === 'admin');
    byId("resolutionActions").style.display = isDirector ? "flex" : "none";
  } else {
    byId("resolutionActions").style.display = "none";
  }

  // Fetch and render voters names
  await renderVoters(p);

  // Smooth scroll for mobile layout
  if (window.innerWidth <= 1040) {
    byId("proposalPanelSide").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showProposalForm() {
  hideDescriptionModal();
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
  hideDescriptionModal();
  selectedProposal = null;
  renderCards(proposalsList);
  
  byId("proposalFormContainer").style.display = "none";
  byId("proposalDetailViewer").style.display = "none";
  byId("panelEmptyState").style.display = "flex";
}

async function handleProposalSubmit(e) {
  e.preventDefault();
  const topic = byId("pTopic").value;
  const pkgId = byId("pPackage").value;
  const submitter = byId("pSubmitter").value.trim();
  const letterNumber = byId("pLetterNumber").value.trim();
  const letterDate = byId("pLetterDate").value;
  const letterFile = byId("pLetterFile").files[0] || null;
  const title = byId("pTitle").value.trim();
  const description = byId("pDesc").value.trim();
  const statusEl = byId("formStatus");
  const submitBtn = byId("submitProposalBtn");

  const fail = (msg) => {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = msg;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Опублікувати пропозицію';
  };

  if (!title || !description || !topic) return;

  if (topic === 'zmina-paketu' && !pkgId) {
    fail('Для теми «Зміна пакета» оберіть пакет ПМГ.');
    return;
  }

  if (letterFile && letterFile.size > MAX_LETTER_SIZE) {
    fail('Файл листа завеликий (понад 20 МБ). Стисніть PDF або завантажте меншу версію.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Опублікування...';
  statusEl.textContent = '';

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    fail('Помилка: Ви не авторизовані!');
    return;
  }

  // Upload the letter file (if attached) to Supabase Storage
  let letterUrl = null;
  if (letterFile) {
    submitBtn.textContent = 'Завантаження листа...';
    const ext = (letterFile.name.split('.').pop() || 'pdf').toLowerCase();
    const path = `${session.user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from(LETTERS_BUCKET).upload(path, letterFile, {
      contentType: letterFile.type || undefined,
      upsert: false
    });
    if (upErr) {
      fail(`Не вдалося завантажити файл листа: ${upErr.message}. Спробуйте ще раз або подайте без файла.`);
      return;
    }
    const { data: pub } = sb.storage.from(LETTERS_BUCKET).getPublicUrl(path);
    letterUrl = pub?.publicUrl || null;
    submitBtn.textContent = 'Опублікування...';
  }

  const profileName = session.user.user_metadata?.full_name || session.user.email.split('@')[0];

  const payload = {
    user_id: session.user.id,
    user_name: profileName,
    package_id: pkgId || null,
    title: title,
    description: description,
    topic: topic,
    submitter: submitter || null,
    letter_number: letterNumber || null,
    letter_date: letterDate || null,
    letter_url: letterUrl,
    upvotes: 0,
    voted_users: []
  };

  let { error } = await sb.from('proposals').insert(payload);

  // Fallback for legacy schema (new columns not yet added): keep letter meta inside description
  if (error && /column|schema/i.test(error.message || '')) {
    const metaLines = [];
    if (submitter) metaLines.push(`Пропонує: ${submitter}`);
    if (letterNumber || letterDate) metaLines.push(`Лист${letterNumber ? ` № ${letterNumber}` : ''}${letterDate ? ` від ${letterDate}` : ''}`);
    if (TOPIC_LABELS[topic]) metaLines.push(`Тема: ${TOPIC_LABELS[topic]}`);
    if (letterUrl) metaLines.push(`Файл листа: ${letterUrl}`);
    const legacyDesc = metaLines.length ? `${metaLines.join('\n')}\n\n${description}` : description;

    ({ error } = await sb.from('proposals').insert({
      user_id: session.user.id,
      user_name: profileName,
      package_id: pkgId || '0',
      title: title,
      description: legacyDesc,
      upvotes: 0,
      voted_users: []
    }));
  }

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

async function handleVote(proposal, type) {
  const statusEl = byId("voteStatusMsg");
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = 'Авторизуйтесь для голосування';
    return;
  }
  
  const userId = session.user.id;
  let votedUsers = Array.isArray(proposal.voted_users) 
    ? proposal.voted_users 
    : JSON.parse(proposal.voted_users || '[]');
  let votedDownUsers = Array.isArray(proposal.voted_down_users) 
    ? proposal.voted_down_users 
    : JSON.parse(proposal.voted_down_users || '[]');

  const hasUpvoted = votedUsers.includes(userId);
  const hasDownvoted = votedDownUsers.includes(userId);

  if (type === 'up') {
    if (hasUpvoted) {
      statusEl.style.color = '#c0392b';
      statusEl.textContent = 'Ви вже позначили цю пропозицію як актуальну!';
      return;
    }
    // Remove downvote if any
    if (hasDownvoted) {
      votedDownUsers = votedDownUsers.filter(id => id !== userId);
    }
    votedUsers.push(userId);
  } else if (type === 'down') {
    if (hasDownvoted) {
      statusEl.style.color = '#c0392b';
      statusEl.textContent = 'Ви вже позначили цю пропозицію як неактуальну!';
      return;
    }
    // Remove upvote if any
    if (hasUpvoted) {
      votedUsers = votedUsers.filter(id => id !== userId);
    }
    votedDownUsers.push(userId);
  }

  const newUpvotes = votedUsers.length;
  const newDownvotes = votedDownUsers.length;

  const { error } = await sb.from('proposals')
    .update({
      upvotes: newUpvotes,
      voted_users: votedUsers,
      downvotes: newDownvotes,
      voted_down_users: votedDownUsers
    })
    .eq('id', proposal.id);
    
  if (error) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = error.message;
  } else {
    // Update local state
    proposal.upvotes = newUpvotes;
    proposal.voted_users = votedUsers;
    proposal.downvotes = newDownvotes;
    proposal.voted_down_users = votedDownUsers;
    
    byId("detUpvotes").textContent = newUpvotes;
    byId("detDownvotes").textContent = newDownvotes;
    
    statusEl.style.color = 'var(--teal, #08705e)';
    statusEl.textContent = type === 'up' ? 'Дякуємо! Позначено як актуально.' : 'Дякуємо! Позначено як неактуально.';
    
    // Refresh voters names
    await renderVoters(proposal);
    
    // Refresh lists
    loadProposals();
  }
}

async function handleResolution(proposal, status) {
  const statusEl = byId("resolutionStatusMsg");
  const dbStatus = status === 'null' ? null : status;

  const { error } = await sb.from('proposals')
    .update({
      resolution: dbStatus
    })
    .eq('id', proposal.id);

  if (error) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = error.message;
  } else {
    proposal.resolution = dbStatus;
    const resLabels = {
      'in_work': '📥 В роботу',
      'rejected': '❌ Відхилено'
    };
    byId("detResolution").textContent = resLabels[dbStatus] || 'Немає';
    
    statusEl.style.color = 'var(--teal, #08705e)';
    statusEl.textContent = 'Резолюцію успішно оновлено!';
    
    // Refresh lists
    loadProposals();
  }
}

// ── Опрацювання пропозиції ──

function renderProcessing(p) {
  byId("processingForm").style.display = "none";
  byId("processingStatus").textContent = "";

  if (!isProcessed(p)) {
    byId("processingView").style.display = "none";
    byId("processingEmpty").style.display = "block";
    byId("editProcessingBtn").textContent = "🛠 Опрацювати";
    return;
  }

  byId("processingEmpty").style.display = "none";
  byId("processingView").style.display = "block";
  byId("editProcessingBtn").textContent = "✏️ Редагувати";

  const fillBlock = (blockId, viewId, value) => {
    byId(blockId).style.display = value ? "block" : "none";
    byId(viewId).textContent = value || "";
  };

  fillBlock("procAnalysisBlock", "procAnalysisView", p.analysis);
  fillBlock("procImplementationBlock", "procImplementationView", p.implementation);
  fillBlock("procRisksBlock", "procRisksView", p.risks);

  const types = Array.isArray(p.response_types) ? p.response_types : [];
  const badgesEl = byId("procResponseView");
  badgesEl.innerHTML = types
    .filter(t => RESPONSE_LABELS[t])
    .map(t => `<span class="response-badge">${escapeHtml(RESPONSE_LABELS[t])}</span>`)
    .join("");
  byId("procResponseCommentView").textContent = p.response_comment || "";
  byId("procResponseBlock").style.display = (types.length || p.response_comment) ? "block" : "none";

  byId("procMetaView").textContent = p.processed_by
    ? `Опрацював(ла): ${p.processed_by}${p.processed_at ? ` · ${formatDate(p.processed_at)}` : ""}`
    : "";
}

function showProcessingForm() {
  const p = selectedProposal;
  if (!p) return;

  byId("processingEmpty").style.display = "none";
  byId("processingView").style.display = "none";
  byId("processingForm").style.display = "block";
  byId("processingStatus").textContent = "";

  byId("procAnalysis").value = p.analysis || "";
  byId("procImplementation").value = p.implementation || "";
  byId("procRisks").value = p.risks || "";
  byId("procResponseComment").value = p.response_comment || "";

  const types = Array.isArray(p.response_types) ? p.response_types : [];
  byId("responseOptions").querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.checked = types.includes(cb.value);
  });
}

async function handleProcessingSubmit(e) {
  e.preventDefault();
  const p = selectedProposal;
  if (!p) return;

  const statusEl = byId("processingStatus");
  const saveBtn = byId("saveProcessingBtn");

  const analysis = byId("procAnalysis").value.trim();
  const implementation = byId("procImplementation").value.trim();
  const risks = byId("procRisks").value.trim();
  const responseComment = byId("procResponseComment").value.trim();
  const responseTypes = [...byId("responseOptions").querySelectorAll("input[type=checkbox]:checked")]
    .map(cb => cb.value);

  if (!analysis && !implementation && !risks && !responseTypes.length && !responseComment) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = 'Заповніть хоча б одне поле опрацювання.';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Збереження...';
  statusEl.textContent = '';

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = 'Авторизуйтесь, щоб зберегти опрацювання.';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Зберегти опрацювання';
    return;
  }

  const profileName = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
  const processedAt = new Date().toISOString();

  const { error } = await sb.from('proposals')
    .update({
      analysis: analysis || null,
      implementation: implementation || null,
      risks: risks || null,
      response_types: responseTypes,
      response_comment: responseComment || null,
      processed_by: profileName,
      processed_at: processedAt
    })
    .eq('id', p.id);

  saveBtn.disabled = false;
  saveBtn.textContent = 'Зберегти опрацювання';

  if (error) {
    statusEl.style.color = '#c0392b';
    statusEl.textContent = /column|schema/i.test(error.message || '')
      ? 'У базі ще немає полів опрацювання — виконайте міграцію в Supabase (migration_2026-07-18_proposal_letters.sql).'
      : error.message;
  } else {
    p.analysis = analysis || null;
    p.implementation = implementation || null;
    p.risks = risks || null;
    p.response_types = responseTypes;
    p.response_comment = responseComment || null;
    p.processed_by = profileName;
    p.processed_at = processedAt;

    renderProcessing(p);
    loadProposals();
  }
}

function renderStats() {
  const container = byId("proposalsStats");
  if (!container) return;

  const total = proposalsList.length;
  const totalVotes = proposalsList.reduce((acc, p) => acc + (p.upvotes || 0), 0);
  const processedCount = proposalsList.filter(isProcessed).length;

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
      <strong>${processedCount}</strong>
      <span>Опрацьовано</span>
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

function showDescriptionModal() {
  if (selectedProposal) {
    byId("descModalBody").textContent = selectedProposal.description;
    byId("descModal").classList.add("show");
    document.body.classList.add("body-no-scroll");
  }
}

function hideDescriptionModal() {
  const modal = byId("descModal");
  if (modal) {
    modal.classList.remove("show");
  }
  document.body.classList.remove("body-no-scroll");
}

async function renderVoters(p) {
  const upvoteIds = Array.isArray(p.voted_users) 
    ? p.voted_users 
    : JSON.parse(p.voted_users || '[]');
  const downvoteIds = Array.isArray(p.voted_down_users) 
    ? p.voted_down_users 
    : JSON.parse(p.voted_down_users || '[]');

  const allVoterIds = [...upvoteIds, ...downvoteIds];

  if (allVoterIds.length === 0) {
    byId("votersListSection").style.display = "none";
    return;
  }

  try {
    const { data: profiles, error } = await sb.from('profiles').select('id, full_name').in('id', allVoterIds);
    if (error) throw error;

    const namesMap = {};
    if (profiles) {
      profiles.forEach(u => {
        namesMap[u.id] = u.full_name || 'Колега';
      });
    }

    const upvotersNames = upvoteIds.map(id => namesMap[id] || 'Колега');
    const downvotersNames = downvoteIds.map(id => namesMap[id] || 'Колега');

    if (upvotersNames.length > 0) {
      byId("upvotersGroup").style.display = "block";
      byId("upvotersList").textContent = upvotersNames.join(', ');
    } else {
      byId("upvotersGroup").style.display = "none";
    }

    if (downvotersNames.length > 0) {
      byId("downvotersGroup").style.display = "block";
      byId("downvotersList").textContent = downvotersNames.join(', ');
    } else {
      byId("downvotersGroup").style.display = "none";
    }

    byId("votersListSection").style.display = "block";
  } catch (err) {
    console.warn("Failed to load voters profiles:", err);
    byId("votersListSection").style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", init);

/* ── Файли листів із приватного бакета (підписані URL) ── */
/* letter_url у БД — старий публічний URL; після переведення бакета в приватний
   доступ іде через короткоживучий підписаний URL при відкритті. */
const STORAGE_PUBLIC_RE = /\/storage\/v1\/object\/public\/([^/]+)\/([^?]+)/;

async function signedStorageUrl(url) {
  const m = (url || '').match(STORAGE_PUBLIC_RE);
  if (!m) return null;
  try {
    const { data } = await sb.storage.from(m[1]).createSignedUrl(decodeURIComponent(m[2]), 3600);
    return (data && data.signedUrl) || null;
  } catch (_) { return null; }
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href*="/storage/v1/object/public/"]');
  if (!a) return;
  e.preventDefault();
  const w = window.open('', '_blank');
  signedStorageUrl(a.href).then((signed) => {
    const target = signed || a.href;
    if (w) { w.location = target; } else { window.open(target, '_blank'); }
  });
});
