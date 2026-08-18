/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExerciseEntry, SetEntry } from '../types';
import { isSetValidForCompletion } from './setSkipRules';

export { isSetValidForCompletion };

export interface PrepareExercisesOptions {
  exercises: ExerciseEntry[];
  checkedSets?: Record<string, boolean>;
  defaultBodyweight?: number | null;
  completionTouchedSets?: Record<string, boolean>;
  isEditMode?: boolean;
}

/**
 * Pure function to map active workout exercises and their set performance values into
 * saved exercises with persistent `isCompleted` boolean flags.
 *
 * Completion-on-Save Rules (for every newly saved or explicitly edited/resaved workout):
 * 1. Valid, non-skipped set:
 *    - ex.isSkipped !== true
 *    - set.isSkipped !== true
 *    - required modality-specific performance values are valid (>0)
 *    -> save as isCompleted: true (both untouched algorithm targets and manually edited sets).
 * 2. Skipped set or skipped exercise:
 *    -> save as isCompleted: false.
 * 3. Blank or invalid set:
 *    -> save as isCompleted: false.
 *
 * Invariants:
 * 1. Does not mutate the input exercise or set objects.
 * 2. Preserves all other set and exercise properties verbatim (including isSkipped).
 * 3. Handles bodyweight default weight substitution when applicable.
 */
export function prepareExercisesForSave(options: PrepareExercisesOptions): ExerciseEntry[] {
  const {
    exercises,
    defaultBodyweight,
  } = options;

  return exercises.map((ex) => {
    const isExerciseSkipped = ex.isSkipped === true;
    const isBw = ex.modality === 'bodyweight';

    return {
      ...ex,
      sets: ex.sets.map((set) => {
        let isCompleted = false;

        if (!isExerciseSkipped && set.isSkipped !== true) {
          isCompleted = isSetValidForCompletion(set, ex.modality);
        }

        const setCopy: SetEntry = {
          ...set,
          isCompleted,
        };

        if (isBw && (set.weight === null || set.weight === undefined || set.weight === 0)) {
          setCopy.weight = defaultBodyweight ?? 0;
        }

        return setCopy;
      }),
    };
  });
}

/**
 * Remap `${exerciseIndex}-${setIndex}` keyed records after an exercise is deleted at `deletedExIdx`.
 * - Keys with exIdx < deletedExIdx remain unchanged.
 * - Keys with exIdx === deletedExIdx are removed.
 * - Keys with exIdx > deletedExIdx shift down by 1.
 */
export function remapAfterExerciseDelete<T>(
  record: Record<string, T>,
  deletedExIdx: number
): Record<string, T> {
  const nextRecord: Record<string, T> = {};
  for (const [key, val] of Object.entries(record)) {
    const parts = key.split('-');
    if (parts.length === 2) {
      const exIdx = parseInt(parts[0], 10);
      const setIdx = parts[1];
      if (isNaN(exIdx)) {
        nextRecord[key] = val;
      } else if (exIdx < deletedExIdx) {
        nextRecord[key] = val;
      } else if (exIdx === deletedExIdx) {
        // Drop keys belonging to deleted exercise
        continue;
      } else {
        // Shift exercise index down
        nextRecord[`${exIdx - 1}-${setIdx}`] = val;
      }
    } else {
      nextRecord[key] = val;
    }
  }
  return nextRecord;
}

/**
 * Remap `${exerciseIndex}-${setIndex}` keyed records after a set is deleted at `deletedSetIdx`
 * inside exercise `targetExIdx`.
 * - Keys with exIdx !== targetExIdx remain unchanged.
 * - Within targetExIdx:
 *   - setIdx < deletedSetIdx remain unchanged.
 *   - setIdx === deletedSetIdx is removed.
 *   - setIdx > deletedSetIdx shift down by 1.
 */
