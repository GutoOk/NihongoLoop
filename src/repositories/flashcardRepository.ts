import { supabase, isSupabaseConfigured } from '../core/supabaseClient';
import type { CustomDeck, FlashcardSettings, SessionConfig } from '../services/flashcardService';
import { getUserId } from './utils';

export type FlashcardDailyEntry = {
  reviews: number;
  newCards: number;
  again: number;
  sessionsCount?: number;
};

export type FlashcardActivityRow = FlashcardDailyEntry & {
  date: string;
  hourHistogram: number[];
};

export type FlashcardRemoteSnapshot = {
  settings: FlashcardSettings;
  decks: CustomDeck[];
  activity: FlashcardActivityRow[];
};

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const DEFAULT_FLASHCARD_SETTINGS: FlashcardSettings = {
  dailyNewLimit: 20,
  dailyReviewLimit: 0,
  desiredRetention: 0.9,
  autoplayAudio: false,
  showExamples: true,
  defaultMode: 'ja_pt',
};

export class FlashcardRepository {
  static async getSnapshot(): Promise<FlashcardRemoteSnapshot> {
    const [settings, decks, activity] = await Promise.all([
      this.getSettings(),
      this.getDecks(),
      this.getActivity(),
    ]);
    return { settings, decks, activity };
  }

  static async getSettings(): Promise<FlashcardSettings> {
    if (!isSupabaseConfigured) return DEFAULT_FLASHCARD_SETTINGS;
    const { data, error } = await supabase!
      .from('flashcard_settings')
      .select('*')
      .eq('user_id', getUserId())
      .maybeSingle();
    if (error) throw new Error(`Erro do Supabase ao carregar configuracoes de flashcards: ${error.message}`);
    return data ? mapSettingsFromDb(data) : DEFAULT_FLASHCARD_SETTINGS;
  }

  static async saveSettings(patch: Partial<FlashcardSettings>): Promise<FlashcardSettings> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    const { data, error } = await supabase!
      .from('flashcard_settings')
      .upsert({ user_id: getUserId(), ...mapSettingsToDb(next) }, { onConflict: 'user_id' })
      .select()
      .maybeSingle();
    if (error) throw new Error(`Erro do Supabase ao salvar configuracoes de flashcards: ${error.message}`);
    return data ? mapSettingsFromDb(data) : next;
  }

  static async getDecks(): Promise<CustomDeck[]> {
    if (!isSupabaseConfigured) return [];
    const userId = getUserId();
    const { data, error } = await supabase!
      .from('flashcard_decks')
      .select('id,name,color,config,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Erro do Supabase ao carregar baralhos: ${error.message}`);
    const decks = data || [];
    if (decks.length === 0) return [];

    const { data: itemRows, error: itemsError } = await supabase!
      .from('flashcard_deck_items')
      .select('deck_id,item_type,item_id,position')
      .eq('user_id', userId)
      .in('deck_id', decks.map((deck) => deck.id))
      .order('position', { ascending: true });
    if (itemsError) throw new Error(`Erro do Supabase ao carregar itens dos baralhos: ${itemsError.message}`);

    const itemsByDeck = groupDeckItems(itemRows || []);
    return decks.map((deck) => mapDeckFromDb(deck, itemsByDeck.get(deck.id)));
  }

  static async createDeck(name: string, config: SessionConfig, color: string): Promise<CustomDeck> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    const deck: CustomDeck = {
      id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || 'Baralho',
      color,
      config,
      createdAt: new Date().toISOString(),
    };
    const { data, error } = await supabase!.rpc('save_flashcard_deck', {
      p_deck_id: deck.id,
      p_name: deck.name,
      p_color: deck.color,
      p_config: stripDeckItemIds(deck.config),
      p_items: deckItemsFromConfig(deck.config),
    });
    if (error) throw new Error(`Erro do Supabase ao criar baralho: ${error.message}`);
    return data ? mapDeckFromDb(data, deckItemsFromConfig(deck.config)) : deck;
  }

  static async updateDeck(id: string, updates: Partial<Pick<CustomDeck, 'name' | 'color' | 'config'>>): Promise<CustomDeck | null> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    const current = (await this.getDecks()).find((deck) => deck.id === id);
    if (!current) return null;
    const next: CustomDeck = {
      ...current,
      ...updates,
      name: updates.name !== undefined ? updates.name.trim() || 'Baralho' : current.name,
      config: updates.config || current.config,
    };
    const { data, error } = await supabase!.rpc('save_flashcard_deck', {
      p_deck_id: next.id,
      p_name: next.name,
      p_color: next.color,
      p_config: stripDeckItemIds(next.config),
      p_items: deckItemsFromConfig(next.config),
    });
    if (error) throw new Error(`Erro do Supabase ao atualizar baralho: ${error.message}`);
    return data ? mapDeckFromDb(data, deckItemsFromConfig(next.config)) : next;
  }

  static async deleteDeck(id: string): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    const { error } = await supabase!
      .from('flashcard_decks')
      .delete()
      .eq('id', id)
      .eq('user_id', getUserId());
    if (error) throw new Error(`Erro do Supabase ao apagar baralho: ${error.message}`);
  }

  static async getActivity(limit = 400): Promise<FlashcardActivityRow[]> {
    if (!isSupabaseConfigured) return [];
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const { data, error } = await supabase!
      .from('flashcard_daily_activity')
      .select('activity_date,reviews,new_cards,again,sessions_count,hour_histogram')
      .eq('user_id', getUserId())
      .order('activity_date', { ascending: false })
      .limit(safeLimit);
    if (error) throw new Error(`Erro do Supabase ao carregar atividade de flashcards: ${error.message}`);
    return (data || []).map(mapActivityFromDb);
  }

  static async recordDailyActivity(reviews: number, newCards: number, again = 0, timezone = DEFAULT_TIMEZONE): Promise<FlashcardActivityRow> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    const { data, error } = await supabase!.rpc('record_flashcard_daily_activity', {
      p_reviews: Math.max(0, reviews || 0),
      p_new_cards: Math.max(0, newCards || 0),
      p_again: Math.max(0, again || 0),
      p_timezone: timezone,
    });
    if (error) throw new Error(`Erro do Supabase ao registrar atividade de flashcards: ${error.message}`);
    return mapActivityFromDb(data);
  }

}

