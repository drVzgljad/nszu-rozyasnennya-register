-- ============================================================
-- Міграція: діловод департаменту
-- Дата: 2026-07-29
-- Виконати вручну в Supabase SQL Editor (проєкт qdqtkvyvhtjgxpxnvblk).
--
-- ІДЕЯ. Ролі на порталі — лінійна драбина
--   guest → expert → manager → deputy_director → admin,
-- і вона принципово не вміє описати діловода: йому треба ШИРШЕ за всіх
-- (усі відділи), але не ВИЩЕ за когось (не керівник, не оцінює роботу).
-- Тому діловод — це НЕ нова сходинка, а окремий ортогональний прапорець
-- is_clerk (за зразком наявного is_head). Роль лишається 'expert'.
-- ============================================================


-- ── 1. Прапорець діловода ───────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_clerk BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.is_clerk IS
  'Діловод департаменту: реєструє резолюції керівництва як доручення, публікує оголошення, веде табель, бачить усі відділи наскрізно. Прав керівника (оцінювання, закриття, редагування чужого) НЕ дає.';


-- ── 2. Доручення: чия резолюція і хто її вніс ───────────────
-- created_by / created_by_name лишаються автором резолюції для всіх
-- наявних відображень («Надав: …»), а факт внесення діловодом
-- фіксується окремо.
ALTER TABLE public.assigned_tasks
  ADD COLUMN IF NOT EXISTS on_behalf_of UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.assigned_tasks
  ADD COLUMN IF NOT EXISTS registered_by_name TEXT;

COMMENT ON COLUMN public.assigned_tasks.on_behalf_of IS
  'Автор резолюції, коли доручення вніс діловод. NULL — доручення створив сам керівник.';
COMMENT ON COLUMN public.assigned_tasks.registered_by_name IS
  'ПІБ діловода, який зареєстрував резолюцію. NULL — доручення створив сам керівник.';


-- ── 3. RLS: діловод може створювати доручення ───────────────
DROP POLICY IF EXISTS "Managers can insert assigned tasks" ON public.assigned_tasks;
CREATE POLICY "Managers can insert assigned tasks" ON public.assigned_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role IN ('admin', 'director', 'deputy_director', 'manager')
             OR is_clerk = TRUE)
    )
  );

-- Оновлення: діловод правит лише те, що вніс сам (auth.uid() = created_by
-- вже покриває це в наявній політиці) — окремого дозволу не додаємо.
-- Видалення: лишається творцю та керівництву — без змін.


-- ── 4. Тригер валідації: гілка для діловода ─────────────────
CREATE OR REPLACE FUNCTION public.validate_task_assignment()
RETURNS trigger AS $$
DECLARE
  creator_role TEXT;
  creator_dept TEXT;
  creator_clerk BOOLEAN;
  assignee_role TEXT;
  assignee_dept TEXT;
  behalf_role TEXT;
