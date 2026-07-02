BEGIN;

DROP INDEX IF EXISTS public.uk_ai_jobs_active_input;

CREATE OR REPLACE FUNCTION public.save_source_study_offset(
  p_source_id UUID,
  p_offset INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  request_user TEXT;
  normalized_offset INTEGER := GREATEST(0, COALESCE(p_offset, 0));
  updated_count INTEGER := 0;
BEGIN
  request_user := public.request_user_id(NULL);

  IF NOT EXISTS (SELECT 1 FROM sources WHERE id = p_source_id AND user_id = request_user) THEN
    RAISE EXCEPTION 'Fonte nao encontrada para usuario.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('source_offset:' || request_user || ':' || p_source_id::TEXT));

  UPDATE study_sessions
  SET config = jsonb_build_object('offset', normalized_offset),
      updated_at = NOW()
  WHERE user_id = request_user
    AND source_id = p_source_id
    AND type = 'source_offset';

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count = 0 THEN
    INSERT INTO study_sessions(user_id, type, source_id, config)
    VALUES (request_user, 'source_offset', p_source_id, jsonb_build_object('offset', normalized_offset));
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_run_with_review_if_blocked(p_run_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  has_active BOOLEAN := FALSE;
  has_problem BOOLEAN := FALSE;
BEGIN
  IF p_run_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM ai_jobs
    WHERE run_id = p_run_id
      AND status IN ('pending','claimed','running','retry_wait')
  ) INTO has_active;

  IF has_active THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM ai_jobs
    WHERE run_id = p_run_id
      AND status IN ('failed','needs_review')
  ) INTO has_problem;

  IF NOT has_problem THEN
    RETURN FALSE;
  END IF;

  UPDATE processing_run_stages s
  SET status = 'needs_review',
      completed_at = NULL,
      blocked_reason = COALESCE(blocked_reason, 'Ha jobs com falha ou revisao pendente.'),
      updated_at = NOW()
  WHERE s.run_id = p_run_id
    AND EXISTS (
      SELECT 1 FROM ai_jobs j
      WHERE j.stage_id = s.id
        AND j.status IN ('failed','needs_review')
    );

  UPDATE processing_runs
  SET status = 'needs_review',
      current_step = 'Processamento pausado: ha jobs com falha ou revisao pendente.',
      finished_at = NOW(),
      updated_at = NOW()
  WHERE id = p_run_id
    AND cancel_requested = FALSE
    AND status IN ('pending','planning','running','paused','needs_review');

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ai_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_result JSONB,
  p_raw_result JSONB,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_cost_actual NUMERIC DEFAULT NULL,
  p_latency_ai_ms INTEGER DEFAULT NULL,
  p_latency_persist_ms INTEGER DEFAULT NULL
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
  current_user_id TEXT;
  current_source_id UUID;
