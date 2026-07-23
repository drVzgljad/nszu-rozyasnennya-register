import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// State
let currentUser = null;
let userProfile = null;
let allUsers = [];
let allTasks = [];
let askodMatchedLogs = [];   // записи СКО-Д, знайдені за номером листа
let askodCheckTimer = null;

// Initialize
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;

  if (!currentUser) {
    showAccessDenied("Для роботи з завданнями необхідно авторизуватися.");
    return;
  }

  // Fetch current user profile
  const { data: profile, error: profErr } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (profErr) {
    console.error("Error fetching user profile:", profErr);
  }
  userProfile = profile || { id: currentUser.id, role: 'registered', full_name: currentUser.email.split('@')[0] };

  // Hard programmatic access guard for managers only
  const rolesOrder = ['guest', 'expert', 'manager', 'deputy_director', 'director', 'admin'];
  const userRoleIndex = rolesOrder.indexOf(userProfile.role);
  const managerIndex = rolesOrder.indexOf('manager');
  const isManager = userRoleIndex >= managerIndex;
  
  if (!isManager) {
    showAccessDenied("Ця сторінка доступна лише для керівництва (Директор, Заступники, Начальники відділів та Адміністратор).");
    return;
  }

  // Setup views
  await loadUsers();
  setupManagerPanel();
  await loadTasks();

  // Attach filter listeners
  document.getElementById('filter-dept')?.addEventListener('change', renderRegistry);
  document.getElementById('filter-status')?.addEventListener('change', renderRegistry);
  document.getElementById('filter-search')?.addEventListener('input', renderRegistry);

  // Auth State Change listener
  sb.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user ?? null;
    if (!currentUser) {
      window.location.reload();
    }
  });
}

function showAccessDenied(msg) {
  const content = document.querySelector('.skod-container');
  if (content) {
    content.innerHTML = `
      <div class="skod-card" style="max-width: 500px; margin: 60px auto; text-align: center; padding: 40px;">
        <span style="font-size: 48px;">🔒</span>
        <h2 style="font-family: var(--p-display); margin-top: 20px;">Доступ обмежено</h2>
        <p style="color: var(--p-muted); margin-bottom: 24px;">${msg}</p>
        <button class="btn btn-primary" onclick="document.getElementById('auth-nav-btn')?.click()">Увійти в систему</button>
      </div>
    `;
  }
}

// Load Profiles to populate assigning choices
async function loadUsers() {
  const { data, error } = await sb
    .from('profiles')
    .select('id, full_name, Section, department, position, is_head, role')
    .order('full_name', { ascending: true });

  if (error) {
    console.error("Error loading users:", error);
    return;
  }
  allUsers = data || [];
}

