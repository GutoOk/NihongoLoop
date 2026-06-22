import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { DictionaryProgress, SentenceProgress } from '../types';
import { chunkArray, computeSrsUpdate, computeFSRSUpdate, FSRSRating, getUserId } from './utils';

export class ProgressRepository {
  static async getSentenceProgress(sentenceId: string): Promise<SentenceProgress | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('sentence_progress').select('*').eq('sentence_id', sentenceId).eq('user_id', getUserId()).maybeSingle();
    return data;
  }

  static async getSentenceProgressForSentences(sentenceIds: string[]): Promise<SentenceProgress[]> {
    if (!isSupabaseConfigured || sentenceIds.length === 0) return [];
    let allData: SentenceProgress[] = [];
    for (const chunk of chunkArray(sentenceIds, 100)) {
      const { data, error } = await supabase!.from('sentence_progress').select('*').in('sentence_id', chunk).eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar progressos de frases em lote: ${error.message}`);
      }
      if (data) allData = allData.concat(data);
    }
    return allData;
  }

  static async upsertSentenceProgress(progress: Partial<SentenceProgress>): Promise<SentenceProgress | null> {
    if (!isSupabaseConfigured) return null;
    const enriched = { ...progress, user_id: progress.user_id || getUserId() };
    const { data, error } = await supabase!.from('sentence_progress').upsert(enriched).select().maybeSingle();
    if (error) console.error(error);
    return data;
  }

  static async getDictionaryProgress(dictionaryEntryId: string): Promise<DictionaryProgress | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('dictionary_progress').select('*').eq('dictionary_entry_id', dictionaryEntryId).eq('user_id', getUserId()).maybeSingle();
    return data;
  }

  static async getAllDictionaryProgress(): Promise<DictionaryProgress[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data } = await supabase!.from('dictionary_progress').select('*').eq('user_id', getUserId());
      return data || [];
    } catch {
      return [];
    }
  }

  static async upsertDictionaryProgress(progress: Partial<DictionaryProgress>): Promise<DictionaryProgress | null> {
    if (!isSupabaseConfigured) return null;
    const enriched = { ...progress, user_id: progress.user_id || getUserId() };
    const { data, error } = await supabase!.from('dictionary_progress').upsert(enriched).select().maybeSingle();
    if (error) console.error(error);
    return data;
  }

  static async updateSentenceProgressLog(sentenceId: string, isCorrect: boolean): Promise<SentenceProgress | null> {
    const existing = await this.getSentenceProgress(sentenceId);
    const srs = computeSrsUpdate(existing, isCorrect);
    return this.upsertSentenceProgress({
      ...(existing ? { id: existing.id } : {}),
      sentence_id: sentenceId,
      user_id: getUserId(),
      ...srs,
    });
  }

  static async updateDictionaryProgressLog(dictionaryEntryId: string, isCorrect: boolean): Promise<DictionaryProgress | null> {
    const existing = await this.getDictionaryProgress(dictionaryEntryId);
    const srs = computeSrsUpdate(existing, isCorrect);
    return this.upsertDictionaryProgress({
      ...(existing ? { id: existing.id } : {}),
      dictionary_entry_id: dictionaryEntryId,
      user_id: getUserId(),
      ...srs,
    });
  }

  static async setDictionaryProgressFields(dictionaryEntryId: string, fields: Partial<DictionaryProgress>): Promise<DictionaryProgress | null> {
    const existing = await this.getDictionaryProgress(dictionaryEntryId);
    return this.upsertDictionaryProgress({
      ...(existing ? { id: existing.id } : {}),
      dictionary_entry_id: dictionaryEntryId,
      user_id: getUserId(),
      ...fields,
    });
  }

  static async deleteDictionaryProgress(dictionaryEntryId: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    await supabase!.from('dictionary_progress').delete().eq('dictionary_entry_id', dictionaryEntryId).eq('user_id', getUserId());
  }

  static async restoreDictionaryProgress(progress: DictionaryProgress): Promise<DictionaryProgress | null> {
    return this.upsertDictionaryProgress(progress);
  }

  static async applyFlashcardFeedback(dictionaryEntryId: string, feedback: 'again' | 'hard' | 'good' | 'easy'): Promise<DictionaryProgress | null> {
    const ratingMap: Record<string, FSRSRating> = { again: 1, hard: 2, good: 3, easy: 4 };
    const rating = ratingMap[feedback];
    const existing = await this.getDictionaryProgress(dictionaryEntryId);
    const update = computeFSRSUpdate(existing, rating);

    const payload = {
      dictionary_entry_id: dictionaryEntryId,
      user_id: getUserId(),
      ...update,
    };

    return this.upsertDictionaryProgress(existing ? { id: existing.id, ...payload } : payload);
  }
}
