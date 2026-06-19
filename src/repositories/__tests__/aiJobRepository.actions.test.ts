import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiJobRepository } from '../aiJobRepository';
import { supabase } from '../../core/supabaseClient';

vi.mock('../../core/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

vi.mock('../utils', () => ({
  getUserId: vi.fn(() => 'user-123'),
}));

describe('AiJobRepository user-facing actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues dictionary enrichment through the bulk database RPC', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({ data: 2, error: null } as never);

    await expect(AiJobRepository.enqueueDictionaryEnrichmentJobs(['entry-1', 'entry-2'])).resolves.toBe(2);

    expect(supabase!.rpc).toHaveBeenCalledWith('enqueue_dictionary_enrichment_jobs', {
      p_entry_ids: ['entry-1', 'entry-2'],
      p_user_id: 'user-123',
      p_model: 'gemini-2.5-flash-lite',
      p_prompt_version: 'dictionary-worker:2026-06-v1',
    });
  });

  it('marks running jobs as cancel requested when cancelling a run', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({ data: 3, error: null } as never);

    await expect(AiJobRepository.cancelActiveJobsByRun('run-1')).resolves.toBe(true);

    expect(supabase!.rpc).toHaveBeenCalledWith('cancel_ai_jobs_by_run', {
      p_run_id: 'run-1',
      p_user_id: 'user-123',
    });
  });
});
