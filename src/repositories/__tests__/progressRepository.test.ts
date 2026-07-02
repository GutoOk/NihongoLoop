import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgressRepository } from '../index';
import { supabase } from '../../core/supabaseClient';


vi.mock('../../core/supabaseClient', () => {
  const queryBuilder: any = {
    select: vi.fn(() => queryBuilder),
    eq: vi.fn(() => queryBuilder),
    maybeSingle: vi.fn(),
    upsert: vi.fn()
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
    getCurrentUserId: vi.fn(() => 'user-123')
  }
}));

describe('ProgressRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updateDictionaryProgressLog correctly increments correct counts and seen counts', async () => {
    const mockProgress = {
      dictionary_entry_id: 'dict-1',
      correct_count: 5,
      wrong_count: 2,
      seen_count: 7,
      history_log: []
    };

    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockProgress, error: null }),
      single: vi.fn().mockResolvedValue({ data: mockProgress, error: null }),
      upsert: vi.fn(() => builder)
    };
    
    vi.mocked(supabase.from).mockReturnValue(builder as any);

    await ProgressRepository.updateDictionaryProgressLog('dict-1', true);

    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        dictionary_entry_id: 'dict-1',
        correct_count: 6, // 5 + 1
        wrong_count: 2,
        seen_count: 8 // 7 + 1
      }),
      { onConflict: 'user_id,dictionary_entry_id' },
    );
  });

  it('updateDictionaryProgressLog correctly increments wrong counts', async () => {
    const mockProgress = {
      dictionary_entry_id: 'dict-1',
      correct_count: 5,
      wrong_count: 2,
      seen_count: 7,
      history_log: []
    };

    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockProgress, error: null }),
      single: vi.fn().mockResolvedValue({ data: mockProgress, error: null }),
      upsert: vi.fn(() => builder)
    };
    
    vi.mocked(supabase.from).mockReturnValue(builder as any);

    await ProgressRepository.updateDictionaryProgressLog('dict-1', false);

    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        dictionary_entry_id: 'dict-1',
        correct_count: 5,
        wrong_count: 3, // 2 + 1
        seen_count: 8 // 7 + 1
      }),
      { onConflict: 'user_id,dictionary_entry_id' },
    );
  });
});
