import { AiJob } from "../../types";

export function getJobHumanName(type: string): string {
  if (type === "batch_translate_sentences") return "Tradução de frases";
  if (type === "batch_analyze_sentences") return "Leitura e identificação de palavras";
  if (type.includes("dictionary_entries_fast")) return "Dicionário completo";
  if (type.includes("dictionary_entries_full")) return "Dicionário completo";
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
