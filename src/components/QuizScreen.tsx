import React, { useState, useEffect } from "react";
import { Play, Radio, Award, ArrowLeft, RotateCw, Check } from "lucide-react";
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

interface QuizScreenProps {
  onBack?: () => void;
}

interface Option {
  id: string;
  text: string;
  romaji?: string | null;
}

interface Question {
  item: DictionaryEntry;
  prompt: string;
  questionText: string;
  correctOptionId: string;
  options: Option[];
}

export default function QuizScreen({ onBack }: QuizScreenProps) {
  const { showAlert } = useModal();

  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);

  const [isQuizActive, setIsQuizActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [sessionQueue, setSessionQueue] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [stats, setStats] = useState({ successes: 0, failures: 0 });

  const [showReading, setShowReading] = useState(false);
  const [showRomajiInOptions, setShowRomajiInOptions] = useState(false);

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

  const shuffleArray = <T,>(arr: T[]): T[] => {
    const final = [...arr];
    for (let i = final.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [final[i], final[j]] = [final[j], final[i]];
    }
    return final;
  };

  const getDistractors = (excludeText: string, pool: string[], limit = 3) => {
    const valid = pool.filter(
      (t) =>
        t.trim().toLowerCase() !== excludeText.trim().toLowerCase() &&
        t.trim() !== "",
    );
    return shuffleArray(Array.from(new Set(valid))).slice(0, limit);
  };

  const generateQuestion = (
    entry: DictionaryEntry,
    mode: string,
  ): Question | null => {
    if (!entry.main_meaning) return null;

    if (mode === "word_meaning" || mode === "ja_meaning") {
      const distPool = dictionary
        .map((d) => d.main_meaning)
        .filter(Boolean) as string[];
      const distrants = getDistractors(entry.main_meaning, distPool);
      if (distrants.length < 3) return null;
      const opts = [
        { id: "correct", text: entry.main_meaning },
        ...distrants.map((d, i) => ({ id: `dist_${i}`, text: d })),
      ];
      return {
        item: entry,
        prompt: "Qual é o significado da palavra?",
        questionText: entry.lemma,
        correctOptionId: "correct",
        options: shuffleArray(opts),
      };
    } else {
      const distPool = dictionary.map((d) => d.lemma).filter(Boolean);
      const distrants = getDistractors(entry.lemma, distPool);
      if (distrants.length < 3) return null;

      const getRomaji = (lemmaStr: string) => {
        const found = dictionary.find((d) => d.lemma === lemmaStr);
        return found ? found.romaji : null;
      };

      const opts = [
        { id: "correct", text: entry.lemma, romaji: entry.romaji },
        ...distrants.map((d, i) => ({ id: `dist_${i}`, text: d, romaji: getRomaji(d) })),
      ];
      return {
        item: entry,
        prompt: "Qual palavra corresponde ao significado?",
        questionText: entry.main_meaning,
        correctOptionId: "correct",
        options: shuffleArray(opts),
      };
    }
  };

  const handleStartQuiz = async (filters: any, mode: string, limit: number) => {
    let pool = [...dictionary];

    // Exclude words that are marked as learned (mastery >= 999999)
    const progresses = await ProgressRepository.getAllDictionaryProgress();
    const learnedIds = new Set(progresses.filter((p) => p.mastery >= 999999).map((p) => p.dictionary_entry_id));
    pool = pool.filter((e) => !learnedIds.has(e.id));

    if (filters.sourceId) {
      let allowedEntryIds: Set<string>;
      try {
        allowedEntryIds = new Set(await TermRepository.getDictionaryEntryIdsBySourceId(filters.sourceId));
      } catch {
        const sourceSentences = await SentenceRepository.getBySourceId(filters.sourceId);
        const sourceSentenceIds = sourceSentences.map((s) => s.id);
        const terms = await TermRepository.getBySentences(sourceSentenceIds);
        allowedEntryIds = new Set(terms.map((t) => t.dictionary_entry_id).filter(Boolean) as string[]);
      }
      pool = pool.filter((e) => allowedEntryIds.has(e.id));
    }
    if (filters.type) pool = pool.filter((e) => e.type === filters.type);
    if (filters.jlpt_level)
      pool = pool.filter((e) => e.jlpt_level === filters.jlpt_level);

    pool = pool.filter((e) => e.main_meaning);
    const candidates = shuffleArray(pool);

    const questions: Question[] = [];
    for (const c of candidates) {
      const q = generateQuestion(c, mode);
      if (q) questions.push(q);
      if (questions.length >= limit) break;
    }

    if (questions.length === 0) {
      showAlert(
        "Aviso",
        "Não há dados suficientes no banco para gerar um quiz com este filtro.",
      );
      return;
    }

    setSessionQueue(questions);
    setCurrentIndex(0);
    setStats({ successes: 0, failures: 0 });
    setIsQuizActive(true);
    setIsFinished(false);
    resetTurn();
  };

  const resetTurn = () => {
    setSelectedOptionId(null);
    setIsAnswered(false);
    setShowReading(false);
  };

  const handleMarkAsLearned = async () => {
    const q = sessionQueue[currentIndex];
    const d = q.item;
    const existing = await ProgressRepository.getDictionaryProgress(d.id);
    if (!existing) {
      await ProgressRepository.upsertDictionaryProgress({
        dictionary_entry_id: d.id,
        seen_count: 1,
        correct_count: 1,
        wrong_count: 0,
        last_seen_at: new Date().toISOString(),
        mastery: 999999,
      });
    } else {
      await ProgressRepository.upsertDictionaryProgress({
        id: existing.id,
        dictionary_entry_id: d.id,
        seen_count: existing.seen_count + 1,
        correct_count: existing.correct_count + 1,
        wrong_count: existing.wrong_count,
        last_seen_at: new Date().toISOString(),
        mastery: 999999,
      });
    }

    // Move to next question automatically
    handleNext();
  };

  const handleSelect = async (optId: string) => {
    if (isAnswered) return;
    setIsAnswered(true);
    setSelectedOptionId(optId);

    const q = sessionQueue[currentIndex];
    const isCorrect = optId === q.correctOptionId;

    if (isCorrect) setStats((s) => ({ ...s, successes: s.successes + 1 }));
    else setStats((s) => ({ ...s, failures: s.failures + 1 }));

    const d = q.item;
    await ProgressRepository.updateDictionaryProgressLog(d.id, isCorrect);
    SpeechService.speakJapaneseText(d.lemma);
  };

  const handleNext = () => {
    if (currentIndex + 1 >= sessionQueue.length) {
      setIsQuizActive(false);
      setIsFinished(true);
    } else {
      setCurrentIndex((c) => c + 1);
      resetTurn();
    }
  };

  const currentQ = sessionQueue[currentIndex];

  return (
    <div className="screen-gray">
      <header className="screen-header">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="btn-back"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <h1 className="screen-title">Quiz de Fixação</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-4">
        {!isQuizActive && !isFinished && (
          <DeckSetupSelector
            onStart={handleStartQuiz}
            availableTypes={types}
            availableLevels={levels}
            isQuiz={true}
          />
        )}

        {isFinished && (
          <div className="bg-white p-8 rounded-2xl shadow-sm text-center space-y-6">
            <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto border border-green-100">
              <Award className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-black uppercase text-gray-900">
              Quiz Concluído
            </h2>

            <div className="flex gap-4 justify-center">
              <div className="bg-green-50 p-4 rounded-xl flex-1">
                <span className="block text-[10px] uppercase text-green-700 font-bold mb-1 tracking-widest">
                  Acertos
                </span>
                <span className="text-2xl font-black text-green-900">
                  {stats.successes}
                </span>
              </div>
              <div className="bg-rose-50 p-4 rounded-xl flex-1">
                <span className="block text-[10px] uppercase text-rose-700 font-bold mb-1 tracking-widest">
                  Erros
                </span>
                <span className="text-2xl font-black text-rose-900">
                  {stats.failures}
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
                Voltar ao Menu
              </button>
            </div>
          </div>
        )}

        {isQuizActive && currentQ && (
          <div className="space-y-4">
            <div className="bg-white p-6 rounded-2xl shadow-sm text-center space-y-4 border border-[#E5E5E7]">
              <div className="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-3">
                <span>
                  {currentIndex + 1} de {sessionQueue.length}
                </span>
                <span className="bg-green-50 text-green-600 px-2 py-1 rounded-md">
                  Acertos: {stats.successes}
                </span>
              </div>
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest pt-2">
                {currentQ.prompt}
              </p>
              <h2 className="text-3xl font-black text-gray-900 leading-tight">
                {currentQ.questionText}
              </h2>

              {currentQ.prompt === "Qual é o significado da palavra?" && (
                <div className="mt-2 flex flex-col items-center">
                  {!showReading ? (
                    <button
                      onClick={() => setShowReading(true)}
                      className="text-[10px] text-indigo-500 hover:text-indigo-600 font-bold uppercase tracking-wider px-3.5 py-1.5 bg-slate-50 border border-slate-200 rounded-full cursor-pointer transition-all active:scale-95"
                    >
                      Mostrar Leitura
                    </button>
                  ) : (
                    <div className="text-center animate-in fade-in duration-200 pt-1 space-y-0.5">
                      {currentQ.item.kana && currentQ.item.kana !== currentQ.item.lemma && (
                        <p className="text-xs text-gray-400 font-bold">
                          Kana: <span className="text-gray-700">{currentQ.item.kana}</span>
                        </p>
                      )}
                      {currentQ.item.romaji && (
                        <p className="text-xs text-gray-400 font-bold font-mono">
                          Romaji: <span className="text-gray-600">{currentQ.item.romaji}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {currentQ.prompt === "Qual palavra corresponde ao significado?" && (
              <div className="flex justify-end pr-1 pb-1">
                <button
                  onClick={() => setShowRomajiInOptions(!showRomajiInOptions)}
                  className={`text-[10px] font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-full border transition-all ${
                    showRomajiInOptions
                      ? "bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm"
                      : "bg-white border-gray-200 text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {showRomajiInOptions ? "Ocultar Romaji nas opções" : "Mostrar Romaji nas opções"}
                </button>
              </div>
            )}

            <div className="space-y-2">
              {currentQ.options.map((opt) => {
                let stateClass =
                  "bg-white hover:border-gray-400 text-gray-800 border-gray-200";

                if (isAnswered) {
                  if (opt.id === currentQ.correctOptionId) {
                    stateClass =
                      "bg-green-50 border-green-500 text-green-900 ring-2 ring-green-500 font-bold";
                  } else if (opt.id === selectedOptionId) {
                    stateClass =
                      "bg-rose-50 border-rose-500 text-rose-900 ring-2 ring-rose-500 font-bold";
                  } else {
                    stateClass = "bg-white opacity-50 border-gray-200";
                  }
                }

                return (
                  <button
                    key={opt.id}
                    onClick={() => handleSelect(opt.id)}
                    className={`w-full p-4 border rounded-xl text-left text-sm transition-all shadow-sm ${stateClass}`}
                  >
                    <span className="block font-semibold">{opt.text}</span>
                    {showRomajiInOptions && opt.romaji && (
                      <span className="block text-[11px] text-gray-400 mt-1 font-mono font-medium animate-in fade-in duration-200">
                        {opt.romaji}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="pt-4 space-y-2">
              {isAnswered && (
                <button
                  type="button"
                  onClick={handleNext}
                  className="btn btn-primary flex items-center justify-center gap-2"
                >
                  {currentIndex + 1 >= sessionQueue.length
                    ? "Concluir"
                    : "Próxima Pergunta"}
                  <ArrowLeft className="w-4 h-4 rotate-180" />
                </button>
              )}

              <button
                onClick={handleMarkAsLearned}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold uppercase tracking-wider rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                <Check className="w-4 h-4" /> Aprendido (Remover de estudos)
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
