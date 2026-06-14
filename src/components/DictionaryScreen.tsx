import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Search,
  Command,
  Sparkles,
  Loader2,
  Cpu,
  Trash2,
} from "lucide-react";
import {
  DictionaryRepository,
  SourceRepository,
  SentenceRepository,
  TermRepository,
} from "../repositories";
import { DictionaryEntry, Source } from "../types";
import { AiJobService } from "../services/aiJobService";
import { useModal } from "./ModalProvider";

interface DictionaryScreenProps {
  onBack: () => void;
  onSelectEntry: (entryId: string) => void;
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
  const { showAlert, showConfirm } = useModal();

  useEffect(() => {
    SourceRepository.getAll().then(setSources);
  }, []);

  useEffect(() => {
    loadEntries();
  }, [typeFilter, levelFilter, sourceFilter]);

  const loadEntries = async () => {
    setLoading(true);
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

    // Count all pending terms in the clean DB state
    const totalPending = data.filter((e) => e.status === "pending").length;
    setPendingCount(totalPending);

    // Extracted unique types and levels from actual data
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
    setLoading(false);
  };

  const handleClearDictionary = () => {
    if (entries.length === 0) {
      showAlert("Aviso", "O dicionário já está vazio.");
      return;
    }

    showConfirm(
      "Limpar Dicionário",
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
      "Sim, Limpar Tudo",
    );
  };

  const handleAddToQueue = async () => {
    if (pendingCount === 0) {
      showAlert("Aviso", "Não há palavras pendentes no dicionário.");
      return;
    }

    showConfirm(
      "Fila de IA",
      `Deseja adicionar todas as ${pendingCount} palavras pendentes na fila de IA para detecção e enriquecimento automático?`,
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
            `${count} tarefas de detecção e enriquecimento foram enviadas à fila de IA.`,
          );
          loadEntries();
        } catch (e) {
          console.error(e);
          showAlert("Erro", "Ocorreu um erro ao criar as tarefas.");
        } finally {
          setIsQueuing(false);
        }
      },
      "Adicionar Tudo",
    );
  };

  return (
    <div className="flex flex-col h-full bg-white text-[#1D1D1F]">
      <header className="px-4 py-4 border-b border-[#E5E5E7] flex flex-col shrink-0 sticky top-0 z-10 bg-white space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 -ml-2 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-sm font-black uppercase tracking-widest text-[#1D1D1F]">
              Dicionário
            </h1>
          </div>

          <button
            onClick={handleClearDictionary}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 text-[11px] font-bold rounded-xl transition-all active:scale-95 shadow-sm"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpar Dicionário
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
          <div className="flex gap-2">
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="flex-none px-3 py-1.5 rounded-xl border bg-slate-50 border-[#E5E5E7] text-[#86868B] font-bold outline-none max-w-[200px] truncate"
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
              className="flex-none px-3 py-1.5 rounded-xl border bg-slate-50 border-[#E5E5E7] text-[#86868B] font-bold outline-none"
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
              className="flex-none px-3 py-1.5 rounded-xl border bg-slate-50 border-[#E5E5E7] text-[#86868B] font-bold outline-none"
            >
              <option value="all">Nível (Todos)</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <span className="text-gray-400 font-bold whitespace-nowrap pr-2">
            {entries.length} {entries.length === 1 ? "palavra" : "palavras"}
          </span>
        </div>
      </header>

      {pendingCount > 0 && (
        <div className="px-4 py-3 bg-indigo-50/50 border-b border-indigo-100 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-100 text-indigo-700 p-1.5 rounded-lg flex items-center justify-center">
              <Cpu className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-800">
                Processamento em Lote
              </span>
              <span className="text-[10px] text-indigo-600 font-medium">
                {pendingCount} termos pendentes no dicionário
              </span>
            </div>
          </div>
          <button
            onClick={handleAddToQueue}
            disabled={isQueuing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-xl transition-all disabled:opacity-50 shrink-0"
          >
            {isQueuing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {isQueuing ? "Enviando..." : "Enviar Todos para IA"}
          </button>
        </div>
      )}

      <main className="flex-1 overflow-auto p-4 space-y-2">
        {loading ? (
          <div className="text-center py-10 text-xs text-gray-500">
            Carregando...
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-10 text-xs text-gray-400">
            Nenhum termo encontrado.
          </div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onSelectEntry(entry.id)}
              className="w-full bg-white border border-[#E5E5E7] p-3 text-left rounded-xl hover:border-indigo-300 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    {entry.lemma}
                  </h3>
                  {entry.kana && (
                    <p className="text-[10px] text-gray-500">{entry.kana}</p>
                  )}
                </div>
                <span
                  className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${entry.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
                >
                  {entry.status}
                </span>
              </div>
              <p className="text-[11px] text-gray-600 mt-2 truncate">
                {entry.main_meaning || "Sem significado principal"}
              </p>
            </button>
          ))
        )}
      </main>
    </div>
  );
}
