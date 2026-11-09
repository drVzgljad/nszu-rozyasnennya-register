/**
 * «🎯 Контролька» у «Справах відділу» (з 09.11.2026): xlsx-контролька департаменту
 * («Контроль 09.11. - 13.11.2026») → позначка «На контролі» на справах.
 *
 * Колонки контрольки: № документа · Зміст документа · Вид документа · Строк ·
 * Гол.вик-ць · Стан виконання · Примітка. Заголовок шукаємо за назвами, а не за
 * місцем: департамент уже міняв порядок колонок.
 *
 * Що робить:
 * - справу з тим самим вх. № ставить на контроль і переносить у неї «Стан виконання»,
 *   «Гол.вик-ць», примітку й назву контрольки; № проєкту Н(СЛ)-… зі стану вписує,
 *   лише якщо в справі його ще немає. Строк і етап НЕ змінює: їх веде журнал АСКОД;
 *   розбіжність строку лише показує;
 * - документи, яких на дошці немає, пропонує завести у відділі, що відкритий (галочка
 *   стоїть сама, якщо гол. виконавець — хтось із цього відділу);
 * - справи відділу, що були на контролі, а в цій контрольці їх немає, пропонує зняти
 *   з контролю (за замовчуванням не знімає: їх могли просто перенести на інший тиждень).
 *
 * Історію («Поставлено на контроль», «Стан за контролькою: …») пише тригер бази
 * (migration_2026-11-09_case_control.sql). Читання xlsx — PMG_ASKOD.readSheet.
 */
const A = globalThis.PMG_ASKOD;   // globalThis, а не window: розбір ганяється й у Node
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '—');
const MISSING_COL = /column .*control|on_control|PGRST204|42703/i;
const COLS = 'id,department,in_no,subject,deadline,stage,executor_name,project_no,on_control,control_note,control_state,control_lead,control_list';

let ctx = null;      // { sb, me, name, dept(), toast, reload, demo, cases(), people(), demoEvent() }
let pending = null;

export function initControlUpload(o) {
  ctx = o;
  const btn = $('spControl');
  if (!btn || !A?.readSheet) return;
  btn.hidden = false;
  const input = $('spControlFile');
  btn.addEventListener('click', () => { input.value = ''; input.click(); });
  input.addEventListener('change', () => input.files[0] && open(input.files[0]));
  $('spControlCancel').addEventListener('click', () => $('spControlDlg').close());
  $('spControlForm').addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  $('spControlBody').addEventListener('change', countChecked);
}

/* ───────────── розбір контрольки ───────────── */

// Латинські двійники кириличних літер у номерах (Д-10238-26, ПІ-430-26, С-10304-26)
const LAT = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', I: 'І', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
export const normNo = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, '').replace(/[‐-―−]/g, '-')
  .replace(/[ABCEHIKMOPTXY]/g, (ch) => LAT[ch]);
const baseNo = (n) => n.split('/')[0];
const words = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\s'’-]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);

function asISO(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(v.trim());
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}
const text = (v) => (v == null ? '' : String(v).replace(/_x000d_/gi, '').replace(/\s+/g, ' ').trim());

