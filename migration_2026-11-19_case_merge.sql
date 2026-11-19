-- ============================================================
-- «Справи відділу»: об'єднання однотипних листів одного автора в одну справу
-- 19.11.2026
--
-- Користувач: «буває, що нам треба об'єднати два або декілька листів однотипних,
-- одного автора». На них готується одна спільна відповідь.
--
-- Модель — одне поле merged_into, а не новий тип у dept_case_links: рядок
-- зв'язку — це документ між двома сторонами зі станом «чекаємо → відповідь є»,
-- а об'єднання — одна відповідь на кілька вхідних, без документа й очікування.
--
--   • Приєднана справа лишається окремим рядком: свій вх. №, строк, резолюція,
--     стан АСКОД. Тому синхронізація з журналом (tools/spravy_sync.py,
--     pmg-askod-journal.js) не заведе дубля (UNIQUE (department, in_no)) і не
--     розклеїть групу — поля merged_into вона не торкається.
--   • Етап, виконавець і вих. № приєднаної справи — як у головної. Тригер
--     переносить їх щоразу, коли змінюється головна. Якщо приєднану справу
--     хтось просуває вперед напряму (контролька, SQL), вперед іде головна —
--     а за нею вся група: відповідь одна.
--   • Ланцюжків немає: приєднати до приєднаної = приєднати до її головної;
--     головну приєднали до іншої — її група переїжджає разом із нею.
--   • Від'єднана справа повертається в етап, у якому була до об'єднання
--     (його пам'ятає подія «приєднано»), якщо відповідь іще не відправлено.
--     Це не «повернуто на доопрацювання»: у звіт 37-Д не йде.
--   • Історію «🧩 приєднано / від'єднано» пишуть тригери в обидві справи.
--   • Лише документи АСКОД (case_kind = 'askod') одного відділу.
--
-- Контрольний строк групи (найближчий серед відкритих листів) рахує дошка:
-- власний строк кожна справа зберігає, бо його оновлює журнал АСКОД.
--
-- Ідемпотентна. Застосовувати після migration_2026-11-02*_dept_cases*.sql.
-- ============================================================

ALTER TABLE public.dept_cases ADD COLUMN IF NOT EXISTS merged_into UUID
  REFERENCES public.dept_cases(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.dept_cases.merged_into IS
  'Справу приєднано до цієї (головної): одна відповідь на кілька вхідних. Етап, виконавець і вих. № — як у головної.';
CREATE INDEX IF NOT EXISTS dept_cases_merged_idx ON public.dept_cases (merged_into) WHERE merged_into IS NOT NULL;

ALTER TABLE public.dept_cases DROP CONSTRAINT IF EXISTS dept_cases_merged_self_check;
ALTER TABLE public.dept_cases ADD CONSTRAINT dept_cases_merged_self_check CHECK (merged_into IS DISTINCT FROM id);

CREATE OR REPLACE FUNCTION public.dept_cases_merge_label(p_no TEXT, p_corr TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'вх. № ' || COALESCE(NULLIF(p_no, ''), 'без номера') || COALESCE(' (' || NULLIF(btrim(p_corr), '') || ')', '');
$$;


-- Етап, у який повертається від'єднана справа: той, що був до об'єднання (пам'ятає подія
-- «приєднано»), — якщо відповідь іще не відправлено і етап не міняють тим самим записом.
-- NULL — етап лишається.
CREATE OR REPLACE FUNCTION public.dept_cases_unmerge_stage(p_case UUID, p_old TEXT, p_new TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.prev FROM (
    SELECT e.meta->>'prev_stage' AS prev
      FROM public.dept_case_events e
     WHERE e.case_id = p_case AND e.kind = 'system' AND e.meta->>'merge' = 'in'
     ORDER BY e.created_at DESC LIMIT 1
  ) v
  WHERE p_new IS NOT DISTINCT FROM p_old AND p_old <> 'done'
    AND v.prev IS DISTINCT FROM p_old AND public.dept_cases_stage_rank(v.prev) IS NOT NULL;
$$;

-- ============================================================
-- BEFORE UPDATE, частина перша. Ім'я починається з «a», щоб тригер спрацював РАНІШЕ за
-- trg_dept_cases_before_update (Postgres викликає їх за абеткою): перевіряє об'єднання,
-- пише події «🧩 …» (підставу ще видно в change_note) і не дає напряму розвести етап і
-- виконавця приєднаної справи з головною. Етап при самому об'єднанні / від'єднанні
-- ставить друга частина — trg_dept_cases_z_merge, уже ПІСЛЯ тригера історії.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dept_cases_merge_before()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.dept_cases%ROWTYPE;
  v_prev TEXT;
  v_who TEXT := COALESCE(NEW.updated_by_name, OLD.updated_by_name, NEW.created_by_name);
BEGIN
  -- ── об'єднання / перенесення / від'єднання ──
  IF NEW.merged_into IS DISTINCT FROM OLD.merged_into THEN
    IF NEW.merged_into IS NOT NULL THEN
      SELECT * INTO m FROM public.dept_cases WHERE id = NEW.merged_into;
      IF m.id IS NOT NULL AND m.merged_into IS NOT NULL THEN          -- без ланцюжків: до головної
        SELECT * INTO m FROM public.dept_cases WHERE id = m.merged_into;
      END IF;
      IF m.id IS NULL THEN
        RAISE EXCEPTION 'Головну справу не знайдено';
      END IF;
      IF m.id = NEW.id THEN
        RAISE EXCEPTION 'Справу не можна приєднати до самої себе';
      END IF;
      IF m.department IS DISTINCT FROM NEW.department THEN
        RAISE EXCEPTION 'Об''єднувати можна лише справи одного відділу';
      END IF;
      IF COALESCE(m.case_kind, 'askod') <> 'askod' OR COALESCE(NEW.case_kind, 'askod') <> 'askod' THEN
        RAISE EXCEPTION 'Об''єднувати можна лише документи АСКОД';
      END IF;
      NEW.merged_into := m.id;

      INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, meta)
      VALUES (NEW.id, auth.uid(), v_who, 'system',
              '🧩 Приєднано до справи ' || public.dept_cases_merge_label(m.in_no, m.correspondent) || ' — відповідь одна'
              || CASE WHEN m.stage IS DISTINCT FROM OLD.stage
                      THEN '; етап: ' || public.dept_cases_stage_label(OLD.stage) || ' → ' || public.dept_cases_stage_label(m.stage) ELSE '' END
              || CASE WHEN m.executor_name IS DISTINCT FROM OLD.executor_name
                      THEN '; виконавець: ' || COALESCE(m.executor_name, '—') ELSE '' END
              || COALESCE(' — ' || NULLIF(btrim(NEW.change_note), ''), ''),
              jsonb_build_object('merge', 'in', 'main', m.id, 'prev_stage', OLD.stage, 'prev_main', OLD.merged_into,
                                 'from', OLD.stage, 'to', m.stage));
      INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, meta)
      VALUES (m.id, auth.uid(), v_who, 'system',
              '🧩 Приєднано ' || public.dept_cases_merge_label(NEW.in_no, NEW.correspondent)
              || COALESCE(', строк ' || to_char(NEW.deadline, 'DD.MM.YYYY'), ''),
              jsonb_build_object('merge', 'add', 'child', NEW.id));
      -- Етап, виконавця й вих. № головної ставить trg_dept_cases_z_merge ПІСЛЯ тригера історії:
      -- інакше справа, старша за етапом від головної, отримала б «Повернуто: …» (kind = 'returned'),
      -- а це у звіті 37-Д — «доопрацьований проєкт». Зміну вже описує подія вище.
    ELSE
      SELECT * INTO m FROM public.dept_cases WHERE id = OLD.merged_into;  -- головну могли щойно видалити
      v_prev := public.dept_cases_unmerge_stage(NEW.id, OLD.stage, NEW.stage);

      INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, meta)
      VALUES (NEW.id, auth.uid(), v_who, 'system',
              '🧩 Від''єднано від справи ' || CASE WHEN m.id IS NULL THEN '(видалено)'
                                             ELSE public.dept_cases_merge_label(m.in_no, m.correspondent) END
              || COALESCE(' — ' || NULLIF(btrim(NEW.change_note), ''), '')
              || COALESCE('; етап — як до об''єднання: ' || public.dept_cases_stage_label(v_prev), ''),
              jsonb_build_object('merge', 'out', 'main', OLD.merged_into, 'from', OLD.stage, 'to', v_prev));
      IF m.id IS NOT NULL THEN
        INSERT INTO public.dept_case_events(case_id, author_id, author_name, kind, body, meta)
        VALUES (m.id, auth.uid(), v_who, 'system',
                '🧩 Від''єднано ' || public.dept_cases_merge_label(NEW.in_no, NEW.correspondent)
                || COALESCE(' — ' || NULLIF(btrim(NEW.change_note), ''), ''),
                jsonb_build_object('merge', 'remove', 'child', NEW.id));
      END IF;
      -- Сам етап повертає trg_dept_cases_z_merge ПІСЛЯ тригера історії: інакше той записав би
      -- «Повернуто: …» (kind = 'returned'), а це у звіті 37-Д — «доопрацьований проєкт».
    END IF;
    RETURN NEW;
  END IF;

  -- ── пряма зміна приєднаної справи (не з тригера): етап і виконавець — як у головної ──
  IF NEW.merged_into IS NOT NULL AND pg_trigger_depth() = 1 THEN
    SELECT * INTO m FROM public.dept_cases WHERE id = NEW.merged_into;
    IF m.id IS NOT NULL THEN
      -- вперед від головної можна: AFTER-тригер нижче просуне головну, а за нею — групу
      IF NEW.stage IS DISTINCT FROM OLD.stage
         AND COALESCE(public.dept_cases_stage_rank(NEW.stage), 0) <= COALESCE(public.dept_cases_stage_rank(m.stage), 0) THEN
        NEW.stage := m.stage;
      END IF;
      IF NEW.executor_name IS DISTINCT FROM OLD.executor_name OR NEW.executor_id IS DISTINCT FROM OLD.executor_id THEN
        NEW.executor_id := m.executor_id;
        NEW.executor_name := m.executor_name;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dept_cases_a_merge ON public.dept_cases;
CREATE TRIGGER trg_dept_cases_a_merge
  BEFORE UPDATE ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_cases_merge_before();

-- Друга половина об'єднання / від'єднання. Ім'я на «z» — спрацьовує ПІСЛЯ trg_dept_cases_before_update,
-- тож тригер історії етапу цих змін не бачить (у стрічці їх описують події «🧩 …»):
--   приєднано  → етап, виконавець і вих. № — як у головної;
--   від'єднано → етап — як до об'єднання (див. dept_cases_unmerge_stage).
CREATE OR REPLACE FUNCTION public.dept_cases_merge_follow()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.dept_cases%ROWTYPE;
  v_prev TEXT;
BEGIN
  IF NEW.merged_into IS NOT DISTINCT FROM OLD.merged_into THEN
    RETURN NEW;
  END IF;
  IF NEW.merged_into IS NOT NULL THEN
    SELECT * INTO m FROM public.dept_cases WHERE id = NEW.merged_into;
    IF m.id IS NOT NULL THEN
      NEW.stage := m.stage;
      NEW.executor_id := m.executor_id;
      NEW.executor_name := m.executor_name;
      IF m.out_no IS NOT NULL THEN
        NEW.out_no := m.out_no;
        NEW.out_date := m.out_date;
      END IF;
    END IF;
  ELSE
    v_prev := public.dept_cases_unmerge_stage(NEW.id, OLD.stage, NEW.stage);
    IF v_prev IS NOT NULL THEN
      NEW.stage := v_prev;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dept_cases_z_merge ON public.dept_cases;
CREATE TRIGGER trg_dept_cases_z_merge
  BEFORE UPDATE OF merged_into ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_cases_merge_follow();


-- ============================================================
-- AFTER UPDATE: головна → група; приєднана вперед → головна; переїзд групи.
-- Чужі рядки змінюємо лише тут, ПІСЛЯ запису: у BEFORE-тригері Postgres не дає
-- оновити рядок, який зараз оновлюється («already modified by … current command»).
-- ============================================================
CREATE OR REPLACE FUNCTION public.dept_cases_merge_after()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.dept_cases%ROWTYPE;
BEGIN
  -- головну приєднали до іншої — її група переїжджає до нової головної
  IF NEW.merged_into IS NOT NULL AND OLD.merged_into IS NULL THEN
    UPDATE public.dept_cases
       SET merged_into = NEW.merged_into, updated_by_name = NEW.updated_by_name,
           change_note = 'разом зі справою вх. № ' || COALESCE(NEW.in_no, '—')
     WHERE merged_into = NEW.id;
  END IF;

  -- головна змінилася — те саме в усіх приєднаних
  IF NEW.merged_into IS NULL AND (
       NEW.stage IS DISTINCT FROM OLD.stage
       OR NEW.executor_name IS DISTINCT FROM OLD.executor_name
       OR NEW.executor_id IS DISTINCT FROM OLD.executor_id
       OR NEW.out_no IS DISTINCT FROM OLD.out_no
       OR NEW.out_date IS DISTINCT FROM OLD.out_date) THEN
    UPDATE public.dept_cases c
       SET stage = NEW.stage,
           executor_id = NEW.executor_id,
           executor_name = NEW.executor_name,
           out_no = COALESCE(NEW.out_no, c.out_no),
           out_date = COALESCE(NEW.out_date, c.out_date),
           updated_by_name = NEW.updated_by_name,
           change_note = 'за головною справою вх. № ' || COALESCE(NEW.in_no, '—')
     WHERE c.merged_into = NEW.id
       AND (c.stage IS DISTINCT FROM NEW.stage
            OR c.executor_name IS DISTINCT FROM NEW.executor_name
            OR c.executor_id IS DISTINCT FROM NEW.executor_id
            OR (NEW.out_no IS NOT NULL AND c.out_no IS DISTINCT FROM NEW.out_no)
            OR (NEW.out_date IS NOT NULL AND c.out_date IS DISTINCT FROM NEW.out_date));
  END IF;

  -- приєднану просунули вперед напряму (контролька, SQL) — вперед іде головна
  IF NEW.merged_into IS NOT NULL AND NEW.merged_into IS NOT DISTINCT FROM OLD.merged_into
     AND pg_trigger_depth() = 1 AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    SELECT * INTO m FROM public.dept_cases WHERE id = NEW.merged_into;
    IF m.id IS NOT NULL
       AND COALESCE(public.dept_cases_stage_rank(NEW.stage), 0) > COALESCE(public.dept_cases_stage_rank(m.stage), 0) THEN
      UPDATE public.dept_cases
         SET stage = NEW.stage,
             out_no = COALESCE(out_no, NEW.out_no),
             out_date = COALESCE(out_date, NEW.out_date),
             updated_by_name = NEW.updated_by_name,
             change_note = 'за приєднаною справою вх. № ' || COALESCE(NEW.in_no, '—')
       WHERE id = m.id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_dept_cases_merge_after ON public.dept_cases;
CREATE TRIGGER trg_dept_cases_merge_after
  AFTER UPDATE ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_cases_merge_after();

-- Перевірка (після застосування):
--   select count(*) from dept_cases where merged_into is not null;     -- 0, без помилки
--   -- об'єднати:   update dept_cases set merged_into = '<id головної>', updated_by_name = 'Claude' where id = '<id>';
--   -- від'єднати:  update dept_cases set merged_into = null, change_note = 'помилково', updated_by_name = 'Claude' where id = '<id>';
--   select body from dept_case_events where meta ? 'merge' order by created_at desc limit 4;
