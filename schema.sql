-- Nihongo Loop clean Supabase baseline
-- This schema is intended for a fresh database reset/rebuild.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS study_session_items CASCADE;
DROP TABLE IF EXISTS study_sessions CASCADE;
DROP TABLE IF EXISTS ai_model_prices CASCADE;
DROP TABLE IF EXISTS ai_job_attempts CASCADE;
DROP TABLE IF EXISTS ai_jobs CASCADE;
DROP TABLE IF EXISTS processing_run_stages CASCADE;
DROP TABLE IF EXISTS schema_versions CASCADE;
DROP TABLE IF EXISTS dictionary_progress CASCADE;
DROP TABLE IF EXISTS sentence_progress CASCADE;
DROP TABLE IF EXISTS sentence_terms CASCADE;
DROP TABLE IF EXISTS dictionary_senses CASCADE;
DROP TABLE IF EXISTS dictionary_forms CASCADE;
DROP TABLE IF EXISTS dictionary_entries CASCADE;
DROP TABLE IF EXISTS processing_runs CASCADE;
DROP TABLE IF EXISTS sentences CASCADE;
DROP TABLE IF EXISTS sources CASCADE;
DROP TABLE IF EXISTS app_admins CASCADE;

CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  original_content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sentences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  start_time TEXT,
  end_time TEXT,
  japanese TEXT NOT NULL,
  japanese_key TEXT,
  portuguese TEXT,
  kana TEXT,
  romaji TEXT,
  status TEXT NOT NULL DEFAULT 'raw',
  tags TEXT[] DEFAULT '{}',
  translation_source TEXT,
  reading_source TEXT,
  terms_source TEXT,
  prepared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE processing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT,
  total_steps INTEGER DEFAULT 0,
  completed_steps INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  created_jobs INTEGER DEFAULT 0,
  planned_jobs INTEGER DEFAULT 0,
  pending_jobs INTEGER DEFAULT 0,
  processed_jobs INTEGER DEFAULT 0,
  completed_jobs INTEGER DEFAULT 0,
  retry_jobs INTEGER DEFAULT 0,
  review_jobs INTEGER DEFAULT 0,
  cancelled_jobs INTEGER DEFAULT 0,
  obsolete_jobs INTEGER DEFAULT 0,
  applied_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  cancel_requested BOOLEAN DEFAULT FALSE,
  run_mode TEXT DEFAULT 'all',
  log JSONB DEFAULT '[]',
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE processing_run_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  run_id UUID NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  planned_jobs INTEGER DEFAULT 0,
  completed_jobs INTEGER DEFAULT 0,
  failed_jobs INTEGER DEFAULT 0,
  retry_jobs INTEGER DEFAULT 0,
  blocked_reason TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (run_id, stage)
);

