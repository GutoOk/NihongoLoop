import { SentenceTerm } from "../types";

const JAPANESE_TEXT_RE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶ]/;

function hasExactSpan(text: string, term: SentenceTerm): boolean {
  const surface = term.surface?.trim();
  return Boolean(
    surface &&
      JAPANESE_TEXT_RE.test(surface) &&
      term.start_index >= 0 &&
      term.end_index > term.start_index &&
      term.end_index <= text.length &&
      text.substring(term.start_index, term.end_index) === surface,
  );
}

export function normalizeTermOffsets(text: string, terms: SentenceTerm[]): SentenceTerm[] {
  const aligned = terms
    .filter((term) => hasExactSpan(text, term))
    .sort((a, b) => {
      const spanDiff = b.end_index - b.start_index - (a.end_index - a.start_index);
      return spanDiff || a.start_index - b.start_index;
    });

  const usedIndexes = new Set<number>();
  const filtered: SentenceTerm[] = [];
  for (const term of aligned) {
    let overlap = false;
    for (let i = term.start_index; i < term.end_index; i++) {
      if (usedIndexes.has(i)) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    for (let i = term.start_index; i < term.end_index; i++) usedIndexes.add(i);
    filtered.push(term);
  }

  return filtered.sort((a, b) => a.start_index - b.start_index);
}
