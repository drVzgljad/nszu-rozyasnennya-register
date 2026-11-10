-- ============================================================
-- «Справи відділу»: колега з іншого відділу «стукає» в голосову кімнату відділу,
-- будь-хто з цього відділу пускає (вимога користувача 10.11.2026).
--
-- Як працює:
--   1) гість додає рядок у voice_knocks (status = 'wait') — топік кімнати, своє ім'я й відділ;
--   2) учасники кімнати бачать стук (Realtime postgres_changes, RLS — лише члени відділу й сам гість)
--      і будь-хто з них ставить 'ok' або 'no';
--   3) voice_room_allowed() пускає в приватний канал кімнати того, чий стук 'ok' (12 годин);
--   4) гість повертається до свого відділу — сторінка ставить 'gone', дозвіл знято.
-- Керівництво (admin/director/deputy_director) і раніше заходило в будь-яку кімнату без стуку.
--
-- Застосовує власник через SQL Editor. Повторний запуск безпечний.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.voice_knocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  topic TEXT NOT NULL CHECK (topic LIKE 'voice:dept:%'),   -- кімната, куди стукають
  room_label TEXT,                                          -- назва відділу-господаря (для показу)
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,                                                -- хто стукає
  from_dept TEXT,                                           -- з якого відділу
  status TEXT NOT NULL DEFAULT 'wait' CHECK (status IN ('wait', 'ok', 'no', 'gone')),
  decided_by_name TEXT,
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS voice_knocks_topic_status ON public.voice_knocks (topic, status);
CREATE INDEX IF NOT EXISTS voice_knocks_user ON public.voice_knocks (user_id);

-- Член кімнати відділу: свій відділ або керівництво (без гостей, без стуків)
CREATE OR REPLACE FUNCTION public.voice_room_member(p_topic TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_topic LIKE 'voice:dept:%' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IS DISTINCT FROM 'guest'
      AND (p.role IN ('admin', 'director', 'deputy_director')
           OR (p."Section" IS NOT NULL AND public.voice_room_topic(p."Section") = p_topic))
  );
$$;
REVOKE ALL ON FUNCTION public.voice_room_member(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voice_room_member(TEXT) TO authenticated;

-- Хто може зайти в канал кімнати: як і раніше (03b) + той, кого пустили (стук 'ok', 12 годин)
CREATE OR REPLACE FUNCTION public.voice_room_allowed(p_topic TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IS DISTINCT FROM 'guest'
      AND (
        p_topic = 'voice:all'
        OR (p_topic LIKE 'voice:dept:%' AND (
              p.role IN ('admin', 'director', 'deputy_director')
              OR (p."Section" IS NOT NULL AND public.voice_room_topic(p."Section") = p_topic)
              OR EXISTS (SELECT 1 FROM public.voice_knocks k
                         WHERE k.topic = p_topic AND k.user_id = auth.uid() AND k.status = 'ok'
                           AND k.decided_at > now() - interval '12 hours')))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.voice_room_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voice_room_allowed(TEXT) TO authenticated;

ALTER TABLE public.voice_knocks ENABLE ROW LEVEL SECURITY;

-- Бачать: сам гість і члени кімнати, куди стукають
DROP POLICY IF EXISTS voice_knocks_select ON public.voice_knocks;
CREATE POLICY voice_knocks_select ON public.voice_knocks FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.voice_room_member(topic));

-- Стукає лише сам за себе і лише співробітник (не гість порталу)
DROP POLICY IF EXISTS voice_knocks_insert ON public.voice_knocks;
CREATE POLICY voice_knocks_insert ON public.voice_knocks FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'wait'
              AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IS DISTINCT FROM 'guest'));

-- Рішення ухвалює член кімнати; гість може лише скасувати чи піти ('gone')
DROP POLICY IF EXISTS voice_knocks_update ON public.voice_knocks;
CREATE POLICY voice_knocks_update ON public.voice_knocks FOR UPDATE TO authenticated
  USING (public.voice_room_member(topic) OR user_id = auth.uid())
  WITH CHECK (public.voice_room_member(topic) OR (user_id = auth.uid() AND status = 'gone'));

DROP POLICY IF EXISTS voice_knocks_delete ON public.voice_knocks;
CREATE POLICY voice_knocks_delete ON public.voice_knocks FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Стуки приходять у кімнату миттєво (Realtime postgres_changes)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'voice_knocks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_knocks;
  END IF;
END $$;

-- Перевірка: має повернути 0 рядків і без помилки
-- SELECT * FROM public.voice_knocks LIMIT 1;
