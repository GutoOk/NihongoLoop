import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Eraser,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { PreparationOptions } from "../features/ai/SourcePreparationService";
import { ProcessingRunner } from "../features/ai/ProcessingRunner";
import {
  AiJobRepository,
  ProcessingRunRepository,
  SourcePreparationRepository,
  SourcePreparationStats,
} from "../repositories";
import { AiJob, ProcessingRun } from "../types";
import { useModal } from "./ModalProvider";
import { countJobsByStatus, getJobHumanName } from "./sourcePreparation/jobDisplay";

interface SourcePreparationPanelProps {
  sourceId: string;
  onPreparationComplete: () => void;
}

type PhaseMode = "translate" | "analyze" | "dictionary";

interface PhaseView {
  mode: PhaseMode;
  title: string;
  purpose: string;
  total: number;
  missing: number;
  done: number;
  jobTypes: string[];
}

const DEFAULT_OPTIONS: PreparationOptions = {
  translateBatchSize: 30,
  analyzeBatchSize: 10,
  dictFastBatchSize: 40,
  dictFullBatchSize: 12,
  dictMode: "fast",
  useCache: true,
  overwriteReviewed: false,
  processMode: (localStorage.getItem("ai_process_mode") as "local" | "server") || "server",
  concurrencyLimit: Number(localStorage.getItem("ai_concurrency_limit")) || 3,
};

