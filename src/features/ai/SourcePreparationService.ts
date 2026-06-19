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
  static async prepareSource(sourceId: string, options: PreparationOptions, _runId?: string): Promise<void> {
    await ProcessingRunRepository.startSourceProcessingRun(sourceId, options.runMode || 'all');
  }
}
