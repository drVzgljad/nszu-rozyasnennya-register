# Справи відділу (`spravy/`)

Дошка доручень відділу: одна картка = одна справа, від вхідного з АСКОД до вих. №.

| Етап (`stage`) | Колонка | Що означає |
|---|---|---|
| `new` | Нове | зареєстровано в АСКОД, до роботи ще не взялися |
| `work` | Готуємо | є виконавець і чернетка v1…vN |
| `review` | Погодження | рецензія, керівник; зауваження — окремими пунктами |
| `signing` | На підписі | файл у `10_НА_ПІДПИС\ДД.ММ.РР` |
| `done` | Закрито | вих. № є, резолюцію закрито (або «не наше» / «до відома») |

Повернули на доопрацювання — картка йде назад у «Готуємо», незакриті зауваження видно лічильником.

## Дані

Supabase, міграція `../migration_2026-11-02_dept_cases.sql` (застосовує власник):

- `dept_cases` — картка: реквізити вхідного, строк, резолюція, тип відповіді, етап, виконавець,
  версія, шлях до файлу в обміннику, посилання (Google Doc), нюанси, рецензія, вих. №.
  Унікальність — `(department, in_no)`.
- `dept_case_events` — стрічка: `comment`, `remark` (зауваження: `remark_from`, `remark_status`
  open/done/rejected, `remark_answer` — як враховано, `remark_version`) і автоматичні записи
  `stage` / `version` / `executor` / `review` / `system`, які пише **тригер бази**. Тому стрічка
  повна, хоч би хто змінив картку: сторінка, скрипт чи Claude напряму через SQL.
- RLS: читає свій відділ (`profiles."Section"`), керівництво департаменту і діловод (`is_clerk`);
  пише свій відділ і керівництво; видаляє керівник відділу або керівництво. Гостям — нічого.

У репозиторії даних немає й не буде: він публічний. Демо-режим `?demo=1` показує вигадані картки
й нічого не пише в базу. Ним зручно дивитися вигляд до застосування міграції.

## Наповнення з АСКОД

`D:\pmg-data\tools\spravy_sync.py` (поза репозиторієм порталу):

- бере найсвіжіший `journal_*.xlsx` у `00_ВХІДНЕ` і заводить свіжі справи (за 45 днів або з живим
  строком, без «до відома»), виконавця зводить із профілем за прізвищем та ім'ям;
- з `10_НА_ПІДПИС\_Контроль_листів_на_підпис.xlsx` бере актуальну версію листа → версія, шлях,
  етап «На підписі»; ручний «Стан» «зареєстровано / відправлено» + вих. № → «Закрито»;
- етап лише просуває вперед, ручних полів не чіпає; справу, що зникла з журналу, не закриває,
  а позначає в «Стан АСКОД».

```
python tools/spravy_sync.py            # холостий прогін
python tools/spravy_sync.py --sql      # SQL у %TEMP%\spravy_sync.sql — для конектора Supabase / SQL Editor
python tools/spravy_sync.py --push     # записати під своїм логіном порталу (під RLS)
```

## Як Claude веде картки

Claude пише через конектор Supabase (`execute_sql`). Конектор працює в обхід RLS, тому кожна зміна
підписується `updated_by_name = 'Claude'`, а в подіях — `author_name = 'Claude'`. Відділ —
`department = 'наукова та клінічна експертиза'` (або той, у якому справа).

Початок сесії — що горить:

```sql
select in_no, deadline, stage, executor_name, version, review_passed, left(subject, 80) subject,
       (select count(*) from dept_case_events e
         where e.case_id = c.id and e.kind = 'remark' and e.remark_status = 'open') open_remarks
from dept_cases c
where department = 'наукова та клінічна експертиза' and stage <> 'done'
order by deadline nulls last;
```

Робота над листом:

```sql
-- взялися / нова версія чернетки (тригер сам запише «Нове → Готуємо» і «Чернетка v2»)
update dept_cases set stage = 'work', version = 2,
       draft_path = '19_службові_записки\letter_10001_..._v2.json', updated_by_name = 'Claude'
where department = '…' and in_no = '10001-08-26';

-- зауваження керівника з Google Docs — по одному рядку на пункт
insert into dept_case_events (case_id, author_name, kind, body, remark_from, remark_status)
select id, 'Claude', 'remark', 'Другий абзац скоротити', 'Директор департаменту', 'open'
from dept_cases where department = '…' and in_no = '10001-08-26';

-- враховано у v3
update dept_case_events set remark_status = 'done', remark_answer = 'Абзац зведено до однієї тези',
       remark_version = 3 where id = '…';

-- рецензію пройдено, лист у 10_НА_ПІДПИС
update dept_cases set review_passed = true, stage = 'signing', version = 3,
       draft_path = '10_НА_ПІДПИС\02.11.26\lyst_10001_..._v3.docx', updated_by_name = 'Claude'
where department = '…' and in_no = '10001-08-26';

-- коментар у стрічку
insert into dept_case_events (case_id, author_name, kind, body)
select id, 'Claude', 'comment', 'Чекаємо дані ДІТ щодо оплат' from dept_cases where …;
```

Ініціативний лист без вхідного — `in_no` порожній, `source = 'claude'`.
