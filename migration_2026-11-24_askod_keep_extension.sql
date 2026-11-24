-- «Справи»: синхронізація з журналом АСКОД не затирає продовжений строк (24.11.2026).
--
-- Що сталося (ПІ-495-26): Голова підписала лист про продовження строку розгляду до 15.12, у картці строк
-- продовжили, а щоденна синхронізація (tools/spravy_sync.py і «📥 Журнал АСКОД» на дошці) знову ставила строк
-- із журналу: 15.12 → 23.11 → 09.12 → 15.12. Обидва шляхи пишуть строк з підставою «за журналом АСКОД».
--
-- Правило: якщо в справі є продовження строку (подія 'deadline' з «продовжено» або надіслана проміжна
-- відповідь), строк «за журналом АСКОД» може тільки зсунутися пізніше, а раніше — ні. Попередній строк
-- лишається, а в історію справи йде рядок, що строк АСКОД інший. Одне місце на обидва шляхи синхронізації,
-- тому паритет tools/spravy_sync.py ↔ pmg-askod-journal.js не зачеплено.
--
-- Тригер називається «0_…», щоб спрацювати раніше за trg_dept_cases_a_merge і trg_dept_cases_before_update
-- (тригери однієї події PostgreSQL запускає за абеткою): історія «Строк: … → …» тоді просто не з'явиться.
-- Застосовує власник у Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.dept_cases_keep_extension()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF btrim(COALESCE(NEW.change_note, '')) = 'за журналом АСКОД'
     AND OLD.deadline IS NOT NULL AND NEW.deadline IS NOT NULL
     AND NEW.deadline < OLD.deadline
     AND EXISTS (
       SELECT 1 FROM public.dept_case_events e
        WHERE e.case_id = OLD.id
          AND (   (e.kind = 'deadline' AND e.body ILIKE '%продовжено%')
               OR (e.kind = 'outgoing' AND e.doc_kind = 'interim' AND COALESCE((e.meta->>'draft')::boolean, false) = false))
     )
  THEN
    -- той самий строк АСКОД уже записано — не дублюємо рядок щодня
    IF NOT EXISTS (
      SELECT 1 FROM public.dept_case_events e
       WHERE e.case_id = OLD.id AND e.kind = 'system'
         AND e.body = 'Строк у журналі АСКОД ' || to_char(NEW.deadline, 'DD.MM.YYYY')
                      || ' — лишаємо продовжений ' || to_char(OLD.deadline, 'DD.MM.YYYY')
    ) THEN
      INSERT INTO public.dept_case_events(case_id, author_name, kind, body)
      VALUES (OLD.id, COALESCE(NEW.updated_by_name, 'журнал АСКОД'), 'system',
              'Строк у журналі АСКОД ' || to_char(NEW.deadline, 'DD.MM.YYYY')
              || ' — лишаємо продовжений ' || to_char(OLD.deadline, 'DD.MM.YYYY'));
    END IF;
    NEW.deadline := OLD.deadline;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dept_cases_0_keep_extension ON public.dept_cases;
CREATE TRIGGER trg_dept_cases_0_keep_extension
  BEFORE UPDATE OF deadline ON public.dept_cases
  FOR EACH ROW EXECUTE FUNCTION public.dept_cases_keep_extension();

-- Перевірка (після застосування): строк ПІ-495 не має повертатися до 09.12 наступною синхронізацією.
-- select in_no, deadline, deadline_original from dept_cases where in_no ilike 'ПІ-495%';
