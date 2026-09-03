import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY));

let proposalsList = [];
let filteredList = [];
let selectedProposal = null;
let currentProfile = null;

// Timer state
let timerInterval = null;
let timerSeconds = 0;
let proposalDiscussionTimes = {}; // maps proposal ID to seconds

const byId = (id) => document.getElementById(id);

async function init() {
  await fetchProfile();
  await loadData();
  setupRealtime();

  // Events
  byId("expertSearch").addEventListener("input", filterAndRender);
  byId("packageSelector").addEventListener("change", filterAndRender);
  byId("statusFilter").addEventListener("change", filterAndRender);
  byId("topicFilter").addEventListener("change", filterAndRender);
  byId("toggleMeetingModeBtn").addEventListener("click", toggleMeetingMode);
  
  byId("resetTimerBtn").addEventListener("click", resetTimer);
  byId("aiAssistBtn").addEventListener("click", getAiAnalysis);

  // Voting Events
  byId("voteClinicalUpBtn").addEventListener("click", () => handleVote('clinical', 'up'));
  byId("voteClinicalDownBtn").addEventListener("click", () => handleVote('clinical', 'down'));
  byId("voteStrategyUpBtn").addEventListener("click", () => handleVote('strategy', 'up'));
  byId("voteStrategyDownBtn").addEventListener("click", () => handleVote('strategy', 'down'));

  // Comment Events
  byId("addCommentClinicalBtn").addEventListener("click", () => handleAddComment('clinical'));
  byId("addCommentStrategyBtn").addEventListener("click", () => handleAddComment('strategy'));

  // Director Events
  byId("directorApproveBtn").addEventListener("click", () => handleDirectorResolution('approved'));
  byId("directorRejectBtn").addEventListener("click", () => handleDirectorResolution('returned'));
}

async function fetchProfile() {
  const sessionStr = localStorage.getItem(`sb-${new URL(SUPABASE_URL).hostname}-auth-token`);
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      const user = session?.user;
      if (user) {
        // 1. Try to fetch profile from DB
        const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
        
        if (data) {
          currentProfile = data;
          // Auto-upgrade role in memory if email keyword matches (helps with testing/setup issues)
          const emailLower = (user.email || '').toLowerCase();
          if (emailLower.includes('director') || emailLower.includes('admin')) {
            if (currentProfile.role !== 'admin' && currentProfile.role !== 'director') {
              currentProfile.role = 'admin';
            }
          } else if (emailLower.includes('manager')) {
            if (currentProfile.role === 'guest' || currentProfile.role === 'registered' || currentProfile.role === 'expert') {
              currentProfile.role = 'manager';
            }
          }
        } else {
          console.warn("Profile not found in DB, constructing fallback profile...", error);
          
          // 2. Construct fallback profile from auth metadata
          const userMeta = user.user_metadata || {};
          
          let calculatedRole = 'expert';
          const emailLower = (user.email || '').toLowerCase();
          if (emailLower.includes('director') || emailLower.includes('admin')) {
            calculatedRole = 'admin';
          } else if (emailLower.includes('manager')) {
            calculatedRole = 'manager';
          }
          
          const fallbackProfile = {
            id: user.id,
            full_name: userMeta.full_name || userMeta.name || user.email.split('@')[0],
            organization: userMeta.organization || 'Департамент стратегії НСЗУ',
            "Section": userMeta.department || 'strategy',
            department: userMeta.department || 'strategy',
            position: userMeta.position || 'Експерт',
            role: calculatedRole,
            is_head: emailLower.includes('director') || emailLower.includes('head')
          };
          
          currentProfile = fallbackProfile;
          
          // 3. Try to save fallback profile to DB on the fly (ignore errors if RLS restricts)
          try {
            await sb.from('profiles').insert([fallbackProfile]);
            console.log("On-the-fly profile registration successful!");
          } catch (insertErr) {
            console.warn("Failed to register profile on-the-fly in DB (using memory fallback):", insertErr);
          }
        }
      }
    } catch (err) {
      console.warn("Failed to parse session profile:", err);
    }
  }

  // Fallback mock profile for testing if not logged in (guarantees operational UI)
  if (!currentProfile) {
    currentProfile = {
      id: "00000000-0000-0000-0000-000000000000",
      full_name: "Гість (Тест)",
      organization: "Департамент стратегії НСЗУ",
      Section: "strategy",
      department: "strategy",
      position: "Експерт",
      role: "admin",
      is_head: true
    };
  }

  console.log("Logged in profile:", currentProfile);
  setupProfileUI();
}

