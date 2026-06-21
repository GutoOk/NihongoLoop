-- Migration v23: durable AI queue contract, atomic claim, leases, retry windows.
-- This migration is additive and keeps legacy status values working during the
-- transition away from browser-driven processing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.processing_runs
  ADD COLUMN IF NOT EXISTS planned_jobs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_jobs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS running_jobs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_jobs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_jobs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_jobs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_jobs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS obsolete_jobs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_estimate NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_actual NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_call_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.ai_jobs
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.processing_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS job_key TEXT,
  ADD COLUMN IF NOT EXISTS target_key TEXT,
  ADD COLUMN IF NOT EXISTS payload JSONB,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS model_version TEXT,
  ADD COLUMN IF NOT EXISTS target_hash TEXT,
  ADD COLUMN IF NOT EXISTS retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_kind TEXT,
  ADD COLUMN IF NOT EXISTS error_structured JSONB,
  ADD COLUMN IF NOT EXISTS raw_result JSONB,
  ADD COLUMN IF NOT EXISTS cost_actual NUMERIC,
  ADD COLUMN IF NOT EXISTS latency_queue_ms INTEGER,
  ADD COLUMN IF NOT EXISTS latency_ai_ms INTEGER,
  ADD COLUMN IF NOT EXISTS latency_persist_ms INTEGER,
  ADD COLUMN IF NOT EXISTS logs JSONB DEFAULT '[]'::jsonb;

UPDATE public.ai_jobs
SET payload = input
WHERE payload IS NULL AND input IS NOT NULL;

ALTER TABLE public.ai_jobs
  DROP CONSTRAINT IF EXISTS ck_ai_jobs_status_contract;

ALTER TABLE public.ai_jobs
  ADD CONSTRAINT ck_ai_jobs_status_contract
  CHECK (
    status IN (
      'pending',
      'claimed',
      'running',
      'completed',
      'failed',
      'retry_wait',
      'needs_review',
      'cancelled',
      'obsolete',
      'error',
      'rejected',
      'applied'
    )
  );

ALTER TABLE public.processing_runs
  DROP CONSTRAINT IF EXISTS ck_processing_runs_status_contract;

ALTER TABLE public.processing_runs
  ADD CONSTRAINT ck_processing_runs_status_contract
  CHECK (
    status IN (
      'pending',
      'planning',
      'running',
      'paused',
      'completed',
      'failed',
      'error',
      'cancelled',
      'needs_review'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_jobs_user_job_key_active
  ON public.ai_jobs(user_id, job_key)
  WHERE job_key IS NOT NULL AND status NOT IN ('cancelled', 'obsolete');

CREATE INDEX IF NOT EXISTS idx_ai_jobs_claim_v23
  ON public.ai_jobs(user_id, status, type, priority DESC, created_at)
  WHERE status IN ('pending', 'retry_wait');

CREATE INDEX IF NOT EXISTS idx_ai_jobs_retry_v23
  ON public.ai_jobs(status, retry_at)
  WHERE status = 'retry_wait';

CREATE INDEX IF NOT EXISTS idx_ai_jobs_lease_v23
  ON public.ai_jobs(status, lease_expires_at)
  WHERE status IN ('claimed', 'running');

CREATE INDEX IF NOT EXISTS idx_ai_jobs_run_status_v23
  ON public.ai_jobs(run_id, status, type, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_worker_v23
  ON public.ai_jobs(worker_id, status, lease_expires_at)
  WHERE worker_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_processing_runs_active_v23
  ON public.processing_runs(user_id, status, updated_at DESC)
  WHERE status IN ('pending', 'planning', 'running', 'paused', 'needs_review', 'error', 'failed');

CREATE OR REPLACE FUNCTION public.assert_ai_queue_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'not authorized to use ai queue functions';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_ai_queue_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.assert_ai_queue_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_ai_jobs(
  p_worker_id TEXT,
  p_job_types TEXT[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 10,
  p_lease_seconds INTEGER DEFAULT 300,
  p_user_id TEXT DEFAULT NULL,
  p_run_id UUID DEFAULT NULL
)
RETURNS SETOF public.ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_lease_seconds INTEGER := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 30), 3600);
BEGIN
  PERFORM public.assert_ai_queue_admin();

  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
    FROM public.ai_jobs j
    WHERE
      (
        j.status = 'pending'
        OR (j.status = 'retry_wait' AND COALESCE(j.retry_at, now()) <= now())
      )
      AND (p_user_id IS NULL OR j.user_id = p_user_id)
      AND (p_run_id IS NULL OR j.run_id = p_run_id)
      AND (
        p_job_types IS NULL
        OR array_length(p_job_types, 1) IS NULL
        OR j.type = ANY(p_job_types)
      )
    ORDER BY j.priority DESC NULLS LAST, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.ai_jobs j
  SET
    status = 'claimed',
    claimed_at = now(),
    lease_expires_at = now() + make_interval(secs => v_lease_seconds),
    locked_until = now() + make_interval(secs => v_lease_seconds),
    worker_id = p_worker_id,
    locked_by = p_worker_id,
    last_heartbeat_at = now(),
    error = NULL,
    error_code = NULL,
    error_kind = NULL,
    error_structured = NULL,
    updated_at = now()
  FROM candidate c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_claimed_ai_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS public.ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.ai_jobs;
  v_lease_seconds INTEGER := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 30), 3600);
