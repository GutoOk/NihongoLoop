import { Source, Sentence, SentenceTerm, DictionaryEntry } from '../types';

export const MOCK_SOURCE_ID = "00000000-0000-0000-0000-000000000001";
export const MOCK_SENTENCE_1_ID = "00000000-0000-0000-0000-000000000002";
export const MOCK_SENTENCE_2_ID = "00000000-0000-0000-0000-000000000003";

export const defaultMockSources: Source[] = [
  {
    id: MOCK_SOURCE_ID,
    user_id: "test-user-id",
    title: "Fonte de Teste E2E",
    type: "text",
    original_content: "日本語 de teste",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

export const defaultMockSentences: Sentence[] = [
  {
    id: MOCK_SENTENCE_1_ID,
    source_id: MOCK_SOURCE_ID,
    user_id: "test-user-id",
    order_index: 0,
    japanese: "日本語 de teste 1",
    japanese_key: "nihongodetest1",
    portuguese: "Estudo de japonês",
    kana: "にほんごのべんきょう",
    romaji: "nihongo no benkyou",
    status: "reviewed",
    tags: ["E2E"],
    favorite: false,
    difficulty: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: MOCK_SENTENCE_2_ID,
    source_id: MOCK_SOURCE_ID,
    user_id: "test-user-id",
    order_index: 1,
    japanese: "日本語 de teste 2",
    japanese_key: "nihongodetest2",
    portuguese: "Bebo água",
    kana: "みずをのみます",
    romaji: "mizu o nomimasu",
    status: "reviewed",
    tags: ["E2E"],
    favorite: false,
    difficulty: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

export const defaultMockTerms: SentenceTerm[] = [
  {
    id: "00000000-0000-0000-0000-000000000004",
    user_id: "test-user-id",
    sentence_id: MOCK_SENTENCE_1_ID,
    dictionary_entry_id: "00000000-0000-0000-0000-000000000006",
    surface: "日本語",
    lemma: "日本語",
    kana: "にほんご",
    romaji: "nihongo",
    start_index: 0,
    end_index: 3,
    type: "substantivo",
    confidence: 1.0,
    status: "detected",
    context_meaning: "japonês",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "00000000-0000-0000-0000-000000000005",
    user_id: "test-user-id",
    sentence_id: MOCK_SENTENCE_2_ID,
    dictionary_entry_id: "00000000-0000-0000-0000-000000000007",
    surface: "水",
    lemma: "水",
    kana: "みず",
    romaji: "mizu",
    start_index: 0,
    end_index: 1,
    type: "substantivo",
    confidence: 1.0,
    status: "detected",
    context_meaning: "água",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

export const defaultMockDict: DictionaryEntry[] = [
  {
    id: "00000000-0000-0000-0000-000000000006",
    user_id: "test-user-id",
    lemma: "日本語",
    kana: "にほんご",
    romaji: "nihongo",
    type: "substantivo",
    main_meaning: "língua japonesa",
    meanings: ["japonês", "idioma japonês"],
    tags: ["E2E"],
    jlpt_level: null,
    status: "reviewed",
    unique_key: "日本語",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "00000000-0000-0000-0000-000000000007",
    user_id: "test-user-id",
    lemma: "水",
    kana: "みず",
    romaji: "mizu",
    type: "substantivo",
    main_meaning: "água",
    meanings: ["água fresca"],
    tags: ["E2E"],
    jlpt_level: null,
    status: "reviewed",
    unique_key: "水",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];
