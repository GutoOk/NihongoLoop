import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { buildSingleAiRequest } from "./prompts";
import { generateStructuredJsonWithMeta } from "../geminiJson";

export const AI_QUEUE_SCHEMA_VERSION = "2026-06-ai-queue-v25";

type QueueJob = {
  id: string;
  user_id: string;
  run_id?: string | null;
  stage_id?: string | null;
  type: string;
  target_type: string;
  target_id: string;
  target_hash?: string | null;
  input_hash?: string | null;
  input?: any;
  payload?: any;
  model?: string | null;
  model_version?: string | null;
  prompt_version?: string | null;
  attempts?: number | null;
  max_attempts?: number | null;
  worker_id?: string | null;
  cancel_requested?: boolean | null;
};

export interface AiQueueWorkerOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  getAi: () => GoogleGenAI;
  enabled?: boolean;
  pollMs?: number;
  claimLimit?: number;
  leaseSeconds?: number;
  workerId?: string;
}

export interface AiQueueWorkerHandle {
  stop: () => void;
}

export type WorkerStartupValidation = {
  ok: boolean;
  errors: string[];
  schemaVersion?: string | null;
};

function isMissingOrPlaceholder(value: string | undefined | null): boolean {
  return !value || value.includes("PLACEHOLDER") || value.includes("changeme") || value.includes("example");
}

export async function validateAiWorkerStartup(options: {
  supabaseUrl: string;
  serviceRoleKey: string;
  requireGemini?: boolean;
  requireHealthToken?: boolean;
}): Promise<WorkerStartupValidation> {
  const errors: string[] = [];
  if (isMissingOrPlaceholder(options.supabaseUrl)) errors.push("SUPABASE_URL/VITE_SUPABASE_URL ausente.");
  if (isMissingOrPlaceholder(options.serviceRoleKey)) errors.push("SUPABASE_SERVICE_ROLE_KEY ausente ou placeholder.");
  if (options.requireGemini && isMissingOrPlaceholder(process.env.GEMINI_API_KEY)) {
    errors.push("GEMINI_API_KEY ausente ou placeholder.");
  }
  if (options.requireHealthToken && isMissingOrPlaceholder(process.env.INTERNAL_HEALTH_TOKEN)) {
    errors.push("INTERNAL_HEALTH_TOKEN ausente ou placeholder.");
  }
  if (errors.length > 0) return { ok: false, errors };

  const client = createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const health = await getAiQueueHealth(client);
    const schemaVersion = health.schemaVersion || null;
    if (schemaVersion !== AI_QUEUE_SCHEMA_VERSION) {
      errors.push(`Schema AI queue incompativel: esperado ${AI_QUEUE_SCHEMA_VERSION}, recebido ${schemaVersion || "desconhecido"}.`);
    }
    return { ok: errors.length === 0, errors, schemaVersion };
  } catch (error: any) {
    return { ok: false, errors: [`Falha ao consultar Supabase/RPC de healthcheck: ${error.message || String(error)}`] };
  }
}

export async function getAiQueueHealth(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_ai_queue_health");
  if (error) throw error;
  const health = (data || {}) as any;
  return {
    schemaVersion: health.schema_version || health.schemaVersion || null,
    supabase: "ok",
    pendingJobs: Number(health.pending_jobs || 0),
    claimedJobs: Number(health.claimed_jobs || 0),
    runningJobs: Number(health.running_jobs || 0),
    retryWaitJobs: Number(health.retry_wait_jobs || 0),
    expiredLeases: Number(health.expired_leases || 0),
    lastClaimAt: health.last_claim_at || null,
    lastError: health.last_error || null,
  };
}

function parseMaybeJson(value: any) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function getJobInput(job: QueueJob) {
  return parseMaybeJson(job.payload) || parseMaybeJson(job.input) || {};
}

function buildJobRequest(job: QueueJob) {
  const request = buildSingleAiRequest(job.type, getJobInput(job));
  return {
    ...request,
    model: job.model || job.model_version || request.model,
    promptVersion: job.prompt_version || request.promptVersion,
  };
}

