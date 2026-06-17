import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourcePreparationService } from '../../features/ai/SourcePreparationService';
import { AiJobRepository, SentenceRepository, SourceRepository, ProcessingRunRepository } from '../../repositories';
import { stableHash } from '../../core/hash';

vi.mock('../../repositories', () => ({
  AiJobRepository: {
    add: vi.fn(),
    addBatch: vi.fn(),
    getPendingByTarget: vi.fn().mockResolvedValue([]),
    getAll: vi.fn().mockResolvedValue([]),
    getByTarget: vi.fn().mockResolvedValue([]),
    getByTargetAndStatuses: vi.fn().mockResolvedValue([]),
    hasTargetJobByTypeAndStatuses: vi.fn().mockResolvedValue(false),
    updateStatus: vi.fn(),
  },
  SentenceRepository: {
    getBySourceId: vi.fn(),
    update: vi.fn(),
    findProcessedByJapaneseKeys: vi.fn().mockResolvedValue([])
  },
  SourceRepository: {
    getById: vi.fn(),
    update: vi.fn()
  },
  TermRepository: {
    getBySentences: vi.fn().mockResolvedValue([])
  },
  DictionaryRepository: {
    getByUniqueKey: vi.fn().mockResolvedValue(null),
    addBatch: vi.fn()
  },
  ProcessingRunRepository: {
    createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
    getRun: vi.fn().mockResolvedValue({ id: 'run-1', cancel_requested: false }),
    appendLog: vi.fn(),
    updateRun: vi.fn(),
    finishRun: vi.fn(),
    failRun: vi.fn(),
  }
}));

describe('SourcePreparationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([]);
    vi.mocked(AiJobRepository.getByTargetAndStatuses).mockResolvedValue([]);
    vi.mocked(AiJobRepository.hasTargetJobByTypeAndStatuses).mockResolvedValue(false);
  });

  it('prepareSource creates translation jobs for sentences that need it', async () => {
    vi.mocked(ProcessingRunRepository.getRun).mockResolvedValue({ id: 'run-1', cancel_requested: false } as any);
    vi.mocked(SourceRepository.getById).mockResolvedValue({ id: 'source-1' } as any);
    vi.mocked(AiJobRepository.getByTargetAndStatuses).mockResolvedValue([]);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      { id: 's1', japanese: '待て', japanese_key: '待て', portuguese: null, translation_source: 'ai', status: 'pending' },
      { id: 's2', japanese: '行くぞ', japanese_key: '行くぞ', portuguese: 'Vamos', translation_source: 'manual', status: 'ready' }
    ] as any);

    await SourcePreparationService.prepareSource('source-1', {
      dictMode: "full",
      useCache: true,
      overwriteReviewed: false,
      runMode: "all",
      translateBatchSize: 20,
      analyzeBatchSize: 5,
      dictFullBatchSize: 10
    }, 'run-1');

    // Should create a job for s1
    expect(AiJobRepository.add).toHaveBeenCalledWith(
      expect.objectContaining({ target_id: 'source-1', type: 'batch_translate_sentences' })
    );
  });

  it('prepareSource continues from where it left off', async () => {
    vi.mocked(SourceRepository.getById).mockResolvedValue({ id: 'source-1' } as any);
    // Suppress console.log output for the simulated fail
    vi.mocked(ProcessingRunRepository.failRun).mockResolvedValue(undefined as any);
    vi.mocked(AiJobRepository.getByTargetAndStatuses).mockResolvedValue([
      { id: 'job-1', target_id: 'source-1', status: 'pending', type: 'batch_translate_sentences', input: { items: [{ id: 'sent-2' }]} } as any
    ]);
    vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([
      { id: 'job-1', target_id: 'source-1', status: 'pending', type: 'batch_translate_sentences', input: { items: [{ id: 'sent-2' }]} } as any
    ]);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      { id: 's1', japanese: '日本語', portuguese: 'Japones' } as any, // implicitly ready if valid
      { id: 'sent-2', japanese: 'テスト', portuguese: null } as any 
    ]);
    
    // Simulate that sent-2 is already pending in job-1
    vi.mocked(AiJobRepository.getByTargetAndStatuses).mockResolvedValue([
        { id: 'job-1', target_id: 'source-1', status: 'pending', type: 'batch_translate_sentences', input: { items: [{ id: 'sent-2' }]} } as any
    ]);

    await SourcePreparationService.prepareSource('source-1', {
      dictMode: "full",
      useCache: true,
      overwriteReviewed: false,
      runMode: "all",
      translateBatchSize: 20,
      analyzeBatchSize: 5,
      dictFullBatchSize: 10
    }, 'run-1');

    // Should NOT create new translation job for sent-2 because it's pending
    expect(AiJobRepository.add).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'batch_translate_sentences' })
    );
  });

  it('prepareSource skips sentences with manual changes', async () => {
    vi.mocked(SourceRepository.getById).mockResolvedValue({ id: 'source-1' } as any);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      { id: 'sent-3', japanese: '手動', portuguese: 'Editado Manualmente', translation_source: 'manual' } as any
    ]);
    vi.mocked(AiJobRepository.getByTargetAndStatuses).mockResolvedValue([]);

    await SourcePreparationService.prepareSource('source-1', {
      dictMode: "full",
      useCache: true,
      overwriteReviewed: false,
      runMode: "all",
      translateBatchSize: 20,
      analyzeBatchSize: 5,
      dictFullBatchSize: 10
    }, 'run-1');

    expect(AiJobRepository.add).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'batch_translate_sentences' })
    );
  });

  it('reopens completed analysis jobs when terms were deleted after a previous AI analysis', async () => {
    vi.mocked(SourceRepository.getById).mockResolvedValue({ id: 'source-1' } as any);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      {
        id: 'sent-1',
        japanese: '日本語',
        japanese_key: '日本語',
        portuguese: 'Japonês',
        kana: 'にほんご',
        romaji: 'nihongo',
        terms_source: 'ai',
      } as any,
    ]);
    const input = { items: [{ id: 'sent-1', japanese: '日本語', portuguese: 'Japonês' }] };
    const completedJob = {
      id: 'job-old',
      target_id: 'source-1',
      status: 'completed',
      type: 'batch_analyze_sentences',
      input_hash: await stableHash({ type: 'batch_analyze_sentences', input }),
      input,
    } as any;
    vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([completedJob]);

    await SourcePreparationService.prepareSource('source-1', {
      dictMode: "full",
      useCache: false,
      overwriteReviewed: false,
      runMode: "analyze",
      translateBatchSize: 20,
      analyzeBatchSize: 5,
      dictFullBatchSize: 10
    }, 'run-1');

    expect(AiJobRepository.updateStatus).toHaveBeenCalledWith(
      'job-old',
      expect.objectContaining({ status: 'pending', result: null }),
    );
  });
});
