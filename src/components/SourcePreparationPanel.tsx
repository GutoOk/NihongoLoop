import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  PreparationOptions,
  SourcePreparationService,
} from "../features/ai/SourcePreparationService";
import {
  SourcePreparationRepository,
  SourcePreparationStats,
} from "../repositories";
import { GlobalAiQueueControl } from "./GlobalAiQueueControl";

interface SourcePreparationPanelProps {
  sourceId: string;
  onPreparationComplete: () => void;
  onContentUpdated?: () => void;
}

type PhaseMode = "translate" | "analyze" | "dictionary";

interface PhaseView {
  mode: PhaseMode;
  title: string;
  purpose: string;
  total: number;
  missing: number;
  done: number;
}

const DEFAULT_OPTIONS: PreparationOptions = {
  translateBatchSize: 30,
  analyzeBatchSize: 10,
  dictFastBatchSize: 40,
  dictFullBatchSize: 12,
  dictMode: "full",
  useCache: true,
  overwriteReviewed: false,
};

export default function SourcePreparationPanel({
  sourceId,
  onPreparationComplete,
  onContentUpdated,
}: SourcePreparationPanelProps) {
  const [stats, setStats] = useState<SourcePreparationStats | null>(null);
  const [options, setOptions] = useState<PreparationOptions>(DEFAULT_OPTIONS);
  const [showSettings, setShowSettings] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const loadingRef = useRef(false);
  const statsRef = useRef<SourcePreparationStats | null>(null);

  useEffect(() => {
    loadPanel();
    const interval = setInterval(loadPanel, 2000);
    return () => clearInterval(interval);
  }, [sourceId]);

  const loadPanel = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const sourceStats = await SourcePreparationRepository.getStats(sourceId);
      
      const prevStatsStr = JSON.stringify(statsRef.current);
      const newStatsStr = JSON.stringify(sourceStats);
      if (statsRef.current && prevStatsStr !== newStatsStr) {
        if (onContentUpdated) onContentUpdated();
      }
      statsRef.current = sourceStats;
      
      setStats(sourceStats);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message || "Não foi possível atualizar a preparação.");
    } finally {
      loadingRef.current = false;
    }
  };

  const phases = useMemo<PhaseView[]>(() => {
    const s = stats || {
      sTotal: 0,
      sNoTrans: 0,
      sMissingAnalysis: 0,
      dictTotal: 0,
      dictPending: 0,
    } as SourcePreparationStats;
    return [
      {
        mode: "translate",
        title: "Tradução natural",
        purpose: "Criar português brasileiro natural por frase. Só envia frases sem tradução.",
        total: s.sTotal,
        missing: s.sNoTrans,
        done: Math.max(0, s.sTotal - s.sNoTrans),
      },
      {
        mode: "analyze",
        title: "Leitura e termos",
        purpose: "Gerar kana/romaji e detectar blocos lexicais clicáveis.",
        total: s.sTotal,
        missing: s.sMissingAnalysis,
        done: Math.max(0, s.sTotal - s.sMissingAnalysis),
      },
      {
        mode: "dictionary",
        title: "Dicionário e sentidos",
        purpose: "Completar verbetes, formas e sentidos apenas para termos usados nesta fonte.",
        total: s.dictTotal || s.dictPending,
        missing: s.dictPending,
        done: Math.max(0, (s.dictTotal || s.dictPending) - s.dictPending),
      },
    ];
  }, [stats]);

  const isDone = phases.every((phase) => phase.missing === 0);
  const totalMissing = phases.reduce((sum, phase) => sum + phase.missing, 0);

  const start = async (runMode: "all" | PhaseMode = "all") => {
    setIsPreparing(true);
    const runOptions = { ...options, runMode };
    try {
      let run = await ProcessingRunRepository.getActiveRun(sourceId);
      if (!run) {
        run = await ProcessingRunRepository.createRun(sourceId, runMode);
      }
      if (run) {
         await SourcePreparationService.prepareSource(sourceId, runOptions, run.id);
      }
    } catch(e: any) {
      setLoadError(e.message);
    } finally {
      setIsPreparing(false);
      loadPanel();
    }
  };

  const updateOptions = (patch: Partial<PreparationOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
  };

  return (
    <div className="border-b border-[#E5E5E7] bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900">
                <Sparkles className="h-5 w-5 text-indigo-600" />
                Preparar com IA
              </h2>
              <p className="max-w-2xl text-xs leading-relaxed text-slate-500">
                Pipeline em etapas: traduz, analisa termos e enriquece o dicionário.
                As tarefas geradas serão adicionadas à fila do servidor.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <button
                onClick={() => setShowSettings((value) => !value)}
                className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 sm:w-10"
                title="Ajustes de economia e velocidade"
              >
                <Settings2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => start("all")}
                disabled={isDone || totalMissing === 0 || isPreparing}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto"
              >
                <Zap className="h-4 w-4" />
                {isPreparing ? "Enfileirando..." : "Preparar tudo"}
              </button>
              <button
                onClick={onPreparationComplete}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50 sm:w-auto"
              >
                Estudar
              </button>
            </div>
          </div>

          <GlobalAiQueueControl />

          {showSettings && (
            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 font-bold text-slate-700">
                Reusar cache
                <input
                  type="checkbox"
                  checked={options.useCache}
                  onChange={(event) => updateOptions({ useCache: event.target.checked })}
                  className="h-4 w-4 rounded text-indigo-600"
                />
              </label>
            </div>
          )}

          {loadError && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {loadError}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {phases.map((phase) => (
              <PhaseCard
                key={phase.mode}
                phase={phase}
                onStart={() => start(phase.mode)}
                isPreparing={isPreparing}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhaseCard({
  phase,
  onStart,
  isPreparing,
}: {
  phase: PhaseView;
  onStart: () => void;
  isPreparing: boolean;
}) {
  const complete = phase.missing === 0;
  const percent = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : complete ? 100 : 0;

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-4 space-y-1">
        <h3 className="font-bold text-slate-800">{phase.title}</h3>
        <p className="text-[10px] leading-relaxed text-slate-500">
          {phase.purpose}
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {complete ? (
                <span className="text-emerald-600">Completo</span>
              ) : (
                `${phase.missing} pendências`
              )}
            </div>
          </div>
          <div className="text-xl font-black text-slate-900">{percent}%</div>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(complete ? 100 : 4, percent)}%` }} />
        </div>

        <button
          onClick={onStart}
          disabled={isPreparing || complete}
          className="w-full rounded-xl bg-slate-50 py-2.5 text-xs font-black uppercase tracking-wide text-indigo-600 hover:bg-slate-100 hover:text-indigo-900 disabled:opacity-50"
        >
          {complete ? "Concluído" : "Preparar Etapa"}
        </button>
      </div>
    </div>
  );
}
