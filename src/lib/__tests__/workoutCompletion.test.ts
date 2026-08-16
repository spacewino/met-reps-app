import { describe, it, expect, beforeEach } from 'vitest';
import {
  prepareExercisesForSave,
  remapAfterExerciseDelete,
  remapAfterSetDelete,
  remapAfterExerciseReplace,
  remapAfterExerciseMove,
  remapAfterSetMove,
  remapAfterSetInsert,
} from '../workoutCompletion';
import { ExerciseEntry, WorkoutLog } from '../../types';
import { storage } from '../storage';

// In-memory localStorage mock for node test runner
const memoryStore: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key: string) => memoryStore[key] ?? null,
  setItem: (key: string, value: string) => {
    memoryStore[key] = String(value);
  },
  removeItem: (key: string) => {
    delete memoryStore[key];
  },
  clear: () => {
    Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
  },
  key: (index: number) => Object.keys(memoryStore)[index] ?? null,
  length: 0,
};

describe('MetReps Completion-on-Save & Provenance Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const sampleExercises: ExerciseEntry[] = [
    {
      name: 'Back Squat (High Bar)',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: true,
      movementCategory: 'compound',
      equipment: 'freeweight',
      sets: [
        { setNumber: 1, weight: 60, reps: 5, rpe: 7, form: 'strict', isWarmup: true, comment: 'warmup feel good' },
        { setNumber: 2, weight: 100, reps: 5, rpe: 8, form: 'standard', isWarmup: false },
        {
          setNumber: 3,
          weight: 100,
          reps: 5,
          rpe: 9,
          form: 'loose',
          isDropSet: true,
          dropSubSets: [{ weight: 80, reps: 4 }, { weight: 60, reps: 6 }],
          comment: 'heavy triple drop',
        },
      ],
    },
    {
      name: 'Leg Extension',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: false,
      movementCategory: 'isolation',
      equipment: 'machine',
      isSkipped: false,
      sets: [
        { setNumber: 1, weight: 40, reps: 12, rpe: 8, form: 'strict' },
        { setNumber: 2, weight: 40, reps: 10, rpe: 9, form: 'standard' },
      ],
    },
    {
      name: 'Pull-Up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      isMainMovement: false,
      sets: [
        { setNumber: 1, weight: 0, reps: 8, rpe: 8, form: 'strict' },
        { setNumber: 2, weight: 10, reps: 6, rpe: 9, form: 'standard' },
      ],
    },
  ];

  it('1. Untouched valid prefilled weighted target saves isCompleted: true without checkboxes', () => {
    const untouchedExercises: ExerciseEntry[] = [
      {
        name: 'Barbell Bench Press',
        muscleGroup: 'Pecs',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 100, reps: 5, rpe: 8 },
          { setNumber: 2, weight: 100, reps: 5, rpe: 8.5 },
        ],
      },
    ];

    const result = prepareExercisesForSave({
      exercises: untouchedExercises,
    });

    expect(result[0].sets[0].isCompleted).toBe(true);
    expect(result[0].sets[1].isCompleted).toBe(true);
    expect(result[0].sets[0].isSkipped).toBeUndefined();
    expect(result[0].sets[1].isSkipped).toBeUndefined();
  });

  it('2. Manually edited valid weighted set saves isCompleted: true', () => {
    const editedExercises: ExerciseEntry[] = [
      {
        name: 'Barbell Bench Press',
        muscleGroup: 'Pecs',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 105, reps: 6, rpe: 9, comment: 'Felt strong today' },
        ],
      },
    ];

    const result = prepareExercisesForSave({
      exercises: editedExercises,
    });

    expect(result[0].sets[0].weight).toBe(105);
    expect(result[0].sets[0].reps).toBe(6);
    expect(result[0].sets[0].rpe).toBe(9);
    expect(result[0].sets[0].comment).toBe('Felt strong today');
    expect(result[0].sets[0].isCompleted).toBe(true);
  });

  it('3. Valid set with missing RPE saves isCompleted: true', () => {
    const missingRpeExercises: ExerciseEntry[] = [
      {
        name: 'Dumbbell Curl',
        muscleGroup: 'Biceps',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 16, reps: 10, rpe: null },
          { setNumber: 2, weight: 16, reps: 10, rpe: undefined },
        ],
      },
    ];

    const result = prepareExercisesForSave({
      exercises: missingRpeExercises,
    });

    expect(result[0].sets[0].isCompleted).toBe(true);
    expect(result[0].sets[1].isCompleted).toBe(true);
  });

  it('4. Weighted set with zero or missing weight saves isCompleted: false', () => {
    const zeroWeightExercises: ExerciseEntry[] = [
      {
        name: 'Incline Bench Press',
        muscleGroup: 'Pecs',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 0, reps: 8 },
          { setNumber: 2, weight: null, reps: 8 },
          { setNumber: 3, weight: undefined, reps: 8 },
          { setNumber: 4, weight: -5, reps: 8 },
        ],
      },
    ];

    const result = prepareExercisesForSave({
      exercises: zeroWeightExercises,
    });

    expect(result[0].sets[0].isCompleted).toBe(false);
    expect(result[0].sets[1].isCompleted).toBe(false);
    expect(result[0].sets[2].isCompleted).toBe(false);
    expect(result[0].sets[3].isCompleted).toBe(false);
  });

  it('5. Weighted set with missing or zero reps saves isCompleted: false', () => {
    const zeroRepsExercises: ExerciseEntry[] = [
      {
        name: 'Incline Bench Press',
        muscleGroup: 'Pecs',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 80, reps: 0 },
          { setNumber: 2, weight: 80, reps: null },
          { setNumber: 3, weight: 80, reps: undefined },
          { setNumber: 4, weight: 80, reps: -2 },
        ],
      },
    ];

    const result = prepareExercisesForSave({
      exercises: zeroRepsExercises,
    });

    expect(result[0].sets[0].isCompleted).toBe(false);
    expect(result[0].sets[1].isCompleted).toBe(false);
    expect(result[0].sets[2].isCompleted).toBe(false);
    expect(result[0].sets[3].isCompleted).toBe(false);
  });

  it('6. Set-level skipped target preserves values and saves isCompleted: false', () => {
    const skippedSetExercises: ExerciseEntry[] = [
      {
        name: 'Squat',
        muscleGroup: 'Quads',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 140, reps: 5, rpe: 8, isSkipped: false },
          { setNumber: 2, weight: 140, reps: 5, rpe: 8.5, isSkipped: false },
          { setNumber: 3, weight: 140, reps: 5, rpe: 9, isSkipped: true, comment: 'Ran out of time' },
        ],
      },
    ];

    const result = prepareExercisesForSave({
      exercises: skippedSetExercises,
    });

    // Sets 1 & 2 save as completed
    expect(result[0].sets[0].isCompleted).toBe(true);
    expect(result[0].sets[1].isCompleted).toBe(true);

    // Set 3 preserves target values but is marked isCompleted: false and isSkipped: true
    expect(result[0].sets[2].weight).toBe(140);
    expect(result[0].sets[2].reps).toBe(5);
    expect(result[0].sets[2].rpe).toBe(9);
    expect(result[0].sets[2].comment).toBe('Ran out of time');
    expect(result[0].sets[2].isSkipped).toBe(true);
    expect(result[0].sets[2].isCompleted).toBe(false);
  });

  it('7. Exercise-level skipped exercise saves all its sets as isCompleted: false', () => {
    const exerciseSkippedList: ExerciseEntry[] = [
      {
        name: 'Lateral Raise',
        muscleGroup: 'Shoulders',
        modality: 'weighted',
        isSkipped: true,
        sets: [
          { setNumber: 1, weight: 12, reps: 15, rpe: 8 },
          { setNumber: 2, weight: 12, reps: 15, rpe: 8.5 },
        ],
      },
    ];

    const result = prepareExercisesForSave({
      exercises: exerciseSkippedList,
    });

    expect(result[0].isSkipped).toBe(true);
    expect(result[0].sets[0].isCompleted).toBe(false);
    expect(result[0].sets[1].isCompleted).toBe(false);
    expect(result[0].sets[0].weight).toBe(12);
    expect(result[0].sets[0].reps).toBe(15);
  });

  it('8. Warm-up validity and metadata preservation', () => {
    const warmupExercises: ExerciseEntry[] = [
      {
        name: 'Deadlift',
        muscleGroup: 'Back',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 60, reps: 5, isWarmup: true, comment: 'light warmup' },
          { setNumber: 2, weight: 100, reps: 3, isWarmup: true },
          { setNumber: 3, weight: 160, reps: 5, isWarmup: false },
        ],
      },
    ];

    const result = prepareExercisesForSave({
      exercises: warmupExercises,
    });

    expect(result[0].sets[0].isWarmup).toBe(true);
    expect(result[0].sets[0].isCompleted).toBe(true);
    expect(result[0].sets[0].comment).toBe('light warmup');
    expect(result[0].sets[1].isWarmup).toBe(true);
    expect(result[0].sets[1].isCompleted).toBe(true);
    expect(result[0].sets[2].isWarmup).toBe(false);
    expect(result[0].sets[2].isCompleted).toBe(true);
  });

  it('9. Drop-set and dropSubSets preservation', () => {
    const dropSetExercises: ExerciseEntry[] = [
      {
        name: 'Triceps Pushdown',
        muscleGroup: 'Triceps',
        modality: 'weighted',
        sets: [
          {
            setNumber: 1,
            weight: 35,
            reps: 10,
            rpe: 9,
            isDropSet: true,
            dropSubSets: [
              { weight: 25, reps: 8 },
              { weight: 15, reps: 10 },
            ],
            comment: 'triple drop burnout',
          },
        ],
      },
    ];

    const result = prepareExercisesForSave({
      exercises: dropSetExercises,
    });

    expect(result[0].sets[0].isDropSet).toBe(true);
    expect(result[0].sets[0].dropSubSets).toEqual([
      { weight: 25, reps: 8 },
      { weight: 15, reps: 10 },
    ]);
    expect(result[0].sets[0].isCompleted).toBe(true);
    expect(result[0].sets[0].comment).toBe('triple drop burnout');
  });

  it('10. Existing-log edit and resave under new completion-on-save policy', () => {
    const existingLog: WorkoutLog = {
      id: 'existing-log-test',
      date: '2025-12-01',
      unit: 'kg',
      exercises: [
        {
          name: 'Overhead Press',
          muscleGroup: 'Shoulders',
          sets: [
            { setNumber: 1, weight: 50, reps: 8, isCompleted: true },
            { setNumber: 2, weight: 50, reps: 8, isCompleted: undefined }, // legacy
            { setNumber: 3, weight: 0, reps: 0, isCompleted: false },     // invalid
            { setNumber: 4, weight: 50, reps: 8, isSkipped: true },        // skipped
          ],
        },
      ],
    };

    const resaved = prepareExercisesForSave({
      exercises: existingLog.exercises,
    });

    // Valid sets 1 and 2 save as true
    expect(resaved[0].sets[0].isCompleted).toBe(true);
    expect(resaved[0].sets[1].isCompleted).toBe(true);

    // Invalid set 3 saves as false
    expect(resaved[0].sets[2].isCompleted).toBe(false);

    // Skipped set 4 saves as false
    expect(resaved[0].sets[3].isCompleted).toBe(false);
    expect(resaved[0].sets[3].isSkipped).toBe(true);
  });

  it('11. Input exercise and set objects remain immutable', () => {
    const deepCloneOriginal = JSON.parse(JSON.stringify(sampleExercises));

    const result = prepareExercisesForSave({
      exercises: sampleExercises,
      defaultBodyweight: 75,
    });

    expect(sampleExercises).toEqual(deepCloneOriginal);
    expect(result).not.toBe(sampleExercises);
    expect(result[0]).not.toBe(sampleExercises[0]);
    expect(result[0].sets[0]).not.toBe(sampleExercises[0].sets[0]);
  });

  describe('Modality-Specific Validity', () => {
    it('modality: weighted requires positive weight and reps', () => {
      const ex: ExerciseEntry[] = [
        {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 100, reps: 5 }, // valid -> true
            { setNumber: 2, weight: 0, reps: 5 },   // 0 weight -> false
            { setNumber: 3, weight: 100, reps: 0 }, // 0 reps -> false
          ],
        },
      ];

      const res = prepareExercisesForSave({ exercises: ex });
      expect(res[0].sets[0].isCompleted).toBe(true);
      expect(res[0].sets[1].isCompleted).toBe(false);
      expect(res[0].sets[2].isCompleted).toBe(false);
    });

    it('modality: undefined defaults to weighted semantics', () => {
      const ex: ExerciseEntry[] = [
        {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          // modality undefined
          sets: [
            { setNumber: 1, weight: 80, reps: 8 },
            { setNumber: 2, weight: 0, reps: 8 },
          ],
        },
      ];

      const res = prepareExercisesForSave({ exercises: ex });
      expect(res[0].sets[0].isCompleted).toBe(true);
      expect(res[0].sets[1].isCompleted).toBe(false);
    });

    it('modality: bodyweight requires positive reps and substitutes defaultBodyweight if weight is 0', () => {
      const ex: ExerciseEntry[] = [
        {
          name: 'Pull-Up',
          muscleGroup: 'Back',
          modality: 'bodyweight',
          sets: [
            { setNumber: 1, weight: 0, reps: 10 },
            { setNumber: 2, weight: 15, reps: 6 },
            { setNumber: 3, weight: 0, reps: 0 },
          ],
        },
      ];

      const res = prepareExercisesForSave({ exercises: ex, defaultBodyweight: 80 });
      expect(res[0].sets[0].isCompleted).toBe(true);
      expect(res[0].sets[0].weight).toBe(80); // substituted with bodyweight

      expect(res[0].sets[1].isCompleted).toBe(true);
      expect(res[0].sets[1].weight).toBe(15); // weighted bodyweight preserved

      expect(res[0].sets[2].isCompleted).toBe(false); // 0 reps -> incomplete
    });

    it('modality: assisted requires positive reps (assist weight can be 0 or positive)', () => {
      const ex: ExerciseEntry[] = [
        {
          name: 'Assisted Dip',
          muscleGroup: 'Triceps',
          modality: 'assisted',
          sets: [
            { setNumber: 1, weight: 20, reps: 8 }, // 20kg assist, 8 reps -> true
            { setNumber: 2, weight: 0, reps: 10 },  // 0kg assist, 10 reps -> true
            { setNumber: 3, weight: 20, reps: 0 },  // 0 reps -> false
          ],
        },
      ];

      const res = prepareExercisesForSave({ exercises: ex });
      expect(res[0].sets[0].isCompleted).toBe(true);
      expect(res[0].sets[1].isCompleted).toBe(true);
      expect(res[0].sets[2].isCompleted).toBe(false);
    });

    it('modality: timed requires positive duration stored in set.weight', () => {
      const ex: ExerciseEntry[] = [
        {
          name: 'Plank',
          muscleGroup: 'Core',
          modality: 'timed',
          sets: [
            { setNumber: 1, weight: 60, reps: 0 }, // 60 seconds -> true
            { setNumber: 2, weight: 0, reps: 0 },  // 0 seconds -> false
          ],
        },
      ];

      const res = prepareExercisesForSave({ exercises: ex });
      expect(res[0].sets[0].isCompleted).toBe(true);
      expect(res[0].sets[1].isCompleted).toBe(false);
    });

    it('modality: distance requires positive meters stored in set.reps', () => {
      const ex: ExerciseEntry[] = [
        {
          name: 'Running',
          muscleGroup: 'Cardio',
          modality: 'distance',
          sets: [
            { setNumber: 1, weight: 0, reps: 5000 }, // 5000 meters -> true
            { setNumber: 2, weight: 0, reps: 0 },    // 0 meters -> false
          ],
        },
      ];

      const res = prepareExercisesForSave({ exercises: ex });
      expect(res[0].sets[0].isCompleted).toBe(true);
      expect(res[0].sets[1].isCompleted).toBe(false);
    });

    it('modality: distance_loaded requires positive load in weight and distance in reps', () => {
      const ex: ExerciseEntry[] = [
        {
          name: 'Farmers Walk',
          muscleGroup: 'Full Body',
          modality: 'distance_loaded',
          sets: [
            { setNumber: 1, weight: 32, reps: 40 }, // 32kg for 40 meters -> true
            { setNumber: 2, weight: 0, reps: 40 },  // 0kg -> false
            { setNumber: 3, weight: 32, reps: 0 },  // 0 meters -> false
          ],
        },
      ];

      const res = prepareExercisesForSave({ exercises: ex });
      expect(res[0].sets[0].isCompleted).toBe(true);
      expect(res[0].sets[1].isCompleted).toBe(false);
      expect(res[0].sets[2].isCompleted).toBe(false);
    });
  });
});

