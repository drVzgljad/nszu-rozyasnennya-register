import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// State variables
let currentUser = null;
let userProfile = null;
let currentTask = null;
let taskId = null;

const COEFFICIENTS = {
  easy: 1.0,
  medium: 1.3,
  hard: 1.8,
  expert: 2.5
};

const severityMap = {
  easy: 'Легка',
  medium: 'Середня',
  hard: 'Складна',
  expert: 'Експертна'
};

const statusMap = {
  assigned: 'Призначено 📥',
  planning: 'Складання плану 📋',
  in_progress: 'В роботі ⚡',
  completed: 'Виконано ⏹️',
  rejected: 'Відхилено ❌'
};

// Start
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 1. Get Session
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;

  if (!currentUser) {
    showAccessDenied("Для перегляду доручення необхідно авторизуватися.");
    return;
  }

  // 2. Fetch User Profile
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  userProfile = profile || { id: currentUser.id, role: 'registered', full_name: currentUser.email.split('@')[0] };

  // Guard: expert or higher can access
  const rolesOrder = ['guest', 'expert', 'manager', 'deputy_director', 'director', 'admin'];
  const userRoleIndex = rolesOrder.indexOf(userProfile.role);
  const expertIndex = rolesOrder.indexOf('expert');
  if (userRoleIndex < expertIndex) {
    showAccessDenied("Ця сторінка доступна лише для фахівців та керівництва департаменту.");
    return;
  }

  // 3. Read Task ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  taskId = urlParams.get('id');
  if (!taskId) {
    showError("Не вказано ID доручення.");
    return;
  }

  // 4. Load Data
  await loadTaskDetails();

  // 5. Auth State Change Listener
  sb.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user ?? null;
    if (!currentUser) {
      window.location.reload();
    }
  });

  // 6. Setup static forms
  setupForms();
}

function showAccessDenied(msg) {
  const container = document.querySelector('.skod-container');
  if (container) {
    container.innerHTML = `
      <div class="skod-card" style="max-width: 500px; margin: 60px auto; text-align: center; padding: 40px;">
        <span style="font-size: 48px;">🔒</span>
        <h2 style="font-family: var(--p-display); margin-top: 20px;">Доступ обмежено</h2>
        <p style="color: var(--p-muted); margin-bottom: 24px;">${msg}</p>
        <button class="btn btn-primary" onclick="document.getElementById('auth-nav-btn')?.click()">Увійти в систему</button>
      </div>
    `;
  }
}

function showError(msg) {
  const container = document.querySelector('.skod-container');
  if (container) {
    container.innerHTML = `
      <div class="skod-card" style="max-width: 500px; margin: 60px auto; text-align: center; padding: 40px; border-color: #ef4444;">
        <span style="font-size: 48px; color: #ef4444;">⚠️</span>
        <h2 style="font-family: var(--p-display); margin-top: 20px; color: #ef4444;">Помилка</h2>
        <p style="color: var(--p-muted); margin-bottom: 24px;">${msg}</p>
        <a href="tasks.html" class="btn btn-primary">Повернутись до списку</a>
      </div>
    `;
  }
}

async function loadTaskDetails() {
  const { data: task, error } = await sb
    .from('assigned_tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (error || !task) {
    console.error("Error loading task:", error);
    showError("Не вдалося завантажити деталі доручення або його не існує.");
    return;
  }

  currentTask = task;

  // Render elements
  renderTaskHeader();
  renderStatusBanner();
  renderArgumentBox();
  renderSubtasks();
  await renderSkodLogs();
  renderComments();
}