function getTypeLimit(jobType: string): number {
  if (jobType === "translate_sentence") return Math.max(1, Math.min(Number(process.env.AI_WORKER_TRANSLATE_CONCURRENCY || 4), 32));
  if (jobType === "generate_sentence_reading") return Math.max(1, Math.min(Number(process.env.AI_WORKER_READING_CONCURRENCY || 2), 32));
  if (jobType === "detect_sentence_terms") return Math.max(1, Math.min(Number(process.env.AI_WORKER_TERMS_CONCURRENCY || 1), 16));
  if (jobType === "enrich_dictionary_entry") return Math.max(1, Math.min(Number(process.env.AI_WORKER_DICTIONARY_CONCURRENCY || 1), 16));
  return 0;
}

function getGlobalLimit(): number {
  return Math.max(1, Math.min(Number(process.env.AI_WORKER_GLOBAL_CONCURRENCY || 8), 64));
}

function getUserLimit(): number {
  return Math.max(1, Math.min(Number(process.env.AI_WORKER_USER_CONCURRENCY || 4), 32));
}

type ModelPrice = { inputPerMillion: number; outputPerMillion: number };
const modelPriceCache = new Map<string, ModelPrice | null>();

async function getModelPrice(client: SupabaseClient, model: string | null | undefined): Promise<ModelPrice | null> {
  const modelKey = model || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  if (modelPriceCache.has(modelKey)) return modelPriceCache.get(modelKey) || null;

  const { data, error } = await client
    .from("ai_model_prices")
    .select("input_per_million,output_per_million")
    .eq("provider", "google")
    .eq("model", modelKey)
    .lte("effective_from", new Date().toISOString())
    .or("effective_to.is.null,effective_to.gt." + new Date().toISOString())
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    const price = {
      inputPerMillion: Number((data as any).input_per_million),
      outputPerMillion: Number((data as any).output_per_million),
    };
    modelPriceCache.set(modelKey, price);
    return price;
  }

  const inputPerMillion = Number(process.env.GEMINI_INPUT_PRICE_PER_MILLION || "");
  const outputPerMillion = Number(process.env.GEMINI_OUTPUT_PRICE_PER_MILLION || "");
  const fallback = Number.isFinite(inputPerMillion) && Number.isFinite(outputPerMillion)
    ? { inputPerMillion, outputPerMillion }
    : null;
  modelPriceCache.set(modelKey, fallback);
  return fallback;
}

async function estimateCostActual(
  client: SupabaseClient,
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): Promise<number | null> {
  if (inputTokens == null && outputTokens == null) return null;
  const price = await getModelPrice(client, model);
  if (!price) return null;
  return ((inputTokens || 0) / 1_000_000) * price.inputPerMillion + ((outputTokens || 0) / 1_000_000) * price.outputPerMillion;
}

async function maybeAdvanceRun(client: SupabaseClient, runId: string | null | undefined) {
  if (!runId) return;

  const { data: run, error: runError } = await client
    .from("processing_runs")
    .select("id,user_id,source_id,status,cancel_requested,run_mode")
    .eq("id", runId)
    .maybeSingle();
  if (runError) throw runError;
  if (!run || run.cancel_requested || run.status === "cancelled" || run.status === "completed") return;

  const { error } = await client.rpc("create_or_resume_source_processing_run", {
    p_source_id: run.source_id,
    p_user_id: run.user_id,
    p_run_mode: run.run_mode || "all",
  });
  if (error) throw error;
}

function classifyError(error: unknown): { message: string; code: string | null; kind: "transient" | "permanent" | "rate_limit" | "invalid_response" } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("429") || lower.includes("rate") || lower.includes("resource_exhausted")) {
    return { message, code: "RATE_LIMIT", kind: "rate_limit" };
  }
  if (lower.includes("resultado invalido") || lower.includes("tradu") && lower.includes("ausente") || lower.includes("kana") || lower.includes("romaji")) {
    return { message, code: "INVALID_AI_RESPONSE", kind: "invalid_response" };
  }
  if (lower.includes("frase nao encontrada") || lower.includes("job sem sentence")) {
    return { message, code: "INVALID_JOB_INPUT", kind: "permanent" };
  }
  return { message, code: "TRANSIENT_ERROR", kind: "transient" };
}

