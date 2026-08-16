/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExerciseEntry, SetEntry } from '../types';

/**
 * Format exercise index and set index into a coordinate string key: "exIdx-setIdx".
 */
export function formatGuideRowKey(exIdx: number, setIdx: number): string {
  return `${exIdx}-${setIdx}`;
}

/**
 * Parse coordinate string key into exercise index and set index.
 */
export function parseGuideRowKey(key: string | null | undefined): { exIdx: number; setIdx: number } | null {
  if (!key || typeof key !== 'string') return null;
  const parts = key.split('-');
  if (parts.length !== 2) return null;
  const exIdx = Number(parts[0]);
  const setIdx = Number(parts[1]);
  if (isNaN(exIdx) || isNaN(setIdx) || exIdx < 0 || setIdx < 0) return null;
  return { exIdx, setIdx };
}

/**
 * Determine if a specific exercise row is eligible for the Current Working Set Guide.
 * 
 * Rules:
 * - Exercise must exist and not be skipped (exercise.isSkipped !== true)
 * - Set must exist and not be skipped (set.isSkipped !== true)
 * - Set must NOT be a warmup (set.isWarmup !== true)
 * - All modalities (weighted, bodyweight, assisted, timed, distance, distance_loaded, undefined) are eligible.
 */
export function isRowEligibleForGuide(exercise: ExerciseEntry | undefined, set: SetEntry | undefined): boolean {
  if (!exercise || !set) return false;
  if (exercise.isSkipped === true) return false;
  if (set.isSkipped === true) return false;
  if (set.isWarmup === true) return false;
  return true;
}

/**
 * Check whether a guide key represents an existing and eligible working row in the exercises list.
 */
export function isGuideKeyValidAndEligible(exercises: ExerciseEntry[], key: string | null | undefined): boolean {
  const parsed = parseGuideRowKey(key);
  if (!parsed) return false;
  const { exIdx, setIdx } = parsed;
  const ex = exercises[exIdx];
  if (!ex) return false;
  const set = ex.sets?.[setIdx];
  if (!set) return false;
  return isRowEligibleForGuide(ex, set);
}

/**
 * Collect all eligible working rows across the workout in chronological order.
 */
export function getAllEligibleGuideRows(exercises: ExerciseEntry[]): Array<{ exIdx: number; setIdx: number; key: string }> {
  const rows: Array<{ exIdx: number; setIdx: number; key: string }> = [];
  if (!exercises || !Array.isArray(exercises)) return rows;

  for (let exIdx = 0; exIdx < exercises.length; exIdx++) {
    const ex = exercises[exIdx];
    if (ex.isSkipped === true || !ex.sets) continue;
    for (let setIdx = 0; setIdx < ex.sets.length; setIdx++) {
      const set = ex.sets[setIdx];
      if (isRowEligibleForGuide(ex, set)) {
        rows.push({ exIdx, setIdx, key: formatGuideRowKey(exIdx, setIdx) });
      }
    }
  }
  return rows;
}

/**
 * Find the first eligible working row in the workout.
 */
export function findFirstEligibleGuideRow(exercises: ExerciseEntry[]): { exIdx: number; setIdx: number; key: string } | null {
  const rows = getAllEligibleGuideRows(exercises);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Find the next eligible working row following a current guide position across the workout.
 * Supports either (exercises, currentKey) or (exercises, exIdx, setIdx).
 * If currentKey is null/undefined, finds the first eligible row.
 * If no subsequent eligible row exists, returns null (workout completed / end of sets).
 */
export function findNextEligibleGuideRow(
  exercises: ExerciseEntry[],
  currentKeyOrExIdx: string | number | null,
  setIdxParam?: number
): string | null {
  if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
    return null;
  }

  let curExIdx: number | null = null;
  let curSetIdx: number | null = null;

  if (typeof currentKeyOrExIdx === 'number' && typeof setIdxParam === 'number') {
    curExIdx = currentKeyOrExIdx;
    curSetIdx = setIdxParam;
  } else if (typeof currentKeyOrExIdx === 'string') {
    const parsed = parseGuideRowKey(currentKeyOrExIdx);
    if (parsed) {
      curExIdx = parsed.exIdx;
      curSetIdx = parsed.setIdx;
    }
  }

  if (curExIdx === null || curSetIdx === null) {
    return findFirstEligibleGuideRow(exercises)?.key ?? null;
  }

  // 1. Search remaining sets in the current exercise
  const currentEx = exercises[curExIdx];
  if (currentEx && currentEx.isSkipped !== true && currentEx.sets) {
    for (let sIdx = curSetIdx + 1; sIdx < currentEx.sets.length; sIdx++) {
      const set = currentEx.sets[sIdx];
      if (isRowEligibleForGuide(currentEx, set)) {
        return formatGuideRowKey(curExIdx, sIdx);
      }
    }
  }

  // 2. Search subsequent exercises in order
  for (let nextExIdx = curExIdx + 1; nextExIdx < exercises.length; nextExIdx++) {
    const ex = exercises[nextExIdx];
    if (ex.isSkipped === true || !ex.sets) continue;
    for (let sIdx = 0; sIdx < ex.sets.length; sIdx++) {
      const set = ex.sets[sIdx];
      if (isRowEligibleForGuide(ex, set)) {
        return formatGuideRowKey(nextExIdx, sIdx);
      }
    }
  }

  // No subsequent eligible row exists in the workout
  return null;
}

