import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcePreparationEngine } from '../SourcePreparationEngine';
import { AiJobRepository, DictionaryRepository, SentenceRepository, TermRepository } from '../../../repositories';

vi.mock('../../../repositories', () => ({
  AiJobRepository: {
    add: vi.fn(),
    claimJob: vi.fn(),
    delete: vi.fn(),
    getByTarget: vi.fn(),
    updateStatuses: vi.fn(),
  },
  DictionaryRepository: {
    getByIds: vi.fn(),
  },
  SentenceRepository: {
    getAll: vi.fn(),
    getById: vi.fn(),
    getBySourceId: vi.fn(),
    update: vi.fn(),
  },
  TermRepository: {
    getBySentencesWithDictionary: vi.fn(),
  },
}));

vi.mock('../../../services/aiJobService', () => ({
  AiJobService: {
    processJobsBatch: vi.fn().mockResolvedValue({ success: true, successCount: 1, errorCount: 0 }),
  },
}));

const now = new Date('2026-06-17T12:00:00.000Z');

function sentence(overrides: Record<string, unknown>) {
  return {
    id: 's',
    source_id: 'source-1',
    user_id: 'user-1',
    order_index: 0,
    japanese: '待って',
    japanese_key: '待って',
    portuguese: null,
    kana: null,
    romaji: null,
    status: 'raw',
    tags: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...overrides,
  } as any;
}

function job(overrides: Record<string, unknown>) {
  return {
    id: 'job',
    user_id: 'user-1',
    type: 'batch_translate_sentences',
    target_type: 'batch',
    target_id: 'source-1',
    status: 'pending',
    input_hash: 'hash',
    input: { items: [{ id: 's1' }] },
    result: null,
    error: null,
    created_at: now.toISOString(),
    completed_at: null,
    ...overrides,
  } as any;
}

function entry(overrides: Record<string, unknown>) {
  return {
    id: 'd1',
    user_id: 'user-1',
    lemma: '行く',
    kana: 'いく',
    romaji: 'iku',
    type: 'verbo',
    jlpt_level: null,
    status: 'ai_enriched',
    tags: [],
    unique_key: '行く|いく|verbo',
    main_meaning: 'ir',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...overrides,
  } as any;
}

