import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { DictionaryEntry } from '../types';
import { defaultMockDict } from './mockData';
import { chunkArray, getUserId, isE2EMockMode, normalizeTagsForUpdate } from './utils';

export class DictionaryRepository {
  static async getAll(): Promise<DictionaryEntry[]> {
    if (isE2EMockMode()) return defaultMockDict;
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('dictionary_entries').select('*').eq('user_id', getUserId());
    return data || [];
  }

  static async getById(id: string): Promise<DictionaryEntry | null> {
    if (isE2EMockMode()) return defaultMockDict.find((entry) => entry.id === id) || null;
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('dictionary_entries').select('*').eq('id', id).eq('user_id', getUserId()).maybeSingle();
    return data || null;
  }

  static async getByIds(ids: string[]): Promise<DictionaryEntry[]> {
    if (isE2EMockMode()) return defaultMockDict.filter((entry) => ids.includes(entry.id));
    if (!isSupabaseConfigured || ids.length === 0) return [];
    let allData: DictionaryEntry[] = [];
    for (const chunk of chunkArray(ids, 100)) {
      const { data, error } = await supabase!.from('dictionary_entries').select('*').in('id', chunk).eq('user_id', getUserId());
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar verbetes de dicionario: ${error.message}`);
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
      throw new Error(`Erro do Supabase ao inserir verbetes de dicionario em lote: ${error.message}`);
    }

    const keys = enriched.map(e => e.unique_key as string).filter(Boolean);
    const { data, error: fetchError } = await supabase!
      .from('dictionary_entries')
      .select('*')
      .eq('user_id', getUserId())
      .in('unique_key', keys);

    if (fetchError) {
      console.error(fetchError);
      throw new Error(`Erro do Supabase ao recarregar verbetes de dicionario: ${fetchError.message}`);
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
      throw new Error(`Erro do Supabase ao atualizar verbete de dicionario: ${error.message}`);
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
