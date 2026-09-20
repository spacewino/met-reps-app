// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../../components/SettingsView';
import { storage } from '../storage';

const DATE = '2026-09-20';
const renderSettings = () => render(<SettingsView currentProgram={null} onRefresh={() => {}} onClose={() => {}} themeId="slate" onThemeChange={() => {}} />);
const openData = () => fireEvent.click(screen.getByRole('button', { name: 'App Data Management' }));

describe('calendar day notes backup and reset integration', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => cleanup());

  it('includes calendarDayNotes in a downloaded backup', () => {
    storage.saveCalendarDayNote(DATE, 'travel', 'Flight');
    let dataHref = '';
    const original = HTMLAnchorElement.prototype.setAttribute;
    vi.spyOn(HTMLAnchorElement.prototype, 'setAttribute').mockImplementation(function (this: HTMLAnchorElement, name, value) {
      if (name === 'href') dataHref = value;
      return original.call(this, name, value);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderSettings(); openData();
    fireEvent.click(screen.getByRole('button', { name: /Download Backup/i }));
    const backup = JSON.parse(decodeURIComponent(dataHref.split(',')[1]));
    expect(backup.calendarDayNotes[DATE]).toMatchObject({ type: 'travel', text: 'Flight' });
  });

  it('preserves all program lifecycle dates in a downloaded backup', () => {
    storage.saveProgram({
      id: 'dated', name: 'Dated', daysPerWeek: 1, programDuration: 4,
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z',
      enrolledAt: '2025-03-01T00:00:00.000Z', exercisesByDay: { 1: [] },
    });
    let dataHref = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'setAttribute').mockImplementation(function (this: HTMLAnchorElement, name, value) {
      if (name === 'href') dataHref = value;
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderSettings(); openData();
    fireEvent.click(screen.getByRole('button', { name: /Download Backup/i }));
    const exported = JSON.parse(decodeURIComponent(dataHref.split(',')[1])).programList[0];
    expect(exported).toMatchObject({
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z',
      enrolledAt: '2025-03-01T00:00:00.000Z',
    });
  });

  it('imports an older backup without calendarDayNotes normally', async () => {
    renderSettings(); openData();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const oldBackup = { programList: [], workoutLogs: [], customExercises: [] };
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(oldBackup)], 'old.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByText(/0 calendar day notes/)).toBeTruthy());
    expect(storage.getCalendarDayNotes()).toEqual({});
  });

  it('imports a legacy program backup without updatedAt or enrolledAt', async () => {
    renderSettings(); openData();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const legacy = { id: 'legacy', name: 'Legacy', createdAt: '2024-01-01T00:00:00.000Z', daysPerWeek: 1, programDuration: 4, exercisesByDay: { 1: [] } };
    fireEvent.change(input, { target: { files: [new File([JSON.stringify({ programList: [legacy] })], 'legacy.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByText(/Successfully imported 1 programs/)).toBeTruthy());
    expect(storage.getPrograms().find(program => program.id === legacy.id)).toEqual(legacy);
  });

  it('imports notes by merging unrelated dates and replacing a matching date', async () => {
    storage.saveCalendarDayNote('2026-09-19', 'general', 'Keep');
    storage.saveCalendarDayNote(DATE, 'general', 'Replace');
    const imported = {
      type: 'sick', text: 'Imported',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    };
    renderSettings(); openData();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([JSON.stringify({ calendarDayNotes: { [DATE]: imported } })], 'notes.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByText(/1 calendar day notes/)).toBeTruthy());
    expect(storage.getCalendarDayNote('2026-09-19')?.text).toBe('Keep');
    expect(storage.getCalendarDayNote(DATE)?.text).toBe('Imported');
  });

  it('preserves notes when restoring templates', () => {
    storage.saveProgram({ id: 'custom', name: 'Custom', createdAt: '2026-01-01', daysPerWeek: 1, programDuration: 4, exercisesByDay: { 1: [] } });
    storage.setCurrentProgramId('custom');
    storage.saveWorkoutLog({ id: 'log-1', date: DATE, program: 'Custom', programId: 'custom', week: '1', day: '1', exercises: [], unit: 'kg' });
    storage.saveCalendarDayNote(DATE, 'general', 'Preserve');
    renderSettings(); openData();
    fireEvent.click(screen.getByRole('button', { name: /Restore Default Templates/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Templates' }));
    expect(storage.getCalendarDayNote(DATE)?.text).toBe('Preserve');
    expect(storage.getPrograms()).toEqual([]);
    expect(storage.getWorkoutLogs()).toHaveLength(1);
    expect(storage.getCurrentProgramId()).toBeNull();
  });

  it('removes notes during complete reset', () => {
    storage.saveProgram({ id: 'custom', name: 'Custom', createdAt: '2026-01-01', daysPerWeek: 1, programDuration: 4, exercisesByDay: { 1: [] } });
    storage.setCurrentProgramId('custom');
    storage.saveCalendarDayNote(DATE, 'general', 'Remove');
    renderSettings(); openData();
    fireEvent.click(screen.getByRole('button', { name: /Wipe Slate Completely/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Wipe Everything' }));
    expect(storage.getCalendarDayNotes()).toEqual({});
    expect(storage.getPrograms()).toEqual([]);
    expect(storage.getWorkoutLogs()).toEqual([]);
    expect(storage.getCurrentProgramId()).toBeNull();
  });
});
