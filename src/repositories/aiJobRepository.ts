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

const ACTIVE_QUEUE_STATUSES: AiJob['status'][] = ['pending', 'claimed', 'running', 'retry_wait', 'needs_review'];
const CANCELLABLE_QUEUE_STATUSES: AiJob['status'][] = ['pending', 'claimed', 'retry_wait', 'needs_review'];
const PROBLEM_QUEUE_STATUSES: AiJob['status'][] = ['error', 'failed', 'retry_wait', 'needs_review'];

export interface ClaimAiJobsParams {
  workerId: string;
  jobTypes?: string[];
  limit?: number;
  leaseSeconds?: number;
  userId?: string | null;
  runId?: string | null;
}

export interface WorkerFailureParams {
  jobId: string;
  workerId: string | null;
  error: string;
  errorCode?: string | null;
  errorKind?: 'transient' | 'permanent' | 'rate_limit' | 'invalid_response';
  retryAt?: string | null;
}

export interface WorkerCompletionParams {
  jobId: string;
  workerId: string;
  result: unknown;
  rawResult?: unknown;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costActual?: number | null;
  latencyAiMs?: number | null;
  latencyPersistMs?: number | null;
}

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

  static async add(job: Omit<AiJob, 'id' | 'created_at' | 'completed_at'>): Promise<AiJob | null> {
    if (!isSupabaseConfigured) return null;
    const enriched: any = { 
      ...job, 
      user_id: job.user_id || getUserId(), 
      updated_at: new Date().toISOString() 
    };
    delete enriched.errors;
    delete enriched.retry_count;
    const { data, error } = await supabase!.from('ai_jobs').insert(enriched).select(AI_JOB_LIST_SELECT).maybeSingle();
    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await supabase!
          .from('ai_jobs')
          .select(AI_JOB_LIST_SELECT)
          .eq('user_id', enriched.user_id)
          .eq('type', enriched.type)
          .eq('target_type', enriched.target_type)
          .eq('target_id', enriched.target_id)
          .eq('input_hash', enriched.input_hash)
          .maybeSingle();
        if (existing) return existing as unknown as AiJob;
      }
      console.error(error);
      throw new Error(`Erro do Supabase ao criar ai_job: ${error.message}`);
    }
    return data as unknown as AiJob | null;
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

  static async updateStatuses(ids: string[], updates: Partial<AiJob>): Promise<boolean> {
    if (!isSupabaseConfigured || ids.length === 0) return false;
    const finalUpdates: any = { 
      ...updates, 
      updated_at: new Date().toISOString() 
    };
    delete finalUpdates.errors;
    delete finalUpdates.retry_count;
    const { error } = await supabase!.from('ai_jobs')
      .update(finalUpdates)
      .in('id', ids)
      .eq('user_id', getUserId());
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao atualizar lote de status ai_jobs: ${error.message}`);
    }
    return true;
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
        started_at: now.toISOString(),
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
    const now = new Date().toISOString();
    const { error } = await supabase!.from('ai_jobs')
      .update({
        status: 'cancelled',
        error: 'Cancelado pelo usuario.',
        error_code: 'USER_CANCELLED',
        error_kind: 'permanent',
        locked_by: null,
        locked_until: null,
        lease_expires_at: null,
        worker_id: null,
        retry_at: null,
        updated_at: now,
      } as any)
      .eq('run_id', runId)
      .eq('user_id', getUserId())
      .in('status', CANCELLABLE_QUEUE_STATUSES);
    if (!error) {
      await supabase!.from('ai_jobs')
        .update({ cancel_requested: true, updated_at: now } as any)
        .eq('run_id', runId)
        .eq('user_id', getUserId())
        .eq('status', 'running');
    }
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao cancelar jobs da execucao: ${error.message}`);
    }
    return true;
  }

  static async cancelActiveJobsBySource(sourceId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const now = new Date().toISOString();
    const { error } = await supabase!.from('ai_jobs')
      .update({
        status: 'cancelled',
        error: 'Cancelado pelo usuario.',
        error_code: 'USER_CANCELLED',
        error_kind: 'permanent',
        locked_by: null,
        locked_until: null,
        lease_expires_at: null,
        worker_id: null,
        retry_at: null,
        updated_at: now,
      } as any)
      .eq('user_id', getUserId())
      .in('status', CANCELLABLE_QUEUE_STATUSES)
      .or(`target_id.eq.${sourceId},input->>sourceId.eq.${sourceId},payload->>sourceId.eq.${sourceId}`);
    if (!error) {
      await supabase!.from('ai_jobs')
        .update({ cancel_requested: true, updated_at: now } as any)
        .eq('user_id', getUserId())
        .eq('status', 'running')
        .or(`target_id.eq.${sourceId},input->>sourceId.eq.${sourceId},payload->>sourceId.eq.${sourceId}`);
    }
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao cancelar jobs da fonte: ${error.message}`);
    }
    return true;
  }

  static async cancelAllActiveJobs(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const now = new Date().toISOString();
    const { error } = await supabase!.from('ai_jobs')
      .update({
        status: 'cancelled',
        error: 'Cancelado pelo usuario.',
        error_code: 'USER_CANCELLED',
        error_kind: 'permanent',
        locked_by: null,
        locked_until: null,
        lease_expires_at: null,
        worker_id: null,
        retry_at: null,
        updated_at: now,
      } as any)
      .eq('user_id', getUserId())
      .in('status', CANCELLABLE_QUEUE_STATUSES);
    if (!error) {
      await supabase!.from('ai_jobs')
        .update({ cancel_requested: true, updated_at: now } as any)
        .eq('user_id', getUserId())
        .eq('status', 'running');
    }
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao cancelar fila ativa: ${error.message}`);
    }
    return true;
  }

  static async retryProblemJobsByRun(runId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const now = new Date().toISOString();
    const { error } = await supabase!.from('ai_jobs')
      .update({
        status: 'pending',
        error: null,
        error_code: null,
        error_kind: null,
        error_structured: null,
        attempts: 0,
        retry_count: 0,
        retry_at: null,
        locked_by: null,
        locked_until: null,
        lease_expires_at: null,
        worker_id: null,
        last_heartbeat_at: null,
        updated_at: now,
      } as any)
      .eq('run_id', runId)
      .eq('user_id', getUserId())
      .in('status', PROBLEM_QUEUE_STATUSES);
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

  static async claimJobs(params: ClaimAiJobsParams): Promise<AiJob[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase!.rpc('claim_ai_jobs', {
      p_worker_id: params.workerId,
      p_job_types: params.jobTypes ?? null,
      p_limit: params.limit ?? 10,
      p_lease_seconds: params.leaseSeconds ?? 300,
      p_user_id: params.userId ?? getUserId(),
      p_run_id: params.runId ?? null,
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao reivindicar jobs de IA: ${error.message}`);
    }
    return (data || []) as unknown as AiJob[];
  }

  static async startClaimedJob(jobId: string, workerId: string, leaseSeconds = 300): Promise<AiJob | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.rpc('start_claimed_ai_job', {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao iniciar job de IA: ${error.message}`);
    }
    return data as unknown as AiJob | null;
  }

  static async refreshLease(jobId: string, workerId: string, leaseSeconds = 300): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { data, error } = await supabase!.rpc('heartbeat_ai_job', {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao renovar lease do job: ${error.message}`);
    }
    return Boolean(data);
  }

  static async recoverExpiredLeases(limit = 1000, retryDelaySeconds = 60): Promise<number> {
    if (!isSupabaseConfigured) return 0;
    const { data, error } = await supabase!.rpc('recover_expired_ai_job_leases', {
      p_limit: limit,
      p_retry_delay_seconds: retryDelaySeconds,
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao recuperar leases expirados: ${error.message}`);
    }
    return Number(data || 0);
  }

  static async failForRetry(params: WorkerFailureParams): Promise<AiJob | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.rpc('fail_ai_job_for_retry', {
      p_job_id: params.jobId,
      p_worker_id: params.workerId,
      p_error: params.error,
      p_error_code: params.errorCode ?? null,
      p_error_kind: params.errorKind ?? 'transient',
      p_retry_at: params.retryAt ?? null,
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao registrar falha do job: ${error.message}`);
    }
    return data as unknown as AiJob | null;
  }

  static async completeFromWorker(params: WorkerCompletionParams): Promise<AiJob | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.rpc('complete_ai_job', {
      p_job_id: params.jobId,
      p_worker_id: params.workerId,
      p_result: params.result,
      p_raw_result: params.rawResult ?? null,
      p_input_tokens: params.inputTokens ?? null,
      p_output_tokens: params.outputTokens ?? null,
      p_cost_actual: params.costActual ?? null,
      p_latency_ai_ms: params.latencyAiMs ?? null,
      p_latency_persist_ms: params.latencyPersistMs ?? null,
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao concluir job de IA: ${error.message}`);
    }
    return data as unknown as AiJob | null;
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

  static async resetFailedJobs(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .update({ status: 'pending', error: null, result: null })
      .eq('user_id', getUserId())
      .in('status', ['error', 'failed', 'retry_wait', 'claimed', 'running']);
    return !error;
  }

  static async resetRunningJobsByTarget(targetId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .update({ status: 'pending', error: null, updated_at: new Date().toISOString() })
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .in('status', ['claimed', 'running']);
    return !error;
  }

  static async resetFailedJobsByTarget(targetId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .update({ status: 'pending', error: null, updated_at: new Date().toISOString() })
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .in('status', ['error', 'failed', 'retry_wait', 'needs_review']);
    return !error;
  }

  static async cancelJobsByTarget(targetId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .update({ status: 'cancelled' })
      .eq('user_id', getUserId())
      .eq('target_id', targetId)
      .in('status', ['pending', 'claimed', 'running', 'retry_wait', 'needs_review']);
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

  static async deleteJobsByType(type: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .delete()
      .eq('user_id', getUserId())
      .eq('type', type);
    return !error;
  }

  static async deleteNonCompletedJobsByType(type: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('ai_jobs')
      .delete()
      .eq('user_id', getUserId())
      .eq('type', type)
      .in('status', ['pending', 'claimed', 'running', 'retry_wait', 'needs_review', 'failed', 'error', 'cancelled']);
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
