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

  it('marks running jobs as cancel requested when cancelling a run', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({ data: 3, error: null } as never);

    await expect(AiJobRepository.cancelActiveJobsByRun('run-1')).resolves.toBe(true);

    expect(supabase!.rpc).toHaveBeenCalledWith('cancel_processing_run', { p_run_id: 'run-1' });
  });
});
