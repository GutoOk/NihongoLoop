BEGIN;

CREATE OR REPLACE FUNCTION public.is_supported_ai_job_type(p_type TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(p_type = ANY(ARRAY[
    'prepare_sentence',
    'translate_sentence',
    'generate_sentence_reading',
    'detect_sentence_terms',
    'enrich_dictionary_entry'
  ]::TEXT[]), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.enqueue_ai_jobs_bulk(p_jobs JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_count INTEGER;
  unsupported_job_type TEXT;
BEGIN
  SELECT COALESCE(incoming.type, '<null>') INTO unsupported_job_type
  FROM jsonb_to_recordset(p_jobs) AS incoming(type TEXT)
  WHERE NOT public.is_supported_ai_job_type(incoming.type)
  LIMIT 1;

  IF unsupported_job_type IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported AI job type: %', unsupported_job_type
      USING ERRCODE = '22023';
  END IF;

  WITH incoming AS (
    SELECT *
    FROM jsonb_to_recordset(p_jobs) AS x(
      user_id TEXT,
      run_id UUID,
      stage_id UUID,
      stage TEXT,
      type TEXT,
      target_type TEXT,
      target_id UUID,
      priority INTEGER,
      target_hash TEXT,
      input_hash TEXT,
      job_key TEXT,
      prompt_version TEXT,
      model_version TEXT,
      model TEXT,
      payload JSONB,
      input JSONB,
      max_attempts INTEGER
    )
  ),
  inserted AS (
    INSERT INTO ai_jobs(
      user_id,
      run_id,
      stage_id,
      stage,
      type,
      target_type,
      target_id,
      status,
      priority,
      target_hash,
      input_hash,
      job_key,
      prompt_version,
      model_version,
      model,
      payload,
      input,
      max_attempts
    )
    SELECT
      user_id,
      run_id,
      stage_id,
      stage,
      type,
      target_type,
      target_id,
      'pending',
      COALESCE(priority, 0),
      target_hash,
      input_hash,
      job_key,
      prompt_version,
      model_version,
      model,
      payload,
      COALESCE(input, payload),
      COALESCE(max_attempts, 3)
    FROM incoming
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_count FROM inserted;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_ai_jobs(
  p_user_id TEXT,
  p_run_id UUID DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_job_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  run_ids UUID[];
  retried_count INTEGER := 0;
  unsupported_job_type TEXT;
BEGIN
  p_user_id := public.request_user_id(p_user_id);

  IF p_job_id IS NOT NULL THEN
    SELECT type INTO unsupported_job_type
    FROM ai_jobs
    WHERE id = p_job_id
      AND user_id = p_user_id
      AND NOT public.is_supported_ai_job_type(type)
    LIMIT 1;

    IF unsupported_job_type IS NOT NULL THEN
      RAISE EXCEPTION 'Unsupported AI job type: %', unsupported_job_type
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL), ARRAY[]::UUID[]) INTO run_ids
  FROM ai_jobs
  WHERE user_id = p_user_id
    AND public.is_supported_ai_job_type(type)
    AND (p_run_id IS NULL OR run_id = p_run_id)
    AND (p_job_id IS NULL OR id = p_job_id)
    AND (
      p_source_id IS NULL
      OR input->>'sourceId' = p_source_id::TEXT
      OR payload->>'sourceId' = p_source_id::TEXT
      OR EXISTS (
        SELECT 1 FROM processing_runs pr
        WHERE pr.id = ai_jobs.run_id
          AND pr.source_id = p_source_id
      )
    );

  WITH retry_source AS (
    SELECT *
    FROM ai_jobs
    WHERE user_id = p_user_id
      AND status IN ('error','failed','retry_wait','needs_review')
      AND public.is_supported_ai_job_type(type)
      AND (p_run_id IS NULL OR run_id = p_run_id)
      AND (p_job_id IS NULL OR id = p_job_id)
      AND (
        p_source_id IS NULL
        OR input->>'sourceId' = p_source_id::TEXT
        OR payload->>'sourceId' = p_source_id::TEXT
        OR EXISTS (
          SELECT 1 FROM processing_runs pr
          WHERE pr.id = ai_jobs.run_id
            AND pr.source_id = p_source_id
        )
      )
    FOR UPDATE
  ),
  inserted AS (
    INSERT INTO ai_jobs(
      user_id, run_id, stage_id, retry_of_job_id, stage, type, target_type, target_id,
      status, priority, target_hash, input_hash, job_key, prompt_version, model_version,
      model, payload, input, max_attempts
    )
    SELECT
      user_id, run_id, stage_id, id, stage, type, target_type, target_id,
      'pending', priority, target_hash, input_hash,
      COALESCE(job_key, type || ':' || target_type || ':' || target_id || ':' || input_hash) || ':retry:' || gen_random_uuid(),
      prompt_version, model_version, model, payload, input, max_attempts
    FROM retry_source
    RETURNING 1
  )
  SELECT COUNT(*) INTO retried_count FROM inserted;

  UPDATE processing_run_stages
  SET status = 'running',
      blocked_reason = NULL,
      updated_at = NOW()
  WHERE run_id = ANY(run_ids)
    AND status = 'needs_review';

  UPDATE processing_runs
  SET status = 'running',
      current_step = 'Retry manual enfileirado.',
      updated_at = NOW()
  WHERE id = ANY(run_ids)
    AND status = 'needs_review';

  PERFORM refresh_processing_run_snapshot(ids.run_id)
  FROM unnest(run_ids) AS ids(run_id);

  RETURN retried_count;
END;
$$;

DO $$
DECLARE
  affected_run_ids UUID[];
BEGIN
  WITH cancelled AS (
    UPDATE ai_jobs
    SET status = 'cancelled',
        error = 'Unsupported AI job type: ' || type,
        error_code = 'UNSUPPORTED_JOB_TYPE',
        error_kind = 'permanent',
        error_structured = jsonb_build_object('code', 'UNSUPPORTED_JOB_TYPE', 'job_type', type),
        logs = COALESCE(logs, '[]'::JSONB) || jsonb_build_array(jsonb_build_object(
          'at', NOW(),
          'level', 'error',
          'code', 'UNSUPPORTED_JOB_TYPE',
          'message', 'Pending job cancelled because the worker has no handler for this type.'
        )),
        current_step = 'Job cancelado: tipo sem handler no worker.',
        completed_at = COALESCE(completed_at, NOW()),
        updated_at = NOW(),
        locked_by = NULL,
        locked_until = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        retry_at = NULL,
        cancel_requested = FALSE
    WHERE status = 'pending'
      AND NOT public.is_supported_ai_job_type(type)
    RETURNING run_id
  )
  SELECT COALESCE(array_agg(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL), ARRAY[]::UUID[])
  INTO affected_run_ids
  FROM cancelled;

  PERFORM public.refresh_processing_run_snapshot(ids.run_id)
  FROM unnest(affected_run_ids) AS ids(run_id);
END;
$$;

UPDATE schema_versions
SET version = '2026-06-ai-queue-v36',
    updated_at = NOW()
WHERE key = 'ai_queue';

INSERT INTO schema_versions(key, version)
SELECT 'ai_queue', '2026-06-ai-queue-v36'
WHERE NOT EXISTS (SELECT 1 FROM schema_versions WHERE key = 'ai_queue');

COMMIT;