/** Рядки аркуша → [{ no, subject, kind, deadline, lead, state, note }]. */
export function parseControl(rows) {
  const hi = rows.findIndex((r) => (r || []).some((v) => /№\s*документа/i.test(text(v))));
  if (hi < 0) throw new Error('Це не контролька: немає колонки «№ документа»');
  const head = rows[hi].map((v) => text(v).toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const c = {
    no: col(/№\s*документа/), subject: col(/зміст/), kind: col(/^вид/), deadline: col(/строк|термін/),
    lead: col(/гол.*вик/), state: col(/стан/), note: col(/примітк/)
  };
  const get = (r, k) => (c[k] >= 0 ? r[c[k]] : null);
  return rows.slice(hi + 1).map((r) => ({
    no: text(get(r, 'no')),
    subject: text(get(r, 'subject')),
    kind: text(get(r, 'kind')),
    deadline: asISO(get(r, 'deadline')),
    lead: text(get(r, 'lead')),
    state: text(get(r, 'state')),
    note: text(get(r, 'note'))
  })).filter((x) => x.no);
}

/** № проєкту відповіді зі стану виконання: «проєкт відповіді Н(СЛ)-26777 на підписі…» */
export const projectNoOf = (s) => {
  const m = /([НH]\s*\(\s*[СC]\s*[ЛL]\s*\))\s*-?\s*(\d{3,})/i.exec(s || '');
  return m ? `Н(СЛ)-${m[2]}` : null;
};

/** Гол.вик-ць «Волошина А.» → співробітник відділу з тим самим прізвищем (і першою літерою імені). */
function personOf(lead, people) {
  const w = words(lead);
  if (!w.length) return null;
  const sur = w.find((x) => x.length > 2) || w[0];
  // \b у JS — лише для латиниці, тому межу слова задаємо пробілом
  const init = (String(lead).match(/(?:^|\s)([А-ЯІЇЄҐ])\./u) || [])[1]?.toLowerCase();
  const hits = people.filter((p) => words(p.full_name).includes(sur));
  if (hits.length <= 1) return hits[0] || null;
  return hits.find((p) => init && words(p.full_name).some((x) => x !== sur && x[0] === init)) || null;
}

/**
 * План: mark — поставити на контроль / оновити стан, same — уже актуально,
 * create — немає на дошці, unmark — були на контролі, у цій контрольці немає.
 */
export function planControl({ items, existing, people, dept, list }) {
  const byNo = new Map();
  existing.forEach((c) => {
    if (!c.in_no) return;
    const n = normNo(c.in_no);
    [n, baseNo(n)].forEach((k) => { if (!byNo.has(k)) byNo.set(k, []); if (!byNo.get(k).includes(c)) byNo.get(k).push(c); });
  });
  const ops = [];
  const seen = new Set();
  items.forEach((it) => {
    const n = normNo(it.no);
    const exact = existing.filter((c) => c.in_no && normNo(c.in_no) === n);
    const hits = exact.length ? exact : (byNo.get(baseNo(n)) || []);
    if (!hits.length) {
      const p = personOf(it.lead, people);
      ops.push({ op: 'create', it, person: p, checked: !!p });
      return;
    }
    hits.forEach((c) => {
      seen.add(c.id);
      const patch = {
        on_control: true,
        control_list: list,
        control_lead: it.lead || null,
        control_state: it.state || null,
        control_note: it.note || c.control_note || null
      };
      const pn = projectNoOf(it.state);
      if (pn && !c.project_no) patch.project_no = pn;
      const changed = Object.keys(patch).some((k) => (patch[k] ?? null) !== (c[k] ?? null));
      const dl = it.deadline && c.deadline && it.deadline !== String(c.deadline).slice(0, 10) ? it.deadline : null;
      ops.push({ op: changed ? 'mark' : 'same', it, c, patch, dl, other: c.department !== dept });
    });
  });
  existing.forEach((c) => {
    if (c.on_control && c.department === dept && c.stage !== 'done' && !seen.has(c.id)) ops.push({ op: 'unmark', c, checked: false });
  });
  return ops;
}

/* ───────────── діалог ───────────── */

async function loadExisting(dept) {
  if (ctx.demo) return { existing: ctx.cases(), people: ctx.people() };
  // Усі справи, які людина бачить (RLS): керівництво — усі відділи, решта — свій
  const [cases, people] = await Promise.all([
    ctx.sb.from('dept_cases').select(COLS).not('in_no', 'is', null),
    ctx.sb.from('profiles').select('id, full_name, role').eq('Section', dept)
  ]);
  if (cases.error) {
    if (MISSING_COL.test(cases.error.message || cases.error.code || '')) {
      throw new Error('Позначки «На контролі» в базі ще немає: потрібно застосувати migration_2026-11-09_case_control.sql у Supabase SQL Editor.');
    }
    throw new Error(cases.error.message);
  }
  return { existing: cases.data || [], people: (people.data || []).filter((p) => p.role !== 'guest') };
}

async function open(file) {
  const dlg = $('spControlDlg');
  const body = $('spControlBody');
  const ok = $('spControlOk');
  pending = null;
  body.innerHTML = '<p class="sp-muted">Читаю контрольку…</p>';
  ok.disabled = true;
  ok.textContent = 'Застосувати';
  if (!dlg.open) dlg.showModal();
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Потрібен файл .xlsx — контролька департаменту');
    const items = parseControl(await A.readSheet(await file.arrayBuffer()));
    if (!items.length) throw new Error('У контрольці немає жодного рядка з № документа');
    const dept = ctx.dept();
    const list = file.name.replace(/\.xlsx$/i, '').replace(/\s+/g, ' ').trim();
    const { existing, people } = await loadExisting(dept);
    const ops = planControl({ items, existing, people, dept, list });
    pending = { file, items, dept, list, ops, people };
    body.innerHTML = summaryHTML(pending);
    countChecked();
  } catch (e) {
    body.innerHTML = `<p class="sp-jr-warn is-bad">${esc(e.message || e)}</p>`;
  }
}

