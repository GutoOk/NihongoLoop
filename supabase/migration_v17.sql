-- Migration for v17

-- Add rich metadata columns to dictionary_entries
ALTER TABLE dictionary_entries 
  ADD COLUMN IF NOT EXISTS subtype TEXT,
  ADD COLUMN IF NOT EXISTS components JSONB,
  ADD COLUMN IF NOT EXISTS grammar_info TEXT,
  ADD COLUMN IF NOT EXISTS common_forms TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS short_note TEXT;

-- Add rich metadata columns to sentence_terms
ALTER TABLE sentence_terms
  ADD COLUMN IF NOT EXISTS context_meaning TEXT,
  ADD COLUMN IF NOT EXISTS grammar_note TEXT,
  ADD COLUMN IF NOT EXISTS structure_note TEXT,
  ADD COLUMN IF NOT EXISTS components JSONB,
  ADD COLUMN IF NOT EXISTS is_expression BOOLEAN DEFAULT FALSE;

-- Add input JSONB to ai_jobs
ALTER TABLE ai_jobs
  ADD COLUMN IF NOT EXISTS input JSONB;
