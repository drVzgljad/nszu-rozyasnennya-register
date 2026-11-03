-- ============================================================
-- «Справи відділу», етап 2 · 03.11.2026
--   1) справа → напрям (parent_id): лист, завдання чи захід у межах напряму;
--   2) віхи напряму (milestones, jsonb): [{ id, title, due, done }];
--   3) захід → планувальник виконавця (planner_events.case_id), тригером бази —
--      тож подія з'являється і тоді, коли справу заводить Claude через SQL.
-- ============================================================

ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS parent_id UUID
  REFERENCES public.dept_cases(id) ON DELETE SET NULL;
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS milestones JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS dept_cases_parent_idx ON public.dept_cases (parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE public.planner_events ADD COLUMN IF NOT EXISTS case_id UUID
  REFERENCES public.dept_cases(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS planner_events_case_user_uidx
  ON public.planner_events (case_id, user_id) WHERE case_id IS NOT NULL;

-- Захід зі справ → подія в планувальнику виконавця. Без дати чи виконавця — подію знімаємо;
-- виконавець змінився — подія переходить до нового. «Відбувся» / «Підсумки внесено» = виконано.
-- Скасовану людиною подію не «воскрешаємо».
CREATE OR REPLACE FUNCTION public.dept_case_event_to_planner()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local TIMESTAMP;
  v_link TEXT;
  v_desc TEXT;
BEGIN
  IF NEW.case_kind IS DISTINCT FROM 'event' OR NEW.event_at IS NULL OR NEW.executor_id IS NULL THEN
    DELETE FROM public.planner_events WHERE case_id = NEW.id;
    RETURN NEW;
  END IF;

  DELETE FROM public.planner_events WHERE case_id = NEW.id AND user_id <> NEW.executor_id;

  v_local := NEW.event_at AT TIME ZONE 'Europe/Kyiv';
  v_link := CASE WHEN NEW.event_place ~* '^https?://' THEN NEW.event_place END;
  v_desc := NULLIF(concat_ws(' · ',
              CASE WHEN v_link IS NULL THEN NEW.event_place END,
              NEW.correspondent,
              'Справи відділу: захід'), '');

  INSERT INTO public.planner_events
    (user_id, user_name, creator_name, title, description, event_date, start_time, status, meeting_link, case_id)
  VALUES
    (NEW.executor_id, NEW.executor_name, 'Справи відділу', NEW.subject, v_desc,
     v_local::date, v_local::time,
     CASE WHEN NEW.stage IN ('review', 'done') THEN 'done' ELSE 'planned' END,
     v_link, NEW.id)
  ON CONFLICT (case_id, user_id) WHERE case_id IS NOT NULL DO UPDATE SET
    title        = EXCLUDED.title,
    user_name    = EXCLUDED.user_name,
    description  = EXCLUDED.description,
    event_date   = EXCLUDED.event_date,
    start_time   = EXCLUDED.start_time,
    meeting_link = EXCLUDED.meeting_link,
    status       = CASE WHEN public.planner_events.status = 'cancelled' THEN 'cancelled' ELSE EXCLUDED.status END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dept_case_event_to_planner ON public.dept_cases;
CREATE TRIGGER trg_dept_case_event_to_planner
  AFTER INSERT OR UPDATE OF case_kind, event_at, event_place, executor_id, executor_name, subject, stage, correspondent
  ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_case_event_to_planner();

-- Перевірка: select column_name from information_schema.columns
--   where (table_name = 'dept_cases' and column_name in ('parent_id', 'milestones'))
--      or (table_name = 'planner_events' and column_name = 'case_id');   -- 3 рядки
