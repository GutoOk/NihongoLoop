import { AiJob } from "../../types";

export function getJobHumanName(type: string): string {
  if (type === "translate_sentence") return "Tradução de frase";
  if (type === "generate_sentence_reading" || type === "detect_sentence_terms") return "Análise lexical";
  if (type === "enrich_dictionary_entry" || type === "generate_dictionary_senses") return "Completar verbete";
  if (type === "batch_translate_sentences") return "Tradução de frases";
  if (type === "batch_analyze_sentences") return "Análise lexical";
  if (type.includes("dictionary_entries_fast")) return "Dicionário";
  if (type.includes("dictionary_entries_full")) return "Dicionário";
  return type;
}

export function countJobsByStatus(jobs: AiJob[]) {
  return {
    pending: jobs.filter((j) => j.status === "pending").length,
    running: jobs.filter((j) => j.status === "running").length,
    error: jobs.filter((j) => j.status === "error").length,
    completed: jobs.filter((j) => j.status === "completed").length,
  };
}
