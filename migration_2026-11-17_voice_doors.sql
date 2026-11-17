-- ============================================================
-- «Двері відділів» на головній (home-doors.js) + «Вивести» гостя з кімнати відділу (spravy/voice.js)
-- 17.11.2026 · доповнює migration_2026-11-10b_voice_knock.sql (стук, пустити / ні)
--
-- Що додає:
--   1) статус 'out' — гостя вивели з кімнати (хтось із відділу натиснув «Вивести»);
--      voice_room_allowed() пускає лише за 'ok', тож дозвіл знято одразу;
--   2) хто й коли вивів: out_by_name, out_at (хто пустив — і далі в decided_by_name);
--   3) кого вивели, той 10 хвилин не може постукати в ту саму кімнату знову.
--
-- Без цієї міграції сторінки теж працюють: «Вивести» ставить 'gone' (як «пішов сам»),
-- гість так само виходить, лише без позначки, хто вивів, і без паузи на повторний стук.
--
-- Застосовує власник через SQL Editor. Повторний запуск безпечний.
-- ============================================================

-- 1. Статус 'out': знімаємо стару перевірку статусу (ім'я в неї автоматичне) і ставимо нову
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.voice_knocks'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.voice_knocks DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.voice_knocks
  ADD CONSTRAINT voice_knocks_status_check CHECK (status IN ('wait', 'ok', 'no', 'gone', 'out'));

-- 2. Хто вивів
ALTER TABLE public.voice_knocks ADD COLUMN IF NOT EXISTS out_by_name TEXT;
ALTER TABLE public.voice_knocks ADD COLUMN IF NOT EXISTS out_at TIMESTAMPTZ;

-- 3. Стукає лише сам за себе, лише співробітник, і не одразу після того, як його вивели
DROP POLICY IF EXISTS voice_knocks_insert ON public.voice_knocks;
CREATE POLICY voice_knocks_insert ON public.voice_knocks FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND status = 'wait'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IS DISTINCT FROM 'guest')
    AND NOT EXISTS (SELECT 1 FROM public.voice_knocks k
                    WHERE k.user_id = auth.uid() AND k.topic = voice_knocks.topic
                      AND k.status = 'out' AND k.out_at > now() - interval '10 minutes')
  );

-- Рішення ухвалює член кімнати (пустити, ні, вивести); гість може лише скасувати чи піти ('gone'),
-- але не «перебити» 'out' — інакше зникла б позначка, хто вивів
DROP POLICY IF EXISTS voice_knocks_update ON public.voice_knocks;
CREATE POLICY voice_knocks_update ON public.voice_knocks FOR UPDATE TO authenticated
  USING (public.voice_room_member(topic) OR (user_id = auth.uid() AND status <> 'out'))
  WITH CHECK (public.voice_room_member(topic) OR (user_id = auth.uid() AND status = 'gone'));

-- Перевірка: має повернути рядок з 'out' у переліку
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'voice_knocks_status_check';
