import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  Loader2,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Source } from "../types";
import { GuidedStudyPlan, StudyPlanner } from "../features/study/studyPlanner";

interface StudySourceSelectorScreenProps {
  onBack: () => void;
  onStartStandard: (sourceId: string, mode: "sentences" | "words") => void;
  onStartCustom: () => void;
  onStartSession: (config: Record<string, unknown>) => void;
}

export default function StudySourceSelectorScreen({
  onBack,
  onStartStandard,
  onStartCustom,
  onStartSession,
}: StudySourceSelectorScreenProps) {
  const [plan, setPlan] = useState<GuidedStudyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    StudyPlanner.buildPlan()
      .then((nextPlan) => {
        if (cancelled) return;
        setPlan(nextPlan);
        setSelectedSource(nextPlan.recommendedSourceId || nextPlan.sources[0]?.id || "");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSourceTitle = useMemo(() => {
    return plan?.sources.find((source) => source.id === selectedSource)?.title || "";
  }, [plan, selectedSource]);

  const startRecommended = () => {
    if (!plan) return;
    if (plan.recommendedConfig) {
      onStartSession(plan.recommendedConfig);
      return;
    }
    if (plan.recommendedSourceId) {
      onStartStandard(plan.recommendedSourceId, "sentences");
    }
  };

  const hasSources = Boolean(plan?.sources.length);

  return (
    <div className="screen bg-white">
      <header className="screen-header">
        <button
          type="button"
          onClick={onBack}
          className="btn-back"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="screen-title">Estudar</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-5">
        {loading ? (
          <div className="empty-state">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
            <span className="text-sm font-semibold text-[#86868B]">
              Montando uma sessão boa para agora...
            </span>
          </div>
        ) : !plan || !hasSources ? (
          <div className="empty-state">
            <BookOpen className="h-8 w-8 text-[#86868B]" />
            <p className="max-w-xs text-center text-sm text-[#86868B]">
              Importe uma fonte primeiro. O estudo funciona melhor com frases reais preparadas.
            </p>
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">
                  Sessão recomendada
                </p>
                <h2 className="text-xl font-black tracking-tight text-[#1D1D1F]">
                  Comece pequeno, revise melhor
                </h2>
                <p className="text-xs leading-relaxed text-[#86868B]">
                  {plan.recommendedReason}
                </p>
              </div>

              <button
                type="button"
                onClick={startRecommended}
                disabled={!plan.recommendedConfig && !plan.recommendedSourceId}
                className="w-full rounded-2xl bg-indigo-600 px-4 py-4 text-left text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black uppercase tracking-wide">
                      Começar agora
                    </span>
                    <span className="block text-xs text-indigo-100">
                      {plan.recommendedConfig
                        ? "O sistema escolhe a revisão mais útil."
                        : `Continuar ${plan.recommendedSourceTitle || "fonte"}.`}
                    </span>
                  </span>
                </span>
              </button>
            </section>

            <section className="grid grid-cols-1 gap-3">
              <PathButton
                icon={<RotateCcw className="h-4 w-4" />}
                title="Revisar o que estou esquecendo"
                description={`${plan.dueWordCount} palavra${plan.dueWordCount === 1 ? "" : "s"} para recuperação ativa.`}
                disabled={plan.dueWordCount === 0}
                onClick={() =>
                  onStartSession({
                    entityType: "word",
                    targetType: "review_due",
                    limit: 15,
                    order: "due",
                    studyMode: "meaning-jp",
                  })
                }
              />
              <PathButton
                icon={<Play className="h-4 w-4 fill-current" />}
                title="Continuar de onde parei"
                description={
                  plan.recommendedSourceTitle
                    ? `${plan.recommendedSourceTitle} - próximo bloco curto.`
                    : "Nenhuma fonte disponível."
                }
                disabled={!plan.recommendedSourceId}
                onClick={() => onStartStandard(plan.recommendedSourceId, "sentences")}
              />
              <PathButton
                icon={<Dumbbell className="h-4 w-4" />}
                title="Treinar palavras difíceis"
                description={`${plan.difficultWordCount} palavra${plan.difficultWordCount === 1 ? "" : "s"} com erro, baixa memória ou dificuldade.`}
                disabled={plan.difficultWordCount === 0}
                onClick={() =>
                  onStartSession({
                    entityType: "word",
                    targetType: "difficult_words",
                    limit: 15,
                    order: "priority",
                    studyMode: "meaning-jp",
                  })
                }
              />
            </section>

            <section className="space-y-3 border-t border-[#E5E5E7] pt-4">
              <div className="space-y-1">
                <h3 className="text-sm font-black text-[#1D1D1F]">
                  Estudar uma fonte específica
                </h3>
                <p className="text-xs leading-relaxed text-[#86868B]">
                  Use quando quiser manter contexto e aprender com frases reais em ordem.
                </p>
              </div>

              <select
                value={selectedSource}
                onChange={(event) => setSelectedSource(event.target.value)}
                className="form-select"
              >
                {plan.sources.map((source: Source) => (
                  <option key={source.id} value={source.id}>
                    {source.title || "Fonte sem título"}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-label="Frases (Pt→Jp) + Quiz"
                  onClick={() => onStartStandard(selectedSource, "sentences")}
                  disabled={!selectedSource}
                  className="btn btn-primary"
                >
                  <BookOpen className="w-4 h-4" />
                  Frases guiadas
                </button>
                <button
                  type="button"
                  onClick={() => onStartStandard(selectedSource, "words")}
                  disabled={!selectedSource}
                  className="btn bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Brain className="w-4 h-4" />
                  Palavras da fonte
                </button>
              </div>

              {selectedSourceTitle && (
                <p className="text-[11px] font-semibold text-slate-400">
                  Fonte selecionada: {selectedSourceTitle}
                </p>
              )}
            </section>

            <section className="border-t border-[#E5E5E7] pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((value) => !value)}
                className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-black text-slate-800">
                  <Settings2 className="h-4 w-4 text-slate-500" />
                  Modo personalizado
                </span>
                {showAdvanced ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs leading-relaxed text-[#86868B]">
                    Ajuste tipo de conteúdo, quantidade, ordem e modo de áudio quando quiser praticar algo específico.
                  </p>
                  <button
                    type="button"
                    onClick={onStartCustom}
                    className="btn btn-secondary"
                  >
                    Abrir configurações
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function PathButton({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-2xl border border-[#E5E5E7] bg-white p-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50/30 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-black text-[#1D1D1F]">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-[#86868B]">
          {description}
        </span>
      </span>
    </button>
  );
}
