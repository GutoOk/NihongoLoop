import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { DictionaryEntry, DictionaryForm, DictionarySense } from '../types';
import { defaultMockDict } from './mockData';
import { chunkArray, getUserId, isE2EMockMode, normalizeTagsForUpdate } from './utils';

export function normalizeDictionaryKey(value: string | null | undefined): string {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

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
      delete copy.meanings;
      delete copy.common_forms;
      if (!copy.unique_key) {
        copy.unique_key = this.makeEntryKey(String(copy.lemma || ''), String(copy.kana || ''), String(copy.type || 'outro'));
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
    delete copy.meanings;
    delete copy.common_forms;
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
    await supabase!.from('dictionary_senses').delete().eq('user_id', getUserId());
    await supabase!.from('dictionary_forms').delete().eq('user_id', getUserId());
    const { error } = await supabase!.from('dictionary_entries').delete().eq('user_id', getUserId());
    return !error;
  }

  static makeEntryKey(lemma: string, kana?: string | null, type?: string | null): string {
    return `${normalizeDictionaryKey(lemma)}|${normalizeDictionaryKey(kana)}|${normalizeDictionaryKey(type || 'outro')}`;
  }

  static async getMainMeaning(entryId: string): Promise<string | null> {
    const senses = await DictionarySenseRepository.getByEntryId(entryId);
    return senses[0]?.meaning || (await this.getById(entryId))?.main_meaning || null;
  }
}

export class DictionaryFormRepository {
  static makeFormKey(entryId: string, form: string, formType?: string | null): string {
    return `${entryId}|${normalizeDictionaryKey(form)}|${normalizeDictionaryKey(formType || 'default')}`;
  }

  static async getById(id: string): Promise<DictionaryForm | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('dictionary_forms').select('*').eq('id', id).eq('user_id', getUserId()).maybeSingle();
    return data || null;
  }

  static async getByIds(ids: string[]): Promise<DictionaryForm[]> {
    if (!isSupabaseConfigured || ids.length === 0) return [];
    let allData: DictionaryForm[] = [];
    for (const chunk of chunkArray(ids, 100)) {
      const { data, error } = await supabase!.from('dictionary_forms').select('*').in('id', chunk).eq('user_id', getUserId());
      if (error) throw new Error(`Erro do Supabase ao carregar formas: ${error.message}`);
      if (data) allData = allData.concat(data);
    }
    return allData;
  }

  static async getByEntryId(entryId: string): Promise<DictionaryForm[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('dictionary_forms').select('*').eq('dictionary_entry_id', entryId).eq('user_id', getUserId()).order('is_common', { ascending: false });
    return data || [];
  }

  static async getByUniqueKey(uniqueKey: string): Promise<DictionaryForm | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('dictionary_forms').select('*').eq('unique_key', uniqueKey).eq('user_id', getUserId()).maybeSingle();
    return data || null;
  }

  static async upsertBatch(forms: Array<Partial<DictionaryForm> & Pick<DictionaryForm, 'dictionary_entry_id' | 'form'>>): Promise<DictionaryForm[]> {
    if (!isSupabaseConfigured || forms.length === 0) return [];
    const enriched = forms.map((form) => ({
      ...form,
      user_id: form.user_id || getUserId(),
      unique_key: form.unique_key || this.makeFormKey(form.dictionary_entry_id, form.form, form.form_type),
      status: form.status || 'detected',
      is_common: form.is_common ?? false,
    }));
    const { error } = await supabase!.from('dictionary_forms').upsert(enriched, { onConflict: 'user_id,unique_key', ignoreDuplicates: false });
    if (error) throw new Error(`Erro do Supabase ao salvar formas: ${error.message}`);
    const keys = enriched.map((f) => f.unique_key);
    const { data, error: fetchError } = await supabase!.from('dictionary_forms').select('*').eq('user_id', getUserId()).in('unique_key', keys);
    if (fetchError) throw new Error(`Erro do Supabase ao recarregar formas: ${fetchError.message}`);
    return data || [];
  }

  static async resolveOrCreate(input: {
    dictionary_entry_id: string;
    form: string;
    kana?: string | null;
    romaji?: string | null;
    form_type?: string | null;
    grammar_note?: string | null;
    is_common?: boolean;
  }): Promise<DictionaryForm | null> {
    const [form] = await this.upsertBatch([{ ...input, status: 'detected' } as any]);
    return form || null;
  }
}

export class DictionarySenseRepository {
  static async getById(id: string): Promise<DictionarySense | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('dictionary_senses').select('*').eq('id', id).eq('user_id', getUserId()).maybeSingle();
    return data || null;
  }

  static async getByEntryId(entryId: string): Promise<DictionarySense[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('dictionary_senses').select('*').eq('dictionary_entry_id', entryId).eq('user_id', getUserId()).order('sense_order', { ascending: true });
    return data || [];
  }

  static async upsertBatch(senses: Array<Partial<DictionarySense> & Pick<DictionarySense, 'dictionary_entry_id' | 'meaning'>>): Promise<DictionarySense[]> {
    if (!isSupabaseConfigured || senses.length === 0) return [];
    const enriched = senses.map((sense, index) => ({
      ...sense,
      user_id: sense.user_id || getUserId(),
      meaning_type: sense.meaning_type || (index === 0 ? 'principal' : 'variação'),
      sense_order: sense.sense_order ?? index + 1,
      status: sense.status || 'ai_generated',
    }));
    const { error } = await supabase!.from('dictionary_senses').upsert(enriched, { onConflict: 'user_id,dictionary_entry_id,meaning', ignoreDuplicates: false });
    if (error) throw new Error(`Erro do Supabase ao salvar sentidos: ${error.message}`);
    const entryIds = Array.from(new Set(enriched.map((s) => s.dictionary_entry_id)));
    let data: DictionarySense[] = [];
    for (const entryId of entryIds) {
      data = data.concat(await this.getByEntryId(entryId));
    }
    return data;
  }

  static async resolveOrCreate(input: {
    dictionary_entry_id: string;
    meaning: string;
    meaning_type?: string | null;
    explanation?: string | null;
  }): Promise<DictionarySense | null> {
    const senses = await this.upsertBatch([input as any]);
    return senses.find((sense) => sense.dictionary_entry_id === input.dictionary_entry_id && sense.meaning === input.meaning) || senses[0] || null;
  }
}
