import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { SentenceTerm } from '../types';
import { defaultMockTerms } from './mockData';
import { chunkArray, getUserId, isE2EMockMode } from './utils';

export class TermRepository {
  static async getAll(): Promise<SentenceTerm[]> {
    if (isE2EMockMode()) return defaultMockTerms;
    if (!isSupabaseConfigured) return [];
    try {
      const { data } = await supabase!.from('sentence_terms').select('*').eq('user_id', getUserId());
      return data || [];
    } catch {
      return [];
    }
  }

  static async getBySentence(sentenceId: string): Promise<SentenceTerm[]> {
    if (isE2EMockMode()) return defaultMockTerms.filter((t) => t.sentence_id === sentenceId);
    if (!isSupabaseConfigured) return [];
    const { data: termsData } = await supabase!.from('sentence_terms').select('*').eq('sentence_id', sentenceId).eq('user_id', getUserId());
    const rawTerms: SentenceTerm[] = termsData || [];

    if (rawTerms.length > 0) {
      const { data: sentence } = await supabase!.from('sentences').select('japanese').eq('id', sentenceId).eq('user_id', getUserId()).maybeSingle();
      if (sentence?.japanese) {
        await repairTermIndices(rawTerms, sentence.japanese);
      }
    }

    return rawTerms;
  }

  static async getBySentences(sentenceIds: string[]): Promise<SentenceTerm[]> {
    if (isE2EMockMode()) return defaultMockTerms.filter((t) => sentenceIds.includes(t.sentence_id));
    if (!isSupabaseConfigured || sentenceIds.length === 0) return [];

    let allTermsData: SentenceTerm[] = [];
    const chunks = chunkArray(sentenceIds, 100);

    for (const chunk of chunks) {
      const { data, error } = await supabase!.from('sentence_terms').select('*').in('sentence_id', chunk).eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar termos de frases: ${error.message}`);
      }
      if (data) allTermsData = allTermsData.concat(data);
    }

    if (allTermsData.length > 0) {
      let allSentences: { id: string; japanese: string }[] = [];
      for (const chunk of chunks) {
        const { data, error } = await supabase!.from('sentences').select('id, japanese').in('id', chunk).eq('user_id', getUserId());
        if (error) {
          console.error(error);
          throw new Error(`Erro do Supabase ao carregar frases correlatas aos termos: ${error.message}`);
        }
        if (data) allSentences = allSentences.concat(data);
      }

      const sentenceMap = new Map(allSentences.map(s => [s.id, s.japanese]));
      const bySentence = new Map<string, SentenceTerm[]>();
      for (const t of allTermsData) {
        if (!bySentence.has(t.sentence_id)) bySentence.set(t.sentence_id, []);
        bySentence.get(t.sentence_id)!.push(t);
      }
      for (const [sentId, terms] of bySentence.entries()) {
        const japanese = sentenceMap.get(sentId);
        if (japanese) await repairTermIndices(terms, japanese);
      }
    }

    return allTermsData;
  }

  static async getByDictionaryEntry(entryId: string): Promise<SentenceTerm[]> {
    if (isE2EMockMode()) return defaultMockTerms.filter((t) => t.dictionary_entry_id === entryId);
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sentence_terms').select('*').eq('dictionary_entry_id', entryId).eq('user_id', getUserId());
    return data || [];
  }

  static async addBatch(terms: Omit<SentenceTerm, 'id' | 'created_at' | 'updated_at'>[]): Promise<SentenceTerm[]> {
    if (!isSupabaseConfigured) return [];

    const uniqueTermsMap = new Map<string, Record<string, unknown>>();
    for (const t of terms) {
      const input = { ...t, user_id: t.user_id || getUserId() };
      const key = `${input.sentence_id}_${input.surface}_${input.start_index}_${input.end_index}`;
      if (!uniqueTermsMap.has(key) || (!uniqueTermsMap.get(key)!.context_meaning && input.context_meaning)) {
        uniqueTermsMap.set(key, input as Record<string, unknown>);
      }
    }
    const enriched = Array.from(uniqueTermsMap.values());
    if (enriched.length === 0) return [];

    const sentenceIds = Array.from(new Set(enriched.map(t => t.sentence_id as string).filter(Boolean)));
    const existingKeys = new Set<string>();

    if (sentenceIds.length > 0) {
      for (const chunk of chunkArray(sentenceIds, 100)) {
        const { data: existingData, error: fetchError } = await supabase!
          .from('sentence_terms')
          .select('sentence_id, surface, start_index, end_index')
          .in('sentence_id', chunk)
          .eq('user_id', getUserId());
        if (!fetchError && existingData) {
          for (const e of existingData) {
            existingKeys.add(`${e.sentence_id}_${e.surface}_${e.start_index}_${e.end_index}`);
          }
        }
      }
    }

    const finalTermsToInsert = enriched.filter(t => {
      const key = `${t.sentence_id}_${t.surface}_${t.start_index}_${t.end_index}`;
      return !existingKeys.has(key);
    });

    if (finalTermsToInsert.length === 0) return [];

    const { data, error } = await supabase!.from('sentence_terms').insert(finalTermsToInsert).select();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao inserir termos em lote: ${error.message}`);
    }
    return data || [];
  }

  static async update(id: string, updates: Partial<SentenceTerm>): Promise<SentenceTerm | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('sentence_terms').update(updates).eq('id', id).eq('user_id', getUserId()).select().maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao atualizar termo: ${error.message}`);
    }
    return data || null;
  }

  static async delete(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('sentence_terms').delete().eq('id', id).eq('user_id', getUserId());
    return !error;
  }

  static async deleteBySentenceIds(sentenceIds: string[]): Promise<boolean> {
    if (!isSupabaseConfigured || sentenceIds.length === 0) return true;
    for (const chunk of chunkArray(sentenceIds, 100)) {
      const { error } = await supabase!.from('sentence_terms')
        .delete()
        .in('sentence_id', chunk)
        .eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao deletar termos em lote: ${error.message}`);
      }
    }
    return true;
  }
}

async function repairTermIndices(terms: SentenceTerm[], japanese: string): Promise<void> {
  for (const t of terms) {
    const currentSub = japanese.substring(t.start_index, t.end_index);
    if (currentSub === t.surface) continue;

    let bestStart = -1;
    let minDiff = Infinity;
    let pos = japanese.indexOf(t.surface);
    while (pos !== -1) {
      const diff = Math.abs(pos - t.start_index);
      if (diff < minDiff) { minDiff = diff; bestStart = pos; }
      pos = japanese.indexOf(t.surface, pos + 1);
    }

    if (bestStart !== -1) {
      t.start_index = bestStart;
      t.end_index = bestStart + t.surface.length;
      if (t.id) {
        await supabase!.from('sentence_terms')
          .update({ start_index: t.start_index, end_index: t.end_index, updated_at: new Date().toISOString() })
          .eq('id', t.id)
          .eq('user_id', getUserId());
      }
    }
  }
}
