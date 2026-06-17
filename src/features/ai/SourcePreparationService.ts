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

      const result = await SourcePreparationEngine.createQueueFromPlan(plan);

      if (runId) {
        await ProcessingRunRepository.updateRun(runId, {
          status: 'completed',
          finished_at: new Date().toISOString(),
          current_step:
            result.jobs.length === 0 && result.appliedReusableTranslations === 0
              ? 'Nada a fazer: nenhuma lacuna real sem fila existente.'
              : `${result.jobs.length} lote(s) criados e ${result.appliedReusableTranslations} reaproveitamento(s) aplicados a partir de pendencias reais.`,
          total_items:
            plan.totals.translationItems + plan.totals.lexicalAnalysisItems + plan.totals.dictionaryItems,
          created_jobs: result.jobs.length,
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