// Setup task assignment UI if user is Director, Deputy or Department Head
function setupManagerPanel() {
  const isDirectorOrDeputy = ['admin', 'director', 'deputy_director'].includes(userProfile.role);
  const isDeptHead = userProfile.role === 'manager';

  if (isDirectorOrDeputy || isDeptHead) {
    const triggerCard = document.getElementById('create-task-trigger-card');
    if (triggerCard) triggerCard.style.display = 'block';

    const modal = document.getElementById('create-task-modal');
    const openBtn = document.getElementById('btn-open-create-modal');
    const closeBtn = document.getElementById('modal-create-close');
    const cancelBtn = document.getElementById('btn-close-create-modal');

    // Open Modal
    if (openBtn && modal) {
      openBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
      });
    }

    // Close Modal
    const closeModal = () => {
      if (modal) modal.style.display = 'none';
    };
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    // Tab switching
    const tabAskod = document.getElementById('tab-askod');
    const tabCurrent = document.getElementById('tab-current');
    const askodGroup = document.getElementById('askod-fields-group');
    const currentGroup = document.getElementById('current-fields-group');
    const askodNumber = document.getElementById('task_askod_number');
    const askodSender = document.getElementById('task_askod_sender');
    const taskTitle = document.getElementById('task_title');

    if (tabAskod && tabCurrent) {
      tabAskod.addEventListener('click', () => {
        tabAskod.classList.add('active');
        tabCurrent.classList.remove('active');
        tabAskod.style.background = 'var(--accent)';
        tabAskod.style.color = '#fff';
        tabAskod.style.border = 'none';
        tabCurrent.style.background = 'var(--p-soft)';
        tabCurrent.style.color = 'var(--p-ink)';
        tabCurrent.style.border = '1px solid var(--p-line)';

        if (askodGroup) askodGroup.style.display = 'block';
        if (currentGroup) currentGroup.style.display = 'none';

        if (askodNumber) askodNumber.required = true;
        if (askodSender) askodSender.required = true;
        if (taskTitle) taskTitle.required = false;
      });

      tabCurrent.addEventListener('click', () => {
        tabCurrent.classList.add('active');
        tabAskod.classList.remove('active');
        tabCurrent.style.background = 'var(--accent)';
        tabCurrent.style.color = '#fff';
        tabCurrent.style.border = 'none';
        tabAskod.style.background = 'var(--p-soft)';
        tabAskod.style.color = 'var(--p-ink)';
        tabAskod.style.border = '1px solid var(--p-line)';

        if (askodGroup) askodGroup.style.display = 'none';
        if (currentGroup) currentGroup.style.display = 'block';

        if (askodNumber) askodNumber.required = false;
        if (askodSender) askodSender.required = false;
        if (taskTitle) taskTitle.required = true;
      });
    }

    // Перевірка номера листа: чи вже опрацьовано / чи є дубль доручення
    if (askodNumber) {
      askodNumber.addEventListener('input', () => {
        clearTimeout(askodCheckTimer);
        askodCheckTimer = setTimeout(checkAskodNumber, 600);
      });
      askodNumber.addEventListener('blur', checkAskodNumber);
    }

    const deptSelect = document.getElementById('task_dept');
    
    if (isDeptHead && !isDirectorOrDeputy) {
      // Department Heads can only assign to their own department
      const userDept = userProfile.Section || userProfile.department;
      if (deptSelect && userDept) {
        deptSelect.value = userDept;
        deptSelect.disabled = true;
      }
    }

    // Handle department change to filter responsible users
    if (deptSelect) {
      deptSelect.addEventListener('change', populateResponsibleList);
      populateResponsibleList();
    }

    // Submit handler
    const form = document.getElementById('skod-task-form');
    if (form) {
      form.addEventListener('submit', createTask);
    }

    // Default deadline to today + 3 days
    const deadlineInput = document.getElementById('task_deadline');
    if (deadlineInput) {
      const today = new Date();
      today.setDate(today.getDate() + 3);
      deadlineInput.value = today.toISOString().split('T')[0];
    }

    const isOngoingInput = document.getElementById('task_is_ongoing');
    if (isOngoingInput && deadlineInput) {
      isOngoingInput.addEventListener('change', (e) => {
        if (e.target.checked) {
          deadlineInput.value = '2026-12-31';
        } else {
          const today = new Date();
          today.setDate(today.getDate() + 3);
          deadlineInput.value = today.toISOString().split('T')[0];
        }
      });
    }

    // Check for prefill query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const prefillTitle = urlParams.get('prefill_title');
    const prefillDesc = urlParams.get('prefill_desc');
    
    if (prefillTitle || prefillDesc) {
      // Open current tab
      if (tabCurrent) tabCurrent.click();
      if (prefillTitle) {
        if (taskTitle) taskTitle.value = prefillTitle;
      }
      if (prefillDesc) {
        const descInput = document.getElementById('task_description');
        if (descInput) descInput.value = prefillDesc;
      }
      if (modal) {
        modal.style.display = 'flex';
      }
    }
  }
}

