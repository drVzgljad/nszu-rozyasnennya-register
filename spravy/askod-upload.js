/**
 * «📥 Журнал АСКОД» у «Справах відділу»: співробітник сам завантажує свою
 * xlsx-вигрузку резолюцій, бачить, що заведеться, оновиться і зникне, і
 * підтверджує. Пише в dept_cases під RLS від свого імені.
 *
 * Розбір і правила — спільний модуль ../pmg-askod-journal.js (порт
 * tools/spravy_sync.py один в один); тут лише діалог і запис. Контрольну
 * таблицю «на підпис» (версія, етап «На підписі», вих. №) сторінка не читає:
 * вона лежить в обміннику власника, її й далі бере щоденний скрипт. Тому
 * етап справи завантаження журналу не змінює взагалі — лише реквізити,
 * строк, резолюцію і «Стан АСКОД».
 *
 * Облік застосованих журналів — dept_journal_uploads
 * (migration_2026-11-03h_askod_journal_uploads.sql): за ним сторінка не дає
 * завантажити журнал, старіший за вже застосований, а скрипт не бере такий
 * файл з обмінника. Без міграції кнопка працює, тільки без обліку.
 */
const A = window.PMG_ASKOD;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '—');
const fmtStamp = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const MISSING = /relation .* does not exist|could not find the table|PGRST205|42P01/i;
const COLS = 'id,in_no,stage,version,source,askod_state,our_role,executor_name,in_date,correspondent,corr_out_no,corr_out_date,deadline,resolution,subject';

let ctx = null;      // { sb, me, name, dept(), toast, reload, demo, cases() }
let pending = null;  // розібраний журнал і план, що чекають підтвердження

export function initAskodUpload(o) {
  ctx = o;
  const btn = $('spJournal');
  if (!btn || !A) return;
  btn.hidden = false;
  const input = $('spJournalFile');
  btn.addEventListener('click', () => { input.value = ''; input.click(); });
  input.addEventListener('change', () => input.files[0] && open(input.files[0]));
  $('spJournalCancel').addEventListener('click', () => $('spJournalDlg').close());
  $('spJournalForm').addEventListener('submit', (e) => { e.preventDefault(); apply(); });
}

/** Свої справи на дошці: «Прізвище Ім'я» з журналу проти «Ім'я Прізвище» з профілю. */
const isMe = (ownerWords) => A.owns(ctx.name, [ownerWords]);

async function loadContext(dept, owner) {
  if (ctx.demo) {
    const existing = ctx.cases().filter((c) => c.in_no).map((c) => ({ in_date: null, correspondent: null, corr_out_no: null, corr_out_date: null, ...c }));
    return { existing, people: ctx.people(), last: null };
  }
  const [cases, people, ups] = await Promise.all([
    ctx.sb.from('dept_cases').select(COLS).eq('department', dept).not('in_no', 'is', null),
    // Як person() у spravy_sync.py: усі профілі відділу, без сортування
    ctx.sb.from('profiles').select('id, full_name').eq('Section', dept),
    ctx.sb.from('dept_journal_uploads').select('journal_at, created_at, uploaded_by_name, source')
      .eq('department', dept).eq('owner_name', owner).not('journal_at', 'is', null)
      .order('journal_at', { ascending: false }).limit(1)
  ]);
  if (cases.error) throw new Error(cases.error.message);
  return { existing: cases.data || [], people: people.data || [], last: ups.error ? null : (ups.data || [])[0] || null, noLog: !!ups.error && MISSING.test(ups.error.message || ups.error.code || '') };
}

