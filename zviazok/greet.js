/**
 * Звук входу в голосову кімнату (17.11.2026, вимога користувача) — для рушія ./voice.js, тобто для всіх
 * голосових кімнат порталу: кімната відділу («Справи», кабінет) і «Чат департаменту».
 *
 * Два варіанти:
 *  1) ПЕРШИЙ вхід за день — привітання на ім'я: «Вітаємо пані Олену!» / «Вітаємо пана Олега!»
 *     (../assets/greet/<ім'я>.mp3, ElevenLabs v4, голос Dmytro). Чи вхід перший, знає вкладка того, хто
 *     заходить (localStorage), і передає в присутності полем hi = дата; решта кімнати лише читає його.
 *  2) Решта входів — мелодійний дзвінок (../assets/greet/chime.mp3, ElevenLabs Sound Effects).
 * Керівництво департаменту (director, deputy_director) вітаємо на ім'я на КОЖЕН вхід (не частіше ніж раз
 * на 10 хв) — так було з першої версії «Дверей відділів».
 *
 * Записано лише імена співробітників департаменту (profiles, 17.11.2026). Новий колега — нове ім'я:
 * озвучити тим самим голосом і дописати рядок у NAMES. Імені немає в списку — звучить дзвінок.
 */

const V = '20261117a';
const DIR = new URL('../assets/greet/', import.meta.url).href;
const LS_HI = 'pmg-voice-hi';
export const ALWAYS = ['director', 'deputy_director'];   // вітаємо на кожен вхід

// Ім'я (як у профілі) → файл і текст привітання (знахідний відмінок: «вітаємо кого?»)
const NAMES = {
  'Світлана': ['svitlana', 'Вітаємо пані Світлану!'],
  'Альбіна': ['albina', 'Вітаємо пані Альбіну!'],
  'Анастасія': ['anastasiia', 'Вітаємо пані Анастасію!'],
  'Анна': ['anna', 'Вітаємо пані Анну!'],
  'Ірина': ['iryna', 'Вітаємо пані Ірину!'],
  'Оксана': ['oksana', 'Вітаємо пані Оксану!'],
  'Вікторія': ['viktoriia', 'Вітаємо пані Вікторію!'],
  'Наталія': ['nataliia', 'Вітаємо пані Наталію!'],
  'Юлія': ['yuliia', 'Вітаємо пані Юлію!'],
  'Марина': ['maryna', 'Вітаємо пані Марину!'],
  'Олена': ['olena', 'Вітаємо пані Олену!'],
  'Інна': ['inna', 'Вітаємо пані Інну!'],
  'Костянтин': ['kostiantyn', 'Вітаємо пана Костянтина!'],
  'Євгеній': ['yevhenii', 'Вітаємо пана Євгенія!'],
  'Олег': ['oleh', 'Вітаємо пана Олега!'],
  'Михайло': ['mykhailo', 'Вітаємо пана Михайла!'],
  'Сергій': ['serhii', 'Вітаємо пана Сергія!'],
  'Володимир': ['volodymyr', 'Вітаємо пана Володимира!'],
  'Микола': ['mykola', 'Вітаємо пана Миколу!']
};

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, val) => { try { localStorage.setItem(k, val); } catch (_) { /* приватний режим */ } };

/** Сьогоднішня дата за Києвом: 'YYYY-MM-DD'. */
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });

/**
 * Привітання для імені з профілю. Ім'я шукаємо серед слів: у профілях буває і «Ім'я Прізвище»,
 * і «Прізвище Ім'я». Немає запису — null.
 */
export function greetFor(fullName) {
  for (const w of String(fullName || '').split(/\s+/)) {
    const g = NAMES[w];
    if (g) return { src: `${DIR}${g[0]}.mp3?v=${V}`, text: g[1] };
  }
  return null;
}

/** Мій перший вхід у голосову кімнату сьогодні? Відповідає «так» один раз на день у цьому браузері. */
export function firstEntryToday() {
  const t = today();
  if (lsGet(LS_HI) === t) return false;
  lsSet(LS_HI, t);
  return true;
}

const cache = new Map();
/** Програти запис. Повертає Promise: відхилено — браузер не дав грати (без жесту) або файла немає. */
export function playClip(src, vol = 0.9) {
  let a = cache.get(src);
  if (!a) { a = new Audio(src); a.preload = 'auto'; cache.set(src, a); }
  a.volume = vol;
  try { a.currentTime = 0; } catch (_) { /* ще не завантажено */ }
  return a.play();
}

export const CHIME = `${DIR}chime.mp3?v=${V}`;

/** Підвантажити дзвінок заздалегідь, щоб перший раз не запізнювався. */
export function preloadChime() {
  if (!cache.has(CHIME)) { const a = new Audio(CHIME); a.preload = 'auto'; cache.set(CHIME, a); }
}
