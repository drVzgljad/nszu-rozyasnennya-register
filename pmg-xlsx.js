/* Вивантаження таблиць в Excel (.xlsx) — один модуль на весь портал.
 *
 * До 21.08.2026 той самий пакувальник жив трьома копіями: classifiers.js,
 * nk026.js і porivnyannya.js. Дві перші були дослівними близнюками, третя —
 * самостійною і сильнішою: кілька аркушів і справжні числа замість тексту.
 * Тому модуль зроблено НЕ за найменшим спільним знаменником, а за
 * обʼєднанням: усе, що вміла найкраща з копій, лишилося.
 *
 * Нуль залежностей: CDN на портал не тягнемо, SheetJS важить більше за
 * розділ. ZIP пишеться методом 0 (store) — для .xlsx цього досить, Excel і
 * LibreOffice відкривають без зауважень.
 *
 * ── Тип клітинки визначає тип значення, а не прапорець ───────────────────
 *   число (Number, скінченне) -> числова клітинка, Excel нею рахує;
 *   null / undefined / ''     -> порожня клітинка, а не нуль і не «-»;
 *   решта                     -> inlineStr, тобто текст.
 * Це важливо для коефіцієнтів постанови: вони записані з комою («4,367»).
 * Якби модуль перетворював їх на числа, Excel з англійською локаллю зробив
 * би з «4,367» або дату, або 4367. Рядок читається однаково скрізь, тому
 * розділи, які беруть значення з тексту постанови, передають їх рядками
 * свідомо, а «Порівняння тарифів» передає справжні числа і отримує числа.
 *
 * ── Час у ZIP фіксований ─────────────────────────────────────────────────
 * 01.01.1980, як було в porivnyannya.js. Два вивантаження тих самих даних
 * дають побайтово однаковий файл — це дозволяє порівнювати результат у
 * тестах і не плодить різницю там, де даних не змінювали.
 *
 * Підключати звичайним тегом script ДО скрипта розділу.
 *
 *   PMG_XLSX.download({
 *     filename: 'nk025_holera',      // без розширення; дату додає сам модуль
 *     sheets: [{
 *       name:   'НК 025',
 *       head:   ['Код', 'Назва'],    // необовʼязково; якщо є — жирний рядок
 *       rows:   [['A00', 'Холера']],
 *       widths: [10, 64],            // необовʼязково, у символах
 *       freeze: true,                // необовʼязково: закріпити шапку
 *     }],
 *   });
 *
 * Для одного аркуша є коротка форма: замість sheets передати name/head/rows/
 * widths/freeze просто в корені.
 */
