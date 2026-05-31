import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

let user = null;
let role = null; // null = guest | 'registered' | 'full'

function hasAccess(required) {
  if (!required) return true;
  if (required === 'registered') return role === 'registered' || role === 'full';
  if (required === 'full') return role === 'full';
  return false;
}

async function fetchRole() {
  if (!user) { role = null; return; }
  const { data } = await sb.from('profiles').select('role').eq('id', user.id).single();
  role = data?.role ?? 'registered';
}

function applyAccess() {
  const btn = document.getElementById('auth-nav-btn');
  if (btn) {
    if (user) {
      btn.textContent = user.email.split('@')[0];
      btn.classList.add('is-signed-in');
      btn.title = 'Натисніть для виходу';
    } else {
      btn.textContent = 'Увійти';
      btn.classList.remove('is-signed-in');
      btn.title = '';
    }
  }

  // Show/hide role-gated elements
  document.querySelectorAll('[data-role]').forEach(el => {
    el.style.display = hasAccess(el.dataset.role) ? '' : 'none';
  });

  // Page-level guard
  const required = document.body.dataset.requiredRole;
  if (required && !hasAccess(required)) {
    const overlay = document.getElementById('access-denied-overlay');
    if (overlay) {
      const msg = document.getElementById('access-denied-msg');
      if (msg) {
        msg.textContent = required === 'full'
          ? 'Ця сторінка доступна лише для користувачів з повним доступом.'
          : 'Ця сторінка доступна лише для зареєстрованих користувачів.';
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
      full_name:    document.getElementById('reg-name').value,
      organization: document.getElementById('reg-org').value,
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
  // Auth button inside nav
  const nav = document.querySelector('nav.section-switch');
  if (nav) {
    const btn = document.createElement('button');
    btn.id = 'auth-nav-btn';
    btn.className = 'auth-nav-btn';
    btn.textContent = 'Увійти';
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-signed-in')) sb.auth.signOut();
      else openModal();
    });
    nav.appendChild(btn);
  }

  // Modal + access denied
  document.body.insertAdjacentHTML('beforeend', `
<div id="auth-overlay" class="auth-overlay" style="display:none" role="dialog" aria-modal="true" aria-label="Вхід">
  <div class="auth-modal">
    <button class="auth-modal-close" id="auth-close" aria-label="Закрити">&times;</button>
    <div class="auth-brand">НавиПМГ26</div>
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
        <label for="reg-name">Ім'я та прізвище</label>
        <input id="reg-name" type="text" autocomplete="name">
      </div>
      <div class="auth-field">
        <label for="reg-org">Заклад / організація</label>
        <input id="reg-org" type="text">
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
