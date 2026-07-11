/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type WeightUnit = 'kg' | 'lb';

export type HydrationLevel = 'Dehydrated' | 'Under-hydrated' | 'Adequate' | 'Optimal';

export const mapHydrationToLiters = (level: HydrationLevel | string | number | null | undefined): number => {
  if (level === 'Dehydrated') return 1.0;
  if (level === 'Under-hydrated') return 1.8;
  if (level === 'Adequate') return 2.6;
  if (level === 'Optimal') return 3.5;
  if (typeof level === 'number') return level;
  if (typeof level === 'string' && !isNaN(Number(level))) return Number(level);
  return 2.5; // default fallback
};

export const mapLitersToHydration = (liters: number | null | undefined): HydrationLevel => {
  if (liters === null || liters === undefined) return 'Adequate';
  if (liters < 1.5) return 'Dehydrated';
  if (liters < 2.2) return 'Under-hydrated';
  if (liters < 3.2) return 'Adequate';
  return 'Optimal';
};

export type SetEntry = {
  setNumber: number;
  weight?: number | null;
  reps?: number | null;
  rpe?: number | null; // Rating of Perceived Exertion (1-10)
  form?: 'strict' | 'standard' | 'loose' | null;
  comment?: string | null;
  isDropSet?: boolean | null;
  isWarmup?: boolean | null;
  dropSubSets?: { weight?: number | null; reps?: number | null }[] | null;
};

export type ExerciseEntry = {
  name: string;
  muscleGroup: string;
  modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' | 'distance_loaded';
  sets: SetEntry[];
  isSuperset?: boolean | null;
  isMainMovement?: boolean | null;
};

export type DailyRecoveryMetrics = {
  sleepHours?: number | null;
  hydrationLiters?: number | null;
  hydrationLevel?: HydrationLevel | null;
  nutritionCalories?: number | null;
  proteinGrams?: number | null;
  soreness?: number | null; // 1-5 or 1-10
  motivation?: number | null; // 1-5 or 1-10
};

export type WorkoutLog = {
  id: string;
  date: string;            // "YYYY-MM-DD"
  scheduledDate?: string | null; // "YYYY-MM-DD"
  programId?: string | null;
  program?: string;        // Name of the program or "One Off"
  week?: string;           // e.g. "1"
  day?: string;            // e.g. "1" or day number
  exercises: ExerciseEntry[];
  unit: WeightUnit;
  durationMinutes?: number;
  recovery?: DailyRecoveryMetrics;
  notes?: string;
  objective?: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  startTime?: string;
};

export type Program = {
  id: string;
  name: string;
  daysPerWeek: number;
  programDuration: number | '∞';
  createdAt: string; // ISO string
  exercisesByDay: Record<number, ExerciseEntry[]>; // Day Index (1-based) -> list of exercises
  assignedWeekdays?: Record<number, number | null>; // Day Index -> Weekday index (0=Mon, 1=Tue... 6=Sun)
  objective?: 'Off' | 'Hypertrophy' | 'Strength';
  algorithmId?: 'hypertrophy_linear' | 'hypertrophy_step' | 'strength_undulating' | 'strength_linear' | 'none';
};

export type PlannedSession = {
  date: string; // YYYY-MM-DD
  programId: string;
  dayIndex: number;
  week?: number;
  status: 'planned' | 'completed';
  completedDate?: string | null;
};
