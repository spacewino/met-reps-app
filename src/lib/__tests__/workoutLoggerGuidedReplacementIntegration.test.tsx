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
import { Program, WorkoutLog } from '../../types';
import * as integrationModule from '../guidedWorkoutIntegration';
import * as registryModule from '../guidedSessionExerciseRegistry';
import {
  type SessionExerciseRegistry,
  type SessionExerciseRegistryOperationResult,
} from '../guidedSessionExerciseRegistry';
import {
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
  resolveProgramProgressionMode,
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

describe('APC-3B2C2B2C-D2C-3B2B: WorkoutLogger Guided Library-Replacement Integration', () => {
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
        {
          exerciseKey: 'barbell_squat',
          name: 'Barbell Squat',
          muscleGroup: 'Legs',
          modality: 'weighted',
          isMainMovement: true,
          sets: [
            { setNumber: 1, weight: 225, reps: 10, rpe: 8, isCompleted: false },
            { setNumber: 2, weight: 225, reps: 10, rpe: 8, isCompleted: false },
          ],
        },
      ],
      2: [],
      3: [],
    },
  });

  const createHistoricalLogs = (programId: string): WorkoutLog[] => [
    {
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
        {
          exerciseKey: 'deadlift',
          name: 'Deadlift (Conventional)',
          muscleGroup: 'Back',
          modality: 'weighted',
          isMainMovement: true,
          sets: [
            { setNumber: 1, weight: 315, reps: 5, rpe: 8, isCompleted: true },
            { setNumber: 2, weight: 315, reps: 5, rpe: 8, isCompleted: true },
          ],
        },
      ],
    },
  ];

  // 1. performance_led replacement preserves existing behaviour and makes zero Guided calls
  it('1. performance_led replacement preserves existing behaviour and makes zero Guided calls', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const replaceSpy = vi.spyOn(registryModule, 'replaceSessionExerciseRegistryEntry');

    const prog = createTestProgram('prog-perf-repl-1', 'performance_led');
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

    expect(orchestrateSpy).not.toHaveBeenCalled();

    // Trigger Edit Exercise on first exercise (Barbell Bench Press)
    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    // Select Deadlift
    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    // Confirm Replace Exercise
    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // Guided orchestrator was NOT called for performance_led replacement
    expect(orchestrateSpy).not.toHaveBeenCalled();

    // Registry replacement occurred with user_replaced_library
    expect(replaceSpy).toHaveBeenCalledWith(expect.anything(), 0, 'user_replaced_library');

    // UI shows Deadlift and keeps sibling Barbell Squat
    expect(screen.getByText(/^Deadlift \(conventional\)$/i)).toBeDefined();
    expect(screen.getByText(/^Barbell Squat$/i)).toBeDefined();
    expect(screen.queryByText(/^Barbell Bench Press$/i)).toBeNull();
  });

  // 2. eligible Guided replacement uses the real default chain and applies Guided targets and snapshots
  it('2. eligible Guided replacement uses the real default chain and applies Guided targets and snapshots', async () => {
    const prog = createTestProgram('prog-guided-repl-real-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

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

    // Initial mount renders Barbell Bench Press and Barbell Squat
    expect(screen.getByText(/^Barbell Bench Press$/i)).toBeDefined();
    expect(screen.getByText(/^Barbell Squat$/i)).toBeDefined();

    // Replace exercise 0 with Deadlift
    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // Replaced exercise is now displayed
    expect(screen.getByText(/^Deadlift \(conventional\)$/i)).toBeDefined();
    expect(screen.getByText(/^Barbell Squat$/i)).toBeDefined();
    expect(screen.queryByText(/^Barbell Bench Press$/i)).toBeNull();

    // Draft contains replaced exercise with prescribed snapshots
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftStr).not.toBeNull();
    if (draftStr) {
      expect(draftStr).toContain('Deadlift (Conventional)');
      expect(draftStr).toContain('prescribedTargetSnapshots');
    }
  });

  // 3. helper is called once with one item at the exact replaced global index
  it('3. helper is called once with one item at the exact replaced global index', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    // Establish known locked session bodyweight snapshot before mount
    storage.setBodyweightWithUnit(165.5, 'lb');

    const prog = createTestProgram('prog-guided-repl-single-call-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

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

    // Clear initial mount call
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    orchestrateSpy.mockClear();

    // Update settings bodyweight after session has mounted to create divergent authorities
    storage.setBodyweightWithUnit(220.0, 'lb');
    expect(storage.getBodyweightWithUnit()).toEqual({ value: 220.0, unit: 'lb' });

    // Replace exercise 0
    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // Called exactly once with 1 item
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    const callInput = orchestrateSpy.mock.calls[0][0];
    expect(callInput.items).toHaveLength(1);

    // Locked bodyweight snapshot authority: helper receives locked session snapshot, not divergent current profile weight
    expect(callInput.context.bodyweightSnapshot).toEqual({ value: 165.5, unit: 'lb' });
    expect(callInput.context.bodyweightSnapshot).not.toEqual({ value: 220.0, unit: 'lb' });

    // Exact replaced index
    expect(callInput.items[0].exerciseIndex).toBe(0);
    expect(callInput.items[0].exercise.name).toBe('Deadlift (Conventional)');
    expect(callInput.items[0].templateExercise?.name).toBe('Deadlift (Conventional)');

    // Lifecycle evidence is fresh and untouched
    const evidence = callInput.items[0].lifecycleEvidence;
    expect(evidence.originProvenance).toBe('user_replaced_library');
    expect(evidence.evaluationState).toEqual({ status: 'not_evaluated' });
    expect(evidence.isHistoricalEdit).toBe(false);
    expect(evidence.isRedoSession).toBe(false);
    expect(evidence.isRestoredFromDraft).toBe(false);
    expect(evidence.hasCommittedLiveEvidence).toBe(false);
    expect(evidence.hasLiveAdjustedSets).toBe(false);
    expect(evidence.isStructurallyModified).toBe(false);
    expect(evidence.userTouchedSetKeys?.size ?? 0).toBe(0);
    expect(evidence.checkedSetKeys?.size ?? 0).toBe(0);
    expect(evidence.skippedSetKeys?.size ?? 0).toBe(0);
  });

  // 4. replacement receives a fresh ID, user_replaced_library provenance, and returned evaluation state
  it('4. replacement receives a fresh ID, user_replaced_library provenance, and returned evaluation state', async () => {
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');
    const replaceSpy = vi.spyOn(registryModule, 'replaceSessionExerciseRegistryEntry');

    const prog = createTestProgram('prog-guided-repl-fresh-id-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

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
    replaceSpy.mockClear();

    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith(expect.anything(), 0, 'user_replaced_library');

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][1]).toBe(0);
    expect(updateSpy.mock.calls[0][2].status).toBe('evaluated');

    const lastResult: SessionExerciseRegistryOperationResult | undefined = updateSpy.mock.results.at(-1)?.value;
    expect(lastResult?.applied).toBe(true);
    expect(lastResult?.registry.entries[0].originProvenance).toBe('user_replaced_library');
    expect(lastResult?.registry.entries[0].instanceId).toBe('session_ex_3');
    expect(lastResult?.registry.entries[0].evaluationState.status).toBe('evaluated');
  });

  // 5. sibling exercises, registry identities, targets, snapshots, and evaluation states remain unchanged
  it('5. sibling exercises, registry identities, targets, snapshots, and evaluation states remain unchanged', async () => {
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');

    const prog = createTestProgram('prog-guided-repl-sibling-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

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

    // Replace index 0
    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // Only index 0 updated
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][1]).toBe(0);

    const lastResult: SessionExerciseRegistryOperationResult | undefined = updateSpy.mock.results.at(-1)?.value;
    expect(lastResult?.applied).toBe(true);

    // Sibling at index 1 is untouched
    const siblingEntry = lastResult?.registry.entries[1];
    expect(siblingEntry?.instanceId).toBe('session_ex_2');
    expect(siblingEntry?.originProvenance).toBe('session_template_init');
    expect(siblingEntry?.evaluationState.status).toBe('evaluated');

    // Sibling exercise remains in UI
    expect(screen.getByText(/^Barbell Squat$/i)).toBeDefined();
  });

  // 6. old replacement-index snapshots and per-set evidence are removed while sibling evidence remains
  it('6. old replacement-index snapshots and per-set evidence are removed while sibling evidence remains', async () => {
    const prog = createTestProgram('prog-guided-repl-evidence-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

    // Pre-seed draft with checked sets and snapshots on both exercise 0 and exercise 1
    mockStorage.setItem(
      'metreps_workout_draft',
      JSON.stringify({
        programId: prog.id,
        weekNum: '1',
        dayNum: '1',
        exercises: prog.exercisesByDay[1],
        checkedSets: { '0-0': true, '1-0': true },
        userTouchedSets: { '0-0': true, '1-0': true },
        completionTouchedSets: { '0-0': true, '1-0': true },
        prescribedTargetSnapshots: {
          '0-0': { targetWeight: 187.5, targetReps: 15, targetRpe: 8 },
          '1-0': { targetWeight: 225, targetReps: 10, targetRpe: 8 },
        },
      })
    );

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

    // Replace exercise 0
    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // Check draft in storage
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftStr).not.toBeNull();
    if (draftStr) {
      const draft = JSON.parse(draftStr);
      // Exercise 0 old evidence cleared
      expect(draft.checkedSets?.['0-0']).toBeUndefined();
      expect(draft.userTouchedSets?.['0-0']).toBeUndefined();
      expect(draft.completionTouchedSets?.['0-0']).toBeUndefined();

      // Exercise 1 sibling evidence PRESERVED
      expect(draft.checkedSets?.['1-0']).toBe(true);
      expect(draft.userTouchedSets?.['1-0']).toBe(true);
      expect(draft.completionTouchedSets?.['1-0']).toBe(true);
      expect(draft.prescribedTargetSnapshots?.['1-0']).toEqual({
        targetWeight: 225,
        targetReps: 10,
        targetRpe: 8,
      });
    }
  });

  // 7. previously Guided initial or added exercises are not re-evaluated
  it('7. previously Guided initial or added exercises are not re-evaluated', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    const prog = createTestProgram('prog-guided-repl-no-reeval-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

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

    // Initial evaluation included exercises 0 and 1
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    const initialItems = orchestrateSpy.mock.calls[0][0].items;
    expect(initialItems).toHaveLength(2);

    orchestrateSpy.mockClear();

    // Replace exercise 0
    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // Replacement-time call submitted ONLY exercise 0, NOT sibling exercise 1
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    const replItems = orchestrateSpy.mock.calls[0][0].items;
    expect(replItems).toHaveLength(1);
    expect(replItems[0].exerciseIndex).toBe(0);
    expect(replItems[0].exercise.name).toBe('Deadlift (Conventional)');
  });

  // 8. ordinary rerender does not repeat the replacement-time call
  it('8. ordinary rerender does not repeat the replacement-time call', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    const prog = createTestProgram('prog-guided-repl-rerender-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

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

    // Replace exercise 0
    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    expect(orchestrateSpy).toHaveBeenCalledTimes(1);

    // Rerender component
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

    // Call count remains 1
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
  });

  // 9. malformed result count or index falls back atomically to the performance-led replacement
  it('9. malformed result count or index falls back atomically to the performance-led replacement', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');
    const markSpy = vi.spyOn(registryModule, 'markSessionExerciseStructuralMutation');

    const prog = createTestProgram('prog-guided-repl-malformed-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

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
    markSpy.mockClear();

    // Mock malformed result: empty array when 1 expected
    orchestrateSpy.mockReturnValueOnce([]);

    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // Orchestrator called
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);

    // Update evaluation state was NOT called due to validation failure
    expect(updateSpy).not.toHaveBeenCalled();

    // Replaced exercise is still present in UI (via performance-led calculation fallback)
    expect(screen.getByText(/^Deadlift \(conventional\)$/i)).toBeDefined();

    // Draft was persisted
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftStr).not.toBeNull();
    if (draftStr) {
      expect(draftStr).toContain('Deadlift (Conventional)');
      const parsedDraft = JSON.parse(draftStr) as {
        prescribedTargetSnapshots?: Record<string, { progressionMode?: string }>;
      };
      // Zero partial Guided snapshots: none have progressionMode === 'metreps_guided'
      const snapshots = parsedDraft.prescribedTargetSnapshots || {};
      for (const key of Object.keys(snapshots)) {
        if (key.startsWith('0-')) {
          expect(snapshots[key]?.progressionMode).not.toBe('metreps_guided');
        }
      }
    }

    // Prove through subsequent real operation (add set) that the committed registry:
    // - has fresh, non-reused instance ID session_ex_3;
    // - provenance is user_replaced_library;
    // - evaluationState is exactly { status: 'not_evaluated' };
    // - old exercise identity session_ex_1 is not retained;
    // - sibling entries remain unchanged.
    const addSetBtns = screen.getAllByRole('button', { name: /Add set/i });
    fireEvent.click(addSetBtns[0]);

    expect(markSpy).toHaveBeenCalled();
    const observedRegistry: SessionExerciseRegistry = markSpy.mock.calls[0][0];

    expect(observedRegistry.entries[0].instanceId).toBe('session_ex_3');
    expect(observedRegistry.entries[0].instanceId).not.toBe('session_ex_1');
    expect(observedRegistry.entries[0].originProvenance).toBe('user_replaced_library');
    expect(observedRegistry.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });

    expect(observedRegistry.entries[1].instanceId).toBe('session_ex_2');
    expect(observedRegistry.entries[1].originProvenance).toBe('session_template_init');
    expect(observedRegistry.entries[1].evaluationState.status).toBe('evaluated');
  });

  // 10. forced evaluation-state staging failure produces the same complete fallback with no partial registry commit
  it('10. forced evaluation-state staging failure produces the same complete fallback with no partial registry commit', async () => {
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');
    const markSpy = vi.spyOn(registryModule, 'markSessionExerciseStructuralMutation');

    const prog = createTestProgram('prog-guided-repl-staging-fail-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

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
    markSpy.mockClear();

    // Force updateSessionExerciseEvaluationState to return applied: false
    updateSpy.mockImplementation((registry: SessionExerciseRegistry) => ({
      applied: false,
      registry,
    }));

    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // Fallback executed: replaced exercise is present in UI
    expect(screen.getByText(/^Deadlift \(conventional\)$/i)).toBeDefined();

    // Draft persisted with zero partial Guided snapshots
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftStr).not.toBeNull();
    if (draftStr) {
      expect(draftStr).toContain('Deadlift (Conventional)');
      const parsedDraft = JSON.parse(draftStr) as {
        prescribedTargetSnapshots?: Record<string, { progressionMode?: string }>;
      };
      const snapshots = parsedDraft.prescribedTargetSnapshots || {};
      for (const key of Object.keys(snapshots)) {
        if (key.startsWith('0-')) {
          expect(snapshots[key]?.progressionMode).not.toBe('metreps_guided');
        }
      }
    }

    // Prove through subsequent real operation that the registry committed retains newly allocated ID,
    // provenance user_replaced_library, evaluationState { status: 'not_evaluated' },
    // failed evaluated registry was never committed, and siblings remain unchanged
    const addSetBtns = screen.getAllByRole('button', { name: /Add set/i });
    fireEvent.click(addSetBtns[0]);

    expect(markSpy).toHaveBeenCalled();
    const observedRegistry: SessionExerciseRegistry = markSpy.mock.calls[0][0];

    expect(observedRegistry.entries[0].instanceId).toBe('session_ex_3');
    expect(observedRegistry.entries[0].instanceId).not.toBe('session_ex_1');
    expect(observedRegistry.entries[0].originProvenance).toBe('user_replaced_library');
    expect(observedRegistry.entries[0].evaluationState).toEqual({ status: 'not_evaluated' });
    expect(observedRegistry.entries[0].evaluationState.status).not.toBe('evaluated');

    expect(observedRegistry.entries[1].instanceId).toBe('session_ex_2');
    expect(observedRegistry.entries[1].originProvenance).toBe('session_template_init');
    expect(observedRegistry.entries[1].evaluationState.status).toBe('evaluated');
  });

  // 11. historical edit, redo, one-off, Off, Deload, missing program, and fallback sessions make zero replacement-time Guided calls
  it('11. historical edit, redo, one-off, Off, Deload, missing program, and fallback sessions make zero replacement-time Guided calls', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    const prog = createTestProgram('prog-guided-repl-exclusions-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const histLog: WorkoutLog = {
      id: 'log-edit-repl-1',
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
    const btnA = screen.getAllByTitle('Edit Exercise')[0];
    fireEvent.click(btnA);
    const exA = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(exA);
    fireEvent.click(screen.getByRole('button', { name: /Replace Exercise/i }));
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
    const btnB = screen.getAllByTitle('Edit Exercise')[0];
    fireEvent.click(btnB);
    const exB = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(exB);
    fireEvent.click(screen.getByRole('button', { name: /Replace Exercise/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountB();

    // Sub-case C: one-off
    mockStorage.setItem(
      'metreps_workout_draft',
      JSON.stringify({
        isOneOff: true,
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 135, reps: 10, rpe: 8 }],
          },
        ],
      })
    );
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
    const btnC = screen.getAllByTitle('Edit Exercise')[0];
    fireEvent.click(btnC);
    const exC = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(exC);
    fireEvent.click(screen.getByRole('button', { name: /Replace Exercise/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountC();

    // Sub-case D: Off objective
    const progOff = createTestProgram('prog-off-repl-1', 'metreps_guided', 'Off');
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
    const btnD = screen.getAllByTitle('Edit Exercise')[0];
    fireEvent.click(btnD);
    const exD = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(exD);
    fireEvent.click(screen.getByRole('button', { name: /Replace Exercise/i }));
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
    const btnE = screen.getAllByTitle('Edit Exercise')[0];
    fireEvent.click(btnE);
    const exE = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(exE);
    fireEvent.click(screen.getByRole('button', { name: /Replace Exercise/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountE();

    // Sub-case F: Missing program
    mockStorage.clear();
    mockStorage.setItem(
      'metreps_workout_draft',
      JSON.stringify({
        isOneOff: true,
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 135, reps: 10, rpe: 8 }],
          },
        ],
      })
    );
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
    const btnF = screen.getAllByTitle('Edit Exercise')[0];
    fireEvent.click(btnF);
    const exF = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(exF);
    fireEvent.click(screen.getByRole('button', { name: /Replace Exercise/i }));
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
    const btnG = screen.getAllByTitle('Edit Exercise')[0];
    fireEvent.click(btnG);
    const exG = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(exG);
    fireEvent.click(screen.getByRole('button', { name: /Replace Exercise/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountG();

    // Sub-case H: Invalid / malformed targetProgressionMode fails closed through resolveProgramProgressionMode
    const progInvalid = createTestProgram('prog-invalid-mode-repl-1', 'performance_led');
    Reflect.set(progInvalid, 'targetProgressionMode', 'corrupt_unrecognized_mode');
    expect(resolveProgramProgressionMode(progInvalid)).toBe('performance_led');
    storage.saveProgram(progInvalid);
    storage.setCurrentProgramId(progInvalid.id);

    const { unmount: unmountH } = render(
      <WorkoutLogger
        initialParams={{
          programId: progInvalid.id,
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
    const btnH = screen.getAllByTitle('Edit Exercise')[0];
    fireEvent.click(btnH);
    const exH = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(exH);
    fireEvent.click(screen.getByRole('button', { name: /Replace Exercise/i }));
    expect(orchestrateSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/^Deadlift \(conventional\)$/i)).toBeDefined();
    unmountH();
  }, 25000);

  // 12. inputs and earlier states are not mutated
  it('12. inputs and earlier states are not mutated', async () => {
    const prog = createTestProgram('prog-guided-repl-immut-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

    // Snapshot program JSON before replacement
    const progSnapshot = JSON.stringify(prog);

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

    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // Program object in storage remained unmutated
    expect(JSON.stringify(storage.getPrograms().find(p => p.id === prog.id))).toBe(progSnapshot);

    // UI shows replaced exercise and sibling
    expect(screen.getByText(/^Deadlift \(conventional\)$/i)).toBeDefined();
    expect(screen.getByText(/^Barbell Squat$/i)).toBeDefined();
  });

  // 13. forced registry replacement rejection (applied: false) aborts replacement, preserving registry, visible exercise, snapshots, evidence, and draft
  it('13. forced registry replacement rejection (applied: false) aborts replacement, preserving registry, visible exercise, snapshots, evidence, and draft', async () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const replaceSpy = vi.spyOn(registryModule, 'replaceSessionExerciseRegistryEntry');
    const markSpy = vi.spyOn(registryModule, 'markSessionExerciseStructuralMutation');

    const prog = createTestProgram('prog-guided-repl-reject-1', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    createHistoricalLogs(prog.id).forEach(l => storage.saveWorkoutLog(l));

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

    // Initial draft snapshot
    const initialDraft = mockStorage.getItem('metreps_workout_draft');
    expect(initialDraft).not.toBeNull();

    orchestrateSpy.mockClear();
    replaceSpy.mockClear();
    markSpy.mockClear();

    // Force replaceSessionExerciseRegistryEntry to return applied: false
    replaceSpy.mockImplementation((registry: SessionExerciseRegistry) => ({
      applied: false,
      registry,
    }));

    const editBtns = screen.getAllByTitle('Edit Exercise');
    fireEvent.click(editBtns[0]);

    const deadliftHeading = await screen.findByText(/^Deadlift \(conventional\)$/i);
    fireEvent.click(deadliftHeading);

    const replaceConfirmBtn = screen.getByRole('button', { name: /Replace Exercise/i });
    fireEvent.click(replaceConfirmBtn);

    // 1. Spy was invoked once
    expect(replaceSpy).toHaveBeenCalledTimes(1);

    // 2. Zero Guided helper call
    expect(orchestrateSpy).not.toHaveBeenCalled();

    // 3. Zero visible exercise replacement: Deadlift is not added, Barbell Bench Press remains
    expect(screen.queryByText(/^Deadlift \(conventional\)$/i)).toBeNull();
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();

    // 4. Zero draft write
    const postDraft = mockStorage.getItem('metreps_workout_draft');
    expect(postDraft).toBe(initialDraft);

    // 5. Zero userRawExercises change and zero snapshot change in draft
    if (postDraft) {
      const parsed = JSON.parse(postDraft) as {
        exercises?: { name: string }[];
        userRawExercises?: { name: string }[];
        prescribedTargetSnapshots?: Record<string, unknown>;
      };
      expect(parsed.exercises?.[0]?.name).toBe('Barbell Bench Press');
      expect(parsed.userRawExercises?.[0]?.name).toBe('Barbell Bench Press');
      expect(parsed.prescribedTargetSnapshots?.['0-0']).toBeDefined();
    }

    // 6. Zero registry-ref replacement: prove through subsequent real action (add set)
    const addSetBtns = screen.getAllByRole('button', { name: /Add set/i });
    fireEvent.click(addSetBtns[0]);

    expect(markSpy).toHaveBeenCalled();
    const registryPassedToNextOp: SessionExerciseRegistry = markSpy.mock.calls[0][0];
    const preAttemptRegistry: SessionExerciseRegistry = replaceSpy.mock.calls[0][0];
    expect(registryPassedToNextOp).toEqual(preAttemptRegistry);
    expect(registryPassedToNextOp.entries[0].instanceId).toBe('session_ex_1');
    expect(registryPassedToNextOp.entries[0].originProvenance).toBe('session_template_init');
    expect(registryPassedToNextOp.entries[1].instanceId).toBe('session_ex_2');
    expect(registryPassedToNextOp.entries[1].originProvenance).toBe('session_template_init');
  });
});
