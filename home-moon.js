/**
 * Фаза Місяця для віджета погоди на головній (home-live.js). Рахується локально, без API.
 *
 * Відлік — новий місяць 6 січня 2000 р., 18:14 UTC (JDE 2451550.09766), крок — синодичний
 * місяць 29,530588861 доби. Середній молодик виправлено головними періодичними членами з
 * Ж. Меєса «Astronomical Algorithms», розд. 49: справжній молодик і повня відхиляються від
 * середніх до 14 годин, а тут похибка — хвилини. Освітленість — за фазовим кутом (розд. 48).
 * Перевірка на відомих датах фаз: node tools/check_moon.mjs
 */

const SYNODIC = 29.530588861;
const EPOCH_JDE = 2451550.09766;
const RAD = Math.PI / 180;
const DAY_MS = 864e5;

const toJd = (date) => date.getTime() / DAY_MS + 2440587.5;
const fromJd = (jd) => new Date((jd - 2440587.5) * DAY_MS);
const sin = (deg) => Math.sin(deg * RAD);

/** Справжній молодик (ціле k) чи повня (k + 0,5), JD. Меєс, розд. 49, члени до 0,00017 доби. */
function truePhase(k) {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const jde = EPOCH_JDE + SYNODIC * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;
  const full = Math.abs(k % 1) > 0.25;
  const c = full
    ? [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209]
    : [-0.4072, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208];
  const corr = c[0] * sin(Mp) + c[1] * E * sin(M) + c[2] * sin(2 * Mp) + c[3] * sin(2 * F)
    + c[4] * E * sin(Mp - M) + c[5] * E * sin(Mp + M) + c[6] * E * E * sin(2 * M)
    - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M)
    - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F)
    - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(Om);
  // JDE — земний час; до всесвітнього (UTC) віднімаємо ΔT ≈ 69 с (оцінка на 2020-ті)
  return jde + corr - 69 / 86400;
}

/** Освітлена частка диска 0…1 за фазовим кутом (Меєс, розд. 48, спрощено; похибка < 0,5 %). */
function illumination(jd) {
  const T = (jd - 2451545) / 36525;
  const D = 297.8501921 + 445267.1114034 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T;
  const i = 180 - D - 6.289 * sin(Mp) + 2.1 * sin(M) - 1.274 * sin(2 * D - Mp)
    - 0.658 * sin(2 * D) - 0.214 * sin(2 * Mp) - 0.11 * sin(D);
  return (1 + Math.cos(i * RAD)) / 2;
}

const NAMES = [
  ['🌑', 'Молодик'], ['🌒', 'Зростаючий серп'], ['🌓', 'Перша чверть'], ['🌔', 'Зростаючий місяць'],
  ['🌕', 'Повня'], ['🌖', 'Спадний місяць'], ['🌗', 'Остання чверть'], ['🌘', 'Спадний серп']
];

/**
 * Стан Місяця на момент date.
 * → { icon, name, illum (0…100, ціле), age (доби від молодика), waxing, next: { kind, name, date } }
 * Молодик і повня — у межах доби від справжньої миті; чверті — у межах доби від ¼ і ¾ циклу.
 */
export function moonPhase(date = new Date()) {
  const jd = toJd(date);
  let k = Math.floor((jd - EPOCH_JDE) / SYNODIC);
  while (truePhase(k) > jd) k -= 1;
  while (truePhase(k + 1) <= jd) k += 1;
  const prevNew = truePhase(k), nextNew = truePhase(k + 1), full = truePhase(k + 0.5);
  const len = nextNew - prevNew, age = jd - prevNew, frac = age / len;
  const near = (a, b) => Math.abs(a - b) < 1;
  let idx;
  if (near(jd, prevNew) || near(jd, nextNew)) idx = 0;
  else if (near(jd, full)) idx = 4;
  else if (Math.abs(frac - 0.25) * len < 1) idx = 2;
  else if (Math.abs(frac - 0.75) * len < 1) idx = 6;
  else if (jd < full) idx = frac < 0.25 ? 1 : 3;
  else idx = frac < 0.75 ? 5 : 7;
  const waxing = jd < full;
  // Найближча подія попереду: на зростанні — повня, на спаданні — молодик
  const nextFull = jd < full ? full : truePhase(k + 1.5);
  const next = waxing
    ? { kind: 'full', name: 'повня', date: fromJd(nextFull) }
    : { kind: 'new', name: 'молодик', date: fromJd(nextNew) };
  return {
    icon: NAMES[idx][0], name: NAMES[idx][1],
    illum: Math.round(illumination(jd) * 100), age, waxing, next,
    newMoon: fromJd(prevNew), fullMoon: fromJd(nextFull), nextNewMoon: fromJd(nextNew)
  };
}
