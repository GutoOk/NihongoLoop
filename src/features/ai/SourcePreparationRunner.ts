import { SourcePreparationEngine } from './SourcePreparationEngine';

export class SourcePreparationRunner {
  private static running = false;
  private static abortController: AbortController | null = null;
  private static runnerId = `source-prep-${Math.random().toString(36).slice(2)}`;
  private static listeners = new Set<(isRunning: boolean) => void>();

  static get isRunning(): boolean {
    return this.running;
  }

  static subscribe(listener: (isRunning: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.running);
    return () => this.listeners.delete(listener);
  }

  static start(sourceId?: string, onProgress?: () => void): void {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();
    this.notify();
    void this.loop(sourceId, onProgress);
  }

  static stop(): void {
    if (!this.running) return;
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    this.notify();
  }

  private static notify(): void {
    for (const listener of this.listeners) listener(this.running);
  }

  private static async loop(sourceId: string | undefined, onProgress?: () => void): Promise<void> {
    try {
      while (this.running && this.abortController && !this.abortController.signal.aborted) {
        if (!sourceId) {
          this.stop();
          return;
        }
        const processed = await SourcePreparationEngine.processNextSourceJob(
          sourceId,
          this.runnerId,
          this.abortController.signal,
        );
        onProgress?.();
        if (!processed) {
          this.stop();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      this.running = false;
      this.abortController = null;
      this.notify();
    }
  }
}
