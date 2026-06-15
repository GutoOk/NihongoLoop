import React, { useState, useEffect } from "react";
import { ArrowLeft, Play, Award, Check, X } from "lucide-react";
import { DictionaryRepository, ProgressRepository } from "../repositories";
import { DictionaryEntry } from "../types";

interface StandardWordsQuizScreenProps {
  entryIds: string[];
  onBack: (accuracy: number) => void;
  reverseMode?: boolean;
}

interface Option {
  id: string;
  text: string;
}

const FALLBACK_PT_DISTRACTORS = [
  "Casa",
  "Carro",
  "Gato",
  "Cachorro",
  "Trabalho",
  "Amigo",
  "Festa",
  "Comida",
  "Viagem",
  "Tempo",
  "Mundo",
  "Sol",
  "Dia",
  "Noite",
];

const FALLBACK_JA_DISTRACTORS = [
  "行く",
  "食べる",
  "私",
  "猫",
  "今日",
  "犬",
  "明日",
  "昨日",
  "友達",
  "先生",
  "学生",
  "車",
  "水",
];

export default function StandardWordsQuizScreen({
  entryIds,
  onBack,
  reverseMode = false,
}: StandardWordsQuizScreenProps) {
  const [isActive, setIsActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [queue, setQueue] = useState<
    { entry: DictionaryEntry; options: Option[] }[]
  >([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [stats, setStats] = useState({ successes: 0, failures: 0 });
  const [loadingError, setLoadingError] = useState("");

  useEffect(() => {
    let cancelled = false;
    buildQuizQueue(cancelled);
    return () => {
      cancelled = true;
    };
  }, [entryIds.join("|"), reverseMode]);

  const shuffleArray = <T,>(arr: T[]): T[] => {
    const final = [...arr];
    for (let i = final.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [final[i], final[j]] = [final[j], final[i]];
    }
    return final;
  };

  const getOptionText = (entry: DictionaryEntry) => {
    const val = reverseMode ? entry.lemma : entry.main_meaning;
    if (Array.isArray(val)) return String(val[0] || "").trim();
    return String(val || "").trim();
  };

  const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("timeout loading distractors")),
            ms,
          );
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const buildQuizQueue = async (_cancelled: boolean) => {
    try {
      setIsLoading(true);
      setLoadingError("");
      setQueue([]);
      setIsActive(false);
      setIsFinished(false);
      setCurrentIndex(0);
      setSelectedOptionId(null);
      setIsAnswered(false);
      setStats({ successes: 0, failures: 0 });

      if (!entryIds || entryIds.length === 0) {
        setLoadingError("Nenhuma palavra detectada nestas frases.");
        return;
      }

      let entries = await DictionaryRepository.getByIds(entryIds);
      entries = entries.filter((e) => e.main_meaning && getOptionText(e));

      if (entries.length === 0) {
        setLoadingError(
          "Nenhum termo válido (com tradução) foi detectado nestas frases para montar o quiz.",
        );
        return;
      }

      // Primeiro monta distratores com os próprios itens do bloco. No celular,
      // carregar o dicionário inteiro pode demorar; o quiz não deve ficar preso
      // eternamente em “Preparando quiz...” só por causa dos distratores globais.
      let distPool = entries.map(getOptionText).filter(Boolean);

      try {
        const allDict = await withTimeout(DictionaryRepository.getAll(), 3500);
        const globalPool = allDict
          .map((d) => {
            const val = reverseMode ? d.lemma : d.main_meaning;
            if (Array.isArray(val)) return String(val[0] || "");
            return typeof val === "string" ? val : String(val || "");
          })
          .map((s) => s.trim())
          .filter(Boolean);
        if (globalPool.length >= 3) distPool = globalPool;
      } catch (poolErr) {
        console.warn("Using local/fallback quiz distractors", poolErr);
      }

      const finalQuestions = entries.map((entry) => {
        const correctText = getOptionText(entry);
        const fallbackPool = reverseMode
          ? FALLBACK_JA_DISTRACTORS
          : FALLBACK_PT_DISTRACTORS;
        const poolArray = Array.from(new Set([...distPool, ...fallbackPool]))
          .map((s) => s.trim())
          .filter(
            (p) =>
              p && p.toLowerCase() !== correctText.toLowerCase(),
          );

        const distractors = shuffleArray(poolArray).slice(0, 3);
        const opts = [
          { id: "correct", text: correctText },
          ...distractors.map((d, i) => ({ id: `dist_${i}`, text: d })),
        ];

        return {
          entry,
          options: shuffleArray(opts),
        };
      });

      setQueue(shuffleArray(finalQuestions));
    } catch (err: any) {
      console.error(err);
      setLoadingError(
        "Erro ao carregar o quiz: " + (err.message || "Desconhecido"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleStart = () => {
    setCurrentIndex(0);
    setStats({ successes: 0, failures: 0 });
    setIsActive(true);
    setIsFinished(false);
    setIsAnswered(false);
    setSelectedOptionId(null);
  };

  const handleSelect = async (optionId: string, isCorrect: boolean) => {
    if (isAnswered) return;
    setIsAnswered(true);
    setSelectedOptionId(optionId);

    if (isCorrect) setStats((s) => ({ ...s, successes: s.successes + 1 }));
    else setStats((s) => ({ ...s, failures: s.failures + 1 }));

    const current = queue[currentIndex];
    if (current?.entry?.id) {
      ProgressRepository.updateDictionaryProgressLog(
        current.entry.id,
        isCorrect,
      ).catch((err) => console.warn("Failed to update quiz progress", err));
    }
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

  if (isLoading || queue.length === 0) {
    return (
      <div className="screen-gray items-center justify-center p-6 text-center">
        {!isLoading && loadingError ? (
          <div className="space-y-4">
            <p className="text-rose-600 font-bold text-sm">{loadingError}</p>
            <button
              type="button"
              onClick={() => onBack(0)}
              className="py-2 px-4 btn-secondary w-auto"
            >
              Voltar
            </button>
          </div>
        ) : (
          <div className="empty-state">
            <span className="spinner text-indigo-500" />
            <p className="text-xs font-bold text-[#86868B] uppercase tracking-widest">
              Preparando quiz…
            </p>
          </div>
        )}
      </div>
    );
  }

  if (!isActive && !isFinished) {
    return (
      <div className="screen-gray">
        <header className="screen-header">
          <button
            type="button"
            onClick={() => onBack(0)}
            className="btn-back"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="screen-title">Quiz de Vocabulário</h1>
        </header>
        <main className="flex-1 p-6 flex flex-col justify-center max-w-lg mx-auto w-full">
          <div className="bg-white p-8 rounded-2xl shadow-sm text-center space-y-6">
            <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto">
              <Play className="w-8 h-8 fill-current" />
            </div>
            <h2 className="text-xl font-black uppercase">Iniciar Quiz</h2>
            <p className="text-sm text-gray-500">
              Serão testadas <strong>{queue.length} palavras</strong> presentes
              neste bloco.
            </p>
            <button
              type="button"
              onClick={handleStart}
              className="btn btn-primary mt-4"
            >
              Começar
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (isFinished) {
    const accuracy = queue.length > 0 ? stats.successes / queue.length : 0;
    return (
      <div className="screen-gray">
        <header className="screen-header justify-center">
          <h1 className="screen-title">Quiz Concluído</h1>
        </header>
        <main className="flex-1 p-6 flex flex-col justify-center max-w-lg mx-auto w-full">
          <div className="bg-white p-8 rounded-2xl shadow-sm text-center space-y-6">
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${accuracy >= 0.6 ? "bg-emerald-50 text-emerald-500" : "bg-rose-50 text-rose-500"}`}
            >
              <Award className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-black uppercase">
              Taxa de Acerto: {Math.round(accuracy * 100)}%
            </h2>

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
              type="button"
              onClick={() => onBack(accuracy)}
              className="btn btn-primary"
            >
              Continuar
            </button>
          </div>
        </main>
      </div>
    );
  }

  const current = queue[currentIndex];

  const getDisplayValue = (val: any) => {
    if (Array.isArray(val)) return val.join(", ");
    if (typeof val === "object" && val !== null) return JSON.stringify(val);
    return String(val || "");
  };

  return (
    <div className="screen-gray">
      <header className="screen-header flex-col gap-1 items-stretch">
        <div className="flex items-center gap-3">
          <div className="flex-1 overflow-hidden h-1.5 bg-gray-100 rounded-full">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / queue.length) * 100}%` }}
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
            {reverseMode
              ? "Qual é a palavra correta?"
              : "Qual é o significado correto?"}
          </p>
          <h2
            className={`font-black text-gray-900 leading-tight ${reverseMode ? "text-2xl" : "text-4xl"}`}
          >
            {getDisplayValue(
              reverseMode ? current.entry.main_meaning : current.entry.lemma,
            )}
          </h2>
          {!reverseMode && current.entry.kana && (
            <p className="text-sm font-semibold text-gray-500">
              {current.entry.kana}
            </p>
          )}
        </div>

        <div className="space-y-3">
          {current.options.map((opt, idx) => {
            let stateClass =
              "bg-white hover:border-gray-400 text-gray-800 border-gray-200";
            const isCorrect = opt.id === "correct";

            if (isAnswered) {
              if (isCorrect) {
                stateClass =
                  "bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500 flex justify-between font-bold";
              } else if (opt.id === selectedOptionId) {
                stateClass =
                  "bg-rose-50 border-rose-500 text-rose-900 ring-2 ring-rose-500 flex justify-between font-bold";
              } else {
                stateClass = "bg-white opacity-50 border-gray-200";
              }
            }

            return (
              <button
                key={idx}
                onClick={() => handleSelect(opt.id, isCorrect)}
                className={`w-full p-4 border rounded-xl text-left text-sm transition-all shadow-sm ${stateClass}`}
              >
                <span>{opt.text}</span>
                {isAnswered && isCorrect && (
                  <Check className="w-5 h-5 text-emerald-600" />
                )}
                {isAnswered && !isCorrect && opt.id === selectedOptionId && (
                  <X className="w-5 h-5 text-rose-600" />
                )}
              </button>
            );
          })}
        </div>

        {isAnswered && (
          <div className="pt-8">
            <button
              type="button"
              onClick={handleNext}
              className="btn btn-primary flex items-center justify-center gap-2"
            >
              {currentIndex + 1 >= queue.length
                ? "Finalizar Quiz"
                : "Próxima Palavra"}{" "}
              <ArrowLeft className="w-4 h-4 rotate-180" />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
