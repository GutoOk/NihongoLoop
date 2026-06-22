BEGIN;

CREATE OR REPLACE FUNCTION public.claim_ai_jobs(
  p_worker_id TEXT,
  p_job_types TEXT[],
  p_limit INTEGER,
  p_lease_seconds INTEGER,
  p_user_id TEXT DEFAULT NULL,
  p_run_id UUID DEFAULT NULL,
  p_user_limit INTEGER DEFAULT 4,
  p_type_limits JSONB DEFAULT '{}'::jsonb
)
RETURNS SETOF ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ai_jobs_claim_capacity'));

  RETURN QUERY
  WITH capacity AS (
    SELECT GREATEST(
      0,
      p_limit - (
        SELECT COUNT(*)::INTEGER
        FROM ai_jobs active_jobs
        WHERE active_jobs.status IN ('claimed','running')
      )
    ) AS global_capacity
  ),
  locked_candidates AS (
    SELECT j.*
    FROM ai_jobs j
    LEFT JOIN processing_runs pr ON pr.id = j.run_id
    WHERE
      j.status IN ('pending','retry_wait')
      AND j.type = ANY(p_job_types)
      AND (p_user_id IS NULL OR j.user_id = p_user_id)
      AND (p_run_id IS NULL OR j.run_id = p_run_id)
      AND (j.run_id IS NULL OR pr.status = 'running')
      AND COALESCE(pr.cancel_requested, FALSE) = FALSE
      AND (j.retry_at IS NULL OR j.retry_at <= NOW())
    ORDER BY j.priority DESC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
  ),
  candidates AS (
    SELECT
      j.id,
      j.user_id,
      j.type,
      j.priority,
      j.created_at,
      COALESCE((p_type_limits ->> j.type)::INTEGER, p_limit) AS type_limit,
      COALESCE((SELECT COUNT(*)::INTEGER FROM ai_jobs active_user WHERE active_user.user_id = j.user_id AND active_user.status IN ('claimed','running')), 0) AS active_user_count,
      COALESCE((SELECT COUNT(*)::INTEGER FROM ai_jobs active_type WHERE active_type.type = j.type AND active_type.status IN ('claimed','running')), 0) AS active_type_count,
      ROW_NUMBER() OVER (PARTITION BY j.user_id ORDER BY j.priority DESC, j.created_at ASC) AS user_rank,
      ROW_NUMBER() OVER (PARTITION BY j.type ORDER BY j.priority DESC, j.created_at ASC) AS type_rank
    FROM locked_candidates j
  ),
  eligible AS (
    SELECT *
    FROM candidates
    WHERE user_rank <= GREATEST(0, p_user_limit - active_user_count)
      AND type_rank <= GREATEST(0, type_limit - active_type_count)
  ),
  picked AS (
    SELECT id
    FROM eligible, capacity
    ORDER BY type_rank ASC, priority DESC, created_at ASC
    LIMIT (SELECT global_capacity FROM capacity)
  )
  UPDATE ai_jobs j
  SET
    status = 'claimed',
    claimed_at = NOW(),
    locked_by = p_worker_id,
    worker_id = p_worker_id,
    locked_until = NOW() + make_interval(secs => p_lease_seconds),
    lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
    last_heartbeat_at = NOW(),
    error = NULL,
    error_code = NULL,
    error_kind = NULL
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_source_run(
  p_source_id UUID,
  p_run_mode TEXT DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result JSONB;
  prepared_run_id UUID;
  request_user TEXT;
BEGIN
  request_user := public.request_user_id(NULL);
  result := public.create_or_resume_source_processing_run(p_source_id, request_user, p_run_mode);
  prepared_run_id := (result->>'run_id')::UUID;

  IF prepared_run_id IS NOT NULL THEN
    UPDATE processing_runs
    SET status = CASE WHEN status = 'completed' THEN status ELSE 'paused' END,
        cancel_requested = FALSE,
        current_step = CASE WHEN status = 'completed' THEN current_step ELSE 'Fonte preparada. Clique em Iniciar tarefas para executar.' END,
        updated_at = NOW()
    WHERE id = prepared_run_id
      AND user_id = request_user;

    UPDATE processing_run_stages
    SET status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
        updated_at = NOW()
    WHERE run_id = prepared_run_id
      AND user_id = request_user
      AND status = 'running';

    PERFORM refresh_processing_run_snapshot(prepared_run_id);
    result := result || jsonb_build_object('status', (SELECT status FROM processing_runs WHERE id = prepared_run_id));
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_processing_run(
  p_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  selected_run processing_runs;
  request_user TEXT;
BEGIN
  request_user := public.request_user_id(NULL);

  SELECT * INTO selected_run
  FROM processing_runs
  WHERE id = p_run_id AND user_id = request_user
  FOR UPDATE;

  IF selected_run.id IS NULL THEN
    RAISE EXCEPTION 'Run nao encontrada para usuario.';
  END IF;

  UPDATE processing_runs
  SET status = CASE WHEN status = 'completed' THEN status ELSE 'paused' END,
      cancel_requested = FALSE,
      current_step = CASE WHEN status = 'completed' THEN current_step ELSE 'Tarefas pausadas pelo usuario.' END,
      updated_at = NOW()
  WHERE id = selected_run.id;

  UPDATE processing_run_stages
  SET status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
      updated_at = NOW()
  WHERE run_id = selected_run.id
    AND user_id = request_user
    AND status = 'running';

  UPDATE ai_jobs
  SET status = 'pending',
      locked_by = NULL,
      worker_id = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      updated_at = NOW()
  WHERE run_id = selected_run.id
    AND user_id = request_user
    AND status = 'claimed';

  PERFORM refresh_processing_run_snapshot(selected_run.id);
  RETURN jsonb_build_object('run_id', selected_run.id, 'status', 'paused');
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_source_run(UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.pause_processing_run(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.prepare_source_run(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pause_processing_run(UUID) TO authenticated, service_role;

INSERT INTO schema_versions(key, version)
VALUES ('ai_queue', '2026-06-ai-queue-v32')
ON CONFLICT (key) DO UPDATE
SET version = EXCLUDED.version,
    applied_at = NOW();

COMMIT;
