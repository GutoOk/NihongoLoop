import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
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
  attempts?: number | null;
  max_attempts?: number | null;
  cancel_requested?: boolean | null;
};

type SentenceRow = {
  id: string;
  user_id: string;
  source_id: string;
  japanese: string;
  japanese_key: string | null;
  portuguese: string | null;
  kana: string | null;
  romaji: string | null;
  status: string;
};

type DictionaryEntryRow = {
  id: string;
  user_id: string;
  lemma: string;
  kana: string | null;
  romaji: string | null;
  type: string | null;
  jlpt_level: string | null;
  status: string;
  tags: string[] | null;
  unique_key: string;
  main_meaning: string | null;
  subtype?: string | null;
  components?: any;
  grammar_info?: string | null;
  short_note?: string | null;
};

type NormalizedTerm = {
  surface: string;
  lemma: string;
  type: string;
  entryKana: string | null;
  entryRomaji: string | null;
  formKana: string | null;
  formRomaji: string | null;
  formType: string;
  grammarNote: string | null;
  meaning: string | null;
  startIndex: number;
  endIndex: number;
  confidence: number;
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

function estimateCostActual(inputTokens: number | null | undefined, outputTokens: number | null | undefined): number | null {
  const inputPerMillion = Number(process.env.GEMINI_INPUT_PRICE_PER_MILLION || "");
  const outputPerMillion = Number(process.env.GEMINI_OUTPUT_PRICE_PER_MILLION || "");
  if (!Number.isFinite(inputPerMillion) || !Number.isFinite(outputPerMillion)) return null;
  if (inputTokens == null && outputTokens == null) return null;
  return ((inputTokens || 0) / 1_000_000) * inputPerMillion + ((outputTokens || 0) / 1_000_000) * outputPerMillion;
}

function stableServerHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function ensureRunStage(
  client: SupabaseClient,
  params: { userId: string; runId: string; stage: string },
): Promise<string> {
  const { data: existing, error: existingError } = await client
    .from("processing_run_stages")
    .select("id")
    .eq("run_id", params.runId)
    .eq("stage", params.stage)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  const { data, error } = await client
    .from("processing_run_stages")
    .insert({
      user_id: params.userId,
      run_id: params.runId,
      stage: params.stage,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function buildWorkerJobRow(
  params: {
    userId: string;
    runId: string;
    stageId: string;
    stage: string;
    type: string;
    targetType: string;
    targetId: string;
    priority: number;
    payload: Record<string, unknown>;
  },
) {
  const request = buildSingleAiRequest(params.type, params.payload);
  const targetHash = stableServerHash({
    targetType: params.targetType,
    targetId: params.targetId,
    payload: params.payload,
    promptVersion: request.promptVersion,
    model: request.model,
  });
  const inputHash = stableServerHash({
    type: params.type,
    targetType: params.targetType,
    targetId: params.targetId,
    targetHash,
  });
  return {
    user_id: params.userId,
    run_id: params.runId,
    stage_id: params.stageId,
    stage: params.stage,
    type: params.type,
    target_type: params.targetType,
    target_id: params.targetId,
    priority: params.priority,
    target_hash: targetHash,
    input_hash: inputHash,
    job_key: `${params.type}:${params.targetType}:${params.targetId}:${inputHash}`,
    prompt_version: request.promptVersion,
    model_version: request.model,
    model: request.model,
    payload: params.payload,
    input: params.payload,
    max_attempts: 3,
  };
}

async function enqueueWorkerJobsBulk(
  client: SupabaseClient,
  rows: Array<ReturnType<typeof buildWorkerJobRow>>,
) {
  if (rows.length === 0) return 0;
  const { data, error } = await client.rpc("enqueue_ai_jobs_bulk", {
    p_jobs: rows,
  });
  if (error) throw error;
  return Number(data || 0);
}

async function maybeAdvanceRun(client: SupabaseClient, runId: string | null | undefined) {
  if (!runId) return;

  const { data: run, error: runError } = await client
    .from("processing_runs")
    .select("id,user_id,source_id,status,cancel_requested")
    .eq("id", runId)
    .maybeSingle();
  if (runError) throw runError;
  if (!run || run.cancel_requested || run.status === "cancelled" || run.status === "completed") return;

  const { count: activeCount, error: activeError } = await client
    .from("ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .in("status", ["pending", "claimed", "running", "retry_wait"]);
  if (activeError) throw activeError;
  if ((activeCount || 0) > 0) return;

  const rows: any[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data: sentences, error: sentencesError } = await client
      .from("sentences")
      .select("id,user_id,source_id,japanese,japanese_key,portuguese,kana,romaji,status,terms_source")
      .eq("source_id", run.source_id)
      .eq("user_id", run.user_id)
      .order("order_index", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (sentencesError) throw sentencesError;
    rows.push(...(sentences || []));
    if (!sentences || sentences.length < pageSize) break;
  }
  const untranslated = rows.filter((sentence) => sentence.status !== "reviewed" && !sentence.portuguese);
  if (untranslated.length > 0) {
    const stageId = await ensureRunStage(client, { userId: run.user_id, runId, stage: "translation" });
    const jobRows = untranslated.map((sentence) =>
      buildWorkerJobRow({
        userId: run.user_id,
        runId,
        stageId,
        stage: "translation",
        type: "translate_sentence",
        targetType: "sentence",
        targetId: sentence.id,
        priority: 300,
        payload: { id: sentence.id, sentence: sentence.japanese, japanese: sentence.japanese, sourceId: run.source_id },
      }),
    );
    const created = await enqueueWorkerJobsBulk(client, jobRows);
    await client.from("processing_run_stages").update({ status: "running", planned_jobs: created, started_at: new Date().toISOString() }).eq("id", stageId);
    await client.from("processing_runs").update({
      status: "running",
      current_step: `Traducao: ${created} job(s) individuais planejados pelo worker.`,
      pending_jobs: created,
      planned_jobs: created,
    }).eq("id", runId);
    return;
  }

  const missingReading = rows.filter((sentence) =>
    sentence.status !== "reviewed" &&
    sentence.portuguese &&
    (!sentence.kana || !sentence.romaji)
  );
  if (missingReading.length > 0) {
    const stageId = await ensureRunStage(client, { userId: run.user_id, runId, stage: "reading" });
    const jobRows = missingReading.map((sentence) =>
      buildWorkerJobRow({
        userId: run.user_id,
        runId,
        stageId,
        stage: "reading",
        type: "generate_sentence_reading",
        targetType: "sentence",
        targetId: sentence.id,
        priority: 200,
        payload: {
          id: sentence.id,
          sentence: sentence.japanese,
          japanese: sentence.japanese,
          portuguese: sentence.portuguese,
          sourceId: run.source_id,
        },
      }),
    );
    const created = await enqueueWorkerJobsBulk(client, jobRows);
    await client.from("processing_run_stages").update({ status: "running", planned_jobs: created, started_at: new Date().toISOString() }).eq("id", stageId);
    await client.from("processing_runs").update({
      status: "running",
      current_step: `Leitura: ${created} job(s) individuais planejados pelo worker.`,
      pending_jobs: created,
      planned_jobs: created,
    }).eq("id", runId);
    return;
  }

  const missingTerms = rows.filter((sentence) =>
    sentence.status !== "reviewed" &&
    sentence.portuguese &&
    sentence.kana &&
    sentence.romaji &&
    !sentence.terms_source
  );
  if (missingTerms.length > 0) {
    const stageId = await ensureRunStage(client, { userId: run.user_id, runId, stage: "lexical_analysis" });
    const jobRows = missingTerms.map((sentence) =>
      buildWorkerJobRow({
        userId: run.user_id,
        runId,
        stageId,
        stage: "lexical_analysis",
        type: "detect_sentence_terms",
        targetType: "sentence",
        targetId: sentence.id,
        priority: 150,
        payload: {
          id: sentence.id,
          sentence: sentence.japanese,
          japanese: sentence.japanese,
          portuguese: sentence.portuguese,
          kana: sentence.kana,
          romaji: sentence.romaji,
          sourceId: run.source_id,
        },
      }),
    );
    const created = await enqueueWorkerJobsBulk(client, jobRows);
    await client.from("processing_run_stages").update({ status: "running", planned_jobs: created, started_at: new Date().toISOString() }).eq("id", stageId);
    await client.from("processing_runs").update({
      status: "running",
      current_step: `Analise lexical: ${created} job(s) individuais planejados pelo worker.`,
      pending_jobs: created,
      planned_jobs: created,
    }).eq("id", runId);
    return;
  }

  const sentenceIds = rows.map((sentence) => sentence.id);
  const { data: terms, error: termsError } = sentenceIds.length > 0
    ? await client
      .from("sentence_terms")
      .select("dictionary_forms(dictionary_entry_id)")
      .eq("user_id", run.user_id)
      .in("sentence_id", sentenceIds)
    : { data: [], error: null };
  if (termsError) throw termsError;

  const entryIds = Array.from(new Set((terms || [])
    .map((term: any) => term.dictionary_forms?.dictionary_entry_id)
    .filter(Boolean)));

  if (entryIds.length > 0) {
    const { data: entries, error: entriesError } = await client
      .from("dictionary_entries")
      .select("id,lemma,kana,romaji,type,main_meaning,status")
      .eq("user_id", run.user_id)
      .in("id", entryIds);
    if (entriesError) throw entriesError;

    const incomplete = (entries || []).filter((entry: any) =>
      entry.status !== "reviewed" &&
      (!entry.main_meaning || !entry.kana || !entry.romaji || !entry.type)
    );
    if (incomplete.length > 0) {
      const stageId = await ensureRunStage(client, { userId: run.user_id, runId, stage: "dictionary" });
      const jobRows = incomplete.map((entry: any) =>
        buildWorkerJobRow({
          userId: run.user_id,
          runId,
          stageId,
          stage: "dictionary",
          type: "enrich_dictionary_entry",
          targetType: "dictionary_entry",
          targetId: entry.id,
          priority: 100,
          payload: { id: entry.id, entryId: entry.id, lemma: entry.lemma, sourceId: run.source_id },
        }),
      );
      const created = await enqueueWorkerJobsBulk(client, jobRows);
      await client.from("processing_run_stages").update({ status: "running", planned_jobs: created, started_at: new Date().toISOString() }).eq("id", stageId);
      await client.from("processing_runs").update({
        status: "running",
        current_step: `Dicionario: ${created} job(s) individuais planejados pelo worker.`,
        pending_jobs: created,
        planned_jobs: created,
      }).eq("id", runId);
      return;
    }
  }

  await client.from("processing_runs").update({
    status: "completed",
    current_step: "Preparacao concluida pelo worker.",
    finished_at: new Date().toISOString(),
    pending_jobs: 0,
  }).eq("id", runId);
}

function isSameAsJapanese(japanese: string | null | undefined, translation: string | null | undefined): boolean {
  const rawJapanese = String(japanese || "").trim();
  const rawTranslation = String(translation || "").trim();
  return Boolean(rawJapanese && rawTranslation && rawJapanese === rawTranslation);
}

function hasValidTranslation(sentence: SentenceRow): boolean {
  return Boolean(sentence.portuguese && !isSameAsJapanese(sentence.japanese, sentence.portuguese));
}

function normalizePortugueseTranslation(sentence: SentenceRow, translation: string): string {
  const cleanTranslation = String(translation || "").trim();
  if (!isSameAsJapanese(sentence.japanese, cleanTranslation)) return cleanTranslation;
  return `Expressao japonesa sem traducao literal direta: ${sentence.japanese}.`;
}

function compactKey(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function dictionaryUniqueKey(lemma: string, kana: string | null, type: string): string {
  return `${compactKey(lemma)}|${compactKey(kana)}|${compactKey(type || "outro")}`;
}

function formUniqueKey(entryId: string, form: string, formType?: string | null): string {
  return `${entryId}|${compactKey(form)}|${compactKey(formType || "default")}`;
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
): Promise<QueueJob[]> {
  const { data, error } = await client.rpc("claim_ai_jobs", {
    p_worker_id: workerId,
    p_job_types: jobTypes,
    p_limit: claimLimit,
    p_lease_seconds: leaseSeconds,
    p_user_id: null,
    p_run_id: null,
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
  const jobs: QueueJob[] = [];
  const byUser = new Map<string, number>();
  const byType = new Map<string, number>();

  const claimed = await claimJobs(client, workerId, supportedTypes, globalLimit, leaseSeconds);
  for (const job of claimed) {
    const userCount = byUser.get(job.user_id) || 0;
    const typeCount = byType.get(job.type) || 0;
    if (
      userCount >= userLimit ||
      typeCount >= getTypeLimit(job.type) ||
      jobs.length >= globalLimit
    ) {
      await client.rpc("release_claimed_ai_job", { p_job_id: job.id, p_worker_id: workerId });
      continue;
    }
    byUser.set(job.user_id, userCount + 1);
    byType.set(job.type, typeCount + 1);
    jobs.push(job);
  }

  return jobs;
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

async function completeJob(
  client: SupabaseClient,
  jobId: string,
  workerId: string,
  result: any,
  rawResult: any,
  meta: { inputTokens?: number | null; outputTokens?: number | null; latencyAiMs?: number | null; costActual?: number | null },
) {
  const { error } = await client.rpc("complete_ai_job", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_result: result,
    p_raw_result: rawResult,
    p_input_tokens: meta.inputTokens ?? null,
    p_output_tokens: meta.outputTokens ?? null,
    p_cost_actual: meta.costActual ?? null,
    p_latency_ai_ms: meta.latencyAiMs ?? null,
    p_latency_persist_ms: null,
  });
  if (error) throw error;
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
  const { error } = await client
    .from("ai_jobs")
    .update({
      status: "cancelled",
      error: reason,
      error_code: "USER_CANCELLED",
      error_kind: "permanent",
      locked_by: null,
      locked_until: null,
      lease_expires_at: null,
      worker_id: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("worker_id", workerId)
    .eq("status", "running");
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

async function markObsolete(client: SupabaseClient, job: QueueJob, reason: string) {
  const { error } = await client
    .from("ai_jobs")
    .update({
      status: "obsolete",
      error: reason,
      error_code: "OBSOLETE_INPUT",
      error_kind: "permanent",
      locked_by: null,
      locked_until: null,
      lease_expires_at: null,
      worker_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (error) throw error;
}

function expectedHashForJob(jobType: string, targetType: string, targetId: string, payload: Record<string, unknown>): string {
  const request = buildSingleAiRequest(jobType, payload);
  return stableServerHash({
    targetType,
    targetId,
    payload,
    promptVersion: request.promptVersion,
    model: request.model,
  });
}

async function markObsoleteIfHashChanged(
  client: SupabaseClient,
  job: QueueJob,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!job.input_hash && !(job as any).target_hash) return false;
  const storedTargetHash = (job as any).target_hash;
  if (!storedTargetHash) return false;
  const expected = expectedHashForJob(job.type, job.target_type, job.target_id, payload);
  if (expected === storedTargetHash) return false;
  await markObsolete(client, job, "O alvo mudou depois da criacao do job.");
  return true;
}

async function assertJobStillRunning(client: SupabaseClient, jobId: string, workerId: string) {
  const { data, error } = await client
    .from("ai_jobs")
    .select("id,status,worker_id,cancel_requested")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "running" || data.worker_id !== workerId) {
    throw new Error("Job deixou de estar ativo antes da persistencia do resultado.");
  }
  if (data.cancel_requested) {
    throw new Error("Job cancelado durante o processamento.");
  }
}

async function fetchSentence(client: SupabaseClient, job: QueueJob): Promise<SentenceRow | null> {
  const input = getJobInput(job);
  const sentenceId = input.id || input.sentenceId || (job.target_type === "sentence" ? job.target_id : null);
  if (!sentenceId) throw new Error("Job sem sentenceId para traducao.");

  const { data, error } = await client
    .from("sentences")
    .select("id,user_id,source_id,japanese,japanese_key,portuguese,kana,romaji,status")
    .eq("id", sentenceId)
    .eq("user_id", job.user_id)
    .maybeSingle();
  if (error) throw error;
  return data as SentenceRow | null;
}

async function fetchDictionaryEntry(client: SupabaseClient, job: QueueJob): Promise<DictionaryEntryRow | null> {
  const input = getJobInput(job);
  const entryId = input.entryId || input.id || (job.target_type === "dictionary_entry" ? job.target_id : null);
  if (!entryId) throw new Error("Job sem entryId para enriquecimento de dicionario.");

  const { data, error } = await client
    .from("dictionary_entries")
    .select("id,user_id,lemma,kana,romaji,type,jlpt_level,status,tags,unique_key,main_meaning,subtype,components,grammar_info,short_note")
    .eq("id", entryId)
    .eq("user_id", job.user_id)
    .maybeSingle();
  if (error) throw error;
  return data as DictionaryEntryRow | null;
}

async function applyTranslation(client: SupabaseClient, sentence: SentenceRow, translation: string) {
  const normalized = normalizePortugueseTranslation(sentence, translation);
  const status = sentence.kana && sentence.romaji ? "reading_ready" : "translated";
  const now = new Date().toISOString();

  const { error } = await client
    .from("sentences")
    .update({
      portuguese: normalized,
      status,
      translation_source: "ai_worker",
      updated_at: now,
    })
    .eq("id", sentence.id)
    .eq("user_id", sentence.user_id)
    .neq("status", "reviewed");
  if (error) throw error;

  if (sentence.japanese_key) {
    await client
      .from("sentences")
      .update({
        portuguese: normalized,
        status,
        translation_source: "cache",
        updated_at: now,
      })
      .eq("source_id", sentence.source_id)
      .eq("user_id", sentence.user_id)
      .eq("japanese_key", sentence.japanese_key)
      .is("portuguese", null)
      .neq("status", "reviewed");
  }

  return normalized;
}

function normalizeRomaji(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function hasValidReading(sentence: SentenceRow): boolean {
  return Boolean(sentence.kana && sentence.romaji);
}

async function applySentenceReading(client: SupabaseClient, sentence: SentenceRow, kana: string, romaji: string) {
  const normalizedKana = String(kana || "").trim();
  const normalizedRomaji = normalizeRomaji(romaji);
  if (!normalizedKana || !normalizedRomaji) throw new Error("Resultado invalido: kana ou romaji ausente.");
  if (/[\u3040-\u30FF\u4E00-\u9FAF]/.test(normalizedRomaji)) {
    throw new Error("Resultado invalido: romaji contem caracteres japoneses.");
  }

  const status = sentence.portuguese ? "reading_ready" : sentence.status;
  const { error } = await client
    .from("sentences")
    .update({
      kana: normalizedKana,
      romaji: normalizedRomaji,
      status,
      reading_source: "ai_worker",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sentence.id)
    .eq("user_id", sentence.user_id)
    .neq("status", "reviewed");
  if (error) throw error;

  return { kana: normalizedKana, romaji: normalizedRomaji, status };
}

function normalizeTerms(sentence: SentenceRow, rawTerms: unknown[]): NormalizedTerm[] {
  const normalized: NormalizedTerm[] = [];
  const seen = new Set<string>();

  for (const raw of rawTerms as any[]) {
    const surface = String(raw?.surface || "").trim();
    const lemma = String(raw?.lemma || surface).trim();
    if (!surface || !lemma) continue;

    let startIndex = Number(raw?.start_index);
    let endIndex = Number(raw?.end_index);
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || sentence.japanese.substring(startIndex, endIndex) !== surface) {
      startIndex = sentence.japanese.indexOf(surface);
      endIndex = startIndex >= 0 ? startIndex + surface.length : -1;
    }
    if (startIndex < 0 || endIndex <= startIndex) continue;

    const type = String(raw?.type || "outro").trim() || "outro";
    const entryKana = raw?.entry_kana || raw?.kana || null;
    const entryRomaji = raw?.entry_romaji || raw?.romaji || null;
    const formKana = raw?.form_kana || raw?.kana || null;
    const formRomaji = raw?.form_romaji || raw?.romaji || null;
    const formType = raw?.form_type || (surface === lemma ? "forma de dicionario" : "forma encontrada");
    const meaning = raw?.meaning || raw?.context_meaning || null;
    const key = `${startIndex}:${endIndex}:${surface}:${lemma}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      surface,
      lemma,
      type,
      entryKana,
      entryRomaji,
      formKana,
      formRomaji,
      formType,
      grammarNote: raw?.grammar_note || null,
      meaning,
      startIndex,
      endIndex,
      confidence: Number.isFinite(Number(raw?.confidence)) ? Number(raw?.confidence) : 1,
    });
  }

  return normalized;
}

async function applySentenceTerms(client: SupabaseClient, sentence: SentenceRow, analysis: { kana?: string; romaji?: string; terms?: unknown[] }) {
  if (sentence.status === "reviewed") {
    return { termCount: 0, entryCount: 0, formCount: 0, senseCount: 0, skipped: "reviewed" };
  }

  const rawTerms = Array.isArray(analysis.terms) ? analysis.terms : [];
  const terms = normalizeTerms(sentence, rawTerms);
  const now = new Date().toISOString();

  if (analysis.kana && analysis.romaji && (!sentence.kana || !sentence.romaji)) {
    await applySentenceReading(client, sentence, analysis.kana, analysis.romaji);
  }

  await client
    .from("sentence_terms")
    .delete()
    .eq("sentence_id", sentence.id)
    .eq("user_id", sentence.user_id);

  if (terms.length === 0) {
    const { error } = await client
      .from("sentences")
      .update({ terms_source: "ai_empty", updated_at: now })
      .eq("id", sentence.id)
      .eq("user_id", sentence.user_id)
      .neq("status", "reviewed");
    if (error) throw error;
    return { termCount: 0, entryCount: 0, formCount: 0, senseCount: 0 };
  }

  const entriesByKey = new Map<string, any>();
  const entryRows = Array.from(new Map(terms.map((term) => {
    const uniqueKey = dictionaryUniqueKey(term.lemma, term.entryKana, term.type);
    return [uniqueKey, {
      user_id: sentence.user_id,
      lemma: term.lemma,
      kana: term.entryKana,
      romaji: term.entryRomaji,
      type: term.type,
      jlpt_level: null,
      status: "pending",
      tags: [],
      unique_key: uniqueKey,
      main_meaning: term.meaning,
      updated_at: now,
    }];
  })).values());

  const { error: entryUpsertError } = await client
    .from("dictionary_entries")
    .upsert(entryRows, { onConflict: "user_id,unique_key", ignoreDuplicates: true });
  if (entryUpsertError) throw entryUpsertError;

  const entryKeys = entryRows.map((entry) => entry.unique_key);
  const { data: entries, error: entryFetchError } = await client
    .from("dictionary_entries")
    .select("id,user_id,lemma,kana,romaji,type,unique_key,main_meaning")
    .eq("user_id", sentence.user_id)
    .in("unique_key", entryKeys);
  if (entryFetchError) throw entryFetchError;
  for (const entry of entries || []) entriesByKey.set(entry.unique_key, entry);

  const formRows: any[] = [];
  const termWithEntry = terms.flatMap((term) => {
    const entry = entriesByKey.get(dictionaryUniqueKey(term.lemma, term.entryKana, term.type));
    if (!entry) return [];
    const uniqueKey = formUniqueKey(entry.id, term.surface, term.formType);
    formRows.push({
      user_id: sentence.user_id,
      dictionary_entry_id: entry.id,
      form: term.surface,
      kana: term.formKana,
      romaji: term.formRomaji,
      form_type: term.formType,
      grammar_note: term.grammarNote,
      is_common: term.surface === term.lemma,
      status: "detected",
      unique_key: uniqueKey,
      updated_at: now,
    });
    return [{ term, entry, formKey: uniqueKey }];
  });

  const uniqueFormRows = Array.from(new Map(formRows.map((form) => [form.unique_key, form])).values());
  const { error: formUpsertError } = await client
    .from("dictionary_forms")
    .upsert(uniqueFormRows, { onConflict: "user_id,unique_key", ignoreDuplicates: true });
  if (formUpsertError) throw formUpsertError;

  const { data: forms, error: formFetchError } = await client
    .from("dictionary_forms")
    .select("id,dictionary_entry_id,unique_key")
    .eq("user_id", sentence.user_id)
    .in("unique_key", uniqueFormRows.map((form) => form.unique_key));
  if (formFetchError) throw formFetchError;
  const formsByKey = new Map((forms || []).map((form) => [form.unique_key, form]));

  const senseRows = termWithEntry
    .filter(({ term }) => Boolean(term.meaning))
    .map(({ term, entry }) => ({
      user_id: sentence.user_id,
      dictionary_entry_id: entry.id,
      meaning: term.meaning,
      meaning_type: "contextual",
      explanation: null,
      sense_order: 1,
      status: "ai_generated",
      updated_at: now,
    }));
  const uniqueSenseRows = Array.from(new Map(senseRows.map((sense) => [`${sense.dictionary_entry_id}:${sense.meaning}`, sense])).values());
  if (uniqueSenseRows.length > 0) {
    const { error: senseUpsertError } = await client
      .from("dictionary_senses")
      .upsert(uniqueSenseRows, { onConflict: "user_id,dictionary_entry_id,meaning", ignoreDuplicates: true });
    if (senseUpsertError) throw senseUpsertError;
  }

  const entryIds = Array.from(new Set(termWithEntry.map(({ entry }) => entry.id)));
  const meanings = Array.from(new Set(uniqueSenseRows.map((sense) => sense.meaning).filter(Boolean)));
  const sensesByKey = new Map<string, any>();
  if (entryIds.length > 0 && meanings.length > 0) {
    const { data: senses, error: senseFetchError } = await client
      .from("dictionary_senses")
      .select("id,dictionary_entry_id,meaning")
      .eq("user_id", sentence.user_id)
      .in("dictionary_entry_id", entryIds)
      .in("meaning", meanings);
    if (senseFetchError) throw senseFetchError;
    for (const sense of senses || []) sensesByKey.set(`${sense.dictionary_entry_id}:${sense.meaning}`, sense);
  }

  const sentenceTermRows = termWithEntry.flatMap(({ term, entry, formKey }) => {
    const form = formsByKey.get(formKey);
    if (!form) return [];
    const sense = term.meaning ? sensesByKey.get(`${entry.id}:${term.meaning}`) : null;
    return [{
      user_id: sentence.user_id,
      sentence_id: sentence.id,
      dictionary_form_id: form.id,
      dictionary_sense_id: sense?.id || null,
      surface: term.surface,
      start_index: term.startIndex,
      end_index: term.endIndex,
      confidence: term.confidence,
      status: "detected",
      updated_at: now,
    }];
  });

  if (sentenceTermRows.length > 0) {
    const { error: termUpsertError } = await client
      .from("sentence_terms")
      .upsert(sentenceTermRows, { onConflict: "sentence_id,start_index,end_index,dictionary_form_id", ignoreDuplicates: false });
    if (termUpsertError) throw termUpsertError;
  }

  const { error: sentenceUpdateError } = await client
    .from("sentences")
    .update({ terms_source: sentenceTermRows.length > 0 ? "ai" : "ai_empty", updated_at: now })
    .eq("id", sentence.id)
    .eq("user_id", sentence.user_id)
    .neq("status", "reviewed");
  if (sentenceUpdateError) throw sentenceUpdateError;

  return {
    termCount: sentenceTermRows.length,
    entryCount: entryRows.length,
    formCount: uniqueFormRows.length,
    senseCount: uniqueSenseRows.length,
  };
}

async function applyDictionaryEnrichment(client: SupabaseClient, entry: DictionaryEntryRow, result: any) {
  if (entry.status === "reviewed") return { entryId: entry.id, skipped: "reviewed" };

  const resultMeaning = result.main_meaning || result.meaning || (Array.isArray(result.meanings) ? result.meanings[0] : null);
  const mainMeaning = entry.main_meaning || resultMeaning;
  const finalType = entry.type || result.type || "outro";
  const finalKana = entry.kana || result.kana || null;
  const finalRomaji = entry.romaji || result.romaji || null;
  if (!mainMeaning || !finalType) throw new Error("Resultado invalido: significado ou tipo ausente.");
  if (!finalKana || !finalRomaji) throw new Error("Resultado invalido: kana ou romaji ausente.");

  const uniqueKey = dictionaryUniqueKey(entry.lemma, finalKana, finalType);
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await client
    .from("dictionary_entries")
    .select("id")
    .eq("user_id", entry.user_id)
    .eq("unique_key", uniqueKey)
    .maybeSingle();
  if (existingError) throw existingError;
  const targetEntryId = existing?.id || entry.id;

  const updatePayload = {
    main_meaning: mainMeaning,
    type: finalType,
    kana: finalKana,
    romaji: finalRomaji,
    jlpt_level: entry.jlpt_level || result.jlpt_level || null,
    tags: Array.isArray(entry.tags) && entry.tags.length > 0 ? entry.tags : (Array.isArray(result.tags) ? result.tags : entry.tags || []),
    subtype: entry.subtype || result.subtype || null,
    components: entry.components || result.components || null,
    grammar_info: entry.grammar_info || result.grammar_info || null,
    short_note: entry.short_note || result.short_note || null,
    status: "ai_enriched",
    unique_key: uniqueKey,
    updated_at: now,
  };

  const { error: updateError } = await client
    .from("dictionary_entries")
    .update(updatePayload)
    .eq("id", targetEntryId)
    .eq("user_id", entry.user_id)
    .neq("status", "reviewed");
  if (updateError) throw updateError;

  const meanings = (Array.isArray(result.meanings) && result.meanings.length > 0 ? result.meanings : [mainMeaning])
    .map((meaning: unknown) => String(meaning || "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (meanings.length > 0) {
    const senseRows = meanings.map((meaning: string, index: number) => ({
      user_id: entry.user_id,
      dictionary_entry_id: targetEntryId,
      meaning,
      meaning_type: index === 0 ? "principal" : "variacao",
      explanation: null,
      sense_order: index + 1,
      status: "ai_generated",
      updated_at: now,
    }));
    const { error: senseError } = await client
      .from("dictionary_senses")
      .upsert(senseRows, { onConflict: "user_id,dictionary_entry_id,meaning", ignoreDuplicates: false });
    if (senseError) throw senseError;
  }

  const formKey = formUniqueKey(targetEntryId, entry.lemma, "forma de dicionario");
  const { error: formError } = await client
    .from("dictionary_forms")
    .upsert([{
      user_id: entry.user_id,
      dictionary_entry_id: targetEntryId,
      form: entry.lemma,
      kana: finalKana,
      romaji: finalRomaji,
      form_type: "forma de dicionario",
      grammar_note: null,
      is_common: true,
      status: "ai_resolved",
      unique_key: formKey,
      updated_at: now,
    }], { onConflict: "user_id,unique_key", ignoreDuplicates: false });
  if (formError) throw formError;

  return { entryId: targetEntryId, senseCount: meanings.length, mergedIntoExisting: targetEntryId !== entry.id };
}

export async function processTranslateSentenceJob(
  client: SupabaseClient,
  job: QueueJob,
  workerId: string,
  leaseSeconds: number,
  getAi: () => GoogleGenAI,
) {
  const runningJob = await startJob(client, job, workerId, leaseSeconds);
  const input = getJobInput(runningJob);
  const sentence = await fetchSentence(client, runningJob);
  if (!sentence) throw new Error("Frase nao encontrada para traducao.");

  if (typeof input.sentence === "string" && input.sentence.trim() && input.sentence !== sentence.japanese) {
    await markObsolete(client, runningJob, "A frase mudou depois da criacao do job.");
    return;
  }
  if (await markObsoleteIfHashChanged(client, runningJob, {
    id: sentence.id,
    sentence: sentence.japanese,
    japanese: sentence.japanese,
    sourceId: sentence.source_id,
  })) return;

  if (sentence.status === "reviewed" || hasValidTranslation(sentence)) {
    await completeJob(
      client,
      runningJob.id,
      workerId,
      { optimization: "already_translated", sentence_id: sentence.id },
      null,
      {},
    );
    return;
  }

  const request = buildSingleAiRequest("translate_sentence", { sentence: sentence.japanese });
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
      sentence_id: sentence.id,
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
      costActual: estimateCostActual(
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
  const runningJob = await startJob(client, job, workerId, leaseSeconds);
  const input = getJobInput(runningJob);
  const sentence = await fetchSentence(client, runningJob);
  if (!sentence) throw new Error("Frase nao encontrada para leitura.");

  if (typeof input.sentence === "string" && input.sentence.trim() && input.sentence !== sentence.japanese) {
    await markObsolete(client, runningJob, "A frase mudou depois da criacao do job.");
    return;
  }
  if (await markObsoleteIfHashChanged(client, runningJob, {
    id: sentence.id,
    sentence: sentence.japanese,
    japanese: sentence.japanese,
    portuguese: sentence.portuguese,
    sourceId: sentence.source_id,
  })) return;

  if (sentence.status === "reviewed" || hasValidReading(sentence)) {
    await completeJob(
      client,
      runningJob.id,
      workerId,
      { optimization: "already_has_reading", sentence_id: sentence.id },
      null,
      {},
    );
    return;
  }

  const request = buildSingleAiRequest("generate_sentence_reading", {
    sentence: sentence.japanese,
    portuguese: sentence.portuguese,
    known_words: input.known_words,
  });
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
      sentence_id: sentence.id,
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
      costActual: estimateCostActual(
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
  const runningJob = await startJob(client, job, workerId, leaseSeconds);
  const input = getJobInput(runningJob);
  const sentence = await fetchSentence(client, runningJob);
  if (!sentence) throw new Error("Frase nao encontrada para deteccao de termos.");

  if (sentence.status === "reviewed") {
    await completeJob(
      client,
      runningJob.id,
      workerId,
      { optimization: "already_reviewed", sentence_id: sentence.id },
      null,
      {},
    );
    return;
  }

  if (typeof input.sentence === "string" && input.sentence.trim() && input.sentence !== sentence.japanese) {
    await markObsolete(client, runningJob, "A frase mudou depois da criacao do job.");
    return;
  }
  if (await markObsoleteIfHashChanged(client, runningJob, {
    id: sentence.id,
    sentence: sentence.japanese,
    japanese: sentence.japanese,
    portuguese: sentence.portuguese,
    kana: sentence.kana,
    romaji: sentence.romaji,
    sourceId: sentence.source_id,
  })) return;

  const request = buildSingleAiRequest("detect_sentence_terms", {
    sentence: sentence.japanese,
    portuguese: sentence.portuguese,
    kana: sentence.kana,
    romaji: sentence.romaji,
    known_words: input.known_words,
  });
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

  await assertJobStillRunning(client, runningJob.id, workerId);
  const persisted = await applySentenceTerms(client, sentence, data);
  await completeJob(
    client,
    runningJob.id,
    workerId,
    {
      ...persisted,
      sentence_id: sentence.id,
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
      costActual: estimateCostActual(
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
  const runningJob = await startJob(client, job, workerId, leaseSeconds);
  const input = getJobInput(runningJob);
  const entry = await fetchDictionaryEntry(client, runningJob);
  if (!entry) throw new Error("Verbete nao encontrado para enriquecimento.");

  if (typeof input.lemma === "string" && input.lemma.trim() && input.lemma !== entry.lemma) {
    await markObsolete(client, runningJob, "O lemma mudou depois da criacao do job.");
    return;
  }
  if (await markObsoleteIfHashChanged(client, runningJob, {
    id: entry.id,
    entryId: entry.id,
    lemma: entry.lemma,
    sourceId: input.sourceId || null,
  })) return;

  if (entry.status === "reviewed" || (entry.status === "ai_enriched" && entry.main_meaning && entry.kana && entry.romaji && entry.type)) {
    await completeJob(
      client,
      runningJob.id,
      workerId,
      { optimization: "already_enriched", entry_id: entry.id },
      null,
      {},
    );
    return;
  }

  const request = buildSingleAiRequest("enrich_dictionary_entry", {
    lemma: entry.lemma,
    examples: Array.isArray(input.examples) ? input.examples : [],
  });
  const { data, meta } = await generateStructuredJsonWithMeta<any>({
    ai: getAi(),
    prompt: request.prompt,
    responseSchema: request.responseSchema,
    model: request.model,
    temperature: request.temperature,
  });

  await assertJobStillRunning(client, runningJob.id, workerId);
  const persisted = await applyDictionaryEnrichment(client, entry, data);
  await completeJob(
    client,
    runningJob.id,
    workerId,
    {
      ...persisted,
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
      costActual: estimateCostActual(
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
