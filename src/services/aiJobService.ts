import { AiJobRepository } from '../repositories';
import { AuthService } from '../core/authService';
import { stableHash } from '../core/hash';

const PROMPT_VERSION = 'client-requested:2026-06-v1';
const MODEL_VERSION = 'gemini-2.5-flash-lite';

async function buildJobContract(type: string, targetType: string, targetId: string, input: Record<string, unknown>) {
  const targetHash = await stableHash({
    targetType,
    targetId,
    payload: input,
    promptVersion: PROMPT_VERSION,
    model: MODEL_VERSION,
  });
  const inputHash = await stableHash({
    type,
    targetType,
    targetId,
    targetHash,
  });
  return {
    inputHash,
    targetHash,
    jobKey: `${type}:${targetType}:${targetId}:${inputHash}`,
  };
}

export class AiJobService {
  static async requestSentenceTranslation(sentenceId: string, japanese: string) {
    const input = { id: sentenceId, sentence: japanese, japanese };
    const contract = await buildJobContract('translate_sentence', 'sentence', sentenceId, input);
    const existing = await AiJobRepository.getPendingByTarget('translate_sentence', 'sentence', sentenceId);
    if (existing && existing.input_hash === contract.inputHash) return existing;

    return AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'translate_sentence',
      target_type: 'sentence',
      target_id: sentenceId,
      status: 'pending',
      priority: 300,
      input_hash: contract.inputHash,
      target_hash: contract.targetHash,
      job_key: contract.jobKey,
      prompt_version: PROMPT_VERSION,
      model_version: MODEL_VERSION,
      model: MODEL_VERSION,
      input,
      payload: input,
      error: null,
      result: null,
    } as any);
  }

  static async requestSentenceReading(sentenceId: string, japanese: string, portuguese?: string | null) {
    const input = { id: sentenceId, sentence: japanese, japanese, portuguese: portuguese || null };
    const contract = await buildJobContract('generate_sentence_reading', 'sentence', sentenceId, input);
    const existing = await AiJobRepository.getPendingByTarget('generate_sentence_reading', 'sentence', sentenceId);
    if (existing && existing.input_hash === contract.inputHash) return existing;

    return AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'generate_sentence_reading',
      target_type: 'sentence',
      target_id: sentenceId,
      status: 'pending',
      priority: 200,
      input_hash: contract.inputHash,
      target_hash: contract.targetHash,
      job_key: contract.jobKey,
      prompt_version: PROMPT_VERSION,
      model_version: MODEL_VERSION,
      model: MODEL_VERSION,
      input,
      payload: input,
      error: null,
      result: null,
    } as any);
  }

  static async requestDictionaryEnrichment(entryId: string, lemma: string) {
    const input = { id: entryId, entryId, lemma };
    const contract = await buildJobContract('enrich_dictionary_entry', 'dictionary_entry', entryId, input);
    const existing = await AiJobRepository.getPendingByTarget('enrich_dictionary_entry', 'dictionary_entry', entryId);
    if (existing && existing.input_hash === contract.inputHash) return existing;

    return AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'enrich_dictionary_entry',
      target_type: 'dictionary_entry',
      target_id: entryId,
      status: 'pending',
      priority: 100,
      input_hash: contract.inputHash,
      target_hash: contract.targetHash,
      job_key: contract.jobKey,
      prompt_version: PROMPT_VERSION,
      model_version: MODEL_VERSION,
      model: MODEL_VERSION,
      input,
      payload: input,
      error: null,
      result: null,
    } as any);
  }
}
