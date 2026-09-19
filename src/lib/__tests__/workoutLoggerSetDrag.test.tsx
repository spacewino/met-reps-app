// @vitest-environment happy-dom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { getActiveWorkoutDraft } from '../navigationGuard';
import type { WorkoutLog } from '../../types';

const waitForHold = () => new Promise(resolve => setTimeout(resolve, 475));

function makeLog(): WorkoutLog {
  return {
    id: 'drag-log', date: '2026-09-19', startTime: '10:00', program: 'One Off',
    week: '1', day: '1', unit: 'kg', durationMinutes: 20, notes: '', objective: 'Hypertrophy',
    exercises: [{
      name: 'Bench Press', muscleGroup: 'Chest', modality: 'weighted',
      sets: [
        { setNumber: 1, weight: 11, reps: 5, rpe: 7, form: 'strict', comment: 'complete object', isCompleted: true },
        { setNumber: 2, weight: 22, reps: 6, rpe: 8, form: 'standard' },
        { setNumber: 3, weight: 33, reps: 7, rpe: 9, form: 'loose', isSkipped: true },
      ],
    }],
  };
}

async function renderLogger() {
  storage.saveWorkoutLog(makeLog());
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<WorkoutLogger initialParams={{ editLogId: 'drag-log' }} onClose={() => {}} onSave={() => {}} />);
  });
  return view;
}

function pointer(button: HTMLElement, type: 'down' | 'move' | 'up' | 'cancel', y = 10) {
  const init = { pointerId: 7, isPrimary: true, button: 0, clientX: 10, clientY: y };
  if (type === 'down') fireEvent.pointerDown(button, init);
  if (type === 'move') fireEvent.pointerMove(button, init);
  if (type === 'up') fireEvent.pointerUp(button, init);
  if (type === 'cancel') fireEvent.pointerCancel(button, init);
}

describe('Workout Logger set-options long-press reordering', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('keeps a short tap as Set Options and does not start a drag', async () => {
    const view = await renderLogger();
    const button = screen.getAllByLabelText('Set options; press and hold to reorder')[0];
    expect((button as HTMLButtonElement).style.touchAction).toBe('none');
    pointer(button, 'down');
    pointer(button, 'up');
    fireEvent.click(button);
    expect(screen.getByText('Set 1 Options')).toBeTruthy();
    expect(view.container.querySelector('.ring-indigo-400')).toBeNull();
    view.unmount();
  });

  it('cancels a pre-activation move and pointer cancellation without saving a reorder', async () => {
    const view = await renderLogger();
    const button = screen.getAllByLabelText('Set options; press and hold to reorder')[0];
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(button, { setPointerCapture, releasePointerCapture, hasPointerCapture: () => true });
    pointer(button, 'down', 10);
    pointer(button, 'move', 25);
    await act(waitForHold);
    expect(view.container.querySelector('.ring-indigo-400')).toBeNull();

    pointer(button, 'down', 10);
    await act(waitForHold);
    expect(view.container.querySelector('.ring-indigo-400')).toBeTruthy();
    pointer(button, 'cancel', 10);
    expect(view.container.querySelector('.ring-indigo-400')).toBeNull();
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(getActiveWorkoutDraft()?.rawDraft.exercises[0].sets.map((set: { weight: number }) => set.weight)).toEqual([11, 22, 33]);
    view.unmount();
  });

  it('moves a completed set within its exercise once, preserves its data, and suppresses the generated click', async () => {
    const view = await renderLogger();
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[data-set-row-exercise="0"]'));
    rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      top: index * 50, bottom: index * 50 + 50, left: 0, right: 300, width: 300, height: 50, x: 0, y: index * 50, toJSON: () => ({}),
    }));
    const button = screen.getAllByLabelText('Set options; press and hold to reorder')[0];
    pointer(button, 'down', 10);
    await act(waitForHold);
    pointer(button, 'move', 80);
    const destinationSlot = view.container.querySelector('[data-set-drop-slot="1"]');
    expect(destinationSlot).toBeTruthy();
    expect(destinationSlot?.querySelector('.border-dotted')).toBeTruthy();
    expect(destinationSlot?.querySelector('.sr-only')?.textContent).toBe('Set will be inserted here');
    expect(destinationSlot?.textContent).not.toContain('Drop set here');
    pointer(button, 'up', 80);
    fireEvent.click(button);

    expect(screen.queryByText('Set 1 Options')).toBeNull();
    const sets = getActiveWorkoutDraft()?.rawDraft.exercises[0].sets;
    expect(sets.map((set: { weight: number }) => set.weight)).toEqual([22, 11, 33]);
    expect(sets.map((set: { setNumber: number }) => set.setNumber)).toEqual([1, 2, 3]);
    expect(sets[1]).toMatchObject({ weight: 11, reps: 5, rpe: 7, form: 'strict', comment: 'complete object', isCompleted: true });
    expect(sets[2].isSkipped).toBe(true);
    view.unmount();
  });
});
