// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HomeView } from '../../components/HomeView';
import App from '../../App';
import { storage } from '../storage';
import { getTodayLocalDateString } from '../dateUtils';
import { WorkoutLog, Program, ExerciseEntry } from '../../types';

if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.alert = () => {};
}

const createBenchPressExercise = (): ExerciseEntry => ({
  name: 'Barbell Bench Press',
  muscleGroup: 'Chest',
  modality: 'weighted',
  sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8, isCompleted: true }],
});

const createSquatExercise = (): ExerciseEntry => ({
  name: 'Barbell Squat',
  muscleGroup: 'Quads',
  modality: 'weighted',
  sets: [{ setNumber: 1, weight: 140, reps: 5, rpe: 8.5, isCompleted: true }],
});

const createOneOffLog = (id: string, date: string): WorkoutLog => ({
  id,
  date,
  programId: null,
  program: 'One Off',
  week: '—',
  day: '—',
  unit: 'kg',
  exercises: [createBenchPressExercise()],
});

const createProgrammedLog = (id: string, date: string, programId: string): WorkoutLog => ({
  id,
  date,
  programId,
  program: 'Strength Alpha',
  week: '2',
  day: '1',
  unit: 'kg',
  exercises: [createSquatExercise()],
});

const createMockProgram = (id: string): Program => ({
  id,
  name: 'Strength Alpha',
  daysPerWeek: 3,
  programDuration: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  exercisesByDay: {
    1: [createSquatExercise()],
    2: [createBenchPressExercise()],
    3: [createSquatExercise()],
  },
  assignedWeekdays: { 1: 0, 2: 2, 3: 4 },
});

