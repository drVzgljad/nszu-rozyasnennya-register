-- ============================================================
-- «Справи відділу» · журнал АСКОД завантажує кожен сам · 03.11.2026
--
-- Кнопка «📥 Журнал АСКОД» у spravy/ розбирає xlsx-вигрузку резолюцій у
-- браузері (pmg-askod-journal.js) і пише в dept_cases під RLS від імені
-- співробітника — для цього нових прав не треба. Ця таблиця — лише облік:
-- чий журнал, коли сформований в АСКОД, ким і що застосовано.
--
-- Навіщо облік: щоденний tools/spravy_sync.py бере журнали з обмінника. Якщо
-- співробітник уже завантажив свіжіший журнал на порталі, старіший файл з
-- обмінника повернув би старі строки і позначив «зниклими» справи, яких у
-- ньому ще не було. За цією таблицею скрипт такий файл відкидає, а сторінка
-- не дає завантажити журнал, старіший за вже застосований.
--
-- Без цієї міграції кнопка теж працює, тільки без обліку і без запобіжника.
-- Застосувати в Supabase SQL Editor. Ідемпотентна.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dept_journal_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  department TEXT NOT NULL,          -- відділ дошки (profiles."Section")
  owner_name TEXT NOT NULL,          -- власник журналу: найчастіше значення «Виконавець» («Прізвище Ім'я»)
  journal_at TIMESTAMPTZ,            -- коли АСКОД сформував файл (docProps/core.xml → dcterms:created)
  file_name TEXT,
  source TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'script')),
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  uploaded_by_name TEXT,
  docs_total INT,                    -- документів у журналі
  picked INT,                        -- з них на дошку (свіжі або з живим строком)
  added INT, updated INT, gone INT, back INT
);

COMMENT ON TABLE public.dept_journal_uploads IS
  'Застосовані журнали АСКОД (портал і tools/spravy_sync.py): чий, коли сформований, що змінено. Скрипт не бере з обмінника журнал, старіший за застосований.';

CREATE INDEX IF NOT EXISTS dept_journal_uploads_owner_idx
  ON public.dept_journal_uploads (department, owner_name, journal_at DESC);

ALTER TABLE public.dept_journal_uploads ENABLE ROW LEVEL SECURITY;

-- Бачать ті самі, хто бачить справи відділу; додають — ті, хто їх пише, і лише від себе
DROP POLICY IF EXISTS "dept_journal_uploads_select" ON public.dept_journal_uploads;
CREATE POLICY "dept_journal_uploads_select" ON public.dept_journal_uploads
  FOR SELECT TO authenticated USING (public.dept_case_can_read(department));

DROP POLICY IF EXISTS "dept_journal_uploads_insert" ON public.dept_journal_uploads;
CREATE POLICY "dept_journal_uploads_insert" ON public.dept_journal_uploads
  FOR INSERT TO authenticated WITH CHECK (
    uploaded_by = auth.uid() AND public.dept_case_can_write(department)
  );
-- Оновлювати й видаляти облік нікому, крім власника бази через SQL Editor.
