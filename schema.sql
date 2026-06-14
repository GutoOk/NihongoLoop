-- Schema for Nihongo Loop

-- Documentation:
-- Please note: Row Level Security (RLS) is ENABLED on all tables.
-- The application relies on `public.is_app_admin()` to restrict access 
-- solely to the designated app administrator.


-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  original_content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE processing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
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
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE sentences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  japanese TEXT NOT NULL,
  japanese_key TEXT,
  portuguese TEXT,
  kana TEXT,
  romaji TEXT,
  status TEXT NOT NULL DEFAULT 'raw',
  tags TEXT[] DEFAULT '{}',
  favorite BOOLEAN DEFAULT FALSE,
  difficulty INTEGER,
  translation_source TEXT,
  reading_source TEXT,
  terms_source TEXT,
  prepared_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE dictionary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  lemma TEXT NOT NULL,
  kana TEXT,
  romaji TEXT,
  type TEXT NOT NULL,
  main_meaning TEXT,
  meanings TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  jlpt_level TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  unique_key TEXT NOT NULL,
  subtype TEXT,
  components JSONB,
  grammar_info TEXT,
  common_forms TEXT[] DEFAULT '{}',
  short_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE sentence_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  sentence_id UUID REFERENCES sentences(id) ON DELETE CASCADE,
  dictionary_entry_id UUID REFERENCES dictionary_entries(id) ON DELETE SET NULL,
  surface TEXT NOT NULL,
  lemma TEXT NOT NULL,
  kana TEXT,
  romaji TEXT,
  start_index INTEGER NOT NULL,
  end_index INTEGER NOT NULL,
  type TEXT NOT NULL,
  confidence FLOAT NOT NULL,
  status TEXT NOT NULL DEFAULT 'detected',
  context_meaning TEXT,
  grammar_note TEXT,
  structure_note TEXT,
  components JSONB,
  is_expression BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE sentence_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  sentence_id UUID REFERENCES sentences(id) ON DELETE CASCADE,
  seen_count INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  wrong_count INTEGER DEFAULT 0,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  mastery FLOAT DEFAULT 0.0,
  srs_interval_minutes INTEGER DEFAULT 0,
  srs_ease_factor NUMERIC DEFAULT 2.5,
  due_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE dictionary_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  dictionary_entry_id UUID REFERENCES dictionary_entries(id) ON DELETE CASCADE,
  seen_count INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  wrong_count INTEGER DEFAULT 0,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  mastery FLOAT DEFAULT 0.0,
  srs_interval_minutes INTEGER DEFAULT 0,
  srs_ease_factor NUMERIC DEFAULT 2.5,
  due_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input_hash TEXT,
  input JSONB,
  result JSONB,
  error TEXT,
  locked_by TEXT,
  locked_until TIMESTAMP WITH TIME ZONE,
  retry_count INTEGER DEFAULT 0,
  last_heartbeat_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source_id UUID,
  config JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique constraints
ALTER TABLE dictionary_entries ADD CONSTRAINT uk_dictionary_lemma UNIQUE (user_id, unique_key);
ALTER TABLE sentence_progress ADD CONSTRAINT uk_sentence_progress UNIQUE (user_id, sentence_id);
ALTER TABLE dictionary_progress ADD CONSTRAINT uk_dictionary_progress UNIQUE (user_id, dictionary_entry_id);
ALTER TABLE sentence_terms ADD CONSTRAINT uk_sentence_terms UNIQUE (user_id, sentence_id, surface, start_index, end_index);

