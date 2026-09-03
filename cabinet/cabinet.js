import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY));

// State Variables
let currentUser = null;
let userProfile = null;
let allTasks = [];
let todayLogs = [];
let departmentProfiles = [];
let activeTaskForLog = null;

// Constants matching NaVIPMG26 config
const COEFFICIENTS = {
  easy: 1.0,
  medium: 1.3,
  hard: 1.8,
  expert: 2.5
};

const BRANCH_CONFIG = {
  askod: {
    // Типи документів за довідником АСКОД (код — назва)
    types: [
      "01 — Лист",
      "22 — Судові документи",
      "44 — Претензія",
      "45 — Нормативно-правові акти",
      "46 — Запрошення",
      "47 — Лист-запит",
      "49 — Проект розпорядження КМУ",
      "50 — Проект ЗУ",
      "51 — Проект указу Президента України",
      "52 — Проект постанови КМУ",
      "Інше (вказати в описі)"
    ],
    // Справи за номенклатурою Департаменту (АСКОД)
    categories: [
      "1-01 — Заяви з кадрових питань",
      "1-02 — Заява про перерахування коштів",
      "1-03 — Документи при звільненні працівника",
      "1-04 — Оцінювання державних службовців",
      "1-05 — Проходження випробування",
      "8-01 — Закони, укази, акти ВРУ та Президента",
      "8-02 — Постанови, розпорядження КМУ",
      "8-03 — Доручення Верховної Ради України",
      "8-04 — Доручення Офісу Президента України",
      "8-05 — Доручення Кабінету Міністрів України",
      "8-06 — Доручення (листи) МОЗ України",
      "8-07 — Доручення Голови НСЗУ та заступників",
      "8-08 — Накази НСЗУ з основної діяльності",
      "8-09 — Депутатські запити та звернення",
      "8-10 — Запити на публічну інформацію",
      "8-11 — Звернення громадян",
      "8-12 — Службові записки, довідки з основної діяльності",
      "8-13 — Положення про Департамент, посадові інструкції",
      "8-14 — Листування з ЦОВВ та місцевими органами влади",
      "8-15 — Листування з підприємствами та установами",
      "8-16 — Доручення директора департаменту",
      "8-17 — Рішення колегії НСЗУ",
      "8-18 — Журнал інструктажів з охорони праці",
      "8-19 — Плани роботи Департаменту",
      "8-20 — Звіти про виконання планів Департаменту",
      "8.2-01 — Засідання колегіальних органів",
      "8.2-02 — Службові записки відділу",
      "8.2-03 — Положення про відділ, посадові інструкції",
      "8.2-04 — Плани роботи відділу",
      "8.2-05 — Звіти про виконання планів відділу",
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

// Start initialization on DOM content load
document.addEventListener('DOMContentLoaded', init);

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;

  if (!currentUser) {
    showAccessDenied("Для роботи з кабінетом необхідно авторизуватися.");
    return;
  }

  // Load profile
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  userProfile = profile || { id: currentUser.id, role: 'expert', full_name: currentUser.email.split('@')[0] };

  // Guard: expert and above can access
  const rolesOrder = ['guest', 'expert', 'manager', 'deputy_director', 'director', 'admin'];
  const userRoleIndex = rolesOrder.indexOf(userProfile.role);
  const expertIndex = rolesOrder.indexOf('expert');
  
  if (userRoleIndex < expertIndex) {
    showAccessDenied("Цей розділ доступний лише для фахівців та керівництва департаменту.");
    return;
  }

  // Populate User Header display
  renderProfileHeader();

  // Load initial data
  await loadDatabaseData();

  // Setup UI event bindings
  setupUIEvents();

  // Setup live recalculation
  updateLiveScore();

  // Set default start time to current time
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('start_time').value = `${hh}:${mm}`;
  document.getElementById('event_date').value = now.toISOString().split('T')[0];
  const wd = document.getElementById('work_date');
  wd.value = localTodayISO();
  wd.max = localTodayISO();   // майбутнє заборонено — довносити можна лише минуле

  // Auth State Change listener
  sb.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user ?? null;
    if (!currentUser) {
      window.location.reload();
    }
  });
}

function showAccessDenied(msg) {
  const container = document.querySelector('.cabinet-container');
  if (container) {
    container.innerHTML = `
      <div class="cabinet-panel" style="max-width: 500px; margin: 60px auto; text-align: center; padding: 40px;">
        <span style="font-size: 48px;">🔒</span>
        <h2 style="font-family: var(--p-display); margin-top: 20px; font-size: 20px; font-weight: 800;">Доступ обмежено</h2>
        <p style="color: var(--p-muted); margin-bottom: 24px; font-size: 14.5px;">${msg}</p>
        <button class="btn btn-primary" style="margin: 0 auto;" onclick="document.getElementById('auth-nav-btn')?.click()">Увійти в систему</button>
      </div>
    `;
  }
}

function renderProfileHeader() {
  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-display-role');
  const deptEl = document.getElementById('user-display-dept');
  const avatarEl = document.getElementById('user-avatar');

  if (nameEl) nameEl.textContent = userProfile.full_name;
  if (deptEl) deptEl.textContent = userProfile.Section || userProfile.department || 'Департамент стратегії універсального охоплення медичними послугами';
  
  if (roleEl) {
    const roleLabels = {
      expert: 'Експерт',
      manager: 'Керівник',
      deputy_director: 'Заступник',
      director: 'Директор',
      admin: 'Адмін'
    };
    roleEl.textContent = roleLabels[userProfile.role] || 'Співробітник';
    roleEl.className = `auth-role-badge role-${userProfile.role || 'registered'}`;
  }

  if (avatarEl && userProfile.full_name) {
    avatarEl.textContent = userProfile.full_name.charAt(0).toUpperCase();
  }

  // Кнопка «Надати доручення» — лише керівним ролям
  const assignBtn = document.getElementById('assign-task-btn');
  if (assignBtn) {
    const MANAGER_ROLES = ['manager', 'deputy_director', 'director', 'admin'];
    assignBtn.style.display = MANAGER_ROLES.includes(userProfile.role) ? '' : 'none';
  }
}

