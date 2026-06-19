import { ProcessingRunRepository } from '../../repositories';

export interface PreparationOptions {
  useCache: boolean;
  overwriteReviewed: boolean;
  runMode?: 'all' | 'translate' | 'analyze' | 'dictionary';
}

export class SourcePreparationService {
  static async prepareSource(sourceId: string, options: PreparationOptions, _runId?: string): Promise<void> {
    await ProcessingRunRepository.startSourceProcessingRun(sourceId, options.runMode || 'all');
  }
}
