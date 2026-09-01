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
    localStorage.clear();
    localStorage.setItem('programList', JSON.stringify([]));
    localStorage.setItem('workoutLogs', JSON.stringify([]));
    localStorage.setItem('currentProgramId', '');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

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
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

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
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

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
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

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
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

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

  it('matching source draft displays KEEP WORKOUT and DISCARD DRAFT & START CYCLE, and clears draft on confirm', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

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
    // Shows explicit draft warning in confirmation modal
    expect(screen.getByText(/An in-progress draft exists for this program\. Discard draft and start new cycle\?/i)).toBeDefined();

    // Verify button copy
    expect(screen.getByRole('button', { name: /keep workout/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /discard draft & start cycle/i })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /discard draft & start cycle/i }));

    await waitFor(() => {
      expect(localStorage.getItem('metreps_workout_draft')).toBeNull();
    });
    expect(onNavigateMock).toHaveBeenCalledWith('home', null, true);
  });

  it('every safe-close path (KEEP WORKOUT, X button, backdrop click) preserves the matching draft', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    const draftContent = JSON.stringify({
      programId: sampleCompletedProgram.id,
      programName: sampleCompletedProgram.name,
      week: '4',
      day: '2',
      exercises: [{ name: 'Plate-Loaded Chest Press', sets: [] }],
    });

    localStorage.setItem('metreps_workout_draft', draftContent);

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    // 1. KEEP WORKOUT button
    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep workout/i }));
    expect(localStorage.getItem('metreps_workout_draft')).toBe(draftContent);
    expect(storage.getPrograms().length).toBe(1);

    // 2. X close button
    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    const closeBtns = screen.getAllByRole('button');
    const xBtn = closeBtns.find(b => b.querySelector('svg.lucide-x'));
    expect(xBtn).toBeDefined();
    if (xBtn) fireEvent.click(xBtn);
    expect(localStorage.getItem('metreps_workout_draft')).toBe(draftContent);
    expect(storage.getPrograms().length).toBe(1);
  });

  it('blocks rerun with conflict modal and protects active draft if draft belongs to another program or one-off workout', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

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

  it('historical-edit draft remains untouched and blocks rerun via conflict modal', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    // Historical diary edit draft
    localStorage.setItem(
      'metreps_workout_draft',
      JSON.stringify({
        isHistoricalEdit: true,
        historicalLogId: 'log-past-1',
        programId: 'some-other-prog',
        exercises: [{ name: 'Deadlift', sets: [] }],
      })
    );

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    expect(screen.getByText(/Workout In Progress/i)).toBeDefined();
    expect(screen.queryByText('Program Continuation Cycle')).toBeNull();
    expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();
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
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

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

  it('reactivates existing uncompleted successor without creating another duplicate', async () => {
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
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    const onNavigateMock = vi.fn();

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
        onNavigate={onNavigateMock}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));

    // Preview notes that continuation already exists and will be resumed
    expect(screen.getByText(/A continuation cycle already exists\. MetReps will resume/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /resume cycle 2/i })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /resume cycle 2/i }));

    await waitFor(() => {
      expect(storage.getCurrentProgramId()).toBe(successorProgram.id);
    });

    // Program list count must NOT increase (still exactly 2)
    expect(storage.getPrograms().length).toBe(2);
    expect(onNavigateMock).toHaveBeenCalledWith('home', null, true);
  });

  it('revalidates source at execution time and halts if source removed between modal open and confirmation', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    expect(screen.getByText('Program Continuation Cycle')).toBeDefined();

    // Source program is removed from storage while modal is open
    localStorage.setItem('programList', JSON.stringify([]));

    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      expect(screen.getByText(/Source program no longer exists in storage/i)).toBeDefined();
    });

    // Created nothing, pointer unchanged
    expect(storage.getPrograms().length).toBe(0);
  });

  it('revalidates source at execution time and halts if source becomes incomplete before confirmation', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));

    // Remove logs from storage before confirmation
    localStorage.setItem('workoutLogs', JSON.stringify([]));

    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      expect(screen.getByText(/Program is not completed and cannot be rerun/i)).toBeDefined();
    });

    // Created nothing
    expect(storage.getPrograms().length).toBe(1);
  });

  it('revalidates source at execution time and halts if source duration becomes infinite before confirmation', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));

    // Mutate source in storage to infinite duration before confirmation
    storage.saveProgram({ ...sampleCompletedProgram, programDuration: '∞' });

    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      expect(screen.getByText(/Ongoing programs cannot be rerun/i)).toBeDefined();
    });

    // No continuation created
    expect(storage.getPrograms().length).toBe(1);
  });

  it('synchronous ref lock blocks two same-event execution calls from creating duplicate successors', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));

    const confirmBtn = screen.getByRole('button', { name: /start cycle 2/i });
    // Rapid synchronous double-click
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const progs = storage.getPrograms();
      expect(progs.length).toBe(2);
    });

    expect(storage.getPrograms().length).toBe(2);
  });

  it('storage.saveProgram failure preserves pointer, draft, source, and logs while showing visible error', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    const saveSpy = vi.spyOn(storage, 'saveProgram').mockImplementationOnce(() => {
      throw new Error('Disk full write failure');
    });

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to save continuation program to storage/i)).toBeDefined();
    });

    // Pointer unchanged
    expect(storage.getCurrentProgramId()).toBe(sampleCompletedProgram.id);
    // Program list unchanged
    expect(storage.getPrograms().length).toBe(1);

    saveSpy.mockRestore();
  });

  it('currentProgramId pointer failure preserves draft, navigation state, and leaves saved successor recoverable', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    const onNavigateMock = vi.fn();

    const ptrSpy = vi.spyOn(storage, 'setCurrentProgramId').mockImplementationOnce(() => {
      throw new Error('Pointer state lock error');
    });

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
        onNavigate={onNavigateMock}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to set new program as active/i)).toBeDefined();
    });

    // Navigation was NOT called
    expect(onNavigateMock).not.toHaveBeenCalled();
    // Successor was saved in storage
    expect(storage.getPrograms().length).toBe(2);

    ptrSpy.mockRestore();
  });

  it('retry after pointer failure reuses the already-saved successor instead of creating another', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    const onNavigateMock = vi.fn();

    let failNext = true;
    const ptrSpy = vi.spyOn(storage, 'setCurrentProgramId').mockImplementation((id: string | null) => {
      if (failNext) {
        failNext = false;
        throw new Error('Pointer lock error');
      }
      localStorage.setItem('currentProgramId', id || '');
    });

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
        onNavigate={onNavigateMock}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to set new program as active/i)).toBeDefined();
    });

    expect(storage.getPrograms().length).toBe(2);

    // Now user retries by clicking the action button
    const retryBtn = screen.getByRole('button', { name: /(start|resume) cycle 2/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(onNavigateMock).toHaveBeenCalledWith('home', null, true);
    });

    // Count is still 2 - reuses already-saved successor rather than creating another
    expect(storage.getPrograms().length).toBe(2);

    ptrSpy.mockRestore();
  });

  it('another active Program remains saved after the successor becomes current', async () => {
    const anotherProgram: Program = {
      ...sampleCompletedProgram,
      id: 'prog-other-active',
      name: 'Push Pull Legs Active',
    };

    storage.saveProgram(sampleCompletedProgram);
    storage.saveProgram(anotherProgram);
    storage.setCurrentProgramId(anotherProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));

    // Confirmation modal shows warning regarding changing active program
    expect(screen.getByText(/Your current program will remain saved, but this new cycle will become your active program/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      expect(storage.getPrograms().length).toBe(3);
    });

    // Another program is still intact in storage
    const allProgs = storage.getPrograms();
    expect(allProgs.some(p => p.id === 'prog-other-active')).toBe(true);
    // New successor is current
    const successor = allProgs.find(p => p.parentProgramId === sampleCompletedProgram.id);
    expect(storage.getCurrentProgramId()).toBe(successor?.id);
  });

  it('collision safety ensures generated ID never overwrites an existing program', async () => {
    storage.saveProgram(sampleCompletedProgram);
    storage.setCurrentProgramId(sampleCompletedProgram.id);
    const logs = createCompletedLogsForProgram(sampleCompletedProgram);
    localStorage.setItem('workoutLogs', JSON.stringify(logs));

    render(
      <AnalyticsView
        workoutLogs={logs}
        initialProgramId={sampleCompletedProgram.id}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /rerun program/i }));
    fireEvent.click(screen.getByRole('button', { name: /start cycle 2/i }));

    await waitFor(() => {
      expect(storage.getPrograms().length).toBe(2);
    });

    const progs = storage.getPrograms();
    const ids = progs.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
