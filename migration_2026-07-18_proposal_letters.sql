-- =========================================================================
-- Міграція від 18.07.2026: пропозиції до ПМГ-2026 — подання від організацій
-- (листи) + опрацювання пропозицій (аналіз, імплементація, ризики, реагування)
-- Виконати один раз у Supabase SQL Editor (проєкт qdqtkvyvhtjgxpxnvblk).
-- Скрипт ідемпотентний — повторний запуск безпечний.
-- =========================================================================

-- 1. Нові поля таблиці пропозицій:
--    topic         — тема: zahalne | zmina-paketu | novyi-paket | taryfy
--    submitter     — хто пропонує (ГО, ЗОЗ, організація або особа)
--    letter_number — номер листа (напр. 1606/2026)
--    letter_date   — дата листа
--    letter_url    — публічне посилання на файл листа у Storage
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS topic TEXT,
  ADD COLUMN IF NOT EXISTS submitter TEXT,
  ADD COLUMN IF NOT EXISTS letter_number TEXT,
  ADD COLUMN IF NOT EXISTS letter_date DATE,
  ADD COLUMN IF NOT EXISTS letter_url TEXT;

-- 2. Bucket для файлів листів (публічне читання)
INSERT INTO storage.buckets (id, name, public)
VALUES ('proposal-letters', 'proposal-letters', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Політики доступу до bucket
DROP POLICY IF EXISTS "Authenticated upload proposal letters" ON storage.objects;
CREATE POLICY "Authenticated upload proposal letters"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'proposal-letters');

DROP POLICY IF EXISTS "Public read proposal letters" ON storage.objects;
CREATE POLICY "Public read proposal letters"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'proposal-letters');

-- 4. Поля опрацювання пропозиції:
--    analysis         — аналіз пропозиції
--    implementation   — варіанти імплементації
--    risks            — ризики
--    response_types   — варіанти реагування (масив: sluzhbova | rozjasnennya |
--                       lyst | zmina-postanovy | zmina-spec | moz | bez-reahuvannya)
--    response_comment — коментар щодо реагування
--    processed_by     — хто опрацював
--    processed_at     — коли опрацьовано
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS analysis TEXT,
  ADD COLUMN IF NOT EXISTS implementation TEXT,
  ADD COLUMN IF NOT EXISTS risks TEXT,
  ADD COLUMN IF NOT EXISTS response_types JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS response_comment TEXT,
  ADD COLUMN IF NOT EXISTS processed_by TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Перевірка
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'proposals'
ORDER BY ordinal_position;
