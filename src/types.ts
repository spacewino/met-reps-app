/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type WeightUnit = 'kg' | 'lb';

export type SetEntry = {
  setNumber: number;
  weight?: number | null;
  reps?: number | null;
  rpe?: number | null; // Rating of Perceived Exertion (1-10)
  form?: 'strict' | 'standard' | 'loose' | null;
  comment?: string | null;
  isDropSet?: boolean | null;
};

export type ExerciseEntry = {
  name: string;
  muscleGroup: string;
  modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed';
  sets: SetEntry[];
  isSuperset?: boolean | null;
};

export type DailyRecoveryMetrics = {
  sleepHours?: number | null;
  hydrationLiters?: number | null;
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
};

export type Program = {
  id: string;
  name: string;
  daysPerWeek: number;
  programDuration: number | '∞';
  createdAt: string; // ISO string
  exercisesByDay: Record<number, ExerciseEntry[]>; // Day Index (1-based) -> list of exercises
  assignedWeekdays?: Record<number, number | null>; // Day Index -> Weekday index (0=Mon, 1=Tue... 6=Sun)
};

export type PlannedSession = {
  date: string; // YYYY-MM-DD
  programId: string;
  dayIndex: number;
  status: 'planned' | 'completed';
  completedDate?: string | null;
};
