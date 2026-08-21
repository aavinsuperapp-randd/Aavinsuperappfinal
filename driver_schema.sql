-- ============================================================
-- AAVIN Driver Dashboard — Database Schema Migration
-- Run this in Supabase SQL Editor AFTER schema.sql and worker_schema.sql
-- ============================================================

-- ── DRIVER TRIPS ──────────────────────────────────────────────
-- This table stores transport/delivery trip assignments for driver-role users.
-- It is SEPARATE from public.trips (which is for worker BMC milk collection).
create table if not exists public.driver_trips (
  id uuid primary key default gen_random_uuid(),
  trip_number text unique,                              -- auto-generated e.g. DTRIP-20260821-0001

  -- Assignment info
  assigned_driver_id uuid references public.profiles(id) on delete set null,
  assigned_by        uuid references public.profiles(id) on delete set null,

  -- Vehicle info
  vehicle_id     uuid references public.tankers(id) on delete set null,
  vehicle_number text,

  -- Route info
  bmc_id      uuid references public.bmcs(id) on delete set null,
  bmc_name    text,
  destination text,
  route       text,

  -- Scheduling
  scheduled_start_time  timestamptz,
  scheduled_return_time timestamptz,

  -- Status
  status text not null default 'assigned'
    check (status in ('assigned','accepted','ready','in_progress','returning','completed','cancelled')),

  -- Timestamps
  accepted_at  timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,

  -- KM readings
  out_km       numeric,
  in_km        numeric,
  km_travelled numeric,

  -- Weight readings
  out_weight        numeric,
  in_weight         numeric,
  weight_difference numeric,

  -- Mileage calculations (auto-computed on backend)
  diesel_consumption numeric,
  average_mileage    numeric,

  -- Photos
  out_weight_photo text,   -- URL/path
  in_weight_photo  text,

  -- GPS coordinates
  start_lat numeric,
  start_lng numeric,
  end_lat   numeric,
  end_lng   numeric,

  remarks    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.driver_trips enable row level security;

-- Drivers can see only their own trips
create policy "Drivers see own trips"
  on public.driver_trips for select
  using (
    assigned_driver_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('transport_officer', 'gm', 'admin')
    )
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );

-- Drivers can update their own trips (limited fields via API)
create policy "Drivers can update own trips"
  on public.driver_trips for update
  using (
    assigned_driver_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('transport_officer', 'admin')
    )
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );

-- Transport officers and admins can insert trips
create policy "Transport officers can insert driver trips"
  on public.driver_trips for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('transport_officer', 'admin')
    )
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );

-- Transport officers and admins can delete
create policy "Transport officers can delete driver trips"
  on public.driver_trips for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('transport_officer', 'admin')
    )
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );


-- ── DRIVER TRIP NUMBER SEQUENCE ──────────────────────────────
create sequence if not exists public.driver_trip_seq start 1;

create or replace function public.generate_driver_trip_number()
returns trigger language plpgsql as $$
begin
  new.trip_number := 'DTRIP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.driver_trip_seq')::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists set_driver_trip_number on public.driver_trips;
create trigger set_driver_trip_number
  before insert on public.driver_trips
  for each row
  when (new.trip_number is null)
  execute function public.generate_driver_trip_number();


-- ── VEHICLE ASSIGNMENT HELPER ────────────────────────────────
-- Add profile_id column to tankers (optional: links a tanker to a driver account)
alter table public.tankers add column if not exists assigned_driver_id uuid references public.profiles(id) on delete set null;
alter table public.tankers add column if not exists vehicle_type text;
alter table public.tankers add column if not exists vehicle_model text;
alter table public.tankers add column if not exists current_km numeric;
alter table public.tankers add column if not exists image_url text;
alter table public.tankers add column if not exists status text default 'available'
  check (status in ('available', 'on_trip', 'maintenance', 'inactive'));

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
