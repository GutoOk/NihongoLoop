import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { AuthService } from '../core/authService';
import { Sentence, Source, SentenceTerm, DictionaryEntry, SentenceProgress, DictionaryProgress, AiJob, StudySession, ProcessingRun } from '../types';

function getUserId() {
  return AuthService.getCurrentUserId();
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function normalizeTagsForUpdate(copy: Record<string, unknown>): void {
  if (Array.isArray(copy.tags)) {
    copy.tags = (copy.tags as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  } else {
    delete copy.tags;
  }
}

function computeSrsUpdate(
  existing: Pick<SentenceProgress | DictionaryProgress, 'srs_interval_minutes' | 'srs_ease_factor' | 'mastery' | 'seen_count' | 'correct_count' | 'wrong_count'> | null,
  isCorrect: boolean
) {
  const now = new Date();
  let interval = existing?.srs_interval_minutes ?? 10;
  let easeFactor = existing?.srs_ease_factor ?? 2.5;

  if (existing) {
    if (isCorrect) {
      interval = Math.round(interval * easeFactor);
    } else {
      interval = 1;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
    }
  } else {
    interval = isCorrect ? 10 : 1;
    easeFactor = 2.5;
  }

  const mastery = isCorrect
    ? Math.min(100, (existing?.mastery ?? 0) + 10)
    : Math.max(0, (existing?.mastery ?? 0) - 15);

  return {
    seen_count: (existing?.seen_count ?? 0) + 1,
    correct_count: (existing?.correct_count ?? 0) + (isCorrect ? 1 : 0),
    wrong_count: (existing?.wrong_count ?? 0) + (isCorrect ? 0 : 1),
    last_seen_at: now.toISOString(),
    mastery,
    srs_interval_minutes: interval,
    srs_ease_factor: parseFloat(easeFactor.toFixed(2)),
    due_at: new Date(now.getTime() + interval * 60000).toISOString(),
  };
}

export class ProcessingRunRepository {
  static async createRun(sourceId: string, runMode: "all" | "translate" | "analyze" | "dictionary" = "all"): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('processing_runs').insert({
      user_id: getUserId(),
      source_id: sourceId,
      status: 'pending',
      run_mode: runMode
    }).select().maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao criar processamento: ${error.message}`);
    }
    return data;
  }

  static async getActiveRun(sourceId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('processing_runs')
      .select('*')
      .eq('source_id', sourceId)
      .eq('user_id', getUserId())
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  static async getLatestRunBySource(sourceId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('processing_runs')
      .select('*')
      .eq('source_id', sourceId)
      .eq('user_id', getUserId())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar processamento mais recente: ${error.message}`);
    }
    return data;
  }

  static async getRun(runId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('processing_runs')
      .select('*')
      .eq('id', runId)
      .eq('user_id', getUserId())
      .maybeSingle();
    return data;
  }

  static async updateRun(id: string, patch: Partial<ProcessingRun>): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('processing_runs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', getUserId())
      .select()
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao atualizar processamento: ${error.message}`);
    }
    return data;
  }

  static async appendLog(id: string, message: string, meta?: unknown): Promise<void> {
    if (!isSupabaseConfigured) return;
    const run = await this.getRun(id);
    if (!run) return;
    const entry = { time: new Date().toISOString(), message, ...(meta ? { meta } : {}) };
    const logs = Array.isArray(run.log) ? [...run.log, entry] : [entry];
    await this.updateRun(id, { log: logs });
  }

  static async requestCancel(id: string): Promise<void> {
    await this.updateRun(id, {
      cancel_requested: true,
      status: 'cancelled',
      finished_at: new Date().toISOString()
    });
  }

  static async finishRun(id: string): Promise<void> {
    await this.updateRun(id, { status: 'completed', finished_at: new Date().toISOString() });
  }

  static async failRun(id: string, error: string): Promise<void> {
    await this.updateRun(id, { status: 'error', error, finished_at: new Date().toISOString() });
  }

  static async deleteRunsBySource(sourceId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('processing_runs')
      .delete()
      .eq('source_id', sourceId)
      .eq('user_id', getUserId());
    return !error;
  }
}

export class SourceRepository {
  static async getAll(): Promise<Source[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sources').select('*').eq('user_id', getUserId()).order('created_at', { ascending: false });
    return data || [];
  }

  static async getById(id: string): Promise<Source | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('sources').select('*').eq('id', id).eq('user_id', getUserId()).maybeSingle();
    return data;
  }

  static async add(source: Omit<Source, 'id' | 'created_at' | 'updated_at'>): Promise<Source | null> {
    if (!isSupabaseConfigured) return null;
    const enriched = {
      title: source.title,
      type: source.type,
      original_content: source.original_content,
      user_id: source.user_id || getUserId()
    };
    const { data, error } = await supabase!.from('sources').insert(enriched).select().maybeSingle();
    if (error) {
      console.error('Falha ao criar source:', error);
      throw new Error(`Erro do Supabase ao criar fonte: ${error.message}`);
    }
    return data;
  }

  static async delete(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('sources').delete().eq('id', id).eq('user_id', getUserId());
    return !error;
  }
}

export class SentenceRepository {
  static async getById(id: string): Promise<Sentence | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('sentences').select('*').eq('id', id).eq('user_id', getUserId()).maybeSingle();
    return data || null;
  }

  static async getByIds(ids: string[]): Promise<Sentence[]> {
    if (!isSupabaseConfigured || ids.length === 0) return [];
    let allData: Sentence[] = [];
    for (const chunk of chunkArray(ids, 100)) {
      const { data, error } = await supabase!.from('sentences').select('*').in('id', chunk).eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar frases: ${error.message}`);
      }
      if (data) allData = allData.concat(data);
    }
    return allData;
  }

  static async getBySourceId(sourceId: string): Promise<Sentence[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sentences').select('*').eq('source_id', sourceId).eq('user_id', getUserId()).order('order_index', { ascending: true });
    return data || [];
  }

  static async getByJapanese(japanese: string): Promise<Sentence[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sentences').select('*').eq('japanese', japanese).eq('user_id', getUserId());
    return data || [];
  }

  static async getAll(): Promise<Sentence[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sentences').select('*').eq('user_id', getUserId());
    return data || [];
  }

  static async findProcessedByJapaneseKeys(keys: string[]): Promise<Sentence[]> {
    if (!isSupabaseConfigured || keys.length === 0) return [];
    const { data } = await supabase!.from('sentences')
      .select('*')
      .in('japanese_key', keys)
      .eq('user_id', getUserId())
      .neq('status', 'raw');
    return data || [];
  }

  static async addBatch(sentences: Omit<Sentence, 'id' | 'created_at' | 'updated_at'>[]): Promise<Sentence[]> {
    if (!isSupabaseConfigured) return [];
    const enriched = sentences.map(s => {
      const copy: Record<string, unknown> = { ...s, user_id: s.user_id || getUserId() };
      normalizeTagsForUpdate(copy);
      return copy;
    });
    const { data, error } = await supabase!.from('sentences').insert(enriched).select();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao inserir frases em lote: ${error.message}`);
    }
    return data || [];
  }

  static async update(id: string, updates: Partial<Sentence>): Promise<Sentence | null> {
    if (!isSupabaseConfigured) return null;
    const copy: Record<string, unknown> = { ...updates };
    normalizeTagsForUpdate(copy);
    const { data, error } = await supabase!.from('sentences').update(copy).eq('id', id).eq('user_id', getUserId()).select().maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao atualizar frase: ${error.message}`);
    }
    return data;
  }

  static async delete(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('sentences').delete().eq('id', id).eq('user_id', getUserId());
    return !error;
  }
}

