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

-- Тільки зареєстровані користувачі (не гості) можуть бачити аналітичні новини
CREATE POLICY "Full access users can view news" ON public.news
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role != 'guest'
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

-- Писати в чат можуть тільки користувачі з роллю (крім гостей) від свого імені
CREATE POLICY "Full access users can send chat messages" ON public.chat_messages
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role != 'guest'
    )
  );

-- Додавання стовпчика для закріплення повідомлень (топ-повідомлень)
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS is_top BOOLEAN DEFAULT FALSE;

-- Редагувати або закріплювати повідомлення можуть користувачі з роллю (крім гостей)
CREATE POLICY "Full access users can update chat messages" ON public.chat_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role != 'guest'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role != 'guest'
    )
  );

-- Видаляти свої повідомлення можуть тільки користувачі з роллю (крім гостей)
CREATE POLICY "Full access users can delete their own messages" ON public.chat_messages
  FOR DELETE USING (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role != 'guest'
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

-- Політика читання кімнат: користувач повинен бути в кімнаті та не бути гостем
CREATE POLICY "Users can view rooms they are members of" ON public.chat_rooms
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = ANY(member_ids) AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role != 'guest'
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
      WHERE id = auth.uid() AND role != 'guest'
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
      WHERE id = auth.uid() AND role != 'guest'
    ) AND (
      (room_id IS NULL AND (recipient_id IS NULL OR user_id = auth.uid() OR recipient_id = auth.uid())) OR
      (room_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.chat_rooms r
        WHERE r.id = room_id AND auth.uid() = ANY(r.member_ids)
      ))
    )
  );


-- =========================================================================
-- 6. СИСТЕМА КОДОВОЇ ОЦІНКИ ДІЯЛЬНОСТІ ДЕПАРТАМЕНТУ (СКО-Д)
-- =========================================================================

-- Таблиця записів діяльності (логів) СКО-Д
CREATE TABLE IF NOT EXISTS public.skod_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  department TEXT NOT NULL,
  log_date DATE DEFAULT CURRENT_DATE,
  start_time TIME NOT NULL,
  duration_minutes INTEGER,
  branch TEXT NOT NULL DEFAULT 'department', -- 'askod' | 'department'
  task_type TEXT NOT NULL,
  category TEXT,
  severity_level TEXT NOT NULL,          -- 'easy', 'medium', 'hard', 'expert'
  complexity_coefficient NUMERIC NOT NULL, -- наприклад: 1.0, 1.3, 1.8, 2.5
  score NUMERIC,                         -- розраховується: (duration_minutes / 60.0) * complexity_coefficient
  status TEXT NOT NULL DEFAULT 'completed', -- 'completed' | 'in_progress'
  description TEXT,
  subtask_id TEXT
);

-- Увімкнення RLS для таблиці логів СКО-Д
ALTER TABLE public.skod_logs ENABLE ROW LEVEL SECURITY;

-- Політика читання: користувач бачить свої записи, керівники бачать записи свого відділу, керівництво департаменту бачить все
CREATE POLICY "Users can view skod logs" ON public.skod_logs
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (role IN ('admin', 'director', 'deputy_director') OR department = skod_logs.department)
    )
  );

-- Політика створення: кожен зареєстрований користувач може вносити записи про власну діяльність
CREATE POLICY "Users can insert their own skod logs" ON public.skod_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
  );

-- Політика видалення: користувач може видалити тільки свій запис протягом поточного дня
CREATE POLICY "Users can delete their own skod logs of today" ON public.skod_logs
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id AND log_date = CURRENT_DATE
  );

-- Політика оновлення: користувач може оновлювати свої власні записи (для завершення завдань "в процесі")
CREATE POLICY "Users can update their own skod logs" ON public.skod_logs
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
  )
  WITH CHECK (
    auth.uid() = user_id
  );


-- =========================================================================
-- 7. СИСТЕМА ДОРУЧЕНЬ ТА ЗАВДАНЬ (КОНТРОЛЬ ВИКОНАННЯ)
-- =========================================================================

-- Оновлення профілів користувачів з підтримкою посад
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS position TEXT DEFAULT 'Співробітник';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_head BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS organization TEXT DEFAULT 'Департамент стратегії НСЗУ';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'registered';

-- Таблиця доручень та завдань
CREATE TABLE IF NOT EXISTS public.assigned_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_name TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT NOT NULL, -- відділ
  responsible_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  responsible_name TEXT,
  deadline DATE,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  status TEXT NOT NULL DEFAULT 'assigned', -- 'assigned' | 'in_progress' | 'completed' | 'planning' | 'rejected'
  description TEXT,
  subtasks JSONB DEFAULT '[]'::jsonb,
  plan_details TEXT,
  rejection_reason TEXT,
  comments JSONB DEFAULT '[]'::jsonb,
  attachments JSONB DEFAULT '[]'::jsonb
);