async function claimJobs(
  client: SupabaseClient,
  workerId: string,
  jobTypes: string[],
  claimLimit: number,
  leaseSeconds: number,
  userLimit: number,
  typeLimits: Record<string, number>,
): Promise<QueueJob[]> {
  const { data, error } = await client.rpc("claim_ai_jobs", {
    p_worker_id: workerId,
    p_job_types: jobTypes,
    p_limit: claimLimit,
    p_lease_seconds: leaseSeconds,
    p_user_id: null,
    p_run_id: null,
    p_user_limit: userLimit,
    p_type_limits: typeLimits,
  });
  if (error) throw error;
  return (data || []) as QueueJob[];
}

async function claimCoordinatedJobs(
  client: SupabaseClient,
  workerId: string,
  leaseSeconds: number,
): Promise<QueueJob[]> {
  const supportedTypes = ["translate_sentence", "generate_sentence_reading", "detect_sentence_terms", "enrich_dictionary_entry"];
  const globalLimit = getGlobalLimit();
  const userLimit = getUserLimit();
  const typeLimits = Object.fromEntries(supportedTypes.map((type) => [type, getTypeLimit(type)]));
  return claimJobs(client, workerId, supportedTypes, globalLimit, leaseSeconds, userLimit, typeLimits);
}

async function startJob(client: SupabaseClient, job: QueueJob, workerId: string, leaseSeconds: number): Promise<QueueJob> {
  const { data, error } = await client.rpc("start_claimed_ai_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return data as QueueJob;
}

async function validateJobForExecution(client: SupabaseClient, jobId: string, workerId: string): Promise<QueueJob | null> {
  const { data, error } = await client.rpc("validate_ai_job_for_execution", {
    p_job_id: jobId,
    p_worker_id: workerId,
  });
  if (error) throw error;
  if (!data?.can_execute) return null;
  return data as QueueJob;
}

async function applyTranslationResultRpc(
  client: SupabaseClient,
  jobId: string,
  workerId: string,
  translation: string,
  result: any,
  rawResult: any,
  meta: { inputTokens?: number | null; outputTokens?: number | null; latencyAiMs?: number | null; costActual?: number | null },
) {
  const { data, error } = await client.rpc("apply_sentence_translation_result", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_translation: translation,
    p_result: result,
    p_raw_result: rawResult,
    p_input_tokens: meta.inputTokens ?? null,
    p_output_tokens: meta.outputTokens ?? null,
    p_cost_actual: meta.costActual ?? null,
    p_latency_ai_ms: meta.latencyAiMs ?? null,
  });
  if (error) throw error;
  return data;
}

async function applyReadingResultRpc(
  client: SupabaseClient,
  jobId: string,
  workerId: string,
  kana: string,
  romaji: string,
  result: any,
  rawResult: any,
  meta: { inputTokens?: number | null; outputTokens?: number | null; latencyAiMs?: number | null; costActual?: number | null },
) {
  const { data, error } = await client.rpc("apply_sentence_reading_result", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_kana: kana,
    p_romaji: romaji,
    p_result: result,
    p_raw_result: rawResult,
    p_input_tokens: meta.inputTokens ?? null,
    p_output_tokens: meta.outputTokens ?? null,
    p_cost_actual: meta.costActual ?? null,
    p_latency_ai_ms: meta.latencyAiMs ?? null,
  });
  if (error) throw error;
  return data;
}

async function applyLexicalResultRpc(
  client: SupabaseClient,
  jobId: string,
  workerId: string,
  analysis: { kana?: string; romaji?: string; terms?: unknown[] },
  result: any,
  rawResult: any,
  meta: { inputTokens?: number | null; outputTokens?: number | null; latencyAiMs?: number | null; costActual?: number | null },
) {
  const { data, error } = await client.rpc("apply_sentence_lexical_analysis_result", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_kana: analysis.kana ?? null,
    p_romaji: analysis.romaji ?? null,
    p_terms: Array.isArray(analysis.terms) ? analysis.terms : [],
    p_result: result,
    p_raw_result: rawResult,
    p_input_tokens: meta.inputTokens ?? null,
    p_output_tokens: meta.outputTokens ?? null,
    p_cost_actual: meta.costActual ?? null,
    p_latency_ai_ms: meta.latencyAiMs ?? null,
  });
  if (error) throw error;
  return data;
}

