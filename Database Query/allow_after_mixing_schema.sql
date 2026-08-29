-- ============================================================
-- SQL Migration: Allow Multiple BMC Visits per Trip (After Mixing)
-- Copy and run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/habrgyhdftazejkumhjn/sql
-- ============================================================

-- 1. Drop the single-visit-per-BMC unique constraint on trip_bmc_visits
ALTER TABLE public.trip_bmc_visits DROP CONSTRAINT IF EXISTS trip_bmc_visits_trip_id_bmc_id_key;

-- 2. Add is_after_mixing column if not existing
ALTER TABLE public.trip_bmc_visits ADD COLUMN IF NOT EXISTS is_after_mixing boolean DEFAULT false;

-- 3. Refresh REST API schema cache
NOTIFY pgrst, 'reload schema';
