import { describe, it, expect } from 'vitest';
import {
  isValidRPE,
  roundRPEToHalfStep,
  DEFAULT_RTS_STYLE_PERCENT_1RM,
  getRTSMultiplier as rpeMathGetRTSMultiplier,
  calculateE1RMForSet,
} from '../rpeMath';
import {
  getUndulatingProfileWeek,
  calculateObjectiveSets,
  getRTSMultiplier,
  roundToNearest25,
} from '../objectiveMath';
import {
  createProgramContinuation,
  calculateNextAlgorithmPhaseOffset,
} from '../programContinuation';
import { Program, WorkoutLog, ExerciseEntry } from '../../types';

function createMockLog(params: {
  exerciseName: string;
  weight: number;
  reps: number;
  rpe?: number;
}): WorkoutLog {
  return {
    id: `log-${Date.now()}-${Math.random()}`,
    date: '2026-01-01',
    unit: 'kg',
    exercises: [
      {
        name: params.exerciseName,
        muscleGroup: 'Chest',
        isSkipped: false,
        sets: [
          {
            setNumber: 1,
            weight: params.weight,
            reps: params.reps,
            rpe: params.rpe ?? 8.0,
            isCompleted: true,
            isWarmup: false,
            isSkipped: false,
          },
        ],
      },
    ],
  };
}

function createTargetExercise(params?: Partial<ExerciseEntry>): ExerciseEntry {
  return {
    name: 'Bench Press (Barbell, Flat)',
    muscleGroup: 'Chest',
    modality: 'weighted',
    isMainMovement: true,
    movementCategory: 'compound',
    equipment: 'freeweight',
    sets: [
      { setNumber: 1, weight: 0, reps: 0, rpe: 0, isWarmup: false, isCompleted: false },
      { setNumber: 2, weight: 0, reps: 0, rpe: 0, isWarmup: false, isCompleted: false },
      { setNumber: 3, weight: 0, reps: 0, rpe: 0, isWarmup: false, isCompleted: false },
    ],
    ...params,
  };
}

const standardHistoricalLogs: WorkoutLog[] = [
  {
    id: 'log-fixture-1',
    date: '2026-01-01',
    unit: 'kg',
    exercises: [
      {
        name: 'Bench Press (Barbell, Flat)',
        muscleGroup: 'Chest',
        isSkipped: false,
        sets: [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isWarmup: false },
        ],
      },
    ],
  },
];

