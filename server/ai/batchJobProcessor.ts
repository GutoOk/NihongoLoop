import { GoogleGenAI } from "@google/genai";
import { buildBatchAiRequest } from "./prompts";
import { generateStructuredJsonWithMeta } from "../geminiJson";

export function generateDictionaryUniqueKey(lemma: string, kana: string | null, type: string): string {
  return `${String(lemma || "").trim().replace(/\s+/g, "").toLowerCase()}|${String(kana || "").trim().replace(/\s+/g, "").toLowerCase()}|${String(type || "outro").trim().toLowerCase()}`;
}

function generateFormUniqueKey(entryId: string, form: string, formType?: string | null): string {
  return `${entryId}|${String(form || "").trim().replace(/\s+/g, "").toLowerCase()}|${String(formType || "default").trim().toLowerCase()}`;
}

export async function processBatchJobsForTarget(
  supabaseClient: any,
  userId: string,
  targetId: string,
  getAi: () => GoogleGenAI,
  concurrencyLimit: number = 3,
) {
  const { data: jobs, error: fetchErr } = await supabaseClient
    .from("ai_jobs")
    .select("*")
    .eq("target_id", targetId)
    .eq("user_id", userId)
    .in("status", ["pending", "running"]);

  if (fetchErr) throw fetchErr;

  const batchTypes = [
    "batch_translate_sentences",
    "batch_analyze_sentences",
    "batch_enrich_dictionary_entries_fast",
    "batch_enrich_dictionary_entries_full",
  ];
  const eligibleJobs = (jobs || []).filter((job: any) => {
    if (!batchTypes.includes(job.type)) return false;
    if (job.status !== "running") return true;
    return !job.locked_until || Date.now() > new Date(job.locked_until).getTime();
  });

  let processedCount = 0;
  const pool: Promise<void>[] = [];

  for (const job of eligibleJobs) {
    while (pool.length >= concurrencyLimit) {
      await Promise.race(pool);
    }

    const task = processOneBatchJob(supabaseClient, userId, job, getAi)
      .then(() => {
        processedCount++;
      })
      .finally(() => {
        const idx = pool.indexOf(task);
        if (idx >= 0) pool.splice(idx, 1);
      });
    pool.push(task);
  }

  await Promise.all(pool);
  return { success: true, processedCount };
}