export class TermRepository {
  static async getAll(): Promise<SentenceTerm[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data } = await supabase!.from('sentence_terms').select('*').eq('user_id', getUserId());
      return data || [];
    } catch {
      return [];
    }
  }

  static async getBySentence(sentenceId: string): Promise<SentenceTerm[]> {
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
          .eq('user_id', AuthService.getCurrentUserId());
      }
    }
  }
}

export class DictionaryRepository {
  static async getAll(): Promise<DictionaryEntry[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('dictionary_entries').select('*').eq('user_id', getUserId());
    return data || [];
  }

  static async getById(id: string): Promise<DictionaryEntry | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('dictionary_entries').select('*').eq('id', id).eq('user_id', getUserId()).maybeSingle();
    return data || null;
  }

  static async getByIds(ids: string[]): Promise<DictionaryEntry[]> {
    if (!isSupabaseConfigured || ids.length === 0) return [];
    let allData: DictionaryEntry[] = [];
    for (const chunk of chunkArray(ids, 100)) {
      const { data, error } = await supabase!.from('dictionary_entries').select('*').in('id', chunk).eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar verbetes de dicionário: ${error.message}`);
      }
      if (data) allData = allData.concat(data);
    }
    return allData;
  }

  static async getByUniqueKey(uniqueKey: string): Promise<DictionaryEntry | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('dictionary_entries').select('*').eq('unique_key', uniqueKey).eq('user_id', getUserId()).maybeSingle();
    return data || null;
  }

  static async getByLemma(lemma: string): Promise<DictionaryEntry[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('dictionary_entries').select('*').eq('lemma', lemma).eq('user_id', getUserId());
    return data || [];
  }

  static async addBatch(entries: Omit<DictionaryEntry, 'id' | 'created_at' | 'updated_at'>[]): Promise<DictionaryEntry[]> {
    if (!isSupabaseConfigured) return [];

    const uniqueByKey = new Map<string, Record<string, unknown>>();
    for (const entry of entries) {
      const copy: Record<string, unknown> = { ...entry, user_id: entry.user_id || getUserId() };
      if (!copy.unique_key) {
        copy.unique_key = `${copy.lemma || ''}|${copy.kana || ''}|${copy.type || 'outro'}`;
      }
      normalizeTagsForUpdate(copy);
      uniqueByKey.set(`${copy.user_id}:${copy.unique_key}`, copy);
    }

    const enriched = Array.from(uniqueByKey.values());
    if (enriched.length === 0) return [];

    const { error } = await supabase!
      .from('dictionary_entries')
      .upsert(enriched, { onConflict: 'user_id,unique_key', ignoreDuplicates: true });

    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao inserir verbetes de dicionário em lote: ${error.message}`);
    }

    const keys = enriched.map(e => e.unique_key as string).filter(Boolean);
    const { data, error: fetchError } = await supabase!
      .from('dictionary_entries')
      .select('*')
      .eq('user_id', getUserId())
      .in('unique_key', keys);

    if (fetchError) {
      console.error(fetchError);
      throw new Error(`Erro do Supabase ao recarregar verbetes de dicionário: ${fetchError.message}`);
    }

    return data || [];
  }

  static async update(id: string, updates: Partial<DictionaryEntry>): Promise<DictionaryEntry | null> {
    if (!isSupabaseConfigured) return null;
    const copy: Record<string, unknown> = { ...updates };
    normalizeTagsForUpdate(copy);
    const { data, error } = await supabase!.from('dictionary_entries').update(copy).eq('id', id).eq('user_id', getUserId()).select().maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao atualizar verbete de dicionário: ${error.message}`);
    }
    return data || null;
  }

  static async deleteAll(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    await supabase!.from('sentence_terms').delete().eq('user_id', getUserId());
    const { error } = await supabase!.from('dictionary_entries').delete().eq('user_id', getUserId());
    return !error;
  }
}

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

export class AiJobRepository {
  static async getAll(): Promise<AiJob[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('ai_jobs').select('*').eq('user_id', getUserId()).order('created_at', { ascending: false });
    return data || [];
  }

  static async add(job: Omit<AiJob, 'id' | 'created_at' | 'completed_at'>): Promise<AiJob | null> {
    if (!isSupabaseConfigured) return null;
    const enriched = { ...job, user_id: job.user_id || getUserId(), updated_at: new Date().toISOString() };
    const { data, error } = await supabase!.from('ai_jobs').insert(enriched).select().maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao criar ai_job: ${error.message}`);
    }
    return data;
  }

  static async updateStatus(id: string, updates: Partial<AiJob>): Promise<AiJob | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('ai_jobs').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', getUserId()).select().maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao atualizar status ai_job: ${error.message}`);
    }
    return data;
  }

  static async claimJob(id: string, runnerId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + 5 * 60000).toISOString();
    const { data, error } = await supabase!
      .from('ai_jobs')
      .update({
        status: 'running',
        locked_by: runnerId,
        locked_until: lockedUntil,
        last_heartbeat_at: now.toISOString(),
        updated_at: now.toISOString()
      })
      .eq('id', id)
      .eq('user_id', getUserId())
      .or(`locked_by.eq.${runnerId},locked_by.is.null,locked_until.lt.${now.toISOString()}`)
      .select();
    if (error) {
      console.error("Error claiming job:", error);
      return false;
    }
    return data !== null && data.length > 0;
  }

  static async heartbeat(id: string, runnerId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + 5 * 60000).toISOString();
    const { data, error } = await supabase!
      .from('ai_jobs')
      .update({ last_heartbeat_at: now.toISOString(), locked_until: lockedUntil, updated_at: now.toISOString() })
      .eq('id', id)
      .eq('user_id', getUserId())
      .eq('locked_by', runnerId)
      .select();
    return !error && data !== null && data.length > 0;
  }

  static async getPendingByTarget(type: string, targetType: string, targetId: string): Promise<AiJob | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('ai_jobs').select('*')
      .eq('user_id', getUserId())
      .eq('type', type)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .in('status', ['pending', 'running'])
      .maybeSingle();
    return data;
  }

  static async resetFailedJobs(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .update({ status: 'pending', error: null, result: null })
      .eq('user_id', getUserId())
      .in('status', ['error', 'running']);
    return !error;
  }

  static async resetRunningJobsByTarget(targetId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .update({ status: 'pending', error: null, updated_at: new Date().toISOString() })
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .eq('status', 'running');
    return !error;
  }

  static async resetFailedJobsByTarget(targetId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .update({ status: 'pending', error: null, updated_at: new Date().toISOString() })
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .eq('status', 'error');
    return !error;
  }

  static async cancelJobsByTarget(targetId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .update({ status: 'cancelled' })
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .in('status', ['pending', 'running']);
    return !error;
  }

  static async deleteJobsByTarget(targetId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .delete()
      .eq('user_id', getUserId())
      .eq('target_id', targetId);
    return !error;
  }

  static async delete(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .delete()
      .eq('id', id)
      .eq('user_id', getUserId());
    return !error;
  }

  static async deleteAll(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs').delete().eq('user_id', getUserId());
    return !error;
  }
}

