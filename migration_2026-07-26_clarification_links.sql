-- ============================================================
-- Міграція: рішення експертів щодо зв'язків між роз'ясненнями
-- Таблиця clarification_links + RLS
-- Дата: 2026-07-26
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
-- ============================================================
--
-- Навіщо. Пайплайн розділу «Роз'яснення» будує граф зв'язків із трьох джерел:
--   attachment — «це додаток до того листа» (дата, сусідство в архіві, згадка
--                «Додаток:» у листі) — тверде ребро;
--   reference  — документ прямо називає інший лист за номером — факт;
--   claim      — модель прочитала в тексті «скасовує / доповнює / уточнює» —
--                ГІПОТЕЗА.
--
-- Рішення власника від 26.07.2026: на порталі як чинне показується лише те,
-- що підтвердив експерт. Гіпотези видно окремо, з цитатою-підставою, і саме
-- тут фіксується вердикт людини.
--
-- Ребро адресується ключем edge_key = '<from>→<to>:<relation>' — той самий,
-- який рахує build_graph.py. Перезбірка графа рішень не затирає: скрипт
-- pull_decisions.py витягує їх звідси в data/graph_overrides.json.

CREATE TABLE IF NOT EXISTS public.clarification_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Ключ ребра графа: '128→151:доповнює'
  edge_key TEXT NOT NULL UNIQUE,

  -- Розкладене те саме — щоб можна було робити зрозумілі вибірки
  from_id INT NOT NULL,
  to_id INT NOT NULL,
  relation TEXT NOT NULL
    CHECK (relation IN ('скасовує', 'доповнює', 'уточнює', 'посилається', 'додаток до')),

  -- Вердикт експерта
  decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected')),

  -- Чому саме так — вільний коментар, лишається в історії розділу
  note TEXT,

  -- Цитата з документа, на підставі якої модель висунула гіпотезу
  -- (зберігаємо, щоб вердикт можна було перечитати без перезбірки графа)
  evidence TEXT,

  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by_name TEXT
);

-- Ретрофіт (безпечно запускати повторно): автор вердикту обов'язковий.
-- Політика DELETE нижче дозволяє видалення автору або керівництву — тож рядок
-- БЕЗ автора не змогла б прибрати навіть та сама людина, він застряг би
-- назавжди. Перевірено на практиці 26.07.2026.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.clarification_links WHERE decided_by IS NULL) THEN
    RAISE NOTICE 'Є рядки без decided_by — спершу заповніть або видаліть їх, потім повторіть';
  ELSE
    ALTER TABLE public.clarification_links ALTER COLUMN decided_by SET NOT NULL;
  END IF;
END $$;

COMMENT ON TABLE public.clarification_links IS
  'Вердикти експертів щодо зв''язків між роз''ясненнями НСЗУ (скасовує / доповнює / уточнює). Джерело для data/graph_overrides.json розділу rozjasnennya.';

CREATE INDEX IF NOT EXISTS clarification_links_from_idx
  ON public.clarification_links (from_id);
CREATE INDEX IF NOT EXISTS clarification_links_to_idx
  ON public.clarification_links (to_id);

-- ── Автооновлення updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.clarification_links_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clarification_links_touch ON public.clarification_links;
CREATE TRIGGER clarification_links_touch
  BEFORE UPDATE ON public.clarification_links
  FOR EACH ROW EXECUTE FUNCTION public.clarification_links_touch();

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.clarification_links ENABLE ROW LEVEL SECURITY;

-- Читати може будь-який авторизований: стан чинності потрібен усім експертам.
DROP POLICY IF EXISTS "clarification_links_select" ON public.clarification_links;
CREATE POLICY "clarification_links_select" ON public.clarification_links
  FOR SELECT TO authenticated
  USING (true);

-- Ухвалювати вердикт — від керівника й вище. Це рішення про чинність
-- нормативного роз'яснення, його не має ставити випадковий користувач.
DROP POLICY IF EXISTS "clarification_links_insert" ON public.clarification_links;
CREATE POLICY "clarification_links_insert" ON public.clarification_links
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('manager', 'deputy_director', 'director', 'admin')
    )
  );

DROP POLICY IF EXISTS "clarification_links_update" ON public.clarification_links;
CREATE POLICY "clarification_links_update" ON public.clarification_links
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('manager', 'deputy_director', 'director', 'admin')
    )
  );

-- Видаляти (скасувати власний вердикт) — автор рішення або керівництво.
DROP POLICY IF EXISTS "clarification_links_delete" ON public.clarification_links;
CREATE POLICY "clarification_links_delete" ON public.clarification_links
  FOR DELETE TO authenticated
  USING (
    auth.uid() = decided_by
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('deputy_director', 'director', 'admin')
    )
  );
