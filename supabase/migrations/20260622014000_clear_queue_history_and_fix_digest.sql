BEGIN;

DO $$
DECLARE
  v_pgcrypto_schema TEXT;
BEGIN
  SELECT n.nspname
    INTO v_pgcrypto_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION 'Extensao pgcrypto nao encontrada.';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.digest(data TEXT, type TEXT)
     RETURNS BYTEA
     LANGUAGE sql
     IMMUTABLE
     STRICT
     AS %L',
    format('SELECT %I.digest(convert_to($1, ''UTF8''), $2)', v_pgcrypto_schema)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_processing_run_snapshot(p_run_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_run_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE processing_runs pr
  SET
    planned_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status <> 'obsolete'), 0),
    pending_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'pending'), 0),
    claimed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'claimed'), 0),
    running_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'running'), 0),
    processed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status IN ('completed','failed','needs_review','cancelled','obsolete')), 0),
    completed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'completed'), 0),
    failed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'failed'), 0),
    retry_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'retry_wait'), 0),
    needs_review_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'needs_review'), 0),
    cancelled_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'cancelled'), 0),
    obsolete_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'obsolete'), 0),
    failed_items = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'failed'), 0),
    total_input_tokens = COALESCE((SELECT SUM(input_tokens) FROM ai_jobs WHERE run_id = p_run_id), 0),
    total_output_tokens = COALESCE((SELECT SUM(output_tokens) FROM ai_jobs WHERE run_id = p_run_id), 0),
    total_cost_estimate = (SELECT SUM(cost_estimate) FROM ai_jobs WHERE run_id = p_run_id AND cost_estimate IS NOT NULL),
    total_cost_actual = (SELECT SUM(cost_actual) FROM ai_jobs WHERE run_id = p_run_id AND cost_actual IS NOT NULL),
    ai_call_count = COALESCE((SELECT COUNT(*) FROM ai_job_attempts WHERE run_id = p_run_id), 0),
    updated_at = NOW()
  WHERE pr.id = p_run_id;

  UPDATE processing_run_stages s
  SET
    planned_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status <> 'obsolete'), 0),
    pending_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'pending'), 0),
    claimed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'claimed'), 0),
    running_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'running'), 0),
    completed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'completed'), 0),
    failed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'failed'), 0),
    retry_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'retry_wait'), 0),
    needs_review_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'needs_review'), 0),
    cancelled_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'cancelled'), 0),
    obsolete_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'obsolete'), 0),
    total_input_tokens = COALESCE((SELECT SUM(input_tokens) FROM ai_jobs WHERE stage_id = s.id), 0),
    total_output_tokens = COALESCE((SELECT SUM(output_tokens) FROM ai_jobs WHERE stage_id = s.id), 0),
    total_cost_estimate = (SELECT SUM(cost_estimate) FROM ai_jobs WHERE stage_id = s.id AND cost_estimate IS NOT NULL),
    total_cost_actual = (SELECT SUM(cost_actual) FROM ai_jobs WHERE stage_id = s.id AND cost_actual IS NOT NULL),
    ai_call_count = COALESCE((SELECT COUNT(*) FROM ai_job_attempts WHERE run_id = p_run_id AND job_id IN (SELECT id FROM ai_jobs WHERE stage_id = s.id)), 0),
    updated_at = NOW()
  WHERE s.run_id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ai_jobs_by_run(
  p_run_id UUID,
  p_user_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cancelled_count INTEGER := 0;
BEGIN
  p_user_id := public.request_user_id(p_user_id);

  UPDATE ai_jobs
  SET status = 'obsolete',
      cancel_requested = TRUE,
      error = 'Removido da fila pelo usuario.',
      error_code = 'USER_CLEARED_QUEUE',
      error_kind = 'permanent',
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      retry_at = NULL,
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
  WHERE run_id = p_run_id
    AND user_id = p_user_id
    AND status <> 'obsolete';

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  UPDATE processing_run_stages
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE run_id = p_run_id
    AND user_id = p_user_id
    AND status IN ('pending','running','needs_review','blocked');

  UPDATE processing_runs
  SET cancel_requested = TRUE,
      status = 'cancelled',
      finished_at = NOW(),
      current_step = 'Fila zerada pelo usuario.',
      updated_at = NOW()
  WHERE id = p_run_id
    AND user_id = p_user_id
    AND status IN ('pending','planning','running','paused','needs_review','cancelled','completed');

  PERFORM refresh_processing_run_snapshot(p_run_id);
  RETURN cancelled_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ai_jobs_by_source(
  p_source_id UUID,
  p_user_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  run_ids UUID[];
  cancelled_count INTEGER := 0;
BEGIN
  p_user_id := public.request_user_id(p_user_id);

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO run_ids
  FROM processing_runs
  WHERE source_id = p_source_id AND user_id = p_user_id;

  UPDATE ai_jobs
  SET status = 'obsolete',
      cancel_requested = TRUE,
      error = 'Removido da fila pelo usuario.',
      error_code = 'USER_CLEARED_QUEUE',
      error_kind = 'permanent',
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      retry_at = NULL,
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status <> 'obsolete'
    AND (
      run_id = ANY(run_ids)
      OR target_id = p_source_id
      OR input->>'sourceId' = p_source_id::TEXT
      OR payload->>'sourceId' = p_source_id::TEXT
    );

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  UPDATE processing_run_stages
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE run_id = ANY(run_ids)
    AND user_id = p_user_id
    AND status IN ('pending','running','needs_review','blocked');

  UPDATE processing_runs
  SET cancel_requested = TRUE,
      status = 'cancelled',
      finished_at = NOW(),
      current_step = 'Fila zerada pelo usuario.',
      updated_at = NOW()
  WHERE id = ANY(run_ids)
    AND user_id = p_user_id
    AND status IN ('pending','planning','running','paused','needs_review','cancelled','completed');

  PERFORM refresh_processing_run_snapshot(ids.run_id)
  FROM unnest(run_ids) AS ids(run_id);

  RETURN cancelled_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_all_ai_jobs_for_user(
  p_user_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  run_ids UUID[];
  cancelled_count INTEGER := 0;
BEGIN
  p_user_id := public.request_user_id(p_user_id);

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO run_ids
  FROM processing_runs
  WHERE user_id = p_user_id;

  UPDATE ai_jobs
  SET status = 'obsolete',
      cancel_requested = TRUE,
      error = 'Removido da fila pelo usuario.',
      error_code = 'USER_CLEARED_QUEUE',
      error_kind = 'permanent',
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      retry_at = NULL,
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status <> 'obsolete';

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  UPDATE processing_run_stages
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE run_id = ANY(run_ids)
    AND user_id = p_user_id
    AND status IN ('pending','running','needs_review','blocked');

  UPDATE processing_runs
  SET cancel_requested = TRUE,
      status = 'cancelled',
      finished_at = NOW(),
      current_step = 'Fila global zerada pelo usuario.',
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status IN ('pending','planning','running','paused','needs_review','cancelled','completed');

  PERFORM refresh_processing_run_snapshot(ids.run_id)
  FROM unnest(run_ids) AS ids(run_id);

  RETURN cancelled_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_queue_summary()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'running', COUNT(*) FILTER (WHERE status IN ('running','claimed')),
    'retry', COUNT(*) FILTER (WHERE status = 'retry_wait'),
    'review', COUNT(*) FILTER (WHERE status = 'needs_review'),
    'completed', COUNT(*) FILTER (WHERE status IN ('completed','applied')),
    'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
    'error', COUNT(*) FILTER (WHERE status IN ('error','failed')),
    'stuck', COUNT(*) FILTER (
      WHERE status IN ('claimed', 'running')
        AND (
          lease_expires_at < now()
          OR (
            last_heartbeat_at IS NOT NULL
            AND last_heartbeat_at < now() - interval '5 minutes'
          )
        )
    ),
    'clearable', COUNT(*) FILTER (WHERE status <> 'obsolete')
  )
  FROM ai_jobs
  WHERE user_id = auth.uid()::text
    AND status <> 'obsolete';
$$;

UPDATE schema_versions
SET version = '2026-06-ai-queue-v34',
    applied_at = NOW()
WHERE key = 'ai_queue';

INSERT INTO schema_versions(key, version)
SELECT 'ai_queue', '2026-06-ai-queue-v34'
WHERE NOT EXISTS (SELECT 1 FROM schema_versions WHERE key = 'ai_queue');

COMMIT;