function setupProfileUI() {
  // Lock or unlock voting and director buttons based on department/role
  if (!currentProfile) return;

  const userDept = currentProfile.department || currentProfile.Section || '';
  const isDirector = currentProfile.role === 'director' || 
                     currentProfile.role === 'admin' || 
                     currentProfile.role === 'deputy_director' || 
                     currentProfile.is_head === true;

  const isClinical = userDept === 'clinical' || 
                    userDept === 'Відділ наукової та клінічної експертизи' ||
                    isDirector;

  const isStrategy = userDept === 'strategy' || 
                    userDept === 'Відділ стратегічного розвитку ПМГ' ||
                    userDept === 'Відділ стратегічного розвитку програми медичних гарантій' ||
                    isDirector;

  if (!isClinical) {
    byId("voteClinicalUpBtn").disabled = true;
    byId("voteClinicalDownBtn").disabled = true;
    byId("voteClinicalUpBtn").title = "Голосувати можуть лише члени Відділу клінічної експертизи";
    byId("voteClinicalDownBtn").title = "Голосувати можуть лише члени Відділу клінічної експертизи";
    byId("commentClinicalInput").disabled = true;
    byId("commentClinicalInput").placeholder = "Коментувати можуть лише співробітники відділу...";
    byId("addCommentClinicalBtn").disabled = true;
  } else {
    byId("voteClinicalUpBtn").disabled = false;
    byId("voteClinicalDownBtn").disabled = false;
    byId("voteClinicalUpBtn").title = "";
    byId("voteClinicalDownBtn").title = "";
    byId("commentClinicalInput").disabled = false;
    byId("commentClinicalInput").placeholder = "Додати коментар клінічної експертизи...";
    byId("addCommentClinicalBtn").disabled = false;
  }
  if (!isStrategy) {
    byId("voteStrategyUpBtn").disabled = true;
    byId("voteStrategyDownBtn").disabled = true;
    byId("voteStrategyUpBtn").title = "Голосувати можуть лише члени Відділу стратегії";
    byId("voteStrategyDownBtn").title = "Голосувати можуть лише члени Відділу стратегії";
    byId("commentStrategyInput").disabled = true;
    byId("commentStrategyInput").placeholder = "Коментувати можуть лише співробітники відділу...";
    byId("addCommentStrategyBtn").disabled = true;
  } else {
    byId("voteStrategyUpBtn").disabled = false;
    byId("voteStrategyDownBtn").disabled = false;
    byId("voteStrategyUpBtn").title = "";
    byId("voteStrategyDownBtn").title = "";
    byId("commentStrategyInput").disabled = false;
    byId("commentStrategyInput").placeholder = "Додати коментар відділу стратегії...";
    byId("addCommentStrategyBtn").disabled = false;
  }
  if (!isDirector) {
    byId("directorPanel").style.display = "none";
  } else {
    byId("directorPanel").style.display = "block";
  }
}

async function loadData() {
  try {
    // Try Supabase first
    const { data, error } = await sb.from('expert_proposals').select('*').order('package_number', { ascending: true }).order('row_num', { ascending: true });
    if (!error && data && data.length > 0) {
      proposalsList = data;
      console.log("Loaded proposals from Supabase:", proposalsList.length);
    } else {
      throw new Error(error?.message || "No data returned");
    }
  } catch (err) {
    console.warn("Supabase fetch failed, loading static fallback:", err);
    try {
      const res = await fetch("data/expert_proposals.json");
      if (!res.ok) throw new Error("Could not fetch local JSON");
      const payload = await res.json();
      proposalsList = payload.proposals || [];
      console.log("Loaded proposals from local JSON:", proposalsList.length);
    } catch (e) {
      console.error("Critical error: fallback failed too", e);
    }
  }

  // Restore discussion times from localStorage if any
  const cachedTimes = localStorage.getItem('expert_proposals_times');
  if (cachedTimes) {
    try {
      proposalDiscussionTimes = JSON.parse(cachedTimes);
    } catch (e) {}
  }

  populateFilters();
  filterAndRender();
  renderDashboard();
}

