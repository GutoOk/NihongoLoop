import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SourcePreparationPanel from '../SourcePreparationPanel';
import { AiJobRepository, ProcessingRunRepository } from '../../repositories';

vi.mock('../../repositories', () => ({
  ProcessingRunRepository: {
    getLatestRunBySource: vi.fn(),
    getSourceLexicalIntegritySummary: vi.fn(),
    resetSourceLexicalAnalysis: vi.fn(),
    startSourceProcessingRun: vi.fn(),
    getRun: vi.fn(),
  },
  AiJobRepository: {
    getByRun: vi.fn(),
    getBySource: vi.fn(),
    getAll: vi.fn(),
    getGlobalSummary: vi.fn(),
    retryProblemJobsByRun: vi.fn(),
    retryProblemJobsBySource: vi.fn(),
    retryAllProblemJobs: vi.fn(),
    cancelActiveJobsByRun: vi.fn(),
    cancelActiveJobsBySource: vi.fn(),
    cancelAllActiveJobs: vi.fn(),
  },
}));

vi.mock('../ModalProvider', () => ({
  useModal: () => ({
    showAlert: vi.fn(),
    showConfirm: vi.fn().mockResolvedValue(true),
  }),
}));

const baseRun = {
  id: 'run-1',
  status: 'running',
  current_step: 'Consumindo fila',
  created_jobs: 225,
  planned_jobs: 225,
  pending_jobs: 20,
  claimed_jobs: 2,
  running_jobs: 3,
  completed_jobs: 190,
  failed_jobs: 4,
  retry_jobs: 5,
  review_jobs: 1,
  needs_review_jobs: 1,
  cancelled_jobs: 0,
  failed_items: 4,
} as any;

const baseLexicalSummary = {
  total_sentences: 10,
  reviewed_sentences: 1,
  invalid_offset_sentences: 2,
  invalid_offset_terms: 3,
  without_terms_sentences: 1,
  ai_empty_sentences: 1,
  eligible_invalid_only: 2,
  eligible_all_non_reviewed: 9,
};

function job(id: number) {
  return {
    id: `job-${id}`,
    type: 'translate_sentence',
    target_type: 'sentence',
    target_id: `sentence-${id}`,
    status: 'completed',
    attempts: 1,
    updated_at: '2026-06-21T00:00:00Z',
  } as any;
}

