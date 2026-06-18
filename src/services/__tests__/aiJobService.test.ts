import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiJobService } from '../aiJobService';
import { AiJobRepository, DictionaryRepository, SentenceRepository, TermRepository } from '../../repositories';
import { AuthService } from '../../core/authService';
import { stableHash } from '../../core/hash';

vi.mock('../../repositories', () => ({
  AiJobRepository: {
    getPendingByTarget: vi.fn(),
    add: vi.fn(),
    updateStatus: vi.fn(),
    updateStatuses: vi.fn(),
    getByTarget: vi.fn(),
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
    mergeDuplicateIntoPrimary: vi.fn(),
    update: vi.fn(),
    makeEntryKey: vi.fn((lemma: string, kana?: string | null, type?: string | null) => `${lemma}|${kana || ''}|${type || 'outro'}`),
  },
  TermRepository: {
    getBySentences: vi.fn().mockResolvedValue([]),
    deleteBySentenceIds: vi.fn(),
    addBatch: vi.fn(),
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
    vi.mocked(AiJobRepository.getByTarget).mockImplementation(async (targetId: string) => ([
      'batch-1',
      'batch-2',
      'batch-3',
      'batch-repeat',
      'analysis-invalid',
      'analysis-job',
      'dict-job',
      'dict-invalid',
      'dict-duplicate-key',
      'dict-partial',
      'dict-race-23505',
      'batch-attempts',
      'single-job',
    ].map((id) => ({ id, target_id: targetId })) as any));
    vi.mocked(AiJobRepository.getByTargetAndStatuses).mockResolvedValue([]);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([]);
    vi.mocked(DictionaryRepository.getByUniqueKey).mockResolvedValue(null);
    vi.mocked(DictionaryRepository.getByLemma).mockResolvedValue([]);
    vi.mocked(DictionaryRepository.addBatch).mockResolvedValue([]);
    vi.mocked(DictionaryRepository.mergeDuplicateIntoPrimary).mockResolvedValue({ id: 'entry-primary' } as any);
    vi.mocked(TermRepository.deleteBySentenceIds).mockResolvedValue(true);
    vi.mocked(TermRepository.addBatch).mockResolvedValue([] as any);
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

    it('does not apply a batch result when the job was removed from the queue before the response', async () => {
      const job = {
        id: 'deleted-before-apply',
        user_id: 'user-123',
        type: 'batch_translate_sentences',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: { items: [{ id: 'sent-1', japanese: 'jp' }] },
      } as any;

      vi.mocked(SentenceRepository.getByIds)
        .mockResolvedValueOnce([{ id: 'sent-1', japanese: 'jp', portuguese: null, status: 'raw' }] as any);
      vi.mocked(AiJobRepository.getByTarget).mockResolvedValue([]);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'deleted-before-apply',
            type: 'batch_translate_sentences',
            items: [{ job_id: 'sent-1', translation: 'pt' }],
          }],
        }),
      } as any);

      await AiJobService.processJobsBatch([job]);

      expect(SentenceRepository.update).not.toHaveBeenCalledWith('sent-1', expect.objectContaining({ portuguese: 'pt' }));
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

    it('increments attempts when a batch job starts running', async () => {
      const job = {
        id: 'batch-attempts',
        user_id: 'user-123',
        type: 'batch_translate_sentences',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        attempts: 2,
        input: { items: [{ id: 'sent-attempts', japanese: 'jp' }] },
      } as any;

      vi.mocked(SentenceRepository.getByIds)
        .mockResolvedValueOnce([{ id: 'sent-attempts', japanese: 'jp', portuguese: null, status: 'raw' }] as any)
        .mockResolvedValueOnce([{ id: 'sent-attempts', japanese: 'jp', portuguese: null, status: 'raw' }] as any);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'batch-attempts',
            type: 'batch_translate_sentences',
            items: [{ job_id: 'sent-attempts', translation: 'pt' }],
          }],
        }),
      } as any);

      await AiJobService.processJobsBatch([job]);

      expect(AiJobRepository.updateStatus).toHaveBeenCalledWith(
        'batch-attempts',
        expect.objectContaining({ status: 'running', attempts: 3 }),
      );
    });

    it('does not apply an individual job result when the job was removed before apply', async () => {
      const job = {
        id: 'single-job',
        user_id: 'user-123',
        type: 'translate_sentence',
        target_type: 'sentence',
        target_id: 'sent-single',
        status: 'pending',
        attempts: 0,
      } as any;

      vi.mocked(AiJobRepository.getByTarget)
        .mockResolvedValueOnce([{ id: 'single-job', target_id: 'sent-single', status: 'running' }] as any)
        .mockResolvedValueOnce([]);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ result: { translation: 'pt' } }),
      } as any);

      const result = await AiJobService.processJob(job);

      expect(result.success).toBe(false);
      expect(SentenceRepository.update).not.toHaveBeenCalledWith('sent-single', expect.objectContaining({ portuguese: 'pt' }));
      expect(AiJobRepository.updateStatus).not.toHaveBeenCalledWith(
        'single-job',
        expect.objectContaining({ status: 'completed' }),
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

      const result = await AiJobService.processJobsBatch([job]);

      expect(AiJobRepository.add).toHaveBeenCalledTimes(2);
      expect(vi.mocked(AiJobRepository.add).mock.calls[0][0].input.items).toHaveLength(2);
      expect(vi.mocked(AiJobRepository.add).mock.calls[1][0].input.items).toHaveLength(1);
      expect(result.errorCount).toBe(1);
      expect(AiJobRepository.updateStatus).toHaveBeenCalledWith(
        'batch-3',
        expect.objectContaining({ status: 'error' }),
      );
    });

    it('does not complete an analysis job when the sentence still has no valid reading', async () => {
      const job = {
        id: 'analysis-invalid',
        user_id: 'user-123',
        type: 'batch_analyze_sentences',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: { items: [{ id: 's-invalid', japanese: 'jp', portuguese: 'pt' }] },
      } as any;

      vi.mocked(SentenceRepository.getByIds)
        .mockResolvedValueOnce([{ id: 's-invalid', japanese: 'jp', portuguese: 'pt', status: 'translated' }] as any)
        .mockResolvedValueOnce([{ id: 's-invalid', japanese: 'jp', portuguese: 'pt', status: 'translated' }] as any);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'analysis-invalid',
            type: 'batch_analyze_sentences',
            items: [{ job_id: 's-invalid', kana: 'kana', romaji: '', terms: [] }],
          }],
        }),
      } as any);

      const result = await AiJobService.processJobsBatch([job]);

      expect(result.errorCount).toBe(1);
      expect(AiJobRepository.add).toHaveBeenCalledWith(expect.objectContaining({
        type: 'batch_analyze_sentences',
        status: 'pending',
      }));
      expect(AiJobRepository.updateStatus).toHaveBeenCalledWith(
        'analysis-invalid',
        expect.objectContaining({ status: 'error' }),
      );
      expect(SentenceRepository.update).not.toHaveBeenCalledWith(
        's-invalid',
        expect.objectContaining({ terms_source: 'ai_empty' }),
      );
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
    it('does not mark a dictionary entry as enriched when kana or romaji is still missing', async () => {
      const job = {
        id: 'dict-invalid',
        user_id: 'user-123',
        type: 'batch_enrich_dictionary_entries_full',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: { items: [{ id: 'entry-missing-reading', lemma: 'jp' }] },
      } as any;

      vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
        { id: 'entry-missing-reading', status: 'pending', main_meaning: null, kana: null, romaji: null, type: 'verbo' },
      ] as any);
      vi.mocked(DictionaryRepository.getById).mockResolvedValue({
        id: 'entry-missing-reading',
        lemma: 'jp',
        status: 'pending',
        main_meaning: null,
        kana: null,
        romaji: null,
        type: 'verbo',
        tags: [],
      } as any);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'dict-invalid',
            type: 'batch_enrich_dictionary_entries_full',
            items: [{ job_id: 'entry-missing-reading', main_meaning: 'ir', type: 'verbo' }],
          }],
        }),
      } as any);

      const result = await AiJobService.processJobsBatch([job]);

      expect(result.errorCount).toBe(1);
      expect(DictionaryRepository.update).not.toHaveBeenCalledWith(
        'entry-missing-reading',
        expect.objectContaining({ status: 'ai_enriched' }),
      );
      expect(AiJobRepository.updateStatus).toHaveBeenCalledWith(
        'dict-invalid',
        expect.objectContaining({ status: 'error' }),
      );
    });

    it('retries only failed dictionary items when a batch is partially applied', async () => {
      const job = {
        id: 'dict-partial',
        user_id: 'user-123',
        type: 'batch_enrich_dictionary_entries_full',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: {
          items: [
            { id: 'entry-ok', lemma: 'ok' },
            { id: 'entry-bad', lemma: 'bad' },
          ],
        },
      } as any;

      vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
        { id: 'entry-ok', status: 'pending', main_meaning: null, kana: null, romaji: null, type: 'verbo' },
        { id: 'entry-bad', status: 'pending', main_meaning: null, kana: null, romaji: null, type: 'verbo' },
      ] as any);
      vi.mocked(DictionaryRepository.getById).mockImplementation(async (id: string) => ({
        id,
        lemma: id === 'entry-ok' ? 'ok' : 'bad',
        status: 'pending',
        main_meaning: null,
        kana: null,
        romaji: null,
        type: 'verbo',
        tags: [],
      }) as any);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'dict-partial',
            type: 'batch_enrich_dictionary_entries_full',
            items: [
              { job_id: 'entry-ok', main_meaning: 'ir', kana: 'kana', romaji: 'romaji', type: 'verbo' },
              { job_id: 'entry-bad', main_meaning: 'falhar', type: 'verbo' },
            ],
          }],
        }),
      } as any);

      const result = await AiJobService.processJobsBatch([job]);

      expect(result.successCount).toBe(1);
      expect(result.errorCount).toBe(0);
      expect(DictionaryRepository.update).toHaveBeenCalledWith('entry-ok', expect.objectContaining({ status: 'ai_enriched' }));
      expect(AiJobRepository.add).toHaveBeenCalledTimes(1);
      expect(vi.mocked(AiJobRepository.add).mock.calls[0][0].input.items).toEqual([{ id: 'entry-bad', lemma: 'bad' }]);
      expect(AiJobRepository.updateStatus).toHaveBeenCalledWith(
        'dict-partial',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('falls back to merge when dictionary update hits unique_key constraint during a race', async () => {
      const job = {
        id: 'dict-race-23505',
        user_id: 'user-123',
        type: 'batch_enrich_dictionary_entries_full',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: { items: [{ id: 'entry-race', lemma: 'jp' }] },
      } as any;

      vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
        { id: 'entry-race', status: 'pending', main_meaning: null, kana: null, romaji: null, type: 'verbo' },
      ] as any);
      vi.mocked(DictionaryRepository.getById).mockResolvedValue({
        id: 'entry-race',
        lemma: 'jp',
        status: 'pending',
        main_meaning: null,
        kana: null,
        romaji: null,
        type: 'verbo',
        tags: [],
      } as any);
      vi.mocked(DictionaryRepository.getByUniqueKey)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'entry-winner', lemma: 'jp', unique_key: 'jp|kana|verbo' } as any);
      vi.mocked(DictionaryRepository.update).mockRejectedValueOnce(
        new Error('Erro do Supabase ao atualizar verbete de dicionario: duplicate key value violates unique constraint "uk_dictionary_entries_user_key"'),
      );
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'dict-race-23505',
            type: 'batch_enrich_dictionary_entries_full',
            items: [{ job_id: 'entry-race', main_meaning: 'ir', kana: 'kana', romaji: 'romaji', type: 'verbo' }],
          }],
        }),
      } as any);

      const result = await AiJobService.processJobsBatch([job]);

      expect(result.errorCount).toBe(0);
      expect(DictionaryRepository.mergeDuplicateIntoPrimary).toHaveBeenCalledWith(expect.objectContaining({
        duplicateId: 'entry-race',
        primaryId: 'entry-winner',
      }));
    });

    it('merges dictionary entries when enrichment converges to an existing unique_key', async () => {
      const job = {
        id: 'dict-duplicate-key',
        user_id: 'user-123',
        type: 'batch_enrich_dictionary_entries_full',
        target_type: 'batch',
        target_id: 'source-1',
        status: 'pending',
        input: { items: [{ id: 'entry-current', lemma: 'jp' }] },
      } as any;

      vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
        { id: 'entry-current', status: 'pending', main_meaning: null, kana: null, romaji: null, type: 'verbo' },
      ] as any);
      vi.mocked(DictionaryRepository.getById).mockResolvedValue({
        id: 'entry-current',
        lemma: 'jp',
        status: 'pending',
        main_meaning: null,
        kana: null,
        romaji: null,
        type: 'verbo',
        tags: [],
      } as any);
      vi.mocked(DictionaryRepository.getByUniqueKey).mockResolvedValue({
        id: 'entry-other',
        lemma: 'jp',
        unique_key: 'jp|kana|verbo',
      } as any);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{
            job_id: 'dict-duplicate-key',
            type: 'batch_enrich_dictionary_entries_full',
            items: [{ job_id: 'entry-current', main_meaning: 'ir', kana: 'kana', romaji: 'romaji', type: 'verbo' }],
          }],
        }),
      } as any);

      const result = await AiJobService.processJobsBatch([job]);

      expect(result.errorCount).toBe(0);
      expect(DictionaryRepository.update).not.toHaveBeenCalledWith('entry-current', expect.objectContaining({ unique_key: expect.any(String) }));
      expect(DictionaryRepository.mergeDuplicateIntoPrimary).toHaveBeenCalledWith(expect.objectContaining({
        duplicateId: 'entry-current',
        primaryId: 'entry-other',
        preferredUpdates: expect.objectContaining({ status: 'ai_enriched', kana: 'kana', romaji: 'romaji' }),
      }));
    });
  });
});
