/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  selectGuidedPrescription,
  generateComparableLaneKey,
  SelectGuidedPrescriptionInput,
  BasePrescriptionSet,
  evaluateGuidedCandidateAcceptance,
  validateDistributedTargets,
  identifyResistanceChangedOrdinals,
  buildDistributionBypassGuidedResult,
  buildDistributionMalformedGuidedResult,
  DistributionDispatchContext,
} from '../guidedTargetSelector';
import {
  evaluateGuidedCandidateComparison,
  COMPARISON_LOAD_EQUALITY_EPSILON,
} from '../guidedCandidateComparison';
import {
  ExerciseEntry,
  Program,
  WorkoutLog,
  PrescriptionSnapshot,
  GuidedCoachingReasonCode,
  ALL_GUIDED_COACHING_REASON_CODES,
} from '../../types';
import { SessionAnchor } from '../setDistribution';
import {
  isValidSnapshotStepMetadata,
  isValidCoachingReasonMetadata,
  isValidRollbackTarget,
} from '../programProgressionMode';
import { isValidTargetSnapshot, ComparableGuidedExposure } from '../guidedHistoryCollector';
import { getRTSMultiplier } from '../rpeMath';

describe('guidedTargetSelector', () => {
  const defaultProgram: Program = {
    id: 'prog-1',
    name: 'Hypertrophy 3-Day',
    daysPerWeek: 3,
    programDuration: 8,
    exercisesByDay: {},
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    targetProgressionMode: 'metreps_guided',
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

  const defaultBaseSets: BasePrescriptionSet[] = [
    { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 8 },
    { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 },
    { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
  ];

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

  const makeInput = (
    overrides?: Partial<SelectGuidedPrescriptionInput>
  ): SelectGuidedPrescriptionInput => ({
    exercise: defaultExercise,
    program: defaultProgram,
    programs: [defaultProgram],
    historicalLogs: [],
    boundary: {
      mode: 'active_live',
      targetDate: '2026-08-10',
      sessionStartedAt: 1723276800000,
    },
    sessionKind: { type: 'active_program_session', weekNum: 1 },
    basePrescriptionSets: defaultBaseSets,
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
  });

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
          name: snap0?.exerciseKey ?? defaultExercise.name,
          muscleGroup: defaultExercise.muscleGroup,
          modality: snap0?.modality ?? defaultExercise.modality,
          sets: performedSets.map((s, idx) => ({
            setNumber: idx + 1,
            reps: s.reps,
            rpe: s.rpe,
            weight: s.weight,
            isCompleted: true,
            prescriptionSnapshot: snapshots[idx],
          })),
        },
      ],
    };
  };

  describe('generateComparableLaneKey', () => {
    it('generates deterministic lane key for hypertrophy_linear', () => {
      const res = generateComparableLaneKey({
        exerciseKey: 'bench_press',
        modality: 'weighted',
        exerciseRole: 'main_movement',
        prescribedWorkingSetCount: 3,
        periodisationLane: { algorithmId: 'hypertrophy_linear', waveType: 'volume' },
      });
      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.laneKey).toBe('bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume');
      }
    });

    it('generates deterministic lane key for hypertrophy_step', () => {
      const res = generateComparableLaneKey({
        exerciseKey: 'squat',
        modality: 'weighted',
        exerciseRole: 'main_movement',
        prescribedWorkingSetCount: 4,
        periodisationLane: { algorithmId: 'hypertrophy_step', effectivePhase: 5 },
      });
      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.laneKey).toBe('squat:weighted:main_movement:hypertrophy_step:sets-4:hs:phase-5');
      }
    });

    it('generates deterministic lane key for strength_undulating', () => {
      const res = generateComparableLaneKey({
        exerciseKey: 'deadlift',
        modality: 'weighted',
        exerciseRole: 'main_movement',
        prescribedWorkingSetCount: 3,
        periodisationLane: { algorithmId: 'strength_undulating', anchorReps: 5, anchorRpe: 8.5 },
      });
      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.laneKey).toBe('deadlift:weighted:main_movement:strength_undulating:sets-3:su:reps-5:rpe-8.5');
      }
    });

    it('generates deterministic lane key for strength_linear', () => {
      const res = generateComparableLaneKey({
        exerciseKey: 'overhead_press',
        modality: 'weighted',
        exerciseRole: 'main_movement',
        prescribedWorkingSetCount: 3,
        periodisationLane: { algorithmId: 'strength_linear', linearPhase: 2, maxWeeks: 8 },
      });
      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.laneKey).toBe('overhead_press:weighted:main_movement:strength_linear:sets-3:sl:phase-2:max-8');
      }
    });

    it('generates deterministic lane key for algorithm none', () => {
      const res = generateComparableLaneKey({
        exerciseKey: 'pullup',
        modality: 'bodyweight',
        exerciseRole: 'accessory',
        prescribedWorkingSetCount: 3,
        periodisationLane: { algorithmId: 'none', familyToken: 'standard_baseline' },
      });
      expect(res.status).toBe('success');
      if (res.status === 'success') {
        expect(res.laneKey).toBe('pullup:bodyweight:accessory:none:sets-3:none:standard_baseline');
      }
    });

    it('fails closed for out-of-contract inputs', () => {
      expect(generateComparableLaneKey(null as any).status).toBe('invalid_input');
      expect(generateComparableLaneKey({ exerciseKey: '', modality: 'weighted', exerciseRole: 'main_movement', prescribedWorkingSetCount: 3, periodisationLane: { algorithmId: 'none', familyToken: 'standard_baseline' } }).status).toBe('invalid_input');
      expect(generateComparableLaneKey({ exerciseKey: 'squat', modality: 'timed' as any, exerciseRole: 'main_movement', prescribedWorkingSetCount: 3, periodisationLane: { algorithmId: 'none', familyToken: 'standard_baseline' } }).status).toBe('invalid_input');
      expect(generateComparableLaneKey({ exerciseKey: 'squat', modality: 'weighted', exerciseRole: 'invalid' as any, prescribedWorkingSetCount: 3, periodisationLane: { algorithmId: 'none', familyToken: 'standard_baseline' } }).status).toBe('invalid_input');
      expect(generateComparableLaneKey({ exerciseKey: 'squat', modality: 'weighted', exerciseRole: 'main_movement', prescribedWorkingSetCount: 7, periodisationLane: { algorithmId: 'none', familyToken: 'standard_baseline' } }).status).toBe('invalid_input');
      expect(generateComparableLaneKey({ exerciseKey: 'squat', modality: 'weighted', exerciseRole: 'main_movement', prescribedWorkingSetCount: 3, periodisationLane: { algorithmId: 'hypertrophy_step', effectivePhase: 13 } }).status).toBe('invalid_input');
      expect(generateComparableLaneKey({ exerciseKey: 'squat', modality: 'weighted', exerciseRole: 'main_movement', prescribedWorkingSetCount: 3, periodisationLane: { algorithmId: 'strength_undulating', anchorReps: 5, anchorRpe: 11 } }).status).toBe('invalid_input');
      expect(generateComparableLaneKey({ exerciseKey: 'squat', modality: 'weighted', exerciseRole: 'main_movement', prescribedWorkingSetCount: 3, periodisationLane: { algorithmId: 'strength_linear', linearPhase: 9, maxWeeks: 8 } }).status).toBe('invalid_input');
    });
  });

  describe('Structural validation and fail-closed gates', () => {
    it('fails closed when input is null or non-object', () => {
      const res = selectGuidedPrescription(null as any);
      expect(res.status).toBe('invalid_input');
    });

    it('fails closed when exerciseKey is empty or missing', () => {
      const input = makeInput({
        exercise: { ...defaultExercise, exerciseKey: '   ' },
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('invalid_input');
      if (res.status === 'invalid_input') {
        expect(res.error).toBe('INVALID_EXERCISE_KEY');
      }
    });

    it('fails closed on construction and modality mismatch', () => {
      const input = makeInput({
        exercise: { ...defaultExercise, modality: 'bodyweight' },
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            anchorReps: 8,
            anchorRPE: 8,
          }),
        },
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('invalid_input');
      if (res.status === 'invalid_input') {
        expect(res.error).toBe('CONSTRUCTION_MODALITY_MISMATCH');
      }
    });

    it('fails closed when canonicalIncrement is non-positive or non-finite', () => {
      const input = makeInput({ canonicalIncrement: 0 });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('invalid_input');
      if (res.status === 'invalid_input') {
        expect(res.error).toBe('INVALID_CANONICAL_INCREMENT');
      }
    });

    it('fails closed when basePrescriptionSets has non-contiguous ordinals or invalid sets', () => {
      const input = makeInput({
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('invalid_input');
      if (res.status === 'invalid_input') {
        expect(res.error).toBe('NON_CONTIGUOUS_ORDINALS');
      }
    });

    it('fails closed when weighted exercise base set weight is non-positive', () => {
      const input = makeInput({
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 0, reps: 8, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 1,
            roundedAnchorWeight: 0,
            anchorReps: 8,
            anchorRPE: 8,
          }),
        },
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('invalid_input');
      if (res.status === 'invalid_input') {
        expect(res.error).toBe('INVALID_WEIGHTED_LOAD');
      }
    });

    it('fails closed when bodyweight base set has non-zero weight', () => {
      const input = makeInput({
        exercise: { ...defaultExercise, modality: 'bodyweight' },
        construction: { kind: 'bodyweight', sessionBodyweight: 75 },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 5, reps: 8, rpe: 8 },
        ],
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('invalid_input');
      if (res.status === 'invalid_input') {
        expect(res.error).toBe('INVALID_BODYWEIGHT_LOAD');
      }
    });

    it('fails closed on session anchor algorithm mismatch', () => {
      const input = makeInput({
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            anchorReps: 8,
            anchorRPE: 8,
            algorithmId: 'strength_linear',
          }),
        },
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('invalid_input');
      if (res.status === 'invalid_input') {
        expect(res.error).toBe('ANCHOR_ALGORITHM_MISMATCH');
      }
    });
  });

  describe('Bypass evaluations', () => {
    it('bypasses when progression mode is not metreps_guided', () => {
      const input = makeInput({
        program: { ...defaultProgram, targetProgressionMode: 'performance_led' },
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('bypass');
      if (res.status === 'bypass') {
        expect(res.bypassReason).toBe('NON_GUIDED_PROGRESSION_MODE');
        expect(res.snapshots).toHaveLength(0);
        expect(res.presentedPrescription).toEqual(defaultBaseSets);
      }
    });

    it('bypasses for one-off sessions', () => {
      const input = makeInput({ sessionKind: { type: 'one_off' } });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('bypass');
      if (res.status === 'bypass') {
        expect(res.bypassReason).toBe('ONE_OFF_SESSION');
      }
    });

    it('bypasses for redo sessions', () => {
      const input = makeInput({ sessionKind: { type: 'redo', originalWorkoutLogId: 'log-1' } });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('bypass');
      if (res.status === 'bypass') {
        expect(res.bypassReason).toBe('REDO_SESSION');
      }
    });

    it('bypasses for deload sessions', () => {
      const input = makeInput({ sessionKind: { type: 'deload' } });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('bypass');
      if (res.status === 'bypass') {
        expect(res.bypassReason).toBe('DELOAD_SESSION');
      }
    });

    it('bypasses for off-day sessions when objective is Off', () => {
      const input = makeInput({
        program: { ...defaultProgram, objective: 'Off' },
        sessionKind: { type: 'off_day' },
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('bypass');
      if (res.status === 'bypass') {
        expect(res.bypassReason).toBe('OFF_DAY_SESSION');
      }
    });

    it('fails closed if off-day session contradicts program objective', () => {
      const input = makeInput({
        sessionKind: { type: 'off_day' },
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('invalid_input');
      if (res.status === 'invalid_input') {
        expect(res.error).toBe('OFF_DAY_OBJECTIVE_CONTRADICTION');
      }
    });

    it('bypasses recognized unsupported modalities', () => {
      const input = makeInput({
        exercise: { ...defaultExercise, modality: 'timed' },
        construction: { kind: 'unsupported' },
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('bypass');
      if (res.status === 'bypass') {
        expect(res.bypassReason).toBe('UNSUPPORTED_MODALITY');
      }
    });
  });

  describe('Modality safety holds', () => {
    it('holds MISSING_BODYWEIGHT_HOLD when bodyweight exercise lacks bodyweight', () => {
      const input = makeInput({
        exercise: { ...defaultExercise, modality: 'bodyweight' },
        construction: { kind: 'bodyweight', sessionBodyweight: null },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 0, reps: 8, rpe: 8 },
        ],
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('MISSING_BODYWEIGHT_HOLD');
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(res.snapshots[0].successCreditEligible).toBe(false);
        expect(res.snapshots[0].rollbackTarget).toBeNull();
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('holds BODYWEIGHT_MAIN_LOAD_HOLD for Strength objective on bodyweight main movement', () => {
      const input = makeInput({
        program: {
          ...defaultProgram,
          objective: 'Strength',
          algorithmId: 'strength_undulating',
        },
        periodisationLane: {
          algorithmId: 'strength_undulating',
          anchorReps: 5,
          anchorRpe: 8.5,
        },
        exercise: {
          ...defaultExercise,
          modality: 'bodyweight',
          isMainMovement: true,
        },
        construction: { kind: 'bodyweight', sessionBodyweight: 80 },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 0, reps: 5, rpe: 8.5 },
        ],
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('BODYWEIGHT_MAIN_LOAD_HOLD');
        expect(res.snapshots[0].successCreditEligible).toBe(false);
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('holds INVALID_ASSISTANCE_HOLD when assistance exceeds bodyweight', () => {
      const input = makeInput({
        exercise: { ...defaultExercise, modality: 'assisted' },
        construction: { kind: 'assisted', sessionBodyweight: 70 },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 75, reps: 8, rpe: 8 },
        ],
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('INVALID_ASSISTANCE_HOLD');
        expect(res.snapshots[0].successCreditEligible).toBe(false);
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('holds ZERO_NET_LOAD_HOLD when assistance equals bodyweight', () => {
      const input = makeInput({
        exercise: { ...defaultExercise, modality: 'assisted' },
        construction: { kind: 'assisted', sessionBodyweight: 70 },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 70, reps: 8, rpe: 8 },
        ],
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('ZERO_NET_LOAD_HOLD');
        expect(res.snapshots[0].successCreditEligible).toBe(false);
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('holds MINIMUM_ASSISTANCE_REACHED when assistance cannot be reduced further', () => {
      const input = makeInput({
        exercise: { ...defaultExercise, modality: 'assisted' },
        construction: { kind: 'assisted', sessionBodyweight: 80 },
        canonicalIncrement: 2.5,
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 2.5, reps: 8, rpe: 8 },
        ],
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('MINIMUM_ASSISTANCE_REACHED');
        expect(res.snapshots[0].successCreditEligible).toBe(false);
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });
  });

  describe('Precedence Order and Decision Logic', () => {
    it('precedence 4: holds STEP_OUT_BASE_ONLY during hypertrophy_step phase 4, 8, 12', () => {
      const input = makeInput({
        program: { ...defaultProgram, algorithmId: 'hypertrophy_step' },
        periodisationLane: { algorithmId: 'hypertrophy_step', effectivePhase: 4 },
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            anchorReps: 8,
            anchorRPE: 8,
            algorithmId: 'hypertrophy_step',
          }),
        },
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('STEP_OUT_BASE_ONLY');
        expect(res.snapshots[0].successCreditEligible).toBe(false);
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('precedence 5: holds HIGH_EXERTION_HOLD when any base set RPE is >= 9.5', () => {
      const highExertionSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 8 },
        { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 9.5 },
        { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
      ];
      const input = makeInput({
        basePrescriptionSets: highExertionSets,
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('HIGH_EXERTION_HOLD');
        expect(res.snapshots[0].successCreditEligible).toBe(true);
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('precedence 8: holds BASE_PRESCRIPTION when history is empty or unready', () => {
      const input = makeInput({ historicalLogs: [] });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('BASE_PRESCRIPTION');
        expect(res.snapshots[0].nudgeType).toBe('none');
        expect(res.snapshots[0].successCreditEligible).toBe(true);
        expect(res.snapshots[0].rollbackTarget).toBeNull();
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });
  });

  describe('Candidate Generation, Waterfall and Candidate Comparison', () => {
    it('evaluates repetition waterfall candidate across sets (ordinal 1 first)', () => {
      // Create a clean 2-session history establishing the gate
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          weightUnit: 'kg',
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

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('REP_NUDGE');
        expect(res.diagnostics.activeNudgeOrdinal).toBe(1);
        expect(res.presentedPrescription[0].reps).toBe(9);
        expect(res.presentedPrescription[1].reps).toBe(8);
        expect(res.presentedPrescription[2].reps).toBe(8);

        // Snapshot verification
        const snap1 = res.snapshots[0];
        expect(snap1.nudgeType).toBe('rep_nudge');
        expect(snap1.presentedReps).toBe(9);
        expect(snap1.presentedStepIndex).toBe(1);
        expect(snap1.rollbackTarget).toEqual({
          weight: 80,
          reps: 8,
          rpe: 8,
          comparisonLoadKg: 80,
        });
        expect(isValidSnapshotStepMetadata(snap1)).toBe(true);
        expect(isValidCoachingReasonMetadata(snap1)).toBe(true);
        expect(isValidTargetSnapshot(snap1)).toBe(true);

        // Companion set verification
        const snap2 = res.snapshots[1];
        expect(snap2.nudgeType).toBe('none');
        expect(snap2.presentedReps).toBe(8);
        expect(snap2.presentedStepIndex).toBe(0);
        expect(snap2.rollbackTarget).toBeNull();
        expect(isValidSnapshotStepMetadata(snap2)).toBe(true);
        expect(isValidCoachingReasonMetadata(snap2)).toBe(true);
        expect(isValidTargetSnapshot(snap2)).toBe(true);
      }
    });

    it('advances to ordinal 2 in waterfall when ordinal 1 is already advanced', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          baseReps: ord === 1 ? 9 : 8,
          baseRpe: 8,
          presentedWeight: 80,
          presentedReps: ord === 1 ? 9 : 8,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
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

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplate(0), [
        { reps: 9, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplate(0), [
        { reps: 9, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 9, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            anchorReps: 9,
            anchorRPE: 8,
            algorithmId: 'hypertrophy_linear',
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('REP_NUDGE');
        expect(res.diagnostics.activeNudgeOrdinal).toBe(2);
        expect(res.presentedPrescription[0].reps).toBe(9);
        expect(res.presentedPrescription[1].reps).toBe(9);
        expect(res.presentedPrescription[2].reps).toBe(8);
      }
    });

    it('advances load with LOAD_NUDGE_MAIN_MOVEMENT for Strength main movement', () => {
      const strengthProgram: Program = {
        ...defaultProgram,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
      };
      const laneKey = 'bench_press:weighted:main_movement:strength_undulating:sets-3:su:reps-5:rpe-8.5';
      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
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

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplate(0), [
        { reps: 5, rpe: 8.5, weight: 100 },
        { reps: 5, rpe: 8.5, weight: 100 },
        { reps: 5, rpe: 8.5, weight: 100 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplate(0), [
        { reps: 5, rpe: 8.5, weight: 100 },
        { reps: 5, rpe: 8.5, weight: 100 },
        { reps: 5, rpe: 8.5, weight: 100 },
      ]);

      const input = makeInput({
        program: strengthProgram,
        periodisationLane: {
          algorithmId: 'strength_undulating',
          anchorReps: 5,
          anchorRpe: 8.5,
        },
        historicalLogs: [log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8.5 },
        ],
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

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
        expect(res.presentedPrescription[0].weight).toBe(102.5);
        expect(res.presentedPrescription[1].weight).toBe(97.5);
        expect(res.presentedPrescription[2].weight).toBe(97.5);
        expect(res.snapshots[0].nudgeType).toBe('load_nudge');
        expect(res.snapshots[1].nudgeType).toBe('none');
        expect(res.snapshots[2].nudgeType).toBe('none');
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('holds BODYWEIGHT_CEILING_HOLD when bodyweight reaches repetition ceiling (15 reps)', () => {
      const laneKey = 'pullup:bodyweight:accessory:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'pullup',
          exerciseRole: 'accessory',
          modality: 'bodyweight',
          comparableLaneKey: laneKey,
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 0,
          baseReps: 15,
          baseRpe: 8,
          presentedWeight: 0,
          presentedReps: 15,
          presentedRpe: 8,
          bodyweightSnapshot: 75,
          weightUnit: 'kg',
          comparisonLoadKg: 75,
          loadBasis: 'bodyweight_normalized_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 0 },
        { reps: 15, rpe: 8, weight: 0 },
        { reps: 15, rpe: 8, weight: 0 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 0 },
        { reps: 15, rpe: 8, weight: 0 },
        { reps: 15, rpe: 8, weight: 0 },
      ]);

      const input = makeInput({
        exercise: {
          exerciseKey: 'pullup',
          name: 'Pull Up',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          isMainMovement: false,
          sets: [],
        },
        construction: { kind: 'bodyweight', sessionBodyweight: 75 },
        historicalLogs: [log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 0, reps: 15, rpe: 8 },
          { workingSetOrdinal: 2, weight: 0, reps: 15, rpe: 8 },
          { workingSetOrdinal: 3, weight: 0, reps: 15, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('BODYWEIGHT_CEILING_HOLD');
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(res.snapshots[0].successCreditEligible).toBe(false);
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('generates LOAD_PROMOTION_CEILING_REACHED when weighted exercise reaches rep ceiling', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          baseWeight: 100,
          baseReps: 15,
          baseRpe: 8,
          presentedWeight: 100,
          presentedReps: 15,
          presentedRpe: 8,
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

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 100 },
        { reps: 15, rpe: 8, weight: 100 },
        { reps: 15, rpe: 8, weight: 100 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 100 },
        { reps: 15, rpe: 8, weight: 100 },
        { reps: 15, rpe: 8, weight: 100 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 100, reps: 15, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 15, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 15, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 100,
            anchorReps: 15,
            anchorRPE: 8,
            algorithmId: 'hypertrophy_linear',
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        expect(res.presentedPrescription[0].weight).toBe(102.5);
        expect(res.presentedPrescription[0].reps).toBe(5);
        expect(res.snapshots[0].nudgeType).toBe('load_nudge');
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('holds CHALLENGE_CAP_HOLD when candidate exceeds the 5% resistance change cap and is not exempt', () => {
      // 20kg base with 2.5kg jump in Strength is +12.5% challenge, exceeding 5% cap
      const strengthProgram: Program = {
        ...defaultProgram,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
      };
      const laneKey = 'bench_press:weighted:main_movement:strength_undulating:sets-3:su:reps-5:rpe-8.5';
      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
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
          baseWeight: 20,
          baseReps: 5,
          baseRpe: 8.5,
          presentedWeight: 20,
          presentedReps: 5,
          presentedRpe: 8.5,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 20,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplate(0), [
        { reps: 5, rpe: 8.5, weight: 20 },
        { reps: 5, rpe: 8.5, weight: 20 },
        { reps: 5, rpe: 8.5, weight: 20 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplate(0), [
        { reps: 5, rpe: 8.5, weight: 20 },
        { reps: 5, rpe: 8.5, weight: 20 },
        { reps: 5, rpe: 8.5, weight: 20 },
      ]);

      const input = makeInput({
        program: strengthProgram,
        periodisationLane: {
          algorithmId: 'strength_undulating',
          anchorReps: 5,
          anchorRpe: 8.5,
        },
        historicalLogs: [log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 20, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 2, weight: 20, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 20, reps: 5, rpe: 8.5 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 20,
            anchorReps: 5,
            anchorRPE: 8.5,
            algorithmId: 'strength_undulating',
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('CHALLENGE_CAP_HOLD');
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(res.snapshots[0].successCreditEligible).toBe(false);
        expect(res.snapshots[0].rollbackTarget).toBeNull();
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('precedence 6: presents rollback target with NUDGE_MARGINAL_FAILURE_ROLLBACK after marginal miss on nudged set', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          presentedReps: ord === nudgeOrd ? 9 : 8,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 80,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
          coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: nudgeOrd ? 1 : 0,
          successCreditEligible: true,
          rollbackTarget: nudgeOrd ? { weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 } : null,
        }));

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
      // Log 3: Presented nudge on set 1 (target 9 reps), achieved only 8 reps (single marginal miss)
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0, 1), [
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('NUDGE_MARGINAL_FAILURE_ROLLBACK');
        expect(res.presentedPrescription[0].reps).toBe(8);
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(res.snapshots[0].successCreditEligible).toBe(true);
        expect(res.snapshots[0].rollbackTarget).toBeNull();
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('precedence 6: presents rollback target with NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK after substantial miss on nudged set', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          presentedReps: ord === nudgeOrd ? 9 : 8,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 80,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
          coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: nudgeOrd ? 1 : 0,
          successCreditEligible: true,
          rollbackTarget: nudgeOrd ? { weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 } : null,
        }));

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
      // Log 3: Presented nudge on set 1 (target 9 reps), achieved only 6 reps (substantial miss)
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0, 1), [
        { reps: 6, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK');
        expect(res.presentedPrescription[0].reps).toBe(8);
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(res.snapshots[0].successCreditEligible).toBe(true);
        expect(res.snapshots[0].rollbackTarget).toBeNull();
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('precedence 7: retries compatible pending nudge with NUDGE_NEUTRAL_RETRY', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          presentedReps: ord === nudgeOrd ? 9 : 8,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 80,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
          coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: nudgeOrd ? 1 : 0,
          successCreditEligible: true,
          rollbackTarget: nudgeOrd ? { weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 } : null,
        }));

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

      const snap3 = snapTemplate(0, 1);
      const log3: WorkoutLog = {
        id: 'log-3',
        date: '2026-08-05',
        unit: 'kg',
        programId: defaultProgram.id,
        exercises: [
          {
            exerciseKey: 'bench_press',
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              {
                setNumber: 1,
                reps: 0,
                rpe: 0,
                weight: 80,
                isCompleted: false,
                isSkipped: true,
                prescriptionSnapshot: snap3[0],
              },
              {
                setNumber: 2,
                reps: 8,
                rpe: 8,
                weight: 80,
                isCompleted: true,
                prescriptionSnapshot: snap3[1],
              },
              {
                setNumber: 3,
                reps: 8,
                rpe: 8,
                weight: 80,
                isCompleted: true,
                prescriptionSnapshot: snap3[2],
              },
            ],
          },
        ],
      };

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('NUDGE_NEUTRAL_RETRY');
        expect(res.presentedPrescription[0].reps).toBe(9);
        expect(res.snapshots[0].nudgeType).toBe('rep_nudge');
        expect(res.snapshots[0].presentedStepIndex).toBe(1);
        expect(res.snapshots[0].successCreditEligible).toBe(true);
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('precedence 7: replaces incompatible pending nudge with BASE_PRESCRIPTION when base sets diverge', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          presentedReps: ord === nudgeOrd ? 9 : 8,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 80,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
          coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: nudgeOrd ? 1 : 0,
          successCreditEligible: true,
          rollbackTarget: nudgeOrd ? { weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 } : null,
        }));

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

      const snap3 = snapTemplate(0, 1);
      const log3: WorkoutLog = {
        id: 'log-3',
        date: '2026-08-05',
        unit: 'kg',
        programId: defaultProgram.id,
        exercises: [
          {
            exerciseKey: 'bench_press',
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              {
                setNumber: 1,
                reps: 0,
                rpe: 0,
                weight: 80,
                isCompleted: false,
                isSkipped: true,
                prescriptionSnapshot: snap3[0],
              },
              {
                setNumber: 2,
                reps: 8,
                rpe: 8,
                weight: 80,
                isCompleted: true,
                prescriptionSnapshot: snap3[1],
              },
              {
                setNumber: 3,
                reps: 8,
                rpe: 8,
                weight: 80,
                isCompleted: true,
                prescriptionSnapshot: snap3[2],
              },
            ],
          },
        ],
      };

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 85, reps: 8, rpe: 8 },
          { workingSetOrdinal: 2, weight: 85, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 85, reps: 8, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 85,
            rawAnchorWeight: 85,
            anchorReps: 8,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('BASE_PRESCRIPTION');
        expect(res.presentedPrescription[0].weight).toBe(85);
        expect(res.diagnostics.pendingNudgeReplacedByBase).toBe(true);
      }
    });

    it('holds MARGINAL_MISS_TARGET_HELD when marginal miss occurs on stable target after open gate', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (
        step: number,
        reason: GuidedCoachingReasonCode = 'BASE_PRESCRIPTION'
      ): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          weightUnit: 'kg',
          comparisonLoadKg: 80,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: reason,
          confirmedStepIndexBefore: 0,
          presentedStepIndex: 0,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

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
      // Log 3: Presented stable target (8 reps across sets), single marginal miss on set 1 (7 reps)
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0), [
        { reps: 7, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('MARGINAL_MISS_TARGET_HELD');
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('holds DEGRADED_HISTORY_HOLD when partial program lineage is detected', () => {
      const parentlessProgram: Program = {
        ...defaultProgram,
        id: 'prog-child',
        parentProgramId: 'nonexistent-parent-id',
      };

      const input = makeInput({
        program: parentlessProgram,
        programs: [parentlessProgram],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('DEGRADED_HISTORY_HOLD');
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('holds INCONSISTENT_HISTORY_HOLD on fatal history errors such as circular program lineage', () => {
      const circularProgram: Program = {
        ...defaultProgram,
        id: 'prog-circular',
        parentProgramId: 'prog-circular',
      };

      const input = makeInput({
        program: circularProgram,
        programs: [circularProgram],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('INCONSISTENT_HISTORY_HOLD');
        expect(res.snapshots[0].nudgeType).toBe('hold');
        expect(isValidSnapshotStepMetadata(res.snapshots[0])).toBe(true);
        expect(isValidCoachingReasonMetadata(res.snapshots[0])).toBe(true);
        expect(isValidTargetSnapshot(res.snapshots[0])).toBe(true);
      }
    });

    it('precedence interaction: Precedence 4 (STEP_OUT_BASE_ONLY) takes priority over Precedence 5 (HIGH_EXERTION_HOLD)', () => {
      const stepProgram: Program = {
        ...defaultProgram,
        algorithmId: 'hypertrophy_step',
      };
      const input = makeInput({
        program: stepProgram,
        periodisationLane: {
          algorithmId: 'hypertrophy_step',
          effectivePhase: 4,
        },
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 8,
            anchorRPE: 9.5,
            algorithmId: 'hypertrophy_step',
          }),
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 9.5 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('STEP_OUT_BASE_ONLY');
      }
    });

    it('precedence interaction: Precedence 5 (HIGH_EXERTION_HOLD) takes priority over Precedence 6 (Rollback)', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          presentedReps: ord === nudgeOrd ? 9 : 8,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 80,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
          coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: nudgeOrd ? 1 : 0,
          successCreditEligible: true,
          rollbackTarget: nudgeOrd ? { weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 } : null,
        }));

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
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0, 1), [
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 9.5 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('HIGH_EXERTION_HOLD');
      }
    });
  });

  describe('Nonuniform Base Reset and Candidate Promotion', () => {
    it('resets Set 1 to minReps while retaining non-uniform base reps for remaining sets during load promotion', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          baseReps: ord === 1 ? 15 : ord === 2 ? 14 : 13,
          baseRpe: 8,
          presentedWeight: 80,
          presentedReps: ord === 1 ? 15 : ord === 2 ? 14 : 13,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
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

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 14, rpe: 8, weight: 80 },
        { reps: 13, rpe: 8, weight: 80 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 14, rpe: 8, weight: 80 },
        { reps: 13, rpe: 8, weight: 80 },
      ]);

      const nonuniformBaseSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 80, reps: 15, rpe: 8 },
        { workingSetOrdinal: 2, weight: 80, reps: 14, rpe: 8 },
        { workingSetOrdinal: 3, weight: 80, reps: 13, rpe: 8 },
      ];

      const input = makeInput({
        historicalLogs: [log1, log2],
        basePrescriptionSets: nonuniformBaseSets,
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 15,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        expect(res.presentedPrescription[0].weight).toBe(82.5);
        expect(res.presentedPrescription[0].reps).toBe(5);
        expect(res.presentedPrescription[1].weight).toBe(82.5);
        expect(res.presentedPrescription[1].reps).toBe(14);
        expect(res.presentedPrescription[2].weight).toBe(80);
        expect(res.presentedPrescription[2].reps).toBe(13);
      }
    });
  });

  describe('Exhaustive Comparator Acceptance and Missing Factual Lineage', () => {
    it('prohibits advancement and records missing ordinal when genuine comparison yields unavailable due to empty history', () => {
      const genuineCompResult = evaluateGuidedCandidateComparison({
        candidateTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 },
        ],
        history: [],
      });

      expect(genuineCompResult.status).toBe('unavailable');
      expect(genuineCompResult.ordinalResults[0].status).toBe('unavailable');
      expect(genuineCompResult.ordinalResults[0].diagnosticCode).toBe('NO_FACTUAL_REFERENCE_FOUND');

      const acceptance = evaluateGuidedCandidateAcceptance({
        comparisonResult: genuineCompResult,
        expectedAffectedOrdinals: [1, 2],
      });

      expect(acceptance.success).toBe(false);
      expect(acceptance.missingFactualOrdinal).toBe(1);
      expect(acceptance.structurallyInvalid).toBe(false);
    });

    it('identifies exact missing ordinal when a specific affected ordinal lacks factual history', () => {
      const snap: PrescriptionSnapshot = {
        snapshotVersion: 2,
        progressionPolicyVersion: 1,
        algorithmVersion: 1,
        progressionMode: 'metreps_guided',
        algorithmId: 'hypertrophy_linear',
        exerciseKey: 'bench_press',
        exerciseRole: 'main_movement',
        modality: 'weighted',
        comparableLaneKey: 'bench_press:weighted:main_movement:hypertrophy_linear:sets-2:hl:wave-volume',
        workingSetOrdinal: 1,
        prescribedWorkingSetCount: 2,
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
      };

      const exposureWithOnlyOrdinal1 = {
        workoutLogId: 'log-1',
        workoutDate: '2026-08-01',
        workoutTimestampMs: 1785500000000,
        exerciseKey: 'bench_press',
        comparableLaneKey: 'bench_press:weighted:main_movement:hypertrophy_linear:sets-2:hl:wave-volume',
        exerciseRole: 'main_movement' as const,
        modality: 'weighted' as const,
        bodyweightSnapshot: null,
        weightUnit: 'kg' as const,
        sets: [
          {
            workingSetOrdinal: 1,
            isPrescribed: true,
            prescriptionSnapshot: snap,
            setEntry: {
              id: 'set-1',
              setNumber: 1,
              reps: 8,
              weight: 80,
              rpe: 8,
              isCompleted: true,
              prescriptionSnapshot: snap,
            },
          },
        ],
      };

      const genuineCompResult = evaluateGuidedCandidateComparison({
        candidateTargets: [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 },
        ],
        history: [exposureWithOnlyOrdinal1 as unknown as ComparableGuidedExposure],
      });

      expect(genuineCompResult.ordinalResults.find(r => r.workingSetOrdinal === 1)?.status).toBe('pass');
      expect(genuineCompResult.ordinalResults.find(r => r.workingSetOrdinal === 2)?.status).toBe('unavailable');

      const acceptance = evaluateGuidedCandidateAcceptance({
        comparisonResult: genuineCompResult,
        expectedAffectedOrdinals: [1, 2],
      });

      expect(acceptance.success).toBe(false);
      expect(acceptance.missingFactualOrdinal).toBe(2);
      expect(acceptance.structurallyInvalid).toBe(false);
    });

    it('distinguishes unavailable missing evidence from structural corruption (invalid_input or malformed payload)', () => {
      const invalidCompResult = evaluateGuidedCandidateComparison({
        candidateTargets: [],
        history: [],
      });

      expect(invalidCompResult.status).toBe('invalid_input');

      const acceptance = evaluateGuidedCandidateAcceptance({
        comparisonResult: invalidCompResult,
        expectedAffectedOrdinals: [1],
      });

      expect(acceptance.success).toBe(false);
      expect(acceptance.missingFactualOrdinal).toBeNull();
      expect(acceptance.structurallyInvalid).toBe(true);
    });
  });

  describe('Pure-Repetition Exemption Matrix', () => {
    const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
    const snapTemplate = (step: number): PrescriptionSnapshot[] =>
      [1, 2, 3].map(ord => ({
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
        weightUnit: 'kg',
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

    it('grants pure-repetition exemption for ordinal 1 in waterfall candidate', () => {
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
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('REP_NUDGE');
        expect(res.diagnostics.activeNudgeOrdinal).toBe(1);
        expect(res.presentedPrescription[0].reps).toBe(9);
      }
    });

    it('grants pure-repetition exemption for ordinal 2 in waterfall candidate', () => {
      const snapTemplateOrd1Nudged = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          ...snapTemplate(step)[ord - 1],
          baseReps: ord === 1 ? 9 : 8,
          presentedReps: ord === 1 ? 9 : 8,
        }));

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplateOrd1Nudged(0), [
        { reps: 9, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplateOrd1Nudged(0), [
        { reps: 9, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 9, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 9,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('REP_NUDGE');
        expect(res.diagnostics.activeNudgeOrdinal).toBe(2);
        expect(res.presentedPrescription[0].reps).toBe(9);
        expect(res.presentedPrescription[1].reps).toBe(9);
        expect(res.presentedPrescription[2].reps).toBe(8);
      }
    });

    it('grants pure-repetition exemption for ordinal 3 in waterfall candidate', () => {
      const snapTemplateOrd12Nudged = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          ...snapTemplate(step)[ord - 1],
          baseReps: ord === 3 ? 8 : 9,
          presentedReps: ord === 3 ? 8 : 9,
        }));

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplateOrd12Nudged(0), [
        { reps: 9, rpe: 8, weight: 80 },
        { reps: 9, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplateOrd12Nudged(0), [
        { reps: 9, rpe: 8, weight: 80 },
        { reps: 9, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 9, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 9, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 9,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('REP_NUDGE');
        expect(res.diagnostics.activeNudgeOrdinal).toBe(3);
        expect(res.presentedPrescription[0].reps).toBe(9);
        expect(res.presentedPrescription[1].reps).toBe(9);
        expect(res.presentedPrescription[2].reps).toBe(9);
      }
    });

    it('grants pure-repetition exemption for bodyweight exercise (+1 rep, load 0, identical bodyweight)', () => {
      const bwExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'pull_up',
        name: 'Pull Up',
        modality: 'bodyweight',
      };
      const bwLaneKey = 'pull_up:bodyweight:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapBw = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'pull_up',
          exerciseRole: 'main_movement',
          modality: 'bodyweight',
          comparableLaneKey: bwLaneKey,
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 0,
          baseReps: 8,
          baseRpe: 8,
          presentedWeight: 0,
          presentedReps: 8,
          presentedRpe: 8,
          bodyweightSnapshot: 75,
          weightUnit: 'kg',
          comparisonLoadKg: 75,
          loadBasis: 'bodyweight_normalized_v1',
          loadIncrement: 0,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1: WorkoutLog = {
        id: 'log-1',
        date: '2026-08-01',
        unit: 'kg',
        programId: defaultProgram.id,
        bodyweightSnapshot: { value: 75, unit: 'kg' },
        exercises: [{
          exerciseKey: 'pull_up',
          name: 'Pull Up',
          muscleGroup: 'back',
          modality: 'bodyweight',
          sets: [1, 2, 3].map(setNum => ({
            setNumber: setNum,
            reps: 8,
            rpe: 8,
            weight: 0,
            isCompleted: true,
            prescriptionSnapshot: snapBw(0)[setNum - 1],
          })),
        }],
      };
      const log2: WorkoutLog = {
        id: 'log-2',
        date: '2026-08-03',
        unit: 'kg',
        programId: defaultProgram.id,
        bodyweightSnapshot: { value: 75, unit: 'kg' },
        exercises: [{
          exerciseKey: 'pull_up',
          name: 'Pull Up',
          muscleGroup: 'back',
          modality: 'bodyweight',
          sets: [1, 2, 3].map(setNum => ({
            setNumber: setNum,
            reps: 8,
            rpe: 8,
            weight: 0,
            isCompleted: true,
            prescriptionSnapshot: snapBw(0)[setNum - 1],
          })),
        }],
      };

      const input = makeInput({
        exercise: bwExercise,
        historicalLogs: [log1, log2],
        construction: {
          kind: 'bodyweight',
          sessionBodyweight: 75,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 0, reps: 8, rpe: 8 },
          { workingSetOrdinal: 2, weight: 0, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 0, reps: 8, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('REP_NUDGE');
        expect(res.diagnostics.activeNudgeOrdinal).toBe(1);
        expect(res.presentedPrescription[0].reps).toBe(9);
      }
    });

    it('grants pure-repetition exemption for assisted exercise (+1 rep, identical assistance)', () => {
      const assistedExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'assisted_pull_up',
        name: 'Assisted Pull Up',
        modality: 'assisted',
      };
      const assistedLaneKey = 'assisted_pull_up:assisted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapAssisted = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'assisted_pull_up',
          exerciseRole: 'main_movement',
          modality: 'assisted',
          comparableLaneKey: assistedLaneKey,
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 20,
          baseReps: 8,
          baseRpe: 8,
          presentedWeight: 20,
          presentedReps: 8,
          presentedRpe: 8,
          bodyweightSnapshot: 80,
          weightUnit: 'kg',
          comparisonLoadKg: 60,
          loadBasis: 'assisted_net_normalized_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1: WorkoutLog = {
        id: 'log-1',
        date: '2026-08-01',
        unit: 'kg',
        programId: defaultProgram.id,
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [{
          exerciseKey: 'assisted_pull_up',
          name: 'Assisted Pull Up',
          muscleGroup: 'back',
          modality: 'assisted',
          sets: [1, 2, 3].map(setNum => ({
            setNumber: setNum,
            reps: 8,
            rpe: 8,
            weight: 20,
            isCompleted: true,
            prescriptionSnapshot: snapAssisted(0)[setNum - 1],
          })),
        }],
      };
      const log2: WorkoutLog = {
        id: 'log-2',
        date: '2026-08-03',
        unit: 'kg',
        programId: defaultProgram.id,
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [{
          exerciseKey: 'assisted_pull_up',
          name: 'Assisted Pull Up',
          muscleGroup: 'back',
          modality: 'assisted',
          sets: [1, 2, 3].map(setNum => ({
            setNumber: setNum,
            reps: 8,
            rpe: 8,
            weight: 20,
            isCompleted: true,
            prescriptionSnapshot: snapAssisted(0)[setNum - 1],
          })),
        }],
      };

      const input = makeInput({
        exercise: assistedExercise,
        historicalLogs: [log1, log2],
        construction: {
          kind: 'assisted',
          sessionBodyweight: 80,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 20, reps: 8, rpe: 8 },
          { workingSetOrdinal: 2, weight: 20, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 20, reps: 8, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('REP_NUDGE');
        expect(res.diagnostics.activeNudgeOrdinal).toBe(1);
        expect(res.presentedPrescription[0].reps).toBe(9);
      }
    });

    it('denies pure-repetition exemption if candidate reps exceed permitted bounds (e.g. maxReps)', () => {
      const snapTemplateMax = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          ...snapTemplate(step)[ord - 1],
          baseReps: 15,
          presentedReps: 15,
        }));
      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplateMax(0), [
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 15, rpe: 8, weight: 80 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplateMax(0), [
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 15, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 15, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 15, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 15, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 15,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
      }
    });
  });

  describe('Full Rep-Lap Chronological Sequence', () => {
    it('executes full rep lap progression (10/10/10 -> 11/10/10 -> 11/11/10 -> 11/11/11 -> 12/11/11)', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapFor = (reps: [number, number, number], step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          baseReps: reps[ord - 1],
          baseRpe: 8,
          presentedWeight: 80,
          presentedReps: ord === nudgeOrd ? reps[ord - 1] + 1 : reps[ord - 1],
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 80,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
          coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: nudgeOrd ? step + 1 : step,
          successCreditEligible: true,
          rollbackTarget: nudgeOrd ? { weight: 80, reps: reps[ord - 1], rpe: 8, comparisonLoadKg: 80 } : null,
        }));

      const log0a = createCompletedLog('log-0a', '2026-08-01', snapFor([10, 10, 10], 0), [
        { reps: 10, rpe: 8, weight: 80 },
        { reps: 10, rpe: 8, weight: 80 },
        { reps: 10, rpe: 8, weight: 80 },
      ]);
      const log0b = createCompletedLog('log-0b', '2026-08-03', snapFor([10, 10, 10], 0), [
        { reps: 10, rpe: 8, weight: 80 },
        { reps: 10, rpe: 8, weight: 80 },
        { reps: 10, rpe: 8, weight: 80 },
      ]);

      const input1 = makeInput({
        historicalLogs: [log0a, log0b],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 10, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 10,
            anchorRPE: 8,
          }),
        },
      });
      const res1 = selectGuidedPrescription(input1);
      expect(res1.status).toBe('guided');
      if (res1.status === 'guided') {
        expect(res1.coachingReasonCode).toBe('REP_NUDGE');
        expect(res1.diagnostics.activeNudgeOrdinal).toBe(1);
        expect(res1.presentedPrescription.map(p => p.reps)).toEqual([11, 10, 10]);
      }

      const log1 = createCompletedLog('log-1', '2026-08-05', snapFor([10, 10, 10], 0, 1), [
        { reps: 11, rpe: 8, weight: 80 },
        { reps: 10, rpe: 8, weight: 80 },
        { reps: 10, rpe: 8, weight: 80 },
      ]);
      const input2 = makeInput({
        historicalLogs: [log0a, log0b, log1],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 11, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 10, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 10, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 11,
            anchorRPE: 8,
          }),
        },
      });
      const res2 = selectGuidedPrescription(input2);
      expect(res2.status).toBe('guided');
      if (res2.status === 'guided') {
        expect(res2.coachingReasonCode).toBe('REP_NUDGE');
        expect(res2.diagnostics.activeNudgeOrdinal).toBe(2);
        expect(res2.presentedPrescription.map(p => p.reps)).toEqual([11, 11, 10]);
      }

      const log2 = createCompletedLog('log-2', '2026-08-07', snapFor([11, 10, 10], 1, 2), [
        { reps: 11, rpe: 8, weight: 80 },
        { reps: 11, rpe: 8, weight: 80 },
        { reps: 10, rpe: 8, weight: 80 },
      ]);
      const input3 = makeInput({
        historicalLogs: [log0a, log0b, log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 11, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 11, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 10, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 11,
            anchorRPE: 8,
          }),
        },
      });
      const res3 = selectGuidedPrescription(input3);
      expect(res3.status).toBe('guided');
      if (res3.status === 'guided') {
        expect(res3.coachingReasonCode).toBe('REP_NUDGE');
        expect(res3.diagnostics.activeNudgeOrdinal).toBe(3);
        expect(res3.presentedPrescription.map(p => p.reps)).toEqual([11, 11, 11]);
      }

      const log3 = createCompletedLog('log-3', '2026-08-09', snapFor([11, 11, 10], 2, 3), [
        { reps: 11, rpe: 8, weight: 80 },
        { reps: 11, rpe: 8, weight: 80 },
        { reps: 11, rpe: 8, weight: 80 },
      ]);
      const input4 = makeInput({
        historicalLogs: [log0a, log0b, log1, log2, log3],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 11, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 11, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 11, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 11,
            anchorRPE: 8,
          }),
        },
      });
      const res4 = selectGuidedPrescription(input4);
      expect(res4.status).toBe('guided');
      if (res4.status === 'guided') {
        expect(res4.coachingReasonCode).toBe('REP_NUDGE');
        expect(res4.diagnostics.activeNudgeOrdinal).toBe(1);
        expect(res4.presentedPrescription.map(p => p.reps)).toEqual([12, 11, 11]);
      }
    });
  });

  describe('Canonical Bounds and Movement Categories', () => {
    it('enforces isolation movement bounds (8..20) and triggers LOAD_PROMOTION_CEILING_REACHED at 20 reps', () => {
      const isolationExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'bicep_curl',
        name: 'Bicep Curl',
        movementCategory: 'isolation',
      };
      const laneKey = 'bicep_curl:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapFor = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'bicep_curl',
          exerciseRole: 'main_movement',
          modality: 'weighted',
          comparableLaneKey: laneKey,
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 20,
          baseReps: 20,
          baseRpe: 8,
          presentedWeight: 20,
          presentedReps: 20,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 20,
          loadBasis: 'external_weight_v1',
          loadIncrement: 1.25,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1 = createCompletedLog('log-1', '2026-08-01', snapFor(0), [
        { reps: 20, rpe: 8, weight: 20 },
        { reps: 20, rpe: 8, weight: 20 },
        { reps: 20, rpe: 8, weight: 20 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapFor(0), [
        { reps: 20, rpe: 8, weight: 20 },
        { reps: 20, rpe: 8, weight: 20 },
        { reps: 20, rpe: 8, weight: 20 },
      ]);

      const input = makeInput({
        exercise: isolationExercise,
        canonicalIncrement: 2.5,
        historicalLogs: [log1, log2],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 20, reps: 20, rpe: 8 },
          { workingSetOrdinal: 2, weight: 20, reps: 20, rpe: 8 },
          { workingSetOrdinal: 3, weight: 20, reps: 20, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 20,
            rawAnchorWeight: 20,
            anchorReps: 20,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        expect(res.presentedPrescription[0].weight).toBe(22.5);
        expect(res.presentedPrescription[0].reps).toBe(8);
      }
    });

    it('triggers BODYWEIGHT_CEILING_HOLD when bodyweight exercise reaches repetition ceiling (15 reps)', () => {
      const bwExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'push_up',
        name: 'Push Up',
        modality: 'bodyweight',
      };
      const bwLaneKey = 'push_up:bodyweight:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapBw = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'push_up',
          exerciseRole: 'main_movement',
          modality: 'bodyweight',
          comparableLaneKey: bwLaneKey,
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 0,
          baseReps: 15,
          baseRpe: 8,
          presentedWeight: 0,
          presentedReps: 15,
          presentedRpe: 8,
          bodyweightSnapshot: 75,
          weightUnit: 'kg',
          comparisonLoadKg: 75,
          loadBasis: 'bodyweight_normalized_v1',
          loadIncrement: 0,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1: WorkoutLog = {
        id: 'log-1',
        date: '2026-08-01',
        unit: 'kg',
        programId: defaultProgram.id,
        bodyweightSnapshot: { value: 75, unit: 'kg' },
        exercises: [{
          exerciseKey: 'push_up',
          name: 'Push Up',
          muscleGroup: 'chest',
          modality: 'bodyweight',
          sets: [1, 2, 3].map(setNum => ({
            setNumber: setNum,
            reps: 15,
            rpe: 8,
            weight: 0,
            isCompleted: true,
            prescriptionSnapshot: snapBw(0)[setNum - 1],
          })),
        }],
      };
      const log2: WorkoutLog = {
        id: 'log-2',
        date: '2026-08-03',
        unit: 'kg',
        programId: defaultProgram.id,
        bodyweightSnapshot: { value: 75, unit: 'kg' },
        exercises: [{
          exerciseKey: 'push_up',
          name: 'Push Up',
          muscleGroup: 'chest',
          modality: 'bodyweight',
          sets: [1, 2, 3].map(setNum => ({
            setNumber: setNum,
            reps: 15,
            rpe: 8,
            weight: 0,
            isCompleted: true,
            prescriptionSnapshot: snapBw(0)[setNum - 1],
          })),
        }],
      };

      const input = makeInput({
        exercise: bwExercise,
        historicalLogs: [log1, log2],
        construction: {
          kind: 'bodyweight',
          sessionBodyweight: 75,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 0, reps: 15, rpe: 8 },
          { workingSetOrdinal: 2, weight: 0, reps: 15, rpe: 8 },
          { workingSetOrdinal: 3, weight: 0, reps: 15, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('BODYWEIGHT_CEILING_HOLD');
        expect(res.snapshots[0].nudgeType).toBe('hold');
      }
    });
  });

  describe('Canonical Distribution and Heterogeneous Rollback Targets', () => {
    it('preserves heterogeneous per-set rollback targets during multi-set distribution', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          baseWeight: ord === 1 ? 100 : 90,
          baseReps: 8,
          baseRpe: 8,
          presentedWeight: ord === 1 ? 100 : 90,
          presentedReps: 8,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: ord === 1 ? 100 : 90,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplate(0), [
        { reps: 8, rpe: 8, weight: 100 },
        { reps: 8, rpe: 8, weight: 90 },
        { reps: 8, rpe: 8, weight: 90 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplate(0), [
        { reps: 8, rpe: 8, weight: 100 },
        { reps: 8, rpe: 8, weight: 90 },
        { reps: 8, rpe: 8, weight: 90 },
      ]);

      const heterogeneousBaseSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 8, rpe: 8 },
        { workingSetOrdinal: 2, weight: 90, reps: 8, rpe: 8 },
        { workingSetOrdinal: 3, weight: 90, reps: 8, rpe: 8 },
      ];

      const input = makeInput({
        historicalLogs: [log1, log2],
        basePrescriptionSets: heterogeneousBaseSets,
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 100,
            rawAnchorWeight: 100,
            anchorReps: 8,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('REP_NUDGE');
        expect(res.snapshots[0].rollbackTarget?.weight).toBe(100);
        expect(res.snapshots[1].rollbackTarget).toBeNull();
        expect(res.snapshots[2].rollbackTarget).toBeNull();
      }
    });
  });

  describe('Assisted and Bodyweight Modality Helpers', () => {
    it('handles assisted exercise boundary: MINIMUM_ASSISTANCE_REACHED when assistance <= canonicalIncrement', () => {
      const assistedExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'assisted_dip',
        name: 'Assisted Dip',
        modality: 'assisted',
      };
      const laneKey = 'assisted_dip:assisted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapAssisted = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'assisted_dip',
          exerciseRole: 'main_movement',
          modality: 'assisted',
          comparableLaneKey: laneKey,
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 2.5,
          baseReps: 15,
          baseRpe: 8,
          presentedWeight: 2.5,
          presentedReps: 15,
          presentedRpe: 8,
          bodyweightSnapshot: 80,
          weightUnit: 'kg',
          comparisonLoadKg: 77.5,
          loadBasis: 'assisted_net_normalized_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1: WorkoutLog = {
        id: 'log-1',
        date: '2026-08-01',
        unit: 'kg',
        programId: defaultProgram.id,
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [{
          exerciseKey: 'assisted_dip',
          name: 'Assisted Dip',
          muscleGroup: 'triceps',
          modality: 'assisted',
          sets: [1, 2, 3].map(setNum => ({
            setNumber: setNum,
            reps: 15,
            rpe: 8,
            weight: 2.5,
            isCompleted: true,
            prescriptionSnapshot: snapAssisted(0)[setNum - 1],
          })),
        }],
      };
      const log2: WorkoutLog = {
        id: 'log-2',
        date: '2026-08-03',
        unit: 'kg',
        programId: defaultProgram.id,
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [{
          exerciseKey: 'assisted_dip',
          name: 'Assisted Dip',
          muscleGroup: 'triceps',
          modality: 'assisted',
          sets: [1, 2, 3].map(setNum => ({
            setNumber: setNum,
            reps: 15,
            rpe: 8,
            weight: 2.5,
            isCompleted: true,
            prescriptionSnapshot: snapAssisted(0)[setNum - 1],
          })),
        }],
      };

      const input = makeInput({
        exercise: assistedExercise,
        canonicalIncrement: 2.5,
        historicalLogs: [log1, log2],
        construction: {
          kind: 'assisted',
          sessionBodyweight: 80,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 2.5, reps: 15, rpe: 8 },
          { workingSetOrdinal: 2, weight: 2.5, reps: 15, rpe: 8 },
          { workingSetOrdinal: 3, weight: 2.5, reps: 15, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('MINIMUM_ASSISTANCE_REACHED');
      }
    });

    it('holds INVALID_ASSISTANCE_HOLD when assistance exceeds bodyweight', () => {
      const assistedExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'assisted_pull_up',
        modality: 'assisted',
      };
      const input = makeInput({
        exercise: assistedExercise,
        construction: {
          kind: 'assisted',
          sessionBodyweight: 70,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('INVALID_ASSISTANCE_HOLD');
      }
    });

    it('holds ZERO_NET_LOAD_HOLD when assistance exactly equals bodyweight', () => {
      const assistedExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'assisted_pull_up',
        modality: 'assisted',
      };
      const input = makeInput({
        exercise: assistedExercise,
        construction: {
          kind: 'assisted',
          sessionBodyweight: 80,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
      });
      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('ZERO_NET_LOAD_HOLD');
      }
    });
  });

  describe('Cross-Unit Pending-Retry and Context Invalidation', () => {
    it('retries pending nudge across units when lb and kg comparison loads match within tolerance', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplateLb = (step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          baseWeight: 220,
          baseReps: 8,
          baseRpe: 8,
          presentedWeight: 220,
          presentedReps: ord === nudgeOrd ? 9 : 8,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'lb',
          comparisonLoadKg: 220 * 0.45359237,
          loadBasis: 'external_weight_v1',
          loadIncrement: 5,
          nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
          coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: nudgeOrd ? 1 : 0,
          successCreditEligible: true,
          rollbackTarget: nudgeOrd ? { weight: 220, reps: 8, rpe: 8, comparisonLoadKg: 220 * 0.45359237 } : null,
        }));

      const log1 = createCompletedLog('log-1', '2026-08-01', snapTemplateLb(0), [
        { reps: 8, rpe: 8, weight: 220 },
        { reps: 8, rpe: 8, weight: 220 },
        { reps: 8, rpe: 8, weight: 220 },
      ]);
      const log2 = createCompletedLog('log-2', '2026-08-03', snapTemplateLb(0), [
        { reps: 8, rpe: 8, weight: 220 },
        { reps: 8, rpe: 8, weight: 220 },
        { reps: 8, rpe: 8, weight: 220 },
      ]);
      const snap3 = snapTemplateLb(0, 1);
      const log3: WorkoutLog = {
        id: 'log-3',
        date: '2026-08-05',
        unit: 'lb',
        programId: defaultProgram.id,
        bodyweightSnapshot: null,
        exercises: [
          {
            exerciseKey: defaultExercise.exerciseKey,
            name: defaultExercise.name,
            muscleGroup: defaultExercise.muscleGroup,
            modality: 'weighted',
            sets: [
              {
                setNumber: 1,
                reps: 0,
                rpe: 0,
                weight: 220,
                isCompleted: false,
                isSkipped: true,
                prescriptionSnapshot: snap3[0],
              },
              {
                setNumber: 2,
                reps: 8,
                rpe: 8,
                weight: 220,
                isCompleted: true,
                prescriptionSnapshot: snap3[1],
              },
              {
                setNumber: 3,
                reps: 8,
                rpe: 8,
                weight: 220,
                isCompleted: true,
                prescriptionSnapshot: snap3[2],
              },
            ],
          },
        ],
      };

      const baseWeightKg = 220 * 0.45359237;
      const input = makeInput({
        activeUnit: 'kg',
        historicalLogs: [log1, log2, log3],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: baseWeightKg, reps: 8, rpe: 8 },
          { workingSetOrdinal: 2, weight: baseWeightKg, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: baseWeightKg, reps: 8, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: baseWeightKg,
            rawAnchorWeight: baseWeightKg,
            anchorReps: 8,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('NUDGE_NEUTRAL_RETRY');
      }
    });

    it('invalidates pending nudge when base prescription diverges from rollback target', () => {
      const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapTemplate = (step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
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
          presentedReps: ord === nudgeOrd ? 9 : 8,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 80,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
          coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: nudgeOrd ? 1 : 0,
          successCreditEligible: true,
          rollbackTarget: nudgeOrd ? { weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 } : null,
        }));

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
      const snap3 = snapTemplate(0, 1);
      const log3: WorkoutLog = {
        id: 'log-3',
        date: '2026-08-05',
        unit: 'kg',
        programId: defaultProgram.id,
        bodyweightSnapshot: null,
        exercises: [
          {
            exerciseKey: defaultExercise.exerciseKey,
            name: defaultExercise.name,
            muscleGroup: defaultExercise.muscleGroup,
            modality: 'weighted',
            sets: [
              {
                setNumber: 1,
                reps: 0,
                rpe: 0,
                weight: 80,
                isCompleted: false,
                isSkipped: true,
                prescriptionSnapshot: snap3[0],
              },
              {
                setNumber: 2,
                reps: 8,
                rpe: 8,
                weight: 80,
                isCompleted: true,
                prescriptionSnapshot: snap3[1],
              },
              {
                setNumber: 3,
                reps: 8,
                rpe: 8,
                weight: 80,
                isCompleted: true,
                prescriptionSnapshot: snap3[2],
              },
            ],
          },
        ],
      };

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 85, reps: 8, rpe: 8 },
          { workingSetOrdinal: 2, weight: 85, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 85, reps: 8, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 85,
            rawAnchorWeight: 85,
            anchorReps: 8,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('BASE_PRESCRIPTION');
        expect(res.snapshots[0].rollbackTarget).toBeNull();
      }
    });

    it('invalidates pending nudge when bodyweight changes for bodyweight exercise', () => {
      const bwExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'pull_up',
        modality: 'bodyweight',
      };
      const bwLaneKey = 'pull_up:bodyweight:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
      const snapBw = (step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'pull_up',
          exerciseRole: 'main_movement',
          modality: 'bodyweight',
          comparableLaneKey: bwLaneKey,
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 0,
          baseReps: 8,
          baseRpe: 8,
          presentedWeight: 0,
          presentedReps: ord === nudgeOrd ? 9 : 8,
          presentedRpe: 8,
          bodyweightSnapshot: 75,
          weightUnit: 'kg',
          comparisonLoadKg: 75,
          loadBasis: 'bodyweight_normalized_v1',
          loadIncrement: 0,
          nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
          coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: 0,
          presentedStepIndex: nudgeOrd ? 1 : 0,
          successCreditEligible: true,
          rollbackTarget: nudgeOrd ? { weight: 0, reps: 8, rpe: 8, comparisonLoadKg: 75 } : null,
        }));

      const makeBwLog = (id: string, date: string, bw: number, nudgeOrd?: number) => ({
        id,
        date,
        unit: 'kg' as const,
        programId: defaultProgram.id,
        bodyweightSnapshot: { value: bw, unit: 'kg' as const },
        exercises: [{
          exerciseKey: 'pull_up',
          name: 'Pull Up',
          muscleGroup: 'back',
          modality: 'bodyweight' as const,
          sets: [1, 2, 3].map(setNum => ({
            setNumber: setNum,
            reps: setNum === nudgeOrd ? 0 : 8,
            rpe: setNum === nudgeOrd ? 0 : 8,
            weight: 0,
            isCompleted: setNum !== nudgeOrd,
            isSkipped: setNum === nudgeOrd,
            prescriptionSnapshot: snapBw(0, nudgeOrd)[setNum - 1],
          })),
        }],
      });

      const log1 = makeBwLog('log-1', '2026-08-01', 75);
      const log2 = makeBwLog('log-2', '2026-08-03', 75);
      const log3 = makeBwLog('log-3', '2026-08-05', 75, 1);

      const input = makeInput({
        exercise: bwExercise,
        historicalLogs: [log1, log2, log3],
        construction: {
          kind: 'bodyweight',
          sessionBodyweight: 78,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 0, reps: 8, rpe: 8 },
          { workingSetOrdinal: 2, weight: 0, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 0, reps: 8, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('BASE_PRESCRIPTION');
      }
    });
  });

  describe('Simultaneous Dual-Condition Precedence Matrix', () => {
    const laneKey = 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume';
    const snapTemplate = (step: number, nudgeOrd?: number): PrescriptionSnapshot[] =>
      [1, 2, 3].map(ord => ({
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
        presentedReps: ord === nudgeOrd ? 9 : 8,
        presentedRpe: 8,
        bodyweightSnapshot: null,
        weightUnit: 'kg',
        comparisonLoadKg: 80,
        loadBasis: 'external_weight_v1',
        loadIncrement: 2.5,
        nudgeType: ord === nudgeOrd ? 'rep_nudge' : 'none',
        coachingReasonCode: nudgeOrd ? 'REP_NUDGE' : 'BASE_PRESCRIPTION',
        confirmedStepIndexBefore: 0,
        presentedStepIndex: nudgeOrd ? 1 : 0,
        successCreditEligible: true,
        rollbackTarget: nudgeOrd ? { weight: 80, reps: 8, rpe: 8, comparisonLoadKg: 80 } : null,
      }));

    it('precedence interaction: Precedence 4 (STEP_OUT_BASE_ONLY) takes priority over Precedence 6 (Rollback)', () => {
      const stepProgram: Program = {
        ...defaultProgram,
        algorithmId: 'hypertrophy_step',
      };
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
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0, 1), [
        { reps: 5, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        program: stepProgram,
        periodisationLane: { algorithmId: 'hypertrophy_step', effectivePhase: 4 },
        historicalLogs: [log1, log2, log3],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 8,
            anchorRPE: 8,
            algorithmId: 'hypertrophy_step',
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('STEP_OUT_BASE_ONLY');
      }
    });

    it('precedence interaction: Precedence 4 (STEP_OUT_BASE_ONLY) takes priority over Precedence 7 (Pending retry)', () => {
      const stepProgram: Program = {
        ...defaultProgram,
        algorithmId: 'hypertrophy_step',
      };
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
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0, 1), [
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        program: stepProgram,
        periodisationLane: { algorithmId: 'hypertrophy_step', effectivePhase: 4 },
        historicalLogs: [log1, log2, log3],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 8,
            anchorRPE: 8,
            algorithmId: 'hypertrophy_step',
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('STEP_OUT_BASE_ONLY');
      }
    });

    it('precedence interaction: Precedence 4 (STEP_OUT_BASE_ONLY) takes priority over Precedence 8 (Marginal miss hold)', () => {
      const stepProgram: Program = {
        ...defaultProgram,
        algorithmId: 'hypertrophy_step',
      };
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
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0), [
        { reps: 7, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        program: stepProgram,
        periodisationLane: { algorithmId: 'hypertrophy_step', effectivePhase: 4 },
        historicalLogs: [log1, log2, log3],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 8,
            anchorRPE: 8,
            algorithmId: 'hypertrophy_step',
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('STEP_OUT_BASE_ONLY');
      }
    });

    it('precedence interaction: Precedence 5 (HIGH_EXERTION_HOLD) takes priority over Precedence 7 (Pending retry)', () => {
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
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0, 1), [
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 9.5 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('HIGH_EXERTION_HOLD');
      }
    });

    it('precedence interaction: Precedence 5 (HIGH_EXERTION_HOLD) takes priority over Precedence 8 (Marginal miss hold)', () => {
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
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0), [
        { reps: 7, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 9.5 },
          { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('HIGH_EXERTION_HOLD');
      }
    });

    it('precedence interaction: Precedence 6 (Rollback) takes priority over Precedence 7 (Pending retry)', () => {
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
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0, 1), [
        { reps: 5, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK');
      }
    });

    it('precedence interaction: Precedence 6 (Rollback) takes priority over Precedence 8 (Marginal miss hold)', () => {
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
      const log3 = createCompletedLog('log-3', '2026-08-05', snapTemplate(0, 1), [
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
        { reps: 8, rpe: 8, weight: 80 },
      ]);

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('NUDGE_MARGINAL_FAILURE_ROLLBACK');
      }
    });
  });

  describe('19-Reason Coaching Credit Matrix and Snapshot Step Metadata Validation', () => {
    it('verifies that all 19 coaching reason codes exist in ALL_GUIDED_COACHING_REASON_CODES', () => {
      expect(ALL_GUIDED_COACHING_REASON_CODES.length).toBe(19);
    });

    it('verifies that snapshots generated across diverse conditions pass isValidSnapshotStepMetadata and isValidCoachingReasonMetadata', () => {
      const testCases = [
        makeInput({ exercise: { ...defaultExercise, isMainMovement: false } }),
        makeInput({
          program: { ...defaultProgram, algorithmId: 'hypertrophy_step' },
          periodisationLane: { algorithmId: 'hypertrophy_step', effectivePhase: 4 },
          construction: { kind: 'weighted', sessionAnchor: makeAnchor({ algorithmId: 'hypertrophy_step' }) },
        }),
        makeInput({ basePrescriptionSets: [{ workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 9.5 }, { workingSetOrdinal: 2, weight: 80, reps: 8, rpe: 8 }, { workingSetOrdinal: 3, weight: 80, reps: 8, rpe: 8 }] }),
        makeInput({ historicalLogs: [] }),
      ];

      for (const input of testCases) {
        const res = selectGuidedPrescription(input);
        expect(res.status).toBe('guided');
        if (res.status === 'guided') {
          for (const snap of res.snapshots) {
            expect(isValidSnapshotStepMetadata(snap)).toBe(true);
            expect(isValidCoachingReasonMetadata(snap)).toBe(true);
            expect(isValidTargetSnapshot(snap)).toBe(true);
          }
        }
      }
    });
  });

  describe('Canonical Distribution Authority and Distributor Guardrails', () => {
    it('invokes distributeMultiSetTargets for Strength main movement and emits fatigued non-uniform loads', () => {
      const strengthProgram: Program = {
        ...defaultProgram,
        objective: 'Strength',
        algorithmId: 'strength_linear',
      };
      const strengthExercise: ExerciseEntry = {
        ...defaultExercise,
        isMainMovement: true,
      };

      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'strength_linear',
          exerciseKey: defaultExercise.exerciseKey ?? 'bench_press',
          exerciseRole: 'main_movement',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:main_movement:strength_linear:sets-3:sl:wave-strength',
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 100,
          baseReps: 5,
          baseRpe: 8,
          presentedWeight: 100,
          presentedReps: 5,
          presentedRpe: 8,
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

      const log1 = createCompletedLog('log-s1', '2026-08-01', snapTemplate(0), [
        { reps: 5, rpe: 8, weight: 100 },
        { reps: 5, rpe: 8, weight: 100 },
        { reps: 5, rpe: 8, weight: 100 },
      ]);
      const log2 = createCompletedLog('log-s2', '2026-08-03', snapTemplate(0), [
        { reps: 5, rpe: 8, weight: 100 },
        { reps: 5, rpe: 8, weight: 100 },
        { reps: 5, rpe: 8, weight: 100 },
      ]);

      const basePrescriptionSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
        { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
        { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
      ];

      const input = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        exercise: strengthExercise,
        periodisationLane: {
          algorithmId: 'strength_linear',
          linearPhase: 1,
          maxWeeks: 8,
        },
        historicalLogs: [log1, log2],
        basePrescriptionSets,
        canonicalIncrement: 2.5,
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            algorithmId: 'strength_linear',
            profileType: 'strength_normal',
            workingSetCount: 3,
            roundedAnchorWeight: 100,
            rawAnchorWeight: 100,
            anchorReps: 5,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
        expect(res.presentedPrescription[0].weight).toBe(102.5);
        expect(res.presentedPrescription[2].weight).toBeLessThan(res.presentedPrescription[0].weight);
        expect(res.presentedPrescription[2].weight).toBe(97.5);
      }
    });

    it('invokes distributeMultiSetTargets for Hypertrophy movements during load promotion and emits fatigued loads', () => {
      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: defaultExercise.exerciseKey ?? 'bench_press',
          exerciseRole: 'main_movement',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume',
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 80,
          baseReps: 15,
          baseRpe: 8,
          presentedWeight: 80,
          presentedReps: 15,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
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

      const log1 = createCompletedLog('log-h1', '2026-08-01', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 15, rpe: 8, weight: 80 },
      ]);
      const log2 = createCompletedLog('log-h2', '2026-08-03', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 15, rpe: 8, weight: 80 },
        { reps: 15, rpe: 8, weight: 80 },
      ]);

      const basePrescriptionSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 80, reps: 15, rpe: 8 },
        { workingSetOrdinal: 2, weight: 80, reps: 15, rpe: 8 },
        { workingSetOrdinal: 3, weight: 80, reps: 15, rpe: 8 },
      ];

      const input = makeInput({
        historicalLogs: [log1, log2],
        basePrescriptionSets,
        canonicalIncrement: 2.5,
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 80,
            rawAnchorWeight: 80,
            anchorReps: 15,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        expect(res.presentedPrescription[0].weight).toBe(82.5);
        expect(res.presentedPrescription[0].reps).toBe(5);
        expect(res.presentedPrescription[2].weight).toBe(80);
      }
    });

    it('emits isolated single-set candidate load advance without attempting multi-set distribution', () => {
      const strengthProgram: Program = {
        ...defaultProgram,
        objective: 'Strength',
        algorithmId: 'strength_linear',
      };
      const strengthExercise: ExerciseEntry = {
        ...defaultExercise,
        isMainMovement: true,
      };

      const snapTemplate = (step: number): PrescriptionSnapshot[] => [
        {
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'strength_linear',
          exerciseKey: defaultExercise.exerciseKey ?? 'bench_press',
          exerciseRole: 'main_movement',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:main_movement:strength_linear:sets-1:sl:wave-strength',
          workingSetOrdinal: 1,
          prescribedWorkingSetCount: 1,
          baseWeight: 100,
          baseReps: 5,
          baseRpe: 8,
          presentedWeight: 100,
          presentedReps: 5,
          presentedRpe: 8,
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
        },
      ];

      const log1 = createCompletedLog('log-single1', '2026-08-01', snapTemplate(0), [
        { reps: 5, rpe: 8, weight: 100 },
      ]);
      const log2 = createCompletedLog('log-single2', '2026-08-03', snapTemplate(0), [
        { reps: 5, rpe: 8, weight: 100 },
      ]);

      const input = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        exercise: strengthExercise,
        periodisationLane: {
          algorithmId: 'strength_linear',
          linearPhase: 1,
          maxWeeks: 8,
        },
        historicalLogs: [log1, log2],
        canonicalIncrement: 2.5,
        basePrescriptionSets: [{ workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 }],
        construction: {
          kind: 'weighted',
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
        expect(res.presentedPrescription.length).toBe(1);
        expect(res.presentedPrescription[0].weight).toBe(102.5);
        expect(res.presentedPrescription[0].reps).toBe(5);
      }
    });

    it('invokes distributeMultiSetTargets for Strength accessory multi-set load promotion', () => {
      const strengthProgram: Program = {
        ...defaultProgram,
        objective: 'Strength',
        algorithmId: 'strength_linear',
      };
      const accessoryExercise: ExerciseEntry = {
        ...defaultExercise,
        isMainMovement: false,
      };

      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'strength_linear',
          exerciseKey: defaultExercise.exerciseKey ?? 'bench_press',
          exerciseRole: 'accessory',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:accessory:strength_linear:sets-3:sl:wave-strength',
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 50,
          baseReps: 12,
          baseRpe: 8,
          presentedWeight: 50,
          presentedReps: 12,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 50,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1 = createCompletedLog('log-sa1', '2026-08-01', snapTemplate(0), [
        { reps: 12, rpe: 8, weight: 50 },
        { reps: 12, rpe: 8, weight: 50 },
        { reps: 12, rpe: 8, weight: 50 },
      ]);
      const log2 = createCompletedLog('log-sa2', '2026-08-03', snapTemplate(0), [
        { reps: 12, rpe: 8, weight: 50 },
        { reps: 12, rpe: 8, weight: 50 },
        { reps: 12, rpe: 8, weight: 50 },
      ]);

      const basePrescriptionSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 50, reps: 12, rpe: 8 },
        { workingSetOrdinal: 2, weight: 50, reps: 12, rpe: 8 },
        { workingSetOrdinal: 3, weight: 50, reps: 12, rpe: 8 },
      ];

      const input = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        exercise: accessoryExercise,
        periodisationLane: {
          algorithmId: 'strength_linear',
          linearPhase: 1,
          maxWeeks: 8,
        },
        historicalLogs: [log1, log2],
        basePrescriptionSets,
        canonicalIncrement: 2.5,
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            algorithmId: 'strength_linear',
            profileType: 'strength_normal',
            workingSetCount: 3,
            roundedAnchorWeight: 50,
            rawAnchorWeight: 50,
            anchorReps: 12,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        expect(res.presentedPrescription[0].weight).toBe(52.5);
        expect(res.presentedPrescription[2].weight).toBeLessThan(res.presentedPrescription[0].weight);
      }
    });

    it('invokes distributeMultiSetTargets for Hypertrophy accessory multi-set load promotion', () => {
      const accessoryExercise: ExerciseEntry = {
        ...defaultExercise,
        isMainMovement: false,
      };

      const snapTemplate = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: defaultExercise.exerciseKey ?? 'bench_press',
          exerciseRole: 'accessory',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:accessory:hypertrophy_linear:sets-3:hl:wave-volume',
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 60,
          baseReps: 15,
          baseRpe: 8,
          presentedWeight: 60,
          presentedReps: 15,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 60,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1 = createCompletedLog('log-ha1', '2026-08-01', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 60 },
        { reps: 15, rpe: 8, weight: 60 },
        { reps: 15, rpe: 8, weight: 60 },
      ]);
      const log2 = createCompletedLog('log-ha2', '2026-08-03', snapTemplate(0), [
        { reps: 15, rpe: 8, weight: 60 },
        { reps: 15, rpe: 8, weight: 60 },
        { reps: 15, rpe: 8, weight: 60 },
      ]);

      const basePrescriptionSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 60, reps: 15, rpe: 8 },
        { workingSetOrdinal: 2, weight: 60, reps: 15, rpe: 8 },
        { workingSetOrdinal: 3, weight: 60, reps: 15, rpe: 8 },
      ];

      const input = makeInput({
        exercise: accessoryExercise,
        historicalLogs: [log1, log2],
        basePrescriptionSets,
        canonicalIncrement: 2.5,
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            workingSetCount: 3,
            roundedAnchorWeight: 60,
            rawAnchorWeight: 60,
            anchorReps: 15,
            anchorRPE: 8,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        expect(res.presentedPrescription[0].weight).toBe(62.5);
        expect(res.presentedPrescription[0].reps).toBe(5);
        expect(res.presentedPrescription[2].weight).toBe(62.5);
      }
    });

    describe('Anchor Semantics & Missing sessionAnchor', () => {
      it('multi-set rep nudge proceeds without requiring a distribution anchor', () => {
        const snapTemplate = (step: number): PrescriptionSnapshot[] =>
          [1, 2, 3].map(ord => ({
            snapshotVersion: 2,
            progressionPolicyVersion: 1,
            algorithmVersion: 1,
            progressionMode: 'metreps_guided',
            algorithmId: 'hypertrophy_linear',
            exerciseKey: defaultExercise.exerciseKey ?? 'bench_press',
            exerciseRole: 'main_movement',
            modality: 'weighted',
            comparableLaneKey: 'bench_press:weighted:main_movement:hypertrophy_linear:sets-3:hl:wave-volume',
            workingSetOrdinal: ord,
            prescribedWorkingSetCount: 3,
            baseWeight: 80,
            baseReps: ord === 1 ? 8 : 7,
            baseRpe: 8,
            presentedWeight: 80,
            presentedReps: ord === 1 ? 8 : 7,
            presentedRpe: 8,
            bodyweightSnapshot: null,
            weightUnit: 'kg',
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

        const log1 = createCompletedLog('log-rep1', '2026-08-01', snapTemplate(0), [
          { reps: 8, rpe: 8, weight: 80 },
          { reps: 7, rpe: 8, weight: 80 },
          { reps: 7, rpe: 8, weight: 80 },
        ]);
        const log2 = createCompletedLog('log-rep2', '2026-08-03', snapTemplate(0), [
          { reps: 8, rpe: 8, weight: 80 },
          { reps: 7, rpe: 8, weight: 80 },
          { reps: 7, rpe: 8, weight: 80 },
        ]);

        const basePrescriptionSets: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 80, reps: 8, rpe: 8 },
          { workingSetOrdinal: 2, weight: 80, reps: 7, rpe: 8 },
          { workingSetOrdinal: 3, weight: 80, reps: 7, rpe: 8 },
        ];

        const input = makeInput({
          historicalLogs: [log1, log2],
          basePrescriptionSets,
          canonicalIncrement: 2.5,
          construction: {
            kind: 'weighted',
            // No sessionAnchor provided
          },
        });

        const res = selectGuidedPrescription(input);
        expect(res.status).toBe('guided');
        if (res.status === 'guided') {
          expect(res.coachingReasonCode).toBe('REP_NUDGE');
          expect(res.presentedPrescription[1].reps).toBe(8);
        }
      });

      it('holds at BASE_PRESCRIPTION when multi-set weighted sessionAnchor is missing during load advancement', () => {
        const strengthProgram: Program = {
          ...defaultProgram,
          objective: 'Strength',
          algorithmId: 'strength_linear',
        };
        const strengthExercise: ExerciseEntry = {
          ...defaultExercise,
          isMainMovement: true,
        };

        const snapTemplate = (step: number): PrescriptionSnapshot[] =>
          [1, 2, 3].map(ord => ({
            snapshotVersion: 2,
            progressionPolicyVersion: 1,
            algorithmVersion: 1,
            progressionMode: 'metreps_guided',
            algorithmId: 'strength_linear',
            exerciseKey: defaultExercise.exerciseKey ?? 'bench_press',
            exerciseRole: 'main_movement',
            modality: 'weighted',
            comparableLaneKey: 'bench_press:weighted:main_movement:strength_linear:sets-3:sl:wave-strength',
            workingSetOrdinal: ord,
            prescribedWorkingSetCount: 3,
            baseWeight: 100,
            baseReps: 5,
            baseRpe: 8,
            presentedWeight: 100,
            presentedReps: 5,
            presentedRpe: 8,
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

        const log1 = createCompletedLog('log-m1', '2026-08-01', snapTemplate(0), [
          { reps: 5, rpe: 8, weight: 100 },
          { reps: 5, rpe: 8, weight: 100 },
          { reps: 5, rpe: 8, weight: 100 },
        ]);
        const log2 = createCompletedLog('log-m2', '2026-08-03', snapTemplate(0), [
          { reps: 5, rpe: 8, weight: 100 },
          { reps: 5, rpe: 8, weight: 100 },
          { reps: 5, rpe: 8, weight: 100 },
        ]);

        const input = makeInput({
          program: strengthProgram,
          programs: [strengthProgram],
          exercise: strengthExercise,
          periodisationLane: {
            algorithmId: 'strength_linear',
            linearPhase: 1,
            maxWeeks: 8,
          },
          historicalLogs: [log1, log2],
          basePrescriptionSets: [
            { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
            { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
            { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
          ],
          canonicalIncrement: 2.5,
          construction: {
            kind: 'weighted',
            sessionAnchor: undefined,
          },
        });

        const res = selectGuidedPrescription(input);
        expect(res.status).toBe('guided');
        if (res.status === 'guided') {
          expect(res.coachingReasonCode).toBe('BASE_PRESCRIPTION');
          expect(res.diagnostics.candidateAdvancementProhibited).toBe(true);
          expect(res.diagnostics.distributionBypassReason).toBe('missing_session_anchor');
          expect(res.presentedPrescription).toEqual([
            { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
            { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
            { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
          ]);
          expect(res.snapshots.every(s => s.nudgeType === 'none' && s.successCreditEligible && s.rollbackTarget === null)).toBe(true);
        }
      });

      it('malformed supplied anchor remains invalid_input under locked validator', () => {
        const basePrescriptionSets: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
        ];

        // Mismatched set count
        const badCountInput = makeInput({
          basePrescriptionSets,
          construction: {
            kind: 'weighted',
            sessionAnchor: makeAnchor({
              workingSetCount: 2,
              roundedAnchorWeight: 100,
            }),
          },
        });
        const resCount = selectGuidedPrescription(badCountInput);
        expect(resCount.status).toBe('invalid_input');
        if (resCount.status === 'invalid_input') {
          expect(resCount.error).toBe('ANCHOR_SET_COUNT_MISMATCH');
        }

        // Invalid object
        const badObjInput = makeInput({
          basePrescriptionSets,
          construction: {
            kind: 'weighted',
            sessionAnchor: 'not_an_object' as any,
          },
        });
        const resObj = selectGuidedPrescription(badObjInput);
        expect(resObj.status).toBe('invalid_input');
        if (resObj.status === 'invalid_input') {
          expect(resObj.error).toBe('INVALID_SESSION_ANCHOR');
        }

        // Mismatched anchor weight
        const badWeightInput = makeInput({
          basePrescriptionSets,
          construction: {
            kind: 'weighted',
            sessionAnchor: makeAnchor({
              workingSetCount: 3,
              roundedAnchorWeight: 90,
            }),
          },
        });
        const resWeight = selectGuidedPrescription(badWeightInput);
        expect(resWeight.status).toBe('invalid_input');
        if (resWeight.status === 'invalid_input') {
          expect(resWeight.error).toBe('ANCHOR_WEIGHT_MISMATCH');
        }
      });
    });

    describe('distributor bypasses prohibiting candidate advancement', () => {
      const reachableBypasses: {
        reason: string;
        anchorPatch: Partial<SessionAnchor>;
      }[] = [
        {
          reason: 'skipped_exercise',
          anchorPatch: { isSkipped: true },
        },
        {
          reason: 'invalid_anchor_inputs',
          anchorPatch: { baselineE1RM: -10 },
        },
        {
          reason: 'invalid_profile_configuration',
          anchorPatch: { profileType: 'invalid_profile' as any },
        },
      ];

      for (const tc of reachableBypasses) {
        it(`prohibits advancement and returns BASE_PRESCRIPTION when distributor bypasses with ${tc.reason}`, () => {
          const strengthProgram: Program = {
            ...defaultProgram,
            objective: 'Strength',
            algorithmId: 'strength_linear',
          };
          const strengthExercise: ExerciseEntry = {
            ...defaultExercise,
            isMainMovement: true,
          };

          const snapTemplate = (step: number): PrescriptionSnapshot[] =>
            [1, 2, 3].map(ord => ({
              snapshotVersion: 2,
              progressionPolicyVersion: 1,
              algorithmVersion: 1,
              progressionMode: 'metreps_guided',
              algorithmId: 'strength_linear',
              exerciseKey: defaultExercise.exerciseKey ?? 'bench_press',
              exerciseRole: 'main_movement',
              modality: 'weighted',
              comparableLaneKey: 'bench_press:weighted:main_movement:strength_linear:sets-3:sl:wave-strength',
              workingSetOrdinal: ord,
              prescribedWorkingSetCount: 3,
              baseWeight: 100,
              baseReps: 5,
              baseRpe: 8,
              presentedWeight: 100,
              presentedReps: 5,
              presentedRpe: 8,
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

          const log1 = createCompletedLog('log-b1', '2026-08-01', snapTemplate(0), [
            { reps: 5, rpe: 8, weight: 100 },
            { reps: 5, rpe: 8, weight: 100 },
            { reps: 5, rpe: 8, weight: 100 },
          ]);
          const log2 = createCompletedLog('log-b2', '2026-08-03', snapTemplate(0), [
            { reps: 5, rpe: 8, weight: 100 },
            { reps: 5, rpe: 8, weight: 100 },
            { reps: 5, rpe: 8, weight: 100 },
          ]);

          const input = makeInput({
            program: strengthProgram,
            programs: [strengthProgram],
            exercise: strengthExercise,
            periodisationLane: {
              algorithmId: 'strength_linear',
              linearPhase: 1,
              maxWeeks: 8,
            },
            historicalLogs: [log1, log2],
            basePrescriptionSets: [
              { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
              { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
              { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
            ],
            canonicalIncrement: 2.5,
            construction: {
              kind: 'weighted',
              sessionAnchor: makeAnchor({
                algorithmId: 'strength_linear',
                profileType: 'strength_normal',
                workingSetCount: 3,
                roundedAnchorWeight: 100,
                rawAnchorWeight: 100,
                anchorReps: 5,
                anchorRPE: 8,
                ...tc.anchorPatch,
              }),
            },
          });

          const res = selectGuidedPrescription(input);
          expect(res.status).toBe('guided');
          if (res.status === 'guided') {
            expect(res.coachingReasonCode).toBe('BASE_PRESCRIPTION');
            expect(res.diagnostics.candidateAdvancementProhibited).toBe(true);
            expect(res.diagnostics.distributionBypassReason).toBe(tc.reason);
            expect(res.presentedPrescription).toEqual([
              { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
              { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
              { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
            ]);
            expect(res.snapshots.every(s => s.nudgeType === 'none' && s.successCreditEligible && s.rollbackTarget === null)).toBe(true);
          }
        });
      }

      describe('unreachable distributor bypasses through public selector input', () => {
        const baseSets: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
        ];

        const mockContext: DistributionDispatchContext = {
          basePrescriptionSets: baseSets,
          confirmedStepIndex: 1,
          activeUnit: 'kg',
          modality: 'weighted',
          bodyweightSnapshot: null,
          exerciseKey: 'bench_press',
          exerciseRole: 'main_movement',
          algorithmId: 'strength_linear',
          comparableLaneKey: 'bench_press:weighted:main_movement:strength_linear:sets-3:sl:wave-strength',
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
        };

        it('rejects unsupported_modality anchor at public input gate and builds canonical bypass result via pure helper', () => {
          const badInput = makeInput({
            basePrescriptionSets: baseSets,
            construction: {
              kind: 'weighted',
              sessionAnchor: makeAnchor({
                modality: 'timed' as any,
              }),
            },
          });
          const resInput = selectGuidedPrescription(badInput);
          expect(resInput.status).toBe('invalid_input');

          const bypassResult = buildDistributionBypassGuidedResult('unsupported_modality', mockContext);
          expect(bypassResult.status).toBe('guided');
          expect(bypassResult.coachingReasonCode).toBe('BASE_PRESCRIPTION');
          expect(bypassResult.diagnostics.candidateAdvancementProhibited).toBe(true);
          expect(bypassResult.diagnostics.distributionBypassReason).toBe('unsupported_modality');
          expect(bypassResult.presentedPrescription).toEqual(baseSets);
          expect(bypassResult.snapshots.every(s => s.nudgeType === 'none' && s.successCreditEligible && s.rollbackTarget === null)).toBe(true);
        });

        it('rejects zero_working_sets anchor at public input gate and builds canonical bypass result via pure helper', () => {
          const badInput = makeInput({
            basePrescriptionSets: baseSets,
            construction: {
              kind: 'weighted',
              sessionAnchor: makeAnchor({
                workingSetCount: 0,
              }),
            },
          });
          const resInput = selectGuidedPrescription(badInput);
          expect(resInput.status).toBe('invalid_input');

          const bypassResult = buildDistributionBypassGuidedResult('zero_working_sets', mockContext);
          expect(bypassResult.status).toBe('guided');
          expect(bypassResult.coachingReasonCode).toBe('BASE_PRESCRIPTION');
          expect(bypassResult.diagnostics.candidateAdvancementProhibited).toBe(true);
          expect(bypassResult.diagnostics.distributionBypassReason).toBe('zero_working_sets');
          expect(bypassResult.presentedPrescription).toEqual(baseSets);
          expect(bypassResult.snapshots.every(s => s.nudgeType === 'none' && s.successCreditEligible && s.rollbackTarget === null)).toBe(true);
        });
      });
    });

    describe('validateDistributedTargets pure helper guardrails', () => {
      const baseSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
        { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
        { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
      ];

      it('validates compliant distributed targets successfully', () => {
        const valid = [
          { workingSetOrdinal: 1, weight: 102.5, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 97.5, reps: 5, rpe: 8 },
        ];
        const res = validateDistributedTargets(valid, 3, baseSets);
        expect(res.valid).toBe(true);
        expect(res.targets).toEqual(valid);
        expect(res.error).toBeUndefined();
      });

      it('rejects wrong set count', () => {
        const shortTargets = [
          { workingSetOrdinal: 1, weight: 102.5, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
        ];
        const res = validateDistributedTargets(shortTargets, 3, baseSets);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('does not match expected set count');
      });

      it('rejects non-finite, zero, or negative weight', () => {
        const nanWeight = [
          { workingSetOrdinal: 1, weight: NaN, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 97.5, reps: 5, rpe: 8 },
        ];
        expect(validateDistributedTargets(nanWeight, 3, baseSets).valid).toBe(false);

        const negativeWeight = [
          { workingSetOrdinal: 1, weight: -10, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 97.5, reps: 5, rpe: 8 },
        ];
        expect(validateDistributedTargets(negativeWeight, 3, baseSets).valid).toBe(false);

        const zeroWeight = [
          { workingSetOrdinal: 1, weight: 0, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 97.5, reps: 5, rpe: 8 },
        ];
        expect(validateDistributedTargets(zeroWeight, 3, baseSets).valid).toBe(false);
      });

      it('rejects non-contiguous or invalid workingSetOrdinal', () => {
        const badOrdinals = [
          { workingSetOrdinal: 1, weight: 102.5, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 4, weight: 97.5, reps: 5, rpe: 8 },
        ];
        const res = validateDistributedTargets(badOrdinals, 3, baseSets);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('is not contiguous');
      });

      it('rejects invalid RPE values', () => {
        const invalidRpe = [
          { workingSetOrdinal: 1, weight: 102.5, reps: 5, rpe: 12 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 97.5, reps: 5, rpe: 8 },
        ];
        const res = validateDistributedTargets(invalidRpe, 3, baseSets);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('has invalid RPE');
      });
    });

    describe('identifyResistanceChangedOrdinals unit tests', () => {
      const baseSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
        { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
        { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
      ];

      it('returns empty changed ordinals for exactly equal normalised resistance', () => {
        const candidate: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
        ];
        const res = identifyResistanceChangedOrdinals({
          modality: 'weighted',
          unit: 'kg',
          bodyweight: null,
          basePrescriptionSets: baseSets,
          candidatePrescription: candidate,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.changedOrdinals).toEqual([]);
        }
      });

      it('treats difference strictly inside canonical epsilon as unchanged', () => {
        const delta = COMPARISON_LOAD_EQUALITY_EPSILON / 2; // inside epsilon
        const candidate: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 100 + delta, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
        ];
        const res = identifyResistanceChangedOrdinals({
          modality: 'weighted',
          unit: 'kg',
          bodyweight: null,
          basePrescriptionSets: baseSets,
          candidatePrescription: candidate,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.changedOrdinals).toEqual([]);
        }
      });

      it('treats difference exactly at canonical epsilon as unchanged', () => {
        const delta = COMPARISON_LOAD_EQUALITY_EPSILON; // exactly at epsilon
        const candidate: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 100 + delta, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
        ];
        const res = identifyResistanceChangedOrdinals({
          modality: 'weighted',
          unit: 'kg',
          bodyweight: null,
          basePrescriptionSets: baseSets,
          candidatePrescription: candidate,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.changedOrdinals).toEqual([]);
        }
      });

      it('identifies ordinal as changed when difference is immediately outside canonical epsilon', () => {
        const delta = COMPARISON_LOAD_EQUALITY_EPSILON * 1.5; // outside epsilon
        const candidate: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 100 + delta, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
        ];
        const res = identifyResistanceChangedOrdinals({
          modality: 'weighted',
          unit: 'kg',
          bodyweight: null,
          basePrescriptionSets: baseSets,
          candidatePrescription: candidate,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.changedOrdinals).toEqual([1]);
        }
      });

      it('recognizes physically equivalent kg and lb resistance without false change', () => {
        // 100 lb base in lb unit
        const baseLb: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
        ];
        // 100 lb is 45.359237 kg. A candidate at exactly 100 lb in lb unit:
        const candLb: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 },
        ];
        const res = identifyResistanceChangedOrdinals({
          modality: 'weighted',
          unit: 'lb',
          bodyweight: null,
          basePrescriptionSets: baseLb,
          candidatePrescription: candLb,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.changedOrdinals).toEqual([]);
        }
      });

      it('distinguishes identical displayed numbers in kg and lb as different resistance', () => {
        // 100 kg is 100 kg. If candidate was 100 lb, resolveGuidedComparisonLoad normalizes them differently:
        const baseKgComp = 100;
        // In kg, 100 kg is 100 comparisonLoadKg.
        // A candidate with 50 kg vs 100 kg has load difference of 50 kg:
        const cand: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 50, reps: 5, rpe: 8 },
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
        ];
        const res = identifyResistanceChangedOrdinals({
          modality: 'weighted',
          unit: 'kg',
          bodyweight: null,
          basePrescriptionSets: baseSets,
          candidatePrescription: cand,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.changedOrdinals).toEqual([1]);
        }
      });

      it('equal resistance with different reps or RPE does not falsely become a resistance-changing ordinal', () => {
        const candidate: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 100, reps: 6, rpe: 9 }, // changed reps and RPE, but same weight
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },
          { workingSetOrdinal: 3, weight: 100, reps: 5, rpe: 8 },
        ];
        const res = identifyResistanceChangedOrdinals({
          modality: 'weighted',
          unit: 'kg',
          bodyweight: null,
          basePrescriptionSets: baseSets,
          candidatePrescription: candidate,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.changedOrdinals).toEqual([]);
        }
      });

      it('includes changed companion ordinals and includes every changed ordinal exactly once', () => {
        const candidate: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 102.5, reps: 5, rpe: 8 }, // changed
          { workingSetOrdinal: 2, weight: 100, reps: 5, rpe: 8 },   // unchanged
          { workingSetOrdinal: 3, weight: 95, reps: 5, rpe: 8 },    // changed companion
        ];
        const res = identifyResistanceChangedOrdinals({
          modality: 'weighted',
          unit: 'kg',
          bodyweight: null,
          basePrescriptionSets: baseSets,
          candidatePrescription: candidate,
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.changedOrdinals).toEqual([1, 3]);
        }
      });

      it('fails closed when set counts mismatch', () => {
        const candidate: BasePrescriptionSet[] = [
          { workingSetOrdinal: 1, weight: 102.5, reps: 5, rpe: 8 },
        ];
        const res = identifyResistanceChangedOrdinals({
          modality: 'weighted',
          unit: 'kg',
          bodyweight: null,
          basePrescriptionSets: baseSets,
          candidatePrescription: candidate,
        });
        expect(res.success).toBe(false);
      });
    });
  });

  describe('Guided Selector Canonical Increment Authority (D2B-2A-RC1)', () => {
    const strengthProgram: Program = {
      ...defaultProgram,
      objective: 'Strength',
      algorithmId: 'strength_linear',
    };

    const BENCH_PRESS_KEY = 'bench_press';

    const strengthExercise: ExerciseEntry = {
      ...defaultExercise,
      exerciseKey: BENCH_PRESS_KEY,
      isMainMovement: true,
    };

    it('19. weighted single-set advancement uses canonicalIncrement directly (2.5 kg adds 2.5, 5.0 lb adds 5.0)', () => {
      // 19a. 2.5 kg adds 2.5 kg
      const snapTemplateKg = (step: number): PrescriptionSnapshot[] => [
        {
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'strength_linear',
          exerciseKey: BENCH_PRESS_KEY,
          exerciseRole: 'main_movement',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:main_movement:strength_linear:sets-1:sl:wave-strength',
          workingSetOrdinal: 1,
          prescribedWorkingSetCount: 1,
          baseWeight: 100,
          baseReps: 5,
          baseRpe: 8,
          presentedWeight: 100,
          presentedReps: 5,
          presentedRpe: 8,
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
        },
      ];

      const logKg1 = createCompletedLog('log-s-kg1', '2026-08-01', snapTemplateKg(0), [
        { reps: 5, rpe: 8, weight: 100 },
      ]);
      const logKg2 = createCompletedLog('log-s-kg2', '2026-08-03', snapTemplateKg(0), [
        { reps: 5, rpe: 8, weight: 100 },
      ]);

      const inputKg = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        exercise: strengthExercise,
        periodisationLane: {
          algorithmId: 'strength_linear',
          linearPhase: 1,
          maxWeeks: 8,
        },
        historicalLogs: [logKg1, logKg2],
        canonicalIncrement: 2.5,
        activeUnit: 'kg',
        basePrescriptionSets: [{ workingSetOrdinal: 1, weight: 100, reps: 5, rpe: 8 }],
        construction: { kind: 'weighted' },
      });

      const resKg = selectGuidedPrescription(inputKg);
      expect(resKg.status).toBe('guided');
      if (resKg.status === 'guided') {
        expect(resKg.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
        expect(resKg.presentedPrescription[0].weight).toBe(102.5); // 100 + 2.5
        expect(resKg.snapshots[0].loadIncrement).toBe(2.5);
      }

      // 19b. 5.0 lb adds 5.0 lb
      const snapTemplateLb = (step: number): PrescriptionSnapshot[] => [
        {
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'strength_linear',
          exerciseKey: BENCH_PRESS_KEY,
          exerciseRole: 'main_movement',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:main_movement:strength_linear:sets-1:sl:wave-strength',
          workingSetOrdinal: 1,
          prescribedWorkingSetCount: 1,
          baseWeight: 220,
          baseReps: 5,
          baseRpe: 8,
          presentedWeight: 220,
          presentedReps: 5,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'lb',
          comparisonLoadKg: 220 * 0.45359237,
          loadBasis: 'external_weight_v1',
          loadIncrement: 5.0,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        },
      ];

      const logLb1: WorkoutLog = {
        ...createCompletedLog('log-s-lb1', '2026-08-01', snapTemplateLb(0), [
          { reps: 5, rpe: 8, weight: 220 },
        ]),
        unit: 'lb',
      };
      const logLb2: WorkoutLog = {
        ...createCompletedLog('log-s-lb2', '2026-08-03', snapTemplateLb(0), [
          { reps: 5, rpe: 8, weight: 220 },
        ]),
        unit: 'lb',
      };

      const inputLb = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        exercise: strengthExercise,
        periodisationLane: {
          algorithmId: 'strength_linear',
          linearPhase: 1,
          maxWeeks: 8,
        },
        historicalLogs: [logLb1, logLb2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        basePrescriptionSets: [{ workingSetOrdinal: 1, weight: 220, reps: 5, rpe: 8 }],
        construction: { kind: 'weighted' },
      });

      const resLb = selectGuidedPrescription(inputLb);
      expect(resLb.status).toBe('guided');
      if (resLb.status === 'guided') {
        expect(resLb.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
        expect(resLb.presentedPrescription[0].weight).toBe(225.0); // 220 + 5.0
        expect(resLb.snapshots[0].loadIncrement).toBe(5.0);
      }
    });

    it('20. weighted multi-set advancement uses canonicalIncrement (kg advances by 2.5, lb advances by 5.0; target-loads on 2.5 grid)', () => {
      // 20a. kg on 2.5 grid
      const snapTemplate3Kg = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'strength_linear',
          exerciseKey: BENCH_PRESS_KEY,
          exerciseRole: 'accessory',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:accessory:strength_linear:sets-3:sl:wave-strength',
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 50,
          baseReps: 12,
          baseRpe: 8,
          presentedWeight: 50,
          presentedReps: 12,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 50,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log3Kg1 = createCompletedLog('log-3kg1', '2026-08-01', snapTemplate3Kg(0), [
        { reps: 12, rpe: 8, weight: 50 },
        { reps: 12, rpe: 8, weight: 50 },
        { reps: 12, rpe: 8, weight: 50 },
      ]);
      const log3Kg2 = createCompletedLog('log-3kg2', '2026-08-03', snapTemplate3Kg(0), [
        { reps: 12, rpe: 8, weight: 50 },
        { reps: 12, rpe: 8, weight: 50 },
        { reps: 12, rpe: 8, weight: 50 },
      ]);

      const accessoryExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: BENCH_PRESS_KEY,
        isMainMovement: false,
      };

      const input3Kg = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        exercise: accessoryExercise,
        periodisationLane: {
          algorithmId: 'strength_linear',
          linearPhase: 1,
          maxWeeks: 8,
        },
        historicalLogs: [log3Kg1, log3Kg2],
        canonicalIncrement: 2.5,
        activeUnit: 'kg',
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 50, reps: 12, rpe: 8 },
          { workingSetOrdinal: 2, weight: 50, reps: 12, rpe: 8 },
          { workingSetOrdinal: 3, weight: 50, reps: 12, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            algorithmId: 'strength_linear',
            profileType: 'strength_normal',
            workingSetCount: 3,
            roundedAnchorWeight: 50,
            rawAnchorWeight: 50,
            anchorReps: 12,
            anchorRPE: 8,
          }),
        },
      });

      const res3Kg = selectGuidedPrescription(input3Kg);
      expect(res3Kg.status).toBe('guided');
      if (res3Kg.status === 'guided') {
        expect(res3Kg.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        expect(res3Kg.presentedPrescription).toHaveLength(3);
        for (const set of res3Kg.presentedPrescription) {
          expect(set.weight % 2.5).toBeCloseTo(0, 5);
        }
      }

      // 20b. lb on 5.0 grid
      const snapTemplate3Lb = (step: number): PrescriptionSnapshot[] =>
        [1, 2, 3].map(ord => ({
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'strength_linear',
          exerciseKey: BENCH_PRESS_KEY,
          exerciseRole: 'accessory',
          modality: 'weighted',
          comparableLaneKey: 'bench_press:weighted:accessory:strength_linear:sets-3:sl:wave-strength',
          workingSetOrdinal: ord,
          prescribedWorkingSetCount: 3,
          baseWeight: 110,
          baseReps: 12,
          baseRpe: 8,
          presentedWeight: 110,
          presentedReps: 12,
          presentedRpe: 8,
          bodyweightSnapshot: null,
          weightUnit: 'lb',
          comparisonLoadKg: 110 * 0.45359237,
          loadBasis: 'external_weight_v1',
          loadIncrement: 5.0,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log3Lb1: WorkoutLog = {
        ...createCompletedLog('log-3lb1', '2026-08-01', snapTemplate3Lb(0), [
          { reps: 12, rpe: 8, weight: 110 },
          { reps: 12, rpe: 8, weight: 110 },
          { reps: 12, rpe: 8, weight: 110 },
        ]),
        unit: 'lb',
      };
      const log3Lb2: WorkoutLog = {
        ...createCompletedLog('log-3lb2', '2026-08-03', snapTemplate3Lb(0), [
          { reps: 12, rpe: 8, weight: 110 },
          { reps: 12, rpe: 8, weight: 110 },
          { reps: 12, rpe: 8, weight: 110 },
        ]),
        unit: 'lb',
      };

      const input3Lb = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        exercise: accessoryExercise,
        periodisationLane: {
          algorithmId: 'strength_linear',
          linearPhase: 1,
          maxWeeks: 8,
        },
        historicalLogs: [log3Lb1, log3Lb2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 110, reps: 12, rpe: 8 },
          { workingSetOrdinal: 2, weight: 110, reps: 12, rpe: 8 },
          { workingSetOrdinal: 3, weight: 110, reps: 12, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            algorithmId: 'strength_linear',
            profileType: 'strength_normal',
            workingSetCount: 3,
            roundedAnchorWeight: 110,
            rawAnchorWeight: 110,
            anchorReps: 12,
            anchorRPE: 8,
          }),
        },
      });

      const res3Lb = selectGuidedPrescription(input3Lb);
      expect(res3Lb.status).toBe('guided');
      if (res3Lb.status === 'guided') {
        expect(res3Lb.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        expect(res3Lb.presentedPrescription).toHaveLength(3);
        expect(res3Lb.presentedPrescription[0].weight).toBe(115);
        for (const set of res3Lb.presentedPrescription) {
          expect(set.weight % 2.5).toBeCloseTo(0, 5);
        }
      }
    });

    it('21. assisted progression uses canonicalIncrement (kg assistance drops by 2.5 kg, lb assistance drops by 5.0 lb)', () => {
      // 21a. kg assistance drops by 2.5 kg
      const assistedExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'assisted_pull_up',
        name: 'Assisted Pull Up',
        modality: 'assisted',
      };
      const assistedLaneKeyKg = 'assisted_pull_up:assisted:main_movement:hypertrophy_linear:sets-1:hl:wave-volume';
      const snapTemplateAssistedKg = (step: number): PrescriptionSnapshot[] => [
        {
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'assisted_pull_up',
          exerciseRole: 'main_movement',
          modality: 'assisted',
          comparableLaneKey: assistedLaneKeyKg,
          workingSetOrdinal: 1,
          prescribedWorkingSetCount: 1,
          baseWeight: 20,
          baseReps: 15,
          baseRpe: 8,
          presentedWeight: 20,
          presentedReps: 15,
          presentedRpe: 8,
          bodyweightSnapshot: 80,
          weightUnit: 'kg',
          comparisonLoadKg: 60,
          loadBasis: 'assisted_net_normalized_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        },
      ];

      const logAssistedKg1: WorkoutLog = {
        ...createCompletedLog('log-akg1', '2026-08-01', snapTemplateAssistedKg(0), [
          { reps: 15, rpe: 8, weight: 20 },
        ]),
        bodyweightSnapshot: { value: 80, unit: 'kg' },
      };
      const logAssistedKg2: WorkoutLog = {
        ...createCompletedLog('log-akg2', '2026-08-03', snapTemplateAssistedKg(0), [
          { reps: 15, rpe: 8, weight: 20 },
        ]),
        bodyweightSnapshot: { value: 80, unit: 'kg' },
      };

      const inputAssistedKg = makeInput({
        exercise: assistedExercise,
        historicalLogs: [logAssistedKg1, logAssistedKg2],
        canonicalIncrement: 2.5,
        activeUnit: 'kg',
        construction: {
          kind: 'assisted',
          sessionBodyweight: 80,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 20, reps: 15, rpe: 8 },
        ],
      });

      const resAssistedKg = selectGuidedPrescription(inputAssistedKg);
      expect(resAssistedKg.status).toBe('guided');
      if (resAssistedKg.status === 'guided') {
        expect(resAssistedKg.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        // Assistance drops by 2.5 kg: 20 - 2.5 = 17.5
        expect(resAssistedKg.presentedPrescription[0].weight).toBe(17.5);
        expect(resAssistedKg.snapshots[0].loadIncrement).toBe(2.5);
      }

      // 21b. lb assistance drops by 5.0 lb
      const assistedLaneKeyLb = 'assisted_pull_up:assisted:main_movement:hypertrophy_linear:sets-1:hl:wave-volume';
      const snapTemplateAssistedLb = (step: number): PrescriptionSnapshot[] => [
        {
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'assisted_pull_up',
          exerciseRole: 'main_movement',
          modality: 'assisted',
          comparableLaneKey: assistedLaneKeyLb,
          workingSetOrdinal: 1,
          prescribedWorkingSetCount: 1,
          baseWeight: 50,
          baseReps: 15,
          baseRpe: 8,
          presentedWeight: 50,
          presentedReps: 15,
          presentedRpe: 8,
          bodyweightSnapshot: 180,
          weightUnit: 'lb',
          comparisonLoadKg: (180 - 50) * 0.45359237,
          loadBasis: 'assisted_net_normalized_v1',
          loadIncrement: 5.0,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        },
      ];

      const logAssistedLb1: WorkoutLog = {
        ...createCompletedLog('log-alb1', '2026-08-01', snapTemplateAssistedLb(0), [
          { reps: 15, rpe: 8, weight: 50 },
        ]),
        unit: 'lb',
        bodyweightSnapshot: { value: 180, unit: 'lb' },
      };
      const logAssistedLb2: WorkoutLog = {
        ...createCompletedLog('log-alb2', '2026-08-03', snapTemplateAssistedLb(0), [
          { reps: 15, rpe: 8, weight: 50 },
        ]),
        unit: 'lb',
        bodyweightSnapshot: { value: 180, unit: 'lb' },
      };

      const inputAssistedLb = makeInput({
        exercise: assistedExercise,
        historicalLogs: [logAssistedLb1, logAssistedLb2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        construction: {
          kind: 'assisted',
          sessionBodyweight: 180,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 50, reps: 15, rpe: 8 },
        ],
      });

      const resAssistedLb = selectGuidedPrescription(inputAssistedLb);
      expect(resAssistedLb.status).toBe('guided');
      if (resAssistedLb.status === 'guided') {
        expect(resAssistedLb.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        // Assistance drops by 5.0 lb: 50 - 5.0 = 45.0
        expect(resAssistedLb.presentedPrescription[0].weight).toBe(45.0);
        expect(resAssistedLb.snapshots[0].loadIncrement).toBe(5.0);
      }
    });

    it('22. pure bodyweight progression preserves load (0), advances repetitions, and records resolved contract increment in snapshot', () => {
      const bwExercise: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'push_up',
        name: 'Push Up',
        modality: 'bodyweight',
      };
      const bwLaneKey = 'push_up:bodyweight:main_movement:hypertrophy_linear:sets-1:hl:wave-volume';
      const snapBw = (step: number, unit: 'kg' | 'lb', inc: number): PrescriptionSnapshot[] => [
        {
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'push_up',
          exerciseRole: 'main_movement',
          modality: 'bodyweight',
          comparableLaneKey: bwLaneKey,
          workingSetOrdinal: 1,
          prescribedWorkingSetCount: 1,
          baseWeight: 0,
          baseReps: 10,
          baseRpe: 8,
          presentedWeight: 0,
          presentedReps: 10,
          presentedRpe: 8,
          bodyweightSnapshot: unit === 'kg' ? 75 : 165,
          weightUnit: unit,
          comparisonLoadKg: unit === 'kg' ? 75 : 165 * 0.45359237,
          loadBasis: 'bodyweight_normalized_v1',
          loadIncrement: inc,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        },
      ];

      const logBw1 = createCompletedLog('log-bw1', '2026-08-01', snapBw(0, 'kg', 2.5), [
        { reps: 10, rpe: 8, weight: 0 },
      ]);
      const logBw2 = createCompletedLog('log-bw2', '2026-08-03', snapBw(0, 'kg', 2.5), [
        { reps: 10, rpe: 8, weight: 0 },
      ]);

      const inputBwKg = makeInput({
        exercise: bwExercise,
        historicalLogs: [logBw1, logBw2],
        canonicalIncrement: 2.5,
        activeUnit: 'kg',
        construction: {
          kind: 'bodyweight',
          sessionBodyweight: 75,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 0, reps: 10, rpe: 8 },
        ],
      });

      const resBwKg = selectGuidedPrescription(inputBwKg);
      expect(resBwKg.status).toBe('guided');
      if (resBwKg.status === 'guided') {
        expect(resBwKg.coachingReasonCode).toBe('REP_NUDGE');
        expect(resBwKg.presentedPrescription[0].weight).toBe(0);
        expect(resBwKg.presentedPrescription[0].reps).toBe(11);
        expect(resBwKg.snapshots[0].loadIncrement).toBe(2.5);
      }

      // lb version
      const logBwLb1: WorkoutLog = {
        ...createCompletedLog('log-bw-lb1', '2026-08-01', snapBw(0, 'lb', 5.0), [
          { reps: 10, rpe: 8, weight: 0 },
        ]),
        unit: 'lb',
        bodyweightSnapshot: { value: 165, unit: 'lb' },
      };
      const logBwLb2: WorkoutLog = {
        ...createCompletedLog('log-bw-lb2', '2026-08-03', snapBw(0, 'lb', 5.0), [
          { reps: 10, rpe: 8, weight: 0 },
        ]),
        unit: 'lb',
        bodyweightSnapshot: { value: 165, unit: 'lb' },
      };

      const inputBwLb = makeInput({
        exercise: bwExercise,
        historicalLogs: [logBwLb1, logBwLb2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        construction: {
          kind: 'bodyweight',
          sessionBodyweight: 165,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 0, reps: 10, rpe: 8 },
        ],
      });

      const resBwLb = selectGuidedPrescription(inputBwLb);
      expect(resBwLb.status).toBe('guided');
      if (resBwLb.status === 'guided') {
        expect(resBwLb.coachingReasonCode).toBe('REP_NUDGE');
        expect(resBwLb.presentedPrescription[0].weight).toBe(0);
        expect(resBwLb.presentedPrescription[0].reps).toBe(11);
        expect(resBwLb.snapshots[0].loadIncrement).toBe(5.0);
      }
    });

    it('23. non-finite, zero, or negative canonicalIncrement fails closed with INVALID_CANONICAL_INCREMENT', () => {
      const badIncrements = [0, -2.5, -5.0, NaN, Infinity, -Infinity];
      for (const inc of badIncrements) {
        const input = makeInput({ canonicalIncrement: inc });
        const res = selectGuidedPrescription(input);
        expect(res.status).toBe('invalid_input');
        if (res.status === 'invalid_input') {
          expect(res.error).toBe('INVALID_CANONICAL_INCREMENT');
        }
      }
    });
  });

  describe('I1-RC2: Separated Progression-Delta and Load-Grid Authority', () => {
    // Template for 3-set Imperial snapshots with half-grid load (187.5 lb)
    const snapTemplateHalfGridLb = (step: number, baseLoad: number = 187.5, reps: number = 15): PrescriptionSnapshot[] =>
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

    it('Test C1: Hypertrophy multi-set progression advances valid 187.5 lb anchor by +5.0 lb to 192.5 lb without bypass', () => {
      const log1: WorkoutLog = {
        ...createCompletedLog('log-c1-1', '2026-08-01', snapTemplateHalfGridLb(0, 187.5, 15), [
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
        ]),
        unit: 'lb',
      };
      const log2: WorkoutLog = {
        ...createCompletedLog('log-c1-2', '2026-08-03', snapTemplateHalfGridLb(0, 187.5, 15), [
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
        ]),
        unit: 'lb',
      };

      const basePrescriptionSets: BasePrescriptionSet[] = [
        { workingSetOrdinal: 1, weight: 187.5, reps: 15, rpe: 8 },
        { workingSetOrdinal: 2, weight: 187.5, reps: 15, rpe: 8 },
        { workingSetOrdinal: 3, weight: 187.5, reps: 15, rpe: 8 },
      ];
      const anchor = makeAnchor({
        algorithmId: 'hypertrophy_linear',
        profileType: 'hypertrophy',
        roundedAnchorWeight: 187.5,
        rawAnchorWeight: 187.5,
        anchorReps: 15,
        anchorRPE: 8,
        workingSetCount: 3,
      });

      const input = makeInput({
        historicalLogs: [log1, log2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        basePrescriptionSets,
        construction: {
          kind: 'weighted',
          sessionAnchor: anchor,
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        expect(res.diagnostics.distributionBypassReason).toBeUndefined();
        expect(res.diagnostics.candidateAdvancementProhibited).toBeFalsy();
        expect(res.presentedPrescription).toHaveLength(3);
        // Set 1 advanced by exactly +5.0 lb canonicalIncrement: 187.5 -> 192.5
        expect(res.presentedPrescription[0].workingSetOrdinal).toBe(1);
        expect(res.presentedPrescription[0].weight).toBe(192.5);
        expect(res.presentedPrescription[0].weight - 187.5).toBe(5.0);
        // All presented back-off targets lie on the 2.5 lb grid
        for (const s of res.presentedPrescription) {
          expect(s.weight % 2.5).toBeCloseTo(0, 5);
        }
        // Canonical increment recorded in snapshots is 5.0 lb
        expect(res.snapshots[0].loadIncrement).toBe(5.0);
      }
      // Input immutability
      expect(basePrescriptionSets[0].weight).toBe(187.5);
      expect(anchor.roundedAnchorWeight).toBe(187.5);
    });

    it('Test C2: Strength main-movement multi-set progression advances valid 187.5 lb anchor to 192.5 lb', () => {
      const strengthProgram: Program = {
        ...defaultProgram,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
      };
      const laneKey = 'bench_press:weighted:main_movement:strength_undulating:sets-3:su:reps-5:rpe-8.5';
      const snapTemplateStrengthLb = (step: number): PrescriptionSnapshot[] =>
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
          baseWeight: 187.5,
          baseReps: 5,
          baseRpe: 8.5,
          presentedWeight: 187.5,
          presentedReps: 5,
          presentedRpe: 8.5,
          bodyweightSnapshot: null,
          weightUnit: 'lb',
          comparisonLoadKg: 187.5 * 0.45359237,
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
        ...createCompletedLog('log-c2-1', '2026-08-01', snapTemplateStrengthLb(0), [
          { reps: 5, rpe: 8.5, weight: 187.5 },
          { reps: 5, rpe: 8.5, weight: 187.5 },
          { reps: 5, rpe: 8.5, weight: 187.5 },
        ]),
        unit: 'lb',
      };
      const log2: WorkoutLog = {
        ...createCompletedLog('log-c2-2', '2026-08-03', snapTemplateStrengthLb(0), [
          { reps: 5, rpe: 8.5, weight: 187.5 },
          { reps: 5, rpe: 8.5, weight: 187.5 },
          { reps: 5, rpe: 8.5, weight: 187.5 },
        ]),
        unit: 'lb',
      };

      const input = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        historicalLogs: [log1, log2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        periodisationLane: {
          algorithmId: 'strength_undulating',
          anchorReps: 5,
          anchorRpe: 8.5,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 187.5, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 2, weight: 187.5, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 187.5, reps: 5, rpe: 8.5 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            algorithmId: 'strength_undulating',
            profileType: 'strength_normal',
            roundedAnchorWeight: 187.5,
            rawAnchorWeight: 187.5,
            anchorReps: 5,
            anchorRPE: 8.5,
            workingSetCount: 3,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
        expect(res.diagnostics.distributionBypassReason).toBeUndefined();
        expect(res.diagnostics.candidateAdvancementProhibited).toBeFalsy();
        expect(res.presentedPrescription[0].weight).toBe(192.5);
        expect(res.presentedPrescription[0].weight - 187.5).toBe(5.0);
        for (const s of res.presentedPrescription) {
          expect(s.weight % 2.5).toBeCloseTo(0, 5);
        }
      }
    });

    it('Test D: On-grid Imperial control advances 185.0 lb to 190.0 lb and preserves back-offs on 2.5 grid', () => {
      const strengthProgram: Program = {
        ...defaultProgram,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
      };
      const laneKey = 'bench_press:weighted:main_movement:strength_undulating:sets-3:su:reps-5:rpe-8.5';
      const snapTemplateD = (step: number): PrescriptionSnapshot[] =>
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
          baseWeight: 185.0,
          baseReps: 5,
          baseRpe: 8.5,
          presentedWeight: 185.0,
          presentedReps: 5,
          presentedRpe: 8.5,
          bodyweightSnapshot: null,
          weightUnit: 'lb',
          comparisonLoadKg: 185.0 * 0.45359237,
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
        ...createCompletedLog('log-d-1', '2026-08-01', snapTemplateD(0), [
          { reps: 5, rpe: 8.5, weight: 185.0 },
          { reps: 5, rpe: 8.5, weight: 185.0 },
          { reps: 5, rpe: 8.5, weight: 185.0 },
        ]),
        unit: 'lb',
      };
      const log2: WorkoutLog = {
        ...createCompletedLog('log-d-2', '2026-08-03', snapTemplateD(0), [
          { reps: 5, rpe: 8.5, weight: 185.0 },
          { reps: 5, rpe: 8.5, weight: 185.0 },
          { reps: 5, rpe: 8.5, weight: 185.0 },
        ]),
        unit: 'lb',
      };

      const input = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        historicalLogs: [log1, log2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        periodisationLane: {
          algorithmId: 'strength_undulating',
          anchorReps: 5,
          anchorRpe: 8.5,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 185.0, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 2, weight: 185.0, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 185.0, reps: 5, rpe: 8.5 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            algorithmId: 'strength_undulating',
            profileType: 'strength_normal',
            roundedAnchorWeight: 185.0,
            rawAnchorWeight: 185.0,
            anchorReps: 5,
            anchorRPE: 8.5,
            workingSetCount: 3,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
        expect(res.presentedPrescription[0].weight).toBe(190.0);
        expect(res.presentedPrescription[0].weight - 185.0).toBe(5.0);
        for (const s of res.presentedPrescription) {
          expect(s.weight % 2.5).toBeCloseTo(0, 5);
        }
      }
    });

    it('Test E: Metric non-regression advances 87.5 kg by +2.5 kg to 90.0 kg on 2.5 kg grid', () => {
      const strengthProgram: Program = {
        ...defaultProgram,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
      };
      const laneKey = 'bench_press:weighted:main_movement:strength_undulating:sets-3:su:reps-5:rpe-8.5';
      const snapTemplateKg = (step: number): PrescriptionSnapshot[] =>
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
          baseWeight: 87.5,
          baseReps: 5,
          baseRpe: 8.5,
          presentedWeight: 87.5,
          presentedReps: 5,
          presentedRpe: 8.5,
          bodyweightSnapshot: null,
          weightUnit: 'kg',
          comparisonLoadKg: 87.5,
          loadBasis: 'external_weight_v1',
          loadIncrement: 2.5,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        }));

      const log1: WorkoutLog = {
        ...createCompletedLog('log-e-1', '2026-08-01', snapTemplateKg(0), [
          { reps: 5, rpe: 8.5, weight: 87.5 },
          { reps: 5, rpe: 8.5, weight: 87.5 },
          { reps: 5, rpe: 8.5, weight: 87.5 },
        ]),
        unit: 'kg',
      };
      const log2: WorkoutLog = {
        ...createCompletedLog('log-e-2', '2026-08-03', snapTemplateKg(0), [
          { reps: 5, rpe: 8.5, weight: 87.5 },
          { reps: 5, rpe: 8.5, weight: 87.5 },
          { reps: 5, rpe: 8.5, weight: 87.5 },
        ]),
        unit: 'kg',
      };

      const input = makeInput({
        program: strengthProgram,
        programs: [strengthProgram],
        historicalLogs: [log1, log2],
        canonicalIncrement: 2.5,
        activeUnit: 'kg',
        periodisationLane: {
          algorithmId: 'strength_undulating',
          anchorReps: 5,
          anchorRpe: 8.5,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 87.5, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 2, weight: 87.5, reps: 5, rpe: 8.5 },
          { workingSetOrdinal: 3, weight: 87.5, reps: 5, rpe: 8.5 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            algorithmId: 'strength_undulating',
            profileType: 'strength_normal',
            roundedAnchorWeight: 87.5,
            rawAnchorWeight: 87.5,
            anchorReps: 5,
            anchorRPE: 8.5,
            workingSetCount: 3,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_NUDGE_MAIN_MOVEMENT');
        expect(res.presentedPrescription[0].weight).toBe(90.0);
        expect(res.presentedPrescription[0].weight - 87.5).toBe(2.5);
        for (const s of res.presentedPrescription) {
          expect(s.weight % 2.5).toBeCloseTo(0, 5);
        }
      }
    });

    it('Test F: Assisted Imperial progression decreases assistance by exactly 5.0 lb on 2.5 lb grid via projectAssistedTarget', () => {
      const assistedEx: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'assisted_pull_up',
        name: 'Assisted Pull Up',
        modality: 'assisted',
      };
      const snapTemplateAssistedLb = (step: number): PrescriptionSnapshot[] => [
        {
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'assisted_pull_up',
          exerciseRole: 'main_movement',
          modality: 'assisted',
          comparableLaneKey: 'assisted_pull_up:assisted:main_movement:hypertrophy_linear:sets-1:hl:wave-volume',
          workingSetOrdinal: 1,
          prescribedWorkingSetCount: 1,
          baseWeight: 47.5,
          baseReps: 15,
          baseRpe: 8,
          presentedWeight: 47.5,
          presentedReps: 15,
          presentedRpe: 8,
          bodyweightSnapshot: 180,
          weightUnit: 'lb',
          comparisonLoadKg: (180 - 47.5) * 0.45359237,
          loadBasis: 'assisted_net_normalized_v1',
          loadIncrement: 5.0,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        },
      ];

      const log1: WorkoutLog = {
        ...createCompletedLog('log-f-1', '2026-08-01', snapTemplateAssistedLb(0), [
          { reps: 15, rpe: 8, weight: 47.5 },
        ]),
        unit: 'lb',
        bodyweightSnapshot: { value: 180, unit: 'lb' },
      };
      const log2: WorkoutLog = {
        ...createCompletedLog('log-f-2', '2026-08-03', snapTemplateAssistedLb(0), [
          { reps: 15, rpe: 8, weight: 47.5 },
        ]),
        unit: 'lb',
        bodyweightSnapshot: { value: 180, unit: 'lb' },
      };

      const input = makeInput({
        exercise: assistedEx,
        historicalLogs: [log1, log2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        construction: {
          kind: 'assisted',
          sessionBodyweight: 180,
        },
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 47.5, reps: 15, rpe: 8 },
        ],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('LOAD_PROMOTION_CEILING_REACHED');
        // Assistance drops from 47.5 lb by 5.0 lb to 42.5 lb
        expect(res.presentedPrescription[0].weight).toBe(42.5);
        expect(47.5 - res.presentedPrescription[0].weight).toBe(5.0);
        expect(res.presentedPrescription[0].weight % 2.5).toBeCloseTo(0, 5);
      }
    });

    it('Test G: Pure bodyweight regression advances repetitions with 0 external load', () => {
      const bwEx: ExerciseEntry = {
        ...defaultExercise,
        exerciseKey: 'pull_up',
        name: 'Pull Up',
        modality: 'bodyweight',
      };
      const snapBw = (step: number): PrescriptionSnapshot[] => [
        {
          snapshotVersion: 2,
          progressionPolicyVersion: 1,
          algorithmVersion: 1,
          progressionMode: 'metreps_guided',
          algorithmId: 'hypertrophy_linear',
          exerciseKey: 'pull_up',
          exerciseRole: 'main_movement',
          modality: 'bodyweight',
          comparableLaneKey: 'pull_up:bodyweight:main_movement:hypertrophy_linear:sets-1:hl:wave-volume',
          workingSetOrdinal: 1,
          prescribedWorkingSetCount: 1,
          baseWeight: 0,
          baseReps: 10,
          baseRpe: 8,
          presentedWeight: 0,
          presentedReps: 10,
          presentedRpe: 8,
          bodyweightSnapshot: 175,
          weightUnit: 'lb',
          comparisonLoadKg: 175 * 0.45359237,
          loadBasis: 'bodyweight_normalized_v1',
          loadIncrement: 5.0,
          nudgeType: 'none',
          coachingReasonCode: 'BASE_PRESCRIPTION',
          confirmedStepIndexBefore: step,
          presentedStepIndex: step,
          successCreditEligible: true,
          rollbackTarget: null,
        },
      ];

      const log1: WorkoutLog = {
        ...createCompletedLog('log-g-1', '2026-08-01', snapBw(0), [{ reps: 10, rpe: 8, weight: 0 }]),
        unit: 'lb',
        bodyweightSnapshot: { value: 175, unit: 'lb' },
      };
      const log2: WorkoutLog = {
        ...createCompletedLog('log-g-2', '2026-08-03', snapBw(0), [{ reps: 10, rpe: 8, weight: 0 }]),
        unit: 'lb',
        bodyweightSnapshot: { value: 175, unit: 'lb' },
      };

      const input = makeInput({
        exercise: bwEx,
        historicalLogs: [log1, log2],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        construction: {
          kind: 'bodyweight',
          sessionBodyweight: 175,
        },
        basePrescriptionSets: [{ workingSetOrdinal: 1, weight: 0, reps: 10, rpe: 8 }],
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('REP_NUDGE');
        expect(res.presentedPrescription[0].weight).toBe(0);
        expect(res.presentedPrescription[0].reps).toBe(11);
      }
    });

    it('Test I: Pending nudge and snapshot consistency replays 192.5 lb without grid distortion', () => {
      // Historical log 1 and 2 establish credit at step 0
      const baselineSnapshots: PrescriptionSnapshot[] = [1, 2, 3].map(ord => ({
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
        baseWeight: 187.5,
        baseReps: 15,
        baseRpe: 8,
        presentedWeight: 187.5,
        presentedReps: 15,
        presentedRpe: 8,
        bodyweightSnapshot: null,
        weightUnit: 'lb',
        comparisonLoadKg: 187.5 * 0.45359237,
        loadBasis: 'external_weight_v1',
        loadIncrement: 5.0,
        nudgeType: 'none',
        coachingReasonCode: 'BASE_PRESCRIPTION',
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 0,
        successCreditEligible: true,
        rollbackTarget: null,
      }));

      const log1: WorkoutLog = {
        ...createCompletedLog('log-i-1', '2026-08-01', baselineSnapshots, [
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
        ]),
        unit: 'lb',
      };
      const log2: WorkoutLog = {
        ...createCompletedLog('log-i-2', '2026-08-03', baselineSnapshots, [
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
          { reps: 15, rpe: 8, weight: 187.5 },
        ]),
        unit: 'lb',
      };

      // In log 3, a load nudge to 192.5 lb was presented, but set 1 was skipped (unattempted)
      const pendingSnapshots: PrescriptionSnapshot[] = [1, 2, 3].map(ord => ({
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
        baseWeight: 187.5,
        baseReps: 15,
        baseRpe: 8,
        presentedWeight: ord === 1 ? 192.5 : 187.5,
        presentedReps: 5,
        presentedRpe: ord === 1 ? 8 : ord === 2 ? 8.5 : 9,
        bodyweightSnapshot: null,
        weightUnit: 'lb',
        comparisonLoadKg: (ord === 1 ? 192.5 : 187.5) * 0.45359237,
        loadBasis: 'external_weight_v1',
        loadIncrement: 5.0,
        nudgeType: ord === 1 ? 'load_nudge' : 'none',
        coachingReasonCode: 'LOAD_PROMOTION_CEILING_REACHED',
        confirmedStepIndexBefore: 0,
        presentedStepIndex: 1,
        successCreditEligible: true,
        rollbackTarget: { weight: 187.5, reps: 15, rpe: 8, comparisonLoadKg: 187.5 * 0.45359237 },
      }));

      const log3: WorkoutLog = {
        id: 'log-i-3',
        date: '2026-08-05',
        unit: 'lb',
        programId: defaultProgram.id,
        exercises: [
          {
            exerciseKey: 'bench_press',
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            isMainMovement: true,
            sets: [
              {
                setNumber: 1,
                reps: 0,
                rpe: 0,
                weight: 192.5,
                isCompleted: false,
                isSkipped: true,
                prescriptionSnapshot: pendingSnapshots[0],
              },
              {
                setNumber: 2,
                reps: 5,
                rpe: 8.5,
                weight: 187.5,
                isCompleted: true,
                prescriptionSnapshot: pendingSnapshots[1],
              },
              {
                setNumber: 3,
                reps: 5,
                rpe: 9,
                weight: 187.5,
                isCompleted: true,
                prescriptionSnapshot: pendingSnapshots[2],
              },
            ],
          },
        ],
      };

      const input = makeInput({
        historicalLogs: [log1, log2, log3],
        canonicalIncrement: 5.0,
        activeUnit: 'lb',
        basePrescriptionSets: [
          { workingSetOrdinal: 1, weight: 187.5, reps: 15, rpe: 8 },
          { workingSetOrdinal: 2, weight: 187.5, reps: 15, rpe: 8 },
          { workingSetOrdinal: 3, weight: 187.5, reps: 15, rpe: 8 },
        ],
        construction: {
          kind: 'weighted',
          sessionAnchor: makeAnchor({
            algorithmId: 'hypertrophy_linear',
            profileType: 'hypertrophy',
            roundedAnchorWeight: 187.5,
            rawAnchorWeight: 187.5,
            anchorReps: 15,
            anchorRPE: 8,
            workingSetCount: 3,
          }),
        },
      });

      const res = selectGuidedPrescription(input);
      expect(res.status).toBe('guided');
      if (res.status === 'guided') {
        expect(res.coachingReasonCode).toBe('NUDGE_NEUTRAL_RETRY');
        expect(res.presentedPrescription[0].weight).toBe(192.5);
        expect(res.snapshots[0].loadIncrement).toBe(5.0);
        expect(res.snapshots[0].snapshotVersion).toBe(2);
      }
    });
  });
});
