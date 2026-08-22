import { describe, it, expect } from 'vitest';
import {
  resolveContextualPrescriptionBaselineE1RM,
  extractExposureSessionCapacity,
  calculateMedian,
  calculateObjectiveSets,
  calculateAddedSetTarget,
} from '../objectiveMath';
import { WorkoutLog, ExerciseEntry } from '../../types';

describe('Contextual Prescription Baseline Resolver', () => {
  describe('extractExposureSessionCapacity', () => {
    it('returns null for skipped exercises', () => {
      const ex: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        isSkipped: true,
        sets: [{ setNumber: 1, weight: 100, reps: 5, rpe: 8 }],
      };
      const log: WorkoutLog = {
        id: '1',
        date: '2026-08-01',
        unit: 'kg',
        exercises: [ex],
      };
      expect(extractExposureSessionCapacity(ex, log)).toBeNull();
    });

    it('returns null for exercises with no sets', () => {
      const ex: ExerciseEntry = { name: 'Bench Press', muscleGroup: 'Chest', sets: [] };
      const log: WorkoutLog = { id: '1', date: '2026-08-01', unit: 'kg', exercises: [ex] };
      expect(extractExposureSessionCapacity(ex, log)).toBeNull();
    });

    it('excludes warmup sets from session capacity', () => {
      const ex: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        sets: [
          { setNumber: 1, weight: 60, reps: 5, rpe: 5, isWarmup: true },
          { setNumber: 2, weight: 100, reps: 5, rpe: 8, isWarmup: false },
        ],
      };
      const log: WorkoutLog = { id: '1', date: '2026-08-01', unit: 'kg', exercises: [ex] };
      const capacity = extractExposureSessionCapacity(ex, log);
      // 5 reps @ 8 RPE: 100 / 0.807 = 123.9157...
      expect(capacity).toBeCloseTo(100 / 0.807, 2);
    });

    it('stops processing on first skipped working set', () => {
      const ex: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        sets: [
          { setNumber: 1, weight: 100, reps: 5, rpe: 8, isWarmup: false },
          { setNumber: 2, weight: 100, reps: 5, rpe: 8, isWarmup: false, isSkipped: true },
          { setNumber: 3, weight: 120, reps: 5, rpe: 8, isWarmup: false }, // should be ignored
        ],
      };
      const log: WorkoutLog = { id: '1', date: '2026-08-01', unit: 'kg', exercises: [ex] };
      const capacity = extractExposureSessionCapacity(ex, log);
      expect(capacity).toBeCloseTo(100 / 0.807, 2);
    });

    it('finds maximum valid working-set e1RM across working sets', () => {
      const ex: ExerciseEntry = {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        sets: [
          { setNumber: 1, weight: 100, reps: 8, rpe: 8, isWarmup: false }, // 100 / 0.728 = 137.36
          { setNumber: 2, weight: 105, reps: 8, rpe: 8.5, isWarmup: false }, // 105 / 0.743 = 141.32
          { setNumber: 3, weight: 95, reps: 8, rpe: 10, isWarmup: false }, // 95 / 0.771 = 123.21
        ],
      };
      const log: WorkoutLog = { id: '1', date: '2026-08-01', unit: 'kg', exercises: [ex] };
      const capacity = extractExposureSessionCapacity(ex, log);
      expect(capacity).toBeCloseTo(105 / 0.743, 2);
    });

    it('accounts for strict and loose form ratings in e1RM calculation', () => {
      const exStrict: ExerciseEntry = {
        name: 'Barbell Curl',
        muscleGroup: 'Biceps',
        sets: [{ setNumber: 1, weight: 40, reps: 8, rpe: 8, form: 'strict', isWarmup: false }],
      };
      const logStrict: WorkoutLog = { id: '1', date: '2026-08-01', unit: 'kg', exercises: [exStrict] };
      const strictCap = extractExposureSessionCapacity(exStrict, logStrict);

      const exLoose: ExerciseEntry = {
        name: 'Barbell Curl',
        muscleGroup: 'Biceps',
        sets: [{ setNumber: 1, weight: 40, reps: 8, rpe: 8, form: 'loose', isWarmup: false }],
      };
      const logLoose: WorkoutLog = { id: '2', date: '2026-08-01', unit: 'kg', exercises: [exLoose] };
      const looseCap = extractExposureSessionCapacity(exLoose, logLoose);

      // Strict form produces valid capacity, loose form is bypassed by progression evidence rules
      expect(strictCap).not.toBeNull();
      expect(looseCap).toBeNull();
    });
  });

  describe('calculateMedian', () => {
    it('returns 0 for empty array', () => {
      expect(calculateMedian([])).toBe(0);
    });

    it('returns single element for length 1', () => {
      expect(calculateMedian([42])).toBe(42);
    });

    it('returns average of two elements for length 2', () => {
      expect(calculateMedian([10, 20])).toBe(15);
    });

    it('returns middle element for odd length', () => {
      expect(calculateMedian([50, 10, 30])).toBe(30);
    });

    it('returns average of two middle elements for even length', () => {
      expect(calculateMedian([40, 10, 30, 20])).toBe(25);
    });
  });

  describe('Tier 1: Same program, same day (weeks < targetWeek)', () => {
    it('uses single earlier exposure directly if only 1 week exists', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Barbell Squat',
              muscleGroup: 'Quads',
              sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8 }],
            },
          ],
        },
      ];

      // Week 2 Day 1
      const baseline = resolveContextualPrescriptionBaselineE1RM('Barbell Squat', 2, logs, {
        programId: 'hypertrophy-1',
        targetDay: 1,
      });

      expect(baseline).toBeCloseTo(100 / 0.728, 3);
    });

    it('blends 0.75 * previous + 0.25 * median when multiple earlier weeks exist', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Barbell Squat',
              muscleGroup: 'Quads',
              sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8 }],
            },
          ],
        },
        {
          id: 'log-2',
          date: '2026-08-08',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '2',
          day: '1',
          exercises: [
            {
              name: 'Barbell Squat',
              muscleGroup: 'Quads',
              sets: [{ setNumber: 1, weight: 110, reps: 8, rpe: 8 }],
            },
          ],
        },
      ];

      // Week 3 Day 1
      const baseline = resolveContextualPrescriptionBaselineE1RM('Barbell Squat', 3, logs, {
        programId: 'hypertrophy-1',
        targetDay: 1,
      });

      const cap1 = 100 / 0.728;
      const cap2 = 110 / 0.728;
      const median = (cap1 + cap2) / 2;
      const expected = 0.75 * cap2 + 0.25 * median;

      expect(baseline).toBeCloseTo(expected, 4);
    });

    it('strictly excludes logs where week >= targetWeek', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Barbell Squat',
              muscleGroup: 'Quads',
              sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8 }],
            },
          ],
        },
        {
          id: 'log-future',
          date: '2026-08-15',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '3',
          day: '1',
          exercises: [
            {
              name: 'Barbell Squat',
              muscleGroup: 'Quads',
              sets: [{ setNumber: 1, weight: 200, reps: 8, rpe: 8 }],
            },
          ],
        },
      ];

      // Generating for Week 2
      const baseline = resolveContextualPrescriptionBaselineE1RM('Barbell Squat', 2, logs, {
        programId: 'hypertrophy-1',
        targetDay: 1,
      });

      // Must only use Week 1, ignoring Week 3
      expect(baseline).toBeCloseTo(100 / 0.728, 3);
    });

    it('handles multiple occurrences of same exercise on the same day using occurrenceOrdinal', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Barbell Curl', // Occurrence 0 (Heavy)
              muscleGroup: 'Biceps',
              sets: [{ setNumber: 1, weight: 40, reps: 8, rpe: 8 }],
            },
            {
              name: 'Triceps Extension',
              muscleGroup: 'Triceps',
              sets: [{ setNumber: 1, weight: 30, reps: 10, rpe: 8 }],
            },
            {
              name: 'Barbell Curl', // Occurrence 1 (Burnout / Light)
              muscleGroup: 'Biceps',
              sets: [{ setNumber: 1, weight: 25, reps: 15, rpe: 8 }],
            },
          ],
        },
      ];

      // Week 2 Day 1, Occurrence 0
      const baseline0 = resolveContextualPrescriptionBaselineE1RM('Barbell Curl', 2, logs, {
        programId: 'hypertrophy-1',
        targetDay: 1,
        occurrenceOrdinal: 0,
      });
      expect(baseline0).toBeCloseTo(40 / 0.728, 3);

      // Week 2 Day 1, Occurrence 1
      const baseline1 = resolveContextualPrescriptionBaselineE1RM('Barbell Curl', 2, logs, {
        programId: 'hypertrophy-1',
        targetDay: 1,
        occurrenceOrdinal: 1,
      });
      // 15 reps @ 8 RPE: 0.618 * (44 / 47) = 0.57855319...
      expect(baseline1).toBeCloseTo(25 / (0.618 * (44 / 47)), 3);
    });

    it('handles gaps/skipped weeks gracefully (e.g. Week 1 present, Week 2 skipped, generating Week 3)', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Barbell Squat',
              muscleGroup: 'Quads',
              sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8 }],
            },
          ],
        },
      ];

      // Generating Week 3 directly
      const baseline = resolveContextualPrescriptionBaselineE1RM('Barbell Squat', 3, logs, {
        programId: 'hypertrophy-1',
        targetDay: 1,
      });

      // Uses Week 1 as the only prior exposure
      expect(baseline).toBeCloseTo(100 / 0.728, 3);
    });
  });

  describe('Tier 2: Same program, day-agnostic fallback', () => {
    it('falls back to earlier weeks of other days in the same program if day match does not exist', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '1',
          day: '2', // Day 2
          exercises: [
            {
              name: 'Overhead Press',
              muscleGroup: 'Delts',
              sets: [{ setNumber: 1, weight: 50, reps: 8, rpe: 8 }],
            },
          ],
        },
      ];

      // Week 2 Day 4 (exercise was on Day 2 in Week 1)
      const baseline = resolveContextualPrescriptionBaselineE1RM('Overhead Press', 2, logs, {
        programId: 'hypertrophy-1',
        targetDay: 4,
      });

      expect(baseline).toBeCloseTo(50 / 0.728, 3);
    });

    it('blends multiple prior weeks across days when falling back to Tier 2', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Dumbbell Bench',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 30, reps: 8, rpe: 8 }],
            },
          ],
        },
        {
          id: 'log-2',
          date: '2026-08-08',
          unit: 'kg',
          programId: 'hypertrophy-1',
          week: '2',
          day: '3',
          exercises: [
            {
              name: 'Dumbbell Bench',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 32.5, reps: 8, rpe: 8 }],
            },
          ],
        },
      ];

      // Week 3 Day 5 (new day)
      const baseline = resolveContextualPrescriptionBaselineE1RM('Dumbbell Bench', 3, logs, {
        programId: 'hypertrophy-1',
        targetDay: 5,
      });

      const cap1 = 30 / 0.728;
      const cap2 = 32.5 / 0.728;
      const median = (cap1 + cap2) / 2;
      const expected = 0.75 * cap2 + 0.25 * median;

      expect(baseline).toBeCloseTo(expected, 4);
    });
  });

  describe('Tier 3: Cross-program bootstrap', () => {
    it('uses median of up to 3 most recent sessions from earlier programs', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-old-1',
          date: '2026-06-01',
          unit: 'kg',
          programId: 'old-prog',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 90, reps: 8, rpe: 8 }], // 90 / 0.728 = 123.626
            },
          ],
        },
        {
          id: 'log-old-2',
          date: '2026-06-08',
          unit: 'kg',
          programId: 'old-prog',
          week: '2',
          day: '1',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8 }], // 100 / 0.728 = 137.3626
            },
          ],
        },
        {
          id: 'log-old-3',
          date: '2026-06-15',
          unit: 'kg',
          programId: 'old-prog',
          week: '3',
          day: '1',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 95, reps: 8, rpe: 8 }], // 95 / 0.728 = 130.4945
            },
          ],
        },
      ];

      // Starting new program 'new-prog' at Week 1 Day 1
      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, logs, {
        programId: 'new-prog',
        targetDay: 1,
        targetDate: '2026-07-01',
      });

      // The 3 capacities are 123.626, 137.3626, 130.4945.
      // Median is 130.4945 (95 / 0.728).
      expect(baseline).toBeCloseTo(95 / 0.728, 3);
    });

    it('ignores older PR spikes in favor of 3 most recent sessions', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-ancient-pr',
          date: '2025-01-01',
          unit: 'kg',
          programId: 'ancient-prog',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 150, reps: 1, rpe: 10 }], // e1RM = 150 (ancient PR)
            },
          ],
        },
        {
          id: 'log-recent-1',
          date: '2026-06-01',
          unit: 'kg',
          programId: 'recent-prog',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 90, reps: 8, rpe: 8 }],
            },
          ],
        },
        {
          id: 'log-recent-2',
          date: '2026-06-08',
          unit: 'kg',
          programId: 'recent-prog',
          week: '2',
          day: '1',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 92.5, reps: 8, rpe: 8 }],
            },
          ],
        },
        {
          id: 'log-recent-3',
          date: '2026-06-15',
          unit: 'kg',
          programId: 'recent-prog',
          week: '3',
          day: '1',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 95, reps: 8, rpe: 8 }],
            },
          ],
        },
      ];

      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, logs, {
        programId: 'brand-new-prog',
        targetDay: 1,
        targetDate: '2026-07-01',
      });

      // The 3 most recent are 90, 92.5, 95 (all 8 @ 8). Median is 92.5 / 0.728.
      expect(baseline).toBeCloseTo(92.5 / 0.728, 3);
    });
  });

  describe('Tier 4: Fallback to 0', () => {
    it('returns 0 if no matching history exists', () => {
      const baseline = resolveContextualPrescriptionBaselineE1RM('Unknown Movement', 1, [], {
        programId: 'p1',
        targetDay: 1,
      });
      expect(baseline).toBe(0);
    });
  });

  describe('Pure Function / Zero-Mutation Guarantee', () => {
    it('never mutates input logs or input objects', () => {
      const originalLogs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'p1',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Quads',
              sets: [{ setNumber: 1, weight: 100, reps: 5, rpe: 8 }],
            },
          ],
        },
      ];

      const serializedBefore = JSON.stringify(originalLogs);
      resolveContextualPrescriptionBaselineE1RM('Squat', 2, originalLogs, {
        programId: 'p1',
        targetDay: 1,
      });
      const serializedAfter = JSON.stringify(originalLogs);

      expect(serializedBefore).toBe(serializedAfter);
    });
  });

  describe('Technogym Shoulder Press & Gym80 Lateral Raise Realistic Evidence Fixtures', () => {
    it('resolves Technogym Shoulder Press Week 3 baseline from current-program Week 2 without PR distortion', () => {
      const logs: WorkoutLog[] = [
        // Old program PR
        {
          id: 'old-log',
          date: '2026-05-01',
          unit: 'kg',
          programId: 'old-prog',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Technogym Shoulder Press',
              muscleGroup: 'Delts',
              sets: [{ setNumber: 1, weight: 45, reps: 7, rpe: 10 }], // 45 / 0.807 = ~55.76 kg e1RM
            },
          ],
        },
        // Current program Week 1
        {
          id: 'curr-w1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'curr-prog',
          week: '1',
          day: '2',
          exercises: [
            {
              name: 'Technogym Shoulder Press',
              muscleGroup: 'Delts',
              sets: [{ setNumber: 1, weight: 32.5, reps: 8, rpe: 8 }], // 32.5 / 0.728 = 44.64 kg
            },
          ],
        },
        // Current program Week 2
        {
          id: 'curr-w2',
          date: '2026-08-08',
          unit: 'kg',
          programId: 'curr-prog',
          week: '2',
          day: '2',
          exercises: [
            {
              name: 'Technogym Shoulder Press',
              muscleGroup: 'Delts',
              sets: [
                { setNumber: 1, weight: 15, reps: 8, rpe: 4, isWarmup: true },
                { setNumber: 2, weight: 25, reps: 6, rpe: 6, isWarmup: true },
                { setNumber: 3, weight: 30, reps: 3, rpe: 7, isWarmup: true },
                { setNumber: 4, weight: 35, reps: 8, rpe: 8, isWarmup: false }, // 35 / 0.728 = 48.077 kg
                { setNumber: 5, weight: 35, reps: 8, rpe: 8.5, isWarmup: false },
                { setNumber: 6, weight: 35, reps: 8, rpe: 10, isWarmup: false },
                { setNumber: 7, weight: 25, reps: 8, rpe: 10, isWarmup: false },
              ],
            },
          ],
        },
      ];

      // Week 3 Day 2 resolution
      const baseline = resolveContextualPrescriptionBaselineE1RM(
        'Technogym Shoulder Press',
        3,
        logs,
        {
          programId: 'curr-prog',
          targetDay: 2,
        }
      );

      const cap1 = 32.5 / 0.728;
      const cap2 = 35 / 0.728;
      const median = (cap1 + cap2) / 2;
      const expectedBaseline = 0.75 * cap2 + 0.25 * median;

      expect(baseline).toBeCloseTo(expectedBaseline, 3);

      // Verify calculateObjectiveSets targets for Wave Volume (Hypertrophy Linear) Week 3 (odd week: 12 reps @ 8 RPE for compound)
      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercise: {
          name: 'Technogym Shoulder Press',
          muscleGroup: 'Delts',
          sets: [
            { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
            { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
            { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
          ],
        },
        weekNum: 3,
        previousLogs: logs,
        programId: 'curr-prog',
        dayNum: 2,
      });

      // 12 reps @ 8 RPE multiplier is 0.638.
      // Expected raw anchor = baseline * 0.638 = ~30.12 kg -> rounded to 30 kg.
      expect(sets[0].weight).toBe(30);
      expect(sets[0].reps).toBe(12);
      expect(sets[0].rpe).toBe(8);
    });

    it('resolves Gym80 Lateral Raise Week 3 targets with contextual baseline', () => {
      const logs: WorkoutLog[] = [
        // Current program Week 1
        {
          id: 'curr-w1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'curr-prog',
          week: '1',
          day: '2',
          exercises: [
            {
              name: 'Gym80 Lateral Raise',
              muscleGroup: 'Delts',
              sets: [{ setNumber: 1, weight: 45, reps: 15, rpe: 8 }], // 45 / 0.578 = 77.85 kg
            },
          ],
        },
        // Current program Week 2
        {
          id: 'curr-w2',
          date: '2026-08-08',
          unit: 'kg',
          programId: 'curr-prog',
          week: '2',
          day: '2',
          exercises: [
            {
              name: 'Gym80 Lateral Raise',
              muscleGroup: 'Delts',
              sets: [
                { setNumber: 1, weight: 50, reps: 12, rpe: 10 }, // 50 / 0.672 = 74.40 kg
                { setNumber: 2, weight: 50, reps: 10, rpe: 10 },
              ],
            },
          ],
        },
      ];

      // Week 3 Day 2 resolution (Isolation exercise in Wave Volume has 15 reps on odd weeks)
      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercise: {
          name: 'Gym80 Lateral Raise',
          muscleGroup: 'Delts',
          sets: [
            { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
            { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
            { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
          ],
        },
        weekNum: 3,
        previousLogs: logs,
        programId: 'curr-prog',
        dayNum: 2,
      });

      expect(sets[0].reps).toBe(15);
      expect(sets[0].rpe).toBe(8);
      expect(sets[0].weight).toBeGreaterThan(0);
    });
  });

  describe('Integration with calculateAddedSetTarget', () => {
    it('uses contextual baseline when adding a set in a multi-week workout session', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-08-01',
          unit: 'kg',
          programId: 'p1',
          week: '1',
          day: '1',
          exercises: [
            {
              name: 'Leg Press',
              muscleGroup: 'Quads',
              sets: [{ setNumber: 1, weight: 150, reps: 8, rpe: 8 }],
            },
          ],
        },
      ];

      const target = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_step',
        exercise: {
          name: 'Leg Press',
          muscleGroup: 'Quads',
          sets: [{ setNumber: 1, weight: 150, reps: 8, rpe: 8 }],
        },
        weekNum: 2,
        previousLogs: logs,
        programId: 'p1',
        dayNum: 1,
      });

      expect(target.isPrescribed).toBe(true);
      expect(target.target).not.toBeNull();
      expect(target.target!.weight).toBeGreaterThan(0);
    });
  });
});
