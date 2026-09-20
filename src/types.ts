/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type WeightUnit = 'kg' | 'lb';

export type CalendarNoteType = 'general' | 'sick' | 'travel';

export interface CalendarDayNote {
  type: CalendarNoteType;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export type CalendarDayNoteMap = Record<string, CalendarDayNote>;

export type TargetProgressionMode =
  | 'performance_led'
  | 'metreps_guided';

export type ExerciseModality = 'weighted' | 'bodyweight' | 'assisted' | 'distance' | 'timed' | 'distance_loaded';

export type ProgressionLoadBasis =
  | 'external_weight_v1'
  | 'bodyweight_normalized_v1'
  | 'assisted_net_normalized_v1';

export type ProgressionNudgeType =
  | 'none'
  | 'rep_nudge'
  | 'load_nudge'
  | 'hold';

export type ExerciseProgressionRole =
  | 'main_movement'
  | 'accessory';

export type GuidedCoachingReasonCode =
  | 'BASE_PRESCRIPTION'
  | 'REP_NUDGE'
  | 'LOAD_NUDGE_MAIN_MOVEMENT'
  | 'LOAD_PROMOTION_CEILING_REACHED'
  | 'CHALLENGE_CAP_HOLD'
  | 'HIGH_EXERTION_HOLD'
  | 'STEP_OUT_BASE_ONLY'
  | 'BODYWEIGHT_CEILING_HOLD'
  | 'BODYWEIGHT_MAIN_LOAD_HOLD'
  | 'MINIMUM_ASSISTANCE_REACHED'
  | 'MISSING_BODYWEIGHT_HOLD'
  | 'INVALID_ASSISTANCE_HOLD'
  | 'ZERO_NET_LOAD_HOLD'
  | 'MARGINAL_MISS_TARGET_HELD'
  | 'NUDGE_NEUTRAL_RETRY'
  | 'NUDGE_MARGINAL_FAILURE_ROLLBACK'
  | 'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK'
  | 'DEGRADED_HISTORY_HOLD'
  | 'INCONSISTENT_HISTORY_HOLD';

const _ALL_GUIDED_COACHING_REASON_CODES_LIST: readonly GuidedCoachingReasonCode[] = [
  'BASE_PRESCRIPTION',
  'REP_NUDGE',
  'LOAD_NUDGE_MAIN_MOVEMENT',
  'LOAD_PROMOTION_CEILING_REACHED',
  'CHALLENGE_CAP_HOLD',
  'HIGH_EXERTION_HOLD',
  'STEP_OUT_BASE_ONLY',
  'BODYWEIGHT_CEILING_HOLD',
  'BODYWEIGHT_MAIN_LOAD_HOLD',
  'MINIMUM_ASSISTANCE_REACHED',
  'MISSING_BODYWEIGHT_HOLD',
  'INVALID_ASSISTANCE_HOLD',
  'ZERO_NET_LOAD_HOLD',
  'MARGINAL_MISS_TARGET_HELD',
  'NUDGE_NEUTRAL_RETRY',
  'NUDGE_MARGINAL_FAILURE_ROLLBACK',
  'NUDGE_SUBSTANTIAL_FAILURE_ROLLBACK',
  'DEGRADED_HISTORY_HOLD',
  'INCONSISTENT_HISTORY_HOLD',
];

export const ALL_GUIDED_COACHING_REASON_CODES: readonly GuidedCoachingReasonCode[] & {
  has(code: unknown): code is GuidedCoachingReasonCode;
  readonly size: number;
} = Object.assign([..._ALL_GUIDED_COACHING_REASON_CODES_LIST], {
  has(code: unknown): code is GuidedCoachingReasonCode {
    return (
      typeof code === 'string' &&
      _ALL_GUIDED_COACHING_REASON_CODES_LIST.includes(code as GuidedCoachingReasonCode)
    );
  },
  get size() {
    return _ALL_GUIDED_COACHING_REASON_CODES_LIST.length;
  },
});

export function isGuidedCoachingReasonCode(code: unknown): code is GuidedCoachingReasonCode {
  return typeof code === 'string' && ALL_GUIDED_COACHING_REASON_CODES.has(code as GuidedCoachingReasonCode);
}

export type GuidedRollbackTarget = {
  weight: number;
  reps: number;
  rpe: number;
  comparisonLoadKg: number | null;
};

export type ClosedPeriodisationLaneContext =
  | {
      readonly algorithmId: 'hypertrophy_linear';
      readonly waveType: 'volume' | 'heavy';
    }
  | {
      readonly algorithmId: 'hypertrophy_step';
      readonly effectivePhase: number;
    }
  | {
      readonly algorithmId: 'strength_undulating';
      readonly anchorReps: number;
      readonly anchorRpe: number;
    }
  | {
      readonly algorithmId: 'strength_linear';
      readonly linearPhase: number;
      readonly maxWeeks: number;
    }
  | {
      readonly algorithmId: 'none';
      readonly familyToken: 'standard_baseline';
    };

export type PrescriptionSnapshot = {
  snapshotVersion: number;
  progressionPolicyVersion: number;
  algorithmVersion: number;

  progressionMode: TargetProgressionMode;
  algorithmId: string;

  exerciseKey: string;
  exerciseRole: ExerciseProgressionRole;
  modality: ExerciseModality;
  comparableLaneKey: string;
  workingSetOrdinal: number;
  prescribedWorkingSetCount: number;

  baseWeight: number;
  baseReps: number;
  baseRpe: number;

  presentedWeight: number;
  presentedReps: number;
  presentedRpe: number;

  bodyweightSnapshot: number | null;
  weightUnit: WeightUnit;
  comparisonLoadKg: number | null;
  loadBasis: ProgressionLoadBasis;
  loadIncrement: number;

  nudgeType: ProgressionNudgeType;
  coachingReasonCode: GuidedCoachingReasonCode;

  confirmedStepIndexBefore: number;
  presentedStepIndex: number;
  successCreditEligible: boolean;
  rollbackTarget: GuidedRollbackTarget | null;
};

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
  prescriptionSnapshot?: PrescriptionSnapshot | null;
};

export type ExerciseEntry = {
  name: string;
  muscleGroup: string;
  exerciseKey?: string;
  modality?: ExerciseModality;
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
  targetProgressionMode?: TargetProgressionMode;
  progressionPolicyVersion?: number;
  algorithmVersion?: number;
  unit?: WeightUnit;
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
