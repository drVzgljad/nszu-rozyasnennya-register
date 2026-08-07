-- ============================================================
-- Міграція: публічні канали + категорії + канали-відділи + пінги
-- Дата: 2026-07-23 (c)
-- «Дискордизація» робочого чату — Фаза 1.
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт). Ідемпотентна.
-- ============================================================

-- 1) Розширення chat_rooms до «каналів» ---------------------------------
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS is_public  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS category   TEXT;      -- назва категорії (групування в сайдбарі)
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 100;
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS topic      TEXT;      -- опис каналу (шапка)
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS icon       TEXT;      -- емодзі-іконка
ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS dept       TEXT;      -- прив'язка до відділу (для каналів-відділів)

-- 2) RLS: публічні канали видно всім співробітникам (не лише member_ids) --
DROP POLICY IF EXISTS "Users can view rooms they are members of" ON public.chat_rooms;
DROP POLICY IF EXISTS "Users can view public or member rooms" ON public.chat_rooms;
CREATE POLICY "Users can view public or member rooms" ON public.chat_rooms
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role <> 'guest')
    AND (is_public = true OR auth.uid() = ANY(member_ids))
  );

-- Керування каналами: творець або адмін/директор (перейменувати/видалити)
DROP POLICY IF EXISTS "Room owners or admins can update rooms" ON public.chat_rooms;
CREATE POLICY "Room owners or admins can update rooms" ON public.chat_rooms
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = created_by
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','director'))
  ) WITH CHECK (true);

DROP POLICY IF EXISTS "Room owners or admins can delete rooms" ON public.chat_rooms;
CREATE POLICY "Room owners or admins can delete rooms" ON public.chat_rooms
  FOR DELETE TO authenticated
  USING (
    auth.uid() = created_by
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','director'))
  );

-- 3) RLS повідомлень: дозволити читати повідомлення публічних каналів -----
DROP POLICY IF EXISTS "Full access users can read chat" ON public.chat_messages;
CREATE POLICY "Full access users can read chat" ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role <> 'guest')
    AND (
      (room_id IS NULL AND (recipient_id IS NULL OR user_id = auth.uid() OR recipient_id = auth.uid()))
      OR (room_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.chat_rooms r
        WHERE r.id = room_id AND (r.is_public = true OR auth.uid() = ANY(r.member_ids))
      ))
    )
  );

-- 4) Засів публічних каналів (тематичні) — ідемпотентно ------------------
INSERT INTO public.chat_rooms (name, category, is_public, sort_order, icon, member_ids)
SELECT v.name, v.category, true, v.sort_order, v.icon, '{}'::uuid[]
FROM (VALUES
  ('Загальний',            '📢 Загальне',    1, '💬'),
  ('Оголошення',           '📢 Загальне',    2, '📣'),
  ('Пакети ПМГ-2026',      '📋 Робота',      1, '📦'),
  ('Постанова 1808',       '📋 Робота',      2, '⚖️'),
  ('Договори із ЗОЗ',      '📋 Робота',      3, '📄'),
  ('СКО-Д і звіти',        '📋 Робота',      4, '📊'),
  ('Питання–відповіді',    '❓ Взаємодія',   1, '❓'),
  ('IT / портал',          '❓ Взаємодія',   2, '🛠️'),
  ('Флуд / позаробоче',    '☕ Позаробоче',  1, '☕')
) AS v(name, category, sort_order, icon)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_rooms r WHERE r.name = v.name AND r.is_public = true
);

-- 5) Засів каналів-відділів (публічні, з прив'язкою dept) ----------------
INSERT INTO public.chat_rooms (name, category, is_public, sort_order, icon, dept, member_ids)
SELECT v.name, '📁 Відділи', true, v.sort_order, v.icon, v.dept, '{}'::uuid[]
FROM (VALUES
  ('Електронні медичні дані',        1, '🗂️', 'робота з електронними медичними даними'),
  ('Вартість медичних послуг',       2, '💰', 'розрахунок вартості медичних послуг'),
  ('Стратегічний розвиток ПМГ',      3, '🎯', 'стратегічного розвитку програми медичних гарантій'),
  ('Наукова та клінічна експертиза', 4, '🔬', 'наукова та клінічна експертиза'),
  ('Програма реімбурсації',          5, '💊', 'розвиток програми реімбурсації'),
  ('Взаємодія з надавачами',         6, '🤝', 'взаємодія з надавачами медичних послуг')
) AS v(name, sort_order, icon, dept)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chat_rooms r WHERE r.dept = v.dept AND r.is_public = true
);

-- 6) Пінги «зайди на канал» ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id UUID REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  room_name TEXT,
  note TEXT,
  seen BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_chat_pings_recipient ON public.chat_pings(recipient_id, seen);

ALTER TABLE public.chat_pings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own pings" ON public.chat_pings;
CREATE POLICY "read own pings" ON public.chat_pings
  FOR SELECT TO authenticated
  USING (auth.uid() = recipient_id OR auth.uid() = sender_id);

DROP POLICY IF EXISTS "send pings" ON public.chat_pings;
CREATE POLICY "send pings" ON public.chat_pings
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role <> 'guest')
  );

DROP POLICY IF EXISTS "recipient updates ping" ON public.chat_pings;
CREATE POLICY "recipient updates ping" ON public.chat_pings
  FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_pings;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
