-- ============================================================
-- Міграція: «Справи відділу» — повна історія справи
-- Дата: 2026-11-02 (друга). Застосовувати ПІСЛЯ migration_2026-11-02_dept_cases.sql.
-- Ідемпотентна, дані не чіпає.
--
-- Що додає (вимога користувача 02.11.2026):
--  • головний виконавець справи: хто він (департамент / управління / відділ)
--    і наша роль — головні, співвиконавці чи до відома;
--  • етап «СЗ надано» (робочий порядок) і тип відповіді «СЗ у робочому порядку»;
--  • продовження строку: первинний строк зберігається, кожна зміна строку
--    потрапляє в історію з підставою;
--  • повернення на доопрацювання — окрема подія з причиною;
--  • відправлені документи (листи, службові) — окремі події з № і датою;
--  • нагадування з датою.
-- ============================================================

-- ---------- картка ----------
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS lead_unit TEXT;          -- головний виконавець: «Департамент …», «Управління …», «відділ …»
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS our_role TEXT;           -- lead / co / info
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS deadline_original DATE;  -- первинний строк (до продовжень)
ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS change_note TEXT;        -- підстава останньої зміни; тригер переносить її в історію й очищає

ALTER TABLE public.dept_cases DROP CONSTRAINT IF EXISTS dept_cases_our_role_check;
ALTER TABLE public.dept_cases ADD CONSTRAINT dept_cases_our_role_check
  CHECK (our_role IN ('lead', 'co', 'info'));

ALTER TABLE public.dept_cases DROP CONSTRAINT IF EXISTS dept_cases_stage_check;
ALTER TABLE public.dept_cases ADD CONSTRAINT dept_cases_stage_check
  CHECK (stage IN ('new', 'work', 'review', 'signing', 'sz_sent', 'done'));

ALTER TABLE public.dept_cases DROP CONSTRAINT IF EXISTS dept_cases_reply_kind_check;
ALTER TABLE public.dept_cases ADD CONSTRAINT dept_cases_reply_kind_check
  CHECK (reply_kind IN ('letter', 'sz', 'sz_work', 'pi', 'info', 'other'));

UPDATE public.dept_cases SET deadline_original = deadline
  WHERE deadline_original IS NULL AND deadline IS NOT NULL;

-- ---------- події ----------
ALTER TABLE public.dept_case_events ADD COLUMN IF NOT EXISTS event_date DATE;   -- дата події (СЗ від 28.10), якщо відрізняється від дати запису
ALTER TABLE public.dept_case_events ADD COLUMN IF NOT EXISTS doc_kind TEXT;     -- для outgoing: letter / sz / sz_work / other
ALTER TABLE public.dept_case_events ADD COLUMN IF NOT EXISTS doc_no TEXT;       -- № документа (вихідний, СЗ, лист про продовження)
ALTER TABLE public.dept_case_events ADD COLUMN IF NOT EXISTS addressee TEXT;    -- кому відправлено
ALTER TABLE public.dept_case_events ADD COLUMN IF NOT EXISTS due_date DATE;     -- для reminder — коли нагадати; для deadline — новий строк
ALTER TABLE public.dept_case_events ADD COLUMN IF NOT EXISTS done BOOLEAN;      -- для reminder — виконано

ALTER TABLE public.dept_case_events DROP CONSTRAINT IF EXISTS dept_case_events_kind_check;
ALTER TABLE public.dept_case_events ADD CONSTRAINT dept_case_events_kind_check
  CHECK (kind IN ('comment', 'remark', 'stage', 'version', 'executor', 'review', 'system',
                  'deadline', 'returned', 'outgoing', 'reminder'));

CREATE INDEX IF NOT EXISTS idx_dept_case_events_reminders
  ON public.dept_case_events(due_date) WHERE kind = 'reminder' AND done IS NOT TRUE;


-- ============================================================
-- Тригери. Зміни картки логуються ДО оновлення (BEFORE UPDATE): так тригер
-- бачить підставу зміни (change_note), записує її в історію і очищає поле,
-- щоб вона не причепилася до наступної зміни. Заведення справи — як і раніше,
-- AFTER INSERT (до вставки рядка ще немає, і подія не має на що посилатися).
-- ============================================================