function renderTaskHeader() {
  const deptBadge = document.getElementById('task-dept-badge');
  const titleEl = document.getElementById('task-title');
  const metaEl = document.getElementById('task-meta');
  const progressBar = document.getElementById('task-progress-bar');
  const progressVal = document.getElementById('task-progress-val');
  const descEl = document.getElementById('task-description');

  if (deptBadge) deptBadge.textContent = currentTask.department;
  if (titleEl) titleEl.textContent = currentTask.title;
  
  if (metaEl) {
    const createdDate = new Date(currentTask.created_at).toLocaleDateString('uk-UA');
    const deadlineDate = new Date(currentTask.deadline).toLocaleDateString('uk-UA');
    metaEl.innerHTML = `
      <strong>Надав:</strong> ${currentTask.created_by_name} (${createdDate}) &bull; 
      <strong>Виконавець:</strong> ${currentTask.responsible_name || 'Не призначено'} &bull; 
      <strong>Термін виконання:</strong> <span style="font-weight: 700; color: var(--accent-deep);">${deadlineDate}</span>
    `;
  }

  if (progressBar) progressBar.style.width = `${currentTask.progress}%`;
  if (progressVal) progressVal.textContent = `${currentTask.progress}%`;

  if (descEl) {
    descEl.textContent = currentTask.description || 'Опис доручення відсутній.';
  }
}

function renderStatusBanner() {
  const banner = document.getElementById('status-banner');
  const label = document.getElementById('status-label');
  const actions = document.getElementById('status-actions');
  if (!banner || !label || !actions) return;

  banner.style.display = 'flex';
  banner.className = `status-banner ${currentTask.status}`;
  label.textContent = statusMap[currentTask.status] || currentTask.status;

  // Determine user permissions to update
  const canUpdate = currentTask.responsible_id === currentUser.id || 
                    currentTask.created_by === currentUser.id ||
                    ['admin', 'director', 'deputy_director', 'manager'].includes(userProfile.role);

  actions.innerHTML = '';

  if (!canUpdate) {
    actions.innerHTML = `<span style="font-size:12px; color: var(--p-muted); font-style:italic;">Тільки для виконавця або керівництва</span>`;
    return;
  }

  // Render control buttons based on current status
  if (currentTask.status === 'assigned') {
    actions.innerHTML = `
      <button class="btn btn-primary btn-status-action" data-status="in_progress" style="background:#22c55e; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-weight:700; cursor:pointer;">Розпочати виконання ⚡</button>
      <button class="btn btn-status-action-form" data-type="planning" style="background:#f59e0b; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-weight:700; cursor:pointer;">Скласти план 📋</button>
      <button class="btn btn-status-action-form" data-type="rejected" style="background:#ef4444; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-weight:700; cursor:pointer;">Відхилити ❌</button>
    `;
  } else if (currentTask.status === 'in_progress') {
    actions.innerHTML = `
      <button class="btn btn-status-action" data-status="completed" style="background:#22c55e; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-weight:700; cursor:pointer;">Завершити виконання ⏹️</button>
      <button class="btn btn-status-action-form" data-type="planning" style="background:#f59e0b; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-weight:700; cursor:pointer;">Запропонувати план 📋</button>
      <button class="btn btn-status-action-form" data-type="rejected" style="background:#ef4444; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-weight:700; cursor:pointer;">Відмовитись ❌</button>
    `;
  } else if (['planning', 'rejected', 'completed'].includes(currentTask.status)) {
    actions.innerHTML = `
      <button class="btn btn-status-action" data-status="in_progress" style="background:#3b82f6; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-weight:700; cursor:pointer;">Повернути в роботу ⚡</button>
    `;
  }

  // Attach event listeners
  actions.querySelectorAll('.btn-status-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const newStatus = e.target.dataset.status;
      await updateTaskStatus(newStatus);
    });
  });

  actions.querySelectorAll('.btn-status-action-form').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.type;
      showArgumentForm(type);
    });
  });
}

