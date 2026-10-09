// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { getActiveWorkoutDraft } from '../navigationGuard';
import type { ExerciseModality, WorkoutLog } from '../../types';

const log: WorkoutLog = { id: 'plate-edit', date: '2026-10-09', unit: 'kg', program: 'One Off', notes: 'Workout note', recovery: { sleepHours: 7, soreness: 2 }, exercises: [{ name: 'Squat', muscleGroup: 'Quads', modality: 'weighted', sets: [
  { setNumber: 1, weight: 87.5, reps: 5, rpe: 8, form: 'strict', comment: 'Saved comment', isCompleted: true },
  { setNumber: 2, weight: null, reps: 5 },
] }] };
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(async () => { cleanup(); await settle(); vi.restoreAllMocks(); localStorage.clear(); });
async function setup(themeId = 'slate', source = log) {
  storage.setWeightUnit(source.unit);
  storage.saveWorkoutLog(source);
  const onClose = vi.fn(), onSave = vi.fn();
  const view = render(<WorkoutLogger initialParams={{ editLogId: source.id }} workoutLogs={[source]} themeId={themeId} onClose={onClose} onSave={onSave} />);
  await settle();
  return { ...view, onClose, onSave };
}
const trigger = (index = 0) => screen.getAllByLabelText('Set options; press and hold to reorder')[index];
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Plate calc' }));
const targetInput = () => screen.getByLabelText('Target weight (kg)') as HTMLInputElement;

describe('Workout Logger plate calculator', () => {
  it.each(['slate', 'onyx', 'amber'])('reads the live set weight and preserves the draft and unsaved comment in %s', async theme => {
    const view = await setup(theme);
    const row = view.container.querySelector('[data-set-row-exercise="0"][data-set-row-index="0"]')!;
    const weightInput = row.querySelector('input[type="number"]')!;
    fireEvent.change(weightInput, { target: { value: '81' } });
    fireEvent.click(trigger());
    const commentInput = screen.getByPlaceholderText('e.g., Last rep was slow, good squeeze');
    fireEvent.change(commentInput, { target: { value: 'Unsaved set comment' } });
    const before = JSON.stringify(getActiveWorkoutDraft()?.rawDraft);
    const writes = vi.spyOn(localStorage, 'setItem');
    const remove = vi.spyOn(localStorage, 'removeItem');
    const saveLog = vi.spyOn(storage, 'saveWorkoutLog');
    open();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(targetInput().value).toBe('81');
    expect(screen.getByText('80 kg')).toBeTruthy();
    expect(screen.getByText('1 kg below target')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close plate calc' }));
    fireEvent.change(targetInput(), { target: { value: '87.5' } });
    fireEvent.click(screen.getByRole('button', { name: '15 kg' }));
    expect(screen.getByRole('button', { name: '15 kg' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('87.5 kg')).toBeTruthy();
    expect(screen.getByText('Exact target')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Plates on each side: 20 kg × 1, 15 kg × 1, 1.25 kg × 1' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Plate counts per side' })).getAllByRole('listitem')).toHaveLength(3);
    expect(JSON.stringify(getActiveWorkoutDraft()?.rawDraft)).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Close plate calc' }));
    expect((screen.getByPlaceholderText('e.g., Last rep was slow, good squeeze') as HTMLInputElement).value).toBe('Unsaved set comment');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Plate calc' }));
    expect(JSON.stringify(getActiveWorkoutDraft()?.rawDraft)).toBe(before);
    expect(view.container.querySelector('[data-set-row-exercise="0"][data-set-row-index="0"]')).toBe(row);
    expect((weightInput as HTMLInputElement).value).toBe('81');
    expect(writes).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(saveLog).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.onSave).not.toHaveBeenCalled();
    expect(storage.getWorkoutLogs()[0].exercises[0].sets[0].weight).toBe(87.5);
    open();
    expect(targetInput().value).toBe('81');
  });

  it('seeds saved targets and handles empty, negative, bare-bar and above-target calculations', async () => {
    await setup(); fireEvent.click(trigger()); open();
    expect(targetInput().value).toBe('87.5');
    fireEvent.change(targetInput(), { target: { value: '81.25' } });
    expect(screen.getByText('1.25 kg below target')).toBeTruthy();
    fireEvent.change(targetInput(), { target: { value: '81.3' } });
    expect(screen.getByText('82.5 kg')).toBeTruthy();
    expect(screen.getByText('1.2 kg above target')).toBeTruthy();
    fireEvent.change(targetInput(), { target: { value: '80.0001' } });
    expect(screen.getByText('< 0.001 kg below target')).toBeTruthy();
    fireEvent.change(targetInput(), { target: { value: '-1' } });
    expect(screen.getByText('Enter a valid target weight of 0 or more.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.change(targetInput(), { target: { value: '0' } });
    expect(screen.getByText('Bar only — no plates needed.')).toBeTruthy();
    expect(screen.getByText('20 kg above target')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '10 kg' }));
    expect(screen.getByText('10 kg above target')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(trigger(1)); open();
    expect(targetInput().value).toBe('');
    expect(screen.getByText('Enter a valid target weight of 0 or more.')).toBeTruthy();
  });

  it('traps focus and closes only the calculator first via Escape, Back, and backdrop', async () => {
    await setup(); const original = trigger(); fireEvent.click(original); open();
    const close = screen.getByRole('button', { name: 'Close plate calc' });
    close.focus(); fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '10 kg' }));
    fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(close);
    fireEvent.click(screen.getByRole('heading', { name: 'Load on each side' }));
    expect(screen.getByRole('heading', { name: 'Plate calc' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Plate calc' }));
    open(); window.__ignoreNextPopCount = 0; fireEvent.popState(window);
    expect(screen.getByRole('heading', { name: 'Set 1 Options' })).toBeTruthy();
    open(); fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.getByRole('heading', { name: 'Set 1 Options' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'PR Report' }));
    expect(screen.getByRole('heading', { name: 'Exercise PR report' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'PR Report' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(original);
  });

  it('converts a pounds target while keeping the gym bar and plate sizes in kg', async () => {
    await setup('slate', { ...log, unit: 'lb', exercises: [{ ...log.exercises[0], sets: [{ ...log.exercises[0].sets[0], weight: 192.9044794117 }] }] });
    fireEvent.click(trigger()); open();
    expect((screen.getByLabelText('Target weight (lb)') as HTMLInputElement).value).toBe('192.9044794117');
    fireEvent.click(screen.getByRole('button', { name: '15 kg' }));
    expect(screen.getByText('192.904 lb')).toBeTruthy();
    expect(screen.getByText('Exact target')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Plates on each side: 20 kg × 1, 15 kg × 1, 1.25 kg × 1' })).toBeTruthy();
  });

  it.each(['timed', 'distance', 'bodyweight', 'assisted'] as ExerciseModality[])('does not interpret %s values as a barbell target', async modality => {
    await setup('slate', { ...log, exercises: [{ ...log.exercises[0], modality }] });
    fireEvent.click(trigger()); open();
    expect(targetInput().value).toBe('');
  });
});
