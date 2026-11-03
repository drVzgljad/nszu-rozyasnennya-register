/**
 * «📣 Запросити в голос» і «Загальний збір» — один діалог на два розділи:
 * «Чат департаменту» (zviazok.js) і кімнату відділу в «Справах» (spravy/voice.js).
 * Змінюєте поведінку запрошень — тут, а не в копіях.
 *
 * Запрошення йде двома шляхами:
 *   1) у чат — рядок chat_pings (note 'voice|<куди>'); його показує відкритий
 *      «Чат департаменту»;
 *   2) поза порталом — Web Push через воркер (push.js → POST /push/send) тим, хто
 *      увімкнув сповіщення. Посилання в сповіщенні воркер будує сам із pushKey.
 * Поруч — «поділитися» посиланням у WhatsApp, Teams, системне меню телефона.
 *
 * Діалог сам підтягує свій CSS (invite.css), список співробітників (profiles)
 * і «хто в мережі» (window.__pmgPresence з auth-v2.js) — сторінці нічого
 * додатково підключати не треба.
 */

import { sendPushInvite } from './push.js?v=20261103b';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export const GATHER = '📢 Загальний збір';
export const GATHER_TEXT = `${GATHER} у голосі — приєднуйтесь! 🎙`;

/** Відділ у кімнаті (chat_rooms.dept) і в профілі (Section) записано не завжди однаково
 *  («стратегічного розвитку ПМГ» / «…програми медичних гарантій») — звіряємо за двома словами. */
export const sameDept = (a, b) => !!a && !!b && norm(a).split(' ').slice(0, 2).join(' ') === norm(b).split(' ').slice(0, 2).join(' ');

let cssDone = false;
function css() {
  if (cssDone) return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./invite.css?v=20261103a', import.meta.url).href;
  document.head.append(l);
}

let peopleCache = null;
async function loadPeople(sb) {
  if (peopleCache) return peopleCache;
  const { data } = await sb.from('profiles').select('id, full_name, Section').neq('role', 'guest');
  peopleCache = (data || []).filter((p) => p.full_name).sort((a, b) => a.full_name.localeCompare(b.full_name, 'uk'));
  return peopleCache;
}

function onlineSet() {
  const s = new Set();
  Object.values(window.__pmgPresence || {}).forEach((arr) => { if (arr?.[0]?.user_id) s.add(arr[0].user_id); });
  return s;
}

/**
 * Відкрити діалог.
 * opts:
 *   sb, me ({ id }), name        — хто кличе;
 *   title                         — назва кімнати для людей («Наукова та клінічна експертиза»);
 *   scope: { kind: 'dept', dept } | { kind: 'all' } | { kind: 'members', uids }
 *                                 — кого кличе «Загальний збір» і з кого вибирати;
 *   here                          — Set id тих, хто вже в голосі (їх не пропонуємо);
 *   url                           — посилання для «поділитися»;
 *   pushKey                       — куди веде сповіщення (див. worker.js: main · room:<id> · dm:<id> · spravy:dept · spravy:all);
 *   pingKey, roomId               — для chat_pings (що відкриє «Чат департаменту»);
 *   onJoin()                      — зайти в голос самому (перед тим, як кликати);
 *   onGather()                    — написати в розмову оголошення збору;
 *   toast(text, bad)              — підказки сторінки;
 *   people, online                — необов'язково: якщо сторінка вже має ці списки;
 *   demo                          — нічого не надсилати.
 */
