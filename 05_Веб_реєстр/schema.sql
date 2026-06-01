-- 1. СТВОРЕННЯ ТАБЛИЦІ ПИТАНЬ ЗОЗ
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT,
  organization TEXT,
  category TEXT,
  question_text TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending' (на розгляді) | 'answered' (відповідь надана)
  answer_text TEXT,
  answered_at TIMESTAMP WITH TIME ZONE
);

-- Увімкнення RLS для таблиці питань
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

-- Політика читання: користувач може бачити всі публічно надані відповіді, або власні питання (навіть без відповіді)
CREATE POLICY "Users can view answered questions or their own" ON public.questions
  FOR SELECT USING (
    status = 'answered' OR auth.uid() = user_id
  );

-- Політика створення: тільки авторизовані користувачі можуть залишати питання
CREATE POLICY "Authenticated users can insert questions" ON public.questions
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND auth.uid() = user_id
  );


-- 2. СТВОРЕННЯ ТАБЛИЦІ ПРОПОЗИЦІЙ ПМГ
CREATE TABLE IF NOT EXISTS public.proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT,
  package_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  upvotes INTEGER DEFAULT 0,
  voted_users JSONB DEFAULT '[]'::jsonb
);

-- Увімкнення RLS для таблиці пропозицій
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

-- Читати пропозиції можуть всі авторизовані користувачі
CREATE POLICY "Authenticated users can view proposals" ON public.proposals
  FOR SELECT USING (auth.role() = 'authenticated');

-- Створювати пропозиції можуть всі авторизовані користувачі
CREATE POLICY "Authenticated users can insert proposals" ON public.proposals
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND auth.uid() = user_id
  );

-- Оновлювати (для лайків/голосування) можуть всі авторизовані
CREATE POLICY "Authenticated users can update proposals" ON public.proposals
  FOR UPDATE USING (auth.role() = 'authenticated');


-- 3. СТВОРЕННЯ ТАБЛИЦІ НОВИН (Тільки для повного доступу 'full')
CREATE TABLE IF NOT EXISTS public.news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT NOT NULL,
  image_url TEXT,
  tags TEXT[]
);

-- Увімкнення RLS для таблиці новин
ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;

-- Тільки користувачі з роллю 'full' можуть бачити аналітичні новини
CREATE POLICY "Full access users can view news" ON public.news
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    )
  );


-- 4. СТВОРЕННЯ ТАБЛИЦІ РОБОЧОГО ЧАТУ (Тільки для повного доступу 'full')
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  message_text TEXT NOT NULL
);

-- Увімкнення RLS для таблиці повідомлень чату
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Читати повідомлення чату можуть тільки користувачі з роллю 'full'
CREATE POLICY "Full access users can read chat" ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    )
  );

-- Писати в чат можуть тільки користувачі з роллю 'full' від свого імені
CREATE POLICY "Full access users can send chat messages" ON public.chat_messages
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    )
  );

-- Додавання стовпчика для закріплення повідомлень (топ-повідомлень)
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS is_top BOOLEAN DEFAULT FALSE;

-- Редагувати або закріплювати повідомлення можуть користувачі з роллю 'full'
CREATE POLICY "Full access users can update chat messages" ON public.chat_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    )
  );

-- Видаляти свої повідомлення можуть тільки користувачі з роллю 'full'
CREATE POLICY "Full access users can delete their own messages" ON public.chat_messages
  FOR DELETE USING (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    )
  );

-- Додавання таблиці чату до публікації реального часу для Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- 5. ДОДАВАННЯ ПРИВАТНИХ ПОВІДОМЛЕНЬ (ДІАЛОГІВ)
-- Додаємо стовпчик recipient_id для приватних повідомлень
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Створюємо індекс для прискорення пошуку приватних діалогів
CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient ON public.chat_messages(recipient_id);

-- Видаляємо стару політику вибірки
DROP POLICY IF EXISTS "Full access users can read chat" ON public.chat_messages;

-- 5. ДОДАВАННЯ ПРИВАТНИХ ПОВІДОМЛЕНЬ ТА ГРУПОВИХ ЧАТІВ
-- Додаємо стовпчик recipient_id для приватних повідомлень
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient ON public.chat_messages(recipient_id);

-- Створюємо таблицю групових чатів
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  name TEXT NOT NULL,
  member_ids UUID[] NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Увімкнення RLS для кімнат
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;

-- Додавання до Realtime публікації
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;

-- Політика читання кімнат: користувач повинен бути в масиві членів
CREATE POLICY "Users can view rooms they are members of" ON public.chat_rooms
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = ANY(member_ids) AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    )
  );

-- Політика створення кімнат
CREATE POLICY "Users can create rooms" ON public.chat_rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    )
  );

-- Додаємо стовпчик room_id в повідомлення чату
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES public.chat_rooms(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON public.chat_messages(room_id);

-- Створюємо оновлену політику вибірки повідомлень, що дозволяє читання групових та приватних повідомлень
CREATE POLICY "Full access users can read chat" ON public.chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    ) AND (
      (room_id IS NULL AND (recipient_id IS NULL OR user_id = auth.uid() OR recipient_id = auth.uid())) OR
      (room_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.chat_rooms r
        WHERE r.id = room_id AND auth.uid() = ANY(r.member_ids)
      ))
    )
  );
