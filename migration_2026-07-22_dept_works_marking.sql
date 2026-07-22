-- ============================================================
-- Доповнення: маркування документів РпВ
-- Основний / Базовий / Допоміжний
-- Дата: 2026-07-22
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт). Ідемпотентно.
-- ============================================================

ALTER TABLE public.dept_works
  ADD COLUMN IF NOT EXISTS marking TEXT;

DO $$
BEGIN
  ALTER TABLE public.dept_works
    ADD CONSTRAINT dept_works_marking_check
    CHECK (marking IN ('main', 'base', 'aux'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMENT ON COLUMN public.dept_works.marking IS
  'Маркування важливості документа: main — основний, base — базовий, aux — допоміжний.';
