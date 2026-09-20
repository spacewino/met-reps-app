// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { PREBUILT_TEMPLATES, storage } from '../storage';
import type { Program } from '../../types';

const savedProgram = (id: string, name: string): Program => ({
  id, name, createdAt: '2026-01-01T00:00:00.000Z', daysPerWeek: 1, programDuration: 4,
  exercisesByDay: { 1: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1 }] }] },
});
const input = () => screen.getByPlaceholderText(/hypertrophy push pull legs/i) as HTMLInputElement;
const sectionFor = (heading: string) => screen.getByRole('heading', { name: heading }).closest('section')!;
const chooseSave = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: /^Save Program$/i }));
  fireEvent.click(screen.getByRole('button', { name: label }));
};

describe('Program Builder selector presentation', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('separates templates from saved programs and gives New Custom a full-width saved-section action', () => {
    storage.saveProgram(savedProgram('saved', 'Saved Plan'));
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    const templates = within(sectionFor('Templates'));
    const saved = within(sectionFor('My Saved Programs'));
    expect(templates.getByRole('button', { name: /Milhouse Mass Split Template/i })).toBeTruthy();
    expect(templates.queryByRole('button', { name: /Saved Plan/i })).toBeNull();
    expect(saved.getByRole('button', { name: /Saved Plan Saved/i })).toBeTruthy();
    expect(saved.queryByRole('button', { name: /Milhouse Mass Split/i })).toBeNull();
    expect(saved.getByRole('button', { name: /New Custom Program/i }).className).toContain('w-full');
  });

  it('marks a selected template as pressed and selected while keeping the editor new and unsaved', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    const template = within(sectionFor('Templates')).getByRole('button', { name: /Milhouse Mass Split Template/i });
    fireEvent.click(template);
    expect(template.getAttribute('aria-pressed')).toBe('true');
    expect(template.textContent).toContain('Template · Selected');
    expect(template.className).toContain('border-indigo-500');
    expect(template.className).not.toContain('border-emerald-500');
    expect(screen.getByText('New unsaved program')).toBeTruthy();
  });

  it('marks New Custom as a non-green selected editing state', () => {
    storage.saveProgram(savedProgram('active', 'Active Plan'));
    storage.setCurrentProgramId('active');
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /New Custom Program/i }));
    const action = screen.getByRole('button', { name: /New Custom Program/i });
    expect(action.getAttribute('aria-pressed')).toBe('true');
    expect(action.textContent).toContain('New · Editing');
    expect(action.className).toContain('border-indigo-500');
    expect(action.className).not.toContain('border-emerald-500');
  });

  it('communicates Active and Editing together for the current saved program', () => {
    storage.saveProgram(savedProgram('active', 'Active Plan'));
    storage.setCurrentProgramId('active');
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    const active = screen.getByRole('button', { name: /Active Plan Active · Editing/i });
    expect(active.className).toContain('border-emerald-500');
    expect(active.querySelector('.lucide-check')).not.toBeNull();
    expect(active.querySelector('.lucide-pencil')).not.toBeNull();
  });

  it('does not confuse a selected template with an active saved program sharing its name', () => {
    storage.saveProgram(savedProgram('active-copy', 'Milhouse Mass Split'));
    storage.setCurrentProgramId('active-copy');
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    const templates = within(sectionFor('Templates'));
    const template = templates.getByRole('button', { name: /Milhouse Mass Split Template/i });
    fireEvent.click(template);
    expect(template.textContent).toContain('Template · Selected');
    expect(template.className).not.toContain('border-emerald-500');
    expect(within(sectionFor('My Saved Programs')).getByRole('button', { name: /Milhouse Mass Split Active/i }).className).toContain('border-emerald-500');
  });

  it('moves a template draft to Saved · Editing after Save for Later without changing the template', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    const template = within(sectionFor('Templates')).getByRole('button', { name: /Milhouse Mass Split Template/i });
    const originalTemplate = structuredClone(PREBUILT_TEMPLATES[0]);
    fireEvent.click(template);
    fireEvent.change(input(), { target: { value: 'Template Based Plan' } });
    chooseSave('Save for Later');
    expect(template.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /Template Based Plan Saved · Editing/i })).toBeTruthy();
    expect(storage.getPrograms().find(program => program.name === 'Template Based Plan')).toBeTruthy();
    expect(PREBUILT_TEMPLATES[0]).toEqual(originalTemplate);
  });

  it('moves a valid New Custom draft to Saved · Editing after Save for Later', () => {
    localStorage.setItem('metreps_custom_exercises', JSON.stringify([
      { name: 'Custom Selector Lift', category: 'Back', modality: 'weighted', exerciseKey: 'custom_selector_lift' },
    ]));
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /3 Days per week/i }));
    fireEvent.click(screen.getByRole('button', { name: /1 Day per week/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /Add Exercise/i })[0]);
    fireEvent.click(screen.getByRole('heading', { name: 'Custom Selector Lift' }).closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /Add to Workout \(1\)/i }));
    fireEvent.change(input(), { target: { value: 'Blank Custom Plan' } });
    chooseSave('Save for Later');
    expect(screen.getByRole('button', { name: /New Custom Program/i }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /Blank Custom Plan Saved · Editing/i })).toBeTruthy();
  });

  it('Save & Enrol creates a saved record and gives it Active · Editing presentation', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Milhouse Mass Split Template/i }));
    fireEvent.change(input(), { target: { value: 'Enrolled Template Plan' } });
    chooseSave('Save & Enrol');
    const stored = storage.getPrograms().find(program => program.name === 'Enrolled Template Plan')!;
    expect(storage.getCurrentProgramId()).toBe(stored.id);
    expect(screen.getByRole('button', { name: /Enrolled Template Plan Active · Editing/i }).className).toContain('border-emerald-500');
  });

  it('shows a neutral Current Program empty state without an unenrol action', () => {
    render(<ProgramBuilder onClose={() => {}} onSave={() => {}} />);
    expect(within(sectionFor('Current Program')).getByText(/No current program/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Unenrol from Current Program/i })).toBeNull();
  });
});
