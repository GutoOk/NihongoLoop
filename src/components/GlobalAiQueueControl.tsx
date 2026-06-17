import React, { useEffect, useState } from 'react';
import { Database, Play, Square, Eraser, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { AiJobRepository } from '../repositories';
import { AiJob } from '../types';
import { GlobalAiQueueRunner } from '../features/ai/GlobalAiQueueRunner';
import { useModal } from './ModalProvider';

export function GlobalAiQueueControl() {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [isRunning, setIsRunning] = useState(GlobalAiQueueRunner.isRunning);
  const { showConfirm } = useModal();

  useEffect(() => {
    const unsub = GlobalAiQueueRunner.subscribe(setIsRunning);
    return () => unsub();
  }, []);

  const loadJobs = async () => {
    // Excluir os completos antes de carregar
    await AiJobRepository.deleteCompletedJobsByType('batch_enrich_dictionary_entries_full');
    await AiJobRepository.deleteCompletedJobsByType('batch_analyze_sentence');
    await AiJobRepository.deleteCompletedJobsByType('batch_translate_sentence');
    
    // Deleta genérico completos pra garantir
    const all = await AiJobRepository.getAll();
    const completedIds = all.filter(j => j.status === 'completed').map(j => j.id);
    for(const id of completedIds) {
      await AiJobRepository.delete(id);
    }
    
    setJobs(await AiJobRepository.getAll());
  };

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 2000);
    return () => clearInterval(interval);
  }, []);

  const pending = jobs.filter(j => j.status === 'pending');
  const running = jobs.filter(j => j.status === 'running');
  const error = jobs.filter(j => j.status === 'error');
  const total = jobs.length;

  const toggleRun = () => {
    if (isRunning) {
      GlobalAiQueueRunner.stop();
    } else {
      GlobalAiQueueRunner.start(loadJobs);
    }
  };

  const clearQueue = async () => {
    if (await showConfirm("Confirmar limpeza", "Deseja remover todas as tarefas da fila? Esta ação não pode ser desfeita.")) {
      GlobalAiQueueRunner.stop();
      for (const j of jobs) {
        await AiJobRepository.delete(j.id);
      }
      await loadJobs();
    }
  };

  const retryFailed = async () => {
    for (const j of error) {
      await AiJobRepository.updateStatus(j.id, { status: "pending", error: null });
    }
    await loadJobs();
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-indigo-500" />
          <h3 className="font-bold text-slate-800">Fila do Servidor</h3>
        </div>
        <div className="flex gap-2">
          {error.length > 0 && (
            <button
              onClick={retryFailed}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-indigo-50 px-3 text-[11px] font-black uppercase tracking-wide text-indigo-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retentar Falhas
            </button>
          )}
          <button
            onClick={toggleRun}
            className={`inline-flex h-8 items-center justify-center gap-2 rounded-lg px-3 text-[11px] font-black uppercase tracking-wide text-white transition-colors sum-bg ${
              isRunning ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'
            }`}
          >
            {isRunning ? (
              <>
                <Square className="h-3.5 w-3.5 fill-current" />
                Pausar Fila
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                Iniciar Fila
              </>
            )}
          </button>
          
          <button
            onClick={clearQueue}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-rose-50 px-3 text-[11px] font-black uppercase tracking-wide text-rose-600 transition-colors hover:bg-rose-100"
            title="Limpar Fila"
          >
            <Eraser className="h-3.5 w-3.5" />
            Limpar Fila
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mt-4 text-xs">
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-amber-700 font-medium border border-amber-200/50">
          <span className="font-bold">{pending.length}</span> Pendentes
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1 text-sky-700 font-medium border border-sky-200/50">
          <span className="font-bold">{running.length}</span> Em Andamento
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1 text-rose-700 font-medium border border-rose-200/50">
          <span className="font-bold">{error.length}</span> Com Erro
        </div>
      </div>
      
      {total > 0 && (
         <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full transition-all duration-500 ${isRunning ? 'bg-emerald-400' : 'bg-slate-300'}`}
              style={{ width: `${Math.max(2, (running.length / total) * 100)}%` }}
            />
         </div>
      )}

      {jobs.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
          {jobs.map(job => (
            <div key={job.id} className="text-xs bg-slate-50 border border-slate-100 rounded-lg p-2.5 transition-all hover:border-slate-200">
              <div className="flex justify-between items-start mb-1.5">
                <div className="space-y-0.5 min-w-0 pr-2">
                   <span className="font-mono text-[10px] font-bold text-slate-500 uppercase block truncate">{job.type}</span>
                </div>
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                  job.status === 'running' ? 'bg-sky-100 text-sky-700' : 
                  job.status === 'error' ? 'bg-rose-100 text-rose-700' : 
                  job.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
                }`}>
                  {job.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
                {job.input?.text && (
                  <span className="font-medium text-slate-600 truncate max-w-[250px]" title={job.input.text}>
                    "{job.input.text.substring(0, 40)}{job.input.text.length > 40 ? "..." : ""}"
                  </span>
                )}
                {job.input?.items && (
                  <span className="font-bold text-indigo-500">
                    ({job.input.items.length} itens neste lote)
                  </span>
                )}
              </div>

              {job.error && (
                <div className="text-[10px] text-rose-600 font-medium flex items-start gap-1 mt-2 bg-rose-50 p-1.5 rounded border border-rose-100/50">
                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span className="leading-tight">{job.error}</span>
                </div>
              )}
              {job.current_step && (
                <div className="text-[10px] text-sky-600 font-medium flex items-center gap-1 mt-2 bg-sky-50 p-1.5 rounded border border-sky-100/50">
                  <Play className="w-3 h-3 shrink-0" />
                  <span className="leading-tight">{job.current_step}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
