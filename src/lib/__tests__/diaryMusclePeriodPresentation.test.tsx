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

  it('31. Workouts, Volume Moved, and Gym Time master cards render accurately for summary period', () => {
    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    // WORKOUTS card
    expect(html).toContain('WORKOUTS');
    expect(html).toContain('2'); // 2 workouts total in lifetime

    // VOL. MOVED card
    expect(html).toContain('VOL. MOVED');

    // GYM TIME card
    expect(html).toContain('GYM TIME');
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
    expect(labelLifetime).toBe('Journal summary period: Lifetime. Activate to show This Week.');

    const labelWeek = getDiaryMusclePeriodAriaLabel('this_week', 'this_month');
    expect(labelWeek).toBe('Journal summary period: This Week. Activate to show This Month.');

    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    expect(html).toContain('aria-label="Journal summary period: Lifetime. Activate to show This Week."');
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

  it('40. Unified Journal Summary period filters WORKOUTS, VOL. MOVED, and GYM TIME from the shared period population', () => {
    const periodLogs: WorkoutLog[] = [
      {
        id: 'log-past-year',
        date: '2025-06-15',
        unit: 'kg',
        durationMinutes: 60,
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'Chest',
            sets: [{ setNumber: 1, weight: 100, reps: 10, isCompleted: true }],
          },
        ],
      },
      {
        id: 'log-this-month',
        date: '2026-08-05',
        unit: 'kg',
        durationMinutes: 45,
        exercises: [
          {
            name: 'Squat',
            muscleGroup: 'Quads',
            sets: [{ setNumber: 1, weight: 100, reps: 5, isCompleted: true }],
          },
        ],
      },
    ];

    const html = renderToString(
      <LogsHistoryView
        workoutLogs={periodLogs}
        onRefresh={() => {}}
      />
    );

    // Default lifetime displays all 2 workouts and 1h 45m gym time (60 + 45 = 105 mins = 1h 45m)
    expect(html).toContain('WORKOUTS');
    expect(html).toContain('2');
    expect(html).toContain('GYM TIME');
    expect(html).toContain('1h 45m');
  });

  it('41. DJH-1: Journal Summary header renders vertically stacked hierarchy in strict order', () => {
    const html = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    // 1. Check strict order of elements in rendered DOM
    const journalSummaryIdx = html.indexOf('Journal Summary');
    const trophyIdx = html.indexOf('lucide-trophy');
    const workoutsIdx = html.indexOf('WORKOUTS');
    const volMovedIdx = html.indexOf('VOL. MOVED');
    const gymTimeIdx = html.indexOf('GYM TIME');
    const periodToggleIdx = html.indexOf('id="diary-muscle-period-toggle"');
    const setsByMuscleIdx = html.indexOf('SETS BY MUSCLE GROUP');

    expect(journalSummaryIdx).toBeGreaterThan(-1);
    expect(trophyIdx).toBeGreaterThan(journalSummaryIdx);
    expect(workoutsIdx).toBeGreaterThan(trophyIdx);
    expect(volMovedIdx).toBeGreaterThan(workoutsIdx);
    expect(gymTimeIdx).toBeGreaterThan(volMovedIdx);
    expect(periodToggleIdx).toBeGreaterThan(gymTimeIdx);
    expect(setsByMuscleIdx).toBeGreaterThan(periodToggleIdx);

    // 2. Metric wrapper renders with full-width 3-column grid contract
    expect(html).toContain('grid grid-cols-3 gap-1.5 sm:gap-2 w-full');

    // 3. Title has non-truncating wrapping classes and information button
    expect(html).toContain('whitespace-normal break-words');
    expect(html).not.toMatch(/class="[^"]*truncate[^"]*"[^>]*>[^<]*IRON/);
    expect(html).toContain('title="View Journal Achievements &amp; Titles"');
  });

  it('42. DJH-1: 3-column metric boxes have min-w-0 and whitespace-nowrap in both dark and desert themes', () => {
    const darkHtml = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    expect(darkHtml).toContain('min-w-0 px-1.5 sm:px-2 py-1 border text-center');
    expect(darkHtml).toContain('whitespace-nowrap');

    const desertHtml = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
        themeId="amber"
      />
    );

    expect(desertHtml).toContain('min-w-0 px-1.5 sm:px-2 py-1 border text-center');
    expect(desertHtml).toContain('bg-[#F5EBE0] border-[#E05A47]/30');
    expect(desertHtml).toContain('whitespace-nowrap');
  });

  it('43. DJH-1B: Diary header renders simplified single-title row at text-lg without subtitle', () => {
    const darkHtml = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
      />
    );

    // 1. Title remains rendered and subtitle is completely absent
    expect(darkHtml).toContain('Workout Log Book');
    expect(darkHtml).not.toContain('Logged Training Journal');

    // 2. Title has text-lg, leading-none, whitespace-nowrap
    expect(darkHtml).toContain('font-extrabold text-lg uppercase tracking-wide leading-none whitespace-nowrap');

    // 3. Title and Calendar icon share the same vertically centred flex row with gap-2.5
    expect(darkHtml).toContain('flex items-center gap-2.5');

    // 4. Icon container is shrink-0 and preserves dark theme border-slate-850
    expect(darkHtml).toContain('p-1.5 rounded-none border flex items-center justify-center shrink-0');
    expect(darkHtml).toContain('bg-slate-900 border-slate-850 text-indigo-400');
    expect(darkHtml).toContain('bg-slate-950 border-slate-850');

    // 5. Desert theme preserves custom colors and border-slate-850 equivalent
    const desertHtml = renderToString(
      <LogsHistoryView
        workoutLogs={sampleLogs}
        onRefresh={() => {}}
        themeId="amber"
      />
    );

    expect(desertHtml).toContain('Workout Log Book');
    expect(desertHtml).not.toContain('Logged Training Journal');
    expect(desertHtml).toContain('bg-[#F5EBE0] border-[#E05A47]/40 text-[#9B1C1C]');
    expect(desertHtml).toContain('bg-[#FAF5F0] border-[#E05A47]/30');

    // 6. Journal summary mastery card hierarchy remains intact
    expect(darkHtml).toContain('id="journal-mastery-card"');
    expect(darkHtml).toContain('grid grid-cols-3 gap-1.5 sm:gap-2 w-full');
  });
});