describe('MetReps — Redo Workout Navigation Presentation Fix Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('workoutLogs', '[]');
    localStorage.setItem('programList', '[]');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('TEST 1 — ONE-OFF SOURCE LOG: clicking REDO WORKOUT TODAY calls onNavigate with redoFromLogId and isOneOff: true', () => {
    const today = getTodayLocalDateString();
    const sourceLog = createOneOffLog('log-oneoff-test-1', today);
    const onNavigateSpy = vi.fn();

    render(
      <HomeView
        currentProgram={null}
        workoutLogs={[sourceLog]}
        selectedDate={today}
        setSelectedDate={() => {}}
        onNavigate={onNavigateSpy}
      />
    );

    const redoButton = screen.getByRole('button', { name: /redo workout today/i });
    fireEvent.click(redoButton);

    expect(onNavigateSpy).toHaveBeenCalledTimes(1);
    expect(onNavigateSpy).toHaveBeenCalledWith('logger', {
      redoFromLogId: sourceLog.id,
      isOneOff: true,
    });
  });

  it('TEST 2 — PROGRAMMED SOURCE LOG: clicking REDO WORKOUT TODAY calls onNavigate with redoFromLogId and isOneOff: true without program metadata', () => {
    const today = getTodayLocalDateString();
    const sourceLog = createProgrammedLog('log-prog-test-2', today, 'prog-alpha-77');
    const onNavigateSpy = vi.fn();

    render(
      <HomeView
        currentProgram={null}
        workoutLogs={[sourceLog]}
        selectedDate={today}
        setSelectedDate={() => {}}
        onNavigate={onNavigateSpy}
      />
    );

    const redoButton = screen.getByRole('button', { name: /redo workout today/i });
    fireEvent.click(redoButton);

    expect(onNavigateSpy).toHaveBeenCalledTimes(1);
    expect(onNavigateSpy).toHaveBeenCalledWith('logger', {
      redoFromLogId: sourceLog.id,
      isOneOff: true,
    });

    const passedParams = onNavigateSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(passedParams.programId).toBeUndefined();
    expect(passedParams.programName).toBeUndefined();
    expect(passedParams.week).toBeUndefined();
    expect(passedParams.day).toBeUndefined();
    expect(passedParams.scheduledDate).toBeUndefined();
  });

  it('TEST 3 — VISIBLE NAVIGATION RESULT: clicking REDO WORKOUT TODAY highlights ONE-OFF and not WORKOUT in bottom navigation', () => {
    const today = getTodayLocalDateString();
    const sourceLog = createOneOffLog('log-oneoff-test-3', today);

    storage.saveWorkoutLog(sourceLog);

    render(<App />);

    const redoButton = screen.getByRole('button', { name: /redo workout today/i });
    fireEvent.click(redoButton);

    const bottomNav = screen.getByRole('navigation');
    const workoutNavButton = Array.from(bottomNav.querySelectorAll('button')).find(btn =>
      btn.textContent?.includes('Workout')
    );
    const oneOffNavButton = Array.from(bottomNav.querySelectorAll('button')).find(btn =>
      btn.textContent?.includes('One-Off')
    );

    expect(workoutNavButton).toBeDefined();
    expect(oneOffNavButton).toBeDefined();

    expect(oneOffNavButton?.className).toContain('text-indigo-400');
    expect(workoutNavButton?.className).not.toContain('text-indigo-400');
    expect(workoutNavButton?.className).toContain('hover:text-slate-200');

    const oneOffActiveIndicator = oneOffNavButton?.querySelector('.rounded-full.bg-indigo-400');
    const workoutActiveIndicator = workoutNavButton?.querySelector('.rounded-full.bg-indigo-400');

    expect(oneOffActiveIndicator).not.toBeNull();
    expect(workoutActiveIndicator).toBeNull();
  });

  it('TEST 4 — ACTIVE PROGRAM PRESENT: redoing historical one-off highlights ONE-OFF without attaching active program metadata', () => {
    const today = getTodayLocalDateString();
    const activeProgram = createMockProgram('prog-active-99');
    const sourceLog = createOneOffLog('log-oneoff-test-4', today);

    storage.saveProgram(activeProgram);
    storage.setCurrentProgramId(activeProgram.id);
    storage.saveWorkoutLog(sourceLog);

    render(<App />);

    const redoButton = screen.getByRole('button', { name: /redo workout today/i });
    fireEvent.click(redoButton);

    const bottomNav = screen.getByRole('navigation');
    const workoutNavButton = Array.from(bottomNav.querySelectorAll('button')).find(btn =>
      btn.textContent?.includes('Workout')
    );
    const oneOffNavButton = Array.from(bottomNav.querySelectorAll('button')).find(btn =>
      btn.textContent?.includes('One-Off')
    );

    expect(oneOffNavButton?.className).toContain('text-indigo-400');
    expect(workoutNavButton?.className).not.toContain('text-indigo-400');

    const storedParamsRaw = localStorage.getItem('metreps_view_params');
    expect(storedParamsRaw).not.toBeNull();
    const storedParams = JSON.parse(storedParamsRaw || '{}') as Record<string, unknown>;

    expect(storedParams).toEqual({
      redoFromLogId: sourceLog.id,
      isOneOff: true,
    });
    expect(storedParams.programId).toBeUndefined();
    expect(storedParams.programName).toBeUndefined();
  });

  it('TEST 5 — NORMAL NAVIGATION REGRESSION: clicking normal WORKOUT and normal ONE-OFF navigation controls highlights their respective tabs', () => {
    const activeProgram = createMockProgram('prog-regression-5');
    storage.saveProgram(activeProgram);
    storage.setCurrentProgramId(activeProgram.id);

    const { unmount } = render(<App />);

    const bottomNav = screen.getByRole('navigation');
    const workoutNavButton = Array.from(bottomNav.querySelectorAll('button')).find(btn =>
      btn.textContent?.includes('Workout')
    );
    const oneOffNavButton = Array.from(bottomNav.querySelectorAll('button')).find(btn =>
      btn.textContent?.includes('One-Off')
    );

    expect(workoutNavButton).toBeDefined();
    expect(oneOffNavButton).toBeDefined();

    // 1. Click normal ONE-OFF nav control from Home view
    fireEvent.click(oneOffNavButton!);
    expect(oneOffNavButton?.className).toContain('text-indigo-400');
    expect(workoutNavButton?.className).not.toContain('text-indigo-400');
    expect(oneOffNavButton?.querySelector('.rounded-full.bg-indigo-400')).not.toBeNull();
    expect(workoutNavButton?.querySelector('.rounded-full.bg-indigo-400')).toBeNull();

    unmount();
    localStorage.clear();
    storage.saveProgram(activeProgram);
    storage.setCurrentProgramId(activeProgram.id);

    render(<App />);

    const freshBottomNav = screen.getByRole('navigation');
    const freshWorkoutNavButton = Array.from(freshBottomNav.querySelectorAll('button')).find(btn =>
      btn.textContent?.includes('Workout')
    );
    const freshOneOffNavButton = Array.from(freshBottomNav.querySelectorAll('button')).find(btn =>
      btn.textContent?.includes('One-Off')
    );

    // 2. Click normal WORKOUT nav control from Home view
    fireEvent.click(freshWorkoutNavButton!);
    expect(freshWorkoutNavButton?.className).toContain('text-indigo-400');
    expect(freshOneOffNavButton?.className).not.toContain('text-indigo-400');
    expect(freshWorkoutNavButton?.querySelector('.rounded-full.bg-indigo-400')).not.toBeNull();
    expect(freshOneOffNavButton?.querySelector('.rounded-full.bg-indigo-400')).toBeNull();
  });
});
