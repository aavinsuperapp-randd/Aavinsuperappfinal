-- =====================================================================
-- Migration: MACS API BMC Data Collection
-- Creates tables for storing automatic MACS API fetch snapshots
-- Run this in Supabase SQL Editor
-- =====================================================================

-- Table 1: Sync Run History
-- One row per scheduled/manual sync execution
CREATE TABLE IF NOT EXISTS public.macs_api_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'success', 'failed')),
  requested_date text, -- DD/MM/YYYY format sent to API
  u_code integer DEFAULT 2,
  union_code integer DEFAULT 2,
  records_fetched integer DEFAULT 0,
  records_stored integer DEFAULT 0,
  records_skipped integer DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table 2: Individual BMC Data Snapshots
-- One row per BMC per fetch. Multiple snapshots per BMC are expected (every 15 min).
CREATE TABLE IF NOT EXISTS public.macs_api_bmc_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid REFERENCES public.macs_api_sync_runs(id) ON DELETE CASCADE,
  macs_bmc_code integer NOT NULL,
  macs_bmc_name text,
  u_code integer,
  report_date text, -- DD/MM/YYYY format
  so_c1 text,
  so_c2 text,
  lit numeric,
  li_t1 numeric,
  kgfat_t1 numeric,
  kgsnf_t1 numeric,
  fat_t1 numeric,
  snf_t1 numeric,
  li_t2 numeric,
  kgfat_t2 numeric,
  kgsnf_t2 numeric,
  fat_t2 numeric,
  snf_t2 numeric,
  diff numeric,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_macs_api_bmc_data_fetched_at ON public.macs_api_bmc_data(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_macs_api_bmc_data_sync_run ON public.macs_api_bmc_data(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_macs_api_bmc_data_bmc_code ON public.macs_api_bmc_data(macs_bmc_code);
CREATE INDEX IF NOT EXISTS idx_macs_api_bmc_code_fetched_at ON public.macs_api_bmc_data(macs_bmc_code, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_macs_api_sync_runs_status ON public.macs_api_sync_runs(status);
CREATE INDEX IF NOT EXISTS idx_macs_api_sync_runs_started ON public.macs_api_sync_runs(started_at DESC);

-- Enable Row Level Security
ALTER TABLE public.macs_api_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macs_api_bmc_data ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow authenticated users to read
CREATE POLICY "Allow authenticated read macs_api_sync_runs"
ON public.macs_api_sync_runs FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated read macs_api_bmc_data"
ON public.macs_api_bmc_data FOR SELECT
USING (auth.role() = 'authenticated');

-- Service role (used by backend) bypasses RLS, so no INSERT policies needed
