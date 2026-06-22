import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentProfile = null;
let allProfiles = [];
let events = [];
let viewMode = 'grid'; // 'grid' | 'table'

// Hybrid DB Provider
const DB = {
  async getEvents() {
    try {
      const { data, error } = await sb.from('reporting_events').select('*').order('deadline_date', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn("Using LocalStorage fallback for events:", e.message);
      const local = localStorage.getItem('reporting_events');
      return local ? JSON.parse(local) : [];
    }
  },
  async saveEvent(event) {
    try {
      // Normalize object for database (ensure notified_tiers is an array)
      const payload = { ...event };
      if (!payload.id) {
        delete payload.id;
      }
      
      const { data, error } = await sb.from('reporting_events').upsert(payload).select();
      if (error) throw error;
      return data[0];
    } catch (e) {
      console.warn("Saving to LocalStorage fallback:", e.message);
      const local = localStorage.getItem('reporting_events');
      let eventsList = local ? JSON.parse(local) : [];
      
      if (event.id) {
        event.updated_at = new Date().toISOString();
        eventsList = eventsList.map(ev => ev.id === event.id ? event : ev);
      } else {
        event.id = crypto.randomUUID();
        event.created_at = new Date().toISOString();
        event.updated_at = new Date().toISOString();
        eventsList.push(event);
      }
      localStorage.setItem('reporting_events', JSON.stringify(eventsList));
      return event;
    }
  },
  async deleteEvent(id) {
    try {
      const { error } = await sb.from('reporting_events').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.warn("Deleting from LocalStorage fallback:", e.message);
      const local = localStorage.getItem('reporting_events');
      if (local) {
        let eventsList = JSON.parse(local);
        eventsList = eventsList.filter(ev => ev.id !== id);
        localStorage.setItem('reporting_events', JSON.stringify(eventsList));
      }
    }
  }
};

// --- Utilities ---

// Calculate business days between two dates (excluding weekends)
function getBusinessDaysCount(startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  
  if (start > end) return -getBusinessDaysCount(end, start);
  if (start.getTime() === end.getTime()) return 0;
  
  let count = 0;
  const current = new Date(start);
  
  while (current < end) {
    current.setDate(current.getDate() + 1);
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0 = Sunday, 6 = Saturday
      count++;
    }
  }
  return count;
}

// Add business days to a date
function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) {
      added++;
    }
  }
  return result;
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalDate(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function getInitials(name) {
  if (!name) return "СП";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// Generate default events relative to today's date
function generateDefaultEvents() {
  const today = new Date();
  
  return [
    {
      title: "Звіт про виконання договорів про медичне обслуговування за ПМГ",
      due_date_description: "щомісяця до 10-го числа",
      deadline_date: formatDateISO(addBusinessDays(today, 15)),
      executor_id: currentUser ? currentUser.id : null,
      executor_name: currentProfile ? currentProfile.full_name : "Дудник Світлана",
      regulatory_basis: "Постанова КМУ № 410, Постанова КМУ № 1808",
      status: "Чернетка",
      notified_tiers: []
    },
    {
      title: "Фінансовий звіт за формою № 1-НСЗУ",
      due_date_description: "щокварталу до 15-го числа",
      deadline_date: formatDateISO(addBusinessDays(today, 5)),
      executor_id: currentUser ? currentUser.id : null,
      executor_name: currentProfile ? currentProfile.full_name : "Волошина Альбіна",
      regulatory_basis: "Наказ НСЗУ від 29.12.2023 № 431",
      status: "Чернетка",
      notified_tiers: []
    },
    {
      title: "Моніторинговий звіт з дотримання умов закупівлі медичних послуг",
      due_date_description: "щомісяця до 20-го числа",
      deadline_date: formatDateISO(addBusinessDays(today, 2)),
      executor_id: currentUser ? currentUser.id : null,
      executor_name: currentProfile ? currentProfile.full_name : "Дудник Світлана",
      regulatory_basis: "Постанова КМУ від 25.12.2020 № 1377",
      status: "Чернетка",
      notified_tiers: []
    },
    {
      title: "Звіт про використання залишків коштів за ПМГ",
      due_date_description: "щомісяця до 5-го числа",
      deadline_date: formatDateISO(today),
      executor_id: currentUser ? currentUser.id : null,
      executor_name: currentProfile ? currentProfile.full_name : "Волошина Альбіна",
      regulatory_basis: "Розпорядження КМУ від 12.01.2026 № 14-р",
      status: "Чернетка",
      notified_tiers: []
    },
    {
      title: "Річний звіт про результати реалізації Програми медичних гарантій",
      due_date_description: "щорічно до 1 березня",
      deadline_date: "2027-03-01",
      executor_id: null,
      executor_name: "Волошина Альбіна",
      regulatory_basis: "Закон України 'Про державні фінансові гарантії'",
      status: "Чернетка",
      notified_tiers: []
    }
  ];
}

// Warning Tier logic
function getWarningTier(deadlineDateStr, status) {
  if (status === 'Надіслано') return null;
  
  const today = new Date();
  const deadline = new Date(deadlineDateStr);
  
  const businessDaysLeft = getBusinessDaysCount(today, deadline);
  
  if (businessDaysLeft < 0) {
    return 'overdue';
  }
  
  if (businessDaysLeft === 0) {
    const currentHour = today.getHours();
    if (currentHour >= 9) {
      return '0'; // Critical warning
    }
    return '0-pending';
  }
  
  if (businessDaysLeft === 2) {
    return '2';
  }
  
  if (businessDaysLeft === 5) {
    return '5';
  }
  
  if (businessDaysLeft === 15) {
    return '15';
  }
  
  return null;
}

// Play notification warning audio Context sound
function playAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Wave 1
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    
    // Wave 2
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain2.gain.setValueAtTime(0.08, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.25);
    }, 100);
  } catch (e) {
    console.error("Audio warning error:", e);
  }
}

