import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { SentenceTerm, SentenceTermWithDictionary } from '../types';
import { defaultMockTerms } from './mockData';
import { chunkArray, getUserId, isE2EMockMode } from './utils';

export class TermRepository {
  private static richSelect = `
    id,user_id,sentence_id,dictionary_form_id,dictionary_sense_id,surface,start_index,end_index,confidence,status,created_at,updated_at,
    form:dictionary_forms(
      id,user_id,dictionary_entry_id,form,kana,romaji,form_type,grammar_note,is_common,status,unique_key,created_at,updated_at,
      entry:dictionary_entries(id,user_id,lemma,kana,romaji,type,jlpt_level,status,tags,unique_key,main_meaning,created_at,updated_at,subtype,components,grammar_info,short_note)
    ),
    sense:dictionary_senses(id,user_id,dictionary_entry_id,meaning,meaning_type,explanation,example_japanese,example_portuguese,sense_order,status,created_at,updated_at)
  `;

  static async getAll(): Promise<SentenceTerm[]> {
    if (isE2EMockMode()) return defaultMockTerms;
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!
      .from('sentence_terms')
      .select('id,user_id,sentence_id,dictionary_form_id,dictionary_sense_id,surface,start_index,end_index,confidence,status,created_at,updated_at')
      .eq('user_id', getUserId())
      .limit(1000);
    return data || [];
  }

  static async getAllWithDictionary(): Promise<SentenceTermWithDictionary[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sentence_terms').select(this.richSelect).eq('user_id', getUserId());
    return normalizeRichTerms(data || []);
  }

  static async getBySentence(sentenceId: string): Promise<SentenceTerm[]> {
    if (isE2EMockMode()) return defaultMockTerms.filter((t) => t.sentence_id === sentenceId);
    if (!isSupabaseConfigured) return [];
    return this.getBySentenceWithDictionary(sentenceId) as Promise<SentenceTerm[]>;
  }

  static async getBySentenceWithDictionary(sentenceId: string): Promise<SentenceTermWithDictionary[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase!
      .from('sentence_terms')
      .select(this.richSelect)
      .eq('sentence_id', sentenceId)
      .eq('user_id', getUserId())
      .order('start_index');
    if (error) throw new Error(`Erro do Supabase ao carregar termos da frase: ${error.message}`);
    return normalizeRichTerms(data || []);
  }

  static async getBySentences(sentenceIds: string[]): Promise<SentenceTerm[]> {
    if (isE2EMockMode()) return defaultMockTerms.filter((t) => sentenceIds.includes(t.sentence_id));
    if (!isSupabaseConfigured || sentenceIds.length === 0) return [];
    return this.getBySentencesWithDictionary(sentenceIds) as Promise<SentenceTerm[]>;
  }

  static async getBySentencesWithDictionary(sentenceIds: string[]): Promise<SentenceTermWithDictionary[]> {
    if (!isSupabaseConfigured || sentenceIds.length === 0) return [];
    let allTermsData: SentenceTermWithDictionary[] = [];
    for (const chunk of chunkArray(sentenceIds, 100)) {
      const { data, error } = await supabase!.from('sentence_terms').select(this.richSelect).in('sentence_id', chunk).eq('user_id', getUserId());
      if (error) throw new Error(`Erro do Supabase ao carregar termos de frases: ${error.message}`);
      if (data) allTermsData = allTermsData.concat(normalizeRichTerms(data));
    }
    return allTermsData;
  }

  static async getByDictionaryEntry(entryId: string): Promise<SentenceTermWithDictionary[]> {
    if (isE2EMockMode()) return normalizeRichTerms(defaultMockTerms.filter((t) => t.dictionary_entry_id === entryId));
    if (!isSupabaseConfigured) return [];
    const { data: forms, error: formsError } = await supabase!
      .from('dictionary_forms')
      .select('id')
      .eq('dictionary_entry_id', entryId)
      .eq('user_id', getUserId());
    if (formsError) throw new Error(`Erro do Supabase ao carregar formas do verbete: ${formsError.message}`);
    const formIds = (forms || []).map((form: { id: string }) => form.id);
    if (formIds.length === 0) return [];
    let terms: SentenceTermWithDictionary[] = [];
    for (const chunk of chunkArray(formIds, 100)) {
      const { data, error } = await supabase!.from('sentence_terms').select(this.richSelect).in('dictionary_form_id', chunk).eq('user_id', getUserId());
      if (error) throw new Error(`Erro do Supabase ao carregar ocorrências do verbete: ${error.message}`);
      if (data) terms = terms.concat(normalizeRichTerms(data));
    }
    return terms;
  }

