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

  it('imports an older backup without calendarDayNotes normally', async () => {
    renderSettings(); openData();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const oldBackup = { programList: [], workoutLogs: [], customExercises: [] };
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(oldBackup)], 'old.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByText(/0 calendar day notes/)).toBeTruthy());
    expect(storage.getCalendarDayNotes()).toEqual({});
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
    storage.saveCalendarDayNote(DATE, 'general', 'Preserve');
    renderSettings(); openData();
    fireEvent.click(screen.getByRole('button', { name: /Restore Default Templates/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Templates' }));
    expect(storage.getCalendarDayNote(DATE)?.text).toBe('Preserve');
  });

  it('removes notes during complete reset', () => {
    storage.saveCalendarDayNote(DATE, 'general', 'Remove');
    renderSettings(); openData();
    fireEvent.click(screen.getByRole('button', { name: /Wipe Slate Completely/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Wipe Everything' }));
    expect(storage.getCalendarDayNotes()).toEqual({});
  });
});
