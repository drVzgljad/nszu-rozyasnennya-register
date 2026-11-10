/**
 * Голосова кімната відділу в особистому кабінеті (10.11.2026, на вимогу користувача:
 * «щоб голосовий чат був активний у двох вікнах — особистий кабінет і Справи відділу»).
 *
 * Панель і логіка — ті самі, що в «Справах» (../spravy/voice.js): кімната відділу з профілю,
 * мікрофон за замовчуванням вимкнений. Голос тримає лише одна вкладка браузера; в іншій видно,
 * хто в кімнаті, і кнопку «Перенести голос сюди». Стилі — ../spravy/spravy.css (лише sp-/spv- класи).
 */
import { initVoice } from '../spravy/voice.js?v=20261110a';

// Ті самі відділи, що в spravy.js (DEPARTMENTS): кімната = хеш назви відділу
const DEPARTMENTS = [
  'стратегічного розвитку програми медичних гарантій',
  'наукова та клінічна експертиза',
  'розвиток програми реімбурсації',
  'взаємодія з надавачами медичних послуг',
  'розрахунок вартості медичних послуг',
  'робота з електронними медичними даними'
];

function toast(text, bad) {
  let t = document.getElementById('spToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'spToast';
    t.className = 'sp-toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.toggle('is-bad', !!bad);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}

async function start() {
  // auth-v2.js / cabinet.js створюють клієнт Supabase; чекаємо його
  for (let i = 0; i < 40 && !window.__pmgSb; i++) await new Promise((r) => setTimeout(r, 150));
  const sb = window.__pmgSb;
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  const me = session?.user;
  if (!me) return;
  const { data: p } = await sb.from('profiles').select('*').eq('id', me.id).single();
  if (!p || p.role === 'guest') return;
  const dept = DEPARTMENTS.includes(p.Section) ? p.Section : '';
  initVoice({ sb, me, name: p.full_name || me.email, dept, toast });
}

start();
