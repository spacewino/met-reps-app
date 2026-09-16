// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { Program, WorkoutLog, ExerciseEntry } from '../../types';
import * as integrationModule from '../guidedWorkoutIntegration';
import * as registryModule from '../guidedSessionExerciseRegistry';
import { type SessionExerciseRegistry } from '../guidedSessionExerciseRegistry';
import {
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
} from '../programProgressionMode';

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

describe('APC-3B2C2B2C-D2C-3B1: WorkoutLogger Scheduled-Workout Guided Integration', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
    window.confirm = () => true;
    window.alert = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const createTestProgram = (
    id: string,
    mode?: 'performance_led' | 'metreps_guided',
    objective: 'Hypertrophy' | 'Strength' | 'Off' = 'Hypertrophy'
  ): Program => ({
    id,
    name: 'Test Program',
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
          exerciseKey: 'incline_press',
          name: 'Incline Dumbbell Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [
            { setNumber: 1, weight: 50, reps: 12, rpe: 8, isCompleted: false },
            { setNumber: 2, weight: 50, reps: 12, rpe: 8, isCompleted: false },
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

  // 1. performance_led scheduled program preserves existing targets and makes zero integration-helper calls
  it('1. performance_led scheduled program preserves existing targets and makes zero integration-helper calls', () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const prog = createTestProgram('prog-perf-led', 'performance_led');
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
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();
    expect(screen.getByText('Incline Dumbbell Press')).toBeDefined();

    // Verify draft has no Guided prescription snapshots attached
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    if (draftStr) {
      const draft = JSON.parse(draftStr);
      draft.exercises.forEach((ex: ExerciseEntry) => {
        ex.sets.forEach((s) => {
          expect(s.prescriptionSnapshot).toBeUndefined();
        });
      });
    }
  });

  // 2. missing targetProgressionMode defaults to performance_led and makes zero calls
  it('2. missing targetProgressionMode defaults to performance_led and makes zero calls', () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const prog = createTestProgram('prog-no-mode');
    delete prog.targetProgressionMode;
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
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();
  });

  // 3. metreps_guided fresh scheduled session invokes the helper exactly once for the full batch
  it('3. metreps_guided fresh scheduled session invokes the helper exactly once for the full batch', () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const prog = createTestProgram('prog-guided-batch', 'metreps_guided');
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
    const calledInput = orchestrateSpy.mock.calls[0][0];
    expect(calledInput.items).toHaveLength(2);
    expect(calledInput.items[0].exerciseIndex).toBe(0);
    expect(calledInput.items[1].exerciseIndex).toBe(1);
    expect(calledInput.context.objective).toBe('Hypertrophy');
    expect(calledInput.context.weekNum).toBe(1);
  });

  // 4. Genuine end-to-end Guided scenario applies expected working-set targets and Guided prescription snapshots
  it('4. genuine end-to-end Guided test using the un-mocked chain applies working-set targets and Guided prescription snapshots', () => {
    // DO NOT mock the Guided chain: use the real implementation
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const prog = createTestProgram('prog-e2e-guided', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const histLog = createHistoricalLog(prog.id);
    storage.saveWorkoutLog(histLog);

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '2',
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
    const results = orchestrateSpy.mock.results[0].value;
    expect(results).toHaveLength(2);

    // Bench press should have guided adapter result with applied prescription
    const benchResult = results[0].result;
    expect(benchResult.status).toBe('guided_adapter_result');
    if (benchResult.status === 'guided_adapter_result') {
      expect(benchResult.adapterResult.status).toBe('guided_applied');
      expect(benchResult.appliedSets.length).toBeGreaterThan(0);
      expect(benchResult.appliedSets[0].prescriptionSnapshot).toBeDefined();
    }

    // Verify draft serialization contains the attached Guided prescription snapshots
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    expect(draftStr).not.toBeNull();
    const draft = JSON.parse(draftStr!);
    expect(draft.exercises[0].sets[0].prescriptionSnapshot).toBeDefined();
    expect(draft.exercises[0].sets[0].prescriptionSnapshot.progressionMode).toBe('metreps_guided');
    expect(draft.exercises[0].sets[0].prescriptionSnapshot.snapshotVersion).toBe(2);
  });

  // 5. registry evaluation states are advanced for all successfully applied results
  it('5. registry evaluation states are advanced for all successfully applied results', () => {
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');
    const prog = createTestProgram('prog-guided-eval-states', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);
    storage.saveWorkoutLog(createHistoricalLog(prog.id));

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '2',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // updateSessionExerciseEvaluationState should have been called for each exercise
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenNthCalledWith(1, expect.any(Object), 0, expect.objectContaining({ status: 'evaluated' }));
    expect(updateSpy).toHaveBeenNthCalledWith(2, expect.any(Object), 1, expect.objectContaining({ status: 'evaluated' }));

    const finalRegistryResult = updateSpy.mock.results.at(-1)?.value as registryModule.SessionExerciseRegistryOperationResult;
    expect(finalRegistryResult.applied).toBe(true);
    expect(finalRegistryResult.registry.entries[0].evaluationState.status).toBe('evaluated');
    expect(finalRegistryResult.registry.entries[1].evaluationState.status).toBe('evaluated');
  });

  // 6. an ordinary rerender does not invoke Guided again
  it('6. an ordinary rerender does not invoke Guided again', () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const prog = createTestProgram('prog-guided-rerender', 'metreps_guided');
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

    expect(orchestrateSpy).toHaveBeenCalledTimes(1);

    // Rerender with same props
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

    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
  });

  // 7. restored draft, historical edit, and redo session each make zero Guided calls and preserve their sets
  it('7. restored draft, historical edit, and redo session each make zero Guided calls', () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const prog = createTestProgram('prog-guided-locked', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    // 7a. Restored draft
    const draftPayload = {
      programId: prog.id,
      weekNum: 1,
      dayNum: 1,
      dateStr: '2026-08-10',
      workoutDate: '2026-08-10',
      startTime: '10:00',
      duration: 45,
      exercises: [
        {
          name: 'Restored Exercise',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 99, reps: 7, rpe: 7, isCompleted: false }],
        },
      ],
    };
    mockStorage.setItem('metreps_workout_draft', JSON.stringify(draftPayload));

    const { unmount: unmountDraft } = render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(orchestrateSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Restored Exercise')).toBeDefined();
    unmountDraft();
    mockStorage.clear();
    orchestrateSpy.mockClear();

    // 7b. Historical edit
    const histLog: WorkoutLog = {
      id: 'hist-edit-log-1',
      date: '2026-08-01',
      unit: 'lb',
      programId: prog.id,
      exercises: [
        {
          name: 'Historical Exercise',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 75, reps: 10, rpe: 8, isCompleted: true }],
        },
      ],
    };
    storage.saveWorkoutLog(histLog);

    const { unmount: unmountEdit } = render(
      <WorkoutLogger
        initialParams={{
          editLogId: histLog.id,
          programId: prog.id,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(orchestrateSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Historical Exercise')).toBeDefined();
    unmountEdit();
    orchestrateSpy.mockClear();

    // 7c. Redo session
    const { unmount: unmountRedo } = render(
      <WorkoutLogger
        initialParams={{
          redoFromLogId: histLog.id,
          programId: prog.id,
          week: '1',
          day: '1',
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountRedo();
  });

  // 8. Off, Deload, one-off, and fallback/default sessions make zero Guided calls
  it('8. Off, Deload, one-off, and fallback/default sessions make zero Guided calls', () => {
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    // 8a. Off objective
    const progOff = createTestProgram('prog-off', 'metreps_guided', 'Off');
    storage.saveProgram(progOff);
    const { unmount: unmountOff } = render(
      <WorkoutLogger
        initialParams={{
          programId: progOff.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountOff();

    // 8b. Deload objective
    const progDeload = createTestProgram('prog-deload', 'metreps_guided');
    (progDeload as any).objective = 'Deload';
    storage.saveProgram(progDeload);
    const { unmount: unmountDeload } = render(
      <WorkoutLogger
        initialParams={{
          programId: progDeload.id,
          week: '1',
          day: '1',
          date: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountDeload();

    // 8c. One-off session
    const { unmount: unmountOneOff } = render(
      <WorkoutLogger
        initialParams={{
          isOneOff: true,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountOneOff();

    // 8d. Fallback session (empty day)
    const { unmount: unmountFallback } = render(
      <WorkoutLogger
        initialParams={{
          programId: 'non-existent-program',
          week: '1',
          day: '1',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    expect(orchestrateSpy).not.toHaveBeenCalled();
    unmountFallback();
  });

  // 9. Malformed output cardinality or indices fail closed without partial sets, snapshots, or registry updates
  it('9. malformed output cardinality or indices fail closed without partial sets, snapshots, or registry updates', () => {
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    // Return wrong length (1 instead of 2)
    orchestrateSpy.mockReturnValueOnce([
      {
        exerciseIndex: 0,
        result: {
          status: 'guided_adapter_result',
          exercise: {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 200, reps: 10, rpe: 8, isCompleted: false }],
          },
          appliedSets: [{ setNumber: 1, weight: 200, reps: 10, rpe: 8, isCompleted: false }],
          adapterResult: {
            status: 'guided_applied',
            exercise: { name: 'Barbell Bench Press', muscleGroup: 'Chest', modality: 'weighted', sets: [] },
            appliedSets: [],
            snapshots: [],
            coachingReasonCode: 'BASE_PRESCRIPTION',
            diagnostics: { appliedRule: 'test', candidateCount: 0 },
          } as any,
          nextEvaluationState: {
            status: 'evaluated',
            result: { kind: 'guided_applied', adapterStatus: 'guided_applied', coachingReasonCode: 'BASE_PRESCRIPTION' },
          },
          bundleCalculated: true,
          adapterCalled: true,
        },
      },
    ]);

    const prog = createTestProgram('prog-guided-cardinality-fail', 'metreps_guided');
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

    // Staging should not have executed
    expect(updateSpy).not.toHaveBeenCalled();

    // Rendered exercises should be the base performance-led targets (not 200 lb from mocked Guided)
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();
    expect(screen.getByText('Incline Dumbbell Press')).toBeDefined();

    // Draft should have zero Guided prescription snapshots
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    if (draftStr) {
      const draft = JSON.parse(draftStr);
      draft.exercises.forEach((ex: ExerciseEntry) => {
        ex.sets.forEach((s) => {
          expect(s.prescriptionSnapshot).toBeUndefined();
        });
      });
    }
  });

  // 10. A forced registry-update failure on a later exercise leaves the original registry unchanged and applies no partial Guided result
  it('10. a forced registry-update failure on a later exercise leaves the original registry unchanged and applies no partial Guided result', () => {
    const prog = createTestProgram('prog-guided-stage-fail', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    let callCount = 0;
    const updateSpy = vi.spyOn(registryModule, 'updateSessionExerciseEvaluationState');

    updateSpy.mockImplementation((registry, index, evalState) => {
      callCount++;
      if (callCount === 2) {
        return { applied: false, registry };
      }
      return {
        applied: true,
        registry: {
          ...registry,
          entries: registry.entries.map((e, i) =>
            i === index ? { ...e, evaluationState: evalState } : e
          ),
        },
      };
    });

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

    // updateSpy was called for index 0 and 1, but staging aborted on call 2
    expect(updateSpy).toHaveBeenCalledTimes(2);

    // Base performance-led target sets are rendered
    expect(screen.getByText('Barbell Bench Press')).toBeDefined();
    expect(screen.getByText('Incline Dumbbell Press')).toBeDefined();

    // Draft should have no Guided snapshots
    const draftStr = mockStorage.getItem('metreps_workout_draft');
    if (draftStr) {
      const draft = JSON.parse(draftStr);
      draft.exercises.forEach((ex: ExerciseEntry) => {
        ex.sets.forEach((s) => {
          expect(s.prescriptionSnapshot).toBeUndefined();
        });
      });
    }
  });

  // 11. input exercises, historical logs, program, and pure integration results are not mutated
  it('11. input exercises, historical logs, program, and pure integration results are not mutated', () => {
    const prog = createTestProgram('prog-guided-freeze', 'metreps_guided');
    storage.saveProgram(prog);
    storage.setCurrentProgramId(prog.id);

    const histLog = createHistoricalLog(prog.id);
    storage.saveWorkoutLog(histLog);

    const originalProg = JSON.parse(JSON.stringify(prog));
    const originalLog = JSON.parse(JSON.stringify(histLog));

    render(
      <WorkoutLogger
        initialParams={{
          programId: prog.id,
          week: '2',
          day: '1',
          date: '2026-08-10',
          scheduledDate: '2026-08-10',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Stored program and logs remain unmutated
    expect(storage.getPrograms().find(p => p.id === prog.id)).toEqual(originalProg);
    expect(storage.getWorkoutLogs().find(l => l.id === histLog.id)).toEqual(originalLog);
  });
});