describe('SourcePreparationPanel audit controls', () => {
  const aiJobRepositorySource = readFileSync(resolve(process.cwd(), 'src/repositories/aiJobRepository.ts'), 'utf8');
  const sourcePreparationPanelSource = readFileSync(resolve(process.cwd(), 'src/components/SourcePreparationPanel.tsx'), 'utf8');
  const globalAiQueueControlSource = readFileSync(resolve(process.cwd(), 'src/components/GlobalAiQueueControl.tsx'), 'utf8');
  const pendingAiScreenSource = readFileSync(resolve(process.cwd(), 'src/components/PendingAiScreen.tsx'), 'utf8');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ProcessingRunRepository.getLatestRunBySource).mockResolvedValue(baseRun);
    vi.mocked(ProcessingRunRepository.getSourceLexicalIntegritySummary).mockResolvedValue(baseLexicalSummary);
    vi.mocked(ProcessingRunRepository.resetSourceLexicalAnalysis).mockResolvedValue({ reset_sentence_count: 2, mode: 'invalid_only', source_id: 'source-1' });
    vi.mocked(AiJobRepository.getByRun).mockResolvedValue(Array.from({ length: 100 }, (_, i) => job(i)));
    vi.mocked(AiJobRepository.getAll).mockResolvedValue([]);
    vi.mocked(AiJobRepository.getGlobalSummary).mockResolvedValue({
      total: 0,
      pending: 0,
      running: 0,
      retry: 0,
      review: 0,
      completed: 0,
      cancelled: 0,
      error: 0,
      stuck: 0,
      clearable: 0,
    });
    vi.mocked(ProcessingRunRepository.startSourceProcessingRun).mockResolvedValue({ run_id: 'run-1', created_jobs: 0, status: 'running' });
    vi.mocked(ProcessingRunRepository.getRun).mockResolvedValue(baseRun);
  });

  it('shows a busy refresh button while data is loading', async () => {
    let resolveRun: (run: any) => void = () => {};
    vi.mocked(ProcessingRunRepository.getLatestRunBySource).mockReturnValueOnce(new Promise((resolve) => { resolveRun = resolve; }) as any);

    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);

    const button = screen.getByRole('button', { name: /atualizando/i });
    expect(button).toBeDisabled();
    expect(button.querySelector('.animate-spin')).toBeTruthy();

    resolveRun(baseRun);
    await waitFor(() => expect(screen.getByRole('button', { name: /atualizar dados/i })).toBeEnabled());
  });

  it('does not get stuck refreshing after simultaneous refresh clicks', async () => {
    const user = userEvent.setup();
    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);
    await screen.findByRole('button', { name: /atualizar dados/i });

    let resolveRun: (run: any) => void = () => {};
    vi.mocked(ProcessingRunRepository.getLatestRunBySource).mockReturnValueOnce(new Promise((resolve) => { resolveRun = resolve; }) as any);
    const button = screen.getByRole('button', { name: /atualizar dados/i });

    await user.dblClick(button);
    expect(screen.getByRole('button', { name: /atualizando/i })).toBeDisabled();

    resolveRun(baseRun);
    await waitFor(() => expect(screen.getByRole('button', { name: /atualizar dados/i })).toBeEnabled());
  });

  it('uses run totals instead of the limited job list for queue actions', async () => {
    vi.mocked(AiJobRepository.getByRun).mockResolvedValueOnce([]);

    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText('20').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /retentar problemas/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cancelar nao concluidos/i })).toBeEnabled();
  });

  it('keeps run and jobs visible when lexical integrity RPC is missing', async () => {
    vi.mocked(ProcessingRunRepository.getSourceLexicalIntegritySummary).mockRejectedValueOnce(new Error('42883 function does not exist'));

    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);

    expect(await screen.findByText('Integridade lexical indisponivel. Aplique migration v26.')).toBeInTheDocument();
    expect(screen.getByText('Consumindo fila')).toBeInTheDocument();
    expect(AiJobRepository.getByRun).toHaveBeenCalledWith('run-1', 100);
  });

  it('does not present hidden completed history as missing visible jobs', async () => {
    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);

    await screen.findByText('Nenhum job para exibir.');
    expect(screen.queryByText(/Exibindo os .* de .* jobs/i)).not.toBeInTheDocument();
  });

  it('explains that completed jobs stay only in counters when attention jobs are visible', async () => {
    vi.mocked(AiJobRepository.getByRun).mockResolvedValueOnce([
      { ...job(1), status: 'running' },
      ...Array.from({ length: 99 }, (_, i) => job(i + 2)),
    ]);

    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);

    expect(await screen.findByText('Concluidos ficam apenas nos contadores. Exibindo 1 job que requer atencao.')).toBeInTheDocument();
  });

  it('keeps only one primary preparation action', async () => {
    const user = userEvent.setup();
    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /preparar\/retomar fonte/i }));

    expect(ProcessingRunRepository.startSourceProcessingRun).toHaveBeenCalledWith('source-1', 'all');
    expect(screen.queryByText('Gerar fila das pendencias reais')).not.toBeInTheDocument();
    expect(screen.queryByText('Criar/retomar execucao')).not.toBeInTheDocument();
  });

  it('uses global summary totals for global queue actions', async () => {
    const user = userEvent.setup();
    vi.mocked(AiJobRepository.getGlobalSummary).mockResolvedValue({
      total: 4,
      pending: 3,
      running: 1,
      retry: 2,
      review: 0,
      completed: 200,
      cancelled: 0,
      error: 0,
      stuck: 0,
      clearable: 3,
    });

    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /ver global/i }));

    expect(await screen.findByRole('button', { name: /retentar problemas/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cancelar fila global ativa/i })).toBeEnabled();
    expect(AiJobRepository.getGlobalSummary).toHaveBeenCalledTimes(1);
  });

  it('gets global queue summary through one RPC instead of browser-side counts', () => {
    expect(aiJobRepositorySource).toContain("rpc('get_ai_queue_summary')");
    expect(aiJobRepositorySource).toContain("throw new Error(`Erro do Supabase ao carregar fila: ${error.message}`)");
    expect(aiJobRepositorySource).not.toContain("count(['pending']");
    expect(aiJobRepositorySource).not.toContain("{ count: 'exact', head: true }");
  });

  it('only exposes cancellation for active global jobs', () => {
    expect(globalAiQueueControlSource).toContain("'pending'");
    expect(globalAiQueueControlSource).toContain("'needs_review'");
    expect(globalAiQueueControlSource).not.toContain('return Boolean(job.id)');
    expect(pendingAiScreenSource).toContain('CANCELLABLE_JOB_STATUSES.includes(job.status)');
  });

  it('shows a limited-list notice for global queue totals', () => {
    expect(sourcePreparationPanelSource).toContain('globalSummary?.total || jobs.length');
    expect(sourcePreparationPanelSource).toContain('hiddenHistoricalJobs > 0 && visibleJobs.length > 0');
    expect(sourcePreparationPanelSource).toContain('Concluidos ficam apenas nos contadores');
  });
});
