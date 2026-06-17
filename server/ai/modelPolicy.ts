export type AiPromptKind = "translate_sentence" | "analyze_sentence" | "enrich_dictionary";

export function getPromptKind(jobType: string): AiPromptKind | null {
  if (jobType === "translate_sentence" || jobType === "batch_translate_sentences") {
    return "translate_sentence";
  }

  if (jobType === "generate_sentence_reading" || jobType === "batch_analyze_sentences") {
    return "analyze_sentence";
  }

  if (
    jobType === "enrich_dictionary_entry" ||
    jobType === "batch_enrich_dictionary_entries_fast" ||
    jobType === "batch_enrich_dictionary_entries_full"
  ) {
    return "enrich_dictionary";
  }

  return null;
}

export function getPromptVersion(jobType: string): string {
  const kind = getPromptKind(jobType) || "unknown";
  return `${kind}:2026-06-cost-v1`;
}

export function getModelForJobType(jobType: string): string {
  const envSpecific = process.env[`GEMINI_MODEL_${jobType.toUpperCase()}`];
  if (envSpecific) return envSpecific;

  if (
    jobType === "batch_enrich_dictionary_entries_full" ||
    jobType === "batch_enrich_dictionary_entries_fast"
  ) {
    return process.env.GEMINI_MODEL_FULL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  if (jobType === "batch_analyze_sentences" || jobType === "generate_sentence_reading") {
    return process.env.GEMINI_MODEL_ANALYZE || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  return process.env.GEMINI_MODEL_FAST || process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export function getTemperatureForJobType(jobType: string): number {
  if (jobType === "translate_sentence" || jobType === "batch_translate_sentences") return 0.15;
  if (jobType === "generate_sentence_reading" || jobType === "batch_analyze_sentences") return 0.1;
  return 0.2;
}
