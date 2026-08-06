-- ============================================================
-- Міграція: зачистка старої таблиці questions
-- (форма «Поставити питання» запаркованого розділу zoz-questions;
--  розділ 06.08.2026 перероблено на шпаргалку з meeting_questions)
-- Дата: 2026-08-06
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт) ПІСЛЯ
-- migration_2026-08-06_meeting_questions.sql.
-- ============================================================

-- Страхувальний архів: якщо у формі встигли щось написати, воно
-- переїде в questions_archive. RLS увімкнено, політик нема —
-- з клієнта таблицю не видно, читається лише з дашборда.
CREATE TABLE IF NOT EXISTS public.questions_archive AS
  SELECT * FROM public.questions;

ALTER TABLE public.questions_archive ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.questions_archive IS
  'Архів таблиці questions (запаркована форма питань ЗОЗ) перед видаленням 06.08.2026. Якщо порожній — можна дропнути і його.';

-- Сама таблиця разом з політиками
DROP TABLE IF EXISTS public.questions CASCADE;

-- Контроль: скільки рядків поїхало в архів
SELECT count(*) AS archived_rows FROM public.questions_archive;
