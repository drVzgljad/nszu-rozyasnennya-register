/* Розрахунок пролікованого випадку за пунктом 38 глави 3 розділу II Порядку.
 *
 * Один модуль на весь портал. До 17.08.2026 та сама формула жила в трьох
 * місцях — drg.js, koduvannia.js і pilot-koduvannia.js, — причому в різній
 * повноті: у пілоті й у «Кодуванні» не було ні додаткових коефіцієнтів, які
 * постанова ДОДАЄ до ваги, ні оплати від базової ставки на добу. Зміниться
 * ставка чи частка застосування — правити треба було б у трьох файлах, і
 * якесь одне місце неминуче лишилося б зі старим числом. Аудит
 * «Довідники → кодування» позначив це як дефект Б1.
 *
 * Модуль без DOM і без залежностей: приймає групу, контекст довідника і стан
 * перемикачів, повертає суму РАЗОМ із кроками — щоб інтерфейс показував не
 * магічне число, а ланцюжок, який експерт звіряє очима по тексту постанови.
 *
 * Підключати ЗВИЧАЙНИМ тегом script перед скриптом розділу.
 */
(function (root) {
  'use strict';

  const fmtDefault = (n) => (n === null || n === undefined ? '—'
    : n.toLocaleString('uk-UA', { maximumFractionDigits: 4 }));

  /**
   * @param {object} g      група ДСГ: {c, a, k:[вага, дод.діти, дод.травми]}
   * @param {object} ctx    довідник: {rate, factors, appendixLabel, appendixCols}
   * @param {object} state  стан перемикачів, ключ — id фактора
   * @returns {{g, rate, weight, adjust, total, steps, unknown, perDay, grand}}
   */
  function calcCase(g, ctx, state) {
    state = state || {};
    const rate = ctx.rate.case;
    const factors = ctx.factors || [];
    const label = (a) => (ctx.appendixLabel && ctx.appendixLabel[a]) || a;
    const cols = (a) => (ctx.appendixCols && ctx.appendixCols[a]) || [];
    const fmt = ctx.fmtK || fmtDefault;
    const steps = [];
    const unknown = [];

    let weight = g.k[0];
    steps.push({ label: `Ваговий коефіцієнт ДСГ ${g.c}`, op: '', value: weight,
      src: label(g.a), sub: '3' });

    // Додаткові коефіцієнти за підпунктами 6 і 7 ДОДАЮТЬСЯ до вагового,
    // а не множаться на нього — це різні гроші, і плутати не можна.
    for (const f of factors.filter((x) => x.kind === 'addw')) {
      if (!state[f.id]) continue;
      const add = g.k[f.column];
      if (add === null || add === undefined) {
        unknown.push({ f, why: `у ${label(g.a)} для ${g.c} ця колонка порожня` });
        continue;
      }
      weight += add;
      steps.push({ label: f.label, op: '+', value: add, sub: f.sub,
        src: `${label(g.a)}, колонка «${cols(g.a)[f.column] || ''}»` });
    }

    let adjust = 1;
    for (const f of factors) {
      if (f.stage === 'final' || !state[f.id]) continue;
      if (f.kind === 'mul') {
        const value = f.options ? Number(state[f.id]) : f.value;
        if (!value) continue;
        adjust *= value;
        steps.push({ label: f.label, op: '×', value, sub: f.sub });
      } else if (f.kind === 'addk') {
        const days = Math.max(0, Math.min(Number(state[f.id]) || 0, f.max_days));
        if (!days) continue;
        adjust += f.value * days;
        steps.push({ label: `${f.label} — ${days} діб × ${fmt(f.value)}`,
          op: '+к', value: f.value * days, sub: f.sub });
      } else if (f.kind === 'unknown') {
        unknown.push({ f, why: 'величину визначають алгоритми і правила НСЗУ' });
      }
    }

    let total = rate * weight * adjust;
    for (const f of factors.filter((x) => x.stage === 'final')) {
      const value = f.editable && state[f.id] !== undefined
        ? Number(state[f.id]) : f.value;
      if (!Number.isFinite(value)) continue;
      total *= value;
      steps.push({ label: f.label, op: '×', value, sub: f.sub });
    }

    // Оплата від базової ставки на добу (підпункти 17 і 18) йде ПОВЕРХ випадку
    // і без частки застосування — тому рахується окремо від total.
    const perDay = [];
    for (const f of factors.filter((x) => x.kind === 'rateday')) {
      const days = Number(state[f.id]) || 0;
      if (!days) continue;
      if (f.drg && !f.drg.includes(g.c)) continue;
      perDay.push({ f, days, sum: rate * f.value * days });
    }

    return { g, rate, weight, adjust, total, steps, unknown, perDay,
      grand: total + perDay.reduce((s, p) => s + p.sum, 0) };
  }

  /** Той самий розрахунок без кроків — для масових прогонів. */
  function quickSum(g, ctx, extra) {
    return calcCase(g, ctx, Object.assign({ share: true, balance: true }, extra || {})).total;
  }

  /** Однорядкова формула для підпису під сумою. */
  function formulaText(res) {
    const num = (v) => String(v).replace('.', ',');
    const parts = res.steps.map((s, i) => (i === 0 ? num(s.value)
      : `${s.op === '+' ? '+' : s.op === '+к' ? '+' : '×'} ${num(s.value)}`));
    return `${res.rate} × (${parts.join(' ')}) = ${res.total.toLocaleString('uk-UA',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 })} грн`;
  }

  root.PMG_TARIFF = { calcCase, quickSum, formulaText, fmtK: fmtDefault };
})(window);
