import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudySessionBuilder } from "../StudySessionBuilder";
import {
  DictionaryRepository,
  ProgressRepository,
  SentenceRepository,
  TermRepository,
} from "../../../repositories";

vi.mock("../../../repositories", () => ({
  DictionaryRepository: { getAll: vi.fn() },
  ProgressRepository: {
    getAllDictionaryProgress: vi.fn(),
    getSentenceProgressForSentences: vi.fn(),
  },
  SentenceRepository: {
    getAll: vi.fn(),
    getBySourceId: vi.fn(),
    getById: vi.fn(),
  },
  TermRepository: {
    getBySentences: vi.fn(),
    getByDictionaryEntry: vi.fn(),
  },
}));

describe("StudySessionBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(DictionaryRepository.getAll).mockResolvedValue([
      {
        id: "word-1",
        lemma: "家",
        kana: "いえ",
        romaji: "ie",
        main_meaning: "casa",
        status: "reviewed",
        type: "substantivo",
      } as any,
      {
        id: "word-2",
        lemma: "未",
        kana: "み",
        romaji: "mi",
        main_meaning: "",
        status: "pending",
        type: "substantivo",
      } as any,
    ]);
    vi.mocked(ProgressRepository.getAllDictionaryProgress).mockResolvedValue([
      {
        dictionary_entry_id: "word-1",
        due_at: new Date(Date.now() - 60_000).toISOString(),
        wrong_count: 2,
        mastery: 30,
        suspended: false,
      } as any,
    ]);
    vi.mocked(SentenceRepository.getAll).mockResolvedValue([
      {
        id: "sent-1",
        japanese: "家です",
        portuguese: "E uma casa.",
        kana: "いえです",
        romaji: "ie desu",
      } as any,
    ]);
    vi.mocked(ProgressRepository.getSentenceProgressForSentences).mockResolvedValue([]);
  });

  it("monta revisao vencida apenas com palavras estudaveis", async () => {
    const result = await StudySessionBuilder.build({
      entityType: "word",
      targetType: "review_due",
      order: "due",
      limit: 10,
      studyMode: "meaning-jp",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "word-1",
      japanese: "家",
      portuguese: "casa",
      type: "word",
    });
  });

  it("avisa quando o conjunto contem frase sem informacao essencial", async () => {
    vi.mocked(SentenceRepository.getAll).mockResolvedValue([
      { id: "sent-2", japanese: "読む", portuguese: "", kana: "", romaji: "" } as any,
    ]);

    const result = await StudySessionBuilder.build({
      entityType: "sentence",
      targetType: "all",
      limit: 5,
      order: "original",
      studyMode: "jp-pt",
    });

    expect(result.items).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("sem");
  });
});