CREATE TABLE dictionary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  lemma TEXT NOT NULL,
  kana TEXT,
  romaji TEXT,
  type TEXT NOT NULL,
  jlpt_level TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  tags TEXT[] DEFAULT '{}',
  unique_key TEXT NOT NULL,
  main_meaning TEXT,
  subtype TEXT,
  components JSONB,
  grammar_info TEXT,
  short_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE dictionary_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  dictionary_entry_id UUID NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE,
  form TEXT NOT NULL,
  kana TEXT,
  romaji TEXT,
  form_type TEXT,
  grammar_note TEXT,
  is_common BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'detected',
  unique_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE dictionary_senses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  dictionary_entry_id UUID NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE,
  meaning TEXT NOT NULL,
  meaning_type TEXT DEFAULT 'principal',
  explanation TEXT,
  example_japanese TEXT,
  example_portuguese TEXT,
  sense_order INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ai_generated',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sentence_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  sentence_id UUID NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  dictionary_form_id UUID NOT NULL REFERENCES dictionary_forms(id) ON DELETE CASCADE,
  dictionary_sense_id UUID REFERENCES dictionary_senses(id) ON DELETE SET NULL,
  surface TEXT NOT NULL,
  start_index INTEGER NOT NULL,
  end_index INTEGER NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'detected',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sentence_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  sentence_id UUID NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  seen_count INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  wrong_count INTEGER DEFAULT 0,
  last_seen_at TIMESTAMPTZ,
  mastery FLOAT DEFAULT 0,
  favorite BOOLEAN DEFAULT FALSE,
  difficulty INTEGER,
  suspended BOOLEAN DEFAULT FALSE,
  notes TEXT,
  srs_interval_minutes INTEGER DEFAULT 0,
  srs_ease_factor NUMERIC DEFAULT 2.5,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE dictionary_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  dictionary_entry_id UUID NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE,
  seen_count INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  wrong_count INTEGER DEFAULT 0,
  last_seen_at TIMESTAMPTZ,
  mastery FLOAT DEFAULT 0,
  favorite BOOLEAN DEFAULT FALSE,
  difficulty INTEGER,
  suspended BOOLEAN DEFAULT FALSE,
  notes TEXT,
  srs_interval_minutes INTEGER DEFAULT 0,
  srs_ease_factor NUMERIC DEFAULT 2.5,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  run_id UUID REFERENCES processing_runs(id) ON DELETE SET NULL,
  stage_id UUID REFERENCES processing_run_stages(id) ON DELETE SET NULL,
  stage TEXT,
  type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  target_hash TEXT,
  input_hash TEXT NOT NULL,
  job_key TEXT,
  prompt_version TEXT,
  model_version TEXT,
  input JSONB,
  payload JSONB,
  result JSONB,
  raw_result JSONB,
  error TEXT,
  error_code TEXT,
  error_kind TEXT,
  error_structured JSONB,
  logs JSONB DEFAULT '[]',
  current_step TEXT,
  attempts INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  cancel_requested BOOLEAN DEFAULT FALSE,
  retry_at TIMESTAMPTZ,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_estimate NUMERIC DEFAULT 0,
  cost_actual NUMERIC,
  latency_queue_ms INTEGER,
  latency_ai_ms INTEGER,
  latency_persist_ms INTEGER,
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_job_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  run_id UUID REFERENCES processing_runs(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  worker_id TEXT,
  attempt_number INTEGER NOT NULL,
  model TEXT,
  prompt_version TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_actual NUMERIC,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  error_code TEXT,
  error_kind TEXT,
  provider_request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_model_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'google',
  model TEXT NOT NULL,
  input_per_million NUMERIC NOT NULL DEFAULT 0,
  output_per_million NUMERIC NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO ai_model_prices(provider, model, input_per_million, output_per_million, effective_from)
VALUES
  ('google', 'gemini-2.5-flash-lite', 0.10, 0.40, '2025-07-22T00:00:00Z'),
  ('google', 'gemini-2.5-flash', 0.30, 2.50, '2025-06-01T00:00:00Z');

CREATE TABLE schema_versions (
  key TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO schema_versions(key, version) VALUES ('ai_queue', '2026-06-ai-queue-v25');

CREATE TABLE study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  config JSONB NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE study_session_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  study_session_id UUID NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  order_index INTEGER,
  answer JSONB,
  is_correct BOOLEAN,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE app_admins (
  user_id UUID PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE dictionary_entries ADD CONSTRAINT uk_dictionary_entries_user_key UNIQUE (user_id, unique_key);
ALTER TABLE dictionary_forms ADD CONSTRAINT uk_dictionary_forms_user_key UNIQUE (user_id, unique_key);
ALTER TABLE dictionary_senses ADD CONSTRAINT uk_dictionary_senses_user_entry_meaning UNIQUE (user_id, dictionary_entry_id, meaning);
ALTER TABLE sentence_terms ADD CONSTRAINT uk_sentence_terms_span_form UNIQUE (sentence_id, start_index, end_index, dictionary_form_id);
ALTER TABLE sentence_progress ADD CONSTRAINT uk_sentence_progress UNIQUE (user_id, sentence_id);
ALTER TABLE dictionary_progress ADD CONSTRAINT uk_dictionary_progress UNIQUE (user_id, dictionary_entry_id);
ALTER TABLE ai_jobs ADD CONSTRAINT ck_ai_jobs_status CHECK (status IN ('pending','claimed','running','completed','retry_wait','failed','needs_review','cancelled','obsolete'));
ALTER TABLE processing_runs ADD CONSTRAINT ck_processing_runs_status CHECK (status IN ('pending','planning','running','completed','failed','cancelled','paused','needs_review'));
ALTER TABLE processing_run_stages ADD CONSTRAINT ck_processing_run_stages_status CHECK (status IN ('pending','running','completed','failed','cancelled','blocked','needs_review'));

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_admins aa WHERE aa.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_app_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_same_user_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_user TEXT;
BEGIN
  IF TG_TABLE_NAME = 'sentences' THEN
    SELECT user_id INTO parent_user FROM sources WHERE id = NEW.source_id;
  ELSIF TG_TABLE_NAME = 'dictionary_forms' THEN
    SELECT user_id INTO parent_user FROM dictionary_entries WHERE id = NEW.dictionary_entry_id;
  ELSIF TG_TABLE_NAME = 'dictionary_senses' THEN
    SELECT user_id INTO parent_user FROM dictionary_entries WHERE id = NEW.dictionary_entry_id;
  ELSIF TG_TABLE_NAME = 'sentence_terms' THEN
    SELECT s.user_id INTO parent_user
    FROM sentences s
    JOIN dictionary_forms df ON df.id = NEW.dictionary_form_id
    WHERE s.id = NEW.sentence_id AND s.user_id = df.user_id;
  END IF;

  IF parent_user IS NULL OR parent_user <> NEW.user_id THEN
    RAISE EXCEPTION 'Inconsistent user_id for %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_sentences_same_user BEFORE INSERT OR UPDATE ON sentences FOR EACH ROW EXECUTE FUNCTION public.assert_same_user_id();
CREATE TRIGGER tr_dictionary_forms_same_user BEFORE INSERT OR UPDATE ON dictionary_forms FOR EACH ROW EXECUTE FUNCTION public.assert_same_user_id();
CREATE TRIGGER tr_dictionary_senses_same_user BEFORE INSERT OR UPDATE ON dictionary_senses FOR EACH ROW EXECUTE FUNCTION public.assert_same_user_id();
CREATE TRIGGER tr_sentence_terms_same_user BEFORE INSERT OR UPDATE ON sentence_terms FOR EACH ROW EXECUTE FUNCTION public.assert_same_user_id();

CREATE TRIGGER tr_sources_touch BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_sentences_touch BEFORE UPDATE ON sentences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_processing_runs_touch BEFORE UPDATE ON processing_runs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_processing_run_stages_touch BEFORE UPDATE ON processing_run_stages FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_dictionary_entries_touch BEFORE UPDATE ON dictionary_entries FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_dictionary_forms_touch BEFORE UPDATE ON dictionary_forms FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_dictionary_senses_touch BEFORE UPDATE ON dictionary_senses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_sentence_terms_touch BEFORE UPDATE ON sentence_terms FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_sentence_progress_touch BEFORE UPDATE ON sentence_progress FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_dictionary_progress_touch BEFORE UPDATE ON dictionary_progress FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_ai_jobs_touch BEFORE UPDATE ON ai_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_study_sessions_touch BEFORE UPDATE ON study_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.get_ai_queue_health()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'schema_version', (SELECT version FROM schema_versions WHERE key = 'ai_queue'),
    'pending_jobs', COUNT(*) FILTER (WHERE status = 'pending'),
    'claimed_jobs', COUNT(*) FILTER (WHERE status = 'claimed'),
    'running_jobs', COUNT(*) FILTER (WHERE status = 'running'),
    'retry_wait_jobs', COUNT(*) FILTER (WHERE status = 'retry_wait'),
    'expired_leases', COUNT(*) FILTER (
      WHERE status IN ('claimed','running')
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < NOW()
    ),
    'last_claim_at', MAX(claimed_at),
    'last_error', (
      SELECT error
      FROM ai_jobs
      WHERE error IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    )
  )
  FROM ai_jobs;
$$;

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
    WHERE
      j.status IN ('pending','retry_wait')
      AND j.type = ANY(p_job_types)
      AND (p_user_id IS NULL OR j.user_id = p_user_id)
      AND (p_run_id IS NULL OR j.run_id = p_run_id)
      AND (j.retry_at IS NULL OR j.retry_at <= NOW())
    ORDER BY j.priority DESC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
  ),
  candidates AS (
    SELECT
      j.id,
      j.user_id,
      j.type,
      COALESCE((p_type_limits ->> j.type)::INTEGER, p_limit) AS type_limit,
      COALESCE((
        SELECT COUNT(*)::INTEGER
        FROM ai_jobs active_user
        WHERE active_user.user_id = j.user_id
          AND active_user.status IN ('claimed','running')
      ), 0) AS active_user_count,
      COALESCE((
        SELECT COUNT(*)::INTEGER
        FROM ai_jobs active_type
        WHERE active_type.type = j.type
          AND active_type.status IN ('claimed','running')
      ), 0) AS active_type_count,
      ROW_NUMBER() OVER (PARTITION BY j.user_id ORDER BY j.priority DESC, j.created_at ASC) AS user_rank,
      ROW_NUMBER() OVER (PARTITION BY j.type ORDER BY j.priority DESC, j.created_at ASC) AS type_rank,
      ROW_NUMBER() OVER (ORDER BY j.priority DESC, j.created_at ASC) AS global_rank
    FROM locked_candidates j
  ),
  picked AS (
    SELECT id
    FROM candidates, capacity
    WHERE global_rank <= capacity.global_capacity
      AND user_rank <= GREATEST(0, p_user_limit - active_user_count)
      AND type_rank <= GREATEST(0, type_limit - active_type_count)
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

CREATE OR REPLACE FUNCTION public.enqueue_ai_jobs_bulk(p_jobs JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
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

CREATE OR REPLACE FUNCTION public.create_or_resume_source_processing_run(
  p_source_id UUID,
  p_user_id TEXT,
  p_run_mode TEXT DEFAULT 'all',
  p_model TEXT DEFAULT 'gemini-2.5-flash-lite',
  p_prompt_version TEXT DEFAULT 'worker-orchestrated:2026-06-v1'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  selected_run processing_runs;
  selected_stage_id UUID;
  selected_stage TEXT;
  job_rows JSONB;
  created_count INTEGER := 0;
  active_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sources WHERE id = p_source_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'Fonte nao encontrada para usuario.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('source_run:' || p_source_id::TEXT || ':' || p_user_id));

  SELECT * INTO selected_run
  FROM processing_runs
  WHERE source_id = p_source_id
    AND user_id = p_user_id
    AND status IN ('pending','planning','running','paused','needs_review')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF selected_run.id IS NULL THEN
    INSERT INTO processing_runs(user_id, source_id, status, run_mode, started_at, current_step)
    VALUES (p_user_id, p_source_id, 'running', p_run_mode, NOW(), 'Run criada pelo banco; worker persistente fara a orquestracao.')
    RETURNING * INTO selected_run;
  ELSE
    UPDATE processing_runs
    SET status = 'running',
        cancel_requested = FALSE,
        finished_at = NULL,
        current_step = 'Run retomada pelo banco; worker persistente fara a orquestracao.',
        updated_at = NOW()
    WHERE id = selected_run.id
    RETURNING * INTO selected_run;
  END IF;

  SELECT COUNT(*) INTO active_count
  FROM ai_jobs
  WHERE run_id = selected_run.id
    AND status IN ('pending','claimed','running','retry_wait');

  IF active_count > 0 THEN
    PERFORM refresh_processing_run_snapshot(selected_run.id);
    RETURN jsonb_build_object('run_id', selected_run.id, 'stage', NULL, 'created_jobs', 0, 'active_jobs', active_count, 'status', 'running');
  END IF;

  IF EXISTS (
    SELECT 1 FROM sentences
    WHERE source_id = p_source_id AND user_id = p_user_id AND status <> 'reviewed' AND portuguese IS NULL
  ) THEN
    selected_stage := 'translation';
  ELSIF EXISTS (
    SELECT 1 FROM sentences
    WHERE source_id = p_source_id AND user_id = p_user_id AND status <> 'reviewed' AND portuguese IS NOT NULL AND (kana IS NULL OR romaji IS NULL)
  ) THEN
    selected_stage := 'reading';
  ELSIF EXISTS (
    SELECT 1 FROM sentences
    WHERE source_id = p_source_id AND user_id = p_user_id AND status <> 'reviewed' AND portuguese IS NOT NULL AND kana IS NOT NULL AND romaji IS NOT NULL AND terms_source IS NULL
  ) THEN
    selected_stage := 'lexical_analysis';
  ELSE
    UPDATE processing_runs
    SET status = 'completed',
        current_step = 'Nada a enfileirar: fonte ja esta preparada.',
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = selected_run.id;
    RETURN jsonb_build_object('run_id', selected_run.id, 'stage', NULL, 'created_jobs', 0, 'status', 'completed');
  END IF;

  INSERT INTO processing_run_stages(user_id, run_id, stage, status, started_at)
  VALUES (p_user_id, selected_run.id, selected_stage, 'running', NOW())
  ON CONFLICT (run_id, stage)
  DO UPDATE SET status = 'running', blocked_reason = NULL, updated_at = NOW()
  RETURNING id INTO selected_stage_id;

  IF selected_stage = 'translation' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(job_payload)::jsonb), '[]'::jsonb) INTO job_rows
    FROM (
      SELECT
        p_user_id AS user_id,
        selected_run.id AS run_id,
        selected_stage_id AS stage_id,
        selected_stage AS stage,
        'translate_sentence' AS type,
        'sentence' AS target_type,
        s.id AS target_id,
        300 AS priority,
        encode(digest(jsonb_build_object(
          'targetType', 'sentence',
          'targetId', s.id,
          'payload', jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'sourceId', p_source_id),
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'), 'hex') AS target_hash,
        encode(digest(jsonb_build_object(
          'type', 'translate_sentence',
          'targetType', 'sentence',
          'targetId', s.id,
          'japanese', s.japanese,
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'), 'hex') AS input_hash,
        'translate_sentence:sentence:' || s.id || ':' || encode(digest(jsonb_build_object(
          'type', 'translate_sentence',
          'targetType', 'sentence',
          'targetId', s.id,
          'japanese', s.japanese,
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'), 'hex') AS job_key,
        p_prompt_version AS prompt_version,
        p_model AS model_version,
        p_model AS model,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'sourceId', p_source_id) AS payload,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'sourceId', p_source_id) AS input,
        3 AS max_attempts
      FROM sentences s
      WHERE s.source_id = p_source_id AND s.user_id = p_user_id AND s.status <> 'reviewed' AND s.portuguese IS NULL
      ORDER BY s.order_index
    ) job_payload;
  ELSIF selected_stage = 'reading' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(job_payload)::jsonb), '[]'::jsonb) INTO job_rows
    FROM (
      SELECT
        p_user_id AS user_id,
        selected_run.id AS run_id,
        selected_stage_id AS stage_id,
        selected_stage AS stage,
        'generate_sentence_reading' AS type,
        'sentence' AS target_type,
        s.id AS target_id,
        200 AS priority,
        encode(digest(jsonb_build_object('targetType','sentence','targetId',s.id,'payload',jsonb_build_object('id',s.id,'sentence',s.japanese,'japanese',s.japanese,'portuguese',s.portuguese,'sourceId',p_source_id),'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'), 'hex') AS target_hash,
        encode(digest(jsonb_build_object('type','generate_sentence_reading','targetType','sentence','targetId',s.id,'japanese',s.japanese,'portuguese',s.portuguese,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'), 'hex') AS input_hash,
        'generate_sentence_reading:sentence:' || s.id || ':' || encode(digest(jsonb_build_object('type','generate_sentence_reading','targetType','sentence','targetId',s.id,'japanese',s.japanese,'portuguese',s.portuguese,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'), 'hex') AS job_key,
        p_prompt_version AS prompt_version,
        p_model AS model_version,
        p_model AS model,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'sourceId', p_source_id) AS payload,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'sourceId', p_source_id) AS input,
        3 AS max_attempts
      FROM sentences s
      WHERE s.source_id = p_source_id AND s.user_id = p_user_id AND s.status <> 'reviewed' AND s.portuguese IS NOT NULL AND (s.kana IS NULL OR s.romaji IS NULL)
      ORDER BY s.order_index
    ) job_payload;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(job_payload)::jsonb), '[]'::jsonb) INTO job_rows
    FROM (
      SELECT
        p_user_id AS user_id,
        selected_run.id AS run_id,
        selected_stage_id AS stage_id,
        selected_stage AS stage,
        'detect_sentence_terms' AS type,
        'sentence' AS target_type,
        s.id AS target_id,
        150 AS priority,
        encode(digest(jsonb_build_object('targetType','sentence','targetId',s.id,'payload',jsonb_build_object('id',s.id,'sentence',s.japanese,'japanese',s.japanese,'portuguese',s.portuguese,'kana',s.kana,'romaji',s.romaji,'sourceId',p_source_id),'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'), 'hex') AS target_hash,
        encode(digest(jsonb_build_object('type','detect_sentence_terms','targetType','sentence','targetId',s.id,'japanese',s.japanese,'portuguese',s.portuguese,'kana',s.kana,'romaji',s.romaji,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'), 'hex') AS input_hash,
        'detect_sentence_terms:sentence:' || s.id || ':' || encode(digest(jsonb_build_object('type','detect_sentence_terms','targetType','sentence','targetId',s.id,'japanese',s.japanese,'portuguese',s.portuguese,'kana',s.kana,'romaji',s.romaji,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'), 'hex') AS job_key,
        p_prompt_version AS prompt_version,
        p_model AS model_version,
        p_model AS model,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'kana', s.kana, 'romaji', s.romaji, 'sourceId', p_source_id) AS payload,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'kana', s.kana, 'romaji', s.romaji, 'sourceId', p_source_id) AS input,
        3 AS max_attempts
      FROM sentences s
      WHERE s.source_id = p_source_id AND s.user_id = p_user_id AND s.status <> 'reviewed' AND s.portuguese IS NOT NULL AND s.kana IS NOT NULL AND s.romaji IS NOT NULL AND s.terms_source IS NULL
      ORDER BY s.order_index
    ) job_payload;
  END IF;

  created_count := public.enqueue_ai_jobs_bulk(job_rows);

  UPDATE processing_run_stages
  SET planned_jobs = created_count, status = CASE WHEN created_count = 0 THEN 'completed' ELSE 'running' END, updated_at = NOW()
  WHERE id = selected_stage_id;

  UPDATE processing_runs
  SET status = CASE WHEN created_count = 0 THEN 'completed' ELSE 'running' END,
      current_step = selected_stage || ': ' || created_count || ' job(s) individuais planejados pelo banco.',
      planned_jobs = planned_jobs + created_count,
      pending_jobs = pending_jobs + created_count,
      created_jobs = created_jobs + created_count,
      finished_at = CASE WHEN created_count = 0 THEN NOW() ELSE NULL END,
      updated_at = NOW()
  WHERE id = selected_run.id;

  RETURN jsonb_build_object('run_id', selected_run.id, 'stage_id', selected_stage_id, 'stage', selected_stage, 'created_jobs', created_count, 'status', CASE WHEN created_count = 0 THEN 'completed' ELSE 'running' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_dictionary_enrichment_jobs(
  p_entry_ids UUID[],
  p_user_id TEXT,
  p_model TEXT DEFAULT 'gemini-2.5-flash-lite',
  p_prompt_version TEXT DEFAULT 'dictionary-worker:2026-06-v1'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  job_rows JSONB;
  created_count INTEGER := 0;
BEGIN
  IF p_entry_ids IS NULL OR array_length(p_entry_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(job_payload)::jsonb), '[]'::jsonb) INTO job_rows
  FROM (
    WITH eligible AS (
      SELECT
        e.id,
        e.user_id,
        e.lemma,
        e.kana,
        e.romaji,
        e.type,
        e.main_meaning,
        jsonb_build_object('id', e.id, 'entryId', e.id, 'lemma', e.lemma, 'kana', e.kana, 'romaji', e.romaji, 'type', e.type) AS payload
      FROM dictionary_entries e
      WHERE e.user_id = p_user_id
        AND e.id = ANY(p_entry_ids)
        AND e.status <> 'reviewed'
        AND (e.main_meaning IS NULL OR e.kana IS NULL OR e.romaji IS NULL OR e.type IS NULL OR e.status = 'pending')
    ),
    hashed AS (
      SELECT
        *,
        encode(digest(jsonb_build_object(
          'targetType', 'dictionary_entry',
          'targetId', id,
          'payload', payload,
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'), 'hex') AS target_hash
      FROM eligible
    ),
    final_rows AS (
      SELECT
        user_id,
        NULL::UUID AS run_id,
        NULL::UUID AS stage_id,
        'dictionary'::TEXT AS stage,
        'enrich_dictionary_entry'::TEXT AS type,
        'dictionary_entry'::TEXT AS target_type,
        id AS target_id,
        100 AS priority,
        target_hash,
        encode(digest(jsonb_build_object(
          'type', 'enrich_dictionary_entry',
          'targetType', 'dictionary_entry',
          'targetId', id,
          'lemma', lemma,
          'kana', kana,
          'romaji', romaji,
          'entryType', type,
          'mainMeaning', main_meaning,
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'), 'hex') AS input_hash,
        payload
      FROM hashed
    )
    SELECT
      user_id,
      run_id,
      stage_id,
      stage,
      type,
      target_type,
      target_id,
      priority,
      target_hash,
      input_hash,
      type || ':' || target_type || ':' || target_id || ':' || input_hash AS job_key,
      p_prompt_version AS prompt_version,
      p_model AS model_version,
      p_model AS model,
      payload,
      payload AS input,
      3 AS max_attempts
    FROM final_rows
  ) job_payload;

  created_count := public.enqueue_ai_jobs_bulk(job_rows);
  RETURN created_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_sentence_ai_job(
  p_sentence_id UUID,
  p_user_id TEXT,
  p_type TEXT,
  p_model TEXT DEFAULT 'gemini-2.5-flash-lite',
  p_prompt_version TEXT DEFAULT 'manual-sentence-worker:2026-06-v1'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  selected_sentence sentences;
  job_rows JSONB;
  created_count INTEGER := 0;
  selected_job ai_jobs;
  payload JSONB;
  target_hash_value TEXT;
  input_hash_value TEXT;
  stage_value TEXT;
  priority_value INTEGER;
BEGIN
  IF p_type NOT IN ('translate_sentence', 'generate_sentence_reading') THEN
    RAISE EXCEPTION 'Tipo de job manual de frase nao permitido: %', p_type;
  END IF;

  SELECT * INTO selected_sentence
  FROM sentences
  WHERE id = p_sentence_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Frase nao encontrada para usuario.';
  END IF;

  IF selected_sentence.status = 'reviewed' THEN
    RETURN jsonb_build_object('created_jobs', 0, 'job_id', NULL, 'status', 'reviewed');
  END IF;

  IF p_type = 'translate_sentence' THEN
    stage_value := 'translation';
    priority_value := 300;
    payload := jsonb_build_object(
      'id', selected_sentence.id,
      'sentence', selected_sentence.japanese,
      'japanese', selected_sentence.japanese,
      'sourceId', selected_sentence.source_id
    );
    target_hash_value := encode(digest(jsonb_build_object(
      'targetType', 'sentence',
      'targetId', selected_sentence.id,
      'payload', payload,
      'promptVersion', p_prompt_version,
      'model', p_model
    )::text, 'sha256'), 'hex');
    input_hash_value := encode(digest(jsonb_build_object(
      'type', p_type,
      'targetType', 'sentence',
      'targetId', selected_sentence.id,
      'japanese', selected_sentence.japanese,
      'promptVersion', p_prompt_version,
      'model', p_model
    )::text, 'sha256'), 'hex');
  ELSE
    stage_value := 'reading';
    priority_value := 200;
    payload := jsonb_build_object(
      'id', selected_sentence.id,
      'sentence', selected_sentence.japanese,
      'japanese', selected_sentence.japanese,
      'portuguese', selected_sentence.portuguese,
      'sourceId', selected_sentence.source_id
    );
    target_hash_value := encode(digest(jsonb_build_object(
      'targetType', 'sentence',
      'targetId', selected_sentence.id,
      'payload', payload,
      'promptVersion', p_prompt_version,
      'model', p_model
    )::text, 'sha256'), 'hex');
    input_hash_value := encode(digest(jsonb_build_object(
      'type', p_type,
      'targetType', 'sentence',
      'targetId', selected_sentence.id,
      'japanese', selected_sentence.japanese,
      'portuguese', selected_sentence.portuguese,
      'promptVersion', p_prompt_version,
      'model', p_model
    )::text, 'sha256'), 'hex');
  END IF;

  job_rows := jsonb_build_array(jsonb_build_object(
    'user_id', p_user_id,
    'run_id', NULL,
    'stage_id', NULL,
    'stage', stage_value,
    'type', p_type,
    'target_type', 'sentence',
    'target_id', selected_sentence.id,
    'priority', priority_value,
    'target_hash', target_hash_value,
    'input_hash', input_hash_value,
    'job_key', p_type || ':sentence:' || selected_sentence.id || ':' || input_hash_value,
    'prompt_version', p_prompt_version,
    'model_version', p_model,
    'model', p_model,
    'payload', payload,
    'input', payload,
    'max_attempts', 3
  ));

  created_count := public.enqueue_ai_jobs_bulk(job_rows);

  SELECT * INTO selected_job
  FROM ai_jobs
  WHERE user_id = p_user_id
    AND type = p_type
    AND target_type = 'sentence'
    AND target_id = selected_sentence.id
    AND input_hash = input_hash_value
    AND status IN ('pending','claimed','running','retry_wait','needs_review')
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'created_jobs', created_count,
    'job_id', selected_job.id,
    'status', COALESCE(selected_job.status::TEXT, 'already_terminal')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_claimed_ai_job(p_job_id UUID, p_worker_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE ai_jobs
  SET
    status = 'pending',
    claimed_at = NULL,
    locked_by = NULL,
    worker_id = NULL,
    locked_until = NULL,
    lease_expires_at = NULL,
    last_heartbeat_at = NULL
  WHERE id = p_job_id
    AND worker_id = p_worker_id
    AND status = 'claimed';
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_ai_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE ai_jobs
  SET
    last_heartbeat_at = NOW(),
    locked_until = NOW() + make_interval(secs => p_lease_seconds),
    lease_expires_at = NOW() + make_interval(secs => p_lease_seconds)
  WHERE id = p_job_id
    AND worker_id = p_worker_id
    AND status IN ('claimed','running');

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
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
    planned_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id), 0),
    pending_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'pending'), 0),
    processed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status IN ('completed','failed','needs_review','cancelled','obsolete')), 0),
    completed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'completed'), 0),
    retry_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'retry_wait'), 0),
    review_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'needs_review'), 0),
    cancelled_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'cancelled'), 0),
    obsolete_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'obsolete'), 0),
    failed_items = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE run_id = p_run_id AND status = 'failed'), 0),
    updated_at = NOW()
  WHERE pr.id = p_run_id;
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
  UPDATE ai_jobs
  SET status = 'cancelled',
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
    AND status IN ('pending','claimed','retry_wait','needs_review');

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  UPDATE ai_jobs
  SET cancel_requested = TRUE,
      logs = COALESCE(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', NOW(), 'event', 'cancel_requested')),
      updated_at = NOW()
  WHERE run_id = p_run_id
    AND user_id = p_user_id
    AND status = 'running';

  UPDATE processing_run_stages
  SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM ai_jobs
          WHERE stage_id = processing_run_stages.id
            AND status = 'running'
            AND cancel_requested = TRUE
        ) THEN status
        ELSE 'cancelled'
      END,
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
      status = CASE
        WHEN EXISTS (SELECT 1 FROM ai_jobs WHERE run_id = p_run_id AND status = 'running') THEN status
        ELSE 'cancelled'
      END,
      finished_at = CASE
        WHEN EXISTS (SELECT 1 FROM ai_jobs WHERE run_id = p_run_id AND status = 'running') THEN finished_at
        ELSE NOW()
      END,
      current_step = 'Cancelamento solicitado pelo usuario.',
      updated_at = NOW()
  WHERE id = p_run_id AND user_id = p_user_id;

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
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO run_ids
  FROM processing_runs
  WHERE source_id = p_source_id AND user_id = p_user_id;

  UPDATE ai_jobs
  SET status = 'cancelled',
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
    AND status IN ('pending','claimed','retry_wait','needs_review')
    AND (
      run_id = ANY(run_ids)
      OR target_id = p_source_id
      OR input->>'sourceId' = p_source_id::TEXT
      OR payload->>'sourceId' = p_source_id::TEXT
    );

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  UPDATE ai_jobs
  SET cancel_requested = TRUE,
      logs = COALESCE(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', NOW(), 'event', 'cancel_requested')),
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status = 'running'
    AND (
      run_id = ANY(run_ids)
      OR target_id = p_source_id
      OR input->>'sourceId' = p_source_id::TEXT
      OR payload->>'sourceId' = p_source_id::TEXT
    );

  UPDATE processing_runs
  SET cancel_requested = TRUE,
      status = CASE
        WHEN EXISTS (SELECT 1 FROM ai_jobs WHERE run_id = processing_runs.id AND status = 'running') THEN status
        ELSE 'cancelled'
      END,
      finished_at = CASE
        WHEN EXISTS (SELECT 1 FROM ai_jobs WHERE run_id = processing_runs.id AND status = 'running') THEN finished_at
        ELSE NOW()
      END,
      current_step = 'Cancelamento solicitado pelo usuario.',
      updated_at = NOW()
  WHERE id = ANY(run_ids) AND user_id = p_user_id;

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
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO run_ids
  FROM processing_runs
  WHERE user_id = p_user_id
    AND status IN ('pending','planning','running','paused','needs_review');

  UPDATE ai_jobs
  SET status = 'cancelled',
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
    AND status IN ('pending','claimed','retry_wait','needs_review');

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  UPDATE ai_jobs
  SET cancel_requested = TRUE,
      logs = COALESCE(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', NOW(), 'event', 'cancel_requested')),
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status = 'running';

  UPDATE processing_runs
  SET cancel_requested = TRUE,
      status = CASE
        WHEN EXISTS (SELECT 1 FROM ai_jobs WHERE run_id = processing_runs.id AND status = 'running') THEN status
        ELSE 'cancelled'
      END,
      finished_at = CASE
        WHEN EXISTS (SELECT 1 FROM ai_jobs WHERE run_id = processing_runs.id AND status = 'running') THEN finished_at
        ELSE NOW()
      END,
      current_step = 'Cancelamento global solicitado pelo usuario.',
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status IN ('pending','planning','running','paused','needs_review');

  PERFORM refresh_processing_run_snapshot(ids.run_id)
  FROM unnest(run_ids) AS ids(run_id);

  RETURN cancelled_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ai_job(
  p_job_id UUID,
  p_user_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_run_id UUID;
BEGIN
  SELECT run_id INTO current_run_id
  FROM ai_jobs
  WHERE id = p_job_id AND user_id = p_user_id;

  UPDATE ai_jobs
  SET status = 'cancelled',
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
  WHERE id = p_job_id
    AND user_id = p_user_id
    AND status IN ('pending','claimed','retry_wait','needs_review','failed','error');

  IF NOT FOUND THEN
    UPDATE ai_jobs
    SET cancel_requested = TRUE,
        logs = COALESCE(logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', NOW(), 'event', 'cancel_requested')),
        updated_at = NOW()
    WHERE id = p_job_id
      AND user_id = p_user_id
      AND status = 'running';
  END IF;

  IF current_run_id IS NOT NULL THEN
    PERFORM refresh_processing_run_snapshot(current_run_id);
  END IF;

  RETURN TRUE;
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
BEGIN
  SELECT COALESCE(array_agg(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL), ARRAY[]::UUID[]) INTO run_ids
  FROM ai_jobs
  WHERE user_id = p_user_id
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

  UPDATE ai_jobs
  SET status = 'pending',
      error = NULL,
      error_code = NULL,
      error_kind = NULL,
      error_structured = NULL,
      attempts = 0,
      retry_count = 0,
      retry_at = NULL,
      claimed_at = NULL,
      started_at = NULL,
      completed_at = NULL,
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      cancel_requested = FALSE,
      last_heartbeat_at = NULL,
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND status IN ('error','failed','retry_wait','needs_review')
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

  GET DIAGNOSTICS retried_count = ROW_COUNT;

  PERFORM refresh_processing_run_snapshot(ids.run_id)
  FROM unnest(run_ids) AS ids(run_id);

  RETURN retried_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_claimed_ai_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER
)
RETURNS ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated_job ai_jobs;
BEGIN
  UPDATE ai_jobs
  SET
    status = 'running',
    attempts = attempts + 1,
    started_at = COALESCE(started_at, NOW()),
    locked_until = NOW() + make_interval(secs => p_lease_seconds),
    lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
    last_heartbeat_at = NOW()
  WHERE id = p_job_id
    AND worker_id = p_worker_id
    AND status = 'claimed'
  RETURNING * INTO updated_job;

  IF updated_job.id IS NULL THEN
    RAISE EXCEPTION 'Job % is not claimed by worker %', p_job_id, p_worker_id;
  END IF;

  INSERT INTO ai_job_attempts(job_id, run_id, user_id, worker_id, attempt_number, model, prompt_version, status)
  VALUES (updated_job.id, updated_job.run_id, updated_job.user_id, p_worker_id, updated_job.attempts, updated_job.model, updated_job.prompt_version, 'running');

  RETURN updated_job;
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
BEGIN
  SELECT attempts, stage_id, run_id INTO current_attempt, current_stage_id, current_run_id
  FROM ai_jobs
  WHERE id = p_job_id
    AND worker_id = p_worker_id
    AND status = 'running'
  FOR UPDATE;

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
        WHEN NOT EXISTS (
          SELECT 1 FROM ai_jobs
          WHERE stage_id = current_stage_id
            AND status IN ('pending','claimed','running','retry_wait')
        ) THEN 'completed'
        ELSE status
      END,
      completed_at = CASE
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
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sentence_translation_result(
  p_job_id UUID,
  p_worker_id TEXT,
  p_translation TEXT,
  p_result JSONB,
  p_raw_result JSONB,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_cost_actual NUMERIC DEFAULT NULL,
  p_latency_ai_ms INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_job ai_jobs;
  current_sentence sentences;
  normalized_translation TEXT;
  next_status TEXT;
BEGIN
  SELECT * INTO current_job
  FROM ai_jobs
  WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'running'
  FOR UPDATE;

  IF current_job.id IS NULL THEN
    RAISE EXCEPTION 'Job % is not running for worker %', p_job_id, p_worker_id;
  END IF;
  IF current_job.cancel_requested THEN
    RAISE EXCEPTION 'Job cancelado durante o processamento.';
  END IF;

  SELECT * INTO current_sentence
  FROM sentences
  WHERE id = current_job.target_id AND user_id = current_job.user_id
  FOR UPDATE;

  IF current_sentence.id IS NULL THEN
    RAISE EXCEPTION 'Frase nao encontrada para traducao.';
  END IF;
  IF current_sentence.status = 'reviewed' THEN
    PERFORM complete_ai_job(
      p_job_id,
      p_worker_id,
      jsonb_build_object('optimization', 'already_reviewed', 'sentence_id', current_sentence.id),
      p_raw_result,
      p_input_tokens,
      p_output_tokens,
      p_cost_actual,
      p_latency_ai_ms,
      NULL
    );
    RETURN jsonb_build_object('skipped', 'reviewed', 'sentence_id', current_sentence.id);
  END IF;
  IF current_job.payload ? 'sentence' AND current_job.payload->>'sentence' <> current_sentence.japanese THEN
    UPDATE ai_jobs
    SET status = 'obsolete',
        error = 'A frase mudou depois da criacao do job.',
        error_code = 'OBSOLETE_INPUT',
        error_kind = 'permanent',
        locked_by = NULL,
        locked_until = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        completed_at = NOW()
    WHERE id = p_job_id;
    RETURN jsonb_build_object('obsolete', true, 'sentence_id', current_sentence.id);
  END IF;

  normalized_translation := NULLIF(BTRIM(p_translation), '');
  IF normalized_translation IS NULL THEN
    RAISE EXCEPTION 'Resultado invalido: traducao ausente.';
  END IF;
  IF normalized_translation = current_sentence.japanese THEN
    normalized_translation := 'Expressao japonesa sem traducao literal direta: ' || current_sentence.japanese || '.';
  END IF;

  next_status := CASE WHEN current_sentence.kana IS NOT NULL AND current_sentence.romaji IS NOT NULL THEN 'reading_ready' ELSE 'translated' END;

  UPDATE sentences
  SET portuguese = normalized_translation,
      status = next_status,
      translation_source = 'ai_worker',
      updated_at = NOW()
  WHERE id = current_sentence.id AND user_id = current_sentence.user_id;

  IF current_sentence.japanese_key IS NOT NULL THEN
    UPDATE sentences
    SET portuguese = normalized_translation,
        status = CASE WHEN kana IS NOT NULL AND romaji IS NOT NULL THEN 'reading_ready' ELSE 'translated' END,
        translation_source = 'cache',
        updated_at = NOW()
    WHERE source_id = current_sentence.source_id
      AND user_id = current_sentence.user_id
      AND japanese_key = current_sentence.japanese_key
      AND portuguese IS NULL
      AND status <> 'reviewed';
  END IF;

  PERFORM complete_ai_job(
    p_job_id,
    p_worker_id,
    COALESCE(p_result, jsonb_build_object('translation', normalized_translation, 'sentence_id', current_sentence.id)),
    p_raw_result,
    p_input_tokens,
    p_output_tokens,
    p_cost_actual,
    p_latency_ai_ms,
    NULL
  );

  RETURN jsonb_build_object('translation', normalized_translation, 'sentence_id', current_sentence.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sentence_reading_result(
  p_job_id UUID,
  p_worker_id TEXT,
  p_kana TEXT,
  p_romaji TEXT,
  p_result JSONB,
  p_raw_result JSONB,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_cost_actual NUMERIC DEFAULT NULL,
  p_latency_ai_ms INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_job ai_jobs;
  current_sentence sentences;
  normalized_kana TEXT;
  normalized_romaji TEXT;
  next_status TEXT;
BEGIN
  SELECT * INTO current_job
  FROM ai_jobs
  WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'running'
  FOR UPDATE;

  IF current_job.id IS NULL THEN
    RAISE EXCEPTION 'Job % is not running for worker %', p_job_id, p_worker_id;
  END IF;
  IF current_job.cancel_requested THEN
    RAISE EXCEPTION 'Job cancelado durante o processamento.';
  END IF;

  SELECT * INTO current_sentence
  FROM sentences
  WHERE id = current_job.target_id AND user_id = current_job.user_id
  FOR UPDATE;

  IF current_sentence.id IS NULL THEN
    RAISE EXCEPTION 'Frase nao encontrada para leitura.';
  END IF;
  IF current_sentence.status = 'reviewed' THEN
    PERFORM complete_ai_job(
      p_job_id,
      p_worker_id,
      jsonb_build_object('optimization', 'already_reviewed', 'sentence_id', current_sentence.id),
      p_raw_result,
      p_input_tokens,
      p_output_tokens,
      p_cost_actual,
      p_latency_ai_ms,
      NULL
    );
    RETURN jsonb_build_object('skipped', 'reviewed', 'sentence_id', current_sentence.id);
  END IF;
  IF current_job.payload ? 'sentence' AND current_job.payload->>'sentence' <> current_sentence.japanese THEN
    UPDATE ai_jobs
    SET status = 'obsolete',
        error = 'A frase mudou depois da criacao do job.',
        error_code = 'OBSOLETE_INPUT',
        error_kind = 'permanent',
        locked_by = NULL,
        locked_until = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        completed_at = NOW()
    WHERE id = p_job_id;
    RETURN jsonb_build_object('obsolete', true, 'sentence_id', current_sentence.id);
  END IF;

  normalized_kana := NULLIF(BTRIM(p_kana), '');
  normalized_romaji := LOWER(REGEXP_REPLACE(BTRIM(COALESCE(p_romaji, '')), '[[:space:]]+', ' ', 'g'));
  IF normalized_kana IS NULL OR normalized_romaji IS NULL OR normalized_romaji = '' THEN
    RAISE EXCEPTION 'Resultado invalido: kana ou romaji ausente.';
  END IF;

  next_status := CASE WHEN current_sentence.portuguese IS NOT NULL THEN 'reading_ready' ELSE current_sentence.status END;

  UPDATE sentences
  SET kana = normalized_kana,
      romaji = normalized_romaji,
      status = next_status,
      reading_source = 'ai_worker',
      updated_at = NOW()
  WHERE id = current_sentence.id AND user_id = current_sentence.user_id;

  PERFORM complete_ai_job(
    p_job_id,
    p_worker_id,
    COALESCE(p_result, jsonb_build_object('kana', normalized_kana, 'romaji', normalized_romaji, 'sentence_id', current_sentence.id)),
    p_raw_result,
    p_input_tokens,
    p_output_tokens,
    p_cost_actual,
    p_latency_ai_ms,
    NULL
  );

  RETURN jsonb_build_object('kana', normalized_kana, 'romaji', normalized_romaji, 'status', next_status, 'sentence_id', current_sentence.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sentence_lexical_analysis_result(
  p_job_id UUID,
  p_worker_id TEXT,
  p_kana TEXT,
  p_romaji TEXT,
  p_terms JSONB,
  p_result JSONB,
  p_raw_result JSONB,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_cost_actual NUMERIC DEFAULT NULL,
  p_latency_ai_ms INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_job ai_jobs;
  current_sentence sentences;
  normalized_kana TEXT;
  normalized_romaji TEXT;
  inserted_terms INTEGER := 0;
  inserted_entries INTEGER := 0;
  inserted_forms INTEGER := 0;
  inserted_senses INTEGER := 0;
BEGIN
  SELECT * INTO current_job
  FROM ai_jobs
  WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'running'
  FOR UPDATE;

  IF current_job.id IS NULL THEN
    RAISE EXCEPTION 'Job % is not running for worker %', p_job_id, p_worker_id;
  END IF;
  IF current_job.cancel_requested THEN
    RAISE EXCEPTION 'Job cancelado durante o processamento.';
  END IF;

  SELECT * INTO current_sentence
  FROM sentences
  WHERE id = current_job.target_id AND user_id = current_job.user_id
  FOR UPDATE;

  IF current_sentence.id IS NULL THEN
    RAISE EXCEPTION 'Frase nao encontrada para analise lexical.';
  END IF;
  IF current_sentence.status = 'reviewed' THEN
    PERFORM complete_ai_job(
      p_job_id,
      p_worker_id,
      jsonb_build_object('optimization', 'already_reviewed', 'sentence_id', current_sentence.id),
      p_raw_result,
      p_input_tokens,
      p_output_tokens,
      p_cost_actual,
      p_latency_ai_ms,
      NULL
    );
    RETURN jsonb_build_object('skipped', 'reviewed', 'sentence_id', current_sentence.id);
  END IF;
  IF current_job.payload ? 'sentence' AND current_job.payload->>'sentence' <> current_sentence.japanese THEN
    UPDATE ai_jobs
    SET status = 'obsolete',
        error = 'A frase mudou depois da criacao do job.',
        error_code = 'OBSOLETE_INPUT',
        error_kind = 'permanent',
        locked_by = NULL,
        locked_until = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        completed_at = NOW()
    WHERE id = p_job_id;
    RETURN jsonb_build_object('obsolete', true, 'sentence_id', current_sentence.id);
  END IF;

  normalized_kana := NULLIF(BTRIM(COALESCE(p_kana, current_sentence.kana, '')), '');
  normalized_romaji := LOWER(REGEXP_REPLACE(BTRIM(COALESCE(p_romaji, current_sentence.romaji, '')), '[[:space:]]+', ' ', 'g'));

  IF normalized_kana IS NOT NULL AND normalized_romaji IS NOT NULL AND normalized_romaji <> '' THEN
    UPDATE sentences
    SET kana = COALESCE(kana, normalized_kana),
        romaji = COALESCE(romaji, normalized_romaji),
        status = CASE WHEN portuguese IS NOT NULL THEN 'reading_ready' ELSE status END,
        reading_source = COALESCE(reading_source, 'ai_worker'),
        updated_at = NOW()
    WHERE id = current_sentence.id AND user_id = current_sentence.user_id;
  END IF;

  DROP TABLE IF EXISTS tmp_lexical_terms;
  CREATE TEMP TABLE tmp_lexical_terms ON COMMIT DROP AS
  SELECT DISTINCT ON (surface, lemma, start_index, end_index)
    BTRIM(surface) AS surface,
    BTRIM(COALESCE(NULLIF(lemma, ''), surface)) AS lemma,
    BTRIM(COALESCE(NULLIF(term_type, ''), NULLIF(type, ''), 'outro')) AS term_type,
    NULLIF(BTRIM(COALESCE(entry_kana, kana, '')), '') AS entry_kana,
    NULLIF(BTRIM(COALESCE(entry_romaji, romaji, '')), '') AS entry_romaji,
    NULLIF(BTRIM(COALESCE(form_kana, kana, '')), '') AS form_kana,
    NULLIF(BTRIM(COALESCE(form_romaji, romaji, '')), '') AS form_romaji,
    BTRIM(COALESCE(NULLIF(form_type, ''), 'forma encontrada')) AS form_type,
    NULLIF(BTRIM(COALESCE(grammar_note, '')), '') AS grammar_note,
    NULLIF(BTRIM(COALESCE(meaning, context_meaning, '')), '') AS meaning,
    start_index,
    end_index,
    COALESCE(confidence, 1) AS confidence,
    LOWER(REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(lemma, ''), surface)), '[[:space:]]+', '', 'g')) || '|' ||
      LOWER(REGEXP_REPLACE(BTRIM(COALESCE(entry_kana, kana, '')), '[[:space:]]+', '', 'g')) || '|' ||
      LOWER(REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(term_type, ''), 'outro')), '[[:space:]]+', '', 'g')) AS entry_key
  FROM jsonb_to_recordset(COALESCE(p_terms, '[]'::jsonb)) AS t(
    surface TEXT,
    lemma TEXT,
    term_type TEXT,
    type TEXT,
    kana TEXT,
    romaji TEXT,
    entry_kana TEXT,
    entry_romaji TEXT,
    form_kana TEXT,
    form_romaji TEXT,
    form_type TEXT,
    grammar_note TEXT,
    meaning TEXT,
    context_meaning TEXT,
    start_index INTEGER,
    end_index INTEGER,
    confidence FLOAT
  )
  WHERE BTRIM(COALESCE(surface, '')) <> ''
    AND start_index IS NOT NULL
    AND end_index IS NOT NULL
    AND end_index > start_index;

  WITH entry_rows AS (
    SELECT DISTINCT
      current_sentence.user_id AS user_id,
      lemma,
      entry_kana AS kana,
      entry_romaji AS romaji,
      term_type AS type,
      NULL::TEXT AS jlpt_level,
      'pending'::TEXT AS status,
      ARRAY[]::TEXT[] AS tags,
      entry_key AS unique_key,
      MIN(meaning) AS main_meaning,
      NOW() AS updated_at
    FROM tmp_lexical_terms
    GROUP BY lemma, entry_kana, entry_romaji, term_type, entry_key
  ),
  inserted AS (
    INSERT INTO dictionary_entries(user_id, lemma, kana, romaji, type, jlpt_level, status, tags, unique_key, main_meaning, updated_at)
    SELECT user_id, lemma, kana, romaji, type, jlpt_level, status, tags, unique_key, main_meaning, updated_at
    FROM entry_rows
    ON CONFLICT (user_id, unique_key) DO UPDATE
      SET main_meaning = COALESCE(dictionary_entries.main_meaning, EXCLUDED.main_meaning),
          updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_entries FROM inserted;

  DROP TABLE IF EXISTS tmp_entries;
  CREATE TEMP TABLE tmp_entries ON COMMIT DROP AS
  SELECT d.id, d.unique_key
  FROM dictionary_entries d
  WHERE d.user_id = current_sentence.user_id
    AND d.unique_key IN (SELECT entry_key FROM tmp_lexical_terms);

  WITH form_rows AS (
    SELECT DISTINCT
      current_sentence.user_id AS user_id,
      e.id AS dictionary_entry_id,
      t.surface AS form,
      t.form_kana AS kana,
      t.form_romaji AS romaji,
      t.form_type,
      t.grammar_note,
      (t.surface = t.lemma) AS is_common,
      'detected'::TEXT AS status,
      e.id::TEXT || '|' || LOWER(REGEXP_REPLACE(t.surface, '[[:space:]]+', '', 'g')) || '|' || LOWER(REGEXP_REPLACE(t.form_type, '[[:space:]]+', '', 'g')) AS unique_key,
      NOW() AS updated_at
    FROM tmp_lexical_terms t
    JOIN tmp_entries e ON e.unique_key = t.entry_key
  ),
  inserted AS (
    INSERT INTO dictionary_forms(user_id, dictionary_entry_id, form, kana, romaji, form_type, grammar_note, is_common, status, unique_key, updated_at)
    SELECT user_id, dictionary_entry_id, form, kana, romaji, form_type, grammar_note, is_common, status, unique_key, updated_at
    FROM form_rows
    ON CONFLICT (user_id, unique_key) DO UPDATE
      SET kana = COALESCE(dictionary_forms.kana, EXCLUDED.kana),
          romaji = COALESCE(dictionary_forms.romaji, EXCLUDED.romaji),
          grammar_note = COALESCE(dictionary_forms.grammar_note, EXCLUDED.grammar_note),
          updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_forms FROM inserted;

  DROP TABLE IF EXISTS tmp_forms;
  CREATE TEMP TABLE tmp_forms ON COMMIT DROP AS
  SELECT f.id, f.dictionary_entry_id, f.form, f.unique_key
  FROM dictionary_forms f
  WHERE f.user_id = current_sentence.user_id
    AND f.unique_key IN (
      SELECT e.id::TEXT || '|' || LOWER(REGEXP_REPLACE(t.surface, '[[:space:]]+', '', 'g')) || '|' || LOWER(REGEXP_REPLACE(t.form_type, '[[:space:]]+', '', 'g'))
      FROM tmp_lexical_terms t
      JOIN tmp_entries e ON e.unique_key = t.entry_key
    );

  WITH sense_rows AS (
    SELECT DISTINCT
      current_sentence.user_id AS user_id,
      e.id AS dictionary_entry_id,
      t.meaning,
      'contextual'::TEXT AS meaning_type,
      NULL::TEXT AS explanation,
      1 AS sense_order,
      'ai_generated'::TEXT AS status,
      NOW() AS updated_at
    FROM tmp_lexical_terms t
    JOIN tmp_entries e ON e.unique_key = t.entry_key
    WHERE t.meaning IS NOT NULL
  ),
  inserted AS (
    INSERT INTO dictionary_senses(user_id, dictionary_entry_id, meaning, meaning_type, explanation, sense_order, status, updated_at)
    SELECT user_id, dictionary_entry_id, meaning, meaning_type, explanation, sense_order, status, updated_at
    FROM sense_rows
    ON CONFLICT (user_id, dictionary_entry_id, meaning) DO UPDATE
      SET updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_senses FROM inserted;

  DELETE FROM sentence_terms
  WHERE sentence_id = current_sentence.id AND user_id = current_sentence.user_id;

  WITH term_rows AS (
    SELECT
      current_sentence.user_id AS user_id,
      current_sentence.id AS sentence_id,
      f.id AS dictionary_form_id,
      ds.id AS dictionary_sense_id,
      t.surface,
      t.start_index,
      t.end_index,
      t.confidence,
      'detected'::TEXT AS status,
      NOW() AS updated_at
    FROM tmp_lexical_terms t
    JOIN tmp_entries e ON e.unique_key = t.entry_key
    JOIN tmp_forms f ON f.dictionary_entry_id = e.id AND f.form = t.surface
    LEFT JOIN dictionary_senses ds
      ON ds.user_id = current_sentence.user_id
      AND ds.dictionary_entry_id = e.id
      AND ds.meaning = t.meaning
  ),
  inserted AS (
    INSERT INTO sentence_terms(user_id, sentence_id, dictionary_form_id, dictionary_sense_id, surface, start_index, end_index, confidence, status, updated_at)
    SELECT user_id, sentence_id, dictionary_form_id, dictionary_sense_id, surface, start_index, end_index, confidence, status, updated_at
    FROM term_rows
    ON CONFLICT (sentence_id, start_index, end_index, dictionary_form_id) DO UPDATE
      SET dictionary_sense_id = EXCLUDED.dictionary_sense_id,
          confidence = EXCLUDED.confidence,
          status = EXCLUDED.status,
          updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_terms FROM inserted;

  UPDATE sentences
  SET terms_source = CASE WHEN inserted_terms > 0 THEN 'ai' ELSE 'ai_empty' END,
      updated_at = NOW()
  WHERE id = current_sentence.id AND user_id = current_sentence.user_id AND status <> 'reviewed';

  PERFORM complete_ai_job(
    p_job_id,
    p_worker_id,
    COALESCE(p_result, '{}'::jsonb) || jsonb_build_object(
      'sentence_id', current_sentence.id,
      'termCount', inserted_terms,
      'entryCount', inserted_entries,
      'formCount', inserted_forms,
      'senseCount', inserted_senses
    ),
    p_raw_result,
    p_input_tokens,
    p_output_tokens,
    p_cost_actual,
    p_latency_ai_ms,
    NULL
  );

  RETURN jsonb_build_object(
    'sentence_id', current_sentence.id,
    'termCount', inserted_terms,
    'entryCount', inserted_entries,
    'formCount', inserted_forms,
    'senseCount', inserted_senses
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_dictionary_enrichment_result(
  p_job_id UUID,
  p_worker_id TEXT,
  p_enrichment JSONB,
  p_result JSONB,
  p_raw_result JSONB,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_cost_actual NUMERIC DEFAULT NULL,
  p_latency_ai_ms INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_job ai_jobs;
  current_entry dictionary_entries;
  v_main_meaning TEXT;
  v_final_type TEXT;
  v_final_kana TEXT;
  v_final_romaji TEXT;
  v_final_unique_key TEXT;
  meaning_count INTEGER := 0;
BEGIN
  SELECT * INTO current_job
  FROM ai_jobs
  WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'running'
  FOR UPDATE;

  IF current_job.id IS NULL THEN
    RAISE EXCEPTION 'Job % is not running for worker %', p_job_id, p_worker_id;
  END IF;
  IF current_job.cancel_requested THEN
    RAISE EXCEPTION 'Job cancelado durante o processamento.';
  END IF;

  SELECT * INTO current_entry
  FROM dictionary_entries
  WHERE id = current_job.target_id AND user_id = current_job.user_id
  FOR UPDATE;

  IF current_entry.id IS NULL THEN
    RAISE EXCEPTION 'Verbete nao encontrado para enriquecimento.';
  END IF;
  IF current_entry.status = 'reviewed' THEN
    PERFORM complete_ai_job(
      p_job_id,
      p_worker_id,
      jsonb_build_object('optimization', 'already_reviewed', 'entry_id', current_entry.id),
      p_raw_result,
      p_input_tokens,
      p_output_tokens,
      p_cost_actual,
      p_latency_ai_ms,
      NULL
    );
    RETURN jsonb_build_object('skipped', 'reviewed', 'entry_id', current_entry.id);
  END IF;
  IF current_job.payload ? 'lemma' AND current_job.payload->>'lemma' <> current_entry.lemma THEN
    UPDATE ai_jobs
    SET status = 'obsolete',
        error = 'O lemma mudou depois da criacao do job.',
        error_code = 'OBSOLETE_INPUT',
        error_kind = 'permanent',
        locked_by = NULL,
        locked_until = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        completed_at = NOW()
    WHERE id = p_job_id;
    RETURN jsonb_build_object('obsolete', true, 'entry_id', current_entry.id);
  END IF;

  v_main_meaning := COALESCE(
    NULLIF(current_entry.main_meaning, ''),
    NULLIF(p_enrichment->>'main_meaning', ''),
    NULLIF(p_enrichment->>'meaning', ''),
    NULLIF(p_enrichment #>> '{meanings,0}', '')
  );
  v_final_type := COALESCE(NULLIF(current_entry.type, ''), NULLIF(p_enrichment->>'type', ''), 'outro');
  v_final_kana := COALESCE(NULLIF(current_entry.kana, ''), NULLIF(p_enrichment->>'kana', ''));
  v_final_romaji := COALESCE(NULLIF(current_entry.romaji, ''), NULLIF(p_enrichment->>'romaji', ''));

  IF v_main_meaning IS NULL OR v_final_type IS NULL OR v_final_kana IS NULL OR v_final_romaji IS NULL THEN
    RAISE EXCEPTION 'Resultado invalido: significado, tipo, kana ou romaji ausente.';
  END IF;

  v_final_unique_key :=
    LOWER(REGEXP_REPLACE(current_entry.lemma, '[[:space:]]+', '', 'g')) || '|' ||
    LOWER(REGEXP_REPLACE(v_final_kana, '[[:space:]]+', '', 'g')) || '|' ||
    LOWER(REGEXP_REPLACE(v_final_type, '[[:space:]]+', '', 'g'));

  UPDATE dictionary_entries
  SET main_meaning = v_main_meaning,
      type = v_final_type,
      kana = v_final_kana,
      romaji = v_final_romaji,
      jlpt_level = COALESCE(dictionary_entries.jlpt_level, NULLIF(p_enrichment->>'jlpt_level', '')),
      tags = CASE
        WHEN array_length(dictionary_entries.tags, 1) IS NULL AND jsonb_typeof(p_enrichment->'tags') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_enrichment->'tags'))
        ELSE dictionary_entries.tags
      END,
      subtype = COALESCE(dictionary_entries.subtype, NULLIF(p_enrichment->>'subtype', '')),
      components = COALESCE(dictionary_entries.components, p_enrichment->'components'),
      grammar_info = COALESCE(dictionary_entries.grammar_info, NULLIF(p_enrichment->>'grammar_info', '')),
      short_note = COALESCE(dictionary_entries.short_note, NULLIF(p_enrichment->>'short_note', '')),
      status = 'ai_enriched',
      unique_key = CASE
        WHEN EXISTS (
          SELECT 1
          FROM dictionary_entries existing
          WHERE existing.user_id = current_entry.user_id
            AND existing.unique_key = v_final_unique_key
            AND existing.id <> current_entry.id
        )
        THEN dictionary_entries.unique_key
        ELSE v_final_unique_key
      END,
      updated_at = NOW()
  WHERE id = current_entry.id AND user_id = current_entry.user_id;

  WITH meanings AS (
    SELECT DISTINCT NULLIF(BTRIM(value), '') AS meaning, row_number() OVER () AS sense_order
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_enrichment->'meanings') = 'array'
        THEN p_enrichment->'meanings'
        ELSE jsonb_build_array(v_main_meaning)
      END
    ) AS value
  ),
  inserted AS (
    INSERT INTO dictionary_senses(user_id, dictionary_entry_id, meaning, meaning_type, sense_order, status, updated_at)
    SELECT current_entry.user_id, current_entry.id, meaning, CASE WHEN sense_order = 1 THEN 'principal' ELSE 'variacao' END, sense_order, 'ai_generated', NOW()
    FROM meanings
    WHERE meaning IS NOT NULL
    ON CONFLICT (user_id, dictionary_entry_id, meaning) DO UPDATE
      SET sense_order = EXCLUDED.sense_order,
          updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO meaning_count FROM inserted;

  INSERT INTO dictionary_forms(user_id, dictionary_entry_id, form, kana, romaji, form_type, is_common, status, unique_key, updated_at)
  VALUES (
    current_entry.user_id,
    current_entry.id,
    current_entry.lemma,
    v_final_kana,
    v_final_romaji,
    'forma de dicionario',
    TRUE,
    'ai_resolved',
    current_entry.id::TEXT || '|' || LOWER(REGEXP_REPLACE(current_entry.lemma, '[[:space:]]+', '', 'g')) || '|formadedicionario',
    NOW()
  )
  ON CONFLICT (user_id, unique_key) DO UPDATE
    SET kana = EXCLUDED.kana,
        romaji = EXCLUDED.romaji,
        status = EXCLUDED.status,
        updated_at = NOW();

  PERFORM complete_ai_job(
    p_job_id,
    p_worker_id,
    COALESCE(p_result, '{}'::jsonb) || jsonb_build_object('entry_id', current_entry.id, 'senseCount', meaning_count),
    p_raw_result,
    p_input_tokens,
    p_output_tokens,
    p_cost_actual,
    p_latency_ai_ms,
    NULL
  );

  RETURN jsonb_build_object('entry_id', current_entry.id, 'senseCount', meaning_count);
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

  IF p_error_kind IN ('permanent','invalid_response') AND current_attempt >= max_attempt_count THEN
    terminal_status := CASE WHEN p_error_kind = 'invalid_response' THEN 'needs_review' ELSE 'failed' END;
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
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_expired_ai_job_leases(
  p_limit INTEGER DEFAULT 250,
  p_retry_delay_seconds INTEGER DEFAULT 60
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  recovered_count INTEGER;
BEGIN
  WITH recovered AS (
    SELECT id
    FROM ai_jobs
    WHERE status IN ('claimed','running')
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < NOW()
    ORDER BY lease_expires_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE ai_jobs j
  SET
    status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retry_wait' END,
    retry_at = CASE WHEN attempts >= max_attempts THEN NULL ELSE NOW() + make_interval(secs => p_retry_delay_seconds) END,
    error = COALESCE(error, 'Lease expirada; job recuperado.'),
    error_code = COALESCE(error_code, 'LEASE_EXPIRED'),
    error_kind = COALESCE(error_kind, 'transient'),
    locked_by = NULL,
    locked_until = NULL,
    lease_expires_at = NULL,
    worker_id = NULL
  FROM recovered
  WHERE j.id = recovered.id;

  GET DIAGNOSTICS recovered_count = ROW_COUNT;
  RETURN recovered_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_queue_health() FROM public;
REVOKE ALL ON FUNCTION public.claim_ai_jobs(TEXT, TEXT[], INTEGER, INTEGER, TEXT, UUID, INTEGER, JSONB) FROM public;
REVOKE ALL ON FUNCTION public.enqueue_ai_jobs_bulk(JSONB) FROM public;
REVOKE ALL ON FUNCTION public.create_or_resume_source_processing_run(UUID, TEXT, TEXT, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.enqueue_dictionary_enrichment_jobs(UUID[], TEXT, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.enqueue_sentence_ai_job(UUID, TEXT, TEXT, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.cancel_ai_jobs_by_run(UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.cancel_ai_jobs_by_source(UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.cancel_all_ai_jobs_for_user(TEXT) FROM public;
REVOKE ALL ON FUNCTION public.cancel_ai_job(UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.retry_ai_jobs(TEXT, UUID, UUID, UUID) FROM public;
REVOKE ALL ON FUNCTION public.release_claimed_ai_job(UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.heartbeat_ai_job(UUID, TEXT, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.refresh_processing_run_snapshot(UUID) FROM public;
REVOKE ALL ON FUNCTION public.start_claimed_ai_job(UUID, TEXT, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.complete_ai_job(UUID, TEXT, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.apply_sentence_translation_result(UUID, TEXT, TEXT, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.apply_sentence_reading_result(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.apply_sentence_lexical_analysis_result(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.apply_dictionary_enrichment_result(UUID, TEXT, JSONB, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.fail_ai_job_for_retry(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM public;
REVOKE ALL ON FUNCTION public.recover_expired_ai_job_leases(INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ai_queue_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_jobs(TEXT, TEXT[], INTEGER, INTEGER, TEXT, UUID, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_ai_jobs_bulk(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_or_resume_source_processing_run(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_dictionary_enrichment_jobs(UUID[], TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_sentence_ai_job(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_ai_jobs_by_run(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_ai_jobs_by_source(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_all_ai_jobs_for_user(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_ai_job(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retry_ai_jobs(TEXT, UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_claimed_ai_job(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_ai_job(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_processing_run_snapshot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_claimed_ai_job(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ai_job(UUID, TEXT, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_sentence_translation_result(UUID, TEXT, TEXT, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_sentence_reading_result(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_sentence_lexical_analysis_result(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_dictionary_enrichment_result(UUID, TEXT, JSONB, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_ai_job_for_retry(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_expired_ai_job_leases(INTEGER, INTEGER) TO service_role;

ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_admins NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app_admins FROM anon;
REVOKE ALL ON app_admins FROM authenticated;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sources', 'sentences', 'processing_runs', 'dictionary_entries',
    'dictionary_forms', 'dictionary_senses', 'sentence_terms',
    'processing_run_stages', 'sentence_progress', 'dictionary_progress', 'ai_jobs',
    'ai_job_attempts', 'ai_model_prices', 'schema_versions',
    'study_sessions', 'study_session_items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON %I FROM anon', tbl);
    EXECUTE format('REVOKE ALL ON %I FROM authenticated', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', tbl);
    EXECUTE format('CREATE POLICY "app admin select %1$I" ON %1$I FOR SELECT TO authenticated USING (public.is_app_admin())', tbl);
    EXECUTE format('CREATE POLICY "app admin insert %1$I" ON %1$I FOR INSERT TO authenticated WITH CHECK (public.is_app_admin())', tbl);
    EXECUTE format('CREATE POLICY "app admin update %1$I" ON %1$I FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin())', tbl);
    EXECUTE format('CREATE POLICY "app admin delete %1$I" ON %1$I FOR DELETE TO authenticated USING (public.is_app_admin())', tbl);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

CREATE INDEX idx_sources_user_id ON sources(user_id);
CREATE INDEX idx_sentences_user_source ON sentences(user_id, source_id, order_index);
CREATE INDEX idx_sentences_source_status ON sentences(source_id, status, order_index);
CREATE INDEX idx_sentences_japanese_key ON sentences(user_id, japanese_key);
CREATE INDEX idx_processing_runs_source ON processing_runs(user_id, source_id, status);
CREATE INDEX idx_processing_run_stages_run ON processing_run_stages(run_id, stage, status);
CREATE INDEX idx_dictionary_entries_user_key ON dictionary_entries(user_id, unique_key);
CREATE INDEX idx_dictionary_entries_lemma ON dictionary_entries(user_id, lemma);
CREATE INDEX idx_dictionary_forms_entry ON dictionary_forms(dictionary_entry_id);
CREATE INDEX idx_dictionary_forms_form ON dictionary_forms(user_id, form);
CREATE INDEX idx_dictionary_senses_entry ON dictionary_senses(dictionary_entry_id, sense_order);
CREATE INDEX idx_sentence_terms_sentence ON sentence_terms(sentence_id, start_index);
CREATE INDEX idx_sentence_terms_form ON sentence_terms(dictionary_form_id);
CREATE INDEX idx_sentence_terms_sense ON sentence_terms(dictionary_sense_id);
CREATE INDEX idx_sentence_progress_sentence ON sentence_progress(sentence_id);
CREATE INDEX idx_dictionary_progress_entry ON dictionary_progress(dictionary_entry_id);
CREATE UNIQUE INDEX uk_ai_jobs_active_input ON ai_jobs(user_id, type, target_type, target_id, input_hash)
  WHERE status IN ('pending','claimed','running','retry_wait');
CREATE INDEX idx_ai_jobs_queue ON ai_jobs(status, type, priority DESC, created_at)
  WHERE status IN ('pending','retry_wait');
CREATE INDEX idx_ai_jobs_user_status ON ai_jobs(user_id, status, type, created_at);
CREATE INDEX idx_ai_jobs_run_status ON ai_jobs(run_id, status, type, created_at);
CREATE INDEX idx_ai_jobs_stage_status ON ai_jobs(stage_id, status, type, created_at);
CREATE INDEX idx_ai_jobs_expired_lease ON ai_jobs(status, lease_expires_at)
  WHERE status IN ('claimed','running') AND lease_expires_at IS NOT NULL;
CREATE INDEX idx_ai_jobs_target ON ai_jobs(user_id, target_type, target_id, type, status);
CREATE UNIQUE INDEX idx_ai_jobs_active_input_unique
  ON ai_jobs(user_id, type, target_type, target_id, input_hash)
  WHERE status IN ('pending','claimed','running','retry_wait','needs_review');
CREATE INDEX idx_ai_job_attempts_job ON ai_job_attempts(job_id, attempt_number);
CREATE INDEX idx_study_session_items_session ON study_session_items(study_session_id, order_index);
