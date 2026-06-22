import { AuthService } from '../core/authService';
import { DictionaryProgress, SentenceProgress } from '../types';

export function getUserId() {
  return AuthService.getCurrentUserId();
}

export function isE2EMockMode(): boolean {
  if (import.meta.env.MODE === 'production' || typeof window === 'undefined') {
    return false;
  }

  return (
    import.meta.env.VITE_E2E_DATA_MOCK === 'true' ||
    (window as { __E2E_DATA_MOCK__?: boolean }).__E2E_DATA_MOCK__ === true ||
    window.localStorage.getItem('VITE_E2E_DATA_MOCK') === 'true'
  );
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function normalizeTagsForUpdate(copy: Record<string, unknown>): void {
  if (Array.isArray(copy.tags)) {
    copy.tags = (copy.tags as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  } else {
    delete copy.tags;
  }
}

// FSRS-4.5 default parameters (19 weights)
const FSRS_W = [
  0.40255, 1.18385, 3.17394, 15.6905, // w[0-3]: initial stability per rating (Again/Hard/Good/Easy)
  7.1949,  0.5345,  1.4604,            // w[4-6]: difficulty params
  0.0046,  1.54575, 0.1192,  1.01925, // w[7-10]: recall stability params
  1.9395,  0.11,    0.29605, 2.27,    // w[11-14]: forget stability params
  0.29,    2.9898,                    // w[15-16]: hard penalty, easy bonus
];

const FSRS_DECAY = -0.5;
const FSRS_FACTOR = Math.pow(0.9, 1.0 / FSRS_DECAY) - 1; // ≈ 19/81

export type FSRSRating = 1 | 2 | 3 | 4; // Again=1, Hard=2, Good=3, Easy=4

function fsrsRetrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + FSRS_FACTOR * elapsedDays / stability, FSRS_DECAY);
}

function fsrsNextIntervalDays(stability: number, desiredRetention = 0.9): number {
  const days = stability / FSRS_FACTOR * (Math.pow(desiredRetention, 1.0 / FSRS_DECAY) - 1);
  return Math.max(1, Math.round(days));
}

function fsrsInitDifficulty(rating: FSRSRating): number {
  return Math.max(1, Math.min(10, FSRS_W[4] - (Math.exp(FSRS_W[5] * (rating - 1)) - 1)));
}

function fsrsUpdateDifficulty(D: number, rating: FSRSRating): number {
  const delta = -FSRS_W[5] * (rating - 3);
  const newD = D + delta + 0.1 * (FSRS_W[4] - D);
  return Math.max(1, Math.min(10, newD));
}

function fsrsRecallStability(D: number, S: number, R: number, rating: FSRSRating): number {
  const hardPenalty = rating === 2 ? FSRS_W[15] : 1.0;
  const easyBonus = rating === 4 ? FSRS_W[16] : 1.0;
  const newS = S * Math.exp(FSRS_W[8]) * (11 - D) * Math.pow(S, -FSRS_W[9]) *
    (Math.exp(FSRS_W[10] * (1 - R)) - 1) * hardPenalty * easyBonus;
  return Math.max(S, newS);
}

function fsrsForgetStability(D: number, S: number, R: number): number {
  const newS = FSRS_W[11] * Math.pow(D, -FSRS_W[12]) *
    (Math.pow(S + 1, FSRS_W[13]) - 1) * Math.exp((1 - R) * FSRS_W[14]);
  return Math.max(0.1, newS);
}

function fsrsFormatInterval(intervalMinutes: number): string {
  if (intervalMinutes < 60) return `${Math.round(intervalMinutes)} min`;
  if (intervalMinutes < 1440) return `${Math.round(intervalMinutes / 60)} h`;
  const days = Math.round(intervalMinutes / 1440);
  if (days < 30) return `${days} d`;
  if (days < 365) return `${Math.round(days / 30)} sem`;
  return `${Math.round(days / 365)} a`;
}

export interface FSRSCardData {
  seen_count: number;
  correct_count: number;
  wrong_count: number;
  mastery: number;
  srs_ease_factor?: number | null; // repurposed: FSRS stability in days
  srs_interval_minutes?: number | null;
  difficulty?: number | null; // FSRS difficulty 1-10
  due_at?: string | null;
  last_seen_at?: string | null;
}

export interface FSRSUpdate {
  seen_count: number;
  correct_count: number;
  wrong_count: number;
  last_seen_at: string;
  mastery: number;
  srs_ease_factor: number; // FSRS stability in days
  difficulty: number;
  srs_interval_minutes: number;
  due_at: string;
}

