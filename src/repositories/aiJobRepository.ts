import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { AiJob } from '../types';
import { getUserId } from './utils';

export class AiJobRepository {
  static async getAll(): Promise<AiJob[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!.from('ai_jobs').select('*').eq('user_id', getUserId()).order('created_at', { ascending: false });
    return data || [];
  }

  static async getByTarget(targetId: string): Promise<AiJob[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase!
      .from('ai_jobs')
      .select('*')
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar tarefas de IA: ${error.message}`);
    }
    return data || [];
  }

  static async getByTargetAndStatuses(targetId: string, statuses: AiJob['status'][]): Promise<AiJob[]> {
    if (!isSupabaseConfigured || statuses.length === 0) return [];
    const { data, error } = await supabase!
      .from('ai_jobs')
      .select('*')
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .in('status', statuses)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar tarefas de IA por status: ${error.message}`);
    }
    return data || [];
  }

  static async hasTargetJobByTypeAndStatuses(
    targetId: string,
    type: AiJob['type'],
    statuses: AiJob['status'][],
  ): Promise<boolean> {
    if (!isSupabaseConfigured || statuses.length === 0) return false;
    const { data, error } = await supabase!
      .from('ai_jobs')
      .select('id')
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .eq('type', type)
      .in('status', statuses)
      .limit(1);
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao verificar fila de IA: ${error.message}`);
    }
    return Boolean(data && data.length > 0);
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
