-- ============================================================
-- Міграція: Робочий простір Відділу (РпВ) — документи та роботи
-- Таблиця dept_works + приватний бакет dept-documents + RLS
-- Дата: 2026-07-22
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dept_works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Відділ, якому належить документ (значення profiles."Section")
  department TEXT NOT NULL,

  -- Простір: 'working' — робочі документи, 'service' — службові
  space TEXT NOT NULL DEFAULT 'working' CHECK (space IN ('working', 'service')),

  title TEXT NOT NULL,
  description TEXT,

  -- Тип: 'gdoc' — посилання на Google Doc/зовнішній сервіс,
  -- 'file' — завантажений файл у бакеті dept-documents,
  -- 'external' — просто зовнішнє посилання (OneDrive/Диск К/інше)
  kind TEXT NOT NULL DEFAULT 'gdoc' CHECK (kind IN ('gdoc', 'file', 'external')),
  url TEXT,               -- для gdoc/external
  storage_path TEXT,     -- для kind='file' (шлях у бакеті dept-documents)
  file_name TEXT,        -- оригінальна назва файлу для відображення

  -- Життєвий цикл: активний / запаркований (недороблене) / завершений
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'parked', 'done')),

  -- Пріоритет для впорядкування в межах статусу (менше = вище)
  priority INT NOT NULL DEFAULT 0,

  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_name TEXT,

  -- 'department' — бачить весь відділ, 'restricted' — власник + керівництво
  visibility TEXT NOT NULL DEFAULT 'department' CHECK (visibility IN ('department', 'restricted')),

  -- Для space='service': маркування, тип документа тощо
  service_meta JSONB,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT
);

COMMENT ON TABLE public.dept_works IS
  'Робочий простір Відділу: документи та роботи (робочі й службові). Керують видимістю керівник відділу, заступник, адмін.';

CREATE INDEX IF NOT EXISTS idx_dept_works_dept_space
  ON public.dept_works(department, space, status, priority);

-- Автооновлення updated_at
CREATE OR REPLACE FUNCTION public.dept_works_touch()
RETURNS TRIGGER AS $$
BEGIN
  new.updated_at := now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dept_works_touch ON public.dept_works;
CREATE TRIGGER trg_dept_works_touch
  BEFORE UPDATE ON public.dept_works
  FOR EACH ROW EXECUTE FUNCTION public.dept_works_touch();

ALTER TABLE public.dept_works ENABLE ROW LEVEL SECURITY;

-- ── Допоміжні предикати (як підзапити EXISTS у політиках) ──
-- «Керівництво» = admin / director / deputy_director, або керівник саме
-- цього відділу (manager / is_head з тим самим Section/department).

-- ── SELECT: члени відділу бачать документи видимості 'department';
--    власник і керівництво бачать усе (в т.ч. 'restricted').
DROP POLICY IF EXISTS "dept_works_select" ON public.dept_works;
CREATE POLICY "dept_works_select" ON public.dept_works
  FOR SELECT TO authenticated
  USING (
    auth.uid() = owner_id
    OR auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'director', 'deputy_director')
    )
    OR (
      -- член того самого відділу
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (p."Section" = dept_works.department OR p.department = dept_works.department)
      )
      AND (
        visibility = 'department'
        -- керівник відділу бачить і restricted
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND (p."Section" = dept_works.department OR p.department = dept_works.department)
            AND (p.role = 'manager' OR p.is_head = true)
        )
      )
    )
  );

-- ── INSERT: член відділу (не гість) додає документ у свій відділ ──
DROP POLICY IF EXISTS "dept_works_insert" ON public.dept_works;
CREATE POLICY "dept_works_insert" ON public.dept_works
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role <> 'guest'
        AND (
          p."Section" = dept_works.department
          OR p.department = dept_works.department
          OR p.role IN ('admin', 'director', 'deputy_director')
        )
    )
  );

-- ── UPDATE: власник, автор або керівництво відділу ──
DROP POLICY IF EXISTS "dept_works_update" ON public.dept_works;
CREATE POLICY "dept_works_update" ON public.dept_works
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = owner_id
    OR auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'director', 'deputy_director')
          OR (
            (p."Section" = dept_works.department OR p.department = dept_works.department)
            AND (p.role = 'manager' OR p.is_head = true)
          )
        )
    )
  )
  WITH CHECK (
    auth.uid() = owner_id
    OR auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'director', 'deputy_director')
          OR (
            (p."Section" = dept_works.department OR p.department = dept_works.department)
            AND (p.role = 'manager' OR p.is_head = true)
          )
        )
    )
  );

-- ── DELETE: власник, автор або керівництво відділу ──
DROP POLICY IF EXISTS "dept_works_delete" ON public.dept_works;
CREATE POLICY "dept_works_delete" ON public.dept_works
  FOR DELETE TO authenticated
  USING (
    auth.uid() = owner_id
    OR auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'director', 'deputy_director')
          OR (
            (p."Section" = dept_works.department OR p.department = dept_works.department)
            AND (p.role = 'manager' OR p.is_head = true)
          )
        )
    )
  );

-- Realtime-оновлення дошки
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dept_works;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ============================================================
-- Приватний бакет для файлів РпВ: dept-documents
-- (шлях: dept/<відділ>/<uuid>-<файл>). Читання — за підписаними URL.
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('dept-documents', 'dept-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Читання об'єктів бакета (для createSignedUrl) — авторизованим
DROP POLICY IF EXISTS "auth_read_dept_documents" ON storage.objects;
CREATE POLICY "auth_read_dept_documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'dept-documents');

-- Завантаження — авторизованим, не гостям
DROP POLICY IF EXISTS "auth_insert_dept_documents" ON storage.objects;
CREATE POLICY "auth_insert_dept_documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dept-documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role <> 'guest'
    )
  );

-- Видалення файлу — авторизованим (рядок у dept_works контролює доступ окремо)
DROP POLICY IF EXISTS "auth_delete_dept_documents" ON storage.objects;
CREATE POLICY "auth_delete_dept_documents" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dept-documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role <> 'guest'
    )
  );
