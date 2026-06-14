export function normalizeJapaneseText(input: string): string {
  return (input || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[　]+/g, ' ')
    .trim();
}

export function makeJapaneseKey(input: string): string {
  return normalizeJapaneseText(input)
    .replace(/\s+/g, '')
    .toLowerCase();
}
