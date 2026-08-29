-- ============================================================
-- AAVIN QC Module — Database Migration
-- Run in Supabase SQL Editor AFTER all existing migrations
-- ============================================================

-- ── 1. Update profiles.role constraint to include qc roles ──
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'gm', 'admin', 'transport_officer', 'driver', 'executive_officer', 'qc_worker', 'qc_agm'));

-- ── 2. QC Variance Thresholds (global config) ───────────────
CREATE TABLE IF NOT EXISTS public.qc_variance_thresholds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter   text NOT NULL UNIQUE,   -- 'fat', 'snf', 'clr', etc.
  threshold   numeric NOT NULL DEFAULT 0.5,
  updated_by  uuid REFERENCES public.profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_variance_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view thresholds"
  ON public.qc_variance_thresholds FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "QC AGM can manage thresholds"
  ON public.qc_variance_thresholds FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  );

-- Seed default thresholds
INSERT INTO public.qc_variance_thresholds (parameter, threshold) VALUES
  ('fat', 0.3),
  ('snf', 0.3),
  ('clr', 1.0),
  ('temperature', 2.0),
  ('protein', 0.2),
  ('lactose', 0.3)
ON CONFLICT (parameter) DO NOTHING;

-- ── 3. QC Lab Tests ─────────────────────────────────────────
-- One QC lab test per trip_bmc_visit.
-- The QC worker enters lab results for the same sample the field worker tested.
CREATE TABLE IF NOT EXISTS public.qc_lab_tests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id            uuid NOT NULL REFERENCES public.trip_bmc_visits(id) ON DELETE CASCADE,
  qc_worker_id        uuid NOT NULL REFERENCES public.profiles(id),

  -- Sample receipt info
  sample_received_at  timestamptz,
  sample_condition    text CHECK (sample_condition IN ('good', 'degraded', 'rejected', 'other')),

  -- Lab test parameters (mirrors ftir_tests + gerber_tests)
  fat                 numeric,
  snf                 numeric,
  clr                 numeric,   -- Corrected Lactometer Reading
  temperature         numeric,
  acidity             numeric,
  protein             numeric,
  lactose             numeric,
  density             numeric,
  water_percentage    numeric,

  -- Test metadata
  test_start_time     timestamptz,
  test_end_time       timestamptz,
  equipment_used      text,
  instrument_id       text,
  overall_result      text CHECK (overall_result IN ('pass', 'warning', 'fail')),
  remarks             text,
  additional_observations text,

  -- Status flow: pending → in_progress → submitted → approved | returned → resubmitted
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'submitted', 'approved', 'returned', 'resubmitted')),

  submitted_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_lab_tests ENABLE ROW LEVEL SECURITY;

-- QC Workers can manage their own tests
CREATE POLICY "QC Workers manage own tests"
  ON public.qc_lab_tests FOR ALL
  USING (
    qc_worker_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  )
  WITH CHECK (
    qc_worker_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  );

-- QC Workers can view visit data (read-only on trip_bmc_visits, ftir_tests, gerber_tests)
-- These are handled via existing RLS by adding policies for qc_worker role:

DROP POLICY IF EXISTS "QC can view visit records" ON public.trip_bmc_visits;
CREATE POLICY "QC can view visit records"
  ON public.trip_bmc_visits FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.worker_id = auth.uid())
    OR auth.jwt() ->> 'email' = 'admin@gmail.com'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('gm', 'qc_worker', 'qc_agm', 'admin') AND status = 'approved')
  );

DROP POLICY IF EXISTS "QC can view ftir tests" ON public.ftir_tests;
CREATE POLICY "QC can view ftir tests"
  ON public.ftir_tests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_bmc_visits v
      JOIN public.trips t ON t.id = v.trip_id
      WHERE v.id = visit_id
        AND (t.worker_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('gm', 'qc_worker', 'qc_agm', 'admin') AND status = 'approved'
        ))
    )
    OR auth.jwt() ->> 'email' = 'admin@gmail.com'
  );

