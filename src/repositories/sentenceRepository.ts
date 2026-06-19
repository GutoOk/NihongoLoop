import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { Sentence } from '../types';
import { defaultMockSentences } from './mockData';
import { chunkArray, getUserId, isE2EMockMode, normalizeTagsForUpdate } from './utils';

const SENTENCE_SELECT = 'id,source_id,user_id,order_index,start_time,end_time,japanese,japanese_key,portuguese,kana,romaji,status,tags,prepared_at,translation_source,reading_source,terms_source,created_at,updated_at';

export class SentenceRepository {
  static async getById(id: string): Promise<Sentence | null> {
    if (isE2EMockMode()) return defaultMockSentences.find((s) => s.id === id) || null;
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('sentences').select(SENTENCE_SELECT).eq('id', id).eq('user_id', getUserId()).maybeSingle();
    return data || null;
  }

  static async getByIds(ids: string[]): Promise<Sentence[]> {
    if (isE2EMockMode()) return defaultMockSentences.filter((s) => ids.includes(s.id));
    if (!isSupabaseConfigured || ids.length === 0) return [];
    let allData: Sentence[] = [];
    for (const chunk of chunkArray(ids, 100)) {
      const { data, error } = await supabase!.from('sentences').select(SENTENCE_SELECT).in('id', chunk).eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar frases: ${error.message}`);
      }
      if (data) allData = allData.concat(data);
    }
    return allData;
  }

  static async getBySourceId(sourceId: string): Promise<Sentence[]> {
    if (isE2EMockMode()) return defaultMockSentences.filter((s) => s.source_id === sourceId);
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sentences').select(SENTENCE_SELECT).eq('source_id', sourceId).eq('user_id', getUserId()).order('order_index', { ascending: true });
    return data || [];
  }

  static async getPageBySourceId(sourceId: string, offset = 0, limit = 50): Promise<Sentence[]> {
    if (isE2EMockMode()) return defaultMockSentences.filter((s) => s.source_id === sourceId).slice(offset, offset + limit);
    if (!isSupabaseConfigured) return [];
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const { data, error } = await supabase!
      .from('sentences')
      .select(SENTENCE_SELECT)
      .eq('source_id', sourceId)
      .eq('user_id', getUserId())
      .order('order_index', { ascending: true })
      .range(offset, offset + safeLimit - 1);
    if (error) throw new Error(`Erro do Supabase ao carregar pagina de frases: ${error.message}`);
    return data || [];
  }

  static async countBySourceId(sourceId: string): Promise<number> {
    if (isE2EMockMode()) return defaultMockSentences.filter((s) => s.source_id === sourceId).length;
    if (!isSupabaseConfigured) return 0;
    const { count, error } = await supabase!
      .from('sentences')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', sourceId)
      .eq('user_id', getUserId());
    if (error) throw new Error(`Erro do Supabase ao contar frases da fonte: ${error.message}`);
    return count || 0;
  }

  static async getByJapanese(japanese: string): Promise<Sentence[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sentences').select(SENTENCE_SELECT).eq('japanese', japanese).eq('user_id', getUserId());
    return data || [];
  }

  static async getAll(): Promise<Sentence[]> {
    if (isE2EMockMode()) return defaultMockSentences;
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sentences').select(SENTENCE_SELECT).eq('user_id', getUserId());
    return data || [];
  }

  static async findProcessedByJapaneseKeys(keys: string[]): Promise<Sentence[]> {
    if (!isSupabaseConfigured || keys.length === 0) return [];
    const { data } = await supabase!.from('sentences')
      .select(SENTENCE_SELECT)
      .in('japanese_key', keys)
      .eq('user_id', getUserId())
      .neq('status', 'raw');
    return data || [];
  }

  static async addBatch(sentences: Omit<Sentence, 'id' | 'created_at' | 'updated_at'>[]): Promise<Sentence[]> {
    if (!isSupabaseConfigured) return [];
    const enriched = sentences.map(s => {
      const copy: Record<string, unknown> = { ...s, user_id: s.user_id || getUserId() };
      delete copy.favorite;
      delete copy.difficulty;
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
    delete copy.favorite;
    delete copy.difficulty;
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
