/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function parseItemTags(text: string): string[] {
  if (!text) return [];
  const delimiter = text.includes(';') ? ';' : ',';
  return text
    .split(delimiter)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

export function formatItemTags(tags: string[]): string {
  if (!tags) return '';
  return tags.filter(t => t && t.trim().length > 0).join('; ');
}

export function parseBlockTags(text: string): string[] {
  if (!text) return [];
  const delimiter = text.includes('+') ? '+' : ',';
  return text
    .split(delimiter)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

export function formatBlockTags(tags: string[]): string {
  if (!tags) return '';
  return tags.filter(t => t && t.trim().length > 0).join('+');
}
