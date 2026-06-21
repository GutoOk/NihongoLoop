import { describe, expect, it } from "vitest";
import { SentenceTerm } from "../../types";
import { isLowEmphasisTerm } from "../termColors";
import { normalizeTermOffsets, sliceCodePoints } from "../termOffsets";

function term(surface: string, start_index: number, end_index: number): SentenceTerm {
  return {
    id: `${surface}-${start_index}`,
    user_id: "user-1",
    sentence_id: "sentence-1",
    dictionary_form_id: "form-1",
    dictionary_sense_id: null,
    surface,
    start_index,
    end_index,
    confidence: 1,
    status: "detected",
    created_at: "",
    updated_at: "",
  };
}

describe("normalizeTermOffsets", () => {
  it("drops an invalid offset instead of moving it to another occurrence", () => {
    const text = "踊りたいなら踊り";
    const terms = normalizeTermOffsets(text, [term("踊り", 2, 4)]);

    expect(terms).toEqual([]);
  });

  it("does not assign a repeated word to a different occurrence", () => {
    const text = "猫と猫";
    const terms = normalizeTermOffsets(text, [term("猫", 0, 1), term("猫", 1, 2)]);

    expect(terms).toEqual([
      expect.objectContaining({ surface: "猫", start_index: 0, end_index: 1 }),
    ]);
  });

  it("keeps the longest non-overlapping lexical segment", () => {
    const text = "パーティーを再開";
    const terms = normalizeTermOffsets(text, [
      term("パ", 0, 1),
      term("パーティー", 0, 5),
      term("再開", 6, 8),
    ]);

    expect(terms.map((t) => t.surface)).toEqual(["パーティー", "再開"]);
  });

  it("uses code point offsets when emoji precedes Japanese text", () => {
    const text = "😀猫と犬";
    const terms = normalizeTermOffsets(text, [term("猫", 1, 2)]);

    expect(terms.map((t) => sliceCodePoints(text, t.start_index, t.end_index))).toEqual(["猫"]);
  });

  it("marks particles and auxiliaries as low-emphasis terms", () => {
    expect(isLowEmphasisTerm("partícula")).toBe(true);
    expect(isLowEmphasisTerm("particle")).toBe(true);
    expect(isLowEmphasisTerm("auxiliar")).toBe(true);
    expect(isLowEmphasisTerm("substantivo")).toBe(false);
  });
});
