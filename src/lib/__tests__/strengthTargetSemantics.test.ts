import { describe, it, expect } from 'vitest';
import {
  calculateObjectiveSets,
  calculateAddedSetTarget,
  getUndulatingProfileWeek,
  getRTSMultiplier,
  roundToNearest25,
} from '../objectiveMath';
import { calculateE1RMForSet } from '../rpeMath';
import { solveBodyweightRepTarget, projectAssistedTarget } from '../modalityTargetMath';
import { ExerciseEntry, WorkoutLog, BodyweightSnapshot, WeightUnit } from '../../types';

function createMockLog(params: {
  exerciseName: string;
  weight: number;
  reps: number;
  rpe?: number;
  date?: string;
  isWarmup?: boolean;
  modality?: 'weighted' | 'bodyweight' | 'assisted';
  assistanceWeight?: number;
  bodyweightSnapshot?: BodyweightSnapshot;
  unit?: WeightUnit;
}): WorkoutLog {
  const {
    exerciseName,
    weight,
    reps,
    rpe,
    date = '2026-08-01T10:00:00Z',
    isWarmup = false,
    modality = 'weighted',
    assistanceWeight,
    bodyweightSnapshot,
    unit = 'kg',
  } = params;

  return {
    id: `log-${Date.now()}-${Math.random()}`,
    date,
    unit,
    bodyweightSnapshot,
    exercises: [
      {
        name: exerciseName,
        muscleGroup: 'Chest',
        modality,
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [
          {
            setNumber: 1,
            reps,
            weight: modality === 'assisted' ? (assistanceWeight ?? weight) : weight,
            rpe,
            isWarmup,
            isCompleted: true,
          },
        ],
      },
    ],
  };
}

function createTargetExercise(params: {
  name?: string;
  setCount?: number;
  modality?: 'weighted' | 'bodyweight' | 'assisted';
  isMainMovement?: boolean;
  movementCategory?: 'compound' | 'isolation';
  equipment?: 'freeweight' | 'machine';
}): ExerciseEntry {
  const {
    name = 'Squat',
    setCount = 3,
    modality = 'weighted',
    isMainMovement = true,
    movementCategory = 'compound',
    equipment = 'freeweight',
  } = params;

  return {
    name,
    muscleGroup: 'Legs',
    modality,
    movementCategory,
    equipment,
    isMainMovement,
    sets: Array.from({ length: setCount }, (_, i) => ({
      setNumber: i + 1,
      reps: 0,
      weight: 0,
      isCompleted: false,
    })),
  };
}

