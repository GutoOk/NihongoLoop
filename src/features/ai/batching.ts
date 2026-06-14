export function chunkByCountAndChars<T>(
  items: T[],
  getText: (item: T) => string,
  options: { maxItems: number; maxChars: number }
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const len = getText(item).length;
    if (
      current.length > 0 &&
      (current.length >= options.maxItems || currentChars + len > options.maxChars)
    ) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += len;
  }

  if (current.length) chunks.push(current);
  return chunks;
}
