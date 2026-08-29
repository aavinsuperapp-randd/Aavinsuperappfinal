-- ============================================================
-- AAVIN GM Portal — Schema Migration
-- Run this in Supabase SQL Editor to enable GM completion ticks
-- ============================================================

-- Add 'status' column to requirement_checks (for GM to mark complete)
ALTER TABLE public.requirement_checks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'completed'));

-- Add 'status' column to bmc_issues (for GM to mark resolved)
ALTER TABLE public.bmc_issues
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'completed'));

-- ── RLS: requirement_checks ───────────────────────────────────────────────────

-- GM can update requirement status
DROP POLICY IF EXISTS "GM can update requirement status" ON public.requirement_checks;
CREATE POLICY "GM can update requirement status"
  ON public.requirement_checks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('gm', 'admin')
        AND status = 'approved'
    )
  );

-- GM can view all requirement checks
DROP POLICY IF EXISTS "GM can view all requirement checks" ON public.requirement_checks;
CREATE POLICY "GM can view all requirement checks"
  ON public.requirement_checks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('gm', 'admin')
    )
    OR auth.jwt() ->> 'email' = 'admin@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.trip_bmc_visits v
      JOIN public.trips t ON t.id = v.trip_id
      WHERE v.id = visit_id AND t.worker_id = auth.uid()
    )
  );

-- ── RLS: bmc_issues ──────────────────────────────────────────────────────────

-- GM can update issue status
DROP POLICY IF EXISTS "GM can update issue status" ON public.bmc_issues;
CREATE POLICY "GM can update issue status"
  ON public.bmc_issues FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('gm', 'admin')
        AND status = 'approved'
    )
  );

-- GM can view all bmc issues
DROP POLICY IF EXISTS "GM can view all bmc issues" ON public.bmc_issues;
CREATE POLICY "GM can view all bmc issues"
  ON public.bmc_issues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('gm', 'admin')
    )
    OR auth.jwt() ->> 'email' = 'admin@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.trip_bmc_visits v
      JOIN public.trips t ON t.id = v.trip_id
      WHERE v.id = visit_id AND t.worker_id = auth.uid()
    )
  );
