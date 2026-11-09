/* Журнал АСКОД (xlsx-вигрузка резолюцій) → справи відділу. Один модуль на портал.
 *
 * Той самий розбір, що в D:\pmg-data\tools\spravy_sync.py (щоденне завдання
 * PMG_Spravy_Sync): функції нижче — порт load_journal / journal_case / pick /
 * our_role / reply_kind / owns / push ОДИН В ОДИН, з тими самими назвами.
 * Змінюєте правило там — змініть тут, і навпаки. Що обидва шляхи дають той самий
 * результат, перевіряє tools/check_askod_journal.py на справжніх журналах
 * з 00_ВХІДНЕ (вони з прізвищами, тому в репозиторій не потрапляють).
 *
 * Тонкощі, через які порт не «приблизний»:
 * - значення клітинок повторюють openpyxl: дата — datetime (str() дає
 *   «2026-11-02 16:40:09», мілісекунди округлено банківським правилом), ціле —
 *   int, дробове — float. Тому str(v), «v or ""» і порівняння з «Так» дають те саме;
 * - \s у Python ширший за JS-ний (\x1c–\x1f, \x85) і не містить \ufeff — клас PY_WS;
 * - обрізання clean(v, n) — за кодовими точками, як s[:n] у Python;
 * - set.pop() у Python для kinds — тут перший за порядком (у межах документа
 *   kinds без «info» має щонайбільше один елемент: № і вид документа спільні).
 *
 * Без залежностей: xlsx = zip, розпаковує DecompressionStream('deflate-raw'),
 * XML читається регулярними виразами (DOMParser у Node немає, а модуль
 * ганяється і там). Підключати звичайним тегом script ДО скрипта розділу;
 * у Node — require().
 *
 *   const j = await PMG_ASKOD.readJournal(arrayBuffer, 'journal_03_11_2026_13_02_10.xlsx');
 *   // j.owner — власник журналу, j.docs — {вх. №: {recs}}, j.created — коли АСКОД сформував файл
 *   const cases = PMG_ASKOD.pick(j.docs, 45, false, '2026-11-03');
 *   const ops = PMG_ASKOD.plan({ cases, existing, people, journalNos, owners, docs, by });
 */
