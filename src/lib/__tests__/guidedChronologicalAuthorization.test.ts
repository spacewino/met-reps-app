/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  reduceGuidedAdherenceState,
  GuidedAdherenceSuccessResult,
} from '../guidedAdherenceTracker';
import {
  replayGuidedLaneState,
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
  SetEntry,
  ExerciseModality,
  WeightUnit,
  GuidedCoachingReasonCode,
  ProgressionNudgeType,
} from '../../types';

describe('guidedChronologicalAuthorization', () => {
  const asSuccess = (res: unknown): GuidedAdherenceSuccessResult => {
    const successRes = res as GuidedAdherenceSuccessResult;
    expect(successRes.status).toBe('success');
    return successRes;
  };
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
    const presentedStepIndex =
      overrides?.presentedStepIndex ??
      (isAdvance ? confirmedStepIndexBefore + 1 : confirmedStepIndexBefore);

    const rollbackTarget = isAdvance
      ? (overrides?.rollbackTarget ?? {
          weight: baseWeight,
          reps: baseReps,
          rpe: baseRpe,
          comparisonLoadKg: modality === 'bodyweight' ? 75 : baseWeight,
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
      comparableLaneKey: overrides?.comparableLaneKey ?? 'barbell_bench_press_lane',
      workingSetOrdinal: 1,
      prescribedWorkingSetCount: 3,
      baseWeight,
      baseReps,
      baseRpe,
      presentedWeight,
      presentedReps,
      presentedRpe: baseRpe,
      comparisonLoadKg: overrides?.comparisonLoadKg ?? (modality === 'bodyweight' ? 75 : presentedWeight),
      weightUnit: overrides?.weightUnit ?? 'kg',
      bodyweightSnapshot:
        overrides?.bodyweightSnapshot ??
        (modality === 'bodyweight' ? 75 : null),
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

  const createExposure = (opts: {
    logId: string;
    date: string;
    outcome: 'success' | 'marginal_miss' | 'substantial_miss' | 'neutral';
    marginalMissCount?: number;
    substantialMissCount?: number;
    week?: number;
    comparableLaneKey?: string;
    baseWeight?: number;
    baseReps?: number;
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
    exerciseKey?: string;
  }): ComparableGuidedExposure => {
    const coachingReason = opts.coachingReasonCode ?? 'BASE_PRESCRIPTION';
    const isNudge =
      coachingReason === 'LOAD_NUDGE_MAIN_MOVEMENT' || coachingReason === 'REP_NUDGE';
    const nudgedOrdinal = opts.nudgedOrdinal ?? (isNudge ? 1 : null);
    const setAchieved = opts.achievedOverride ?? opts.outcome === 'success';
    const laneKey = opts.comparableLaneKey ?? 'barbell_bench_press_lane';
    const exerciseKey = opts.exerciseKey ?? 'barbell_bench_press';
    const baseWeight = opts.baseWeight ?? (opts.modality === 'bodyweight' ? 0 : 100);
    const baseReps = opts.baseReps ?? 8;

    const sets: ComparableGuidedSetDetail[] = [1, 2, 3].map(ord => {
      const isThisNudge = isNudge && ord === nudgedOrdinal;
      const defaultRollback = isNudge
        ? (opts.rollbackTarget ?? {
            weight: baseWeight,
            reps: baseReps,
            rpe: opts.baseRpe ?? 8,
            comparisonLoadKg: opts.modality === 'bodyweight' ? 75 : baseWeight,
          })
        : null;

      const snap = createSnapshot({
        exerciseKey,
        comparableLaneKey: laneKey,
        workingSetOrdinal: ord,
        baseWeight,
        baseReps,
        baseRpe: opts.baseRpe ?? 8,
        modality: opts.modality ?? 'weighted',
        weightUnit: opts.weightUnit ?? 'kg',
        coachingReasonCode: coachingReason,
        nudgeType: isThisNudge
          ? opts.nudgeType ?? (coachingReason === 'REP_NUDGE' ? 'rep_nudge' : 'load_nudge')
          : 'none',
        presentedWeight: isThisNudge
          ? opts.presentedWeight ?? baseWeight + 2.5
          : baseWeight,
        presentedReps: isThisNudge
          ? opts.presentedReps ?? baseReps + (coachingReason === 'REP_NUDGE' ? 1 : 0)
          : baseReps,
        confirmedStepIndexBefore: opts.confirmedStepIndexBefore ?? 0,
        presentedStepIndex:
          opts.presentedStepIndex ??
          (isNudge
            ? (opts.confirmedStepIndexBefore ?? 0) + 1
            : opts.confirmedStepIndexBefore ?? 0),
        rollbackTarget: defaultRollback,
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
          ? (opts.marginalMissCount ?? 1) > 1
            ? 'MULTIPLE_MARGINAL_MISSES'
            : 'SINGLE_MARGINAL_MISS'
          : 'PRESCRIBED_SET_SUBSTANTIAL_MISS',
      expectedPrescribedSetCount: 3,
      observedPrescribedSetCount: 3,
      attemptedPrescribedSetCount: opts.outcome === 'neutral' ? 0 : 3,
      successfulPrescribedSetCount: opts.outcome === 'success' ? 3 : 0,
      marginalMissCount:
        opts.outcome === 'marginal_miss' ? opts.marginalMissCount ?? 1 : 0,
      substantialMissCount:
        opts.outcome === 'substantial_miss' ? opts.substantialMissCount ?? 1 : 0,
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
      week: opts.week ?? 1,
      day: 1,
      exerciseIndex: 0,
      exerciseKey,
      exerciseRole: 'main_movement',
      modality: opts.modality ?? 'weighted',
      comparableLaneKey: laneKey,
      prescribedWorkingSetCount: 3,
      weightUnit: opts.weightUnit ?? 'kg',
      sets,
      nudgedWorkingSetOrdinal: nudgedOrdinal,
      nudgedSetAchieved: isNudged ? setAchieved : null,
      nudgedSetOutcome: isNudged ? (setAchieved ? 'success' : 'marginal_miss') : null,
      classification,
    };
  };

  describe('Chronological Authorization Requirements', () => {
    it('does not authorize historical nudge from its own credit or later workouts', () => {
      // Exposure 1: first session with premature nudge presented at step 1
      const exp1 = createExposure({
        logId: 's1',
        date: '2026-03-01',
        outcome: 'success',
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 102.5,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
      });

      // Exposure 2: base prescription success
      const exp2 = createExposure({
        logId: 's2',
        date: '2026-03-08',
        outcome: 'success',
        baseWeight: 102.5,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 0,
      });

      // Exposure 3: base prescription success -> earns 2 credits
      const exp3 = createExposure({
        logId: 's3',
        date: '2026-03-15',
        outcome: 'success',
        baseWeight: 102.5,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 0,
      });

      // Broad adherence across all 3 exposures
      const broadAdherence = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3]));
      expect(broadAdherence.successCredit).toBe(2);
      expect(broadAdherence.adherenceGateOpen).toBe(true);

      // Replay of lane with broad adherence supplied:
      // Even though final broad adherence has credit 2 and gate open,
      // exp1's stateBefore has credit 0 and gate closed!
      // Therefore, exp1's nudge MUST NOT be authorized!
      const replayResult = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3],
        isPartialLineage: false,
        broadAdherence,
      });

      expect(replayResult.status).toBe('success');
      if (replayResult.status !== 'success') return;

      // Because exp1 was unauthorized, replay downgraded it and confirmedStepIndex did NOT advance to 1
      expect(replayResult.confirmedNudgeCount).toBe(0);
      expect(replayResult.diagnostics.some(d => d.code === 'NUDGE_BEFORE_TWO_SUCCESSES')).toBe(true);
    });

    it('rejects authorization when timeline entry has mismatched date or exercise', () => {
      // Prior sessions establish broad qualification
      const prior1 = createExposure({
        logId: 'p1',
        date: '2026-02-01',
        outcome: 'success',
      });
      const prior2 = createExposure({
        logId: 'p2',
        date: '2026-02-08',
        outcome: 'success',
      });

      // Nudge exposure with date mismatch in timeline
      const nudgeExp = createExposure({
        logId: 'n1',
        date: '2026-02-15',
        outcome: 'success',
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 102.5,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
      });

      const broadAdherence = asSuccess(reduceGuidedAdherenceState([prior1, prior2, nudgeExp]));

      // Tamper with broadAdherence timeline entry for n1 so that date mismatches
      const tamperedAdherence = {
        ...broadAdherence,
        timeline: broadAdherence.timeline.map(e =>
          e.workoutLogId === 'n1' ? { ...e, workoutDate: '2026-02-16' } : e
        ),
      };

      const replayResult = replayGuidedLaneState({
        exposures: [nudgeExp],
        isPartialLineage: false,
        broadAdherence: tamperedAdherence,
      });

      expect(replayResult.status).toBe('success');
      if (replayResult.status !== 'success') return;

      // Must record diagnostic and reject authorization
      expect(replayResult.diagnostics.some(d => d.code === 'BROAD_ADHERENCE_DATE_MISMATCH')).toBe(true);
      expect(replayResult.confirmedNudgeCount).toBe(0);
    });
  });

  describe('Historical Edit Invalidation Requirement', () => {
    it('invalidates downstream nudge authorization when an earlier success is edited to a substantial miss', () => {
      // Original timeline:
      // Session 1: Success (credit 1)
      const exp1 = createExposure({
        logId: 's1',
        date: '2026-03-01',
        outcome: 'success',
      });

      // Session 2: Success (credit 2) -> Gate open!
      const exp2Original = createExposure({
        logId: 's2',
        date: '2026-03-08',
        outcome: 'success',
      });

      // Session 3: Authorized nudge presented and successfully executed
      const exp3 = createExposure({
        logId: 's3',
        date: '2026-03-15',
        outcome: 'success',
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 102.5,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
      });

      // 1. Verify original scenario: nudge IS authorized and confirmed
      const originalBroad = asSuccess(reduceGuidedAdherenceState([exp1, exp2Original, exp3]));
      const originalReplay = replayGuidedLaneState({
        exposures: [exp1, exp2Original, exp3],
        isPartialLineage: false,
        broadAdherence: originalBroad,
      });

      expect(originalReplay.status).toBe('success');
      if (originalReplay.status !== 'success') return;
      expect(originalReplay.confirmedStepIndex).toBe(1);
      expect(originalReplay.confirmedNudgeCount).toBe(1);

      // 2. Historical Edit: User edits Session 2 log from success to substantial miss
      const exp2Edited = createExposure({
        logId: 's2',
        date: '2026-03-08',
        outcome: 'substantial_miss',
      });

      const editedBroad = asSuccess(reduceGuidedAdherenceState([exp1, exp2Edited, exp3]));
      expect(editedBroad.timeline.find(t => t.workoutLogId === 's3')?.stateBefore.adherenceGateOpen).toBe(false);
      expect(editedBroad.timeline.find(t => t.workoutLogId === 's3')?.stateBefore.successCredit).toBe(0);

      // Replay with edited history:
      const editedReplay = replayGuidedLaneState({
        exposures: [exp1, exp2Edited, exp3],
        isPartialLineage: false,
        broadAdherence: editedBroad,
      });

      expect(editedReplay.status).toBe('success');
      if (editedReplay.status !== 'success') return;

      // Downstream authorization is invalidated!
      expect(editedReplay.confirmedStepIndex).toBe(0);
      expect(editedReplay.confirmedNudgeCount).toBe(0);
      expect(editedReplay.diagnostics.some(d => d.code === 'NUDGE_BEFORE_TWO_SUCCESSES')).toBe(true);
    });

    it('invalidates downstream nudge authorization when an earlier success is edited to multiple marginal misses', () => {
      const exp1 = createExposure({
        logId: 's1',
        date: '2026-03-01',
        outcome: 'success',
      });

      // Session 2 edited to multiple marginal misses -> resets credit to 0
      const exp2Edited = createExposure({
        logId: 's2',
        date: '2026-03-08',
        outcome: 'marginal_miss',
        marginalMissCount: 2,
      });

      const exp3 = createExposure({
        logId: 's3',
        date: '2026-03-15',
        outcome: 'success',
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 102.5,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
      });

      const editedBroad = asSuccess(reduceGuidedAdherenceState([exp1, exp2Edited, exp3]));
      const s3Before = editedBroad.timeline.find(t => t.workoutLogId === 's3')?.stateBefore;
      expect(s3Before?.successCredit).toBe(0);
      expect(s3Before?.adherenceGateOpen).toBe(false);

      const editedReplay = replayGuidedLaneState({
        exposures: [exp1, exp2Edited, exp3],
        isPartialLineage: false,
        broadAdherence: editedBroad,
      });

      expect(editedReplay.status).toBe('success');
      if (editedReplay.status !== 'success') return;
      expect(editedReplay.confirmedStepIndex).toBe(0);
      expect(editedReplay.confirmedNudgeCount).toBe(0);
    });

    it('invalidates downstream nudge when an earlier session is edited to single marginal miss activating marginal hold', () => {
      const exp1 = createExposure({
        logId: 's1',
        date: '2026-03-01',
        outcome: 'success',
      });
      const exp2 = createExposure({
        logId: 's2',
        date: '2026-03-05',
        outcome: 'success',
      });

      // Session 3 edited to single marginal miss (was at 2 credits, now marginal hold activated)
      const exp3Edited = createExposure({
        logId: 's3',
        date: '2026-03-08',
        outcome: 'marginal_miss',
        marginalMissCount: 1,
      });

      // Session 4 presents a fresh nudge despite marginal hold
      const exp4 = createExposure({
        logId: 's4',
        date: '2026-03-15',
        outcome: 'success',
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        nudgeType: 'load_nudge',
        presentedWeight: 102.5,
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
      });

      const broad = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3Edited, exp4]));
      const s4Before = broad.timeline.find(t => t.workoutLogId === 's4')?.stateBefore;
      expect(s4Before?.successCredit).toBe(2);
      expect(s4Before?.marginalHoldActive).toBe(true);
      expect(s4Before?.adherenceGateOpen).toBe(false);

      const replay = replayGuidedLaneState({
        exposures: [exp1, exp2, exp3Edited, exp4],
        isPartialLineage: false,
        broadAdherence: broad,
      });

      expect(replay.status).toBe('success');
      if (replay.status !== 'success') return;
      // Nudge is not authorized because marginal hold was active at s4
      expect(replay.confirmedNudgeCount).toBe(0);
    });
  });
});
