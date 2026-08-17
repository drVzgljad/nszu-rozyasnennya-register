-- ============================================================
-- Міграція: Алгоритм визначення належності медичних послуг до пакетів
-- Таблиці pmg_rules / pmg_rule_dicts / pmg_rule_refs + RLS
-- Дата: 2026-08-17
-- Застосувати в Supabase SQL Editor (проєкт rpe-pmg).
--
-- УВАГА. Сама матриця правил — внутрішній документ НСЗУ, і в цьому файлі її
-- НЕМАЄ: міграція створює лише порожні таблиці й політики доступу. Дані
-- заливає окремий локальний завантажувач (20_кодування/upload_algorytm_supabase.py),
-- який читає джерело з робочої теки і пише під сесією користувача. Через це
-- вміст не потрапляє ні в цей файл, ні в публічний репозиторій деплою.
--
-- Доступ на читання — лише авторизованим, крім гостей: сторінка розділу
-- «Кодування» тягне ці дані запитом із сесією, тож RLS тут і є справжнім
-- замком, на відміну від json-файлів, які віддаються будь-кому.
-- ============================================================

-- ── 1. Правила: рядок = одна комбінація умов для послуги пакета ──
CREATE TABLE IF NOT EXISTS public.pmg_rules (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  pkg          TEXT NOT NULL,          -- код пакету
  service_code TEXT,                   -- код послуги в межах пакета (5.1, 6.2 …)
  service_name TEXT,
  class        TEXT,                   -- INPATIENT / AMB / PHC

  -- Решта умов епізоду як є: ключ — назва поля ЕСОЗ, значення — або пряме
  -- значення («так», «INPATIENT»), або номер вкладки словника з pmg_rule_dicts.
  -- Тримаємо в jsonb, бо набір умов у документі змінюється від редакції до
  -- редакції, а розкладати 30 колонок наперед — гарантовано щось загубити.
  cond         JSONB NOT NULL DEFAULT '{}'::jsonb,

  sort_order   INT NOT NULL DEFAULT 0,
  src_rev      TEXT                     -- редакція джерела, з якої залито
);

COMMENT ON TABLE public.pmg_rules IS
  'Алгоритм дій щодо визначення належності медичних послуг до пакетів, Таблиця 1. Внутрішній документ — доступ лише авторизованим.';
COMMENT ON COLUMN public.pmg_rules.cond IS
  'Умови епізоду: {поле ЕСОЗ: значення або номер вкладки словника}.';

CREATE INDEX IF NOT EXISTS pmg_rules_pkg_idx ON public.pmg_rules (pkg);
CREATE INDEX IF NOT EXISTS pmg_rules_cond_idx ON public.pmg_rules USING GIN (cond);

-- ── 2. Словники значень до умов ──
CREATE TABLE IF NOT EXISTS public.pmg_rule_dicts (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  dict       TEXT NOT NULL,   -- назва поля ЕСОЗ (principal_diagnosis, adrg …)
  tab        TEXT NOT NULL,   -- номер вкладки, на яку посилається правило
  code       TEXT,
  name       TEXT,
  min_bound  TEXT,
  max_bound  TEXT,
  comment    TEXT,
  year       TEXT,
  src_rev    TEXT
);

COMMENT ON TABLE public.pmg_rule_dicts IS
  'Той самий Додаток 2, Таблиця 2: значення, на які посилаються умови правил.';

CREATE INDEX IF NOT EXISTS pmg_rule_dicts_key_idx ON public.pmg_rule_dicts (dict, tab);
CREATE INDEX IF NOT EXISTS pmg_rule_dicts_code_idx ON public.pmg_rule_dicts (code);

-- ── 3. Додаткові переліки (таблиці 3–6) ──
CREATE TABLE IF NOT EXISTS public.pmg_rule_refs (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  kind       TEXT NOT NULL,   -- rehab_services | drg | rehab_dx | rehab_iv | lab_tests
  grp        TEXT,            -- група/розділ переліку
  code       TEXT,
  name       TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  src_rev    TEXT
);

COMMENT ON TABLE public.pmg_rule_refs IS
  'Додаток 2, таблиці 3–6: реабілітаційні послуги, ДСГ, діагнози й інтервенції реабілітації, лабораторні дослідження.';

CREATE INDEX IF NOT EXISTS pmg_rule_refs_kind_idx ON public.pmg_rule_refs (kind);

-- ── RLS ──
ALTER TABLE public.pmg_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pmg_rule_dicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pmg_rule_refs  ENABLE ROW LEVEL SECURITY;

-- Читання: будь-який авторизований користувач порталу, крім гостей.
-- Запис: лише керівництво — заливання й оновлення редакції документа.

DROP POLICY IF EXISTS "pmg_rules_select" ON public.pmg_rules;
CREATE POLICY "pmg_rules_select" ON public.pmg_rules
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.role <> 'guest'));

DROP POLICY IF EXISTS "pmg_rules_write" ON public.pmg_rules;
CREATE POLICY "pmg_rules_write" ON public.pmg_rules
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid()
                   AND (p.role IN ('admin','director','deputy_director','manager')
                        OR p.is_head = true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = auth.uid()
                        AND (p.role IN ('admin','director','deputy_director','manager')
                             OR p.is_head = true)));

DROP POLICY IF EXISTS "pmg_rule_dicts_select" ON public.pmg_rule_dicts;
CREATE POLICY "pmg_rule_dicts_select" ON public.pmg_rule_dicts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.role <> 'guest'));

DROP POLICY IF EXISTS "pmg_rule_dicts_write" ON public.pmg_rule_dicts;
CREATE POLICY "pmg_rule_dicts_write" ON public.pmg_rule_dicts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid()
                   AND (p.role IN ('admin','director','deputy_director','manager')
                        OR p.is_head = true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = auth.uid()
                        AND (p.role IN ('admin','director','deputy_director','manager')
                             OR p.is_head = true)));

DROP POLICY IF EXISTS "pmg_rule_refs_select" ON public.pmg_rule_refs;
CREATE POLICY "pmg_rule_refs_select" ON public.pmg_rule_refs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.role <> 'guest'));

DROP POLICY IF EXISTS "pmg_rule_refs_write" ON public.pmg_rule_refs;
CREATE POLICY "pmg_rule_refs_write" ON public.pmg_rule_refs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid()
                   AND (p.role IN ('admin','director','deputy_director','manager')
                        OR p.is_head = true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = auth.uid()
                        AND (p.role IN ('admin','director','deputy_director','manager')
                             OR p.is_head = true)));

-- Перевірка після застосування:
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('pmg_rules','pmg_rule_dicts','pmg_rule_refs');
--   -- має бути true в усіх трьох
