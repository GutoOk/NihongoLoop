import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_QUEUE_SCHEMA_VERSION, getErrorMessage, getJobInput, normalizeLexicalTermsForPersistence, processPrepareSentenceJob, processTranslateSentenceJob } from '../queueWorker';
import { generateStructuredJsonWithMeta } from '../../geminiJson';

vi.mock('../../geminiJson', () => ({
  generateStructuredJsonWithMeta: vi.fn(),
}));

const schema = readFileSync(resolve(process.cwd(), 'schema.sql'), 'utf8');

function functionBody(name: string) {
  const start = schema.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = schema.indexOf('\n$$;', start);
  return schema.slice(start, end);
}

function makeClient(canExecute: boolean) {
  const job = {
    can_execute: canExecute,
    id: 'job-1',
    user_id: 'user-1',
    type: 'translate_sentence',
    target_type: 'sentence',
    target_id: 'sentence-1',
    status: 'running',
    worker_id: 'worker-1',
    payload: { id: 'sentence-1', sentence: '\u5f85\u3063\u3066', japanese: '\u5f85\u3063\u3066' },
  };
  return {
    rpc: vi.fn(async (name: string) => {
      if (name === 'start_claimed_ai_job') return { data: job, error: null };
      if (name === 'validate_ai_job_for_execution') return { data: canExecute ? job : { can_execute: false }, error: null };
      if (name === 'apply_sentence_translation_result') return { data: { sentence_id: 'sentence-1' }, error: null };
      return { data: null, error: null };
    }),
  } as any;
}

function makePrepareClient(canExecute: boolean) {
  const job = {
    can_execute: canExecute,
    id: 'job-prepare-1',
    user_id: 'user-1',
    type: 'prepare_sentence',
    target_type: 'sentence',
    target_id: 'sentence-1',
    status: 'running',
    worker_id: 'worker-1',
    payload: { id: 'sentence-1', sentence: '待って', japanese: '待って' },
  };
  return {
    rpc: vi.fn(async (name: string) => {
      if (name === 'start_claimed_ai_job') return { data: job, error: null };
      if (name === 'validate_ai_job_for_execution') return { data: canExecute ? job : { can_execute: false }, error: null };
      if (name === 'apply_sentence_preparation_result') return { data: { sentence_id: 'sentence-1' }, error: null };
      return { data: null, error: null };
    }),
  } as any;
}

