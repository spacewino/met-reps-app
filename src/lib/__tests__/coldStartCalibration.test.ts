import { describe, it, expect } from 'vitest';
import {
  deriveColdStartPlannedCapacityE1RM,
  deriveColdStartObservedCapacityE1RM,
  deriveColdStartOrdinalShape,
  deriveColdStartCalibratedPlannedTargets,
} from '../coldStartCalibration';
import {
  prepareLiveAdjustmentParams,
  applyLiveAdjustmentResult,
  capturePrescribedSnapshotsFromExercises,
  canRestorePlannedTargets,
  restorePlannedTargetsForExercise,
} from '../liveAdjustmentSession';
import { calculateLiveSetAdjustments } from '../liveAdjustmentMath';
import { calculateObjectiveSets, calculateAddedSetTarget } from '../objectiveMath';
import { getRTSMultiplier } from '../rpeMath';
import { ExerciseEntry, WorkoutLog } from '../../types';

describe('MetReps Cold-Start Active-Session Calibration', () => {
  const zeroSets = (count: number = 3) =>
    Array.from({ length: count }, (_, i) => ({
      setNumber: i + 1,
      weight: 0,
      reps: 0,
      rpe: 0,
      form: 'standard' as const,
    }));

  describe('1. Canonical Strength Fixture (Wave Strength Main Movement Week 1)', () => {
    it('calculates planned capacity, observed capacity, readiness = 0.94884287454324 and adjusts untouched sets to 45 kg', () => {
      // 1. Initial prescription: Wave Strength Week 1, 8-week duration
      const ex: ExerciseEntry = {
        name: 'Barbell Back Squat',
        muscleGroup: 'Legs',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: zeroSets(3),
      };

      const prescribedSets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_undulating',
        previousLogs: [],
      });

      // Verify initial zero-load prescription shape
      expect(prescribedSets).toHaveLength(3);
      expect(prescribedSets[0]).toMatchObject({ weight: 0, reps: 5, rpe: 7.0 });
      expect(prescribedSets[1]).toMatchObject({ weight: 0, reps: 5, rpe: 6.0 });
      expect(prescribedSets[2]).toMatchObject({ weight: 0, reps: 5, rpe: 6.5 });

      // Build prescribed snapshots
      const snapshots = capturePrescribedSnapshotsFromExercises([
        { ...ex, sets: prescribedSets },
      ]);
      expect(snapshots['0-0']).toEqual({ weight: 0, reps: 5, rpe: 7.0 });
      expect(snapshots['0-1']).toEqual({ weight: 0, reps: 5, rpe: 6.0 });
      expect(snapshots['0-2']).toEqual({ weight: 0, reps: 5, rpe: 6.5 });

      // User enters and performs: Set 1 = 50 kg × 5 @ actual RPE 8.5
      const mult5at7 = getRTSMultiplier(5, 7.0)!; // 0.779
      const mult5at8_5 = getRTSMultiplier(5, 8.5)!; // 0.821
      expect(mult5at7).toBe(0.779);
      expect(mult5at8_5).toBe(0.821);

      const plannedCapacity = deriveColdStartPlannedCapacityE1RM(50, 5, 7.0)!;
      const observedCapacity = deriveColdStartObservedCapacityE1RM(50, 5, 8.5)!;
      expect(plannedCapacity).toBeCloseTo(50 / 0.779, 8); // 64.18485237
      expect(observedCapacity).toBeCloseTo(50 / 0.821, 8); // 60.90133983

      const readiness = observedCapacity / plannedCapacity;
      expect(readiness).toBeCloseTo(0.94884287454324, 8);

      // Session live adjustment preparation
      const activeExercise: ExerciseEntry = {
        ...ex,
        sets: [
          { setNumber: 1, weight: 50, reps: 5, rpe: 8.5, form: 'standard', isCompleted: true },
          { setNumber: 2, weight: 0, reps: 5, rpe: 6.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 5, rpe: 6.5, form: 'standard' },
        ],
      };

      const committedEvidence = {
        '0-0': { weight: 50, reps: 5, rpe: 8.5, form: 'standard' as const },
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: activeExercise,
        exIdx: 0,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        profileType: 'strength_normal',
        baselineE1RM: 0, // Cold start!
        prescribedTargetSnapshots: snapshots,
        committedLiveEvidenceBySet: committedEvidence,
        triggeringSetIdx: 0,
        activeUnit: 'kg',
      });

      expect(prep.success).toBe(true);
      expect(prep.params).toBeDefined();

      const result = calculateLiveSetAdjustments(prep.params!);
      expect(result.status).toBe('adjusted');
      expect(result.sessionReadiness).toBeCloseTo(0.94884287454324, 6);
      expect(result.candidateTargets).toHaveLength(3);

      // Ordinal 2 target: planned e1RM * readiness * fatiguePrior(0.98) * RTS(5, 6.0 = 0.751)
      // 60.9013398 * 0.98 * 0.751 = 44.822 kg -> 45.0 kg
      expect(result.candidateTargets[1]).toMatchObject({
        workingSetOrdinal: 2,
        weight: 45.0,
        reps: 5,
        rpe: 6.0,
      });

      // Ordinal 3 target: planned e1RM * readiness * fatiguePrior(0.96) * RTS(5, 6.5 = 0.765)
      // 60.9013398 * 0.96 * 0.765 = 44.726 kg -> 45.0 kg
      expect(result.candidateTargets[2]).toMatchObject({
        workingSetOrdinal: 3,
        weight: 45.0,
        reps: 5,
        rpe: 6.5,
      });

      // Apply to session exercise
      const application = applyLiveAdjustmentResult({
        exercise: activeExercise,
        exIdx: 0,
        result,
        prescribedTargetSnapshots: snapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true },
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
        activeUnit: 'kg',
        objective: 'Strength',
        algorithmId: 'strength_undulating',
      });

      expect(application.appliedChangeCount).toBe(2);
      expect(application.updatedExercise.sets[1]).toMatchObject({ weight: 45.0, reps: 5, rpe: 6.0 });
      expect(application.updatedExercise.sets[2]).toMatchObject({ weight: 45.0, reps: 5, rpe: 6.5 });
      expect(application.updatedLiveAdjustedSets['0-1']).toBe(true);
      expect(application.updatedLiveAdjustedSets['0-2']).toBe(true);
    });
  });

  describe('2. Hypertrophy Wave Volume (hypertrophy_linear) Cold Start', () => {
    it('calibrates untouched sets for weighted compound exercise with no prior baseline', () => {
      const ex: ExerciseEntry = {
        name: 'Incline Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(3),
      };

      const prescribed = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
      });

      // Week 1 compound freeweight: 12 reps @ RPE 8.0 across working sets
      expect(prescribed[0]).toMatchObject({ weight: 0, reps: 12, rpe: 8.0 });
      expect(prescribed[1]).toMatchObject({ weight: 0, reps: 12, rpe: 8.0 });

      const snapshots = capturePrescribedSnapshotsFromExercises([{ ...ex, sets: prescribed }]);

      // User performs Set 1: 60 kg × 12 @ RPE 8.0 (exact planned RPE -> readiness 1.0)
      const activeExercise: ExerciseEntry = {
        ...ex,
        sets: [
          { setNumber: 1, weight: 60, reps: 12, rpe: 8.0, form: 'standard', isCompleted: true },
          { setNumber: 2, weight: 0, reps: 12, rpe: 8.0, form: 'standard' },
          { setNumber: 3, weight: 0, reps: 12, rpe: 8.0, form: 'standard' },
        ],
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: activeExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 0,
        prescribedTargetSnapshots: snapshots,
        committedLiveEvidenceBySet: {
          '0-0': { weight: 60, reps: 12, rpe: 8.0, form: 'standard' },
        },
        triggeringSetIdx: 0,
        activeUnit: 'kg',
      });

      expect(prep.success).toBe(true);
      const result = calculateLiveSetAdjustments(prep.params!);
      expect(result.status).toBe('adjusted');
      expect(result.sessionReadiness).toBeCloseTo(1.0, 6);

      // Hypertrophy fatigue priors: [1.0, 0.975, 0.950]
      // Set 2 weight: 60 * 0.975 = 58.5 -> 57.5 kg
      // Set 3 weight: 60 * 0.950 = 57.0 -> 57.5 kg
      expect(result.candidateTargets[1].weight).toBe(57.5);
      expect(result.candidateTargets[2].weight).toBe(57.5);
    });
  });

  describe('3. Hypertrophy Step Progression (hypertrophy_step) Cold Start', () => {
    it('calibrates untouched sets for step progression algorithm', () => {
      const ex: ExerciseEntry = {
        name: 'Dumbbell Curl',
        muscleGroup: 'Biceps',
        modality: 'weighted',
        movementCategory: 'isolation',
        equipment: 'freeweight',
        sets: zeroSets(3),
      };

      const prescribed = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_step',
        previousLogs: [],
      });

      const snapshots = capturePrescribedSnapshotsFromExercises([{ ...ex, sets: prescribed }]);

      const activeExercise: ExerciseEntry = {
        ...ex,
        sets: [
          { setNumber: 1, weight: 14, reps: prescribed[0].reps, rpe: prescribed[0].rpe, form: 'standard', isCompleted: true },
          { setNumber: 2, weight: 0, reps: prescribed[1].reps, rpe: prescribed[1].rpe, form: 'standard' },
          { setNumber: 3, weight: 0, reps: prescribed[2].reps, rpe: prescribed[2].rpe, form: 'standard' },
        ],
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: activeExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_step',
        profileType: 'hypertrophy',
        baselineE1RM: 0,
        prescribedTargetSnapshots: snapshots,
        committedLiveEvidenceBySet: {
          '0-0': { weight: 14, reps: prescribed[0].reps || 10, rpe: prescribed[0].rpe || 8.0, form: 'standard' },
        },
        triggeringSetIdx: 0,
        activeUnit: 'kg',
      });

      expect(prep.success).toBe(true);
      const result = calculateLiveSetAdjustments(prep.params!);
      expect(result.status).toBe('adjusted');
      expect(result.candidateTargets[1].weight).toBeGreaterThan(0);
    });
  });

  describe('4. Strength Accessory / Non-Main Movement Protection', () => {
    it('does not perform cold-start live adjustment for non-main movement strength exercises', () => {
      const ex: ExerciseEntry = {
        name: 'Triceps Pushdown',
        muscleGroup: 'Triceps',
        modality: 'weighted',
        movementCategory: 'isolation',
        equipment: 'machine',
        isMainMovement: false,
        sets: zeroSets(3),
      };

      const prescribed = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_linear',
        previousLogs: [],
      });

      const snapshots = capturePrescribedSnapshotsFromExercises([{ ...ex, sets: prescribed }]);

      const activeExercise: ExerciseEntry = {
        ...ex,
        sets: [
          { setNumber: 1, weight: 30, reps: 8, rpe: 8.0, form: 'standard', isCompleted: true },
          { setNumber: 2, weight: 0, reps: 8, rpe: 8.0, form: 'standard' },
        ],
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: activeExercise,
        exIdx: 0,
        objective: 'Strength',
        algorithmId: 'strength_linear',
        profileType: 'strength_normal',
        baselineE1RM: 0,
        prescribedTargetSnapshots: snapshots,
        committedLiveEvidenceBySet: {
          '0-0': { weight: 30, reps: 8, rpe: 8.0, form: 'standard' },
        },
        triggeringSetIdx: 0,
        activeUnit: 'kg',
      });

      // For non-main movement in Strength with baselineE1RM <= 0, prep fails safely
      expect(prep.success).toBe(false);
    });
  });

  describe('5. Target-Aware Add Set Cold-Start 4-Tier Authority', () => {
    const baseEx: ExerciseEntry = {
      name: 'Barbell Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'freeweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 0, reps: 12, rpe: 8.0, form: 'standard' },
        { setNumber: 2, weight: 0, reps: 12, rpe: 8.0, form: 'standard' },
      ],
    };

    it('Tier 3: when Set 1 is untouched zero load, Add Set receives canonical algorithm shape', () => {
      const targetResult = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: baseEx,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
      });

      expect(targetResult.isPrescribed).toBe(true);
      expect(targetResult.target).toEqual({
        weight: 0,
        reps: 12,
        rpe: 8.0,
        form: 'standard',
      });
    });

    it('Tier 1: when Set 1 has committed evidence, Add Set uses calibrated capacity and fatigue prior', () => {
      const activeEx: ExerciseEntry = {
        ...baseEx,
        sets: [
          { setNumber: 1, weight: 80, reps: 12, rpe: 8.0, form: 'standard', isCompleted: true },
          { setNumber: 2, weight: 77.5, reps: 12, rpe: 8.0, form: 'standard', isCompleted: true },
        ],
      };

      const targetResult = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: activeEx,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
        committedEvidence: [
          { workingSetOrdinal: 1, weight: 80, reps: 12, rpe: 8.0, form: 'standard' },
          { workingSetOrdinal: 2, weight: 77.5, reps: 12, rpe: 8.0, form: 'standard' },
        ],
      });

      expect(targetResult.isPrescribed).toBe(true);
      expect(targetResult.target!.weight).toBeGreaterThan(0);
      expect(targetResult.target!.reps).toBe(12);
      expect(targetResult.target!.rpe).toBe(8.0);
      // Working set 3 fatigue prior 0.950: 80 * 0.950 = 76.0 -> 75.0 kg
      expect(targetResult.target!.weight).toBe(75.0);
    });

    it('Tier 2: when Set 1 has positive load entered but not yet committed, Add Set uses provisional anchor', () => {
      const activeEx: ExerciseEntry = {
        ...baseEx,
        sets: [
          { setNumber: 1, weight: 80, reps: 12, rpe: 8.0, form: 'standard' },
          { setNumber: 2, weight: 0, reps: 12, rpe: 8.0, form: 'standard' },
        ],
      };

      const targetResult = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: activeEx,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
        committedEvidence: [], // No committed evidence yet
      });

      expect(targetResult.isPrescribed).toBe(true);
      expect(targetResult.target!.weight).toBeGreaterThan(0);
      expect(targetResult.target!.reps).toBe(12);
      expect(targetResult.target!.rpe).toBe(8.0);
    });
  });

  describe('6. Touched and Active Row Isolation', () => {
    it('does not override user-touched or currently active rows during cold-start live adjustment', () => {
      const ex: ExerciseEntry = {
        name: 'Overhead Press',
        muscleGroup: 'Shoulders',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(3),
      };

      const prescribed = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
      });

      const snapshots = capturePrescribedSnapshotsFromExercises([{ ...ex, sets: prescribed }]);

      const activeExercise: ExerciseEntry = {
        ...ex,
        sets: [
          { setNumber: 1, weight: 40, reps: 12, rpe: 8.0, form: 'standard', isCompleted: true },
          { setNumber: 2, weight: 42.5, reps: 10, rpe: 9.0, form: 'standard' }, // User customized Set 2
          { setNumber: 3, weight: 0, reps: 12, rpe: 8.0, form: 'standard' },
        ],
      };

      const prep = prepareLiveAdjustmentParams({
        exercise: activeExercise,
        exIdx: 0,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        baselineE1RM: 0,
        prescribedTargetSnapshots: snapshots,
        committedLiveEvidenceBySet: {
          '0-0': { weight: 40, reps: 12, rpe: 8.0, form: 'standard' },
        },
        triggeringSetIdx: 0,
        activeUnit: 'kg',
      });

      const result = calculateLiveSetAdjustments(prep.params!);

      const application = applyLiveAdjustmentResult({
        exercise: activeExercise,
        exIdx: 0,
        result,
        prescribedTargetSnapshots: snapshots,
        currentLiveAdjustedSets: {},
        userTouchedSets: { '0-0': true, '0-1': true }, // Set 2 is user-touched!
        focusedSetKey: null,
        activeSelectorRowKey: null,
        triggeringRowIndex: 0,
        activeUnit: 'kg',
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
      });

      // Only Set 3 was modified
      expect(application.appliedChangeCount).toBe(1);
      expect(application.updatedExercise.sets[1]).toMatchObject({ weight: 42.5, reps: 10, rpe: 9.0 });
      expect(application.updatedExercise.sets[2].weight).toBeGreaterThan(0);
    });
  });

  describe('7. Restoration of Planned Targets', () => {
    it('restores original zero-baseline snapshot targets when live adjustments are restored', () => {
      const ex: ExerciseEntry = {
        name: 'Dumbbell Row',
        muscleGroup: 'Back',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [
          { setNumber: 1, weight: 30, reps: 12, rpe: 8.0, form: 'standard', isCompleted: true },
          { setNumber: 2, weight: 27.5, reps: 12, rpe: 8.0, form: 'standard' },
        ],
      };

      const snapshots = {
        '0-0': { weight: 0, reps: 12, rpe: 8.0 },
        '0-1': { weight: 0, reps: 12, rpe: 8.0 },
      };

      const canRestore = canRestorePlannedTargets({
        exercise: ex,
        exIdx: 0,
        prescribedTargetSnapshots: snapshots,
        currentLiveAdjustedSets: { '0-1': true },
        userTouchedSets: {},
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(canRestore).toBe(true);

      const restoreOut = restorePlannedTargetsForExercise({
        exercise: ex,
        exIdx: 0,
        prescribedTargetSnapshots: snapshots,
        currentLiveAdjustedSets: { '0-1': true },
        userTouchedSets: {},
        focusedSetKey: null,
        activeSelectorRowKey: null,
      });

      expect(restoreOut.restoredRowKeys).toEqual(['0-1']);
      expect(restoreOut.updatedExercise.sets[1]).toMatchObject({ weight: 0, reps: 12, rpe: 8.0 });
      expect(restoreOut.updatedLiveAdjustedSets['0-1']).toBeUndefined();
    });
  });

  describe('8. Historical Database Isolation', () => {
    it('confirms no historical logs are required or modified during cold-start active session calibration', () => {
      const emptyLogs: WorkoutLog[] = [];
      const ex: ExerciseEntry = {
        name: 'Romanian Deadlift',
        muscleGroup: 'Hamstrings',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(2),
      };

      const prescribed = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: emptyLogs,
      });

      expect(prescribed[0].weight).toBe(0);
      expect(emptyLogs).toHaveLength(0);
    });
  });
});