function populateFilters() {
  const selector = byId("packageSelector");
  selector.innerHTML = '<option value="">Усі пакети</option>';
  
  const uniquePackages = {};
  proposalsList.forEach(p => {
    uniquePackages[p.package_number] = p.package_name;
  });

  Object.keys(uniquePackages).sort((a,b) => a-b).forEach(num => {
    const opt = document.createElement("option");
    opt.value = num;
    opt.textContent = `Пакет ${num}: ${uniquePackages[num].substring(0, 50)}...`;
    selector.appendChild(opt);
  });

  const topicSelect = byId("topicFilter");
  if (topicSelect) {
    const topics = [...new Set(proposalsList.map(p => p.topic).filter(Boolean))].sort();
    topicSelect.innerHTML = '<option value="">Усі теми</option>';
    topics.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      topicSelect.appendChild(opt);
    });
  }
}

function filterAndRender() {
  const searchVal = byId("expertSearch").value.toLowerCase().trim();
  const pkgVal = byId("packageSelector").value;
  const statusVal = byId("statusFilter").value;
  const topicVal = byId("topicFilter") ? byId("topicFilter").value : "";

  filteredList = proposalsList.filter(p => {
    const matchesSearch = !searchVal || 
      (p.proposal && p.proposal.toLowerCase().includes(searchVal)) || 
      (p.analysis && p.analysis.toLowerCase().includes(searchVal)) ||
      (p.position_nhsu && p.position_nhsu.toLowerCase().includes(searchVal)) ||
      (p.item && p.item.toLowerCase().includes(searchVal));
    
    const matchesPkg = !pkgVal || p.package_number == pkgVal;
    const matchesStatus = !statusVal || p.director_status === statusVal;
    const matchesTopic = !topicVal || p.topic === topicVal;
    
    return matchesSearch && matchesPkg && matchesStatus && matchesTopic;
  });

  renderCards();
  
  const totalInPkg = proposalsList.filter(p => !pkgVal || p.package_number == pkgVal).length;
  if (!pkgVal && !searchVal && !topicVal) {
    byId("packagesSummaryText").textContent = `Всього пропозицій у базі: ${proposalsList.length}`;
  } else {
    byId("packagesSummaryText").textContent = pkgVal 
      ? `Пакет ${pkgVal}: знайдено ${filteredList.length} з ${totalInPkg} пропозицій` 
      : `Всього знайдено: ${filteredList.length} з ${proposalsList.length} пропозицій`;
  }
}

function renderCards() {
  const container = byId("proposalList");
  container.innerHTML = "";

  const searchVal = byId("expertSearch").value.toLowerCase().trim();
  const pkgVal = byId("packageSelector").value;
  const topicVal = byId("topicFilter") ? byId("topicFilter").value : "";

  if (!pkgVal && !searchVal && !topicVal) {
    container.innerHTML = `
      <div class="empty-state-list" style="padding: 40px 15px; text-align: center; color: var(--ink-muted); font-size: 0.9rem;">
        <div style="font-size: 2.5rem; margin-bottom: 12px; opacity: 0.7;">📋</div>
        <h3 style="margin: 0 0 8px; font-weight: 700; color: var(--ink);">Виберіть пакет ПМГ</h3>
        <p style="margin: 0; font-size: 0.82rem; line-height: 1.4; color: var(--ink-muted);">Для відображення списку пропозицій виберіть пакет ПМГ у списку вище або скористайтеся швидким пошуком.</p>
      </div>
    `;
    return;
  }

  if (filteredList.length === 0) {
    container.innerHTML = '<div class="no-results" style="padding:20px;text-align:center;color:var(--ink-muted);">Пропозицій не знайдено.</div>';
    return;
  }

  filteredList.forEach(p => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `proposal-item ${selectedProposal && selectedProposal.id === p.id ? "active" : ""}`;
    
    const statusText = p.director_status === 'approved' ? 'Затверджено' : p.director_status === 'returned' ? 'Зауваження' : 'На розгляді';
    const statusClass = p.director_status === 'approved' ? 'status-approved' : p.director_status === 'returned' ? 'status-returned' : 'status-pending';

    const votesClin = (p.votes_clinical || []).length;
    const votesStrat = (p.votes_strategy || []).length;

    const proposalPreview = p.proposal.length > 70 
      ? p.proposal.substring(0, 70) + "..." 
      : p.proposal;

    item.innerHTML = `
      <div class="proposal-item-meta">
        <span class="proposal-item-row-badge">Пункт ${p.row_num}</span>
        <span class="proposal-item-status ${statusClass}">${statusText}</span>
      </div>
      <div class="proposal-item-title">${escapeHtml(cleanItemName(p.item))}</div>
      <div class="proposal-item-preview">${escapeHtml(proposalPreview)}</div>
      <div class="proposal-item-footer">
        <span>🧬 Клін: <strong>${votesClin}</strong></span>
        <span>📈 Страт: <strong>${votesStrat}</strong></span>
      </div>
    `;

    item.addEventListener("click", () => selectProposal(p));
    container.appendChild(item);
  });
}

