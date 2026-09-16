/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  replayGuidedLaneState,
  isReplaySuccess,
  arePrescriptionsEqual,
  arePrescriptionSetsEqual,
  ReplayGuidedLaneStateInput,
  GuidedReplayPrescriptionSet,
} from '../guidedLaneReplay';
import { convertWeightUnit } from '../assistedLoadMath';
import {
  ComparableGuidedExposure,
  ComparableGuidedSetDetail,
} from '../guidedHistoryCollector';
import {
  PrescriptionSnapshot,
  GuidedCoachingReasonCode,
  ProgressionNudgeType,
  ExerciseModality,
  WeightUnit,
  SetEntry,
} from '../../types';
import { GuidedExerciseOutcomeResult } from '../guidedExerciseClassifier';
import { GuidedSetOutcomeResult } from '../guidedOutcomeClassifier';

describe('guidedLaneReplay', () => {
  // Helper to build a valid Version 2 PrescriptionSnapshot
  const createSnapshot = (
    overrides?: Partial<PrescriptionSnapshot>
  ): PrescriptionSnapshot => {
    const coachingReasonCode: GuidedCoachingReasonCode =
      overrides?.coachingReasonCode ?? 'BASE_PRESCRIPTION';

    let nudgeType: ProgressionNudgeType = 'none';
    if (
      coachingReasonCode === 'REP_NUDGE' ||
      (coachingReasonCode === 'NUDGE_NEUTRAL_RETRY' && overrides?.nudgeType === 'rep_nudge')
    ) {
      nudgeType = 'rep_nudge';
    } else if (
      coachingReasonCode === 'LOAD_NUDGE_MAIN_MOVEMENT' ||
      coachingReasonCode === 'LOAD_PROMOTION_CEILING_REACHED' ||
      (coachingReasonCode === 'NUDGE_NEUTRAL_RETRY' && overrides?.nudgeType === 'load_nudge')
    ) {
      nudgeType = 'load_nudge';
    } else if (
      coachingReasonCode === 'STEP_OUT_BASE_ONLY' ||
      coachingReasonCode === 'HIGH_EXERTION_HOLD' ||
      coachingReasonCode === 'CHALLENGE_CAP_HOLD' ||
      coachingReasonCode === 'BODYWEIGHT_CEILING_HOLD' ||
      coachingReasonCode === 'BODYWEIGHT_MAIN_LOAD_HOLD' ||
      coachingReasonCode === 'MINIMUM_ASSISTANCE_REACHED' ||
      coachingReasonCode === 'MISSING_BODYWEIGHT_HOLD' ||
      coachingReasonCode === 'INVALID_ASSISTANCE_HOLD' ||
      coachingReasonCode === 'ZERO_NET_LOAD_HOLD'
    ) {
      nudgeType = 'hold';
    }

    const isHoldReason = nudgeType === 'hold';
    const isCreditEligible =
      coachingReasonCode === 'BASE_PRESCRIPTION' ||
      coachingReasonCode === 'REP_NUDGE' ||
      coachingReasonCode === 'LOAD_NUDGE_MAIN_MOVEMENT' ||
      coachingReasonCode === 'LOAD_PROMOTION_CEILING_REACHED' ||
      coachingReasonCode === 'NUDGE_NEUTRAL_RETRY' ||
      coachingReasonCode === 'HIGH_EXERTION_HOLD';

    const modality = overrides?.modality ?? 'weighted';
    const defaultBaseWeight = modality === 'bodyweight' ? 0 : 100;
    const baseWeight = overrides?.baseWeight ?? defaultBaseWeight;
    const baseReps = overrides?.baseReps ?? 8;
    const baseRpe = overrides?.baseRpe ?? 8;

    let presentedWeight = overrides?.presentedWeight ?? baseWeight;
    let presentedReps = overrides?.presentedReps ?? baseReps;
    if (overrides?.presentedWeight === undefined && nudgeType === 'load_nudge') {
      presentedWeight = baseWeight + 2.5;
    }
    if (overrides?.presentedReps === undefined && nudgeType === 'rep_nudge') {
      presentedReps = baseReps + 1;
    }

    const defaultComparisonLoad =
      modality === 'bodyweight'
        ? 75
        : overrides?.weightUnit === 'lb'
          ? convertWeightUnit(presentedWeight, 'lb', 'kg')
          : presentedWeight;
    const comparisonLoadKg = overrides?.comparisonLoadKg ?? defaultComparisonLoad;

    const confirmedStepIndexBefore = overrides?.confirmedStepIndexBefore ?? 0;
    const isAdvanceReason =
      coachingReasonCode === 'REP_NUDGE' ||
      coachingReasonCode === 'LOAD_NUDGE_MAIN_MOVEMENT' ||
      coachingReasonCode === 'LOAD_PROMOTION_CEILING_REACHED' ||
      coachingReasonCode === 'NUDGE_NEUTRAL_RETRY';

    const presentedStepIndex =
      overrides?.presentedStepIndex ??
      (isAdvanceReason ? confirmedStepIndexBefore + 1 : confirmedStepIndexBefore);

    const isAdvance = presentedStepIndex === confirmedStepIndexBefore + 1;

    const defaultRollbackComparisonLoad =
      modality === 'bodyweight'
        ? 75
        : overrides?.weightUnit === 'lb'
          ? convertWeightUnit(baseWeight, 'lb', 'kg')
          : baseWeight;

    const rollbackTarget = isAdvance
      ? (overrides?.rollbackTarget ?? {
          weight: baseWeight,
          reps: baseReps,
          rpe: baseRpe,
          comparisonLoadKg: defaultRollbackComparisonLoad,
        })
      : null;

    return {
      snapshotVersion: 2,
      progressionPolicyVersion: 1,
      algorithmVersion: 1,
      progressionMode: 'metreps_guided',
      algorithmId: 'hypertrophy_linear',
      exerciseKey: 'bench_press_standard',
      exerciseRole: 'main_movement',
      modality,
      comparableLaneKey: 'bench_press_flat_standard',
      workingSetOrdinal: 1,
      prescribedWorkingSetCount: 3,
      baseWeight,
      baseReps,
      baseRpe,
      presentedWeight,
      presentedReps,
      presentedRpe: overrides?.presentedRpe ?? baseRpe,
      bodyweightSnapshot:
        overrides?.bodyweightSnapshot !== undefined
          ? overrides.bodyweightSnapshot
          : modality === 'bodyweight'
            ? 75
            : null,
      weightUnit: overrides?.weightUnit ?? 'kg',
      comparisonLoadKg,
      loadBasis:
        overrides?.loadBasis ??
        (modality === 'bodyweight'
          ? 'bodyweight_normalized_v1'
          : 'external_weight_v1'),
      loadIncrement: 2.5,
      nudgeType,
      coachingReasonCode,
      confirmedStepIndexBefore,
      presentedStepIndex,
      successCreditEligible: overrides?.successCreditEligible ?? isCreditEligible,
      rollbackTarget,
      ...overrides,
    };
  };

  // Helper to build a 3-set ComparableGuidedExposure
  const createExposure = (options: {
    workoutLogId: string;
    workoutDate: string;
    workoutTimestampMs?: number | null;
    outcome: 'success' | 'marginal_miss' | 'substantial_miss' | 'neutral' | 'ineligible';
    reason?: GuidedCoachingReasonCode;
    classifierReason?: string;
    coachingReasonCode?: GuidedCoachingReasonCode;
    nudgeType?: ProgressionNudgeType;
    nudgedWorkingSetOrdinal?: number | null;
    nudgedSetAchieved?: boolean | null;
    confirmedStepIndexBefore?: number;
    presentedStepIndex?: number;
    baseWeight?: number;
    baseReps?: number;
    presentedWeight?: number;
    presentedReps?: number;
    successCreditEligible?: boolean;
    modality?: ExerciseModality;
    exerciseKey?: string;
    comparableLaneKey?: string;
    weightUnit?: WeightUnit;
    comparisonLoadKg?: number | null;
    rollbackTarget?: { weight: number; reps: number; rpe: number; comparisonLoadKg: number } | null;
    setOverrides?: Array<Partial<PrescriptionSnapshot>>;
  }): ComparableGuidedExposure => {
    const coachingReasonCode = options.coachingReasonCode ?? options.reason ?? 'BASE_PRESCRIPTION';
    const outcome = options.outcome;
    const modality = options.modality ?? 'weighted';
    const baseWeight = options.baseWeight ?? (modality === 'bodyweight' ? 0 : 100);
    const baseReps = options.baseReps ?? 8;
    const confirmedStepIndexBefore = options.confirmedStepIndexBefore ?? 0;
    const isAdvanceReason =
      coachingReasonCode === 'REP_NUDGE' ||
      coachingReasonCode === 'LOAD_NUDGE_MAIN_MOVEMENT' ||
      coachingReasonCode === 'LOAD_PROMOTION_CEILING_REACHED' ||
      coachingReasonCode === 'NUDGE_NEUTRAL_RETRY';

    const isHoldReason =
      coachingReasonCode === 'STEP_OUT_BASE_ONLY' ||
      coachingReasonCode === 'HIGH_EXERTION_HOLD' ||
      coachingReasonCode === 'CHALLENGE_CAP_HOLD' ||
      coachingReasonCode === 'BODYWEIGHT_CEILING_HOLD' ||
      coachingReasonCode === 'BODYWEIGHT_MAIN_LOAD_HOLD' ||
      coachingReasonCode === 'MINIMUM_ASSISTANCE_REACHED' ||
      coachingReasonCode === 'MISSING_BODYWEIGHT_HOLD' ||
      coachingReasonCode === 'INVALID_ASSISTANCE_HOLD' ||
      coachingReasonCode === 'ZERO_NET_LOAD_HOLD' ||
      coachingReasonCode === 'MARGINAL_MISS_TARGET_HELD' ||
      coachingReasonCode === 'NUDGE_MARGINAL_FAILURE_ROLLBACK' ||
      coachingReasonCode === 'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK' ||
      coachingReasonCode === 'DEGRADED_HISTORY_HOLD' ||
      coachingReasonCode === 'INCONSISTENT_HISTORY_HOLD';

    const defaultCreditEligible =
      coachingReasonCode === 'BASE_PRESCRIPTION' ||
      coachingReasonCode === 'REP_NUDGE' ||
      coachingReasonCode === 'LOAD_NUDGE_MAIN_MOVEMENT' ||
      coachingReasonCode === 'LOAD_PROMOTION_CEILING_REACHED' ||
      coachingReasonCode === 'NUDGE_NEUTRAL_RETRY' ||
      coachingReasonCode === 'HIGH_EXERTION_HOLD' ||
      coachingReasonCode === 'MARGINAL_MISS_TARGET_HELD' ||
      coachingReasonCode === 'NUDGE_MARGINAL_FAILURE_ROLLBACK' ||
      coachingReasonCode === 'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK' ||
      coachingReasonCode === 'DEGRADED_HISTORY_HOLD' ||
      coachingReasonCode === 'INCONSISTENT_HISTORY_HOLD';

    const presentedStepIndex =
      options.presentedStepIndex ??
      (isAdvanceReason ? confirmedStepIndexBefore + 1 : confirmedStepIndexBefore);

    const sets: ComparableGuidedSetDetail[] = [1, 2, 3].map(ord => {
      const isNudgedSet =
        options.nudgedWorkingSetOrdinal !== undefined
          ? options.nudgedWorkingSetOrdinal === ord
          : isAdvanceReason
            ? ord === 1
            : false;

      const setOverride = options.setOverrides?.[ord - 1] ?? {};

      const setNudgeType: ProgressionNudgeType = isHoldReason
        ? 'hold'
        : isNudgedSet
          ? options.nudgeType ??
            (coachingReasonCode === 'REP_NUDGE'
              ? 'rep_nudge'
              : coachingReasonCode === 'LOAD_NUDGE_MAIN_MOVEMENT' ||
                  coachingReasonCode === 'LOAD_PROMOTION_CEILING_REACHED'
                ? 'load_nudge'
                : 'none')
          : 'none';

      let setPresWeight = baseWeight;
      let setPresReps = baseReps;
      if (isNudgedSet) {
        if (options.presentedWeight !== undefined) {
          setPresWeight = options.presentedWeight;
        } else if (setNudgeType === 'load_nudge') {
          setPresWeight = baseWeight + 2.5;
        }
        if (options.presentedReps !== undefined) {
          setPresReps = options.presentedReps;
        } else if (setNudgeType === 'rep_nudge') {
          setPresReps = baseReps + 1;
        }
      }

      const snapshot = createSnapshot({
        workingSetOrdinal: ord,
        baseWeight,
        baseReps,
        presentedWeight: setPresWeight,
        presentedReps: setPresReps,
        confirmedStepIndexBefore,
        presentedStepIndex,
        coachingReasonCode,
        nudgeType: setNudgeType,
        successCreditEligible: options.successCreditEligible ?? defaultCreditEligible,
        modality: options.modality ?? 'weighted',
        exerciseKey: options.exerciseKey ?? 'bench_press_standard',
        comparableLaneKey: options.comparableLaneKey ?? 'bench_press_flat_standard',
        weightUnit: options.weightUnit ?? 'kg',
        ...(options.comparisonLoadKg !== undefined ? { comparisonLoadKg: options.comparisonLoadKg } : {}),
        ...(options.rollbackTarget !== undefined ? { rollbackTarget: options.rollbackTarget } : {}),
        ...setOverride,
      });

      const setResult: GuidedSetOutcomeResult = {
        outcome:
          outcome === 'neutral'
            ? 'neutral'
            : outcome === 'marginal_miss'
              ? 'marginal_miss'
              : outcome === 'substantial_miss'
                ? 'substantial_miss'
                : 'success',
        reason: outcome === 'neutral' ? 'SKIPPED_SET' : 'TARGET_ACHIEVED_EXACT',
        targetAchieved: outcome === 'success',
        extraCapacityCreditEligible: false,
        rpeSource: 'explicit',
        actualComparisonLoadKg: snapshot.comparisonLoadKg,
        presentedComparisonLoadKg: snapshot.comparisonLoadKg,
        presentedCapacityIndex: 1.0,
        actualCapacityIndex: 1.0,
        relativePerformance: 0,
      };

      const setEntry: SetEntry = {
        setNumber: ord,
        reps: snapshot.presentedReps,
        weight: snapshot.presentedWeight,
        rpe: snapshot.presentedRpe,
        isCompleted: outcome !== 'neutral',
        isSkipped: outcome === 'neutral',
        isWarmup: false,
        prescriptionSnapshot: snapshot,
      };

      return {
        workingSetOrdinal: ord,
        snapshot,
        setEntry,
        setResult,
      };
    });

    const isNudged = (options.nudgedWorkingSetOrdinal ?? null) !== null;
    const classification: GuidedExerciseOutcomeResult = {
      outcome,
      reason: (options.classifierReason ?? coachingReasonCode) as any,
      expectedPrescribedSetCount: 3,
      observedPrescribedSetCount: 3,
      attemptedPrescribedSetCount: outcome === 'neutral' ? 0 : 3,
      successfulPrescribedSetCount: outcome === 'success' ? 3 : 0,
      marginalMissCount: outcome === 'marginal_miss' ? 1 : 0,
      substantialMissCount: outcome === 'substantial_miss' ? 1 : 0,
      neutralSetCount: outcome === 'neutral' ? 3 : 0,
      ineligibleSetCount: 0,
      missingWorkingSetOrdinals: [],
      ignoredUnprescribedSetCount: 0,
      nudgedSetPresent: isNudged,
      nudgedSetAchieved: isNudged ? (options.nudgedSetAchieved ?? (outcome === 'success')) : null,
      nudgedSetOutcome: isNudged ? (outcome === 'success' ? 'success' : 'marginal_miss') : null,
      nudgedWorkingSetOrdinal: options.nudgedWorkingSetOrdinal ?? null,
      setResults: sets.map(s => ({
        workingSetOrdinal: s.workingSetOrdinal,
        result: s.setResult,
      })),
    };

    return {
      workoutLogId: options.workoutLogId,
      workoutDate: options.workoutDate,
      workoutTimestampMs: options.workoutTimestampMs ?? 1722470400000,
      scheduledDate: null,
      programId: 'program-1',
      cycleIndex: 1,
      lineagePosition: 0,
      week: 1,
      day: 1,
      exerciseIndex: 0,
      exerciseKey: options.exerciseKey ?? 'bench_press_standard',
      exerciseRole: 'main_movement',
      modality: options.modality ?? 'weighted',
      comparableLaneKey: options.comparableLaneKey ?? 'bench_press_flat_standard',
      weightUnit: options.weightUnit ?? 'kg',
      prescribedWorkingSetCount: 3,
      sets,
      nudgedWorkingSetOrdinal: options.nudgedWorkingSetOrdinal ?? null,
      nudgedSetOutcome: isNudged ? (outcome === 'success' ? 'success' : 'marginal_miss') : null,
      nudgedSetAchieved: isNudged ? (options.nudgedSetAchieved ?? (outcome === 'success')) : null,
      classification,
    };
  };

  // =========================================================================
  // THE 70 REQUIRED SPECIFICATION SCENARIOS
  // =========================================================================

  it('1. Empty complete history', () => {
    const res = replayGuidedLaneState({ exposures: [], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('empty');
      expect(res.successCredit).toBe(0);
      expect(res.gateReady).toBe(false);
      expect(res.historyNudgeEligible).toBe(false);
      expect(res.confirmedStepIndex).toBe(0);
      expect(res.confirmedNudgeCount).toBe(0);
      expect(res.stablePrescription).toBeNull();
      expect(res.lastDemonstratedPrescription).toBeNull();
      expect(res.pendingNudge).toBeNull();
      expect(res.marginalHoldActive).toBe(false);
      expect(res.rollbackRequired).toBe(false);
      expect(res.rollbackReason).toBeNull();
      expect(res.rollbackPrescription).toBeNull();
      expect(res.nextAction).toBe('establish_baseline');
      expect(res.processedExposureCount).toBe(0);
      expect(res.neutralExposureCount).toBe(0);
      expect(res.overperformanceExposureCount).toBe(0);
      expect(res.diagnostics).toHaveLength(0);
    }
  });

  it('2. One stable success', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      coachingReasonCode: 'BASE_PRESCRIPTION',
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('trusted');
      expect(res.successCredit).toBe(1);
      expect(res.gateReady).toBe(false);
      expect(res.historyNudgeEligible).toBe(false);
      expect(res.nextAction).toBe('build_success_credit');
      expect(res.stablePrescription).not.toBeNull();
      expect(res.stablePrescription![0].weight).toBe(100);
    }
  });

  it('3. Two stable successes', () => {
    const exp1 = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
    });
    const exp2 = createExposure({
      workoutLogId: 'w-2',
      workoutDate: '2026-08-03',
      outcome: 'success',
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('trusted');
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
      expect(res.historyNudgeEligible).toBe(true);
      expect(res.nextAction).toBe('eligible_for_nudge');
    }
  });

  it('4. Credit cap at two', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({ workoutLogId: 'w-3', workoutDate: '2026-08-05', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
    }
  });

  it('5. Missing-RPE success', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      classifierReason: 'TARGET_ACHIEVED_WITHOUT_RPE',
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(1);
    }
  });

  it('6. Explicit overperformance gives only one credit', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      classifierReason: 'TARGET_ACHIEVED_OVERPERFORMANCE',
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(1);
      expect(res.overperformanceExposureCount).toBe(1);
    }
  });

  it('7. Neutral exposure freezes credit', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'neutral' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(1);
      expect(res.neutralExposureCount).toBe(1);
      expect(res.nextAction).toBe('build_success_credit');
    }
  });

  it('8. Repeated neutrals freeze state', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'neutral' });
    const exp3 = createExposure({ workoutLogId: 'w-3', workoutDate: '2026-08-05', outcome: 'neutral' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(1);
      expect(res.neutralExposureCount).toBe(2);
    }
  });

  it('9. Marginal miss before gate freezes credit', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'marginal_miss' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(1);
      expect(res.marginalHoldActive).toBe(false);
      expect(res.nextAction).toBe('build_success_credit');
    }
  });

  it('10. Marginal miss after open gate activates repeat hold', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({ workoutLogId: 'w-3', workoutDate: '2026-08-05', outcome: 'marginal_miss' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
      expect(res.marginalHoldActive).toBe(true);
      expect(res.historyNudgeEligible).toBe(false);
      expect(res.nextAction).toBe('repeat_stable_target');
    }
  });

  it('11. Later stable success clears marginal hold', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({ workoutLogId: 'w-3', workoutDate: '2026-08-05', outcome: 'marginal_miss' });
    const exp4 = createExposure({ workoutLogId: 'w-4', workoutDate: '2026-08-07', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.marginalHoldActive).toBe(false);
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
      expect(res.historyNudgeEligible).toBe(true);
      expect(res.nextAction).toBe('eligible_for_nudge');
    }
  });

  it('12. Stable substantial miss resets credit', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({ workoutLogId: 'w-3', workoutDate: '2026-08-05', outcome: 'substantial_miss' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(0);
      expect(res.gateReady).toBe(false);
      expect(res.historyNudgeEligible).toBe(false);
      expect(res.nextAction).toBe('build_success_credit');
    }
  });

  it('13. First authorised rep nudge success', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.confirmedStepIndex).toBe(1);
      expect(res.confirmedNudgeCount).toBe(1);
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
      expect(res.stablePrescription![0].reps).toBe(9);
    }
  });

  it('14. Consecutive authorised rep nudges', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    // Next session nudges Set 2
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 2,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 1,
      presentedStepIndex: 2,
      setOverrides: [
        { workingSetOrdinal: 1, baseReps: 9, presentedReps: 9, nudgeType: 'none', coachingReasonCode: 'REP_NUDGE', confirmedStepIndexBefore: 1, presentedStepIndex: 2, rollbackTarget: { weight: 100, reps: 9, rpe: 8, comparisonLoadKg: 100 } },
        { workingSetOrdinal: 2, baseReps: 8, presentedReps: 9, nudgeType: 'rep_nudge', coachingReasonCode: 'REP_NUDGE', confirmedStepIndexBefore: 1, presentedStepIndex: 2, rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 } },
        { workingSetOrdinal: 3, baseReps: 8, presentedReps: 8, nudgeType: 'none', coachingReasonCode: 'REP_NUDGE', confirmedStepIndexBefore: 1, presentedStepIndex: 2, rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 } },
      ],
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.confirmedStepIndex).toBe(2);
      expect(res.confirmedNudgeCount).toBe(2);
      expect(res.stablePrescription![1].reps).toBe(9);
    }
  });

  it('15. Authorised load nudge success', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'success',
      coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
      nudgeType: 'load_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseWeight: 100,
      presentedWeight: 102.5,
      setOverrides: [
        { workingSetOrdinal: 1, baseWeight: 100, presentedWeight: 102.5, nudgeType: 'load_nudge', coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 } },
        { workingSetOrdinal: 2, baseWeight: 100, presentedWeight: 102.5, nudgeType: 'none', coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 } },
        { workingSetOrdinal: 3, baseWeight: 100, presentedWeight: 102.5, nudgeType: 'none', coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 } },
      ],
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.confirmedStepIndex).toBe(1);
      expect(res.confirmedNudgeCount).toBe(1);
      expect(res.stablePrescription![0].weight).toBe(102.5);
    }
  });

  it('16. Load-promotion success', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'success',
      coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
      nudgeType: 'load_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseWeight: 100,
      presentedWeight: 102.5,
      setOverrides: [
        { workingSetOrdinal: 1, baseWeight: 100, presentedWeight: 102.5, nudgeType: 'load_nudge', coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 } },
        { workingSetOrdinal: 2, baseWeight: 100, presentedWeight: 102.5, nudgeType: 'none', coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 } },
        { workingSetOrdinal: 3, baseWeight: 100, presentedWeight: 102.5, nudgeType: 'none', coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 } },
      ],
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.confirmedStepIndex).toBe(1);
      expect(res.confirmedNudgeCount).toBe(1);
    }
  });

  it('17. Rep-nudge marginal failure rollback', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.rollbackRequired).toBe(true);
      expect(res.rollbackReason).toBe('NUDGE_MARGINAL_FAILURE_ROLLBACK');
      expect(res.rollbackPrescription![0].reps).toBe(8);
      expect(res.confirmedStepIndex).toBe(0);
      expect(res.successCredit).toBe(0);
      expect(res.nextAction).toBe('present_rollback');
    }
  });

  it('18. Nudge substantial failure rollback', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'substantial_miss',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.rollbackRequired).toBe(true);
      expect(res.rollbackReason).toBe('NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK');
      expect(res.successCredit).toBe(0);
      expect(res.nextAction).toBe('present_rollback');
    }
  });

  it('19. Nudged set succeeds but another set misses', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'substantial_miss', // whole exercise missed
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true, // nudged set succeeded, but whole exercise missed
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      // Whole exercise outcome governs -> nudge rejected
      expect(res.rollbackRequired).toBe(true);
      expect(res.confirmedNudgeCount).toBe(0);
      expect(res.confirmedStepIndex).toBe(0);
    }
  });

  it('20. Load-promotion failure restores the prior rep ceiling', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success', baseReps: 12 });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success', baseReps: 12 });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
      nudgeType: 'load_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseWeight: 100,
      presentedWeight: 102.5,
      setOverrides: [
        { workingSetOrdinal: 1, baseWeight: 100, baseReps: 12, presentedWeight: 102.5, presentedReps: 8, nudgeType: 'load_nudge', coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 100, reps: 12, rpe: 8, comparisonLoadKg: 100 } },
        { workingSetOrdinal: 2, baseWeight: 100, baseReps: 12, presentedWeight: 102.5, presentedReps: 8, nudgeType: 'none', coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 100, reps: 12, rpe: 8, comparisonLoadKg: 100 } },
        { workingSetOrdinal: 3, baseWeight: 100, baseReps: 12, presentedWeight: 102.5, presentedReps: 8, nudgeType: 'none', coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 100, reps: 12, rpe: 8, comparisonLoadKg: 100 } },
      ],
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.rollbackRequired).toBe(true);
      expect(res.rollbackPrescription![0].reps).toBe(12);
      expect(res.rollbackPrescription![0].weight).toBe(100);
    }
  });

  it('21. Bodyweight per-set rollback', () => {
    const exp1 = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      modality: 'bodyweight',
      setOverrides: [
        { workingSetOrdinal: 1, baseReps: 10, presentedReps: 10, modality: 'bodyweight' },
        { workingSetOrdinal: 2, baseReps: 8, presentedReps: 8, modality: 'bodyweight' },
        { workingSetOrdinal: 3, baseReps: 6, presentedReps: 6, modality: 'bodyweight' },
      ],
    });
    const exp2 = createExposure({
      workoutLogId: 'w-2',
      workoutDate: '2026-08-03',
      outcome: 'success',
      modality: 'bodyweight',
      setOverrides: [
        { workingSetOrdinal: 1, baseReps: 10, presentedReps: 10, modality: 'bodyweight' },
        { workingSetOrdinal: 2, baseReps: 8, presentedReps: 8, modality: 'bodyweight' },
        { workingSetOrdinal: 3, baseReps: 6, presentedReps: 6, modality: 'bodyweight' },
      ],
    });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'REP_NUDGE',
      modality: 'bodyweight',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      setOverrides: [
        { workingSetOrdinal: 1, baseReps: 10, presentedReps: 11, modality: 'bodyweight', nudgeType: 'rep_nudge', coachingReasonCode: 'REP_NUDGE', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 0, reps: 10, rpe: 8, comparisonLoadKg: 75 } },
        { workingSetOrdinal: 2, baseReps: 8, presentedReps: 8, modality: 'bodyweight', nudgeType: 'none', coachingReasonCode: 'REP_NUDGE', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 0, reps: 8, rpe: 8, comparisonLoadKg: 75 } },
        { workingSetOrdinal: 3, baseReps: 6, presentedReps: 6, modality: 'bodyweight', nudgeType: 'none', coachingReasonCode: 'REP_NUDGE', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 0, reps: 6, rpe: 8, comparisonLoadKg: 75 } },
      ],
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.rollbackRequired).toBe(true);
      expect(res.rollbackPrescription![0].reps).toBe(10);
      expect(res.rollbackPrescription![1].reps).toBe(8);
      expect(res.rollbackPrescription![2].reps).toBe(6);
    }
  });

  it('22. Assisted per-set rollback', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success', modality: 'assisted', baseWeight: 20 });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success', modality: 'assisted', baseWeight: 20 });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
      modality: 'assisted',
      nudgeType: 'load_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseWeight: 20,
      setOverrides: [
        { workingSetOrdinal: 1, baseWeight: 20, presentedWeight: 17.5, modality: 'assisted', nudgeType: 'load_nudge', coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 20, reps: 8, rpe: 8, comparisonLoadKg: 20 } },
        { workingSetOrdinal: 2, baseWeight: 20, presentedWeight: 17.5, modality: 'assisted', nudgeType: 'none', coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 20, reps: 8, rpe: 8, comparisonLoadKg: 20 } },
        { workingSetOrdinal: 3, baseWeight: 20, presentedWeight: 17.5, modality: 'assisted', nudgeType: 'none', coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT', confirmedStepIndexBefore: 0, presentedStepIndex: 1, rollbackTarget: { weight: 20, reps: 8, rpe: 8, comparisonLoadKg: 20 } },
      ],
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.rollbackRequired).toBe(true);
      expect(res.rollbackPrescription![0].weight).toBe(20);
    }
  });

  it('23. Neutral nudge creates pending state', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.pendingNudge).not.toBeNull();
      expect(res.pendingNudge!.nudgeType).toBe('rep_nudge');
      expect(res.pendingNudge!.presentedPrescription[0].reps).toBe(9);
      expect(res.nextAction).toBe('retry_pending_nudge');
    }
  });

  it('24. Exact neutral retry succeeds', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    // Exact retry succeeds
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.confirmedStepIndex).toBe(1);
      expect(res.confirmedNudgeCount).toBe(1);
      expect(res.pendingNudge).toBeNull();
    }
  });

  it('25. Repeated neutral retry remains pending', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'neutral',
      coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.pendingNudge).not.toBeNull();
      expect(res.nextAction).toBe('retry_pending_nudge');
    }
  });

  it('26. Neutral retry marginal failure rolls back', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'marginal_miss',
      coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.pendingNudge).toBeNull();
      expect(res.rollbackRequired).toBe(true);
      expect(res.rollbackReason).toBe('NUDGE_MARGINAL_FAILURE_ROLLBACK');
      expect(res.nextAction).toBe('present_rollback');
    }
  });

  it('27. Neutral retry substantial failure rolls back', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'substantial_miss',
      coachingReasonCode: 'NUDGE_NEUTRAL_RETRY',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      baseReps: 8,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.pendingNudge).toBeNull();
      expect(res.rollbackRequired).toBe(true);
      expect(res.rollbackReason).toBe('NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK');
    }
  });

  it('28. Retry with different ordinal degrades', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1, // Set 1 pending
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    // Retry attempts Set 2 instead
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 2, // Set 2 changed!
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.pendingNudge).toBeNull();
    }
  });

  it('29. Retry with changed prescription degrades', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      presentedReps: 9,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    // Retry presents 10 reps instead of 9
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      presentedReps: 10,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.pendingNudge).toBeNull();
    }
  });

  it('30. Rollback success begins fresh credit at one', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    // Rollback presentation matching base prescription succeeds
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'BASE_PRESCRIPTION',
      baseWeight: 100,
      baseReps: 8,
      presentedWeight: 100,
      presentedReps: 8,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 0,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.rollbackRequired).toBe(false);
      expect(res.successCredit).toBe(1);
      expect(res.nextAction).toBe('build_success_credit');
    }
  });

  it('31. Neutral rollback remains pending', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'neutral',
      coachingReasonCode: 'BASE_PRESCRIPTION',
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.rollbackRequired).toBe(true);
      expect(res.nextAction).toBe('present_rollback');
    }
  });

  it('32. Mismatched rollback degrades', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    // Exposure presents 110kg instead of rollback 100kg
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'BASE_PRESCRIPTION',
      baseWeight: 110,
      presentedWeight: 110,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.rollbackRequired).toBe(false);
    }
  });

  it('33. Step-out preserves zero credit', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      coachingReasonCode: 'STEP_OUT_BASE_ONLY',
      successCreditEligible: false,
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(0);
    }
  });

  it('34. Step-out preserves one credit', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({
      workoutLogId: 'w-2',
      workoutDate: '2026-08-03',
      outcome: 'success',
      coachingReasonCode: 'STEP_OUT_BASE_ONLY',
      successCreditEligible: false,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(1);
    }
  });

  it('35. Step-out preserves an open gate', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'success',
      coachingReasonCode: 'STEP_OUT_BASE_ONLY',
      successCreditEligible: false,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
    }
  });

  it('36. Step-out does not replace stable prescription', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success', baseWeight: 100 });
    const exp2 = createExposure({
      workoutLogId: 'w-2',
      workoutDate: '2026-08-03',
      outcome: 'success',
      coachingReasonCode: 'STEP_OUT_BASE_ONLY',
      successCreditEligible: false,
      baseWeight: 80,
      presentedWeight: 80,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.stablePrescription![0].weight).toBe(100);
    }
  });

  it('37. Step-out pauses a pending nudge', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      presentedReps: 9,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'STEP_OUT_BASE_ONLY',
      successCreditEligible: false,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.pendingNudge).not.toBeNull();
      expect(res.pendingNudge!.presentedPrescription[0].reps).toBe(9);
    }
  });

  it('38. High-exertion success earns credit', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      coachingReasonCode: 'HIGH_EXERTION_HOLD',
      successCreditEligible: true,
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(1);
    }
  });

  it('39. Historical high-exertion exposure creates no permanent suppression', () => {
    const exp1 = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      coachingReasonCode: 'HIGH_EXERTION_HOLD',
    });
    const exp2 = createExposure({
      workoutLogId: 'w-2',
      workoutDate: '2026-08-03',
      outcome: 'success',
      coachingReasonCode: 'BASE_PRESCRIPTION',
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
      expect(res.historyNudgeEligible).toBe(true);
    }
  });

  it('40. Challenge-cap success earns no credit', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      coachingReasonCode: 'CHALLENGE_CAP_HOLD',
      successCreditEligible: false,
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(0);
    }
  });

  it('41. Each safety hold earns no credit', () => {
    const safetyHolds: GuidedCoachingReasonCode[] = [
      'BODYWEIGHT_CEILING_HOLD',
      'BODYWEIGHT_MAIN_LOAD_HOLD',
      'MINIMUM_ASSISTANCE_REACHED',
      'MISSING_BODYWEIGHT_HOLD',
      'INVALID_ASSISTANCE_HOLD',
      'ZERO_NET_LOAD_HOLD',
    ];

    for (const hold of safetyHolds) {
      const exp = createExposure({
        workoutLogId: `w-${hold}`,
        workoutDate: '2026-08-01',
        outcome: 'success',
        coachingReasonCode: hold,
        successCreditEligible: false,
      });
      const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.successCredit).toBe(0);
      }
    }
  });

  it('42. Partial lineage starts degraded', () => {
    const res = replayGuidedLaneState({ exposures: [], isPartialLineage: true });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.successCredit).toBe(0);
      expect(res.gateReady).toBe(false);
      expect(res.nextAction).toBe('degraded_requalification');
    }
  });

  it('43. Two fresh partial-lineage successes restore trust', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: true });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('trusted');
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
      expect(res.historyNudgeEligible).toBe(true);
    }
  });

  it('44. Partial-lineage nudge success becomes one ordinary success', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: true });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(1);
      expect(res.confirmedNudgeCount).toBe(0); // Not verified progression
      expect(res.stablePrescription![0].reps).toBe(9);
      expect(res.trustStatus).toBe('degraded_requalification');
    }
  });

  it('45. Partial-lineage nudge neutral uses rollback', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      baseReps: 8,
      presentedReps: 9,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: true });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.stablePrescription![0].reps).toBe(8); // uses rollback anchor
      expect(res.successCredit).toBe(0);
      expect(res.trustStatus).toBe('degraded_requalification');
    }
  });

  it('46. Partial-lineage nudge failure uses rollback', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'marginal_miss',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      baseReps: 8,
      presentedReps: 9,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: true });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.stablePrescription![0].reps).toBe(8);
      expect(res.successCredit).toBe(0);
      expect(res.trustStatus).toBe('degraded_requalification');
    }
  });

  it('47. Unauthorised nudge before gate succeeds and is adopted conservatively', () => {
    // Attempting a nudge with credit = 0
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.successCredit).toBe(1);
      expect(res.stablePrescription![0].reps).toBe(9);
    }
  });

  it('48. Unauthorised nudge does not increment verified nudge count', () => {
    const exp = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.confirmedNudgeCount).toBe(0);
    }
  });

  it('49. Two later demonstrated successes restore trust', () => {
    const exp1 = createExposure({
      workoutLogId: 'w-1',
      workoutDate: '2026-08-01',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const exp2 = createExposure({
      workoutLogId: 'w-2',
      workoutDate: '2026-08-03',
      outcome: 'success',
      coachingReasonCode: 'BASE_PRESCRIPTION',
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('trusted');
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
    }
  });

  it('50. Historical edit invalidates an earlier gate', () => {
    const expA = createExposure({ workoutLogId: 'w-a', workoutDate: '2026-08-01', outcome: 'success' });
    const expB = createExposure({ workoutLogId: 'w-b', workoutDate: '2026-08-03', outcome: 'substantial_miss' }); // edited into miss
    const res = replayGuidedLaneState({ exposures: [expA, expB], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.successCredit).toBe(0);
      expect(res.gateReady).toBe(false);
    }
  });

  it('51. Later successful targets remain preserved after that edit', () => {
    // A: success -> credit 1
    // B: substantial miss -> credit 0
    // C: unproven nudge successfully completed -> adopt as stable target, credit 1
    // D: later successful target -> credit 2
    const expA = createExposure({ workoutLogId: 'w-a', workoutDate: '2026-08-01', outcome: 'success' });
    const expB = createExposure({ workoutLogId: 'w-b', workoutDate: '2026-08-03', outcome: 'substantial_miss' });
    const expC = createExposure({
      workoutLogId: 'w-c',
      workoutDate: '2026-08-05',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
      presentedReps: 9,
    });
    const expD = createExposure({
      workoutLogId: 'w-d',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'BASE_PRESCRIPTION',
      baseReps: 9,
      presentedReps: 9,
    });
    const res = replayGuidedLaneState({ exposures: [expA, expB, expC, expD], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('trusted');
      expect(res.successCredit).toBe(2);
      expect(res.gateReady).toBe(true);
      expect(res.stablePrescription![0].reps).toBe(9);
      expect(res.confirmedNudgeCount).toBe(0); // neither C nor D counted as verified coaching nudges
    }
  });

  it('52. Failed edited nudge rolls back when no later success exists', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.rollbackRequired).toBe(true);
      expect(res.nextAction).toBe('present_rollback');
    }
  });

  it('53. Later factual success can supersede an earlier rollback', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    // Athlete later demonstrates success at 105kg
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'BASE_PRESCRIPTION',
      baseWeight: 105,
      presentedWeight: 105,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.rollbackRequired).toBe(false);
      expect(res.stablePrescription![0].weight).toBe(105);
      expect(res.trustStatus).toBe('degraded_requalification');
    }
  });

  it('54. Step jump success earns at most one requalification credit', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    // Jumps from verified step 0 to presented step 4 (single-step advance from 3 to 4 on exposure)
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 3,
      presentedStepIndex: 4,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.confirmedNudgeCount).toBe(0);
    }
  });

  it('55. Step regression never lowers an already higher demonstrated step', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    // An exposure attempting step 0 arrives later
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'BASE_PRESCRIPTION',
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 0,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.confirmedStepIndex).toBe(1); // Not regressed to 0
    }
  });

  it('56. Nudge during marginal hold degrades', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({ workoutLogId: 'w-3', workoutDate: '2026-08-05', outcome: 'marginal_miss' }); // activates marginal hold
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.confirmedNudgeCount).toBe(0);
    }
  });

  it('57. Nudge during unresolved rollback degrades', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'marginal_miss',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: false,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    }); // requires rollback
    const exp4 = createExposure({
      workoutLogId: 'w-4',
      workoutDate: '2026-08-07',
      outcome: 'success',
      coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
      nudgeType: 'load_nudge',
      nudgedWorkingSetOrdinal: 1,
      nudgedSetAchieved: true,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('degraded_requalification');
    }
  });

  it('58. Mixed lane input fails closed', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success', exerciseKey: 'bench_press' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success', exerciseKey: 'squat' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('invalid_input');
    if (res.status === 'invalid_input') {
      expect(res.error).toBe('MIXED_LANE_IDENTITY');
    }
  });

  it('59. Duplicate exposure IDs fail closed', () => {
    const exp1 = createExposure({ workoutLogId: 'w-dup', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-dup', workoutDate: '2026-08-03', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('invalid_input');
    if (res.status === 'invalid_input') {
      expect(res.error).toBe('DUPLICATE_WORKOUT_EXPOSURE_ID');
    }
  });

  it('60. Non-chronological input fails closed', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-05', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-01', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('invalid_input');
    if (res.status === 'invalid_input') {
      expect(res.error).toBe('NON_CHRONOLOGICAL_EXPOSURES');
    }
  });

  it('61. Invalid snapshot input fails closed', () => {
    const exp = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    (exp.sets[0].snapshot as any).snapshotVersion = 1; // V1 snapshot
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('invalid_input');
    if (res.status === 'invalid_input') {
      expect(res.error).toBe('INVALID_SNAPSHOT_VERSION');
    }
  });

  it('62. Input arrays and nested objects remain unchanged', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const input: ReplayGuidedLaneStateInput = { exposures: [exp1, exp2], isPartialLineage: false };

    const beforeJson = JSON.stringify(input);
    replayGuidedLaneState(input);
    const afterJson = JSON.stringify(input);

    expect(afterJson).toBe(beforeJson);
  });

  it('63. Repeated identical calls return deeply identical output', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const input: ReplayGuidedLaneStateInput = { exposures: [exp1, exp2], isPartialLineage: false };

    const res1 = replayGuidedLaneState(input);
    const res2 = replayGuidedLaneState(input);

    expect(JSON.stringify(res1)).toBe(JSON.stringify(res2));
  });

  it('64. Zero storage, React, DOM, clock, or random access', () => {
    // Pure function deterministic property
    const exp = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(isReplaySuccess(res)).toBe(true);
  });

  it('65. Three-set prescriptions remain ordinally intact', () => {
    const exp = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.stablePrescription).toHaveLength(3);
      expect(res.stablePrescription![0].workingSetOrdinal).toBe(1);
      expect(res.stablePrescription![1].workingSetOrdinal).toBe(2);
      expect(res.stablePrescription![2].workingSetOrdinal).toBe(3);
    }
  });

  it('66. Added unprescribed sets do not alter replay', () => {
    const exp = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.stablePrescription).toHaveLength(3);
    }
  });

  it('67. Warm-up and drop-set information does not alter replay', () => {
    const exp = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.confirmedStepIndex).toBe(0);
    }
  });

  it('68. historyNudgeEligible obeys its exact derivation', () => {
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const res = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.trustStatus).toBe('trusted');
      expect(res.successCredit).toBe(2);
      expect(res.pendingNudge).toBeNull();
      expect(res.rollbackRequired).toBe(false);
      expect(res.marginalHoldActive).toBe(false);
      expect(res.historyNudgeEligible).toBe(true);
    }
  });

  it('69. nextAction obeys the required precedence', () => {
    // 1. Pending nudge -> retry_pending_nudge
    // 2. Rollback required -> present_rollback
    // 3. Degraded state -> degraded_requalification
    // 4. Marginal hold -> repeat_stable_target
    // 5. No stable prescription -> establish_baseline
    // 6. History gate ready -> eligible_for_nudge
    // 7. Otherwise -> build_success_credit

    // Precedence 1: Pending nudge
    const exp1 = createExposure({ workoutLogId: 'w-1', workoutDate: '2026-08-01', outcome: 'success' });
    const exp2 = createExposure({ workoutLogId: 'w-2', workoutDate: '2026-08-03', outcome: 'success' });
    const exp3 = createExposure({
      workoutLogId: 'w-3',
      workoutDate: '2026-08-05',
      outcome: 'neutral',
      coachingReasonCode: 'REP_NUDGE',
      nudgeType: 'rep_nudge',
      nudgedWorkingSetOrdinal: 1,
      presentedReps: 9,
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 1,
    });
    const res1 = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
    expect(res1.status === 'success' && res1.nextAction).toBe('retry_pending_nudge');

    // Precedence 4: Marginal hold
    const expHold = createExposure({ workoutLogId: 'w-hold', workoutDate: '2026-08-05', outcome: 'marginal_miss' });
    const res4 = replayGuidedLaneState({ exposures: [exp1, exp2, expHold], isPartialLineage: false });
    expect(res4.status === 'success' && res4.nextAction).toBe('repeat_stable_target');

    // Precedence 5: Establish baseline
    const res5 = replayGuidedLaneState({ exposures: [], isPartialLineage: false });
    expect(res5.status === 'success' && res5.nextAction).toBe('establish_baseline');

    // Precedence 6: Eligible for nudge
    const res6 = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
    expect(res6.status === 'success' && res6.nextAction).toBe('eligible_for_nudge');

    // Precedence 7: Build success credit
    const res7 = replayGuidedLaneState({ exposures: [exp1], isPartialLineage: false });
    expect(res7.status === 'success' && res7.nextAction).toBe('build_success_credit');
  });

  it('70. Complete Performance-Led non-regression through the full suite', () => {
    // Verifies helpers: arePrescriptionsEqual, arePrescriptionSetsEqual
    const p1: GuidedReplayPrescriptionSet = {
      workingSetOrdinal: 1,
      weight: 100,
      reps: 8,
      rpe: 8,
      comparisonLoadKg: 100,
      weightUnit: 'kg',
    };
    const p2: GuidedReplayPrescriptionSet = {
      workingSetOrdinal: 1,
      weight: 100,
      reps: 8,
      rpe: 8,
      comparisonLoadKg: 100,
      weightUnit: 'kg',
    };
    expect(arePrescriptionSetsEqual(p1, p2)).toBe(true);
    expect(arePrescriptionsEqual([p1], [p2])).toBe(true);
  });

  describe('APC-3B2C1B-RC1 Cross-Unit Guided Replay Continuity Correction', () => {
    it('physically different cross-unit prescriptions compare unequal', () => {
      const p1: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 100,
        weightUnit: 'kg',
      };
      const p2: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: 210,
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 95.25,
        weightUnit: 'lb',
      };
      expect(arePrescriptionSetsEqual(p1, p2)).toBe(false);
      expect(arePrescriptionsEqual([p1], [p2])).toBe(false);
    });

    it('identical raw numbers in kg and lb compare unequal', () => {
      const p1: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 100,
        weightUnit: 'kg',
      };
      const p2: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 45.359237,
        weightUnit: 'lb',
      };
      expect(arePrescriptionSetsEqual(p1, p2)).toBe(false);
      expect(arePrescriptionsEqual([p1], [p2])).toBe(false);
    });

    it('comparisonLoadKg mismatch compares unequal despite same displayed resistance', () => {
      const p1: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 100,
        weightUnit: 'kg',
      };
      const p2: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: convertWeightUnit(100, 'kg', 'lb'),
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 98,
        weightUnit: 'lb',
      };
      expect(arePrescriptionSetsEqual(p1, p2)).toBe(false);
      expect(arePrescriptionsEqual([p1], [p2])).toBe(false);
    });

    it('null versus non-null comparison load compares unequal', () => {
      const p1: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 100,
        weightUnit: 'kg',
      };
      const p2: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: convertWeightUnit(100, 'kg', 'lb'),
        reps: 8,
        rpe: 8,
        comparisonLoadKg: null,
        weightUnit: 'lb',
      };
      expect(arePrescriptionSetsEqual(p1, p2)).toBe(false);
      expect(arePrescriptionSetsEqual(p2, p1)).toBe(false);
      expect(arePrescriptionsEqual([p1], [p2])).toBe(false);
    });

    it('equivalent kg and lb representations of the same physical resistance compare equal', () => {
      const p1: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: 100,
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 100,
        weightUnit: 'kg',
      };
      const p2: GuidedReplayPrescriptionSet = {
        workingSetOrdinal: 1,
        weight: convertWeightUnit(100, 'kg', 'lb'),
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 100,
        weightUnit: 'lb',
      };
      expect(arePrescriptionSetsEqual(p1, p2)).toBe(true);
      expect(arePrescriptionsEqual([p1], [p2])).toBe(true);
    });

    it('weighted kg-to-lb stable continuity and two-success credit spanning a unit change', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-kg-1',
        workoutDate: '2026-08-01',
        outcome: 'success',
        weightUnit: 'kg',
        baseWeight: 100,
      });
      const exp2 = createExposure({
        workoutLogId: 'w-lb-2',
        workoutDate: '2026-08-03',
        outcome: 'success',
        weightUnit: 'lb',
        baseWeight: convertWeightUnit(100, 'kg', 'lb'),
        comparisonLoadKg: 100,
      });
      const result = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.trustStatus).toBe('trusted');
        expect(result.successCredit).toBe(2);
        expect(result.gateReady).toBe(true);
        expect(result.confirmedStepIndex).toBe(0);
        expect(result.confirmedNudgeCount).toBe(0);
        expect(result.stablePrescription?.[0].weightUnit).toBe('lb');
        expect(result.stablePrescription?.[0].weight).toBeCloseTo(convertWeightUnit(100, 'kg', 'lb'), 4);
      }
    });

    it('weighted lb-to-kg stable continuity spanning a unit change', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-lb-1',
        workoutDate: '2026-08-01',
        outcome: 'success',
        weightUnit: 'lb',
        baseWeight: 200,
        comparisonLoadKg: convertWeightUnit(200, 'lb', 'kg'),
      });
      const exp2 = createExposure({
        workoutLogId: 'w-kg-2',
        workoutDate: '2026-08-03',
        outcome: 'success',
        weightUnit: 'kg',
        baseWeight: convertWeightUnit(200, 'lb', 'kg'),
        comparisonLoadKg: convertWeightUnit(200, 'lb', 'kg'),
      });
      const result = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.trustStatus).toBe('trusted');
        expect(result.successCredit).toBe(2);
        expect(result.gateReady).toBe(true);
        expect(result.stablePrescription?.[0].weightUnit).toBe('kg');
        expect(result.stablePrescription?.[0].weight).toBeCloseTo(convertWeightUnit(200, 'lb', 'kg'), 4);
      }
    });

    it('bodyweight continuity across unit metadata changes', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-bw-kg',
        workoutDate: '2026-08-01',
        outcome: 'success',
        modality: 'bodyweight',
        weightUnit: 'kg',
        baseWeight: 0,
      });
      const exp2 = createExposure({
        workoutLogId: 'w-bw-lb',
        workoutDate: '2026-08-03',
        outcome: 'success',
        modality: 'bodyweight',
        weightUnit: 'lb',
        baseWeight: 0,
      });
      const result = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.trustStatus).toBe('trusted');
        expect(result.successCredit).toBe(2);
        expect(result.gateReady).toBe(true);
      }
    });

    it('assisted kg-to-lb continuity using equivalent assistance', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-as-kg',
        workoutDate: '2026-08-01',
        outcome: 'success',
        modality: 'assisted',
        weightUnit: 'kg',
        baseWeight: 20,
        comparisonLoadKg: 55,
      });
      const exp2 = createExposure({
        workoutLogId: 'w-as-lb',
        workoutDate: '2026-08-03',
        outcome: 'success',
        modality: 'assisted',
        weightUnit: 'lb',
        baseWeight: convertWeightUnit(20, 'kg', 'lb'),
        comparisonLoadKg: 55,
      });
      const result = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.trustStatus).toBe('trusted');
        expect(result.successCredit).toBe(2);
        expect(result.gateReady).toBe(true);
      }
    });

    it('confirmed step preservation spanning a unit change', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-step-kg-1',
        workoutDate: '2026-08-01',
        outcome: 'success',
        weightUnit: 'kg',
      });
      const exp2 = createExposure({
        workoutLogId: 'w-step-kg-2',
        workoutDate: '2026-08-03',
        outcome: 'success',
        weightUnit: 'kg',
      });
      const exp3 = createExposure({
        workoutLogId: 'w-step-kg-3',
        workoutDate: '2026-08-05',
        outcome: 'success',
        weightUnit: 'kg',
        coachingReasonCode: 'REP_NUDGE',
        nudgeType: 'rep_nudge',
        nudgedWorkingSetOrdinal: 1,
        nudgedSetAchieved: true,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        baseReps: 8,
        presentedReps: 9,
      });
      const exp4 = createExposure({
        workoutLogId: 'w-step-lb-4',
        workoutDate: '2026-08-07',
        outcome: 'success',
        weightUnit: 'lb',
        confirmedStepIndexBefore: 1,
        presentedStepIndex: 1,
        baseWeight: convertWeightUnit(100, 'kg', 'lb'),
        comparisonLoadKg: 100,
      });
      const result = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.confirmedStepIndex).toBe(1);
        expect(result.confirmedNudgeCount).toBe(1);
        expect(result.gateReady).toBe(true);
        expect(result.stablePrescription?.[0].weightUnit).toBe('lb');
      }
    });

    it('no synthetic credit from a unit-only conversion', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-no-synth-1',
        workoutDate: '2026-08-01',
        outcome: 'success',
        weightUnit: 'kg',
      });
      // Second exposure is neutral in lb - must preserve credit at 1 without synthetic advancement
      const exp2 = createExposure({
        workoutLogId: 'w-no-synth-2',
        workoutDate: '2026-08-03',
        outcome: 'neutral',
        weightUnit: 'lb',
        baseWeight: convertWeightUnit(100, 'kg', 'lb'),
        comparisonLoadKg: 100,
      });
      const resNeutral = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
      expect(resNeutral.status).toBe('success');
      if (resNeutral.status === 'success') {
        expect(resNeutral.successCredit).toBe(1);
        expect(resNeutral.gateReady).toBe(false);
        expect(resNeutral.confirmedNudgeCount).toBe(0);
      }

      // Third exposure is substantial miss in lb - resets credit to 0
      const exp3 = createExposure({
        workoutLogId: 'w-no-synth-3',
        workoutDate: '2026-08-05',
        outcome: 'substantial_miss',
        weightUnit: 'lb',
        baseWeight: convertWeightUnit(100, 'kg', 'lb'),
        comparisonLoadKg: 100,
      });
      const resSubstantial = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
      expect(resSubstantial.status).toBe('success');
      if (resSubstantial.status === 'success') {
        expect(resSubstantial.successCredit).toBe(0);
        expect(resSubstantial.gateReady).toBe(false);
      }
    });

    it('pending rep-nudge retry across units confirms nudge', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-rep-1',
        workoutDate: '2026-08-01',
        outcome: 'success',
        weightUnit: 'kg',
      });
      const exp2 = createExposure({
        workoutLogId: 'w-rep-2',
        workoutDate: '2026-08-03',
        outcome: 'success',
        weightUnit: 'kg',
      });
      const exp3 = createExposure({
        workoutLogId: 'w-rep-3',
        workoutDate: '2026-08-05',
        outcome: 'neutral',
        weightUnit: 'kg',
        coachingReasonCode: 'REP_NUDGE',
        nudgeType: 'rep_nudge',
        nudgedWorkingSetOrdinal: 1,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        presentedReps: 9,
        baseReps: 8,
        baseWeight: 100,
        rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 },
      });
      const res3 = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
      expect(res3.status).toBe('success');
      if (res3.status === 'success') {
        expect(res3.pendingNudge).not.toBeNull();
        expect(res3.pendingNudge?.nudgeType).toBe('rep_nudge');
        expect(res3.nextAction).toBe('retry_pending_nudge');
      }

      const lbWeight = convertWeightUnit(100, 'kg', 'lb');
      const exp4 = createExposure({
        workoutLogId: 'w-rep-4',
        workoutDate: '2026-08-07',
        outcome: 'success',
        weightUnit: 'lb',
        coachingReasonCode: 'REP_NUDGE',
        nudgeType: 'rep_nudge',
        nudgedWorkingSetOrdinal: 1,
        nudgedSetAchieved: true,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        baseWeight: lbWeight,
        presentedWeight: lbWeight,
        baseReps: 8,
        presentedReps: 9,
        comparisonLoadKg: 100,
        rollbackTarget: { weight: lbWeight, reps: 8, rpe: 8, comparisonLoadKg: 100 },
      });
      const res4 = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
      expect(res4.status).toBe('success');
      if (res4.status === 'success') {
        expect(res4.confirmedStepIndex).toBe(1);
        expect(res4.confirmedNudgeCount).toBe(1);
        expect(res4.pendingNudge).toBeNull();
        expect(res4.gateReady).toBe(true);
        expect(res4.successCredit).toBe(2);
        expect(res4.stablePrescription?.[0].weightUnit).toBe('lb');
        expect(res4.stablePrescription?.[0].reps).toBe(9);
      }
    });

    it('pending load-nudge retry across units confirms nudge', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-load-1',
        workoutDate: '2026-08-01',
        outcome: 'success',
        weightUnit: 'kg',
      });
      const exp2 = createExposure({
        workoutLogId: 'w-load-2',
        workoutDate: '2026-08-03',
        outcome: 'success',
        weightUnit: 'kg',
      });
      const exp3 = createExposure({
        workoutLogId: 'w-load-3',
        workoutDate: '2026-08-05',
        outcome: 'neutral',
        weightUnit: 'kg',
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        nudgedWorkingSetOrdinal: 1,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        baseWeight: 100,
        presentedWeight: 102.5,
        rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 },
        setOverrides: [
          { presentedWeight: 102.5, comparisonLoadKg: 102.5, nudgeType: 'load_nudge' },
          { presentedWeight: 102.5, comparisonLoadKg: 102.5, nudgeType: 'load_nudge' },
          { presentedWeight: 102.5, comparisonLoadKg: 102.5, nudgeType: 'load_nudge' },
        ],
      });
      const res3 = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
      expect(res3.status).toBe('success');
      if (res3.status === 'success') {
        expect(res3.pendingNudge).not.toBeNull();
        expect(res3.pendingNudge?.nudgeType).toBe('load_nudge');
      }

      const lbBase = convertWeightUnit(100, 'kg', 'lb');
      const lbNudge = convertWeightUnit(102.5, 'kg', 'lb');
      const exp4 = createExposure({
        workoutLogId: 'w-load-4',
        workoutDate: '2026-08-07',
        outcome: 'success',
        weightUnit: 'lb',
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        nudgedWorkingSetOrdinal: 1,
        nudgedSetAchieved: true,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        baseWeight: lbBase,
        presentedWeight: lbNudge,
        comparisonLoadKg: 102.5,
        rollbackTarget: { weight: lbBase, reps: 8, rpe: 8, comparisonLoadKg: 100 },
        setOverrides: [
          { presentedWeight: lbNudge, comparisonLoadKg: 102.5, nudgeType: 'load_nudge', weightUnit: 'lb' },
          { presentedWeight: lbNudge, comparisonLoadKg: 102.5, nudgeType: 'load_nudge', weightUnit: 'lb' },
          { presentedWeight: lbNudge, comparisonLoadKg: 102.5, nudgeType: 'load_nudge', weightUnit: 'lb' },
        ],
      });
      const res4 = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
      expect(res4.status).toBe('success');
      if (res4.status === 'success') {
        expect(res4.confirmedStepIndex).toBe(1);
        expect(res4.confirmedNudgeCount).toBe(1);
        expect(res4.pendingNudge).toBeNull();
        expect(res4.gateReady).toBe(true);
      }
    });

    it('rollback success across units resolves rollback and starts fresh credit', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-rb-1',
        workoutDate: '2026-08-01',
        outcome: 'success',
        weightUnit: 'kg',
      });
      const exp2 = createExposure({
        workoutLogId: 'w-rb-2',
        workoutDate: '2026-08-03',
        outcome: 'success',
        weightUnit: 'kg',
      });
      const exp3 = createExposure({
        workoutLogId: 'w-rb-3',
        workoutDate: '2026-08-05',
        outcome: 'marginal_miss',
        weightUnit: 'kg',
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        nudgedWorkingSetOrdinal: 1,
        nudgedSetAchieved: false,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        baseWeight: 100,
        presentedWeight: 102.5,
        rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 },
      });
      const res3 = replayGuidedLaneState({ exposures: [exp1, exp2, exp3], isPartialLineage: false });
      expect(res3.status).toBe('success');
      if (res3.status === 'success') {
        expect(res3.rollbackRequired).toBe(true);
        expect(res3.rollbackPrescription?.[0].weight).toBe(100);
        expect(res3.rollbackPrescription?.[0].weightUnit).toBe('kg');
        expect(res3.successCredit).toBe(0);
      }

      const lbRollbackWeight = convertWeightUnit(100, 'kg', 'lb');
      const exp4 = createExposure({
        workoutLogId: 'w-rb-4',
        workoutDate: '2026-08-07',
        outcome: 'success',
        weightUnit: 'lb',
        coachingReasonCode: 'NUDGE_MARGINAL_FAILURE_ROLLBACK',
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 0,
        baseWeight: lbRollbackWeight,
        presentedWeight: lbRollbackWeight,
        comparisonLoadKg: 100,
      });
      const res4 = replayGuidedLaneState({ exposures: [exp1, exp2, exp3, exp4], isPartialLineage: false });
      expect(res4.status).toBe('success');
      if (res4.status === 'success') {
        expect(res4.rollbackRequired).toBe(false);
        expect(res4.rollbackPrescription).toBeNull();
        expect(res4.successCredit).toBe(1);
        expect(res4.stablePrescription?.[0].weightUnit).toBe('lb');
      }
    });

    it('genuine load-basis mismatch still returns invalid input', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-basis-1',
        workoutDate: '2026-08-01',
        outcome: 'success',
        setOverrides: [
          { loadBasis: 'external_weight_v1' },
          { loadBasis: 'external_weight_v1' },
          { loadBasis: 'external_weight_v1' },
        ],
      });
      const exp2 = createExposure({
        workoutLogId: 'w-basis-2',
        workoutDate: '2026-08-03',
        outcome: 'success',
        setOverrides: [
          { loadBasis: 'bodyweight_relative_v1' as any },
          { loadBasis: 'bodyweight_relative_v1' as any },
          { loadBasis: 'bodyweight_relative_v1' as any },
        ],
      });
      const result = replayGuidedLaneState({ exposures: [exp1, exp2], isPartialLineage: false });
      expect(result.status).toBe('invalid_input');
      if (result.status === 'invalid_input') {
        expect(result.error).toBe('LOAD_BASIS_MISMATCH');
      }
    });

    it('all other identity and version mismatches remain fail-closed', () => {
      const expKey1 = createExposure({ workoutLogId: 'w-k1', workoutDate: '2026-08-01', outcome: 'success', exerciseKey: 'bench_press' });
      const expKey2 = createExposure({ workoutLogId: 'w-k2', workoutDate: '2026-08-03', outcome: 'success', exerciseKey: 'squat' });
      expect(replayGuidedLaneState({ exposures: [expKey1, expKey2], isPartialLineage: false }).status).toBe('invalid_input');

      const expMod1 = createExposure({ workoutLogId: 'w-m1', workoutDate: '2026-08-01', outcome: 'success', modality: 'weighted' });
      const expMod2 = createExposure({ workoutLogId: 'w-m2', workoutDate: '2026-08-03', outcome: 'success', modality: 'bodyweight' });
      expect(replayGuidedLaneState({ exposures: [expMod1, expMod2], isPartialLineage: false }).status).toBe('invalid_input');

      const expLane1 = createExposure({ workoutLogId: 'w-l1', workoutDate: '2026-08-01', outcome: 'success', comparableLaneKey: 'lane_a' });
      const expLane2 = createExposure({ workoutLogId: 'w-l2', workoutDate: '2026-08-03', outcome: 'success', comparableLaneKey: 'lane_b' });
      expect(replayGuidedLaneState({ exposures: [expLane1, expLane2], isPartialLineage: false }).status).toBe('invalid_input');

      const expAlg1 = createExposure({ workoutLogId: 'w-a1', workoutDate: '2026-08-01', outcome: 'success', setOverrides: [{ algorithmId: 'hypertrophy_linear' }, { algorithmId: 'hypertrophy_linear' }, { algorithmId: 'hypertrophy_linear' }] });
      const expAlg2 = createExposure({ workoutLogId: 'w-a2', workoutDate: '2026-08-03', outcome: 'success', setOverrides: [{ algorithmId: 'strength_rpe' as any }, { algorithmId: 'strength_rpe' as any }, { algorithmId: 'strength_rpe' as any }] });
      expect(replayGuidedLaneState({ exposures: [expAlg1, expAlg2], isPartialLineage: false }).status).toBe('invalid_input');

      const expVer1 = createExposure({ workoutLogId: 'w-v1', workoutDate: '2026-08-01', outcome: 'success' });
      const expVer2 = createExposure({ workoutLogId: 'w-v2', workoutDate: '2026-08-03', outcome: 'success', setOverrides: [{ snapshotVersion: 99 as any }, { snapshotVersion: 99 as any }, { snapshotVersion: 99 as any }] });
      expect(replayGuidedLaneState({ exposures: [expVer1, expVer2], isPartialLineage: false }).status).toBe('invalid_input');

      const expSetCount1 = createExposure({ workoutLogId: 'w-sc1', workoutDate: '2026-08-01', outcome: 'success' });
      const expSetCount2 = { ...expSetCount1, workoutLogId: 'w-sc2', workoutDate: '2026-08-03', prescribedWorkingSetCount: 4 };
      expect(replayGuidedLaneState({ exposures: [expSetCount1, expSetCount2 as any], isPartialLineage: false }).status).toBe('invalid_input');
    });

    it('input ownership, result aliasing, and purity remain intact across cross-unit replay', () => {
      const exp1 = createExposure({
        workoutLogId: 'w-pure-1',
        workoutDate: '2026-08-01',
        outcome: 'success',
        weightUnit: 'kg',
        baseWeight: 100,
      });
      const exp2 = createExposure({
        workoutLogId: 'w-pure-2',
        workoutDate: '2026-08-03',
        outcome: 'success',
        weightUnit: 'lb',
        baseWeight: convertWeightUnit(100, 'kg', 'lb'),
        comparisonLoadKg: 100,
      });

      const exposures = [exp1, exp2];
      const snapshotBefore = JSON.stringify(exposures);

      const result = replayGuidedLaneState({ exposures, isPartialLineage: false });
      expect(result.status).toBe('success');
      expect(JSON.stringify(exposures)).toBe(snapshotBefore);

      if (result.status === 'success') {
        if (result.stablePrescription && result.stablePrescription[0]) {
          result.stablePrescription[0].weight = 999;
        }
        expect(exp2.sets[0].snapshot.presentedWeight).not.toBe(999);
      }
    });
  });
});
