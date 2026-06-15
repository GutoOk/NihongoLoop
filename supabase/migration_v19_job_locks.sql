-- Migration v19: AI Jobs Locks, SRS Columns, and Unique Constraints

-- 1. AI Jobs Locking Columns
ALTER TABLE ai_jobs
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP WITH TIME ZONE;

-- 2. SRS Columns for sentence_progress
ALTER TABLE sentence_progress
  ADD COLUMN IF NOT EXISTS srs_interval_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS srs_ease_factor NUMERIC DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMP WITH TIME ZONE;

-- 3. SRS Columns for dictionary_progress
ALTER TABLE dictionary_progress
  ADD COLUMN IF NOT EXISTS srs_interval_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS srs_ease_factor NUMERIC DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMP WITH TIME ZONE;

-- 4. Unique Constraints to prevent duplicate progress and terms entries
ALTER TABLE sentence_progress 
  DROP CONSTRAINT IF EXISTS uk_sentence_progress;
ALTER TABLE sentence_progress 
  ADD CONSTRAINT uk_sentence_progress UNIQUE (user_id, sentence_id);

ALTER TABLE dictionary_progress 
  DROP CONSTRAINT IF EXISTS uk_dictionary_progress;
ALTER TABLE dictionary_progress 
  ADD CONSTRAINT uk_dictionary_progress UNIQUE (user_id, dictionary_entry_id);

ALTER TABLE sentence_terms 
  DROP CONSTRAINT IF EXISTS uk_sentence_terms;
ALTER TABLE sentence_terms 
  ADD CONSTRAINT uk_sentence_terms UNIQUE (user_id, sentence_id, surface, start_index, end_index);
