import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SourcePreparationPanel from '../SourcePreparationPanel';
import { AiJobRepository, ProcessingRunRepository } from '../../repositories';

vi.mock('../../repositories', () => ({
  ProcessingRunRepository: {
    getLatestRunBySource: vi.fn(),
    startSourceProcessingRun: vi.fn(),
    getRun: vi.fn(),
  },
  AiJobRepository: {
    getByRun: vi.fn(),
    getBySource: vi.fn(),
    getAll: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ProcessingRunRepository.getLatestRunBySource).mockResolvedValue(baseRun);
    vi.mocked(AiJobRepository.getByRun).mockResolvedValue(Array.from({ length: 100 }, (_, i) => job(i)));
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

  it('uses run totals instead of the limited job list for queue actions', async () => {
    vi.mocked(AiJobRepository.getByRun).mockResolvedValueOnce([]);

    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText('20').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /retentar problemas/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cancelar nao concluidos/i })).toBeEnabled();
  });

  it('shows when only the latest 100 of 225 jobs are displayed', async () => {
    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);

    expect(await screen.findByText('Exibindo os últimos 100 de 225 jobs.')).toBeInTheDocument();
  });

  it('keeps only one primary preparation action', async () => {
    const user = userEvent.setup();
    render(<SourcePreparationPanel sourceId="source-1" onPreparationComplete={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /preparar\/retomar fonte/i }));

    expect(ProcessingRunRepository.startSourceProcessingRun).toHaveBeenCalledWith('source-1', 'all');
    expect(screen.queryByText('Gerar fila das pendencias reais')).not.toBeInTheDocument();
    expect(screen.queryByText('Criar/retomar execucao')).not.toBeInTheDocument();
  });
});
