/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  replayGuidedLaneState,
  extractBasePrescription,
  extractRollbackPrescription,
  extractPresentedPrescription,
  arePrescriptionsEqual,
} from '../guidedLaneReplay';
import {
  ComparableGuidedExposure,
  ComparableGuidedSetDetail,
} from '../guidedHistoryCollector';
import {
  GuidedExerciseOutcomeResult,
} from '../guidedExerciseClassifier';
import {
  GuidedSetOutcomeResult,
} from '../guidedOutcomeClassifier';
import {
  PrescriptionSnapshot,
  GuidedCoachingReasonCode,
  ProgressionNudgeType,
  ExerciseModality,
  WeightUnit,
  SetEntry,
} from '../../types';

describe('guidedCurrentBaseRollback', () => {
  const createSnapshot = (
    overrides?: Partial<PrescriptionSnapshot>
  ): PrescriptionSnapshot => {
    const coachingReasonCode: GuidedCoachingReasonCode =
      overrides?.coachingReasonCode ?? 'BASE_PRESCRIPTION';

    let nudgeType: ProgressionNudgeType = 'none';
    if (coachingReasonCode === 'REP_NUDGE') {
      nudgeType = 'rep_nudge';
    } else if (coachingReasonCode === 'LOAD_NUDGE_MAIN_MOVEMENT') {
      nudgeType = 'load_nudge';
    }

    const modality: ExerciseModality = overrides?.modality ?? 'weighted';
    const baseWeight = overrides?.baseWeight ?? (modality === 'bodyweight' ? 0 : 100);
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

    const confirmedStepIndexBefore = overrides?.confirmedStepIndexBefore ?? 0;
    const isAdvance = nudgeType !== 'none';
    const presentedStepIndex = overrides?.presentedStepIndex ?? (isAdvance ? confirmedStepIndexBefore + 1 : confirmedStepIndexBefore);

    const rollbackTarget = isAdvance
      ? (overrides?.rollbackTarget ?? {
          weight: baseWeight,
          reps: baseReps,
          rpe: baseRpe,
          comparisonLoadKg: baseWeight,
        })
      : null;

    return {
      snapshotVersion: 2,
      progressionPolicyVersion: 1,
      algorithmVersion: 1,
      progressionMode: 'metreps_guided',
      algorithmId: 'hypertrophy_linear',
      exerciseKey: 'barbell_bench_press',
      exerciseRole: 'main_movement',
      modality,
      comparableLaneKey: 'barbell_bench_press_lane',
      workingSetOrdinal: 1,
      prescribedWorkingSetCount: 3,
      baseWeight,
      baseReps,
      baseRpe,
      presentedWeight,
      presentedReps,
      presentedRpe: baseRpe,
      comparisonLoadKg: overrides?.comparisonLoadKg ?? (modality === 'bodyweight' ? 75 : presentedWeight),
      weightUnit: 'kg',
      bodyweightSnapshot: overrides?.bodyweightSnapshot ?? (modality === 'bodyweight' ? 75 : null),
      loadBasis:
        modality === 'bodyweight'
          ? 'bodyweight_normalized_v1'
          : modality === 'assisted'
          ? 'assisted_net_normalized_v1'
          : 'external_weight_v1',
      loadIncrement: 2.5,
      coachingReasonCode,
      nudgeType,
      confirmedStepIndexBefore,
      presentedStepIndex,
      successCreditEligible: overrides?.successCreditEligible ?? true,
      rollbackTarget,
      ...overrides,
    };
  };

  const createExposure = (
    opts: {
      logId: string;
      date: string;
      outcome: 'success' | 'marginal_miss' | 'substantial_miss' | 'neutral';
      baseWeight: number;
      baseReps: number;
      baseRpe?: number;
      coachingReasonCode?: GuidedCoachingReasonCode;
      nudgeType?: ProgressionNudgeType;
      nudgedOrdinal?: number;
      presentedWeight?: number;
      presentedReps?: number;
      confirmedStepIndexBefore?: number;
      presentedStepIndex?: number;
      rollbackTarget?: { weight: number; reps: number; rpe: number; comparisonLoadKg: number } | null;
      modality?: ExerciseModality;
      weightUnit?: WeightUnit;
      achievedOverride?: boolean;
      setOverrides?: Array<Partial<PrescriptionSnapshot>>;
    }
  ): ComparableGuidedExposure => {
    const coachingReason = opts.coachingReasonCode ?? 'BASE_PRESCRIPTION';
    const isNudge = coachingReason === 'LOAD_NUDGE_MAIN_MOVEMENT' || coachingReason === 'REP_NUDGE';
    const nudgedOrdinal = opts.nudgedOrdinal ?? (isNudge ? 1 : null);
    const setAchieved = opts.achievedOverride ?? (opts.outcome === 'success');

    const sets: ComparableGuidedSetDetail[] = [1, 2, 3].map(ord => {
      const override = opts.setOverrides?.find(o => o.workingSetOrdinal === ord);
      const isThisNudge = isNudge && ord === nudgedOrdinal;
      const defaultRollback = isNudge
        ? (opts.rollbackTarget ?? {
            weight: opts.baseWeight,
            reps: opts.baseReps,
            rpe: opts.baseRpe ?? 8,
            comparisonLoadKg: opts.modality === 'bodyweight' ? 75 : opts.baseWeight,
          })
        : null;

      const snap = createSnapshot({
        workingSetOrdinal: ord,
        baseWeight: opts.baseWeight,
        baseReps: opts.baseReps,
        baseRpe: opts.baseRpe ?? 8,
        modality: opts.modality ?? 'weighted',
        weightUnit: opts.weightUnit ?? 'kg',
        coachingReasonCode: coachingReason,
        nudgeType: isThisNudge ? (opts.nudgeType ?? (coachingReason === 'REP_NUDGE' ? 'rep_nudge' : 'load_nudge')) : 'none',
        presentedWeight: isThisNudge ? (opts.presentedWeight ?? opts.baseWeight + 2.5) : opts.baseWeight,
        presentedReps: isThisNudge ? (opts.presentedReps ?? opts.baseReps + (coachingReason === 'REP_NUDGE' ? 1 : 0)) : opts.baseReps,
        confirmedStepIndexBefore: opts.confirmedStepIndexBefore ?? 0,
        presentedStepIndex: opts.presentedStepIndex ?? (isNudge ? (opts.confirmedStepIndexBefore ?? 0) + 1 : (opts.confirmedStepIndexBefore ?? 0)),
        rollbackTarget: defaultRollback,
        ...override,
      });

      const setResult: GuidedSetOutcomeResult = {
        outcome:
          opts.outcome === 'neutral'
            ? 'neutral'
            : opts.outcome === 'marginal_miss'
            ? 'marginal_miss'
            : opts.outcome === 'substantial_miss'
            ? 'substantial_miss'
            : 'success',
        reason: opts.outcome === 'neutral' ? 'SKIPPED_SET' : 'TARGET_ACHIEVED_EXACT',
        targetAchieved: setAchieved,
        extraCapacityCreditEligible: false,
        rpeSource: 'explicit',
        actualComparisonLoadKg: snap.comparisonLoadKg,
        presentedComparisonLoadKg: snap.comparisonLoadKg,
        presentedCapacityIndex: 1.0,
        actualCapacityIndex: 1.0,
        relativePerformance: 0,
      };

      const setEntry: SetEntry = {
        setNumber: ord,
        reps: snap.presentedReps,
        weight: snap.presentedWeight,
        rpe: snap.presentedRpe,
        isCompleted: opts.outcome !== 'neutral',
        isSkipped: opts.outcome === 'neutral',
        isWarmup: false,
        prescriptionSnapshot: snap,
      };

      return {
        workingSetOrdinal: ord,
        snapshot: snap,
        setEntry,
        setResult,
      };
    });

    const isNudged = isNudge && nudgedOrdinal !== null;
    const classification: GuidedExerciseOutcomeResult = {
      outcome: opts.outcome,
      reason:
        opts.outcome === 'success'
          ? 'ALL_PRESCRIBED_SETS_ACHIEVED'
          : opts.outcome === 'neutral'
          ? 'EXERCISE_SKIPPED'
          : opts.outcome === 'marginal_miss'
          ? 'SINGLE_MARGINAL_MISS'
          : 'PRESCRIBED_SET_SUBSTANTIAL_MISS',
      expectedPrescribedSetCount: 3,
      observedPrescribedSetCount: 3,
      attemptedPrescribedSetCount: opts.outcome === 'neutral' ? 0 : 3,
      successfulPrescribedSetCount: opts.outcome === 'success' ? 3 : 0,
      marginalMissCount: opts.outcome === 'marginal_miss' ? 1 : 0,
      substantialMissCount: opts.outcome === 'substantial_miss' ? 1 : 0,
      neutralSetCount: opts.outcome === 'neutral' ? 3 : 0,
      ineligibleSetCount: 0,
      missingWorkingSetOrdinals: [],
      ignoredUnprescribedSetCount: 0,
      nudgedSetPresent: isNudged,
      nudgedSetAchieved: isNudged ? setAchieved : null,
      nudgedSetOutcome: isNudged ? (setAchieved ? 'success' : 'marginal_miss') : null,
      nudgedWorkingSetOrdinal: nudgedOrdinal,
      setResults: sets.map(s => ({
        workingSetOrdinal: s.workingSetOrdinal,
        result: s.setResult,
      })),
    };

    return {
      workoutLogId: opts.logId,
      workoutDate: opts.date,
      workoutTimestampMs: Date.parse(`${opts.date}T10:00:00Z`),
      scheduledDate: opts.date,
      programId: 'prog-1',
      cycleIndex: 1,
      lineagePosition: 0,
      week: 1,
      day: 1,
      exerciseIndex: 0,
      exerciseKey: 'barbell_bench_press',
      exerciseRole: 'main_movement',
      modality: opts.modality ?? 'weighted',
      comparableLaneKey: 'barbell_bench_press_lane',
      prescribedWorkingSetCount: 3,
      weightUnit: opts.weightUnit ?? 'kg',
      sets,
      nudgedWorkingSetOrdinal: nudgedOrdinal,
      nudgedSetOutcome: isNudged ? (setAchieved ? 'success' : 'marginal_miss') : null,
      nudgedSetAchieved: isNudged ? setAchieved : null,
      classification,
    };
  };

  describe('extractBasePrescription helper', () => {
    it('extracts unmodified base prescription even from a nudged exposure', () => {
      const exp = createExposure({
        logId: 'w3',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 100,
        baseReps: 6,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        presentedWeight: 102.5,
        presentedReps: 6,
      });

      const basePrescription = extractBasePrescription(exp);
      const presentedPrescription = extractPresentedPrescription(exp);
      const rollbackPrescription = extractRollbackPrescription(exp);

      expect(basePrescription[0].weight).toBe(100);
      expect(basePrescription[0].reps).toBe(6);
      expect(presentedPrescription[0].weight).toBe(102.5);
      expect(presentedPrescription[0].reps).toBe(6);
      expect(rollbackPrescription[0].weight).toBe(100);
      expect(rollbackPrescription[0].reps).toBe(6);

      // Rollback matches base prescription
      expect(arePrescriptionsEqual(rollbackPrescription, basePrescription)).toBe(true);
    });
  });

  describe('Current-Base Rollback Equality Authorization', () => {
    it('authorizes a nudge when rollback target matches current week base prescription differing from prior stable', () => {
      // Session 1: 100 kg, 8 reps base -> Success (Credit 1)
      const exp1 = createExposure({
        logId: 's1',
        date: '2026-03-01',
        outcome: 'success',
        baseWeight: 100,
        baseReps: 8,
      });

      // Session 2: 105 kg, 8 reps base -> Success (Credit 2 -> gate open!)
      const exp2 = createExposure({
        logId: 's2',
        date: '2026-03-08',
        outcome: 'success',
        baseWeight: 105,
        baseReps: 8,
      });

      // Session 3: Periodisation moves to 110 kg, 6 reps!
      // Nudge presented: 112.5 kg, 6 reps.
      // Rollback target: 110 kg, 6 reps (current week base).
      // Note: rollback target (110 kg, 6 reps) != prior stable (105 kg, 8 reps),
      // but rollback target == current base prescription!
      const exp3 = createExposure({
        logId: 's3',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 110,
        baseReps: 6,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        presentedWeight: 112.5,
        presentedReps: 6,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 110,
          reps: 6,
          rpe: 8,
          comparisonLoadKg: 110,
        },
      });

      const replayResult = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
      });

      expect(replayResult.status).toBe('success');
      if (replayResult.status !== 'success') return;

      // The nudge was AUTHORIZED and confirmed!
      expect(replayResult.trustStatus).toBe('trusted');
      expect(replayResult.confirmedStepIndex).toBe(1);
      expect(replayResult.confirmedNudgeCount).toBe(1);
      expect(replayResult.successCredit).toBe(2);
      expect(replayResult.rollbackRequired).toBe(false);
      expect(replayResult.stablePrescription?.[0].weight).toBe(112.5);
      expect(replayResult.stablePrescription?.[0].reps).toBe(6);
    });

    it('sets rollback prescription to current week base upon nudge failure', () => {
      // Session 1: 100 kg, 8 reps -> Success (credit 1)
      const exp1 = createExposure({
        logId: 's1',
        date: '2026-03-01',
        outcome: 'success',
        baseWeight: 100,
        baseReps: 8,
      });

      // Session 2: 105 kg, 8 reps -> Success (credit 2)
      const exp2 = createExposure({
        logId: 's2',
        date: '2026-03-08',
        outcome: 'success',
        baseWeight: 105,
        baseReps: 8,
      });

      // Session 3: Week 3 base 110 kg, 6 reps. Nudge 112.5 kg fails (marginal_miss)
      const exp3 = createExposure({
        logId: 's3',
        date: '2026-03-15',
        outcome: 'marginal_miss',
        baseWeight: 110,
        baseReps: 6,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        presentedWeight: 112.5,
        presentedReps: 6,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 110,
          reps: 6,
          rpe: 8,
          comparisonLoadKg: 110,
        },
      });

      const replayResult = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
      });

      expect(replayResult.status).toBe('success');
      if (replayResult.status !== 'success') return;

      expect(replayResult.rollbackRequired).toBe(true);
      expect(replayResult.rollbackReason).toBe('NUDGE_MARGINAL_FAILURE_ROLLBACK');
      expect(replayResult.successCredit).toBe(0);
      expect(replayResult.confirmedStepIndex).toBe(0);

      // Rollback target is the current session's base (110 kg, 6 reps), NOT Week 2!
      expect(replayResult.rollbackPrescription?.[0].weight).toBe(110);
      expect(replayResult.rollbackPrescription?.[0].reps).toBe(6);
    });

    it('resolves rollback when the user returns to the current week base prescription', () => {
      // Session 1: Success
      const exp1 = createExposure({
        logId: 's1',
        date: '2026-03-01',
        outcome: 'success',
        baseWeight: 100,
        baseReps: 8,
      });

      // Session 2: Success
      const exp2 = createExposure({
        logId: 's2',
        date: '2026-03-08',
        outcome: 'success',
        baseWeight: 105,
        baseReps: 8,
      });

      // Session 3: Nudge fails -> Rollback required to (110 kg, 6 reps)
      const exp3 = createExposure({
        logId: 's3',
        date: '2026-03-15',
        outcome: 'marginal_miss',
        baseWeight: 110,
        baseReps: 6,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        presentedWeight: 112.5,
        presentedReps: 6,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 110,
          reps: 6,
          rpe: 8,
          comparisonLoadKg: 110,
        },
      });

      // Session 4: User presents rollback prescription (110 kg, 6 reps) and achieves it
      const exp4 = createExposure({
        logId: 's4',
        date: '2026-03-22',
        outcome: 'success',
        baseWeight: 110,
        baseReps: 6,
        coachingReasonCode: 'BASE_PRESCRIPTION',
        presentedWeight: 110,
        presentedReps: 6,
      });

      const replayResult = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3, exp4],
        isPartialLineage: false,
      });

      expect(replayResult.status).toBe('success');
      if (replayResult.status !== 'success') return;

      expect(replayResult.rollbackRequired).toBe(false);
      expect(replayResult.rollbackPrescription).toBeNull();
      expect(replayResult.successCredit).toBe(1); // Fresh credit earned
      expect(replayResult.stablePrescription?.[0].weight).toBe(110);
      expect(replayResult.stablePrescription?.[0].reps).toBe(6);
    });

    it('rejects as anomaly when rollback target matches neither stable nor current base', () => {
      // Session 1: Success
      const exp1 = createExposure({
        logId: 's1',
        date: '2026-03-01',
        outcome: 'success',
        baseWeight: 100,
        baseReps: 8,
      });

      // Session 2: Success
      const exp2 = createExposure({
        logId: 's2',
        date: '2026-03-08',
        outcome: 'success',
        baseWeight: 100,
        baseReps: 8,
      });

      // Session 3: Nudge presented with corrupted rollback target (neither 100kg nor base 105kg)
      const exp3 = createExposure({
        logId: 's3',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 105,
        baseReps: 8,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        presentedWeight: 107.5,
        presentedReps: 8,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 999, // Corrupted / invalid rollback target!
          reps: 8,
          rpe: 8,
          comparisonLoadKg: 999,
        },
      });

      const replayResult = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
      });

      expect(replayResult.status).toBe('success');
      if (replayResult.status !== 'success') return;

      // Nudge was NOT authorized due to rollback target mismatch
      expect(replayResult.trustStatus).toBe('degraded_requalification');
      expect(replayResult.confirmedStepIndex).toBe(0);
      expect(replayResult.confirmedNudgeCount).toBe(0);
    });
  });

  describe('Modality Parity: Bodyweight and Rep Nudges', () => {
    it('authorizes bodyweight rep nudge with current-base rollback equality', () => {
      // Session 1: 0 kg, 10 reps base -> Success
      const exp1 = createExposure({
        logId: 's1',
        date: '2026-03-01',
        outcome: 'success',
        baseWeight: 0,
        baseReps: 10,
        modality: 'bodyweight',
      });

      // Session 2: 0 kg, 10 reps base -> Success (credit 2)
      const exp2 = createExposure({
        logId: 's2',
        date: '2026-03-08',
        outcome: 'success',
        baseWeight: 0,
        baseReps: 10,
        modality: 'bodyweight',
      });

      // Session 3: Periodisation moves base to 0 kg, 8 reps.
      // Rep nudge presented: 0 kg, 9 reps.
      // Rollback target: 0 kg, 8 reps (current week base).
      const exp3 = createExposure({
        logId: 's3',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 0,
        baseReps: 8,
        modality: 'bodyweight',
        coachingReasonCode: 'REP_NUDGE',
        nudgeType: 'rep_nudge',
        presentedWeight: 0,
        presentedReps: 9,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 0,
          reps: 8,
          rpe: 8,
          comparisonLoadKg: 75,
        },
      });

      const replayResult = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
      });

      expect(replayResult.status).toBe('success');
      if (replayResult.status !== 'success') return;

      expect(replayResult.confirmedStepIndex).toBe(1);
      expect(replayResult.confirmedNudgeCount).toBe(1);
      expect(replayResult.stablePrescription?.[0].reps).toBe(9);
    });
  });

  describe('Current-Base Rollback Authority & Rejection Suite (RC2)', () => {
    // Standard qualifying base setup:
    // Session 1: 47.5 kg, 8 reps -> Success (credit 1, stable 47.5 kg)
    // Session 2: 47.5 kg, 8 reps -> Success (credit 2, gate open, trusted)
    const createQualifyingExposures = () => [
      createExposure({
        logId: 'qual-1',
        date: '2026-03-01',
        outcome: 'success',
        baseWeight: 47.5,
        baseReps: 8,
        baseRpe: 8,
      }),
      createExposure({
        logId: 'qual-2',
        date: '2026-03-08',
        outcome: 'success',
        baseWeight: 47.5,
        baseReps: 8,
        baseRpe: 8,
      }),
    ];

    it('1. Correct rollback is accepted when base and presented weights differ', () => {
      // Qualifying baseline
      const [exp1, exp2] = createQualifyingExposures();

      // Session 3: Periodised base = 50 kg, presented nudge = 52.5 kg.
      // Rollback target matches the independently reconstructed current base (50 kg, 8 reps, RPE 8).
      const exp3 = createExposure({
        logId: 'nudge-success',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 50,
        baseReps: 8,
        baseRpe: 8,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 52.5,
        presentedReps: 8,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 50,
          reps: 8,
          rpe: 8,
          comparisonLoadKg: 50,
        },
      });

      const res = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
      });

      expect(res.status).toBe('success');
      if (res.status !== 'success') return;

      expect(res.trustStatus).toBe('trusted');
      expect(res.confirmedStepIndex).toBe(1);
      expect(res.confirmedNudgeCount).toBe(1);
      expect(res.stablePrescription?.[0].weight).toBe(52.5);
      expect(res.diagnostics.some(d => d.code === 'NUDGE_CONFIRMED')).toBe(true);
      expect(res.diagnostics.some(d => d.code === 'ROLLBACK_TARGET_MISMATCH')).toBe(false);
    });

    it('2. An internally consistent rollback using the wrong weight is rejected', () => {
      // Qualifying baseline establishes stable prescription of 47.5 kg
      const [exp1, exp2] = createQualifyingExposures();

      // Session 3: Current base is 50 kg, presented is 52.5 kg.
      // Rollback target provides 47.5 kg (internally consistent and matches previous stable,
      // but does NOT match the independently reconstructed current base of 50 kg).
      const exp3 = createExposure({
        logId: 'nudge-wrong-weight',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 50,
        baseReps: 8,
        baseRpe: 8,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 52.5,
        presentedReps: 8,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 47.5, // Wrong weight! Reconstructed base is 50 kg
          reps: 8,
          rpe: 8,
          comparisonLoadKg: 47.5,
        },
      });

      const res = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
      });

      expect(res.status).toBe('success');
      if (res.status !== 'success') return;

      // Rejected from authorized nudge due to rollback target mismatch
      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.confirmedStepIndex).toBe(0);
      expect(res.confirmedNudgeCount).toBe(0);
      expect(res.diagnostics.some(d => d.code === 'ROLLBACK_TARGET_MISMATCH')).toBe(true);
    });

    it('3. A rollback using the correct weight but wrong reps is rejected', () => {
      const [exp1, exp2] = createQualifyingExposures();

      // Session 3: Current base is 50 kg @ 8 reps. Rollback specifies 7 reps.
      const exp3 = createExposure({
        logId: 'nudge-wrong-reps',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 50,
        baseReps: 8,
        baseRpe: 8,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 52.5,
        presentedReps: 8,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 50,
          reps: 7, // Wrong reps! Base is 8 reps
          rpe: 8,
          comparisonLoadKg: 50,
        },
      });

      const res = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
      });

      expect(res.status).toBe('success');
      if (res.status !== 'success') return;

      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.confirmedStepIndex).toBe(0);
      expect(res.confirmedNudgeCount).toBe(0);
      expect(res.diagnostics.some(d => d.code === 'ROLLBACK_TARGET_MISMATCH')).toBe(true);
    });

    it('4. A rollback using the correct weight and reps but wrong RPE is rejected', () => {
      const [exp1, exp2] = createQualifyingExposures();

      // Session 3: Current base is 50 kg @ 8 reps @ RPE 8. Rollback specifies RPE 7.
      const exp3 = createExposure({
        logId: 'nudge-wrong-rpe',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 50,
        baseReps: 8,
        baseRpe: 8,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 52.5,
        presentedReps: 8,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 50,
          reps: 8,
          rpe: 7, // Wrong RPE! Base is 8
          comparisonLoadKg: 50,
        },
      });

      const res = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
      });

      expect(res.status).toBe('success');
      if (res.status !== 'success') return;

      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.confirmedStepIndex).toBe(0);
      expect(res.confirmedNudgeCount).toBe(0);
      expect(res.diagnostics.some(d => d.code === 'ROLLBACK_TARGET_MISMATCH')).toBe(true);
    });

    it('5. Copying the presented load into the rollback is rejected when the base differs', () => {
      const [exp1, exp2] = createQualifyingExposures();

      // Session 3: Current base is 50 kg, presented is 52.5 kg.
      // Erroneously copies presented weight (52.5 kg) into rollbackTarget.
      const exp3 = createExposure({
        logId: 'nudge-copy-presented',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 50,
        baseReps: 8,
        baseRpe: 8,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 52.5,
        presentedReps: 8,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        rollbackTarget: {
          weight: 52.5, // Copied presented load! Base is 50 kg
          reps: 8,
          rpe: 8,
          comparisonLoadKg: 52.5,
        },
      });

      const res = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
      });

      expect(res.status).toBe('success');
      if (res.status !== 'success') return;

      expect(res.trustStatus).toBe('degraded_requalification');
      expect(res.confirmedStepIndex).toBe(0);
      expect(res.confirmedNudgeCount).toBe(0);
      expect(res.diagnostics.some(d => d.code === 'ROLLBACK_TARGET_MISMATCH')).toBe(true);
    });

    it('6. Multiple prescribed sets are each checked against their own base; copying Set 1 fallback onto another set with a different base is rejected', () => {
      const [exp1, exp2] = createQualifyingExposures();

      // Multi-set session where Set 1 base is 100 kg, Set 2 base is 90 kg, Set 3 base is 80 kg.
      // Set 2 mistakenly copies Set 1's rollback target (100 kg) instead of its own base (90 kg).
      const exp3Rejected = createExposure({
        logId: 'nudge-multiset-copied-set1',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 100,
        baseReps: 8,
        baseRpe: 8,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        nudgedOrdinal: 1,
        presentedWeight: 102.5,
        presentedReps: 8,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        setOverrides: [
          {
            workingSetOrdinal: 1,
            baseWeight: 100,
            presentedWeight: 102.5,
            rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 },
          },
          {
            workingSetOrdinal: 2,
            baseWeight: 90,
            presentedWeight: 90,
            // Copied Set 1's rollback target (100 kg) instead of Set 2's base (90 kg)!
            rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 },
          },
          {
            workingSetOrdinal: 3,
            baseWeight: 80,
            presentedWeight: 80,
            rollbackTarget: { weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 },
          },
        ],
      });

      const resRejected = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3Rejected],
        isPartialLineage: false,
      });

      expect(resRejected.status).toBe('success');
      if (resRejected.status !== 'success') return;

      expect(resRejected.trustStatus).toBe('degraded_requalification');
      expect(resRejected.confirmedStepIndex).toBe(0);
      expect(resRejected.confirmedNudgeCount).toBe(0);
      expect(resRejected.diagnostics.some(d => d.code === 'ROLLBACK_TARGET_MISMATCH')).toBe(true);

      // Now verify that when Set 2 uses its own reconstructed base (90 kg), it is accepted!
      const exp3Accepted = createExposure({
        logId: 'nudge-multiset-correct',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 100,
        baseReps: 8,
        baseRpe: 8,
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        nudgedOrdinal: 1,
        presentedWeight: 102.5,
        presentedReps: 8,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        setOverrides: [
          {
            workingSetOrdinal: 1,
            baseWeight: 100,
            presentedWeight: 102.5,
            rollbackTarget: { weight: 100, reps: 8, rpe: 8, comparisonLoadKg: 100 },
          },
          {
            workingSetOrdinal: 2,
            baseWeight: 90,
            presentedWeight: 90,
            // Correct per-set base for Set 2
            rollbackTarget: { weight: 90, reps: 8, rpe: 8, comparisonLoadKg: 90 },
          },
          {
            workingSetOrdinal: 3,
            baseWeight: 80,
            presentedWeight: 80,
            // Correct per-set base for Set 3
            rollbackTarget: { weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 },
          },
        ],
      });

      const resAccepted = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3Accepted],
        isPartialLineage: false,
      });

      expect(resAccepted.status).toBe('success');
      if (resAccepted.status !== 'success') return;

      expect(resAccepted.trustStatus).toBe('trusted');
      expect(resAccepted.confirmedStepIndex).toBe(1);
      expect(resAccepted.confirmedNudgeCount).toBe(1);
      expect(resAccepted.stablePrescription?.[0].weight).toBe(102.5);
      expect(resAccepted.stablePrescription?.[1].weight).toBe(90);
      expect(resAccepted.stablePrescription?.[2].weight).toBe(80);
      expect(resAccepted.diagnostics.some(d => d.code === 'ROLLBACK_TARGET_MISMATCH')).toBe(false);
    });
  });
});
