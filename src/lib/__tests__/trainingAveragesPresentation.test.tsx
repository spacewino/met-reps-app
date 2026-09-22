// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TrainingAverages } from '../../components/TrainingAverages';

describe('TrainingAverages presentation', () => {
  afterEach(cleanup);
  it('provides accessible ranges, window navigation, tabs and semantic table headings', () => {
    const { container } = render(<TrainingAverages workoutLogs={[]} now={new Date(2026, 8, 21)} />);
    expect(screen.getByRole('heading', { name: 'Training Averages' })).toBeTruthy();
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

  it('supports keyboard tab operation and calls the saved metric Workout Quality', () => {
    render(<TrainingAverages workoutLogs={[]} now={new Date(2026, 8, 21)} />);
    const load = screen.getByRole('tab', { name: 'Training Load' });
    fireEvent.keyDown(load, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Workout Context' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('rowheader', { name: /Workout Quality/ })).toBeTruthy();
    expect(screen.queryByText(/motivation/i)).toBeNull();
  });

  it('uses an accessible em dash for empty observations', () => {
    render(<TrainingAverages workoutLogs={[]} now={new Date(2026, 8, 21)} />);
    expect(screen.getAllByLabelText('No workouts logged').length).toBeGreaterThan(0);
  });
});
