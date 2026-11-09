-- ============================================================
-- «Справи відділу»: зв'язки між справами (СЗ туди й назад)
-- 09.11.2026
--
-- Користувач: «давай зробимо зв'язок проєктів: якщо по проєкту ми надіслали
-- службову — чекаємо; чи нам надіслали службову за проєктом, де ми співвиконавці».
--
-- Один рядок dept_case_links = один документ між двома сторонами справи:
--   direction = 'out' — ми надіслали (СЗ, СЗ у робочому порядку, лист, проєкт на
--                       погодження) і чекаємо відповіді / врахування;
--   direction = 'in'  — нам надіслали, і ми маємо це врахувати у своєму проєкті.
-- status: waiting (чекаємо / треба врахувати) → answered (відповідь є / враховано)
--         або closed (знято).
--
-- Якщо справа другої сторони теж є на дошці (інший відділ департаменту), вона
-- записується в counterpart_case_id — і той самий рядок видно з обох справ: у нас
-- «⏳ чекаємо», у них «📥 треба врахувати». Будь-яка сторона може змінити статус.
-- Знайти справу з тим самим вх. № в інших відділах допомагає dept_case_peers():
-- RLS іншим відділам чужих справ не показує, а функція віддає лише відділ, етап,
-- виконавця і № проєкту.
-- Ідемпотентна. Застосовувати після migration_2026-11-02*_dept_cases*.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dept_case_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  case_id UUID NOT NULL REFERENCES public.dept_cases(id) ON DELETE CASCADE,   -- справа, з якої внесли
  case_department TEXT,                                                        -- її відділ (заповнює тригер)
  direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  doc_kind TEXT NOT NULL DEFAULT 'sz' CHECK (doc_kind IN ('sz', 'sz_work', 'letter', 'project', 'other')),
  doc_no TEXT,                -- № СЗ / вих. № / № проєкту
  doc_date DATE,
  counterpart TEXT,           -- кому / від кого: підрозділ або людина
  counterpart_case_id UUID REFERENCES public.dept_cases(id) ON DELETE SET NULL,  -- справа другої сторони на дошці
  project_no TEXT,            -- до якого проєкту в АСКОД (Н(СЛ)-…)
  about TEXT,                 -- коротко про зміст
  wait_until DATE,            -- до коли чекаємо відповідь
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'answered', 'closed')),
  answer_note TEXT,           -- що відповіли / як враховано

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by_name TEXT
);

COMMENT ON TABLE public.dept_case_links IS
  'Зв''язки справ: СЗ / лист / проєкт, який ми надіслали (чекаємо) чи нам надіслали (врахувати). Видно з обох справ.';

CREATE INDEX IF NOT EXISTS idx_dept_case_links_case ON public.dept_case_links(case_id);
CREATE INDEX IF NOT EXISTS idx_dept_case_links_peer ON public.dept_case_links(counterpart_case_id)
  WHERE counterpart_case_id IS NOT NULL;

-- ── Доступ: бачить і змінює кожна сторона зв'язку ──
ALTER TABLE public.dept_case_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.dept_case_link_side(p_case UUID, p_write BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dept_cases c
    WHERE c.id = p_case
      AND CASE WHEN p_write THEN public.dept_case_can_write(c.department)
               ELSE public.dept_case_can_read(c.department) END
  );
$$;

DROP POLICY IF EXISTS "dept_case_links_select" ON public.dept_case_links;
CREATE POLICY "dept_case_links_select" ON public.dept_case_links
  FOR SELECT TO authenticated USING (
    public.dept_case_link_side(case_id, false)
    OR (counterpart_case_id IS NOT NULL AND public.dept_case_link_side(counterpart_case_id, false))
  );

DROP POLICY IF EXISTS "dept_case_links_insert" ON public.dept_case_links;
CREATE POLICY "dept_case_links_insert" ON public.dept_case_links
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid() AND public.dept_case_link_side(case_id, true)
  );

DROP POLICY IF EXISTS "dept_case_links_update" ON public.dept_case_links;
CREATE POLICY "dept_case_links_update" ON public.dept_case_links
  FOR UPDATE TO authenticated
  USING (public.dept_case_link_side(case_id, true)
         OR (counterpart_case_id IS NOT NULL AND public.dept_case_link_side(counterpart_case_id, true)))
  WITH CHECK (public.dept_case_link_side(case_id, true)
              OR (counterpart_case_id IS NOT NULL AND public.dept_case_link_side(counterpart_case_id, true)));

