import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudyPlanner } from "../studyPlanner";
import {
  DictionaryRepository,
  ProgressRepository,
  SentenceRepository,
  SourceRepository,
  StudySessionRepository,
} from "../../../repositories";

vi.mock("../../../repositories", () => ({
  SourceRepository: { getAll: vi.fn() },
  DictionaryRepository: { getAll: vi.fn() },
  ProgressRepository: {
    getAllSentenceProgress: vi.fn(),
    getAllDictionaryProgress: vi.fn(),
  },
  SentenceRepository: { getBySourceId: vi.fn() },
  StudySessionRepository: {
    getSavedCustomSessions: vi.fn(),
    getSourceOffset: vi.fn(),
  },
}));

describe("StudyPlanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SourceRepository.getAll).mockResolvedValue([
      { id: "src-1", title: "Fonte 1" } as any,
    ]);
    vi.mocked(DictionaryRepository.getAll).mockResolvedValue([
      { id: "word-1", main_meaning: "casa", status: "reviewed" } as any,
    ]);
    vi.mocked(ProgressRepository.getAllSentenceProgress).mockResolvedValue([]);
    vi.mocked(ProgressRepository.getAllDictionaryProgress).mockResolvedValue([]);
    vi.mocked(StudySessionRepository.getSavedCustomSessions).mockResolvedValue([]);
    vi.mocked(StudySessionRepository.getSourceOffset).mockResolvedValue(0);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      { id: "sent-1", source_id: "src-1" } as any,
    ]);
  });

  it("prioriza revisao vencida quando ha palavras prontas para repeticao espacada", async () => {
    vi.mocked(ProgressRepository.getAllDictionaryProgress).mockResolvedValue([
      {
        dictionary_entry_id: "word-1",
        due_at: new Date(Date.now() - 60_000).toISOString(),
        suspended: false,
      } as any,
    ]);

    const plan = await StudyPlanner.buildPlan();

    expect(plan.recommendedConfig).toMatchObject({
      entityType: "word",
      targetType: "review_due",
      order: "due",
    });
    expect(plan.dueWordCount).toBe(1);
  });

  it("mantem a continuidade da fonte quando nao ha revisao urgente", async () => {
    vi.mocked(StudySessionRepository.getSourceOffset).mockResolvedValue(10);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        id: `sent-${index + 1}`,
        source_id: "src-1",
      })) as any,
    );

    const plan = await StudyPlanner.buildPlan();

    expect(plan.recommendedConfig).toBeNull();
    expect(plan.recommendedSourceId).toBe("src-1");
    expect(plan.nextOffset).toBe(10);
  });
});
