import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Run theme initialization immediately to prevent flash of white screen
(function() {
  const savedTheme = localStorage.getItem('portal-theme') || 'light';
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark-theme');
  }
})();

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let user = null;
let role = null; // null = guest | 'registered' | 'full'
let isHead = false;

function hasAccess(required) {
  if (!required) return true;
  if (!user) return false;
  
  let req = required;
  if (req === 'registered' || req === 'full') {
    req = 'expert';
  }
  
  // Director possesses full administrative rights
  let currentRole = role;
  if (currentRole === 'director') {
    currentRole = 'admin';
  }
  if (req === 'director') {
    req = 'admin';
  }
  
  const rolesOrder = ['guest', 'expert', 'manager', 'deputy_director', 'admin'];
  const userRoleIndex = rolesOrder.indexOf(currentRole);
  const requiredRoleIndex = rolesOrder.indexOf(req);
  
  if (userRoleIndex === -1 || requiredRoleIndex === -1) return false;
  return userRoleIndex >= requiredRoleIndex;
}

async function fetchRole() {
  if (!user) { role = null; isHead = false; return; }
  const { data } = await sb.from('profiles').select('role, is_head').eq('id', user.id).single();
  // Роль визначає ВИКЛЮЧНО запис у profiles (керується адміністратором);
  // жодних клієнтських авто-підвищень за ключовими словами в email.
  role = data?.role ?? 'guest';
  isHead = data?.is_head ?? false;
}

