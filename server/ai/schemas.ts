import { Type } from "@google/genai";

const DICTIONARY_TYPE_DESCRIPTION =
  "Exatamente um dos tipos: substantivo, verbo, adjetivo, advérbio, pronome, partícula, expressão, interjeição, nome próprio, número, tempo, lugar, conector, auxiliar, outro.";

export function translationSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      translation: { type: Type.STRING, description: "Tradução natural em português brasileiro." },
    },
    required: ["translation"],
  };
}

export function batchTranslationSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            job_id: { type: Type.STRING, description: "ID recebido na entrada." },
            translation: { type: Type.STRING, description: "Tradução natural em português brasileiro." },
          },
          required: ["job_id", "translation"],
        },
      },
    },
    required: ["results"],
  };
}

export function sentenceAnalysisSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      kana: { type: Type.STRING, description: "Leitura em kana da frase completa." },
      romaji: { type: Type.STRING, description: "Romaji em letras minúsculas." },
      terms: {
        type: Type.ARRAY,
        items: termSchema(),
      },
    },
    required: ["kana", "romaji", "terms"],
  };
}

export function batchSentenceAnalysisSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            job_id: { type: Type.STRING, description: "ID recebido na entrada." },
            kana: { type: Type.STRING, description: "Leitura em kana da frase completa." },
            romaji: { type: Type.STRING, description: "Romaji em letras minúsculas." },
            terms: {
              type: Type.ARRAY,
              items: termSchema(),
            },
          },
          required: ["job_id", "kana", "romaji", "terms"],
        },
      },
    },
    required: ["results"],
  };
}

export function dictionarySchema(includeFullFields: boolean) {
  const properties: Record<string, unknown> = {
    main_meaning: { type: Type.STRING, description: "Significado principal em português." },
    meanings: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Até 5 significados em português." },
    type: { type: Type.STRING, description: DICTIONARY_TYPE_DESCRIPTION },
    jlpt_level: { type: Type.STRING, description: "N5 a N1, ou vazio." },
    kana: { type: Type.STRING, description: "Leitura em hiragana/katakana." },
    romaji: { type: Type.STRING, description: "Romaji em letras minúsculas." },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    subtype: { type: Type.STRING, description: "Subtipo gramatical curto, se útil." },
  };

  if (includeFullFields) {
    properties.components = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          surface: { type: Type.STRING },
          reading: { type: Type.STRING },
          meaning: { type: Type.STRING },
        },
      },
    };
    properties.grammar_info = { type: Type.STRING, description: "Uso gramatical em uma frase curta." };
    properties.common_forms = { type: Type.ARRAY, items: { type: Type.STRING } };
    properties.short_note = { type: Type.STRING, description: "Nota curta e prática." };
  }

  return {
    type: Type.OBJECT,
    properties,
    required: ["main_meaning", "meanings", "type", "kana", "romaji"],
  };
}

export function batchDictionarySchema(includeFullFields: boolean) {
  const single = dictionarySchema(includeFullFields) as any;
  return {
    type: Type.OBJECT,
    properties: {
      results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            job_id: { type: Type.STRING, description: "ID recebido na entrada." },
            ...single.properties,
          },
          required: ["job_id", "main_meaning", "type", "kana", "romaji"],
        },
      },
    },
    required: ["results"],
  };
}

function termSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      surface: { type: Type.STRING, description: "Substring exata da frase japonesa." },
      lemma: { type: Type.STRING, description: "Forma canônica de dicionário." },
      kana: { type: Type.STRING, description: "Leitura contextual do termo." },
      romaji: { type: Type.STRING, description: "Romaji contextual em minúsculas." },
      type: { type: Type.STRING, description: DICTIONARY_TYPE_DESCRIPTION },
      start_index: { type: Type.INTEGER, description: "Índice inicial 0-based." },
      end_index: { type: Type.INTEGER, description: "Índice final exclusivo." },
      context_meaning: { type: Type.STRING, description: "Significado contextual curto, 1 a 3 palavras." },
      grammar_note: { type: Type.STRING, description: "Nota curta apenas se explicar conjugação relevante." },
      is_expression: { type: Type.BOOLEAN, description: "Verdadeiro para expressão idiomática." },
    },
    required: ["surface", "lemma", "start_index", "end_index", "type"],
  };
}
