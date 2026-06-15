import { describe, it, expect } from 'vitest';
import { generateDictionaryUniqueKey } from '../termDetectionService';

describe('generateDictionaryUniqueKey', () => {
  it('normalizes full-width and half-width characters', () => {
    // Basic formatting
    const key1 = generateDictionaryUniqueKey(' 継ぐ ', 'つぐ', 'verbo');
    const key2 = generateDictionaryUniqueKey('継ぐ', 'つぐ', 'verbo');
    expect(key1).toBe(key2);
  });

  it('handles empty kana gracefully', () => {
    const key1 = generateDictionaryUniqueKey('食べる', null, 'verbo');
    const key2 = generateDictionaryUniqueKey('食べる', '', 'verbo');
    expect(key1).toBe(key2);
  });
  
  it('distinguishes different lengths or elements', () => {
    const key1 = generateDictionaryUniqueKey('食べる', 'たべる', 'verbo');
    const key2 = generateDictionaryUniqueKey('食べる', 'たべる', 'substantivo');
    expect(key1).not.toBe(key2); // Because of type
  });
});
