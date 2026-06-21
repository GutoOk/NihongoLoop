BEGIN;

UPDATE schema_versions SET version = '2026-06-ai-queue-v28' WHERE key = 'ai_queue';

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
  p_user_id := public.request_user_id(p_user_id);

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

  IF p_run_mode = 'translate' AND NOT EXISTS (
    SELECT 1 FROM sentences
    WHERE source_id = p_source_id AND user_id = p_user_id AND status <> 'reviewed' AND portuguese IS NULL
  ) THEN
    UPDATE processing_runs
    SET status = 'completed',
        current_step = 'Nada a traduzir nesta fonte.',
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = selected_run.id;
    RETURN jsonb_build_object('run_id', selected_run.id, 'stage', NULL, 'created_jobs', 0, 'status', 'completed');
  END IF;

  IF p_run_mode IN ('all','translate','analyze') AND EXISTS (
    SELECT 1 FROM sentences
    WHERE source_id = p_source_id
      AND user_id = p_user_id
      AND status <> 'reviewed'
      AND (
        (p_run_mode IN ('all','translate') AND portuguese IS NULL)
        OR (p_run_mode IN ('all','analyze') AND (portuguese IS NULL OR kana IS NULL OR romaji IS NULL OR terms_source IS NULL))
      )
      AND NOT EXISTS (
        SELECT 1 FROM ai_jobs old
        WHERE old.run_id = selected_run.id
          AND old.type = 'prepare_sentence'
          AND old.target_id = sentences.id
          AND old.status IN ('failed','needs_review')
      )
  ) THEN
    selected_stage := 'sentence_preparation';
  ELSIF p_run_mode IN ('all','analyze') AND EXISTS (
    SELECT 1 FROM sentences
    WHERE source_id = p_source_id AND user_id = p_user_id AND status <> 'reviewed' AND portuguese IS NOT NULL AND (kana IS NULL OR romaji IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM ai_jobs old
        WHERE old.run_id = selected_run.id
          AND old.type = 'generate_sentence_reading'
          AND old.target_id = sentences.id
          AND old.status IN ('failed','needs_review')
      )
  ) THEN
    selected_stage := 'reading';
  ELSIF p_run_mode IN ('all','analyze') AND EXISTS (
    SELECT 1 FROM sentences
    WHERE source_id = p_source_id AND user_id = p_user_id AND status <> 'reviewed' AND portuguese IS NOT NULL AND kana IS NOT NULL AND romaji IS NOT NULL AND terms_source IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ai_jobs old
        WHERE old.run_id = selected_run.id
          AND old.type = 'detect_sentence_terms'
          AND old.target_id = sentences.id
          AND old.status IN ('failed','needs_review')
      )
  ) THEN
    selected_stage := 'lexical_analysis';
  ELSIF p_run_mode IN ('all','dictionary') AND EXISTS (
    SELECT 1
    FROM sentence_terms st
    JOIN sentences s ON s.id = st.sentence_id
    JOIN dictionary_forms df ON df.id = st.dictionary_form_id
    JOIN dictionary_entries de ON de.id = df.dictionary_entry_id
    WHERE s.source_id = p_source_id
      AND s.user_id = p_user_id
      AND de.user_id = p_user_id
      AND de.status <> 'reviewed'
      AND (de.main_meaning IS NULL OR de.kana IS NULL OR de.romaji IS NULL OR de.status = 'pending')
      AND NOT EXISTS (
        SELECT 1 FROM ai_jobs old
        WHERE old.run_id = selected_run.id
          AND old.type = 'enrich_dictionary_entry'
          AND old.target_id = de.id
          AND old.status IN ('failed','needs_review')
      )
  ) THEN
    selected_stage := 'dictionary_enrichment';
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

  IF selected_stage = 'sentence_preparation' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(job_payload)::jsonb), '[]'::jsonb) INTO job_rows
    FROM (
      SELECT
        p_user_id AS user_id,
        selected_run.id AS run_id,
        selected_stage_id AS stage_id,
        selected_stage AS stage,
        'prepare_sentence' AS type,
        'sentence' AS target_type,
        s.id AS target_id,
        300 AS priority,
        encode(public.digest(jsonb_build_object(
          'targetType', 'sentence',
          'targetId', s.id,
          'payload', jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'kana', s.kana, 'romaji', s.romaji, 'sourceId', p_source_id),
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'::text), 'hex') AS target_hash,
        encode(public.digest(jsonb_build_object(
          'type', 'prepare_sentence',
          'targetType', 'sentence',
          'targetId', s.id,
          'japanese', s.japanese,
          'portuguese', s.portuguese,
          'kana', s.kana,
          'romaji', s.romaji,
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'::text), 'hex') AS input_hash,
        'prepare_sentence:sentence:' || s.id || ':' || encode(public.digest(jsonb_build_object(
          'type', 'prepare_sentence',
          'targetType', 'sentence',
          'targetId', s.id,
          'japanese', s.japanese,
          'portuguese', s.portuguese,
          'kana', s.kana,
          'romaji', s.romaji,
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'::text), 'hex') AS job_key,
        p_prompt_version AS prompt_version,
        p_model AS model_version,
        p_model AS model,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'kana', s.kana, 'romaji', s.romaji, 'sourceId', p_source_id) AS payload,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'kana', s.kana, 'romaji', s.romaji, 'sourceId', p_source_id) AS input,
        3 AS max_attempts
      FROM sentences s
      WHERE s.source_id = p_source_id
        AND s.user_id = p_user_id
        AND s.status <> 'reviewed'
        AND (
          (p_run_mode IN ('all','translate') AND s.portuguese IS NULL)
          OR (p_run_mode IN ('all','analyze') AND (s.portuguese IS NULL OR s.kana IS NULL OR s.romaji IS NULL OR s.terms_source IS NULL))
        )
        AND NOT EXISTS (
          SELECT 1 FROM ai_jobs old
          WHERE old.run_id = selected_run.id
            AND old.stage_id = selected_stage_id
            AND old.target_id = s.id
            AND old.status IN ('failed','needs_review')
        )
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
        encode(public.digest(jsonb_build_object('targetType','sentence','targetId',s.id,'payload',jsonb_build_object('id',s.id,'sentence',s.japanese,'japanese',s.japanese,'portuguese',s.portuguese,'sourceId',p_source_id),'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'::text), 'hex') AS target_hash,
        encode(public.digest(jsonb_build_object('type','generate_sentence_reading','targetType','sentence','targetId',s.id,'japanese',s.japanese,'portuguese',s.portuguese,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'::text), 'hex') AS input_hash,
        'generate_sentence_reading:sentence:' || s.id || ':' || encode(public.digest(jsonb_build_object('type','generate_sentence_reading','targetType','sentence','targetId',s.id,'japanese',s.japanese,'portuguese',s.portuguese,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'::text), 'hex') AS job_key,
        p_prompt_version AS prompt_version,
        p_model AS model_version,
        p_model AS model,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'sourceId', p_source_id) AS payload,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'sourceId', p_source_id) AS input,
        3 AS max_attempts
      FROM sentences s
      WHERE s.source_id = p_source_id AND s.user_id = p_user_id AND s.status <> 'reviewed' AND s.portuguese IS NOT NULL AND (s.kana IS NULL OR s.romaji IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM ai_jobs old
          WHERE old.run_id = selected_run.id
            AND old.stage_id = selected_stage_id
            AND old.target_id = s.id
            AND old.status IN ('failed','needs_review')
        )
      ORDER BY s.order_index
    ) job_payload;
  ELSIF selected_stage = 'lexical_analysis' THEN
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
        encode(public.digest(jsonb_build_object('targetType','sentence','targetId',s.id,'payload',jsonb_build_object('id',s.id,'sentence',s.japanese,'japanese',s.japanese,'portuguese',s.portuguese,'kana',s.kana,'romaji',s.romaji,'sourceId',p_source_id),'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'::text), 'hex') AS target_hash,
        encode(public.digest(jsonb_build_object('type','detect_sentence_terms','targetType','sentence','targetId',s.id,'japanese',s.japanese,'portuguese',s.portuguese,'kana',s.kana,'romaji',s.romaji,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'::text), 'hex') AS input_hash,
        'detect_sentence_terms:sentence:' || s.id || ':' || encode(public.digest(jsonb_build_object('type','detect_sentence_terms','targetType','sentence','targetId',s.id,'japanese',s.japanese,'portuguese',s.portuguese,'kana',s.kana,'romaji',s.romaji,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'::text), 'hex') AS job_key,
        p_prompt_version AS prompt_version,
        p_model AS model_version,
        p_model AS model,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'kana', s.kana, 'romaji', s.romaji, 'sourceId', p_source_id) AS payload,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'portuguese', s.portuguese, 'kana', s.kana, 'romaji', s.romaji, 'sourceId', p_source_id) AS input,
        3 AS max_attempts
      FROM sentences s
      WHERE s.source_id = p_source_id AND s.user_id = p_user_id AND s.status <> 'reviewed' AND s.portuguese IS NOT NULL AND s.kana IS NOT NULL AND s.romaji IS NOT NULL AND s.terms_source IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ai_jobs old
          WHERE old.run_id = selected_run.id
            AND old.stage_id = selected_stage_id
            AND old.target_id = s.id
            AND old.status IN ('failed','needs_review')
        )
      ORDER BY s.order_index
    ) job_payload;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(job_payload)::jsonb), '[]'::jsonb) INTO job_rows
    FROM (
      WITH eligible AS (
        SELECT DISTINCT ON (de.id)
          de.id,
          de.user_id,
          de.lemma,
          de.kana,
          de.romaji,
          de.type,
          de.main_meaning,
          jsonb_build_object('id', de.id, 'entryId', de.id, 'lemma', de.lemma, 'kana', de.kana, 'romaji', de.romaji, 'type', de.type, 'sourceId', p_source_id) AS payload
        FROM sentence_terms st
        JOIN sentences s ON s.id = st.sentence_id
        JOIN dictionary_forms df ON df.id = st.dictionary_form_id
        JOIN dictionary_entries de ON de.id = df.dictionary_entry_id
        WHERE s.source_id = p_source_id
          AND s.user_id = p_user_id
          AND de.user_id = p_user_id
          AND de.status <> 'reviewed'
          AND (de.main_meaning IS NULL OR de.kana IS NULL OR de.romaji IS NULL OR de.status = 'pending')
          AND NOT EXISTS (
            SELECT 1 FROM ai_jobs old
            WHERE old.run_id = selected_run.id
              AND old.stage_id = selected_stage_id
              AND old.target_id = de.id
              AND old.status IN ('failed','needs_review')
          )
        ORDER BY de.id, de.updated_at ASC, de.created_at ASC
      ),
      hashed AS (
        SELECT
          *,
          encode(public.digest(jsonb_build_object('targetType','dictionary_entry','targetId',id,'payload',payload,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'::text), 'hex') AS target_hash,
          encode(public.digest(jsonb_build_object('type','enrich_dictionary_entry','targetType','dictionary_entry','targetId',id,'lemma',lemma,'kana',kana,'romaji',romaji,'entryType',type,'mainMeaning',main_meaning,'promptVersion',p_prompt_version,'model',p_model)::text, 'sha256'::text), 'hex') AS input_hash
        FROM eligible
      )
      SELECT
        user_id,
        selected_run.id AS run_id,
        selected_stage_id AS stage_id,
        selected_stage AS stage,
        'enrich_dictionary_entry' AS type,
        'dictionary_entry' AS target_type,
        id AS target_id,
        100 AS priority,
        target_hash,
        input_hash,
        'enrich_dictionary_entry:dictionary_entry:' || id || ':' || input_hash AS job_key,
        p_prompt_version AS prompt_version,
        p_model AS model_version,
        p_model AS model,
        payload,
        payload AS input,
        3 AS max_attempts
      FROM hashed
      ORDER BY lemma, id
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

CREATE OR REPLACE FUNCTION public.build_ai_job_current_target_hash(current_job ai_jobs)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_sentence sentences;
  current_entry dictionary_entries;
  payload JSONB;
BEGIN
  IF current_job.target_type = 'sentence' THEN
    SELECT * INTO current_sentence
    FROM sentences
    WHERE id = current_job.target_id AND user_id = current_job.user_id;

    IF current_sentence.id IS NULL THEN
      RETURN NULL;
    END IF;

    IF current_job.type = 'prepare_sentence' THEN
      payload := jsonb_build_object('id', current_sentence.id, 'sentence', current_sentence.japanese, 'japanese', current_sentence.japanese, 'portuguese', current_sentence.portuguese, 'kana', current_sentence.kana, 'romaji', current_sentence.romaji, 'sourceId', current_sentence.source_id);
    ELSIF current_job.type = 'translate_sentence' THEN
      payload := jsonb_build_object('id', current_sentence.id, 'sentence', current_sentence.japanese, 'japanese', current_sentence.japanese, 'sourceId', current_sentence.source_id);
    ELSIF current_job.type = 'generate_sentence_reading' THEN
      payload := jsonb_build_object('id', current_sentence.id, 'sentence', current_sentence.japanese, 'japanese', current_sentence.japanese, 'portuguese', current_sentence.portuguese, 'sourceId', current_sentence.source_id);
    ELSIF current_job.type = 'detect_sentence_terms' THEN
      payload := jsonb_build_object('id', current_sentence.id, 'sentence', current_sentence.japanese, 'japanese', current_sentence.japanese, 'portuguese', current_sentence.portuguese, 'kana', current_sentence.kana, 'romaji', current_sentence.romaji, 'sourceId', current_sentence.source_id);
    ELSE
      RETURN NULL;
    END IF;
  ELSIF current_job.target_type = 'dictionary_entry' AND current_job.type = 'enrich_dictionary_entry' THEN
    SELECT * INTO current_entry
    FROM dictionary_entries
    WHERE id = current_job.target_id AND user_id = current_job.user_id;

    IF current_entry.id IS NULL THEN
      RETURN NULL;
    END IF;

    payload := jsonb_build_object('id', current_entry.id, 'entryId', current_entry.id, 'lemma', current_entry.lemma, 'kana', current_entry.kana, 'romaji', current_entry.romaji, 'type', current_entry.type);
    IF current_job.payload ? 'sourceId' THEN
      payload := payload || jsonb_build_object('sourceId', current_job.payload->>'sourceId');
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  RETURN encode(public.digest(jsonb_build_object(
    'targetType', current_job.target_type,
    'targetId', current_job.target_id,
    'payload', payload,
    'promptVersion', current_job.prompt_version,
    'model', COALESCE(current_job.model, current_job.model_version)
  )::text, 'sha256'::text), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sentence_preparation_result(
  p_job_id UUID,
  p_worker_id TEXT,
  p_translation TEXT,
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
  normalized_translation TEXT;
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
  IF current_job.type <> 'prepare_sentence' OR current_job.target_type <> 'sentence' THEN
    RAISE EXCEPTION 'Job incompativel para preparacao de frase.';
  END IF;

  SELECT * INTO current_sentence
  FROM sentences
  WHERE id = current_job.target_id AND user_id = current_job.user_id
  FOR UPDATE;

  IF current_sentence.id IS NULL THEN
    RAISE EXCEPTION 'Frase nao encontrada para preparacao.';
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

  normalized_translation := NULLIF(BTRIM(COALESCE(p_translation, current_sentence.portuguese, '')), '');
  normalized_kana := NULLIF(BTRIM(COALESCE(p_kana, current_sentence.kana, '')), '');
  normalized_romaji := LOWER(REGEXP_REPLACE(BTRIM(COALESCE(p_romaji, current_sentence.romaji, '')), '[[:space:]]+', ' ', 'g'));

  IF normalized_translation IS NULL THEN
    RAISE EXCEPTION 'Resultado invalido: traducao ausente.';
  END IF;
  IF normalized_translation = current_sentence.japanese THEN
    normalized_translation := 'Expressao japonesa sem traducao literal direta: ' || current_sentence.japanese || '.';
  END IF;
  IF normalized_kana IS NULL OR normalized_romaji IS NULL OR normalized_romaji = '' THEN
    RAISE EXCEPTION 'Resultado invalido: kana ou romaji ausente.';
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
    AND end_index IS NOT NULL;

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

  UPDATE sentences
  SET portuguese = normalized_translation,
      kana = normalized_kana,
      romaji = normalized_romaji,
      status = 'reading_ready',
      translation_source = CASE WHEN current_sentence.portuguese IS NULL THEN 'ai_worker' ELSE COALESCE(translation_source, 'ai_worker') END,
      reading_source = 'ai_worker',
      terms_source = CASE WHEN inserted_terms > 0 THEN 'ai' ELSE 'ai_empty' END,
      updated_at = NOW()
  WHERE id = current_sentence.id AND user_id = current_sentence.user_id AND status <> 'reviewed';

  PERFORM complete_ai_job(p_job_id, p_worker_id, COALESCE(p_result, '{}'::jsonb) || jsonb_build_object('sentence_id', current_sentence.id, 'translation', normalized_translation, 'termCount', inserted_terms, 'entryCount', inserted_entries, 'formCount', inserted_forms, 'senseCount', inserted_senses, 'invalid_offset_count', invalid_offset_count), p_raw_result, p_input_tokens, p_output_tokens, p_cost_actual, p_latency_ai_ms, NULL);

  RETURN jsonb_build_object('sentence_id', current_sentence.id, 'translation', normalized_translation, 'termCount', inserted_terms, 'entryCount', inserted_entries, 'formCount', inserted_forms, 'senseCount', inserted_senses, 'invalid_offset_count', invalid_offset_count);
END;
$$;


REVOKE ALL ON FUNCTION public.apply_sentence_preparation_result(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_sentence_preparation_result(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, INTEGER, INTEGER, NUMERIC, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_or_resume_source_processing_run(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.build_ai_job_current_target_hash(ai_jobs) TO service_role;

COMMIT;
