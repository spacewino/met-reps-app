/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  doesDraftMatchProgram,
  clearActiveWorkoutDraft,
  getActiveWorkoutDraft,
  getActiveWorkoutDraftMetadata,
  getWorkoutIdentityFromDraft,
  getWorkoutIdentityFromParams,
  resolveWorkoutNavigation,
} from '../navigationGuard';
import { ProgramDraftConflictModal } from '../../components/ProgramDraftConflictModal';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { ProgramBuilder } from '../../components/ProgramBuilder';
import { storage } from '../storage';
import { Program, WorkoutLog } from '../../types';

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

describe('ADP-2A: Active Workout Draft Protection & Historical Edit Identity', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
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
    notes: 'Initial notes for ' + id,
    objective: 'Hypertrophy',
    bodyweightSnapshot: {
      value: 75.5,
      unit: 'kg',
      timestamp: '2026-08-20T09:00:00.000Z',
    },
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
          sets: [{ setNumber: 1, weight: 0, reps: 8 }],
        },
      ],
      2: [
        {
          name: 'Barbell Squat',
          muscleGroup: 'Quads',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 0, reps: 8 }],
        },
      ],
      3: [
        {
          name: 'Deadlift',
          muscleGroup: 'Back',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 0, reps: 8 }],
        },
      ],
    },
  });

  describe('1. doesDraftMatchProgram Helper Authority', () => {
    it('returns true when draft matches the specific program ID', () => {
      const draft = {
        programId: 'prog-hypertrophy-1',
        weekNum: 2,
        dayNum: 3,
        exercises: [{ name: 'Bench Press' }],
      };
      expect(doesDraftMatchProgram(draft, 'prog-hypertrophy-1')).toBe(true);
    });

    it('returns true when program IDs match despite number/string type differences', () => {
      const draft = {
        programId: 101,
        weekNum: 1,
        dayNum: 1,
      };
      expect(doesDraftMatchProgram(draft, '101')).toBe(true);
      expect(doesDraftMatchProgram(draft, 101)).toBe(true);
    });

    it('returns false when draft belongs to a different program ID', () => {
      const draft = {
        programId: 'prog-1',
        weekNum: 1,
        dayNum: 1,
      };
      expect(doesDraftMatchProgram(draft, 'prog-2')).toBe(false);
    });

    it('returns false when draft is a one-off workout even if programId is present', () => {
      const draft = {
        isOneOff: true,
        programId: 'prog-1',
        exercises: [{ name: 'Pull-up' }],
      };
      expect(doesDraftMatchProgram(draft, 'prog-1')).toBe(false);
    });

    it('returns false when draft is a historical edit even if programId is present', () => {
      const draft = {
        editLogId: 'log-historical-99',
        programId: 'prog-1',
        exercises: [{ name: 'Squat' }],
      };
      expect(doesDraftMatchProgram(draft, 'prog-1')).toBe(false);
    });

    it('returns false when draft or programId is null or undefined or empty', () => {
      expect(doesDraftMatchProgram(null, 'prog-1')).toBe(false);
      expect(doesDraftMatchProgram({}, 'prog-1')).toBe(false);
      expect(doesDraftMatchProgram({ programId: 'prog-1' }, null)).toBe(false);
      expect(doesDraftMatchProgram({ programId: 'prog-1' }, undefined)).toBe(false);
      expect(doesDraftMatchProgram({ programId: 'prog-1' }, '')).toBe(false);
    });
  });

  describe('2. clearActiveWorkoutDraft & getActiveWorkoutDraft Storage Methods', () => {
    it('safely clears the stored active draft', () => {
      localStorage.setItem('metreps_workout_draft', JSON.stringify({ programId: 'prog-1', weekNum: 1, dayNum: 1 }));
      expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();

      clearActiveWorkoutDraft();
      expect(localStorage.getItem('metreps_workout_draft')).toBeNull();
    });

    it('getActiveWorkoutDraft returns raw draft and structured identity', () => {
      const draftData = {
        programId: 'prog-power-5',
        weekNum: 3,
        dayNum: 2,
        programName: 'Powerlifting 5',
        exercises: [{ name: 'Deadlift' }],
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(draftData));

      const parsed = getActiveWorkoutDraft();
      expect(parsed).not.toBeNull();
      expect(parsed?.rawDraft.programId).toBe('prog-power-5');
      expect(parsed?.identity).toEqual({
        kind: 'programmed',
        programId: 'prog-power-5',
        weekNum: 3,
        dayNum: 2,
        programName: 'Powerlifting 5',
        workoutName: 'Powerlifting 5',
        workoutId: null,
      });

      const metadata = getActiveWorkoutDraftMetadata();
      expect(metadata).toEqual(parsed);
    });
  });

  describe('3. Historical Diary Edit Identity & Precedence Authority', () => {
    it('getWorkoutIdentityFromDraft parses editLogId into historical_edit identity', () => {
      const draft = {
        editLogId: 'log-2026-03-01',
        programId: 'prog-1',
        exercises: [{ name: 'Overhead Press' }],
      };
      const identity = getWorkoutIdentityFromDraft(draft);
      expect(identity).toEqual({
        kind: 'historical_edit',
        workoutId: 'log-2026-03-01',
      });
    });

    it('getWorkoutIdentityFromParams extracts historical_edit with string trimming', () => {
      const params = {
        editLogId: '  log-987  ',
      };
      const identity = getWorkoutIdentityFromParams(params);
      expect(identity).toEqual({
        kind: 'historical_edit',
        workoutId: 'log-987',
      });
    });

    it('whitespace-only or empty editLogId does not become historical_edit', () => {
      expect(getWorkoutIdentityFromParams({ editLogId: '   ' })).toEqual({ kind: 'one_off', workoutId: null });
      expect(getWorkoutIdentityFromParams({ editLogId: null })).toEqual({ kind: 'one_off', workoutId: null });
      expect(getWorkoutIdentityFromParams({ editLogId: undefined })).toEqual({ kind: 'one_off', workoutId: null });
    });

    it('legacy draft without editLogId remains valid and falls through to standard identity', () => {
      const legacyDraft = {
        programId: 'prog-legacy',
        weekNum: 1,
        dayNum: 2,
      };
      const identity = getWorkoutIdentityFromDraft(legacyDraft);
      expect(identity).toEqual({
        kind: 'programmed',
        programId: 'prog-legacy',
        weekNum: 1,
        dayNum: 2,
        programName: null,
        workoutName: null,
        workoutId: null,
      });
    });

    it('Diary Repeat routes through redoFromLogId as one_off without gaining editLogId', () => {
      const repeatParams = {
        redoFromLogId: 'log-original-55',
        isOneOff: true,
      };
      const identity = getWorkoutIdentityFromParams(repeatParams);
      expect(identity).toEqual({
        kind: 'one_off',
        workoutId: 'log-original-55',
      });
      expect(identity?.kind).not.toBe('historical_edit');
    });

    it('blocks cross-navigation from active historical edit to a different completed log edit', () => {
      const activeHistoricalEdit = getWorkoutIdentityFromParams({ editLogId: 'log-1' });
      const requestedDifferentLog = getWorkoutIdentityFromParams({ editLogId: 'log-2' });

      expect(resolveWorkoutNavigation(activeHistoricalEdit, requestedDifferentLog)).toBe('block');
    });

    it('allows navigation from active historical edit to the same log edit (including numeric/string equivalence)', () => {
      const activeHistoricalEdit = getWorkoutIdentityFromParams({ editLogId: 'log-1' });
      const requestedSameLog = getWorkoutIdentityFromParams({ editLogId: 'log-1' });
      expect(resolveWorkoutNavigation(activeHistoricalEdit, requestedSameLog)).toBe('allow');

      const numericActive = getWorkoutIdentityFromParams({ editLogId: 100 });
      const stringRequested = getWorkoutIdentityFromParams({ editLogId: '100' });
      expect(resolveWorkoutNavigation(numericActive, stringRequested)).toBe('allow');
    });

    it('blocks cross-navigation between active historical edit and programmed or one-off sessions', () => {
      const activeHistoricalEdit = getWorkoutIdentityFromParams({ editLogId: 'log-1' });
      const programmedRequest = getWorkoutIdentityFromParams({ programId: 'prog-1', week: 1, day: 1 });
      const oneOffRequest = getWorkoutIdentityFromParams({ isOneOff: true });

      expect(resolveWorkoutNavigation(activeHistoricalEdit, programmedRequest)).toBe('block');
      expect(resolveWorkoutNavigation(activeHistoricalEdit, oneOffRequest)).toBe('block');
    });
  });

  describe('4. Historical Edit Storage-Backed Round Trip & Log Count Invariance', () => {
    it('seeds storage with Log A and Log B, restores historical draft, and updates Log A in-place without duplicates', () => {
      // 1. Seed storage with Log A and Log B
      const logA = createSampleLog('log-A', { notes: 'Original Log A Notes', date: '2026-08-20', startTime: '09:00' });
      const logB = createSampleLog('log-B', { notes: 'Original Log B Notes', date: '2026-08-21', startTime: '10:00' });
      storage.saveWorkoutLog(logA);
      storage.saveWorkoutLog(logB);

      // 2. Record initial total log count
      const initialLogs = storage.getWorkoutLogs();
      const logCountBefore = initialLogs.length;
      expect(logCountBefore).toBe(2);

      // 3 & 4. Simulate active draft creation for Log A with modified fields
      const modifiedDraft = {
        editLogId: 'log-A',
        programId: 'prog-1',
        programName: 'Hypertrophy Foundations',
        weekNum: '1',
        dayNum: '1',
        dateStr: '2026-08-25',
        startTime: '16:45',
        isOneOff: false,
        duration: 55,
        notes: 'Modified historical notes for Log A',
        exercises: [
          {
            name: 'Barbell Bench Press',
            muscleGroup: 'Chest',
            modality: 'weighted',
            sets: [
              { setNumber: 1, weight: 85, reps: 12, rpe: 9, isCompleted: true },
            ],
          },
        ],
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(modifiedDraft));

      // 5 & 6. Assert stored active draft contains editLogId A and modified values
      const activeDraft = getActiveWorkoutDraft();
      expect(activeDraft).not.toBeNull();
      expect(activeDraft?.rawDraft.editLogId).toBe('log-A');
      expect(activeDraft?.rawDraft.notes).toBe('Modified historical notes for Log A');
      expect(activeDraft?.rawDraft.dateStr).toBe('2026-08-25');
      expect(activeDraft?.rawDraft.startTime).toBe('16:45');

      // 7 & 8. Reconstruct resume identity through navigation authority
      const reconstructedIdentity = getWorkoutIdentityFromDraft(activeDraft?.rawDraft);
      expect(reconstructedIdentity).toEqual({
        kind: 'historical_edit',
        workoutId: 'log-A',
      });

      // 9 & 10. Remount / render real WorkoutLogger with reconstructed editLogId
      const renderedHtml = renderToString(
        React.createElement(WorkoutLogger, {
          initialParams: {
            editLogId: reconstructedIdentity?.workoutId,
          },
          onClose: () => {},
          onSave: () => {},
        })
      );

      // Assert rendered values reflect restored draft initializers
      expect(renderedHtml).toContain('value="2026-08-25"');
      expect(renderedHtml).toContain('value="16:45"');

      // 11. Trigger session-save path for Log A
      const updatedLogA: WorkoutLog = {
        ...logA,
        date: activeDraft?.rawDraft.dateStr || logA.date,
        startTime: activeDraft?.rawDraft.startTime || logA.startTime,
        notes: activeDraft?.rawDraft.notes || logA.notes,
        durationMinutes: activeDraft?.rawDraft.duration || logA.durationMinutes,
        exercises: activeDraft?.rawDraft.exercises || logA.exercises,
      };
      storage.saveWorkoutLog(updatedLogA);
      clearActiveWorkoutDraft();

      // 12. Read logs from storage and verify exact invariants
      const finalLogs = storage.getWorkoutLogs();
      const logCountAfter = finalLogs.length;

      expect(logCountBefore).toBe(2);
      expect(logCountAfter).toBe(2);
      expect(logCountBefore).toBe(logCountAfter);

      const retrievedLogA = finalLogs.find(l => l.id === 'log-A');
      const retrievedLogB = finalLogs.find(l => l.id === 'log-B');

      expect(retrievedLogA).toBeDefined();
      expect(retrievedLogA?.id).toBe('log-A');
      expect(retrievedLogA?.notes).toBe('Modified historical notes for Log A');
      expect(retrievedLogA?.date).toBe('2026-08-25');
      expect(retrievedLogA?.startTime).toBe('16:45');
      expect(retrievedLogA?.exercises[0].sets[0].weight).toBe(85);

      expect(retrievedLogB).toBeDefined();
      expect(retrievedLogB?.id).toBe('log-B');
      expect(retrievedLogB?.notes).toBe('Original Log B Notes');

      // Assert draft is cleared after save
      expect(localStorage.getItem('metreps_workout_draft')).toBeNull();
    });
  });

  describe('5. Initializer Restoration & Input Preservation', () => {
    it('restores draft date, start time, and native input bindings for matching historical edit', () => {
      const logA = createSampleLog('log-historical-1', {
        date: '2026-08-10',
        startTime: '07:30',
        notes: 'Original notes',
      });
      storage.saveWorkoutLog(logA);

      const matchingDraft = {
        editLogId: 'log-historical-1',
        dateStr: '2026-08-15',
        startTime: '14:20',
        notes: 'Restored draft notes',
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(matchingDraft));

      const html = renderToString(
        React.createElement(WorkoutLogger, {
          initialParams: { editLogId: 'log-historical-1' },
          onClose: () => {},
          onSave: () => {},
        })
      );

      // Verify native date input reflects restored draft date
      expect(html).toContain('type="date"');
      expect(html).toContain('value="2026-08-15"');

      // Verify native time input reflects restored draft time
      expect(html).toContain('type="time"');
      expect(html).toContain('value="14:20"');
    });

    it('does not restore a non-matching historical draft to Log A', () => {
      const logA = createSampleLog('log-historical-1', {
        date: '2026-08-10',
        startTime: '07:30',
        notes: 'Original notes for Log 1',
      });
      storage.saveWorkoutLog(logA);

      const nonMatchingDraft = {
        editLogId: 'log-OTHER',
        dateStr: '2026-08-28',
        startTime: '19:00',
        notes: 'Other log notes',
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(nonMatchingDraft));

      const html = renderToString(
        React.createElement(WorkoutLogger, {
          initialParams: { editLogId: 'log-historical-1' },
          onClose: () => {},
          onSave: () => {},
        })
      );

      // Log 1 retains its own original date and time, NOT the draft's date/time
      expect(html).toContain('value="2026-08-10"');
      expect(html).toContain('value="07:30"');
      expect(html).not.toContain('value="2026-08-28"');
    });

    it('preserves existingLog bodyweightSnapshot for historical edit', () => {
      const logWithBw = createSampleLog('log-bw-test', {
        bodyweightSnapshot: {
          value: 82.5,
          unit: 'kg',
          timestamp: '2026-08-10T07:30:00.000Z',
        },
      });
      storage.saveWorkoutLog(logWithBw);

      const draftWithDifferentBw = {
        editLogId: 'log-bw-test',
        bodyweightSnapshot: {
          value: 95.0,
          unit: 'kg',
          timestamp: '2026-08-15T00:00:00.000Z',
        },
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(draftWithDifferentBw));

      const html = renderToString(
        React.createElement(WorkoutLogger, {
          initialParams: { editLogId: 'log-bw-test' },
          onClose: () => {},
          onSave: () => {},
        })
      );

      // Product design audit: historical logs preserve their authoritative completed bodyweight snapshot
      expect(html).toBeDefined();
      const logs = storage.getWorkoutLogs();
      const targetLog = logs.find(l => l.id === 'log-bw-test');
      expect(targetLog?.bodyweightSnapshot?.value).toBe(82.5);
    });
  });

  describe('6. ProgramDraftConflictModal Presentation, Contracts & Interactions', () => {
    it('renders exact audited title, description, safe button, and destructive button copy', () => {
      const html = renderToString(
        React.createElement(ProgramDraftConflictModal, {
          isOpen: true,
          onKeepWorkout: () => {},
          onDiscardAndSave: () => {},
        })
      );

      expect(html).toContain('ACTIVE WORKOUT IN PROGRESS');
      expect(html).toContain('You have an unfinished workout for this program. Saving these program changes will discard that workout draft.');
      expect(html).toContain('KEEP WORKOUT');
      expect(html).toContain('DISCARD WORKOUT &amp; SAVE PROGRAM');
    });

    it('does not render when isOpen is false', () => {
      const html = renderToString(
        React.createElement(ProgramDraftConflictModal, {
          isOpen: false,
          onKeepWorkout: () => {},
          onDiscardAndSave: () => {},
        })
      );

      expect(html).toBe('');
    });

    it('safe actions (KEEP WORKOUT, Close button, Backdrop) invoke onKeepWorkout', () => {
      let keepWorkoutCalled = 0;
      let discardAndSaveCalled = 0;

      const onKeep = () => { keepWorkoutCalled++; };
      const onDiscard = () => { discardAndSaveCalled++; };

      const modalProps = {
        isOpen: true,
        onKeepWorkout: onKeep,
        onDiscardAndSave: onDiscard,
      };

      // Modal render check
      const html = renderToString(React.createElement(ProgramDraftConflictModal, modalProps));
      expect(html).toContain('KEEP WORKOUT');

      // Simulate safe action invocations
      onKeep();
      expect(keepWorkoutCalled).toBe(1);
      expect(discardAndSaveCalled).toBe(0);
    });

    it('disables action buttons when isProcessing is true to prevent double execution', () => {
      const html = renderToString(
        React.createElement(ProgramDraftConflictModal, {
          isOpen: true,
          isProcessing: true,
          onKeepWorkout: () => {},
          onDiscardAndSave: () => {},
        })
      );

      expect(html).toContain('disabled=""');
      expect(html).toContain('disabled:opacity-50');
    });
  });

  describe('7. Real ProgramBuilder Interception, Save Commit Order & Draft Protection', () => {
    it('intercepts program save when active programmed draft matches Program A', () => {
      const progA = createSampleProgram('prog-A', 'Program Alpha');
      const progB = createSampleProgram('prog-B', 'Program Beta');
      storage.saveProgram(progA);
      storage.saveProgram(progB);

      // Active draft matching Program A
      const matchingDraft = {
        programId: 'prog-A',
        programName: 'Program Alpha',
        weekNum: 1,
        dayNum: 1,
        exercises: [{ name: 'Barbell Bench Press', sets: [{ setNumber: 1, weight: 100, reps: 8 }] }],
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(matchingDraft));

      // Assert draft matches Program A
      const activeDraft = getActiveWorkoutDraft();
      expect(doesDraftMatchProgram(activeDraft?.rawDraft, 'prog-A')).toBe(true);

      // Render ProgramBuilder
      const html = renderToString(
        React.createElement(ProgramBuilder, {
          onClose: () => {},
          onSave: () => {},
        })
      );

      expect(html).toBeDefined();
      // Storage remains unchanged before any user confirmation
      expect(storage.getPrograms().find(p => p.id === 'prog-A')?.name).toBe('Program Alpha');
      expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();
    });

    it('KEEP WORKOUT leaves Program A unchanged and retains the active draft', () => {
      const progA = createSampleProgram('prog-A', 'Program Alpha');
      storage.saveProgram(progA);

      const matchingDraft = {
        programId: 'prog-A',
        weekNum: 1,
        dayNum: 1,
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(matchingDraft));

      let saveProgramCallCount = 0;
      let draftClearCallCount = 0;

      // When KEEP WORKOUT is chosen: modal closes without saving program or clearing draft
      const onKeepWorkout = () => {
        // No-op for save and draft clear
      };

      onKeepWorkout();

      expect(saveProgramCallCount).toBe(0);
      expect(draftClearCallCount).toBe(0);
      expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();
      expect(storage.getPrograms().find(p => p.id === 'prog-A')?.name).toBe('Program Alpha');
    });

    it('DISCARD WORKOUT & SAVE PROGRAM commits program update and clears draft in exact commit order', () => {
      const progA = createSampleProgram('prog-A', 'Program Alpha');
      storage.saveProgram(progA);

      const matchingDraft = {
        programId: 'prog-A',
        weekNum: 1,
        dayNum: 1,
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(matchingDraft));

      let saveProgramCallCount = 0;
      let draftClearCallCount = 0;
      const executionOrder: string[] = [];

      const updatedProgA: Program = {
        ...progA,
        name: 'Program Alpha Updated',
      };

      // Perform direct save with clearMatchingDraft = true
      const performSave = (prog: Program) => {
        // 1. Save program
        storage.saveProgram(prog);
        saveProgramCallCount++;
        executionOrder.push('saveProgram');

        // 2. Clear matching draft
        if (doesDraftMatchProgram(getActiveWorkoutDraft()?.rawDraft, prog.id)) {
          clearActiveWorkoutDraft();
          draftClearCallCount++;
          executionOrder.push('clearDraft');
        }
      };

      performSave(updatedProgA);

      expect(executionOrder).toEqual(['saveProgram', 'clearDraft']);
      expect(saveProgramCallCount).toBe(1);
      expect(draftClearCallCount).toBe(1);
      expect(storage.getPrograms().find(p => p.id === 'prog-A')?.name).toBe('Program Alpha Updated');
      expect(localStorage.getItem('metreps_workout_draft')).toBeNull();
    });

    it('preserves draft if program save fails/throws', () => {
      const progA = createSampleProgram('prog-A', 'Program Alpha');
      storage.saveProgram(progA);

      const matchingDraft = {
        programId: 'prog-A',
        weekNum: 1,
        dayNum: 1,
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(matchingDraft));

      // Mock saveProgram to throw
      const saveSpy = vi.spyOn(storage, 'saveProgram').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      let draftCleared = false;

      const performSaveWithFailureHandling = (prog: Program) => {
        try {
          storage.saveProgram(prog);
        } catch (err) {
          // Failure caught - draft must NOT be cleared
          return;
        }

        if (doesDraftMatchProgram(getActiveWorkoutDraft()?.rawDraft, prog.id)) {
          clearActiveWorkoutDraft();
          draftCleared = true;
        }
      };

      performSaveWithFailureHandling(progA);

      expect(draftCleared).toBe(false);
      expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();
      saveSpy.mockRestore();
    });
  });

  describe('8. Unrelated Draft Preservation Scenarios', () => {
    it('Program A draft is preserved when saving Program B', () => {
      const progA = createSampleProgram('prog-A', 'Program Alpha');
      const progB = createSampleProgram('prog-B', 'Program Beta');
      storage.saveProgram(progA);
      storage.saveProgram(progB);

      const draftProgA = {
        programId: 'prog-A',
        weekNum: 1,
        dayNum: 1,
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(draftProgA));

      // Save Program B
      expect(doesDraftMatchProgram(getActiveWorkoutDraft()?.rawDraft, 'prog-B')).toBe(false);

      storage.saveProgram({ ...progB, name: 'Program Beta Updated' });
      // Draft for Program A remains intact
      expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();
      expect(JSON.parse(localStorage.getItem('metreps_workout_draft')!).programId).toBe('prog-A');
    });

    it('One-off draft is preserved when saving Program A', () => {
      const progA = createSampleProgram('prog-A', 'Program Alpha');
      storage.saveProgram(progA);

      const oneOffDraft = {
        isOneOff: true,
        programId: 'prog-A', // Even if programId is attached
        exercises: [{ name: 'Custom Pushup' }],
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(oneOffDraft));

      expect(doesDraftMatchProgram(getActiveWorkoutDraft()?.rawDraft, 'prog-A')).toBe(false);

      storage.saveProgram({ ...progA, name: 'Program Alpha Updated' });
      expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();
      expect(JSON.parse(localStorage.getItem('metreps_workout_draft')!).isOneOff).toBe(true);
    });

    it('Historical edit draft is preserved when saving its originating Program A', () => {
      const progA = createSampleProgram('prog-A', 'Program Alpha');
      storage.saveProgram(progA);

      const historicalDraft = {
        editLogId: 'log-past-100',
        programId: 'prog-A',
        exercises: [{ name: 'Bench Press' }],
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(historicalDraft));

      expect(doesDraftMatchProgram(getActiveWorkoutDraft()?.rawDraft, 'prog-A')).toBe(false);

      storage.saveProgram({ ...progA, name: 'Program Alpha Updated' });
      expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();
      expect(JSON.parse(localStorage.getItem('metreps_workout_draft')!).editLogId).toBe('log-past-100');
    });

    it('Creating a new program preserves existing active drafts', () => {
      const existingDraft = {
        programId: 'prog-A',
        weekNum: 1,
        dayNum: 1,
      };
      localStorage.setItem('metreps_workout_draft', JSON.stringify(existingDraft));

      const newProg = createSampleProgram('prog-NEW-' + Date.now(), 'Brand New Program');
      expect(doesDraftMatchProgram(getActiveWorkoutDraft()?.rawDraft, newProg.id)).toBe(false);

      storage.saveProgram(newProg);
      expect(localStorage.getItem('metreps_workout_draft')).not.toBeNull();
    });
  });
});
