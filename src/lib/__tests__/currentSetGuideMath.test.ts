/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatGuideRowKey,
  parseGuideRowKey,
  isRowEligibleForGuide,
  isGuideKeyValidAndEligible,
  getAllEligibleGuideRows,
  findFirstEligibleGuideRow,
  findNextEligibleGuideRow,
  findFallbackEligibleGuideRow,
  reconcileGuideAfterSetDelete,
  reconcileGuideAfterExerciseDelete,
  reconcileGuideAfterSetSkip,
  reconcileGuideAfterExerciseSkip,
  reconcileGuideAfterExerciseMove,
  reconcileGuideAfterSetMove,
  reconcileGuideAfterWarmupChange,
  reconcileGuideAfterExerciseReplace,
  resolveInitialGuideKey,
} from '../currentSetGuideMath';
import { ExerciseEntry, SetEntry } from '../../types';
import { storage, DEFAULT_SETTINGS } from '../storage';

// In-memory localStorage mock for node test runner if needed
if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
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
}

function createExercise(
  name: string,
  setCount: number,
  options?: {
    isSkipped?: boolean;
    modality?: ExerciseEntry['modality'];
    warmupIndices?: number[];
    skippedIndices?: number[];
  }
): ExerciseEntry {
  const sets: SetEntry[] = Array.from({ length: setCount }, (_, i) => ({
    setNumber: i + 1,
    weight: 100,
    reps: 10,
    rpe: 8,
    form: 'standard',
    isWarmup: options?.warmupIndices?.includes(i) || false,
    isSkipped: options?.skippedIndices?.includes(i) || false,
  }));

  return {
    name,
    muscleGroup: 'Chest',
    modality: options?.modality,
    isSkipped: options?.isSkipped || false,
    sets,
  };
}

