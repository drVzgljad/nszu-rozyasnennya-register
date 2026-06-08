import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// State
let currentUser = null;
let userProfile = null;
let todayLogs = [];

// Coefficients
const COEFFICIENTS = {
  easy: 1.0,
  medium: 1.3,
  hard: 1.8,
  expert: 2.5
};

// Branch-specific Task Types and Categories
const BRANCH_CONFIG = {
  askod: {
    types: [
      "Лист",
      "Звернення громадян",
      "Запит на інформацію",
      "Внутрішній документ",
      "Протокол",
      "Інше (вказати в описі)"
    ],
    categories: [
      "Зміст роз'яснення ПМГ",
      "Договірні питання",
      "Надавачі медичних послуг",
      "Листи МОЗ / КМУ",
      "Звернення пацієнта",
      "Контрактування ЗОЗ",
      "Інше"
    ]
  },
  department: {
    types: [
      "Аналітична робота",
      "Підготовка нормативних та проектних документів",
      "Робота в інформаційних системах НСЗУ",
      "Участь у нарадах / робочих групах",
      "Організаційне забезпечення діяльності",
      "Інше (вказати в описі)"
    ],
    categories: [
      "Специфікації та умови закупівлі ПМГ",
      "Розрахунки тарифів та коефіцієнтів",
      "Аналітика звітів діяльності ЗОЗ",
      "Внутрішні наради Департаменту",
      "Робота з реєстрами та базами даних",
      "Розробка пропозицій до ПМГ",
      "Інше"
    ]
  },
  tasks: {
    types: [
      "Виконання доручення керівництва",
      "Аналітичний супровід завдання",
      "Підготовка відповіді / звіту",
      "Інше (вказати в описі)"
    ],
    categories: [
      "Термінове доручення",
      "Планове завдання",
      "Протокольне доручення",
      "Аналіз даних за дорученням",
      "Інше"
    ]
  }
};

// Initialize
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;

  if (!currentUser) {
    showAccessDenied("Для роботи з системою СКО-Д необхідно авторизуватися.");
    return;
  }

  // Fetch profile
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  userProfile = profile || {};

  // Setup UI elements based on page
  const formEl = document.getElementById('skod-log-form');
  if (formEl) {
    setupForm();
    loadTodayLogs();
  }

  const reportsEl = document.getElementById('skod-reports-container');
  if (reportsEl) {
    setupReports();
  }

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

