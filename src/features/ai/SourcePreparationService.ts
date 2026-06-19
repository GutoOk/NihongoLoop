import { ProcessingRunRepository } from '../../repositories';

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
      void runId;
      await ProcessingRunRepository.startSourceProcessingRun(sourceId, options.runMode || 'all');
    } catch (error: any) {
      if (runId) {
        await ProcessingRunRepository.failRun(runId, error?.message || 'Falha ao preparar fonte.');
      }
      throw error;
    }
  }
}
