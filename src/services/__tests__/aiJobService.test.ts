import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiJobService } from '../aiJobService';
import { AiJobRepository, DictionaryRepository, SentenceRepository } from '../../repositories';
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
    getBySourceId: vi.fn(),
    update: vi.fn(),
  },
  DictionaryRepository: {
    getAll: vi.fn().mockResolvedValue([]),
    getByIds: vi.fn(),
    getById: vi.fn(),
    getByUniqueKey: vi.fn(),
    getByLemma: vi.fn(),
    addBatch: vi.fn(),
    update: vi.fn(),
    makeEntryKey: vi.fn((lemma: string, kana?: string | null, type?: string | null) => `${lemma}|${kana || ''}|${type || 'outro'}`),
  },
  TermRepository: {
    getBySentences: vi.fn().mockResolvedValue([]),
  },
  DictionaryFormRepository: {
    resolveOrCreate: vi.fn(),
  },
  DictionarySenseRepository: {
    resolveOrCreate: vi.fn(),
    upsertBatch: vi.fn(),
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
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([]);
    vi.mocked(DictionaryRepository.getByUniqueKey).mockResolvedValue(null);
    vi.mocked(DictionaryRepository.getByLemma).mockResolvedValue([]);
    vi.mocked(DictionaryRepository.addBatch).mockResolvedValue([]);
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

    it('copies an AI translation to repeated untranslated sentences inside the same source', async () => {
      const job = {
        id: 'batch-repeat',
        user_id: 'user-123',
        type: 'batch_translate_sentences',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: { items: [{ id: 'canonical', japanese: 'è¡Œããž' }] },
      } as any;

      const canonical = {
        id: 'canonical',
        source_id: 'source-1',
        japanese: 'è¡Œããž',
        japanese_key: 'è¡Œããž',
        portuguese: null,
        status: 'raw',
        kana: null,
        romaji: null,
      };
      const duplicate = {
        id: 'duplicate',
        source_id: 'source-1',
        japanese: 'è¡Œããž',
        japanese_key: 'è¡Œããž',
        portuguese: null,
        status: 'raw',
        kana: null,
        romaji: null,
      };

      vi.mocked(SentenceRepository.getByIds)
        .mockResolvedValueOnce([canonical] as any)
        .mockResolvedValueOnce([canonical] as any);
      vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([canonical, duplicate] as any);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'batch-repeat',
            type: 'batch_translate_sentences',
            items: [{ job_id: 'canonical', translation: 'Vamos.' }],
          }],
        }),
      } as any);

      await AiJobService.processJobsBatch([job]);

      expect(SentenceRepository.update).toHaveBeenCalledWith(
        'canonical',
        expect.objectContaining({ portuguese: 'Vamos.', translation_source: 'ai' }),
      );
      expect(SentenceRepository.update).toHaveBeenCalledWith(
        'duplicate',
        expect.objectContaining({ portuguese: 'Vamos.', translation_source: 'cache' }),
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

    it('reuses a dictionary entry by lemma before creating a new one during lexical analysis', async () => {
      const job = {
        id: 'analysis-job',
        user_id: 'user-123',
        type: 'batch_analyze_sentences',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: { items: [{ id: 's1', japanese: 'è¡Œããž', portuguese: 'Vamos.' }] },
      } as any;

      vi.mocked(SentenceRepository.getByIds)
        .mockResolvedValueOnce([{ id: 's1', japanese: 'è¡Œããž', portuguese: 'Vamos.', status: 'translated' }] as any)
        .mockResolvedValueOnce([{ id: 's1', japanese: 'è¡Œããž', portuguese: 'Vamos.', status: 'translated' }] as any);
      vi.mocked(DictionaryRepository.getByUniqueKey).mockResolvedValue(null);
      vi.mocked(DictionaryRepository.getByLemma).mockResolvedValue([{ id: 'entry-existing', lemma: 'è¡Œã', type: 'verbo', main_meaning: 'ir' }] as any);

      const { DictionaryFormRepository } = await import('../../repositories');
      vi.mocked(DictionaryFormRepository.resolveOrCreate).mockResolvedValue({ id: 'form-existing' } as any);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'analysis-job',
            type: 'batch_analyze_sentences',
            items: [{
              job_id: 's1',
              kana: 'ã„ããž',
              romaji: 'iku zo',
              terms: [{
                surface: 'è¡Œã',
                lemma: 'è¡Œã',
                kana: 'ã„ã',
                romaji: 'iku',
                type: 'verbo',
                start_index: 0,
                end_index: 2,
                meaning: 'ir',
              }],
            }],
          }],
        }),
      } as any);

      await AiJobService.processJobsBatch([job]);

      expect(DictionaryRepository.addBatch).not.toHaveBeenCalled();
      expect(DictionaryFormRepository.resolveOrCreate).toHaveBeenCalledWith(expect.objectContaining({
        dictionary_entry_id: 'entry-existing',
        form: 'è¡Œã',
      }));
    });

    it('completes dictionary gaps without overwriting valid existing fields', async () => {
      const job = {
        id: 'dict-job',
        user_id: 'user-123',
        type: 'batch_enrich_dictionary_entries_full',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: { items: [{ id: 'entry-1', lemma: '行く' }] },
      } as any;

      const { DictionaryRepository, DictionaryFormRepository, DictionarySenseRepository } = await import('../../repositories');
      vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
        { id: 'entry-1', status: 'pending', main_meaning: null, kana: 'いく', romaji: 'iku', type: 'verbo' },
      ] as any);
      vi.mocked(DictionaryRepository.getById).mockResolvedValue({
        id: 'entry-1',
        lemma: '行く',
        status: 'pending',
        main_meaning: 'ir',
        kana: 'いく',
        romaji: 'iku',
        type: 'verbo',
        tags: ['core'],
      } as any);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'dict-job',
            type: 'batch_enrich_dictionary_entries_full',
            items: [{
              job_id: 'entry-1',
              main_meaning: 'andar',
              kana: 'ユク',
              romaji: 'yuku',
              type: 'substantivo',
              jlpt_level: 'N5',
              tags: ['ai'],
            }],
          }],
        }),
      } as any);

      await AiJobService.processJobsBatch([job]);

      expect(DictionaryRepository.update).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({
          main_meaning: 'ir',
          kana: 'いく',
          romaji: 'iku',
          type: 'verbo',
          jlpt_level: 'N5',
          tags: ['core'],
        }),
      );
      expect(DictionarySenseRepository.upsertBatch).toHaveBeenCalled();
      expect(DictionaryFormRepository.resolveOrCreate).toHaveBeenCalledWith(expect.objectContaining({
        dictionary_entry_id: 'entry-1',
        kana: 'いく',
        romaji: 'iku',
      }));
    });
  });
});
