import { DictionaryRepository, TermRepository, SentenceRepository } from '../repositories';
import { Sentence } from '../types';
import { AuthService } from '../core/authService';

export function normalizeJapaneseKey(value: string): string {
  if (!value) return '';
  return value.trim().replace(/\s+/g, '');
}

export function generateDictionaryUniqueKey(lemma: string, kana: string | null, type: string | null): string {
  const normLemma = normalizeJapaneseKey(lemma);
  const t = type || 'outro';
  if (kana) {
    const normKana = normalizeJapaneseKey(kana);
    return `${normLemma}_${normKana}_${t}`;
  }
  return `${normLemma}_${t}_pending`;
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
        let entryId: string | null = null;
        let entryType = 'outro';

        let existingEntry = await DictionaryRepository.getByUniqueKey(uniqueKey);

        if (!existingEntry) {
          const sameLemmas = await DictionaryRepository.getByLemma(surface);
          if (sameLemmas.length > 0) {
            existingEntry = sameLemmas.find(e => e.type === 'outro') ?? sameLemmas[0];
          }
        }

        if (existingEntry) {
          entryId = existingEntry.id;
          entryType = existingEntry.type;
        } else {
          const newEntry = await DictionaryRepository.addBatch([{
            user_id: AuthService.getCurrentUserId(),
            lemma: surface,
            kana: null,
            romaji: null,
            type: 'outro',
            main_meaning: null,
            meanings: [],
            tags: [],
            jlpt_level: null,
            status: 'pending',
            unique_key: uniqueKey
          }]);
          if (newEntry.length > 0) {
            entryId = newEntry[0].id;
          }
        }

        if (entryId) {
          await TermRepository.addBatch([{
            user_id: AuthService.getCurrentUserId(),
            sentence_id: sent.id,
            dictionary_entry_id: entryId,
            surface,
            lemma: surface,
            kana: null,
            romaji: null,
            start_index: startIndex,
            end_index: endIndex,
            type: entryType,
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
