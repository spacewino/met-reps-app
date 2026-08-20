/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveWorkoutNavigation,
  getWorkoutIdentityFromParams,
  getWorkoutIdentityFromDraft,
  getActiveWorkoutDraft,
  ActiveWorkoutIdentity,
} from '../navigationGuard';

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

describe('Active Workout Navigation Guard & Draft Loss Prevention', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('1. No active workout, requesting one-off returns allow', () => {
    const requested: ActiveWorkoutIdentity = { kind: 'one_off' };
    expect(resolveWorkoutNavigation(null, requested)).toBe('allow');
  });

  it('2. No active workout, requesting programmed returns allow', () => {
    const requested: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-1',
      weekNum: 1,
      dayNum: 1,
    };
    expect(resolveWorkoutNavigation(null, requested)).toBe('allow');
  });

  it('3. No active workout, requesting historical edit returns allow', () => {
    const requested: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-123',
    };
    expect(resolveWorkoutNavigation(null, requested)).toBe('allow');
  });

  it('4. Active one-off, requesting non-workout route returns allow (does not block navigation)', () => {
    const active: ActiveWorkoutIdentity = { kind: 'one_off' };
    expect(resolveWorkoutNavigation(active, null)).toBe('allow');
  });

  it('5. Active programmed, requesting non-workout route returns allow (Settings, Diary, Trends, Home)', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-1',
      weekNum: 1,
      dayNum: 1,
    };
    expect(resolveWorkoutNavigation(active, null)).toBe('allow');
  });

  it('6. Active historical edit, requesting non-workout route returns allow', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-1',
    };
    expect(resolveWorkoutNavigation(active, null)).toBe('allow');
  });

  it('7. Active generic one-off, requesting same generic one-off returns allow', () => {
    const active: ActiveWorkoutIdentity = { kind: 'one_off', workoutId: null };
    const requested: ActiveWorkoutIdentity = { kind: 'one_off', workoutId: null };
    expect(resolveWorkoutNavigation(active, requested)).toBe('allow');
  });

  it('8. Active one-off, requesting programmed workout returns block', () => {
    const active: ActiveWorkoutIdentity = { kind: 'one_off' };
    const requested: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-1',
      weekNum: 1,
      dayNum: 1,
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('9. Active one-off, requesting historical edit returns block', () => {
    const active: ActiveWorkoutIdentity = { kind: 'one_off' };
    const requested: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-1',
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('10. Active programmed (Prog A, W1, D1), requesting exact same (Prog A, W1, D1) with numeric types returns allow', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 1,
      dayNum: 1,
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 1,
      dayNum: 1,
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('allow');
  });

  it('11. Active programmed (Prog A, W1, D1), requesting exact same with string types returns allow', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: '1',
      dayNum: '1',
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 1,
      dayNum: 1,
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('allow');
  });

  it('12. Active programmed (Prog A, W1, D1), requesting different day (Prog A, W1, D2) returns block', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 1,
      dayNum: 1,
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 1,
      dayNum: 2,
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('13. Active programmed (Prog A, W1, D1), requesting different week (Prog A, W2, D1) returns block', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 1,
      dayNum: 1,
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 2,
      dayNum: 1,
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('14. Active programmed (Prog A, W1, D1), requesting different program (Prog B, W1, D1) returns block', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 1,
      dayNum: 1,
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-b',
      weekNum: 1,
      dayNum: 1,
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('15. Active programmed, requesting one-off workout returns block', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 1,
      dayNum: 1,
    };
    const requested: ActiveWorkoutIdentity = { kind: 'one_off' };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('16. Active programmed, requesting historical edit returns block', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-a',
      weekNum: 1,
      dayNum: 1,
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-99',
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('17. Active historical edit (log-1), requesting exact same log-1 returns allow', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-1',
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-1',
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('allow');
  });

  it('18. Active historical edit (log-1), requesting different log-2 returns block', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-1',
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-2',
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('19. Active historical edit, requesting programmed workout returns block', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-1',
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'programmed',
      programId: 'prog-1',
      weekNum: 1,
      dayNum: 1,
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('20. Active historical edit, requesting one-off workout returns block', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'historical_edit',
      workoutId: 'log-1',
    };
    const requested: ActiveWorkoutIdentity = { kind: 'one_off' };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('21. Active redo one-off (redoFromLogId: log-100), requesting same redo one-off returns allow', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'one_off',
      workoutId: 'log-100',
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'one_off',
      workoutId: 'log-100',
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('allow');
  });

  it('22. Active redo one-off (redoFromLogId: log-100), requesting generic one-off returns block', () => {
    const active: ActiveWorkoutIdentity = {
      kind: 'one_off',
      workoutId: 'log-100',
    };
    const requested: ActiveWorkoutIdentity = {
      kind: 'one_off',
      workoutId: null,
    };
    expect(resolveWorkoutNavigation(active, requested)).toBe('block');
  });

  it('23. getWorkoutIdentityFromParams parses all route param configurations accurately', () => {
    expect(getWorkoutIdentityFromParams(null)).toEqual({ kind: 'one_off', workoutId: null });
    expect(getWorkoutIdentityFromParams({})).toEqual({ kind: 'one_off', workoutId: null });
    expect(getWorkoutIdentityFromParams({ isOneOff: true })).toEqual({ kind: 'one_off', workoutId: null });
    expect(getWorkoutIdentityFromParams({ isOneOff: true, workoutId: 'w-1' })).toEqual({ kind: 'one_off', workoutId: 'w-1' });
    expect(getWorkoutIdentityFromParams({ redoFromLogId: 'log-50' })).toEqual({ kind: 'one_off', workoutId: 'log-50' });
    expect(getWorkoutIdentityFromParams({ editLogId: 'log-77' })).toEqual({ kind: 'historical_edit', workoutId: 'log-77' });
    
    const prog = getWorkoutIdentityFromParams({
      programId: 'prog-abc',
      programName: 'Hypertrophy Phase',
      week: '2',
      day: '3',
    });
    expect(prog).toEqual({
      kind: 'programmed',
      programId: 'prog-abc',
      programName: 'Hypertrophy Phase',
      workoutName: 'Hypertrophy Phase',
      weekNum: '2',
      dayNum: '3',
      workoutId: null,
    });
  });

  it('24. getWorkoutIdentityFromDraft parses all saved draft structures accurately', () => {
    expect(getWorkoutIdentityFromDraft(null)).toBeNull();
    expect(getWorkoutIdentityFromDraft('invalid')).toBeNull();
    expect(getWorkoutIdentityFromDraft({})).toBeNull();
    
    expect(getWorkoutIdentityFromDraft({ isOneOff: true })).toEqual({ kind: 'one_off', workoutId: null });
    expect(getWorkoutIdentityFromDraft({ isOneOff: true, workoutId: 'w-2' })).toEqual({ kind: 'one_off', workoutId: 'w-2' });
    expect(getWorkoutIdentityFromDraft({ redoFromLogId: 'log-88' })).toEqual({ kind: 'one_off', workoutId: 'log-88' });
    expect(getWorkoutIdentityFromDraft({ editLogId: 'log-99' })).toEqual({ kind: 'historical_edit', workoutId: 'log-99' });

    const progDraft = getWorkoutIdentityFromDraft({
      programId: 'prog-123',
      programName: 'Upper Lower',
      weekNum: 3,
      dayNum: 2,
    });
    expect(progDraft).toEqual({
      kind: 'programmed',
      programId: 'prog-123',
      programName: 'Upper Lower',
      workoutName: 'Upper Lower',
      weekNum: 3,
      dayNum: 2,
      workoutId: null,
    });
  });

  it('25. getActiveWorkoutDraft safely handles empty, malformed, or missing storage entries', () => {
    expect(getActiveWorkoutDraft()).toBeNull();

    localStorage.setItem('metreps_workout_draft', '{ corrupted json ...');
    expect(getActiveWorkoutDraft()).toBeNull();

    localStorage.setItem('metreps_workout_draft', JSON.stringify({ isOneOff: true, exercises: [] }));
    const result = getActiveWorkoutDraft();
    expect(result).not.toBeNull();
    expect(result?.identity).toEqual({ kind: 'one_off', workoutId: null });
  });

  it('26. End-to-end draft protection scenario: programmed workout modifications protected across navigation', () => {
    // 1. User starts Programmed Workout: Prog A, Week 1, Day 1
    const initialParams = {
      programId: 'prog-a',
      programName: 'Powerbuilding',
      week: '1',
      day: '1',
    };
    const activeIdentity = getWorkoutIdentityFromParams(initialParams);
    expect(activeIdentity?.kind).toBe('programmed');

    // 2. Draft is saved to localStorage during session
    localStorage.setItem(
      'metreps_workout_draft',
      JSON.stringify({
        programId: 'prog-a',
        programName: 'Powerbuilding',
        weekNum: 1,
        dayNum: 1,
        exercises: [{ name: 'Squat', sets: [{ weight: 140, reps: 5, rpe: 8 }] }],
      })
    );

    // 3. User navigates to Home view -> Allowed (non-workout view)
    expect(resolveWorkoutNavigation(activeIdentity, null)).toBe('allow');

    // 4. User attempts to click "One-Off Workout" while active session exists
    const oneOffRequest = getWorkoutIdentityFromParams({ isOneOff: true });
    expect(resolveWorkoutNavigation(activeIdentity, oneOffRequest)).toBe('block');

    // 5. User attempts to click another day (Week 1, Day 2)
    const otherDayRequest = getWorkoutIdentityFromParams({
      programId: 'prog-a',
      week: '1',
      day: '2',
    });
    expect(resolveWorkoutNavigation(activeIdentity, otherDayRequest)).toBe('block');

    // 6. User clicks "Resume Active Session" (returns to Week 1, Day 1)
    const resumeRequest = getWorkoutIdentityFromParams(initialParams);
    expect(resolveWorkoutNavigation(activeIdentity, resumeRequest)).toBe('allow');
  });
});
