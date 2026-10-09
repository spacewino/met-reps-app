// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { getActiveWorkoutDraft } from '../navigationGuard';
import type { WorkoutLog } from '../../types';
const log: WorkoutLog = { id: 'edit', date: '2026-09-01', unit: 'kg', program: 'One Off', notes: 'Live overall notes', recovery: { sleepHours: 7, soreness: 2 }, exercises: [{ name: 'Bench', exerciseKey: 'bench', muscleGroup: 'Pecs', sets: [
  { setNumber: 1, weight: 20, reps: 8, isWarmup: true, comment: 'Saved warm-up comment' },
  { setNumber: 2, weight: 100, reps: 5, rpe: 8, form: 'strict', isCompleted: true },
  { setNumber: 3, weight: 110, reps: 5, isSkipped: true },
] }] };
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(async () => { cleanup(); await settle(); vi.restoreAllMocks(); localStorage.clear(); });
async function setup(themeId = 'slate') {
  storage.saveWorkoutLog(log);
  const onClose = vi.fn(), onSave = vi.fn();
  const view = render(<WorkoutLogger initialParams={{ editLogId: 'edit' }} workoutLogs={[log]} themeId={themeId} onClose={onClose} onSave={onSave} />);
  await settle();
  return { ...view, onClose, onSave };
}
const trigger = (index = 0) => screen.getAllByLabelText('Set options; press and hold to reorder')[index];
const open = () => fireEvent.click(screen.getByRole('button', { name: 'PR Report' }));