/**
 * Recover or find the closest fallback eligible row given a preferred exercise and set index.
 */
export function findFallbackEligibleGuideRow(
  exercises: ExerciseEntry[],
  preferredExIdx: number,
  preferredSetIdx: number
): string | null {
  if (!exercises || exercises.length === 0) return null;

  // First search forward from preferred position
  const ex = exercises[preferredExIdx];
  if (ex && ex.isSkipped !== true && ex.sets) {
    for (let sIdx = preferredSetIdx; sIdx < ex.sets.length; sIdx++) {
      if (isRowEligibleForGuide(ex, ex.sets[sIdx])) {
        return formatGuideRowKey(preferredExIdx, sIdx);
      }
    }
  }
  for (let nextExIdx = preferredExIdx + 1; nextExIdx < exercises.length; nextExIdx++) {
    const nextEx = exercises[nextExIdx];
    if (nextEx.isSkipped === true || !nextEx.sets) continue;
    for (let sIdx = 0; sIdx < nextEx.sets.length; sIdx++) {
      if (isRowEligibleForGuide(nextEx, nextEx.sets[sIdx])) {
        return formatGuideRowKey(nextExIdx, sIdx);
      }
    }
  }

  // If none forward, search backward
  if (ex && ex.isSkipped !== true && ex.sets) {
    for (let sIdx = Math.min(preferredSetIdx - 1, ex.sets.length - 1); sIdx >= 0; sIdx--) {
      if (isRowEligibleForGuide(ex, ex.sets[sIdx])) {
        return formatGuideRowKey(preferredExIdx, sIdx);
      }
    }
  }
  for (let prevExIdx = preferredExIdx - 1; prevExIdx >= 0; prevExIdx--) {
    const prevEx = exercises[prevExIdx];
    if (prevEx.isSkipped === true || !prevEx.sets) continue;
    for (let sIdx = prevEx.sets.length - 1; sIdx >= 0; sIdx--) {
      if (isRowEligibleForGuide(prevEx, prevEx.sets[sIdx])) {
        return formatGuideRowKey(prevExIdx, sIdx);
      }
    }
  }

  return null;
}

/**
 * Reconcile guide key after deleting a set.
 */
export function reconcileGuideAfterSetDelete(
  currentKey: string | null,
  exIdx: number,
  deletedSetIdx: number,
  exercisesAfterDelete: ExerciseEntry[]
): string | null {
  if (currentKey === null) return null;
  const parsed = parseGuideRowKey(currentKey);
  if (!parsed) return findFirstEligibleGuideRow(exercisesAfterDelete)?.key ?? null;

  const { exIdx: keyExIdx, setIdx: keySetIdx } = parsed;

  if (keyExIdx !== exIdx) {
    // Guide was in a different exercise
    return isGuideKeyValidAndEligible(exercisesAfterDelete, currentKey)
      ? currentKey
      : findFallbackEligibleGuideRow(exercisesAfterDelete, keyExIdx, keySetIdx);
  }

  if (keySetIdx < deletedSetIdx) {
    // Guide was before deleted set in same exercise
    return isGuideKeyValidAndEligible(exercisesAfterDelete, currentKey)
      ? currentKey
      : findFallbackEligibleGuideRow(exercisesAfterDelete, exIdx, keySetIdx);
  }

  if (keySetIdx === deletedSetIdx) {
    // Guide was ON deleted set -> recover to next eligible row at same position or after
    return findFallbackEligibleGuideRow(exercisesAfterDelete, exIdx, deletedSetIdx);
  }

  // keySetIdx > deletedSetIdx -> shift set index down by 1
  const shiftedKey = formatGuideRowKey(exIdx, keySetIdx - 1);
  return isGuideKeyValidAndEligible(exercisesAfterDelete, shiftedKey)
    ? shiftedKey
    : findFallbackEligibleGuideRow(exercisesAfterDelete, exIdx, keySetIdx - 1);
}

