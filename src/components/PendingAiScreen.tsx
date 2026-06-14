import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Sparkles,
  RefreshCw,
  Cpu,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Trash2,
  CheckSquare,
  Square,
  ListFilter,
} from "lucide-react";
import { AiJobRepository } from "../repositories";
import { AiJobService } from "../services/aiJobService";
import { AiJob } from "../types";
import { useModal } from "./ModalProvider";

interface PendingAiScreenProps {
  onBack: () => void;
}

export default function PendingAiScreen({ onBack }: PendingAiScreenProps) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processingMessage, setProcessingMessage] = useState<string | null>(
    null,
  );
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const { showConfirm, showAlert } = useModal();

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    setLoading(true);
    const data = await AiJobRepository.getAll();
    // Os completos devem sumir da fila de exibição
    const activeJobs = data.filter((j) => j.status !== "completed");
    setJobs(activeJobs);
    setLoading(false);
  };

  const statusColors = {
    pending: "bg-amber-50 text-amber-600 border border-amber-100",
    running: "bg-blue-50 text-blue-600 border border-blue-100",
    completed: "bg-emerald-50 text-emerald-600 border border-emerald-100",
    error: "bg-rose-50 text-rose-600 border border-rose-100",
    rejected: "bg-slate-50 text-slate-500 border border-slate-100",
    cancelled: "bg-rose-50 text-rose-600 border border-rose-100",
  };

  const statusIcons = {
    pending: <AlertTriangle className="w-3.5 h-3.5" />,
    running: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
    completed: <CheckCircle2 className="w-3.5 h-3.5" />,
    error: <XCircle className="w-3.5 h-3.5" />,
    rejected: <XCircle className="w-3.5 h-3.5" />,
    cancelled: <XCircle className="w-3.5 h-3.5" />,
  };

  const toggleSelectJob = (jobId: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const actionableJobs = jobs.filter(
      (j) => j.status !== "running" && j.status !== "completed",
    );
    if (selectedJobIds.size === actionableJobs.length) {
      setSelectedJobIds(new Set()); // deselect all
    } else {
      setSelectedJobIds(new Set(actionableJobs.map((j) => j.id))); // select all
    }
  };

  const runBatchProcess = async (pendingJobs: AiJob[]) => {
    // Agrupa os jobs por tipo para otimizar tokens de IA com consultas inteligentes
    const groups: Record<string, AiJob[]> = {};
    for (const job of pendingJobs) {
      if (!groups[job.type]) {
        groups[job.type] = [];
      }
      groups[job.type].push(job);
    }

    // Processa lote por lote de forma otimizada
    for (const type in groups) {
      const groupJobs = groups[type];
      let limit = 15;
      if (type === "translate_sentence") {
        limit = 30;
      } else if (type === "enrich_dictionary_entry") {
        limit = 15;
      } else if (type === "generate_sentence_reading") {
        limit = 15;
      }

      if (type.startsWith("batch_")) {
        limit = 1;
      }

      for (let i = 0; i < groupJobs.length; i += limit) {
        const chunk = groupJobs.slice(i, i + limit);
        const currentBatchNum = Math.floor(i / limit) + 1;
        const totalBatches = Math.ceil(groupJobs.length / limit);

        let label = type;
        if (type === "translate_sentence") label = "Traduções";
        else if (type === "generate_sentence_reading") label = "Leituras";
        else if (type === "enrich_dictionary_entry") label = "Dicionário";

        setProcessingMessage(
          `Enviando ${label}: Lote ${currentBatchNum}/${totalBatches} (${chunk.length} itens)`,
        );

        await AiJobService.processJobsBatch(chunk);
      }
    }
  };

  const processAllPending = async () => {
    let pending = jobs.filter((j) => j.status === "pending");
    if (pending.length === 0) return;

    try {
      setProcessingId("batch");
      await runBatchProcess(pending);

      // Verifica se novas tarefas de enriquecimento foram geradas em cascata
      const updatedJobs = await AiJobRepository.getAll();
      const newEnrichPending = updatedJobs.filter(
        (j) => j.status === "pending" && j.type === "enrich_dictionary_entry",
      );
      if (newEnrichPending.length > 0) {
        await runBatchProcess(newEnrichPending);
      }
    } catch (e: any) {
      console.error("Error in processAllPending:", e);
      showAlert(
        "Erro",
        `Falha ao processar: ${e.message || "Erro desconhecido"}`,
      );
    } finally {
      setProcessingMessage(null);
      setProcessingId(null);
      setSelectedJobIds(new Set());
      loadJobs();
    }
  };

  const processSelected = async () => {
    const selectedJobsList = jobs.filter(
      (j) =>
        selectedJobIds.has(j.id) &&
        j.status !== "running" &&
        j.status !== "completed",
    );
    if (selectedJobsList.length === 0) return;

    try {
      setProcessingId("selected_batch");
      setProcessingMessage(`Preparando ${selectedJobsList.length} itens...`);

      // Reseta erros para pendente antes de rodar
      for (const job of selectedJobsList) {
        if (job.status === "error") {
          await AiJobRepository.updateStatus(job.id, {
            status: "pending",
            error: null,
          });
        }
      }

      // Recarrega todos para obter as referências corretas atualizadas
      const reloaded = await AiJobRepository.getAll();
      const nextPending = reloaded.filter(
        (j) => selectedJobIds.has(j.id) && j.status === "pending",
      );

      await runBatchProcess(nextPending);
    } catch (e: any) {
      console.error(e);
      showAlert(
        "Erro",
        `Falha ao processar itens selecionados: ${e.message || "Erro desconhecido"}`,
      );
    } finally {
      setProcessingMessage(null);
      setProcessingId(null);
      setSelectedJobIds(new Set());
      loadJobs();
    }
  };

  const deleteSelected = () => {
    if (selectedJobIds.size === 0) return;
    showConfirm(
      "Remover Selecionados",
      `Deseja realmente remover estes ${selectedJobIds.size} itens selecionados da fila de processamento?`,
      async () => {
        setProcessingId("delete_selected");
        for (const id of Array.from(selectedJobIds) as string[]) {
          await AiJobRepository.delete(id);
        }
        setProcessingId(null);
        setSelectedJobIds(new Set());
        loadJobs();
      },
      "Remover Selecionados",
    );
  };

  const retryAllFailed = async () => {
    const failedJobs = jobs.filter((j) => j.status === "error");
    if (failedJobs.length === 0) return;

    try {
      setProcessingId("retry_failed");
      setProcessingMessage("Resetando erros...");
      await AiJobRepository.resetFailedJobs();

      // Recarrega todos os jobs ativos
      const data = await AiJobRepository.getAll();
      const activeJobs = data.filter((j) => j.status !== "completed");
      setJobs(activeJobs);

      const pending = activeJobs.filter((j) => j.status === "pending");
      if (pending.length > 0) {
        await runBatchProcess(pending);
      }

      // Verifica se novas tarefas de enriquecimento foram geradas em cascata
      const updatedJobs = await AiJobRepository.getAll();
      const newEnrichPending = updatedJobs.filter(
        (j) => j.status === "pending" && j.type === "enrich_dictionary_entry",
      );
      if (newEnrichPending.length > 0) {
        await runBatchProcess(newEnrichPending);
      }
    } catch (e: any) {
      console.error(e);
      showAlert(
        "Erro",
        `Falha ao tentar novamente: ${e.message || "Erro desconhecido"}`,
      );
    } finally {
      setProcessingMessage(null);
      setProcessingId(null);
      setSelectedJobIds(new Set());
      loadJobs();
    }
  };

  const resetRunningJobs = async () => {
    const runningJobs = jobs.filter((j) => j.status === "running");
    if (runningJobs.length === 0) return;

    setProcessingId("reset_running");
    try {
      for (const job of runningJobs) {
        await AiJobRepository.updateStatus(job.id, {
          status: "pending",
          error: null,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setProcessingId(null);
      loadJobs();
    }
  };

  const clearJobs = () => {
    showConfirm(
      "Limpar Tarefas",
      "Tem certeza que deseja apagar todas as tarefas da fila de IA? Isso não pode ser desfeito.",
      async () => {
        setProcessingId("clear");
        await AiJobRepository.deleteAll();
        setProcessingId(null);
        setSelectedJobIds(new Set());
        loadJobs();
      },
      "Limpar Tudo",
    );
  };

  const processSingle = async (job: AiJob) => {
    if (job.status === "running" || job.status === "completed") return;
    setProcessingId(job.id);
    await AiJobService.processJob(job);
    setProcessingId(null);
    loadJobs();
  };

  const actionableJobsCount = jobs.filter(
    (j) => j.status !== "running" && j.status !== "completed",
  ).length;

  return (
    <div className="flex flex-col h-full bg-[#F5F5F7] text-[#1D1D1F] relative">
      <header className="px-4 py-4 bg-white border-b border-[#E5E5E7] flex flex-col shrink-0 sticky top-0 z-10 space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 -ml-2 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-sm font-black uppercase tracking-widest text-[#1D1D1F]">
              Central de IA
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={clearJobs}
              disabled={jobs.length === 0 || processingId !== null}
              className="text-rose-600 p-2 disabled:opacity-50 hover:bg-rose-50 rounded-full transition-colors"
              title="Limpar todas as tarefas"
            >
              <Trash2 className="w-4.5 h-4.5" />
            </button>
            <button
              onClick={loadJobs}
              className="text-indigo-600 p-2 hover:bg-indigo-50 rounded-full transition-colors"
              title="Sincronizar fila"
            >
              <RefreshCw
                className={`w-4.5 h-4.5 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Header action selectors */}
        <div className="grid grid-cols-1 gap-2 pt-1 pb-1">
          <button
            onClick={processAllPending}
            disabled={
              processingId !== null ||
              jobs.filter((j) => j.status === "pending").length === 0
            }
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl shadow-sm font-black text-xs uppercase tracking-widest flex justify-center items-center gap-2 transition-all active:scale-98"
          >
            <Sparkles className="w-4 h-4 text-indigo-200" />
            {processingId && processingId === "batch"
              ? processingMessage || "Processando..."
              : "Processar Todo o Restante"}
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSelectAll}
              disabled={actionableJobsCount === 0 || processingId !== null}
              className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 disabled:opacity-40 transition-colors"
            >
              {actionableJobsCount > 0 &&
              selectedJobIds.size === actionableJobsCount ? (
                <CheckSquare className="w-4 h-4 text-indigo-600" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              <span>
                {selectedJobIds.size === actionableJobsCount &&
                actionableJobsCount > 0
                  ? "Desmarcar Todos"
                  : "Selecionar Todos Ativos"}
              </span>
            </button>
          </div>
          <span className="text-[10px] uppercase font-black tracking-wider text-slate-400">
            {jobs.length} Fila Ativa
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-3 pb-32">
        {jobs.length === 0 && !loading && (
          <div className="text-center py-20 text-gray-400">
            <Cpu className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm font-bold">Nenhuma tarefa de IA na fila</p>
          </div>
        )}

        {jobs.map((job) => {
          const isSelected = selectedJobIds.has(job.id);
          const isActionable =
            job.status !== "running" && job.status !== "completed";

          return (
            <div
              key={job.id}
              onClick={() => isActionable && toggleSelectJob(job.id)}
              className={`bg-white border rounded-xl p-4 shadow-sm flex gap-3.5 items-start transition-all cursor-pointer ${
                isSelected
                  ? "border-indigo-400 ring-2 ring-indigo-50 bg-indigo-50/10"
                  : "border-[#E5E5E7] hover:border-slate-300"
              }`}
            >
              {/* Select checkbox */}
              {isActionable && (
                <div
                  className="pt-0.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => toggleSelectJob(job.id)}
                    className="text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100 rounded"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4.5 h-4.5 text-indigo-600 fill-indigo-50/50" />
                    ) : (
                      <Square className="w-4.5 h-4.5 text-slate-350 hover:text-indigo-600" />
                    )}
                  </button>
                </div>
              )}

              {/* Main content */}
              <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">
                      Tipo de Processamento
                    </span>
                    <h3 className="text-xs font-black font-mono text-slate-800 uppercase truncate">
                      {job.type}
                    </h3>
                    <p className="text-[9.5px] text-gray-400 font-medium">
                      Alvo: {job.target_type} ({job.target_id.slice(0, 6)}...)
                    </p>
                  </div>
                  <span
                    className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 shrink-0 flex items-center gap-1 rounded-full ${statusColors[job.status as keyof typeof statusColors]}`}
                  >
                    {statusIcons[job.status as keyof typeof statusIcons]}{" "}
                    {job.status}
                  </span>
                </div>

                {job.input && (
                  <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-lg text-[10.5px] font-mono text-slate-600 break-words font-semibold">
                    {(() => {
                      try {
                        return (
                          job.input.sentence ||
                          job.input.lemma ||
                          JSON.stringify(job.input)
                        );
                      } catch {
                        return JSON.stringify(job.input);
                      }
                    })()}
                  </div>
                )}

                {job.error && (
                  <div
                    className="text-[9px] text-rose-600 font-semibold font-mono bg-rose-50/50 border border-rose-100 p-2 rounded cursor-pointer hover:bg-rose-100 transition-colors line-clamp-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      showAlert(
                        "Detalhes do Erro",
                        job.error || "Erro desconhecido",
                      );
                    }}
                  >
                    <span className="font-bold uppercase tracking-wider block text-[8px] text-rose-550 mb-0.5">
                      Erro detectado (Clique p/ detalhes):
                    </span>
                    {job.error}
                  </div>
                )}

                {job.status !== "running" && job.status !== "completed" && (
                  <div
                    className="flex justify-end pt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {job.status === "error" ? (
                      <button
                        onClick={async () => {
                          await AiJobRepository.updateStatus(job.id, {
                            status: "pending",
                            error: null,
                          });
                          loadJobs();
                          processSingle({
                            ...job,
                            status: "pending",
                            error: null,
                          });
                        }}
                        disabled={processingId !== null}
                        className="text-rose-600 bg-rose-50 border border-rose-100 hover:bg-rose-100 px-3 py-1.5 rounded-lg text-[9.5px] font-black uppercase disabled:opacity-50 flex gap-1 items-center transition-all active:scale-95"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${processingId === job.id ? "animate-spin" : ""}`}
                        />{" "}
                        Recomeçar
                      </button>
                    ) : (
                      <button
                        onClick={() => processSingle(job)}
                        disabled={processingId !== null}
                        className="text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 px-3 py-1.5 rounded-lg text-[9.5px] font-black uppercase disabled:opacity-50 flex gap-1 items-center transition-all active:scale-95"
                      >
                        <Play className="w-3 h-3 fill-indigo-600" /> Processar
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </main>

      {/* Floating Action Menu for multi-select */}
      {selectedJobIds.size > 0 && (
        <div className="absolute bottom-4 inset-x-4 bg-slate-900 border border-slate-800 text-white rounded-2xl py-3.5 px-4 shadow-2xl flex items-center justify-between z-50 animate-bounce-subtle">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">
              Selecionados
            </span>
            <span className="text-xs font-black text-indigo-400">
              {selectedJobIds.size} tarefas
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={deleteSelected}
              disabled={processingId !== null}
              className="text-rose-450 hover:text-rose-400 font-extrabold text-[10px] uppercase tracking-widest px-2.5 py-2 hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-40"
            >
              Remover
            </button>
            <button
              onClick={processSelected}
              disabled={processingId !== null}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[10px] uppercase tracking-widest px-4 py-2.5 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-40 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Processar</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