(function (root) {
  'use strict';

  var NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function xEsc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Назва аркуша в Excel: до 31 знака, без : \ / ? * [ ] */
  function sheetName(s, index) {
    var clean = String(s == null ? '' : s).replace(/[:\\/?*[\]]/g, ' ').trim();
    return (clean || ('Аркуш ' + (index + 1))).slice(0, 31);
  }

  /** 0 -> A, 25 -> Z, 26 -> AA */
  function columnName(index) {
    var name = '';
    for (var n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
  }

  function cellXml(value, ref, bold) {
    var style = bold ? ' s="1"' : '';
    if (typeof value === 'number' && isFinite(value)) {
      return '<c r="' + ref + '"' + style + '><v>' + value + '</v></c>';
    }
    if (value === null || value === undefined || value === '') {
      return '<c r="' + ref + '"' + style + '/>';
    }
    return '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' +
      xEsc(value) + '</t></is></c>';
  }

  function sheetXml(sheet) {
    var head = sheet.head && sheet.head.length ? [sheet.head] : [];
    var all = head.concat(sheet.rows || []);
    var body = all.map(function (cells, r) {
      var bold = head.length > 0 && r === 0;
      var inner = (cells || []).map(function (v, c) {
        return cellXml(v, columnName(c) + (r + 1), bold);
      }).join('');
      return '<row r="' + (r + 1) + '">' + inner + '</row>';
    }).join('');

    var width = all.reduce(function (max, cells) {
      return Math.max(max, (cells || []).length);
    }, 1);
    var cols = sheet.widths && sheet.widths.length
      ? sheet.widths.map(function (w, i) {
          return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
        }).join('')
      : '<col min="1" max="' + width + '" width="26" customWidth="1"/>';

    // Закріплення шапки має сенс лише тоді, коли шапка є.
    var views = (sheet.freeze && head.length)
      ? '<sheetViews><sheetView workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '</sheetView></sheetViews>'
      : '';

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="' + NS + '">' + views +
      '<cols>' + cols + '</cols><sheetData>' + body + '</sheetData></worksheet>';
  }

  function workbookParts(sheets) {
    var files = [
      { name: '[Content_Types].xml', text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (s, i) {
          return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ' +
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join('') + '</Types>' },
      { name: '_rels/.rels', text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { name: 'xl/workbook.xml', text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="' + NS + '" xmlns:r="' + REL + '"><sheets>' +
        sheets.map(function (s, i) {
          return '<sheet name="' + xEsc(sheetName(s.name, i)) + '" sheetId="' + (i + 1) +
            '" r:id="rId' + (i + 1) + '"/>';
        }).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) {
          return '<Relationship Id="rId' + (i + 1) + '" Type="' + REL +
            '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
        }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + REL +
        '/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="' + NS + '">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>' },
    ];
    sheets.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s) });
    });
    return files;
  }

  /** ZIP без стиснення (метод 0). Час фіксований — див. шапку файла. */
  function zipStore(files) {
    var enc = new TextEncoder();
    var parts = [], cdir = [];
    var offset = 0, count = 0;
    var DOS_TIME = 0, DOS_DATE = 0x0021;   // 01.01.1980
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.text);
      var crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
      cd.setUint16(12, DOS_TIME, true); cd.setUint16(14, DOS_DATE, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      cdir.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
      count++;
    });
    var cdSize = 0;
    cdir.forEach(function (u) { cdSize += u.length; });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, count, true); end.setUint16(10, count, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return parts.concat(cdir, [new Uint8Array(end.buffer)]);
  }

  var CRC_T = null;
  function crc32(u8) {
    if (!CRC_T) {
      CRC_T = new Int32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_T[n] = c;
      }
    }
    var x = -1;
    for (var i = 0; i < u8.length; i++) x = CRC_T[(x ^ u8[i]) & 0xFF] ^ (x >>> 8);
    return (x ^ -1) >>> 0;
  }

  /** Жорсткий шматок назви: лишає лише цифри, латиницю й кирилицю.
      Потрібен там, де в назву йде пошуковий запит користувача. */
  function slug(s, max) {
    return String(s == null ? '' : s).replace(/[^0-9A-Za-zЀ-ӿ]+/g, '_')
      .replace(/^_+|_+$/g, '').slice(0, max || 60);
  }

  /** Мʼяка санітизація готової назви файла: прибирає лише те, що заборонене
      у файлових системах. Дефіси й крапки лишаються — інакше назва на кшталт
      «taryfy-2025-2026-2026-08-14» перетворилася б на кашу з підкреслень. */
  function safeName(s) {
    // Перелік символів, а не регулярка: у класі довелося б екранувати
    // і лапки, і зворотну скісну, і це те місце, де легко помилитися.
    var bad = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    var out = String(s == null ? '' : s).replace(/[\u0000-\u001F]+/g, '_');
    for (var i = 0; i < bad.length; i++) out = out.split(bad[i]).join('_');
    return out.replace(/_+/g, '_')
      .replace(/^[\s._]+|[\s._]+$/g, '')
      .slice(0, 120);
  }

  function normalize(opts) {
    var o = opts || {};
    if (o.sheets && o.sheets.length) return o.sheets;
    return [{ name: o.name || o.sheet, head: o.head, rows: o.rows,
              widths: o.widths, freeze: o.freeze }];
  }

  /** Збирає книгу і повертає Blob — коли файл потрібен не для завантаження. */
  function build(opts) {
    return new Blob(zipStore(workbookParts(normalize(opts))),
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /**
   * Збирає книгу і віддає її браузеру як завантаження.
   * @returns {string} імʼя збереженого файла — зручно показати на кнопці.
   */
  function download(opts) {
    var o = opts || {};
    // stamp: false — не додавати дату (коли вона вже в назві розділу)
    var name = (safeName(o.filename) || 'eksport') +
      (o.stamp === false ? '' : '_' + new Date().toISOString().slice(0, 10)) + '.xlsx';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(build(o));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    return name;
  }

  root.PMG_XLSX = { download, build, slug, safeName, xEsc, columnName };
})(window);
