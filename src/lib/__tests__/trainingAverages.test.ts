import { describe, expect, it } from 'vitest';
import { aggregateTrainingWeeks, hydrationMeanLabel, SELECTABLE_MUSCLE_GROUPS } from '../trainingAverages';
import { WorkoutLog } from '../../types';

const set = (extra = {}) => ({ setNumber: 1, weight: 50, reps: 8, rpe: 8, ...extra });
const log = (date: string, extra: Partial<WorkoutLog> = {}): WorkoutLog => ({
  id: `${date}-${Math.random()}`, date, unit: 'kg', durationMinutes: 60,
  recovery: { sleepHours: 7, nutritionCalories: 2000, hydrationLevel: 'Adequate', soreness: 4, motivation: 8 },
  exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [set()] }], ...extra,
});
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
};
const strengthLog = (
  id: string,
  date: string,
  exercises: WorkoutLog['exercises'],
  extra: Partial<WorkoutLog> = {},
): WorkoutLog => ({ id, date, unit: 'kg', durationMinutes: 60, exercises, ...extra });
const exercise = (name: string, weight: number, reps = 5, extra: Partial<WorkoutLog['exercises'][number]> = {}) => ({
  name, exerciseKey: name.toLowerCase().replaceAll(' ', '_'), muscleGroup: 'Pecs', modality: 'weighted' as const,
  sets: [set({ weight, reps, isCompleted: true })], ...extra,
});

