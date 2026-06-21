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
  Trash2,
} from "lucide-react";
import {
  SourceRepository,
  SentenceRepository,
  ProgressRepository,
  TermRepository,
  ProcessingRunRepository,
} from "../repositories";
import {
  Sentence,
  Source,
  SentenceProgress,
  SentenceTerm,
  DictionaryEntry,
} from "../types";
import { SpeechService } from "../services/speechService";
import { Database } from "../database/db"; // Assuming we still get settings config from there for general TTS settings if not extracted
import { TermDetectionService } from "../services/termDetectionService";
import { useModal } from "./ModalProvider";
import { TERM_COLORS, getTermColor, isLowEmphasisTerm } from "../ui/termColors";
import { normalizeTermOffsets, sliceCodePoints, toCodePoints } from "../ui/termOffsets";
import SourcePreparationPanel from "./SourcePreparationPanel";
import { AppNavigate } from "../navigation";

interface ReadingScreenProps {
  sourceId: string;
  onBack: () => void;
  onNavigate?: AppNavigate;
}

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
  const { showAlert, showConfirm } = useModal();
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [editingSentenceJa, setEditingSentenceJa] = useState<string>("");
  const [editingSentenceKa, setEditingSentenceKa] = useState<string>("");
  const [editingSentenceRo, setEditingSentenceRo] = useState<string>("");
  const [editingSentencePt, setEditingSentencePt] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState(25);
  const [totalSentences, setTotalSentences] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const handleEditClick = (sent: Sentence) => {
    setEditingSentenceId(sent.id);
    setEditingSentenceJa(sent.japanese || "");
    setEditingSentenceKa(sent.kana || "");
    setEditingSentenceRo(sent.romaji || "");
    setEditingSentencePt(sent.portuguese || "");
  };

  const handleSaveFullSentence = async (sent: Sentence) => {
    try {
      const updates = {
        japanese: editingSentenceJa,
        kana: editingSentenceKa,
        romaji: editingSentenceRo,
        portuguese: editingSentencePt,
        status: "reviewed" as const,
      };
      await SentenceRepository.update(sent.id, updates);
      setSentences((current) =>
        current.map((s) =>
          s.id === sent.id ? { ...s, ...updates } : s,
        ),
      );
      setEditingSentenceId(null);
    } catch (e: any) {
      console.error("Error saving sentence updates", e);
      showAlert("Erro", `Falha ao salvar alterações: ${e.message || e}`);
    }
  };

  const handleDeleteSentence = (sent: Sentence) => {
    showConfirm(
      "Excluir Frase",
      "Tem certeza que deseja excluir esta frase? Esta ação removerá o card de leitura definitivamente.",
      async () => {
        try {
          const success = await SentenceRepository.delete(sent.id);
          if (success) {
            setSentences((current) => current.filter((s) => s.id !== sent.id));
            setSelectedIds((curr) => {
              const next = new Set(curr);
              next.delete(sent.id);
              return next;
            });
          } else {
            showAlert("Erro", "Erro ao excluir a frase do banco de dados.");
          }
        } catch (e: any) {
          console.error(e);
          showAlert("Erro", `Falha ao excluir a frase: ${e.message || e}`);
        }
      },
      "Excluir"
    );
  };

  const handleReanalyzeSentence = async (sentence: Sentence) => {
    if (reanalyzingId || bulkProcessing) return;
    setReanalyzingId(sentence.id);
    try {
      await ProcessingRunRepository.startSourceProcessingRun(sentence.source_id, "analyze");
      await loadData(true);
      showAlert("Leitura enfileirada", "A fonte foi retomada pelo worker persistente.");
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

    let queuedCount = 0;
    let failCount = 0;
    const sourceIds = Array.from(new Set(
      Array.from(selectedIds)
        .map((id) => sentences.find((s) => s.id === id)?.source_id)
        .filter((id): id is string => Boolean(id)),
    ));

    for (let i = 0; i < sourceIds.length; i++) {
      const sourceId = sourceIds[i];
      setBulkProgress({ current: i + 1, total: sourceIds.length });

      try {
        await ProcessingRunRepository.startSourceProcessingRun(sourceId, "analyze");
        queuedCount++;
      } catch (e) {
        failCount++;
        console.error(`Erro ao retomar fonte ${sourceId}:`, e);
      }
    }

    await loadData(true);
    setBulkProcessing(false);
    setSelectedIds(new Set());

    if (failCount > 0) {
      showAlert(
        "Re-análise concluída",
        `${queuedCount} leituras enfileiradas. ${failCount} falharam.`,
      );
    } else {
      showAlert(
        "Sucesso",
        `${queuedCount} leituras foram enfileiradas para o worker persistente.`,
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

      const [sents, total] = await Promise.all([
        SentenceRepository.getPageBySourceId(sourceId, 0, 50),
        SentenceRepository.countBySourceId(sourceId),
      ]);
      setSentences(sents);
      setTotalSentences(total);
      setVisibleCount(sents.length);

      const pMap: Record<string, SentenceProgress | null> = {};
      const tMap: Record<string, SentenceTerm[]> = {};
      const dMap: Record<string, DictionaryEntry> = {};

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
        const entry = (term as any).entry || (term as any).form?.entry;
        const entryId = term.dictionary_entry_id || entry?.id;
        if (entryId && entry) {
          dMap[entryId] = entry;
        }
      }

      for (const sent of sents) {
        const terms = termsBySentence[sent.id] || [];

        tMap[sent.id] = normalizeTermOffsets(sent.japanese, terms);
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
    const currentProgress = progressMap[sentence.id];
    const updated = !(currentProgress?.favorite ?? sentence.favorite ?? false);
    const saved = await ProgressRepository.upsertSentenceProgress({
      ...(currentProgress ? { id: currentProgress.id } : {}),
      sentence_id: sentence.id,
      favorite: updated,
    });
    if (saved) {
      setProgressMap((current) => ({ ...current, [sentence.id]: saved }));
    }
    setSentences((current) =>
      current.map((s) =>
        s.id === sentence.id ? { ...s, favorite: updated } : s,
      ),
    );
  };

  const handleToggleDifficulty = async (sentence: Sentence) => {
    const currentProgress = progressMap[sentence.id];
    const currentDiff = currentProgress?.difficulty ?? sentence.difficulty ?? 0;
    const nextDiff = currentDiff > 0 ? 0 : 1;
    const saved = await ProgressRepository.upsertSentenceProgress({
      ...(currentProgress ? { id: currentProgress.id } : {}),
      sentence_id: sentence.id,
      difficulty: nextDiff,
    });
    if (saved) {
      setProgressMap((current) => ({ ...current, [sentence.id]: saved }));
    }
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
            {sliceCodePoints(sent.japanese, currentIndex, term.start_index)}
          </span>,
        );
      }

      const entry = term.dictionary_entry_id
        ? dictMap[term.dictionary_entry_id]
        : null;
      const lowEmphasis = isLowEmphasisTerm(term.type);
      const termStyle = lowEmphasis
        ? `${getTermColor(term.type).text} border-b border-dotted border-current rounded-none px-0 py-0 font-normal text-lg hover:brightness-95 active:scale-95 transition-all`
        : `${getTermColor(term.type).text} ${getTermColor(term.type).bg} border-b-2 border-dotted border-current rounded px-1.5 py-0.5 font-bold text-lg hover:brightness-95 active:scale-95 transition-all mx-[2px]`;

      elements.push(
        <button
          key={`term-${idx}`}
          onClick={() => setActiveTermHover({ term, entry: entry || null })}
          className={termStyle}
        >
          {sliceCodePoints(sent.japanese, term.start_index, term.end_index)}
        </button>,
      );
      currentIndex = term.end_index;
    });

    if (currentIndex < toCodePoints(sent.japanese).length) {
      elements.push(
        <span key={`text-end`}>{sliceCodePoints(sent.japanese, currentIndex, toCodePoints(sent.japanese).length)}</span>,
      );
    }

    return <span className="break-words">{elements}</span>;
  };

  const loadMore = async () => {
    if (loadingMore || sentences.length >= totalSentences) return;
    setLoadingMore(true);
    try {
      const next = await SentenceRepository.getPageBySourceId(sourceId, sentences.length, 50);
      if (next.length === 0) return;
      const sentenceIds = next.map((s) => s.id);
      const [nextProgress, nextTerms] = await Promise.all([
        ProgressRepository.getSentenceProgressForSentences(sentenceIds),
        TermRepository.getBySentences(sentenceIds),
      ]);

      const pMap: Record<string, SentenceProgress | null> = {};
      const tMap: Record<string, SentenceTerm[]> = {};
      const dMap: Record<string, DictionaryEntry> = {};
      for (const sent of next) {
        pMap[sent.id] = null;
        tMap[sent.id] = [];
      }
      for (const prog of nextProgress) {
        pMap[prog.sentence_id] = prog;
      }
      for (const term of nextTerms) {
        if (!tMap[term.sentence_id]) tMap[term.sentence_id] = [];
        tMap[term.sentence_id].push(term);
        const entry = (term as any).entry || (term as any).form?.entry;
        const entryId = term.dictionary_entry_id || entry?.id;
        if (entryId && entry) dMap[entryId] = entry;
      }
      setSentences((current) => [...current, ...next]);
      setVisibleCount((current) => current + next.length);
      setProgressMap((current) => ({ ...current, ...pMap }));
      setTermsMap((current) => ({ ...current, ...tMap }));
      setDictMap((current) => ({ ...current, ...dMap }));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 250) {
      void loadMore();
    }
  };

  // Use a stable ref so the event listener doesn't need to be re-registered on every state change
  const loadMoreRef = React.useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    const handleWindowScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const clientHeight = window.innerHeight;
      
      if (scrollHeight - scrollTop - clientHeight < 300) {
        loadMoreRef.current();
      }
    };

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
    };
  }, []); // Empty deps: listener registered once and uses stable ref internally


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
    <div className="screen-gray">
      <header className="screen-header flex-col gap-2 items-stretch">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="btn-back"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex gap-1.5 items-center">
            <button
              type="button"
              onClick={() => setShowPrep(!showPrep)}
              className={`flex-none px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all whitespace-nowrap flex items-center gap-1 border ${showPrep ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-indigo-600 hover:bg-indigo-700 text-white border-transparent"}`}
            >
              <Sparkles className={`w-3 h-3 ${showPrep ? "text-indigo-600" : "text-white"}`} />
              {showPrep ? "Ocultar IA" : "Preparar com IA"}
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="flex-none bg-[#F5F5F7] text-[#86868B] px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase transition-all hover:bg-[#EBEBED] whitespace-nowrap"
            >
              CSV
            </button>
          </div>
        </div>
        <div className="flex justify-between items-center">
          <h1 className="screen-title">{source.title}</h1>
          <button
            type="button"
            onClick={() => setShowLegendModal(true)}
            className="flex items-center gap-1 text-[#86868B] text-[10px] font-bold uppercase hover:text-[#1D1D1F] transition-colors"
          >
            <Info className="w-3.5 h-3.5" /> Cores
          </button>
        </div>
        <p className="text-[10px] text-[#86868B] font-mono">{totalSentences || sentences.length} frases</p>
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
              onContentUpdated={() => loadData(true)}
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
                <div className="flex gap-1">
                  <button
                    onClick={() => handleReanalyzeSentence(sent)}
                    disabled={reanalyzingId !== null}
                    className={`p-1.5 rounded-full ${reanalyzingId === sent.id ? "bg-indigo-50 text-indigo-600" : "text-gray-300 hover:bg-gray-50"}`}
                    style={{ transition: "all 0.2s" }}
                    title="Re-analisar e Corrigir Card com IA"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${reanalyzingId === sent.id ? "animate-spin" : ""}`}
                    />
                  </button>
                  <button
                    onClick={() => handleToggleFavorite(sent)}
                    className={`p-1.5 rounded-full ${sent.favorite ? "bg-amber-50 text-amber-500" : "text-gray-300 hover:bg-gray-50"}`}
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${sent.favorite ? "fill-current" : ""}`}
                    />
                  </button>
                  <button
                    onClick={() => handleToggleDifficulty(sent)}
                    className={`p-1.5 rounded-full ${sent.difficulty && sent.difficulty > 0 ? "bg-rose-50 text-rose-500" : "text-gray-300 hover:bg-gray-50"}`}
                  >
                    <AlertCircle
                      className={`w-3.5 h-3.5 ${sent.difficulty && sent.difficulty > 0 ? "fill-current" : ""}`}
                    />
                  </button>
                  <button
                    onClick={() => handleEditClick(sent)}
                    className={`p-1.5 rounded-full ${editingSentenceId === sent.id ? "bg-indigo-50 text-indigo-600 font-bold" : "text-gray-300 hover:text-indigo-600 hover:bg-gray-55"}`}
                    title="Editar Card"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteSentence(sent)}
                    className="p-1.5 rounded-full text-gray-300 hover:text-rose-600 hover:bg-gray-50"
                    title="Excluir Card"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {editingSentenceId === sent.id ? (
                <div className="text-left space-y-3 bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 w-full">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-indigo-900/60 font-mono">Japonês (Original)</label>
                    <input
                      type="text"
                      className="w-full p-2 text-base bg-white border border-indigo-100 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-800 text-center"
                      value={editingSentenceJa}
                      onChange={(e) => setEditingSentenceJa(e.target.value)}
                      placeholder="Ex: 日本語"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-indigo-900/60 font-mono">Leitura (Kana)</label>
                      <input
                        type="text"
                        className="w-full p-2 text-sm bg-white border border-indigo-100 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-center"
                        value={editingSentenceKa}
                        onChange={(e) => setEditingSentenceKa(e.target.value)}
                        placeholder="Ex: にほんご"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-indigo-900/60 font-mono">Romaji</label>
                      <input
                        type="text"
                        className="w-full p-2 text-sm bg-white border border-indigo-100 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-center"
                        value={editingSentenceRo}
                        onChange={(e) => setEditingSentenceRo(e.target.value)}
                        placeholder="Ex: nihongo"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-indigo-900/60 font-mono">Tradução (Português)</label>
                    <input
                      type="text"
                      className="w-full p-2 text-sm bg-white border border-indigo-100 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 text-center"
                      value={editingSentencePt}
                      onChange={(e) => setEditingSentencePt(e.target.value)}
                      placeholder="Ex: Idioma japonês"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => setEditingSentenceId(null)}
                      className="px-3 py-1.5 text-xs font-bold text-indigo-900/60 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1 font-mono"
                    >
                      <X className="w-3.5 h-3.5" /> Cancelar
                    </button>
                    <button
                      onClick={() => handleSaveFullSentence(sent)}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-all flex items-center gap-1 shadow-sm active:scale-95 font-mono"
                    >
                      <Check className="w-3.5 h-3.5" /> Salvar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1 w-full text-center py-2 text-xl font-bold text-gray-900 leading-relaxed">
                    {renderSentence(sent)}
                  </div>

                  <div className="py-2 w-full border-t border-gray-50 text-center relative group min-h-[3rem] flex items-center justify-center">
                    <p className={`text-sm font-medium ${sent.portuguese ? 'text-[#1D1D1F]' : 'text-gray-400 italic'}`}>
                      {sent.portuguese || "Sem tradução"}
                    </p>
                    <button
                      onClick={() => handleEditClick(sent)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-full opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
                      title="Editar Card"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}

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
                  className="btn btn-primary flex items-center justify-center gap-2"
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
