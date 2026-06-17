import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Cpu,
  Library,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  AiJobRepository,
  DictionaryRepository,
  SentenceRepository,
  SourceRepository,
  TermRepository,
} from "../repositories";
import { DictionaryEntry, Source } from "../types";
import { useModal } from "./ModalProvider";
import { GlobalAiQueueControl } from "./GlobalAiQueueControl";

export default function DictionaryScreen({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isQueuing, setIsQueuing] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [types, setTypes] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const { showConfirm, showAlert } = useModal();

  useEffect(() => {
    loadSources();
  }, []);

  useEffect(() => {
    loadEntries();
  }, [sourceFilter, typeFilter, levelFilter]);

  const loadSources = async () => {
    const data = await SourceRepository.getAll();
    setSources(data);
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

  const chunkByCountAndChars = (items: any[], serialize: (i: any) => string, limits: { maxItems: number, maxChars: number, perItemOverhead: number }) => {
    const chunks: any[][] = [];
    let currentChunk: any[] = [];
    let currentCharCount = 0;

    for (const item of items) {
      const len = serialize(item).length + limits.perItemOverhead;
      if (
        currentChunk.length > 0 && 
        (currentChunk.length >= limits.maxItems || currentCharCount + len > limits.maxChars)
      ) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentCharCount = 0;
      }
      currentChunk.push(item);
      currentCharCount += len;
    }
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    return chunks;
  };

  const handleAddToQueue = async () => {
    if (pendingCount === 0) {
      showAlert("Aviso", "Não há palavras pendentes no dicionário.");
      return;
    }

    showConfirm(
      "Completar dicionário",
      `Deseja enviar ${pendingCount} verbetes pendentes para completamento na fila global?`,
      async () => {
        setIsQueuing(true);
        try {
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
          
          const pendings = data.filter((e) => e.status === "pending");

          const allJobs = await AiJobRepository.getAll();
          const pendingDictItemIds = new Set<string>();
          allJobs.filter(j => j.type === 'enrich_dictionary_entry' || j.type === 'batch_enrich_dictionary_entries_full').forEach(job => {
            if (job?.input?.items) {
               job.input.items.forEach((it: any) => pendingDictItemIds.add(it.id));
            } else if (job?.input?.id) {
               pendingDictItemIds.add(job.input.id);
            }
          });

          const entriesToBatch = pendings.filter(e => !pendingDictItemIds.has(e.id));

          if (entriesToBatch.length === 0) {
            showAlert("Fila", "Todas as palavras desta fonte já estão agendadas.");
            return;
          }

          const dictType = 'batch_enrich_dictionary_entries_full';
          const bSize = 12; // default 
          
          const dictChunks = chunkByCountAndChars(entriesToBatch, e => e.lemma, {
             maxItems: bSize, maxChars: 5200, perItemOverhead: 180
          });

          for (const chunk of dictChunks) {
             await AiJobRepository.add({
                type: dictType,
                target_id: "global",
                input: {
                   items: chunk.map((e) => ({
                      id: e.id,
                      lemma: e.lemma,
                      reading: e.reading,
                   })),
                },
                status: 'pending',
                priority: 2,
             });
          }

          showAlert("Fila atualizada", `${dictChunks.length} lotes adicionados com um total de ${entriesToBatch.length} palavras.`);
        } catch (e: any) {
          showAlert("Erro", `Falha ao adicionar na fila: ${e.message}`);
        } finally {
          setIsQueuing(false);
          loadEntries(true);
        }
      },
      "Sim, adicionar à fila",
    );
  };

  const deleteEntry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await DictionaryRepository.delete(id);
      loadEntries(true);
    } catch (error) {
      console.error(error);
      showAlert("Erro", "Falha ao apagar o verbete.");
    }
  };

  const retryPending = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await DictionaryRepository.updateStatus(id, "pending");
      loadEntries(true);
      showAlert("Status alterado", "Verbete marcado como pendente. Use a opção 'Completar' para enviar para a fila da IA quando desejar.");
    } catch (error) {
      console.error("Erro ao retentar", error);
      showAlert("Erro", "Falha ao atualizar verbete.");
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#F5F5F7] text-[#1D1D1F]">
      <header className="sticky top-0 z-10 shrink-0 bg-white shadow-sm border-b border-[#E5E5E7] p-4">
        <div className="flex items-center justify-between mx-auto max-w-6xl w-full">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="mr-2 rounded-full p-2 hover:bg-[#F5F5F7] transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-[#86868B]" />
            </button>
            <div className="flex items-center justify-center p-2 rounded-xl bg-orange-100 ring-1 ring-orange-200">
              <Library className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-[#1D1D1F]">
                Dicionário Central
              </h1>
              <p className="text-[11px] font-medium text-[#86868B]">
                Conhecimento adquirido consolidado.
              </p>
            </div>
          </div>
          
          <button
            onClick={handleClearDictionary}
            className="flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 shadow-sm transition-colors hover:bg-rose-50"
            title="Limpar permanentemente todos os verbetes salvos"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Limpar dicionário</span>
          </button>
        </div>

        <div className="mx-auto mt-4 max-w-6xl w-full flex flex-col items-center gap-3 sm:flex-row">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="w-full rounded-xl border border-[#E5E5E7] bg-slate-50 px-3 py-1.5 font-bold text-[#1D1D1F] outline-none"
          >
            <option value="all">Todas as fontes</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
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

      <div className="mx-4 mt-3 mb-1 bg-white border border-[#E5E5E7] rounded-2xl p-4 shadow-sm space-y-4 shrink-0 max-w-6xl self-center w-full">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-[#1D1D1F]">
              <Cpu className="h-4 w-4 text-indigo-600" />
              Completar Dicionário com IA
            </h2>
            <p className="text-[11px] leading-relaxed text-[#86868B]">
              Enriqueça os verbetes pendentes no dicionário.
            </p>
          </div>
          <button
            onClick={handleAddToQueue}
            disabled={isQueuing || pendingCount === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isQueuing ? "Adicionando..." : "Adicionar à Fila global"}
          </button>
        </div>
        <GlobalAiQueueControl />
      </div>

      <div className="flex-1 overflow-auto p-4 mx-auto max-w-6xl w-full">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-indigo-600">
            <span className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 font-bold shadow-sm">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Sincronizando dicionário local...
            </span>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-[#E5E5E7] bg-white">
            <p className="font-bold text-[#86868B]">
              Nenhum verbete recebido no armazenamento local.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="group flex flex-col justify-between rounded-2xl border border-[#E5E5E7] bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-black text-[#1D1D1F]">
                          {entry.lemma}
                        </span>
                        {entry.reading && entry.reading !== entry.lemma && (
                          <span className="text-sm font-bold text-[#86868B]">
                            {entry.reading}
                          </span>
                        )}
                      </div>
                      
                      {entry.type && (
                         <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex rounded-md bg-[#F5F5F7] px-1.5 py-0.5 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                              {entry.type}
                            </span>
                            {entry.jlpt_level && (
                               <span className="inline-flex rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                                 {entry.jlpt_level}
                               </span>
                            )}
                         </div>
                      )}
                    </div>
                    {entry.status === "pending" && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100 shrink-0">
                        Pendente
                      </span>
                    )}
                    {entry.status === "error" && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100 shrink-0">
                        Erro
                      </span>
                    )}
                    {(entry.status === "completed" || entry.status === "reviewed") && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100 shrink-0">
                        Completo
                      </span>
                    )}
                  </div>
                  
                  {entry.meanings && entry.meanings.length > 0 ? (
                    <ol className="mt-3 list-decimal pl-4 space-y-1.5 text-sm text-[#1D1D1F]">
                      {entry.meanings.slice(0, 3).map((m, i) => (
                        <li key={i} className="pl-1">
                          <span className="font-semibold text-slate-800">{m.pt}</span>
                          {m.en && <span className="ml-1.5 text-xs text-[#86868B]">({m.en})</span>}
                        </li>
                      ))}
                      {entry.meanings.length > 3 && (
                        <li className="pl-1 text-xs font-bold text-indigo-600 list-none mt-1">
                          + {entry.meanings.length - 3} sentidos...
                        </li>
                      )}
                    </ol>
                  ) : (
                    <div className="mt-3 text-xs font-medium italic text-[#86868B]">
                      Sem definições carregadas.
                    </div>
                  )}
                </div>
                
                <div className="mt-4 flex items-center justify-end gap-1.5 border-t border-[#E5E5E7] pt-3">
                   {(entry.status === "error" || entry.status === "completed" || entry.status === "reviewed") && (
                      <button
                        onClick={(e) => retryPending(entry.id, e)}
                        className="rounded-lg bg-indigo-50 p-1.5 text-indigo-600 hover:bg-indigo-100 transition-colors"
                        title="Reenviar para preenchimento por IA"
                      >
                         <RotateCcw className="h-4 w-4" />
                      </button>
                   )}
                   <button
                     onClick={(e) => deleteEntry(entry.id, e)}
                     className="rounded-lg bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100 transition-colors"
                     title="Remover do dicionário"
                   >
                     <Trash2 className="h-4 w-4" />
                   </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
