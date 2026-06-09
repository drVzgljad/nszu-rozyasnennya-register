import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// State
let currentUser = null;
let userProfile = null;
let allUsers = [];
let allTasks = [];

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
    const card = document.getElementById('create-task-card');
    if (card) card.style.display = 'block';

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
      deptSelect.addEventListener('change', populateResponsibleSelect);
      populateResponsibleSelect();
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
          deadlineInput.disabled = false;
          deadlineInput.required = true;
        } else {
          const today = new Date();
          today.setDate(today.getDate() + 3);
          deadlineInput.value = today.toISOString().split('T')[0];
          deadlineInput.disabled = false;
          deadlineInput.required = true;
        }
      });
    }

    // Check for prefill query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const prefillTitle = urlParams.get('prefill_title');
    const prefillDesc = urlParams.get('prefill_desc');
    
    if (prefillTitle) {
      const titleInput = document.getElementById('task_title');
      if (titleInput) titleInput.value = prefillTitle;
    }
    if (prefillDesc) {
      const descInput = document.getElementById('task_description');
      if (descInput) descInput.value = prefillDesc;
    }
    
    if (prefillTitle || prefillDesc) {
      if (card) {
        card.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }
}

// Populate responsible users select dropdown based on chosen department
function populateResponsibleSelect() {
  const deptSelect = document.getElementById('task_dept');
  const respSelect = document.getElementById('task_responsible');
  if (!deptSelect || !respSelect) return;

  const selectedDept = deptSelect.value;
  
  let filteredUsers = allUsers.filter(u => (u.Section || u.department) === selectedDept);

  // Apply RBAC filters on assignees
  if (userProfile.role === 'manager') {
    // Managers can only assign to Experts in their department
    filteredUsers = filteredUsers.filter(u => u.role === 'expert');
  } else if (userProfile.role === 'deputy_director') {
    // Deputy Directors can assign to everyone except Director
    filteredUsers = filteredUsers.filter(u => u.role !== 'director');
  }

  respSelect.innerHTML = '<option value="" disabled selected>Оберіть співробітника...</option>';
  filteredUsers.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.full_name} (${u.position})`;
    respSelect.appendChild(opt);
  });
}

// Create new task in Supabase
async function createTask(e) {
  e.preventDefault();
  const title = document.getElementById('task_title')?.value.trim();
  const department = document.getElementById('task_dept')?.value;
  const responsibleSelect = document.getElementById('task_responsible');
  const responsible_id = responsibleSelect?.value;
  const deadline = document.getElementById('task_deadline')?.value;
  const description = document.getElementById('task_description')?.value.trim();
  const is_ongoing = document.getElementById('task_is_ongoing')?.checked || false;

  const submitBtn = document.getElementById('btn-submit-task');

  if (!title || !department || !responsible_id || !deadline) {
    alert("Будь ласка, заповніть усі обов'язкові поля.");
    return;
  }

  // Get employee name
  const responsible_name = responsibleSelect.options[responsibleSelect.selectedIndex].text.split(' (')[0];

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Збереження...';
  }

  const creatorName = userProfile.full_name || currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

  const taskData = {
    created_by: currentUser.id,
    created_by_name: creatorName,
    title,
    department,
    responsible_id,
    responsible_name,
    deadline,
    progress: 0,
    status: 'assigned',
    description,
    is_ongoing: is_ongoing
  };

  const { error } = await sb.from('assigned_tasks').insert([taskData]);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Надати доручення';
  }

  if (error) {
    alert("Помилка створення доручення: " + error.message);
  } else {
    // Reset Form
    document.getElementById('task_title').value = '';
    document.getElementById('task_description').value = '';
    if (responsibleSelect) responsibleSelect.selectedIndex = 0;
    
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

  const filteredTasks = allTasks.filter(t => {
    const matchDept = deptFilter === 'all' || t.department === deptFilter;
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchDept && matchStatus;
  });

  tableBody.innerHTML = '';
  if (filteredTasks.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';

    filteredTasks.forEach(task => {
      const tr = document.createElement('tr');
      
      const deadlineDate = new Date(task.deadline);
      const formattedDeadline = deadlineDate.toLocaleDateString('uk-UA');
      
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

      let deadlineVal = formattedDeadline;
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
        deadlineVal = '<span style="color:var(--p-muted); font-weight:normal;">Постійне</span>';
        progressCell = `<span style="font-size:12px; color: var(--p-muted); font-style: italic;">Посадовий обов'язок</span>`;
        statusBadge = `<span class="badge-status ongoing" style="background: var(--accent-soft, rgba(74, 143, 199, 0.15)); color: var(--accent-deep, #2f6b9e); font-weight:700;">🔄 Посадовий обов'язок</span>`;
      }

      tr.innerHTML = `
        <td>
          <div style="font-weight: 700;">
            <a href="task-detail.html?id=${task.id}" target="_blank" style="color: var(--accent, #3b82f6); text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${task.title}</a>
          </div>
          <div style="font-size:12px; color: var(--p-muted); margin-top: 4px;">Надав: ${task.created_by_name}</div>
        </td>
        <td><span style="font-size:13.5px; font-weight:600; color:var(--accent-deep);">${task.department}</span></td>
        <td>
          <div style="font-weight: 600;">${task.responsible_name || 'Не призначено'}</div>
        </td>
        <td style="font-weight: 600; font-size:13.5px;">${deadlineVal}</td>
        <td>
          ${progressCell}
        </td>
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
