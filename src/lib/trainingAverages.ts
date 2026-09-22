/** Read-only, week-by-week aggregation for the Trends screen. */
import { WorkoutLog } from '../types';
import { getLocalDateString, parseLocalDate } from './dateUtils';
import { isParentWorkingSetEligible, normalizeDiaryMuscleGroup } from './diaryMuscleSetPeriod';

export const SELECTABLE_MUSCLE_GROUPS = [
  'Delts', 'Traps', 'Biceps', 'Triceps', 'Pecs', 'Back', 'Abs', 'Quads',
  'Hamstrings', 'Calves', 'Glutes', 'Forearms', 'Conditioning',
] as const;
export const RESISTANCE_MUSCLE_GROUPS = SELECTABLE_MUSCLE_GROUPS.filter(m => m !== 'Conditioning');
export type ResistanceMuscleGroup = (typeof RESISTANCE_MUSCLE_GROUPS)[number] | 'Other';

export interface AverageObservation { average: number | null; count: number }
export interface WeeklyTrainingSummary {
  weekStart: string;
  weekEnd: string;
  isCurrentWeek: boolean;
  workouts: number;
  totalDurationMinutes: number | null;
  durationCount: number;
  averageDurationMinutes: number | null;
  resistanceWorkingSets: number;
  setsByMuscle: Record<ResistanceMuscleGroup, number>;
  sleep: AverageObservation;
  calories: AverageObservation;
  hydration: AverageObservation;
  soreness: AverageObservation;
  workoutQuality: AverageObservation;
  workingSetRpe: AverageObservation;
}

export interface TrainingWeekOptions { weeks: 4 | 8 | 12; windowOffset?: number; now?: Date }

const DAY_MS = 86_400_000;
const validNumber = (value: unknown, min: number, max = Infinity): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function mondayOf(date: Date): Date {
  const day = date.getDay();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (day === 0 ? 6 : day - 1));
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
function validLocalDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const raw = value.trim();
  const parsed = parseLocalDate(raw);
  return getLocalDateString(parsed) === raw ? parsed : null;
}
function blankWeek(start: Date, currentMonday: string): WeeklyTrainingSummary {
  const sets = Object.fromEntries([...RESISTANCE_MUSCLE_GROUPS, 'Other'].map(m => [m, 0])) as Record<ResistanceMuscleGroup, number>;
  const empty = (): AverageObservation => ({ average: null, count: 0 });
  return {
    weekStart: getLocalDateString(start), weekEnd: getLocalDateString(addDays(start, 6)),
    isCurrentWeek: getLocalDateString(start) === currentMonday, workouts: 0,
    totalDurationMinutes: null, durationCount: 0, averageDurationMinutes: null,
    resistanceWorkingSets: 0, setsByMuscle: sets,
    sleep: empty(), calories: empty(), hydration: empty(), soreness: empty(),
    workoutQuality: empty(), workingSetRpe: empty(),
  };
}
function addObservation(target: AverageObservation, value: unknown, min: number, max = Infinity) {
  if (!validNumber(value, min, max)) return;
  target.average = (target.average ?? 0) + value;
  target.count++;
}
function hydrationScore(recovery: WorkoutLog['recovery']): number | null {
  const labels: Record<string, number> = { Dehydrated: 1, 'Under-hydrated': 2, Adequate: 3, Optimal: 4 };
  if (recovery?.hydrationLevel && labels[recovery.hydrationLevel]) return labels[recovery.hydrationLevel];
  const liters = recovery?.hydrationLiters;
  if (!validNumber(liters, 0)) return null;
  return liters < 1.5 ? 1 : liters < 2.2 ? 2 : liters < 3.2 ? 3 : 4;
}

/** O(logs + exercises + sets), deterministic, and never mutates its inputs. */
export function aggregateTrainingWeeks(
  readonlyLogs: readonly WorkoutLog[],
  { weeks, windowOffset = 0, now = new Date() }: TrainingWeekOptions,
): WeeklyTrainingSummary[] {
  const currentMonday = mondayOf(now);
  const endMonday = addDays(currentMonday, -Math.max(0, windowOffset) * weeks * 7);
  const firstMonday = addDays(endMonday, -(weeks - 1) * 7);
  const output = Array.from({ length: weeks }, (_, i) => blankWeek(addDays(firstMonday, i * 7), getLocalDateString(currentMonday)));
  const byKey = new Map(output.map(w => [w.weekStart, w]));
  const today = getLocalDateString(now);

  for (const log of readonlyLogs || []) {
    const date = validLocalDate(log?.date);
    if (!date || getLocalDateString(date) > today) continue;
    const week = byKey.get(getLocalDateString(mondayOf(date)));
    if (!week) continue;
    week.workouts++;
    if (validNumber(log.durationMinutes, Number.MIN_VALUE)) {
      week.totalDurationMinutes = (week.totalDurationMinutes ?? 0) + log.durationMinutes;
      week.durationCount++;
    }
    addObservation(week.sleep, log.recovery?.sleepHours, 0);
    addObservation(week.calories, log.recovery?.nutritionCalories, 0);
    addObservation(week.soreness, log.recovery?.soreness, 1, 10);
    addObservation(week.workoutQuality, log.recovery?.motivation, 1, 10);
    addObservation(week.hydration, hydrationScore(log.recovery), 1, 4);

    for (const exercise of log.exercises || []) {
      const raw = typeof exercise.muscleGroup === 'string' ? exercise.muscleGroup.trim() : '';
      if (/^conditioning$/i.test(raw)) continue;
      const normalized = normalizeDiaryMuscleGroup(raw);
      const muscle: ResistanceMuscleGroup = normalized === 'Hams' ? 'Hamstrings' :
        normalized && (RESISTANCE_MUSCLE_GROUPS as readonly string[]).includes(normalized) ? normalized as ResistanceMuscleGroup : 'Other';
      // Empty labels are malformed rather than an imported, unexpected category.
      if (!raw) continue;
      for (const set of exercise.sets || []) {
        if (!isParentWorkingSetEligible(exercise, set)) continue;
        week.resistanceWorkingSets++;
        week.setsByMuscle[muscle]++;
        addObservation(week.workingSetRpe, set.rpe, 1, 10);
      }
    }
  }
  for (const week of output) {
    week.averageDurationMinutes = week.durationCount ? (week.totalDurationMinutes as number) / week.durationCount : null;
    for (const observation of [week.sleep, week.calories, week.hydration, week.soreness, week.workoutQuality, week.workingSetRpe]) {
      if (observation.count) observation.average = (observation.average as number) / observation.count;
    }
  }
  return output;
}

export function hydrationMeanLabel(mean: number): string {
  return mean < 1.5 ? 'Dehydrated' : mean < 2.5 ? 'Under-hydrated' : mean < 3.5 ? 'Adequate' : 'Optimal';
}

export function weeksBetween(start: string, end: string): number {
  return Math.round((parseLocalDate(end).getTime() - parseLocalDate(start).getTime()) / (7 * DAY_MS));
}
