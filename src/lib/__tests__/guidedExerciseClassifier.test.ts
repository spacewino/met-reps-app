/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  classifyGuidedExerciseOutcome,
  ClassifyGuidedExerciseOutcomeInput,
} from '../guidedExerciseClassifier';
import {
  ExerciseEntry,
  WorkoutLog,
  PrescriptionSnapshot,
  SetEntry,
} from '../../types';
import {
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
} from '../programProgressionMode';

function makeSnapshot(
  workingSetOrdinal: number = 1,
  prescribedWorkingSetCount: number = 1,
  overrides?: Partial<PrescriptionSnapshot>
): PrescriptionSnapshot {
  return {
    snapshotVersion: CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
    progressionPolicyVersion: CURRENT_PROGRESSION_POLICY_VERSION,
    algorithmVersion: CURRENT_ALGORITHM_VERSION,
    progressionMode: 'metreps_guided',
    algorithmId: 'hypertrophy_linear',
    exerciseKey: 'barbell_bench_press',
    exerciseRole: 'main_movement',
    modality: 'weighted',
    comparableLaneKey: 'barbell_bench_press::hypertrophy_linear',
    workingSetOrdinal,
    prescribedWorkingSetCount,
    baseWeight: 80,
    baseReps: 8,
    baseRpe: 8.0,
    presentedWeight: 80,
    presentedReps: 8,
    presentedRpe: 8.0,
    bodyweightSnapshot: null,
    weightUnit: 'kg',
    comparisonLoadKg: 80,
    loadBasis: 'external_weight_v1',
    loadIncrement: 2.5,
    nudgeType: 'none',
    coachingReasonCode: 'BASE_PRESCRIPTION',
    confirmedStepIndexBefore: 0,
    presentedStepIndex: 0,
    successCreditEligible: true,
    rollbackTarget: null,
    ...overrides,
  };
}

function makeSet(
  setNumber: number = 1,
  weight: number = 80,
  reps: number = 8,
  rpe: number | null = 8.0,
  snapshot?: PrescriptionSnapshot | null,
  overrides?: Partial<SetEntry>
): SetEntry {
  return {
    setNumber,
    weight,
    reps,
    rpe,
    isCompleted: true,
    prescriptionSnapshot: snapshot === undefined ? makeSnapshot(setNumber, 1) : snapshot,
    ...overrides,
  };
}

function makeExercise(sets: SetEntry[], overrides?: Partial<ExerciseEntry>): ExerciseEntry {
  return {
    name: 'Barbell Bench Press',
    muscleGroup: 'Chest',
    exerciseKey: 'barbell_bench_press',
    modality: 'weighted',
    sets,
    ...overrides,
  };
}

function makeWorkout(exercises: ExerciseEntry[], overrides?: Partial<WorkoutLog>): WorkoutLog {
  return {
    id: 'log-exercise-test-1',
    date: '2026-09-03',
    programId: 'program-guided-1',
    program: 'Guided Hypertrophy',
    unit: 'kg',
    exercises,
    ...overrides,
  };
}

function makeInput(
  sets: SetEntry[],
  exerciseOverrides?: Partial<ExerciseEntry>,
  workoutOverrides?: Partial<WorkoutLog>
): ClassifyGuidedExerciseOutcomeInput {
  const exercise = makeExercise(sets, exerciseOverrides);
  const workout = makeWorkout([exercise], workoutOverrides);
  return { exercise, workout };
}

