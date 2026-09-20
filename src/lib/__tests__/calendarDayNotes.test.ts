// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { storage } from '../storage';

describe('calendar day note storage', () => {
  beforeEach(() => localStorage.clear());

  it('safely handles missing and malformed storage', () => {
    expect(storage.getCalendarDayNotes()).toEqual({});
    localStorage.setItem('metreps_calendar_day_notes', '{bad json');
    expect(storage.getCalendarDayNotes()).toEqual({});
  });

  it.each(['general', 'sick', 'travel'] as const)('saves a valid %s note', type => {
    const note = storage.saveCalendarDayNote('2026-09-20', type, '  A day note  ');
    expect(note).toMatchObject({ type, text: 'A day note' });
    expect(storage.getCalendarDayNote('2026-09-20')).toEqual(note);
  });

  it('replaces the note for a date while preserving createdAt, then deletes it', () => {
    const first = storage.saveCalendarDayNote('2026-09-20', 'general', 'First')!;
    const second = storage.saveCalendarDayNote('2026-09-20', 'travel', 'Second')!;
    expect(Object.keys(storage.getCalendarDayNotes())).toHaveLength(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect(storage.deleteCalendarDayNote('2026-09-20')).toBe(true);
    expect(storage.getCalendarDayNote('2026-09-20')).toBeNull();
  });

  it('rejects invalid dates, types, and text', () => {
    expect(storage.saveCalendarDayNote('2026-02-30', 'general', 'No')).toBeNull();
    expect(storage.saveCalendarDayNote('2026-09-20', 'other' as never, 'No')).toBeNull();
    expect(storage.saveCalendarDayNote('2026-09-20', 'general', '   ')).toBeNull();
    expect(storage.saveCalendarDayNote('2026-09-20', 'general', 'x'.repeat(301))).toBeNull();
  });

  it('merges valid imports and replaces only conflicting dates', () => {
    storage.saveCalendarDayNote('2026-09-19', 'general', 'Keep');
    storage.saveCalendarDayNote('2026-09-20', 'general', 'Replace');
    const imported = storage.importCalendarDayNotes({
      '2026-09-20': { type: 'sick', text: 'Imported', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z' },
      bad: { type: 'travel', text: 'Invalid', createdAt: '', updatedAt: '' },
    });
    expect(imported).toBe(1);
    expect(storage.getCalendarDayNote('2026-09-19')?.text).toBe('Keep');
    expect(storage.getCalendarDayNote('2026-09-20')?.text).toBe('Imported');
  });
});
