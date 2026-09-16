// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { Program, WorkoutLog } from '../../types';
import * as registryModule from '../guidedSessionExerciseRegistry';
import * as objectiveMathModule from '../objectiveMath';
import { type SessionExerciseRegistry } from '../guidedSessionExerciseRegistry';
import { classifyExercisePrescriptionLifecycle } from '../guidedWorkoutOrchestrator';

function classifySessionExerciseRegistryLockState(
  registry: SessionExerciseRegistry,
  isRedo: boolean = false
) {
  const sampleEx = { name: 'Test', muscleGroup: 'Chest', modality: 'weighted' as const, sets: [] };
  return classifyExercisePrescriptionLifecycle(sampleEx, {
    originProvenance: registry.entries[0]?.originProvenance ?? 'user_added_blank',
    isHistoricalEdit: !isRedo && registry.entries.some(e => e.originProvenance === 'historical_log_entry'),
    isRedoSession: isRedo,
    isRestoredFromDraft: false,
    evaluationState: registry.entries[0]?.evaluationState ?? { status: 'not_evaluated' },
    exerciseIndex: 0,
  });
}

vi.mock('../guidedSessionExerciseRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../guidedSessionExerciseRegistry')>();
  return {
    ...actual,
    createSessionExerciseRegistry: vi.fn(actual.createSessionExerciseRegistry),
    clearSessionExerciseRegistry: vi.fn(actual.clearSessionExerciseRegistry),
    appendSessionExerciseRegistryEntry: vi.fn(actual.appendSessionExerciseRegistryEntry),
    replaceSessionExerciseRegistryEntry: vi.fn(actual.replaceSessionExerciseRegistryEntry),
    removeSessionExerciseRegistryEntry: vi.fn(actual.removeSessionExerciseRegistryEntry),
    moveSessionExerciseRegistryEntry: vi.fn(actual.moveSessionExerciseRegistryEntry),
    markSessionExerciseStructuralMutation: vi.fn(actual.markSessionExerciseStructuralMutation),
  };
});

vi.mock('../objectiveMath', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../objectiveMath')>();
  return {
    ...actual,
    calculateObjectiveSets: vi.fn(actual.calculateObjectiveSets),
  };
});

// Mock storage
const memoryStore: Record<string, string> = {};
const mockStorage: Storage = {
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

Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
});

if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.alert = () => {};
}

