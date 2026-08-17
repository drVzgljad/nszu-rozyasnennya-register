-- ============================================================
-- Міграція: валідація нормативних прив'язок експертами
-- Таблиця norm_validations + RLS
-- Дата: 2026-08-17
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт qdqtkvyvhtjgxpxnvblk).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.norm_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- № пакета (текстом, як у passport/data/norms/<pkg>.json)
  pkg TEXT NOT NULL,
  -- ключ пункту: <розділ>|<відбиток тексту key60> — переживає перестановки,
  -- а при зміні тексту пункту голос свідомо «відв'язується»
  item_k TEXT NOT NULL,

  -- +1 — підтверджую прив'язку (зелена галочка), -1 — не згоден (хрестик)
  verdict SMALLINT NOT NULL CHECK (verdict IN (1, -1)),

  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT,

  UNIQUE (pkg, item_k, user_id)
);

COMMENT ON TABLE public.norm_validations IS
  'Голоси експертів за/проти нормативних прив''язок пунктів пакетів (passport/norm-links.js)';

CREATE INDEX IF NOT EXISTS norm_validations_pkg_idx ON public.norm_validations (pkg);

CREATE OR REPLACE FUNCTION public.norm_validations_touch()
RETURNS TRIGGER AS $$
BEGIN
  new.updated_at := now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_norm_validations_touch ON public.norm_validations;
CREATE TRIGGER trg_norm_validations_touch
  BEFORE UPDATE ON public.norm_validations
  FOR EACH ROW EXECUTE FUNCTION public.norm_validations_touch();

ALTER TABLE public.norm_validations ENABLE ROW LEVEL SECURITY;

-- SELECT: усі авторизовані, крім гостей
DROP POLICY IF EXISTS "norm_validations_select" ON public.norm_validations;
CREATE POLICY "norm_validations_select" ON public.norm_validations
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role <> 'guest')
  );

-- INSERT/UPDATE/DELETE: лише власний голос, і не гість
DROP POLICY IF EXISTS "norm_validations_insert" ON public.norm_validations;
CREATE POLICY "norm_validations_insert" ON public.norm_validations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid() AND p.role <> 'guest')
  );

DROP POLICY IF EXISTS "norm_validations_update" ON public.norm_validations;
CREATE POLICY "norm_validations_update" ON public.norm_validations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "norm_validations_delete" ON public.norm_validations;
CREATE POLICY "norm_validations_delete" ON public.norm_validations
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── Пропозиції норм від експертів ───────────────────────────
-- Вільний текст: реквізит акта, пункт, коментар. Обробляються офлайн
-- (конвеєр 18_нормативне_підкріплення) і за потреби вносяться в корпус.

CREATE TABLE IF NOT EXISTS public.norm_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),

  pkg TEXT NOT NULL,
  item_k TEXT NOT NULL,
  suggestion TEXT NOT NULL CHECK (length(trim(suggestion)) >= 5),

  -- new → оброблено конвеєром: accepted / rejected (проставляє обробник)
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'rejected')),
  processed_note TEXT,

  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT
);

COMMENT ON TABLE public.norm_suggestions IS
  'Пропозиції нормативних якорів від експертів (passport/norm-links.js); обробка — пайплайн 18_нормативне_підкріплення';

CREATE INDEX IF NOT EXISTS norm_suggestions_pkg_idx ON public.norm_suggestions (pkg);
CREATE INDEX IF NOT EXISTS norm_suggestions_status_idx ON public.norm_suggestions (status);

ALTER TABLE public.norm_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "norm_suggestions_select" ON public.norm_suggestions;
CREATE POLICY "norm_suggestions_select" ON public.norm_suggestions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role <> 'guest')
  );

DROP POLICY IF EXISTS "norm_suggestions_insert" ON public.norm_suggestions;
CREATE POLICY "norm_suggestions_insert" ON public.norm_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid() AND p.role <> 'guest')
  );

-- видаляти можна лише свою і лише ще не оброблену
DROP POLICY IF EXISTS "norm_suggestions_delete" ON public.norm_suggestions;
CREATE POLICY "norm_suggestions_delete" ON public.norm_suggestions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'new');