// Перевірка за номером листа АСКОД: чи вже є запис роботи в СКО-Д або інше доручення
async function checkAskodNumber() {
  const num = document.getElementById('task_askod_number')?.value.trim();
  const box = document.getElementById('askod-check-result');
  if (!box) return;

  askodMatchedLogs = [];
  if (!num || num.length < 3) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  // 1. Записи роботи в СКО-Д з цим номером (вхідним або номером відповіді)
  const quoted = `"${num.replace(/"/g, '')}"`;
  const { data: logs, error: logsErr } = await sb
    .from('skod_logs')
    .select('id, user_name, log_date, duration_minutes, description, askod_reg_number, reply_to_number')
    .or(`askod_reg_number.eq.${quoted},reply_to_number.eq.${quoted}`)
    .order('log_date', { ascending: false })
    .limit(5);

  if (logsErr) console.error('Помилка перевірки записів СКО-Д:', logsErr);
  askodMatchedLogs = logs || [];

  // 2. Наявні доручення з цим самим номером листа
  const existingTasks = allTasks.filter(t => t.askod_number === num);

  if (askodMatchedLogs.length === 0 && existingTasks.length === 0) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  let html = '';

  if (existingTasks.length > 0) {
    const items = existingTasks.map(t =>
      `<li>${escapeHtml(t.responsible_name || 'Не призначено')} — ${getStatusLabel(t.status)}, ${t.progress}% (надав ${escapeHtml(t.created_by_name)})</li>`
    ).join('');
    html += `
      <div style="background: #fff7ed; border: 1.5px solid #fdba74; border-radius: 8px; padding: 12px; margin-bottom: 10px; font-size: 13px;">
        <strong>⚠️ Доручення за листом № ${escapeHtml(num)} вже існує:</strong>
        <ul style="margin: 6px 0 0 18px; padding: 0;">${items}</ul>
      </div>`;
  }

  if (askodMatchedLogs.length > 0) {
    const items = askodMatchedLogs.map(l => {
      const d = l.log_date ? new Date(l.log_date).toLocaleDateString('uk-UA') : '';
      const desc = l.description ? `: «${escapeHtml(l.description.slice(0, 120))}»` : '';
      return `<li>${escapeHtml(l.user_name)}, ${d}, ${l.duration_minutes || 0} хв${desc}</li>`;
    }).join('');
    html += `
      <div style="background: #eef6fc; border: 1.5px solid #93c5fd; border-radius: 8px; padding: 12px; font-size: 13px;">
        <strong>✅ Цей лист уже опрацьовано в СКО-Д:</strong>
        <ul style="margin: 6px 0 8px 18px; padding: 0;">${items}</ul>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600;">
          <input type="checkbox" id="askod_create_completed" checked>
          <span>Створити доручення одразу як виконане (робота вже внесена в СКО-Д)</span>
        </label>
      </div>`;
  }

  box.innerHTML = html;
  box.style.display = 'block';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Список співробітників, доступних для призначення (за обраним підрозділом + RBAC)
function getAssignableUsers() {
  const deptSelect = document.getElementById('task_dept');
  const selectedDept = deptSelect?.value;

  // Тільки реальні співробітники (без гостей)
  let users = allUsers.filter(u => u.role && u.role !== 'guest');

  if (selectedDept && selectedDept !== '__all__') {
    users = users.filter(u => (u.Section || u.department) === selectedDept);
  }

  // RBAC — дублює логіку тригера validate_task_assignment, щоб insert не падав
  if (userProfile.role === 'manager') {
    const myDept = userProfile.Section || userProfile.department;
    users = users.filter(u => u.role === 'expert' && (u.Section || u.department) === myDept);
  } else if (userProfile.role === 'deputy_director') {
    users = users.filter(u => u.role !== 'director');
  }

  return users.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'uk'));
}

function respItemHtml(u) {
  return `<label class="resp-item">
    <input type="checkbox" class="resp-cb" value="${u.id}" data-name="${escapeHtml(u.full_name || 'Співробітник')}" data-dept="${escapeHtml(u.Section || u.department || 'Поза відділами')}">
    <span>${escapeHtml(u.full_name || 'Співробітник')} <span class="resp-pos">${escapeHtml(u.position || '')}</span></span>
  </label>`;
}

