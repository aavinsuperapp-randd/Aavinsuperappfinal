-- ============================================================
-- AAVIN BMC Monitoring System - ROLE CONSTRAINT & EO SCHEMAS
-- Run this in Supabase SQL Editor to update roles and create EO assignments table
-- ============================================================

-- Step 1: Drop the old role constraint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Step 2: Add new constraint that includes executive_officer role
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check 
CHECK (role in ('user', 'gm', 'admin', 'transport_officer', 'driver', 'executive_officer'));

-- Step 3: Create Executive Officer BMC Assignments Table
CREATE TABLE IF NOT EXISTS public.eo_bmc_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eo_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bmc_id UUID NOT NULL REFERENCES public.bmcs(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index to ensure an EO isn't assigned the same BMC multiple times while active
CREATE UNIQUE INDEX IF NOT EXISTS idx_eo_bmc_active_unique 
ON public.eo_bmc_assignments(eo_id, bmc_id) WHERE status = 'active';

-- Enable RLS on eo_bmc_assignments
ALTER TABLE public.eo_bmc_assignments ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read assignments
CREATE POLICY "Allow authenticated read eo_bmc_assignments" 
ON public.eo_bmc_assignments FOR SELECT USING (auth.role() = 'authenticated');
