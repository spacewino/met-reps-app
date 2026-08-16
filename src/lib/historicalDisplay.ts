/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SetEntry } from '../types';

export interface HistoricalSetDisplayState {
  /** Whether the "Skipped" badge should be displayed for this set */
  showSkippedBadge: boolean;
  /** Whether the set is marked as skipped */
  isSkipped: boolean;
  /** Whether the set is a warmup */
  isWarmup: boolean;
  /** Whether the set is a drop set */
  isDropSet: boolean;
  /** Weight value to display (remains unmutated target if skipped) */
  weight: number;
  /** Reps value to display (remains unmutated target if skipped) */
  reps: number;
  /** RPE value to display */
  rpe: number | string;
  /** Form note (e.g. 'strict', 'standard', 'loose') if present */
  form?: 'strict' | 'standard' | 'loose' | null;
  /** Set-level comment note if present */
  comment?: string | null;
  /** Whether row styling should be visually muted */
  isRowMuted: boolean;
}

/**
 * Pure display status helper for historical set rows in diary/logbook.
 * Strictly read-only: does not mutate the input SetEntry or WorkoutLog.
 *
 * @param set The set entry from a historical workout log
 * @param isExerciseSkipped Optional flag if the parent exercise is already marked skipped
 */
export function getHistoricalSetDisplayState(
  set: Readonly<SetEntry>,
  isExerciseSkipped: boolean = false
): HistoricalSetDisplayState {
  const isSkipped = set.isSkipped === true;
  // Show skipped badge on set if set is skipped and the entire exercise is not already marked skipped
  const showSkippedBadge = isSkipped && !isExerciseSkipped;

  return {
    showSkippedBadge,
    isSkipped,
    isWarmup: !!set.isWarmup,
    isDropSet: !!set.isDropSet,
    weight: set.weight ?? 0,
    reps: set.reps ?? 0,
    rpe: set.rpe !== undefined && set.rpe !== null ? set.rpe : '—',
    form: set.form,
    comment: set.comment,
    isRowMuted: isSkipped || isExerciseSkipped,
  };
}
