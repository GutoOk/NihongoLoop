import { describe, expect, it } from "vitest";
import {
  getDictionaryMissingFields,
  isDictionaryComplete,
  needsDictionaryEnrichment,
} from "../dictionaryCompleteness";

describe("dictionaryCompleteness", () => {
  it("marks entries with missing core fields as needing enrichment", () => {
    const entry = {
      status: "ai_enriched",
      main_meaning: "barulhento",
      kana: null,
      romaji: "urusai",
      type: "adjetivo",
    } as any;

    expect(needsDictionaryEnrichment(entry)).toBe(true);
    expect(getDictionaryMissingFields(entry)).toEqual(["kana"]);
  });

  it("does not send reviewed entries back to AI", () => {
    const entry = {
      status: "reviewed",
      main_meaning: null,
      kana: null,
      romaji: null,
      type: null,
    } as any;

    expect(needsDictionaryEnrichment(entry)).toBe(false);
  });

  it("treats complete AI entries as ready", () => {
    const entry = {
      status: "ai_enriched",
      main_meaning: "ir",
      kana: "いく",
      romaji: "iku",
      type: "verbo",
    } as any;

    expect(isDictionaryComplete(entry)).toBe(true);
    expect(needsDictionaryEnrichment(entry)).toBe(false);
  });
});
