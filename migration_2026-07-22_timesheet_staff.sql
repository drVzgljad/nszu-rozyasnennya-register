-- ============================================================
-- Міграція: кадровий довідник табеля обліку робочого часу
-- (timesheet_staff) для формування Excel-табелів бухгалтерії
-- Дата: 2026-07-22
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.timesheet_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Який табель: 'department' — Департамент стратегії (загальний),
  -- 'fin' — управління фінансово-аналітичного забезпечення (окрема декларація)
  sheet TEXT NOT NULL DEFAULT 'department' CHECK (sheet IN ('department', 'fin')),

  -- Порядок рядка у табелі
  sort_order INT NOT NULL DEFAULT 100,

  -- Назва структурного підрозділу (рядок-заголовок групи у табелі);
  -- NULL — працівник іде одразу під рядком департаменту (директор)
  unit TEXT,

  tabel_no INT,                                   -- табельний номер
  gender TEXT CHECK (gender IN ('Ч', 'Ж')),       -- стать
  full_name TEXT NOT NULL,                        -- Прізвище Ім'я По батькові
  position TEXT NOT NULL,                         -- посада

  -- Прив'язка до зареєстрованого користувача сайту (для автозаповнення
  -- кодів зі статусів присутності). NULL — автопошук за прізвищем.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  note TEXT,          -- примітка (колонка приміток табеля, напр. № наказу)
  active BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON TABLE public.timesheet_staff IS
  'Кадровий довідник для табелів обліку робочого часу (бухгалтерія). Редагують координатор/адмін на вкладці Статус присутності.';

CREATE INDEX IF NOT EXISTS idx_timesheet_staff_sheet_order
  ON public.timesheet_staff(sheet, sort_order);

ALTER TABLE public.timesheet_staff ENABLE ROW LEVEL SECURITY;

-- Читання: всі автентифіковані (потрібно для формування табеля)
DROP POLICY IF EXISTS "timesheet_staff_select" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_select" ON public.timesheet_staff
  FOR SELECT TO authenticated
  USING (true);

-- Зміни: лише координатор/адмін
DROP POLICY IF EXISTS "timesheet_staff_insert" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_insert" ON public.timesheet_staff
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('full', 'deputy_director', 'director', 'admin')
  ));

DROP POLICY IF EXISTS "timesheet_staff_update" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_update" ON public.timesheet_staff
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('full', 'deputy_director', 'director', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('full', 'deputy_director', 'director', 'admin')
  ));

DROP POLICY IF EXISTS "timesheet_staff_delete" ON public.timesheet_staff;
CREATE POLICY "timesheet_staff_delete" ON public.timesheet_staff
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('full', 'deputy_director', 'director', 'admin')
  ));

-- ============================================================
-- Сід: штат з табелів за травень (файли бухгалтерії).
-- Бохіна (управління моніторингу) не включено — за рішенням від 22.07.2026.
-- ============================================================

INSERT INTO public.timesheet_staff (sheet, sort_order, unit, tabel_no, gender, full_name, position, note) VALUES
-- Табель департаменту
('department', 10,  NULL, 317, 'Ж', 'Дудник Світлана Валеріївна', 'директор департаменту', NULL),

('department', 20, 'відділ стратегічного розвитку програми медичних гарантій', 125, 'Ж', 'Волошина Альбіна Миколаївна', 'заступник директора-начальник відділу', NULL),
('department', 21, 'відділ стратегічного розвитку програми медичних гарантій', 236, 'Ж', 'Ковальова Олена Михайлівна', 'головний спеціаліст', NULL),
('department', 22, 'відділ стратегічного розвитку програми медичних гарантій', 936, 'Ж', 'Савченко Олена Олегівна', 'головний спеціаліст', NULL),

('department', 30, 'відділ клінічної та наукової експертизи', 978, 'Ж', 'Ісаюк Вікторія Миколаївна', 'головний спеціаліст', NULL),
('department', 31, 'відділ клінічної та наукової експертизи', 983, 'Ж', 'Савка Юлія Іванівна', 'головний спеціаліст', NULL),
('department', 32, 'відділ клінічної та наукової експертизи', 346, 'Ч', 'Ткач Костянтин Дмитрович', 'головний спеціаліст', NULL),

('department', 40, 'відділ розвитку програми реімбурсації', 733, 'Ч', 'Гончаренко Сергій Миколайович', 'головний спеціаліст', NULL),
('department', 41, 'відділ розвитку програми реімбурсації', 977, 'Ч', 'Фортельний Михайло Сергійович', 'головний спеціаліст', NULL),

('department', 50, 'відділ взаємодії з надавачами медичних послуг', 749, 'Ж', 'Білолипецька Ірина Сергіївна', 'начальник відділу', NULL),
('department', 51, 'відділ взаємодії з надавачами медичних послуг', 762, 'Ж', 'Ліщишина Анна Юріївна', 'головний спеціаліст', '№ 1046-в від 28.11.2024;'),
('department', 52, 'відділ взаємодії з надавачами медичних послуг', 996, 'Ж', 'Кирилюк Оксана Ігорівна', 'головний спеціаліст', NULL),
('department', 53, 'відділ взаємодії з надавачами медичних послуг', 55,  'Ж', 'Левченко Анастасія Олександрівна', 'головний спеціаліст', NULL),

('department', 60, 'відділ розрахунку вартості медичних послуг', 870, 'Ж', 'Вервейко Наталія Іванівна', 'головний спеціаліст', NULL),
('department', 61, 'відділ розрахунку вартості медичних послуг', 946, 'Ж', 'Задорожня Олена Іванівна', 'головний спеціаліст', NULL),
('department', 62, 'відділ розрахунку вартості медичних послуг', 942, 'Ж', 'Риженко Марина Аркадіївна', 'головний спеціаліст', NULL),

('department', 70, 'відділ роботи з електронними медичними даними', 71,  'Ч', 'Горох Євгеній Леонідович', 'начальник відділу', '№ 1047-в від 28.11.2024;'),
('department', 71, 'відділ роботи з електронними медичними даними', 981, 'Ч', 'Звєрєв Костянтин Васильович', 'головний спеціаліст', NULL),
('department', 72, 'відділ роботи з електронними медичними даними', 816, 'Ч', 'Коваль Олег Васильович', 'головний спеціаліст', NULL),

-- Окремий табель: управління фінансово-аналітичного забезпечення
-- (окрема декларація — лише Якубівський)
('fin', 10, 'управління фінансово-аналітичного забезпечення реалізації програми медичних гарантій', 873, 'Ч', 'Якубівський Володимир Леонідович', 'начальник управління', NULL);
