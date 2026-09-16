// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { Program, ExerciseEntry, WorkoutLog } from '../../types';
import { isEligibleStrengthMainMovement, getEligibleMainMovementCount } from '../programMetadata';

// In-memory storage mock
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
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    writable: true,
  });
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.alert = () => {};
}

describe('WorkoutLogger Strength Main Movement Save Validation Regression', () => {
  beforeEach(() => {
    mockStorage.clear();
    localStorage.clear();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
    localStorage.setItem('workoutLogs', JSON.stringify([]));
    localStorage.setItem('programList', JSON.stringify([]));
    vi.clearAllMocks();
    window.confirm = () => true;
    window.alert = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const createStrengthProgram = (
    id: string,
    algorithmId: 'strength_linear' | 'strength_undulating',
    exercises: ExerciseEntry[]
  ): Program => ({
    id,
    name: 'Strength Save Validation Program',
    daysPerWeek: 1,
    programDuration: 4,
    createdAt: '2026-08-20T00:00:00.000Z',
    objective: 'Strength',
    algorithmId,
    assignedWeekdays: { 1: 1 },
    exercisesByDay: {
      1: exercises,
    },
  });

  const renderLogger = (params: {
    programId: string;
    week?: string;
    day?: string;
    onSave?: (targetView?: string, p?: any) => void;
  }) => {
    const handleSave = params.onSave ?? vi.fn();
    const result = render(
      <WorkoutLogger
        initialParams={{
          programId: params.programId,
          week: params.week ?? '1',
          day: params.day ?? '1',
          isOneOff: false,
          date: '2026-08-20',
          scheduledDate: '2026-08-20',
        }}
        onClose={() => {}}
        onSave={handleSave}
      />
    );
    return { ...result, handleSave };
  };

  it('Scenario A: Strength + Linear Periodisation + Pull-Up (Assisted) saves without false warning', async () => {
    const assistedEx: ExerciseEntry = {
      name: 'Pull-Up (Assisted)',
      muscleGroup: 'Back',
      modality: 'assisted',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 20, reps: 5, rpe: 8, form: 'strict', isWarmup: false },
      ],
    };

    const program = createStrengthProgram('prog-scen-a', 'strength_linear', [assistedEx]);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);
    storage.saveWorkoutLog({
      id: 'prev-log-scen-a',
      programId: program.id,
      date: '2026-08-10',
      unit: 'kg',
      exercises: [assistedEx],
    });

    // Verify raw predicate agrees
    expect(isEligibleStrengthMainMovement(assistedEx)).toBe(true);
    expect(getEligibleMainMovementCount([assistedEx])).toBe(1);

    const onSaveMock = vi.fn();
    renderLogger({ programId: program.id, onSave: onSaveMock });

    // Verify user can modify assist weight or leave entered values
    const spinbuttons = screen.getAllByRole('spinbutton');
    await act(async () => {
      fireEvent.change(spinbuttons[0], { target: { value: '20' } });
      fireEvent.change(spinbuttons[1], { target: { value: '5' } });
    });

    // Click "Save Workout Log"
    const saveButton = screen.getByRole('button', { name: /save workout log/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    // "No Main Movement Selected" modal must NOT appear
    expect(screen.queryByText('No Main Movement Selected')).toBeNull();

    // Normal save executes
    expect(onSaveMock).toHaveBeenCalled();
    const savedLogs = storage.getWorkoutLogs().filter(l => l.id !== 'prev-log-scen-a');
    expect(savedLogs.length).toBe(1);
    expect(savedLogs[0].exercises[0].isMainMovement).toBe(true);
    expect(savedLogs[0].exercises[0].sets[0].weight).toBe(20);
    expect(savedLogs[0].exercises[0].sets[0].reps).toBe(5);
    expect(savedLogs[0].exercises[0].sets[0].rpe).toBe(8);
  });

  it('Scenario B: Strength + Wave Strength + Pull-Up (Assisted) saves normally', async () => {
    const assistedEx: ExerciseEntry = {
      name: 'Pull-Up (Assisted)',
      muscleGroup: 'Back',
      modality: 'assisted',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 15, reps: 5, rpe: 7.5, form: 'standard' },
      ],
    };

    const program = createStrengthProgram('prog-scen-b', 'strength_undulating', [assistedEx]);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    const onSaveMock = vi.fn();
    renderLogger({ programId: program.id, onSave: onSaveMock });

    const saveButton = screen.getByRole('button', { name: /save workout log/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(screen.queryByText('No Main Movement Selected')).toBeNull();
    expect(onSaveMock).toHaveBeenCalled();
    expect(storage.getWorkoutLogs().length).toBe(1);
  });

  it('Scenario C: Strength + Linear Periodisation + bodyweight Pull-Up saves normally', async () => {
    const bwEx: ExerciseEntry = {
      name: 'Pull-Up',
      muscleGroup: 'Back',
      modality: 'bodyweight',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 0, reps: 6, rpe: 8, form: 'standard' },
      ],
    };

    const program = createStrengthProgram('prog-scen-c', 'strength_linear', [bwEx]);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    expect(isEligibleStrengthMainMovement(bwEx)).toBe(true);
    expect(getEligibleMainMovementCount([bwEx])).toBe(1);

    const onSaveMock = vi.fn();
    renderLogger({ programId: program.id, onSave: onSaveMock });

    const saveButton = screen.getByRole('button', { name: /save workout log/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(screen.queryByText('No Main Movement Selected')).toBeNull();
    expect(onSaveMock).toHaveBeenCalled();
    expect(storage.getWorkoutLogs().length).toBe(1);
  });

  it('Scenario D: Strength + weighted Main Movement preserves existing normal save', async () => {
    const weightedEx: ExerciseEntry = {
      name: 'Back Squat',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 100, reps: 5, rpe: 8, form: 'standard' },
      ],
    };

    const program = createStrengthProgram('prog-scen-d', 'strength_linear', [weightedEx]);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    expect(isEligibleStrengthMainMovement(weightedEx)).toBe(true);
    expect(getEligibleMainMovementCount([weightedEx])).toBe(1);

    const onSaveMock = vi.fn();
    renderLogger({ programId: program.id, onSave: onSaveMock });

    const saveButton = screen.getByRole('button', { name: /save workout log/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(screen.queryByText('No Main Movement Selected')).toBeNull();
    expect(onSaveMock).toHaveBeenCalled();
    expect(storage.getWorkoutLogs().length).toBe(1);
  });

  it('Scenario E: Strength with no Main Movement displays the warning dialog', async () => {
    const unselectedEx: ExerciseEntry = {
      name: 'Back Squat',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: false,
      sets: [
        { setNumber: 1, weight: 100, reps: 5, rpe: 8, form: 'standard' },
      ],
    };

    const program = createStrengthProgram('prog-scen-e', 'strength_linear', [unselectedEx]);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    const onSaveMock = vi.fn();
    renderLogger({ programId: program.id, onSave: onSaveMock });

    const saveButton = screen.getByRole('button', { name: /save workout log/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    // Warning confirmation modal must be visible
    expect(screen.getByText('No Main Movement Selected')).toBeDefined();
    // Save should not have executed
    expect(onSaveMock).not.toHaveBeenCalled();
    expect(storage.getWorkoutLogs().length).toBe(0);
  });

  it('Scenario F: Strength with only a timed/distance/distance_loaded exercise checked retains warning', async () => {
    const timedEx: ExerciseEntry = {
      name: 'Plank',
      muscleGroup: 'Core',
      modality: 'timed',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 0, reps: 60, rpe: 8, form: 'standard' },
      ],
    };

    const program = createStrengthProgram('prog-scen-f', 'strength_linear', [timedEx]);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    // Timed is not an eligible strength main movement
    expect(isEligibleStrengthMainMovement(timedEx)).toBe(false);
    expect(getEligibleMainMovementCount([timedEx])).toBe(0);

    const onSaveMock = vi.fn();
    renderLogger({ programId: program.id, onSave: onSaveMock });

    const saveButton = screen.getByRole('button', { name: /save workout log/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(screen.getByText('No Main Movement Selected')).toBeDefined();
    expect(onSaveMock).not.toHaveBeenCalled();
  });

  it('Scenario G: Strength with more than one eligible Main Movement displays the exactly-one warning', async () => {
    const ex1: ExerciseEntry = {
      name: 'Back Squat',
      muscleGroup: 'Quads',
      modality: 'weighted',
      isMainMovement: true,
      sets: [{ setNumber: 1, weight: 100, reps: 5, rpe: 8 }],
    };
    const ex2: ExerciseEntry = {
      name: 'Pull-Up (Assisted)',
      muscleGroup: 'Back',
      modality: 'assisted',
      isMainMovement: true,
      sets: [{ setNumber: 1, weight: 20, reps: 5, rpe: 8 }],
    };

    const program = createStrengthProgram('prog-scen-g', 'strength_linear', [ex1, ex2]);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    expect(getEligibleMainMovementCount([ex1, ex2])).toBe(2);

    const onSaveMock = vi.fn();
    renderLogger({ programId: program.id, onSave: onSaveMock });

    const saveButton = screen.getByRole('button', { name: /save workout log/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    // Alert dialog with exactly-one warning must be shown
    expect(screen.getByText('Please select exactly one Main Movement before saving your Strength workout.')).toBeDefined();
    expect(onSaveMock).not.toHaveBeenCalled();
  });

  it('Scenario H: Restored draft with an assisted Main Movement is recognized without false warning', async () => {
    const assistedEx: ExerciseEntry = {
      name: 'Pull-Up (Assisted)',
      muscleGroup: 'Back',
      modality: 'assisted',
      isMainMovement: true,
      sets: [
        { setNumber: 1, weight: 17.5, reps: 5, rpe: 8, form: 'strict' },
      ],
    };

    const program = createStrengthProgram('prog-scen-h', 'strength_linear', [assistedEx]);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    // Seed draft into localStorage
    const draftPayload = {
      programId: program.id,
      weekNum: 1,
      dayNum: 1,
      isOneOff: false,
      dateStr: '2026-08-20',
      duration: 45,
      exercises: [assistedEx],
    };
    mockStorage.setItem('metreps_workout_draft', JSON.stringify(draftPayload));

    const onSaveMock = vi.fn();
    renderLogger({ programId: program.id, onSave: onSaveMock });

    const saveButton = screen.getByRole('button', { name: /save workout log/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    // No warning modal appears
    expect(screen.queryByText('No Main Movement Selected')).toBeNull();
    expect(onSaveMock).toHaveBeenCalled();
  });

  it('Scenario I: Save Anyway override saves session without discarding entered data', async () => {
    const unselectedEx: ExerciseEntry = {
      name: 'Pull-Up (Assisted)',
      muscleGroup: 'Back',
      modality: 'assisted',
      isMainMovement: false,
      sets: [
        { setNumber: 1, weight: 25, reps: 5, rpe: 8, form: 'strict' },
      ],
    };

    const program = createStrengthProgram('prog-scen-i', 'strength_linear', [unselectedEx]);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);
    storage.saveWorkoutLog({
      id: 'prev-log-scen-i',
      programId: program.id,
      date: '2026-08-10',
      unit: 'kg',
      exercises: [unselectedEx],
    });

    const onSaveMock = vi.fn();
    renderLogger({ programId: program.id, onSave: onSaveMock });

    // User modifies assist weight to 25 and reps to 5
    const spinbuttons = screen.getAllByRole('spinbutton');
    await act(async () => {
      fireEvent.change(spinbuttons[0], { target: { value: '25' } });
      fireEvent.change(spinbuttons[1], { target: { value: '5' } });
    });

    const saveButton = screen.getByRole('button', { name: /save workout log/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    // Warning appears
    expect(screen.getByText('No Main Movement Selected')).toBeDefined();

    // Click "Save Anyway"
    const saveAnywayButton = screen.getByRole('button', { name: /save anyway/i });
    await act(async () => {
      fireEvent.click(saveAnywayButton);
    });

    // Save executes and data is preserved
    expect(onSaveMock).toHaveBeenCalled();
    const logs = storage.getWorkoutLogs().filter(l => l.id !== 'prev-log-scen-i');
    expect(logs.length).toBe(1);
    expect(logs[0].exercises[0].sets[0].weight).toBe(25);
    expect(logs[0].exercises[0].sets[0].reps).toBe(5);
    expect(logs[0].exercises[0].sets[0].rpe).toBe(8);
  });
});
