-- ============================================================
-- Міграція: розділ порталу «Внутрішні акти НСЗУ», вкладка «Комунікація»
-- Таблиця internal_act_guides — гайди за внутрішніми документами НСЗУ
-- (перший — Рекомендації щодо зовнішньої комунікації, СЗ ДІТ від 06.10.2026
-- № 6.3-01/35-26). Один рядок = один гайд: текст розділів, приклади і правила
-- помічника лежать у content (JSONB); сторінка лише їх показує.
-- Дата: 2026-10-06
-- Застосувати в Supabase SQL Editor (проєкт qdqtkvyvhtjgxpxnvblk).
--
-- Чому база, а не файл — та сама причина, що й для internal_act_units:
-- репозиторій порталу ПУБЛІЧНИЙ, роль-гейт на сторінці — видимість, а не
-- захист. Вміст внутрішніх документів НСЗУ лежить тут під RLS.
--
-- Дані заливає vnutrishni-akty/upload_guides.py з _seeds_local/guide_*.json.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.internal_act_guides (
  slug        TEXT PRIMARY KEY,    -- 'komunikatsiia'
  title       TEXT NOT NULL,
  doc_ref     TEXT,                -- реквізити документа-джерела
  content     JSONB NOT NULL,      -- {lead, sections[], calc{}}
  updated_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.internal_act_guides IS
  'Гайди порталу за внутрішніми документами НСЗУ: розділи, приклади, правила '
  'помічника. Читають авторизовані не-гості, пишуть керівництво й адмін.';

ALTER TABLE public.internal_act_guides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iag_select" ON public.internal_act_guides;
CREATE POLICY "iag_select" ON public.internal_act_guides
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role <> 'guest'
    )
  );

DROP POLICY IF EXISTS "iag_write" ON public.internal_act_guides;
CREATE POLICY "iag_write" ON public.internal_act_guides
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  );
