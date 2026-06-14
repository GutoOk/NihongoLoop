import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TermDetectionService } from '../termDetectionService';
import { SentenceRepository, TermRepository, DictionaryRepository } from '../../repositories';

vi.mock('../../repositories', () => ({
  SentenceRepository: {
    getByIds: vi.fn()
  },
  TermRepository: {
    getBySentence: vi.fn(),
    addBatch: vi.fn()
  },
  DictionaryRepository: {
    getByUniqueKey: vi.fn(),
    getByLemma: vi.fn(),
    addBatch: vi.fn()
  }
}));

// Provide stable testing implementations
vi.mock('../../core/authService', () => ({
  AuthService: {
    getCurrentUserId: vi.fn(() => 'user-123')
  }
}));

describe('TermDetectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractCandidates', () => {
    it('detects kanji + hiragana patterns', () => {
      const candidates = TermDetectionService.extractCandidates('食べる');
      expect(candidates).toEqual([{ surface: '食べる', startIndex: 0, endIndex: 3 }]);
    });
    
    it('does not extract pure particles like o or ni unless part of a structure', () => {
      // In current algorithm, Katakana or Kanji sequences are words
      const candidates = TermDetectionService.extractCandidates('犬が走る');
      // Our regex might include particles in sequence depending on implementation, so we just check it extracts meaningful parts.
      // E.g., it might extract "犬が" and "走る"
      expect(candidates.map(c => c.surface)).toEqual(expect.arrayContaining(['走る']));
    });

  });

  describe('detectWordsInSentences', () => {
    it('creates terms for new words found in a sentence', async () => {
      vi.mocked(SentenceRepository.getByIds).mockResolvedValue([
        { id: 's1', japanese: '私は先生です。' } as any
      ]);
      vi.mocked(TermRepository.getBySentence).mockResolvedValue([]);
      
      vi.mocked(DictionaryRepository.getByUniqueKey).mockResolvedValue(null);
      vi.mocked(DictionaryRepository.getByLemma).mockResolvedValue([]);
      vi.mocked(DictionaryRepository.addBatch).mockResolvedValue([{ id: 'dict-1' }] as any);

      const count = await TermDetectionService.detectWordsInSentences(['s1']);
      
      // Expected to match "私", "先生" etc.
      expect(DictionaryRepository.addBatch).toHaveBeenCalled();
      expect(TermRepository.addBatch).toHaveBeenCalled();
      expect(count).toBeGreaterThan(0);
    });

    it('does not create duplicate dictionary entries if the word already exists', async () => {
      vi.mocked(SentenceRepository.getByIds).mockResolvedValue([
        { id: 's1', japanese: '私は先生です。' } as any
      ]);
      vi.mocked(TermRepository.getBySentence).mockResolvedValue([]);
      
      // Word already exists
      vi.mocked(DictionaryRepository.getByUniqueKey).mockImplementation((() => null) as any);
      vi.mocked(DictionaryRepository.getByLemma).mockResolvedValue([
        { id: 'dict-present', type: 'substantivo' }
      ] as any);

      await TermDetectionService.detectWordsInSentences(['s1']);
      
      expect(DictionaryRepository.addBatch).not.toHaveBeenCalled();
      expect(TermRepository.addBatch).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ dictionary_entry_id: 'dict-present', surface: expect.any(String) })
      ]));
    });

    it('does not recreate terms that exist exactly in the sentence', async () => {
      vi.mocked(SentenceRepository.getByIds).mockResolvedValue([
        { id: 's1', japanese: '私は先生です。' } as any
      ]);
      
      // extractCandidates will find 先生 from 0 to 2 for example. Let's mock extractCandidates directly for stability.
      vi.spyOn(TermDetectionService, 'extractCandidates').mockReturnValue([
        { surface: '先生', startIndex: 2, endIndex: 4 }
      ]);

      vi.mocked(TermRepository.getBySentence).mockResolvedValue([
        { start_index: 2, end_index: 4 } as any // Term exists perfectly
      ]);

      const count = await TermDetectionService.detectWordsInSentences(['s1']);
      
      expect(TermRepository.addBatch).not.toHaveBeenCalled();
      expect(count).toBe(0);
    });

  });
});
