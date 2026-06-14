import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Play,
  Star,
  AlertCircle,
  RefreshCw,
  Settings2,
  Loader2,
  Volume2,
  Search,
  Info,
  Sparkles,
  BookOpen,
  Edit2,
  Check,
  X,
} from "lucide-react";
import {
  SourceRepository,
  SentenceRepository,
  ProgressRepository,
  TermRepository,
  DictionaryRepository,
  AiJobRepository,
} from "../repositories";
import {
  Sentence,
  Source,
  SentenceProgress,
  SentenceTerm,
  DictionaryEntry,
  AiJob,
} from "../types";
import { SpeechService } from "../services/speechService";
import { Database } from "../database/db"; // Assuming we still get settings config from there for general TTS settings if not extracted
import { TermDetectionService } from "../services/termDetectionService";
import { AiJobService } from "../services/aiJobService";
import { useModal } from "./ModalProvider";

interface ReadingScreenProps {
  sourceId: string;
  onBack: () => void;
  onNavigate?: (screen: string, params: any) => void;
}

const TERM_COLORS: Record<
  string,
  { name: string; text: string; bg: string; border: string }
> = {
  substantivo: {
    name: "Substantivo",
    text: "text-indigo-700",
    bg: "bg-indigo-50 border border-indigo-200 hover:bg-indigo-100",
    border: "border-indigo-200",
  },
  verbo: {
    name: "Verbo",
    text: "text-amber-700",
    bg: "bg-amber-50 border border-amber-200 hover:bg-amber-100",
    border: "border-amber-200",
  },
  adjetivo: {
    name: "Adjetivo",
    text: "text-rose-700",
    bg: "bg-rose-50 border border-rose-200 hover:bg-rose-100",
    border: "border-rose-200",
  },
  advérbio: {
    name: "Advérbio",
    text: "text-teal-700",
    bg: "bg-teal-50 border border-teal-200 hover:bg-teal-100",
    border: "border-teal-200",
  },
  partícula: {
    name: "Partícula",
    text: "text-emerald-700",
    bg: "bg-emerald-50 border border-emerald-200 hover:bg-emerald-100",
    border: "border-emerald-200",
  },
  pronome: {
    name: "Pronome",
    text: "text-sky-700",
    bg: "bg-sky-50 border border-sky-200 hover:bg-sky-100",
    border: "border-sky-200",
  },
  expressão: {
    name: "Expressão",
    text: "text-purple-700",
    bg: "bg-purple-50 border border-purple-200 hover:bg-purple-100",
    border: "border-purple-200",
  },
  conector: {
    name: "Conector",
    text: "text-cyan-700",
    bg: "bg-cyan-50 border border-cyan-200 hover:bg-cyan-100",
    border: "border-cyan-200",
  },
  auxiliar: {
    name: "Auxiliar",
    text: "text-pink-700",
    bg: "bg-pink-50 border border-pink-200 hover:bg-pink-100",
    border: "border-pink-200",
  },
  tempo: {
    name: "Tempo",
    text: "text-blue-700",
    bg: "bg-blue-50 border border-blue-200 hover:bg-blue-105",
    border: "border-blue-200",
  },
  lugar: {
    name: "Lugar",
    text: "text-yellow-700",
    bg: "bg-yellow-50 border border-yellow-200 hover:bg-yellow-105",
    border: "border-yellow-200",
  },
  outro: {
    name: "Outro",
    text: "text-slate-600",
    bg: "bg-slate-50 border border-slate-200 hover:bg-slate-100",
    border: "border-slate-200",
  },
};

export function getTermColor(type?: string | null) {
  const t = (type || "outro").toLowerCase().trim();
  return TERM_COLORS[t] || TERM_COLORS["outro"];
}

import SourcePreparationPanel from "./SourcePreparationPanel";

