-- ============================================================
-- Міграція: контакти ФОП (email, адреса реєстрації) — під RLS
-- Таблиця provider_private
-- Дата: 2026-09-13
-- Застосувати в Supabase SQL Editor (проєкт qdqtkvyvhtjgxpxnvblk).
--
-- Навіщо: email і адреса реєстрації фізичної особи-підприємця — персональні
-- дані (адреса реєстрації ФОП — здебільшого домашня; частина email — особисті
-- скриньки й номери телефонів). Репозиторій сайту публічний, тому з 13.09.2026
-- ці поля не публікуються в data/contracts*.json, а лежать тут.
-- ПІБ і місця надання послуг лишаються публічними — як у відкритих даних НСЗУ.
--
-- Ключ — pkey з реєстру договорів («ФОП:<ПІБ>»). Внутрішній код ФОП (РНОКПП)
-- сюди НЕ потрапляє: для підрахунків він не потрібен, а для сторінок — тим паче.
--
-- Дані заливає zoz-dogovr/upload_provider_private.py
-- з _seeds_local/provider_private.json (його пише build_contracts_data.py).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_private (
  pkey TEXT PRIMARY KEY,
  email TEXT,
  reg_address TEXT,
  source_file TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.provider_private IS
  'Контакти ФОП з реєстру договорів НСЗУ (email, адреса реєстрації) — персональні '
  'дані, тому не в публічних JSON. Показуються в картці договору (zoz-dogovr), '
  'переліку ЗОЗ і паспорті закладу (passport) лише авторизованим.';

ALTER TABLE public.provider_private ENABLE ROW LEVEL SECURITY;

-- ── SELECT: усі авторизовані, крім гостей (та сама межа, що в package_provider_volumes) ──
DROP POLICY IF EXISTS "pp_select" ON public.provider_private;
CREATE POLICY "pp_select" ON public.provider_private
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role <> 'guest'
    )
  );

-- ── INSERT / UPDATE / DELETE: лише керівництво (заливає скрипт) ──
DROP POLICY IF EXISTS "pp_insert" ON public.provider_private;
CREATE POLICY "pp_insert" ON public.provider_private
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  );

DROP POLICY IF EXISTS "pp_update" ON public.provider_private;
CREATE POLICY "pp_update" ON public.provider_private
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  );

DROP POLICY IF EXISTS "pp_delete" ON public.provider_private;
CREATE POLICY "pp_delete" ON public.provider_private
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  );
