import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY));

const MANAGER_ROLES = ['manager', 'deputy_director', 'director', 'admin'];
const MONTHS_UA = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень',
  'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const DOW_UA = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

let currentUser = null;
let userProfile = null;
let isManager = false;
let profilesList = [];        // для селектора співробітників (керівникам)
let selectedUserId = null;    // чий календар дивимось
let selectedUserName = '';

// На телефоні місячна сітка затісна — стартуємо з тижня
let view = (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches)
  ? 'week' : 'month';         // day | week | month | year
let anchorDate = new Date();  // точка відліку періоду

let events = [];              // planner_events за видимий період
let taskDeadlines = [];       // дедлайни доручень за видимий період
let plannerTableMissing = false;

// ── Утиліти дат ────────────────────────────────────────────────────
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromIso(s) { return new Date(s + 'T12:00:00'); }
function todayIso() { return iso(new Date()); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) {
  const x = new Date(d);
  const shift = (x.getDay() + 6) % 7; // понеділок = 0
  x.setDate(x.getDate() - shift);
  return x;
}
function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
function fmtTime(t) { return t ? t.slice(0, 5) : ''; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : null; }
function diffMinutes(a, b) {
  const p = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const d = p(b) - p(a);
  return d > 0 ? d : null;
}

// Межі видимого періоду (для запитів)
function periodRange() {
  const a = anchorDate;
  if (view === 'day') return [iso(a), iso(a)];
  if (view === 'week') {
    const s = startOfWeek(a);
    return [iso(s), iso(addDays(s, 6))];
  }
  if (view === 'month') {
    const s = new Date(a.getFullYear(), a.getMonth(), 1);
    const e = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return [iso(s), iso(e)];
  }
  return [`${a.getFullYear()}-01-01`, `${a.getFullYear()}-12-31`];
}

function periodLabel() {
  const a = anchorDate;
  if (view === 'day') {
    return a.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  if (view === 'week') {
    const s = startOfWeek(a), e = addDays(s, 6);
    return `${s.getDate()} ${MONTHS_UA[s.getMonth()]} – ${e.getDate()} ${MONTHS_UA[e.getMonth()]} ${e.getFullYear()}`;
  }
  if (view === 'month') return `${MONTHS_UA[a.getMonth()]} ${a.getFullYear()}`;
  return `${a.getFullYear()} рік`;
}

// ── Ініціалізація ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;
  if (!currentUser) return; // auth-v2.js покаже overlay через data-required-role

  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  userProfile = profile || { id: currentUser.id, role: 'expert', full_name: currentUser.email.split('@')[0] };
  isManager = MANAGER_ROLES.includes(userProfile.role);

  selectedUserId = currentUser.id;
  selectedUserName = userProfile.full_name || currentUser.email.split('@')[0];

  if (isManager) {
    const { data: profs } = await sb
      .from('profiles')
      .select('id, full_name, role')
      .neq('role', 'guest')
      .order('full_name');
    profilesList = profs || [];
    const wrap = document.getElementById('planner-emp-select-wrap');
    const sel = document.getElementById('planner-emp-select');
    if (wrap && sel && profilesList.length) {
      sel.innerHTML = profilesList.map(p =>
        `<option value="${p.id}" ${p.id === currentUser.id ? 'selected' : ''}>${esc(p.full_name || 'Співробітник')}</option>`
      ).join('');
      wrap.style.display = 'inline-flex';
      sel.addEventListener('change', () => {
        selectedUserId = sel.value;
        const p = profilesList.find(x => x.id === sel.value);
        selectedUserName = p?.full_name || '';
        refresh();
      });
    }
  }

  setupToolbar();
  setupModal();
  setupRealtime();
  refresh();
}