BEGIN
  SELECT j.attempts, j.stage_id, j.run_id, j.user_id, pr.source_id
  INTO current_attempt, current_stage_id, current_run_id, current_user_id, current_source_id
  FROM ai_jobs j
  LEFT JOIN processing_runs pr ON pr.id = j.run_id
  WHERE j.id = p_job_id
    AND j.worker_id = p_worker_id
    AND j.status = 'running'
  FOR UPDATE OF j;

  IF current_attempt IS NULL THEN
    RAISE EXCEPTION 'Job % is not running for worker %', p_job_id, p_worker_id;
  END IF;

  UPDATE ai_jobs
  SET
    status = 'completed',
    result = p_result,
    raw_result = p_raw_result,
    input_tokens = COALESCE(p_input_tokens, input_tokens),
    output_tokens = COALESCE(p_output_tokens, output_tokens),
    cost_actual = COALESCE(p_cost_actual, cost_actual),
    latency_ai_ms = COALESCE(p_latency_ai_ms, latency_ai_ms),
    latency_persist_ms = COALESCE(p_latency_persist_ms, latency_persist_ms),
    completed_at = NOW(),
    locked_by = NULL,
    locked_until = NULL,
    lease_expires_at = NULL,
    worker_id = NULL
  WHERE id = p_job_id;

  UPDATE ai_job_attempts
  SET
    status = 'completed',
    completed_at = NOW(),
    duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER,
    input_tokens = COALESCE(p_input_tokens, input_tokens),
    output_tokens = COALESCE(p_output_tokens, output_tokens),
    cost_actual = COALESCE(p_cost_actual, cost_actual)
  WHERE job_id = p_job_id AND attempt_number = current_attempt;

  IF current_stage_id IS NOT NULL THEN
    UPDATE processing_run_stages
    SET
      completed_jobs = completed_jobs + 1,
      status = CASE
        WHEN EXISTS (
          SELECT 1 FROM ai_jobs
          WHERE stage_id = current_stage_id
            AND status IN ('failed','needs_review')
        ) THEN 'needs_review'
        WHEN NOT EXISTS (
          SELECT 1 FROM ai_jobs
          WHERE stage_id = current_stage_id
            AND status IN ('pending','claimed','running','retry_wait')
        ) THEN 'completed'
        ELSE status
      END,
      completed_at = CASE
        WHEN EXISTS (
          SELECT 1 FROM ai_jobs
          WHERE stage_id = current_stage_id
            AND status IN ('failed','needs_review')
        ) THEN NULL
        WHEN NOT EXISTS (
          SELECT 1 FROM ai_jobs
          WHERE stage_id = current_stage_id
            AND status IN ('pending','claimed','running','retry_wait')
        ) THEN NOW()
        ELSE completed_at
      END
    WHERE id = current_stage_id;
  END IF;

  PERFORM refresh_processing_run_snapshot(current_run_id);
  IF public.finish_run_with_review_if_blocked(current_run_id) THEN
    RETURN;
  END IF;

  IF current_run_id IS NOT NULL
    AND current_source_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ai_jobs
      WHERE run_id = current_run_id
        AND status IN ('pending','claimed','running','retry_wait')
    )
    AND EXISTS (
      SELECT 1 FROM processing_runs
      WHERE id = current_run_id
        AND status IN ('running','planning','pending')
        AND cancel_requested = FALSE
    )
  THEN
    PERFORM public.create_or_resume_source_processing_run(current_source_id, current_user_id, COALESCE((SELECT run_mode FROM processing_runs WHERE id = current_run_id), 'all'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_ai_job_for_retry(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error TEXT,
  p_error_code TEXT DEFAULT NULL,
  p_error_kind TEXT DEFAULT NULL,
  p_retry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_attempt INTEGER;
  max_attempt_count INTEGER;
  next_retry TIMESTAMPTZ;
  terminal_status TEXT;
  current_stage_id UUID;
  current_run_id UUID;
BEGIN
  SELECT attempts, max_attempts, stage_id, run_id INTO current_attempt, max_attempt_count, current_stage_id, current_run_id
  FROM ai_jobs
  WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'running'
  FOR UPDATE;

  IF current_attempt IS NULL THEN
    RETURN;
  END IF;

  IF p_error_kind = 'permanent' THEN
    terminal_status := 'failed';
    next_retry := NULL;
  ELSIF p_error_kind = 'invalid_response' AND current_attempt >= max_attempt_count THEN
    terminal_status := 'needs_review';
    next_retry := NULL;
  ELSIF current_attempt >= max_attempt_count THEN
    terminal_status := 'failed';
    next_retry := NULL;
  ELSE
    terminal_status := 'retry_wait';
    next_retry := COALESCE(
      p_retry_at,
      NOW() + make_interval(secs => LEAST(900, (POWER(2, current_attempt)::INTEGER * 30) + FLOOR(random() * 20)::INTEGER))
    );
  END IF;

  UPDATE ai_jobs
  SET
    status = terminal_status,
    error = p_error,
    error_code = p_error_code,
    error_kind = p_error_kind,
    retry_at = next_retry,
    locked_by = NULL,
    locked_until = NULL,
    lease_expires_at = NULL,
    worker_id = NULL
  WHERE id = p_job_id;

  UPDATE ai_job_attempts
  SET
    status = terminal_status,
    completed_at = NOW(),
    duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER,
    error = p_error,
    error_code = p_error_code,
    error_kind = p_error_kind
  WHERE job_id = p_job_id AND attempt_number = current_attempt;

  IF current_stage_id IS NOT NULL THEN
    UPDATE processing_run_stages
    SET
      failed_jobs = failed_jobs + CASE WHEN terminal_status IN ('failed','needs_review') THEN 1 ELSE 0 END,
      retry_jobs = retry_jobs + CASE WHEN terminal_status = 'retry_wait' THEN 1 ELSE 0 END,
      status = CASE
        WHEN terminal_status IN ('failed','needs_review') THEN 'needs_review'
        ELSE status
      END,
      blocked_reason = CASE
        WHEN terminal_status IN ('failed','needs_review') THEN p_error
        ELSE blocked_reason
      END
    WHERE id = current_stage_id;
  END IF;

  PERFORM refresh_processing_run_snapshot(current_run_id);
  PERFORM public.finish_run_with_review_if_blocked(current_run_id);
END;
$$;

REVOKE ALL ON FUNCTION public.save_source_study_offset(UUID, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.finish_run_with_review_if_blocked(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.save_source_study_offset(UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_run_with_review_if_blocked(UUID) TO service_role;

COMMIT;
