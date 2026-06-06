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
  const taskTypeSel = document.getElementById('task_type');
  const taskCategorySel = document.getElementById('task_category');
  const severitySel = document.getElementById('severity_level');
  const durationInput = document.getElementById('duration_minutes');
  const durationGroup = document.getElementById('duration-group');
  const statusSel = document.getElementById('task_status');
  const scoreVal = document.getElementById('live-score-val');
  const formEl = document.getElementById('skod-log-form');

  // Populate dynamic dropdowns
  function populateTypesAndCategories() {
    const branch = branchSel?.value || 'department';
    const config = BRANCH_CONFIG[branch];

    if (taskTypeSel) {
      const prevType = taskTypeSel.value;
      taskTypeSel.innerHTML = '<option value="" disabled selected>Оберіть тип завдання...</option>';
      config.types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        taskTypeSel.appendChild(opt);
      });
      if (config.types.includes(prevType)) {
        taskTypeSel.value = prevType;
      }
    }
    populateCategories();
  }

  function populateCategories() {
    const branch = branchSel?.value || 'department';
    const config = BRANCH_CONFIG[branch];
    if (taskCategorySel) {
      taskCategorySel.innerHTML = '<option value="" disabled selected>Оберіть категорію...</option>';
      config.categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        taskCategorySel.appendChild(opt);
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
      updateLiveScore();
    });
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
      const task_type = taskTypeSel.value;
      const category = taskCategorySel.value;
      const severity_level = severitySel.value;
      const status = statusSel.value;
      const start_time = document.getElementById('start_time').value;
      const description = document.getElementById('description').value.trim();
      const department = userProfile.Section || 'стратегічного розвитку програми медичних гарантій';
      const user_name = userProfile.full_name || currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

      if (!branch || !task_type || !category || !severity_level || !start_time || !status) {
        alert('Будь ласка, заповніть усі обов’язкові поля.');
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
        formEl.reset();
        
        // Reset defaults
        if (branchSel) branchSel.value = 'department';
        populateTypesAndCategories();
        if (statusSel) {
          statusSel.value = 'completed';
          if (durationGroup) durationGroup.style.display = 'block';
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

    // Load active assigned tasks for linking
    loadActiveAssignedTasks();
  }
}

