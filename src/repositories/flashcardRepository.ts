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

export type FlashcardLocalSnapshot = {
  settings: FlashcardSettings;
  decks: CustomDeck[];
  dailyLog: Record<string, FlashcardDailyEntry>;
  hourHistogram: number[];
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

  static async hasRemoteData(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    const userId = getUserId();
    const [settings, decks, activity] = await Promise.all([
      supabase!.from('flashcard_settings').select('user_id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase!.from('flashcard_decks').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase!.from('flashcard_daily_activity').select('activity_date', { count: 'exact', head: true }).eq('user_id', userId),
    ]);
    if (settings.error) throw new Error(`Erro do Supabase ao contar configuracoes de flashcards: ${settings.error.message}`);
    if (decks.error) throw new Error(`Erro do Supabase ao contar baralhos: ${decks.error.message}`);
    if (activity.error) throw new Error(`Erro do Supabase ao contar atividade de flashcards: ${activity.error.message}`);
    return Boolean((settings.count || 0) + (decks.count || 0) + (activity.count || 0));
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
    const { data, error } = await supabase!
      .from('flashcard_decks')
      .select('id,name,color,config,created_at')
      .eq('user_id', getUserId())
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Erro do Supabase ao carregar baralhos: ${error.message}`);
    return (data || []).map(mapDeckFromDb);
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
    const { data, error } = await supabase!
      .from('flashcard_decks')
      .insert({
        id: deck.id,
        user_id: getUserId(),
        name: deck.name,
        color: deck.color,
        config: deck.config,
        created_at: deck.createdAt,
      })
      .select('id,name,color,config,created_at')
      .maybeSingle();
    if (error) throw new Error(`Erro do Supabase ao criar baralho: ${error.message}`);
    return data ? mapDeckFromDb(data) : deck;
  }

  static async updateDeck(id: string, updates: Partial<Pick<CustomDeck, 'name' | 'color' | 'config'>>): Promise<CustomDeck | null> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name.trim() || 'Baralho';
    if (updates.color !== undefined) payload.color = updates.color;
    if (updates.config !== undefined) payload.config = updates.config;
    const { data, error } = await supabase!
      .from('flashcard_decks')
      .update(payload)
      .eq('id', id)
      .eq('user_id', getUserId())
      .select('id,name,color,config,created_at')
      .maybeSingle();
    if (error) throw new Error(`Erro do Supabase ao atualizar baralho: ${error.message}`);
    return data ? mapDeckFromDb(data) : null;
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

  static async importLocalSnapshotIfRemoteEmpty(snapshot: FlashcardLocalSnapshot): Promise<boolean> {
    if (!isSupabaseConfigured) throw new Error('Supabase nao configurado.');
    if (await this.hasRemoteData()) return false;
    const userId = getUserId();

    await this.saveSettings(snapshot.settings);

    if (snapshot.decks.length > 0) {
      const { error } = await supabase!
        .from('flashcard_decks')
        .upsert(
          snapshot.decks.map((deck) => ({
            id: deck.id,
            user_id: userId,
            name: deck.name,
            color: deck.color,
            config: deck.config,
            created_at: deck.createdAt,
          })),
          { onConflict: 'id' },
        );
      if (error) throw new Error(`Erro do Supabase ao migrar baralhos locais: ${error.message}`);
    }

    const activityRows = buildActivityRowsForImport(userId, snapshot);
    if (activityRows.length > 0) {
      const { error } = await supabase!
        .from('flashcard_daily_activity')
        .upsert(activityRows, { onConflict: 'user_id,activity_date' });
      if (error) throw new Error(`Erro do Supabase ao migrar atividade local: ${error.message}`);
    }

    return true;
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

function mapDeckFromDb(row: any): CustomDeck {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    config: row.config || {},
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

function buildActivityRowsForImport(userId: string, snapshot: FlashcardLocalSnapshot) {
  const rows = Object.entries(snapshot.dailyLog).map(([date, entry]) => ({
    user_id: userId,
    activity_date: date,
    reviews: Math.max(0, entry.reviews || 0),
    new_cards: Math.max(0, entry.newCards || 0),
    again: Math.max(0, entry.again || 0),
    sessions_count: Math.max(0, entry.sessionsCount || 0),
    hour_histogram: normalizeHourHistogram([]),
  }));
  const histogram = normalizeHourHistogram(snapshot.hourHistogram);
  const hasHistogram = histogram.some((count) => count > 0);
  if (hasHistogram) {
    const today = todayKeyInTimeZone();
    const existing = rows.find((row) => row.activity_date === today);
    if (existing) {
      existing.hour_histogram = histogram;
      existing.sessions_count = Math.max(existing.sessions_count, histogram.reduce((sum, count) => sum + count, 0));
    } else {
      rows.push({
        user_id: userId,
        activity_date: today,
        reviews: 0,
        new_cards: 0,
        again: 0,
        sessions_count: histogram.reduce((sum, count) => sum + count, 0),
        hour_histogram: histogram,
      });
    }
  }
  return rows;
}

function todayKeyInTimeZone(timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
