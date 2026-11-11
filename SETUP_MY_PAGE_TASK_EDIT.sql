-- HARAZD WAREHOUSE · Дозвіл редагувати раніше створені завдання.
-- Запустіть один раз у Supabase → SQL Editor.
-- Створення, видалення та зміна статусу залишаються без змін.
-- Оновлювати завдання може лише його автор із правом personnel_manage.

BEGIN;

-- Забороняємо загальне оновлення всіх колонок; дозволяємо лише поля форми.
REVOKE UPDATE ON public.warehouse_personal_tasks FROM authenticated;
GRANT UPDATE (title, details, priority, due_date, assignee_id)
ON public.warehouse_personal_tasks TO authenticated;

DROP POLICY IF EXISTS warehouse_tasks_edit_created ON public.warehouse_personal_tasks;
CREATE POLICY warehouse_tasks_edit_created
ON public.warehouse_personal_tasks
FOR UPDATE TO authenticated
USING (
  created_by = (SELECT auth.uid())
  AND public.warehouse_can('personnel_manage')
)
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND public.warehouse_can('personnel_manage')
  AND EXISTS (
    SELECT 1
    FROM public.warehouse_staff s
    WHERE s.user_id = assignee_id
      AND s.status = 'active'
  )
);

NOTIFY pgrst, 'reload schema';
COMMIT;
