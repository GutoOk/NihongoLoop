import { SourcePreparationRunner } from './SourcePreparationRunner';

export class GlobalAiQueueRunner {
  static get isRunning(): boolean {
    return SourcePreparationRunner.isRunning;
  }

  static subscribe(listener: (isRunning: boolean) => void): () => void {
    return SourcePreparationRunner.subscribe(listener);
  }

  static start(_onProgress?: () => void): void {
    throw new Error('A fila global foi aposentada. Inicie o processamento pela fonte para manter auditoria e ordem.');
  }

  static stop(): void {
    SourcePreparationRunner.stop();
  }
}
