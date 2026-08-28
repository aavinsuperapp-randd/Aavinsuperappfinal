-- ============================================================
-- AAVIN Monitoring System — Migration for BMC Visit Milk Weight
-- Adds milk_quantity_kg and in_weight columns to trip_bmc_visits table
-- ============================================================

ALTER TABLE public.trip_bmc_visits
  ADD COLUMN IF NOT EXISTS milk_quantity_kg numeric,
  ADD COLUMN IF NOT EXISTS in_weight numeric;

-- Comment on columns for clarity
COMMENT ON COLUMN public.trip_bmc_visits.milk_quantity_kg IS 'Milk weight in KG recorded during BMC visit';
COMMENT ON COLUMN public.trip_bmc_visits.in_weight IS 'Milk intake weight in KG recorded during BMC visit';

-- Notify Schema Cache Reload (Supabase)
NOTIFY pgrst, 'reload schema';
