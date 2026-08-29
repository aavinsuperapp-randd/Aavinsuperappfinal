-- Migration Script: MACS Readings & Import Batches

CREATE TABLE IF NOT EXISTS public.macs_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bmc_code text NOT NULL,
  bmc_name text,
  reading_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('worker', 'qc')),
  fat numeric,
  snf numeric,
  import_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT macs_readings_unique_key UNIQUE(bmc_code, reading_date, source)
);

CREATE TABLE IF NOT EXISTS public.macs_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  total_rows integer DEFAULT 0,
  worker_rows integer DEFAULT 0,
  qc_rows integer DEFAULT 0,
  matched_rows integer DEFAULT 0,
  updated_rows integer DEFAULT 0,
  duplicate_rows integer DEFAULT 0,
  error_rows integer DEFAULT 0,
  imported_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.macs_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.macs_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read macs_readings"
ON public.macs_readings FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated read macs_import_batches"
ON public.macs_import_batches FOR SELECT
USING (auth.role() = 'authenticated');
