-- ============================================================
-- AAVIN GM Portal — BMC Capacity & Silos Schema Migration
-- Run this in Supabase SQL Editor to add capacity and silos support
-- ============================================================

-- 1. Add total_capacity column to bmcs table
ALTER TABLE public.bmcs
  ADD COLUMN IF NOT EXISTS total_capacity numeric DEFAULT 0;

-- 2. Create bmac_silos table
CREATE TABLE IF NOT EXISTS public.bmc_silos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bmc_id uuid REFERENCES public.bmcs(id) ON DELETE CASCADE NOT NULL,
  silo_number integer NOT NULL,
  silo_name text NOT NULL,
  capacity_kg numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.bmc_silos ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for bmc_silos
DROP POLICY IF EXISTS "Authenticated users can view bmc_silos" ON public.bmc_silos;
CREATE POLICY "Authenticated users can view bmc_silos"
  ON public.bmc_silos FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "GM and Admin can manage bmc_silos" ON public.bmc_silos;
CREATE POLICY "GM and Admin can manage bmc_silos"
  ON public.bmc_silos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('gm', 'admin')
    )
    OR auth.jwt() ->> 'email' = 'admin@gmail.com'
  );