// Побудова списку відповідальних (чекбокси + майстер «Всім»)
function populateResponsibleList() {
  const list = document.getElementById('task_responsible_list');
  const deptSelect = document.getElementById('task_dept');
  if (!list || !deptSelect) return;

  const selectedDept = deptSelect.value;
  const users = getAssignableUsers();

  if (users.length === 0) {
    list.innerHTML = '<div class="resp-empty">У цьому підрозділі немає доступних виконавців.</div>';
    updateResponsibleHint();
    return;
  }

  const allLabel = selectedDept === '__all__' ? '👥 Всім (усі відділи)' : '👥 Всім у підрозділі';
  let html = `<label class="resp-item resp-all">
      <input type="checkbox" id="resp_all">
      <span><b>${allLabel}</b></span>
    </label>`;

  if (selectedDept === '__all__') {
    // Групування за відділами
    const groups = {};
    users.forEach(u => {
      const d = u.Section || u.department || 'Поза відділами';
      (groups[d] = groups[d] || []).push(u);
    });
    Object.keys(groups).sort((a, b) => a.localeCompare(b, 'uk')).forEach(dept => {
      html += `<div class="resp-group-title">${escapeHtml(dept)}</div>`;
      groups[dept].forEach(u => { html += respItemHtml(u); });
    });
  } else {
    users.forEach(u => { html += respItemHtml(u); });
  }
  list.innerHTML = html;

  // Обробники: майстер ↔ окремі чекбокси
  const allCb = document.getElementById('resp_all');
  const itemCbs = [...list.querySelectorAll('.resp-cb')];
  if (allCb) {
    allCb.addEventListener('change', () => {
      itemCbs.forEach(cb => { cb.checked = allCb.checked; });
      updateResponsibleHint();
    });
  }
  itemCbs.forEach(cb => {
    cb.addEventListener('change', () => {
      if (allCb) allCb.checked = itemCbs.length > 0 && itemCbs.every(c => c.checked);
      updateResponsibleHint();
    });
  });
  updateResponsibleHint();
}

// Обрані виконавці
function getSelectedResponsibles() {
  return [...document.querySelectorAll('#task_responsible_list .resp-cb:checked')].map(cb => ({
    id: cb.value,
    name: cb.dataset.name,
    dept: cb.dataset.dept
  }));
}

function updateResponsibleHint() {
  const n = getSelectedResponsibles().length;
  const hint = document.getElementById('responsible-count-hint');
  if (hint) hint.textContent = n ? `Обрано виконавців: ${n}` : 'Оберіть хоча б одного виконавця.';
}

