import { describe, it, expect, vi } from 'vitest';
import { TermRepository, DictionaryRepository } from '../../repositories';
import { supabase } from '../../core/supabaseClient';

vi.mock('../../core/supabaseClient', () => {
  const queryBuilder: any = {
    select: vi.fn(() => queryBuilder),
    in: vi.fn(() => queryBuilder),
    eq: vi.fn(() => queryBuilder)
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: vi.fn(() => queryBuilder)
    }
  };
});

vi.mock('../../core/authService', () => ({
  AuthService: {
    getCurrentUserId: vi.fn().mockReturnValue('user-123')
  }
}));

describe('TermRepository', () => {
  it('getBySentences fetches terms filtered by sentence correct IDs in chunks', async () => {
    const builder = vi.mocked(supabase.from)('sentence_terms') as any;
    builder.eq.mockResolvedValue({ data: [{ sentence_id: 'sent-1', dictionary_entry_id: 'dict-1' }], error: null });
    
    const terms = await TermRepository.getBySentences(['sent-1', 'sent-2']);
    
    expect(supabase.from).toHaveBeenCalledWith('sentence_terms');
    expect(builder.in).toHaveBeenCalledWith('sentence_id', ['sent-1', 'sent-2']);
    expect(terms.length).toBe(1);
    expect(terms[0].dictionary_entry_id).toBe('dict-1');
  });
});
