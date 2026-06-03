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

// Standard Task Types
const TASK_TYPES = [
  "Аналітична робота",
  "Розгляд звернень / писемних запитів",
  "Підготовка нормативних та проектних документів",
  "Участь у нарадах / робочих групах",
  "Робота в інформаційних системах НСЗУ",
  "Організаційне забезпечення діяльності",
  "Інше (вказати в описі)"
];

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
  const taskTypeSel = document.getElementById('task_type');
  const severitySel = document.getElementById('severity_level');
  const durationInput = document.getElementById('duration_minutes');
  const scoreVal = document.getElementById('live-score-val');
  const formEl = document.getElementById('skod-log-form');

  // Populate task types
  if (taskTypeSel) {
    taskTypeSel.innerHTML = '<option value="" disabled selected>Оберіть тип завдання...</option>';
    TASK_TYPES.forEach(type => {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = type;
      taskTypeSel.appendChild(opt);
    });
  }

  // Update live score
  function updateLiveScore() {
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

      const task_type = taskTypeSel.value;
      const severity_level = severitySel.value;
      const duration_minutes = parseInt(durationInput.value, 10);
      const start_time = document.getElementById('start_time').value;
      const description = document.getElementById('description').value.trim();
      const department = userProfile.department || document.getElementById('form-department')?.value || 'Департамент стратегії';
      const user_name = userProfile.full_name || currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

      if (!task_type || !severity_level || !duration_minutes || !start_time) {
        alert('Будь ласка, заповніть усі обов’язкові поля.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Зберегти завдання';
        }
        return;
      }

      const coef = COEFFICIENTS[severity_level];
      const score = parseFloat(((duration_minutes / 60) * coef).toFixed(2));

      const logData = {
        user_id: currentUser.id,
        user_name,
        department,
        start_time,
        duration_minutes,
        task_type,
        severity_level,
        complexity_coefficient: coef,
        score,
        description
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
        updateLiveScore();
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
    if (!userProfile.department) {
      // If user profile has no department, show a department selection field
      const deptGroup = document.getElementById('form-dept-group');
      if (deptGroup) {
        deptGroup.style.display = 'block';
      }
    }
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
      totalScore += parseFloat(log.score);
      totalMinutes += log.duration_minutes;

      const tr = document.createElement('tr');
      tr.id = `log-row-${log.id}`;

      // Hours format
      const hrs = Math.floor(log.duration_minutes / 60);
      const mins = log.duration_minutes % 60;
      const durationStr = hrs > 0 ? `${hrs} год ${mins} хв` : `${mins} хв`;

      // Severity translation
      const severityMap = { easy: 'Легкий', medium: 'Середній', hard: 'Складний', expert: 'Експерт' };
      const sevLabel = severityMap[log.severity_level] || log.severity_level;

      tr.innerHTML = `
        <td style="font-weight: 700;">${log.start_time.substring(0, 5)}</td>
        <td>
          <div style="font-weight: 600;">${log.task_type}</div>
          <div style="font-size: 12px; color: var(--p-muted); margin-top: 4px;">${log.description || 'Без опису'}</div>
        </td>
        <td>${durationStr}</td>
        <td><span class="badge-task ${log.severity_level}">${sevLabel} (${log.complexity_coefficient})</span></td>
        <td style="font-weight: 800; color: var(--accent-2-deep);">${log.score.toFixed(2)}</td>
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
    // Standard departments
    const depts = ["Департамент стратегії", "Юридичний департамент", "Департамент фінансів", "Договірний департамент"];
    filterDeptSel.innerHTML = '';
    depts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      filterDeptSel.appendChild(opt);
    });
    
    // Pre-select user's department if available
    if (userProfile.department) {
      filterDeptSel.value = userProfile.department;
    }
  }

  // Direct users to see only what they are allowed
  if (reportLevelSel) {
    reportLevelSel.addEventListener('change', () => {
      const isDeptOrAll = reportLevelSel.value !== 'personal';
      const deptGroup = document.getElementById('report-dept-group');
      if (deptGroup) {
        deptGroup.style.display = isDeptOrAll ? 'block' : 'none';
      }
    });

    // Check permissions
    if (userProfile.role !== 'full') {
      // Non-full users can't run department-wide reports
      const allOpt = reportLevelSel.querySelector('option[value="department-wide"]');
      if (allOpt) allOpt.disabled = true;

      // Check if they are a manager/supervisor (we can extend this logic if needed).
      // For now, if role != 'full', default to 'personal' report.
      reportLevelSel.value = 'personal';
      const deptGroup = document.getElementById('report-dept-group');
      if (deptGroup) deptGroup.style.display = 'none';
    }
  }

  if (btnRun) {
    btnRun.addEventListener('click', runReport);
    // Initial run
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
  } else if (level === 'department-wide') {
    // All departments, no department filter
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

  // Render report based on level
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
    totalMins += log.duration_minutes;
    totalScore += parseFloat(log.score);

    const hrs = Math.floor(log.duration_minutes / 60);
    const mins = log.duration_minutes % 60;
    const durationStr = hrs > 0 ? `${hrs} год ${mins} хв` : `${mins} хв`;

    return `
      <tr>
        <td style="font-weight:700;">${log.start_time.substring(0, 5)}</td>
        <td>
          <div style="font-weight:600;">${log.task_type}</div>
          <div style="font-size:12px; color:var(--p-muted); margin-top:2px;">${log.description || ''}</div>
        </td>
        <td>${durationStr}</td>
        <td><span class="badge-task ${log.severity_level}">${log.severity_level} (${log.complexity_coefficient})</span></td>
        <td style="font-weight:800; color:var(--accent-2-deep);">${parseFloat(log.score).toFixed(2)}</td>
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
  // Aggregate by employee
  const employees = {};
  let totalDeptMins = 0;
  let totalDeptScore = 0;

  logs.forEach(log => {
    totalDeptMins += log.duration_minutes;
    totalDeptScore += parseFloat(log.score);

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
    employees[log.user_name].minutes += log.duration_minutes;
    employees[log.user_name].score += parseFloat(log.score);
    employees[log.user_name].tasks.push(log);
  });

  const empRows = Object.values(employees).map(emp => {
    const hrs = (emp.minutes / 60).toFixed(1);
    const avgCoef = (emp.score / (emp.minutes / 60)).toFixed(2);
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
  // Aggregate by department
  const departments = {};
  let overallScore = 0;
  let overallMinutes = 0;

  logs.forEach(log => {
    overallScore += parseFloat(log.score);
    overallMinutes += log.duration_minutes;

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
    departments[log.department].minutes += log.duration_minutes;
    departments[log.department].score += parseFloat(log.score);
    departments[log.department].employees.add(log.user_name);
  });

  const deptRows = Object.values(departments).map(dept => {
    const hrs = (dept.minutes / 60).toFixed(1);
    const avgScorePerEmp = (dept.score / dept.employees.size).toFixed(2);
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
