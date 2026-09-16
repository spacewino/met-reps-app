import { describe, it, expect, vi } from 'vitest';
import * as objectiveMathModule from '../objectiveMath';
import {
  calculateObjectivePrescriptionBundle,
  calculateObjectiveSets,
} from '../objectiveMath';
import { ExerciseEntry, WorkoutLog, BodyweightSnapshot } from '../../types';

describe('Atomic Objective-Prescription Bundle', () => {
  const snapshot: BodyweightSnapshot = {
    value: 80,
    unit: 'kg',
    timestamp: new Date().toISOString(),
  };

  const sampleLog: WorkoutLog = {
    id: 'log-1',
    date: '2026-01-01',
    programId: 'prog-1',
    day: '1',
    unit: 'kg',
    bodyweightSnapshot: snapshot,
    exercises: [
      {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8.5, form: 'standard' },
          { setNumber: 3, weight: 100, reps: 9, rpe: 9, form: 'standard' },
        ],
      },
      {
        name: 'Pull Up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        movementCategory: 'compound',
        sets: [
          { setNumber: 1, weight: 0, reps: 8, rpe: 8, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 8, rpe: 8.5, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 7, rpe: 9, form: 'standard' },
        ],
      },
      {
        name: 'Assisted Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        movementCategory: 'compound',
        equipment: 'machine',
        sets: [
          { setNumber: 1, weight: 20, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 2, weight: 20, reps: 10, rpe: 8.5, form: 'standard' },
        ],
      },
    ],
  };

  describe('1. Parity Contract: calculateObjectiveSets delegates cleanly to bundle.baseSets', () => {
    it('matches baseSets for Hypertrophy Linear with warmups and working sets', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0, isWarmup: true },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0, isWarmup: true },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 4, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 5, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      const params: objectiveMathModule.CalculateObjectiveSetsParams = {
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [sampleLog],
        activeUnit: 'kg',
      };

      const bundle = calculateObjectivePrescriptionBundle(params);
      const sets = calculateObjectiveSets(params);

      expect(sets).toEqual(bundle.baseSets);
      expect(bundle.baseSets).toHaveLength(5);
      expect(bundle.baseSets[0].isWarmup).toBe(true);
      expect(bundle.baseSets[2].weight).toBeGreaterThan(0);
    });

    it('matches baseSets when user-touched and checked sets are protected', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 120, reps: 5, rpe: 9.5 },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 3, weight: 110, reps: 6, rpe: 9 },
        ],
      };

      const params: objectiveMathModule.CalculateObjectiveSetsParams = {
        objective: 'Hypertrophy',
        exercise: ex,
        exerciseIndex: 0,
        weekNum: 2,
        programDuration: 8,
        algorithmId: 'hypertrophy_step',
        previousLogs: [sampleLog],
        userTouchedSets: { '0-0': true },
        checkedSets: { '0-2': true },
      };

      const bundle = calculateObjectivePrescriptionBundle(params);
      const sets = calculateObjectiveSets(params);

      expect(sets).toEqual(bundle.baseSets);
      // Touched set 1 preserved
      expect(bundle.baseSets[0].weight).toBe(120);
      expect(bundle.baseSets[0].reps).toBe(5);
      // Checked set 3 preserved
      expect(bundle.baseSets[2].weight).toBe(110);
      expect(bundle.baseSets[2].reps).toBe(6);
      // Untouched set 2 generated
      expect(bundle.baseSets[1].weight).toBeGreaterThan(0);
    });

    it('matches baseSets across Deload, Off, and Zero-Baseline conditions', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      // Off
      const offParams: objectiveMathModule.CalculateObjectiveSetsParams = {
        objective: 'Off',
        exercise: ex,
        weekNum: 1,
      };
      expect(calculateObjectiveSets(offParams)).toEqual(calculateObjectivePrescriptionBundle(offParams).baseSets);

      // Deload
      const deloadParams: objectiveMathModule.CalculateObjectiveSetsParams = {
        objective: 'Deload',
        exercise: ex,
        weekNum: 4,
        previousLogs: [sampleLog],
      };
      expect(calculateObjectiveSets(deloadParams)).toEqual(calculateObjectivePrescriptionBundle(deloadParams).baseSets);

      // Zero-baseline
      const zeroParams: objectiveMathModule.CalculateObjectiveSetsParams = {
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
      };
      expect(calculateObjectiveSets(zeroParams)).toEqual(calculateObjectivePrescriptionBundle(zeroParams).baseSets);
    });
  });

  describe('2. SessionAnchor Fidelity and Authority', () => {
    it('provides authoritative SessionAnchor for weighted prescribed exercise', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      const bundle = calculateObjectivePrescriptionBundle({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [sampleLog],
      });

      expect(bundle.sessionAnchor).not.toBeNull();
      const anchor = bundle.sessionAnchor!;
      expect(anchor.anchorRPE).toBe(8.0);
      expect(anchor.anchorReps).toBe(12); // Odd week hypertrophy_linear compound
      expect(anchor.workingSetCount).toBe(3);
      expect(anchor.roundedAnchorWeight).toBe(bundle.baseSets[0].weight);
      expect(anchor.baselineE1RM).toBeGreaterThan(0);
      expect(bundle.distributionResult).not.toBeNull();
      expect(bundle.distributionResult?.targets).toHaveLength(3);
    });

    it('returns null SessionAnchor for Deload, Off, and Zero-Baseline', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0 }],
      };

      // Off
      const offBundle = calculateObjectivePrescriptionBundle({
        objective: 'Off',
        exercise: ex,
        weekNum: 1,
      });
      expect(offBundle.sessionAnchor).toBeNull();
      expect(offBundle.periodisationLane).toBeNull();

      // Deload
      const deloadBundle = calculateObjectivePrescriptionBundle({
        objective: 'Deload',
        exercise: ex,
        weekNum: 1,
        previousLogs: [sampleLog],
      });
      expect(deloadBundle.sessionAnchor).toBeNull();
      expect(deloadBundle.periodisationLane).toBeNull();

      // Zero-baseline
      const zeroBundle = calculateObjectivePrescriptionBundle({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
      });
      expect(zeroBundle.sessionAnchor).toBeNull();
      // Zero-baseline still produces periodisationLane
      expect(zeroBundle.periodisationLane).not.toBeNull();
    });
  });

  describe('3. ClosedPeriodisationLaneContext Contract', () => {
    it('derives correct periodisationLane for hypertrophy_step', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0 }],
      };

      const bundle = calculateObjectivePrescriptionBundle({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 3,
        programDuration: 8,
        algorithmId: 'hypertrophy_step',
        previousLogs: [sampleLog],
      });

      expect(bundle.periodisationLane).toEqual({
        algorithmId: 'hypertrophy_step',
        effectivePhase: 3,
      });
    });

    it('derives correct periodisationLane for hypertrophy_linear', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0 }],
      };

      const bundleW1 = calculateObjectivePrescriptionBundle({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [sampleLog],
      });
      expect(bundleW1.periodisationLane).toEqual({
        algorithmId: 'hypertrophy_linear',
        waveType: 'volume',
      });

      const bundleW2 = calculateObjectivePrescriptionBundle({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [sampleLog],
      });
      expect(bundleW2.periodisationLane).toEqual({
        algorithmId: 'hypertrophy_linear',
        waveType: 'heavy',
      });
    });

    it('derives correct periodisationLane for strength_linear and strength_undulating', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0 }],
      };

      const linearBundle = calculateObjectivePrescriptionBundle({
        objective: 'Strength',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        algorithmId: 'strength_linear',
        previousLogs: [sampleLog],
      });
      expect(linearBundle.periodisationLane).toEqual({
        algorithmId: 'strength_linear',
        linearPhase: 2,
        maxWeeks: 8,
      });

      const undulatingBundle = calculateObjectivePrescriptionBundle({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_undulating',
        previousLogs: [sampleLog],
      });
      expect(undulatingBundle.periodisationLane).toMatchObject({
        algorithmId: 'strength_undulating',
      });
      if (undulatingBundle.periodisationLane && undulatingBundle.periodisationLane.algorithmId === 'strength_undulating') {
        expect(typeof undulatingBundle.periodisationLane.anchorReps).toBe('number');
        expect(typeof undulatingBundle.periodisationLane.anchorRpe).toBe('number');
      }
    });

    it('derives valid periodisationLane for zero-baseline guidance', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0 }],
      };

      const zeroBundle = calculateObjectivePrescriptionBundle({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        algorithmId: 'hypertrophy_step',
        previousLogs: [],
      });

      expect(zeroBundle.periodisationLane).toEqual({
        algorithmId: 'hypertrophy_step',
        effectivePhase: 1,
      });
    });
  });

  describe('4. Single Authoritative Resolution Pass', () => {
    it('produces identical SessionAnchor and PeriodisationLane directly from canonical authority', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0, isWarmup: true },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 3, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      const params: objectiveMathModule.CalculateObjectiveSetsParams = {
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [sampleLog],
      };

      const bundle = calculateObjectivePrescriptionBundle(params);
      const expectedResolution = objectiveMathModule.resolveSessionDistribution({
        objective: params.objective,
        exercise: params.exercise,
        workingSetCount: 2,
        weekNum: params.weekNum,
        programDuration: params.programDuration,
        algorithmId: params.algorithmId,
        previousLogs: params.previousLogs,
      });

      expect(bundle.sessionAnchor).toEqual(expectedResolution.anchor);
      expect(bundle.periodisationLane).toEqual(expectedResolution.periodisationLane);
      expect(bundle.distributionResult).toEqual(expectedResolution.distributionResult);

      // Verify that calculateObjectiveSets returns exactly bundle.baseSets without recomputing
      const facadeSets = calculateObjectiveSets(params);
      expect(facadeSets).toEqual(bundle.baseSets);
    });
  });

  describe('5. Bodyweight and Assisted Modalities', () => {
    it('preserves SessionAnchor for bodyweight and assisted exercises with valid snapshot', () => {
      const pullUpEx: ExerciseEntry = {
        name: 'Pull Up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        movementCategory: 'compound',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      const bwBundle = calculateObjectivePrescriptionBundle({
        objective: 'Hypertrophy',
        exercise: pullUpEx,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [sampleLog],
        bodyweightSnapshot: snapshot,
      });

      expect(bwBundle.sessionAnchor).not.toBeNull();
      expect(bwBundle.sessionAnchor?.modality).toBe('weighted'); // Effective-load space anchor
      expect(bwBundle.baseSets[0].weight).toBe(0); // Bodyweight load is 0
      expect(bwBundle.baseSets[0].reps).toBeGreaterThan(0);

      const assistedEx: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Chest',
        modality: 'assisted',
        movementCategory: 'compound',
        equipment: 'machine',
        sets: [
          { setNumber: 1, weight: 0, reps: 0, rpe: 0 },
          { setNumber: 2, weight: 0, reps: 0, rpe: 0 },
        ],
      };

      const assistedBundle = calculateObjectivePrescriptionBundle({
        objective: 'Hypertrophy',
        exercise: assistedEx,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [sampleLog],
        bodyweightSnapshot: snapshot,
      });

      expect(assistedBundle.sessionAnchor).not.toBeNull();
      expect(assistedBundle.baseSets[0].weight).toBeGreaterThan(0); // Assistance load > 0
    });
  });
});
