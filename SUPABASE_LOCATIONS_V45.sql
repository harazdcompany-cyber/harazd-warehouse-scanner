-- HARAZD WAREHOUSE V45: run once in Supabase SQL Editor
create table if not exists public.storage_locations (
 id uuid primary key default gen_random_uuid(),
 warehouse_id uuid not null references public.warehouses(id) on delete cascade,
 parent_id uuid references public.storage_locations(id) on delete restrict,
 kind text not null check(kind in ('zone','rack','shelf')),
 name text not null check(length(btrim(name)) between 1 and 100),
 created_at timestamptz not null default now(),
 unique (id,warehouse_id)
);
create unique index if not exists storage_locations_unique_siblings on public.storage_locations(warehouse_id,kind,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name));
create or replace function public.validate_storage_location() returns trigger language plpgsql set search_path=public as $$
declare p record;
begin
 if new.kind='zone' then
  if new.parent_id is not null then raise exception 'Zone cannot have parent'; end if;
 else
  if new.parent_id is null then raise exception 'Rack/shelf requires parent'; end if;
  select warehouse_id,kind into p from public.storage_locations where id=new.parent_id;
  if not found or p.warehouse_id<>new.warehouse_id or (new.kind='rack' and p.kind<>'zone') or (new.kind='shelf' and p.kind<>'rack') then raise exception 'Invalid location hierarchy'; end if;
 end if;
 return new;
end $$;
drop trigger if exists validate_storage_location_trigger on public.storage_locations;
create trigger validate_storage_location_trigger before insert or update on public.storage_locations for each row execute function public.validate_storage_location();
alter table public.storage_locations enable row level security;
drop policy if exists storage_locations_select on public.storage_locations;
drop policy if exists storage_locations_insert on public.storage_locations;
drop policy if exists storage_locations_update on public.storage_locations;
create policy storage_locations_select on public.storage_locations for select to authenticated using (true);
create policy storage_locations_insert on public.storage_locations for insert to authenticated with check (true);
create policy storage_locations_update on public.storage_locations for update to authenticated using (true) with check (true);
grant select,insert,update on public.storage_locations to authenticated;
