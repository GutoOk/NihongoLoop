BEGIN;

CREATE OR REPLACE FUNCTION public.mark_ai_job_needs_review(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error TEXT,
  p_result JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_attempt INTEGER;
  current_stage_id UUID;
  current_run_id UUID;
BEGIN
  SELECT attempts, stage_id, run_id INTO current_attempt, current_stage_id, current_run_id
  FROM ai_jobs
  WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'running'
  FOR UPDATE;

  IF current_attempt IS NULL THEN
    RETURN;
  END IF;

  UPDATE ai_jobs
  SET status = 'needs_review',
      error = p_error,
      error_code = 'INVALID_LEXICAL_OFFSETS',
      error_kind = 'invalid_response',
      result = p_result,
      retry_at = NULL,
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_job_id;

  UPDATE ai_job_attempts
  SET status = 'needs_review',
      completed_at = NOW(),
      duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER,
      error = p_error,
      error_code = 'INVALID_LEXICAL_OFFSETS',
      error_kind = 'invalid_response'
  WHERE job_id = p_job_id
    AND attempt_number = current_attempt
    AND completed_at IS NULL;

  IF current_stage_id IS NOT NULL THEN
    UPDATE processing_run_stages
    SET needs_review_jobs = needs_review_jobs + 1,
        status = 'needs_review',
        blocked_reason = p_error
    WHERE id = current_stage_id;
  END IF;

  PERFORM refresh_processing_run_snapshot(current_run_id);
END;
$$;

INSERT INTO schema_versions(key, version)
VALUES ('ai_queue', '2026-06-ai-queue-v30')
ON CONFLICT (key) DO UPDATE
SET version = EXCLUDED.version,
    applied_at = NOW();

COMMIT;
