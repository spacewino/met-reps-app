import { describe, it, expect, beforeEach } from 'vitest';
import { Program, WorkoutLog } from '../../types';
import { storage } from '../storage';

// In-memory localStorage mock for node test runner
const memoryStore: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key: string) => memoryStore[key] ?? null,
  setItem: (key: string, value: string) => {
    memoryStore[key] = String(value);
  },
  removeItem: (key: string) => {
    delete memoryStore[key];
  },
  clear: () => {
    Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
  },
  key: (index: number) => Object.keys(memoryStore)[index] ?? null,
  length: 0,
};

/**
 * Helper recreating the exact badge-decision logic used by AnalyticsView:
 * prog.id === currentProgramId
 */
function shouldRenderActiveBadge(programId: string, currentProgramId: string | null): boolean {
  return programId === currentProgramId;
}

describe('Program Report Card ACTIVE Badge Regression Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const programA: Program = {
    id: 'program-a',
    name: 'Program A (4 Weeks)',
    daysPerWeek: 3,
    programDuration: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    exercisesByDay: {
      1: [{ name: 'Squat', muscleGroup: 'Quads', modality: 'weighted', sets: [{ setNumber: 1, reps: 5, weight: 100 }] }],
      2: [{ name: 'Bench', muscleGroup: 'Chest', modality: 'weighted', sets: [{ setNumber: 1, reps: 5, weight: 80 }] }],
      3: [{ name: 'Deadlift', muscleGroup: 'Back', modality: 'weighted', sets: [{ setNumber: 1, reps: 5, weight: 120 }] }],
    },
  };

  const programB: Program = {
    id: 'program-b',
    name: 'Program B (6 Weeks)',
    daysPerWeek: 4,
    programDuration: 6,
    createdAt: '2026-01-15T00:00:00.000Z',
    exercisesByDay: {
      1: [{ name: 'Overhead Press', muscleGroup: 'Shoulders', modality: 'weighted', sets: [{ setNumber: 1, reps: 8, weight: 50 }] }],
    },
  };

  const programCNoLogs: Program = {
    id: 'program-c',
    name: 'Program C (No Logs)',
    daysPerWeek: 3,
    programDuration: 4,
    createdAt: '2026-02-01T00:00:00.000Z',
    exercisesByDay: {
      1: [{ name: 'Pull Up', muscleGroup: 'Back', modality: 'bodyweight', sets: [{ setNumber: 1, reps: 10 }] }],
    },
  };

  const sampleLogs: WorkoutLog[] = [
    // Program A has incomplete history (Weeks 1 & 2 only)
    {
      id: 'log-1',
      date: '2026-01-02',
      programId: 'program-a',
      week: '1',
      day: '1',
      unit: 'kg',
      exercises: [],
    },
    {
      id: 'log-2',
      date: '2026-01-09',
      programId: 'program-a',
      week: '2',
      day: '1',
      unit: 'kg',
      exercises: [],
    },
    // Program B has incomplete history (Week 1 only)
    {
      id: 'log-3',
      date: '2026-01-16',
      programId: 'program-b',
      week: '1',
      day: '1',
      unit: 'kg',
      exercises: [],
    },
  ];

  it('Scenario A: Program A and B are incomplete, currentProgramId is Program B -> only Program B displays ACTIVE', () => {
    storage.saveProgram(programA);
    storage.saveProgram(programB);
    storage.setCurrentProgramId(programB.id);

    const currentProgramId = storage.getCurrentProgramId();
    expect(currentProgramId).toBe('program-b');

    // Both programs qualify for interim report cards (incomplete)
    expect(storage.isProgramCompleted(programA, sampleLogs)).toBe(false);
    expect(storage.isProgramCompleted(programB, sampleLogs)).toBe(false);

    // Active badge condition: prog.id === currentProgramId
    expect(shouldRenderActiveBadge(programA.id, currentProgramId)).toBe(false);
    expect(shouldRenderActiveBadge(programB.id, currentProgramId)).toBe(true);
  });

  it('Scenario B: currentProgramId is Program A -> only Program A displays ACTIVE', () => {
    storage.saveProgram(programA);
    storage.saveProgram(programB);
    storage.setCurrentProgramId(programA.id);

    const currentProgramId = storage.getCurrentProgramId();
    expect(currentProgramId).toBe('program-a');

    expect(shouldRenderActiveBadge(programA.id, currentProgramId)).toBe(true);
    expect(shouldRenderActiveBadge(programB.id, currentProgramId)).toBe(false);
  });

  it('Scenario C: currentProgramId is null -> no report card displays ACTIVE', () => {
    storage.saveProgram(programA);
    storage.saveProgram(programB);
    storage.setCurrentProgramId(null);

    const currentProgramId = storage.getCurrentProgramId();
    expect(currentProgramId).toBeNull();

    expect(shouldRenderActiveBadge(programA.id, currentProgramId)).toBe(false);
    expect(shouldRenderActiveBadge(programB.id, currentProgramId)).toBe(false);
  });

  it('Scenario D: currentProgramId references a program with no workout logs -> no displayed report card shows ACTIVE', () => {
    storage.saveProgram(programA);
    storage.saveProgram(programB);
    storage.saveProgram(programCNoLogs);
    storage.setCurrentProgramId(programCNoLogs.id);

    const currentProgramId = storage.getCurrentProgramId();
    expect(currentProgramId).toBe('program-c');

    // Report cards are only created for programs that have logged workout data
    const programsWithReportCards = [programA, programB, programCNoLogs].filter(p =>
      sampleLogs.some(l => l.programId === p.id)
    );
    expect(programsWithReportCards.map(p => p.id)).toEqual(['program-a', 'program-b']);

    // Neither displayed report card shows ACTIVE badge
    for (const prog of programsWithReportCards) {
      expect(shouldRenderActiveBadge(prog.id, currentProgramId)).toBe(false);
    }
  });

  it('Scenario E: Switching from Program A to Program B updates badge dynamically on read', () => {
    storage.saveProgram(programA);
    storage.saveProgram(programB);

    // Initial state: Program A active
    storage.setCurrentProgramId(programA.id);
    let currentProgramId = storage.getCurrentProgramId();
    expect(shouldRenderActiveBadge(programA.id, currentProgramId)).toBe(true);
    expect(shouldRenderActiveBadge(programB.id, currentProgramId)).toBe(false);

    // User switches to Program B
    storage.setCurrentProgramId(programB.id);
    currentProgramId = storage.getCurrentProgramId();
    expect(shouldRenderActiveBadge(programA.id, currentProgramId)).toBe(false);
    expect(shouldRenderActiveBadge(programB.id, currentProgramId)).toBe(true);
  });

  it('Single Active Constraint: At most one program can satisfy prog.id === currentProgramId', () => {
    storage.saveProgram(programA);
    storage.saveProgram(programB);
    storage.setCurrentProgramId(programA.id);

    const currentProgramId = storage.getCurrentProgramId();
    const allPrograms = [programA, programB];
    const activeBadgeCount = allPrograms.filter(p => shouldRenderActiveBadge(p.id, currentProgramId)).length;

    expect(activeBadgeCount).toBe(1);
  });
});
