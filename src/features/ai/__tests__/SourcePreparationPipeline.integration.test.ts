import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcePreparationEngine } from '../SourcePreparationEngine';
import { SourcePreparationRunner } from '../SourcePreparationRunner';
import { AiJobRepository, DictionaryRepository, SentenceRepository, TermRepository } from '../../../repositories';
import { AiJobService } from '../../../services/aiJobService';

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
    processJobsBatch: vi.fn(),
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
    vi.mocked(AiJobRepository.getByTarget).mockImplementation(async () => jobs);
    vi.mocked(AiJobRepository.claimJob).mockResolvedValue(true);
    vi.mocked(AiJobRepository.updateStatuses).mockResolvedValue(true);
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
    vi.mocked(AiJobService.processJobsBatch).mockImplementation(async (batch: any[]) => {
      for (const job of batch) {
        if (job.type === 'batch_translate_sentences') {
          sentences[0].portuguese = 'pt';
          sentences[0].status = 'translated';
        }
        if (job.type === 'batch_analyze_sentences') {
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
        if (job.type === 'batch_enrich_dictionary_entries_full') {
          entries[0] = {
            ...entries[0],
            kana: 'kana',
            romaji: 'romaji',
            main_meaning: 'ir',
            status: 'ai_enriched',
          };
        }
        job.status = 'completed';
      }
      return { success: true, successCount: batch.length, errorCount: 0 };
    });
  });

  it('runs translation, recalculates, runs analysis, recalculates, enriches dictionary and stops cleanly', async () => {
    await SourcePreparationRunner.drainSource('source-1', undefined, undefined, 0);

    expect(jobs.map((job) => job.type)).toEqual([
      'batch_translate_sentences',
      'batch_analyze_sentences',
      'batch_enrich_dictionary_entries_full',
    ]);
    expect(sentences[0]).toEqual(expect.objectContaining({
      portuguese: 'pt',
      kana: 'kana',
      romaji: 'romaji',
      terms_source: 'ai',
    }));
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
    expect(result.jobs.map((job) => job.type)).toEqual(['batch_enrich_dictionary_entries_full']);
    expect(result.plan.totals.dictionaryItems).toBe(1);
  });
});
