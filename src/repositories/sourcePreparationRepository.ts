import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { SentenceTerm } from '../types';
import { chunkArray, getUserId } from './utils';

export interface SourcePreparationStats {
  sTotal: number;
  sNoTrans: number;
  sNoRead: number;
  sNoTerms: number;
  sMissingAnalysis: number;
  dictTotal: number;
  dictPending: number;
}

export class SourcePreparationRepository {
  static async getStats(sourceId: string): Promise<SourcePreparationStats> {
    if (!isSupabaseConfigured) {
      return { sTotal: 0, sNoTrans: 0, sNoRead: 0, sNoTerms: 0, sMissingAnalysis: 0, dictTotal: 0, dictPending: 0 };
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
      return { sTotal: 0, sNoTrans: 0, sNoRead: 0, sNoTerms: 0, sMissingAnalysis: 0, dictTotal: 0, dictPending: 0 };
    }

    let allTerms: Pick<SentenceTerm, 'sentence_id' | 'dictionary_form_id' | 'dictionary_entry_id'>[] = [];
    for (const chunk of chunkArray(sentenceIds, 100)) {
      const { data, error } = await supabase!
        .from('sentence_terms')
        .select('sentence_id, dictionary_form_id, dictionary_entry_id')
        .in('sentence_id', chunk)
        .eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar estatísticas de termos: ${error.message}`);
      }
      if (data) allTerms = allTerms.concat(data);
    }

    const legacyDictIds = allTerms.map((t: any) => t.dictionary_entry_id).filter(Boolean);
    const formIds = Array.from(new Set(allTerms.map((t) => t.dictionary_form_id).filter(Boolean))) as string[];
    const formEntryMap = new Map<string, string>();
    let dictIds: string[] = legacyDictIds;

    if (formIds.length > 0) {
      for (const chunk of chunkArray(formIds, 100)) {
        const { data, error } = await supabase!
          .from('dictionary_forms')
          .select('id, dictionary_entry_id')
          .in('id', chunk)
          .eq('user_id', getUserId());
        if (error) throw new Error(`Erro do Supabase ao carregar formas para estatísticas: ${error.message}`);
        for (const form of data || []) {
          formEntryMap.set(form.id, form.dictionary_entry_id);
          dictIds.push(form.dictionary_entry_id);
        }
      }
    }

    dictIds = Array.from(new Set(dictIds));
    let dictPending = 0;
    const existingDictIds = new Set<string>();

    for (const chunk of chunkArray(dictIds, 100)) {
      const { data, error } = await supabase!
        .from('dictionary_entries')
        .select('id, status, main_meaning, kana, romaji, type')
        .in('id', chunk)
        .eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar estatísticas de dicionário: ${error.message}`);
      }
      for (const entry of data || []) {
        existingDictIds.add(entry.id);
      }
      dictPending += (data || []).filter(
        (e) =>
          e.status === 'pending' &&
          (!e.main_meaning ||
            !e.kana ||
            !e.romaji ||
            !e.type),
      ).length;
    }

    const validTermSentenceIds = new Set(
      allTerms
        .filter((term: any) => {
          const directEntryId = term.dictionary_entry_id;
          const formEntryId = term.dictionary_form_id ? formEntryMap.get(term.dictionary_form_id) : null;
          return existingDictIds.has(directEntryId) || Boolean(formEntryId && existingDictIds.has(formEntryId));
        })
        .map((term) => term.sentence_id),
    );
    const withTrans = safeSentences.filter((s) => !!s.portuguese).length;
    const withReading = safeSentences.filter((s) => !!s.kana && !!s.romaji).length;
    const missingAnalysis = safeSentences.filter((s) => {
      const hasNoTerms = !validTermSentenceIds.has(s.id);
      const confirmedNoTerms = s.terms_source === 'ai_empty';
      return !s.kana || (hasNoTerms && !confirmedNoTerms);
    }).length;

    return {
      sTotal: safeSentences.length,
      sNoTrans: safeSentences.length - withTrans,
      sNoRead: safeSentences.length - withReading,
      sNoTerms: safeSentences.filter((s) => !validTermSentenceIds.has(s.id)).length,
      sMissingAnalysis: missingAnalysis,
      dictTotal: existingDictIds.size,
      dictPending,
    };
  }
}
