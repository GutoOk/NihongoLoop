import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Database,
  Eraser,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { GlobalAiQueueRunner } from "../features/ai/GlobalAiQueueRunner";
import { AiJobRepository } from "../repositories";
import { AiJob } from "../types";
import { useModal } from "./ModalProvider";
import { getJobHumanName } from "./sourcePreparation/jobDisplay";

const ACTIVE_STATUSES: AiJob["status"][] = ["pending", "running", "error"];

export function GlobalAiQueueControl() {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(GlobalAiQueueRunner.isRunning);
  const [concurrency, setConcurrency] = useState(GlobalAiQueueRunner.concurrencyLimit);
  const { showConfirm } = useModal();

  useEffect(() => {
    const unsubscribe = GlobalAiQueueRunner.subscribe(setIsRunning);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(() => loadJobs(true), 2000);
    return () => clearInterval(interval);
  }, []);

  const activeJobs = useMemo(
    () =>
      jobs
        .filter((job) => ACTIVE_STATUSES.includes(job.status))
        .sort((a, b) => {
          const statusWeight = { error: 0, running: 1, pending: 2 } as Record<string, number>;
          const statusDiff = statusWeight[a.status] - statusWeight[b.status];
          if (statusDiff !== 0) return statusDiff;
          const priorityDiff = (b.priority || 0) - (a.priority || 0);
          if (priorityDiff !== 0) return priorityDiff;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }),
    [jobs],
  );
  const pending = activeJobs.filter((job) => job.status === "pending");
  const running = activeJobs.filter((job) => job.status === "running");
  const failed = activeJobs.filter((job) => job.status === "error");
  const progressPercent =
    activeJobs.length === 0 ? 0 : Math.round((running.length / activeJobs.length) * 100);

  const loadJobs = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setJobs(await AiJobRepository.getAll());
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const toggleRun = async () => {
    if (isRunning) {
      await GlobalAiQueueRunner.stop();
    } else {
      await GlobalAiQueueRunner.start(() => loadJobs(true));
    }
    await loadJobs(true);
  };

  const clearQueue = () => {
    showConfirm(
      "Limpar fila do servidor",
      "Isso remove todas as tarefas da fila única de IA, incluindo pendentes, em andamento, com erro e concluídas ocultas.",
      async () => {
        await GlobalAiQueueRunner.stop();
        await AiJobRepository.deleteAll();
        await loadJobs();
      },
      "Limpar fila",
    );
  };

  const retryFailed = async () => {
    await GlobalAiQueueRunner.stop();
    for (const job of failed) {
      await AiJobRepository.updateStatus(job.id, {
        status: "pending",
        error: null,
        result: null,
        locked_by: null,
        locked_until: null,
      });
    }
    await loadJobs();
  };

  const updateConcurrency = (value: number) => {
    const normalized = GlobalAiQueueRunner.setConcurrencyLimit(value);
    setConcurrency(normalized);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-900">
            <Database className="h-4 w-4 text-indigo-600" />
            Fila do servidor
          </h3>
          <p className="text-xs leading-relaxed text-slate-500">
            Controle único das tarefas de IA. Preparar etapas só adiciona tarefas; iniciar e pausar são sempre manuais aqui.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <label className="inline-flex h-9 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700">
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
            <span>Paralelos</span>
            <select
              value={concurrency}
              onChange={(event) => updateConcurrency(Number(event.target.value))}
              className="bg-transparent font-black text-slate-900 outline-none"
              title="Quantidade de lotes processados ao mesmo tempo"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          {failed.length > 0 && (
            <button
              onClick={retryFailed}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-amber-50 px-3 text-xs font-black uppercase tracking-wide text-amber-700 hover:bg-amber-100"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retentar erros
            </button>
          )}

          <button
            onClick={toggleRun}
            disabled={activeJobs.length === 0}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-xs font-black uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 ${
              isRunning ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {isRunning ? (
              <>
                <Square className="h-3.5 w-3.5 fill-current" />
                Pausar fila
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                Iniciar fila
              </>
            )}
          </button>

          <button
            onClick={clearQueue}
            disabled={jobs.length === 0}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-rose-50 px-3 text-xs font-black uppercase tracking-wide text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Eraser className="h-3.5 w-3.5" />
            Limpar fila
          </button>

          <button
            onClick={() => loadJobs()}
            className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 sm:w-9"
            title="Atualizar fila"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <QueueMetric label="Pendentes" value={pending.length} tone="amber" />
        <QueueMetric label="Em andamento" value={running.length} tone="sky" />
        <QueueMetric label="Com erro" value={failed.length} tone="rose" />
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isRunning ? "bg-emerald-500" : "bg-slate-300"}`}
          style={{ width: `${activeJobs.length === 0 ? 0 : Math.max(5, progressPercent)}%` }}
        />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {activeJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs font-bold text-slate-400">
            Nenhuma tarefa pendente, em andamento ou com erro.
          </div>
        ) : (
          activeJobs.map((job) => <QueueJobRow key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}

function QueueMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "sky" | "rose";
}) {
  const classes = {
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    sky: "bg-sky-50 text-sky-700 border-sky-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
  };
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${classes[tone]}`}>
      <span className="text-base font-black">{value}</span> {label}
    </div>
  );
}

function QueueJobRow({ job }: { job: AiJob; key?: React.Key }) {
  const input = typeof job.input === "string" ? safeJsonParse(job.input) : job.input || {};
  const items = Array.isArray(input.items) ? input.items : [];
  const label = getJobHumanName(job.type);
  const statusLabel = {
    pending: "Pendente",
    running: "Em andamento",
    error: "Erro",
  }[job.status] || job.status;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="font-black text-slate-900">{label}</div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-slate-400">
            {job.type} · alvo: {job.target_id}
          </div>
          {items.length > 0 && (
            <div className="font-bold text-indigo-600">
              {items.length} {items.length === 1 ? "item" : "itens"} neste lote
            </div>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${
            job.status === "running"
              ? "bg-sky-100 text-sky-700"
              : job.status === "error"
                ? "bg-rose-100 text-rose-700"
                : "bg-amber-100 text-amber-700"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {job.error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 p-2 text-[11px] font-semibold text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{job.error}</span>
        </div>
      )}
    </div>
  );
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
