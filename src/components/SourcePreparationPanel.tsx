import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ListPlus,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  PreparationOptions,
  SourcePreparationService,
} from "../features/ai/SourcePreparationService";
import {
  ProcessingRunRepository,
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
  actionLabel: string;
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

const EMPTY_STATS: SourcePreparationStats = {
  sTotal: 0,
  sNoTrans: 0,
  sNoRead: 0,
  sNoTerms: 0,
  sMissingAnalysis: 0,
  dictTotal: 0,
  dictPending: 0,
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
  const [isQueueing, setIsQueueing] = useState(false);
  const [lastQueuedLabel, setLastQueuedLabel] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const statsSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    statsSignatureRef.current = null;
    loadStats();
    const interval = setInterval(() => loadStats(true), 2000);
    return () => clearInterval(interval);
  }, [sourceId]);

  const loadStats = async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const sourceStats = await SourcePreparationRepository.getStats(sourceId);
      const signature = JSON.stringify(sourceStats);
      if (statsSignatureRef.current && statsSignatureRef.current !== signature) {
        onContentUpdated?.();
      }
      statsSignatureRef.current = signature;
      setStats(sourceStats);
      setLoadError(null);
    } catch (error: any) {
      if (!silent) {
        setLoadError(error?.message || "Não foi possível atualizar o diagnóstico da fonte.");
      }
    } finally {
      loadingRef.current = false;
    }
  };

  const phases = useMemo<PhaseView[]>(() => {
    const s = stats || EMPTY_STATS;
    return [
      {
        mode: "translate",
        title: "Tradução natural",
        purpose: "Cria português brasileiro natural somente para frases sem tradução.",
        total: s.sTotal,
        missing: s.sNoTrans,
        done: Math.max(0, s.sTotal - s.sNoTrans),
        actionLabel: "Adicionar traduções",
      },
      {
        mode: "analyze",
        title: "Leitura e termos",
        purpose: "Gera kana, romaji e termos clicáveis para frases sem análise real.",
        total: s.sTotal,
        missing: s.sMissingAnalysis,
        done: Math.max(0, s.sTotal - s.sMissingAnalysis),
        actionLabel: "Adicionar análises",
      },
      {
        mode: "dictionary",
        title: "Dicionário e sentidos",
        purpose: "Completa apenas os verbetes usados nesta fonte que ainda têm lacunas.",
        total: s.dictTotal || s.dictPending,
        missing: s.dictPending,
        done: Math.max(0, (s.dictTotal || s.dictPending) - s.dictPending),
        actionLabel: "Adicionar dicionário",
      },
    ];
  }, [stats]);

  const totalMissing = phases.reduce((sum, phase) => sum + phase.missing, 0);
  const totalDone = phases.reduce((sum, phase) => sum + phase.done, 0);
  const totalWork = Math.max(1, phases.reduce((sum, phase) => sum + Math.max(phase.total, phase.missing), 0));
  const overallPercent = totalMissing === 0 ? 100 : Math.round((totalDone / totalWork) * 100);
  const allDone = totalMissing === 0;

  const queuePreparation = async (runMode: "all" | PhaseMode) => {
    setIsQueueing(true);
    setLastQueuedLabel(null);
    try {
      const run = await ProcessingRunRepository.createRun(sourceId, runMode);
      if (run) {
        await SourcePreparationService.prepareSource(sourceId, { ...options, runMode }, run.id);
      }
      setLastQueuedLabel(runMode === "all" ? "As tarefas possíveis agora foram enviadas para a fila." : "Etapa enviada para a fila.");
      await loadStats();
    } catch (error: any) {
      setLoadError(error?.message || "Não foi possível adicionar tarefas à fila.");
    } finally {
      setIsQueueing(false);
    }
  };

  const updateOptions = (patch: Partial<PreparationOptions>) => {
    setOptions((current) => ({ ...current, ...patch }));
  };

  return (
    <section className="border-b border-[#E5E5E7] bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <h2 className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900">
                  <Sparkles className="h-5 w-5 text-indigo-600" />
                  Preparar com IA
                </h2>
                <p className="max-w-2xl text-xs leading-relaxed text-slate-500">
                  Diagnostica a fonte pelo banco real e adiciona à fila única somente o que falta.
                  A fila não inicia sozinha.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <button
                  onClick={() => loadStats()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Atualizar
                </button>
                <button
                  onClick={() => setShowSettings((value) => !value)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50"
                >
                  <Settings2 className="h-4 w-4" />
                  Ajustes
                </button>
                <button
                  onClick={() => queuePreparation("all")}
                  disabled={allDone || isQueueing}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-black uppercase tracking-wide text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <ListPlus className="h-4 w-4" />
                  {isQueueing ? "Enfileirando..." : "Adicionar tudo à fila"}
                </button>
                <button
                  onClick={onPreparationComplete}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50"
                >
                  Estudar
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {allDone ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Clock3 className="h-4 w-4 text-amber-600" />
                    )}
                    <span className="text-xs font-black uppercase tracking-wide text-slate-700">
                      {allDone ? "Fonte pronta para estudar" : `${totalMissing} pendências reais encontradas`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Tradução, leitura, termos e dicionário são recalculados ao abrir a fonte.
                  </p>
                </div>
                <div className="text-3xl font-black text-slate-900">{overallPercent}%</div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                  style={{ width: `${Math.max(allDone ? 100 : 5, overallPercent)}%` }}
                />
              </div>
            </div>

            {showSettings && (
              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs sm:grid-cols-3">
                <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 font-bold text-slate-700">
                  Reusar cache
                  <input
                    type="checkbox"
                    checked={options.useCache}
                    onChange={(event) => updateOptions({ useCache: event.target.checked })}
                    className="h-4 w-4 rounded text-indigo-600"
                  />
                </label>
                <NumberOption
                  label="Frases por tradução"
                  value={options.translateBatchSize}
                  min={5}
                  max={80}
                  onChange={(value) => updateOptions({ translateBatchSize: value })}
                />
                <NumberOption
                  label="Frases por análise"
                  value={options.analyzeBatchSize}
                  min={2}
                  max={30}
                  onChange={(value) => updateOptions({ analyzeBatchSize: value })}
                />
                <NumberOption
                  label="Verbetes por lote"
                  value={options.dictFullBatchSize}
                  min={4}
                  max={40}
                  onChange={(value) => updateOptions({ dictFullBatchSize: value })}
                />
              </div>
            )}

            {loadError && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {loadError}
              </div>
            )}

            {lastQueuedLabel && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                {lastQueuedLabel}
              </div>
            )}

            <div className="flex flex-col gap-3">
              {phases.map((phase) => (
                <PhaseRow
                  key={phase.mode}
                  phase={phase}
                  disabled={isQueueing}
                  onQueue={() => queuePreparation(phase.mode)}
                />
              ))}
            </div>

            <GlobalAiQueueControl />
          </div>
        </div>
      </div>
    </section>
  );
}

function PhaseRow({
  phase,
  disabled,
  onQueue,
}: {
  phase: PhaseView;
  disabled: boolean;
  onQueue: () => void;
  key?: React.Key;
}) {
  const complete = phase.missing === 0;
  const percent = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : complete ? 100 : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-black text-slate-900">{phase.title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                complete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {complete ? "Completo" : `${phase.missing} pendências`}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">{phase.purpose}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="w-16 text-right text-xl font-black text-slate-900">{percent}%</div>
          <button
            onClick={onQueue}
            disabled={disabled || complete}
            className="inline-flex h-9 items-center justify-center rounded-xl bg-slate-900 px-3 text-xs font-black uppercase tracking-wide text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {complete ? "Pronto" : phase.actionLabel}
          </button>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all duration-500"
          style={{ width: `${Math.max(complete ? 100 : 5, percent)}%` }}
        />
      </div>
    </div>
  );
}

function NumberOption({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 font-bold text-slate-700">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-20 rounded-lg border border-slate-200 bg-white px-2 text-right font-black text-slate-900 outline-none"
      />
    </label>
  );
}
