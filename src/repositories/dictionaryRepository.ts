import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { DictionaryEntry, DictionaryForm, DictionarySense } from '../types';
import { defaultMockDict } from './mockData';
import { TermRepository } from './termRepository';
import { chunkArray, getUserId, isE2EMockMode, normalizeTagsForUpdate } from './utils';

export function normalizeDictionaryKey(value: string | null | undefined): string {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function maxIsoDate(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return null;
  return valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

function minIsoDate(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return null;
  return valid.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
}

export class DictionaryRepository {
  static async getAll(): Promise<DictionaryEntry[]> {
    if (isE2EMockMode()) return defaultMockDict;
    if (!isSupabaseConfigured) return [];
    
    let allData: DictionaryEntry[] = [];
    let hasMore = true;
    let offset = 0;
    const limit = 1000;
    
    while (hasMore) {
      const { data, error } = await supabase!
        .from('dictionary_entries')
        .select('*')
        .eq('user_id', getUserId())
        .order('id')
        .range(offset, offset + limit - 1);
        
      if (error) {
        console.error(error);
        throw new Error(`Erro do Supabase ao carregar dicionário completo: ${error.message}`);
      }
      
      const chunk = data || [];
      allData = allData.concat(chunk);
      offset += limit;
      if (chunk.length < limit) {
        hasMore = false;
      }
    }
    
    // Garantir que as chaves de IDs no React sejam absolutamente únicas e estáveis
    const seenIds = new Set<string>();
    const uniqueData = allData.filter((entry) => {
      if (!entry || !entry.id) return false;
      if (seenIds.has(entry.id)) {
        return false;
      }
      seenIds.add(entry.id);
      return true;
    });
    
    return uniqueData;
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

  static async updateStatus(id: string, status: DictionaryEntry['status']): Promise<DictionaryEntry | null> {
    return this.update(id, { status });
  }

  static async delete(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!
      .from('dictionary_entries')
      .delete()
      .eq('id', id)
      .eq('user_id', getUserId());
    return !error;
  }

  static async mergeDuplicateIntoPrimary(params: {
    duplicateId: string;
    primaryId: string;
    preferredUpdates?: Partial<DictionaryEntry>;
  }): Promise<DictionaryEntry | null> {
    const { duplicateId, primaryId, preferredUpdates = {} } = params;
    if (duplicateId === primaryId) return this.update(primaryId, preferredUpdates);
    if (!isSupabaseConfigured) return null;

    const [duplicate, primary] = await Promise.all([
      this.getById(duplicateId),
      this.getById(primaryId),
    ]);
    if (!duplicate || !primary) return primary || null;

    const merged: Partial<DictionaryEntry> = {
      main_meaning: primary.main_meaning || preferredUpdates.main_meaning || duplicate.main_meaning || null,
      kana: primary.kana || preferredUpdates.kana || duplicate.kana || null,
      romaji: primary.romaji || preferredUpdates.romaji || duplicate.romaji || null,
      type: primary.type || preferredUpdates.type || duplicate.type || 'outro',
      jlpt_level: primary.jlpt_level || preferredUpdates.jlpt_level || duplicate.jlpt_level || null,
      tags: primary.tags?.length ? primary.tags : preferredUpdates.tags || duplicate.tags || [],
      subtype: primary.subtype || preferredUpdates.subtype || duplicate.subtype || null,
      components: primary.components || preferredUpdates.components || duplicate.components || null,
      grammar_info: primary.grammar_info || preferredUpdates.grammar_info || duplicate.grammar_info || null,
      short_note: primary.short_note || preferredUpdates.short_note || duplicate.short_note || null,
      status: primary.status === 'reviewed' ? 'reviewed' : preferredUpdates.status || primary.status || 'ai_enriched',
    };

    await this.update(primaryId, merged);
    await DictionaryFormRepository.moveFormsToEntry(duplicateId, primaryId);
    await DictionarySenseRepository.moveSensesToEntry(duplicateId, primaryId);
    await this.mergeDictionaryProgress(duplicateId, primaryId);
    await this.delete(duplicateId);
    return this.getById(primaryId);
  }

  private static async mergeDictionaryProgress(duplicateId: string, primaryId: string): Promise<void> {
    if (!isSupabaseConfigured || duplicateId === primaryId) return;
    const userId = getUserId();
    const { data, error } = await supabase!
      .from('dictionary_progress')
      .select('*')
      .in('dictionary_entry_id', [duplicateId, primaryId])
      .eq('user_id', userId);
    if (error) throw new Error(`Erro do Supabase ao carregar progresso de dicionario: ${error.message}`);

    const rows = data || [];
    const duplicateProgress = rows.find((row: any) => row.dictionary_entry_id === duplicateId);
    if (!duplicateProgress) return;
    const primaryProgress = rows.find((row: any) => row.dictionary_entry_id === primaryId);
    if (!primaryProgress) {
      const { error: moveError } = await supabase!
        .from('dictionary_progress')
        .update({ dictionary_entry_id: primaryId })
        .eq('id', duplicateProgress.id)
        .eq('user_id', userId);
      if (moveError) throw new Error(`Erro do Supabase ao mover progresso de dicionario: ${moveError.message}`);
      return;
    }

    const mergedProgress = {
      seen_count: Math.max(primaryProgress.seen_count || 0, duplicateProgress.seen_count || 0),
      correct_count: Math.max(primaryProgress.correct_count || 0, duplicateProgress.correct_count || 0),
      wrong_count: Math.max(primaryProgress.wrong_count || 0, duplicateProgress.wrong_count || 0),
      mastery: Math.max(primaryProgress.mastery || 0, duplicateProgress.mastery || 0),
      favorite: Boolean(primaryProgress.favorite || duplicateProgress.favorite),
      suspended: Boolean(primaryProgress.suspended || duplicateProgress.suspended),
      difficulty: primaryProgress.difficulty ?? duplicateProgress.difficulty ?? null,
      last_seen_at: maxIsoDate(primaryProgress.last_seen_at, duplicateProgress.last_seen_at),
      due_at: minIsoDate(primaryProgress.due_at, duplicateProgress.due_at),
      srs_interval_minutes: Math.max(primaryProgress.srs_interval_minutes || 0, duplicateProgress.srs_interval_minutes || 0),
      srs_ease_factor: Math.max(primaryProgress.srs_ease_factor || 0, duplicateProgress.srs_ease_factor || 0),
    };

    const { error: updateError } = await supabase!
      .from('dictionary_progress')
      .update(mergedProgress)
      .eq('id', primaryProgress.id)
      .eq('user_id', userId);
    if (updateError) throw new Error(`Erro do Supabase ao mesclar progresso de dicionario: ${updateError.message}`);

    const { error: deleteError } = await supabase!
      .from('dictionary_progress')
      .delete()
      .eq('id', duplicateProgress.id)
      .eq('user_id', userId);
    if (deleteError) throw new Error(`Erro do Supabase ao apagar progresso duplicado: ${deleteError.message}`);
  }

  static async deleteAll(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const userId = getUserId();
    const { error: termsError } = await supabase!.from('sentence_terms').delete().eq('user_id', userId);
    const { error: resetError } = await supabase!
      .from('sentences')
      .update({ terms_source: null })
      .eq('user_id', userId)
      .in('terms_source', ['ai', 'cache', 'ai_empty']);
    const { error: sensesError } = await supabase!.from('dictionary_senses').delete().eq('user_id', userId);
    const { error: formsError } = await supabase!.from('dictionary_forms').delete().eq('user_id', userId);
    const { error: entriesError } = await supabase!.from('dictionary_entries').delete().eq('user_id', userId);
    return !termsError && !resetError && !sensesError && !formsError && !entriesError;
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

  static async update(id: string, updates: Partial<DictionaryForm>): Promise<DictionaryForm | null> {
    if (!isSupabaseConfigured) return null;
    const copy: Record<string, unknown> = { ...updates };
    const { data, error } = await supabase!
      .from('dictionary_forms')
      .update(copy)
      .eq('id', id)
      .eq('user_id', getUserId())
      .select()
      .maybeSingle();
    if (error) throw new Error(`Erro do Supabase ao atualizar forma de dicionario: ${error.message}`);
    return data || null;
  }

  static async delete(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('dictionary_forms').delete().eq('id', id).eq('user_id', getUserId());
    if (error) throw new Error(`Erro do Supabase ao apagar forma de dicionario: ${error.message}`);
    return true;
  }

  static async moveFormsToEntry(fromEntryId: string, toEntryId: string): Promise<void> {
    if (!isSupabaseConfigured || fromEntryId === toEntryId) return;
    const forms = await this.getByEntryId(fromEntryId);
    for (const form of forms) {
      const nextKey = this.makeFormKey(toEntryId, form.form, form.form_type);
      const existing = await this.getByUniqueKey(nextKey);
      if (existing && existing.id !== form.id) {
        await TermRepository.replaceDictionaryForm(form.id, existing.id);
        await this.delete(form.id);
      } else {
        await this.update(form.id, {
          dictionary_entry_id: toEntryId,
          unique_key: nextKey,
        });
      }
    }
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

  static async deleteByEntryId(entryId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!
      .from('dictionary_senses')
      .delete()
      .eq('dictionary_entry_id', entryId)
      .eq('user_id', getUserId());
    if (error) throw new Error(`Erro do Supabase ao apagar sentidos: ${error.message}`);
    return true;
  }

  static async moveSensesToEntry(fromEntryId: string, toEntryId: string): Promise<void> {
    if (!isSupabaseConfigured || fromEntryId === toEntryId) return;
    const senses = await this.getByEntryId(fromEntryId);
    await this.upsertBatch(
      senses.map((sense) => ({
        dictionary_entry_id: toEntryId,
        meaning: sense.meaning,
        meaning_type: sense.meaning_type,
        explanation: sense.explanation,
        sense_order: sense.sense_order,
        status: sense.status,
      })),
    );
    await this.deleteByEntryId(fromEntryId);
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
