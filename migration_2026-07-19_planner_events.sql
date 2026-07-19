-- ============================================================
-- Міграція: планувальник особистого кабінету (planner_events)
-- Дата: 2026-07-19
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.planner_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Чий це план (календар співробітника)
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT,

  -- Хто створив запис (сам співробітник або керівник)
  creator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  creator_name TEXT,

  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,

  -- planned → done / cancelled
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
  done_at TIMESTAMPTZ,

  -- Зв'язок із дорученням (якщо запис породжений дорученням)
  task_id UUID REFERENCES public.assigned_tasks(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.planner_events IS
  'Планувальник кабінету: записи планів співробітників (день/тиждень/місяць/рік). Створювати може сам співробітник або керівник (manager+).';

CREATE INDEX IF NOT EXISTS idx_planner_events_user_date
  ON public.planner_events(user_id, event_date);
CREATE INDEX IF NOT EXISTS idx_planner_events_task
  ON public.planner_events(task_id);

ALTER TABLE public.planner_events ENABLE ROW LEVEL SECURITY;

-- Читання: всі автентифіковані (керівники бачать плани підлеглих,
-- колеги можуть звірити зайнятість)
DROP POLICY IF EXISTS "planner_select" ON public.planner_events;
CREATE POLICY "planner_select" ON public.planner_events
  FOR SELECT TO authenticated
  USING (true);

-- Створення: собі — будь-хто, крім гостя; іншим — лише керівні ролі
DROP POLICY IF EXISTS "planner_insert" ON public.planner_events;
CREATE POLICY "planner_insert" ON public.planner_events
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role <> 'guest'
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('manager', 'deputy_director', 'director', 'admin')
    )
  );

-- Оновлення: власник плану, автор запису або керівні ролі
DROP POLICY IF EXISTS "planner_update" ON public.planner_events;
CREATE POLICY "planner_update" ON public.planner_events
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR auth.uid() = creator_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('manager', 'deputy_director', 'director', 'admin')
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR auth.uid() = creator_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('manager', 'deputy_director', 'director', 'admin')
    )
  );

-- Видалення: ті самі, що й оновлення
DROP POLICY IF EXISTS "planner_delete" ON public.planner_events;
CREATE POLICY "planner_delete" ON public.planner_events
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR auth.uid() = creator_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('manager', 'deputy_director', 'director', 'admin')
    )
  );

-- Realtime-оновлення планів
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.planner_events;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
