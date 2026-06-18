import React, { useEffect, useState } from 'react';
import { AlertCircle, Database, Eraser, RefreshCw } from 'lucide-react';
import { AiJobRepository } from '../repositories';
import { AiJob } from '../types';
import { SourcePreparationEngine } from '../features/ai/SourcePreparationEngine';
import { getJobHumanName } from './sourcePreparation/jobDisplay';
import { useModal } from './ModalProvider';

export function GlobalAiQueueControl() {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const { showConfirm } = useModal();

  const loadJobs = async () => {
    try {
      setJobs(await AiJobRepository.getAll());
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message || 'Nao foi possivel carregar a fila.');
    }
  };

  useEffect(() => {
    void loadJobs();
    const interval = setInterval(() => void loadJobs(), 3000);
    return () => clearInterval(interval);
  }, []);

  const pending = jobs.filter((job) => job.status === 'pending').length;
  const running = jobs.filter((job) => job.status === 'running').length;
  const error = jobs.filter((job) => job.status === 'error').length;
  const clearable = jobs.filter(isClearableQueueJob).length;
  const visibleJobs = jobs.filter(isVisibleQueueJob);

  const clearQueue = async () => {
    if (!(await showConfirm('Excluir fila global', 'Remover tarefas pendentes, com erro e concluidas da fila global? Tarefas rodando serao preservadas.'))) {
      return;
    }
    setIsClearing(true);
    try {
      await SourcePreparationEngine.clearAllQueueJobs();
      await loadJobs();
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-indigo-500" />
          <h3 className="font-bold text-slate-800">Fila global de IA</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void loadJobs()}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </button>
          <button
            onClick={() => void clearQueue()}
            disabled={isClearing || clearable === 0}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-rose-100 bg-white px-3 text-[11px] font-black uppercase tracking-wide text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            <Eraser className="h-3.5 w-3.5" />
            Excluir fila global
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <QueueMetric label="Pendentes" value={pending} />
        <QueueMetric label="Rodando" value={running} />
        <QueueMetric label="Erros" value={error} />
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {visibleJobs.length === 0 ? (
          <div className="rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-500">Nenhum job registrado.</div>
        ) : (
          visibleJobs.map((job) => {
            const input = typeof job.input === 'string' ? {} : job.input || {};
            const label = typeof input.label === 'string' ? input.label : SourcePreparationEngine.getHumanJobLabel(job);
            return (
              <div key={job.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-black text-slate-900">{label}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      {getJobHumanName(job.type)} · {job.target_id}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusClass(job.status)}`}>
                    {job.status}
                  </span>
                </div>
                {job.error && <div className="mt-2 rounded border border-rose-100 bg-rose-50 p-2 text-[11px] font-semibold text-rose-700">{job.error}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function isClearableQueueJob(job: AiJob): boolean {
  return job.status === 'pending' || job.status === 'error' || job.status === 'completed' || job.status === 'applied' || job.status === 'cancelled';
}

function isVisibleQueueJob(job: AiJob): boolean {
  return job.status === 'pending' || job.status === 'running' || job.status === 'error';
}

function QueueMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-lg font-black text-slate-900">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function statusClass(status: AiJob['status']): string {
  if (status === 'running') return 'bg-sky-100 text-sky-700';
  if (status === 'error') return 'bg-rose-100 text-rose-700';
  if (status === 'pending') return 'bg-amber-100 text-amber-700';
  if (status === 'completed' || status === 'applied') return 'bg-emerald-100 text-emerald-700';
  return 'bg-slate-100 text-slate-700';
}
