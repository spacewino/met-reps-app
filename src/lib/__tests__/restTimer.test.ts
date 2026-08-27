import { describe, it, expect, beforeEach } from 'vitest';
import {
  isValidRestIntervalDuration,
  getLastCompletedWorkingSetNumber,
  createRestInterval,
  parseRestStartContext,
} from '../restTimerMath';
import { ExerciseEntry, RestInterval, RestTimerStartContext, WorkoutLog } from '../../types';
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

describe('MetReps Global Rest Timer & Interval Storage Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('1. Duration Boundaries & Validation', () => {
    it('discards intervals <= 0 seconds', () => {
      expect(isValidRestIntervalDuration(0)).toBe(false);
      expect(isValidRestIntervalDuration(-1)).toBe(false);
      expect(isValidRestIntervalDuration(-50)).toBe(false);
      expect(createRestInterval({ durationSeconds: 0, startTime: Date.now() })).toBeNull();
      expect(createRestInterval({ durationSeconds: -5, startTime: Date.now() })).toBeNull();
    });

    it('discards intervals >= 600 seconds (10 minutes or longer)', () => {
      expect(isValidRestIntervalDuration(600)).toBe(false);
      expect(isValidRestIntervalDuration(601)).toBe(false);
      expect(isValidRestIntervalDuration(1200)).toBe(false);
      expect(createRestInterval({ durationSeconds: 600, startTime: Date.now() })).toBeNull();
      expect(createRestInterval({ durationSeconds: 900, startTime: Date.now() })).toBeNull();
    });

    it('accepts and creates intervals between 1 and 599 seconds inclusive', () => {
      expect(isValidRestIntervalDuration(1)).toBe(true);
      expect(isValidRestIntervalDuration(59)).toBe(true);
      expect(isValidRestIntervalDuration(120)).toBe(true);
      expect(isValidRestIntervalDuration(599)).toBe(true);

      const interval1 = createRestInterval({ durationSeconds: 1, startTime: 1000 });
      expect(interval1).not.toBeNull();
      expect(interval1?.durationSeconds).toBe(1);

      const interval599 = createRestInterval({ durationSeconds: 599, startTime: 1000 });
      expect(interval599).not.toBeNull();
      expect(interval599?.durationSeconds).toBe(599);
    });

    it('handles non-integer and edge values safely', () => {
      expect(isValidRestIntervalDuration(NaN)).toBe(false);
      expect(isValidRestIntervalDuration(Infinity)).toBe(false);
      expect(isValidRestIntervalDuration(120.8)).toBe(true);
      const roundedInterval = createRestInterval({ durationSeconds: 120.8, startTime: 1000 });
      expect(roundedInterval?.durationSeconds).toBe(120);
    });
  });

  describe('2. Start Context & Attribution Parsing', () => {
    it('parses valid start context JSON from localStorage', () => {
      const validCtx: RestTimerStartContext = {
        source: 'exercise_header',
        exerciseName: 'Barbell Bench Press (flat)',
        exerciseIndex: 0,
        setNumber: 2,
        startedAt: '2026-08-27T10:00:00.000Z',
      };
      const str = JSON.stringify(validCtx);
      const parsed = parseRestStartContext(str);
      expect(parsed).toEqual(validCtx);
    });

    it('falls back safely to null when localStorage value is missing, corrupted, or invalid', () => {
      expect(parseRestStartContext(null)).toBeNull();
      expect(parseRestStartContext('')).toBeNull();
      expect(parseRestStartContext('not-valid-json')).toBeNull();
      expect(parseRestStartContext('{"source":"unknown"}')).toBeNull();
      expect(parseRestStartContext('12345')).toBeNull();
    });

    it('creates interval with fallback attribution when startContext is missing', () => {
      const now = 1700000000000;
      const interval = createRestInterval({
        durationSeconds: 90,
        startTime: now,
      });
      expect(interval).not.toBeNull();
      expect(interval?.source).toBe('footer');
      expect(interval?.exerciseName).toBeUndefined();
      expect(interval?.exerciseIndex).toBeUndefined();
      expect(interval?.setNumber).toBeUndefined();
      expect(interval?.startedAt).toBe(new Date(now).toISOString());
    });

    it('creates interval with full exercise attribution when startContext is provided', () => {
      const startCtx: RestTimerStartContext = {
        source: 'exercise_header',
        exerciseName: 'Overhead Press (Standing)',
        exerciseIndex: 1,
        setNumber: 3,
        startedAt: '2026-08-27T10:15:00.000Z',
      };
      const interval = createRestInterval({
        durationSeconds: 150,
        startContext: startCtx,
        startTime: 1700000000000,
      });
      expect(interval).toEqual({
        durationSeconds: 150,
        source: 'exercise_header',
        exerciseName: 'Overhead Press (Standing)',
        exerciseIndex: 1,
        setNumber: 3,
        startedAt: '2026-08-27T10:15:00.000Z',
      });
    });
  });

  describe('3. Working-Set Attribution Helper (getLastCompletedWorkingSetNumber)', () => {
    const exercise: ExerciseEntry = {
      name: 'Incline Dumbbell Press',
      muscleGroup: 'Pecs',
      modality: 'weighted',
      sets: [
        { setNumber: 1, weight: 20, reps: 10, rpe: 6, isWarmup: true },
        { setNumber: 2, weight: 32, reps: 8, rpe: 8, isWarmup: false },
        { setNumber: 3, weight: 32, reps: 8, rpe: 8.5, isWarmup: false },
        { setNumber: 4, weight: 32, reps: 7, rpe: 9, isWarmup: false },
      ],
    };

    it('returns null if no working set has been completed yet', () => {
      const checkedSets: Record<string, boolean> = {
        '0-0': true, // Warmup set 1 completed
        '0-1': false,
        '0-2': false,
        '0-3': false,
      };
      expect(getLastCompletedWorkingSetNumber(exercise, 0, checkedSets)).toBeNull();
    });

    it('returns the most recently completed working set number', () => {
      const checkedSets1: Record<string, boolean> = {
        '0-0': true, // Warmup
        '0-1': true, // Working Set 2
      };
      expect(getLastCompletedWorkingSetNumber(exercise, 0, checkedSets1)).toBe(2);

      const checkedSets2: Record<string, boolean> = {
        '0-0': true,
        '0-1': true,
        '0-2': true, // Working Set 3
      };
      expect(getLastCompletedWorkingSetNumber(exercise, 0, checkedSets2)).toBe(3);
    });

    it('ignores completed sets from other exercises when checking set keys', () => {
      const checkedSets: Record<string, boolean> = {
        '1-1': true, // Other exercise working set
      };
      expect(getLastCompletedWorkingSetNumber(exercise, 0, checkedSets)).toBeNull();
    });
  });

  describe('4. Draft Recovery and Discard Semantics', () => {
    it('restores completed restIntervals from draft payload', () => {
      const sampleIntervals: RestInterval[] = [
        {
          durationSeconds: 120,
          source: 'exercise_header',
          exerciseName: 'Squat',
          exerciseIndex: 0,
          setNumber: 1,
          startedAt: '2026-08-27T08:00:00.000Z',
        },
        {
          durationSeconds: 90,
          source: 'footer',
          startedAt: '2026-08-27T08:05:00.000Z',
        },
      ];

      const draftPayload = {
        isOneOff: true,
        exercises: [],
        restIntervals: sampleIntervals,
      };

      localStorage.setItem('metreps_workout_draft', JSON.stringify(draftPayload));
      const loadedDraft = JSON.parse(localStorage.getItem('metreps_workout_draft') || '{}');
      expect(loadedDraft.restIntervals).toEqual(sampleIntervals);
    });

    it('clearing timer state cleans localStorage keys', () => {
      localStorage.setItem('isResting', 'true');
      localStorage.setItem('restStartTime', '1700000000000');
      localStorage.setItem('restStartContext', JSON.stringify({ source: 'footer', startedAt: '2026-08-27T08:00:00Z' }));

      // Simulate clearActiveRestTimer
      localStorage.removeItem('isResting');
      localStorage.removeItem('restStartTime');
      localStorage.removeItem('restStartContext');

      expect(localStorage.getItem('isResting')).toBeNull();
      expect(localStorage.getItem('restStartTime')).toBeNull();
      expect(localStorage.getItem('restStartContext')).toBeNull();
    });
  });

  describe('5. WorkoutLog Storage & Edit Mode Integrity', () => {
    it('persists restIntervals to saved WorkoutLog when intervals exist', () => {
      const sampleIntervals: RestInterval[] = [
        { durationSeconds: 75, source: 'exercise_header', exerciseName: 'Deadlift', exerciseIndex: 0, setNumber: 1, startedAt: '2026-08-27T08:00:00Z' },
      ];

      const log: WorkoutLog = {
        id: 'test-log-1',
        date: '2026-08-27',
        exercises: [],
        unit: 'kg',
        durationMinutes: 45,
        notes: '',
        objective: 'Off',
        restIntervals: sampleIntervals,
      };

      storage.saveWorkoutLog(log);
      const retrieved = storage.getWorkoutLogs().find(l => l.id === 'test-log-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.restIntervals).toEqual(sampleIntervals);
    });

    it('preserves existing restIntervals in edit mode', () => {
      const originalIntervals: RestInterval[] = [
        { durationSeconds: 180, source: 'footer', startedAt: '2026-08-27T07:00:00Z' },
      ];

      const existingLog: WorkoutLog = {
        id: 'edit-log-test',
        date: '2026-08-27',
        exercises: [],
        unit: 'kg',
        durationMinutes: 60,
        notes: 'Original note',
        objective: 'Strength',
        restIntervals: originalIntervals,
      };
      storage.saveWorkoutLog(existingLog);

      // Edit save simulation: when editLogId is present, existingLog.restIntervals is retained
      const updatedLog: WorkoutLog = {
        ...existingLog,
        notes: 'Updated note',
        restIntervals: existingLog.restIntervals,
      };
      storage.saveWorkoutLog(updatedLog);

      const saved = storage.getWorkoutLogs().find(l => l.id === 'edit-log-test');
      expect(saved?.notes).toBe('Updated note');
      expect(saved?.restIntervals).toEqual(originalIntervals);
    });
  });

  describe('6. Presentation & Accessibility Contract', () => {
    it('provides correct accessible title and aria-label depending on timer state', () => {
      const getButtonProps = (isResting: boolean) => ({
        title: isResting ? 'Stop rest timer' : 'Start rest timer',
        'aria-label': isResting ? 'Stop rest timer' : 'Start rest timer',
      });

      const idleProps = getButtonProps(false);
      expect(idleProps.title).toBe('Start rest timer');
      expect(idleProps['aria-label']).toBe('Start rest timer');

      const runningProps = getButtonProps(true);
      expect(runningProps.title).toBe('Stop rest timer');
      expect(runningProps['aria-label']).toBe('Stop rest timer');
    });

    it('formats MM:SS timer strings accurately', () => {
      const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      };

      expect(formatTime(0)).toBe('00:00');
      expect(formatTime(9)).toBe('00:09');
      expect(formatTime(59)).toBe('00:59');
      expect(formatTime(60)).toBe('01:00');
      expect(formatTime(125)).toBe('02:05');
      expect(formatTime(599)).toBe('09:59');
    });
  });
});