function mapSettingsFromDb(row: any): FlashcardSettings {
  return {
    dailyNewLimit: row.daily_new_limit ?? DEFAULT_FLASHCARD_SETTINGS.dailyNewLimit,
    dailyReviewLimit: row.daily_review_limit ?? DEFAULT_FLASHCARD_SETTINGS.dailyReviewLimit,
    desiredRetention: Number(row.desired_retention ?? DEFAULT_FLASHCARD_SETTINGS.desiredRetention),
    autoplayAudio: Boolean(row.autoplay_audio ?? DEFAULT_FLASHCARD_SETTINGS.autoplayAudio),
    showExamples: Boolean(row.show_examples ?? DEFAULT_FLASHCARD_SETTINGS.showExamples),
    defaultMode: row.default_mode || DEFAULT_FLASHCARD_SETTINGS.defaultMode,
  };
}

function mapSettingsToDb(settings: FlashcardSettings) {
  return {
    daily_new_limit: settings.dailyNewLimit,
    daily_review_limit: settings.dailyReviewLimit,
    desired_retention: settings.desiredRetention,
    autoplay_audio: settings.autoplayAudio,
    show_examples: settings.showExamples,
    default_mode: settings.defaultMode,
  };
}

function mapDeckFromDb(row: any, items: DeckItemPayload[] = []): CustomDeck {
  const config = applyDeckItemsToConfig(row.config || {}, items);
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    config,
    createdAt: row.created_at,
  };
}

function mapActivityFromDb(row: any): FlashcardActivityRow {
  return {
    date: row.activity_date,
    reviews: Number(row.reviews || 0),
    newCards: Number(row.new_cards || 0),
    again: Number(row.again || 0),
    sessionsCount: Number(row.sessions_count || 0),
    hourHistogram: normalizeHourHistogram(row.hour_histogram),
  };
}

function normalizeHourHistogram(value: unknown): number[] {
  const input = Array.isArray(value) ? value : [];
  return Array.from({ length: 24 }, (_, index) => Math.max(0, Number(input[index] || 0)));
}

type DeckItemPayload = {
  item_type: 'word' | 'sentence';
  item_id: string;
  position?: number;
};

function stripDeckItemIds(config: SessionConfig): SessionConfig {
  const { entryIds, sentenceIds, ...rest } = config;
  return rest;
}

function deckItemsFromConfig(config: SessionConfig): DeckItemPayload[] {
  const ids = config.deckKind === 'sentences' ? config.sentenceIds || [] : config.entryIds || [];
  const itemType = config.deckKind === 'sentences' ? 'sentence' : 'word';
  return ids.map((id, position) => ({ item_type: itemType, item_id: id, position }));
}

function applyDeckItemsToConfig(config: SessionConfig, items: DeckItemPayload[]): SessionConfig {
  const words = items.filter((item) => item.item_type === 'word').sort(sortDeckItems).map((item) => item.item_id);
  const sentences = items.filter((item) => item.item_type === 'sentence').sort(sortDeckItems).map((item) => item.item_id);
  if (sentences.length > 0) return { ...config, deckKind: 'sentences', sentenceIds: sentences, entryIds: undefined };
  return { ...config, deckKind: config.deckKind || 'words', entryIds: words, sentenceIds: undefined };
}

function groupDeckItems(rows: any[]): Map<string, DeckItemPayload[]> {
  const map = new Map<string, DeckItemPayload[]>();
  for (const row of rows) {
    const current = map.get(row.deck_id) || [];
    current.push({
      item_type: row.item_type === 'sentence' ? 'sentence' : 'word',
      item_id: row.item_id,
      position: Number(row.position || 0),
    });
    map.set(row.deck_id, current);
  }
  return map;
}

function sortDeckItems(a: DeckItemPayload, b: DeckItemPayload): number {
  return (a.position || 0) - (b.position || 0);
}
