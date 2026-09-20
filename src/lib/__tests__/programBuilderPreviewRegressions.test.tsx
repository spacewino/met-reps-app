// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { storage } from '../storage';
import type { Program, WorkoutLog } from '../../types';

const program = (id: string, name: string): Program => ({
  id, name, daysPerWeek: 1, programDuration: 4, createdAt: '2026-01-01T00:00:00.000Z',
  exercisesByDay: { 1: [{ name: 'Squat', muscleGroup: 'Quads', isMainMovement: true, sets: [{ setNumber: 1 }] }] },
});
const log: WorkoutLog = { id: 'log-1', date: '2026-01-02', program: 'Active Plan', programId: 'active', week: '1', day: '1', exercises: [], unit: 'kg' };
const input = () => screen.getByPlaceholderText(/hypertrophy push pull legs/i) as HTMLInputElement;
const save = (choice: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name: /^save program$/i }));
  fireEvent.click(screen.getByRole('button', { name: choice }));
};
const dismissNotice = () => fireEvent.click(screen.getByRole('button', { name: 'OK' }));

describe('Program Builder preview regressions', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('reserves the green tick and Active label for currentProgramId while marking an inactive editor selection as Saved and Editing', () => {
    storage.saveProgram(program('active', 'Active Plan'));
    storage.saveProgram(program('future', 'Future Plan'));
    storage.setCurrentProgramId('active');
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Future Plan Saved/i }));
    const active = screen.getByRole('button', { name: /Active Plan Active/i });
    const editing = screen.getByRole('button', { name: /Future Plan Saved · Editing/i });
    expect(active.className).toContain('border-emerald-500');
    expect(active.querySelector('.lucide-check')).not.toBeNull();
    expect(editing.className).toContain('border-indigo-500');
    expect(editing.className).not.toContain('border-emerald-500');
    expect(editing.querySelector('.lucide-check')).toBeNull();
  });

  it('does not give a new unsaved editor selection active styling', () => {
    storage.saveProgram(program('active', 'Active Plan'));
    storage.setCurrentProgramId('active');
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /New Custom Program/i }));
    expect(screen.getByText('New unsaved program')).toBeTruthy();
    expect(screen.getByRole('button', { name: /New Custom Program/i }).className).not.toContain('border-emerald-500');
    expect(screen.getByRole('button', { name: /Active Plan Active/i }).className).toContain('border-emerald-500');
  });

  it('unenrols only the actual current program and preserves its record and workout history', () => {
    storage.saveProgram(program('active', 'Active Plan'));
    storage.saveProgram(program('future', 'Future Plan'));
    storage.saveWorkoutLog(log);
    storage.setCurrentProgramId('active');
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Future Plan Saved/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Unenrol from Current Program' }));
    expect(screen.getByText('UNENROL FROM CURRENT PROGRAM?')).toBeTruthy();
    expect(screen.getByText(/Active Plan will remain saved, but it will no longer be your current program/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Unenrol' }));

    expect(storage.getCurrentProgramId()).toBeNull();
    expect(storage.getPrograms().map(item => item.id)).toEqual(['active', 'future']);
    expect(storage.getWorkoutLogs()).toEqual([log]);
  });

  it('cancelling current-program unenrolment changes nothing', () => {
    storage.saveProgram(program('active', 'Active Plan'));
    storage.saveWorkoutLog(log);
    storage.setCurrentProgramId('active');
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unenrol from Current Program' }));
    fireEvent.click(screen.getByRole('button', { name: 'No, Stay Enrolled' }));
    expect(storage.getCurrentProgramId()).toBe('active');
    expect(storage.getPrograms()).toHaveLength(1);
    expect(storage.getWorkoutLogs()).toEqual([log]);
  });

  it.each([
    ['Back', (onClose: ReturnType<typeof vi.fn>) => fireEvent.click(screen.getAllByRole('button')[0]), (onClose: ReturnType<typeof vi.fn>) => expect(onClose).toHaveBeenCalled()],
    ['saved program', () => fireEvent.click(screen.getByRole('button', { name: /Other Plan Saved/i })), () => expect(input().value).toBe('Other Plan')],
    ['template', () => fireEvent.click(screen.getByRole('button', { name: /Upper\/Lower Foundations Template/i })), () => expect(input().value).toBe('Upper/Lower Foundations')],
    ['New Custom', () => fireEvent.click(screen.getByRole('button', { name: /New Custom Program/i })), () => expect(input().value).toBe('My Custom Strength Program')],
  ])('Save for Later establishes a clean baseline before immediate %s navigation', (_label, navigate, verify) => {
    storage.saveProgram(program('other', 'Other Plan'));
    const onClose = vi.fn();
    render(<ProgramBuilder onClose={onClose} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Milhouse Mass Split Template/i }));
    fireEvent.change(input(), { target: { value: 'Saved Future' } });
    save(/^Save for Later$/i);
    dismissNotice();
    navigate(onClose);
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
    verify(onClose);
  });

  it('a genuine edit after Save for Later restores dirty protection', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Milhouse Mass Split Template/i }));
    save(/^Save for Later$/i);
    dismissNotice();
    fireEvent.change(input(), { target: { value: 'Changed again' } });
    fireEvent.click(screen.getByRole('button', { name: /New Custom Program/i }));
    expect(screen.getByText('Discard unsaved changes?')).toBeTruthy();
  });

  it('Save Changes and successful enrolment both clear dirty state', () => {
    const dirtyStates: boolean[] = [];
    storage.saveProgram(program('active', 'Active Plan'));
    storage.setCurrentProgramId('active');
    const view = render(<ProgramBuilder onClose={() => {}} onSave={() => {}} onDirtyChange={value => dirtyStates.push(value)} />);
    fireEvent.change(input(), { target: { value: 'Active Renamed' } });
    save(/^Save Changes$/i);
    dismissNotice();
    expect(dirtyStates.at(-1)).toBe(false);

    view.unmount();
    storage.setCurrentProgramId(null);
    dirtyStates.length = 0;
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} onDirtyChange={value => dirtyStates.push(value)} />);
    fireEvent.click(screen.getByRole('button', { name: /Milhouse Mass Split Template/i }));
    save(/^Save & Enrol$/i);
    expect(dirtyStates.at(-1)).toBe(false);
  });

  it('failed persistence retains edits and dirty protection', () => {
    vi.spyOn(storage, 'saveProgram').mockImplementation(() => { throw new Error('quota'); });
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Milhouse Mass Split Template/i }));
    fireEvent.change(input(), { target: { value: 'Unsaved after failure' } });
    save(/^Save for Later$/i);
    expect(screen.getByText('quota')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(input().value).toBe('Unsaved after failure');
    fireEvent.click(screen.getByRole('button', { name: /New Custom Program/i }));
    expect(screen.getByText('Discard unsaved changes?')).toBeTruthy();
  });
});
