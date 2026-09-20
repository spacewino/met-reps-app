// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { storage } from '../storage';
import type { Program } from '../../types';

const validProgram = (id: string, name: string): Program => ({
  id, name, daysPerWeek: 1, programDuration: 4, createdAt: '2026-01-01T00:00:00.000Z',
  exercisesByDay: { 1: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1 }] }] },
});

const openSave = () => fireEvent.click(screen.getByRole('button', { name: /^save program$/i }));
const nameInput = () => screen.getByPlaceholderText(/hypertrophy push pull legs/i) as HTMLInputElement;

describe('Program Builder save choices and unsaved-change protection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('shows the new-program actions', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Milhouse Mass Split/i }));
    openSave();
    expect(screen.getByRole('button', { name: 'Save for Later' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save & Enrol' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep Editing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard Draft' })).toBeTruthy();
  });

  it('shows inactive saved actions and does not make it active when saving changes', () => {
    storage.saveProgram(validProgram('active', 'Active'));
    storage.saveProgram(validProgram('saved', 'Saved'));
    storage.setCurrentProgramId('active');
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Saved Saved/i }));
    fireEvent.change(nameInput(), { target: { value: 'Saved edited' } });
    openSave();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save Changes & Enrol' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(storage.getCurrentProgramId()).toBe('active');
  });

  it('shows active saved actions without Save & Enrol', () => {
    storage.saveProgram(validProgram('active', 'Active'));
    storage.setCurrentProgramId('active');
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.change(nameInput(), { target: { value: 'Active edited' } });
    openSave();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Save & Enrol|Save Changes & Enrol)$/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep Editing' })).toBeTruthy();
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['backdrop', () => fireEvent.mouseDown(screen.getByRole('dialog'))],
    ['Keep Editing', () => fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))],
  ])('%s closes the save dialog while retaining edits', (_label, dismiss) => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Milhouse Mass Split/i }));
    fireEvent.change(nameInput(), { target: { value: 'Unsaved future plan' } });
    openSave();
    dismiss();
    expect(screen.queryByRole('dialog', { name: 'Save program' })).toBeNull();
    expect(nameInput().value).toBe('Unsaved future plan');
  });

  it.each([
    ['back navigation', () => fireEvent.click(screen.getAllByRole('button')[0])],
    ['template selection', () => fireEvent.click(screen.getByRole('button', { name: /Upper\/Lower Foundations/i }))],
    ['saved-program selection', () => fireEvent.click(screen.getByRole('button', { name: /Saved Saved/i }))],
    ['New Custom', () => fireEvent.click(screen.getByRole('button', { name: 'New Custom' }))],
  ])('protects dirty edits before %s', (_label, navigate) => {
    storage.saveProgram(validProgram('saved', 'Saved'));
    const onClose = vi.fn();
    render(<ProgramBuilder onClose={onClose} onSave={() => {}} />);
    fireEvent.change(nameInput(), { target: { value: 'Do not lose me' } });
    navigate();
    expect(screen.getByText('Discard unsaved changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }));
    expect(nameInput().value).toBe('Do not lose me');
    expect(onClose).not.toHaveBeenCalled();
  });
});