/**
 * Reconcile guide key after deleting an exercise.
 */
export function reconcileGuideAfterExerciseDelete(
  currentKey: string | null,
  deletedExIdx: number,
  exercisesAfterDelete: ExerciseEntry[]
): string | null {
  if (currentKey === null) return null;
  const parsed = parseGuideRowKey(currentKey);
  if (!parsed) return findFirstEligibleGuideRow(exercisesAfterDelete)?.key ?? null;

  const { exIdx: keyExIdx, setIdx: keySetIdx } = parsed;

  if (keyExIdx < deletedExIdx) {
    return isGuideKeyValidAndEligible(exercisesAfterDelete, currentKey)
      ? currentKey
      : findFallbackEligibleGuideRow(exercisesAfterDelete, keyExIdx, keySetIdx);
  }

  if (keyExIdx === deletedExIdx) {
    // Guide was in deleted exercise -> advance to next available in exercisesAfterDelete
    return findFallbackEligibleGuideRow(exercisesAfterDelete, deletedExIdx, 0);
  }

  // keyExIdx > deletedExIdx -> shift exercise index down by 1
  const shiftedKey = formatGuideRowKey(keyExIdx - 1, keySetIdx);
  return isGuideKeyValidAndEligible(exercisesAfterDelete, shiftedKey)
    ? shiftedKey
    : findFallbackEligibleGuideRow(exercisesAfterDelete, keyExIdx - 1, keySetIdx);
}

/**
 * Reconcile guide key after toggling skip on a set.
 */
export function reconcileGuideAfterSetSkip(
  currentKey: string | null,
  exIdx: number,
  setIdx: number,
  arg3: boolean | ExerciseEntry[],
  arg4?: ExerciseEntry[]
): string | null {
  if (currentKey === null) return null;
  const exercises = Array.isArray(arg3) ? arg3 : (arg4 || []);
  const parsed = parseGuideRowKey(currentKey);
  if (!parsed) return exercises.length > 0 ? findFirstEligibleGuideRow(exercises)?.key ?? null : null;

  if (parsed.exIdx === exIdx && parsed.setIdx === setIdx) {
    // Current guided set was skipped -> advance to next eligible row
    return findNextEligibleGuideRow(exercises, currentKey) ?? findFallbackEligibleGuideRow(exercises, exIdx, setIdx);
  }

  return isGuideKeyValidAndEligible(exercises, currentKey)
    ? currentKey
    : findFallbackEligibleGuideRow(exercises, parsed.exIdx, parsed.setIdx);
}

/**
 * Reconcile guide key after toggling skip on an exercise.
 */
export function reconcileGuideAfterExerciseSkip(
  currentKey: string | null,
  skippedExIdx: number,
  arg2: boolean | ExerciseEntry[],
  arg3?: ExerciseEntry[]
): string | null {
  if (currentKey === null) return null;
  const exercises = Array.isArray(arg2) ? arg2 : (arg3 || []);
  const parsed = parseGuideRowKey(currentKey);
  if (!parsed) return exercises.length > 0 ? findFirstEligibleGuideRow(exercises)?.key ?? null : null;

  if (parsed.exIdx === skippedExIdx) {
    // Exercise containing guide was skipped -> advance to next eligible row in subsequent exercises
    for (let nextExIdx = skippedExIdx + 1; nextExIdx < exercises.length; nextExIdx++) {
      const nextEx = exercises[nextExIdx];
      if (nextEx.isSkipped === true || !nextEx.sets) continue;
      for (let sIdx = 0; sIdx < nextEx.sets.length; sIdx++) {
        if (isRowEligibleForGuide(nextEx, nextEx.sets[sIdx])) {
          return formatGuideRowKey(nextExIdx, sIdx);
        }
      }
    }
    // If none forward, look backward before skippedExIdx
    for (let prevExIdx = skippedExIdx - 1; prevExIdx >= 0; prevExIdx--) {
      const prevEx = exercises[prevExIdx];
      if (prevEx.isSkipped === true || !prevEx.sets) continue;
      for (let sIdx = prevEx.sets.length - 1; sIdx >= 0; sIdx--) {
        if (isRowEligibleForGuide(prevEx, prevEx.sets[sIdx])) {
          return formatGuideRowKey(prevExIdx, sIdx);
        }
      }
    }
    return null;
  }

  return isGuideKeyValidAndEligible(exercises, currentKey)
    ? currentKey
    : findFallbackEligibleGuideRow(exercises, parsed.exIdx, parsed.setIdx);
}

