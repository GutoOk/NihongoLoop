import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  ChevronRight,
  Clock3,
  Layers,
  Play,
  Settings2,
  Star,
  Target,
} from "lucide-react";
import { StudyPlanner, GuidedStudyPlan } from "../features/study/studyPlanner";
import { StudySessionConfig } from "../features/study/studyTypes";
import { Source } from "../types";

interface StudySourceSelectorScreenProps {
  onBack: () => void;
  onStartStandard: (sourceId: string, mode: "sentences" | "words") => void;
  onStartCustom: () => void;
  onStartSession: (config: StudySessionConfig) => void;
}

const sourceTitle = (source?: Source | null) =>
  source?.title || "Fonte sem titulo";

export default function StudySourceSelectorScreen({
  onBack,
  onStartStandard,
  onStartCustom,
  onStartSession,
}: StudySourceSelectorScreenProps) {
  const [plan, setPlan] = useState<GuidedStudyPlan | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    StudyPlanner.buildPlan()
      .then((nextPlan) => {
        if (!active) return;
        setPlan(nextPlan);
        setSelectedSourceId(nextPlan.recommendedSourceId || nextPlan.sources[0]?.id || "");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedSource = useMemo(
    () => plan?.sources.find((source) => source.id === selectedSourceId) || null,
    [plan?.sources, selectedSourceId],
  );

  const startAdaptive = () => {
    if (plan?.recommendedConfig) {
      onStartSession(plan.recommendedConfig);
      return;
    }
    if (selectedSourceId) onStartStandard(selectedSourceId, "sentences");
  };

  const startDueReview = () => {
    onStartSession({
      entityType: "word",
      targetType: "review_due",
      limit: 15,
      order: "due",
      studyMode: "meaning-jp",
      title: "Revisao do que estou esquecendo",
      preset: "due_review",
    });
  };

  const startDifficult = () => {
    onStartSession({
      entityType: "word",
      targetType: "difficult_words",
      limit: 15,
      order: "priority",
      studyMode: "meaning-jp",
      title: "Palavras dificeis",
      preset: "difficult_words",
    });
  };

  return (
    <div className="screen">
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

      <main className="flex-1 overflow-auto p-5 space-y-5 bg-[#F7F8FA]">
        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <Brain className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black text-slate-950">
                Continuar de onde parei
              </h2>
              <p className="text-xs leading-relaxed text-slate-500">
                {loading
                  ? "Montando a melhor sessao para agora..."
                  : plan?.recommendedReason || "Escolha uma fonte para comecar."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={startAdaptive}
            disabled={loading || (!plan?.recommendedConfig && !selectedSourceId)}
            className="btn btn-primary w-full justify-center disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-current" />
            Comecar agora
          </button>
        </section>

        <section className="grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={startDueReview}
            className="rounded-lg border border-slate-200 bg-white p-4 text-left flex items-center gap-3 active:scale-[0.99]"
          >
            <Clock3 className="w-5 h-5 text-rose-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-black text-slate-900">
                Revisar o que estou esquecendo
              </div>
              <div className="text-xs text-slate-500">
                {plan?.dueWordCount || 0} palavras vencidas para revisao.
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300" />
          </button>

          <button
            type="button"
            onClick={startDifficult}
            className="rounded-lg border border-slate-200 bg-white p-4 text-left flex items-center gap-3 active:scale-[0.99]"
          >
            <Target className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-black text-slate-900">
                Treinar palavras dificeis
              </div>
              <div className="text-xs text-slate-500">
                {plan?.difficultWordCount || 0} palavras com mais erros.
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300" />
          </button>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-black text-slate-900">
              Estudar uma fonte especifica
            </h2>
          </div>
          <select
            value={selectedSourceId}
            onChange={(event) => setSelectedSourceId(event.target.value)}
            className="form-select"
          >
            <option value="">Selecione uma fonte...</option>
            {(plan?.sources || []).map((source) => (
              <option key={source.id} value={source.id}>
                {sourceTitle(source)}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => onStartStandard(selectedSourceId, "sentences")}
              disabled={!selectedSourceId}
              aria-label="Frases (Pt→Jp) + Quiz"
              className="btn btn-secondary justify-center disabled:opacity-50"
            >
              <BookOpen className="w-4 h-4" />
              Frases guiadas: {sourceTitle(selectedSource)}
            </button>
            <button
              type="button"
              onClick={() => onStartStandard(selectedSourceId, "words")}
              disabled={!selectedSourceId}
              className="btn bg-emerald-600 hover:bg-emerald-700 text-white justify-center disabled:opacity-50"
            >
              <Star className="w-4 h-4" />
              Palavras da fonte
            </button>
          </div>
        </section>

        {Boolean(plan?.savedCustomSessions.length) && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-black text-slate-900">
              Estudos personalizados salvos
            </h2>
            <div className="space-y-2">
              {plan!.savedCustomSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() =>
                    onStartSession({
                      ...(session.config as StudySessionConfig),
                      title:
                        (session.config as { name?: string })?.name ||
                        session.title ||
                        "Estudo salvo",
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 p-3 text-left flex items-center gap-3"
                >
                  <Settings2 className="w-4 h-4 text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-black text-slate-900 truncate">
                      {(session.config as { name?: string })?.name ||
                        session.title ||
                        "Estudo salvo"}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Toque para continuar com este preset.
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">
              Modo personalizado
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Use quando quiser montar e salvar seu proprio treino.
            </p>
          </div>
          <button
            type="button"
            onClick={onStartCustom}
            className="btn btn-secondary w-full justify-center"
          >
            <Settings2 className="w-4 h-4" />
            Criar estudo personalizado
          </button>
        </section>
      </main>
    </div>
  );
}
