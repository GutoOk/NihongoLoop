import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Eraser,
  ListPlus,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from 'lucide-react';
import { AiJob } from '../types';
import {
  SourcePreparationDiagnosis,
  SourcePreparationEngine,
  SourcePreparationPlan,
} from '../features/ai/SourcePreparationEngine';
import { SourcePreparationRunner } from '../features/ai/SourcePreparationRunner';
import { AiJobRepository } from '../repositories';
import { useModal } from './ModalProvider';
import { getJobHumanName } from './sourcePreparation/jobDisplay';

interface SourcePreparationPanelProps {
  sourceId: string;
  onPreparationComplete: () => void;
  onContentUpdated?: () => void;
}

const PLAN_OPTIONS = {
  translateBatchSize: 30,
  analyzeBatchSize: 10,
  dictionaryBatchSize: 12,
};

export default function SourcePreparationPanel({
  sourceId,
  onPreparationComplete,
  onContentUpdated,
}: SourcePreparationPanelProps) {
  const [diagnosis, setDiagnosis] = useState<SourcePreparationDiagnosis | null>(null);
  const [plan, setPlan] = useState<SourcePreparationPlan | null>(null);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [showGlobal, setShowGlobal] = useState(false);
  const [isRunning, setIsRunning] = useState(SourcePreparationRunner.isRunning);
  const [isBusy, setIsBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const signatureRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const { showConfirm } = useModal();

  useEffect(() => {
    const unsub = SourcePreparationRunner.subscribe(setIsRunning);
    return () => unsub();
  }, []);

  useEffect(() => {
    signatureRef.current = null;
    void refresh();
    const interval = setInterval(() => void refresh(true), 2500);
    return () => clearInterval(interval);
  }, [sourceId, showGlobal]);

  const refresh = async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [nextDiagnosis, nextPlan, sourceJobs] = await Promise.all([
        SourcePreparationEngine.diagnoseSource(sourceId),
        SourcePreparationEngine.buildPlan(sourceId, PLAN_OPTIONS),
        showGlobal ? AiJobRepository.getAll() : AiJobRepository.getByTarget(sourceId),
      ]);
      const signature = JSON.stringify({
        diagnosis: nextDiagnosis.sentences,
        dictionary: nextDiagnosis.dictionary,
        jobs: nextDiagnosis.jobs,
      });
      if (signatureRef.current && signatureRef.current !== signature) onContentUpdated?.();
      signatureRef.current = signature;
      setDiagnosis(nextDiagnosis);
      setPlan(nextPlan);
      setJobs(sourceJobs);
      setLoadError(null);
    } catch (error: any) {
      if (!silent) setLoadError(error?.message || 'Nao foi possivel atualizar o diagnostico da fonte.');
    } finally {
      loadingRef.current = false;
    }
  };

  const queueRealGaps = async () => {
    setIsBusy(true);
    try {
      const result = await SourcePreparationEngine.createQueueForSource(sourceId, PLAN_OPTIONS);
      setPlan(result.plan);
      await refresh();
    } catch (error: any) {
      setLoadError(error?.message || 'Nao foi possivel gerar a fila das pendencias.');
    } finally {
      setIsBusy(false);
    }
  };

  const startProcessing = () => {
    SourcePreparationRunner.start(sourceId, () => void refresh(true));
  };

  const stopProcessing = () => {
    SourcePreparationRunner.stop();
  };

  const retryErrors = async () => {
    setIsBusy(true);
    try {
      if (showGlobal) {
        await SourcePreparationEngine.retryAllErrorJobs();
      } else {
        await SourcePreparationEngine.retryErrorJobs(sourceId);
      }
      await refresh();
    } finally {
      setIsBusy(false);
    }
  };

  const resumeStuck = async () => {
    setIsBusy(true);
    try {
      if (showGlobal) {
        await SourcePreparationEngine.resetAllStuckJobs();
      } else {
        await SourcePreparationEngine.resetStuckJobs(sourceId);
      }
      await refresh();
    } finally {
      setIsBusy(false);
    }
  };

  const clearPending = async () => {
    const scopeLabel = showGlobal ? 'global' : 'desta fonte';
    if (!(await showConfirm('Limpar fila', `Remover tarefas pendentes, com erro e concluídas da fila ${scopeLabel}? Tarefas rodando serao preservadas.`))) {
      return;
    }
    setIsBusy(true);
    try {
      if (showGlobal) {
        await SourcePreparationEngine.clearAllQueueJobs();
      } else {
        await SourcePreparationEngine.clearQueueJobs(sourceId);
      }
      await refresh();
    } finally {
      setIsBusy(false);
    }
  };

  const pendingTotals = useMemo(() => {
    if (!diagnosis) return { translation: 0, analysis: 0, dictionary: 0, total: 0 };
    const translation = diagnosis.sentences.needsAiTranslation;
    const analysis = diagnosis.sentences.withoutValidLexicalAnalysis;
    const dictionary = diagnosis.dictionary.needsAiEntries;
    return { translation, analysis, dictionary, total: translation + analysis + dictionary };
  }, [diagnosis]);

  const plannedActions = plan?.totals.actions || 0;
  const queueCounts = useMemo(() => summarizeJobs(jobs), [jobs]);
  const visibleJobs = useMemo(() => jobs.filter(isVisibleQueueJob), [jobs]);

  return (
    <section className="border-b border-[#E5E5E7] bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900">
                <Database className="h-5 w-5 text-indigo-600" />
                Auditoria de IA da fonte
              </h2>
              <p className="max-w-2xl text-xs leading-relaxed text-slate-500">
                Diagnostica o banco, monta plano e enfileira somente lacunas reais desta fonte.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToolbarButton onClick={() => refresh()} icon={<RefreshCw className="h-4 w-4" />} label="Atualizar diagnostico" />
              <ToolbarButton
                onClick={queueRealGaps}
                disabled={isBusy || plannedActions === 0}
                primary
                icon={<ListPlus className="h-4 w-4" />}
                label="Gerar fila das pendencias reais"
              />
              <ToolbarButton
                onClick={isRunning ? stopProcessing : startProcessing}
                icon={isRunning ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                label={isRunning ? 'Pausar' : 'Iniciar processamento'}
              />
              <ToolbarButton onClick={onPreparationComplete} icon={<CheckCircle2 className="h-4 w-4" />} label="Estudar" />
            </div>
          </div>

          {loadError && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {loadError}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Raio-x da fonte">
              {diagnosis ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric label="Frases totais" value={diagnosis.sentences.total} />
                  <Metric label="Frases unicas" value={diagnosis.sentences.unique} />
                  <Metric label="Repetidas" value={diagnosis.sentences.repeatedInsideSource} />
                  <Metric label="Ja traduzidas" value={diagnosis.sentences.withTranslation} />
                  <Metric label="Sem traducao" value={diagnosis.sentences.withoutTranslation} />
                  <Metric label="Reaproveitaveis" value={diagnosis.sentences.reusableTranslation} />
                  <Metric label="Com analise" value={diagnosis.sentences.withValidLexicalAnalysis} />
                  <Metric label="Sem analise" value={diagnosis.sentences.withoutValidLexicalAnalysis} />
                  <Metric label="Termos" value={diagnosis.terms.found} />
                  <Metric label="Verbetes completos" value={diagnosis.dictionary.completeEntries} />
                  <Metric label="Verbetes incompletos" value={diagnosis.dictionary.incompleteEntries} />
                  <Metric label="Duplicados possiveis" value={diagnosis.jobs.possibleDuplicates} />
                </div>
              ) : (
                <EmptyState text="Carregando diagnostico..." />
              )}
            </Panel>

            <Panel title="Pendencias reais">
              <div className="grid gap-2">
                <PendingLine value={pendingTotals.translation} text="textos unicos precisam de traducao por IA" />
                <PendingLine value={pendingTotals.analysis} text="frases precisam de analise lexical" />
                <PendingLine value={pendingTotals.dictionary} text="verbetes precisam ser completados" />
              </div>
              {pendingTotals.total === 0 && (
                <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                  Nada a fazer para esta fonte.
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Plano de fila antes de gastar IA">
            {plan ? (
              <div className="grid gap-3 sm:grid-cols-5">
                <Metric label="Traducoes" value={plan.totals.translationJobs} />
                <Metric label="Analises" value={plan.totals.lexicalAnalysisJobs} />
                <Metric label="Dicionario" value={plan.totals.dictionaryJobs} />
                <Metric label="Reaproveitar" value={plan.totals.reusableTranslationActions} />
                <Metric label="Jobs novos" value={plan.totals.jobs} />
                <div className="sm:col-span-5 rounded-lg bg-slate-50 p-3 text-xs font-semibold leading-relaxed text-slate-600">
                  O plano roda em esteira: primeiro traducao e reaproveitamento, depois analise lexical, depois dicionario. Cada etapa recalcula o banco antes da proxima.
                </div>
              </div>
            ) : (
              <EmptyState text="Atualize o diagnostico para montar o plano." />
            )}
          </Panel>

          <Panel
            title={showGlobal ? 'Fila global' : 'Fila da fonte'}
            actions={
              <div className="flex flex-wrap gap-2">
                <ToolbarButton small onClick={() => setShowGlobal((value) => !value)} label={showGlobal ? 'Ver fonte' : 'Ver global'} />
                <ToolbarButton small onClick={resumeStuck} disabled={isBusy || !queueCounts.stuck} icon={<RotateCcw className="h-3.5 w-3.5" />} label="Retomar travados" />
                <ToolbarButton small onClick={retryErrors} disabled={isBusy || !queueCounts.error} icon={<RefreshCw className="h-3.5 w-3.5" />} label="Retentar erros" />
                <ToolbarButton small onClick={clearPending} disabled={isBusy || !queueCounts.clearable} icon={<Eraser className="h-3.5 w-3.5" />} label={showGlobal ? 'Limpar fila global' : 'Limpar fila da fonte'} />
              </div>
            }
          >
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Pendentes" value={queueCounts.pending} />
              <Metric label="Rodando" value={queueCounts.running} />
              <Metric label="Erros" value={queueCounts.error} />
              <Metric label="Travados" value={queueCounts.stuck} />
            </div>
            <JobList jobs={visibleJobs} />
          </Panel>
        </div>
      </div>
    </section>
  );
}

function Panel({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-xl font-black text-slate-900">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function PendingLine({ value, text }: { value: number; text: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
      <span className="font-semibold text-slate-600">{text}</span>
      <span className="text-lg font-black text-slate-900">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-500">{text}</div>;
}

function ToolbarButton({
  onClick,
  icon,
  label,
  disabled,
  primary,
  small,
}: {
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  disabled?: boolean;
  primary?: boolean;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-black uppercase tracking-wide disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 ${
        small ? 'h-8 px-2.5 text-[10px]' : 'h-10 px-3 text-xs'
      } ${primary ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function isStuckJob(job: AiJob): boolean {
  if (job.status !== 'running') return false;
  const now = Date.now();
  if (job.locked_until && new Date(job.locked_until).getTime() < now) return true;
  if (!job.locked_until && job.last_heartbeat_at) {
    return now - new Date(job.last_heartbeat_at).getTime() > 5 * 60_000;
  }
  return false;
}

function isClearableQueueJob(job: AiJob): boolean {
  return job.status === 'pending' || job.status === 'error' || job.status === 'completed' || job.status === 'applied' || job.status === 'cancelled';
}

function isVisibleQueueJob(job: AiJob): boolean {
  return job.status === 'pending' || job.status === 'running' || job.status === 'error';
}

function summarizeJobs(jobs: AiJob[]) {
  return {
    pending: jobs.filter((job) => job.status === 'pending').length,
    running: jobs.filter((job) => job.status === 'running').length,
    error: jobs.filter((job) => job.status === 'error').length,
    stuck: jobs.filter(isStuckJob).length,
    clearable: jobs.filter(isClearableQueueJob).length,
  };
}

function JobList({ jobs }: { jobs: AiJob[] }) {
  if (jobs.length === 0) return <EmptyState text="Nenhum job para exibir." />;
  return (
    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
      {jobs.map((job) => {
        const displayLabel = getJobHumanName(job.type);
        const label = getJobLabel(job, displayLabel);
        const input = typeof job.input === 'string' ? {} : job.input || {};
        const itemCount = Array.isArray(input.items) ? input.items.length : 1;
        return (
          <div key={job.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-black text-slate-900">{label}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <span>{displayLabel}</span>
                  <span>{itemCount} itens</span>
                  <span>{job.attempts || 0} tentativas</span>
                  {job.updated_at && <span>{new Date(job.updated_at).toLocaleString()}</span>}
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusClass(job.status)}`}>
                {statusLabel(job.status)}
              </span>
            </div>
            {job.error && (
              <div className="mt-2 rounded border border-rose-100 bg-rose-50 p-2 text-[11px] font-semibold text-rose-700">
                {job.error}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getJobLabel(job: AiJob, fallback: string): string {
  const input = typeof job.input === 'string' ? {} : job.input || {};
  if (typeof input.label === 'string') return input.label;
  return SourcePreparationEngine.getHumanJobLabel(job) || fallback;
}

function statusLabel(status: AiJob['status']): string {
  if (status === 'pending') return 'pendente';
  if (status === 'running') return 'rodando';
  if (status === 'completed' || status === 'applied') return 'concluido';
  if (status === 'error') return 'erro';
  if (status === 'cancelled') return 'cancelado';
  return status;
}

function statusClass(status: AiJob['status']): string {
  if (status === 'running') return 'bg-sky-100 text-sky-700';
  if (status === 'error') return 'bg-rose-100 text-rose-700';
  if (status === 'pending') return 'bg-amber-100 text-amber-700';
  if (status === 'completed' || status === 'applied') return 'bg-emerald-100 text-emerald-700';
  return 'bg-slate-100 text-slate-700';
}