function applyAccess() {
  const pathParts = window.location.pathname.split('/');
  const isInSubdir = pathParts.some(part => [
    'zoz-questions', 'pmg-proposals', 'news', 'chat', 'pakety', 'postanova', 'algorithms', 'zoz-dogovr', 'skod', 'dec', 'passport', 'regulatory', 'reminders', 'expert-proposals', 'cabinet', 'infocenter'
  ].includes(part.toLowerCase()));
  const prefix = isInSubdir ? '../' : './';
  const currentPath = window.location.pathname.toLowerCase();

  // Update standalone Chat button in top nav
  const chatBtn = document.getElementById('auth-chat-btn');
  if (chatBtn) {
    chatBtn.href = prefix + 'chat/index.html';
    const hasChatAccess = hasAccess('expert');
    if (!hasChatAccess) {
      chatBtn.style.display = 'none';
    } else {
      chatBtn.style.display = '';
      chatBtn.classList.remove('is-locked');
      chatBtn.innerHTML = `Робочий чат`;
      chatBtn.onclick = null;
    }
  }

  // Update standalone Personal Cabinet button in top nav
  const cabinetBtn = document.getElementById('auth-cabinet-btn');
  if (cabinetBtn) {
    cabinetBtn.href = prefix + 'cabinet/index.html';
    const hasCabinetAccess = hasAccess('expert');
    if (!hasCabinetAccess) {
      cabinetBtn.style.display = 'none';
    } else {
      cabinetBtn.style.display = '';
      cabinetBtn.classList.remove('is-locked');
      cabinetBtn.innerHTML = `👤 Особистий кабінет`;
      cabinetBtn.onclick = null;
    }
  }

  // Update standalone SKOD Tasks button in top nav
  const tasksBtn = document.getElementById('auth-tasks-btn');
  if (tasksBtn) {
    tasksBtn.href = prefix + 'skod/tasks.html';
    const hasTasksAccess = hasAccess('manager');
    if (!hasTasksAccess) {
      tasksBtn.style.display = 'none';
    } else {
      tasksBtn.style.display = '';
      tasksBtn.classList.remove('is-locked');
      tasksBtn.innerHTML = `Доручення`;
      tasksBtn.onclick = null;
    }
  }

  // Update standalone Regulatory Admin button in top nav
  const regulatoryBtn = document.getElementById('auth-regulatory-btn');
  if (regulatoryBtn) {
    regulatoryBtn.href = prefix + 'regulatory/admin.html';
    const hasRegAccess = hasAccess('expert');
    if (!hasRegAccess) {
      regulatoryBtn.style.display = 'none';
    } else {
      regulatoryBtn.style.display = '';
      regulatoryBtn.classList.remove('is-locked');
      regulatoryBtn.innerHTML = `Управління нормами`;
      regulatoryBtn.onclick = null;
    }
  }

  const btn = document.getElementById('auth-nav-btn');
  if (btn) {
    if (user) {
      const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
      btn.textContent = displayName;
      btn.classList.add('is-signed-in');
      btn.title = 'Натисніть для виходу';
    } else {
      btn.textContent = 'Увійти';
      btn.classList.remove('is-signed-in');
      btn.title = '';
    }
  }

  // Update role badge next to the button
  const badge = document.getElementById('auth-role-badge');
  if (badge) {
    badge.className = 'auth-role-badge';
    // Fail-safe inline styles to bypass browser cache of auth-v2.css
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.padding = '6px 10px';
    badge.style.borderRadius = '8px';
    badge.style.fontSize = '11px';
    badge.style.fontWeight = '700';
    badge.style.textTransform = 'uppercase';
    badge.style.letterSpacing = '0.05em';
    badge.style.whiteSpace = 'nowrap';
    badge.style.lineHeight = '1';

    if (user) {
      const roleLabels = {
        guest: { text: 'Гість', bg: '#f2f8fb', color: '#647688', border: '1px solid #e3edf3' },
        expert: { text: 'Експерт', bg: '#e9f7f3', color: '#08705e', border: '1px solid rgba(84, 173, 132, 0.25)' },
        manager: { text: 'Керівник', bg: '#eef6fc', color: '#2f6b9e', border: '1px solid rgba(74, 143, 199, 0.2)' },
        deputy_director: { text: 'Заступник', bg: '#fffdf5', color: '#c27d0e', border: '1px solid rgba(194, 125, 14, 0.25)' },
        director: { text: 'Директор', bg: '#fdebee', color: '#c71585', border: '1px solid rgba(199, 21, 133, 0.2)' },
        admin: { text: 'Адмін', bg: '#f5f0ff', color: '#6a0dad', border: '1px solid rgba(106, 13, 173, 0.25)' }
      };
      const labelInfo = roleLabels[role] || roleLabels.guest;
      badge.textContent = labelInfo.text;
      badge.style.background = labelInfo.bg;
      badge.style.color = labelInfo.color;
      badge.style.border = labelInfo.border;
    } else {
      badge.textContent = 'Гість';
      badge.style.background = '#f2f8fb';
      badge.style.color = '#647688';
      badge.style.border = '1px solid #e3edf3';
    }
  }

  // Show/hide daily status chip next to access status button
  const statusChip = document.getElementById('portal-status-chip');
  if (statusChip) {
    if (user && role !== 'guest') {
      statusChip.style.display = 'inline-flex';
      const statsLink = document.getElementById('view-status-stats-link');
      if (statsLink) {
        statsLink.href = prefix + 'skod/reports.html?type=statuses';
      }
    } else {
      statusChip.style.display = 'none';
    }
  }

  // Show/hide role-gated elements
  document.querySelectorAll('[data-role]').forEach(el => {
    el.style.display = hasAccess(el.dataset.role) ? '' : 'none';
  });

  // Dynamic navigation links injection
  function isActive(itemPath) {
    const normalized = itemPath.replace(/^\.\.\/|^\.\//, '');
    const segments = normalized.split('/');
    
    if (normalized === 'index.html') {
      const isSub = ['pakety', 'postanova', 'algorithms', 'zoz-questions', 'pmg-proposals', 'news', 'chat', 'rozjasnennya.html', 'zoz-dogovr', 'skod', 'dec', 'dept-tree.html', 'passport', 'regulatory', 'expert-proposals', 'cabinet', 'infocenter'].some(s => currentPath.includes(s));
      return !isSub && (currentPath.endsWith('/') || currentPath.endsWith('index.html'));
    }
    
    if (normalized === 'rozjasnennya.html') {
      return currentPath.includes('rozjasnennya.html');
    }
    
    if (normalized === 'pakety/report.html') {
      return currentPath.includes('report.html');
    }
    
    if (normalized === 'pakety/collector.html') {
      return currentPath.includes('collector.html');
    }
    
    if (normalized === 'pakety/index.html') {
      return currentPath.includes('/pakety/') && !currentPath.includes('report.html') && !currentPath.includes('collector.html');
    }
    
    return currentPath.includes(segments[0]);
  }

  const navContainer = document.querySelector('nav.section-switch:not(.top-auth)') || document.querySelector('.top-nav');
  if (navContainer) {
    navContainer.innerHTML = ''; // Rebuild dynamically

    const coreItems = [
      { text: 'Головна', path: 'index.html' },
      { text: 'Роз\'яснення', path: 'rozjasnennya.html' },
      { text: 'Пакети 2026', path: 'pakety/index.html' },
      { text: 'Паспорт пакета', path: 'passport/index.html' }
    ];

    // Довідково-нормативні розділи — згруповані в дропдаун «Документи»
    const documentsItems = [
      { text: 'Постанова 1808', path: 'postanova/index.html' },
      { text: 'Алгоритми та правила (наказ 377)', path: 'algorithms/index.html' },
      { text: 'Нормативна база', path: 'regulatory/index.html' },
      { text: 'ДЕЦ МОЗ', path: 'dec/index.html' },
      { text: 'Укладені договори', path: 'zoz-dogovr/index.html' }
    ];

    const tailItems = [
      { text: 'Структура', path: 'dept-tree.html', role: 'expert' },
      { text: 'Робочий чат', path: 'chat/index.html', isChat: true, role: 'expert' }
    ];

    const dropdownItems = [
      { text: 'Архів пакетів ПМГ', path: 'pakety/collector.html' },
      { text: 'Машина пошуку', path: 'pakety/report.html', role: 'expert' },
      { text: 'Конструктор зв\'язків', path: 'dec/linker.html', role: 'expert' },
      { text: 'Календар нагадувань', path: 'reminders/index.html', role: 'expert' },
      { text: 'Питання ЗОЗ', path: 'zoz-questions/index.html', role: 'expert' },
      { text: 'Пропозиції ПМГ', path: 'pmg-proposals/index.html', role: 'expert' },
      { text: 'Пропозиції робочих груп', path: 'expert-proposals/index.html', role: 'expert' },
      { text: 'СКО-Д (Внесення)', path: 'cabinet/index.html', role: 'expert' },
      { text: 'СКО-Д (Звіти)', path: 'skod/reports.html', role: 'expert' },
      { text: 'СКО-Д (Доручення)', path: 'skod/tasks.html', role: 'manager' },
      { text: 'Новини', path: 'news/index.html', role: 'expert' },
      { text: 'Інфоцентр', path: 'infocenter/index.html', role: 'expert' },
      { text: 'Хвилинка відпочинку', path: 'relax/index.html', role: 'expert' }
    ];

    const appendNavLinks = (items) => {
      items.forEach(item => {
        if (item.role && !hasAccess(item.role)) {
          return; // Hide completely
        }
        const a = document.createElement('a');
        a.href = prefix + item.path;

        if (item.isChat) {
          a.className = 'nav-chat-btn';
        }
        a.textContent = item.text;

        if (isActive(item.path)) {
          a.classList.add('active');
          a.setAttribute('aria-current', 'page');
        }
        navContainer.appendChild(a);
      });
    };

    const appendDropdown = (label, items) => {
      const visibleItems = items.filter(item => hasAccess(item.role));
      if (visibleItems.length === 0) return;

      const isDropdownActive = visibleItems.some(item => isActive(item.path));

      const dropdownDiv = document.createElement('div');
      dropdownDiv.className = 'nav-dropdown';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-dropdown-btn';
      if (isDropdownActive) btn.classList.add('active');
      btn.innerHTML = `${label} <span class="nav-dropdown-arrow">▼</span>`;

      const menuDiv = document.createElement('div');
      menuDiv.className = 'nav-dropdown-menu';

      visibleItems.forEach(item => {
        const a = document.createElement('a');
        a.href = prefix + item.path;
        a.innerHTML = `<span>${item.text}</span>`;

        if (isActive(item.path)) {
          a.classList.add('active');
          a.setAttribute('aria-current', 'page');
        }
        menuDiv.appendChild(a);
      });

      dropdownDiv.appendChild(btn);
      dropdownDiv.appendChild(menuDiv);
      navContainer.appendChild(dropdownDiv);
    };

    // Головна · Реєстр · Пакети · Паспорт · Документи ▼ · Сервіси ▼ · Структура · Чат
    appendNavLinks(coreItems);
    appendDropdown('Документи', documentsItems);
    appendDropdown('Сервіси', dropdownItems);
    appendNavLinks(tailItems);
  }

  // Page-level guard
  const required = document.body.dataset.requiredRole;
  if (required && !hasAccess(required)) {
    const overlay = document.getElementById('access-denied-overlay');
    if (overlay) {
      const msg = document.getElementById('access-denied-msg');
      if (msg) {
        if (required === 'expert') {
          msg.textContent = 'Ця сторінка доступна лише для співробітників департаменту.';
        } else if (required === 'manager') {
          msg.textContent = 'Ця сторінка доступна лише для керівництва (Директор, Заступники, Начальники відділів та Адміністратор).';
        } else {
          msg.textContent = 'Ця сторінка доступна лише для авторизованих користувачів.';
        }
      }
      overlay.style.display = 'flex';
    }
  }

  // Inject User Dashboard banner below header
  const header = document.querySelector('header.top');
  let dashboard = document.getElementById('user-task-dashboard');
  if (dashboard) dashboard.remove();
  dashboard = null;

  // Дашборд не потрібен: на головній є «Мій робочий стан», в особистому кабінеті — власні метрики
  const isHomePage = !isInSubdir && document.getElementById('home-metrics') !== null;
  const isCabinetPage = currentPath.includes('cabinet');

  let alertBanner = document.getElementById('user-news-alert-banner');
  if (header) {
    if (!user || role === 'guest' || currentPath.includes('passport')) {
      if (alertBanner) alertBanner.remove();
    } else {
      if (!isHomePage && !isCabinetPage) {
        dashboard = document.createElement('div');
        dashboard.id = 'user-task-dashboard';
        dashboard.className = 'user-task-dashboard';
        header.insertAdjacentElement('afterend', dashboard);
        renderDashboard(dashboard, prefix);
      }

      if (!alertBanner) {
        alertBanner = document.createElement('div');
        alertBanner.id = 'user-news-alert-banner';
      }
      (dashboard || header).insertAdjacentElement('afterend', alertBanner);
      renderAlertBanner(alertBanner, prefix);
    }
  }

  // Show/hide online chip for guests and unregistered users
  const onlineChip = document.getElementById('portal-online-chip');
  if (onlineChip) {
    if (user && role !== 'guest') {
      onlineChip.style.display = '';
    } else {
      onlineChip.style.display = 'none';
    }
  }
}

function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  document.getElementById('auth-login-form').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('auth-reg-form').style.display   = tab === 'register' ? '' : 'none';
  document.getElementById('login-error').textContent = '';
  const regErr = document.getElementById('reg-error');
  regErr.textContent = '';
  regErr.style.color = '';
}

function openModal(tab = 'login') {
  document.getElementById('auth-overlay').style.display = 'flex';
  switchTab(tab);
}

