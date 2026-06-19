import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { AiJob } from '../types';
import { getUserId } from './utils';

const AI_JOB_LIST_SELECT = [
  'id',
  'user_id',
  'run_id',
  'type',
  'target_type',
  'target_id',
  'target_key',
  'job_key',
  'status',
  'priority',
  'input_hash',
  'input',
  'payload',
  'result',
  'raw_result',
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
  'logs',
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

  static async getByTarget(targetId: string): Promise<AiJob[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase!
      .from('ai_jobs')
      .select(AI_JOB_LIST_SELECT)
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar tarefas de IA: ${error.message}`);
    }
    return (data || []) as unknown as AiJob[];
  }

  static async getByStatuses(statuses: AiJob['status'][]): Promise<AiJob[]> {
    if (!isSupabaseConfigured || statuses.length === 0) return [];
    const { data, error } = await supabase!
      .from('ai_jobs')
      .select(AI_JOB_LIST_SELECT)
      .eq('user_id', getUserId())
      .in('status', statuses)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar tarefas de IA por status: ${error.message}`);
    }
    return (data || []) as unknown as AiJob[];
  }

  static async getByTargetAndStatuses(targetId: string, statuses: AiJob['status'][]): Promise<AiJob[]> {
    if (!isSupabaseConfigured || statuses.length === 0) return [];
    const { data, error } = await supabase!
      .from('ai_jobs')
      .select(AI_JOB_LIST_SELECT)
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .in('status', statuses)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar tarefas de IA por status: ${error.message}`);
    }
    return (data || []) as unknown as AiJob[];
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

  static async updateStatus(id: string, updates: Partial<AiJob>): Promise<AiJob | null> {
    if (!isSupabaseConfigured) return null;
    const finalUpdates: any = { 
      ...updates, 
      updated_at: new Date().toISOString() 
    };
    delete finalUpdates.errors;
    delete finalUpdates.retry_count;
    const { data, error } = await supabase!.from('ai_jobs').update(finalUpdates).eq('id', id).eq('user_id', getUserId()).select(AI_JOB_LIST_SELECT).maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao atualizar status ai_job: ${error.message}`);
    }
    return data as unknown as AiJob | null;
  }

  static async getPendingByTarget(type: string, targetType: string, targetId: string): Promise<AiJob | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('ai_jobs').select(AI_JOB_LIST_SELECT)
      .eq('user_id', getUserId())
      .eq('type', type)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .in('status', ['pending', 'claimed', 'running', 'retry_wait'])
      .maybeSingle();
    return data as unknown as AiJob | null;
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

  static async cancelActiveJobsByRun(runId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.rpc('cancel_ai_jobs_by_run', {
      p_run_id: runId,
      p_user_id: getUserId(),
    });
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
    const { error } = await supabase!.rpc('retry_ai_jobs', {
      p_user_id: getUserId(),
      p_run_id: runId,
      p_source_id: null,
      p_job_id: null,
    });
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

  static async enqueueDictionaryEnrichmentJobs(entryIds: string[]): Promise<number> {
    if (!isSupabaseConfigured || entryIds.length === 0) return 0;
    const { data, error } = await supabase!.rpc('enqueue_dictionary_enrichment_jobs', {
      p_entry_ids: entryIds,
      p_user_id: getUserId(),
      p_model: 'gemini-2.5-flash-lite',
      p_prompt_version: 'dictionary-worker:2026-06-v1',
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao enfileirar enriquecimento de dicionario: ${error.message}`);
    }
    return Number(data || 0);
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