/** Сьогодні у форматі YYYY-MM-DD за локальним часом (ISO від UTC вночі бреше). */
function localTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadDatabaseData() {
  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Fetch assigned tasks
  const { data: tasks, error: tasksErr } = await sb
    .from('assigned_tasks')
    .select('*')
    .eq('responsible_id', currentUser.id)
    .order('deadline', { ascending: true });

  if (tasksErr) {
    console.error("Error loading tasks:", tasksErr);
  }
  allTasks = tasks || [];

  // 2. Fetch today's skod logs
  const { data: logs, error: logsErr } = await sb
    .from('skod_logs')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('log_date', todayStr)
    .order('start_time', { ascending: false });

  if (logsErr) {
    console.error("Error loading today's logs:", logsErr);
  }
  todayLogs = logs || [];

  // 3. Fetch profiles for Form 37-D contact person
  const { data: profiles, error: profErr } = await sb
    .from('profiles')
    .select('id, full_name')
    .neq('role', 'guest')
    .order('full_name');
  
  if (profErr) {
    console.error("Error loading profiles:", profErr);
  }
  departmentProfiles = profiles || [];

  // Re-render UI segments
  renderMetrics();
  renderTasksList();
  populateTaskDropdown();
  renderTodayLogsFeed();
  populateContactPersonDropdown();
}

function renderMetrics() {
  const activeCountEl = document.getElementById('metric-active-count');
  const hotCountEl = document.getElementById('metric-hot-count');
  const overdueCountEl = document.getElementById('metric-overdue-count');
  const scoreValEl = document.getElementById('metric-score-value');

  // Filter tasks to find active (excluding planning/completed/rejected)
  const activeTasks = allTasks.filter(t => t.status !== 'completed' && t.status !== 'rejected');
  
  // Calculate hot and overdue
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let hotCount = 0;
  let overdueCount = 0;

  activeTasks.forEach(t => {
    if (!t.deadline) return;
    const dl = new Date(t.deadline);
    dl.setHours(0, 0, 0, 0);

    const diffTime = dl - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      overdueCount++;
    } else if (diffDays <= 2) {
      hotCount++;
    }
  });

  // Calculate today's logged hours
  const totalMinutes = todayLogs.reduce((acc, log) => acc + (log.duration_minutes || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);

  if (activeCountEl) activeCountEl.textContent = activeTasks.length;
  if (hotCountEl) hotCountEl.textContent = hotCount;
  if (overdueCountEl) overdueCountEl.textContent = overdueCount;
  if (scoreValEl) scoreValEl.textContent = `${totalHours} год`;

  // Бейдж-лічильник і сигнальна рамка панелі доручень
  const countChip = document.getElementById('tasks-count-chip');
  if (countChip) {
    countChip.textContent = activeTasks.length;
    countChip.style.display = activeTasks.length > 0 ? 'inline-flex' : 'none';
    countChip.classList.toggle('chip-danger', overdueCount > 0);
    countChip.classList.toggle('chip-hot', overdueCount === 0 && hotCount > 0);
  }
  const tasksPanel = document.getElementById('tasks-panel');
  if (tasksPanel) {
    tasksPanel.classList.toggle('has-overdue', overdueCount > 0);
    tasksPanel.classList.toggle('has-hot', overdueCount === 0 && hotCount > 0);
  }
}

function renderTasksList(filter = 'active') {
  const container = document.getElementById('cabinet-tasks-list');
  if (!container) return;

  container.innerHTML = '';

  const activeTasks = allTasks.filter(t => t.status !== 'completed' && t.status !== 'rejected');
  let filtered = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (filter === 'active') {
    filtered = activeTasks.filter(t => !t.is_ongoing);
  } else if (filter === 'hot') {
    filtered = activeTasks.filter(t => {
      if (!t.deadline) return false;
      const dl = new Date(t.deadline);
      const diff = Math.ceil((dl - today) / (1000 * 60 * 60 * 24));
      return diff >= 0 && diff <= 2;
    });
  } else if (filter === 'overdue') {
    filtered = activeTasks.filter(t => {
      if (!t.deadline) return false;
      const dl = new Date(t.deadline);
      return dl < today;
    });
  } else if (filter === 'ongoing') {
    filtered = allTasks.filter(t => t.is_ongoing && t.status !== 'completed');
  } else {
    // all
    filtered = allTasks;
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">Не знайдено доручень у цій категорії.</div>';
    return;
  }

  filtered.forEach(t => {
    const card = document.createElement('div');
    
    // Determine urgency classes and badges
    let urgencyClass = '';
    let dlClass = 'normal';
    let dlText = '';
    
    if (t.status === 'completed') {
      dlClass = 'completed';
      dlText = 'Виконано';
    } else if (t.is_ongoing) {
      urgencyClass = 'task-ongoing';
      dlClass = 'normal';
      dlText = 'Постійне';
    } else if (t.deadline) {
      const dl = new Date(t.deadline);
      dl.setHours(0, 0, 0, 0);
      const diff = Math.ceil((dl - today) / (1000 * 60 * 60 * 24));
      const formattedDate = dl.toLocaleDateString('uk-UA');

      if (diff < 0) {
        urgencyClass = 'task-overdue';
        dlClass = 'overdue';
        dlText = `Прострочено: до ${formattedDate}`;
      } else if (diff <= 2) {
        urgencyClass = 'task-hot';
        dlClass = 'hot';
        dlText = `Гаряче: до ${formattedDate}`;
      } else {
        dlClass = 'normal';
        dlText = `до ${formattedDate}`;
      }
    }

    card.className = `task-card ${urgencyClass}`;
    card.dataset.id = t.id;

    // Subtasks count calculation
    const subtasks = t.subtasks || [];
    const totalSubs = subtasks.length;
    const completedSubs = subtasks.filter(s => s.completed).length;
    const subtasksBadge = totalSubs > 0 ? `✔️ ${completedSubs}/${totalSubs}` : '';

    // Бейдж гарячого копіювання номера листа АСКОД (копіюється чистий номер, без «№»)
    const askodBadge = (t.task_type === 'askod' && t.askod_number)
      ? `<button type="button" class="task-askod-copy" data-num="${escapeHtml(t.askod_number)}" title="Скопіювати номер листа">📋 ${escapeHtml(t.askod_number)}</button>`
      : '';

    card.innerHTML = `
      <div class="task-card-header">
        <h3 class="task-card-title">${escapeHtml(t.title)}</h3>
        ${askodBadge}
        <span class="task-card-date ${dlClass}">${dlText}</span>
      </div>
      ${t.description ? `<p class="task-card-desc">${escapeHtml(t.description)}</p>` : ''}
      <div class="task-card-footer">
        <div class="task-progress-box">
          <div class="task-progress-bar-bg">
            <div class="task-progress-bar-fg" style="width: ${t.progress || 0}%"></div>
          </div>
          <span class="task-progress-pct">${t.progress || 0}%</span>
        </div>
        ${subtasksBadge ? `<span class="task-checklist-badge">${subtasksBadge}</span>` : ''}
        <div class="task-card-actions">
          <button class="btn-card-action btn-log-trigger" data-id="${t.id}">Внести роботу</button>
        </div>
      </div>
    `;

    // Click on "Log Work" button directly pre-fills the logging form
    const logBtn = card.querySelector('.btn-log-trigger');
    logBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectTaskForWorkLog(t.id);
    });

    // Гаряче копіювання номера листа (не відкриває модалку)
    const copyBtn = card.querySelector('.task-askod-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const num = copyBtn.dataset.num;
        try {
          await navigator.clipboard.writeText(num);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = num;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        const original = copyBtn.textContent;
        copyBtn.textContent = '✓ Скопійовано';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = original;
          copyBtn.classList.remove('copied');
        }, 1500);
      });
    }

    // Click on the rest of card opens details modal
    card.addEventListener('click', () => {
      openTaskDetailsModal(t.id);
    });

    container.appendChild(card);
  });
}