async function updateTaskStatus(newStatus) {
  let progress = currentTask.progress;
  if (newStatus === 'completed') {
    progress = 100;
  } else if (newStatus === 'in_progress' && currentTask.status === 'assigned') {
    progress = currentTask.progress === 0 ? 10 : currentTask.progress; // set to 10% if 0% to show start
  }

  const systemMessage = `${userProfile.full_name} змінив статус завдання на "${statusMap[newStatus] || newStatus}"`;
  const comments = [...(currentTask.comments || []), {
    id: crypto.randomUUID(),
    author: 'Система',
    role: 'system',
    text: systemMessage,
    timestamp: new Date().toISOString(),
    type: 'system'
  }];

  const { error } = await sb
    .from('assigned_tasks')
    .update({ status: newStatus, progress, comments })
    .eq('id', taskId);

  if (error) {
    alert("Помилка при зміні статусу: " + error.message);
  } else {
    await loadTaskDetails();
  }
}

function showArgumentForm(type) {
  const formCard = document.getElementById('argument-form-card');
  const title = document.getElementById('argument-form-title');
  const textarea = document.getElementById('argument-input');
  if (!formCard || !title || !textarea) return;

  formCard.style.display = 'block';
  formCard.scrollIntoView({ behavior: 'smooth' });

  if (type === 'planning') {
    title.textContent = '📋 Складання плану виконання завдання';
    textarea.placeholder = 'Опишіть деталізований план виконання завдання...';
    formCard.dataset.type = 'planning';
  } else if (type === 'rejected') {
    title.textContent = '❌ Аргументація відмови від виконання завдання';
    textarea.placeholder = 'Вкажіть причини відмови або неможливості виконання доручення...';
    formCard.dataset.type = 'rejected';
  }
}

function hideArgumentForm() {
  const formCard = document.getElementById('argument-form-card');
  if (formCard) formCard.style.display = 'none';
}

function renderArgumentBox() {
  const box = document.getElementById('argument-box');
  const title = document.getElementById('argument-title');
  const text = document.getElementById('argument-text');
  if (!box || !title || !text) return;

  if (currentTask.status === 'planning' && currentTask.plan_details) {
    box.style.display = 'block';
    box.style.borderColor = '#f59e0b';
    title.innerHTML = '📋 <strong>План виконання завдання:</strong>';
    text.textContent = currentTask.plan_details;
  } else if (currentTask.status === 'rejected' && currentTask.rejection_reason) {
    box.style.display = 'block';
    box.style.borderColor = '#ef4444';
    title.innerHTML = '❌ <strong>Причина відмови:</strong>';
    text.textContent = currentTask.rejection_reason;
  } else {
    box.style.display = 'none';
  }
}

function renderSubtasks() {
  const container = document.getElementById('subtasks-container');
  if (!container) return;

  const subtasks = currentTask.subtasks || [];
  container.innerHTML = '';

  if (subtasks.length === 0) {
    container.innerHTML = `<div style="font-size:13.5px; color: var(--p-muted); font-style:italic; padding: 8px 0;">Підзавдання не додано. Ви можете розбити доручення на менші кроки.</div>`;
    return;
  }

  // Determine permissions
  const canUpdate = currentTask.responsible_id === currentUser.id || 
                    currentTask.created_by === currentUser.id ||
                    ['admin', 'director', 'deputy_director', 'manager'].includes(userProfile.role);

  subtasks.forEach(sub => {
    const el = document.createElement('div');
    el.className = `checklist-item ${sub.completed ? 'checked' : ''}`;
    
    el.innerHTML = `
      <input type="checkbox" data-id="${sub.id}" ${sub.completed ? 'checked' : ''} ${!canUpdate ? 'disabled' : ''}>
      <span style="font-size: 14px; font-weight: 500;">${sub.title}</span>
      ${canUpdate ? `<button class="btn-delete-subtask" data-id="${sub.id}">&times;</button>` : ''}
    `;
    container.appendChild(el);
  });

  // Attach toggling listeners
  container.querySelectorAll('input[type="checkbox"]').forEach(box => {
    box.addEventListener('change', async (e) => {
      const subId = e.target.dataset.id;
      const completed = e.target.checked;
      await toggleSubtask(subId, completed);
    });
  });

  // Attach delete listeners
  container.querySelectorAll('.btn-delete-subtask').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const subId = e.target.dataset.id;
      if (confirm("Ви дійсно хочете видалити це підзавдання?")) {
        await deleteSubtask(subId);
      }
    });
  });
}