describe('aggregateTrainingWeeks', () => {
  it('creates Monday-start 4W chronology with empty intervening weeks and rejects future/invalid dates', () => {
    const weeks = aggregateTrainingWeeks([log('2026-09-07'), log('2026-09-20'), log('2026-09-22'), log('bad')], { weeks: 4, now: new Date(2026, 8, 21, 12) });
    expect(weeks.map(w => w.weekStart)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
    expect(weeks.map(w => w.workouts)).toEqual([0, 1, 1, 0]);
    expect(weeks[3].isCurrentWeek).toBe(true);
  });

  it('moves by complete 4W and 12W windows', () => {
    expect(aggregateTrainingWeeks([], { weeks: 4, windowOffset: 1, now: new Date(2026, 8, 21) })[3].weekStart).toBe('2026-08-24');
    expect(aggregateTrainingWeeks([], { weeks: 12, windowOffset: 1, now: new Date(2026, 8, 21) })[11].weekStart).toBe('2026-06-29');
  });

  it('returns the current local week plus seven preceding weeks for 8W', () => {
    const weeks = aggregateTrainingWeeks([
      log('2026-08-03'),
      log('2026-09-21'),
      log('2026-09-23'),
    ], { weeks: 8, now: new Date(2026, 8, 22, 12) });
    expect(weeks).toHaveLength(8);
    expect(weeks.map(week => week.weekStart)).toEqual([
      '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24',
      '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21',
    ]);
    expect(weeks.map(week => week.workouts)).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
    expect(weeks[7].isCurrentWeek).toBe(true);
  });

  it('moves through non-overlapping 8W blocks without gaps', () => {
    const current = aggregateTrainingWeeks([], { weeks: 8, now: new Date(2026, 8, 22) });
    const previous = aggregateTrainingWeeks([], { weeks: 8, windowOffset: 1, now: new Date(2026, 8, 22) });
    const older = aggregateTrainingWeeks([], { weeks: 8, windowOffset: 2, now: new Date(2026, 8, 22) });
    expect(current[0].weekStart).toBe('2026-08-03');
    expect(previous[7].weekStart).toBe('2026-07-27');
    expect(previous[0].weekStart).toBe('2026-06-08');
    expect(older[7].weekStart).toBe('2026-06-01');
  });

  it('counts saved defaults and replacements while excluding missing durations and missing observations', () => {
    const result = aggregateTrainingWeeks([
      log('2026-09-21'),
      log('2026-09-21', { id: 'replacement', durationMinutes: 90, recovery: { sleepHours: 9, nutritionCalories: 0 } }),
      log('2026-09-21', { id: 'legacy', durationMinutes: undefined, recovery: {} }),
    ], { weeks: 4, now: new Date(2026, 8, 21) })[3];
    expect(result.workouts).toBe(3);
    expect(result.totalDurationMinutes).toBe(150);
    expect(result.durationCount).toBe(2);
    expect(result.averageDurationMinutes).toBe(75);
    expect(result.sleep).toEqual({ average: 8, count: 2 });
    expect(result.calories).toEqual({ average: 1000, count: 2 });
  });

  it('uses canonical working-set rules, excludes Conditioning, and reconciles Other', () => {
    const result = aggregateTrainingWeeks([log('2026-09-21', { exercises: [
      { name: 'Legs', muscleGroup: 'Hamstrings', sets: [set(), set({ isWarmup: true }), set({ isSkipped: true }), set({ isCompleted: false }), set({ reps: null })] },
      { name: 'Imported', muscleGroup: 'Adductors', sets: [set({ isCompleted: undefined, dropSubSets: [{ weight: 20, reps: 5 }] })] },
      { name: 'Run', muscleGroup: 'Conditioning', modality: 'distance', sets: [{ setNumber: 1, reps: 1, rpe: 10 }] },
    ] })], { weeks: 4, now: new Date(2026, 8, 21) })[3];
    expect(result.resistanceWorkingSets).toBe(2);
    expect(result.setsByMuscle.Hamstrings).toBe(1);
    expect(result.setsByMuscle.Other).toBe(1);
    expect(Object.values(result.setsByMuscle).reduce((a, b) => a + b, 0)).toBe(result.resistanceWorkingSets);
    expect(result.workingSetRpe).toEqual({ average: 8, count: 2 });
    expect(result.workouts).toBe(1);
    expect(result.totalDurationMinutes).toBe(60);
  });

  it('averages workout context, prefers hydration labels, and uses legacy thresholds', () => {
    const result = aggregateTrainingWeeks([
      log('2026-09-21', { recovery: { sleepHours: 6, nutritionCalories: 0, hydrationLevel: 'Optimal', hydrationLiters: 0.5, soreness: 2, motivation: 6 } }),
      log('2026-09-21', { recovery: { sleepHours: 8, nutritionCalories: 2400, hydrationLiters: 1.8, soreness: 6, motivation: 10 } }),
    ], { weeks: 4, now: new Date(2026, 8, 21) })[3];
    expect(result.sleep).toEqual({ average: 7, count: 2 });
    expect(result.calories).toEqual({ average: 1200, count: 2 });
    expect(result.hydration).toEqual({ average: 3, count: 2 });
    expect(result.soreness.average).toBe(4);
    expect(result.workoutQuality.average).toBe(8);
    expect(hydrationMeanLabel(1.49)).toBe('Dehydrated');
    expect(hydrationMeanLabel(1.5)).toBe('Under-hydrated');
    expect(hydrationMeanLabel(2.5)).toBe('Adequate');
    expect(hydrationMeanLabel(3.5)).toBe('Optimal');
  });

  it('does not mutate deep-frozen inputs and creates fresh output structures', () => {
    const inputs = freeze([log('2026-09-21')]);
    const first = aggregateTrainingWeeks(inputs, { weeks: 4, now: new Date(2026, 8, 21) });
    aggregateTrainingWeeks(inputs, { weeks: 8, now: new Date(2026, 8, 21) });
    aggregateTrainingWeeks(inputs, { weeks: 12, now: new Date(2026, 8, 21) });
    const second = aggregateTrainingWeeks(inputs, { weeks: 4, now: new Date(2026, 8, 21) });
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0].setsByMuscle).not.toBe(second[0].setsByMuscle);
  });

  it('documents the exact custom-exercise selectable muscle list', () => {
    expect(SELECTABLE_MUSCLE_GROUPS).toEqual(['Delts', 'Traps', 'Biceps', 'Triceps', 'Pecs', 'Back', 'Abs', 'Quads', 'Hamstrings', 'Calves', 'Glutes', 'Forearms', 'Conditioning']);
  });

  describe('weekly e1RM PR events', () => {
    it('uses history before the visible block as the baseline and counts a genuine improvement', () => {
      const result = aggregateTrainingWeeks([
        strengthLog('baseline', '2026-07-01', [exercise('Bench', 100)]),
        strengthLog('improvement', '2026-09-07', [exercise('Bench', 105)]),
      ], { weeks: 4, now: new Date(2026, 8, 22) });
      expect(result.find(week => week.weekStart === '2026-09-07')?.e1rmPRs).toBe(1);
    });

    it('counts at most one event per exercise in a workout and separate exercises independently', () => {
      const result = aggregateTrainingWeeks([strengthLog('log', '2026-09-21', [
        exercise('Bench', 100, 5, { sets: [set({ weight: 100, reps: 5 }), set({ setNumber: 2, weight: 110, reps: 5 })] }),
        exercise('Squat', 140),
      ])], { weeks: 4, now: new Date(2026, 8, 22) });
      expect(result[3].e1rmPRs).toBe(2);
    });

    it('counts two genuine improvements by the same exercise in separate same-week workouts', () => {
      const result = aggregateTrainingWeeks([
        strengthLog('log-1700000000000', '2026-09-21', [exercise('Bench', 100)]),
        strengthLog('log-1700000001000', '2026-09-22', [exercise('Bench', 105)]),
      ], { weeks: 4, now: new Date(2026, 8, 22, 12) });
      expect(result[3].e1rmPRs).toBe(2);
    });

    it('does not count equal or worse performances but treats the first qualifying performance as a PR', () => {
      const result = aggregateTrainingWeeks([
        strengthLog('first', '2026-09-07', [exercise('Bench', 100)]),
        strengthLog('equal', '2026-09-14', [exercise('Bench', 100)]),
        strengthLog('worse', '2026-09-21', [exercise('Bench', 90)]),
      ], { weeks: 4, now: new Date(2026, 8, 22) });
      expect(result.map(week => week.e1rmPRs)).toEqual([0, 1, 0, 0]);
    });

    it('excludes warm-up, skipped, incomplete, invalid, skipped-exercise and non-mass sets', () => {
      const invalidSets = [
        set({ weight: 500, isWarmup: true }), set({ weight: 500, isSkipped: true }),
        set({ weight: 500, isCompleted: false }), set({ weight: Number.NaN }), set({ reps: 0 }),
      ];
      const result = aggregateTrainingWeeks([strengthLog('invalids', '2026-09-21', [
        exercise('Bench', 100, 5, { sets: invalidSets }),
        exercise('Squat', 200, 5, { isSkipped: true }),
        exercise('Run', 1, 5, { modality: 'distance' }),
      ])], { weeks: 4, now: new Date(2026, 8, 22) });
      expect(result[3].workouts).toBe(1);
      expect(result[3].e1rmPRs).toBe(0);
    });

    it('uses canonical bodyweight and assisted effective loads while excluding non-mass modalities', () => {
      const result = aggregateTrainingWeeks([strengthLog('modalities', '2026-09-21', [
        exercise('Pull Up', 0, 8, { modality: 'bodyweight' }),
        exercise('Assisted Dip', 20, 8, { modality: 'assisted' }),
        exercise('Run', 1, 8, { modality: 'distance' }),
        exercise('Plank', 1, 8, { modality: 'timed' }),
      ], { bodyweightSnapshot: { value: 80, unit: 'kg' } })], { weeks: 4, now: new Date(2026, 8, 22) });
      expect(result[3].e1rmPRs).toBe(2);
    });

    it('includes programmed and one-off workouts and ignores future and invalid dates', () => {
      const result = aggregateTrainingWeeks([
        strengthLog('programmed', '2026-09-21', [exercise('Bench', 100)], { programId: 'p1' }),
        strengthLog('one-off', '2026-09-22', [exercise('Squat', 140)]),
        strengthLog('future', '2026-09-23', [exercise('Deadlift', 200)]),
        strengthLog('invalid', 'not-a-date', [exercise('Press', 80)]),
      ], { weeks: 4, now: new Date(2026, 8, 22, 12) });
      expect(result[3].e1rmPRs).toBe(2);
    });

    it('is deterministic for unsorted dates and orders same-date epoch IDs before legacy fallback order', () => {
      const early = strengthLog('log-1700000000000', '2026-09-21', [exercise('Bench', 100)]);
      const late = strengthLog('log-1700000009000', '2026-09-21', [exercise('Bench', 90)]);
      const nextDay = strengthLog('next', '2026-09-22', [exercise('Bench', 105)]);
      const sorted = aggregateTrainingWeeks([early, late, nextDay], { weeks: 4, now: new Date(2026, 8, 22, 12) });
      const unsorted = aggregateTrainingWeeks([nextDay, late, early], { weeks: 4, now: new Date(2026, 8, 22, 12) });
      expect(sorted[3].e1rmPRs).toBe(2);
      expect(unsorted[3].e1rmPRs).toBe(2);

      const legacyHigh = strengthLog('legacy-first', '2026-09-21', [exercise('Squat', 110)]);
      const legacyLow = strengthLog('legacy-second', '2026-09-21', [exercise('Squat', 100)]);
      expect(aggregateTrainingWeeks([legacyHigh, legacyLow], { weeks: 4, now: new Date(2026, 8, 22) })[3].e1rmPRs).toBe(1);
    });

    it('keeps explicit exercise identities separate even when display names match', () => {
      const first = exercise('Press', 100, 5, { exerciseKey: 'custom_press_a' });
      const second = exercise('Press', 90, 5, { exerciseKey: 'custom_press_b' });
      const result = aggregateTrainingWeeks([strengthLog('identities', '2026-09-21', [first, second])], { weeks: 4, now: new Date(2026, 8, 22) });
      expect(result[3].e1rmPRs).toBe(2);
    });

    it('returns zero for active weeks, preserves empty weeks, and assigns events consistently across ranges', () => {
      const logs = [
        strengthLog('baseline', '2026-08-01', [exercise('Bench', 100)]),
        strengthLog('no-pr', '2026-09-14', [exercise('Bench', 90)]),
        strengthLog('pr', '2026-09-21', [exercise('Bench', 110)]),
      ];
      for (const weeks of [4, 8, 12] as const) {
        const result = aggregateTrainingWeeks(logs, { weeks, now: new Date(2026, 8, 22) });
        expect(result.find(week => week.weekStart === '2026-09-14')?.e1rmPRs).toBe(0);
        expect(result.find(week => week.weekStart === '2026-09-21')?.e1rmPRs).toBe(1);
        expect(result.find(week => week.weekStart === '2026-09-07')?.workouts).toBe(0);
      }
    });
  });
});