function selectTaskForWorkLog(taskId) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;

  activeTaskForLog = task;

  // Switch form branch to Tasks
  const branchSel = document.getElementById('task_branch');
  branchSel.value = 'tasks';
  handleBranchChange();

  // Select this task in the dropdown
  const taskSel = document.getElementById('link_assigned_task');
  taskSel.value = taskId;
  handleTaskChange();

  // Focus and scroll to logging form
  const formPanel = document.querySelector('.log-form-panel');
  if (formPanel) {
    formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Highlight the panel briefly
    formPanel.style.transition = 'outline 0.3s';
    formPanel.style.outline = '2px solid var(--accent)';
    setTimeout(() => {
      formPanel.style.outline = 'none';
    }, 1500);
  }
}

function populateTaskDropdown() {
  const select = document.getElementById('link_assigned_task');
  if (!select) return;

  const currentSelection = select.value;
  select.innerHTML = '<option value="" disabled selected>-- Оберіть доручення зі списку --</option>';

  const activeTasks = allTasks.filter(t => t.status !== 'completed' && t.status !== 'rejected');
  
  if (activeTasks.length === 0) {
    select.innerHTML = '<option value="" disabled>У вас немає активних доручень</option>';
    return;
  }

  activeTasks.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    let label = t.is_ongoing ? `[Постійне] ${t.title}` : t.title;
    if (t.description) {
      const shortDesc = t.description.length > 60 ? t.description.slice(0, 60) + '…' : t.description;
      label += ` — ${shortDesc}`;
    }
    opt.textContent = label;
    select.appendChild(opt);
  });

  if (currentSelection && activeTasks.some(t => t.id === currentSelection)) {
    select.value = currentSelection;
  }
}

function populateContactPersonDropdown() {
  const select = document.getElementById('contact_person_select');
  if (!select) return;

  select.innerHTML = '<option value="" disabled selected>-- Оберіть контактну особу --</option>';

  departmentProfiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.full_name;
    select.appendChild(opt);
  });
}

function handleBranchChange() {
  const branch = document.getElementById('task_branch').value;
  const taskSelectorGroup = document.getElementById('form-assigned-task-group');
  const checklistGroup = document.getElementById('subtask-checklist-group');
  const progressGroup = document.getElementById('task-progress-group');
  const askodGroup = document.getElementById('form-askod-reg-group');
  const askodReplyGroup = document.getElementById('form-askod-reply-group');
  const typeWrapper = document.getElementById('task-type-wrapper');
  const catWrapper = document.getElementById('task-category-wrapper');

  const askodToggleGroup = document.getElementById('task-askod-toggle-group');
  const closeGroup = document.getElementById('task-close-group');

  if (branch === 'tasks') {
    taskSelectorGroup.style.display = 'block';
    askodGroup.style.display = 'none';
    askodReplyGroup.style.display = 'none';
    typeWrapper.style.display = 'none';
    catWrapper.style.display = 'none';

    // Trigger checklist show if task is already selected
    handleTaskChange();
  } else {
    taskSelectorGroup.style.display = 'none';
    checklistGroup.style.display = 'none';
    progressGroup.style.display = 'none';
    if (askodToggleGroup) askodToggleGroup.style.display = 'none';
    if (closeGroup) closeGroup.style.display = 'none';
    typeWrapper.style.display = 'block';
    catWrapper.style.display = 'block';

    if (branch === 'askod') {
      askodGroup.style.display = 'block';
      askodReplyGroup.style.display = 'block';
      const regLabel = askodGroup.querySelector('label');
      if (regLabel) regLabel.textContent = 'Реєстраційний номер в АСКОД *';
      const replyInput = document.getElementById('askod_reply_number');
      if (replyInput) replyInput.value = '';
    } else {
      askodGroup.style.display = 'none';
      askodReplyGroup.style.display = 'none';
    }

    populateTypesAndCategories(branch);
  }
  
  updateLiveScore();
}

// ── Запам'ятовування вибраних типів і категорій ──────────────
// Вибір зберігається окремо для кожної гілки (АСКОД / департамент / доручення):
// набори варіантів там різні, тож спільний список був би безглуздим.
const STICKY_ON_KEY = 'skod-sticky-enabled';
const stickyKey = branch => `skod-sticky-${branch}`;

function stickyEnabled() {
  try { return localStorage.getItem(STICKY_ON_KEY) !== '0'; } catch (_) { return false; }
}

function setStickyEnabled(on) {
  try { localStorage.setItem(STICKY_ON_KEY, on ? '1' : '0'); } catch (_) { /* приватний режим */ }
}

function readSticky(branch) {
  try {
    const raw = localStorage.getItem(stickyKey(branch));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && Array.isArray(parsed.types) && Array.isArray(parsed.categories)) ? parsed : null;
  } catch (_) { return null; }
}

function saveSticky(branch) {
  if (!stickyEnabled()) return;
  const pick = sel => Array.from(document.querySelectorAll(sel)).filter(i => i.checked).map(i => i.value);
  try {
    localStorage.setItem(stickyKey(branch), JSON.stringify({
      types: pick('.task-type-cb'),
      categories: pick('.task-category-cb')
    }));
  } catch (_) { /* приватний режим */ }
}

function populateTypesAndCategories(branch) {
  const typeContainer = document.getElementById('task_type_container');
  const catContainer = document.getElementById('task_category_container');
  if (!typeContainer || !catContainer) return;

  const config = BRANCH_CONFIG[branch];

  // Збережений вибір застосовуємо, лише якщо ці варіанти ще існують у довіднику:
  // склад типів і категорій змінюється, а старе значення інакше «зависло» б
  const saved = stickyEnabled() ? readSticky(branch) : null;
  const savedTypes = saved ? saved.types.filter(v => config.types.includes(v)) : [];
  const savedCats = saved ? saved.categories.filter(v => config.categories.includes(v)) : [];

  const build = (container, items, chosen, name, cls) => {
    container.innerHTML = '';
    items.forEach((value, index) => {
      const isChecked = chosen.length ? chosen.includes(value) : index === 0;
      const label = document.createElement('label');
      label.className = 'checkbox-opt';
      label.innerHTML = `<input type="checkbox" name="${name}" class="${cls}" value="${value}" ${isChecked ? 'checked' : ''}> <span>${value}</span>`;
      container.appendChild(label);
    });
  };

  build(typeContainer, config.types, savedTypes, 'task_type', 'task-type-cb');
  build(catContainer, config.categories, savedCats, 'task_category', 'task-category-cb');

  // Re-attach triggers for live score updates
  [typeContainer, catContainer].forEach(c => c.querySelectorAll('input').forEach(i => {
    i.addEventListener('change', updateLiveScore);
    i.addEventListener('change', () => saveSticky(branch));
  }));
}

