import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcePreparationRunner } from '../SourcePreparationRunner';
import { SourcePreparationEngine } from '../SourcePreparationEngine';

vi.mock('../SourcePreparationEngine', () => ({
  SourcePreparationEngine: {
    processNextSourceJob: vi.fn(),
    createQueueForSource: vi.fn(),
  },
}));

describe('SourcePreparationRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drains a complete source pipeline by recalculating between translation, analysis and dictionary stages', async () => {
    const progress = vi.fn();
    vi.mocked(SourcePreparationEngine.processNextSourceJob)
      .mockResolvedValueOnce({ id: 'translation-job' } as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'analysis-job' } as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'dictionary-job' } as any)
      .mockResolvedValueOnce(null);
    vi.mocked(SourcePreparationEngine.createQueueForSource)
      .mockResolvedValueOnce({ jobs: [{ id: 'queued-analysis' } as any], appliedReusableTranslations: 0, plan: {} as any })
      .mockResolvedValueOnce({ jobs: [{ id: 'queued-dictionary' } as any], appliedReusableTranslations: 0, plan: {} as any })
      .mockResolvedValueOnce({ jobs: [], appliedReusableTranslations: 0, plan: {} as any });

    await SourcePreparationRunner.drainSource('source-1', progress, undefined, 0);

    expect(SourcePreparationEngine.processNextSourceJob).toHaveBeenCalledTimes(6);
    expect(SourcePreparationEngine.createQueueForSource).toHaveBeenCalledTimes(3);
    expect(SourcePreparationEngine.createQueueForSource).toHaveBeenNthCalledWith(1, 'source-1', expect.any(Object));
    expect(SourcePreparationEngine.createQueueForSource).toHaveBeenNthCalledWith(2, 'source-1', expect.any(Object));
    expect(SourcePreparationEngine.createQueueForSource).toHaveBeenNthCalledWith(3, 'source-1', expect.any(Object));
    expect(progress).toHaveBeenCalledTimes(9);
  });
});
