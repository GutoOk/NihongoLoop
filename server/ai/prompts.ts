import {
  batchDictionarySchema,
  batchSentenceAnalysisSchema,
  batchTranslationSchema,
  dictionarySchema,
  sentenceAnalysisSchema,
  translationSchema,
} from "./schemas";
import { getModelForJobType, getPromptKind, getPromptVersion, getTemperatureForJobType } from "./modelPolicy";

export interface AiPromptRequest {
  prompt: string;
  responseSchema: unknown;
  model: string;
  temperature: number;
  promptVersion: string;
}

export function buildSingleAiRequest(jobType: string, input: any): AiPromptRequest {
  const promptVersion = getPromptVersion(jobType);

  if (jobType === "translate_sentence") {
    return withPolicy(jobType, promptVersion, {
      prompt: `Tarefa: traduzir uma frase japonesa para português brasileiro natural.
Preserve sentido e tom. Retorne apenas o JSON do schema.

Frase japonesa:
${JSON.stringify(input.sentence || "")}`,
      responseSchema: translationSchema(),
    });
  }

  if (jobType === "generate_sentence_reading") {
    return withPolicy(jobType, promptVersion, {
      prompt: buildAnalysisPrompt([{ id: "item", japanese: input.sentence, portuguese: input.portuguese, known_words: input.known_words }], false),
      responseSchema: sentenceAnalysisSchema(),
    });
  }

  if (jobType === "enrich_dictionary_entry") {
    return withPolicy(jobType, promptVersion, {
      prompt: buildDictionaryPrompt([{
        id: "item",
        lemma: input.lemma,
        examples: input.examples || [],
        missing_fields: input.missing_fields || [],
      }], true, false),
      responseSchema: dictionarySchema(true),
    });
  }

  throw new Error("Job type não suportado");
}

export function buildBatchAiRequest(jobType: string, items: any[]): AiPromptRequest {
  const promptVersion = getPromptVersion(jobType);
  const kind = getPromptKind(jobType);

  if (kind === "translate_sentence") {
    const compactItems = items.map((item) => ({
      id: item.id,
      japanese: item.sentence || item.japanese,
    }));
    return withPolicy(jobType, promptVersion, {
      prompt: `Tarefa: traduzir cada frase japonesa para português brasileiro natural.
Associe cada resultado ao mesmo id recebido. Não omita itens. Retorne apenas JSON.

Entrada:
${JSON.stringify(compactItems)}`,
      responseSchema: batchTranslationSchema(),
    });
  }

  if (kind === "analyze_sentence") {
    const compactItems = items.map((item) => ({
      id: item.id,
      japanese: item.sentence || item.japanese,
      portuguese: item.portuguese || null,
      known_words: Array.isArray(item.known_words) ? item.known_words.slice(0, 12) : [],
    }));
    return withPolicy(jobType, promptVersion, {
      prompt: buildAnalysisPrompt(compactItems, true),
      responseSchema: batchSentenceAnalysisSchema(),
    });
  }

  if (kind === "enrich_dictionary") {
    const includeFull = jobType === "batch_enrich_dictionary_entries_full";
    const compactItems = items.map((item) => ({
      id: item.id,
      lemma: item.lemma,
      kana: item.kana || null,
      romaji: item.romaji || null,
      type: item.type || null,
      main_meaning: item.main_meaning || null,
      missing_fields: Array.isArray(item.missing_fields) ? item.missing_fields : [],
      examples: Array.isArray(item.examples) ? item.examples.slice(0, 2) : [],
    }));
    return withPolicy(jobType, promptVersion, {
      prompt: buildDictionaryPrompt(compactItems, includeFull, true),
      responseSchema: batchDictionarySchema(includeFull),
    });
  }

  throw new Error("Job type não suportado para lote");
}

function withPolicy(
  jobType: string,
  promptVersion: string,
  request: Pick<AiPromptRequest, "prompt" | "responseSchema">,
): AiPromptRequest {
  return {
    ...request,
    model: getModelForJobType(jobType),
    temperature: getTemperatureForJobType(jobType),
    promptVersion,
  };
}

function buildAnalysisPrompt(items: any[], isBatch: boolean): string {
  const idInstruction = isBatch
    ? "Associe cada resultado ao mesmo id recebido em job_id. Não omita itens."
    : "Retorne o objeto da única frase.";

  return `Tarefa: gerar leitura e segmentação objetiva de frases japonesas.
${idInstruction}

Regras obrigatórias:
- kana: leitura completa da frase em hiragana/katakana.
- romaji: leitura completa em letras minúsculas.
- terms: lista de ocorrências na frase, não verbetes longos de dicionário.
- surface deve ser substring EXATA da frase japonesa original.
- start_index e end_index devem apontar exatamente para surface.
- lemma deve ser forma canônica de dicionário.
- Cubra palavras e partículas relevantes; ignore só pontuação.
- context_meaning deve ser curto, 1 a 3 palavras.
- grammar_note só quando necessário para conjugações ou uso contextual.
- Prefira known_words quando o lemma aparecer de fato na frase.

Entrada:
${JSON.stringify(items)}`;
}

function buildDictionaryPrompt(items: any[], includeFull: boolean, isBatch: boolean): string {
  const idInstruction = isBatch
    ? "Associe cada resultado ao mesmo id recebido em job_id. Não omita itens."
    : "Retorne o objeto do único termo.";
  const fullInstruction = includeFull
    ? "- Inclua subtype, components, grammar_info e short_note quando úteis, de forma curta."
    : "- Não inclua explicações longas; priorize campos essenciais.";

  return `Tarefa: enriquecer verbetes japoneses para estudo em português brasileiro.
${idInstruction}

Para cada lemma, retorne:
- main_meaning claro e curto.
- meanings com até 5 significados.
- type usando apenas a lista permitida pelo schema.
- kana e romaji da forma canônica.
- jlpt_level se souber; vazio se incerto.
- tags curtas de uso quando úteis.
- Quando missing_fields vier preenchido, priorize completar esses campos e preserve os dados existentes quando estiverem corretos.
${fullInstruction}

Entrada:
${JSON.stringify(items)}`;
}