function initStickyToggle() {
  const toggle = document.getElementById('sticky_types');
  if (!toggle) return;
  toggle.checked = stickyEnabled();
  toggle.addEventListener('change', () => {
    setStickyEnabled(toggle.checked);
    const branch = document.getElementById('task_branch')?.value;
    if (!branch) return;
    if (toggle.checked) saveSticky(branch);
    else populateTypesAndCategories(branch); // повертаємо типовий вибір
  });
}

function handleTaskChange() {
  const taskId = document.getElementById('link_assigned_task').value;
  const checklistGroup = document.getElementById('subtask-checklist-group');
  const progressGroup = document.getElementById('task-progress-group');
  const checklistContainer = document.getElementById('cabinet-subtasks-checklist');
  const progressInput = document.getElementById('task_progress');
  const progressVal = document.getElementById('task_progress_val');

  const descHint = document.getElementById('task-desc-hint');
  const askodToggleGroup = document.getElementById('task-askod-toggle-group');

  if (!taskId) {
    checklistGroup.style.display = 'none';
    progressGroup.style.display = 'none';
    if (descHint) descHint.style.display = 'none';
    if (askodToggleGroup) askodToggleGroup.style.display = 'none';
    const closeGroup = document.getElementById('task-close-group');
    if (closeGroup) closeGroup.style.display = 'none';
    activeTaskForLog = null;
    return;
  }

  const task = allTasks.find(t => t.id === taskId);
  activeTaskForLog = task;

  if (!task) return;

  // Show task description under the select so the executor sees what the task is about
  if (descHint) {
    if (task.description) {
      descHint.textContent = `📝 ${task.description}`;
      descHint.style.display = 'block';
    } else {
      descHint.style.display = 'none';
    }
  }

  // Перемикач «Робота в АСКОД за цим дорученням»: доступний для будь-якого доручення,
  // для АСКОД-доручень вмикається автоматично; «відповідь на лист №» підставляємо
  // з вхідного номера доручення
  const isAskodTask = task.task_type === 'askod' || !!task.askod_number;
  const askodToggle = document.getElementById('task_link_askod');
  if (askodToggleGroup && askodToggle) {
    askodToggleGroup.style.display = 'block';
    askodToggle.checked = isAskodTask;

    const regInput = document.getElementById('askod_reg_number');
    const replyInput = document.getElementById('askod_reply_number');
    if (regInput) regInput.value = '';
    if (replyInput) replyInput.value = task.askod_number || '';

    toggleTaskAskodFields();
  }

  // Populate progress slider
  if (progressInput && progressVal) {
    progressInput.value = task.progress || 0;
    progressVal.textContent = `${task.progress || 0}%`;
    progressGroup.style.display = 'block';
  }

  // Populate subtasks checklist
  const subtasks = task.subtasks || [];
  if (subtasks.length > 0 && checklistContainer) {
    checklistContainer.innerHTML = '';
    subtasks.forEach(s => {
      const label = document.createElement('label');
      label.className = 'checkbox-opt';
      label.innerHTML = `
        <input type="checkbox" class="subtask-log-cb" data-id="${s.id}" ${s.completed ? 'checked' : ''}>
        <span>${escapeHtml(s.title)}</span>
      `;
      
      // Auto-update slider value when checklist checkboxes are checked
      const cb = label.querySelector('input');
      cb.addEventListener('change', () => {
        recalculateProgressFromChecklist();
      });

      checklistContainer.appendChild(label);
    });
    checklistGroup.style.display = 'block';
  } else {
    checklistGroup.style.display = 'none';
  }
}

// Показ полів АСКОД у гілці доручень залежно від перемикача «Робота в АСКОД»
function toggleTaskAskodFields() {
  const branch = document.getElementById('task_branch').value;
  if (branch !== 'tasks') return;

  const on = document.getElementById('task_link_askod')?.checked || false;
  const askodGroup = document.getElementById('form-askod-reg-group');
  const askodReplyGroup = document.getElementById('form-askod-reply-group');
  const closeGroup = document.getElementById('task-close-group');
  const closeCb = document.getElementById('task_close_on_log');

  if (askodGroup) {
    askodGroup.style.display = on ? 'block' : 'none';
    const regLabel = askodGroup.querySelector('label');
    if (regLabel) regLabel.textContent = on ? "Вихідний реєстраційний № в АСКОД (необов'язково)" : 'Реєстраційний номер в АСКОД *';
  }
  if (askodReplyGroup) askodReplyGroup.style.display = on ? 'block' : 'none';
  if (closeGroup) closeGroup.style.display = on ? 'block' : 'none';
  // Внесення даних в АСКОД за замовчуванням закриває доручення (можна вимкнути)
  if (closeCb) closeCb.checked = on;
}

function recalculateProgressFromChecklist() {
  const checkboxes = document.querySelectorAll('.subtask-log-cb');
  const progressInput = document.getElementById('task_progress');
  const progressVal = document.getElementById('task_progress_val');
  if (checkboxes.length === 0 || !progressInput || !progressVal) return;

  const total = checkboxes.length;
  const checked = Array.from(checkboxes).filter(cb => cb.checked).length;
  const pct = Math.round((checked / total) * 100);

  progressInput.value = pct;
  progressVal.textContent = `${pct}%`;
}

function updateLiveScore() {
  const durationPreset = document.getElementById('duration_preset').value;
  const customMinutesInput = document.getElementById('duration_minutes');
  
  let duration = 60; // default 1 hour
  if (durationPreset === 'custom') {
    if (customMinutesInput) {
      customMinutesInput.style.display = 'block';
      duration = parseInt(customMinutesInput.value, 10) || 0;
    }
  } else {
    if (customMinutesInput) customMinutesInput.style.display = 'none';
    duration = parseInt(durationPreset, 10) || 60;
  }

  const severity = document.getElementById('severity_level').value;
  const coef = COEFFICIENTS[severity] || 1.0;
  
  const score = parseFloat(((duration / 60) * coef).toFixed(2));

  const liveScoreVal = document.getElementById('live-score-val');
  if (liveScoreVal) {
    liveScoreVal.textContent = `${score.toFixed(2)} балів`;
  }
}

