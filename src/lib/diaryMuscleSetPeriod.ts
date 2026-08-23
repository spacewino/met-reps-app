/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkoutLog, ExerciseEntry, SetEntry } from '../types';
import { getLocalDateString } from './dateUtils';
import { isSetValidForCompletion } from './setSkipRules';

export type DiaryMusclePeriod =
  | 'lifetime'
  | 'this_week'
  | 'this_month'
  | 'this_year';

export const DIARY_MUSCLE_PERIOD_SEQUENCE: readonly DiaryMusclePeriod[] = [
  'lifetime',
  'this_week',
  'this_month',
  'this_year',
] as const;

export const DIARY_MUSCLE_PERIOD_DISPLAY_NAMES: Record<DiaryMusclePeriod, string> = {
  lifetime: 'LIFETIME',
  this_week: 'THIS WEEK',
  this_month: 'THIS MONTH',
  this_year: 'THIS YEAR',
};

export const DIARY_MUSCLE_PERIOD_ACCESSIBLE_LABELS: Record<DiaryMusclePeriod, string> = {
  lifetime: 'Lifetime',
  this_week: 'This Week',
  this_month: 'This Month',
  this_year: 'This Year',
};

export const CANONICAL_DIARY_MUSCLE_GROUPS = [
  'Delts',
  'Traps',
  'Biceps',
  'Triceps',
  'Pecs',
  'Back',
  'Abs',
  'Quads',
  'Hams',
  'Calves',
  'Glutes',
  'Forearms',
] as const;

export type CanonicalDiaryMuscleGroup = (typeof CANONICAL_DIARY_MUSCLE_GROUPS)[number];

/**
 * Returns the next period in the strict sequence:
 * lifetime -> this_week -> this_month -> this_year -> lifetime
 */
export function getNextDiaryMusclePeriod(
  current: DiaryMusclePeriod
): DiaryMusclePeriod {
  const currentIndex = DIARY_MUSCLE_PERIOD_SEQUENCE.indexOf(current);
  if (currentIndex === -1) {
    return 'lifetime';
  }
  const nextIndex = (currentIndex + 1) % DIARY_MUSCLE_PERIOD_SEQUENCE.length;
  return DIARY_MUSCLE_PERIOD_SEQUENCE[nextIndex];
}

/**
 * Calculates the local calendar date boundaries [startDateStr, endDateStr]
 * for a given period in YYYY-MM-DD format based on the device's local calendar.
 *
 * Rules:
 * - lifetime: null boundaries (all logs included)
 * - this_year: Jan 1 of current year through today (now)
 * - this_month: 1st of current month through today (now)
 * - this_week: Monday of current week at local 00:00 through today (now)
 * - today is always included as the upper bound (endDateStr)
 */
export function getDiaryMusclePeriodRange(
  period: DiaryMusclePeriod,
  now: Date = new Date()
): {
  startDateStr: string | null;
  endDateStr: string | null;
} {
  if (period === 'lifetime') {
    return { startDateStr: null, endDateStr: null };
  }

  const todayStr = getLocalDateString(now);

  if (period === 'this_year') {
    const startYearStr = `${now.getFullYear()}-01-01`;
    return { startDateStr: startYearStr, endDateStr: todayStr };
  }

  if (period === 'this_month') {
    const year = now.getFullYear();
    const monthStr = String(now.getMonth() + 1).padStart(2, '0');
    const startMonthStr = `${year}-${monthStr}-01`;
    return { startDateStr: startMonthStr, endDateStr: todayStr };
  }

  // period === 'this_week' (Monday at local 00:00 through today)
  const dayOfWeek = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  const startWeekStr = getLocalDateString(monday);

  return { startDateStr: startWeekStr, endDateStr: todayStr };
}

/**
 * Pure predicate to test if a workout log falls inside the specified period.
 *
 * Rules:
 * - Lifetime: always true (does not require a valid date string).
 * - This Week / Month / Year:
 *   - Missing, null, undefined or malformed dates safely return false.
 *   - Dates strictly within [startDateStr, endDateStr] return true.
 *   - Future-dated logs (> todayStr) return false.
 */
export function isWorkoutLogInDiaryMusclePeriod(
  log: WorkoutLog,
  period: DiaryMusclePeriod,
  now: Date = new Date()
): boolean {
  if (period === 'lifetime') {
    return true;
  }

  if (!log || typeof log.date !== 'string') {
    return false;
  }

  const logDateStr = log.date.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDateStr)) {
    return false;
  }

  const { startDateStr, endDateStr } = getDiaryMusclePeriodRange(period, now);
  if (!startDateStr || !endDateStr) {
    return true;
  }

  return logDateStr >= startDateStr && logDateStr <= endDateStr;
}

