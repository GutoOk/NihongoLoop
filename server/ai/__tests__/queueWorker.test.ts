import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processTranslateSentenceJob } from '../queueWorker';
import { generateStructuredJsonWithMeta } from '../../geminiJson';

vi.mock('../../geminiJson', () => ({
  generateStructuredJsonWithMeta: vi.fn(),
}));

const schema = readFileSync(resolve(process.cwd(), 'schema.sql'), 'utf8');
const lexicalOffsetMigration = readFileSync(resolve(process.cwd(), 'supabase/migration_v25_lexical_offset_validation.sql'), 'utf8');
const lexicalIntegrityMigration = readFileSync(resolve(process.cwd(), 'supabase/migration_v26_lexical_integrity_and_unicode.sql'), 'utf8');
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
    payload: { id: 'sentence-1', sentence: '待って', japanese: '待って' },
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

  it('does not auto-enqueue when a stage has terminal failures', () => {
    const body = functionBody('create_or_resume_source_processing_run');
    expect(body).toContain("status IN ('failed','needs_review')");
    expect(body).toContain("status = 'needs_review'");
    expect(body).toContain("'Falha terminal exige retry manual.'");
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
    expect(lexicalIntegrityMigration).toContain("public.digest(text,text)");
    expect(lexicalIntegrityMigration).toContain("public.digest(jsonb_build_object");
  });
});
