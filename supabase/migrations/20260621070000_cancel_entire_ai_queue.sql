BEGIN;

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
  SET status = 'cancelled',
      cancel_requested = CASE WHEN status = 'running' THEN TRUE ELSE cancel_requested END,
      error = 'Cancelado pelo usuario.',
      error_code = 'USER_CANCELLED',
      error_kind = 'permanent',
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      retry_at = NULL,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE run_id = p_run_id
    AND user_id = p_user_id
    AND status NOT IN ('completed','applied','cancelled');

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  UPDATE processing_run_stages
  SET status = 'cancelled',
      cancelled_jobs = (
        SELECT COUNT(*) FROM ai_jobs
        WHERE stage_id = processing_run_stages.id AND status = 'cancelled'
      ),
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
    AND status IN ('pending','planning','running','paused','needs_review');

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
  SET status = 'cancelled',
      cancel_requested = CASE WHEN status = 'running' THEN TRUE ELSE cancel_requested END,
      error = 'Cancelado pelo usuario.',
      error_code = 'USER_CANCELLED',
      error_kind = 'permanent',
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      retry_at = NULL,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status NOT IN ('completed','applied','cancelled')
    AND (
      run_id = ANY(run_ids)
      OR target_id = p_source_id
      OR input->>'sourceId' = p_source_id::TEXT
      OR payload->>'sourceId' = p_source_id::TEXT
    );

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  UPDATE processing_run_stages
  SET status = 'cancelled',
      cancelled_jobs = (
        SELECT COUNT(*) FROM ai_jobs
        WHERE stage_id = processing_run_stages.id AND status = 'cancelled'
      ),
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
    AND status IN ('pending','planning','running','paused','needs_review');

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
  SET status = 'cancelled',
      cancel_requested = CASE WHEN status = 'running' THEN TRUE ELSE cancel_requested END,
      error = 'Cancelado pelo usuario.',
      error_code = 'USER_CANCELLED',
      error_kind = 'permanent',
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      retry_at = NULL,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status NOT IN ('completed','applied','cancelled');

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  UPDATE processing_run_stages
  SET status = 'cancelled',
      cancelled_jobs = (
        SELECT COUNT(*) FROM ai_jobs
        WHERE stage_id = processing_run_stages.id AND status = 'cancelled'
      ),
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
    AND status IN ('pending','planning','running','paused','needs_review');

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
    'clearable', COUNT(*) FILTER (WHERE status NOT IN ('completed','applied','cancelled'))
  )
  FROM ai_jobs
  WHERE user_id = auth.uid()::text;
$$;

INSERT INTO schema_versions(key, version)
VALUES ('ai_queue', '2026-06-ai-queue-v29')
ON CONFLICT (key) DO UPDATE
SET version = EXCLUDED.version,
    applied_at = NOW();

COMMIT;