/**
 * Normalizes raw muscle group string into one of the 12 canonical muscle group names.
 * Returns null if the muscle group is unmapped or missing.
 */
export function normalizeDiaryMuscleGroup(
  rawMg: string | null | undefined
): CanonicalDiaryMuscleGroup | null {
  if (!rawMg || typeof rawMg !== 'string') return null;
  const mg = rawMg.trim();
  if (/delt|shoulder/i.test(mg)) return 'Delts';
  if (/trap/i.test(mg)) return 'Traps';
  if (/bicep/i.test(mg)) return 'Biceps';
  if (/tricep/i.test(mg)) return 'Triceps';
  if (/chest|pec/i.test(mg)) return 'Pecs';
  if (/back|lat|rhomboid/i.test(mg)) return 'Back';
  if (/abs|core|abdominal/i.test(mg)) return 'Abs';
  if (/quad/i.test(mg)) return 'Quads';
  if (/ham|hamstring/i.test(mg)) return 'Hams';
  if (/calf|calves/i.test(mg)) return 'Calves';
  if (/glute/i.test(mg)) return 'Glutes';
  if (/forearm/i.test(mg)) return 'Forearms';
  return null;
}

/**
 * Checks if a parent set is eligible as a completed working set.
 *
 * Rules:
 * - Exercise is not skipped (isSkipped !== true)
 * - Set is not skipped (isSkipped !== true)
 * - Set is not warm-up (isWarmup !== true)
 * - Set is completed (isCompleted !== false; legacy undefined accepted)
 * - Performance satisfies modality-specific valid completion requirements
 * - Drop sub-sets do not increment parent set count
 */
export function isParentWorkingSetEligible(
  exercise: ExerciseEntry,
  set: SetEntry
): boolean {
  if (!exercise || !set) return false;
  if (exercise.isSkipped === true) return false;
  if (set.isSkipped === true) return false;
  if (set.isWarmup === true) return false;
  if (set.isCompleted === false) return false;
  return isSetValidForCompletion(set, exercise.modality);
}

/**
 * Generates aggregated muscle set stats for a specific period.
 *
 * Immutability:
 * - Pure and deterministic.
 * - Never mutates logs or nested arrays in place.
 *
 * Total calculation:
 * - totalSets counts every eligible parent working set across all logs in the period.
 * - Eligible sets from unmapped or custom muscle groups increment totalSets,
 *   even though they do not increment any of the 12 canonical grid buckets.
 */
export function generateDiaryMuscleSetStats(
  logs: WorkoutLog[],
  period: DiaryMusclePeriod,
  now: Date = new Date()
): {
  totalSets: number;
  muscleSets: Record<CanonicalDiaryMuscleGroup, number>;
} {
  const muscleSets: Record<CanonicalDiaryMuscleGroup, number> = {
    Delts: 0,
    Traps: 0,
    Biceps: 0,
    Triceps: 0,
    Pecs: 0,
    Back: 0,
    Abs: 0,
    Quads: 0,
    Hams: 0,
    Calves: 0,
    Glutes: 0,
    Forearms: 0,
  };

  let totalSets = 0;

  if (!Array.isArray(logs) || logs.length === 0) {
    return { totalSets: 0, muscleSets };
  }

  for (const log of logs) {
    if (!isWorkoutLogInDiaryMusclePeriod(log, period, now)) {
      continue;
    }

    const exercises = Array.isArray(log.exercises) ? log.exercises : [];
    for (const ex of exercises) {
      if (ex.isSkipped === true) continue;

      const mappedMg = normalizeDiaryMuscleGroup(ex.muscleGroup);
      const sets = Array.isArray(ex.sets) ? ex.sets : [];

      for (const set of sets) {
        if (!isParentWorkingSetEligible(ex, set)) continue;

        totalSets += 1;
        if (mappedMg !== null && mappedMg in muscleSets) {
          muscleSets[mappedMg] += 1;
        }
      }
    }
  }

  return {
    totalSets,
    muscleSets,
  };
}

/**
 * Generates an accessible aria-label for the period-cycle button.
 */
export function getDiaryMusclePeriodAriaLabel(
  current: DiaryMusclePeriod,
  next: DiaryMusclePeriod
): string {
  const currentLabel = DIARY_MUSCLE_PERIOD_ACCESSIBLE_LABELS[current];
  const nextLabel = DIARY_MUSCLE_PERIOD_ACCESSIBLE_LABELS[next];
  return `Muscle-set period: ${currentLabel}. Activate to show ${nextLabel}.`;
}
