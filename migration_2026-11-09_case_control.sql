-- ============================================================
-- «Справи відділу»: позначка «🎯 На контролі» + контролька департаменту
-- 09.11.2026
--
-- Контролька — xlsx «Контроль ДД.ММ. - ДД.ММ.РРРР», який департамент розсилає
-- щотижня: № документа, зміст, вид, строк, Гол.вик-ць, стан виконання (номер
-- проєкту Н(СЛ)-… і в кого він), примітка («контроль Голови», «подовжено до …»).
-- Користувач: «зроби можливість маркування на проєктах контролі».
--
-- Справа на контролі має позначку на дошці й фільтр «🎯 На контролі». Поставити
-- або зняти позначку можна в картці справи, а позначити справи списком — кнопкою
-- «🎯 Контролька» (spravy/control-upload.js).
-- Тригер пише в історію справи, коли справу поставлено на контроль чи знято з
-- нього і коли змінився стан за контролькою.
-- Ідемпотентна.
-- ============================================================

ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS on_control BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS control_note TEXT;   -- вид контролю / примітка: «контроль Голови», «подовжено до 11.11»
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS control_state TEXT;  -- «Стан виконання» з контрольки: «проєкт Н(СЛ)-26777 на підписі у …»
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS control_lead TEXT;   -- «Гол.вик-ць» з контрольки (прізвище й ініціал)
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS control_list TEXT;   -- з якої контрольки: «Контроль 09.11. - 13.11.2026»

CREATE INDEX IF NOT EXISTS idx_dept_cases_control
  ON public.dept_cases(department) WHERE on_control;

CREATE OR REPLACE FUNCTION public.dept_case_control_log()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  who TEXT := coalesce(NEW.updated_by_name, 'Система');
BEGIN
  IF NEW.on_control IS DISTINCT FROM OLD.on_control THEN
    INSERT INTO public.dept_case_events (case_id, author_name, kind, body)
    VALUES (NEW.id, who, 'system',
            CASE WHEN NEW.on_control
              THEN '🎯 Поставлено на контроль'
                   || coalesce(' — ' || nullif(NEW.control_note, ''), '')
                   || coalesce(' (' || nullif(NEW.control_list, '') || ')', '')
              ELSE '🎯 Знято з контролю' END);
  ELSIF NEW.on_control AND coalesce(NEW.control_state, '') <> ''
        AND NEW.control_state IS DISTINCT FROM OLD.control_state THEN
    INSERT INTO public.dept_case_events (case_id, author_name, kind, body)
    VALUES (NEW.id, who, 'system',
            '🎯 Стан за контролькою: ' || NEW.control_state
            || coalesce(' (' || nullif(NEW.control_list, '') || ')', ''));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dept_case_control_log ON public.dept_cases;
CREATE TRIGGER dept_case_control_log
  AFTER UPDATE OF on_control, control_state ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_case_control_log();

-- Перевірка: select column_name from information_schema.columns
--   where table_name = 'dept_cases' and column_name like '%control%';   -- 5 рядків
