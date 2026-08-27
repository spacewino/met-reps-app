import { describe, it, expect } from 'vitest';
import {
  calculateObjectiveSets,
  generateSessionTargetMap,
  calculateAddedSetTarget,
  deriveCanonicalPrescriptionShape,
} from '../objectiveMath';
import { prepareExercisesForSave } from '../workoutCompletion';
import { ExerciseEntry, WorkoutLog, BodyweightSnapshot } from '../../types';

describe('MetReps Stage 1 — Weighted Zero-Baseline Algorithm Guidance', () => {
  const zeroSets = (count: number = 3) =>
    Array.from({ length: count }, (_, i) => ({
      setNumber: i + 1,
      weight: 0,
      reps: 0,
      rpe: 0,
      form: 'standard' as const,
    }));

  describe('1. Hypertrophy Wave Volume (hypertrophy_linear)', () => {
    it('Week 1 (odd week) compound free-weight prescribes 0 kg × 12 reps @ RPE 8.0 across working sets', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(3),
      };

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
      });

      expect(sets).toHaveLength(3);
      sets.forEach(s => {
        expect(s.weight).toBe(0);
        expect(s.reps).toBe(12);
        expect(s.rpe).toBe(8.0);
        expect(s.isCompleted).toBeFalsy();
      });
    });

    it('Week 1 (odd week) isolation free-weight prescribes 0 kg × 15 reps @ RPE 8.0 across working sets', () => {
      const ex: ExerciseEntry = {
        name: 'Dumbbell Lateral Raise',
        muscleGroup: 'Shoulders',
        modality: 'weighted',
        movementCategory: 'isolation',
        equipment: 'freeweight',
        sets: zeroSets(3),
      };

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
      });

      expect(sets).toHaveLength(3);
      sets.forEach(s => {
        expect(s.weight).toBe(0);
        expect(s.reps).toBe(15);
        expect(s.rpe).toBe(8.0);
      });
    });

    it('Week 2 (even week) respects compound vs isolation and freeweight vs machine distinctions', () => {
      // Compound freeweight: 6 reps @ RPE 8.0
      const compFree: ExerciseEntry = {
        name: 'Barbell Squat',
        muscleGroup: 'Legs',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(2),
      };
      const resCompFree = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: compFree,
        weekNum: 2,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
      });
      expect(resCompFree[0].weight).toBe(0);
      expect(resCompFree[0].reps).toBe(6);
      expect(resCompFree[0].rpe).toBe(8.0);

      // Compound machine: 8 reps @ RPE 8.0
      const compMach: ExerciseEntry = {
        name: 'Leg Press',
        muscleGroup: 'Legs',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'machine',
        sets: zeroSets(2),
      };
      const resCompMach = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: compMach,
        weekNum: 2,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
      });
      expect(resCompMach[0].weight).toBe(0);
      expect(resCompMach[0].reps).toBe(8);
      expect(resCompMach[0].rpe).toBe(8.0);

      // Isolation freeweight: 10 reps @ RPE 8.0
      const isoFree: ExerciseEntry = {
        name: 'Dumbbell Flye',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'isolation',
        equipment: 'freeweight',
        sets: zeroSets(2),
      };
      const resIsoFree = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: isoFree,
        weekNum: 2,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
      });
      expect(resIsoFree[0].weight).toBe(0);
      expect(resIsoFree[0].reps).toBe(10);
      expect(resIsoFree[0].rpe).toBe(8.0);

      // Isolation machine: 12 reps @ RPE 8.0
      const isoMach: ExerciseEntry = {
        name: 'Cable Flye',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'isolation',
        equipment: 'machine',
        sets: zeroSets(2),
      };
      const resIsoMach = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: isoMach,
        weekNum: 2,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
      });
      expect(resIsoMach[0].weight).toBe(0);
      expect(resIsoMach[0].reps).toBe(12);
      expect(resIsoMach[0].rpe).toBe(8.0);
    });
  });

  describe('2. Hypertrophy Step Loading (hypertrophy_step)', () => {
    it('Week 1 (Block 0, Step 1) prescribes 10 reps @ RPE 7.0 for compound freeweight and offsets for isolation/machines', () => {
      // Compound freeweight: base 10 reps @ RPE 7.0
      const compFree: ExerciseEntry = {
        name: 'Barbell Row',
        muscleGroup: 'Back',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(2),
      };
      const resCompFree = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: compFree,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_step',
      });
      expect(resCompFree[0].weight).toBe(0);
      expect(resCompFree[0].reps).toBe(10);
      expect(resCompFree[0].rpe).toBe(7.0);

      // Compound machine: 12 reps @ RPE 7.0
      const compMach: ExerciseEntry = {
        name: 'Seated Cable Row',
        muscleGroup: 'Back',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'machine',
        sets: zeroSets(2),
      };
      const resCompMach = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: compMach,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_step',
      });
      expect(resCompMach[0].weight).toBe(0);
      expect(resCompMach[0].reps).toBe(12);
      expect(resCompMach[0].rpe).toBe(7.0);

      // Isolation machine: 14 reps @ RPE 7.0
      const isoMach: ExerciseEntry = {
        name: 'Triceps Pushdown',
        muscleGroup: 'Triceps',
        modality: 'weighted',
        movementCategory: 'isolation',
        equipment: 'machine',
        sets: zeroSets(2),
      };
      const resIsoMach = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: isoMach,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_step',
      });
      expect(resIsoMach[0].weight).toBe(0);
      expect(resIsoMach[0].reps).toBe(14);
      expect(resIsoMach[0].rpe).toBe(7.0);
    });

    it('Step progression across weeks 1-4 advances RPE and applies step-back week reps', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Row',
        muscleGroup: 'Back',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(1),
      };

      // Week 1: 10 reps @ 7.0
      expect(calculateObjectiveSets({ objective: 'Hypertrophy', exercise: ex, weekNum: 1, algorithmId: 'hypertrophy_step' })[0]).toMatchObject({ weight: 0, reps: 10, rpe: 7.0 });
      // Week 2: 10 reps @ 7.5
      expect(calculateObjectiveSets({ objective: 'Hypertrophy', exercise: ex, weekNum: 2, algorithmId: 'hypertrophy_step' })[0]).toMatchObject({ weight: 0, reps: 10, rpe: 7.5 });
      // Week 3: 10 reps @ 8.0
      expect(calculateObjectiveSets({ objective: 'Hypertrophy', exercise: ex, weekNum: 3, algorithmId: 'hypertrophy_step' })[0]).toMatchObject({ weight: 0, reps: 10, rpe: 8.0 });
      // Week 4 (step back): 12 reps @ 8.0
      expect(calculateObjectiveSets({ objective: 'Hypertrophy', exercise: ex, weekNum: 4, algorithmId: 'hypertrophy_step' })[0]).toMatchObject({ weight: 0, reps: 12, rpe: 8.0 });
      // Week 5 (Block 1, Step 1): 8 reps @ 7.5
      expect(calculateObjectiveSets({ objective: 'Hypertrophy', exercise: ex, weekNum: 5, algorithmId: 'hypertrophy_step' })[0]).toMatchObject({ weight: 0, reps: 8, rpe: 7.5 });
    });
  });

  describe('3. Wave Strength (strength_undulating)', () => {
    it('Supported 8-week duration with isMainMovement: true prescribes Week 1 0 kg × 5 reps @ RPE 7.0 on Set 1 and fatigue backoff on later sets', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(3),
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_undulating',
      });

      expect(sets).toHaveLength(3);
      // Set 1: anchor reps 5 @ 7.0
      expect(sets[0]).toMatchObject({ weight: 0, reps: 5, rpe: 7.0 });
      // Set 2: reps 5 @ backoff RPE 6.0
      expect(sets[1]).toMatchObject({ weight: 0, reps: 5, rpe: 6.0 });
      // Set 3: reps 5 @ backoff RPE 6.5
      expect(sets[2]).toMatchObject({ weight: 0, reps: 5, rpe: 6.5 });
    });

    it('Peak single week (Week 8) prescribes 0 kg × 1 rep @ RPE 10.0 on Set 1 and 3-rep backoffs on later sets', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(3),
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 8,
        programDuration: 8,
        algorithmId: 'strength_undulating',
      });

      expect(sets).toHaveLength(3);
      // Set 1: peak single 1 rep @ 10.0
      expect(sets[0]).toMatchObject({ weight: 0, reps: 1, rpe: 10.0 });
      // Set 2: backoff 3 reps @ 7.5
      expect(sets[1]).toMatchObject({ weight: 0, reps: 3, rpe: 7.5 });
      // Set 3: backoff 3 reps @ 8.0
      expect(sets[2]).toMatchObject({ weight: 0, reps: 3, rpe: 8.0 });
    });

    it('Strength non-main movement (isMainMovement: false) returns unprescribed 0 × 0 @ 0', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: false,
        sets: zeroSets(2),
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_undulating',
      });

      expect(sets[0]).toMatchObject({ weight: 0, reps: 0, rpe: 0 });
    });

    it('Unsupported strength duration (e.g. 6 weeks, 10 weeks) returns unprescribed 0 × 0 @ 0', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        sets: zeroSets(2),
      };

      const sets6 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 6,
        algorithmId: 'strength_undulating',
      });
      expect(sets6[0]).toMatchObject({ weight: 0, reps: 0, rpe: 0 });

      const sets10 = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 10,
        algorithmId: 'strength_undulating',
      });
      expect(sets10[0]).toMatchObject({ weight: 0, reps: 0, rpe: 0 });
    });
  });

  describe('4. Linear Periodisation (strength_linear)', () => {
    it('Supported 8-week duration with isMainMovement: true prescribes Week 1 0 kg × 8 reps @ RPE 7.0', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Deadlift',
        muscleGroup: 'Back',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(2),
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'strength_linear',
      });

      expect(sets[0]).toMatchObject({ weight: 0, reps: 8, rpe: 7.0 });
    });

    it('Week 8 (end of linear block) prescribes 0 kg × 1 rep @ RPE 10.0', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Deadlift',
        muscleGroup: 'Back',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(2),
      };

      const sets = calculateObjectiveSets({
        objective: 'Strength',
        exercise: ex,
        weekNum: 8,
        programDuration: 8,
        algorithmId: 'strength_linear',
      });

      expect(sets[0]).toMatchObject({ weight: 0, reps: 1, rpe: 10.0 });
      expect(sets[1]).toMatchObject({ weight: 0, reps: 3, rpe: 7.5 });
    });
  });

  describe('5. Objective Off and Excluded Modalities', () => {
    it('Objective Off leaves sets unprescribed (0 × 0 @ 0)', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: zeroSets(2),
      };

      const sets = calculateObjectiveSets({
        objective: 'Off',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
      });

      expect(sets[0]).toMatchObject({ weight: 0, reps: 0, rpe: 0 });
    });

    it('Bodyweight zero baseline remains unprescribed (out of scope for Stage 1)', () => {
      const ex: ExerciseEntry = {
        name: 'Pull Up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: zeroSets(2),
      };

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        bodyweightSnapshot: { value: 80, unit: 'kg' },
      });

      expect(sets[0]).toMatchObject({ weight: 0, reps: 0, rpe: 0 });
    });

    it('Assisted zero baseline remains unprescribed (out of scope for Stage 1)', () => {
      const ex: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        sets: zeroSets(2),
      };

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        bodyweightSnapshot: { value: 80, unit: 'kg' },
      });

      expect(sets[0]).toMatchObject({ weight: 0, reps: 0, rpe: 0 });
    });
  });

  describe('6. Baseline Controls and Mathematical Equivalence', () => {
    it('Positive historical baseline continues to compute positive RTS-derived load', () => {
      const historicalLogs: WorkoutLog[] = [
        {
          id: 'log-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Barbell Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true }],
            },
          ],
        },
      ];

      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(1),
      };

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: historicalLogs,
      });

      // 100 kg x 10 reps @ 8 -> e1RM = 100 / 0.707 = 141.44 kg
      // Week 1 Wave Volume (12 reps @ 8.0 -> RTS mult 0.637): 141.44 * 0.637 = 90.09 -> 90.0 kg
      expect(sets[0].weight).toBe(90.0);
      expect(sets[0].reps).toBe(12);
      expect(sets[0].rpe).toBe(8.0);
    });

    it('Positive template baseline continues to compute positive RTS-derived load', () => {
      const templateEx: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8.0 }],
      };

      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: zeroSets(1),
      };

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        templateExercise: templateEx,
        previousLogs: [],
      });

      expect(sets[0].weight).toBe(90.0);
      expect(sets[0].reps).toBe(12);
      expect(sets[0].rpe).toBe(8.0);
    });
  });

  describe('7. Workout Completion and Persistence Safety Controls', () => {
    it('A zero-load set with prescribed reps/RPE persists as isCompleted: false and is not treated as completed performance', () => {
      const rawExercises: ExerciseEntry[] = [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 0, reps: 12, rpe: 8.0, form: 'standard' },
          ],
        },
      ];

      const prepared = prepareExercisesForSave({ exercises: rawExercises });
      expect(prepared[0].sets[0].isCompleted).toBe(false);
      expect(prepared[0].sets[0].weight).toBe(0);
      expect(prepared[0].sets[0].reps).toBe(12);
      expect(prepared[0].sets[0].rpe).toBe(8.0);
    });

    it('A user-entered positive load set persists with isCompleted: true', () => {
      const rawExercises: ExerciseEntry[] = [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 60, reps: 12, rpe: 8.0, form: 'standard' },
          ],
        },
      ];

      const prepared = prepareExercisesForSave({ exercises: rawExercises });
      expect(prepared[0].sets[0].isCompleted).toBe(true);
      expect(prepared[0].sets[0].weight).toBe(60);
      expect(prepared[0].sets[0].reps).toBe(12);
      expect(prepared[0].sets[0].rpe).toBe(8.0);
    });
  });

  describe('8. Add Set Stage 2 Cold-Start Guidance', () => {
    it('calculateAddedSetTarget returns zero-load prescription shape for cold-start zero baseline without fabricating load', () => {
      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 0, reps: 12, rpe: 8.0 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: [],
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target).toEqual({
        weight: 0,
        reps: 12,
        rpe: 8.5,
        form: 'standard',
      });
    });

    it('calculateAddedSetTarget continues to prescribe when positive historical baseline exists', () => {
      const logs: WorkoutLog[] = [
        {
          id: 'log-bench',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Barbell Bench Press',
              muscleGroup: 'Chest',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: true }],
            },
          ],
        },
      ];

      const ex: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 95, reps: 12, rpe: 8.0 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        algorithmId: 'hypertrophy_linear',
        previousLogs: logs,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target).toBeDefined();
      expect(res.target?.reps).toBe(12);
      expect(res.target?.rpe).toBe(8.5);
    });
  });

  describe('9. Immutability and Pure Function Contract', () => {
    it('calculateObjectiveSets does not mutate input exercise object or its sets array', () => {
      const inputEx: ExerciseEntry = {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' }],
      };

      const frozenSets = JSON.parse(JSON.stringify(inputEx.sets));

      const sets = calculateObjectiveSets({
        objective: 'Hypertrophy',
        exercise: inputEx,
        weekNum: 1,
        programDuration: 8,
      });

      expect(inputEx.sets).toEqual(frozenSets);
      expect(sets).not.toBe(inputEx.sets);
    });
  });
});
