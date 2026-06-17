import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcePreparationService } from '../../features/ai/SourcePreparationService';
import { AiJobRepository, DictionaryRepository, ProcessingRunRepository, SentenceRepository, TermRepository } from '../../repositories';

vi.mock('../../repositories', () => ({
  AiJobRepository: {
    add: vi.fn(),
    getByTarget: vi.fn(),
  },
  DictionaryRepository: {
    getByIds: vi.fn(),
  },
  ProcessingRunRepository: {
    failRun: vi.fn(),
    updateRun: vi.fn(),
  },
  SentenceRepository: {
    getAll: vi.fn(),
    getById: vi.fn(),
    getBySourceId: vi.fn(),
    update: vi.fn(),
  },
  SourceRepository: {
    getById: vi.fn(),
  },
  TermRepository: {
    getBySentencesWithDictionary: vi.fn(),
  },
}));

const options = {
  dictMode: 'full' as const,
  useCache: true,
  overwriteReviewed: false,
  runMode: 'all' as const,
  translateBatchSize: 20,
  analyzeBatchSize: 5,
  dictFastBatchSize: 30,
  dictFullBatchSize: 10,
};

function sentence(overrides: Record<string, unknown>) {
  return {
    id: 's1',
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
    created_at: '2026-06-17T12:00:00.000Z',
    updated_at: '2026-06-17T12:00:00.000Z',
    ...overrides,
  } as any;
}

describe('SourcePreparationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([]);
    vi.mocked(AiJobRepository.add).mockImplementation(async (job: any) => ({ id: 'job-created', ...job }));
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([]);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue([]);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([]);
    vi.mocked(TermRepository.getBySentencesWithDictionary).mockResolvedValue([]);
  });

  it('creates translation jobs only for sentences that really need AI', async () => {
    const sentences = [
      sentence({ id: 'needs-ai', japanese: '待って', japanese_key: '待って' }),
      sentence({ id: 'ready', japanese: '行くぞ', japanese_key: '行くぞ', portuguese: 'Vamos.' }),
    ];
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue(sentences);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue(sentences);

    await SourcePreparationService.prepareSource('source-1', options, 'run-1');

    expect(AiJobRepository.add).toHaveBeenCalledWith(
      expect.objectContaining({
        target_id: 'source-1',
        type: 'batch_translate_sentences',
        input: expect.objectContaining({
          items: [{ id: 'needs-ai', japanese: '待って' }],
        }),
      }),
    );
    expect(ProcessingRunRepository.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('does not duplicate a pending translation target', async () => {
    const sentences = [sentence({ id: 'sent-2', japanese: 'テスト', japanese_key: 'テスト' })];
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue(sentences);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue(sentences);
    vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([
      {
        id: 'job-1',
        target_id: 'source-1',
        status: 'pending',
        type: 'batch_translate_sentences',
        input: { items: [{ id: 'sent-2' }] },
      } as any,
    ]);

    await SourcePreparationService.prepareSource('source-1', options, 'run-1');

    expect(AiJobRepository.add).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'batch_translate_sentences' }),
    );
  });

  it('reuses identical translated sentences instead of creating AI jobs', async () => {
    const sourceSentence = sentence({ id: 'new-sentence', japanese: 'ある', japanese_key: 'ある' });
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([sourceSentence]);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue([
      sourceSentence,
      sentence({ id: 'old-sentence', source_id: 'source-2', japanese: 'ある', japanese_key: 'ある', portuguese: 'Existe.' }),
    ]);
    vi.mocked(SentenceRepository.getById).mockResolvedValue(sourceSentence);

    await SourcePreparationService.prepareSource('source-1', options, 'run-1');

    expect(SentenceRepository.update).toHaveBeenCalledWith(
      'new-sentence',
      expect.objectContaining({ portuguese: 'Existe.', translation_source: 'cache' }),
    );
    expect(AiJobRepository.add).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'batch_translate_sentences' }),
    );
  });
});
