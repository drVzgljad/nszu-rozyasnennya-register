-- ============================================================
-- Дорадча кімната (тет-а-тет) у голосі відділу + відновлення дзвінків 1:1 і голосу кімнат чату
-- 25.11.2026 · spravy/voice.js, zviazok/voice.js
--
-- Що сталося. migration_2026-11-10b_voice_knock.sql переписала voice_room_allowed() на основі
-- версії 03b і загубила гілки з migration_2026-11-03d_chat_voice_rooms.sql:
--   'voice:lobby'               — «хто де в голосі»;
--   'voice:room:<uuid>'         — голос кімнати чату;
--   'voice:dm:<uuid>:<uuid>'    — дзвінок 1:1.
-- Перевірено в живій базі 25.11.2026 (pg_get_functiondef): цих гілок немає, канали закриті.
--
-- Дорадча кімната відділу (керівник кличе колегу поговорити віч-на-віч) — це той самий канал
-- 1:1 'voice:dm:<uuid>:<uuid>': зайти можуть лише двоє, чиї id стоять у назві. Нових таблиць немає.
--
-- Ця версія = 10b (стук, 'ok' 12 годин) + гілки 03d. Застосовує власник через SQL Editor.
-- Повторний запуск безпечний.
-- ============================================================

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
        -- кімната департаменту і «хто де в голосі» — усі співробітники
        p_topic IN ('voice:all', 'voice:lobby')
        -- кімната відділу: свій відділ, керівництво або гість, якого пустили за стуком (12 годин)
        OR (p_topic LIKE 'voice:dept:%' AND (
              p.role IN ('admin', 'director', 'deputy_director')
              OR (p."Section" IS NOT NULL AND public.voice_room_topic(p."Section") = p_topic)
              OR EXISTS (SELECT 1 FROM public.voice_knocks k
                         WHERE k.topic = p_topic AND k.user_id = auth.uid() AND k.status = 'ok'
                           AND k.decided_at > now() - interval '12 hours')))
        -- голос кімнати чату — той, хто бачить кімнату (відкрита або ти учасник)
        OR (p_topic ~ '^voice:room:[0-9a-f-]{36}$' AND EXISTS (
              SELECT 1 FROM public.chat_rooms r
              WHERE r.id::text = substr(p_topic, 12)
                AND (r.is_public OR p.id = ANY (r.member_ids))))
        -- дзвінок 1:1 і дорадча кімната відділу — лише ті двоє, чиї id стоять у назві каналу
        OR (p_topic ~ '^voice:dm:[0-9a-f-]{36}:[0-9a-f-]{36}$'
              AND p.id::text IN (substr(p_topic, 10, 36), substr(p_topic, 47, 36)))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.voice_room_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voice_room_allowed(TEXT) TO authenticated;

-- Перевірка після застосування (має бути true):
--   select pg_get_functiondef('public.voice_room_allowed(text)'::regprocedure) like '%voice:dm:%';
