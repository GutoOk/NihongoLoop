-- Incremental, non-destructive update for lexical offset validation.
-- Keeps existing data and replaces only the lexical analysis RPC.
-- Protects future analyses only; terms already saved with wrong offsets need manual reprocessing.

BEGIN;

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
      WHERE status IN ('claimed','running')
        AND (
          (lease_expires_at IS NOT NULL AND lease_expires_at < NOW())
          OR (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < NOW() - INTERVAL '5 minutes')
        )
    ),
    'clearable', COUNT(*) FILTER (WHERE status IN ('pending','error','completed','applied','cancelled'))
  )
  FROM ai_jobs
  WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_queue_summary() TO authenticated;

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
  invalid_offset_count INTEGER := 0;
  expected_target_hash TEXT;
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
  IF current_job.type <> 'detect_sentence_terms' OR current_job.target_type <> 'sentence' THEN
    RAISE EXCEPTION 'Job incompativel para analise lexical.';
  END IF;

  SELECT * INTO current_sentence
  FROM sentences
  WHERE id = current_job.target_id AND user_id = current_job.user_id
  FOR UPDATE;

  IF current_sentence.id IS NULL THEN
    RAISE EXCEPTION 'Frase nao encontrada para analise lexical.';
  END IF;
  expected_target_hash := encode(public.digest(jsonb_build_object(
    'targetType', 'sentence',
    'targetId', current_sentence.id,
    'payload', jsonb_build_object('id', current_sentence.id, 'sentence', current_sentence.japanese, 'japanese', current_sentence.japanese, 'portuguese', current_sentence.portuguese, 'kana', current_sentence.kana, 'romaji', current_sentence.romaji, 'sourceId', current_sentence.source_id),
    'promptVersion', current_job.prompt_version,
    'model', COALESCE(current_job.model, current_job.model_version)
  )::text, 'sha256'::text), 'hex');
  IF current_job.target_hash IS NOT NULL AND current_job.target_hash <> expected_target_hash THEN
    PERFORM mark_ai_job_obsolete(p_job_id, p_worker_id, 'O alvo mudou depois da criacao do job.');
    RETURN jsonb_build_object('obsolete', true, 'sentence_id', current_sentence.id);
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
    PERFORM mark_ai_job_obsolete(p_job_id, p_worker_id, 'A frase mudou depois da criacao do job.');
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
  WITH raw_terms AS (
    SELECT
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
      COALESCE(confidence, 1) AS confidence
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
      AND end_index > start_index
      AND BTRIM(surface) ~ '[ぁ-んァ-ン一-龯々〆ヵヶ]'
  ),
  valid_terms AS (
    SELECT
      r.*
    FROM raw_terms r
    WHERE r.start_index >= 0
      AND r.end_index <= CHAR_LENGTH(current_sentence.japanese)
      AND SUBSTRING(current_sentence.japanese FROM r.start_index + 1 FOR r.end_index - r.start_index) = r.surface
  )
  SELECT DISTINCT ON (surface, lemma, start_index, end_index)
    surface,
    lemma,
    term_type,
    entry_kana,
    entry_romaji,
    form_kana,
    form_romaji,
    form_type,
    grammar_note,
    meaning,
    start_index,
    end_index,
    confidence,
    LOWER(REGEXP_REPLACE(lemma, '[[:space:]]+', '', 'g')) || '|' ||
      LOWER(REGEXP_REPLACE(COALESCE(entry_kana, ''), '[[:space:]]+', '', 'g')) || '|' ||
      LOWER(REGEXP_REPLACE(term_type, '[[:space:]]+', '', 'g')) AS entry_key
  FROM valid_terms
  ORDER BY surface, lemma, start_index, end_index, confidence DESC;

  WITH raw_terms AS (
    SELECT
      BTRIM(surface) AS surface,
      start_index,
      end_index
    FROM jsonb_to_recordset(COALESCE(p_terms, '[]'::jsonb)) AS t(
      surface TEXT,
      start_index INTEGER,
      end_index INTEGER
    )
    WHERE BTRIM(COALESCE(surface, '')) <> ''
      AND start_index IS NOT NULL
      AND end_index IS NOT NULL
      AND end_index > start_index
      AND BTRIM(surface) ~ '[ぁ-んァ-ン一-龯々〆ヵヶ]'
  )
  SELECT COUNT(*) INTO invalid_offset_count
  FROM raw_terms r
  WHERE NOT (
    r.start_index >= 0
    AND r.end_index <= CHAR_LENGTH(current_sentence.japanese)
    AND SUBSTRING(current_sentence.japanese FROM r.start_index + 1 FOR r.end_index - r.start_index) = r.surface
  );

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
    JOIN tmp_forms f ON f.unique_key = e.id::TEXT || '|' || LOWER(REGEXP_REPLACE(t.surface, '[[:space:]]+', '', 'g')) || '|' || LOWER(REGEXP_REPLACE(t.form_type, '[[:space:]]+', '', 'g'))
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
      'senseCount', inserted_senses,
      'invalid_offset_count', invalid_offset_count
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
    'senseCount', inserted_senses,
    'invalid_offset_count', invalid_offset_count
  );
END;
$$;

COMMIT;