// Show browser notification
function showDesktopNotification(title, text) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, {
      body: text,
      icon: "../assets/nszu-shield.svg"
    });
  }
}

// Trigger simulated/SMTP email sending via backend Simple HTTP endpoint
async function sendReminderEmail(event, tier) {
  const email = currentProfile?.email || currentUser?.email || "executor@nszu.gov.ua";
  const executorName = event.executor_name || "Співробітник";
  
  try {
    const response = await fetch('/api/send-reminder-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event_id: event.id,
        email: email,
        executor_name: executorName,
        title: event.title,
        deadline: event.deadline_date,
        tier: tier,
        regulatory_basis: event.regulatory_basis
      })
    });
    
    const result = await response.json();
    console.log("Email request response:", result);
  } catch (err) {
    console.error("Failed to make send-email request:", err);
  }
}

// Check deadline warnings for the current user and update database status
async function processRemindersAutomation() {
  let hasChanges = false;
  
  for (let event of events) {
    const tier = getWarningTier(event.deadline_date, event.status);
    
    // 1. Auto Overdue update
    if (tier === 'overdue' && event.status !== 'Прострочено') {
      event.status = 'Прострочено';
      await DB.saveEvent(event);
      hasChanges = true;
      continue;
    }
    
    // 2. Automated notifications check (only trigger for user's assigned events)
    const isAssignedToMe = currentUser && event.executor_id === currentUser.id;
    if (isAssignedToMe && tier && ['15', '5', '2', '0'].includes(tier)) {
      if (!event.notified_tiers) {
        event.notified_tiers = [];
      }
      
      if (!event.notified_tiers.includes(tier)) {
        event.notified_tiers.push(tier);
        await DB.saveEvent(event);
        hasChanges = true;
        
        // Trigger alert visual warnings & sound
        playAlertSound();
        
        const tierLabels = {
          '15': 'Первинне попередження (15 роб. днів)',
          '5': 'Повторне попередження (5 роб. днів)',
          '2': 'Повторне попередження (2 роб. дні)',
          '0': 'ДЕДЛАЙН звітування!'
        };
        const title = `🚨 Нагадування: ${tierLabels[tier]}`;
        const text = `Граничний термін звіту "${event.title}" наближається (${event.deadline_date}).`;
        
        showDesktopNotification(title, text);
        
        // Send email and log it
        await sendReminderEmail(event, tier);
      }
    }
  }
  
  if (hasChanges) {
    // Reload events from DB to stay synchronized
    events = await DB.getEvents();
  }
}

// --- UI Rendering ---

