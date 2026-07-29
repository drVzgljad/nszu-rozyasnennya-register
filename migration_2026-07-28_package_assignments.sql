-- ============================================================
-- Міграція: Розподіл пакетів ПМГ-2026 між експертами відділу
-- Таблиця package_assignments + RLS + сід з робочої таблиці
-- Дата: 2026-07-28
-- Застосувати в Supabase SQL Editor (rpe-pmg проєкт).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.package_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- № пакета за постановою 1808 (текстом); для пілотів — внутрішній № НСЗУ/ЕСОЗ
  num TEXT NOT NULL,
  title TEXT NOT NULL,

  -- Ключі експертів з реєстру EXPERTS у cabinet/rozpodil.js
  -- (savka, isaiuk, vesel, tkach, koval, artom, volosh)
  resp TEXT NOT NULL,   -- відповідальний (аналіз, пакети)
  dup  TEXT NOT NULL,   -- дублер (відповіді на листи)

  pilot BOOLEAN NOT NULL DEFAULT false,  -- пілотний/експериментальний проєкт
  sort_order INT NOT NULL DEFAULT 0,

  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name TEXT,

  UNIQUE (num, pilot)
);

COMMENT ON TABLE public.package_assignments IS
  'Розподіл відповідальності за пакетами ПМГ-2026 (cabinet/rozpodil.html). Редагує керівництво.';

-- Автооновлення updated_at
CREATE OR REPLACE FUNCTION public.package_assignments_touch()
RETURNS TRIGGER AS $$
BEGIN
  new.updated_at := now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_package_assignments_touch ON public.package_assignments;
CREATE TRIGGER trg_package_assignments_touch
  BEFORE UPDATE ON public.package_assignments
  FOR EACH ROW EXECUTE FUNCTION public.package_assignments_touch();

ALTER TABLE public.package_assignments ENABLE ROW LEVEL SECURITY;

-- ── SELECT: усі авторизовані, крім гостей ──
DROP POLICY IF EXISTS "package_assignments_select" ON public.package_assignments;
CREATE POLICY "package_assignments_select" ON public.package_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role <> 'guest'
    )
  );

-- ── INSERT / UPDATE / DELETE: лише керівництво ──
-- (admin / director / deputy_director / manager або is_head)
DROP POLICY IF EXISTS "package_assignments_insert" ON public.package_assignments;
CREATE POLICY "package_assignments_insert" ON public.package_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  );

DROP POLICY IF EXISTS "package_assignments_update" ON public.package_assignments;
CREATE POLICY "package_assignments_update" ON public.package_assignments
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

DROP POLICY IF EXISTS "package_assignments_delete" ON public.package_assignments;
CREATE POLICY "package_assignments_delete" ON public.package_assignments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin', 'director', 'deputy_director', 'manager') OR p.is_head = true)
    )
  );

