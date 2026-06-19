import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcePreparationService } from '../../features/ai/SourcePreparationService';
import { ProcessingRunRepository } from '../../repositories';

vi.mock('../../repositories', () => ({
  ProcessingRunRepository: {
    startSourceProcessingRun: vi.fn(),
  },
}));

const options = {
  useCache: true,
  overwriteReviewed: false,
  runMode: 'all' as const,
};

describe('SourcePreparationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ProcessingRunRepository.startSourceProcessingRun).mockResolvedValue({
      run_id: 'run-1',
      stage: 'translation',
      created_jobs: 2,
      status: 'running',
    });
  });

  it('delegates source preparation to the persisted database orchestrator', async () => {
    await SourcePreparationService.prepareSource('source-1', options, 'run-1');

    expect(ProcessingRunRepository.startSourceProcessingRun).toHaveBeenCalledWith('source-1', 'all');
  });

  it('propagates database orchestrator errors without mutating the run in the browser', async () => {
    vi.mocked(ProcessingRunRepository.startSourceProcessingRun).mockRejectedValueOnce(new Error('schema mismatch'));

    await expect(SourcePreparationService.prepareSource('source-1', options, 'run-1')).rejects.toThrow('schema mismatch');
  });
});
