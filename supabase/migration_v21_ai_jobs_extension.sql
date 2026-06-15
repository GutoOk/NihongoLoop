-- Migration v21: AI Jobs Extensions (attempts, ai_meta, errors)
-- Run this on Supabase SQL Editor to support the new job structure with robust monitoring.

ALTER TABLE public.ai_jobs
  ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS errors TEXT;

-- Let's also sync columns so any inserts populate them
CREATE OR REPLACE FUNCTION public.sync_ai_jobs_attempts_errors()
RETURNS TRIGGER AS $$
BEGIN
  -- Sync retry_count and attempts
  IF NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN
    NEW.attempts := NEW.retry_count;
  ELSIF NEW.attempts IS DISTINCT FROM OLD.attempts THEN
    NEW.retry_count := NEW.attempts;
  END IF;

  -- Sync error and errors
  IF NEW.error IS DISTINCT FROM OLD.error THEN
    NEW.errors := NEW.error;
  ELSIF NEW.errors IS DISTINCT FROM OLD.errors THEN
    NEW.error := NEW.errors;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ai_jobs_attempts_errors ON public.ai_jobs;
CREATE TRIGGER trg_sync_ai_jobs_attempts_errors
  BEFORE INSERT OR UPDATE ON public.ai_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_ai_jobs_attempts_errors();
