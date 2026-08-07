-- =========================================================================
-- Міграція від 17.07.2026: особистий кабінет — «Виконана робота»
-- Виконати один раз у Supabase SQL Editor (проєкт qdqtkvyvhtjgxpxnvblk)
-- =========================================================================

-- Номер вхідного листа, на який надано відповідь (необов'язкове поле
-- для записів гілки АСКОД у формі «Внести виконану роботу»)
ALTER TABLE public.skod_logs ADD COLUMN IF NOT EXISTS reply_to_number TEXT;

-- Перевірка
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'skod_logs'
ORDER BY ordinal_position;