// ============================================================
// Form Logic
// ============================================================
function setupForm() {
  const branchSel = document.getElementById('task_branch');
  const taskTypeContainer = document.getElementById('task_type_container');
  const taskCategoryContainer = document.getElementById('task_category_container');
  const severitySel = document.getElementById('severity_level');
  const durationInput = document.getElementById('duration_minutes');
  const durationPresetSel = document.getElementById('duration_preset');
  const durationGroup = document.getElementById('duration-group');
  const statusSel = document.getElementById('task_status');
  const scoreVal = document.getElementById('live-score-val');
  const formEl = document.getElementById('skod-log-form');

  // Populate dynamic checkboxes
  function populateTypesAndCategories() {
    const branch = branchSel?.value || 'department';
    const config = BRANCH_CONFIG[branch];

    if (taskTypeContainer) {
      const checkedTypes = Array.from(taskTypeContainer.querySelectorAll('.task-type-cb:checked')).map(cb => cb.value);
      taskTypeContainer.innerHTML = '';
      config.types.forEach(t => {
        const label = document.createElement('label');
        label.className = 'skod-checkbox-item';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = t;
        cb.className = 'task-type-cb';
        if (checkedTypes.includes(t)) {
          cb.checked = true;
        }
        cb.addEventListener('change', updateLiveScore);
        
        label.appendChild(cb);
        label.appendChild(document.createTextNode(t));
        taskTypeContainer.appendChild(label);
      });
    }
    populateCategories();
  }

  function populateCategories() {
    const branch = branchSel?.value || 'department';
    const config = BRANCH_CONFIG[branch];
    if (taskCategoryContainer) {
      const checkedCategories = Array.from(taskCategoryContainer.querySelectorAll('.task-category-cb:checked')).map(cb => cb.value);
      taskCategoryContainer.innerHTML = '';
      config.categories.forEach(c => {
        const label = document.createElement('label');
        label.className = 'skod-checkbox-item';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = c;
        cb.className = 'task-category-cb';
        if (checkedCategories.includes(c)) {
          cb.checked = true;
        }
        
        label.appendChild(cb);
        label.appendChild(document.createTextNode(c));
        taskCategoryContainer.appendChild(label);
      });
    }
  }

  if (branchSel) {
    branchSel.addEventListener('change', () => {
      populateTypesAndCategories();
      
      const taskLinkGroup = document.getElementById('form-assigned-task-group');
      const taskLinkSel = document.getElementById('link_assigned_task');
      const askodRegGroup = document.getElementById('form-askod-reg-group');
      const askodRegInput = document.getElementById('askod_reg_number');
      
      // Toggle ASKOD registration group visibility & validation
      if (branchSel.value === 'askod') {
        if (askodRegGroup) askodRegGroup.style.display = 'block';
        if (askodRegInput) askodRegInput.required = true;
      } else {
        if (askodRegGroup) askodRegGroup.style.display = 'none';
        if (askodRegInput) {
          askodRegInput.required = false;
          askodRegInput.value = '';
        }
      }
      
      if (branchSel.value === 'tasks') {
        if (taskLinkGroup) {
          taskLinkGroup.style.display = 'block';
          const label = taskLinkGroup.querySelector('label');
          if (label) label.innerHTML = 'Оберіть доручення *';
        }
        if (taskLinkSel) {
          taskLinkSel.required = true;
        }
      } else {
        const hasTasks = taskLinkSel && taskLinkSel.options.length > 1;
        if (taskLinkGroup) {
          taskLinkGroup.style.display = hasTasks ? 'block' : 'none';
          const label = taskLinkGroup.querySelector('label');
          if (label) label.innerHTML = 'Пов\'язати з дорученням (опціонально)';
        }
        if (taskLinkSel) {
          taskLinkSel.required = false;
        }
      }
    });
  }

  // Populate initially
  populateTypesAndCategories();

  // Handle status toggle
  if (statusSel) {
    statusSel.addEventListener('change', () => {
      const isProgress = statusSel.value === 'in_progress';
      if (durationGroup) {
        durationGroup.style.display = isProgress ? 'none' : 'block';
      }
      if (durationInput) {
        durationInput.required = !isProgress;
        if (isProgress) durationInput.value = '';
      }
      if (durationPresetSel) {
        durationPresetSel.required = !isProgress;
      }
      updateLiveScore();
    });
  }

  // Handle duration preset selection
  if (durationPresetSel && durationInput) {
    durationPresetSel.addEventListener('change', () => {
      if (durationPresetSel.value === 'custom') {
        durationInput.style.display = 'block';
        durationInput.value = '';
        durationInput.focus();
      } else {
        durationInput.style.display = 'none';
        durationInput.value = durationPresetSel.value;
      }
      updateLiveScore();
    });
    
    // Set initial sync
    durationInput.value = durationPresetSel.value;
  }

  // Update live score
  function updateLiveScore() {
    const status = statusSel?.value || 'completed';
    if (status === 'in_progress') {
      if (scoreVal) scoreVal.textContent = 'Розраховується при завершенні';
      return;
    }
    const duration = parseInt(durationInput?.value || 0, 10);
    const severity = severitySel?.value || 'easy';
    const coef = COEFFICIENTS[severity];
    
    // Score = (duration / 60) * coef
    const score = ((duration / 60) * coef).toFixed(2);
    if (scoreVal) {
      scoreVal.textContent = score;
    }
  }

  if (severitySel) severitySel.addEventListener('change', updateLiveScore);
  if (durationInput) durationInput.addEventListener('input', updateLiveScore);

  // Form submission
  if (formEl) {
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = formEl.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Збереження...';
      }

      const branch = branchSel.value;
      const selectedTypes = Array.from(document.querySelectorAll('.task-type-cb:checked')).map(cb => cb.value);
      const task_type = selectedTypes.join(', ');

      const selectedCategories = Array.from(document.querySelectorAll('.task-category-cb:checked')).map(cb => cb.value);
      const category = selectedCategories.join(', ');
      
      const severity_level = severitySel.value;
      const status = statusSel.value;
      const start_time = document.getElementById('start_time').value;
      const description = document.getElementById('description').value.trim();
      const department = userProfile.Section || 'стратегічного розвитку програми медичних гарантій';
      const user_name = userProfile.full_name || currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

      if (!branch || !task_type || !category || !severity_level || !start_time || !status) {
        alert('Будь ласка, заповніть усі обов’язкові поля та оберіть хоча б один тип та категорію завдання.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Зберегти завдання';
        }
        return;
      }

      let askod_reg_number = null;
      if (branch === 'askod') {
        const askodRegInput = document.getElementById('askod_reg_number');
        askod_reg_number = askodRegInput ? askodRegInput.value.trim() : null;
        if (!askod_reg_number) {
          alert('Будь ласка, вкажіть реєстраційний номер в АСКОД.');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Зберегти завдання';
          }
          return;
        }
      }

      const assigned_task_id = document.getElementById('link_assigned_task')?.value || null;
      if (branch === 'tasks' && !assigned_task_id) {
        alert('Будь ласка, оберіть доручення, яке ви виконували.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Зберегти завдання';
        }
        return;
      }

      let duration_minutes = null;
      let score = null;
      const coef = COEFFICIENTS[severity_level];

      if (status === 'completed') {
        duration_minutes = parseInt(durationInput.value, 10);
        if (isNaN(duration_minutes) || duration_minutes <= 0) {
          alert('Будь ласка, вкажіть коректну тривалість завдання.');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Зберегти завдання';
          }
          return;
        }
        score = parseFloat(((duration_minutes / 60) * coef).toFixed(2));
      }

      const logData = {
        user_id: currentUser.id,
        user_name,
        department,
        start_time,
        duration_minutes,
        branch,
        task_type,
        category,
        severity_level,
        complexity_coefficient: coef,
        score,
        status,
        description,
        assigned_task_id: document.getElementById('link_assigned_task')?.value || null,
        askod_reg_number
      };

      const { error } = await sb.from('skod_logs').insert([logData]);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Зберегти завдання';
      }

      if (error) {
        alert('Помилка збереження: ' + error.message);
      } else {
        const delegateAfterSubmit = document.getElementById('delegate_after_submit')?.checked || false;
        if (delegateAfterSubmit) {
          let regPrefix = '';
          if (branch === 'askod' && askod_reg_number) {
            regPrefix = `АСКОД № ${askod_reg_number}: `;
          }
          const prefillTitle = `${regPrefix}${task_type}`;
          const prefillDesc = description || '';
          window.location.href = `tasks.html?prefill_title=${encodeURIComponent(prefillTitle)}&prefill_desc=${encodeURIComponent(prefillDesc)}`;
          return;
        }

        formEl.reset();
        
        // Reset defaults
        if (branchSel) branchSel.value = 'department';
        populateTypesAndCategories();
        if (statusSel) {
          statusSel.value = 'completed';
          if (durationGroup) durationGroup.style.display = 'block';
        }
        if (durationPresetSel) {
          durationPresetSel.value = '60';
        }
        if (durationInput) {
          durationInput.value = '60';
          durationInput.style.display = 'none';
        }
        const askodRegGroup = document.getElementById('form-askod-reg-group');
        const askodRegInput = document.getElementById('askod_reg_number');
        if (askodRegGroup) askodRegGroup.style.display = 'none';
        if (askodRegInput) {
          askodRegInput.required = false;
          askodRegInput.value = '';
        }
        updateLiveScore();
        
        const taskLinkSel = document.getElementById('link_assigned_task');
        if (taskLinkSel) taskLinkSel.value = '';
        
        // Set current time back to start time
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        document.getElementById('start_time').value = timeStr;
        
        loadTodayLogs();
      }
    });

    // Default start time to now
    const start_time_el = document.getElementById('start_time');
    if (start_time_el && !start_time_el.value) {
      const now = new Date();
      start_time_el.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    // Dynamic department check
    const deptDisplayVal = document.getElementById('form-dept-display-val');
    if (deptDisplayVal) {
      deptDisplayVal.textContent = userProfile.Section || 'стратегічного розвитку програми медичних гарантій';
    }

    const delegateGroup = document.getElementById('delegate-checkbox-group');
    if (delegateGroup && ['admin', 'director', 'deputy_director', 'manager'].includes(userProfile.role)) {
      delegateGroup.style.display = 'flex';
    }

    // Load active assigned tasks for linking
    loadActiveAssignedTasks();
  }
}

