import { AiJobRepository } from '../repositories';
import { AuthService } from '../core/authService';
import { stableHash } from '../core/hash';

export class AiJobService {
  static async requestSentenceTranslation(sentenceId: string, japanese: string) {
    const input = { sentence: japanese };
    const hash = await stableHash({ type: 'translate_sentence', target: sentenceId, input });
    const existing = await AiJobRepository.getPendingByTarget('translate_sentence', 'sentence', sentenceId);
    if (existing && existing.input_hash === hash) return existing;

    return AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'translate_sentence',
      target_type: 'sentence',
      target_id: sentenceId,
      status: 'pending',
      priority: 300,
      input_hash: hash,
      input,
      payload: input,
      error: null,
      result: null,
    } as any);
  }

  static async requestSentenceReading(sentenceId: string, japanese: string, portuguese?: string | null) {
    const input = { sentence: japanese, portuguese: portuguese || null };
    const hash = await stableHash({ type: 'generate_sentence_reading', target: sentenceId, input });
    const existing = await AiJobRepository.getPendingByTarget('generate_sentence_reading', 'sentence', sentenceId);
    if (existing && existing.input_hash === hash) return existing;

    return AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'generate_sentence_reading',
      target_type: 'sentence',
      target_id: sentenceId,
      status: 'pending',
      priority: 200,
      input_hash: hash,
      input,
      payload: input,
      error: null,
      result: null,
    } as any);
  }

  static async requestDictionaryEnrichment(entryId: string, lemma: string) {
    const input = { lemma };
    const hash = await stableHash({ type: 'enrich_dictionary_entry', target: entryId, input });
    const existing = await AiJobRepository.getPendingByTarget('enrich_dictionary_entry', 'dictionary_entry', entryId);
    if (existing && existing.input_hash === hash) return existing;

    return AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'enrich_dictionary_entry',
      target_type: 'dictionary_entry',
      target_id: entryId,
      status: 'pending',
      priority: 100,
      input_hash: hash,
      input,
      payload: input,
      error: null,
      result: null,
    } as any);
  }
}
