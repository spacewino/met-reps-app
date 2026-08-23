/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { LogsHistoryView } from '../../components/LogsHistoryView';
import { WorkoutLog } from '../../types';

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

// Mock window.scrollTo
if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as any;
} else {
  (globalThis as any).window = { scrollTo: () => {} };
}

describe('MetReps — Compact Month Tab and Diary Card Spacing Refinement', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const sampleLogs: WorkoutLog[] = [
    {
      id: 'log-aug-2',
      date: '2026-08-20',
      startTime: '10:00',
      program: 'Hypertrophy Block',
      week: '2',
      day: '1',
      unit: 'kg',
      exercises: [
        {
          name: 'Bench Press',
          muscleGroup: 'Chest',
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 100, reps: 5, rpe: 8, isCompleted: true }],
        },
      ],
    },
    {
      id: 'log-aug-1',
      date: '2026-08-10',
      startTime: '09:30',
      program: 'Hypertrophy Block',
      week: '1',
      day: '1',
      unit: 'kg',
      exercises: [
        {
          name: 'Squat',
          muscleGroup: 'Quads',
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 140, reps: 5, rpe: 8, isCompleted: true }],
        },
      ],
    },
    {
      id: 'log-jul-1',
      date: '2026-07-28',
      startTime: '11:00',
      program: 'Strength Block',
      week: '4',
      day: '1',
      unit: 'kg',
      exercises: [
        {
          name: 'Deadlift',
          muscleGroup: 'Back',
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 180, reps: 3, rpe: 9, isCompleted: true }],
        },
      ],
    },
    {
      id: 'log-sep-1',
      date: '2026-09-15',
      startTime: '08:00',
      program: 'One Off',
      unit: 'kg',
      exercises: [
        {
          name: 'Overhead Press',
          muscleGroup: 'Delts',
          isMainMovement: true,
          sets: [{ setNumber: 1, weight: 60, reps: 8, rpe: 8, isCompleted: true }],
        },
      ],
    },
  ];

  // 1. Month session counts remain unchanged
  it('1. Month session counts calculate and render accurately', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    // September: 1 session
    expect(html).toContain('2026, September');
    expect(html).toMatch(/1(<!-- -->|\s)*SESSION/);

    // August: 2 sessions
    expect(html).toContain('2026, August');
    expect(html).toMatch(/2(<!-- -->|\s)*SESSIONS/);

    // July: 1 session
    expect(html).toContain('2026, July');
  });

  // 2. Month expand/collapse behaviour remains unchanged
  it('2. First month is expanded by default and subsequent months are collapsed', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    // Latest month is September 2026 -> expanded
    expect(html).toContain('id="month-header-2026-09"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('id="month-content-2026-09"');

    // Earlier months (August, July) -> collapsed in initial render
    expect(html).toContain('id="month-header-2026-08"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="month-content-2026-08"');

    expect(html).toContain('id="month-header-2026-07"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="month-content-2026-07"');
  });

  // 3. The whole tab remains the interactive control
  it('3. The whole tab is a semantic button containing the icon, title, badge, and circular chevron', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    // Button wraps entire tab
    expect(html).toMatch(/<button[^>]+id="month-header-2026-09"[^>]*>/);
    // Button has min-h-[44px] touch target
    expect(html).toContain('min-h-[44px]');
    // Button has inline-flex and content-width styling
    expect(html).toContain('inline-flex');
    expect(html).toContain('rounded-t-md');
  });

  // 4. aria-expanded changes correctly and aria-controls links to content
  it('4. aria-expanded and aria-controls attributes are correctly bound', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    // Check expanded month header accessibility attributes
    expect(html).toContain('aria-controls="month-content-2026-09"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Collapse 2026, September workouts"');

    // Check collapsed month header accessibility attributes
    expect(html).toContain('aria-controls="month-content-2026-08"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Expand 2026, August workouts"');
  });

  // 5. Collapsed month content is hidden
  it('5. Collapsed month content container is hidden/unrendered', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    // August and July workout cards should not be rendered when collapsed
    expect(html).not.toContain('id="month-content-2026-08"');
    expect(html).not.toContain('id="month-content-2026-07"');
    expect(html).not.toContain('id="log-card-log-aug-1"');
    expect(html).not.toContain('id="log-card-log-jul-1"');
  });

  // 6. Expanded month content remains visible
  it('6. Expanded month content container and its workout cards remain visible', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    // September workout card should be rendered inside month-content-2026-09
    expect(html).toContain('id="month-content-2026-09"');
    expect(html).toContain('id="log-card-log-sep-1"');
  });

  // 7. Workout-card ordering is unchanged
  it('7. Workout cards maintain exact chronological descending ordering', () => {
    // When all logs are in the same month
    const augustLogs: WorkoutLog[] = [
      { ...sampleLogs[1], id: 'log-aug-1', date: '2026-08-10' },
      { ...sampleLogs[0], id: 'log-aug-2', date: '2026-08-20' },
    ];

    const html = renderToString(
      <LogsHistoryView workoutLogs={augustLogs} onRefresh={() => {}} themeId="slate" />
    );

    const posAug2 = html.indexOf('id="log-card-log-aug-2"');
    const posAug1 = html.indexOf('id="log-card-log-aug-1"');

    // log-aug-2 (Aug 20) must appear BEFORE log-aug-1 (Aug 10)
    expect(posAug2).toBeGreaterThan(-1);
    expect(posAug1).toBeGreaterThan(-1);
    expect(posAug2).toBeLessThan(posAug1);
  });

  // 8. Diary calculations and permanent logs are not mutated
  it('8. Diary calculations and logs input array are not mutated', () => {
    const logsCopy = JSON.parse(JSON.stringify(sampleLogs));
    renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    expect(sampleLogs).toEqual(logsCopy);
  });

  // 9. Reduced workout-card spacing (space-y-2)
  it('9. Month content container uses space-y-2 for approx 8px card spacing', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    expect(html).toContain('id="month-content-2026-09" class="space-y-2"');
  });

  // 10. Folder/Browser tab presentation differences between expanded and collapsed states
  it('10. Renders attached tab (-mb-px, rounded-b-none, border-b-0) when expanded and rounded-b-md when collapsed', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    // Expanded tab (September 2026) has attached bottom edge classes
    expect(html).toContain('rounded-b-none border-t border-x border-b-0 -mb-px z-10 relative');

    // Collapsed tab (August 2026) has complete rounded border
    expect(html).toContain('rounded-b-md border');
  });

  // 11. Subtle circular container around the chevron
  it('11. Chevron is wrapped in a subtle circular outlined container', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    expect(html).toContain('rounded-full border flex items-center justify-center shrink-0');
  });

  // 12. Themes verification: slate (Subnautic), onyx (Feralas), amber (Crimson Desert)
  it('12. Renders correctly across all 3 application themes', () => {
    // Slate theme
    const slateHtml = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );
    expect(slateHtml).toContain('bg-slate-900 border-slate-800');
    expect(slateHtml).toContain('text-indigo-400');

    // Onyx theme
    const onyxHtml = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="onyx" />
    );
    expect(onyxHtml).toContain('bg-slate-900 border-slate-800');
    expect(onyxHtml).toContain('text-indigo-400');

    // Amber theme (Desert)
    const amberHtml = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="amber" />
    );
    expect(amberHtml).toContain('bg-[#FAF5F0] border-[#E05A47]/40');
    expect(amberHtml).toContain('text-[#9B1C1C]');
  });

  // 13. Long month name support (September)
  it('13. Supports long month names without clipping or layout breaking', () => {
    const html = renderToString(
      <LogsHistoryView workoutLogs={sampleLogs} onRefresh={() => {}} themeId="slate" />
    );

    expect(html).toContain('2026, September');
    expect(html).toContain('max-w-full');
    expect(html).toContain('truncate');
  });
});
