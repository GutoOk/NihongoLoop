import React, { useState, useEffect } from "react";
import StudyPlayerScreen from "./StudyPlayerScreen";
import StandardWordsQuizScreen from "./StandardWordsQuizScreen";
import { SentenceRepository, TermRepository, StudySessionRepository } from "../repositories";
import { Sentence, SentenceTerm } from "../types";
import { AppNavigate } from "../navigation";

interface StandardStudyFlowContainerProps {
  sourceId: string;
  mode?: "sentences" | "words";
  onBack: () => void;
  onNavigate: AppNavigate;
}

export default function StandardStudyFlowContainer({
  sourceId,
  mode = "sentences",
  onBack,
  onNavigate,
}: StandardStudyFlowContainerProps) {
  const [step, setStep] = useState<"study" | "quiz" | "summary">("study");
  const [offset, setOffset] = useState(0);
  const [targetSentenceIds, setTargetSentenceIds] = useState<string[]>([]);
  const [quizTargetEntryIds, setQuizTargetEntryIds] = useState<string[]>([]);
  const [lastAccuracy, setLastAccuracy] = useState(0);
  const [isPreparingQuiz, setIsPreparingQuiz] = useState(false);
  const [preparationError, setPreparationError] = useState("");

  useEffect(() => {
    // Load offset from Supabase
    StudySessionRepository.getSourceOffset(sourceId).then((val) => {
      setOffset(val);
    });
  }, [sourceId]);

  const loadEntryIdsForQuiz = async (flowIds: string[]) => {
    if (mode === "sentences") {
      let terms = await TermRepository.getBySentences(flowIds);

      // O fluxo de palavras já força a detecção de termos quando eles ainda não existem.
      // O fluxo de frases precisa do mesmo fallback, senão no celular/primeiro uso ele
      // termina o estudo e fica sem palavras para montar o quiz.
      if (!terms || terms.length === 0) {
        const { TermDetectionService } = await import(
          "../services/termDetectionService"
        );
        await TermDetectionService.detectWordsInSentences(flowIds);
        terms = await TermRepository.getBySentences(flowIds);
      }

      const validEntryIds = Array.from(
        new Set(terms.map((t) => t.dictionary_entry_id).filter(Boolean)),
      ) as string[];
      setQuizTargetEntryIds(validEntryIds);
      return validEntryIds;
    } else {
      // In word flow, the flowIds ARE the dictionary entry IDs (from items)
      const validEntryIds = Array.from(new Set(flowIds));
      setQuizTargetEntryIds(validEntryIds);
      return validEntryIds;
    }
  };

  const handleStudyFinish = async (flowIds: string[]) => {
    if (isPreparingQuiz) return;
    setIsPreparingQuiz(true);
    setPreparationError("");
    try {
      if (mode === "sentences") {
        setTargetSentenceIds(flowIds);
      }
      const targetIds = await loadEntryIdsForQuiz(flowIds);
      if (targetIds.length === 0) {
        setPreparationError(
          mode === "sentences"
            ? "Não encontrei palavras vinculadas a este bloco. Prepare/detecte os termos da fonte e tente novamente."
            : "Nenhuma palavra válida foi encontrada neste bloco.",
        );
        setStep("summary");
      } else {
        setStep("quiz");
      }
    } catch (err: any) {
      console.error("Failed to load quiz target entries:", err);
      setPreparationError(
        "Não consegui montar o quiz deste bloco. Tente novamente ou reabra a fonte.",
      );
      setStep("summary");
    } finally {
      setIsPreparingQuiz(false);
    }
  };

  const handleQuizFinish = (accuracy: number) => {
    setLastAccuracy(accuracy);
    setStep("summary");
  };

  if (step === "study") {
    const config = {
      entityType: mode === "sentences" ? "sentence" : "word",
      targetType: mode === "sentences" ? "standard_flow" : "standard_word_flow",
      sourceId: sourceId,
      limit: 10,
      offset: offset,
      order: "original",
      studyMode: "pt-jp-jp",
    };

    return (
      <StudyPlayerScreen
        config={config}
        onBack={onBack}
        onNavigate={onNavigate}
        onFinishStandardFlow={handleStudyFinish}
        isFinishingStandardFlow={isPreparingQuiz}
      />
    );
  }

  if (step === "quiz") {
    return (
      <StandardWordsQuizScreen
        entryIds={quizTargetEntryIds}
        onBack={handleQuizFinish}
        reverseMode={mode === "words"}
      />
    );
  }

  return (
    <div className="screen items-center justify-center p-6 space-y-6">
      <h2 className="text-2xl font-black text-gray-900">Etapa Concluída</h2>
      <p className="text-center text-gray-600">
        Você finalizou o estudo deste bloco e do quiz correspondente. Se você
        acertou consistentemente as palavras nas últimas vezes que apareceram,
        avance para o próximo bloco.
      </p>

      {preparationError && (
        <div className="bg-rose-50 text-rose-700 p-4 rounded-xl text-center w-full max-w-sm text-sm font-bold">
          {preparationError}
        </div>
      )}

      {lastAccuracy >= 0.6 && (
        <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl text-center w-full max-w-sm text-sm font-bold">
          Ótimo rendimento! Você pode avançar com tranquilidade.
        </div>
      )}
      {lastAccuracy < 0.6 && lastAccuracy > 0 && (
        <div className="bg-amber-50 text-amber-700 p-4 rounded-xl text-center w-full max-w-sm text-sm font-bold">
          Taxa de acerto abaixo do ideal. Sugerimos rever o estudo ou quiz deste
          bloco.
        </div>
      )}

      <div className="flex flex-col gap-3 w-full max-w-sm mt-4">
        <button
          type="button"
          onClick={() => setStep("quiz")}
          disabled={quizTargetEntryIds.length === 0}
          className="btn btn-secondary disabled:opacity-50"
        >
          Refazer Quiz (Mesmas Palavras)
        </button>
        <button
          type="button"
          onClick={() => setStep("study")}
          className="btn btn-secondary"
        >
          Rever Estudo (Mesmo Bloco)
        </button>
        <button
          type="button"
          onClick={async () => {
            const finalOffset = offset + 10;
            setOffset(finalOffset);
            await StudySessionRepository.saveSourceOffset(sourceId, finalOffset);
            setStep("study");
          }}
          className="btn btn-primary"
        >
          Próximo Bloco
        </button>

        <button
          type="button"
          onClick={onBack}
          className="w-full py-4 text-[#86868B] hover:text-[#1D1D1F] font-bold uppercase tracking-wider text-xs mt-4 transition-colors"
        >
          Sair do Estudo
        </button>
      </div>
    </div>
  );
}
