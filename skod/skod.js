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

  // 37-D Autocomplete for Process
  async function populateProcessAutocomplete() {
    try {
      const { data, error } = await sb
        .from('skod_logs')
        .select('process_name')
        .eq('include_37d', true)
        .not('process_name', 'is', null);
      
      if (error) {
        console.error('Error fetching processes for autocomplete:', error);
        return;
      }
      
      const datalist = document.getElementById('processes-list');
      if (datalist && data) {
        datalist.innerHTML = '';
        const uniqueProcesses = [...new Set(data.map(d => d.process_name ? d.process_name.trim() : '').filter(Boolean))];
        uniqueProcesses.forEach(proc => {
          const option = document.createElement('option');
          option.value = proc;
          datalist.appendChild(option);
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  // 37-D Populate Contact Persons
  async function populateContactPersons() {
    try {
      const select = document.getElementById('contact_person_select');
      if (!select) return;
      
      const { data, error } = await sb
        .from('profiles')
        .select('id, full_name')
        .order('full_name', { ascending: true });
        
      if (error) {
        console.error('Error fetching profiles for contact persons:', error);
        return;
      }
      
      select.innerHTML = '';
      if (data) {
        data.forEach(profile => {
          const opt = document.createElement('option');
          opt.value = profile.id;
          opt.textContent = profile.full_name;
          if (profile.id === currentUser.id) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  const include37dCheckbox = document.getElementById('include_37d');
  const block37dFields = document.getElementById('block-37d-fields');
  
  if (include37dCheckbox && block37dFields) {
    // Enable manager comment editing for managers/coordinators
    const userRole = userProfile.role || 'registered';
    const isManagerOrAbove = ['admin', 'director', 'deputy_director', 'manager'].includes(userRole);
    const managerCommentInput = document.getElementById('manager_comment');
    if (managerCommentInput && isManagerOrAbove) {
      managerCommentInput.removeAttribute('readonly');
    }

    include37dCheckbox.addEventListener('change', () => {
      const show37d = include37dCheckbox.checked;
      block37dFields.style.display = show37d ? 'flex' : 'none';
      if (show37d) {
        // Set default date to today
        const dateInput = document.getElementById('event_date');
        if (dateInput && !dateInput.value) {
          dateInput.value = new Date().toISOString().split('T')[0];
        }
        // Load data
        populateProcessAutocomplete();
        populateContactPersons();
      }
    });
  }

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
      let department = userProfile.Section;
      if (!department) {
        if (['admin', 'director'].includes(userProfile.role)) {
          department = 'Поза відділами';
        } else {
          department = 'стратегічного розвитку програми медичних гарантій';
        }
      }
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

      let include_37d = false;
      let process_name = null;
      let info_type_37d = null;
      let current_state_text = null;
      let status_37d = null;
      let event_date = null;
      let contact_person_id = null;
      let contact_person_name = null;
      let document_link = null;
      let manager_comment = null;
      let include_in_current_report = true;

      const include37dCheckbox = document.getElementById('include_37d');
      if (include37dCheckbox && include37dCheckbox.checked) {
        include_37d = true;
        process_name = document.getElementById('process_name')?.value?.trim() || null;
        info_type_37d = document.getElementById('info_type_37d')?.value || null;
        current_state_text = document.getElementById('current_state_text')?.value?.trim() || null;
        status_37d = document.getElementById('status_37d')?.value || 'виконано';
        event_date = document.getElementById('event_date')?.value || null;
        
        const contactPersonSelect = document.getElementById('contact_person_select');
        contact_person_id = contactPersonSelect?.value || null;
        contact_person_name = contactPersonSelect?.options[contactPersonSelect.selectedIndex]?.textContent || null;
        
        document_link = document.getElementById('document_link')?.value?.trim() || null;
        manager_comment = document.getElementById('manager_comment')?.value?.trim() || null;
        include_in_current_report = document.getElementById('include_in_current_report')?.checked ?? true;

        // Validation for Form 37-D
        if (!process_name) {
          alert("Для включення завдання до форми 37-Д необхідно заповнити поле: Процес");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Зберегти завдання'; }
          return;
        }
        if (!current_state_text) {
          alert("Для включення завдання до форми 37-Д необхідно заповнити поле: Поточний стан виконання");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Зберегти завдання'; }
          return;
        }
        if (!event_date) {
          alert("Для включення завдання до форми 37-Д необхідно заповнити поле: Дата події / виконання");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Зберегти завдання'; }
          return;
        }
        if (!contact_person_id) {
          alert("Для включення завдання до форми 37-Д необхідно заповнити поле: Контактна особа");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Зберегти завдання'; }
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
        askod_reg_number,
        
        // 37-D Fields
        include_37d,
        process_name,
        info_type_37d,
        current_state_text,
        status_37d,
        event_date,
        contact_person_id,
        contact_person_name,
        document_link,
        manager_comment,
        include_in_current_report
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
        
        // Reset 37-D fields
        if (include37dCheckbox) {
          include37dCheckbox.checked = false;
          include37dCheckbox.dispatchEvent(new Event('change'));
        }
        const pName = document.getElementById('process_name'); if (pName) pName.value = '';
        const iType = document.getElementById('info_type_37d'); if (iType) iType.value = '';
        const cState = document.getElementById('current_state_text'); if (cState) cState.value = '';
        const s37d = document.getElementById('status_37d'); if (s37d) s37d.value = 'виконано';
        const eDate = document.getElementById('event_date'); if (eDate) eDate.value = '';
        const dLink = document.getElementById('document_link'); if (dLink) dLink.value = '';
        const mComm = document.getElementById('manager_comment'); if (mComm) mComm.value = '';
        const iReport = document.getElementById('include_in_current_report'); if (iReport) iReport.checked = true;
        
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
      let displayDept = userProfile.Section;
      if (!displayDept) {
        if (['admin', 'director'].includes(userProfile.role)) {
          displayDept = 'Поза відділами';
        } else {
          displayDept = 'стратегічного розвитку програми медичних гарантій';
        }
      }
      deptDisplayVal.textContent = displayDept;
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

      const badge37d = log.include_37d 
        ? `<span class="badge-37d ${log.status_37d ? log.status_37d.replace(/[\s/]+/g, '_') : ''}">${log.status_37d || 'виконано'}</span>` 
        : '';

      tr.innerHTML = `
        <td style="font-weight: 700;">${log.start_time.substring(0, 5)}</td>
        <td>
          <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--p-muted); letter-spacing:0.02em; margin-bottom: 2px;">
            ${branchLabel}${categoryLabel}
          </div>
          <div style="font-weight: 600;">${log.task_type}${badge37d}</div>
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

// Load employee list for the employee filter dropdown
async function loadEmployeeList(department) {
  const empSel = document.getElementById('report-employee');
  if (!empSel) return;

  let query = sb.from('profiles').select('id, full_name, "Section"');

  if (department && department !== 'all') {
    query = query.eq('Section', department);
  }

  const { data } = await query.order('full_name');
  empSel.innerHTML = '<option value="all">Всі співробітники</option>';
  (data || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.full_name + (!department || department === 'all' ? ` (${p.Section || '—'})` : '');
    empSel.appendChild(opt);
  });
}

// Helper to update employee filter visibility and content
function updateEmployeeFilter(level, deptVal, isAllowedToSeeEmployees) {
  const empGroup = document.getElementById('report-employee-group');
  if (!empGroup) return;
  const showEmp = isAllowedToSeeEmployees && level !== 'personal';
  empGroup.style.display = showEmp ? 'flex' : 'none';
  if (showEmp) {
    const dept = (level === 'department' || level === 'user-statuses') ? deptVal : 'all';
    loadEmployeeList(dept);
  }
}

async function setupReports() {
  const startDateInput = document.getElementById('report-start-date');
  const endDateInput = document.getElementById('report-end-date');
  const filterDeptSel = document.getElementById('report-department');
  const reportLevelSel = document.getElementById('report-level');
  const empSel = document.getElementById('report-employee');
  const btnRun = document.getElementById('btn-run-report');

  // Default dates: Today
  const todayStr = new Date().toISOString().split('T')[0];
  if (startDateInput) startDateInput.value = todayStr;
  if (endDateInput) endDateInput.value = todayStr;

  // Populate departments
  if (filterDeptSel) {
    const depts = [
      "Всі відділи",
      "робота з електронними медичними даними",
      "розрахунок вартості медичних послуг",
      "стратегічного розвитку програми медичних гарантій",
      "наукова та клінічна експертиза",
      "розвиток програми реімбурсації",
      "взаємодія з надавачами медичних послуг",
      "Поза відділами"
    ];
    filterDeptSel.innerHTML = '';
    depts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d === "Всі відділи" ? "all" : d;
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
  const canSeeEmployees = isDirectorOrDeputyOrAdmin || isManager;

  if (reportLevelSel) {
    if (isDirectorOrDeputyOrAdmin) {
      // Директор не звітує особисто — прибираємо «Мій звіт»
      if (userRole === 'director' || userRole === 'admin') {
        const personalOpt = reportLevelSel.querySelector('option[value="personal"]');
        if (personalOpt) personalOpt.remove();
        reportLevelSel.value = 'department-wide';
        // Одразу показати фільтри відділу та співробітника
        const deptGroup = document.getElementById('report-dept-group');
        if (deptGroup) deptGroup.style.display = 'flex';
        updateEmployeeFilter('department-wide', filterDeptSel?.value, true);
      }
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
      // Standard: can see personal and user-statuses
      const deptOpt = reportLevelSel.querySelector('option[value="department"]');
      if (deptOpt) deptOpt.remove();
      const allOpt = reportLevelSel.querySelector('option[value="department-wide"]');
      if (allOpt) allOpt.remove();

      reportLevelSel.value = 'personal';
      const deptGroup = document.getElementById('report-dept-group');
      if (deptGroup) deptGroup.style.display = 'none';
      const empGroup = document.getElementById('report-employee-group');
      if (empGroup) empGroup.style.display = 'none';
    }

    reportLevelSel.addEventListener('change', () => {
      const showDept = reportLevelSel.value !== 'personal';
      const deptGroup = document.getElementById('report-dept-group');
      if (deptGroup) {
        deptGroup.style.display = showDept ? 'flex' : 'none';
      }
      // Update employee filter
      const level = reportLevelSel.value;
      const canSee = canSeeEmployees || level === 'user-statuses';
      updateEmployeeFilter(level, filterDeptSel?.value, canSee);
    });
  }

  // When department changes, reload employee list
  if (filterDeptSel) {
    filterDeptSel.addEventListener('change', () => {
      const level = reportLevelSel ? reportLevelSel.value : 'personal';
      const canSee = canSeeEmployees || level === 'user-statuses';
      if (level !== 'personal' && canSee) {
        const dept = (level === 'department' || level === 'user-statuses') ? filterDeptSel.value : 'all';
        loadEmployeeList(dept);
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

  // Pre-select status report level if URL parameter ?type=statuses is present.
  // Must run AFTER preset listeners are attached, so presetWeek.click() actually
  // sets the week range; the report itself is run by the auto runReport() below.
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('type') === 'statuses' || urlParams.get('tab') === 'statuses') {
    if (reportLevelSel) {
      reportLevelSel.value = 'user-statuses';
      reportLevelSel.dispatchEvent(new Event('change'));
      const presetWeekBtn = document.getElementById('preset-week');
      if (presetWeekBtn) presetWeekBtn.click();
    }
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

  // === Tab Switching ===
  const tabAnalytics = document.getElementById('tab-analytics');
  const tab37d = document.getElementById('tab-37d');
  const sectionAnalytics = document.getElementById('analytics-section');
  const section37d = document.getElementById('section-37d');

  if (tabAnalytics && tab37d) {
    tabAnalytics.addEventListener('click', () => {
      tabAnalytics.classList.add('active');
      tab37d.classList.remove('active');
      if (sectionAnalytics) sectionAnalytics.style.display = 'block';
      if (section37d) section37d.style.display = 'none';
    });

    tab37d.addEventListener('click', () => {
      tab37d.classList.add('active');
      tabAnalytics.classList.remove('active');
      if (sectionAnalytics) sectionAnalytics.style.display = 'none';
      if (section37d) section37d.style.display = 'block';
      // Run initial report
      run37dReport();
    });
  }

  // === 37-D Filters Setup ===
  const startDate37d = document.getElementById('report-37d-start-date');
  const endDate37d = document.getElementById('report-37d-end-date');
  const dept37dSel = document.getElementById('report-37d-department');
  const level37dSel = document.getElementById('report-37d-level');
  const emp37dSel = document.getElementById('report-37d-employee');
  const status37dSel = document.getElementById('report-37d-status');
  const infoType37dSel = document.getElementById('report-37d-info-type');
  
  const btnRun37d = document.getElementById('btn-run-37d');
  const btnExcel37d = document.getElementById('btn-excel-37d');
  const btnMarkIncluded = document.getElementById('btn-mark-included-37d');
  const btnClear37d = document.getElementById('btn-clear-37d');

  // Tuesday preset helper
  function getTuesdayRange() {
    const today = new Date();
    const currentDay = today.getDay(); // 0: Sun, 1: Mon, 2: Tue...
    let daysSinceTuesday = currentDay - 2;
    if (daysSinceTuesday < 0) {
      daysSinceTuesday += 7;
    }
    const end = new Date(today);
    end.setDate(today.getDate() - daysSinceTuesday);
    const start = new Date(end);
    start.setDate(end.getDate() - 7);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    };
  }

  // Tuesday preset default
  const tuesdayRange = getTuesdayRange();
  if (startDate37d) startDate37d.value = tuesdayRange.start;
  if (endDate37d) endDate37d.value = tuesdayRange.end;

  // Set 37-D preset buttons active state
  function set37dPresetActive(btn) {
    document.querySelectorAll('#section-37d .btn-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  // Preset Event Listeners for 37-D
  const preset37dTuesday = document.getElementById('preset-37d-tuesday');
  if (preset37dTuesday) {
    preset37dTuesday.addEventListener('click', () => {
      set37dPresetActive(preset37dTuesday);
      const range = getTuesdayRange();
      if (startDate37d) startDate37d.value = range.start;
      if (endDate37d) endDate37d.value = range.end;
    });
  }

  const preset37dToday = document.getElementById('preset-37d-today');
  if (preset37dToday) {
    preset37dToday.addEventListener('click', () => {
      set37dPresetActive(preset37dToday);
      const today = new Date().toISOString().split('T')[0];
      if (startDate37d) startDate37d.value = today;
      if (endDate37d) endDate37d.value = today;
    });
  }

  const preset37dWeek = document.getElementById('preset-37d-week');
  if (preset37dWeek) {
    preset37dWeek.addEventListener('click', () => {
      set37dPresetActive(preset37dWeek);
      const today = new Date();
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(today.setDate(diff));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      if (startDate37d) startDate37d.value = monday.toISOString().split('T')[0];
      if (endDate37d) endDate37d.value = sunday.toISOString().split('T')[0];
    });
  }

  const preset37dMonth = document.getElementById('preset-37d-month');
  if (preset37dMonth) {
    preset37dMonth.addEventListener('click', () => {
      set37dPresetActive(preset37dMonth);
      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      if (startDate37d) startDate37d.value = firstDay.toISOString().split('T')[0];
      if (endDate37d) endDate37d.value = lastDay.toISOString().split('T')[0];
    });
  }

  if (startDate37d) startDate37d.addEventListener('change', () => document.querySelectorAll('#section-37d .btn-preset').forEach(b => b.classList.remove('active')));
  if (endDate37d) endDate37d.addEventListener('change', () => document.querySelectorAll('#section-37d .btn-preset').forEach(b => b.classList.remove('active')));

  // Populate 37-D departments
  if (dept37dSel) {
    const depts = [
      "Всі відділи",
      "робота з електронними медичними даними",
      "розрахунок вартості медичних послуг",
      "стратегічного розвитку програми медичних гарантій",
      "наукова та клінічна експертиза",
      "розвиток програми реімбурсації",
      "взаємодія з надавачами медичних послуг",
      "Поза відділами"
    ];
    dept37dSel.innerHTML = '';
    depts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = (d === "Всі відділи") ? "all" : d;
      opt.textContent = d;
      dept37dSel.appendChild(opt);
    });
    if (userProfile.Section) {
      dept37dSel.value = userProfile.Section;
    }
  }

  // Load employee list for 37d
  async function loadEmployeeList37d(department) {
    if (!emp37dSel) return;
    emp37dSel.innerHTML = '<option value="all">Всі співробітники</option>';
    let query = sb.from('profiles').select('id, full_name, "Section"');
    if (department && department !== 'all') {
      query = query.eq('Section', department);
    }
    const { data, error } = await query.order('full_name', { ascending: true });
    if (error) {
      console.error("Error loading profiles:", error);
      return;
    }
    if (data) {
      data.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.full_name;
        emp37dSel.appendChild(opt);
      });
    }
  }

  // RBAC checks for 37-D filters
  const userRole37d = userProfile.role || 'registered';
  const isCoordOrAdmin = ['admin', 'director', 'deputy_director', 'full'].includes(userRole37d);
  const isManager37d = userRole37d === 'manager' || userProfile.is_head === true;
  const canSeeEmployees37d = isCoordOrAdmin || isManager37d;

  if (level37dSel) {
    if (isCoordOrAdmin) {
      level37dSel.value = 'department-wide';
      const deptGroup = document.getElementById('report-37d-dept-group');
      if (deptGroup) deptGroup.style.display = 'flex';
      if (dept37dSel) dept37dSel.value = 'all';
      loadEmployeeList37d('all');
    } else if (isManager37d) {
      // Remove department-wide option
      const wideOpt = level37dSel.querySelector('option[value="department-wide"]');
      if (wideOpt) wideOpt.remove();
      level37dSel.value = 'department';
      if (dept37dSel) {
        dept37dSel.value = userProfile.Section || userProfile.department || '';
        dept37dSel.disabled = true;
      }
      loadEmployeeList37d(userProfile.Section);
    } else {
      // Personal only
      const wideOpt = level37dSel.querySelector('option[value="department-wide"]'); if (wideOpt) wideOpt.remove();
      const deptOpt = level37dSel.querySelector('option[value="department"]'); if (deptOpt) deptOpt.remove();
      level37dSel.value = 'personal';
      const deptGroup = document.getElementById('report-37d-dept-group'); if (deptGroup) deptGroup.style.display = 'none';
      const empGroup = document.getElementById('report-37d-employee-group'); if (empGroup) empGroup.style.display = 'none';
    }

    level37dSel.addEventListener('change', () => {
      const showDept = level37dSel.value !== 'personal';
      const deptGroup = document.getElementById('report-37d-dept-group');
      if (deptGroup) deptGroup.style.display = showDept ? 'flex' : 'none';
      const empGroup = document.getElementById('report-37d-employee-group');
      if (empGroup) empGroup.style.display = showDept ? 'flex' : 'none';
      
      const dept = (level37dSel.value === 'department') ? dept37dSel.value : 'all';
      loadEmployeeList37d(dept);
    });
  }

  if (dept37dSel) {
    dept37dSel.addEventListener('change', () => {
      if (level37dSel.value === 'department') {
        loadEmployeeList37d(dept37dSel.value);
      }
    });
  }

  // Show "Mark as Included" button only for coordinators/admins
  if (btnMarkIncluded && isCoordOrAdmin) {
    btnMarkIncluded.style.display = 'inline-block';
  }

  // Button actions
  if (btnRun37d) btnRun37d.addEventListener('click', run37dReport);
  if (btnExcel37d) btnExcel37d.addEventListener('click', download37dExcel);
  if (btnMarkIncluded) btnMarkIncluded.addEventListener('click', mark37dAsIncluded);
  if (btnClear37d) {
    btnClear37d.addEventListener('click', () => {
      if (startDate37d) startDate37d.value = tuesdayRange.start;
      if (endDate37d) endDate37d.value = tuesdayRange.end;
      if (level37dSel) {
        if (isCoordOrAdmin) level37dSel.value = 'department-wide';
        else if (isManager37d) level37dSel.value = 'department';
        else level37dSel.value = 'personal';
        level37dSel.dispatchEvent(new Event('change'));
      }
      if (status37dSel) status37dSel.value = 'all';
      if (infoType37dSel) infoType37dSel.value = 'all';
      run37dReport();
    });
  }
}

async function runReport() {
  const level = document.getElementById('report-level')?.value || 'personal';
  const startDateVal = document.getElementById('report-start-date')?.value;
  const endDateVal = document.getElementById('report-end-date')?.value;
  const deptVal = document.getElementById('report-department')?.value;
  const empVal = document.getElementById('report-employee')?.value || 'all';

  if (level === 'user-statuses') {
    runStatusReport(startDateVal, endDateVal, deptVal, empVal);
    return;
  }
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

  // Determine effective level: if specific employee selected, treat as personal-like
  const isEmployeeSelected = empVal && empVal !== 'all';

  if (level === 'personal') {
    query = query.eq('user_id', currentUser.id);
  } else if (isEmployeeSelected) {
    // Specific employee selected — filter by their user_id
    query = query.eq('user_id', empVal);
  } else {
    if (deptVal && deptVal !== 'all') {
      query = query.eq('department', deptVal);
    }
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

  // Determine effective rendering level
  let effectiveLevel = level;
  let employeeName = null;
  if (isEmployeeSelected && level !== 'personal') {
    effectiveLevel = 'employee'; // individual view of another user
    // Get employee name from the first log or from the dropdown
    employeeName = logs[0]?.user_name || document.getElementById('report-employee')?.selectedOptions[0]?.textContent || '';
  }

  lastLoggedData = { logs, level: effectiveLevel, departmentName: deptVal, startDateVal, endDateVal, employeeName };
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
      ${level !== 'personal' && level !== 'employee' ? `
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
  if (level === 'personal' || level === 'employee') {
    const breadcrumb = level === 'employee' ? buildBreadcrumb(data) : '';
    renderPersonalDetails(logs, detailsContainer, breadcrumb);
  } else if (level === 'department') {
    renderDepartmentDetails(logs, detailsContainer, departmentName);
  } else if (level === 'department-wide') {
    renderDepartmentWideDetails(logs, detailsContainer);
  }

  const isDark = document.body.classList.contains('dark-theme') || document.documentElement.classList.contains('dark-theme');
  drawDashboardCharts(logs, level, isDark);
}

// Build breadcrumb for drill-down navigation
function buildBreadcrumb(data) {
  const { level, departmentName, employeeName } = data;
  if (level !== 'employee') return '';
  let html = '<div class="report-breadcrumb">';
  html += `<span class="bc-link" onclick="drillToLevel('department-wide')">Департамент</span>`;
  html += '<span class="bc-sep"></span>';
  if (departmentName) {
    html += `<span class="bc-link" onclick="drillToLevel('department', '${departmentName.replace(/'/g, "\\'")}')">відділ ${departmentName}</span>`;
    html += '<span class="bc-sep"></span>';
  }
  html += `<span style="font-weight:600; color:var(--p-ink);">${employeeName || 'Співробітник'}</span>`;
  html += '</div>';
  return html;
}

// Drill-down helpers — called from onclick in rendered HTML
function drillToLevel(level, department) {
  const reportLevelSel = document.getElementById('report-level');
  const filterDeptSel = document.getElementById('report-department');
  const empSel = document.getElementById('report-employee');

  if (reportLevelSel) reportLevelSel.value = level;

  if (level === 'department' && department && filterDeptSel) {
    filterDeptSel.value = department;
    // Show dept group
    const deptGroup = document.getElementById('report-dept-group');
    if (deptGroup) deptGroup.style.display = 'flex';
  }

  if (level === 'department-wide') {
    const deptGroup = document.getElementById('report-dept-group');
    if (deptGroup) deptGroup.style.display = 'flex';
  }

  // Reset employee to all
  if (empSel) empSel.value = 'all';

  // Update employee filter visibility
  const userRole = userProfile.role || 'registered';
  const canSee = ['admin', 'director', 'deputy_director', 'full'].includes(userRole) || userRole === 'manager' || userProfile.is_head === true;
  updateEmployeeFilter(level, filterDeptSel?.value, canSee);

  runReport();
}

function drillToEmployee(userId, userName) {
  const empSel = document.getElementById('report-employee');
  if (empSel) {
    // Check if the option exists, if not add it temporarily
    let opt = empSel.querySelector(`option[value="${userId}"]`);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = userId;
      opt.textContent = userName;
      empSel.appendChild(opt);
    }
    empSel.value = userId;
  }
  runReport();
}

function renderPersonalDetails(logs, container, breadcrumb) {
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

    // Check if included in 37d
    let action37dHtml = '';
    if (log.include_37d) {
      const statusClass = (log.status_37d || 'виконано').toLowerCase().replace(/\s+/g, '-').replace(/\//g, '');
      action37dHtml = `
        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
          <span class="badge-37d ${statusClass}" style="margin-left:0; font-size:10px; padding:2px 6px;">
            ${log.status_37d || 'виконано'}
          </span>
          <button class="btn btn-sm btn-edit-37d" data-log-id="${log.id}" style="padding:2px 6px; font-size:11px; background:var(--p-soft); border:1px solid var(--p-line); border-radius:4px; cursor:pointer;">
            ✏️ Редагувати
          </button>
        </div>
      `;
    } else {
      action37dHtml = `
        <button class="btn btn-sm btn-add-37d" data-log-id="${log.id}" style="padding:4px 8px; font-size:11px; background:var(--p-soft, #f1f5f9); border:1px solid var(--p-line, #cbd5e1); border-radius:4px; cursor:pointer; color:var(--accent-deep, #1e40af); font-weight:600;">
          ➕ Додати
        </button>
      `;
    }

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
        <td>${action37dHtml}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    ${breadcrumb || ''}
    <div class="skod-table-wrapper">
      <table class="skod-table">
        <thead>
          <tr>
            <th>Дата та час</th>
            <th>Завдання</th>
            <th>Тривалість</th>
            <th>Складність</th>
            <th>Бали</th>
            <th>Звіт 37-Д</th>
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
        userId: log.user_id,
        tasksCount: 0,
        minutes: 0,
        score: 0
      };
    }
    employees[log.user_name].tasksCount++;
    employees[log.user_name].minutes += log.duration_minutes || 0;
    employees[log.user_name].score += parseFloat(log.score || 0);
  });

  // Check if current user can drill down to individual
  const userRole = userProfile.role || 'registered';
  const canDrillDown = ['admin', 'director', 'deputy_director', 'full'].includes(userRole)
    || userRole === 'manager' || userProfile.is_head === true;

  const empRows = Object.values(employees).map(emp => {
    const hrs = (emp.minutes / 60).toFixed(1);
    const avgCoef = (emp.score / (emp.minutes / 60 || 1)).toFixed(2);
    const nameCell = canDrillDown
      ? `<span class="drilldown-link" onclick="drillToEmployee('${emp.userId}', '${emp.name.replace(/'/g, "\\'")}')"
           title="Переглянути індивідуальний звіт">${emp.name}</span>`
      : emp.name;
    return `
      <tr>
        <td style="font-weight:700;">${nameCell}</td>
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
    const deptLink = `<span class="drilldown-link" onclick="drillToLevel('department', '${dept.name.replace(/'/g, "\\'")}')"
      title="Переглянути звіт відділу">${dept.name}</span>`;
    return `
      <tr>
        <td style="font-weight:700;">${deptLink}</td>
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

// Глобальна реєстрація функцій drill-down для onclick в динамічному HTML
window.drillToLevel = drillToLevel;
window.drillToEmployee = drillToEmployee;


/* ── User Daily Statuses Statistics / Reporting Logic ─────── */
async function runStatusReport(startDateVal, endDateVal, deptVal, empVal) {
  const resultsContainer = document.getElementById('report-results');
  if (!resultsContainer) return;
  resultsContainer.innerHTML = '<div class="empty-state">Завантаження аналітики статусів...</div>';

  if (!startDateVal || !endDateVal) {
    alert('Будь ласка, оберіть період.');
    return;
  }

  let query = sb.from('user_daily_statuses').select('*')
    .gte('status_date', startDateVal)
    .lte('status_date', endDateVal);

  if (empVal && empVal !== 'all') {
    query = query.eq('user_id', empVal);
  } else if (deptVal && deptVal !== 'all' && deptVal !== 'Поза відділами') {
    query = query.eq('department', deptVal);
  }

  const { data, error } = await query.order('status_date', { ascending: true });

  if (error) {
    resultsContainer.innerHTML = `<div class="empty-state" style="color:red">Помилка завантаження: ${error.message}</div>`;
    return;
  }

  if (!data || data.length === 0) {
    resultsContainer.innerHTML = '<div class="empty-state" style="background: var(--p-surface); border: 1px solid var(--p-line); border-radius: var(--pr-tile); padding: 40px;">За обраний період та фільтри записи статусів відсутні.</div>';
    Object.values(chartInstances).forEach(c => c && c.destroy());
    chartInstances = {};
    return;
  }

  renderStatusDashboard(data, startDateVal, endDateVal, deptVal, empVal);
}

function renderStatusDashboard(logs, startDateVal, endDateVal, deptVal, empVal) {
  const resultsContainer = document.getElementById('report-results');
  if (!resultsContainer) return;

  const totalDays = logs.length;
  const statusCounts = { office: 0, home: 0, sick: 0, vacation: 0, agreement: 0 };
  logs.forEach(log => {
    if (statusCounts[log.status] !== undefined) {
      statusCounts[log.status]++;
    }
  });

  const officePct = totalDays > 0 ? ((statusCounts.office / totalDays) * 100).toFixed(1) : 0;
  const homePct = totalDays > 0 ? ((statusCounts.home / totalDays) * 100).toFixed(1) : 0;

  let html = `
    <div class="skod-stats-grid">
      <div class="skod-kpi-card score" style="border-left: 4px solid #137333; background: #e6f4ea; color: #137333;">
        <div class="skod-kpi-icon">🏢</div>
        <div class="skod-kpi-info">
          <span class="skod-kpi-title" style="color:#137333">Днів в офісі</span>
          <span class="skod-kpi-value" style="color:#137333">${statusCounts.office} (${officePct}%)</span>
        </div>
      </div>
      <div class="skod-kpi-card hours" style="border-left: 4px solid #1a73e8; background: #e8f0fe; color: #1a73e8;">
        <div class="skod-kpi-icon">🏡</div>
        <div class="skod-kpi-info">
          <span class="skod-kpi-title" style="color:#1a73e8">Днів вдома (дистанційно)</span>
          <span class="skod-kpi-value" style="color:#1a73e8">${statusCounts.home} (${homePct}%)</span>
        </div>
      </div>
      <div class="skod-kpi-card tasks" style="border-left: 4px solid #c5221f; background: #fce8e6; color: #c5221f;">
        <div class="skod-kpi-icon">🏥</div>
        <div class="skod-kpi-info">
          <span class="skod-kpi-title" style="color:#c5221f">Лікарняні / Відпустки</span>
          <span class="skod-kpi-value" style="color:#c5221f">${statusCounts.sick + statusCounts.vacation}</span>
        </div>
      </div>
      <div class="skod-kpi-card complexity" style="border-left: 4px solid #007b83; background: #eef8f7; color: #007b83;">
        <div class="skod-kpi-icon">🤝</div>
        <div class="skod-kpi-info">
          <span class="skod-kpi-title" style="color:#007b83">За домовленістю</span>
          <span class="skod-kpi-value" style="color:#007b83">${statusCounts.agreement}</span>
        </div>
      </div>
    </div>

    <div class="skod-dashboard-grid">
      <div class="skod-chart-card">
        <div class="skod-chart-card-title">Розподіл статусів (кількість днів)</div>
        <div class="skod-chart-container">
          <canvas id="chartStatusDistribution"></canvas>
        </div>
      </div>
      <div class="skod-chart-card">
        <div class="skod-chart-card-title">Динаміка присутності</div>
        <div class="skod-chart-container">
          <canvas id="chartStatusTimeline"></canvas>
        </div>
      </div>
    </div>

    <!-- Summary matrix table by User -->
    <div class="skod-card" style="padding: 24px; border-radius: var(--pr-tile); background: var(--p-surface); border: 1px solid var(--p-line); box-shadow: var(--p-shadow-sm); margin-bottom: 20px;">
      <div class="skod-card-title" style="margin-bottom: 20px; border-bottom: 1px solid var(--p-soft); padding-bottom: 12px; font-weight:700;">
        📊 Зведена таблиця присутності співробітників
      </div>
      <div style="overflow-x: auto;">
        <table class="skod-table" style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="border-bottom: 2px solid var(--p-line); text-align: left;">
              <th style="padding: 10px;">Співробітник</th>
              <th style="padding: 10px; color: #137333;">🏢 Офіс</th>
              <th style="padding: 10px; color: #1a73e8;">🏡 Вдома</th>
              <th style="padding: 10px; color: #c5221f;">🏥 Лікарняний</th>
              <th style="padding: 10px; color: #8616a6;">🌴 Відпустка</th>
              <th style="padding: 10px; color: #007b83;">🤝 За домовл.</th>
              <th style="padding: 10px; font-weight: bold;">Всього днів</th>
            </tr>
          </thead>
          <tbody>
            ${buildStatusMatrixRows(logs)}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Detailed history log -->
    <div class="skod-card" style="padding: 24px; border-radius: var(--pr-tile); background: var(--p-surface); border: 1px solid var(--p-line); box-shadow: var(--p-shadow-sm);">
      <div class="skod-card-title" style="margin-bottom: 20px; border-bottom: 1px solid var(--p-soft); padding-bottom: 12px; font-weight:700;">
        📋 Хронологічний журнал статусів
      </div>
      <div style="overflow-x: auto;">
        <table class="skod-table" style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="border-bottom: 2px solid var(--p-line); text-align: left;">
              <th style="padding: 10px;">Дата</th>
              <th style="padding: 10px;">Співробітник</th>
              <th style="padding: 10px;">Відділ</th>
              <th style="padding: 10px;">Статус</th>
            </tr>
          </thead>
          <tbody>
            ${buildStatusLogRows(logs)}
          </tbody>
        </table>
      </div>
    </div>
  `;

  resultsContainer.innerHTML = html;

  // Destroy previous chart instances
  Object.values(chartInstances).forEach(c => c && c.destroy());
  chartInstances = {};

  const isDark = document.body.classList.contains('dark-theme') || document.documentElement.classList.contains('dark-theme');
  drawStatusCharts(logs, isDark);
}

function buildStatusMatrixRows(logs) {
  const userStats = {};
  logs.forEach(log => {
    const userId = log.user_id;
    const name = log.user_name || 'Співробітник';
    if (!userStats[userId]) {
      userStats[userId] = { name: name, office: 0, home: 0, sick: 0, vacation: 0, agreement: 0, total: 0 };
    }
    const s = log.status;
    if (userStats[userId][s] !== undefined) {
      userStats[userId][s]++;
    }
    userStats[userId].total++;
  });

  const rows = Object.values(userStats).map(u => `
    <tr style="border-bottom: 1px solid var(--p-line); height: 40px;">
      <td style="padding: 10px; font-weight: 600;">${u.name}</td>
      <td style="padding: 10px; color: #137333; font-weight: 600;">${u.office}</td>
      <td style="padding: 10px; color: #1a73e8; font-weight: 600;">${u.home}</td>
      <td style="padding: 10px; color: #c5221f; font-weight: 600;">${u.sick}</td>
      <td style="padding: 10px; color: #8616a6; font-weight: 600;">${u.vacation}</td>
      <td style="padding: 10px; color: #007b83; font-weight: 600;">${u.agreement}</td>
      <td style="padding: 10px; font-weight: bold;">${u.total}</td>
    </tr>
  `).join('');

  return rows || `<tr><td colspan="7" style="padding:10px; text-align:center;">Немає даних</td></tr>`;
}

function buildStatusLogRows(logs) {
  const statusLabels = {
    office: '🏢 Офіс',
    home: '🏡 Вдома',
    sick: '🏥 Лікарняний',
    vacation: '🌴 Відпустка',
    agreement: '🤝 За домовленістю'
  };

  const statusColors = {
    office: 'color: #137333; font-weight: 700;',
    home: 'color: #1a73e8; font-weight: 700;',
    sick: 'color: #c5221f; font-weight: 700;',
    vacation: 'color: #8616a6; font-weight: 700;',
    agreement: 'color: #007b83; font-weight: 700;'
  };

  const sorted = [...logs].sort((a, b) => new Date(b.status_date) - new Date(a.status_date));

  const rows = sorted.map(log => {
    const formattedDate = new Date(log.status_date).toLocaleDateString('uk-UA', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    return `
      <tr style="border-bottom: 1px solid var(--p-line); height: 40px;">
        <td style="padding: 10px; white-space: nowrap;">${formattedDate}</td>
        <td style="padding: 10px; font-weight: 600;">${log.user_name || 'Співробітник'}</td>
        <td style="padding: 10px; color: var(--p-muted);">${log.department || 'Департамент'}</td>
        <td style="padding: 10px; ${statusColors[log.status]}">${statusLabels[log.status] || log.status}</td>
      </tr>
    `;
  }).join('');

  return rows || `<tr><td colspan="4" style="padding:10px; text-align:center;">Немає даних</td></tr>`;
}

function drawStatusCharts(logs, isDark) {
  const counts = { office: 0, home: 0, sick: 0, vacation: 0, agreement: 0 };
  logs.forEach(log => {
    if (counts[log.status] !== undefined) counts[log.status]++;
  });

  const labels = ['Офіс 🏢', 'Вдома 🏡', 'Лікарняний 🏥', 'Відпустка 🌴', 'За домовл. 🤝'];
  const data = [counts.office, counts.home, counts.sick, counts.vacation, counts.agreement];
  const bgColors = ['rgba(19, 115, 51, 0.15)', 'rgba(26, 115, 232, 0.15)', 'rgba(197, 34, 31, 0.15)', 'rgba(134, 22, 166, 0.15)', 'rgba(0, 123, 131, 0.15)'];
  const borderColors = ['#137333', '#1a73e8', '#c5221f', '#8616a6', '#007b83'];

  const ctxDist = document.getElementById('chartStatusDistribution')?.getContext('2d');
  if (ctxDist) {
    chartInstances.statusDist = new Chart(ctxDist, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1.5,
          hoverBackgroundColor: borderColors,
          hoverBorderColor: borderColors
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: isDark ? '#cbd5e1' : '#1e293b',
              font: { family: 'var(--p-text)', weight: '600', size: 12 }
            }
          }
        }
      }
    });
  }

  const dateGroups = {};
  logs.forEach(log => {
    const d = log.status_date;
    if (!dateGroups[d]) {
      dateGroups[d] = { office: 0, home: 0, sick: 0, vacation: 0, agreement: 0 };
    }
    dateGroups[d][log.status]++;
  });

  const sortedDates = Object.keys(dateGroups).sort();
  const timelineOffice = [];
  const timelineHome = [];
  const timelineSick = [];
  const timelineVacation = [];
  const timelineAgreement = [];

  sortedDates.forEach(d => {
    timelineOffice.push(dateGroups[d].office);
    timelineHome.push(dateGroups[d].home);
    timelineSick.push(dateGroups[d].sick);
    timelineVacation.push(dateGroups[d].vacation);
    timelineAgreement.push(dateGroups[d].agreement);
  });

  const formattedDates = sortedDates.map(d => {
    const dt = new Date(d);
    return dt.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
  });

  const ctxTime = document.getElementById('chartStatusTimeline')?.getContext('2d');
  if (ctxTime) {
    chartInstances.statusTimeline = new Chart(ctxTime, {
      type: 'bar',
      data: {
        labels: formattedDates,
        datasets: [
          { label: 'Офіс 🏢', data: timelineOffice, backgroundColor: '#137333', borderRadius: 4 },
          { label: 'Вдома 🏡', data: timelineHome, backgroundColor: '#1a73e8', borderRadius: 4 },
          { label: 'Лікарняний 🏥', data: timelineSick, backgroundColor: '#c5221f', borderRadius: 4 },
          { label: 'Відпустка 🌴', data: timelineVacation, backgroundColor: '#8616a6', borderRadius: 4 },
          { label: 'За домовл. 🤝', data: timelineAgreement, backgroundColor: '#007b83', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: isDark ? '#94a3b8' : '#64748b' }
          },
          y: {
            stacked: true,
            ticks: {
              color: isDark ? '#94a3b8' : '#64748b',
              stepSize: 1,
              precision: 0
            },
            grid: { color: isDark ? '#334155' : '#e2e8f0' }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: isDark ? '#cbd5e1' : '#1e293b',
              font: { family: 'var(--p-text)', weight: '600', size: 12 }
            }
          }
        }
      }
    });
  }
}

// === Module 37-D Functions ===
let last37dLogs = [];

async function run37dReport() {
  const container = document.getElementById('results-37d');
  if (!container) return;
  
  container.innerHTML = '<div class="empty-state">Завантаження даних...</div>';

  const startDate = document.getElementById('report-37d-start-date')?.value;
  const endDate = document.getElementById('report-37d-end-date')?.value;
  const level = document.getElementById('report-37d-level')?.value || 'department-wide';
  const dept = document.getElementById('report-37d-department')?.value;
  const emp = document.getElementById('report-37d-employee')?.value || 'all';
  const status = document.getElementById('report-37d-status')?.value || 'all';
  const infoType = document.getElementById('report-37d-info-type')?.value || 'all';

  if (!startDate || !endDate) {
    alert("Будь ласка, вкажіть період.");
    container.innerHTML = '<div class="empty-state">Оберіть період для формування звіту.</div>';
    return;
  }

  let query = sb.from('skod_logs')
    .select('*')
    .eq('include_37d', true)
    .gte('event_date', startDate)
    .lte('event_date', endDate);

  // Apply level filters
  if (level === 'personal') {
    query = query.eq('user_id', currentUser.id);
  } else {
    if (level === 'department' && dept) {
      query = query.eq('department', dept);
    } else if (level === 'department-wide' && dept && dept !== 'all') {
      query = query.eq('department', dept);
    }
    
    if (emp && emp !== 'all') {
      query = query.eq('user_id', emp);
    }
  }

  // Filter by status_37d
  if (status !== 'all') {
    query = query.eq('status_37d', status);
  } else {
    query = query.ne('status_37d', 'скасовано / неактуально');
  }

  // Filter by info_type_37d
  if (infoType !== 'all') {
    query = query.eq('info_type_37d', infoType);
  }

  const { data, error } = await query.order('department').order('event_date', { ascending: true });

  if (error) {
    container.innerHTML = `<div class="empty-state" style="color:red">Помилка завантаження: ${error.message}</div>`;
    return;
  }

  last37dLogs = data || [];

  if (last37dLogs.length === 0) {
    container.innerHTML = '<div class="empty-state">Записи за вказаними фільтрами відсутні.</div>';
    return;
  }

  render37dPreview(last37dLogs);
}

function render37dPreview(logs) {
  const container = document.getElementById('results-37d');
  if (!container) return;

  const groups = {};
  logs.forEach(log => {
    const d = log.department || 'Інші відділи';
    const emp = log.user_name || 'Невідомий співробітник';
    if (!groups[d]) groups[d] = {};
    if (!groups[d][emp]) groups[d][emp] = [];
    groups[d][emp].push(log);
  });

  let tableRowsHtml = '';
  const sortedDepts = Object.keys(groups).sort();
  
  sortedDepts.forEach(dept => {
    const formattedDept = dept.startsWith('відділ') ? dept.charAt(0).toUpperCase() + dept.slice(1) : dept;
    tableRowsHtml += `
      <tr class="dept-header-row">
        <td colspan="2" style="font-weight: bold; background-color: #e2e8f0; font-family: 'Times New Roman', serif; text-transform: uppercase; font-size: 12pt; border: 1px solid #000;">
          ${formattedDept}
        </td>
      </tr>
    `;
    
    const emps = groups[dept];
    const sortedEmps = Object.keys(emps).sort();
    
    sortedEmps.forEach(empName => {
      tableRowsHtml += `
        <tr class="emp-header-row">
          <td colspan="2" style="font-weight: bold; padding-left: 20px; font-family: 'Times New Roman', serif; color: var(--accent-deep, #1e40af); background-color: #f8fafc; font-size: 12pt; border: 1px solid #000;">
            👤 Співробітник: ${empName}
          </td>
        </tr>
      `;
      
      emps[empName].forEach(log => {
        const docLink = log.document_link ? ` (Док: ${log.document_link})` : '';
        const contactText = log.contact_person_name ? ` [К-кт: ${log.contact_person_name}]` : '';
        
        tableRowsHtml += `
          <tr style="font-family: 'Times New Roman', serif; font-size: 12pt;">
            <td style="width: 50%; padding: 8px 8px 8px 30px; border: 1px solid #000; text-align: left;">
              ${log.process_name || 'Без назви процесу'}
            </td>
            <td style="width: 50%; padding: 8px; border: 1px solid #000; text-align: left;">
              ${log.current_state_text || 'Без опису стану'}${docLink}${contactText}
            </td>
          </tr>
        `;
      });
    });
  });

  const previewHtml = `
    <div class="report-37d-preview">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--p-line); padding-bottom: 10px;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--p-ink);">👁️ Попередній перегляд довідки</h3>
        <span style="font-size: 12px; color: var(--p-muted); font-weight: 600;">Знайдено записів: ${logs.length}</span>
      </div>
      
      <div style="background: white; padding: 30px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #cbd5e1; overflow-x: auto; width: 100%; box-sizing: border-box;">
        <div class="preview-title-37d" style="font-family: 'Times New Roman', Times, serif; font-size: 14pt; font-weight: bold; text-align: center; margin-bottom: 24px; color: #000;">
          ПІДСУМКОВА ІНФОРМАЦІЯ<br>
          щодо заходів та підготовки відповідних листів Департаментом стратегії універсального охоплення населення медичними послугами
        </div>
        
        <table class="table-37d-preview" style="width: 100%; border-collapse: collapse; border: 1px solid #000; font-family: 'Times New Roman', Times, serif;">
          <thead>
            <tr>
              <th style="width: 50%; padding: 8px; border: 1px solid #000; text-align: center; font-weight: bold; background: #f1f5f9; font-size: 12pt; color: #000;">Процеси</th>
              <th style="width: 50%; padding: 8px; border: 1px solid #000; text-align: center; font-weight: bold; background: #f1f5f9; font-size: 12pt; color: #000;">Поточний стан виконання</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.innerHTML = previewHtml;
}

function download37dExcel() {
  if (!last37dLogs || last37dLogs.length === 0) {
    alert("Будь ласка, спочатку сформуйте звіт.");
    return;
  }

  const startDate = document.getElementById('report-37d-start-date')?.value || new Date().toISOString().split('T')[0];
  const level = document.getElementById('report-37d-level')?.value || 'department-wide';
  const dept = document.getElementById('report-37d-department')?.value;
  const emp = document.getElementById('report-37d-employee')?.value || 'all';

  // 1. Sheet 1: Довідка 37-Д
  const ws1_data = [
    ["ПІДСУМКОВА ІНФОРМАЦІЯ"],
    ["щодо заходів та підготовки відповідних листів Департаментом стратегії універсального охоплення населення медичними послугами"],
    [],
    ["Процеси", "Поточний стан виконання"]
  ];

  const groups = {};
  last37dLogs.forEach(log => {
    const d = log.department || 'Інші відділи';
    const emp = log.user_name || 'Невідомий співробітник';
    if (!groups[d]) groups[d] = {};
    if (!groups[d][emp]) groups[d][emp] = [];
    groups[d][emp].push(log);
  });

  const sortedDepts = Object.keys(groups).sort();
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }
  ];

  let currentRowIdx = 4;
  sortedDepts.forEach(deptName => {
    ws1_data.push([deptName.toUpperCase(), ""]);
    merges.push({ s: { r: currentRowIdx, c: 0 }, e: { r: currentRowIdx, c: 1 } });
    currentRowIdx++;

    const emps = groups[deptName];
    const sortedEmps = Object.keys(emps).sort();

    sortedEmps.forEach(empName => {
      ws1_data.push([`  👤 Співробітник: ${empName}`, ""]);
      merges.push({ s: { r: currentRowIdx, c: 0 }, e: { r: currentRowIdx, c: 1 } });
      currentRowIdx++;

      emps[empName].forEach(log => {
        const docLink = log.document_link ? ` (Док: ${log.document_link})` : '';
        const contactText = log.contact_person_name ? ` [К-кт: ${log.contact_person_name}]` : '';
        ws1_data.push([
          "  " + (log.process_name || 'Без назви процесу'),
          (log.current_state_text || 'Без опису стану') + docLink + contactText
        ]);
        currentRowIdx++;
      });
    });
  });

  const ws1 = XLSX.utils.aoa_to_sheet(ws1_data);
  ws1['!merges'] = merges;
  ws1['!cols'] = [{ wch: 50 }, { wch: 60 }];

  // 2. Sheet 2: Реєстр завдань
  const ws2_data = [[
    "Дата", "Департамент", "Відділ", "Співробітник", "Процес", 
    "Поточний стан виконання", "Стан 37-Д", "Тип інформації", 
    "Документ / посилання", "Контактна особа", "Коментар керівника"
  ]];

  last37dLogs.forEach(log => {
    ws2_data.push([
      log.event_date ? new Date(log.event_date).toLocaleDateString('uk-UA') : '',
      "Департамент стратегії",
      log.department || '',
      log.user_name || '',
      log.process_name || '',
      log.current_state_text || '',
      log.status_37d || '',
      log.info_type_37d || '',
      log.document_link || '',
      log.contact_person_name || '',
      log.manager_comment || ''
    ]);
  });

  const ws2 = XLSX.utils.aoa_to_sheet(ws2_data);
  ws2['!cols'] = [
    { wch: 12 }, { wch: 25 }, { wch: 30 }, { wch: 25 }, { wch: 40 },
    { wch: 50 }, { wch: 18 }, { wch: 25 }, { wch: 20 }, { wch: 25 }, { wch: 30 }
  ];
  ws2['!views'] = [{ state: 'frozen', ySplit: 1 }];

  // 3. Sheet 3: Зведення
  const deptCounts = {};
  const statusCounts = {};
  const empCounts = {};
  
  last37dLogs.forEach(log => {
    const d = log.department || 'Інші відділи';
    deptCounts[d] = (deptCounts[d] || 0) + 1;

    const s = log.status_37d || 'невідомо';
    statusCounts[s] = (statusCounts[s] || 0) + 1;

    const e = log.user_name || 'невідомо';
    empCounts[e] = (empCounts[e] || 0) + 1;
  });

  const ws3_data = [
    ["ЗВЕДЕННЯ ПО ЗАВДАННЯХ 37-Д"],
    [],
    ["Кількість завдань за відділами"],
    ["Відділ", "Кількість"]
  ];

  Object.entries(deptCounts).forEach(([d, count]) => {
    ws3_data.push([d, count]);
  });

  ws3_data.push([]);
  ws3_data.push(["Кількість завдань за станами"]);
  ws3_data.push(["Стан 37-Д", "Кількість"]);

  Object.entries(statusCounts).forEach(([s, count]) => {
    ws3_data.push([s, count]);
  });

  ws3_data.push([]);
  ws3_data.push(["Кількість завдань за співробітниками"]);
  ws3_data.push(["Співробітник", "Кількість"]);

  Object.entries(empCounts).forEach(([e, count]) => {
    ws3_data.push([e, count]);
  });

  const ws3 = XLSX.utils.aoa_to_sheet(ws3_data);
  ws3['!cols'] = [{ wch: 40 }, { wch: 15 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Довідка 37-Д");
  XLSX.utils.book_append_sheet(wb, ws2, "Реєстр завдань");
  XLSX.utils.book_append_sheet(wb, ws3, "Зведення");

  let filenamePrefix = "37-Д_Департамент_стратегії";
  if (level === 'department' && dept) {
    filenamePrefix = `37-Д_Відділ_${dept.replace(/\s+/g, '_')}`;
  } else if (level === 'personal') {
    const uName = userProfile.full_name || "Співробітник";
    filenamePrefix = `37-Д_${uName.replace(/\s+/g, '_')}`;
  } else if (emp && emp !== 'all') {
    const eName = document.getElementById('report-37d-employee')?.selectedOptions[0]?.textContent || "Виконавець";
    filenamePrefix = `37-Д_${eName.replace(/\s+/g, '_')}`;
  }

  const filename = `${filenamePrefix}_${startDate}.xlsx`;
  XLSX.writeFile(wb, filename);
}

async function mark37dAsIncluded() {
  if (!last37dLogs || last37dLogs.length === 0) {
    alert("Немає записів для оновлення.");
    return;
  }

  const logsToUpdate = last37dLogs.filter(log => log.status_37d !== 'включено в довідку' && log.status_37d !== 'скасовано / неактуально');

  if (logsToUpdate.length === 0) {
    alert("Всі знайдені записи вже мають статус 'включено в довідку' або 'скасовано / неактуально'.");
    return;
  }

  const confirmMsg = `Ви впевнені, що хочете позначити ${logsToUpdate.length} записів як 'включено в довідку'?`;
  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById('btn-mark-included-37d');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Збереження...';
  }

  const ids = logsToUpdate.map(log => log.id);
  
  try {
    const { error } = await sb
      .from('skod_logs')
      .update({ 
        status_37d: 'включено в довідку',
        included_in_report_at: new Date().toISOString(),
        included_by_user_id: currentUser.id
      })
      .in('id', ids);

    if (error) {
      alert("Помилка при оновленні: " + error.message);
    } else {
      alert("Статуси записів успішно оновлено на 'включено в довідку'!");
      run37dReport();
    }
  } catch (err) {
    console.error(err);
    alert("Помилка: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✓ Включено в довідку';
    }
  }
}

// Modal for inline marking/editing tasks for 37-D
async function open37dModal(logId) {
  if (!lastLoggedData || !lastLoggedData.logs) return;
  const log = lastLoggedData.logs.find(l => l.id === logId);
  if (!log) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-37d-editor';

  const infoTypeOptions = [
    { value: 'заплановані зміни для ЗОЗ, аптек, пацієнтів', text: 'заплановані зміни для ЗОЗ, аптек, пацієнтів' },
    { value: 'презентація для публічного заходу', text: 'презентація для публічного заходу' },
    { value: 'аналітична довідка для МОЗ або іншого ЦОВВ', text: 'аналітична довідка для МОЗ або іншого ЦОВВ' },
    { value: 'масовий лист-роз’яснення', text: 'масовий лист-роз’яснення' },
    { value: 'інша інформація, що може потребувати комунікаційної підтримки', text: 'інша інформація, що може потребувати комунікаційної підтримки' }
  ];

  const statusOptions = [
    { value: 'заплановано', text: 'заплановано' },
    { value: 'у роботі', text: 'у роботі' },
    { value: 'виконано', text: 'виконано' },
    { value: 'очікує погодження', text: 'очікує погодження' },
    { value: 'готово до включення в довідку', text: 'готово до включення в довідку' },
    { value: 'включено в довідку', text: 'включено в довідку' },
    { value: 'скасовано / неактуально', text: 'скасовано / неактуально' }
  ];

  const currentInfoType = log.info_type_37d || 'інша інформація, що може потребувати комунікаційної підтримки';
  const currentStatus = log.status_37d || 'виконано';
  const currentProcessName = log.process_name || log.task_type || '';
  const currentCurrentStateText = log.current_state_text || log.description || '';
  const currentEventDate = log.event_date || log.log_date || new Date().toISOString().split('T')[0];
  const currentDocumentLink = log.document_link || '';
  const currentContactPersonName = log.contact_person_name || log.user_name || '';

  const infoTypeOptionsHtml = infoTypeOptions.map(opt => 
    `<option value="${opt.value}" ${opt.value === currentInfoType ? 'selected' : ''}>${opt.text}</option>`
  ).join('');

  const statusOptionsHtml = statusOptions.map(opt => 
    `<option value="${opt.value}" ${opt.value === currentStatus ? 'selected' : ''}>${opt.text}</option>`
  ).join('');

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>📝 Розмітка завдання для звіту 37-Д</h3>
        <button class="modal-close" id="modal-37d-close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <div class="skod-form-group">
          <label style="font-weight:700; color:var(--p-muted); margin-bottom:6px; display:block;">Процес *</label>
          <input type="text" id="m-process-name" value="${currentProcessName.replace(/"/g, '&quot;')}" placeholder="наприклад, Підготовка листа-роз'яснення..." style="width:100%; padding:11px 14px; border-radius:var(--pr-chip); border:1px solid var(--p-line); background:var(--p-surface); color:var(--p-ink); font-size:15px;">
        </div>

        <div class="skod-form-group">
          <label style="font-weight:700; color:var(--p-muted); margin-bottom:6px; display:block;">Тип інформації для 37-Д</label>
          <select id="m-info-type" style="width:100%; padding:11px 14px; border-radius:var(--pr-chip); border:1px solid var(--p-line); background:var(--p-surface); color:var(--p-ink); font-size:15px;">
            ${infoTypeOptionsHtml}
          </select>
        </div>

        <div class="skod-form-group">
          <label style="font-weight:700; color:var(--p-muted); margin-bottom:6px; display:block;">Поточний стан виконання *</label>
          <textarea id="m-current-state" rows="3" placeholder="наприклад, Виконано. Взяв участь..." style="width:100%; padding:11px 14px; border-radius:var(--pr-chip); border:1px solid var(--p-line); background:var(--p-surface); color:var(--p-ink); font-size:15px; font-family:var(--p-text);">${currentCurrentStateText}</textarea>
        </div>

        <div class="skod-form-group">
          <label style="font-weight:700; color:var(--p-muted); margin-bottom:6px; display:block;">Стан 37-Д *</label>
          <select id="m-status" style="width:100%; padding:11px 14px; border-radius:var(--pr-chip); border:1px solid var(--p-line); background:var(--p-surface); color:var(--p-ink); font-size:15px;">
            ${statusOptionsHtml}
          </select>
        </div>

        <div class="skod-form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div class="skod-form-group">
            <label style="font-weight:700; color:var(--p-muted); margin-bottom:6px; display:block;">Дата події / виконання *</label>
            <input type="date" id="m-event-date" value="${currentEventDate}" style="width:100%; padding:11px 14px; border-radius:var(--pr-chip); border:1px solid var(--p-line); background:var(--p-surface); color:var(--p-ink); font-size:15px;">
          </div>
          <div class="skod-form-group">
            <label style="font-weight:700; color:var(--p-muted); margin-bottom:6px; display:block;">Контактна особа *</label>
            <input type="text" id="m-contact-person" value="${currentContactPersonName.replace(/"/g, '&quot;')}" style="width:100%; padding:11px 14px; border-radius:var(--pr-chip); border:1px solid var(--p-line); background:var(--p-surface); color:var(--p-ink); font-size:15px;">
          </div>
        </div>

        <div class="skod-form-group">
          <label style="font-weight:700; color:var(--p-muted); margin-bottom:6px; display:block;">Посилання / номер документа</label>
          <input type="text" id="m-document-link" value="${currentDocumentLink.replace(/"/g, '&quot;')}" placeholder="наприклад, АСКОД № 1234/12-26..." style="width:100%; padding:11px 14px; border-radius:var(--pr-chip); border:1px solid var(--p-line); background:var(--p-surface); color:var(--p-ink); font-size:15px;">
        </div>
      </div>
      <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:12px; border-top:1px solid var(--p-soft); padding-top:16px; margin-top:8px;">
        ${log.include_37d ? `
          <button id="modal-37d-delete-btn" style="background:#dc2626; color:white; border:none; padding:10px 16px; border-radius:8px; font-weight:700; cursor:pointer; margin-right:auto;">
            ❌ Видалити зі звіту 37-Д
          </button>
        ` : ''}
        <button id="modal-37d-cancel-btn" style="background:var(--p-soft); border:1px solid var(--p-line); color:var(--p-ink); padding:10px 16px; border-radius:8px; font-weight:700; cursor:pointer;">
          Скасувати
        </button>
        <button id="modal-37d-save-btn" style="background:var(--accent); color:white; border:none; padding:10px 20px; border-radius:8px; font-weight:700; cursor:pointer;">
          Зберегти
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('m-process-name').focus();

  const closeModal = () => {
    overlay.remove();
  };

  document.getElementById('modal-37d-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-37d-cancel-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.getElementById('modal-37d-save-btn').addEventListener('click', async () => {
    const processName = document.getElementById('m-process-name').value.trim();
    const currentState = document.getElementById('m-current-state').value.trim();
    const statusVal = document.getElementById('m-status').value;
    const infoTypeVal = document.getElementById('m-info-type').value;
    const eventDateVal = document.getElementById('m-event-date').value;
    const contactPerson = document.getElementById('m-contact-person').value.trim();
    const documentLink = document.getElementById('m-document-link').value.trim();

    if (!processName || !currentState || !eventDateVal || !contactPerson) {
      alert("Будь ласка, заповніть усі обов'язкові поля (*)");
      return;
    }

    const saveBtn = document.getElementById('modal-37d-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Збереження...';

    try {
      const { error } = await sb.from('skod_logs')
        .update({
          include_37d: true,
          process_name: processName,
          current_state_text: currentState,
          status_37d: statusVal,
          info_type_37d: infoTypeVal,
          event_date: eventDateVal,
          contact_person_name: contactPerson,
          document_link: documentLink
        })
        .eq('id', logId);

      if (error) {
        alert("Помилка збереження: " + error.message);
      } else {
        closeModal();
        runReport(); // Refresh standard report list!
      }
    } catch (err) {
      console.error(err);
      alert("Помилка збереження: " + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Зберегти';
    }
  });

  const deleteBtn = document.getElementById('modal-37d-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!confirm("Ви впевнені, що хочете видалити цей запис зі звіту 37-Д?")) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Видалення...';

      try {
        const { error } = await sb.from('skod_logs')
          .update({
            include_37d: false
          })
          .eq('id', logId);

        if (error) {
          alert("Помилка видалення: " + error.message);
        } else {
          closeModal();
          runReport(); // Refresh standard report list!
        }
      } catch (err) {
        console.error(err);
        alert("Помилка видалення: " + err.message);
      } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = '❌ Видалити зі звіту 37-Д';
      }
    });
  }
}

// Global click event delegation for inline 37-D marking/editing buttons
document.addEventListener('click', (e) => {
  const addBtn = e.target.closest('.btn-add-37d');
  const editBtn = e.target.closest('.btn-edit-37d');
  if (addBtn) {
    const logId = addBtn.dataset.logId;
    open37dModal(logId);
  } else if (editBtn) {
    const logId = editBtn.dataset.logId;
    open37dModal(logId);
  }
});

export { sb };
