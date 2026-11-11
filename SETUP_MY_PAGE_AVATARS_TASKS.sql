-- HARAZD WAREHOUSE · My Page: profile photos and assigned tasks.
-- Run manually in Supabase SQL Editor ONLY after the feature branch is approved.
-- No changes to existing data or existing tables.
BEGIN;

CREATE TABLE IF NOT EXISTS public.warehouse_staff_avatar (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_path text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_avatar_owner_path CHECK (
    photo_path LIKE user_id::text || '/avatar-%' AND right(photo_path, 4) = '.jpg'
  )
);

ALTER TABLE public.warehouse_staff_avatar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_staff_avatar FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_staff_avatar TO authenticated;

DROP POLICY IF EXISTS warehouse_avatar_read ON public.warehouse_staff_avatar;
CREATE POLICY warehouse_avatar_read ON public.warehouse_staff_avatar
FOR SELECT TO authenticated USING (
  user_id = (SELECT auth.uid()) OR public.warehouse_can('personnel_manage')
);
DROP POLICY IF EXISTS warehouse_avatar_insert ON public.warehouse_staff_avatar;
CREATE POLICY warehouse_avatar_insert ON public.warehouse_staff_avatar
FOR INSERT TO authenticated WITH CHECK (
  user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.warehouse_staff s
    WHERE s.user_id = (SELECT auth.uid()) AND s.status = 'active'
  )
);
DROP POLICY IF EXISTS warehouse_avatar_update ON public.warehouse_staff_avatar;
CREATE POLICY warehouse_avatar_update ON public.warehouse_staff_avatar
FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS warehouse_avatar_delete ON public.warehouse_staff_avatar;
CREATE POLICY warehouse_avatar_delete ON public.warehouse_staff_avatar
FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('warehouse-avatars', 'warehouse-avatars', false, 5242880, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS warehouse_avatars_read ON storage.objects;
CREATE POLICY warehouse_avatars_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'warehouse-avatars' AND
  (split_part(name, '/', 1) = (SELECT auth.uid())::text OR public.warehouse_can('personnel_manage'))
);
DROP POLICY IF EXISTS warehouse_avatars_insert ON storage.objects;
CREATE POLICY warehouse_avatars_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'warehouse-avatars' AND
  split_part(name, '/', 1) = (SELECT auth.uid())::text AND
  name ~ '^[0-9a-f-]+/avatar-[0-9a-f-]+\.jpg$'
);
DROP POLICY IF EXISTS warehouse_avatars_delete ON storage.objects;
CREATE POLICY warehouse_avatars_delete ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'warehouse-avatars' AND split_part(name, '/', 1) = (SELECT auth.uid())::text
);
-- New avatar uploads use distinct paths; update/upsert is intentionally not granted.

CREATE TABLE IF NOT EXISTS public.warehouse_personal_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignee_id uuid NOT NULL REFERENCES public.warehouse_staff(user_id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.warehouse_staff(user_id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  details text NOT NULL DEFAULT '' CHECK (length(details) <= 2000),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_personal_tasks_assignee_idx ON public.warehouse_personal_tasks(assignee_id, due_date);
CREATE INDEX IF NOT EXISTS warehouse_personal_tasks_creator_idx ON public.warehouse_personal_tasks(created_by);

ALTER TABLE public.warehouse_personal_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouse_personal_tasks FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.warehouse_personal_tasks TO authenticated;

DROP POLICY IF EXISTS warehouse_tasks_select ON public.warehouse_personal_tasks;
CREATE POLICY warehouse_tasks_select ON public.warehouse_personal_tasks
FOR SELECT TO authenticated USING (
  (assignee_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.warehouse_staff s
    WHERE s.user_id = (SELECT auth.uid()) AND s.status = 'active'
  )) OR
  (created_by = (SELECT auth.uid()) AND public.warehouse_can('personnel_manage'))
);
DROP POLICY IF EXISTS warehouse_tasks_insert ON public.warehouse_personal_tasks;
CREATE POLICY warehouse_tasks_insert ON public.warehouse_personal_tasks
FOR INSERT TO authenticated WITH CHECK (
  public.warehouse_can('personnel_manage')
  AND created_by = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.warehouse_staff s
    WHERE s.user_id = assignee_id AND s.status = 'active'
  )
);
DROP POLICY IF EXISTS warehouse_tasks_delete ON public.warehouse_personal_tasks;
CREATE POLICY warehouse_tasks_delete ON public.warehouse_personal_tasks
FOR DELETE TO authenticated USING (
  created_by = (SELECT auth.uid()) AND public.warehouse_can('personnel_manage')
);

-- Staff members can change ONLY the status of their assigned tasks.
-- No direct UPDATE privilege is granted to authenticated clients.
CREATE OR REPLACE FUNCTION public.warehouse_set_my_task_status(
  p_task_id uuid, p_status text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('todo','in_progress','done') THEN
    RAISE EXCEPTION 'Invalid task status' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouse_personal_tasks t
    JOIN public.warehouse_staff s ON s.user_id = t.assignee_id
    WHERE t.id = p_task_id AND t.assignee_id = auth.uid() AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Task not found or access denied' USING ERRCODE='42501';
  END IF;
  UPDATE public.warehouse_personal_tasks
  SET status = p_status, updated_at = now()
  WHERE id = p_task_id AND assignee_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.warehouse_set_my_task_status(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.warehouse_set_my_task_status(uuid,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