/**
 * Reconcile guide key after moving an exercise.
 */
export function reconcileGuideAfterExerciseMove(
  currentKey: string | null,
  fromExIdx: number,
  toExIdx: number,
  exercisesAfterMove?: ExerciseEntry[]
): string | null {
  if (currentKey === null) return null;
  const parsed = parseGuideRowKey(currentKey);
  if (!parsed) return exercisesAfterMove ? findFirstEligibleGuideRow(exercisesAfterMove)?.key ?? null : null;

  const { exIdx: keyExIdx, setIdx: keySetIdx } = parsed;

  let newExIdx = keyExIdx;
  if (keyExIdx === fromExIdx) {
    newExIdx = toExIdx;
  } else if (fromExIdx < toExIdx) {
    if (keyExIdx > fromExIdx && keyExIdx <= toExIdx) {
      newExIdx = keyExIdx - 1;
    }
  } else if (fromExIdx > toExIdx) {
    if (keyExIdx >= toExIdx && keyExIdx < fromExIdx) {
      newExIdx = keyExIdx + 1;
    }
  }

  const remappedKey = formatGuideRowKey(newExIdx, keySetIdx);
  if (!exercisesAfterMove) return remappedKey;
  return isGuideKeyValidAndEligible(exercisesAfterMove, remappedKey)
    ? remappedKey
    : findFallbackEligibleGuideRow(exercisesAfterMove, newExIdx, keySetIdx);
}

/**
 * Reconcile guide key after warm-ups are generated, regenerated, or modified for an exercise.
 * Preserves attachment to the same logical working-set ordinal.
 */
export function reconcileGuideAfterWarmupChange(
  currentKey: string | null,
  exIdx: number,
  setsBefore: SetEntry[],
  setsAfter: SetEntry[]
): string | null {
  if (currentKey === null) return null;
  const parsed = parseGuideRowKey(currentKey);
  if (!parsed) return null;

  const { exIdx: keyExIdx, setIdx: keySetIdx } = parsed;
  if (keyExIdx !== exIdx) {
    // Guide belongs to a different exercise -> leave unchanged
    return currentKey;
  }

  // Count which working-set ordinal (0-based) keySetIdx corresponds to in setsBefore
  let workingOrdinal = -1;
  let currentWorkingCount = 0;
  for (let i = 0; i < setsBefore.length; i++) {
    const s = setsBefore[i];
    if (s.isWarmup !== true) {
      if (i === keySetIdx) {
        workingOrdinal = currentWorkingCount;
        break;
      }
      currentWorkingCount++;
    }
  }

  if (workingOrdinal === -1) {
    // The previous set was a warmup or out of range -> find first working set in setsAfter
    let firstWorkingAfterIdx = -1;
    for (let i = 0; i < setsAfter.length; i++) {
      if (setsAfter[i].isWarmup !== true && setsAfter[i].isSkipped !== true) {
        firstWorkingAfterIdx = i;
        break;
      }
    }
    return firstWorkingAfterIdx !== -1 ? formatGuideRowKey(exIdx, firstWorkingAfterIdx) : null;
  }

  // Find the set in setsAfter that matches workingOrdinal
  let targetWorkingCount = 0;
  for (let i = 0; i < setsAfter.length; i++) {
    const s = setsAfter[i];
    if (s.isWarmup !== true) {
      if (targetWorkingCount === workingOrdinal) {
        return formatGuideRowKey(exIdx, i);
      }
      targetWorkingCount++;
    }
  }

  // If workingOrdinal exceeded the available working sets in setsAfter, fallback to first eligible working set or null
  for (let i = 0; i < setsAfter.length; i++) {
    if (setsAfter[i].isWarmup !== true && setsAfter[i].isSkipped !== true) {
      return formatGuideRowKey(exIdx, i);
    }
  }
  return null;
}