// Create new task in Supabase
async function createTask(e) {
  e.preventDefault();
  
  const task_type = document.getElementById('tab-askod').classList.contains('active') ? 'askod' : 'current';
  const importance = document.querySelector('input[name="task_importance"]:checked')?.value || 'normal';
  
  let title = '';
  let askod_number = null;
  let askod_sender = null;

  if (task_type === 'askod') {
    askod_number = document.getElementById('task_askod_number')?.value.trim();
    askod_sender = document.getElementById('task_askod_sender')?.value.trim();
    title = `Лист № ${askod_number} від ${askod_sender}`;
    
    if (!askod_number || !askod_sender) {
      alert("Будь ласка, заповніть номер листа та відправника.");
      return;
    }
  } else {
    title = document.getElementById('task_title')?.value.trim();
    if (!title) {
      alert("Будь ласка, введіть назву завдання.");
      return;
    }
  }

  const selectedDept = document.getElementById('task_dept')?.value;
  const deadline = document.getElementById('task_deadline')?.value;
  const description = document.getElementById('task_description')?.value.trim();
  const is_ongoing = document.getElementById('task_is_ongoing')?.checked || false;
  const toPlanner = document.getElementById('task_to_planner')?.checked || false;
  // Посилання на зустріч — лише для поточного завдання
  const meeting_link = task_type === 'current'
    ? (document.getElementById('task_meeting_link')?.value.trim() || null)
    : null;

  const submitBtn = document.getElementById('btn-submit-task');

  const responsibles = getSelectedResponsibles();

  if (!selectedDept || !deadline) {
    alert("Будь ласка, заповніть усі обов'язкові поля.");
    return;
  }
  if (responsibles.length === 0) {
    alert("Оберіть хоча б одного відповідального виконавця.");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Збереження...';
  }

  const creatorName = userProfile.full_name || currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

  // Лист уже опрацьовано в СКО-Д → створюємо доручення одразу як виконане
  const createCompleted = task_type === 'askod'
    && askodMatchedLogs.length > 0
    && document.getElementById('askod_create_completed')?.checked;

  let completedComments = null;
  if (createCompleted) {
    const logsSummary = askodMatchedLogs.map(l => {
      const d = l.log_date ? new Date(l.log_date).toLocaleDateString('uk-UA') : '';
      return `${l.user_name} (${d}, ${l.duration_minutes || 0} хв)`;
    }).join('; ');
    completedComments = [{
      id: crypto.randomUUID(),
      author: 'Система',
      role: 'system',
      text: `Доручення створено одразу як виконане: лист № ${askod_number} вже опрацьовано в СКО-Д — ${logsSummary}.`,
      timestamp: new Date().toISOString(),
      type: 'system'
    }];
  }

  // Фан-аут: окремий рядок доручення на кожного виконавця
  const rows = responsibles.map(r => {
    const row = {
      created_by: currentUser.id,
      created_by_name: creatorName,
      title,
      department: selectedDept === '__all__' ? (r.dept || 'Поза відділами') : selectedDept,
      responsible_id: r.id,
      responsible_name: r.name,
      deadline,
      progress: 0,
      status: 'assigned',
      description,
      is_ongoing,
      task_type,
      askod_number,
      askod_sender,
      importance,
      meeting_link
    };
    if (createCompleted) {
      row.status = 'completed';
      row.progress = 100;
      row.comments = completedComments;
    }
    return row;
  });

  const { data: inserted, error } = await sb
    .from('assigned_tasks')
    .insert(rows)
    .select('id, responsible_id, responsible_name, title, description, deadline');

  // Відправка в планувальник виконавців (окремі події, зв'язані з дорученням)
  let plannerWarn = '';
  if (!error && toPlanner && !is_ongoing && !createCompleted && inserted?.length) {
    const events = inserted.map(t => ({
      user_id: t.responsible_id,
      user_name: t.responsible_name,
      creator_id: currentUser.id,
      creator_name: creatorName,
      title: t.title,
      description: t.description || null,
      event_date: t.deadline,
      status: 'planned',
      task_id: t.id,
      meeting_link: meeting_link || null
    }));
    const { error: pErr } = await sb.from('planner_events').insert(events);
    if (pErr) {
      console.warn('Не вдалося додати в планувальник:', pErr.message);
      plannerWarn = '\n\n⚠️ Доручення створено, але не вдалося додати в планувальник: ' + pErr.message;
    }
  }

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Надати доручення';
  }

  if (error) {
    alert("Помилка створення доручення: " + error.message);
  } else {
    if (plannerWarn) alert(plannerWarn.trim());
    // Reset Form
    const tInput = document.getElementById('task_title');
    if (tInput) tInput.value = '';
    const mlInput = document.getElementById('task_meeting_link');
    if (mlInput) mlInput.value = '';
    const askodNum = document.getElementById('task_askod_number');
    if (askodNum) askodNum.value = '';
    const askodSnd = document.getElementById('task_askod_sender');
    if (askodSnd) askodSnd.value = '';

    // Очистити результат перевірки номера АСКОД
    askodMatchedLogs = [];
    const checkBox = document.getElementById('askod-check-result');
    if (checkBox) {
      checkBox.style.display = 'none';
      checkBox.innerHTML = '';
    }
    
    const normalRadio = document.querySelector('input[name="task_importance"][value="normal"]');
    if (normalRadio) normalRadio.checked = true;

    document.getElementById('task_description').value = '';
    // Скинути обраних виконавців (перебудова списку знімає всі галочки)
    populateResponsibleList();

    const isOngoingInput = document.getElementById('task_is_ongoing');
    if (isOngoingInput) {
      isOngoingInput.checked = false;
      const deadlineInput = document.getElementById('task_deadline');
      if (deadlineInput) {
        deadlineInput.disabled = false;
        const today = new Date();
        today.setDate(today.getDate() + 3);
        deadlineInput.value = today.toISOString().split('T')[0];
        deadlineInput.required = true;
      }
    }
    
    // Close Modal
    const modal = document.getElementById('create-task-modal');
    if (modal) modal.style.display = 'none';

    // Reload
    await loadTasks();
  }
}