function summaryHTML(p) {
  const by = (op) => p.ops.map((o, i) => ({ o, i })).filter(({ o }) => o.op === op);
  const mark = by('mark');
  const same = by('same');
  const create = by('create');
  const unmark = by('unmark');
  const line = (it, c) => `<b>${esc(it?.no || c?.in_no)}</b> <span class="sp-muted">строк ${fmtDate(it?.deadline || c?.deadline)}${it?.lead ? ' · гол. вик. ' + esc(it.lead) : ''}</span>`;
  const subj = (s) => `<br><span class="sp-jr-subj">${esc((s || '').slice(0, 140))}</span>`;
  const markRow = ({ o }) => `<li>${line(o.it)}${o.other ? ` <span class="sp-jr-chg">відділ ${esc(o.c.department)}</span>` : ''}
    ${o.patch.project_no ? ` <span class="sp-jr-chg">проєкт № ${esc(o.patch.project_no)}</span>` : ''}
    ${o.it.state ? `<br><span class="sp-jr-chg">стан: ${esc(o.it.state)}</span>` : ''}
    ${o.dl ? `<br><span class="sp-ctl-dl">⚠ строк на дошці ${fmtDate(o.c.deadline)}, у контрольці ${fmtDate(o.dl)} — перевірте в АСКОД</span>` : ''}
    ${subj(o.c.subject)}</li>`;
  const check = ({ o, i }, label) => `<li><label class="sp-ctl-pick"><input type="checkbox" data-i="${i}"${o.checked ? ' checked' : ''}>
    <span>${line(o.it, o.c)}${label(o)}${subj(o.it?.subject || o.c?.subject)}</span></label></li>`;
  const block = (title, list, render, open, hint) => (list.length
    ? `<details class="sp-jr-list"${open ? ' open' : ''}><summary>${title} <b>${list.length}</b></summary>${hint ? `<p class="sp-muted sp-jr-note">${hint}</p>` : ''}<ul>${list.map(render).join('')}</ul></details>`
    : '');
  return `
    <p class="sp-jr-file"><b>${esc(p.file.name)}</b><br>
      <span class="sp-muted">${p.items.length} документів на контролі · відділ ${esc(p.dept)}</span></p>
    <div class="sp-jr-stats">
      <div><strong>${mark.length}</strong><span>позначиться 🎯</span></div>
      <div><strong>${same.length}</strong><span>уже актуально</span></div>
      <div><strong>${create.length}</strong><span>немає на дошці</span></div>
      ${unmark.length ? `<div><strong>${unmark.length}</strong><span>випали з контролю</span></div>` : ''}
    </div>
    <p class="sp-muted sp-jr-note">Справи з тим самим вх. № стануть «🎯 На контролі»; стан виконання й примітка перейдуть у картку.
      Строк і етап контролька не змінює: їх веде журнал АСКОД.</p>
    ${block('Позначиться', mark, markRow, mark.length <= 10)}
    ${block('Немає на дошці — завести у відділі', create, (x) => check(x, (o) => (o.person ? ` <span class="sp-jr-chg">виконавець: ${esc(o.person.full_name)}</span>` : '')), true,
      'Галочка стоїть сама, якщо головний виконавець — із цього відділу. Справи інших відділів заводять вони.')}
    ${block('Були на контролі, у цій контрольці немає — зняти?', unmark, (x) => check(x, (o) => (o.c.control_list ? ` <span class="sp-jr-chg">${esc(o.c.control_list)}</span>` : '')), false,
      'Без галочки справа лишиться на контролі.')}
    ${block('Уже актуально', same, ({ o }) => `<li>${line(o.it)}${subj(o.c.subject)}</li>`, false)}`;
}

function countChecked() {
  const p = pending;
  if (!p) return;
  $('spControlBody').querySelectorAll('input[data-i]').forEach((cb) => { p.ops[Number(cb.dataset.i)].checked = cb.checked; });
  const n = p.ops.filter((o) => o.op === 'mark' || (['create', 'unmark'].includes(o.op) && o.checked)).length;
  const ok = $('spControlOk');
  ok.disabled = !n;
  ok.textContent = n ? `Застосувати (${n})` : 'Змін немає';
}