function renderTodayLogsFeed() {
  const container = document.getElementById('today-logs-list');
  const summaryLabel = document.getElementById('today-summary-label');
  if (!container) return;

  container.innerHTML = '';

  if (todayLogs.length === 0) {
    container.innerHTML = '<div class="empty-state">Сьогодні ви ще не вносили записи про діяльність.</div>';
    if (summaryLabel) summaryLabel.textContent = '0.0 год · 0.00 балів';
    return;
  }

  let totalMinutes = 0;
  let totalScore = 0;

  todayLogs.forEach(log => {
    totalMinutes += (log.duration_minutes || 0);
    totalScore += parseFloat(log.score || 0);

    const card = document.createElement('div');
    card.className = 'today-log-card';

    let branchBadgeClass = 'dept';
    let branchLabel = 'Деп';
    if (log.branch === 'askod') {
      branchBadgeClass = 'askod';
      branchLabel = 'АСКОД';
    } else if (log.branch === 'tasks') {
      branchBadgeClass = 'tasks';
      branchLabel = 'Дор';
    }

    const startFormatted = log.start_time ? log.start_time.slice(0, 5) : '';

    // Підсвічений реєстраційний номер листа АСКОД + номер листа, на який надано відповідь
    const askodNumBadge = log.askod_reg_number
      ? `<span class="askod-num-badge" title="Реєстраційний номер в АСКОД">№ ${escapeHtml(log.askod_reg_number)}</span>`
      : '';
    const replyNumBadge = log.reply_to_number
      ? `<span class="reply-num-badge" title="Відповідь на вхідний лист">↩ на № ${escapeHtml(log.reply_to_number)}</span>`
      : '';

    card.innerHTML = `
      <div class="today-log-info">
        <div class="today-log-header">
          <span class="today-log-tag ${branchBadgeClass}">${branchLabel}</span>
          <span class="today-log-time">${startFormatted} · ${log.duration_minutes} хв</span>
          ${askodNumBadge}
          ${replyNumBadge}
        </div>
        <div class="today-log-desc" title="${escapeHtml(log.description)}">${escapeHtml(log.description)}</div>
      </div>
      <div class="today-log-points">${parseFloat(log.score).toFixed(2)} б.</div>
      <button class="btn-edit-log" data-id="${log.id}" title="Редагувати запис">✏️</button>
      <button class="btn-delete-log" data-id="${log.id}" title="Видалити">&times;</button>
    `;

    // Handle log editing
    const editBtn = card.querySelector('.btn-edit-log');
    editBtn.addEventListener('click', () => {
      openLogEditModal(log);
    });

    // Handle single log deletion
    const delBtn = card.querySelector('.btn-delete-log');
    delBtn.addEventListener('click', async () => {
      if (confirm(`Ви дійсно хочете видалити цей запис: "${log.description}"?`)) {
        const { error } = await sb.from('skod_logs').delete().eq('id', log.id);
        if (error) {
          alert("Помилка при видаленні запису: " + error.message);
        } else {
          await loadDatabaseData();
        }
      }
    });

    container.appendChild(card);
  });

  const totalHours = (totalMinutes / 60).toFixed(1);
  if (summaryLabel) {
    summaryLabel.textContent = `${totalHours} год · ${totalScore.toFixed(2)} балів`;
  }
}

// ── Log Edit Modal logic ─────────────────────────
let editingLog = null;

function openLogEditModal(log) {
  editingLog = log;

  document.getElementById('edit_start_time').value = log.start_time ? log.start_time.slice(0, 5) : '';
  const eld = document.getElementById('edit_log_date');
  eld.value = log.log_date || localTodayISO();
  eld.max = localTodayISO();
  document.getElementById('edit_duration').value = log.duration_minutes || 60;
  document.getElementById('edit_severity').value = log.severity_level || 'medium';
  document.getElementById('edit_askod_number').value = log.askod_reg_number || '';
  document.getElementById('edit_reply_number').value = log.reply_to_number || '';
  document.getElementById('edit_description').value = log.description || '';

  // Поля номерів АСКОД: для гілки АСКОД (обов'язкові) та записів за дорученням (необов'язкові)
  const showAskod = log.branch === 'askod' || log.branch === 'tasks';
  document.getElementById('edit-askod-num-group').style.display = showAskod ? 'flex' : 'none';
  document.getElementById('edit-askod-reply-group').style.display = showAskod ? 'flex' : 'none';

  document.getElementById('log-edit-modal').style.display = 'flex';
}

function closeLogEditModal() {
  editingLog = null;
  document.getElementById('log-edit-modal').style.display = 'none';
}

async function saveLogEdit() {
  if (!editingLog) return;

  const startVal = document.getElementById('edit_start_time').value;
  const editDate = document.getElementById('edit_log_date').value;
  const duration = parseInt(document.getElementById('edit_duration').value, 10);
  const severity = document.getElementById('edit_severity').value;
  const askodNum = document.getElementById('edit_askod_number').value.trim();
  const replyNum = document.getElementById('edit_reply_number').value.trim();
  const desc = document.getElementById('edit_description').value.trim();

  if (!desc) {
    alert("Вкажіть короткий опис виконаної роботи.");
    return;
  }
  if (!editDate) {
    alert("Вкажіть дату роботи.");
    return;
  }
  if (editDate > localTodayISO()) {
    alert("Дата роботи не може бути в майбутньому.");
    return;
  }
  if (!duration || duration < 5) {
    alert("Вкажіть коректну тривалість (від 5 хвилин).");
    return;
  }
  if (editingLog.branch === 'askod' && !askodNum) {
    alert("Вкажіть реєстраційний номер АСКОД.");
    return;
  }

  const coef = COEFFICIENTS[severity] || 1.0;
  const score = parseFloat(((duration / 60) * coef).toFixed(2));

  const btn = document.getElementById('log-edit-save');
  btn.disabled = true;
  btn.textContent = 'Збереження...';

  const updateData = {
    log_date: editDate,
    start_time: startVal ? startVal + ':00' : editingLog.start_time,
    duration_minutes: duration,
    severity_level: severity,
    complexity_coefficient: coef,
    score: score,
    description: desc
  };

  if (editingLog.branch === 'askod' || editingLog.branch === 'tasks') {
    updateData.askod_reg_number = askodNum || null;
    updateData.reply_to_number = replyNum || null;
  }

  const { error } = await sb.from('skod_logs').update(updateData).eq('id', editingLog.id);

  btn.disabled = false;
  btn.textContent = '💾 Зберегти зміни';

  if (error) {
    alert("Помилка збереження змін: " + error.message);
    return;
  }

  closeLogEditModal();
  await loadDatabaseData();
}

