-- ============================================================
-- Спільна дорадча кімната відділу: 'voice:tet:<хеш відділу>'
-- 25.11.2026 · spravy/voice.js · доповнює migration_2026-11-25_voice_tet.sql
--
-- Користувач: «ми заходимо в різні кімнати і не бачимо одне одного в дорадчій». Перша версія садила
-- кожного, хто заходив сам, у власний канал 1:1 («я — я»). Тепер дорадча — ДРУГА кімната відділу поруч
-- з офісом: канал 'voice:tet:<той самий хеш, що й voice:dept:>'. Заходять ті самі, що й в офіс відділу:
-- свій відділ, керівництво департаменту, гість, якого пустили в офіс за стуком (12 годин).
--
-- Основа — ЖИВЕ визначення функції на 25.11.2026 (pg_get_functiondef), до нього додано лише гілку
-- 'voice:tet:%'. Застосовує власник через SQL Editor. Повторний запуск безпечний.
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
        -- дорадча кімната відділу (25.11.2026): ті самі люди, що й в офіс цього відділу
        OR (p_topic LIKE 'voice:tet:%' AND (
              p.role IN ('admin', 'director', 'deputy_director')
              OR (p."Section" IS NOT NULL
                  AND replace(public.voice_room_topic(p."Section"), 'voice:dept:', 'voice:tet:') = p_topic)
              OR EXISTS (SELECT 1 FROM public.voice_knocks k
                         WHERE k.topic = replace(p_topic, 'voice:tet:', 'voice:dept:') AND k.user_id = auth.uid()
                           AND k.status = 'ok' AND k.decided_at > now() - interval '12 hours')))
        -- голос кімнати чату — той, хто бачить кімнату (відкрита або ти учасник)
        OR (p_topic ~ '^voice:room:[0-9a-f-]{36}$' AND EXISTS (
              SELECT 1 FROM public.chat_rooms r
              WHERE r.id::text = substr(p_topic, 12)
                AND (r.is_public OR p.id = ANY (r.member_ids))))
        -- дзвінок 1:1 — лише ті двоє, чиї id стоять у назві каналу
        OR (p_topic ~ '^voice:dm:[0-9a-f-]{36}:[0-9a-f-]{36}$'
              AND p.id::text IN (substr(p_topic, 10, 36), substr(p_topic, 47, 36)))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.voice_room_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voice_room_allowed(TEXT) TO authenticated;

-- Перевірка після застосування (має бути true):
--   select pg_get_functiondef('public.voice_room_allowed(text)'::regprocedure) like '%voice:tet:%';