DROP POLICY IF EXISTS "QC can view gerber tests" ON public.gerber_tests;
CREATE POLICY "QC can view gerber tests"
  ON public.gerber_tests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_bmc_visits v
      JOIN public.trips t ON t.id = v.trip_id
      WHERE v.id = visit_id
        AND (t.worker_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('gm', 'qc_worker', 'qc_agm', 'admin') AND status = 'approved'
        ))
    )
    OR auth.jwt() ->> 'email' = 'admin@gmail.com'
  );

DROP POLICY IF EXISTS "QC can view trips" ON public.trips;
CREATE POLICY "QC can view trips"
  ON public.trips FOR SELECT
  USING (
    worker_id = auth.uid()
    OR auth.jwt() ->> 'email' = 'admin@gmail.com'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('gm', 'qc_worker', 'qc_agm', 'admin') AND status = 'approved')
  );

-- ── 4. QC Test Reviews ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qc_test_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_test_id      uuid NOT NULL REFERENCES public.qc_lab_tests(id) ON DELETE CASCADE,
  reviewer_id     uuid NOT NULL REFERENCES public.profiles(id),
  action          text NOT NULL CHECK (action IN ('approved', 'returned')),
  remarks         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_test_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "QC AGM manages reviews"
  ON public.qc_test_reviews FOR ALL
  USING (
    reviewer_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  );

-- QC Workers can see reviews on their own tests
CREATE POLICY "QC Workers can view reviews of own tests"
  ON public.qc_test_reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.qc_lab_tests t
      WHERE t.id = qc_test_id AND t.qc_worker_id = auth.uid()
    )
  );

-- ── 5. QC Excel Imports ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qc_excel_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name       text NOT NULL,
  imported_by     uuid NOT NULL REFERENCES public.profiles(id),
  total_rows      integer NOT NULL DEFAULT 0,
  successful_rows integer NOT NULL DEFAULT 0,
  failed_rows     integer NOT NULL DEFAULT 0,
  duplicate_rows  integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('processing', 'completed', 'failed')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_excel_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "QC AGM manages imports"
  ON public.qc_excel_imports FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  );

-- ── 6. QC Excel Import Rows ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qc_excel_import_rows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id       uuid NOT NULL REFERENCES public.qc_excel_imports(id) ON DELETE CASCADE,
  bmc_id          uuid REFERENCES public.bmcs(id),
  bmc_name        text,    -- raw from Excel in case bmc_id not matched
  sample_ref      text,    -- sample/row identifier from Excel
  test_date       date,

  -- Test parameters from Excel
  fat             numeric,
  snf             numeric,
  clr             numeric,
  temperature     numeric,
  acidity         numeric,
  protein         numeric,
  lactose         numeric,
  density         numeric,

  overall_result  text,
  raw_data        jsonb,   -- store all original columns
  row_status      text NOT NULL DEFAULT 'imported'
    CHECK (row_status IN ('imported', 'duplicate', 'error')),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_excel_import_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "QC AGM manages import rows"
  ON public.qc_excel_import_rows FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  );

-- ── 7. QC Audit Logs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qc_audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     text NOT NULL,  -- 'qc_lab_test', 'qc_review', 'qc_import'
  entity_id       uuid NOT NULL,
  action          text NOT NULL,  -- 'created', 'updated', 'submitted', 'approved', 'returned', 'imported'
  actor_id        uuid REFERENCES public.profiles(id),
  old_values      jsonb,
  new_values      jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "QC AGM can view audit logs"
  ON public.qc_audit_logs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('qc_agm', 'admin') AND status = 'approved')
  );

CREATE POLICY "Backend can insert audit logs"
  ON public.qc_audit_logs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ── 8. Notify PostgREST to reload schema ────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- SUMMARY:
-- - profiles.role updated to include qc_worker, qc_agm
-- - qc_variance_thresholds: global fat/snf/clr thresholds
-- - qc_lab_tests: QC Worker lab results per trip_bmc_visit
-- - qc_test_reviews: QC AGM approve/return actions
-- - qc_excel_imports: Excel import batch headers
-- - qc_excel_import_rows: parsed Excel rows
-- - qc_audit_logs: full audit trail
-- - RLS updated for QC roles on existing test tables
-- ============================================================
