import React, { useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  Search,
  Sparkles,
  Loader2,
  Cpu,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Play,
  Pause,
} from "lucide-react";
import {
  DictionaryRepository,
  SourceRepository,
  SentenceRepository,
  TermRepository,
  AiJobRepository,
} from "../repositories";
import { DictionaryEntry, Source, AiJob } from "../types";
import { AiJobService } from "../services/aiJobService";
import { useModal } from "./ModalProvider";

interface DictionaryScreenProps {
  onBack: () => void;
  onSelectEntry: (entryId: string) => void;
}

function getDictionaryStatusLabel(status: DictionaryEntry["status"] | string) {
  const labels: Record<string, string> = {
    pending: "Pendente",
    ai_enriched: "Enriquecido por IA",
    reviewed: "Revisado",
  };
  return labels[status] || "Sem status";
}

function getDictionaryStatusClass(status: DictionaryEntry["status"] | string) {
  if (status === "pending") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (status === "reviewed") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  return "bg-indigo-50 text-indigo-700 ring-indigo-100";
}

export default function DictionaryScreen({
  onBack,
  onSelectEntry,
}: DictionaryScreenProps) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [types, setTypes] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isQueuing, setIsQueuing] = useState(false);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showErrorsModal, setShowErrorsModal] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { showAlert, showConfirm } = useModal();

  useEffect(() => {
    SourceRepository.getAll().then(setSources);
    loadJobs();
  }, []);

  useEffect(() => {
    loadEntries();
  }, [typeFilter, levelFilter, sourceFilter]);

  // Polling para acompanhar o andamento da fila quando houver jobs ativos (pending ou running)
  useEffect(() => {
    const hasActiveJobs = jobs.some(j => j.status === 'pending' || j.status === 'running');
    const intervalTime = hasActiveJobs ? 2000 : 5000;

    const poll = async () => {
      await loadJobs();
      await loadEntries(true);
    };

    const interval = setInterval(poll, intervalTime);
    return () => clearInterval(interval);
  }, [jobs, sourceFilter, typeFilter, levelFilter]);

  const jobsRef = useRef<AiJob[]>([]);
  const isProcessingRef = useRef(false);
  const isPausedRef = useRef(false);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Processador automático em background das tarefas 'enrich_dictionary_entry'
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const runLoop = async () => {
      // Loop contínuo enquanto o componente estiver montado e não estiver pausado
      while (active && !isPausedRef.current) {
        const pending = jobsRef.current.filter(j => j.status === 'pending');
        
        if (pending.length > 0 && !isProcessingRef.current) {
          isProcessingRef.current = true;
          setIsProcessing(true);
          try {
            // Processa em lotes de 10
            const chunk = pending.slice(0, 10);
            await AiJobService.processJobsBatch(chunk, controller.signal);
            
            // Recarrega silenciosamente se ainda estiver montado
            if (active) {
              await loadJobs();
              await loadEntries(true);
            }
          } catch (err: any) {
            if (err.name !== 'AbortError' && active) {
              console.error("Erro no processamento automático de verbetes:", err);
            }
          } finally {
            isProcessingRef.current = false;
            if (active) {
              setIsProcessing(false);
            }
          }
        }
        
        // Aguarda 1000ms antes de verificar o próximo lote
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    };

    if (!isPaused) {
      runLoop();
    }

    return () => {
      active = false;
      controller.abort();
    };
  }, [isPaused]);

  const loadJobs = async () => {
    try {
      const allJobs = await AiJobRepository.getAll();
      const filtered = allJobs.filter((j) => j.type === "enrich_dictionary_entry");
      setJobs(filtered);
    } catch (e) {
      console.error("Erro ao carregar tarefas do dicionário:", e);
    }
  };

  const loadEntries = async (silent = false) => {
    if (!silent) setLoading(true);
    let data = await DictionaryRepository.getAll();

    if (sourceFilter !== "all") {
      const sentences = await SentenceRepository.getBySourceId(sourceFilter);
      const sentenceIds = sentences.map((s) => s.id);
      const terms = await TermRepository.getBySentences(sentenceIds);
      const validEntryIds = new Set(
        terms.map((t) => t.dictionary_entry_id).filter(Boolean),
      );
      data = data.filter((e) => validEntryIds.has(e.id));
    }

    const totalPending = data.filter((e) => e.status === "pending").length;
    setPendingCount(totalPending);

    const availableTypes = Array.from(
      new Set(data.map((e) => e.type).filter(Boolean)),
    ) as string[];
    const availableLevels = Array.from(
      new Set(data.map((e) => e.jlpt_level).filter(Boolean)),
    ) as string[];

    setTypes(availableTypes.sort());
    setLevels(availableLevels.sort());

    if (typeFilter !== "all") data = data.filter((e) => e.type === typeFilter);
    if (levelFilter !== "all")
      data = data.filter((e) => e.jlpt_level === levelFilter);

    setEntries(data);
    if (!silent) setLoading(false);
  };

  const handleClearDictionary = () => {
    if (entries.length === 0) {
      showAlert("Aviso", "O dicionário já está vazio.");
      return;
    }

    showConfirm(
      "Limpar dicionário",
      "Tem certeza que deseja apagar permanentemente todas as palavras e definições do seu dicionário? Esta ação é irreversível.",
      async () => {
        setLoading(true);
        try {
          const success = await DictionaryRepository.deleteAll();
          if (success) {
            showAlert("Sucesso", "O dicionário foi totalmente limpo.");
            setEntries([]);
            setPendingCount(0);
            await loadJobs();
          } else {
            showAlert("Erro", "Ocorreu um erro ao limpar o dicionário.");
          }
        } catch (e: any) {
          console.error(e);
          showAlert("Erro", `Erro: ${e.message || "Falha ao limpar"}`);
        } finally {
          setLoading(false);
        }
      },
      "Sim, limpar tudo",
    );
  };

  const handleAddToQueue = async () => {
    if (pendingCount === 0) {
      showAlert("Aviso", "Não há palavras pendentes no dicionário.");
      return;
    }

    showConfirm(
      "Completar dicionário",
      `Deseja enviar ${pendingCount} verbetes pendentes para completar o enrichment com IA? Forneça apenas se você deseja forçar a atualização global.`,
      async () => {
        setIsQueuing(true);
        try {
          const allEntries = await DictionaryRepository.getAll();
          const pendings = allEntries.filter((e) => e.status === "pending");

          let count = 0;
          for (const item of pendings) {
            await AiJobService.requestDictionaryEnrichment(item.id, item.lemma);
            count++;
          }
          showAlert(
            "Sucesso",
            `${count} tarefas de enriquecimento foram enviadas à fila de IA. O processamento se iniciará em background automaticamente.`,
          );
          await loadJobs();
          await loadEntries(true);
        } catch (e) {
          console.error(e);
          showAlert("Erro", "Ocorreu um erro ao criar as tarefas.");
        } finally {
          setIsQueuing(false);
        }
      },
      "Completar pendentes",
    );
  };

  const handleResetErroredJobs = async () => {
    const errored = jobs.filter((j) => j.status === "error" || j.status === "cancelled");
    if (errored.length === 0) return;
    setIsQueuing(true);
    try {
      for (const job of errored) {
        await AiJobRepository.updateStatus(job.id, { status: "pending", error: null, result: null });
      }
      showAlert(
        "Fila Reiniciada",
        `${errored.length} tarefas de dicionário com erro foram marcadas para re-tentativa e voltaram para a fila.`
      );
      await loadJobs();
      await loadEntries(true);
    } catch (e: any) {
      console.error(e);
      showAlert("Erro", `Falha ao reiniciar tarefas: ${e.message}`);
    } finally {
      setIsQueuing(false);
    }
  };

  const handleReviewStatuses = async () => {
    setIsQueuing(true);
    try {
      const allEntries = await DictionaryRepository.getAll();
      let updatedCount = 0;
      for (const entry of allEntries) {
        if (entry.status === "reviewed") continue;
        const hasContent = !!(entry.main_meaning || entry.kana || entry.romaji);
        const correctStatus = hasContent ? "ai_enriched" : "pending";
        if (entry.status !== correctStatus) {
          await DictionaryRepository.update(entry.id, { status: correctStatus });
          updatedCount++;
        }
      }
      showAlert(
        "Status Revisados",
        `${updatedCount} verbetes tiveram seus status corrigidos com sucesso com base nas informações salvas no banco de dados.`
      );
      await loadJobs();
      await loadEntries(true);
    } catch (e: any) {
      console.error(e);
      showAlert("Erro", `Erro ao revisar status: ${e.message || "Falha ao revisar status"}`);
    } finally {
      setIsQueuing(false);
    }
  };

  const pendingJobs = jobs.filter((j) => j.status === "pending");
  const runningJobs = jobs.filter((j) => j.status === "running");
  const erroredJobs = jobs.filter((j) => j.status === "error" || j.status === "cancelled");
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const lastErrorMsg = erroredJobs.find((j) => j.error)?.error || null;

  const totalActiveQueue = pendingJobs.length + runningJobs.length + erroredJobs.length + completedJobs.length;
  const progressPercent = totalActiveQueue > 0 ? Math.round((completedJobs.length / totalActiveQueue) * 100) : 0;
  const isQueueActive = runningJobs.length > 0 || isProcessing;

  const getJobWordLabel = (job: AiJob) => {
    const entry = entries.find((e) => e.id === job.target_id);
    if (entry) return entry.lemma;
    if (job.input && typeof job.input === "object" && "lemma" in job.input) {
      return (job.input as any).lemma;
    }
    return `ID: ${job.target_id.slice(0, 8)}...`;
  };

  return (
    <div className="screen">
      <header className="screen-header flex-col gap-2 items-stretch">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="btn-back"
              aria-label="Voltar"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="screen-title">Dicionário</h1>
          </div>

          <button
            type="button"
            onClick={handleClearDictionary}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[11px] font-bold rounded-xl transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpar
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 pb-1 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] sm:items-center">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="w-full min-w-0 truncate rounded-xl border border-[#E5E5E7] bg-slate-50 px-3 py-1.5 font-bold text-[#86868B] outline-none"
          >
            <option value="all">Fonte (Todas)</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || "Fonte sem título"}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full rounded-xl border border-[#E5E5E7] bg-slate-50 px-3 py-1.5 font-bold text-[#86868B] outline-none"
          >
            <option value="all">Tipos (Todos)</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="w-full rounded-xl border border-[#E5E5E7] bg-slate-50 px-3 py-1.5 font-bold text-[#86868B] outline-none"
          >
            <option value="all">Nível (Todos)</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <span className="text-gray-400 font-bold whitespace-nowrap sm:text-right">
            {entries.length} {entries.length === 1 ? "palavra" : "palavras"}
          </span>
        </div>
      </header>

      <div className="mx-4 mt-3 mb-1 bg-white border border-[#E5E5E7] rounded-2xl p-4 shadow-sm space-y-4 shrink-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-[#1D1D1F]">
              <Cpu className="h-4 w-4 text-indigo-600 animate-pulse" />
              Completar Dicionário com IA
            </h2>
            <p className="text-[11px] leading-relaxed text-[#86868B]">
              Enriqueça os verbetes pendentes no dicionário em lote. Quando há tarefas pendentes, o processamento ocorre automaticamente em segundo plano nesta tela.
            </p>
          </div>

          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold leading-none w-fit self-start shrink-0">
            {isQueueActive ? (
              <span className="inline-flex items-center gap-1.5 bg-sky-50 text-sky-700 rounded-full px-2 py-0.5">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Processando...
              </span>
            ) : erroredJobs.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-700 rounded-full px-2 py-0.5">
                <AlertTriangle className="h-3 w-3" />
                Fila com Erros
              </span>
            ) : pendingJobs.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
                <Loader2 className="h-3 w-3 animate-bounce" />
                Aguardando Fila
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">
                <CheckCircle2 className="h-3 w-3" />
                Fila Concluída / Ociosa
              </span>
            )}
          </div>
        </div>

        {/* Informações de progresso do preenchimento */}
        {totalActiveQueue > 0 ? (
          <div className="space-y-3 bg-slate-50/60 p-3 rounded-xl border border-slate-100">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-600">Progresso do enriquecimento:</span>
              <span className="text-[#1D1D1F] font-black">{progressPercent}% ({completedJobs.length} de {totalActiveQueue})</span>
            </div>
            
            <div className="h-2 w-full bg-slate-200/60 rounded-full overflow-hidden">
              <div 
                className="h-full bg-indigo-600 transition-all duration-500 rounded-full shadow-inner" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="grid grid-cols-4 gap-1.5 pt-1 text-[10px] text-center font-bold">
              <div className="bg-amber-100/60 text-amber-800 px-1 py-1.5 rounded-lg border border-amber-200/40 flex flex-col justify-center">
                <div className="text-xs">{pendingJobs.length}</div>
                <div className="text-[8px] uppercase tracking-wider text-amber-600 mt-0.5">Pendentes</div>
              </div>
              <div className="bg-sky-100/60 text-sky-800 px-1 py-1.5 rounded-lg border border-sky-200/40 flex flex-col justify-center">
                <div className="text-xs">{runningJobs.length}</div>
                <div className="text-[8px] uppercase tracking-wider text-sky-600 mt-0.5">Rodando</div>
              </div>
              <div className="bg-emerald-100/60 text-emerald-800 px-1 py-1.5 rounded-lg border border-emerald-200/40 flex flex-col justify-center">
                <div className="text-xs">{completedJobs.length}</div>
                <div className="text-[8px] uppercase tracking-wider text-emerald-600 mt-0.5">Sucesso</div>
              </div>
              <button
                type="button"
                onClick={() => erroredJobs.length > 0 && setShowErrorsModal(true)}
                disabled={erroredJobs.length === 0}
                className={`flex flex-col items-center justify-center px-1 py-1.5 rounded-lg border leading-tight transition-colors ${
                  erroredJobs.length > 0
                    ? "bg-rose-100 hover:bg-rose-200 text-rose-805 border-rose-300 font-bold cursor-pointer"
                    : "bg-rose-100/40 text-rose-800/60 border-rose-200/40 cursor-not-allowed"
                }`}
                title={erroredJobs.length > 0 ? "Clique para ver histórico de falhas" : undefined}
              >
                <div className="text-xs font-bold">{erroredJobs.length}</div>
                <div className="text-[8px] uppercase tracking-wider text-rose-605 mt-0.5 flex items-center gap-0.5 underline">
                  Falhas {erroredJobs.length > 0 && "🔍"}
                </div>
              </button>
            </div>

            {lastErrorMsg && (
              <div className="bg-rose-50 border border-rose-100 p-2.5 rounded-xl text-rose-800 text-[11px] leading-relaxed space-y-1">
                <div className="font-bold flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
                  Falha identificada na fila de IA:
                </div>
                <p className="font-semibold text-rose-700/90">{lastErrorMsg}</p>
                {erroredJobs.length > 0 && (
                  <button
                    onClick={() => setShowErrorsModal(true)}
                    className="text-[10px] text-rose-800 font-bold underline hover:text-rose-955 transition-colors text-left block mt-1"
                  >
                    Ver detalhes de todas as {erroredJobs.length} falhas &rarr;
                  </button>
                )}
              </div>
            )}

            {(pendingJobs.length + runningJobs.length + erroredJobs.length > 0) && (
              <div className="space-y-2 bg-indigo-50/30 p-2.5 rounded-xl border border-indigo-100/40">
                <p className="text-[10.5px] text-indigo-700 font-bold flex items-center gap-1.5 leading-normal">
                  {pendingJobs.length + runningJobs.length > 0 ? (
                    <>
                      <Loader2 className={`h-3.5 w-3.5 shrink-0 text-indigo-600 ${isPaused ? "" : "animate-spin"}`} />
                      {isPaused 
                        ? "Processamento em segundo plano pausado pelo usuário." 
                        : "Processamento automático ativo em segundo plano! Deixe esta tela aberta."
                      }
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                      Fila sem tarefas executivas ativas, mas contém falhas que impediram a conclusão.
                    </>
                  )}
                </p>
                
                <div className="flex gap-2 pt-0.5">
                  {(pendingJobs.length + runningJobs.length > 0) && (
                    isPaused ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsPaused(false);
                          isPausedRef.current = false;
                        }}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black py-1.5 px-2 transition-colors uppercase tracking-wider"
                      >
                        <Play className="h-3 w-3" />
                        Retomar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsPaused(true);
                          isPausedRef.current = true;
                          abortControllerRef.current?.abort();
                          setIsProcessing(false);
                        }}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black py-1.5 px-2 transition-colors uppercase tracking-wider"
                      >
                        <Pause className="h-3 w-3" />
                        Pausar / Parar
                      </button>
                    )
                  )}
                  
                  <button
                    type="button"
                    onClick={async () => {
                      showConfirm(
                        "Cancelar e Limpar Fila",
                        "Deseja parar tudo, cancelar o processamento ativo, limpar a fila inteira e remover de vez todos os erros da tela?",
                        async () => {
                          setIsQueuing(true);
                          setIsPaused(true);
                          isPausedRef.current = true;
                          // Clear the local state instantly so the UI elements, progress bar and error messages reset immediately
                          setJobs([]);
                          
                          try {
                            // Para processos ativos em background
                            abortControllerRef.current?.abort();
                            setIsProcessing(false);
                            
                            // Remove todas as tarefas de IA desta categoria da tabela do Supabase (limpando erros e pendentes)
                            await AiJobRepository.deleteJobsByType("enrich_dictionary_entry");
                            
                            // Recarrega os jobs e as palavras do dicionário na tela
                            await loadJobs();
                            await loadEntries(true);
                            showAlert("Sucesso", "Todas as tarefas ativas foram paradas e a fila/erros foram completamente zerados.");
                          } catch (err: any) {
                            showAlert("Erro", `Erro ao cancelar e limpar fila: ${err.message}`);
                          } finally {
                            setIsQueuing(false);
                          }
                        }
                      );
                    }}
                    className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-[#E5E5E7] bg-white hover:bg-gray-50 text-slate-700 text-[10px] font-black py-1.5 px-2 transition-colors uppercase tracking-wider"
                  >
                    <Trash2 className="h-3 w-3 text-slate-500" />
                    Cancelar e Limpar
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] leading-relaxed text-[#86868B] bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            Nenhuma tarefa cadastrada no momento. Clique em <strong>Completar pendentes</strong> abaixo se houver verbetes para enriquecer.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={handleAddToQueue}
            disabled={isQueuing || pendingCount === 0}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white text-xs font-bold px-3 py-2 transition-all shadow-sm"
          >
            {isQueuing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {isQueuing ? "Analisando..." : `Completar pendentes (${pendingCount})`}
          </button>

          {erroredJobs.length > 0 && (
            <button
              onClick={handleResetErroredJobs}
              disabled={isQueuing}
              className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold px-3 py-2 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5 text-rose-600" />
              Tentar Novamente Erros ({erroredJobs.length})
            </button>
          )}

          <button
            onClick={handleReviewStatuses}
            disabled={isQueuing}
            className="flex items-center gap-1.5 rounded-xl border border-[#E5E5E7] bg-white hover:bg-gray-50 text-slate-700 text-xs font-bold px-3 py-2 transition-all ml-auto"
          >
            <RefreshCw className="w-3.5 h-3.5 text-indigo-600" />
            Revisar Status
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-auto p-4 space-y-2">
        {loading ? (
          <div className="empty-state">
            <span className="spinner text-[#86868B]" />
            <span className="text-sm text-[#86868B]">Carregando...</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search className="w-7 h-7 text-[#86868B]" />
            </div>
            <p className="text-sm text-[#86868B]">Nenhum termo encontrado.</p>
          </div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelectEntry(entry.id)}
              className="w-full bg-white border border-[#E5E5E7] p-3 text-left rounded-xl hover:border-indigo-300 transition-colors"
            >
              <div className="space-y-1">
                <h3 className="text-base font-bold text-[#1D1D1F]">
                  {entry.lemma}
                </h3>
                {entry.kana && (
                  <p className="text-[10px] text-[#86868B]">{entry.kana}</p>
                )}
                <p className="text-[11px] text-[#86868B]">
                  {entry.main_meaning || "Sem significado principal"}
                </p>
                <span
                  className={`inline-flex w-fit rounded px-2 py-0.5 text-[9px] font-bold uppercase ring-1 ${getDictionaryStatusClass(entry.status)}`}
                >
                  {getDictionaryStatusLabel(entry.status)}
                </span>
              </div>
            </button>
          ))
        )}
      </main>

      {showErrorsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl transition-all border border-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-rose-100 px-4 py-3 bg-rose-50/50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <h3 className="text-sm font-black text-rose-950 uppercase tracking-wider">
                  Tarefas com Falha ({erroredJobs.length})
                </h3>
              </div>
              <button
                onClick={() => setShowErrorsModal(false)}
                className="rounded-lg p-1 text-rose-700 hover:bg-rose-100 transition-colors text-xs font-black uppercase tracking-wider px-2 py-1"
                title="Fechar"
              >
                Fechar
              </button>
            </div>

            {/* Content (Scrollable List) */}
            <div className="max-h-[350px] overflow-y-auto p-4 space-y-3">
              <p className="text-[11px] leading-relaxed text-slate-500 font-medium">
                Se os erros forem decorrentes de limites ou faturamento no Google AI Studio (ex: 429 Resource Exhausted), adicione fundos no painel ou reduza a fila. Você pode reiniciar as tarefas com erro usando o botão correspondente.
              </p>

              <div className="space-y-2">
                {erroredJobs.map((job) => {
                  const lemma = getJobWordLabel(job);
                  return (
                    <div 
                      key={job.id} 
                      className="border border-[#E5E5E7] rounded-xl p-3 bg-slate-50 space-y-1.5 hover:border-rose-200 transition-all text-left"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-900 bg-white border border-[#E5E5E7] px-2 py-0.5 rounded-md">
                          {lemma}
                        </span>
                        <span className="text-[9px] font-black uppercase text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                          {job.status === "cancelled" ? "Cancelado" : "Erro"}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#86868B] font-medium leading-relaxed font-mono bg-white p-2 rounded-lg border border-slate-100 break-words max-h-24 overflow-y-auto">
                        {job.error || "Erro misterioso sem descrição registrada."}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
              <button
                onClick={async () => {
                  setShowErrorsModal(false);
                  await handleResetErroredJobs();
                }}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black py-2 px-3 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reprocessar Todos ({erroredJobs.length})
              </button>
              <button
                onClick={() => setShowErrorsModal(false)}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold py-2 px-3 transition-colors"
              >
                Fechar Painel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
