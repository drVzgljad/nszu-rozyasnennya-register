-- ============================================================
-- Наради в голосовій кімнаті · 03.11.2026
--   Кнопка «🔴 Нарада» вмикає запис (кожен учасник — окрема доріжка: так у протоколі
--   точно відомо, хто що сказав), «⏹ Кінець наради» вивантажує доріжки в приватний
--   кошик meetings. Далі tools\narady_sync.py забирає їх у вхідні, розшифровує
--   локально (Whisper, звук нікуди не йде) — і Claude робить протокол та доручення.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dept_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT NOT NULL,                 -- відділ ініціатора (за ним — доступ)
  room_topic TEXT NOT NULL,                 -- канал голосу: voice:all / voice:dept:… / voice:room:…
  room_label TEXT,                          -- «Кімната відділу», «Чат департаменту»…
  title TEXT,                               -- тема наради (необовʼязково)
  started_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  started_by_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ uid, name }]
  tracks JSONB NOT NULL DEFAULT '[]'::jsonb,        -- [{ path, uid, name, offset_ms, dur_ms, bytes }]
  status TEXT NOT NULL DEFAULT 'recording'
    CHECK (status IN ('recording', 'uploaded', 'fetched', 'transcribed', 'protocol', 'failed')),
  local_dir TEXT,                           -- куди скрипт поклав запис у вхідних
  protocol TEXT,                            -- протокол (markdown), коли готовий
  case_ids UUID[] NOT NULL DEFAULT '{}',    -- справи, заведені з доручень наради
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dept_meetings_status_idx ON public.dept_meetings (status, started_at DESC);

ALTER TABLE public.dept_meetings ENABLE ROW LEVEL SECURITY;

-- Бачать: свій відділ (і керівництво — так само, як справи) та сам ініціатор
DROP POLICY IF EXISTS "dept_meetings_select" ON public.dept_meetings;
CREATE POLICY "dept_meetings_select" ON public.dept_meetings
  FOR SELECT TO authenticated
  USING (started_by = auth.uid() OR public.dept_case_can_read(department));

DROP POLICY IF EXISTS "dept_meetings_insert" ON public.dept_meetings;
CREATE POLICY "dept_meetings_insert" ON public.dept_meetings
  FOR INSERT TO authenticated
  WITH CHECK (started_by = auth.uid() AND public.dept_case_can_write(department));

DROP POLICY IF EXISTS "dept_meetings_update" ON public.dept_meetings;
CREATE POLICY "dept_meetings_update" ON public.dept_meetings
  FOR UPDATE TO authenticated
  USING (started_by = auth.uid() OR public.dept_case_can_write(department))
  WITH CHECK (started_by = auth.uid() OR public.dept_case_can_write(department));

-- Приватний кошик для доріжок: <id наради>/<NN>_<зсув мс>_<хто>.webm
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('meetings', 'meetings', false, 209715200, ARRAY['audio/webm', 'audio/ogg', 'audio/mp4'])
ON CONFLICT (id) DO NOTHING;

-- Нарада, до якої належить файл: перша тека шляху = id наради
CREATE OR REPLACE FUNCTION public.meeting_file_can(p_name TEXT, p_write BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dept_meetings m
    WHERE m.id::text = split_part(p_name, '/', 1)
      AND (m.started_by = auth.uid()
           OR (CASE WHEN p_write THEN public.dept_case_can_write(m.department)
                    ELSE public.dept_case_can_read(m.department) END))
  );
$$;

DROP POLICY IF EXISTS "meetings_files_insert" ON storage.objects;
CREATE POLICY "meetings_files_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'meetings' AND public.meeting_file_can(name, true));

DROP POLICY IF EXISTS "meetings_files_select" ON storage.objects;
CREATE POLICY "meetings_files_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'meetings' AND public.meeting_file_can(name, false));

-- Видаляє скрипт, коли запис уже у вхідних (місце в кошику не безмежне)
DROP POLICY IF EXISTS "meetings_files_delete" ON storage.objects;
CREATE POLICY "meetings_files_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'meetings' AND public.meeting_file_can(name, true));

-- Перевірка: select status, count(*) from public.dept_meetings group by 1;   -- без помилки
--            select id, public from storage.buckets where id = 'meetings';    -- 1 рядок, false
