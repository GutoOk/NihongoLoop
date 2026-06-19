export type AiPromptKind = "translate_sentence" | "analyze_sentence" | "enrich_dictionary";

export function getPromptKind(jobType: string): AiPromptKind | null {
  if (jobType === "translate_sentence" || jobType === "batch_translate_sentences") {
    return "translate_sentence";
  }

  if (jobType === "generate_sentence_reading" || jobType === "detect_sentence_terms" || jobType === "batch_analyze_sentences") {
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
  const cheapestModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

  if (jobType === "batch_enrich_dictionary_entries_full") {
    return process.env.GEMINI_MODEL_FULL || cheapestModel;
  }

  if (jobType === "batch_analyze_sentences" || jobType === "generate_sentence_reading" || jobType === "detect_sentence_terms") {
    return process.env.GEMINI_MODEL_ANALYZE || cheapestModel;
  }

  return process.env.GEMINI_MODEL_FAST || cheapestModel;
}

export function getTemperatureForJobType(jobType: string): number {
  if (jobType === "translate_sentence" || jobType === "batch_translate_sentences") return 0.15;
  if (jobType === "generate_sentence_reading" || jobType === "detect_sentence_terms" || jobType === "batch_analyze_sentences") return 0.1;
  return 0.2;
}
