/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  reduceGuidedAdherenceState,
  isAdherenceGateOpen,
  ReduceGuidedAdherenceStateInput,
  GuidedAdherenceSuccessResult,
} from '../guidedAdherenceTracker';
import {
  collectGuidedAdherenceHistory,
  collectComparableGuidedHistory,
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
  Program,
  WorkoutLog,
  SetEntry,
} from '../../types';

describe('guidedAdherenceTracker', () => {
  const asSuccess = (res: any): GuidedAdherenceSuccessResult => res as GuidedAdherenceSuccessResult;
  const createSnapshot = (
    overrides?: Partial<PrescriptionSnapshot>
  ): PrescriptionSnapshot => {
    const baseWeight = overrides?.baseWeight ?? 100;
    const baseReps = overrides?.baseReps ?? 8;
    const baseRpe = overrides?.baseRpe ?? 8;
    return {
      snapshotVersion: 2,
      progressionPolicyVersion: 1,
      algorithmVersion: 1,
      progressionMode: 'metreps_guided',
      algorithmId: 'hypertrophy_linear',
      exerciseKey: 'barbell_bench_press',
      exerciseRole: 'main_movement',
      modality: 'weighted',
      comparableLaneKey: 'barbell_bench_press_w1',
      workingSetOrdinal: 1,
      prescribedWorkingSetCount: 3,
      baseWeight,
      baseReps,
      baseRpe,
      presentedWeight: overrides?.presentedWeight ?? baseWeight,
      presentedReps: overrides?.presentedReps ?? baseReps,
      presentedRpe: overrides?.presentedRpe ?? baseRpe,
      comparisonLoadKg: overrides?.comparisonLoadKg ?? baseWeight,
      weightUnit: 'kg',
      bodyweightSnapshot: null,
      loadBasis: 'external_weight_v1',
      loadIncrement: 2.5,
      coachingReasonCode: 'BASE_PRESCRIPTION',
      nudgeType: 'none',
      confirmedStepIndexBefore: 0,
      presentedStepIndex: 0,
      successCreditEligible: true,
      rollbackTarget: null,
      ...overrides,
    };
  };

  const createSetDetail = (
    ordinal: number,
    achieved: boolean,
    overrides?: Partial<PrescriptionSnapshot>
  ): ComparableGuidedSetDetail => {
    const snap = createSnapshot({ workingSetOrdinal: ordinal, ...overrides });
    const setResult: GuidedSetOutcomeResult = {
      outcome: achieved ? 'success' : 'marginal_miss',
      reason: achieved ? 'TARGET_ACHIEVED_EXACT' : 'MARGINAL_MISS_REPS',
      targetAchieved: achieved,
      extraCapacityCreditEligible: false,
      rpeSource: 'explicit',
      actualComparisonLoadKg: snap.comparisonLoadKg,
      presentedComparisonLoadKg: snap.comparisonLoadKg,
      presentedCapacityIndex: 1.0,
      actualCapacityIndex: 1.0,
      relativePerformance: 0,
    };
    const setEntry: SetEntry = {
      setNumber: ordinal,
      reps: snap.presentedReps,
      weight: snap.presentedWeight,
      rpe: snap.presentedRpe,
      isCompleted: true,
      prescriptionSnapshot: snap,
    };
    return {
      workingSetOrdinal: ordinal,
      snapshot: snap,
      setEntry,
      setResult,
    };
  };

  const createExposure = (
    outcome: 'success' | 'marginal_miss' | 'substantial_miss' | 'neutral',
    opts?: {
      logId?: string;
      date?: string;
      week?: number;
      comparableLaneKey?: string;
      baseReps?: number;
      baseWeight?: number;
    }
  ): ComparableGuidedExposure => {
    const logId = opts?.logId ?? 'log-1';
    const date = opts?.date ?? '2026-03-01';
    const week = opts?.week ?? 1;
    const laneKey = opts?.comparableLaneKey ?? `barbell_bench_press_w${week}`;
    const baseReps = opts?.baseReps ?? 8;
    const baseWeight = opts?.baseWeight ?? 100;

    const achieved = outcome === 'success';
    const sets = [
      createSetDetail(1, achieved, { comparableLaneKey: laneKey, baseReps, baseWeight }),
      createSetDetail(2, achieved, { comparableLaneKey: laneKey, baseReps, baseWeight }),
      createSetDetail(3, achieved, { comparableLaneKey: laneKey, baseReps, baseWeight }),
    ];

    const classification: GuidedExerciseOutcomeResult = {
      outcome,
      reason:
        outcome === 'success'
          ? 'ALL_PRESCRIBED_SETS_ACHIEVED'
          : outcome === 'neutral'
          ? 'EXERCISE_SKIPPED'
          : outcome === 'marginal_miss'
          ? 'SINGLE_MARGINAL_MISS'
          : 'PRESCRIBED_SET_SUBSTANTIAL_MISS',
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
      nudgedSetPresent: false,
      nudgedSetAchieved: null,
      nudgedSetOutcome: null,
      nudgedWorkingSetOrdinal: null,
      setResults: sets.map(s => ({
        workingSetOrdinal: s.workingSetOrdinal,
        result: s.setResult,
      })),
    };

    return {
      workoutLogId: logId,
      workoutDate: date,
      workoutTimestampMs: Date.parse(`${date}T10:00:00Z`),
      scheduledDate: date,
      programId: 'prog-1',
      cycleIndex: 1,
      lineagePosition: 0,
      week,
      day: 1,
      exerciseIndex: 0,
      exerciseKey: 'barbell_bench_press',
      exerciseRole: 'main_movement',
      modality: 'weighted',
      comparableLaneKey: laneKey,
      prescribedWorkingSetCount: 3,
      weightUnit: 'kg',
      sets,
      nudgedWorkingSetOrdinal: null,
      nudgedSetOutcome: null,
      nudgedSetAchieved: null,
      classification,
    };
  };

  describe('Empty and Initial State', () => {
    it('returns zero credit and closed gate for empty exposures', () => {
      const result = asSuccess(reduceGuidedAdherenceState([]));
      expect(result.status).toBe('success');
      expect(result.adherenceGateOpen).toBe(false);
      expect(result.gateReady).toBe(false);
      expect(result.adherenceStatus).toBe('unqualified');
      expect(result.successCredit).toBe(0);
      expect(result.consecutiveSuccessCount).toBe(0);
      expect(result.processedExposureCount).toBe(0);
      expect(result.successfulExposureCount).toBe(0);
      expect(result.failedExposureCount).toBe(0);
      expect(result.neutralExposureCount).toBe(0);
      expect(result.lastOutcome).toBeNull();
      expect(result.lastQualifyingWorkoutDate).toBeNull();
      expect(isAdherenceGateOpen(result)).toBe(false);
    });
  });

  describe('Qualification Transitions', () => {
    it('grants 1 credit for a single qualifying success, gate remains closed', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const result = asSuccess(reduceGuidedAdherenceState([exp1]));

      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(1);
      expect(result.consecutiveSuccessCount).toBe(1);
      expect(result.adherenceGateOpen).toBe(false);
      expect(result.gateReady).toBe(false);
      expect(result.adherenceStatus).toBe('unqualified');
      expect(result.successfulExposureCount).toBe(1);
      expect(result.lastOutcome).toBe('success');
      expect(result.lastQualifyingWorkoutDate).toBe('2026-03-01');
      expect(result.lastQualifyingWorkoutLogId).toBe('log-1');
      expect(isAdherenceGateOpen(result)).toBe(false);
    });

    it('opens the adherence gate after two consecutive qualifying successes', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('success', { logId: 'log-2', date: '2026-03-05' });
      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2]));

      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(2);
      expect(result.consecutiveSuccessCount).toBe(2);
      expect(result.adherenceGateOpen).toBe(true);
      expect(result.gateReady).toBe(true);
      expect(result.adherenceStatus).toBe('qualified');
      expect(result.successfulExposureCount).toBe(2);
      expect(result.lastOutcome).toBe('success');
      expect(result.lastQualifyingWorkoutDate).toBe('2026-03-05');
      expect(result.lastQualifyingWorkoutLogId).toBe('log-2');
      expect(isAdherenceGateOpen(result)).toBe(true);
    });

    it('caps successCredit at 2 while gate remains open on 3 or more successes', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('success', { logId: 'log-2', date: '2026-03-05' });
      const exp3 = createExposure('success', { logId: 'log-3', date: '2026-03-08' });
      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3]));

      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(2);
      expect(result.consecutiveSuccessCount).toBe(3);
      expect(result.adherenceGateOpen).toBe(true);
      expect(result.successfulExposureCount).toBe(3);
    });
  });

  describe('Neutral Outcomes and Preservation', () => {
    it('preserves credit at 1 when neutral session occurs between successes', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('neutral', { logId: 'log-2', date: '2026-03-05' });
      const exp3 = createExposure('success', { logId: 'log-3', date: '2026-03-08' });
      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3]));

      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(2);
      expect(result.consecutiveSuccessCount).toBe(2);
      expect(result.adherenceGateOpen).toBe(true);
      expect(result.neutralExposureCount).toBe(1);
      expect(result.successfulExposureCount).toBe(2);
    });

    it('preserves open gate when neutral session occurs after 2 successes', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('success', { logId: 'log-2', date: '2026-03-05' });
      const exp3 = createExposure('neutral', { logId: 'log-3', date: '2026-03-08' });
      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3]));

      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(2);
      expect(result.adherenceGateOpen).toBe(true);
      expect(result.gateReady).toBe(true);
      expect(result.neutralExposureCount).toBe(1);
    });
  });

  describe('Failures and Requalification', () => {
    it('preserves credit at 2 and activates marginal hold upon single marginal miss', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('success', { logId: 'log-2', date: '2026-03-05' });
      const exp3 = createExposure('marginal_miss', { logId: 'log-3', date: '2026-03-08' });
      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3]));

      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(2);
      expect(result.marginalHoldActive).toBe(true);
      expect(result.consecutiveSuccessCount).toBe(0);
      expect(result.adherenceGateOpen).toBe(false);
      expect(result.gateReady).toBe(true);
      expect(result.adherenceStatus).toBe('requalifying');
      expect(result.failedExposureCount).toBe(1);
      expect(result.lastOutcome).toBe('marginal_miss');
      expect(isAdherenceGateOpen(result)).toBe(false);
    });

    it('clears marginal hold on subsequent qualifying success and reopens gate', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('success', { logId: 'log-2', date: '2026-03-05' });
      const exp3 = createExposure('marginal_miss', { logId: 'log-3', date: '2026-03-08' });
      const exp4 = createExposure('success', { logId: 'log-4', date: '2026-03-12' });

      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3, exp4]));
      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(2);
      expect(result.marginalHoldActive).toBe(false);
      expect(result.adherenceGateOpen).toBe(true);
      expect(result.adherenceStatus).toBe('qualified');
      expect(result.consecutiveSuccessCount).toBe(1);
    });

    it('preserves credit at 1 upon single marginal miss when credit was 1', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('marginal_miss', { logId: 'log-2', date: '2026-03-05' });
      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2]));

      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(1);
      expect(result.marginalHoldActive).toBe(false);
      expect(result.adherenceGateOpen).toBe(false);
      expect(result.adherenceStatus).toBe('requalifying');
      expect(result.failedExposureCount).toBe(1);
    });

    it('resets credit to 0 and closes gate upon multiple marginal misses within one exposure', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('success', { logId: 'log-2', date: '2026-03-05' });
      const exp3 = createExposure('marginal_miss', { logId: 'log-3', date: '2026-03-08' });
      exp3.classification.marginalMissCount = 2;
      exp3.classification.reason = 'MULTIPLE_MARGINAL_MISSES';
      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3]));

      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(0);
      expect(result.marginalHoldActive).toBe(false);
      expect(result.adherenceGateOpen).toBe(false);
      expect(result.adherenceStatus).toBe('requalifying');
      expect(result.failedExposureCount).toBe(1);
    });

    it('resets credit to 0 and closes gate upon substantial miss', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('success', { logId: 'log-2', date: '2026-03-05' });
      const exp3 = createExposure('substantial_miss', { logId: 'log-3', date: '2026-03-08' });
      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3]));

      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(0);
      expect(result.adherenceGateOpen).toBe(false);
      expect(result.adherenceStatus).toBe('requalifying');
      expect(result.failedExposureCount).toBe(1);
    });

    it('requires two consecutive successes to requalify after a substantial miss', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('success', { logId: 'log-2', date: '2026-03-05' });
      const exp3 = createExposure('substantial_miss', { logId: 'log-3', date: '2026-03-08' });
      const exp4 = createExposure('success', { logId: 'log-4', date: '2026-03-12' }); // credit 1
      const exp5 = createExposure('success', { logId: 'log-5', date: '2026-03-15' }); // credit 2 -> reopen

      const resultInter = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3, exp4]));
      expect(resultInter.successCredit).toBe(1);
      expect(resultInter.adherenceGateOpen).toBe(false);
      expect(resultInter.adherenceStatus).toBe('requalifying');

      const resultFinal = asSuccess(reduceGuidedAdherenceState([exp1, exp2, exp3, exp4, exp5]));
      expect(resultFinal.successCredit).toBe(2);
      expect(resultFinal.adherenceGateOpen).toBe(true);
      expect(resultFinal.adherenceStatus).toBe('qualified');
      expect(resultFinal.consecutiveSuccessCount).toBe(2);
    });
  });

  describe('Broad Adherence Across Periodisation Weeks', () => {
    it('qualifies across different periodisation weeks with different base targets and lane keys', () => {
      // Week 1: 8 reps, 100 kg, lane key 'barbell_bench_press_w1'
      const exp1 = createExposure('success', {
        logId: 'w1-1',
        date: '2026-03-01',
        week: 1,
        comparableLaneKey: 'barbell_bench_press_w1',
        baseReps: 8,
        baseWeight: 100,
      });
      // Week 2: 6 reps, 105 kg, lane key 'barbell_bench_press_w2'
      const exp2 = createExposure('success', {
        logId: 'w2-1',
        date: '2026-03-08',
        week: 2,
        comparableLaneKey: 'barbell_bench_press_w2',
        baseReps: 6,
        baseWeight: 105,
      });

      const result = asSuccess(reduceGuidedAdherenceState([exp1, exp2]));
      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(2);
      expect(result.adherenceGateOpen).toBe(true);
      expect(result.processedExposureCount).toBe(2);
    });
  });

  describe('Input Formats and Fail-Closed Validation', () => {
    it('accepts an input object with exposures and isPartialLineage', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const input: ReduceGuidedAdherenceStateInput = {
        exposures: [exp1],
        isPartialLineage: true,
      };
      const result = asSuccess(reduceGuidedAdherenceState(input));
      expect(result.status).toBe('success');
      expect(result.successCredit).toBe(1);
      expect(result.isPartialLineage).toBe(true);
    });

    it('accepts a collection result object with usableExposures', () => {
      const exp1 = createExposure('success', { logId: 'log-1', date: '2026-03-01' });
      const exp2 = createExposure('success', { logId: 'log-2', date: '2026-03-05' });
      const collectorResult = {
        status: 'success' as const,
        usableExposures: [exp1, exp2],
        isPartialLineage: false,
      };
      const result = asSuccess(reduceGuidedAdherenceState(collectorResult));
      expect(result.status).toBe('success');
      expect(result.adherenceGateOpen).toBe(true);
    });

    it('fails closed with invalid_input on malformed input', () => {
      const resultNull = reduceGuidedAdherenceState(null as any);
      expect(resultNull.status).toBe('invalid_input');
      expect(resultNull.adherenceGateOpen).toBe(false);

      const resultEmptyObj = reduceGuidedAdherenceState({} as any);
      expect(resultEmptyObj.status).toBe('invalid_input');
      expect(resultEmptyObj.adherenceGateOpen).toBe(false);

      const resultBadExp = reduceGuidedAdherenceState([null as any]);
      expect(resultBadExp.status).toBe('invalid_input');
      expect(resultBadExp.adherenceGateOpen).toBe(false);
    });
  });

  describe('Integration with collectGuidedAdherenceHistory vs collectComparableGuidedHistory', () => {
    it('collectGuidedAdherenceHistory spans weeks while collectComparableGuidedHistory rejects lane mismatch', () => {
      const program: Program = {
        id: 'prog-1',
        name: 'Hypertrophy 8-Week',
        targetProgressionMode: 'metreps_guided',
        daysPerWeek: 3,
        programDuration: 8,
        createdAt: '2026-01-01T00:00:00Z',
        exercisesByDay: {},
        cycleIndex: 1,
      };

      const snapWeek1 = createSnapshot({
        comparableLaneKey: 'bench_lane_week1',
        baseReps: 8,
        baseWeight: 100,
      });

      const snapWeek2 = createSnapshot({
        comparableLaneKey: 'bench_lane_week2',
        baseReps: 6,
        baseWeight: 105,
      });

      const workoutLog1: WorkoutLog = {
        id: 'log-w1',
        date: '2026-03-01',
        programId: 'prog-1',
        week: '1',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            exerciseKey: 'barbell_bench_press',
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              {
                setNumber: 1,
                weight: 100,
                reps: 8,
                rpe: 8,
                isCompleted: true,
                prescriptionSnapshot: { ...snapWeek1, workingSetOrdinal: 1 },
              },
              {
                setNumber: 2,
                weight: 100,
                reps: 8,
                rpe: 8,
                isCompleted: true,
                prescriptionSnapshot: { ...snapWeek1, workingSetOrdinal: 2 },
              },
              {
                setNumber: 3,
                weight: 100,
                reps: 8,
                rpe: 8,
                isCompleted: true,
                prescriptionSnapshot: { ...snapWeek1, workingSetOrdinal: 3 },
              },
            ],
          },
        ],
      };

      const workoutLog2: WorkoutLog = {
        id: 'log-w2',
        date: '2026-03-08',
        programId: 'prog-1',
        week: '2',
        day: '1',
        unit: 'kg',
        exercises: [
          {
            exerciseKey: 'barbell_bench_press',
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              {
                setNumber: 1,
                weight: 105,
                reps: 6,
                rpe: 8,
                isCompleted: true,
                prescriptionSnapshot: { ...snapWeek2, workingSetOrdinal: 1 },
              },
              {
                setNumber: 2,
                weight: 105,
                reps: 6,
                rpe: 8,
                isCompleted: true,
                prescriptionSnapshot: { ...snapWeek2, workingSetOrdinal: 2 },
              },
              {
                setNumber: 3,
                weight: 105,
                reps: 6,
                rpe: 8,
                isCompleted: true,
                prescriptionSnapshot: { ...snapWeek2, workingSetOrdinal: 3 },
              },
            ],
          },
        ],
      };

      // Target snapshot for Week 3 (which has base reps 4 and lane key 'bench_lane_week3')
      const targetSnapshotWeek3 = createSnapshot({
        comparableLaneKey: 'bench_lane_week3',
        baseReps: 4,
        baseWeight: 110,
      });

      const boundary = {
        mode: 'active_live' as const,
        targetDate: '2026-03-15',
        sessionStartedAt: Date.parse('2026-03-15T10:00:00Z'),
      };

      // 1. Broad adherence collection for Week 3 target:
      const adherenceHistory = collectGuidedAdherenceHistory({
        targetProgramId: 'prog-1',
        programs: [program],
        logs: [workoutLog1, workoutLog2],
        targetSnapshot: targetSnapshotWeek3,
        boundary,
      });

      expect(adherenceHistory.status).toBe('success');
      // Both Week 1 and Week 2 match broad adherence identity!
      expect(adherenceHistory.usableExposures.length).toBe(2);

      // Reducing broad adherence opens the adherence gate!
      const adherenceState = reduceGuidedAdherenceState(adherenceHistory);
      expect(adherenceState.status).toBe('success');
      expect(adherenceState.adherenceGateOpen).toBe(true);
      expect(adherenceState.successCredit).toBe(2);

      // 2. By contrast, comparable lane collection strictly checks comparableLaneKey:
      const comparableHistory = collectComparableGuidedHistory({
        targetProgramId: 'prog-1',
        programs: [program],
        logs: [workoutLog1, workoutLog2],
        targetSnapshot: targetSnapshotWeek3,
        boundary,
      });

      expect(comparableHistory.status).toBe('success');
      // Zero usable exposures in the specific Week 3 lane!
      expect(comparableHistory.usableExposures.length).toBe(0);
      expect(comparableHistory.diagnostics.excludedExposures.length).toBe(2);
      expect(comparableHistory.diagnostics.excludedExposures[0].reason).toBe('COMPARABLE_LANE_MISMATCH');
    });
  });
});
