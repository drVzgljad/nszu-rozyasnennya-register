-- ============================================================
-- Міграція: розділ порталу «Внутрішні акти НСЗУ», вкладка «Хто опрацьовує»
-- Таблиця internal_act_units — Додаток 2 до наказу НСЗУ від 15.09.2026 № 502
-- Дата: 2026-09-18
-- Застосувати в Supabase SQL Editor (проєкт qdqtkvyvhtjgxpxnvblk).
--
-- Навіщо саме база, а не JSON-файл. Репозиторій порталу
-- (github.com/drVzgljad/nszu-rozyasnennya-register) ПУБЛІЧНИЙ, а роль-гейт на
-- сторінці — це видимість, а не захист: розмітка й дані вантажаться до
-- перевірки ролі, і прямий fetch віддає файл будь-кому. Матриця підрозділів —
-- вміст внутрішнього акта НСЗУ, тому лежить тут під RLS.
--
-- Виняток, який лишається файлом: Додаток 1 наказу № 502
-- (vnutrishni-akty/data/stroky.json) — це компіляція строків із публічних
-- законів, у ній немає нічого закритого.
--
-- ⚠ Реєстру внутрішніх актів і наших позицій до них на порталі НЕМАЄ і не
-- планується (рішення користувача 18.09.2026): статуси наших зауважень, чого
-- ми домоглися в чужому проєкті наказу і де лежать робочі файли — не те, що
-- виносять на екран, спільний для всіх облікових записів департаменту.
-- Реєстр ведеться в D:\pmg-data\28_внутрішні_акти_НСЗУ\README.md.
--
-- Дані заливає vnutrishni-akty/upload_dodatok2.py
-- з _seeds_local/dodatok2_units.json (сід пише parse_dodatok2.py).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.internal_act_units (
  n           INT PRIMARY KEY,     -- позиція в Додатку 2 (1..26)
  unit        TEXT NOT NULL,
  official    TEXT,                -- хто робить первинний розгляд
  blocks      JSONB NOT NULL,      -- [{intro, items[], official}]
  is_ours     BOOLEAN DEFAULT false,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.internal_act_units IS
  'Додаток 2 до Алгоритму розгляду вхідної кореспонденції (наказ НСЗУ від '
  '15.09.2026 № 502): підрозділ → типи листів → посадова особа первинного '
  'розгляду. Наш департамент — позиція 18 (is_ours = true).';

-- ─────────────────────────────────────────────────────────────
-- RLS: читають усі авторизовані, крім гостей; пишуть керівництво й адмін
-- (та сама межа, що в provider_private)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.internal_act_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iau_select" ON public.internal_act_units;
CREATE POLICY "iau_select" ON public.internal_act_units
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role <> 'guest'
    )
  );

DROP POLICY IF EXISTS "iau_write" ON public.internal_act_units;
CREATE POLICY "iau_write" ON public.internal_act_units
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
