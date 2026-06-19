import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { Source } from '../types';
import { defaultMockSources } from './mockData';
import { getUserId, isE2EMockMode } from './utils';

const SOURCE_SELECT = 'id,user_id,title,type,created_at,updated_at,favorite,difficulty';
const SOURCE_DETAIL_SELECT = 'id,user_id,title,type,original_content,created_at,updated_at,favorite,difficulty';

export class SourceRepository {
  static async getAll(): Promise<Source[]> {
    if (isE2EMockMode()) return defaultMockSources;
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('sources').select(SOURCE_SELECT).eq('user_id', getUserId()).order('created_at', { ascending: false });
    return (data || []) as unknown as Source[];
  }

  static async getById(id: string): Promise<Source | null> {
    if (isE2EMockMode()) return defaultMockSources.find((s) => s.id === id) || null;
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('sources').select(SOURCE_DETAIL_SELECT).eq('id', id).eq('user_id', getUserId()).maybeSingle();
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