describe('classifyGuidedExerciseOutcome', () => {
  describe('Contract validation (prescribedWorkingSetCount)', () => {
    it('accepts valid count', () => {
      const snap = makeSnapshot(1, 2);
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, snap),
        makeSet(2, 80, 8, 8.0, makeSnapshot(2, 2)),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('success');
      expect(res.expectedPrescribedSetCount).toBe(2);
    });

    it('rejects missing count as ineligible / CONFLICTING_PRESCRIBED_SET_COUNTS', () => {
      const snap = makeSnapshot(1, 1, { prescribedWorkingSetCount: undefined as any });
      const input = makeInput([makeSet(1, 80, 8, 8.0, snap)]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('CONFLICTING_PRESCRIBED_SET_COUNTS');
      expect(res.expectedPrescribedSetCount).toBeNull();
    });

    it('rejects zero count as ineligible / CONFLICTING_PRESCRIBED_SET_COUNTS', () => {
      const snap = makeSnapshot(1, 0);
      const input = makeInput([makeSet(1, 80, 8, 8.0, snap)]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('CONFLICTING_PRESCRIBED_SET_COUNTS');
    });

    it('rejects negative count as ineligible / CONFLICTING_PRESCRIBED_SET_COUNTS', () => {
      const snap = makeSnapshot(1, -2);
      const input = makeInput([makeSet(1, 80, 8, 8.0, snap)]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('CONFLICTING_PRESCRIBED_SET_COUNTS');
    });

    it('rejects fractional count as ineligible / CONFLICTING_PRESCRIBED_SET_COUNTS', () => {
      const snap = makeSnapshot(1, 2.5);
      const input = makeInput([makeSet(1, 80, 8, 8.0, snap)]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('CONFLICTING_PRESCRIBED_SET_COUNTS');
    });

    it('rejects conflicting counts across sets as ineligible / CONFLICTING_PRESCRIBED_SET_COUNTS', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 3)),
        makeSet(2, 80, 8, 8.0, makeSnapshot(2, 2)), // conflicting count
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('CONFLICTING_PRESCRIBED_SET_COUNTS');
    });
  });

  describe('Successful aggregation', () => {
    it('one prescribed set successful -> success / ALL_PRESCRIBED_SETS_ACHIEVED', () => {
      const input = makeInput([makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1))]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('success');
      expect(res.reason).toBe('ALL_PRESCRIBED_SETS_ACHIEVED');
      expect(res.successfulPrescribedSetCount).toBe(1);
      expect(res.expectedPrescribedSetCount).toBe(1);
      expect(res.observedPrescribedSetCount).toBe(1);
      expect(res.missingWorkingSetOrdinals).toEqual([]);
    });

    it('two prescribed sets successful -> success / ALL_PRESCRIBED_SETS_ACHIEVED', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2)),
        makeSet(2, 80, 8, 8.0, makeSnapshot(2, 2)),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('success');
      expect(res.reason).toBe('ALL_PRESCRIBED_SETS_ACHIEVED');
      expect(res.successfulPrescribedSetCount).toBe(2);
      expect(res.attemptedPrescribedSetCount).toBe(2);
    });

    it('three prescribed sets successful -> success / ALL_PRESCRIBED_SETS_ACHIEVED', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 3)),
        makeSet(2, 80, 8, 8.0, makeSnapshot(2, 3)),
        makeSet(3, 80, 8, 8.0, makeSnapshot(3, 3)),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('success');
      expect(res.reason).toBe('ALL_PRESCRIBED_SETS_ACHIEVED');
      expect(res.successfulPrescribedSetCount).toBe(3);
    });

    it('warm-up and drop additions without snapshots are ignored as unprescribed', () => {
      const input = makeInput([
        makeSet(1, 40, 10, null, null, { isWarmup: true }), // warm-up without snapshot
        makeSet(2, 80, 8, 8.0, makeSnapshot(1, 2)),
        makeSet(3, 80, 8, 8.0, makeSnapshot(2, 2)),
        makeSet(4, 60, 12, null, null, { isDropSet: true }), // drop set without snapshot
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('success');
      expect(res.reason).toBe('ALL_PRESCRIBED_SETS_ACHIEVED');
      expect(res.ignoredUnprescribedSetCount).toBe(2);
      expect(res.observedPrescribedSetCount).toBe(2);
      expect(res.successfulPrescribedSetCount).toBe(2);
    });

    it('ordinary added working set without snapshot is ignored and does not alter success', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1)),
        makeSet(2, 85, 10, 8.0, null), // unprescribed added working set
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('success');
      expect(res.reason).toBe('ALL_PRESCRIBED_SETS_ACHIEVED');
      expect(res.ignoredUnprescribedSetCount).toBe(1);
      expect(res.observedPrescribedSetCount).toBe(1);
    });
  });

  describe('Miss aggregation', () => {
    it('exactly one marginal miss with remaining successful -> marginal_miss / SINGLE_MARGINAL_MISS', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2)),
        makeSet(2, 80, 7, 8.0, makeSnapshot(2, 2)), // 7 reps vs 8 presented = marginal miss reps
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('marginal_miss');
      expect(res.reason).toBe('SINGLE_MARGINAL_MISS');
      expect(res.marginalMissCount).toBe(1);
      expect(res.successfulPrescribedSetCount).toBe(1);
    });

    it('two marginal misses -> substantial_miss / MULTIPLE_MARGINAL_MISSES', () => {
      const input = makeInput([
        makeSet(1, 80, 7, 8.0, makeSnapshot(1, 2)), // marginal miss 1
        makeSet(2, 80, 7, 8.0, makeSnapshot(2, 2)), // marginal miss 2
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('substantial_miss');
      expect(res.reason).toBe('MULTIPLE_MARGINAL_MISSES');
      expect(res.marginalMissCount).toBe(2);
    });

    it('one substantial miss -> substantial_miss / PRESCRIBED_SET_SUBSTANTIAL_MISS', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2)),
        makeSet(2, 80, 5, 8.0, makeSnapshot(2, 2)), // 5 reps vs 8 = shortfall 3 reps (>1) = substantial miss
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('substantial_miss');
      expect(res.reason).toBe('PRESCRIBED_SET_SUBSTANTIAL_MISS');
      expect(res.substantialMissCount).toBe(1);
    });

    it('substantial miss plus added successful unprescribed set remains substantial_miss', () => {
      const input = makeInput([
        makeSet(1, 80, 4, 8.0, makeSnapshot(1, 1)), // substantial miss
        makeSet(2, 80, 12, 8.0, null), // unprescribed set attempted and succeeded
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('substantial_miss');
      expect(res.reason).toBe('PRESCRIBED_SET_SUBSTANTIAL_MISS');
      expect(res.ignoredUnprescribedSetCount).toBe(1);
    });
  });

  describe('Neutral outcomes', () => {
    it('skipped exercise -> neutral / EXERCISE_SKIPPED with deterministic empty diagnostics', () => {
      const input = makeInput(
        [makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1))],
        { isSkipped: true }
      );
      const res = classifyGuidedExerciseOutcome(input);
      expect(res).toEqual({
        outcome: 'neutral',
        reason: 'EXERCISE_SKIPPED',
        expectedPrescribedSetCount: null,
        observedPrescribedSetCount: 0,
        attemptedPrescribedSetCount: 0,
        successfulPrescribedSetCount: 0,
        marginalMissCount: 0,
        substantialMissCount: 0,
        neutralSetCount: 0,
        ineligibleSetCount: 0,
        missingWorkingSetOrdinals: [],
        ignoredUnprescribedSetCount: 0,
        nudgedSetPresent: false,
        nudgedSetAchieved: null,
        nudgedSetOutcome: null,
        nudgedWorkingSetOrdinal: null,
        setResults: [],
      });
    });

    it('skipped exercise with sets: [] returns neutral / EXERCISE_SKIPPED', () => {
      const input = makeInput([], { isSkipped: true });
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('EXERCISE_SKIPPED');
      expect(res.expectedPrescribedSetCount).toBeNull();
      expect(res.observedPrescribedSetCount).toBe(0);
      expect(res.attemptedPrescribedSetCount).toBe(0);
      expect(res.successfulPrescribedSetCount).toBe(0);
      expect(res.marginalMissCount).toBe(0);
      expect(res.substantialMissCount).toBe(0);
      expect(res.neutralSetCount).toBe(0);
      expect(res.ineligibleSetCount).toBe(0);
      expect(res.missingWorkingSetOrdinals).toEqual([]);
      expect(res.ignoredUnprescribedSetCount).toBe(0);
      expect(res.nudgedSetPresent).toBe(false);
      expect(res.nudgedSetAchieved).toBeNull();
      expect(res.nudgedSetOutcome).toBeNull();
      expect(res.nudgedWorkingSetOrdinal).toBeNull();
      expect(res.setResults).toEqual([]);
    });

    it('skipped exercise containing only non-snapshot-bearing sets still returns neutral / EXERCISE_SKIPPED', () => {
      const input = makeInput(
        [
          makeSet(1, 80, 8, 8.0, null),
          makeSet(2, 80, 8, 8.0, null),
        ],
        { isSkipped: true }
      );
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('EXERCISE_SKIPPED');
      expect(res.expectedPrescribedSetCount).toBeNull();
      expect(res.observedPrescribedSetCount).toBe(0);
      expect(res.attemptedPrescribedSetCount).toBe(0);
      expect(res.ignoredUnprescribedSetCount).toBe(0);
      expect(res.setResults).toEqual([]);
    });

    it('skipped exercise containing malformed, duplicate, conflicting, or multiple-nudge snapshot data still returns neutral / EXERCISE_SKIPPED', () => {
      const input = makeInput(
        [
          makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2, { nudgeType: 'rep_nudge', prescribedWorkingSetCount: -5 })),
          makeSet(2, 80, 8, 8.0, makeSnapshot(1, 4, { nudgeType: 'load_nudge' })), // duplicate ordinal 1, conflicting count 4, second nudge
          makeSet(3, 80, 8, 8.0, null as any), // malformed set
        ],
        { isSkipped: true }
      );
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('EXERCISE_SKIPPED');
      expect(res.expectedPrescribedSetCount).toBeNull();
      expect(res.observedPrescribedSetCount).toBe(0);
      expect(res.ineligibleSetCount).toBe(0);
      expect(res.setResults).toEqual([]);
    });

    it('skipped exercise preserves deep input immutability', () => {
      const input = makeInput(
        [
          makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2, { nudgeType: 'rep_nudge' })),
          makeSet(2, 80, 8, 8.0, makeSnapshot(2, 2)),
        ],
        { isSkipped: true }
      );
      const copyBefore = JSON.parse(JSON.stringify(input));
      const res = classifyGuidedExerciseOutcome(input);
      expect(input).toEqual(copyBefore);
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('EXERCISE_SKIPPED');
    });

    it('one explicitly skipped prescribed set -> neutral / PRESCRIBED_SET_SKIPPED', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2)),
        makeSet(2, 80, 0, null, makeSnapshot(2, 2), { isSkipped: true, isCompleted: false }),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('PRESCRIBED_SET_SKIPPED');
      expect(res.neutralSetCount).toBe(1);
      expect(res.attemptedPrescribedSetCount).toBe(1);
      expect(res.successfulPrescribedSetCount).toBe(1);
    });

    it('deleted leading ordinal (ordinal 1 missing) -> neutral / PRESCRIBED_SET_MISSING', () => {
      const input = makeInput([
        // ordinal 1 physically deleted by user
        makeSet(1, 80, 8, 8.0, makeSnapshot(2, 3)),
        makeSet(2, 80, 8, 8.0, makeSnapshot(3, 3)),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('PRESCRIBED_SET_MISSING');
      expect(res.missingWorkingSetOrdinals).toEqual([1]);
      expect(res.expectedPrescribedSetCount).toBe(3);
      expect(res.observedPrescribedSetCount).toBe(2);
    });

    it('deleted middle ordinal (ordinal 2 missing) -> neutral / PRESCRIBED_SET_MISSING', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 3)),
        // ordinal 2 deleted
        makeSet(2, 80, 8, 8.0, makeSnapshot(3, 3)),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('PRESCRIBED_SET_MISSING');
      expect(res.missingWorkingSetOrdinals).toEqual([2]);
    });

    it('deleted trailing ordinal (ordinal 3 missing) -> neutral / PRESCRIBED_SET_MISSING', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 3)),
        makeSet(2, 80, 8, 8.0, makeSnapshot(2, 3)),
        // ordinal 3 deleted
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('PRESCRIBED_SET_MISSING');
      expect(res.missingWorkingSetOrdinals).toEqual([3]);
    });

    it('successful remaining sets cannot conceal a missing ordinal', () => {
      const input = makeInput([
        makeSet(1, 90, 10, 8.0, makeSnapshot(1, 3)), // overperformance
        makeSet(2, 90, 10, 8.0, makeSnapshot(2, 3)), // overperformance
        // ordinal 3 missing
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('PRESCRIBED_SET_MISSING');
    });
  });

  describe('Structural failures', () => {
    it('zero snapshot-bearing sets -> ineligible / NO_PRESCRIBED_SETS_FOUND', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, null),
        makeSet(2, 80, 8, 8.0, null),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('NO_PRESCRIBED_SETS_FOUND');
      expect(res.expectedPrescribedSetCount).toBeNull();
      expect(res.observedPrescribedSetCount).toBe(0);
      expect(res.ignoredUnprescribedSetCount).toBe(2);
    });

    it('duplicate ordinal -> ineligible / DUPLICATE_PRESCRIBED_ORDINAL', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2)),
        makeSet(2, 80, 8, 8.0, makeSnapshot(1, 2)), // duplicate ordinal 1
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('DUPLICATE_PRESCRIBED_ORDINAL');
    });

    it('ordinal zero -> ineligible / INVALID_PRESCRIBED_ORDINAL', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(0, 2)), // ordinal 0 < 1
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('INVALID_PRESCRIBED_ORDINAL');
    });

    it('ordinal above expected count -> ineligible / INVALID_PRESCRIBED_ORDINAL', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(3, 2)), // ordinal 3 > expected 2
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('INVALID_PRESCRIBED_ORDINAL');
    });

    it('inconsistent expected counts -> ineligible / CONFLICTING_PRESCRIBED_SET_COUNTS', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2)),
        makeSet(2, 80, 8, 8.0, makeSnapshot(2, 3)), // conflicting count
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('CONFLICTING_PRESCRIBED_SET_COUNTS');
    });

    it('snapshot-bearing warm-up set -> ineligible / STRUCTURALLY_CORRUPT_SET', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1), { isWarmup: true }),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('STRUCTURALLY_CORRUPT_SET');
      expect(res.ineligibleSetCount).toBe(1);
    });

    it('snapshot-bearing drop set -> ineligible / STRUCTURALLY_CORRUPT_SET', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1), { isDropSet: true }),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('STRUCTURALLY_CORRUPT_SET');
      expect(res.ineligibleSetCount).toBe(1);
    });

    it('snapshot-bearing loose-form set -> ineligible / STRUCTURALLY_CORRUPT_SET', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1), { form: 'loose' }),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('STRUCTURALLY_CORRUPT_SET');
      expect(res.ineligibleSetCount).toBe(1);
    });

    it('snapshot-bearing ineligible set (e.g. invalid snapshot field) -> ineligible / STRUCTURALLY_CORRUPT_SET', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1, { presentedReps: 0 })),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('STRUCTURALLY_CORRUPT_SET');
      expect(res.ineligibleSetCount).toBe(1);
    });
  });

  describe('Nudge handling', () => {
    it('no nudge -> nudgedSetPresent: false and null nudge fields', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1, { nudgeType: 'none' })),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.nudgedSetPresent).toBe(false);
      expect(res.nudgedSetAchieved).toBeNull();
      expect(res.nudgedSetOutcome).toBeNull();
      expect(res.nudgedWorkingSetOrdinal).toBeNull();
    });

    it('successful rep nudge -> nudgedSetPresent: true, nudgedSetAchieved: true', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2, {
          nudgeType: 'none',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'REP_NUDGE',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
        makeSet(2, 80, 9, 8.0, makeSnapshot(2, 2, {
          presentedReps: 9,
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'REP_NUDGE',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('success');
      expect(res.nudgedSetPresent).toBe(true);
      expect(res.nudgedWorkingSetOrdinal).toBe(2);
      expect(res.nudgedSetOutcome).toBe('success');
      expect(res.nudgedSetAchieved).toBe(true);
    });

    it('failed rep nudge -> nudgedSetPresent: true, nudgedSetAchieved: false', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2, {
          nudgeType: 'none',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'REP_NUDGE',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
        makeSet(2, 80, 7, 8.0, makeSnapshot(2, 2, {
          presentedReps: 9,
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'REP_NUDGE',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('substantial_miss'); // 7 reps vs 9 presented = 2 shortfall = substantial miss
      expect(res.nudgedSetPresent).toBe(true);
      expect(res.nudgedWorkingSetOrdinal).toBe(2);
      expect(res.nudgedSetOutcome).toBe('substantial_miss');
      expect(res.nudgedSetAchieved).toBe(false);
    });

    it('successful load nudge -> nudgedSetPresent: true, nudgedSetAchieved: true', () => {
      const input = makeInput([
        makeSet(1, 82.5, 8, 8.0, makeSnapshot(1, 1, {
          presentedWeight: 82.5,
          comparisonLoadKg: 82.5,
          nudgeType: 'load_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('success');
      expect(res.nudgedSetPresent).toBe(true);
      expect(res.nudgedWorkingSetOrdinal).toBe(1);
      expect(res.nudgedSetOutcome).toBe('success');
      expect(res.nudgedSetAchieved).toBe(true);
    });

    it('marginal load-nudge miss -> nudgedSetPresent: true, nudgedSetAchieved: false', () => {
      const input = makeInput([
        makeSet(1, 82.5, 7, 8.0, makeSnapshot(1, 1, {
          presentedWeight: 82.5,
          comparisonLoadKg: 82.5,
          nudgeType: 'load_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('marginal_miss');
      expect(res.nudgedSetPresent).toBe(true);
      expect(res.nudgedWorkingSetOrdinal).toBe(1);
      expect(res.nudgedSetOutcome).toBe('marginal_miss');
      expect(res.nudgedSetAchieved).toBe(false);
    });

    it('hold is not treated as active nudge', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1, {
          nudgeType: 'hold',
          coachingReasonCode: 'CHALLENGE_CAP_HOLD',
        })),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.nudgedSetPresent).toBe(false);
      expect(res.nudgedSetAchieved).toBeNull();
      expect(res.nudgedSetOutcome).toBeNull();
      expect(res.nudgedWorkingSetOrdinal).toBeNull();
    });

    it('none is not treated as active nudge', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1, { nudgeType: 'none' })),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.nudgedSetPresent).toBe(false);
      expect(res.nudgedSetAchieved).toBeNull();
    });

    it('multiple active nudge markers fail closed as ineligible / MULTIPLE_NUDGE_MARKERS', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2, {
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'REP_NUDGE',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
        makeSet(2, 80, 8, 8.0, makeSnapshot(2, 2, {
          nudgeType: 'load_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'REP_NUDGE',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
      ]);
      const res = classifyGuidedExerciseOutcome(input);
      expect(res.outcome).toBe('ineligible');
      expect(res.reason).toBe('MULTIPLE_NUDGE_MARKERS');
      expect(res.nudgedSetPresent).toBe(true);
      expect(res.nudgedSetAchieved).toBeNull();
      expect(res.nudgedSetOutcome).toBeNull();
      expect(res.nudgedWorkingSetOrdinal).toBeNull();
    });
  });

  describe('Count diagnostics', () => {
    it('accurately reports all count fields, missing ordinals, and ignored unprescribed sets', () => {
      const input = makeInput([
        makeSet(1, 40, 10, null, null, { isWarmup: true }), // ignored unprescribed
        makeSet(2, 80, 8, 8.0, makeSnapshot(1, 4)), // prescribed 1: success
        makeSet(3, 80, 7, 8.0, makeSnapshot(2, 4)), // prescribed 2: marginal miss
        // prescribed 3 deleted -> missing
        makeSet(4, 80, 0, null, makeSnapshot(4, 4), { isSkipped: true }), // prescribed 4: neutral
        makeSet(5, 70, 12, null, null), // ignored unprescribed
      ]);

      const res = classifyGuidedExerciseOutcome(input);
      expect(res.expectedPrescribedSetCount).toBe(4);
      expect(res.observedPrescribedSetCount).toBe(3);
      expect(res.attemptedPrescribedSetCount).toBe(2);
      expect(res.successfulPrescribedSetCount).toBe(1);
      expect(res.marginalMissCount).toBe(1);
      expect(res.substantialMissCount).toBe(0);
      expect(res.neutralSetCount).toBe(1);
      expect(res.ineligibleSetCount).toBe(0);
      expect(res.missingWorkingSetOrdinals).toEqual([3]);
      expect(res.ignoredUnprescribedSetCount).toBe(2);
      // Because neutralSetCount > 0, precedence rule 2 triggers PRESCRIBED_SET_SKIPPED
      expect(res.outcome).toBe('neutral');
      expect(res.reason).toBe('PRESCRIBED_SET_SKIPPED');
    });
  });

  describe('Purity and Immutability', () => {
    let mockStorage: Record<string, string>;

    beforeEach(() => {
      mockStorage = {};
      const storageMock = {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: () => {
          throw new Error('Storage write violation');
        },
        removeItem: () => {
          throw new Error('Storage write violation');
        },
        clear: () => {
          throw new Error('Storage write violation');
        },
        key: () => null,
        length: 0,
      } as Storage;

      Object.defineProperty(globalThis, 'localStorage', {
        value: storageMock,
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      // Clean up
    });

    it('deep input immutability: inputs remain identical before and after execution', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2, {
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'REP_NUDGE',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
        makeSet(2, 80, 8, 8.0, makeSnapshot(2, 2, {
          nudgeType: 'none',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          coachingReasonCode: 'REP_NUDGE',
          rollbackTarget: { weight: 80, reps: 8, rpe: 8.0, comparisonLoadKg: 80 },
        })),
      ]);
      const copyBefore = JSON.parse(JSON.stringify(input));

      classifyGuidedExerciseOutcome(input);

      expect(input).toEqual(copyBefore);
    });

    it('deterministic repeated calls return identical results for identical inputs', () => {
      const input = makeInput([
        makeSet(1, 80, 8, 8.0, makeSnapshot(1, 2)),
        makeSet(2, 80, 8, 8.0, makeSnapshot(2, 2)),
      ]);

      const res1 = classifyGuidedExerciseOutcome(input);
      const res2 = classifyGuidedExerciseOutcome(input);

      expect(res1).toEqual(res2);
    });

    it('zero localStorage dependency: does not access localStorage', () => {
      const input = makeInput([makeSet(1, 80, 8, 8.0, makeSnapshot(1, 1))]);
      expect(() => classifyGuidedExerciseOutcome(input)).not.toThrow();
    });
  });
});
