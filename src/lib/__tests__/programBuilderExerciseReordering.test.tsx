// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { Program } from '../../types';
import { storage } from '../storage';

const memoryStore: Record<string, string> = {};
const mockStorage: Storage = {
  getItem: key => memoryStore[key] ?? null,
  setItem: (key, value) => { memoryStore[key] = String(value); },
  removeItem: key => { delete memoryStore[key]; },
  clear: () => { Object.keys(memoryStore).forEach(key => delete memoryStore[key]); },
  key: index => Object.keys(memoryStore)[index] ?? null,
  get length() { return Object.keys(memoryStore).length; },
};

Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, writable: true });

const program: Program = {
  id: 'reorder-program',
  name: 'Reorder Program',
  daysPerWeek: 2,
  programDuration: 8,
  createdAt: '2026-09-19T00:00:00.000Z',
  objective: 'Hypertrophy',
  algorithmId: 'hypertrophy_linear',
  exercisesByDay: {
    1: [
      { name: 'Squat', muscleGroup: 'Quads', modality: 'weighted', isMainMovement: true, sets: [{ setNumber: 1, weight: 140, reps: 5, rpe: 8 }] },
      { name: 'Bench Press', muscleGroup: 'Chest', modality: 'weighted', sets: [{ setNumber: 1, weight: 90, reps: 8, rpe: 7 }] },
      { name: 'Row', muscleGroup: 'Back', modality: 'weighted', sets: [{ setNumber: 1, weight: 70, reps: 10, rpe: 9 }] },
    ],
    2: [
      { name: 'Deadlift', muscleGroup: 'Hamstrings', modality: 'weighted', sets: [{ setNumber: 1, weight: 180, reps: 3, rpe: 8.5 }] },
      { name: 'Press', muscleGroup: 'Shoulders', modality: 'weighted', sets: [{ setNumber: 1, weight: 50, reps: 6, rpe: 8 }] },
    ],
  },
};

function exerciseNames(): string[] {
  return screen.getAllByRole('button', { name: /^Edit / }).map(button => button.getAttribute('aria-label')!.replace('Edit ', ''));
}

describe('Program Builder exercise reordering', () => {
  beforeEach(() => {
    mockStorage.clear();
    storage.saveProgram(structuredClone(program));
    storage.setCurrentProgramId(program.id);
  });

  afterEach(cleanup);

  it('disables only the unavailable edge controls and moves a middle exercise up and down', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    expect((screen.getByRole('button', { name: 'Move Squat up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move Row down' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move Bench Press up' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Move Bench Press down' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Move Bench Press up' }));
    expect(exerciseNames()).toEqual(['Bench Press', 'Squat', 'Row']);

    fireEvent.click(screen.getByRole('button', { name: 'Move Bench Press down' }));
    expect(exerciseNames()).toEqual(['Squat', 'Bench Press', 'Row']);
  });

  it('changes only the selected day and keeps all exercise details attached', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Bench Press up' }));
    const benchCard = screen.getByRole('button', { name: 'Edit Bench Press' }).parentElement!.parentElement!;
    expect(benchCard.textContent).toContain('Bench Press');
    expect(benchCard.textContent).toContain('Chest');

    fireEvent.click(screen.getByRole('button', { name: /Day 2/ }));
    expect(exerciseNames()).toEqual(['Deadlift', 'Press']);

    fireEvent.click(screen.getByRole('button', { name: /Day 1/ }));
    expect(exerciseNames()).toEqual(['Bench Press', 'Squat', 'Row']);
  });

  it('retains the reordered complete entries after saving and reopening', () => {
    const view = render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Row up' }));
    fireEvent.click(screen.getByRole('button', { name: /save program/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));

    const saved = storage.getPrograms().find(item => item.id === program.id)!;
    expect(saved.exercisesByDay[1].map(exercise => exercise.name)).toEqual(['Squat', 'Row', 'Bench Press']);
    expect(saved.exercisesByDay[1][1]).toMatchObject({ muscleGroup: 'Back', sets: [{ weight: 70, reps: 10, rpe: 9 }] });
    expect(saved.exercisesByDay[2].map(exercise => exercise.name)).toEqual(['Deadlift', 'Press']);

    view.unmount();
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    expect(exerciseNames()).toEqual(['Squat', 'Row', 'Bench Press']);
  });
});
