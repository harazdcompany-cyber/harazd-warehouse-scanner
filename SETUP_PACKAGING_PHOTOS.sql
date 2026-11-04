-- Run once in Supabase SQL Editor before uploading the website files.
alter table public.packaging add column if not exists photo_url text;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('packaging-photos','packaging-photos',true,10485760,array['image/jpeg','image/png','image/webp']) on conflict (id) do update set public=true,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists packaging_photos_read on storage.objects;
create policy packaging_photos_read on storage.objects for select to public using (bucket_id='packaging-photos');
drop policy if exists packaging_photos_upload on storage.objects;
create policy packaging_photos_upload on storage.objects for insert to authenticated with check (bucket_id='packaging-photos' and public.warehouse_can('equipment_edit'));
notify pgrst, 'reload schema';
