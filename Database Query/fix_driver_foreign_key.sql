-- ============================================================
-- Fix Driver Foreign Key Constraint Migration
-- Run this in Supabase SQL Editor to allow driver deletion
-- while preserving historical trip data.
-- ============================================================

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_driver_id_fkey;
ALTER TABLE public.trips ADD CONSTRAINT trips_driver_id_fkey 
  FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