function setupToolbar() {
  // Синхронізуємо активну вкладку зі стартовим view (на телефоні — тиждень)
  document.querySelectorAll('.pv-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.pv-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      view = btn.dataset.view;
      document.querySelectorAll('.pv-btn').forEach(b => b.classList.toggle('active', b === btn));
      refresh();
    });
  });
  document.getElementById('planner-prev')?.addEventListener('click', () => { shiftPeriod(-1); });
  document.getElementById('planner-next')?.addEventListener('click', () => { shiftPeriod(1); });
  document.getElementById('planner-today')?.addEventListener('click', () => { anchorDate = new Date(); refresh(); });
  document.getElementById('planner-add-btn')?.addEventListener('click', () => openModal({ date: todayIso() }));
}

function shiftPeriod(dir) {
  const a = anchorDate;
  if (view === 'day') anchorDate = addDays(a, dir);
  else if (view === 'week') anchorDate = addDays(a, dir * 7);
  else if (view === 'month') anchorDate = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  else anchorDate = new Date(a.getFullYear() + dir, a.getMonth(), 1);
  refresh();
}

let realtimeChannel = null;
function setupRealtime() {
  realtimeChannel = sb.channel('realtime_planner')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'planner_events' }, () => refresh(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'assigned_tasks' }, () => refresh(true))
    .subscribe();
}

// ── Дані ───────────────────────────────────────────────────────────
async function refresh(silent) {
  const body = document.getElementById('planner-body');
  if (!body) return;
  if (!silent) body.innerHTML = '<div class="planner-loading">Завантаження планувальника…</div>';
  document.getElementById('planner-period-label').textContent = periodLabel();

  const [start, end] = periodRange();

  // Записи планувальника
  const { data: evData, error: evErr } = await sb
    .from('planner_events')
    .select('*')
    .eq('user_id', selectedUserId)
    .gte('event_date', start)
    .lte('event_date', end)
    .order('event_date')
    .order('start_time', { nullsFirst: false });

  if (evErr) {
    // Таблиці ще немає — міграцію не застосовано
    plannerTableMissing = /relation|not exist|schema cache/i.test(evErr.message || '');
    events = [];
  } else {
    plannerTableMissing = false;
    events = evData || [];
  }

  // Дедлайни доручень обраного співробітника в періоді (синхронізація)
  const { data: taskData } = await sb
    .from('assigned_tasks')
    .select('id, title, deadline, status, progress, created_by_name')
    .eq('responsible_id', selectedUserId)
    .not('deadline', 'is', null)
    .gte('deadline', start)
    .lte('deadline', end)
    .not('status', 'in', '("completed","rejected")');
  // Якщо доручення вже додане в планувальник окремою подією (task_id) —
  // не дублюємо його автоматичним чипом дедлайну
  const linkedTaskIds = new Set(events.filter(e => e.task_id).map(e => e.task_id));
  taskDeadlines = (taskData || []).filter(t => !linkedTaskIds.has(t.id));

  renderMonitor();
  renderBody();
}

// ── Моніторинг виконання ───────────────────────────────────────────
function renderMonitor() {
  const t = todayIso();
  const total = events.length;
  const done = events.filter(e => e.status === 'done').length;
  const cancelled = events.filter(e => e.status === 'cancelled').length;
  const overdue = events.filter(e => e.status === 'planned' && e.event_date < t).length;
  const denom = total - cancelled;
  const rate = denom > 0 ? Math.round((done / denom) * 100) + '%' : '–';

  document.getElementById('pm-total').textContent = total;
  document.getElementById('pm-done').textContent = done;
  document.getElementById('pm-overdue').textContent = overdue;
  document.getElementById('pm-rate').textContent = rate;
  document.getElementById('pm-deadlines').textContent = taskDeadlines.length;
}

// ── Рендер ─────────────────────────────────────────────────────────
function itemsForDate(dateStr) {
  const evs = events.filter(e => e.event_date === dateStr);
  const tasks = taskDeadlines.filter(t => t.deadline === dateStr);
  return { evs, tasks };
}

function renderBody() {
  const body = document.getElementById('planner-body');
  if (!body) return;

  let html = '';
  if (plannerTableMissing) {
    html += `<div class="planner-empty">⚠️ Таблиця планувальника ще не створена в Supabase.<br>
      Адміністратору: виконайте <code>migration_2026-07-19_planner_events.sql</code> у SQL Editor.<br>
      Дедлайни доручень нижче вже працюють.</div>`;
  }

  if (view === 'month') html += renderMonth();
  else if (view === 'week') html += renderList(startOfWeek(anchorDate), 7);
  else if (view === 'day') html += renderList(anchorDate, 1);
  else html += renderYear();

  body.innerHTML = html;
  attachBodyHandlers(body);
}

