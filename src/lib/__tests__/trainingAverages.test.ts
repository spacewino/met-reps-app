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
    const second = aggregateTrainingWeeks(inputs, { weeks: 4, now: new Date(2026, 8, 21) });
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0].setsByMuscle).not.toBe(second[0].setsByMuscle);
  });

  it('documents the exact custom-exercise selectable muscle list', () => {
    expect(SELECTABLE_MUSCLE_GROUPS).toEqual(['Delts', 'Traps', 'Biceps', 'Triceps', 'Pecs', 'Back', 'Abs', 'Quads', 'Hamstrings', 'Calves', 'Glutes', 'Forearms', 'Conditioning']);
  });
});