function updateStatsSummary() {
  const totalEl = document.getElementById('stat-total-events');
  const deadlineEl = document.getElementById('stat-deadline-today');
  const warningEl = document.getElementById('stat-warning-events');
  const sentEl = document.getElementById('stat-sent-events');
  
  if (!totalEl) return;
  
  let total = events.length;
  let deadlineCount = 0;
  let warningCount = 0;
  let sentCount = 0;
  
  const today = new Date();
  
  events.forEach(ev => {
    if (ev.status === 'Надіслано') {
      sentCount++;
    } else {
      const deadline = new Date(ev.deadline_date);
      const businessDays = getBusinessDaysCount(today, deadline);
      
      if (businessDays === 0) {
        deadlineCount++;
      } else if (businessDays > 0 && businessDays <= 5) {
        warningCount++;
      } else if (businessDays < 0) {
        warningCount++; // Overdue counts as warning
      }
    }
  });
  
  totalEl.textContent = total;
  deadlineEl.textContent = deadlineCount;
  warningEl.textContent = warningCount;
  sentEl.textContent = sentCount;
}

function renderEvents() {
  const gridContainer = document.getElementById('events-grid-container');
  const tableBody = document.getElementById('events-table-body');
  
  if (!gridContainer || !tableBody) return;
  
  // Filter search and controls
  const searchVal = document.getElementById('filter-search')?.value.toLowerCase().trim() || "";
  const execVal = document.getElementById('filter-executor')?.value || "all";
  const statusVal = document.getElementById('filter-status')?.value || "all";
  
  const filteredEvents = events.filter(ev => {
    const matchesSearch = ev.title.toLowerCase().includes(searchVal) || 
                          (ev.regulatory_basis && ev.regulatory_basis.toLowerCase().includes(searchVal));
    const matchesExec = execVal === 'all' || ev.executor_id === execVal || (execVal === 'unassigned' && !ev.executor_id);
    const matchesStatus = statusVal === 'all' || ev.status === statusVal;
    return matchesSearch && matchesExec && matchesStatus;
  });
  
  // Clear containers
  gridContainer.innerHTML = "";
  tableBody.innerHTML = "";
  
  if (filteredEvents.length === 0) {
    const emptyHtml = `<div class="no-events">Не знайдено жодної події для обраних фільтрів.</div>`;
    gridContainer.innerHTML = emptyHtml;
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;">Не знайдено жодної події</td></tr>`;
    return;
  }
  
  const today = new Date();
  
  filteredEvents.forEach(ev => {
    const deadline = new Date(ev.deadline_date);
    const businessDays = getBusinessDaysCount(today, deadline);
    
    // Status Badge classes
    let statusClass = 'status-draft';
    if (ev.status === 'Надіслано') statusClass = 'status-sent';
    else if (ev.status === 'Прострочено') statusClass = 'status-overdue';
    
    // Days Left Tag classes
    let daysTagClass = 'safe';
    let daysTagText = `Залишилось: ${businessDays} роб. дн.`;
    let cardAlertClass = '';
    
    if (ev.status !== 'Надіслано') {
      if (businessDays < 0) {
        daysTagClass = 'deadline';
        daysTagText = `Прострочено на ${Math.abs(businessDays)} дн.`;
        cardAlertClass = 'alert-deadline';
      } else if (businessDays === 0) {
        daysTagClass = 'deadline';
        daysTagText = 'ДЕДЛАЙН СЬОГОДНІ!';
        cardAlertClass = 'alert-deadline';
      } else if (businessDays <= 2) {
        daysTagClass = 'urgent';
        daysTagText = `Гранично: ${businessDays} дн.`;
        cardAlertClass = 'alert-urgent';
      } else if (businessDays <= 5) {
        daysTagClass = 'urgent';
        daysTagText = `Терміново: ${businessDays} дн.`;
        cardAlertClass = 'alert-urgent';
      } else if (businessDays <= 15) {
        daysTagClass = 'warning-15';
        daysTagText = `${businessDays} роб. дн.`;
      }
    } else {
      daysTagText = 'Виконано';
    }
    
    // Check if user has permission to edit (any role except guest)
    const canEdit = currentProfile && currentProfile.role !== 'guest';
    const isMyEvent = currentUser && ev.executor_id === currentUser.id;
    
    // Actions HTML
    let actionsHtml = '';
    if (ev.status !== 'Надіслано') {
      actionsHtml += `<button class="action-btn btn-mark-sent" data-id="${ev.id}">✅ Надіслати</button>`;
    } else {
      actionsHtml += `<button class="action-btn btn-rollover" data-id="${ev.id}">🔁 Наст. період</button>`;
    }
    
    if (canEdit) {
      actionsHtml += `
        <button class="action-btn btn-edit-event" data-id="${ev.id}" title="Редагувати">✏️</button>
        <button class="action-btn btn-delete-event" data-id="${ev.id}" title="Видалити">🗑️</button>
      `;
    }
    
    const initials = getInitials(ev.executor_name);
    
    // 1. Render Card
    const card = document.createElement('div');
    card.className = `event-card ${cardAlertClass}`;
    card.innerHTML = `
      <div class="card-header-row">
        <span class="status-badge ${statusClass}">${ev.status}</span>
        <span class="days-left-tag ${daysTagClass}">${daysTagText}</span>
      </div>
      <h3 title="${ev.title}">${ev.title}</h3>
      <div class="event-details">
        <div class="detail-item">
          <span class="detail-icon">📅</span>
          <span><strong>Термін:</strong> ${ev.due_date_description}</span>
        </div>
        <div class="detail-item">
          <span class="detail-icon">⏱️</span>
          <span><strong>Гранична дата:</strong> ${formatLocalDate(ev.deadline_date)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-icon">⚖️</span>
          <span><strong>Підстава:</strong> ${ev.regulatory_basis ? `<span class="regulatory-basis-link" title="${ev.regulatory_basis}">${ev.regulatory_basis}</span>` : '<span style="font-style:italic;color:var(--p-faint);">не вказано</span>'}</span>
        </div>
      </div>
      <div class="card-executor">
        <div class="executor-avatar">${initials}</div>
        <div class="executor-info">
          <span class="executor-name">${ev.executor_name || 'Не призначено'}</span>
          <span class="executor-title">Виконавець</span>
        </div>
      </div>
      <div class="card-actions">
        ${actionsHtml}
      </div>
    `;
    gridContainer.appendChild(card);
    
    // 2. Render Table Row
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${ev.title}</strong></td>
      <td>${ev.due_date_description}</td>
      <td>${formatLocalDate(ev.deadline_date)}</td>
      <td><span class="days-left-tag ${daysTagClass}" style="display:inline-block;">${daysTagText}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="executor-avatar" style="width:24px;height:24px;font-size:10px;">${initials}</div>
          <span>${ev.executor_name || 'Не призначено'}</span>
        </div>
      </td>
      <td>${ev.regulatory_basis || '-'}</td>
      <td><span class="status-badge ${statusClass}">${ev.status}</span></td>
      <td>
        <div style="display:flex;gap:4px;">
          ${actionsHtml}
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  });
  
  // Attach event listeners to card actions
  attachActionListeners();
}

