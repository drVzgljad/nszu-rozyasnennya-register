-- ============================================================
-- Міграція: фактичні обсяги наданих послуг у розрізі надавачів
-- Таблиця package_provider_volumes + RLS
-- Дата: 2026-08-25
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
--
-- Навіщо окрема таблиця, а не файл у репозиторії: агрегати по областях і
-- послугах лежать у passport/data/volumes/*.json і публічні, а обсяг
-- КОНКРЕТНОГО закладу — внутрішні аналітичні дані з вивантажки ЕСОЗ.
-- Репозиторій публічний, тому цей розріз іде через Supabase під RLS —
-- тим самим шляхом, що й «Алгоритм належності послуг до пакетів».
--
-- Дані заливає 23_обсяги_демографія/upload_provider_volumes.py
-- з _вигрузки/обсяги_2026/provider_volumes.csv (16 046 рядків).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.package_provider_volumes (
  packet TEXT NOT NULL,

  -- Ключ надавача. Для юросіб — ЄДРПОУ. Для ФОП у вивантажці ЕСОЗ замість
  -- коду стоїть літерал «ФОП», тому ключем стає ПІБ у верхньому регістрі:
  -- у реєстрі договорів ФОП мають справжній РНОКПП, і зшити два джерела
  -- можна лише за назвою. Збіг перевірено — 98–100 % надавачів пакетів ПМГ.
  provider_key TEXT NOT NULL,
  is_fop BOOLEAN NOT NULL DEFAULT false,

  provider_name TEXT,
  oblast TEXT,

  -- За ПОВНІ місяці вивантажки (обрізаний хвіст не входить)
  services BIGINT NOT NULL DEFAULT 0,
  emz BIGINT NOT NULL DEFAULT 0,

  period_from DATE,
  period_to DATE,
  updated_at TIMESTAMPTZ DEFAULT now(),

  PRIMARY KEY (packet, provider_key)
);

COMMENT ON TABLE public.package_provider_volumes IS
  'Фактично надані послуги за пакетом у розрізі надавачів (вивантажка ЕСОЗ). '
  'Показується в паспорті пакета: колонка «Послуг» у переліку ЗОЗ і в '
  'Excel-вивантаженні блоку «Перетин мереж». Тільки для авторизованих.';

CREATE INDEX IF NOT EXISTS idx_ppv_packet ON public.package_provider_volumes (packet);

ALTER TABLE public.package_provider_volumes ENABLE ROW LEVEL SECURITY;

-- ── SELECT: усі авторизовані, крім гостей ──
DROP POLICY IF EXISTS "ppv_select" ON public.package_provider_volumes;
CREATE POLICY "ppv_select" ON public.package_provider_volumes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role <> 'guest'
    )
  );

-- ── INSERT / UPDATE / DELETE: лише керівництво (заливає скрипт) ──
-- Якщо скрипт завантаження впаде з 401/403 — перевірити role у profiles.
DROP POLICY IF EXISTS "ppv_insert" ON public.package_provider_volumes;
CREATE POLICY "ppv_insert" ON public.package_provider_volumes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  );

DROP POLICY IF EXISTS "ppv_update" ON public.package_provider_volumes;
CREATE POLICY "ppv_update" ON public.package_provider_volumes
  FOR UPDATE TO authenticated
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

DROP POLICY IF EXISTS "ppv_delete" ON public.package_provider_volumes;
CREATE POLICY "ppv_delete" ON public.package_provider_volumes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  );