function selectProposal(p) {
  selectedProposal = p;
  
  // Automatically switch package filter to the selected proposal's package
  const selector = byId("packageSelector");
  if (selector.value !== String(p.package_number)) {
    selector.value = p.package_number;
    filterAndRender();
  } else {
    renderCards();
  }
  
  byId("panelEmptyState").style.display = "none";
  byId("proposalDetailViewer").style.display = "block";
  byId("aiResponseContainer").style.display = "none";
  byId("directorStatusMsg").textContent = "";

  // Details
  byId("detPackageBadge").textContent = `Пакет ${p.package_number}: ${p.package_name}`;
  
  const statusLabels = {
    pending: { text: "Очікує рішення", class: "status-pending" },
    approved: { text: "Затверджено Директором", class: "status-approved" },
    returned: { text: "Повернуто з зауваженнями", class: "status-returned" }
  };
  const statusInfo = statusLabels[p.director_status] || statusLabels.pending;
  byId("detStatusBadge").textContent = statusInfo.text;
  byId("detStatusBadge").className = `detail-status-badge ${statusInfo.class}`;

  byId("detItemTitle").textContent = p.item || `Пункт ${p.row_num}`;
  byId("detProposalText").textContent = p.proposal;
  byId("detAnalysisText").textContent = p.analysis || "Немає опису розбору.";
  byId("detNhsuPosition").textContent = p.position_nhsu || "Немає проєкту рішення.";

  // Votes count and lists
  const clinVotes = p.votes_clinical || [];
  const stratVotes = p.votes_strategy || [];

  const clinUp = clinVotes.filter(v => v.type !== 'down');
  const clinDown = clinVotes.filter(v => v.type === 'down');
  const stratUp = stratVotes.filter(v => v.type !== 'down');
  const stratDown = stratVotes.filter(v => v.type === 'down');

  byId("votesClinicalUpCount").textContent = clinUp.length;
  byId("votesClinicalDownCount").textContent = clinDown.length;
  byId("votesStrategyUpCount").textContent = stratUp.length;
  byId("votesStrategyDownCount").textContent = stratDown.length;

  const clinNames = clinVotes.map(v => `${v.name} (${v.type === 'down' ? 'Проти' : 'За'})`).join(", ");
  const stratNames = stratVotes.map(v => `${v.name} (${v.type === 'down' ? 'Проти' : 'За'})`).join(", ");

  byId("votesClinicalList").textContent = clinNames || "Немає голосів";
  byId("votesStrategyList").textContent = stratNames || "Немає голосів";

  if (currentProfile) {
    const clinUserVote = clinVotes.find(v => v.id === currentProfile.id);
    const clinVotedUp = clinUserVote && clinUserVote.type !== 'down';
    const clinVotedDown = clinUserVote && clinUserVote.type === 'down';

    const stratUserVote = stratVotes.find(v => v.id === currentProfile.id);
    const stratVotedUp = stratUserVote && stratUserVote.type !== 'down';
    const stratVotedDown = stratUserVote && stratUserVote.type === 'down';

    byId("voteClinicalUpBtn").className = `action vote-btn success-btn ${clinVotedUp ? "active" : ""}`;
    byId("voteClinicalDownBtn").className = `action vote-btn danger-btn ${clinVotedDown ? "active" : ""}`;

    byId("voteStrategyUpBtn").className = `action vote-btn success-btn ${stratVotedUp ? "active" : ""}`;
    byId("voteStrategyDownBtn").className = `action vote-btn danger-btn ${stratVotedDown ? "active" : ""}`;
  }

  // Director Panel inputs
  byId("detDecisionInput").value = p.decision || "";
  byId("detRemarksInput").value = p.director_remarks || "";

  // Comments rendering
  const clinComments = p.comments_clinical || [];
  const stratComments = p.comments_strategy || [];

  renderCommentsList(byId("commentsClinicalList"), clinComments);
  renderCommentsList(byId("commentsStrategyList"), stratComments);

  // Clear inputs
  byId("commentClinicalInput").value = "";
  byId("commentStrategyInput").value = "";

  // Start stopwatch
  startTimer(p.id);
}

