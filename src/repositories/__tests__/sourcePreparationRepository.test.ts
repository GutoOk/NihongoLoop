import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcePreparationRepository } from '../index';
import { supabase } from '../../core/supabaseClient';

vi.mock('../../core/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../../core/authService', () => ({
  AuthService: {
    getCurrentUserId: vi.fn(() => 'user-123'),
  },
}));

function createBuilder(data: any[]) {
  const builder: any = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    eq: vi.fn(() => Promise.resolve({ data, error: null })),
  };
  return builder;
}

function createSentenceBuilder(data: any[]) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn()
    .mockReturnValueOnce(builder)
    .mockResolvedValueOnce({ data, error: null });
  return builder;
}

function createStatsBuilders() {
  const sentences = [
    { id: 's-ready', portuguese: 'Pronto', kana: 'かな', romaji: 'kana', terms_source: 'ai' },
    { id: 's-no-trans', portuguese: null, kana: 'かな', romaji: 'kana', terms_source: 'ai' },
    { id: 's-no-reading', portuguese: 'Sem leitura', kana: null, romaji: null, terms_source: 'ai' },
    { id: 's-no-terms', portuguese: 'Sem termos', kana: 'かな', romaji: 'kana', terms_source: null },
    { id: 's-stale-ai', portuguese: 'Marcador antigo', kana: 'かな', romaji: 'kana', terms_source: 'ai' },
  ];

  const terms = [
    { sentence_id: 's-ready', dictionary_form_id: 'f-ready' },
    { sentence_id: 's-no-trans', dictionary_form_id: 'f-pending' },
    { sentence_id: 's-no-reading', dictionary_form_id: 'f-ready' },
  ];

  const forms = [
    { id: 'f-ready', dictionary_entry_id: 'd-ready' },
    { id: 'f-pending', dictionary_entry_id: 'd-pending' },
  ];

  const dictEntries = [
    {
      id: 'd-ready',
      status: 'reviewed',
      main_meaning: 'ok',
      kana: 'かな',
      romaji: 'kana',
      type: 'substantivo',
    },
    {
      id: 'd-pending',
      status: 'pending',
      main_meaning: null,
      kana: null,
      romaji: null,
      type: null,
    },
  ];

  vi.mocked(supabase!.from).mockImplementation((table: string) => {
    if (table === 'sentences') return createSentenceBuilder(sentences);
    if (table === 'sentence_terms') return createBuilder(terms);
    if (table === 'dictionary_forms') return createBuilder(forms);
    if (table === 'dictionary_entries') return createBuilder(dictEntries);
    throw new Error(`Unexpected table ${table}`);
  });
}

describe('SourcePreparationRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem('VITE_E2E_DATA_MOCK');
    createStatsBuilders();
  });

  it('getStats derives preparation gaps from real linked data instead of terms_source labels', async () => {
    const stats = await SourcePreparationRepository.getStats('source-1');

    expect(stats).toEqual({
      sTotal: 5,
      sNoTrans: 1,
      sNoRead: 1,
      sNoTerms: 2,
      sMissingAnalysis: 3,
      dictTotal: 2,
      dictPending: 1,
    });
  });
});
