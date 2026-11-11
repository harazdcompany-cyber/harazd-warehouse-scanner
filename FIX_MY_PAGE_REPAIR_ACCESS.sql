-- HARAZD WAREHOUSE · Виправлення доступу до «Керування ремонтом».
-- Застосувати в Supabase SQL Editor після SETUP_MY_PAGE_REPAIR_CONTROL.sql.
-- Не змінює схему таблиць, існуючі ремонти, фото або права працівників.
-- Адміністратори та користувачі з repairs_manage вже можуть редагувати ремонти в основному розділі.

BEGIN;

CREATE OR REPLACE FUNCTION public.warehouse_is_assigned_repair(p_job_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.repair_jobs j
     WHERE j.id = p_job_id
       AND (
         -- Managers with repairs_manage already have access to all repairs in the main module.
         public.warehouse_can('repairs_manage')
         OR EXISTS (
           SELECT 1 FROM public.warehouse_staff s
           WHERE s.user_id = (SELECT auth.uid())
             AND s.status = 'active'
             AND length(btrim(s.full_name)) > 0
             AND lower(btrim(coalesce(j.assignee,''))) = lower(btrim(s.full_name))
             AND (SELECT count(*) FROM public.warehouse_staff s2
                  WHERE s2.status = 'active'
                    AND lower(btrim(s2.full_name)) = lower(btrim(s.full_name))) = 1
         )
       )
   );
$$;
REVOKE ALL ON FUNCTION public.warehouse_is_assigned_repair(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.warehouse_is_assigned_repair(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
