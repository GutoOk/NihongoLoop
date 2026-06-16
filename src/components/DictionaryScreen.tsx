import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Search,
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
import { getDictionaryMissingFields, needsDictionaryEnrichment } from "../domain/dictionaryCompleteness";

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

    const totalPending = data.filter((e) => needsDictionaryEnrichment(e)).length;
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
    setLoading(false);
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

  const handleAddToQueue = async () => {
    if (pendingCount === 0) {
      showAlert("Aviso", "Não há palavras pendentes no dicionário.");
      return;
    }

    showConfirm(
      "Completar dicionário",
      `Deseja enviar ${pendingCount} verbetes pendentes para completar o enriquecimento com IA? Isso é opcional quando a fonte já aparece 100% preparada.`,
      async () => {
        setIsQueuing(true);
        try {
          let allEntries = await DictionaryRepository.getAll();
          if (sourceFilter !== "all") {
            const sentences = await SentenceRepository.getBySourceId(sourceFilter);
            const sentenceIds = sentences.map((s) => s.id);
            const terms = await TermRepository.getBySentences(sentenceIds);
            const validEntryIds = new Set(
              terms.map((t) => t.dictionary_entry_id).filter(Boolean),
            );
            allEntries = allEntries.filter((e) => validEntryIds.has(e.id));
          }
          const pendings = allEntries.filter((e) => needsDictionaryEnrichment(e));

          let count = 0;
          for (const item of pendings) {
            await AiJobService.requestDictionaryEnrichment(
              item.id,
              item.lemma,
              getDictionaryMissingFields(item),
            );
            count++;
          }
          showAlert(
            "Sucesso",
            `${count} tarefas de enriquecimento foram enviadas à fila de IA.`,
          );
          loadEntries();
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

      {pendingCount > 0 && (
        <div className="px-4 py-3 bg-indigo-50/50 border-b border-indigo-100 flex flex-col gap-3 shrink-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <div className="bg-indigo-100 text-indigo-700 p-1.5 rounded-lg flex items-center justify-center">
              <Cpu className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-800">
                Completar dicionário
              </span>
              <span className="text-[10px] leading-relaxed text-indigo-700 font-medium">
                {pendingCount} verbetes pendentes. Use apenas para completar pendências globais do dicionário.
              </span>
            </div>
          </div>
          <button
            onClick={handleAddToQueue}
            disabled={isQueuing}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white transition-all hover:bg-indigo-700 disabled:opacity-50 sm:w-auto"
          >
            {isQueuing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {isQueuing ? "Enviando..." : "Completar pendentes"}
          </button>
        </div>
      )}

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
    </div>
  );
}
