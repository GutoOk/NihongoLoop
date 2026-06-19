import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcePreparationEngine } from '../SourcePreparationEngine';
import { SourcePreparationRunner } from '../SourcePreparationRunner';
import { AiJobRepository, DictionaryRepository, ProcessingRunRepository, SentenceRepository, TermRepository } from '../../../repositories';
import { AiJobService } from '../../../services/aiJobService';

vi.mock('../../../repositories', () => ({
  AiJobRepository: {
    add: vi.fn(),
    claimJob: vi.fn(),
    delete: vi.fn(),
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
    processJob: vi.fn(),
  },
}));

describe('Source preparation pipeline integration', () => {
  let sentences: any[];
  let terms: any[];
  let entries: any[];
  let jobs: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    sentences = [{
      id: 's1',
      source_id: 'source-1',
      japanese: 'jp',
      japanese_key: 'jp',
      portuguese: null,
      kana: null,
      romaji: null,
      status: 'raw',
    }];
    terms = [];
    entries = [];
    jobs = [];

    vi.mocked(SentenceRepository.getBySourceId).mockImplementation(async () => sentences);
    vi.mocked(SentenceRepository.getAll).mockImplementation(async () => sentences);
    vi.mocked(SentenceRepository.getById).mockImplementation(async (id: string) => sentences.find((sentence) => sentence.id === id) || null);
    vi.mocked(SentenceRepository.update).mockImplementation(async (id: string, updates: any) => {
      const sentence = sentences.find((item) => item.id === id);
      if (!sentence) return null;
      Object.assign(sentence, updates);
      return sentence;
    });
    vi.mocked(TermRepository.getBySentencesWithDictionary).mockImplementation(async () => terms);
    vi.mocked(DictionaryRepository.getByIds).mockImplementation(async (ids: string[]) => entries.filter((entry) => ids.includes(entry.id)));
    vi.mocked(AiJobRepository.getBySource).mockImplementation(async () => jobs);
    vi.mocked(AiJobRepository.claimJob).mockResolvedValue(true);
    vi.mocked(AiJobRepository.updateStatuses).mockResolvedValue(true);
    vi.mocked(ProcessingRunRepository.createOrResumeRun).mockResolvedValue({
      id: 'run-1',
      source_id: 'source-1',
      status: 'pending',
      started_at: null,
    } as any);
    vi.mocked(ProcessingRunRepository.updateRun).mockResolvedValue(null);
    vi.mocked(AiJobRepository.delete).mockImplementation(async (id: string) => {
      jobs = jobs.filter((job) => job.id !== id);
      return true;
    });
    vi.mocked(AiJobRepository.add).mockImplementation(async (input: any) => {
      const existing = jobs.find((job) => job.input_hash === input.input_hash && job.target_id === input.target_id && job.type === input.type);
      if (existing) return existing;
      const created = { id: `job-${jobs.length + 1}`, ...input };
      jobs.push(created);
      return created;
    });
    vi.mocked(AiJobService.processJob).mockImplementation(async (job: any) => {
        if (job.type === 'translate_sentence') {
          sentences[0].portuguese = 'pt';
          sentences[0].status = 'translated';
        }
        if (job.type === 'generate_sentence_reading') {
          sentences[0].kana = 'kana';
          sentences[0].romaji = 'romaji';
          sentences[0].terms_source = 'ai';
          entries = [{
            id: 'entry-1',
            lemma: 'jp',
            kana: null,
            romaji: null,
            type: 'verbo',
            main_meaning: null,
            status: 'pending',
          }];
          terms = [{
            id: 'term-1',
            sentence_id: 's1',
            dictionary_entry_id: 'entry-1',
            form: { dictionary_entry_id: 'entry-1' },
          }];
        }
        if (job.type === 'enrich_dictionary_entry') {
          entries[0] = {
            ...entries[0],
            kana: 'kana',
            romaji: 'romaji',
            main_meaning: 'ir',
            status: 'ai_enriched',
          };
        }
        job.status = 'completed';
      return { success: true };
    });
  });

  it('queues translation, reading, terms and dictionary for the persistent worker', async () => {
    await SourcePreparationRunner.drainSource('source-1', undefined, undefined, 0);

    expect(jobs.map((job) => job.type)).toEqual(['translate_sentence']);
    expect(AiJobService.processJob).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'translate_sentence' }));

    sentences[0].portuguese = 'pt';
    sentences[0].status = 'translated';
    jobs[0].status = 'completed';

    await SourcePreparationRunner.drainSource('source-1', undefined, undefined, 0);

    expect(jobs.map((job) => job.type)).toEqual([
      'translate_sentence',
      'generate_sentence_reading',
    ]);
    expect(AiJobService.processJob).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'generate_sentence_reading' }));

    sentences[0].kana = 'kana';
    sentences[0].romaji = 'romaji';
    jobs[1].status = 'completed';

    await SourcePreparationRunner.drainSource('source-1', undefined, undefined, 0);

    expect(jobs.map((job) => job.type)).toEqual([
      'translate_sentence',
      'generate_sentence_reading',
      'detect_sentence_terms',
    ]);
    expect(AiJobService.processJob).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'detect_sentence_terms' }));

    sentences[0].terms_source = 'ai';
    entries = [{
      id: 'entry-1',
      lemma: 'jp',
      kana: null,
      romaji: null,
      type: 'verbo',
      main_meaning: null,
      status: 'pending',
    }];
    terms = [{
      id: 'term-1',
      sentence_id: 's1',
      dictionary_entry_id: 'entry-1',
      form: { dictionary_entry_id: 'entry-1' },
    }];
    jobs[2].status = 'completed';

    await SourcePreparationRunner.drainSource('source-1', undefined, undefined, 0);

    expect(jobs.map((job) => job.type)).toEqual([
      'translate_sentence',
      'generate_sentence_reading',
      'detect_sentence_terms',
      'enrich_dictionary_entry',
    ]);
    expect(AiJobService.processJob).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'enrich_dictionary_entry' }));
    expect(sentences[0]).toEqual(expect.objectContaining({
      portuguese: 'pt',
      kana: 'kana',
      romaji: 'romaji',
      terms_source: 'ai',
    }));

    entries[0] = {
      ...entries[0],
      kana: 'kana',
      romaji: 'romaji',
      main_meaning: 'ir',
      status: 'ai_enriched',
    };
    jobs[3].status = 'completed';

    expect(entries[0]).toEqual(expect.objectContaining({
      main_meaning: 'ir',
      kana: 'kana',
      romaji: 'romaji',
      status: 'ai_enriched',
    }));

    const jobCountAfterFirstRun = jobs.length;
    await SourcePreparationRunner.drainSource('source-1', undefined, undefined, 0);
    expect(jobs).toHaveLength(jobCountAfterFirstRun);

    await SourcePreparationEngine.clearQueueJobs('source-1');
    expect(jobs).toHaveLength(0);
    expect(sentences[0].portuguese).toBe('pt');
    expect(entries[0].main_meaning).toBe('ir');

    entries[0].romaji = null;
    entries[0].status = 'pending';
    const result = await SourcePreparationEngine.createQueueForSource('source-1');
    expect(result.jobs.map((job) => job.type)).toEqual(['enrich_dictionary_entry']);
    expect(result.plan.totals.dictionaryItems).toBe(1);
  });
});