-- Додавання зв'язку в логах СКО-Д до завдань
ALTER TABLE public.skod_logs ADD COLUMN IF NOT EXISTS assigned_task_id UUID REFERENCES public.assigned_tasks(id) ON DELETE SET NULL;

-- Увімкнення RLS для таблиці доручень
ALTER TABLE public.assigned_tasks ENABLE ROW LEVEL SECURITY;

-- Політика читання: будь-який авторизований користувач бачить усі завдання
CREATE POLICY "Anyone can view assigned tasks" ON public.assigned_tasks
  FOR SELECT TO authenticated USING (TRUE);

-- Політика створення: тільки керівництво департаменту та відділів може створювати завдання
CREATE POLICY "Managers can insert assigned tasks" ON public.assigned_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'director', 'deputy_director', 'manager')
    )
  );

-- Політика оновлення: творець завдання, відповідальний виконавець або будь-який керівник
CREATE POLICY "Responsible users or managers can update assigned tasks" ON public.assigned_tasks
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = created_by OR auth.uid() = responsible_id OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'director', 'deputy_director', 'manager')
    )
  )
  WITH CHECK (TRUE);

-- Політика видалення: тільки творець або Директори/Заступники/Адміни
CREATE POLICY "Creators or directors can delete assigned tasks" ON public.assigned_tasks
  FOR DELETE TO authenticated
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'director', 'deputy_director')
    )
  );

-- Автоматичний тригер для обробки профілів при реєстрації користувачів
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_organization TEXT;
  v_department TEXT;
  v_position TEXT;
  v_role TEXT;
  v_is_head BOOLEAN;
BEGIN
  v_organization := COALESCE(new.raw_user_meta_data->>'organization', 'Департамент стратегії універсального охоплення населення медичними послугами');
  v_department := new.raw_user_meta_data->>'department';
  v_position := COALESCE(new.raw_user_meta_data->>'position', 'Співробітник');
  
  -- Determine role based on department and position
  IF v_department = 'Гість (інший департамент)' THEN
    v_role := 'guest';
    v_is_head := FALSE;
  ELSE
    v_role := CASE 
      WHEN v_position = 'Директор' THEN 'director'
      WHEN v_position = 'Заступник директора' THEN 'deputy_director'
      WHEN v_position = 'Начальник відділу' THEN 'manager'
      WHEN v_position = 'Адміністратор' THEN 'admin'
      ELSE 'expert'
    END;
    v_is_head := (v_position = 'Начальник відділу');
  END IF;

  INSERT INTO public.profiles (id, full_name, organization, "Section", position, role, is_head)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    v_organization,
    v_department,
    v_position,
    v_role,
    v_is_head
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    organization = EXCLUDED.organization,
    "Section" = EXCLUDED."Section",
    position = EXCLUDED.position,
    role = EXCLUDED.role,
    is_head = EXCLUDED.is_head;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Перестворення тригера
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- Тригер валідації призначень доручень
CREATE OR REPLACE FUNCTION public.validate_task_assignment()
RETURNS trigger AS $$
DECLARE
  creator_role TEXT;
  creator_dept TEXT;
  assignee_role TEXT;
  assignee_dept TEXT;
BEGIN
  -- Get creator details
  SELECT role, "Section" INTO creator_role, creator_dept 
  FROM public.profiles WHERE id = new.created_by;
  
  -- Get assignee details
  SELECT role, "Section" INTO assignee_role, assignee_dept 
  FROM public.profiles WHERE id = new.responsible_id;
  
  -- 1. Authorization check
  IF creator_role NOT IN ('admin', 'director', 'deputy_director', 'manager') THEN
    RAISE EXCEPTION 'Ви не маєте прав для створення доручень';
  END IF;
  
  -- 2. Rules for Manager (Керівник)
  IF creator_role = 'manager' THEN
    IF assignee_role != 'expert' THEN
      RAISE EXCEPTION 'Керівник може надавати доручення лише експертам';
    END IF;
    IF assignee_dept != creator_dept THEN
      RAISE EXCEPTION 'Керівник може надавати доручення лише співробітникам свого відділу';
    END IF;
  END IF;
  
  -- 3. Rules for Deputy Director (Заступник директора)
  IF creator_role = 'deputy_director' THEN
    IF assignee_role = 'director' THEN
      RAISE EXCEPTION 'Заступник директора не може надавати доручення директору';
    END IF;
  END IF;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_task_assignment ON public.assigned_tasks;
CREATE TRIGGER trg_validate_task_assignment
  BEFORE INSERT ON public.assigned_tasks
  FOR EACH ROW EXECUTE FUNCTION public.validate_task_assignment();



