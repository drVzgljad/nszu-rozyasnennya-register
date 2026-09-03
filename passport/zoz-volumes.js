/**
 * Фактичні обсяги в розрізі надавачів — колонка «Послуг» у переліку ЗОЗ
 * паспорта пакета (і в Excel-вивантаженні блоку «Перетин мереж»).
 *
 * Чому окремо від volumes.js і не файлом у репозиторії: агрегати по областях
 * і послугах публічні, а обсяг КОНКРЕТНОГО закладу — внутрішні аналітичні
 * дані. Репозиторій публічний, тому цей розріз лежить у Supabase під RLS
 * (таблиця package_provider_volumes) і видний лише авторизованим.
 *
 * Модуль нічого не малює — лише віддає passport.js готову мапу
 * «ключ надавача → обсяг».
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qdqtkvyvhtjgxpxnvblk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YXDm02hDBzLQmsUuVnZ_Og_IxQ60VCz';
const sb = (window.__pmgSb || (window.__pmgSb = createClient(SUPABASE_URL, SUPABASE_KEY)));

const PAGE = 1000;              // PostgREST за замовчуванням не віддає більше
const cache = new Map();        // пакет -> { map, total, period } | null

/* Ключ надавача. Для юросіб — ЄДРПОУ. Для ФОП у вивантажці ЕСОЗ замість коду
   стоїть літерал «ФОП», а в реєстрі договорів — справжній РНОКПП, тому
   зшиваємо за ПІБ. Нормалізація має бути ОДНАКОВОЮ тут і в build_volumes.py,
   інакше половина ФОП не знайде себе. */
export function providerKey(contract) {
  return contract.ownership === 'ФОП'
    ? normName(contract.provider_name)
    : String(contract.edrpou || '');
}

function normName(s) {
  return String(s || '').replace(/[’`]/g, "'").toUpperCase().split(/\s+/)
    .filter(Boolean).join(' ');
}

/** Чи є жива сесія — без неї RLS поверне порожньо, і питати базу марно. */
async function signedIn() {
  try {
    const { data } = await sb.auth.getSession();
    return Boolean(data && data.session);
  } catch (e) {
    return false;
  }
}

/**
 * Обсяги за пакетом. Повертає null, якщо користувач не авторизований або
 * таблиці ще немає, — сторінка від цього не ламається, колонка просто
 * показує прочерки.
 */
export async function load(pkgNum) {
  if (cache.has(pkgNum)) return cache.get(pkgNum);
  let res = null;
  try {
    if (!(await signedIn())) {
      cache.set(pkgNum, null);
      return null;
    }
    const map = new Map();
    let from = 0;
    let period = null;
    // Мережа великого пакета — понад тисячу закладів, тому сторінками
    for (;;) {
      const { data, error } = await sb
        .from('package_provider_volumes')
        .select('provider_key,services,emz,period_from,period_to')
        .eq('packet', String(pkgNum))
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      data.forEach((r) => {
        map.set(r.provider_key, { s: r.services || 0, e: r.emz || 0 });
        if (!period && r.period_from) period = { from: r.period_from, to: r.period_to };
      });
      if (data.length < PAGE) break;
      from += PAGE;
    }
    res = map.size
      ? { map, total: [...map.values()].reduce((a, b) => a + b.s, 0), period }
      : null;
  } catch (e) {
    console.warn('Обсяги по ЗОЗ недоступні:', e.message || e);
    res = null;
  }
  cache.set(pkgNum, res);
  return res;
}

// passport.js — класичний скрипт, тому віддаємо йому інтерфейс через window
window.ZozVolumes = { load, providerKey, signedIn };
