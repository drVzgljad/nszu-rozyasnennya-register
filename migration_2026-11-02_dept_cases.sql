-- ============================================================
-- Міграція: «Справи відділу» — дошка вхідних і відповідей на них
-- Таблиці dept_cases (картка справи) + dept_case_events (стрічка подій,
-- зауваження керівників, коментарі) + RLS + тригери.
-- Дата: 2026-11-02
-- Застосувати в Supabase SQL Editor (проєкт rpe-pmg). Ідемпотентна.
--
-- Одна картка = одна справа: вхідний документ із резолюцією та наша відповідь
-- на нього (лист / службова / відповідь на запит на інформацію) — від
-- реєстрації в АСКОД до вих. № і закриття резолюції.
--
-- Персональні дані (прізвища заявників, суть звернень) живуть ЛИШЕ тут, під
-- RLS. У публічному репозиторії порталу — тільки код розділу spravy/.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dept_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Відділ, якому належить справа (значення profiles."Section")
  department TEXT NOT NULL,

  -- Вхідний документ (реквізити з реєстраційної картки АСКОД)
  in_no TEXT,                -- вх. № НСЗУ, напр. 10001-08-26, Д-1002-26, ПІ-104-26
  in_date DATE,              -- дата реєстрації
  correspondent TEXT,        -- хто написав
  corr_out_no TEXT,          -- вих. № кореспондента
  corr_out_date DATE,
  subject TEXT NOT NULL,     -- суть
  deadline DATE,             -- строк виконання з картки
  resolution TEXT,           -- резолюція: «Прізвище скл., Прізвище, Прізвище»
  askod_state TEXT,          -- стан резолюції з журналу АСКОД («До виконання» / «На виконанні»)

  -- Наша відповідь
  reply_kind TEXT NOT NULL DEFAULT 'letter'
    CHECK (reply_kind IN ('letter', 'sz', 'pi', 'info', 'other')),
  stage TEXT NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new', 'work', 'review', 'signing', 'done')),
  executor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  executor_name TEXT,
  version INT,               -- поточна версія чернетки (v1…vN)
  draft_path TEXT,           -- шлях у обміннику, напр. 10_НА_ПІДПИС\29.10.26\lyst_10001_…_v2.docx
  draft_url TEXT,            -- посилання: Google Doc із зауваженнями, OneDrive
  review_passed BOOLEAN NOT NULL DEFAULT false,  -- рецензію пройдено
  nuances TEXT,              -- нюанси: що не можна писати, на що зважати
  out_no TEXT,               -- вих. № НСЗУ
  out_date DATE,             -- дата відправлення
  priority INT NOT NULL DEFAULT 0,   -- порядок у колонці (менше = вище)

  -- Звідки картка: вручну, з журналу АСКОД скриптом, чи її завів Claude у сесії
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'askod', 'claude')),

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by_name TEXT       -- хто змінив останнім (підпис у стрічці подій; для Claude — «Claude»)
);

COMMENT ON TABLE public.dept_cases IS
  'Справи відділу: вхідний документ АСКОД → чернетка vN → погодження → на підписі → вих. №. Видимість — свій відділ + керівництво + діловод.';

-- Один вх. № — одна справа у відділі (порожній вх. № дозволено багато разів:
-- ініціативні листи й доручення без вхідного)
DO $$
BEGIN
  ALTER TABLE public.dept_cases
    ADD CONSTRAINT dept_cases_dept_in_no_key UNIQUE (department, in_no);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_dept_cases_board
  ON public.dept_cases(department, stage, priority);
CREATE INDEX IF NOT EXISTS idx_dept_cases_deadline
  ON public.dept_cases(deadline) WHERE stage <> 'done';


CREATE TABLE IF NOT EXISTS public.dept_case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.dept_cases(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT,

  -- comment — коментар; remark — зауваження керівника/рецензента;
  -- stage / version / executor / review — автоматичні записи тригера
  kind TEXT NOT NULL DEFAULT 'comment'
    CHECK (kind IN ('comment', 'remark', 'stage', 'version', 'executor', 'review', 'system')),
  body TEXT NOT NULL,

  -- Лише для remark
  remark_from TEXT,          -- чиє зауваження: керівник департаменту, керівник відділу, рецензент
  remark_status TEXT CHECK (remark_status IN ('open', 'done', 'rejected')),
  remark_answer TEXT,        -- як враховано (або чому ні)
  remark_version INT,        -- у якій версії враховано

  meta JSONB
);

CREATE INDEX IF NOT EXISTS idx_dept_case_events_case
  ON public.dept_case_events(case_id, created_at);


