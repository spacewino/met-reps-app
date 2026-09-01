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
  isCompleted?: boolean;
  isSkipped?: boolean;
};

export type ExerciseEntry = {
  name: string;
  muscleGroup: string;
  modality?: 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' | 'distance_loaded';
  sets: SetEntry[];
  isSuperset?: boolean | null;
  isMainMovement?: boolean | null;
  movementCategory?: 'compound' | 'isolation';
  equipment?: 'freeweight' | 'machine';
  isSkipped?: boolean | null;
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

export interface BodyweightSnapshot {
  value: number;
  unit: WeightUnit;
  timestamp?: string;
}

export type RestTimerStartContext = {
  source: 'exercise_header' | 'footer';
  exerciseName?: string | null;
  exerciseIndex?: number | null;
  setNumber?: number | null;
  startedAt?: string | null;
};

export type RestInterval = {
  durationSeconds: number;
  source: 'exercise_header' | 'footer';
  startedAt: string; // ISO string timestamp
  exerciseName?: string | null;
  exerciseIndex?: number | null;
  setNumber?: number | null;
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
  bodyweightSnapshot?: BodyweightSnapshot | null;
  restIntervals?: RestInterval[];
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
  parentProgramId?: string;
  cycleIndex?: number;
  algorithmPhaseOffset?: number;
};

export type PlannedSession = {
  date: string; // YYYY-MM-DD
  programId: string;
  dayIndex: number;
  week?: number;
  status: 'planned' | 'completed';
  completedDate?: string | null;
};

export interface AppSettings {
  highlightCurrentSet: boolean;
}

export type ActiveWorkoutSession = {
  editLogId?: string | null;
  programId?: string | null;
  programName?: string | null;
  weekNum?: string | number | null;
  dayNum?: string | number | null;
  dateStr?: string | null;
  isOneOff?: boolean | null;
  scheduledDate?: string | null;
  exercises?: ExerciseEntry[];
  userRawExercises?: ExerciseEntry[] | null;
  duration?: number | string | null;
  notes?: string | null;
  sleep?: number | '' | null;
  hydration?: HydrationLevel | number | string | null;
  calories?: number | null;
  protein?: number | null;
  soreness?: number | null;
  motivation?: number | null;
  checkedSets?: Record<string, boolean> | null;
  completionTouchedSets?: Record<string, boolean> | null;
  collapsed?: Record<number, boolean> | null;
  objective?: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload' | null;
  userTouchedSets?: Record<string, boolean> | null;
  startTime?: string | null;
  prescribedTargetSnapshots?: Record<string, { weight: number | null; reps: number | null; rpe: number | null }> | null;
  committedLiveEvidenceBySet?: Record<string, any> | null;
  liveAdjustedSets?: Record<string, boolean> | null;
  currentSetGuideKey?: string | null;
  bodyweightSnapshot?: BodyweightSnapshot | null;
  restIntervals?: RestInterval[] | null;
  workoutId?: string | null;
  redoFromLogId?: string | null;
};
