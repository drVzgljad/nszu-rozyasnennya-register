-- ============================================================
-- «Чат департаменту» (zviazok/) — текст і голос у кожній кімнаті
-- 03.11.2026 · доповнює migration_2026-11-03_voice_room.sql і …03b_voice_room_all.sql
--
-- Новий розділ працює на ТИХ САМИХ таблицях, що й старий чат (chat_messages,
-- chat_rooms, chat_reactions, chat_pings): історію не переносимо, вона просто є.
-- Ця міграція додає лише те, чого бракує:
--   1) відповідь на повідомлення (reply_to) і час редагування (edited_at);
--   2) закріплення через функцію: після посилення RLS оновлювати чуже повідомлення
--      не можна, а кнопка 📌 у старому чаті так і лишилася — і мовчки не працювала;
--   3) голос у кімнатах чату: приватні канали Realtime
--        'voice:room:<uuid кімнати>'  — хто бачить кімнату, той і заходить;
--        'voice:dm:<uuid>:<uuid>'     — дзвінок 1:1, лише двоє учасників;
--        'voice:lobby'                — хто в якому голосі (для списку кімнат).
--
-- Ідемпотентна: можна запускати повторно.
-- ============================================================

-- 1. Відповіді й позначка «змінено» ---------------------------------------
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL;
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
-- Сторінка тягне останні N повідомлень кімнати — без індексу це повний перебір
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created
  ON public.chat_messages (room_id, created_at DESC);

-- 2. Закріплення -----------------------------------------------------------
-- Закріпити (чи відкріпити) може: автор повідомлення; творець кімнати; будь-який
-- учасник закритої кімнати; керівництво (manager і вище). Особисті діалоги — ні.
CREATE OR REPLACE FUNCTION public.chat_set_pin(p_id UUID, p_top BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_msg  RECORD;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role = 'guest' THEN
    RAISE EXCEPTION 'Закріплювати можуть лише співробітники';
  END IF;

  SELECT m.user_id, m.room_id, m.recipient_id, r.created_by, r.is_public, r.member_ids
    INTO v_msg
    FROM public.chat_messages m
    LEFT JOIN public.chat_rooms r ON r.id = m.room_id
   WHERE m.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Повідомлення не знайдено';
  END IF;
  IF v_msg.recipient_id IS NOT NULL THEN
    RAISE EXCEPTION 'В особистих діалогах закріплення немає';
  END IF;
  -- Закрита кімната: лише її учасники (інакше функція відкрила б чуже)
  IF v_msg.room_id IS NOT NULL AND NOT (v_msg.is_public OR auth.uid() = ANY (v_msg.member_ids)) THEN
    RAISE EXCEPTION 'Немає доступу до кімнати';
  END IF;

  IF NOT (
       v_msg.user_id = auth.uid()
    OR v_msg.created_by = auth.uid()
    OR (v_msg.room_id IS NOT NULL AND NOT v_msg.is_public)
    OR v_role IN ('manager', 'deputy_director', 'director', 'admin')
  ) THEN
    RAISE EXCEPTION 'Закріпити може автор, творець кімнати або керівник';
  END IF;

  UPDATE public.chat_messages SET is_top = p_top WHERE id = p_id;
  RETURN p_top;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_set_pin(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_set_pin(UUID, BOOLEAN) TO authenticated;

-- 3. Голос у кімнатах чату ---------------------------------------------------
-- Політики на realtime.messages (voice_room_read / voice_room_write) лишаються
-- з першої міграції — розширюється лише функція, яку вони викликають.
-- Гілки 'voice:all' і 'voice:dept:%' — без змін (ними користуються «Справи»).
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
        -- кімната відділу («Справи») — свій відділ або керівництво
        OR (p_topic LIKE 'voice:dept:%' AND (
              p.role IN ('admin', 'director', 'deputy_director')
              OR (p."Section" IS NOT NULL AND public.voice_room_topic(p."Section") = p_topic)))
        -- голос кімнати чату — той, хто бачить кімнату (відкрита або ти учасник)
        OR (p_topic ~ '^voice:room:[0-9a-f-]{36}$' AND EXISTS (
              SELECT 1 FROM public.chat_rooms r
              -- порівнюємо текстом: ::uuid упав би на чужій назві каналу, бо
              -- Postgres не обіцяє перевірити регулярку раніше за приведення
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

-- Перевірка після застосування:
--   select column_name from information_schema.columns
--    where table_name = 'chat_messages' and column_name in ('reply_to', 'edited_at');  -- 2 рядки
--   select public.voice_room_allowed('voice:lobby');  -- у SQL Editor false (там немає auth.uid()), це нормально
