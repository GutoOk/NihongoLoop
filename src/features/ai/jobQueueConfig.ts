import { AiJobType } from '../../types';

export type AiJobConcurrencyMap = Partial<Record<AiJobType, number>>;

export interface AiQueueLimits {
  global: number;
  perUser: number;
  claimBatchSize: number;
  leaseSeconds: number;
  byType: AiJobConcurrencyMap;
}

export const DEFAULT_AI_QUEUE_LIMITS: AiQueueLimits = {
  global: 8,
  perUser: 4,
  claimBatchSize: 8,
  leaseSeconds: 300,
  byType: {
    translate_sentence: 4,
    generate_sentence_reading: 2,
    detect_sentence_terms: 1,
    enrich_dictionary_entry: 1,
    generate_dictionary_senses: 1,
    explain_sentence: 2,
    repair_sentence: 2,
  },
};

export function getConcurrencyLimitForJobType(
  type: AiJobType,
  overrides: Partial<AiQueueLimits> = {},
): number {
  const mergedByType = { ...DEFAULT_AI_QUEUE_LIMITS.byType, ...overrides.byType };
  const configured = mergedByType[type] ?? DEFAULT_AI_QUEUE_LIMITS.perUser;
  const perUser = overrides.perUser ?? DEFAULT_AI_QUEUE_LIMITS.perUser;
  const global = overrides.global ?? DEFAULT_AI_QUEUE_LIMITS.global;
  return Math.max(1, Math.min(configured, perUser, global));
}

export function getClaimBatchSize(overrides: Partial<AiQueueLimits> = {}): number {
  return Math.max(1, Math.min(overrides.claimBatchSize ?? DEFAULT_AI_QUEUE_LIMITS.claimBatchSize, 100));
}

export function getLeaseSeconds(overrides: Partial<AiQueueLimits> = {}): number {
  return Math.max(30, Math.min(overrides.leaseSeconds ?? DEFAULT_AI_QUEUE_LIMITS.leaseSeconds, 3600));
}
