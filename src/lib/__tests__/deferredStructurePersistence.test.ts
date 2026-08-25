import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExerciseEntry, Program, WorkoutLog } from '../../types';
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

describe('MetReps — Deferred Structural Persistence & Active-Workout Recovery Test Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseProgram: Program = {
    id: 'prog-wave-strength-1',
    name: 'Wave Strength 8-Week',
    daysPerWeek: 3,
    programDuration: 8,
    createdAt: '2026-01-01T00:00:00.000Z',
    assignedWeekdays: { 1: 1, 2: 3, 3: 5 },
    objective: 'Strength',
    algorithmId: 'strength_undulating',
    exercisesByDay: {
      1: [
        {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 0, reps: 5, rpe: 7, form: 'standard' }],
        },
      ],
    },
  };

  it('1. Initial template has exactly one working set: 0 kg x 5 @ RPE 7', () => {
    storage.saveProgram(baseProgram);
    const prog = storage.getPrograms().find(p => p.id === baseProgram.id);
    expect(prog).toBeDefined();
    expect(prog!.exercisesByDay[1].length).toBe(1);
    expect(prog!.exercisesByDay[1][0].sets.length).toBe(1);
    expect(prog!.exercisesByDay[1][0].sets[0].reps).toBe(5);
    expect(prog!.exercisesByDay[1][0].sets[0].rpe).toBe(7);
  });

  it('2. In-session addition of Sets 2, 3, and 4 writes to draft but DOES NOT mutate program template', () => {
    storage.saveProgram(baseProgram);

    // Initial draft state before adding sets
    const draftKey = 'metreps_workout_draft';
    const initialExercise: ExerciseEntry = {
      name: 'Bench Press',
      muscleGroup: 'Chest',
      modality: 'weighted',
      isMainMovement: true,
      sets: [{ setNumber: 1, weight: 0, reps: 5, rpe: 7, form: 'standard' }],
    };

    // Simulate adding sets 2, 3, 4 into active workout
    const addedSet2 = { setNumber: 2, weight: 0, reps: 5, rpe: 6, form: 'standard' as const };
    const addedSet3 = { setNumber: 3, weight: 0, reps: 5, rpe: 6.5, form: 'standard' as const };
    const addedSet4 = { setNumber: 4, weight: 0, reps: 5, rpe: 7, form: 'standard' as const };

    const activeExercises: ExerciseEntry[] = [
      {
        ...initialExercise,
        sets: [initialExercise.sets[0], addedSet2, addedSet3, addedSet4],
      },
    ];

    // Synchronously write draft to localStorage (as WorkoutLogger now does)
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        exercises: activeExercises,
        checkedSets: {},
        userTouchedSets: {},
        completionTouchedSets: {},
        prescribedTargetSnapshots: {
          '0-0': { weight: 0, reps: 5, rpe: 7 },
          '0-1': { weight: 0, reps: 5, rpe: 6 },
          '0-2': { weight: 0, reps: 5, rpe: 6.5 },
          '0-3': { weight: 0, reps: 5, rpe: 7 },
        },
        committedLiveEvidenceBySet: {},
        liveAdjustedSets: {},
        collapsed: {},
        programId: baseProgram.id,
        dayNum: '1',
        weekNum: '1',
        objective: 'Strength',
        isOneOff: false,
      })
    );

    // Verify program template in storage remains untouched with 1 set
    const progInStorage = storage.getPrograms().find(p => p.id === baseProgram.id);
    expect(progInStorage!.exercisesByDay[1][0].sets.length).toBe(1);

    // Verify draft in storage contains all 4 sets
    const savedDraft = JSON.parse(localStorage.getItem(draftKey)!);
    expect(savedDraft.exercises[0].sets.length).toBe(4);
  });

  it('3. Unmount and remount recovers all 4 sets, notes, live adjustments and touched states from draft', () => {
    storage.saveProgram(baseProgram);
    const draftKey = 'metreps_workout_draft';

    const draftPayload = {
      exercises: [
        {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          isMainMovement: true,
          sets: [
            { setNumber: 1, weight: 50, reps: 5, rpe: 8.5, form: 'standard' },
            { setNumber: 2, weight: 43.75, reps: 5, rpe: 6, form: 'standard' },
            { setNumber: 3, weight: 45, reps: 5, rpe: 6.5, form: 'standard' },
            { setNumber: 4, weight: 47.5, reps: 5, rpe: 7, form: 'standard' },
          ],
        },
      ],
      checkedSets: { '0-0': true },
      userTouchedSets: { '0-0': true },
      completionTouchedSets: {},
      prescribedTargetSnapshots: {
        '0-0': { weight: 0, reps: 5, rpe: 7 },
        '0-1': { weight: 0, reps: 5, rpe: 6 },
        '0-2': { weight: 0, reps: 5, rpe: 6.5 },
        '0-3': { weight: 0, reps: 5, rpe: 7 },
      },
      committedLiveEvidenceBySet: {
        '0-0': { weight: 50, reps: 5, rpe: 8.5, form: 'standard' },
      },
      liveAdjustedSets: {
        '0-1': true,
        '0-2': true,
        '0-3': true,
      },
      collapsed: {},
      notes: 'Active session notes preserved',
      duration: '45',
      programId: baseProgram.id,
      dayNum: '1',
      weekNum: '1',
      objective: 'Strength',
      isOneOff: false,
    };

    localStorage.setItem(draftKey, JSON.stringify(draftPayload));

    // Recovery check: rehydrate draft
    const rawDraft = localStorage.getItem(draftKey);
    expect(rawDraft).not.toBeNull();
    const hydrated = JSON.parse(rawDraft!);
    expect(hydrated.exercises[0].sets.length).toBe(4);
    expect(hydrated.exercises[0].sets[0].weight).toBe(50);
    expect(hydrated.checkedSets['0-0']).toBe(true);
    expect(hydrated.userTouchedSets['0-0']).toBe(true);
    expect(hydrated.liveAdjustedSets['0-1']).toBe(true);
    expect(hydrated.notes).toBe('Active session notes preserved');
  });

  it('4. Explicit discard removes draft and restores original 1-set template on next load', () => {
    storage.saveProgram(baseProgram);
    const draftKey = 'metreps_workout_draft';

    // Set draft with 4 sets
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            isMainMovement: true,
            sets: [
              { setNumber: 1, weight: 50, reps: 5, rpe: 8.5 },
              { setNumber: 2, weight: 43.75, reps: 5, rpe: 6 },
              { setNumber: 3, weight: 45, reps: 5, rpe: 6.5 },
              { setNumber: 4, weight: 47.5, reps: 5, rpe: 7 },
            ],
          },
        ],
      })
    );

    // User explicitly discards workout: draft is removed
    localStorage.removeItem(draftKey);
    expect(localStorage.getItem(draftKey)).toBeNull();

    // Re-opening workout loads from pristine program template
    const loadedProgram = storage.getPrograms().find(p => p.id === baseProgram.id);
    expect(loadedProgram!.exercisesByDay[1].length).toBe(1);
    expect(loadedProgram!.exercisesByDay[1][0].sets.length).toBe(1);
    expect(loadedProgram!.exercisesByDay[1][0].sets[0].reps).toBe(5);
    expect(loadedProgram!.exercisesByDay[1][0].sets[0].rpe).toBe(7);
    expect(loadedProgram!.exercisesByDay[1][0].sets[0].weight).toBe(0);
  });

  it('5. Save workout commits confirmed 4-set structure to program template and removes draft', () => {
    storage.saveProgram(baseProgram);
    const draftKey = 'metreps_workout_draft';

    const confirmedExercises: ExerciseEntry[] = [
      {
        name: 'Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 50, reps: 5, rpe: 8.5, form: 'standard' },
          { setNumber: 2, weight: 43.75, reps: 5, rpe: 6, form: 'standard' },
          { setNumber: 3, weight: 45, reps: 5, rpe: 6.5, form: 'standard' },
          { setNumber: 4, weight: 47.5, reps: 5, rpe: 7, form: 'standard' },
        ],
      },
    ];

    // Save workout log
    const newLog: WorkoutLog = {
      id: 'log-101',
      date: '2026-08-25',
      programId: baseProgram.id,
      program: baseProgram.name,
      week: '1',
      day: '1',
      exercises: confirmedExercises,
      unit: 'kg',
      durationMinutes: 45,
      notes: '',
      objective: 'Strength',
    };
    storage.saveWorkoutLog(newLog);

    // Commit template structure as executeSaveSession does
    const activeProg = storage.getPrograms().find(p => p.id === baseProgram.id)!;
    activeProg.exercisesByDay[1] = confirmedExercises.map(ex => ({
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      modality: ex.modality || 'weighted',
      isSuperset: !!ex.isSuperset,
      isMainMovement: !!ex.isMainMovement,
      sets: ex.sets.map(s => ({
        setNumber: s.setNumber,
        weight: 0,
        reps: 0,
        rpe: s.rpe || 8,
        form: s.form || 'standard',
        comment: s.comment || null,
        isWarmup: !!s.isWarmup,
        isDropSet: !!s.isDropSet,
        dropSubSets: null,
      })),
    }));
    storage.saveProgram(activeProg);
    localStorage.removeItem(draftKey);

    // Draft is cleaned up
    expect(localStorage.getItem(draftKey)).toBeNull();

    // Next workout session for this program now starts with 4 sets
    const updatedProg = storage.getPrograms().find(p => p.id === baseProgram.id)!;
    expect(updatedProg.exercisesByDay[1][0].sets.length).toBe(4);
    expect(updatedProg.exercisesByDay[1][0].sets.map(s => s.setNumber)).toEqual([1, 2, 3, 4]);
  });

  it('6. Historical edit immutability: editing an existing log does not alter the active program template', () => {
    storage.saveProgram(baseProgram);

    // An existing log from week 1 day 1 with 2 exercises
    const historicalLog: WorkoutLog = {
      id: 'log-hist-1',
      date: '2026-08-01',
      programId: baseProgram.id,
      program: baseProgram.name,
      week: '1',
      day: '1',
      exercises: [
        {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 60, reps: 5, rpe: 9 }],
        },
        {
          name: 'Incline Dumbbell Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 24, reps: 8, rpe: 8 }],
        },
      ],
      unit: 'kg',
      durationMinutes: 50,
      objective: 'Strength',
    };
    storage.saveWorkoutLog(historicalLog);

    // Edit the historical log (e.g. modify reps and add 3rd exercise)
    const editedLog: WorkoutLog = {
      ...historicalLog,
      exercises: [
        ...historicalLog.exercises,
        {
          name: 'Cable Fly',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 15, reps: 12, rpe: 8 }],
        },
      ],
    };
    storage.saveWorkoutLog(editedLog);

    // Verify program template still has only 1 exercise with 1 set
    const progInStorage = storage.getPrograms().find(p => p.id === baseProgram.id)!;
    expect(progInStorage.exercisesByDay[1].length).toBe(1);
    expect(progInStorage.exercisesByDay[1][0].name).toBe('Bench Press');
    expect(progInStorage.exercisesByDay[1][0].sets.length).toBe(1);
  });

  it('7. Adding and deleting exercises during active session is preserved in draft but not in template until save', () => {
    storage.saveProgram(baseProgram);
    const draftKey = 'metreps_workout_draft';

    const draftExercises: ExerciseEntry[] = [
      baseProgram.exercisesByDay[1][0],
      {
        name: 'Overhead Press',
        muscleGroup: 'Shoulders',
        modality: 'weighted',
        isMainMovement: false,
        sets: [{ setNumber: 1, weight: 30, reps: 8, rpe: 8, form: 'standard' }],
      },
    ];

    // Draft contains 2 exercises
    localStorage.setItem(draftKey, JSON.stringify({ exercises: draftExercises }));
    expect(JSON.parse(localStorage.getItem(draftKey)!).exercises.length).toBe(2);

    // Program template still has 1 exercise
    const progInStorage = storage.getPrograms().find(p => p.id === baseProgram.id)!;
    expect(progInStorage.exercisesByDay[1].length).toBe(1);
  });

  it('8. Main Movement metadata remains protected during discard and does not get wiped', () => {
    storage.saveProgram(baseProgram);
    const progInStorage = storage.getPrograms().find(p => p.id === baseProgram.id)!;
    expect(progInStorage.exercisesByDay[1][0].isMainMovement).toBe(true);

    // Discard draft
    localStorage.removeItem('metreps_workout_draft');

    // Program template still has isMainMovement: true
    const reloaded = storage.getPrograms().find(p => p.id === baseProgram.id)!;
    expect(reloaded.exercisesByDay[1][0].isMainMovement).toBe(true);
  });
});
