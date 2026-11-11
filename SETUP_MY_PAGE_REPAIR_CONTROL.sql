-- HARAZD WAREHOUSE · Керування власними призначеними ремонтами зі сторінки «Моя сторінка».
-- Виконати один раз у Supabase SQL Editor від імені адміністратора бази.
-- Існуючі заявки, права менеджерів, фото та інші модулі не змінюються.
-- Заявки наразі прив'язані до ПІБ, тому для безпеки збіг ПІБ має бути унікальним.

BEGIN;

CREATE OR REPLACE FUNCTION public.warehouse_is_assigned_repair(p_job_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.repair_jobs j
   JOIN public.warehouse_staff s ON s.user_id = (SELECT auth.uid())
   WHERE j.id = p_job_id
     AND s.status = 'active'
     AND length(btrim(s.full_name)) > 0
     AND lower(btrim(coalesce(j.assignee,''))) = lower(btrim(s.full_name))
     AND (SELECT count(*) FROM public.warehouse_staff s2
          WHERE s2.status = 'active'
            AND lower(btrim(s2.full_name)) = lower(btrim(s.full_name))) = 1
 );
$$;
REVOKE ALL ON FUNCTION public.warehouse_is_assigned_repair(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.warehouse_is_assigned_repair(uuid) TO authenticated;

-- Контрольоване оновлення: не можна змінити обладнання, призначеного працівника,
-- дату заявки, термін, вартість або видалити заявку.
CREATE OR REPLACE FUNCTION public.warehouse_update_my_repair(
 p_job_id uuid, p_status text, p_notes text, p_completed_on date DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.warehouse_is_assigned_repair(p_job_id) THEN
   RAISE EXCEPTION 'Ремонт не призначено вам або ПІБ неоднозначний'
     USING ERRCODE='42501';
 END IF;
 IF p_status IS NULL OR p_status NOT IN
   ('new','diagnostics','waiting','progress','done','cancelled') THEN
   RAISE EXCEPTION 'Невідомий статус ремонту';
 END IF;
 IF length(coalesce(p_notes,'')) > 5000 THEN
   RAISE EXCEPTION 'Нотатки перевищують 5000 символів';
 END IF;
 UPDATE public.repair_jobs
 SET status=p_status,
     notes=coalesce(p_notes,''),
     completed_on=CASE WHEN p_status='done' THEN coalesce(p_completed_on,current_date) ELSE NULL END
 WHERE id=p_job_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ремонт не знайдено'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.warehouse_update_my_repair(uuid,text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.warehouse_update_my_repair(uuid,text,text,date) TO authenticated;

-- Безпечне читання фотоматеріалів саме власного ремонту без загального SELECT.
CREATE OR REPLACE FUNCTION public.warehouse_my_repair_photos(p_job_id uuid)
RETURNS TABLE(id text,storage_path text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.warehouse_is_assigned_repair(p_job_id) THEN
   RAISE EXCEPTION 'Немає доступу до фотографій цього ремонту' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT p.id::text,p.storage_path::text,p.created_at
 FROM public.repair_job_photos p
 WHERE p.job_id=p_job_id
 ORDER BY p.created_at,p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.warehouse_my_repair_photos(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.warehouse_my_repair_photos(uuid) TO authenticated;

-- Фото завантажується у вже наявне сховище repair-photos, потім записується його шлях.
CREATE OR REPLACE FUNCTION public.warehouse_add_my_repair_photo(p_job_id uuid,p_storage_path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.warehouse_is_assigned_repair(p_job_id) THEN
   RAISE EXCEPTION 'Немає доступу до ремонту' USING ERRCODE='42501';
 END IF;
 IF p_storage_path IS NULL
    OR p_storage_path !~* ('^'||p_job_id::text||'/[0-9a-f-]{36}\\.(jpg|png|webp)$') THEN
   RAISE EXCEPTION 'Невірний шлях фотографії';
 END IF;
 IF (SELECT count(*) FROM public.repair_job_photos WHERE job_id=p_job_id) >= 10 THEN
   RAISE EXCEPTION 'Максимум 10 фотографій на ремонт';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM storage.objects
                WHERE bucket_id='repair-photos' AND name=p_storage_path) THEN
   RAISE EXCEPTION 'Фото ще не завантажене';
 END IF;
 INSERT INTO public.repair_job_photos(job_id,storage_path)
 VALUES(p_job_id,p_storage_path);
END;
$$;
REVOKE ALL ON FUNCTION public.warehouse_add_my_repair_photo(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.warehouse_add_my_repair_photo(uuid,text) TO authenticated;

-- У Storage доступ лише до папки призначеної заявки. Спільні старі політики не чіпаємо.
DROP POLICY IF EXISTS warehouse_my_repair_photo_read ON storage.objects;
CREATE POLICY warehouse_my_repair_photo_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id='repair-photos'
  AND CASE WHEN split_part(name,'/',1) ~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.warehouse_is_assigned_repair(split_part(name,'/',1)::uuid)
    ELSE false END
);

DROP POLICY IF EXISTS warehouse_my_repair_photo_upload ON storage.objects;
CREATE POLICY warehouse_my_repair_photo_upload ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='repair-photos'
  AND CASE WHEN split_part(name,'/',1) ~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.warehouse_is_assigned_repair(split_part(name,'/',1)::uuid)
    ELSE false END
);

-- При збої запису метаданих можна прибрати лише власний щойно завантажений файл.
DROP POLICY IF EXISTS warehouse_my_repair_photo_cleanup ON storage.objects;
CREATE POLICY warehouse_my_repair_photo_cleanup ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id='repair-photos'
  AND owner_id=(SELECT auth.uid())::text
  AND CASE WHEN split_part(name,'/',1) ~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.warehouse_is_assigned_repair(split_part(name,'/',1)::uuid)
    ELSE false END
);

NOTIFY pgrst,'reload schema';
COMMIT;
