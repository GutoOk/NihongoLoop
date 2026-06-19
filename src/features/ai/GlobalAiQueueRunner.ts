export class GlobalAiQueueRunner {
  static get isRunning(): boolean {
    return false;
  }

  static subscribe(listener: (isRunning: boolean) => void): () => void {
    listener(false);
    return () => undefined;
  }

  static start(onProgress?: () => void): void {
    onProgress?.();
  }

  static stop(): void {
  }
}