DROP POLICY IF EXISTS "dept_case_links_delete" ON public.dept_case_links;
CREATE POLICY "dept_case_links_delete" ON public.dept_case_links
  FOR DELETE TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.dept_cases c
               WHERE c.id = case_id AND public.dept_case_can_delete(c.department))
  );

-- ── Та сама справа (той самий вх. №) в інших відділах ──
-- Лише те, що потрібно для зв'язку: без суті, кореспондента й нюансів.
CREATE OR REPLACE FUNCTION public.dept_case_peers(p_case UUID)
RETURNS TABLE (id UUID, department TEXT, stage TEXT, executor_name TEXT, project_no TEXT, our_role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.department, o.stage, o.executor_name, o.project_no, o.our_role
  FROM public.dept_cases me
  JOIN public.dept_cases o
    ON o.id <> me.id
   AND o.department <> me.department
   AND upper(regexp_replace(o.in_no, '\s', '', 'g')) = upper(regexp_replace(me.in_no, '\s', '', 'g'))
  WHERE me.id = p_case
    AND me.in_no IS NOT NULL
    AND public.dept_case_can_read(me.department);
$$;
REVOKE ALL ON FUNCTION public.dept_case_peers(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dept_case_peers(UUID) TO authenticated;

-- ── Тригери: відділ справи, updated_at, історія обох справ ──
CREATE OR REPLACE FUNCTION public.dept_case_links_before()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT department INTO NEW.case_department FROM public.dept_cases WHERE id = NEW.case_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dept_case_links_before ON public.dept_case_links;
CREATE TRIGGER dept_case_links_before
  BEFORE INSERT OR UPDATE ON public.dept_case_links
  FOR EACH ROW EXECUTE FUNCTION public.dept_case_links_before();

CREATE OR REPLACE FUNCTION public.dept_case_links_log()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  who TEXT := coalesce(NEW.updated_by_name, NEW.created_by_name, 'Система');
  doc TEXT := (CASE NEW.doc_kind WHEN 'sz' THEN 'СЗ' WHEN 'sz_work' THEN 'СЗ у робочому порядку'
                 WHEN 'letter' THEN 'Лист' WHEN 'project' THEN 'Проєкт' ELSE 'Документ' END)
              || coalesce(' № ' || nullif(NEW.doc_no, ''), '')
              || coalesce(' від ' || to_char(NEW.doc_date, 'DD.MM.YYYY'), '');
  mine TEXT;
  peer TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    mine := CASE NEW.direction
      WHEN 'out' THEN '🔗 ' || doc || coalesce(' → ' || nullif(NEW.counterpart, ''), '') || ' — чекаємо відповіді'
                      || coalesce(' до ' || to_char(NEW.wait_until, 'DD.MM'), '')
      ELSE '🔗 ' || doc || coalesce(' від ' || nullif(NEW.counterpart, ''), '') || ' — врахувати' END;
    peer := CASE NEW.direction
      WHEN 'out' THEN '🔗 Від відділу ' || coalesce(NEW.case_department, '—') || ': ' || doc || ' — врахувати'
      ELSE '🔗 ' || doc || ' → відділу ' || coalesce(NEW.case_department, '—') || ' — чекають від нас' END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    mine := '🔗 ' || doc || ': ' || CASE NEW.status
      WHEN 'answered' THEN CASE NEW.direction WHEN 'out' THEN 'відповідь отримано' ELSE 'враховано' END
      WHEN 'closed' THEN 'знято' ELSE 'знову чекаємо' END
      || coalesce(' — ' || nullif(NEW.answer_note, ''), '');
    peer := mine;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.dept_case_events (case_id, author_id, author_name, kind, body)
  VALUES (NEW.case_id, auth.uid(), who, 'system', mine);
  IF NEW.counterpart_case_id IS NOT NULL THEN
    INSERT INTO public.dept_case_events (case_id, author_id, author_name, kind, body)
    VALUES (NEW.counterpart_case_id, auth.uid(), who, 'system', peer);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dept_case_links_log ON public.dept_case_links;
CREATE TRIGGER dept_case_links_log
  AFTER INSERT OR UPDATE ON public.dept_case_links
  FOR EACH ROW EXECUTE FUNCTION public.dept_case_links_log();

-- Realtime: друга сторона відмітила «враховано» — у нас бейдж зник сам
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dept_case_links;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Перевірка:
--   select count(*) from dept_case_links;                       -- 0, без помилки
--   select * from dept_case_peers('<id справи з вх. №>');        -- та сама справа в інших відділах