function closeModal() {
  document.getElementById('auth-overlay').style.display = 'none';
}

async function onLogin(e) {
  e.preventDefault();
  const btn = e.submitter;
  const errEl = document.getElementById('login-error');
  btn.disabled = true;
  btn.textContent = 'Завантаження...';
  const { error } = await sb.auth.signInWithPassword({
    email:    document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-pass').value,
  });
  btn.disabled = false;
  btn.textContent = 'Увійти';
  if (error) {
    errEl.textContent = error.message.includes('Invalid')
      ? 'Невірний email або пароль'
      : error.message;
  } else {
    closeModal();
  }
}

async function onRegister(e) {
  e.preventDefault();
  const btn = e.submitter;
  const errEl = document.getElementById('reg-error');
  btn.disabled = true;
  btn.textContent = 'Реєстрація...';
  const { error } = await sb.auth.signUp({
    email:    document.getElementById('reg-email').value.trim(),
    password: document.getElementById('reg-pass').value,
    options:  { data: {
      full_name:    document.getElementById('reg-name').value.trim(),
      department:   document.getElementById('reg-dept').value,
      position:     document.getElementById('reg-position').value,
      organization: 'Департамент стратегії універсального охоплення населення медичними послугами'
    }},
  });
  btn.disabled = false;
  btn.textContent = 'Зареєструватись';
  if (error) {
    errEl.style.color = '';
    errEl.textContent = error.message;
  } else {
    errEl.style.color = 'var(--teal, #087e82)';
    errEl.textContent = 'Лист підтвердження надіслано на вашу пошту.';
    e.target.reset();
  }
}

function inject() {
  // Auth elements inside nav/container
  const container = document.querySelector('.auth-container') || document.querySelector('nav.section-switch');
  if (container) {
    // Global Online counter pill
    const onlineChip = document.createElement('div');
    onlineChip.id = 'portal-online-chip';
    onlineChip.className = 'portal-online-chip';
    onlineChip.innerHTML = `
      <span class="online-glowing-dot"></span>
      <span id="portal-online-count" class="online-count-lbl">0</span> в мережі
      <div class="online-users-dropdown" id="online-users-dropdown">
        <div class="dropdown-title">Зараз на порталі:</div>
        <ul class="dropdown-users-list" id="portal-online-users-list">
          <li>Завантаження...</li>
        </ul>
      </div>
    `;
    container.appendChild(onlineChip);

    // Theme Toggle Button
    const themeBtn = document.createElement('button');
    themeBtn.id = 'theme-toggle-btn';
    themeBtn.className = 'theme-toggle-btn';
    themeBtn.title = 'Перемикач теми (світла / темна)';
    const savedTheme = localStorage.getItem('portal-theme') || 'light';
    themeBtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    themeBtn.addEventListener('click', toggleTheme);
    container.appendChild(themeBtn);

    // News Notifications Toggle Button
    const newsNotifyBtn = document.createElement('button');
    newsNotifyBtn.id = 'news-notify-btn';
    newsNotifyBtn.className = 'news-notify-toggle-btn';
    const notificationsEnabled = localStorage.getItem('news_notifications_enabled') !== 'false';
    if (!notificationsEnabled) {
      newsNotifyBtn.classList.add('muted');
    }
    newsNotifyBtn.textContent = notificationsEnabled ? '🔔' : '🔕';
    newsNotifyBtn.title = notificationsEnabled ? 'Вимкнути сповіщення новин' : 'Увімкнути сповіщення новин';
    newsNotifyBtn.addEventListener('click', () => {
      const isCurrentlyEnabled = localStorage.getItem('news_notifications_enabled') !== 'false';
      const nextEnabled = !isCurrentlyEnabled;
      localStorage.setItem('news_notifications_enabled', nextEnabled ? 'true' : 'false');
      
      newsNotifyBtn.classList.toggle('muted', !nextEnabled);
      newsNotifyBtn.textContent = nextEnabled ? '🔔' : '🔕';
      newsNotifyBtn.title = nextEnabled ? 'Вимкнути сповіщення новин' : 'Увімкнути сповіщення новин';
      
      if (nextEnabled) {
        // Play audio alert to test
        playNewsAlertSound();
        // Request browser permission if default
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }
    });
    container.appendChild(newsNotifyBtn);

    // Role badge indicator
    const badge = document.createElement('span');
    badge.id = 'auth-role-badge';
    badge.className = 'auth-role-badge role-guest';
    badge.textContent = 'Гість';
    container.appendChild(badge);

    // Daily Status Badge/Dropdown Chip
    const statusChip = document.createElement('div');
    statusChip.id = 'portal-status-chip';
    statusChip.className = 'portal-status-chip';
    statusChip.style.display = 'none'; // Hidden by default, shown when logged in
    statusChip.innerHTML = `
      <span class="status-icon">❓</span>
      <span class="status-lbl">Вкажіть статус</span>
      <div class="status-dropdown" id="portal-status-dropdown">
        <div class="dropdown-title">Мій статус на сьогодні:</div>
        <div class="status-options-grid">
          <button class="status-opt-btn" data-status="office">🏢 Офіс</button>
          <button class="status-opt-btn" data-status="home">🏡 Вдома</button>
          <button class="status-opt-btn" data-status="sick">🏥 Лікарняний</button>
          <button class="status-opt-btn" data-status="vacation">🌴 Відпустка</button>
          <button class="status-opt-btn" data-status="agreement">🤝 За домовл.</button>
        </div>
        <div class="dropdown-divider"></div>
        <div class="dropdown-title">Присутність колег сьогодні:</div>
        <ul class="colleagues-status-list" id="colleagues-status-list">
          <li style="color: var(--muted); font-style: italic;">Завантаження...</li>
        </ul>
        <div class="dropdown-divider"></div>
        <a href="#" id="view-status-stats-link" class="status-stats-link">📊 Детальна статистика статусів</a>
      </div>
    `;
    container.appendChild(statusChip);

    statusChip.addEventListener('click', (e) => {
      const optBtn = e.target.closest('.status-opt-btn');
      if (optBtn) {
        e.stopPropagation();
        const selectedStatus = optBtn.dataset.status;
        saveUserDailyStatus(selectedStatus);
        return;
      }
      
      const statsLink = e.target.closest('#view-status-stats-link');
      if (statsLink) {
        return;
      }
      
      const dropdown = document.getElementById('portal-status-dropdown');
      if (dropdown) {
        e.stopPropagation();
        const willShow = !dropdown.classList.contains('show');
        
        // Close other dropdowns if any
        document.querySelectorAll('.status-dropdown').forEach(d => d.classList.remove('show'));
        
        if (willShow) {
          dropdown.classList.add('show');
          loadTeamPresence();
        }
      }
    });

    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('portal-status-dropdown');
      const chip = document.getElementById('portal-status-chip');
      if (dropdown && dropdown.classList.contains('show') && chip && !chip.contains(e.target)) {
        dropdown.classList.remove('show');
      }
    });

    // Standalone Chat button in top nav
    const topChatBtn = document.createElement('a');
    topChatBtn.id = 'auth-chat-btn';
    topChatBtn.className = 'auth-chat-btn';
    topChatBtn.textContent = 'Робочий чат';
    container.appendChild(topChatBtn);

    // Standalone Personal Cabinet button in top nav
    const topCabinetBtn = document.createElement('a');
    topCabinetBtn.id = 'auth-cabinet-btn';
    topCabinetBtn.className = 'auth-cabinet-btn';
    topCabinetBtn.textContent = 'Особистий кабінет';
    container.appendChild(topCabinetBtn);

    // Standalone Tasks button in top nav
    const topTasksBtn = document.createElement('a');
    topTasksBtn.id = 'auth-tasks-btn';
    topTasksBtn.className = 'auth-tasks-btn';
    topTasksBtn.textContent = 'Доручення';
    container.appendChild(topTasksBtn);

    // Standalone Regulatory Admin button in top nav
    const topRegBtn = document.createElement('a');
    topRegBtn.id = 'auth-regulatory-btn';
    topRegBtn.className = 'auth-regulatory-btn';
    topRegBtn.textContent = 'Управління нормами';
    container.appendChild(topRegBtn);

    const btn = document.createElement('button');
    btn.id = 'auth-nav-btn';
    btn.className = 'auth-nav-btn';
    btn.textContent = 'Увійти';
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-signed-in')) sb.auth.signOut();
      else openModal();
    });
    container.appendChild(btn);
  }

  // Modal + access denied
  document.body.insertAdjacentHTML('beforeend', `
<div id="auth-overlay" class="auth-overlay" style="display:none" role="dialog" aria-modal="true" aria-label="Вхід">
  <div class="auth-modal">
    <button class="auth-modal-close" id="auth-close" aria-label="Закрити">&times;</button>
    <div class="auth-brand">НавігаторПМГ26</div>
    <div class="auth-tabs" role="tablist">
      <button class="auth-tab active" data-tab="login" role="tab">Увійти</button>
      <button class="auth-tab" data-tab="register" role="tab">Реєстрація</button>
    </div>
    <form id="auth-login-form" novalidate>
      <div class="auth-field">
        <label for="login-email">Email</label>
        <input id="login-email" type="email" autocomplete="email" required>
      </div>
      <div class="auth-field">
        <label for="login-pass">Пароль</label>
        <input id="login-pass" type="password" autocomplete="current-password" required>
      </div>
      <div class="auth-error" id="login-error"></div>
      <button type="submit" class="auth-submit">Увійти</button>
    </form>
    <form id="auth-reg-form" style="display:none" novalidate>
      <div class="auth-field">
        <label for="reg-email">Email</label>
        <input id="reg-email" type="email" autocomplete="email" required>
      </div>
      <div class="auth-field">
        <label for="reg-pass">Пароль <span class="auth-hint">(мін. 6 символів)</span></label>
        <input id="reg-pass" type="password" autocomplete="new-password" minlength="6" required>
      </div>
      <div class="auth-field">
        <label for="reg-name">Ім'я та прізвище *</label>
        <input id="reg-name" type="text" autocomplete="name" required>
      </div>
      <div class="auth-field">
        <label for="reg-dept">Відділ (підрозділ) *</label>
        <select id="reg-dept" required>
          <option value="розрахунок вартості медичних послуг">розрахунок вартості медичних послуг</option>
          <option value="робота з електронними медичними даними">робота з електронними медичними даними</option>
          <option value="взаємодія з надавачами медичних послуг">взаємодія з надавачами медичних послуг</option>
          <option value="розвиток програми реімбурсації">розвиток програми реімбурсації</option>
          <option value="наукова та клінічна експертиза">наукова та клінічна експертиза</option>
          <option value="стратегічного розвитку програми медичних гарантій">стратегічного розвитку програми медичних гарантій</option>
          <option value="Поза відділами">Поза відділами</option>
          <option value="Гість (інший департамент)">Гість (інший департамент)</option>
        </select>
      </div>
      <div class="auth-field">
        <label for="reg-position">Посада *</label>
        <select id="reg-position" required>
          <option value="Експерт">Експерт</option>
          <option value="Начальник відділу">Начальник відділу</option>
          <option value="Заступник директора">Заступник директора</option>
          <option value="Директор">Директор</option>
          <option value="Адміністратор">Адміністратор</option>
        </select>
      </div>
      <div class="auth-error" id="reg-error"></div>
      <button type="submit" class="auth-submit">Зареєструватись</button>
    </form>
  </div>
</div>
<div id="access-denied-overlay" class="access-denied-overlay" style="display:none">
  <div class="access-denied-box">
    <h2>Доступ обмежено</h2>
    <p id="access-denied-msg">Ця сторінка доступна лише для зареєстрованих користувачів.</p>
    <button class="auth-submit" id="access-denied-btn">Увійти / Зареєструватись</button>
  </div>
</div>`);

  document.getElementById('auth-close').addEventListener('click', closeModal);
  document.getElementById('auth-overlay').addEventListener('click', e => {
    if (e.target.id === 'auth-overlay') closeModal();
  });
  document.getElementById('access-denied-btn').addEventListener('click', () => openModal());
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );
  document.getElementById('auth-login-form').addEventListener('submit', onLogin);
  document.getElementById('auth-reg-form').addEventListener('submit', onRegister);

  // Auto-selection logic based on name and position
  const regName = document.getElementById('reg-name');
  const regDept = document.getElementById('reg-dept');
  const regPos = document.getElementById('reg-position');

  if (regName && regDept && regPos) {
    regName.addEventListener('input', () => {
      const name = regName.value.trim().toLowerCase();
      if (name === 'світлана дудник' || name === 'дудник світлана') {
        regPos.value = 'Директор';
        regDept.value = 'Поза відділами';
      } else if (name === 'волошина альбіна' || name === 'альбіна волошина' || name === 'волошина альбіна сергіївна') {
        regPos.value = 'Заступник директора';
        regDept.value = 'стратегічного розвитку програми медичних гарантій';
      }
    });

    regPos.addEventListener('change', () => {
      if (regPos.value === 'Директор' || regPos.value === 'Адміністратор') {
        regDept.value = 'Поза відділами';
      } else if (regPos.value === 'Заступник директора') {
        regDept.value = 'стратегічного розвитку програми медичних гарантій';
      }
    });
  }
}

