import React, { useState, useEffect } from "react";
import { Layers, ArrowLeft, RotateCw, Play, Inbox, Check, Edit2, Save } from "lucide-react";
import {
  DictionaryRepository,
  ProgressRepository,
  TermRepository,
  SentenceRepository,
} from "../repositories";
import { DictionaryEntry } from "../types";
import { SpeechService } from "../services/speechService";
import { useModal } from "./ModalProvider";
import DeckSetupSelector from "./DeckSetupSelector";

interface FlashcardScreenProps {
  onBack: () => void;
}

export default function FlashcardScreen({ onBack }: FlashcardScreenProps) {
  const { showAlert } = useModal();

  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);

  const [isActive, setIsActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [queue, setQueue] = useState<DictionaryEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [showAnswer, setShowAnswer] = useState(false);
  const [stats, setStats] = useState({ again: 0, hard: 0, good: 0, easy: 0, learned: 0 });
  const [cardMode, setCardMode] = useState<"ja_pt" | "pt_ja">("ja_pt");

  // Flashcard editing states
  const [isEditingCard, setIsEditingCard] = useState(false);
  const [editCardLemma, setEditCardLemma] = useState("");
  const [editCardKana, setEditCardKana] = useState("");
  const [editCardRomaji, setEditCardRomaji] = useState("");
  const [editCardMeaning, setEditCardMeaning] = useState("");
  const [editCardType, setEditCardType] = useState("");
  const [editCardJlpt, setEditCardJlpt] = useState("");

  const handleStartEditFlashcard = () => {
    const card = queue[currentIndex];
    if (!card) return;
    setEditCardLemma(card.lemma || "");
    setEditCardKana(card.kana || "");
    setEditCardRomaji(card.romaji || "");
    setEditCardMeaning(card.main_meaning || "");
    setEditCardType(card.type || "");
    setEditCardJlpt(card.jlpt_level || "");
    setIsEditingCard(true);
  };

  const handleSaveFlashcard = async () => {
    const card = queue[currentIndex];
    if (!card) return;

    try {
      const updates = {
        lemma: editCardLemma.trim(),
        kana: editCardKana.trim(),
        romaji: editCardRomaji.trim(),
        main_meaning: editCardMeaning.trim(),
        type: editCardType.trim(),
        jlpt_level: editCardJlpt.trim(),
        status: "reviewed" as const,
      };

      const updated = await DictionaryRepository.update(card.id, updates);
      if (updated) {
        setQueue((prev) =>
          prev.map((c, idx) => (idx === currentIndex ? { ...c, ...updates } : c))
        );
        setIsEditingCard(false);
        showAlert("Sucesso", "Ficha de flashcard atualizada com sucesso!");
      }
    } catch (e: any) {
      console.error(e);
      showAlert("Erro", `Erro ao salvar flashcard: ${e.message || e}`);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const d = await DictionaryRepository.getAll();
    setDictionary(d);
    setTypes(
      Array.from(new Set(d.map((e) => e.type).filter(Boolean))) as string[],
    );
    setLevels(
      Array.from(
        new Set(d.map((e) => e.jlpt_level).filter(Boolean)),
      ) as string[],
    );
  };

  const calculateDue = async (entries: DictionaryEntry[]) => {
    const progresses = await ProgressRepository.getAllDictionaryProgress();
    const progressMap = progresses.reduce(
      (acc, p) => ({ ...acc, [p.dictionary_entry_id]: p }),
      {} as Record<string, any>,
    );
    const now = new Date().getTime();

    // Filter out entries that are marked as learned (mastery >= 999999)
    const activeEntries = entries.filter((e) => {
      const p = progressMap[e.id];
      return !p || p.mastery < 999999;
    });

    const scored = activeEntries.map((e) => {
      const p = progressMap[e.id];
      if (!p) {
        // Not seen yet -> score 0 (will appear but random order among unseen)
        return { entry: e, score: 0 + Math.random() * 1000 };
      }
      const lastSeenMs = new Date(p.last_seen_at || 0).getTime();
      const dueTime = p.due_at
        ? new Date(p.due_at).getTime()
        : lastSeenMs + (p.srs_interval_minutes || 10) * 60 * 1000;

      const score = now - dueTime; // positive means overdue
      return { entry: e, score };
    });

    // Sort by score descending (most overdue first).
    // If we filter, we might not have enough cards. Let's just sort, so due cards appear first.
    scored.sort((a, b) => b.score - a.score);

    return scored.map((s) => s.entry);
  };

  const handleStart = async (filters: any, mode: string, limit: number) => {
    let pool = [...dictionary];

    if (filters.sourceId) {
      const sourceSentences = await SentenceRepository.getBySourceId(filters.sourceId);
      const sourceSentenceIds = sourceSentences.map((s) => s.id);
      const terms = await TermRepository.getBySentences(sourceSentenceIds);
      const allowedEntryIds = new Set(
        terms.map((t) => t.dictionary_entry_id).filter(Boolean),
      );
      pool = pool.filter((e) => allowedEntryIds.has(e.id));
    }
    if (filters.type) pool = pool.filter((e) => e.type === filters.type);
    if (filters.jlpt_level)
      pool = pool.filter((e) => e.jlpt_level === filters.jlpt_level);
    pool = pool.filter((e) => e.main_meaning);

    // Here we could filter by due date if we loaded progress.
    const candidates = await calculateDue(pool);

    if (candidates.length === 0) {
      showAlert("Aviso", "Não há cartas neste baralho.");
      return;
    }

    setQueue(candidates.slice(0, limit));
    setCurrentIndex(0);
    setShowAnswer(false);
    setStats({ again: 0, hard: 0, good: 0, easy: 0, learned: 0 });
    setCardMode((mode === "pt_ja" ? "pt_ja" : "ja_pt") as "ja_pt" | "pt_ja");
    setIsActive(true);
    setIsFinished(false);
  };

  const handleFeedback = async (
    feedback: "again" | "hard" | "good" | "easy",
  ) => {
    const current = queue[currentIndex];
    await ProgressRepository.applyFlashcardFeedback(current.id, feedback);

    setStats((s) => ({ ...s, [feedback]: s[feedback] + 1 }));

    if (currentIndex + 1 >= queue.length) {
      setIsActive(false);
      setIsFinished(true);
    } else {
      setCurrentIndex((c) => c + 1);
      setShowAnswer(false);
    }
  };

  const handleMarkAsLearned = async () => {
    const current = queue[currentIndex];
    const existing = await ProgressRepository.getDictionaryProgress(current.id);
    if (!existing) {
      await ProgressRepository.upsertDictionaryProgress({
        dictionary_entry_id: current.id,
        seen_count: 1,
        correct_count: 1,
        wrong_count: 0,
        last_seen_at: new Date().toISOString(),
        mastery: 999999,
      });
    } else {
      await ProgressRepository.upsertDictionaryProgress({
        id: existing.id,
        dictionary_entry_id: current.id,
        seen_count: existing.seen_count + 1,
        correct_count: existing.correct_count + 1,
        wrong_count: existing.wrong_count,
        last_seen_at: new Date().toISOString(),
        mastery: 999999,
      });
    }

    setStats((s) => ({ ...s, learned: s.learned + 1 }));

    if (currentIndex + 1 >= queue.length) {
      setIsActive(false);
      setIsFinished(true);
    } else {
      setCurrentIndex((c) => c + 1);
      setShowAnswer(false);
    }
  };

  const currentCard = queue[currentIndex];

  return (
    <div className="screen-gray">
      <header className="screen-header">
        <button
          type="button"
          onClick={onBack}
          className="btn-back"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="screen-title">Flashcards SRS</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-4">
        {!isActive && !isFinished && (
          <DeckSetupSelector
            onStart={handleStart}
            availableTypes={types}
            availableLevels={levels}
            isQuiz={false}
          />
        )}

        {isFinished && (
          <div className="bg-white p-8 rounded-2xl shadow-sm text-center space-y-6">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto border border-indigo-100">
              <Inbox className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-black uppercase text-gray-900">
              Sessão Concluída
            </h2>

            <div className="grid grid-cols-5 gap-1.5 justify-center">
              <div className="bg-rose-50 p-2 rounded-xl flex flex-col">
                <span className="text-[8px] uppercase text-rose-700 font-bold mb-1">
                  De Novo
                </span>
                <span className="text-lg font-black text-rose-900">
                  {stats.again}
                </span>
              </div>
              <div className="bg-orange-50 p-2 rounded-xl flex flex-col">
                <span className="text-[8px] uppercase text-orange-700 font-bold mb-1">
                  Difícil
                </span>
                <span className="text-lg font-black text-orange-900">
                  {stats.hard}
                </span>
              </div>
              <div className="bg-emerald-50 p-2 rounded-xl flex flex-col">
                <span className="text-[8px] uppercase text-emerald-700 font-bold mb-1">
                  Bom
                </span>
                <span className="text-lg font-black text-emerald-900">
                  {stats.good}
                </span>
              </div>
              <div className="bg-blue-50 p-2 rounded-xl flex flex-col">
                <span className="text-[8px] uppercase text-blue-700 font-bold mb-1">
                  Fácil
                </span>
                <span className="text-lg font-black text-blue-900">
                  {stats.easy}
                </span>
              </div>
              <div className="bg-indigo-50 p-2 rounded-xl flex flex-col">
                <span className="text-[8px] uppercase text-indigo-700 font-bold mb-1">
                  Aprendido
                </span>
                <span className="text-lg font-black text-indigo-900">
                  {stats.learned}
                </span>
              </div>
            </div>

            <div className="pt-4 flex gap-3">
              <button
                onClick={() => {
                  setIsFinished(false);
                }}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold uppercase rounded-xl flex items-center justify-center gap-2"
              >
                Outro Baralho
              </button>
            </div>
          </div>
        )}

        {isActive && currentCard && (
          <div className="flex flex-col h-full space-y-4">
            <div
              className="flex-1 bg-white p-8 rounded-3xl shadow-sm text-center flex flex-col border border-[#E5E5E7] mb-2 cursor-pointer"
              onClick={() => !showAnswer && setShowAnswer(true)}
            >
              <div className="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-3 mb-6 shrink-0">
                <span>
                  {currentIndex + 1} / {queue.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEditFlashcard();
                    }}
                    className="flex items-center gap-1 px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg font-bold"
                  >
                    <Edit2 className="w-3 h-3" />
                    Editar
                  </button>
                  <span className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md">
                    Flashcards
                  </span>
                </div>
              </div>

              {cardMode === "ja_pt" ? (
                // MODE: Japonês -> Português
                <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                  <h2 className="text-4xl font-black text-gray-900 leading-tight">
                    {currentCard.lemma}
                  </h2>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      SpeechService.speakJapaneseText(currentCard.lemma);
                    }}
                    className="p-2.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-full mt-2 cursor-pointer transition-colors"
                  >
                    <Play className="w-5 h-5 fill-current" />
                  </button>
                </div>
              ) : (
                // MODE: Português -> Japonês
                <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                  <h2 className="text-3xl font-black text-gray-900 leading-tight animate-in fade-in duration-300 text-center px-4">
                    {currentCard.main_meaning}
                  </h2>
                </div>
              )}

              {showAnswer && (
                <div className="pt-8 mt-8 border-t border-gray-100 animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-2 flex flex-col items-center text-center">
                  {cardMode === "ja_pt" ? (
                    <>
                      {currentCard.kana && currentCard.kana !== currentCard.lemma && (
                        <p className="text-sm text-gray-400 font-bold">
                          {currentCard.kana}
                        </p>
                      )}
                      {currentCard.romaji && (
                        <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">
                          {currentCard.romaji}
                        </p>
                      )}
                      <p className="text-2xl text-gray-800 font-black pt-2">
                        {currentCard.main_meaning}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-black text-gray-900 leading-tight">
                        {currentCard.lemma}
                      </p>
                      {currentCard.kana && currentCard.kana !== currentCard.lemma && (
                        <p className="text-sm text-gray-400 font-bold pt-1">
                          {currentCard.kana}
                        </p>
                      )}
                      {currentCard.romaji && (
                        <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">
                          {currentCard.romaji}
                        </p>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          SpeechService.speakJapaneseText(currentCard.lemma);
                        }}
                        className="p-2.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-full mt-3 inline-flex items-center justify-center cursor-pointer transition-colors"
                      >
                        <Play className="w-5 h-5 fill-current" />
                      </button>
                    </>
                  )}

                  {(currentCard.type || currentCard.jlpt_level) && (
                    <div className="flex gap-2 justify-center mt-5 w-full">
                      {currentCard.type && (
                        <span className="bg-slate-100 text-slate-600 text-[10px] px-2 py-1 rounded font-bold uppercase">
                          {currentCard.type}
                        </span>
                      )}
                      {currentCard.jlpt_level && (
                        <span className="bg-purple-100 text-purple-700 text-[10px] px-2 py-1 rounded font-bold uppercase">
                          {currentCard.jlpt_level}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!showAnswer ? (
              <button
                type="button"
                onClick={() => setShowAnswer(true)}
                className="btn btn-primary"
              >
                Mostrar Resposta
              </button>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => handleFeedback("again")}
                    className="py-4 bg-white border-2 border-rose-100 hover:bg-rose-50 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors"
                  >
                    <span className="text-rose-600 font-black text-xs uppercase">
                      De Novo
                    </span>
                    <span className="text-[9px] text-gray-400 font-bold">
                      &lt; 1 min
                    </span>
                  </button>
                  <button
                    onClick={() => handleFeedback("hard")}
                    className="py-4 bg-white border-2 border-orange-100 hover:bg-orange-50 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors"
                  >
                    <span className="text-orange-600 font-black text-xs uppercase">
                      Difícil
                    </span>
                    <span className="text-[9px] text-gray-400 font-bold">
                      ~10 min
                    </span>
                  </button>
                  <button
                    onClick={() => handleFeedback("good")}
                    className="py-4 bg-white border-2 border-emerald-100 hover:bg-emerald-50 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors"
                  >
                    <span className="text-emerald-600 font-black text-xs uppercase">
                      Bom
                    </span>
                    <span className="text-[9px] text-gray-400 font-bold">
                      1 dia
                    </span>
                  </button>
                  <button
                    onClick={() => handleFeedback("easy")}
                    className="py-4 bg-white border-2 border-blue-100 hover:bg-blue-50 rounded-2xl flex flex-col items-center justify-center gap-1 transition-colors"
                  >
                    <span className="text-blue-600 font-black text-xs uppercase">
                      Fácil
                    </span>
                    <span className="text-[9px] text-gray-400 font-bold">
                      4 dias
                    </span>
                  </button>
                </div>

                <button
                  onClick={handleMarkAsLearned}
                  className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold uppercase tracking-wider rounded-2xl text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
                >
                  <Check className="w-4 h-4" /> Aprendido (Remover de estudos)
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Flashcard Edit Overlay Modal */}
      {isEditingCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
          onClick={() => setIsEditingCard(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4 text-slate-800 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Editar Flashcard
                </h3>
                <p className="text-[10px] text-gray-400">Corrige dados do vocabulário em tempo real</p>
              </div>
              <button
                onClick={() => setIsEditingCard(false)}
                className="text-gray-400 p-1.5 hover:text-rose-500 rounded-lg transition-colors"
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 max-h-[380px] overflow-y-auto pr-1">
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Lema (Japonês/Kanji)</label>
                <input
                  type="text"
                  value={editCardLemma}
                  onChange={(e) => setEditCardLemma(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Leitura Kana</label>
                <input
                  type="text"
                  value={editCardKana}
                  onChange={(e) => setEditCardKana(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Romaji</label>
                <input
                  type="text"
                  value={editCardRomaji}
                  onChange={(e) => setEditCardRomaji(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Categoria</label>
                  <select
                    value={editCardType}
                    onChange={(e) => setEditCardType(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-[#E5E5E7] rounded-xl outline-none font-bold text-slate-700"
                  >
                    <option value="substantivo">Substantivo</option>
                    <option value="verbo">Verbo</option>
                    <option value="adjetivo">Adjetivo</option>
                    <option value="advérbio">Advérbio</option>
                    <option value="partícula">Partícula</option>
                    <option value="pronome">Pronome</option>
                    <option value="expressão">Expressão</option>
                    <option value="conector">Conector</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Nível JLPT</label>
                  <select
                    value={editCardJlpt}
                    onChange={(e) => setEditCardJlpt(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-[#E5E5E7] rounded-xl outline-none font-bold text-slate-700"
                  >
                    <option value="">Nenhum/Outro</option>
                    <option value="N5">N5</option>
                    <option value="N4">N4</option>
                    <option value="N3">N3</option>
                    <option value="N2">N2</option>
                    <option value="N1">N1</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Significado PT</label>
                <input
                  type="text"
                  value={editCardMeaning}
                  onChange={(e) => setEditCardMeaning(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setIsEditingCard(false)}
                className="flex-1 py-3 text-xs bg-gray-50 hover:bg-gray-100 font-bold border border-gray-200 text-slate-500 rounded-xl transition-colors font-mono uppercase tracking-wider"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveFlashcard}
                className="flex-1 py-3 text-xs bg-emerald-600 hover:bg-emerald-700 font-bold text-white rounded-xl transition-all shadow-md flex items-center justify-center gap-1 font-mono uppercase tracking-wider active:scale-95"
              >
                <Save className="w-3.5 h-3.5" /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
