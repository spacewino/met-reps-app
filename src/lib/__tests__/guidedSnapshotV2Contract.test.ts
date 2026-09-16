/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
  ALL_GUIDED_COACHING_REASON_CODES,
  isGuidedCoachingReasonCode,
  isValidRollbackTarget,
  isValidSnapshotStepMetadata,
  isValidCoachingReasonMetadata,
} from '../programProgressionMode';
import { classifyGuidedSetOutcome } from '../guidedOutcomeClassifier';
import { classifyGuidedExerciseOutcome } from '../guidedExerciseClassifier';
import {
  isValidTargetSnapshot,
  collectComparableGuidedHistory,
} from '../guidedHistoryCollector';
import {
  PrescriptionSnapshot,
  SetEntry,
  ExerciseEntry,
  WorkoutLog,
  GuidedRollbackTarget,
  Program,
} from '../../types';

describe('APC-3B2C1A: Immutable Guided Replay Snapshot Contract (v2)', () => {
  const validRollbackTarget: GuidedRollbackTarget = {
    weight: 80,
    reps: 8,
    rpe: 8.0,
    comparisonLoadKg: 80,
  };

  function createValidV2Snapshot(
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
      workingSetOrdinal: 1,
      prescribedWorkingSetCount: 2,
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

  describe('1. Version and Reason Code Taxonomy', () => {
    it('locks CURRENT_PRESCRIPTION_SNAPSHOT_VERSION to 2', () => {
      expect(CURRENT_PRESCRIPTION_SNAPSHOT_VERSION).toBe(2);
    });

    it('validates all 19 closed GuidedCoachingReasonCodes', () => {
      expect(ALL_GUIDED_COACHING_REASON_CODES.size).toBe(19);

      const expectedCodes = [
        'BASE_PRESCRIPTION',
        'REP_NUDGE',
        'LOAD_NUDGE_MAIN_MOVEMENT',
        'LOAD_PROMOTION_CEILING_REACHED',
        'CHALLENGE_CAP_HOLD',
        'HIGH_EXERTION_HOLD',
        'STEP_OUT_BASE_ONLY',
        'BODYWEIGHT_CEILING_HOLD',
        'BODYWEIGHT_MAIN_LOAD_HOLD',
        'MINIMUM_ASSISTANCE_REACHED',
        'MISSING_BODYWEIGHT_HOLD',
        'INVALID_ASSISTANCE_HOLD',
        'ZERO_NET_LOAD_HOLD',
        'MARGINAL_MISS_TARGET_HELD',
        'NUDGE_NEUTRAL_RETRY',
        'NUDGE_MARGINAL_FAILURE_ROLLBACK',
        'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK',
        'DEGRADED_HISTORY_HOLD',
        'INCONSISTENT_HISTORY_HOLD',
      ];

      for (const code of expectedCodes) {
        expect(ALL_GUIDED_COACHING_REASON_CODES.has(code as any)).toBe(true);
        expect(isGuidedCoachingReasonCode(code)).toBe(true);
      }
    });

    it('rejects unrecognised, arbitrary, or empty coaching reason strings', () => {
      expect(isGuidedCoachingReasonCode('BASELINE')).toBe(false);
      expect(isGuidedCoachingReasonCode('CUSTOM_REASON')).toBe(false);
      expect(isGuidedCoachingReasonCode('')).toBe(false);
      expect(isGuidedCoachingReasonCode(null)).toBe(false);
      expect(isGuidedCoachingReasonCode(123)).toBe(false);
    });
  });

  describe('2. Rollback Target Validation (isValidRollbackTarget)', () => {
    it('accepts valid weighted rollback target', () => {
      expect(isValidRollbackTarget(validRollbackTarget, 'weighted')).toBe(true);
    });

    it('accepts valid bodyweight rollback target with weight 0', () => {
      const bwTarget: GuidedRollbackTarget = {
        weight: 0,
        reps: 10,
        rpe: 8.5,
        comparisonLoadKg: 75,
      };
      expect(isValidRollbackTarget(bwTarget, 'bodyweight')).toBe(true);
    });

    it('rejects bodyweight rollback target with non-zero weight', () => {
      const bwTarget: GuidedRollbackTarget = {
        weight: 5,
        reps: 10,
        rpe: 8.5,
        comparisonLoadKg: 75,
      };
      expect(isValidRollbackTarget(bwTarget, 'bodyweight')).toBe(false);
    });

    it('accepts valid assisted rollback target with positive assistance weight', () => {
      const assistedTarget: GuidedRollbackTarget = {
        weight: 20,
        reps: 8,
        rpe: 8.0,
        comparisonLoadKg: 60,
      };
      expect(isValidRollbackTarget(assistedTarget, 'assisted')).toBe(true);
    });

    it('rejects invalid reps, RPE, or comparisonLoadKg', () => {
      expect(isValidRollbackTarget({ ...validRollbackTarget, reps: 0 }, 'weighted')).toBe(false);
      expect(isValidRollbackTarget({ ...validRollbackTarget, reps: -1 }, 'weighted')).toBe(false);
      expect(isValidRollbackTarget({ ...validRollbackTarget, reps: 5.5 }, 'weighted')).toBe(false);
      expect(isValidRollbackTarget({ ...validRollbackTarget, rpe: 5.0 }, 'weighted')).toBe(false);
      expect(isValidRollbackTarget({ ...validRollbackTarget, rpe: 11.0 }, 'weighted')).toBe(false);
      expect(isValidRollbackTarget({ ...validRollbackTarget, comparisonLoadKg: 0 }, 'weighted')).toBe(false);
      expect(isValidRollbackTarget({ ...validRollbackTarget, comparisonLoadKg: -10 }, 'weighted')).toBe(false);
      expect(isValidRollbackTarget({ ...validRollbackTarget, comparisonLoadKg: NaN }, 'weighted')).toBe(false);
    });
  });

  describe('3. Snapshot Step Metadata Validation (isValidSnapshotStepMetadata)', () => {
    it('validates stable step: presentedStepIndex === confirmedStepIndexBefore requires rollbackTarget === null', () => {
      const snap = createValidV2Snapshot({
        confirmedStepIndexBefore: 3,
        presentedStepIndex: 3,
        rollbackTarget: null,
      });
      expect(isValidSnapshotStepMetadata(snap)).toBe(true);

      const invalidSnap = createValidV2Snapshot({
        confirmedStepIndexBefore: 3,
        presentedStepIndex: 3,
        rollbackTarget: validRollbackTarget,
      });
      expect(isValidSnapshotStepMetadata(invalidSnap)).toBe(false);
    });

    it('validates advance step: presentedStepIndex === confirmedStepIndexBefore + 1 requires valid rollbackTarget', () => {
      const snap = createValidV2Snapshot({
        confirmedStepIndexBefore: 3,
        presentedStepIndex: 4,
        coachingReasonCode: 'REP_NUDGE',
        rollbackTarget: validRollbackTarget,
      });
      expect(isValidSnapshotStepMetadata(snap)).toBe(true);

      const missingRollback = createValidV2Snapshot({
        confirmedStepIndexBefore: 3,
        presentedStepIndex: 4,
        coachingReasonCode: 'REP_NUDGE',
        rollbackTarget: null,
      });
      expect(isValidSnapshotStepMetadata(missingRollback)).toBe(false);
    });

    it('rejects step index regression or jumping more than 1 step', () => {
      const regressed = createValidV2Snapshot({
        confirmedStepIndexBefore: 2,
        presentedStepIndex: 1,
        rollbackTarget: null,
      });
      expect(isValidSnapshotStepMetadata(regressed)).toBe(false);

      const jumped = createValidV2Snapshot({
        confirmedStepIndexBefore: 2,
        presentedStepIndex: 4,
        rollbackTarget: validRollbackTarget,
      });
      expect(isValidSnapshotStepMetadata(jumped)).toBe(false);
    });

    it('rejects negative or fractional step indices', () => {
      expect(
        isValidSnapshotStepMetadata(
          createValidV2Snapshot({ confirmedStepIndexBefore: -1, presentedStepIndex: -1 })
        )
      ).toBe(false);

      expect(
        isValidSnapshotStepMetadata(
          createValidV2Snapshot({ confirmedStepIndexBefore: 1.5, presentedStepIndex: 1.5 })
        )
      ).toBe(false);
    });
  });

  describe('4. Set Outcome Classifier Fail-Closed Behavior', () => {
    const defaultWorkout: WorkoutLog = {
      id: 'w-1',
      date: '2026-08-20',
      startTime: '10:00',
      programId: 'prog-1',
      unit: 'kg',
      exercises: [],
    };

    const defaultExercise: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      exerciseKey: 'barbell_bench_press',
      modality: 'weighted',
      sets: [],
    };

    it('fails closed on snapshotVersion: 1 (legacy snapshot in Guided mode)', () => {
      const v1Snap: any = createValidV2Snapshot({ snapshotVersion: 1 });
      const set: SetEntry = {
        setNumber: 1,
        weight: 80,
        reps: 8,
        rpe: 8.0,
        isCompleted: true,
        prescriptionSnapshot: v1Snap,
      };

      const result = classifyGuidedSetOutcome({
        set,
        exercise: defaultExercise,
        workout: defaultWorkout,
      });

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('SNAPSHOT_VERSION_MISMATCH');
    });

    it('fails closed on invalid step metadata in snapshot', () => {
      const invalidSnap = createValidV2Snapshot({
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: null, // missing rollback target on advance step
      });
      const set: SetEntry = {
        setNumber: 1,
        weight: 80,
        reps: 8,
        rpe: 8.0,
        isCompleted: true,
        prescriptionSnapshot: invalidSnap,
      };

      const result = classifyGuidedSetOutcome({
        set,
        exercise: defaultExercise,
        workout: defaultWorkout,
      });

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');
    });
  });

  describe('5. Exercise Outcome Classifier Cross-Set Validation', () => {
    const defaultWorkout: WorkoutLog = {
      id: 'w-1',
      date: '2026-08-20',
      startTime: '10:00',
      programId: 'prog-1',
      unit: 'kg',
      exercises: [],
    };

    it('fails closed when prescribed sets have conflicting confirmedStepIndexBefore', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        exerciseKey: 'barbell_bench_press',
        modality: 'weighted',
        sets: [
          {
            setNumber: 1,
            weight: 80,
            reps: 8,
            rpe: 8.0,
            isCompleted: true,
            prescriptionSnapshot: createValidV2Snapshot({
              workingSetOrdinal: 1,
              confirmedStepIndexBefore: 0,
              presentedStepIndex: 0,
            }),
          },
          {
            setNumber: 2,
            weight: 80,
            reps: 8,
            rpe: 8.0,
            isCompleted: true,
            prescriptionSnapshot: createValidV2Snapshot({
              workingSetOrdinal: 2,
              confirmedStepIndexBefore: 1, // Conflict!
              presentedStepIndex: 0,
            }),
          },
        ],
      };

      const result = classifyGuidedExerciseOutcome({ exercise, workout: defaultWorkout });
      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INCONSISTENT_PRESCRIBED_SNAPSHOTS');
    });

    it('fails closed when step is advanced but no active nudge marker is present', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        exerciseKey: 'barbell_bench_press',
        modality: 'weighted',
        sets: [
          {
            setNumber: 1,
            weight: 80,
            reps: 8,
            rpe: 8.0,
            isCompleted: true,
            prescriptionSnapshot: createValidV2Snapshot({
              workingSetOrdinal: 1,
              confirmedStepIndexBefore: 0,
              presentedStepIndex: 1, // Advanced
              nudgeType: 'none', // No active nudge marker!
              coachingReasonCode: 'REP_NUDGE',
              rollbackTarget: validRollbackTarget,
            }),
          },
          {
            setNumber: 2,
            weight: 80,
            reps: 8,
            rpe: 8.0,
            isCompleted: true,
            prescriptionSnapshot: createValidV2Snapshot({
              workingSetOrdinal: 2,
              confirmedStepIndexBefore: 0,
              presentedStepIndex: 1,
              nudgeType: 'none', // No active nudge marker!
              coachingReasonCode: 'REP_NUDGE',
              rollbackTarget: validRollbackTarget,
            }),
          },
        ],
      };

      const result = classifyGuidedExerciseOutcome({ exercise, workout: defaultWorkout });
      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_NUDGE_STEP_RELATIONSHIP');
    });

    it('fails closed when step is stable but an active nudge marker is present', () => {
      const exercise: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        exerciseKey: 'barbell_bench_press',
        modality: 'weighted',
        sets: [
          {
            setNumber: 1,
            weight: 80,
            reps: 8,
            rpe: 8.0,
            isCompleted: true,
            prescriptionSnapshot: createValidV2Snapshot({
              workingSetOrdinal: 1,
              confirmedStepIndexBefore: 0,
              presentedStepIndex: 0, // Stable
              nudgeType: 'none',
              coachingReasonCode: 'BASE_PRESCRIPTION',
              rollbackTarget: null,
            }),
          },
          {
            setNumber: 2,
            weight: 80,
            reps: 9,
            rpe: 8.0,
            isCompleted: true,
            prescriptionSnapshot: createValidV2Snapshot({
              workingSetOrdinal: 2,
              confirmedStepIndexBefore: 0,
              presentedStepIndex: 0, // Stable
              nudgeType: 'rep_nudge', // Active nudge on stable step!
              coachingReasonCode: 'BASE_PRESCRIPTION',
              rollbackTarget: null,
            }),
          },
        ],
      };

      const result = classifyGuidedExerciseOutcome({ exercise, workout: defaultWorkout });
      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_NUDGE_STEP_RELATIONSHIP');
    });
  });

  describe('6. History Collector Snapshot Validation (isValidTargetSnapshot)', () => {
    it('accepts fully valid v2 target snapshot', () => {
      const snap = createValidV2Snapshot();
      expect(isValidTargetSnapshot(snap)).toBe(true);
    });

    it('rejects v1 target snapshot (fail closed)', () => {
      const v1Snap: any = createValidV2Snapshot({ snapshotVersion: 1 });
      expect(isValidTargetSnapshot(v1Snap)).toBe(false);
    });

    it('rejects target snapshot with invalid step metadata', () => {
      const badSnap = createValidV2Snapshot({
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: null,
      });
      expect(isValidTargetSnapshot(badSnap)).toBe(false);
    });
  });

  describe('7. Reason-Metadata Compatibility Matrix (19 Canonical Reasons & Fail-Closed Invariants)', () => {
    const STABLE_HOLD_REASONS = [
      'CHALLENGE_CAP_HOLD',
      'STEP_OUT_BASE_ONLY',
      'BODYWEIGHT_CEILING_HOLD',
      'BODYWEIGHT_MAIN_LOAD_HOLD',
      'MINIMUM_ASSISTANCE_REACHED',
      'MISSING_BODYWEIGHT_HOLD',
      'INVALID_ASSISTANCE_HOLD',
      'ZERO_NET_LOAD_HOLD',
      'HIGH_EXERTION_HOLD',
      'MARGINAL_MISS_TARGET_HELD',
      'NUDGE_MARGINAL_FAILURE_ROLLBACK',
      'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK',
      'DEGRADED_HISTORY_HOLD',
      'INCONSISTENT_HISTORY_HOLD',
    ] as const;

    const ADVANCED_REASONS = [
      'REP_NUDGE',
      'LOAD_NUDGE_MAIN_MOVEMENT',
      'LOAD_PROMOTION_CEILING_REACHED',
      'NUDGE_NEUTRAL_RETRY',
    ] as const;

    describe('Table-driven positive tests for all 19 canonical reasons', () => {
      const canonicalMatrixCases = [
        {
          reason: 'BASE_PRESCRIPTION' as const,
          nudgeType: 'none' as const,
          stepDelta: 0,
          credit: true,
          hasRollback: false,
        },
        {
          reason: 'REP_NUDGE' as const,
          nudgeType: 'rep_nudge' as const,
          stepDelta: 1,
          credit: true,
          hasRollback: true,
        },
        {
          reason: 'LOAD_NUDGE_MAIN_MOVEMENT' as const,
          nudgeType: 'load_nudge' as const,
          stepDelta: 1,
          credit: true,
          hasRollback: true,
        },
        {
          reason: 'LOAD_PROMOTION_CEILING_REACHED' as const,
          nudgeType: 'load_nudge' as const,
          stepDelta: 1,
          credit: true,
          hasRollback: true,
        },
        {
          reason: 'NUDGE_NEUTRAL_RETRY' as const,
          nudgeType: 'rep_nudge' as const,
          stepDelta: 1,
          credit: true,
          hasRollback: true,
        },
        {
          reason: 'NUDGE_NEUTRAL_RETRY' as const,
          nudgeType: 'load_nudge' as const,
          stepDelta: 1,
          credit: true,
          hasRollback: true,
        },
        {
          reason: 'CHALLENGE_CAP_HOLD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: false,
          hasRollback: false,
        },
        {
          reason: 'STEP_OUT_BASE_ONLY' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: false,
          hasRollback: false,
        },
        {
          reason: 'BODYWEIGHT_CEILING_HOLD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: false,
          hasRollback: false,
        },
        {
          reason: 'BODYWEIGHT_MAIN_LOAD_HOLD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: false,
          hasRollback: false,
        },
        {
          reason: 'MINIMUM_ASSISTANCE_REACHED' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: false,
          hasRollback: false,
        },
        {
          reason: 'MISSING_BODYWEIGHT_HOLD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: false,
          hasRollback: false,
        },
        {
          reason: 'INVALID_ASSISTANCE_HOLD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: false,
          hasRollback: false,
        },
        {
          reason: 'ZERO_NET_LOAD_HOLD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: false,
          hasRollback: false,
        },
        {
          reason: 'HIGH_EXERTION_HOLD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: true,
          hasRollback: false,
        },
        {
          reason: 'MARGINAL_MISS_TARGET_HELD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: true,
          hasRollback: false,
        },
        {
          reason: 'NUDGE_MARGINAL_FAILURE_ROLLBACK' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: true,
          hasRollback: false,
        },
        {
          reason: 'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: true,
          hasRollback: false,
        },
        {
          reason: 'DEGRADED_HISTORY_HOLD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: true,
          hasRollback: false,
        },
        {
          reason: 'INCONSISTENT_HISTORY_HOLD' as const,
          nudgeType: 'hold' as const,
          stepDelta: 0,
          credit: true,
          hasRollback: false,
        },
      ];

      it.each(canonicalMatrixCases)(
        'validates canonical row: $reason with nudgeType: $nudgeType, delta: $stepDelta, credit: $credit',
        ({ reason, nudgeType, stepDelta, credit, hasRollback }) => {
          const snap = createValidV2Snapshot({
            coachingReasonCode: reason,
            nudgeType,
            confirmedStepIndexBefore: 2,
            presentedStepIndex: 2 + stepDelta,
            successCreditEligible: credit,
            rollbackTarget: hasRollback ? validRollbackTarget : null,
          });
          expect(isValidCoachingReasonMetadata(snap)).toBe(true);
          expect(isValidSnapshotStepMetadata(snap)).toBe(true);
        }
      );

      it.each(ADVANCED_REASONS)(
        'validates companion set with nudgeType: none for advanced reason: %s',
        reason => {
          const companionSnap = createValidV2Snapshot({
            coachingReasonCode: reason,
            nudgeType: 'none',
            confirmedStepIndexBefore: 1,
            presentedStepIndex: 2,
            successCreditEligible: true,
            rollbackTarget: validRollbackTarget,
          });
          expect(isValidCoachingReasonMetadata(companionSnap)).toBe(true);
          expect(isValidSnapshotStepMetadata(companionSnap)).toBe(true);
        }
      );
    });

    describe('Explicit Rejection & Matrix Invariant Cases (1 - 38)', () => {
      const defaultWorkout: WorkoutLog = {
        id: 'w-contract-rc1',
        date: '2026-09-04',
        startTime: '08:00',
        programId: 'prog-1',
        unit: 'kg',
        exercises: [],
      };

      it('1. Base prescription with any active nudge is rejected', () => {
        const repNudge = createValidV2Snapshot({
          coachingReasonCode: 'BASE_PRESCRIPTION',
          nudgeType: 'rep_nudge',
        });
        const loadNudge = createValidV2Snapshot({
          coachingReasonCode: 'BASE_PRESCRIPTION',
          nudgeType: 'load_nudge',
        });
        expect(isValidCoachingReasonMetadata(repNudge)).toBe(false);
        expect(isValidSnapshotStepMetadata(repNudge)).toBe(false);
        expect(isValidCoachingReasonMetadata(loadNudge)).toBe(false);
        expect(isValidSnapshotStepMetadata(loadNudge)).toBe(false);
      });

      it('2. Base prescription with hold is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'BASE_PRESCRIPTION',
          nudgeType: 'hold',
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('3. Base prescription with step advance is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          rollbackTarget: validRollbackTarget,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('4. Base prescription with credit disabled is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'BASE_PRESCRIPTION',
          successCreditEligible: false,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('5. Rep nudge with a load marker is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'REP_NUDGE',
          nudgeType: 'load_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          rollbackTarget: validRollbackTarget,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('6. Rep nudge with stable step is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'REP_NUDGE',
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 1,
          presentedStepIndex: 1,
          rollbackTarget: null,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('7. Rep nudge with credit disabled is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'REP_NUDGE',
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 1,
          presentedStepIndex: 2,
          rollbackTarget: validRollbackTarget,
          successCreditEligible: false,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('8. Load-main-movement nudge with a rep marker is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          rollbackTarget: validRollbackTarget,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('9. Load promotion incorrectly treated as a stable hold is rejected', () => {
        const holdSnap = createValidV2Snapshot({
          coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
          nudgeType: 'hold',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 0,
          rollbackTarget: null,
        });
        expect(isValidCoachingReasonMetadata(holdSnap)).toBe(false);
        expect(isValidSnapshotStepMetadata(holdSnap)).toBe(false);
      });

      it('10. Load promotion with a rep marker is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          rollbackTarget: validRollbackTarget,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('11. Neutral retry with no exercise-level active marker is rejected as INVALID_NUDGE_STEP_RELATIONSHIP', () => {
        const exercise: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          sets: [
            {
              setNumber: 1,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 1,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'none',
                coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
                rollbackTarget: validRollbackTarget,
              }),
            },
            {
              setNumber: 2,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 2,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'none',
                coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
                rollbackTarget: validRollbackTarget,
              }),
            },
          ],
        };

        const result = classifyGuidedExerciseOutcome({ exercise, workout: defaultWorkout });
        expect(result.outcome).toBe('ineligible');
        expect(result.reason).toBe('INVALID_NUDGE_STEP_RELATIONSHIP');
      });

      it('12. Neutral retry with multiple markers is rejected as MULTIPLE_NUDGE_MARKERS', () => {
        const exercise: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          sets: [
            {
              setNumber: 1,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 1,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'rep_nudge',
                coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
                rollbackTarget: validRollbackTarget,
              }),
            },
            {
              setNumber: 2,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 2,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'load_nudge',
                coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
                rollbackTarget: validRollbackTarget,
              }),
            },
          ],
        };

        const result = classifyGuidedExerciseOutcome({ exercise, workout: defaultWorkout });
        expect(result.outcome).toBe('ineligible');
        expect(result.reason).toBe('MULTIPLE_NUDGE_MARKERS');
      });

      it('13. Neutral retry with a stable step is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 1,
          presentedStepIndex: 1,
          rollbackTarget: null,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('14. Neutral retry with null rollback is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
          nudgeType: 'rep_nudge',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          rollbackTarget: null,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('15. Step-out with credit enabled is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'STEP_OUT_BASE_ONLY',
          nudgeType: 'hold',
          successCreditEligible: true,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('16. Step-out with nudgeType: none instead of hold is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'STEP_OUT_BASE_ONLY',
          nudgeType: 'none',
          successCreditEligible: false,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('17. Step-out with an active marker is rejected', () => {
        const snapRep = createValidV2Snapshot({
          coachingReasonCode: 'STEP_OUT_BASE_ONLY',
          nudgeType: 'rep_nudge',
          successCreditEligible: false,
        });
        const snapLoad = createValidV2Snapshot({
          coachingReasonCode: 'STEP_OUT_BASE_ONLY',
          nudgeType: 'load_nudge',
          successCreditEligible: false,
        });
        expect(isValidCoachingReasonMetadata(snapRep)).toBe(false);
        expect(isValidSnapshotStepMetadata(snapRep)).toBe(false);
        expect(isValidCoachingReasonMetadata(snapLoad)).toBe(false);
        expect(isValidSnapshotStepMetadata(snapLoad)).toBe(false);
      });

      it('18. High-exertion hold with credit disabled is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'HIGH_EXERTION_HOLD',
          nudgeType: 'hold',
          successCreditEligible: false,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('19. High-exertion hold with an active marker is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'HIGH_EXERTION_HOLD',
          nudgeType: 'rep_nudge',
          successCreditEligible: true,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('20. Challenge-cap hold with credit enabled is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'CHALLENGE_CAP_HOLD',
          nudgeType: 'hold',
          successCreditEligible: true,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('21. Safety hold with credit enabled is rejected', () => {
        const safetyReasons = [
          'BODYWEIGHT_CEILING_HOLD',
          'BODYWEIGHT_MAIN_LOAD_HOLD',
          'MINIMUM_ASSISTANCE_REACHED',
          'MISSING_BODYWEIGHT_HOLD',
          'INVALID_ASSISTANCE_HOLD',
          'ZERO_NET_LOAD_HOLD',
        ] as const;

        for (const reason of safetyReasons) {
          const snap = createValidV2Snapshot({
            coachingReasonCode: reason,
            nudgeType: 'hold',
            successCreditEligible: true,
          });
          expect(isValidCoachingReasonMetadata(snap)).toBe(false);
          expect(isValidSnapshotStepMetadata(snap)).toBe(false);
        }
      });

      it('22. Marginal-miss hold with credit disabled is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'MARGINAL_MISS_TARGET_HELD',
          nudgeType: 'hold',
          successCreditEligible: false,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('23. Failure-rollback reason with step advance is rejected', () => {
        const marginal = createValidV2Snapshot({
          coachingReasonCode: 'NUDGE_MARGINAL_FAILURE_ROLLBACK',
          nudgeType: 'hold',
          confirmedStepIndexBefore: 1,
          presentedStepIndex: 2,
          rollbackTarget: validRollbackTarget,
        });
        const substantial = createValidV2Snapshot({
          coachingReasonCode: 'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK',
          nudgeType: 'hold',
          confirmedStepIndexBefore: 1,
          presentedStepIndex: 2,
          rollbackTarget: validRollbackTarget,
        });
        expect(isValidCoachingReasonMetadata(marginal)).toBe(false);
        expect(isValidSnapshotStepMetadata(marginal)).toBe(false);
        expect(isValidCoachingReasonMetadata(substantial)).toBe(false);
        expect(isValidSnapshotStepMetadata(substantial)).toBe(false);
      });

      it('24. Failure-rollback reason with a non-null rollback target is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'NUDGE_MARGINAL_FAILURE_ROLLBACK',
          nudgeType: 'hold',
          confirmedStepIndexBefore: 1,
          presentedStepIndex: 1,
          rollbackTarget: validRollbackTarget,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('25. Degraded-history hold with an active marker is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'DEGRADED_HISTORY_HOLD',
          nudgeType: 'load_nudge',
          successCreditEligible: true,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('26. Degraded-history hold with credit disabled is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'DEGRADED_HISTORY_HOLD',
          nudgeType: 'hold',
          successCreditEligible: false,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('27. Inconsistent-history hold with step advance is rejected', () => {
        const snap = createValidV2Snapshot({
          coachingReasonCode: 'INCONSISTENT_HISTORY_HOLD',
          nudgeType: 'hold',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 1,
          rollbackTarget: validRollbackTarget,
        });
        expect(isValidCoachingReasonMetadata(snap)).toBe(false);
        expect(isValidSnapshotStepMetadata(snap)).toBe(false);
      });

      it('28. Any stable hold using nudgeType: none is rejected', () => {
        for (const reason of STABLE_HOLD_REASONS) {
          const snap = createValidV2Snapshot({
            coachingReasonCode: reason,
            nudgeType: 'none',
            confirmedStepIndexBefore: 0,
            presentedStepIndex: 0,
            rollbackTarget: null,
          });
          expect(isValidCoachingReasonMetadata(snap)).toBe(false);
          expect(isValidSnapshotStepMetadata(snap)).toBe(false);
        }
      });

      it('29. Any advanced reason using nudgeType: hold is rejected', () => {
        for (const reason of ADVANCED_REASONS) {
          const snap = createValidV2Snapshot({
            coachingReasonCode: reason,
            nudgeType: 'hold',
            confirmedStepIndexBefore: 0,
            presentedStepIndex: 1,
            rollbackTarget: validRollbackTarget,
          });
          expect(isValidCoachingReasonMetadata(snap)).toBe(false);
          expect(isValidSnapshotStepMetadata(snap)).toBe(false);
        }
      });

      it('30. Multi-set rep nudge with exactly one rep_nudge marker and companion none snapshots is accepted', () => {
        const exercise: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          sets: [
            {
              setNumber: 1,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 1,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'rep_nudge',
                coachingReasonCode: 'REP_NUDGE',
                rollbackTarget: validRollbackTarget,
              }),
            },
            {
              setNumber: 2,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 2,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'none',
                coachingReasonCode: 'REP_NUDGE',
                rollbackTarget: validRollbackTarget,
              }),
            },
          ],
        };

        const result = classifyGuidedExerciseOutcome({ exercise, workout: defaultWorkout });
        expect(result.outcome).toBe('success');
        expect(result.nudgedSetPresent).toBe(true);
        expect(result.nudgedWorkingSetOrdinal).toBe(1);
      });

      it('31. Multi-set load promotion with exactly one load_nudge marker and companion none snapshots is accepted', () => {
        const exercise: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          sets: [
            {
              setNumber: 1,
              weight: 82.5,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 1,
                confirmedStepIndexBefore: 3,
                presentedStepIndex: 4,
                nudgeType: 'load_nudge',
                coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
                rollbackTarget: validRollbackTarget,
              }),
            },
            {
              setNumber: 2,
              weight: 82.5,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 2,
                confirmedStepIndexBefore: 3,
                presentedStepIndex: 4,
                nudgeType: 'none',
                coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
                rollbackTarget: validRollbackTarget,
              }),
            },
          ],
        };

        const result = classifyGuidedExerciseOutcome({ exercise, workout: defaultWorkout });
        expect(result.outcome).toBe('success');
        expect(result.nudgedSetPresent).toBe(true);
        expect(result.nudgedWorkingSetOrdinal).toBe(1);
      });

      it('32. Neutral retry with one rep marker is accepted', () => {
        const exercise: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          sets: [
            {
              setNumber: 1,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 1,
                confirmedStepIndexBefore: 1,
                presentedStepIndex: 2,
                nudgeType: 'rep_nudge',
                coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
                rollbackTarget: validRollbackTarget,
              }),
            },
            {
              setNumber: 2,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 2,
                confirmedStepIndexBefore: 1,
                presentedStepIndex: 2,
                nudgeType: 'none',
                coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
                rollbackTarget: validRollbackTarget,
              }),
            },
          ],
        };

        const result = classifyGuidedExerciseOutcome({ exercise, workout: defaultWorkout });
        expect(result.outcome).toBe('success');
        expect(result.nudgedSetPresent).toBe(true);
        expect(result.nudgedWorkingSetOrdinal).toBe(1);
      });

      it('33. Neutral retry with one load marker is accepted', () => {
        const exercise: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          sets: [
            {
              setNumber: 1,
              weight: 82.5,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 1,
                confirmedStepIndexBefore: 1,
                presentedStepIndex: 2,
                nudgeType: 'load_nudge',
                coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
                rollbackTarget: validRollbackTarget,
              }),
            },
            {
              setNumber: 2,
              weight: 82.5,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 2,
                confirmedStepIndexBefore: 1,
                presentedStepIndex: 2,
                nudgeType: 'none',
                coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
                rollbackTarget: validRollbackTarget,
              }),
            },
          ],
        };

        const result = classifyGuidedExerciseOutcome({ exercise, workout: defaultWorkout });
        expect(result.outcome).toBe('success');
        expect(result.nudgedSetPresent).toBe(true);
        expect(result.nudgedWorkingSetOrdinal).toBe(1);
      });

      it('34. Wrong active-marker type is rejected at exercise level as INVALID_NUDGE_STEP_RELATIONSHIP', () => {
        // REP_NUDGE reason with load_nudge marker
        const exerciseRep: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          sets: [
            {
              setNumber: 1,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 1,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'load_nudge',
                coachingReasonCode: 'REP_NUDGE',
                rollbackTarget: validRollbackTarget,
              }),
            },
            {
              setNumber: 2,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 2,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'none',
                coachingReasonCode: 'REP_NUDGE',
                rollbackTarget: validRollbackTarget,
              }),
            },
          ],
        };

        const resRep = classifyGuidedExerciseOutcome({ exercise: exerciseRep, workout: defaultWorkout });
        expect(resRep.outcome).toBe('ineligible');
        expect(resRep.reason).toBe('INVALID_NUDGE_STEP_RELATIONSHIP');

        // LOAD_NUDGE_MAIN_MOVEMENT reason with rep_nudge marker
        const exerciseLoad: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          sets: [
            {
              setNumber: 1,
              weight: 82.5,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 1,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'rep_nudge',
                coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
                rollbackTarget: validRollbackTarget,
              }),
            },
            {
              setNumber: 2,
              weight: 82.5,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 2,
                confirmedStepIndexBefore: 0,
                presentedStepIndex: 1,
                nudgeType: 'none',
                coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
                rollbackTarget: validRollbackTarget,
              }),
            },
          ],
        };

        const resLoad = classifyGuidedExerciseOutcome({ exercise: exerciseLoad, workout: defaultWorkout });
        expect(resLoad.outcome).toBe('ineligible');
        expect(resLoad.reason).toBe('INVALID_NUDGE_STEP_RELATIONSHIP');
      });

      it('35. Contradictory target snapshot is rejected by the history collector (isValidTargetSnapshot)', () => {
        const contradictorySnap = createValidV2Snapshot({
          coachingReasonCode: 'BASE_PRESCRIPTION',
          nudgeType: 'rep_nudge', // Contradictory!
        });
        expect(isValidTargetSnapshot(contradictorySnap)).toBe(false);
      });

      it('36. Contradictory candidate exercise is excluded from usable history by collectComparableGuidedHistory', () => {
        const targetSnap = createValidV2Snapshot();

        const program: Program = {
          id: 'prog-1',
          name: 'PPL',
          daysPerWeek: 3,
          programDuration: 4,
          createdAt: '2026-01-01T00:00:00.000Z',
          exercisesByDay: {},
          targetProgressionMode: 'metreps_guided',
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          unit: 'kg',
        };

        const candidateWorkout: WorkoutLog = {
          id: 'w-prev-1',
          date: '2026-08-01',
          startTime: '09:00',
          programId: 'prog-1',
          unit: 'kg',
          exercises: [
            {
              name: 'Barbell Bench Press',
              muscleGroup: 'Chest',
              exerciseKey: 'barbell_bench_press',
              modality: 'weighted',
              sets: [
                {
                  setNumber: 1,
                  weight: 80,
                  reps: 8,
                  rpe: 8.0,
                  isCompleted: true,
                  prescriptionSnapshot: createValidV2Snapshot({
                    workingSetOrdinal: 1,
                    coachingReasonCode: 'BASE_PRESCRIPTION',
                    nudgeType: 'rep_nudge', // Contradictory marker on base prescription
                  }),
                },
                {
                  setNumber: 2,
                  weight: 80,
                  reps: 8,
                  rpe: 8.0,
                  isCompleted: true,
                  prescriptionSnapshot: createValidV2Snapshot({
                    workingSetOrdinal: 2,
                    coachingReasonCode: 'BASE_PRESCRIPTION',
                    nudgeType: 'rep_nudge',
                  }),
                },
              ],
            },
          ],
        };

        const result = collectComparableGuidedHistory({
          targetProgramId: 'prog-1',
          targetSnapshot: targetSnap,
          boundary: {
            mode: 'active_live',
            targetDate: '2026-09-04',
            sessionStartedAt: 1788508800000,
          },
          programs: [program],
          logs: [candidateWorkout],
        });

        expect(result.status).toBe('success');
        if (result.status === 'success') {
          expect(result.usableExposures.length).toBe(0);
          expect(result.diagnostics.excludedExposures.length).toBeGreaterThan(0);
          expect(
            result.diagnostics.excludedExposures.some(
              e => e.reason === 'INELIGIBLE_EXERCISE_OUTCOME'
            )
          ).toBe(true);
        }
      });

      it('37. Whole-exercise skip still short-circuits contradictory snapshots neutrally', () => {
        const skippedExercise: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          isSkipped: true,
          sets: [
            {
              setNumber: 1,
              weight: 80,
              reps: 0,
              rpe: null,
              isCompleted: false,
              isSkipped: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 1,
                coachingReasonCode: 'BASE_PRESCRIPTION',
                nudgeType: 'rep_nudge', // Contradictory, but whole exercise is skipped
              }),
            },
            {
              setNumber: 2,
              weight: 80,
              reps: 0,
              rpe: null,
              isCompleted: false,
              isSkipped: true,
              prescriptionSnapshot: createValidV2Snapshot({
                workingSetOrdinal: 2,
                coachingReasonCode: 'BASE_PRESCRIPTION',
                nudgeType: 'rep_nudge',
              }),
            },
          ],
        };

        const result = classifyGuidedExerciseOutcome({ exercise: skippedExercise, workout: defaultWorkout });
        expect(result.outcome).toBe('neutral');
        expect(result.reason).toBe('EXERCISE_SKIPPED');
      });

      it('38. Version 1 remains fail-closed for unskipped evaluation', () => {
        const v1Snapshot: any = createValidV2Snapshot({
          snapshotVersion: 1,
        });

        expect(isValidTargetSnapshot(v1Snapshot)).toBe(false);

        const unskippedExercise: ExerciseEntry = {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          exerciseKey: 'barbell_bench_press',
          modality: 'weighted',
          sets: [
            {
              setNumber: 1,
              weight: 80,
              reps: 8,
              rpe: 8.0,
              isCompleted: true,
              prescriptionSnapshot: v1Snapshot,
            },
          ],
        };

        const result = classifyGuidedExerciseOutcome({ exercise: unskippedExercise, workout: defaultWorkout });
        expect(result.outcome).toBe('ineligible');
      });
    });
  });
});
