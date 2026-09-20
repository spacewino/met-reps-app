import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '../storage';
import { getEffectiveEnrolmentDate } from '../dateUtils';
import type { Program } from '../../types';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });

const program = (id: string, name: string, createdAt = '2026-01-01T00:00:00.000Z'): Program => ({
  id,
  name,
  createdAt,
  daysPerWeek: 1,
  programDuration: 4,
  exercisesByDay: { 1: [{ name: 'Squat', muscleGroup: 'Quads', sets: [{ setNumber: 1 }] }] },
  assignedWeekdays: { 1: 0 },
});

describe('saved program designs and enrolment', () => {
  beforeEach(() => localStorage.clear());

  it('saves a new program for later without changing the active program, logs, or draft', () => {
    const active = storage.enrolProgram(program('active', 'Active'));
    const activeId = storage.getCurrentProgramId();
    localStorage.setItem('workoutLogs', JSON.stringify([{ id: 'log-1', programId: active.id }]));
    localStorage.setItem('metreps_workout_draft', JSON.stringify({ programId: active.id, weekNum: 2 }));

    const saved = storage.saveProgramDesign(program('future', 'Future'));

    expect(saved.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(saved.updatedAt).toBeTruthy();
    expect(saved.enrolledAt).toBeUndefined();
    expect(storage.getCurrentProgramId()).toBe(activeId);
    expect(storage.getWorkoutLogs()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('metreps_workout_draft')!).programId).toBe(active.id);
  });

  it('edits and renames the same inactive record without activating it or losing metadata', () => {
    storage.setCurrentProgramId('other');
    const saved = storage.saveProgramDesign({ ...program('future', 'Future'), unit: 'kg', enrolledAt: '2025-02-01T00:00:00.000Z' });
    const edited = storage.saveProgramDesign({ ...saved, name: 'Future Two', daysPerWeek: 2 });
    expect(edited.id).toBe('future');
    expect(edited.createdAt).toBe(saved.createdAt);
    expect(edited.enrolledAt).toBe(saved.enrolledAt);
    expect(edited.unit).toBe('kg');
    expect(storage.getCurrentProgramId()).toBe('other');
  });

  it('enrols and re-enrols with the same identity and creation date but a fresh run date', async () => {
    const first = storage.enrolProgram(program('future', 'Future'));
    await new Promise(resolve => setTimeout(resolve, 2));
    const second = storage.enrolProgram({ ...first, name: 'Renamed Future' });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(Date.parse(second.enrolledAt!)).toBeGreaterThan(Date.parse(first.enrolledAt!));
    expect(storage.getCurrentProgramId()).toBe(first.id);
  });

  it('rejects normalized duplicate names without overwriting either program', () => {
    storage.saveProgramDesign(program('one', 'My Plan'));
    expect(() => storage.saveProgramDesign(program('two', '  my PLAN  '))).toThrow('already exists');
    expect(storage.getPrograms().map(p => p.id)).toEqual(['one']);
  });

  it('leaves the old active pointer unchanged when persistence fails', () => {
    storage.setCurrentProgramId('active');
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((key) => {
      if (key === 'programList') throw new Error('quota');
    });
    expect(() => storage.enrolProgram(program('new', 'New'))).toThrow('quota');
    expect(storage.getCurrentProgramId()).toBe('active');
    spy.mockRestore();
  });

  it('centralizes legacy active fallback while inactive legacy designs have no run', () => {
    const legacy = program('legacy', 'Legacy', '2026-02-02T00:00:00.000Z');
    expect(getEffectiveEnrolmentDate(legacy, true)).toBe(legacy.createdAt);
    expect(getEffectiveEnrolmentDate(legacy, false)).toBeNull();
    expect(getEffectiveEnrolmentDate({ ...legacy, enrolledAt: '2026-03-03T00:00:00.000Z' }, true)).toBe('2026-03-03T00:00:00.000Z');
  });

  it('keeps a legacy active program on the same effective week after loading and saving changes', () => {
    const legacy = program('legacy', 'Legacy', '2026-01-05T00:00:00.000Z');
    storage.saveProgram(legacy);
    storage.setCurrentProgramId(legacy.id);
    const loaded = storage.getCurrentProgram()!;
    const before = getEffectiveEnrolmentDate(loaded, true);
    const saved = storage.saveProgramDesign({ ...loaded, name: 'Legacy edited' });
    const after = getEffectiveEnrolmentDate(saved, true);
    expect(before).toBe('2026-01-05T00:00:00.000Z');
    expect(after).toBe(before);
    expect(saved.enrolledAt).toBeUndefined();
  });
});