async function handleLogFormSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-task');
  btn.disabled = true;
  btn.textContent = 'Збереження...';

  try {
    const branch = document.getElementById('task_branch').value;
    const startVal = document.getElementById('start_time').value;
    const presetVal = document.getElementById('duration_preset').value;
    const customMin = document.getElementById('duration_minutes').value;
    const severity = document.getElementById('severity_level').value;
    const desc = document.getElementById('description').value.trim();
    const include37d = document.getElementById('include_37d').checked;

    let duration = 60;
    if (presetVal === 'custom') {
      duration = parseInt(customMin, 10) || 30;
    } else {
      duration = parseInt(presetVal, 10) || 60;
    }

    if (!desc) {
      alert("Вкажіть короткий опис виконаної роботи.");
      btn.disabled = false;
      btn.textContent = '💾 Зберегти виконану роботу';
      return;
    }

    // Дата роботи: типово сьогодні, можна довнести заднім числом; майбутнє — ні
    const workDate = document.getElementById('work_date').value;
    const todayISO = localTodayISO();
    if (!workDate) {
      alert("Вкажіть дату роботи.");
      btn.disabled = false;
      btn.textContent = '💾 Зберегти виконану роботу';
      return;
    }
    if (workDate > todayISO) {
      alert("Дата роботи не може бути в майбутньому.");
      btn.disabled = false;
      btn.textContent = '💾 Зберегти виконану роботу';
      return;
    }

    const coef = COEFFICIENTS[severity] || 1.0;
    const score = parseFloat(((duration / 60) * coef).toFixed(2));

    // Dynamic Task type and category values
    let taskType = 'Доручення';
    let taskCategory = 'Виконання доручення';

    if (branch !== 'tasks') {
      const typeCb = document.querySelector('.task-type-cb:checked');
      const catCb = document.querySelector('.task-category-cb:checked');
      taskType = typeCb ? typeCb.value : 'Інше';
      taskCategory = catCb ? catCb.value : 'Інше';
    }

    let askodNum = null;
    let askodReplyNum = null;
    let assignedTaskId = null;
    let closeTaskOnLog = false;

    if (branch === 'askod') {
      askodNum = document.getElementById('askod_reg_number').value.trim();
      askodReplyNum = document.getElementById('askod_reply_number').value.trim() || null;
      if (!askodNum) {
        alert("Вкажіть реєстраційний номер АСКОД.");
        btn.disabled = false;
        btn.textContent = '💾 Зберегти виконану роботу';
        return;
      }
    } else if (branch === 'tasks') {
      assignedTaskId = document.getElementById('link_assigned_task').value;
      if (!assignedTaskId) {
        alert("Оберіть доручення зі списку.");
        btn.disabled = false;
        btn.textContent = '💾 Зберегти виконану роботу';
        return;
      }
      // Робота в АСКОД за дорученням: номери зберігаємо разом із записом (необов'язкові),
      // а внесення в АСКОД (якщо не вимкнено чекбокс) закриває доручення
      const askodLinked = document.getElementById('task_link_askod')?.checked || false;
      if (askodLinked) {
        askodNum = document.getElementById('askod_reg_number').value.trim() || null;
        askodReplyNum = document.getElementById('askod_reply_number').value.trim() || null;
        closeTaskOnLog = document.getElementById('task_close_on_log')?.checked || false;
      }
    }

    // Build log model
    const logData = {
      user_id: currentUser.id,
      user_name: userProfile.full_name,
      department: userProfile.Section || userProfile.department || 'Департамент стратегії НСЗУ',
      log_date: workDate,
      start_time: startVal + ':00',
      duration_minutes: duration,
      branch: branch,
      task_type: taskType,
      category: taskCategory,
      severity_level: severity,
      complexity_coefficient: coef,
      score: score,
      status: 'completed',
      description: desc,
      assigned_task_id: assignedTaskId,
      askod_reg_number: askodNum,
      reply_to_number: askodReplyNum,
      include_37d: include37d
    };

    // Include Form 37-D values if checkbox active
    if (include37d) {
      const process = document.getElementById('process_name').value.trim();
      const infoType = document.getElementById('info_type_37d').value;
      const state = document.getElementById('current_state_text').value.trim();
      const status37d = document.getElementById('status_37d').value;
      const evDate = document.getElementById('event_date').value;
      const contactSelect = document.getElementById('contact_person_select');
      const contactId = contactSelect.value;
      const contactName = contactId ? contactSelect.options[contactSelect.selectedIndex].text : null;
      const docLink = document.getElementById('document_link').value.trim();

      if (!process || !state) {
        alert("Заповніть назву процесу та поточний стан для Форми 37-Д.");
        btn.disabled = false;
        btn.textContent = '💾 Зберегти виконану роботу';
        return;
      }

      logData.process_name = process;
      logData.info_type_37d = infoType;
      logData.current_state_text = state;
      logData.status_37d = status37d;
      logData.event_date = evDate;
      logData.contact_person_id = contactId || null;
      logData.contact_person_name = contactName;
      logData.document_link = docLink;
    }

    // 1. Save Log Entry
    const { error: logErr } = await sb.from('skod_logs').insert([logData]);
    if (logErr) throw logErr;

    // 2. If branch is Tasks, update progress, subtasks & comments of the task
    if (branch === 'tasks' && activeTaskForLog) {
      let progressVal = parseInt(document.getElementById('task_progress').value, 10) || 0;
      const subtaskBoxes = document.querySelectorAll('.subtask-log-cb');

      const subtasks = activeTaskForLog.subtasks || [];
      subtaskBoxes.forEach(cb => {
        const subId = cb.dataset.id;
        const sub = subtasks.find(s => s.id === subId);
        if (sub) {
          sub.completed = cb.checked;
        }
      });

      // Закриття доручення після внесення відповіді в АСКОД
      if (closeTaskOnLog) {
        progressVal = 100;
      }

      // Status logic: if progress is 100%, set status to completed. Otherwise set to in_progress
      let taskStatus = activeTaskForLog.status;
      if (progressVal === 100) {
        taskStatus = 'completed';
      } else if (activeTaskForLog.status === 'assigned') {
        taskStatus = 'in_progress';
      }

      // Add system comment to document this progress log
      const systemMsg = closeTaskOnLog
        ? `${userProfile.full_name} вніс роботу (${duration} хв), зареєстрував відповідь в АСКОД${askodNum ? ` № ${askodNum}` : ''} та закрив доручення: "${desc}"`
        : `${userProfile.full_name} вніс роботу (${duration} хв) та оновив прогрес до ${progressVal}%: "${desc}"`;
      const comments = [...(activeTaskForLog.comments || []), {
        id: crypto.randomUUID(),
        author: 'Система',
        role: 'system',
        text: systemMsg,
        timestamp: new Date().toISOString(),
        type: 'system'
      }];

      const { error: taskErr } = await sb
        .from('assigned_tasks')
        .update({
          progress: progressVal,
          subtasks: subtasks,
          status: taskStatus,
          comments: comments
        })
        .eq('id', activeTaskForLog.id);

      if (taskErr) {
        console.error("Failed to update assigned task details:", taskErr);
      }
    }

    // Success reset and reload
    document.getElementById('cabinet-log-form').reset();
    document.getElementById('include_37d').checked = false;
    document.getElementById('block-37d-fields').style.display = 'none';

    // form.reset() зносить і галочку «запам'ятовувати», і самі чекбокси —
    // відновлюємо стан і перезбираємо типи/категорії для поточної гілки
    initStickyToggle();
    handleBranchChange();
    
    // Set time/date defaults again
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('start_time').value = `${hh}:${mm}`;
    document.getElementById('event_date').value = now.toISOString().split('T')[0];
    document.getElementById('work_date').value = localTodayISO();
    document.getElementById('work_date').max = localTodayISO();

    // Reload databases
    await loadDatabaseData();
    activeTaskForLog = null;
    if (workDate !== todayISO) {
      const [y, m, dd] = workDate.split('-');
      alert(`Роботу збережено в СКО-Д за ${dd}.${m}.${y}.\nУ списку «Виконана робота» показуються записи лише за сьогодні, тому цей запис там не зʼявиться.`);
    } else {
      alert("Роботу успішно збережено в СКО-Д!");
    }

  } catch(err) {
    console.error("Save log error:", err);
    alert("Помилка збереження: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Зберегти виконану роботу';
  }
}

