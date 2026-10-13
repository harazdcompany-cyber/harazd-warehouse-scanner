-- HARAZD WAREHOUSE V47: run ONCE in Supabase SQL Editor.
-- Non-destructive: existing equipment records retain their current location fields.
BEGIN;
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS location_id uuid;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='equipment_location_id_fkey' AND conrelid='public.equipment'::regclass) THEN
  ALTER TABLE public.equipment ADD CONSTRAINT equipment_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.storage_locations(id) ON DELETE RESTRICT;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS equipment_location_id_idx ON public.equipment(location_id);
-- Validate warehouse and only allow final 'place' nodes.
CREATE OR REPLACE FUNCTION public.validate_equipment_location()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE loc record;
BEGIN
 IF NEW.location_id IS NOT NULL THEN
  SELECT kind,warehouse_id INTO loc FROM public.storage_locations WHERE id=NEW.location_id;
  IF NOT FOUND OR loc.kind <> 'place' OR loc.warehouse_id IS DISTINCT FROM NEW.warehouse_id THEN
   RAISE EXCEPTION 'Invalid equipment storage place or warehouse';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS equipment_location_check ON public.equipment;
CREATE TRIGGER equipment_location_check BEFORE INSERT OR UPDATE OF location_id,warehouse_id ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.validate_equipment_location();
-- Update the existing personal/general creation RPC to save location_id atomically.
create or replace function public.create_equipment(payload jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
declare n int; i int; rec public.equipment; ids text[]:=array[]::text[]; typ text;
begin
 if auth.uid() is null then raise exception 'Authorization required';end if;
 n:=coalesce((payload->>'quantity')::int,1);typ:=payload->>'accounting_type';
 if n<1 or n>500 then raise exception 'Кількість має бути від 1 до 500';end if;
 if typ not in ('personal','general') then raise exception 'Невірний тип обліку';end if;
 if typ='personal' and n>1 and (nullif(payload->>'serial','') is not null or nullif(payload->>'barcode','') is not null or nullif(payload->>'qr','') is not null) then raise exception 'Ідентифікатори персональних одиниць мають бути унікальними';end if;
 for i in 1..(case when typ='personal' then n else 1 end) loop
 insert into public.equipment(name,description,category_id,subcategory_id,accounting_type,manufacturer,model,unit,quantity,repair_quantity,weight,warehouse_id,zone,rack,shelf,location_id,packaging,price,rental_price,serial,barcode,qr,photo_url)
 values(payload->>'name',payload->>'description',(payload->>'category_id')::uuid,nullif(payload->>'subcategory_id','')::uuid,typ,payload->>'manufacturer',payload->>'model',coalesce(nullif(payload->>'unit',''),'шт.'),case when typ='personal' then 1 else n end,case when typ='personal' and n>1 then 0 else coalesce((payload->>'repair_quantity')::int,0) end,coalesce((payload->>'weight')::numeric,0),nullif(payload->>'warehouse_id','')::uuid,payload->>'zone',payload->>'rack',payload->>'shelf',nullif(payload->>'location_id','')::uuid,payload->>'packaging',coalesce((payload->>'price')::numeric,0),coalesce((payload->>'rental_price')::numeric,0),payload->>'serial',payload->>'barcode',payload->>'qr',payload->>'photo_url') returning * into rec;
 ids:=array_append(ids,rec.eq_id);
 end loop;
 return jsonb_build_object('success',true,'count',array_length(ids,1),'ids',ids);
end$$;
revoke all on function public.create_equipment(jsonb) from public,anon;
grant execute on function public.create_equipment(jsonb) to authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
