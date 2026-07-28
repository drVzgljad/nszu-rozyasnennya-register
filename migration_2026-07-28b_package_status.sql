-- ============================================================
-- Міграція: статус чинності пакета в розподілі відповідальності
-- Додає package_assignments.status ('active' / 'ended')
-- Дата: 2026-07-28
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
--
-- Навіщо: у матриці розподілу не було поняття «напрям більше не
-- закуповується». Через це пакет № 73 (розширена ПМД ветеранам)
-- виглядав як живий, хоча ПКМУ № 140 діяла у 2025 році, договори
-- укладалися до 01.12.2025, а акта на 2026 рік немає.
-- ============================================================

ALTER TABLE public.package_assignments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  ALTER TABLE public.package_assignments
    ADD CONSTRAINT package_assignments_status_check
    CHECK (status IN ('active', 'ended'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMENT ON COLUMN public.package_assignments.status IS
  'active — пакет закуповується у 2026 році; ended — напрям завершено (не продовжено на 2026). Джерело істини по пілотах — розділ pilots/.';

-- Необов'язкова примітка до статусу (показується підказкою в розподілі)
ALTER TABLE public.package_assignments
  ADD COLUMN IF NOT EXISTS status_note TEXT;

-- ── Поточний стан: єдиний завершений напрям — пілот № 73 ──
UPDATE public.package_assignments
SET status = 'ended',
    status_note = 'Експериментальний проєкт за ПКМУ № 140 від 04.02.2025 діяв у 2025 році: договори укладалися до 01.12.2025. Акта на 2026 рік немає, оголошень НСЗУ про контрактування у 2026 році теж.'
WHERE num = '73' AND pilot = true;

-- Решта рядків лишаються 'active' за замовчуванням.
