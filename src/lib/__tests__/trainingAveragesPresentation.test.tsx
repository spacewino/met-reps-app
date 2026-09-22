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
});
