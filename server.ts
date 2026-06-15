import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { formatGenAiError } from "./server/aiUtils";
import { generateStructuredJsonWithMeta, GenerateStructuredJsonMeta } from "./server/geminiJson";
import { buildBatchAiRequest, buildSingleAiRequest } from "./server/ai/prompts";

let aiClient: GoogleGenAI | null = null;

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const supabaseAuthClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const requestCounts = new Map<string, { count: number; resetAt: number }>();

function ipRateLimit(req: any, res: any, next: any) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = (typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim() : null) || req.ip || "unknown";
  const now = Date.now();
  const windowMs = 60000;
  const maxLimit = 60;

  const key = String(ip);
  const clientData = requestCounts.get(key);

  if (!clientData || now > clientData.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }

  clientData.count++;
  if (clientData.count > maxLimit) {
    res.status(429).json({ error: "Muitas requisições. Por favor, aguarde 1 minuto." });
    return;
  }

  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now > data.resetAt) {
      requestCounts.delete(key);
    }
  }
}, 5 * 60 * 1000);

const allowAuthBypass =
  (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development" || !process.env.NODE_ENV) &&
  (process.env.ALLOW_AUTH_BYPASS === "true" || process.env.VITE_E2E_AUTH_BYPASS === "true");

async function authenticateRequest(req: any, res: any, next: any) {
  if (!isSupabaseConfigured || !supabaseAuthClient) {
    if (allowAuthBypass) {
      req.user = { id: "test-user-id" };
      next();
      return;
    }
    res.status(500).json({
      error: "Servidor sem Supabase configurado. Autenticação bloqueada por segurança.",
    });
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      if (allowAuthBypass) {
        req.user = { id: "test-user-id" };
        next();
        return;
      }
      res.status(401).json({ error: "Não autorizado: token de autenticação ausente." });
      return;
    }

    const token = authHeader.split(" ")[1];
    const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token);

    if (error || !user) {
      if (allowAuthBypass) {
        req.user = { id: "test-user-id" };
        next();
        return;
      }
      res.status(401).json({ error: "Não autorizado: token de autenticação inválido ou expirado." });
      return;
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: isAdmin, error: adminError } = await userSupabase.rpc("is_app_admin");

    if (adminError || !isAdmin) {
      if (allowAuthBypass) {
        req.user = user;
        req.supabase = userSupabase;
        next();
        return;
      }
      res.status(403).json({ error: "Não autorizado: usuário não é administrador do sistema." });
      return;
    }

    req.user = user;
    req.supabase = userSupabase;
    next();
  } catch (err: any) {
    res.status(500).json({ error: `Erro na autenticação: ${err.message}` });
  }
}

function getAi() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

function parseMaybeJson(value: any) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getJobInput(job: any) {
  const input = parseMaybeJson(job.input);
  if (input && typeof input === "object") return input;

  const result = parseMaybeJson(job.result);
  if (result && typeof result === "object") return result;

  return {};
}

function isNestedBatchType(jobType: string) {
  return [
    "batch_translate_sentences",
    "batch_analyze_sentences",
    "batch_enrich_dictionary_entries_fast",
    "batch_enrich_dictionary_entries_full",
  ].includes(jobType);
}

function buildAiMeta(meta: GenerateStructuredJsonMeta, jobType: string, promptVersion: string) {
  return {
    job_type: jobType,
    prompt_version: promptVersion,
    model: meta.model,
    temperature: meta.temperature,
    latency_ms: meta.latency_ms,
    input_chars: meta.input_chars,
    output_chars: meta.output_chars,
    usage_metadata: meta.usage_metadata,
  };
}

function attachAiMeta<T>(data: T, meta: ReturnType<typeof buildAiMeta>): any {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>), ai_meta: meta };
  }
  return { value: data, ai_meta: meta };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/ai/process-job", ipRateLimit, authenticateRequest, async (req: any, res: any) => {
    try {
      const { job } = req.body;
      if (!job || !job.type) {
        throw new Error("Job inválido");
      }

      if (job.user_id !== req.user.id) {
        res.status(403).json({ error: "Negado: tentativa de processar job de outro usuário." });
        return;
      }

      console.log(`Processing job ${job.id} of type ${job.type}`);

      const request = buildSingleAiRequest(job.type, getJobInput(job));
      const { data, meta } = await generateStructuredJsonWithMeta({
        ai: getAi(),
        prompt: request.prompt,
        responseSchema: request.responseSchema,
        model: request.model,
        temperature: request.temperature,
      });

      res.json({
        result: attachAiMeta(data, buildAiMeta(meta, job.type, request.promptVersion)),
      });
    } catch (e: any) {
      console.error("[process-job]", e);
      res.status(500).json({ error: formatGenAiError(e) });
    }
  });

  app.post("/api/ai/process-jobs-batch", ipRateLimit, authenticateRequest, async (req: any, res: any) => {
    try {
      const { jobs } = req.body;
      if (!Array.isArray(jobs) || jobs.length === 0) {
        throw new Error("Lote de jobs inválido");
      }

      for (const job of jobs) {
        if (job.user_id !== req.user.id) {
          res.status(403).json({ error: "Negado: tentativa de processar job pertencente a outro usuário." });
          return;
        }
      }

      const firstJob = jobs[0];
      const jobType = firstJob.type;
      if (!jobs.every((job: any) => job.type === jobType)) {
        res.status(400).json({ error: "Todos os jobs do lote precisam ser do mesmo tipo." });
        return;
      }

      console.log(`Processing batch of ${jobs.length} jobs of type ${jobType}`);

      const isNestedBatch = isNestedBatchType(jobType);
      const itemsToProcess = isNestedBatch
        ? (getJobInput(firstJob).items || [])
        : jobs.map((job: any) => ({ id: job.id, ...getJobInput(job) }));

      if (!Array.isArray(itemsToProcess) || itemsToProcess.length === 0) {
        res.json({ results: [] });
        return;
      }

      const request = buildBatchAiRequest(jobType, itemsToProcess);
      const { data, meta } = await generateStructuredJsonWithMeta<{ results?: any[] }>({
        ai: getAi(),
        prompt: request.prompt,
        responseSchema: request.responseSchema,
        model: request.model,
        temperature: request.temperature,
      });

      const aiMeta = buildAiMeta(meta, jobType, request.promptVersion);
      const rawResults = data.results || [];

      if (isNestedBatch) {
        res.json({
          results: [{
            job_id: firstJob.id,
            type: jobType,
            items: rawResults,
            ai_meta: aiMeta,
          }],
        });
        return;
      }

      res.json({
        results: rawResults.map((item) => attachAiMeta(item, aiMeta)),
      });
    } catch (e: any) {
      console.error("[process-jobs-batch]", e);
      res.status(500).json({ error: formatGenAiError(e) });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        res.sendFile(path.join(distPath, "index.html"));
      } else {
        next();
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