function chipHtml(e) {
  const t = todayIso();
  let cls = 'cal-chip';
  if (e.status === 'done') cls += ' chip-done';
  else if (e.status === 'cancelled') cls += ' chip-cancelled';
  else if (e.event_date < t) cls += ' chip-overdue';
  const time = e.start_time ? fmtTime(e.start_time) + ' ' : '';
  return `<span class="${cls}" title="${esc(e.title)}">${time}${esc(e.title)}</span>`;
}

function renderMonth() {
  const y = anchorDate.getFullYear(), m = anchorDate.getMonth();
  const first = new Date(y, m, 1);
  const gridStart = startOfWeek(first);
  const t = todayIso();

  let html = '<div class="cal-month-grid">';
  DOW_UA.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });

  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    if (i >= 35 && d.getMonth() !== m) break;
    const dStr = iso(d);
    const { evs, tasks } = itemsForDate(dStr);
    const classes = ['cal-day'];
    if (d.getMonth() !== m) classes.push('other-month');
    if (isWeekend(d)) classes.push('is-weekend');
    if (dStr === t) classes.push('is-today');

    const shown = evs.slice(0, 3);
    const extra = evs.length - shown.length;

    // Крапки для мобільного подання
    const dots = [
      ...tasks.map(() => '<span class="day-dot dot-task"></span>'),
      ...evs.map(e => `<span class="day-dot${e.status === 'planned' && dStr < t ? ' dot-overdue' : ''}"></span>`)
    ].slice(0, 6).join('');

    html += `<div class="${classes.join(' ')}" data-date="${dStr}">
      <span class="cal-day-num">${d.getDate()}</span>
      ${tasks.map(task => `<span class="cal-chip chip-task" title="Дедлайн доручення: ${esc(task.title)}">📌 ${esc(task.title)}</span>`).join('')}
      ${shown.map(chipHtml).join('')}
      ${extra > 0 ? `<span class="cal-chip-more">ще ${extra}…</span>` : ''}
      <span class="cal-day-dots">${dots}</span>
    </div>`;
  }
  html += '</div>';
  return html;
}

function eventRow(e) {
  const t = todayIso();
  const classes = ['cal-event'];
  if (e.status === 'done') classes.push('ev-done');
  else if (e.status === 'cancelled') classes.push('ev-cancelled');
  else if (e.event_date < t) classes.push('ev-overdue');

  const time = e.start_time
    ? `${fmtTime(e.start_time)}${e.end_time ? '–' + fmtTime(e.end_time) : ''}`
    : 'Увесь день';

  const creatorNote = (e.creator_id && e.creator_id !== e.user_id)
    ? `<div class="cal-event-meta">👤 Від керівника: ${esc(e.creator_name || '')}</div>` : '';

  let meetingLine = '';
  if (e.meeting_link) {
    const safe = safeUrl(e.meeting_link);
    meetingLine = safe
      ? `<div class="cal-event-meta"><a class="cal-meeting-link" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">🔗 Посилання на зустріч</a></div>`
      : `<div class="cal-event-meta">🔗 ${esc(e.meeting_link)}</div>`;
  }
  const badge37d = e.report_log_id
    ? `<div class="cal-event-meta"><span class="cal-37d-badge">📊 У звіті 37-Д</span></div>` : '';

  const canManage = currentUser && (e.user_id === currentUser.id || e.creator_id === currentUser.id || isManager);
  const actions = canManage ? `
    <div class="cal-event-actions">
      ${e.task_id ? `<button data-act="open-task" data-id="${e.task_id}" title="Відкрити доручення">↗</button>` : ''}
      ${e.status === 'planned' ? `<button data-act="done" data-id="${e.id}" title="Позначити виконаним">✔</button>` : ''}
      ${e.status !== 'planned' ? `<button data-act="reopen" data-id="${e.id}" title="Повернути в план">↩</button>` : ''}
      <button data-act="edit" data-id="${e.id}" title="Редагувати">✏️</button>
    </div>` : '';

  return `<div class="${classes.join(' ')}">
    <div class="cal-event-time">${time}</div>
    <div class="cal-event-main">
      <div class="cal-event-title">${esc(e.title)}</div>
      ${e.description ? `<div class="cal-event-desc">${esc(e.description)}</div>` : ''}
      ${meetingLine}
      ${badge37d}
      ${creatorNote}
    </div>
    ${actions}
  </div>`;
}

