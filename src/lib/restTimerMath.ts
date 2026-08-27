/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExerciseEntry, RestInterval, RestTimerStartContext } from '../types';

export const REST_TIMER_MAX_DURATION_SECONDS = 600;

/**
 * Evaluates whether an elapsed rest interval duration is eligible to be recorded.
 * - 1 to 599 seconds -> eligible (true)
 * - 0 or negative -> ineligible (false)
 * - 600 seconds or greater -> silently discarded (false)
 */
export function isValidRestIntervalDuration(durationSeconds: number): boolean {
  return typeof durationSeconds === 'number' && durationSeconds > 0 && durationSeconds < REST_TIMER_MAX_DURATION_SECONDS;
}

/**
 * Derives the 1-based setNumber of the most recently completed non-warmup,
 * non-skipped working set for an exercise. Returns null if none are completed.
 */
export function getLastCompletedWorkingSetNumber(
  exercise: ExerciseEntry,
  exIndex: number,
  checkedSets: Record<string, boolean> = {}
): number | null {
  if (!exercise || !exercise.sets || exercise.sets.length === 0) return null;

  for (let i = exercise.sets.length - 1; i >= 0; i--) {
    const s = exercise.sets[i];
    if (!s.isWarmup && !s.isSkipped) {
      const isCompleted = checkedSets[`${exIndex}-${i}`] === true || s.isCompleted === true;
      if (isCompleted) {
        return s.setNumber;
      }
    }
  }
  return null;
}

/**
 * Creates a valid completed RestInterval if duration is within (0, 600) seconds.
 * Returns null if duration is <= 0 or >= 600 (silent discard).
 */
export function createRestInterval(params: {
  durationSeconds: number;
  startContext?: RestTimerStartContext | null;
  startTime?: number | null;
}): RestInterval | null {
  const { durationSeconds, startContext, startTime } = params;
  const flooredDuration = Math.floor(durationSeconds);

  if (!isValidRestIntervalDuration(flooredDuration)) {
    return null;
  }

  const source = startContext?.source || 'footer';
  const startedAt = startContext?.startedAt || (startTime ? new Date(startTime).toISOString() : new Date().toISOString());

  const interval: RestInterval = {
    durationSeconds: flooredDuration,
    source,
    startedAt,
  };

  if (startContext?.exerciseName) {
    interval.exerciseName = startContext.exerciseName;
  }
  if (startContext?.exerciseIndex !== undefined && startContext?.exerciseIndex !== null) {
    interval.exerciseIndex = startContext.exerciseIndex;
  }
  if (startContext?.setNumber !== undefined && startContext?.setNumber !== null) {
    interval.setNumber = startContext.setNumber;
  }

  return interval;
}

/**
 * Safely parses serialized RestTimerStartContext from localStorage.
 */
export function parseRestStartContext(raw: string | null): RestTimerStartContext | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.source === 'exercise_header' || parsed.source === 'footer')) {
      return parsed as RestTimerStartContext;
    }
    return null;
  } catch {
    return null;
  }
}
