import { describe, expect, it } from 'vitest';
import { getConcurrencyLimitForJobType } from '../jobQueueConfig';
import {
  buildRetryDecision,
  canTransitionAiJobStatus,
  getRetryAt,
  isClaimableAiJob,
  isLeaseExpired,
  normalizeAiJobStatus,
} from '../jobState';

describe('AI job queue contract', () => {
  it('normalizes legacy statuses without losing compatibility', () => {
    expect(normalizeAiJobStatus('error')).toBe('failed');
    expect(normalizeAiJobStatus('applied')).toBe('completed');
    expect(normalizeAiJobStatus('pending')).toBe('pending');
  });

  it('allows only explicit state transitions', () => {
    expect(canTransitionAiJobStatus('pending', 'claimed')).toBe(true);
    expect(canTransitionAiJobStatus('running', 'completed')).toBe(true);
    expect(canTransitionAiJobStatus('completed', 'running')).toBe(false);
    expect(canTransitionAiJobStatus('obsolete', 'pending')).toBe(false);
  });

  it('detects claimable retry jobs only after retry_at', () => {
    const now = new Date('2026-06-18T12:00:00.000Z');
    expect(isClaimableAiJob({ status: 'pending', retry_at: null }, now)).toBe(true);
    expect(isClaimableAiJob({ status: 'retry_wait', retry_at: '2026-06-18T11:59:59.000Z' }, now)).toBe(true);
    expect(isClaimableAiJob({ status: 'retry_wait', retry_at: '2026-06-18T12:00:01.000Z' }, now)).toBe(false);
  });

  it('detects expired leases for claimed and running jobs', () => {
    const now = new Date('2026-06-18T12:00:00.000Z');
    expect(isLeaseExpired({ status: 'claimed', lease_expires_at: '2026-06-18T11:59:00.000Z' }, now)).toBe(true);
    expect(isLeaseExpired({ status: 'running', locked_until: '2026-06-18T12:01:00.000Z' }, now)).toBe(false);
    expect(isLeaseExpired({ status: 'pending', lease_expires_at: '2026-06-18T11:59:00.000Z' }, now)).toBe(false);
  });

  it('uses exponential backoff with deterministic jitter when provided', () => {
    const retryAt = getRetryAt({
      attempt: 3,
      baseDelayMs: 1000,
      maxDelayMs: 60_000,
      jitterRatio: 0,
      now: new Date('2026-06-18T12:00:00.000Z'),
    });
    expect(retryAt.toISOString()).toBe('2026-06-18T12:00:04.000Z');
  });

  it('moves transient failures to retry_wait until max attempts is reached', () => {
    const decision = buildRetryDecision({
      message: 'rate limited',
      attempts: 2,
      maxAttempts: 3,
      errorCode: 'HTTP_429',
      errorKind: 'rate_limit',
      now: new Date('2026-06-18T12:00:00.000Z'),
      random: () => 0.5,
    });

    expect(decision.status).toBe('retry_wait');
    expect(decision.retry_at).toBeTruthy();
    expect(decision.error_structured).toMatchObject({
      code: 'HTTP_429',
      kind: 'rate_limit',
      attempt: 2,
      max_attempts: 3,
    });

    expect(buildRetryDecision({
      message: 'invalid input',
      attempts: 1,
      maxAttempts: 3,
      errorKind: 'permanent',
    }).status).toBe('failed');
  });

  it('centralizes per-type concurrency limits', () => {
    expect(getConcurrencyLimitForJobType('translate_sentence')).toBe(4);
    expect(getConcurrencyLimitForJobType('enrich_dictionary_entry')).toBe(1);
    expect(getConcurrencyLimitForJobType('translate_sentence', { global: 4 })).toBe(4);
  });
});
