/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  adaptGuidedExercisePrescription,
  adaptExercisePrescription,
  isPrescribedWorkingSet,
  applyGuidedSelectorResult,
  GuidedExerciseAdapterInput,
  GuidedExerciseAdapterResult,
} from '../guidedRuntimeAdapter';
import {
  ExerciseEntry,
  Program,
  WorkoutLog,
  PrescriptionSnapshot,
  SetEntry,
  WeightUnit,
} from '../../types';
import {
  SelectGuidedPrescriptionGuidedResult,
} from '../guidedTargetSelector';
import { SessionAnchor } from '../setDistribution';
import { getRTSMultiplier } from '../rpeMath';

describe('guidedRuntimeAdapter (APC-3B2C2B2C-D1)', () => {
  const defaultProgram: Program = {
    id: 'prog-1',
    name: 'Hypertrophy 3-Day',
    daysPerWeek: 3,
    programDuration: 8,
    exercisesByDay: {},
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    targetProgressionMode: 'metreps_guided',
    progressionPolicyVersion: 1,
    algorithmVersion: 1,
    createdAt: '2026-08-01',
  };

  const defaultExercise: ExerciseEntry = {
    exerciseKey: 'bench_press',
    name: 'Bench Press',
    muscleGroup: 'Chest',
    modality: 'weighted',
    equipment: 'freeweight',
    isMainMovement: true,
    sets: [],
  };

  const makeAnchor = (overrides?: Partial<SessionAnchor>): SessionAnchor => {
    const algorithmId = overrides?.algorithmId ?? 'hypertrophy_linear';
    const profileType =
      overrides?.profileType ??
      (algorithmId.startsWith('strength') ? 'strength_normal' : 'hypertrophy');
    const roundedAnchorWeight = overrides?.roundedAnchorWeight ?? 80;
    const rawAnchorWeight = overrides?.rawAnchorWeight ?? roundedAnchorWeight;
    const anchorReps = overrides?.anchorReps ?? 8;
    const anchorRPE = overrides?.anchorRPE ?? 8;
    const mult = getRTSMultiplier(anchorReps, anchorRPE) ?? 1;
    const baselineE1RM = overrides?.baselineE1RM ?? (mult > 0 ? rawAnchorWeight / mult : 100);
    return {
      workingSetCount: 3,
      roundedAnchorWeight,
      anchorReps,
      anchorRPE,
      algorithmId,
      modality: 'weighted',
      equipment: 'freeweight',
      profileType,
      baselineE1RM,
      rawAnchorWeight,
      ...overrides,
    };
  };

  const createCompletedLog = (
    workoutLogId: string,
    workoutDate: string,
    snapshots: PrescriptionSnapshot[],
    performedSets: { reps: number; rpe: number; weight: number }[]
  ): WorkoutLog => {
    const snap0 = snapshots[0];
    return {
      id: workoutLogId,
      date: workoutDate,
      unit: 'kg',
      programId: defaultProgram.id,
      bodyweightSnapshot:
        snap0?.bodyweightSnapshot != null
          ? { value: snap0.bodyweightSnapshot, unit: 'kg' }
          : null,
      exercises: [
        {
          exerciseKey: snap0?.exerciseKey ?? defaultExercise.exerciseKey,
          name: defaultExercise.name,
          muscleGroup: defaultExercise.muscleGroup,
          modality: snap0?.modality ?? defaultExercise.modality,
          isMainMovement: true,
          sets: performedSets.map((ps, idx) => ({
            setNumber: idx + 1,
            weight: ps.weight,
            reps: ps.reps,
            rpe: ps.rpe,
            isCompleted: true,
            isWarmup: false,
            isDropSet: false,
            prescriptionSnapshot: snapshots[idx] ?? null,
          })),
        },
      ],
    };
  };

  const snapTemplate = (step: number): PrescriptionSnapshot[] => {
    const laneKey =
      'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
    return [1, 2, 3].map(ord => ({
      snapshotVersion: 2,
      progressionPolicyVersion: 1,
      algorithmVersion: 1,
      progressionMode: 'metreps_guided',
      algorithmId: 'hypertrophy_linear',
      exerciseKey: 'bench_press',
      exerciseRole: 'main_movement',
      modality: 'weighted',
      comparableLaneKey: laneKey,
      workingSetOrdinal: ord,
      prescribedWorkingSetCount: 3,
      baseWeight: 80,
      baseReps: 8,
      baseRpe: 8,
      presentedWeight: 80,
      presentedReps: 8,
      presentedRpe: 8,
      bodyweightSnapshot: null,
      weightUnit: 'kg' as WeightUnit,
      comparisonLoadKg: 80,
      loadBasis: 'external_weight_v1',
      loadIncrement: 2.5,
      nudgeType: 'none',
      coachingReasonCode: 'BASE_PRESCRIPTION',
      confirmedStepIndexBefore: step,
      presentedStepIndex: step,
      successCreditEligible: true,
      rollbackTarget: null,
    }));
  };

  const makeBaseSets = (): SetEntry[] => [
    { setNumber: 1, weight: 80, reps: 8, rpe: 8, isWarmup: false, isDropSet: false },
    { setNumber: 2, weight: 80, reps: 8, rpe: 8, isWarmup: false, isDropSet: false },
    { setNumber: 3, weight: 80, reps: 8, rpe: 8, isWarmup: false, isDropSet: false },
  ];

  const makeInput = (
    overrides?: Partial<GuidedExerciseAdapterInput>
  ): GuidedExerciseAdapterInput => {
    const baseSets = overrides?.baseSets ?? makeBaseSets();
    return {
      exercise: { ...defaultExercise, sets: [...baseSets] },
      baseSets,
      program: defaultProgram,
      programs: [defaultProgram],
      historicalLogs: [],
      boundary: {
        mode: 'active_live',
        targetDate: '2026-08-10',
        sessionStartedAt: 1723276800000,
      },
      sessionKind: { type: 'active_program_session', weekNum: 1 },
      activeUnit: 'kg',
      canonicalIncrement: 2.5,
      periodisationLane: {
        algorithmId: 'hypertrophy_linear',
        waveType: 'volume',
      },
      construction: {
        kind: 'weighted',
        sessionAnchor: makeAnchor(),
      },
      ...overrides,
    };
  };

  const deepFreeze = <T>(obj: T): T => {
    if (obj === null || typeof obj !== 'object') return obj;
    Object.freeze(obj);
    for (const prop of Object.getOwnPropertyNames(obj)) {
      const val = (obj as Record<string, unknown>)[prop];
      if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
        deepFreeze(val);
      }
    }
    return obj;
  };

  // 1. performance_led exact pass-through
  it('1. performance_led exact pass-through returns base sets unchanged in value', () => {
    const perfProgram: Program = {
      ...defaultProgram,
      targetProgressionMode: 'performance_led',
    };
    const input = makeInput({ program: perfProgram });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('performance_led_unchanged');
    expect(result.appliedSets).toHaveLength(3);
    expect(result.appliedSets[0].weight).toBe(80);
    expect(result.appliedSets[0].reps).toBe(8);
    expect(result.appliedSets[0].rpe).toBe(8);
    expect(result.appliedSets[1].weight).toBe(80);
    expect(result.appliedSets[2].weight).toBe(80);
  });

  // 2. performance_led does not produce Guided snapshots
  it('2. performance_led does not produce Guided snapshots', () => {
    const perfProgram: Program = {
      ...defaultProgram,
      targetProgressionMode: 'performance_led',
    };
    const input = makeInput({ program: perfProgram });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('performance_led_unchanged');
    expect(result.snapshots).toHaveLength(0);
    for (const set of result.appliedSets) {
      expect(set.prescriptionSnapshot).toBeFalsy();
    }
  });

  // 3. Guided repetition nudge application
  it('3. Guided repetition nudge application updates target reps and attaches snapshots', () => {
    const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplate(0), [
      { reps: 8, rpe: 8, weight: 80 },
      { reps: 8, rpe: 8, weight: 80 },
      { reps: 8, rpe: 8, weight: 80 },
    ]);
    const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplate(0), [
      { reps: 8, rpe: 8, weight: 80 },
      { reps: 8, rpe: 8, weight: 80 },
      { reps: 8, rpe: 8, weight: 80 },
    ]);
    const input = makeInput({
      historicalLogs: [log1, log2],
    });

    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      expect(result.coachingReasonCode).toBe('REP_NUDGE');
      expect(result.appliedSets[0].reps).toBe(9);
      expect(result.appliedSets[0].weight).toBe(80);
      expect(result.appliedSets[1].reps).toBe(8);
      expect(result.appliedSets[2].reps).toBe(8);
      expect(result.snapshots).toHaveLength(3);
      expect(result.appliedSets[0].prescriptionSnapshot).toBe(result.snapshots[0]);
    }
  });

  // 4. Guided load nudge application
  it('4. Guided load nudge application updates target load and attaches snapshots', () => {
    const strengthProgram: Program = {
      ...defaultProgram,
      objective: 'Strength',
      algorithmId: 'strength_undulating',
    };
    const laneKey = 'bench_press:weighted:main_movement:strength_undulating:sets-3:su:reps-5:rpe-8.5';
    const strengthSnapTemplate = (step: number): PrescriptionSnapshot[] =>
      [1, 2, 3].map(ord => ({
        snapshotVersion: 2,
        progressionPolicyVersion: 1,
        algorithmVersion: 1,
        progressionMode: 'metreps_guided',
        algorithmId: 'strength_undulating',
        exerciseKey: 'bench_press',
        exerciseRole: 'main_movement',
        modality: 'weighted',
        comparableLaneKey: laneKey,
        workingSetOrdinal: ord,
        prescribedWorkingSetCount: 3,
        baseWeight: 100,
        baseReps: 5,
        baseRpe: 8.5,
        presentedWeight: 100,
        presentedReps: 5,
        presentedRpe: 8.5,
        bodyweightSnapshot: null,
        weightUnit: 'kg',
        comparisonLoadKg: 100,
        loadBasis: 'external_weight_v1',
        loadIncrement: 2.5,
        nudgeType: 'none',
        coachingReasonCode: 'BASE_PRESCRIPTION',
        confirmedStepIndexBefore: step,
        presentedStepIndex: step,
        successCreditEligible: true,
        rollbackTarget: null,
      }));

    const log1 = createCompletedLog('log-1', '2026-08-01', strengthSnapTemplate(0), [
      { reps: 5, rpe: 8.5, weight: 100 },
      { reps: 5, rpe: 8.5, weight: 100 },
      { reps: 5, rpe: 8.5, weight: 100 },
    ]);
    const log2 = createCompletedLog('log-2', '2026-08-03', strengthSnapTemplate(0), [
      { reps: 5, rpe: 8.5, weight: 100 },
      { reps: 5, rpe: 8.5, weight: 100 },
      { reps: 5, rpe: 8.5, weight: 100 },
    ]);

    const baseSets: SetEntry[] = [
      { setNumber: 1, weight: 100, reps: 5, rpe: 8.5, isWarmup: false, isDropSet: false },
      { setNumber: 2, weight: 100, reps: 5, rpe: 8.5, isWarmup: false, isDropSet: false },
      { setNumber: 3, weight: 100, reps: 5, rpe: 8.5, isWarmup: false, isDropSet: false },
    ];

    const input = makeInput({
      program: strengthProgram,
      baseSets,
      periodisationLane: {
        algorithmId: 'strength_undulating',
        anchorReps: 5,
        anchorRpe: 8.5,
      },
      historicalLogs: [log1, log2],
      construction: {
        kind: 'weighted',
        sessionAnchor: makeAnchor({
          workingSetCount: 3,
          roundedAnchorWeight: 100,
          anchorReps: 5,
          anchorRPE: 8.5,
          algorithmId: 'strength_undulating',
        }),
      },
    });

    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      expect(result.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
      expect(result.appliedSets[0].weight).toBe(102.5);
      expect(result.appliedSets[1].weight).toBe(97.5);
      expect(result.appliedSets[2].weight).toBe(97.5);
      expect(result.snapshots).toHaveLength(3);
      expect(result.appliedSets[0].prescriptionSnapshot?.presentedWeight).toBe(102.5);
    }
  });

  // 5. Guided hold application with complete snapshots
  it('5. Guided hold application with complete snapshots returns guided_applied', () => {
    // Scheduled step-out hold (effectivePhase = 4 in hypertrophy_step)
    const stepProgram: Program = {
      ...defaultProgram,
      algorithmId: 'hypertrophy_step',
    };
    const input = makeInput({
      program: stepProgram,
      programs: [stepProgram],
      periodisationLane: {
        algorithmId: 'hypertrophy_step',
        effectivePhase: 4,
      },
      construction: {
        kind: 'weighted',
        sessionAnchor: makeAnchor({
          algorithmId: 'hypertrophy_step',
        }),
      },
    });

    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      expect(result.coachingReasonCode).toBe('STEP_OUT_BASE_ONLY');
      expect(result.appliedSets[0].weight).toBe(80);
      expect(result.appliedSets[0].reps).toBe(8);
      expect(result.snapshots).toHaveLength(3);
      expect(result.snapshots[0].nudgeType).toBe('hold');
      expect(result.appliedSets[0].prescriptionSnapshot).toBe(result.snapshots[0]);
    }
  });

  // 6. All selector snapshots map to their matching working-set ordinals
  it('6. All selector snapshots map to their matching working-set ordinals', () => {
    const input = makeInput();
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      expect(result.appliedSets[0].prescriptionSnapshot?.workingSetOrdinal).toBe(1);
      expect(result.appliedSets[1].prescriptionSnapshot?.workingSetOrdinal).toBe(2);
      expect(result.appliedSets[2].prescriptionSnapshot?.workingSetOrdinal).toBe(3);
    }
  });

  // 7. Multi-set prescriptions apply atomically
  it('7. Multi-set prescriptions apply atomically without leaving partial state', () => {
    const input = makeInput();
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      expect(result.appliedSets).toHaveLength(3);
      expect(result.snapshots).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(result.appliedSets[i].prescriptionSnapshot).toBe(result.snapshots[i]);
      }
    }
  });

  // 8. Non-nudged working sets preserve selector-returned base values
  it('8. Non-nudged working sets preserve selector-returned base values', () => {
    const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplate(0), [
      { reps: 8, rpe: 8, weight: 80 },
      { reps: 8, rpe: 8, weight: 80 },
      { reps: 8, rpe: 8, weight: 80 },
    ]);
    const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplate(0), [
      { reps: 8, rpe: 8, weight: 80 },
      { reps: 8, rpe: 8, weight: 80 },
      { reps: 8, rpe: 8, weight: 80 },
    ]);
    const input = makeInput({ historicalLogs: [log1, log2] });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      // Ordinal 1 is nudged to 9 reps, ordinals 2 and 3 remain at 8 reps base
      expect(result.appliedSets[0].reps).toBe(9);
      expect(result.appliedSets[1].reps).toBe(8);
      expect(result.appliedSets[2].reps).toBe(8);
      expect(result.appliedSets[1].prescriptionSnapshot?.baseReps).toBe(8);
      expect(result.appliedSets[1].prescriptionSnapshot?.presentedReps).toBe(8);
    }
  });

  // 9. Warm-up sets remain unchanged
  it('9. Warm-up sets remain unchanged', () => {
    const baseSets: SetEntry[] = [
      { setNumber: 1, weight: 40, reps: 10, rpe: 5, isWarmup: true, isDropSet: false },
      { setNumber: 2, weight: 60, reps: 5, rpe: 6, isWarmup: true, isDropSet: false },
      { setNumber: 3, weight: 80, reps: 8, rpe: 8, isWarmup: false, isDropSet: false },
      { setNumber: 4, weight: 80, reps: 8, rpe: 8, isWarmup: false, isDropSet: false },
      { setNumber: 5, weight: 80, reps: 8, rpe: 8, isWarmup: false, isDropSet: false },
    ];
    const input = makeInput({ baseSets });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      // Warmups preserved exactly
      expect(result.appliedSets[0].isWarmup).toBe(true);
      expect(result.appliedSets[0].weight).toBe(40);
      expect(result.appliedSets[0].reps).toBe(10);
      expect(result.appliedSets[0].rpe).toBe(5);
      expect(result.appliedSets[0].prescriptionSnapshot).toBeFalsy();

      expect(result.appliedSets[1].isWarmup).toBe(true);
      expect(result.appliedSets[1].weight).toBe(60);
      expect(result.appliedSets[1].reps).toBe(5);
      expect(result.appliedSets[1].rpe).toBe(6);
      expect(result.appliedSets[1].prescriptionSnapshot).toBeFalsy();

      // Prescribed working sets received snapshots and ordinals 1, 2, 3
      expect(result.appliedSets[2].prescriptionSnapshot?.workingSetOrdinal).toBe(1);
      expect(result.appliedSets[3].prescriptionSnapshot?.workingSetOrdinal).toBe(2);
      expect(result.appliedSets[4].prescriptionSnapshot?.workingSetOrdinal).toBe(3);
    }
  });

  // 10. Drop sets remain unchanged
  it('10. Drop sets remain unchanged', () => {
    const baseSets: SetEntry[] = [
      { setNumber: 1, weight: 80, reps: 8, rpe: 8, isWarmup: false, isDropSet: false },
      { setNumber: 2, weight: 80, reps: 8, rpe: 8, isWarmup: false, isDropSet: false },
      { setNumber: 3, weight: 80, reps: 8, rpe: 8, isWarmup: false, isDropSet: false },
      {
        setNumber: 4,
        weight: 60,
        reps: 10,
        rpe: 9,
        isWarmup: false,
        isDropSet: true,
        dropSubSets: [{ weight: 40, reps: 12 }],
      },
    ];
    const input = makeInput({ baseSets });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      const dropSet = result.appliedSets[3];
      expect(dropSet.isDropSet).toBe(true);
      expect(dropSet.weight).toBe(60);
      expect(dropSet.reps).toBe(10);
      expect(dropSet.dropSubSets).toEqual([{ weight: 40, reps: 12 }]);
      expect(dropSet.prescriptionSnapshot).toBeFalsy();
    }
  });

  // 11. Comments, completion flags, skipped flags, form and other unrelated metadata remain unchanged
  it('11. Comments, completion flags, skipped flags, form and other unrelated metadata remain unchanged', () => {
    const baseSets: SetEntry[] = [
      {
        setNumber: 1,
        weight: 80,
        reps: 8,
        rpe: 8,
        comment: 'Felt very smooth',
        isCompleted: true,
        isSkipped: false,
        form: 'standard',
      },
      {
        setNumber: 2,
        weight: 80,
        reps: 8,
        rpe: 8,
        comment: 'Paused rep',
        isCompleted: false,
        isSkipped: false,
      },
      {
        setNumber: 3,
        weight: 80,
        reps: 8,
        rpe: 8,
        comment: 'Skipped set',
        isCompleted: false,
        isSkipped: true,
      },
    ];
    const input = makeInput({ baseSets });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      expect(result.appliedSets[0].comment).toBe('Felt very smooth');
      expect(result.appliedSets[0].isCompleted).toBe(true);
      expect(result.appliedSets[0].form).toBe('standard');

      expect(result.appliedSets[1].comment).toBe('Paused rep');
      expect(result.appliedSets[1].isCompleted).toBe(false);

      expect(result.appliedSets[2].comment).toBe('Skipped set');
      expect(result.appliedSets[2].isSkipped).toBe(true);
    }
  });

  // 12. Bypass returns base targets with no Guided snapshots
  it('12. Bypass returns base targets with no Guided snapshots', () => {
    const input = makeInput({
      sessionKind: { type: 'one_off' },
    });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_bypassed');
    if (result.status === 'guided_bypassed') {
      expect(result.appliedSets[0].weight).toBe(80);
      expect(result.appliedSets[0].reps).toBe(8);
      expect(result.appliedSets[0].rpe).toBe(8);
      expect(result.snapshots).toHaveLength(0);
      for (const set of result.appliedSets) {
        expect(set.prescriptionSnapshot).toBeNull();
      }
    }
  });

  // 13. One-off bypass
  it('13. One-off bypass sets bypassReason ONE_OFF_SESSION', () => {
    const input = makeInput({
      sessionKind: { type: 'one_off' },
    });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_bypassed');
    if (result.status === 'guided_bypassed') {
      expect(result.bypassReason).toBe('ONE_OFF_SESSION');
      expect(result.snapshots).toHaveLength(0);
    }
  });

  // 14. Deload bypass
  it('14. Deload bypass sets bypassReason DELOAD_SESSION', () => {
    const input = makeInput({
      sessionKind: { type: 'deload' },
    });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_bypassed');
    if (result.status === 'guided_bypassed') {
      expect(result.bypassReason).toBe('DELOAD_SESSION');
      expect(result.snapshots).toHaveLength(0);
    }
  });

  // 15. Off-day bypass
  it('15. Off-day bypass sets bypassReason OFF_DAY_SESSION', () => {
    const offProgram: Program = {
      ...defaultProgram,
      objective: 'Off',
    };
    const input = makeInput({
      program: offProgram,
      programs: [offProgram],
      sessionKind: { type: 'off_day' },
    });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_bypassed');
    if (result.status === 'guided_bypassed') {
      expect(result.bypassReason).toBe('OFF_DAY_SESSION');
      expect(result.snapshots).toHaveLength(0);
    }
  });

  // 16. Unsupported-modality bypass
  it('16. Unsupported-modality bypass sets bypassReason UNSUPPORTED_MODALITY', () => {
    const input = makeInput({
      exercise: {
        ...defaultExercise,
        modality: 'timed',
      },
      construction: {
        kind: 'unsupported',
      },
    });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_bypassed');
    if (result.status === 'guided_bypassed') {
      expect(result.bypassReason).toBe('UNSUPPORTED_MODALITY');
      expect(result.snapshots).toHaveLength(0);
    }
  });

  // 17. Invalid selector input returns the explicit invalid-input fallback result
  it('17. Invalid selector input returns the explicit invalid-input fallback result with errorSource selector', () => {
    const input = makeInput({
      canonicalIncrement: -2.5, // Invalid increment
    });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_invalid_input_fallback');
    if (result.status === 'guided_invalid_input_fallback') {
      expect(result.errorSource).toBe('selector');
      expect(result.selectorError).toBe('INVALID_CANONICAL_INCREMENT');
      expect(typeof result.selectorErrorMessage).toBe('string');
      expect(Array.isArray(result.diagnostics)).toBe(true);
      expect('adapterError' in result).toBe(false);
      expect('adapterErrorMessage' in result).toBe(false);
    }
  });

  // 17a. MALFORMED_INPUT produces guided_adapter_failure_fallback with errorSource adapter
  it('17a. MALFORMED_INPUT produces guided_adapter_failure_fallback with errorSource adapter', () => {
    // @ts-expect-error test malformed non-object input
    const result = adaptGuidedExercisePrescription(null);

    expect(result.status).toBe('guided_adapter_failure_fallback');
    if (result.status === 'guided_adapter_failure_fallback') {
      expect(result.errorSource).toBe('adapter');
      expect(result.failureKind).toBe('input_validation');
      expect(result.adapterError).toBe('MALFORMED_INPUT');
      expect(result.adapterErrorMessage).toBe('Adapter input must be an object.');
      expect('selectorError' in result).toBe(false);
      expect('selectorErrorMessage' in result).toBe(false);
      expect(result.snapshots).toHaveLength(0);
      expect(result.appliedSets).toHaveLength(0);
      expect(result.diagnostics).toEqual([]);
    }
  });

  // 17b. MISSING_EXERCISE produces guided_adapter_failure_fallback with errorSource adapter
  it('17b. MISSING_EXERCISE produces guided_adapter_failure_fallback with errorSource adapter', () => {
    const input = makeInput() as unknown as Record<string, unknown>;
    delete input.exercise;
    const result = adaptGuidedExercisePrescription(input as unknown as GuidedExerciseAdapterInput);

    expect(result.status).toBe('guided_adapter_failure_fallback');
    if (result.status === 'guided_adapter_failure_fallback') {
      expect(result.errorSource).toBe('adapter');
      expect(result.failureKind).toBe('input_validation');
      expect(result.adapterError).toBe('MISSING_EXERCISE');
      expect(result.adapterErrorMessage).toBe('exercise entry is required.');
      expect('selectorError' in result).toBe(false);
      expect('selectorErrorMessage' in result).toBe(false);
      expect(result.snapshots).toHaveLength(0);
      expect(result.appliedSets).toHaveLength(3);
      expect(result.diagnostics).toEqual([]);
    }
  });

  // 18. Invalid-input fallback has base targets and no Guided snapshots
  it('18. Invalid-input fallback has base targets and no Guided snapshots', () => {
    const input = makeInput({
      canonicalIncrement: -2.5,
    });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_invalid_input_fallback');
    if (result.status === 'guided_invalid_input_fallback') {
      expect(result.errorSource).toBe('selector');
      expect(result.appliedSets[0].weight).toBe(80);
      expect(result.appliedSets[0].reps).toBe(8);
      expect(result.snapshots).toHaveLength(0);
      for (const set of result.appliedSets) {
        expect(set.prescriptionSnapshot).toBeNull();
      }
    }
  });

  // 19. Guided hold is not confused with bypass or invalid input
  it('19. Guided hold is not confused with bypass or invalid input', () => {
    const stepProgram: Program = {
      ...defaultProgram,
      algorithmId: 'hypertrophy_step',
    };
    const input = makeInput({
      program: stepProgram,
      programs: [stepProgram],
      periodisationLane: {
        algorithmId: 'hypertrophy_step',
        effectivePhase: 4,
      },
      construction: {
        kind: 'weighted',
        sessionAnchor: makeAnchor({
          algorithmId: 'hypertrophy_step',
        }),
      },
    });

    const result = adaptGuidedExercisePrescription(input);

    // Explicitly verify hold produces guided_applied, NOT guided_bypassed or guided_invalid_input_fallback
    expect(result.status).toBe('guided_applied');
    expect(result.status).not.toBe('guided_bypassed');
    expect(result.status).not.toBe('guided_invalid_input_fallback');
    if (result.status === 'guided_applied') {
      expect(result.coachingReasonCode).toBe('STEP_OUT_BASE_ONLY');
      expect(result.snapshots[0].nudgeType).toBe('hold');
      expect(result.snapshots).toHaveLength(3);
    }
  });

  // 20. No mutation of the input exercise or nested input sets
  it('20. No mutation of the input exercise or nested input sets', () => {
    const input = makeInput();
    deepFreeze(input);

    // Should execute cleanly without throwing mutation errors on frozen objects
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    expect(input.baseSets[0].weight).toBe(80);
    expect(input.baseSets[0].reps).toBe(8);
  });

  // 21. No aliasing that permits later result mutation to change the original input
  it('21. No aliasing that permits later result mutation to change the original input', () => {
    const originalBaseSets = makeBaseSets();
    const input = makeInput({ baseSets: originalBaseSets });
    const result = adaptGuidedExercisePrescription(input);

    // Mutate the result sets
    (result.appliedSets[0] as { weight: number }).weight = 999;
    (result.appliedSets[0] as { reps: number }).reps = 999;

    expect(originalBaseSets[0].weight).toBe(80);
    expect(originalBaseSets[0].reps).toBe(8);
  });

  // 22. Snapshot Version 2 / Policy 1 / Algorithm 1 fields are preserved exactly
  it('22. Snapshot Version 2 / Policy 1 / Algorithm 1 fields are preserved exactly', () => {
    const input = makeInput();
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      for (const snap of result.snapshots) {
        expect(snap.snapshotVersion).toBe(2);
        expect(snap.progressionPolicyVersion).toBe(1);
        expect(snap.algorithmVersion).toBe(1);
        expect(snap.progressionMode).toBe('metreps_guided');
      }
    }
  });

  // 23. Snapshot cardinality matches the prescribed working-set count
  it('23. Snapshot cardinality matches the prescribed working-set count', () => {
    const input = makeInput();
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      expect(result.snapshots).toHaveLength(3);
      expect(result.appliedSets).toHaveLength(3);
    }
  });

  // 24. Snapshot exercise key, lane key and ordinal identity remain intact
  it('24. Snapshot exercise key, lane key and ordinal identity remain intact', () => {
    const input = makeInput();
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      expect(result.snapshots[0].exerciseKey).toBe('bench_press');
      expect(result.snapshots[0].workingSetOrdinal).toBe(1);
      expect(result.snapshots[0].comparableLaneKey).toContain('bench_press');

      expect(result.snapshots[1].workingSetOrdinal).toBe(2);
      expect(result.snapshots[2].workingSetOrdinal).toBe(3);
    }
  });

  // 25. Cross-unit and bodyweight/assisted snapshot fields are passed through unchanged
  it('25. Cross-unit and bodyweight/assisted snapshot fields are passed through unchanged', () => {
    const bwExercise: ExerciseEntry = {
      exerciseKey: 'pull_up',
      name: 'Pull-up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      equipment: 'freeweight',
      sets: [],
    };
    const bwSets: SetEntry[] = [
      { setNumber: 1, weight: 0, reps: 6, rpe: 8, isWarmup: false, isDropSet: false },
      { setNumber: 2, weight: 0, reps: 6, rpe: 8, isWarmup: false, isDropSet: false },
    ];
    const input = makeInput({
      exercise: { ...bwExercise, sets: [...bwSets] },
      baseSets: bwSets,
      activeUnit: 'lb',
      construction: {
        kind: 'bodyweight',
        sessionBodyweight: 165,
      },
    });

    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_applied');
    if (result.status === 'guided_applied') {
      expect(result.snapshots).toHaveLength(2);
      expect(result.snapshots[0].weightUnit).toBe('lb');
      expect(result.snapshots[0].modality).toBe('bodyweight');
      expect(result.snapshots[0].bodyweightSnapshot).toBe(165);
    }
  });

  // 26. Zero working sets and mapping-invariant defensive coverage
  it('26a. Zero base working sets returns guided_invalid_input_fallback from selector', () => {
    // 0 working sets (all warmups) returns invalid_input from the selector (ZERO_BASE_WORKING_SETS)
    const allWarmups: SetEntry[] = [
      { setNumber: 1, weight: 40, reps: 10, rpe: 5, isWarmup: true },
      { setNumber: 2, weight: 60, reps: 5, rpe: 6, isWarmup: true },
    ];
    const input = makeInput({ baseSets: allWarmups });
    const result = adaptGuidedExercisePrescription(input);

    expect(result.status).toBe('guided_invalid_input_fallback');
    if (result.status === 'guided_invalid_input_fallback') {
      expect(result.errorSource).toBe('selector');
      expect(result.selectorError).toBe('INVALID_BASE_SETS');
      expect('adapterError' in result).toBe(false);
      expect('adapterErrorMessage' in result).toBe(false);
      expect(result.snapshots).toHaveLength(0);
      for (const set of result.appliedSets) {
        expect(set.prescriptionSnapshot).toBeNull();
      }
    }
  });

  describe('26b. Adapter mapping-invariant defensive coverage via pure translation seam', () => {
    const exercise = defaultExercise;
    const baseSets = makeBaseSets();
    const workingSetIndices = [0, 1, 2];

    const makeSyntheticGuidedResult = (
      workingSetCount = 3,
      snapshotOverrides?: (baseSnaps: PrescriptionSnapshot[]) => PrescriptionSnapshot[],
      prescriptionOverrides?: (basePres: { workingSetOrdinal: number; weight: number; reps: number; rpe: number }[]) => { workingSetOrdinal: number; weight: number; reps: number; rpe: number }[]
    ): SelectGuidedPrescriptionGuidedResult => {
      let basePres = Array.from({ length: workingSetCount }, (_, i) => ({
        workingSetOrdinal: i + 1,
        weight: 80,
        reps: 8,
        rpe: 8,
      }));
      let baseSnaps: PrescriptionSnapshot[] = Array.from({ length: workingSetCount }, (_, i) => ({
        snapshotVersion: 2,
        progressionPolicyVersion: 1,
        algorithmVersion: 1,
        progressionMode: 'metreps_guided',
        algorithmId: 'hypertrophy_linear',
        exerciseKey: 'bench_press',
        exerciseRole: 'main_movement',
        modality: 'weighted',
        comparableLaneKey: 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3',
        workingSetOrdinal: i + 1,
        prescribedWorkingSetCount: workingSetCount,
        baseWeight: 80,
        baseReps: 8,
        baseRpe: 8,
        presentedWeight: 80,
        presentedReps: 8,
        presentedRpe: 8,
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
      }));

      if (prescriptionOverrides) {
        basePres = prescriptionOverrides(basePres);
      }
      if (snapshotOverrides) {
        baseSnaps = snapshotOverrides(baseSnaps);
      }

      return {
        status: 'guided',
        coachingReasonCode: 'BASE_PRESCRIPTION',
        presentedPrescription: basePres,
        snapshots: baseSnaps,
        diagnostics: {
          comparableLaneKey: 'bench_press',
          narrowHistoryStatus: 'success',
          broadHistoryStatus: 'success',
          adherenceGateOpen: true,
          gateReady: true,
          successCredit: 0,
          laneReplayTrustStatus: 'trusted',
          laneReplayNextAction: 'advance',
          candidateComparisonInvoked: false,
          candidateComparisonStatus: null,
          evaluatedOrdinals: [],
          activeNudgeOrdinal: null,
          challengeCapExempt: false,
          candidateAdvancementProhibited: false,
        },
      };
    };

    // 8. Missing snapshot ordinal reaches the adapter mapping branch
    it('8. Missing snapshot ordinal reaches the adapter mapping branch', () => {
      const selectorResult = makeSyntheticGuidedResult(3, snaps => snaps.slice(0, 2));
      const result = applyGuidedSelectorResult({
        exercise,
        baseSets,
        workingSetIndices,
        selectorResult,
      });

      expect(result.status).toBe('guided_adapter_failure_fallback');
      if (result.status === 'guided_adapter_failure_fallback') {
        expect(result.errorSource).toBe('adapter');
        expect(result.failureKind).toBe('mapping_invariant');
        expect(result.adapterError).toBe('MAPPING_CARDINALITY_MISMATCH');
      }
    });

    // 9. Missing presented-prescription ordinal reaches the adapter mapping branch
    it('9. Missing presented-prescription ordinal reaches the adapter mapping branch', () => {
      const selectorResult = makeSyntheticGuidedResult(3, undefined, pres => pres.slice(0, 2));
      const result = applyGuidedSelectorResult({
        exercise,
        baseSets,
        workingSetIndices,
        selectorResult,
      });

      expect(result.status).toBe('guided_adapter_failure_fallback');
      if (result.status === 'guided_adapter_failure_fallback') {
        expect(result.errorSource).toBe('adapter');
        expect(result.failureKind).toBe('mapping_invariant');
        expect(result.adapterError).toBe('MAPPING_CARDINALITY_MISMATCH');
      }
    });

    // 10. Duplicate snapshot ordinal reaches the adapter mapping branch
    it('10. Duplicate snapshot ordinal reaches the adapter mapping branch', () => {
      const selectorResult = makeSyntheticGuidedResult(3, snaps => [
        { ...snaps[0] },
        { ...snaps[1], workingSetOrdinal: 1 },
        { ...snaps[2] },
      ]);
      const result = applyGuidedSelectorResult({
        exercise,
        baseSets,
        workingSetIndices,
        selectorResult,
      });

      expect(result.status).toBe('guided_adapter_failure_fallback');
      if (result.status === 'guided_adapter_failure_fallback') {
        expect(result.errorSource).toBe('adapter');
        expect(result.failureKind).toBe('mapping_invariant');
        expect(result.adapterError).toBe('MAPPING_CARDINALITY_MISMATCH');
      }
    });

    // 11. Duplicate prescription ordinal reaches the adapter mapping branch
    it('11. Duplicate prescription ordinal reaches the adapter mapping branch', () => {
      const selectorResult = makeSyntheticGuidedResult(3, undefined, pres => [
        { ...pres[0] },
        { ...pres[1], workingSetOrdinal: 1 },
        { ...pres[2] },
      ]);
      const result = applyGuidedSelectorResult({
        exercise,
        baseSets,
        workingSetIndices,
        selectorResult,
      });

      expect(result.status).toBe('guided_adapter_failure_fallback');
      if (result.status === 'guided_adapter_failure_fallback') {
        expect(result.errorSource).toBe('adapter');
        expect(result.failureKind).toBe('mapping_invariant');
        expect(result.adapterError).toBe('MAPPING_CARDINALITY_MISMATCH');
      }
    });

    // 12. Out-of-range ordinal reaches the adapter mapping branch
    it('12. Out-of-range ordinal reaches the adapter mapping branch', () => {
      const selectorResult = makeSyntheticGuidedResult(3, snaps => [
        { ...snaps[0] },
        { ...snaps[1] },
        { ...snaps[2], workingSetOrdinal: 4 },
      ]);
      const result = applyGuidedSelectorResult({
        exercise,
        baseSets,
        workingSetIndices,
        selectorResult,
      });

      expect(result.status).toBe('guided_adapter_failure_fallback');
      if (result.status === 'guided_adapter_failure_fallback') {
        expect(result.errorSource).toBe('adapter');
        expect(result.failureKind).toBe('mapping_invariant');
        expect(result.adapterError).toBe('MAPPING_CARDINALITY_MISMATCH');
      }
    });

    // 13. Reordered or non-contiguous ordinals reach the adapter mapping branch
    it('13. Reordered or non-contiguous ordinals reach the adapter mapping branch', () => {
      const selectorResult = makeSyntheticGuidedResult(3, snaps => [
        { ...snaps[1], workingSetOrdinal: 2 },
        { ...snaps[0], workingSetOrdinal: 1 },
        { ...snaps[2], workingSetOrdinal: 3 },
      ]);
      const result = applyGuidedSelectorResult({
        exercise,
        baseSets,
        workingSetIndices,
        selectorResult,
      });

      expect(result.status).toBe('guided_adapter_failure_fallback');
      if (result.status === 'guided_adapter_failure_fallback') {
        expect(result.errorSource).toBe('adapter');
        expect(result.failureKind).toBe('mapping_invariant');
        expect(result.adapterError).toBe('MAPPING_CARDINALITY_MISMATCH');
      }
    });

    // 14. Snapshot/prescription ordinal disagreement reaches the adapter mapping branch
    it('14. Snapshot/prescription ordinal disagreement reaches the adapter mapping branch', () => {
      const selectorResult = makeSyntheticGuidedResult(
        3,
        undefined,
        pres => [
          { ...pres[0], workingSetOrdinal: 1 },
          { ...pres[2], workingSetOrdinal: 3 },
          { ...pres[1], workingSetOrdinal: 2 },
        ]
      );
      const result = applyGuidedSelectorResult({
        exercise,
        baseSets,
        workingSetIndices,
        selectorResult,
      });

      expect(result.status).toBe('guided_adapter_failure_fallback');
      if (result.status === 'guided_adapter_failure_fallback') {
        expect(result.errorSource).toBe('adapter');
        expect(result.failureKind).toBe('mapping_invariant');
        expect(result.adapterError).toBe('MAPPING_CARDINALITY_MISMATCH');
      }
    });

    // 15-24. Complete mapping failure contract assertions
    it('15-24. Complete mapping failure contract assertions', () => {
      const frozenBaseSets = deepFreeze(makeBaseSets());
      const frozenExercise = deepFreeze({ ...defaultExercise, sets: [...frozenBaseSets] });

      const malformedResult = makeSyntheticGuidedResult(3, snaps => snaps.slice(0, 1));
      const result = applyGuidedSelectorResult({
        exercise: frozenExercise,
        baseSets: frozenBaseSets,
        workingSetIndices,
        selectorResult: malformedResult,
      });

      // 15. Mapping failure returns guided_adapter_failure_fallback
      expect(result.status).toBe('guided_adapter_failure_fallback');
      if (result.status === 'guided_adapter_failure_fallback') {
        // 16. Mapping failure uses failureKind: mapping_invariant
        expect(result.failureKind).toBe('mapping_invariant');
        // 17. Mapping failure uses adapterError: MAPPING_CARDINALITY_MISMATCH
        expect(result.adapterError).toBe('MAPPING_CARDINALITY_MISMATCH');
        expect(result.adapterErrorMessage).toBe(
          'Ordinal or cardinality mismatch between selector output and base working sets.'
        );
        // 18. Mapping failure contains no selectorError property
        expect('selectorError' in result).toBe(false);
        expect('selectorErrorMessage' in result).toBe(false);
        // 20. Mapping failure returns zero snapshots
        expect(result.snapshots).toHaveLength(0);
        // 21. Mapping failure strips any Guided snapshots from fallback working sets
        for (const set of result.appliedSets) {
          expect(set.prescriptionSnapshot).toBeNull();
        }
        // 22. Mapping failure preserves safe base weight, reps and RPE
        expect(result.appliedSets[0].weight).toBe(80);
        expect(result.appliedSets[0].reps).toBe(8);
        expect(result.appliedSets[0].rpe).toBe(8);
        expect(result.appliedSets[1].weight).toBe(80);
        expect(result.appliedSets[1].reps).toBe(8);
        expect(result.appliedSets[1].rpe).toBe(8);
        expect(result.appliedSets[2].weight).toBe(80);
        expect(result.appliedSets[2].reps).toBe(8);
        expect(result.appliedSets[2].rpe).toBe(8);
        // 23. Mapping failure cannot return a partially transformed exercise
        expect(result.exercise.sets).toEqual(result.appliedSets);
        // 24. Mapping failure does not mutate the input (frozenBaseSets unchanged)
        expect(frozenBaseSets[0].weight).toBe(80);
        expect(frozenBaseSets[0].reps).toBe(8);
      }
    });
  });

  // 27. The five result statuses remain exhaustively discriminated by TypeScript
  it('27. The five result statuses remain exhaustively discriminated by TypeScript', () => {
    const checkExhaustiveness = (res: GuidedExerciseAdapterResult): string => {
      switch (res.status) {
        case 'performance_led_unchanged':
          return 'perf';
        case 'guided_applied':
          return `applied:${res.coachingReasonCode}`;
        case 'guided_bypassed':
          return `bypassed:${res.bypassReason}`;
        case 'guided_invalid_input_fallback':
          return `selector_fallback:${res.errorSource}:${res.selectorError}`;
        case 'guided_adapter_failure_fallback':
          return `adapter_fallback:${res.errorSource}:${res.failureKind}:${res.adapterError}`;
        default: {
          const _exhaustive: never = res;
          return _exhaustive;
        }
      }
    };

    const res1 = adaptGuidedExercisePrescription(
      makeInput({ program: { ...defaultProgram, targetProgressionMode: 'performance_led' } })
    );
    expect(checkExhaustiveness(res1)).toBe('perf');

    const res2 = adaptGuidedExercisePrescription(makeInput());
    expect(checkExhaustiveness(res2)).toContain('applied');

    const res3 = adaptGuidedExercisePrescription(makeInput({ sessionKind: { type: 'one_off' } }));
    expect(checkExhaustiveness(res3)).toBe('bypassed:ONE_OFF_SESSION');

    const res4 = adaptGuidedExercisePrescription(makeInput({ canonicalIncrement: -1 }));
    expect(checkExhaustiveness(res4)).toBe('selector_fallback:selector:INVALID_CANONICAL_INCREMENT');

    // @ts-expect-error test malformed input
    const res5 = adaptGuidedExercisePrescription(null);
    expect(checkExhaustiveness(res5)).toBe('adapter_fallback:adapter:input_validation:MALFORMED_INPUT');
  });

  it('adaptExercisePrescription is exported as an alias of adaptGuidedExercisePrescription', () => {
    expect(adaptExercisePrescription).toBe(adaptGuidedExercisePrescription);
  });

  describe('isPrescribedWorkingSet predicate', () => {
    it('returns true for standard working sets', () => {
      expect(isPrescribedWorkingSet({ setNumber: 1, weight: 100, reps: 5 })).toBe(true);
      expect(isPrescribedWorkingSet({ setNumber: 1, isWarmup: false, isDropSet: false })).toBe(true);
    });

    it('returns false for warm-up sets', () => {
      expect(isPrescribedWorkingSet({ setNumber: 1, isWarmup: true })).toBe(false);
    });

    it('returns false for drop sets', () => {
      expect(isPrescribedWorkingSet({ setNumber: 1, isDropSet: true })).toBe(false);
      expect(
        isPrescribedWorkingSet({
          setNumber: 1,
          isDropSet: false,
          dropSubSets: [{ weight: 50, reps: 10 }],
        })
      ).toBe(false);
    });

    it('returns false for null/undefined/non-objects', () => {
      expect(isPrescribedWorkingSet(null)).toBe(false);
      expect(isPrescribedWorkingSet(undefined)).toBe(false);
    });
  });

  describe('Test H: Imperial Multi-Set Half-Grid Authority Separation (I1-RC2)', () => {
    it('applies +5.0 lb advancement to 187.5 lb base anchor, yielding 192.5 lb ordinal 1 with guided_applied status', () => {
      const snapTemplateLb = (step: number, baseLoad: number = 187.5, reps: number = 15): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'bench_press',
          exerciseRole: 'main_movement',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume',
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: baseLoad,
          baseReps: reps,
          baseRpe: 8,
          presentedWeight: baseLoad,
          presentedReps: reps,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'lb',
          comparisonLoadKg: baseLoad * 0.45359237,
          loadBasis: 'external_weight_v1',
          loadIncrement: 5.0,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1: WorkoutLog = {
        ...createCompletedLog('log-h-1', '2026-08-01', snapTemplateLb(0, 187.5, 15), [
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
        ]),
        unit: 'lb',
      };
      const log2: WorkoutLog = {
        ...createCompletedLog('log-h-2', '2026-08-03', snapTemplateLb(0, 187.5, 15), [
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
        ]),
        unit: 'lb',
      };

      const baseSets: SetEntry[] = [
        { setNumber: 1, weight: 187.5, reps: 15, rpe: 8, isWarmup: false, isDropSet: false },
        { setNumber: 2, weight: 187.5, reps: 15, rpe: 8, isWarmup: false, isDropSet: false },
        { setNumber: 3, weight: 187.5, reps: 15, rpe: 8, isWarmup: false, isDropSet: false },
      ];

      const anchor: SessionAnchor = {
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        roundedAnchorWeight: 187.5,
        rawAnchorWeight: 187.5,
        anchorReps: 15,
        anchorRPE: 8,
        workingSetCount: 3,
        movementCategory: 'compound',
        equipment: 'freeweight',
        baselineE1RM: 235.0,
      };

      const input: GuidedExerciseAdapterInput = makeInput({
        baseSets,
        historicalLogs: [log1, log2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        construction: {
          kind: 'weighted',
          sessionAnchor: anchor,
        },
      });

      deepFreeze(input);

      const result = adaptGuidedExercisePrescription(input);

      // 1. Adapter returns guided_applied
      expect(result.status).toBe('guided_applied');
      expect(result.status).not.toBe('guided_bypassed');
      expect(result.status).not.toBe('guided_invalid_input_fallback');
      expect(result.status).not.toBe('guided_adapter_failure_fallback');

      if (result.status === 'guided_applied') {
        // 2. Presented ordinal 1 is 192.5 lb
        expect(result.appliedSets).toHaveLength(3);
        expect(result.appliedSets[0].weight).toBe(192.5);
        expect(result.appliedSets[0].reps).toBe(5);
        expect(result.appliedSets[0].rpe).toBe(8);

        // 3. Back-off targets lie on the 2.5 lb grid
        for (const s of result.appliedSets) {
          expect(s.weight).toBeDefined();
          expect((s.weight ?? 0) % 2.5).toBeCloseTo(0, 5);
        }

        // 4. Snapshots attached and record canonicalIncrement 5.0 lb
        expect(result.snapshots).toHaveLength(3);
        expect(result.snapshots[0].loadIncrement).toBe(5.0);
        expect(result.snapshots[0].presentedWeight).toBe(192.5);

        // 5. Atomic mapping preserves non-target metadata
        expect(result.appliedSets[0].setNumber).toBe(1);
        expect(result.appliedSets[0].isWarmup).toBe(false);
        expect(result.appliedSets[0].isDropSet).toBe(false);

        // 6. Coaching reason code reflects load advancement
        expect(result.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
      }
    });
  });
});
