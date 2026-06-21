import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Database,
  ListPlus,
  RefreshCw,
  RotateCcw,
  Square,
} from 'lucide-react';
import { AiJob, ProcessingRun } from '../types';
import { AiJobRepository, ProcessingRunRepository } from '../repositories';
import { useModal } from './ModalProvider';
import { getJobHumanName } from './sourcePreparation/jobDisplay';

interface SourcePreparationPanelProps {
  sourceId: string;
  onPreparationComplete: () => void;
  onContentUpdated?: () => void;
}

export default function SourcePreparationPanel({
  sourceId,
  onPreparationComplete,
  onContentUpdated,
}: SourcePreparationPanelProps) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [run, setRun] = useState<ProcessingRun | null>(null);
  const [showGlobal, setShowGlobal] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
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
    setIsRefreshing(true);
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const latestRun = showGlobal ? null : await ProcessingRunRepository.getLatestRunBySource(sourceId);
      const sourceJobs = showGlobal
        ? await AiJobRepository.getAll()
        : latestRun
          ? await AiJobRepository.getByRun(latestRun.id, 100)
          : await AiJobRepository.getBySource(sourceId);
      const signature = JSON.stringify({
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
      setRun(latestRun);
      setJobs(sourceJobs);
      setLoadError(null);
    } catch (error: any) {
      if (!silent) setLoadError(error?.message || 'Nao foi possivel atualizar os dados da fonte.');
    } finally {
      loadingRef.current = false;
      setIsRefreshing(false);
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

  const retryProblems = async () => {
    setIsBusy(true);
    try {
      if (showGlobal) {
        await AiJobRepository.retryAllProblemJobs();
      } else if (run) {
        await AiJobRepository.retryProblemJobsByRun(run.id);
      } else {
        await AiJobRepository.retryProblemJobsBySource(sourceId);
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
        await AiJobRepository.cancelAllActiveJobs();
      } else if (run) {
        await AiJobRepository.cancelActiveJobsByRun(run.id);
      } else {
        await AiJobRepository.cancelActiveJobsBySource(sourceId);
      }
      await refresh();
    } finally {
      setIsBusy(false);
    }
  };

  const sampledQueueCounts = useMemo(() => summarizeJobs(jobs), [jobs]);
  const queueCounts = useMemo(() => showGlobal ? sampledQueueCounts : summarizeRun(run), [run, sampledQueueCounts, showGlobal]);
  const visibleJobs = useMemo(() => jobs.filter(isVisibleQueueJob), [jobs]);
  const visibleJobTotal = showGlobal ? jobs.length : (run?.created_jobs || run?.planned_jobs || jobs.length);
  const isJobListLimited = !showGlobal && visibleJobTotal > jobs.length && jobs.length >= 100;
  const activeRunCount = queueCounts.pending + queueCounts.running + queueCounts.retry + queueCounts.review;
  const problemRunCount = queueCounts.error + queueCounts.retry + queueCounts.review;
  const hasRun = showGlobal || Boolean(run);
  const busyTitle = isBusy ? 'Acao em andamento.' : isRefreshing ? 'Atualizacao em andamento.' : undefined;

  return (
    <section className="border-b border-[#E5E5E7] bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900">
                <Database className="h-5 w-5 text-indigo-600" />
                Preparacao de IA da fonte
              </h2>
              <p className="max-w-2xl text-xs leading-relaxed text-slate-500">
                Mostra a execucao persistida e enfileira somente lacunas reais desta fonte.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToolbarButton
                onClick={() => refresh()}
                disabled={isRefreshing}
                title={isRefreshing ? 'Atualizacao em andamento.' : 'Atualizar run e jobs.'}
                icon={<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />}
                label={isRefreshing ? 'Atualizando...' : 'Atualizar dados'}
              />
              <ToolbarButton
                onClick={queueRealGaps}
                disabled={isBusy || isRefreshing}
                title={busyTitle || 'Preparar ou retomar esta fonte.'}
                primary
                icon={<ListPlus className="h-4 w-4" />}
                label="Preparar/retomar fonte"
              />
            </div>
          </div>

          {loadError && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {loadError}
            </div>
          )}

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
                <ToolbarButton small onClick={() => setShowGlobal((value) => !value)} label={showGlobal ? 'Ver fonte' : 'Ver global'} title={showGlobal ? 'Mostrar apenas a fonte.' : 'Mostrar fila global.'} />
                <ToolbarButton small onClick={retryProblems} disabled={isBusy || isRefreshing || problemRunCount === 0} title={problemRunCount === 0 ? 'Sem problemas para retentar.' : busyTitle || 'Retentar problemas da run.'} icon={<RotateCcw className="h-3.5 w-3.5" />} label="Retentar problemas" />
                <ToolbarButton small onClick={cancelPending} disabled={isBusy || isRefreshing || !hasRun || activeRunCount === 0} title={activeRunCount === 0 ? 'Sem jobs ativos para cancelar.' : busyTitle || 'Cancelar jobs nao concluidos.'} icon={<Square className="h-3.5 w-3.5" />} label={showGlobal ? 'Cancelar fila global ativa' : 'Cancelar nao concluidos'} />
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
            {isJobListLimited && (
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs font-bold text-slate-600">
                Exibindo os últimos {jobs.length} de {visibleJobTotal} jobs.
              </div>
            )}
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
  title,
}: {
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  disabled?: boolean;
  primary?: boolean;
  small?: boolean;
  title?: string;
}) {
  const enabledClass = primary
    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-black uppercase tracking-wide ${
        small ? 'h-8 px-2.5 text-[10px]' : 'h-10 px-3 text-xs'
      } ${disabled ? 'cursor-not-allowed border border-slate-200 bg-slate-200 text-slate-400' : enabledClass}`}
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

function summarizeRun(run: ProcessingRun | null) {
  return {
    pending: run?.pending_jobs || 0,
    running: (run?.running_jobs || 0) + (run?.claimed_jobs || 0),
    retry: run?.retry_jobs || 0,
    review: run?.review_jobs || run?.needs_review_jobs || 0,
    completed: run?.completed_jobs || 0,
    cancelled: run?.cancelled_jobs || 0,
    error: run?.failed_jobs || run?.failed_items || 0,
    stuck: 0,
    clearable: 0,
  };
}

function JobList({ jobs }: { jobs: AiJob[] }) {
  if (jobs.length === 0) return <EmptyState text="Nenhum job para exibir." />;
  return (
    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
      {jobs.map((job) => {
        const displayLabel = getJobHumanName(job.type);
        const label = getJobLabel(job, displayLabel);
        return (
          <div key={job.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-black text-slate-900">{label}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <span>{displayLabel}</span>
                  <span>{job.target_type}:{job.target_id}</span>
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
  return fallback;
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
