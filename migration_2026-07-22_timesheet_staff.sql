-- ============================================================
-- Міграція: кадровий довідник табеля обліку робочого часу
-- (timesheet_staff) для формування Excel-табелів бухгалтерії
-- Дата: 2026-07-22
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.timesheet_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Який табель: 'department' — Департамент стратегії (загальний),
  -- 'fin' — управління фінансово-аналітичного забезпечення (окрема декларація)
  sheet TEXT NOT NULL DEFAULT 'department' CHECK (sheet IN ('department', 'fin')),

  -- Порядок рядка у табелі
  sort_order INT NOT NULL DEFAULT 100,

  -- Назва структурного підрозділу (рядок-заголовок групи у табелі);
  -- NULL — працівник іде одразу під рядком департаменту (директор)
  unit TEXT,

  tabel_no INT,                                   -- табельний номер
  gender TEXT CHECK (gender IN ('Ч', 'Ж')),       -- стать
  full_name TEXT NOT NULL,                        -- Прізвище Ім'я По батькові
  "position" TEXT NOT NULL,                       -- посада (лапки: reserved word у Postgres)

  -- Прив'язка до зареєстрованого користувача сайту (для автозаповнення
  -- кодів зі статусів присутності). NULL — автопошук за прізвищем.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  note TEXT,          -- примітка (колонка приміток табеля, напр. № наказу)
  active BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON TABLE public.timesheet_staff IS
  'Кадровий довідник для табелів обліку робочого часу (бухгалтерія). Редагують координатор/адмін на вкладці Статус присутності.';

CREATE INDEX IF NOT EXISTS idx_timesheet_staff_sheet_order
  ON public.timesheet_staff(sheet, sort_order);

ALTER TABLE public.timesheet_staff ENABLE ROW LEVEL SECURITY;

-- Читання: всі автентифіковані (потрібно для формування табеля)
DROP POLICY IF EXISTS "timesheet_staff_select" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_select" ON public.timesheet_staff
  FOR SELECT TO authenticated
  USING (true);

-- Зміни: лише координатор/адмін
DROP POLICY IF EXISTS "timesheet_staff_insert" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_insert" ON public.timesheet_staff
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('full', 'deputy_director', 'director', 'admin')
  ));

DROP POLICY IF EXISTS "timesheet_staff_update" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_update" ON public.timesheet_staff
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('full', 'deputy_director', 'director', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('full', 'deputy_director', 'director', 'admin')
  ));

DROP POLICY IF EXISTS "timesheet_staff_delete" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_delete" ON public.timesheet_staff
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('full', 'deputy_director', 'director', 'admin')
  ));

-- ── Наповнення ──────────────────────────────────────────────
-- Штат (ПІБ, табельні номери, номери наказів) свідомо НЕ зберігається
-- в репозиторії: він публічний. Сід лежить локально:
-- 05_Веб_реєстр/_seeds_local/seed_timesheet_staff.sql
-- Далі штат ведеться через «Штат табеля» на вкладці Статус присутності.