// Load tasks from Supabase
async function loadTasks() {
  const { data, error } = await sb
    .from('assigned_tasks')
    .select('*')
    .order('deadline', { ascending: true });

  if (error) {
    console.error("Error loading tasks:", error);
    return;
  }

  allTasks = data || [];
  renderMyTasks();
  renderRegistry();
}

// Render tasks assigned to current logged-in user
function renderMyTasks() {
  const container = document.getElementById('my-tasks-list');
  const emptyEl = document.getElementById('my-tasks-empty');
  if (!container) return;

  const myTasks = allTasks.filter(t => t.responsible_id === currentUser.id && t.status !== 'completed' && t.progress < 100);

  container.innerHTML = '';
  if (myTasks.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';

    myTasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'personal-task-card';
      
      const deadlineDate = new Date(task.deadline);
      const formattedDeadline = deadlineDate.toLocaleDateString('uk-UA');
      
      let metaText = `Надав: ${task.created_by_name} &bull; Термін: ${formattedDeadline}`;
      let statusBadgeHtml = `<span class="badge-status ${task.status}">${getStatusLabel(task.status)}</span>`;
      let progressSliderHtml = `
        <div class="progress-slider-container">
          <input type="range" id="range-${task.id}" min="0" max="100" value="${task.progress}" oninput="document.getElementById('val-${task.id}').textContent = this.value + '%'">
          <span class="progress-val-badge" id="val-${task.id}">${task.progress}%</span>
        </div>
      `;

      if (task.is_ongoing) {
        metaText = `Надав: ${task.created_by_name} &bull; 🔄 Постійне посадове доручення`;
        statusBadgeHtml = `<span class="badge-status ongoing" style="background: var(--accent-soft, rgba(74, 143, 199, 0.15)); color: var(--accent-deep, #2f6b9e);">🔄 Посадовий обов'язок</span>`;
        progressSliderHtml = '';
      }

      card.innerHTML = `
        <div class="personal-task-header">
          <div>
            <h3 class="personal-task-title">
              <a href="task-detail.html?id=${task.id}" target="_blank" style="color: inherit; text-decoration: none; border-bottom: 1px dashed var(--accent, #3b82f6); transition: color 0.2s;" onmouseover="this.style.color='var(--accent, #3b82f6)'" onmouseout="this.style.color='inherit'">${task.title}</a>
            </h3>
            <span class="personal-task-meta">${metaText}</span>
          </div>
          ${statusBadgeHtml}
        </div>
        <div style="font-size: 13.5px; color: var(--p-muted); line-height: 1.4;">${task.description || 'Без додаткового опису.'}</div>
        
        <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--p-line); padding-top: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div style="display:flex; align-items:center; gap: 6px;">
              <label for="status-${task.id}" style="font-size:12px; font-weight:700; color:var(--p-muted);">Статус:</label>
              <select id="status-${task.id}" style="font-size:12px; padding: 4px 8px; border-radius: 6px; border:1px solid var(--p-line);">
                <option value="assigned" ${task.status === 'assigned' ? 'selected' : ''}>Призначено</option>
                <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>В роботі</option>
                <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Виконано</option>
              </select>
            </div>
            
            <button class="btn btn-save-progress" data-id="${task.id}" style="padding: 6px 12px; font-size: 12px; border-radius: 6px; background: var(--accent); color: #fff; border:none; font-weight:700; cursor:pointer;">
              Зберегти зміни
            </button>
          </div>
          ${progressSliderHtml}
        </div>
      `;
      container.appendChild(card);
    });

    // Attach update handler
    container.querySelectorAll('.btn-save-progress').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        const taskObj = allTasks.find(t => t.id === id);
        const rangeEl = document.getElementById(`range-${id}`);
        let progress = rangeEl ? parseInt(rangeEl.value, 10) : (taskObj ? taskObj.progress : 0);
        const status = document.getElementById(`status-${id}`).value;

        if (status === 'completed') {
          progress = 100;
        }
        
        e.target.disabled = true;
        e.target.textContent = 'Збереження...';
        
        const { error } = await sb
          .from('assigned_tasks')
          .update({ progress, status })
          .eq('id', id);

        e.target.disabled = false;
        e.target.textContent = 'Зберегти зміни';

        if (error) {
          alert("Помилка збереження: " + error.message);
        } else {
          await loadTasks();
        }
      });
    });
  }
}

