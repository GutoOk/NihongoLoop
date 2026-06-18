import { SourcePreparationEngine } from './SourcePreparationEngine';

export class SourcePreparationRunner {
  private static running = false;
  private static abortController: AbortController | null = null;
  private static runnerId = `source-prep-${Math.random().toString(36).slice(2)}`;
  private static listeners = new Set<(isRunning: boolean) => void>();
  private static readonly concurrencyLimit = 6;
  private static readonly planOptions = {
    translateBatchSize: 1,
    analyzeBatchSize: 1,
    dictionaryBatchSize: 1,
  };

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

  static async drainSource(sourceId: string, onProgress?: () => void, signal?: AbortSignal, delayMs = 250): Promise<void> {
    while (!signal?.aborted) {
      const processed = await SourcePreparationEngine.processNextSourceJobs(sourceId, this.runnerId, this.concurrencyLimit, signal);
      onProgress?.();
      if (processed.length > 0) {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      const queued = await SourcePreparationEngine.createQueueForSource(sourceId, this.planOptions);
      onProgress?.();
      if (queued.jobs.length === 0 && queued.appliedReusableTranslations === 0) return;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
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
        await this.drainSource(sourceId, onProgress, this.abortController.signal);
        this.stop();
        return;
      }
    } finally {
      this.running = false;
      this.abortController = null;
      this.notify();
    }
  }
}
