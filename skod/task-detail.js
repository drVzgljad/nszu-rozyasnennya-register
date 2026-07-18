import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// State variables
let currentUser = null;
let userProfile = null;
let currentTask = null;
let taskId = null;
let taskLogs = []; // Stores all skod logs for this task

const statusMap = {
  assigned: 'Призначено 📥',
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

  // 6. Setup Static Forms and Tab Toggles
  setupStaticForms();
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

  // Fetch skod logs for the task
  const { data: logs } = await sb
    .from('skod_logs')
    .select('*')
    .eq('assigned_task_id', taskId)
    .order('log_date', { ascending: false })
    .order('start_time', { ascending: false });

  taskLogs = logs || [];

  // Render elements
  renderTaskHeader();
  renderStatusBanner();
  renderArgumentBox();
  renderSubtasks();
  renderSkodLogsTable();
  renderComments();
  renderAttachments();
}

function renderTaskHeader() {
  const deptBadge = document.getElementById('task-dept-badge');
  const impBadge = document.getElementById('task-importance-badge');
  const titleEl = document.getElementById('task-title');
  const metaEl = document.getElementById('task-meta');
  const descEl = document.getElementById('task-description');

  if (deptBadge) deptBadge.textContent = currentTask.department;
  
  if (impBadge) {
    const imp = currentTask.importance || 'normal';
    const labels = {
      normal: '🟢 Звичайна',
      important: '🟡 Важлива',
      critical: '🔴 Термінова'
    };
    impBadge.textContent = labels[imp] || 'Звичайна';
    impBadge.className = `badge-importance ${imp}`;
    impBadge.style.display = 'inline-block';
  }
  
  if (titleEl) titleEl.textContent = currentTask.title;
  
  if (metaEl) {
    const createdDate = new Date(currentTask.created_at).toLocaleDateString('uk-UA');
    const deadlineDate = new Date(currentTask.deadline).toLocaleDateString('uk-UA');
    
    let taskTypeHtml = '';
    if (currentTask.task_type === 'askod') {
      taskTypeHtml = `💻 АСКОД (Лист № ${currentTask.askod_number || '—'} від ${currentTask.askod_sender || '—'})`;
    } else {
      taskTypeHtml = `📌 Поточне завдання`;
    }
    
    let deadlineOrOngoingHtml = '';
    if (currentTask.is_ongoing) {
      deadlineOrOngoingHtml = `&bull; <strong>Обов'язок:</strong> <span style="font-weight: 700; color: var(--accent-deep);">Постійний посадовий</span>`;
    } else {
      deadlineOrOngoingHtml = `&bull; <strong>Термін виконання:</strong> <span style="font-weight: 700; color: var(--accent-deep);">${deadlineDate}</span>`;
    }

    metaEl.innerHTML = `
      <strong>Надав:</strong> ${currentTask.created_by_name} (${createdDate}) &bull; 
      <strong>Виконавець:</strong> ${currentTask.responsible_name || 'Не призначено'} &bull; 
      <strong>Тип:</strong> ${taskTypeHtml}
      ${deadlineOrOngoingHtml}
    `;
  }

  const progressRightPanel = document.querySelector('#task-header-card > div > div:last-child');
  if (progressRightPanel) {
    if (currentTask.is_ongoing) {
      progressRightPanel.innerHTML = `
        <div style="font-size: 12px; color: var(--p-muted); font-weight: 700; text-transform: uppercase;">Тип доручення</div>
        <div style="margin-top: 6px;">
          <span class="badge-status ongoing" style="background: var(--accent-soft, rgba(74, 143, 199, 0.15)); color: var(--accent-deep, #2f6b9e); font-size: 12.5px; padding: 6px 12px; font-weight: 700; border-radius: 8px; display: inline-block;">🔄 Посадовий обов'язок</span>
        </div>
      `;
    } else {
      progressRightPanel.innerHTML = `
        <div style="font-size: 12px; color: var(--p-muted); font-weight: 700; text-transform: uppercase;">Прогрес виконання</div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 6px;">
          <div class="table-progress-bar-container" style="width: 120px; height: 12px; margin:0;">
            <div class="table-progress-bar" id="task-progress-bar" style="width: ${currentTask.progress}%;"></div>
          </div>
          <span id="task-progress-val" style="font-size: 16px; font-weight: 800; color: var(--accent-deep);">${currentTask.progress}%</span>
        </div>
      `;
    }
  }

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

  // Render control buttons based on current status (no planning status!)
  if (currentTask.status === 'assigned') {
    actions.innerHTML = `
      <button class="btn btn-primary btn-status-action" data-status="in_progress" style="background:#22c55e; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer;">Розпочати виконання ⚡</button>
      <button class="btn btn-status-action-form" data-type="rejected" style="background:#ef4444; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer;">Відхилити ❌</button>
    `;
  } else if (currentTask.status === 'in_progress') {
    const completeBtnLabel = currentTask.is_ongoing 
      ? 'Завершити виконання обов\'язків (закрити період) ⏹️' 
      : 'Остаточне виконання (Завершити) ⏹️';
    actions.innerHTML = `
      <button class="btn btn-primary btn-status-action" data-status="completed" style="background:#22c55e; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer;">${completeBtnLabel}</button>
      <button class="btn btn-status-action-form" data-type="rejected" style="background:#ef4444; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer;">Відмовитись ❌</button>
    `;
  } else if (['rejected', 'completed'].includes(currentTask.status)) {
    actions.innerHTML = `
      <button class="btn btn-status-action" data-status="in_progress" style="background:#3b82f6; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer;">Повернути в роботу ⚡</button>
    `;
  }

  // Attach event listeners
  actions.querySelectorAll('.btn-status-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const newStatus = e.target.dataset.status;
      if (newStatus === 'completed') {
        showCompletionTimeForm();
      } else {
        await updateTaskStatus(newStatus);
      }
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
    progress = currentTask.progress === 0 ? 10 : currentTask.progress;
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

  if (type === 'rejected') {
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

  if (currentTask.status === 'rejected' && currentTask.rejection_reason) {
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

  // Determine permissions
  const canUpdate = currentTask.responsible_id === currentUser.id || 
                    currentTask.created_by === currentUser.id ||
                    ['admin', 'director', 'deputy_director', 'manager'].includes(userProfile.role);

  // Setup actions header for ongoing task reset button
  let actionsHeader = document.getElementById('subtasks-actions-header');
  if (!actionsHeader) {
    actionsHeader = document.createElement('div');
    actionsHeader.id = 'subtasks-actions-header';
    container.parentNode.insertBefore(actionsHeader, container);
  }
  actionsHeader.innerHTML = '';

  if (currentTask.is_ongoing && subtasks.length > 0 && canUpdate) {
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn';
    resetBtn.style.cssText = 'padding: 6px 12px; font-size: 12.5px; background: var(--p-soft); border: 1px solid var(--p-line); border-radius: 6px; cursor: pointer; font-weight: 700; color: var(--p-ink); margin-bottom: 12px; display: inline-flex; align-items: center; gap: 4px;';
    resetBtn.innerHTML = '🔄 Почати новий цикл (скинути чек-лист)';
    resetBtn.addEventListener('click', async () => {
      if (confirm("Ви дійсно хочете скинути статус усіх підзавдань для початку нового циклу виконання посадових обов'язків?")) {
        const updatedSubtasks = subtasks.map(s => ({ ...s, completed: false }));
        
        const systemMsg = `${userProfile.full_name} скинув чек-лист для нового циклу роботи`;
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
          .update({ subtasks: updatedSubtasks, progress: 0, comments })
          .eq('id', taskId);

        if (error) {
          alert("Помилка при скиданні чек-листа: " + error.message);
        } else {
          await loadTaskDetails();
        }
      }
    });
    actionsHeader.appendChild(resetBtn);
  }

  container.innerHTML = '';

  if (subtasks.length === 0) {
    container.innerHTML = `<div style="font-size:13.5px; color: var(--p-muted); font-style:italic; padding: 8px 0;">Підзавдання не додано. Чек-лист є планом виконання доручення.</div>`;
    return;
  }

  subtasks.forEach(sub => {
    // Check if this subtask has logs associated with it
    const subLogs = taskLogs.filter(log => log.subtask_id === sub.id);
    const hasLogs = subLogs.length > 0;

    const wrapper = document.createElement('div');
    wrapper.className = `subtask-wrapper ${hasLogs ? 'has-logs' : ''}`;
    wrapper.id = `wrapper-${sub.id}`;

    // Generate logged hours html
    let logsHtml = '';
    if (hasLogs) {
      logsHtml = `
        <div class="subtask-logs-area">
          <div style="font-weight: 700; font-size: 11px; color: var(--p-muted); margin-bottom: 4px; text-transform: uppercase;">Витрачений час:</div>
          ${subLogs.map(l => {
            const dateStr = new Date(l.log_date).toLocaleDateString('uk-UA');
            return `
              <div class="subtask-log-line">
                <span>⏱️ <strong>${l.duration_minutes} хв</strong> — ${l.description}</span>
                <span style="font-size: 11px; color: var(--p-muted); font-weight:600;">${l.user_name} (${dateStr})</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    wrapper.innerHTML = `
      <div class="checklist-item ${sub.completed ? 'checked' : ''}">
        <input type="checkbox" data-id="${sub.id}" ${sub.completed ? 'checked' : ''} ${!canUpdate ? 'disabled' : ''}>
        <span style="font-size: 14px; font-weight: 600; color: var(--p-ink);">${sub.title}</span>
        <div class="subtask-actions">
          ${canUpdate ? `
            <button class="btn-subtask-log-trigger" data-id="${sub.id}">
              ⏱️ Внести час
            </button>
            <button class="btn-delete-subtask" data-id="${sub.id}" title="Видалити">&times;</button>
          ` : ''}
        </div>
      </div>
      
      <!-- Time Log Area -->
      ${logsHtml}

      <!-- Inline Log Form (hidden initially) -->
      <form class="inline-log-form" id="form-${sub.id}" style="display: none;" data-subtask-id="${sub.id}">
        <div style="flex: 1; min-width: 110px; display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size:11px; font-weight:700; color:var(--p-muted);">Тривалість (хв) *</label>
          <input type="number" class="log-dur" placeholder="хв" min="5" max="480" required>
        </div>
        <div style="flex: 1; min-width: 100px; display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size:11px; font-weight:700; color:var(--p-muted);">Час початку *</label>
          <input type="time" class="log-start" required>
        </div>
        <div style="flex: 2; min-width: 200px; display: flex; flex-direction: column; gap: 4px;">
          <label style="font-size:11px; font-weight:700; color:var(--p-muted);">Опис виконаної роботи (необов'язково)</label>
          <input type="text" class="log-desc" placeholder="Залиште порожнім, щоб використати назву підзавдання...">
        </div>
        
        <!-- ASKOD fields for subtask log -->
        <div style="width: 100%; display: flex; align-items: center; gap: 8px; margin-top: 8px;">
          <input type="checkbox" class="sub-is-askod" id="askod-check-${sub.id}" style="width:16px; height:16px; cursor:pointer;">
          <label for="askod-check-${sub.id}" style="font-size:12px; font-weight:600; cursor:pointer; color:var(--p-ink); margin:0;">💻 Робота в АСКОД</label>
        </div>
        <div class="sub-askod-fields" id="askod-fields-${sub.id}" style="display:none; width: 100%; gap: 12px; margin-top: 8px; border-left: 3px solid var(--accent); padding-left: 8px; box-sizing: border-box;">
          <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
            <label style="font-size:10px; font-weight:700; color:var(--p-muted);">Вхідний реєстраційний № *</label>
            <input type="text" class="sub-askod-in" placeholder="напр., 1234/12-26" style="padding:6px 10px; border-radius:6px; border:1px solid var(--p-line); font-size:12px; background: var(--p-surface); width:100%; box-sizing: border-box;">
          </div>
          <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
            <label style="font-size:10px; font-weight:700; color:var(--p-muted);">Реєстраційний № відповіді *</label>
            <input type="text" class="sub-askod-out" placeholder="напр., 5678/12-26" style="padding:6px 10px; border-radius:6px; border:1px solid var(--p-line); font-size:12px; background: var(--p-surface); width:100%; box-sizing: border-box;">
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 12px; width: 100%; justify-content: flex-end;">
          <button type="submit" class="btn btn-primary" style="padding: 6px 12px; font-size:12px;">Зберегти</button>
          <button type="button" class="btn btn-cancel-inline" data-id="${sub.id}" style="padding: 6px 12px; font-size:12px; background:#e2e8f0; color:#475569; border:none; border-radius:6px; cursor:pointer;">Скасувати</button>
        </div>
      </form>
    `;

    container.appendChild(wrapper);
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

  // Attach Inline Log Trigger listeners
  container.querySelectorAll('.btn-subtask-log-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const subId = e.target.dataset.id;
      const form = document.getElementById(`form-${subId}`);
      const wrapper = document.getElementById(`wrapper-${subId}`);
      if (!form) return;

      const isHidden = form.style.display === 'none';
      form.style.display = isHidden ? 'flex' : 'none';
      if (wrapper) {
        if (isHidden) {
          wrapper.classList.add('form-open');
          // Pre-populate time input with current time
          const now = new Date();
          const hh = String(now.getHours()).padStart(2, '0');
          const mm = String(now.getMinutes()).padStart(2, '0');
          form.querySelector('.log-start').value = `${hh}:${mm}`;

          // Pre-fill ASKOD checkbox and askod number if parent task is askod
          if (currentTask && currentTask.task_type === 'askod') {
            const askodCheck = form.querySelector('.sub-is-askod');
            const askodFieldsDiv = document.getElementById(`askod-fields-${subId}`);
            const askodIn = askodFieldsDiv?.querySelector('.sub-askod-in');
            const askodOut = askodFieldsDiv?.querySelector('.sub-askod-out');
            
            if (askodCheck) askodCheck.checked = true;
            if (askodFieldsDiv) {
              askodFieldsDiv.style.display = 'flex';
              if (askodIn) {
                askodIn.required = true;
                if (currentTask.askod_number) {
                  askodIn.value = currentTask.askod_number;
                }
              }
              if (askodOut) askodOut.required = true;
            }
          }
        } else {
          wrapper.classList.remove('form-open');
        }
      }
    });
  });

  // Attach Inline Cancel Button listeners
  container.querySelectorAll('.btn-cancel-inline').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const subId = e.target.dataset.id;
      const form = document.getElementById(`form-${subId}`);
      const wrapper = document.getElementById(`wrapper-${subId}`);
      if (form) form.style.display = 'none';
      if (wrapper) wrapper.classList.remove('form-open');
    });
  });

  // Attach ASKOD checkbox toggles for subtasks
  container.querySelectorAll('.sub-is-askod').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const subId = e.target.id.replace('askod-check-', '');
      const fieldsDiv = document.getElementById(`askod-fields-${subId}`);
      const inInput = fieldsDiv?.querySelector('.sub-askod-in');
      const outInput = fieldsDiv?.querySelector('.sub-askod-out');
      if (fieldsDiv) {
        if (e.target.checked) {
          fieldsDiv.style.display = 'flex';
          if (inInput) inInput.required = true;
          if (outInput) outInput.required = true;
        } else {
          fieldsDiv.style.display = 'none';
          if (inInput) {
            inInput.required = false;
            inInput.value = '';
          }
          if (outInput) {
            outInput.required = false;
            outInput.value = '';
          }
        }
      }
    });
  });

  // Attach Inline Log Submit handlers
  container.querySelectorAll('.inline-log-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const subId = e.target.dataset.subtaskId;
      const duration = parseInt(form.querySelector('.log-dur').value, 10);
      const startTime = form.querySelector('.log-start').value;
      const descInput = form.querySelector('.log-desc').value.trim();

      const isAskod = form.querySelector('.sub-is-askod')?.checked || false;
      let askodRegNum = null;
      if (isAskod) {
        const askodIn = form.querySelector('.sub-askod-in')?.value.trim();
        const askodOut = form.querySelector('.sub-askod-out')?.value.trim();
        if (askodIn && askodOut) {
          askodRegNum = `Вх. № ${askodIn}, Вих. № ${askodOut}`;
        }
      }

      const sub = subtasks.find(s => s.id === subId);
      const logDesc = descInput || `Виконання підзавдання: ${sub.title}`;

      await saveSubtaskTimeLog(subId, duration, startTime, logDesc, isAskod, askodRegNum);
    });
  });
}