const replyKind = (kind) => (/публічн|^пі\b/i.test(kind) ? 'pi' : 'letter');

function newRow(o, p) {
  return {
    department: p.dept,
    case_kind: 'askod',
    in_no: o.it.no,
    subject: o.it.subject || o.it.no,
    deadline: o.it.deadline,
    reply_kind: replyKind(o.it.kind),
    stage: 'new',
    source: 'manual',
    our_role: o.person ? 'lead' : null,
    executor_name: o.person?.full_name || null,
    executor_id: ctx.demo ? null : (o.person?.id || null),
    project_no: projectNoOf(o.it.state),
    on_control: true,
    control_list: p.list,
    control_lead: o.it.lead || null,
    control_state: o.it.state || null,
    control_note: o.it.note || null,
    created_by_name: ctx.name,
    updated_by_name: ctx.name
  };
}

async function apply() {
  const p = pending;
  if (!p) return;
  countChecked();
  const todo = p.ops.filter((o) => o.op === 'mark' || (['create', 'unmark'].includes(o.op) && o.checked));
  const ok = $('spControlOk');
  ok.disabled = true;
  const counts = { mark: 0, create: 0, unmark: 0 };
  const failed = [];
  const note = `Заведено з контрольки «${p.list}»`;
  for (const [n, o] of todo.entries()) {
    ok.textContent = `Записую ${n + 1} з ${todo.length}…`;
    const no = o.it?.no || o.c?.in_no;
    if (ctx.demo) {
      const list = ctx.cases();
      if (o.op === 'create') {
        const c = { id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), priority: 0, review_passed: false, ...newRow(o, p) };
        list.push(c);
        ctx.demoEvent(c.id, `${note} · 🎯 на контролі`);
      } else {
        const c = list.find((x) => x.id === o.c.id);
        const patch = o.op === 'mark' ? o.patch : { on_control: false };
        if (c) {
          const was = c.on_control;
          Object.assign(c, patch);
          ctx.demoEvent(c.id, patch.on_control === false ? '🎯 Знято з контролю'
            : was ? `🎯 Стан за контролькою: ${patch.control_state || '—'} (${p.list})` : `🎯 Поставлено на контроль${patch.control_note ? ' — ' + patch.control_note : ''} (${p.list})`);
        }
      }
      counts[o.op]++;
      continue;
    }
    let res;
    if (o.op === 'create') {
      res = await ctx.sb.from('dept_cases').insert({ ...newRow(o, p), created_by: ctx.me.id }).select('id').single();
      if (!res.error && res.data) {
        await ctx.sb.from('dept_case_events').insert({ case_id: res.data.id, author_id: ctx.me.id, author_name: ctx.name, kind: 'system', body: `${note} · 🎯 на контролі` });
      }
    } else {
      const patch = o.op === 'mark' ? o.patch : { on_control: false };
      res = await ctx.sb.from('dept_cases').update({ ...patch, updated_by_name: ctx.name }).eq('id', o.c.id).select('id');
      // RLS мовчки не дає змінити справу чужого відділу: оновлено 0 рядків — це теж помилка
      if (!res.error && !(res.data || []).length) res = { error: { message: 'немає права змінювати справу цього відділу' } };
    }
    if (res.error) failed.push(`${no}: ${/duplicate|23505/.test(res.error.message || res.error.code || '') ? 'справа з цим вх. № у відділі вже є' : res.error.message}`);
    else counts[o.op]++;
  }
  const summary = `на контроль ${counts.mark}, заведено ${counts.create}${counts.unmark ? `, знято ${counts.unmark}` : ''}`;
  if (failed.length) {
    $('spControlBody').insertAdjacentHTML('afterbegin', `<p class="sp-jr-warn is-bad">Не записано ${failed.length}: ${esc(failed.slice(0, 3).join('; '))}${failed.length > 3 ? '…' : ''}</p>`);
    ok.textContent = 'Записано частково';
    ctx.toast(`Контролька: ${summary}; помилок ${failed.length}`, true);
  } else {
    $('spControlDlg').close();
    ctx.toast(`Контролька: ${summary}`);
  }
  pending = null;
  await ctx.reload();
}
