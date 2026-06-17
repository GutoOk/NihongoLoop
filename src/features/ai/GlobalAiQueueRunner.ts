import { AiJobRepository } from "../../repositories";
import { AiJobService } from "../../services/aiJobService";

export class GlobalAiQueueRunner {
  private static _isRunning = false;
  private static runnerId = Math.random().toString(36).substring(2, 11);
  private static abortController: AbortController | null = null;
  private static listeners: Set<(isRunning: boolean) => void> = new Set();
  
  static get isRunning(): boolean {
    return this._isRunning;
  }
  
  static subscribe(listener: (isRunning: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this._isRunning);
    return () => this.listeners.delete(listener);
  }
  
  private static notify() {
    this.listeners.forEach((listener) => listener(this._isRunning));
  }

  static async start(onProgress?: () => void) {
    if (this._isRunning) return;
    this._isRunning = true;
    this.abortController = new AbortController();
    this.notify();
    this.loop(onProgress);
  }

  static stop() {
    if (!this._isRunning) return;
    this._isRunning = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.notify();
  }

  private static async loop(onProgress?: () => void) {
    const errorDelayBase = 2000;
    let consecutiveErrors = 0;
    
    // Concurrency limit for local execution
    const concurrencyLimit = 3;
    const pool: Promise<void>[] = [];

    while (this._isRunning && this.abortController && !this.abortController.signal.aborted) {
      try {
        const jobs = await AiJobRepository.getAll();
        const pendingJobs = jobs.filter(j => j.status === 'pending');
        
        if (pendingJobs.length === 0) {
          // No more jobs, wait a bit and check again
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }

        // Prioritize: process one high priority, or just taking the top pending
        const nextJobs = pendingJobs.slice(0, concurrencyLimit * 2); // Buffer some jobs

        for (const job of nextJobs) {
          if (!this._isRunning || this.abortController?.signal.aborted) {
            break;
          }

          while (pool.length >= concurrencyLimit) {
            await Promise.race(pool);
          }

          const hasClaimed = await AiJobRepository.claimJob(job.id, this.runnerId);
          if (!hasClaimed) continue;

          let resolveTracked!: () => void;
          const tracked: Promise<void> = new Promise<void>((res) => {
            resolveTracked = res;
          });

          const jobPromise = (async () => {
            const heartbeatInterval = setInterval(async () => {
              try {
                await AiJobRepository.heartbeat(job.id, this.runnerId);
              } catch (hErr) {
                console.error("Heartbeat failed for job", job.id, hErr);
              }
            }, 15000);

            try {
              await AiJobService.processJobsBatch([job], this.abortController?.signal);
              if (onProgress) onProgress();
            } catch (err: any) {
              console.error(`Erro ao processar lote ${job.id}:`, err);
            } finally {
              clearInterval(heartbeatInterval);
              pool.splice(pool.indexOf(tracked), 1);
              resolveTracked();
            }
          })();

          pool.push(tracked);
        }

        // Reset error count on successful pass
        consecutiveErrors = 0;

        // If we processed everything in the buffer, give a small breathing pause
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Erro critico na fila global:", err);
          consecutiveErrors++;
          const delay = Math.min(errorDelayBase * Math.pow(2, consecutiveErrors), 30000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }
}