describe('Workout Logger PR report subview', () => {
  it.each(['slate', 'onyx', 'amber'])('preserves live draft and uncommitted comment, without report-caused writes or Logger replacement in %s', async theme => {
    const view = await setup(theme);
    const rowInputs = view.container.querySelectorAll<HTMLInputElement>('[data-set-row-exercise="0"][data-set-row-index="1"] input[type="number"]');
    fireEvent.change(rowInputs[0], { target: { value: '125' } });
    fireEvent.change(rowInputs[1], { target: { value: '6' } });
    fireEvent.change(view.container.querySelector('textarea')!, { target: { value: 'Unsaved overall note' } });
    fireEvent.click(trigger());
    const dialog = screen.getByRole('dialog');
    const rowPairs = [
      ['MOVE UP', 'MOVE DOWN'], ['Warmup Set', 'Auto Warmup'],
      ['Drop Set', 'Undo targets'], ['Equiv Set Calc', 'Plate calc'],
      ['Prog Goal', 'PR Report'], ['SKIP SET', 'DELETE SET'],
    ];
    for (const [left, right] of rowPairs) {
      const leftButton = within(dialog).getByRole('button', { name: left });
      const rightButton = within(dialog).getByRole('button', { name: right });
      expect(leftButton.parentElement).toBe(rightButton.parentElement);
      expect(leftButton.nextElementSibling).toBe(rightButton);
    }
    const actionLabels = within(dialog).getAllByRole('button')
      .map(button => button.textContent?.trim()).filter(label => label !== 'CLOSE' && label !== 'Save' && label !== '');
    expect(actionLabels).toEqual(rowPairs.flat());
    expect((within(dialog).getByRole('button', { name: 'Plate calc' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(dialog).getByRole('button', { name: 'Prog Goal' }) as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByPlaceholderText('e.g., Last rep was slow, good squeeze') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Uncommitted text' } });
    const before = JSON.stringify(getActiveWorkoutDraft()?.rawDraft);
    const underlyingRow = view.container.querySelector('[data-set-row-exercise="0"]');
    const saveLog = vi.spyOn(storage, 'saveWorkoutLog');
    const getLogs = vi.spyOn(storage, 'getWorkoutLogs');
    const writes = vi.spyOn(localStorage, 'setItem');
    const remove = vi.spyOn(localStorage, 'removeItem');
    open();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByPlaceholderText('e.g., Last rep was slow, good squeeze')).toBeNull();
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe('set-action-title');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close PR report' }));
    expect(writes).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(getLogs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close PR report' }));
    expect((screen.getByPlaceholderText('e.g., Last rep was slow, good squeeze') as HTMLInputElement).value).toBe('Uncommitted text');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'PR Report' }));
    expect(JSON.stringify(getActiveWorkoutDraft()?.rawDraft)).toBe(before);
    expect(getActiveWorkoutDraft()?.rawDraft.exercises[0].sets[1]).toMatchObject({ weight: 125, reps: 6, rpe: 8, form: 'strict' });
    expect(getActiveWorkoutDraft()?.rawDraft.notes).toBe('Unsaved overall note');
    expect(view.container.querySelector('[data-set-row-exercise="0"]')).toBe(underlyingRow);
    expect(writes).not.toHaveBeenCalled();
    expect(saveLog).not.toHaveBeenCalled();
    expect(view.onSave).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(storage.getWorkoutLogs()[0].exercises[0].sets[0].comment).toBe('Saved warm-up comment');
  });
  it('opens from a skipped set and shows saved values rather than unsaved historical edits', async () => {
    const view = await setup();
    fireEvent.change(view.container.querySelector<HTMLInputElement>('[data-set-row-index="1"] input[type="number"]')!, { target: { value: '999' } });
    fireEvent.click(trigger(2));
    open();
    expect(screen.getByRole('heading', { name: /e1RM PR:/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Bench · e1RM PR: 116.67 kg' })).toBeTruthy();
  });
  it('traps focus and dismisses report first by Escape and then restores the original trigger', async () => {
    await setup();
    const original = trigger(); fireEvent.click(original); open();
    const close = screen.getByRole('button', { name: 'Close PR report' });
    expect(screen.queryByRole('button', { name: 'Back to set options' })).toBeNull();
    close.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(close);
    original.focus(); expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Set 1 Options' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(original);
  });
  it('uses device Back in subview order and ignores clicks within report content', async () => {
    await setup();
    const original = trigger(); fireEvent.click(original); open();
    fireEvent.click(screen.getByRole('heading', { name: /e1RM PR:/ }));
    expect(screen.getByRole('heading', { name: 'Exercise PR report' })).toBeTruthy();
    window.__ignoreNextPopCount = 0;
    fireEvent.popState(window);
    expect(screen.getByRole('heading', { name: 'Set 1 Options' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'PR Report' }));
    fireEvent.popState(window);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(original);
  });
  it('handles backdrop and labelled close controls in subview order', async () => {
    await setup(); fireEvent.click(trigger()); open();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.getByRole('heading', { name: 'Set 1 Options' })).toBeTruthy();
    open(); fireEvent.click(screen.getByRole('button', { name: 'Close PR report' }));
    expect(screen.getByRole('heading', { name: 'Set 1 Options' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close set options' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps the running rest timer, elapsed time and lifecycle persistence while report is visible', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start rest timer' }));
    const start = localStorage.getItem('restStartTime');
    const context = localStorage.getItem('restStartContext');
    fireEvent.click(trigger()); open();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1150)); });
    expect(localStorage.getItem('isResting')).toBe('true');
    expect(localStorage.getItem('restStartTime')).toBe(start);
    expect(localStorage.getItem('restStartContext')).toBe(context);
    expect(screen.getAllByText('00:01').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close PR report' }));
    expect(localStorage.getItem('restStartTime')).toBe(start);
  });
  it('keeps normal draft lifecycle flushing active while report is open', async () => {
    await setup(); fireEvent.click(trigger()); open();
    const before = getActiveWorkoutDraft()?.rawDraft;
    fireEvent(window, new Event('pagehide'));
    expect(getActiveWorkoutDraft()?.rawDraft.exercises).toEqual(before?.exercises);
    expect(getActiveWorkoutDraft()?.rawDraft.notes).toBe('Live overall notes');
    expect(getActiveWorkoutDraft()?.rawDraft.sleep).toBe(7);
    expect(screen.getByRole('heading', { name: 'Exercise PR report' })).toBeTruthy();
  });
});
