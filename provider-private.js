/**
 * Контакти ФОП (email, адреса реєстрації) — для авторизованих.
 *
 * З 13.09.2026 ці поля не публікуються в data/contracts*.json: це персональні
 * дані фізичних осіб-підприємців, а репозиторій сайту публічний. Вони лежать у
 * Supabase (таблиця provider_private, RLS «роль не guest»), ключ — pkey договору.
 * Внутрішнього коду ФОП (РНОКПП) там немає.
 *
 * Модуль нічого не малює: віддає сторінкам (zoz-dogovr, passport) контакти за
 * ключем і пояснення, чому їх немає. Клієнт — спільний window.__pmgSb з auth-v2.js.
 *
 *   ProviderPrivate.isFop(contract)       → true для ФОП
 *   await ProviderPrivate.get(pkey)       → {status, email, reg_address}
 *   await ProviderPrivate.loadAll()       → {status, map: Map(pkey → {email, reg_address})}
 *   ProviderPrivate.message(status)       → текст для клітинки, коли контактів не показуємо
 *
 * status: "ok" · "guest" (не увійшов або роль гість) · "missing" (таблиці ще
 * немає або контакти не залиті) · "error".
 */
(() => {
  "use strict";

  const byKey = new Map();
  let allPromise = null;

  const isFop = (c) => String((c && c.ownership) || "").trim() === "ФОП";

  async function client() {
    // auth-v2.js — модуль і може підвантажитися пізніше за класичні скрипти
    for (let i = 0; i < 30 && !window.__pmgSb; i++) await new Promise((r) => setTimeout(r, 150));
    return window.__pmgSb || null;
  }

  async function session(sb) {
    try {
      const { data } = await sb.auth.getSession();
      return data && data.session ? data.session : null;
    } catch (e) {
      return null;
    }
  }

  const MISSING = /relation .* does not exist|could not find the table|PGRST205|42P01/i;

  async function get(pkey) {
    if (!pkey) return { status: "missing" };
    if (byKey.has(pkey)) return byKey.get(pkey);
    const sb = await client();
    if (!sb || !(await session(sb))) return { status: "guest" };
    let res;
    try {
      const { data, error } = await sb.from("provider_private")
        .select("email,reg_address").eq("pkey", pkey).maybeSingle();
      if (error) throw error;
      // RLS для ролі «гість» повертає порожньо, а не помилку
      res = data ? { status: "ok", email: data.email || "", reg_address: data.reg_address || "" } : { status: "missing" };
    } catch (e) {
      res = { status: MISSING.test(String(e.message || e.code || e)) ? "missing" : "error" };
      if (res.status === "error") console.warn("Контакти ФОП недоступні:", e.message || e);
    }
    byKey.set(pkey, res);
    return res;
  }

  /** Усі контакти одним заходом — для таблиць і Excel (≈2,5 тис. рядків). */
  function loadAll() {
    if (allPromise) return allPromise;
    allPromise = (async () => {
      const sb = await client();
      if (!sb || !(await session(sb))) return { status: "guest", map: new Map() };
      const map = new Map();
      try {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await sb.from("provider_private")
            .select("pkey,email,reg_address").order("pkey").range(from, from + 999);
          if (error) throw error;
          (data || []).forEach((r) => map.set(r.pkey, { email: r.email || "", reg_address: r.reg_address || "" }));
          if (!data || data.length < 1000) break;
        }
        return { status: map.size ? "ok" : "missing", map };
      } catch (e) {
        const status = MISSING.test(String(e.message || e.code || e)) ? "missing" : "error";
        if (status === "error") console.warn("Контакти ФОП недоступні:", e.message || e);
        return { status, map };
      }
    })();
    return allPromise;
  }

  function message(status) {
    if (status === "guest") return "контакти ФОП — після входу";
    if (status === "missing") return "контакти ФОП ще не перенесено в базу";
    if (status === "error") return "контакти ФОП недоступні";
    return "—";
  }

  // Вхід або вихід без перезавантаження — скидаємо кеш
  (async () => {
    const sb = await client();
    if (sb && sb.auth) sb.auth.onAuthStateChange(() => {
      byKey.clear();
      allPromise = null;
      window.dispatchEvent(new Event("provider-private-reset"));   // сторінки перемальовують контакти
    });
  })();

  window.ProviderPrivate = { isFop, get, loadAll, message };
})();