export default function ReadingScreen({
  sourceId,
  onBack,
  onNavigate,
}: ReadingScreenProps) {
  const [source, setSource] = useState<Source | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [termsMap, setTermsMap] = useState<Record<string, SentenceTerm[]>>({});
  const [dictMap, setDictMap] = useState<Record<string, DictionaryEntry>>({});
  const [progressMap, setProgressMap] = useState<
    Record<string, SentenceProgress | null>
  >({});
  const [loading, setLoading] = useState(true);
  const [activeTermHover, setActiveTermHover] = useState<{
    term: SentenceTerm;
    entry: DictionaryEntry | null;
  } | null>(null);
  const [showLegendModal, setShowLegendModal] = useState(false);
  const [showPrep, setShowPrep] = useState(false);
  const { showAlert } = useModal();
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [editingSentencePt, setEditingSentencePt] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState(25);

  const handleEditTranslationClick = (sent: Sentence) => {
    setEditingSentenceId(sent.id);
    setEditingSentencePt(sent.portuguese || "");
  };

  const handleSaveTranslation = async (sent: Sentence) => {
    try {
      await SentenceRepository.update(sent.id, { portuguese: editingSentencePt, status: "reviewed" });
      setSentences((current) =>
        current.map((s) =>
          s.id === sent.id ? { ...s, portuguese: editingSentencePt, status: "reviewed" } : s,
        ),
      );
      setEditingSentenceId(null);
    } catch (e) {
      console.error("Error saving translation", e);
    }
  };

  const handleReanalyzeSentence = async (sentence: Sentence) => {
    if (reanalyzingId || bulkProcessing) return;
    setReanalyzingId(sentence.id);
    try {
      const job = await AiJobService.requestSentenceReading(
        sentence.id,
        sentence.japanese,
      );
      const result = await AiJobService.processJob(job);
      if (result.success) {
        await loadData(true);
      } else {
        showAlert(
          "Erro",
          `Falha ao re-analisar com IA: ${result.error || "Erro desconhecido"}`,
        );
      }
    } catch (e: any) {
      console.error(e);
      showAlert("Erro", `Falha ao re-analisar frase: ${e.message || e}`);
    } finally {
      setReanalyzingId(null);
    }
  };

  const handleReanalyzeSelected = async () => {
    if (selectedIds.size === 0 || bulkProcessing) return;
    setBulkProcessing(true);
    setBulkProgress({ current: 0, total: selectedIds.size });

    let successCount = 0;
    let failCount = 0;
    const idsArray = Array.from(selectedIds);

    for (let i = 0; i < idsArray.length; i++) {
      const sentenceId = idsArray[i];
      const sentence = sentences.find((s) => s.id === sentenceId);
      if (!sentence) continue;

      setBulkProgress({ current: i + 1, total: idsArray.length });

      try {
        const job = await AiJobService.requestSentenceReading(
          sentence.id,
          sentence.japanese,
        );
        const result = await AiJobService.processJob(job);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          console.error(
            `Falha ao re-analisar ID ${sentence.id}:`,
            result.error,
          );
        }
      } catch (e) {
        failCount++;
        console.error(`Erro ao re-analisar ID ${sentence.id}:`, e);
      }
    }

    await loadData(true);
    setBulkProcessing(false);
    setSelectedIds(new Set());

    if (failCount > 0) {
      showAlert(
        "Re-análise concluída",
        `${successCount} frases re-analisadas com sucesso. ${failCount} falharam.`,
      );
    } else {
      showAlert(
        "Sucesso",
        `Todas as ${successCount} frases foram re-analisadas com sucesso!`,
      );
    }
  };

  useEffect(() => {
    setVisibleCount(25);
    loadData();
  }, [sourceId]);

  const loadData = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const src = await SourceRepository.getById(sourceId);
      if (src) setSource(src);

      const sents = await SentenceRepository.getBySource(sourceId);
      setSentences(sents);

      const pMap: Record<string, SentenceProgress | null> = {};
      const tMap: Record<string, SentenceTerm[]> = {};
      const dMap: Record<string, DictionaryEntry> = {};

      const allDicts = await DictionaryRepository.getAll();
      for (const d of allDicts) {
        dMap[d.id] = d;
      }

      const sentenceIds = sents.map((s) => s.id);

      // Batch fetch progress and terms in parallel
      const [allProgress, allTerms] = await Promise.all([
        ProgressRepository.getSentenceProgressForSentences(sentenceIds),
        TermRepository.getBySentences(sentenceIds),
      ]);

      // Initialize mapping for all sentences
      for (const sent of sents) {
        pMap[sent.id] = null;
        tMap[sent.id] = [];
      }

      for (const prog of allProgress) {
        pMap[prog.sentence_id] = prog;
      }

      // Group terms by sentence_id
      const termsBySentence: Record<string, SentenceTerm[]> = {};
      for (const term of allTerms) {
        if (!termsBySentence[term.sentence_id]) {
          termsBySentence[term.sentence_id] = [];
        }
        termsBySentence[term.sentence_id].push(term);
      }

      for (const sent of sents) {
        const terms = termsBySentence[sent.id] || [];

        // Remove overlaps (simplest greedy match for longer terms)
        const sortedTerms = terms.sort(
          (a, b) => b.end_index - b.start_index - (a.end_index - a.start_index),
        );
        const filtered: SentenceTerm[] = [];
        const usedIndexes = new Set<number>();
        for (const t of sortedTerms) {
          let overlap = false;
          for (let i = t.start_index; i < t.end_index; i++) {
            if (usedIndexes.has(i)) overlap = true;
          }
          if (!overlap) {
            for (let i = t.start_index; i < t.end_index; i++)
              usedIndexes.add(i);
            filtered.push(t);
          }
        }

        tMap[sent.id] = filtered.sort((a, b) => a.start_index - b.start_index);
      }
      setProgressMap(pMap);
      setTermsMap(tMap);
      setDictMap(dMap);
    } catch (err) {
      console.error(err);
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const handleToggleFavorite = async (sentence: Sentence) => {
    const updated = !sentence.favorite;
    await SentenceRepository.update(sentence.id, { favorite: updated });
    setSentences((current) =>
      current.map((s) =>
        s.id === sentence.id ? { ...s, favorite: updated } : s,
      ),
    );
  };

  const handleToggleDifficulty = async (sentence: Sentence) => {
    const currentDiff = sentence.difficulty || 0;
    const nextDiff = currentDiff > 0 ? 0 : 1;
    await SentenceRepository.update(sentence.id, { difficulty: nextDiff });
    setSentences((current) =>
      current.map((s) =>
        s.id === sentence.id ? { ...s, difficulty: nextDiff } : s,
      ),
    );
  };

  const handleExportCSV = () => {
    if (!source || !sentences.length) return;
    const header = "japanese,kana,romaji,portuguese\n";
    const rows = sentences
      .map((s) => {
        const escapeCsv = (str: string) =>
          `"${(str || "").replace(/"/g, '""')}"`;
        return `${escapeCsv(s.japanese)},${escapeCsv(s.kana || "")},${escapeCsv(s.romaji || "")},${escapeCsv(s.portuguese || "")}`;
      })
      .join("\n");
    const csvContent = header + rows;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${source.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const playSentence = async (sentence: Sentence, lang: "ja" | "pt") => {
    // Just a simple speech wrap for now avoiding complex player
    SpeechService.stop();
    const settings = Database.getSettings();

    // Update progress just for seeing it
    let prog = progressMap[sentence.id];
    if (!prog) {
      prog = await ProgressRepository.upsertSentenceProgress({
        sentence_id: sentence.id,
        seen_count: 1,
        last_seen_at: new Date().toISOString(),
      });
    } else {
      prog = await ProgressRepository.upsertSentenceProgress({
        id: prog.id,
        sentence_id: sentence.id,
        seen_count: prog.seen_count + 1,
        last_seen_at: new Date().toISOString(),
      });
    }
    setProgressMap((prev) => ({ ...prev, [sentence.id]: prog }));

    if (lang === "ja") {
      SpeechService.speakJapaneseText(sentence.japanese, settings.speedJa || 1);
    } else if (sentence.portuguese) {
      SpeechService.speakPortugueseText(
        sentence.portuguese,
        settings.speedPt || 1,
      );
    }
  };

  const renderSentence = (sent: Sentence) => {
    const terms = termsMap[sent.id] || [];
    if (terms.length === 0)
      return <span className="break-words">{sent.japanese}</span>;

    const elements: React.ReactNode[] = [];
    let currentIndex = 0;

    terms.forEach((term, idx) => {
      if (term.start_index > currentIndex) {
        elements.push(
          <span key={`text-${idx}`}>
            {sent.japanese.substring(currentIndex, term.start_index)}
          </span>,
        );
      }

      const entry = term.dictionary_entry_id
        ? dictMap[term.dictionary_entry_id]
        : null;

      elements.push(
        <button
          key={`term-${idx}`}
          onClick={() => setActiveTermHover({ term, entry: entry || null })}
          className={`${getTermColor(term.type).text} ${getTermColor(term.type).bg} border-b-2 border-dotted border-current rounded px-1.5 py-0.5 font-bold text-lg hover:brightness-95 active:scale-95 transition-all mx-[2px]`}
        >
          {sent.japanese.substring(term.start_index, term.end_index)}
        </button>,
      );
      currentIndex = term.end_index;
    });

    if (currentIndex < sent.japanese.length) {
      elements.push(
        <span key={`text-end`}>{sent.japanese.substring(currentIndex)}</span>,
      );
    }

    return <span className="break-words">{elements}</span>;
  };

  const loadMore = () => {
    if (visibleCount < sentences.length) {
      setVisibleCount((prev) => Math.min(prev + 25, sentences.length));
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 250) {
      loadMore();
    }
  };

  useEffect(() => {
    const handleWindowScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const clientHeight = window.innerHeight;
      
      if (scrollHeight - scrollTop - clientHeight < 300) {
        loadMore();
      }
    };

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
    };
  }, [visibleCount, sentences.length]);

  if (loading) {
    return (
      <div className="p-10 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  if (!source) {
    return <div className="p-10 text-center">Fonte não encontrada</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#F5F5F7] text-[#1D1D1F]">
      <header className="px-4 py-4 bg-white border-b border-[#E5E5E7] flex flex-col shrink-0 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={onBack}
            className="p-2 -ml-2 text-[#86868B] hover:text-[#1D1D1F] transition-colors flex items-center gap-1 text-sm font-semibold"
          >
            <ArrowLeft className="w-5 h-5" /> Voltar
          </button>
          <div className="flex gap-1.5 overflow-x-auto pb-1 items-center max-w-[280px]">
            <button
              onClick={() => setShowPrep(!showPrep)}
              className={`flex-none px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap flex items-center gap-1 shadow-sm border ${showPrep ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-indigo-600 hover:bg-indigo-700 text-white border-transparent"}`}
            >
              <Sparkles
                className={`w-3 h-3 ${showPrep ? "text-indigo-600" : "text-white"}`}
              />
              {showPrep ? "Ocultar Inteligência" : "Preparar tudo com IA"}
            </button>
            <button
              onClick={handleExportCSV}
              className="flex-none bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all hover:bg-gray-200 whitespace-nowrap"
            >
              Exportar CSV
            </button>
          </div>
        </div>
        <h1 className="text-sm font-black uppercase tracking-widest text-[#1D1D1F] mb-1">
          {source.title}
        </h1>
        <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono">
          <span>Modo de Leitura • {sentences.length} frases</span>
          <button
            onClick={() => setShowLegendModal(true)}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg font-bold uppercase transition-colors"
          >
            <Info className="w-3.5 h-3.5" /> Legenda de Cores
          </button>
        </div>
      </header>

      {selectedIds.size > 0 && (
        <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2.5 flex items-center justify-between shadow-sm shrink-0 sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-indigo-900">
              {selectedIds.size} selecionada(s)
            </span>
            <div className="flex gap-2 text-[10px]">
              <button
                onClick={() =>
                  setSelectedIds(new Set(sentences.map((s) => s.id)))
                }
                className="text-indigo-600 hover:text-indigo-800 font-bold uppercase transition-colors"
              >
                Todas
              </button>
              <span className="text-indigo-200">|</span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-indigo-600 hover:text-indigo-800 font-bold uppercase transition-colors"
              >
                Limpar
              </button>
            </div>
          </div>
          <button
            onClick={handleReanalyzeSelected}
            disabled={bulkProcessing}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] uppercase px-4 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-all active:scale-95 disabled:opacity-50"
          >
            {bulkProcessing ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>
                  Re-analisando ({bulkProgress.current}/{bulkProgress.total})...
                </span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3 h-3" />
                <span>Re-analisar Selecionadas</span>
              </>
            )}
          </button>
        </div>
      )}

      <main
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-4 space-y-4 max-w-2xl mx-auto w-full"
      >
        {showPrep && (
          <div className="mb-8">
            <SourcePreparationPanel
              sourceId={sourceId}
              onPreparationComplete={() => {
                setShowPrep(false);
                loadData(false);
              }}
            />
          </div>
        )}
        {sentences.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-xs">
            A fonte não possui frases processadas.
          </div>
        ) : (
          sentences.slice(0, visibleCount).map((sent, index) => (
            <div
              key={sent.id}
              className="bg-white border text-center flex flex-col border-[#E5E5E7] rounded-3xl p-5 shadow-sm space-y-4"
            >
              <div className="flex justify-between items-center w-full mb-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`select-${sent.id}`}
                    checked={selectedIds.has(sent.id)}
                    onChange={(e) => {
                      const newSet = new Set(selectedIds);
                      if (e.target.checked) {
                        newSet.add(sent.id);
                      } else {
                        newSet.delete(sent.id);
                      }
                      setSelectedIds(newSet);
                    }}
                    className="w-4 h-4 rounded text-indigo-600 border-gray-300 focus:ring-indigo-500 cursor-pointer"
                  />
                  <label
                    htmlFor={`select-${sent.id}`}
                    className="bg-gray-100 text-gray-500 text-[9px] font-mono px-2 py-0.5 rounded-full cursor-pointer select-none"
                  >
                    {index + 1}
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReanalyzeSentence(sent)}
                    disabled={reanalyzingId !== null}
                    className={`p-1.5 rounded-full ${reanalyzingId === sent.id ? "bg-indigo-50 text-indigo-600" : "text-gray-300 hover:bg-gray-50"}`}
                    style={{ transition: "all 0.2s" }}
                    title="Re-analisar e Corrigir Card com IA"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${reanalyzingId === sent.id ? "animate-spin" : ""}`}
                    />
                  </button>
                  <button
                    onClick={() => handleToggleFavorite(sent)}
                    className={`p-1.5 rounded-full ${sent.favorite ? "bg-amber-50 text-amber-500" : "text-gray-300 hover:bg-gray-50"}`}
                  >
                    <Star
                      className={`w-4 h-4 ${sent.favorite ? "fill-current" : ""}`}
                    />
                  </button>
                  <button
                    onClick={() => handleToggleDifficulty(sent)}
                    className={`p-1.5 rounded-full ${sent.difficulty && sent.difficulty > 0 ? "bg-rose-50 text-rose-500" : "text-gray-300 hover:bg-gray-50"}`}
                  >
                    <AlertCircle
                      className={`w-4 h-4 ${sent.difficulty && sent.difficulty > 0 ? "fill-current" : ""}`}
                    />
                  </button>
                </div>
              </div>

              <div className="space-y-1 w-full text-center py-2 text-xl font-bold text-gray-900 leading-relaxed">
                {renderSentence(sent)}
              </div>

              <div className="py-2 w-full border-t border-gray-50 text-center relative group min-h-[3rem]">
                {editingSentenceId === sent.id ? (
                  <div className="flex items-center gap-2 px-2">
                    <input
                      type="text"
                      className="flex-1 w-full p-2 text-sm bg-gray-50 border border-indigo-200 rounded-lg outline-none focus:border-indigo-500"
                      value={editingSentencePt}
                      onChange={(e) => setEditingSentencePt(e.target.value)}
                      placeholder="Tradução em Português"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveTranslation(sent);
                        if (e.key === "Escape") setEditingSentenceId(null);
                      }}
                    />
                    <button onClick={() => handleSaveTranslation(sent)} className="p-1.5 bg-emerald-100 text-emerald-700 rounded-md hover:bg-emerald-200 transition-colors">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingSentenceId(null)} className="p-1.5 bg-rose-100 text-rose-700 rounded-md hover:bg-rose-200 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className={`text-sm font-medium ${sent.portuguese ? 'text-[#1D1D1F]' : 'text-gray-400 italic'}`}>
                      {sent.portuguese || "Sem tradução"}
                    </p>
                    <button
                      onClick={() => handleEditTranslationClick(sent)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-full opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
                      title="Editar Tradução"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>

              <div className="flex justify-center gap-4 w-full pt-2">
                <button
                  onClick={() => playSentence(sent, "ja")}
                  className="flex items-center gap-1 text-[10px] uppercase font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                >
                  <Volume2 className="w-3.5 h-3.5" /> Ouvir JP
                </button>
                {sent.portuguese && (
                  <button
                    onClick={() => playSentence(sent, "pt")}
                    className="flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                  >
                    <Volume2 className="w-3.5 h-3.5" /> Ouvir PT
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </main>

      {/* Mini Dictionary Modal */}
      {activeTermHover && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
          onClick={() => setActiveTermHover(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center space-y-1 relative">
              <button
                onClick={() => setActiveTermHover(null)}
                className="absolute -top-2 -right-2 text-gray-400 p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                ✕
              </button>
              {activeTermHover.entry?.kana && (
                <p className="text-xs text-gray-500 font-medium tracking-widest">
                  {activeTermHover.entry.kana}
                </p>
              )}
              <h3 className="text-3xl font-black text-gray-900">
                {activeTermHover.term.surface}
              </h3>
              {activeTermHover.entry?.romaji && (
                <p className="text-[10px] font-mono text-gray-400 uppercase pt-1">
                  {activeTermHover.entry.romaji}
                </p>
              )}
            </div>

            <div className="space-y-3 pt-3">
              <div className="bg-indigo-50 p-3 rounded-2xl text-center">
                {activeTermHover.entry?.main_meaning ? (
                  <span className="text-sm font-bold text-indigo-900">
                    {activeTermHover.entry.main_meaning}
                  </span>
                ) : (
                  <span className="text-xs text-indigo-400 italic">
                    Sem significado cadastrado
                  </span>
                )}
              </div>
              <div className="flex justify-center flex-wrap gap-2">
                <span className="bg-gray-100 px-2 py-0.5 rounded text-[10px] font-mono text-gray-500">
                  {activeTermHover.entry
                    ? activeTermHover.entry.type
                    : activeTermHover.term.type}
                </span>
                {activeTermHover.term.is_expression && (
                  <span className="bg-rose-100 text-rose-700 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                    Expressão
                  </span>
                )}
              </div>

              {activeTermHover.term.context_meaning &&
                activeTermHover.term.context_meaning !==
                  activeTermHover.entry?.main_meaning && (
                  <div className="bg-teal-50 border border-teal-100 p-3 rounded-2xl text-center">
                    <span className="text-[9px] font-bold text-teal-600 tracking-wider uppercase block mb-0.5">
                      Sentido Contextual nesta Frase
                    </span>
                    <span className="text-xs font-bold text-teal-900">
                      {activeTermHover.term.context_meaning}
                    </span>
                  </div>
                )}

              {activeTermHover.term.grammar_note && (
                <div className="text-[11px] bg-amber-50/70 text-amber-900 p-3 rounded-2xl leading-relaxed border border-amber-100 font-medium">
                  <span className="font-bold text-amber-700 block text-[9px] uppercase tracking-wider mb-0.5">
                    Nota de Conjugação / Uso:
                  </span>
                  {activeTermHover.term.grammar_note}
                </div>
              )}

              {activeTermHover.term.structure_note && (
                <div className="text-[11px] bg-slate-50 text-slate-700 p-3 rounded-2xl leading-relaxed border border-slate-200/80 font-medium">
                  <span className="font-bold text-slate-500 block text-[9px] uppercase tracking-wider mb-0.5">
                    Estrutura:
                  </span>
                  {activeTermHover.term.structure_note}
                </div>
              )}
              <div className="pt-2 border-t border-gray-150 flex flex-col gap-2">
                <button
                  onClick={() => {
                    if (!activeTermHover.entry?.id) {
                      showAlert(
                        "Aviso",
                        "Esta palavra ainda não possui entrada cadastrada no dicionário completo.",
                      );
                      return;
                    }
                    if (onNavigate) {
                      onNavigate("dictionary_entry", {
                        entryId: activeTermHover.entry.id,
                      });
                      setActiveTermHover(null);
                    }
                  }}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black py-3.5 rounded-xl uppercase tracking-widest transition-all shadow-md active:scale-98 flex items-center justify-center gap-2"
                >
                  <BookOpen className="w-4 h-4 text-white" />
                  <span>Ver Ficha Completa</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend modal listing all grammatical color codings */}
      {showLegendModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowLegendModal(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4 text-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center relative">
              <button
                onClick={() => setShowLegendModal(false)}
                className="absolute -top-1 -right-1 text-gray-400 p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                ✕
              </button>
              <h3 className="text-lg font-black uppercase tracking-wider text-slate-800">
                Legenda de Cores
              </h3>
              <p className="text-xs text-gray-400">
                Identificação por cores aplicada nas palavras das lições
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 max-h-[350px] overflow-y-auto p-1 text-left">
              {Object.entries(TERM_COLORS).map(([key, item]) => (
                <div
                  key={key}
                  className={`p-2.5 rounded-2xl ${item.bg} flex flex-col justify-between h-[72px] transition-all`}
                >
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">
                    {item.name}
                  </span>
                  <span
                    className={`${item.text} font-black text-sm tracking-wide mt-auto leading-none truncate`}
                  >
                    {key === "substantivo"
                      ? "人 (pessoa)"
                      : key === "verbo"
                        ? "落ちる (cair)"
                        : key === "adjetivo"
                          ? "静か (calmo)"
                          : key === "partícula"
                            ? "とも (partícula)"
                            : "サンプル"}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-2 text-center text-[10px] text-gray-400 italic">
              Clique em qualquer palavra da lição para abrir o minidicionário e
              ver o significado completo.
            </div>

            <div className="pt-2">
              <button
                onClick={() => setShowLegendModal(false)}
                className="w-full bg-slate-950 hover:bg-slate-900 text-white text-xs font-bold py-3.5 rounded-xl uppercase tracking-widest transition-colors shadow-lg"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