export default function SourcePreparationPanel({
  sourceId,
  onPreparationComplete,
}: SourcePreparationPanelProps) {
  const [run, setRun] = useState<ProcessingRun | null>(null);
  const [stats, setStats] = useState<SourcePreparationStats | null>(null);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [options, setOptions] = useState<PreparationOptions>(DEFAULT_OPTIONS);
  const [showSettings, setShowSettings] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localRunnerActive, setLocalRunnerActive] = useState(false);
  const loadingRef = useRef(false);
  const { showAlert, showConfirm } = useModal();

  useEffect(() => {
    loadPanel();
    const interval = setInterval(loadPanel, 2000);
    return () => clearInterval(interval);
  }, [sourceId, options.processMode, options.concurrencyLimit]);

  const loadPanel = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [activeRun, latestRun, sourceStats, targetJobs] = await Promise.all([
        ProcessingRunRepository.getActiveRun(sourceId),
        ProcessingRunRepository.getResumableRun(sourceId),
        SourcePreparationRepository.getStats(sourceId),
        AiJobRepository.getByTarget(sourceId),
      ]);
      setRun(activeRun || latestRun);
      setStats(sourceStats);
      setJobs(targetJobs);
      setLocalRunnerActive(ProcessingRunner.isRunning);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message || "Nao foi possivel atualizar a preparacao.");
    } finally {
      loadingRef.current = false;
    }
  };

  const phases = useMemo<PhaseView[]>(() => {
    const s = stats || {
      sTotal: 0,
      sNoTrans: 0,
      sMissingAnalysis: 0,
      dictTotal: 0,
      dictPending: 0,
    } as SourcePreparationStats;
    return [
      {
        mode: "translate",
        title: "Traducao natural",
        purpose: "Criar portugues brasileiro natural por frase. So envia frases sem traducao.",
        total: s.sTotal,
        missing: s.sNoTrans,
        done: Math.max(0, s.sTotal - s.sNoTrans),
        jobTypes: ["batch_translate_sentences"],
      },
      {
        mode: "analyze",
        title: "Leitura e termos",
        purpose: "Gerar kana/romaji e detectar blocos lexicais clicaveis.",
        total: s.sTotal,
        missing: s.sMissingAnalysis,
        done: Math.max(0, s.sTotal - s.sMissingAnalysis),
        jobTypes: ["batch_analyze_sentences"],
      },
      {
        mode: "dictionary",
        title: "Dicionario e sentidos",
        purpose: "Completar verbetes, formas e sentidos apenas para termos usados.",
        total: s.dictTotal || s.dictPending,
        missing: s.dictPending,
        done: Math.max(0, (s.dictTotal || s.dictPending) - s.dictPending),
        jobTypes: ["batch_enrich_dictionary_entries_fast", "batch_enrich_dictionary_entries_full"],
      },
    ];
  }, [stats]);

  const jobCounts = countJobsByStatus(jobs);
  const failedJobs = jobs.filter((job) => job.status === "error");
  const activeJobs = jobs.filter((job) => job.status === "pending" || job.status === "running");
  const isRunActive = run?.status === "pending" || run?.status === "running";
  const isPaused = run?.status === "paused" || run?.status === "cancelled";
  const isDone = phases.every((phase) => phase.missing === 0) && activeJobs.length === 0;
  const totalMissing = phases.reduce((sum, phase) => sum + phase.missing, 0);
  const totalDone = phases.reduce((sum, phase) => sum + phase.done, 0);
  const totalWork = Math.max(1, phases.reduce((sum, phase) => sum + Math.max(phase.total, phase.missing), 0));
  const progressPercent = Math.round((totalDone / totalWork) * 100);

  const start = async (runMode: "all" | PhaseMode = "all") => {
    const runOptions = { ...options, runMode };
    setRun({
      id: run?.id || "starting",
      source_id: sourceId,
      user_id: "",
      status: "pending",
      run_mode: runMode,
      current_step: runMode === "all" ? "Montando plano economico..." : `Montando etapa: ${runMode}`,
      total_steps: 3,
      completed_steps: 0,
      total_items: 0,
      processed_items: 0,
      created_jobs: 0,
      processed_jobs: 0,
      applied_items: 0,
      failed_items: 0,
      cancel_requested: false,
      log: [],
      error: null,
      started_at: null,
      finished_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await ProcessingRunner.startPreparation(sourceId, runOptions, loadPanel);
    loadPanel();
  };

  const resume = async () => {
    const targetRun = run || await ProcessingRunRepository.getResumableRun(sourceId);
    if (targetRun?.id && targetRun.id !== "starting") {
      await ProcessingRunner.resumePreparation(
        sourceId,
        targetRun.id,
        { ...options, runMode: targetRun.run_mode || "all" },
        loadPanel,
      );
    } else {
      await start("all");
    }
    loadPanel();
  };

  const pause = async () => {
    if (!run?.id || run.id === "starting") return;
    await ProcessingRunner.pausePreparation(run.id);
    loadPanel();
  };

  const resetFailed = async () => {
    await AiJobRepository.resetFailedJobsByTarget(sourceId);
    if (run?.id && run.id !== "starting" && run.status === "error") {
      await ProcessingRunRepository.resumeRun(run.id);
    }
    loadPanel();
  };

  const clearQueue = () => {
    showConfirm(
      "Limpar preparacao de IA",
      "Isso apaga runs e jobs desta fonte, mas preserva frases, traducoes, termos e dicionario ja aplicados.",
      async () => {
        if (run?.id && run.id !== "starting" && isRunActive) {
          await ProcessingRunner.cancelPreparation(run.id);
        }
        ProcessingRunner.stop();
        await AiJobRepository.deleteJobsByTarget(sourceId);
        await ProcessingRunRepository.deleteRunsBySource(sourceId);
        setRun(null);
        setJobs([]);
        loadPanel();
      },
      "Limpar fila",
    );
  };

  const deleteJob = async (jobId: string) => {
    await AiJobRepository.delete(jobId);
    loadPanel();
  };

  const retryJob = async (jobId: string) => {
    await AiJobRepository.updateStatus(jobId, { status: "pending", error: null, result: null });
    loadPanel();
  };

  const updateOptions = (patch: Partial<PreparationOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    if (patch.processMode) localStorage.setItem("ai_process_mode", patch.processMode);
    if (patch.concurrencyLimit) localStorage.setItem("ai_concurrency_limit", String(patch.concurrencyLimit));
  };

  return (
    <div className="border-b border-[#E5E5E7] bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900">
                <Sparkles className="h-5 w-5 text-indigo-600" />
                Preparar com IA
              </h2>
              <p className="max-w-2xl text-xs leading-relaxed text-slate-500">
                Pipeline em etapas: traduz primeiro, analisa termos depois e so entao enriquece o dicionario.
                Cada etapa reaproveita o que ja existe e cria jobs apenas para lacunas reais.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowSettings((value) => !value)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                title="Ajustes de economia e velocidade"
              >
                <Settings2 className="h-4 w-4" />
              </button>
              {isRunActive || localRunnerActive ? (
                <button
                  onClick={pause}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-rose-700 hover:bg-rose-100"
                >
                  <Pause className="h-4 w-4" />
                  Pausar
                </button>
              ) : isPaused || run?.status === "error" || activeJobs.length > 0 ? (
                <button
                  onClick={resume}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white hover:bg-emerald-700"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Retomar
                </button>
              ) : (
                <button
                  onClick={() => start("all")}
                  disabled={isDone || totalMissing === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <Zap className="h-4 w-4" />
                  Preparar tudo
                </button>
              )}
              <button
                onClick={onPreparationComplete}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50"
              >
                Estudar
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill run={run} localRunnerActive={localRunnerActive} />
                  {options.processMode === "server" ? (
                    <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-700 ring-1 ring-sky-100">
                      Servidor
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-100">
                      Navegador
                    </span>
                  )}
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                    {options.concurrencyLimit || 3} paralelos
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-700">
                  {run?.current_step || (isDone ? "Tudo pronto para estudar." : "Pronto para montar a fila economica.")}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-slate-900">{progressPercent}%</div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  {totalMissing} pendencias
                </div>
              </div>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${Math.max(isDone ? 100 : 4, progressPercent)}%` }}
              />
            </div>
          </div>

          {showSettings && (
            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <SelectSetting
                label="Execucao"
                value={options.processMode || "server"}
                onChange={(value) => updateOptions({ processMode: value as "local" | "server" })}
                options={[
                  ["server", "Servidor"],
                  ["local", "Navegador"],
                ]}
              />
              <SelectSetting
                label="Paralelos"
                value={String(options.concurrencyLimit || 3)}
                onChange={(value) => updateOptions({ concurrencyLimit: Number(value) })}
                options={[
                  ["1", "1 seguro"],
                  ["2", "2 equilibrado"],
                  ["3", "3 rapido"],
                  ["5", "5 agressivo"],
                ]}
              />
              <SelectSetting
                label="Dicionario"
                value={options.dictMode}
                onChange={(value) => updateOptions({ dictMode: value as "fast" | "full" })}
                options={[
                  ["fast", "Rapido"],
                  ["full", "Completo"],
                ]}
              />
              <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 font-bold text-slate-700">
                Reusar cache
                <input
                  type="checkbox"
                  checked={options.useCache}
                  onChange={(event) => updateOptions({ useCache: event.target.checked })}
                  className="h-4 w-4 rounded text-indigo-600"
                />
              </label>
            </div>
          )}

          {loadError && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {loadError}
            </div>
          )}

          {run?.status === "error" && (
            <div className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{run.error || "A preparacao parou porque um lote falhou."}</span>
              </div>
              <button
                onClick={resetFailed}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 font-black uppercase tracking-wide text-rose-700 ring-1 ring-rose-200"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retentar erros
              </button>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-3">
            {phases.map((phase) => (
              <PhaseCard
                key={phase.mode}
                phase={phase}
                jobs={jobs}
                running={isRunActive || localRunnerActive}
                onStart={() => start(phase.mode)}
              />
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white">
            <button
              onClick={() => setShowQueue((value) => !value)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                {showQueue ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                <Database className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-black text-slate-800">Fila tecnica</span>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5 text-[10px] font-bold">
                <QueueBadge label="Pend" value={jobCounts.pending} tone="amber" />
                <QueueBadge label="Run" value={jobCounts.running} tone="sky" />
                <QueueBadge label="Erro" value={jobCounts.error} tone="rose" />
                <QueueBadge label="Ok" value={jobCounts.completed} tone="emerald" />
              </div>
            </button>

            {showQueue && (
              <div className="border-t border-slate-100 p-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  {failedJobs.length > 0 && (
                    <button
                      onClick={resetFailed}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-indigo-700"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retentar {failedJobs.length} falhas
                    </button>
                  )}
                  <button
                    onClick={clearQueue}
                    className="inline-flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-rose-700"
                  >
                    <Eraser className="h-3.5 w-3.5" />
                    Limpar fila
                  </button>
                </div>

                {jobs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs font-semibold text-slate-400">
                    Nenhum job criado. Inicie uma fase para montar a fila.
                  </div>
                ) : (
                  <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="p-3">Etapa</th>
                          <th className="p-3">Itens</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Mensagem</th>
                          <th className="p-3 text-right">Acoes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {jobs.map((job) => (
                          <tr key={job.id} className="align-top">
                            <td className="p-3 font-bold text-slate-700">{getJobHumanName(job.type)}</td>
                            <td className="p-3 text-slate-500">{job.input?.items?.length || 1}</td>
                            <td className="p-3"><JobStatus status={job.status} /></td>
                            <td className="max-w-md p-3 text-[11px] text-slate-500">{job.error || job.current_step || "Aguardando"}</td>
                            <td className="p-3 text-right">
                              <div className="inline-flex gap-1.5">
                                {job.status === "error" && (
                                  <button
                                    onClick={() => retryJob(job.id)}
                                    className="rounded-lg bg-indigo-50 p-1.5 text-indigo-700"
                                    title="Retentar lote"
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => deleteJob(job.id)}
                                  className="rounded-lg bg-rose-50 p-1.5 text-rose-700"
                                  title="Remover lote"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const PhaseCard: React.FC<{
  phase: PhaseView;
  jobs: AiJob[];
  running: boolean;
  onStart: () => void | Promise<void>;
}> = ({
  phase,
  jobs,
  running,
  onStart,
}) => {
  const phaseJobs = jobs.filter((job) => phase.jobTypes.includes(job.type));
  const hasErrors = phaseJobs.some((job) => job.status === "error");
  const active = phaseJobs.some((job) => job.status === "pending" || job.status === "running");
  const complete = phase.missing === 0;
  const percent = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : complete ? 100 : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {complete ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : active ? (
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            ) : hasErrors ? (
              <AlertCircle className="h-4 w-4 text-rose-600" />
            ) : (
              <Clock className="h-4 w-4 text-slate-400" />
            )}
            <h3 className="text-sm font-black text-slate-900">{phase.title}</h3>
          </div>
          <p className="min-h-10 text-xs leading-relaxed text-slate-500">{phase.purpose}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-black text-slate-900">{percent}%</div>
          <div className="text-[10px] font-bold uppercase text-slate-400">{phase.missing} falta</div>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(complete ? 100 : 4, percent)}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-500">
          {phase.done}/{phase.total || phase.done + phase.missing} prontos
        </span>
        <button
          onClick={onStart}
          disabled={running || complete}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          Fazer etapa
        </button>
      </div>
    </div>
  );
};

const StatusPill: React.FC<{ run: ProcessingRun | null; localRunnerActive: boolean }> = ({ run, localRunnerActive }) => {
  if (localRunnerActive || run?.status === "running" || run?.status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-100">
        <Loader2 className="h-3 w-3 animate-spin" />
        Em execucao
      </span>
    );
  }
  if (run?.status === "paused" || run?.status === "cancelled") {
    return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-100">Pausado</span>;
  }
  if (run?.status === "error") {
    return <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-700 ring-1 ring-rose-100">Erro</span>;
  }
  if (run?.status === "completed") {
    return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">Concluido</span>;
  }
  return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Pronto</span>;
};

function QueueBadge({ label, value, tone }: { label: string; value: number; tone: "amber" | "sky" | "rose" | "emerald" }) {
  const color = {
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    sky: "bg-sky-50 text-sky-700 ring-sky-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  }[tone];
  return <span className={`rounded-full px-2 py-1 ring-1 ${color}`}>{label}: {value}</span>;
}

function JobStatus({ status }: { status: AiJob["status"] }) {
  const tone = status === "error" ? "rose" : status === "running" ? "sky" : status === "completed" ? "emerald" : "amber";
  const color = {
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    sky: "bg-sky-50 text-sky-700 ring-sky-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  }[tone];
  return <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ring-1 ${color}`}>{status}</span>;
}

function SelectSetting({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 font-bold text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-black text-indigo-700"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}
