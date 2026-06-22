import { describe, it, expect } from 'vitest';
import {
  computeFSRSUpdate, fsrsPreviewIntervals, classifyCardState, isCardDue,
  isLeech, cardRetention, forecastDueReviews, FSRSCardData,
} from '../utils';

function newCard(): FSRSCardData {
  return { seen_count: 0, correct_count: 0, wrong_count: 0, mastery: 0 };
}

describe('FSRS engine', () => {
  it('new card: Again keeps it in learning (short interval), Easy graduates to days', () => {
    const again = computeFSRSUpdate(newCard(), 1);
    const easy = computeFSRSUpdate(newCard(), 4);
    expect(again.srs_interval_minutes).toBeLessThan(60);
    expect(again.wrong_count).toBe(1);
    expect(easy.srs_interval_minutes).toBeGreaterThanOrEqual(1440); // >= 1 day
    expect(easy.correct_count).toBe(1);
  });

  it('intervals are monotonic across ratings for a new card', () => {
    const prev = fsrsPreviewIntervals(newCard());
    expect(prev[1]).toBeTruthy();
    const again = computeFSRSUpdate(newCard(), 1).srs_interval_minutes;
    const good = computeFSRSUpdate(newCard(), 3).srs_interval_minutes;
    const easy = computeFSRSUpdate(newCard(), 4).srs_interval_minutes;
    expect(again).toBeLessThanOrEqual(good);
    expect(good).toBeLessThanOrEqual(easy);
  });

  it('review card: Good grows stability and schedules further out than current', () => {
    const review: FSRSCardData = {
      seen_count: 5, correct_count: 5, wrong_count: 0, mastery: 60,
      srs_interval_minutes: 10 * 1440, srs_ease_factor: 10, difficulty: 5,
      last_seen_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    };
    const good = computeFSRSUpdate(review, 3);
    expect(good.srs_interval_minutes).toBeGreaterThan(review.srs_interval_minutes!);
    expect(good.srs_ease_factor).toBeGreaterThan(review.srs_ease_factor!);
  });

  it('review card: Again resets to short interval and lowers mastery', () => {
    const review: FSRSCardData = {
      seen_count: 5, correct_count: 5, wrong_count: 0, mastery: 60,
      srs_interval_minutes: 10 * 1440, srs_ease_factor: 10, difficulty: 5,
      last_seen_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    };
    const again = computeFSRSUpdate(review, 1);
    expect(again.srs_interval_minutes).toBeLessThan(1440);
    expect(again.mastery).toBeLessThan(60);
    expect(again.wrong_count).toBe(1);
  });

  it('classifyCardState distinguishes new/learning/young/mature/mastered', () => {
    expect(classifyCardState(null)).toBe('new');
    expect(classifyCardState({ seen_count: 1, srs_interval_minutes: 60 })).toBe('learning');
    expect(classifyCardState({ seen_count: 1, srs_interval_minutes: 5 * 1440 })).toBe('young');
    expect(classifyCardState({ seen_count: 1, srs_interval_minutes: 40 * 1440 })).toBe('mature');
    expect(classifyCardState({ seen_count: 1, mastery: 999999 })).toBe('mastered');
  });

  it('isCardDue / isLeech / cardRetention behave sensibly', () => {
    expect(isCardDue(null)).toBe(true);
    expect(isCardDue({ seen_count: 1, due_at: new Date(Date.now() + 3600000).toISOString() })).toBe(false);
    expect(isLeech({ wrong_count: 6, mastery: 20 })).toBe(true);
    expect(isLeech({ wrong_count: 1, mastery: 20 })).toBe(false);
    const ret = cardRetention({
      seen_count: 3, srs_interval_minutes: 10 * 1440, srs_ease_factor: 10,
      last_seen_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    });
    expect(ret).not.toBeNull();
    expect(ret!).toBeGreaterThanOrEqual(0);
    expect(ret!).toBeLessThanOrEqual(100);
  });

  it('forecastDueReviews buckets overdue into today', () => {
    const list = [
      { due_at: new Date(Date.now() - 86400000).toISOString(), seen_count: 1 },
      { due_at: new Date(Date.now() + 2 * 86400000).toISOString(), seen_count: 1 },
    ];
    const f = forecastDueReviews(list, 7);
    expect(f[0]).toBe(1); // overdue → today
    expect(f.reduce((a, b) => a + b, 0)).toBe(2);
  });
});
