-- HARAZD WAREHOUSE V48.1 — run after backing up database.
-- After running, grant the first administrator with the separate bootstrap query below.
BEGIN;
CREATE TABLE IF NOT EXISTS public.warehouse_staff (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 email text NOT NULL,
 full_name text NOT NULL,
 position text NOT NULL DEFAULT '',
 role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','manager','warehouse','viewer')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 permissions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permissions)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.warehouse_can(p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.warehouse_staff s WHERE s.user_id=auth.uid() AND s.status='active' AND (s.role='admin' OR s.permissions->>p_permission='true'));
$$;
REVOKE ALL ON FUNCTION public.warehouse_can(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.warehouse_can(text) TO authenticated;
ALTER TABLE public.warehouse_staff ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.warehouse_staff TO authenticated;
DROP POLICY IF EXISTS staff_read ON public.warehouse_staff;
CREATE POLICY staff_read ON public.warehouse_staff FOR SELECT TO authenticated
 USING (user_id=auth.uid() OR public.warehouse_can('personnel_manage'));
-- No direct insert/update/delete by authenticated clients. Use the restricted RPC below.
REVOKE INSERT,UPDATE,DELETE ON public.warehouse_staff FROM authenticated,anon;
CREATE OR REPLACE FUNCTION public.warehouse_save_staff(
 p_email text,p_full_name text,p_position text,p_role text,p_status text,p_permissions jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target_id uuid; result_id uuid;
BEGIN
 IF NOT public.warehouse_can('personnel_manage') THEN RAISE EXCEPTION 'Not allowed to manage personnel'; END IF;
 IF p_role NOT IN ('admin','manager','warehouse','viewer') OR p_status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'Invalid role or status'; END IF;
 IF length(trim(coalesce(p_full_name,'')))=0 OR length(trim(coalesce(p_email,'')))=0 THEN RAISE EXCEPTION 'Name and email are required'; END IF;
 IF jsonb_typeof(p_permissions) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid permissions'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_permissions) AS j(k,v) WHERE jsonb_typeof(j.v)<>'boolean') THEN RAISE EXCEPTION 'Permissions must be boolean'; END IF;
 SELECT id INTO target_id FROM auth.users WHERE lower(email)=lower(trim(p_email));
 IF target_id IS NULL THEN RAISE EXCEPTION 'User not found in Supabase Auth. Create an account first.'; END IF;
 INSERT INTO public.warehouse_staff(user_id,email,full_name,position,role,status,permissions)
 VALUES(target_id,lower(trim(p_email)),trim(p_full_name),coalesce(p_position,''),p_role,p_status,p_permissions)
 ON CONFLICT (user_id) DO UPDATE SET full_name=excluded.full_name,position=excluded.position,
 role=excluded.role,status=excluded.status,permissions=excluded.permissions,updated_at=now()
 RETURNING user_id INTO result_id;
 RETURN result_id;
END;
$$;
REVOKE ALL ON FUNCTION public.warehouse_save_staff(text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.warehouse_save_staff(text,text,text,text,text,jsonb) TO authenticated;
-- Triggers protect existing data even if legacy permissive RLS policies still exist.
CREATE OR REPLACE FUNCTION public.warehouse_guard_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE needed text;
BEGIN
 -- SQL editor and internal administrative operations remain possible.
 IF auth.uid() IS NULL AND coalesce(auth.role(),'') NOT IN ('anon','authenticated') THEN RETURN COALESCE(NEW,OLD); END IF;
 IF TG_TABLE_NAME='equipment' THEN
  needed:=CASE WHEN TG_OP='INSERT' THEN 'equipment_add' ELSE 'equipment_edit' END;
 ELSE needed:='directory_manage'; END IF;
 IF NOT public.warehouse_can(needed) THEN RAISE EXCEPTION 'Access denied: %',needed USING ERRCODE='42501'; END IF;
 RETURN COALESCE(NEW,OLD);
END;
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['equipment','categories','subcategories','warehouses','storage_locations'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('DROP TRIGGER IF EXISTS warehouse_permission_guard ON public.%I',t);
   EXECUTE format('CREATE TRIGGER warehouse_permission_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.warehouse_guard_write()',t);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
