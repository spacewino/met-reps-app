/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePlannedBodyweightCapacity,
  calculateObservedBodyweightCapacity,
  clampBodyweightReadinessRatio,
  evaluateBodyweightLiveAdjustment,
  calculateAddedBodyweightSetTarget,
} from '../bodyweightLiveAdjustment';
import { calculateAddedSetTarget } from '../objectiveMath';
import { getRTSMultiplier } from '../rpeMath';
import { ExerciseEntry, BodyweightSnapshot } from '../../types';

describe('MetReps Stage B Pure-Bodyweight Reps-Only Live Adjustment Suite', () => {
  const sessionBodyweightSnapshot: BodyweightSnapshot = {
    value: 100,
    unit: 'kg',
  };

  it('1. Verifies exact canonical RTS multipliers', () => {
    expect(getRTSMultiplier(10, 8)).toBe(0.680);
    expect(getRTSMultiplier(8, 9)).toBe(0.757);
    expect(getRTSMultiplier(10, 8.5)).toBe(0.691);
    expect(getRTSMultiplier(7, 8.5)).toBe(0.765);
    expect(getRTSMultiplier(10, 9)).toBe(0.707);
    expect(getRTSMultiplier(6, 9)).toBe(0.807);
    expect(getRTSMultiplier(9, 9)).toBe(0.732);
    expect(getRTSMultiplier(12, 7)).toBe(0.587);
    expect(getRTSMultiplier(7, 8)).toBe(0.751);
    expect(getRTSMultiplier(8, 8)).toBe(0.728);
  });

  it('2. Planned bodyweight capacity is derived accurately from snapshot and prescribed Set 1', () => {
    // 100 kg / getRTSMultiplier(10, 8) = 100 / 0.680 = 147.0588...
    const plannedCap = calculatePlannedBodyweightCapacity(100, 10, 8);
    expect(plannedCap).toBeCloseTo(100 / 0.680, 4);
  });

  it('3. Observed bodyweight capacity is derived accurately from snapshot and actual Set 1 evidence', () => {
    // 100 kg / getRTSMultiplier(8, 9) = 100 / 0.757 = 132.1003...
    const observedCap = calculateObservedBodyweightCapacity(100, 8, 9);
    expect(observedCap).toBeCloseTo(100 / 0.757, 4);
  });

  it('4. Cold-start readiness ratio derives correctly from planned and observed capacities', () => {
    const plannedCap = calculatePlannedBodyweightCapacity(100, 10, 8)!;
    const observedCap = calculateObservedBodyweightCapacity(100, 8, 9)!;
    const rawR = observedCap / plannedCap;
    // 0.680 / 0.757 = 0.89828...
    expect(rawR).toBeCloseTo(0.680 / 0.757, 4);
    const clampedR = clampBodyweightReadinessRatio(rawR);
    expect(clampedR).toBeCloseTo(0.89828, 4);
  });

  it('5. Readiness ratio is invariant to session bodyweight edits', () => {
    const planned100 = calculatePlannedBodyweightCapacity(100, 10, 8)!;
    const observed100 = calculateObservedBodyweightCapacity(100, 8, 9)!;
    const r100 = observed100 / planned100;

    const planned75 = calculatePlannedBodyweightCapacity(75, 10, 8)!;
    const observed75 = calculateObservedBodyweightCapacity(75, 8, 9)!;
    const r75 = observed75 / planned75;

    expect(r100).toBeCloseTo(r75, 6);
  });

  it('6. Evaluates cold-start adjustment for untouched future sets correctly', () => {
    const exercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 8, rpe: 9 },
        { setNumber: 2, weight: 0, reps: 10, rpe: 8.5 },
        { setNumber: 3, weight: 0, reps: 10, rpe: 9 },
        { setNumber: 4, weight: 0, reps: 9, rpe: 9 },
      ],
    };

    const committedEvidenceBySet = {
      '0-0': { reps: 8, rpe: 9 },
    };

    const prescribedTargetSnapshots = {
      '0-0': { setNumber: 1, weight: 0, reps: 10, rpe: 8 },
      '0-1': { setNumber: 2, weight: 0, reps: 10, rpe: 8.5 },
      '0-2': { setNumber: 3, weight: 0, reps: 10, rpe: 9 },
      '0-3': { setNumber: 4, weight: 0, reps: 9, rpe: 9 },
    };

    const result = evaluateBodyweightLiveAdjustment({
      exercise,
      exerciseIndex: 0,
      sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidenceBySet,
      prescribedTargetSnapshots,
      userTouchedSets: {},
      checkedSets: {},
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
    });

    expect(result.status).toBe('adjusted');
    expect(result.changedRowKeys.length).toBe(3);
    expect(result.adjustedSets[0].weight).toBe(0);
    expect(result.adjustedSets[1]).toMatchObject({ setNumber: 2, weight: 0, reps: 7, rpe: 8.5 });
    expect(result.adjustedSets[2]).toMatchObject({ setNumber: 3, weight: 0, reps: 6, rpe: 9 });
    expect(result.adjustedSets[3]).toMatchObject({ setNumber: 4, weight: 0, reps: 6, rpe: 9 });
  });

  it('7. Low RPE (< 6.0) is bypassed without adjusting future reps', () => {
    const exercise: ExerciseEntry = {
      name: 'Push-up',
      muscleGroup: 'Chest',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 10, rpe: 5 },
        { setNumber: 2, weight: 0, reps: 10, rpe: 8 },
      ],
    };

    const committedEvidenceBySet = {
      '0-0': { reps: 10, rpe: 5 },
    };

    const prescribedTargetSnapshots = {
      '0-0': { setNumber: 1, weight: 0, reps: 10, rpe: 8 },
      '0-1': { setNumber: 2, weight: 0, reps: 10, rpe: 8 },
    };

    const result = evaluateBodyweightLiveAdjustment({
      exercise,
      exerciseIndex: 0,
      sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidenceBySet,
      prescribedTargetSnapshots,
      userTouchedSets: {},
      checkedSets: {},
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
    });

    expect(result.status).toBe('bypassed');
    expect(result.changedRowKeys).toEqual([]);
    expect(result.bypassReason).toBe('rpe_below_6');
  });

  it('8. Strength accessory pure-bodyweight exercise is bypassed', () => {
    const exercise: ExerciseEntry = {
      name: 'Chin-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      isMainMovement: false,
      sets: [
        { setNumber: 1, weight: 0, reps: 8, rpe: 9 },
        { setNumber: 2, weight: 0, reps: 10, rpe: 8.5 },
      ],
    };

    const committedEvidenceBySet = {
      '0-0': { reps: 8, rpe: 9 },
    };

    const prescribedTargetSnapshots = {
      '0-0': { setNumber: 1, weight: 0, reps: 10, rpe: 8 },
      '0-1': { setNumber: 2, weight: 0, reps: 10, rpe: 8.5 },
    };

    const result = evaluateBodyweightLiveAdjustment({
      exercise,
      exerciseIndex: 0,
      sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidenceBySet,
      prescribedTargetSnapshots,
      userTouchedSets: {},
      checkedSets: {},
      objective: 'Strength',
      isMainMovement: false,
    });

    expect(result.status).toBe('bypassed');
    expect(result.bypassReason).toBe('strength_accessory_bypassed');
  });

  it('9. Pre-evidence Add Set returns canonical zero-baseline guidance for Hypertrophy Linear (Wave Volume)', () => {
    const exercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 8 },
        { setNumber: 2, weight: 0, reps: 0, rpe: 8 },
      ],
    };

    const res = calculateAddedSetTarget({
      objective: 'Hypertrophy',
      exercise,
      weekNum: 1,
      programDuration: 8,
      algorithmId: 'hypertrophy_linear',
      bodyweightSnapshot: sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidence: [],
    });

    expect(res.isPrescribed).toBe(true);
    expect(res.workingSetOrdinal).toBe(3);
    expect(res.target).toEqual({
      weight: 0,
      reps: 12,
      rpe: 9.0,
      form: 'standard',
    });
  });

  it('10. Pre-evidence Add Set returns canonical zero-baseline guidance for Hypertrophy Step Loading', () => {
    const exercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 7 },
      ],
    };

    const res = calculateAddedSetTarget({
      objective: 'Hypertrophy',
      exercise,
      weekNum: 1,
      programDuration: 8,
      algorithmId: 'hypertrophy_step',
      bodyweightSnapshot: sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidence: [],
    });

    expect(res.isPrescribed).toBe(true);
    expect(res.workingSetOrdinal).toBe(2);
    expect(res.target).toEqual({
      weight: 0,
      reps: 10,
      rpe: 7.5,
      form: 'standard',
    });
  });

  it('11. Pre-evidence Add Set returns canonical zero-baseline guidance for Strength Undulating main movement', () => {
    const exercise: ExerciseEntry = {
      name: 'Chin-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 8 },
        { setNumber: 2, weight: 0, reps: 0, rpe: 7 },
      ],
    };

    const res = calculateAddedSetTarget({
      objective: 'Strength',
      exercise,
      weekNum: 1,
      programDuration: 8,
      algorithmId: 'strength_undulating',
      bodyweightSnapshot: sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidence: [],
    });

    expect(res.isPrescribed).toBe(true);
    expect(res.workingSetOrdinal).toBe(3);
    expect(res.target).toEqual({
      weight: 0,
      reps: 5,
      rpe: 6.5,
      form: 'standard',
    });
  });

  it('12. Pre-evidence Add Set returns canonical zero-baseline guidance for Strength Linear main movement', () => {
    const exercise: ExerciseEntry = {
      name: 'Chin-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 7 },
      ],
    };

    const res = calculateAddedSetTarget({
      objective: 'Strength',
      exercise,
      weekNum: 1,
      programDuration: 8,
      algorithmId: 'strength_linear',
      bodyweightSnapshot: sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidence: [],
    });

    expect(res.isPrescribed).toBe(true);
    expect(res.workingSetOrdinal).toBe(2);
    expect(res.target).toEqual({
      weight: 0,
      reps: 8,
      rpe: 6.0,
      form: 'standard',
    });
  });

  it('13. Pre-evidence Add Set returns unprescribed for Strength accessory', () => {
    const exercise: ExerciseEntry = {
      name: 'Dips',
      muscleGroup: 'Chest',
      modality: 'bodyweight',
      isMainMovement: false,
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 8 },
      ],
    };

    const res = calculateAddedSetTarget({
      objective: 'Strength',
      exercise,
      weekNum: 1,
      programDuration: 8,
      algorithmId: 'strength_undulating',
      bodyweightSnapshot: sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidence: [],
    });

    expect(res.isPrescribed).toBe(false);
    expect(res.workingSetOrdinal).toBe(2);
  });

  it('14. Pre-evidence Add Set returns unprescribed when bodyweight snapshot is missing or zero', () => {
    const exercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 8 },
      ],
    };

    const resNull = calculateAddedSetTarget({
      objective: 'Hypertrophy',
      exercise,
      weekNum: 1,
      bodyweightSnapshot: null,
      committedEvidence: [],
    });
    expect(resNull.isPrescribed).toBe(false);

    const resZero = calculateAddedSetTarget({
      objective: 'Hypertrophy',
      exercise,
      weekNum: 1,
      bodyweightSnapshot: { value: 0, unit: 'kg' },
      committedEvidence: [],
    });
    expect(resZero.isPrescribed).toBe(false);
  });

  it('15. Post-evidence Add Set Ordinal 2 matches canonical existing Set 2 target (7 @ 8.5)', () => {
    const exercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 8, rpe: 9 },
      ],
    };

    const committedEvidenceBySet = {
      '0-0': { reps: 8, rpe: 9 },
    };

    const prescribedTargetSnapshots = {
      '0-0': { setNumber: 1, weight: 0, reps: 10, rpe: 8 },
    };

    const target = calculateAddedBodyweightSetTarget({
      exercise,
      exerciseIndex: 0,
      addedSetNumber: 2,
      sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidenceBySet,
      prescribedTargetSnapshots,
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      targetReps: 10,
      targetRPE: 8.5,
    });

    expect(target).toEqual({
      weight: 0,
      reps: 7,
      rpe: 8.5,
      form: 'standard',
    });
  });

  it('16. Post-evidence Add Set Ordinal 3 matches canonical existing Set 3 target (6 @ 9.0)', () => {
    const exercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 8, rpe: 9 },
        { setNumber: 2, weight: 0, reps: 7, rpe: 8.5 },
      ],
    };

    const committedEvidenceBySet = {
      '0-0': { reps: 8, rpe: 9 },
    };

    const prescribedTargetSnapshots = {
      '0-0': { setNumber: 1, weight: 0, reps: 10, rpe: 8 },
      '0-1': { setNumber: 2, weight: 0, reps: 10, rpe: 8.5 },
    };

    const target = calculateAddedBodyweightSetTarget({
      exercise,
      exerciseIndex: 0,
      addedSetNumber: 3,
      sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidenceBySet,
      prescribedTargetSnapshots,
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      targetReps: 10,
      targetRPE: 9.0,
    });

    expect(target).toEqual({
      weight: 0,
      reps: 6,
      rpe: 9.0,
      form: 'standard',
    });
  });

  it('17. Post-evidence Add Set Ordinal 4 matches canonical existing Set 4 target (6 @ 9.0)', () => {
    const exercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 8, rpe: 9 },
        { setNumber: 2, weight: 0, reps: 7, rpe: 8.5 },
        { setNumber: 3, weight: 0, reps: 6, rpe: 9 },
      ],
    };

    const committedEvidenceBySet = {
      '0-0': { reps: 8, rpe: 9 },
    };

    const prescribedTargetSnapshots = {
      '0-0': { setNumber: 1, weight: 0, reps: 10, rpe: 8 },
      '0-1': { setNumber: 2, weight: 0, reps: 10, rpe: 8.5 },
      '0-2': { setNumber: 3, weight: 0, reps: 10, rpe: 9 },
    };

    const target = calculateAddedBodyweightSetTarget({
      exercise,
      exerciseIndex: 0,
      addedSetNumber: 4,
      sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidenceBySet,
      prescribedTargetSnapshots,
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      targetReps: 9,
      targetRPE: 9.0,
    });

    expect(target).toEqual({
      weight: 0,
      reps: 6,
      rpe: 9.0,
      form: 'standard',
    });
  });

  it('18. State immutability & pure derivation across repeated Add Set calls', () => {
    const originalExercise: ExerciseEntry = {
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      sets: [
        { setNumber: 1, weight: 0, reps: 8, rpe: 9 },
        { setNumber: 2, weight: 0, reps: 7, rpe: 8.5 },
      ],
    };
    const exerciseCopy = JSON.parse(JSON.stringify(originalExercise));

    const committedEvidenceBySet = {
      '0-0': { reps: 8, rpe: 9 },
    };

    const target1 = calculateAddedBodyweightSetTarget({
      exercise: originalExercise,
      exerciseIndex: 0,
      addedSetNumber: 3,
      sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidenceBySet,
      prescribedTargetSnapshots: {
        '0-0': { setNumber: 1, weight: 0, reps: 10, rpe: 8 },
      },
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      targetReps: 10,
      targetRPE: 9.0,
    });

    const target2 = calculateAddedBodyweightSetTarget({
      exercise: originalExercise,
      exerciseIndex: 0,
      addedSetNumber: 3,
      sessionBodyweightSnapshot,
      activeUnit: 'kg',
      committedEvidenceBySet,
      prescribedTargetSnapshots: {
        '0-0': { setNumber: 1, weight: 0, reps: 10, rpe: 8 },
      },
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      targetReps: 10,
      targetRPE: 9.0,
    });

    expect(target1).toEqual(target2);
    expect(originalExercise).toEqual(exerciseCopy);
  });
});