async function renderDashboard(dashboardEl, prefix) {
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
  
  let userDept = '';
  try {
    const { data: prof } = await sb.from('profiles').select('Section, department').eq('id', user.id).single();
    userDept = prof?.Section || prof?.department || '';
  } catch(e) {}

  let userTasks = [];
  try {
    const { data } = await sb
      .from('assigned_tasks')
      .select('id, title, deadline, progress, status, description, importance, task_type, askod_number, askod_sender')
      .eq('responsible_id', user.id)
      .neq('status', 'completed')
      .order('deadline', { ascending: true });
    userTasks = (data || []).filter(t => t.status !== 'completed' && t.progress < 100);
  } catch(e) {}

  // Load active reporting reminders with warnings for the current user
  let activeReminders = [];
  try {
    let rawEvents = [];
    try {
      const { data, error } = await sb.from('reporting_events').select('*').eq('executor_id', user.id).neq('status', 'Надіслано');
      if (!error && data) rawEvents = data;
    } catch(e) {}
    
    if (rawEvents.length === 0) {
      const local = localStorage.getItem('reporting_events');
      if (local) {
        const parsed = JSON.parse(local);
        rawEvents = parsed.filter(ev => ev.executor_id === user.id && ev.status !== 'Надіслано');
      }
    }
    
    // Business days count helper
    const getBizDays = (startDate, endDate) => {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(0, 0, 0, 0);
      if (start > end) return -getBizDays(end, start);
      if (start.getTime() === end.getTime()) return 0;
      let count = 0;
      const current = new Date(start);
      while (current < end) {
        current.setDate(current.getDate() + 1);
        if (current.getDay() !== 0 && current.getDay() !== 6) count++;
      }
      return count;
    };
    
    const today = new Date();
    rawEvents.forEach(ev => {
      const deadline = new Date(ev.deadline_date);
      const bizDays = getBizDays(today, deadline);
      
      let tier = null;
      let urgency = '';
      let warningText = '';
      let badgeLabel = '';
      
      if (bizDays < 0) {
        tier = 'overdue';
        urgency = 'critical';
        warningText = `Прострочено на ${Math.abs(bizDays)} дн.`;
        badgeLabel = 'Прострочено';
      } else if (bizDays === 0) {
        tier = 'deadline';
        urgency = 'critical';
        warningText = `ДЕДЛАЙН СЬОГОДНІ!`;
        badgeLabel = 'Дедлайн';
      } else if (bizDays <= 2) {
        tier = 'warning-2';
        urgency = 'high';
        warningText = `Залишилось ${bizDays} роб. дн.`;
        badgeLabel = 'Критично';
      } else if (bizDays <= 5) {
        tier = 'warning-5';
        urgency = 'medium';
        warningText = `Залишилось ${bizDays} роб. дн.`;
        badgeLabel = 'Важливо';
      } else if (bizDays === 15) {
        tier = 'warning-15';
        urgency = 'low';
        warningText = `Залишилося 15 роб. дн.`;
        badgeLabel = 'Нагадування';
      }
      
      if (tier) {
        activeReminders.push({
          id: ev.id,
          title: ev.title,
          deadline_date: ev.deadline_date,
          warningText: warningText,
          urgency: urgency,
          badgeLabel: badgeLabel
        });
      }
    });
  } catch(e) {
    console.error("Dashboard reminders error:", e);
  }

  const showManagerAction = ['admin', 'director', 'deputy_director', 'manager'].includes(role);

  dashboardEl.innerHTML = `
    <div class="wrap dashboard-inner">
      <div class="user-info-section">
        <div class="user-greeting">
          <span class="user-welcome">Вітаємо, <strong>${displayName}</strong>!</span>
          <span class="user-dept-badge">${userDept || 'Департамент'}</span>
        </div>
      </div>
      <div class="tasks-summary-section">
        ${userTasks.length > 0 ? `
          <div class="tasks-summary-header">
            <span class="tasks-summary-lbl">📋 Активні доручення на виконанні (всього: <strong>${userTasks.length}</strong>):</span>
          </div>
          <div class="tasks-brief-list">
            ${userTasks.map((t, index) => {
              const daysLeft = Math.ceil((new Date(t.deadline) - new Date()) / (1000 * 60 * 60 * 24));
              const dateStr = new Date(t.deadline).toLocaleDateString('uk-UA');
              const dateClass = daysLeft < 0 ? 'overdue' : (daysLeft <= 3 ? 'urgent' : 'normal');
              const daysText = daysLeft < 0 ? `(Протерміновано)` : (daysLeft === 0 ? `(Сьогодні!)` : `(залишилось ${daysLeft} дн.)`);
              const collapsedAttr = index >= 3 ? 'class="task-brief-item is-collapsed-hidden" style="display: none;"' : 'class="task-brief-item"';
              
              const bulbColor = daysLeft < 0 ? 'red' : (daysLeft <= 3 ? 'yellow' : 'green');
              const askodBadge = t.task_type === 'askod' && t.askod_number
                ? `<span style="font-size:10px; font-weight:700; background:rgba(59, 130, 246, 0.15); color:var(--accent-deep); padding: 2px 6px; border-radius: 4px; font-family:monospace; margin-left: 6px; display:inline-block; vertical-align: middle;">№ ${t.askod_number}</span>`
                : '';
              
              return `
                <div ${collapsedAttr}>
                  <!-- Header Row -->
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;">
                    <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                      <span class="glow-bulb ${bulbColor}" title="Терміновість: ${daysText}"></span>
                      <span class="task-brief-title" style="font-weight: 700; font-size: 13px;" title="${t.title.replace(/"/g, '&quot;')}">
                        <span style="color: var(--accent, #3b82f6); font-family: monospace; font-weight: 800; margin-right: 4px;">№ ${index + 1}</span>
                        ${t.title}
                        ${askodBadge}
                      </span>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                      <span style="font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px;" class="task-brief-deadline ${dateClass}">до ${dateStr}</span>
                      <div class="task-brief-progress-wrapper" style="width: 80px; margin: 0; gap: 6px;">
                        <div class="task-brief-progress-bg" style="height: 5px; margin: 0;">
                          <div class="task-brief-progress-bar" style="width: ${t.progress}%"></div>
                        </div>
                        <span class="task-brief-progress-val" style="font-size: 10.5px; min-width: 25px;">${t.progress}%</span>
                      </div>
                      <span class="expand-arrow" style="font-size: 10px; color: var(--p-muted); transition: transform 0.2s;">▼</span>
                    </div>
                  </div>
                  
                  <!-- Short description preview (visible when collapsed) -->
                  <div class="task-brief-desc-preview" style="font-size: 11px; color: var(--p-muted); padding-left: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
                    ${t.description || 'Опис відсутній'}
                  </div>

                  <!-- Expanded Details Panel -->
                  <div class="task-brief-details" style="display: none; padding-top: 10px; margin-top: 8px; border-top: 1px dashed var(--p-line, #e2e8f0); font-size: 12px; color: var(--p-ink);">
                    <div style="margin-bottom: 8px; line-height: 1.4;">
                      <strong>📝 Опис доручення:</strong> 
                      <div style="margin-top: 4px; background: var(--p-soft, #f7fafc); padding: 8px 12px; border-radius: 6px; color: var(--p-ink); font-size: 11.5px; border-left: 3px solid var(--accent); white-space: pre-line;">
                        ${t.description || 'Детальний опис доручення відсутній.'}
                      </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; flex-wrap: wrap; gap: 8px;">
                      <span style="font-size: 11px; color: var(--p-muted);">
                        Важливість: <strong>${t.importance === 'critical' ? '🔴 Термінова' : (t.importance === 'important' ? '🟡 Висока' : '🟢 Звичайна')}</strong>
                        ${t.department ? ` | Підрозділ: <strong>${t.department}</strong>` : ''}
                        ${t.askod_sender ? ` | Відправник: <strong>${t.askod_sender}</strong>` : ''}
                      </span>
                      <a href="${prefix}skod/task-detail.html?id=${t.id}" class="dashboard-action-btn primary" style="padding: 5px 12px; font-size: 11px; text-decoration: none; border-radius: 6px; background: var(--accent); color: white; display: inline-flex; align-items: center; gap: 4px; font-weight: 700;">
                        🔗 Відкрити картку доручення
                      </a>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          ${userTasks.length > 3 ? `
            <div style="font-size: 11px; text-align: right; margin-top: 4px; font-weight: 600;">
              <a href="#" id="dashboard-toggle-tasks" data-expanded="false" style="color: var(--accent, #3b82f6); text-decoration: none;">...та ще ${userTasks.length - 3} активних доручень (Розгорнути)</a>
            </div>
          ` : ''}
        ` : `
          <span class="tasks-summary-lbl font-soft">📋 У вас немає активних доручень на виконанні.</span>
        `}
      </div>
      
      <div class="reminders-summary-section">
        ${activeReminders.length > 0 ? `
          <div class="tasks-summary-header">
            <span class="tasks-summary-lbl">📅 Нагадування про терміни звітування (активних: <strong>${activeReminders.length}</strong>):</span>
          </div>
          <div class="reminders-brief-list">
            ${activeReminders.map((r, index) => {
              const itemClass = r.urgency === 'critical' ? 'critical' : (r.urgency === 'high' ? 'high' : '');
              const warningBadgeClass = r.urgency === 'critical' ? 'critical' : (r.urgency === 'high' ? 'high' : (r.urgency === 'medium' ? 'medium' : 'low'));
              const collapsedAttr = index >= 3 ? `class="reminder-brief-item ${itemClass} is-collapsed-hidden" style="display: none;"` : `class="reminder-brief-item ${itemClass}"`;
              return `
                <div ${collapsedAttr}>
                  <span class="reminder-brief-title" title="${r.title}">
                    <a href="${prefix}reminders/index.html" style="color: inherit; text-decoration: none; border-bottom: 1px dashed var(--accent, #3b82f6); transition: color 0.2s;" onmouseover="this.style.color='var(--accent, #3b82f6)'" onmouseout="this.style.color='inherit'">${r.title}</a>
                  </span>
                  <span class="reminder-brief-warning ${warningBadgeClass}">${r.badgeLabel}: ${r.warningText}</span>
                </div>
              `;
            }).join('')}
          </div>
          ${activeReminders.length > 3 ? `
            <div style="font-size: 11px; text-align: right; margin-top: 4px; font-weight: 600;">
              <a href="#" id="dashboard-toggle-reminders" data-expanded="false" style="color: var(--accent, #3b82f6); text-decoration: none;">...та ще ${activeReminders.length - 3} термінів (Розгорнути)</a>
            </div>
          ` : ''}
        ` : `
          <span class="tasks-summary-lbl font-soft">📅 Усі найближчі звіти успішно надіслано.</span>
        `}
      </div>

      <div class="dashboard-actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
        <a href="${prefix}skod/index.html" class="dashboard-action-btn">✍️ Внести роботу</a>
        <a href="${prefix}skod/reports.html" class="dashboard-action-btn" style="background: var(--p-soft); border: 1px solid var(--p-line); color: var(--p-ink); display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none;">📊 Звіти та аналітика</a>
        ${showManagerAction ? `<a href="${prefix}skod/tasks.html" class="dashboard-action-btn primary">📋 Надати доручення</a>` : ''}
      </div>
    </div>
  `;

  // Attach event listeners for expand/collapse actions
  const toggleTasksBtn = dashboardEl.querySelector('#dashboard-toggle-tasks');
  if (toggleTasksBtn) {
    toggleTasksBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const hiddenItems = dashboardEl.querySelectorAll('.task-brief-item.is-collapsed-hidden');
      const isExpanded = toggleTasksBtn.dataset.expanded === 'true';
      
      hiddenItems.forEach(item => {
        item.style.display = isExpanded ? 'none' : 'flex';
      });
      
      toggleTasksBtn.dataset.expanded = !isExpanded;
      toggleTasksBtn.textContent = isExpanded 
        ? `...та ще ${userTasks.length - 3} активних доручень (Розгорнути)` 
        : `Згорнути список доручень`;
    });
  }

  const toggleRemindersBtn = dashboardEl.querySelector('#dashboard-toggle-reminders');
  if (toggleRemindersBtn) {
    toggleRemindersBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const hiddenItems = dashboardEl.querySelectorAll('.reminder-brief-item.is-collapsed-hidden');
      const isExpanded = toggleRemindersBtn.dataset.expanded === 'true';
      
      hiddenItems.forEach(item => {
        item.style.display = isExpanded ? 'none' : 'flex';
      });
      
      toggleRemindersBtn.dataset.expanded = !isExpanded;
      toggleRemindersBtn.textContent = isExpanded 
        ? `...та ще ${activeReminders.length - 3} термінів (Розгорнути)` 
        : `Згорнути список нагадувань`;
    });
  }

  // Add interactive click delegation for task-brief-item expansion
  dashboardEl.addEventListener('click', (e) => {
    const item = e.target.closest('.task-brief-item');
    if (item) {
      // Don't toggle if the user clicked on a link or button
      if (e.target.closest('a') || e.target.closest('button')) {
        return;
      }
      const details = item.querySelector('.task-brief-details');
      if (details) {
        const isVisible = details.style.display === 'block';
        details.style.display = isVisible ? 'none' : 'block';
        item.classList.toggle('is-expanded', !isVisible);
      }
    }
  });
}

async function init() {
  inject();
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user ?? null;
  await fetchRole();
  applyAccess();

  trackGlobalPresence();
  setupNewsRealtime();
  setupTasksRealtime();
  
  // Daily Status Initialization
  loadUserDailyStatus();
  loadTeamPresence();
  setupRealtimeStatus();

  // Ask for browser notification permission proactively if support is available
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  sb.auth.onAuthStateChange(async (_event, session) => {
    user = session?.user ?? null;
    await fetchRole();
    applyAccess();
    trackGlobalPresence();
    setupNewsRealtime();
    setupTasksRealtime();
    
    // Daily Status update on Auth change
    loadUserDailyStatus();
    loadTeamPresence();
    setupRealtimeStatus();
  });
}

async function renderAlertBanner(alertBanner, prefix) {
  try {
    const { data, error } = await sb
      .from('news')
      .select('id, title, importance, created_at')
      .in('importance', ['important', 'urgent'])
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.warn("Failed to load news alerts:", error);
      alertBanner.style.display = 'none';
      return;
    }

    if (!data || data.length === 0) {
      alertBanner.style.display = 'none';
      return;
    }

    alertBanner.style.display = 'block';
    
    let hasUrgent = data.some(n => n.importance === 'urgent');
    alertBanner.className = hasUrgent ? 'news-alert-banner urgent' : 'news-alert-banner important';
    
    const icon = hasUrgent ? '🚨' : '⚠️';
    const titleText = hasUrgent ? 'Увага! Термінові оголошення:' : 'Важливі оголошення:';
    
    const escapeHtml = (str) => {
      if (!str) return "";
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    const linksHtml = data.map(n => {
      const isUrgent = n.importance === 'urgent';
      const badge = isUrgent 
        ? '<span class="alert-badge urgent"><span class="pulse-dot"></span> Терміново</span>' 
        : '<span class="alert-badge important">Важливо</span>';
      return `
        <div class="news-alert-item">
          ${badge}
          <a href="${prefix}news/index.html?id=${n.id}" class="news-alert-link" target="_blank">${escapeHtml(n.title)}</a>
        </div>
      `;
    }).join('');

    alertBanner.innerHTML = `
      <div class="wrap">
        <div class="news-alert-inner">
          <div class="news-alert-title">${icon} ${titleText}</div>
          <div class="news-alert-list">
            ${linksHtml}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("Alert banner render error:", err);
    alertBanner.style.display = 'none';
  }
}

let globalPresenceChannel = null;

async function trackGlobalPresence() {
  // Unsubscribe existing channel to recreate it with the new auth state
  if (globalPresenceChannel) {
    globalPresenceChannel.unsubscribe();
    globalPresenceChannel = null;
  }

  const isChatPage = window.location.pathname.toLowerCase().includes('/chat/');
  const displayName = user ? (user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0]) : null;

  globalPresenceChannel = sb.channel('chat_room', {
    config: {
      presence: {
        key: user ? user.id : 'anonymous-' + Math.random().toString(36).substring(2, 9)
      }
    }
  });

  globalPresenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = globalPresenceChannel.presenceState();
      updateGlobalOnlineCount(state);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        if (user && !isChatPage) {
          try {
            await globalPresenceChannel.track({
              user_id: user.id,
              user_name: displayName,
              online_at: new Date().toISOString()
            });
          } catch (e) {
            console.error("Failed to track global presence:", e);
          }
        }
      }
    });
}

