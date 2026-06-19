import { ProcessingRunRepository } from '../../repositories';
import { SourcePreparationEngine } from './SourcePreparationEngine';

export interface PreparationOptions {
  translateBatchSize: number;
  analyzeBatchSize: number;
  dictFastBatchSize: number;
  dictFullBatchSize: number;
  dictMode: 'fast' | 'full';
  useCache: boolean;
  overwriteReviewed: boolean;
  runMode?: 'all' | 'translate' | 'analyze' | 'dictionary';
  processMode?: 'local' | 'server';
  concurrencyLimit?: number;
}

export class SourcePreparationService {
  static async prepareSource(sourceId: string, options: PreparationOptions, runId?: string): Promise<void> {
    try {
      if (runId) {
        await ProcessingRunRepository.updateRun(runId, {
          status: 'running',
          started_at: new Date().toISOString(),
          current_step: 'Diagnosticando lacunas reais...',
        });
      }

      const plan = await SourcePreparationEngine.buildPlan(sourceId, {
        translateBatchSize: options.translateBatchSize,
        analyzeBatchSize: options.analyzeBatchSize,
        dictionaryBatchSize: options.dictFullBatchSize,
      });

      const result = await SourcePreparationEngine.createQueueFromPlan(plan, runId);

      if (runId) {
        await ProcessingRunRepository.updateRun(runId, {
          status: result.jobs.length > 0 ? 'running' : 'completed',
          finished_at: result.jobs.length > 0 ? null : new Date().toISOString(),
          current_step:
            result.jobs.length === 0 && result.appliedReusableTranslations === 0
              ? 'Nada a fazer: nenhuma lacuna real sem fila existente.'
              : `${result.jobs.length} job(s) individuais criados para worker persistente e ${result.appliedReusableTranslations} reaproveitamento(s) aplicados.`,
          total_items:
            plan.totals.translationItems + plan.totals.lexicalAnalysisItems + plan.totals.dictionaryItems,
          created_jobs: result.jobs.length,
          planned_jobs: plan.totals.jobs,
          pending_jobs: result.jobs.length,
        });
      }
    } catch (error: any) {
      if (runId) {
        await ProcessingRunRepository.failRun(runId, error?.message || 'Falha ao preparar fonte.');
      }
      throw error;
    }
  }
}
