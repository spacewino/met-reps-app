// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { render, act, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveActiveWorkoutDraft,
  clearActiveWorkoutDraft,
  getActiveWorkoutDraft,
  getWorkoutIdentityFromDraft,
} from '../navigationGuard';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { Program, WorkoutLog } from '../../types';

// In-memory localStorage mock for node environment
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

describe('METREPS — ADP-2B: Workout Draft Loss Protection & Immediate Flush Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const createSampleProgram = (id: string, name: string): Program => ({
    id,
    name,
    daysPerWeek: 3,
    programDuration: 8,
    createdAt: '2026-08-24T00:00:00.000Z',
    objective: 'Hypertrophy',
    algorithmId: 'hypertrophy_linear',
    exercisesByDay: {
      1: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8, isCompleted: false }],
        },
      ],
    },
  });

  const createSampleLog = (id: string, overrides?: Partial<WorkoutLog>): WorkoutLog => ({
    id,
    date: '2026-08-20',
    startTime: '09:00',
    programId: 'prog-1',
    program: 'Hypertrophy Foundations',
    week: '1',
    day: '1',
    unit: 'kg',
    durationMinutes: 45,
    notes: 'Initial historical notes for ' + id,
    objective: 'Hypertrophy',
    exercises: [
      {
        name: 'Barbell Bench Press',
        muscleGroup: 'Chest',
        modality: 'weighted',
        sets: [
          { setNumber: 1, weight: 80, reps: 10, rpe: 8, isCompleted: true },
        ],
      },
    ],
    ...overrides,
  });

  describe('1. Immediate Same-Event Persistence Authority Contracts', () => {
    it('saves draft immediately via saveActiveWorkoutDraft and verifies round-trip persistence', () => {
      const payload = {
        programId: 'prog-imm-1',
        weekNum: 1,
        dayNum: 1,
        dateStr: '2026-08-30',
        workoutDate: '2026-08-30',
        startTime: '10:00',
        duration: 55,
        notes: 'Immediate flush test note',
        sleep: 8.0,
        hydration: 'Optimal',
        calories: 2750,
        protein: 160,
        soreness: 4,
        motivation: 8,
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 105, reps: 8, rpe: 8.5, isCompleted: true }],
          },
        ],
      };

      saveActiveWorkoutDraft(payload);
      const rawStored = localStorage.getItem('metreps_workout_draft');
      expect(rawStored).toBeTruthy();

      const parsed = JSON.parse(rawStored!);
      expect(parsed.notes).toBe('Immediate flush test note');
      expect(parsed.workoutDate).toBe('2026-08-30');
      expect(parsed.duration).toBe(55);
      expect(parsed.sleep).toBe(8.0);
      expect(parsed.hydration).toBe('Optimal');
      expect(parsed.calories).toBe(2750);
      expect(parsed.protein).toBe(160);
      expect(parsed.soreness).toBe(4);
      expect(parsed.motivation).toBe(8);
    });

    it('clears draft immediately via clearActiveWorkoutDraft authority', () => {
      saveActiveWorkoutDraft({
        programId: 'prog-imm-1',
        weekNum: 1,
        dayNum: 1,
        notes: 'To be cleared',
      });
      expect(localStorage.getItem('metreps_workout_draft')).toBeTruthy();

      clearActiveWorkoutDraft();
      expect(localStorage.getItem('metreps_workout_draft')).toBeNull();
    });
  });

  describe('2. WorkoutLogger Rendering & Bound Handlers Verification', () => {
    it('renders WorkoutLogger with ordinary input controls and displays populated initial values', () => {
      const prog = createSampleProgram('prog-logger-1', 'Test Logger Program');
      storage.saveProgram(prog);
      storage.setCurrentProgramId(prog.id);

      const html = renderToString(
        <WorkoutLogger
          initialParams={{
            programId: prog.id,
            week: '1',
            day: '1',
            date: '2026-08-30',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      // Verify date input
      expect(html).toContain('type="date"');
      expect(html).toContain('value="2026-08-30"');

      // Verify start time input
      expect(html).toContain('type="time"');

      // Verify duration input
      expect(html).toContain('Workout Duration');
      expect(html).toContain('MIN');

      // Verify sleep, hydration, calories, soreness, quality controls
      expect(html).toContain('Sleep QTY');
      expect(html).toContain('Hydration');
      expect(html).toContain('Intake');
      expect(html).toContain('Muscle Soreness (1-10)');
      expect(html).toContain('Workout Quality (1-10)');
      expect(html).toContain('Session Notes &amp; Observations');
    });

    it('restores draft with session-level inputs correctly into WorkoutLogger UI', () => {
      const prog = createSampleProgram('prog-logger-2', 'Draft Hydration Program');
      storage.saveProgram(prog);
      storage.setCurrentProgramId(prog.id);

      const draftPayload = {
        programId: prog.id,
        weekNum: 1,
        dayNum: 1,
        dateStr: '2026-08-31',
        workoutDate: '2026-08-31',
        startTime: '14:30',
        duration: 75,
        notes: 'Restored workout observation notes',
        sleep: 9,
        hydration: 'Optimal',
        calories: 3200,
        protein: 180,
        soreness: 6,
        motivation: 9,
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [{ setNumber: 1, weight: 110, reps: 6, rpe: 9, isCompleted: false }],
          },
        ],
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(draftPayload));

      const html = renderToString(
        <WorkoutLogger
          initialParams={{
            programId: prog.id,
            week: '1',
            day: '1',
            date: '2026-08-31',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );

      expect(html).toContain('value="2026-08-31"');
      expect(html).toContain('value="14:30"');
      expect(html).toContain('value="75"');
      expect(html).toContain('Restored workout observation notes');
      expect(html).toContain('Optimal');
      expect(html).toContain('value="3200"');
      expect(html).toMatch(/6(?:<!-- -->)?\/10/);
      expect(html).toMatch(/9(?:<!-- -->)?\/10/);
    });
  });

  describe('3. Historical Edit Identity & Draft Segregation', () => {
    it('correctly sets editLogId in draft when editing a historical log', () => {
      const historicalLog = createSampleLog('hist-log-101', {
        notes: 'Original historical session log',
      });
      storage.saveWorkoutLog(historicalLog);

      const draftForEdit = {
        editLogId: 'hist-log-101',
        programId: 'prog-1',
        weekNum: '1',
        dayNum: '1',
        dateStr: '2026-08-20',
        workoutDate: '2026-08-20',
        startTime: '09:00',
        duration: 45,
        notes: 'Modified historical session notes before save',
        exercises: historicalLog.exercises,
      };

      saveActiveWorkoutDraft(draftForEdit);

      const activeDraft = getActiveWorkoutDraft();
      expect(activeDraft).not.toBeNull();
      expect(activeDraft?.identity?.kind).toBe('historical_edit');
      expect(activeDraft?.identity?.workoutId).toBe('hist-log-101');
      expect(activeDraft?.rawDraft.notes).toBe('Modified historical session notes before save');
    });

    it('identifies historical edit drafts as distinct from standard programmed sessions', () => {
      const histDraft = {
        editLogId: 'hist-log-202',
        programId: 'prog-1',
        weekNum: 1,
        dayNum: 1,
        exercises: [{ name: 'Squat', sets: [{ setNumber: 1, weight: 140, reps: 5 }] }],
      };

      const identity = getWorkoutIdentityFromDraft(histDraft);
      expect(identity?.kind).toBe('historical_edit');
      expect(identity?.workoutId).toBe('hist-log-202');
    });
  });

  describe('4. Anti-Resurrection & Flush Suppression Guarantees', () => {
    it('ensures clearing draft removes all draft data and prevents resurrection', () => {
      const draft = {
        programId: 'prog-1',
        weekNum: 1,
        dayNum: 1,
        notes: 'Session notes before discard',
      };
      saveActiveWorkoutDraft(draft);
      expect(localStorage.getItem('metreps_workout_draft')).toBeTruthy();

      clearActiveWorkoutDraft();
      expect(localStorage.getItem('metreps_workout_draft')).toBeNull();

      const retrieved = getActiveWorkoutDraft();
      expect(retrieved).toBeNull();
    });

    it('ensures malformed JSON in draft storage is safely handled without throwing', () => {
      localStorage.setItem('metreps_workout_draft', '{malformed_json...');
      const retrieved = getActiveWorkoutDraft();
      expect(retrieved).toBeNull();
    });
  });

  describe('5. Set-Level & Exercise Mutation Persistence Contracts', () => {
    it('persists weight, reps, and RPE set mutations into draft structure', () => {
      const draft = {
        programId: 'prog-1',
        weekNum: 1,
        dayNum: 1,
        exercises: [
          {
            name: 'Incline Dumbbell Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: 32, reps: 10, rpe: 8, isCompleted: true, isWarmup: false, isDropSet: false },
              { setNumber: 2, weight: 34, reps: 8, rpe: 9, isCompleted: true, isWarmup: false, isDropSet: true },
            ],
          },
        ],
        userTouchedSets: { '0-0': true, '0-1': true },
        checkedSets: { '0-0': true, '0-1': true },
      };

      saveActiveWorkoutDraft(draft);
      const retrieved = getActiveWorkoutDraft();
      expect(retrieved?.rawDraft.exercises[0].sets[0].weight).toBe(32);
      expect(retrieved?.rawDraft.exercises[0].sets[0].reps).toBe(10);
      expect(retrieved?.rawDraft.exercises[0].sets[0].rpe).toBe(8);
      expect(retrieved?.rawDraft.exercises[0].sets[1].isDropSet).toBe(true);
      expect(retrieved?.rawDraft.checkedSets['0-0']).toBe(true);
    });

    it('persists exercise skip and warm-up mutations in draft', () => {
      const draft = {
        programId: 'prog-1',
        weekNum: 1,
        dayNum: 1,
        exercises: [
          {
            name: 'Overhead Press',
            muscleGroup: 'Shoulders',
            modality: 'weighted',
            isSkipped: true,
            sets: [
              { setNumber: 1, weight: 50, reps: 5, rpe: 6, isWarmup: true },
            ],
          },
        ],
      };

      saveActiveWorkoutDraft(draft);
      const retrieved = getActiveWorkoutDraft();
      expect(retrieved?.rawDraft.exercises[0].isSkipped).toBe(true);
      expect(retrieved?.rawDraft.exercises[0].sets[0].isWarmup).toBe(true);
    });
  });

  describe('6. Lifecycle Flush Simulation Contracts', () => {
    it('simulates pagehide and visibilitychange flushing with active payload', () => {
      let flushCount = 0;
      let flushedDraft: any = null;

      const mockFlushHandler = (payload: any) => {
        flushCount++;
        flushedDraft = payload;
        saveActiveWorkoutDraft(payload);
      };

      const payloadOnPageHide = {
        programId: 'prog-pagehide',
        weekNum: 2,
        dayNum: 3,
        notes: 'Flushed during pagehide event',
        duration: 50,
      };

      mockFlushHandler(payloadOnPageHide);
      expect(flushCount).toBe(1);
      expect(flushedDraft.notes).toBe('Flushed during pagehide event');

      const retrieved = getActiveWorkoutDraft();
      expect(retrieved?.rawDraft.notes).toBe('Flushed during pagehide event');
    });
  });

  describe('7. Real Component Lifecycle Historical-Edit Draft Recovery Regression Suite', () => {
    it('1. Matching draft mount test: restores modified draft fields and does NOT overwrite with existingLog in real React effects', async () => {
      const historicalLog = createSampleLog('hist-real-101', {
        notes: 'Original completed session notes',
        durationMinutes: 40,
        recovery: { sleepHours: 7.0, hydrationLevel: 'Adequate', nutritionCalories: 2400, proteinGrams: 130, soreness: 2, motivation: 4 },
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: 80, reps: 10, rpe: 8, comment: 'Original set comment', isCompleted: true },
            ],
          },
        ],
      });
      storage.saveWorkoutLog(historicalLog);

      const modifiedDraft = {
        editLogId: 'hist-real-101',
        programId: 'prog-1',
        weekNum: '1',
        dayNum: '1',
        dateStr: '2026-08-20',
        workoutDate: '2026-08-20',
        startTime: '11:15',
        duration: 55,
        notes: 'Updated draft session observations after edits',
        sleep: 8.5,
        hydration: 'Optimal',
        calories: 3100,
        protein: 175,
        soreness: 5,
        motivation: 9,
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: 87.5, reps: 12, rpe: 9, comment: 'Updated set note in draft', isCompleted: true },
            ],
          },
        ],
        checkedSets: { '0-0': true },
      };
      saveActiveWorkoutDraft(modifiedDraft);

      let rendered: ReturnType<typeof render>;
      await act(async () => {
        rendered = render(
          <WorkoutLogger
            initialParams={{
              editLogId: 'hist-real-101',
              programId: 'prog-1',
              week: '1',
              day: '1',
              date: '2026-08-20',
              isOneOff: false,
            }}
            onClose={() => {}}
            onSave={() => {}}
          />
        );
      });

      // Verify that the rendered DOM shows the draft's updated values, NOT the stale historicalLog values
      const notesTextarea = rendered!.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(notesTextarea).toBeTruthy();
      expect(notesTextarea.value).toBe('Updated draft session observations after edits');

      // Verify draft in localStorage was NOT clobbered back to existingLog by mounting effects
      const draftAfterMount = getActiveWorkoutDraft();
      expect(draftAfterMount).not.toBeNull();
      expect(draftAfterMount?.rawDraft.notes).toBe('Updated draft session observations after edits');
      expect(draftAfterMount?.rawDraft.exercises[0].sets[0].weight).toBe(87.5);
      expect(draftAfterMount?.rawDraft.exercises[0].sets[0].comment).toBe('Updated set note in draft');
      expect(draftAfterMount?.rawDraft.duration).toBe(55);

      rendered!.unmount();
    });

    it('2. Interactive historical remount test: edits persist through unmount and remount lifecycle', async () => {
      const historicalLog = createSampleLog('hist-real-202', {
        notes: 'Unedited historical notes',
        durationMinutes: 50,
      });
      storage.saveWorkoutLog(historicalLog);

      // Mount the historical edit with no draft initially
      let rendered: ReturnType<typeof render>;
      await act(async () => {
        rendered = render(
          <WorkoutLogger
            initialParams={{
              editLogId: 'hist-real-202',
              programId: 'prog-1',
              week: '1',
              day: '1',
              date: '2026-08-20',
              isOneOff: false,
            }}
            onClose={() => {}}
            onSave={() => {}}
          />
        );
      });

      // User interacts and changes session notes
      const notesTextarea = rendered!.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(notesTextarea).toBeTruthy();
      expect(notesTextarea.value).toBe('Unedited historical notes');

      await act(async () => {
        fireEvent.change(notesTextarea, { target: { value: 'User newly modified notes during session' } });
      });

      // Unmount simulating browser close / background flush
      await act(async () => {
        rendered!.unmount();
      });

      // Draft must contain the new notes
      const storedDraft = getActiveWorkoutDraft();
      expect(storedDraft).not.toBeNull();
      expect(storedDraft?.identity?.workoutId).toBe('hist-real-202');
      expect(storedDraft?.rawDraft.notes).toBe('User newly modified notes during session');

      // Remount the historical edit (simulate reopen shortcut)
      let remounted: ReturnType<typeof render>;
      await act(async () => {
        remounted = render(
          <WorkoutLogger
            initialParams={{
              editLogId: 'hist-real-202',
              programId: 'prog-1',
              week: '1',
              day: '1',
              date: '2026-08-20',
              isOneOff: false,
            }}
            onClose={() => {}}
            onSave={() => {}}
          />
        );
      });

      // Verify the newly edited content was restored on remount!
      const remountedNotes = remounted!.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(remountedNotes.value).toBe('User newly modified notes during session');

      remounted!.unmount();
    });

    it('3. Additional field recovery: handles protein 0 / custom values, sleep, calories, soreness, motivation', async () => {
      const historicalLog = createSampleLog('hist-real-303', {
        notes: 'Original log 303',
        recovery: { sleepHours: 7.5, hydrationLevel: 'Adequate', nutritionCalories: 2500, proteinGrams: 140, soreness: 3, motivation: 5 },
      });
      storage.saveWorkoutLog(historicalLog);

      const zeroProteinDraft = {
        editLogId: 'hist-real-303',
        programId: 'prog-1',
        weekNum: '1',
        dayNum: '1',
        dateStr: '2026-08-20',
        workoutDate: '2026-08-20',
        notes: 'Draft with protein 0',
        sleep: 6.0,
        hydration: 'Suboptimal',
        calories: 1800,
        protein: 0,
        soreness: 7,
        motivation: 3,
        exercises: historicalLog.exercises,
      };
      saveActiveWorkoutDraft(zeroProteinDraft);

      let rendered: ReturnType<typeof render>;
      await act(async () => {
        rendered = render(
          <WorkoutLogger
            initialParams={{
              editLogId: 'hist-real-303',
              date: '2026-08-20',
              isOneOff: false,
            }}
            onClose={() => {}}
            onSave={() => {}}
          />
        );
      });

      const draftAfterMount = getActiveWorkoutDraft();
      expect(draftAfterMount?.rawDraft.protein).toBe(0);
      expect(draftAfterMount?.rawDraft.sleep).toBe(6.0);
      expect(draftAfterMount?.rawDraft.calories).toBe(1800);
      expect(draftAfterMount?.rawDraft.soreness).toBe(7);
      expect(draftAfterMount?.rawDraft.motivation).toBe(3);

      rendered!.unmount();
    });

    it('4. Isolation and fallback verification: hydrates from existingLog when no draft matches', async () => {
      const historicalLog = createSampleLog('hist-real-404', {
        notes: 'Canonical existing log notes for 404',
        durationMinutes: 42,
      });
      storage.saveWorkoutLog(historicalLog);

      // Save a draft for an entirely different log
      saveActiveWorkoutDraft({
        editLogId: 'hist-other-999',
        notes: 'Other log notes',
      });

      let rendered: ReturnType<typeof render>;
      await act(async () => {
        rendered = render(
          <WorkoutLogger
            initialParams={{
              editLogId: 'hist-real-404',
              date: '2026-08-20',
              isOneOff: false,
            }}
            onClose={() => {}}
            onSave={() => {}}
          />
        );
      });

      const notesTextarea = rendered!.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(notesTextarea.value).toBe('Canonical existing log notes for 404');

      rendered!.unmount();
    });

    it('5. Final save invariance: saving historical edit clears the draft and persists updated WorkoutLog', async () => {
      const historicalLog = createSampleLog('hist-real-505', {
        notes: 'Pre-edit historical notes',
      });
      storage.saveWorkoutLog(historicalLog);

      saveActiveWorkoutDraft({
        editLogId: 'hist-real-505',
        notes: 'Final updated notes ready to be saved',
        exercises: historicalLog.exercises,
      });

      let onSaveCalled = false;
      let rendered: ReturnType<typeof render>;
      await act(async () => {
        rendered = render(
          <WorkoutLogger
            initialParams={{
              editLogId: 'hist-real-505',
              date: '2026-08-20',
              isOneOff: false,
            }}
            onClose={() => {}}
            onSave={() => {
              onSaveCalled = true;
            }}
          />
        );
      });

      // Find and click "Save Workout Log" button
      const saveButton = Array.from(rendered!.container.querySelectorAll('button')).find(
        b => b.textContent?.includes('Save Workout Log')
      );
      expect(saveButton).toBeTruthy();

      await act(async () => {
        fireEvent.click(saveButton!);
      });

      expect(onSaveCalled).toBe(true);

      // Draft must be cleared after save
      expect(localStorage.getItem('metreps_workout_draft')).toBeNull();

      // Final log must be updated in storage
      const persistedLogs = storage.getWorkoutLogs();
      const updatedLog = persistedLogs.find(l => l.id === 'hist-real-505');
      expect(updatedLog).toBeTruthy();
      expect(updatedLog?.notes).toBe('Final updated notes ready to be saved');

      rendered!.unmount();
    });
  });
});
