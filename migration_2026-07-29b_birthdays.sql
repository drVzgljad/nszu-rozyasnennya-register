-- ============================================================
-- Міграція: дні народження співробітників департаменту
-- Дата: 2026-07-29
-- Виконати вручну в Supabase SQL Editor (проєкт qdqtkvyvhtjgxpxnvblk).
--
-- ⚠️ Дані свідомо НЕ лежать у репозиторії: він публічний
-- (github.com/drVzgljad/nszu-rozyasnennya-register, private = false),
-- і будь-який файл із нього роздається сайтом без авторизації.
-- Тут — тільки день і місяць, без року народження.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_birthdays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),

  full_name TEXT NOT NULL UNIQUE,           -- написання як у структурі департаменту
  birth_day INT NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
  birth_month INT NOT NULL CHECK (birth_month BETWEEN 1 AND 12),

  -- Прив'язка до профілю сайту; NULL — зіставлення за прізвищем на клієнті
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  active BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE public.staff_birthdays IS
  'Дні народження співробітників (день і місяць, без року). Персональні дані — тільки для авторизованих, редагують керівництво та діловод.';

CREATE INDEX IF NOT EXISTS idx_staff_birthdays_month_day
  ON public.staff_birthdays(birth_month, birth_day);

ALTER TABLE public.staff_birthdays ENABLE ROW LEVEL SECURITY;

-- Читання: будь-який авторизований співробітник, але не гість
DROP POLICY IF EXISTS "staff_birthdays_select" ON public.staff_birthdays;
CREATE POLICY "staff_birthdays_select" ON public.staff_birthdays
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role <> 'guest'
  ));

-- Зміни: керівництво департаменту та діловод
DROP POLICY IF EXISTS "staff_birthdays_write" ON public.staff_birthdays;
CREATE POLICY "staff_birthdays_write" ON public.staff_birthdays
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_clerk = TRUE)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_clerk = TRUE)
  ));

-- ── Наповнення ──────────────────────────────────────────────
-- Список прізвищ і дат свідомо НЕ зберігається в репозиторії: він публічний,
-- і будь-який файл із нього роздається сайтом без авторизації.
-- Сід лежить локально: 05_Веб_реєстр/_seeds_local/seed_birthdays.sql
-- Далі дані ведуться прямо в Supabase (редагують керівництво та діловод).
