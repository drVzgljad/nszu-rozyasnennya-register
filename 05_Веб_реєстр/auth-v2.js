import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let user = null;
let role = null; // null = guest | 'registered' | 'full'
let isHead = false;

function hasAccess(required) {
  if (!required) return true;
  if (required === 'registered') return role === 'registered' || role === 'full';
  if (required === 'full') return role === 'full';
  if (required === 'manager') return role === 'full' || isHead === true;
  return false;
}

async function fetchRole() {
  if (!user) { role = null; isHead = false; return; }
  const { data } = await sb.from('profiles').select('role, is_head').eq('id', user.id).single();
  role = data?.role ?? 'registered';
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
    const hasChatAccess = hasAccess('full');
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
              msg.textContent = 'Робочий чат доступний лише для користувачів з повним доступом.';
            }
            overlay.style.display = 'flex';
          } else {
            alert('Робочий чат доступний лише для користувачів з повним доступом.');
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
    const hasSkodAccess = hasAccess('registered');
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
      if (role === 'full') {
        badge.textContent = 'Повний доступ';
        badge.classList.add('role-full');
        badge.style.background = '#e9f7f3';
        badge.style.color = '#08705e';
        badge.style.border = '1px solid rgba(84, 173, 132, 0.25)';
      } else {
        badge.textContent = 'Базовий доступ';
        badge.classList.add('role-registered');
        badge.style.background = '#eef6fc';
        badge.style.color = '#2f6b9e';
        badge.style.border = '1px solid rgba(74, 143, 199, 0.2)';
      }
    } else {
      badge.textContent = 'Гість';
      badge.classList.add('role-guest');
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
      { text: 'Машина пошуку', path: 'pakety/report.html', role: 'registered' },
      { text: 'Питання ЗОЗ', path: 'zoz-questions/index.html', role: 'registered' },
      { text: 'Пропозиції ПМГ', path: 'pmg-proposals/index.html', role: 'registered' },
      { text: 'СКО-Д (Внесення)', path: 'skod/index.html', role: 'registered' },
      { text: 'СКО-Д (Звіти)', path: 'skod/reports.html', role: 'registered' },
      { text: 'СКО-Д (Доручення)', path: 'skod/tasks.html', role: 'manager' },
      { text: 'Новини', path: 'news/index.html', role: 'full' }
    ];

    // 1. Core navigation tabs
    coreItems.forEach(item => {
      const a = document.createElement('a');
      a.href = prefix + item.path;
      
      if (item.isChat) {
        a.className = 'nav-chat-btn';
        const hasChatAccess = hasAccess('full');
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
                  msg.textContent = 'Робочий чат доступний лише для користувачів з повним доступом.';
                }
                overlay.style.display = 'flex';
              } else {
                alert('Робочий чат доступний лише для користувачів з повним доступом.');
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
        if (required === 'full') {
          msg.textContent = 'Ця сторінка доступна лише для користувачів з повним доступом.';
        } else if (required === 'manager') {
          msg.textContent = 'Ця сторінка доступна лише для керівництва (Директор, Заступники, Начальники відділів та Адміністратор).';
        } else {
          msg.textContent = 'Ця сторінка доступна лише для зареєстрованих користувачів.';
        }
      }
      overlay.style.display = 'flex';
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
      organization: 'Департамент стратегії НСЗУ'
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
        <label for="reg-dept">Відділ *</label>
        <select id="reg-dept" required>
          <option value="Аналітика">Аналітика</option>
          <option value="Фінансисти">Фінансисти</option>
          <option value="Стратеги">Стратеги</option>
          <option value="Клінічна експертиза">Клінічна експертиза</option>
          <option value="Реімбурсація">Реімбурсація</option>
          <option value="Спілкування з надавачами">Спілкування з надавачами</option>
        </select>
      </div>
      <div class="auth-field">
        <label for="reg-position">Посада *</label>
        <select id="reg-position" required>
          <option value="Співробітник">Співробітник</option>
          <option value="Начальник відділу">Начальник відділу</option>
          <option value="Заступник директора">Заступник директора</option>
          <option value="Директор">Директор</option>
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
        regDept.value = 'Стратеги';
      } else if (name === 'волошина альбіна' || name === 'альбіна волошина' || name === 'волошина альбіна сергіївна') {
        regPos.value = 'Заступник директора';
        regDept.value = 'Стратеги';
      }
    });

    regPos.addEventListener('change', () => {
      if (regPos.value === 'Директор' || regPos.value === 'Заступник директора') {
        regDept.value = 'Стратеги';
      }
    });
  }
}

async function init() {
  inject();
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user ?? null;
  await fetchRole();
  applyAccess();

  sb.auth.onAuthStateChange(async (_event, session) => {
    user = session?.user ?? null;
    await fetchRole();
    applyAccess();
  });
}

document.addEventListener('DOMContentLoaded', init);