async function saveSubtaskTimeLog(subId, duration, startTime, logDesc, isAskod = false, askodRegNum = null) {
  // Save log with standard 1.0 easy complexity
  const coef = 1.0;
  const score = parseFloat(((duration / 60) * coef).toFixed(2));

  // 1. Insert into skod_logs
  const logData = {
    user_id: currentUser.id,
    user_name: userProfile.full_name,
    department: userProfile.Section || userProfile.department || 'Департамент стратегії НСЗУ',
    log_date: new Date().toISOString().split('T')[0],
    start_time: startTime + ':00',
    duration_minutes: duration,
    branch: isAskod ? 'askod' : 'tasks',
    task_type: isAskod ? 'Робота в АСКОД' : 'Доручення',
    category: isAskod ? 'Опрацювання документа' : 'Виконання доручення',
    severity_level: 'easy',
    complexity_coefficient: coef,
    score: score,
    status: 'completed',
    description: logDesc,
    assigned_task_id: taskId,
    subtask_id: subId,
    askod_reg_number: askodRegNum
  };

  const { error: logErr } = await sb.from('skod_logs').insert([logData]);

  if (logErr) {
    alert("Помилка збереження запису СКО-Д: " + logErr.message);
    return;
  }

  // 2. Automatically update status to in_progress if it was assigned
  let statusUpdate = {};
  if (currentTask.status === 'assigned') {
    const systemMsg = `${userProfile.full_name} розпочав роботу над підзавданням (внесено робочий час в СКО-Д)`;
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
    const systemMsg = `${userProfile.full_name} вніс запис роботи у СКО-Д: "${logDesc}" (${duration} хв, бали: ${score})`;
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

  if (taskErr) {
    console.error("Task status update error after subtask log:", taskErr);
  }

  // Reload everything
  await loadTaskDetails();
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

function renderSkodLogsTable() {
  const tbody = document.getElementById('task-logs-body');
  const empty = document.getElementById('task-logs-empty');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (taskLogs.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';

  taskLogs.forEach(log => {
    const tr = document.createElement('tr');
    const formattedDate = new Date(log.log_date).toLocaleDateString('uk-UA');
    const scoreVal = log.score ? log.score.toFixed(2) : '0.00';

    // Find linked subtask title if it exists
    let subtaskTitle = '<span style="color:var(--p-muted); font-style:italic;">Загальна діяльність</span>';
    if (log.subtask_id && currentTask.subtasks) {
      const sub = currentTask.subtasks.find(s => s.id === log.subtask_id);
      if (sub) {
        subtaskTitle = `<strong>${sub.title}</strong>`;
      }
    }

    tr.innerHTML = `
      <td style="font-size:12px;">
        <div>${formattedDate}</div>
        <div style="color:var(--p-muted); margin-top:2px;">${log.start_time.slice(0, 5)}</div>
      </td>
      <td style="font-weight:600; font-size:12.5px;">${log.user_name}</td>
      <td style="font-size:12.5px; line-height:1.3;">${subtaskTitle}</td>
      <td>
        <div style="font-size:13px; font-weight:500;">${log.description}</div>
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

function renderAttachments() {
  const container = document.getElementById('attachments-list');
  if (!container) return;

  const attachments = currentTask.attachments || [];
  container.innerHTML = '';

  if (attachments.length === 0) {
    container.innerHTML = `<div style="font-size:13px; color:var(--p-muted); font-style:italic; padding: 10px 0; text-align:center;">Файли та посилання не додано. Ви можете завантажити результати виконання сюди.</div>`;
    return;
  }

  const canDelete = currentTask.responsible_id === currentUser.id || 
                    currentTask.created_by === currentUser.id ||
                    ['admin', 'director', 'deputy_director', 'manager'].includes(userProfile.role);

  attachments.forEach(att => {
    const item = document.createElement('div');
    item.className = 'attachment-item';
    
    const icon = att.type === 'file' ? '📄' : '🔗';
    const dateStr = new Date(att.uploaded_at).toLocaleDateString('uk-UA');

    item.innerHTML = `
      <div class="attachment-info">
        <span style="font-size: 20px;">${icon}</span>
        <div>
          <a href="${att.url}" target="_blank" style="font-weight: 700; color: var(--accent); text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${att.name}</a>
          <div style="font-size:11px; color:var(--p-muted); margin-top:2px;">Додав: ${att.uploaded_by} (${dateStr})</div>
        </div>
      </div>
      ${canDelete ? `<button class="btn-delete-attachment" data-id="${att.id}">&times;</button>` : ''}
    `;
    container.appendChild(item);
  });

  // Attach delete handlers
  container.querySelectorAll('.btn-delete-attachment').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (confirm("Ви дійсно хочете видалити цей долучений матеріал?")) {
        await deleteAttachment(id);
      }
    });
  });
}

async function deleteAttachment(id) {
  let attachments = currentTask.attachments || [];
  const att = attachments.find(a => a.id === id);
  if (!att) return;

  attachments = attachments.filter(a => a.id !== id);

  const systemMsg = `${userProfile.full_name} видалив матеріал: "${att.name}"`;
  const comments = [...(currentTask.comments || []), {
    id: crypto.randomUUID(),
    author: 'Система',
    role: 'system',
    text: systemMsg,
    timestamp: new Date().toISOString(),
    type: 'system'
  }];

  // If it was a file, we could try deleting it from Supabase storage if we stored path
  if (att.type === 'file' && att.path) {
    try {
      await sb.storage.from('task-attachments').remove([att.path]);
    } catch(err) {
      console.error("Storage delete error:", err);
    }
  }

  const { error } = await sb
    .from('assigned_tasks')
    .update({ attachments, comments })
    .eq('id', taskId);

  if (error) {
    alert("Помилка видалення: " + error.message);
  } else {
    await loadTaskDetails();
  }
}

function showCompletionTimeForm() {
  const formCard = document.getElementById('completion-time-form-card');
  if (!formCard) return;

  formCard.style.display = 'block';
  formCard.scrollIntoView({ behavior: 'smooth' });

  // Pre-populate start time with current time
  const startTimeInput = document.getElementById('completion-start-time');
  if (startTimeInput) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    startTimeInput.value = `${hh}:${mm}`;
  }

  // Pre-populate description with task title
  const descInput = document.getElementById('completion-description');
  if (descInput && currentTask) {
    descInput.value = `Виконано доручення: ${currentTask.title}`;
  }

  // Auto pre-fill ASKOD fields for main completion form
  const isAskodCheckbox = document.getElementById('completion-is-askod');
  const askodFields = document.getElementById('completion-askod-fields');
  const askodInInput = document.getElementById('completion-askod-in');
  
  if (currentTask && currentTask.task_type === 'askod') {
    if (isAskodCheckbox) isAskodCheckbox.checked = true;
    if (askodFields) askodFields.style.display = 'flex';
    if (askodInInput && currentTask.askod_number) {
      askodInInput.value = currentTask.askod_number;
    }
  }
}

function hideCompletionTimeForm() {
  const formCard = document.getElementById('completion-time-form-card');
  if (formCard) formCard.style.display = 'none';
}

function setupStaticForms() {
  // 1. Add Subtask
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

  // Completion Time Form ASKOD Toggle
  const complIsAskod = document.getElementById('completion-is-askod');
  const complAskodFields = document.getElementById('completion-askod-fields');
  const complAskodIn = document.getElementById('completion-askod-in');
  const complAskodOut = document.getElementById('completion-askod-out');
  if (complIsAskod && complAskodFields) {
    complIsAskod.addEventListener('change', (e) => {
      if (e.target.checked) {
        complAskodFields.style.display = 'flex';
        if (complAskodIn) complAskodIn.required = true;
        if (complAskodOut) complAskodOut.required = true;
      } else {
        complAskodFields.style.display = 'none';
        if (complAskodIn) {
          complAskodIn.required = false;
          complAskodIn.value = '';
        }
        if (complAskodOut) {
          complAskodOut.required = false;
          complAskodOut.value = '';
        }
      }
    });
  }

  // Completion Time Form Submit
  const completionForm = document.getElementById('task-completion-time-form');
  if (completionForm) {
    completionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const startTime = document.getElementById('completion-start-time').value;
      const duration = parseInt(document.getElementById('completion-duration').value, 10);
      const desc = document.getElementById('completion-description').value.trim();

      const isAskod = document.getElementById('completion-is-askod')?.checked || false;
      let askodRegNum = null;
      if (isAskod) {
        const askodIn = document.getElementById('completion-askod-in')?.value.trim();
        const askodOut = document.getElementById('completion-askod-out')?.value.trim();
        if (askodIn && askodOut) {
          askodRegNum = `Вх. № ${askodIn}, Вих. № ${askodOut}`;
        }
      }

      const submitBtn = completionForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Збереження...';
      }

      // Severity + coefficient synced with the cabinet «Внести виконану роботу» form
      const SEVERITY_COEFFICIENTS = { easy: 1.0, medium: 1.3, hard: 1.8, expert: 2.5 };
      const severity = document.getElementById('completion-severity')?.value || 'easy';
      const coef = SEVERITY_COEFFICIENTS[severity] || 1.0;
      const score = parseFloat(((duration / 60) * coef).toFixed(2));

      // Insert into skod_logs (task_type/category — same values as the cabinet form writes)
      const logData = {
        user_id: currentUser.id,
        user_name: userProfile.full_name,
        department: userProfile.Section || userProfile.department || 'Департамент стратегії НСЗУ',
        log_date: new Date().toISOString().split('T')[0],
        start_time: startTime + ':00',
        duration_minutes: duration,
        branch: isAskod ? 'askod' : 'tasks',
        task_type: isAskod ? 'Робота в АСКОД' : 'Доручення',
        category: isAskod ? 'Опрацювання документа' : 'Виконання доручення',
        severity_level: severity,
        complexity_coefficient: coef,
        score: score,
        status: 'completed',
        description: desc,
        assigned_task_id: taskId,
        askod_reg_number: askodRegNum
      };

      const { error: logErr } = await sb.from('skod_logs').insert([logData]);

      if (logErr) {
        alert("Помилка збереження запису СКО-Д: " + logErr.message);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Завершити та внести в СКО-Д';
        }
        return;
      }

      // Reset Form fields
      if (complIsAskod) {
        complIsAskod.checked = false;
        if (complAskodFields) complAskodFields.style.display = 'none';
        if (complAskodIn) { complAskodIn.required = false; complAskodIn.value = ''; }
        if (complAskodOut) { complAskodOut.required = false; complAskodOut.value = ''; }
      }

      // Complete the task status
      await updateTaskStatus('completed');
      hideCompletionTimeForm();
    });
  }

  // Cancel Completion Button
  const cancelCompletionBtn = document.getElementById('btn-cancel-completion');
  if (cancelCompletionBtn) {
    cancelCompletionBtn.addEventListener('click', () => {
      hideCompletionTimeForm();
    });
  }

  // Complete without logging time button
  const completeNoTimeBtn = document.getElementById('btn-complete-no-time');
  if (completeNoTimeBtn) {
    completeNoTimeBtn.addEventListener('click', async () => {
      if (confirm("Ви дійсно хочете завершити доручення без внесення додаткового часу в СКО-Д?")) {
        await updateTaskStatus('completed');
        hideCompletionTimeForm();
      }
    });
  }

  // 2. Reject Form Submit
  const argForm = document.getElementById('task-argument-form');
  const cancelArgBtn = document.getElementById('btn-cancel-argument');
  if (argForm) {
    argForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = document.getElementById('argument-input').value.trim();
      if (!text) return;

      const comments = [...(currentTask.comments || []), {
        id: crypto.randomUUID(),
        author: 'Система',
        role: 'system',
        text: `${userProfile.full_name} відхилив виконання доручення з причини: "${text}"`,
        timestamp: new Date().toISOString(),
        type: 'system'
      }];

      const submitBtn = document.getElementById('btn-submit-argument');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Збереження...';
      }

      const { error } = await sb
        .from('assigned_tasks')
        .update({
          status: 'rejected',
          rejection_reason: text,
          comments
        })
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

  // 3. Comments Submit Form
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

  // 4. Tab toggles in Attachments
  const tabLink = document.getElementById('tab-add-link');
  const tabFile = document.getElementById('tab-add-file');
  const formLink = document.getElementById('add-link-form');
  const formFile = document.getElementById('add-file-form');

  if (tabLink && tabFile && formLink && formFile) {
    tabLink.addEventListener('click', () => {
      tabLink.style.background = 'var(--accent)';
      tabLink.style.color = '#fff';
      tabFile.style.background = '#e2e8f0';
      tabFile.style.color = '#475569';
      formLink.style.display = 'flex';
      formFile.style.display = 'none';
    });

    tabFile.addEventListener('click', () => {
      tabFile.style.background = 'var(--accent)';
      tabFile.style.color = '#fff';
      tabLink.style.background = '#e2e8f0';
      tabLink.style.color = '#475569';
      formFile.style.display = 'flex';
      formLink.style.display = 'none';
    });
  }

  // 5. Submit Attachment Link
  if (formLink) {
    formLink.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleInput = document.getElementById('link-title');
      const urlInput = document.getElementById('link-url');
      const title = titleInput.value.trim();
      const url = urlInput.value.trim();
      
      if (!title || !url) return;

      const attachments = [...(currentTask.attachments || []), {
        id: crypto.randomUUID(),
        name: title,
        url: url,
        type: 'link',
        uploaded_by: userProfile.full_name,
        uploaded_at: new Date().toISOString()
      }];

      const systemMsg = `${userProfile.full_name} додав посилання на матеріал: "${title}"`;
      const comments = [...(currentTask.comments || []), {
        id: crypto.randomUUID(),
        author: 'Система',
        role: 'system',
        text: systemMsg,
        timestamp: new Date().toISOString(),
        type: 'system'
      }];

      titleInput.value = '';
      urlInput.value = '';

      const { error } = await sb
        .from('assigned_tasks')
        .update({ attachments, comments })
        .eq('id', taskId);

      if (error) {
        alert("Помилка збереження посилання: " + error.message);
      } else {
        await loadTaskDetails();
      }
    });
  }

  // 6. Submit Attachment File
  if (formFile) {
    formFile.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('file-input');
      const file = fileInput.files?.[0];

      if (!file) {
        alert("Будь ласка, оберіть файл для завантаження.");
        return;
      }

      const submitBtn = formFile.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Завантаження...';
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const path = `${taskId}/${fileName}`;

      // Upload to Supabase Storage bucket 'task-attachments'
      const { data: uploadData, error: uploadErr } = await sb.storage
        .from('task-attachments')
        .upload(path, file);

      if (uploadErr) {
        console.error("Storage upload error:", uploadErr);
        alert("Помилка завантаження файлу. Переконайтеся, що бакет 'task-attachments' створено в Supabase, або скористайтеся додаванням посилання на Google Документ.");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Завантажити';
        }
        return;
      }

      // Get Public URL
      const { data: urlData } = sb.storage
        .from('task-attachments')
        .getPublicUrl(path);

      const fileUrl = urlData.publicUrl;

      const attachments = [...(currentTask.attachments || []), {
        id: crypto.randomUUID(),
        name: file.name,
        url: fileUrl,
        type: 'file',
        path: path,
        uploaded_by: userProfile.full_name,
        uploaded_at: new Date().toISOString()
      }];

      const systemMsg = `${userProfile.full_name} завантажив файл результату: "${file.name}"`;
      const comments = [...(currentTask.comments || []), {
        id: crypto.randomUUID(),
        author: 'Система',
        role: 'system',
        text: systemMsg,
        timestamp: new Date().toISOString(),
        type: 'system'
      }];

      fileInput.value = '';

      const { error: dbErr } = await sb
        .from('assigned_tasks')
        .update({ attachments, comments })
        .eq('id', taskId);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Завантажити';
      }

      if (dbErr) {
        alert("Помилка оновлення даних доручення: " + dbErr.message);
      } else {
        await loadTaskDetails();
      }
    });
  }
}

/* ── Вкладення з приватного бакета (підписані URL) ── */
/* att.url у attachments — старий публічний URL; після переведення бакета
   в приватний доступ іде через короткоживучий підписаний URL при відкритті. */
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