  static async addBatch(terms: Array<Omit<SentenceTerm, 'id' | 'created_at' | 'updated_at'>>): Promise<SentenceTerm[]> {
    if (!isSupabaseConfigured) return [];

    const uniqueTermsMap = new Map<string, Record<string, unknown>>();
    for (const t of terms) {
      delete (t as any).dictionary_entry_id;
      delete (t as any).lemma;
      delete (t as any).kana;
      delete (t as any).romaji;
      delete (t as any).type;
      delete (t as any).context_meaning;
      delete (t as any).grammar_note;
      delete (t as any).structure_note;
      if (!t.dictionary_form_id) continue;
      const input = { ...t, user_id: t.user_id || getUserId() };
      const key = `${input.sentence_id}_${input.start_index}_${input.end_index}_${input.dictionary_form_id}`;
      uniqueTermsMap.set(key, input as Record<string, unknown>);
    }
    const enriched = Array.from(uniqueTermsMap.values());
    if (enriched.length === 0) return [];

    const { data, error } = await supabase!
      .from('sentence_terms')
      .upsert(enriched, { onConflict: 'sentence_id,start_index,end_index,dictionary_form_id', ignoreDuplicates: false })
      .select();
    if (error) throw new Error(`Erro do Supabase ao inserir termos em lote: ${error.message}`);
    return data || [];
  }

  static async update(id: string, updates: Partial<SentenceTerm>): Promise<SentenceTerm | null> {
    if (!isSupabaseConfigured) return null;
    const cleanUpdates = { ...updates } as any;
    delete cleanUpdates.dictionary_entry_id;
    delete cleanUpdates.lemma;
    delete cleanUpdates.kana;
    delete cleanUpdates.romaji;
    delete cleanUpdates.type;
    delete cleanUpdates.context_meaning;
    delete cleanUpdates.grammar_note;
    delete cleanUpdates.structure_note;
    const { data, error } = await supabase!.from('sentence_terms').update(cleanUpdates).eq('id', id).eq('user_id', getUserId()).select().maybeSingle();
    if (error) throw new Error(`Erro do Supabase ao atualizar termo: ${error.message}`);
    return data || null;
  }

  static async replaceDictionaryForm(oldFormId: string, newFormId: string): Promise<boolean> {
    if (!isSupabaseConfigured || oldFormId === newFormId) return true;
    const { error } = await supabase!
      .from('sentence_terms')
      .update({ dictionary_form_id: newFormId })
      .eq('dictionary_form_id', oldFormId)
      .eq('user_id', getUserId());
    if (error) throw new Error(`Erro do Supabase ao religar termos de dicionario: ${error.message}`);
    return true;
  }

  static async delete(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('sentence_terms').delete().eq('id', id).eq('user_id', getUserId());
    return !error;
  }

  static async deleteBySentenceIds(sentenceIds: string[]): Promise<boolean> {
    if (!isSupabaseConfigured || sentenceIds.length === 0) return true;
    for (const chunk of chunkArray(sentenceIds, 100)) {
      const { error } = await supabase!.from('sentence_terms').delete().in('sentence_id', chunk).eq('user_id', getUserId());
      if (error) throw new Error(`Erro do Supabase ao deletar termos em lote: ${error.message}`);
    }
    return true;
  }
}

function normalizeRichTerms(rows: any[]): SentenceTermWithDictionary[] {
  return rows.map((row) => ({
    ...row,
    dictionary_entry_id: row.form?.dictionary_entry_id || row.form?.entry?.id || row.dictionary_entry_id || null,
    lemma: row.form?.entry?.lemma || undefined,
    kana: row.form?.kana || row.form?.entry?.kana || null,
    romaji: row.form?.romaji || row.form?.entry?.romaji || null,
    type: row.form?.entry?.type || undefined,
    grammar_note: row.form?.grammar_note || null,
    context_meaning: row.sense?.meaning || null,
    entry: row.form?.entry || null,
  }));
}
