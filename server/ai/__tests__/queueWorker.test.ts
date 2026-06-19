import { describe, expect, it, vi } from 'vitest';
import { processDetectSentenceTermsJob, validateAiWorkerStartup } from '../queueWorker';

function makeReviewedSentenceClient() {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'start_claimed_ai_job') {
      return {
        data: {
          id: 'job-1',
          user_id: 'user-1',
          type: 'detect_sentence_terms',
          target_type: 'sentence',
          target_id: 'sentence-1',
          status: 'running',
          worker_id: 'worker-1',
          payload: { id: 'sentence-1', sentence: '待って' },
        },
        error: null,
      };
    }
    if (name === 'complete_ai_job') return { data: null, error: null };
    return { data: null, error: null };
  });

  const from = vi.fn((table: string) => {
    if (table === 'sentences') {
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: {
            id: 'sentence-1',
            user_id: 'user-1',
            source_id: 'source-1',
            japanese: '待って',
            japanese_key: '待って',
            portuguese: 'Espere.',
            kana: 'まって',
            romaji: 'matte',
            status: 'reviewed',
          },
          error: null,
        })),
      };
      return query;
    }
    if (table === 'sentence_terms') {
      return {
        delete: vi.fn(() => {
          throw new Error('sentence_terms.delete must not be called for reviewed sentence');
        }),
      };
    }
    return {};
  });

  return { rpc, from } as any;
}

describe('queueWorker safety', () => {
  it('fails startup validation when worker health token is missing', async () => {
    const previousToken = process.env.INTERNAL_HEALTH_TOKEN;
    delete process.env.INTERNAL_HEALTH_TOKEN;
    const result = await validateAiWorkerStartup({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key',
      requireHealthToken: true,
    });
    process.env.INTERNAL_HEALTH_TOKEN = previousToken;

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('INTERNAL_HEALTH_TOKEN');
  });

  it('completes a lexical job for reviewed sentence without deleting terms or calling AI', async () => {
    const client = makeReviewedSentenceClient();
    const getAi = vi.fn(() => {
      throw new Error('AI must not be called for reviewed sentence');
    });

    await processDetectSentenceTermsJob(
      client,
      {
        id: 'job-1',
        user_id: 'user-1',
        type: 'detect_sentence_terms',
        target_type: 'sentence',
        target_id: 'sentence-1',
        payload: { id: 'sentence-1', sentence: '待って' },
      } as any,
      'worker-1',
      300,
      getAi as any,
    );

    expect(getAi).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith('complete_ai_job', expect.objectContaining({
      p_job_id: 'job-1',
      p_worker_id: 'worker-1',
      p_result: expect.objectContaining({ optimization: 'already_reviewed' }),
    }));
    expect(client.from).not.toHaveBeenCalledWith('sentence_terms');
  });
});
