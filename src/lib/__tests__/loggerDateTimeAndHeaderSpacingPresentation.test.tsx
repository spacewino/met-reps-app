/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ExerciseEntry, Program } from '../../types';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { formatLocalDateDisplay, formatLocalTimeDisplay } from '../dateUtils';

// In-memory storage mock
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

describe('MetReps — Logger Date/Time Compactness and Exercise Header Spacing Presentation Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const createExercise = (name: string): ExerciseEntry => ({
    name,
    muscleGroup: 'Chest',
    modality: 'weighted',
    sets: [
      { setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: false },
    ],
  });

  it('1. Date and Start Time inputs retain native types, state bindings, and are paired with aria-hidden pointer-events-none display layer', () => {
    const ex1 = createExercise('Barbell Bench Press');
    const program: Program = {
      id: 'prog-dt-1',
      name: 'Test Program',
      daysPerWeek: 3,
      programDuration: 4,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      exercisesByDay: { 1: [ex1] },
    };
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    const html = renderToString(
      <WorkoutLogger
        initialParams={{
          programId: program.id,
          week: '1',
          day: '1',
          date: '2026-08-28',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Confirm native type="date" and class="logger-date-time-input ..." with value binding
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-08-28"');
    expect(html).toMatch(/<input[^>]*type="date"[^>]*class="[^"]*logger-date-time-input[^"]*"/);

    // Confirm native type="time" and class="logger-date-time-input ..."
    expect(html).toContain('type="time"');
    expect(html).toMatch(/<input[^>]*type="time"[^>]*class="[^"]*logger-date-time-input[^"]*"/);

    // Confirm aria-hidden="true" display span exists with logger-date-time-display class
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('logger-date-time-display');
  });

  it('2. Exercise card header uses pt-11 and retains all four action controls', () => {
    const ex1 = createExercise('Barbell Bench Press');
    const program: Program = {
      id: 'prog-dt-2',
      name: 'Test Program',
      daysPerWeek: 3,
      programDuration: 4,
      createdAt: '2026-01-01T00:00:00Z',
      objective: 'Hypertrophy',
      algorithmId: 'hypertrophy_linear',
      exercisesByDay: { 1: [ex1] },
    };
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);

    const html = renderToString(
      <WorkoutLogger
        initialParams={{
          programId: program.id,
          week: '1',
          day: '1',
          isOneOff: false,
        }}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    // Exercise card header uses pt-11 (+4px vertical breathing room above exercise name)
    expect(html).toContain('pt-11');

    // Header action row contains Timer, Edit, History, Options actions
    expect(html).toContain('lucide-timer');
    expect(html).toContain('lucide-pencil');
    expect(html).toContain('lucide-history');
    expect(html).toContain('lucide-ellipsis-vertical');
  });

  it('3. Scoped CSS in index.css makes native input text transparent, provides centered display layer, and overlays transparent indicator', () => {
    const cssPath = path.resolve(__dirname, '../../index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // Rule is scoped to .logger-date-time-input and contains appearance: none + transparent text
    expect(cssContent).toContain('.logger-date-time-input {');
    expect(cssContent).toContain('position: relative;');
    expect(cssContent).toContain('-webkit-appearance: none;');
    expect(cssContent).toContain('appearance: none;');
    expect(cssContent).toContain('color: transparent');
    expect(cssContent).toContain('-webkit-text-fill-color: transparent');
    expect(cssContent).toContain('caret-color: transparent');
    expect(cssContent).toContain('text-align: center;');

    // Confirm appearance: none and transparent text are not globally applied to all inputs
    expect(cssContent).not.toMatch(/^\s*input\s*\{[^}]*appearance:\s*none/m);

    // Centered display layer rules
    expect(cssContent).toContain('.logger-date-time-display {');
    expect(cssContent).toContain('position: absolute;');
    expect(cssContent).toContain('inset: 0;');
    expect(cssContent).toContain('display: flex;');
    expect(cssContent).toContain('align-items: center;');
    expect(cssContent).toContain('justify-content: center;');
    expect(cssContent).toContain('white-space: nowrap;');
    expect(cssContent).toContain('pointer-events: none;');

    // WebKit picker indicator rule uses opacity: 0, transparent background/color and absolute inset overlay
    expect(cssContent).toContain('.logger-date-time-input::-webkit-calendar-picker-indicator {');
    expect(cssContent).toContain('opacity: 0;');
    expect(cssContent).toContain('position: absolute;');
    expect(cssContent).toContain('inset: 0;');
    expect(cssContent).toContain('width: 100%;');
    expect(cssContent).toContain('height: 100%;');
    expect(cssContent).toContain('background: transparent;');
    expect(cssContent).toContain('color: transparent;');
    expect(cssContent).toContain('cursor: pointer;');
  });

  it('4. Presentation formatting helpers format dates and times accurately without UTC day shifts', () => {
    // Australian locale: 28/08/2026
    const formattedDateAU = formatLocalDateDisplay('2026-08-28', 'en-AU');
    expect(formattedDateAU).toBe('28/08/2026');

    // US locale: 08/28/2026
    const formattedDateUS = formatLocalDateDisplay('2026-08-28', 'en-US');
    expect(formattedDateUS).toBe('08/28/2026');

    // Invalid date fallback
    expect(formatLocalDateDisplay('invalid-date')).toBe('invalid-date');
    expect(formatLocalDateDisplay('')).toBe('');

    // Time formatting with 12-hour and 24-hour locales
    const timeUS = formatLocalTimeDisplay('14:30', 'en-US');
    expect(timeUS.toLowerCase()).toContain('pm');
    expect(timeUS).toContain('2:30');

    const timeFR = formatLocalTimeDisplay('14:30', 'fr-FR');
    expect(timeFR).toContain('14:30');

    // Invalid time fallback
    expect(formatLocalTimeDisplay('invalid')).toBe('invalid');
    expect(formatLocalTimeDisplay('')).toBe('');
  });
});

