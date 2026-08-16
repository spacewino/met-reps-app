import { describe, it, expect, beforeEach } from 'vitest';
import { ExerciseEntry, Program, WorkoutLog } from '../../types';
import {
  isEligibleStrengthMainMovement,
  getEligibleMainMovementCount,
  updateProgramDayMainMovement,
} from '../programMetadata';
import { calculateObjectiveSets } from '../objectiveMath';
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

describe('Main Movement Persistence, Recovery & Baseline Protection Integration Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const pristineTemplateDay1: ExerciseEntry[] = [
    {
      name: 'Back Squat',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: false,
      sets: [
        { setNumber: 1, weight: 100, reps: 10, rpe: 8, form: 'strict', comment: 'Template note 1', isWarmup: false, isDropSet: false },
        { setNumber: 2, weight: 100, reps: 10, rpe: 8, form: 'strict', comment: 'Template note 2', isWarmup: false, isDropSet: false },
        { setNumber: 3, weight: 100, reps: 10, rpe: 8, form: 'strict', comment: 'Template note 3', isWarmup: false, isDropSet: false },
      ],
    },
    {
      name: 'Romanian Deadlift',
      muscleGroup: 'Hamstrings',
      modality: 'weighted',
      isMainMovement: false,
      sets: [
        { setNumber: 1, weight: 80, reps: 10, rpe: 8, form: 'standard' },
        { setNumber: 2, weight: 80, reps: 10, rpe: 8, form: 'standard' },
      ],
    },
    {
      name: 'Leg Extension',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: false,
      sets: [
        { setNumber: 1, weight: 50, reps: 12, rpe: 8, form: 'standard' },
      ],
    },
  ];

  const testProgram: Program = {
    id: 'prog-strength-test',
    name: 'Strength 8-Week Wave',
    daysPerWeek: 3,
    programDuration: 8,
    createdAt: '2026-01-01T00:00:00.000Z',
    assignedWeekdays: { 1: 1, 2: 3, 3: 5 },
    objective: 'Strength',
    algorithmId: 'strength_undulating',
    exercisesByDay: {
      1: JSON.parse(JSON.stringify(pristineTemplateDay1)),
    },
  };

  it('Requirement 1 & 2: Selecting Main Movement in Week 1 persists to Program.exercisesByDay and loads in Week 2', () => {
    storage.saveProgram(testProgram);
    storage.setCurrentProgramId(testProgram.id);

    // Week 1: Select Back Squat (index 0)
    const updateResult = updateProgramDayMainMovement(testProgram, 1, 0, 'Back Squat');
    expect(updateResult.success).toBe(true);
    storage.saveProgram(updateResult.updatedProgram);

    // Simulate Week 2 initialization loading from storage
    const loadedProgram = storage.getPrograms().find(p => p.id === testProgram.id);
    expect(loadedProgram).toBeDefined();
    const day1Exercises = loadedProgram!.exercisesByDay[1];

    expect(day1Exercises[0].name).toBe('Back Squat');
    expect(day1Exercises[0].isMainMovement).toBe(true);
    expect(day1Exercises[1].isMainMovement).toBe(false);
    expect(day1Exercises[2].isMainMovement).toBe(false);

    expect(getEligibleMainMovementCount(day1Exercises)).toBe(1);
  });

  it('Requirement 3: Confirmed swap in Week 1 persists exactly one Main Movement', () => {
    // Start with Back Squat as main movement
    const initialProg = updateProgramDayMainMovement(testProgram, 1, 0, 'Back Squat').updatedProgram;

    // Swap to Romanian Deadlift (index 1)
    const swapResult = updateProgramDayMainMovement(initialProg, 1, 1, 'Romanian Deadlift');
    expect(swapResult.success).toBe(true);

    const day1 = swapResult.updatedProgram.exercisesByDay[1];
    expect(day1[0].isMainMovement).toBe(false);
    expect(day1[1].isMainMovement).toBe(true);
    expect(day1[2].isMainMovement).toBe(false);
    expect(getEligibleMainMovementCount(day1)).toBe(1);
  });

  it('Requirement 4: Deselecting in Week 1 persists zero main movements', () => {
    const initialProg = updateProgramDayMainMovement(testProgram, 1, 0, 'Back Squat').updatedProgram;
    const deselectResult = updateProgramDayMainMovement(initialProg, 1, null);
    expect(deselectResult.success).toBe(true);

    const day1 = deselectResult.updatedProgram.exercisesByDay[1];
    expect(day1[0].isMainMovement).toBe(false);
    expect(day1[1].isMainMovement).toBe(false);
    expect(getEligibleMainMovementCount(day1)).toBe(0);
  });

  it('Requirement 5 & 7: Week 2+ with exactly one eligible Main Movement is locked; repair mode unlocks with 0 or >1', () => {
    // 1 eligible -> locked
    const dayWith1Main: ExerciseEntry[] = [
      { ...pristineTemplateDay1[0], isMainMovement: true },
      { ...pristineTemplateDay1[1], isMainMovement: false },
    ];
    const isLockedWhen1 = getEligibleMainMovementCount(dayWith1Main) === 1;
    expect(isLockedWhen1).toBe(true);

    // 0 eligible -> unlocked repair mode
    const dayWith0Main: ExerciseEntry[] = [
      { ...pristineTemplateDay1[0], isMainMovement: false },
      { ...pristineTemplateDay1[1], isMainMovement: false },
    ];
    const isLockedWhen0 = getEligibleMainMovementCount(dayWith0Main) === 1;
    expect(isLockedWhen0).toBe(false);

    // Multiple eligible -> unlocked repair mode
    const dayWithMultipleMain: ExerciseEntry[] = [
      { ...pristineTemplateDay1[0], isMainMovement: true },
      { ...pristineTemplateDay1[1], isMainMovement: true },
    ];
    const isLockedWhenMulti = getEligibleMainMovementCount(dayWithMultipleMain) === 1;
    expect(isLockedWhenMulti).toBe(false);
  });

  it('Requirement 8: Week 2+ with multiple eligible Main Movements allows explicit repair to exactly one', () => {
    const corruptProgram: Program = {
      ...testProgram,
      exercisesByDay: {
        1: [
          { ...pristineTemplateDay1[0], isMainMovement: true },
          { ...pristineTemplateDay1[1], isMainMovement: true },
        ],
      },
    };

    expect(getEligibleMainMovementCount(corruptProgram.exercisesByDay[1])).toBe(2);

    // User explicitly selects Romanian Deadlift (index 1) to repair
    const repairResult = updateProgramDayMainMovement(corruptProgram, 1, 1, 'Romanian Deadlift');
    expect(repairResult.success).toBe(true);

    const day1 = repairResult.updatedProgram.exercisesByDay[1];
    expect(day1[0].isMainMovement).toBe(false);
    expect(day1[1].isMainMovement).toBe(true);
    expect(getEligibleMainMovementCount(day1)).toBe(1);
  });

  it('Requirement 9 & 10: No exercise is auto-selected and WorkoutLogs never mutate Program template', () => {
    storage.saveProgram(testProgram);

    // Save a historical workout log where Back Squat was logged
    const log: WorkoutLog = {
      id: 'log-1',
      date: '2026-01-01',
      programId: testProgram.id,
      program: testProgram.name,
      week: '1',
      day: '1',
      exercises: [
        {
          name: 'Back Squat',
          muscleGroup: 'Quads',
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 120, reps: 5, rpe: 8 }],
        },
      ],
      unit: 'kg',
      durationMinutes: 60,
      objective: 'Strength',
    };
    storage.saveWorkoutLog(log);

    // Template in storage must remain unmutated (isMainMovement: false)
    const storedProg = storage.getPrograms().find(p => p.id === testProgram.id)!;
    expect(storedProg.exercisesByDay[1][0].isMainMovement).toBe(false);
  });

  it('Requirement 11, 12, 13: Template weights, reps, RPE, form, comments, warm-ups, drop sets remain untouched when designating Main Movement', () => {
    const updateResult = updateProgramDayMainMovement(testProgram, 1, 0, 'Back Squat');
    const day1 = updateResult.updatedProgram.exercisesByDay[1];

    // Check Back Squat sets
    expect(day1[0].sets).toEqual(pristineTemplateDay1[0].sets);
    expect(day1[0].sets[0].weight).toBe(100);
    expect(day1[0].sets[0].reps).toBe(10);
    expect(day1[0].sets[0].rpe).toBe(8);
    expect(day1[0].sets[0].form).toBe('strict');
    expect(day1[0].sets[0].comment).toBe('Template note 1');

    // Accessories untouched
    expect(day1[1].sets).toEqual(pristineTemplateDay1[1].sets);
    expect(day1[2].sets).toEqual(pristineTemplateDay1[2].sets);
  });

  it('Requirement 14 & 15 & 16: Eligibility rules for skipped, bodyweight, assisted, timed, distance, and weighted/undefined modalities', () => {
    expect(isEligibleStrengthMainMovement({ name: 'Squat', muscleGroup: 'Quads', sets: [], modality: 'weighted' })).toBe(true);
    expect(isEligibleStrengthMainMovement({ name: 'Squat', muscleGroup: 'Quads', sets: [] })).toBe(true); // undefined modality

    expect(isEligibleStrengthMainMovement({ name: 'Squat', muscleGroup: 'Quads', sets: [], modality: 'weighted', isSkipped: true })).toBe(false);
    expect(isEligibleStrengthMainMovement({ name: 'Pullup', muscleGroup: 'Back', sets: [], modality: 'bodyweight' })).toBe(false);
    expect(isEligibleStrengthMainMovement({ name: 'Dip', muscleGroup: 'Chest', sets: [], modality: 'assisted' })).toBe(false);
    expect(isEligibleStrengthMainMovement({ name: 'Plank', muscleGroup: 'Core', sets: [], modality: 'timed' })).toBe(false);
    expect(isEligibleStrengthMainMovement({ name: 'Run', muscleGroup: 'Cardio', sets: [], modality: 'distance' })).toBe(false);
    expect(isEligibleStrengthMainMovement({ name: 'Carry', muscleGroup: 'Core', sets: [], modality: 'distance_loaded' })).toBe(false);
  });

  it('Requirement 18, 19, 20: Exercise resolution via index, unique name fallback, and duplicate ambiguity protection', () => {
    // Aligned index + name
    const resDirect = updateProgramDayMainMovement(testProgram, 1, 0, 'Back Squat');
    expect(resDirect.success).toBe(true);
    expect(resDirect.updatedProgram.exercisesByDay[1][0].isMainMovement).toBe(true);

    // Shifted index but unique name
    const resShifted = updateProgramDayMainMovement(testProgram, 1, 2, 'Back Squat');
    expect(resShifted.success).toBe(true);
    expect(resShifted.updatedProgram.exercisesByDay[1][0].isMainMovement).toBe(true);

    // Duplicate name ambiguity
    const dupProg: Program = {
      ...testProgram,
      exercisesByDay: {
        1: [
          { ...pristineTemplateDay1[0], name: 'Back Squat' },
          { ...pristineTemplateDay1[1], name: 'Back Squat' },
        ],
      },
    };
    const resDup = updateProgramDayMainMovement(dupProg, 1, 99, 'Back Squat');
    expect(resDup.success).toBe(false);
    expect(resDup.error).toContain('Multiple exercises named');
  });

  it('Requirement 26: strength_undulating Week 2 calculation retains 5 reps @ RPE 8.0 on Main Movement', () => {
    // Template cold start: 100 kg x 10 @ RPE 8 -> e1RM = 100 / 0.680 = 147.0588 kg
    // Week 2 Undulating Profile: target reps = 5, target RPE = 8.0, intensity = 0.815
    // Target = 147.0588 * 0.815 = 119.85 kg -> rounded to 120.0 kg
    const ex: ExerciseEntry = {
      name: 'Back Squat',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' },
        { setNumber: 2, weight: 0, reps: 0, rpe: 0, form: 'standard' },
        { setNumber: 3, weight: 0, reps: 0, rpe: 0, form: 'standard' },
      ],
    };

    const templateEx = pristineTemplateDay1[0];

    const calculatedSets = calculateObjectiveSets({
      objective: 'Strength',
      exercise: ex,
      exerciseIndex: 0,
      totalExercises: 3,
      weekNum: 2,
      programDuration: 8,
      previousLogs: [],
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'strength_undulating',
      templateExercise: templateEx,
    });

    // Week 2 Set 1: 120.0 kg x 5 @ RPE 8.0
    expect(calculatedSets[0].weight).toBe(120.0);
    expect(calculatedSets[0].reps).toBe(5);
    expect(calculatedSets[0].rpe).toBe(8.0);

    // Week 2 Set 2: 112.5 kg x 5 @ RPE 7.0 (-1 RPE drop)
    expect(calculatedSets[1].weight).toBe(112.5);
    expect(calculatedSets[1].reps).toBe(5);
    expect(calculatedSets[1].rpe).toBe(7.0);

    // Week 2 Set 3: 112.5 kg x 5 @ RPE 7.5 (-0.5 RPE drop)
    expect(calculatedSets[2].weight).toBe(112.5);
    expect(calculatedSets[2].reps).toBe(5);
    expect(calculatedSets[2].rpe).toBe(7.5);
  });

  it('Requirement 27: strength_linear Week 2 calculation retains 7 reps @ RPE 7.5 on Main Movement', () => {
    // Template cold start: 100 kg x 10 @ RPE 8 -> e1RM = 100 / 0.680 = 147.0588 kg
    // Week 2 Linear Profile: target reps = 7, target RPE = 7.5, intensity = 0.748
    // Target = 147.0588 * 0.748 = 109.999 kg -> rounded to 110.0 kg
    const ex: ExerciseEntry = {
      name: 'Back Squat',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 0, reps: 0, rpe: 0, form: 'standard' },
        { setNumber: 2, weight: 0, reps: 0, rpe: 0, form: 'standard' },
        { setNumber: 3, weight: 0, reps: 0, rpe: 0, form: 'standard' },
      ],
    };

    const templateEx = pristineTemplateDay1[0];

    const calculatedSets = calculateObjectiveSets({
      objective: 'Strength',
      exercise: ex,
      exerciseIndex: 0,
      totalExercises: 3,
      weekNum: 2,
      programDuration: 8,
      previousLogs: [],
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'strength_linear',
      templateExercise: templateEx,
    });

    // Week 2 Set 1: 110.0 kg x 7 @ RPE 7.5
    expect(calculatedSets[0].weight).toBe(110.0);
    expect(calculatedSets[0].reps).toBe(7);
    expect(calculatedSets[0].rpe).toBe(7.5);

    // Week 2 Set 2: 102.5 kg x 7 @ RPE 6.5
    expect(calculatedSets[1].weight).toBe(102.5);
    expect(calculatedSets[1].reps).toBe(7);
    expect(calculatedSets[1].rpe).toBe(6.5);

    // Week 2 Set 3: 102.5 kg x 7 @ RPE 7.0
    expect(calculatedSets[2].weight).toBe(102.5);
    expect(calculatedSets[2].reps).toBe(7);
    expect(calculatedSets[2].rpe).toBe(7.0);
  });

  it('Requirement 28: Strength accessory exercises remain unchanged by calculateObjectiveSets', () => {
    const accessoryEx: ExerciseEntry = {
      name: 'Romanian Deadlift',
      muscleGroup: 'Hamstrings',
      modality: 'weighted',
      isMainMovement: false,
      sets: [
        { setNumber: 1, weight: 80, reps: 10, rpe: 8, form: 'standard' },
        { setNumber: 2, weight: 80, reps: 10, rpe: 8, form: 'standard' },
      ],
    };

    const calculatedSets = calculateObjectiveSets({
      objective: 'Strength',
      exercise: accessoryEx,
      exerciseIndex: 1,
      totalExercises: 3,
      weekNum: 2,
      programDuration: 8,
      previousLogs: [],
      userTouchedSets: {},
      checkedSets: {},
      algorithmId: 'strength_undulating',
      templateExercise: pristineTemplateDay1[1],
    });

    expect(calculatedSets).toEqual(accessoryEx.sets);
  });

  it('Requirement 22 & 23: User-touched and checked sets remain protected during recalculation', () => {
    const ex: ExerciseEntry = {
      name: 'Back Squat',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 130, reps: 5, rpe: 9, form: 'standard' },
        { setNumber: 2, weight: 0, reps: 0, rpe: 0, form: 'standard' },
      ],
    };

    // User customized set 1
    const userTouchedSets = { '0-0': true };
    const checkedSets = { '0-0': true };

    const calculatedSets = calculateObjectiveSets({
      objective: 'Strength',
      exercise: ex,
      exerciseIndex: 0,
      totalExercises: 2,
      weekNum: 2,
      programDuration: 8,
      previousLogs: [],
      userTouchedSets,
      checkedSets,
      algorithmId: 'strength_undulating',
      templateExercise: pristineTemplateDay1[0],
    });

    // Set 1 preserves user values
    expect(calculatedSets[0].weight).toBe(130);
    expect(calculatedSets[0].reps).toBe(5);
    expect(calculatedSets[0].rpe).toBe(9);

    // Set 2 receives algorithm calculation (112.5 kg x 5 @ 7.0 based on 147.0588 kg baseline)
    expect(calculatedSets[1].weight).toBe(112.5);
    expect(calculatedSets[1].reps).toBe(5);
    expect(calculatedSets[1].rpe).toBe(7.0);
  });
});