export function remapAfterSetDelete<T>(
  record: Record<string, T>,
  targetExIdx: number,
  deletedSetIdx: number
): Record<string, T> {
  const nextRecord: Record<string, T> = {};
  for (const [key, val] of Object.entries(record)) {
    const parts = key.split('-');
    if (parts.length === 2) {
      const exIdx = parseInt(parts[0], 10);
      const sIdx = parseInt(parts[1], 10);
      if (isNaN(exIdx) || isNaN(sIdx) || exIdx !== targetExIdx) {
        nextRecord[key] = val;
      } else if (sIdx < deletedSetIdx) {
        nextRecord[key] = val;
      } else if (sIdx === deletedSetIdx) {
        // Drop key for deleted set
        continue;
      } else {
        // Shift set index down
        nextRecord[`${exIdx}-${sIdx - 1}`] = val;
      }
    } else {
      nextRecord[key] = val;
    }
  }
  return nextRecord;
}

/**
 * Remap `${exerciseIndex}-${setIndex}` keyed records after an exercise is replaced at `replaceExIdx`.
 * - Keys with exIdx === replaceExIdx are removed.
 * - Keys belonging to other exercises remain unchanged.
 */
export function remapAfterExerciseReplace<T>(
  record: Record<string, T>,
  replaceExIdx: number
): Record<string, T> {
  const nextRecord: Record<string, T> = {};
  for (const [key, val] of Object.entries(record)) {
    const parts = key.split('-');
    if (parts.length === 2) {
      const exIdx = parseInt(parts[0], 10);
      if (!isNaN(exIdx) && exIdx === replaceExIdx) {
        // Drop keys for replaced exercise
        continue;
      }
    }
    nextRecord[key] = val;
  }
  return nextRecord;
}

/**
 * Remap `${exerciseIndex}-${setIndex}` keyed records after two exercises swap positions.
 * - Keys with exIdx === exIdx1 become exIdx2.
 * - Keys with exIdx === exIdx2 become exIdx1.
 * - Other keys remain unchanged.
 */
export function remapAfterExerciseMove<T>(
  record: Record<string, T>,
  exIdx1: number,
  exIdx2: number
): Record<string, T> {
  const nextRecord: Record<string, T> = {};
  for (const [key, val] of Object.entries(record)) {
    const parts = key.split('-');
    if (parts.length === 2) {
      const exIdx = parseInt(parts[0], 10);
      const setIdx = parts[1];
      if (isNaN(exIdx)) {
        nextRecord[key] = val;
      } else if (exIdx === exIdx1) {
        nextRecord[`${exIdx2}-${setIdx}`] = val;
      } else if (exIdx === exIdx2) {
        nextRecord[`${exIdx1}-${setIdx}`] = val;
      } else {
        nextRecord[key] = val;
      }
    } else {
      nextRecord[key] = val;
    }
  }
  return nextRecord;
}

/**
 * Remap `${exerciseIndex}-${setIndex}` keyed records after two sets within an exercise swap positions.
 */
export function remapAfterSetMove<T>(
  record: Record<string, T>,
  targetExIdx: number,
  setIdx1: number,
  setIdx2: number
): Record<string, T> {
  const nextRecord: Record<string, T> = {};
  for (const [key, val] of Object.entries(record)) {
    const parts = key.split('-');
    if (parts.length === 2) {
      const exIdx = parseInt(parts[0], 10);
      const sIdx = parseInt(parts[1], 10);
      if (isNaN(exIdx) || isNaN(sIdx) || exIdx !== targetExIdx) {
        nextRecord[key] = val;
      } else if (sIdx === setIdx1) {
        nextRecord[`${exIdx}-${setIdx2}`] = val;
      } else if (sIdx === setIdx2) {
        nextRecord[`${exIdx}-${setIdx1}`] = val;
      } else {
        nextRecord[key] = val;
      }
    } else {
      nextRecord[key] = val;
    }
  }
  return nextRecord;
}

