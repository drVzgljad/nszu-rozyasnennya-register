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


-- 4. СТВОРЕННЯ ТАБЛИЦІ ЖИВОГО ЧАТУ (Тільки для повного доступу 'full')
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

-- Редагувати свої повідомлення можуть тільки користувачі з роллю 'full'
CREATE POLICY "Full access users can update their own messages" ON public.chat_messages
  FOR UPDATE USING (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'full'
    )
  ) WITH CHECK (
    auth.uid() = user_id AND
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