-- ============================================================
-- Доступ. Читати: свій відділ, керівництво департаменту, діловод.
-- Писати: свій відділ і керівництво (діловод — лише читання чужих
-- відділів, як і в РпВ). Гостям — нічого.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dept_case_can_read(p_dept TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IS DISTINCT FROM 'guest'
      AND (
        p.role IN ('admin', 'director', 'deputy_director')
        OR p.is_clerk IS TRUE
        OR p."Section" = p_dept
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.dept_case_can_write(p_dept TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IS DISTINCT FROM 'guest'
      AND (
        p.role IN ('admin', 'director', 'deputy_director')
        OR p."Section" = p_dept
      )
  );
$$;

-- Видаляти справу: керівництво або керівник свого відділу
CREATE OR REPLACE FUNCTION public.dept_case_can_delete(p_dept TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('admin', 'director', 'deputy_director')
        OR (p."Section" = p_dept AND (p.role = 'manager' OR p.is_head IS TRUE))
      )
  );
$$;

ALTER TABLE public.dept_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dept_case_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dept_cases_select" ON public.dept_cases;
CREATE POLICY "dept_cases_select" ON public.dept_cases
  FOR SELECT TO authenticated USING (public.dept_case_can_read(department));

DROP POLICY IF EXISTS "dept_cases_insert" ON public.dept_cases;
CREATE POLICY "dept_cases_insert" ON public.dept_cases
  FOR INSERT TO authenticated WITH CHECK (public.dept_case_can_write(department));

DROP POLICY IF EXISTS "dept_cases_update" ON public.dept_cases;
CREATE POLICY "dept_cases_update" ON public.dept_cases
  FOR UPDATE TO authenticated
  USING (public.dept_case_can_write(department))
  WITH CHECK (public.dept_case_can_write(department));

DROP POLICY IF EXISTS "dept_cases_delete" ON public.dept_cases;
CREATE POLICY "dept_cases_delete" ON public.dept_cases
  FOR DELETE TO authenticated USING (public.dept_case_can_delete(department));

DROP POLICY IF EXISTS "dept_case_events_select" ON public.dept_case_events;
CREATE POLICY "dept_case_events_select" ON public.dept_case_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.dept_cases c
            WHERE c.id = case_id AND public.dept_case_can_read(c.department))
  );

-- Додавати запис можна лише від свого імені
DROP POLICY IF EXISTS "dept_case_events_insert" ON public.dept_case_events;
CREATE POLICY "dept_case_events_insert" ON public.dept_case_events
  FOR INSERT TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.dept_cases c
                WHERE c.id = case_id AND public.dept_case_can_write(c.department))
  );

-- Оновлювати: позначати зауваження врахованим може будь-хто з відділу
DROP POLICY IF EXISTS "dept_case_events_update" ON public.dept_case_events;
CREATE POLICY "dept_case_events_update" ON public.dept_case_events
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dept_cases c
                 WHERE c.id = case_id AND public.dept_case_can_write(c.department)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.dept_cases c
                      WHERE c.id = case_id AND public.dept_case_can_write(c.department)));

-- Видаляти: автор свого запису або керівник відділу
DROP POLICY IF EXISTS "dept_case_events_delete" ON public.dept_case_events;
CREATE POLICY "dept_case_events_delete" ON public.dept_case_events
  FOR DELETE TO authenticated USING (
    author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.dept_cases c
               WHERE c.id = case_id AND public.dept_case_can_delete(c.department))
  );


-- ============================================================
-- Тригери: updated_at і автоматична стрічка подій.
-- Етап, версію, виконавця й рецензію фіксує база, а не сторінка: так у
-- стрічку потрапляють і зміни, які Claude вносить напряму через SQL.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dept_cases_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dept_cases_touch ON public.dept_cases;
CREATE TRIGGER trg_dept_cases_touch
  BEFORE UPDATE ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_cases_touch();

CREATE OR REPLACE FUNCTION public.dept_cases_log()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author TEXT := COALESCE(NEW.updated_by_name, NEW.created_by_name);
  v_stage CONSTANT JSONB := '{"new":"Нове","work":"Готуємо","review":"Погодження","signing":"На підписі","done":"Закрито"}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body)
    VALUES (NEW.id, auth.uid(), v_author, 'system',
            'Справу заведено' || CASE NEW.source WHEN 'askod' THEN ' з журналу АСКОД'
                                               WHEN 'claude' THEN ' (Claude)' ELSE '' END);
    RETURN NEW;
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, meta)
    VALUES (NEW.id, auth.uid(), v_author, 'stage',
            (v_stage ->> OLD.stage) || ' → ' || (v_stage ->> NEW.stage),
            jsonb_build_object('from', OLD.stage, 'to', NEW.stage));
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version AND NEW.version IS NOT NULL THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, meta)
    VALUES (NEW.id, auth.uid(), v_author, 'version',
            'Чернетка v' || NEW.version || COALESCE(' — ' || NEW.draft_path, ''),
            jsonb_build_object('version', NEW.version));
  END IF;
  IF NEW.executor_name IS DISTINCT FROM OLD.executor_name THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body)
    VALUES (NEW.id, auth.uid(), v_author, 'executor',
            'Виконавець: ' || COALESCE(NEW.executor_name, '—'));
  END IF;
  IF NEW.review_passed IS DISTINCT FROM OLD.review_passed THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body)
    VALUES (NEW.id, auth.uid(), v_author, 'review',
            CASE WHEN NEW.review_passed THEN 'Рецензію пройдено' ELSE 'Рецензію знято' END);
  END IF;
  IF NEW.out_no IS DISTINCT FROM OLD.out_no AND NEW.out_no IS NOT NULL THEN
    INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body)
    VALUES (NEW.id, auth.uid(), v_author, 'system',
            'Вих. № ' || NEW.out_no || COALESCE(' від ' || to_char(NEW.out_date, 'DD.MM.YYYY'), ''));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dept_cases_log ON public.dept_cases;
CREATE TRIGGER trg_dept_cases_log
  AFTER INSERT OR UPDATE ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_cases_log();


-- Realtime: колега пересунув картку — у решти дошка оновилася сама
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dept_cases;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dept_case_events;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
