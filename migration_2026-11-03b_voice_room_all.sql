-- ============================================================
-- Голосова кімната ДЕПАРТАМЕНТУ (spravy/voice.js, перемикач «Департамент»)
-- 03.11.2026 · доповнює migration_2026-11-03_voice_room.sql
--
-- Окрім кімнат відділів ('voice:dept:<хеш>') — одна спільна кімната
-- 'voice:all' для всіх співробітників порталу, крім гостей. Сюди
-- потрапляють і ті, у кого відділ у профілі порожній чи записаний не так.
-- Текстовий канал департаменту — наявна кімната «Загальний» чату порталу,
-- для неї нічого міняти не треба.
--
-- Політики на realtime.messages лишаються ті самі — змінюється лише функція.
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
        -- кімната департаменту — усі співробітники
        p_topic = 'voice:all'
        -- кімната відділу — свій відділ або керівництво
        OR (p_topic LIKE 'voice:dept:%' AND (
              p.role IN ('admin', 'director', 'deputy_director')
              OR (p."Section" IS NOT NULL AND public.voice_room_topic(p."Section") = p_topic)))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.voice_room_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voice_room_allowed(TEXT) TO authenticated;