async function applyDictionaryResultRpc(
  client: SupabaseClient,
  jobId: string,
  workerId: string,
  enrichment: any,
  result: any,
  rawResult: any,
  meta: { inputTokens?: number | null; outputTokens?: number | null; latencyAiMs?: number | null; costActual?: number | null },
) {
  const { data, error } = await client.rpc("apply_dictionary_enrichment_result", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_enrichment: enrichment,
    p_result: result,
    p_raw_result: rawResult,
    p_input_tokens: meta.inputTokens ?? null,
    p_output_tokens: meta.outputTokens ?? null,
    p_cost_actual: meta.costActual ?? null,
    p_latency_ai_ms: meta.latencyAiMs ?? null,
  });
  if (error) throw error;
  return data;
}

async function failJob(client: SupabaseClient, jobId: string, workerId: string, error: unknown) {
  const classified = classifyError(error);
  const { error: rpcError } = await client.rpc("fail_ai_job_for_retry", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_error: classified.message,
    p_error_code: classified.code,
    p_error_kind: classified.kind,
    p_retry_at: null,
  });
  if (rpcError) throw rpcError;
}

async function cancelRunningJob(client: SupabaseClient, jobId: string, workerId: string, reason: string) {
  const { error } = await client.rpc("cancel_running_ai_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_reason: reason,
  });
  if (error) throw error;
}

function withLeaseHeartbeat<T>(
  client: SupabaseClient,
  jobId: string,
  workerId: string,
  leaseSeconds: number,
  work: () => Promise<T>,
): Promise<T> {
  const intervalMs = Math.max(5000, Math.floor(leaseSeconds * 1000 / 3));
  const timer = setInterval(() => {
    client.rpc("heartbeat_ai_job", {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    }).then(({ error }) => {
      if (error) {
        console.error("[ai-worker] heartbeat failed", { jobId, error });
      }
    });
  }, intervalMs);

  return work().finally(() => clearInterval(timer));
}

export async function processTranslateSentenceJob(
  client: SupabaseClient,
  job: QueueJob,
  workerId: string,
  leaseSeconds: number,
  getAi: () => GoogleGenAI,
) {
  await startJob(client, job, workerId, leaseSeconds);
  const runningJob = await validateJobForExecution(client, job.id, workerId);
  if (!runningJob) return;
  const input = getJobInput(runningJob);
  const sentenceText = input.sentence || input.japanese;
  if (!sentenceText) throw new Error("Job sem texto japones para traducao.");

  const request = buildJobRequest(runningJob);
  const { data, meta } = await generateStructuredJsonWithMeta<{ translation?: string }>({
    ai: getAi(),
    prompt: request.prompt,
    responseSchema: request.responseSchema,
    model: request.model,
    temperature: request.temperature,
  });

  if (!data.translation || !String(data.translation).trim()) {
    throw new Error("Resultado invalido: traducao ausente.");
  }

  await applyTranslationResultRpc(
    client,
    runningJob.id,
    workerId,
    data.translation,
    {
      translation: data.translation,
      sentence_id: input.id || runningJob.target_id,
      ai_meta: {
        job_type: runningJob.type,
        prompt_version: request.promptVersion,
        model: meta.model,
        temperature: meta.temperature,
        latency_ms: meta.latency_ms,
        input_chars: meta.input_chars,
        output_chars: meta.output_chars,
        usage_metadata: meta.usage_metadata,
      },
    },
    data,
    {
      latencyAiMs: meta.latency_ms,
      inputTokens: (meta.usage_metadata as any)?.promptTokenCount ?? null,
      outputTokens: (meta.usage_metadata as any)?.candidatesTokenCount ?? null,
      costActual: await estimateCostActual(
        client,
        meta.model,
        (meta.usage_metadata as any)?.promptTokenCount ?? null,
        (meta.usage_metadata as any)?.candidatesTokenCount ?? null,
      ),
    },
  );
}

