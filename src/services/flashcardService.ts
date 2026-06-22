import { DictionaryEntry, DictionaryProgress } from "../types";
import {
  CardState,
  classifyCardState,
  isCardDue,
  isCardMastered,
  isLeech as isLeechCard,
} from "../repositories/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CardMode = "ja_pt" | "pt_ja" | "audio_pt";
export type QuickMode = "smart" | "due" | "new" | "leech" | "favorite";
export type SessionOrder = "due" | "random" | "difficulty" | "jlpt";

export interface FlashcardSettings {
  dailyNewLimit: number;
  dailyReviewLimit: number; // 0 = ilimitado
  desiredRetention: number; // 0.80 – 0.97
  autoplayAudio: boolean;
  showExamples: boolean;
  defaultMode: CardMode;
}

export interface SessionConfig {
  // filtros
  sourceId?: string;
  type?: string;
  jlpt_level?: string;
  states?: CardState[];
  favoritesOnly?: boolean;
  includeLeeches?: boolean;
  // sessão
  mode: CardMode;
  newLimit: number;
  reviewLimit: number; // 0 = ilimitado
  order: SessionOrder;
  onlyDue: boolean;
  quick?: QuickMode;
  label?: string;
}

export interface CustomDeck {
  id: string;
  name: string;
  color: string;
  config: SessionConfig;
  createdAt: string;
}

