// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { storage } from '../storage';
import { discardActiveWorkoutSession, getActiveWorkoutDraft } from '../navigationGuard';
import type { Program } from '../../types';

const program = (id: string, name: string): Program => ({
  id, name, createdAt: '2026-01-01T00:00:00.000Z', daysPerWeek: 1, programDuration: 4,
  exercisesByDay: { 1: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1 }] }] },
});
const draft = { programId: 'a', programName: 'Program A', weekNum: 2, dayNum: 1, exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 5, rpe: 8 }] }] };

const reachConflict = () => {
  fireEvent.click(screen.getByRole('button', { name: /Program B Saved/i }));
  fireEvent.click(screen.getByRole('button', { name: /^Save Program$/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes & Enrol' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unenrol & Switch' }));
};

describe('active workout discard during program enrolment', () => {
  beforeEach(() => {
    localStorage.clear();
    storage.saveProgram(program('a', 'Program A'));
    storage.saveProgram(program('b', 'Program B'));
    storage.setCurrentProgramId('a');
    localStorage.setItem('metreps_workout_draft', JSON.stringify(draft));
    localStorage.setItem('restStartTime', '123');
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('names source and target, and Keep Workout preserves the exact resumable draft and current program', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    reachConflict();
    expect(screen.getByText(/unfinished workout for Program A\. Enrolling in Program B/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'KEEP WORKOUT' }));
    expect(storage.getCurrentProgramId()).toBe('a');
    expect(getActiveWorkoutDraft()?.rawDraft).toEqual(draft);
  });

  it('discards all recoverable sidecars before activating Program B while preserving programs and logs', () => {
    storage.saveWorkoutLog({ id: 'log-1', date: '2026-01-01', program: 'Program A', programId: 'a', week: '1', day: '1', exercises: [], unit: 'kg' });
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    reachConflict();
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD WORKOUT & SWITCH PROGRAM' }));
    expect(localStorage.getItem('metreps_workout_draft')).toBeNull();
    expect(localStorage.getItem('restStartTime')).toBeNull();
    expect(storage.getCurrentProgramId()).toBe('b');
    expect(storage.getPrograms().map(item => item.id)).toEqual(['a', 'b']);
    expect(storage.getWorkoutLogs()).toHaveLength(1);
    expect(storage.getPrograms().filter(item => item.id === 'b')).toHaveLength(1);
  });

  it('leaves Program A current and its full draft recoverable when discard fails', () => {
    const original = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
      if (key === 'metreps_workout_draft') throw new Error('blocked');
      original(key);
    });
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    reachConflict();
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD WORKOUT & SWITCH PROGRAM' }));
    expect(storage.getCurrentProgramId()).toBe('a');
    expect(getActiveWorkoutDraft()?.rawDraft).toEqual(draft);
    expect(screen.getByText(/saved for later.*remains current/i)).toBeTruthy();
  });

  it('canonical discard targets exact identities and supports one-off sessions', () => {
    vi.restoreAllMocks();
    (localStorage.removeItem as unknown as { mockRestore?: () => void }).mockRestore?.();
    expect(discardActiveWorkoutSession({ kind: 'programmed', programId: 'wrong', weekNum: 2, dayNum: 1 })).toBe(false);
    expect(getActiveWorkoutDraft()).not.toBeNull();
    const oneOff = { isOneOff: true, workoutId: 'one-1', exercises: [{ name: 'Curl' }] };
    localStorage.setItem('metreps_workout_draft', JSON.stringify(oneOff));
    expect(discardActiveWorkoutSession({ kind: 'one_off', workoutId: 'one-1' })).toBe(true);
    expect(getActiveWorkoutDraft()).toBeNull();
  });
});
