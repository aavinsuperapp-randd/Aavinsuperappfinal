-- ============================================================
-- AAVIN P&I AGM Trip Assignment Workflow — Schema Migration
-- Run this in Supabase SQL Editor AFTER existing schema migrations
-- ============================================================

-- 1. Make worker_id nullable so Transport Manager trips can be created
--    before a Field Worker is assigned by the P&I AGM.
ALTER TABLE public.trips
  ALTER COLUMN worker_id DROP NOT NULL;

-- 2. Add Transport Manager workflow columns.
--    All are nullable / defaulted so existing rows are completely unaffected.
--    NOTE: There is NO assigned_worker_id column — worker_id IS the assigned
--    worker once the P&I AGM sets it. This keeps all existing API logic intact.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS created_by_to         boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transport_officer_id   uuid      REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS assignment_status      text      DEFAULT 'pending_assignment'
    CHECK (assignment_status IN (
      'pending_assignment',
      'worker_assigned',
      'in_progress',
      'testing_completed',
      'report_submitted',
      'completed'
    )),
  ADD COLUMN IF NOT EXISTS assigned_at            timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by_gm_id      uuid      REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS route_description      text,
  ADD COLUMN IF NOT EXISTS bmc_id                 uuid      REFERENCES public.bmcs(id);

-- 3. RLS: Transport Officers can INSERT trips (for TO-created trips).
--    Previously only workers could insert trips.
DROP POLICY IF EXISTS "Transport Officers can create trips" ON public.trips;
CREATE POLICY "Transport Officers can create trips"
  ON public.trips FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('transport_officer', 'admin')
        AND status = 'approved'
    )
  );

-- 4. RLS: GM / P&I AGM can UPDATE trips (to write worker_id during assignment).
--    The existing "Workers update own trips" policy only lets workers update their own.
DROP POLICY IF EXISTS "GM can assign workers to trips" ON public.trips;
CREATE POLICY "GM can assign workers to trips"
  ON public.trips FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('gm', 'admin')
        AND status = 'approved'
    )
  );

-- 5. RLS: Workers can SELECT trips where worker_id = their own id.
--    The existing "Workers see own trips" policy already handles this correctly:
--      worker_id = auth.uid()
--    After P&I AGM sets worker_id, the assigned worker can see the trip. No change needed.

-- 6. RLS: GM/P&I AGM can SELECT all trips (for pending trips view).
DROP POLICY IF EXISTS "GM can view all trips" ON public.trips;
CREATE POLICY "GM can view all trips"
  ON public.trips FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('gm', 'admin')
        AND status = 'approved'
    )
    OR worker_id = auth.uid()
    OR auth.jwt() ->> 'email' = 'admin@gmail.com'
  );

-- 7. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- SUMMARY OF CHANGES:
-- - trips.worker_id is now nullable (was NOT NULL)
-- - trips.created_by_to: true = created by Transport Manager
-- - trips.transport_officer_id: who created it
-- - trips.assignment_status: workflow state
-- - trips.assigned_at: when P&I AGM made the assignment
-- - trips.assigned_by_gm_id: which P&I AGM made the assignment
-- - trips.route_description: free text route info from TO
-- - trips.bmc_id: primary BMC for this trip (optional)
-- - New RLS policies for TO inserts and GM updates
-- ============================================================
