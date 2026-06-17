import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DictionaryRepository } from '../../repositories';
import { supabase } from '../../core/supabaseClient';

const builders: Record<string, any> = {};

function createBuilder() {
  const builder: any = {
    delete: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => Promise.resolve({ error: null })),
  };
  return builder;
}

vi.mock('../../core/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn((table: string) => builders[table]),
  },
}));

vi.mock('../../core/authService', () => ({
  AuthService: {
    getCurrentUserId: vi.fn().mockReturnValue('user-123'),
  },
}));

describe('DictionaryRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const table of [
      'sentence_terms',
      'sentences',
      'dictionary_senses',
      'dictionary_forms',
      'dictionary_entries',
    ]) {
      builders[table] = createBuilder();
    }
  });

  it('deleteAll invalidates AI term analysis so preparation detects missing dictionary terms again', async () => {
    const ok = await DictionaryRepository.deleteAll();

    expect(ok).toBe(true);
    expect(supabase!.from).toHaveBeenCalledWith('sentence_terms');
    expect(builders.sentence_terms.delete).toHaveBeenCalled();
    expect(builders.sentence_terms.eq).toHaveBeenCalledWith('user_id', 'user-123');

    expect(supabase!.from).toHaveBeenCalledWith('sentences');
    expect(builders.sentences.update).toHaveBeenCalledWith({ terms_source: null });
    expect(builders.sentences.eq).toHaveBeenCalledWith('user_id', 'user-123');
    expect(builders.sentences.in).toHaveBeenCalledWith('terms_source', ['ai', 'cache']);
  });
});
