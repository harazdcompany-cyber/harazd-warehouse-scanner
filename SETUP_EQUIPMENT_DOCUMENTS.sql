-- HARAZD WAREHOUSE: private documents per equipment item.
-- Run in Supabase SQL Editor once. Existing equipment is not modified.
BEGIN;
CREATE TABLE IF NOT EXISTS public.equipment_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 150),
 document_type text NOT NULL DEFAULT 'Інший',
 file_name text NOT NULL,
 file_path text NOT NULL UNIQUE,
 file_size bigint NOT NULL CHECK (file_size BETWEEN 1 AND 20971520),
 mime_type text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 uploaded_by uuid NOT NULL DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS equipment_documents_equipment_idx ON public.equipment_documents(equipment_id);
ALTER TABLE public.equipment_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON public.equipment_documents TO authenticated;
DROP POLICY IF EXISTS equipment_docs_read ON public.equipment_documents;
CREATE POLICY equipment_docs_read ON public.equipment_documents FOR SELECT TO authenticated
 USING (public.warehouse_can('equipment_view'));
DROP POLICY IF EXISTS equipment_docs_insert ON public.equipment_documents;
CREATE POLICY equipment_docs_insert ON public.equipment_documents FOR INSERT TO authenticated
 WITH CHECK (public.warehouse_can('equipment_edit') AND uploaded_by=auth.uid()
  AND file_path LIKE equipment_id::text || '/%' AND file_path NOT LIKE '%/../%');
DROP POLICY IF EXISTS equipment_docs_delete ON public.equipment_documents;
CREATE POLICY equipment_docs_delete ON public.equipment_documents FOR DELETE TO authenticated
 USING (public.warehouse_can('equipment_edit'));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('equipment-documents','equipment-documents',false,20971520,
 ARRAY['application/pdf','image/jpeg','image/png','image/webp','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
 ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=20971520,allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS equipment_docs_storage_read ON storage.objects;
CREATE POLICY equipment_docs_storage_read ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='equipment-documents' AND public.warehouse_can('equipment_view')
  AND EXISTS(SELECT 1 FROM public.equipment e WHERE e.id::text=split_part(name,'/',1)));
DROP POLICY IF EXISTS equipment_docs_storage_insert ON storage.objects;
CREATE POLICY equipment_docs_storage_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='equipment-documents' AND public.warehouse_can('equipment_edit')
  AND EXISTS(SELECT 1 FROM public.equipment e WHERE e.id::text=split_part(name,'/',1)));
DROP POLICY IF EXISTS equipment_docs_storage_delete ON storage.objects;
CREATE POLICY equipment_docs_storage_delete ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id='equipment-documents' AND public.warehouse_can('equipment_edit')
  AND EXISTS(SELECT 1 FROM public.equipment e WHERE e.id::text=split_part(name,'/',1)));
NOTIFY pgrst,'reload schema';
COMMIT;
