// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnalyticsView } from '../../components/AnalyticsView';
import { Program, WorkoutLog } from '../../types';
import { storage } from '../storage';
import { createProgramContinuation } from '../programContinuation';

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

if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as any;
} else {
  (globalThis as any).window = { scrollTo: () => {} };
}

describe('RPC-2B: Program Report Card Rerun Action Suite', () => {
  beforeEach(() => {
    window.localStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const sampleCompletedProgram: Program = {
    id: 'prog-completed-1',
    name: 'Milhouse Mass Split',
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_step',
    programDuration: 4,
    daysPerWeek: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    exercisesByDay: {
      1: [
        {
          name: 'Hack Squat (Machine)',
          muscleGroup: 'Quads',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          sets: [{ setNumber: 1, reps: 10, weight: 100 }],
        },
      ],
      2: [
        {
          name: 'Plate-Loaded Chest Press',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          movementCategory: 'compound',
          equipment: 'machine',
          sets: [{ setNumber: 1, reps: 10, weight: 80 }],
        },
      ],
    },
    assignedWeekdays: { 1: 0, 2: 2 },
  };

  const sampleInfiniteProgram: Program = {
    id: 'prog-infinite-1',
    name: 'Endless Linear Block',
    objective: 'Strength',
    algorithmId: 'hypertrophy_linear',
    programDuration: '∞',
    daysPerWeek: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    exercisesByDay: {
      1: [
        {
          name: 'Back Squat (High Bar)',
          muscleGroup: 'Quads',
          modality: 'weighted',
          sets: [{ setNumber: 1, reps: 5, weight: 120 }],
        },
      ],
    },
  };

  const createCompletedLogsForProgram = (program: Program): WorkoutLog[] => {
    const totalWeeks = Number(program.programDuration);
    const logs: WorkoutLog[] = [];
    for (let w = 1; w <= totalWeeks; w++) {
      for (let d = 1; d <= program.daysPerWeek; d++) {
        const dayExercises = program.exercisesByDay[d] || [];
        logs.push({
          id: `log-${w}-${d}`,
          date: `2026-01-${String(w * 7 + d).padStart(2, '0')}`,
          programId: program.id,
          week: String(w),
          day: String(d),
          unit: 'kg',
          durationMinutes: 60,
          exercises: dayExercises.map(ex => ({
            name: ex.name,
            muscleGroup: ex.muscleGroup,
            modality: ex.modality,
            sets: ex.sets.map(s => ({
              setNumber: s.setNumber,
              weight: s.weight || 100,
              reps: s.reps || 10,
              isCompleted: true,
            })),
          })),
        });
      }
    }
    return logs;
  };

  it('renders Rerun Program button on completed finite-duration program report card', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    expect(screen.getByText('PROGRAM REPORT CARD')).toBeDefined();
    expect(screen.getByText('Final Performance Evaluation')).toBeDefined();

    const rerunBtn = screen.getByRole('button', { name: /rerun program/i });
    expect(rerunBtn).toBeDefined();
  });

  it('does NOT render Rerun Program button on ongoing infinite-duration program report card', async () => {
    storage.saveProgram(sampleInfiniteProgram);
    storage.setCurrentProgramId(sampleInfiniteProgram.id);

    const logs: WorkoutLog[] = [
      {
        id: 'log-inf-1',
        date: '2026-01-02',
        programId: sampleInfiniteProgram.id,
        week: '1',
        day: '1',
        unit: 'kg',
        durationMinutes: 45,
        exercises: [
          {
            name: 'Back Squat (High Bar)',
            muscleGroup: 'Quads',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 120, reps: 5, isCompleted: true }],
          },
        ],
      },
    ];

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleInfiniteProgram.id}
      />
    );

    expect(screen.getByText('Interim Midterm Analysis')).toBeDefined();
    expect(screen.queryByRole('button', { name: /rerun program/i })).toBeNull();
  });

  it('opens confirmation modal with formatted next cycle name and metadata upon clicking Rerun Program', async () => {
    storage.saveProgram(sampleCompletedProgram);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    const rerunBtn = screen.getByRole('button', { name: /rerun program/i });
    fireEvent.click(rerunBtn);

    // Modal title & content
    expect(screen.getByText('Program Continuation Cycle')).toBeDefined();
    expect(screen.getByText('Milhouse Mass Split — Cycle 2')).toBeDefined();
    expect(screen.getByText('Cycle 2')).toBeDefined();
    expect(screen.getByText(/Starts fresh at/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /start cycle 2/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined();
  });

  it('cancels rerun modal and leaves state unchanged when CANCEL is clicked', async () => {
    storage.saveProgram(sampleCompletedProgram);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    expect(screen.getByText('Program Continuation Cycle')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Modal closed
    expect(screen.queryByText('Program Continuation Cycle')).toBeNull();
    // Storage has only original program
    const allProgs = storage.getPrograms();
    expect(allProgs.length).toBe(1);
    expect(allProgs[0].id).toBe(sampleCompletedProgram.id);
  });

  it('executes atomic rerun transaction, creates linked Cycle 2, updates currentProgramId, and navigates to home', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);

    const onNavigateMock = vi.fn();
    const onRefreshMock = vi.fn();

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
        onNavigate={onNavigateMock}
        onRefresh={onRefreshMock}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      const allProgs = storage.getPrograms();
      expect(allProgs.length).toBe(2);
    });

    const allProgs = storage.getPrograms();
    const successor = allProgs.find(p => p.id !== sampleCompletedProgram.id);
    expect(successor).toBeDefined();
    expect(successor?.name).toBe('Milhouse Mass Split — Cycle 2');
    expect(successor?.parentProgramId).toBe(sampleCompletedProgram.id);
    expect(successor?.cycleIndex).toBe(2);
    expect(successor?.daysPerWeek).toBe(sampleCompletedProgram.daysPerWeek);
    expect(successor?.programDuration).toBe(sampleCompletedProgram.programDuration);
    expect(successor?.algorithmId).toBe('hypertrophy_step');
    expect(successor?.algorithmPhaseOffset).toBe(4); // 4 weeks duration offset
    expect(successor?.exercisesByDay[1][0].name).toBe('Hack Squat (Machine)');

    // Verify currentProgramId set to successor
    expect(storage.getCurrentProgramId()).toBe(successor?.id);

    // Verify callbacks
    expect(onRefreshMock).toHaveBeenCalled();
    expect(onNavigateMock).toHaveBeenCalledWith('home', null, true);
  });

  it('clears active draft if the draft belonged to the completed source program', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);

    // Seed draft for source program
    localStorage.setItem(
      'metreps_workout_draft',
      JSON.stringify({
        programId: sampleCompletedProgram.id,
        programName: sampleCompletedProgram.name,
        week: '4',
        day: '2',
        exercises: [{ name: 'Plate-Loaded Chest Press', sets: [] }],
      })
    );

    const onNavigateMock = vi.fn();
    const onRefreshMock = vi.fn();

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
        onNavigate={onNavigateMock}
        onRefresh={onRefreshMock}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    // Shows stale draft warning in confirmation modal
    expect(screen.getByText(/An unfinished workout draft for this completed program will be discarded/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      expect(localStorage.getItem('metreps_workout_draft')).toBeNull();
    });
  });

  it('blocks rerun with conflict modal and protects active draft if draft belongs to another program or one-off workout', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);

    // Seed active one-off workout draft
    localStorage.setItem(
      'metreps_workout_draft',
      JSON.stringify({
        isOneOff: true,
        workoutName: 'Quick Arm Session',
        exercises: [{ name: 'Bicep Curl', sets: [] }],
      })
    );

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));

    // Conflict modal is shown, Rerun confirmation is NOT shown
    expect(screen.getByText(/Workout In Progress/i)).toBeDefined();
    expect(screen.getByText(/Unsaved Session Protection/i)).toBeDefined();
    expect(screen.queryByText('Program Continuation Cycle')).toBeNull();

    // The active draft in localStorage is intact
    expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();
    // Storage programs unchanged
    expect(storage.getPrograms().length).toBe(1);
  });

  it('correctly creates Cycle 3 with cumulative phase offset when rerunning a completed Cycle 2', async () => {
    const cycle2Program: Program = {
      ...sampleCompletedProgram,
      id: 'prog-cycle-2',
      name: 'Milhouse Mass Split — Cycle 2',
      cycleIndex: 2,
      parentProgramId: 'prog-completed-1',
      algorithmPhaseOffset: 4,
    };

    storage.saveProgram(cycle2Program);
    storage.setCurrentProgramId(cycle2Program.id);
    const logs = createCompletedLogsForProgram(cycle2Program);

    const onNavigateMock = vi.fn();
    const onRefreshMock = vi.fn();

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={cycle2Program.id}
        onNavigate={onNavigateMock}
        onRefresh={onRefreshMock}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));

    expect(screen.getByText('Milhouse Mass Split — Cycle 3')).toBeDefined();
    expect(screen.getByText('Cycle 3')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /start cycle 3/i }));

    await waitFor(() => {
      const allProgs = storage.getPrograms();
      expect(allProgs.length).toBe(2);
    });

    const allProgs = storage.getPrograms();
    const cycle3 = allProgs.find(p => p.id !== cycle2Program.id);
    expect(cycle3).toBeDefined();
    expect(cycle3?.name).toBe('Milhouse Mass Split — Cycle 3');
    expect(cycle3?.cycleIndex).toBe(3);
    expect(cycle3?.parentProgramId).toBe('prog-cycle-2');
    expect(cycle3?.algorithmPhaseOffset).toBe(8); // 4 + 4 = 8
    expect(storage.getCurrentProgramId()).toBe(cycle3?.id);
    expect(onNavigateMock).toHaveBeenCalledWith('home', null, true);
  });

  it('displays note if a successor cycle already exists in storage', async () => {
    const successorProgram: Program = {
      ...sampleCompletedProgram,
      id: 'prog-cycle-2-existing',
      name: 'Milhouse Mass Split — Cycle 2',
      cycleIndex: 2,
      parentProgramId: sampleCompletedProgram.id,
    };

    storage.saveProgram(sampleCompletedProgram);
    storage.saveProgram(successorProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));

    expect(screen.getByText(/A continuation cycle \(Milhouse Mass Split — Cycle 2\) already exists in your library/i)).toBeDefined();
  });
});
