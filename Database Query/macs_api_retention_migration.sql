-- =====================================================================
-- Migration: MACS API BMC Data 4-Record Rolling Retention Policy
-- Run this in Supabase SQL Editor
-- =====================================================================

-- 1. Create composite index on macs_bmc_code and fetched_at DESC for ultra-fast retention lookups and windowing
CREATE INDEX IF NOT EXISTS idx_macs_api_bmc_code_fetched_at 
ON public.macs_api_bmc_data (macs_bmc_code, fetched_at DESC);

-- 2. Optional direct SQL query for manual or scheduled database-level cleanup (preserves top 4 per BMC):
-- WITH ranked AS (
--     SELECT
--         id,
--         ROW_NUMBER() OVER (
--             PARTITION BY macs_bmc_code
--             ORDER BY fetched_at DESC, id DESC
--         ) AS rn
--     FROM public.macs_api_bmc_data
-- )
-- DELETE FROM public.macs_api_bmc_data
-- WHERE id IN (
--     SELECT id
--     FROM ranked
--     WHERE rn > 4
-- );
