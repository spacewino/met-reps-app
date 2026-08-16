/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExerciseEntry, SetEntry } from '../types';

/**
 * Returns the 0-based indices of all working sets (excluding warm-up sets).
 */
export function getWorkingSetIndices(sets: SetEntry[]): number[] {
  if (!Array.isArray(sets)) return [];
  const indices: number[] = [];
  for (let i = 0; i < sets.length; i++) {
    if (sets[i] && sets[i].isWarmup !== true) {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Returns the 0-based index of the final active (non-skipped) working set in the sets array.
 * If all working sets are skipped or if there are no working sets, returns null.
 */
export function getFinalActiveWorkingSetIndex(sets: SetEntry[]): number | null {
  const workingIndices = getWorkingSetIndices(sets);
  if (workingIndices.length === 0) return null;

  for (let i = workingIndices.length - 1; i >= 0; i--) {
    const idx = workingIndices[i];
    if (sets[idx].isSkipped !== true) {
      return idx;
    }
  }
  return null;
}

/**
 * Returns the 0-based index of the first skipped working set in the suffix.
 * If no working sets are skipped, returns null.
 */
export function getFirstSkippedWorkingSetIndex(sets: SetEntry[]): number | null {
  const workingIndices = getWorkingSetIndices(sets);
  if (workingIndices.length === 0) return null;

  for (let i = 0; i < workingIndices.length; i++) {
    const idx = workingIndices[i];
    if (sets[idx].isSkipped === true) {
      return idx;
    }
  }
  return null;
}

/**
 * Validates that all skipped working sets form a contiguous suffix at the end of the exercise.
 * That is, once a working set is skipped, no subsequent active (non-skipped) working set is allowed.
 * Warm-up sets do not consume working-set ordinals and do not interfere with this invariant.
 */
export function isValidSkippedSuffix(sets: SetEntry[]): boolean {
  const workingIndices = getWorkingSetIndices(sets);
  if (workingIndices.length === 0) return true;

  let seenSkipped = false;
  for (const idx of workingIndices) {
    const s = sets[idx];
    if (s.isSkipped === true) {
      seenSkipped = true;
    } else {
      // Found an active working set after a skipped working set -> invalid gap
      if (seenSkipped) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Checks if any working set in the exercise is currently skipped.
 */
export function hasSkippedWorkingSets(sets: SetEntry[]): boolean {
  const workingIndices = getWorkingSetIndices(sets);
  return workingIndices.some(idx => sets[idx]?.isSkipped === true);
}

export interface SkipPermissionResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Determines whether a specific set can be skipped under the contiguous suffix rule.
 * 1. Warm-up sets cannot be skipped.
 * 2. Already-skipped sets cannot be skipped again.
 * 3. If an invalid suffix already exists (e.g. from restored/corrupted state), requires repairing first.
 * 4. Only the final active working set may be skipped.
 */
export function canSkipSet(sets: SetEntry[], setIndex: number): SkipPermissionResult {
  if (!Array.isArray(sets) || setIndex < 0 || setIndex >= sets.length) {
    return { allowed: false, reason: 'Invalid set index.' };
  }

  const set = sets[setIndex];
  if (set.isWarmup === true) {
    return { allowed: false, reason: 'Warm-up sets cannot be skipped.' };
  }

  if (set.isSkipped === true) {
    return { allowed: false, reason: 'Set is already skipped.' };
  }

  if (!isValidSkippedSuffix(sets)) {
    return { allowed: false, reason: 'Non-contiguous skipped sets detected. Repair sequence first.' };
  }

  const finalActiveIdx = getFinalActiveWorkingSetIndex(sets);
  if (finalActiveIdx === null) {
    return { allowed: false, reason: 'No active working sets remain to skip.' };
  }

  if (setIndex === finalActiveIdx) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'Skip later working sets first.' };
}

/**
 * Determines whether a specific set can be unskipped under the contiguous suffix rule.
 * 1. Warm-up sets cannot be unskipped.
 * 2. Active sets cannot be unskipped.
 * 3. In a valid suffix, only the first skipped working set (the one immediately following the active prefix)
 *    may be unskipped.
 * 4. In an invalid non-contiguous state, any skipped set may be unskipped to help the user repair the state.
 */
export function canUnskipSet(sets: SetEntry[], setIndex: number): SkipPermissionResult {
  if (!Array.isArray(sets) || setIndex < 0 || setIndex >= sets.length) {
    return { allowed: false, reason: 'Invalid set index.' };
  }

  const set = sets[setIndex];
  if (set.isWarmup === true) {
    return { allowed: false, reason: 'Warm-up sets cannot be skipped or unskipped.' };
  }

  if (set.isSkipped !== true) {
    return { allowed: false, reason: 'Set is not skipped.' };
  }

  // If in a non-contiguous state, allow unskipping to restore contiguous invariant
  if (!isValidSkippedSuffix(sets)) {
    return { allowed: true };
  }

  const firstSkippedIdx = getFirstSkippedWorkingSetIndex(sets);
  if (setIndex === firstSkippedIdx) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'Unskip earlier skipped sets first.' };
}

/**
 * Validates whether a set has valid, positive performance values based on modality.
 * Missing RPE is permitted and uses established fallback rules.
 */
export function isSetValidForCompletion(
  set: SetEntry,
  modality?: ExerciseEntry['modality']
): boolean {
  if (!set || set.isSkipped === true) {
    return false;
  }

  const mod = modality || 'weighted';

  switch (mod) {
    case 'timed': {
      // Timed modality: seconds recorded in weight property (> 0)
      const sec = set.weight;
      return typeof sec === 'number' && Number.isFinite(sec) && sec > 0;
    }

    case 'distance': {
      // Distance modality: meters recorded in reps property (> 0)
      const meters = set.reps;
      return typeof meters === 'number' && Number.isFinite(meters) && meters > 0;
    }

    case 'bodyweight': {
      // Bodyweight modality: reps must be positive (> 0); weight can be null/undefined/0/positive
      const reps = set.reps;
      return typeof reps === 'number' && Number.isFinite(reps) && reps > 0;
    }

    case 'assisted': {
      // Assisted modality: reps must be positive (> 0); assist weight can be 0 or positive
      const reps = set.reps;
      return typeof reps === 'number' && Number.isFinite(reps) && reps > 0;
    }

    case 'distance_loaded': {
      // Loaded distance: weight (> 0) and distance meters in reps (> 0)
      const w = set.weight;
      const m = set.reps;
      return (
        typeof w === 'number' &&
        Number.isFinite(w) &&
        w > 0 &&
        typeof m === 'number' &&
        Number.isFinite(m) &&
        m > 0
      );
    }

    case 'weighted':
    default: {
      // Weighted modality: weight (> 0) and reps (> 0)
      const w = set.weight;
      const r = set.reps;
      return (
        typeof w === 'number' &&
        Number.isFinite(w) &&
        w > 0 &&
        typeof r === 'number' &&
        Number.isFinite(r) &&
        r > 0
      );
    }
  }
}