BEGIN
  -- Get creator details
  SELECT role, "Section", COALESCE(is_clerk, FALSE)
    INTO creator_role, creator_dept, creator_clerk
  FROM public.profiles WHERE id = new.created_by;

  -- Get assignee details
  SELECT role, "Section" INTO assignee_role, assignee_dept
  FROM public.profiles WHERE id = new.responsible_id;

  -- 0. Діловод: реєструє резолюцію керівництва, тому перевірки інші
  IF creator_clerk AND creator_role NOT IN ('admin', 'director', 'deputy_director', 'manager') THEN
    IF new.on_behalf_of IS NULL THEN
      RAISE EXCEPTION 'Діловод має вказати, чию резолюцію реєструє';
    END IF;

    SELECT role INTO behalf_role FROM public.profiles WHERE id = new.on_behalf_of;
    IF behalf_role IS NULL OR behalf_role NOT IN ('admin', 'director', 'deputy_director', 'manager') THEN
      RAISE EXCEPTION 'Резолюцію може давати лише керівництво департаменту або начальник відділу';
    END IF;

    IF assignee_role IS NULL OR assignee_role = 'guest' THEN
      RAISE EXCEPTION 'Доручення можна надати лише співробітнику департаменту';
    END IF;

    RETURN new;
  END IF;

  -- 1. Authorization check
  IF creator_role NOT IN ('admin', 'director', 'deputy_director', 'manager') THEN
    RAISE EXCEPTION 'Ви не маєте прав для створення доручень';
  END IF;

  -- 2. Rules for Manager (Керівник)
  IF creator_role = 'manager' THEN
    IF assignee_role != 'expert' THEN
      RAISE EXCEPTION 'Керівник може надавати доручення лише експертам';
    END IF;
    IF assignee_dept != creator_dept THEN
      RAISE EXCEPTION 'Керівник може надавати доручення лише співробітникам свого відділу';
    END IF;
  END IF;

  -- 3. Rules for Deputy Director (Заступник директора)
  IF creator_role = 'deputy_director' THEN
    IF assignee_role = 'director' THEN
      RAISE EXCEPTION 'Заступник директора не може надавати доручення директору';
    END IF;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql;


-- ── 5. Новини / оголошення: діловод публікує і редагує ──────
-- Видалення новин лишається керівництву: у таблиці news немає автора,
-- тому обмежити діловода власними записами неможливо.
DROP POLICY IF EXISTS "Managers and above can insert news" ON public.news;
CREATE POLICY "Managers and above can insert news" ON public.news
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role IN ('admin', 'director', 'deputy_director', 'manager')
             OR is_clerk = TRUE)
    )
  );

DROP POLICY IF EXISTS "Managers and above can update news" ON public.news;
CREATE POLICY "Managers and above can update news" ON public.news
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role IN ('admin', 'director', 'deputy_director', 'manager')
             OR is_clerk = TRUE)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role IN ('admin', 'director', 'deputy_director', 'manager')
             OR is_clerk = TRUE)
    )
  );


-- ── 6. Табель бухгалтерії: діловод веде штат ────────────────
DROP POLICY IF EXISTS "timesheet_staff_insert" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_insert" ON public.timesheet_staff
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role IN ('full', 'deputy_director', 'director', 'admin')
           OR p.is_clerk = TRUE)
  ));

DROP POLICY IF EXISTS "timesheet_staff_update" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_update" ON public.timesheet_staff
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role IN ('full', 'deputy_director', 'director', 'admin')
           OR p.is_clerk = TRUE)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role IN ('full', 'deputy_director', 'director', 'admin')
           OR p.is_clerk = TRUE)
  ));

DROP POLICY IF EXISTS "timesheet_staff_delete" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_delete" ON public.timesheet_staff
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role IN ('full', 'deputy_director', 'director', 'admin')
           OR p.is_clerk = TRUE)
  ));


-- ── 7. Профіль діловода ─────────────────────────────────────
-- Реєстрація дає role='guest' (див. handle_new_user), тому діловода
-- піднімають до 'expert' і вмикають прапорець. Прізвище не зберігається
-- в репозиторії — підставляється при виконанні:
--
-- UPDATE public.profiles
-- SET role      = 'expert',
--     is_head   = FALSE,
--     "Section" = 'стратегічного розвитку програми медичних гарантій',
--     position  = COALESCE(NULLIF(position, ''), 'Діловод департаменту'),
--     is_clerk  = TRUE
-- WHERE full_name ILIKE '%<прізвище>%';


-- ── 8. Штат табеля ──────────────────────────────────────────
-- ⚠️ Перед виконанням підставити по батькові, табельний номер і посаду.
-- INSERT INTO public.timesheet_staff
--   (sheet, sort_order, unit, tabel_no, gender, full_name, "position", note)
-- VALUES
--   ('department', 23, 'відділ стратегічного розвитку програми медичних гарантій',
--    NULL, 'Ж', '<ПІБ>', 'діловод', NULL);