export async function processGenerateSentenceReadingJob(
  client: SupabaseClient,
  job: QueueJob,
  workerId: string,
  leaseSeconds: number,
  getAi: () => GoogleGenAI,
) {
  await startJob(client, job, workerId, leaseSeconds);
  const runningJob = await validateJobForExecution(client, job.id, workerId);
  if (!runningJob) return;
  const input = getJobInput(runningJob);
  if (!input.sentence && !input.japanese) throw new Error("Job sem texto japones para leitura.");

  const request = buildJobRequest(runningJob);
  const { data, meta } = await generateStructuredJsonWithMeta<{ kana?: string; romaji?: string; terms?: unknown[] }>({
    ai: getAi(),
    prompt: request.prompt,
    responseSchema: request.responseSchema,
    model: request.model,
    temperature: request.temperature,
  });

  if (!data.kana || !data.romaji) {
    throw new Error("Resultado invalido: kana ou romaji ausente.");
  }

  await applyReadingResultRpc(
    client,
    runningJob.id,
    workerId,
    data.kana,
    data.romaji,
    {
      kana: data.kana,
      romaji: data.romaji,
      sentence_id: input.id || runningJob.target_id,
      terms_detected: Array.isArray(data.terms) ? data.terms.length : 0,
      ai_meta: {
        job_type: runningJob.type,
        prompt_version: request.promptVersion,
        model: meta.model,
        temperature: meta.temperature,
        latency_ms: meta.latency_ms,
        input_chars: meta.input_chars,
        output_chars: meta.output_chars,
        usage_metadata: meta.usage_metadata,
      },
    },
    data,
    {
      latencyAiMs: meta.latency_ms,
      inputTokens: (meta.usage_metadata as any)?.promptTokenCount ?? null,
      outputTokens: (meta.usage_metadata as any)?.candidatesTokenCount ?? null,
      costActual: await estimateCostActual(
        client,
        meta.model,
        (meta.usage_metadata as any)?.promptTokenCount ?? null,
        (meta.usage_metadata as any)?.candidatesTokenCount ?? null,
      ),
    },
  );
}

export async function processDetectSentenceTermsJob(
  client: SupabaseClient,
  job: QueueJob,
  workerId: string,
  leaseSeconds: number,
  getAi: () => GoogleGenAI,
) {
  await startJob(client, job, workerId, leaseSeconds);
  const runningJob = await validateJobForExecution(client, job.id, workerId);
  if (!runningJob) return;
  const input = getJobInput(runningJob);
  if (!input.sentence && !input.japanese) throw new Error("Job sem texto japones para deteccao de termos.");

  const request = buildJobRequest(runningJob);
  const { data, meta } = await generateStructuredJsonWithMeta<{ kana?: string; romaji?: string; terms?: unknown[] }>({
    ai: getAi(),
    prompt: request.prompt,
    responseSchema: request.responseSchema,
    model: request.model,
    temperature: request.temperature,
  });

  if (!Array.isArray(data.terms)) {
    throw new Error("Resultado invalido: lista de termos ausente.");
  }

  await applyLexicalResultRpc(
    client,
    runningJob.id,
    workerId,
    data,
    {
      sentence_id: input.id || runningJob.target_id,
      termCount: Array.isArray(data.terms) ? data.terms.length : 0,
      ai_meta: {
        job_type: runningJob.type,
        prompt_version: request.promptVersion,
        model: meta.model,
        temperature: meta.temperature,
        latency_ms: meta.latency_ms,
        input_chars: meta.input_chars,
        output_chars: meta.output_chars,
        usage_metadata: meta.usage_metadata,
      },
    },
    data,
    {
      latencyAiMs: meta.latency_ms,
      inputTokens: (meta.usage_metadata as any)?.promptTokenCount ?? null,
      outputTokens: (meta.usage_metadata as any)?.candidatesTokenCount ?? null,
      costActual: await estimateCostActual(
        client,
        meta.model,
        (meta.usage_metadata as any)?.promptTokenCount ?? null,
        (meta.usage_metadata as any)?.candidatesTokenCount ?? null,
      ),
    },
  );
}

export async function processEnrichDictionaryEntryJob(
  client: SupabaseClient,
  job: QueueJob,
  workerId: string,
  leaseSeconds: number,
  getAi: () => GoogleGenAI,
) {
  await startJob(client, job, workerId, leaseSeconds);
  const runningJob = await validateJobForExecution(client, job.id, workerId);
  if (!runningJob) return;
  const input = getJobInput(runningJob);
  if (!input.lemma) throw new Error("Job sem lemma para enriquecimento de dicionario.");

  const request = buildJobRequest(runningJob);
  const { data, meta } = await generateStructuredJsonWithMeta<any>({
    ai: getAi(),
    prompt: request.prompt,
    responseSchema: request.responseSchema,
    model: request.model,
    temperature: request.temperature,
  });

  await applyDictionaryResultRpc(
    client,
    runningJob.id,
    workerId,
    data,
    {
      entry_id: input.entryId || input.id || runningJob.target_id,
      ai_meta: {
        job_type: runningJob.type,
        prompt_version: request.promptVersion,
        model: meta.model,
        temperature: meta.temperature,
        latency_ms: meta.latency_ms,
        input_chars: meta.input_chars,
        output_chars: meta.output_chars,
        usage_metadata: meta.usage_metadata,
      },
    },
    data,
    {
      latencyAiMs: meta.latency_ms,
      inputTokens: (meta.usage_metadata as any)?.promptTokenCount ?? null,
      outputTokens: (meta.usage_metadata as any)?.candidatesTokenCount ?? null,
      costActual: await estimateCostActual(
        client,
        meta.model,
        (meta.usage_metadata as any)?.promptTokenCount ?? null,
        (meta.usage_metadata as any)?.candidatesTokenCount ?? null,
      ),
    },
  );
}

