import { describe, it, expect } from 'vitest';
import { parseSrt, parsePlainText } from '../importParserService';

describe('importParserService', () => {
  describe('parsePlainText', () => {
    it('splits standard text correctly', () => {
      const text = 'お前ら何だ！？行くぞ！待て。';
      const sentences = parsePlainText(text);
      expect(sentences).toEqual(['お前ら何だ！？', '行くぞ！', '待て。']);
    });

    it('removes HTML tags and annotations', () => {
      const text = '<i>待て</i>{\\an8}。';
      const sentences = parsePlainText(text);
      expect(sentences).toEqual(['待て。']);
    });

    it('ignores empty lines and garbage', () => {
      const text = '\n\nお前ら何だ！？\n\n\n行くぞ。\n';
      const sentences = parsePlainText(text);
      expect(sentences).toEqual(['お前ら何だ！？', '行くぞ。']);
    });
  });

  describe('parseSrt', () => {
    it('parses basic SRT format', () => {
      const srt = `1
00:00:01,000 --> 00:00:03,000
お前ら 何だ！？

2
00:00:04,000 --> 00:00:06,000
行くぞ！
`;
      const sentences = parseSrt(srt);
      expect(sentences).toEqual(['お前ら 何だ！？', '行くぞ！']);
    });
  });
});
