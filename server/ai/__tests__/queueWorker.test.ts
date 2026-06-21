import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getErrorMessage, getJobInput, processPrepareSentenceJob, processTranslateSentenceJob } from '../queueWorker';
import { generateStructuredJsonWithMeta } from '../../geminiJson';

vi.mock('../../geminiJson', () => ({
  generateStructuredJsonWithMeta: vi.fn(),
}));

const schema = readFileSync(resolve(process.cwd(), 'schema.sql'), 'utf8');
const lexicalOffsetMigration = readFileSync(resolve(process.cwd(), 'supabase/migration_v25_lexical_offset_validation.sql'), 'utf8');
const lexicalIntegrityMigration = readFileSync(resolve(process.cwd(), 'supabase/migration_v26_lexical_integrity_and_unicode.sql'), 'utf8');
const continueAfterFailureMigration = readFileSync(resolve(process.cwd(), 'supabase/migration_v27_continue_ai_queue_after_job_failures.sql'), 'utf8');
const unifiedSentencePreparationMigration = readFileSync(resolve(process.cwd(), 'supabase/migration_v28_unified_sentence_preparation.sql'), 'utf8');
const normalizedLexicalOffsetMigration = lexicalOffsetMigration.replace(/\r\n/g, '\n');
const normalizedLexicalIntegrityMigration = lexicalIntegrityMigration.replace(/\r\n/g, '\n');

function functionBody(name: string) {
  const start = schema.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = schema.indexOf('\n$$;', start);
  return schema.slice(start, end);
}

