-- ============================================================
-- SQL Migration: Add driver_name & tanker_number and UNIQUE constraints
-- Copy and run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/habrgyhdftazejkumhjn/sql
-- ============================================================

-- 1. Add free text columns for Driver Name & Tanker Number
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS driver_name text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS tanker_number text;
ALTER TABLE public.trips ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE public.trips ALTER COLUMN tanker_id DROP NOT NULL;

-- 2. Add UNIQUE constraints to visit_id for tests, requirements & ratings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ftir_tests_visit_id_key') THEN
    ALTER TABLE public.ftir_tests ADD CONSTRAINT ftir_tests_visit_id_key UNIQUE (visit_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gerber_tests_visit_id_key') THEN
    ALTER TABLE public.gerber_tests ADD CONSTRAINT gerber_tests_visit_id_key UNIQUE (visit_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requirement_checks_visit_id_key') THEN
    ALTER TABLE public.requirement_checks ADD CONSTRAINT requirement_checks_visit_id_key UNIQUE (visit_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bmc_ratings_visit_id_key') THEN
    ALTER TABLE public.bmc_ratings ADD CONSTRAINT bmc_ratings_visit_id_key UNIQUE (visit_id);
  END IF;
END $$;

-- 3. Notify Schema Cache Refresh
NOTIFY pgrst, 'reload schema';
