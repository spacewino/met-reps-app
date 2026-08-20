import { describe, it, expect } from 'vitest';
import {
  calculateAddedSetTarget,
  calculateObjectiveSets,
  findMatchingTemplateExercise,
  syncAddedSetStructureToProgramDay,
} from '../objectiveMath';
import { hasSkippedWorkingSets } from '../setSkipRules';
import { WorkoutLog, ExerciseEntry, SetEntry, BodyweightSnapshot } from '../../types';

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

    it('Unsupported modalities (timed, distance, distance_loaded) preserve bypass behavior', () => {
      const unsupportedModalities: ExerciseEntry['modality'][] = ['timed', 'distance', 'distance_loaded'];

      for (const mod of unsupportedModalities) {
        const ex = createTestExercise({ modality: mod });
        const res = calculateAddedSetTarget({
          objective: 'Hypertrophy',
          exercise: ex,
          weekNum: 2,
          programDuration: 8,
          previousLogs: standardHistoricalLogs,
          bodyweightSnapshot: { value: 80, unit: 'kg' },
        });

        expect(res.isPrescribed).toBe(false);
        expect(res.target).toBeUndefined();
      }
    });

    it('Assisted and bodyweight modalities bypass when bodyweight snapshot is missing or invalid', () => {
      const modalities: ExerciseEntry['modality'][] = ['bodyweight', 'assisted'];

      for (const mod of modalities) {
        const ex = createTestExercise({ modality: mod });
        // Missing snapshot
        const resMissing = calculateAddedSetTarget({
          objective: 'Hypertrophy',
          exercise: ex,
          weekNum: 2,
          programDuration: 8,
          previousLogs: standardHistoricalLogs,
          bodyweightSnapshot: undefined,
        });

        expect(resMissing.isPrescribed).toBe(false);
        expect(resMissing.target).toBeUndefined();

        // Invalid snapshot (zero weight)
        const resInvalid = calculateAddedSetTarget({
          objective: 'Hypertrophy',
          exercise: ex,
          weekNum: 2,
          programDuration: 8,
          previousLogs: standardHistoricalLogs,
          bodyweightSnapshot: { value: 0, unit: 'kg' },
        });

        expect(resInvalid.isPrescribed).toBe(false);
        expect(resInvalid.target).toBeUndefined();
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

  describe('9. MetReps Stage 2B — Canonical Parity Direct 10-Combination Matrix', () => {
    const sessionBW: BodyweightSnapshot = { value: 80, unit: 'kg' };

    const assistedHistLogs: WorkoutLog[] = [
      {
        id: 'hist-assisted-log',
        date: '2026-01-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Pull-up',
            muscleGroup: 'Back',
            modality: 'assisted',
            isMainMovement: true,
            movementCategory: 'compound',
            equipment: 'machine',
            sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8.0, isCompleted: true }],
          },
        ],
      },
    ];

    const bodyweightHistLogs: WorkoutLog[] = [
      {
        id: 'hist-bw-log',
        date: '2026-01-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Push-up',
            muscleGroup: 'Chest',
            modality: 'bodyweight',
            isMainMovement: true,
            movementCategory: 'compound',
            equipment: 'freeweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true }],
          },
        ],
      },
    ];

    const combinations: Array<{
      id: string;
      name: string;
      modality: 'assisted' | 'bodyweight';
      objective: 'Hypertrophy' | 'Strength' | 'Deload';
      algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
      logs: WorkoutLog[];
      exName: string;
    }> = [
      { id: '1', name: 'Assisted + Hypertrophy Linear', modality: 'assisted', objective: 'Hypertrophy', algorithmId: 'hypertrophy_linear', logs: assistedHistLogs, exName: 'Assisted Pull-up' },
      { id: '2', name: 'Bodyweight + Hypertrophy Linear', modality: 'bodyweight', objective: 'Hypertrophy', algorithmId: 'hypertrophy_linear', logs: bodyweightHistLogs, exName: 'Push-up' },
      { id: '3', name: 'Assisted + Hypertrophy Step', modality: 'assisted', objective: 'Hypertrophy', algorithmId: 'hypertrophy_step', logs: assistedHistLogs, exName: 'Assisted Pull-up' },
      { id: '4', name: 'Bodyweight + Hypertrophy Step', modality: 'bodyweight', objective: 'Hypertrophy', algorithmId: 'hypertrophy_step', logs: bodyweightHistLogs, exName: 'Push-up' },
      { id: '5', name: 'Assisted + Strength Undulating Main Movement', modality: 'assisted', objective: 'Strength', algorithmId: 'strength_undulating', logs: assistedHistLogs, exName: 'Assisted Pull-up' },
      { id: '6', name: 'Bodyweight + Strength Undulating Main Movement', modality: 'bodyweight', objective: 'Strength', algorithmId: 'strength_undulating', logs: bodyweightHistLogs, exName: 'Push-up' },
      { id: '7', name: 'Assisted + Strength Linear Main Movement', modality: 'assisted', objective: 'Strength', algorithmId: 'strength_linear', logs: assistedHistLogs, exName: 'Assisted Pull-up' },
      { id: '8', name: 'Bodyweight + Strength Linear Main Movement', modality: 'bodyweight', objective: 'Strength', algorithmId: 'strength_linear', logs: bodyweightHistLogs, exName: 'Push-up' },
      { id: '9', name: 'Assisted Deload', modality: 'assisted', objective: 'Deload', logs: assistedHistLogs, exName: 'Assisted Pull-up' },
      { id: '10', name: 'Bodyweight Deload', modality: 'bodyweight', objective: 'Deload', logs: bodyweightHistLogs, exName: 'Push-up' },
    ];

    combinations.forEach(combo => {
      it(`Canonical Parity [${combo.id}/10]: ${combo.name} matches calculateObjectiveSets for ordinals 1, 2, 3, 6, and 7+`, () => {
        const testOrdinals = [1, 2, 3, 6];

        for (const ord of testOrdinals) {
          // 1. Build full exercise with `ord` sets and run calculateObjectiveSets
          const fullEx: ExerciseEntry = {
            name: combo.exName,
            muscleGroup: combo.modality === 'assisted' ? 'Back' : 'Chest',
            modality: combo.modality,
            isMainMovement: true,
            movementCategory: 'compound',
            equipment: combo.modality === 'assisted' ? 'machine' : 'freeweight',
            sets: Array.from({ length: ord }, (_, i) => ({
              setNumber: i + 1,
              weight: 0,
              reps: 0,
              rpe: 8.0,
              form: 'standard',
            })),
          };

          const fullPrescribedSets = calculateObjectiveSets({
            objective: combo.objective,
            exercise: fullEx,
            exerciseIndex: 0,
            totalExercises: 1,
            weekNum: 2,
            programDuration: 8,
            previousLogs: combo.logs,
            userTouchedSets: {},
            checkedSets: {},
            algorithmId: combo.algorithmId,
            bodyweightSnapshot: sessionBW,
            activeUnit: 'kg',
          });

          const expectedTarget = fullPrescribedSets[ord - 1];

          // 2. Build exercise with `ord - 1` sets and run calculateAddedSetTarget for next ordinal
          const existingEx: ExerciseEntry = {
            ...fullEx,
            sets: Array.from({ length: ord - 1 }, (_, i) => ({
              setNumber: i + 1,
              weight: fullPrescribedSets[i]?.weight ?? 0,
              reps: fullPrescribedSets[i]?.reps ?? 0,
              rpe: fullPrescribedSets[i]?.rpe ?? 8.0,
              form: 'standard',
            })),
          };

          const addSetResult = calculateAddedSetTarget({
            objective: combo.objective,
            exercise: existingEx,
            weekNum: 2,
            programDuration: 8,
            previousLogs: combo.logs,
            algorithmId: combo.algorithmId,
            bodyweightSnapshot: sessionBW,
            activeUnit: 'kg',
          });

          expect(addSetResult.isPrescribed).toBe(true);
          expect(addSetResult.workingSetOrdinal).toBe(ord);
          expect(addSetResult.target).toBeDefined();
          expect(addSetResult.target!.weight).toBe(expectedTarget.weight);
          expect(addSetResult.target!.reps).toBe(expectedTarget.reps);
          expect(addSetResult.target!.rpe).toBe(expectedTarget.rpe);
          if (combo.objective === 'Deload') {
            expect(addSetResult.target!.form).toBe('strict');
          } else {
            expect(addSetResult.target!.form).toBe('standard');
          }
        }

        // Ordinal 7+ check: unprescribed fallback
        const ex6Sets: ExerciseEntry = {
          name: combo.exName,
          muscleGroup: combo.modality === 'assisted' ? 'Back' : 'Chest',
          modality: combo.modality,
          isMainMovement: true,
          movementCategory: 'compound',
          equipment: combo.modality === 'assisted' ? 'machine' : 'freeweight',
          sets: Array.from({ length: 6 }, (_, i) => ({
            setNumber: i + 1,
            weight: 0,
            reps: 0,
            rpe: 8.0,
            form: 'standard',
          })),
        };

        const addSet7Result = calculateAddedSetTarget({
          objective: combo.objective,
          exercise: ex6Sets,
          weekNum: 2,
          programDuration: 8,
          previousLogs: combo.logs,
          algorithmId: combo.algorithmId,
          bodyweightSnapshot: sessionBW,
          activeUnit: 'kg',
        });

        expect(addSet7Result.isPrescribed).toBe(false);
        expect(addSet7Result.workingSetOrdinal).toBe(7);
        expect(addSet7Result.target).toBeUndefined();
      });
    });
  });

  describe('10. MetReps Stage 2B — Direct Assisted Modality Add Set Tests', () => {
    const sessionBW: BodyweightSnapshot = { value: 80, unit: 'kg' };

    const assistedLogs: WorkoutLog[] = [
      {
        id: 'assisted-log-1',
        date: '2026-01-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Dip',
            muscleGroup: 'Triceps',
            modality: 'assisted',
            movementCategory: 'compound',
            equipment: 'machine',
            sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8.0, isCompleted: true }],
          },
        ],
      },
    ];

    it('Assistance increases on later fatigue-distributed sets (ordinals 1, 2, 3, 4)', () => {
      // Baseline e1RM = (80 - 20) / 0.739 = 60 / 0.739 = 81.19 kg
      // Set 1 (ordinal 1): RPE 8.0 -> raw effective load = 81.19 * 0.739 = 60.0 kg -> assistance = 80 - 60 = 20.0 kg
      // Set 2 (ordinal 2): RPE 8.5, fatigue ratio 0.96 -> capacity = 81.19 * 0.96 = 77.94 kg -> target load = 77.94 * 0.716 = 55.80 kg -> assistance = 80 - 55.80 = 24.20 -> 22.5 / 25.0 kg
      // Set 3 (ordinal 3): RPE 9.0, fatigue ratio 0.92 -> capacity = 81.19 * 0.92 = 74.69 kg -> target load = 74.69 * 0.694 = 51.83 kg -> assistance = 80 - 51.83 = 28.17 -> 30.0 kg
      const ex: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        movementCategory: 'compound',
        equipment: 'machine',
        sets: [
          { setNumber: 1, weight: 20.0, reps: 8, rpe: 8.0 },
          { setNumber: 2, weight: 22.5, reps: 8, rpe: 8.5 },
        ],
      };

      const set3Res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: assistedLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: sessionBW,
        activeUnit: 'kg',
      });

      expect(set3Res.isPrescribed).toBe(true);
      expect(set3Res.workingSetOrdinal).toBe(3);
      expect(set3Res.target?.weight).toBe(30.0);
      expect(set3Res.target?.weight).toBeGreaterThanOrEqual(ex.sets[1].weight!);
    });

    it('Stronger baseline produces less assistance for the added set', () => {
      // Stronger lifter used 10 kg assistance instead of 20 kg
      const strongerLogs: WorkoutLog[] = [
        {
          id: 'stronger-assisted-log',
          date: '2026-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 80, unit: 'kg' },
          exercises: [
            {
              name: 'Assisted Dip',
              muscleGroup: 'Triceps',
              modality: 'assisted',
              sets: [{ setNumber: 1, weight: 10, reps: 8, rpe: 8.0, isCompleted: true }],
            },
          ],
        },
      ];

      const ex: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 10, reps: 8, rpe: 8.0 }],
      };

      const set2Standard = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: assistedLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: sessionBW,
        activeUnit: 'kg',
      });

      const set2Stronger = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: strongerLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: sessionBW,
        activeUnit: 'kg',
      });

      expect(set2Stronger.target!.weight).toBeLessThan(set2Standard.target!.weight);
    });

    it('Bodyweight change between sessions changes assistance while preserving target effective load', () => {
      const ex: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8.0 }],
      };

      const res80kg = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: assistedLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        activeUnit: 'kg',
      });

      const res85kg = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: assistedLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: { value: 85, unit: 'kg' },
        activeUnit: 'kg',
      });

      // Gaining 5 kg bodyweight increases assistance by ~5 kg to maintain exact same effective load
      expect(res85kg.target!.weight).toBe(res80kg.target!.weight + 5.0);
    });

    it('Zero-assistance boundary and negative assistance constraint clamping', () => {
      // Historical log with very high effective load (e.g. 0 kg assistance x 10 reps @ 8)
      const eliteLogs: WorkoutLog[] = [
        {
          id: 'elite-assisted-log',
          date: '2026-01-01',
          unit: 'kg',
          bodyweightSnapshot: { value: 70, unit: 'kg' },
          exercises: [
            {
              name: 'Assisted Dip',
              muscleGroup: 'Triceps',
              modality: 'assisted',
              sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true }],
            },
          ],
        },
      ];

      // Ordinal 1 added set in Week 2 (intensity wave 6 reps @ RPE 8.0): target effective load (77.0 kg) exceeds bodyweight (70 kg), so assistance clamps to 0.0 kg
      const ex0: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        sets: [],
      };

      const res0 = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex0,
        weekNum: 2,
        programDuration: 8,
        previousLogs: eliteLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: { value: 70, unit: 'kg' },
        activeUnit: 'kg',
      });

      expect(res0.isPrescribed).toBe(true);
      expect(res0.workingSetOrdinal).toBe(1);
      expect(res0.target!.weight).toBe(0.0);
      expect(res0.target!.weight).toBeGreaterThanOrEqual(0.0);
    });

    it('Mixed kg/lb historical baseline correctly converted and projected on 2.5 lb grid', () => {
      const lbHistLogs: WorkoutLog[] = [
        {
          id: 'lb-log-1',
          date: '2026-01-01',
          unit: 'lb',
          bodyweightSnapshot: { value: 176.37, unit: 'lb' }, // ~80 kg
          exercises: [
            {
              name: 'Assisted Pull-up',
              muscleGroup: 'Back',
              modality: 'assisted',
              sets: [{ setNumber: 1, weight: 44.09, reps: 8, rpe: 8.0, isCompleted: true }], // ~20 kg assistance
            },
          ],
        },
      ];

      const ex: ExerciseEntry = {
        name: 'Assisted Pull-up',
        muscleGroup: 'Back',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 45, reps: 8, rpe: 8.0 }],
      };

      const resLb = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: lbHistLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: { value: 176.37, unit: 'lb' },
        activeUnit: 'lb',
      });

      expect(resLb.isPrescribed).toBe(true);
      expect(resLb.target!.weight % 2.5).toBeCloseTo(0, 4);
    });

    it('Repeated identical calls and 5 recalculation cycles exhibit zero numerical drift', () => {
      const ex: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8.0 }],
      };

      const runCall = () =>
        calculateAddedSetTarget({
          objective: 'Hypertrophy',
          exercise: ex,
          weekNum: 2,
          programDuration: 8,
          previousLogs: assistedLogs,
          algorithmId: 'hypertrophy_linear',
          bodyweightSnapshot: sessionBW,
          activeUnit: 'kg',
        });

      const initial = runCall();
      for (let i = 0; i < 5; i++) {
        const cycle = runCall();
        expect(cycle).toEqual(initial);
      }
    });
  });

  describe('11. MetReps Stage 2B — Direct Bodyweight Modality Add Set Tests', () => {
    const sessionBW: BodyweightSnapshot = { value: 80, unit: 'kg' };

    const bwLogs: WorkoutLog[] = [
      {
        id: 'bw-log-1',
        date: '2026-01-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Pull-up',
            muscleGroup: 'Back',
            modality: 'bodyweight',
            isMainMovement: true,
            movementCategory: 'compound',
            equipment: 'freeweight',
            sets: [{ setNumber: 1, weight: 0, reps: 8, rpe: 8.0, isCompleted: true }],
          },
          {
            name: 'Hanging Leg Raise',
            muscleGroup: 'Core',
            modality: 'bodyweight',
            isMainMovement: false,
            movementCategory: 'isolation',
            equipment: 'freeweight',
            sets: [{ setNumber: 1, weight: 0, reps: 12, rpe: 8.0, isCompleted: true }],
          },
        ],
      },
    ];

    it('Weight is strictly 0 and reps are integer values', () => {
      const ex: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 0, reps: 8, rpe: 8.0 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: bwLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: sessionBW,
        activeUnit: 'kg',
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.target!.weight).toBe(0);
      expect(Number.isInteger(res.target!.reps)).toBe(true);
      expect(res.target!.rpe).toBe(8.5);
    });

    it('Respects approved repetition bounds: Hypertrophy compound [5, 15] and isolation [8, 20]', () => {
      const compoundEx: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 0, reps: 8, rpe: 8.0 }],
      };

      const isoEx: ExerciseEntry = {
        name: 'Hanging Leg Raise',
        muscleGroup: 'Core',
        modality: 'bodyweight',
        movementCategory: 'isolation',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 0, reps: 12, rpe: 8.0 }],
      };

      const resCompound = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: compoundEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: bwLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: sessionBW,
        activeUnit: 'kg',
      });

      const resIso = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: isoEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: bwLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: sessionBW,
        activeUnit: 'kg',
      });

      expect(resCompound.target!.reps).toBeGreaterThanOrEqual(5);
      expect(resCompound.target!.reps).toBeLessThanOrEqual(15);

      expect(resIso.target!.reps).toBeGreaterThanOrEqual(8);
      expect(resIso.target!.reps).toBeLessThanOrEqual(20);
    });

    it('Respects approved repetition bounds: Strength Undulating [1, 6] and Linear [1, 8]', () => {
      const mainEx: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        isMainMovement: true,
        movementCategory: 'compound',
        equipment: 'freeweight',
        sets: [{ setNumber: 1, weight: 0, reps: 5, rpe: 8.0 }],
      };

      const resUndulating = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: mainEx,
        weekNum: 2,
        programDuration: 8,
        previousLogs: bwLogs,
        algorithmId: 'strength_undulating',
        bodyweightSnapshot: sessionBW,
        activeUnit: 'kg',
      });

      const resLinear = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: mainEx,
        weekNum: 1,
        programDuration: 8,
        previousLogs: bwLogs,
        algorithmId: 'strength_linear',
        bodyweightSnapshot: sessionBW,
        activeUnit: 'kg',
      });

      expect(resUndulating.target!.reps).toBeGreaterThanOrEqual(1);
      expect(resUndulating.target!.reps).toBeLessThanOrEqual(6);

      expect(resLinear.target!.reps).toBeGreaterThanOrEqual(1);
      expect(resLinear.target!.reps).toBeLessThanOrEqual(8);
    });

    it('Respects approved Deload repetition bound [1, 15]', () => {
      const ex: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 8, rpe: 8.0 }],
      };

      const resDeload = calculateAddedSetTarget({
        objective: 'Deload',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: bwLogs,
        bodyweightSnapshot: sessionBW,
        activeUnit: 'kg',
      });

      expect(resDeload.isPrescribed).toBe(true);
      expect(resDeload.target!.weight).toBe(0);
      expect(resDeload.target!.rpe).toBe(5.0);
      expect(resDeload.target!.reps).toBeGreaterThanOrEqual(1);
      expect(resDeload.target!.reps).toBeLessThanOrEqual(15);
    });

    it('Bodyweight change between sessions changes repetition target when mathematically required', () => {
      const ex: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 8, rpe: 8.0 }],
      };

      const resLight = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: bwLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: { value: 60, unit: 'kg' },
        activeUnit: 'kg',
      });

      const resHeavy = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        programDuration: 8,
        previousLogs: bwLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: { value: 100, unit: 'kg' },
        activeUnit: 'kg',
      });

      // Lighter bodyweight makes the exercise easier -> more reps required for same target effective load
      expect(resLight.target!.reps).toBeGreaterThanOrEqual(resHeavy.target!.reps);
    });

    it('Repeated identical calls and 5 recalculation cycles exhibit zero numerical drift', () => {
      const ex: ExerciseEntry = {
        name: 'Pull-up',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 8, rpe: 8.0 }],
      };

      const runCall = () =>
        calculateAddedSetTarget({
          objective: 'Hypertrophy',
          exercise: ex,
          weekNum: 2,
          programDuration: 8,
          previousLogs: bwLogs,
          algorithmId: 'hypertrophy_linear',
          bodyweightSnapshot: sessionBW,
          activeUnit: 'kg',
        });

      const initial = runCall();
      for (let i = 0; i < 5; i++) {
        const cycle = runCall();
        expect(cycle).toEqual(initial);
      }
    });
  });

  describe('12. MetReps Stage 2B — Direct Bypass, Fallback & Protection Tests', () => {
    const sessionBW: BodyweightSnapshot = { value: 80, unit: 'kg' };

    const histLogs: WorkoutLog[] = [
      {
        id: 'hist-log-all',
        date: '2026-01-01',
        unit: 'kg',
        bodyweightSnapshot: { value: 80, unit: 'kg' },
        exercises: [
          {
            name: 'Assisted Dip',
            muscleGroup: 'Triceps',
            modality: 'assisted',
            sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8.0, isCompleted: true }],
          },
          {
            name: 'Push-up',
            muscleGroup: 'Chest',
            modality: 'bodyweight',
            sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8.0, isCompleted: true }],
          },
        ],
      },
    ];

    it('Objective Off returns unprescribed for assisted and bodyweight', () => {
      const assistedEx: ExerciseEntry = { name: 'Assisted Dip', muscleGroup: 'Triceps', modality: 'assisted', sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8 }] };
      const bwEx: ExerciseEntry = { name: 'Push-up', muscleGroup: 'Chest', modality: 'bodyweight', sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8 }] };

      expect(calculateAddedSetTarget({ objective: 'Off', exercise: assistedEx, weekNum: 1, previousLogs: histLogs, bodyweightSnapshot: sessionBW }).isPrescribed).toBe(false);
      expect(calculateAddedSetTarget({ objective: 'Off', exercise: bwEx, weekNum: 1, previousLogs: histLogs, bodyweightSnapshot: sessionBW }).isPrescribed).toBe(false);
    });

    it('Strength non-main assisted and bodyweight accessories return unprescribed', () => {
      const assistedAcc: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        isMainMovement: false,
        sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8.0 }],
      };

      const bwAcc: ExerciseEntry = {
        name: 'Push-up',
        muscleGroup: 'Chest',
        modality: 'bodyweight',
        isMainMovement: false,
        sets: [{ setNumber: 1, weight: 0, reps: 10, rpe: 8.0 }],
      };

      const resAssisted = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: assistedAcc,
        weekNum: 2,
        previousLogs: histLogs,
        algorithmId: 'strength_undulating',
        bodyweightSnapshot: sessionBW,
      });

      const resBw = calculateAddedSetTarget({
        objective: 'Strength',
        exercise: bwAcc,
        weekNum: 2,
        previousLogs: histLogs,
        algorithmId: 'strength_undulating',
        bodyweightSnapshot: sessionBW,
      });

      expect(resAssisted.isPrescribed).toBe(false);
      expect(resBw.isPrescribed).toBe(false);
    });

    it('Unknown or invalid algorithm returns unprescribed', () => {
      const ex: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8.0 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        previousLogs: histLogs,
        algorithmId: 'unknown_algo' as any,
        bodyweightSnapshot: sessionBW,
      });

      expect(res.isPrescribed).toBe(false);
    });

    it('Missing historical and template baseline returns unprescribed', () => {
      const ex: ExerciseEntry = {
        name: 'New Custom Calisthenics Exercise',
        muscleGroup: 'Back',
        modality: 'bodyweight',
        sets: [{ setNumber: 1, weight: 0, reps: 0, rpe: 8.0 }],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        previousLogs: [],
        templateExercise: undefined,
        bodyweightSnapshot: sessionBW,
      });

      expect(res.isPrescribed).toBe(false);
    });

    it('Warm-up rows are excluded from working set count and ordinal derivation', () => {
      const ex: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        sets: [
          { setNumber: 1, weight: 40, reps: 5, rpe: 4.0, isWarmup: true },
          { setNumber: 2, weight: 30, reps: 4, rpe: 6.0, isWarmup: true },
          { setNumber: 3, weight: 20, reps: 8, rpe: 8.0, isWarmup: false },
        ],
      };

      const res = calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        previousLogs: histLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: sessionBW,
      });

      expect(res.isPrescribed).toBe(true);
      expect(res.workingSetOrdinal).toBe(2); // 1 existing working set + 1 = 2
    });

    it('Input exercise and snapshot remain immutable', () => {
      const ex: ExerciseEntry = {
        name: 'Assisted Dip',
        muscleGroup: 'Triceps',
        modality: 'assisted',
        sets: [{ setNumber: 1, weight: 20, reps: 8, rpe: 8.0 }],
      };

      const exSnapshot = JSON.stringify(ex);
      const bwSnapshot = JSON.stringify(sessionBW);

      calculateAddedSetTarget({
        objective: 'Hypertrophy',
        exercise: ex,
        weekNum: 1,
        previousLogs: histLogs,
        algorithmId: 'hypertrophy_linear',
        bodyweightSnapshot: sessionBW,
      });

      expect(JSON.stringify(ex)).toBe(exSnapshot);
      expect(JSON.stringify(sessionBW)).toBe(bwSnapshot);
    });
  });
});
