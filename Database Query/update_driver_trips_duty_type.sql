-- ============================================================
-- AAVIN Transport Duty Management — Supabase Migration
-- Run this SQL in the Supabase SQL Editor for your project
-- ============================================================

-- 1. Add duty_type column to driver_trips
ALTER TABLE public.driver_trips 
ADD COLUMN IF NOT EXISTS duty_type text DEFAULT 'Morning Duty';

-- 2. Add selected_bmcs column to driver_trips to store structured BMC assignments
ALTER TABLE public.driver_trips 
ADD COLUMN IF NOT EXISTS selected_bmcs jsonb DEFAULT '[]'::jsonb;
