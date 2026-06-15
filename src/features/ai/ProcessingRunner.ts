import { ProcessingRunRepository, AiJobRepository, SourcePreparationRepository } from '../../repositories';
import { SourcePreparationService, PreparationOptions } from './SourcePreparationService';
import { AiJobService } from '../../services/aiJobService';

export class ProcessingRunner {
  private static _isRunning = false;
  private static currentRunId: string | null = null;

  static get isRunning(): boolean {
    return this._isRunning;
  }

  static stop(): void {
    this._isRunning = false;
    this.currentRunId = null;
  }
  private static activeControllers = new Map<string, AbortController>();
  private static runnerId = Math.random().toString(36).substring(2, 11);
  
  static async startPreparation(sourceId: string, options: PreparationOptions, onProgress?: () => void) {
    if (this.isRunning) return;
    
    // Always check for and clean up an existing active run to ensure a clean state
    let run = await ProcessingRunRepository.getActiveRun(sourceId);
    if (run) {
      await ProcessingRunRepository.updateRun(run.id, { 
        status: 'cancelled', 
        finished_at: new Date().toISOString(),
        current_step: 'Substituído por um novo processo' 
      });
      run = null;
    }
    
    if (!run) {
      run = await ProcessingRunRepository.createRun(sourceId, options.runMode || "all");
      if (run) {
        await SourcePreparationService.prepareSource(sourceId, options, run.id);
        run = await ProcessingRunRepository.getRun(run.id);
      }
    }
    
    if (run && run.status !== 'completed' && run.status !== 'error') {
       await AiJobRepository.resetRunningJobsByTarget(sourceId);

       this._isRunning = true;
       this.currentRunId = run.id;
       this.loop(run.id, sourceId, options, onProgress);
    }
  }
  
  static async cancelPreparation(runId: string) {
    const run = await ProcessingRunRepository.getRun(runId);
    if (run) {
        await AiJobRepository.cancelJobsByTarget(run.source_id);
    }
    await ProcessingRunRepository.requestCancel(runId);
    if (this.activeControllers.has(runId)) {
        this.activeControllers.get(runId)?.abort();
    }
    this._isRunning = false;
    this.currentRunId = null;
  }
  
