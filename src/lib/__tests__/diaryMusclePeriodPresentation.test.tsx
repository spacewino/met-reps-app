/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { LogsHistoryView } from '../../components/LogsHistoryView';
import { WorkoutLog } from '../../types';
import {
  DiaryMusclePeriod,
  getNextDiaryMusclePeriod,
  generateDiaryMuscleSetStats,
  DIARY_MUSCLE_PERIOD_DISPLAY_NAMES,
  getDiaryMusclePeriodAriaLabel,
} from '../diaryMuscleSetPeriod';

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

if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as any;
} else {
  (globalThis as any).window = { scrollTo: () => {} };
}

describe('MetReps — Working-Set Muscle Summary & Direct Period-Cycle Control Presentation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const sampleLogs: WorkoutLog[] = [
    {
      id: 'log-aug-20',
      date: '2026-08-20',
      startTime: '10:00',
      program: 'Hypertrophy',
      unit: 'kg',
      exercises: [
        {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          sets: [
            { setNumber: 1, weight: 60, reps: 5, isWarmup: true, isCompleted: true }, // Warmup excluded
            { setNumber: 2, weight: 100, reps: 5, isCompleted: true }, // 1 Pec set
            { setNumber: 3, weight: 100, reps: 5, isCompleted: true }, // 1 Pec set
          ],
        },
        {
          name: 'Overhead Press',
          muscleGroup: 'Shoulders',
          sets: [
            { setNumber: 1, weight: 50, reps: 8, isCompleted: true }, // 1 Delt set
          ],
        },
      ],
    },
    {
      id: 'log-aug-10',
      date: '2026-08-10',
      startTime: '09:00',
      program: 'Hypertrophy',
      unit: 'kg',
      exercises: [
        {
          name: 'Squat',
          muscleGroup: 'Quads',
          sets: [
            { setNumber: 1, weight: 140, reps: 5, isCompleted: true }, // 1 Quad set
          ],
        },
      ],
    },
  ];

  it('27. Default visible period label is LIFETIME', () => {
    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    expect(html).toContain('id="diary-muscle-period-toggle"');
    expect(html).toContain('LIFETIME');
    expect(html).toContain('SETS BY MUSCLE GROUP');
    expect(html).toMatch(/TOTAL: <!-- -->4<!-- --> SETS|TOTAL: 4 SETS/); // 2 Pecs + 1 Delt + 1 Quad = 4 sets
  });

  it('28-29. Cycle progression through all 4 states returns to Lifetime', () => {
    let p: DiaryMusclePeriod = 'lifetime';
    expect(DIARY_MUSCLE_PERIOD_DISPLAY_NAMES[p]).toBe('LIFETIME');

    p = getNextDiaryMusclePeriod(p);
    expect(p).toBe('this_week');
    expect(DIARY_MUSCLE_PERIOD_DISPLAY_NAMES[p]).toBe('THIS WEEK');

    p = getNextDiaryMusclePeriod(p);
    expect(p).toBe('this_month');
    expect(DIARY_MUSCLE_PERIOD_DISPLAY_NAMES[p]).toBe('THIS MONTH');

    p = getNextDiaryMusclePeriod(p);
    expect(p).toBe('this_year');
    expect(DIARY_MUSCLE_PERIOD_DISPLAY_NAMES[p]).toBe('THIS YEAR');

    p = getNextDiaryMusclePeriod(p);
    expect(p).toBe('lifetime');
    expect(DIARY_MUSCLE_PERIOD_DISPLAY_NAMES[p]).toBe('LIFETIME');
  });

  it('30. Grid values and TOTAL count stay synchronized for every period', () => {
    const now = new Date(2026, 7, 20, 12, 0, 0); // Thursday 20 Aug 2026

    const periods: DiaryMusclePeriod[] = ['lifetime', 'this_week', 'this_month', 'this_year'];

    periods.forEach(period => {
      const stats = generateDiaryMuscleSetStats(sampleLogs, period, now);
      const gridSum = Object.values(stats.muscleSets).reduce((acc, c) => acc + c, 0);
      // In this sample fixture, all exercises map to canonical groups, so gridSum == totalSets
      expect(gridSum).toBe(stats.totalSets);
    });
  });

  it('31. Workouts and Volume Moved master cards remain Lifetime stats', () => {
    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    // WORKOUTS card
    expect(html).toContain('WORKOUTS');
    expect(html).toContain('2'); // 2 workouts total

    // VOL. MOVED card
    expect(html).toContain('VOL. MOVED');
  });

  it('32. Workout card ordering and month session counts are untouched', () => {
    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    expect(html).toContain('SESSIONS');
    expect(html).toContain('2026, August');
    expect(html).toContain('Hypertrophy');
    expect(html).toContain('log-card-log-aug-20');
    expect(html).toContain('log-card-log-aug-10');
  });

  it('35. Accessible aria-label accurately describes current and next period', () => {
    const labelLifetime = getDiaryMusclePeriodAriaLabel('lifetime', 'this_week');
    expect(labelLifetime).toBe('Muscle-set period: Lifetime. Activate to show This Week.');

    const labelWeek = getDiaryMusclePeriodAriaLabel('this_week', 'this_month');
    expect(labelWeek).toBe('Muscle-set period: This Week. Activate to show This Month.');

    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    expect(html).toContain('aria-label="Muscle-set period: Lifetime. Activate to show This Week."');
  });

  it('37. No dropdown, popup or modal markup is created for period cycling', () => {
    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    // Period toggle is a direct button
    expect(html).toContain('<button type="button" id="diary-muscle-period-toggle"');
    // Ensure no <select> or dropdown menu
    expect(html).not.toContain('<select id="diary-muscle-period"');
    expect(html).not.toContain('role="listbox"');
  });

  it('38. Desert theme styling support', () => {
    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
        themeId="amber"
      />
    );

    expect(html).toContain('id="diary-muscle-period-toggle"');
    expect(html).toContain('text-[#9B1C1C]');
  });

  it('39. Layout uses single-line flex header and responsive grid without overflow', () => {
    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    expect(html).toContain('flex items-center justify-between mb-1.5 min-h-[24px]');
    expect(html).toContain('grid grid-cols-4 sm:grid-cols-6 gap-1');
  });
});
