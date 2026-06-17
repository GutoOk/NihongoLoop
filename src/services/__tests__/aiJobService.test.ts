import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiJobService } from '../aiJobService';
import { AiJobRepository } from '../../repositories';
import { AuthService } from '../../core/authService';
import { stableHash } from '../../core/hash';

vi.mock('../../repositories', () => ({
  AiJobRepository: {
    getPendingByTarget: vi.fn(),
    add: vi.fn(),
    updateStatus: vi.fn(),
    updateStatuses: vi.fn(),
    getByTargetAndStatuses: vi.fn(),
  },
  SentenceRepository: {
    getById: vi.fn(),
    getByIds: vi.fn(),
    update: vi.fn(),
  },
  DictionaryRepository: {
    getAll: vi.fn().mockResolvedValue([]),
    getByIds: vi.fn(),
  },
  TermRepository: {
    getBySentences: vi.fn().mockResolvedValue([]),
  },
  DictionaryFormRepository: {
    resolveOrCreate: vi.fn(),
  },
  DictionarySenseRepository: {
    resolveOrCreate: vi.fn(),
  }
}));

vi.mock('../../core/authService', () => ({
  AuthService: {
    getCurrentUserId: vi.fn(() => 'user-123'),
  }
}));

describe('AiJobService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(AiJobRepository.updateStatus).mockResolvedValue({} as any);
    vi.mocked(AiJobRepository.updateStatuses).mockResolvedValue(true);
    vi.mocked(AiJobRepository.getByTargetAndStatuses).mockResolvedValue([]);
  });

  describe('requestSentenceTranslation', () => {
    it('does not create duplicate exact jobs if already pending', async () => {
      const input = { sentence: '待て' };
      const hash = await stableHash(input);
      
      // Mock existing pending job
      vi.mocked(AiJobRepository.getPendingByTarget).mockResolvedValue({
        id: 'job-1',
        type: 'translate_sentence',
        target_id: 'sent-1',
        input_hash: hash
      } as any);

      const result = await AiJobService.requestSentenceTranslation('sent-1', '待て');
      
      expect(AiJobRepository.getPendingByTarget).toHaveBeenCalledWith('translate_sentence', 'sentence', 'sent-1');
      expect(AiJobRepository.add).not.toHaveBeenCalled();
      expect(result.id).toBe('job-1');
    });

    it('creates a new job if not already pending', async () => {
      const input = { sentence: '待て' };
      const hash = await stableHash(input);
      
      vi.mocked(AiJobRepository.getPendingByTarget).mockResolvedValue(null);
      vi.mocked(AiJobRepository.add).mockResolvedValue({
        id: 'job-2'
      } as any);

      const result = await AiJobService.requestSentenceTranslation('sent-1', '待て');
      
      expect(AiJobRepository.add).toHaveBeenCalledWith(expect.objectContaining({
        type: 'translate_sentence',
        target_id: 'sent-1',
        input_hash: hash,
        user_id: 'user-123'
      }));
      expect(result.id).toBe('job-2');
    });
  });

  describe('processJobsBatch optimization', () => {
    it('does not call the AI API when every translation item is already resolved', async () => {
      const job = {
        id: 'batch-1',
        user_id: 'user-123',
        type: 'batch_translate_sentences',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: { items: [{ id: 'sent-1', japanese: '待て' }] },
      } as any;

      const { SentenceRepository } = await import('../../repositories');
      vi.mocked(SentenceRepository.getByIds).mockResolvedValue([
        { id: 'sent-1', portuguese: 'Espere', status: 'translated' },
      ] as any);

      const result = await AiJobService.processJobsBatch([job]);

      expect(fetch).not.toHaveBeenCalled();
      expect(result.successCount).toBe(1);
      expect(AiJobRepository.updateStatus).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({
          status: 'completed',
          result: expect.objectContaining({ optimization: 'skipped_resolved_batch' }),
        }),
      );
    });

    it('sends only unresolved items from a mixed translation batch', async () => {
      const job = {
        id: 'batch-2',
        user_id: 'user-123',
        type: 'batch_translate_sentences',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: {
          items: [
            { id: 'sent-ready', japanese: '待て' },
            { id: 'sent-missing', japanese: '行くぞ' },
          ],
        },
      } as any;

      const { SentenceRepository } = await import('../../repositories');
      vi.mocked(SentenceRepository.getByIds)
        .mockResolvedValueOnce([
          { id: 'sent-ready', portuguese: 'Espere', status: 'translated' },
          { id: 'sent-missing', japanese: '行くぞ', portuguese: null, status: 'raw', kana: null, romaji: null },
        ] as any)
        .mockResolvedValueOnce([
          { id: 'sent-missing', japanese: '行くぞ', portuguese: null, status: 'raw', kana: null, romaji: null },
        ] as any);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'batch-2',
            type: 'batch_translate_sentences',
            items: [{ job_id: 'sent-missing', translation: 'Vamos.' }],
          }],
        }),
      } as any);

      await AiJobService.processJobsBatch([job]);

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
      expect(body.jobs[0].input.items).toEqual([{ id: 'sent-missing', japanese: '行くぞ' }]);
      expect(SentenceRepository.update).toHaveBeenCalledWith(
        'sent-missing',
        expect.objectContaining({ portuguese: 'Vamos.', translation_source: 'ai' }),
      );
    });

    it('splits failed batch items into smaller retry jobs', async () => {
      const job = {
        id: 'batch-3',
        user_id: 'user-123',
        type: 'batch_translate_sentences',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: {
          items: [
            { id: 's1', japanese: '一' },
            { id: 's2', japanese: '二' },
            { id: 's3', japanese: '三' },
          ],
        },
      } as any;

      const { SentenceRepository } = await import('../../repositories');
      vi.mocked(SentenceRepository.getByIds)
        .mockResolvedValueOnce([
          { id: 's1', japanese: '一', portuguese: null, status: 'raw' },
          { id: 's2', japanese: '二', portuguese: null, status: 'raw' },
          { id: 's3', japanese: '三', portuguese: null, status: 'raw' },
        ] as any)
        .mockResolvedValueOnce([
          { id: 's1', japanese: '一', portuguese: null, status: 'raw' },
          { id: 's2', japanese: '二', portuguese: null, status: 'raw' },
          { id: 's3', japanese: '三', portuguese: null, status: 'raw' },
        ] as any);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'batch-3',
            type: 'batch_translate_sentences',
            items: [
              { job_id: 's1', translation: '' },
              { job_id: 's2', translation: '' },
              { job_id: 's3', translation: '' },
            ],
          }],
        }),
      } as any);

      await AiJobService.processJobsBatch([job]);

      expect(AiJobRepository.add).toHaveBeenCalledTimes(2);
      expect(vi.mocked(AiJobRepository.add).mock.calls[0][0].input.items).toHaveLength(2);
      expect(vi.mocked(AiJobRepository.add).mock.calls[1][0].input.items).toHaveLength(1);
    });
  });
});