function attachActionListeners() {
  document.querySelectorAll('.btn-mark-sent').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      const event = events.find(ev => ev.id === id);
      if (event) {
        event.status = 'Надіслано';
        await DB.saveEvent(event);
        events = await DB.getEvents();
        renderEvents();
        updateStatsSummary();
        
        // Show Rollover modal immediately to plan the next period
        showRolloverModal(id);
      }
    });
  });

  document.querySelectorAll('.btn-rollover').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.dataset.id;
      showRolloverModal(id);
    });
  });

  document.querySelectorAll('.btn-edit-event').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      const event = events.find(ev => ev.id === id);
      if (event) {
        openEventModal(event);
      }
    });
  });

  document.querySelectorAll('.btn-delete-event').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      if (confirm("Ви дійсно хочете видалити це нагадування?")) {
        await DB.deleteEvent(id);
        events = await DB.getEvents();
        renderEvents();
        updateStatsSummary();
      }
    });
  });
}

// --- Rollover Modal ---

function showRolloverModal(eventId) {
  const modal = document.getElementById('rollover-modal');
  const idField = document.getElementById('rollover-event-id');
  const dateField = document.getElementById('rollover-next-date');
  
  if (!modal || !idField || !dateField) return;
  
  idField.value = eventId;
  
  // Auto-calculate next deadline date (e.g. +30 calendar days for monthly)
  const event = events.find(ev => ev.id === eventId);
  if (event) {
    const currentDeadline = new Date(event.deadline_date);
    currentDeadline.setDate(currentDeadline.getDate() + 30);
    dateField.value = formatDateISO(currentDeadline);
  } else {
    dateField.value = "";
  }
  
  modal.style.display = 'flex';
}

