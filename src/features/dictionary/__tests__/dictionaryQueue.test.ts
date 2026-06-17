import { describe, expect, it, vi } from "vitest";
import {
  getCorrectDictionaryStatus,
  summarizeDictionaryQueue,
} from "../dictionaryQueue";

const entry = (overrides: Record<string, unknown>) =>
  ({
    id: "entry-1",
    lemma: "家",
    kana: null,
    romaji: null,
    type: "substantivo",
    jlpt_level: "N5",
    status: "pending",
    main_meaning: null,
    tags: [],
    ...overrides,
  }) as any;

const job = (overrides: Record<string, unknown>) =>
  ({
    id: "job-1",
    type: "enrich_dictionary_entry",
    target_id: "entry-1",
    target_type: "dictionary_entry",
    status: "pending",
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  }) as any;

describe("dictionaryQueue", () => {
  it("considera pendente apenas verbete sem conteudo util", () => {
    expect(getCorrectDictionaryStatus(entry({ main_meaning: null }))).toBe("pending");
    expect(getCorrectDictionaryStatus(entry({ main_meaning: "casa" }))).toBe("ai_enriched");
    expect(getCorrectDictionaryStatus(entry({ status: "reviewed", main_meaning: null }))).toBe("reviewed");
  });

  it("calcula a fila pelo filtro atual e separa job concluido que nao resolveu a pendencia", () => {
    const summary = summarizeDictionaryQueue(
      [
        entry({ id: "entry-1", type: "substantivo", main_meaning: null }),
        entry({ id: "entry-2", type: "verbo", main_meaning: null }),
      ],
      [
        job({ id: "job-1", target_id: "entry-1", status: "completed" }),
        job({ id: "job-2", target_id: "entry-2", status: "pending" }),
      ],
      { sourceEntryIds: null, typeFilter: "substantivo", levelFilter: "all" },
    );

    expect(summary.pendingEntries.map((item) => item.id)).toEqual(["entry-1"]);
    expect(summary.pendingJobs).toHaveLength(0);
    expect(summary.staleCompletedJobs).toHaveLength(1);
  });

  it("ignora historico concluido antigo que ja nao pertence a uma pendencia atual", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T12:00:00Z"));

    const summary = summarizeDictionaryQueue(
      [entry({ id: "entry-1", main_meaning: "casa", status: "ai_enriched" })],
      [
        job({
          id: "old-job",
          status: "completed",
          completed_at: "2026-06-17T11:00:00Z",
        }),
      ],
      { sourceEntryIds: null, typeFilter: "all", levelFilter: "all" },
    );

    expect(summary.relevantJobs).toHaveLength(0);
    vi.useRealTimers();
  });
});