export function computeFSRSUpdate(existing: FSRSCardData | null, rating: FSRSRating): FSRSUpdate {
  const now = new Date();
  const isNew = !existing || existing.seen_count === 0;
  const currentInterval = existing?.srs_interval_minutes ?? 0;
  const isLearning = !isNew && currentInterval < 1440; // < 1 day
  const isReview = !isNew && currentInterval >= 1440;

  let stability = existing?.srs_ease_factor ?? 0;
  let difficulty = Math.max(1, Math.min(10, existing?.difficulty ?? 5));
  let newStability: number;
  let newDifficulty: number;
  let newIntervalMinutes: number;

  if (isNew) {
    newStability = FSRS_W[rating - 1];
    newDifficulty = fsrsInitDifficulty(rating);
    if (rating === 1) newIntervalMinutes = 1;
    else if (rating === 2) newIntervalMinutes = 5;
    else if (rating === 3) newIntervalMinutes = 10;
    else newIntervalMinutes = Math.max(1440, fsrsNextIntervalDays(newStability) * 1440);

  } else if (isLearning) {
    newDifficulty = fsrsUpdateDifficulty(difficulty, rating);
    newStability = stability || FSRS_W[rating - 1];
    if (rating === 1) {
      newIntervalMinutes = 1;
    } else if (rating === 2) {
      newIntervalMinutes = Math.min(Math.round(currentInterval * 1.5) + 5, 720);
    } else if (rating === 3) {
      if (currentInterval < 10) newIntervalMinutes = 10;
      else if (currentInterval < 120) newIntervalMinutes = 240;
      else {
        const days = fsrsNextIntervalDays(newStability);
        newIntervalMinutes = Math.max(1440, days * 1440);
      }
    } else {
      const days = fsrsNextIntervalDays(newStability || FSRS_W[3]);
      newIntervalMinutes = Math.max(1440, days * 1440);
    }

  } else {
    // Review card. Guard against missing/zero stability (e.g. legacy data)
    // so the card can't get stuck at a 1-day interval forever.
    const S = stability > 0 ? stability : FSRS_W[2];
    const lastSeenMs = existing?.last_seen_at ? new Date(existing.last_seen_at).getTime() : now.getTime();
    const elapsedDays = (now.getTime() - lastSeenMs) / (1000 * 60 * 60 * 24);
    const R = fsrsRetrievability(Math.max(elapsedDays, 0.001), S);

    newDifficulty = fsrsUpdateDifficulty(difficulty, rating);

    if (rating === 1) {
      newStability = fsrsForgetStability(difficulty, S, R);
      newIntervalMinutes = 10;
    } else {
      newStability = fsrsRecallStability(difficulty, S, R, rating);
      const days = fsrsNextIntervalDays(newStability);
      newIntervalMinutes = days * 1440;
    }
  }

  const masteryDeltas: Record<FSRSRating, number> = { 1: -15, 2: 5, 3: 12, 4: 20 };
  const mastery = isNew
    ? (rating === 1 ? 0 : rating * 5)
    : Math.max(0, Math.min(100, (existing!.mastery ?? 0) + masteryDeltas[rating]));

  return {
    seen_count: (existing?.seen_count ?? 0) + 1,
    correct_count: (existing?.correct_count ?? 0) + (rating >= 2 ? 1 : 0),
    wrong_count: (existing?.wrong_count ?? 0) + (rating === 1 ? 1 : 0),
    last_seen_at: now.toISOString(),
    mastery,
    srs_ease_factor: parseFloat(newStability.toFixed(4)),
    difficulty: Math.round(Math.max(1, Math.min(10, newDifficulty))),
    srs_interval_minutes: Math.round(newIntervalMinutes),
    due_at: new Date(now.getTime() + newIntervalMinutes * 60 * 1000).toISOString(),
  };
}

export function fsrsPreviewIntervals(existing: FSRSCardData | null): Record<FSRSRating, string> {
  const previews = {} as Record<FSRSRating, string>;
  for (const r of [1, 2, 3, 4] as FSRSRating[]) {
    const update = computeFSRSUpdate(existing, r);
    previews[r] = fsrsFormatInterval(update.srs_interval_minutes);
  }
  return previews;
}

// ─── FSRS analysis helpers (UI/insights) ──────────────────────────────────────