async function toggleSubtask(subId, completed) {
  const subtasks = currentTask.subtasks || [];
  const sub = subtasks.find(s => s.id === subId);
  if (!sub) return;

  sub.completed = completed;

  // Calculate new progress based on checklist
  const total = subtasks.length;
  const done = subtasks.filter(s => s.completed).length;
  const progress = Math.round((done / total) * 100);

  const systemMsg = `${userProfile.full_name} позначив підзавдання "${sub.title}" як ${completed ? 'виконане ✅' : 'не виконане ⬜'}`;
  const comments = [...(currentTask.comments || []), {
    id: crypto.randomUUID(),
    author: 'Система',
    role: 'system',
    text: systemMsg,
    timestamp: new Date().toISOString(),
    type: 'system'
  }];

  const { error } = await sb
    .from('assigned_tasks')
    .update({ subtasks, progress, comments })
    .eq('id', taskId);

  if (error) {
    alert("Помилка оновлення: " + error.message);
  } else {
    await loadTaskDetails();
  }
}

async function deleteSubtask(subId) {
  let subtasks = currentTask.subtasks || [];
  const sub = subtasks.find(s => s.id === subId);
  if (!sub) return;

  subtasks = subtasks.filter(s => s.id !== subId);

  // Recalculate progress
  const total = subtasks.length;
  const progress = total > 0 
    ? Math.round((subtasks.filter(s => s.completed).length / total) * 100)
    : 0;

  const systemMsg = `${userProfile.full_name} видалив підзавдання "${sub.title}"`;
  const comments = [...(currentTask.comments || []), {
    id: crypto.randomUUID(),
    author: 'Система',
    role: 'system',
    text: systemMsg,
    timestamp: new Date().toISOString(),
    type: 'system'
  }];

  const { error } = await sb
    .from('assigned_tasks')
    .update({ subtasks, progress, comments })
    .eq('id', taskId);

  if (error) {
    alert("Помилка видалення підзавдання: " + error.message);
  } else {
    await loadTaskDetails();
  }
}