describe('APC-3B1: Canonical RPE Numerical Repairs Suite', () => {
  describe('1. Exact RPE Validation Contract (Task 1)', () => {
    it('returns true only for the exact nine supported half-step values', () => {
      const canonicalNine = [6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0];
      for (const val of canonicalNine) {
        expect(isValidRPE(val)).toBe(true);
      }
    });

    it('returns false for all near-half, fractional, out-of-range, and non-finite values', () => {
      const invalidValues = [
        5.99,
        6.01,
        6.04,
        6.49,
        6.51,
        7.33,
        7.99,
        8.01,
        8.04,
        8.2,
        8.49,
        8.51,
        9.99,
        10.01,
        NaN,
        Infinity,
        -Infinity,
        null as any,
        undefined as any,
        -5,
        0,
        5.5,
        10.5,
      ];

      for (const val of invalidValues) {
        expect(isValidRPE(val)).toBe(false);
      }
    });

    it('does not round, normalize, or apply tolerance inside isValidRPE', () => {
      // 7.99 rounds to 8.0 with roundRPEToHalfStep, but isValidRPE must strictly return false
      expect(roundRPEToHalfStep(7.99)).toBe(8.0);
      expect(isValidRPE(7.99)).toBe(false);

      expect(roundRPEToHalfStep(6.01)).toBe(6.0);
      expect(isValidRPE(6.01)).toBe(false);

      expect(roundRPEToHalfStep(8.04)).toBe(8.0);
      expect(isValidRPE(8.04)).toBe(false);
    });

    it('getRTSMultiplier returns null for invalid non-half-step RPEs but preserves fallback in objectiveMath getRTSMultiplier', () => {
      // rpeMath level: exact strict lookup
      expect(rpeMathGetRTSMultiplier(5, 7.99)).toBeNull();
      expect(rpeMathGetRTSMultiplier(5, 8.0)).toBe(0.807);

      // objectiveMath level: non-table fallback estimation
      const fallbackMult = getRTSMultiplier(5, 7.99);
      expect(fallbackMult).toBeGreaterThan(0);
      expect(fallbackMult).not.toBeNull();
    });
  });

  describe('2. Canonical RPE Table Preservation (Task 1 & Task 3)', () => {
    it('preserves all 108 values in the DEFAULT_RTS_STYLE_PERCENT_1RM table', () => {
      expect(DEFAULT_RTS_STYLE_PERCENT_1RM[1][10.0]).toBe(1.000);
      expect(DEFAULT_RTS_STYLE_PERCENT_1RM[1][9.5]).toBe(0.978);
      expect(DEFAULT_RTS_STYLE_PERCENT_1RM[3][8.0]).toBe(0.863);
      expect(DEFAULT_RTS_STYLE_PERCENT_1RM[5][8.0]).toBe(0.807);
      expect(DEFAULT_RTS_STYLE_PERCENT_1RM[10][8.0]).toBe(0.680);
      expect(DEFAULT_RTS_STYLE_PERCENT_1RM[12][6.0]).toBe(0.556);
      expect(DEFAULT_RTS_STYLE_PERCENT_1RM[12][10.0]).toBe(0.680);
    });
  });

  describe('3. Strength Undulating 12-Week Phase & Week 6 Repairs (Task 2)', () => {
    it('12-week Strength Undulating Weeks 5, 6, and 7 return exactly 3 @ 7.0, 3 @ 8.0, and 3 @ 8.5', () => {
      const w5 = getUndulatingProfileWeek(5, 12);
      expect(w5).not.toBeNull();
      expect(w5?.reps).toBe(3);
      expect(w5?.targetRPE).toBe(7.0);

      const w6 = getUndulatingProfileWeek(6, 12);
      expect(w6).not.toBeNull();
      expect(w6?.reps).toBe(3);
      expect(w6?.targetRPE).toBe(8.0);

      const w7 = getUndulatingProfileWeek(7, 12);
      expect(w7).not.toBeNull();
      expect(w7?.reps).toBe(3);
      expect(w7?.targetRPE).toBe(8.5);
    });

    it('Week 6 target load calculates using canonical 3-rep @ RPE 8.0 multiplier (0.863)', () => {
      const baselineE1RM = 100.0;
      // 100 kg baseline: 1 rep @ 10.0 -> e1RM = 100
      const logs = [createMockLog({ exerciseName: 'Squat', weight: baselineE1RM, reps: 1, rpe: 10 })];
      const targetEx = createTargetExercise({ name: 'Squat' });

      const sets = calculateObjectiveSets({
        exercise: targetEx,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 6,
        programDuration: 12,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      // Canonical multiplier for 3 reps @ 8.0 is 0.863
      // 100 kg * 0.863 = 86.3 kg -> roundToNearest25 = 87.5 kg
      expect(sets[0].reps).toBe(3);
      expect(sets[0].rpe).toBe(8.0);
      expect(sets[0].weight).toBe(87.5);

      // Contrast with old defective 7.75 calculation which used fallback multiplier 0.8425 -> 85.0 kg
      const canonicalMultiplier = DEFAULT_RTS_STYLE_PERCENT_1RM[3][8.0];
      expect(canonicalMultiplier).toBe(0.863);
      expect(roundToNearest25(baselineE1RM * canonicalMultiplier)).toBe(87.5);
    });

    it('Week 5, 6, 7 target results expose exact UI-facing RPEs 7.0, 8.0, and 8.5', () => {
      const logs = [createMockLog({ exerciseName: 'Bench Press', weight: 100, reps: 1, rpe: 10 })];
      const targetEx = createTargetExercise({ name: 'Bench Press' });

      const w5Sets = calculateObjectiveSets({
        exercise: targetEx,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 5,
        programDuration: 12,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      expect(w5Sets[0].reps).toBe(3);
      expect(w5Sets[0].rpe).toBe(7.0);

      const w6Sets = calculateObjectiveSets({
        exercise: targetEx,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 6,
        programDuration: 12,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      expect(w6Sets[0].reps).toBe(3);
      expect(w6Sets[0].rpe).toBe(8.0);

      const w7Sets = calculateObjectiveSets({
        exercise: targetEx,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 7,
        programDuration: 12,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      expect(w7Sets[0].reps).toBe(3);
      expect(w7Sets[0].rpe).toBe(8.5);
    });
  });

  describe('4. Complete Schedule & Algorithm Control Preservation (Task 3)', () => {
    it('4-week Strength Undulating schedule matches control baseline', () => {
      const expected4Week = [
        { week: 1, reps: 5, rpe: 7.0 },
        { week: 2, reps: 4, rpe: 8.0 },
        { week: 3, reps: 3, rpe: 9.0 },
        { week: 4, reps: 1, rpe: 10.0 },
      ];

      for (const exp of expected4Week) {
        const p = getUndulatingProfileWeek(exp.week, 4);
        expect(p).not.toBeNull();
        expect(p?.reps).toBe(exp.reps);
        expect(p?.targetRPE).toBe(exp.rpe);
      }
    });

    it('8-week Strength Undulating schedule matches control baseline', () => {
      const expected8Week = [
        { week: 1, reps: 5, rpe: 7.0 },
        { week: 2, reps: 5, rpe: 8.0 },
        { week: 3, reps: 5, rpe: 9.0 },
        { week: 4, reps: 3, rpe: 7.5 },
        { week: 5, reps: 3, rpe: 8.5 },
        { week: 6, reps: 2, rpe: 8.0 },
        { week: 7, reps: 2, rpe: 9.0 },
        { week: 8, reps: 1, rpe: 10.0 },
      ];

      for (const exp of expected8Week) {
        const p = getUndulatingProfileWeek(exp.week, 8);
        expect(p).not.toBeNull();
        expect(p?.reps).toBe(exp.reps);
        expect(p?.targetRPE).toBe(exp.rpe);
      }
    });

    it('12-week Strength Undulating complete 12-week schedule matches canonical specification', () => {
      const expected12Week = [
        { week: 1, reps: 5, rpe: 7.0 },
        { week: 2, reps: 5, rpe: 8.0 },
        { week: 3, reps: 5, rpe: 8.5 },
        { week: 4, reps: 5, rpe: 9.0 },
        { week: 5, reps: 3, rpe: 7.0 },
        { week: 6, reps: 3, rpe: 8.0 },
        { week: 7, reps: 3, rpe: 8.5 },
        { week: 8, reps: 2, rpe: 8.0 },
        { week: 9, reps: 2, rpe: 8.5 },
        { week: 10, reps: 2, rpe: 9.5 },
        { week: 11, reps: 1, rpe: 9.0 },
        { week: 12, reps: 1, rpe: 10.0 },
      ];

      for (const exp of expected12Week) {
        const p = getUndulatingProfileWeek(exp.week, 12);
        expect(p).not.toBeNull();
        expect(p?.reps).toBe(exp.reps);
        expect(p?.targetRPE).toBe(exp.rpe);
      }
    });

    it('Strength Linear control cases remain unchanged', () => {
      const logs = [createMockLog({ exerciseName: 'Deadlift', weight: 100, reps: 1, rpe: 10 })];
      const targetEx = createTargetExercise({ name: 'Deadlift' });

      // Week 1 of 8-week Linear: reps 8, RPE 7.0
      const w1 = calculateObjectiveSets({
        exercise: targetEx,
        objective: 'Strength',
        algorithmId: 'strength_linear',
        weekNum: 1,
        programDuration: 8,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      expect(w1[0].reps).toBe(8);
      expect(w1[0].rpe).toBe(7.0);

      // Week 8 of 8-week Linear: reps 1, RPE 10.0
      const w8 = calculateObjectiveSets({
        exercise: targetEx,
        objective: 'Strength',
        algorithmId: 'strength_linear',
        weekNum: 8,
        programDuration: 8,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      expect(w8[0].reps).toBe(1);
      expect(w8[0].rpe).toBe(10.0);
    });

    it('Hypertrophy Linear and Step Loading schedules remain unchanged', () => {
      const logs = [createMockLog({ exerciseName: 'Incline Dumbbell Press', weight: 30, reps: 10, rpe: 8 })];
      const targetEx = createTargetExercise({
        name: 'Incline Dumbbell Press',
        movementCategory: 'compound',
        equipment: 'freeweight',
      });

      const hypLinW1 = calculateObjectiveSets({
        exercise: targetEx,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        weekNum: 1,
        programDuration: 8,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      // Wave volume Week 1 compound freeweight: 12 reps @ RPE 8.0
      expect(hypLinW1[0].reps).toBe(12);
      expect(hypLinW1[0].rpe).toBe(8.0);

      const hypStepW1 = calculateObjectiveSets({
        exercise: targetEx,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_step',
        weekNum: 1,
        programDuration: 8,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      // Step loading Week 1 compound freeweight: 10 reps @ RPE 7.0
      expect(hypStepW1[0].reps).toBe(10);
      expect(hypStepW1[0].rpe).toBe(7.0);
    });

    it('Preserves continuation algorithmPhaseOffset calculations and runtime target resolution', () => {
      const baseProgram: Program = {
        id: 'prog-orig-12',
        name: '12-Week Step Program',
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_step',
        daysPerWeek: 3,
        programDuration: 8,
        createdAt: '2026-01-01T00:00:00.000Z',
        exercisesByDay: {
          1: [
            {
              name: 'Barbell Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8, form: 'standard' }],
            },
          ],
          2: [],
          3: [],
        },
        assignedWeekdays: { 1: 0, 2: 2, 3: 4 },
      };

      const contProgram = createProgramContinuation(baseProgram);
      expect(contProgram.algorithmPhaseOffset).toBe(8);

      // Verify calculation of next phase offset
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 0, 8)).toBe(8);
      expect(calculateNextAlgorithmPhaseOffset('hypertrophy_step', 8, 8)).toBe(4);
      expect(calculateNextAlgorithmPhaseOffset('strength_undulating', 0, 12)).toBe(0);

      // Generating targets for continuation week 1 (effective week 1 + 8 = 9)
      const logs = [createMockLog({ exerciseName: 'Barbell Bench Press', weight: 100, reps: 8, rpe: 8 })];
      const targetEx = createTargetExercise({
        name: 'Barbell Bench Press',
        movementCategory: 'compound',
        equipment: 'freeweight',
      });
      const contSets = calculateObjectiveSets({
        exercise: targetEx,
        objective: 'Hypertrophy',
        algorithmId: contProgram.algorithmId,
        weekNum: 1,
        programDuration: 8,
        previousLogs: logs,
        algorithmPhaseOffset: contProgram.algorithmPhaseOffset,
        activeUnit: 'kg',
      });

      // Hypertrophy step week 9 (block 3): 6 reps @ RPE 8.0
      expect(contSets[0].reps).toBe(6);
      expect(contSets[0].rpe).toBe(8.0);
    });
  });
});