describe('Current Working Set Guide Math & State Engine (currentSetGuideMath)', () => {
  describe('Key Formatting and Parsing', () => {
    it('formats exercise and set indices into coordinate string', () => {
      expect(formatGuideRowKey(0, 0)).toBe('0-0');
      expect(formatGuideRowKey(2, 4)).toBe('2-4');
    });

    it('parses coordinate string correctly', () => {
      expect(parseGuideRowKey('0-0')).toEqual({ exIdx: 0, setIdx: 0 });
      expect(parseGuideRowKey('3-7')).toEqual({ exIdx: 3, setIdx: 7 });
    });

    it('returns null on invalid coordinate strings', () => {
      expect(parseGuideRowKey(null)).toBeNull();
      expect(parseGuideRowKey(undefined)).toBeNull();
      expect(parseGuideRowKey('')).toBeNull();
      expect(parseGuideRowKey('invalid')).toBeNull();
      expect(parseGuideRowKey('1-2-3')).toBeNull();
      expect(parseGuideRowKey('-1-2')).toBeNull();
      expect(parseGuideRowKey('abc-def')).toBeNull();
    });
  });

  describe('Eligibility Verification (isRowEligibleForGuide)', () => {
    it('allows regular working sets across all modalities', () => {
      const exWeighted = createExercise('Bench Press', 3);
      expect(isRowEligibleForGuide(exWeighted, exWeighted.sets[0])).toBe(true);

      const exBw = createExercise('Pushups', 3, { modality: 'bodyweight' });
      expect(isRowEligibleForGuide(exBw, exBw.sets[0])).toBe(true);

      const exTimed = createExercise('Plank', 3, { modality: 'timed' });
      expect(isRowEligibleForGuide(exTimed, exTimed.sets[0])).toBe(true);

      const exDist = createExercise('Rowing', 3, { modality: 'distance' });
      expect(isRowEligibleForGuide(exDist, exDist.sets[0])).toBe(true);

      const exAssist = createExercise('Assisted Pullup', 3, { modality: 'assisted' });
      expect(isRowEligibleForGuide(exAssist, exAssist.sets[0])).toBe(true);
    });

    it('rejects warmup sets from guide eligibility', () => {
      const ex = createExercise('Squat', 3, { warmupIndices: [0, 1] });
      expect(isRowEligibleForGuide(ex, ex.sets[0])).toBe(false); // warmup
      expect(isRowEligibleForGuide(ex, ex.sets[1])).toBe(false); // warmup
      expect(isRowEligibleForGuide(ex, ex.sets[2])).toBe(true);  // working set
    });

    it('rejects skipped sets from guide eligibility', () => {
      const ex = createExercise('Squat', 3, { skippedIndices: [2] });
      expect(isRowEligibleForGuide(ex, ex.sets[0])).toBe(true);
      expect(isRowEligibleForGuide(ex, ex.sets[1])).toBe(true);
      expect(isRowEligibleForGuide(ex, ex.sets[2])).toBe(false); // skipped
    });

    it('rejects all sets if parent exercise is skipped', () => {
      const ex = createExercise('Squat', 3, { isSkipped: true });
      expect(isRowEligibleForGuide(ex, ex.sets[0])).toBe(false);
      expect(isRowEligibleForGuide(ex, ex.sets[1])).toBe(false);
      expect(isRowEligibleForGuide(ex, ex.sets[2])).toBe(false);
    });
  });

  describe('Finding and Advancing Guide Rows', () => {
    it('finds the first eligible working set in a workout with warmups', () => {
      const exercises = [
        createExercise('Squat', 3, { warmupIndices: [0, 1] }),
        createExercise('Bench', 2),
      ];
      const first = findFirstEligibleGuideRow(exercises);
      expect(first).toEqual({ exIdx: 0, setIdx: 2, key: '0-2' });
    });

    it('finds the first eligible working set when first exercise is completely skipped', () => {
      const exercises = [
        createExercise('Squat', 3, { isSkipped: true }),
        createExercise('Bench', 2),
      ];
      const first = findFirstEligibleGuideRow(exercises);
      expect(first).toEqual({ exIdx: 1, setIdx: 0, key: '1-0' });
    });

    it('advances sequentially through sets of the same exercise', () => {
      const exercises = [
        createExercise('Squat', 3),
        createExercise('Bench', 2),
      ];
      expect(findNextEligibleGuideRow(exercises, '0-0')).toBe('0-1');
      expect(findNextEligibleGuideRow(exercises, '0-1')).toBe('0-2');
    });

    it('advances from last set of an exercise to first working set of next exercise', () => {
      const exercises = [
        createExercise('Squat', 2),
        createExercise('Bench', 3, { warmupIndices: [0] }),
      ];
      // 0-1 is last set of Squat. Next exercise Bench has set 0 as warmup, so should advance to 1-1
      expect(findNextEligibleGuideRow(exercises, '0-1')).toBe('1-1');
    });

    it('skips over intermediate skipped exercises when advancing', () => {
      const exercises = [
        createExercise('Squat', 2),
        createExercise('Deadlift', 3, { isSkipped: true }),
        createExercise('Bench', 2),
      ];
      expect(findNextEligibleGuideRow(exercises, '0-1')).toBe('2-0');
    });

    it('returns null when final working set of last exercise is completed', () => {
      const exercises = [
        createExercise('Squat', 2),
        createExercise('Bench', 2),
      ];
      expect(findNextEligibleGuideRow(exercises, '1-1')).toBeNull();
    });

    it('supports (exercises, exIdx, setIdx) numeric parameter overload', () => {
      const exercises = [
        createExercise('Squat', 3),
      ];
      expect(findNextEligibleGuideRow(exercises, 0, 0)).toBe('0-1');
      expect(findNextEligibleGuideRow(exercises, 0, 1)).toBe('0-2');
      expect(findNextEligibleGuideRow(exercises, 0, 2)).toBeNull();
    });
  });

  describe('Structural Reconciliations (Deletions, Moves, Skips)', () => {
    it('reconciles guide after deleting a set before the current guide', () => {
      const exercisesBefore = [createExercise('Squat', 4)];
      const exercisesAfter = [createExercise('Squat', 3)];
      // Current guide was on Set 3 (index 2). Delete Set 1 (index 0).
      // New guide should shift down to index 1.
      const reconciled = reconcileGuideAfterSetDelete('0-2', 0, 0, exercisesAfter);
      expect(reconciled).toBe('0-1');
    });

    it('reconciles guide after deleting a set after the current guide', () => {
      const exercisesAfter = [createExercise('Squat', 3)];
      // Current guide is on Set 1 (index 0). Delete Set 3 (index 2).
      // New guide remains on index 0.
      const reconciled = reconcileGuideAfterSetDelete('0-0', 0, 2, exercisesAfter);
      expect(reconciled).toBe('0-0');
    });

    it('reconciles guide when deleting the currently guided set itself', () => {
      const exercisesAfter = [createExercise('Squat', 2)];
      // Current guide was on Set 2 (index 1). Delete Set 2 (index 1).
      // Fallback searches at same index 1 (which was formerly Set 3)
      const reconciled = reconcileGuideAfterSetDelete('0-1', 0, 1, exercisesAfter);
      expect(reconciled).toBe('0-1');
    });

    it('reconciles guide after deleting an exercise', () => {
      const exercisesAfter = [
        createExercise('Bench', 3),
        createExercise('Rows', 3),
      ];
      // Guide was in exercise index 2 (Rows) on set 1 -> '2-1'. Delete exercise index 0 (Squat).
      // Reconciled guide should shift exIdx down to 1 -> '1-1'.
      const reconciled = reconcileGuideAfterExerciseDelete('2-1', 0, exercisesAfter);
      expect(reconciled).toBe('1-1');
    });

    it('reconciles guide after skipping a set', () => {
      const exercises = [
        createExercise('Squat', 3, { skippedIndices: [2] }),
      ];
      // Current guide was on '0-2' and user skips set index 2.
      // Reconciles to fallback (previous working set '0-1' or null if end).
      const reconciled = reconcileGuideAfterSetSkip('0-2', 0, 2, exercises);
      expect(reconciled).toBe('0-1');
    });

    it('reconciles guide after skipping an exercise', () => {
      const exercises = [
        createExercise('Squat', 3, { isSkipped: true }),
        createExercise('Bench', 2),
      ];
      // Current guide was in Squat '0-1' and user skips Squat.
      // Reconciles to first working set of next exercise '1-0'.
      const reconciled = reconcileGuideAfterExerciseSkip('0-1', 0, exercises);
      expect(reconciled).toBe('1-0');
    });

    it('reconciles guide after moving an exercise', () => {
      const exercisesAfter = [
        createExercise('Bench', 2),
        createExercise('Squat', 3),
      ];
      // Squat was moved from exIdx 0 to exIdx 1. Guide on Squat set 2 ('0-2') should become '1-2'.
      const reconciled = reconcileGuideAfterExerciseMove('0-2', 0, 1, exercisesAfter);
      expect(reconciled).toBe('1-2');
    });

    it('reconciles guide after moving a set within an exercise', () => {
      const exercisesAfter = [createExercise('Squat', 3)];
      // Set moved from index 0 to index 2. Guide was on index 0 ('0-0') -> becomes '0-2'.
      const reconciled = reconcileGuideAfterSetMove('0-0', 0, 0, 2, exercisesAfter);
      expect(reconciled).toBe('0-2');
    });

    describe('reconcileGuideAfterWarmupChange', () => {
      it('reconciles guide from 0 warmups to 3 generated warmups on Working Set 1', () => {
        // Before: 3 working sets [W1 (idx 0), W2 (idx 1), W3 (idx 2)]
        const setsBefore: SetEntry[] = [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 3, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];
        // After: 3 warmups + 3 working sets [WU1 (idx 0), WU2 (idx 1), WU3 (idx 2), W1 (idx 3), W2 (idx 4), W3 (idx 5)]
        const setsAfter: SetEntry[] = [
          { setNumber: 1, weight: 50, reps: 10, rpe: 4, form: 'standard', isWarmup: true },
          { setNumber: 2, weight: 70, reps: 7, rpe: 6, form: 'standard', isWarmup: true },
          { setNumber: 3, weight: 85, reps: 3, rpe: 7, form: 'standard', isWarmup: true },
          { setNumber: 4, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 5, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 6, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];

        // Guide was on '0-0' (Working Set 1) -> should become '0-3'
        expect(reconcileGuideAfterWarmupChange('0-0', 0, setsBefore, setsAfter)).toBe('0-3');
      });

      it('reconciles guide from 0 warmups to 3 generated warmups on Working Set 2', () => {
        const setsBefore: SetEntry[] = [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 3, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];
        const setsAfter: SetEntry[] = [
          { setNumber: 1, weight: 50, reps: 10, rpe: 4, form: 'standard', isWarmup: true },
          { setNumber: 2, weight: 70, reps: 7, rpe: 6, form: 'standard', isWarmup: true },
          { setNumber: 3, weight: 85, reps: 3, rpe: 7, form: 'standard', isWarmup: true },
          { setNumber: 4, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 5, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 6, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];

        // Guide was on '0-1' (Working Set 2) -> should become '0-4'
        expect(reconcileGuideAfterWarmupChange('0-1', 0, setsBefore, setsAfter)).toBe('0-4');
      });

      it('reconciles guide from 1 existing warmup to 3 regenerated warmups', () => {
        // Before: 1 warmup + 3 working sets [WU1 (idx 0), W1 (idx 1), W2 (idx 2), W3 (idx 3)]
        const setsBefore: SetEntry[] = [
          { setNumber: 1, weight: 50, reps: 10, rpe: 4, form: 'standard', isWarmup: true },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 3, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 4, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];
        // After: 3 warmups + 3 working sets [WU1 (idx 0), WU2 (idx 1), WU3 (idx 2), W1 (idx 3), W2 (idx 4), W3 (idx 5)]
        const setsAfter: SetEntry[] = [
          { setNumber: 1, weight: 50, reps: 10, rpe: 4, form: 'standard', isWarmup: true },
          { setNumber: 2, weight: 70, reps: 7, rpe: 6, form: 'standard', isWarmup: true },
          { setNumber: 3, weight: 85, reps: 3, rpe: 7, form: 'standard', isWarmup: true },
          { setNumber: 4, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 5, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 6, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];

        // Guide was on '0-1' (Working Set 1) -> should become '0-3'
        expect(reconcileGuideAfterWarmupChange('0-1', 0, setsBefore, setsAfter)).toBe('0-3');
        // Guide was on '0-2' (Working Set 2) -> should become '0-4'
        expect(reconcileGuideAfterWarmupChange('0-2', 0, setsBefore, setsAfter)).toBe('0-4');
      });

      it('reconciles guide when 3 existing warmups are regenerated again', () => {
        const setsBefore: SetEntry[] = [
          { setNumber: 1, weight: 50, reps: 10, rpe: 4, form: 'standard', isWarmup: true },
          { setNumber: 2, weight: 70, reps: 7, rpe: 6, form: 'standard', isWarmup: true },
          { setNumber: 3, weight: 85, reps: 3, rpe: 7, form: 'standard', isWarmup: true },
          { setNumber: 4, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 5, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 6, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];
        const setsAfter: SetEntry[] = [
          { setNumber: 1, weight: 55, reps: 10, rpe: 4, form: 'standard', isWarmup: true },
          { setNumber: 2, weight: 75, reps: 7, rpe: 6, form: 'standard', isWarmup: true },
          { setNumber: 3, weight: 90, reps: 3, rpe: 7, form: 'standard', isWarmup: true },
          { setNumber: 4, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 5, weight: 100, reps: 10, rpe: 8, form: 'standard' },
          { setNumber: 6, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];

        // Guide on Working Set 1 ('0-3') -> remains '0-3'
        expect(reconcileGuideAfterWarmupChange('0-3', 0, setsBefore, setsAfter)).toBe('0-3');
        // Guide on Working Set 3 ('0-5') -> remains '0-5'
        expect(reconcileGuideAfterWarmupChange('0-5', 0, setsBefore, setsAfter)).toBe('0-5');
      });

      it('leaves guide unchanged when guide belongs to another exercise', () => {
        const setsBefore: SetEntry[] = [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];
        const setsAfter: SetEntry[] = [
          { setNumber: 1, weight: 50, reps: 10, rpe: 4, form: 'standard', isWarmup: true },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];

        // Guide is in Exercise 1 ('1-0'), warmup change in Exercise 0
        expect(reconcileGuideAfterWarmupChange('1-0', 0, setsBefore, setsAfter)).toBe('1-0');
      });

      it('returns null when currentKey is null', () => {
        const setsBefore: SetEntry[] = [
          { setNumber: 1, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];
        const setsAfter: SetEntry[] = [
          { setNumber: 1, weight: 50, reps: 10, rpe: 4, form: 'standard', isWarmup: true },
          { setNumber: 2, weight: 100, reps: 10, rpe: 8, form: 'standard' },
        ];

        expect(reconcileGuideAfterWarmupChange(null, 0, setsBefore, setsAfter)).toBeNull();
      });
    });

    describe('reconcileGuideAfterExerciseReplace', () => {
      it('moves guide to first eligible working set in replaced exercise', () => {
        const exercisesAfter = [
          createExercise('Dumbbell Bench', 3, { warmupIndices: [0] }),
          createExercise('Barbell Row', 3),
        ];

        // Guide was in Exercise 0 (which was replaced). Should point to first eligible working set in Exercise 0 -> '0-1'
        expect(reconcileGuideAfterExerciseReplace('0-2', 0, exercisesAfter)).toBe('0-1');
      });

      it('preserves guide in another exercise when replacing a different exercise', () => {
        const exercisesAfter = [
          createExercise('Dumbbell Bench', 3),
          createExercise('Barbell Row', 3),
        ];

        // Guide is in Exercise 1 ('1-2'), Exercise 0 was replaced -> guide should remain '1-2'
        expect(reconcileGuideAfterExerciseReplace('1-2', 0, exercisesAfter)).toBe('1-2');
      });

      it('returns null when currentKey is null', () => {
        const exercisesAfter = [
          createExercise('Dumbbell Bench', 3),
        ];

        expect(reconcileGuideAfterExerciseReplace(null, 0, exercisesAfter)).toBeNull();
      });
    });
  });

  describe('Draft Resolution (resolveInitialGuideKey)', () => {
    it('initializes to first working set when draft is absent', () => {
      const exercises = [
        createExercise('Squat', 3, { warmupIndices: [0] }),
      ];
      expect(resolveInitialGuideKey(null, exercises)).toBe('0-1');
    });

    it('initializes to first working set when draft object has no currentSetGuideKey property (absent property)', () => {
      const exercises = [
        createExercise('Squat', 3, { warmupIndices: [0] }),
      ];
      const draft = { exercises };
      expect(resolveInitialGuideKey(draft, exercises)).toBe('0-1');
    });

    it('preserves explicit null guide key from draft (user finished workout)', () => {
      const exercises = [createExercise('Squat', 3)];
      const draft = { currentSetGuideKey: null };
      expect(resolveInitialGuideKey(draft, exercises)).toBeNull();
    });

    it('restores valid guide key from draft', () => {
      const exercises = [createExercise('Squat', 3)];
      const draft = { currentSetGuideKey: '0-2' };
      expect(resolveInitialGuideKey(draft, exercises)).toBe('0-2');
    });

    it('recovers to nearest fallback when draft key points to an invalid/skipped row', () => {
      const exercises = [
        createExercise('Squat', 3, { skippedIndices: [2] }),
      ];
      const draft = { currentSetGuideKey: '0-2' };
      // 0-2 is skipped, so fallback finds closest eligible row 0-1
      expect(resolveInitialGuideKey(draft, exercises)).toBe('0-1');
    });

    it('recovers gracefully from malformed draft key string', () => {
      const exercises = [createExercise('Squat', 3)];
      const draft = { currentSetGuideKey: 'invalid-key' };
      expect(resolveInitialGuideKey(draft, exercises)).toBe('0-0');
    });
  });

  describe('Settings & Storage Integration (highlightCurrentSet default and persistence)', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('confirms DEFAULT_SETTINGS.highlightCurrentSet is true', () => {
      expect(DEFAULT_SETTINGS.highlightCurrentSet).toBe(true);
    });

    it('returns true from getSettings when no stored settings exist', () => {
      expect(storage.getSettings().highlightCurrentSet).toBe(true);
      expect(storage.getHighlightCurrentSet()).toBe(true);
    });

    it('resolves legacy stored settings without highlightCurrentSet to true', () => {
      localStorage.setItem('metreps_settings', JSON.stringify({ someLegacyField: 123 }));
      expect(storage.getSettings().highlightCurrentSet).toBe(true);
      expect(storage.getHighlightCurrentSet()).toBe(true);
    });

    it('preserves explicitly stored false', () => {
      localStorage.setItem('metreps_settings', JSON.stringify({ highlightCurrentSet: false }));
      expect(storage.getSettings().highlightCurrentSet).toBe(false);
      expect(storage.getHighlightCurrentSet()).toBe(false);
    });

    it('preserves explicitly stored true', () => {
      localStorage.setItem('metreps_settings', JSON.stringify({ highlightCurrentSet: true }));
      expect(storage.getSettings().highlightCurrentSet).toBe(true);
      expect(storage.getHighlightCurrentSet()).toBe(true);
    });

    it('safely falls back to true when settings JSON is malformed', () => {
      localStorage.setItem('metreps_settings', 'invalid-json{{{');
      expect(storage.getSettings().highlightCurrentSet).toBe(true);
      expect(storage.getHighlightCurrentSet()).toBe(true);
    });

    it('persists false when setHighlightCurrentSet(false) is called', () => {
      storage.setHighlightCurrentSet(false);
      expect(storage.getHighlightCurrentSet()).toBe(false);
      const stored = JSON.parse(localStorage.getItem('metreps_settings') || '{}');
      expect(stored.highlightCurrentSet).toBe(false);
    });

    it('persists true when setHighlightCurrentSet(true) is called', () => {
      storage.setHighlightCurrentSet(false);
      expect(storage.getHighlightCurrentSet()).toBe(false);
      storage.setHighlightCurrentSet(true);
      expect(storage.getHighlightCurrentSet()).toBe(true);
      const stored = JSON.parse(localStorage.getItem('metreps_settings') || '{}');
      expect(stored.highlightCurrentSet).toBe(true);
    });
  });
});