async function renderSkodLogs() {
  const tbody = document.getElementById('task-logs-body');
  const empty = document.getElementById('task-logs-empty');
  if (!tbody) return;

  tbody.innerHTML = '';

  const { data: logs, error } = await sb
    .from('skod_logs')
    .select('*')
    .eq('assigned_task_id', taskId)
    .order('log_date', { ascending: false })
    .order('start_time', { ascending: false });

  if (error) {
    console.error("Error loading logs:", error);
    return;
  }

  if (!logs || logs.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';

  logs.forEach(log => {
    const tr = document.createElement('tr');
    
    const formattedDate = new Date(log.log_date).toLocaleDateString('uk-UA');
    const sevLabel = severityMap[log.severity_level] || log.severity_level;
    const scoreVal = log.score ? log.score.toFixed(2) : '0.00';

    tr.innerHTML = `
      <td style="font-size:12px;">
        <div>${formattedDate}</div>
        <div style="color:var(--p-muted); margin-top:2px;">${log.start_time.slice(0, 5)}</div>
      </td>
      <td style="font-weight:600; font-size:12.5px;">${log.user_name}</td>
      <td>
        <div style="font-size:13px; font-weight:500;">${log.description}</div>
        <div style="font-size:11px; color:var(--p-muted); margin-top:3px;">Коефіцієнт: ${log.complexity_coefficient} (${sevLabel})</div>
      </td>
      <td style="font-weight:600; font-size:13px;">${log.duration_minutes} хв</td>
      <td style="font-weight:800; color:var(--accent-2-deep); font-size:13.5px;">${scoreVal}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderComments() {
  const container = document.getElementById('comments-list');
  if (!container) return;

  const comments = currentTask.comments || [];
  container.innerHTML = '';

  if (comments.length === 0) {
    container.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--p-muted); font-style: italic; font-size:13px;">Історія та коментарі відсутні. Напишіть коментар, щоб почати діалог.</div>`;
    return;
  }

  comments.forEach(c => {
    const dateStr = new Date(c.timestamp).toLocaleString('uk-UA', {
      day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const el = document.createElement('div');
    el.className = 'comment-item';

    if (c.type === 'system') {
      el.style.background = 'var(--p-soft)';
      el.style.borderLeft = '3px solid var(--p-muted)';
      el.innerHTML = `
        <div class="comment-meta">
          <span>⚙️ Системна подія</span>
          <span>${dateStr}</span>
        </div>
        <div class="comment-text" style="color: var(--p-muted); font-style: italic;">
          ${c.text}
        </div>
      `;
    } else {
      let roleBadge = '';
      if (c.role === 'director' || c.role === 'deputy_director') roleBadge = '👑 ';
      else if (c.role === 'manager') roleBadge = '💼 ';
      
      el.innerHTML = `
        <div class="comment-meta">
          <span>${roleBadge}${c.author}</span>
          <span>${dateStr}</span>
        </div>
        <div class="comment-text">
          ${c.text}
        </div>
      `;
    }
    container.appendChild(el);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function setupForms() {
  // 1. Add Subtask Form
  const subtaskForm = document.getElementById('add-subtask-form');
  if (subtaskForm) {
    subtaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('subtask-title');
      const title = input?.value.trim();
      if (!title) return;

      const subtasks = currentTask.subtasks || [];
      const newSubtask = {
        id: crypto.randomUUID(),
        title: title,
        completed: false
      };
      
      subtasks.push(newSubtask);

      // Recalculate progress
      const progress = Math.round((subtasks.filter(s => s.completed).length / subtasks.length) * 100);

      const systemMsg = `${userProfile.full_name} додав підзавдання: "${title}"`;
      const comments = [...(currentTask.comments || []), {
        id: crypto.randomUUID(),
        author: 'Система',
        role: 'system',
        text: systemMsg,
        timestamp: new Date().toISOString(),
        type: 'system'
      }];

      input.value = '';

      const { error } = await sb
        .from('assigned_tasks')
        .update({ subtasks, progress, comments })
        .eq('id', taskId);

      if (error) {
        alert("Помилка при додаванні підзавдання: " + error.message);
      } else {
        await loadTaskDetails();
      }
    });
  }

  // 2. Argument Submit Form (Planning / Rejection)
  const argForm = document.getElementById('task-argument-form');
  const cancelArgBtn = document.getElementById('btn-cancel-argument');
  if (argForm) {
    argForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = document.getElementById('argument-form-card').dataset.type;
      const text = document.getElementById('argument-input').value.trim();
      if (!text) return;

      let updatePayload = {};
      let systemMsg = '';

      if (type === 'planning') {
        updatePayload = {
          status: 'planning',
          plan_details: text
        };
        systemMsg = `${userProfile.full_name} запропонував план виконання: "${text}"`;
      } else if (type === 'rejected') {
        updatePayload = {
          status: 'rejected',
          rejection_reason: text
        };
        systemMsg = `${userProfile.full_name} відхилив доручення з причини: "${text}"`;
      }

      // Add to comments
      const comments = [...(currentTask.comments || []), {
        id: crypto.randomUUID(),
        author: 'Система',
        role: 'system',
        text: systemMsg,
        timestamp: new Date().toISOString(),
        type: 'system'
      }];
      updatePayload.comments = comments;

      const submitBtn = document.getElementById('btn-submit-argument');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Збереження...';
      }

      const { error } = await sb
        .from('assigned_tasks')
        .update(updatePayload)
        .eq('id', taskId);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Підтвердити';
      }

      if (error) {
        alert("Помилка збереження: " + error.message);
      } else {
        document.getElementById('argument-input').value = '';
        hideArgumentForm();
        await loadTaskDetails();
      }
    });
  }

  if (cancelArgBtn) {
    cancelArgBtn.addEventListener('click', () => {
      document.getElementById('argument-input').value = '';
      hideArgumentForm();
    });
  }

  // 3. Comments Add Form
  const commentForm = document.getElementById('add-comment-form');
  if (commentForm) {
    commentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('comment-text-input');
      const text = input?.value.trim();
      if (!text) return;

      const comments = [...(currentTask.comments || []), {
        id: crypto.randomUUID(),
        author: userProfile.full_name,
        role: userProfile.role,
        text: text,
        timestamp: new Date().toISOString(),
        type: 'comment'
      }];

      input.value = '';

      const { error } = await sb
        .from('assigned_tasks')
        .update({ comments })
        .eq('id', taskId);

      if (error) {
        alert("Помилка надсилання коментаря: " + error.message);
      } else {
        await loadTaskDetails();
      }
    });
  }

  // 4. Time Log Form (SKOD Logging)
  const skodForm = document.getElementById('quick-skod-form');
  if (skodForm) {
    // Set default start time to current time HH:MM
    const timeInput = document.getElementById('log_start_time');
    if (timeInput) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      timeInput.value = `${hh}:${mm}`;
    }

    skodForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const startTime = document.getElementById('log_start_time').value;
      const duration = parseInt(document.getElementById('log_duration').value, 10);
      const severity = document.getElementById('log_severity').value;
      const desc = document.getElementById('log_desc').value.trim();

      const submitBtn = skodForm.querySelector('button[type="submit"]');

      if (!startTime || !duration || !severity || !desc) {
        alert("Заповніть усі обов'язкові поля для внесення роботи.");
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Внесення...';
      }

      const coef = COEFFICIENTS[severity] || 1.3;
      const score = parseFloat(((duration / 60) * coef).toFixed(2));

      // 1. Insert into skod_logs
      const logData = {
        user_id: currentUser.id,
        user_name: userProfile.full_name,
        department: userProfile.Section || userProfile.department || 'Департамент стратегії НСЗУ',
        log_date: new Date().toISOString().split('T')[0],
        start_time: startTime + ':00',
        duration_minutes: duration,
        branch: 'department',
        task_type: 'Доручення',
        category: 'Виконання доручення',
        severity_level: severity,
        complexity_coefficient: coef,
        score: score,
        status: 'completed',
        description: `Робота над дорученням: ${currentTask.title} — ${desc}`,
        assigned_task_id: taskId
      };

      const { error: logErr } = await sb.from('skod_logs').insert([logData]);

      if (logErr) {
        alert("Помилка збереження запису СКО-Д: " + logErr.message);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Внести роботу';
        }
        return;
      }

      // 2. Automatically update task status to in_progress if it was just assigned
      let statusUpdate = {};
      if (currentTask.status === 'assigned') {
        const systemMsg = `${userProfile.full_name} розпочав роботу над завданням (внесено робочий час в СКО-Д)`;
        const comments = [...(currentTask.comments || []), {
          id: crypto.randomUUID(),
          author: 'Система',
          role: 'system',
          text: systemMsg,
          timestamp: new Date().toISOString(),
          type: 'system'
        }];
        
        statusUpdate = {
          status: 'in_progress',
          progress: currentTask.progress === 0 ? 10 : currentTask.progress,
          comments
        };
      } else {
        const systemMsg = `${userProfile.full_name} вніс запис роботи у СКО-Д: "${desc}" (${duration} хв, бали: ${score})`;
        const comments = [...(currentTask.comments || []), {
          id: crypto.randomUUID(),
          author: 'Система',
          role: 'system',
          text: systemMsg,
          timestamp: new Date().toISOString(),
          type: 'system'
        }];
        statusUpdate = { comments };
      }

      const { error: taskErr } = await sb
        .from('assigned_tasks')
        .update(statusUpdate)
        .eq('id', taskId);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Внести роботу';
      }

      if (taskErr) {
        console.error("Task update error after time log:", taskErr);
      }

      // Reset form desc
      document.getElementById('log_desc').value = '';
      document.getElementById('log_duration').value = '';

      // Reload log and details
      await loadTaskDetails();
    });
  }
}
