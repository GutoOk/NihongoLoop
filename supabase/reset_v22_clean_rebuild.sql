-- Nihongo Loop destructive Supabase reset baseline
-- This schema is intended only for a fresh database reset/rebuild.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS study_session_items CASCADE;
DROP TABLE IF EXISTS study_sessions CASCADE;
DROP TABLE IF EXISTS ai_jobs CASCADE;
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
  processed_jobs INTEGER DEFAULT 0,
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
  type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  input_hash TEXT NOT NULL,
  input JSONB,
  result JSONB,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_estimate NUMERIC,
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
ALTER TABLE ai_jobs ADD CONSTRAINT uk_ai_jobs_full_hash UNIQUE (user_id, type, target_type, target_id, input_hash);

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
CREATE TRIGGER tr_dictionary_entries_touch BEFORE UPDATE ON dictionary_entries FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_dictionary_forms_touch BEFORE UPDATE ON dictionary_forms FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_dictionary_senses_touch BEFORE UPDATE ON dictionary_senses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_sentence_terms_touch BEFORE UPDATE ON sentence_terms FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_sentence_progress_touch BEFORE UPDATE ON sentence_progress FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_dictionary_progress_touch BEFORE UPDATE ON dictionary_progress FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_ai_jobs_touch BEFORE UPDATE ON ai_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER tr_study_sessions_touch BEFORE UPDATE ON study_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

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
    'sentence_progress', 'dictionary_progress', 'ai_jobs',
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
CREATE INDEX idx_sentences_japanese_key ON sentences(user_id, japanese_key);
CREATE INDEX idx_processing_runs_source ON processing_runs(user_id, source_id, status);
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
CREATE INDEX idx_ai_jobs_queue ON ai_jobs(user_id, status, priority DESC, created_at);
CREATE INDEX idx_ai_jobs_target ON ai_jobs(user_id, target_type, target_id, type, status);
CREATE INDEX idx_study_session_items_session ON study_session_items(study_session_id, order_index);

COMMIT;