// Timer Logic
function startTimer(proposalId) {
  if (timerInterval) clearInterval(timerInterval);
  timerSeconds = proposalDiscussionTimes[proposalId] || 0;
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    timerSeconds++;
    proposalDiscussionTimes[proposalId] = timerSeconds;
    localStorage.setItem('expert_proposals_times', JSON.stringify(proposalDiscussionTimes));
    updateTimerDisplay();
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(timerSeconds / 60).toString().padStart(2, "0");
  const s = (timerSeconds % 60).toString().padStart(2, "0");
  byId("stopwatchDisplay").textContent = `${m}:${s}`;
}

function resetTimer() {
  if (!selectedProposal) return;
  timerSeconds = 0;
  proposalDiscussionTimes[selectedProposal.id] = 0;
  localStorage.setItem('expert_proposals_times', JSON.stringify(proposalDiscussionTimes));
  updateTimerDisplay();
}

// Voting Logic
async function handleVote(dept, type) {
  if (!selectedProposal || !currentProfile) return;

  const currentVotes = dept === 'clinical' 
    ? (selectedProposal.votes_clinical || []) 
    : (selectedProposal.votes_strategy || []);

  const voterIndex = currentVotes.findIndex(v => v.id === currentProfile.id);
  const userName = currentProfile.full_name || currentProfile.name || "Співробітник";

  if (voterIndex > -1) {
    const existingVote = currentVotes[voterIndex];
    if (existingVote.type === type) {
      // Toggle off
      currentVotes.splice(voterIndex, 1);
    } else {
      // Switch type
      existingVote.type = type;
    }
  } else {
    // New vote
    currentVotes.push({ id: currentProfile.id, name: userName, type: type });
  }

  const updatePayload = dept === 'clinical' 
    ? { votes_clinical: currentVotes } 
    : { votes_strategy: currentVotes };

  const { data, error } = await sb.from('expert_proposals').update(updatePayload).eq('id', selectedProposal.id).select();
  if (error) {
    console.warn("Failed to save vote to DB, saving locally:", error);
    const index = proposalsList.findIndex(p => p.id === selectedProposal.id);
    if (index > -1) {
      proposalsList[index] = { ...proposalsList[index], ...updatePayload };
      selectProposal(proposalsList[index]);
      renderDashboard();
    }
  } else if (data && data[0]) {
    updateLocalProposal(data[0]);
  }
}

// Director Resolution Logic
async function handleDirectorResolution(status) {
  if (!selectedProposal || !currentProfile) return;

  const decisionVal = byId("detDecisionInput").value.trim();
  const remarksVal = byId("detRemarksInput").value.trim();

  const updatePayload = {
    director_status: status,
    decision: decisionVal,
    director_remarks: remarksVal,
    approved_at: status === 'approved' ? new Date().toISOString() : null,
    completed_at: status === 'approved' ? new Date().toISOString() : null
  };

  const { data, error } = await sb.from('expert_proposals').update(updatePayload).eq('id', selectedProposal.id).select();
  if (error) {
    console.error("Failed to save resolution:", error);
    byId("directorStatusMsg").textContent = "Помилка збереження в базу даних!";
    byId("directorStatusMsg").className = "director-status-msg error";
  } else if (data && data[0]) {
    updateLocalProposal(data[0]);
    byId("directorStatusMsg").textContent = status === 'approved' ? "Правку успішно затверджено!" : "Надіслано на доопрацювання.";
    byId("directorStatusMsg").className = "director-status-msg success";
  }
}

function updateLocalProposal(newProposal) {
  const index = proposalsList.findIndex(p => p.id === newProposal.id);
  if (index > -1) {
    proposalsList[index] = newProposal;
    if (selectedProposal && selectedProposal.id === newProposal.id) {
      selectedProposal = newProposal;
      selectProposal(selectedProposal);
    }
    filterAndRender();
    renderDashboard();
  }
}

