// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from '../../components/HomeView';
import { CalendarDayNoteModal } from '../../components/CalendarDayNoteModal';
import { storage } from '../storage';
import { Program, WorkoutLog } from '../../types';

const TODAY = '2026-09-20';
const program: Program = { id: 'p1', name: 'Test', daysPerWeek: 1, programDuration: 1, createdAt: `${TODAY}T12:00:00.000Z`, exercisesByDay: { 1: [] } };
const log = (id: string, date = TODAY): WorkoutLog => ({ id, date, program: 'Test', exercises: [], unit: 'kg' });
const renderHome = (date = TODAY, logs: WorkoutLog[] = [], currentProgram: Program | null = null) => render(
  <HomeView currentProgram={currentProgram} workoutLogs={logs} selectedDate={date} setSelectedDate={() => {}} onNavigate={() => {}} />
);

describe('calendar day notes presentation and interaction', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 12));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('renders today actions side-by-side and non-today only as a full-width note action', () => {
    const today = renderHome();
    const oneOff = screen.getByRole('button', { name: /one-off workout/i });
    const add = screen.getByRole('button', { name: /add note/i });
    expect(oneOff.parentElement).toBe(add.parentElement);
    expect(add.parentElement?.className).toContain('grid-cols-2');
    today.unmount();

    renderHome('2026-09-19');
    expect(screen.queryByRole('button', { name: /one-off workout/i })).toBeNull();
    const pastAdd = screen.getByRole('button', { name: /add note/i });
    expect(pastAdd.parentElement?.className).toContain('grid-cols-1');
  });

  it('places an Agenda note before completed and workout content and formats the local date safely', () => {
    storage.saveCalendarDayNote(TODAY, 'general', 'Before workouts');
    renderHome(TODAY, [log('log-1')]);
    const note = screen.getByTestId('agenda-calendar-note');
    const completion = screen.getByText('Completed 1 Session!');
    expect(note.compareDocumentPosition(completion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Agenda: Sun, Sep 20/)).toBeTruthy();
  });

  it.each([['general', 'General'], ['sick', 'Sick'], ['travel', 'Travel']] as const)('renders the %s icon and announces its type', (type, label) => {
    storage.saveCalendarDayNote(TODAY, type, `${label} note`);
    renderHome();
    expect(screen.getByTestId(`calendar-note-icon-${TODAY}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(`${label} note`, 'i') })).toBeTruthy();
  });

  it.each([
    ['scheduled red dot', [], 'planned'],
    ['completed check', [log('one')], 'completed'],
    ['multiple-completion dots', [log('one'), log('two')], 'multiple'],
  ] as const)('keeps a note icon alongside the %s indicator', (_label, logs, state) => {
    storage.saveCalendarDayNote(TODAY, 'general', 'Coexists');
    vi.spyOn(storage, 'getPlannedSessions').mockReturnValue(state === 'planned' ? { [TODAY]: { date: TODAY, programId: 'p1', dayIndex: 1, status: 'planned' } } : {});
    renderHome(TODAY, [...logs], state === 'planned' ? program : null);
    const cell = screen.getByTestId(`calendar-note-icon-${TODAY}`).closest('button')!;
    expect(cell).toBeTruthy();
    if (state === 'planned') expect(cell.querySelector('.bg-red-400')).toBeTruthy();
    if (state === 'completed') expect(cell.querySelector('svg.text-emerald-400')).toBeTruthy();
    if (state === 'multiple') expect(cell.querySelectorAll('.bg-emerald-400')).toHaveLength(2);
  });

  it('updates the Agenda and calendar immediately after add, edit, and confirmed delete without changing workout logs', async () => {
    localStorage.setItem('workoutLogs', JSON.stringify([log('untouched')]));
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'First' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByTestId(`calendar-note-icon-${TODAY}`)).toBeTruthy();

    fireEvent.click(within(screen.getByTestId('agenda-calendar-note')).getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('First');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Edited')).toBeTruthy();

    fireEvent.click(within(screen.getByTestId('agenda-calendar-note')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Note' }));
    expect(screen.getByText('This calendar day note will be permanently deleted.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete Note' }).at(-1)!);
    expect(screen.queryByTestId('agenda-calendar-note')).toBeNull();
    expect(screen.queryByTestId(`calendar-note-icon-${TODAY}`)).toBeNull();
    expect(localStorage.getItem('workoutLogs')).toBe(JSON.stringify([log('untouched')]));
  });

  it('supports add cancellation and backdrop dismissal without saving', () => {
    const onSave = vi.fn(); const onClose = vi.fn();
    const view = render(<CalendarDayNoteModal visible date={TODAY} note={null} onSave={onSave} onDelete={() => {}} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Discard me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce(); expect(onSave).not.toHaveBeenCalled();
    view.rerender(<CalendarDayNoteModal visible date={TODAY} note={null} onSave={onSave} onDelete={() => {}} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2); expect(onSave).not.toHaveBeenCalled();
  });
});
