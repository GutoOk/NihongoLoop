import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { ProcessingRun } from '../types';
import { getUserId } from './utils';

const PROCESSING_RUN_SELECT = [
  'id',
  'user_id',
  'source_id',
  'status',
  'current_step',
  'total_steps',
  'completed_steps',
  'total_items',
  'processed_items',
  'created_jobs',
  'planned_jobs',
  'pending_jobs',
  'claimed_jobs',
  'running_jobs',
  'processed_jobs',
  'completed_jobs',
  'failed_jobs',
  'retry_jobs',
  'review_jobs',
  'needs_review_jobs',
  'cancelled_jobs',
  'obsolete_jobs',
  'applied_items',
  'failed_items',
  'cancel_requested',
  'run_mode',
  'log',
  'error',
  'total_cost_estimate',
  'total_cost_actual',
  'total_input_tokens',
  'total_output_tokens',
  'ai_call_count',
  'started_at',
  'finished_at',
  'created_at',
  'updated_at',
].join(',');

export class ProcessingRunRepository {
  static async startSourceProcessingRun(sourceId: string, runMode: "all" | "translate" | "analyze" | "dictionary" = "all"): Promise<{ run_id: string; stage?: string | null; created_jobs: number; status: string } | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.rpc('create_or_resume_source_run', {
      p_source_id: sourceId,
      p_run_mode: runMode,
    });
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao iniciar processamento persistido: ${error.message}`);
    }
    return data as any;
  }

  static async createRun(sourceId: string, runMode: "all" | "translate" | "analyze" | "dictionary" = "all"): Promise<ProcessingRun | null> {
    const result = await this.startSourceProcessingRun(sourceId, runMode);
    return result?.run_id ? this.getRun(result.run_id) : null;
  }

  static async createOrResumeRun(sourceId: string, runMode: "all" | "translate" | "analyze" | "dictionary" = "all"): Promise<ProcessingRun | null> {
    return this.createRun(sourceId, runMode);
  }

  static async getActiveRun(sourceId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('processing_runs')
      .select(PROCESSING_RUN_SELECT)
      .eq('source_id', sourceId)
      .eq('user_id', getUserId())
      .in('status', ['pending', 'planning', 'running', 'paused', 'needs_review'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data as unknown as ProcessingRun | null;
  }

  static async getResumableRun(sourceId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('processing_runs')
      .select(PROCESSING_RUN_SELECT)
      .eq('source_id', sourceId)
      .eq('user_id', getUserId())
      .in('status', ['pending', 'planning', 'running', 'paused', 'needs_review', 'error', 'failed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar processamento retomavel: ${error.message}`);
    }
    return data as unknown as ProcessingRun | null;
  }

  static async getLatestRunBySource(sourceId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('processing_runs')
      .select(PROCESSING_RUN_SELECT)
      .eq('source_id', sourceId)
      .eq('user_id', getUserId())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar processamento mais recente: ${error.message}`);
    }
    return data as unknown as ProcessingRun | null;
  }

  static async getRun(runId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('processing_runs')
      .select(PROCESSING_RUN_SELECT)
      .eq('id', runId)
      .eq('user_id', getUserId())
      .maybeSingle();
    return data as unknown as ProcessingRun | null;
  }

  static async requestCancel(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase!.rpc('cancel_processing_run', { p_run_id: id });
    if (error) throw new Error(`Erro do Supabase ao cancelar processamento: ${error.message}`);
  }

  static async resumeRun(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase!.rpc('advance_processing_run', { p_run_id: id });
    if (error) throw new Error(`Erro do Supabase ao retomar processamento: ${error.message}`);
  }

}