function updateGlobalOnlineCount(state) {
  const countLbl = document.getElementById('portal-online-count');
  const dropdownList = document.getElementById('portal-online-users-list');
  if (!countLbl || !dropdownList) return;

  const uniqueUsers = [];
  const seenIds = new Set();

  for (const key in state) {
    const presences = state[key];
    if (presences && presences.length > 0) {
      const p = presences[0];
      if (p.user_id && !seenIds.has(p.user_id)) {
        seenIds.add(p.user_id);
        uniqueUsers.push({
          id: p.user_id,
          name: p.user_name || 'Співробітник'
        });
      }
    }
  }

  countLbl.textContent = uniqueUsers.length;

  dropdownList.innerHTML = "";
  if (uniqueUsers.length === 0) {
    dropdownList.innerHTML = '<li style="color: var(--muted); font-style: italic;">Нікого немає</li>';
  } else {
    uniqueUsers.forEach(u => {
      const li = document.createElement('li');
      li.textContent = u.name;
      dropdownList.appendChild(li);
    });
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark-theme');
  localStorage.setItem('portal-theme', isDark ? 'dark' : 'light');
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.textContent = isDark ? '☀️' : '🌙';
  }
}

/* ── Realtime News Subscription & Alerting ──────────────── */
let newsSubscription = null;

