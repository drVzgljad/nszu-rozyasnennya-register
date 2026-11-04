-- ============================================================
-- Журнал проблем голосу · 04.11.2026
--   Рушій zviazok/voice.js сам записує, що пішло не так у голосовій кімнаті:
--   браузер не дав мікрофон, з'єднання з колегою впало або не встановилось,
--   ретранслятор (TURN) недоступний, великий пінг чи втрати звуку, канал кімнати
--   впав, браузер не дав відтворити звук без кліку. Мета — бачити причини
--   і усувати їх, а не розпитувати людей «що в тебе було».
--   Звук і вміст розмов сюди НЕ пишуться — лише технічні ознаки.
--   Поки міграцію не застосовано, рушій складає записи в браузері
--   (localStorage 'pmg-voice-issues') і досилає, коли таблиця з'явиться.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.voice_issues (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- коли сталося (запис могли дослати пізніше)
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT,
  topic TEXT,                 -- voice:all / voice:dept:…
  kind TEXT NOT NULL,         -- mic_denied · peer_failed · peer_gave_up · slow_connect · turn_down ·
                              -- channel_error · high_ping · packet_loss · need_gesture
  peer_name TEXT,             -- з ким саме (для проблем з'єднання)
  device TEXT,                -- mob / pc
  detail JSONB NOT NULL DEFAULT '{}'::jsonb   -- браузер, пінг, втрати, тип маршруту, текст помилки
);
CREATE INDEX IF NOT EXISTS voice_issues_time_idx ON public.voice_issues (created_at DESC);
CREATE INDEX IF NOT EXISTS voice_issues_kind_idx ON public.voice_issues (kind, created_at DESC);

ALTER TABLE public.voice_issues ENABLE ROW LEVEL SECURITY;

-- Пише кожен лише про себе
DROP POLICY IF EXISTS "voice_issues_insert" ON public.voice_issues;
CREATE POLICY "voice_issues_insert" ON public.voice_issues
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND kind ~ '^[a-z_]{2,40}$');

-- Читає сам автор і адміністратор (розбір проблем)
DROP POLICY IF EXISTS "voice_issues_select" ON public.voice_issues;
CREATE POLICY "voice_issues_select" ON public.voice_issues
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Старше 90 днів не потрібне: чистити вручну
--   DELETE FROM public.voice_issues WHERE created_at < now() - interval '90 days';
