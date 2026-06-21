import { SentenceTerm } from "../types";

const JAPANESE_TEXT_RE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶ]/;

function realignTerm(text: string, term: SentenceTerm): SentenceTerm | null {
  const surface = term.surface?.trim();
  if (!surface || !JAPANESE_TEXT_RE.test(surface)) return null;

  if (
    term.start_index >= 0 &&
    term.end_index > term.start_index &&
    term.end_index <= text.length &&
    text.substring(term.start_index, term.end_index) === surface
  ) {
    return term;
  }

  const expected = Math.max(0, term.start_index || 0);
  let bestIndex = -1;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  let fromIndex = 0;

  while (fromIndex <= text.length) {
    const index = text.indexOf(surface, fromIndex);
    if (index === -1) break;
    const distance = Math.abs(index - expected);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
    fromIndex = index + Math.max(surface.length, 1);
  }

  if (bestIndex === -1) return null;
  return { ...term, start_index: bestIndex, end_index: bestIndex + surface.length, surface };
}

export function normalizeTermOffsets(text: string, terms: SentenceTerm[]): SentenceTerm[] {
  const aligned = terms
    .map((term) => realignTerm(text, term))
    .filter((term): term is SentenceTerm => term !== null)
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