// ── Task Details Modal logic ──────────────────────
async function openTaskDetailsModal(taskId) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;

  const modal = document.getElementById('cabinet-task-modal');
  const titleEl = document.getElementById('modal-task-title');
  const descEl = document.getElementById('modal-task-desc');
  const statusEl = document.getElementById('modal-task-status');
  const deadlineEl = document.getElementById('modal-task-deadline');
  const checklistSection = document.getElementById('modal-subtasks-section');
  const checklistContainer = document.getElementById('modal-task-checklist');
  const attachmentsSection = document.getElementById('modal-attachments-section');
  const attachmentsContainer = document.getElementById('modal-task-attachments');
  const commentsContainer = document.getElementById('modal-task-comments');

  // Fill Header details
  if (titleEl) titleEl.textContent = task.title;
  if (descEl) descEl.textContent = task.description || 'Опис доручення відсутній.';
  
  if (statusEl) {
    const statusMap = {
      assigned: 'Призначено',
      in_progress: 'У роботі',
      completed: 'Виконано',
      rejected: 'Відхилено',
      planning: 'Планування'
    };
    statusEl.textContent = statusMap[task.status] || task.status;
    statusEl.className = `badge-status ${task.status}`;
  }

  if (deadlineEl && task.deadline) {
    deadlineEl.textContent = `до ${new Date(task.deadline).toLocaleDateString('uk-UA')}`;
  } else if (deadlineEl) {
    deadlineEl.textContent = 'без терміну';
  }

  // Populate subtasks checklist
  const subtasks = task.subtasks || [];
  if (subtasks.length > 0 && checklistContainer) {
    checklistContainer.innerHTML = '';
    subtasks.forEach(s => {
      const item = document.createElement('div');
      item.className = `modal-checklist-item ${s.completed ? 'checked' : ''}`;
      item.innerHTML = `
        <input type="checkbox" data-id="${s.id}" ${s.completed ? 'checked' : ''}>
        <span>${escapeHtml(s.title)}</span>
      `;

      // Trigger checklist item toggle from details modal
      const cb = item.querySelector('input');
      cb.addEventListener('change', async (e) => {
        const completed = e.target.checked;
        item.classList.toggle('checked', completed);
        await toggleSubtaskFromModal(task.id, s.id, completed);
      });

      checklistContainer.appendChild(item);
    });
    checklistSection.style.display = 'block';
  } else {
    if (checklistSection) checklistSection.style.display = 'none';
  }

  // Populate attachments
  const attachments = task.attachments || [];
  if (attachments.length > 0 && attachmentsContainer) {
    attachmentsContainer.innerHTML = '';
    attachments.forEach(a => {
      const item = document.createElement('div');
      item.className = 'modal-attachment-item';
      item.innerHTML = `
        <span>📁 ${escapeHtml(a.name || 'Матеріал')}</span>
        <a href="${a.url}" target="_blank" class="modal-attachment-link">Відкрити</a>
      `;
      attachmentsContainer.appendChild(item);
    });
    attachmentsSection.style.display = 'block';
  } else {
    if (attachmentsSection) attachmentsSection.style.display = 'none';
  }

  // Populate comments
  renderCommentsInModal(task);

  // Setup modal submit listener for comments
  const commentForm = document.getElementById('modal-add-comment-form');
  commentForm.onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById('modal-new-comment-text');
    const commentText = input.value.trim();
    if (!commentText) return;

    await addCommentToTask(task.id, commentText);
    input.value = '';
  };

  // Setup Log Work button inside modal
  const logBtn = document.getElementById('modal-btn-log-work');
  logBtn.onclick = () => {
    modal.style.display = 'none';
    selectTaskForWorkLog(task.id);
  };

  // Show modal
  if (modal) modal.style.display = 'flex';
}