BEGIN
  PERFORM public.assert_ai_queue_admin();

  UPDATE public.ai_jobs
  SET
    status = 'running',
    started_at = COALESCE(started_at, now()),
    attempts = COALESCE(attempts, 0) + 1,
    retry_count = COALESCE(retry_count, COALESCE(attempts, 0) + 1),
    lease_expires_at = now() + make_interval(secs => v_lease_seconds),
    locked_until = now() + make_interval(secs => v_lease_seconds),
    worker_id = p_worker_id,
    locked_by = p_worker_id,
    last_heartbeat_at = now(),
    updated_at = now()
  WHERE id = p_job_id
    AND worker_id = p_worker_id
    AND status = 'claimed'
  RETURNING * INTO v_job;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job % is not claimed by worker %', p_job_id, p_worker_id;
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_ai_job_lease(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lease_seconds INTEGER := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 30), 3600);
BEGIN
  PERFORM public.assert_ai_queue_admin();

  UPDATE public.ai_jobs
  SET
    lease_expires_at = now() + make_interval(secs => v_lease_seconds),
    locked_until = now() + make_interval(secs => v_lease_seconds),
    last_heartbeat_at = now(),
    updated_at = now()
  WHERE id = p_job_id
    AND worker_id = p_worker_id
    AND status IN ('claimed', 'running');

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_expired_ai_job_leases(
  p_limit INTEGER DEFAULT 1000,
  p_retry_delay_seconds INTEGER DEFAULT 60
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
  v_retry_delay_seconds INTEGER := LEAST(GREATEST(COALESCE(p_retry_delay_seconds, 60), 1), 86400);
BEGIN
  PERFORM public.assert_ai_queue_admin();

  WITH expired AS (
    SELECT id
    FROM public.ai_jobs
    WHERE status IN ('claimed', 'running')
      AND COALESCE(lease_expires_at, locked_until) < now()
    ORDER BY COALESCE(lease_expires_at, locked_until) ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.ai_jobs j
  SET
    status = CASE
      WHEN COALESCE(j.attempts, 0) >= COALESCE(j.max_attempts, 3)
        THEN 'failed'
      ELSE 'retry_wait'
    END,
    retry_at = CASE
      WHEN COALESCE(j.attempts, 0) >= COALESCE(j.max_attempts, 3)
        THEN NULL
      ELSE now() + make_interval(secs => v_retry_delay_seconds)
    END,
    error = COALESCE(j.error, 'Worker lease expired before completion.'),
    error_code = COALESCE(j.error_code, 'LEASE_EXPIRED'),
    error_kind = COALESCE(j.error_kind, 'transient'),
    error_structured = COALESCE(
      j.error_structured,
      jsonb_build_object('code', 'LEASE_EXPIRED', 'kind', 'transient')
    ),
    worker_id = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    locked_until = NULL,
    last_heartbeat_at = NULL,
    updated_at = now()
  FROM expired e
  WHERE j.id = e.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_ai_job_for_retry(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error TEXT,
  p_error_code TEXT DEFAULT NULL,
  p_error_kind TEXT DEFAULT 'transient',
  p_retry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.ai_jobs;
BEGIN
  PERFORM public.assert_ai_queue_admin();

  UPDATE public.ai_jobs j
  SET
    status = CASE
      WHEN p_error_kind = 'permanent'
        THEN 'failed'
      WHEN COALESCE(j.attempts, 0) >= COALESCE(j.max_attempts, 3)
        THEN 'failed'
      ELSE 'retry_wait'
    END,
    retry_at = CASE
      WHEN p_error_kind = 'permanent'
        THEN NULL
      WHEN COALESCE(j.attempts, 0) >= COALESCE(j.max_attempts, 3)
        THEN NULL
      ELSE COALESCE(p_retry_at, now() + interval '1 minute')
    END,
    error = p_error,
    error_code = p_error_code,
    error_kind = p_error_kind,
    error_structured = jsonb_build_object(
      'message', p_error,
      'code', p_error_code,
      'kind', p_error_kind
    ),
    worker_id = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    locked_until = NULL,
    last_heartbeat_at = NULL,
    updated_at = now()
  WHERE j.id = p_job_id
    AND (p_worker_id IS NULL OR j.worker_id = p_worker_id)
    AND j.status IN ('claimed', 'running')
  RETURNING * INTO v_job;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job % is not active for worker %', p_job_id, p_worker_id;
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ai_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_result JSONB,
  p_raw_result JSONB DEFAULT NULL,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_cost_actual NUMERIC DEFAULT NULL,
  p_latency_ai_ms INTEGER DEFAULT NULL,
  p_latency_persist_ms INTEGER DEFAULT NULL
)
RETURNS public.ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.ai_jobs;
BEGIN
  PERFORM public.assert_ai_queue_admin();

  UPDATE public.ai_jobs
  SET
    status = 'completed',
    result = p_result,
    raw_result = p_raw_result,
    input_tokens = COALESCE(p_input_tokens, input_tokens),
    output_tokens = COALESCE(p_output_tokens, output_tokens),
    cost_actual = COALESCE(p_cost_actual, cost_actual),
    latency_ai_ms = COALESCE(p_latency_ai_ms, latency_ai_ms),
    latency_persist_ms = COALESCE(p_latency_persist_ms, latency_persist_ms),
    completed_at = now(),
    worker_id = p_worker_id,
    locked_by = NULL,
    lease_expires_at = NULL,
    locked_until = NULL,
    last_heartbeat_at = now(),
    error = NULL,
    error_code = NULL,
    error_kind = NULL,
    error_structured = NULL,
    updated_at = now()
  WHERE id = p_job_id
    AND worker_id = p_worker_id
    AND status = 'running'
  RETURNING * INTO v_job;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job % is not running for worker %', p_job_id, p_worker_id;
  END IF;

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_ai_jobs(TEXT, TEXT[], INTEGER, INTEGER, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_claimed_ai_job(UUID, TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_ai_job_lease(UUID, TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_expired_ai_job_leases(INTEGER, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_ai_job_for_retry(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_ai_job(UUID, TEXT, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER, INTEGER) TO authenticated, service_role;
