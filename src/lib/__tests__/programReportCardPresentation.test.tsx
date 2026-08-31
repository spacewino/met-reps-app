/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsView } from '../../components/AnalyticsView';
import { Program, WorkoutLog } from '../../types';
import { storage } from '../storage';
import { formatAggregateDuration } from '../diaryInsightPresentation';

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

describe('TSG-3 Program Report Card Gym Time Presentation Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const sampleActiveProgram: Program = {
    id: 'prog-active-1',
    name: 'Upper Lower Hypertrophy',
    objective: 'Hypertrophy',
    programDuration: 6,
    daysPerWeek: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    exercisesByDay: {
      1: [{ name: 'Incline Bench Press', muscleGroup: 'Chest', modality: 'weighted', sets: [{ setNumber: 1, reps: 8, weight: 80 }] }],
    },
  };

  const sampleCompletedProgram: Program = {
    id: 'prog-completed-1',
    name: 'Powerbuilding Block',
    objective: 'Strength',
    programDuration: 4,
    daysPerWeek: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    exercisesByDay: {
      1: [{ name: 'Squat', muscleGroup: 'Quads', modality: 'weighted', sets: [{ setNumber: 1, reps: 5, weight: 140 }] }],
    },
  };

  it('renders Gym Time in active interim report card list item with formatAggregateDuration (Rendered Behavioural)', () => {
    storage.saveProgram(sampleActiveProgram);
    storage.setCurrentProgramId(sampleActiveProgram.id);

    const logs: WorkoutLog[] = [
      {
        id: 'log-1',
        date: '2026-01-02',
        programId: 'prog-active-1',
        week: '1',
        day: '1',
        unit: 'kg',
        durationMinutes: 75, // 1h 15m
        exercises: [
          {
            name: 'Incline Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 80, reps: 8, isCompleted: true }],
          },
        ],
      },
    ];

    const html = renderToString(<AnalyticsView workoutLogs={logs} />);
    
    // Check program title and Active badge
    expect(html).toContain('Upper Lower Hypertrophy');
    expect(html).toContain('Active');
    expect(html).toContain('Interim Grade');
    // Check Gym Time metadata in list item
    expect(html).toMatch(/Gym Time:\s*(?:<!-- -->)?1h 15m/);
    // Check flex-wrap container exists
    expect(html).toContain('flex flex-wrap items-center gap-x-3 gap-y-1');
  });

  it('renders Gym Time in completed final report card list item with formatAggregateDuration (Rendered Behavioural)', () => {
    storage.saveProgram(sampleCompletedProgram);

    // 4 weeks * 2 days = 8 workouts
    const logs: WorkoutLog[] = [];
    for (let w = 1; w <= 4; w++) {
      for (let d = 1; d <= 2; d++) {
        logs.push({
          id: `log-${w}-${d}`,
          date: `2026-01-${String(w * 7 + d).padStart(2, '0')}`,
          programId: 'prog-completed-1',
          week: String(w),
          day: String(d),
          unit: 'kg',
          durationMinutes: 60, // 8 * 60 = 480 min -> 8h
          exercises: [
            {
              name: 'Squat',
              muscleGroup: 'Quads',
              modality: 'weighted',
              sets: [{ setNumber: 1, weight: 140, reps: 5, isCompleted: true }],
            },
          ],
        });
      }
    }

    const html = renderToString(<AnalyticsView workoutLogs={logs} />);
    
    expect(html).toContain('Powerbuilding Block');
    expect(html).toContain('Completed');
    expect(html).toContain('Final Grade');
    expect(html).toMatch(/Gym Time:\s*(?:<!-- -->)?8h/);
  });

  it('confirms shared detailed view modal contains GYM TIME tile with mobile-safe layout and copy (Static Source Assertion)', () => {
    const analyticsViewSource = fs.readFileSync(path.resolve(__dirname, '../../components/AnalyticsView.tsx'), 'utf-8');

    // 1. Confirms both Interim Midterm Analysis and Final Performance Evaluation branches share the detailed modal
    expect(analyticsViewSource).toContain('Interim Midterm Analysis');
    expect(analyticsViewSource).toContain('Final Performance Evaluation');

    // 2. Confirms quick stats grid layout wrapper
    expect(analyticsViewSource).toContain('sm:col-span-2 grid grid-cols-2 sm:grid-cols-1 gap-2');

    // 3. Confirms Gym Time quick stat tile layout classes (col-span-2 on mobile, single col on desktop)
    expect(analyticsViewSource).toContain('col-span-2 sm:col-span-1 bg-slate-900 border border-slate-800 p-3.5 flex flex-col justify-between');

    // 4. Confirms tile label, value formatting via formatAggregateDuration, and supporting text
    expect(analyticsViewSource).toContain('<span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider font-mono">Gym Time</span>');
    expect(analyticsViewSource).toContain('{formatAggregateDuration(reportCard.totalDurationMinutes)}');
    expect(analyticsViewSource).toContain('<span className="text-[8px] text-slate-500 font-semibold uppercase block mt-1">Across Program Sessions</span>');
  });

  it('correctly handles duration values with formatAggregateDuration (Behavioural)', () => {
    expect(formatAggregateDuration(0)).toBe('0m');
    expect(formatAggregateDuration(null)).toBe('0m');
    expect(formatAggregateDuration(undefined)).toBe('0m');
    expect(formatAggregateDuration(45)).toBe('45m');
    expect(formatAggregateDuration(60)).toBe('1h');
    expect(formatAggregateDuration(165)).toBe('2h 45m');
    expect(formatAggregateDuration(480)).toBe('8h');
    expect(formatAggregateDuration(765)).toBe('12h 45m');
  });
});
