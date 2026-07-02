import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { StudySession } from '../types';
import { getUserId, isE2EMockMode } from './utils';

export class StudySessionRepository {
  static async saveSession(session: Omit<StudySession, 'id' | 'created_at' | 'updated_at'>): Promise<StudySession | null> {
    if (isE2EMockMode()) return null;
    if (!isSupabaseConfigured) return null;
    const enriched = { ...session, user_id: session.user_id || getUserId() };
    const { data, error } = await supabase!.from('study_sessions').insert(enriched).select().maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao salvar sessao de estudo: ${error.message}`);
    }
    return data;
  }

  static async getSourceOffset(sourceId: string): Promise<number> {
    if (isE2EMockMode()) return 0;
    if (!isSupabaseConfigured) return 0;
    try {
      const { data, error } = await supabase!
        .from('study_sessions')
        .select('config')
        .eq('source_id', sourceId)
        .eq('type', 'source_offset')
        .eq('user_id', getUserId())
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error || !data?.[0]) return 0;
      return (data[0].config as { offset?: number })?.offset ?? 0;
    } catch {
      return 0;
    }
  }

  static async saveSourceOffset(sourceId: string, offset: number): Promise<boolean> {
    if (isE2EMockMode()) return true;
    if (!isSupabaseConfigured) return false;
    try {
      const { data, error } = await supabase!.rpc('save_source_study_offset', {
        p_source_id: sourceId,
        p_offset: offset,
      });
      return !error && data !== false;
    } catch {
      return false;
    }
  }
}