function sqlFunctionBody(source: string, name: string) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = source.indexOf('\n$$;', start);
  return source.slice(start, end);
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

  it('ships the continue-after-failure orchestration migration', () => {
    expect(continueAfterFailureMigration).toContain('CREATE OR REPLACE FUNCTION public.create_or_resume_source_processing_run');
    expect(continueAfterFailureMigration).toContain("old.type = 'translate_sentence'");
    expect(continueAfterFailureMigration).toContain("old.type = 'detect_sentence_terms'");
    expect(continueAfterFailureMigration).toContain("old.type = 'enrich_dictionary_entry'");
    expect(continueAfterFailureMigration).not.toContain("'Falha terminal exige retry manual.'");
    expect(continueAfterFailureMigration.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('ships unified sentence preparation orchestration', () => {
    const body = functionBody('create_or_resume_source_processing_run');
    expect(body).toContain("old.type = 'prepare_sentence'");
    expect(body).toContain("selected_stage := 'sentence_preparation'");
    expect(body).toContain("'prepare_sentence' AS type");
    expect(body.indexOf("'prepare_sentence' AS type")).toBeLessThan(body.indexOf("'enrich_dictionary_entry' AS type"));
    expect(schema).toContain('CREATE OR REPLACE FUNCTION public.apply_sentence_preparation_result');
    expect(schema).toContain('public.build_ai_job_current_target_hash(current_job ai_jobs)');
    expect(unifiedSentencePreparationMigration).toContain('CREATE OR REPLACE FUNCTION public.create_or_resume_source_processing_run');
    expect(unifiedSentencePreparationMigration).toContain('CREATE OR REPLACE FUNCTION public.apply_sentence_preparation_result');
    expect(unifiedSentencePreparationMigration.trim().endsWith('COMMIT;')).toBe(true);
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

  it('lexical offset migration applies the corrected RPC without realignment', () => {
    expect(lexicalOffsetMigration).toContain('CREATE OR REPLACE FUNCTION public.apply_sentence_lexical_analysis_result');
    expect(lexicalOffsetMigration).toContain('SUBSTRING(current_sentence.japanese FROM r.start_index + 1 FOR r.end_index - r.start_index) = r.surface');
    expect(lexicalOffsetMigration).toContain('BEGIN;');
    expect(normalizedLexicalOffsetMigration).toContain('END;\n$$;\n\nCOMMIT;');
    expect(lexicalOffsetMigration).toContain('WHERE user_id = auth.uid()::text');
    expect(lexicalOffsetMigration).toContain('public.digest');
    expect(lexicalOffsetMigration).toContain('r.start_index >= 0');
    expect(lexicalOffsetMigration).toContain('ORDER BY surface, lemma, start_index, end_index, confidence DESC');
    expect(lexicalOffsetMigration).toContain("JOIN tmp_forms f ON f.unique_key = e.id::TEXT || '|'");
    expect(lexicalOffsetMigration).not.toContain('generate_series');
    expect(lexicalOffsetMigration).not.toContain('ORDER BY ABS');
    expect(lexicalOffsetMigration).not.toContain('position(');
  });

  it('lexical integrity migration prevents partial invalid writes', () => {
    const body = sqlFunctionBody(lexicalIntegrityMigration, 'apply_sentence_lexical_analysis_result');
    expect(body).toContain('invalid_offset_count > 0');
    expect(body).toContain('mark_ai_job_needs_review');
    expect(body).toContain('Offsets lexicais invalidos; reanalise manual necessaria.');
    expect(body.indexOf('invalid_offset_count > 0')).toBeLessThan(body.indexOf('UPDATE sentences'));
    expect(body.indexOf('invalid_offset_count > 0')).toBeLessThan(body.indexOf('DELETE FROM sentence_terms'));
    expect(body).toContain("SET terms_source = CASE WHEN inserted_terms > 0 THEN 'ai' ELSE 'ai_empty' END");
  });

  it('lexical reset excludes reviewed sentences and preserves dictionary data', () => {
    expect(lexicalIntegrityMigration).toContain("s.status <> 'reviewed'");
    expect(lexicalIntegrityMigration).toContain('DELETE FROM sentence_terms');
    expect(lexicalIntegrityMigration).not.toContain('DELETE FROM dictionary_entries');
    expect(lexicalIntegrityMigration).not.toContain('DELETE FROM dictionary_forms');
    expect(lexicalIntegrityMigration).not.toContain('DELETE FROM dictionary_senses');
  });

  it('lexical reset invalidates selected lexical jobs without deleting history', () => {
    expect(lexicalIntegrityMigration).toContain("j.status IN ('pending','claimed','retry_wait')");
    expect(lexicalIntegrityMigration).toContain("SET status = 'cancelled'");
    expect(lexicalIntegrityMigration).toContain("j.status = 'running'");
    expect(lexicalIntegrityMigration).toContain("SET cancel_requested = TRUE");
    expect(lexicalIntegrityMigration).toContain("j.status IN ('needs_review','failed','error')");
    expect(lexicalIntegrityMigration).toContain("SET status = 'obsolete'");
    expect(lexicalIntegrityMigration).toContain('MANUAL_LEXICAL_RESET');
    expect(lexicalIntegrityMigration).toContain('PERFORM refresh_processing_run_snapshot(run_id)');
  });

  it('lexical summary includes terminal invalid offset jobs', () => {
    expect(lexicalIntegrityMigration).toContain('terminal_offset_jobs AS');
    expect(lexicalIntegrityMigration).toContain("AND error_code = 'INVALID_LEXICAL_OFFSETS'");
    expect(lexicalIntegrityMigration).toContain('it.invalid_count > 0 OR toj.sentence_id IS NOT NULL');
  });

  it('normalizes lexical types and keeps form_type-specific form joins', () => {
    expect(lexicalIntegrityMigration).toContain('CREATE OR REPLACE FUNCTION public.normalize_lexical_type');
    expect(lexicalIntegrityMigration).toContain("WHEN value IN ('particula','particle') THEN 'particula'");
    expect(lexicalIntegrityMigration).toContain('public.normalize_lexical_type');
    expect(lexicalIntegrityMigration).toContain('JOIN tmp_forms f ON f.unique_key');
  });

  it('migration v26 is transactional and closes functions', () => {
    expect(normalizedLexicalIntegrityMigration.startsWith('BEGIN;\n')).toBe(true);
    expect(normalizedLexicalIntegrityMigration.trim().endsWith('COMMIT;')).toBe(true);
    expect(normalizedLexicalIntegrityMigration).toContain('END;\n$$;');
    expect(lexicalIntegrityMigration).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    expect(lexicalIntegrityMigration).toContain('v_pgcrypto_schema');
    expect(lexicalIntegrityMigration).toContain("format('SELECT %I.digest($1::bytea, $2)', v_pgcrypto_schema)");
    expect(lexicalIntegrityMigration).not.toContain('extensions.digest');
    expect(lexicalIntegrityMigration).toContain("public.digest(jsonb_build_object");
  });

  it('schema has one final commit after v26 functions', () => {
    const normalizedSchema = schema.replace(/\r\n/g, '\n').trim();
    expect((normalizedSchema.match(/\nCOMMIT;/g) || []).length).toBe(1);
    expect(normalizedSchema.endsWith('COMMIT;')).toBe(true);
    expect(normalizedSchema.indexOf('CREATE OR REPLACE FUNCTION public.mark_ai_job_needs_review')).toBeGreaterThan(normalizedSchema.indexOf('BEGIN;'));
    expect(normalizedSchema.indexOf('CREATE OR REPLACE FUNCTION public.mark_ai_job_needs_review')).toBeLessThan(normalizedSchema.lastIndexOf('COMMIT;'));
  });

  it('needs_review transition records review metrics instead of failed metrics', () => {
    const body = sqlFunctionBody(lexicalIntegrityMigration, 'mark_ai_job_needs_review');
    expect(body).toContain('updated_at = NOW()');
    expect(body).toContain('needs_review_jobs = needs_review_jobs + 1');
    expect(body).not.toContain('failed_jobs = failed_jobs + 1');
    expect(body).toContain('AND completed_at IS NULL');
  });
});