function setupNewsRealtime() {
  if (!user || role === 'guest') return;

  if (newsSubscription) {
    sb.removeChannel(newsSubscription);
    newsSubscription = null;
  }

  newsSubscription = sb.channel('realtime_news_alerts')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'news' }, payload => {
      const newArticle = payload.new;
      if (newArticle && ['important', 'urgent'].includes(newArticle.importance)) {
        triggerNewsAlertNotification(newArticle);
        
        // Re-render the alert banner dynamically if it's on screen
        const alertBanner = document.getElementById('user-news-alert-banner');
        if (alertBanner) {
          const pathParts = window.location.pathname.split('/');
          const isInSubdir = pathParts.some(part => [
            'zoz-questions', 'pmg-proposals', 'news', 'chat', 'pakety', 'postanova', 'algorithms', 'zoz-dogovr', 'skod', 'dec', 'regulatory', 'infocenter'
          ].includes(part.toLowerCase()));
          const prefix = isInSubdir ? '../' : './';
          renderAlertBanner(alertBanner, prefix);
        }
      }
    })
    .subscribe();
}

function triggerNewsAlertNotification(newsItem) {
  const notificationsEnabled = localStorage.getItem('news_notifications_enabled') !== 'false';
  if (!notificationsEnabled) return;

  if (!('Notification' in window)) return;

  playNewsAlertSound();

  const isTabHidden = document.hidden || !document.hasFocus();
  if (isTabHidden && Notification.permission === 'granted') {
    const title = newsItem.importance === 'urgent' ? '🚨 Термінове оголошення!' : '⚠️ Важливе оголошення!';
    const pathParts = window.location.pathname.split('/');
    const isInSubdir = pathParts.some(part => [
      'zoz-questions', 'pmg-proposals', 'news', 'chat', 'pakety', 'postanova', 'algorithms', 'zoz-dogovr', 'skod', 'dec', 'regulatory', 'infocenter'
    ].includes(part.toLowerCase()));
    const prefix = isInSubdir ? '../' : './';

    const notification = new Notification(title, {
      body: newsItem.title,
      icon: prefix + "assets/nszu-shield.svg",
      tag: "news-alert",
      renotify: true
    });

    notification.onclick = () => {
      window.focus();
      window.open(prefix + "news/index.html?id=" + newsItem.id, "_blank");
      notification.close();
    };
  }
}

function playNewsAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    const gain2 = ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(440, ctx.currentTime);
    gain1.gain.setValueAtTime(0.08, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.3);

    setTimeout(() => {
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(554.37, ctx.currentTime);
      gain2.gain.setValueAtTime(0.08, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.4);
    }, 120);
  } catch (e) {
    console.error("Audio beep error:", e);
  }
}

/* ── Realtime Tasks Subscription & Alerting ──────────────── */
let tasksSubscription = null;

function setupTasksRealtime() {
  if (!user || role === 'guest') return;

  if (tasksSubscription) {
    sb.removeChannel(tasksSubscription);
    tasksSubscription = null;
  }

  tasksSubscription = sb.channel('realtime_tasks_alerts')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assigned_tasks' }, payload => {
      const newTask = payload.new;
      if (newTask && newTask.responsible_id === user.id) {
        triggerTaskAlertNotification(newTask);

        // Dynamically re-render dashboard list if present on the page
        const dashboardEl = document.getElementById('user-task-dashboard');
        if (dashboardEl) {
          const pathParts = window.location.pathname.split('/');
          const isInSubdir = pathParts.some(part => [
            'zoz-questions', 'pmg-proposals', 'news', 'chat', 'pakety', 'postanova', 'algorithms', 'zoz-dogovr', 'skod', 'dec', 'regulatory', 'infocenter'
          ].includes(part.toLowerCase()));
          const prefix = isInSubdir ? '../' : './';
          renderDashboard(dashboardEl, prefix);
        }
      }
    })
    .subscribe();
}

function triggerTaskAlertNotification(task) {
  const notificationsEnabled = localStorage.getItem('news_notifications_enabled') !== 'false';
  if (!notificationsEnabled) return;

  playNewsAlertSound();

  const importanceLabels = {
    normal: '🟢 Звичайна важливість',
    important: '🟡 Висока важливість',
    critical: '🔴 Термінова важливість'
  };
  const impText = importanceLabels[task.importance] || 'Звичайна важливість';
  const title = `Нове доручення (${impText})`;

  const pathParts = window.location.pathname.split('/');
  const isInSubdir = pathParts.some(part => [
    'zoz-questions', 'pmg-proposals', 'news', 'chat', 'pakety', 'postanova', 'algorithms', 'zoz-dogovr', 'skod', 'dec', 'regulatory', 'infocenter'
  ].includes(part.toLowerCase()));
  const prefix = isInSubdir ? '../' : './';
  const targetUrl = prefix + "skod/task-detail.html?id=" + task.id;

  const isTabHidden = document.hidden || !document.hasFocus();
  if (isTabHidden && 'Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, {
      body: task.title,
      icon: prefix + "assets/nszu-shield.svg",
      tag: "task-alert",
      renotify: true
    });

    notification.onclick = () => {
      window.focus();
      window.open(targetUrl, "_blank");
      notification.close();
    };
  } else {
    // Show premium on-screen toast notification when page is active or permissions are not set
    showOnScreenToast(title, task.title, targetUrl);
  }
}

