import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Loader2,
  Settings2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  XCircle,
  Trash2,
  Pause,
  Play,
  Database,
  Clock,
  FileText,
  AlertTriangle,
  Zap,
  Server,
} from "lucide-react";
import { PreparationOptions } from "../features/ai/SourcePreparationService";
import { ProcessingRunner } from "../features/ai/ProcessingRunner";
import {
  ProcessingRunRepository,
  AiJobRepository,
  SourcePreparationRepository,
  SourcePreparationStats,
} from "../repositories";
import { ProcessingRun, AiJob } from "../types";
import { useModal } from "./ModalProvider";
import { countJobsByStatus, getJobHumanName } from "./sourcePreparation/jobDisplay";

interface SourcePreparationPanelProps {
  sourceId: string;
  onPreparationComplete: () => void;
}

export default function SourcePreparationPanel({
  sourceId,
  onPreparationComplete,
}: SourcePreparationPanelProps) {
  const [run, setRun] = useState<ProcessingRun | null>(null);
  const [localRunnerActive, setLocalRunnerActive] = useState(false);
  const [options, setOptions] = useState<PreparationOptions>({
    translateBatchSize: 20,
    analyzeBatchSize: 5,
    dictFastBatchSize: 30,
    dictFullBatchSize: 10,
    dictMode: "full",
    useCache: true,
    overwriteReviewed: false,
    processMode: (localStorage.getItem("ai_process_mode") as "local" | "server") || "server",
    concurrencyLimit: Number(localStorage.getItem("ai_concurrency_limit")) || 3,
  });
  const [showOptions, setShowOptions] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [stats, setStats] = useState<SourcePreparationStats | null>(null);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { showAlert, showConfirm: showModalConfirm } = useModal();
  const loadRunInFlightRef = useRef(false);

  useEffect(() => {
    loadRun();
    const interval = setInterval(loadRun, 2000);
    return () => clearInterval(interval);
  }, [sourceId]);

  const loadRun = async () => {
    if (loadRunInFlightRef.current) return;
    loadRunInFlightRef.current = true;
    try {
      setLocalRunnerActive(ProcessingRunner.isRunning);
      const [active, targetJobs, nextStats] = await Promise.all([
        ProcessingRunRepository.getActiveRun(sourceId),
        AiJobRepository.getByTarget(sourceId),
        SourcePreparationRepository.getStats(sourceId),
      ]);

      if (active) {
        setRun(active);
        // Automatically restore local tracking/coordinating loop silently
        if (!ProcessingRunner.isRunning) {
          ProcessingRunner.resumePreparation(sourceId, active.id, options, loadRun);
        }
      } else {
        const latest = await ProcessingRunRepository.getLatestRunBySource(sourceId);
        setRun(latest);
      }

      setJobs(targetJobs);
      setStats(nextStats);
      setLoadError(null);
    } catch (e: any) {
      console.error("Falha ao atualizar painel de preparação:", e);
      setLoadError(e?.message || "Não foi possível atualizar o status da preparação.");
    } finally {
      loadRunInFlightRef.current = false;
    }
  };

  const handleStartIsolated = async (
    stepMode: "translate" | "analyze" | "dictionary",
  ) => {
    setShowConfirm(false);
    const runOptions: PreparationOptions = {
      ...options,
      runMode: stepMode,
    };
    ProcessingRunner.startPreparation(sourceId, runOptions, loadRun);
    setRun({
      status: "pending",
      current_step: `Iniciando etapa isolada de ${stepMode}...`,
    } as any);
  };

  const handleStartAll = async () => {
    setShowConfirm(false);
    const runOptions: PreparationOptions = {
      ...options,
      runMode: "all",
    };
    ProcessingRunner.startPreparation(sourceId, runOptions, loadRun);
    setRun({
      status: "pending",
      current_step: "Iniciando preparação sequencial completa...",
    } as any);
  };

  const handleCancel = async () => {
    let targetRunId = run?.id;
    if (!targetRunId) {
      const active = await ProcessingRunRepository.getActiveRun(sourceId);
      if (active) targetRunId = active.id;
    }

    if (targetRunId) {
      if (run) setRun({ ...run, status: "cancelled" } as any);
      await ProcessingRunner.cancelPreparation(targetRunId);
      loadRun();
    }
  };

  const handleWipeJobs = () => {
    showModalConfirm(
      "Apagar Fila de IA",
      "Deseja mesmo apagar TODAS as tarefas de IA deste texto? Isso limpará a fila e permitirá que você refaça as solicitações do zero.",
      async () => {
        try {
          await handleCancel();
          ProcessingRunner.stop();
          await AiJobRepository.deleteJobsByTarget(sourceId);
          await ProcessingRunRepository.deleteRunsBySource(sourceId);
          setRun(null);
          setJobs([]);
          showAlert("Sucesso", "Todas as tarefas de IA e execuções desta fonte foram apagadas. Você pode recomeçar do zero!");
          loadRun();
        } catch (e: any) {
          showAlert("Erro", `Falha ao apagar tarefas: ${e.message}`);
        }
      },
      "Apagar Tudo",
    );
  };

  const handleResetFailed = async () => {
    try {
      const ok = await AiJobRepository.resetFailedJobsByTarget(sourceId);
      if (!ok) throw new Error("Não foi possível resetar as tarefas com erro.");

      showAlert(
        "Sucesso",
        "Todas as tarefas com erro foram resetadas para 'Pendente'. O executor local iniciará o processamento.",
      );
      if (!ProcessingRunner.isRunning) {
        ProcessingRunner.startPreparation(sourceId, options, loadRun);
      }
      loadRun();
    } catch (e: any) {
      showAlert("Erro", `Falha ao resetar tarefas falhas: ${e.message}`);
    }
  };

  const handleWipeSingleJob = async (jobId: string) => {
    try {
      await AiJobRepository.delete(jobId);
      loadRun();
    } catch (e: any) {
      showAlert("Erro", `Falha ao apagar tarefa: ${e.message}`);
    }
  };

  const handleRetrySingleJob = async (jobId: string) => {
    try {
      await AiJobRepository.updateStatus(jobId, {
        status: "pending",
        error: null,
        result: null,
      });

      if (!ProcessingRunner.isRunning) {
        ProcessingRunner.startPreparation(sourceId, options, loadRun);
      }
      loadRun();
    } catch (e: any) {
      showAlert("Erro", `Falha ao reiniciar tarefa: ${e.message}`);
    }
  };

  const isRunning = run?.status === "pending" || run?.status === "running";

  // Queue summary stats
  const {
    pending: pendingJobsCount,
    running: runningJobsCount,
    error: errorJobsCount,
    completed: completedJobsCount,
  } = countJobsByStatus(jobs);

  return (
    <div className="bg-white border-b border-[#E5E5E7] p-6 flex flex-col items-center">
      <div className="w-full max-w-5xl bg-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-8 relative">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-8">
          <div>
            <h2 className="text-xl font-black tracking-tight text-slate-800 flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-indigo-600 animate-pulse" />
              Preparar Texto para Estudo
            </h2>
            <p className="text-xs text-[#86868B] mt-1 pr-6 max-w-2xl leading-relaxed">
              Traduza frases, gere leituras furigana, segmente termos e
              enriqueça o dicionário. O sistema reaproveita dados anteriores
              para evitar desperdício e economizar sua cota de IA.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
              Tentativa Única Ativa
            </span>
            {!isRunning && (
              <button
                onClick={() => setShowOptions(!showOptions)}
                className={`p-2.5 rounded-xl border border-slate-200 transition-all ${showOptions ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "bg-white hover:bg-slate-100 text-slate-600"}`}
                title="Configurações avançadas de lotes"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Cota / Spending rule card warning */}
        <div className="mb-6 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-start gap-3 text-xs text-indigo-800">
          <AlertTriangle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div>
            <strong>Regra Anti-Desperdício Ativada:</strong> Caso ocorra
            qualquer erro no processamento das tarefas (como queda de conexão ou
            limite de cota do AI Studio), o executor local é **imediatamente
            interrompido** e não prosseguirá com os próximos lotes,
            salvaguardando seus créditos. Você poderá verificar a causa exata,
            ajustar os filtros e retentar pontualmente pelo painel abaixo.
          </div>
        </div>

        {loadError && (
          <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong>Atualização automática instável:</strong> {loadError}
            </div>
          </div>
        )}

        {/* Options box */}
        {showOptions && !isRunning && (
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-white p-5 rounded-2xl border border-slate-200 animate-in fade-in slide-in-from-top-1">
            <label className="flex items-center justify-between font-medium text-slate-700">
              Média de Frases p/ lote de Tradução:
              <select
                className="bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-mono ml-4"
                value={options.translateBatchSize}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    translateBatchSize: Number(e.target.value),
                  })
                }
              >
                <option value={10}>10 frases</option>
                <option value={20}>20 frases</option>
                <option value={30}>30 frases</option>
                <option value={50}>50 frases</option>
              </select>
            </label>
            <label className="flex items-center justify-between font-medium text-slate-700">
              Média de Frases p/ lote de Leitura (Segmentação):
              <select
                className="bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-mono ml-4"
                value={options.analyzeBatchSize}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    analyzeBatchSize: Number(e.target.value),
                  })
                }
              >
                <option value={5}>5 frases</option>
                <option value={10}>10 frases</option>
                <option value={15}>15 frases</option>
                <option value={25}>25 frases</option>
                <option value={35}>35 frases</option>
              </select>
            </label>

            <label className="flex items-center justify-between font-medium text-slate-700">
              Método de Execução da IA:
              <select
                className="bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-sans font-bold ml-4"
                value={options.processMode || "server"}
                onChange={(e) => {
                  const val = e.target.value as "local" | "server";
                  setOptions({ ...options, processMode: val });
                  localStorage.setItem("ai_process_mode", val);
                }}
              >
                <option value="server">Servidor Supabase (Nuvem — Recomendado)</option>
                <option value="local">Navegador Local (Dispositivo)</option>
              </select>
            </label>

            <label className="flex items-center justify-between font-medium text-slate-700">
              Limite de Concorrência Max:
              <select
                className="bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-sans font-bold ml-4"
                value={options.concurrencyLimit || 3}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setOptions({ ...options, concurrencyLimit: val });
                  localStorage.setItem("ai_concurrency_limit", String(val));
                }}
              >
                <option value={1}>1 por vez (Seguro)</option>
                <option value={2}>2 por vez</option>
                <option value={3}>3 por vez</option>
                <option value={5}>5 por vez (Rápido)</option>
                <option value={8}>8 por vez (Máximo)</option>
              </select>
            </label>

            <div className="flex items-center gap-4 py-1 col-span-1 md:col-span-2">
              <label className="flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.useCache}
                  onChange={(e) =>
                    setOptions({ ...options, useCache: e.target.checked })
                  }
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                Reaproveitar dados existentes no banco (Recomendado)
              </label>
            </div>
          </div>
        )}

        {/* Global running state bar */}
        {isRunning && localRunnerActive && (
          <div className="mb-8 space-y-4 bg-white p-6 rounded-2xl border border-indigo-100 shadow-sm relative overflow-hidden animate-in fade-in">
            <div className="flex flex-col gap-3 mb-3">
              <div className="space-y-1">
                <div className="inline-flex px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold uppercase rounded-md tracking-wider">
                  {run?.current_step || "Iniciando IA..."}
                </div>
                <div className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                  Executor de Fila de IA Ativo
                </div>
              </div>
              {/* Posicionado na linha de baixo para não cortar */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-slate-500">
                <span className="text-xs font-bold uppercase tracking-wider">
                  Fila Processada
                </span>
                <div className="text-lg font-mono font-black text-indigo-600 leading-none">
                  {run?.processed_jobs || 0}{" "}
                  <span className="text-sm text-indigo-300">
                    / {run?.created_jobs || 1} lotes
                  </span>
                </div>
              </div>
            </div>

            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300 animate-pulse"
                style={{
                  width: `${Math.max(5, ((run?.processed_jobs || 0) / Math.max(1, run?.created_jobs || 1)) * 100)}%`,
                }}
              ></div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                className="flex-1 py-2 bg-rose-50 text-rose-600 text-[11px] font-bold uppercase tracking-wider rounded-xl hover:bg-rose-100 transition-colors flex items-center justify-center gap-2"
              >
                <Pause className="w-3.5 h-3.5" />
                Interromper Processamento (Pausar)
              </button>
            </div>
          </div>
        )}

        {/* Locked background executor check */}
        {isRunning && !localRunnerActive && (
          options.processMode === "local" ? (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col gap-3 text-left animate-in fade-in">
              <div className="text-xs text-amber-800 font-medium leading-relaxed flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Status de Processamento Ativo nos registros, mas suspenso neste dispositivo.
              </div>
              <p className="text-[11px] text-slate-600">
                Isso costuma ocorrer se você fechou a janela, mudou de aba ou se o
                celular entrou em descanso. Não se preocupe! Você pode destravar
                ou retomar pontualmente:
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleCancel}
                  className="flex-1 py-1.5 bg-white text-rose-600 border border-rose-200 text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-rose-50 transition-colors"
                >
                  Destravar Status / Limpar Canal
                </button>
                <button
                  onClick={async () => {
                    const runMode = run?.run_mode || "all";
                    ProcessingRunner.startPreparation(
                      sourceId,
                      { ...options, runMode },
                      loadRun,
                    );
                    loadRun();
                  }}
                  className="flex-1 py-1.5 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <RefreshCw className="w-3" />
                  Retomar Processamento de onde parou
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-6 p-4 bg-sky-50 border border-sky-150 rounded-2xl flex flex-col gap-2.5 text-left animate-in fade-in">
              <div className="text-xs text-indigo-950 font-black leading-relaxed flex items-center gap-2">
                <Server className="w-4 h-4 text-indigo-600 animate-pulse shrink-0" />
                Fila de Processamento Ativa na Nuvem (Servidor)
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Suas tarefas de IA estão sendo processadas de forma segura diretamente no servidor Supabase.
                Não há necessidade de manter esta aba aberta ou o celular ligado! Os resultados serão aplicados automaticamente.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleCancel}
                  className="px-4 py-1.5 bg-white text-rose-600 border border-rose-250 text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-rose-50 transition-colors"
                >
                  Interromper Fila (Causar Pausa)
                </button>
                <button
                  onClick={async () => {
                    const runMode = run?.run_mode || "all";
                    ProcessingRunner.resumePreparation(
                      sourceId,
                      run?.id || "",
                      { ...options, runMode },
                      loadRun,
                    );
                    loadRun();
                  }}
                  className="px-4 py-1.5 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <RefreshCw className="w-3 animate-spin" />
                  Sincronizar Progresso / Acompanhar Ao Vivo
                </button>
              </div>
            </div>
          )
        )}

        {/* 1. ISOLATED IA STEPS DIVISION AREAS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 text-left">
          {/* Card 1: Translation */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between shadow-sm relative hover:border-indigo-100 transition-all">
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded">
                  Etapa 1
                </span>
                {stats?.sNoTrans === 0 ? (
                  <span className="text-emerald-500 flex items-center gap-1 text-xs font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Pronto
                  </span>
                ) : (
                  <span className="text-amber-500 font-mono text-xs font-bold bg-amber-50/50 px-2 py-0.5 rounded-full border border-amber-100">
                    Faltam: {stats?.sNoTrans || 0}
                  </span>
                )}
              </div>
              <h3 className="text-sm font-black text-slate-800 mb-1 flex items-center gap-1.5">
                Tradução de Frases
              </h3>
              <p className="text-[11px] text-[#86868B] leading-relaxed mb-4">
                Analisa o contexto em japonês e gera traduções literárias para o
                português.
              </p>
            </div>

            <button
              disabled={isRunning || stats?.sNoTrans === 0}
              onClick={() => handleStartIsolated("translate")}
              className={`w-full py-2 px-3 rounded-xl border font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                stats?.sNoTrans === 0
                  ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-white border-slate-300 hover:bg-amber-50 hover:border-amber-200 text-slate-700 cursor-pointer active:scale-95"
              }`}
            >
              <Play className="w-3 h-3" />
              Processar Tradução com IA
            </button>
          </div>

          {/* Card 2: Leitura & Furigana */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between shadow-sm relative hover:border-indigo-100 transition-all">
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded">
                  Etapa 2
                </span>
                {stats?.sNoRead === 0 && stats?.sNoTerms === 0 ? (
                  <span className="text-emerald-500 flex items-center gap-1 text-xs font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Pronto
                  </span>
                ) : (
                  <span className="text-blue-500 font-mono text-xs font-bold bg-blue-50/50 px-2 py-0.5 rounded-full border border-blue-100">
                    Faltam:{" "}
                    {Math.max(stats?.sNoRead || 0, stats?.sNoTerms || 0)}
                  </span>
                )}
              </div>
              <h3 className="text-sm font-black text-slate-800 mb-1 flex items-center gap-1.5">
                Leitura & Segmentação
              </h3>
              <p className="text-[11px] text-[#86868B] leading-relaxed mb-4">
                Gera leituras (hiragana, romaji) para frases e separa o
                vocabulário em termos isolados.
              </p>
            </div>

            <button
              disabled={
                isRunning || (stats?.sNoRead === 0 && stats?.sNoTerms === 0)
              }
              onClick={() => handleStartIsolated("analyze")}
              className={`w-full py-2 px-3 rounded-xl border font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                stats?.sNoRead === 0 && stats?.sNoTerms === 0
                  ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-white border-slate-300 hover:bg-blue-50 hover:border-blue-200 text-slate-700 cursor-pointer active:scale-95"
              }`}
            >
              <Play className="w-3 h-3" />
              Processar Leituras com IA
            </button>
          </div>

          {/* Card 3: Dictionary */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between shadow-sm relative hover:border-indigo-100 transition-all">
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="bg-rose-50 text-rose-700 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded">
                  Etapa 3
                </span>
                {stats?.dictPending === 0 ? (
                  <span className="text-emerald-500 flex items-center gap-1 text-xs font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Pronto
                  </span>
                ) : (
                  <span className="text-rose-500 font-mono text-xs font-bold bg-rose-50/50 px-2 py-0.5 rounded-full border border-rose-100">
                    S/ Signif: {stats?.dictPending || 0}
                  </span>
                )}
              </div>
              <h3 className="text-sm font-black text-slate-800 mb-1 flex items-center gap-1.5">
                Significados (Dicionário)
              </h3>
              <p className="text-[11px] text-[#86868B] leading-relaxed mb-4">
                Consulta os significados gramaticais detalhados e traduções das
                palavras no vocabulário.
              </p>
            </div>

            <button
              disabled={isRunning || stats?.dictPending === 0}
              onClick={() => handleStartIsolated("dictionary")}
              className={`w-full py-2 px-3 rounded-xl border font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                stats?.dictPending === 0
                  ? "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-white border-slate-300 hover:bg-rose-50 hover:border-rose-200 text-slate-700 cursor-pointer active:scale-95"
              }`}
            >
              <Play className="w-3 h-3" />
              Enriquecer Dicionário IA
            </button>
          </div>
        </div>

        {/* Confirm and main bottom control buttons bar */}
        <div className="border-t border-slate-200 pt-6">
          {showConfirm ? (
            <div className="bg-indigo-50 border border-indigo-150 rounded-2xl p-5 flex flex-col sm:flex-row justify-between items-center gap-4 animate-in fade-in slide-in-from-top-2 text-left">
              <div className="text-xs text-indigo-900 leading-relaxed font-medium">
                <strong>Confirmar preparação sequencial completa?</strong>
                <br />O robô de IA irá executar sequentially todas as três
                etapas anteriores uma após a outra (Tradução → Furigana →
                Dicionário) apenas para o conteúdo que estiver faltando.
              </div>
              <div className="flex gap-2 w-full sm:w-auto shrink-0">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-white text-indigo-600 border border-indigo-200 font-extrabold text-[10px] uppercase tracking-wider rounded-xl hover:bg-indigo-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleStartAll}
                  className="flex-1 sm:flex-initial px-5 py-2.5 bg-indigo-600 text-white font-extrabold text-[10px] uppercase tracking-wider rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  Iniciar Sequência
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              {/* Show Status label and errors */}
              <div className="text-left w-full sm:w-auto">
                {run?.status === "completed" && (
                  <div className="text-xs font-bold text-emerald-600 flex items-center gap-1.5 leading-tight">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Última sequência concluída (
                    {new Date(run.updated_at).toLocaleString()})
                  </div>
                )}
                {run?.status === "cancelled" && (
                  <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5 leading-tight">
                    <XCircle className="w-4 h-4 shrink-0" />
                    Processo interrompido (
                    {new Date(run.updated_at).toLocaleString()})
                  </div>
                )}
                {run?.status === "error" && (
                  <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl text-xs font-semibold text-rose-700 flex flex-col gap-2 max-w-xl animate-in fade-in">
                    <div className="flex items-start gap-1.5">
                      <AlertCircle className="w-4 bg-orange-200 rounded-full text-rose-600 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>Processamento Interrompido por Erro:</strong>{" "}
                        {run.error}
                      </span>
                    </div>

                    {(run.error?.toLowerCase().includes("spending cap") ||
                      run.error?.toLowerCase().includes("resource_exhausted") ||
                      run.error?.toLowerCase().includes("orçamento") ||
                      run.error?.toLowerCase().includes("faturamento") ||
                      run.error?.toLowerCase().includes("limite")) && (
                      <a
                        href="https://ai.studio/spend"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-indigo-700 hover:text-indigo-900 font-bold underline flex items-center gap-1 ml-5 mt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Gerenciar limite de gastos no AI Studio ↗
                      </a>
                    )}
                  </div>
                )}
                {!["completed", "cancelled", "error"].includes(
                  run?.status || "",
                ) && (
                  <div className="text-[11px] text-[#86868B]">
                    Status: Livre. Pronto para receber novas instruções.
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 w-full sm:w-auto shrink-0 justify-end">
                <button
                  onClick={onPreparationComplete}
                  className="flex-1 sm:flex-initial px-6 py-3 bg-white text-slate-700 font-bold text-[11px] uppercase tracking-widest border border-slate-300 rounded-2xl hover:bg-slate-100 transition-colors"
                >
                  Ir para Estudos
                </button>
                <button
                  disabled={
                    isRunning ||
                    (stats?.sNoTrans === 0 &&
                      stats?.sNoRead === 0 &&
                      stats?.dictPending === 0)
                  }
                  onClick={() => setShowConfirm(true)}
                  className={`flex-1 sm:flex-initial px-6 py-3 font-bold text-[11px] uppercase tracking-widest rounded-2xl transition-colors shadow-sm ${
                    isRunning ||
                    (stats?.sNoTrans === 0 &&
                      stats?.sNoRead === 0 &&
                      stats?.dictPending === 0)
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                      : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-600/20 active:scale-95"
                  }`}
                >
                  Preparar Tudo c/ IA
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 2. LIVE FILE LIST AREA ("FILA DE PEDIDOS PARA IA") */}
        <div className="mt-8 pt-8 border-t border-slate-200 text-left">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
            <div>
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
                <Database className="w-4 h-4 text-slate-500" />
                Fila de Pedidos para IA (Lotes de Execução)
              </h3>
              <p className="text-[11px] text-[#86868B] mt-0.5">
                Controle detalhado dos pacotes de dados processados. Caso ocorra
                erro em algum lote, retente-o isoladamente.
              </p>
            </div>

            {/* Queue statistics indicators */}
            <div className="flex flex-wrap gap-2 text-[10px] font-mono">
              <span className="px-2 py-1 rounded bg-slate-200/60 text-slate-700 font-bold">
                Total: {jobs.length}
              </span>
              {pendingJobsCount > 0 && (
                <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 font-bold border border-amber-100 animate-pulse">
                  Pendente: {pendingJobsCount}
                </span>
              )}
              {runningJobsCount > 0 && (
                <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 font-bold border border-blue-100 animate-pulse">
                  Ativo: {runningJobsCount}
                </span>
              )}
              {completedJobsCount > 0 && (
                <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-100">
                  Pronto: {completedJobsCount}
                </span>
              )}
              {errorJobsCount > 0 && (
                <span className="px-2 py-1 rounded bg-rose-50 text-rose-700 font-bold border border-rose-100">
                  Falhos: {errorJobsCount}
                </span>
              )}
            </div>
          </div>

          {/* Queue general controls */}
          {jobs.length > 0 && (
            <div className="flex flex-col lg:flex-row gap-4 mb-5 p-4 bg-slate-100/80 rounded-2xl border border-slate-200/50 items-start lg:items-center justify-between">
              <div className="flex flex-wrap gap-2.5 items-center w-full lg:w-auto">
                {/* Play Button */}
                <button
                  onClick={async () => {
                    const runOptions = { ...options, runMode: "all" as const };
                    await ProcessingRunner.startPreparation(
                      sourceId,
                      runOptions,
                      loadRun,
                    );
                    loadRun();
                  }}
                  disabled={
                    localRunnerActive ||
                    (pendingJobsCount === 0 && errorJobsCount === 0)
                  }
                  className={`px-4 py-2 font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-sm ${
                    localRunnerActive
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer active:scale-95"
                  }`}
                  title="Iniciar ou retomar processamento da fila"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Play (Iniciar)
                </button>

                {/* Stop Button */}
                <button
                  onClick={handleCancel}
                  disabled={!localRunnerActive}
                  className={`px-4 py-2 font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-sm ${
                    !localRunnerActive
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                      : "bg-rose-600 hover:bg-rose-700 text-white cursor-pointer active:scale-95"
                  }`}
                  title="Interromper todas as tarefas em execução"
                >
                  <Pause className="w-4 h-4 fill-current" />
                  Stop (Parar)
                </button>

                {/* divider */}
                <div className="h-6 w-[1px] bg-slate-200 mx-1 hidden sm:block"></div>

                {/* Retentativa de todos os erros */}
                {errorJobsCount > 0 && (
                  <button
                    onClick={handleResetFailed}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-sm cursor-pointer active:scale-95"
                    title="Mudar status de todas as falhas para Pendente"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retentar Todos os Erros ({errorJobsCount})
                  </button>
                )}

                {/* Apagar Fila Inteira */}
                <button
                  onClick={handleWipeJobs}
                  className="px-4 py-2 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-rose-600 font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-sm cursor-pointer"
                  title="Limpar toda a fila e recomeçar do zero"
                >
                  <Trash2 className="w-4 h-4" />
                  Apagar Fila Inteira
                </button>
              </div>

              {/* Live select parameters for play controls */}
              <div className="flex flex-wrap items-center gap-3 bg-white px-3.5 py-1.5 rounded-xl border border-slate-200 shadow-sm text-xs font-semibold text-slate-700 w-full lg:w-auto mt-2 lg:mt-0 justify-between lg:justify-start">
                <div className="flex items-center gap-1.5 cursor-pointer">
                  <Server className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Ambiente:</span>
                  <select
                    className="bg-transparent font-black text-indigo-600 border-none p-0 focus:ring-0 cursor-pointer text-xs"
                    value={options.processMode || "server"}
                    onChange={(e) => {
                      const val = e.target.value as "local" | "server";
                      setOptions({ ...options, processMode: val });
                      localStorage.setItem("ai_process_mode", val);
                      if (ProcessingRunner.isRunning) {
                        ProcessingRunner.stop();
                        const runOptions = { ...options, processMode: val, runMode: "all" as const };
                        ProcessingRunner.startPreparation(sourceId, runOptions, loadRun);
                      }
                    }}
                  >
                    <option value="server">Servidor (Nuvem)</option>
                    <option value="local">Navegador (Local)</option>
                  </select>
                </div>

                <div className="h-4 w-[1px] bg-slate-200 hidden sm:block"></div>

                <div className="flex items-center gap-1.5 cursor-pointer">
                  <Zap className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                  <span>Paralelos:</span>
                  <select
                    className="bg-transparent font-black text-indigo-600 border-none p-0 focus:ring-0 cursor-pointer text-xs"
                    value={options.concurrencyLimit || 3}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setOptions({ ...options, concurrencyLimit: val });
                      localStorage.setItem("ai_concurrency_limit", String(val));
                      if (ProcessingRunner.isRunning) {
                        (ProcessingRunner as any).currentOptions = {
                          ...((ProcessingRunner as any).currentOptions || {}),
                          concurrencyLimit: val,
                        };
                      }
                    }}
                  >
                    <option value={1}>1 tarefa por vez</option>
                    <option value={2}>2 por vez</option>
                    <option value={3}>3 por vez</option>
                    <option value={5}>5 por vez</option>
                    <option value={8}>8 por vez</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {jobs.filter((j) => j.status !== "completed").length === 0 ? (
            <div className="bg-white border border-dashed rounded-3xl p-8 text-center text-xs text-[#86868B] flex flex-col items-center justify-center gap-2 animate-in fade-in">
              {jobs.length > 0 ? (
                <>
                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  <span className="font-extrabold text-slate-700 text-sm">
                    Todas as tarefas da fila foram concluídas com sucesso!
                  </span>
                  <p className="text-[10px] text-slate-400">
                    Os registros concluídos foram limpos da lista para melhor
                    organização de seu foco.
                  </p>
                </>
              ) : (
                <>
                  <FileText className="w-10 h-10 text-slate-300" />
                  <span className="font-extrabold text-slate-700">
                    Nenhuma tarefa de IA agendada para este texto.
                  </span>
                  <p className="text-[10px]">
                    Utilize um dos botões do painel superior para gerar tarefas.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-x-auto overflow-y-auto bg-white max-h-72 shadow-inner">
              <table className="w-full text-left border-collapse text-xs min-w-[750px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[#86868B] font-bold">
                    <th className="p-3">ID Lote</th>
                    <th className="p-3">Tipo de Etapa</th>
                    <th className="p-3">Elementos</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Erro / Meta</th>
                    <th className="p-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {jobs
                    .filter((j) => j.status !== "completed")
                    .map((job) => {
                      const itemCount = job.input?.items?.length || 0;
                      return (
                        <tr
                          key={job.id}
                          className="hover:bg-slate-50 transition-all"
                        >
                          <td
                            className="p-3 text-slate-400 text-[10px] select-all font-mono"
                            title={job.id}
                          >
                            {job.id.substring(0, 8)}...
                          </td>
                          <td className="p-3 font-semibold text-slate-700 font-sans">
                            {getJobHumanName(job.type)}
                          </td>
                          <td className="p-3 font-sans text-slate-500">
                            {itemCount > 0 ? `${itemCount} itens` : "—"}
                          </td>
                          <td className="p-3 font-sans">
                            {job.status === "pending" && (
                              <span className="inline-flex items-center gap-1 py-0.5 px-2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                <Clock className="w-3 h-3" /> Pendente
                              </span>
                            )}
                            {job.status === "running" && (
                              <span className="inline-flex items-center gap-1 py-0.5 px-2 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
                                <Loader2 className="w-3 h-3 animate-spin text-blue-600" />{" "}
                                Processando
                              </span>
                            )}
                            {job.status === "completed" && (
                              <span className="inline-flex items-center gap-1 py-0.5 px-2 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />{" "}
                                Concluído
                              </span>
                            )}
                            {job.status === "cancelled" && (
                              <span className="inline-flex items-center gap-1 py-0.5 px-2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                                <XCircle className="w-3 h-3 text-slate-400" />{" "}
                                Cancelado
                              </span>
                            )}
                            {job.status === "error" && (
                              <span className="inline-flex items-center gap-1 py-0.5 px-2 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                <AlertCircle className="w-3 h-3 text-rose-600" />{" "}
                                Erro
                              </span>
                            )}
                          </td>
                          <td
                            className="p-3 text-[10px] text-slate-500 font-sans max-w-xs break-words"
                            title={job.error}
                          >
                            {job.status === "error" ? (
                              <span className="text-rose-600 font-medium">
                                {job.error}
                                {(job.error
                                  ?.toLowerCase()
                                  .includes("spending cap") ||
                                  job.error
                                    ?.toLowerCase()
                                    .includes("resource_exhausted")) && (
                                  <a
                                    href="https://ai.studio/spend"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 hover:underline block font-semibold mt-0.5"
                                  >
                                    Ver limite no AI Studio ↗
                                  </a>
                                )}
                              </span>
                            ) : job.status === "completed" ? (
                              <span className="text-slate-400">Sucesso</span>
                            ) : (
                              <span className="text-slate-300">Na fila...</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="inline-flex gap-1.5">
                              {job.status === "error" && (
                                <button
                                  onClick={() => handleRetrySingleJob(job.id)}
                                  className="p-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors"
                                  title="Reiniciar somente este lote"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                onClick={() => handleWipeSingleJob(job.id)}
                                className="p-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors"
                                title="Remover este lote da lista"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
