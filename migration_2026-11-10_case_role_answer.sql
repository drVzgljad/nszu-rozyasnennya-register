-- «Справи відділу»: нова роль справи «СЗ-відповідь на нашу записку» (our_role = 'answer').
-- Вимога користувача 10.11.2026: вхідна службова, яка відповідає на нашу СЗ, має окрему роль —
-- відповіді не потребує, її треба врахувати в роботі (на дошці «↩ СЗ-відповідь», кнопка «📌 Враховано →»).
-- Застосовує власник через SQL Editor. Повторний запуск безпечний.

ALTER TABLE public.dept_cases DROP CONSTRAINT IF EXISTS dept_cases_our_role_check;
ALTER TABLE public.dept_cases ADD CONSTRAINT dept_cases_our_role_check
  CHECK (our_role IN ('lead', 'co', 'info', 'answer'));