// Load active and completed assigned tasks for linking dropdown
async function loadActiveAssignedTasks() {
  if (!currentUser) return;
  const { data, error } = await sb
    .from('assigned_tasks')
    .select('id, title, status, is_ongoing')
    .eq('responsible_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching assigned tasks for link:", error);
    return;
  }

  const taskLinkSel = document.getElementById('link_assigned_task');
  const taskLinkGroup = document.getElementById('form-assigned-task-group');

  if (taskLinkSel && taskLinkGroup) {
    const branchSel = document.getElementById('task_branch');
    const isTasksBranch = branchSel?.value === 'tasks';
    
    if (data && data.length > 0) {
      taskLinkGroup.style.display = 'block';
      taskLinkSel.innerHTML = isTasksBranch 
        ? '<option value="" disabled selected>Оберіть доручення *</option>'
        : '<option value="" selected>Не пов\'язувати з дорученням</option>';
        
      data.forEach(task => {
        const opt = document.createElement('option');
        opt.value = task.id;
        let prefix = '';
        if (task.status === 'completed') {
          prefix = '[Виконано] ';
        } else if (task.is_ongoing) {
          prefix = '[Посадовий обов\'язок] ';
        }
        opt.textContent = `${prefix}${task.title}`;
        taskLinkSel.appendChild(opt);
      });
    } else {
      if (isTasksBranch) {
        taskLinkGroup.style.display = 'block';
        taskLinkSel.innerHTML = '<option value="" disabled selected>У вас немає призначених доручень</option>';
      } else {
        taskLinkGroup.style.display = 'none';
      }
    }
  }
}

// Complete task in progress
async function completeTask(id, logDate, startTimeStr, severityLevel, coef) {
  const now = new Date();
  
  // Combine date and time
  const [year, month, day] = logDate.split('-');
  const [hours, minutes] = startTimeStr.split(':');
  
  const startDt = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hours, 10), parseInt(minutes, 10), 0);
  
  let diffMs = now - startDt;
  if (diffMs < 0) diffMs = 0;
  
  let duration_minutes = Math.round(diffMs / 60000);
  if (duration_minutes < 1) duration_minutes = 1;
  
  const score = parseFloat(((duration_minutes / 60) * coef).toFixed(2));
  
  const { error } = await sb
    .from('skod_logs')
    .update({
      duration_minutes,
      score,
      status: 'completed'
    })
    .eq('id', id);
    
  if (error) {
    alert("Помилка завершення завдання: " + error.message);
  } else {
    loadTodayLogs();
  }
}