// Render all tasks registry with filters
function renderRegistry() {
  const tableBody = document.getElementById('registry-tasks-body');
  const emptyEl = document.getElementById('registry-tasks-empty');
  if (!tableBody) return;

  const deptFilter = document.getElementById('filter-dept')?.value || 'all';
  const statusFilter = document.getElementById('filter-status')?.value || 'all';
  const searchFilter = document.getElementById('filter-search')?.value.trim().toLowerCase() || '';

  const filteredTasks = allTasks.filter(t => {
    const matchDept = deptFilter === 'all' || t.department === deptFilter;
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchSearch = !searchFilter || 
      (t.responsible_name && t.responsible_name.toLowerCase().includes(searchFilter)) ||
      (t.created_by_name && t.created_by_name.toLowerCase().includes(searchFilter));
    return matchDept && matchStatus && matchSearch;
  });

  tableBody.innerHTML = '';
  if (filteredTasks.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';

    filteredTasks.forEach(task => {
      const tr = document.createElement('tr');
      
      // Delete button check
      const canDelete = task.created_by === currentUser.id || ['admin', 'director', 'deputy_director'].includes(userProfile.role);
      const deleteBtn = canDelete 
        ? `<button class="btn-delete-task" data-id="${task.id}" title="Видалити доручення">&times;</button>`
        : '';

      // Evaluation cell content
      let evalCell = '';
      if (task.status === 'completed') {
        const canEvaluate = ['admin', 'director', 'deputy_director', 'manager'].includes(userProfile.role);
        if (canEvaluate) {
          const coef = task.evaluation_coefficient || 1.0;
          evalCell = `
            <select class="select-task-evaluation" data-id="${task.id}" style="font-size:12px; padding:4px 8px; border-radius:6px; border:1px solid var(--p-line); width: 100%;">
              <option value="1.3" ${coef == 1.3 ? 'selected' : ''}>Відмінно (1.3)</option>
              <option value="1.0" ${coef == 1.0 ? 'selected' : ''}>Добре (1.0)</option>
              <option value="0.8" ${coef == 0.8 ? 'selected' : ''}>Задовільно (0.8)</option>
              <option value="0.5" ${coef == 0.5 ? 'selected' : ''}>Незадовільно (0.5)</option>
            </select>
          `;
        } else {
          evalCell = `<span class="badge-status" style="background:#eef6fc; color:#2f6b9e; font-size:11px;">${task.evaluation_label || 'Очікує оцінки'}</span>`;
        }
      } else {
        evalCell = `<span style="color:var(--p-muted); font-size:12px;">В процесі</span>`;
      }

      // Importance cell
      let impCell = '';
      const imp = task.importance || 'normal';
      if (imp === 'critical') {
        impCell = `<span class="badge-importance critical">🔴 Термінова</span>`;
      } else if (imp === 'important') {
        impCell = `<span class="badge-importance important">🟡 Важлива</span>`;
      } else {
        impCell = `<span class="badge-importance normal">🟢 Звичайна</span>`;
      }

      // Urgency cell
      let urgencyCell = '';
      let deadlineVal = '';
      if (task.is_ongoing) {
        deadlineVal = '<span style="color:var(--p-muted); font-weight:normal;">Постійне</span>';
        urgencyCell = `<span style="color:var(--p-muted); font-size:12px; font-style:italic;">Постійне</span>`;
      } else {
        const today = new Date();
        today.setHours(0,0,0,0);
        const deadlineDate = new Date(task.deadline);
        deadlineDate.setHours(0,0,0,0);
        const daysLeft = Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));
        const formattedDeadline = new Date(task.deadline).toLocaleDateString('uk-UA');
        deadlineVal = formattedDeadline;
        
        if (daysLeft < 0) {
          urgencyCell = `<span style="color:#ef4444; font-weight:700; font-size:12px;">🚨 Прострочено (${Math.abs(daysLeft)} дн.)</span>`;
        } else if (daysLeft === 0) {
          urgencyCell = `<span style="color:#f59e0b; font-weight:700; font-size:12px;">⚠️ Сьогодні!</span>`;
        } else if (daysLeft === 1) {
          urgencyCell = `<span style="color:#f59e0b; font-weight:600; font-size:12px;">Завтра</span>`;
        } else {
          urgencyCell = `<span style="font-size:12px;">${formattedDeadline} <span style="color:var(--p-muted); font-size:10px;">(${daysLeft} дн.)</span></span>`;
        }
      }

      // Letter number cell
      let letterCell = '';
      if (task.task_type === 'askod' && task.askod_number) {
        letterCell = `<span style="font-family:monospace; font-weight:600; color:var(--p-ink); font-size:12.5px;">№ ${task.askod_number}</span>`;
      } else {
        letterCell = `<span style="font-size: 10px; font-weight: 700; background: var(--p-soft); color: var(--p-muted); padding: 4px 8px; border-radius: 6px; text-transform: uppercase;">📌 Поточне</span>`;
      }

      let progressCell = `
        <div style="display:flex; align-items:center;">
          <div class="table-progress-bar-container">
            <div class="table-progress-bar" style="width: ${task.progress}%;"></div>
          </div>
          <span style="font-size:13px; font-weight:700; color:var(--accent-2-deep);">${task.progress}%</span>
        </div>
      `;
      let statusBadge = `<span class="badge-status ${task.status}">${getStatusLabel(task.status)}</span>`;

      if (task.is_ongoing) {
        progressCell = `<span style="font-size:12px; color: var(--p-muted); font-style: italic;">Посадовий обов'язок</span>`;
        statusBadge = `<span class="badge-status ongoing" style="background: var(--accent-soft, rgba(74, 143, 199, 0.15)); color: var(--accent-deep, #2f6b9e); font-weight:700;">🔄 Посадовий обов'язок</span>`;
      }

      tr.innerHTML = `
        <td>${impCell}</td>
        <td>${urgencyCell}</td>
        <td>${letterCell}</td>
        <td>
          <div style="font-weight: 700;">
            <a href="task-detail.html?id=${task.id}" target="_blank" style="color: var(--accent, #3b82f6); text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${task.title}</a>
          </div>
          <div style="font-size:11px; color: var(--p-muted); margin-top: 4px;">Надав: ${task.created_by_name}</div>
        </td>
        <td><span style="font-size:13px; font-weight:600; color:var(--accent-deep);">${task.department}</span></td>
        <td>
          <div style="font-weight: 600; font-size:13px;">${task.responsible_name || 'Не призначено'}</div>
        </td>
        <td>${progressCell}</td>
        <td>${statusBadge}</td>
        <td>${evalCell}</td>
        <td style="text-align: center;">${deleteBtn}</td>
      `;
      tableBody.appendChild(tr);
    });

    // Delete listeners
    tableBody.querySelectorAll('.btn-delete-task').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        if (confirm("Ви дійсно хочете видалити це доручення?")) {
          const { error } = await sb.from('assigned_tasks').delete().eq('id', id);
          if (error) {
            alert("Помилка видалення: " + error.message);
          } else {
            await loadTasks();
          }
        }
      });
    });

    // Evaluation change listeners
    tableBody.querySelectorAll('.select-task-evaluation').forEach(select => {
      select.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        const coef = parseFloat(e.target.value);
        const labels = {
          "1.3": "Відмінно",
          "1.0": "Добре",
          "0.8": "Задовільно",
          "0.5": "Незадовільно"
        };
        const label = labels[e.target.value] || "Оцінено";
        
        e.target.disabled = true;
        const { error } = await sb
          .from('assigned_tasks')
          .update({
            evaluation_coefficient: coef,
            evaluation_label: label,
            evaluated_at: new Date().toISOString()
          })
          .eq('id', id);
          
        if (error) {
          alert("Помилка збереження оцінки: " + error.message);
          e.target.disabled = false;
        } else {
          await loadTasks();
        }
      });
    });
  }
}

// Translations / Labels
function getStatusLabel(status) {
  const map = {
    assigned: 'Призначено',
    in_progress: 'В роботі',
    completed: 'Виконано',
    planning: 'План виконання',
    rejected: 'Відхилено'
  };
  return map[status] || status;
}

// Start
document.addEventListener('DOMContentLoaded', init);
