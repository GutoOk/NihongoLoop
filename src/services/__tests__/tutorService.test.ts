import { describe, it, expect } from "vitest";
import { analyzeLearner, TutorInput } from "../tutorService";
import { DeckStats } from "../flashcardService";
import { DEFAULT_SETTINGS } from "../flashcardService";

function emptyStats(over: Partial<DeckStats> = {}): DeckStats {
  return { total: 0, new: 0, learning: 0, young: 0, mature: 0, mastered: 0, due: 0, leeches: 0, favorites: 0, suspended: 0, ...over };
}

function baseInput(over: Partial<TutorInput> = {}): TutorInput {
  return {
    entries: [],
    progress: [],
    stats: emptyStats(),
    settings: DEFAULT_SETTINGS,
    streak: 0,
    daysStudied7: 0,
    daysStudied30: 0,
    todayReviews: 0,
    todayNewCards: 0,
    hourHistogram: new Array(24).fill(0),
    recentAgainRate: null,
    ...over,
  };
}

describe("tutorService", () => {
  it("brand-new user gets onboarding as top priority and stage 'novato'", () => {
    const p = analyzeLearner(baseInput({ stats: emptyStats({ new: 100, total: 100 }) }));
    expect(p.stage).toBe("novato");
    expect(p.recommendations[0].id).toBe("onboarding");
    expect(p.competencies).toHaveLength(5);
    expect(p.plan.length).toBeGreaterThan(0);
  });

  it("large overdue backlog surfaces an urgent backlog recommendation", () => {
    const progress = Array.from({ length: 80 }, (_, i) => ({
      dictionary_entry_id: `e${i}`, seen_count: 3, correct_count: 2, wrong_count: 1,
      mastery: 40, srs_interval_minutes: 5000, srs_ease_factor: 8,
      due_at: new Date(Date.now() - 86400000).toISOString(),
      last_seen_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    })) as any;
    const p = analyzeLearner(baseInput({
      progress, stats: emptyStats({ total: 80, mature: 80, due: 80 }),
    }));
    const backlog = p.recommendations.find((r) => r.id === "backlog");
    expect(backlog).toBeTruthy();
    expect(backlog!.tone).toBe("urgent");
  });

  it("leeches trigger the 'palavras teimosas' guidance with a leech action", () => {
    const p = analyzeLearner(baseInput({ stats: emptyStats({ total: 50, mature: 50, leeches: 6 }) }));
    const leech = p.recommendations.find((r) => r.id === "leeches");
    expect(leech).toBeTruthy();
    expect(leech!.action?.mode).toBe("leech");
  });

  it("caught-up advanced learner is told to advance", () => {
    const progress = Array.from({ length: 40 }, (_, i) => ({
      dictionary_entry_id: `e${i}`, seen_count: 4, correct_count: 4, wrong_count: 0,
      mastery: 70, srs_interval_minutes: 40000, srs_ease_factor: 30,
      due_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      last_seen_at: new Date(Date.now() - 86400000).toISOString(),
    })) as any;
    const p = analyzeLearner(baseInput({
      progress, stats: emptyStats({ total: 50, mature: 40, new: 10, due: 0 }),
      streak: 5, daysStudied7: 5,
    }));
    expect(p.recommendations.some((r) => r.id === "advance")).toBe(true);
  });

  it("detects a peak study hour when enough sessions exist", () => {
    const hours = new Array(24).fill(0);
    hours[20] = 8;
    const p = analyzeLearner(baseInput({
      stats: emptyStats({ total: 30, mature: 30 }), hourHistogram: hours,
      progress: Array.from({ length: 10 }, (_, i) => ({ dictionary_entry_id: `e${i}`, seen_count: 2, correct_count: 2, wrong_count: 0, mastery: 50 })) as any,
    }));
    expect(p.bestHour?.hour).toBe(20);
  });
});
