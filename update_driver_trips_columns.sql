-- Add worker_id and in_time columns to driver_trips table
ALTER TABLE public.driver_trips ADD COLUMN IF NOT EXISTS worker_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.driver_trips ADD COLUMN IF NOT EXISTS in_time timestamptz;

NOTIFY pgrst, 'reload schema';
