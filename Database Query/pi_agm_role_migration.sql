-- ============================================================
-- AAVIN P&I AGM Role Migration
-- Run in Supabase SQL Editor AFTER all existing migrations
-- ============================================================

-- ── 1. Update profiles.role constraint to include pi_agm ──
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'gm', 'pi_agm', 'admin', 'transport_officer', 'driver', 'executive_officer', 'qc_worker', 'qc_agm'));

-- ── 2. Log count of existing GM users (Optional, for verification) ──
DO $$
DECLARE
  gm_count INT;
BEGIN
  SELECT count(*) INTO gm_count FROM public.profiles WHERE role = 'gm';
  RAISE NOTICE 'Found % users with role gm before migration.', gm_count;
END $$;

-- ── 3. Migrate existing P&I AGM (currently 'gm') to 'pi_agm' ──
UPDATE public.profiles
SET role = 'pi_agm'
WHERE role = 'gm';

-- ── 4. Log count of migrated users ──
DO $$
DECLARE
  pi_agm_count INT;
BEGIN
  SELECT count(*) INTO pi_agm_count FROM public.profiles WHERE role = 'pi_agm';
  RAISE NOTICE 'Found % users with role pi_agm after migration.', pi_agm_count;
END $$;

-- ── 5. Notify PostgREST to reload schema ──
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- SUMMARY:
-- - profiles.role updated to include pi_agm and keep gm
-- - existing gm users migrated to pi_agm
-- ============================================================