export async function openInvite(o) {
  css();
  const people = o.people || (o.demo ? [] : await loadPeople(o.sb));
  const online = o.online || onlineSet();
  const here = o.here || new Set();
  const others = people.filter((p) => p.id !== o.me.id);

  let gUids;
  let gLabel;
  let gBody;
  if (o.scope.kind === 'members') {
    gUids = o.scope.uids.filter((u) => u !== o.me.id);
    gLabel = `усіх учасників кімнати (${gUids.length})`;
    gBody = { uids: gUids };
  } else if (o.scope.kind === 'dept') {
    gUids = others.filter((p) => sameDept(p.Section, o.scope.dept)).map((p) => p.id);
    gLabel = `увесь відділ (${gUids.length})`;
    gBody = { uids: gUids };
  } else {
    gUids = others.map((p) => p.id);
    gLabel = `увесь департамент (${gUids.length})`;
    gBody = { all: true };
  }
  // У закриту кімнату кличемо лише її учасників — інші її не побачать
  const pool = o.scope.kind === 'members' ? others.filter((p) => o.scope.uids.includes(p.id)) : others;
  const list = pool.filter((p) => !here.has(p.id))
    .sort((a, b) => (online.has(b.id) - online.has(a.id)) || a.full_name.localeCompare(b.full_name, 'uk'));
  const text = `Зайди в голос: «${o.title}» — ${o.url}`;

  let dlg = document.getElementById('zvInviteDlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'zvInviteDlg';
    dlg.className = 'zv-inv';
    document.body.append(dlg);
  }
  dlg.innerHTML = `
    <form method="dialog">
      <h2>📣 Запросити в голос</h2>
      <p class="zv-inv-lead">«${esc(o.title)}». Запрошення прийде в чат і сповіщенням на телефон чи комп'ютер тим, хто їх увімкнув у «Чаті департаменту». Ви одразу зайдете в голос.</p>
      <button type="button" class="zv-inv-gather" data-act="gather">
        <span aria-hidden="true">📢</span>
        <span><b>Загальний збір</b><small>Покликати ${esc(gLabel)}. У розмові з'явиться оголошення.</small></span>
      </button>
      <div class="zv-inv-field"><span>Або вибрати колег</span>
        <input type="search" class="zv-inv-q" placeholder="Знайти колегу…" aria-label="Пошук колеги">
        <div class="zv-inv-people">${list.map((p) => `
          <label data-n="${esc(p.full_name.toLowerCase())}">
            <input type="checkbox" name="m" value="${p.id}">
            <span class="zv-inv-ava" aria-hidden="true">${esc(initials(p.full_name))}</span>
            <span class="zv-inv-name">${esc(p.full_name)}</span>
            ${online.has(p.id) ? '<span class="zv-inv-on" title="у мережі"></span>' : ''}
          </label>`).join('') || '<p class="zv-inv-muted">Усі вже тут.</p>'}</div></div>
      <div class="zv-inv-share">
        <span>Або надіслати посилання самому:</span>
        <a class="zv-inv-btn" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="zv-inv-btn" href="https://teams.microsoft.com/share?href=${encodeURIComponent(o.url)}&amp;msgText=${encodeURIComponent(`Зайди в голос: «${o.title}»`)}" target="_blank" rel="noopener">Teams</a>
        ${navigator.share ? '<button type="button" class="zv-inv-btn" data-act="share">📱 Інше…</button>' : ''}
        <button type="button" class="zv-inv-btn" data-act="copy">Копіювати</button>
      </div>
      <div class="zv-inv-actions">
        <button type="button" class="zv-inv-btn" data-act="close">Скасувати</button>
        <button type="submit" class="zv-inv-btn zv-inv-primary">Покликати вибраних</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  form.querySelector('.zv-inv-q').addEventListener('input', (e) => {
    const s = e.target.value.trim().toLowerCase();
    form.querySelectorAll('.zv-inv-people label').forEach((l) => { l.hidden = s && !l.dataset.n.includes(s); });
  });

  /** Надіслати: у чат (chat_pings) і поза ним (Web Push). */
  const send = async (uids, body, kind) => {
    if (o.demo) return { people: uids.length, pushed: null };
    if (uids.length) {
      const rows = uids.map((uid) => ({
        sender_id: o.me.id, sender_name: o.name, recipient_id: uid,
        room_id: o.roomId || null, room_name: o.title, note: 'voice|' + o.pingKey
      }));
      const { error } = await o.sb.from('chat_pings').insert(rows);
      if (error) throw error;
    }
    const pushed = await sendPushInvite(o.sb, { ...body, kind, room: o.title, key: o.pushKey });
    return { people: uids.length, pushed };
  };
  const done = (res, what) => {
    const p = res.pushed;
    o.toast(`${what}: ${res.people}. ${p ? `Сповіщення на пристрій отримали ${p.people}.` : o.demo ? '' : 'Поза порталом сповіщення поки не пішли — лише в чаті.'}`);
  };

  form.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const a = btn?.dataset.act;
    if (a === 'close') return dlg.close();
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(text); o.toast('Посилання скопійовано.'); } catch (_) { prompt('Скопіюйте посилання:', o.url); }
    }
    if (a === 'share') navigator.share({ title: 'Зайди в голос', text: `Зайди в голос: «${o.title}»`, url: o.url }).catch(() => {});
    if (a === 'gather') {
      if (!confirm(`Оголосити загальний збір у «${o.title}»? Покличемо ${gLabel}.`)) return;
      btn.disabled = true;
      try {
        await o.onGather?.();
        await o.onJoin?.();
        const res = await send(gUids, gBody, 'gather');
        dlg.close();
        done(res, 'Збір оголошено, покликано');
      } catch (err) {
        o.toast('Не вдалося: ' + (err.message || err), true);
        btn.disabled = false;
      }
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uids = [...form.querySelectorAll('[name=m]:checked')].map((x) => x.value);
    if (!uids.length) return o.toast('Позначте, кого покликати, або натисніть «Загальний збір».');
    try {
      await o.onJoin?.();
      const res = await send(uids, { uids }, 'invite');
      dlg.close();
      done(res, 'Покликано');
    } catch (err) {
      o.toast('Не надіслано: ' + (err.message || err), true);
    }
  });
  dlg.showModal();
}
