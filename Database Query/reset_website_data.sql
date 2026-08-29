-- ====================================================================
-- AAVIN BMC MONITORING SYSTEM - WEBSITE OPERATIONAL DATA RESET SQL
-- Run this block in your Supabase SQL Editor to clear operational data
-- ====================================================================
-- PRESERVED TABLES (UNTOUCHED):
--   ✓ bmcs (BMC Management List)
--   ✓ bmc_silos (Silo Configurations)
--   ✓ bmc_routes (Route Registry)
--   ✓ tankers (Tanker Vehicles Fleet)
--   ✓ drivers (Drivers List)
--   ✓ profiles (User Profiles & Approval Statuses)
--   ✓ eo_bmc_assignments (Executive Officer BMC mapping)
--   ✓ qc_variance_thresholds (QC Threshold Rules)
-- ====================================================================

DO $$ 
DECLARE 
  tbl TEXT;
  tables_to_truncate TEXT[] := ARRAY[
    'qc_test_reviews', 
    'qc_lab_tests', 
    'ftir_tests', 
    'gerber_tests', 
    'requirement_checks', 
    'bmc_issues', 
    'bmc_ratings', 
    'bmc_requirements', 
    'qc_audit_logs', 
    'qc_excel_import_rows', 
    'qc_excel_imports', 
    'macs_readings', 
    'macs_import_batches', 
    'bmc_daily_records', 
    'trip_bmc_visits', 
    'driver_trips', 
    'trips'
  ];
BEGIN 
  FOREACH tbl IN ARRAY tables_to_truncate LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('TRUNCATE TABLE public.%I CASCADE;', tbl);
    END IF;
  END LOOP;
END $$;
