BEGIN;

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

  IF p_run_mode IN ('all','translate') AND EXISTS (
    SELECT 1 FROM sentences
    WHERE source_id = p_source_id AND user_id = p_user_id AND status <> 'reviewed' AND portuguese IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ai_jobs old
        WHERE old.run_id = selected_run.id
          AND old.type = 'translate_sentence'
          AND old.target_id = sentences.id
          AND old.status IN ('failed','needs_review')
      )
  ) THEN
    selected_stage := 'translation';
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
        encode(public.digest(jsonb_build_object(
          'targetType', 'sentence',
          'targetId', s.id,
          'payload', jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'sourceId', p_source_id),
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'::text), 'hex') AS target_hash,
        encode(public.digest(jsonb_build_object(
          'type', 'translate_sentence',
          'targetType', 'sentence',
          'targetId', s.id,
          'japanese', s.japanese,
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'::text), 'hex') AS input_hash,
        'translate_sentence:sentence:' || s.id || ':' || encode(public.digest(jsonb_build_object(
          'type', 'translate_sentence',
          'targetType', 'sentence',
          'targetId', s.id,
          'japanese', s.japanese,
          'promptVersion', p_prompt_version,
          'model', p_model
        )::text, 'sha256'::text), 'hex') AS job_key,
        p_prompt_version AS prompt_version,
        p_model AS model_version,
        p_model AS model,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'sourceId', p_source_id) AS payload,
        jsonb_build_object('id', s.id, 'sentence', s.japanese, 'japanese', s.japanese, 'sourceId', p_source_id) AS input,
        3 AS max_attempts
      FROM sentences s
      WHERE s.source_id = p_source_id AND s.user_id = p_user_id AND s.status <> 'reviewed' AND s.portuguese IS NULL
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

REVOKE ALL ON FUNCTION public.create_or_resume_source_processing_run(UUID, TEXT, TEXT, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.create_or_resume_source_processing_run(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

COMMIT;