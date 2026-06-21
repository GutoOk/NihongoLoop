import { AiJob } from "../../types";

const VISIBLE_QUEUE_STATUSES = new Set([
  "pending",
  "claimed",
  "running",
  "retry_wait",
  "failed",
  "error",
  "needs_review",
]);

export function getJobHumanName(type: string): string {
  if (type === "translate_sentence") return "Traducao de frase";
  if (type === "generate_sentence_reading") return "Leitura de frase";
  if (type === "detect_sentence_terms") return "Termos da frase";
  if (type === "enrich_dictionary_entry" || type === "generate_dictionary_senses") return "Completar verbete";
  if (type === "explain_sentence") return "Explicacao";
  if (type === "repair_sentence") return "Reparo";
  return type;
}

export function isVisibleQueueJob(job: AiJob): boolean {
  return VISIBLE_QUEUE_STATUSES.has(job.status);
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function getFirstFilledObject(...values: unknown[]) {
  for (const value of values) {
    const data = typeof value === "string" ? safeJsonParse(value) : value;
    if (data && typeof data === "object" && Object.keys(data).length > 0) {
      return data as Record<string, unknown>;
    }
  }
  return {};
}

export function getJobPreview(job: AiJob): string {
  const data = getFirstFilledObject(job.payload, job.input);
  const preview = data.japanese || data.sentence || data.lemma || data.surface || data.word || data.term;
  return typeof preview === "string" && preview.trim() ? preview : "Item indisponivel";
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