// Load logs
async function loadTodayLogs() {
  const tableBody = document.getElementById('today-logs-body');
  const emptyState = document.getElementById('today-logs-empty');
  const totalScoreVal = document.getElementById('stat-total-score');
  const totalHoursVal = document.getElementById('stat-total-hours');
  const totalTasksVal = document.getElementById('stat-total-tasks');

  if (!tableBody) return;

  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await sb
    .from('skod_logs')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('log_date', today)
    .order('start_time', { ascending: true });

  if (error) {
    console.error('Error fetching today logs:', error);
    return;
  }

  todayLogs = data || [];
  tableBody.innerHTML = '';

  let totalScore = 0;
  let totalMinutes = 0;

  if (todayLogs.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
  } else {
    if (emptyState) emptyState.style.display = 'none';
    
    todayLogs.forEach(log => {
      totalScore += parseFloat(log.score || 0);
      totalMinutes += log.duration_minutes || 0;

      const tr = document.createElement('tr');
      tr.id = `log-row-${log.id}`;

      // Hours format
      let durationStr = 'В процесі ⏳';
      if (log.status !== 'in_progress') {
        const hrs = Math.floor(log.duration_minutes / 60);
        const mins = log.duration_minutes % 60;
        durationStr = hrs > 0 ? `${hrs} год ${mins} хв` : `${mins} хв`;
      }

      // Severity translation
      const severityMap = { easy: 'Легкий', medium: 'Середній', hard: 'Складний', expert: 'Експерт' };
      const sevLabel = severityMap[log.severity_level] || log.severity_level;

      let branchLabel = 'Відділ';
      if (log.branch === 'askod') {
        branchLabel = `АСКОД ${log.askod_reg_number ? `№ ${log.askod_reg_number}` : ''}`;
      } else if (log.branch === 'tasks') {
        branchLabel = 'Доручення';
      }
      const categoryLabel = log.category ? ` &bull; ${log.category}` : '';

      let scoreContent = log.score ? log.score.toFixed(2) : '0.00';
      if (log.status === 'in_progress') {
        scoreContent = `<button class="btn btn-primary btn-complete-task" data-id="${log.id}" data-date="${log.log_date}" data-start="${log.start_time}" data-severity="${log.severity_level}" data-coef="${log.complexity_coefficient}" style="padding: 5px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; background: var(--accent, #4a8fc7); color: #fff; border: none; cursor: pointer;">Завершити ⏹️</button>`;
      }

      const canDelegate = ['admin', 'director', 'deputy_director', 'manager'].includes(userProfile.role);
      let delegateBtn = '';
      if (canDelegate) {
        let regPrefix = '';
        if (log.branch === 'askod' && log.askod_reg_number) {
          regPrefix = `АСКОД № ${log.askod_reg_number}: `;
        }
        const titlePrefill = encodeURIComponent(`${regPrefix}${log.task_type}`);
        const descPrefill = encodeURIComponent(log.description || '');
        delegateBtn = `<a href="tasks.html?prefill_title=${titlePrefill}&prefill_desc=${descPrefill}" class="btn-delegate-log" title="Створити доручення на основі цього запису" style="text-decoration:none; margin-right:10px; font-size:15px; opacity:0.75; transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.75'">📋</a>`;
      }

      tr.innerHTML = `
        <td style="font-weight: 700;">${log.start_time.substring(0, 5)}</td>
        <td>
          <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--p-muted); letter-spacing:0.02em; margin-bottom: 2px;">
            ${branchLabel}${categoryLabel}
          </div>
          <div style="font-weight: 600;">${log.task_type}</div>
          <div style="font-size:12px; color: var(--p-muted); margin-top: 4px;">${log.description || 'Без опису'}</div>
        </td>
        <td>${durationStr}</td>
        <td><span class="badge-task ${log.severity_level}">${sevLabel} (${log.complexity_coefficient})</span></td>
        <td style="font-weight: 800; color: var(--accent-2-deep);" class="score-cell">${scoreContent}</td>
        <td style="white-space: nowrap;">
          ${delegateBtn}
          <button class="btn-delete-log" data-id="${log.id}" title="Видалити запис">&times;</button>
        </td>
      `;

      tableBody.appendChild(tr);
    });

    // Attach delete listeners
    document.querySelectorAll('.btn-delete-log').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        if (confirm('Ви впевнені, що хочете видалити цей запис діяльності?')) {
          const { error } = await sb.from('skod_logs').delete().eq('id', id);
          if (error) {
            alert('Помилка видалення: ' + error.message);
          } else {
            loadTodayLogs();
          }
        }
      });
    });

    // Attach complete listeners
    document.querySelectorAll('.btn-complete-task').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget;
        const id = target.dataset.id;
        const logDate = target.dataset.date;
        const startTime = target.dataset.start;
        const severity = target.dataset.severity;
        const coef = parseFloat(target.dataset.coef);
        
        target.disabled = true;
        target.textContent = 'Збереження...';
        await completeTask(id, logDate, startTime, severity, coef);
      });
    });
  }

  // Update statistics widgets
  if (totalScoreVal) totalScoreVal.textContent = totalScore.toFixed(2);
  if (totalHoursVal) totalHoursVal.textContent = (totalMinutes / 60).toFixed(1) + ' год';
  if (totalTasksVal) totalTasksVal.textContent = todayLogs.length;
}

// ============================================================
// Reports Logic
// ============================================================
let chartInstances = {};
let lastLoggedData = null;

