// @vitest-environment happy-dom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExercisePRReport } from '../../components/ExercisePRReport';
import type { ExerciseEntry, WorkoutLog } from '../../types';
const exercise: ExerciseEntry = { name: 'Bench', exerciseKey: 'bench', muscleGroup: 'Pecs', sets: [] };
const logs: WorkoutLog[] = [{ id: 'saved', date: '2026-09-01', unit: 'lb', program: 'One Off', week: '1', day: '1', notes: 'Overall saved note', exercises: [
  { ...exercise, isSkipped: true },
  { ...exercise, name: 'Old bench name', sets: [
    { setNumber: 1, isWarmup: true, weight: 50, reps: 10, comment: 'Warm-up note' },
    { setNumber: 2, weight: 220, reps: 1, rpe: 9, form: 'strict', isCompleted: true, comment: 'Record comment', isDropSet: true, dropSubSets: [{ weight: 150, reps: 5 }] },
    { setNumber: 3, isSkipped: true, weight: 230, reps: 5 },
    { setNumber: 4, isCompleted: false, weight: 240, reps: 5 },
    { setNumber: 5, weight: 100, reps: 5, rpe: 8, form: 'standard', comment: 'Legacy row' },
  ] },
] }];
afterEach(cleanup);
const renderReport = (workoutLogs = logs, unit: 'kg' | 'lb' = 'kg') => render(<ExercisePRReport exercise={exercise} workoutLogs={workoutLogs} unit={unit} />);
const historySection = () => screen.getByRole('heading', { name: /e1RM PR:/ }).closest('section')!;
describe('PR report compact presentation', () => {
  it('simplifies headings and removes redundant history/order metadata and one-off week/day', () => {
    renderReport();
    expect(screen.getByRole('heading', { name: 'Old bench name · e1RM PR: 99.79 kg' })).toBeTruthy();
    expect(screen.getByText('2026-09-01 · One-off workout')).toBeTruthy();
    const history = historySection();
    expect(history.textContent).not.toMatch(/Saved history|Historical PR workout|Workout ID|Week 1|Day 1/);
    expect(screen.queryByText('Saved exercise order.')).toBeNull();
  });
  it('uses saved programmed context, allows long names to wrap, and trims only headline trailing zeroes', () => {
    const name = 'Seated Dumbbell Shoulder Press With A Very Long Saved Name';
    renderReport([{ ...logs[0], programId: 'saved-program', program: 'Historical strength plan', week: '2', day: '3', unit: 'kg', exercises: [{ ...exercise, name, sets: [{ setNumber: 1, weight: 17.5, reps: 1 }] }] }]);
    const heading = screen.getByRole('heading', { name: `${name} · e1RM PR: 17.5 kg` });
    expect(heading.className).not.toMatch(/truncate|nowrap/);
    expect(screen.getByText('2026-09-01 · Historical strength plan · Week 2 · Day 3')).toBeTruthy();
    expect(screen.getByText('Dashed line: all-time PR 17.50 kg')).toBeTruthy();
  });
  it('does not invent missing programmed metadata', () => {
    renderReport([{ ...logs[0], programId: 'saved-program', program: undefined, week: undefined, day: undefined }]);
    expect(within(historySection()).getByText('2026-09-01')).toBeTruthy();
    expect(historySection().textContent).not.toMatch(/One-off workout|Week|Day|saved-program/);
  });
  it('uses compact saved-unit rows with exact PR badge, warm-up SVG and unavailable values', () => {
    renderReport();
    const history = historySection();
    expect(within(history).getByText('Set 1: 50 lb × 10 @Unavailable RPE')).toBeTruthy();
    const icon = within(history).getByRole('img', { name: 'Warm-up set 1' });
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon.querySelectorAll('path')).toHaveLength(3);
    expect(within(history).getByText('Set 2: 220 lb × 1 @9 RPE')).toBeTruthy();
    expect(within(history).getByText('PR').closest('li')?.textContent).toContain('Set 2:');
    expect(history.textContent).not.toMatch(/Weight:|Reps:|Status:|Form:|strict|standard|Completed/);
  });
  it('omits skipped/incomplete rows but retains legacy sets and original numbering', () => {
    renderReport();
    const history = historySection();
    expect(within(history).queryByText(/Set 3:/)).toBeNull();
    expect(within(history).queryByText(/Set 4:/)).toBeNull();
    expect(within(history).getByText('Set 5: 100 lb × 5 @8 RPE')).toBeTruthy();
    expect(within(history).getByText('Legacy row')).toBeTruthy();
  });
  it('keeps set comments, compact nested drops and separately labelled workout notes', () => {
    renderReport();
    expect(screen.getByText('Warm-up note').closest('li')?.textContent).toContain('Set 1:');
    expect(screen.getByText('Record comment').closest('li')?.textContent).toContain('Set 2:');
    expect(screen.getByText('Drop 1: 150 lb × 5').closest('ol')?.getAttribute('aria-label')).toBe('Drop subsets for set 2');
    expect(screen.getByRole('heading', { name: 'Workout notes' }).nextElementSibling?.textContent).toBe('Overall saved note');
  });
  it('flattens the first sections and highlights the exact original exercise occurrence; keeps graph boxed', () => {
    renderReport();
    const history = historySection();
    const order = screen.getByRole('heading', { name: 'Exercise order' }).closest('section')!;
    const graph = screen.getByRole('heading', { name: 'Last six workouts versus the PR' }).closest('section')!;
    expect(history.className).not.toContain('border'); expect(order.className).not.toContain('border');
    expect(history.querySelector('li.border')).toBeNull(); expect(order.querySelector('li.border')).toBeNull();
    expect(graph.className).toContain('border border-slate-800');
    const rows = within(order).getAllByRole('listitem'); expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('1. Bench · Pecs · Skipped');
    expect(rows[1].textContent).toContain('2. Old bench name · Pecs');
    expect(rows[1].className).toContain('bg-selected-surface'); expect(rows[1].className).toContain('font-bold');
    expect(within(rows[1]).getByText('PR exercise')).toBeTruthy();
    expect(history.querySelector('ol')?.className).toContain('text-sm font-sans'); expect(order.querySelector('ol')?.className).toContain('text-sm font-sans');
    expect(screen.getByRole('img', { name: /Last 1 saved workouts/ }).querySelectorAll('line:not([stroke-dasharray])')).toHaveLength(0);
  });
  it('preserves unavailable graph sessions and never draws a zero point or bridges a gap', () => {
    renderReport([logs[0], { ...logs[0], date: '2026-09-02', exercises: [{ ...exercise, isSkipped: true }] }, { ...logs[0], date: '2026-09-03' }], 'lb');
    expect(screen.getByText('2026-09-02 · session 1:', { exact: false }).textContent).toContain('Unavailable');
    const graph = screen.getByRole('img', { name: /Last 3 saved workouts/ });
    expect(graph.querySelectorAll('circle')).toHaveLength(2);
    expect(graph.querySelectorAll('line:not([stroke-dasharray])')).toHaveLength(0);
  });
  it('has clear empty and unsupported states', () => {
    const view = renderReport([]);
    expect(screen.getByText('No qualifying saved record.')).toBeTruthy();
    expect(screen.getByText('No saved sessions.')).toBeTruthy();
    view.rerender(<ExercisePRReport exercise={{ ...exercise, modality: 'timed' }} workoutLogs={[]} unit="kg" />);
    expect(screen.getByText(/does not support estimated 1RM/)).toBeTruthy();
    expect(screen.queryByText(/Saved history/)).toBeNull();
  });
});
