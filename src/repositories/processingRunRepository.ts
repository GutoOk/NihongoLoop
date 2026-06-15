import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import { ProcessingRun } from '../types';
import { getUserId } from './utils';

export class ProcessingRunRepository {
  static async createRun(sourceId: string, runMode: "all" | "translate" | "analyze" | "dictionary" = "all"): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('processing_runs').insert({
      user_id: getUserId(),
      source_id: sourceId,
      status: 'pending',
      run_mode: runMode
    }).select().maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao criar processamento: ${error.message}`);
    }
    return data;
  }

  static async getActiveRun(sourceId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('processing_runs')
      .select('*')
      .eq('source_id', sourceId)
      .eq('user_id', getUserId())
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  static async getResumableRun(sourceId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('processing_runs')
      .select('*')
      .eq('source_id', sourceId)
      .eq('user_id', getUserId())
      .in('status', ['pending', 'running', 'paused', 'error'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar processamento retomavel: ${error.message}`);
    }
    return data;
  }

  static async getLatestRunBySource(sourceId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('processing_runs')
      .select('*')
      .eq('source_id', sourceId)
      .eq('user_id', getUserId())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao carregar processamento mais recente: ${error.message}`);
    }
    return data;
  }

  static async getRun(runId: string): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data } = await supabase!.from('processing_runs')
      .select('*')
      .eq('id', runId)
      .eq('user_id', getUserId())
      .maybeSingle();
    return data;
  }

  static async updateRun(id: string, patch: Partial<ProcessingRun>): Promise<ProcessingRun | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase!.from('processing_runs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', getUserId())
      .select()
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error(`Erro do Supabase ao atualizar processamento: ${error.message}`);
    }
    return data;
  }

  static async appendLog(id: string, message: string, meta?: unknown): Promise<void> {
    if (!isSupabaseConfigured) return;
    const run = await this.getRun(id);
    if (!run) return;
    const entry = { time: new Date().toISOString(), message, ...(meta ? { meta } : {}) };
    const logs = Array.isArray(run.log) ? [...run.log, entry] : [entry];
    await this.updateRun(id, { log: logs });
  }

  static async requestCancel(id: string): Promise<void> {
    await this.updateRun(id, {
      cancel_requested: true,
      status: 'cancelled',
      finished_at: new Date().toISOString()
    });
  }

  static async pauseRun(id: string): Promise<void> {
    await this.updateRun(id, {
      cancel_requested: false,
      status: 'paused',
      current_step: 'Pausado. A fila pendente foi preservada para retomada.'
    });
  }

  static async resumeRun(id: string): Promise<void> {
    await this.updateRun(id, {
      cancel_requested: false,
      status: 'pending',
      error: null,
      finished_at: null,
      current_step: 'Retomando preparacao...'
    });
  }

  static async finishRun(id: string): Promise<void> {
    await this.updateRun(id, { status: 'completed', finished_at: new Date().toISOString() });
  }

  static async failRun(id: string, error: string): Promise<void> {
    await this.updateRun(id, { status: 'error', error, finished_at: new Date().toISOString() });
  }

  static async deleteRunsBySource(sourceId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const { error } = await supabase!.from('processing_runs')
      .delete()
      .eq('source_id', sourceId)
      .eq('user_id', getUserId());
    return !error;
  }
}
