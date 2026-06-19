import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiJobRepository } from '../aiJobRepository';
import { supabase } from '../../core/supabaseClient';

vi.mock('../../core/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: vi.fn(),
  },
}));

vi.mock('../../core/authService', () => ({
  AuthService: {
    getCurrentUserId: vi.fn(() => 'user-123'),
  },
}));

describe('AiJobRepository queue RPCs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims jobs through the atomic claim RPC', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: [{ id: 'job-1', status: 'claimed' }],
      error: null,
    } as never);

    const jobs = await AiJobRepository.claimJobs({
      workerId: 'worker-1',
      jobTypes: ['translate_sentence'],
      limit: 8,
      leaseSeconds: 120,
      runId: 'run-1',
    });

    expect(supabase!.rpc).toHaveBeenCalledWith('claim_ai_jobs', {
      p_worker_id: 'worker-1',
      p_job_types: ['translate_sentence'],
      p_limit: 8,
      p_lease_seconds: 120,
      p_user_id: 'user-123',
      p_run_id: 'run-1',
    });
    expect(jobs).toEqual([{ id: 'job-1', status: 'claimed' }]);
  });

  it('starts and renews leases through worker-scoped RPCs', async () => {
    vi.mocked(supabase!.rpc)
      .mockResolvedValueOnce({ data: { id: 'job-1', status: 'running' }, error: null } as never)
      .mockResolvedValueOnce({ data: true, error: null } as never);

    await expect(AiJobRepository.startClaimedJob('job-1', 'worker-1', 180)).resolves.toEqual({
      id: 'job-1',
      status: 'running',
    });
    await expect(AiJobRepository.refreshLease('job-1', 'worker-1', 180)).resolves.toBe(true);

    expect(supabase!.rpc).toHaveBeenNthCalledWith(1, 'start_claimed_ai_job', {
      p_job_id: 'job-1',
      p_worker_id: 'worker-1',
      p_lease_seconds: 180,
    });
    expect(supabase!.rpc).toHaveBeenNthCalledWith(2, 'heartbeat_ai_job', {
      p_job_id: 'job-1',
      p_worker_id: 'worker-1',
      p_lease_seconds: 180,
    });
  });

  it('recovers expired leases and records worker failures through RPCs', async () => {
    vi.mocked(supabase!.rpc)
      .mockResolvedValueOnce({ data: 3, error: null } as never)
      .mockResolvedValueOnce({ data: { id: 'job-2', status: 'retry_wait' }, error: null } as never);

    await expect(AiJobRepository.recoverExpiredLeases(50, 30)).resolves.toBe(3);
    await expect(AiJobRepository.failForRetry({
      jobId: 'job-2',
      workerId: 'worker-1',
      error: 'HTTP 429',
      errorCode: 'HTTP_429',
      errorKind: 'rate_limit',
      retryAt: '2026-06-18T12:01:00.000Z',
    })).resolves.toEqual({ id: 'job-2', status: 'retry_wait' });

    expect(supabase!.rpc).toHaveBeenNthCalledWith(1, 'recover_expired_ai_job_leases', {
      p_limit: 50,
      p_retry_delay_seconds: 30,
    });
    expect(supabase!.rpc).toHaveBeenNthCalledWith(2, 'fail_ai_job_for_retry', {
      p_job_id: 'job-2',
      p_worker_id: 'worker-1',
      p_error: 'HTTP 429',
      p_error_code: 'HTTP_429',
      p_error_kind: 'rate_limit',
      p_retry_at: '2026-06-18T12:01:00.000Z',
    });
  });

  it('completes jobs through a worker-scoped RPC with metrics', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { id: 'job-1', status: 'completed' },
      error: null,
    } as never);

    await expect(AiJobRepository.completeFromWorker({
      jobId: 'job-1',
      workerId: 'worker-1',
      result: { translation: 'Oi' },
      rawResult: { raw: true },
      inputTokens: 10,
      outputTokens: 5,
      costActual: 0.001,
      latencyAiMs: 1000,
      latencyPersistMs: 20,
    })).resolves.toEqual({ id: 'job-1', status: 'completed' });

    expect(supabase!.rpc).toHaveBeenCalledWith('complete_ai_job', {
      p_job_id: 'job-1',
      p_worker_id: 'worker-1',
      p_result: { translation: 'Oi' },
      p_raw_result: { raw: true },
      p_input_tokens: 10,
      p_output_tokens: 5,
      p_cost_actual: 0.001,
      p_latency_ai_ms: 1000,
      p_latency_persist_ms: 20,
    });
  });
});
