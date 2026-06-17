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
        .maybeSingle();
      if (error || !data) return 0;
      return (data.config as { offset?: number })?.offset ?? 0;
    } catch {
      return 0;
    }
  }

  static async saveSourceOffset(sourceId: string, offset: number): Promise<boolean> {
    if (isE2EMockMode()) return true;
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
