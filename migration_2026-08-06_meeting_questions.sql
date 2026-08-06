-- ============================================================
-- Міграція: Питання ЗОЗ з ранкових зустрічей (шпаргалка)
-- Таблиця meeting_questions + RLS
-- Дата: 2026-08-06
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
-- Сід з даними: _seeds_local/seed_meeting_questions.sql
-- (генерує zoz-questions/build_questions_data.py, поза git)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meeting_questions (
  qid INT PRIMARY KEY,              -- id запису в корпусі (Ранкові зустрічі/corpus_classified.jsonl)
  created_at TIMESTAMPTZ DEFAULT now(),

  qdate DATE,                       -- дата зустрічі / подання питання
  src TEXT NOT NULL CHECK (src IN ('chat', 'form')),   -- чат зустрічі / Google-опитувальник
  theme TEXT NOT NULL,              -- coding|tariffs|package|esoz|reports|contracts|staff|monitoring|referrals|screening|other
  sub TEXT NOT NULL DEFAULT '',     -- підтема (2-5 слів)
  pkg TEXT NOT NULL DEFAULT '',     -- пакет/напрям ПМГ як текст
  pkg_nums TEXT[] NOT NULL DEFAULT '{}',               -- нормалізовані номери пакетів для фільтра
  status TEXT NOT NULL CHECK (status IN ('full', 'partial', 'none')), -- повнота відповіді НСЗУ
  mil BOOLEAN NOT NULL DEFAULT false,                  -- стосується військових/ветеранів/ВПО
  gist TEXT NOT NULL DEFAULT '',    -- суть питання одним рядком
  question TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT ''
);

COMMENT ON TABLE public.meeting_questions IS
  'Питання ЗОЗ з ранкових зустрічей НСЗУ + відповіді (zoz-questions/ шпаргалка). Дані санітизовані: без ПІБ, пошт, телефонів. Оновлюється сідом з _seeds_local.';

ALTER TABLE public.meeting_questions ENABLE ROW LEVEL SECURITY;

-- ── SELECT: усі авторизовані, крім гостей (як package_assignments) ──
DROP POLICY IF EXISTS "meeting_questions_select" ON public.meeting_questions;
CREATE POLICY "meeting_questions_select" ON public.meeting_questions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role <> 'guest'
    )
  );

-- ── Записи з клієнта не потрібні: дані живуть у сіді.
--    INSERT/UPDATE/DELETE — лише admin (на випадок точкових правок з дашборда). ──
DROP POLICY IF EXISTS "meeting_questions_write" ON public.meeting_questions;
CREATE POLICY "meeting_questions_write" ON public.meeting_questions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Стара таблиця questions (форма «Поставити питання» запаркованого розділу)
-- НЕ чіпається цією міграцією — вирішимо її долю окремо.
