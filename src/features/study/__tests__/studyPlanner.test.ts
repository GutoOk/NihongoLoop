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
  SourceRepository: {
    getAll: vi.fn(),
  },
  DictionaryRepository: {
    getAll: vi.fn(),
  },
  ProgressRepository: {
    getAllSentenceProgress: vi.fn(),
    getAllDictionaryProgress: vi.fn(),
  },
  SentenceRepository: {
    getBySourceId: vi.fn(),
  },
  StudySessionRepository: {
    getSourceOffset: vi.fn(),
  },
}));

describe("StudyPlanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SourceRepository.getAll).mockResolvedValue([
      { id: "source-1", title: "Fonte 1" } as any,
    ]);
    vi.mocked(DictionaryRepository.getAll).mockResolvedValue([
      { id: "word-1", lemma: "行く", main_meaning: "ir", status: "ai_enriched" } as any,
      { id: "word-2", lemma: "見る", main_meaning: "ver", status: "ai_enriched" } as any,
    ]);
    vi.mocked(ProgressRepository.getAllSentenceProgress).mockResolvedValue([]);
    vi.mocked(ProgressRepository.getAllDictionaryProgress).mockResolvedValue([]);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      { id: "sent-1" } as any,
    ]);
    vi.mocked(StudySessionRepository.getSourceOffset).mockResolvedValue(0);
  });

  it("prioritizes due word review over continuing a source", async () => {
    vi.mocked(ProgressRepository.getAllDictionaryProgress).mockResolvedValue([
      {
        dictionary_entry_id: "word-1",
        due_at: new Date(Date.now() - 60_000).toISOString(),
        suspended: false,
      } as any,
    ]);

    const plan = await StudyPlanner.buildPlan();

    expect(plan.dueWordCount).toBe(1);
    expect(plan.recommendedConfig).toMatchObject({
      entityType: "word",
      targetType: "review_due",
      order: "due",
    });
  });

  it("falls back to difficult words when there are no due reviews", async () => {
    vi.mocked(ProgressRepository.getAllDictionaryProgress).mockResolvedValue([
      {
        dictionary_entry_id: "word-2",
        wrong_count: 2,
        mastery: 35,
        suspended: false,
      } as any,
    ]);

    const plan = await StudyPlanner.buildPlan();

    expect(plan.difficultWordCount).toBe(1);
    expect(plan.recommendedConfig).toMatchObject({
      entityType: "word",
      targetType: "difficult_words",
      order: "priority",
    });
  });

  it("continues the first available source when there is no review debt", async () => {
    const plan = await StudyPlanner.buildPlan();

    expect(plan.recommendedConfig).toBeNull();
    expect(plan.recommendedSourceId).toBe("source-1");
    expect(plan.recommendedSourceTitle).toBe("Fonte 1");
  });
});
