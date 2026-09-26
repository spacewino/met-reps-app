// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TrainingAverages } from '../../components/TrainingAverages';
import { WorkoutLog } from '../../types';

const description = 'Compare weekly training load and recovery metrics. Choose 4, 8 or 12 weeks, then use the arrows to move between date blocks.';

describe('TrainingAverages presentation', () => {
  afterEach(cleanup);
  it('provides accessible ranges, window navigation, tabs and semantic table headings', () => {
    const { container } = render(<TrainingAverages workoutLogs={[]} now={new Date(2026, 8, 21)} />);
    expect(screen.getByRole('heading', { name: 'Training Averages' })).toBeTruthy();
    expect(screen.getByText(description)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^(4|8|12)W$/ }).map(button => button.textContent)).toEqual(['4W', '8W', '12W']);
    expect(screen.getByRole('button', { name: '4W' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Next 4 weeks' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('columnheader', { name: 'Metric' })).toBeTruthy();
    expect(screen.getByText('This wk')).toBeTruthy();
    expect(screen.getByText('So far')).toBeTruthy();
    expect(container.querySelector('.training-averages-scroll')).toBeTruthy();
    expect(container.querySelector('.training-averages-sticky')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous 4 weeks' }));
    expect((screen.getByRole('button', { name: 'Next 4 weeks' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('selects 8W, renders eight semantic week columns, and resets it to the current block', () => {
    const { container } = render(<TrainingAverages workoutLogs={[]} now={new Date(2026, 8, 22)} />);
    fireEvent.click(screen.getByRole('button', { name: '12W' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous 12 weeks' }));
    expect((screen.getByRole('button', { name: 'Next 12 weeks' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '8W' }));
    expect(screen.getByRole('button', { name: '8W' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '4W' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '12W' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('button', { name: 'Next 8 weeks' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole('columnheader')).toHaveLength(9);
    expect(screen.getByRole('rowheader', { name: /Total sets/ })).toBeTruthy();
    expect(container.querySelector('.training-averages-scroll')).toBeTruthy();
    expect(container.querySelector('.training-averages-sticky')).toBeTruthy();
  });

  it('supports keyboard tab operation and calls the saved metric Workout Quality', () => {
    render(<TrainingAverages workoutLogs={[]} now={new Date(2026, 8, 21)} />);
    const load = screen.getByRole('tab', { name: 'Training Load' });
    fireEvent.keyDown(load, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Recovery Metrics' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'Workout Context' })).toBeNull();
    expect(screen.getByRole('rowheader', { name: /Workout Quality/ })).toBeTruthy();
    expect(screen.queryByText(/motivation/i)).toBeNull();
  });

  it('shows hydration as a category with its sample count but no ordinal mean', () => {
    const hydrationLog: WorkoutLog = {
      id: 'hydration', date: '2026-09-21', unit: 'kg', exercises: [],
      recovery: { hydrationLevel: 'Under-hydrated' },
    };
    render(<TrainingAverages workoutLogs={[hydrationLog]} now={new Date(2026, 8, 22)} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Recovery Metrics' }));
    const hydrationRow = screen.getByRole('rowheader', { name: /Avg hydration/ }).closest('tr');
    expect(hydrationRow?.textContent).toContain('Under-hydrated');
    expect(hydrationRow?.textContent).toContain('n=1');
    expect(hydrationRow?.textContent).not.toContain('/4');
    expect(hydrationRow?.textContent).not.toContain('2.0');
  });

  it('uses an accessible em dash for empty observations', () => {
    render(<TrainingAverages workoutLogs={[]} now={new Date(2026, 8, 21)} />);
    expect(screen.getAllByLabelText('No workouts logged').length).toBeGreaterThan(0);
  });

  it('places e1RM PRs after Total sets, distinguishes zero from no logs, and has no sample count', () => {
    const makeLog = (id: string, date: string, weight: number): WorkoutLog => ({
      id, date, unit: 'kg', exercises: [{
        name: 'Bench Press', exerciseKey: 'bench_press', muscleGroup: 'Pecs', modality: 'weighted',
        sets: [{ setNumber: 1, weight, reps: 5, isCompleted: true }],
      }],
    });
    render(<TrainingAverages workoutLogs={[
      makeLog('baseline', '2026-07-01', 100),
      makeLog('no-pr', '2026-09-14', 90),
      makeLog('pr', '2026-09-21', 110),
    ]} now={new Date(2026, 8, 22)} />);

    const rowHeaders = screen.getAllByRole('rowheader');
    const labels = rowHeaders.map(header => header.textContent);
    expect(labels.indexOf('e1RM PRs')).toBe(labels.indexOf('Total sets') + 1);
    expect(labels.indexOf('e1RM PRs')).toBeLessThan(labels.indexOf('Delts sets'));
    const prRow = screen.getByRole('rowheader', { name: 'e1RM PRs: Estimated one-rep-max personal records' }).closest('tr');
    expect(prRow?.textContent).toContain('0');
    expect(prRow?.textContent).toContain('1');
    expect(prRow?.querySelector('[aria-label="No workouts logged"]')).toBeTruthy();
    expect(prRow?.textContent).not.toContain('n=');
    expect(prRow?.closest('table')).toBeTruthy();
    expect(prRow?.querySelector('.training-averages-sticky')).toBeTruthy();
  });

  it('keeps historical e1RM PR values across ranges and older block navigation', () => {
    const logs: WorkoutLog[] = [
      { id: 'base', date: '2026-07-01', unit: 'kg', exercises: [{ name: 'Squat', exerciseKey: 'squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 100, reps: 5 }] }] },
      { id: 'older-pr', date: '2026-08-03', unit: 'kg', exercises: [{ name: 'Squat', exerciseKey: 'squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 110, reps: 5 }] }] },
      { id: 'current-pr', date: '2026-09-21', unit: 'kg', exercises: [{ name: 'Squat', exerciseKey: 'squat', muscleGroup: 'Quads', sets: [{ setNumber: 1, weight: 120, reps: 5 }] }] },
    ];
    render(<TrainingAverages workoutLogs={logs} now={new Date(2026, 8, 22)} />);
    const prText = () => screen.getByRole('rowheader', { name: /e1RM PRs/ }).closest('tr')?.textContent;
    expect(prText()).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: '8W' }));
    expect(prText()).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: '12W' }));
    expect(prText()).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: '4W' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous 4 weeks' }));
    expect(prText()).toContain('1');
    expect(screen.getByRole('tab', { name: 'Training Load' }).getAttribute('aria-selected')).toBe('true');
  });
});
