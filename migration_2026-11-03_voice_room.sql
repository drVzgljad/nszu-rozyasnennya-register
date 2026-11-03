-- ============================================================
-- Голосова кімната відділу в розділі «Справи» (spravy/voice.js)
-- 03.11.2026
--
-- Голос іде напряму між браузерами (WebRTC), у базу не пишеться нічого.
-- Через Supabase Realtime проходять лише службові повідомлення:
-- хто зараз у кімнаті (presence) і рукостискання з'єднань (broadcast).
-- Тому кімната — ПРИВАТНИЙ канал Realtime, і впустити в нього має право
-- лише свій відділ і керівництво департаменту. Без цих правил приватний
-- канал не відкриється нікому (на realtime.messages досі політик не було).
--
-- Назва каналу: 'voice:dept:' + перші 16 hex-знаків SHA-256 від назви
-- відділу (profiles."Section"). Хеш — щоб кирилиця не йшла в назву каналу;
-- сторінка рахує його так само (crypto.subtle).
--
-- Публічний канал з тією самою назвою Realtime вважає іншим каналом і
-- повідомлень між ними не передає — вимикати «Allow public access» у
-- налаштуваннях Realtime не потрібно (на публічних каналах живе чат).
-- ============================================================

CREATE OR REPLACE FUNCTION public.voice_room_topic(p_dept TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'voice:dept:' || left(encode(sha256(convert_to(p_dept, 'UTF8')), 'hex'), 16);
$$;

-- Хто може зайти в кімнату з такою назвою: свій відділ або керівництво
-- (керівництво бачить справи всіх відділів — так само й заходить у кімнату
-- будь-якого відділу). Гості й діловод-«лише читання» — ні: діловод у кімнаті
-- свого відділу й так буде, якщо в нього заповнено Section.
CREATE OR REPLACE FUNCTION public.voice_room_allowed(p_topic TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_topic LIKE 'voice:dept:%' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IS DISTINCT FROM 'guest'
      AND (
        p.role IN ('admin', 'director', 'deputy_director')
        OR (p."Section" IS NOT NULL AND public.voice_room_topic(p."Section") = p_topic)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.voice_room_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voice_room_allowed(TEXT) TO authenticated;

DROP POLICY IF EXISTS "voice_room_read" ON realtime.messages;
CREATE POLICY "voice_room_read" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND public.voice_room_allowed((SELECT realtime.topic()))
  );

DROP POLICY IF EXISTS "voice_room_write" ON realtime.messages;
CREATE POLICY "voice_room_write" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND public.voice_room_allowed((SELECT realtime.topic()))
  );

-- Перевірка після застосування (має повернути назву каналу вашого відділу):
--   select public.voice_room_topic('наукова та клінічна експертиза');
