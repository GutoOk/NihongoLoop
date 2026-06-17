import { AiJobRepository } from "../../repositories";
import { AiJobService } from "../../services/aiJobService";

const DEFAULT_CONCURRENCY = 3;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;
const STORAGE_KEY = "global_ai_queue_concurrency";

export class GlobalAiQueueRunner {
  private static _isRunning = false;
  private static runnerId = Math.random().toString(36).substring(2, 11);
  private static abortController: AbortController | null = null;
  private static listeners: Set<(isRunning: boolean) => void> = new Set();

  static get isRunning(): boolean {
    return this._isRunning;
  }

  static get concurrencyLimit(): number {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return this.normalizeConcurrency(stored || DEFAULT_CONCURRENCY);
  }

  static setConcurrencyLimit(value: number): number {
    const normalized = this.normalizeConcurrency(value);
    localStorage.setItem(STORAGE_KEY, String(normalized));
    return normalized;
  }

  static subscribe(listener: (isRunning: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this._isRunning);
    return () => this.listeners.delete(listener);
  }

  static async start(onProgress?: () => void) {
    if (this._isRunning) return;
    await AiJobRepository.resetRunningJobs();
    this._isRunning = true;
    this.abortController = new AbortController();
    this.notify();
    void this.loop(onProgress);
  }

  static async stop() {
    if (!this._isRunning && !this.abortController) {
      await AiJobRepository.resetRunningJobs();
      return;
    }
    this._isRunning = false;
    this.abortController?.abort();
    this.abortController = null;
    await AiJobRepository.resetRunningJobs();
    this.notify();
  }

  private static notify() {
    this.listeners.forEach((listener) => listener(this._isRunning));
  }

  private static normalizeConcurrency(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_CONCURRENCY;
    return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.round(value)));
  }

  private static sortPendingJobs(jobs: Awaited<ReturnType<typeof AiJobRepository.getAll>>) {
    return jobs
      .filter((job) => job.status === "pending")
      .sort((a, b) => {
        const priorityDiff = (b.priority || 0) - (a.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
  }

  private static async loop(onProgress?: () => void) {
    const errorDelayBase = 2000;
    let consecutiveErrors = 0;

    while (this._isRunning && this.abortController && !this.abortController.signal.aborted) {
      try {
        const jobs = await AiJobRepository.getAll();
        const pendingJobs = this.sortPendingJobs(jobs);

        if (pendingJobs.length === 0) {
          onProgress?.();
          await this.sleep(2500);
          continue;
        }

        const concurrencyLimit = this.concurrencyLimit;
        const nextJobs = pendingJobs.slice(0, concurrencyLimit);
        const claimedJobs = [];

        for (const job of nextJobs) {
          if (!this._isRunning || this.abortController?.signal.aborted) break;
          const hasClaimed = await AiJobRepository.claimJob(job.id, this.runnerId);
          if (hasClaimed) claimedJobs.push(job);
        }

        if (claimedJobs.length === 0) {
          await this.sleep(1000);
          continue;
        }

        const heartbeat = setInterval(() => {
          for (const job of claimedJobs) {
            void AiJobRepository.heartbeat(job.id, this.runnerId);
          }
        }, 15000);

        try {
          await AiJobService.processJobsBatch(claimedJobs, this.abortController.signal);
        } finally {
          clearInterval(heartbeat);
        }
        onProgress?.();
        consecutiveErrors = 0;
      } catch (err: any) {
        if (err.name === "AbortError") break;
        console.error("Erro critico na fila global:", err);
        consecutiveErrors++;
        const delay = Math.min(errorDelayBase * Math.pow(2, consecutiveErrors), 30000);
        await this.sleep(delay);
      }
    }

    this._isRunning = false;
    this.abortController = null;
    await AiJobRepository.resetRunningJobs();
    this.notify();
    onProgress?.();
  }

  private static sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