export class StudySessionRepository {
  static async saveSession(session: Omit<StudySession, 'id' | 'created_at' | 'updated_at'>): Promise<StudySession | null> {
    if (!isSupabaseConfigured) return null;
    const enriched = { ...session, user_id: session.user_id || getUserId() };
    const { data, error } = await supabase!.from('study_sessions').insert(enriched).select().maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao salvar sessão de estudo: ${error.message}`);
    }
    return data;
  }

  static async getSourceOffset(sourceId: string): Promise<number> {
    if (!isSupabaseConfigured) return 0;
    try {
      const { data, error } = await supabase!
        .from('study_sessions')
        .select('config')
        .eq('source_id', sourceId)
        .eq('type', 'source_offset')
        .eq('user_id', getUserId())
        .maybeSingle();
      if (error || !data) return 0;
      return (data.config as { offset?: number })?.offset ?? 0;
    } catch {
      return 0;
    }
  }

  static async saveSourceOffset(sourceId: string, offset: number): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    try {
      const userId = getUserId();
      const { data: existing } = await supabase!
        .from('study_sessions')
        .select('id')
        .eq('source_id', sourceId)
        .eq('type', 'source_offset')
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase!
          .from('study_sessions')
          .update({ config: { offset }, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .eq('user_id', userId);
        return !error;
      } else {
        const { error } = await supabase!
          .from('study_sessions')
          .insert({ user_id: userId, type: 'source_offset', source_id: sourceId, config: { offset } });
        return !error;
      }
    } catch {
      return false;
    }
  }
}
