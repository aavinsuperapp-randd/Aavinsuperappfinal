-- Migration to add bmc_code to bmcs table
ALTER TABLE public.bmcs ADD COLUMN IF NOT EXISTS bmc_code text;
