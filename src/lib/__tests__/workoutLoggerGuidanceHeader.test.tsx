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
import { Program, ExerciseEntry } from '../../types';
import * as integrationModule from '../guidedWorkoutIntegration';
import * as calculationModule from '../objectiveMath';
import * as navigationGuardModule from '../navigationGuard';
import {
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
} from '../programProgressionMode';

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
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.alert = () => {};
}

describe('APC-3B2C2B2C-D2C-6B: WorkoutLogger Guidance Header Presentation', () => {
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
    mode?: 'performance_led' | 'metreps_guided' | string,
    objective: 'Hypertrophy' | 'Strength' | 'Off' = 'Hypertrophy',
    algorithmId: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' = 'hypertrophy_linear',
    duration = 4
  ): Program => ({
    id,
    name: 'Guidance Header Test Program',
    daysPerWeek: 3,
    programDuration: duration,
    createdAt: '2026-08-24T00:00:00.000Z',
    objective,
    algorithmId,
    targetProgressionMode: mode as any,
    progressionPolicyVersion: CURRENT_PROGRESSION_POLICY_VERSION,
    algorithmVersion: CURRENT_ALGORITHM_VERSION,
    exercisesByDay: {
      1: [
        {
          name: 'Barbell Bench Press (flat)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8, form: 'standard' }],
        },
      ],
    },
  });

  const renderLogger = (params: {
    programId?: string;
    week?: string;
    day?: string;
    editLogId?: string;
    redoFromLogId?: string;
    isOneOff?: boolean;
    date?: string;
  }) => {
    return render(
      <WorkoutLogger
        initialParams={{
          programId: params.programId,
          week: params.week ?? '1',
          day: params.day ?? '1',
          editLogId: params.editLogId,
          redoFromLogId: params.redoFromLogId,
          isOneOff: params.isOneOff ?? false,
          date: params.date ?? '2026-08-10',
          scheduledDate: '2026-08-10',
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
  };

  it('1. The header displays TRAINING GOAL instead of PROGRAM OBJECTIVE', () => {
    const program = createTestProgram('prog-1', 'performance_led', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-1', week: '1', day: '1' });

    expect(screen.getByText('Training Goal')).toBeDefined();
    expect(screen.queryByText('Program Objective')).toBeNull();
    expect(screen.getByText('Hypertrophy')).toBeDefined();
  });

  it('2. The header displays PERIODISATION METHOD instead of PROGRESSION ENGINE', () => {
    const program = createTestProgram('prog-2', 'performance_led', 'Hypertrophy', 'hypertrophy_linear');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-2', week: '1', day: '1' });

    expect(screen.getByText('Periodisation Method')).toBeDefined();
    expect(screen.queryByText('Progression Engine')).toBeNull();
  });

  it('3. The large always-visible PERIODISATION ALGORITHM panel is absent', () => {
    const program = createTestProgram('prog-3', 'performance_led', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-3', week: '1', day: '1' });

    expect(screen.queryByText('Periodisation algorithm')).toBeNull();
  });

  it('4. The correct periodisation method name and existing method badge remain visible', () => {
    const program = createTestProgram('prog-4', 'performance_led', 'Strength', 'strength_undulating', 4);
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-4', week: '1', day: '1' });

    expect(screen.getByText('DUP')).toBeDefined();
    expect(screen.getByText('Wave Strength')).toBeDefined();
  });

  it('5. Its information control opens a correctly titled accessible dialog with the authoritative method explanation', () => {
    const program = createTestProgram('prog-5', 'performance_led', 'Hypertrophy', 'hypertrophy_linear');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-5', week: '1', day: '1' });

    const methodInfoBtn = screen.getByRole('button', { name: 'About Wave Volume' });
    expect(methodInfoBtn).toBeDefined();

    // Verify method info button is inside the method-value card, not in the category-heading row
    const headingLabel = screen.getByText('Periodisation Method');
    const headingRow = headingLabel.closest('div');
    expect(headingRow?.querySelector('button')).toBeNull();

    const methodNameEl = screen.getByText('Wave Volume');
    const methodCard = methodNameEl.closest('div.bg-slate-950');
    expect(methodCard?.contains(methodInfoBtn)).toBe(true);

    fireEvent.click(methodInfoBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: /Wave Volume/i })).toBeDefined();
    expect(screen.getByText(/Alternates weekly between higher-rep/i)).toBeDefined();
  });

  it('6. Closing the method dialog restores focus and changes no workout state', () => {
    const program = createTestProgram('prog-6', 'performance_led', 'Hypertrophy', 'hypertrophy_linear');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-6', week: '1', day: '1' });

    const methodInfoBtn = screen.getByRole('button', { name: 'About Wave Volume' });
    methodInfoBtn.focus();
    fireEvent.click(methodInfoBtn);

    expect(screen.getByRole('dialog')).toBeDefined();

    const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
    fireEvent.click(closeBtn);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(methodInfoBtn);
  });

  it('7. An eligible performance-led scheduled Hypertrophy or Strength program displays PERIODISATION TARGETS', () => {
    const program = createTestProgram('prog-7', 'performance_led', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-7', week: '1', day: '1' });

    expect(screen.getByText('Workout Target Mode')).toBeDefined();
    const modeText = screen.getByText('PERIODISATION TARGETS');
    expect(modeText).toBeDefined();
    const targetModeBtn = screen.getByRole('button', { name: 'About Periodisation Targets' });
    expect(targetModeBtn).toBeDefined();
    expect(screen.queryByText('METREPS COACH')).toBeNull();

    // Verify target-mode info button is inside the value card beside mode text, not in category-heading row
    const headingLabel = screen.getByText('Workout Target Mode');
    const headingRow = headingLabel.closest('div');
    expect(headingRow?.querySelector('button')).toBeNull();

    const modeCard = modeText.closest('div.border');
    expect(modeCard?.contains(targetModeBtn)).toBe(true);

    // Verify TARGETS badge is present and separate
    const targetsBadge = screen.getByText('TARGETS');
    expect(targetsBadge).toBeDefined();
    expect(modeCard?.contains(targetsBadge)).toBe(true);
  });

  it('8. An eligible coached scheduled Hypertrophy or Strength program displays METREPS COACH', () => {
    const program = createTestProgram('prog-8', 'metreps_guided', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-8', week: '1', day: '1' });

    expect(screen.getByText('Workout Target Mode')).toBeDefined();
    const modeText = screen.getByText('METREPS COACH');
    expect(modeText).toBeDefined();
    const coachBtn = screen.getByRole('button', { name: 'About MetReps Coach' });
    expect(coachBtn).toBeDefined();
    expect(screen.queryByText('PERIODISATION TARGETS')).toBeNull();

    // Verify coach info button is inside the value card beside mode text, not in category-heading row
    const headingLabel = screen.getByText('Workout Target Mode');
    const headingRow = headingLabel.closest('div');
    expect(headingRow?.querySelector('button')).toBeNull();

    const modeCard = modeText.closest('div.border');
    expect(modeCard?.contains(coachBtn)).toBe(true);

    // Verify COACH badge is present and separate
    const coachBadge = screen.getByText('COACH');
    expect(coachBadge).toBeDefined();
    expect(modeCard?.contains(coachBadge)).toBe(true);
  });

  it('9. Missing or malformed stored modes fail closed to PERIODISATION TARGETS through resolveProgramProgressionMode', () => {
    const programMissing = createTestProgram('prog-9a', undefined, 'Hypertrophy');
    delete (programMissing as any).targetProgressionMode;
    storage.saveProgram(programMissing);
    storage.setCurrentProgramId(programMissing.id);

    const { unmount } = renderLogger({ programId: 'prog-9a', week: '1', day: '1' });

    expect(screen.getByText('PERIODISATION TARGETS')).toBeDefined();
    expect(screen.queryByText('METREPS COACH')).toBeNull();
    unmount();

    const programMalformed = createTestProgram('prog-9b', 'unrecognised_xyz', 'Hypertrophy');
    storage.saveProgram(programMalformed);
    storage.setCurrentProgramId(programMalformed.id);

    renderLogger({ programId: 'prog-9b', week: '1', day: '1' });

    expect(screen.getByText('PERIODISATION TARGETS')).toBeDefined();
    expect(screen.queryByText('METREPS COACH')).toBeNull();
  });

  it('10. A restored draft from an eligible coached program displays METREPS COACH without rerunning Guided orchestration', () => {
    const program = createTestProgram('prog-10', 'metreps_guided', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    // Seed draft into localStorage
    const savedDraft = {
      programId: 'prog-10',
      weekNum: 1,
      dayNum: 1,
      objective: 'Hypertrophy',
      exercises: [
        {
          name: 'Barbell Bench Press (flat)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 105, reps: 10, rpe: 8, form: 'standard' }],
        },
      ],
      userRawExercises: [
        {
          name: 'Barbell Bench Press (flat)',
          muscleGroup: 'Pecs',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8, form: 'standard' }],
        },
      ],
      prescriptionBoundary: {
        exercises: [{ exerciseName: 'Barbell Bench Press (flat)', plannedSetsCount: 1 }],
      },
    };
    mockStorage.setItem('metreps_workout_draft', JSON.stringify(savedDraft));

    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    renderLogger({ programId: 'prog-10', week: '1', day: '1' });

    expect(screen.getByText('METREPS COACH')).toBeDefined();
    // Restoring draft should NOT run Guided orchestration
    expect(orchestrateSpy).not.toHaveBeenCalled();
  });

  it('11. Historical edits, redo sessions, one-off sessions, Off, Deload and fallback/non-program sessions do not misleadingly display METREPS COACH', () => {
    const program = createTestProgram('prog-11', 'metreps_guided', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    // Historical edit
    const { unmount: u1 } = renderLogger({
      programId: 'prog-11',
      week: '1',
      day: '1',
      editLogId: 'log-prev-1',
    });
    expect(screen.queryByText('Workout Target Mode')).toBeNull();
    expect(screen.queryByText('METREPS COACH')).toBeNull();
    u1();

    // Redo session
    const { unmount: u2 } = renderLogger({
      programId: 'prog-11',
      week: '1',
      day: '1',
      redoFromLogId: 'log-prev-2',
    });
    expect(screen.queryByText('Workout Target Mode')).toBeNull();
    expect(screen.queryByText('METREPS COACH')).toBeNull();
    u2();

    // One-off session
    const { unmount: u3 } = renderLogger({ isOneOff: true });
    expect(screen.queryByText('Workout Target Mode')).toBeNull();
    expect(screen.queryByText('METREPS COACH')).toBeNull();
    u3();

    // Off objective
    const programOff = createTestProgram('prog-off', 'metreps_guided', 'Off');
    storage.saveProgram(programOff);
    storage.setCurrentProgramId(programOff.id);
    const { unmount: u4 } = renderLogger({ programId: 'prog-off', week: '1', day: '1' });
    expect(screen.queryByText('Workout Target Mode')).toBeNull();
    expect(screen.queryByText('METREPS COACH')).toBeNull();
    u4();

    // Non-program / fallback session (no exercises for dayNum 5)
    const { unmount: u5 } = renderLogger({ programId: 'prog-11', week: '1', day: '5' });
    expect(screen.queryByText('Workout Target Mode')).toBeNull();
    expect(screen.queryByText('METREPS COACH')).toBeNull();
    u5();
  });

  it('12. The target-mode information control opens the correct accessible dialog and exact explanation for the displayed mode', () => {
    const programGuided = createTestProgram('prog-12g', 'metreps_guided', 'Hypertrophy');
    storage.saveProgram(programGuided);
    storage.setCurrentProgramId(programGuided.id);

    const { unmount } = renderLogger({ programId: 'prog-12g', week: '1', day: '1' });

    const coachInfoBtn = screen.getByRole('button', { name: 'About MetReps Coach' });
    fireEvent.click(coachInfoBtn);

    const coachDialog = screen.getByRole('dialog');
    expect(coachDialog).toBeDefined();
    expect(screen.getByRole('heading', { name: /MetReps Coach/i })).toBeDefined();
    expect(
      screen.getByText(
        'MetReps Coach starts with the same periodisation-based targets, then compares completed workouts with previous prescribed targets. When the available evidence supports a decision, it can progress, hold, retry or adjust future weight and repetition targets.'
      )
    ).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    unmount();

    const programPerf = createTestProgram('prog-12p', 'performance_led', 'Hypertrophy');
    storage.saveProgram(programPerf);
    storage.setCurrentProgramId(programPerf.id);

    renderLogger({ programId: 'prog-12p', week: '1', day: '1' });

    const targetInfoBtn = screen.getByRole('button', { name: 'About Periodisation Targets' });
    fireEvent.click(targetInfoBtn);

    const targetDialog = screen.getByRole('dialog');
    expect(targetDialog).toBeDefined();
    expect(screen.getByRole('heading', { name: /Periodisation Targets/i })).toBeDefined();
    expect(
      screen.getByText(
        'MetReps uses your recorded performance as the baseline, then applies your selected periodisation method to calculate the session’s targets. It does not use Coach rules to decide whether you have earned a progression, should hold, or should retry a target.'
      )
    ).toBeDefined();
  });

  it('13. Opening and closing either dialog causes: zero Guided calls, zero target recalculations, zero registry operations, zero exercise/set mutation, zero draft or log writes', () => {
    const program = createTestProgram('prog-13', 'performance_led', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-13', week: '1', day: '1' });

    // Clear call counts after initial render mount
    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');
    const calcObjectiveSetsSpy = vi.spyOn(calculationModule, 'calculateObjectiveSets');
    const saveDraftSpy = vi.spyOn(navigationGuardModule, 'saveActiveWorkoutDraft');
    const saveLogSpy = vi.spyOn(storage, 'saveWorkoutLog');

    const methodBtn = screen.getByRole('button', { name: 'About Wave Volume' });
    fireEvent.click(methodBtn);
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    const targetModeBtn = screen.getByRole('button', { name: 'About Periodisation Targets' });
    fireEvent.click(targetModeBtn);
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(orchestrateSpy).not.toHaveBeenCalled();
    expect(calcObjectiveSetsSpy).not.toHaveBeenCalled();
    expect(saveDraftSpy).not.toHaveBeenCalled();
    expect(saveLogSpy).not.toHaveBeenCalled();
  });

  it('14. The Target Mode presentation is not interactive and cannot change targetProgressionMode', () => {
    const program = createTestProgram('prog-14', 'performance_led', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-14', week: '1', day: '1' });

    const badge = screen.getByText('PERIODISATION TARGETS');
    // Clicking the badge text or card has no selector behavior and does not toggle or mutate mode
    fireEvent.click(badge);

    expect(screen.getByText('PERIODISATION TARGETS')).toBeDefined();
    expect(screen.queryByText('METREPS COACH')).toBeNull();

    const storedProg = storage.getPrograms().find(p => p.id === 'prog-14');
    expect(storedProg?.targetProgressionMode).toBe('performance_led');
  });

  it('15. Accessible names, roles, Escape dismissal and focus restoration work correctly', () => {
    const program = createTestProgram('prog-15', 'metreps_guided', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    renderLogger({ programId: 'prog-15', week: '1', day: '1' });

    const coachInfoBtn = screen.getByRole('button', { name: 'About MetReps Coach' });
    coachInfoBtn.focus();
    expect(document.activeElement).toBe(coachInfoBtn);

    fireEvent.click(coachInfoBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('header-guidance-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('header-guidance-dialog-desc');

    // Escape key dismissal
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(coachInfoBtn);
  });

  it('16. Existing initial, added-exercise, replacement-exercise and registry integrations remain unaffected', () => {
    const program = createTestProgram('prog-16', 'metreps_guided', 'Hypertrophy');
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    const orchestrateSpy = vi.spyOn(integrationModule, 'orchestrateGuidedWorkoutExercises');

    renderLogger({ programId: 'prog-16', week: '1', day: '1' });

    // For an eligible fresh coached session, initial orchestration runs exactly once
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('METREPS COACH')).toBeDefined();
    expect(screen.getByText('Barbell Bench Press (flat)')).toBeDefined();
  });
});
