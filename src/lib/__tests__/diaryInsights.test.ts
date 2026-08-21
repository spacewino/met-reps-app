import { describe, it, expect } from 'vitest';
import {
  normalizeWeightToKg,
  normalizeExerciseName,
  isHighConfidencePerformanceSetEligible,
  resolvePerformanceSetEvidence,
  getStrictlyPrecedingLogs,
  calculateExerciseTonnageKg,
  calculateSessionPerformanceIndex,
  classifyDiaryWorkout,
  generateDiaryInsights,
  generateDiaryScorecard,
  generateDiaryScorecardMap,
} from '../diaryInsights';
import { WorkoutLog, ExerciseEntry, SetEntry } from '../../types';

function createDummySet(overrides: Partial<SetEntry> = {}): SetEntry {
  return {
    setNumber: 1,
    weight: 100,
    reps: 5,
    rpe: 8.0,
    isCompleted: true,
    isWarmup: false,
    isSkipped: false,
    form: 'strict',
    ...overrides,
  };
}

function createDummyExercise(overrides: Partial<ExerciseEntry> = {}): ExerciseEntry {
  return {
    name: 'Bench Press',
    muscleGroup: 'Chest',
    movementCategory: 'compound',
    modality: 'weighted',
    isSkipped: false,
    sets: [createDummySet()],
    ...overrides,
  };
}

function createDummyLog(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return {
    id: 'log-1700000000000',
    date: '2025-01-15',
    unit: 'kg',
    exercises: [createDummyExercise()],
    ...overrides,
  };
}