function taskRow(task) {
  return `<div class="cal-event ev-task">
    <div class="cal-event-time">📌 Дедлайн</div>
    <div class="cal-event-main">
      <div class="cal-event-title">${esc(task.title)}</div>
      <div class="cal-event-meta">Доручення${task.created_by_name ? ' від: ' + esc(task.created_by_name) : ''} · прогрес ${task.progress ?? 0}%</div>
    </div>
    <div class="cal-event-actions">
      <button data-act="open-task" data-id="${task.id}" title="Відкрити доручення">↗</button>
    </div>
  </div>`;
}

function renderList(startDate, days) {
  const t = todayIso();
  let html = '<div class="cal-list">';
  for (let i = 0; i < days; i++) {
    const d = addDays(startDate, i);
    const dStr = iso(d);
    const { evs, tasks } = itemsForDate(dStr);
    const classes = ['cal-list-day'];
    if (dStr === t) classes.push('is-today');
    if (isWeekend(d)) classes.push('is-weekend');

    const dayTitle = d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
    html += `<div class="${classes.join(' ')}">
      <div class="cal-list-day-head">
        <span class="cal-list-day-title">${dayTitle}${isWeekend(d) ? ' · 🛌 вихідний' : ''}</span>
        <button class="cal-list-day-add" data-add-date="${dStr}">＋ запис</button>
      </div>
      ${tasks.map(taskRow).join('')}
      ${evs.map(eventRow).join('')}
      ${(!evs.length && !tasks.length) ? '<div class="cal-event-meta" style="padding:4px 2px;">Немає записів.</div>' : ''}
    </div>`;
  }
  html += '</div>';
  return html;
}

