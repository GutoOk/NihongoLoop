import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { getAiQueueHealth, startAiQueueWorker, validateAiWorkerStartup } from "./server/ai/queueWorker";

let aiClient: GoogleGenAI | null = null;

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const isWorkerOnly = process.env.AI_WORKER_ONLY === "true";

function getAi() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.includes("PLACEHOLDER")) {
      throw new Error("GEMINI_API_KEY ausente ou invalida.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "nihongo-loop-worker",
        },
      },
    });
  }
  return aiClient;
}

function makeServiceClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey || supabaseServiceRoleKey.includes("PLACEHOLDER")) return null;
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      service: isWorkerOnly ? "nihongo-loop-worker" : "nihongo-loop-web",
      version: process.env.APP_VERSION || "dev",
      servedAt: new Date().toISOString(),
    });
  });

  app.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.json({
      version: process.env.APP_VERSION || "dev",
      commit: process.env.APP_VERSION || "dev",
      nodeEnv: process.env.NODE_ENV || "development",
      service: isWorkerOnly ? "worker" : "web",
      servedAt: new Date().toISOString(),
    });
  });

  app.get("/api/queue-health", async (req, res) => {
    const token = req.headers["x-internal-health-token"];
    const expectedToken = process.env.INTERNAL_HEALTH_TOKEN;
    if (isWorkerOnly && (!expectedToken || expectedToken.includes("PLACEHOLDER"))) {
      res.status(503).json({ error: "INTERNAL_HEALTH_TOKEN ausente no worker." });
      return;
    }
    if (expectedToken && token !== expectedToken) {
      res.status(403).json({ error: "Healthcheck interno nao autorizado." });
      return;
    }

    const client = makeServiceClient();
    if (!client) {
      res.status(503).json({
        service: isWorkerOnly ? "worker" : "web",
        workerEnabled: isWorkerOnly,
        supabase: "not_configured",
        schema: "unknown",
      });
      return;
    }

    try {
      const health = await getAiQueueHealth(client);
      res.json({
        service: isWorkerOnly ? "worker" : "web",
        workerEnabled: isWorkerOnly,
        version: process.env.APP_VERSION || "dev",
        ...health,
      });
    } catch (error: any) {
      res.status(503).json({
        service: isWorkerOnly ? "worker" : "web",
        workerEnabled: isWorkerOnly,
        version: process.env.APP_VERSION || "dev",
        supabase: "error",
        error: error.message || String(error),
      });
    }
  });

  if (!isWorkerOnly) {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            return;
          }
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }));
      app.use((req, res, next) => {
        if (req.method === "GET" && !req.path.startsWith("/api")) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          res.sendFile(path.join(distPath, "index.html"));
        } else {
          next();
        }
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`${isWorkerOnly ? "Worker" : "Web"} service running on http://localhost:${PORT}`);
  });

  if (isWorkerOnly) {
    const validation = await validateAiWorkerStartup({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      requireGemini: true,
      requireHealthToken: true,
    });
    if (!validation.ok) {
      throw new Error(`AI worker startup validation failed: ${validation.errors.join("; ")}`);
    }
    startAiQueueWorker({
      enabled: true,
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      getAi,
    });
  }
}

startServer().catch((error) => {
  console.error("[server] fatal startup error", error);
  process.exit(1);
});
