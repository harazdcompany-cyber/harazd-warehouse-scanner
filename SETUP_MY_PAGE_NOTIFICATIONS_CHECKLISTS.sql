-- HARAZD WAREHOUSE · «Моя сторінка»: сповіщення та чеклісти завдань.
-- Запустити один раз у Supabase SQL Editor після SETUP_MY_PAGE_AVATARS_TASKS.sql.
-- Не змінює існуючі таблиці, завдання, події, ремонти або їхні дозволи.
BEGIN;

-- 1. Пункти чеклістів зберігаються окремо від існуючих завдань.
CREATE TABLE IF NOT EXISTS public.warehouse_task_checklist (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES public.warehouse_personal_tasks(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
 position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
 done boolean NOT NULL DEFAULT false,
 done_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_task_checklist_task_idx
 ON public.warehouse_task_checklist(task_id,position,id);

ALTER TABLE public.warehouse_task_checklist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_task_checklist FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.warehouse_task_checklist TO authenticated;

DROP POLICY IF EXISTS warehouse_checklist_read ON public.warehouse_task_checklist;
CREATE POLICY warehouse_checklist_read ON public.warehouse_task_checklist
FOR SELECT TO authenticated USING (
 EXISTS (
   SELECT 1 FROM public.warehouse_personal_tasks t
   WHERE t.id=task_id AND (
     (t.assignee_id=(SELECT auth.uid()) AND EXISTS (
       SELECT 1 FROM public.warehouse_staff s
       WHERE s.user_id=(SELECT auth.uid()) AND s.status='active'
     ))
     OR (t.created_by=(SELECT auth.uid()) AND public.warehouse_can('personnel_manage'))
   )
 )
);

DROP POLICY IF EXISTS warehouse_checklist_insert ON public.warehouse_task_checklist;
CREATE POLICY warehouse_checklist_insert ON public.warehouse_task_checklist
FOR INSERT TO authenticated WITH CHECK (
 EXISTS (
   SELECT 1 FROM public.warehouse_personal_tasks t
   WHERE t.id=task_id AND t.created_by=(SELECT auth.uid())
     AND public.warehouse_can('personnel_manage')
 )
);

DROP POLICY IF EXISTS warehouse_checklist_delete ON public.warehouse_task_checklist;
CREATE POLICY warehouse_checklist_delete ON public.warehouse_task_checklist
FOR DELETE TO authenticated USING (
 EXISTS (
   SELECT 1 FROM public.warehouse_personal_tasks t
   WHERE t.id=task_id AND t.created_by=(SELECT auth.uid())
     AND public.warehouse_can('personnel_manage')
 )
);

-- Працівник може позначати лише пункти власного призначеного завдання.
-- Прямий UPDATE на таблицю не видається.
CREATE OR REPLACE FUNCTION public.warehouse_set_my_checklist_done(
 p_item_id uuid, p_done boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_done IS NULL THEN
   RAISE EXCEPTION 'Invalid checklist value' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.warehouse_task_checklist c
   JOIN public.warehouse_personal_tasks t ON t.id=c.task_id
   JOIN public.warehouse_staff s ON s.user_id=t.assignee_id
   WHERE c.id=p_item_id AND t.assignee_id=(SELECT auth.uid())
     AND s.status='active'
 ) THEN
   RAISE EXCEPTION 'Checklist item not found or access denied' USING ERRCODE='42501';
 END IF;
 UPDATE public.warehouse_task_checklist
 SET done=p_done, done_at=CASE WHEN p_done THEN now() ELSE NULL END
 WHERE id=p_item_id;
END;
$$;
REVOKE ALL ON FUNCTION public.warehouse_set_my_checklist_done(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.warehouse_set_my_checklist_done(uuid,boolean) TO authenticated;

-- 2. Приватні сповіщення. Клієнт порівнює поточні призначення з останнім
-- зафіксованим станом, тому сповіщення з'являються при відкритті «Моєї сторінки».
CREATE TABLE IF NOT EXISTS public.warehouse_my_notification_state (
 user_id uuid NOT NULL REFERENCES public.warehouse_staff(user_id) ON DELETE CASCADE,
 source_type text NOT NULL CHECK (source_type IN ('task','event','repair')),
 source_id uuid NOT NULL,
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
 date_key text NOT NULL DEFAULT '' CHECK (length(date_key) <= 180),
 change_kind text NOT NULL DEFAULT 'assigned'
   CHECK (change_kind IN ('assigned','deadline_changed')),
 changed_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 PRIMARY KEY(user_id,source_type,source_id)
);
CREATE INDEX IF NOT EXISTS warehouse_my_notification_unread_idx
 ON public.warehouse_my_notification_state(user_id,read_at,changed_at DESC);

ALTER TABLE public.warehouse_my_notification_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_my_notification_state FROM anon,authenticated;
GRANT SELECT, INSERT, UPDATE ON public.warehouse_my_notification_state TO authenticated;

DROP POLICY IF EXISTS warehouse_my_notification_read ON public.warehouse_my_notification_state;
CREATE POLICY warehouse_my_notification_read ON public.warehouse_my_notification_state
FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));

DROP POLICY IF EXISTS warehouse_my_notification_insert ON public.warehouse_my_notification_state;
CREATE POLICY warehouse_my_notification_insert ON public.warehouse_my_notification_state
FOR INSERT TO authenticated WITH CHECK (
 user_id=(SELECT auth.uid())
 AND EXISTS (SELECT 1 FROM public.warehouse_staff s
   WHERE s.user_id=(SELECT auth.uid()) AND s.status='active')
);

DROP POLICY IF EXISTS warehouse_my_notification_update ON public.warehouse_my_notification_state;
CREATE POLICY warehouse_my_notification_update ON public.warehouse_my_notification_state
FOR UPDATE TO authenticated
USING (user_id=(SELECT auth.uid()))
WITH CHECK (user_id=(SELECT auth.uid()));

NOTIFY pgrst,'reload schema';
COMMIT;
