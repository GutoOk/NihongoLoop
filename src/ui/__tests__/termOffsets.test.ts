import { describe, expect, it } from "vitest";
import { normalizeTermOffsets } from "../termOffsets";
import { SentenceTerm } from "../../types";

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
  it("realigns offsets to the exact surface in the original sentence", () => {
    const text = "Oh baby, 踊り明かしたいなら、私と何度とパーティーを再開しないか？";
    const terms = normalizeTermOffsets(text, [term("踊り", 4, 11)]);

    expect(terms).toEqual([
      expect.objectContaining({ surface: "踊り", start_index: 9, end_index: 11 }),
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
});
