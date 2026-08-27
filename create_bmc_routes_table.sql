-- Migration to create bmc_routes table and link it to bmcs table

CREATE TABLE IF NOT EXISTS public.bmc_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add route_id column to bmcs table if it does not exist
ALTER TABLE public.bmcs ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES public.bmc_routes(id) ON DELETE SET NULL;

-- Enable Row Level Security (RLS)
ALTER TABLE public.bmc_routes ENABLE ROW LEVEL SECURITY;

-- Set up RLS Policies
DROP POLICY IF EXISTS "Allow read access to all users" ON public.bmc_routes;
CREATE POLICY "Allow read access to all users" ON public.bmc_routes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert access to authenticated users" ON public.bmc_routes;
CREATE POLICY "Allow insert access to authenticated users" ON public.bmc_routes FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update access to authenticated users" ON public.bmc_routes;
CREATE POLICY "Allow update access to authenticated users" ON public.bmc_routes FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow delete access to authenticated users" ON public.bmc_routes;
CREATE POLICY "Allow delete access to authenticated users" ON public.bmc_routes FOR DELETE USING (true);

-- Grant permissions for roles
GRANT ALL ON public.bmc_routes TO anon;
GRANT ALL ON public.bmc_routes TO authenticated;
GRANT ALL ON public.bmc_routes TO service_role;