function renderYear() {
  const y = anchorDate.getFullYear();
  const t = todayIso();
  const countByDate = {};
  events.forEach(e => { countByDate[e.event_date] = (countByDate[e.event_date] || 0) + 1; });
  taskDeadlines.forEach(task => { countByDate[task.deadline] = (countByDate[task.deadline] || 0) + 1; });

  let html = '<div class="cal-year-grid">';
  for (let m = 0; m < 12; m++) {
    const first = new Date(y, m, 1);
    const daysIn = new Date(y, m + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const monthCount = events.filter(e => fromIso(e.event_date).getMonth() === m).length
      + taskDeadlines.filter(task => fromIso(task.deadline).getMonth() === m).length;

    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="cal-mini-day other"></span>';
    for (let d = 1; d <= daysIn; d++) {
      const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const n = countByDate[dStr] || 0;
      const lvl = n === 0 ? '' : n === 1 ? ' has-1' : n === 2 ? ' has-2' : ' has-3';
      cells += `<span class="cal-mini-day${lvl}${dStr === t ? ' mini-today' : ''}">${d}</span>`;
    }

    html += `<div class="cal-mini-month" data-month="${m}">
      <div class="cal-mini-title"><span>${MONTHS_UA[m]}</span>${monthCount ? `<span class="cal-mini-count">${monthCount}</span>` : ''}</div>
      <div class="cal-mini-grid">${cells}</div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function attachBodyHandlers(body) {
  body.querySelectorAll('.cal-day').forEach(el => {
    el.addEventListener('click', () => {
      anchorDate = fromIso(el.dataset.date);
      view = 'day';
      document.querySelectorAll('.pv-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'day'));
      refresh();
    });
  });
  body.querySelectorAll('.cal-mini-month').forEach(el => {
    el.addEventListener('click', () => {
      anchorDate = new Date(anchorDate.getFullYear(), Number(el.dataset.month), 1);
      view = 'month';
      document.querySelectorAll('.pv-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'month'));
      refresh();
    });
  });
  body.querySelectorAll('[data-add-date]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal({ date: btn.dataset.addDate });
    });
  });
  body.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.dataset.act, id = btn.dataset.id;
      if (act === 'open-task') {
        window.location.href = '../skod/task-detail.html?id=' + id;
        return;
      }
      if (act === 'edit') {
        const ev = events.find(x => x.id === id);
        if (ev) openModal({ event: ev });
        return;
      }
      if (act === 'done' || act === 'reopen') {
        await sb.from('planner_events').update({
          status: act === 'done' ? 'done' : 'planned',
          done_at: act === 'done' ? new Date().toISOString() : null
        }).eq('id', id);
        refresh(true);
      }
    });
  });
}

// ── Модалка ────────────────────────────────────────────────────────
function setupModal() {
  const backdrop = document.getElementById('planner-modal-backdrop');
  document.getElementById('pf-cancel')?.addEventListener('click', closeModal);
  backdrop?.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

  document.getElementById('pf-37d')?.addEventListener('change', (e) => {
    const f = document.getElementById('pf-37d-fields');
    if (f) f.style.display = e.target.checked ? 'block' : 'none';
  });

  document.getElementById('planner-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (plannerTableMissing) {
      alert('Таблиця планувальника ще не створена. Зверніться до адміністратора порталу.');
      return;
    }
    const id = document.getElementById('pf-id').value;
    const editing = id ? events.find(x => x.id === id) : null;
    const status = document.getElementById('pf-status').value || 'planned';
    const payload = {
      title: document.getElementById('pf-title').value.trim(),
      description: document.getElementById('pf-desc').value.trim() || null,
      event_date: document.getElementById('pf-date').value,
      start_time: document.getElementById('pf-start').value || null,
      end_time: document.getElementById('pf-end').value || null,
      meeting_link: document.getElementById('pf-meeting').value.trim() || null,
      status,
      done_at: status === 'done' ? new Date().toISOString() : null
    };
    if (!payload.title || !payload.event_date) return;
    // Не переписувати час першого виконання, якщо подія вже була виконана
    if (status === 'done' && editing?.status === 'done' && editing?.done_at) {
      payload.done_at = editing.done_at;
    }

    let error, savedId = id;
    if (id) {
      ({ error } = await sb.from('planner_events').update(payload).eq('id', id));
    } else {
      const res = await sb.from('planner_events').insert({
        ...payload,
        user_id: selectedUserId,
        user_name: selectedUserName,
        creator_id: currentUser.id,
        creator_name: userProfile.full_name || ''
      }).select('id').single();
      error = res.error;
      savedId = res.data?.id;
    }
    if (error) {
      alert('Не вдалося зберегти запис: ' + error.message);
      return;
    }

    // Синхронізація зі звітом 37-Д — лише для власного календаря
    if (selectedUserId === currentUser.id && savedId) {
      try {
        await sync37d({
          want37d: document.getElementById('pf-37d').checked,
          existingLogId: editing?.report_log_id || null,
          eventId: savedId,
          payload,
          infoType: document.getElementById('pf-37d-type').value
        });
      } catch (err37) {
        alert('Запис збережено, але не вдалося оновити звіт 37-Д: ' + err37.message);
      }
    }

    closeModal();
    refresh(true);
  });

  document.getElementById('pf-delete')?.addEventListener('click', async () => {
    const id = document.getElementById('pf-id').value;
    if (!id) return;
    if (!confirm('Видалити цей запис плану?')) return;
    await sb.from('planner_events').delete().eq('id', id);
    closeModal();
    refresh(true);
  });
}

function openModal({ date, event } = {}) {
  const backdrop = document.getElementById('planner-modal-backdrop');
  if (!backdrop) return;

  document.getElementById('planner-modal-title').textContent = event ? 'Редагувати запис' : 'Новий запис плану';
  document.getElementById('pf-id').value = event?.id || '';
  document.getElementById('pf-title').value = event?.title || '';
  document.getElementById('pf-desc').value = event?.description || '';
  document.getElementById('pf-meeting').value = event?.meeting_link || '';
  document.getElementById('pf-date').value = event?.event_date || date || todayIso();
  document.getElementById('pf-start').value = event?.start_time ? fmtTime(event.start_time) : '';
  document.getElementById('pf-end').value = event?.end_time ? fmtTime(event.end_time) : '';
  document.getElementById('pf-status').value = event?.status || 'planned';
  document.getElementById('pf-delete').style.display = event ? 'inline-block' : 'none';

  // Блок 37-Д: доступний лише для власного календаря
  const ownCalendar = selectedUserId === currentUser.id;
  const linked = !!event?.report_log_id;
  document.getElementById('pf-37d-wrap').style.display = ownCalendar ? 'block' : 'none';
  document.getElementById('pf-37d').checked = linked;
  document.getElementById('pf-37d-fields').style.display = linked ? 'block' : 'none';
  document.getElementById('pf-37d-linked').style.display = linked ? 'block' : 'none';

  const note = document.getElementById('pf-assignee-note');
  if (selectedUserId !== currentUser.id) {
    note.textContent = `Запис буде створено в плані: ${selectedUserName}. Співробітник побачить, що його додали ви.`;
    note.style.display = 'block';
  } else {
    note.style.display = 'none';
  }

  backdrop.style.display = 'grid';
  setTimeout(() => document.getElementById('pf-title')?.focus(), 50);
}

function closeModal() {
  const backdrop = document.getElementById('planner-modal-backdrop');
  if (backdrop) backdrop.style.display = 'none';
}

// ── Синхронізація події зі звітом Форми 37-Д ────────────────────────
function map37dStatus(status) {
  if (status === 'done') return 'виконано';
  if (status === 'cancelled') return 'скасовано / неактуально';
  return 'заплановано';
}

async function sync37d({ want37d, existingLogId, eventId, payload, infoType }) {
  // Галочку знято — прибрати подію зі звіту (позначаємо як скасовану)
  if (!want37d) {
    if (existingLogId) {
      await sb.from('skod_logs').update({ status_37d: 'скасовано / неактуально' }).eq('id', existingLogId);
      await sb.from('planner_events').update({ report_log_id: null }).eq('id', eventId);
    }
    return;
  }

  const state = payload.description
    || (payload.status === 'done' ? `Проведено: ${payload.title}` : `Заплановано: ${payload.title}`);
  const dur = (payload.start_time && payload.end_time)
    ? diffMinutes(payload.start_time, payload.end_time) : null;

  const fields37d = {
    process_name: payload.title,
    current_state_text: state,
    status_37d: map37dStatus(payload.status),
    info_type_37d: infoType || null,
    event_date: payload.event_date,
    document_link: payload.meeting_link || null,
    include_37d: true,
    status: payload.status === 'done' ? 'completed' : 'in_progress'
  };

  if (existingLogId) {
    // Оновити вже пов'язаний запис СКО-Д
    const { error } = await sb.from('skod_logs').update(fields37d).eq('id', existingLogId);
    if (error) throw error;
    return;
  }

  // Створити новий запис СКО-Д і прив'язати до події
  const dept = userProfile.Section || userProfile.department || 'Департамент стратегії НСЗУ';
  const { data, error } = await sb.from('skod_logs').insert({
    user_id: currentUser.id,
    user_name: userProfile.full_name || selectedUserName,
    department: dept,
    log_date: todayIso(),
    start_time: payload.start_time || '09:00:00',
    duration_minutes: dur,
    branch: 'department',
    task_type: 'Комунікаційний захід / зустріч',
    severity_level: 'medium',
    complexity_coefficient: 1.3,
    score: dur ? +((dur / 60) * 1.3).toFixed(2) : 0,
    description: state,
    ...fields37d
  }).select('id').single();
  if (error) throw error;
  await sb.from('planner_events').update({ report_log_id: data.id }).eq('id', eventId);
}
