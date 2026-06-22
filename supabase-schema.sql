-- ================================================================
-- Queue Cure '26 — Supabase Database Schema
-- Run this entire file in Supabase SQL Editor
-- Dashboard → SQL Editor → New Query → Paste → Run
-- ================================================================

-- 1. Queue settings table (single row, always id=1)
CREATE TABLE IF NOT EXISTS queue_settings (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  current_token        INTEGER,
  current_patient_name TEXT    DEFAULT 'No patients yet',
  avg_consult_minutes  INTEGER DEFAULT 10,
  next_token           INTEGER DEFAULT 1,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the single settings row
INSERT INTO queue_settings (id, current_token, current_patient_name, avg_consult_minutes, next_token)
VALUES (1, NULL, 'No patients yet', 10, 1)
ON CONFLICT (id) DO NOTHING;

-- 2. Patients table
CREATE TABLE IF NOT EXISTS patients (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_number INTEGER     NOT NULL,
  name         TEXT        NOT NULL,
  phone        TEXT,
  status       TEXT        NOT NULL DEFAULT 'waiting'
                           CHECK (status IN ('waiting', 'in_progress', 'done')),
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  called_at    TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Index for fast status queries
CREATE INDEX IF NOT EXISTS idx_patients_status       ON patients(status);
CREATE INDEX IF NOT EXISTS idx_patients_token_number ON patients(token_number);

-- 3. Enable Realtime for both tables
-- (Supabase needs Realtime enabled per-table)
ALTER PUBLICATION supabase_realtime ADD TABLE patients;
ALTER PUBLICATION supabase_realtime ADD TABLE queue_settings;

-- 4. Row Level Security — allow API (service role) full access,
--    allow anon to SELECT only (frontend reads live data directly)
ALTER TABLE patients       ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_settings ENABLE ROW LEVEL SECURITY;

-- Anon can read (for Realtime + patient screen)
CREATE POLICY "anon can read patients"
  ON patients FOR SELECT USING (true);

CREATE POLICY "anon can read settings"
  ON queue_settings FOR SELECT USING (true);

-- Service role (backend) can do everything — no policy needed,
-- service role bypasses RLS automatically.

-- ================================================================
-- Done! Your tables are ready.
-- ================================================================
