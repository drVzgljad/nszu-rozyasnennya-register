-- ============================================================
-- Міграція: посилання на зустріч + зв'язок події планувальника
--           зі звітом Форми 37-Д
-- Дата: 2026-07-23
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
-- Ідемпотентна: можна виконувати повторно.
-- ============================================================

-- Окреме пряме посилання на онлайн-зустріч (Zoom / Google Meet / Teams)
ALTER TABLE public.planner_events
  ADD COLUMN IF NOT EXISTS meeting_link TEXT;

-- Зв'язок із записом СКО-Д, який потрапив у звіт 37-Д.
-- Потрібен, щоб не дублювати подію при повторному збереженні
-- і показувати бейдж «У звіті 37-Д».
ALTER TABLE public.planner_events
  ADD COLUMN IF NOT EXISTS report_log_id UUID
    REFERENCES public.skod_logs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.planner_events.meeting_link IS
  'Пряме посилання на онлайн-зустріч (Zoom/Meet/Teams).';
COMMENT ON COLUMN public.planner_events.report_log_id IS
  'skod_logs.id, якщо подію включено до звіту Форми 37-Д (інакше NULL).';
