import React, { useState } from "react";
import { ArrowLeft, Play, Award, RotateCw, Check, X } from "lucide-react";
import { Sentence, SentenceTerm } from "../types";

interface WordSentencesQuizScreenProps {
  sentences: { sentence: Sentence; term: SentenceTerm }[];
  onBack: () => void;
}

export default function WordSentencesQuizScreen({
  sentences,
  onBack,
}: WordSentencesQuizScreenProps) {
  const [mode, setMode] = useState("ja_pt");

  const [isActive, setIsActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  const [queue, setQueue] = useState<
    { sentence: Sentence; term: SentenceTerm }[]
  >([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);

  const [stats, setStats] = useState({ successes: 0, failures: 0 });

  // Each quiz question needs distractors.
  // Since we are quizzing the *sentences*, we can use other sentences in the same list as distractors.
  // If we don't have enough sentences in the list, we can just use simple string manipulations or fetch all sentences, but it's synchronous here.
  // Actually, we can just use the other Portuguese translations as distractors, or if it's PT_JA, use other Japanese sentences.

  const shuffleArray = <T,>(arr: T[]): T[] => {
    const final = [...arr];
    for (let i = final.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [final[i], final[j]] = [final[j], final[i]];
    }
    return final;
  };

  const getDistractors = (correct: string, pool: string[], limit = 3) => {
    const valid = pool.filter((p) => p !== correct && p.trim() !== "");
    return shuffleArray(Array.from(new Set(valid))).slice(0, limit);
  };

  const handleStart = () => {
    setQueue(shuffleArray(sentences));
    setCurrentIndex(0);
    setStats({ successes: 0, failures: 0 });
    setIsActive(true);
    setIsFinished(false);
    setIsAnswered(false);
    setSelectedOptionId(null);
  };

  const handleSelect = (text: string, isCorrect: boolean) => {
    if (isAnswered) return;
    setIsAnswered(true);
    setSelectedOptionId(text);

    if (isCorrect) setStats((s) => ({ ...s, successes: s.successes + 1 }));
    else setStats((s) => ({ ...s, failures: s.failures + 1 }));
  };

  const handleNext = () => {
    if (currentIndex + 1 >= queue.length) {
      setIsActive(false);
      setIsFinished(true);
    } else {
      setCurrentIndex((c) => c + 1);
      setIsAnswered(false);
      setSelectedOptionId(null);
    }
  };

  if (!isActive && !isFinished) {
    return (
      <div className="flex flex-col h-full bg-[#F5F5F7] text-[#1D1D1F]">
        <header className="px-4 py-4 bg-white border-b border-[#E5E5E7] flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest">
            Quiz de Frases Relacionadas
          </h1>
        </header>
        <main className="flex-1 p-6 flex flex-col justify-center max-w-lg mx-auto w-full">
          <div className="bg-white p-8 rounded-2xl shadow-sm text-center space-y-6">
            <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto">
              <Play className="w-8 h-8 fill-current" />
            </div>
            <h2 className="text-xl font-black uppercase">Iniciar Quiz</h2>
            <p className="text-sm text-gray-500">
              Serão testadas <strong>{sentences.length} frases</strong>.
            </p>

            <div className="space-y-2 text-left pt-4">
              <label className="text-xs font-bold uppercase text-gray-500">
                Modo
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-medium"
              >
                <option value="ja_pt">Japonês → Tradução</option>
                <option value="pt_ja">Tradução → Japonês</option>
              </select>
            </div>

            <button
              onClick={handleStart}
              className="w-full py-4 bg-indigo-600 font-bold text-white rounded-xl shadow-md uppercase tracking-widest text-xs mt-4"
            >
              Começar
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="flex flex-col h-full bg-[#F5F5F7] text-[#1D1D1F]">
        <header className="px-4 py-4 bg-white border-b border-[#E5E5E7] flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest">
            Quiz Concluído
          </h1>
        </header>
        <main className="flex-1 p-6 flex flex-col justify-center max-w-lg mx-auto w-full">
          <div className="bg-white p-8 rounded-2xl shadow-sm text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto">
              <Award className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-black uppercase">Fim do Quiz</h2>

            <div className="flex gap-4 justify-center py-4">
              <div className="bg-emerald-50 p-4 rounded-xl flex-1 border border-emerald-100">
                <span className="block text-[10px] uppercase text-emerald-700 font-bold mb-1 tracking-widest">
                  Acertos
                </span>
                <span className="text-2xl font-black text-emerald-900">
                  {stats.successes}
                </span>
              </div>
              <div className="bg-rose-50 p-4 rounded-xl flex-1 border border-rose-100">
                <span className="block text-[10px] uppercase text-rose-700 font-bold mb-1 tracking-widest">
                  Erros
                </span>
                <span className="text-2xl font-black text-rose-900">
                  {stats.failures}
                </span>
              </div>
            </div>

            <button
              onClick={onBack}
              className="w-full py-4 bg-gray-100 text-gray-800 font-bold rounded-xl uppercase tracking-widest text-xs"
            >
              Voltar à Ficha
            </button>
          </div>
        </main>
      </div>
    );
  }

  const current = queue[currentIndex];

  // Build options
  const ptPool = sentences
    .map((s) => s.sentence.portuguese || "Sem tradução")
    .filter((s) => s !== "Sem tradução");
  const jaPool = sentences.map((s) => s.sentence.japanese);

  const correctText =
    mode === "ja_pt"
      ? current.sentence.portuguese || "Sem tradução"
      : current.sentence.japanese;
  const questionText =
    mode === "ja_pt"
      ? current.sentence.japanese
      : current.sentence.portuguese || "Sem tradução";

  const pool = mode === "ja_pt" ? ptPool : jaPool;
  const distractors = getDistractors(correctText, pool, 3);

  // If we don't have enough distractors, we might just have fewer options.
  const optionsText = shuffleArray([correctText, ...distractors]);

  return (
    <div className="flex flex-col h-full bg-[#F5F5F7] text-[#1D1D1F]">
      <header className="px-4 py-4 bg-white border-b border-[#E5E5E7] flex flex-col shrink-0 sticky top-0 z-10 space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 overflow-hidden h-1.5 bg-gray-100 rounded-full">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${(currentIndex / queue.length) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-gray-400">
            {currentIndex + 1}/{queue.length}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm text-center space-y-4 border border-[#E5E5E7]">
          <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest pt-2">
            Qual é a equivalência correta?
          </p>
          <h2 className="text-2xl font-black text-gray-900 leading-tight">
            {questionText}
          </h2>
        </div>

        <div className="space-y-3">
          {optionsText.map((opt, idx) => {
            let stateClass =
              "bg-white hover:border-gray-400 text-gray-800 border-gray-200";
            const isCorrect = opt === correctText;

            if (isAnswered) {
              if (isCorrect) {
                stateClass =
                  "bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500 flex justify-between font-bold";
              } else if (opt === selectedOptionId) {
                stateClass =
                  "bg-rose-50 border-rose-500 text-rose-900 ring-2 ring-rose-500 flex justify-between font-bold";
              } else {
                stateClass = "bg-white opacity-50 border-gray-200";
              }
            }

            return (
              <button
                key={idx}
                onClick={() => handleSelect(opt, isCorrect)}
                className={`w-full p-4 border rounded-xl text-left text-sm transition-all shadow-sm ${stateClass}`}
              >
                <span>{opt}</span>
                {isAnswered && isCorrect && (
                  <Check className="w-5 h-5 text-emerald-600" />
                )}
                {isAnswered && !isCorrect && opt === selectedOptionId && (
                  <X className="w-5 h-5 text-rose-600" />
                )}
              </button>
            );
          })}
        </div>

        {isAnswered && (
          <div className="pt-8">
            <button
              onClick={handleNext}
              className="w-full py-4 bg-indigo-600 text-white font-bold uppercase tracking-widest rounded-xl text-xs flex items-center justify-center gap-2 transition-all hover:bg-indigo-700 shadow-md"
            >
              {currentIndex + 1 >= queue.length
                ? "Finalizar Quiz"
                : "Próxima Frase"}{" "}
              <ArrowLeft className="w-4 h-4 rotate-180" />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
