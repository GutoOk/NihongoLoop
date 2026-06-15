-- Migration v18: AI Resilience Improvements
-- Runs ALTER statements and index creations.

ALTER TABLE ai_jobs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_target_status_updated
  ON ai_jobs(user_id, target_id, status, updated_at);

