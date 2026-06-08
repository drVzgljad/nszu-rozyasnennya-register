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
  role = data?.role ?? 'guest';
  isHead = data?.is_head ?? false;
}

function applyAccess() {
  const pathParts = window.location.pathname.split('/');
  const isInSubdir = pathParts.some(part => [
    'zoz-questions', 'pmg-proposals', 'news', 'chat', 'pakety', 'postanova', 'algorithms', 'zoz-dogovr', 'skod'
  ].includes(part.toLowerCase()));
  const prefix = isInSubdir ? '../' : './';
  const currentPath = window.location.pathname.toLowerCase();

  // Update standalone Chat button in top nav
  const chatBtn = document.getElementById('auth-chat-btn');
  if (chatBtn) {
    chatBtn.href = prefix + 'chat/index.html';
    const hasChatAccess = hasAccess('expert');
    if (!hasChatAccess) {
      chatBtn.classList.add('is-locked');
      chatBtn.innerHTML = `Робочий чат <span class="lock-icon">🔒</span>`;
      chatBtn.onclick = (e) => {
        e.preventDefault();
        if (!user) {
          openModal('login');
        } else {
          const overlay = document.getElementById('access-denied-overlay');
          if (overlay) {
            const msg = document.getElementById('access-denied-msg');
            if (msg) {
              msg.textContent = 'Робочий чат доступний лише для співробітників департаменту.';
            }
            overlay.style.display = 'flex';
          } else {
            alert('Робочий чат доступний лише для співробітників департаменту.');
          }
        }
      };
    } else {
      chatBtn.classList.remove('is-locked');
      chatBtn.innerHTML = `Робочий чат`;
      chatBtn.onclick = null;
    }
  }

  // Update standalone SKOD Report button in top nav
  const skodBtn = document.getElementById('auth-skod-btn');
  if (skodBtn) {
    skodBtn.href = prefix + 'skod/reports.html';
    const hasSkodAccess = hasAccess('expert');
    if (!hasSkodAccess) {
      skodBtn.classList.add('is-locked');
      skodBtn.innerHTML = `Звіт СКО-Д <span class="lock-icon">🔒</span>`;
      skodBtn.onclick = (e) => {
        e.preventDefault();
        if (!user) {
          openModal('login');
        } else {
          const overlay = document.getElementById('access-denied-overlay');
          if (overlay) {
            const msg = document.getElementById('access-denied-msg');
            if (msg) {
              msg.textContent = 'Звіти СКО-Д доступні лише для зареєстрованих співробітників.';
            }
            overlay.style.display = 'flex';
          } else {
            alert('Звіти СКО-Д доступні лише для зареєстрованих співробітників.');
          }
        }
      };
    } else {
      skodBtn.classList.remove('is-locked');
      skodBtn.innerHTML = `Звіт СКО-Д`;
      skodBtn.onclick = null;
    }
  }

  // Update standalone SKOD Tasks button in top nav
  const tasksBtn = document.getElementById('auth-tasks-btn');
  if (tasksBtn) {
    tasksBtn.href = prefix + 'skod/tasks.html';
    const hasTasksAccess = hasAccess('manager');
    if (!hasTasksAccess) {
      tasksBtn.classList.add('is-locked');
      tasksBtn.innerHTML = `Доручення <span class="lock-icon">🔒</span>`;
      tasksBtn.onclick = (e) => {
        e.preventDefault();
        if (!user) {
          openModal('login');
        } else {
          const overlay = document.getElementById('access-denied-overlay');
          if (overlay) {
            const msg = document.getElementById('access-denied-msg');
            if (msg) {
              msg.textContent = 'Ця сторінка доступна лише для керівництва (Директор, Заступники, Начальники відділів та Адміністратор).';
            }
            overlay.style.display = 'flex';
          } else {
            alert('Ця сторінка доступна лише для керівництва (Директор, Заступники, Начальники відділів та Адміністратор).');
          }
        }
      };
    } else {
      tasksBtn.classList.remove('is-locked');
      tasksBtn.innerHTML = `Доручення`;
      tasksBtn.onclick = null;
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

  // Show/hide role-gated elements
  document.querySelectorAll('[data-role]').forEach(el => {
    el.style.display = hasAccess(el.dataset.role) ? '' : 'none';
  });

  // Dynamic navigation links injection
  function isActive(itemPath) {
    const normalized = itemPath.replace(/^\.\.\/|^\.\//, '');
    const segments = normalized.split('/');
    
    if (normalized === 'index.html') {
      const isSub = ['pakety', 'postanova', 'algorithms', 'zoz-questions', 'pmg-proposals', 'news', 'chat', 'rozjasnennya.html', 'zoz-dogovr', 'skod'].some(s => currentPath.includes(s));
      return !isSub && (currentPath.endsWith('/') || currentPath.endsWith('index.html'));
    }
    
    if (normalized === 'rozjasnennya.html') {
      return currentPath.includes('rozjasnennya.html');
    }
    
    if (normalized === 'pakety/report.html') {
      return currentPath.includes('report.html');
    }
    
    if (normalized === 'pakety/index.html') {
      return currentPath.includes('/pakety/') && !currentPath.includes('report.html');
    }
    
    return currentPath.includes(segments[0]);
  }

  const navContainer = document.querySelector('nav.section-switch:not(.top-auth)') || document.querySelector('.top-nav');
  if (navContainer) {
    navContainer.innerHTML = ''; // Rebuild dynamically

    const coreItems = [
      { text: 'Головна', path: 'index.html' },
      { text: 'Реєстр', path: 'rozjasnennya.html' },
      { text: 'Пакети 2026', path: 'pakety/index.html' },
      { text: 'Постанова 1808', path: 'postanova/index.html' },
      { text: 'Алгоритми та правила', path: 'algorithms/index.html' },
      { text: 'Укладені договори', path: 'zoz-dogovr/index.html' },
      { text: 'Робочий чат', path: 'chat/index.html', isChat: true }
    ];

    const dropdownItems = [
      { text: 'Машина пошуку', path: 'pakety/report.html', role: 'expert' },
      { text: 'Питання ЗОЗ', path: 'zoz-questions/index.html', role: 'expert' },
      { text: 'Пропозиції ПМГ', path: 'pmg-proposals/index.html', role: 'expert' },
      { text: 'СКО-Д (Внесення)', path: 'skod/index.html', role: 'expert' },
      { text: 'СКО-Д (Звіти)', path: 'skod/reports.html', role: 'expert' },
      { text: 'СКО-Д (Доручення)', path: 'skod/tasks.html', role: 'manager' },
      { text: 'Новини', path: 'news/index.html', role: 'expert' }
    ];

    // 1. Core navigation tabs
    coreItems.forEach(item => {
      const a = document.createElement('a');
      a.href = prefix + item.path;
      
      if (item.isChat) {
        a.className = 'nav-chat-btn';
        const hasChatAccess = hasAccess('expert');
        if (!hasChatAccess) {
          a.classList.add('is-locked');
          a.innerHTML = `<span>${item.text}</span> <span class="lock-icon">🔒</span>`;
          a.addEventListener('click', (e) => {
            e.preventDefault();
            if (!user) {
              openModal('login');
            } else {
              const overlay = document.getElementById('access-denied-overlay');
              if (overlay) {
                const msg = document.getElementById('access-denied-msg');
                if (msg) {
                  msg.textContent = 'Робочий чат доступний лише для співробітників департаменту.';
                }
                overlay.style.display = 'flex';
              } else {
                alert('Робочий чат доступний лише для співробітників департаменту.');
              }
            }
          });
        } else {
          a.textContent = item.text;
        }
      } else {
        a.textContent = item.text;
      }

      if (isActive(item.path)) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
      navContainer.appendChild(a);
    });

    // 2. Dropdown menu for role-gated items
    const isDropdownActive = dropdownItems.some(item => isActive(item.path));
    
    const dropdownDiv = document.createElement('div');
    dropdownDiv.className = 'nav-dropdown';
    
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-dropdown-btn';
    if (isDropdownActive) btn.classList.add('active');
    btn.innerHTML = `Сервіси <span class="nav-dropdown-arrow">▼</span>`;
    
    const menuDiv = document.createElement('div');
    menuDiv.className = 'nav-dropdown-menu';
    
    dropdownItems.forEach(item => {
      const a = document.createElement('a');
      a.href = prefix + item.path;
      
      const hasPermission = hasAccess(item.role);
      a.innerHTML = `<span>${item.text}</span> ${hasPermission ? '' : '<span class="lock-icon">🔒</span>'}`;
      
      if (isActive(item.path)) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
      menuDiv.appendChild(a);
    });
    
    dropdownDiv.appendChild(btn);
    dropdownDiv.appendChild(menuDiv);
    navContainer.appendChild(dropdownDiv);
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
  let alertBanner = document.getElementById('user-news-alert-banner');
  if (header) {
    if (!user || role === 'guest') {
      if (dashboard) dashboard.remove();
      if (alertBanner) alertBanner.remove();
    } else {
      if (!dashboard) {
        dashboard = document.createElement('div');
        dashboard.id = 'user-task-dashboard';
        dashboard.className = 'user-task-dashboard';
        header.insertAdjacentElement('afterend', dashboard);
      }
      renderDashboard(dashboard, prefix);

      // Inject News Alert Banner below dashboard
      if (!alertBanner) {
        alertBanner = document.createElement('div');
        alertBanner.id = 'user-news-alert-banner';
        dashboard.insertAdjacentElement('afterend', alertBanner);
      }
      renderAlertBanner(alertBanner, prefix);
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

    // Standalone Chat button in top nav
    const topChatBtn = document.createElement('a');
    topChatBtn.id = 'auth-chat-btn';
    topChatBtn.className = 'auth-chat-btn';
    topChatBtn.textContent = 'Робочий чат';
    container.appendChild(topChatBtn);

    // Standalone SKOD Report button in top nav
    const topSkodBtn = document.createElement('a');
    topSkodBtn.id = 'auth-skod-btn';
    topSkodBtn.className = 'auth-skod-btn';
    topSkodBtn.textContent = 'Звіт СКО-Д';
    container.appendChild(topSkodBtn);

    // Standalone Tasks button in top nav
    const topTasksBtn = document.createElement('a');
    topTasksBtn.id = 'auth-tasks-btn';
    topTasksBtn.className = 'auth-tasks-btn';
    topTasksBtn.textContent = 'Доручення';
    container.appendChild(topTasksBtn);

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
      .select('id, title, deadline, progress, status, description')
      .eq('responsible_id', user.id)
      .neq('status', 'completed')
      .order('deadline', { ascending: true });
    userTasks = data || [];
  } catch(e) {}

  const showManagerAction = ['admin', 'director', 'deputy_director', 'manager'].includes(role);
  const tasksToShow = userTasks.slice(0, 3);

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
            ${tasksToShow.map(t => {
              const daysLeft = Math.ceil((new Date(t.deadline) - new Date()) / (1000 * 60 * 60 * 24));
              const dateStr = new Date(t.deadline).toLocaleDateString('uk-UA');
              const dateClass = daysLeft < 0 ? 'overdue' : (daysLeft <= 3 ? 'urgent' : 'normal');
              const daysText = daysLeft < 0 ? `(Протерміновано)` : (daysLeft === 0 ? `(Сьогодні!)` : `(залишилось ${daysLeft} дн.)`);
              return `
                <div class="task-brief-item">
                  <div class="task-brief-content">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 2px;">
                      <span class="task-brief-title" title="${t.title}">
                        <a href="${prefix}skod/task-detail.html?id=${t.id}" target="_blank" style="color: inherit; text-decoration: none; border-bottom: 1px dashed var(--accent, #3b82f6); transition: color 0.2s;" onmouseover="this.style.color='var(--accent, #3b82f6)'" onmouseout="this.style.color='inherit'">${t.title}</a>
                      </span>
                      <span class="task-brief-deadline ${dateClass}">до ${dateStr} ${daysText}</span>
                    </div>
                    ${t.description ? `<div class="task-brief-desc" title="${t.description.replace(/"/g, '&quot;')}">${t.description}</div>` : ''}
                  </div>
                  <div class="task-brief-progress-wrapper">
                    <div class="task-brief-progress-bg">
                      <div class="task-brief-progress-bar" style="width: ${t.progress}%"></div>
                    </div>
                    <span class="task-brief-progress-val">${t.progress}%</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          ${userTasks.length > 3 ? `
            <div style="font-size: 11px; text-align: right; margin-top: 4px; color: var(--muted, #627287); font-weight: 600;">
              ...та ще ${userTasks.length - 3} активних доручень (перегляньте у «Сервіси $\rightarrow$ СКО-Д (Доручення)»)
            </div>
          ` : ''}
        ` : `
          <span class="tasks-summary-lbl font-soft">📋 У вас немає активних доручень на виконанні.</span>
        `}
      </div>
      <div class="dashboard-actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
        <a href="${prefix}skod/index.html" class="dashboard-action-btn">✍️ Внести роботу</a>
        <a href="${prefix}skod/reports.html" class="dashboard-action-btn" style="background: var(--p-soft); border: 1px solid var(--p-line); color: var(--p-ink); display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none;">📊 Звіти та аналітика</a>
        ${showManagerAction ? `<a href="${prefix}skod/tasks.html" class="dashboard-action-btn primary">📋 Надати доручення</a>` : ''}
      </div>
    </div>
  `;
}

async function init() {
  inject();
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user ?? null;
  await fetchRole();
  applyAccess();

  trackGlobalPresence();
  setupNewsRealtime();

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
            'zoz-questions', 'pmg-proposals', 'news', 'chat', 'pakety', 'postanova', 'algorithms', 'zoz-dogovr', 'skod'
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
      'zoz-questions', 'pmg-proposals', 'news', 'chat', 'pakety', 'postanova', 'algorithms', 'zoz-dogovr', 'skod'
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

document.addEventListener('DOMContentLoaded', init);
