import { SourcePreparationRunner } from './SourcePreparationRunner';
import { PreparationOptions, SourcePreparationService } from './SourcePreparationService';

export class ProcessingRunner {
  static get isRunning(): boolean {
    return SourcePreparationRunner.isRunning;
  }

  static stop(): void {
    SourcePreparationRunner.stop();
  }

  static async startPreparation(
    sourceId: string,
    options: PreparationOptions,
    onProgress?: () => void,
  ) {
    await SourcePreparationService.prepareSource(sourceId, options);
    SourcePreparationRunner.start(sourceId, onProgress);
  }

  static async resumePreparation(
    sourceId: string,
    _runId: string,
    _options: PreparationOptions,
    onProgress?: () => void,
  ) {
    SourcePreparationRunner.start(sourceId, onProgress);
  }

  static async cancelPreparation(): Promise<void> {
    SourcePreparationRunner.stop();
  }

  static async pausePreparation(): Promise<void> {
    SourcePreparationRunner.stop();
  }
}
