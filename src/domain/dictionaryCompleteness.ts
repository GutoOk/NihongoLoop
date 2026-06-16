import { DictionaryEntry } from "../types";

export type DictionaryMissingField = "main_meaning" | "kana" | "romaji" | "type";

const FIELD_LABELS: Record<DictionaryMissingField, string> = {
  main_meaning: "significado",
  kana: "leitura kana",
  romaji: "romaji",
  type: "categoria",
};

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

export function getDictionaryMissingFields(entry: Partial<DictionaryEntry>): DictionaryMissingField[] {
  const missing: DictionaryMissingField[] = [];
  if (isBlank(entry.main_meaning)) missing.push("main_meaning");
  if (isBlank(entry.kana)) missing.push("kana");
  if (isBlank(entry.romaji)) missing.push("romaji");
  if (isBlank(entry.type)) missing.push("type");
  return missing;
}

export function needsDictionaryEnrichment(entry: Partial<DictionaryEntry>): boolean {
  if (entry.status === "reviewed") return false;
  return getDictionaryMissingFields(entry).length > 0;
}

export function isDictionaryComplete(entry: Partial<DictionaryEntry>): boolean {
  return getDictionaryMissingFields(entry).length === 0;
}

export function formatDictionaryMissingFields(entry: Partial<DictionaryEntry>): string {
  const missing = getDictionaryMissingFields(entry);
  if (missing.length === 0) return "completo";
  return missing.map((field) => FIELD_LABELS[field]).join(", ");
}
