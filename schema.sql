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
  p_run_id UUID DEFAULT NULL
)
RETURNS SETOF ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM ai_jobs
    WHERE
      status IN ('pending','retry_wait')
      AND type = ANY(p_job_types)
      AND (p_user_id IS NULL OR user_id = p_user_id)
      AND (p_run_id IS NULL OR run_id = p_run_id)
      AND (retry_at IS NULL OR retry_at <= NOW())
    ORDER BY priority DESC, created_at ASC
    LIMIT GREATEST(0, p_limit)
    FOR UPDATE SKIP LOCKED
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
BEGIN
  SELECT attempts INTO current_attempt
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
    duration_ms = EXTRACT(MILLISECONDS FROM (NOW() - started_at))::INTEGER,
    input_tokens = COALESCE(p_input_tokens, input_tokens),
    output_tokens = COALESCE(p_output_tokens, output_tokens),
    cost_actual = COALESCE(p_cost_actual, cost_actual)
  WHERE job_id = p_job_id AND attempt_number = current_attempt;
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
BEGIN
  SELECT attempts, max_attempts INTO current_attempt, max_attempt_count
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
    duration_ms = EXTRACT(MILLISECONDS FROM (NOW() - started_at))::INTEGER,
    error = p_error,
    error_code = p_error_code,
    error_kind = p_error_kind
  WHERE job_id = p_job_id AND attempt_number = current_attempt;
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
REVOKE ALL ON FUNCTION public.claim_ai_jobs(TEXT, TEXT[], INTEGER, INTEGER, TEXT, UUID) FROM public;
REVOKE ALL ON FUNCTION public.release_claimed_ai_job(UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.heartbeat_ai_job(UUID, TEXT, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.start_claimed_ai_job(UUID, TEXT, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.complete_ai_job(UUID, TEXT, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER, INTEGER) FROM public;
REVOKE ALL ON FUNCTION public.fail_ai_job_for_retry(UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM public;
REVOKE ALL ON FUNCTION public.recover_expired_ai_job_leases(INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ai_queue_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_jobs(TEXT, TEXT[], INTEGER, INTEGER, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_claimed_ai_job(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_ai_job(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_claimed_ai_job(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ai_job(UUID, TEXT, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER, INTEGER) TO service_role;
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
CREATE INDEX idx_ai_jobs_expired_lease ON ai_jobs(status, lease_expires_at)
  WHERE status IN ('claimed','running') AND lease_expires_at IS NOT NULL;
CREATE INDEX idx_ai_jobs_target ON ai_jobs(user_id, target_type, target_id, type, status);
CREATE INDEX idx_ai_job_attempts_job ON ai_job_attempts(job_id, attempt_number);
CREATE INDEX idx_study_session_items_session ON study_session_items(study_session_id, order_index);