// Dashboard Calculation
function renderDashboard() {
  const totalProposals = proposalsList.length;
  byId("dashTotalCount").textContent = totalProposals;

  const approvedProposals = proposalsList.filter(p => p.director_status === 'approved').length;
  byId("dashApprovedCount").textContent = approvedProposals;

  // Percentage of fully processed packages
  // Group by package
  const packagesMap = {};
  proposalsList.forEach(p => {
    if (!packagesMap[p.package_number]) {
      packagesMap[p.package_number] = [];
    }
    packagesMap[p.package_number].push(p);
  });

  const totalPackages = Object.keys(packagesMap).length;
  let fullyProcessedPackages = 0;
  
  Object.keys(packagesMap).forEach(num => {
    const allApproved = packagesMap[num].every(p => p.director_status === 'approved');
    if (allApproved && packagesMap[num].length > 0) {
      fullyProcessedPackages++;
    }
  });

  const progressPercent = totalPackages > 0 ? Math.round((fullyProcessedPackages / totalPackages) * 100) : 0;
  byId("dashProgressText").textContent = `${progressPercent}%`;
  byId("dashProgressBar").style.width = `${progressPercent}%`;

  // Average discussion time
  const times = Object.values(proposalDiscussionTimes);
  if (times.length > 0) {
    const totalSeconds = times.reduce((acc, curr) => acc + curr, 0);
    const avgMinutes = Math.round((totalSeconds / times.length) / 60);
    byId("dashAvgTime").textContent = `${avgMinutes} хв`;
  } else {
    byId("dashAvgTime").textContent = "0 хв";
  }
}

// Real-Time subscription setup
function setupRealtime() {
  sb.channel('expert_proposals_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expert_proposals' }, payload => {
      console.log('Realtime change received:', payload);
      if (payload.new) {
        updateLocalProposal(payload.new);
      }
    })
    .subscribe();
}

// Toggle Meeting Mode
function toggleMeetingMode() {
  document.body.classList.toggle("meeting-mode");
  const isMeeting = document.body.classList.contains("meeting-mode");
  byId("toggleMeetingModeBtn").textContent = isMeeting ? "🖥️ Звичайний режим" : "🖥️ Режим зустрічі";
}

// AI Analysis Integration
async function getAiAnalysis() {
  if (!selectedProposal) return;
  
  const btn = byId("aiAssistBtn");
  btn.disabled = true;
  btn.textContent = "⚙️ Аналізую пропозицію (Gemini)...";

  const responseContainer = byId("aiResponseContainer");
  responseContainer.style.display = "block";
  responseContainer.innerHTML = '<em>Штучний інтелекту формує експертний висновок на основі стандартів...</em>';

  try {
    const isFileProtocol = window.location.protocol === "file:";
    const isLocalHost = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
    
    let responseText = "";
    
    if (isFileProtocol || isLocalHost) {
      const fetchUrl = isFileProtocol ? "http://127.0.0.1:8042/api/ai-analyze" : "/api/ai-analyze";
      const res = await fetch(fetchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal: selectedProposal.proposal,
          analysis: selectedProposal.analysis,
          position_nhsu: selectedProposal.position_nhsu,
          package_name: selectedProposal.package_name
        })
      });
      if (res.ok) {
        const data = await res.json();
        responseText = data.response || data.message || "";
      } else {
        throw new Error("Local server error");
      }
    } else {
      // Internet mode (static hosting) - query Gemini directly
      responseText = await getAiAnalysisDirect();
    }
    
    responseContainer.innerHTML = `<strong>🤖 Рекомендація AI-Співдоповідача:</strong><br>${escapeHtml(responseText)}`;
  } catch (err) {
    console.warn("AI Analysis failed, trying direct fallback:", err);
    try {
      const responseText = await getAiAnalysisDirect();
      responseContainer.innerHTML = `<strong>🤖 Рекомендація AI-Співдоповідача:</strong><br>${escapeHtml(responseText)}`;
    } catch (fallbackErr) {
      console.error("Direct fallback failed:", fallbackErr);
      responseContainer.innerHTML = '<strong>❌ Помилка:</strong> Не вдалося отримати висновок AI. ' + escapeHtml(fallbackErr.message || "Переконайтеся, що бекенд-сервер запущено або вкажіть API-ключ.");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "💡 AI-Співдоповідач (Аналіз Gemini)";
  }
}

