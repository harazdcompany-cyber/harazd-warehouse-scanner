-- HARAZD WAREHOUSE V39. Run once in Supabase SQL Editor.
-- Access model: authenticated employees can read and edit all warehouse records.
-- Create employee accounts in Supabase Auth; disable public signups in Auth settings.
create extension if not exists pgcrypto;
create table if not exists public.categories(id uuid primary key default gen_random_uuid(),name text not null unique check(length(trim(name))>0),created_at timestamptz not null default now());
create table if not exists public.subcategories(id uuid primary key default gen_random_uuid(),category_id uuid not null references public.categories(id) on delete cascade,name text not null check(length(trim(name))>0),created_at timestamptz not null default now(),unique(category_id,name));
create table if not exists public.warehouses(id uuid primary key default gen_random_uuid(),name text not null unique check(length(trim(name))>0),created_at timestamptz not null default now());
create sequence if not exists public.equipment_number_seq start 1;
create table if not exists public.equipment(
 id uuid primary key default gen_random_uuid(),eq_id text not null unique default ('EQ-'||lpad(nextval('public.equipment_number_seq')::text,6,'0')),
 name text not null check(length(trim(name))>0),description text,category_id uuid not null references public.categories(id),subcategory_id uuid references public.subcategories(id),
 accounting_type text not null check(accounting_type in ('personal','general')),manufacturer text,model text,unit text not null default 'шт.',
 quantity integer not null default 1 check(quantity>=1),repair_quantity integer not null default 0 check(repair_quantity>=0 and repair_quantity<=quantity),
 weight numeric(14,3) not null default 0 check(weight>=0),warehouse_id uuid references public.warehouses(id),zone text,rack text,shelf text,packaging text,
 price numeric(14,2) not null default 0 check(price>=0),rental_price numeric(14,2) not null default 0 check(rental_price>=0),
 serial text unique,barcode text unique,qr text unique,photo_url text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint personal_qty_one check(accounting_type<>'personal' or quantity=1)
);
create index if not exists equipment_category_idx on public.equipment(category_id);
create index if not exists equipment_warehouse_idx on public.equipment(warehouse_id);
create index if not exists equipment_name_idx on public.equipment(name);
create or replace function public.validate_equipment() returns trigger language plpgsql set search_path=public as $$begin
 if new.subcategory_id is not null and not exists(select 1 from public.subcategories s where s.id=new.subcategory_id and s.category_id=new.category_id) then raise exception 'Підкатегорія не належить вибраній категорії'; end if;
 new.updated_at=now();return new;end$$;
drop trigger if exists equipment_validate on public.equipment;
create trigger equipment_validate before insert or update on public.equipment for each row execute function public.validate_equipment();
-- Atomic RPC: creates one row for general accounting, N rows for personal accounting.
create or replace function public.create_equipment(payload jsonb) returns jsonb language plpgsql security invoker set search_path=public as $$
declare n int; i int; rec public.equipment; ids text[]:=array[]::text[]; typ text;
begin
 if auth.uid() is null then raise exception 'Authorization required';end if;
 n:=coalesce((payload->>'quantity')::int,1);typ:=payload->>'accounting_type';
 if n<1 or n>500 then raise exception 'Кількість має бути від 1 до 500';end if;
 if typ not in ('personal','general') then raise exception 'Невірний тип обліку';end if;
 if typ='personal' and n>1 and (nullif(payload->>'serial','') is not null or nullif(payload->>'barcode','') is not null or nullif(payload->>'qr','') is not null) then raise exception 'Ідентифікатори персональних одиниць мають бути унікальними';end if;
 for i in 1..(case when typ='personal' then n else 1 end) loop
 insert into public.equipment(name,description,category_id,subcategory_id,accounting_type,manufacturer,model,unit,quantity,repair_quantity,weight,warehouse_id,zone,rack,shelf,packaging,price,rental_price,serial,barcode,qr,photo_url)
 values(payload->>'name',payload->>'description',(payload->>'category_id')::uuid,nullif(payload->>'subcategory_id','')::uuid,typ,payload->>'manufacturer',payload->>'model',coalesce(nullif(payload->>'unit',''),'шт.'),case when typ='personal' then 1 else n end,case when typ='personal' and n>1 then 0 else coalesce((payload->>'repair_quantity')::int,0) end,coalesce((payload->>'weight')::numeric,0),nullif(payload->>'warehouse_id','')::uuid,payload->>'zone',payload->>'rack',payload->>'shelf',payload->>'packaging',coalesce((payload->>'price')::numeric,0),coalesce((payload->>'rental_price')::numeric,0),payload->>'serial',payload->>'barcode',payload->>'qr',payload->>'photo_url') returning * into rec;
 ids:=array_append(ids,rec.eq_id);
 end loop;
 return jsonb_build_object('success',true,'count',array_length(ids,1),'ids',ids);
end$$;
revoke all on function public.create_equipment(jsonb) from public,anon;
grant execute on function public.create_equipment(jsonb) to authenticated;
-- RLS: anonymous visitors cannot access warehouse records.
alter table public.categories enable row level security;
alter table public.subcategories enable row level security;
alter table public.warehouses enable row level security;
alter table public.equipment enable row level security;
do $$declare t text;begin foreach t in array array['categories','subcategories','warehouses','equipment'] loop
 execute format('drop policy if exists employee_access on public.%I',t);
 execute format('create policy employee_access on public.%I for all to authenticated using (true) with check (true)',t);
 execute format('revoke all on public.%I from anon',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 end loop;end$$;
revoke all on sequence public.equipment_number_seq from anon;
grant usage,select on sequence public.equipment_number_seq to authenticated;
