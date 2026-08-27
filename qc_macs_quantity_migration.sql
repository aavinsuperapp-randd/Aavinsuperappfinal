-- Migration: Safely add quantity_liters and quantity_kg columns to qc_excel_import_rows
-- Preserves all existing data.

ALTER TABLE public.qc_excel_import_rows 
ADD COLUMN IF NOT EXISTS quantity_liters NUMERIC,
ADD COLUMN IF NOT EXISTS quantity_kg NUMERIC;

-- Backfill quantity_liters and quantity_kg from raw_data if available
UPDATE public.qc_excel_import_rows
SET 
  quantity_liters = COALESCE(quantity_liters, (raw_data->>'macs_quantity_liters')::numeric, (raw_data->>'liters')::numeric, (raw_data->>'quantity')::numeric),
  quantity_kg = COALESCE(quantity_kg, (raw_data->>'macs_quantity_kg')::numeric, (raw_data->>'kg')::numeric)
WHERE quantity_liters IS NULL OR quantity_kg IS NULL;
