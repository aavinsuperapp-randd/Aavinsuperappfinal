-- ============================================================
-- AAVIN SUPER APP — Society Data Module
-- Database Migration
-- ============================================================
-- Run this SQL in your Supabase SQL Editor to create the required tables.

-- 1. Society Data — Current-day society records (FAT, Liter, SNF)
CREATE TABLE IF NOT EXISTS society_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fetch_date DATE NOT NULL,
  session TEXT NOT NULL CHECK (session IN ('morning', 'evening')),
  bmc_code INTEGER NOT NULL,
  route TEXT NOT NULL,
  society_code TEXT,
  society_name TEXT,
  fat NUMERIC,
  liter NUMERIC,
  snf NUMERIC,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_society_data_date_session ON society_data(fetch_date, session);
CREATE INDEX IF NOT EXISTS idx_society_data_bmc ON society_data(bmc_code);
CREATE INDEX IF NOT EXISTS idx_society_data_route ON society_data(route);

-- 2. Society Fetch Jobs — Tracks fetch job execution and batch history
CREATE TABLE IF NOT EXISTS society_fetch_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_date DATE NOT NULL,
  session TEXT NOT NULL CHECK (session IN ('morning', 'evening')),
  status TEXT NOT NULL DEFAULT 'pending',
  total_batches INTEGER DEFAULT 9,
  current_batch INTEGER DEFAULT 0,
  batch_details JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_society_fetch_jobs_date ON society_fetch_jobs(job_date, session);
