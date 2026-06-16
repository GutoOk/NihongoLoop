import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { DictionaryProgress, SentenceProgress } from '../types';
import { chunkArray, computeSrsUpdate, getUserId } from './utils';

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

  static async getAllSentenceProgress(): Promise<SentenceProgress[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data } = await supabase!.from('sentence_progress').select('*').eq('user_id', getUserId());
      return data || [];
    } catch {
      return [];
    }
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

  static async applyFlashcardFeedback(dictionaryEntryId: string, feedback: 'again' | 'hard' | 'good' | 'easy'): Promise<DictionaryProgress | null> {
    const existing = await this.getDictionaryProgress(dictionaryEntryId);
    let interval = existing?.srs_interval_minutes ?? 0;
    let easeFactor = existing?.srs_ease_factor ?? 2.5;
    let seenCount = (existing?.seen_count ?? 0) + 1;
    let correctCount = existing?.correct_count ?? 0;
    let wrongCount = existing?.wrong_count ?? 0;

    if (feedback === 'again') {
      interval = 1;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      wrongCount++;
    } else {
      correctCount++;
      if (interval <= 0) {
        interval = 10;
      } else if (interval === 10) {
        interval = 60 * 24;
      } else {
        let easeMultiplier = 1.0;
        if (feedback === 'hard') {
          easeFactor = Math.max(1.3, easeFactor - 0.15);
          easeMultiplier = 1.2;
        } else if (feedback === 'good') {
          easeMultiplier = easeFactor;
        } else {
          easeFactor = easeFactor + 0.15;
          easeMultiplier = easeFactor * 1.3;
        }
        interval = Math.round(interval * easeMultiplier);
      }
    }

    let mastery = existing?.mastery ?? 0;
    if (feedback === 'again') mastery = Math.max(0, mastery - 15);
    else if (feedback === 'hard') mastery = Math.min(100, mastery + 5);
    else if (feedback === 'good') mastery = Math.min(100, mastery + 12);
    else mastery = Math.min(100, mastery + 20);

    const now = new Date();
    const payload = {
      dictionary_entry_id: dictionaryEntryId,
      user_id: getUserId(),
      seen_count: seenCount,
      correct_count: correctCount,
      wrong_count: wrongCount,
      last_seen_at: now.toISOString(),
      mastery,
      srs_interval_minutes: interval,
      srs_ease_factor: parseFloat(easeFactor.toFixed(2)),
      due_at: new Date(now.getTime() + interval * 60000).toISOString()
    };

    return this.upsertDictionaryProgress(existing ? { id: existing.id, ...payload } : payload);
  }
}
