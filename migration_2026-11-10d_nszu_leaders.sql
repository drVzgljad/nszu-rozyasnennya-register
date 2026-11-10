-- «Справи відділу»: керівники НСЗУ для маршруту документа (погоджувачі й підписанти) — з ПІБ.
-- Вимога користувача 10.11.2026: ПІБ не в публічному репозиторії, а в Supabase під RLS.
-- Таблицю читають лише співробітники порталу (роль не guest), змінює лише admin.
-- ДАНИХ У ЦЬОМУ ФАЙЛІ НЕМАЄ (файл деплоїться в публічний репозиторій): наповнення — окремим SQL у базі.
-- Застосовує власник через SQL Editor. Повторний запуск безпечний.

CREATE TABLE IF NOT EXISTS public.nszu_leaders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sort INT NOT NULL DEFAULT 100,
  kind TEXT NOT NULL CHECK (kind IN ('head', 'deputy', 'director', 'unit')),  -- Голова / заступник / директор / інше
  position TEXT NOT NULL,          -- «Директор Юридичного департаменту»
  department TEXT,                 -- «Юридичний департамент»
  full_name TEXT,                  -- «Ім'я ПРІЗВИЩЕ»
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.nszu_leaders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nszu_leaders_read ON public.nszu_leaders;
CREATE POLICY nszu_leaders_read ON public.nszu_leaders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IS DISTINCT FROM 'guest'));

DROP POLICY IF EXISTS nszu_leaders_write ON public.nszu_leaders;
CREATE POLICY nszu_leaders_write ON public.nszu_leaders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