describe('SourcePreparationEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([]);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue([]);
    vi.mocked(TermRepository.getBySentencesWithDictionary).mockResolvedValue([]);
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([]);
    vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([]);
    vi.mocked(AiJobRepository.add).mockImplementation(async (input: any) => ({ id: `job-${input.input_hash}`, ...input } as any));
    vi.mocked(AiJobRepository.updateStatuses).mockResolvedValue(true);
  });

  it('diagnoses an empty source without jobs or AI targets', async () => {
    const diagnosis = await SourcePreparationEngine.diagnoseSource('source-1', now);

    expect(diagnosis.sentences.total).toBe(0);
    expect(diagnosis.sentences.needsAiTranslation).toBe(0);
    expect(diagnosis.dictionary.needsAiEntries).toBe(0);
    expect(diagnosis.jobs.pending).toBe(0);
  });

  it('diagnoses untranslated, repeated and reusable sentences', async () => {
    const sourceSentences = [
      sentence({ id: 's1', japanese: '待って', japanese_key: '待って' }),
      sentence({ id: 's2', japanese: '待って', japanese_key: '待って' }),
      sentence({ id: 's3', japanese: '行くぞ', japanese_key: '行くぞ' }),
    ];
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue(sourceSentences);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue([
      ...sourceSentences,
      sentence({ id: 'other-1', source_id: 'source-2', japanese: '行くぞ', japanese_key: '行くぞ', portuguese: 'Vamos.' }),
    ]);

    const diagnosis = await SourcePreparationEngine.diagnoseSource('source-1', now);

    expect(diagnosis.sentences.total).toBe(3);
    expect(diagnosis.sentences.unique).toBe(2);
    expect(diagnosis.sentences.repeatedInsideSource).toBe(1);
    expect(diagnosis.sentences.reusableTranslation).toBe(1);
    expect(diagnosis.sentences.needsAiTranslation).toBe(2);
  });

  it('diagnoses lexical analysis and complete or incomplete dictionary entries', async () => {
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 's1', kana: 'いく', romaji: 'iku', portuguese: 'Vou.' }),
      sentence({ id: 's2', portuguese: 'Sem termos.' }),
    ]);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue([
      sentence({ id: 's1', kana: 'いく', romaji: 'iku', portuguese: 'Vou.' }),
      sentence({ id: 's2', portuguese: 'Sem termos.' }),
    ]);
    vi.mocked(TermRepository.getBySentencesWithDictionary).mockResolvedValue([
      {
        id: 't1',
        sentence_id: 's1',
        dictionary_form_id: 'f1',
        dictionary_entry_id: 'd-complete',
        form: { dictionary_entry_id: 'd-complete', entry: entry({ id: 'd-complete' }) },
      },
      {
        id: 't2',
        sentence_id: 's2',
        dictionary_form_id: 'f2',
        dictionary_entry_id: 'd-incomplete',
        form: { dictionary_entry_id: 'd-incomplete', entry: entry({ id: 'd-incomplete', main_meaning: null }) },
      },
    ] as any);
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
      entry({ id: 'd-complete' }),
      entry({ id: 'd-incomplete', main_meaning: null, status: 'pending' }),
    ]);

    const diagnosis = await SourcePreparationEngine.diagnoseSource('source-1', now);

    expect(diagnosis.sentences.withValidLexicalAnalysis).toBe(1);
    expect(diagnosis.sentences.withoutValidLexicalAnalysis).toBe(1);
    expect(diagnosis.terms.found).toBe(2);
    expect(diagnosis.terms.linkedToExistingEntries).toBe(2);
    expect(diagnosis.dictionary.completeEntries).toBe(1);
    expect(diagnosis.dictionary.needsAiEntries).toBe(1);
  });

  it('diagnoses pending, running, error, stuck and duplicate jobs', async () => {
    vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([
      job({ id: 'p', status: 'pending', input: { items: [{ id: 's1' }] } }),
      job({ id: 'r', status: 'running', input: { items: [{ id: 's2' }] } }),
      job({ id: 'e', status: 'error', input: { items: [{ id: 's3' }] } }),
      job({
        id: 'stuck',
        status: 'running',
        locked_until: '2026-06-17T11:00:00.000Z',
        input: { items: [{ id: 's4' }] },
      }),
      job({ id: 'dup-a', status: 'pending', input: { items: [{ id: 'dup' }] } }),
      job({ id: 'dup-b', status: 'completed', input: { items: [{ id: 'dup' }] } }),
    ]);

    const diagnosis = await SourcePreparationEngine.diagnoseSource('source-1', now);

    expect(diagnosis.jobs.pending).toBe(2);
    expect(diagnosis.jobs.running).toBe(2);
    expect(diagnosis.jobs.error).toBe(1);
    expect(diagnosis.jobs.stuck).toBe(1);
    expect(diagnosis.jobs.completed).toBe(1);
    expect(diagnosis.jobs.possibleDuplicates).toBe(2);
  });

  it('builds an idempotent plan that ignores translated, reusable, queued, running, completed, errored and stuck targets', async () => {
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 'translated', portuguese: 'Pronto.' }),
      sentence({ id: 'reusable', japanese: 'ある', japanese_key: 'ある' }),
      sentence({ id: 'missing' }),
      sentence({ id: 'pending-target', japanese: '一', japanese_key: '一' }),
      sentence({ id: 'running-target', japanese: '二', japanese_key: '二' }),
      sentence({ id: 'completed-target', japanese: '三', japanese_key: '三' }),
      sentence({ id: 'error-target', japanese: '四', japanese_key: '四' }),
      sentence({ id: 'stuck-target', japanese: '五', japanese_key: '五' }),
    ]);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue([
      sentence({ id: 'source-reusable', source_id: 'source-2', japanese: 'ある', japanese_key: 'ある', portuguese: 'Existe.' }),
    ]);
    vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([
      job({ id: 'pending', status: 'pending', input: { items: [{ id: 'pending-target' }] } }),
      job({ id: 'running', status: 'running', input: { items: [{ id: 'running-target' }] } }),
      job({ id: 'completed', status: 'completed', input: { items: [{ id: 'completed-target' }] } }),
      job({ id: 'error', status: 'error', input: { items: [{ id: 'error-target' }] } }),
      job({ id: 'stuck', status: 'running', locked_until: '2026-06-17T11:00:00.000Z', input: { items: [{ id: 'stuck-target' }] } }),
    ]);

    const plan = await SourcePreparationEngine.buildPlan('source-1', { translateBatchSize: 20 }, now);

    expect(plan.reuse.translations).toHaveLength(1);
    expect(plan.totals.translationItems).toBe(1);
    expect(plan.jobs.translation[0].input.items).toEqual([{ id: 'missing', japanese: '待って' }]);
    expect(plan.blocked.errors).toHaveLength(1);
    expect(plan.blocked.stuck).toHaveLength(1);
  });

  it('creates queue jobs from the plan and applies reusable translations without deleting completed jobs', async () => {
    const plan = await SourcePreparationEngine.buildPlan('source-1', {}, now);
    plan.reuse.translations.push({ sentenceId: 's-cache', reusableSentenceId: 'old', translation: 'Cache.' });
    plan.jobs.translation.push({
      type: 'batch_translate_sentences',
      targetType: 'batch',
      targetId: 'source-1',
      stage: 'translation',
      label: 'Traduzir frases - lote 1/1',
      itemCount: 1,
      input: { sourceId: 'source-1', stage: 'translation', label: 'Traduzir frases - lote 1/1', items: [{ id: 's1', japanese: '待って' }] },
      targetKeys: ['batch_translate_sentences:s1'],
    });
    vi.mocked(SentenceRepository.getById).mockResolvedValue(sentence({ id: 's-cache' }));

    const jobs = await SourcePreparationEngine.createQueueFromPlan(plan);

    expect(SentenceRepository.update).toHaveBeenCalledWith('s-cache', expect.objectContaining({ translation_source: 'cache' }));
    expect(AiJobRepository.add).toHaveBeenCalledWith(expect.objectContaining({
      type: 'batch_translate_sentences',
      target_id: 'source-1',
      input: expect.objectContaining({ label: 'Traduzir frases - lote 1/1' }),
    }));
    expect(AiJobRepository.delete).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(1);
  });

  it('handles a realistic 300 sentence source without duplicate queue generation or repeated translation', async () => {
    const firstSource = Array.from({ length: 300 }, (_, index) =>
      sentence({
        id: `s-${index}`,
        japanese: `文${index}`,
        japanese_key: `文${index}`,
      }),
    );
    const createdJobs: any[] = [];
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue(firstSource);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue(firstSource);
    vi.mocked(AiJobRepository.getByTarget).mockImplementation(async () => createdJobs);
    vi.mocked(AiJobRepository.add).mockImplementation(async (input: any) => {
      const existing = createdJobs.find(
        (job) =>
          job.type === input.type &&
          job.target_type === input.target_type &&
          job.target_id === input.target_id &&
          job.input_hash === input.input_hash,
      );
      if (existing) return existing;
      const created = job({
        id: `job-${createdJobs.length}`,
        ...input,
      });
      createdJobs.push(created);
      return created;
    });

    const first = await SourcePreparationEngine.createQueueForSource('source-1', {
      translateBatchSize: 30,
      analyzeBatchSize: 10,
      dictionaryBatchSize: 12,
    });
    const second = await SourcePreparationEngine.createQueueForSource('source-1', {
      translateBatchSize: 30,
      analyzeBatchSize: 10,
      dictionaryBatchSize: 12,
    });

    expect(first.plan.totals.translationItems).toBe(300);
    expect(first.plan.totals.translationJobs).toBe(10);
    expect(first.plan.totals.lexicalAnalysisJobs).toBe(30);
    expect(createdJobs).toHaveLength(40);
    expect(second.plan.totals.jobs).toBe(0);

    const reused = sentence({ id: 'other-source-same', source_id: 'source-2', japanese: '文42', japanese_key: '文42' });
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([reused]);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue([
      reused,
      sentence({
        id: 'translated-from-first',
        source_id: 'source-1',
        japanese: '文42',
        japanese_key: '文42',
        portuguese: 'Frase 42.',
      }),
    ]);
    vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([]);
    vi.mocked(SentenceRepository.getById).mockResolvedValue(reused);

    const reusePlan = await SourcePreparationEngine.buildPlan('source-2', { translateBatchSize: 30 }, now);

    expect(reusePlan.reuse.translations).toHaveLength(1);
    expect(reusePlan.totals.translationItems).toBe(0);
  });
});
