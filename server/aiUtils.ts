export function withTimeout<T>(
  promise: Promise<T>,
  ms: number = 120000,
  errorMsg: string = "Tempo limite de 120s excedido na chamada do Gemini (Timeout).",
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(errorMsg)), ms),
  );
  return Promise.race([promise, timeoutPromise]);
}

export function cleanAndParseJSON<T = any>(text: string): T {
  if (!text) return {} as T;
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  return JSON.parse(cleaned);
}

export function formatGenAiError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("spending cap") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("exceeded its monthly spending cap")) {
    return "Limite de faturamento / orçamento atingido no Google AI Studio (429 - RESOURCE_EXHAUSTED). Seu projeto ultrapassou os limites e restrições mensais estabelecidos. Por favor, acesse o painel do Google AI Studio em https://ai.studio/spend para estender seu limite ou atualizar os planos de faturamento.";
  }
  return msg;
}
