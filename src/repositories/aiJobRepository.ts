import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { AiJob } from '../types';
import { getUserId } from './utils';

export type AiQueueSummary = {
  pending: number;
  running: number;
  retry: number;
  review: number;
  completed: number;
  cancelled: number;
  error: number;
  stuck: number;
  clearable: number;
};

const AI_JOB_LIST_SELECT = [
  'id',
  'user_id',
  'run_id',
  'type',
  'target_type',
  'target_id',
  'job_key',
  'status',
  'priority',
  'input_hash',
  'error',
  'error_code',
  'error_kind',
  'attempts',
  'max_attempts',
  'model',
  'model_version',
  'prompt_version',
  'target_hash',
  'input_tokens',
  'output_tokens',
  'cost_estimate',
  'cost_actual',
  'latency_queue_ms',
  'latency_ai_ms',
  'latency_persist_ms',
  'created_at',
  'claimed_at',
  'started_at',
  'completed_at',
  'updated_at',
  'locked_by',
  'locked_until',
  'lease_expires_at',
  'worker_id',
  'retry_at',
  'retry_count',
  'cancel_requested',
  'last_heartbeat_at',
].join(',');

export class AiJobRepository {
  static async getAll(): Promise<AiJob[]> {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase!
      .from('ai_jobs')
      .select(AI_JOB_LIST_SELECT)
      .eq('user_id', getUserId())
      .order('created_at', { ascending: false })
      .limit(500);
    return (data || []) as unknown as AiJob[];
  }

  static async getByRun(runId: string, limit = 100): Promise<AiJob[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase!
      .from('ai_jobs')
      .select(AI_JOB_LIST_SELECT)
      .eq('run_id', runId)
      .eq('user_id', getUserId())
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar jobs do processamento: ${error.message}`);
    }
    return (data || []) as unknown as AiJob[];
  }

  static async getGlobalSummary(): Promise<AiQueueSummary> {
    if (!isSupabaseConfigured) return emptySummary();
    const userId = getUserId();
    const count = async (statuses: string[], extra?: (query: any) => any) => {
      let query = supabase!
        .from('ai_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('status', statuses);
      if (extra) query = extra(query);
      const { count: total, error } = await query;
      if (error) throw new Error(`Erro do Supabase ao contar fila global: ${error.message}`);
      return total || 0;
    };
    const now = new Date().toISOString();
    const [
      pending,
      running,
      retry,
      review,
      completed,
      cancelled,
      error,
      expiredLeases,
      heartbeatStuck,
      clearable,
    ] = await Promise.all([
      count(['pending']),
      count(['running', 'claimed']),
      count(['retry_wait']),
      count(['needs_review']),
      count(['completed', 'applied']),
      count(['cancelled']),
      count(['error', 'failed']),
      count(['running', 'claimed'], (query) => query.not('lease_expires_at', 'is', null).lt('lease_expires_at', now)),
      count(['running', 'claimed'], (query) => query.is('locked_until', null).not('last_heartbeat_at', 'is', null).lt('last_heartbeat_at', new Date(Date.now() - 5 * 60_000).toISOString())),
      count(['pending', 'error', 'completed', 'applied', 'cancelled']),
    ]);
    return { pending, running, retry, review, completed, cancelled, error, stuck: expiredLeases + heartbeatStuck, clearable };
  }

  static async cancelActiveJobsByRun(runId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.rpc('cancel_processing_run', { p_run_id: runId });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao cancelar jobs da execucao: ${error.message}`);
    }
    return true;
  }

  static async cancelActiveJobsBySource(sourceId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.rpc('cancel_ai_jobs_by_source', {
      p_source_id: sourceId,
      p_user_id: getUserId(),
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao cancelar jobs da fonte: ${error.message}`);
    }
    return true;
  }

  static async cancelAllActiveJobs(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.rpc('cancel_all_ai_jobs_for_user', {
      p_user_id: getUserId(),
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao cancelar fila ativa: ${error.message}`);
    }
    return true;
  }

  static async retryProblemJobsByRun(runId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.rpc('retry_failed_run_jobs', { p_run_id: runId });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao retentar jobs da execucao: ${error.message}`);
    }
    return true;
  }

  static async getBySource(sourceId: string): Promise<AiJob[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase!
      .from('ai_jobs')
      .select(AI_JOB_LIST_SELECT)
      .eq('user_id', getUserId())
      .or(`target_id.eq.${sourceId},input->>sourceId.eq.${sourceId},payload->>sourceId.eq.${sourceId}`)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar fila da fonte: ${error.message}`);
    }
    return (data || []) as unknown as AiJob[];
  }

  static async retryProblemJobsBySource(sourceId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.rpc('retry_ai_jobs', {
      p_user_id: getUserId(),
      p_run_id: null,
      p_source_id: sourceId,
      p_job_id: null,
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao retentar jobs da fonte: ${error.message}`);
    }
    return true;
  }

  static async retryAllProblemJobs(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.rpc('retry_ai_jobs', {
      p_user_id: getUserId(),
      p_run_id: null,
      p_source_id: null,
      p_job_id: null,
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao retentar fila global: ${error.message}`);
    }
    return true;
  }

  static async cancelJob(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.rpc('cancel_ai_job', {
      p_job_id: id,
      p_user_id: getUserId(),
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao cancelar job: ${error.message}`);
    }
    return true;
  }
}

function emptySummary(): AiQueueSummary {
  return { pending: 0, running: 0, retry: 0, review: 0, completed: 0, cancelled: 0, error: 0, stuck: 0, clearable: 0 };
}
