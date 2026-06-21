BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP FUNCTION IF EXISTS public.digest(TEXT, TEXT);

DO $$
DECLARE
  v_pgcrypto_schema TEXT;
BEGIN
  SELECT n.nspname
    INTO v_pgcrypto_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION 'Extensao pgcrypto nao encontrada.';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.digest(data TEXT, type TEXT)
     RETURNS BYTEA
     LANGUAGE sql
     IMMUTABLE
     STRICT
     AS %L',
    format('SELECT %I.digest($1::bytea, $2)', v_pgcrypto_schema)
  );
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION
      'public.digest(text,text) ausente; aplique primeiro o wrapper pgcrypto canonico.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_lexical_type(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  WITH normalized AS (
    SELECT lower(translate(trim(coalesce(p_type, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) AS value
  )
  SELECT CASE
    WHEN value IN ('substantivo','noun','nome','nominal') THEN 'substantivo'
    WHEN value IN ('verbo','verb') THEN 'verbo'
    WHEN value IN ('adjetivo','adjective','adj') THEN 'adjetivo'
    WHEN value IN ('adverbio','adverb','adverbio') THEN 'adverbio'
    WHEN value IN ('pronome','pronoun') THEN 'pronome'
    WHEN value IN ('particula','particle') THEN 'particula'
    WHEN value IN ('expressao','expression','phrase','frase') THEN 'expressao'
    WHEN value IN ('conector','connector','conjunction','conjuncao') THEN 'conector'
    WHEN value IN ('auxiliar','auxiliary','aux') THEN 'auxiliar'
    WHEN value IN ('tempo','time') THEN 'tempo'
    WHEN value IN ('lugar','place','location') THEN 'lugar'
    ELSE 'outro'
  END
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.mark_ai_job_needs_review(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error TEXT,
  p_result JSONB DEFAULT '{}'::jsonb
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
  WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'running'
  FOR UPDATE;

  IF current_attempt IS NULL THEN
    RETURN;
  END IF;

  UPDATE ai_jobs
  SET status = 'needs_review',
      error = p_error,
      error_code = 'INVALID_LEXICAL_OFFSETS',
      error_kind = 'invalid_response',
      result = p_result,
      retry_at = NULL,
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_job_id;

  UPDATE ai_job_attempts
  SET status = 'needs_review',
      completed_at = NOW(),
      duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER,
      error = p_error,
      error_code = 'INVALID_LEXICAL_OFFSETS',
      error_kind = 'invalid_response'
  WHERE job_id = p_job_id
    AND attempt_number = current_attempt
    AND completed_at IS NULL;

  IF current_stage_id IS NOT NULL THEN
    UPDATE processing_run_stages
    SET needs_review_jobs = needs_review_jobs + 1,
        review_jobs = review_jobs + 1,
        status = 'needs_review',
        blocked_reason = p_error
    WHERE id = current_stage_id;
  END IF;

  PERFORM refresh_processing_run_snapshot(current_run_id);
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
    'clearable', COUNT(*) FILTER (WHERE status IN ('pending','error','completed','applied','cancelled'))
  )
  FROM ai_jobs
  WHERE user_id = auth.uid()::text;
$$;

CREATE OR REPLACE FUNCTION public.get_source_lexical_integrity_summary(p_source_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scoped_sentences AS (
    SELECT s.*
    FROM sentences s
    JOIN sources src ON src.id = s.source_id AND src.user_id = auth.uid()::text
    WHERE s.source_id = p_source_id AND s.user_id = auth.uid()::text
  ),
  invalid_terms AS (
    SELECT st.sentence_id, COUNT(*) AS invalid_count
    FROM sentence_terms st
    JOIN scoped_sentences s ON s.id = st.sentence_id
    WHERE NOT (
      st.start_index >= 0
      AND st.end_index > st.start_index
      AND st.end_index <= CHAR_LENGTH(s.japanese)
      AND SUBSTRING(s.japanese FROM st.start_index + 1 FOR st.end_index - st.start_index) = st.surface
    )
    GROUP BY st.sentence_id
  ),
  terminal_offset_jobs AS (
    SELECT DISTINCT target_id::uuid AS sentence_id
    FROM ai_jobs
    WHERE user_id = auth.uid()::text
      AND type = 'detect_sentence_terms'
      AND target_type = 'sentence'
      AND status = 'needs_review'
      AND error_code = 'INVALID_LEXICAL_OFFSETS'
  )
  SELECT jsonb_build_object(
    'total_sentences', COUNT(*),
    'reviewed_sentences', COUNT(*) FILTER (WHERE s.status = 'reviewed'),
    'invalid_offset_sentences', COUNT(*) FILTER (WHERE it.invalid_count > 0 OR toj.sentence_id IS NOT NULL),
    'invalid_offset_terms', COALESCE(SUM(it.invalid_count), 0),
    'without_terms_sentences', COUNT(*) FILTER (WHERE s.status <> 'reviewed' AND s.terms_source = 'ai' AND NOT EXISTS (SELECT 1 FROM sentence_terms st WHERE st.sentence_id = s.id)),
    'ai_empty_sentences', COUNT(*) FILTER (WHERE s.status <> 'reviewed' AND s.terms_source = 'ai_empty'),
    'eligible_invalid_only', COUNT(*) FILTER (WHERE s.status <> 'reviewed' AND (it.invalid_count > 0 OR toj.sentence_id IS NOT NULL)),
    'eligible_all_non_reviewed', COUNT(*) FILTER (WHERE s.status <> 'reviewed')
  )
  FROM scoped_sentences s
  LEFT JOIN invalid_terms it ON it.sentence_id = s.id
  LEFT JOIN terminal_offset_jobs toj ON toj.sentence_id = s.id;
$$;

CREATE OR REPLACE FUNCTION public.reset_source_lexical_analysis(p_source_id UUID, p_mode TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  reset_count INTEGER := 0;
BEGIN
  IF p_mode NOT IN ('invalid_only', 'all_non_reviewed') THEN
    RAISE EXCEPTION 'Modo de reset lexical invalido: %', p_mode;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sources WHERE id = p_source_id AND user_id = auth.uid()::text) THEN
    RAISE EXCEPTION 'Fonte nao encontrada para reset lexical.';
  END IF;

  CREATE TEMP TABLE tmp_reset_sentences ON COMMIT DROP AS
  SELECT s.id
  FROM sentences s
  WHERE s.source_id = p_source_id
    AND s.user_id = auth.uid()::text
    AND s.status <> 'reviewed'
    AND (
      p_mode = 'all_non_reviewed'
      OR EXISTS (
        SELECT 1
        FROM sentence_terms st
        WHERE st.sentence_id = s.id
          AND NOT (
            st.start_index >= 0
            AND st.end_index > st.start_index
            AND st.end_index <= CHAR_LENGTH(s.japanese)
            AND SUBSTRING(s.japanese FROM st.start_index + 1 FOR st.end_index - st.start_index) = st.surface
          )
      )
      OR EXISTS (
        SELECT 1
        FROM ai_jobs j
        WHERE j.user_id = auth.uid()::text
          AND j.type = 'detect_sentence_terms'
          AND j.target_type = 'sentence'
          AND j.target_id = s.id
          AND j.status = 'needs_review'
          AND j.error_code = 'INVALID_LEXICAL_OFFSETS'
      )
    );

  CREATE TEMP TABLE tmp_reset_runs ON COMMIT DROP AS
  SELECT DISTINCT run_id
  FROM ai_jobs j
  JOIN tmp_reset_sentences trs ON trs.id = j.target_id
  WHERE j.user_id = auth.uid()::text
    AND j.type = 'detect_sentence_terms'
    AND j.target_type = 'sentence'
    AND j.run_id IS NOT NULL;

  UPDATE ai_jobs j
  SET status = 'cancelled',
      error = 'MANUAL_LEXICAL_RESET',
      error_code = 'MANUAL_LEXICAL_RESET',
      retry_at = NULL,
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      updated_at = NOW()
  FROM tmp_reset_sentences trs
  WHERE j.user_id = auth.uid()::text
    AND j.type = 'detect_sentence_terms'
    AND j.target_type = 'sentence'
    AND j.target_id = trs.id
    AND j.status IN ('pending','claimed','retry_wait');

  UPDATE ai_jobs j
  SET cancel_requested = TRUE,
      error = 'MANUAL_LEXICAL_RESET',
      error_code = 'MANUAL_LEXICAL_RESET',
      updated_at = NOW()
  FROM tmp_reset_sentences trs
  WHERE j.user_id = auth.uid()::text
    AND j.type = 'detect_sentence_terms'
    AND j.target_type = 'sentence'
    AND j.target_id = trs.id
    AND j.status = 'running';

  UPDATE ai_jobs j
  SET status = 'obsolete',
      error = 'MANUAL_LEXICAL_RESET',
      error_code = 'MANUAL_LEXICAL_RESET',
      retry_at = NULL,
      locked_by = NULL,
      locked_until = NULL,
      lease_expires_at = NULL,
      worker_id = NULL,
      updated_at = NOW()
  FROM tmp_reset_sentences trs
  WHERE j.user_id = auth.uid()::text
    AND j.type = 'detect_sentence_terms'
    AND j.target_type = 'sentence'
    AND j.target_id = trs.id
    AND j.status IN ('needs_review','failed','error');

  DELETE FROM sentence_terms st
  USING tmp_reset_sentences trs
  WHERE st.sentence_id = trs.id
    AND st.user_id = auth.uid()::text;

  UPDATE sentences s
  SET terms_source = NULL,
      updated_at = NOW()
  FROM tmp_reset_sentences trs
  WHERE s.id = trs.id
    AND s.status <> 'reviewed';

  GET DIAGNOSTICS reset_count = ROW_COUNT;

  UPDATE processing_run_stages s
  SET status = 'completed',
      blocked_reason = NULL,
      needs_review_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'needs_review'), 0),
      failed_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'failed'), 0),
      retry_jobs = COALESCE((SELECT COUNT(*) FROM ai_jobs WHERE stage_id = s.id AND status = 'retry_wait'), 0),
      updated_at = NOW()
  WHERE s.run_id IN (SELECT run_id FROM tmp_reset_runs)
    AND s.status = 'needs_review'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_jobs j
      WHERE j.stage_id = s.id
        AND j.status IN ('needs_review','failed','error')
    );

  UPDATE processing_runs pr
  SET status = 'running',
      current_step = 'Analise lexical redefinida; prepare/retome a fonte.',
      updated_at = NOW()
  WHERE pr.id IN (SELECT run_id FROM tmp_reset_runs)
    AND pr.status = 'needs_review'
    AND NOT EXISTS (
      SELECT 1
      FROM ai_jobs j
      WHERE j.run_id = pr.id
        AND j.status IN ('needs_review','failed','error')
    );

  PERFORM refresh_processing_run_snapshot(run_id)
  FROM tmp_reset_runs;

  RETURN jsonb_build_object('reset_sentence_count', reset_count, 'mode', p_mode, 'source_id', p_source_id);
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
    PERFORM complete_ai_job(p_job_id, p_worker_id, jsonb_build_object('optimization', 'already_reviewed', 'sentence_id', current_sentence.id), p_raw_result, p_input_tokens, p_output_tokens, p_cost_actual, p_latency_ai_ms, NULL);
    RETURN jsonb_build_object('skipped', 'reviewed', 'sentence_id', current_sentence.id);
  END IF;
  IF current_job.payload ? 'sentence' AND current_job.payload->>'sentence' <> current_sentence.japanese THEN
    PERFORM mark_ai_job_obsolete(p_job_id, p_worker_id, 'A frase mudou depois da criacao do job.');
    RETURN jsonb_build_object('obsolete', true, 'sentence_id', current_sentence.id);
  END IF;

  DROP TABLE IF EXISTS tmp_raw_lexical_terms;
  CREATE TEMP TABLE tmp_raw_lexical_terms ON COMMIT DROP AS
  SELECT
    BTRIM(surface) AS surface,
    BTRIM(COALESCE(NULLIF(lemma, ''), surface)) AS lemma,
    public.normalize_lexical_type(COALESCE(NULLIF(term_type, ''), NULLIF(type, ''), 'outro')) AS term_type,
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
    surface TEXT, lemma TEXT, term_type TEXT, type TEXT, kana TEXT, romaji TEXT,
    entry_kana TEXT, entry_romaji TEXT, form_kana TEXT, form_romaji TEXT,
    form_type TEXT, grammar_note TEXT, meaning TEXT, context_meaning TEXT,
    start_index INTEGER, end_index INTEGER, confidence FLOAT
  )
  WHERE BTRIM(COALESCE(surface, '')) <> ''
    AND start_index IS NOT NULL
    AND end_index IS NOT NULL
    AND BTRIM(surface) ~ '[ぁ-んァ-ン一-龯々〆ヵヶ]';

  SELECT COUNT(*) INTO invalid_offset_count
  FROM tmp_raw_lexical_terms r
  WHERE NOT (
    r.start_index >= 0
    AND r.end_index > r.start_index
    AND r.end_index <= CHAR_LENGTH(current_sentence.japanese)
    AND SUBSTRING(current_sentence.japanese FROM r.start_index + 1 FOR r.end_index - r.start_index) = r.surface
  );

  IF invalid_offset_count > 0 THEN
    PERFORM mark_ai_job_needs_review(
      p_job_id,
      p_worker_id,
      'Offsets lexicais invalidos; reanalise manual necessaria.',
      jsonb_build_object('sentence_id', current_sentence.id, 'invalid_offset_count', invalid_offset_count)
    );
    RETURN jsonb_build_object('needs_review', true, 'sentence_id', current_sentence.id, 'invalid_offset_count', invalid_offset_count);
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
    surface, lemma, term_type, entry_kana, entry_romaji, form_kana, form_romaji, form_type, grammar_note, meaning,
    start_index, end_index, confidence,
    LOWER(REGEXP_REPLACE(lemma, '[[:space:]]+', '', 'g')) || '|' ||
      LOWER(REGEXP_REPLACE(COALESCE(entry_kana, ''), '[[:space:]]+', '', 'g')) || '|' ||
      LOWER(REGEXP_REPLACE(term_type, '[[:space:]]+', '', 'g')) AS entry_key
  FROM tmp_raw_lexical_terms
  ORDER BY surface, lemma, start_index, end_index, confidence DESC;

  WITH entry_rows AS (
    SELECT DISTINCT current_sentence.user_id AS user_id, lemma, entry_kana AS kana, entry_romaji AS romaji, term_type AS type, NULL::TEXT AS jlpt_level, 'pending'::TEXT AS status, ARRAY[]::TEXT[] AS tags, entry_key AS unique_key, MIN(meaning) AS main_meaning, NOW() AS updated_at
    FROM tmp_lexical_terms
    GROUP BY lemma, entry_kana, entry_romaji, term_type, entry_key
  ),
  inserted AS (
    INSERT INTO dictionary_entries(user_id, lemma, kana, romaji, type, jlpt_level, status, tags, unique_key, main_meaning, updated_at)
    SELECT user_id, lemma, kana, romaji, type, jlpt_level, status, tags, unique_key, main_meaning, updated_at
    FROM entry_rows
    ON CONFLICT (user_id, unique_key) DO UPDATE SET main_meaning = COALESCE(dictionary_entries.main_meaning, EXCLUDED.main_meaning), updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_entries FROM inserted;

  DROP TABLE IF EXISTS tmp_entries;
  CREATE TEMP TABLE tmp_entries ON COMMIT DROP AS
  SELECT d.id, d.unique_key FROM dictionary_entries d WHERE d.user_id = current_sentence.user_id AND d.unique_key IN (SELECT entry_key FROM tmp_lexical_terms);

  WITH form_rows AS (
    SELECT DISTINCT current_sentence.user_id AS user_id, e.id AS dictionary_entry_id, t.surface AS form, t.form_kana AS kana, t.form_romaji AS romaji, t.form_type, t.grammar_note, (t.surface = t.lemma) AS is_common, 'detected'::TEXT AS status,
      e.id::TEXT || '|' || LOWER(REGEXP_REPLACE(t.surface, '[[:space:]]+', '', 'g')) || '|' || LOWER(REGEXP_REPLACE(t.form_type, '[[:space:]]+', '', 'g')) AS unique_key, NOW() AS updated_at
    FROM tmp_lexical_terms t
    JOIN tmp_entries e ON e.unique_key = t.entry_key
  ),
  inserted AS (
    INSERT INTO dictionary_forms(user_id, dictionary_entry_id, form, kana, romaji, form_type, grammar_note, is_common, status, unique_key, updated_at)
    SELECT user_id, dictionary_entry_id, form, kana, romaji, form_type, grammar_note, is_common, status, unique_key, updated_at
    FROM form_rows
    ON CONFLICT (user_id, unique_key) DO UPDATE SET kana = COALESCE(dictionary_forms.kana, EXCLUDED.kana), romaji = COALESCE(dictionary_forms.romaji, EXCLUDED.romaji), grammar_note = COALESCE(dictionary_forms.grammar_note, EXCLUDED.grammar_note), updated_at = NOW()
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
      FROM tmp_lexical_terms t JOIN tmp_entries e ON e.unique_key = t.entry_key
    );

  WITH sense_rows AS (
    SELECT DISTINCT current_sentence.user_id AS user_id, e.id AS dictionary_entry_id, t.meaning, 'contextual'::TEXT AS meaning_type, NULL::TEXT AS explanation, 1 AS sense_order, 'ai_generated'::TEXT AS status, NOW() AS updated_at
    FROM tmp_lexical_terms t JOIN tmp_entries e ON e.unique_key = t.entry_key WHERE t.meaning IS NOT NULL
  ),
  inserted AS (
    INSERT INTO dictionary_senses(user_id, dictionary_entry_id, meaning, meaning_type, explanation, sense_order, status, updated_at)
    SELECT user_id, dictionary_entry_id, meaning, meaning_type, explanation, sense_order, status, updated_at
    FROM sense_rows
    ON CONFLICT (user_id, dictionary_entry_id, meaning) DO UPDATE SET updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_senses FROM inserted;

  DELETE FROM sentence_terms WHERE sentence_id = current_sentence.id AND user_id = current_sentence.user_id;

  WITH term_rows AS (
    SELECT current_sentence.user_id AS user_id, current_sentence.id AS sentence_id, f.id AS dictionary_form_id, ds.id AS dictionary_sense_id, t.surface, t.start_index, t.end_index, t.confidence, 'detected'::TEXT AS status, NOW() AS updated_at
    FROM tmp_lexical_terms t
    JOIN tmp_entries e ON e.unique_key = t.entry_key
    JOIN tmp_forms f ON f.unique_key = e.id::TEXT || '|' || LOWER(REGEXP_REPLACE(t.surface, '[[:space:]]+', '', 'g')) || '|' || LOWER(REGEXP_REPLACE(t.form_type, '[[:space:]]+', '', 'g'))
    LEFT JOIN dictionary_senses ds ON ds.user_id = current_sentence.user_id AND ds.dictionary_entry_id = e.id AND ds.meaning = t.meaning
  ),
  inserted AS (
    INSERT INTO sentence_terms(user_id, sentence_id, dictionary_form_id, dictionary_sense_id, surface, start_index, end_index, confidence, status, updated_at)
    SELECT user_id, sentence_id, dictionary_form_id, dictionary_sense_id, surface, start_index, end_index, confidence, status, updated_at
    FROM term_rows
    ON CONFLICT (sentence_id, start_index, end_index, dictionary_form_id) DO UPDATE SET dictionary_sense_id = EXCLUDED.dictionary_sense_id, confidence = EXCLUDED.confidence, status = EXCLUDED.status, updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO inserted_terms FROM inserted;

  UPDATE sentences SET terms_source = CASE WHEN inserted_terms > 0 THEN 'ai' ELSE 'ai_empty' END, updated_at = NOW()
  WHERE id = current_sentence.id AND user_id = current_sentence.user_id AND status <> 'reviewed';

  PERFORM complete_ai_job(p_job_id, p_worker_id, COALESCE(p_result, '{}'::jsonb) || jsonb_build_object('sentence_id', current_sentence.id, 'termCount', inserted_terms, 'entryCount', inserted_entries, 'formCount', inserted_forms, 'senseCount', inserted_senses, 'invalid_offset_count', invalid_offset_count), p_raw_result, p_input_tokens, p_output_tokens, p_cost_actual, p_latency_ai_ms, NULL);

  RETURN jsonb_build_object('sentence_id', current_sentence.id, 'termCount', inserted_terms, 'entryCount', inserted_entries, 'formCount', inserted_forms, 'senseCount', inserted_senses, 'invalid_offset_count', invalid_offset_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_queue_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_source_lexical_integrity_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_source_lexical_analysis(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_sentence_lexical_analysis_result(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) TO service_role;

COMMIT;