describe('Pure Index-Remapping Helper Suite', () => {
  it('A. Exercise deletion from the middle correctly remaps indices', () => {
    const record: Record<string, boolean> = {
      '0-0': true,  // Exercise A
      '1-0': false, // Exercise B
      '2-0': true,  // Exercise C
      '2-1': true,  // Exercise C second set
    };

    const remapped = remapAfterExerciseDelete(record, 1);

    expect(remapped['0-0']).toBe(true);  // A unchanged
    expect(remapped['1-0']).toBe(true);  // old '2-0' shifted down
    expect(remapped['1-1']).toBe(true);  // old '2-1' shifted down
    expect(remapped['2-0']).toBeUndefined();
    expect(remapped['2-1']).toBeUndefined();
    expect(Object.keys(remapped)).toHaveLength(3);
  });

  it('B. Exercise deletion at the beginning correctly shifts all subsequent exercises', () => {
    const record: Record<string, boolean> = {
      '0-0': true,  // Exercise A
      '1-0': false, // Exercise B
      '2-0': true,  // Exercise C
    };

    const remapped = remapAfterExerciseDelete(record, 0);

    expect(remapped['0-0']).toBe(false); // old '1-0' -> '0-0'
    expect(remapped['1-0']).toBe(true);  // old '2-0' -> '1-0'
    expect(remapped['2-0']).toBeUndefined();
    expect(Object.keys(remapped)).toHaveLength(2);
  });

  it('C. Exercise deletion at the end removes only trailing keys', () => {
    const record: Record<string, boolean> = {
      '0-0': true,
      '1-0': false,
      '2-0': true,
    };

    const remapped = remapAfterExerciseDelete(record, 2);

    expect(remapped['0-0']).toBe(true);
    expect(remapped['1-0']).toBe(false);
    expect(remapped['2-0']).toBeUndefined();
    expect(Object.keys(remapped)).toHaveLength(2);
  });

  it('D. Set deletion from the middle correctly remaps set indices within target exercise', () => {
    const record: Record<string, boolean> = {
      '1-0': true,
      '1-1': false,
      '1-2': true,
      '0-0': true, // Other exercise unaffected
    };

    const remapped = remapAfterSetDelete(record, 1, 1);

    expect(remapped['0-0']).toBe(true);  // other exercise unaffected
    expect(remapped['1-0']).toBe(true);  // 1-0 unchanged
    expect(remapped['1-1']).toBe(true);  // old 1-2 shifted to 1-1
    expect(remapped['1-2']).toBeUndefined();
    expect(Object.keys(remapped)).toHaveLength(3);
  });

  it('E. Set deletion at the beginning shifts all subsequent sets in target exercise', () => {
    const record: Record<string, boolean> = {
      '1-0': false,
      '1-1': true,
      '1-2': true,
    };

    const remapped = remapAfterSetDelete(record, 1, 0);

    expect(remapped['1-0']).toBe(true); // old 1-1 -> 1-0
    expect(remapped['1-1']).toBe(true); // old 1-2 -> 1-1
    expect(remapped['1-2']).toBeUndefined();
    expect(Object.keys(remapped)).toHaveLength(2);
  });

  it('F. Set deletion at the end removes only target set key', () => {
    const record: Record<string, boolean> = {
      '1-0': true,
      '1-1': true,
      '1-2': false,
    };

    const remapped = remapAfterSetDelete(record, 1, 2);

    expect(remapped['1-0']).toBe(true);
    expect(remapped['1-1']).toBe(true);
    expect(remapped['1-2']).toBeUndefined();
    expect(Object.keys(remapped)).toHaveLength(2);
  });

  it('G. Replacement clears all keys for only the replaced exercise', () => {
    const record: Record<string, boolean> = {
      '0-0': true,
      '1-0': true,
      '1-1': false,
      '2-0': true,
    };

    const remapped = remapAfterExerciseReplace(record, 1);

    expect(remapped['0-0']).toBe(true);
    expect(remapped['2-0']).toBe(true);
    expect(remapped['1-0']).toBeUndefined();
    expect(remapped['1-1']).toBeUndefined();
    expect(Object.keys(remapped)).toHaveLength(2);
  });

  it('H. Exercise reordering swaps/remaps keys correctly', () => {
    const record: Record<string, boolean> = {
      '0-0': true,
      '0-1': true,
      '1-0': false,
      '2-0': true,
    };

    const remapped = remapAfterExerciseMove(record, 0, 1);

    expect(remapped['1-0']).toBe(true);  // old '0-0' -> '1-0'
    expect(remapped['1-1']).toBe(true);  // old '0-1' -> '1-1'
    expect(remapped['0-0']).toBe(false); // old '1-0' -> '0-0'
    expect(remapped['2-0']).toBe(true);  // '2-0' unchanged
  });

  it('I. Remapping helper functions identically across checkedSets, userTouchedSets, and completionTouchedSets', () => {
    const checkedSets: Record<string, boolean> = { '0-0': true, '1-0': false, '2-0': true };
    const userTouchedSets: Record<string, boolean> = { '1-0': true };
    const completionTouchedSets: Record<string, boolean> = { '2-0': true };

    const nextChecked = remapAfterExerciseDelete(checkedSets, 1);
    const nextTouched = remapAfterExerciseDelete(userTouchedSets, 1);
    const nextCompletion = remapAfterExerciseDelete(completionTouchedSets, 1);

    expect(nextChecked).toEqual({ '0-0': true, '1-0': true });
    expect(nextTouched).toEqual({});
    expect(nextCompletion).toEqual({ '1-0': true });
  });

  it('L. Input state records are not mutated by remapping helpers', () => {
    const originalChecked: Record<string, boolean> = { '0-0': true, '1-0': false, '2-0': true };
    const frozenRecord = Object.freeze({ ...originalChecked });

    const resultDelete = remapAfterExerciseDelete(frozenRecord, 1);
    expect(resultDelete).toEqual({ '0-0': true, '1-0': true });

    const resultSetDelete = remapAfterSetDelete(frozenRecord, 0, 0);
    expect(resultSetDelete).toEqual({ '1-0': false, '2-0': true });

    const resultReplace = remapAfterExerciseReplace(frozenRecord, 0);
    expect(resultReplace).toEqual({ '1-0': false, '2-0': true });

    const resultMove = remapAfterExerciseMove(frozenRecord, 0, 1);
    expect(resultMove).toEqual({ '1-0': true, '0-0': false, '2-0': true });

    const resultSetMove = remapAfterSetMove({ '0-0': true, '0-1': false }, 0, 0, 1);
    expect(resultSetMove).toEqual({ '0-1': true, '0-0': false });

    const resultInsert = remapAfterSetInsert({ '0-0': true, '0-1': false }, 0, 0, 3);
    expect(resultInsert).toEqual({ '0-3': true, '0-4': false });
  });

  describe('remapAfterSetInsert Suite', () => {
    it('M1. Inserts sets at beginning (e.g. 3 warmups) shifting all target exercise set indices by 3', () => {
      const record: Record<string, string> = {
        '0-0': 'set0',
        '0-1': 'set1',
        '0-2': 'set2',
        '1-0': 'ex1_set0',
      };

      const remapped = remapAfterSetInsert(record, 0, 0, 3);

      expect(remapped['0-3']).toBe('set0');
      expect(remapped['0-4']).toBe('set1');
      expect(remapped['0-5']).toBe('set2');
      expect(remapped['0-0']).toBeUndefined();
      expect(remapped['0-1']).toBeUndefined();
      expect(remapped['0-2']).toBeUndefined();
      expect(remapped['1-0']).toBe('ex1_set0'); // Other exercise unaffected
      expect(Object.keys(remapped)).toHaveLength(4);
    });

    it('M2. Inserts sets in the middle: sets before insert index remain unchanged, sets at or after shift up', () => {
      const record: Record<string, number> = {
        '0-0': 100,
        '0-1': 105,
        '0-2': 110,
        '1-0': 200,
      };

      const remapped = remapAfterSetInsert(record, 0, 1, 2);

      expect(remapped['0-0']).toBe(100); // before insert index (0 < 1) -> unchanged
      expect(remapped['0-3']).toBe(105); // old 0-1 shifted by 2 -> 0-3
      expect(remapped['0-4']).toBe(110); // old 0-2 shifted by 2 -> 0-4
      expect(remapped['1-0']).toBe(200); // other exercise unchanged
      expect(Object.keys(remapped)).toHaveLength(4);
    });

    it('M3. Inserts sets at the end: all existing sets remain unchanged', () => {
      const record: Record<string, boolean> = {
        '0-0': true,
        '0-1': false,
      };

      const remapped = remapAfterSetInsert(record, 0, 2, 1);

      expect(remapped['0-0']).toBe(true);
      expect(remapped['0-1']).toBe(false);
      expect(Object.keys(remapped)).toHaveLength(2);
    });

    it('M4. Malformed keys remain untouched and invalid parameters return safe copy without mutation', () => {
      const record: Record<string, boolean> = {
        '0-0': true,
        'malformed_key': false,
        '0-invalid': true,
      };

      const remapped = remapAfterSetInsert(record, 0, 0, 2);
      expect(remapped['0-2']).toBe(true);
      expect(remapped['malformed_key']).toBe(false);
      expect(remapped['0-invalid']).toBe(true);

      // Invalid insertion count (<= 0 or not integer)
      const invalidResult1 = remapAfterSetInsert(record, 0, 0, 0);
      expect(invalidResult1).toEqual(record);

      const invalidResult2 = remapAfterSetInsert(record, 0, 0, -1);
      expect(invalidResult2).toEqual(record);
    });
  });
});
