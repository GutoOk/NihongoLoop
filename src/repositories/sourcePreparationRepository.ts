import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
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
      .select('id, portuguese, kana, romaji')
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

    let allTerms: Array<{ sentence_id: string; dictionary_form_id?: string | null }> = [];
    for (const chunk of chunkArray(sentenceIds, 100)) {
      const { data, error } = await supabase!
        .from('sentence_terms')
        .select('sentence_id, dictionary_form_id')
        .in('sentence_id', chunk)
        .eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar estatísticas de termos: ${error.message}`);
      }
      if (data) allTerms = allTerms.concat(data);
    }

    const rawTermSentenceIds = new Set(allTerms.map((t) => t.sentence_id));
    const formIds = Array.from(new Set(allTerms.map((t) => t.dictionary_form_id).filter(Boolean))) as string[];
    const entryIdByFormId = new Map<string, string>();
    let dictIds: string[] = [];
    if (formIds.length > 0) {
      for (const chunk of chunkArray(formIds, 100)) {
        const { data, error } = await supabase!
          .from('dictionary_forms')
          .select('id, dictionary_entry_id')
          .in('id', chunk)
          .eq('user_id', getUserId());
        if (error) throw new Error(`Erro do Supabase ao carregar formas para estatísticas: ${error.message}`);
        for (const form of data || []) {
          entryIdByFormId.set(form.id, form.dictionary_entry_id);
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

    const orphanDictIds = dictIds.filter((id) => !existingDictIds.has(id));
    dictPending += orphanDictIds.length;

    const validTermSentenceIds = new Set<string>();
    for (const term of allTerms) {
      const entryId = term.dictionary_form_id ? entryIdByFormId.get(term.dictionary_form_id) : null;
      if (entryId && existingDictIds.has(entryId)) {
        validTermSentenceIds.add(term.sentence_id);
      }
    }

    const withTrans = safeSentences.filter((s) => !!s.portuguese).length;
    const withReading = safeSentences.filter((s) => !!s.kana && !!s.romaji).length;
    const missingAnalysis = safeSentences.filter((s) => {
      return !s.kana || !s.romaji || !validTermSentenceIds.has(s.id);
    }).length;

    return {
      sTotal: safeSentences.length,
      sNoTrans: safeSentences.length - withTrans,
      sNoRead: safeSentences.length - withReading,
      sNoTerms: safeSentences.filter((s) => !rawTermSentenceIds.has(s.id)).length,
      sMissingAnalysis: missingAnalysis,
      dictTotal: dictIds.length,
      dictPending,
    };
  }
}