CREATE TABLE app_admins (
  user_id UUID PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_admins aa
    WHERE aa.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_app_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- Enable RLS & Row Level Security Policies
ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_admins NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app_admins FROM anon;
REVOKE ALL ON app_admins FROM authenticated;

-- sources
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sources FROM anon;
REVOKE ALL ON sources FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sources TO authenticated;
CREATE POLICY "app admin select sources" ON sources FOR SELECT TO authenticated USING (public.is_app_admin());
CREATE POLICY "app admin insert sources" ON sources FOR INSERT TO authenticated WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin update sources" ON sources FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin delete sources" ON sources FOR DELETE TO authenticated USING (public.is_app_admin());

-- processing_runs
ALTER TABLE processing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON processing_runs FROM anon;
REVOKE ALL ON processing_runs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON processing_runs TO authenticated;
CREATE POLICY "app admin select processing_runs" ON processing_runs FOR SELECT TO authenticated USING (public.is_app_admin());
CREATE POLICY "app admin insert processing_runs" ON processing_runs FOR INSERT TO authenticated WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin update processing_runs" ON processing_runs FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin delete processing_runs" ON processing_runs FOR DELETE TO authenticated USING (public.is_app_admin());

-- sentences
ALTER TABLE sentences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sentences FROM anon;
REVOKE ALL ON sentences FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sentences TO authenticated;
CREATE POLICY "app admin select sentences" ON sentences FOR SELECT TO authenticated USING (public.is_app_admin());
CREATE POLICY "app admin insert sentences" ON sentences FOR INSERT TO authenticated WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin update sentences" ON sentences FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin delete sentences" ON sentences FOR DELETE TO authenticated USING (public.is_app_admin());

-- dictionary_entries
ALTER TABLE dictionary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE dictionary_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dictionary_entries FROM anon;
REVOKE ALL ON dictionary_entries FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON dictionary_entries TO authenticated;
CREATE POLICY "app admin select dictionary_entries" ON dictionary_entries FOR SELECT TO authenticated USING (public.is_app_admin());
CREATE POLICY "app admin insert dictionary_entries" ON dictionary_entries FOR INSERT TO authenticated WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin update dictionary_entries" ON dictionary_entries FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin delete dictionary_entries" ON dictionary_entries FOR DELETE TO authenticated USING (public.is_app_admin());

-- sentence_terms
ALTER TABLE sentence_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentence_terms FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sentence_terms FROM anon;
REVOKE ALL ON sentence_terms FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sentence_terms TO authenticated;
CREATE POLICY "app admin select sentence_terms" ON sentence_terms FOR SELECT TO authenticated USING (public.is_app_admin());
CREATE POLICY "app admin insert sentence_terms" ON sentence_terms FOR INSERT TO authenticated WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin update sentence_terms" ON sentence_terms FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin delete sentence_terms" ON sentence_terms FOR DELETE TO authenticated USING (public.is_app_admin());

-- sentence_progress
ALTER TABLE sentence_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentence_progress FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sentence_progress FROM anon;
REVOKE ALL ON sentence_progress FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sentence_progress TO authenticated;
CREATE POLICY "app admin select sentence_progress" ON sentence_progress FOR SELECT TO authenticated USING (public.is_app_admin());
CREATE POLICY "app admin insert sentence_progress" ON sentence_progress FOR INSERT TO authenticated WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin update sentence_progress" ON sentence_progress FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin delete sentence_progress" ON sentence_progress FOR DELETE TO authenticated USING (public.is_app_admin());

-- dictionary_progress
ALTER TABLE dictionary_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE dictionary_progress FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dictionary_progress FROM anon;
REVOKE ALL ON dictionary_progress FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON dictionary_progress TO authenticated;
CREATE POLICY "app admin select dictionary_progress" ON dictionary_progress FOR SELECT TO authenticated USING (public.is_app_admin());
CREATE POLICY "app admin insert dictionary_progress" ON dictionary_progress FOR INSERT TO authenticated WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin update dictionary_progress" ON dictionary_progress FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin delete dictionary_progress" ON dictionary_progress FOR DELETE TO authenticated USING (public.is_app_admin());

-- ai_jobs
ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ai_jobs FROM anon;
REVOKE ALL ON ai_jobs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_jobs TO authenticated;
CREATE POLICY "app admin select ai_jobs" ON ai_jobs FOR SELECT TO authenticated USING (public.is_app_admin());
CREATE POLICY "app admin insert ai_jobs" ON ai_jobs FOR INSERT TO authenticated WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin update ai_jobs" ON ai_jobs FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin delete ai_jobs" ON ai_jobs FOR DELETE TO authenticated USING (public.is_app_admin());

-- study_sessions
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON study_sessions FROM anon;
REVOKE ALL ON study_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON study_sessions TO authenticated;
CREATE POLICY "app admin select study_sessions" ON study_sessions FOR SELECT TO authenticated USING (public.is_app_admin());
CREATE POLICY "app admin insert study_sessions" ON study_sessions FOR INSERT TO authenticated WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin update study_sessions" ON study_sessions FOR UPDATE TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());
CREATE POLICY "app admin delete study_sessions" ON study_sessions FOR DELETE TO authenticated USING (public.is_app_admin());

-- Default security privileges for sequences and schemas
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- Indexes
CREATE INDEX idx_sources_user_id ON sources(user_id);
CREATE INDEX idx_processing_runs_user_id ON processing_runs(user_id);
CREATE INDEX idx_processing_runs_source_id ON processing_runs(source_id);
CREATE INDEX idx_processing_runs_status ON processing_runs(status);
CREATE INDEX idx_sentences_user_id ON sentences(user_id);
CREATE INDEX idx_sentences_japanese_key ON sentences(user_id, japanese_key);
CREATE INDEX idx_sentences_source_japanese_key ON sentences(source_id, japanese_key);
CREATE INDEX idx_sentences_source_id ON sentences(source_id);
CREATE INDEX idx_sentence_terms_user_id ON sentence_terms(user_id);
CREATE INDEX idx_sentence_terms_dictionary_entry_id ON sentence_terms(dictionary_entry_id);
CREATE INDEX idx_sentence_terms_sentence_id ON sentence_terms(sentence_id);
CREATE INDEX idx_sentence_terms_span ON sentence_terms(sentence_id, surface, start_index, end_index);
CREATE INDEX idx_ai_jobs_target ON ai_jobs(type, target_type, target_id, status);
CREATE INDEX idx_sentence_progress_sentence_id ON sentence_progress(sentence_id);
CREATE INDEX idx_dictionary_progress_dictionary_entry_id ON dictionary_progress(dictionary_entry_id);