  private static async loop(runId: string, sourceId: string, options: PreparationOptions, onProgress?: () => void) {
    let run = await ProcessingRunRepository.getRun(runId);
    const abortController = new AbortController();
    this.activeControllers.set(runId, abortController);
    const runMode = options.runMode || 'all';

    try {
      while (run && run.status !== 'completed' && run.status !== 'cancelled' && run.status !== 'error') {
         if (run.cancel_requested) {
            await ProcessingRunRepository.updateRun(runId, { status: 'cancelled', log: [...(run.log || []), { time: new Date().toISOString(), message: 'Preparação cancelada pelo usuário.' }] });
            break;
         }
         
         // 1. Gather live completion stats with narrow repository queries.
         const preparationStats = await SourcePreparationRepository.getStats(sourceId);
         const hasMissingTranslations = preparationStats.sNoTrans > 0;
         const hasMissingAnalysis = preparationStats.sMissingAnalysis > 0;
         const hasMissingEnrichment = preparationStats.dictPending > 0;

         // Fetch current job queues for this source
         const targetJobs = await AiJobRepository.getByTarget(sourceId);
         const pendingJobs = targetJobs.filter(j => j.status === 'pending');
         const runningJobs = targetJobs.filter(j => j.status === 'running');
         const errorJobs = targetJobs.filter((j) => j.status === "error");

         if (errorJobs.length > 0) {
           await ProcessingRunRepository.failRun(
             runId,
             `${errorJobs.length} lote(s) falharam. Corrija ou reinicie os erros antes de continuar.`
           );
           break;
         }

         // 2. Incremental generation hook if queues are empty, but steps are still incomplete
         if (pendingJobs.length === 0 && runningJobs.length === 0) {
            if (hasMissingTranslations && (runMode === 'all' || runMode === 'translate')) {
               await ProcessingRunRepository.appendLog(runId, "Iniciando fase incremental de tradução...");
               await SourcePreparationService.prepareSource(sourceId, { ...options, runMode: 'translate' }, runId);
            } else if (hasMissingAnalysis && (runMode === 'all' || runMode === 'analyze')) {
               await ProcessingRunRepository.appendLog(runId, "Iniciando fase incremental de análise estrutural...");
               await SourcePreparationService.prepareSource(sourceId, { ...options, runMode: 'analyze' }, runId);
            } else if (hasMissingEnrichment && (runMode === 'all' || runMode === 'dictionary')) {
               await ProcessingRunRepository.appendLog(runId, "Iniciando fase incremental de enriquecimento de dicionário...");
               await SourcePreparationService.prepareSource(sourceId, { ...options, runMode: 'dictionary' }, runId);
            } else {
               // All tasks for selected mode completed
               await ProcessingRunRepository.finishRun(runId);
               break;
            }

            // Sync gap
            await new Promise(r => setTimeout(r, 600));
            run = await ProcessingRunRepository.getRun(runId);
            continue;
         }
         
         const batchTranslate = (runMode === 'all' || runMode === 'translate') ? pendingJobs.filter(j => j.type === 'batch_translate_sentences') : [];
         const batchAnalyze = (runMode === 'all' || runMode === 'analyze') ? pendingJobs.filter(j => j.type === 'batch_analyze_sentences') : [];
         const batchDict = (runMode === 'all' || runMode === 'dictionary') ? pendingJobs.filter(j => j.type.startsWith('batch_enrich_dictionary')) : [];
         
         // Update run total jobs
         await ProcessingRunRepository.updateRun(runId, { 
            created_jobs: pendingJobs.length + runningJobs.length + (run.processed_jobs || 0)
         });
         
         let nextJobs: any[] = [];
         let concurrencyLimit = 3;

         if (batchTranslate.length > 0) {
            nextJobs = batchTranslate;
            concurrencyLimit = 3;
         } else if (batchAnalyze.length > 0) {
            nextJobs = batchAnalyze;
            concurrencyLimit = 2; // Strict limit to prevent API rate overflows
         } else if (batchDict.length > 0) {
            nextJobs = batchDict;
            concurrencyLimit = 3;
         }
         
         if (nextJobs.length > 0) {
            const currentStepType = nextJobs[0].type;
            const currentStepName = currentStepType.split('_')[1];
            await ProcessingRunRepository.updateRun(runId, { current_step: `Processando lotes de '${currentStepName}' (limite de ${concurrencyLimit} ativos)...` });
            if (onProgress) onProgress();
            
            try {
               const pool: Promise<void>[] = [];
               
               for (const job of nextJobs) {
                  if (abortController.signal.aborted) {
                     break;
                  }
                  
                  // Wait until pool has a free slot before launching next job
                  while (pool.length >= concurrencyLimit) {
                     await Promise.race(pool);
                  }
                  
                  // Atomic lock acquisition lease
                  const hasClaimed = await AiJobRepository.claimJob(job.id, this.runnerId);
                  if (!hasClaimed) {
                     continue;
                  }

                  // Wrap the job promise so it self-removes from pool on completion (avoids race on pool.length)
                  let resolveTracked!: () => void;
                  const tracked: Promise<void> = new Promise<void>(res => { resolveTracked = res; });

                  const jobPromise = (async () => {
                     // Dynamic periodic heartbeat (every 15 seconds)
                     const heartbeatInterval = setInterval(async () => {
                        try {
                           await AiJobRepository.heartbeat(job.id, this.runnerId);
                        } catch (hErr) {
                           console.error("Heartbeat failed for job", job.id, hErr);
                        }
                     }, 15000);

                     try {
                        const result = await AiJobService.processJobsBatch([job], abortController.signal);
                        if (result.success && (!result.errorCount || result.errorCount === 0)) {
                           await ProcessingRunRepository.appendLog(runId, `Lote concluído: ${job.type.substring(6)} (${job.id.substring(0, 8)})`);
                           
                           // Update processed_jobs real-time
                           const freshRun = await ProcessingRunRepository.getRun(runId);
                           if (freshRun) {
                              await ProcessingRunRepository.updateRun(runId, { processed_jobs: (freshRun.processed_jobs || 0) + 1 });
                           }
                        } else {
                           const errMsg = result.error || 'Erro parcial no lote';
                           await ProcessingRunRepository.appendLog(runId, `Lote falhou: ${job.type.substring(6)} (${job.id.substring(0, 8)}) - ${errMsg}`);
                        }
                     } catch (err: any) {
                        if (err.name !== 'AbortError') {
                           await ProcessingRunRepository.appendLog(runId, `Erro ao processar lote: ${job.type.substring(6)} (${job.id.substring(0, 8)}) - ${err.message}`);
                        }
                     } finally {
                        clearInterval(heartbeatInterval);
                        if (onProgress) onProgress();
                        // Remove self from pool synchronously before resolving tracked
                        const idx = pool.indexOf(tracked);
                        if (idx > -1) pool.splice(idx, 1);
                        resolveTracked();
                      }
                  })();
                  
                  pool.push(tracked);
                  // Propagate unhandled rejections from jobPromise (tracked never rejects itself)
                  jobPromise.catch(() => {});
               }
               
               await Promise.all(pool);
            } catch (err: any) {
               if (err.name !== 'AbortError') {
                  await ProcessingRunRepository.appendLog(runId, `Erro geral durante o processamento: ${err.message}`);
               }
            }
            
            // Wait slightly
            await new Promise(r => setTimeout(r, 200));
         } else if (runningJobs.length > 0) {
            await ProcessingRunRepository.updateRun(runId, { current_step: `Aguardando ${runningJobs.length} tarefas de IA em andamento...` });
            if (onProgress) onProgress();
            await new Promise(r => setTimeout(r, 2000));
         } else {
            // Processamento concluído
            await ProcessingRunRepository.finishRun(runId);
            break;
         }
         
         run = await ProcessingRunRepository.getRun(runId);
         if (onProgress) onProgress();
      }
    } catch (e: any) {
      await ProcessingRunRepository.failRun(runId, e.message);
      if (onProgress) onProgress();
    } finally {
      this._isRunning = false;
      this.currentRunId = null;
      this.activeControllers.delete(runId);
    }
  }
}