/**
 * Remap `${exerciseIndex}-${setIndex}` keyed records after sets are inserted at `insertedAtSetIdx`
 * inside exercise `targetExIdx`.
 * - Keys with exIdx !== targetExIdx remain unchanged.
 * - Within targetExIdx:
 *   - sIdx < insertedAtSetIdx remain unchanged.
 *   - sIdx >= insertedAtSetIdx shift up by insertedCount.
 * - Malformed keys remain untouched.
 * - insertedCount must be a positive integer (> 0). Invalid parameters return a safe shallow copy.
 */
export function remapAfterSetInsert<T>(
  record: Record<string, T>,
  targetExIdx: number,
  insertedAtSetIdx: number,
  insertedCount: number
): Record<string, T> {
  if (
    !record ||
    typeof targetExIdx !== 'number' ||
    isNaN(targetExIdx) ||
    typeof insertedAtSetIdx !== 'number' ||
    isNaN(insertedAtSetIdx) ||
    typeof insertedCount !== 'number' ||
    isNaN(insertedCount) ||
    !Number.isInteger(insertedCount) ||
    insertedCount <= 0
  ) {
    return { ...record };
  }

  const nextRecord: Record<string, T> = {};
  for (const [key, val] of Object.entries(record)) {
    const parts = key.split('-');
    if (parts.length === 2) {
      const exIdx = parseInt(parts[0], 10);
      const sIdx = parseInt(parts[1], 10);
      if (isNaN(exIdx) || isNaN(sIdx) || exIdx !== targetExIdx) {
        nextRecord[key] = val;
      } else if (sIdx < insertedAtSetIdx) {
        nextRecord[key] = val;
      } else {
        nextRecord[`${exIdx}-${sIdx + insertedCount}`] = val;
      }
    } else {
      nextRecord[key] = val;
    }
  }
  return nextRecord;
}

/**
 * Remap `${exerciseIndex}-${setIndex}` keyed records after warm-up sets within exercise `targetExIdx`
 * are replaced, changing the warm-up count from `priorWarmupCount` to `newWarmupCount`.
 *
 * Rules:
 * - Keys belonging to other exercises (`exIdx !== targetExIdx`) remain unchanged.
 * - For `targetExIdx`:
 *   - Old warm-up keys (`sIdx < priorWarmupCount`) are discarded/removed so they never leak into working sets.
 *   - Working set keys (`sIdx >= priorWarmupCount`) are shifted to their new position:
 *     newSetIdx = sIdx - priorWarmupCount + newWarmupCount.
 * - Handles zero -> N, N -> zero, N -> M, and same-count N -> N deterministically.
 * - Malformed keys or invalid parameters return a safe shallow copy.
 */
export function remapAfterWarmupChange<T>(
  record: Record<string, T>,
  targetExIdx: number,
  priorWarmupCount: number,
  newWarmupCount: number
): Record<string, T> {
  if (
    !record ||
    typeof targetExIdx !== 'number' ||
    isNaN(targetExIdx) ||
    typeof priorWarmupCount !== 'number' ||
    isNaN(priorWarmupCount) ||
    priorWarmupCount < 0 ||
    typeof newWarmupCount !== 'number' ||
    isNaN(newWarmupCount) ||
    newWarmupCount < 0
  ) {
    return { ...record };
  }

  const nextRecord: Record<string, T> = {};
  const shift = newWarmupCount - priorWarmupCount;

  for (const [key, val] of Object.entries(record)) {
    const parts = key.split('-');
    if (parts.length === 2) {
      const exIdx = parseInt(parts[0], 10);
      const sIdx = parseInt(parts[1], 10);
      if (isNaN(exIdx) || isNaN(sIdx) || exIdx !== targetExIdx) {
        nextRecord[key] = val;
      } else if (sIdx < priorWarmupCount) {
        // Discard old warmup keys
        continue;
      } else {
        // Shift working set key
        nextRecord[`${exIdx}-${sIdx + shift}`] = val;
      }
    } else {
      nextRecord[key] = val;
    }
  }
  return nextRecord;
}