async function processOneBatchJob(supabaseClient: any, userId: string, job: any, getAi: () => GoogleGenAI) {
  const lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const attempts = (job.attempts || 0) + 1;
  const { data: lockedJob, error: lockErr } = await supabaseClient
    .from("ai_jobs")
    .update({
      status: "running",
      locked_by: "server_batch_processor",
      locked_until: lockedUntil,
      attempts,
      started_at: job.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select()
    .maybeSingle();

  if (lockErr || !lockedJob) return;

  try {
    const input = typeof job.input === "string" ? JSON.parse(job.input) : job.input || {};
    const itemsToProcess = normalizeBatchInput(job.type, input.items || []);
    if (itemsToProcess.length === 0) {
      await completeJob(supabaseClient, job.id, { optimization: "empty_batch" });
      return;
    }

    const request = buildBatchAiRequest(job.type, itemsToProcess);
    const { data, meta } = await generateStructuredJsonWithMeta<{ results?: any[] }>({
      ai: getAi(),
      prompt: request.prompt,
      responseSchema: request.responseSchema,
      model: request.model,
      temperature: request.temperature,
    });

    const results = data.results || [];
    await applyBatchResults(supabaseClient, userId, job, results);
    await completeJob(supabaseClient, job.id, {
      results,
      ai_meta: {
        job_type: job.type,
        prompt_version: request.promptVersion,
        model: meta.model,
        temperature: meta.temperature,
        latency_ms: meta.latency_ms,
        input_chars: meta.input_chars,
        output_chars: meta.output_chars,
        usage_metadata: meta.usage_metadata,
      },
    });
  } catch (error: any) {
    await supabaseClient
      .from("ai_jobs")
      .update({ status: "error", error: error.message || String(error), updated_at: new Date().toISOString() })
      .eq("id", job.id);
  }
}

function normalizeBatchInput(jobType: string, items: any[]) {
  if (jobType === "batch_translate_sentences") {
    return items.map((item) => ({ id: item.job_id || item.id, japanese: item.sentence || item.japanese || "" }));
  }
  if (jobType === "batch_analyze_sentences") {
    return items.map((item) => ({
      id: item.job_id || item.id,
      japanese: item.sentence || item.japanese || "",
      portuguese: item.portuguese || null,
      known_words: Array.isArray(item.known_words) ? item.known_words.slice(0, 12) : [],
    }));
  }
  return items.map((item) => ({
    id: item.job_id || item.id,
    lemma: item.lemma,
    examples: Array.isArray(item.examples) ? item.examples.slice(0, 2) : [],
  }));
}

async function completeJob(supabaseClient: any, jobId: string, result: any) {
  await supabaseClient
    .from("ai_jobs")
    .update({
      status: "completed",
      result,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", jobId);
}

async function applyBatchResults(supabaseClient: any, userId: string, job: any, results: any[]) {
  if (job.type === "batch_translate_sentences") {
    for (const item of results) {
      const sentenceId = item.job_id || item.id;
      if (!sentenceId || !item.translation) continue;
      const { data: sentence } = await supabaseClient.from("sentences").select("*").eq("id", sentenceId).eq("user_id", userId).maybeSingle();
      if (!sentence || sentence.status === "reviewed") continue;
      await supabaseClient
        .from("sentences")
        .update({
          portuguese: item.translation,
          status: sentence.kana && sentence.romaji ? "reading_ready" : "translated",
          translation_source: "ai_batch",
          updated_at: new Date().toISOString(),
        })
        .eq("id", sentenceId)
        .eq("user_id", userId);
    }
    return;
  }

  if (job.type === "batch_analyze_sentences") {
    for (const item of results) {
      await applySentenceAnalysis(supabaseClient, userId, item);
    }
    return;
  }

  if (job.type.startsWith("batch_enrich_dictionary_entries")) {
    for (const item of results) {
      await applyDictionaryEnrichment(supabaseClient, userId, item.job_id || item.id, item);
    }
  }
}

async function applySentenceAnalysis(supabaseClient: any, userId: string, item: any) {
  const sentenceId = item.job_id || item.id;
  const { data: sentence } = await supabaseClient.from("sentences").select("*").eq("id", sentenceId).eq("user_id", userId).maybeSingle();
  if (!sentence || sentence.status === "reviewed") return;

  if (item.kana && item.romaji) {
    await supabaseClient
      .from("sentences")
      .update({
        kana: item.kana,
        romaji: String(item.romaji).toLowerCase(),
        status: sentence.portuguese ? "reading_ready" : sentence.status,
        reading_source: "ai",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sentence.id)
      .eq("user_id", userId);
  }

  const termsToInsert: any[] = [];
  for (const rawTerm of Array.isArray(item.terms) ? item.terms : []) {
    const surface = String(rawTerm.surface || "").trim();
    const lemma = String(rawTerm.lemma || surface).trim();
    if (!surface || !lemma) continue;
    let startIndex = Number(rawTerm.start_index);
    let endIndex = Number(rawTerm.end_index);
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || sentence.japanese.substring(startIndex, endIndex) !== surface) {
      startIndex = sentence.japanese.indexOf(surface);
      endIndex = startIndex >= 0 ? startIndex + surface.length : -1;
    }
    if (startIndex < 0 || endIndex <= startIndex) continue;

    const entry = await resolveEntry(supabaseClient, userId, {
      lemma,
      kana: rawTerm.entry_kana || rawTerm.kana || null,
      romaji: rawTerm.entry_romaji || rawTerm.romaji || null,
      type: rawTerm.type || "outro",
      main_meaning: rawTerm.meaning || rawTerm.context_meaning || null,
    });
    const form = await resolveForm(supabaseClient, userId, entry, {
      form: surface,
      kana: rawTerm.form_kana || rawTerm.kana || null,
      romaji: rawTerm.form_romaji || rawTerm.romaji || null,
      form_type: rawTerm.form_type || (surface === lemma ? "forma de dicionário" : "forma encontrada"),
      grammar_note: rawTerm.grammar_note || null,
      is_common: surface === lemma,
    });
    const sense = rawTerm.meaning || rawTerm.context_meaning || entry.main_meaning
      ? await resolveSense(supabaseClient, userId, entry.id, rawTerm.meaning || rawTerm.context_meaning || entry.main_meaning)
      : null;

    termsToInsert.push({
      user_id: userId,
      sentence_id: sentence.id,
      dictionary_form_id: form.id,
      dictionary_sense_id: sense?.id || null,
      surface,
      start_index: startIndex,
      end_index: endIndex,
      confidence: rawTerm.confidence || 1,
      status: "detected",
    });
  }

  await supabaseClient.from("sentence_terms").delete().eq("sentence_id", sentence.id).eq("user_id", userId);
  if (termsToInsert.length > 0) {
    await supabaseClient.from("sentence_terms").upsert(termsToInsert, { onConflict: "sentence_id,start_index,end_index,dictionary_form_id" });
    await supabaseClient.from("sentences").update({ terms_source: "ai", updated_at: new Date().toISOString() }).eq("id", sentence.id).eq("user_id", userId);
  } else {
    await supabaseClient.from("sentences").update({ terms_source: "ai_empty", updated_at: new Date().toISOString() }).eq("id", sentence.id).eq("user_id", userId);
  }
}

async function applyDictionaryEnrichment(supabaseClient: any, userId: string, entryId: string, item: any) {
  if (!entryId) return;
  const { data: entry } = await supabaseClient.from("dictionary_entries").select("*").eq("id", entryId).eq("user_id", userId).maybeSingle();
  if (!entry || entry.status === "reviewed") return;
  const mainMeaning = item.main_meaning || item.meaning || (Array.isArray(item.meanings) ? item.meanings[0] : null);
  if (!mainMeaning) return;
  const finalType = item.type || entry.type || "outro";
  const finalKana = item.kana || entry.kana || null;
  await supabaseClient
    .from("dictionary_entries")
    .update({
      main_meaning: mainMeaning,
      type: finalType,
      kana: finalKana,
      romaji: item.romaji || entry.romaji || null,
      jlpt_level: item.jlpt_level || entry.jlpt_level || null,
      tags: Array.isArray(item.tags) ? item.tags : entry.tags,
      subtype: item.subtype || entry.subtype || null,
      components: item.components || entry.components || null,
      grammar_info: item.grammar_info || entry.grammar_info || null,
      short_note: item.short_note || entry.short_note || null,
      status: "ai_enriched",
      unique_key: generateDictionaryUniqueKey(entry.lemma, finalKana, finalType),
      updated_at: new Date().toISOString(),
    })
    .eq("id", entry.id)
    .eq("user_id", userId);

  const meanings = Array.isArray(item.meanings) && item.meanings.length > 0 ? item.meanings : [mainMeaning];
  for (let index = 0; index < meanings.length; index++) {
    await resolveSense(supabaseClient, userId, entry.id, meanings[index], index + 1);
  }
  await resolveForm(supabaseClient, userId, entry, {
    form: entry.lemma,
    kana: finalKana,
    romaji: item.romaji || entry.romaji || null,
    form_type: "forma de dicionário",
    is_common: true,
  });
}

async function resolveEntry(supabaseClient: any, userId: string, input: any) {
  const uniqueKey = generateDictionaryUniqueKey(input.lemma, input.kana, input.type);
  const { data: existing } = await supabaseClient
    .from("dictionary_entries")
    .select("*")
    .eq("user_id", userId)
    .eq("unique_key", uniqueKey)
    .maybeSingle();
  if (existing) return existing;
  const { data: inserted, error } = await supabaseClient
    .from("dictionary_entries")
    .insert({
      user_id: userId,
      lemma: input.lemma,
      kana: input.kana,
      romaji: input.romaji,
      type: input.type,
      main_meaning: input.main_meaning,
      status: "pending",
      tags: [],
      unique_key: uniqueKey,
    })
    .select()
    .maybeSingle();
  if (error) throw error;
  return inserted;
}

async function resolveForm(supabaseClient: any, userId: string, entry: any, input: any) {
  const uniqueKey = generateFormUniqueKey(entry.id, input.form, input.form_type);
  const { data: existing } = await supabaseClient
    .from("dictionary_forms")
    .select("*")
    .eq("user_id", userId)
    .eq("unique_key", uniqueKey)
    .maybeSingle();
  if (existing) return existing;
  const { data: inserted, error } = await supabaseClient
    .from("dictionary_forms")
    .insert({
      user_id: userId,
      dictionary_entry_id: entry.id,
      form: input.form,
      kana: input.kana,
      romaji: input.romaji,
      form_type: input.form_type,
      grammar_note: input.grammar_note || null,
      is_common: input.is_common || false,
      status: "detected",
      unique_key: uniqueKey,
    })
    .select()
    .maybeSingle();
  if (error) throw error;
  return inserted;
}

async function resolveSense(supabaseClient: any, userId: string, entryId: string, meaning: string, order = 1) {
  const { data: existing } = await supabaseClient
    .from("dictionary_senses")
    .select("*")
    .eq("user_id", userId)
    .eq("dictionary_entry_id", entryId)
    .eq("meaning", meaning)
    .maybeSingle();
  if (existing) return existing;
  const { data: inserted, error } = await supabaseClient
    .from("dictionary_senses")
    .insert({
      user_id: userId,
      dictionary_entry_id: entryId,
      meaning,
      meaning_type: order === 1 ? "principal" : "variação",
      sense_order: order,
      status: "ai_generated",
    })
    .select()
    .maybeSingle();
  if (error) throw error;
  return inserted;
}