function closeRolloverModal() {
  const modal = document.getElementById('rollover-modal');
  if (modal) modal.style.display = 'none';
}

// --- Add/Edit Event Modal ---

async function loadProfilesForSelect() {
  const selects = [document.getElementById('event-executor')];
  
  try {
    const { data, error } = await sb.from('profiles').select('id, full_name, role').neq('role', 'guest');
    if (!error && data) {
      allProfiles = data;
    }
  } catch (err) {
    console.warn("Failed to load profiles from Supabase, using mock profiles:", err);
    allProfiles = [
      { id: '1', full_name: 'Дудник Світлана' },
      { id: '2', full_name: 'Волошина Альбіна' }
    ];
  }
  
  selects.forEach(select => {
    if (!select) return;
    
    // Save first option
    const firstOpt = select.options[0];
    select.innerHTML = "";
    select.appendChild(firstOpt);
    
    allProfiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.full_name;
      select.appendChild(opt);
    });
  });
}

function openEventModal(event = null) {
  const modal = document.getElementById('event-modal');
  const form = document.getElementById('event-form');
  const modalTitle = document.getElementById('event-modal-title');
  const errorEl = document.getElementById('event-form-error');
  
  if (!modal || !form || !modalTitle) return;
  
  errorEl.textContent = "";
  form.reset();
  
  if (event) {
    modalTitle.textContent = "Редагувати подію нагадування";
    document.getElementById('event-id-field').value = event.id;
    document.getElementById('event-title').value = event.title;
    document.getElementById('event-due-desc').value = event.due_date_description;
    document.getElementById('event-deadline-date').value = event.deadline_date;
    document.getElementById('event-executor').value = event.executor_id || "";
    document.getElementById('event-basis').value = event.regulatory_basis || "";
    document.getElementById('event-status').value = event.status;
  } else {
    modalTitle.textContent = "Додати подію нагадування";
    document.getElementById('event-id-field').value = "";
    document.getElementById('event-status').value = "Чернетка";
    
    // Pre-fill tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('event-deadline-date').value = formatDateISO(tomorrow);
  }
  
  modal.style.display = 'flex';
}

function closeEventModal() {
  const modal = document.getElementById('event-modal');
  if (modal) modal.style.display = 'none';
}

// --- Email Logs Render ---