export const MASTERED_SENTINEL = 999999;
export const LEECH_LAPSE_THRESHOLD = 5;
export const MATURE_INTERVAL_DAYS = 21;

export type CardState = 'new' | 'learning' | 'young' | 'mature' | 'mastered';

interface ProgressLike {
  seen_count?: number;
  wrong_count?: number;
  mastery?: number;
  srs_interval_minutes?: number | null;
  srs_ease_factor?: number | null;
  difficulty?: number | null;
  due_at?: string | null;
  last_seen_at?: string | null;
  suspended?: boolean;
}

export function classifyCardState(p: ProgressLike | null | undefined): CardState {
  if (!p || !p.seen_count) return 'new';
  if ((p.mastery ?? 0) >= MASTERED_SENTINEL) return 'mastered';
  const interval = p.srs_interval_minutes ?? 0;
  if (interval < 1440) return 'learning';
  if (interval < MATURE_INTERVAL_DAYS * 1440) return 'young';
  return 'mature';
}

export function isCardMastered(p: ProgressLike | null | undefined): boolean {
  return (p?.mastery ?? 0) >= MASTERED_SENTINEL;
}

export function isCardDue(p: ProgressLike | null | undefined, at: Date = new Date()): boolean {
  if (!p || !p.seen_count) return true; // new cards always "available"
  if (!p.due_at) return true;
  return new Date(p.due_at).getTime() <= at.getTime();
}

export function isLeech(p: ProgressLike | null | undefined): boolean {
  if (!p) return false;
  return (p.wrong_count ?? 0) >= LEECH_LAPSE_THRESHOLD && (p.mastery ?? 0) < 60;
}

/** Current recall probability (0-100) for a review card; null if not meaningful yet. */
export function cardRetention(p: ProgressLike | null | undefined, at: Date = new Date()): number | null {
  if (!p || !p.last_seen_at || !p.srs_ease_factor) return null;
  if ((p.srs_interval_minutes ?? 0) < 1440) return null; // learning cards: not meaningful
  const stability = p.srs_ease_factor;
  if (stability <= 0) return null;
  const elapsedDays = (at.getTime() - new Date(p.last_seen_at).getTime()) / (1000 * 60 * 60 * 24);
  const R = fsrsRetrievability(Math.max(elapsedDays, 0), stability);
  return Math.round(Math.max(0, Math.min(100, R * 100)));
}

/** Forecast of due review counts for the next `days` days (index 0 = today). */
export function forecastDueReviews(progressList: ProgressLike[], days = 7): number[] {
  const buckets = new Array(days).fill(0);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  for (const p of progressList) {
    if (!p.due_at || isCardMastered(p) || p.suspended) continue;
    const due = new Date(p.due_at);
    const dayDiff = Math.floor((due.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
    if (dayDiff < 0) buckets[0] += 1; // overdue → today
    else if (dayDiff < days) buckets[dayDiff] += 1;
  }
  return buckets;
}

export function formatIntervalLabel(intervalMinutes: number): string {
  return fsrsFormatInterval(intervalMinutes);
}

export function computeSrsUpdate(
  existing: Pick<SentenceProgress | DictionaryProgress, 'srs_interval_minutes' | 'srs_ease_factor' | 'mastery' | 'seen_count' | 'correct_count' | 'wrong_count'> | null,
  isCorrect: boolean
) {
  const now = new Date();
  let interval = existing?.srs_interval_minutes ?? 10;
  let easeFactor = existing?.srs_ease_factor ?? 2.5;

  if (existing) {
    if (isCorrect) {
      interval = Math.round(interval * easeFactor);
    } else {
      interval = 1;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
    }
  } else {
    interval = isCorrect ? 10 : 1;
    easeFactor = 2.5;
  }

  const mastery = isCorrect
    ? Math.min(100, (existing?.mastery ?? 0) + 10)
    : Math.max(0, (existing?.mastery ?? 0) - 15);

  return {
    seen_count: (existing?.seen_count ?? 0) + 1,
    correct_count: (existing?.correct_count ?? 0) + (isCorrect ? 1 : 0),
    wrong_count: (existing?.wrong_count ?? 0) + (isCorrect ? 0 : 1),
    last_seen_at: now.toISOString(),
    mastery,
    srs_interval_minutes: interval,
    srs_ease_factor: parseFloat(easeFactor.toFixed(2)),
    due_at: new Date(now.getTime() + interval * 60000).toISOString(),
  };
}
