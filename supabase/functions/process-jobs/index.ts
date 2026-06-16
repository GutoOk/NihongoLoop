// Supabase Edge Function to process pending AI batch jobs
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.10.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_DICT_TYPES = ["substantivo", "verbo", "adjetivo", "adverbio", "particula", "expressao", "outro"];

function generateDictionaryUniqueKey(lemma: string, kana: string | null, type: string): string {
  const cleanLemma = (lemma || "").trim();
  const cleanKana = (kana || "").trim();
  const cleanType = (type || "").trim().toLowerCase();
  return `${cleanLemma}_${cleanKana}_${cleanType}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase configuration missing on edge function server.");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabaseClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    const { targetId } = await req.json();
    if (!targetId) {
      return new Response(JSON.stringify({ error: "Missing targetId in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Edge Function] Starting processing for targetId: ${targetId}, user: ${userId}`);

    // Fetch pending or stale running jobs
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

    const eligibleJobs = (jobs || []).filter((j: any) => {
      if (!batchTypes.includes(j.type)) return false;
      if (j.status === "running") {
        if (!j.locked_until) return true;
        return Date.now() > new Date(j.locked_until).getTime();
      }
      return true;
    });

    let processedCount = 0;

    for (const job of eligibleJobs) {
      const lockUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const attemptsCount = (job.attempts || job.retry_count || 0) + 1;

      // Lock job
      const { data: lockedJob, error: lockErr } = await supabaseClient
        .from("ai_jobs")
        .update({
          status: "running",
          locked_by: "edge_function_processor",
          locked_until: lockUntil,
          attempts: attemptsCount,
          retry_count: attemptsCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .select()
        .maybeSingle();

      if (lockErr || !lockedJob) {
        console.warn(`[Edge] Could not lock job ${job.id}`);
        continue;
      }

      try {
        const input = typeof job.input === "string" ? JSON.parse(job.input) : job.input;
        const items = input.items || [];

        // Build mock/dynamic prompts depending on types
        if (items.length === 0) {
          await supabaseClient
            .from("ai_jobs")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", job.id);
          processedCount++;
          continue;
        }

        let model = "gemini-2.5-flash";
        let prompt = "";
        let responseSchema: any = {};

        if (job.type === "batch_translate_sentences") {
          responseSchema = {
            type: "OBJECT",
            properties: {
              results: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    job_id: { type: "STRING" },
                    translation: { type: "STRING" },
                  },
                  required: ["job_id", "translation"],
                },
              },
            },
            required: ["results"],
          };
          prompt = `Tarefa: traduzir cada frase japonesa do lote para português do Brasil.\n\nLote:\n${JSON.stringify(items)}`;
        } else if (job.type === "batch_analyze_sentences") {
          responseSchema = {
            type: "OBJECT",
            properties: {
              results: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    job_id: { type: "STRING" },
                    kana: { type: "STRING" },
                    romaji: { type: "STRING" },
                    terms: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          surface: { type: "STRING" },
                          lemma: { type: "STRING" },
                          kana: { type: "STRING" },
                          romaji: { type: "STRING" },
                          type: { type: "STRING" },
                          start_index: { type: "INTEGER" },
                          end_index: { type: "INTEGER" },
                          context_meaning: { type: "STRING" },
                          grammar_note: { type: "STRING" },
                        },
                        required: ["surface", "lemma", "start_index", "end_index"],
                      },
                    },
                  },
                  required: ["job_id", "kana", "romaji", "terms"],
                },
              },
            },
            required: ["results"],
          };
          prompt = `Tarefa: segmentar frases japonesas e extrair leituras de termos.\n\nLote:\n${JSON.stringify(items)}`;
        } else {
          // batch dictionary enrichment
          responseSchema = {
            type: "OBJECT",
            properties: {
              results: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    job_id: { type: "STRING" },
                    main_meaning: { type: "STRING" },
                    meanings: { type: "ARRAY", items: { type: "STRING" } },
                    type: { type: "STRING" },
                    kana: { type: "STRING" },
                    romaji: { type: "STRING" },
                    tags: { type: "ARRAY", items: { type: "STRING" } },
                    jlpt_level: { type: "STRING" },
                  },
                  required: ["job_id", "main_meaning", "meanings", "type", "kana", "romaji"],
                },
              },
            },
            required: ["results"],
          };
          prompt = `Tarefa: enriquecer verbetes japoneses de dicionário.\n\nLote:\n${JSON.stringify(items)}`;
        }

        // Call Gemini (via direct REST fetch)
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema,
              temperature: 0.1,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Gemini API returned status ${response.status}`);
        }

        const resJson = await response.json();
        const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        const parsed = JSON.parse(text);
        const rawResults = parsed.results || [];

        // Apply
        if (job.type === "batch_translate_sentences") {
          for (const item of rawResults) {
            const sentenceId = item.job_id || item.id;
            await supabaseClient
              .from("sentences")
              .update({ portuguese: item.translation, status: "reading_ready" })
              .eq("id", sentenceId);
          }
        } else if (job.type === "batch_analyze_sentences") {
          for (const item of rawResults) {
            const sentenceId = item.job_id || item.id;
            await supabaseClient
              .from("sentences")
              .update({ kana: item.kana, romaji: item.romaji, status: "reading_ready" })
              .eq("id", sentenceId);
          }
        } else {
          for (const item of rawResults) {
            const entryId = item.job_id || item.id;
            const validType = VALID_DICT_TYPES.includes(item.type) ? item.type : "outro";
            await supabaseClient
              .from("dictionary_entries")
              .update({
                main_meaning: item.main_meaning,
                type: validType,
                kana: item.kana,
                romaji: item.romaji,
                tags: Array.isArray(item.tags) ? item.tags : [],
                jlpt_level: item.jlpt_level || null,
                status: item.main_meaning && validType && item.kana && item.romaji ? "ai_enriched" : "pending",
              })
              .eq("id", entryId);
          }
        }

        // Save result
        await supabaseClient
          .from("ai_jobs")
          .update({
            status: "completed",
            result: { results: rawResults },
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        processedCount++;
      } catch (jobErr: any) {
        console.error(`Error in inner job ${job.id}:`, jobErr);
        await supabaseClient
          .from("ai_jobs")
          .update({ status: "error", error: jobErr.message || String(jobErr) })
          .eq("id", job.id);
      }
    }

    return new Response(JSON.stringify({ success: true, processedCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
