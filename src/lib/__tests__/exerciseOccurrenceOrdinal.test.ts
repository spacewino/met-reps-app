import { describe, it, expect } from 'vitest';
import {
  getExerciseOccurrenceOrdinal,
  normalizeExerciseName,
  calculateObjectiveSets,
  calculateAddedSetTarget,
  resolveContextualPrescriptionBaselineE1RM,
} from '../objectiveMath';
import { WorkoutLog, ExerciseEntry } from '../../types';

describe('Exercise Occurrence Ordinal & Contextual Duplicate Baseline Isolation', () => {
  describe('Pure Helper Unit Tests', () => {
    it('returns ordinal 0 for a single exercise', () => {
      const exercises = [{ name: 'Bench Press' }];
      expect(getExerciseOccurrenceOrdinal(exercises, 0)).toBe(0);
    });

    it('returns ordinals 0 and 1 for two adjacent identical exercise names', () => {
      const exercises = [
        { name: 'Cable Lateral Raise' },
        { name: 'Cable Lateral Raise' },
      ];
      expect(getExerciseOccurrenceOrdinal(exercises, 0)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 1)).toBe(1);
    });

    it('returns ordinals 0 and 1 for repeated names separated by other exercises', () => {
      const exercises = [
        { name: 'Cable Lateral Raise' },
        { name: 'Bench Press' },
        { name: 'Cable Lateral Raise' },
      ];
      expect(getExerciseOccurrenceOrdinal(exercises, 0)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 1)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 2)).toBe(1);
    });

    it('returns ordinals 0, 1, and 2 for three repeated names', () => {
      const exercises = [
        { name: 'Cable Lateral Raise' },
        { name: 'Bench Press' },
        { name: 'Cable Lateral Raise' },
        { name: 'Squat' },
        { name: 'Cable Lateral Raise' },
      ];
      expect(getExerciseOccurrenceOrdinal(exercises, 0)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 1)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 2)).toBe(1);
      expect(getExerciseOccurrenceOrdinal(exercises, 3)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 4)).toBe(2);
    });

    it('performs case-insensitive matching correctly', () => {
      const exercises = [
        { name: 'Cable Lateral Raise' },
        { name: 'cable lateral raise' },
        { name: 'CABLE LATERAL RAISE' },
      ];
      expect(getExerciseOccurrenceOrdinal(exercises, 0)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 1)).toBe(1);
      expect(getExerciseOccurrenceOrdinal(exercises, 2)).toBe(2);
    });

    it('handles leading and trailing whitespace normalization', () => {
      const exercises = [
        { name: '  Cable Lateral Raise ' },
        { name: 'Cable Lateral Raise\t' },
        { name: '\nCable Lateral Raise' },
      ];
      expect(getExerciseOccurrenceOrdinal(exercises, 0)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 1)).toBe(1);
      expect(getExerciseOccurrenceOrdinal(exercises, 2)).toBe(2);
    });

    it('keeps similar but different names strictly separate', () => {
      const exercises = [
        { name: 'Cable Lateral Raise' },
        { name: 'DB Lateral Raise' },
        { name: 'Cable Lateral Raise Single Arm' },
        { name: 'Cable Lateral Raise' },
      ];
      expect(getExerciseOccurrenceOrdinal(exercises, 0)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 1)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 2)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(exercises, 3)).toBe(1);
    });

    it('fails safely without throwing on invalid indices or empty/null input', () => {
      expect(getExerciseOccurrenceOrdinal(null, 0)).toBe(0);
      expect(getExerciseOccurrenceOrdinal(undefined, 0)).toBe(0);
      expect(getExerciseOccurrenceOrdinal([], 0)).toBe(0);
      expect(getExerciseOccurrenceOrdinal([{ name: 'Squat' }], -1)).toBe(0);
      expect(getExerciseOccurrenceOrdinal([{ name: 'Squat' }], 5)).toBe(0);
      expect(getExerciseOccurrenceOrdinal([{ name: '' }], 0)).toBe(0);
    });

    it('does not mutate input arrays or exercise entries', () => {
      const exercises = Object.freeze([
        Object.freeze({ name: 'Cable Lateral Raise' }),
        Object.freeze({ name: 'Cable Lateral Raise' }),
      ]);
      expect(() => getExerciseOccurrenceOrdinal(exercises as any, 1)).not.toThrow();
      expect(getExerciseOccurrenceOrdinal(exercises as any, 1)).toBe(1);
    });
  });

  describe('Duplicate Exercise Contextual Baseline Isolation (50 KG vs 80 KG Fixture)', () => {
    const historicalLogs: WorkoutLog[] = [
      {
        id: 'log-w1-d1',
        date: '2026-08-01',
        unit: 'kg',
        programId: 'prog-alpha',
        week: '1',
        day: '1',
        exercises: [
          {
            name: 'Cable Lateral Raise',
            muscleGroup: 'Delts',
            sets: [
              { setNumber: 1, weight: 50, reps: 1, rpe: 10, isWarmup: false, isCompleted: true },
            ],
          },
          {
            name: 'Cable Lateral Raise',
            muscleGroup: 'Delts',
            sets: [
              { setNumber: 1, weight: 80, reps: 1, rpe: 10, isWarmup: false, isCompleted: true },
            ],
          },
        ],
      },
    ];

    it('resolves distinct baselines when queried with distinct occurrence ordinals', () => {
      const baseline0 = resolveContextualPrescriptionBaselineE1RM(
        'Cable Lateral Raise',
        2,
        historicalLogs,
        {
          programId: 'prog-alpha',
          targetDay: 1,
          occurrenceOrdinal: 0,
        }
      );

      const baseline1 = resolveContextualPrescriptionBaselineE1RM(
        'Cable Lateral Raise',
        2,
        historicalLogs,
        {
          programId: 'prog-alpha',
          targetDay: 1,
          occurrenceOrdinal: 1,
        }
      );

      expect(baseline0).toBe(50);
      expect(baseline1).toBe(80);
    });

    it('initializes template prefill mapping with distinct ordinals and distinct targets', () => {
      const prefilledExercises: ExerciseEntry[] = [
        {
          name: 'Cable Lateral Raise',
          muscleGroup: 'Delts',
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0 }],
        },
        {
          name: 'Cable Lateral Raise',
          muscleGroup: 'Delts',
          sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0 }],
        },
      ];

      // Replicating WorkoutLogger template-prefill initialization mapping
      const initialized = prefilledExercises.map((ex, exIdx) => {
        const occurrenceOrdinal = getExerciseOccurrenceOrdinal(prefilledExercises, exIdx);
        const calculated = calculateObjectiveSets({
          objective: 'Hypertrophy',
          exercise: ex,
          exerciseIndex: exIdx,
          totalExercises: prefilledExercises.length,
          weekNum: 2,
          previousLogs: historicalLogs,
          userTouchedSets: {},
          checkedSets: {},
          algorithmId: 'hypertrophy_linear',
          bodyweightSnapshot: null,
          activeUnit: 'kg',
          programId: 'prog-alpha',
          dayNum: 1,
          targetDate: '2026-08-08',
          occurrenceOrdinal,
        });
        return { ...ex, sets: calculated };
      });

      expect(initialized[0].sets[0].weight).toBe(30); // 50 kg baseline -> 30 kg target
      expect(initialized[1].sets[0].weight).toBe(50); // 80 kg baseline -> 50 kg target (80 * 0.618 ≈ 49.44 -> 50)
      expect(initialized[0].sets[0].weight).not.toBe(initialized[1].sets[0].weight);
    });

    it('calculates added set target with ordinal 1 for second occurrence', () => {
      const activeExercises: ExerciseEntry[] = [
        {
          name: 'Cable Lateral Raise',
          muscleGroup: 'Delts',
          sets: [{ setNumber: 1, weight: 30, reps: 12, rpe: 8 }],
        },
        {
          name: 'Cable Lateral Raise',
          muscleGroup: 'Delts',
          sets: [{ setNumber: 1, weight: 50, reps: 12, rpe: 8 }],
        },
      ];

      // Add Set for occurrence 0 (index 0)
      const addedSet0Ordinal = getExerciseOccurrenceOrdinal(activeExercises, 0);
      const addedTarget0 = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: activeExercises[0],
        weekNum: 2,
        previousLogs: historicalLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: null,
        activeUnit: 'kg',
        programId: 'prog-alpha',
        dayNum: 1,
        targetDate: '2026-08-08',
        occurrenceOrdinal: addedSet0Ordinal,
      });

      // Add Set for occurrence 1 (index 1)
      const addedSet1Ordinal = getExerciseOccurrenceOrdinal(activeExercises, 1);
      const addedTarget1 = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: activeExercises[1],
        weekNum: 2,
        previousLogs: historicalLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: null,
        activeUnit: 'kg',
        programId: 'prog-alpha',
        dayNum: 1,
        targetDate: '2026-08-08',
        occurrenceOrdinal: addedSet1Ordinal,
      });

      expect(addedSet0Ordinal).toBe(0);
      expect(addedSet1Ordinal).toBe(1);
      expect(addedTarget0.target?.weight).toBe(30);
      expect(addedTarget1.target?.weight).toBe(50);
    });
  });

  describe('Preservation of Single Occurrence & Contextual Regression Fixtures', () => {
    it('preserves single-occurrence Week 3 Gym80 Lateral Raise regression fixture', () => {
      const regressionLogs: WorkoutLog[] = [
        {
          id: 'log-w1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'prog-1',
          week: '1',
          day: '2',
          exercises: [
            {
              name: 'Gym80 Lateral Raise Pin Machine',
              muscleGroup: 'Delts',
              sets: [{ setNumber: 1, weight: 52.5, reps: 15, rpe: 8, isWarmup: false }],
            },
          ],
        },
        {
          id: 'log-w2',
          date: '2026-08-08',
          unit: 'kg',
          programId: 'prog-1',
          week: '2',
          day: '2',
          exercises: [
            {
              name: 'Gym80 Lateral Raise Pin Machine',
              muscleGroup: 'Delts',
              sets: [
                { setNumber: 1, weight: 50, reps: 12, rpe: 10, isWarmup: false },
                { setNumber: 2, weight: 50, reps: 10, rpe: 10, isWarmup: false },
                { setNumber: 3, weight: 45, reps: 12, rpe: 8, isWarmup: false },
              ],
            },
          ],
        },
      ];

      const baseline = resolveContextualPrescriptionBaselineE1RM(
        'Gym80 Lateral Raise Pin Machine',
        3,
        regressionLogs,
        {
          programId: 'prog-1',
          targetDay: 2,
          targetDate: '2026-08-15',
          occurrenceOrdinal: 0,
        }
      );

      expect(baseline).toBeCloseTo(75.681185, 4);

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercise: {
          name: 'Gym80 Lateral Raise Pin Machine',
          muscleGroup: 'Delts',
          sets: [
            { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
            { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
            { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
          ],
        },
        weekNum: 3,
        previousLogs: regressionLogs,
        programId: 'prog-1',
        dayNum: 2,
        occurrenceOrdinal: 0,
        targetDate: '2026-08-15',
      });

      expect(sets).toEqual([
        { setNumber: 1, weight: 45, reps: 15, rpe: 8 },
        { setNumber: 2, weight: 45, reps: 13, rpe: 8.5 },
        { setNumber: 3, weight: 45, reps: 13, rpe: 9 },
      ]);
    });
  });
});
