import { Type } from "@google/genai";

const DICTIONARY_TYPE_DESCRIPTION =
  "Exatamente um dos tipos: substantivo, verbo, adjetivo, adverbio, pronome, particula, expressao, interjeicao, nome proprio, numero, tempo, lugar, conector, auxiliar, outro.";

export function translationSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      translation: { type: Type.STRING, description: "Traducao natural em portugues brasileiro." },
    },
    required: ["translation"],
  };
}

export function sentenceAnalysisSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      kana: { type: Type.STRING, description: "Leitura em kana da frase completa." },
      romaji: { type: Type.STRING, description: "Romaji em letras minusculas." },
      terms: {
        type: Type.ARRAY,
        items: termSchema(),
      },
    },
    required: ["kana", "romaji", "terms"],
  };
}

export function sentencePreparationSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      translation: { type: Type.STRING, description: "Traducao natural em portugues brasileiro." },
      kana: { type: Type.STRING, description: "Leitura em kana da frase completa." },
      romaji: { type: Type.STRING, description: "Romaji em letras minusculas." },
      terms: {
        type: Type.ARRAY,
        items: termSchema(),
      },
    },
    required: ["translation", "kana", "romaji", "terms"],
  };
}

export function dictionarySchema(includeFullFields: boolean) {
  const properties: Record<string, unknown> = {
    main_meaning: { type: Type.STRING, description: "Significado principal em portugues." },
    meanings: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Ate 5 significados em portugues." },
    type: { type: Type.STRING, description: DICTIONARY_TYPE_DESCRIPTION },
    jlpt_level: { type: Type.STRING, description: "N5 a N1, ou vazio." },
    kana: { type: Type.STRING, description: "Leitura em hiragana/katakana." },
    romaji: { type: Type.STRING, description: "Romaji em letras minusculas." },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    subtype: { type: Type.STRING, description: "Subtipo gramatical curto, se util." },
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
    properties.short_note = { type: Type.STRING, description: "Nota curta e pratica." };
  }

  return {
    type: Type.OBJECT,
    properties,
    required: ["main_meaning", "meanings", "type", "kana", "romaji"],
  };
}

function termSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      surface: { type: Type.STRING, description: "Substring exata da frase japonesa." },
      lemma: { type: Type.STRING, description: "Forma canonica de dicionario." },
      kana: { type: Type.STRING, description: "Leitura contextual do termo." },
      romaji: { type: Type.STRING, description: "Romaji contextual em minusculas." },
      type: { type: Type.STRING, description: DICTIONARY_TYPE_DESCRIPTION },
      start_index: { type: Type.INTEGER, description: "Indice inicial 0-based." },
      end_index: { type: Type.INTEGER, description: "Indice final exclusivo." },
      context_meaning: { type: Type.STRING, description: "Significado contextual curto, 1 a 3 palavras." },
      grammar_note: { type: Type.STRING, description: "Nota curta apenas se explicar conjugacao relevante." },
      is_expression: { type: Type.BOOLEAN, description: "Verdadeiro para expressao idiomatica." },
    },
    required: ["surface", "lemma", "start_index", "end_index", "type"],
  };
}
