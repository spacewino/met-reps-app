import { describe, it, expect } from 'vitest';
import {
  calculateAddedSetTarget,
  calculateObjectiveSets,
  findMatchingTemplateExercise,
  syncAddedSetStructureToProgramDay,
} from '../objectiveMath';
import { hasSkippedWorkingSets } from '../setSkipRules';
import { WorkoutLog, ExerciseEntry, SetEntry } from '../../types';

describe('MetReps Phase 2B-1 — Target-Aware Add Set Using Existing Session Prescription', () => {
  // Test fixture: Completed historical working set of 100 kg x 10 reps @ RPE 8.0
  // RTS multiplier for 10 reps @ RPE 8.0 = 0.680
  // Baseline e1RM = 100 / 0.680 = 147.05882352941177 kg
  const standardHistoricalLogs: WorkoutLog[] = [
    {
      id: 'log-fixture-1',
      date: '2026-01-01',
      unit: 'kg',
      exercises: [
        {
          name: 'Leg Extension (Machine)',
          muscleGroup: 'Quads',
          isSkipped: false,
          sets: [
            { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: true },
          ],
        },
        {
          name: 'Bench Press (Barbell, Flat)',
          muscleGroup: 'Chest',
          isSkipped: false,
          sets: [
            { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: true },
          ],
        },
      ],
    },
  ];

  const createTestExercise = (overrides?: Partial<ExerciseEntry>): ExerciseEntry => ({
    name: 'Leg Extension (Machine)',
    muscleGroup: 'Quads',
    modality: 'weighted',
    isMainMovement: false,
    movementCategory: 'isolation',
    equipment: 'machine',
    sets: [
      { setNumber: 1, weight: 90, reps: 12, rpe: 8.0, isWarmup: false },
    ],
    ...overrides,
  });

  describe('1. Hypertrophy Wave Isolation Machine Sequential Add Set', () => {
    it('Sequentially adds Working Sets 2 through 5 matching the production distribution engine', () => {
      // Week 2 (Even week): Isolation machine Set 1 = 12 reps @ RPE 8.0
      // 147.0588 * 0.612 = 90.0 kg anchor load
      const exercise = createTestExercise({
        name: 'Leg Extension (Machine)',
        movementCategory: 'isolation',
        equipment: 'machine',
        sets: [
          { setNumber: 1, weight: 90, reps: 12, rpe: 8.0, isWarmup: false },
        ],
      });

      // Add Working Set 2
      const set2Result = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      expect(set2Result.isPrescribed).toBe(true);
      expect(set2Result.workingSetOrdinal).toBe(2);
      expect(set2Result.target?.weight).toBe(90.0);
      expect(set2Result.target?.reps).toBe(12);
      expect(set2Result.target?.rpe).toBe(8.5);

      // Append Set 2 to exercise sets
      const exWithSet2: ExerciseEntry = {
        ...exercise,
        sets: [
          ...exercise.sets,
          { setNumber: 2, weight: set2Result.target!.weight, reps: set2Result.target!.reps, rpe: set2Result.target!.rpe, form: 'standard' },
        ],
      };

      // Add Working Set 3
      const set3Result = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: exWithSet2,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      expect(set3Result.isPrescribed).toBe(true);
      expect(set3Result.workingSetOrdinal).toBe(3);
      expect(set3Result.target?.weight).toBe(90.0);
      expect(set3Result.target?.reps).toBe(12);
      expect(set3Result.target?.rpe).toBe(9.0);

      // Append Set 3 to exercise sets
      const exWithSet3: ExerciseEntry = {
        ...exWithSet2,
        sets: [
          ...exWithSet2.sets,
          { setNumber: 3, weight: set3Result.target!.weight, reps: set3Result.target!.reps, rpe: set3Result.target!.rpe, form: 'standard' },
        ],
      };

      // Add Working Set 4
      const set4Result = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: exWithSet3,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      expect(set4Result.isPrescribed).toBe(true);
      expect(set4Result.workingSetOrdinal).toBe(4);
      expect(set4Result.target?.weight).toBe(90.0);
      expect(set4Result.target?.reps).toBe(12);
      expect(set4Result.target?.rpe).toBe(9.5);

      // Append Set 4 to exercise sets
      const exWithSet4: ExerciseEntry = {
        ...exWithSet3,
        sets: [
          ...exWithSet3.sets,
          { setNumber: 4, weight: set4Result.target!.weight, reps: set4Result.target!.reps, rpe: set4Result.target!.rpe, form: 'standard' },
        ],
      };

      // Add Working Set 5
      const set5Result = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: exWithSet4,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });
      expect(set5Result.isPrescribed).toBe(true);
      expect(set5Result.workingSetOrdinal).toBe(5);
      expect(set5Result.target?.weight).toBe(90.0);
      expect(set5Result.target?.reps).toBe(11);
      expect(set5Result.target?.rpe).toBe(9.5);
    });
  });

  describe('2. Four-Algorithm Target-Aware Add Set Preservations', () => {
    it('Hypertrophy Wave compound freeweight: added sets use compound load/rep decay', () => {
      const ex = createTestExercise({
        name: 'Bench Press (Barbell, Flat)',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 115, reps: 6, rpe: 8.0, isWarmup: false }],
      });

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target?.weight).toBe(115.0);
      expect(res.target?.reps).toBe(5);
      expect(res.target?.rpe).toBe(8.5);
    });

    it('Hypertrophy Step compound freeweight: added sets use step loading profile', () => {
      const ex = createTestExercise({
        name: 'Bench Press (Barbell, Flat)',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 95, reps: 10, rpe: 7.0, isWarmup: false }],
      });

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_step',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target?.weight).toBe(95.0);
      expect(res.target?.reps).toBe(10);
      expect(res.target?.rpe).toBe(7.5);
    });

    it('Hypertrophy Step isolation machine: added sets use step loading offset', () => {
      const ex = createTestExercise({
        name: 'Leg Extension (Machine)',
        movementCategory: 'isolation',
        equipment: 'machine',
        sets: [{ setNumber: 1, weight: 80, reps: 14, rpe: 7.0, isWarmup: false }],
      });

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_step',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target?.weight).toBe(82.5);
      expect(res.target?.reps).toBe(14);
      expect(res.target?.rpe).toBe(7.5);
    });

    it('Strength Undulating Main Movement: added set gets DUP back-off target', () => {
      const ex = createTestExercise({
        name: 'Bench Press (Barbell, Flat)',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [{ setNumber: 1, weight: 120, reps: 5, rpe: 8.0, isWarmup: false }],
      });

      const res = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      // Week 2 of 8-week DUP: Set 1 = 120.0 kg x 5 @ 8.0; Set 2 = 112.5 kg x 5 @ 7.0
      expect(res.target?.weight).toBe(112.5);
      expect(res.target?.reps).toBe(5);
      expect(res.target?.rpe).toBe(7.0);
    });

    it('Strength Linear Main Movement: added set gets linear back-off target', () => {
      const ex = createTestExercise({
        name: 'Bench Press (Barbell, Flat)',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [{ setNumber: 1, weight: 102.5, reps: 8, rpe: 7.0, isWarmup: false }],
      });

      const res = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_linear',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      // Week 1 of 8-week LP: Set 1 = 102.5 kg x 8 @ 7.0; Set 2 = 97.5 kg x 8 @ 6.0
      expect(res.target?.weight).toBe(97.5);
      expect(res.target?.reps).toBe(8);
      expect(res.target?.rpe).toBe(6.0);
    });

    it('Strength accessory bypass: non-main movements are bypassed', () => {
      const ex = createTestExercise({
        name: 'Triceps Pushdown',
        muscleGroup: 'Triceps',
        isMainMovement: false,
        sets: [{ setNumber: 1, weight: 40, reps: 10, rpe: 8.0, isWarmup: false }],
      });

      const res = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      expect(res.isPrescribed).toBe(false);
      expect(res.target).toBeUndefined();
      expect(res.workingSetOrdinal).toBe(2);
    });
  });

  describe('3. Warm-up and Ordinal Behavior', () => {
    it('Two warm-ups followed by one working set: Add Set targets Working Set 2 (ordinal 2)', () => {
      const ex = createTestExercise({
        name: 'Bench Press (Barbell, Flat)',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 60, reps: 5, rpe: 4.0, isWarmup: true },
          { setNumber: 2, weight: 90, reps: 4, rpe: 6.0, isWarmup: true },
          { setNumber: 3, weight: 120, reps: 5, rpe: 8.0, isWarmup: false },
        ],
      });

      const res = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2);
      expect(res.target?.weight).toBe(112.5);
      expect(res.target?.reps).toBe(5);
      expect(res.target?.rpe).toBe(7.0);
    });

    it('Interspersed warm-up rows do not shift working-set targeting', () => {
      const ex = createTestExercise({
        name: 'Bench Press (Barbell, Flat)',
        movementCategory: 'compound',
        equipment: 'freeweight',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 60, reps: 5, rpe: 4.0, isWarmup: true },
          { setNumber: 2, weight: 120, reps: 5, rpe: 8.0, isWarmup: false },
          { setNumber: 3, weight: 80, reps: 3, rpe: 5.0, isWarmup: true },
          { setNumber: 4, weight: 112.5, reps: 5, rpe: 7.0, isWarmup: false },
        ],
      });

      const res = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      // 2 existing working sets -> newly added is Working Set 3
      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(3);
      expect(res.target?.weight).toBe(112.5);
      expect(res.target?.reps).toBe(5);
      expect(res.target?.rpe).toBe(7.5);
    });
  });

  describe('4. Existing-Set Immutability & Metadata Isolation', () => {
    it('Existing Set 1 remains byte-for-byte unchanged when a set is added', () => {
      const originalSet1: SetEntry = {
        setNumber: 1,
        weight: 125,
        reps: 8,
        rpe: 8.5,
        form: 'strict',
        comment: 'Felt solid on lockouts',
        isCompleted: true,
      };

      const originalExercise: ExerciseEntry = {
        name: 'Bench Press (Barbell, Flat)',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ ...originalSet1 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: originalExercise,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      const newSet: SetEntry = {
        setNumber: 2,
        weight: res.target!.weight,
        reps: res.target!.reps,
        rpe: res.target!.rpe,
        form: (res.target?.form || 'standard') as 'standard',
      };

      const updatedExercise: ExerciseEntry = {
        ...originalExercise,
        sets: [...originalExercise.sets, newSet],
      };

      // Set 1 is completely identical
      expect(updatedExercise.sets[0]).toEqual(originalSet1);
      expect(updatedExercise.sets[0].weight).toBe(125);
      expect(updatedExercise.sets[0].reps).toBe(8);
      expect(updatedExercise.sets[0].rpe).toBe(8.5);
      expect(updatedExercise.sets[0].comment).toBe('Felt solid on lockouts');
      expect(updatedExercise.sets[0].isCompleted).toBe(true);
    });

    it('Manually edited existing Set 2 remains unchanged when Set 3 is added', () => {
      const set1: SetEntry = { setNumber: 1, weight: 120, reps: 5, rpe: 8.0 };
      const manuallyEditedSet2: SetEntry = { setNumber: 2, weight: 130, reps: 3, rpe: 9.5, form: 'loose', comment: 'Overreached' };

      const ex: ExerciseEntry = {
        name: 'Bench Press (Barbell, Flat)',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ ...set1 }, { ...manuallyEditedSet2 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating',
      });

      const newSet3: SetEntry = {
        setNumber: 3,
        weight: res.target!.weight,
        reps: res.target!.reps,
        rpe: res.target!.rpe,
        form: 'standard',
      };

      const nextSets = [...ex.sets, newSet3];
      expect(nextSets[0]).toEqual(set1);
      expect(nextSets[1]).toEqual(manuallyEditedSet2);
      expect(nextSets[2].setNumber).toBe(3);
    });

    it('Existing skipped, completed, drop-set and comment metadata remains unchanged', () => {
      const complexSet: SetEntry = {
        setNumber: 1,
        weight: 100,
        reps: 10,
        rpe: 9,
        isDropSet: true,
        dropSubSets: [{ weight: 80, reps: 5 }, { weight: 60, reps: 5 }],
        comment: 'Drop set to failure',
        isCompleted: true,
        isSkipped: false,
      };

      const ex: ExerciseEntry = {
        name: 'Leg Extension (Machine)',
        muscleGroup: 'Quads',
        modality: 'weighted',
        sets: [complexSet],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });

      expect(res.isPrescribed).toBe(true);
      const newSet: SetEntry = {
        setNumber: 2,
        weight: res.target!.weight,
        reps: res.target!.reps,
        rpe: res.target!.rpe,
        form: 'standard',
      };

      // New set receives no inherited logging metadata
      expect(newSet.comment).toBeUndefined();
      expect(newSet.isDropSet).toBeUndefined();
      expect(newSet.dropSubSets).toBeUndefined();
      expect(newSet.isCompleted).toBeUndefined();
      expect(newSet.isSkipped).toBeUndefined();
    });

    it('Guarantees no historical log object or pristine template object is mutated', () => {
      const templateEx: ExerciseEntry = Object.freeze({
        name: 'Leg Extension (Machine)',
        muscleGroup: 'Quads',
        modality: 'weighted',
        sets: Object.freeze([
          Object.freeze({ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isWarmup: false }),
        ]) as any,
      }) as any;

      const frozenHistoricalLogs = Object.freeze([
        Object.freeze({
          id: 'log-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: Object.freeze([
            Object.freeze({
              name: 'Leg Extension (Machine)',
              muscleGroup: 'Quads',
              isSkipped: false,
              sets: Object.freeze([
                Object.freeze({ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isWarmup: false, isCompleted: true }),
              ]),
            }),
          ]),
        }),
      ]) as any;

      const ex = createTestExercise();
      expect(() => {
        calculateAddedSetTarget({
          objective: 'Hypertrophy',
          exercise: ex,
          weekNum: 2,
          programDuration: 8,
          previousLogs: frozenHistoricalLogs,
          templateExercise: templateEx,
          algorithmId: 'hypertrophy_linear',
        });
      }).not.toThrow();
    });
  });

  describe('5. Eligibility, Bypass Rules & Cold-Start Behavior', () => {
    it('Skipped-suffix check blocks Add Set', () => {
      const setsWithSkippedSuffix: SetEntry[] = [
        { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isWarmup: false },
        { setNumber: 2, weight: 100, reps: 9, rpe: 8.5, isWarmup: false, isSkipped: true },
      ];

      expect(hasSkippedWorkingSets(setsWithSkippedSuffix)).toBe(true);
    });

    it('Objective Off produces an unprescribed blank/zero set', () => {
      const ex = createTestExercise();
      const res = calculateAddedSetTarget({
        objective: 'Off',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
      });

      expect(res.isPrescribed).toBe(false);
      expect(res.target).toBeUndefined();
    });

    it('Non-weighted modalities preserve bypass behavior', () => {
      const modalities: ExerciseEntry['modality'][] = ['bodyweight', 'assisted', 'timed', 'distance', 'distance_loaded'];

      for (const mod of modalities) {
        const ex = createTestExercise({ modality: mod });
        const res = calculateAddedSetTarget({
          objective: 'Hypertrophy',
          exercise: ex,
          weekNum: 2,
          programDuration: 8,
          previousLogs: standardHistoricalLogs,
        });

        expect(res.isPrescribed).toBe(false);
        expect(res.target).toBeUndefined();
      }
    });

    it('Cold-start Set 1 at zero produces a blank/zero unprescribed new set', () => {
      const ex = createTestExercise({
        name: 'Unknown Custom Exercise',
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 8.0, isWarmup: false }],
      });

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [], // No history
        templateExercise: undefined, // No template baseline
      });

      expect(res.isPrescribed).toBe(false);
      expect(res.target).toBeUndefined();
    });

    it('Cold-start manually entered Set 1 still produces an unprescribed blank/zero set in Phase 2B-1', () => {
      const ex = createTestExercise({
        name: 'Brand New Machine',
        sets: [{ setNumber: 1, weight: 120, reps: 10, rpe: 8.0, isWarmup: false }], // Manually entered today
      });

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [], // No historical baseline
        templateExercise: undefined, // No template baseline
      });

      expect(res.isPrescribed).toBe(false);
      expect(res.target).toBeUndefined();
    });

    it('Historical baseline produces a valid prescribed target', () => {
      const ex = createTestExercise({ name: 'Leg Extension (Machine)' });
      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.target?.weight).toBeGreaterThan(0);
    });

    it('Pristine template fallback produces a valid prescribed target when historical logs are empty', () => {
      const templateEx: ExerciseEntry = {
        name: 'Lat Pulldown',
        muscleGroup: 'Back',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 80, reps: 10, rpe: 8.0, isWarmup: false }],
      };

      const ex = createTestExercise({ name: 'Lat Pulldown' });
      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [], // No history
        templateExercise: templateEx,
        algorithmId: 'hypertrophy_linear',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.target?.weight).toBeGreaterThan(0);
    });

    it('Invalid objective/algorithm pairing bypasses target generation', () => {
      const ex = createTestExercise();
      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'strength_undulating' as any, // Invalid pairing
      });

      expect(res.isPrescribed).toBe(false);
    });
  });

  describe('6. Working Set Limits & 2.5 kg Rounding Precision', () => {
    it('Working Set 6 can receive a prescribed target', () => {
      const ex = createTestExercise({
        sets: [
          { setNumber: 1, weight: 90, reps: 12, rpe: 8.0 },
          { setNumber: 2, weight: 90, reps: 12, rpe: 8.5 },
          { setNumber: 3, weight: 90, reps: 11, rpe: 9.0 },
          { setNumber: 4, weight: 90, reps: 11, rpe: 9.5 },
          { setNumber: 5, weight: 90, reps: 11, rpe: 9.5 },
        ],
      });

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(6);
      expect(res.target?.weight).toBe(90.0);
      expect(res.target?.reps).toBe(10);
      expect(res.target?.rpe).toBe(9.5);
    });

    it('Working Set 7 remains safely unprescribed', () => {
      const ex = createTestExercise({
        sets: [
          { setNumber: 1, weight: 90, reps: 12, rpe: 8.0 },
          { setNumber: 2, weight: 90, reps: 12, rpe: 8.5 },
          { setNumber: 3, weight: 90, reps: 11, rpe: 9.0 },
          { setNumber: 4, weight: 90, reps: 11, rpe: 9.5 },
          { setNumber: 5, weight: 90, reps: 11, rpe: 9.5 },
          { setNumber: 6, weight: 90, reps: 10, rpe: 9.5 },
        ],
      });

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });

      expect(res.isPrescribed).toBe(false);
      expect(res.workingSetOrdinal).toBe(7);
      expect(res.target).toBeUndefined();
    });

    it('Every generated weighted target is a multiple of 2.5 kg', () => {
      const oddBaselineLogs: WorkoutLog[] = [
        {
          id: 'log-odd-1',
          date: '2026-01-01',
          unit: 'kg',
          exercises: [
            {
              name: 'Leg Extension (Machine)',
              muscleGroup: 'Quads',
              isSkipped: false,
              sets: [{ setNumber: 1, weight: 83.5, reps: 7, rpe: 8.5, isCompleted: true }],
            },
          ],
        },
      ];

      const ex = createTestExercise();
      for (let ord = 1; ord <= 6; ord++) {
        const dummySets = Array.from({ length: ord - 1 }, (_, i) => ({
          setNumber: i + 1,
          weight: 50,
          reps: 10,
          rpe: 8,
          isWarmup: false,
        }));
        const curEx = { ...ex, sets: dummySets };

        const res = calculateAddedSetTarget({
          objective: 'Hypertrophy',
          exercise: curEx,
          weekNum: 3,
          programDuration: 8,
          previousLogs: oddBaselineLogs,
          algorithmId: 'hypertrophy_linear',
        });

        if (res.isPrescribed && res.target) {
          expect(res.target.weight % 2.5).toBeCloseTo(0, 5);
        }
      }
    });
  });

  describe('7. Draft Serialization & Restoration', () => {
    it('Draft serialization and restoration preserve the newly added set and target', () => {
      const initialExercise: ExerciseEntry = {
        name: 'Leg Extension (Machine)',
        muscleGroup: 'Quads',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 90, reps: 12, rpe: 8.0 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: initialExercise,
        weekNum: 2,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
      });

      const addedSet: SetEntry = {
        setNumber: 2,
        weight: res.target!.weight,
        reps: res.target!.reps,
        rpe: res.target!.rpe,
        form: 'standard',
      };

      const activeExercises = [
        {
          ...initialExercise,
          sets: [...initialExercise.sets, addedSet],
        },
      ];

      // Simulate draft serialization (JSON stringify / parse)
      const serializedDraft = JSON.stringify({ exercises: activeExercises });
      const restoredDraft = JSON.parse(serializedDraft);

      expect(restoredDraft.exercises[0].sets.length).toBe(2);
      expect(restoredDraft.exercises[0].sets[1].setNumber).toBe(2);
      expect(restoredDraft.exercises[0].sets[1].weight).toBe(90.0);
      expect(restoredDraft.exercises[0].sets[1].reps).toBe(12);
      expect(restoredDraft.exercises[0].sets[1].rpe).toBe(8.5);
    });
  });

  describe('8. Template Matching & Structure-Only Persistence Corrections', () => {
    // Regression fixture definitions
    const templateExerciseA: ExerciseEntry = {
      name: 'Leg Extension',
      muscleGroup: 'Quads',
      modality: 'weighted',
      movementCategory: 'isolation',
      equipment: 'machine',
      sets: [
        { setNumber: 1, weight: 40, reps: 15, rpe: 8.0, comment: 'controlled tempo', form: 'standard' },
      ],
    };

    const templateExerciseB: ExerciseEntry = {
      name: 'Machine Chest Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      movementCategory: 'compound',
      equipment: 'machine',
      sets: [
        { setNumber: 1, weight: 80, reps: 8, rpe: 8.0, comment: 'pause', form: 'standard' },
      ],
    };

    const pristineDayTemplates: ExerciseEntry[] = [
      JSON.parse(JSON.stringify(templateExerciseA)),
      JSON.parse(JSON.stringify(templateExerciseB)),
    ];

    it('findMatchingTemplateExercise: Safe same-index matching', () => {
      const match = findMatchingTemplateExercise(templateExerciseA, pristineDayTemplates, 0);
      expect(match).toBeDefined();
      expect(match?.name).toBe('Leg Extension');
      expect(match?.sets[0].weight).toBe(40);
    });

    it('findMatchingTemplateExercise: Reordered exercises requiring name fallback', () => {
      // Active index 0 is Machine Chest Press, while template index 0 is Leg Extension
      const activeEx = { name: 'Machine Chest Press', sets: [] };
      const match = findMatchingTemplateExercise(activeEx, pristineDayTemplates, 0);
      expect(match).toBeDefined();
      expect(match?.name).toBe('Machine Chest Press');
      expect(match?.sets[0].weight).toBe(80);
      expect(match?.sets[0].comment).toBe('pause');
    });

    it('findMatchingTemplateExercise: Case-insensitive and trimmed-name matching', () => {
      const match1 = findMatchingTemplateExercise({ name: '  machine chest press  ' }, pristineDayTemplates, 0);
      expect(match1).toBeDefined();
      expect(match1?.name).toBe('Machine Chest Press');

      const match2 = findMatchingTemplateExercise({ name: 'LEG EXTENSION' }, pristineDayTemplates, 1);
      expect(match2).toBeDefined();
      expect(match2?.name).toBe('Leg Extension');
    });

    it('findMatchingTemplateExercise: No-match returns undefined and wrong-index is never used', () => {
      const match = findMatchingTemplateExercise({ name: 'Custom Dumbbell Lateral Raise' }, pristineDayTemplates, 0);
      expect(match).toBeUndefined();
    });

    it('Correct baseline used after reordering (Machine Chest Press uses 80 kg, never 40 kg)', () => {
      // Active workout reordered: Machine Chest Press is at active index 0
      const activeMachineChestPress: ExerciseEntry = {
        name: 'Machine Chest Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        movementCategory: 'compound',
        equipment: 'machine',
        sets: [
          { setNumber: 1, weight: 70, reps: 12, rpe: 8.0, isCompleted: true },
        ],
      };

      const matchedTemplate = findMatchingTemplateExercise(activeMachineChestPress, pristineDayTemplates, 0);
      expect(matchedTemplate).toBeDefined();
      expect(matchedTemplate?.name).toBe('Machine Chest Press');
      expect(matchedTemplate?.sets[0].weight).toBe(80);

      // Target calculation using matched template
      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: activeMachineChestPress,
        weekNum: 1,
        programDuration: 8,
        previousLogs: [], // No history -> relies on pristine template baseline
        algorithmId: 'hypertrophy_linear',
        templateExercise: matchedTemplate,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.target).toBeDefined();
      // e1RM from 80 kg x 8 @ 8 = 80 / 0.739 = 108.25 kg.
      // Set 2: 12 reps @ 8.5 (RTS = 0.612) -> 108.25 * 0.612 = 66.25 -> 67.5 kg
      // If 40 kg baseline was used: 40 / 0.536 = 74.62 kg -> 74.62 * 0.612 = 45.67 -> 45.0 kg
      expect(res.target!.weight).toBe(67.5);
      expect(res.target!.reps).toBe(12);
      expect(res.target!.rpe).toBe(8.5);
      expect(res.workingSetOrdinal).toBe(2);
    });

    it('syncAddedSetStructureToProgramDay: Complete before-and-after trace with reordered exercises', () => {
      const dayTemplatesBefore: ExerciseEntry[] = [
        JSON.parse(JSON.stringify(templateExerciseA)),
        JSON.parse(JSON.stringify(templateExerciseB)),
      ];

      // Verify BEFORE state
      expect(dayTemplatesBefore[0].name).toBe('Leg Extension');
      expect(dayTemplatesBefore[0].sets.length).toBe(1);
      expect(dayTemplatesBefore[0].sets[0].weight).toBe(40);
      expect(dayTemplatesBefore[0].sets[0].reps).toBe(15);
      expect(dayTemplatesBefore[0].sets[0].rpe).toBe(8.0);
      expect(dayTemplatesBefore[0].sets[0].comment).toBe('controlled tempo');

      expect(dayTemplatesBefore[1].name).toBe('Machine Chest Press');
      expect(dayTemplatesBefore[1].sets.length).toBe(1);
      expect(dayTemplatesBefore[1].sets[0].weight).toBe(80);
      expect(dayTemplatesBefore[1].sets[0].reps).toBe(8);
      expect(dayTemplatesBefore[1].sets[0].rpe).toBe(8.0);
      expect(dayTemplatesBefore[1].sets[0].comment).toBe('pause');

      // Active workout has Machine Chest Press at index 0 with active generated targets and completion metadata
      const activeMachineChestPress: ExerciseEntry = {
        name: 'Machine Chest Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 70, reps: 12, rpe: 8.0, isCompleted: true, comment: 'active session comment' },
          { setNumber: 2, weight: 67.5, reps: 12, rpe: 8.5, form: 'standard' },
        ],
      };

      // Perform safe structure-only sync
      const dayTemplatesAfter = syncAddedSetStructureToProgramDay(
        dayTemplatesBefore,
        activeMachineChestPress,
        0 // active index 0
      );

      // Verify AFTER state:
      // 1. Template order is preserved (Leg Extension at 0, Machine Chest Press at 1)
      expect(dayTemplatesAfter[0].name).toBe('Leg Extension');
      expect(dayTemplatesAfter[1].name).toBe('Machine Chest Press');

      // 2. Leg Extension template is completely unchanged
      expect(dayTemplatesAfter[0].sets.length).toBe(1);
      expect(dayTemplatesAfter[0].sets[0].weight).toBe(40);
      expect(dayTemplatesAfter[0].sets[0].reps).toBe(15);
      expect(dayTemplatesAfter[0].sets[0].rpe).toBe(8.0);
      expect(dayTemplatesAfter[0].sets[0].comment).toBe('controlled tempo');

      // 3. Machine Chest Press template: Set 1 is completely unchanged (80 kg x 8 @ 8, "pause")
      expect(dayTemplatesAfter[1].sets.length).toBe(2);
      expect(dayTemplatesAfter[1].sets[0].weight).toBe(80);
      expect(dayTemplatesAfter[1].sets[0].reps).toBe(8);
      expect(dayTemplatesAfter[1].sets[0].rpe).toBe(8.0);
      expect(dayTemplatesAfter[1].sets[0].comment).toBe('pause');

      // 4. Appended template Set 2 is sanitized structural SetEntry (weight: 0, reps: 0, rpe: 8, form: 'standard')
      expect(dayTemplatesAfter[1].sets[1].setNumber).toBe(2);
      expect(dayTemplatesAfter[1].sets[1].weight).toBe(0);
      expect(dayTemplatesAfter[1].sets[1].reps).toBe(0);
      expect(dayTemplatesAfter[1].sets[1].rpe).toBe(8);
      expect(dayTemplatesAfter[1].sets[1].form).toBe('standard');

      // 5. Active session data does NOT leak into template
      expect((dayTemplatesAfter[1].sets[0] as any).isCompleted).toBeUndefined();
      expect((dayTemplatesAfter[1].sets[1] as any).isCompleted).toBeUndefined();
      expect((dayTemplatesAfter[1].sets[1] as any).isSkipped).toBeUndefined();
      expect(dayTemplatesAfter[1].sets[1].comment).toBeUndefined();
    });

    it('No-match safety: Unmatched exercise leaves day templates completely untouched', () => {
      const dayTemplates: ExerciseEntry[] = [
        JSON.parse(JSON.stringify(templateExerciseA)),
        JSON.parse(JSON.stringify(templateExerciseB)),
      ];

      const result = syncAddedSetStructureToProgramDay(dayTemplates, { name: 'Unmatched Custom Exercise' }, 0);
      expect(result).toEqual(dayTemplates);
    });

    it('Historical WorkoutLog data remains completely immutable during template operations', () => {
      const historicalLogsSnapshot = JSON.stringify(standardHistoricalLogs);

      const matchedTemplate = findMatchingTemplateExercise({ name: 'Leg Extension' }, pristineDayTemplates, 0);
      calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: createTestExercise({ name: 'Leg Extension' }),
        weekNum: 1,
        programDuration: 8,
        previousLogs: standardHistoricalLogs,
        algorithmId: 'hypertrophy_linear',
        templateExercise: matchedTemplate,
      });

      expect(JSON.stringify(standardHistoricalLogs)).toBe(historicalLogsSnapshot);
    });
  });
});
