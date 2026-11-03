-- ============================================================
-- № проєкту відповіді в АСКОД (Н(СЛ)-…) у справі й у записі СКО-Д
-- 03.11.2026 · «Справи відділу» + кабінет («Внести виконану роботу»)
--
-- Між вхідним (in_no) і вихідним (out_no) номером є третій — проєкт відповіді,
-- який виконавець заводить в АСКОД і веде на погодження. Користувач: «це
-- важливо». Номер вносять у картці справи або у формі кабінету — і там, і там
-- він пишеться в dept_cases.project_no; запис СКО-Д зберігає його копію.
-- Зміна номера потрапляє в історію справи (тригер нижче), як етап і версія.
-- ============================================================

ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS project_no TEXT;
ALTER TABLE public.skod_logs  ADD COLUMN IF NOT EXISTS project_no TEXT;

CREATE OR REPLACE FUNCTION public.dept_case_project_log()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_no IS DISTINCT FROM OLD.project_no AND coalesce(NEW.project_no, '') <> '' THEN
    INSERT INTO public.dept_case_events (case_id, author_name, kind, body)
    VALUES (NEW.id, coalesce(NEW.updated_by_name, 'Система'), 'system',
            'Проєкт відповіді в АСКОД: № ' || NEW.project_no);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dept_case_project_log ON public.dept_cases;
CREATE TRIGGER dept_case_project_log
  AFTER UPDATE OF project_no ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_case_project_log();

-- Перевірка: select column_name from information_schema.columns
--   where table_name in ('dept_cases','skod_logs') and column_name = 'project_no';   -- 2 рядки
