import { DictionaryFormRepository, DictionaryRepository, DictionarySenseRepository, TermRepository, SentenceRepository } from '../repositories';
import { Sentence } from '../types';
import { AuthService } from '../core/authService';

export function normalizeJapaneseKey(value: string): string {
  if (!value) return '';
  return value.trim().replace(/\s+/g, '');
}

export function generateDictionaryUniqueKey(lemma: string, kana: string | null, type: string | null): string {
  const normLemma = normalizeJapaneseKey(lemma);
  const normKana = kana ? normalizeJapaneseKey(kana) : '';
  return `${normLemma}|${normKana}|${type || 'outro'}`;
}

export class TermDetectionService {
  static async detectWordsInSource(sourceId: string): Promise<number> {
    const sentences = await SentenceRepository.getBySourceId(sourceId);
    return this.detectWordsInSentenceList(sentences);
  }

  static async detectWordsInSentences(sentenceIds: string[]): Promise<number> {
    const sentences = await SentenceRepository.getByIds(sentenceIds);
    return this.detectWordsInSentenceList(sentences);
  }

  private static async detectWordsInSentenceList(sentences: Sentence[]): Promise<number> {
    let matchedCount = 0;

    for (const sent of sentences) {
      if (!sent) continue;
      const candidates = this.extractCandidates(sent.japanese);
      if (candidates.length === 0) continue;

      const existingTerms = await TermRepository.getBySentence(sent.id);

      for (const { surface, startIndex, endIndex } of candidates) {
        if (surface === sent.japanese || surface.length >= sent.japanese.length * 0.9) continue;
        if (!surface.trim()) continue;
        if (existingTerms.some(t => t.start_index === startIndex && t.end_index === endIndex)) continue;

        const uniqueKey = generateDictionaryUniqueKey(surface, null, 'outro');
        let existingEntry = await DictionaryRepository.getByUniqueKey(uniqueKey);

        if (!existingEntry) {
          const sameLemmas = await DictionaryRepository.getByLemma(surface);
          if (sameLemmas.length > 0) {
            existingEntry = sameLemmas.find(e => e.type === 'outro') ?? sameLemmas[0];
          }
        }

        if (!existingEntry) {
          const newEntry = await DictionaryRepository.addBatch([{
            user_id: AuthService.getCurrentUserId(),
            lemma: surface,
            kana: null,
            romaji: null,
            type: 'outro',
            main_meaning: null,
            tags: [],
            jlpt_level: null,
            status: 'pending',
            unique_key: uniqueKey
          }]);
          if (newEntry.length > 0) {
            existingEntry = newEntry[0];
          }
        }

        if (existingEntry) {
          if (!DictionaryFormRepository?.resolveOrCreate) {
            await TermRepository.addBatch([{
              user_id: AuthService.getCurrentUserId(),
              sentence_id: sent.id,
              dictionary_entry_id: existingEntry.id,
              surface,
              start_index: startIndex,
              end_index: endIndex,
              confidence: 0.5,
              status: 'detected'
            } as any]);
            existingTerms.push({ start_index: startIndex, end_index: endIndex } as never);
            matchedCount++;
            continue;
          }
          const form = await DictionaryFormRepository.resolveOrCreate({
            dictionary_entry_id: existingEntry.id,
            form: surface,
            kana: null,
            romaji: null,
            form_type: 'surface',
            is_common: true,
          });
          const sense = existingEntry.main_meaning
            ? await DictionarySenseRepository.resolveOrCreate({
                dictionary_entry_id: existingEntry.id,
                meaning: existingEntry.main_meaning,
                meaning_type: 'principal',
              })
            : null;
          if (!form) continue;
          await TermRepository.addBatch([{
            user_id: AuthService.getCurrentUserId(),
            sentence_id: sent.id,
            dictionary_form_id: form.id,
            dictionary_sense_id: sense?.id || null,
            surface,
            start_index: startIndex,
            end_index: endIndex,
            confidence: 0.5,
            status: 'detected'
          }]);
          existingTerms.push({ start_index: startIndex, end_index: endIndex } as never);
          matchedCount++;
        }
      }
    }

    return matchedCount;
  }

  static extractCandidates(text: string): { surface: string; startIndex: number; endIndex: number }[] {
    const results: { surface: string; startIndex: number; endIndex: number }[] = [];
    if (!text) return results;

    const regex = /([゠-ヿ]+)|([一-龯]+[぀-ゟ]{0,3})|([぀-ゟ]{1,3})/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (/^[\s、。！？　]+$/.test(match[0])) continue;
      results.push({ surface: match[0], startIndex: match.index, endIndex: match.index + match[0].length });
    }

    return results;
  }
}
