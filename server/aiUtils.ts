export async function withAbortableTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number = 120000,
  errorMsg: string = "Tempo limite de 120s excedido na chamada do Gemini (Timeout).",
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(errorMsg)), ms);
  try {
    return await task(controller.signal);
  } catch (error: any) {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error ? controller.signal.reason : new Error(errorMsg);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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
  const lowerMsg = msg.toLowerCase();
  if (
    lowerMsg.includes("prepayment credits are depleted") ||
    lowerMsg.includes("prepayment") ||
    lowerMsg.includes("depleted") ||
    lowerMsg.includes("spending cap") ||
    lowerMsg.includes("resource_exhausted") ||
    lowerMsg.includes("exceeded its monthly spending cap")
  ) {
    if (lowerMsg.includes("prepayment") || lowerMsg.includes("depleted")) {
      return "Créditos pré-pagos esgotados no Google AI Studio (429 - RESOURCE_EXHAUSTED). Os créditos de faturamento pré-pago da sua conta do Google AI Studio acabaram. Por favor, acesse o painel do Google AI Studio em https://ai.studio/projects para adicionar fundos ou atualizar suas informações de faturamento.";
    }
    return "Limite de faturamento / orçamento atingido no Google AI Studio (429 - RESOURCE_EXHAUSTED). Seu projeto ultrapassou os limites e restrições mensais estabelecidos. Por favor, acesse o painel do Google AI Studio em https://ai.studio/spend ou https://ai.studio/projects para estender seu limite ou atualizar os planos de faturamento.";
  }
  return msg;
}
