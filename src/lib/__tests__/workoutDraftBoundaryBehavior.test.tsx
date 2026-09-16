// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveActiveWorkoutDraft,
  clearActiveWorkoutDraft,
  getActiveWorkoutDraft,
} from '../navigationGuard';
import { WorkoutLogger } from '../../components/WorkoutLogger';
import { storage } from '../storage';
import { Program, WorkoutLog } from '../../types';
import { parseActivePrescriptionBoundary, isValidIsoCalendarDate } from '../workoutDraftBoundary';

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

describe('METREPS — Workout Draft Boundary Persistence & Lifecycle Behavior', () => {
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
    notes: 'Historical log notes for ' + id,
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

  it('1. Fresh session initializes and autosaves prescriptionBoundary with positive timestamp and valid target date', async () => {
    const prog = createSampleProgram('prog-fresh-1', 'Hypertrophy Foundations');
    storage.saveProgram(prog);

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: 'prog-fresh-1',
            week: '1',
            day: '1',
            scheduledDate: '2026-09-15',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    // Trigger an input edit to guarantee immediate draft flush
    const notesArea = rendered!.container.querySelector('textarea');
    expect(notesArea).toBeTruthy();
    await act(async () => {
      fireEvent.change(notesArea!, { target: { value: 'Fresh session notes' } });
    });

    const activeDraft = getActiveWorkoutDraft();
    expect(activeDraft).not.toBeNull();
    const boundary = activeDraft!.rawDraft.prescriptionBoundary;
    expect(boundary).toBeDefined();
    expect(typeof boundary.sessionStartedAt).toBe('number');
    expect(boundary.sessionStartedAt).toBeGreaterThan(0);
    expect(Number.isInteger(boundary.sessionStartedAt)).toBe(true);
    expect(boundary.prescriptionTargetDate).toBe('2026-09-15');

    rendered!.unmount();
  });

  it('2. Displayed date change does not alter prescriptionBoundary', async () => {
    const prog = createSampleProgram('prog-date-change', 'Hypertrophy Foundations');
    storage.saveProgram(prog);

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: 'prog-date-change',
            week: '1',
            day: '1',
            scheduledDate: '2026-09-15',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    // Change notes to flush initial draft
    const notesArea = rendered!.container.querySelector('textarea');
    await act(async () => {
      fireEvent.change(notesArea!, { target: { value: 'Initial notes' } });
    });

    const initialDraft = getActiveWorkoutDraft();
    const initialBoundary = initialDraft!.rawDraft.prescriptionBoundary;
    expect(initialBoundary.prescriptionTargetDate).toBe('2026-09-15');

    // Change date via date input
    const dateInput = rendered!.container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    await act(async () => {
      fireEvent.change(dateInput, { target: { value: '2026-09-20' } });
    });

    const updatedDraft = getActiveWorkoutDraft();
    expect(updatedDraft).not.toBeNull();
    // Displayed date changed
    expect(updatedDraft!.rawDraft.dateStr).toBe('2026-09-20');
    // But prescription boundary target date and timestamp remain strictly unchanged
    expect(updatedDraft!.rawDraft.prescriptionBoundary).toEqual(initialBoundary);

    rendered!.unmount();
  });

  it('3. Resuming same-day valid draft preserves exact boundary', async () => {
    const validBoundary = {
      sessionStartedAt: 1725804000000,
      prescriptionTargetDate: '2026-09-08',
    };
    const draft = {
      programId: 'prog-resume-1',
      weekNum: 1,
      dayNum: 1,
      dateStr: '2026-09-08',
      scheduledDate: '2026-09-08',
      notes: 'Draft to resume',
      exercises: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8, isCompleted: false }],
        },
      ],
      prescriptionBoundary: validBoundary,
    };
    saveActiveWorkoutDraft(draft);

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: 'prog-resume-1',
            week: '1',
            day: '1',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    // Edit notes and flush
    const notesArea = rendered!.container.querySelector('textarea');
    await act(async () => {
      fireEvent.change(notesArea!, { target: { value: 'Updated resumed notes' } });
    });

    const flushedDraft = getActiveWorkoutDraft();
    expect(flushedDraft?.rawDraft.prescriptionBoundary).toEqual(validBoundary);

    rendered!.unmount();
  });

  it('4. Resuming later-day valid draft preserves exact boundary even when today date differs', async () => {
    const originalBoundary = {
      sessionStartedAt: 1725804000000,
      prescriptionTargetDate: '2026-09-01', // Earlier date
    };
    const draft = {
      programId: 'prog-later-1',
      weekNum: 1,
      dayNum: 1,
      dateStr: '2026-09-01',
      notes: 'Started last week',
      exercises: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8, isCompleted: false }],
        },
      ],
      prescriptionBoundary: originalBoundary,
    };
    saveActiveWorkoutDraft(draft);

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: 'prog-later-1',
            week: '1',
            day: '1',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const notesArea = rendered!.container.querySelector('textarea');
    await act(async () => {
      fireEvent.change(notesArea!, { target: { value: 'Continuing today' } });
    });

    const flushedDraft = getActiveWorkoutDraft();
    expect(flushedDraft?.rawDraft.prescriptionBoundary).toEqual(originalBoundary);

    rendered!.unmount();
  });

  it('5 & 6 & 7. Legacy draft without prescriptionBoundary hydrates with null and anti-laundering persists null across refreshes', async () => {
    // 5. Legacy draft with omitted prescriptionBoundary
    const legacyDraft = {
      programId: 'prog-legacy-1',
      weekNum: 1,
      dayNum: 1,
      dateStr: '2026-09-08',
      notes: 'Legacy draft from older app version',
      exercises: [
        {
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          modality: 'weighted',
          sets: [{ setNumber: 1, weight: 100, reps: 8, rpe: 8, isCompleted: false }],
        },
      ],
      // prescriptionBoundary omitted
    };
    saveActiveWorkoutDraft(legacyDraft);

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: 'prog-legacy-1',
            week: '1',
            day: '1',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    // 6. Subsequent autosave from legacy-hydrated draft writes prescriptionBoundary: null
    const notesArea = rendered!.container.querySelector('textarea');
    await act(async () => {
      fireEvent.change(notesArea!, { target: { value: 'Modified legacy notes' } });
    });

    const autosavedDraft = getActiveWorkoutDraft();
    expect(autosavedDraft).not.toBeNull();
    expect(autosavedDraft!.rawDraft.prescriptionBoundary).toBeNull();

    rendered!.unmount();

    // 7. Second refresh after legacy autosave still sees null
    let remounted: ReturnType<typeof render>;
    await act(async () => {
      remounted = render(
        <WorkoutLogger
          initialParams={{
            programId: 'prog-legacy-1',
            week: '1',
            day: '1',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const remountedNotes = remounted!.container.querySelector('textarea');
    await act(async () => {
      fireEvent.change(remountedNotes!, { target: { value: 'Modified legacy notes round 2' } });
    });

    const secondDraft = getActiveWorkoutDraft();
    expect(secondDraft).not.toBeNull();
    expect(secondDraft!.rawDraft.prescriptionBoundary).toBeNull();

    remounted!.unmount();
  });

  it('8. Malformed draft boundary hydrates with null', async () => {
    const malformedCases = [
      { sessionStartedAt: -100, prescriptionTargetDate: '2026-09-08' },
      { sessionStartedAt: 1725804000000, prescriptionTargetDate: '2026-02-31' },
      { sessionStartedAt: 1725804000000 }, // missing date
      { prescriptionTargetDate: '2026-09-08' }, // missing timestamp
      'invalid-string',
      [1725804000000, '2026-09-08'],
    ];

    for (const malformed of malformedCases) {
      localStorage.clear();
      const draft = {
        programId: 'prog-malformed-1',
        weekNum: 1,
        dayNum: 1,
        dateStr: '2026-09-08',
        notes: 'Malformed test',
        exercises: [],
        prescriptionBoundary: malformed,
      };
      saveActiveWorkoutDraft(draft);

      let rendered: ReturnType<typeof render>;
      await act(async () => {
        rendered = render(
          <WorkoutLogger
            initialParams={{
              programId: 'prog-malformed-1',
              week: '1',
              day: '1',
              isOneOff: false,
            }}
            onClose={() => {}}
            onSave={() => {}}
          />
        );
      });

      const notesArea = rendered!.container.querySelector('textarea');
      await act(async () => {
        fireEvent.change(notesArea!, { target: { value: 'Trigger flush for malformed' } });
      });

      const flushed = getActiveWorkoutDraft();
      expect(flushed?.rawDraft.prescriptionBoundary).toBeNull();

      rendered!.unmount();
    }
  });

  it('9. Discard lifecycle clears old boundary without premature replacement, and fresh mount creates exactly one new boundary', async () => {
    vi.useFakeTimers();
    try {
      const prog = createSampleProgram('prog-discard-1', 'Hypertrophy Foundations');
      storage.saveProgram(prog);

      const oldTimestamp = 1725000000000;
      const oldBoundary = {
        sessionStartedAt: oldTimestamp,
        prescriptionTargetDate: '2026-08-30',
      };
      const draft = {
        programId: 'prog-discard-1',
        weekNum: 1,
        dayNum: 1,
        dateStr: '2026-08-30',
        notes: 'Old draft to discard',
        exercises: [],
        prescriptionBoundary: oldBoundary,
      };
      saveActiveWorkoutDraft(draft);

      let closed = false;
      let rendered: ReturnType<typeof render>;
      await act(async () => {
        rendered = render(
          <WorkoutLogger
            initialParams={{
              programId: 'prog-discard-1',
              week: '1',
              day: '1',
              scheduledDate: '2026-09-08',
              isOneOff: false,
            }}
            onClose={() => {
              closed = true;
            }}
            onSave={() => {}}
          />
        );
      });

      // Find and click the Cancel Workout button shown when hasExistingDraft is true
      const cancelBtn = Array.from(rendered!.container.querySelectorAll('button')).find(
        b => b.textContent?.includes('Cancel Workout')
      );
      expect(cancelBtn).toBeTruthy();
      await act(async () => {
        fireEvent.click(cancelBtn!);
      });

      // ConfirmationModal appears with 'Discard & Reset' button
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent?.includes('Discard & Reset')
      );
      expect(confirmBtn).toBeTruthy();
      await act(async () => {
        fireEvent.click(confirmBtn!);
      });

      // 1. After discard, stored active draft is cleared
      expect(getActiveWorkoutDraft()).toBeNull();
      // 2. onClose() was invoked
      expect(closed).toBe(true);

      // 3. Advancing time confirms discarded boundary is not autosaved again
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(getActiveWorkoutDraft()).toBeNull();

      // Follow onClose unmount
      rendered!.unmount();

      // Advance deterministic clock to new session start
      const freshScheduledTimestamp = 1725804000000;
      vi.setSystemTime(freshScheduledTimestamp);

      // Now mount genuinely fresh scheduled session
      let freshScheduledRendered: ReturnType<typeof render>;
      await act(async () => {
        freshScheduledRendered = render(
          <WorkoutLogger
            initialParams={{
              programId: 'prog-discard-1',
              week: '1',
              day: '1',
              scheduledDate: '2026-09-08',
              isOneOff: false,
            }}
            onClose={() => {}}
            onSave={() => {}}
          />
        );
      });

      const freshScheduledNotes = freshScheduledRendered!.container.querySelector('textarea');
      await act(async () => {
        fireEvent.change(freshScheduledNotes!, { target: { value: 'Fresh scheduled session' } });
      });

      const freshScheduledDraft = getActiveWorkoutDraft();
      expect(freshScheduledDraft).not.toBeNull();
      expect(freshScheduledDraft!.rawDraft.prescriptionBoundary).not.toBeNull();
      expect(freshScheduledDraft!.rawDraft.prescriptionBoundary.sessionStartedAt).toBe(freshScheduledTimestamp);
      expect(freshScheduledDraft!.rawDraft.prescriptionBoundary.sessionStartedAt).not.toBe(oldTimestamp);
      expect(freshScheduledDraft!.rawDraft.prescriptionBoundary.prescriptionTargetDate).toBe('2026-09-08');

      freshScheduledRendered!.unmount();

      // Clear draft again to test unscheduled fresh mount
      clearActiveWorkoutDraft();

      // Advance deterministic clock to unscheduled session start
      const freshUnscheduledTimestamp = 1725890400000;
      vi.setSystemTime(freshUnscheduledTimestamp);

      let freshUnscheduledRendered: ReturnType<typeof render>;
      await act(async () => {
        freshUnscheduledRendered = render(
          <WorkoutLogger
            initialParams={{
              isOneOff: true,
            }}
            onClose={() => {}}
            onSave={() => {}}
          />
        );
      });

      const freshUnscheduledNotes = freshUnscheduledRendered!.container.querySelector('textarea');
      await act(async () => {
        fireEvent.change(freshUnscheduledNotes!, { target: { value: 'Fresh unscheduled session' } });
      });

      const freshUnscheduledDraft = getActiveWorkoutDraft();
      expect(freshUnscheduledDraft).not.toBeNull();
      expect(freshUnscheduledDraft!.rawDraft.prescriptionBoundary).not.toBeNull();
      expect(freshUnscheduledDraft!.rawDraft.prescriptionBoundary.sessionStartedAt).toBe(freshUnscheduledTimestamp);
      // Unscheduled uses local-date authority (from system time)
      expect(isValidIsoCalendarDate(freshUnscheduledDraft!.rawDraft.prescriptionBoundary.prescriptionTargetDate)).toBe(true);

      freshUnscheduledRendered!.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('10. Historical edit does not serialize a live Guided prescriptionBoundary', async () => {
    const historicalLog = createSampleLog('hist-log-101', {
      notes: 'Original historical note',
    });
    storage.saveWorkoutLog(historicalLog);

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            editLogId: 'hist-log-101',
            date: '2026-08-20',
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const notesArea = rendered!.container.querySelector('textarea');
    await act(async () => {
      fireEvent.change(notesArea!, { target: { value: 'Edited historical log' } });
    });

    const flushedDraft = getActiveWorkoutDraft();
    expect(flushedDraft).not.toBeNull();
    expect(flushedDraft!.rawDraft.editLogId).toBe('hist-log-101');
    expect(flushedDraft!.rawDraft.prescriptionBoundary).toBeNull();

    rendered!.unmount();
  });

  it('11. redoFromLogId session does not serialize a live Guided prescriptionBoundary', async () => {
    const sourceLog = createSampleLog('source-log-202', {
      notes: 'Source workout',
    });
    storage.saveWorkoutLog(sourceLog);

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            redoFromLogId: 'source-log-202',
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    const notesArea = rendered!.container.querySelector('textarea');
    await act(async () => {
      fireEvent.change(notesArea!, { target: { value: 'Redo session notes' } });
    });

    const flushedDraft = getActiveWorkoutDraft();
    expect(flushedDraft).not.toBeNull();
    expect(flushedDraft!.rawDraft.prescriptionBoundary).toBeNull();

    rendered!.unmount();
  });

  it('12. Completed WorkoutLog does not receive prescriptionBoundary', async () => {
    const prog = createSampleProgram('prog-finish-1', 'Hypertrophy Foundations');
    storage.saveProgram(prog);

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <WorkoutLogger
          initialParams={{
            programId: 'prog-finish-1',
            week: '1',
            day: '1',
            scheduledDate: '2026-09-08',
            isOneOff: false,
          }}
          onClose={() => {}}
          onSave={() => {}}
        />
      );
    });

    // Check a set as completed so finish workout is enabled
    const checkBtn = rendered!.container.querySelector('button[title*="Complete"], button[aria-label*="Complete"]') ||
      Array.from(rendered!.container.querySelectorAll('button')).find(b => b.className.includes('rounded-full') || b.querySelector('svg.lucide-check'));

    if (checkBtn) {
      await act(async () => {
        fireEvent.click(checkBtn);
      });
    }

    // Click Finish Workout
    const finishBtn = Array.from(rendered!.container.querySelectorAll('button')).find(
      b => b.textContent?.includes('Finish') || b.textContent?.includes('Save')
    );
    expect(finishBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(finishBtn!);
    });

    // Assert that the logs saved in storage do NOT have prescriptionBoundary
    const allLogs = storage.getWorkoutLogs();
    const finishedLog = allLogs[allLogs.length - 1];
    expect(finishedLog).toBeDefined();
    expect((finishedLog as any).prescriptionBoundary).toBeUndefined();

    rendered!.unmount();
  });
});
