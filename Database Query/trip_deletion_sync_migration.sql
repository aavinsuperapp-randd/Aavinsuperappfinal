-- ============================================================
-- AAVIN Trip Deletion Synchronization Migration
-- Run this in your Supabase SQL Editor if soft deletion check constraints
-- need to be updated to support the 'deleted' status explicitly.
-- ============================================================

-- 1. Update status check constraint on public.driver_trips
ALTER TABLE public.driver_trips DROP CONSTRAINT IF EXISTS driver_trips_status_check;
ALTER TABLE public.driver_trips ADD CONSTRAINT driver_trips_status_check
  CHECK (status IN ('assigned','accepted','ready','in_progress','returning','completed','cancelled','deleted'));

-- 2. Update status check constraint on public.trips
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_status_check;
ALTER TABLE public.trips ADD CONSTRAINT trips_status_check
  CHECK (status IN ('active', 'in_progress', 'completed', 'cancelled', 'deleted'));

-- 3. Update assignment_status check constraint on public.trips
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_assignment_status_check;
ALTER TABLE public.trips ADD CONSTRAINT trips_assignment_status_check
  CHECK (assignment_status IN (
    'pending_assignment',
    'worker_assigned',
    'in_progress',
    'testing_completed',
    'report_submitted',
    'completed',
    'deleted'
  ));

-- 4. Reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';
