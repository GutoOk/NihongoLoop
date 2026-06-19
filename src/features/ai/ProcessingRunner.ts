import { PreparationOptions, SourcePreparationService } from './SourcePreparationService';

export class ProcessingRunner {
  static get isRunning(): boolean {
    return false;
  }

  static stop(): void {
  }

  static async startPreparation(
    sourceId: string,
    options: PreparationOptions,
    onProgress?: () => void,
  ) {
    await SourcePreparationService.prepareSource(sourceId, options);
    onProgress?.();
  }

  static async resumePreparation(
    sourceId: string,
    runId: string,
    options: PreparationOptions,
    onProgress?: () => void,
  ) {
    await SourcePreparationService.prepareSource(sourceId, options, runId);
    onProgress?.();
  }

  static async cancelPreparation(): Promise<void> {
  }

  static async pausePreparation(): Promise<void> {
  }
}
