import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcePreparationEngine } from '../SourcePreparationEngine';
import { AiJobRepository, DictionaryRepository, ProcessingRunRepository, SentenceRepository, TermRepository } from '../../../repositories';

vi.mock('../../../repositories', () => ({
  AiJobRepository: {
    add: vi.fn(),
    claimJob: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(),
    getByTarget: vi.fn(),
    getBySource: vi.fn(),
    updateStatuses: vi.fn(),
  },
  DictionaryRepository: {
    getByIds: vi.fn(),
  },
  ProcessingRunRepository: {
    createOrResumeRun: vi.fn(),
    requestCancel: vi.fn(),
    resumeRun: vi.fn(),
    updateRun: vi.fn(),
  },
  SentenceRepository: {
    findProcessedByJapaneseKeys: vi.fn(),
    getById: vi.fn(),
    getBySourceId: vi.fn(),
    update: vi.fn(),
  },
  TermRepository: {
    getBySentencesWithDictionary: vi.fn(),
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
    type: 'translate_sentence',
    target_type: 'sentence',
    target_id: 's1',
    status: 'pending',
    input_hash: 'hash',
    input: { id: 's1' },
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
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([]);
    vi.mocked(TermRepository.getBySentencesWithDictionary).mockResolvedValue([]);
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([]);
    vi.mocked(AiJobRepository.getAll).mockResolvedValue([]);
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([]);
    vi.mocked(AiJobRepository.add).mockImplementation(async (input: any) => ({ id: `job-${input.input_hash}`, ...input } as any));
    vi.mocked(AiJobRepository.updateStatuses).mockResolvedValue(true);
    vi.mocked(ProcessingRunRepository.createOrResumeRun).mockResolvedValue({
      id: 'run-1',
      source_id: 'source-1',
      status: 'pending',
      started_at: null,
    } as any);
    vi.mocked(ProcessingRunRepository.updateRun).mockResolvedValue(null);
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
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      ...sourceSentences,
      sentence({ id: 'other-1', source_id: 'source-2', japanese: '行くぞ', japanese_key: '行くぞ', portuguese: 'Vamos.' }),
    ]);

    const diagnosis = await SourcePreparationEngine.diagnoseSource('source-1', now);

    expect(diagnosis.sentences.total).toBe(3);
    expect(diagnosis.sentences.unique).toBe(2);
    expect(diagnosis.sentences.repeatedInsideSource).toBe(1);
    expect(diagnosis.sentences.reusableTranslation).toBe(1);
    expect(diagnosis.sentences.needsAiTranslation).toBe(1);
  });

  it('diagnoses lexical analysis and complete or incomplete dictionary entries', async () => {
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 's1', kana: 'いく', romaji: 'iku', portuguese: 'Vou.' }),
      sentence({ id: 's2', portuguese: 'Sem termos.' }),
    ]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
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
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([
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

  it('aborts and clears every source queue job including running history', async () => {
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([
      job({ id: 'pending-job', status: 'pending' }),
      job({ id: 'error-job', status: 'error' }),
      job({ id: 'completed-job', status: 'completed' }),
      job({ id: 'applied-job', status: 'applied' }),
      job({ id: 'cancelled-job', status: 'cancelled' }),
      job({ id: 'running-job', status: 'running' }),
    ]);

    await SourcePreparationEngine.clearQueueJobs('source-1');

    expect(AiJobRepository.delete).toHaveBeenCalledTimes(6);
    expect(vi.mocked(AiJobRepository.delete).mock.calls.map(([id]) => id)).toEqual([
      'pending-job',
      'error-job',
      'completed-job',
      'applied-job',
      'cancelled-job',
      'running-job',
    ]);
  });

  it('aborts and clears every global queue job including running history', async () => {
    vi.mocked(AiJobRepository.getAll).mockResolvedValue([
      job({ id: 'global-pending', status: 'pending' }),
      job({ id: 'global-error', status: 'error' }),
      job({ id: 'global-completed', status: 'completed' }),
      job({ id: 'global-running', status: 'running' }),
    ]);

    await SourcePreparationEngine.clearAllQueueJobs();

    expect(AiJobRepository.delete).toHaveBeenCalledTimes(4);
    expect(vi.mocked(AiJobRepository.delete).mock.calls.map(([id]) => id)).toEqual([
      'global-pending',
      'global-error',
      'global-completed',
      'global-running',
    ]);
  });

  it('retries errored and stuck jobs with one problem retry command', async () => {
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([
      job({ id: 'error-job', status: 'error', error: 'falhou' }),
      job({ id: 'stuck-job', status: 'running', locked_until: '2026-06-17T11:00:00.000Z' }),
      job({ id: 'ok-running', status: 'running', locked_until: '2099-06-17T13:00:00.000Z' }),
      job({ id: 'done-job', status: 'completed' }),
    ]);

    await SourcePreparationEngine.retryProblemJobs('source-1');

    expect(AiJobRepository.updateStatuses).toHaveBeenCalledWith(
      ['error-job', 'stuck-job'],
      expect.objectContaining({
        status: 'pending',
        error: null,
        locked_by: null,
        locked_until: null,
        last_heartbeat_at: null,
        attempts: 0,
      }),
    );
  });

  it('builds an idempotent plan that ignores resolved, reusable, queued, running, errored and stuck targets but retries unresolved completed targets', async () => {
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
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sentence({ id: 'source-reusable', source_id: 'source-2', japanese: 'ある', japanese_key: 'ある', portuguese: 'Existe.' }),
    ]);
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([
      job({ id: 'pending', status: 'pending', input: { items: [{ id: 'pending-target' }] } }),
      job({ id: 'running', status: 'running', input: { items: [{ id: 'running-target' }] } }),
      job({ id: 'completed', status: 'completed', input: { items: [{ id: 'completed-target' }] } }),
      job({ id: 'error', status: 'error', input: { items: [{ id: 'error-target' }] } }),
      job({ id: 'stuck', status: 'running', locked_until: '2026-06-17T11:00:00.000Z', input: { items: [{ id: 'stuck-target' }] } }),
    ]);

    const plan = await SourcePreparationEngine.buildPlan('source-1', { translateBatchSize: 20 }, now);

    expect(plan.reuse.translations).toHaveLength(1);
    expect(plan.totals.translationItems).toBe(2);
    expect(plan.jobs.translation.map((planned) => planned.input.id)).toEqual(['missing', 'completed-target']);
    expect(plan.blocked.errors).toHaveLength(1);
    expect(plan.blocked.stuck).toHaveLength(1);
  });

  it('creates queue jobs from the plan and applies reusable translations without deleting completed jobs', async () => {
    const plan = await SourcePreparationEngine.buildPlan('source-1', {}, now);
    plan.reuse.translations.push({ sentenceId: 's-cache', reusableSentenceId: 'old', translation: 'Cache.' });
    plan.jobs.translation.push({
      type: 'translate_sentence',
      targetType: 'sentence',
      targetId: 's1',
      stage: 'translation',
      label: 'Traduzir frase 1/1',
      itemCount: 1,
      input: { sourceId: 'source-1', stage: 'translation', label: 'Traduzir frase 1/1', id: 's1', sentence: '待って', japanese: '待って' },
      targetKeys: ['translate_sentence:s1'],
    });
    vi.mocked(SentenceRepository.getById).mockResolvedValue(sentence({ id: 's-cache' }));

    const result = await SourcePreparationEngine.createQueueFromPlan(plan);

    expect(SentenceRepository.update).toHaveBeenCalledWith('s-cache', expect.objectContaining({ translation_source: 'cache' }));
    expect(AiJobRepository.add).toHaveBeenCalledWith(expect.objectContaining({
      type: 'translate_sentence',
      target_id: 's1',
      run_id: null,
      input: expect.objectContaining({ label: 'Traduzir frase 1/1' }),
    }));
    expect(AiJobRepository.delete).not.toHaveBeenCalled();
    expect(result.jobs).toHaveLength(1);
    expect(result.appliedReusableTranslations).toBe(1);
  });

  it('applies reusable translations even when no AI job is planned', async () => {
    const sourceSentence = sentence({ id: 'needs-cache', japanese: 'ã‚ã‚‹', japanese_key: 'ã‚ã‚‹' });
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([sourceSentence]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sourceSentence,
      sentence({ id: 'translated-match', source_id: 'source-2', japanese: 'ã‚ã‚‹', japanese_key: 'ã‚ã‚‹', portuguese: 'Existe.' }),
    ]);
    vi.mocked(SentenceRepository.getById).mockResolvedValue(sourceSentence);

    const result = await SourcePreparationEngine.createQueueForSource('source-1', { translateBatchSize: 30 });

    expect(result.plan.totals.jobs).toBe(0);
    expect(result.plan.totals.actions).toBe(1);
    expect(result.appliedReusableTranslations).toBe(1);
    expect(SentenceRepository.update).toHaveBeenCalledWith(
      'needs-cache',
      expect.objectContaining({ portuguese: 'Existe.', translation_source: 'cache' }),
    );
    expect(AiJobRepository.add).not.toHaveBeenCalled();
  });

  it('waits for translation before planning lexical analysis and waits for analysis before planning dictionary', async () => {
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 's1', japanese: 'è¡Œã', japanese_key: 'è¡Œã', portuguese: null }),
    ]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sentence({ id: 's1', japanese: 'è¡Œã', japanese_key: 'è¡Œã', portuguese: null }),
    ]);

    const translationPlan = await SourcePreparationEngine.buildPlan('source-1', {}, now);
    expect(translationPlan.totals.translationJobs).toBe(1);
    expect(translationPlan.totals.lexicalAnalysisJobs).toBe(0);
    expect(translationPlan.totals.dictionaryJobs).toBe(0);

    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 's1', japanese: 'è¡Œã', japanese_key: 'è¡Œã', portuguese: 'Vou.' }),
    ]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sentence({ id: 's1', japanese: 'è¡Œã', japanese_key: 'è¡Œã', portuguese: 'Vou.' }),
    ]);

    const lexicalPlan = await SourcePreparationEngine.buildPlan('source-1', {}, now);
    expect(lexicalPlan.totals.translationJobs).toBe(0);
    expect(lexicalPlan.totals.lexicalAnalysisJobs).toBe(1);
    expect(lexicalPlan.totals.dictionaryJobs).toBe(0);

    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 's1', japanese: 'è¡Œã', japanese_key: 'è¡Œã', portuguese: 'Vou.', kana: 'ã„ã', romaji: 'iku' }),
    ]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sentence({ id: 's1', japanese: 'è¡Œã', japanese_key: 'è¡Œã', portuguese: 'Vou.', kana: 'ã„ã', romaji: 'iku' }),
    ]);
    vi.mocked(TermRepository.getBySentencesWithDictionary).mockResolvedValue([
      {
        id: 't1',
        sentence_id: 's1',
        dictionary_entry_id: 'entry-needs-ai',
        form: { dictionary_entry_id: 'entry-needs-ai' },
      },
    ] as any);
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
      entry({ id: 'entry-needs-ai', main_meaning: null, status: 'pending' }),
    ]);

    const dictionaryPlan = await SourcePreparationEngine.buildPlan('source-1', {}, now);
    expect(dictionaryPlan.totals.translationJobs).toBe(0);
    expect(dictionaryPlan.totals.lexicalAnalysisJobs).toBe(0);
    expect(dictionaryPlan.totals.dictionaryJobs).toBe(1);
  });

  it('does not let a completed translation job block a still untranslated sentence', async () => {
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 'needs-translation', portuguese: null }),
    ]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sentence({ id: 'needs-translation', portuguese: null }),
    ]);
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([
      job({ id: 'old-completed', status: 'completed', input: { items: [{ id: 'needs-translation' }] } }),
    ]);

    const plan = await SourcePreparationEngine.buildPlan('source-1', {}, now);

    expect(plan.jobs.translation.map((planned) => planned.input.id)).toEqual(['needs-translation']);
  });

  it('continues planning later real gaps when translation targets are blocked by errors', async () => {
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 'translation-error-target', japanese: 'また', japanese_key: 'また', portuguese: null }),
      sentence({ id: 'needs-analysis', japanese: '行くぞ', japanese_key: '行くぞ', portuguese: 'Vamos.', kana: null, romaji: null }),
    ]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sentence({ id: 'translation-error-target', japanese: 'また', japanese_key: 'また', portuguese: null }),
      sentence({ id: 'needs-analysis', japanese: '行くぞ', japanese_key: '行くぞ', portuguese: 'Vamos.', kana: null, romaji: null }),
    ]);
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([
      job({
        id: 'errored-translation',
        type: 'translate_sentence',
        status: 'error',
        input: { id: 'translation-error-target' },
      }),
    ]);

    const plan = await SourcePreparationEngine.buildPlan('source-1', {}, now);

    expect(plan.totals.translationItems).toBe(0);
    expect(plan.totals.lexicalAnalysisItems).toBe(1);
    expect(plan.jobs.lexicalAnalysis.map((planned) => planned.input.id)).toEqual(['needs-analysis']);
    expect(plan.blocked.errors).toHaveLength(1);
  });

  it('continues planning dictionary gaps when only earlier stage targets are blocked by errors', async () => {
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 'translation-error-target', japanese: 'また', japanese_key: 'また', portuguese: null }),
      sentence({ id: 'ready-sentence', portuguese: 'Pronto.', kana: 'いく', romaji: 'iku' }),
    ]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sentence({ id: 'translation-error-target', japanese: 'また', japanese_key: 'また', portuguese: null }),
      sentence({ id: 'ready-sentence', portuguese: 'Pronto.', kana: 'いく', romaji: 'iku' }),
    ]);
    vi.mocked(TermRepository.getBySentencesWithDictionary).mockResolvedValue([
      {
        id: 't1',
        sentence_id: 'ready-sentence',
        dictionary_entry_id: 'entry-incomplete',
        form: { dictionary_entry_id: 'entry-incomplete' },
      },
    ] as any);
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
      entry({ id: 'entry-incomplete', kana: null, status: 'pending' }),
    ]);
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([
      job({
        id: 'errored-translation',
        type: 'translate_sentence',
        status: 'error',
        input: { id: 'translation-error-target' },
      }),
    ]);

    const plan = await SourcePreparationEngine.buildPlan('source-1', {}, now);

    expect(plan.totals.translationItems).toBe(0);
    expect(plan.totals.lexicalAnalysisItems).toBe(0);
    expect(plan.totals.dictionaryItems).toBe(1);
    expect(plan.jobs.dictionary.map((planned) => planned.input.id)).toEqual(['entry-incomplete']);
    expect(plan.blocked.errors).toHaveLength(1);
  });

  it('does not let a completed analysis job block a sentence without valid lexical analysis', async () => {
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 'needs-analysis', portuguese: 'Pronto.', kana: null, romaji: null }),
    ]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sentence({ id: 'needs-analysis', portuguese: 'Pronto.', kana: null, romaji: null }),
    ]);
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([
      job({
        id: 'old-analysis',
        type: 'generate_sentence_reading',
        status: 'completed',
        input: { id: 'needs-analysis' },
      }),
    ]);

    const plan = await SourcePreparationEngine.buildPlan('source-1', {}, now);

    expect(plan.jobs.lexicalAnalysis.map((planned) => planned.input.id)).toEqual(['needs-analysis']);
  });

  it('does not let a completed dictionary job block an entry that is still incomplete', async () => {
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      sentence({ id: 'ready-sentence', portuguese: 'Pronto.', kana: 'ã„ã', romaji: 'iku' }),
    ]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      sentence({ id: 'ready-sentence', portuguese: 'Pronto.', kana: 'ã„ã', romaji: 'iku' }),
    ]);
    vi.mocked(TermRepository.getBySentencesWithDictionary).mockResolvedValue([
      {
        id: 't1',
        sentence_id: 'ready-sentence',
        dictionary_entry_id: 'entry-incomplete',
        form: { dictionary_entry_id: 'entry-incomplete' },
      },
    ] as any);
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
      entry({ id: 'entry-incomplete', kana: null, status: 'pending' }),
    ]);
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([
      job({
        id: 'old-dictionary',
        type: 'enrich_dictionary_entry',
        status: 'completed',
        target_type: 'dictionary_entry',
        target_id: 'entry-incomplete',
        input: { id: 'entry-incomplete' },
      }),
    ]);

    const plan = await SourcePreparationEngine.buildPlan('source-1', {}, now);

    expect(plan.jobs.dictionary.map((planned) => planned.input.id)).toEqual(['entry-incomplete']);
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
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue(firstSource);
    vi.mocked(AiJobRepository.getBySource).mockImplementation(async () => createdJobs);
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
    expect(first.plan.totals.translationJobs).toBe(300);
    expect(first.plan.totals.lexicalAnalysisJobs).toBe(0);
    expect(createdJobs).toHaveLength(300);
    expect(second.plan.totals.jobs).toBe(0);

    const reused = sentence({ id: 'other-source-same', source_id: 'source-2', japanese: '文42', japanese_key: '文42' });
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([reused]);
    vi.mocked(SentenceRepository.findProcessedByJapaneseKeys).mockResolvedValue([
      reused,
      sentence({
        id: 'translated-from-first',
        source_id: 'source-1',
        japanese: '文42',
        japanese_key: '文42',
        portuguese: 'Frase 42.',
      }),
    ]);
    vi.mocked(AiJobRepository.getBySource).mockResolvedValue([]);
    vi.mocked(SentenceRepository.getById).mockResolvedValue(reused);

    const reusePlan = await SourcePreparationEngine.buildPlan('source-2', { translateBatchSize: 30 }, now);

    expect(reusePlan.reuse.translations).toHaveLength(1);
    expect(reusePlan.totals.translationItems).toBe(0);
  });
});
