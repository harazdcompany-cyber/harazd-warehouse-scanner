-- HARAZD WAREHOUSE: транспорт, записи робіт та приватні документи.
-- Запустити один раз у Supabase SQL Editor від імені адміністратора проєкту.
create extension if not exists pgcrypto;
create table if not exists public.fleet_vehicles (
 id uuid primary key default gen_random_uuid(), make text not null, model text not null,
 year integer, plate text, vin text, vehicle_type text, mileage bigint,
 driver text, status text not null default 'active' check (status in ('active','service','inactive')),
 payload_kg numeric, dimensions text, photo_url text,
 next_service_date date, next_service_mileage bigint, insurance_until date,
 inspection_until date, tachograph_until date, tachograph_model text, notes text,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.fleet_records (
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.fleet_vehicles(id) on delete cascade,
 kind text not null check(kind in ('repair','service','insurance','inspection','tachograph')),
 performed_at date not null, cost numeric default 0, mileage bigint, provider text,
 next_due_date date, next_due_mileage bigint, description text not null,
 created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.fleet_documents (
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.fleet_vehicles(id) on delete cascade,
 kind text not null, title text, file_name text not null, storage_path text not null unique,
 mime_type text, file_size bigint, created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists fleet_records_vehicle_idx on public.fleet_records(vehicle_id);
create index if not exists fleet_docs_vehicle_idx on public.fleet_documents(vehicle_id);
create or replace function public.fleet_touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
drop trigger if exists fleet_vehicles_touch on public.fleet_vehicles;
create trigger fleet_vehicles_touch before update on public.fleet_vehicles for each row execute function public.fleet_touch_updated_at();
-- Доступ лише активному персоналу з таблиці warehouse_staff (перевірка без рекурсивної RLS).
-- За відсутності warehouse_staff потрібно адаптувати цю функцію до власної таблиці персоналу.
create or replace function public.fleet_is_staff() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.warehouse_staff s where s.user_id=auth.uid() and s.status='active');
$$;
revoke all on function public.fleet_is_staff() from public;
grant execute on function public.fleet_is_staff() to authenticated;
alter table public.fleet_vehicles enable row level security;
alter table public.fleet_records enable row level security;
alter table public.fleet_documents enable row level security;
drop policy if exists fleet_vehicles_staff on public.fleet_vehicles;
create policy fleet_vehicles_staff on public.fleet_vehicles for all to authenticated using(public.fleet_is_staff()) with check(public.fleet_is_staff());
drop policy if exists fleet_records_staff on public.fleet_records;
create policy fleet_records_staff on public.fleet_records for all to authenticated using(public.fleet_is_staff()) with check(public.fleet_is_staff());
drop policy if exists fleet_documents_staff on public.fleet_documents;
create policy fleet_documents_staff on public.fleet_documents for all to authenticated using(public.fleet_is_staff()) with check(public.fleet_is_staff());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('fleet-private','fleet-private',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
 on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists fleet_storage_read on storage.objects;
create policy fleet_storage_read on storage.objects for select to authenticated using(bucket_id='fleet-private' and public.fleet_is_staff());
drop policy if exists fleet_storage_insert on storage.objects;
create policy fleet_storage_insert on storage.objects for insert to authenticated with check(bucket_id='fleet-private' and public.fleet_is_staff());
drop policy if exists fleet_storage_delete on storage.objects;
create policy fleet_storage_delete on storage.objects for delete to authenticated using(bucket_id='fleet-private' and public.fleet_is_staff());
