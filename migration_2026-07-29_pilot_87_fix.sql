-- ============================================================
-- Виправлення: пілот «Довготривалий медичний догляд…» має № 87, а не 86
-- Таблиця: public.package_assignments
-- Дата: 2026-07-29
-- Застосувати в Supabase SQL Editor (проєкт qdqtkvyvhtjgxpxnvblk).
-- ============================================================
--
-- Причина: № 86 — це основний пакет ПМГ «Медична допомога дітям, які
-- потребують лікування та постійного спостереження» (глава 44 постанови
-- № 1808). Пілотний проєкт довготривалого догляду ветеранів у реєстрі
-- договорів НСЗУ значиться під внутрішнім № 87. У сіді від 28.07.2026
-- він помилково стояв під № 86.
--
-- Обмеження UNIQUE (num, pilot) не заважає: рядок з num='86' лишається,
-- але тільки з pilot = false.

BEGIN;

-- Перевірка перед правкою: має бути рівно два рядки з num='86'
--   pilot=false → діти (не чіпаємо), pilot=true → довготривалий догляд (правимо)
DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n
    FROM public.package_assignments
   WHERE num = '86' AND pilot = true;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Очікував 1 пілотний рядок з num=86, знайшов %. Міграцію зупинено.', n;
  END IF;

  SELECT count(*) INTO n
    FROM public.package_assignments
   WHERE num = '87' AND pilot = true;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Пілот з num=87 уже існує — схоже, виправлення вже застосоване.';
  END IF;
END $$;

UPDATE public.package_assignments
   SET num = '87'
 WHERE num = '86'
   AND pilot = true;

COMMIT;

-- Контроль: очікуємо два рядки —
--   86 | false | Медична допомога дітям…
--   87 | true  | Довготривалий медичний догляд…
SELECT num, pilot, resp, dup, left(title, 60) AS title
  FROM public.package_assignments
 WHERE num IN ('86', '87')
 ORDER BY num, pilot;
