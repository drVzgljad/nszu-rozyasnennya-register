-- ============================================================
-- «Справи відділу»: не лише АСКОД — чотири види справ
-- 03.11.2026 · спільне з spravy/spravy.js, cabinet/cabinet.js, tools/spravy_37d.py
--
--   askod   — документ АСКОД (як було): вх. №, проєкт, вих. №, резолюція
--   task    — завдання: усне / Teams-доручення, аналітика на запит
--   event   — захід: нарада, робоча група, зустріч; дата й місце/посилання
--   project — напрям / проєкт: довгий, з віхами
--
-- Етапи в базі ті самі (new · work · review · done; signing і sz_sent — лише
-- для АСКОД), назви — свої для кожного виду. Великий тригер історії
-- (dept_cases_before_update, migration 02b) не чіпаємо: окремий тригер на
-- dept_case_events переписує рядок «етап → етап» назвами виду справи.
-- ============================================================

ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS case_kind TEXT NOT NULL DEFAULT 'askod';
ALTER TABLE public.dept_cases DROP CONSTRAINT IF EXISTS dept_cases_case_kind_check;
ALTER TABLE public.dept_cases ADD CONSTRAINT dept_cases_case_kind_check
  CHECK (case_kind IN ('askod', 'task', 'event', 'project'));
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS event_at TIMESTAMPTZ;   -- захід: коли
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS event_place TEXT;       -- захід: де / посилання
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS assigned_by TEXT;       -- завдання: від кого

-- Наявні справи без вх. № (ініціативні, План Уряду) — завдання
UPDATE public.dept_cases SET case_kind = 'task' WHERE in_no IS NULL AND case_kind = 'askod';

CREATE INDEX IF NOT EXISTS dept_cases_kind_idx ON public.dept_cases (department, case_kind);

-- Назва етапу для виду справи
CREATE OR REPLACE FUNCTION public.dept_cases_stage_label(p TEXT, k TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN k = 'task' THEN CASE p WHEN 'new' THEN 'Нове' WHEN 'work' THEN 'В роботі'
                                WHEN 'review' THEN 'На перевірці' WHEN 'done' THEN 'Готово' ELSE NULL END
    WHEN k = 'event' THEN CASE p WHEN 'new' THEN 'Заплановано' WHEN 'work' THEN 'Підготовка'
                                 WHEN 'review' THEN 'Відбувся' WHEN 'done' THEN 'Підсумки внесено' ELSE NULL END
    WHEN k = 'project' THEN CASE p WHEN 'new' THEN 'Задумано' WHEN 'work' THEN 'В роботі'
                                   WHEN 'review' THEN 'На погодженні' WHEN 'done' THEN 'Завершено' ELSE NULL END
  END;
$$;

-- Рядок історії «етап → етап» — назвами виду справи (для АСКОД нічого не змінюємо)
CREATE OR REPLACE FUNCTION public.dept_case_events_kind_labels()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT;
  v_from TEXT;
  v_to TEXT;
  v_tail TEXT := '';
BEGIN
  IF NEW.kind NOT IN ('stage', 'returned') OR NEW.meta IS NULL OR NOT (NEW.meta ? 'from') THEN
    RETURN NEW;
  END IF;
  SELECT case_kind INTO v_kind FROM public.dept_cases WHERE id = NEW.case_id;
  IF v_kind IS NULL OR v_kind = 'askod' THEN
    RETURN NEW;
  END IF;
  v_from := COALESCE(public.dept_cases_stage_label(NEW.meta->>'from', v_kind), public.dept_cases_stage_label(NEW.meta->>'from'));
  v_to   := COALESCE(public.dept_cases_stage_label(NEW.meta->>'to', v_kind),   public.dept_cases_stage_label(NEW.meta->>'to'));
  IF position(' — ' IN NEW.body) > 0 THEN
    v_tail := substr(NEW.body, position(' — ' IN NEW.body));
  END IF;
  NEW.body := CASE WHEN NEW.kind = 'returned' THEN 'Повернуто: ' ELSE '' END || v_from || ' → ' || v_to || v_tail;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dept_case_events_kind_labels ON public.dept_case_events;
CREATE TRIGGER trg_dept_case_events_kind_labels
  BEFORE INSERT ON public.dept_case_events
  FOR EACH ROW EXECUTE FUNCTION public.dept_case_events_kind_labels();

-- Перевірка: select case_kind, count(*) from dept_cases group by 1;   -- askod / task