async function setupReports() {
  const startDateInput = document.getElementById('report-start-date');
  const endDateInput = document.getElementById('report-end-date');
  const filterDeptSel = document.getElementById('report-department');
  const reportLevelSel = document.getElementById('report-level');
  const btnRun = document.getElementById('btn-run-report');

  // Default dates: Today
  const todayStr = new Date().toISOString().split('T')[0];
  if (startDateInput) startDateInput.value = todayStr;
  if (endDateInput) endDateInput.value = todayStr;

  // Populate departments
  if (filterDeptSel) {
    const depts = [
      "робота з електронними медичними даними",
      "розрахунок вартості медичних послуг",
      "стратегічного розвитку програми медичних гарантій",
      "наукова та клінічна експертиза",
      "розвиток програми реімбурсації",
      "взаємодія з надавачами медичних послуг"
    ];
    filterDeptSel.innerHTML = '';
    depts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      filterDeptSel.appendChild(opt);
    });
    
    if (userProfile.Section) {
      filterDeptSel.value = userProfile.Section;
    }
  }

  // RBAC checks for filters
  const userRole = userProfile.role || 'registered';
  const isDirectorOrDeputyOrAdmin = ['admin', 'director', 'deputy_director', 'full'].includes(userRole);
  const isManager = userRole === 'manager' || userProfile.is_head === true;

  if (reportLevelSel) {
    if (isDirectorOrDeputyOrAdmin) {
      // Full access - nothing to disable
    } else if (isManager) {
      // Manager: can query personal and department, but NOT department-wide
      const allOpt = reportLevelSel.querySelector('option[value="department-wide"]');
      if (allOpt) allOpt.remove();

      // Force and lock department to their own department
      if (filterDeptSel) {
        filterDeptSel.value = userProfile.Section || userProfile.department || '';
        filterDeptSel.disabled = true;
      }
    } else {
      // Standard: only personal, hide dropdown completely
      reportLevelSel.value = 'personal';
      const levelDiv = reportLevelSel.closest('div');
      if (levelDiv) levelDiv.style.display = 'none';
      const deptGroup = document.getElementById('report-dept-group');
      if (deptGroup) deptGroup.style.display = 'none';
    }

    reportLevelSel.addEventListener('change', () => {
      const showDept = reportLevelSel.value !== 'personal';
      const deptGroup = document.getElementById('report-dept-group');
      if (deptGroup) {
        deptGroup.style.display = showDept ? 'block' : 'none';
      }
    });
  }

  // Setup presets
  const presetToday = document.getElementById('preset-today');
  const presetWeek = document.getElementById('preset-week');
  const presetMonth = document.getElementById('preset-month');

  function setActivePreset(btn) {
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  if (presetToday) {
    presetToday.addEventListener('click', () => {
      setActivePreset(presetToday);
      const today = new Date().toISOString().split('T')[0];
      if (startDateInput) startDateInput.value = today;
      if (endDateInput) endDateInput.value = today;
    });
  }

  if (presetWeek) {
    presetWeek.addEventListener('click', () => {
      setActivePreset(presetWeek);
      const today = new Date();
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(today.setDate(diff));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      
      if (startDateInput) startDateInput.value = monday.toISOString().split('T')[0];
      if (endDateInput) endDateInput.value = sunday.toISOString().split('T')[0];
    });
  }

  if (presetMonth) {
    presetMonth.addEventListener('click', () => {
      setActivePreset(presetMonth);
      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      
      if (startDateInput) startDateInput.value = firstDay.toISOString().split('T')[0];
      if (endDateInput) endDateInput.value = lastDay.toISOString().split('T')[0];
    });
  }

  if (startDateInput) {
    startDateInput.addEventListener('change', () => {
      document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    });
  }
  if (endDateInput) {
    endDateInput.addEventListener('change', () => {
      document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    });
  }

  // Mutation observer to detect theme changes and redraw charts dynamically
  const themeObserver = new MutationObserver(() => {
    if (lastLoggedData) {
      const isDarkTheme = document.body.classList.contains('dark-theme') || document.documentElement.classList.contains('dark-theme');
      drawDashboardCharts(lastLoggedData.logs, lastLoggedData.level, isDarkTheme);
    }
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  if (btnRun) {
    btnRun.addEventListener('click', runReport);
    runReport();
  }
}

async function runReport() {
  const level = document.getElementById('report-level')?.value || 'personal';
  const startDateVal = document.getElementById('report-start-date')?.value;
  const endDateVal = document.getElementById('report-end-date')?.value;
  const deptVal = document.getElementById('report-department')?.value;
  const branchVal = document.getElementById('report-branch')?.value || 'all';
  const severityVal = document.getElementById('report-severity')?.value || 'all';

  const resultsContainer = document.getElementById('report-results');
  if (!resultsContainer) return;
  resultsContainer.innerHTML = '<div class="empty-state">Завантаження аналітики...</div>';

  if (!startDateVal || !endDateVal) {
    alert('Будь ласка, оберіть період.');
    return;
  }

  let query = sb.from('skod_logs').select('*, assigned_tasks(status, is_ongoing)')
    .gte('log_date', startDateVal)
    .lte('log_date', endDateVal);

  if (level === 'personal') {
    query = query.eq('user_id', currentUser.id);
  } else if (level === 'department') {
    query = query.eq('department', deptVal);
  }

  if (branchVal !== 'all') {
    query = query.eq('branch', branchVal);
  }

  if (severityVal !== 'all') {
    query = query.eq('severity_level', severityVal);
  }

  const { data: rawLogs, error } = await query
    .order('log_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) {
    resultsContainer.innerHTML = `<div class="empty-state" style="color:red">Помилка завантаження: ${error.message}</div>`;
    return;
  }

  // Filter out logs linked to tasks that are not completed yet, except ongoing tasks
  const logs = (rawLogs || []).filter(log => {
    if (log.branch === 'tasks' && log.assigned_task_id) {
      return log.assigned_tasks && (log.assigned_tasks.status === 'completed' || log.assigned_tasks.is_ongoing);
    }
    return true;
  });

  if (!logs || logs.length === 0) {
    resultsContainer.innerHTML = '<div class="empty-state" style="background: var(--p-surface); border: 1px solid var(--p-line); border-radius: var(--pr-tile); padding: 40px;">За обраний період та фільтри записи діяльності відсутні.</div>';
    Object.values(chartInstances).forEach(c => c && c.destroy());
    chartInstances = {};
    lastLoggedData = null;
    return;
  }

  lastLoggedData = { logs, level, departmentName: deptVal, startDateVal, endDateVal };
  renderDashboard(lastLoggedData);
}

function renderDashboard(data) {
  const { logs, level, departmentName } = data;
  const resultsContainer = document.getElementById('report-results');
  if (!resultsContainer) return;

  const completedLogs = logs.filter(log => log.status === 'completed');
  const totalTasks = logs.length;
  const totalScore = completedLogs.reduce((sum, log) => sum + parseFloat(log.score || 0), 0);
  const totalMinutes = completedLogs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const avgComplexity = completedLogs.length > 0 
    ? (completedLogs.reduce((sum, log) => sum + parseFloat(log.complexity_coefficient || 1.0), 0) / completedLogs.length).toFixed(2)
    : "0.00";

  let html = `
    <div class="skod-stats-grid">
      <div class="skod-kpi-card score">
        <div class="skod-kpi-icon">⭐</div>
        <div class="skod-kpi-info">
          <span class="skod-kpi-title">Оціночні бали</span>
          <span class="skod-kpi-value">${totalScore.toFixed(2)}</span>
        </div>
      </div>
      <div class="skod-kpi-card hours">
        <div class="skod-kpi-icon">⏱️</div>
        <div class="skod-kpi-info">
          <span class="skod-kpi-title">Загальний час</span>
          <span class="skod-kpi-value">${totalHours} год</span>
        </div>
      </div>
      <div class="skod-kpi-card tasks">
        <div class="skod-kpi-icon">📋</div>
        <div class="skod-kpi-info">
          <span class="skod-kpi-title">Кількість завдань</span>
          <span class="skod-kpi-value">${totalTasks}</span>
        </div>
      </div>
      <div class="skod-kpi-card complexity">
        <div class="skod-kpi-icon">⚡</div>
        <div class="skod-kpi-info">
          <span class="skod-kpi-title">Сер. складність</span>
          <span class="skod-kpi-value">${avgComplexity}</span>
        </div>
      </div>
    </div>

    <div class="skod-dashboard-grid">
      <div class="skod-chart-card">
        <div class="skod-chart-card-title">Розподіл за напрямами (бали)</div>
        <div class="skod-chart-container">
          <canvas id="chartBranchDistribution"></canvas>
        </div>
      </div>
      <div class="skod-chart-card">
        <div class="skod-chart-card-title">Динаміка оцінки за днями</div>
        <div class="skod-chart-container">
          <canvas id="chartTimeline"></canvas>
        </div>
      </div>
      ${level !== 'personal' ? `
      <div class="skod-chart-card" id="card-leaderboard" style="grid-column: span 2;">
        <div class="skod-chart-card-title" id="leaderboard-title">Рейтинг за балами</div>
        <div class="skod-chart-container" style="height: 280px;">
          <canvas id="chartLeaderboard"></canvas>
        </div>
      </div>
      ` : ''}
    </div>

    <div class="skod-card" style="padding: 24px; border-radius: var(--pr-tile); background: var(--p-surface); border: 1px solid var(--p-line); box-shadow: var(--p-shadow-sm);">
      <div class="skod-card-title" id="details-section-title" style="margin-bottom: 20px; border-bottom: 1px solid var(--p-soft); padding-bottom: 12px;">
        Деталі звіту
      </div>
      <div id="dashboard-details-table-container"></div>
    </div>
  `;

  resultsContainer.innerHTML = html;

  const detailsContainer = document.getElementById('dashboard-details-table-container');
  if (level === 'personal') {
    renderPersonalDetails(logs, detailsContainer);
  } else if (level === 'department') {
    renderDepartmentDetails(logs, detailsContainer, departmentName);
  } else if (level === 'department-wide') {
    renderDepartmentWideDetails(logs, detailsContainer);
  }

  const isDark = document.body.classList.contains('dark-theme') || document.documentElement.classList.contains('dark-theme');
  drawDashboardCharts(logs, level, isDark);
}

function renderPersonalDetails(logs, container) {
  const trs = logs.map(log => {
    let durationStr = 'В процесі ⏳';
    if (log.status !== 'in_progress') {
      const hrs = Math.floor(log.duration_minutes / 60);
      const mins = log.duration_minutes % 60;
      durationStr = hrs > 0 ? `${hrs} год ${mins} хв` : `${mins} хв`;
    }

    let branchLabel = 'Відділ';
    if (log.branch === 'askod') {
      branchLabel = `АСКОД ${log.askod_reg_number ? `№ ${log.askod_reg_number}` : ''}`;
    } else if (log.branch === 'tasks') {
      branchLabel = 'Доручення';
    }
    const categoryLabel = log.category ? ` &bull; ${log.category}` : '';
    const scoreVal = log.status === 'in_progress' ? 'В процесі' : parseFloat(log.score || 0).toFixed(2);
    const dateFormatted = log.log_date ? log.log_date.split('-').reverse().slice(0, 2).join('.') : '';

    return `
      <tr>
        <td style="font-weight:700;">${dateFormatted} ${log.start_time.substring(0, 5)}</td>
        <td>
          <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--p-muted); letter-spacing:0.02em; margin-bottom: 2px;">
            ${branchLabel}${categoryLabel}
          </div>
          <div style="font-weight:600;">${log.task_type}</div>
          <div style="font-size:12px; color:var(--p-muted); margin-top:4px;">${log.description || ''}</div>
        </td>
        <td>${durationStr}</td>
        <td><span class="badge-task ${log.severity_level}">${log.severity_level} (${log.complexity_coefficient})</span></td>
        <td style="font-weight:800; color:var(--accent-2-deep);">${scoreVal}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="skod-table-wrapper">
      <table class="skod-table">
        <thead>
          <tr>
            <th>Дата та час</th>
            <th>Завдання</th>
            <th>Тривалість</th>
            <th>Складність</th>
            <th>Бали</th>
          </tr>
        </thead>
        <tbody>
          ${trs}
        </tbody>
      </table>
    </div>
  `;
}

function renderDepartmentDetails(logs, container, departmentName) {
  const employees = {};
  logs.forEach(log => {
    if (!employees[log.user_name]) {
      employees[log.user_name] = {
        name: log.user_name,
        tasksCount: 0,
        minutes: 0,
        score: 0
      };
    }
    employees[log.user_name].tasksCount++;
    employees[log.user_name].minutes += log.duration_minutes || 0;
    employees[log.user_name].score += parseFloat(log.score || 0);
  });

  const empRows = Object.values(employees).map(emp => {
    const hrs = (emp.minutes / 60).toFixed(1);
    const avgCoef = (emp.score / (emp.minutes / 60 || 1)).toFixed(2);
    return `
      <tr>
        <td style="font-weight:700;">${emp.name}</td>
        <td>${emp.tasksCount}</td>
        <td>${hrs} год</td>
        <td>${isNaN(avgCoef) ? '0.00' : avgCoef}</td>
        <td style="font-weight:800; color:var(--accent-2-deep);">${emp.score.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="skod-table-wrapper">
      <table class="skod-table">
        <thead>
          <tr>
            <th>Співробітник</th>
            <th>Кількість завдань</th>
            <th>Загальний час</th>
            <th>Сер. коефіцієнт</th>
            <th>Всього балів</th>
          </tr>
        </thead>
        <tbody>
          ${empRows}
        </tbody>
      </table>
    </div>
  `;
}

function renderDepartmentWideDetails(logs, container) {
  const departments = {};
  logs.forEach(log => {
    if (!departments[log.department]) {
      departments[log.department] = {
        name: log.department,
        tasksCount: 0,
        minutes: 0,
        score: 0,
        employees: new Set()
      };
    }
    departments[log.department].tasksCount++;
    departments[log.department].minutes += log.duration_minutes || 0;
    departments[log.department].score += parseFloat(log.score || 0);
    departments[log.department].employees.add(log.user_name);
  });

  const deptRows = Object.values(departments).map(dept => {
    const hrs = (dept.minutes / 60).toFixed(1);
    const avgScorePerEmp = (dept.score / (dept.employees.size || 1)).toFixed(2);
    return `
      <tr>
        <td style="font-weight:700;">${dept.name}</td>
        <td>${dept.employees.size}</td>
        <td>${dept.tasksCount}</td>
        <td>${hrs} год</td>
        <td>${isNaN(avgScorePerEmp) ? '0.00' : avgScorePerEmp}</td>
        <td style="font-weight:800; color:var(--accent-2-deep);">${dept.score.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="skod-table-wrapper">
      <table class="skod-table">
        <thead>
          <tr>
            <th>Відділ</th>
            <th>Співробітників</th>
            <th>Кількість завдань</th>
            <th>Загальний час</th>
            <th>Сер. бал на співр.</th>
            <th>Сумарний бал</th>
          </tr>
        </thead>
        <tbody>
          ${deptRows}
        </tbody>
      </table>
    </div>
  `;
}

function getChartColors(isDark) {
  return {
    textColor: isDark ? '#e2e8f0' : '#1e293b',
    gridColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
    branches: {
      askod: '#3b82f6',
      department: '#10b981',
      tasks: '#f59e0b',
      other: '#8b5cf6'
    },
    palette: [
      '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
      '#ec4899', '#14b8a6', '#f43f5e', '#6366f1',
      '#a855f7', '#06b6d4'
    ]
  };
}

function drawDashboardCharts(logs, level, isDark) {
  const colors = getChartColors(isDark);

  // Destroy existing charts to prevent mouseover glitching
  if (chartInstances.branch) {
    chartInstances.branch.destroy();
    chartInstances.branch = null;
  }
  if (chartInstances.timeline) {
    chartInstances.timeline.destroy();
    chartInstances.timeline = null;
  }
  if (chartInstances.leaderboard) {
    chartInstances.leaderboard.destroy();
    chartInstances.leaderboard = null;
  }

  // 1. Branch Doughnut Chart
  const branchScores = { askod: 0, department: 0, tasks: 0 };
  logs.forEach(log => {
    if (log.status === 'completed') {
      const br = log.branch || 'department';
      if (branchScores[br] !== undefined) {
        branchScores[br] += parseFloat(log.score || 0);
      } else {
        branchScores[br] = parseFloat(log.score || 0);
      }
    }
  });

  const branchLabelsMap = {
    askod: 'АСКОД',
    department: 'Внутрішня робота',
    tasks: 'Доручення'
  };

  const branchLabels = Object.keys(branchScores).map(k => branchLabelsMap[k] || k);
  const branchData = Object.values(branchScores);
  const branchBgColors = Object.keys(branchScores).map(k => colors.branches[k] || colors.branches.other);

  const ctxBranch = document.getElementById('chartBranchDistribution')?.getContext('2d');
  if (ctxBranch) {
    chartInstances.branch = new Chart(ctxBranch, {
      type: 'doughnut',
      data: {
        labels: branchLabels,
        datasets: [{
          data: branchData,
          backgroundColor: branchBgColors,
          borderWidth: isDark ? 2 : 1,
          borderColor: isDark ? '#1e293b' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: colors.textColor,
              font: { family: 'var(--p-text)', size: 12 }
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return ` ${context.label}: ${context.raw.toFixed(2)} балів`;
              }
            }
          }
        }
      }
    });
  }

  // 2. Timeline Bar Chart
  const dailyScores = {};
  const startDateVal = document.getElementById('report-start-date')?.value;
  const endDateVal = document.getElementById('report-end-date')?.value;

  if (startDateVal && endDateVal) {
    const start = new Date(startDateVal);
    const end = new Date(endDateVal);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      dailyScores[dateStr] = 0;
    }
  }

  logs.forEach(log => {
    if (log.status === 'completed' && dailyScores[log.log_date] !== undefined) {
      dailyScores[log.log_date] += parseFloat(log.score || 0);
    }
  });

  const timelineLabels = Object.keys(dailyScores).map(d => {
    const parts = d.split('-');
    return `${parts[2]}.${parts[1]}`;
  });
  const timelineData = Object.values(dailyScores);

  const ctxTimeline = document.getElementById('chartTimeline')?.getContext('2d');
  if (ctxTimeline) {
    chartInstances.timeline = new Chart(ctxTimeline, {
      type: 'bar',
      data: {
        labels: timelineLabels,
        datasets: [{
          data: timelineData,
          backgroundColor: isDark ? 'rgba(74, 143, 199, 0.65)' : 'rgba(74, 143, 199, 0.85)',
          borderColor: 'var(--accent)',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                return ` ${context.raw.toFixed(2)} балів`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: colors.gridColor },
            ticks: {
              color: colors.textColor,
              font: { family: 'var(--p-text)', size: 11 }
            }
          },
          y: {
            grid: { color: colors.gridColor },
            ticks: {
              color: colors.textColor,
              font: { family: 'var(--p-text)', size: 11 }
            },
            suggestedMin: 0
          }
        }
      }
    });
  }

  // 3. Leaderboard Horizontal Bar Chart
  const ctxLeaderboard = document.getElementById('chartLeaderboard')?.getContext('2d');
  if (ctxLeaderboard) {
    let leaderboardLabels = [];
    let leaderboardData = [];

    if (level === 'department') {
      const empScores = {};
      logs.forEach(log => {
        if (log.status === 'completed') {
          empScores[log.user_name] = (empScores[log.user_name] || 0) + parseFloat(log.score || 0);
        }
      });
      const sortedEmps = Object.entries(empScores).sort((a, b) => b[1] - a[1]);
      leaderboardLabels = sortedEmps.map(x => x[0]);
      leaderboardData = sortedEmps.map(x => x[1]);
      const lbTitle = document.getElementById('leaderboard-title');
      if (lbTitle) lbTitle.textContent = 'Рейтинг активності співробітників';
    } else if (level === 'department-wide') {
      const deptScores = {};
      logs.forEach(log => {
        if (log.status === 'completed') {
          deptScores[log.department] = (deptScores[log.department] || 0) + parseFloat(log.score || 0);
        }
      });
      const sortedDepts = Object.entries(deptScores).sort((a, b) => b[1] - a[1]);
      leaderboardLabels = sortedDepts.map(x => x[0]);
      leaderboardData = sortedDepts.map(x => x[1]);
      const lbTitle = document.getElementById('leaderboard-title');
      if (lbTitle) lbTitle.textContent = 'Порівняльна активність відділів';
    }

    chartInstances.leaderboard = new Chart(ctxLeaderboard, {
      type: 'bar',
      data: {
        labels: leaderboardLabels,
        datasets: [{
          data: leaderboardData,
          backgroundColor: leaderboardLabels.map((_, idx) => colors.palette[idx % colors.palette.length]),
          borderRadius: 6,
          borderWidth: 0
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                return ` ${context.raw.toFixed(2)} балів`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: colors.gridColor },
            ticks: {
              color: colors.textColor,
              font: { family: 'var(--p-text)', size: 11 }
            },
            suggestedMin: 0
          },
          y: {
            grid: { display: false },
            ticks: {
              color: colors.textColor,
              font: { family: 'var(--p-text)', size: 11 }
            }
          }
        }
      }
    });
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);
export { sb };
