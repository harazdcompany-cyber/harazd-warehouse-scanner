-- IMPORTANT: Replace YOUR_ADMIN_EMAIL with your existing Supabase Auth email.
-- Execute once in Supabase SQL Editor after SUPABASE_V48_1_ACCESS.sql.
DO $$
DECLARE admin_id uuid;
BEGIN
 SELECT id INTO admin_id FROM auth.users WHERE lower(email)=lower('YOUR_ADMIN_EMAIL');
 IF admin_id IS NULL THEN RAISE EXCEPTION 'Admin email not found in Supabase Auth'; END IF;
 INSERT INTO public.warehouse_staff(user_id,email,full_name,position,role,status,permissions)
 VALUES(admin_id,lower('YOUR_ADMIN_EMAIL'),'Адміністратор','', 'admin','active','{}'::jsonb)
 ON CONFLICT (user_id) DO UPDATE SET role='admin',status='active';
END $$;