export function startAiQueueWorker(options: AiQueueWorkerOptions): AiQueueWorkerHandle | null {
  if (!options.enabled) return null;
  if (!options.supabaseUrl || !options.serviceRoleKey) {
    console.warn("[ai-worker] Disabled: SUPABASE_SERVICE_ROLE_KEY is required.");
    return null;
  }

  const client = createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const workerId = options.workerId || `cloud-run-ai-worker-${Math.random().toString(36).slice(2)}`;
  const pollMs = Math.max(500, options.pollMs || Number(process.env.AI_WORKER_POLL_MS || 2000));
  const leaseSeconds = Math.max(30, Math.min(options.leaseSeconds || Number(process.env.AI_WORKER_LEASE_SECONDS || 300), 3600));
  let stopped = false;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped || active) return;
    active = true;
    try {
      await client.rpc("recover_expired_ai_job_leases", {
        p_limit: 250,
        p_retry_delay_seconds: 60,
      });
      const jobs = await claimCoordinatedJobs(client, workerId, leaseSeconds);
      if (jobs.length > 0) {
        await Promise.all(
          jobs.map(async (job) => {
            try {
              await withLeaseHeartbeat(client, job.id, workerId, leaseSeconds, async () => {
                if (job.type === "translate_sentence") {
                  await processTranslateSentenceJob(client, job, workerId, leaseSeconds, options.getAi);
                } else if (job.type === "generate_sentence_reading") {
                  await processGenerateSentenceReadingJob(client, job, workerId, leaseSeconds, options.getAi);
                } else if (job.type === "detect_sentence_terms") {
                  await processDetectSentenceTermsJob(client, job, workerId, leaseSeconds, options.getAi);
                } else if (job.type === "enrich_dictionary_entry") {
                  await processEnrichDictionaryEntryJob(client, job, workerId, leaseSeconds, options.getAi);
                } else {
                  throw new Error(`Tipo de job nao suportado pelo worker: ${job.type}`);
                }
              });
              await maybeAdvanceRun(client, job.run_id);
            } catch (error) {
              console.error("[ai-worker] job failed", { jobId: job.id, type: job.type, error });
              try {
                const message = error instanceof Error ? error.message : String(error);
                if (message.toLowerCase().includes("cancelado")) {
                  await cancelRunningJob(client, job.id, workerId, message);
                } else {
                  await failJob(client, job.id, workerId, error);
                }
                await maybeAdvanceRun(client, job.run_id);
              } catch (failError) {
                console.error("[ai-worker] failed to persist job failure", { jobId: job.id, failError });
              }
            }
          }),
        );
      }
    } catch (error) {
      console.error("[ai-worker] polling cycle failed", error);
    } finally {
      active = false;
      if (!stopped) timer = setTimeout(tick, pollMs);
    }
  };

  console.log("[ai-worker] Started", {
    workerId,
    pollMs,
    leaseSeconds,
    concurrency: {
      global: getGlobalLimit(),
      per_user: getUserLimit(),
      translate_sentence: getTypeLimit("translate_sentence"),
      generate_sentence_reading: getTypeLimit("generate_sentence_reading"),
      detect_sentence_terms: getTypeLimit("detect_sentence_terms"),
      enrich_dictionary_entry: getTypeLimit("enrich_dictionary_entry"),
    },
    jobTypes: ["translate_sentence", "generate_sentence_reading", "detect_sentence_terms", "enrich_dictionary_entry"],
  });
  timer = setTimeout(tick, 250);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