-- ── Сід: поточний розподіл з робочої Google-таблиці (лип. 2026) ──
-- Повторний запуск нічого не задублює (ON CONFLICT DO NOTHING).
INSERT INTO public.package_assignments (num, title, resp, dup, pilot, sort_order) VALUES
  ('1', 'Первинна медична допомога', 'savka', 'savka', false, 10),
  ('2', 'Екстрена медична допомога', 'isaiuk', 'isaiuk', false, 20),
  ('3', 'Хірургічні операції дорослим та дітям у стаціонарних умовах', 'vesel', 'vesel', false, 30),
  ('4', 'Стаціонарна допомога дорослим та дітям без проведення хірургічних операцій', 'vesel', 'vesel', false, 40),
  ('5', 'Медична допомога при гострому мозковому інсульті', 'tkach', 'tkach', false, 50),
  ('6', 'Медична допомога при гострому інфаркті міокарда', 'tkach', 'tkach', false, 60),
  ('7', 'Медична допомога при пологах', 'tkach', 'tkach', false, 70),
  ('8', 'Медична допомога новонародженим у складних неонатальних випадках', 'koval', 'savka', false, 80),
  ('9', 'Профілактика, діагностика, спостереження та лікування в амбулаторних умовах', 'koval', 'isaiuk', false, 90),
  ('10', 'Мамографія', 'isaiuk', 'isaiuk', false, 100),
  ('11', 'Гістероскопія', 'tkach', 'tkach', false, 110),
  ('12', 'Езофагогастродуоденоскопія', 'tkach', 'tkach', false, 120),
  ('13', 'Колоноскопія', 'tkach', 'tkach', false, 130),
  ('14', 'Цистоскопія', 'tkach', 'tkach', false, 140),
  ('15', 'Бронхоскопія', 'tkach', 'tkach', false, 150),
  ('16', 'Лікування пацієнтів методом гемодіалізу в амбулаторних умовах', 'vesel', 'vesel', false, 160),
  ('17', 'Хіміотерапевтичне лікування та супровід пацієнтів з онкологічними захворюваннями у стаціонарних та амбулаторних умовах', 'artom', 'savka', false, 170),
  ('18', 'Радіологічне лікування та супровід пацієнтів з онкологічними захворюваннями в стаціонарних та амбулаторних умовах', 'artom', 'savka', false, 180),
  ('19', 'Психіатрична допомога дорослим та дітям у стаціонарних умовах', 'savka', 'savka', false, 190),
  ('20', 'Діагностика та лікування дорослих і дітей, хворих на туберкульоз, у стаціонарних та амбулаторних умовах', 'savka', 'savka', false, 200),
  ('21', 'Діагностика, лікування та супровід осіб із вірусом імунодефіциту людини (та підозрою на ВІЛ)', 'savka', 'savka', false, 210),
  ('22', 'Лікування осіб із психічними та поведінковими розладами внаслідок вживання опіоїдів із використанням препаратів замісної підтримувальної терапії', 'savka', 'savka', false, 220),
  ('23', 'Стаціонарна паліативна медична допомога дорослим та дітям', 'tkach', 'tkach', false, 230),
  ('24', 'Мобільна паліативна медична допомога дорослим і дітям', 'tkach', 'tkach', false, 240),
  ('25', 'Медична реабілітація немовлят, які народилися передчасно та/або хворими, протягом перших трьох років життя', 'koval', 'volosh', false, 250),
  ('34', 'Стоматологічна допомога дорослим та дітям', 'vesel', 'vesel', false, 260),
  ('35', 'Ведення вагітності в амбулаторних умовах', 'tkach', 'tkach', false, 270),
  ('37', 'Лікування пацієнтів методом перитонеального діалізу в амбулаторних умовах', 'vesel', 'vesel', false, 280),
  ('38', 'Лікування та супровід пацієнтів з гематологічними та онкогематологічними захворюваннями в стаціонарних та амбулаторних умовах', 'artom', 'savka', false, 290),
  ('42', 'Готовність закладу охорони здоров’я до надання медичної допомоги в надзвичайних ситуаціях', 'isaiuk', 'isaiuk', false, 300),
  ('47', 'Хірургічні операції дорослим та дітям в умовах стаціонару одного дня', 'vesel', 'vesel', false, 310),
  ('48', 'Неонатальний скринінг', 'koval', 'savka', false, 320),
  ('49', 'Забезпечення збереження кадрового потенціалу для надання медичної допомоги населенню, яке перебуває на територіях бойових дій', 'isaiuk', 'isaiuk', false, 330),
  ('50', 'Забезпечення кадрового потенціалу системи охорони здоров’я шляхом організації надання медичної допомоги із залученням лікарів-інтернів', 'isaiuk', 'isaiuk', false, 340),
  ('53', 'Реабілітаційна допомога дорослим та дітям у стаціонарних умовах', 'koval', 'tkach', false, 350),
  ('54', 'Реабілітаційна допомога дорослим та дітям у амбулаторних умовах', 'koval', 'tkach', false, 360),
  ('55', 'Секційне дослідження', 'isaiuk', 'isaiuk', false, 370),
  ('57', 'Готовність та забезпечення надання медичної допомоги населенню, яке перебуває на території, де ведуться бойові дії', 'isaiuk', 'isaiuk', false, 380),
  ('60', 'Медичний огляд осіб, який організовується територіальними центрами комплектування та соціальної підтримки', 'savka', 'savka', false, 390),
  ('63', 'Лікування безпліддя за допомогою допоміжних репродуктивних технологій (запліднення in vitro)', 'koval', 'tkach', false, 400),
  ('64', 'Лікування дорослих та дітей методом трансплантації органів', 'artom', 'savka', false, 410),
  ('65', 'Лікування дорослих та дітей методом трансплантації гемопоетичних стовбурових клітин', 'artom', 'savka', false, 420),
  ('68', 'Перехідне фінансове забезпечення надання медичних послуг закладами охорони здоров’я', 'isaiuk', 'isaiuk', false, 430),
  ('70', 'Проведення досліджень з радіоізотопної медичної візуалізації та діагностики (позитронно-емісійної томографії)', 'artom', 'savka', false, 440),
  ('72', 'Психосоціальна та психіатрична допомога дорослим та дітям, що надається в центрах ментального (психічного) здоров’я та мобільними мультидисциплінарними командами', 'savka', 'savka', false, 450),
  ('86', 'Медична допомога дітям, які потребують лікування та постійного спостереження', 'koval', 'tkach', false, 460),
  ('66', 'Зубопротезування окремих категорій осіб, які захищають/захищали незалежність, суверенітет та територіальну цілісність України (група послуг № 1)', 'vesel', 'vesel', true, 470),
  ('67', 'Стоматологічна допомога окремій категорії осіб, які захищають/захищали незалежність, суверенітет та територіальну цілісність України (група послуг № 2)', 'vesel', 'vesel', true, 480),
  ('71', 'Медичні послуги із здійснення забору, кріоконсервації та зберігання репродуктивних клітин військовослужбовців та інших осіб на випадок втрати репродуктивної функції', 'koval', 'tkach', true, 490),
  ('73', 'Розширені послуги з первинної медичної допомоги окремим категоріям осіб, які захищали незалежність, суверенітет та територіальну цілісність України', 'savka', 'savka', true, 500),
  ('84', 'Послуги довготривалого медсестринського догляду внутрішньо переміщених осіб', 'tkach', 'tkach', true, 510),
  ('87', 'Довготривалий медичний догляд окремим категоріям осіб, які захищали незалежність, суверенітет та територіальну цілісність України', 'koval', 'volosh', true, 520)
ON CONFLICT (num, pilot) DO NOTHING;