// Load active assigned tasks for linking dropdown
async function loadActiveAssignedTasks() {
  if (!currentUser) return;
  const { data, error } = await sb
    .from('assigned_tasks')
    .select('id, title')
    .eq('responsible_id', currentUser.id)
    .neq('status', 'completed')
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
        opt.textContent = task.title;
        taskLinkSel.appendChild(opt);
      });
    } else {
      if (isTasksBranch) {
        taskLinkGroup.style.display = 'block';
        taskLinkSel.innerHTML = '<option value="" disabled selected>У вас немає активних доручень</option>';
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
        <td>
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
async function setupReports() {
  const filterDateInput = document.getElementById('report-date');
  const filterDeptSel = document.getElementById('report-department');
  const reportLevelSel = document.getElementById('report-level');
  const btnRun = document.getElementById('btn-run-report');

  // Default dates
  if (filterDateInput) {
    filterDateInput.value = new Date().toISOString().split('T')[0];
  }

  // Populate departments if user has director/full access
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

  if (reportLevelSel) {
    reportLevelSel.addEventListener('change', () => {
      const isDeptOrAll = reportLevelSel.value !== 'personal';
      const deptGroup = document.getElementById('report-dept-group');
      if (deptGroup) {
        deptGroup.style.display = isDeptOrAll ? 'block' : 'none';
      }
    });

    if (userProfile.role !== 'full') {
      const allOpt = reportLevelSel.querySelector('option[value="department-wide"]');
      if (allOpt) allOpt.disabled = true;

      reportLevelSel.value = 'personal';
      const deptGroup = document.getElementById('report-dept-group');
      if (deptGroup) deptGroup.style.display = 'none';
    }
  }

  if (btnRun) {
    btnRun.addEventListener('click', runReport);
    runReport();
  }
}

async function runReport() {
  const level = document.getElementById('report-level')?.value || 'personal';
  const dateVal = document.getElementById('report-date')?.value;
  const deptVal = document.getElementById('report-department')?.value;
  const resultsContainer = document.getElementById('report-results');

  if (!resultsContainer) return;
  resultsContainer.innerHTML = '<div class="empty-state">Завантаження аналітики...</div>';

  if (!dateVal) {
    alert('Будь ласка, оберіть дату.');
    return;
  }

  let query = sb.from('skod_logs').select('*').eq('log_date', dateVal);

  if (level === 'personal') {
    query = query.eq('user_id', currentUser.id);
  } else if (level === 'department') {
    query = query.eq('department', deptVal);
  }

  const { data: logs, error } = await query.order('user_name', { ascending: true });

  if (error) {
    resultsContainer.innerHTML = `<div class="empty-state" style="color:red">Помилка завантаження: ${error.message}</div>`;
    return;
  }

  if (!logs || logs.length === 0) {
    resultsContainer.innerHTML = '<div class="empty-state">За обраний день записи діяльності відсутні.</div>';
    return;
  }

  if (level === 'personal') {
    renderPersonalReport(logs, resultsContainer);
  } else if (level === 'department') {
    renderDepartmentReport(logs, resultsContainer, deptVal);
  } else if (level === 'department-wide') {
    renderDepartmentWideReport(logs, resultsContainer);
  }
}

function renderPersonalReport(logs, container) {
  let totalMins = 0;
  let totalScore = 0;
  
  const trs = logs.map(log => {
    totalMins += log.duration_minutes || 0;
    totalScore += parseFloat(log.score || 0);

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

    return `
      <tr>
        <td style="font-weight:700;">${log.start_time.substring(0, 5)}</td>
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

  const totalHrs = (totalMins / 60).toFixed(1);

  container.innerHTML = `
    <div class="skod-stats" style="margin-top: 20px;">
      <div class="skod-stat-box">
        <span class="stat-lbl">Загальний час</span>
        <span class="stat-num">${totalHrs} год</span>
      </div>
      <div class="skod-stat-box green">
        <span class="stat-lbl">Оціночні бали</span>
        <span class="stat-num">${totalScore.toFixed(2)}</span>
      </div>
      <div class="skod-stat-box">
        <span class="stat-lbl">Кількість завдань</span>
        <span class="stat-num">${logs.length}</span>
      </div>
    </div>
    <div class="skod-table-wrapper">
      <table class="skod-table">
        <thead>
          <tr>
            <th>Час</th>
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

function renderDepartmentReport(logs, container, departmentName) {
  const employees = {};
  let totalDeptMins = 0;
  let totalDeptScore = 0;

  logs.forEach(log => {
    totalDeptMins += log.duration_minutes || 0;
    totalDeptScore += parseFloat(log.score || 0);

    if (!employees[log.user_name]) {
      employees[log.user_name] = {
        name: log.user_name,
        tasksCount: 0,
        minutes: 0,
        score: 0,
        tasks: []
      };
    }

    employees[log.user_name].tasksCount++;
    employees[log.user_name].minutes += log.duration_minutes || 0;
    employees[log.user_name].score += parseFloat(log.score || 0);
    employees[log.user_name].tasks.push(log);
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
    <div style="margin-bottom: 20px;">
      <h3 style="font-family: var(--p-display); margin: 0 0 8px;">Аналітика відділу: ${departmentName}</h3>
      <p style="color: var(--p-muted); margin: 0;">Зведені показники діяльності відділу за день</p>
    </div>
    
    <div class="skod-stats">
      <div class="skod-stat-box">
        <span class="stat-lbl">Загальний час відділу</span>
        <span class="stat-num">${(totalDeptMins / 60).toFixed(1)} год</span>
      </div>
      <div class="skod-stat-box green">
        <span class="stat-lbl">Сумарний бал діяльності</span>
        <span class="stat-num">${totalDeptScore.toFixed(2)}</span>
      </div>
      <div class="skod-stat-box">
        <span class="stat-lbl">Активних співробітників</span>
        <span class="stat-num">${Object.keys(employees).length}</span>
      </div>
    </div>

    <div class="skod-card-title" style="margin-top: 30px;">Рейтинг активності співробітників</div>
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

function renderDepartmentWideReport(logs, container) {
  const departments = {};
  let overallScore = 0;
  let overallMinutes = 0;

  logs.forEach(log => {
    overallScore += parseFloat(log.score || 0);
    overallMinutes += log.duration_minutes || 0;

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
    <div style="margin-bottom: 20px;">
      <h3 style="font-family: var(--p-display); margin: 0 0 8px;">Зведений звіт департаменту</h3>
      <p style="color: var(--p-muted); margin: 0;">Порівняльна активність між підрозділами</p>
    </div>
    
    <div class="skod-stats">
      <div class="skod-stat-box">
        <span class="stat-lbl">Загальний час департаменту</span>
        <span class="stat-num">${(overallMinutes / 60).toFixed(1)} год</span>
      </div>
      <div class="skod-stat-box green">
        <span class="stat-lbl">Сумарна оцінка СКО-Д</span>
        <span class="stat-num">${overallScore.toFixed(2)}</span>
      </div>
      <div class="skod-stat-box">
        <span class="stat-lbl">Кількість залучених відділів</span>
        <span class="stat-num">${Object.keys(departments).length}</span>
      </div>
    </div>

    <div class="skod-card-title" style="margin-top: 30px;">Ефективність підрозділів</div>
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

// Start
document.addEventListener('DOMContentLoaded', init);
export { sb };
