/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { Program } from '../../types';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import fs from 'fs';
import path from 'path';

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

describe('MetReps — PBW-1 Program Builder & Logger Algorithm Presentation Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const setupProgram = (objective: 'Hypertrophy' | 'Strength' | 'Off', algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none'): Program => {
    const program: Program = {
      id: 'test-program-1',
      name: 'Test Target Program',
      daysPerWeek: 3,
      programDuration: 8,
      createdAt: '2026-08-24T00:00:00.000Z',
      objective,
      algorithmId,
      exercisesByDay: {
        1: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            isMainMovement: true,
            sets: [{ setNumber: 1, weight: 100, reps: 10, rpe: 8.0, isCompleted: false }],
          },
        ],
        2: [],
        3: [],
      },
    };
    storage.saveProgram(program);
    storage.setCurrentProgramId(program.id);
    return program;
  };

  describe('1. Program Builder Hypertrophy Algorithm Cards & Presentation', () => {
    it('renders Wave Volume (hypertrophy_linear) button title, subtitle, and info control accurately', () => {
      setupProgram('Hypertrophy', 'hypertrophy_linear');

      const html = renderToString(
        <ProgramBuilder onClose={() => {}} onSave={() => {}} />
      );

      // Section headings & subtitles
      expect(html).toContain('Training Goal');
      expect(html).toContain('Choose the main focus for this program.');
      expect(html).toContain('Periodisation Method');
      expect(html).toContain('Choose how reps and target effort are structured across the weeks of your program.');

      // Button Titles
      expect(html).toContain('Wave Volume');
      expect(html).toContain('Step Loading');

      // Subtitles
      expect(html).toContain('Alternates higher-rep (12–15) and lower-rep (6–12) weeks at RPE 8.0.');
      expect(html).toContain('Builds RPE through each 4-week block, finishing with a higher-rep week.');

      // Info button accessibility labels
      expect(html).toContain('aria-label="About Wave Volume"');
      expect(html).toContain('aria-label="About Step Loading"');
    });

    it('renders Step Loading (hypertrophy_step) title and subtitle accurately when selected', () => {
      setupProgram('Hypertrophy', 'hypertrophy_step');

      const html = renderToString(
        <ProgramBuilder onClose={() => {}} onSave={() => {}} />
      );

      expect(html).toContain('Step Loading');
      expect(html).toContain('Builds RPE through each 4-week block, finishing with a higher-rep week.');
      expect(html).toContain('aria-label="About Step Loading"');
    });
  });

  describe('2. Program Builder Strength Algorithm Cards & Presentation', () => {
    it('renders Wave Strength (strength_undulating) button title, subtitle, and info control accurately in Title Case', () => {
      setupProgram('Strength', 'strength_undulating');

      const html = renderToString(
        <ProgramBuilder onClose={() => {}} onSave={() => {}} />
      );

      // Button Titles (Title Case verified)
      expect(html).toContain('Wave Strength');
      expect(html).toContain('Linear Periodisation');
      expect(html).not.toContain('WAVE STRENGTH');

      // Wave Strength Subtitle
      expect(html).toContain('Progresses Main Movements through lower-rep phases and finishes with an RPE 10 peak single.');

      // Linear Periodisation Subtitle
      expect(html).toContain('Tapers reps from 8 to 1 while increasing target RPE from 7.0 to 10.0.');

      // Info button accessibility labels
      expect(html).toContain('aria-label="About Wave Strength"');
      expect(html).toContain('aria-label="About Linear Periodisation"');
    });

    it('renders Linear Periodisation (strength_linear) title and subtitle accurately when selected', () => {
      setupProgram('Strength', 'strength_linear');

      const html = renderToString(
        <ProgramBuilder onClose={() => {}} onSave={() => {}} />
      );

      expect(html).toContain('Linear Periodisation');
      expect(html).toContain('Tapers reps from 8 to 1 while increasing target RPE from 7.0 to 10.0.');
      expect(html).toContain('aria-label="About Linear Periodisation"');
    });
  });

  describe('3. Objective Off / Traditional Self-Directed Logging Preservation', () => {
    it('preserves Traditional Self-Directed Logging title and explanatory copy when Objective is Off', () => {
      setupProgram('Off');

      const html = renderToString(
        <ProgramBuilder onClose={() => {}} onSave={() => {}} />
      );

      expect(html).toContain('Traditional Self-Directed Logging');
      expect(html).toContain('No automated calculations will be applied. The application will pre-fill targets exactly from your previous logged workout values, allowing for organic self-regulated training.');
    });
  });

  describe('4. WorkoutLogger Algorithm Badge & Tooltip Description Parity', () => {
    it('renders exact updated descriptions for all algorithm badge mappings in WorkoutLogger', () => {
      const wlPath = path.resolve(process.cwd(), 'src/components/WorkoutLogger.tsx');
      const wlSource = fs.readFileSync(wlPath, 'utf8');

      // Test Wave Volume
      const p1 = setupProgram('Hypertrophy', 'hypertrophy_linear');
      const html1 = renderToString(
        <WorkoutLogger initialParams={{ programId: p1.id, day: '1', week: '1' }} onClose={() => {}} onSave={() => {}} />
      );
      expect(html1).toContain('Wave Volume');
      expect(html1).toContain('WV');
      expect(html1).toContain('aria-label="About Wave Volume"');
      expect(wlSource).toContain('Alternates weekly between higher-rep (12–15) and lower-rep (6–12) sessions at RPE 8.0.');

      // Test Step Loading
      const p2 = setupProgram('Hypertrophy', 'hypertrophy_step');
      const html2 = renderToString(
        <WorkoutLogger initialParams={{ programId: p2.id, day: '1', week: '1' }} onClose={() => {}} onSave={() => {}} />
      );
      expect(html2).toContain('Step Loading');
      expect(html2).toContain('SL');
      expect(html2).toContain('aria-label="About Step Loading"');
      expect(wlSource).toContain('Builds RPE through each 4-week block, finishing with a higher-rep week before the next heavier block.');

      // Test Wave Strength
      const p3 = setupProgram('Strength', 'strength_undulating');
      const html3 = renderToString(
        <WorkoutLogger initialParams={{ programId: p3.id, day: '1', week: '1' }} onClose={() => {}} onSave={() => {}} />
      );
      expect(html3).toContain('Wave Strength');
      expect(html3).toContain('DUP');
      expect(html3).toContain('aria-label="About Wave Strength"');
      expect(wlSource).toContain('Progresses designated Main Movements through lower-rep phases and finishes with an RPE 10 peak single.');

      // Test Linear Periodisation
      const p4 = setupProgram('Strength', 'strength_linear');
      const html4 = renderToString(
        <WorkoutLogger initialParams={{ programId: p4.id, day: '1', week: '1' }} onClose={() => {}} onSave={() => {}} />
      );
      expect(html4).toContain('Linear Periodisation');
      expect(html4).toContain('LP');
      expect(html4).toContain('aria-label="About Linear Periodisation"');
      expect(wlSource).toContain('Gradually reduces Main Movement targets from 8 reps to 1 while increasing RPE from 7.0 to 10.0.');

      // Test Self-Directed
      const p5 = setupProgram('Off', 'none');
      const html5 = renderToString(
        <WorkoutLogger initialParams={{ programId: p5.id, day: '1', week: '1' }} onClose={() => {}} onSave={() => {}} />
      );
      expect(html5).toContain('Self-Directed');
      expect(html5).toContain('SD');
      expect(html5).toContain('aria-label="About Self-Directed"');
    });
  });

  describe('5. Static Source Assertion — Negative Checks for Stale & Unsupported Phrases', () => {
    it('verifies ProgramBuilder and WorkoutLogger production files contain no stale or unscientific claims', () => {
      const pbPath = path.resolve(process.cwd(), 'src/components/ProgramBuilder.tsx');
      const wlPath = path.resolve(process.cwd(), 'src/components/WorkoutLogger.tsx');

      const pbSource = fs.readFileSync(pbPath, 'utf8');
      const wlSource = fs.readFileSync(wlPath, 'utf8');
      const combinedSource = pbSource + '\n' + wlSource;

      // Negative assertions against stale/unsupported phrases
      expect(combinedSource).not.toContain('6-rep main');
      expect(combinedSource).not.toContain('10 reps for accessories');
      expect(combinedSource).not.toContain('force muscle fibers to grow');
      expect(combinedSource).not.toContain('force muscle fibres to grow');
      expect(combinedSource).not.toContain('clearing central fatigue');
      expect(combinedSource).not.toContain('fatigue blocks');
      expect(combinedSource).not.toContain('8.0+');
      expect(combinedSource).not.toContain('accessory volume is slightly overreached');
      expect(combinedSource).not.toContain('spur motor unit recruitment');
      expect(combinedSource).not.toContain('deep hyper-recovery response');
      expect(combinedSource).not.toContain('WAVE STRENGTH');
    });
  });
});
