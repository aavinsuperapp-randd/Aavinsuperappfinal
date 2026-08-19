-- ============================================================
-- AAVIN BMC Monitoring System - ROLE CONSTRAINT FIX
-- Run this in Supabase SQL Editor to fix the role validation
-- ============================================================

-- Step 1: Drop the old role constraint that only allowed 'user' and 'gm'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Step 2: Add new constraint that includes all roles
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check 
CHECK (role in ('user', 'gm', 'admin', 'transport_officer', 'driver'));

-- Verify the change
-- SELECT constraint_name FROM information_schema.constraint_column_usage 
-- WHERE table_name='profiles' AND column_name='role';