describe('strengthTargetSemantics - Direct Semantic Coverage and Modality-Accurate Copy Closure', () => {
  describe('1. Canonical Strength Fixtures', () => {
    it('1. Strength Undulating 4-week Week 3 produces 90 kg x 3 @ 9.0 (Set 1) with 85 kg back-offs (Sets 2-3)', () => {
      // 100 kg baseline -> 3 reps @ RPE 9.0 (multiplier 0.892 -> 89.2 kg -> 90.0 kg)
      const logs = [createMockLog({ exerciseName: 'Bench Press', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Bench Press', setCount: 3 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 3,
        programDuration: 4,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(90.0);
      expect(sets[0].reps).toBe(3);
      expect(sets[0].rpe).toBe(9.0);

      expect(sets[1].weight).toBe(85.0);
      expect(sets[1].reps).toBe(3);
      expect(sets[1].rpe).toBe(8.0);

      expect(sets[2].weight).toBe(85.0);
      expect(sets[2].reps).toBe(3);
      expect(sets[2].rpe).toBe(8.5);
    });

    it('2. Strength Undulating 8-week Week 4 produces 85 kg x 3 @ 7.5 (Set 1) with 80 kg back-offs (Sets 2-3)', () => {
      // 100 kg baseline -> 3 reps @ RPE 7.5 (multiplier 0.849 -> 84.9 kg -> 85.0 kg)
      const logs = [createMockLog({ exerciseName: 'Bench Press', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Bench Press', setCount: 3 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 8,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(85.0);
      expect(sets[0].reps).toBe(3);
      expect(sets[0].rpe).toBe(7.5);

      expect(sets[1].weight).toBe(80.0);
      expect(sets[1].reps).toBe(3);
      expect(sets[1].rpe).toBe(6.5);

      expect(sets[2].weight).toBe(80.0);
      expect(sets[2].reps).toBe(3);
      expect(sets[2].rpe).toBe(7.0);
    });

    it('3. Strength Undulating 8-week Week 6 produces 90 kg x 2 @ 8.0 (Set 1) with 85 kg back-offs (Sets 2-3)', () => {
      // 100 kg baseline -> 2 reps @ RPE 8.0 (multiplier 0.892 -> 89.2 kg -> 90.0 kg)
      const logs = [createMockLog({ exerciseName: 'Bench Press', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Bench Press', setCount: 3 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 6,
        programDuration: 8,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(90.0);
      expect(sets[0].reps).toBe(2);
      expect(sets[0].rpe).toBe(8.0);

      expect(sets[1].weight).toBe(85.0);
      expect(sets[1].reps).toBe(2);
      expect(sets[1].rpe).toBe(7.0);

      expect(sets[2].weight).toBe(85.0);
      expect(sets[2].reps).toBe(2);
      expect(sets[2].rpe).toBe(7.5);
    });

    it('4. Strength Linear 12-week Week 11 produces 95 kg x 2 @ 9.5 (Set 1) with 87.5 kg back-offs (Sets 2-3)', () => {
      // 100 kg baseline -> 2 reps @ RPE 9.5 (multiplier 0.939 -> 93.9 kg -> 95.0 kg)
      const logs = [createMockLog({ exerciseName: 'Bench Press', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Bench Press', setCount: 3 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_linear',
        weekNum: 11,
        programDuration: 12,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(95.0);
      expect(sets[0].reps).toBe(2);
      expect(sets[0].rpe).toBe(9.5);

      expect(sets[1].weight).toBe(87.5);
      expect(sets[1].reps).toBe(2);
      expect(sets[1].rpe).toBe(8.0);

      expect(sets[2].weight).toBe(87.5);
      expect(sets[2].reps).toBe(2);
      expect(sets[2].rpe).toBe(8.5);
    });
  });

  describe('2. Canonical Identity & RTS Multiplier Authority', () => {
    it('5. Every Set 1 week of supported 4, 8, and 12-week Strength Undulating profiles originates from getRTSMultiplier with boundary protection', () => {
      const baselineE1RM = 100;
      const logs = [createMockLog({ exerciseName: 'Squat', weight: baselineE1RM, reps: 1, rpe: 10 })];

      const durations = [4, 8, 12];
      for (const duration of durations) {
        for (let week = 1; week <= duration; week++) {
          const profile = getUndulatingProfileWeek(week, duration);
          expect(profile).not.toBeNull();
          if (!profile) continue;

          const { reps, targetRPE } = profile;
          const canonicalMultiplier = getRTSMultiplier(reps, targetRPE);
          expect(canonicalMultiplier).not.toBeNull();
          if (!canonicalMultiplier) continue;

          const rawTarget = baselineE1RM * canonicalMultiplier;
          const rpe10Boundary = baselineE1RM * (getRTSMultiplier(reps, 10.0) ?? 1);

          const expectedQuantized = roundToNearest25(rawTarget);
          const expectedFinal = Math.min(
            expectedQuantized,
            Math.floor((rpe10Boundary + 1e-4) / 2.5) * 2.5
          );

          const exercise = createTargetExercise({ name: 'Squat', setCount: 1 });
          const sets = calculateObjectiveSets({
            exercise,
            objective: 'Strength',
            algorithmId: 'strength_undulating',
            weekNum: week,
            programDuration: duration,
            previousLogs: logs,
            activeUnit: 'kg',
          });

          expect(sets[0].reps).toBe(reps);
          expect(sets[0].rpe).toBe(targetRPE);
          expect(sets[0].weight).toBe(expectedFinal);
          expect(sets[0].weight!).toBeLessThanOrEqual(rpe10Boundary + 1e-6);
        }
      }
    });

    it('6. Every week of 4, 8, and 12-week Strength Linear programs strictly originates from getRTSMultiplier with boundary protection', () => {
      const baselineE1RM = 100;
      const logs = [createMockLog({ exerciseName: 'Squat', weight: baselineE1RM, reps: 1, rpe: 10 })];

      const durations = [4, 8, 12];
      for (const duration of durations) {
        for (let week = 1; week <= duration; week++) {
          const progress = (week - 1) / (duration - 1);
          const reps = Math.max(1, Math.min(8, Math.round(8 - progress * 7)));
          const targetRPE = Math.max(7.0, Math.min(10.0, Math.round((7.0 + progress * 3.0) * 2) / 2));

          const canonicalMultiplier = getRTSMultiplier(reps, targetRPE);
          expect(canonicalMultiplier).not.toBeNull();
          if (!canonicalMultiplier) continue;

          const rawTarget = baselineE1RM * canonicalMultiplier;
          const rpe10Boundary = baselineE1RM * (getRTSMultiplier(reps, 10.0) ?? 1);

          const expectedQuantized = roundToNearest25(rawTarget);
          const expectedFinal = Math.min(
            expectedQuantized,
            Math.floor((rpe10Boundary + 1e-4) / 2.5) * 2.5
          );

          const exercise = createTargetExercise({ name: 'Squat', setCount: 1 });
          const sets = calculateObjectiveSets({
            exercise,
            objective: 'Strength',
            algorithmId: 'strength_linear',
            weekNum: week,
            programDuration: duration,
            previousLogs: logs,
            activeUnit: 'kg',
          });

          expect(sets[0].reps).toBe(reps);
          expect(sets[0].rpe).toBe(targetRPE);
          expect(sets[0].weight).toBe(expectedFinal);
          expect(sets[0].weight!).toBeLessThanOrEqual(rpe10Boundary + 1e-6);
        }
      }
    });

    it('7. Confirms no active Strength load is derived from an independently interpolated target1RMPercent', () => {
      // Week 1 of 8-week undulating: reps 5, RPE 7.0, canonical multiplier 0.779
      // raw = 100 * 0.779 = 77.9 kg -> rounded 77.5 kg.
      // An independent percentage like 80.0% would yield 80.0 kg.
      const logs = [createMockLog({ exerciseName: 'Squat', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Squat', setCount: 1 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 1,
        programDuration: 8,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      const canonicalMultiplier = getRTSMultiplier(5, 7.0);
      expect(canonicalMultiplier).toBe(0.779);
      expect(sets[0].weight).toBe(77.5);
    });
  });

  describe('3. RPE-10 Rounding Boundary Guard', () => {
    it('8. Weighted kg fixture clamps nearest-2.5 rounding to highest increment at or below RPE-10 boundary', () => {
      // Baseline 101.3 kg for 1 rep @ RPE 10.0
      // raw = 101.3 * 1.0 = 101.3 kg -> nearest 2.5 is 102.5 kg.
      // Canonical RPE-10 boundary = 101.3 kg.
      // Boundary clamp enforces highest 2.5 increment <= 101.3 kg, which is 100.0 kg.
      const logs = [createMockLog({ exerciseName: 'Deadlift', weight: 101.3, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Deadlift', setCount: 1 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 4,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(sets[0].reps).toBe(1);
      expect(sets[0].rpe).toBe(10.0);
      expect(sets[0].weight).toBe(100.0);
      expect(sets[0].weight!).toBeLessThanOrEqual(101.3);
    });

    it('9. Weighted lb fixture clamps nearest-2.5 rounding to highest increment at or below RPE-10 boundary', () => {
      // Baseline 201.3 lb for 1 rep @ RPE 10.0
      // raw = 201.3 * 1.0 = 201.3 lb -> nearest 2.5 is 202.5 lb.
      // Canonical RPE-10 boundary = 201.3 lb.
      // Boundary clamp enforces highest 2.5 increment <= 201.3 lb, which is 200.0 lb.
      const logs = [createMockLog({ exerciseName: 'Deadlift', weight: 201.3, reps: 1, rpe: 10, unit: 'lb' })];
      const exercise = createTargetExercise({ name: 'Deadlift', setCount: 1 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 4,
        previousLogs: logs,
        activeUnit: 'lb',
      });

      expect(sets[0].reps).toBe(1);
      expect(sets[0].rpe).toBe(10.0);
      expect(sets[0].weight).toBe(200.0);
      expect(sets[0].weight!).toBeLessThanOrEqual(201.3);
    });

    it('10. Scans all supported Strength Undulating and representative Linear weeks to ensure no weighted target exceeds RPE-10 boundary', () => {
      const baselines = [60, 77.5, 93.3, 100, 101.3, 142.7, 205.5];
      for (const baseline of baselines) {
        const logs = [createMockLog({ exerciseName: 'Bench Press', weight: baseline, reps: 1, rpe: 10 })];

        for (const duration of [4, 8, 12]) {
          for (let week = 1; week <= duration; week++) {
            const exercise = createTargetExercise({ name: 'Bench Press', setCount: 3 });
            const sets = calculateObjectiveSets({
              exercise,
              objective: 'Strength',
              algorithmId: 'strength_undulating',
              weekNum: week,
              programDuration: duration,
              previousLogs: logs,
              activeUnit: 'kg',
            });

            for (const set of sets) {
              if (set.weight !== undefined && set.reps !== undefined && set.weight !== null && set.reps !== null) {
                const rpe10Boundary = baseline * (getRTSMultiplier(set.reps, 10.0) ?? 1);
                expect(set.weight).toBeLessThanOrEqual(rpe10Boundary + 1e-6);
              }
            }
          }
        }
      }
    });
  });

  describe('4. Cross-Unit Behavior', () => {
    it('11. Physically equivalent kg and lb Strength fixtures maintain physical equivalence within combined quantization bound and obey RPE-10 boundaries', () => {
      // 100 kg baseline vs 220.462 lb baseline
      const kgBaseline = 100;
      const lbBaseline = 100 * 2.20462262;

      const kgLogs = [createMockLog({ exerciseName: 'Squat', weight: kgBaseline, reps: 1, rpe: 10, unit: 'kg' })];
      const lbLogs = [createMockLog({ exerciseName: 'Squat', weight: lbBaseline, reps: 1, rpe: 10, unit: 'lb' })];

      const kgEx = createTargetExercise({ name: 'Squat', setCount: 3 });
      const lbEx = createTargetExercise({ name: 'Squat', setCount: 3 });

      const kgSets = calculateObjectiveSets({
        exercise: kgEx,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 8,
        previousLogs: kgLogs,
        activeUnit: 'kg',
      });

      const lbSets = calculateObjectiveSets({
        exercise: lbEx,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 8,
        previousLogs: lbLogs,
        activeUnit: 'lb',
      });

      // Target Set 1: 3 reps @ RPE 7.5
      // kg: 100 * 0.849 = 84.9 -> 85.0 kg
      // lb: 220.462 * 0.849 = 187.17 -> 187.5 lb
      expect(kgSets[0].weight).toBe(85.0);
      expect(lbSets[0].weight).toBe(187.5);

      // Physical divergence: 187.5 lb / 2.20462 = 85.048 kg -> difference is 0.048 kg
      const lbConvertedToKg = lbSets[0].weight! / 2.20462262;
      const divergenceKg = Math.abs(lbConvertedToKg - kgSets[0].weight!);
      expect(divergenceKg).toBeLessThanOrEqual(2.5 * 0.453592 + 2.5 / 2);

      // RPE-10 boundary verification
      const kgBoundary = kgBaseline * (getRTSMultiplier(3, 10.0) ?? 1);
      const lbBoundary = lbBaseline * (getRTSMultiplier(3, 10.0) ?? 1);
      expect(kgSets[0].weight!).toBeLessThanOrEqual(kgBoundary + 1e-6);
      expect(lbSets[0].weight!).toBeLessThanOrEqual(lbBoundary + 1e-6);
    });
  });

  describe('5. Modality Projections (Bodyweight & Assisted)', () => {
    it('12. Bodyweight Strength fixture displays 0 weight, integer reps in Strength envelope, matches solveBodyweightRepTarget, and preserves snapshot immutability', () => {
      const snapshot: BodyweightSnapshot = {
        value: 80.0,
        unit: 'kg',
      };
      const snapshotClone = JSON.parse(JSON.stringify(snapshot));

      // 80 kg bodyweight, historical pullups: 80 kg effective x 5 reps @ RPE 8.0 -> e1RM = 80 / 0.807 = 99.1325 kg
      const logs = [
        createMockLog({
          exerciseName: 'Pull Up',
          weight: 0,
          reps: 5,
          rpe: 8.0,
          modality: 'bodyweight',
          bodyweightSnapshot: snapshot,
        }),
      ];

      const exercise = createTargetExercise({
        name: 'Pull Up',
        setCount: 1,
        modality: 'bodyweight',
      });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 8,
        previousLogs: logs,
        bodyweightSnapshot: snapshot,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(0);
      expect(Number.isInteger(sets[0].reps)).toBe(true);
      expect(sets[0].reps!).toBeGreaterThanOrEqual(1);
      expect(sets[0].reps!).toBeLessThanOrEqual(6);
      expect(sets[0].rpe).toBe(7.5);

      // Parity check against direct solveBodyweightRepTarget
      const solvedE1RM = 80.0 / (getRTSMultiplier(5, 8.0) ?? 1);
      const directSolved = solveBodyweightRepTarget({
        targetE1RM: solvedE1RM,
        sessionBodyweight: 80.0,
        targetRPE: 7.5,
        anchorReps: 3,
        minReps: 1,
        maxReps: 6,
        unit: 'kg',
      });
      expect(sets[0].reps).toBe(directSolved.reps);

      // Immutability check
      expect(snapshot).toEqual(snapshotClone);
    });

    it('13. Assisted Strength fixture matches projectAssistedTarget, quantizes assistance to 2.5 increment, verifies inverse direction, and preserves snapshot immutability', () => {
      const snapshot: BodyweightSnapshot = {
        value: 80.0,
        unit: 'kg',
      };
      const snapshotClone = JSON.parse(JSON.stringify(snapshot));

      // 80 kg bodyweight, 20 kg assistance -> effective load = 60 kg x 1 rep @ RPE 10.0 -> e1RM = 60 kg
      const logs = [
        createMockLog({
          exerciseName: 'Assisted Pull Up',
          weight: 0,
          assistanceWeight: 20.0,
          reps: 1,
          rpe: 10.0,
          modality: 'assisted',
          bodyweightSnapshot: snapshot,
        }),
      ];

      const exercise = createTargetExercise({
        name: 'Assisted Pull Up',
        setCount: 1,
        modality: 'assisted',
      });

      // Week 4 of 8-week undulating: 3 reps @ RPE 7.5 (multiplier 0.849)
      // Target effective load = 60 * 0.849 = 50.94 kg
      // Unrounded assistance = 80 - 50.94 = 29.06 kg -> quantized 30.0 kg assistance
      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 8,
        previousLogs: logs,
        bodyweightSnapshot: snapshot,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(30.0);
      expect(sets[0].reps).toBe(3);
      expect(sets[0].rpe).toBe(7.5);

      // Direct projectAssistedTarget parity
      const directAssisted = projectAssistedTarget({
        targetEffectiveLoad: 60 * 0.849,
        sessionBodyweight: 80.0,
        targetReps: 3,
        targetRPE: 7.5,
        unit: 'kg',
        increment: 2.5,
      });
      expect(sets[0].weight).toBe(directAssisted.assistanceWeight);

      // Inverse direction verification:
      // Higher target effective load (e.g. 55 kg) -> lower assistance (25 kg)
      const higherLoad = projectAssistedTarget({
        targetEffectiveLoad: 55.0,
        sessionBodyweight: 80.0,
        targetReps: 3,
        targetRPE: 7.5,
        unit: 'kg',
      });
      // Lower target effective load (e.g. 40 kg) -> higher assistance (40 kg)
      const lowerLoad = projectAssistedTarget({
        targetEffectiveLoad: 40.0,
        sessionBodyweight: 80.0,
        targetReps: 3,
        targetRPE: 7.5,
        unit: 'kg',
      });
      expect(higherLoad.assistanceWeight).toBeLessThan(sets[0].weight!);
      expect(lowerLoad.assistanceWeight).toBeGreaterThan(sets[0].weight!);

      // Immutability
      expect(snapshot).toEqual(snapshotClone);
    });
  });

  describe('6. Added-Set Parity', () => {
    it('14. calculateAddedSetTarget matches calculateObjectiveSets for weighted Strength', () => {
      const logs = [createMockLog({ exerciseName: 'Squat', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Squat', setCount: 3 });

      const fullSets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 8,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      // Target for ordinal 3 (3rd working set)
      const expectedSet3 = fullSets[2];

      const addedResult = calculateAddedSetTarget({
        exercise: createTargetExercise({ name: 'Squat', setCount: 2 }),
        weekNum: 4,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        programDuration: 8,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(addedResult.isPrescribed).toBe(true);
      expect(addedResult.target?.weight).toBe(expectedSet3.weight);
      expect(addedResult.target?.reps).toBe(expectedSet3.reps);
      expect(addedResult.target?.rpe).toBe(expectedSet3.rpe);
      expect(addedResult.target?.form).toBe('standard');
    });

    it('15. calculateAddedSetTarget matches calculateObjectiveSets for bodyweight Strength', () => {
      const snapshot: BodyweightSnapshot = {
        value: 75.0,
        unit: 'kg',
      };
      const logs = [
        createMockLog({
          exerciseName: 'Dips',
          weight: 0,
          reps: 6,
          rpe: 8.0,
          modality: 'bodyweight',
          bodyweightSnapshot: snapshot,
        }),
      ];
      const exercise = createTargetExercise({
        name: 'Dips',
        setCount: 3,
        modality: 'bodyweight',
      });

      const fullSets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 8,
        previousLogs: logs,
        bodyweightSnapshot: snapshot,
        activeUnit: 'kg',
      });

      const addedResult = calculateAddedSetTarget({
        exercise: createTargetExercise({ name: 'Dips', setCount: 1, modality: 'bodyweight' }),
        weekNum: 4,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        programDuration: 8,
        previousLogs: logs,
        bodyweightSnapshot: snapshot,
        activeUnit: 'kg',
      });

      expect(addedResult.isPrescribed).toBe(true);
      expect(addedResult.target?.weight).toBe(0);
      expect(addedResult.target?.reps).toBe(fullSets[1].reps);
      expect(addedResult.target?.rpe).toBe(fullSets[1].rpe);
    });

    it('16. calculateAddedSetTarget matches calculateObjectiveSets for assisted Strength', () => {
      const snapshot: BodyweightSnapshot = {
        value: 80.0,
        unit: 'kg',
      };
      const logs = [
        createMockLog({
          exerciseName: 'Assisted Chin Up',
          weight: 0,
          assistanceWeight: 20.0,
          reps: 1,
          rpe: 10.0,
          modality: 'assisted',
          bodyweightSnapshot: snapshot,
        }),
      ];
      const exercise = createTargetExercise({
        name: 'Assisted Chin Up',
        setCount: 3,
        modality: 'assisted',
      });

      const fullSets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 4,
        programDuration: 8,
        previousLogs: logs,
        bodyweightSnapshot: snapshot,
        activeUnit: 'kg',
      });

      const addedResult = calculateAddedSetTarget({
        exercise: createTargetExercise({ name: 'Assisted Chin Up', setCount: 1, modality: 'assisted' }),
        weekNum: 4,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        programDuration: 8,
        previousLogs: logs,
        bodyweightSnapshot: snapshot,
        activeUnit: 'kg',
      });

      expect(addedResult.isPrescribed).toBe(true);
      expect(addedResult.target?.reps).toBe(fullSets[1].reps);
      expect(addedResult.target?.rpe).toBe(fullSets[1].rpe);
    });
  });

  describe('7. Live Evidence Reconstruction', () => {
    it('17. Exact unrounded canonical fixture reconstructs contextual baseline within floating-point tolerance', () => {
      // Exact unrounded: 1 rep @ RPE 10.0 -> multiplier 1.0. Baseline 100 kg.
      const baseline = 100.0;
      const weight = 100.0;
      const reps = 1;
      const rpe = 10.0;

      const reconstructedE1RM = calculateE1RMForSet(weight, reps, rpe);
      expect(reconstructedE1RM).not.toBeNull();
      expect(Math.abs(reconstructedE1RM! - baseline)).toBeLessThan(1e-5);
    });

    it('18. Quantized fixture reconstructs contextual baseline within mathematically derived rounding-error bound', () => {
      // 3 reps @ RPE 7.5 (multiplier 0.849).
      // Baseline 100 kg -> raw 84.9 kg -> quantized 85.0 kg.
      // Reconstructed e1RM = 85.0 / 0.849 = 100.117 kg.
      // Max rounding deviation = (2.5 / 2) / multiplier = 1.25 / 0.849 = 1.47 kg.
      const baseline = 100.0;
      const reps = 3;
      const rpe = 7.5;
      const multiplier = getRTSMultiplier(reps, rpe);
      expect(multiplier).not.toBeNull();
      if (!multiplier) return;

      const rawTarget = baseline * multiplier;
      const quantizedTarget = roundToNearest25(rawTarget);

      const reconstructedE1RM = calculateE1RMForSet(quantizedTarget, reps, rpe);
      expect(reconstructedE1RM).not.toBeNull();

      const maxRoundingError = 1.25 / multiplier;
      expect(Math.abs(reconstructedE1RM! - baseline)).toBeLessThanOrEqual(maxRoundingError);
    });
  });

  describe('8. Duration Behavior & Guards', () => {
    it('19. Strength Undulating supports 4 weeks', () => {
      const p = getUndulatingProfileWeek(4, 4);
      expect(p).not.toBeNull();
      expect(p?.reps).toBe(1);
      expect(p?.targetRPE).toBe(10.0);
    });

    it('20. Strength Undulating supports 8 weeks', () => {
      const p = getUndulatingProfileWeek(8, 8);
      expect(p).not.toBeNull();
      expect(p?.reps).toBe(1);
      expect(p?.targetRPE).toBe(10.0);
    });

    it('21. Strength Undulating supports 12 weeks', () => {
      const p = getUndulatingProfileWeek(12, 12);
      expect(p).not.toBeNull();
      expect(p?.reps).toBe(1);
      expect(p?.targetRPE).toBe(10.0);
    });

    it('22. 6-week Strength Undulating safely bypasses without modulo wrapping or mutation', () => {
      const p = getUndulatingProfileWeek(2, 6);
      expect(p).toBeNull();

      const logs = [createMockLog({ exerciseName: 'Squat', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Squat', setCount: 3 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 2,
        programDuration: 6,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      // Draft values are preserved without target mutation
      expect(sets[0].weight).toBe(0);
      expect(sets[0].reps).toBe(0);
    });

    it('23. 10-week Strength Undulating safely bypasses without modulo wrapping or mutation', () => {
      const p = getUndulatingProfileWeek(5, 10);
      expect(p).toBeNull();

      const logs = [createMockLog({ exerciseName: 'Squat', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Squat', setCount: 3 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_undulating',
        weekNum: 5,
        programDuration: 10,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(0);
      expect(sets[0].reps).toBe(0);
    });

    it('24. Strength Linear continues supporting 12 weeks', () => {
      const logs = [createMockLog({ exerciseName: 'Squat', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Squat', setCount: 1 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_linear',
        weekNum: 12,
        programDuration: 12,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(100.0);
      expect(sets[0].reps).toBe(1);
      expect(sets[0].rpe).toBe(10.0);
    });

    it('25. Strength Linear is not unintentionally restricted by Undulating duration guard', () => {
      // 6-week Strength Linear works smoothly via continuous mathematical interpolation
      const logs = [createMockLog({ exerciseName: 'Squat', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Squat', setCount: 1 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Strength',
        algorithmId: 'strength_linear',
        weekNum: 6,
        programDuration: 6,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(100.0);
      expect(sets[0].reps).toBe(1);
      expect(sets[0].rpe).toBe(10.0);
    });
  });

  describe('9. Protected-Algorithm Invariance', () => {
    it('26. Representative Hypertrophy Wave Volume fixtures retain existing expected outputs', () => {
      // 100 kg baseline.
      // Week 1 (Odd): Compound Free Weight = 12 reps @ RPE 8.0 (multiplier 0.618 -> 61.8 kg -> 62.5 kg Set 1)
      // Accessory (Isolation Free Weight) = 15 reps @ RPE 8.0 (multiplier 0.5785 -> 57.85 kg -> 57.5 kg Set 1)
      // Week 2 (Even): Compound Free Weight = 6 reps @ RPE 8.0 (multiplier 0.779 -> 77.9 kg -> 77.5 kg Set 1)
      const logs = [createMockLog({ exerciseName: 'Bench Press', weight: 100, reps: 1, rpe: 10 })];

      const compoundEx = createTargetExercise({ name: 'Bench Press', setCount: 3, isMainMovement: true, movementCategory: 'compound', equipment: 'freeweight' });
      const isoEx = createTargetExercise({ name: 'Bench Press', setCount: 1, isMainMovement: false, movementCategory: 'isolation', equipment: 'freeweight' });

      const w1Compound = calculateObjectiveSets({
        exercise: compoundEx,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        weekNum: 1,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      expect(w1Compound[0].weight).toBe(62.5);
      expect(w1Compound[0].reps).toBe(12);
      expect(w1Compound[0].rpe).toBe(8.0);

      const w1Iso = calculateObjectiveSets({
        exercise: isoEx,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        weekNum: 1,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      expect(w1Iso[0].weight).toBe(57.5);
      expect(w1Iso[0].reps).toBe(15);
      expect(w1Iso[0].rpe).toBe(8.0);

      const w2Compound = calculateObjectiveSets({
        exercise: compoundEx,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_linear',
        weekNum: 2,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      expect(w2Compound[0].weight).toBe(77.5);
      expect(w2Compound[0].reps).toBe(6);
      expect(w2Compound[0].rpe).toBe(8.0);
    });

    it('27. Representative Hypertrophy Step Loading fixtures retain existing expected outputs', () => {
      // 100 kg baseline.
      // Week 1 (Base 10 @ 7.0): Compound Free Weight = 10 reps @ RPE 7.0 (multiplier 0.649 -> 64.9 kg -> 65.0 kg Set 1)
      const logs = [createMockLog({ exerciseName: 'Bench Press', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Bench Press', setCount: 1, movementCategory: 'compound', equipment: 'freeweight' });

      const w1 = calculateObjectiveSets({
        exercise,
        objective: 'Hypertrophy',
        algorithmId: 'hypertrophy_step',
        weekNum: 1,
        previousLogs: logs,
        activeUnit: 'kg',
      });
      expect(w1[0].weight).toBe(65.0);
      expect(w1[0].reps).toBe(10);
      expect(w1[0].rpe).toBe(7.0);
    });

    it('28. Representative Deload fixtures retain existing expected outputs', () => {
      // Deload: 100 kg baseline -> baseWeight = 70.0 kg -> 50% working weight = 35.0 kg. Reps: 5, RPE: 5.0.
      const logs = [createMockLog({ exerciseName: 'Squat', weight: 100, reps: 1, rpe: 10 })];
      const exercise = createTargetExercise({ name: 'Squat', setCount: 3 });

      const sets = calculateObjectiveSets({
        exercise,
        objective: 'Deload',
        weekNum: 1,
        previousLogs: logs,
        activeUnit: 'kg',
      });

      expect(sets[0].weight).toBe(35.0);
      expect(sets[0].reps).toBe(5);
      expect(sets[0].rpe).toBe(5.0);
      expect(sets[1].weight).toBe(35.0);
      expect(sets[1].reps).toBe(5);
      expect(sets[2].weight).toBe(35.0);
      expect(sets[2].reps).toBe(5);
    });
  });
});