CREATE OR REPLACE FUNCTION public.dept_cases_stage_label(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'new' THEN 'Нове' WHEN 'work' THEN 'Готуємо' WHEN 'review' THEN 'Погодження'
                WHEN 'signing' THEN 'На підписі' WHEN 'sz_sent' THEN 'СЗ надано' WHEN 'done' THEN 'Закрито'
                ELSE p END;
$$;

CREATE OR REPLACE FUNCTION public.dept_cases_stage_rank(p TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT array_position(ARRAY['new', 'work', 'review', 'signing', 'sz_sent', 'done'], p);
$$;

CREATE OR REPLACE FUNCTION public.dept_cases_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author TEXT := COALESCE(NEW.updated_by_name, OLD.updated_by_name, NEW.created_by_name);
  v_note TEXT := NULLIF(btrim(NEW.change_note), '');
  v_tail TEXT := COALESCE(' — ' || NULLIF(btrim(NEW.change_note), ''), '');
BEGIN
  NEW.updated_at := now();

  IF NEW.deadline IS DISTINCT FROM OLD.deadline THEN
    IF NEW.deadline_original IS NULL THEN
      NEW.deadline_original := COALESCE(OLD.deadline, NEW.deadline);
    END IF;
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, due_date, meta)
    VALUES (NEW.id, auth.uid(), v_author, 'deadline',
            'Строк: ' || COALESCE(to_char(OLD.deadline, 'DD.MM.YYYY'), '—') || ' → '
                      || COALESCE(to_char(NEW.deadline, 'DD.MM.YYYY'), '—') || v_tail,
            NEW.deadline, jsonb_build_object('from', OLD.deadline, 'to', NEW.deadline));
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF public.dept_cases_stage_rank(NEW.stage) < public.dept_cases_stage_rank(OLD.stage)
       AND OLD.stage <> 'new' THEN
      INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, meta)
      VALUES (NEW.id, auth.uid(), v_author, 'returned',
              'Повернуто: ' || public.dept_cases_stage_label(OLD.stage) || ' → '
                            || public.dept_cases_stage_label(NEW.stage) || v_tail,
              jsonb_build_object('from', OLD.stage, 'to', NEW.stage));
    ELSE
      INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, meta)
      VALUES (NEW.id, auth.uid(), v_author, 'stage',
              public.dept_cases_stage_label(OLD.stage) || ' → ' || public.dept_cases_stage_label(NEW.stage) || v_tail,
              jsonb_build_object('from', OLD.stage, 'to', NEW.stage));
    END IF;
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version AND NEW.version IS NOT NULL THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, meta)
    VALUES (NEW.id, auth.uid(), v_author, 'version',
            'Чернетка v' || NEW.version || COALESCE(' — ' || NEW.draft_path, ''),
            jsonb_build_object('version', NEW.version));
  END IF;
  IF NEW.executor_name IS DISTINCT FROM OLD.executor_name THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body)
    VALUES (NEW.id, auth.uid(), v_author, 'executor', 'Виконавець: ' || COALESCE(NEW.executor_name, '—'));
  END IF;
  IF NEW.lead_unit IS DISTINCT FROM OLD.lead_unit OR NEW.our_role IS DISTINCT FROM OLD.our_role THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body)
    VALUES (NEW.id, auth.uid(), v_author, 'system',
            'Головний виконавець: ' || COALESCE(NEW.lead_unit, '—')
            || CASE NEW.our_role WHEN 'lead' THEN ' (ми — головні)' WHEN 'co' THEN ' (ми — співвиконавці)'
                                 WHEN 'info' THEN ' (нам — до відома)' ELSE '' END);
  END IF;
  IF NEW.review_passed IS DISTINCT FROM OLD.review_passed THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body)
    VALUES (NEW.id, auth.uid(), v_author, 'review',
            CASE WHEN NEW.review_passed THEN 'Рецензію пройдено' ELSE 'Рецензію знято' END);
  END IF;
  IF NEW.out_no IS DISTINCT FROM OLD.out_no AND NEW.out_no IS NOT NULL THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, doc_no, event_date)
    VALUES (NEW.id, auth.uid(), v_author, 'system',
            'Вих. № ' || NEW.out_no || COALESCE(' від ' || to_char(NEW.out_date, 'DD.MM.YYYY'), ''),
            NEW.out_no, NEW.out_date);
  END IF;

  NEW.change_note := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.dept_cases_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body)
  VALUES (NEW.id, auth.uid(), COALESCE(NEW.updated_by_name, NEW.created_by_name), 'system',
          'Справу заведено' || CASE NEW.source WHEN 'askod' THEN ' з журналу АСКОД'
                                             WHEN 'claude' THEN ' (Claude)' ELSE '' END
          || COALESCE('; строк ' || to_char(NEW.deadline, 'DD.MM.YYYY'), ''));
  RETURN NEW;
END;
$$;

-- Первинний строк при заведенні; підставу заведення не зберігаємо
CREATE OR REPLACE FUNCTION public.dept_cases_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deadline_original IS NULL THEN
    NEW.deadline_original := NEW.deadline;
  END IF;
  NEW.change_note := NULL;
  RETURN NEW;
END;
$$;

-- Старі тригери першої міграції замінюємо новими
DROP TRIGGER IF EXISTS trg_dept_cases_touch ON public.dept_cases;
DROP TRIGGER IF EXISTS trg_dept_cases_log ON public.dept_cases;
DROP TRIGGER IF EXISTS trg_dept_cases_before_update ON public.dept_cases;
DROP TRIGGER IF EXISTS trg_dept_cases_before_insert ON public.dept_cases;
DROP TRIGGER IF EXISTS trg_dept_cases_after_insert ON public.dept_cases;
DROP FUNCTION IF EXISTS public.dept_cases_touch();
DROP FUNCTION IF EXISTS public.dept_cases_log();

CREATE TRIGGER trg_dept_cases_before_insert
  BEFORE INSERT ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_cases_before_insert();
CREATE TRIGGER trg_dept_cases_after_insert
  AFTER INSERT ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_cases_after_insert();
CREATE TRIGGER trg_dept_cases_before_update
  BEFORE UPDATE ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_cases_before_update();
