export const SUPPORTED_AI_JOB_TYPES = [
  'prepare_sentence',
  'translate_sentence',
  'generate_sentence_reading',
  'detect_sentence_terms',
  'enrich_dictionary_entry',
] as const;

export type AiJobType = typeof SUPPORTED_AI_JOB_TYPES[number];

export function isSupportedAiJobType(type: string): type is AiJobType {
  return (SUPPORTED_AI_JOB_TYPES as readonly string[]).includes(type);
}
