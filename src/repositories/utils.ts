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
