// Дні народження співробітників.
// Дані живуть у Supabase (таблиця staff_birthdays, читання лише для авторизованих) —
// у репозиторії їх свідомо немає, бо він публічний і роздається сайтом без авторизації.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY));

const UPCOMING_DAYS = 14;

let cache = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Написання, щодо яких немає єдиної версії у структурі, табелі та профілі
const NAME_ALIASES = { 'ковалева олена': 'ковальова олена' };

// Ключ, нечутливий до порядку слів і по батькові: у структурі пишуть
// «Ім'я Прізвище», у профілях трапляється «Прізвище Ім'я».
function nameKey(name) {
  const key = String(name || '')
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .sort()
    .join(' ');
  return NAME_ALIASES[key] || key;
}

async function load() {
  if (cache) return cache;
  // Порожній результат навмисно не кешуємо: інакше після входу в акаунт
  // смужка лишилася б порожньою до перезавантаження сторінки.
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return [];

  // Друга лінія оборони поверх RLS: гість (роль 'guest') не бачить дат
  // навіть якщо політику в базі колись послаблять. Дні народження —
  // персональні дані, показуємо їх лише співробітникам департаменту.
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();
  if (!profile || !profile.role || profile.role === 'guest') return [];

  const { data, error } = await sb
    .from('staff_birthdays')
    .select('full_name, birth_day, birth_month')
    .eq('active', true);

  if (error) {
    console.warn('Дні народження недоступні:', error.message);
    return [];
  }
  if (!data || !data.length) return [];
  return (cache = data);
}

// Скільки днів лишилося до найближчого святкування (0 — сьогодні)
function daysUntil(entry, today) {
  const year = today.getFullYear();
  for (const y of [year, year + 1]) {
    const date = new Date(y, entry.birth_month - 1, entry.birth_day);
    const diff = Math.round((date - today) / 86400000);
    if (diff >= 0) return diff;
  }
  return Infinity;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function dayLabel(days) {
  if (days === 0) return 'сьогодні';
  if (days === 1) return 'завтра';
  if (days === 2) return 'післязавтра';
  return `через ${days} ${plural(days, 'день', 'дні', 'днів')}`;
}

// Винесено окремо, щоб логіку дат можна було перевірити без бази
export function birthdayBuckets(list, today) {
  const withDays = (list || [])
    .map(entry => ({ ...entry, days: daysUntil(entry, today) }))
    .sort((a, b) => a.days - b.days);

  return {
    celebrating: withDays.filter(e => e.days === 0),
    upcoming: withDays.filter(e => e.days > 0 && e.days <= UPCOMING_DAYS).slice(0, 4)
  };
}

/** Висота смужки з минулого візиту: auth-v2.js тримає під неї місце ще до
 *  першого малювання, інакше смужка виїжджає згори і зсуває всю сторінку.
 *  Зберігаємо саму лише висоту в пікселях — жодних імен у сховищі. */
function rememberHeight(container) {
  try {
    localStorage.setItem('portal-boot-bday-h',
      String(container.hidden ? 0 : Math.round(container.offsetHeight)));
  } catch (e) { /* приватний режим — просто без резерву місця */ }
}

export async function renderBirthdayStrip(container) {
  if (!container) return;
  const list = await load();
  if (!list.length) { container.hidden = true; container.style.minHeight = ''; rememberHeight(container); return; }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { celebrating, upcoming } = birthdayBuckets(list, today);

  if (!celebrating.length && !upcoming.length) {
    container.hidden = true;
    container.style.minHeight = '';
    rememberHeight(container);
    return;
  }

  container.hidden = false;
  container.className = celebrating.length ? 'bday-strip is-today' : 'bday-strip';

  const names = celebrating.map(e => escapeHtml(e.full_name)).join(', ');
  const head = celebrating.length
    ? `<span class="bday-cake" aria-hidden="true">🎂</span>
       <span class="bday-main"><strong>${names}</strong> ${celebrating.length > 1 ? 'святкують' : 'святкує'} день народження сьогодні. Не забудьте привітати!</span>`
    : `<span class="bday-cake" aria-hidden="true">📅</span>
       <span class="bday-main">Найближчі дні народження</span>`;

  const rest = upcoming.length
    ? `<span class="bday-upcoming">${upcoming
        .map(e => `<span class="bday-chip"><b>${escapeHtml(e.full_name)}</b> — ${dayLabel(e.days)}</span>`)
        .join('')}</span>`
    : '';

  container.innerHTML = `<div class="bday-inner">${head}${rest}</div>`;
  // Зарезервоване місце віддаємо назад: далі висоту тримає сам зміст
  container.style.minHeight = '';
  rememberHeight(container);
}

// Тортик на картці людини у структурі департаменту
export async function markPeopleCards(root = document) {
  const list = await load();
  if (!list.length) return;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const celebrating = new Set(
    list.filter(e => daysUntil(e, today) === 0).map(e => nameKey(e.full_name))
  );
  if (!celebrating.size) return;

  root.querySelectorAll('.person-card').forEach(card => {
    const isBirthday = celebrating.has(nameKey(card.dataset.personName));
    card.classList.toggle('is-birthday', isBirthday);
    if (isBirthday && !card.querySelector('.person-bday')) {
      const mark = document.createElement('span');
      mark.className = 'person-bday';
      mark.title = 'Сьогодні день народження';
      mark.textContent = '🎂';
      card.appendChild(mark);
    }
  });
}

export default { renderBirthdayStrip, markPeopleCards };
