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
    FOR UPDATE OF j SKIP LOCKED
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

REVOKE ALL ON FUNCTION public.claim_ai_jobs(TEXT, TEXT[], INTEGER, INTEGER, TEXT, UUID, INTEGER, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_ai_jobs(TEXT, TEXT[], INTEGER, INTEGER, TEXT, UUID, INTEGER, JSONB) TO service_role;

COMMIT;