describe('Diary Insights 2.0 Pure Engine Test Suite', () => {
  describe('Unit Normalization and Exercise Matching', () => {
    it('normalizes kg and lb correctly to kg', () => {
      expect(normalizeWeightToKg(100, 'kg')).toBe(100);
      expect(normalizeWeightToKg(220.462, 'lb')).toBeCloseTo(100, 2);
      expect(normalizeWeightToKg(null, 'kg')).toBe(0);
      expect(normalizeWeightToKg(undefined, 'lb')).toBe(0);
      expect(normalizeWeightToKg(NaN, 'kg')).toBe(0);
    });

    it('normalizes exercise names by trimming, lowercasing, and collapsing whitespace', () => {
      expect(normalizeExerciseName('Back Squat')).toBe('back squat');
      expect(normalizeExerciseName('  back   squat  ')).toBe('back squat');
      expect(normalizeExerciseName('BACK   SQUAT')).toBe('back squat');
      expect(normalizeExerciseName(null)).toBe('');
      expect(normalizeExerciseName(undefined)).toBe('');
    });

    it('does not fuzzy match distinct exercises', () => {
      expect(normalizeExerciseName('Back Squat')).not.toBe(normalizeExerciseName('Front Squat'));
      expect(normalizeExerciseName('Incline Dumbbell Press')).not.toBe(
        normalizeExerciseName('Flat Dumbbell Press')
      );
    });
  });

  describe('High-Confidence Performance Set Eligibility', () => {
    it('approves a valid completed weighted working set with valid RPE', () => {
      const ex = createDummyExercise({ modality: 'weighted' });
      const set = createDummySet({
        weight: 100,
        reps: 5,
        rpe: 8.5,
        isCompleted: true,
        form: 'strict',
      });
      expect(isHighConfidencePerformanceSetEligible(ex, set)).toBe(true);
    });

    it('approves legacy undefined modality as weighted', () => {
      const ex = createDummyExercise({ modality: undefined });
      const set = createDummySet({
        weight: 100,
        reps: 5,
        rpe: 8.5,
        isCompleted: true,
      });
      expect(isHighConfidencePerformanceSetEligible(ex, set)).toBe(true);
    });

    it('rejects sets where isCompleted is not true (legacy undefined or false)', () => {
      const ex = createDummyExercise();
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ isCompleted: undefined }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ isCompleted: false }))
      ).toBe(false);
    });

    it('rejects warmups and skipped sets', () => {
      const ex = createDummyExercise();
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ isWarmup: true }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ isSkipped: true }))
      ).toBe(false);
    });

    it('rejects non-weighted modalities', () => {
      const set = createDummySet();
      expect(
        isHighConfidencePerformanceSetEligible(
          createDummyExercise({ modality: 'bodyweight' }),
          set
        )
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(
          createDummyExercise({ modality: 'assisted' }),
          set
        )
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(
          createDummyExercise({ modality: 'timed' }),
          set
        )
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(
          createDummyExercise({ modality: 'distance' }),
          set
        )
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(
          createDummyExercise({ modality: 'distance_loaded' }),
          set
        )
      ).toBe(false);
    });

    it('rejects loose form sets', () => {
      const ex = createDummyExercise();
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ form: 'loose' }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ form: 'standard' }))
      ).toBe(true);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ form: 'strict' }))
      ).toBe(true);
    });

    it('rejects missing, invalid or out of range RPE without fallback', () => {
      const ex = createDummyExercise();
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ rpe: null }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ rpe: undefined }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ rpe: 5.5 }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ rpe: 10.5 }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ rpe: NaN }))
      ).toBe(false);
    });

    it('rejects invalid weights and reps', () => {
      const ex = createDummyExercise();
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ weight: 0 }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ weight: -10 }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ reps: 0 }))
      ).toBe(false);
      expect(
        isHighConfidencePerformanceSetEligible(ex, createDummySet({ reps: 5.5 }))
      ).toBe(false);
    });
  });

  describe('Chronological Ordering, Date Fallback and Precedence', () => {
    it('orders logs by calendar date first', () => {
      const log1 = createDummyLog({ id: 'log-1700000000001', date: '2025-01-10' });
      const log2 = createDummyLog({ id: 'log-1700000000002', date: '2025-01-12' });
      const log3 = createDummyLog({ id: 'log-1700000000003', date: '2025-01-15' });

      const all = [log3, log1, log2];
      const precedingForLog2 = getStrictlyPrecedingLogs(log2, all);
      expect(precedingForLog2).toEqual([log1]);

      const precedingForLog3 = getStrictlyPrecedingLogs(log3, all);
      expect(precedingForLog3).toEqual([log1, log2]);
    });

    it('breaks same-day ties using valid log- prefixed timestamp IDs', () => {
      const logA = createDummyLog({ id: 'log-1700000000100', date: '2025-01-15' });
      const logB = createDummyLog({ id: 'log-1700000000200', date: '2025-01-15' });
      const all = [logB, logA];

      expect(getStrictlyPrecedingLogs(logB, all)).toEqual([logA]);
      expect(getStrictlyPrecedingLogs(logA, all)).toEqual([]);
    });

    it('plain numeric 12-plus-digit IDs work', () => {
      const logA = createDummyLog({ id: '1700000000100', date: '2025-01-15' });
      const logB = createDummyLog({ id: '1700000000200', date: '2025-01-15' });
      const all = [logA, logB];

      expect(getStrictlyPrecedingLogs(logB, all)).toEqual([logA]);
      expect(getStrictlyPrecedingLogs(logA, all)).toEqual([]);
    });

    it('log- prefixed 12-plus-digit IDs work', () => {
      const logA = createDummyLog({ id: 'log-1700000000100', date: '2025-01-15' });
      const logB = createDummyLog({ id: 'log-1700000000200', date: '2025-01-15' });
      const all = [logA, logB];

      expect(getStrictlyPrecedingLogs(logB, all)).toEqual([logA]);
      expect(getStrictlyPrecedingLogs(logA, all)).toEqual([]);
    });

    it('arbitrary IDs containing short numbers are not interpreted as timestamps', () => {
      const logA = createDummyLog({ id: 'prog-tpl-123', date: '2025-01-15' });
      const logB = createDummyLog({ id: 'user-999', date: '2025-01-15' });
      const all = [logA, logB];

      expect(getStrictlyPrecedingLogs(logB, all)).toEqual([logA]);
      expect(getStrictlyPrecedingLogs(logA, all)).toEqual([]);
    });

    it('same-day arbitrary IDs preserve storage order', () => {
      const logA = createDummyLog({ id: 'uuid-alpha', date: '2025-01-15' });
      const logB = createDummyLog({ id: 'uuid-beta', date: '2025-01-15' });
      const all = [logA, logB];

      expect(getStrictlyPrecedingLogs(logB, all)).toEqual([logA]);
      expect(getStrictlyPrecedingLogs(logA, all)).toEqual([]);
    });

    it('invalid target date with no timestamp ID returns no preceding logs', () => {
      const logA = createDummyLog({ id: 'uuid-alpha', date: '2025-01-10' });
      const target = createDummyLog({ id: 'uuid-target', date: 'invalid-date' });
      const all = [logA, target];

      expect(getStrictlyPrecedingLogs(target, all)).toEqual([]);
    });

    it('invalid target date with valid log- timestamp can be ordered', () => {
      const logA = createDummyLog({ id: 'log-1700000000100', date: '2023-11-14' });
      const target = createDummyLog({ id: 'log-1700000000500', date: 'invalid-date' });
      const all = [logA, target];

      expect(getStrictlyPrecedingLogs(target, all)).toEqual([logA]);
    });

    it('invalid historical candidate with arbitrary ID cannot contaminate a valid target', () => {
      const badCandidate = createDummyLog({ id: 'uuid-bad', date: 'not-a-date' });
      const goodTarget = createDummyLog({ id: 'log-1700000000200', date: '2025-01-15' });
      const all = [badCandidate, goodTarget];

      expect(getStrictlyPrecedingLogs(goodTarget, all)).toEqual([]);
    });

    it('a cloned target object with one uniquely matching ID resolves safely', () => {
      const logA = createDummyLog({ id: 'log-1700000000100', date: '2025-01-10' });
      const logB = createDummyLog({ id: 'log-1700000000200', date: '2025-01-15' });
      const all = [logA, logB];

      const clonedTarget = { ...logB };
      expect(getStrictlyPrecedingLogs(clonedTarget, all)).toEqual([logA]);
    });

    it('duplicate matching IDs without identity return empty history', () => {
      const logA = createDummyLog({ id: 'duplicate-id', date: '2025-01-10' });
      const logB = createDummyLog({ id: 'duplicate-id', date: '2025-01-15' });
      const all = [logA, logB];

      const clonedTarget = { id: 'duplicate-id', date: '2025-01-15', exercises: [], unit: 'kg' as const };
      expect(getStrictlyPrecedingLogs(clonedTarget, all)).toEqual([]);
    });

    it('future workouts never affect preceding scorecards', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 110, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const futureLog = createDummyLog({
        id: 'log-1700000000003',
        date: '2025-01-10',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 150, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const allWithFuture = [pastLog, currentLog, futureLog];
      const allWithoutFuture = [pastLog, currentLog];

      const scoreWithFuture = generateDiaryScorecard(currentLog, allWithFuture);
      const scoreWithoutFuture = generateDiaryScorecard(currentLog, allWithoutFuture);

      expect(scoreWithFuture.insights.map(i => i.id)).toEqual(
        scoreWithoutFuture.insights.map(i => i.id)
      );
      expect(scoreWithFuture.insights.find(i => i.id === 'load_pr')).toBeDefined();
    });
  });

  describe('Tonnage Accounting and Drop Sets', () => {
    it('calculates parent plus drop-subsets without double-counting parent or subsets as sets', () => {
      const ex = createDummyExercise({
        sets: [
          createDummySet({
            weight: 100,
            reps: 10,
            isDropSet: true,
            dropSubSets: [
              { weight: 80, reps: 8 },
              { weight: 60, reps: 6 },
            ],
          }),
        ],
      });

      const tonnage = calculateExerciseTonnageKg(ex, 'kg');
      expect(tonnage).toBe(100 * 10 + 80 * 8 + 60 * 6);
    });

    it('converts lb to kg accurately in tonnage calculation', () => {
      const ex = createDummyExercise({
        sets: [createDummySet({ weight: 220.462262, reps: 10 })],
      });
      const tonnage = calculateExerciseTonnageKg(ex, 'lb');
      expect(tonnage).toBeCloseTo(1000, 1);
    });
  });

  describe('Primary Classification Rules', () => {
    it('classifies Peak / Test Path A: at least 2 heavy compound sets at RPE 9.0+ (reps 1-3)', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            movementCategory: 'compound',
            sets: [
              createDummySet({ weight: 150, reps: 2, rpe: 9.0 }),
              createDummySet({ weight: 155, reps: 1, rpe: 9.5 }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('peak_test');
    });

    it('classifies Peak / Test Path B: 1 maximal single with at least 2 supporting strength sets', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            movementCategory: 'compound',
            sets: [
              createDummySet({ weight: 160, reps: 1, rpe: 9.5 }),
              createDummySet({ weight: 140, reps: 5, rpe: 8.0 }),
              createDummySet({ weight: 140, reps: 5, rpe: 8.5 }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('peak_test');
    });

    it('peak single alone does not qualify for Peak / Test', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            movementCategory: 'compound',
            sets: [
              createDummySet({ weight: 160, reps: 1, rpe: 9.5 }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('strength_focus');
    });

    it('peak single plus one additional strength-style set does not qualify for Peak / Test', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            movementCategory: 'compound',
            sets: [
              createDummySet({ weight: 160, reps: 1, rpe: 9.5 }),
              createDummySet({ weight: 140, reps: 3, rpe: 8.0 }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('strength_focus');
    });

    it('peak single plus two additional supporting strength sets on the same exercise qualifies', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            movementCategory: 'compound',
            sets: [
              createDummySet({ weight: 180, reps: 1, rpe: 10.0 }),
              createDummySet({ weight: 150, reps: 4, rpe: 7.5 }),
              createDummySet({ weight: 140, reps: 5, rpe: 7.0 }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('peak_test');
    });

    it('classifies Conditioning / Capacity when > 50% of working sets are endurance modalities', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            modality: 'timed',
            sets: [
              createDummySet({ weight: 300, reps: null }),
              createDummySet({ weight: 300, reps: null }),
            ],
          }),
          createDummyExercise({
            modality: 'weighted',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('conditioning_capacity');
    });

    it('does not classify Conditioning when exactly 50% of working sets are endurance', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            modality: 'timed',
            sets: [createDummySet({ weight: 300, reps: null })],
          }),
          createDummyExercise({
            modality: 'weighted',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('strength_focus');
    });

    it('gives Recovery / Deload precedence when objective is Deload even if technique is strict', () => {
      const log = createDummyLog({
        objective: 'Deload',
        exercises: [
          createDummyExercise({
            sets: [
              createDummySet({ weight: 60, reps: 5, rpe: 6.0, form: 'strict' }),
              createDummySet({ weight: 60, reps: 5, rpe: 6.0, form: 'strict' }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('recovery_deload');
    });

    it('classifies Technique / Practice when >= 60% technique-style sets and no set exceeds RPE 7.5', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            sets: [
              createDummySet({ setNumber: 1, weight: 80, reps: 3, rpe: 6.0, form: 'strict' }),
              createDummySet({ setNumber: 2, weight: 80, reps: 3, rpe: 6.5, form: 'strict' }),
              createDummySet({ setNumber: 3, weight: 80, reps: 3, rpe: 6.0, form: 'strict' }),
              createDummySet({ setNumber: 4, weight: 80, reps: 3, rpe: 6.5, form: 'strict' }),
              createDummySet({ setNumber: 5, weight: 80, reps: 3, rpe: 6.0, form: 'strict' }),
              createDummySet({ setNumber: 6, weight: 80, reps: 3, rpe: 6.5, form: 'strict' }),
              createDummySet({ setNumber: 7, weight: 90, reps: 3, rpe: 7.0, form: 'standard' }),
              createDummySet({ setNumber: 8, weight: 90, reps: 3, rpe: 7.0, form: 'standard' }),
              createDummySet({ setNumber: 9, weight: 90, reps: 3, rpe: 7.5, form: 'standard' }),
              createDummySet({ setNumber: 10, weight: 90, reps: 3, rpe: 7.5, form: 'standard' }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('technique_practice');
    });

    it('classifies Strength Focus when strength sets > 50%', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            sets: [
              createDummySet({ weight: 100, reps: 5, rpe: 8.0 }),
              createDummySet({ weight: 100, reps: 5, rpe: 8.5 }),
              createDummySet({ weight: 60, reps: 10, rpe: 8.0 }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('strength_focus');
    });

    it('classifies Hypertrophy Focus when hypertrophy sets > 50%', () => {
      const log = createDummyLog({
        exercises: [
          createDummyExercise({
            sets: [
              createDummySet({ weight: 70, reps: 10, rpe: 7.5 }),
              createDummySet({ weight: 70, reps: 12, rpe: 8.0 }),
              createDummySet({ weight: 100, reps: 5, rpe: 8.0 }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('hypertrophy_focus');
    });

    it('handles exact 50/50 Strength and Hypertrophy ties with objective', () => {
      const makeTieLog = (objective?: any) =>
        createDummyLog({
          objective,
          exercises: [
            createDummyExercise({
              sets: [
                createDummySet({ weight: 100, reps: 5, rpe: 8.0 }),
                createDummySet({ weight: 70, reps: 10, rpe: 8.0 }),
              ],
            }),
          ],
        });

      expect(classifyDiaryWorkout(makeTieLog('Strength')).id).toBe('strength_focus');
      expect(classifyDiaryWorkout(makeTieLog('Hypertrophy')).id).toBe('hypertrophy_focus');
      expect(classifyDiaryWorkout(makeTieLog('Off')).id).toBe('mixed_session');
      expect(classifyDiaryWorkout(makeTieLog(undefined)).id).toBe('mixed_session');
    });

    it('objective Off does not force Mixed when observed structure clearly satisfies a primary category', () => {
      const log = createDummyLog({
        objective: 'Off',
        exercises: [
          createDummyExercise({
            sets: [
              createDummySet({ weight: 100, reps: 5, rpe: 8.0 }),
              createDummySet({ weight: 100, reps: 5, rpe: 8.5 }),
              createDummySet({ weight: 100, reps: 5, rpe: 8.0 }),
            ],
          }),
        ],
      });
      expect(classifyDiaryWorkout(log).id).toBe('strength_focus');
    });

    it('classifies Mixed Session when empty or unstructured', () => {
      const emptyLog = createDummyLog({ exercises: [] });
      expect(classifyDiaryWorkout(emptyLog).id).toBe('mixed_session');
    });
  });

  describe('Session Performance Index', () => {
    it('calculates index for a single main movement with at least 3 exposures', () => {
      const pastLogs = [
        createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })], // e1RM ~ 116.7
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-03',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 102, reps: 5, rpe: 8.0 })], // e1RM ~ 119.0
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-05',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 104, reps: 5, rpe: 8.0 })], // e1RM ~ 121.3
            }),
          ],
        }),
      ];

      const currentLog = createDummyLog({
        id: 'log-1700000000004',
        date: '2025-01-08',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            isMainMovement: true,
            sets: [createDummySet({ weight: 102, reps: 5, rpe: 8.0 })], // e1RM ~ 119.0
          }),
        ],
      });

      const all = [...pastLogs, currentLog];
      const index = calculateSessionPerformanceIndex(currentLog, all);
      expect(index).not.toBeNull();
      expect(index).toBeCloseTo(1.0, 2);
    });

    it('returns null when single movement is not main or has fewer than 3 exposures', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        exercises: [
          createDummyExercise({
            name: 'Bicep Curl',
            isMainMovement: false,
            sets: [createDummySet({ weight: 20, reps: 10, rpe: 8.0 })],
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Bicep Curl',
            isMainMovement: false,
            sets: [createDummySet({ weight: 20, reps: 10, rpe: 8.0 })],
          }),
        ],
      });

      expect(calculateSessionPerformanceIndex(currentLog, [pastLog, currentLog])).toBeNull();
    });

    it('calculates index for multi-exercise sessions with at least 2 exposures each', () => {
      const pastLogs = [
        createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          exercises: [
            createDummyExercise({
              name: 'Bench Press',
              sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
            }),
            createDummyExercise({
              name: 'Barbell Row',
              sets: [createDummySet({ weight: 80, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-03',
          exercises: [
            createDummyExercise({
              name: 'Bench Press',
              sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
            }),
            createDummyExercise({
              name: 'Barbell Row',
              sets: [createDummySet({ weight: 80, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
      ];

      const currentLog = createDummyLog({
        id: 'log-1700000000003',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
          }),
          createDummyExercise({
            name: 'Barbell Row',
            sets: [createDummySet({ weight: 80, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const all = [...pastLogs, currentLog];
      const index = calculateSessionPerformanceIndex(currentLog, all);
      expect(index).not.toBeNull();
      expect(index).toBeCloseTo(1.0, 2);
    });
  });

  describe('Specific Insights Evaluation (All 16 Rules)', () => {
    // 1. New Strength Ceiling
    it('triggers New Strength Ceiling and suppresses Quiet Progress', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        exercises: [
          createDummyExercise({
            name: 'Deadlift',
            sets: [createDummySet({ weight: 200, reps: 5, rpe: 8.0 })],
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Deadlift',
            sets: [createDummySet({ weight: 220, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [pastLog, currentLog]);
      expect(insights.some(i => i.id === 'new_strength_ceiling')).toBe(true);
      expect(insights.some(i => i.id === 'quiet_progress')).toBe(false);
    });

    // 2. Load PR
    it('triggers Load PR when normalized load strictly exceeds previous', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        unit: 'lb',
        exercises: [
          createDummyExercise({
            name: 'Deadlift',
            sets: [createDummySet({ weight: 440, reps: 1, rpe: 9.0 })], // ~ 199.58 kg
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        unit: 'kg',
        exercises: [
          createDummyExercise({
            name: 'Deadlift',
            sets: [createDummySet({ weight: 205, reps: 1, rpe: 9.0 })], // 205 kg > 199.58 kg
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [pastLog, currentLog]);
      expect(insights.some(i => i.id === 'load_pr')).toBe(true);
    });

    it('prevents false Load PR across mixed units (e.g. 100 lb vs 90 kg)', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        unit: 'kg',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 90, reps: 5, rpe: 8.0 })], // 90 kg
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        unit: 'lb',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })], // 100 lb ~ 45.3 kg
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [pastLog, currentLog]);
      expect(insights.some(i => i.id === 'load_pr')).toBe(false);
    });

    // 3. Rep PR
    it('triggers Rep PR for exact same normalized quantized load', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100, reps: 6, rpe: 8.5 })],
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100, reps: 8, rpe: 9.0 })],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [pastLog, currentLog]);
      expect(insights.some(i => i.id === 'rep_pr')).toBe(true);
    });

    it('unit-equivalence fixture: 100.00 kg vs 220.462262 lb does not earn false Load PR, but higher reps earns Rep PR', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        unit: 'kg',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100.00, reps: 5, rpe: 8.0 })],
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        unit: 'lb',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 220.462262, reps: 8, rpe: 8.5 })],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [pastLog, currentLog]);
      expect(insights.some(i => i.id === 'load_pr')).toBe(false);
      expect(insights.some(i => i.id === 'rep_pr')).toBe(true);
    });

    // 4. Exercise Tonnage PR
    it('triggers Exercise Tonnage PR using at least two prior eligible exercise sessions', () => {
      const pastLog1 = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 100, reps: 5 })], // 500 kg
          }),
        ],
      });
      const pastLog2 = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-03',
        unit: 'lb',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 220.462262, reps: 6 })], // ~ 600 kg
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000003',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [
              createDummySet({
                weight: 100,
                reps: 6,
                isDropSet: true,
                dropSubSets: [{ weight: 80, reps: 5 }],
              }), // 600 + 400 = 1000 kg
            ],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [pastLog1, pastLog2, currentLog]);
      expect(insights.some(i => i.id === 'exercise_tonnage_pr')).toBe(true);
    });

    it('does not trigger Exercise Tonnage PR with only 1 prior session', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 100, reps: 5 })],
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 100, reps: 10 })],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [pastLog, currentLog]);
      expect(insights.some(i => i.id === 'exercise_tonnage_pr')).toBe(false);
    });

    // 5. Quiet Progress
    it('triggers Quiet Progress when exceeding rolling 28-day median without all-time PR', () => {
      const oldAllTimePrLog = createDummyLog({
        id: 'log-1700000000000',
        date: '2024-11-01', // 70 days ago (all-time peak e1RM 150 kg)
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 130, reps: 5, rpe: 8.5 })], // e1RM ~ 156
          }),
        ],
      });
      const exp1 = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-02', // within 28 days
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })], // e1RM ~ 116.7
          }),
        ],
      });
      const exp2 = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })], // e1RM ~ 116.7
          }),
        ],
      });
      const exp3 = createDummyLog({
        id: 'log-1700000000003',
        date: '2025-01-09',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })], // e1RM ~ 116.7
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000004',
        date: '2025-01-15',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 105, reps: 5, rpe: 8.0 })], // e1RM ~ 122.5 (> 1.025 * 116.7 = 119.6, but < 156)
          }),
        ],
      });

      const all = [oldAllTimePrLog, exp1, exp2, exp3, currentLog];
      const insights = generateDiaryInsights(currentLog, all);
      expect(insights.some(i => i.id === 'quiet_progress')).toBe(true);
      expect(insights.some(i => i.id === 'new_strength_ceiling')).toBe(false);
    });

    it('does not trigger Quiet Progress with fewer than 3 exposures in 28 days', () => {
      const exp1 = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
          }),
        ],
      });
      const exp2 = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-08',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000003',
        date: '2025-01-15',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 105, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [exp1, exp2, currentLog]);
      expect(insights.some(i => i.id === 'quiet_progress')).toBe(false);
    });

    // 6. Back in Action
    it('triggers Back in Action when calendar gap is >= 14 days', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-20', // 19 days later
      });

      const insights = generateDiaryInsights(currentLog, [pastLog, currentLog]);
      expect(insights.some(i => i.id === 'back_in_action')).toBe(true);
    });

    // 7. Heavy Exposure
    it('triggers Heavy Exposure with 3 qualifying heavy sets against baseline', () => {
      const pastLogs = [
        createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })], // e1RM ~ 123.3
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-03',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-05',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
      ];

      // 85% of ~123.3 is ~104.8 kg. 110 kg is >= 85% and <= 5 reps.
      const currentLog = createDummyLog({
        id: 'log-1700000000004',
        date: '2025-01-08',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [
              createDummySet({ weight: 110, reps: 3, rpe: 8.0 }),
              createDummySet({ weight: 110, reps: 3, rpe: 8.5 }),
              createDummySet({ weight: 110, reps: 3, rpe: 9.0 }),
            ],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [...pastLogs, currentLog]);
      expect(insights.some(i => i.id === 'heavy_exposure')).toBe(true);
    });

    it('does not trigger Heavy Exposure with only 2 qualifying sets or insufficient history', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [
              createDummySet({ weight: 100, reps: 3, rpe: 8.0 }),
              createDummySet({ weight: 100, reps: 3, rpe: 8.5 }),
            ],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [pastLog, currentLog]);
      expect(insights.some(i => i.id === 'heavy_exposure')).toBe(false);
    });

    // 8. Consistent Output
    it('triggers Consistent Output and suppresses Steep Fatigue Drop', () => {
      const currentLog = createDummyLog({
        exercises: [
          createDummyExercise({
            name: 'Overhead Press',
            sets: [
              createDummySet({ weight: 60, reps: 5, rpe: 8.0 }),
              createDummySet({ weight: 60, reps: 5, rpe: 8.0 }),
              createDummySet({ weight: 60, reps: 5, rpe: 8.0 }),
            ],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [currentLog]);
      expect(insights.some(i => i.id === 'consistent_output')).toBe(true);
      expect(insights.some(i => i.id === 'steep_fatigue_drop')).toBe(false);
    });

    // 9. Steep Fatigue Drop
    it('triggers Steep Fatigue Drop when final set e1RM drops > 12%', () => {
      const currentLog = createDummyLog({
        exercises: [
          createDummyExercise({
            name: 'Overhead Press',
            sets: [
              createDummySet({ weight: 60, reps: 6, rpe: 7.5 }), // e1RM ~ 74.2
              createDummySet({ weight: 60, reps: 4, rpe: 8.5 }),
              createDummySet({ weight: 60, reps: 3, rpe: 9.5 }), // e1RM ~ 63.8 (drop > 14%)
            ],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [currentLog]);
      expect(insights.some(i => i.id === 'steep_fatigue_drop')).toBe(true);
      expect(insights.some(i => i.id === 'consistent_output')).toBe(false);
    });

    // 10. Recovery Strain
    it('triggers Recovery Strain when performance index < 0.96 and sleep is low (<=5.5h)', () => {
      const pastLogs = [
        createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 140, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-03',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 140, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-05',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 140, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
      ];

      const currentLog = createDummyLog({
        id: 'log-1700000000004',
        date: '2025-01-08',
        recovery: { sleepHours: 4.5, soreness: 4 },
        exercises: [
          createDummyExercise({
            name: 'Squat',
            isMainMovement: true,
            sets: [createDummySet({ weight: 120, reps: 5, rpe: 8.5 })], // index ~ 0.83
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [...pastLogs, currentLog]);
      expect(insights.some(i => i.id === 'recovery_strain')).toBe(true);
      expect(insights.some(i => i.id === 'against_the_odds')).toBe(false);
    });

    it('default recovery values (sleep 7.5, soreness 3) or null suppress Recovery Strain and Against the Odds', () => {
      const pastLogs = [
        createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 140, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-03',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 140, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-05',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 140, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
      ];

      const defaultRecoveryLog = createDummyLog({
        id: 'log-1700000000004',
        date: '2025-01-08',
        recovery: { sleepHours: 7.5, soreness: 3 },
        exercises: [
          createDummyExercise({
            name: 'Squat',
            isMainMovement: true,
            sets: [createDummySet({ weight: 120, reps: 5, rpe: 8.5 })],
          }),
        ],
      });

      const missingRecoveryLog = createDummyLog({
        id: 'log-1700000000005',
        date: '2025-01-09',
        recovery: undefined,
        exercises: [
          createDummyExercise({
            name: 'Squat',
            isMainMovement: true,
            sets: [createDummySet({ weight: 120, reps: 5, rpe: 8.5 })],
          }),
        ],
      });

      const insights1 = generateDiaryInsights(defaultRecoveryLog, [...pastLogs, defaultRecoveryLog]);
      expect(insights1.some(i => i.id === 'recovery_strain' || i.id === 'against_the_odds')).toBe(false);

      const insights2 = generateDiaryInsights(missingRecoveryLog, [...pastLogs, missingRecoveryLog]);
      expect(insights2.some(i => i.id === 'recovery_strain' || i.id === 'against_the_odds')).toBe(false);
    });

    // 11. Form Drift
    it('triggers Form Drift when exercise starts strict/standard and has 2+ later loose sets', () => {
      const currentLog = createDummyLog({
        exercises: [
          createDummyExercise({
            name: 'Barbell Row',
            sets: [
              createDummySet({ setNumber: 1, form: 'strict' }),
              createDummySet({ setNumber: 2, form: 'loose' }),
              createDummySet({ setNumber: 3, form: 'loose' }),
            ],
          }),
        ],
      });
      const insights = generateDiaryInsights(currentLog, [currentLog]);
      expect(insights.some(i => i.id === 'form_drift')).toBe(true);
    });

    // 12. High Exertion
    it('triggers High Exertion when 3+ sets have RPE >= 9.0', () => {
      const currentLog = createDummyLog({
        exercises: [
          createDummyExercise({
            sets: [
              createDummySet({ rpe: 9.0 }),
              createDummySet({ rpe: 9.5 }),
              createDummySet({ rpe: 10.0 }),
            ],
          }),
        ],
      });
      const insights = generateDiaryInsights(currentLog, [currentLog]);
      expect(insights.some(i => i.id === 'high_exertion')).toBe(true);
    });

    // 13. Against the Odds
    it('triggers Against the Odds when performance index >= 1.00 alongside high soreness (>=7)', () => {
      const pastLogs = [
        createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 140, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-03',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 140, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
        createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-05',
          exercises: [
            createDummyExercise({
              name: 'Squat',
              isMainMovement: true,
              sets: [createDummySet({ weight: 140, reps: 5, rpe: 8.0 })],
            }),
          ],
        }),
      ];

      const currentLog = createDummyLog({
        id: 'log-1700000000004',
        date: '2025-01-08',
        recovery: { sleepHours: 7.5, soreness: 8 },
        exercises: [
          createDummyExercise({
            name: 'Squat',
            isMainMovement: true,
            sets: [createDummySet({ weight: 145, reps: 5, rpe: 8.0 })], // index ~ 1.035
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [...pastLogs, currentLog]);
      expect(insights.some(i => i.id === 'against_the_odds')).toBe(true);
      expect(insights.some(i => i.id === 'recovery_strain')).toBe(false);
    });

    // 14. Muscle Focus
    it('triggers Muscle Focus when >= 60% of labelled sets target one muscle group', () => {
      const currentLog = createDummyLog({
        exercises: [
          createDummyExercise({
            muscleGroup: 'Chest',
            sets: [
              createDummySet({ setNumber: 1 }),
              createDummySet({ setNumber: 2 }),
              createDummySet({ setNumber: 3 }),
              createDummySet({ setNumber: 4 }),
            ],
          }),
          createDummyExercise({
            name: 'Tricep Extension',
            muscleGroup: 'Triceps',
            sets: [
              createDummySet({ setNumber: 1 }),
              createDummySet({ setNumber: 2 }),
            ],
          }),
        ],
      });
      const insights = generateDiaryInsights(currentLog, [currentLog]);
      const mf = insights.find(i => i.id === 'muscle_focus');
      expect(mf).toBeDefined();
      expect(mf?.muscleGroup).toBe('Chest');
    });

    // 15. Minimalist Session
    it('triggers Minimalist Session for 3 to 6 total completed working sets', () => {
      const currentLog = createDummyLog({
        exercises: [
          createDummyExercise({
            sets: [
              createDummySet({ setNumber: 1 }),
              createDummySet({ setNumber: 2 }),
              createDummySet({ setNumber: 3 }),
              createDummySet({ setNumber: 4 }),
            ],
          }),
        ],
      });
      const insights = generateDiaryInsights(currentLog, [currentLog]);
      expect(insights.some(i => i.id === 'minimalist_session')).toBe(true);
    });

    // 16. Compound Dominant
    it('triggers Compound Dominant when >= 70% of classified sets are compound', () => {
      const currentLog = createDummyLog({
        exercises: [
          createDummyExercise({
            movementCategory: 'compound',
            sets: [
              createDummySet({ setNumber: 1 }),
              createDummySet({ setNumber: 2 }),
              createDummySet({ setNumber: 3 }),
              createDummySet({ setNumber: 4 }),
            ],
          }),
          createDummyExercise({
            movementCategory: 'isolation',
            sets: [createDummySet({ setNumber: 1 })],
          }),
        ],
      });
      const insights = generateDiaryInsights(currentLog, [currentLog]);
      expect(insights.some(i => i.id === 'compound_dominant')).toBe(true);
    });
  });

  describe('Rarity Tier Calculations', () => {
    it('sets rarity to personal_first when >=1 preceding log exists and insight has never occurred', () => {
      const pastLog = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
          }),
        ],
      });
      const currentLog = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Squat',
            sets: [createDummySet({ weight: 120, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const insights = generateDiaryInsights(currentLog, [pastLog, currentLog]);
      const pr = insights.find(i => i.id === 'new_strength_ceiling');
      expect(pr?.rarity).toBe('personal_first');
    });

    it('keeps rarity null when fewer than 20 preceding workouts exist and it is not a personal first', () => {
      const logs: WorkoutLog[] = [];
      for (let i = 1; i <= 5; i++) {
        logs.push(
          createDummyLog({
            id: `log-170000000000${i}`,
            date: `2025-01-0${i}`,
            exercises: [
              createDummyExercise({
                sets: [createDummySet(), createDummySet(), createDummySet(), createDummySet()],
              }),
            ],
          })
        );
      }

      const lastLog = logs[logs.length - 1];
      const insights = generateDiaryInsights(lastLog, logs);
      const ms = insights.find(i => i.id === 'minimalist_session');
      expect(ms?.rarity).toBeNull();
    });

    it('calculates rare, notable, common correctly when >= 20 preceding workouts exist', () => {
      const logs: WorkoutLog[] = [];
      for (let i = 1; i <= 25; i++) {
        const isMinimalist = i === 1; // 1 out of 24 preceding workouts (< 5%)
        logs.push(
          createDummyLog({
            id: `log-17000000000${i < 10 ? '0' + i : i}`,
            date: `2025-01-${i < 10 ? '0' + i : i}`,
            exercises: [
              createDummyExercise({
                sets: isMinimalist
                  ? [createDummySet(), createDummySet(), createDummySet(), createDummySet()]
                  : [
                      createDummySet(),
                      createDummySet(),
                      createDummySet(),
                      createDummySet(),
                      createDummySet(),
                      createDummySet(),
                      createDummySet(),
                      createDummySet(),
                    ],
              }),
            ],
          })
        );
      }

      const targetLog = createDummyLog({
        id: 'log-1700000000099',
        date: '2025-01-30',
        exercises: [
          createDummyExercise({
            sets: [createDummySet(), createDummySet(), createDummySet(), createDummySet()],
          }),
        ],
      });

      const all = [...logs, targetLog];
      const insights = generateDiaryInsights(targetLog, all);
      const ms = insights.find(i => i.id === 'minimalist_session');
      expect(ms?.rarity).toBe('rare');
    });
  });

  describe('Collapsed Scorecard and Overflow', () => {
    it('sorts insights by strict priority and slices to top 2 for collapsed card', () => {
      const targetLog = createDummyLog({
        exercises: [
          createDummyExercise({
            movementCategory: 'compound',
            muscleGroup: 'Chest',
            sets: [
              createDummySet({ rpe: 9.0 }),
              createDummySet({ rpe: 9.5 }),
              createDummySet({ rpe: 10.0 }),
            ],
          }),
        ],
      });

      const scorecard = generateDiaryScorecard(targetLog, [targetLog]);
      expect(scorecard.collapsedInsights.length).toBeLessThanOrEqual(2);
      expect(scorecard.overflowInsightCount).toBe(
        Math.max(0, scorecard.insights.length - scorecard.collapsedInsights.length)
      );

      for (let i = 0; i < scorecard.insights.length - 1; i++) {
        expect(scorecard.insights[i].priority).toBeLessThanOrEqual(
          scorecard.insights[i + 1].priority
        );
      }
    });
  });

  describe('Deterministic Engine Invariants', () => {
    it('produces immutable and strictly deterministic output on repeated runs', () => {
      const logA = createDummyLog({ date: '2025-01-01' });
      const logB = createDummyLog({ date: '2025-01-05' });
      const all = [logA, logB];

      const res1 = generateDiaryScorecard(logB, all);
      const res2 = generateDiaryScorecard(logB, all);

      expect(res1).toEqual(res2);
    });

    it('numeric evidence contains no NaN or Infinity', () => {
      const log = createDummyLog();
      const scorecard = generateDiaryScorecard(log, [log]);
      scorecard.insights.forEach(ins => {
        if (ins.numericEvidence) {
          Object.values(ins.numericEvidence).forEach(val => {
            expect(Number.isFinite(val)).toBe(true);
            expect(Number.isNaN(val)).toBe(false);
          });
        }
      });
    });
  });

  describe('Batch Engine Parity Tests (generateDiaryScorecardMap vs generateDiaryScorecard)', () => {
    it('achieves 100% deep equality for chronological and reverse-chronological input arrays', () => {
      const log1 = createDummyLog({
        id: 'log-1700000000001',
        date: '2025-01-01',
        exercises: [
          createDummyExercise({
            name: 'Back Squat',
            muscleGroup: 'Quads',
            movementCategory: 'compound',
            sets: [
              createDummySet({ weight: 100, reps: 5, rpe: 8.0 }),
              createDummySet({ weight: 100, reps: 5, rpe: 8.0 }),
              createDummySet({ weight: 100, reps: 5, rpe: 8.0 }),
            ],
          }),
        ],
      });

      const log2 = createDummyLog({
        id: 'log-1700000000002',
        date: '2025-01-05',
        exercises: [
          createDummyExercise({
            name: 'Back Squat',
            muscleGroup: 'Quads',
            movementCategory: 'compound',
            sets: [
              createDummySet({ weight: 105, reps: 5, rpe: 8.5 }),
              createDummySet({ weight: 105, reps: 5, rpe: 8.5 }),
              createDummySet({ weight: 105, reps: 5, rpe: 8.5 }),
            ],
          }),
        ],
      });

      const log3 = createDummyLog({
        id: 'log-1700000000003',
        date: '2025-01-10',
        recovery: { sleepHours: 4.5, soreness: 8 },
        exercises: [
          createDummyExercise({
            name: 'Back Squat',
            muscleGroup: 'Quads',
            movementCategory: 'compound',
            sets: [
              createDummySet({ weight: 110, reps: 5, rpe: 9.0 }),
              createDummySet({ weight: 110, reps: 5, rpe: 9.0 }),
              createDummySet({ weight: 110, reps: 5, rpe: 9.0 }),
            ],
          }),
        ],
      });

      const forwardLogs = [log1, log2, log3];
      const reverseLogs = [log3, log2, log1];

      const forwardMap = generateDiaryScorecardMap(forwardLogs);
      const reverseMap = generateDiaryScorecardMap(reverseLogs);

      forwardLogs.forEach(log => {
        const individual = generateDiaryScorecard(log, forwardLogs);
        expect(forwardMap[log.id]).toEqual(individual);
        expect(reverseMap[log.id]).toEqual(individual);
      });
    });

    it('matches parity with same-day logs, epoch-like IDs, and storage order', () => {
      const logA = createDummyLog({
        id: 'log-1700000000100',
        date: '2025-02-01',
        exercises: [
          createDummyExercise({
            name: 'Overhead Press',
            sets: [createDummySet({ weight: 50, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const logB = createDummyLog({
        id: 'log-1700000000200',
        date: '2025-02-01',
        exercises: [
          createDummyExercise({
            name: 'Overhead Press',
            sets: [createDummySet({ weight: 55, reps: 5, rpe: 8.5 })],
          }),
        ],
      });

      const sameDayLogs = [logA, logB];
      const batchMap = generateDiaryScorecardMap(sameDayLogs);

      sameDayLogs.forEach(log => {
        const individual = generateDiaryScorecard(log, sameDayLogs);
        expect(batchMap[log.id]).toEqual(individual);
      });
    });

    it('handles mixed kg and lb units in history with exact parity', () => {
      const logKg = createDummyLog({
        id: 'log-1700000000301',
        date: '2025-03-01',
        unit: 'kg',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const logLb = createDummyLog({
        id: 'log-1700000000302',
        date: '2025-03-05',
        unit: 'lb',
        exercises: [
          createDummyExercise({
            name: 'Bench Press',
            sets: [createDummySet({ weight: 225, reps: 5, rpe: 8.0 })],
          }),
        ],
      });

      const logs = [logKg, logLb];
      const batchMap = generateDiaryScorecardMap(logs);

      logs.forEach(log => {
        const individual = generateDiaryScorecard(log, logs);
        expect(batchMap[log.id]).toEqual(individual);
      });
    });

    it('handles modalities (bodyweight, assisted, timed, distance, distance_loaded)', () => {
      const log = createDummyLog({
        id: 'log-1700000000401',
        date: '2025-03-10',
        exercises: [
          createDummyExercise({
            name: 'Pull-up',
            modality: 'bodyweight',
            sets: [createDummySet({ weight: 0, reps: 10, rpe: 8.0 })],
          }),
          createDummyExercise({
            name: 'Assisted Dip',
            modality: 'assisted',
            sets: [createDummySet({ weight: 20, reps: 10, rpe: 7.0 })],
          }),
          createDummyExercise({
            name: 'Plank',
            modality: 'timed',
            sets: [createDummySet({ weight: 0, reps: 60, rpe: 7.0 })],
          }),
          createDummyExercise({
            name: 'Rowing',
            modality: 'distance',
            sets: [createDummySet({ weight: 0, reps: 2000, rpe: 7.0 })],
          }),
          createDummyExercise({
            name: 'Farmer Walk',
            modality: 'distance_loaded',
            sets: [createDummySet({ weight: 32, reps: 50, rpe: 8.0 })],
          }),
        ],
      });

      const logs = [log];
      const batchMap = generateDiaryScorecardMap(logs);
      expect(batchMap[log.id]).toEqual(generateDiaryScorecard(log, logs));
    });

    it('handles drop sets, drop sub-sets, and skipped sets with exact parity', () => {
      const log1 = createDummyLog({
        id: 'log-1700000000501',
        date: '2025-04-01',
        exercises: [
          createDummyExercise({
            name: 'Lateral Raise',
            sets: [
              createDummySet({
                weight: 12,
                reps: 12,
                rpe: 9.0,
                isDropSet: true,
                dropSubSets: [
                  { weight: 8, reps: 10 },
                  { weight: 5, reps: 10 },
                ],
              }),
              createDummySet({ isSkipped: true }),
            ],
          }),
          createDummyExercise({
            name: 'Skipped Exercise',
            isSkipped: true,
            sets: [createDummySet()],
          }),
        ],
      });

      const log2 = createDummyLog({
        id: 'log-1700000000502',
        date: '2025-04-05',
        exercises: [
          createDummyExercise({
            name: 'Lateral Raise',
            sets: [
              createDummySet({
                weight: 14,
                reps: 12,
                rpe: 9.0,
                isDropSet: true,
                dropSubSets: [
                  { weight: 10, reps: 10 },
                  { weight: 6, reps: 10 },
                ],
              }),
            ],
          }),
        ],
      });

      const logs = [log1, log2];
      const batchMap = generateDiaryScorecardMap(logs);

      logs.forEach(l => {
        expect(batchMap[l.id]).toEqual(generateDiaryScorecard(l, logs));
      });
    });

    it('omits ambiguous duplicate IDs from scorecard map', () => {
      const logA = createDummyLog({
        id: 'duplicate-id-123',
        date: '2025-05-01',
        exercises: [createDummyExercise({ name: 'Squat' })],
      });
      const logB = createDummyLog({
        id: 'duplicate-id-123',
        date: '2025-05-02',
        exercises: [createDummyExercise({ name: 'Deadlift' })],
      });
      const logC = createDummyLog({
        id: 'unique-id-456',
        date: '2025-05-03',
        exercises: [createDummyExercise({ name: 'Bench' })],
      });

      const logs = [logA, logB, logC];
      const batchMap = generateDiaryScorecardMap(logs);

      expect(batchMap['duplicate-id-123']).toBeUndefined();
      expect(batchMap['unique-id-456']).toBeDefined();
      expect(batchMap['unique-id-456']).toEqual(generateDiaryScorecard(logC, logs));
    });

    it('validates a complex multi-year 40-workout fixture across all classifications and insight rules', () => {
      const logs: WorkoutLog[] = [];
      const baseDate = new Date('2023-01-01');

      for (let i = 0; i < 40; i++) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i * 14); // 2-week intervals to trigger back_in_action
        const dateStr = d.toISOString().split('T')[0];

        const isPeak = i === 10;
        const isHypertrophy = i % 3 === 0;
        const isStrength = i % 3 === 1;

        let exercises: ExerciseEntry[] = [];

        if (isPeak) {
          exercises = [
            createDummyExercise({
              name: 'Competition Squat',
              movementCategory: 'compound',
              sets: [
                createDummySet({ weight: 200, reps: 1, rpe: 9.5 }),
                createDummySet({ weight: 170, reps: 3, rpe: 8.0 }),
                createDummySet({ weight: 170, reps: 3, rpe: 8.0 }),
              ],
            }),
          ];
        } else if (isHypertrophy) {
          exercises = [
            createDummyExercise({
              name: 'Incline Dumbbell Press',
              muscleGroup: 'Chest',
              movementCategory: 'compound',
              sets: [
                createDummySet({ weight: 30 + (i % 5), reps: 10, rpe: 8.0 }),
                createDummySet({ weight: 30 + (i % 5), reps: 10, rpe: 8.5 }),
                createDummySet({ weight: 30 + (i % 5), reps: 10, rpe: 9.0 }),
              ],
            }),
            createDummyExercise({
              name: 'Cable Fly',
              muscleGroup: 'Chest',
              movementCategory: 'isolation',
              sets: [
                createDummySet({ weight: 15, reps: 12, rpe: 8.0 }),
                createDummySet({ weight: 15, reps: 12, rpe: 8.0 }),
                createDummySet({ weight: 15, reps: 12, rpe: 8.5 }),
              ],
            }),
          ];
        } else if (isStrength) {
          exercises = [
            createDummyExercise({
              name: 'Deadlift',
              muscleGroup: 'Back',
              movementCategory: 'compound',
              sets: [
                createDummySet({ weight: 150 + i * 2, reps: 3, rpe: 8.5 }),
                createDummySet({ weight: 150 + i * 2, reps: 3, rpe: 8.5 }),
                createDummySet({ weight: 150 + i * 2, reps: 3, rpe: 9.0 }),
              ],
            }),
          ];
        } else {
          exercises = [
            createDummyExercise({
              name: 'Overhead Press',
              sets: [
                createDummySet({ weight: 50, reps: 5, rpe: 6.0, form: 'strict' }),
                createDummySet({ weight: 50, reps: 5, rpe: 6.0, form: 'strict' }),
                createDummySet({ weight: 50, reps: 5, rpe: 6.0, form: 'strict' }),
              ],
            }),
          ];
        }

        logs.push(
          createDummyLog({
            id: `log-${1700000000000 + i * 1000}`,
            date: dateStr,
            unit: i % 2 === 0 ? 'kg' : 'lb',
            recovery: i % 5 === 0 ? { sleepHours: 5.0, soreness: 8 } : undefined,
            exercises,
          })
        );
      }

      const batchMap = generateDiaryScorecardMap(logs);

      logs.forEach(log => {
        const individual = generateDiaryScorecard(log, logs);
        expect(batchMap[log.id]).toEqual(individual);
      });
    });
  });

  describe('Synthetic History Scaling and Immutability Test', () => {
    it('executes deterministically on a 1,000 workout history without throwing or mutating input', () => {
      const syntheticLogs: WorkoutLog[] = [];
      const baseDate = new Date('2020-01-01');

      for (let i = 0; i < 1000; i++) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i * 2);
        const dateStr = d.toISOString().split('T')[0];

        syntheticLogs.push(
          createDummyLog({
            id: `synth-log-${1000000000000 + i}`,
            date: dateStr,
            unit: 'kg',
            exercises: [
              createDummyExercise({
                name: i % 2 === 0 ? 'Barbell Squat' : 'Bench Press',
                muscleGroup: i % 2 === 0 ? 'Quads' : 'Chest',
                movementCategory: 'compound',
                sets: [
                  createDummySet({ weight: 100 + (i % 20), reps: 5, rpe: 8.0 }),
                  createDummySet({ weight: 100 + (i % 20), reps: 5, rpe: 8.5 }),
                  createDummySet({ weight: 100 + (i % 20), reps: 5, rpe: 9.0 }),
                ],
              }),
            ],
          })
        );
      }

      const cloneBefore = JSON.stringify(syntheticLogs);
      const batchMap = generateDiaryScorecardMap(syntheticLogs);
      const cloneAfter = JSON.stringify(syntheticLogs);

      // Verify immutability
      expect(cloneBefore).toBe(cloneAfter);

      // Verify map coverage
      expect(Object.keys(batchMap).length).toBe(1000);

      // Verify integrity
      syntheticLogs.forEach(log => {
        const card = batchMap[log.id];
        expect(card).toBeDefined();
        expect(card.primaryCategory).toBeDefined();
        expect(Array.isArray(card.insights)).toBe(true);
        expect(Array.isArray(card.collapsedInsights)).toBe(true);
        expect(Number.isFinite(card.overflowInsightCount)).toBe(true);

        card.insights.forEach(ins => {
          if (ins.numericEvidence) {
            Object.values(ins.numericEvidence).forEach(val => {
              expect(Number.isFinite(val)).toBe(true);
              expect(Number.isNaN(val)).toBe(false);
            });
          }
        });
      });
    });
  });

  describe('Canonical Multi-Modality Performance Insights (AS-5C Canonical Migration)', () => {
    describe('resolvePerformanceSetEvidence', () => {
      it('resolves valid weighted set', () => {
        const ex = createDummyExercise({ modality: 'weighted' });
        const set = createDummySet({ weight: 100, reps: 5, rpe: 8 });
        const res = resolvePerformanceSetEvidence(ex, set, 'kg', null);
        expect(res.status).toBe('valid');
        expect(res.effectiveLoadKg).toBe(100);
        expect(res.e1rmKg).toBeGreaterThan(100);
      });

      it('resolves valid bodyweight set with snapshot', () => {
        const ex = createDummyExercise({ name: 'Pull-up', modality: 'bodyweight' });
        const set = createDummySet({ weight: 0, reps: 5, rpe: 8 });
        const snapshot = { value: 75, unit: 'kg' as const };
        const res = resolvePerformanceSetEvidence(ex, set, 'kg', snapshot);
        expect(res.status).toBe('valid');
        expect(res.effectiveLoadKg).toBe(75);
        expect(res.e1rmKg).toBeGreaterThan(75);
      });

      it('resolves valid assisted set with snapshot', () => {
        const ex = createDummyExercise({ name: 'Assisted Pull-up', modality: 'assisted' });
        const set = createDummySet({ weight: 25, reps: 5, rpe: 8 });
        const snapshot = { value: 80, unit: 'kg' as const };
        const res = resolvePerformanceSetEvidence(ex, set, 'kg', snapshot);
        expect(res.status).toBe('valid');
        expect(res.effectiveLoadKg).toBe(55); // 80 - 25
      });

      it('returns unavailable for bodyweight/assisted set when snapshot is missing', () => {
        const ex = createDummyExercise({ name: 'Pull-up', modality: 'bodyweight' });
        const set = createDummySet({ weight: 0, reps: 5, rpe: 8 });
        const res = resolvePerformanceSetEvidence(ex, set, 'kg', null);
        expect(res.status).toBe('unavailable');
        expect(res.effectiveLoadKg).toBeNull();
        expect(res.e1rmKg).toBeNull();
      });

      it('returns invalid for assisted set when assistance exceeds bodyweight', () => {
        const ex = createDummyExercise({ name: 'Assisted Pull-up', modality: 'assisted' });
        const set = createDummySet({ weight: 90, reps: 5, rpe: 8 });
        const snapshot = { value: 80, unit: 'kg' as const };
        const res = resolvePerformanceSetEvidence(ex, set, 'kg', snapshot);
        expect(res.status).toBe('invalid');
        expect(res.effectiveLoadKg).toBeNull();
        expect(res.e1rmKg).toBeNull();
      });

      it('rejects loose form, skipped, warmup, or invalid RPE sets', () => {
        const ex = createDummyExercise({ modality: 'bodyweight' });
        const snapshot = { value: 80, unit: 'kg' as const };

        expect(
          resolvePerformanceSetEvidence(
            ex,
            createDummySet({ form: 'loose', weight: 0, reps: 5, rpe: 8 }),
            'kg',
            snapshot
          ).status
        ).toBe('invalid');

        expect(
          resolvePerformanceSetEvidence(
            ex,
            createDummySet({ isSkipped: true, weight: 0, reps: 5, rpe: 8 }),
            'kg',
            snapshot
          ).status
        ).toBe('invalid');

        expect(
          resolvePerformanceSetEvidence(
            ex,
            createDummySet({ isWarmup: true, weight: 0, reps: 5, rpe: 8 }),
            'kg',
            snapshot
          ).status
        ).toBe('invalid');

        expect(
          resolvePerformanceSetEvidence(
            ex,
            createDummySet({ rpe: null, weight: 0, reps: 5 }),
            'kg',
            snapshot
          ).status
        ).toBe('invalid');
      });
    });

    describe('calculateExerciseTonnageKg with Multi-Modality', () => {
      it('calculates bodyweight exercise tonnage with snapshot', () => {
        const ex = createDummyExercise({
          name: 'Pull-up',
          modality: 'bodyweight',
          sets: [
            createDummySet({ weight: 0, reps: 10 }),
            createDummySet({ weight: 0, reps: 5 }),
          ],
        });
        const snapshot = { value: 80, unit: 'kg' as const };
        // set 1: 80 * 10 = 800 kg; set 2: 80 * 5 = 400 kg => total 1200 kg
        const tonnage = calculateExerciseTonnageKg(ex, 'kg', snapshot);
        expect(tonnage).toBe(1200);
      });

      it('calculates assisted exercise tonnage with snapshot', () => {
        const ex = createDummyExercise({
          name: 'Assisted Chin-up',
          modality: 'assisted',
          sets: [
            createDummySet({ weight: 20, reps: 8 }),
          ],
        });
        const snapshot = { value: 80, unit: 'kg' as const };
        // set 1: (80 - 20) * 8 = 480 kg
        const tonnage = calculateExerciseTonnageKg(ex, 'kg', snapshot);
        expect(tonnage).toBe(480);
      });

      it('returns 0 for bodyweight/assisted exercise if snapshot is missing', () => {
        const ex = createDummyExercise({
          name: 'Pull-up',
          modality: 'bodyweight',
          sets: [createDummySet({ weight: 0, reps: 10 })],
        });
        expect(calculateExerciseTonnageKg(ex, 'kg', null)).toBe(0);
      });
    });

    describe('Direct Multi-Modality Coverage Closure (AS-5C-R2A-T1)', () => {
      // 1. Bodyweight Load PR
      it('evaluates Bodyweight Load PR based on canonical snapshot effective load', () => {
        const initialSnapshot = { value: 75, unit: 'kg' as const };
        const sameSnapshot = { value: 75, unit: 'kg' as const };
        const heavierSnapshot = { value: 80, unit: 'kg' as const };

        const log1 = createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          bodyweightSnapshot: initialSnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })], // effective load: 75kg
            }),
          ],
        });

        const logSameBw = createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-08',
          bodyweightSnapshot: sameSnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })], // effective load: 75kg (unchanged)
            }),
          ],
        });

        const insightsSame = generateDiaryInsights(logSameBw, [log1, logSameBw]);
        expect(insightsSame.some(i => i.id === 'load_pr')).toBe(false);

        const logHeavierBw = createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-15',
          bodyweightSnapshot: heavierSnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })], // effective load: 80kg (> 75kg)
            }),
          ],
        });

        const insightsHeavier = generateDiaryInsights(logHeavierBw, [log1, logSameBw, logHeavierBw]);
        const loadPrInsight = insightsHeavier.find(i => i.id === 'load_pr');
        expect(loadPrInsight).toBeDefined();
        expect(loadPrInsight?.numericEvidence?.todayMaxWeightKg).toBe(80);
        expect(loadPrInsight?.numericEvidence?.previousMaxWeightKg).toBe(75);
      });

      // 2. Assisted Exercise Tonnage PR
      it('evaluates Assisted Exercise Tonnage PR where reduced assistance represents greater load', () => {
        const snapshot = { value: 80, unit: 'kg' as const };

        const log1 = createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Dip',
              modality: 'assisted',
              sets: [createDummySet({ weight: 30, reps: 10, rpe: 8.0 })], // effective load: 50kg, tonnage: 500kg
            }),
          ],
        });

        const log2 = createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-04',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Dip',
              modality: 'assisted',
              sets: [createDummySet({ weight: 30, reps: 10, rpe: 8.0 })], // tonnage: 500kg
            }),
          ],
        });

        const log3 = createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-08',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Dip',
              modality: 'assisted',
              sets: [createDummySet({ weight: 20, reps: 10, rpe: 8.0 })], // assistance reduced to 20kg -> effective load: 60kg, tonnage: 600kg
            }),
          ],
        });

        const insights = generateDiaryInsights(log3, [log1, log2, log3]);
        const tonnageInsight = insights.find(i => i.id === 'exercise_tonnage_pr');
        expect(tonnageInsight).toBeDefined();
        expect(tonnageInsight?.numericEvidence?.todayTonnageKg).toBe(600);
        expect(tonnageInsight?.numericEvidence?.previousMaxTonnageKg).toBe(500);
      });

      // 3. Assisted drop sub-set tonnage
      it('calculates assisted drop sub-set tonnage where greater assistance produces lower effective load', () => {
        const snapshot = { value: 80, unit: 'kg' as const };

        const priorLog1 = createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Pull-up',
              modality: 'assisted',
              sets: [createDummySet({ weight: 30, reps: 10 })], // (80-30)*10 = 500kg
            }),
          ],
        });

        const priorLog2 = createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-04',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Pull-up',
              modality: 'assisted',
              sets: [createDummySet({ weight: 30, reps: 10 })], // 500kg
            }),
          ],
        });

        const currentEx = createDummyExercise({
          name: 'Assisted Pull-up',
          modality: 'assisted',
          sets: [
            createDummySet({
              weight: 10, // parent: 80 - 10 = 70kg effective * 5 = 350kg
              reps: 5,
              rpe: 8.0,
              isDropSet: true,
              dropSubSets: [
                { weight: 20, reps: 5 }, // sub-set 1: 80 - 20 = 60kg effective * 5 = 300kg
                { weight: 30, reps: 5 }, // sub-set 2: 80 - 30 = 50kg effective * 5 = 250kg
              ],
            }),
          ],
        });

        const currentTonnage = calculateExerciseTonnageKg(currentEx, 'kg', snapshot);
        expect(currentTonnage).toBe(900); // 350 + 300 + 250 = 900kg

        const currentLog = createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-08',
          bodyweightSnapshot: snapshot,
          exercises: [currentEx],
        });

        const insights = generateDiaryInsights(currentLog, [priorLog1, priorLog2, currentLog]);
        const tonnagePr = insights.find(i => i.id === 'exercise_tonnage_pr');
        expect(tonnagePr).toBeDefined();
        expect(tonnagePr?.numericEvidence?.todayTonnageKg).toBe(900);
        expect(tonnagePr?.numericEvidence?.previousMaxTonnageKg).toBe(500);
      });

      // 4. Quiet Progress — bodyweight
      it('evaluates Quiet Progress on bodyweight exercise across 28-day window without triggering strength ceiling', () => {
        const peakSnapshot = { value: 90, unit: 'kg' as const };
        const regularSnapshot = { value: 75, unit: 'kg' as const };

        // Peak exposure > 28 days ago (70 days ago) -> 90kg bw x 5 reps @ RPE 8.5 -> e1RM ~ 108 kg
        const oldAllTimePeak = createDummyLog({
          id: 'log-1700000000000',
          date: '2024-11-01',
          bodyweightSnapshot: peakSnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.5 })],
            }),
          ],
        });

        // 3 recent exposures within 28 days -> 75kg bw x 5 reps @ RPE 8.0 -> e1RM ~ 87.5 kg
        const exp1 = createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-02',
          bodyweightSnapshot: regularSnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const exp2 = createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-05',
          bodyweightSnapshot: regularSnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const exp3 = createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-09',
          bodyweightSnapshot: regularSnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        // Current workout: 75kg bw x 7 reps @ RPE 8.0 -> e1RM ~ 93.33 kg (> 1.025 * 87.5 = 89.69, but < 108 kg)
        const currentLog = createDummyLog({
          id: 'log-1700000000004',
          date: '2025-01-15',
          bodyweightSnapshot: regularSnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 7, rpe: 8.0 })],
            }),
          ],
        });

        const allLogs = [oldAllTimePeak, exp1, exp2, exp3, currentLog];
        const insights = generateDiaryInsights(currentLog, allLogs);

        expect(insights.some(i => i.id === 'quiet_progress')).toBe(true);
        expect(insights.some(i => i.id === 'new_strength_ceiling')).toBe(false);

        const qp = insights.find(i => i.id === 'quiet_progress');
        expect(qp?.numericEvidence?.rollingMedianE1RM).toBeCloseTo(92.9, 1);
        expect(qp?.numericEvidence?.todayBestE1RM).toBeCloseTo(99.9, 1);
      });

      // 5. Quiet Progress — assisted
      it('evaluates Quiet Progress on assisted exercise with inverse assistance calculation', () => {
        const snapshot = { value: 80, unit: 'kg' as const };

        // Peak exposure > 28 days ago (70 days ago) -> 80kg bw - 10kg ast = 70kg effective x 5 reps @ RPE 8.5 -> e1RM ~ 85.3 kg
        const oldAllTimePeak = createDummyLog({
          id: 'log-1700000000000',
          date: '2024-11-01',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Chin-up',
              modality: 'assisted',
              sets: [createDummySet({ weight: 10, reps: 5, rpe: 8.5 })],
            }),
          ],
        });

        // 3 recent exposures within 28 days -> 80kg bw - 30kg ast = 50kg effective x 5 reps @ RPE 8.0 -> e1RM = 50 / 0.807 ~ 62.0 kg
        const makeRecentLog = (id: string, date: string) =>
          createDummyLog({
            id,
            date,
            bodyweightSnapshot: snapshot,
            exercises: [
              createDummyExercise({
                name: 'Assisted Chin-up',
                modality: 'assisted',
                sets: [createDummySet({ weight: 30, reps: 5, rpe: 8.0 })],
              }),
            ],
          });

        const exp1 = makeRecentLog('log-1700000000001', '2025-01-02');
        const exp2 = makeRecentLog('log-1700000000002', '2025-01-05');
        const exp3 = makeRecentLog('log-1700000000003', '2025-01-09');

        // Current workout: 80kg bw - 25kg ast = 55kg effective x 5 reps @ RPE 8.0 -> e1RM = 55 / 0.807 ~ 68.2 kg
        const currentLog = createDummyLog({
          id: 'log-1700000000004',
          date: '2025-01-15',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Chin-up',
              modality: 'assisted',
              sets: [createDummySet({ weight: 25, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const allLogs = [oldAllTimePeak, exp1, exp2, exp3, currentLog];
        const insights = generateDiaryInsights(currentLog, allLogs);

        expect(insights.some(i => i.id === 'quiet_progress')).toBe(true);
        expect(insights.some(i => i.id === 'new_strength_ceiling')).toBe(false);

        const qp = insights.find(i => i.id === 'quiet_progress');
        expect(qp?.numericEvidence?.rollingMedianE1RM).toBeCloseTo(62.0, 1);
        expect(qp?.numericEvidence?.todayBestE1RM).toBeCloseTo(68.2, 1);
      });

      // 6. Heavy Exposure — bodyweight
      it('evaluates Heavy Exposure on bodyweight exercise against historical baseline e1RM', () => {
        const baselineSnapshot = { value: 80, unit: 'kg' as const };
        const heavySnapshot = { value: 95, unit: 'kg' as const };

        // 3 prior sessions: 80kg bw x 8 reps @ RPE 8.0 -> e1RM ~ 106.67 kg. Baseline = 106.67 kg
        // 85% of baseline = 0.85 * 106.67 = 90.67 kg.
        const makePastLog = (id: string, date: string) =>
          createDummyLog({
            id,
            date,
            bodyweightSnapshot: baselineSnapshot,
            exercises: [
              createDummyExercise({
                name: 'Pull-up',
                modality: 'bodyweight',
                sets: [createDummySet({ weight: 0, reps: 8, rpe: 8.0 })],
              }),
            ],
          });

        const pastLogs = [
          makePastLog('log-1700000000001', '2025-01-01'),
          makePastLog('log-1700000000002', '2025-01-03'),
          makePastLog('log-1700000000003', '2025-01-05'),
        ];

        // 2 qualifying heavy sets (95kg >= 90.67kg, reps <= 5) -> insufficient (requires >= 3)
        const log2Sets = createDummyLog({
          id: 'log-1700000000004',
          date: '2025-01-08',
          bodyweightSnapshot: heavySnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [
                createDummySet({ weight: 0, reps: 3, rpe: 8.0 }),
                createDummySet({ weight: 0, reps: 3, rpe: 8.5 }),
              ],
            }),
          ],
        });

        const insights2 = generateDiaryInsights(log2Sets, [...pastLogs, log2Sets]);
        expect(insights2.some(i => i.id === 'heavy_exposure')).toBe(false);

        // 3 qualifying heavy sets -> triggers Heavy Exposure
        const log3Sets = createDummyLog({
          id: 'log-1700000000005',
          date: '2025-01-08',
          bodyweightSnapshot: heavySnapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [
                createDummySet({ weight: 0, reps: 3, rpe: 8.0 }),
                createDummySet({ weight: 0, reps: 3, rpe: 8.5 }),
                createDummySet({ weight: 0, reps: 3, rpe: 9.0 }),
              ],
            }),
          ],
        });

        const insights3 = generateDiaryInsights(log3Sets, [...pastLogs, log3Sets]);
        const heavyInsight = insights3.find(i => i.id === 'heavy_exposure');
        expect(heavyInsight).toBeDefined();
        expect(heavyInsight?.numericEvidence?.heavySetsCount).toBe(3);
      });

      // 7. Heavy Exposure — assisted
      it('evaluates Heavy Exposure on assisted exercise with reduced assistance', () => {
        const snapshot = { value: 80, unit: 'kg' as const };

        // 3 prior sessions: 80 - 40 = 40kg effective x 8 reps @ RPE 8.0 -> e1RM ~ 53.33 kg.
        // 85% of baseline = 0.85 * 53.33 = 45.33 kg.
        const makePastLog = (id: string, date: string) =>
          createDummyLog({
            id,
            date,
            bodyweightSnapshot: snapshot,
            exercises: [
              createDummyExercise({
                name: 'Assisted Dip',
                modality: 'assisted',
                sets: [createDummySet({ weight: 40, reps: 8, rpe: 8.0 })],
              }),
            ],
          });

        const pastLogs = [
          makePastLog('log-1700000000001', '2025-01-01'),
          makePastLog('log-1700000000002', '2025-01-03'),
          makePastLog('log-1700000000003', '2025-01-05'),
        ];

        // Current workout: assistance 30kg -> 80 - 30 = 50kg effective (50 / 53.33 = 93.75% >= 85%) x 3 sets of 3 reps
        const currentLog = createDummyLog({
          id: 'log-1700000000004',
          date: '2025-01-08',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Dip',
              modality: 'assisted',
              sets: [
                createDummySet({ weight: 30, reps: 3, rpe: 8.0 }),
                createDummySet({ weight: 30, reps: 3, rpe: 8.5 }),
                createDummySet({ weight: 30, reps: 3, rpe: 9.0 }),
              ],
            }),
          ],
        });

        const insights = generateDiaryInsights(currentLog, [...pastLogs, currentLog]);
        const heavyInsight = insights.find(i => i.id === 'heavy_exposure');
        expect(heavyInsight).toBeDefined();
        expect(heavyInsight?.numericEvidence?.heavySetsCount).toBe(3);
      });

      // 8. Consistent Output — assisted
      it('evaluates Consistent Output on assisted straight sets and suppresses Steep Fatigue Drop', () => {
        const snapshot = { value: 80, unit: 'kg' as const };

        // 3 assisted sets at 20kg assistance (60kg effective), 6 reps, RPE 8.0 -> identical e1RM (72 kg)
        const currentLog = createDummyLog({
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Chin-up',
              modality: 'assisted',
              sets: [
                createDummySet({ setNumber: 1, weight: 20, reps: 6, rpe: 8.0 }),
                createDummySet({ setNumber: 2, weight: 20, reps: 6, rpe: 8.0 }),
                createDummySet({ setNumber: 3, weight: 20, reps: 6, rpe: 8.0 }),
              ],
            }),
          ],
        });

        const insights = generateDiaryInsights(currentLog, [currentLog]);
        expect(insights.some(i => i.id === 'consistent_output')).toBe(true);
        expect(insights.some(i => i.id === 'steep_fatigue_drop')).toBe(false);
      });

      // 9. Steep Fatigue Drop — assisted
      it('evaluates Steep Fatigue Drop on assisted sets meeting decline and RPE rise thresholds', () => {
        const snapshot = { value: 80, unit: 'kg' as const };

        // 3 assisted sets at 20kg assistance (60kg effective):
        // set 1: 6 reps @ RPE 7.5 -> e1RM ~ 78.5 kg
        // set 2: 4 reps @ RPE 8.5
        // set 3: 3 reps @ RPE 9.5 -> e1RM ~ 66.2 kg (drop > 12%)
        const currentLog = createDummyLog({
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Chin-up',
              modality: 'assisted',
              sets: [
                createDummySet({ setNumber: 1, weight: 20, reps: 6, rpe: 7.5 }),
                createDummySet({ setNumber: 2, weight: 20, reps: 4, rpe: 8.5 }),
                createDummySet({ setNumber: 3, weight: 20, reps: 3, rpe: 9.5 }),
              ],
            }),
          ],
        });

        const insights = generateDiaryInsights(currentLog, [currentLog]);
        expect(insights.some(i => i.id === 'steep_fatigue_drop')).toBe(true);
        expect(insights.some(i => i.id === 'consistent_output')).toBe(false);

        const dropInsight = insights.find(i => i.id === 'steep_fatigue_drop');
        expect(dropInsight?.numericEvidence?.firstSetE1RM).toBeDefined();
        expect(dropInsight?.numericEvidence?.lastSetE1RM).toBeDefined();
        expect(dropInsight?.numericEvidence?.firstSetE1RM).toBeGreaterThan(dropInsight?.numericEvidence?.lastSetE1RM!);
      });

      // 10. Session Performance Index — assisted
      it('calculates exact Session Performance Index for assisted exercise with baseline sufficiency', () => {
        const snapshot = { value: 80, unit: 'kg' as const };

        // 3 preceding exposures: assistance 20kg (60kg effective), 6 reps @ RPE 8.0 (table 0.779 -> 77.02 kg)
        const makePastLog = (id: string, date: string) =>
          createDummyLog({
            id,
            date,
            bodyweightSnapshot: snapshot,
            exercises: [
              createDummyExercise({
                name: 'Assisted Chin-up',
                modality: 'assisted',
                isMainMovement: true,
                sets: [createDummySet({ weight: 20, reps: 6, rpe: 8.0 })],
              }),
            ],
          });

        const pastLogs = [
          makePastLog('log-1700000000001', '2025-01-01'),
          makePastLog('log-1700000000002', '2025-01-03'),
          makePastLog('log-1700000000003', '2025-01-05'),
        ];

        // Current workout: assistance 20kg (60kg effective), 5 reps @ RPE 8.5 (table 0.821 -> 73.08 kg)
        // Expected Performance Index = 73.0816 / 77.0218 = 0.9488
        const currentLog = createDummyLog({
          id: 'log-1700000000004',
          date: '2025-01-08',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Chin-up',
              modality: 'assisted',
              isMainMovement: true,
              sets: [createDummySet({ weight: 20, reps: 5, rpe: 8.5 })],
            }),
          ],
        });

        const allLogs = [...pastLogs, currentLog];
        const spi = calculateSessionPerformanceIndex(currentLog, allLogs);
        expect(spi).not.toBeNull();
        expect(spi).toBeCloseTo(0.9488, 3);
      });

      // 11. Against the Odds with corrected PI
      it('evaluates Against the Odds on bodyweight exercise with corrected Performance Index', () => {
        const snapshot = { value: 80, unit: 'kg' as const };

        // 3 prior sessions: 80kg bw x 5 reps @ RPE 8.0 -> e1RM ~ 93.33 kg
        const makePastLog = (id: string, date: string) =>
          createDummyLog({
            id,
            date,
            bodyweightSnapshot: snapshot,
            exercises: [
              createDummyExercise({
                name: 'Pull-up',
                modality: 'bodyweight',
                isMainMovement: true,
                sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })],
              }),
            ],
          });

        const pastLogs = [
          makePastLog('log-1700000000001', '2025-01-01'),
          makePastLog('log-1700000000002', '2025-01-03'),
          makePastLog('log-1700000000003', '2025-01-05'),
        ];

        // Current workout: 80kg bw x 6 reps @ RPE 8.0 -> e1RM ~ 98.67 kg (SPI ~ 1.057 >= 1.00) alongside high soreness (8)
        const currentLog = createDummyLog({
          id: 'log-1700000000004',
          date: '2025-01-08',
          bodyweightSnapshot: snapshot,
          recovery: { sleepHours: 7.5, soreness: 8 },
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              isMainMovement: true,
              sets: [createDummySet({ weight: 0, reps: 6, rpe: 8.0 })],
            }),
          ],
        });

        const allLogs = [...pastLogs, currentLog];
        const spi = calculateSessionPerformanceIndex(currentLog, allLogs);
        expect(spi).not.toBeNull();
        expect(spi!).toBeGreaterThanOrEqual(1.0);

        const insights = generateDiaryInsights(currentLog, allLogs);
        expect(insights.some(i => i.id === 'against_the_odds')).toBe(true);
        expect(insights.some(i => i.id === 'recovery_strain')).toBe(false);
      });

      // 12. Cross-unit bodyweight equality
      it('verifies cross-unit bodyweight equality between kg and lb snapshots', () => {
        // 80.00 kg is 176.3698096 lb
        const kgLog = createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const lbLog = createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-05',
          unit: 'lb',
          bodyweightSnapshot: { value: 176.3698096, unit: 'lb' },
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const evKg = resolvePerformanceSetEvidence(kgLog.exercises[0], kgLog.exercises[0].sets[0], 'kg', kgLog.bodyweightSnapshot);
        const evLb = resolvePerformanceSetEvidence(lbLog.exercises[0], lbLog.exercises[0].sets[0], 'lb', lbLog.bodyweightSnapshot);

        expect(evKg.effectiveLoadKg).toBeCloseTo(80, 2);
        expect(evLb.effectiveLoadKg).toBeCloseTo(80, 2);
        expect(evKg.e1rmKg).toBeCloseTo(evLb.e1rmKg!, 2);

        const insights = generateDiaryInsights(lbLog, [kgLog, lbLog]);
        // Same physical effective load and reps -> no false Load PR or Strength Ceiling
        expect(insights.some(i => i.id === 'load_pr')).toBe(false);
        expect(insights.some(i => i.id === 'new_strength_ceiling')).toBe(false);
      });

      // 13. Cross-unit assisted equality
      it('verifies cross-unit assisted equality with mixed kg/lb snapshots and assistance', () => {
        // 80kg snapshot, 20kg assistance -> 60kg effective
        const kgLog = createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          exercises: [
            createDummyExercise({
              name: 'Assisted Dip',
              modality: 'assisted',
              sets: [createDummySet({ weight: 20, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        // 176.3698 lb snapshot (80kg), 44.09245 lb assistance (20kg) -> 60kg effective
        const lbLog = createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-05',
          unit: 'lb',
          bodyweightSnapshot: { value: 176.3698096, unit: 'lb' },
          exercises: [
            createDummyExercise({
              name: 'Assisted Dip',
              modality: 'assisted',
              sets: [createDummySet({ weight: 44.0924524, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const evKg = resolvePerformanceSetEvidence(kgLog.exercises[0], kgLog.exercises[0].sets[0], 'kg', kgLog.bodyweightSnapshot);
        const evLb = resolvePerformanceSetEvidence(lbLog.exercises[0], lbLog.exercises[0].sets[0], 'lb', lbLog.bodyweightSnapshot);

        expect(evKg.effectiveLoadKg).toBeCloseTo(60, 2);
        expect(evLb.effectiveLoadKg).toBeCloseTo(60, 2);

        const tonnageKg = calculateExerciseTonnageKg(kgLog.exercises[0], 'kg', kgLog.bodyweightSnapshot);
        const tonnageLbInKg = calculateExerciseTonnageKg(lbLog.exercises[0], 'lb', lbLog.bodyweightSnapshot);
        expect(tonnageKg).toBeCloseTo(tonnageLbInKg, 2);

        const insights = generateDiaryInsights(lbLog, [kgLog, lbLog]);
        expect(insights.some(i => i.id === 'load_pr')).toBe(false);
        expect(insights.some(i => i.id === 'new_strength_ceiling')).toBe(false);
        expect(insights.some(i => i.id === 'rep_pr')).toBe(false);
      });

      // 14. Mixed-modality individual/batch deep parity
      it('asserts mixed-modality individual and batch deep scorecard equality for every log ID', () => {
        const snapshot = { value: 75, unit: 'kg' as const };

        const logWeighted = createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Barbell Squat',
              modality: 'weighted',
              isMainMovement: true,
              sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const logBodyweight = createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-03',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              isMainMovement: true,
              sets: [createDummySet({ weight: 0, reps: 8, rpe: 8.0 })],
            }),
          ],
        });

        const logAssisted = createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-05',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Assisted Dip',
              modality: 'assisted',
              isMainMovement: true,
              sets: [createDummySet({ weight: 15, reps: 10, rpe: 8.0 })],
            }),
          ],
        });

        const logMixed = createDummyLog({
          id: 'log-1700000000004',
          date: '2025-01-07',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Barbell Squat',
              modality: 'weighted',
              sets: [createDummySet({ weight: 105, reps: 5, rpe: 8.0 })],
            }),
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 10, rpe: 8.0 })],
            }),
            createDummyExercise({
              name: 'Assisted Dip',
              modality: 'assisted',
              sets: [createDummySet({ weight: 10, reps: 10, rpe: 8.0 })],
            }),
          ],
        });

        const allLogs = [logWeighted, logBodyweight, logAssisted, logMixed];
        const batchMap = generateDiaryScorecardMap(allLogs);

        allLogs.forEach(log => {
          const individualCard = generateDiaryScorecard(log, allLogs);
          const batchCard = batchMap[log.id];

          expect(batchCard).toBeDefined();
          expect(batchCard).toEqual(individualCard);
          expect(batchCard.primaryCategory).toEqual(individualCard.primaryCategory);
          expect(batchCard.insights).toEqual(individualCard.insights);
          expect(batchCard.collapsedInsights).toEqual(individualCard.collapsedInsights);
          expect(batchCard.overflowInsightCount).toEqual(individualCard.overflowInsightCount);
          expect(batchCard.sessionPerformanceIndex).toEqual(individualCard.sessionPerformanceIndex);
          expect(batchCard.hasSufficientPerformanceHistory).toEqual(individualCard.hasSufficientPerformanceHistory);
        });
      });

      // 15. Reverse-order mixed-modality parity
      it('asserts complete batch map equality between chronological and reverse-ordered input arrays', () => {
        const snapshot = { value: 80, unit: 'kg' as const };

        const logs = [
          createDummyLog({
            id: 'log-1700000000001',
            date: '2025-01-01',
            bodyweightSnapshot: snapshot,
            exercises: [
              createDummyExercise({
                name: 'Bench Press',
                modality: 'weighted',
                sets: [createDummySet({ weight: 90, reps: 5, rpe: 8.0 })],
              }),
            ],
          }),
          createDummyLog({
            id: 'log-1700000000002',
            date: '2025-01-03',
            bodyweightSnapshot: snapshot,
            exercises: [
              createDummyExercise({
                name: 'Pull-up',
                modality: 'bodyweight',
                sets: [createDummySet({ weight: 0, reps: 6, rpe: 8.0 })],
              }),
            ],
          }),
          createDummyLog({
            id: 'log-1700000000003',
            date: '2025-01-05',
            bodyweightSnapshot: snapshot,
            exercises: [
              createDummyExercise({
                name: 'Assisted Dip',
                modality: 'assisted',
                sets: [createDummySet({ weight: 20, reps: 8, rpe: 8.0 })],
              }),
            ],
          }),
        ];

        const mapChronological = generateDiaryScorecardMap(logs);
        const mapReversed = generateDiaryScorecardMap([...logs].reverse());

        expect(mapReversed).toEqual(mapChronological);
      });

      // 16. Same-day mixed-modality timestamp ordering
      it('preserves exact same-day chronology tie-breaking by epoch-like timestamp ID', () => {
        const snapshot = { value: 75, unit: 'kg' as const };

        const earlierLog = createDummyLog({
          id: 'log-1700000001000',
          date: '2025-01-01',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const laterLog = createDummyLog({
          id: 'log-1700000002000',
          date: '2025-01-01',
          bodyweightSnapshot: snapshot,
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              sets: [createDummySet({ weight: 0, reps: 8, rpe: 8.0 })], // higher reps -> Strength Ceiling PR over earlier log!
            }),
          ],
        });

        const allLogs = [earlierLog, laterLog];
        const batchMapForward = generateDiaryScorecardMap(allLogs);
        const batchMapBackward = generateDiaryScorecardMap([laterLog, earlierLog]);

        expect(batchMapBackward).toEqual(batchMapForward);

        // Earlier log must not see later log (no strength ceiling)
        expect(batchMapForward[earlierLog.id].insights.some(i => i.id === 'new_strength_ceiling')).toBe(false);

        // Later log sees earlier log as preceding history and earns PR
        expect(batchMapForward[laterLog.id].insights.some(i => i.id === 'new_strength_ceiling')).toBe(true);
      });

      // 17. Missing-snapshot batch exclusion
      it('excludes missing-snapshot bodyweight/assisted workouts from performance index contamination and PRs without throwing', () => {
        const validWeightedLog1 = createDummyLog({
          id: 'log-1700000000001',
          date: '2025-01-01',
          exercises: [
            createDummyExercise({
              name: 'Barbell Squat',
              modality: 'weighted',
              isMainMovement: true,
              sets: [createDummySet({ weight: 100, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const missingSnapshotBwLog = createDummyLog({
          id: 'log-1700000000002',
          date: '2025-01-03',
          bodyweightSnapshot: null, // missing snapshot!
          exercises: [
            createDummyExercise({
              name: 'Pull-up',
              modality: 'bodyweight',
              isMainMovement: true,
              sets: [createDummySet({ weight: 0, reps: 20, rpe: 8.0 })],
            }),
          ],
        });

        const missingSnapshotAssistedLog = createDummyLog({
          id: 'log-1700000000003',
          date: '2025-01-05',
          bodyweightSnapshot: null, // missing snapshot!
          exercises: [
            createDummyExercise({
              name: 'Assisted Dip',
              modality: 'assisted',
              isMainMovement: true,
              sets: [createDummySet({ weight: 5, reps: 20, rpe: 8.0 })],
            }),
          ],
        });

        const validWeightedLog2 = createDummyLog({
          id: 'log-1700000000004',
          date: '2025-01-07',
          exercises: [
            createDummyExercise({
              name: 'Barbell Squat',
              modality: 'weighted',
              isMainMovement: true,
              sets: [createDummySet({ weight: 105, reps: 5, rpe: 8.0 })],
            }),
          ],
        });

        const allLogs = [
          validWeightedLog1,
          missingSnapshotBwLog,
          missingSnapshotAssistedLog,
          validWeightedLog2,
        ];

        let batchMap: Record<string, any> = {};
        expect(() => {
          batchMap = generateDiaryScorecardMap(allLogs);
        }).not.toThrow();

        // Parity check across all logs
        allLogs.forEach(log => {
          const individualCard = generateDiaryScorecard(log, allLogs);
          expect(batchMap[log.id]).toEqual(individualCard);
        });

        // Missing snapshot logs have no false PRs
        expect(batchMap[missingSnapshotBwLog.id].insights.some((i: any) => i.id === 'load_pr' || i.id === 'new_strength_ceiling')).toBe(false);
        expect(batchMap[missingSnapshotAssistedLog.id].insights.some((i: any) => i.id === 'load_pr' || i.id === 'new_strength_ceiling')).toBe(false);

        // Weighted log calculates PR normally without contamination
        expect(batchMap[validWeightedLog2.id].insights.some((i: any) => i.id === 'load_pr')).toBe(true);
      });
    });
  });
});