async function loadEmailLogs() {
  const container = document.getElementById('email-logs-list');
  if (!container) return;
  
  try {
    const res = await fetch('../data/reminder_emails_log.json', { cache: 'no-store' });
    if (!res.ok) throw new Error("File not found");
    const logs = await res.json();
    
    if (!logs || logs.length === 0) {
      container.innerHTML = `<div class="no-logs">Логи відправлених сповіщень поки порожні.</div>`;
      return;
    }
    
    container.innerHTML = logs.map(log => {
      const sentTime = new Date(log.sent_at).toLocaleString("uk-UA");
      return `
        <div class="email-log-item">
          <div class="email-log-meta">
            <span>📅 ${sentTime}</span>
            <span>Рівень: <strong>${log.tier_label}</strong></span>
          </div>
          <div class="email-log-subject">📧 Тема: ${log.subject}</div>
          <div style="font-size:12px;color:var(--p-muted);margin-bottom:6px;">
            Кому: <span class="email-log-recipient">${log.executor_name} (${log.email})</span>
          </div>
          <button class="view-btn" style="padding: 2px 8px; font-size:11px;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">Переглянути тіло листа</button>
          <div class="email-log-body" style="display: none;">${log.body}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="no-logs">Логи відсутні (сповіщення ще не надсилалися).</div>`;
  }
}

// --- Initialization ---

async function init() {
  // 1. Auth check
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;
  
  if (currentUser) {
    try {
      const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
      currentProfile = data;
    } catch(e) {}
  }
  
  // Guard role
  if (!currentProfile || currentProfile.role === 'guest') {
    const overlay = document.getElementById('access-denied-overlay');
    if (overlay) overlay.style.display = 'flex';
    return;
  }
  
  // Show Add Event button if permitted
  const addBtn = document.getElementById('add-event-btn');
  if (addBtn) addBtn.style.display = 'block';

  // 2. Load profiles
  await loadProfilesForSelect();
  
  // 3. Load events
  events = await DB.getEvents();
  
  // If empty, generate defaults
  if (events.length === 0) {
    const defaults = generateDefaultEvents();
    for (const ev of defaults) {
      await DB.saveEvent(ev);
    }
    events = await DB.getEvents();
  }
  
  // 4. Run automated warnings notifications and check status
  await processRemindersAutomation();
  
  // 5. Initial Render
  renderEvents();
  updateStatsSummary();
  loadEmailLogs();
  
  // --- Event Listeners Setup ---
  
  // View switches
  document.getElementById('view-grid-btn')?.addEventListener('click', (e) => {
    document.getElementById('view-grid-btn').classList.add('active');
    document.getElementById('view-table-btn').classList.remove('active');
    document.getElementById('events-grid-container').style.display = 'grid';
    document.getElementById('events-table-container').style.display = 'none';
    viewMode = 'grid';
  });
  
  document.getElementById('view-table-btn')?.addEventListener('click', (e) => {
    document.getElementById('view-table-btn').classList.add('active');
    document.getElementById('view-grid-btn').classList.remove('active');
    document.getElementById('events-grid-container').style.display = 'none';
    document.getElementById('events-table-container').style.display = 'block';
    viewMode = 'table';
  });
  
  // Search & Filter controls
  document.getElementById('filter-search')?.addEventListener('input', renderEvents);
  document.getElementById('filter-executor')?.addEventListener('change', renderEvents);
  document.getElementById('filter-status')?.addEventListener('change', renderEvents);
  
  // Add Event trigger
  document.getElementById('add-event-btn')?.addEventListener('click', () => openEventModal(null));
  document.getElementById('event-modal-close')?.addEventListener('click', closeEventModal);
  document.getElementById('event-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'event-modal') closeEventModal();
  });
  
  // Rollover triggers
  document.getElementById('rollover-modal-close')?.addEventListener('click', closeRolloverModal);
  document.getElementById('rollover-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'rollover-modal') closeRolloverModal();
  });
  
  // Refresh Logs trigger
  document.getElementById('refresh-email-logs-btn')?.addEventListener('click', loadEmailLogs);
  
  // Event Form Submit
  document.getElementById('event-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('event-id-field').value;
    const title = document.getElementById('event-title').value.trim();
    const dueDesc = document.getElementById('event-due-desc').value.trim();
    const deadlineDate = document.getElementById('event-deadline-date').value;
    const execId = document.getElementById('event-executor').value;
    const basis = document.getElementById('event-basis').value.trim();
    const status = document.getElementById('event-status').value;
    
    const errorEl = document.getElementById('event-form-error');
    
    if (!title || !dueDesc || !deadlineDate || !execId) {
      errorEl.textContent = "Будь ласка, заповніть усі обов'язкові поля (*)";
      return;
    }
    
    const executorProfile = allProfiles.find(p => p.id === execId);
    
    const eventData = {
      title: title,
      due_date_description: dueDesc,
      deadline_date: deadlineDate,
      executor_id: execId,
      executor_name: executorProfile ? executorProfile.full_name : 'Не призначено',
      regulatory_basis: basis || null,
      status: status,
      notified_tiers: [] // Reset warnings upon edit/creation to trigger again if needed
    };
    
    if (id) {
      eventData.id = id;
    }
    
    await DB.saveEvent(eventData);
    events = await DB.getEvents();
    
    // Run triggers
    await processRemindersAutomation();
    
    closeEventModal();
    renderEvents();
    updateStatsSummary();
    loadEmailLogs();
  });
  
  // Rollover Form Submit
  document.getElementById('rollover-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('rollover-event-id').value;
    const nextDate = document.getElementById('rollover-next-date').value;
    
    if (!nextDate) return;
    
    const event = events.find(ev => ev.id === id);
    if (event) {
      event.deadline_date = nextDate;
      event.status = 'Чернетка';
      event.notified_tiers = []; // Reset notified tiers for the new period
      
      await DB.saveEvent(event);
      events = await DB.getEvents();
      
      closeRolloverModal();
      renderEvents();
      updateStatsSummary();
      loadEmailLogs();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
// Backup trigger if DOMContentLoaded has already fired
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  init();
}
