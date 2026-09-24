-- ═══════════════════════════════════════════════════════════════════════════════
-- WhatsApp Send Logs Table for AAVIN AskEVA Integration
-- Run this in your Supabase SQL Editor BEFORE starting the server.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS whatsapp_send_logs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  society_code    TEXT,
  society_name    TEXT,
  bmc_code        INTEGER,
  session         TEXT,                -- 'morning' or 'evening'
  collection_date TEXT,                -- DD-MM-YYYY format
  recipient_number TEXT,               -- Normalized phone number with country code
  status          TEXT DEFAULT 'FAILED', -- 'SUCCESS' or 'FAILED'
  askeva_response JSONB,               -- Raw AskEVA API response body
  error_message   TEXT,                -- Error details if failed
  batch_number    INTEGER,             -- Batch number 1-9
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Index for fast daily queries (the monitoring dashboard filters by collection_date)
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_date ON whatsapp_send_logs (collection_date);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_status ON whatsapp_send_logs (status);

-- Composite index for the most common dashboard query pattern
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_date_status ON whatsapp_send_logs (collection_date, status);

-- Allow service role full access (RLS disabled for server-side only table)
ALTER TABLE whatsapp_send_logs ENABLE ROW LEVEL SECURITY;

-- Policy: allow service role to do everything (backend uses service_role key)
CREATE POLICY "Service role full access" ON whatsapp_send_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);
