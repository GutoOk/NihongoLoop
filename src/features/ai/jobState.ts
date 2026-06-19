import { AiJob, AiJobStatus } from '../../types';

export const CANONICAL_AI_JOB_STATUSES = [
  'pending',
  'claimed',
  'running',
  'completed',
  'failed',
  'retry_wait',
  'needs_review',
  'cancelled',
  'obsolete',
] as const;

export type CanonicalAiJobStatus = typeof CANONICAL_AI_JOB_STATUSES[number];

export const LEGACY_AI_JOB_STATUS_MAP: Partial<Record<AiJobStatus, CanonicalAiJobStatus>> = {
  error: 'failed',
  rejected: 'failed',
  applied: 'completed',
};

const TRANSITIONS: Record<CanonicalAiJobStatus, CanonicalAiJobStatus[]> = {
  pending: ['claimed', 'running', 'cancelled', 'obsolete'],
  claimed: ['running', 'retry_wait', 'failed', 'cancelled', 'obsolete'],
  running: ['completed', 'retry_wait', 'needs_review', 'failed', 'cancelled', 'obsolete'],
  retry_wait: ['pending', 'claimed', 'cancelled', 'obsolete', 'failed'],
  needs_review: ['pending', 'retry_wait', 'failed', 'cancelled', 'obsolete'],
  failed: ['pending', 'retry_wait', 'cancelled', 'obsolete'],
  completed: ['obsolete'],
  cancelled: ['pending', 'obsolete'],
  obsolete: [],
};

export interface RetryBackoffOptions {
  attempt: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  now?: Date;
  random?: () => number;
}

export interface RetryDecision {
  status: Extract<AiJobStatus, 'retry_wait' | 'failed' | 'error'>;
  retry_at: string | null;
  error: string;
  error_code?: string | null;
  error_kind: 'transient' | 'permanent' | 'rate_limit' | 'invalid_response';
  error_structured: {
    message: string;
    code?: string | null;
    kind: RetryDecision['error_kind'];
    attempt: number;
    max_attempts: number;
  };
}

export function normalizeAiJobStatus(status: AiJobStatus): CanonicalAiJobStatus {
  return LEGACY_AI_JOB_STATUS_MAP[status] || (status as CanonicalAiJobStatus);
}

export function canTransitionAiJobStatus(from: AiJobStatus, to: AiJobStatus): boolean {
  const canonicalFrom = normalizeAiJobStatus(from);
  const canonicalTo = normalizeAiJobStatus(to);
  if (canonicalFrom === canonicalTo) return true;
  return TRANSITIONS[canonicalFrom]?.includes(canonicalTo) ?? false;
}

export function isTerminalAiJobStatus(status: AiJobStatus): boolean {
  return ['completed', 'failed', 'cancelled', 'obsolete'].includes(normalizeAiJobStatus(status));
}

export function isActiveAiJobStatus(status: AiJobStatus): boolean {
  return ['claimed', 'running'].includes(normalizeAiJobStatus(status));
}

export function isClaimableAiJob(job: Pick<AiJob, 'status' | 'retry_at'>, now = new Date()): boolean {
  const status = normalizeAiJobStatus(job.status);
  if (status === 'pending') return true;
  if (status !== 'retry_wait') return false;
  if (!job.retry_at) return true;
  return new Date(job.retry_at).getTime() <= now.getTime();
}

export function isLeaseExpired(
  job: Pick<AiJob, 'status' | 'lease_expires_at' | 'locked_until'>,
  now = new Date(),
): boolean {
  if (!isActiveAiJobStatus(job.status)) return false;
  const expiresAt = job.lease_expires_at || job.locked_until;
  return Boolean(expiresAt && new Date(expiresAt).getTime() < now.getTime());
}

export function getRetryAt(options: RetryBackoffOptions): Date {
  const {
    attempt,
    baseDelayMs = 30_000,
    maxDelayMs = 15 * 60_000,
    jitterRatio = 0.2,
    now = new Date(),
    random = Math.random,
  } = options;
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitterWindow = exponential * Math.max(0, jitterRatio);
  const jitter = jitterWindow === 0 ? 0 : Math.floor((random() * 2 - 1) * jitterWindow);
  return new Date(now.getTime() + Math.max(1000, exponential + jitter));
}

export function buildRetryDecision(params: {
  message: string;
  attempts: number;
  maxAttempts: number;
  errorCode?: string | null;
  errorKind?: RetryDecision['error_kind'];
  now?: Date;
  random?: () => number;
}): RetryDecision {
  const nextAttempt = Math.max(0, params.attempts);
  const maxAttempts = Math.max(1, params.maxAttempts);
  const errorKind = params.errorKind || 'transient';
  const shouldRetry = errorKind !== 'permanent' && nextAttempt < maxAttempts;

  return {
    status: shouldRetry ? 'retry_wait' : 'failed',
    retry_at: shouldRetry
      ? getRetryAt({ attempt: nextAttempt, now: params.now, random: params.random }).toISOString()
      : null,
    error: params.message,
    error_code: params.errorCode || null,
    error_kind: errorKind,
    error_structured: {
      message: params.message,
      code: params.errorCode || null,
      kind: errorKind,
      attempt: nextAttempt,
      max_attempts: maxAttempts,
    },
  };
}
