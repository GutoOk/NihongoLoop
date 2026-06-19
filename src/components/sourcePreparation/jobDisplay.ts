import { AiJob } from "../../types";

export function getJobHumanName(type: string): string {
  if (type === "translate_sentence") return "Traducao de frase";
  if (type === "generate_sentence_reading") return "Leitura de frase";
  if (type === "detect_sentence_terms") return "Termos da frase";
  if (type === "enrich_dictionary_entry" || type === "generate_dictionary_senses") return "Completar verbete";
  if (type === "explain_sentence") return "Explicacao";
  if (type === "repair_sentence") return "Reparo";
  return type;
}

export function countJobsByStatus(jobs: AiJob[]) {
  return {
    pending: jobs.filter((j) => j.status === "pending").length,
    running: jobs.filter((j) => j.status === "running" || j.status === "claimed").length,
    retry: jobs.filter((j) => j.status === "retry_wait").length,
    review: jobs.filter((j) => j.status === "needs_review").length,
    cancelled: jobs.filter((j) => j.status === "cancelled").length,
    error: jobs.filter((j) => j.status === "error" || j.status === "failed").length,
    completed: jobs.filter((j) => j.status === "completed").length,
  };
}
