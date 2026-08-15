-- ============================================================
-- AAVIN Worker Portal — Database Migration
-- Run this in Supabase SQL Editor AFTER the base schema.sql
-- ============================================================

-- ── DRIVERS ──────────────────────────────────────────────────
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  license_number text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.drivers enable row level security;
create policy "Authenticated users can view drivers"
  on public.drivers for select using (auth.role() = 'authenticated');
create policy "Admin can manage drivers"
  on public.drivers for all
  using (auth.jwt() ->> 'email' = 'admin@gmail.com')
  with check (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- Seed some default drivers
insert into public.drivers (name, license_number, phone) values
  ('Murugan K', 'TN38 20230001', '9876543210'),
  ('Selvam R', 'TN38 20190042', '9865321470'),
  ('Balamurugan S', 'TN38 20180093', '9944123456')
on conflict do nothing;


-- ── TANKERS ──────────────────────────────────────────────────
create table if not exists public.tankers (
  id uuid primary key default gen_random_uuid(),
  board_number text not null unique,
  capacity_liters integer,
  compartments integer not null default 2,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.tankers enable row level security;
create policy "Authenticated users can view tankers"
  on public.tankers for select using (auth.role() = 'authenticated');
create policy "Admin can manage tankers"
  on public.tankers for all
  using (auth.jwt() ->> 'email' = 'admin@gmail.com')
  with check (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- Seed some tankers
insert into public.tankers (board_number, capacity_liters) values
  ('TN 64 R 3319', 5000),
  ('TN 38 T 1234', 8000),
  ('TN 11 K 9870', 6000)
on conflict do nothing;


-- ── TRIPS ────────────────────────────────────────────────────
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  trip_number text unique,          -- auto-generated e.g. TRIP-20260815-0001
  trip_name text not null,
  worker_id uuid not null references public.profiles(id),
  driver_name text not null,
  tanker_number text not null,
  driver_id uuid references public.drivers(id),   -- optional legacy ref
  tanker_id uuid references public.tankers(id),   -- optional legacy ref
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  out_time timestamptz not null default now(),
  in_time timestamptz,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.trips enable row level security;


-- Workers see only their own trips; admin sees all
create policy "Workers see own trips"
  on public.trips for select
  using (worker_id = auth.uid() or auth.jwt() ->> 'email' = 'admin@gmail.com');
create policy "Workers insert own trips"
  on public.trips for insert
  with check (worker_id = auth.uid());
create policy "Workers update own trips"
  on public.trips for update
  using (worker_id = auth.uid() or auth.jwt() ->> 'email' = 'admin@gmail.com');


-- ── TRIP BMC VISITS ──────────────────────────────────────────
create table if not exists public.trip_bmc_visits (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  bmc_id uuid not null references public.bmcs(id),
  visit_sequence integer not null,   -- 1-based order
  compartment text check (compartment in ('front', 'back')),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  visit_start_time timestamptz,
  visit_end_time timestamptz,
  milk_quantity_liters numeric,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id, bmc_id)            -- one visit per BMC per trip
);
alter table public.trip_bmc_visits enable row level security;

create policy "Workers see own visit records"
  on public.trip_bmc_visits for select
  using (
    exists (select 1 from public.trips t where t.id = trip_id and t.worker_id = auth.uid())
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );
create policy "Workers insert visit records"
  on public.trip_bmc_visits for insert
  with check (
    exists (select 1 from public.trips t where t.id = trip_id and t.worker_id = auth.uid())
  );
create policy "Workers update visit records"
  on public.trip_bmc_visits for update
  using (
    exists (select 1 from public.trips t where t.id = trip_id and t.worker_id = auth.uid())
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );


-- ── FTIR TESTS ───────────────────────────────────────────────
create table if not exists public.ftir_tests (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.trip_bmc_visits(id) on delete cascade,
  fat numeric,
  snf numeric,            -- Solids Not Fat
  protein numeric,
  lactose numeric,
  water_percentage numeric,
  temperature numeric,
  overall_result text check (overall_result in ('pass', 'warning', 'fail')),
  remarks text,
  tested_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.ftir_tests enable row level security;
create policy "Workers access own ftir tests"
  on public.ftir_tests for all
  using (
    exists (
      select 1 from public.trip_bmc_visits v
      join public.trips t on t.id = v.trip_id
      where v.id = visit_id and t.worker_id = auth.uid()
    )
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );


-- ── GERBER TESTS ─────────────────────────────────────────────
create table if not exists public.gerber_tests (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.trip_bmc_visits(id) on delete cascade,
  fat_percentage numeric,
  clr numeric,             -- Corrected Lactometer Reading
  snf numeric,
  sample_temp numeric,
  overall_result text check (overall_result in ('pass', 'warning', 'fail')),
  remarks text,
  tested_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.gerber_tests enable row level security;
create policy "Workers access own gerber tests"
  on public.gerber_tests for all
  using (
    exists (
      select 1 from public.trip_bmc_visits v
      join public.trips t on t.id = v.trip_id
      where v.id = visit_id and t.worker_id = auth.uid()
    )
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );


-- ── REQUIREMENT CHECKS ───────────────────────────────────────
create table if not exists public.requirement_checks (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.trip_bmc_visits(id) on delete cascade,
  seal_cutter_available boolean,
  seal_cutter_working boolean,
  acid_available boolean,
  acid_condition text check (acid_condition in ('good', 'old', 'bad', null)),
  ftir_machine_available boolean,
  ftir_machine_working boolean,
  cooling_system_working boolean,
  power_backup_available boolean,
  weighing_scale_working boolean,
  remarks text,
  created_at timestamptz not null default now()
);
alter table public.requirement_checks enable row level security;
create policy "Workers access own requirement checks"
  on public.requirement_checks for all
  using (
    exists (
      select 1 from public.trip_bmc_visits v
      join public.trips t on t.id = v.trip_id
      where v.id = visit_id and t.worker_id = auth.uid()
    )
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );



-- ── BMC ISSUES ───────────────────────────────────────────────
create table if not exists public.bmc_issues (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.trip_bmc_visits(id) on delete cascade,
  category text not null
    check (category in ('driver','equipment','cleanliness','milk_quality','operational','staff','other')),

  description text not null,
  severity text not null default 'medium'
    check (severity in ('low','medium','high','critical')),
  image_url text,
  remarks text,
  created_at timestamptz not null default now()
);
alter table public.bmc_issues enable row level security;
create policy "Workers access own bmc issues"
  on public.bmc_issues for all
  using (
    exists (
      select 1 from public.trip_bmc_visits v
      join public.trips t on t.id = v.trip_id
      where v.id = visit_id and t.worker_id = auth.uid()
    )
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );


-- ── BMC RATINGS ──────────────────────────────────────────────
create table if not exists public.bmc_ratings (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.trip_bmc_visits(id) on delete cascade,

  behaviour integer check (behaviour between 1 and 5),
  cooperation integer check (cooperation between 1 and 5),
  cleanliness integer check (cleanliness between 1 and 5),
  infrastructure integer check (infrastructure between 1 and 5),
  overall_rating numeric generated always as (
    (coalesce(behaviour,0) + coalesce(cooperation,0) + coalesce(cleanliness,0) + coalesce(infrastructure,0))::numeric
    / nullif((case when behaviour is not null then 1 else 0 end + case when cooperation is not null then 1 else 0 end + case when cleanliness is not null then 1 else 0 end + case when infrastructure is not null then 1 else 0 end), 0)
  ) stored,
  remarks text,
  created_at timestamptz not null default now()
);
alter table public.bmc_ratings enable row level security;
create policy "Workers access own bmc ratings"
  on public.bmc_ratings for all
  using (
    exists (
      select 1 from public.trip_bmc_visits v
      join public.trips t on t.id = v.trip_id
      where v.id = visit_id and t.worker_id = auth.uid()
    )
    or auth.jwt() ->> 'email' = 'admin@gmail.com'
  );

-- ── TRIP NUMBER SEQUENCE ─────────────────────────────────────
-- Auto-generate trip numbers like TRIP-20260815-0001
create sequence if not exists public.trip_seq start 1;

create or replace function public.generate_trip_number()
returns trigger language plpgsql as $$
begin
  new.trip_number := 'TRIP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.trip_seq')::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists set_trip_number on public.trips;
create trigger set_trip_number
  before insert on public.trips
  for each row execute function public.generate_trip_number();