async function open(file) {
  const dlg = $('spJournalDlg');
  const body = $('spJournalBody');
  const ok = $('spJournalOk');
  pending = null;
  body.innerHTML = '<p class="sp-muted">Читаю журнал…</p>';
  ok.disabled = true;
  ok.textContent = 'Застосувати';
  if (!dlg.open) dlg.showModal();
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Потрібен файл .xlsx — вигрузка журналу резолюцій з АСКОД');
    const j = await A.readJournal(await file.arrayBuffer(), file.name);
    const dept = ctx.dept();
    const { existing, people, last, noLog } = await loadContext(dept, j.owner);
    const cases = A.pick(j.docs, A.DAYS, false, todayISO());
    const by = `${ctx.name} (журнал АСКОД)`;
    const ops = A.plan({ dept, by, cases, existing, people, journalNos: new Set(j.docs.keys()),
      owners: j.ownerWords.length ? [j.ownerWords] : [], docs: j.docs, skipNoop: true });
    const stale = last && j.created && new Date(j.created) < new Date(last.journal_at);
    pending = { file, j, dept, ops, cases, by, existing, stale, noLog };
    body.innerHTML = summaryHTML(pending, last);
    ok.disabled = !!stale || j.owner === '?';
    ok.textContent = ops.length ? `Застосувати (${ops.length})` : 'Позначити як застосований';
  } catch (e) {
    body.innerHTML = `<p class="sp-jr-warn is-bad">${esc(e.message || e)}</p>`;
  }
}

function summaryHTML(p, last) {
  const { j, ops, cases, existing } = p;
  const by = (op) => ops.filter((o) => o.op === op);
  const ins = by('insert');
  const upd = by('update');
  const gone = by('gone');
  const back = by('back');
  const cur = new Map(existing.map((c) => [c.in_no, c]));
  const caseOf = new Map(cases.map((c) => [c.in_no, c]));
  const onBoard = cases.length - ins.length;

  const warn = [];
  if (j.owner === '?') warn.push(['is-bad', 'У журналі немає колонки «Виконавець» зі значеннями — чий він, незрозуміло.']);
  else if (!isMe(j.ownerWords)) warn.push(['', `Журнал не ваш: власник — <b>${esc(j.owner)}</b>. «Зниклими» стануть справи саме цієї людини.`]);
  if (p.stale) warn.push(['is-bad', `Цей журнал сформовано ${fmtStamp(j.created)}, а вже застосовано свіжіший — від ${fmtStamp(last.journal_at)}. Вивантажте журнал з АСКОД заново.`]);
  else if (j.created && (Date.now() - new Date(j.created)) / 864e5 > 2) warn.push(['', `Журнал сформовано ${fmtStamp(j.created)} — йому вже кілька днів. Свіжий дасть точніші строки і стан.`]);

  const row = (no, extra) => {
    const c = caseOf.get(no) || cur.get(no) || {};
    return `<li><b>${esc(no)}</b> <span class="sp-muted">строк ${fmtDate(c.deadline)}</span>${extra ? ` <span class="sp-jr-chg">${extra}</span>` : ''}<br><span class="sp-jr-subj">${esc((c.subject || '').slice(0, 140))}</span></li>`;
  };
  const what = (o) => {
    const c = cur.get(o.in_no) || {};
    const bits = [];
    if (o.patch.deadline && o.patch.deadline !== (c.deadline || '').slice(0, 10)) bits.push(`строк ${fmtDate(c.deadline)} → ${fmtDate(o.patch.deadline)}`);
    if (o.patch.askod_state !== c.askod_state) bits.push(`стан: ${esc(o.patch.askod_state || '—')}`);
    if (o.patch.resolution !== c.resolution) bits.push('резолюція');
    if (o.patch.our_role) bits.push('наша роль');
    if (['in_date', 'correspondent', 'corr_out_no', 'corr_out_date'].some((k) => k in o.patch)) bits.push('реквізити');
    return bits.join(' · ');
  };
  const block = (title, list, render, open) => (list.length
    ? `<details class="sp-jr-list"${open ? ' open' : ''}><summary>${title} <b>${list.length}</b></summary><ul>${list.map(render).join('')}</ul></details>`
    : '');

  return `
    <p class="sp-jr-file"><b>${esc(p.file.name)}</b><br>
      <span class="sp-muted">власник ${esc(j.owner)} · ${j.created ? `сформовано ${fmtStamp(j.created)} · ` : ''}${j.rows} резолюцій, ${j.docs.size} документів · відділ ${esc(p.dept)}</span></p>
    ${warn.map(([cls, t]) => `<p class="sp-jr-warn ${cls}">${t}</p>`).join('')}
    <div class="sp-jr-stats">
      <div><strong>${ins.length}</strong><span>нових справ</span></div>
      <div><strong>${upd.length}</strong><span>оновиться</span></div>
      <div><strong>${gone.length}</strong><span>резолюцію закрито</span></div>
      ${back.length ? `<div><strong>${back.length}</strong><span>повернулися</span></div>` : ''}
    </div>
    <p class="sp-muted sp-jr-note">На дошку йдуть документи за ${A.DAYS} днів або зі строком, що минув не більш як тиждень тому, без «до відома»: ${cases.length}, з них уже на дошці ${onBoard}${onBoard - upd.length > 0 ? ` (без змін ${onBoard - upd.length})` : ''}.
      Етап, виконавця, суть і нюанси журнал не змінює. «Резолюцію закрито» — ваша справа з АСКОД, якої в журналі більше немає: її позначено, а не закрито.</p>
    ${block('Нові справи', ins, (o) => row(o.in_no), ins.length <= 8)}
    ${block('Оновиться', upd, (o) => row(o.in_no, what(o)), false)}
    ${block('Зникли з журналу', gone, (o) => row(o.in_no), false)}
    ${block('Повернулися в журнал', back, (o) => row(o.in_no, `стан: ${esc(o.patch.askod_state || '—')}`), false)}
    ${ops.length ? '' : '<p class="sp-jr-warn">Усе вже актуально: змін немає.</p>'}
    ${p.noLog ? '<p class="sp-muted sp-jr-note">Облік завантажень ще не ввімкнено (міграція 03h): журнал застосується, але без запобіжника від старішого файла.</p>' : ''}`;
}

