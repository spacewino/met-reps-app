// @vitest-environment happy-dom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExercisePRReport } from '../../components/ExercisePRReport';
import type { ExerciseEntry, WorkoutLog } from '../../types';
const exercise: ExerciseEntry = { name: 'Bench', exerciseKey: 'bench', muscleGroup: 'Pecs', sets: [] };
const logs: WorkoutLog[] = [{ id: 'saved', date: '2026-09-01', unit: 'lb', program: 'Strength', notes: 'Overall saved note', exercises: [
  { ...exercise, isSkipped: true },
  { ...exercise, name: 'Old bench name', sets: [
    { setNumber: 1, isWarmup: true, weight: 50, reps: 10, comment: 'Warm-up note' },
    { setNumber: 2, weight: 220, reps: 1, rpe: 9, form: 'strict', isCompleted: true, comment: 'Record comment', isDropSet: true, dropSubSets: [{ weight: 150, reps: 5 }] },
    { setNumber: 3, isSkipped: true, weight: 230, reps: 5 },
    { setNumber: 4, isCompleted: false, weight: 240, reps: 5 },
  ] },
] }];
afterEach(cleanup);
describe('PR report presentation', () => {
  it('shows every saved set, exact badge, original units, nested technique and separate workout notes', () => {
    render(<ExercisePRReport exercise={exercise} workoutLogs={logs} unit="kg" />);
    expect(screen.getByText('Saved history · Bench')).toBeTruthy();
    expect(screen.getAllByText('99.79 kg')).toHaveLength(2);
    expect(screen.getByText('Weight: 220 lb · Reps: 1 · RPE: 9')).toBeTruthy();
    expect(screen.getByText('Warm-up 1')).toBeTruthy();
    expect(screen.getByText('Comment: Warm-up note')).toBeTruthy();
    expect(screen.getByText('Comment: Record comment')).toBeTruthy();
    expect(screen.getByText('Form: strict')).toBeTruthy();
    expect(screen.getByText('Status: Skipped')).toBeTruthy();
    expect(screen.getByText('Status: Incomplete')).toBeTruthy();
    expect(screen.getByText('Drop 1: 150 lb · 5 reps')).toBeTruthy();
    expect(screen.getByText('PR').closest('li')?.textContent).toContain('Set 2');
    expect(screen.getByRole('heading', { name: 'Workout notes' }).nextElementSibling?.textContent).toBe('Overall saved note');
    const order = screen.getByRole('heading', { name: 'Exercise order' }).closest('section')!;
    expect(within(order).getAllByRole('listitem')).toHaveLength(2);
    expect(within(order).getByText('PR exercise').closest('li')?.textContent).toContain('2. Old bench name');
    expect(within(order).getByText('PR exercise').closest('li')?.className).toContain('bg-selected-surface');
    expect(within(order).getByText(/Skipped/)).toBeTruthy();
    expect(screen.getByRole('img').querySelectorAll('line:not([stroke-dasharray])')).toHaveLength(0);
  });
  it('labels unavailable sessions and never draws a zero point or bridges a gap', () => {
    render(<ExercisePRReport exercise={exercise} workoutLogs={[logs[0], { ...logs[0], date: '2026-09-02', exercises: [{ ...exercise, isSkipped: true }] }, { ...logs[0], date: '2026-09-03' }]} unit="lb" />);
    expect(screen.getByText('2026-09-02 · session 1:', { exact: false }).textContent).toContain('Unavailable');
    expect(screen.getByRole('img').querySelectorAll('circle')).toHaveLength(2);
    expect(screen.getByRole('img').querySelectorAll('line:not([stroke-dasharray])')).toHaveLength(0);
  });
  it('has clear empty and unsupported states', () => {
    const view = render(<ExercisePRReport exercise={exercise} workoutLogs={[]} unit="kg" />);
    expect(screen.getByText('No qualifying saved record.')).toBeTruthy();
    expect(screen.getByText('No saved sessions.')).toBeTruthy();
    view.rerender(<ExercisePRReport exercise={{ ...exercise, modality: 'timed' }} workoutLogs={[]} unit="kg" />);
    expect(screen.getByText(/does not support estimated 1RM/)).toBeTruthy();
  });
});
