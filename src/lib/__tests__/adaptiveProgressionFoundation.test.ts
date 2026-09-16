import { describe, it, expect } from 'vitest';
import {
  resolveProgramProgressionMode,
  resolveProgramProgressionPolicyVersion,
  resolveProgramAlgorithmVersion,
  resolveProgramUnit,
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
} from '../programProgressionMode';
import { createProgramContinuation } from '../programContinuation';
import {
  Program,
  ExerciseEntry,
  SetEntry,
  PrescriptionSnapshot,
  TargetProgressionMode,
  ExerciseModality,
  ExerciseProgressionRole,
  ProgressionLoadBasis,
  ProgressionNudgeType,
  WeightUnit,
} from '../../types';

describe('Adaptive Progression Foundation (APC-3A1)', () => {
  describe('Constants Verification', () => {
    it('defines standard current version constants', () => {
      expect(CURRENT_PRESCRIPTION_SNAPSHOT_VERSION).toBe(2);
      expect(CURRENT_PROGRESSION_POLICY_VERSION).toBe(1);
      expect(CURRENT_ALGORITHM_VERSION).toBe(1);
    });
  });

  describe('resolveProgramProgressionMode', () => {
    it('resolves explicit performance_led mode', () => {
      const program: Partial<Program> = { targetProgressionMode: 'performance_led' };
      expect(resolveProgramProgressionMode(program)).toBe('performance_led');
    });

    it('resolves explicit metreps_guided mode', () => {
      const program: Partial<Program> = { targetProgressionMode: 'metreps_guided' };
      expect(resolveProgramProgressionMode(program)).toBe('metreps_guided');
    });

    it('resolves missing targetProgressionMode to performance_led', () => {
      expect(resolveProgramProgressionMode(undefined)).toBe('performance_led');
      expect(resolveProgramProgressionMode(null)).toBe('performance_led');
      expect(resolveProgramProgressionMode({})).toBe('performance_led');
      expect(resolveProgramProgressionMode({ id: 'prog-1', name: 'Legacy' })).toBe('performance_led');
    });

    it('resolves malformed or unexpected runtime values to performance_led', () => {
      const malformed1 = { targetProgressionMode: 'auto' as unknown as TargetProgressionMode };
      const malformed2 = { targetProgressionMode: 'GUIDED' as unknown as TargetProgressionMode };
      const malformed3 = { targetProgressionMode: 123 as unknown as TargetProgressionMode };
      expect(resolveProgramProgressionMode(malformed1)).toBe('performance_led');
      expect(resolveProgramProgressionMode(malformed2)).toBe('performance_led');
      expect(resolveProgramProgressionMode(malformed3)).toBe('performance_led');
    });
  });

  describe('resolveProgramProgressionPolicyVersion & resolveProgramAlgorithmVersion', () => {
    it('preserves valid non-negative integer versions', () => {
      expect(resolveProgramProgressionPolicyVersion({ progressionPolicyVersion: 1 })).toBe(1);
      expect(resolveProgramProgressionPolicyVersion({ progressionPolicyVersion: 2 })).toBe(2);
      expect(resolveProgramProgressionPolicyVersion({ progressionPolicyVersion: 0 })).toBe(0);

      expect(resolveProgramAlgorithmVersion({ algorithmVersion: 1 })).toBe(1);
      expect(resolveProgramAlgorithmVersion({ algorithmVersion: 3 })).toBe(3);
      expect(resolveProgramAlgorithmVersion({ algorithmVersion: 0 })).toBe(0);
    });

    it('resolves missing and invalid versions to 0 (legacy Performance-Led)', () => {
      expect(resolveProgramProgressionPolicyVersion(undefined)).toBe(0);
      expect(resolveProgramProgressionPolicyVersion(null)).toBe(0);
      expect(resolveProgramProgressionPolicyVersion({})).toBe(0);
      expect(resolveProgramProgressionPolicyVersion({ progressionPolicyVersion: -1 })).toBe(0);
      expect(resolveProgramProgressionPolicyVersion({ progressionPolicyVersion: 1.5 })).toBe(0);
      expect(resolveProgramProgressionPolicyVersion({ progressionPolicyVersion: NaN })).toBe(0);
      expect(resolveProgramProgressionPolicyVersion({ progressionPolicyVersion: Infinity })).toBe(0);

      expect(resolveProgramAlgorithmVersion(undefined)).toBe(0);
      expect(resolveProgramAlgorithmVersion(null)).toBe(0);
      expect(resolveProgramAlgorithmVersion({})).toBe(0);
      expect(resolveProgramAlgorithmVersion({ algorithmVersion: -2 })).toBe(0);
      expect(resolveProgramAlgorithmVersion({ algorithmVersion: 2.2 })).toBe(0);
      expect(resolveProgramAlgorithmVersion({ algorithmVersion: NaN })).toBe(0);
      expect(resolveProgramAlgorithmVersion({ algorithmVersion: -Infinity })).toBe(0);
    });
  });

  describe('resolveProgramUnit', () => {
    it('returns stored kg or lb unit when present', () => {
      expect(resolveProgramUnit({ unit: 'kg' }, 'lb')).toBe('kg');
      expect(resolveProgramUnit({ unit: 'lb' }, 'kg')).toBe('lb');
    });

    it('normalizes legacy lbs string to lb', () => {
      const programWithLbs = { unit: 'lbs' as unknown as WeightUnit };
      expect(resolveProgramUnit(programWithLbs, 'kg')).toBe('lb');
    });

    it('falls back to the supplied legacy fallback when unit is missing or invalid', () => {
      expect(resolveProgramUnit(undefined, 'kg')).toBe('kg');
      expect(resolveProgramUnit(null, 'lb')).toBe('lb');
      expect(resolveProgramUnit({}, 'kg')).toBe('kg');
      expect(resolveProgramUnit({ unit: undefined }, 'lb')).toBe('lb');
      expect(resolveProgramUnit({ unit: 'invalid' as unknown as WeightUnit }, 'kg')).toBe('kg');
    });
  });

  describe('Program Continuation Metadata Inheritance', () => {
    const guidedSourceProgram: Program = {
      id: 'prog-guided-100',
      name: 'Upper Lower Guided',
      daysPerWeek: 4,
      programDuration: 8,
      createdAt: '2026-03-01T00:00:00.000Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      targetProgressionMode: 'metreps_guided',
      progressionPolicyVersion: 1,
      algorithmVersion: 1,
      unit: 'kg',
      exercisesByDay: {
        1: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            exerciseKey: 'barbell_bench_press',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 80, reps: 8, rpe: 8 }],
          },
        ],
      },
    };

    const legacySourceProgram: Program = {
      id: 'prog-legacy-200',
      name: 'Classic Full Body',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-01-01T00:00:00.000Z',
      objective: 'Strength',
      algorithmId: 'hypertrophy_step',
      exercisesByDay: {
        1: [
          {
            name: 'Back Squat',
            muscleGroup: 'Quads',
            sets: [{ setNumber: 1, weight: 100, reps: 5, rpe: 8 }],
          },
        ],
      },
    };

    it('inherits targetProgressionMode, progressionPolicyVersion, algorithmVersion, and unit for Guided source', () => {
      const continuation = createProgramContinuation(guidedSourceProgram);

      expect(continuation.targetProgressionMode).toBe('metreps_guided');
      expect(continuation.progressionPolicyVersion).toBe(1);
      expect(continuation.algorithmVersion).toBe(1);
      expect(continuation.unit).toBe('kg');

      expect(resolveProgramProgressionMode(continuation)).toBe('metreps_guided');
      expect(resolveProgramProgressionPolicyVersion(continuation)).toBe(1);
      expect(resolveProgramAlgorithmVersion(continuation)).toBe(1);
      expect(resolveProgramUnit(continuation, 'lb')).toBe('kg');
    });

    it('preserves undefined metadata on legacy source and resolves safely to Performance-Led / version 0', () => {
      const continuation = createProgramContinuation(legacySourceProgram);

      expect(continuation.targetProgressionMode).toBeUndefined();
      expect(continuation.progressionPolicyVersion).toBeUndefined();
      expect(continuation.algorithmVersion).toBeUndefined();
      expect(continuation.unit).toBeUndefined();

      expect(resolveProgramProgressionMode(continuation)).toBe('performance_led');
      expect(resolveProgramProgressionPolicyVersion(continuation)).toBe(0);
      expect(resolveProgramAlgorithmVersion(continuation)).toBe(0);
      expect(resolveProgramUnit(continuation, 'kg')).toBe('kg');
    });

    it('ensures source program remains completely immutable during continuation', () => {
      const guidedFrozen = JSON.parse(JSON.stringify(guidedSourceProgram));
      const legacyFrozen = JSON.parse(JSON.stringify(legacySourceProgram));

      createProgramContinuation(guidedSourceProgram);
      createProgramContinuation(legacySourceProgram);

      expect(guidedSourceProgram).toEqual(guidedFrozen);
      expect(legacySourceProgram).toEqual(legacyFrozen);
    });

    it('preserves existing continuation lineage, naming, and phase offsets', () => {
      const continuation = createProgramContinuation(legacySourceProgram);

      expect(continuation.parentProgramId).toBe('prog-legacy-200');
      expect(continuation.cycleIndex).toBe(2);
      expect(continuation.name).toBe('Classic Full Body — Cycle 2');
      expect(continuation.algorithmPhaseOffset).toBe(8); // (0 + 8) % 12
    });
  });

  describe('Type System Contract & Optionality Invariants', () => {
    it('accepts legacy Program, ExerciseEntry, and SetEntry without new fields', () => {
      const legacySet: SetEntry = {
        setNumber: 1,
        weight: 100,
        reps: 10,
        rpe: 8,
      };

      const legacyExercise: ExerciseEntry = {
        name: 'Pull Up',
        muscleGroup: 'Back',
        sets: [legacySet],
      };

      const legacyProg: Program = {
        id: 'legacy-p',
        name: 'Legacy Routine',
        daysPerWeek: 3,
        programDuration: 6,
        createdAt: '2026-01-01',
        exercisesByDay: { 1: [legacyExercise] },
      };

      expect(legacySet.prescriptionSnapshot).toBeUndefined();
      expect(legacyExercise.exerciseKey).toBeUndefined();
      expect(legacyProg.targetProgressionMode).toBeUndefined();
      expect(legacyProg.progressionPolicyVersion).toBeUndefined();
      expect(legacyProg.algorithmVersion).toBeUndefined();
      expect(legacyProg.unit).toBeUndefined();
    });

    it('verifies complete PrescriptionSnapshot type adherence with all required fields', () => {
      const snapshot: PrescriptionSnapshot = {
        snapshotVersion: 2,
        progressionPolicyVersion: 1,
        algorithmVersion: 1,
        progressionMode: 'metreps_guided',
        algorithmId: 'hypertrophy_linear',
        exerciseKey: 'barbell_bench_press',
        exerciseRole: 'main_movement',
        modality: 'weighted',
        comparableLaneKey: 'barbell_bench_press:weighted',
        workingSetOrdinal: 1,
        prescribedWorkingSetCount: 3,
        baseWeight: 80,
        baseReps: 8,
        baseRpe: 8,
        presentedWeight: 82.5,
        presentedReps: 8,
        presentedRpe: 8,
        bodyweightSnapshot: 80,
        weightUnit: 'kg',
        comparisonLoadKg: 82.5,
        loadBasis: 'external_weight_v1',
        loadIncrement: 2.5,
        nudgeType: 'load_nudge',
        coachingReasonCode: 'LOAD_NUDGE_MAIN_MOVEMENT',
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        successCreditEligible: true,
        rollbackTarget: {
          weight: 80,
          reps: 8,
          rpe: 8,
          comparisonLoadKg: 80,
        },
      };

      expect(snapshot.snapshotVersion).toBe(2);
      expect(snapshot.progressionMode).toBe('metreps_guided');
      expect(snapshot.algorithmId).toBe('hypertrophy_linear');
      expect(snapshot.exerciseRole).toBe('main_movement');
      expect(snapshot.modality).toBe('weighted');
      expect(snapshot.loadBasis).toBe('external_weight_v1');
      expect(snapshot.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
      expect(snapshot.confirmedStepIndexBefore).toBe(0);
      expect(snapshot.presentedStepIndex).toBe(1);
      expect(snapshot.successCreditEligible).toBe(true);
      expect(snapshot.rollbackTarget).toEqual({
        weight: 80,
        reps: 8,
        rpe: 8,
        comparisonLoadKg: 80,
      });
    });
  });
});
