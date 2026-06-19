import { GoogleGenAI } from "@google/genai";
import { cleanAndParseJSON, withAbortableTimeout } from "./aiUtils";

interface GenerateStructuredJsonOptions {
  ai: GoogleGenAI;
  prompt: string;
  responseSchema: unknown;
  model?: string;
  temperature?: number;
}

export interface GenerateStructuredJsonMeta {
  model: string;
  temperature: number;
  latency_ms: number;
  input_chars: number;
  output_chars: number;
  usage_metadata?: unknown;
}

export async function generateStructuredJsonWithMeta<T = any>({
  ai,
  prompt,
  responseSchema,
  model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
  temperature = 0.2,
}: GenerateStructuredJsonOptions): Promise<{ data: T; meta: GenerateStructuredJsonMeta }> {
  const startedAt = Date.now();
  const response = await withAbortableTimeout((abortSignal) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema,
        temperature,
        abortSignal,
      },
    }),
  );

  const text = response.text || "{}";
  return {
    data: cleanAndParseJSON<T>(text),
    meta: {
      model,
      temperature,
      latency_ms: Date.now() - startedAt,
      input_chars: prompt.length,
      output_chars: text.length,
      usage_metadata: (response as { usageMetadata?: unknown }).usageMetadata,
    },
  };
}

export async function generateStructuredJson<T = any>(options: GenerateStructuredJsonOptions): Promise<T> {
  const { data } = await generateStructuredJsonWithMeta<T>(options);
  return data;
}
