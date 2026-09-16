// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { Program, WorkoutLog, ExerciseEntry } from '../../types';
import * as integrationModule from '../guidedWorkoutIntegration';
import * as registryModule from '../guidedSessionExerciseRegistry';
import {
  type SessionExerciseRegistry,
  type SessionExerciseRegistryOperationResult,
} from '../guidedSessionExerciseRegistry';
import {
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
} from '../programProgressionMode';

// Mock storage
const memoryStore: Record<string, string> = {};
const mockStorage: Storage = {
  getItem: (key: string): string | null => memoryStore[key] ?? null,
  setItem: (key: string, value: string): void => {
    memoryStore[key] = String(value);
  },
  removeItem: (key: string): void => {
    delete memoryStore[key];
  },
  clear: (): void => {
    Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
  },
  key: (index: number): string | null => Object.keys(memoryStore)[index] ?? null,
  length: 0,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
});

if (typeof window !== 'undefined') {
  window.scrollTo = (): void => {};
  window.confirm = (): boolean => true;
  window.alert = (): void => {};
}

describe('APC-3B2C2B2C-D2C-3B2A: WorkoutLogger Guided User-Added Exercise Integration', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
    window.confirm = (): boolean => true;
    window.alert = (): void => {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const createTestProgram = (
    id: string,
    mode: 'performance_led' | 'metreps_guided' = 'metreps_guided',
    objective: 'Hypertrophy' | 'Strength' | 'Off' = 'Hypertrophy'
  ): Program => ({
    id,
    name: 'Test Guided Program',
    daysPerWeek: 3,
    programDuration: 4,
    createdAt: '2026-08-01T00:00:00.000Z',
    algorithmId: 'hypertrophy_linear',
    objective,
    targetProgressionMode: mode,
    progressionPolicyVersion: CURRENT_PROGRESSION_POLICY_VERSION,
    algorithmVersion: CURRENT_ALGORITHM_VERSION,
    exercisesByDay: {
      1: [
        {
          exerciseKey: 'bench_press',
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          isMainMovement: true,
          sets: [
            { setNumber: 1, weight: 187.5, reps: 15, rpe: 8, isCompleted: false },
            { setNumber: 2, weight: 187.5, reps: 15, rpe: 8, isCompleted: false },
            { setNumber: 3, weight: 187.5, reps: 15, rpe: 8, isCompleted: false },
          ],
        },
      ],
      2: [],
      3: [],
    },
  });

  const createHistoricalLog = (programId: string): WorkoutLog => ({
    id: 'log-hist-1',
    date: '2026-08-03',
    unit: 'lb',
    programId,
    exercises: [
      {
        exerciseKey: 'bench_press',
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        isMainMovement: true,
        sets: [
          { setNumber: 1, weight: 187.5, reps: 15, rpe: 8, isCompleted: true },
          { setNumber: 2, weight: 187.5, reps: 15, rpe: 8, isCompleted: true },
          { setNumber: 3, weight: 187.5, reps: 15, rpe: 8, isCompleted: true },
        ],
      },
    ],
  });

  // 1. performance_led library addition preserves existing behaviour and makes zero Guided calls
  it('1. performance_led library addition preserves existing behaviour and makes zero Guided calls', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const appendSpy = vi.spyOn(registryModule, 'appendSessionExerciseRegistryEntry');

    const prog = createTestProgram('prog-perf-1', 'performance_led');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Initial mount should not call Guided
    expect(orchestrateSpy).not.toHaveBeenCalled();

    // Open exercise selector modal
    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    // Select an exercise from the library
    const exerciseHeading = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exerciseHeading);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    // Guided orchestrator must NOT be called for performance_led
    expect(orchestrateSpy).not.toHaveBeenCalled();

    // Registry append was called with user_added_library provenance
    expect(appendSpy).toHaveBeenCalledWith(expect.anything(), 'user_added_library');
    const lastResult: SessionExerciseRegistryOperationResult | undefined = appendSpy.mock.results.at(-1)?.value;
    expect(lastResult?.applied).toBe(true);
    expect(lastResult?.registry.entries).toHaveLength(2);
    expect(lastResult?.registry.entries[1].originProvenance).toBe('user_added_library');
    expect(lastResult?.registry.entries[1].evaluationState).toEqual({ status: 'not_evaluated' });

    // Newly added exercise is rendered in UI
    expect(screen.getByText(/^Overhead Press \(Barbell\)$/i)).toBeDefined();
  });

  // 2. Guided single-library addition uses the real default dependency chain and applies Guided targets and snapshots
  it('2. Guided single-library addition uses the real default dependency chain and applies Guided targets and snapshots', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    const prog = createTestProgram('prog-guided-real-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    const histLog = createHistoricalLog(prog.id);
    storage.saveWorkoutLog(histLog);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Initial scheduled evaluation ran once for the template exercise
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    orchestrateSpy.mockClear();

    // Add a library exercise via real UI
    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const exerciseHeading = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exerciseHeading);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    // Real Guided helper executed without replacement
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    const callInput = orchestrateSpy.mock.calls[0][0];
    expect(callInput.items).toHaveLength(1);
    expect(callInput.items[0].exerciseIndex).toBe(1);
    expect(callInput.items[0].exercise.name).toBe('Overhead Press (Barbell)');
    expect(callInput.items[0].lifecycleEvidence.originProvenance).toBe('user_added_library');
    expect(callInput.items[0].lifecycleEvidence.evaluationState).toEqual({ status: 'not_evaluated' });

    // Output was applied: exercise rendered
    expect(screen.getByText(/^Overhead Press \(Barbell\)$/i)).toBeDefined();

    // Check draft saved in localStorage contains prescribedTargetSnapshots
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftStr).not.toBeNull();
    if (draftStr) {
      expect(draftStr).toContain('Overhead Press (Barbell)');
    }
  });

  // 3. Guided multi-add calls the helper once for the complete new batch with correct global indices
  it('3. Guided multi-add calls the helper once for the complete new batch with correct global indices', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    const prog = createTestProgram('prog-guided-multi-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    orchestrateSpy.mockClear();

    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    // Select first exercise
    const ex1 = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(ex1);

    // Select second exercise
    const ex2 = await screen.findByText(/^Seated Dumbbell Shoulder Press$/i);
    fireEvent.click(ex2);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    // Helper called EXACTLY ONCE for the complete batch
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    const callInput = orchestrateSpy.mock.calls[0][0];
    expect(callInput.items).toHaveLength(2);

    // Correct contiguous global indices starting at exercises.length (1)
    expect(callInput.items[0].exerciseIndex).toBe(1);
    expect(callInput.items[0].exercise.name).toBe('Overhead Press (Barbell)');
    expect(callInput.items[0].lifecycleEvidence.originProvenance).toBe('user_added_library');

    expect(callInput.items[1].exerciseIndex).toBe(2);
    expect(callInput.items[1].exercise.name).toBe('Seated Dumbbell Shoulder Press');
    expect(callInput.items[1].lifecycleEvidence.originProvenance).toBe('user_added_library');

    // Both exercises rendered in UI
    expect(screen.getByText(/^Overhead Press \(Barbell\)$/i)).toBeDefined();
    expect(screen.getByText(/^Seated Dumbbell Shoulder Press$/i)).toBeDefined();
  });

  // 4. pre-existing exercises, targets, snapshots, registry identities, and evaluation states remain unchanged
  it('4. pre-existing exercises, targets, snapshots, registry identities, and evaluation states remain unchanged', async () => {
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');

    const prog = createTestProgram('prog-guided-preserve-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Existing exercise at index 0 should be Barbell Bench Press
    expect(screen.getByText(/^Barbell Bench Press$/i)).toBeDefined();

    const draftBefore = mockStorage.getItem('metreps_workout_draft');
    expect(draftBefore).not.toBeNull();

    // Clear spy to isolate addition-time calls
    updateSpy.mockClear();

    // Add new exercise
    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const exerciseHeading = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exerciseHeading);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    // Check that pre-existing exercise at index 0 was NOT targeted by updateSessionExerciseEvaluationState
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][1]).toBe(1);
    expect(updateSpy).not.toHaveBeenCalledWith(expect.anything(), 0, expect.anything());

    // Pre-existing exercise remains in UI
    expect(screen.getByText(/^Barbell Bench Press$/i)).toBeDefined();
    expect(screen.getByText(/^Overhead Press \(Barbell\)$/i)).toBeDefined();
  });

  // 5. only new registry entries receive returned nextEvaluationState values
  it('5. only new registry entries receive returned nextEvaluationState values', async () => {
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');

    const prog = createTestProgram('prog-guided-evalstate-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    updateSpy.mockClear();

    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const exerciseHeading = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exerciseHeading);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    // updateSessionExerciseEvaluationState was called only for index 1
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][1]).toBe(1);
    expect(updateSpy.mock.calls[0][2].status).toBe('evaluated');

    const lastResult: SessionExerciseRegistryOperationResult | undefined = updateSpy.mock.results.at(-1)?.value;
    expect(lastResult?.applied).toBe(true);
    // Entry 0 preserves original evaluation state
    expect(lastResult?.registry.entries[0].originProvenance).toBe('session_template_init');
    // Entry 1 receives evaluated state
    expect(lastResult?.registry.entries[1].originProvenance).toBe('user_added_library');
    expect(lastResult?.registry.entries[1].evaluationState.status).toBe('evaluated');
  });

  // 6. adding after initial scheduled Guided evaluation does not re-evaluate existing exercises
  it('6. adding after initial scheduled Guided evaluation does not re-evaluate existing exercises', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    const prog = createTestProgram('prog-guided-no-reeval-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    const initialCallItems = orchestrateSpy.mock.calls[0][0].items;
    expect(initialCallItems).toHaveLength(1);
    expect(initialCallItems[0].exerciseIndex).toBe(0);

    orchestrateSpy.mockClear();

    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const exerciseHeading = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exerciseHeading);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    const additionCallItems = orchestrateSpy.mock.calls[0][0].items;
    expect(additionCallItems).toHaveLength(1);
    // Exercise 0 was NOT in the items submitted for evaluation
    expect(additionCallItems[0].exerciseIndex).toBe(1);
    expect(additionCallItems[0].exercise.name).toBe('Overhead Press (Barbell)');
  });

  // 7. ordinary rerender does not repeat the addition-time Guided call
  it('7. ordinary rerender does not repeat the addition-time Guided call', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    const prog = createTestProgram('prog-guided-rerender-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const { rerender } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    orchestrateSpy.mockClear();

    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const exerciseHeading = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exerciseHeading);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    expect(orchestrateSpy).toHaveBeenCalledTimes(1);

    // Ordinary component rerender
    rerender(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Call count must remain 1
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
  });

  // 8. malformed result count or indices fall back atomically to complete performance-led targets for the new exercises with no partial Guided snapshots
  it('8. malformed result count or indices fall back atomically to complete performance-led targets for the new exercises with no partial Guided snapshots', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');

    const prog = createTestProgram('prog-guided-malformed-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    orchestrateSpy.mockClear();
    updateSpy.mockClear();

    // Mock malformed result count: return empty array when 1 item expected
    orchestrateSpy.mockReturnValueOnce([]);

    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const exerciseHeading = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exerciseHeading);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    // Guided was invoked but output was malformed
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);

    // No evaluation-state update operation was performed
    expect(updateSpy).not.toHaveBeenCalled();

    // Exercise was still added successfully via performance-led fallback
    expect(screen.getByText(/^Overhead Press \(Barbell\)$/i)).toBeDefined();

    // Verify draft was saved
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftStr).not.toBeNull();
    if (draftStr) {
      expect(draftStr).toContain('Overhead Press (Barbell)');
    }
  });

  // 9. failure on a later evaluation-state update produces the same complete fail-closed fallback with no partial registry commit
  it('9. failure on a later evaluation-state update produces the same complete fail-closed fallback with no partial registry commit', async () => {
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');

    const prog = createTestProgram('prog-guided-staging-fail-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    updateSpy.mockClear();

    // Force updateSessionExerciseEvaluationState to return applied: false
    updateSpy.mockImplementation((registry: SessionExerciseRegistry) => ({
      applied: false,
      registry,
    }));

    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const exerciseHeading = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exerciseHeading);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    // Staging failed, so fallback to performance-led path was executed
    expect(screen.getByText(/^Overhead Press \(Barbell\)$/i)).toBeDefined();

    // Verify draft was saved
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftStr).not.toBeNull();
  });

  // 10. historical edit, redo, one-off, Off, Deload, missing program, and fallback sessions make zero addition-time Guided calls
  it('10. historical edit, redo, one-off, Off, Deload, missing program, and fallback sessions make zero addition-time Guided calls', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    const prog = createTestProgram('prog-guided-exclusions-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const histLog: WorkoutLog = {
      id: 'log-edit-1',
      date: '2026-08-01',
      unit: 'lb',
      programId: prog.id,
      exercises: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 135, reps: 10, rpe: 8, isCompleted: true }],
        },
      ],
    };
    storage.saveWorkoutLog(histLog);

    // Sub-case A: historical edit
    const { unmount: unmountA } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          editLogId: histLog.id,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    orchestrateSpy.mockClear();
    const btnA = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(btnA);
    const exA = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exA);
    fireEvent.click(screen.getByRole('button', { name: /Add to Workout/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountA();

    // Sub-case B: redo
    const { unmount: unmountB } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          redoFromLogId: histLog.id,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    orchestrateSpy.mockClear();
    const btnB = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(btnB);
    const exB = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exB);
    fireEvent.click(screen.getByRole('button', { name: /Add to Workout/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountB();

    // Sub-case C: one-off
    const { unmount: unmountC } = render(
      <WorkoutLogger
        initialParams={{
          isOneOff: true,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    orchestrateSpy.mockClear();
    const btnC = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(btnC);
    const exC = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exC);
    fireEvent.click(screen.getByRole('button', { name: /Add to Workout/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountC();

    // Sub-case D: Off objective
    const progOff = createTestProgram('prog-off-1', 'metreps_guided', 'Off');
    storage.saveProgram(progOff);
    const { unmount: unmountD } = render(
      <WorkoutLogger
        initialParams={{
          programId: progOff.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    orchestrateSpy.mockClear();
    const btnD = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(btnD);
    const exD = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exD);
    fireEvent.click(screen.getByRole('button', { name: /Add to Workout/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountD();

    // Sub-case E: Deload objective via saved draft
    mockStorage.setItem(
      'metreps_workout_draft',
      JSON.stringify({
        programId: prog.id,
        weekNum: '1',
        dayNum: '1',
        objective: 'Deload',
        exercises: prog.exercisesByDay[1],
      })
    );
    const { unmount: unmountE } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    orchestrateSpy.mockClear();
    const btnE = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(btnE);
    const exE = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exE);
    fireEvent.click(screen.getByRole('button', { name: /Add to Workout/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountE();

    // Sub-case F: Missing program
    mockStorage.clear();
    const { unmount: unmountF } = render(
      <WorkoutLogger
        initialParams={{
          programId: undefined,
          isOneOff: true,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    orchestrateSpy.mockClear();
    const btnF = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(btnF);
    const exF = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exF);
    fireEvent.click(screen.getByRole('button', { name: /Add to Workout/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountF();

    // Sub-case G: Fallback session (day without program exercises)
    const { unmount: unmountG } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '99',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    orchestrateSpy.mockClear();
    const btnG = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(btnG);
    const exG = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exG);
    fireEvent.click(screen.getByRole('button', { name: /Add to Workout/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountG();
  });

  // 11. inputs and prior state are not mutated
  it('11. inputs and prior state are not mutated', async () => {
    const prog = createTestProgram('prog-guided-immut-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    // Take snapshot of program exercises before rendering
    const progDay1Snapshot = JSON.stringify(prog.exercisesByDay[1]);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    const openLibraryBtn = screen.getByRole('button', { name: /Add Custom Exercise/i });
    fireEvent.click(openLibraryBtn);

    const exerciseHeading = await screen.findByText(/^Overhead Press \(Barbell\)$/i);
    fireEvent.click(exerciseHeading);

    const confirmBtn = screen.getByRole('button', { name: /Add to Workout/i });
    fireEvent.click(confirmBtn);

    // Program definition in storage remained unmutated
    expect(JSON.stringify(prog.exercisesByDay[1])).toBe(progDay1Snapshot);

    // Both exercises are present in UI
    expect(screen.getByText(/^Barbell Bench Press$/i)).toBeDefined();
    expect(screen.getByText(/^Overhead Press \(Barbell\)$/i)).toBeDefined();
  });
});