/**
 * Reconcile guide key after an exercise is replaced.
 */
export function reconcileGuideAfterExerciseReplace(
  currentKey: string | null,
  replacedExIdx: number,
  exercisesAfterReplace: ExerciseEntry[]
): string | null {
  if (currentKey === null) return null;
  const parsed = parseGuideRowKey(currentKey);
  if (!parsed) return null;

  const { exIdx: keyExIdx } = parsed;
  if (keyExIdx !== replacedExIdx) {
    // Guide was in another exercise -> preserve current key
    return isGuideKeyValidAndEligible(exercisesAfterReplace, currentKey)
      ? currentKey
      : findFallbackEligibleGuideRow(exercisesAfterReplace, keyExIdx, parsed.setIdx);
  }

  // Replaced exercise was highlighted -> move to first eligible working set in replacement exercise
  const replacedEx = exercisesAfterReplace[replacedExIdx];
  if (replacedEx && replacedEx.isSkipped !== true && replacedEx.sets) {
    for (let sIdx = 0; sIdx < replacedEx.sets.length; sIdx++) {
      if (isRowEligibleForGuide(replacedEx, replacedEx.sets[sIdx])) {
        return formatGuideRowKey(replacedExIdx, sIdx);
      }
    }
  }

  // If no eligible sets in replacement exercise, advance or find fallback
  return null;
}

/**
 * Reconcile guide key after moving a set within an exercise.
 */
export function reconcileGuideAfterSetMove(
  currentKey: string | null,
  exIdx: number,
  fromSetIdx: number,
  toSetIdx: number,
  exercisesAfterMove?: ExerciseEntry[]
): string | null {
  if (currentKey === null) return null;
  const parsed = parseGuideRowKey(currentKey);
  if (!parsed) return exercisesAfterMove ? findFirstEligibleGuideRow(exercisesAfterMove)?.key ?? null : null;

  const { exIdx: keyExIdx, setIdx: keySetIdx } = parsed;

  if (keyExIdx !== exIdx) {
    if (!exercisesAfterMove) return currentKey;
    return isGuideKeyValidAndEligible(exercisesAfterMove, currentKey)
      ? currentKey
      : findFallbackEligibleGuideRow(exercisesAfterMove, keyExIdx, keySetIdx);
  }

  let newSetIdx = keySetIdx;
  if (keySetIdx === fromSetIdx) {
    newSetIdx = toSetIdx;
  } else if (fromSetIdx < toSetIdx) {
    if (keySetIdx > fromSetIdx && keySetIdx <= toSetIdx) {
      newSetIdx = keySetIdx - 1;
    }
  } else if (fromSetIdx > toSetIdx) {
    if (keySetIdx >= toSetIdx && keySetIdx < fromSetIdx) {
      newSetIdx = keySetIdx + 1;
    }
  }

  const remappedKey = formatGuideRowKey(exIdx, newSetIdx);
  if (!exercisesAfterMove) return remappedKey;
  return isGuideKeyValidAndEligible(exercisesAfterMove, remappedKey)
    ? remappedKey
    : findFallbackEligibleGuideRow(exercisesAfterMove, exIdx, newSetIdx);
}

/**
 * Resolve the initial guide key from draft or exercises.
 * 
 * Distinct handling:
 * - If draft explicitly contains 'currentSetGuideKey' property:
 *   - If value is null -> preserves null (user intentionally reached end or cleared guide).
 *   - If value is string -> validates and restores it (reconciling if necessary).
 * - If draft does NOT have 'currentSetGuideKey' (new workout or legacy draft):
 *   - Initializes to first eligible working set row.
 */
export function resolveInitialGuideKey(
  draft: any,
  exercises: ExerciseEntry[]
): string | null {
  if (draft && typeof draft === 'object' && 'currentSetGuideKey' in draft) {
    if (draft.currentSetGuideKey === null) {
      return null;
    }
    if (typeof draft.currentSetGuideKey === 'string') {
      if (isGuideKeyValidAndEligible(exercises, draft.currentSetGuideKey)) {
        return draft.currentSetGuideKey;
      }
      const parsed = parseGuideRowKey(draft.currentSetGuideKey);
      if (parsed) {
        return findFallbackEligibleGuideRow(exercises, parsed.exIdx, parsed.setIdx);
      }
    }
  }

  return findFirstEligibleGuideRow(exercises)?.key ?? null;
}
