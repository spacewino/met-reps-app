// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { getActiveWorkoutDraft } from '../navigationGuard';
import type { ExerciseEntry, Program, WorkoutLog } from '../../types';

const ex: ExerciseEntry = { name: 'Hammer Curl', muscleGroup: 'Biceps', exerciseKey: 'hammer-curl', modality: 'weighted', movementCategory: 'isolation', equipment: 'freeweight', sets: [
  { setNumber: 1, weight: 12.5, reps: 15, rpe: 8, form: 'strict', isCompleted: true, comment: 'Saved comment' },
  { setNumber: 2, weight: 12.5, reps: 13, rpe: 8.5 }, { setNumber: 3, weight: 12.5, reps: 12, rpe: 9 },
] };
const program: Program = { id: 'prog-goal', name: 'Curl program', createdAt: '2026-01-01T00:00:00Z', objective: 'Hypertrophy', algorithmId: 'hypertrophy_linear', targetProgressionMode: 'metreps_guided', daysPerWeek: 2, programDuration: 4, exercisesByDay: { 1: [ex], 2: [ex] } };
const log: WorkoutLog = { id: 'goal-edit', date: '2026-10-09', programId: program.id, program: program.name, week: '1', day: '1', objective: 'Hypertrophy', unit: 'kg', notes: 'Workout note', recovery: { sleepHours: 7, soreness: 2 }, exercises: [ex] };
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(async () => { cleanup(); await settle(); vi.restoreAllMocks(); localStorage.clear(); });
async function setup(themeId = 'slate', source = log, savedProgram: Program | null = program) {
  if (savedProgram) storage.saveProgram(savedProgram);
  storage.saveWorkoutLog(source);
  const onSave = vi.fn(), onClose = vi.fn();
  const view = render(<WorkoutLogger initialParams={{ editLogId: source.id }} workoutLogs={[source]} themeId={themeId} onSave={onSave} onClose={onClose} />);
  await settle();
  return { ...view, onSave, onClose };
}
const trigger = () => screen.getAllByLabelText('Set options; press and hold to reorder')[0];
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Prog Goal' }));

describe('Prog Goal in Workout Logger', () => {
  it.each(['slate', 'onyx', 'amber'])('shows every working set, reads current edits and preserves all workout state in %s', async theme => {
    const view = await setup(theme);
    const row = view.container.querySelector('[data-set-row-exercise="0"][data-set-row-index="0"]')!;
    const weight = row.querySelector('input[type="number"]')!;
    fireEvent.change(weight, { target: { value: '15' } });
    await settle();
    fireEvent.click(trigger());
    fireEvent.change(screen.getByPlaceholderText('e.g., Last rep was slow, good squeeze'), { target: { value: 'Unsaved comment' } });
    const before = JSON.stringify(getActiveWorkoutDraft()?.rawDraft);
    const stored = JSON.stringify(storage.getWorkoutLogs());
    const writes = vi.spyOn(localStorage, 'setItem'), remove = vi.spyOn(localStorage, 'removeItem');
    const saveLog = vi.spyOn(storage, 'saveWorkoutLog'), saveProgram = vi.spyOn(storage, 'saveProgram');
    open();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Progression goal' })).toBeTruthy();
    const current = screen.getByRole('list', { name: 'Working sets for week 1 day 1' });
    expect(within(current).getByText('15 kg × 15 @ 8 RPE')).toBeTruthy();
    expect(within(current).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByRole('list')).toHaveLength(8);
    expect(screen.getAllByRole('list').every(list => within(list).getAllByRole('listitem').length === 3)).toBe(true);
    expect(within(screen.getByRole('dialog')).queryByRole('textbox')).toBeNull();
    const close = screen.getByRole('button', { name: 'Close progression goal' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Prog Goal' }));
    expect((screen.getByPlaceholderText('e.g., Last rep was slow, good squeeze') as HTMLInputElement).value).toBe('Unsaved comment');
    expect(JSON.stringify(getActiveWorkoutDraft()?.rawDraft)).toBe(before);
    expect(view.container.querySelector('[data-set-row-exercise="0"][data-set-row-index="0"]')).toBe(row);
    expect((weight as HTMLInputElement).value).toBe('15');
    expect(JSON.stringify(storage.getWorkoutLogs())).toBe(stored);
    expect(writes).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    expect(saveLog).not.toHaveBeenCalled(); expect(saveProgram).not.toHaveBeenCalled();
    expect(view.onSave).not.toHaveBeenCalled(); expect(view.onClose).not.toHaveBeenCalled();
  });

  it('closes the goal first via Escape, device Back and backdrop, and switches between all three set subviews', async () => {
    await setup(); const original = trigger(); fireEvent.click(original); open();
    fireEvent.click(screen.getByRole('heading', { name: 'Remaining program workouts' }));
    expect(screen.getByRole('heading', { name: 'Progression goal' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Set 1 Options' })).toBeTruthy();
    open(); window.__ignoreNextPopCount = 0; fireEvent.popState(window);
    expect(screen.getByRole('heading', { name: 'Set 1 Options' })).toBeTruthy();
    open(); fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.getByRole('heading', { name: 'Set 1 Options' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plate calc' }));
    expect(screen.getByLabelText('Target weight (kg)')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'PR Report' }));
    expect(screen.getByRole('heading', { name: 'Exercise PR report' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' }); open();
    expect(screen.queryByLabelText('Target weight (kg)')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Exercise PR report' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(original);
  });

  it.each(['Off', 'Deload', 'Strength'] as const)('disables Prog Goal for a %s session without an eligible exercise', async objective => {
    await setup('slate', { ...log, objective }); fireEvent.click(trigger());
    expect((screen.getByRole('button', { name: 'Prog Goal' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Strength main movements and shows assigned high-RPE final targets', async () => {
    const main = { ...ex, isMainMovement: true, movementCategory: 'compound' as const, sets: ex.sets.map(s => ({ ...s, weight: 100, reps: 6 })) };
    await setup('slate', { ...log, objective: 'Strength', exercises: [main] }, { ...program, objective: 'Strength', algorithmId: 'strength_linear', exercisesByDay: { 1: [main], 2: [main] } });
    fireEvent.click(trigger()); open();
    expect(screen.getByRole('heading', { name: 'Progression goal' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Working sets for week 4 day 2' })).getAllByRole('listitem')[0].textContent).toContain('× 1 @ 10 RPE');
  });

  it('explains missing RPE rather than producing a false endpoint', async () => {
    await setup('slate', { ...log, exercises: [{ ...ex, sets: [{ setNumber: 1, weight: 12.5, reps: 15 }] }] });
    fireEvent.click(trigger()); open();
    expect(screen.getByText(/Enter weight, reps, and a valid RPE/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Final workout target' })).toBeNull();
  });

  it('uses fresh saved program metadata and explains session-only goal changes', async () => {
    await setup();
    storage.saveProgram({ ...program, objective: 'Strength', algorithmId: 'strength_linear', exercisesByDay: { 1: [{ ...ex, isMainMovement: true }], 2: [{ ...ex, isMainMovement: true }] } });
    fireEvent.click(trigger()); open();
    expect(screen.getByText('Future workouts follow the saved program’s Strength goal.')).toBeTruthy();
    expect(screen.getByText('Strength · Linear Periodisation · Coaching on')).toBeTruthy();
  });
});
