import { describe, it, expect } from 'vitest';
import {
  resolveContextualPrescriptionBaselineE1RM,
  extractExposureSessionCapacity,
  calculateMedian,
  calculateObjectiveSets,
  calculateAddedSetTarget,
  resolveTargetChronology,
  isCandidateLogChronologicallyEligible,
  extractLogEffectiveTimestampMs,
  PrescriptionTargetChronology,
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

  describe('ESR-3C: Same-Day Baseline Chronology & Historical Edit Filtering', () => {
    it('includes a completed one-off workout saved on the same calendar date for a newly opened active workout (targetLogId null)', () => {
      const targetDate = '2026-08-23';
      const logs: WorkoutLog[] = [
        {
          id: '1724400000000', // Completed earlier on 2026-08-23
          date: targetDate,
          unit: 'kg',
          exercises: [
            {
              name: 'ESR Strength Test Press',
              muscleGroup: 'Delts',
              sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }], // 100 kg e1RM
            },
          ],
        },
      ];

      const baseline = resolveContextualPrescriptionBaselineE1RM('ESR Strength Test Press', 1, logs, {
        programId: 'new-program',
        targetDay: 1,
        targetDate,
        targetLogId: null,
      });

      expect(baseline).toBeCloseTo(100, 2);
    });

    it('strictly excludes future calendar date logs from baseline calculation', () => {
      const targetDate = '2026-08-23';
      const logs: WorkoutLog[] = [
        {
          id: 'log-past',
          date: '2026-08-20',
          unit: 'kg',
          exercises: [
            {
              name: 'Overhead Press',
              muscleGroup: 'Delts',
              sets: [{ setNumber: 1, weight: 60, reps: 1, rpe: 10 }], // 60 kg e1RM
            },
          ],
        },
        {
          id: 'log-future',
          date: '2026-08-24', // Future date relative to targetDate
          unit: 'kg',
          exercises: [
            {
              name: 'Overhead Press',
              muscleGroup: 'Delts',
              sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }],
            },
          ],
        },
      ];

      const baseline = resolveContextualPrescriptionBaselineE1RM('Overhead Press', 1, logs, {
        programId: 'new-program',
        targetDay: 1,
        targetDate,
        targetLogId: null,
      });

      expect(baseline).toBeCloseTo(60, 2);
    });

    it('excludes the target workout itself when editing an existing historical workout (self-exclusion)', () => {
      const editLogId = 'log-edit-target';
      const targetDate = '2026-08-23';
      const logs: WorkoutLog[] = [
        {
          id: 'log-prior',
          date: '2026-08-22',
          unit: 'kg',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 80, reps: 1, rpe: 10 }], // 80 kg e1RM
            },
          ],
        },
        {
          id: editLogId, // The log currently being edited
          date: targetDate,
          unit: 'kg',
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'Chest',
              sets: [{ setNumber: 1, weight: 120, reps: 1, rpe: 10 }],
            },
          ],
        },
      ];

      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, logs, {
        programId: 'prog-1',
        targetDay: 1,
        targetDate,
        targetLogId: editLogId,
      });

      // Must resolve to 80 kg from log-prior, self (120 kg) must be excluded
      expect(baseline).toBeCloseTo(80, 2);
    });

    it('enforces chronological ordering for same-day logs during historical edit (earlier eligible, later excluded)', () => {
      const targetDate = '2026-08-23';
      const log1Earlier = {
        id: '1724400000000', // 08:00 AM
        date: targetDate,
        startTime: '08:00',
        unit: 'kg' as const,
        exercises: [
          {
            name: 'Deadlift',
            muscleGroup: 'Back',
            sets: [{ setNumber: 1, weight: 150, reps: 1, rpe: 10 }], // 150 kg e1RM
          },
        ],
      };
      const log2MiddleTarget = {
        id: '1724410000000', // 11:00 AM (Target being edited)
        date: targetDate,
        startTime: '11:00',
        unit: 'kg' as const,
        exercises: [
          {
            name: 'Deadlift',
            muscleGroup: 'Back',
            sets: [{ setNumber: 1, weight: 180, reps: 1, rpe: 10 }],
          },
        ],
      };
      const log3Later = {
        id: '1724420000000', // 02:00 PM (Occurred after target)
        date: targetDate,
        startTime: '14:00',
        unit: 'kg' as const,
        exercises: [
          {
            name: 'Deadlift',
            muscleGroup: 'Back',
            sets: [{ setNumber: 1, weight: 200, reps: 1, rpe: 10 }],
          },
        ],
      };

      const logs: WorkoutLog[] = [log1Earlier, log2MiddleTarget, log3Later];

      const baseline = resolveContextualPrescriptionBaselineE1RM('Deadlift', 1, logs, {
        programId: 'prog-deadlift',
        targetDay: 1,
        targetDate,
        targetLogId: log2MiddleTarget.id,
      });

      // log1Earlier (150 kg) is eligible, log2MiddleTarget (self) is excluded, log3Later is excluded
      expect(baseline).toBeCloseTo(150, 2);
    });

    it('resolves Tier 1 cross-program same-day baseline for Wave Strength prescription', () => {
      const targetDate = '2026-08-23';
      const baselineLog: WorkoutLog = {
        id: '1724400112233',
        date: targetDate,
        unit: 'kg',
        exercises: [
          {
            name: 'ESR Strength Test Press',
            muscleGroup: 'Delts',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }],
          },
        ],
      };

      const calculated = calculateObjectiveSets({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        exercise: {
          name: 'ESR Strength Test Press',
          muscleGroup: 'Delts',
          modality: 'weighted',
          isMainMovement: true,
          sets: [
            { setNumber: 1, weight: 0, reps: 8, rpe: 6 },
            { setNumber: 2, weight: 0, reps: 8, rpe: 7 },
            { setNumber: 3, weight: 0, reps: 8, rpe: 8 },
          ],
        },
        weekNum: 1,
        programDuration: 4,
        previousLogs: [baselineLog],
        programId: 'esr-strength-verification',
        dayNum: 1,
        targetDate,
        targetLogId: null,
      });

      // In Wave Strength (strength_undulating) 4-Week Program Week 1:
      // Profile Week 1: 5 reps @ 7.0 RPE (Multiplier = 0.771)
      // Anchor = 100 * 0.771 = 77.1 -> 77.5 kg
      // Set 1 (Ord 1): 77.5 kg x 5 reps @ 7.0 RPE
      // Set 2 (Ord 2, F2=0.980, RPE=6.0): 100 * 0.980 * 0.743 = 72.81 -> 72.5 kg x 5 reps @ 6.0 RPE
      // Set 3 (Ord 3, F3=0.960, RPE=6.5): 100 * 0.960 * 0.757 = 72.67 -> 72.5 kg x 5 reps @ 6.5 RPE
      expect(calculated[0].weight).toBe(77.5);
      expect(calculated[0].reps).toBe(5);
      expect(calculated[0].rpe).toBe(7.0);

      expect(calculated[1].weight).toBe(72.5);
      expect(calculated[1].reps).toBe(5);
      expect(calculated[1].rpe).toBe(6.0);

      expect(calculated[2].weight).toBe(72.5);
      expect(calculated[2].reps).toBe(5);
      expect(calculated[2].rpe).toBe(6.5);
    });
  });

  describe('ESR-3C-R2 Chronology and Date Safety Verification (22 Production Scenarios)', () => {
    // 1. Live same-day one-off calibration completed BEFORE active live session starts
    it('1. allows earlier same-day one-off calibration to inform newly opened active live session', () => {
      const today = '2026-08-23';
      const calibrationLog: WorkoutLog = {
        id: String(new Date(`${today}T08:00:00`).getTime()),
        date: today,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }], // 100 kg e1RM
        }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${today}T09:00:00`).getTime(), // 09:00 AM
        targetLogId: null,
        displayedDate: today,
      };

      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, [calibrationLog], {
        programId: 'hypertrophy-program',
        targetDay: 1,
        targetDate: today,
        targetChronology: chronology,
      });

      expect(baseline).toBeCloseTo(100, 2);
    });

    // 2. Same-day workout completed AFTER active live session started
    it('2. strictly excludes same-day workout completed AFTER active live session started', () => {
      const today = '2026-08-23';
      const laterLog: WorkoutLog = {
        id: String(new Date(`${today}T11:00:00`).getTime()), // 11:00 AM
        date: today,
        startTime: '11:00',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 120, reps: 1, rpe: 10 }],
        }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${today}T09:00:00`).getTime(), // 09:00 AM (Target session started at 09:00 AM, before laterLog)
        targetLogId: null,
        displayedDate: today,
      };

      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, [laterLog], {
        programId: 'hypertrophy-program',
        targetDay: 1,
        targetDate: today,
        targetChronology: chronology,
      });

      expect(baseline).toBe(0);
    });

    // 3. Retrospective new session on past calendar date with explicit timestamp
    it('3. filters same-day logs in retrospective new session using explicitTargetTimestamp', () => {
      const pastDate = '2026-08-20';
      const earlierLog: WorkoutLog = {
        id: String(new Date(`${pastDate}T08:00:00`).getTime()), // 08:00 AM on 2026-08-20
        date: pastDate,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{
          name: 'Squat',
          muscleGroup: 'Quads',
          sets: [{ setNumber: 1, weight: 140, reps: 1, rpe: 10 }],
        }],
      };
      const laterLog: WorkoutLog = {
        id: String(new Date(`${pastDate}T14:00:00`).getTime()), // 02:00 PM on 2026-08-20
        date: pastDate,
        startTime: '14:00',
        unit: 'kg',
        exercises: [{
          name: 'Squat',
          muscleGroup: 'Quads',
          sets: [{ setNumber: 1, weight: 180, reps: 1, rpe: 10 }],
        }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'retrospective_new',
        targetLogId: null,
        displayedDate: pastDate,
        explicitTargetTimestamp: new Date(`${pastDate}T11:00:00`).getTime(), // 11:00 AM on 2026-08-20
      };

      const baseline = resolveContextualPrescriptionBaselineE1RM('Squat', 1, [earlierLog, laterLog], {
        programId: 'squat-program',
        targetDay: 1,
        targetDate: pastDate,
        targetChronology: chronology,
      });

      // Only earlierLog (140 kg) is eligible, laterLog (180 kg) is after 11:00 AM
      expect(baseline).toBeCloseTo(140, 2);
    });

    // 4. Retrospective new session without explicit timestamp
    it('4. accepts strictly prior dates and excludes unverified same-day logs when no timestamp is provided', () => {
      const pastDate = '2026-08-20';
      const priorDayLog: WorkoutLog = {
        id: '1724050000000',
        date: '2026-08-19',
        unit: 'kg',
        exercises: [{
          name: 'Deadlift',
          muscleGroup: 'Back',
          sets: [{ setNumber: 1, weight: 200, reps: 1, rpe: 10 }],
        }],
      };
      const sameDayLogNoTime: WorkoutLog = {
        id: 'uuid-no-time',
        date: pastDate,
        unit: 'kg',
        exercises: [{
          name: 'Deadlift',
          muscleGroup: 'Back',
          sets: [{ setNumber: 1, weight: 250, reps: 1, rpe: 10 }],
        }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'retrospective_new',
        targetLogId: null,
        displayedDate: pastDate,
        explicitTargetTimestamp: null,
      };

      const baseline = resolveContextualPrescriptionBaselineE1RM('Deadlift', 1, [priorDayLog, sameDayLogNoTime], {
        programId: 'dl-prog',
        targetDay: 1,
        targetDate: pastDate,
        targetChronology: chronology,
      });

      // Only priorDayLog (200 kg) is eligible
      expect(baseline).toBeCloseTo(200, 2);
    });

    // 5. Historical edit excludes self and all workouts completed after target log
    it('5. historical edit excludes self and all workouts completed after target log', () => {
      const editLogId = 'log-target-edit';
      const logs: WorkoutLog[] = [
        {
          id: 'log-past-1',
          date: '2026-08-15',
          unit: 'kg',
          exercises: [{ name: 'Overhead Press', muscleGroup: 'Delts', sets: [{ setNumber: 1, weight: 70, reps: 1, rpe: 10 }] }],
        },
        {
          id: editLogId, // Target being edited (2026-08-18)
          date: '2026-08-18',
          unit: 'kg',
          exercises: [{ name: 'Overhead Press', muscleGroup: 'Delts', sets: [{ setNumber: 1, weight: 75, reps: 1, rpe: 10 }] }],
        },
        {
          id: 'log-future-1', // Occurred on 2026-08-22 (after target)
          date: '2026-08-22',
          unit: 'kg',
          exercises: [{ name: 'Overhead Press', muscleGroup: 'Delts', sets: [{ setNumber: 1, weight: 90, reps: 1, rpe: 10 }] }],
        },
      ];

      const baseline = resolveContextualPrescriptionBaselineE1RM('Overhead Press', 1, logs, {
        programId: 'ohp-prog',
        targetDay: 1,
        targetDate: '2026-08-18',
        targetLogId: editLogId,
        targetChronology: { mode: 'historical_edit', targetLogId: editLogId, displayedDate: '2026-08-18' },
      });

      expect(baseline).toBeCloseTo(70, 2);
    });

    // 6. Same-program historical chronology leakage prevention
    it('6. prevents lower-numbered program weeks completed later from leaking into historical edit baselines', () => {
      const progId = 'wave-prog-leakage-test';
      // User did Week 2 first on 2026-08-20, then did Week 1 later on 2026-08-22
      const week2Log: WorkoutLog = {
        id: '1724140000000', // 2026-08-20 10:00
        date: '2026-08-20',
        startTime: '10:00',
        programId: progId,
        week: '2',
        day: '1',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }],
        }],
      };
      const week1LogDoneLater: WorkoutLog = {
        id: '1724312800000', // 2026-08-22 10:00 (Completed AFTER Week 2)
        date: '2026-08-22',
        startTime: '10:00',
        programId: progId,
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 110, reps: 1, rpe: 10 }],
        }],
      };

      // When viewing/editing Week 2, week1LogDoneLater must NOT leak in even though weekNum=1 < weekNum=2
      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 2, [week2Log, week1LogDoneLater], {
        programId: progId,
        targetDay: 1,
        targetDate: '2026-08-20',
        targetLogId: week2Log.id,
        targetChronology: { mode: 'historical_edit', targetLogId: week2Log.id, displayedDate: '2026-08-20' },
      });

      // No prior log existed before Week 2
      expect(baseline).toBe(0);
    });

    // 7. Out-of-order program weeks execution
    it('7. resolves latest chronological prior log when program weeks are executed out-of-order', () => {
      const progId = 'wave-prog-ooo';
      const week2Log: WorkoutLog = {
        id: '1724140000000', // Day 1 (2026-08-20)
        date: '2026-08-20',
        programId: progId,
        week: '2',
        day: '1',
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 120, reps: 1, rpe: 10 }] }],
      };
      const week1Log: WorkoutLog = {
        id: '1724226400000', // Day 2 (2026-08-21)
        date: '2026-08-21',
        programId: progId,
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 130, reps: 1, rpe: 10 }] }],
      };

      // Live Week 3 on Day 3 (2026-08-22)
      const baseline = resolveContextualPrescriptionBaselineE1RM('Squat', 3, [week2Log, week1Log], {
        programId: progId,
        targetDay: 1,
        targetDate: '2026-08-22',
        targetChronology: { mode: 'active_live', sessionStartedAt: new Date('2026-08-22T10:00:00').getTime(), targetLogId: null, displayedDate: '2026-08-22' },
      });

      // Both Week 1 and Week 2 occurred prior to Week 3. Tier 1 matches same program day 1.
      // The resolver should pick up the valid prior baseline (130 kg from week 1 or median/latest).
      expect(baseline).toBeGreaterThanOrEqual(120);
    });

    // 8. Programmed workout performed on a different date from scheduled date
    it('8. treats actual date and timestamp as authority rather than scheduledDate', () => {
      const misdatedLog: WorkoutLog = {
        id: '1724400000000',
        date: '2026-08-23', // Actual performance date
        scheduledDate: '2026-08-15', // Scheduled date was 8 days earlier
        unit: 'kg',
        exercises: [{ name: 'Barbell Row', muscleGroup: 'Back', sets: [{ setNumber: 1, weight: 80, reps: 1, rpe: 10 }] }],
      };

      // Target session on 2026-08-20 (between scheduledDate and actual date)
      const baseline = resolveContextualPrescriptionBaselineE1RM('Barbell Row', 1, [misdatedLog], {
        programId: 'row-prog',
        targetDay: 1,
        targetDate: '2026-08-20',
        targetChronology: { mode: 'retrospective_new', targetLogId: null, displayedDate: '2026-08-20' },
      });

      // misdatedLog was actually performed on 2026-08-23, so it cannot be used for target on 2026-08-20
      expect(baseline).toBe(0);
    });

    // 9. Future scheduled workout opened early today
    it('9. future scheduled workout opened early today respects today chronology', () => {
      const today = '2026-08-23';
      const earlierTodayCalibration: WorkoutLog = {
        id: String(new Date(`${today}T08:00:00`).getTime()),
        date: today,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{ name: 'Incline Bench', muscleGroup: 'Chest', sets: [{ setNumber: 1, weight: 90, reps: 1, rpe: 10 }] }],
      };

      // Workout was scheduled for 2026-08-25, but user opens it live today (2026-08-23 10:00 AM)
      const baseline = resolveContextualPrescriptionBaselineE1RM('Incline Bench', 1, [earlierTodayCalibration], {
        programId: 'prog-early',
        targetDay: 1,
        targetDate: today,
        targetChronology: { mode: 'active_live', sessionStartedAt: new Date(`${today}T10:00:00`).getTime(), targetLogId: null, displayedDate: today },
      });

      expect(baseline).toBeCloseTo(90, 2);
    });

    // 10. Multiple same-day permanent workouts with non-timestamp IDs (UUIDs) with startTime
    it('10. orders same-day logs by startTime when IDs are UUID strings', () => {
      const today = '2026-08-23';
      const morningLog: WorkoutLog = {
        id: 'uuid-morning-aaa',
        date: today,
        startTime: '07:30',
        unit: 'kg',
        exercises: [{ name: 'Leg Press', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 200, reps: 1, rpe: 10 }] }],
      };
      const noonLog: WorkoutLog = {
        id: 'uuid-noon-bbb',
        date: today,
        startTime: '12:00',
        unit: 'kg',
        exercises: [{ name: 'Leg Press', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 240, reps: 1, rpe: 10 }] }],
      };

      const chronologyMorning: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${today}T10:00:00`).getTime(),
        targetLogId: null,
        displayedDate: today,
      };

      const baseline = resolveContextualPrescriptionBaselineE1RM('Leg Press', 1, [morningLog, noonLog], {
        programId: 'lp-prog',
        targetDay: 1,
        targetDate: today,
        targetChronology: chronologyMorning,
      });

      // At 10:00 AM, morningLog (07:30) is eligible, noonLog (12:00) is excluded
      expect(baseline).toBeCloseTo(200, 2);
    });

    // 11. Multiple same-day permanent workouts with millisecond timestamp IDs
    it('11. orders same-day logs by numeric timestamp IDs accurately', () => {
      const today = '2026-08-23';
      const log1: WorkoutLog = {
        id: String(new Date(`${today}T08:00:00`).getTime()),
        date: today,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{ name: 'Romanian Deadlift', muscleGroup: 'Hamstrings', sets: [{ setNumber: 1, weight: 110, reps: 1, rpe: 10 }] }],
      };
      const log2: WorkoutLog = {
        id: String(new Date(`${today}T12:00:00`).getTime()),
        date: today,
        startTime: '12:00',
        unit: 'kg',
        exercises: [{ name: 'Romanian Deadlift', muscleGroup: 'Hamstrings', sets: [{ setNumber: 1, weight: 130, reps: 1, rpe: 10 }] }],
      };

      const baseline = resolveContextualPrescriptionBaselineE1RM('Romanian Deadlift', 1, [log1, log2], {
        programId: 'rdl-prog',
        targetDay: 1,
        targetDate: today,
        targetChronology: { mode: 'active_live', sessionStartedAt: new Date(`${today}T10:00:00`).getTime(), targetLogId: null, displayedDate: today },
      });

      expect(baseline).toBeCloseTo(110, 2);
    });

    // 12. Same-day workout with missing/invalid timestamp/startTime fallback
    it('12. handles missing/unparseable timestamps gracefully without throwing', () => {
      const today = '2026-08-23';
      const weirdLog: WorkoutLog = {
        id: 'custom-id-with-no-numbers',
        date: today,
        startTime: 'invalid-time',
        unit: 'kg',
        exercises: [{ name: 'Bicep Curl', muscleGroup: 'Biceps', sets: [{ setNumber: 1, weight: 30, reps: 1, rpe: 10 }] }],
      };

      expect(() => {
        resolveContextualPrescriptionBaselineE1RM('Bicep Curl', 1, [weirdLog], {
          programId: 'curl-prog',
          targetDay: 1,
          targetDate: today,
          targetChronology: { mode: 'active_live', sessionStartedAt: Date.now(), targetLogId: null, displayedDate: today },
        });
      }).not.toThrow();
    });

    // 13. Tiered fallback hierarchy (Tier 1 vs Tier 2 vs Tier 3) with targetChronology
    it('13. respects tiered fallback: Tier 1 (same program & day) > Tier 2 (same program) > Tier 3 (cross-program)', () => {
      const today = '2026-08-23';
      const targetProg = 'my-program-id';

      const tier3CrossProgram: WorkoutLog = {
        id: '1724300000000', // Yesterday
        date: '2026-08-22',
        programId: 'other-prog',
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }] }],
      };
      const tier2SameProgDiffDay: WorkoutLog = {
        id: '1724350000000',
        date: '2026-08-22',
        programId: targetProg,
        week: '1',
        day: '2', // Day 2 (target is Day 1)
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 120, reps: 1, rpe: 10 }] }],
      };
      const tier1SameProgSameDay: WorkoutLog = {
        id: '1724390000000',
        date: '2026-08-22',
        programId: targetProg,
        week: '1',
        day: '1', // Day 1 matching targetDay
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 140, reps: 1, rpe: 10 }] }],
      };

      const baseline = resolveContextualPrescriptionBaselineE1RM('Squat', 2, [tier3CrossProgram, tier2SameProgDiffDay, tier1SameProgSameDay], {
        programId: targetProg,
        targetDay: 1,
        targetDate: today,
        targetChronology: { mode: 'active_live', sessionStartedAt: new Date(`${today}T10:00:00`).getTime(), targetLogId: null, displayedDate: today },
      });

      // Tier 1 matches tier1SameProgSameDay (140 kg)
      expect(baseline).toBeCloseTo(140, 2);
    });

    // 14. calculateObjectiveSets with targetChronology for active live session
    it('14. calculates complete objective sets accurately with targetChronology', () => {
      const today = '2026-08-23';
      const priorLog: WorkoutLog = {
        id: String(new Date(`${today}T08:00:00`).getTime()),
        date: today,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{ name: 'Bench Press', muscleGroup: 'Chest', sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }] }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${today}T10:00:00`).getTime(),
        targetLogId: null,
        displayedDate: today,
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        algorithmId: 'strength_linear',
        exercise: {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          isMainMovement: true,
          sets: [
            { setNumber: 1, weight: 0, reps: 8, rpe: 7 },
            { setNumber: 2, weight: 0, reps: 8, rpe: 7.5 },
          ],
        },
        weekNum: 1,
        programDuration: 8,
        previousLogs: [priorLog],
        programId: 'linear-prog',
        dayNum: 1,
        targetDate: today,
        targetChronology: chronology,
        sessionStartedAt: chronology.sessionStartedAt,
      });

      expect(sets.length).toBe(2);
      expect(sets[0].weight).toBeGreaterThan(0);
      expect(sets[0].reps).toBe(8);
      expect(sets[0].rpe).toBe(7.0);
    });

    // 15. calculateAddedSetTarget with targetChronology
    it('15. calculates target for added set using targetChronology', () => {
      const today = '2026-08-23';
      const priorLog: WorkoutLog = {
        id: String(new Date(`${today}T08:00:00`).getTime()),
        date: today,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{ name: 'Overhead Press', muscleGroup: 'Delts', sets: [{ setNumber: 1, weight: 60, reps: 1, rpe: 10 }] }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${today}T10:00:00`).getTime(),
        targetLogId: null,
        displayedDate: today,
      };

      const result = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        exercise: {
          name: 'Overhead Press',
          muscleGroup: 'Delts',
          sets: [
            { setNumber: 1, weight: 45, reps: 10, rpe: 8 },
            { setNumber: 2, weight: 45, reps: 10, rpe: 8 },
          ],
        },
        weekNum: 1,
        programDuration: 8,
        previousLogs: [priorLog],
        targetDate: today,
        targetChronology: chronology,
        sessionStartedAt: chronology.sessionStartedAt,
      });

      expect(result.isPrescribed).toBe(true);
      expect(result.target?.weight).toBeGreaterThan(0);
      expect(result.target?.reps).toBeGreaterThan(0);
      expect(result.target?.rpe).toBeGreaterThan(0);
    });

    // 16. Exercise occurrence ordinal consistency with same-day baseline
    it('16. assigns distinct occurrence ordinals when exercise appears multiple times', () => {
      const today = '2026-08-23';
      const priorLog: WorkoutLog = {
        id: String(new Date(`${today}T08:00:00`).getTime()),
        date: today,
        startTime: '08:00',
        unit: 'kg',
        exercises: [
          { name: 'Barbell Curl', muscleGroup: 'Biceps', sets: [{ setNumber: 1, weight: 30, reps: 1, rpe: 10 }] },
          { name: 'Barbell Curl', muscleGroup: 'Biceps', sets: [{ setNumber: 1, weight: 40, reps: 1, rpe: 10 }] },
        ],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${today}T10:00:00`).getTime(),
        targetLogId: null,
        displayedDate: today,
      };

      const baselineOrd0 = resolveContextualPrescriptionBaselineE1RM('Barbell Curl', 1, [priorLog], {
        targetDate: today,
        targetChronology: chronology,
        occurrenceOrdinal: 0,
      });
      const baselineOrd1 = resolveContextualPrescriptionBaselineE1RM('Barbell Curl', 1, [priorLog], {
        targetDate: today,
        targetChronology: chronology,
        occurrenceOrdinal: 1,
      });

      expect(baselineOrd0).toBeCloseTo(30, 2);
      expect(baselineOrd1).toBeCloseTo(40, 2);
    });

    // 17. Main Movement designation toggle preserves untouched sets & live evidence
    it('17. preserves user-touched sets and live evidence when calculating objective sets', () => {
      const priorLog: WorkoutLog = {
        id: '1724400000000',
        date: '2026-08-22',
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 150, reps: 1, rpe: 10 }] }],
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        exercise: {
          name: 'Squat',
          muscleGroup: 'Quads',
          isMainMovement: true,
          sets: [
            { setNumber: 1, weight: 140, reps: 3, rpe: 9 }, // User manually edited Set 1
            { setNumber: 2, weight: 0, reps: 5, rpe: 7 },
          ],
        },
        weekNum: 1,
        programDuration: 4,
        previousLogs: [priorLog],
        userTouchedSets: { '0-0': true }, // Set 1 is touched
        checkedSets: {},
      });

      // Untouched Set 2 is recalculated from baseline
      expect(sets[0].weight).toBe(140);
      expect(sets[0].reps).toBe(3);
      expect(sets[1].weight).toBeGreaterThan(0);
    });

    // 18. Bodyweight session math snapshot preservation
    it('18. handles bodyweight session snapshot seamlessly with same-day baseline', () => {
      const today = '2026-08-23';
      const priorLog: WorkoutLog = {
        id: String(new Date(`${today}T08:00:00`).getTime()),
        date: today,
        startTime: '08:00',
        unit: 'kg',
        bodyweightSnapshot: {
          value: 80,
          unit: 'kg',
        },
        exercises: [{
          name: 'Pull Up',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 10 }],
        }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${today}T10:00:00`).getTime(),
        targetLogId: null,
        displayedDate: today,
      };

      const baseline = resolveContextualPrescriptionBaselineE1RM('Pull Up', 1, [priorLog], {
        targetDate: today,
        targetChronology: chronology,
        bodyweightSnapshot: {
          value: 80,
          unit: 'kg',
        },
      });

      expect(baseline).toBeGreaterThan(0);
    });

    // 19. Helper resolveTargetChronology correctly infers mode from parameters
    it('19. resolveTargetChronology infers correct mode and bounds', () => {
      const active = resolveTargetChronology(null, '2026-08-23', 1724400000000);
      expect(active.mode).toBe('active_live');

      const edit = resolveTargetChronology('log-123', '2026-08-20');
      expect(edit.mode).toBe('historical_edit');
      if (edit.mode === 'historical_edit') {
        expect(edit.targetLogId).toBe('log-123');
      }

      const retro = resolveTargetChronology(null, '2026-08-10', undefined, 1723248000000);
      expect(retro.mode).toBe('retrospective_new');
    });

    // 20. Cross-unit conversion during same-day baseline resolution
    it('20. accurately converts lbs to kg in same-day baseline resolution', () => {
      const today = '2026-08-23';
      const lbsLog: WorkoutLog = {
        id: String(new Date(`${today}T08:00:00`).getTime()),
        date: today,
        startTime: '08:00',
        unit: 'lb',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 220.462, reps: 1, rpe: 10 }], // 100 kg equivalent
        }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${today}T10:00:00`).getTime(),
        targetLogId: null,
        displayedDate: today,
      };

      const baselineKg = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, [lbsLog], {
        targetDate: today,
        targetChronology: chronology,
        activeUnit: 'kg',
      });

      expect(baselineKg).toBeCloseTo(100, 1);
    });

    // 21. Incomplete or skipped sets in same-day calibration session
    it('21. skips warmup and skipped sets when deriving same-day baseline capacity', () => {
      const today = '2026-08-23';
      const logWithWarmup: WorkoutLog = {
        id: String(new Date(`${today}T08:00:00`).getTime()),
        date: today,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{
          name: 'Squat',
          muscleGroup: 'Quads',
          sets: [
            { setNumber: 1, weight: 60, reps: 5, rpe: 5, isWarmup: true },
            { setNumber: 2, weight: 140, reps: 1, rpe: 10, isWarmup: false },
            { setNumber: 3, weight: 160, reps: 1, rpe: 10, isSkipped: true },
          ],
        }],
      };

      const baseline = resolveContextualPrescriptionBaselineE1RM('Squat', 1, [logWithWarmup], {
        targetDate: today,
        targetChronology: { mode: 'active_live', sessionStartedAt: new Date(`${today}T10:00:00`).getTime(), targetLogId: null, displayedDate: today },
      });

      // Should be based purely on set 2 (140 kg)
      expect(baseline).toBeCloseTo(140, 2);
    });

    // 22. High-density same-day sessions (5 sessions on same day)
    it('22. maintains flawless chronological separation across 5 sequential same-day sessions', () => {
      const today = '2026-08-23';
      const sessionTimes = ['06:00', '09:00', '12:00', '15:00', '18:00'];
      const weights = [100, 105, 110, 115, 120];

      const logs: WorkoutLog[] = sessionTimes.map((time, idx) => ({
        id: String(new Date(`${today}T${time}:00`).getTime()),
        date: today,
        startTime: time,
        unit: 'kg',
        exercises: [{
          name: 'Deadlift',
          muscleGroup: 'Back',
          sets: [{ setNumber: 1, weight: weights[idx], reps: 1, rpe: 10 }],
        }],
      }));

      // Edit session 3 (12:00) -> should see session 1 (06:00) and session 2 (09:00) only, average in Tier 3 is (100 + 105)/2 = 102.5
      const baselineSession3 = resolveContextualPrescriptionBaselineE1RM('Deadlift', 1, logs, {
        targetDate: today,
        targetLogId: logs[2].id,
        targetChronology: { mode: 'historical_edit', targetLogId: logs[2].id, displayedDate: today },
      });
      expect(baselineSession3).toBeCloseTo(102.5, 2);

      // Active live session at 14:00 -> should see sessions 1, 2, 3 (top 3: 100, 105, 110 -> median is 105), not 4 and 5
      const baselineLive1400 = resolveContextualPrescriptionBaselineE1RM('Deadlift', 1, logs, {
        targetDate: today,
        targetChronology: {
          mode: 'active_live',
          sessionStartedAt: new Date(`${today}T14:00:00`).getTime(),
          targetLogId: null,
          displayedDate: today,
        },
      });
      expect(baselineLive1400).toBeCloseTo(105, 2);
    });
  });

  describe('ESR-3C-R3 Precise Timestamp and Historical-Target Chronology Direct Tests', () => {
    const testDate = '2026-08-23';

    // 1. Date-only timestamp extraction returns null
    it('1. Date-only timestamp extraction returns null', () => {
      const log = { date: testDate, id: 'uuid-arbitrary-12345' };
      const ts = extractLogEffectiveTimestampMs(log);
      expect(ts).toBeNull();
    });

    // 2. Valid date plus valid startTime resolves
    it('2. Valid date plus valid startTime resolves', () => {
      const log = { date: testDate, startTime: '08:30', id: 'uuid-12345' };
      const ts = extractLogEffectiveTimestampMs(log);
      expect(ts).toBe(new Date(`${testDate}T08:30:00`).getTime());
    });

    // 3. Full ISO datetime with time resolves
    it('3. Full ISO datetime with time resolves', () => {
      const isoStr = `${testDate}T14:45:00.000Z`;
      const log = { date: isoStr };
      const ts = extractLogEffectiveTimestampMs(log);
      expect(ts).toBe(Date.parse(isoStr));
    });

    // 4. Timestamp-bearing ID resolves
    it('4. Timestamp-bearing ID resolves', () => {
      const expectedEpoch = 1724400000000;
      const log = { date: testDate, id: `log-${expectedEpoch}` };
      const ts = extractLogEffectiveTimestampMs(log);
      expect(ts).toBe(expectedEpoch);
    });

    // 5. Invalid 25:90 returns null
    it('5. Invalid 25:90 returns null', () => {
      const logInvalid1 = { date: testDate, startTime: '25:90' };
      expect(extractLogEffectiveTimestampMs(logInvalid1)).toBeNull();

      const logInvalid2 = { date: testDate, startTime: '12:75' };
      expect(extractLogEffectiveTimestampMs(logInvalid2)).toBeNull();
    });

    // 6. Same-day active candidate with date only is excluded
    it('6. Same-day active candidate with date only is excluded', () => {
      const candidate: WorkoutLog = {
        id: 'uuid-date-only',
        date: testDate,
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }],
        }],
      };
      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${testDate}T09:00:00`).getTime(),
        targetLogId: null,
        displayedDate: testDate,
      };

      const eligible = isCandidateLogChronologicallyEligible(candidate, chronology, [candidate]);
      expect(eligible).toBe(false);

      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, [candidate], {
        targetDate: testDate,
        targetChronology: chronology,
      });
      expect(baseline).toBe(0);
    });

    // 7. Earlier timestamped same-day calibration remains eligible
    it('7. Earlier timestamped same-day calibration remains eligible', () => {
      const calibrationLog: WorkoutLog = {
        id: 'calib-uuid',
        date: testDate,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }],
        }],
      };
      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${testDate}T09:00:00`).getTime(),
        targetLogId: null,
        displayedDate: testDate,
      };

      const eligible = isCandidateLogChronologicallyEligible(calibrationLog, chronology, [calibrationLog]);
      expect(eligible).toBe(true);

      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, [calibrationLog], {
        targetDate: testDate,
        targetChronology: chronology,
      });
      expect(baseline).toBeCloseTo(100, 2);
    });

    // 8. Later same-day candidate remains excluded
    it('8. Later same-day candidate remains excluded', () => {
      const laterLog: WorkoutLog = {
        id: 'later-uuid',
        date: testDate,
        startTime: '11:00',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 120, reps: 1, rpe: 10 }],
        }],
      };
      const chronology: PrescriptionTargetChronology = {
        mode: 'active_live',
        sessionStartedAt: new Date(`${testDate}T09:00:00`).getTime(),
        targetLogId: null,
        displayedDate: testDate,
      };

      const eligible = isCandidateLogChronologicallyEligible(laterLog, chronology, [laterLog]);
      expect(eligible).toBe(false);

      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, [laterLog], {
        targetDate: testDate,
        targetChronology: chronology,
      });
      expect(baseline).toBe(0);
    });

    // 9. Historical UUID target uses its actual stored startTime
    it('9. Historical UUID target uses its actual stored startTime', () => {
      const targetLog: WorkoutLog = {
        id: 'target-uuid',
        date: testDate,
        startTime: '14:00',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 90, reps: 1, rpe: 10 }],
        }],
      };
      const candidateLog: WorkoutLog = {
        id: 'earlier-uuid',
        date: testDate,
        startTime: '10:00',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }],
        }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'historical_edit',
        targetLogId: 'target-uuid',
        displayedDate: testDate,
      };

      const logs = [candidateLog, targetLog];
      const eligible = isCandidateLogChronologicallyEligible(candidateLog, chronology, logs);
      expect(eligible).toBe(true);

      const baseline = resolveContextualPrescriptionBaselineE1RM('Bench Press', 1, logs, {
        targetDate: testDate,
        targetLogId: 'target-uuid',
        targetChronology: chronology,
      });
      expect(baseline).toBeCloseTo(100, 2);
    });

    // 10. Earlier same-day UUID candidate is eligible
    it('10. Earlier same-day UUID candidate is eligible', () => {
      const targetLog: WorkoutLog = {
        id: 'target-uuid-noon',
        date: testDate,
        startTime: '12:00',
        unit: 'kg',
        exercises: [{ name: 'Deadlift', muscleGroup: 'Back', sets: [{ setNumber: 1, weight: 150, reps: 1, rpe: 10 }] }],
      };
      const earlierCand: WorkoutLog = {
        id: 'cand-uuid-morning',
        date: testDate,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{ name: 'Deadlift', muscleGroup: 'Back', sets: [{ setNumber: 1, weight: 140, reps: 1, rpe: 10 }] }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'historical_edit',
        targetLogId: 'target-uuid-noon',
        displayedDate: testDate,
      };

      const eligible = isCandidateLogChronologicallyEligible(earlierCand, chronology, [earlierCand, targetLog]);
      expect(eligible).toBe(true);
    });

    // 11. Later same-day UUID candidate is excluded
    it('11. Later same-day UUID candidate is excluded', () => {
      const targetLog: WorkoutLog = {
        id: 'target-uuid-noon',
        date: testDate,
        startTime: '12:00',
        unit: 'kg',
        exercises: [{ name: 'Deadlift', muscleGroup: 'Back', sets: [{ setNumber: 1, weight: 150, reps: 1, rpe: 10 }] }],
      };
      const laterCand: WorkoutLog = {
        id: 'cand-uuid-evening',
        date: testDate,
        startTime: '18:00',
        unit: 'kg',
        exercises: [{ name: 'Deadlift', muscleGroup: 'Back', sets: [{ setNumber: 1, weight: 160, reps: 1, rpe: 10 }] }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'historical_edit',
        targetLogId: 'target-uuid-noon',
        displayedDate: testDate,
      };

      const eligible = isCandidateLogChronologicallyEligible(laterCand, chronology, [laterCand, targetLog]);
      expect(eligible).toBe(false);
    });

    // 12. Missing target log fails closed
    it('12. Missing target log fails closed', () => {
      const cand: WorkoutLog = {
        id: 'cand-uuid',
        date: testDate,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }] }],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'historical_edit',
        targetLogId: 'non-existent-target-id',
        displayedDate: testDate,
      };

      // Target is not in logs array
      const eligible = isCandidateLogChronologicallyEligible(cand, chronology, [cand]);
      expect(eligible).toBe(false);
    });

    // 13. Duplicate target IDs fail closed
    it('13. Duplicate target IDs fail closed', () => {
      const cand: WorkoutLog = {
        id: 'cand-uuid',
        date: testDate,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }] }],
      };
      const dup1: WorkoutLog = { id: 'dup-id', date: testDate, startTime: '12:00', unit: 'kg', exercises: [] };
      const dup2: WorkoutLog = { id: 'dup-id', date: testDate, startTime: '13:00', unit: 'kg', exercises: [] };

      const chronology: PrescriptionTargetChronology = {
        mode: 'historical_edit',
        targetLogId: 'dup-id',
        displayedDate: testDate,
      };

      const eligible = isCandidateLogChronologicallyEligible(cand, chronology, [cand, dup1, dup2]);
      expect(eligible).toBe(false);
    });

    // 14. Historical target without resolvable time fails closed
    it('14. Historical target without resolvable time fails closed', () => {
      const cand: WorkoutLog = {
        id: 'cand-uuid',
        date: testDate,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }] }],
      };
      const unresolvableTarget: WorkoutLog = {
        id: 'uuid-target-no-time',
        date: testDate, // plain date, no startTime, non-numeric ID
        unit: 'kg',
        exercises: [],
      };

      const chronology: PrescriptionTargetChronology = {
        mode: 'historical_edit',
        targetLogId: 'uuid-target-no-time',
        displayedDate: testDate,
      };

      const eligible = isCandidateLogChronologicallyEligible(cand, chronology, [cand, unresolvableTarget]);
      expect(eligible).toBe(false);
    });

    // 15. Retrospective same-day date-only evidence remains excluded
    it('15. Retrospective same-day date-only evidence remains excluded', () => {
      const candDateOnly: WorkoutLog = {
        id: 'cand-date-only',
        date: '2026-08-15',
        unit: 'kg',
        exercises: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10 }] }],
      };

      const chronologyNoExplicitTime: PrescriptionTargetChronology = {
        mode: 'retrospective_new',
        targetLogId: null,
        displayedDate: '2026-08-15',
      };

      const eligible = isCandidateLogChronologicallyEligible(candDateOnly, chronologyNoExplicitTime, [candDateOnly]);
      expect(eligible).toBe(false);
    });

    // 16. Original Strength calibration still produces 77.5 kg × 5 @ RPE 7
    it('16. Original Strength calibration still produces 77.5 kg × 5 @ RPE 7', () => {
      const calibrationLog: WorkoutLog = {
        id: 'calib-strength-100',
        date: testDate,
        startTime: '08:00',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10, isWarmup: false }],
        }],
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          isMainMovement: true,
          sets: [{ setNumber: 1, reps: 5, rpe: 7, isWarmup: false }],
        },
        previousLogs: [calibrationLog],
        weekNum: 1,
        activeUnit: 'kg',
        targetDate: testDate,
        sessionStartedAt: new Date(`${testDate}T09:00:00`).getTime(),
        targetChronology: {
          mode: 'active_live',
          sessionStartedAt: new Date(`${testDate}T09:00:00`).getTime(),
          targetLogId: null,
          displayedDate: testDate,
        },
      });

      expect(sets.length).toBe(1);
      expect(sets[0].weight).toBe(77.5);
      expect(sets[0].reps).toBe(5);
      expect(sets[0].rpe).toBe(7);
    });

    // 17. Existing chronology, Main Movement, Strength, Hypertrophy and Deload regressions remain passing
    it('17. Existing chronology, Main Movement, Strength, Hypertrophy and Deload regressions remain passing', () => {
      const pastLog: WorkoutLog = {
        id: 'past-log-1',
        date: '2026-08-20',
        startTime: '10:00',
        unit: 'kg',
        exercises: [{
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [{ setNumber: 1, weight: 100, reps: 1, rpe: 10, isWarmup: false }],
        }],
      };

      // Strength 5 reps @ RPE 7 -> 77.5 kg
      const strengthSets = calculateObjectiveSets({
        objective: 'Strength',
        weekNum: 1,
        exercise: { name: 'Bench Press', muscleGroup: 'Chest', isMainMovement: true, sets: [{ setNumber: 1, reps: 5, rpe: 7 }] },
        previousLogs: [pastLog],
        targetDate: testDate,
      });
      expect(strengthSets[0].weight).toBe(77.5);

      // Hypertrophy 10 reps @ RPE 8 (approx 68% -> 67.5 kg)
      const hypSets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        weekNum: 1,
        exercise: { name: 'Bench Press', muscleGroup: 'Chest', isMainMovement: true, sets: [{ setNumber: 1, reps: 10, rpe: 8 }] },
        previousLogs: [pastLog],
        targetDate: testDate,
      });
      expect(hypSets[0].weight).toBeGreaterThan(60);
      expect(hypSets[0].weight).toBeLessThan(75);

      // Deload 5 reps @ RPE 6
      const deloadSets = calculateObjectiveSets({
        objective: 'Deload',
        weekNum: 1,
        exercise: { name: 'Bench Press', muscleGroup: 'Chest', isMainMovement: true, sets: [{ setNumber: 1, reps: 5, rpe: 6 }] },
        previousLogs: [pastLog],
        targetDate: testDate,
      });
      expect(deloadSets[0].weight).toBeLessThan(strengthSets[0].weight!);
    });
  });
});

