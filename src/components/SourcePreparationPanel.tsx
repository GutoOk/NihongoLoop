import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Database,
  ListPlus,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from 'lucide-react';
import { AiJob, ProcessingRun } from '../types';
import {
  SourcePreparationDiagnosis,
  SourcePreparationEngine,
  SourcePreparationPlan,
} from '../features/ai/SourcePreparationEngine';
import { AiJobRepository, ProcessingRunRepository } from '../repositories';
import { useModal } from './ModalProvider';
import { getJobHumanName } from './sourcePreparation/jobDisplay';

interface SourcePreparationPanelProps {
  sourceId: string;
  onPreparationComplete: () => void;
  onContentUpdated?: () => void;
}

const PLAN_OPTIONS = {
  translateBatchSize: 1,
  analyzeBatchSize: 1,
  dictionaryBatchSize: 1,
};

export default function SourcePreparationPanel({
  sourceId,
  onPreparationComplete,
  onContentUpdated,
}: SourcePreparationPanelProps) {
  const [diagnosis, setDiagnosis] = useState<SourcePreparationDiagnosis | null>(null);
  const [plan, setPlan] = useState<SourcePreparationPlan | null>(null);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [run, setRun] = useState<ProcessingRun | null>(null);
  const [showGlobal, setShowGlobal] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const signatureRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const { showConfirm } = useModal();

  useEffect(() => {
    signatureRef.current = null;
    void refresh();
    const interval = setInterval(() => void refresh(true), 15000);
    return () => clearInterval(interval);
  }, [sourceId, showGlobal]);

  const refresh = async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [nextPlan, latestRun] = await Promise.all([
        SourcePreparationEngine.buildPlan(sourceId, PLAN_OPTIONS),
        showGlobal ? Promise.resolve(null) : ProcessingRunRepository.getLatestRunBySource(sourceId),
      ]);
      const nextDiagnosis = nextPlan.diagnosis;
      const sourceJobs = showGlobal
        ? await AiJobRepository.getAll()
        : latestRun
          ? await AiJobRepository.getByRun(latestRun.id, 100)
          : await AiJobRepository.getBySource(sourceId);
      const signature = JSON.stringify({
        diagnosis: nextDiagnosis.sentences,
        dictionary: nextDiagnosis.dictionary,
        jobs: nextDiagnosis.jobs,
        run: latestRun ? {
          status: latestRun.status,
          pending: latestRun.pending_jobs,
          running: latestRun.running_jobs,
          completed: latestRun.completed_jobs,
          failed: latestRun.failed_items,
        } : null,
      });
      if (signatureRef.current && signatureRef.current !== signature) onContentUpdated?.();
      signatureRef.current = signature;
      setDiagnosis(nextDiagnosis);
      setPlan(nextPlan);
      setRun(latestRun);
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
      const result = await ProcessingRunRepository.startSourceProcessingRun(sourceId, 'all');
      if (result?.run_id) {
        const latestRun = await ProcessingRunRepository.getRun(result.run_id);
        if (latestRun) setRun(latestRun);
      }
      await refresh();
    } catch (error: any) {
      setLoadError(error?.message || 'Nao foi possivel gerar a fila das pendencias.');
    } finally {
      setIsBusy(false);
    }
  };

  const startProcessing = async () => {
    await queueRealGaps();
  };

  const retryProblems = async () => {
    setIsBusy(true);
    try {
      if (showGlobal) {
        await SourcePreparationEngine.retryAllProblemJobs();
      } else if (run) {
        await SourcePreparationEngine.retryProblemJobsByRun(run.id);
      } else {
        await SourcePreparationEngine.retryProblemJobs(sourceId);
      }
      await refresh();
    } finally {
      setIsBusy(false);
    }
  };

  const cancelPending = async () => {
    const scopeLabel = showGlobal ? 'global' : 'desta fonte';
    if (!(await showConfirm('Cancelar jobs nao concluidos', `Isso vai marcar como cancelados os jobs ${scopeLabel} que ainda estejam pendentes, reivindicados, rodando, em retry ou em revisao. Historico e resultados ja concluidos permanecem para auditoria.`))) {
      return;
    }
    setIsBusy(true);
    try {
      if (showGlobal) {
        await SourcePreparationEngine.cancelAllActiveJobs();
      } else if (run) {
        await SourcePreparationEngine.cancelRun(run.id);
      } else {
        await SourcePreparationEngine.cancelSourceActiveJobs(sourceId);
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
                onClick={startProcessing}
                disabled={isBusy}
                icon={<Play className="h-4 w-4" />}
                label="Criar/retomar execucao"
              />
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
                  O plano roda em esteira com jobs individuais em paralelo: primeiro traducao e reaproveitamento, depois analise lexical, depois dicionario. Cada etapa recalcula o banco antes da proxima.
                </div>
              </div>
            ) : (
              <EmptyState text="Atualize o diagnostico para montar o plano." />
            )}
          </Panel>

          <Panel title="Execucao persistida">
            {run ? (
              <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
                <Metric label="Status" valueText={statusLabel(run.status)} />
                <Metric label="Planejados" value={run.planned_jobs || run.created_jobs || 0} />
                <Metric label="Pendentes" value={run.pending_jobs || 0} />
                <Metric label="Rodando" value={run.running_jobs || 0} />
                <Metric label="Concluidos" value={run.completed_jobs || 0} />
                <Metric label="Retry" value={run.retry_jobs || 0} />
                <Metric label="Revisao" value={run.review_jobs || 0} />
                <Metric label="Falhas" value={run.failed_items || 0} />
                <div className="sm:col-span-4 lg:col-span-8 rounded-lg bg-slate-50 p-3 text-xs font-semibold leading-relaxed text-slate-600">
                  {run.current_step || 'Execucao criada. O worker persistente consome os jobs sem depender desta tela.'}
                </div>
              </div>
            ) : (
              <EmptyState text="Nenhuma execucao persistida encontrada para esta fonte." />
            )}
          </Panel>

          <Panel
            title={showGlobal ? 'Fila global' : 'Fila da fonte'}
            actions={
              <div className="flex flex-wrap gap-2">
                <ToolbarButton small onClick={() => setShowGlobal((value) => !value)} label={showGlobal ? 'Ver fonte' : 'Ver global'} />
                <ToolbarButton small onClick={retryProblems} disabled={isBusy || queueCounts.error + queueCounts.stuck + queueCounts.retry + queueCounts.review === 0} icon={<RotateCcw className="h-3.5 w-3.5" />} label="Retentar problemas" />
                <ToolbarButton small onClick={cancelPending} disabled={isBusy || jobs.length === 0} icon={<Square className="h-3.5 w-3.5" />} label={showGlobal ? 'Cancelar fila global ativa' : 'Cancelar nao concluidos'} />
              </div>
            }
          >
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              <Metric label="Pendentes" value={queueCounts.pending} />
              <Metric label="Rodando" value={queueCounts.running} />
              <Metric label="Retry" value={queueCounts.retry} />
              <Metric label="Revisao" value={queueCounts.review} />
              <Metric label="Concluidos" value={queueCounts.completed} />
              <Metric label="Erros" value={queueCounts.error} />
              <Metric label="Cancelados" value={queueCounts.cancelled} />
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

function Metric({ label, value, valueText }: { label: string; value?: number; valueText?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-xl font-black text-slate-900">{valueText ?? value ?? 0}</div>
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
  if (job.status !== 'running' && job.status !== 'claimed') return false;
  const now = Date.now();
  const leaseExpiresAt = job.lease_expires_at || job.locked_until;
  if (leaseExpiresAt && new Date(leaseExpiresAt).getTime() < now) return true;
  if (!job.locked_until && job.last_heartbeat_at) {
    return now - new Date(job.last_heartbeat_at).getTime() > 5 * 60_000;
  }
  return false;
}

function isClearableQueueJob(job: AiJob): boolean {
  return job.status === 'pending' || job.status === 'error' || job.status === 'completed' || job.status === 'applied' || job.status === 'cancelled';
}

function isVisibleQueueJob(job: AiJob): boolean {
  return !['obsolete'].includes(job.status);
}

function summarizeJobs(jobs: AiJob[]) {
  return {
    pending: jobs.filter((job) => job.status === 'pending').length,
    running: jobs.filter((job) => job.status === 'running' || job.status === 'claimed').length,
    retry: jobs.filter((job) => job.status === 'retry_wait').length,
    review: jobs.filter((job) => job.status === 'needs_review').length,
    completed: jobs.filter((job) => job.status === 'completed' || job.status === 'applied').length,
    cancelled: jobs.filter((job) => job.status === 'cancelled').length,
    error: jobs.filter((job) => job.status === 'error' || job.status === 'failed').length,
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
                  <span>{job.target_type}:{job.target_id}</span>
                  <span>{itemCount} itens</span>
                  <span>{job.attempts || 0} tentativas</span>
                  {job.worker_id && <span>{job.worker_id}</span>}
                  {job.latency_ai_ms ? <span>IA {job.latency_ai_ms}ms</span> : null}
                  {job.latency_persist_ms ? <span>DB {job.latency_persist_ms}ms</span> : null}
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

function statusLabel(status: AiJob['status'] | ProcessingRun['status']): string {
  if (status === 'pending') return 'pendente';
  if (status === 'planning') return 'planejando';
  if (status === 'paused') return 'pausado';
  if (status === 'running') return 'rodando';
  if (status === 'retry_wait') return 'retry';
  if (status === 'claimed') return 'reivindicado';
  if (status === 'needs_review') return 'revisao';
  if (status === 'completed' || status === 'applied') return 'concluido';
  if (status === 'error' || status === 'failed') return 'erro';
  if (status === 'cancelled') return 'cancelado';
  if (status === 'obsolete') return 'obsoleto';
  return status;
}

function statusClass(status: AiJob['status']): string {
  if (status === 'running' || status === 'claimed') return 'bg-sky-100 text-sky-700';
  if (status === 'error' || status === 'failed' || status === 'needs_review') return 'bg-rose-100 text-rose-700';
  if (status === 'retry_wait') return 'bg-purple-100 text-purple-700';
  if (status === 'pending') return 'bg-amber-100 text-amber-700';
  if (status === 'completed' || status === 'applied') return 'bg-emerald-100 text-emerald-700';
  if (status === 'cancelled' || status === 'obsolete') return 'bg-slate-200 text-slate-600';
  return 'bg-slate-100 text-slate-700';
}
