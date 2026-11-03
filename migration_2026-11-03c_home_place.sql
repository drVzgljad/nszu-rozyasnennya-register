-- Місце співробітника для інформаційних панелей головної (погода, тривога, світло):
-- область і черга відключень. Один рядок на користувача, бачить і править лише він сам.
-- Поки міграцію не застосовано, home-live.js тримає вибір у localStorage.

CREATE TABLE IF NOT EXISTS public.user_home_settings (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  home_place jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"oblast":"М.КИЇВ","queue":"GPV1.1"}
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_home_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "home settings: own select" ON public.user_home_settings;
CREATE POLICY "home settings: own select" ON public.user_home_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "home settings: own insert" ON public.user_home_settings;
CREATE POLICY "home settings: own insert" ON public.user_home_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "home settings: own update" ON public.user_home_settings;
CREATE POLICY "home settings: own update" ON public.user_home_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.user_home_settings TO authenticated;
