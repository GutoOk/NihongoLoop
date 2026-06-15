import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { SentenceTerm } from '../types';
import { defaultMockDict, defaultMockSentences, defaultMockTerms } from './mockData';
import { chunkArray, getUserId, isE2EMockMode } from './utils';

export interface SourcePreparationStats {
  sTotal: number;
  sNoTrans: number;
  sNoRead: number;
  sNoTerms: number;
  sMissingAnalysis: number;
  dictPending: number;
}

export class SourcePreparationRepository {
  static async getStats(sourceId: string): Promise<SourcePreparationStats> {
    if (isE2EMockMode()) {
      const sentences = defaultMockSentences.filter((s) => s.source_id === sourceId);
      const sentenceIds = new Set(sentences.map((s) => s.id));
      const terms = defaultMockTerms.filter((t) => sentenceIds.has(t.sentence_id));
      const sentenceIdsWithTerms = new Set(terms.map((t) => t.sentence_id));
      const dictIds = new Set(terms.map((t) => t.dictionary_entry_id).filter(Boolean));
      const dictPending = defaultMockDict.filter(
        (entry) =>
          dictIds.has(entry.id) &&
          entry.status === 'pending' &&
          (!entry.main_meaning ||
            !entry.kana ||
            !entry.romaji ||
            !entry.type ||
            !Array.isArray(entry.meanings) ||
            entry.meanings.length === 0),
      ).length;
      const withTrans = sentences.filter((s) => !!s.portuguese).length;
      const withReading = sentences.filter((s) => !!s.kana && !!s.romaji).length;
      const missingAnalysis = sentences.filter((s) => {
        const hasNoTerms = !sentenceIdsWithTerms.has(s.id);
        const termsWereAttempted = s.terms_source === 'ai' || s.terms_source === 'ai_empty';
        return !s.kana || (hasNoTerms && !termsWereAttempted);
      }).length;

      return {
        sTotal: sentences.length,
        sNoTrans: sentences.length - withTrans,
        sNoRead: sentences.length - withReading,
        sNoTerms: sentences.filter((s) => !sentenceIdsWithTerms.has(s.id)).length,
        sMissingAnalysis: missingAnalysis,
        dictPending,
      };
    }

    if (!isSupabaseConfigured) {
      return { sTotal: 0, sNoTrans: 0, sNoRead: 0, sNoTerms: 0, sMissingAnalysis: 0, dictPending: 0 };
    }

    const { data: sentences, error: sentencesError } = await supabase!
      .from('sentences')
      .select('id, portuguese, kana, romaji, terms_source')
      .eq('source_id', sourceId)
      .eq('user_id', getUserId());
    if (sentencesError) {
      console.error(sentencesError);
      throw new Error(`Erro do Supabase ao carregar estatísticas de frases: ${sentencesError.message}`);
    }

    const safeSentences = sentences || [];
    const sentenceIds = safeSentences.map((s) => s.id);
    if (sentenceIds.length === 0) {
      return { sTotal: 0, sNoTrans: 0, sNoRead: 0, sNoTerms: 0, sMissingAnalysis: 0, dictPending: 0 };
    }

    let allTerms: Pick<SentenceTerm, 'sentence_id' | 'dictionary_entry_id'>[] = [];
    for (const chunk of chunkArray(sentenceIds, 100)) {
      const { data, error } = await supabase!
        .from('sentence_terms')
        .select('sentence_id, dictionary_entry_id')
        .in('sentence_id', chunk)
        .eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar estatísticas de termos: ${error.message}`);
      }
      if (data) allTerms = allTerms.concat(data);
    }

    const termSentenceIds = new Set(allTerms.map((t) => t.sentence_id));
    const dictIds = Array.from(new Set(allTerms.map((t) => t.dictionary_entry_id).filter(Boolean))) as string[];
    let dictPending = 0;

    for (const chunk of chunkArray(dictIds, 100)) {
      const { data, error } = await supabase!
        .from('dictionary_entries')
        .select('status, main_meaning, kana, romaji, type, meanings')
        .in('id', chunk)
        .eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar estatísticas de dicionário: ${error.message}`);
      }
      dictPending += (data || []).filter(
        (e) =>
          e.status === 'pending' &&
          (!e.main_meaning ||
            !e.kana ||
            !e.romaji ||
            !e.type ||
            !Array.isArray(e.meanings) ||
            e.meanings.length === 0),
      ).length;
    }

    const withTrans = safeSentences.filter((s) => !!s.portuguese).length;
    const withReading = safeSentences.filter((s) => !!s.kana && !!s.romaji).length;
    const missingAnalysis = safeSentences.filter((s) => {
      const hasNoTerms = !termSentenceIds.has(s.id);
      const termsWereAttempted = s.terms_source === 'ai' || s.terms_source === 'ai_empty';
      return !s.kana || (hasNoTerms && !termsWereAttempted);
    }).length;

    return {
      sTotal: safeSentences.length,
      sNoTrans: safeSentences.length - withTrans,
      sNoRead: safeSentences.length - withReading,
      sNoTerms: safeSentences.filter((s) => !termSentenceIds.has(s.id)).length,
      sMissingAnalysis: missingAnalysis,
      dictPending,
    };
  }
}
