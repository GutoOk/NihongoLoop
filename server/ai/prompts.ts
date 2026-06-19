import {
  dictionarySchema,
  sentenceAnalysisSchema,
  translationSchema,
} from "./schemas";
import { getModelForJobType, getPromptVersion, getTemperatureForJobType } from "./modelPolicy";

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
      prompt: `Tarefa: traduzir uma frase japonesa para portugues brasileiro natural.
Preserve sentido e tom. Nunca devolva o texto japones como traducao.
Se for nome, som, interjeicao, particula solta ou expressao sem equivalente direto, escreva uma equivalencia ou explicacao curta em portugues brasileiro.
Retorne apenas o JSON do schema.

Frase japonesa:
${JSON.stringify(input.sentence || "")}`,
      responseSchema: translationSchema(),
    });
  }

  if (jobType === "generate_sentence_reading") {
    return withPolicy(jobType, promptVersion, {
      prompt: buildAnalysisPrompt([{ id: "item", japanese: input.sentence, portuguese: input.portuguese, known_words: input.known_words }]),
      responseSchema: sentenceAnalysisSchema(),
    });
  }

  if (jobType === "detect_sentence_terms") {
    return withPolicy(jobType, promptVersion, {
      prompt: buildTermDetectionPrompt({
        japanese: input.sentence,
        portuguese: input.portuguese,
        kana: input.kana,
        romaji: input.romaji,
        known_words: input.known_words,
      }),
      responseSchema: sentenceAnalysisSchema(),
    });
  }

  if (jobType === "enrich_dictionary_entry") {
    return withPolicy(jobType, promptVersion, {
      prompt: buildDictionaryPrompt([{ id: "item", lemma: input.lemma, examples: input.examples || [] }], true),
      responseSchema: dictionarySchema(true),
    });
  }

  throw new Error("Job type nao suportado");
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

function buildAnalysisPrompt(items: any[]): string {
  return `Tarefa: gerar leitura e segmentacao objetiva de uma frase japonesa.
Retorne o objeto da unica frase.

Regras obrigatorias:
- kana: leitura completa da frase em hiragana/katakana.
- romaji: leitura completa em letras minusculas.
- terms: lista de ocorrencias na frase, nao verbetes longos de dicionario.
- surface deve ser substring EXATA da frase japonesa original.
- start_index e end_index devem apontar exatamente para surface.
- lemma deve ser forma canonica de dicionario.
- Cubra palavras e particulas relevantes; ignore so pontuacao.
- context_meaning deve ser curto, 1 a 3 palavras.
- grammar_note so quando necessario para conjugacoes ou uso contextual.
- Prefira known_words quando o lemma aparecer de fato na frase.

Entrada:
${JSON.stringify(items)}`;
}

function buildTermDetectionPrompt(item: any): string {
  return `Tarefa: detectar termos japoneses relevantes em uma frase ja lida.
Retorne o objeto da unica frase.

Regras obrigatorias:
- Preserve kana e romaji recebidos quando estiverem corretos.
- terms: lista de ocorrencias na frase, nao verbetes longos de dicionario.
- surface deve ser substring EXATA da frase japonesa original.
- start_index e end_index devem apontar exatamente para surface.
- lemma deve ser forma canonica de dicionario.
- Cubra palavras e particulas relevantes; ignore so pontuacao.
- context_meaning deve ser curto, 1 a 3 palavras.
- grammar_note so quando necessario para conjugacoes ou uso contextual.
- Prefira known_words quando o lemma aparecer de fato na frase.

Entrada:
${JSON.stringify([{ id: "item", ...item }])}`;
}

function buildDictionaryPrompt(items: any[], includeFull: boolean): string {
  const fullInstruction = includeFull
    ? "- Inclua subtype, components, grammar_info e short_note quando uteis, de forma curta."
    : "- Nao inclua explicacoes longas; priorize campos essenciais.";

  return `Tarefa: enriquecer um verbete japones para estudo em portugues brasileiro.
Retorne o objeto do unico termo.

Para o lemma, retorne:
- main_meaning claro e curto.
- meanings com ate 5 significados.
- type usando apenas a lista permitida pelo schema.
- kana e romaji da forma canonica.
- jlpt_level se souber; vazio se incerto.
- tags curtas de uso quando uteis.
${fullInstruction}

Entrada:
${JSON.stringify(items)}`;
}