function showOnScreenToast(title, body, url) {
  let container = document.getElementById('portal-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'portal-toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    container.style.zIndex = '999999';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.background = 'var(--p-surface, #ffffff)';
  toast.style.color = 'var(--p-ink, #0f172a)';
  toast.style.padding = '16px 20px';
  toast.style.borderRadius = '12px';
  toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.05)';
  toast.style.border = '1.5px solid var(--p-line, #e2e8f0)';
  toast.style.minWidth = '320px';
  toast.style.maxWidth = '400px';
  toast.style.cursor = 'pointer';
  toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
  toast.style.transform = 'translateY(20px)';
  toast.style.opacity = '0';
  toast.style.display = 'flex';
  toast.style.flexDirection = 'column';
  toast.style.gap = '6px';
  toast.style.fontFamily = 'inherit';

  if (!document.getElementById('toast-animation-style')) {
    const style = document.createElement('style');
    style.id = 'toast-animation-style';
    style.textContent = `
      .portal-toast-slide {
        transform: translateY(0) !important;
        opacity: 1 !important;
      }
      .portal-toast-slide:hover {
        transform: translateY(-4px) !important;
        box-shadow: 0 12px 35px rgba(0,0,0,0.2), 0 2px 5px rgba(0,0,0,0.08) !important;
      }
    `;
    document.head.appendChild(style);
  }

  toast.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid var(--p-line); padding-bottom:6px;">
      <strong style="color:var(--accent, #3b82f6); font-size:14px; font-weight:800; display:flex; align-items:center; gap:6px;">📋 ${title}</strong>
      <button class="toast-close" style="background:none; border:none; color:var(--p-muted); font-size:18px; cursor:pointer; padding:0 4px; line-height:1;">&times;</button>
    </div>
    <div style="font-size:13px; font-weight:700; line-height:1.4; color:var(--p-ink);">${body}</div>
    <div style="font-size:11px; color:var(--accent, #3b82f6); text-align:right; font-weight:800; margin-top:4px;">Відкрити доручення &rarr;</div>
  `;

  toast.querySelector('.toast-close').addEventListener('click', (e) => {
    e.stopPropagation();
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  });

  toast.addEventListener('click', () => {
    window.open(url, '_blank');
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => toast.classList.add('portal-toast-slide'), 50);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      setTimeout(() => toast.remove(), 300);
    }
  }, 8000);
}


/* ── Daily User Status Business Logic ─────────────────────── */
let todayStatus = null;
let statusSubscription = null;

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function loadUserDailyStatus() {
  if (!user || role === 'guest') return;
  const todayStr = getLocalDateString();
  
  try {
    const { data, error } = await sb
      .from('user_daily_statuses')
      .select('status')
      .eq('user_id', user.id)
      .eq('status_date', todayStr)
      .maybeSingle();
      
    if (error) {
      console.warn("Failed to load user daily status:", error);
      const cached = localStorage.getItem(`daily_status_${user.id}_${todayStr}`);
      if (cached) {
        updateStatusUI(cached);
      } else {
        updateStatusUI(null);
      }
      return;
    }
    
    if (data) {
      todayStatus = data.status;
      localStorage.setItem(`daily_status_${user.id}_${todayStr}`, todayStatus);
      updateStatusUI(todayStatus);
    } else {
      todayStatus = null;
      updateStatusUI(null);
    }
  } catch (err) {
    console.error("Error in loadUserDailyStatus:", err);
  }
}

function updateStatusUI(status) {
  const chip = document.getElementById('portal-status-chip');
  if (!chip) return;
  
  chip.className = 'portal-status-chip';
  const iconEl = chip.querySelector('.status-icon');
  const lblEl = chip.querySelector('.status-lbl');
  
  const statusConfig = {
    office: { icon: '🏢', text: 'Офіс', className: 'status-office' },
    home: { icon: '🏡', text: 'Вдома', className: 'status-home' },
    sick: { icon: '🏥', text: 'Лікарняний', className: 'status-sick' },
    vacation: { icon: '🌴', text: 'Відпустка', className: 'status-vacation' },
    agreement: { icon: '🤝', text: 'За домовл.', className: 'status-agreement' }
  };
  
  if (status && statusConfig[status]) {
    const config = statusConfig[status];
    iconEl.textContent = config.icon;
    lblEl.textContent = config.text;
    chip.classList.add(config.className);
  } else {
    iconEl.textContent = '❓';
    lblEl.textContent = 'Вкажіть статус';
    chip.classList.add('needs-activation');
  }
  
  document.querySelectorAll('.status-opt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
}

async function saveUserDailyStatus(status) {
  if (!user || role === 'guest') return;
  const todayStr = getLocalDateString();
  let displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
  
  let userDept = '';
  try {
    const { data: prof } = await sb.from('profiles').select('Section, department, full_name').eq('id', user.id).single();
    userDept = prof?.Section || prof?.department || '';
    if (prof?.full_name) {
      displayName = prof.full_name;
    }
  } catch(e) {}
  
  try {
    updateStatusUI(status);
    
    const { error } = await sb
      .from('user_daily_statuses')
      .upsert({
        user_id: user.id,
        user_name: displayName,
        department: userDept,
        status_date: todayStr,
        status: status
      }, { onConflict: 'user_id, status_date' });
      
    if (error) {
      console.error("Failed to save daily status to DB:", error);
      localStorage.setItem(`daily_status_${user.id}_${todayStr}`, status);
      updateStatusUI(status);
      alert("Не вдалося зберегти статус у хмару, збережено локально.");
    } else {
      todayStatus = status;
      localStorage.setItem(`daily_status_${user.id}_${todayStr}`, status);
      
      setTimeout(() => {
        const dropdown = document.getElementById('portal-status-dropdown');
        if (dropdown) dropdown.classList.remove('show');
      }, 300);
    }
  } catch (err) {
    console.error("Error in saveUserDailyStatus:", err);
  }
}

async function loadTeamPresence() {
  if (!user) return;
  const todayStr = getLocalDateString();
  const listEl = document.getElementById('colleagues-status-list');
  if (!listEl) return;
  
  try {
    const { data: profiles, error: profErr } = await sb
      .from('profiles')
      .select('id, full_name, role')
      .neq('role', 'guest');
      
    if (profErr) {
      console.warn("Failed to load profiles for presence:", profErr);
      listEl.innerHTML = '<li style="color:var(--muted)">Помилка завантаження профілів</li>';
      return;
    }
    
    const { data: statuses, error: statErr } = await sb
      .from('user_daily_statuses')
      .select('user_id, user_name, status')
      .eq('status_date', todayStr);
      
    if (statErr) {
      console.warn("Failed to load daily statuses for presence:", statErr);
      listEl.innerHTML = '<li style="color:var(--muted)">Помилка завантаження статусів</li>';
      return;
    }
    
    const statusMap = {};
    statuses?.forEach(s => {
      statusMap[s.user_id] = s.status;
    });
    
    const groups = {
      office: { title: '🏢 В офісі', names: [] },
      home: { title: '🏡 Вдома', names: [] },
      sick: { title: '🏥 Лікарняний', names: [] },
      vacation: { title: '🌴 Відпустка', names: [] },
      agreement: { title: '🤝 За домовл.', names: [] },
      none: { title: '🔴 Не вказано', names: [] }
    };
    
    profiles?.forEach(p => {
      const status = statusMap[p.id];
      const name = p.full_name || 'Співробітник';
      if (status && groups[status]) {
        groups[status].names.push(name);
      } else {
        groups.none.names.push(name);
      }
    });
    
    let html = '';
    let hasAnyData = false;
    
    for (const key in groups) {
      const g = groups[key];
      if (g.names.length > 0) {
        hasAnyData = true;
        html += `
          <div class="colleague-group">
            <div class="colleague-group-title">${g.title} (${g.names.length})</div>
            <div class="colleague-names">${g.names.join(', ')}</div>
          </div>
        `;
      }
    }
    
    if (!hasAnyData) {
      listEl.innerHTML = '<li style="color: var(--muted); font-style: italic;">Немає активних колег</li>';
    } else {
      listEl.innerHTML = html;
    }
  } catch (err) {
    console.error("Error loading team presence:", err);
    listEl.innerHTML = '<li style="color:var(--muted)">Помилка завантаження</li>';
  }
}

function setupRealtimeStatus() {
  if (!user || role === 'guest') return;
  
  if (statusSubscription) {
    sb.removeChannel(statusSubscription);
    statusSubscription = null;
  }
  
  statusSubscription = sb.channel('realtime_daily_statuses')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_daily_statuses' }, payload => {
      const todayStr = getLocalDateString();
      const newRecord = payload.new;
      const oldRecord = payload.old;
      
      const isRecordToday = (newRecord && newRecord.status_date === todayStr) || 
                            (oldRecord && oldRecord.status_date === todayStr);
                            
      if (isRecordToday) {
        loadTeamPresence();
        
        if (newRecord && newRecord.user_id === user.id) {
          todayStatus = newRecord.status;
          updateStatusUI(todayStatus);
        }
      }
    })
    .subscribe();
}

document.addEventListener('DOMContentLoaded', init);