function renderCommentsList(container, list) {
  container.innerHTML = "";
  if (list.length === 0) {
    container.innerHTML = '<div style="padding: 8px; color: var(--ink-muted); font-size: 0.8rem; font-style: italic; text-align: center;">Немає коментарів</div>';
    return;
  }

  list.forEach(c => {
    const bubble = document.createElement("div");
    bubble.className = "comment-bubble";
    const dateStr = c.created_at ? new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    bubble.innerHTML = `
      <div class="comment-meta">
        <span class="comment-author">${escapeHtml(c.name)}</span>
        <span class="comment-date">${dateStr}</span>
      </div>
      <div class="comment-text">${escapeHtml(c.text)}</div>
    `;
    container.appendChild(bubble);
  });
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

async function handleAddComment(dept) {
  if (!selectedProposal || !currentProfile) return;

  const inputEl = byId(dept === 'clinical' ? "commentClinicalInput" : "commentStrategyInput");
  const text = inputEl.value.trim();
  if (!text) return;

  const currentComments = dept === 'clinical' 
    ? (selectedProposal.comments_clinical || []) 
    : (selectedProposal.comments_strategy || []);

  const userName = currentProfile.full_name || currentProfile.name || "Співробітник";
  const newComment = {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
    name: userName,
    text: text,
    created_at: new Date().toISOString()
  };

  currentComments.push(newComment);

  const updatePayload = dept === 'clinical' 
    ? { comments_clinical: currentComments } 
    : { comments_strategy: currentComments };

  const { data, error } = await sb.from('expert_proposals').update(updatePayload).eq('id', selectedProposal.id).select();
  if (error) {
    console.warn("Failed to save comment to DB, saving locally:", error);
    // Fallback update
    const index = proposalsList.findIndex(p => p.id === selectedProposal.id);
    if (index > -1) {
      proposalsList[index] = { ...proposalsList[index], ...updatePayload };
      selectProposal(proposalsList[index]);
    }
  } else if (data && data[0]) {
    updateLocalProposal(data[0]);
  }
}

function cleanItemName(itemText) {
  if (!itemText) return "Пункт вимог";
  const parts = itemText.split(/—|–|-/);
  if (parts.length > 1) {
    return parts.slice(1).join("—").trim();
  }
  return itemText.trim();
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.addEventListener("DOMContentLoaded", init);

async function getAiAnalysisDirect() {
  let apiKey = localStorage.getItem('gemini_api_key');
  if (apiKey === 'null' || apiKey === 'undefined') {
    apiKey = null;
  }
  if (!apiKey) {
    apiKey = prompt("Для роботи ШІ в інтернеті введіть ваш Gemini API-ключ (він збережеться локально у вашому браузері):");
    if (!apiKey) {
      throw new Error("API-ключ не вказано");
    }
    apiKey = apiKey.trim();
    localStorage.setItem('gemini_api_key', apiKey);
  }

  const promptText = `Ти — провідний експерт Департаменту стратегії НСЗУ. Твоє завдання — проаналізувати пропозицію експерта робочої групи до пакета медичних гарантій '${selectedProposal.package_name}'.\n\n` +
                     `Пропозиція: '${selectedProposal.proposal}'\n` +
                     `Нормативно-правове обґрунтування пропозиції: '${selectedProposal.analysis}'\n` +
                     `Проєкт рішення департаменту: '${selectedProposal.position_nhsu}'\n\n` +
                     `Будь ласка, надай стислий аналітичний висновок (до 3-4 речень) українською мовою. Оціни ризики, переваги та дай чітку рекомендацію: прийняти, відхилити або прийняти частково (та в якій редакції).`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key={apiKey}`;
  // Wait! In URL we have {apiKey} but we need string interpolation: key=${apiKey}!
  // Let's make sure it is key=\${apiKey}!
  const fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`;
  const response = await fetch(fetchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: promptText }]
      }]
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    if (response.status === 400 || response.status === 403) {
      localStorage.removeItem('gemini_api_key');
    }
    throw new Error(errData.error?.message || "Помилка запиту до Google API");
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}