async function apply() {
  const p = pending;
  if (!p || p.stale) return;
  const ok = $('spJournalOk');
  ok.disabled = true;
  const counts = { added: 0, updated: 0, gone: 0, back: 0 };
  const key = { insert: 'added', update: 'updated', gone: 'gone', back: 'back' };
  const failed = [];
  if (ctx.demo) {
    const list = ctx.cases();
    p.ops.forEach((o) => {
      if (o.op === 'insert') list.push({ id: crypto.randomUUID(), stage: 'new', review_passed: false, priority: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...o.row });
      else Object.assign(list.find((c) => c.id === o.id) || {}, o.patch, { change_note: null });
      counts[key[o.op]]++;
    });
  } else {
    // Як push(): по одній операції; по чотири паралельно, щоб 100 справ не йшли хвилину
    let i = 0;
    let done = 0;
    const worker = async () => {
      while (i < p.ops.length) {
        const o = p.ops[i++];
        const q = o.op === 'insert'
          ? ctx.sb.from('dept_cases').insert(o.row)
          : ctx.sb.from('dept_cases').update(o.patch).eq('id', o.id);
        const { error } = await q;
        if (error) failed.push(`${o.in_no}: ${error.message}`);
        else counts[key[o.op]]++;
        ok.textContent = `Записую ${++done} з ${p.ops.length}…`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (!failed.length || failed.length < p.ops.length) {
      await ctx.sb.from('dept_journal_uploads').insert({
        department: p.dept, owner_name: p.j.owner, journal_at: p.j.created, file_name: p.file.name,
        source: 'portal', uploaded_by: ctx.me.id, uploaded_by_name: ctx.name,
        docs_total: p.j.docs.size, picked: p.cases.length, ...counts
      });                                    // облік — не критично: без міграції просто не запишеться
    }
  }
  const summary = `заведено ${counts.added}, оновлено ${counts.updated}, резолюцію закрито ${counts.gone}` + (counts.back ? `, повернулися ${counts.back}` : '');
  if (failed.length) {
    $('spJournalBody').insertAdjacentHTML('afterbegin', `<p class="sp-jr-warn is-bad">Не записано ${failed.length}: ${esc(failed.slice(0, 3).join('; '))}${failed.length > 3 ? '…' : ''}</p>`);
    ok.textContent = 'Записано частково';
    ctx.toast(`Журнал: ${summary}; помилок ${failed.length}`, true);
  } else {
    $('spJournalDlg').close();
    ctx.toast(`Журнал АСКОД: ${summary}`);
  }
  pending = null;
  await ctx.reload();
}