describe('APC-3B2C2B2C-D2C-2B-I2B-1: WorkoutLogger Registry Ownership, Initialization, and Identity Plumbing', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
    window.confirm = () => true;
    window.alert = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const createSampleProgram = (id: string, name: string): Program => ({
    id,
    name,
    daysPerWeek: 3,
    programDuration: 8,
    createdAt: '2026-08-24T00:00:00.000Z',
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    exercisesByDay: {
      1: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8, isCompleted: false }],
        },
        {
          name: 'Incline Dumbbell Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 30, reps: 10, rpe: 8, isCompleted: false }],
        },
      ],
      2: [],
      3: [],
    },
  });

  const createSampleLog = (id: string, overrides?: Partial<WorkoutLog>): WorkoutLog => ({
    id,
    date: '2026-08-20',
    startTime: '09:00',
    programId: 'prog-1',
    program: 'Hypertrophy Foundations',
    week: '1',
    day: '1',
    unit: 'kg',
    durationMinutes: 45,
    notes: 'Initial historical notes for ' + id,
    objective: 'Hypertrophy',
    exercises: [
      {
        name: 'Barbell Squat',
        muscleGroup: 'Quads',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 120, reps: 5, rpe: 8, isCompleted: true }],
      },
      {
        name: 'Romanian Deadlift',
        muscleGroup: 'Hamstrings',
        modality: 'weighted',
        sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8, isCompleted: true }],
      },
    ],
    ...overrides,
  });

  // Test 1: Program Template Session Initialization
  it('1. program template session initializes registry with session_template_init provenance and distinct instance IDs', () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);
    const prog = createSampleProgram('prog-reg-1', 'Bench Program');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(createSpy).toHaveBeenCalled();
    const lastResult = createSpy.mock.results.at(-1)?.value as SessionExerciseRegistry;
    expect(lastResult).toBeDefined();
    expect(lastResult.entries).toHaveLength(2);
    expect(lastResult.entries[0].instanceId).toBe('session_ex_1');
    expect(lastResult.entries[0].originProvenance).toBe('session_template_init');
    expect(lastResult.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(lastResult.entries[1].instanceId).toBe('session_ex_2');
    expect(lastResult.entries[1].originProvenance).toBe('session_template_init');
    expect(lastResult.entries[1].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(lastResult.nextInstanceId).toBe(3);
  });

  // Test 2: Restored Draft Session Initialization
  it('2. restored draft session initializes registry with restored_from_draft provenance and distinct instance IDs', () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);
    const draftPayload = {
      programId: 'prog-draft-1',
      weekNum: 1,
      dayNum: 1,
      dateStr: '2026-09-02',
      workoutDate: '2026-09-02',
      startTime: '10:00',
      duration: 50,
      exercises: [
        {
          name: 'Overhead Press',
          muscleGroup: 'Shoulders',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 50, reps: 8, rpe: 8, isCompleted: false }],
        },
        {
          name: 'Lateral Raise',
          muscleGroup: 'Shoulders',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 12, reps: 12, rpe: 8, isCompleted: false }],
        },
      ],
    };
    mockStorage.setItem('metreps_workout_draft', JSON.stringify(draftPayload));

    render(
      <WorkoutLogger
        initialParams={{
          programId: 'prog-draft-1',
          week: '1',
          day: '1',
          date: '2026-09-02',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(createSpy).toHaveBeenCalled();
    const lastResult = createSpy.mock.results.at(-1)?.value as SessionExerciseRegistry;
    expect(lastResult).toBeDefined();
    expect(lastResult.entries).toHaveLength(2);
    expect(lastResult.entries[0].instanceId).toBe('session_ex_1');
    expect(lastResult.entries[0].originProvenance).toBe('restored_from_draft');
    expect(lastResult.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(lastResult.entries[1].instanceId).toBe('session_ex_2');
    expect(lastResult.entries[1].originProvenance).toBe('restored_from_draft');
    expect(lastResult.nextInstanceId).toBe(3);
  });

  // Test 3: Historical Edit Session Initialization & Lock State
  it('3. historical edit session initializes registry with historical_log_entry provenance and classifies historical_locked', () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);
    const histLog = createSampleLog('hist-edit-101');
    storage.saveWorkoutLog(histLog);

    render(
      <WorkoutLogger
        initialParams={{
          editLogId: 'hist-edit-101',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(createSpy).toHaveBeenCalled();
    const lastResult = createSpy.mock.results.at(-1)?.value as SessionExerciseRegistry;
    expect(lastResult).toBeDefined();
    expect(lastResult.entries).toHaveLength(2);
    expect(lastResult.entries[0].instanceId).toBe('session_ex_1');
    expect(lastResult.entries[0].originProvenance).toBe('historical_log_entry');
    expect(lastResult.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(lastResult.entries[1].instanceId).toBe('session_ex_2');
    expect(lastResult.entries[1].originProvenance).toBe('historical_log_entry');
    expect(lastResult.nextInstanceId).toBe(3);

    const lockState = classifySessionExerciseRegistryLockState(lastResult);
    expect(lockState).toBe('historical_locked');
  });

  // Test 4: Redo Session Initialization & Lock State
  it('4. redo session initializes registry with session_template_init provenance and classifies redo_locked', () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);
    const histLog = createSampleLog('hist-redo-201');
    storage.saveWorkoutLog(histLog);

    render(
      <WorkoutLogger
        initialParams={{
          redoFromLogId: 'hist-redo-201',
          isOneOff: true,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(createSpy).toHaveBeenCalled();
    const lastResult = createSpy.mock.results.at(-1)?.value as SessionExerciseRegistry;
    expect(lastResult).toBeDefined();
    expect(lastResult.entries).toHaveLength(2);
    expect(lastResult.entries[0].instanceId).toBe('session_ex_1');
    expect(lastResult.entries[0].originProvenance).toBe('session_template_init');
    expect(lastResult.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(lastResult.entries[1].instanceId).toBe('session_ex_2');
    expect(lastResult.entries[1].originProvenance).toBe('session_template_init');
    expect(lastResult.nextInstanceId).toBe(3);

    const lockState = classifySessionExerciseRegistryLockState(lastResult, true);
    expect(lockState).toBe('redo_locked');
  });

  // Test 5: Empty One-Off Session Initialization
  it('5. empty one-off session initializes registry with zero entries and nextInstanceId 1', () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);

    render(
      <WorkoutLogger
        initialParams={{
          isOneOff: true,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(createSpy).toHaveBeenCalled();
    const lastResult = createSpy.mock.results.at(-1)?.value as SessionExerciseRegistry;
    expect(lastResult).toBeDefined();
    expect(lastResult.entries).toHaveLength(0);
    expect(lastResult.nextInstanceId).toBe(1);
  });

  // Test 6: Fallback Program Session Initialization after effect completes
  it('6. fallback program session initializes default exercise with session_template_init provenance after effect completes', async () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);

    render(
      <WorkoutLogger
        initialParams={{
          programId: 'prog-fallback-test',
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    await waitFor(() => {
      const calls = createSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastResult = createSpy.mock.results.at(-1)?.value as SessionExerciseRegistry | undefined;
      expect(lastResult?.entries.length).toBe(1);
    });

    const lastResult = createSpy.mock.results.at(-1)?.value as SessionExerciseRegistry;
    expect(lastResult.entries).toHaveLength(1);
    expect(lastResult.entries[0].instanceId).toBe('session_ex_1');
    expect(lastResult.entries[0].originProvenance).toBe('session_template_init');
    expect(lastResult.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(lastResult.nextInstanceId).toBe(2);
  });

  // Test 7: Real Library Addition / Multi-Add
  it('7. real library addition appends registry entry with user_added_library provenance and is atomic', async () => {
    const appendSpy = vi.mocked(registryModule.appendSessionExerciseRegistryEntry);

    render(
      <WorkoutLogger
        initialParams={{
          isOneOff: true,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Open Exercise Selector Modal via real "Add Custom Exercise" button
    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    // Wait for Exercise Selector to display library exercises and click Barbell Bench Press
    const benchHeading = await screen.findByText(/^Barbell Bench Press \(flat\)$/i);
    fireEvent.click(benchHeading);

    // Click confirm button: "Add to Workout"
    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    expect(appendSpy).toHaveBeenCalledWith(expect.anything(), 'user_added_library');
    const lastResult = appendSpy.mock.results.at(-1)?.value?.registry as SessionExerciseRegistry;
    expect(lastResult).toBeDefined();
    expect(lastResult.entries).toHaveLength(1);
    expect(lastResult.entries[0].instanceId).toBe('session_ex_1');
    expect(lastResult.entries[0].originProvenance).toBe('user_added_library');
    expect(lastResult.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(lastResult.nextInstanceId).toBe(2);

    // Verify exercise is now rendered in main view
    expect(screen.getByText(/^Barbell Bench Press \(flat\)$/i)).toBeDefined();
  });

  // Test 8: Ordinary rerender preserves registry reference and IDs without reinitialization
  it('8. ordinary rerender preserves registry reference and IDs without reinitialization', () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);
    const prog = createSampleProgram('prog-rerender-1', 'Rerender Test Program');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const { rerender } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const initialRegistry = createSpy.mock.results[0].value as SessionExerciseRegistry;
    expect(initialRegistry.entries[0].instanceId).toBe('session_ex_1');
    expect(initialRegistry.entries[1].instanceId).toBe('session_ex_2');
    expect(initialRegistry.nextInstanceId).toBe(3);

    // Trigger ordinary component rerender with unchanged initialParams
    rerender(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // createSessionExerciseRegistry must NOT have been called again on rerender
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  // Test 9: Exercise Replacement via Edit Exercise
  it('9. library replacement uses user_replaced_library and allocates a fresh instance ID', async () => {
    const replaceSpy = vi.mocked(registryModule.replaceSessionExerciseRegistryEntry);
    const prog = createSampleProgram('prog-repl-1', 'Replace Test Program');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Click "Edit Exercise" on first exercise
    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    // In Exercise Selector Modal, click Deadlift
    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    // Click confirm "Replace Exercise"
    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    expect(replaceSpy).toHaveBeenCalledWith(expect.anything(), 0, 'user_replaced_library');
    const lastResult = replaceSpy.mock.results.at(-1)?.value?.registry as SessionExerciseRegistry;
    expect(lastResult).toBeDefined();
    expect(lastResult.entries).toHaveLength(2);
    expect(lastResult.entries[0].instanceId).toBe('session_ex_3');
    expect(lastResult.entries[0].originProvenance).toBe('user_replaced_library');
    expect(lastResult.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(lastResult.entries[1].instanceId).toBe('session_ex_2');
    expect(lastResult.entries[1].originProvenance).toBe('session_template_init');
    expect(lastResult.nextInstanceId).toBe(4);

    // Verify replacement exercise is displayed
    expect(screen.getByText(/^Deadlift \(conventional\)$/i)).toBeDefined();
  });

  // Test 10: Exercise Deletion with Duplicates
  it('10. deleting one duplicate exercise removes only that occurrence without renumbering', () => {
    const removeSpy = vi.mocked(registryModule.removeSessionExerciseRegistryEntry);
    const prog: Program = {
      id: 'prog-dup-del',
      name: 'Duplicate Exercise Program',
      daysPerWeek: 1,
      programDuration: 8,
      createdAt: '2026-08-24T00:00:00.000Z',
      objective: 'Hypertrophy',
      exercisesByDay: {
        1: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8, isCompleted: false }],
          },
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 80, reps: 10, rpe: 8, isCompleted: false }],
          },
        ],
      },
    };
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Open Exercise Settings modal for the first exercise
    const settingsBtns = screen.getAllByTitle('Exercise Settings');
    fireEvent.click(settingsBtns[0]);

    // Click "Remove Exercise from workout"
    const removeOptionBtn = screen.getByText(/Remove Exercise from workout/i);
    fireEvent.click(removeOptionBtn);

    // Confirm removal in confirmation modal
    const confirmRemoveBtn = screen.getByRole('button', { name: /Confirm Removal/i });
    fireEvent.click(confirmRemoveBtn);

    expect(removeSpy).toHaveBeenCalledWith(expect.anything(), 0);
    const lastResult = removeSpy.mock.results.at(-1)?.value?.registry as SessionExerciseRegistry;
    expect(lastResult).toBeDefined();
    expect(lastResult.entries).toHaveLength(1);
    // Preserves the second duplicate's exact instanceId session_ex_2
    expect(lastResult.entries[0].instanceId).toBe('session_ex_2');
    expect(lastResult.entries[0].originProvenance).toBe('session_template_init');
    expect(lastResult.nextInstanceId).toBe(3);
  });

  // Test 11: Exercise Movement
  it('11. moving an exercise calls real registry swap with matching indices and preserves instance IDs', () => {
    const moveSpy = vi.mocked(registryModule.moveSessionExerciseRegistryEntry);
    const prog = createSampleProgram('prog-move-1', 'Move Test Program');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Open Exercise Settings modal for first exercise (index 0)
    const settingsBtns = screen.getAllByTitle('Exercise Settings');
    fireEvent.click(settingsBtns[0]);

    // Click "MOVE DOWN"
    const moveDownBtn = screen.getByRole('button', { name: /MOVE DOWN/i });
    fireEvent.click(moveDownBtn);

    expect(moveSpy).toHaveBeenCalledWith(expect.anything(), 0, 1);
    const lastResult = moveSpy.mock.results.at(-1)?.value?.registry as SessionExerciseRegistry;
    expect(lastResult).toBeDefined();
    expect(lastResult.entries).toHaveLength(2);
    expect(lastResult.entries[0].instanceId).toBe('session_ex_2');
    expect(lastResult.entries[0].originProvenance).toBe('session_template_init');
    expect(lastResult.entries[1].instanceId).toBe('session_ex_1');
    expect(lastResult.entries[1].originProvenance).toBe('session_template_init');
    expect(lastResult.nextInstanceId).toBe(3);
  });

  // Test 12: Forced applied:false Rejection / Fail-Closed Protection
  it('12. forced applied:false prevents paired state mutations in multi-add and replacement', async () => {
    const appendSpy = vi.mocked(registryModule.appendSessionExerciseRegistryEntry);
    const replaceSpy = vi.mocked(registryModule.replaceSessionExerciseRegistryEntry);
    const prog = createSampleProgram('prog-failclosed-1', 'Fail Closed Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Verify initial exercises count is 2
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();
    expect(screen.getByText('Incline Dumbbell Press')).toBeDefined();

    // 1. Force applied: false on library addition
    const currentReg = registryModule.createSessionExerciseRegistry(['session_template_init', 'session_template_init']);
    appendSpy.mockReturnValueOnce({ applied: false, registry: currentReg });

    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const squatHeading = await screen.findByText(/^Back Squat \(High Bar\)$/i);
    fireEvent.click(squatHeading);

    const addConfirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(addConfirmBtn);

    expect(appendSpy).toHaveBeenCalled();
    // Squat must NOT have been added to the exercises list
    expect(screen.queryByText(/^Back Squat \(High Bar\)$/i)).toBeNull();

    // 2. Force applied: false on library replacement
    replaceSpy.mockReturnValueOnce({ applied: false, registry: currentReg });

    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    expect(replaceSpy).toHaveBeenCalled();
    // Deadlift must NOT have replaced Barbell Bench Press; original remains intact
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();
  });

  // Test 13: Cardinality Mismatch / Fail-Closed Defense
  it('13. A registry/exercise cardinality mismatch fails closed before an append: no registry append operation, no exercise addition, no userRawExercises change, and no draft mutation occur', async () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);
    const appendSpy = vi.mocked(registryModule.appendSessionExerciseRegistryEntry);
    const prog = createSampleProgram('prog-cardinality-mismatch-1', 'Cardinality Mismatch Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    // Provide a structurally valid registry whose cardinality (1 entry) deliberately
    // mismatches the program day's exercise count (2 exercises).
    const mismatchedRegistry: SessionExerciseRegistry = {
      entries: [
        {
          instanceId: 'session_ex_1',
          originProvenance: 'session_template_init',
          evaluationState: { status: 'not_evaluated' },
        },
      ],
      nextInstanceId: 2,
    };
    createSpy.mockReturnValueOnce(mismatchedRegistry);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Verify initial exercises exist in DOM
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();
    expect(screen.getByText('Incline Dumbbell Press')).toBeDefined();

    // Snapshot draft state prior to attempted library addition
    const initialDraft = mockStorage.getItem('metreps_workout_draft');

    // Reset appendSpy before user interaction
    appendSpy.mockClear();

    // Attempt real user-accessible library addition
    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const squatHeading = await screen.findByText(/^Back Squat \(High Bar\)$/i);
    fireEvent.click(squatHeading);

    const addConfirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(addConfirmBtn);

    // 1. Fail-closed: appendSessionExerciseRegistryEntry was never called
    expect(appendSpy).not.toHaveBeenCalled();

    // 2. Visible exercises remain exactly the original 2; new exercise was not added
    expect(screen.queryByText(/^Back Squat \(High Bar\)$/i)).toBeNull();
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();
    expect(screen.getByText('Incline Dumbbell Press')).toBeDefined();

    // 3. Draft was not mutated by the rejected addition
    const postDraft = mockStorage.getItem('metreps_workout_draft');
    expect(postDraft).toBe(initialDraft);
    if (postDraft) {
      const parsedDraft = JSON.parse(postDraft);
      const hasAdded = Array.isArray(parsedDraft.exercises) && parsedDraft.exercises.some((e: { name: string }) => e.name === 'Back Squat (High Bar)');
      expect(hasAdded).toBe(false);
    }
  });

  // Test 14: Working Set Addition Structural Mutation
  it('14. records set_added structural mutation when user adds a working set', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-set-add-1', 'Set Add Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    markSpy.mockClear();

    const addSetBtns = screen.getAllByRole('button', { name: /Add set 2/i });
    fireEvent.click(addSetBtns[0]);

    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'set_added'
    );
    const lastResult = markSpy.mock.results[markSpy.mock.results.length - 1].value;
    expect(lastResult.applied).toBe(true);
    expect(lastResult.registry.entries[0].structuralMutationReason).toBe('set_added');
  });

  // Test 15: Working Set Deletion Structural Mutation
  it('15. records set_deleted structural mutation when user deletes a working set', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-set-del-1', 'Set Delete Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    markSpy.mockClear();

    const setOptionsBtns = screen.getAllByTitle('Set Options');
    fireEvent.click(setOptionsBtns[0]);

    const deleteBtn = await screen.findByRole('button', { name: /DELETE SET/i });
    fireEvent.click(deleteBtn);

    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'set_deleted'
    );
    const lastResult = markSpy.mock.results[markSpy.mock.results.length - 1].value;
    expect(lastResult.applied).toBe(true);
    expect(lastResult.registry.entries[0].structuralMutationReason).toBe('set_deleted');
  });

  // Test 16: Working Set Move Structural Mutation
  it('16. records set_reordered structural mutation when user moves a working set', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog: Program = {
      id: 'prog-set-move-1',
      name: 'Set Move Test',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-08-24T00:00:00.000Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      exercisesByDay: {
        1: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: 100, reps: 8, rpe: 8, isCompleted: false },
              { setNumber: 2, weight: 105, reps: 8, rpe: 8, isCompleted: false },
            ],
          },
        ],
        2: [],
        3: [],
      },
    };
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    markSpy.mockClear();

    const setOptionsBtns = screen.getAllByTitle('Set Options');
    fireEvent.click(setOptionsBtns[0]);

    const moveDownBtn = await screen.findByRole('button', { name: /MOVE DOWN/i });
    fireEvent.click(moveDownBtn);

    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'set_reordered'
    );
    const lastResult = markSpy.mock.results[markSpy.mock.results.length - 1].value;
    expect(lastResult.applied).toBe(true);
    expect(lastResult.registry.entries[0].structuralMutationReason).toBe('set_reordered');
  });

  // Test 17: Warmup Toggle & Auto Warmup Structural Mutation
  it('17. records warmup_structure_changed structural mutation on warmup toggle and auto-warmup', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-warmup-1', 'Warmup Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    markSpy.mockClear();

    // 1. Toggle Warmup Set
    const setOptionsBtns = screen.getAllByTitle('Set Options');
    fireEvent.click(setOptionsBtns[0]);

    const warmupBtn = await screen.findByRole('button', { name: /Warmup Set/i });
    fireEvent.click(warmupBtn);

    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'warmup_structure_changed'
    );
    const lastResult = markSpy.mock.results[markSpy.mock.results.length - 1].value;
    expect(lastResult.applied).toBe(true);
    expect(lastResult.registry.entries[0].structuralMutationReason).toBe('warmup_structure_changed');
  });

  // Test 18: Drop-set Toggle & Subset Add/Edit/Remove Structural Mutation
  it('18. records drop_set_structure_changed on drop toggle and drop_subsets_changed on subset manipulations', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-dropset-1', 'DropSet Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    markSpy.mockClear();

    // 1. Toggle Drop Set
    const setOptionsBtns = screen.getAllByTitle('Set Options');
    fireEvent.click(setOptionsBtns[0]);

    const dropSetBtn = await screen.findByRole('button', { name: /Drop Set/i });
    fireEvent.click(dropSetBtn);

    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'drop_set_structure_changed'
    );

    // 2. Add drop subset
    markSpy.mockClear();
    const addDropSubBtn = await screen.findByTitle('Add another drop set');
    fireEvent.click(addDropSubBtn);

    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'drop_subsets_changed'
    );

    // 3. Remove drop subset
    markSpy.mockClear();
    const deleteDropSubBtns = await screen.findAllByTitle('Delete this drop set');
    fireEvent.click(deleteDropSubBtns[0]);

    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'drop_subsets_changed'
    );
  });

  // Test 19: Exercise-Level Properties (Rename, Superset, Main Movement) Structural Mutation
  it('19. records other_exercise_structure_changed on superset toggle and main-movement toggle', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-ex-props-1', 'Exercise Properties Test');
    prog.objective = 'Strength';
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    markSpy.mockClear();

    // 1. Toggle Main Movement
    const mainMovementCheckboxes = screen.getAllByRole('checkbox');
    const mainCheckbox = mainMovementCheckboxes[0];
    fireEvent.click(mainCheckbox);

    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'other_exercise_structure_changed'
    );

    // 2. Toggle Superset via Exercise Settings
    markSpy.mockClear();
    const exSettingsBtns = screen.getAllByTitle('Exercise Settings');
    fireEvent.click(exSettingsBtns[0]);

    const supersetBtn = await screen.findByText(/Superset with exercise below/i);
    fireEvent.click(supersetBtn);

    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'other_exercise_structure_changed'
    );
  });

  // Test 20: Non-Structural Exclusions: No Structural Mutations Recorded
  it('20. does not mark structural mutation for non-structural actions (weights, reps, RPE, comments, set skip, exercise skip)', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-non-structural-1', 'Non Structural Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    markSpy.mockClear();

    // Weight edit
    const weightInputs = screen.getAllByPlaceholderText('0');
    fireEvent.change(weightInputs[0], { target: { value: '110' } });

    // Set skip
    const setOptionsBtns = screen.getAllByTitle('Set Options');
    fireEvent.click(setOptionsBtns[0]);
    const skipSetBtn = await screen.findByRole('button', { name: /SKIP SET/i });
    fireEvent.click(skipSetBtn);

    // Exercise skip
    const exSettingsBtns = screen.getAllByTitle('Exercise Settings');
    fireEvent.click(exSettingsBtns[0]);
    const skipExBtn = await screen.findByText(/Skip Exercise This Session/i);
    fireEvent.click(skipExBtn);

    expect(markSpy).not.toHaveBeenCalled();
  });

  // Test 21: Fail-Closed Protection on Structural Mutation Rejection
  it('21. aborts paired user mutation and does not save changed draft if structural registry update returns false', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-structural-failclosed-1', 'Structural Fail Closed Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    const initialDraft = mockStorage.getItem('metreps_workout_draft');

    // Force markSessionExerciseStructuralMutation to return applied: false
    const currentReg = registryModule.createSessionExerciseRegistry(['session_template_init', 'session_template_init']);
    markSpy.mockReturnValueOnce({ applied: false, registry: currentReg });

    // Attempt to add a set on exercise 0 (currently 1 set, button says "Add set 2")
    const addSetBtns = screen.getAllByRole('button', { name: /Add set 2/i });
    fireEvent.click(addSetBtns[0]);

    // markSessionExerciseStructuralMutation was invoked
    expect(markSpy).toHaveBeenCalledWith(expect.any(Object), 0, 'set_added');

    // The set addition must have been aborted: button must still say "Add set 2", not "Add set 3"
    const remainingAddSetBtns = screen.getAllByRole('button', { name: /Add set 2/i });
    expect(remainingAddSetBtns.length).toBe(2);
    expect(screen.queryByRole('button', { name: /Add set 3/i })).toBeNull();

    // Draft was not mutated
    const postDraft = mockStorage.getItem('metreps_workout_draft');
    expect(postDraft).toBe(initialDraft);
  });

  // Test 22: Confirmed main-movement swap marks both changed exercise indices and commits the registry only after both real markings succeed
  it('22. Confirmed main-movement swap marks both changed exercise indices and commits the registry only after both real markings succeed', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-swap-main-22', 'Swap Main Test');
    prog.objective = 'Strength';
    prog.exercisesByDay[1][0].isMainMovement = true;
    prog.exercisesByDay[1][1].isMainMovement = false;
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);

    markSpy.mockClear();

    // Click unselected main movement checkbox (exercise 1) to trigger swap modal
    fireEvent.click(checkboxes[1]);

    // Confirm Swap Modal should appear
    const swapConfirmBtn = await screen.findByRole('button', { name: /^Swap$/i });
    fireEvent.click(swapConfirmBtn);

    // Both exercise 0 and exercise 1 should be marked
    expect(markSpy).toHaveBeenCalledTimes(2);
    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'other_exercise_structure_changed'
    );
    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      1,
      'other_exercise_structure_changed'
    );

    // Second call was chained on the result of the first call
    const firstResult = markSpy.mock.results[0].value;
    const secondCallFirstArg = markSpy.mock.calls[1][0];
    expect(secondCallFirstArg).toBe(firstResult.registry);

    // Checkboxes should now be swapped in the UI
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);

    // Draft was updated with swapped main movements
    const savedDraftRaw = mockStorage.getItem('metreps_workout_draft');
    expect(savedDraftRaw).not.toBeNull();
    const savedDraft = JSON.parse(savedDraftRaw!);
    expect(savedDraft.exercises[0].isMainMovement).toBe(false);
    expect(savedDraft.exercises[1].isMainMovement).toBe(true);
  });

  // Test 23: Forced failure on the second main-movement marking leaves the registry, both main-movement flags, snapshots, program metadata, and draft unchanged
  it('23. Forced failure on the second main-movement marking leaves the registry, both main-movement flags, snapshots, program metadata, and draft unchanged', async () => {
    const actual = await vi.importActual<typeof import('../guidedSessionExerciseRegistry')>('../guidedSessionExerciseRegistry');
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-swap-main-23', 'Swap Main Fail Test');
    prog.objective = 'Strength';
    prog.exercisesByDay[1][0].isMainMovement = true;
    prog.exercisesByDay[1][1].isMainMovement = false;
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    const initialDraft = mockStorage.getItem('metreps_workout_draft');
    const checkboxes = screen.getAllByRole('checkbox');
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);

    // Trigger swap modal
    fireEvent.click(checkboxes[1]);
    const swapConfirmBtn = await screen.findByRole('button', { name: /^Swap$/i });

    markSpy.mockClear();

    // Mock first call succeeding, second call failing
    let callCount = 0;
    markSpy.mockImplementation((reg, idx, reason) => {
      callCount++;
      if (callCount === 2) {
        return { applied: false, registry: reg };
      }
      return actual.markSessionExerciseStructuralMutation(reg, idx, reason);
    });

    fireEvent.click(swapConfirmBtn);

    // Both calls were attempted
    expect(markSpy).toHaveBeenCalledTimes(2);

    // State was NOT swapped: checkboxes remain in their original state
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);

    // Draft remained unchanged
    const postDraft = mockStorage.getItem('metreps_workout_draft');
    expect(postDraft).toBe(initialDraft);
  });

  // Test 24: Unchanged rename, unchanged muscle group, blocked add-set, and invalid/no-op set movement perform zero structural marking and zero draft mutation
  it('24. Unchanged rename, unchanged muscle group, blocked add-set, and invalid/no-op set movement perform zero structural marking and zero draft mutation', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-noop-24', 'No-op Guards Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    const initialDraft = mockStorage.getItem('metreps_workout_draft');
    markSpy.mockClear();

    // 1. Open Exercise Settings for Exercise 0
    const exSettingsBtns = screen.getAllByTitle('Exercise Settings');
    fireEvent.click(exSettingsBtns[0]);

    // 1a. Unchanged rename
    const renameInput = screen.getByLabelText('Rename Exercise');
    fireEvent.change(renameInput, { target: { value: 'Barbell Bench Press' } });
    expect(markSpy).not.toHaveBeenCalled();
    expect(mockStorage.getItem('metreps_workout_draft')).toBe(initialDraft);

    // 1b. Unchanged muscle group
    const muscleInput = screen.getByLabelText('Update Muscle Group');
    fireEvent.change(muscleInput, { target: { value: 'Chest' } });
    expect(markSpy).not.toHaveBeenCalled();
    expect(mockStorage.getItem('metreps_workout_draft')).toBe(initialDraft);

    // Close Exercise Settings
    const closeBtn = screen.getByRole('button', { name: /CLOSE/i });
    fireEvent.click(closeBtn);

    // 2. Blocked add-set: skip working set 0, then attempt add-set
    const setOptionsBtns = screen.getAllByTitle('Set Options');
    fireEvent.click(setOptionsBtns[0]);
    const skipBtn = await screen.findByRole('button', { name: /SKIP SET/i });
    fireEvent.click(skipBtn);

    markSpy.mockClear();
    const draftAfterSkip = mockStorage.getItem('metreps_workout_draft');

    // Attempt to add set 2 on exercise 0 while a working set is skipped
    const addSetBtns = screen.getAllByRole('button', { name: /Add set 2/i });
    fireEvent.click(addSetBtns[0]);

    // Warning is displayed, add-set blocked, no structural marking performed
    expect(screen.getByText('Restore skipped sets before adding another set.')).toBeDefined();
    expect(markSpy).not.toHaveBeenCalled();
    expect(mockStorage.getItem('metreps_workout_draft')).toBe(draftAfterSkip);

    // 3. Invalid / no-op set movement: single set cannot move up or down
    fireEvent.click(setOptionsBtns[1]); // Exercise 1, set 0
    const moveUpBtn = await screen.findByRole('button', { name: /MOVE UP/i });
    const moveDownBtn = await screen.findByRole('button', { name: /MOVE DOWN/i });
    expect((moveUpBtn as HTMLButtonElement).disabled).toBe(true);
    expect((moveDownBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(moveUpBtn);
    fireEvent.click(moveDownBtn);
    expect(markSpy).not.toHaveBeenCalled();
  });

  // Test 25: Opening/cancelling automatic warmup performs zero marking, while confirmed application records warmup_structure_changed
  it('25. Opening/cancelling automatic warmup performs zero marking, while confirmed application records warmup_structure_changed', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-warmup-25', 'Auto Warmup Confirm Test');
    // Set up with 2 sets so set 0 can be a warmup set, and set 1 can be an auto-warmup trigger
    prog.exercisesByDay[1][0].sets = [
      { setNumber: 1, weight: 60, reps: 5, rpe: 6, isWarmup: true, isCompleted: false },
      { setNumber: 2, weight: 100, reps: 8, rpe: 8, isWarmup: false, isCompleted: false },
    ];
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    markSpy.mockClear();

    // Trigger Auto Warmup on Set 1 (which is the working set, while set 0 is already a warmup set)
    const setOptionsBtns = screen.getAllByTitle('Set Options');
    fireEvent.click(setOptionsBtns[1]);

    const autoWarmupBtn = await screen.findByRole('button', { name: /Auto Warmup/i });
    fireEvent.click(autoWarmupBtn);

    // Confirmation modal should appear ("Replace existing warm-ups?")
    expect(await screen.findByText('Replace existing warm-ups?')).toBeDefined();
    expect(markSpy).not.toHaveBeenCalled();

    // Cancel the modal
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText('Replace existing warm-ups?')).toBeNull();
    expect(markSpy).not.toHaveBeenCalled();

    // Reopen and confirm
    fireEvent.click(setOptionsBtns[1]);
    const autoWarmupBtn2 = await screen.findByRole('button', { name: /Auto Warmup/i });
    fireEvent.click(autoWarmupBtn2);

    expect(await screen.findByText('Replace existing warm-ups?')).toBeDefined();
    const replaceBtn = screen.getByRole('button', { name: 'Replace' });
    fireEvent.click(replaceBtn);

    // Now warmup_structure_changed must have been recorded
    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'warmup_structure_changed'
    );
    const lastResult = markSpy.mock.results[markSpy.mock.results.length - 1].value;
    expect(lastResult.applied).toBe(true);
  });

  // Test 26: Editing drop subsets with the same values performs zero structural marking and zero draft mutation
  it('26. Editing drop subsets with the same values performs zero structural marking and zero draft mutation', async () => {
    const markSpy = vi.mocked(registryModule.markSessionExerciseStructuralMutation);
    const prog = createSampleProgram('prog-dropset-26', 'Drop Subset No-op Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Toggle Drop Set on set 0
    const setOptionsBtns = screen.getAllByTitle('Set Options');
    fireEvent.click(setOptionsBtns[0]);
    const dropSetBtn = await screen.findByRole('button', { name: /Drop Set/i });
    fireEvent.click(dropSetBtn);

    const draftWithDropSet = mockStorage.getItem('metreps_workout_draft');
    markSpy.mockClear();

    // Default drop subset is rendered with delete button
    const deleteDropBtn = await screen.findByTitle('Delete this drop set');
    const dropRow = deleteDropBtn.closest('div')!.parentElement!;
    const inputs = dropRow.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    const dropWeightInput = inputs[0];
    const dropRepsInput = inputs[1];

    const currentWeight = dropWeightInput.value;
    const currentReps = dropRepsInput.value;

    // 1. Enter same weight
    fireEvent.change(dropWeightInput, { target: { value: currentWeight } });
    expect(markSpy).not.toHaveBeenCalled();
    expect(mockStorage.getItem('metreps_workout_draft')).toBe(draftWithDropSet);

    // 2. Enter same reps
    fireEvent.change(dropRepsInput, { target: { value: currentReps } });
    expect(markSpy).not.toHaveBeenCalled();
    expect(mockStorage.getItem('metreps_workout_draft')).toBe(draftWithDropSet);

    // 3. Now enter a changed weight to verify structural mutation fires on real change
    const newWeight = String(Number(currentWeight || '0') + 5);
    fireEvent.change(dropWeightInput, { target: { value: newWeight } });
    expect(markSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entries: expect.any(Array) }),
      0,
      'drop_subsets_changed'
    );
  });

  it('27. Discarding active draft clears stored draft and prescription boundary, calls clearSessionExerciseRegistry and onClose exactly once', async () => {
    const clearSpy = vi.mocked(registryModule.clearSessionExerciseRegistry);
    const onCloseSpy = vi.fn();
    const prog = createSampleProgram('prog-discard-27', 'Discard Test Program');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={onCloseSpy}
        onSave={() => {}}
      />
    );

    // Initial mount saves a draft with prescriptionBoundary
    const draftBeforeDiscardStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftBeforeDiscardStr).not.toBeNull();
    const draftBeforeDiscard = JSON.parse(draftBeforeDiscardStr!);
    expect(draftBeforeDiscard.prescriptionBoundary).toBeDefined();

    clearSpy.mockClear();

    // Trigger discard through real UI: Cancel Workout button -> Discard & Reset confirmation
    const cancelBtn = screen.getByRole('button', { name: /Cancel Workout/i });
    fireEvent.click(cancelBtn);

    const confirmDiscardBtn = await screen.findByRole('button', { name: /Discard & Reset/i });
    fireEvent.click(confirmDiscardBtn);

    // 1. Stored active draft is cleared
    expect(mockStorage.getItem('metreps_workout_draft')).toBeNull();

    // 2. clearSessionExerciseRegistry is called exactly once
    expect(clearSpy).toHaveBeenCalledTimes(1);

    // 3. onClose is called exactly once after cleanup
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('28. Discard performs no exercise reconstruction, objective-target calculation, replacement registry creation, or post-discard draft write', async () => {
    const calcSpy = vi.mocked(objectiveMathModule.calculateObjectiveSets);
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);
    const clearSpy = vi.mocked(registryModule.clearSessionExerciseRegistry);
    const prog = createSampleProgram('prog-discard-28', 'Discard No-Reconstruct Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Clear spies after mount initialization has completed
    calcSpy.mockClear();
    createSpy.mockClear();
    clearSpy.mockClear();

    const cancelBtn = screen.getByRole('button', { name: /Cancel Workout/i });
    fireEvent.click(cancelBtn);

    const confirmDiscardBtn = await screen.findByRole('button', { name: /Discard & Reset/i });
    fireEvent.click(confirmDiscardBtn);

    // No objective calculations executed during discard
    expect(calcSpy).not.toHaveBeenCalled();

    // No replacement registry created during discard
    expect(createSpy).not.toHaveBeenCalled();

    // Registry cleared exactly once
    expect(clearSpy).toHaveBeenCalledTimes(1);

    // No post-discard draft written
    expect(mockStorage.getItem('metreps_workout_draft')).toBeNull();
  });

  it('29. Pending autosave and unmount flush cannot recreate the discarded draft', async () => {
    const prog = createSampleProgram('prog-discard-29', 'Discard Flush Suppression Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const { unmount } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(mockStorage.getItem('metreps_workout_draft')).not.toBeNull();

    const cancelBtn = screen.getByRole('button', { name: /Cancel Workout/i });
    fireEvent.click(cancelBtn);

    const confirmDiscardBtn = await screen.findByRole('button', { name: /Discard & Reset/i });
    fireEvent.click(confirmDiscardBtn);

    expect(mockStorage.getItem('metreps_workout_draft')).toBeNull();

    // Simulate pagehide and visibilitychange events that normally flush latest draft
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));

    // Unmount component
    unmount();

    // Ensure draft was never recreated
    expect(mockStorage.getItem('metreps_workout_draft')).toBeNull();
  });

  it('30. A subsequent fresh mount still initializes exactly one correct fresh registry through the normal load effect', async () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);
    const clearSpy = vi.mocked(registryModule.clearSessionExerciseRegistry);
    const prog = createSampleProgram('prog-discard-30', 'Fresh Mount After Discard Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    // Mount and then discard session 1
    const { unmount } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel Workout/i });
    fireEvent.click(cancelBtn);
    const confirmDiscardBtn = await screen.findByRole('button', { name: /Discard & Reset/i });
    fireEvent.click(confirmDiscardBtn);
    unmount();

    expect(mockStorage.getItem('metreps_workout_draft')).toBeNull();
    createSpy.mockClear();
    clearSpy.mockClear();

    // Mount fresh session
    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-02',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Fresh mount calls createSessionExerciseRegistry exactly once
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(['session_template_init', 'session_template_init']);
    expect(clearSpy).not.toHaveBeenCalled();

    // Fresh mount establishes a fresh draft
    const freshDraftStr = mockStorage.getItem('metreps_workout_draft');
    expect(freshDraftStr).not.toBeNull();
    const freshDraft = JSON.parse(freshDraftStr!);
    expect(freshDraft.exercises.length).toBe(2);
  });

  it('31. A successful workout save persists the completed log before clearSessionExerciseRegistry is called and clears registry exactly once', async () => {
    const clearSpy = vi.mocked(registryModule.clearSessionExerciseRegistry);
    const onCloseSpy = vi.fn();
    const onSaveSpy = vi.fn();
    const prog = createSampleProgram('prog-save-31', 'Save Order Test Program');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const callOrder: string[] = [];
    const origSaveWorkoutLog = storage.saveWorkoutLog.bind(storage);
    const saveSpy = vi.spyOn(storage, 'saveWorkoutLog').mockImplementation((log) => {
      callOrder.push('saveWorkoutLog');
      return origSaveWorkoutLog(log);
    });

    clearSpy.mockImplementation(() => {
      callOrder.push('clearSessionExerciseRegistry');
      return {
        version: 1,
        entries: [],
        nextInstanceId: 1,
      };
    });

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={onCloseSpy}
        onSave={onSaveSpy}
      />
    );

    clearSpy.mockClear();
    callOrder.length = 0;

    const saveBtn = screen.getByRole('button', { name: /Save Workout Log/i });
    fireEvent.click(saveBtn);

    // 1. Completed-log persistence happens before clearSessionExerciseRegistry
    expect(callOrder).toEqual(['saveWorkoutLog', 'clearSessionExerciseRegistry']);

    // 2. Clear called exactly once
    expect(clearSpy).toHaveBeenCalledTimes(1);

    // 3. onSave callback called
    expect(onSaveSpy).toHaveBeenCalledTimes(1);

    saveSpy.mockRestore();
  });

  it('32. The saved workout-log object contains no registry data, registry entry, instance ID, nextInstanceId, or registry version', async () => {
    const prog = createSampleProgram('prog-save-32', 'Clean Log Payload Program');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    const saveBtn = screen.getByRole('button', { name: /Save Workout Log/i });
    fireEvent.click(saveBtn);

    const savedLogs = storage.getWorkoutLogs();
    const savedLog = savedLogs.find(l => l.programId === prog.id);
    expect(savedLog).toBeDefined();
    const logObj = savedLog as any;

    // Verify top-level log object contains no registry fields
    expect(logObj.registry).toBeUndefined();
    expect(logObj.sessionExerciseRegistry).toBeUndefined();
    expect(logObj.entries).toBeUndefined();
    expect(logObj.instanceId).toBeUndefined();
    expect(logObj.nextInstanceId).toBeUndefined();
    expect(logObj.version).toBeUndefined();

    // Verify exercise objects contain no registry fields
    for (const ex of logObj.exercises) {
      expect((ex as any).instanceId).toBeUndefined();
      expect((ex as any).originProvenance).toBeUndefined();
      expect((ex as any).evaluationState).toBeUndefined();
      expect((ex as any).structuralMutationHistory).toBeUndefined();
    }

    const logJson = JSON.stringify(logObj);
    expect(logJson).not.toContain('session_ex_');
    expect(logJson).not.toContain('nextInstanceId');
    expect(logJson).not.toContain('originProvenance');
    expect(logJson).not.toContain('evaluationState');
  });

  it('33. The active draft is removed on successful save and cannot be recreated by pending autosave or unmount flushing', async () => {
    const prog = createSampleProgram('prog-save-33', 'Save Draft Cleanup Test');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const { unmount } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(mockStorage.getItem('metreps_workout_draft')).not.toBeNull();

    const saveBtn = screen.getByRole('button', { name: /Save Workout Log/i });
    fireEvent.click(saveBtn);

    // Active draft is removed
    expect(mockStorage.getItem('metreps_workout_draft')).toBeNull();

    // Trigger pagehide and visibilitychange flushes
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));

    // Unmount
    unmount();

    // Draft remains null
    expect(mockStorage.getItem('metreps_workout_draft')).toBeNull();
  });

  it('34. A forced workout-log persistence failure performs zero registry clearing, does not call onSave, and leaves the active draft recoverable', async () => {
    const clearSpy = vi.mocked(registryModule.clearSessionExerciseRegistry);
    const onSaveSpy = vi.fn();
    const prog = createSampleProgram('prog-save-34', 'Failed Save Test Program');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const saveSpy = vi.spyOn(storage, 'saveWorkoutLog').mockImplementationOnce(() => {
      throw new Error('Simulated storage write error');
    });

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={onSaveSpy}
      />
    );

    clearSpy.mockClear();

    // Active draft must exist before attempting save
    expect(mockStorage.getItem('metreps_workout_draft')).not.toBeNull();

    const saveBtn = screen.getByRole('button', { name: /Save Workout Log/i });
    fireEvent.click(saveBtn);

    // saveWorkoutLog was attempted and threw
    expect(saveSpy).toHaveBeenCalledTimes(1);

    // Registry was NOT cleared
    expect(clearSpy).not.toHaveBeenCalled();

    // onSave was NOT called
    expect(onSaveSpy).not.toHaveBeenCalled();

    // Active draft remains in storage, untouched and recoverable
    const draftAfterFailedSaveStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftAfterFailedSaveStr).not.toBeNull();
    const parsedDraft = JSON.parse(draftAfterFailedSaveStr!);
    expect(parsedDraft.exercises.length).toBe(2);

    saveSpy.mockRestore();
  });

  it('35. A subsequent fresh mount after a successful save initializes exactly one correct fresh registry through the normal load effect', async () => {
    const createSpy = vi.mocked(registryModule.createSessionExerciseRegistry);
    const clearSpy = vi.mocked(registryModule.clearSessionExerciseRegistry);
    const prog = createSampleProgram('prog-save-35', 'Fresh Mount After Save Program');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    // Mount and save session 1
    const { unmount } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-01',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    const saveBtn = screen.getByRole('button', { name: /Save Workout Log/i });
    fireEvent.click(saveBtn);
    unmount();

    expect(mockStorage.getItem('metreps_workout_draft')).toBeNull();
    createSpy.mockClear();
    clearSpy.mockClear();

    // Mount fresh session
    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-09-02',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Fresh mount calls createSessionExerciseRegistry exactly once
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(['session_template_init', 'session_template_init']);
    expect(clearSpy).not.toHaveBeenCalled();

    // Fresh mount establishes fresh draft
    const freshDraftStr = mockStorage.getItem('metreps_workout_draft');
    expect(freshDraftStr).not.toBeNull();
    const freshDraft = JSON.parse(freshDraftStr!);
    expect(freshDraft.exercises.length).toBe(2);
  });
});
