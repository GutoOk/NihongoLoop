import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiJobService } from '../aiJobService';
import { AiJobRepository } from '../../repositories';
import { AuthService } from '../../core/authService';
import { stableHash } from '../../core/hash';

vi.mock('../../repositories', () => ({
  AiJobRepository: {
    getPendingByTarget: vi.fn(),
    add: vi.fn(),
  },
  SentenceRepository: {},
  DictionaryRepository: {},
  TermRepository: {}
}));

vi.mock('../../core/authService', () => ({
  AuthService: {
    getCurrentUserId: vi.fn(() => 'user-123'),
  }
}));

describe('AiJobService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