function renderCommentsInModal(task) {
  const container = document.getElementById('modal-task-comments');
  if (!container) return;

  container.innerHTML = '';
  const comments = task.comments || [];

  if (comments.length === 0) {
    container.innerHTML = '<div style="font-style:italic; font-size:12px; color:var(--p-muted);">Немає коментарів.</div>';
    return;
  }

  comments.forEach(c => {
    const card = document.createElement('div');
    card.className = 'modal-comment-card';

    const dateStr = c.timestamp ? new Date(c.timestamp).toLocaleString('uk-UA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
    
    // Highlight system logs differently
    const isSystem = c.role === 'system';
    
    card.innerHTML = `
      <div class="comment-meta">
        <span style="color: ${isSystem ? 'var(--accent-deep)' : 'inherit'}">${escapeHtml(c.author)}</span>
        <span>${dateStr}</span>
      </div>
      <div class="comment-text" style="${isSystem ? 'font-style: italic; color: var(--p-muted);' : ''}">${escapeHtml(c.text)}</div>
    `;
    container.appendChild(card);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

async function toggleSubtaskFromModal(taskId, subId, completed) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;

  const subtasks = task.subtasks || [];
  const sub = subtasks.find(s => s.id === subId);
  if (!sub) return;

  sub.completed = completed;

  // Calculate new progress pct
  const total = subtasks.length;
  const done = subtasks.filter(s => s.completed).length;
  const progress = Math.round((done / total) * 100);

  const systemMsg = `${userProfile.full_name} позначив підзавдання "${sub.title}" як ${completed ? 'виконане ✅' : 'не виконане ⬜'}`;
  const comments = [...(task.comments || []), {
    id: crypto.randomUUID(),
    author: 'Система',
    role: 'system',
    text: systemMsg,
    timestamp: new Date().toISOString(),
    type: 'system'
  }];

  let taskStatus = task.status;
  if (progress === 100) {
    taskStatus = 'completed';
  } else if (taskStatus === 'assigned') {
    taskStatus = 'in_progress';
  }

  const { error } = await sb
    .from('assigned_tasks')
    .update({ subtasks, progress, comments, status: taskStatus })
    .eq('id', taskId);

  if (error) {
    alert("Помилка оновлення підзавдання: " + error.message);
  } else {
    // Reload databases and update modal view
    await loadDatabaseData();
    const updatedTask = allTasks.find(t => t.id === taskId);
    renderCommentsInModal(updatedTask);
  }
}

async function addCommentToTask(taskId, commentText) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;

  const comments = [...(task.comments || []), {
    id: crypto.randomUUID(),
    author: userProfile.full_name,
    role: userProfile.role,
    text: commentText,
    timestamp: new Date().toISOString(),
    type: 'user'
  }];

  const { error } = await sb
    .from('assigned_tasks')
    .update({ comments })
    .eq('id', taskId);

  if (error) {
    alert("Не вдалося додати коментар: " + error.message);
  } else {
    await loadDatabaseData();
    const updatedTask = allTasks.find(t => t.id === taskId);
    renderCommentsInModal(updatedTask);
  }
}

// ── General Helper Events ───────────────────────────
function setupUIEvents() {
  // 1. Task filter tabs click handlers
  const filterTabs = document.querySelectorAll('.filter-tab');
  const applyFilter = (filter) => {
    const tab = document.querySelector(`.filter-tab[data-filter="${filter}"]`);
    if (!tab) return;
    filterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderTasksList(filter);
  };
  filterTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      applyFilter(tab.dataset.filter);
    });
  });

  // 1a. Metric cards open the corresponding task list
  const metricFilters = {
    'metric-card-active': 'active',
    'metric-card-hot': 'hot',
    'metric-card-overdue': 'overdue'
  };
  Object.entries(metricFilters).forEach(([cardId, filter]) => {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.addEventListener('click', () => {
      applyFilter(filter);
      document.querySelector('.tasks-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  const todayCard = document.getElementById('metric-card-today');
  if (todayCard) {
    todayCard.addEventListener('click', () => {
      document.querySelector('.today-feed-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // 1b. Deep link from the home page: cabinet/index.html?filter=hot
  const urlFilter = new URLSearchParams(window.location.search).get('filter');
  if (urlFilter && document.querySelector(`.filter-tab[data-filter="${urlFilter}"]`)) {
    applyFilter(urlFilter);
    document.querySelector('.tasks-panel')?.scrollIntoView({ block: 'start' });
  }

  // 2. Branch selector changes
  const branchSel = document.getElementById('task_branch');
  if (branchSel) {
    branchSel.addEventListener('change', handleBranchChange);
  }

  // 3. Task dropdown changes
  const taskSel = document.getElementById('link_assigned_task');
  if (taskSel) {
    taskSel.addEventListener('change', handleTaskChange);
  }

  // 3b. «Робота в АСКОД за цим дорученням» toggle
  const taskAskodToggle = document.getElementById('task_link_askod');
  if (taskAskodToggle) {
    taskAskodToggle.addEventListener('change', toggleTaskAskodFields);
  }

  // 4. Live points inputs changes
  const presetSel = document.getElementById('duration_preset');
  if (presetSel) presetSel.addEventListener('change', updateLiveScore);
  
  const minInput = document.getElementById('duration_minutes');
  if (minInput) minInput.addEventListener('input', updateLiveScore);
  
  const sevSel = document.getElementById('severity_level');
  if (sevSel) sevSel.addEventListener('change', updateLiveScore);

  // 5. Form 37-D toggle checkbox
  const include37dCb = document.getElementById('include_37d');
  const block37dFields = document.getElementById('block-37d-fields');
  if (include37dCb && block37dFields) {
    include37dCb.addEventListener('change', (e) => {
      block37dFields.style.display = e.target.checked ? 'flex' : 'none';
      
      // Mark fields required
      const process = document.getElementById('process_name');
      const state = document.getElementById('current_state_text');
      const eventDate = document.getElementById('event_date');
      const contact = document.getElementById('contact_person_select');

      if (process) process.required = e.target.checked;
      if (state) state.required = e.target.checked;
      if (eventDate) eventDate.required = e.target.checked;
      if (contact) contact.required = e.target.checked;
    });
  }

  // 6. Form Submit handler
  const logForm = document.getElementById('cabinet-log-form');
  if (logForm) {
    logForm.addEventListener('submit', handleLogFormSubmit);
  }

  // 7. Modal closer clicks
  const modal = document.getElementById('cabinet-task-modal');
  const closeBtn1 = document.getElementById('modal-close-btn');
  const closeBtn2 = document.getElementById('modal-btn-close');

  const closeModal = () => {
    if (modal) modal.style.display = 'none';
  };

  if (closeBtn1) closeBtn1.addEventListener('click', closeModal);
  if (closeBtn2) closeBtn2.addEventListener('click', closeModal);

  window.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // 8. Log edit modal events
  const editModal = document.getElementById('log-edit-modal');
  const editCloseBtn = document.getElementById('log-edit-close-btn');
  const editCancelBtn = document.getElementById('log-edit-cancel');
  const editSaveBtn = document.getElementById('log-edit-save');
  const editForm = document.getElementById('log-edit-form');

  if (editCloseBtn) editCloseBtn.addEventListener('click', closeLogEditModal);
  if (editCancelBtn) editCancelBtn.addEventListener('click', closeLogEditModal);
  if (editSaveBtn) editSaveBtn.addEventListener('click', saveLogEdit);
  if (editForm) editForm.addEventListener('submit', (e) => { e.preventDefault(); saveLogEdit(); });

  window.addEventListener('click', (e) => {
    if (e.target === editModal) closeLogEditModal();
  });

  // Trigger default branch setup
  initStickyToggle();
  handleBranchChange();
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