(function (root) {
  'use strict';

  var DAYS = 45;                                  // --days за замовчуванням
  var ASKOD_NOTE = 'за журналом АСКОД';           // підстава зміни строку в історії справи
  var GONE = 'зникла з журналу (резолюцію, імовірно, закрито)';

  /* ─────────────── значення клітинок як в openpyxl ─────────────── */

  // Число з журналу: int чи float (str() у Python різний: «5» і «5.0»)
  function PyNum(n, isFloat) { this.n = n; this.f = isFloat; }
  // Дата-час: dt — те, що дає str(datetime); d — дата ISO
  function PyDate(dt) { this.dt = dt; this.d = dt.slice(0, 10); }
  // Час без дати (0 ≤ серійне < 1): as_date() його не бере
  function PyTime(t) { this.t = t; }

  function pyFloatStr(x) {
    if (!isFinite(x)) return x > 0 ? 'inf' : x < 0 ? '-inf' : 'nan';
    if (Number.isInteger(x) && Math.abs(x) < 1e16) return x.toFixed(1);
    var s = String(x);                            // 1e-7 → «1e-07», як repr у Python
    return s.replace(/e([+-])(\d)$/, 'e$10$2');
  }

  /** str(v) */
  function pyStr(v) {
    if (v === null || v === undefined) return 'None';
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (v instanceof PyNum) return v.f ? pyFloatStr(v.n) : String(v.n);
    if (v instanceof PyDate) return v.dt;
    if (v instanceof PyTime) return v.t;
    return String(v);
  }

  /** bool(v) — для «v or ""» */
  function truthy(v) {
    if (v === null || v === undefined || v === '' || v === false) return false;
    if (v instanceof PyNum) return v.n !== 0;
    return true;
  }

  const or = (v, alt) => (truthy(v) ? v : alt);

  /* ─────────────── xlsx: zip + XML ─────────────── */

  async function inflateRaw(bytes) {
    var ds = new DecompressionStream('deflate-raw');
    var out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  /** Записи zip за центральним каталогом: {імʼя: () => Promise<Uint8Array>} */
  function unzip(buf) {
    var u8 = new Uint8Array(buf);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Це не xlsx: файл не схожий на zip-архів');
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder('utf-8');
    var files = {};
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Пошкоджений zip: центральний каталог');
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true);
      var xlen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      files[name] = (function (method, csize, local) {
        return function () {
          var start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
          var data = u8.subarray(start, start + csize);
          if (method === 0) return Promise.resolve(data);
          if (method === 8) return inflateRaw(data);
          return Promise.reject(new Error('Невідомий метод стиснення zip: ' + method));
        };
      })(method, csize, local);
    }
    return files;
  }

  async function readText(files, name) {
    var f = files[name];
    if (!f) return null;
    return new TextDecoder('utf-8').decode(await f()).replace(/^\ufeff/, '');
  }

  function unescapeXml(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (_, e) {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
    });
  }

  /** Текст <si>/<is>: <t> і <r><t>, без фонетики <rPh> — як Text.content в openpyxl */
  function richText(xml) {
    xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    var out = '';
    var re = /<t(?:\s[^>]*)?\/>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    var m;
    while ((m = re.exec(xml))) out += unescapeXml(m[1] || '');
    return out;
  }

  const attr = (tag, name) => {
    var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
    return m ? unescapeXml(m[1]) : null;
  };

  // openpyxl.styles.numbers.is_date_format
  var BUILTIN_DATES = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 45: 1, 46: 1, 47: 1 };
  function isDateFormat(code) {
    if (!code) return false;
    code = code.split(';')[0].replace(/"[^"]*"|\[[^\]]*\]/g, '');
    return /(?<![_\\])[dmhysDMHYS]/.test(code);
  }

  async function dateStyles(files) {
    var xml = await readText(files, 'xl/styles.xml');
    if (!xml) return [];
    var custom = {};
    (xml.match(/<numFmt\b[^>]*>/g) || []).forEach(function (t) { custom[attr(t, 'numFmtId')] = attr(t, 'formatCode'); });
    var xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    return ((xfs && xfs[1].match(/<xf\b[^>]*>/g)) || []).map(function (t) {
      var id = Number(attr(t, 'numFmtId') || 0);
      return !!BUILTIN_DATES[id] || (id >= 164 && isDateFormat(custom[id]));
    });
  }

  // round() у Python — банківське округлення
  function roundHalfEven(x) {
    var r = Math.round(x);
    return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
  }
  const pad = (n, w) => String(n).padStart(w || 2, '0');

  /** openpyxl.utils.datetime.from_excel (епоха 1899-12-30) */
  function fromExcel(value) {
    var day = Math.floor(value);
    var ms = roundHalfEven((value % 1) * 86400 * 1000);
    if (value >= 0 && value < 1 && ms < 86400000) {
      var t = new Date(ms);
      var us = t.getUTCMilliseconds() * 1000;
      return new PyTime(pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ':' + pad(t.getUTCSeconds()) + (us ? '.' + pad(us, 6) : ''));
    }
    if (value > 0 && value < 60) day += 1;
    var d = new Date(Date.UTC(1899, 11, 30) + day * 86400000 + ms);
    var micro = d.getUTCMilliseconds() * 1000;
    return new PyDate(d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
      pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + (micro ? '.' + pad(micro, 6) : ''));
  }

  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    var n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  /** Аркуш, який openpyxl вважає активним (workbook.xml → activeTab, інакше перший) */
  async function activeSheetPath(files) {
    var wb = await readText(files, 'xl/workbook.xml') || '';
    var rels = await readText(files, 'xl/_rels/workbook.xml.rels') || '';
    var sheets = wb.match(/<sheet\b[^>]*>/g) || [];
    var tab = Number(attr((/<workbookView\b[^>]*>/.exec(wb) || [''])[0], 'activeTab') || 0);
    var sheet = sheets[tab] || sheets[0];
    var rid = sheet && attr(sheet, 'r:id');
    var rel = (rels.match(/<Relationship\b[^>]*>/g) || []).find(function (t) { return attr(t, 'Id') === rid; });
    var target = rel ? attr(rel, 'Target') : 'worksheets/sheet1.xml';
    return target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }

  /** Рядки аркуша як list(ws.iter_rows(values_only=True)) в openpyxl (read_only). */
  async function readRows(files) {
    var shared = [];
    var sst = await readText(files, 'xl/sharedStrings.xml');
    if (sst) {
      var re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
      var m;
      while ((m = re.exec(sst))) shared.push(richText(m[1] || '').replace(/x005F_/g, ''));
    }
    var dates = await dateStyles(files);
    var xml = await readText(files, await activeSheetPath(files));
    if (!xml) throw new Error('У файлі немає аркуша з даними');
    var rows = [];
    var rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    var r;
    var next = 1;
    while ((r = rowRe.exec(xml))) {
      var idx = Number(attr(r[1], 'r')) || next;
      while (rows.length < idx - 1) rows.push([]);     // пропущені рядки openpyxl віддає порожніми
      next = idx + 1;
      var row = [];
      var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      var c;
      while ((c = cellRe.exec(r[2] || ''))) {
        var a = c[1];
        var body = c[2] || '';
        var col = colIndex(attr(a, 'r'));
        if (col < 0) col = row.length;
        var t = attr(a, 't') || 'n';
        var vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        var raw = vm ? unescapeXml(vm[1]) : null;
        var val = null;
        if (t === 'inlineStr') {
          var is = /<is>([\s\S]*?)<\/is>/.exec(body);
          val = is ? richText(is[1]) : null;
        } else if (raw === null) {
          val = null;
        } else if (t === 's') {
          val = shared[Number(raw)];
        } else if (t === 'str' || t === 'e') {
          val = raw;
        } else if (t === 'b') {
          val = raw === '1' || raw === 'true';
        } else {
          var isFloat = /[.eE]/.test(raw);
          var num = Number(raw);
          var st = Number(attr(a, 's') || 0);
          val = dates[st] ? fromExcel(num) : new PyNum(num, isFloat);
        }
        while (row.length < col) row.push(null);
        row[col] = val;
      }
      rows.push(row);
    }
    return rows;
  }

  /* ─────────────── 1. журнал АСКОД (порт spravy_sync.py) ─────────────── */

  // \s у регулярках Python 3 (str): ширший за JS-ний, без \ufeff
  var PY_WS = '[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  var WS_RUN = new RegExp(PY_WS + '+', 'g');

  /** as_date(v) → 'YYYY-MM-DD' або null */
  function as_date(v) {
    if (v instanceof PyDate) return v.d;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return null;
  }

  function clean(v, n) {
    // _x000d_ — так openpyxl віддає перенос рядка з комірок журналу АСКОД
    var s = pyStr(or(v, '')).replace(/_x000[da]_/gi, ' ').replace(WS_RUN, ' ').replace(/^ +| +$/g, '');
    if (n) {
      var cps = Array.from(s);
      if (cps.length > n) s = cps.slice(0, n).join('').replace(/ +$/, '') + '…';
    }
    return s || null;
  }

  const get = (rec, k) => (Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : null);
  const lower = (v) => pyStr(or(v, '')).toLowerCase();

  function reply_kind(rec) {
    var no = pyStr(or(get(rec, '№ документа'), ''));
    var text = lower(get(rec, 'Текст резолюції'));
    if (no.startsWith('ПІ-')) return 'pi';
    if (text.includes('до відома')) return 'info';
    if (or(get(rec, 'Вид документа'), '') === 'Службова записка') return 'sz';
    return 'letter';
  }

  /** Наша роль за резолюціями: головні / співвиконавці / до відома (або невідомо). */
  function our_role(recs) {
    if (recs.some(function (r) { return get(r, 'Гол.вик-ць') === 'Так'; })) return 'lead';
    var texts = recs.map(function (r) { return lower(get(r, 'Текст резолюції')); }).join(' ');
    if (texts.includes('головного виконавця')) return 'co';
    if (texts.includes('до відома')) return 'info';
    return null;
  }

  /** dict(zip(head, row)) */
  function record(head, row) {
    var rec = {};
    var n = Math.min(head.length, row.length);
    for (var i = 0; i < n; i++) rec[pyStr(head[i])] = row[i] === undefined ? null : row[i];
    return rec;
  }

  /** Власник журналу — найчастіше значення «Виконавець» (max() бере перше з рівних). */
  function journalOwner(rows) {
    var head = rows[0] || [];
    var who = new Map();
    rows.slice(1).forEach(function (row) {
      var name = clean(get(record(head, row), 'Виконавець'));
      if (name) who.set(name, (who.get(name) || 0) + 1);
    });
    var best = null;
    who.forEach(function (n, name) { if (best === null || n > who.get(best)) best = name; });
    return best || '?';
  }

  /** Документи журналу: {вх. №: {recs: [...]}} — як docs у load_journal() для одного файла. */
  function journalDocs(rows) {
    var head = rows[0] || [];
    var docs = new Map();
    rows.slice(1).forEach(function (row) {
      var rec = record(head, row);
      var no = clean(get(rec, '№ документа'));
      if (!no) return;
      if (!docs.has(no)) docs.set(no, { recs: [] });
      docs.get(no).recs.push(rec);
    });
    return docs;
  }

  /** Справа належить власнику одного з журналів (ПІБ зводимо за словами, як person()). */
  function owns(executor_name, owners) {
    var name = (executor_name || '').toLowerCase();
    return owners.some(function (ws) {
      return ws.length && ws.slice(0, 2).every(function (w) { return name.includes(w.toLowerCase()); });
    });
  }

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /** Кілька резолюцій одного документа → одна справа. */
  function journal_case(no, recs) {
    recs = recs.slice().sort(function (a, b) {
      return cmp(pyStr(or(get(a, 'Дата створення'), '')), pyStr(or(get(b, 'Дата створення'), '')));
    });
    var first = recs[recs.length - 1];
    var deadlines = recs.map(function (r) { return as_date(get(r, 'Строк')); }).filter(Boolean);
    var resol = [];
    recs.forEach(function (r) {
      var t = (clean(get(r, 'Автор резолюції/завдання')) || '—') + ': ' + (clean(get(r, 'Текст резолюції'), 300) || '—');
      if (get(r, 'Гол.вик-ць') === 'Так') t += ' (гол. виконавець)';
      if (resol.indexOf(t) < 0) resol.push(t);
    });
    var states = [];
    recs.forEach(function (r) {
      var s = clean(get(r, 'Стан рез./завд.'));
      if (s !== null && states.indexOf(s) < 0) states.push(s);
    });
    var kinds = [];
    recs.forEach(function (r) { var k = reply_kind(r); if (kinds.indexOf(k) < 0) kinds.push(k); });
    var notInfo = kinds.filter(function (k) { return k !== 'info'; });
    var corr = clean(get(first, 'Назва кореспондента')) || clean(get(first, 'Вид документа'));
    return {
      in_no: no,
      in_date: as_date(get(first, 'Дата реєстр. документа')),
      correspondent: corr,
      corr_out_no: clean(get(first, 'Вих. № кор-та')),
      corr_out_date: as_date(get(first, 'Дата кор-та')),
      subject: clean(get(first, 'Зміст документа'), 500) || 'Документ ' + no,
      deadline: deadlines.length ? deadlines.slice().sort()[0] : null,
      resolution: resol.join('; '),
      askod_state: states.indexOf('На виконанні') >= 0 ? 'На виконанні' : (states.length ? states.slice().sort(cmp)[0] : null),
      reply_kind: kinds.length === 1 && kinds[0] === 'info' ? 'info' : (notInfo.length ? notInfo[0] : 'letter'),
      our_role: our_role(recs),
      // ПІБ у журналі — «Прізвище Ім'я»; у профілі порталу — «Ім'я Прізвище». Зводимо за словами.
      _executor_words: (clean(get(first, 'Виконавець')) || '').split(' ').filter(Boolean)
    };
  }

  const dayNo = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

  function pick(docs, days, with_info, today) {
    var out = [];
    docs.forEach(function (d, no) {
      var c = journal_case(no, d.recs);
      if (c.reply_kind === 'info' && !with_info) return;
      var fresh = c.in_date && dayNo(today) - dayNo(c.in_date) <= days;
      var live = c.deadline && dayNo(c.deadline) - dayNo(today) >= -7;
      if (fresh || live) out.push(c);
    });
    return out.sort(function (a, b) {
      return cmp(a.deadline || '9999-12-31', b.deadline || '9999-12-31') || cmp(a.in_no, b.in_no);
    });
  }

  /** Коли АСКОД сформував файл: docProps/core.xml → dcterms:created (UTC). */
  async function journalCreated(files) {
    var core = await readText(files, 'docProps/core.xml');
    var m = core && /<dcterms:created\b[^>]*>([^<]+)<\/dcterms:created>/.exec(core);
    return m ? new Date(m[1].trim()).toISOString() : null;
  }

  /**
   * Прочитати журнал: {owner, ownerWords, docs (Map), rows, created}.
   * fileName — лише для повідомлень про помилку.
   */
  async function readJournal(buf, fileName) {
    var files = unzip(buf);
    var rows = await readRows(files);
    var head = (rows[0] || []).map(pyStr);
    ['№ документа', 'Виконавець', 'Текст резолюції'].forEach(function (k) {
      if (head.indexOf(k) < 0) throw new Error((fileName || 'Файл') + ' — не журнал АСКОД: немає колонки «' + k + '»');
    });
    var owner = journalOwner(rows);
    return {
      owner: owner,
      ownerWords: owner === '?' ? [] : owner.split(' ').filter(Boolean),
      docs: journalDocs(rows),
      rows: rows.length ? rows.length - 1 : 0,
      created: await journalCreated(files)
    };
  }

  /* ─────────────── 2. що записати в базу (порт push()) ─────────────── */

  /**
   * Операції над dept_cases — те саме, що робить push() у spravy_sync.py
   * (без контрольної таблиці: вона лежить лише в обміннику власника).
   *
   *   existing — рядки dept_cases відділу з in_no (id, in_no, stage, version, source,
   *              askod_state, our_role, executor_name, in_date, correspondent,
   *              corr_out_no, corr_out_date; для skipNoop ще deadline, resolution)
   *   people   — profiles відділу (id, full_name)
   *   by       — підпис зміни (updated_by_name / created_by_name)
   *   skipNoop — не надсилати оновлення, яке нічого не змінює (push() надсилає)
   *
   * → [{op: 'insert', in_no, row} | {op: 'update'|'gone'|'back', in_no, id, patch}]
   */
  function plan(o) {
    var dept = o.dept;
    var by = o.by;
    var existing = new Map();
    (o.existing || []).forEach(function (r) { existing.set(r.in_no, r); });
    var people = o.people || [];
    var owners = o.owners || [];
    var journalNos = o.journalNos;

    function person(words) {
      for (var i = 0; i < people.length; i++) {
        var p = people[i];
        var name = (p.full_name || '').toLowerCase();
        if (words.length && words.slice(0, 2).every(function (w) { return name.includes(w.toLowerCase()); })) return p;
      }
      return null;
    }
    function changes(cur, patch) {
      return Object.keys(patch).some(function (k) {
        return k !== 'change_note' && k !== 'updated_by_name' && String(cur[k] ?? '').slice(0, k === 'deadline' ? 10 : undefined) !== String(patch[k] ?? '');
      });
    }

    var ops = [];
    o.cases.forEach(function (c) {
      var cur = existing.get(c.in_no);
      if (cur) {
        var patch = { resolution: c.resolution, askod_state: c.askod_state };
        if (c.deadline) {
          patch.deadline = c.deadline;
          patch.change_note = ASKOD_NOTE;    // тригер запише в історію, лише якщо строк справді змінився
        }
        if (c.our_role && !cur.our_role) patch.our_role = c.our_role;
        // Порожні реквізити вхідного доповнюємо, заповнених не чіпаємо (COALESCE у build_sql)
        ['in_date', 'correspondent', 'corr_out_no', 'corr_out_date'].forEach(function (k) {
          if (c[k] && cur[k] === null) patch[k] = c[k];
        });
        patch.updated_by_name = by;
        if (!o.skipNoop || changes(cur, patch)) ops.push({ op: 'update', in_no: c.in_no, id: cur.id, patch: patch });
      } else {
        var row = {};
        Object.keys(c).forEach(function (k) { if (k[0] !== '_') row[k] = c[k]; });
        var p = person(c._executor_words);
        row.department = dept;
        row.source = 'askod';
        row.created_by_name = by;
        row.updated_by_name = by;
        row.executor_name = p ? p.full_name : null;
        row.executor_id = p ? p.id : null;
        ops.push({ op: 'insert', in_no: c.in_no, row: row });
      }
    });
    var picked = new Set(o.cases.map(function (c) { return c.in_no; }));
    existing.forEach(function (cur, no) {
      // «Зникла» — лише справа власника одного з журналів, якої в його журналі вже немає
      if (cur.source === 'askod' && cur.stage !== 'done' && !journalNos.has(no) &&
          cur.askod_state !== GONE && owns(cur.executor_name, owners)) {
        ops.push({ op: 'gone', in_no: no, id: cur.id, patch: { askod_state: GONE, updated_by_name: by } });
      // Документ знову в журналі — знімаємо «зникла» і повертаємо стан із журналу
      } else if (cur.askod_state === GONE && journalNos.has(no) && !picked.has(no) && o.docs) {
        var state = journal_case(no, o.docs.get(no).recs).askod_state;
        ops.push({ op: 'back', in_no: no, id: cur.id, patch: { askod_state: state, updated_by_name: by } });
      }
    });
    return ops;
  }

  /**
   * Будь-яка таблиця (не лише журнал): рядки активного аркуша простими значеннями —
   * дата → 'YYYY-MM-DD', число → Number, решта → рядок або null. Для контрольки
   * департаменту (spravy/control-upload.js). Правил журналу не торкається.
   */
  async function readSheet(buf) {
    var rows = await readRows(unzip(buf));
    return rows.map(function (row) {
      return row.map(function (v) {
        if (v instanceof PyDate) return v.d;
        if (v instanceof PyNum) return v.n;
        if (v instanceof PyTime) return v.t;
        return v == null ? null : v;
      });
    });
  }

  var api = {
    DAYS: DAYS, ASKOD_NOTE: ASKOD_NOTE, GONE: GONE,
    readJournal: readJournal, readSheet: readSheet, pick: pick, plan: plan,
    journal_case: journal_case, our_role: our_role, reply_kind: reply_kind, owns: owns,
    clean: clean, as_date: as_date
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PMG_ASKOD = api;
})(typeof window !== 'undefined' ? window : globalThis);
