BEGIN;

CREATE OR REPLACE FUNCTION public.reanalyze_sentence(p_sentence_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  request_user TEXT;
  current_sentence sentences;
  selected_run processing_runs;
  selected_stage_id UUID;
  inserted_job ai_jobs;
  p_model TEXT := 'gemini-2.5-flash-lite';
  p_prompt_version TEXT := 'prepare_sentence:2026-06-cost-v1';
  target_hash_value TEXT;
  input_hash_value TEXT;
  job_payload JSONB;
BEGIN
  request_user := public.request_user_id(NULL);

  SELECT * INTO current_sentence
  FROM sentences
  WHERE id = p_sentence_id
    AND user_id = request_user
  FOR UPDATE;

  IF current_sentence.id IS NULL THEN
    RAISE EXCEPTION 'Frase nao encontrada para usuario.';
  END IF;

  UPDATE ai_jobs
  SET
    status = 'obsolete',
    error = 'Substituido por reanalise manual da frase.',
    error_code = 'MANUAL_REANALYSIS',
    error_kind = 'permanent',
    locked_by = NULL,
    locked_until = NULL,
    lease_expires_at = NULL,
    worker_id = NULL,
    cancel_requested = TRUE,
    completed_at = COALESCE(completed_at, NOW()),
    updated_at = NOW()
  WHERE user_id = request_user
    AND target_type = 'sentence'
    AND target_id = current_sentence.id
    AND status IN ('pending','claimed','retry_wait','failed','needs_review','error','rejected');

  DELETE FROM sentence_terms
  WHERE sentence_id = current_sentence.id
    AND user_id = request_user;

  UPDATE sentences
  SET
    portuguese = NULL,
    kana = NULL,
    romaji = NULL,
    status = 'raw',
    translation_source = NULL,
    reading_source = NULL,
    terms_source = NULL,
    prepared_at = NULL,
    updated_at = NOW()
  WHERE id = current_sentence.id
    AND user_id = request_user
  RETURNING * INTO current_sentence;

  INSERT INTO processing_runs(
    user_id,
    source_id,
    status,
    run_mode,
    current_step,
    started_at,
    cancel_requested
  )
  VALUES (
    request_user,
    current_sentence.source_id,
    'running',
    'analyze',
    'Reanalise manual da frase em andamento.',
    NOW(),
    FALSE
  )
  RETURNING * INTO selected_run;

  INSERT INTO processing_run_stages(user_id, run_id, stage, status, started_at)
  VALUES (request_user, selected_run.id, 'sentence_preparation', 'running', NOW())
  RETURNING id INTO selected_stage_id;

  job_payload := jsonb_build_object(
    'id', current_sentence.id,
    'sentence', current_sentence.japanese,
    'japanese', current_sentence.japanese,
    'portuguese', current_sentence.portuguese,
    'kana', current_sentence.kana,
    'romaji', current_sentence.romaji,
    'sourceId', current_sentence.source_id,
    'manualReanalysis', TRUE
  );

  target_hash_value := encode(public.digest(jsonb_build_object(
    'targetType', 'sentence',
    'targetId', current_sentence.id,
    'payload', jsonb_build_object(
      'id', current_sentence.id,
      'sentence', current_sentence.japanese,
      'japanese', current_sentence.japanese,
      'portuguese', current_sentence.portuguese,
      'kana', current_sentence.kana,
      'romaji', current_sentence.romaji,
      'sourceId', current_sentence.source_id
    ),
    'promptVersion', p_prompt_version,
    'model', p_model
  )::text, 'sha256'::text), 'hex');

  input_hash_value := encode(public.digest(jsonb_build_object(
    'type', 'prepare_sentence',
    'targetType', 'sentence',
    'targetId', current_sentence.id,
    'japanese', current_sentence.japanese,
    'portuguese', current_sentence.portuguese,
    'kana', current_sentence.kana,
    'romaji', current_sentence.romaji,
    'runId', selected_run.id,
    'manualReanalysis', TRUE,
    'promptVersion', p_prompt_version,
    'model', p_model
  )::text, 'sha256'::text), 'hex');

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
    max_attempts,
    current_step
  )
  VALUES (
    request_user,
    selected_run.id,
    selected_stage_id,
    'sentence_preparation',
    'prepare_sentence',
    'sentence',
    current_sentence.id,
    'pending',
    400,
    target_hash_value,
    input_hash_value,
    'prepare_sentence:sentence:' || current_sentence.id || ':manual:' || input_hash_value,
    p_prompt_version,
    p_model,
    p_model,
    job_payload,
    job_payload,
    3,
    'Aguardando worker para reanalise manual.'
  )
  RETURNING * INTO inserted_job;

  PERFORM public.refresh_processing_run_snapshot(selected_run.id);

  RETURN jsonb_build_object(
    'run_id', selected_run.id,
    'job_id', inserted_job.id,
    'sentence_id', current_sentence.id,
    'status', inserted_job.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reanalyze_sentence(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.reanalyze_sentence(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verify_ai_queue_reset()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH required_tables(name) AS (
    VALUES
      ('sources'), ('sentences'), ('processing_runs'), ('processing_run_stages'),
      ('ai_jobs'), ('ai_job_attempts'), ('dictionary_entries'), ('dictionary_forms'),
      ('dictionary_senses'), ('sentence_terms'), ('app_admins'), ('schema_versions')
  ),
  required_columns(table_name, column_name) AS (
    VALUES
      ('processing_runs','running_jobs'),
      ('processing_runs','total_cost_estimate'),
      ('processing_runs','total_cost_actual'),
      ('processing_runs','total_input_tokens'),
      ('processing_runs','total_output_tokens'),
      ('processing_runs','ai_call_count'),
      ('processing_run_stages','pending_jobs'),
      ('processing_run_stages','claimed_jobs'),
      ('processing_run_stages','running_jobs'),
      ('processing_run_stages','completed_jobs'),
      ('processing_run_stages','failed_jobs'),
      ('processing_run_stages','retry_jobs'),
      ('processing_run_stages','needs_review_jobs'),
      ('processing_run_stages','cancelled_jobs'),
      ('processing_run_stages','obsolete_jobs')
  ),
  required_rpcs(name) AS (
    VALUES
      ('create_or_resume_source_run'), ('prepare_source_run'), ('advance_processing_run'), ('pause_processing_run'), ('reanalyze_sentence'), ('enqueue_ai_jobs_bulk'),
      ('cancel_processing_run'), ('retry_failed_run_jobs'), ('claim_ai_jobs'),
      ('validate_ai_job_for_execution'), ('build_ai_job_current_target_hash'),
      ('heartbeat_ai_job'), ('get_ai_queue_health')
  )
  SELECT jsonb_build_object(
    'schema_version', (SELECT version FROM schema_versions WHERE key = 'ai_queue'),
    'missing_tables', COALESCE((SELECT jsonb_agg(name) FROM required_tables rt WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = rt.name)), '[]'::jsonb),
    'missing_columns', COALESCE((SELECT jsonb_agg(table_name || '.' || column_name) FROM required_columns rc WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = rc.table_name AND column_name = rc.column_name)), '[]'::jsonb),
    'missing_rpcs', COALESCE((SELECT jsonb_agg(name) FROM required_rpcs rr WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = rr.name)), '[]'::jsonb),
    'admin_count', (SELECT COUNT(*) FROM app_admins),
    'admin_exactly_one', (SELECT COUNT(*) = 1 FROM app_admins),
    'worker_health', public.get_ai_queue_health()
  );
$$;

UPDATE schema_versions
SET version = '2026-06-ai-queue-v33',
    applied_at = NOW()
WHERE key = 'ai_queue';

INSERT INTO schema_versions(key, version)
SELECT 'ai_queue', '2026-06-ai-queue-v33'
WHERE NOT EXISTS (SELECT 1 FROM schema_versions WHERE key = 'ai_queue');

COMMIT;
