/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  classifyGuidedSetOutcome,
  ClassifyGuidedSetOutcomeInput,
  LOAD_EQUALITY_EPSILON,
  CAPACITY_EQUALITY_EPSILON,
  SHORTFALL_CAP_EPSILON,
} from '../guidedOutcomeClassifier';
import {
  WorkoutLog,
  ExerciseEntry,
  SetEntry,
  PrescriptionSnapshot,
} from '../../types';
import {
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
} from '../programProgressionMode';

// In-memory localStorage mock for node test runner if needed
if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
  const memoryStore: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => memoryStore[key] ?? null,
    setItem: (key: string, value: string) => {
      memoryStore[key] = String(value);
    },
    removeItem: (key: string) => {
      delete memoryStore[key];
    },
    clear: () => {
      Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
    },
    key: (index: number) => Object.keys(memoryStore)[index] ?? null,
    length: 0,
  } as Storage;
}

describe('classifyGuidedSetOutcome', () => {
  function makeBaseSnapshot(overrides?: Partial<PrescriptionSnapshot>): PrescriptionSnapshot {
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
      prescribedWorkingSetCount: 1,
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

  function makeBaseContext(
    setOverrides?: Partial<SetEntry>,
    exerciseOverrides?: Partial<ExerciseEntry>,
    workoutOverrides?: Partial<WorkoutLog>
  ): ClassifyGuidedSetOutcomeInput {
    const defaultSnapshot = makeBaseSnapshot();

    const set: SetEntry = {
      setNumber: 1,
      weight: 80,
      reps: 8,
      rpe: 8.0,
      isCompleted: true,
      prescriptionSnapshot: defaultSnapshot,
      ...setOverrides,
    };

    const exercise: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      exerciseKey: 'barbell_bench_press',
      modality: 'weighted',
      sets: [set],
      ...exerciseOverrides,
    };

    const workout: WorkoutLog = {
      id: 'log-1',
      date: '2026-09-03',
      programId: 'program-1',
      program: 'Guided Strength',
      unit: 'kg',
      exercises: [exercise],
      ...workoutOverrides,
    };

    return { set, exercise, workout };
  }

  describe('Weighted Modality Outcomes', () => {
    it('exact target without RPE succeeds without extra capacity credit', () => {
      const input = makeBaseContext({ rpe: null });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_WITHOUT_RPE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.rpeSource).toBe('presented_target_imputation');
      expect(result.actualComparisonLoadKg).toBe(80);
      expect(result.presentedComparisonLoadKg).toBe(80);
      expect(result.actualCapacityIndex).toBeCloseTo(result.presentedCapacityIndex!, 5);
      expect(result.relativePerformance).toBeCloseTo(0, 5);
    });

    it('exact target with equal explicit RPE succeeds without extra capacity credit', () => {
      const input = makeBaseContext({ rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_EXACT');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.rpeSource).toBe('explicit');
      expect(result.relativePerformance).toBeCloseTo(0, 5);
    });

    it('exact target at RPE -0.5 succeeds and earns extra capacity credit', () => {
      const input = makeBaseContext({ rpe: 7.5 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_OVERPERFORMANCE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(true);
      expect(result.rpeSource).toBe('explicit');
      expect(result.actualCapacityIndex).toBeGreaterThan(result.presentedCapacityIndex!);
      expect(result.relativePerformance).toBeGreaterThan(0);
    });

    it('exact target at RPE -1.0 succeeds and earns extra capacity credit', () => {
      const input = makeBaseContext({ rpe: 7.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_OVERPERFORMANCE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(true);
      expect(result.rpeSource).toBe('explicit');
      expect(result.relativePerformance).toBeGreaterThan(0);
    });

    it('exact target at RPE +0.5 succeeds with tolerated exertion and no extra credit', () => {
      const input = makeBaseContext({ rpe: 8.5 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_TOLERATED_EXERTION');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.rpeSource).toBe('explicit');
      expect(result.actualCapacityIndex).toBeLessThan(result.presentedCapacityIndex!);
      expect(result.relativePerformance).toBeLessThan(0);
    });

    it('exact target at RPE +1.0 produces a marginal miss due to exertion overshoot', () => {
      const input = makeBaseContext({ rpe: 9.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('marginal_miss');
      expect(result.reason).toBe('MARGINAL_MISS_EXERTION_OVERSHOOT');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.rpeSource).toBe('explicit');
      expect(result.relativePerformance).toBeLessThan(0);
    });

    it('exact target at RPE +1.5 produces a substantial miss due to severe exertion', () => {
      const input = makeBaseContext({ rpe: 9.5 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('substantial_miss');
      expect(result.reason).toBe('SUBSTANTIAL_MISS_SEVERE_EXERTION');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.rpeSource).toBe('explicit');
    });

    it('one rep short with exact load and matching RPE produces marginal miss', () => {
      const input = makeBaseContext({ reps: 7, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('marginal_miss');
      expect(result.reason).toBe('MARGINAL_MISS_REPS');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.relativePerformance).toBeLessThan(0);
    });

    it('one rep short with missing RPE produces marginal miss', () => {
      const input = makeBaseContext({ reps: 7, rpe: null });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('marginal_miss');
      expect(result.reason).toBe('MARGINAL_MISS_REPS');
      expect(result.targetAchieved).toBe(false);
      expect(result.rpeSource).toBe('presented_target_imputation');
    });

    it('two reps short produces substantial miss', () => {
      const input = makeBaseContext({ reps: 6, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('substantial_miss');
      expect(result.reason).toBe('SUBSTANTIAL_MISS_REPS');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
    });

    it('load shortfall of exactly 5.0% produces marginal miss', () => {
      // 80 kg * 0.95 = 76 kg
      const input = makeBaseContext({ weight: 76, reps: 8, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('marginal_miss');
      expect(result.reason).toBe('MARGINAL_MISS_LOAD');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.actualComparisonLoadKg).toBe(76);
    });

    it('load shortfall immediately above 5.0% produces substantial miss', () => {
      // 80 kg * (1 - 0.051) = 75.92 kg (5.1% shortfall)
      const input = makeBaseContext({ weight: 75.9, reps: 8, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('substantial_miss');
      expect(result.reason).toBe('SUBSTANTIAL_MISS_LOAD');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
    });

    it('both load and reps short produces substantial miss with multiple factors', () => {
      const input = makeBaseContext({ weight: 78, reps: 7, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('substantial_miss');
      expect(result.reason).toBe('SUBSTANTIAL_MISS_MULTIPLE_FACTORS');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
    });

    it('higher reps at equal explicit RPE earns capacity credit', () => {
      const input = makeBaseContext({ reps: 9, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_OVERPERFORMANCE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(true);
      expect(result.relativePerformance).toBeGreaterThan(0);
    });

    it('higher load at equal explicit RPE earns capacity credit', () => {
      const input = makeBaseContext({ weight: 82.5, reps: 8, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_OVERPERFORMANCE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(true);
      expect(result.relativePerformance).toBeGreaterThan(0);
    });

    it('lower RPE at exact load and reps earns capacity credit', () => {
      const input = makeBaseContext({ weight: 80, reps: 8, rpe: 7.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_OVERPERFORMANCE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(true);
    });

    it('higher reps without RPE succeeds but receives no extra credit', () => {
      const input = makeBaseContext({ reps: 9, rpe: null });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_WITHOUT_RPE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.rpeSource).toBe('presented_target_imputation');
    });

    it('higher load without RPE succeeds but receives no extra credit', () => {
      const input = makeBaseContext({ weight: 85, reps: 8, rpe: null });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_WITHOUT_RPE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.rpeSource).toBe('presented_target_imputation');
    });

    it('higher work at RPE +0.5 only earns credit when actual calculated capacity exceeds presented capacity', () => {
      // Case A: 80 kg x 8 @ 8.0 -> presented capacity index = 80 / getRpePercentage(8.0, 8)
      // Performed: 80 kg x 8 @ 8.5 -> capacity index decreases -> tolerated exertion, no extra credit
      const inputTolerated = makeBaseContext({ weight: 80, reps: 8, rpe: 8.5 });
      const resTolerated = classifyGuidedSetOutcome(inputTolerated);
      expect(resTolerated.outcome).toBe('success');
      expect(resTolerated.reason).toBe('TARGET_ACHIEVED_TOLERATED_EXERTION');
      expect(resTolerated.extraCapacityCreditEligible).toBe(false);

      // Case B: 87.5 kg x 8 @ 8.5 -> capacity index exceeds presented capacity index!
      const inputOverperf = makeBaseContext({ weight: 87.5, reps: 8, rpe: 8.5 });
      const resOverperf = classifyGuidedSetOutcome(inputOverperf);
      expect(resOverperf.outcome).toBe('success');
      expect(resOverperf.reason).toBe('TARGET_ACHIEVED_OVERPERFORMANCE');
      expect(resOverperf.extraCapacityCreditEligible).toBe(true);
    });

    it('invalid noncanonical RPE fails closed as ineligible', () => {
      const input = makeBaseContext({ rpe: 8.3 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_ACTUAL_RPE');
    });
  });

  describe('Bodyweight Modality Outcomes', () => {
    function makeBodyweightContext(
      setOverrides?: Partial<SetEntry>,
      exerciseOverrides?: Partial<ExerciseEntry>,
      workoutOverrides?: Partial<WorkoutLog>
    ): ClassifyGuidedSetOutcomeInput {
      const snapshot = makeBaseSnapshot({
        modality: 'bodyweight',
        loadBasis: 'bodyweight_normalized_v1',
        baseWeight: 0,
        baseReps: 10,
        baseRpe: 8.0,
        presentedWeight: 0,
        presentedReps: 10,
        presentedRpe: 8.0,
        comparisonLoadKg: 75, // 75 kg bodyweight
      });

      const set: SetEntry = {
        setNumber: 1,
        weight: null,
        reps: 10,
        rpe: 8.0,
        isCompleted: true,
        prescriptionSnapshot: snapshot,
        ...setOverrides,
      };

      const exercise: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        exerciseKey: 'barbell_bench_press', // match snapshot
        modality: 'bodyweight',
        sets: [set],
        ...exerciseOverrides,
      };

      const workout: WorkoutLog = {
        id: 'log-bw',
        date: '2026-09-03',
        programId: 'program-1',
        program: 'Guided Calisthenics',
        unit: 'kg',
        bodyweightSnapshot: { value: 75, unit: 'kg' },
        exercises: [exercise],
        ...workoutOverrides,
      };

      return { set, exercise, workout };
    }

    it('exact reps without RPE on bodyweight succeeds without extra credit', () => {
      const input = makeBodyweightContext({ rpe: null });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_WITHOUT_RPE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.actualComparisonLoadKg).toBe(75);
    });

    it('explicit-RPE overperformance on bodyweight succeeds and earns extra credit', () => {
      const input = makeBodyweightContext({ reps: 11, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_OVERPERFORMANCE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(true);
    });

    it('one rep short on bodyweight produces marginal miss', () => {
      const input = makeBodyweightContext({ reps: 9, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('marginal_miss');
      expect(result.reason).toBe('MARGINAL_MISS_REPS');
      expect(result.targetAchieved).toBe(false);
    });

    it('two reps short on bodyweight produces substantial miss', () => {
      const input = makeBodyweightContext({ reps: 8, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('substantial_miss');
      expect(result.reason).toBe('SUBSTANTIAL_MISS_REPS');
      expect(result.targetAchieved).toBe(false);
    });

    it('missing bodyweight snapshot is rejected as ineligible', () => {
      const input = makeBodyweightContext({}, {}, { bodyweightSnapshot: null });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_ACTUAL_LOAD');
    });

    it('invalid bodyweight snapshot (zero or negative) is rejected as ineligible', () => {
      const input = makeBodyweightContext(
        {},
        {},
        { bodyweightSnapshot: { value: 0, unit: 'kg' } }
      );
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_ACTUAL_LOAD');
    });

    it('nonzero external weight on pure bodyweight set is rejected as ineligible', () => {
      const input = makeBodyweightContext({ weight: 10 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_ACTUAL_LOAD');
    });

    it('bodyweight normalized through lb inputs is handled correctly', () => {
      // 165.3466966 lb = 75 kg
      const input = makeBodyweightContext(
        {},
        {},
        {
          unit: 'lb',
          bodyweightSnapshot: { value: 165.3466966, unit: 'lb' },
        }
      );
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.actualComparisonLoadKg).toBeCloseTo(75, 4);
    });
  });

  describe('Assisted Modality Outcomes', () => {
    function makeAssistedContext(
      setOverrides?: Partial<SetEntry>,
      exerciseOverrides?: Partial<ExerciseEntry>,
      workoutOverrides?: Partial<WorkoutLog>
    ): ClassifyGuidedSetOutcomeInput {
      // Bodyweight: 80 kg, Assist: 20 kg -> net comparison load: 60 kg
      const snapshot = makeBaseSnapshot({
        modality: 'assisted',
        loadBasis: 'assisted_net_normalized_v1',
        baseWeight: 20,
        baseReps: 10,
        baseRpe: 8.0,
        presentedWeight: 20,
        presentedReps: 10,
        presentedRpe: 8.0,
        comparisonLoadKg: 60,
      });

      const set: SetEntry = {
        setNumber: 1,
        weight: 20, // 20 kg assistance
        reps: 10,
        rpe: 8.0,
        isCompleted: true,
        prescriptionSnapshot: snapshot,
        ...setOverrides,
      };

      const exercise: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        exerciseKey: 'barbell_bench_press',
        modality: 'assisted',
        sets: [set],
        ...exerciseOverrides,
      };

      const workout: WorkoutLog = {
        id: 'log-assisted',
        date: '2026-09-03',
        programId: 'program-1',
        program: 'Guided Gymnastics',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [exercise],
        ...workoutOverrides,
      };

      return { set, exercise, workout };
    }

    it('exact assistance and reps succeeds', () => {
      const input = makeAssistedContext({ rpe: null });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_WITHOUT_RPE');
      expect(result.actualComparisonLoadKg).toBe(60);
      expect(result.presentedComparisonLoadKg).toBe(60);
      expect(result.extraCapacityCreditEligible).toBe(false);
    });

    it('increased assistance producing exactly a 5.0% net-load shortfall yields marginal miss', () => {
      // Target net load = 60 kg. 5% shortfall -> net load = 57 kg.
      // Assist needed for 57 kg net load: 80 - 57 = 23 kg.
      const input = makeAssistedContext({ weight: 23, reps: 10, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('marginal_miss');
      expect(result.reason).toBe('MARGINAL_MISS_LOAD');
      expect(result.actualComparisonLoadKg).toBe(57);
      expect(result.targetAchieved).toBe(false);
    });

    it('increased assistance producing a shortfall above 5.0% yields substantial miss', () => {
      // Assist: 25 kg -> net load: 55 kg. Shortfall: (60 - 55) / 60 = 5/60 = 8.33% > 5.0%.
      const input = makeAssistedContext({ weight: 25, reps: 10, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('substantial_miss');
      expect(result.reason).toBe('SUBSTANTIAL_MISS_LOAD');
      expect(result.targetAchieved).toBe(false);
    });

    it('reduced assistance with explicit RPE demonstrates additional capacity and earns credit', () => {
      // Assist: 15 kg -> net load: 65 kg > 60 kg.
      const input = makeAssistedContext({ weight: 15, reps: 10, rpe: 8.0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_OVERPERFORMANCE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(true);
      expect(result.actualComparisonLoadKg).toBe(65);
    });

    it('reduced assistance without RPE succeeds but receives no bonus credit', () => {
      const input = makeAssistedContext({ weight: 15, reps: 10, rpe: null });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.reason).toBe('TARGET_ACHIEVED_WITHOUT_RPE');
      expect(result.targetAchieved).toBe(true);
      expect(result.extraCapacityCreditEligible).toBe(false);
    });

    it('zero assistance on assisted modality is rejected as ineligible', () => {
      const input = makeAssistedContext({ weight: 0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_ACTUAL_LOAD');
    });

    it('assistance equal to bodyweight is rejected as ineligible', () => {
      const input = makeAssistedContext({ weight: 80 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_ACTUAL_LOAD');
    });

    it('assistance greater than bodyweight is rejected as ineligible', () => {
      const input = makeAssistedContext({ weight: 85 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('INVALID_ACTUAL_LOAD');
    });

    it('kg and lb normalization handles assisted calculations correctly', () => {
      // Bodyweight: 176.3698097 lb (= 80 kg). Assist: 44.0924524 lb (= 20 kg).
      // Net load in kg = 60 kg.
      const input = makeAssistedContext(
        { weight: 44.0924524 },
        {},
        {
          unit: 'lb',
          bodyweightSnapshot: { value: 176.3698097, unit: 'lb' },
        }
      );
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('success');
      expect(result.actualComparisonLoadKg).toBeCloseTo(60, 3);
    });
  });

  describe('Neutral and Ineligible Precedence', () => {
    it('skipped exercise without snapshot remains neutral', () => {
      const input = makeBaseContext(
        { prescriptionSnapshot: undefined },
        { isSkipped: true }
      );
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('neutral');
      expect(result.reason).toBe('SKIPPED_EXERCISE');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.rpeSource).toBeNull();
    });

    it('skipped set without snapshot remains neutral', () => {
      const input = makeBaseContext(
        { isSkipped: true, prescriptionSnapshot: undefined }
      );
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('neutral');
      expect(result.reason).toBe('SKIPPED_SET');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
    });

    it('warmup set is excluded as ineligible before snapshot validation', () => {
      const input = makeBaseContext({ isWarmup: true });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('WARMUP_SET_EXCLUDED');
    });

    it('drop set is excluded as ineligible', () => {
      const input = makeBaseContext({ isDropSet: true });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('DROP_SET_EXCLUDED');
    });

    it('drop-subset container is excluded as ineligible', () => {
      const input = makeBaseContext({
        dropSubSets: [{ weight: 60, reps: 5 }],
      });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('DROP_SET_EXCLUDED');
    });

    it('loose form set is excluded as ineligible', () => {
      const input = makeBaseContext({ form: 'loose' });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('LOOSE_FORM_EXCLUDED');
    });

    it('one-off workout is excluded as ineligible', () => {
      const input = makeBaseContext({}, {}, { program: 'One Off' });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('ONE_OFF_WORKOUT_EXCLUDED');
    });

    it('workout without valid programId is excluded as ineligible', () => {
      const input = makeBaseContext({}, {}, { programId: undefined });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('ONE_OFF_WORKOUT_EXCLUDED');
    });

    it('missing snapshot is rejected as ineligible', () => {
      const input = makeBaseContext({ prescriptionSnapshot: undefined });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('MISSING_SNAPSHOT');
    });

    it('performance-led snapshot mode is rejected as ineligible', () => {
      const input = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({
          progressionMode: 'performance_led' as any,
        }),
      });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('NON_GUIDED_MODE');
    });

    it('snapshot version mismatch is rejected as ineligible', () => {
      const input = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({
          snapshotVersion: 99 as any,
        }),
      });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('SNAPSHOT_VERSION_MISMATCH');
    });

    it('policy version mismatch is rejected as ineligible', () => {
      const input = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({
          progressionPolicyVersion: 99 as any,
        }),
      });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('POLICY_VERSION_MISMATCH');
    });

    it('algorithm version mismatch is rejected as ineligible', () => {
      const input = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({
          algorithmVersion: 99 as any,
        }),
      });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('ALGORITHM_VERSION_MISMATCH');
    });

    it('exercise key mismatch is rejected as ineligible', () => {
      const input = makeBaseContext(
        {
          prescriptionSnapshot: makeBaseSnapshot({
            exerciseKey: 'dumbbell_press',
          }),
        },
        { exerciseKey: 'barbell_bench_press' }
      );
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('EXERCISE_KEY_MISMATCH');
    });

    it('modality mismatch between snapshot and exercise is rejected as ineligible', () => {
      const input = makeBaseContext(
        {
          prescriptionSnapshot: makeBaseSnapshot({
            modality: 'weighted',
          }),
        },
        { modality: 'bodyweight' }
      );
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('MODALITY_MISMATCH');
    });

    it('load basis mismatch is rejected as ineligible', () => {
      const input = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({
          modality: 'weighted',
          loadBasis: 'bodyweight_normalized_v1' as any,
        }),
      });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('LOAD_BASIS_MISMATCH');
    });

    it('unsupported modality in snapshot is rejected as ineligible', () => {
      const input = makeBaseContext(
        {
          prescriptionSnapshot: makeBaseSnapshot({
            modality: 'timed' as any,
          }),
        },
        { modality: 'timed' as any }
      );
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('UNSUPPORTED_MODALITY');
    });

    it('missing isCompleted field on snapshot-bearing set is rejected as ineligible', () => {
      const input = makeBaseContext({ isCompleted: undefined });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('ineligible');
      expect(result.reason).toBe('MISSING_COMPLETION_STATUS');
    });

    it('isCompleted === false produces a substantial miss', () => {
      const input = makeBaseContext({ isCompleted: false, reps: 0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('substantial_miss');
      expect(result.reason).toBe('UNCOMPLETED_SET');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
      expect(result.presentedComparisonLoadKg).toBe(80);
    });

    it('zero reps on completed set produces substantial miss', () => {
      const input = makeBaseContext({ reps: 0 });
      const result = classifyGuidedSetOutcome(input);

      expect(result.outcome).toBe('substantial_miss');
      expect(result.reason).toBe('ZERO_REPS_PERFORMED');
      expect(result.targetAchieved).toBe(false);
      expect(result.extraCapacityCreditEligible).toBe(false);
    });

    it('negative or non-integer reps is rejected as ineligible', () => {
      const inputNeg = makeBaseContext({ reps: -2 });
      expect(classifyGuidedSetOutcome(inputNeg).reason).toBe('INVALID_PERFORMANCE_REPS');

      const inputFrac = makeBaseContext({ reps: 7.5 });
      expect(classifyGuidedSetOutcome(inputFrac).reason).toBe('INVALID_PERFORMANCE_REPS');
    });

    it('malformed snapshot prescription fields fail closed as ineligible', () => {
      const inputBadReps = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ presentedReps: 0 }),
      });
      expect(classifyGuidedSetOutcome(inputBadReps).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');

      const inputBadRpe = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ presentedRpe: 11.5 }),
      });
      expect(classifyGuidedSetOutcome(inputBadRpe).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');

      const inputBadLoad = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ comparisonLoadKg: -10 }),
      });
      expect(classifyGuidedSetOutcome(inputBadLoad).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');

      const inputBadOrdinal = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ workingSetOrdinal: 0 }),
      });
      expect(classifyGuidedSetOutcome(inputBadOrdinal).reason).toBe('INVALID_WORKING_SET_ORDINAL');

      const inputOrdinalExceedsCount = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ workingSetOrdinal: 2, prescribedWorkingSetCount: 1 }),
      });
      expect(classifyGuidedSetOutcome(inputOrdinalExceedsCount).reason).toBe('INVALID_WORKING_SET_ORDINAL');

      // Invalid prescribedWorkingSetCount values
      const inputCountZero = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ prescribedWorkingSetCount: 0 }),
      });
      expect(classifyGuidedSetOutcome(inputCountZero).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');

      const inputCountNeg = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ prescribedWorkingSetCount: -1 }),
      });
      expect(classifyGuidedSetOutcome(inputCountNeg).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');

      const inputCountFrac = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ prescribedWorkingSetCount: 2.5 }),
      });
      expect(classifyGuidedSetOutcome(inputCountFrac).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');

      const inputCountNaN = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ prescribedWorkingSetCount: NaN }),
      });
      expect(classifyGuidedSetOutcome(inputCountNaN).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');

      const inputCountInf = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ prescribedWorkingSetCount: Infinity }),
      });
      expect(classifyGuidedSetOutcome(inputCountInf).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');

      const inputCountNull = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ prescribedWorkingSetCount: null as any }),
      });
      expect(classifyGuidedSetOutcome(inputCountNull).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');

      const inputCountUndef = makeBaseContext({
        prescriptionSnapshot: makeBaseSnapshot({ prescribedWorkingSetCount: undefined as any }),
      });
      expect(classifyGuidedSetOutcome(inputCountUndef).reason).toBe('INVALID_SNAPSHOT_PRESCRIPTION');
    });
  });

  describe('Purity and Immutability', () => {
    it('inputs remain deeply equal and unmutated after evaluation', () => {
      const input = makeBaseContext({ weight: 80, reps: 8, rpe: 8.0 });
      const inputCopy = JSON.parse(JSON.stringify(input));

      classifyGuidedSetOutcome(input);

      expect(input).toEqual(inputCopy);
    });

    it('repeated evaluations with identical inputs return deeply equal results', () => {
      const input = makeBaseContext({ weight: 82.5, reps: 9, rpe: 8.5 });

      const res1 = classifyGuidedSetOutcome(input);
      const res2 = classifyGuidedSetOutcome(input);

      expect(res1).toEqual(res2);
    });

    it('performs zero localStorage reads or writes', () => {
      const getItemSpy = vi.spyOn(globalThis.localStorage, 'getItem');
      const setItemSpy = vi.spyOn(globalThis.localStorage, 'setItem');

      const input = makeBaseContext();
      classifyGuidedSetOutcome(input);

      expect(getItemSpy).not.toHaveBeenCalled();
      expect(setItemSpy).not.toHaveBeenCalled();

      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    });

    it('operates with zero DOM dependency', () => {
      // Execute in an environment where window/document are undefined or not accessed
      const input = makeBaseContext();
      expect(() => classifyGuidedSetOutcome(input)).not.toThrow();
    });
  });
});