export interface CardItem {
  entry: DictionaryEntry;
  progress: DictionaryProgress | null;
  state: CardState;
  isLeech: boolean;
  isFavorite: boolean;
  overdueMs: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const KEY_SETTINGS = "nihongo.fc.settings";
const KEY_DECKS = "nihongo.fc.decks";
const KEY_DAILY = "nihongo.fc.daily"; // { [dateISO]: { reviews: n, newCards: n } }

export const DEFAULT_SETTINGS: FlashcardSettings = {
  dailyNewLimit: 20,
  dailyReviewLimit: 0,
  desiredRetention: 0.9,
  autoplayAudio: false,
  showExamples: true,
  defaultMode: "ja_pt",
};

const DECK_COLORS = ["indigo", "violet", "emerald", "sky", "amber", "rose", "teal", "fuchsia"];

// ─── localStorage helpers ──────────────────────────────────────────────────────

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

function readRaw<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

function todayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// ─── Settings ──────────────────────────────────────────────────────────────────

export const FlashcardStore = {
  getSettings(): FlashcardSettings {
    return read(KEY_SETTINGS, DEFAULT_SETTINGS);
  },
  saveSettings(s: Partial<FlashcardSettings>): FlashcardSettings {
    const merged = { ...this.getSettings(), ...s };
    write(KEY_SETTINGS, merged);
    return merged;
  },

  // ─── Custom decks ──────────────────────────────────────────────────────────
  getDecks(): CustomDeck[] {
    return readRaw<CustomDeck[]>(KEY_DECKS, []);
  },
  saveDeck(name: string, config: SessionConfig, color?: string): CustomDeck {
    const decks = this.getDecks();
    const deck: CustomDeck = {
      id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || "Baralho",
      color: color || DECK_COLORS[decks.length % DECK_COLORS.length],
      config,
      createdAt: new Date().toISOString(),
    };
    write(KEY_DECKS, [...decks, deck]);
    return deck;
  },
  deleteDeck(id: string): void {
    write(KEY_DECKS, this.getDecks().filter((d) => d.id !== id));
  },

  // ─── Daily log (streak + heatmap + throttling) ───────────────────────────────
  getDailyLog(): Record<string, { reviews: number; newCards: number }> {
    return readRaw(KEY_DAILY, {} as Record<string, { reviews: number; newCards: number }>);
  },
  recordSession(reviews: number, newCards: number): void {
    const log = this.getDailyLog();
    const k = todayKey();
    const entry = log[k] || { reviews: 0, newCards: 0 };
    entry.reviews += reviews;
    entry.newCards += newCards;
    log[k] = entry;
    write(KEY_DAILY, log);
  },
  getTodayCounts(): { reviews: number; newCards: number } {
    return this.getDailyLog()[todayKey()] || { reviews: 0, newCards: 0 };
  },
  /** Consecutive days (ending today or yesterday) with at least one review. */
  getStreak(): number {
    const log = this.getDailyLog();
    let streak = 0;
    const cursor = new Date();
    // allow today to be empty (streak from yesterday)
    if (!(log[todayKey(cursor)]?.reviews > 0)) cursor.setDate(cursor.getDate() - 1);
    for (;;) {
      const k = todayKey(cursor);
      if (log[k]?.reviews > 0) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
    return streak;
  },
  /** Heatmap data: last `days` days, most recent last. */
  getHeatmap(days = 119): { date: string; count: number }[] {
    const log = this.getDailyLog();
    const out: { date: string; count: number }[] = [];
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const k = todayKey(cursor);
      out.push({ date: k, count: log[k]?.reviews || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  },
};

// ─── Deck statistics ───────────────────────────────────────────────────────────

export interface DeckStats {
  total: number;
  new: number;
  learning: number;
  young: number;
  mature: number;
  mastered: number;
  due: number;
  leeches: number;
  favorites: number;
  suspended: number;
}

export function computeDeckStats(
  entries: DictionaryEntry[],
  progressMap: Record<string, DictionaryProgress>,
): DeckStats {
  const stats: DeckStats = {
    total: 0, new: 0, learning: 0, young: 0, mature: 0,
    mastered: 0, due: 0, leeches: 0, favorites: 0, suspended: 0,
  };
  for (const e of entries) {
    if (!e.main_meaning) continue;
    const p = progressMap[e.id] ?? null;
    if (p?.suspended) { stats.suspended++; continue; }
    if (isCardMastered(p)) { stats.mastered++; continue; }
    stats.total++;
    const state = classifyCardState(p);
    if (state === "new") stats.new++;
    else if (state === "learning") stats.learning++;
    else if (state === "young") stats.young++;
    else if (state === "mature") stats.mature++;
    if (p && p.seen_count > 0 && isCardDue(p)) stats.due++;
    if (isLeechCard(p)) stats.leeches++;
    if (p?.favorite) stats.favorites++;
  }
  return stats;
}

// ─── Queue builder (pure) ──────────────────────────────────────────────────────

export interface BuildQueueParams {
  entries: DictionaryEntry[];
  progressMap: Record<string, DictionaryProgress>;
  config: SessionConfig;
  newIntroducedToday: number;
  allowedEntryIds?: Set<string> | null;
}

export function buildQueue({
  entries, progressMap, config, newIntroducedToday, allowedEntryIds,
}: BuildQueueParams): CardItem[] {
  const now = Date.now();

  // 1. Base pool: has meaning, not mastered, not suspended.
  let pool = entries.filter((e) => {
    if (!e.main_meaning) return false;
    const p = progressMap[e.id] ?? null;
    if (isCardMastered(p)) return false;
    if (p?.suspended) return false;
    if (allowedEntryIds && !allowedEntryIds.has(e.id)) return false;
    if (config.type && e.type !== config.type) return false;
    if (config.jlpt_level && e.jlpt_level !== config.jlpt_level) return false;
    return true;
  });

  // 2. Map to items.
  let items: CardItem[] = pool.map((entry) => {
    const p = progressMap[entry.id] ?? null;
    const overdueMs = p?.due_at ? now - new Date(p.due_at).getTime() : (p ? 0 : now);
    return {
      entry,
      progress: p,
      state: classifyCardState(p),
      isLeech: isLeechCard(p),
      isFavorite: Boolean(p?.favorite),
      overdueMs,
    };
  });

  // 3. State / favorite / leech filters.
  if (config.favoritesOnly) items = items.filter((i) => i.isFavorite);
  if (config.states && config.states.length) {
    items = items.filter((i) => config.states!.includes(i.state));
  }
  if (config.quick === "leech") items = items.filter((i) => i.isLeech);

  // 4. Split new vs review (due).
  const isNewItem = (i: CardItem) => i.state === "new";
  const isDueItem = (i: CardItem) =>
    i.state !== "new" && isCardDue(i.progress, new Date(now));

  let newItems = items.filter(isNewItem);
  let reviewItems = items.filter((i) => (config.onlyDue ? isDueItem(i) : i.state !== "new"));

  // 5. Apply daily new-card throttle.
  const remainingNewBudget = config.quick === "new"
    ? config.newLimit
    : Math.max(0, config.newLimit - newIntroducedToday);
  const newCap = Math.min(newItems.length, Math.max(0, remainingNewBudget));

  // 6. Order each bucket.
  const orderFn = getOrderComparator(config.order);
  reviewItems.sort(orderFn);
  // new cards: by jlpt then frequency-ish (keep stable / shuffle if random)
  if (config.order === "random") shuffle(newItems);
  else newItems.sort((a, b) => jlptRank(a.entry.jlpt_level) - jlptRank(b.entry.jlpt_level));

  newItems = newItems.slice(0, newCap);
  if (config.reviewLimit > 0) reviewItems = reviewItems.slice(0, config.reviewLimit);

  // 7. Interleave reviews first (memory priority) then new, but mix new in
  //    gradually so the session isn't front-loaded with only reviews.
  return interleave(reviewItems, newItems);
}

function getOrderComparator(order: SessionOrder): (a: CardItem, b: CardItem) => number {
  switch (order) {
    case "random":
      return () => Math.random() - 0.5;
    case "difficulty":
      return (a, b) => (b.progress?.difficulty ?? 0) - (a.progress?.difficulty ?? 0);
    case "jlpt":
      return (a, b) => jlptRank(a.entry.jlpt_level) - jlptRank(b.entry.jlpt_level);
    case "due":
    default:
      return (a, b) => b.overdueMs - a.overdueMs;
  }
}

function jlptRank(level: string | null | undefined): number {
  const m: Record<string, number> = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };
  return level && m[level] !== undefined ? m[level] : 5;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Reviews carry priority but new cards are sprinkled through the session. */
function interleave(reviews: CardItem[], news: CardItem[]): CardItem[] {
  if (news.length === 0) return reviews;
  if (reviews.length === 0) return news;
  const result: CardItem[] = [];
  const ratio = reviews.length / news.length;
  let r = 0, n = 0, acc = 0;
  while (r < reviews.length || n < news.length) {
    if (r < reviews.length && (acc < ratio || n >= news.length)) {
      result.push(reviews[r++]);
      acc += 1;
    } else if (n < news.length) {
      result.push(news[n++]);
      acc -= ratio;
    }
  }
  return result;
}

// ─── Quick-mode config presets ─────────────────────────────────────────────────

export function quickModeConfig(mode: QuickMode, settings: FlashcardSettings): SessionConfig {
  const base: SessionConfig = {
    mode: settings.defaultMode,
    newLimit: settings.dailyNewLimit,
    reviewLimit: settings.dailyReviewLimit,
    order: "due",
    onlyDue: true,
    quick: mode,
  };
  switch (mode) {
    case "smart":
      return { ...base, label: "Estudo Rápido" };
    case "due":
      return { ...base, newLimit: 0, label: "Revisões Vencidas" };
    case "new":
      return { ...base, states: ["new"], onlyDue: false, label: "Cards Novos" };
    case "leech":
      return { ...base, newLimit: 0, onlyDue: false, reviewLimit: 0, label: "Palavras Difíceis" };
    case "favorite":
      return { ...base, favoritesOnly: true, newLimit: 0, onlyDue: false, reviewLimit: 0, label: "Favoritos" };
    default:
      return base;
  }
}

// ─── Study tips (neuroaprendizagem) ────────────────────────────────────────────

interface StudyTip { icon: string; title: string; text: string; }

const GENERAL_TIPS: StudyTip[] = [
  { icon: "brain", title: "Recordação ativa", text: "Tente lembrar a resposta antes de virar o card. O esforço de recuperar fortalece a memória muito mais que reler." },
  { icon: "clock", title: "Repetição espaçada", text: "Estudar um pouco todos os dias supera maratonas. O algoritmo já agenda cada card no momento ideal de revisão." },
  { icon: "volume", title: "Fale em voz alta", text: "Pronuncie a palavra ao revelá-la. Conectar som e significado cria mais vias de acesso à memória." },
  { icon: "book", title: "Aprenda em contexto", text: "Leia a frase de exemplo. Palavras ancoradas em contexto são lembradas com muito mais facilidade." },
  { icon: "moon", title: "Durma bem", text: "A consolidação da memória acontece durante o sono. Revisar antes de dormir pode melhorar a retenção." },
  { icon: "shuffle", title: "Intercale tipos", text: "Misturar verbos, partículas e substantivos (interleaving) treina o cérebro a recuperar sob condições variadas." },
];

export function getStudyTip(stats: DeckStats, streak: number): StudyTip {
  if (stats.leeches >= 5)
    return { icon: "alert", title: "Atenção às palavras difíceis", text: `Você tem ${stats.leeches} palavras que escapam muito. Use o modo "Difíceis" e crie um mnemônico para cada uma.` };
  if (stats.due >= 50)
    return { icon: "clock", title: "Revisões acumuladas", text: `Há ${stats.due} cards vencidos. Faça sessões curtas e frequentes para colocar em dia sem sobrecarregar.` };
  if (streak >= 7)
    return { icon: "flame", title: `${streak} dias seguidos!`, text: "Sua consistência está construindo memória de longo prazo. Continue assim, mesmo que poucos cards por dia." };
  if (stats.new > 0 && stats.due === 0)
    return { icon: "sparkles", title: "Tudo revisado!", text: "Sem revisões pendentes. Bom momento para introduzir cards novos no seu ritmo." };
  // rotate a general tip by day
  const idx = new Date().getDate() % GENERAL_TIPS.length;
  return GENERAL_TIPS[idx];
}
