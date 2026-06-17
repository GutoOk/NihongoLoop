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

function createStatsBuilders() {
  const sentences = [
    { id: 's-ready', portuguese: 'Pronto', kana: 'kana', romaji: 'kana', terms_source: 'ai' },
    { id: 's-no-trans', portuguese: null, kana: 'kana', romaji: 'kana', terms_source: 'ai' },
    { id: 's-no-reading', portuguese: 'Sem leitura', kana: null, romaji: null, terms_source: 'ai' },
    { id: 's-no-terms', portuguese: 'Sem termos', kana: 'kana', romaji: 'kana', terms_source: null },
    { id: 's-ai-empty', portuguese: 'Vazio', kana: 'kana', romaji: 'kana', terms_source: 'ai_empty' },
    { id: 's-stale-ai', portuguese: 'Sem termos depois de limpar', kana: 'kana', romaji: 'kana', terms_source: 'ai' },
  ];

  const terms = [
    { sentence_id: 's-ready', dictionary_entry_id: 'd-ready' },
    { sentence_id: 's-no-trans', dictionary_entry_id: 'd-pending' },
    { sentence_id: 's-no-reading', dictionary_entry_id: 'd-ready' },
  ];

  const dictEntries = [
    {
      id: 'd-ready',
      status: 'reviewed',
      main_meaning: 'ok',
      kana: 'kana',
      romaji: 'kana',
      type: 'substantivo',
      meanings: ['ok'],
    },
    {
      id: 'd-pending',
      status: 'pending',
      main_meaning: null,
      kana: null,
      romaji: null,
      type: null,
      meanings: [],
    },
  ];

  const sentencesBuilder: any = {};
  sentencesBuilder.select = vi.fn(() => sentencesBuilder);
  sentencesBuilder.eq = vi.fn()
    .mockReturnValueOnce(sentencesBuilder)
    .mockResolvedValueOnce({ data: sentences, error: null });

  const termsBuilder: any = {
    select: vi.fn(() => termsBuilder),
    in: vi.fn(() => termsBuilder),
    eq: vi.fn().mockResolvedValue({ data: terms, error: null }),
  };

  const dictionaryBuilder: any = {
    select: vi.fn(() => dictionaryBuilder),
    in: vi.fn(() => dictionaryBuilder),
    eq: vi.fn().mockResolvedValue({ data: dictEntries, error: null }),
  };

  vi.mocked(supabase!.from).mockImplementation((table: string) => {
    if (table === 'sentences') return sentencesBuilder;
    if (table === 'sentence_terms') return termsBuilder;
    if (table === 'dictionary_entries') return dictionaryBuilder;
    throw new Error(`Unexpected table ${table}`);
  });
}

describe('SourcePreparationRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem('VITE_E2E_DATA_MOCK');
    createStatsBuilders();
  });

  it('getStats counts preparation gaps and respects ai_empty analysis attempts', async () => {
    const stats = await SourcePreparationRepository.getStats('source-1');

    expect(stats).toEqual({
      sTotal: 6,
      sNoTrans: 1,
      sNoRead: 1,
      sNoTerms: 3,
      sMissingAnalysis: 3,
      dictTotal: 2,
      dictPending: 1,
    });
  });
});