describe('queueWorker persisted execution contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes a database-validated fresh job', async () => {
    vi.mocked(generateStructuredJsonWithMeta).mockResolvedValueOnce({
      data: { translation: 'Wait.' },
      meta: { model: 'fake', temperature: 0, latency_ms: 1, input_chars: 1, output_chars: 1 },
    } as any);
    const client = makeClient(true);

    await processTranslateSentenceJob(client, { id: 'job-1' } as any, 'worker-1', 300, vi.fn(() => ({})) as any);

    expect(client.rpc).toHaveBeenCalledWith('validate_ai_job_for_execution', { p_job_id: 'job-1', p_worker_id: 'worker-1' });
    expect(generateStructuredJsonWithMeta).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('apply_sentence_translation_result', expect.objectContaining({ p_job_id: 'job-1' }));
  });

  it('skips Gemini when the database invalidates a changed target', async () => {
    const client = makeClient(false);

    await processTranslateSentenceJob(client, { id: 'job-1' } as any, 'worker-1', 300, vi.fn(() => ({})) as any);

    expect(generateStructuredJsonWithMeta).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalledWith('apply_sentence_translation_result', expect.anything());
  });

  it('uses input when payload is empty and extracts object error messages', () => {
    expect(getJobInput({ payload: {}, input: { japanese: '待って' } } as any)).toEqual({ japanese: '待って' });
    expect(getErrorMessage({ error: { message: 'This model is currently experiencing high demand' } })).toBe('This model is currently experiencing high demand');
  });

  it('prepares translation, reading and terms with one Gemini request and one job apply', async () => {
    vi.mocked(generateStructuredJsonWithMeta).mockResolvedValueOnce({
      data: { translation: 'Espere.', kana: '\u307e\u3063\u3066', romaji: 'matte', terms: [{ surface: '\u5f85\u3063\u3066', lemma: '\u5f85\u3064', start_index: 0, end_index: 2, type: 'verbo' }] },
      meta: { model: 'fake', temperature: 0, latency_ms: 1, input_chars: 1, output_chars: 1 },
    } as any);
    const client = makePrepareClient(true);

    await processPrepareSentenceJob(client, { id: 'job-prepare-1' } as any, 'worker-1', 300, vi.fn(() => ({})) as any);

    expect(generateStructuredJsonWithMeta).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('apply_sentence_preparation_result', expect.objectContaining({
      p_job_id: 'job-prepare-1',
      p_translation: 'Espere.',
      p_kana: '\u307e\u3063\u3066',
      p_romaji: 'matte',
    }));
    expect(client.rpc).not.toHaveBeenCalledWith('apply_sentence_translation_result', expect.anything());
    expect(client.rpc).not.toHaveBeenCalledWith('apply_sentence_lexical_analysis_result', expect.anything());
  });

  it('repairs sentence preparation term offsets before persisting AI output', async () => {
    const sentence = 'ンッ… やっと２人とも落ち着いたか';
    const client = {
      rpc: vi.fn(async (name: string) => {
        if (name === 'start_claimed_ai_job') return {
          data: {
            can_execute: true,
            id: 'job-prepare-1',
            user_id: 'user-1',
            type: 'prepare_sentence',
            target_type: 'sentence',
            target_id: 'sentence-1',
            status: 'running',
            worker_id: 'worker-1',
            payload: { id: 'sentence-1', sentence, japanese: sentence },
          },
          error: null,
        };
        if (name === 'validate_ai_job_for_execution') return {
          data: {
            can_execute: true,
            id: 'job-prepare-1',
            user_id: 'user-1',
            type: 'prepare_sentence',
            target_type: 'sentence',
            target_id: 'sentence-1',
            status: 'running',
            worker_id: 'worker-1',
            payload: { id: 'sentence-1', sentence, japanese: sentence },
          },
          error: null,
        };
        if (name === 'apply_sentence_preparation_result') return { data: { sentence_id: 'sentence-1' }, error: null };
        return { data: null, error: null };
      }),
    } as any;
    vi.mocked(generateStructuredJsonWithMeta).mockResolvedValueOnce({
      data: {
        translation: 'Hã... finalmente os dois se acalmaram?',
        kana: 'ンッ… やっと ふたりとも おちついたか',
        romaji: 'n… yatto futari tomo ochitsuita ka',
        terms: [
          { surface: 'ンッ', lemma: 'ンッ', start_index: 0, end_index: 3, type: 'interjeicao' },
          { surface: 'やっと', lemma: 'やっと', start_index: 4, end_index: 7, type: 'adverbio' },
          { surface: '２人', lemma: '二人', start_index: 8, end_index: 10, type: 'substantivo' },
          { surface: 'とも', lemma: 'とも', start_index: 10, end_index: 12, type: 'particula' },
          { surface: '落ち着いた', lemma: '落ち着く', start_index: 13, end_index: 18, type: 'verbo' },
          { surface: 'か', lemma: 'か', start_index: 18, end_index: 19, type: 'particula' },
        ],
      },
      meta: { model: 'fake', temperature: 0, latency_ms: 1, input_chars: 1, output_chars: 1 },
    } as any);

    await processPrepareSentenceJob(client, { id: 'job-prepare-1' } as any, 'worker-1', 300, vi.fn(() => ({})) as any);

    expect(client.rpc).toHaveBeenCalledWith('apply_sentence_preparation_result', expect.objectContaining({
      p_terms: [
        expect.objectContaining({ surface: 'ンッ', start_index: 0, end_index: 2 }),
        expect.objectContaining({ surface: 'やっと', start_index: 4, end_index: 7 }),
        expect.objectContaining({ surface: '２人', start_index: 7, end_index: 9 }),
        expect.objectContaining({ surface: 'とも', start_index: 9, end_index: 11 }),
        expect.objectContaining({ surface: '落ち着いた', start_index: 11, end_index: 16 }),
        expect.objectContaining({ surface: 'か', start_index: 16, end_index: 17 }),
      ],
    }));
  });

  it('normalizes lexical terms by repairing offsets and discarding unrecoverable terms', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const terms = normalizeLexicalTermsForPersistence('\u5f85\u3063\u3066', [
      { surface: '\u5f85\u3063\u3066', lemma: '\u5f85\u3064', start_index: 0, end_index: 2, type: 'verbo' },
      { surface: '\u306a\u3044', lemma: '\u306a\u3044', start_index: 0, end_index: 2, type: 'auxiliar' },
      null,
    ]);

    expect(terms).toEqual([
      expect.objectContaining({ surface: '\u5f85\u3063\u3066', start_index: 0, end_index: 3 }),
    ]);
    expect(info).toHaveBeenCalledWith('[ai-worker] lexical terms normalized', expect.objectContaining({
      received: 3,
      repaired: 1,
      kept: 1,
      discarded: 2,
      discardedReasons: { invalid_offsets: 1, term_not_object: 1 },
    }));
    info.mockRestore();
  });

  it('rejects empty terms for normal Japanese sentence preparation', async () => {
    vi.mocked(generateStructuredJsonWithMeta).mockResolvedValueOnce({
      data: { translation: 'Espere.', kana: '\u307e\u3063\u3066', romaji: 'matte', terms: [] },
      meta: { model: 'fake', temperature: 0, latency_ms: 1, input_chars: 1, output_chars: 1 },
    } as any);

    await expect(processPrepareSentenceJob(makePrepareClient(true), { id: 'job-prepare-1' } as any, 'worker-1', 300, vi.fn(() => ({})) as any))
      .rejects.toThrow('lista de termos vazia');
  });

  it('marks permanent invalid job input as final without retry wait', () => {
    const body = functionBody('fail_ai_job_for_retry');
    expect(body).toContain("IF p_error_kind = 'permanent' THEN");
    expect(body.indexOf("IF p_error_kind = 'permanent' THEN")).toBeLessThan(body.indexOf("terminal_status := 'retry_wait'"));
  });

  it('continues orchestration around terminal failures for other targets', () => {
    const body = functionBody('create_or_resume_source_processing_run');
    expect(body).toContain("status IN ('failed','needs_review')");
    expect(body).toContain("old.type = 'prepare_sentence'");
    expect(body).toContain("old.type = 'detect_sentence_terms'");
    expect(body).toContain("old.type = 'enrich_dictionary_entry'");
    expect(body).not.toContain("'Falha terminal exige retry manual.'");
  });

  it('uses unified sentence preparation orchestration', () => {
    const body = functionBody('create_or_resume_source_processing_run');
    expect(body).toContain("old.type = 'prepare_sentence'");
    expect(body).toContain("selected_stage := 'sentence_preparation'");
    expect(body).toContain("'prepare_sentence' AS type");
    expect(body.indexOf("'prepare_sentence' AS type")).toBeLessThan(body.indexOf("'enrich_dictionary_entry' AS type"));
    expect(schema).toContain('CREATE OR REPLACE FUNCTION public.apply_sentence_preparation_result');
    expect(schema).toContain('public.build_ai_job_current_target_hash(current_job ai_jobs)');
  });

  it('sentence preparation completes with valid terms when some AI offsets are invalid', () => {
    const body = functionBody('apply_sentence_preparation_result');
    expect(body).toContain('SELECT COUNT(*) INTO invalid_offset_count');
    expect(body).toContain('CREATE TEMP TABLE tmp_lexical_terms ON COMMIT DROP AS');
    expect(body).toContain('WHERE start_index >= 0');
    expect(body).toContain('SUBSTRING(current_sentence.japanese FROM start_index + 1 FOR end_index - start_index) = surface');
    expect(body).toContain("'invalid_offset_count', invalid_offset_count");
    expect(body).not.toContain("'Offsets lexicais invalidos; reanalise manual necessaria.'");
    expect(body).not.toContain("RETURN jsonb_build_object('needs_review'");
  });

  it('manual retry creates a new job preserving the previous one', () => {
    const body = functionBody('retry_ai_jobs');
    expect(body).toContain('retry_of_job_id');
    expect(body).toContain('INSERT INTO ai_jobs');
    expect(body).not.toContain("SET status = 'pending'");
  });

  it('dictionary enrichment replaces preliminary fields with AI values', () => {
    const body = functionBody('apply_dictionary_enrichment_result').replace(/\r\n/g, '\n');
    expect(body).toContain("v_main_meaning := COALESCE(\n    NULLIF(p_enrichment->>'main_meaning', '')");
    expect(body).toContain("jlpt_level = COALESCE(NULLIF(p_enrichment->>'jlpt_level', ''), dictionary_entries.jlpt_level)");
    expect(body).not.toContain("COALESCE(dictionary_entries.jlpt_level, NULLIF(p_enrichment->>'jlpt_level'");
  });

  it('reviewed dictionary entries are completed without overwrite', () => {
    const body = functionBody('apply_dictionary_enrichment_result');
    const reviewed = body.indexOf("IF current_entry.status = 'reviewed' THEN");
    const update = body.indexOf('UPDATE dictionary_entries');
    expect(reviewed).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(reviewed);
    expect(body.slice(reviewed, update)).toContain("'already_reviewed'");
  });

  it('lexical RPC rejects invalid offsets instead of realigning terms', () => {
    const body = functionBody('apply_sentence_lexical_analysis_result');
    expect(body).not.toContain('generate_series');
    expect(body).not.toContain('ORDER BY ABS');
    expect(body).toContain('SUBSTRING(current_sentence.japanese FROM r.start_index + 1 FOR r.end_index - r.start_index) = r.surface');
    expect(body).toContain('invalid_offset_count');
  });

  it('current lexical RPC applies corrected offsets without realignment', () => {
    const body = functionBody('apply_sentence_lexical_analysis_result');
    expect(body).toContain('SUBSTRING(current_sentence.japanese FROM r.start_index + 1 FOR r.end_index - r.start_index) = r.surface');
    expect(body).toContain('public.digest');
    expect(body).toContain('start_index IS NOT NULL');
    expect(body).toContain('end_index IS NOT NULL');
    expect(body).toContain('end_index > start_index');
    expect(body).toContain('SELECT DISTINCT ON (surface, lemma, start_index, end_index)');
    expect(body).toContain("e.id::TEXT || '|' || LOWER(REGEXP_REPLACE(t.surface");
    expect(body).not.toContain('generate_series');
    expect(body).not.toContain('ORDER BY ABS');
    expect(body).not.toContain('position(');
  });

  it('lexical integrity reports invalid offsets without realigning terms', () => {
    const body = functionBody('apply_sentence_lexical_analysis_result');
    expect(body).toContain('invalid_offset_count INTEGER := 0');
    expect(body).toContain('SELECT COUNT(*) INTO invalid_offset_count');
    expect(body).toContain("'invalid_offset_count', invalid_offset_count");
    expect(body).toContain("SET terms_source = CASE WHEN inserted_terms > 0 THEN 'ai' ELSE 'ai_empty' END");
  });

  it('lexical reset excludes reviewed sentences and preserves dictionary data', () => {
    const body = functionBody('reset_source_lexical_analysis');
    expect(body).toContain("s.status <> 'reviewed'");
    expect(body).toContain('DELETE FROM sentence_terms');
    expect(body).not.toContain('DELETE FROM dictionary_entries');
    expect(body).not.toContain('DELETE FROM dictionary_forms');
    expect(body).not.toContain('DELETE FROM dictionary_senses');
  });

  it('lexical reset invalidates selected lexical jobs without deleting history', () => {
    const body = functionBody('reset_source_lexical_analysis');
    expect(body).toContain("j.status IN ('pending','claimed','retry_wait')");
    expect(body).toContain("SET status = 'cancelled'");
    expect(body).toContain("j.status = 'running'");
    expect(body).toContain("SET cancel_requested = TRUE");
    expect(body).toContain("j.status IN ('needs_review','failed','error')");
    expect(body).toContain("SET status = 'obsolete'");
    expect(body).toContain('MANUAL_LEXICAL_RESET');
    expect(body).toContain('PERFORM refresh_processing_run_snapshot(run_id)');
  });

  it('lexical summary includes terminal invalid offset jobs', () => {
    const body = functionBody('get_source_lexical_integrity_summary');
    expect(body).toContain('terminal_offset_jobs AS');
    expect(body).toContain("AND error_code = 'INVALID_LEXICAL_OFFSETS'");
    expect(body).toContain('it.invalid_count > 0 OR toj.sentence_id IS NOT NULL');
  });

  it('normalizes lexical types and keeps form_type-specific form joins', () => {
    const normalizationBody = functionBody('normalize_lexical_type');
    const lexicalBody = functionBody('apply_sentence_lexical_analysis_result');
    expect(schema).toContain('CREATE OR REPLACE FUNCTION public.normalize_lexical_type');
    expect(normalizationBody).toContain("WHEN value IN ('particula','particle') THEN 'particula'");
    expect(lexicalBody).toContain('form_type');
    expect(lexicalBody).toContain('JOIN tmp_forms f ON f.dictionary_entry_id = e.id AND f.form = t.surface');
  });

  it('schema has one final commit after v26 functions', () => {
    const normalizedSchema = schema.replace(/\r\n/g, '\n').trim();
    expect((normalizedSchema.match(/\nCOMMIT;/g) || []).length).toBe(1);
    expect(normalizedSchema.endsWith('COMMIT;')).toBe(true);
    expect(normalizedSchema.indexOf('CREATE OR REPLACE FUNCTION public.mark_ai_job_needs_review')).toBeGreaterThan(normalizedSchema.indexOf('BEGIN;'));
    expect(normalizedSchema.indexOf('CREATE OR REPLACE FUNCTION public.mark_ai_job_needs_review')).toBeLessThan(normalizedSchema.lastIndexOf('COMMIT;'));
  });

  it('keeps worker schema version aligned with the database baseline', () => {
    expect(schema).toContain(`VALUES ('ai_queue', '${AI_QUEUE_SCHEMA_VERSION}')`);
  });

  it('ignores expired or cancelled active jobs when calculating claim capacity', () => {
    const body = functionBody('claim_ai_jobs');
    expect(body).toContain("active_jobs.lease_expires_at");
    expect(body).toContain("active_runs.status = 'running'");
    expect(body).toContain("COALESCE(active_runs.cancel_requested, FALSE) = FALSE");
    expect(body).toContain("active_user.lease_expires_at");
    expect(body).toContain("active_type.lease_expires_at");
  });

  it('needs_review transition records review metrics instead of failed metrics', () => {
    const body = functionBody('mark_ai_job_needs_review');
    expect(body).toContain('updated_at = NOW()');
    expect(body).toContain('needs_review_jobs = needs_review_jobs + 1');
    expect(body).not.toContain('failed_jobs = failed_jobs + 1');
    expect(body).toContain('AND completed_at IS NULL');
  });
});
