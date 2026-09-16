/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Program,
  WorkoutLog,
  ExerciseEntry,
  SetEntry,
  PrescriptionSnapshot,
  WeightUnit,
  ExerciseModality,
  ExerciseProgressionRole,
} from '../types';
import {
  CURRENT_PRESCRIPTION_SNAPSHOT_VERSION,
  CURRENT_PROGRESSION_POLICY_VERSION,
  CURRENT_ALGORITHM_VERSION,
  isValidSnapshotStepMetadata,
} from './programProgressionMode';
import {
  classifyGuidedSetOutcome,
  GuidedSetOutcome,
  GuidedSetOutcomeReason,
  GuidedSetOutcomeResult,
} from './guidedOutcomeClassifier';
import {
  classifyGuidedExerciseOutcome,
  GuidedExerciseOutcome,
  GuidedExerciseOutcomeReason,
  GuidedExerciseOutcomeResult,
} from './guidedExerciseClassifier';
import { extractLogEffectiveTimestampMs } from './objectiveMath';

export type GuidedHistoryBoundary =
  | {
      mode: 'active_live';
      targetDate: string;
      sessionStartedAt: number;
      targetWorkoutId?: null;
    }
  | {
      mode: 'historical_edit';
      targetWorkoutId: string;
      targetDate: string;
      targetTimestampMs: number | null;
    }
  | {
      mode: 'retrospective_new';
      targetDate: string;
      explicitTargetTimestamp?: number | null;
      targetWorkoutId?: null;
    };

export interface CollectComparableGuidedHistoryInput {
  targetProgramId: string;
  programs: readonly Program[];
  logs: readonly WorkoutLog[];
  targetSnapshot: PrescriptionSnapshot;
  boundary: GuidedHistoryBoundary;
}

export type GuidedHistoryFatalError =
  | 'TARGET_PROGRAM_NOT_FOUND'
  | 'DUPLICATE_PROGRAM_IDS'
  | 'CIRCULAR_PROGRAM_LINEAGE'
  | 'INVALID_TARGET_SNAPSHOT'
  | 'INVALID_CHRONOLOGY_BOUNDARY'
  | 'TARGET_WORKOUT_NOT_FOUND_IN_LOGS'
  | 'AMBIGUOUS_TARGET_WORKOUT_IN_LOGS'
  | 'DUPLICATE_WORKOUT_LOG_IDS';

export type ExcludedExposureReason =
  | 'INVALID_WORKOUT_ID'
  | 'INVALID_WORKOUT_DATE'
  | 'ONE_OFF_WORKOUT'
  | 'REDO_WORKOUT'
  | 'UNRELATED_PROGRAM'
  | 'DESCENDANT_PROGRAM_CYCLE'
  | 'FUTURE_WORKOUT'
  | 'TARGET_WORKOUT_SELF'
  | 'NON_GUIDED_WORKOUT'
  | 'MISSING_COMPARABLE_SNAPSHOT_IDENTITY'
  | 'EXERCISE_KEY_MISMATCH'
  | 'COMPARABLE_LANE_MISMATCH'
  | 'ROLE_MISMATCH'
  | 'MODALITY_MISMATCH'
  | 'SET_COUNT_MISMATCH'
  | 'SNAPSHOT_VERSION_MISMATCH'
  | 'POLICY_VERSION_MISMATCH'
  | 'ALGORITHM_VERSION_MISMATCH'
  | 'ALGORITHM_ID_MISMATCH'
  | 'LOAD_BASIS_MISMATCH'
  | 'DUPLICATE_COMPARABLE_EXERCISE_OCCURRENCE'
  | 'AMBIGUOUS_EXPOSURE_CHRONOLOGY'
  | 'INELIGIBLE_EXERCISE_OUTCOME';

export interface ExcludedExposureDiagnostic {
  workoutLogId: string;
  workoutDate?: string | null;
  exerciseIndex?: number;
  reason: ExcludedExposureReason;
  classifierReason?: GuidedExerciseOutcomeReason | GuidedSetOutcomeReason | null;
  details?: string;
}

export interface ComparableGuidedSetDetail {
  workingSetOrdinal: number;
  snapshot: PrescriptionSnapshot;
  setEntry: SetEntry;
  setResult: GuidedSetOutcomeResult;
}

export interface ComparableGuidedExposure {
  workoutLogId: string;
  workoutDate: string;
  workoutTimestampMs: number | null;
  scheduledDate: string | null;
  programId: string;
  cycleIndex: number | null;
  lineagePosition: number;
  week: number | null;
  day: number | null;
  exerciseIndex: number;

  exerciseKey: string;
  exerciseRole: ExerciseProgressionRole;
  modality: ExerciseModality;
  comparableLaneKey: string;
  prescribedWorkingSetCount: number;
  weightUnit: WeightUnit;

  sets: ComparableGuidedSetDetail[];

  nudgedWorkingSetOrdinal: number | null;
  nudgedSetOutcome: GuidedSetOutcome | null;
  nudgedSetAchieved: boolean | null;

  classification: GuidedExerciseOutcomeResult;
}

export interface CollectComparableGuidedHistorySuccess {
  status: 'success';
  lineageProgramIds: string[];
  isPartialLineage: boolean;
  partialLineageWarning?: {
    missingParentProgramId: string;
    safelyTraversedProgramIds: string[];
  } | null;
  usableExposures: ComparableGuidedExposure[];
  diagnostics: {
    totalCandidateLogs: number;
    usableExposureCount: number;
    excludedExposures: ExcludedExposureDiagnostic[];
    chronologyAmbiguities: ExcludedExposureDiagnostic[];
    duplicateOccurrences: ExcludedExposureDiagnostic[];
  };
}

export interface CollectComparableGuidedHistoryFailure {
  status: 'fatal_error';
  error: GuidedHistoryFatalError;
  errorMessage: string;
  usableExposures: [];
  diagnostics: {
    totalCandidateLogs: number;
    usableExposureCount: 0;
    excludedExposures: ExcludedExposureDiagnostic[];
    chronologyAmbiguities: ExcludedExposureDiagnostic[];
    duplicateOccurrences: ExcludedExposureDiagnostic[];
  };
}

export type CollectComparableGuidedHistoryResult =
  | CollectComparableGuidedHistorySuccess
  | CollectComparableGuidedHistoryFailure;

/**
 * Validates strict YYYY-MM-DD calendar date semantics.
 * Rejects non-ISO dates, impossible dates (e.g. 2026-02-30, 2026-13-01),
 * and leap-year violations.
 */
export function isValidCalendarDate(dateStr?: string | null): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [
    31,
    isLeap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  const maxDay = daysInMonth[month - 1];
  return day >= 1 && day <= maxDay;
}

/**
 * Validates a PrescriptionSnapshot to ensure it is fully defined, supports Guided mode,
 * and adheres to current locked version constants and modality constraints.
 */
export function isValidTargetSnapshot(snapshot?: PrescriptionSnapshot | null): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;

  if (snapshot.progressionMode !== 'metreps_guided') return false;
  if (snapshot.snapshotVersion !== CURRENT_PRESCRIPTION_SNAPSHOT_VERSION) return false;
  if (snapshot.progressionPolicyVersion !== CURRENT_PROGRESSION_POLICY_VERSION) return false;
  if (snapshot.algorithmVersion !== CURRENT_ALGORITHM_VERSION) return false;

  if (typeof snapshot.algorithmId !== 'string' || snapshot.algorithmId.trim() === '') {
    return false;
  }
  if (typeof snapshot.exerciseKey !== 'string' || snapshot.exerciseKey.trim() === '') {
    return false;
  }
  if (snapshot.exerciseRole !== 'main_movement' && snapshot.exerciseRole !== 'accessory') {
    return false;
  }
  if (
    snapshot.modality !== 'weighted' &&
    snapshot.modality !== 'bodyweight' &&
    snapshot.modality !== 'assisted'
  ) {
    return false;
  }
  if (typeof snapshot.comparableLaneKey !== 'string' || snapshot.comparableLaneKey.trim() === '') {
    return false;
  }

  if (snapshot.modality === 'weighted' && snapshot.loadBasis !== 'external_weight_v1') {
    return false;
  }
  if (snapshot.modality === 'bodyweight' && snapshot.loadBasis !== 'bodyweight_normalized_v1') {
    return false;
  }
  if (snapshot.modality === 'assisted' && snapshot.loadBasis !== 'assisted_net_normalized_v1') {
    return false;
  }

  if (
    typeof snapshot.prescribedWorkingSetCount !== 'number' ||
    !Number.isInteger(snapshot.prescribedWorkingSetCount) ||
    snapshot.prescribedWorkingSetCount <= 0
  ) {
    return false;
  }

  if (!isValidSnapshotStepMetadata(snapshot)) {
    return false;
  }

  return true;
}

function isDescendantOf(
  programId: string,
  ancestorId: string,
  programs: readonly Program[]
): boolean {
  let currId: string | undefined = programId;
  const visited = new Set<string>();
  while (currId) {
    if (visited.has(currId)) break;
    visited.add(currId);
    const prog = programs.find(p => p.id === currId);
    if (!prog || !prog.parentProgramId) break;
    const pId = prog.parentProgramId.trim();
    if (pId === ancestorId) return true;
    currId = pId;
  }
  return false;
}

function validateChronologyBoundary(
  boundary: GuidedHistoryBoundary,
  logs: readonly WorkoutLog[]
): { fatalError: GuidedHistoryFatalError; message: string } | null {
  if (!boundary || typeof boundary !== 'object') {
    return {
      fatalError: 'INVALID_CHRONOLOGY_BOUNDARY',
      message: 'Chronology boundary must be a valid object.',
    };
  }

  if (!isValidCalendarDate(boundary.targetDate)) {
    return {
      fatalError: 'INVALID_CHRONOLOGY_BOUNDARY',
      message: `Boundary targetDate "${boundary.targetDate}" is not a valid YYYY-MM-DD calendar date.`,
    };
  }

  if (boundary.mode === 'active_live') {
    if (
      typeof boundary.sessionStartedAt !== 'number' ||
      !Number.isFinite(boundary.sessionStartedAt) ||
      boundary.sessionStartedAt <= 0
    ) {
      return {
        fatalError: 'INVALID_CHRONOLOGY_BOUNDARY',
        message: 'Active-live boundary requires a finite positive sessionStartedAt timestamp.',
      };
    }
  } else if (boundary.mode === 'historical_edit') {
    if (
      !boundary.targetWorkoutId ||
      typeof boundary.targetWorkoutId !== 'string' ||
      boundary.targetWorkoutId.trim() === ''
    ) {
      return {
        fatalError: 'INVALID_CHRONOLOGY_BOUNDARY',
        message: 'Historical-edit boundary requires a non-empty targetWorkoutId.',
      };
    }

    const trimmedTargetId = boundary.targetWorkoutId.trim();
    const matchingLogs = logs.filter(
      l => l && typeof l.id === 'string' && l.id.trim() === trimmedTargetId
    );
    if (matchingLogs.length === 0) {
      return {
        fatalError: 'TARGET_WORKOUT_NOT_FOUND_IN_LOGS',
        message: `Historical-edit target workout "${trimmedTargetId}" was not found in logs array.`,
      };
    }
    if (matchingLogs.length > 1) {
      return {
        fatalError: 'AMBIGUOUS_TARGET_WORKOUT_IN_LOGS',
        message: `Historical-edit target workout "${trimmedTargetId}" appears ${matchingLogs.length} times in logs array.`,
      };
    }

    if (
      boundary.targetTimestampMs !== null &&
      boundary.targetTimestampMs !== undefined &&
      (!Number.isFinite(boundary.targetTimestampMs) || boundary.targetTimestampMs <= 0)
    ) {
      return {
        fatalError: 'INVALID_CHRONOLOGY_BOUNDARY',
        message: 'Historical-edit targetTimestampMs must be a finite positive number or null.',
      };
    }
  } else if (boundary.mode === 'retrospective_new') {
    if (
      boundary.explicitTargetTimestamp !== null &&
      boundary.explicitTargetTimestamp !== undefined &&
      (!Number.isFinite(boundary.explicitTargetTimestamp) || boundary.explicitTargetTimestamp <= 0)
    ) {
      return {
        fatalError: 'INVALID_CHRONOLOGY_BOUNDARY',
        message: 'Retrospective-new explicitTargetTimestamp must be a finite positive number or null.',
      };
    }
  } else {
    return {
      fatalError: 'INVALID_CHRONOLOGY_BOUNDARY',
      message: `Unknown boundary mode: "${(boundary as any).mode}".`,
    };
  }

  return null;
}

/**
 * Checks if a candidate snapshot matches the target snapshot across identity dimensions.
 * In 'comparable_lane' mode, matches all 11 dimensions including comparableLaneKey.
 * In 'broad_adherence' mode, ignores comparableLaneKey and matches the 10 immutable exercise dimensions.
 * Returns null if exact match, or the specific ExcludedExposureReason if mismatched.
 */
function getSnapshotIdentityMismatchReason(
  candidate: PrescriptionSnapshot,
  target: PrescriptionSnapshot,
  identityMode: 'comparable_lane' | 'broad_adherence' = 'comparable_lane'
): ExcludedExposureReason | null {
  if (candidate.progressionMode !== 'metreps_guided') {
    return 'NON_GUIDED_WORKOUT';
  }
  if (candidate.snapshotVersion !== CURRENT_PRESCRIPTION_SNAPSHOT_VERSION) {
    return 'SNAPSHOT_VERSION_MISMATCH';
  }
  if (candidate.progressionPolicyVersion !== CURRENT_PROGRESSION_POLICY_VERSION) {
    return 'POLICY_VERSION_MISMATCH';
  }
  if (candidate.algorithmVersion !== CURRENT_ALGORITHM_VERSION) {
    return 'ALGORITHM_VERSION_MISMATCH';
  }
  if (candidate.algorithmId !== target.algorithmId) {
    return 'ALGORITHM_ID_MISMATCH';
  }
  if (candidate.exerciseKey !== target.exerciseKey) {
    return 'EXERCISE_KEY_MISMATCH';
  }
  if (candidate.exerciseRole !== target.exerciseRole) {
    return 'ROLE_MISMATCH';
  }
  if (candidate.modality !== target.modality) {
    return 'MODALITY_MISMATCH';
  }
  if (identityMode === 'comparable_lane' && candidate.comparableLaneKey !== target.comparableLaneKey) {
    return 'COMPARABLE_LANE_MISMATCH';
  }
  if (candidate.loadBasis !== target.loadBasis) {
    return 'LOAD_BASIS_MISMATCH';
  }
  if (candidate.prescribedWorkingSetCount !== target.prescribedWorkingSetCount) {
    return 'SET_COUNT_MISMATCH';
  }

  return null;
}

/**
 * Pure, deterministic core collector discovering and chronologically ordering
 * historical Guided exercise exposures across a program's lineage.
 */
function collectGuidedHistoryInternal(
  input: CollectComparableGuidedHistoryInput,
  identityMode: 'comparable_lane' | 'broad_adherence'
): CollectComparableGuidedHistoryResult {
  const excludedExposures: ExcludedExposureDiagnostic[] = [];
  const chronologyAmbiguities: ExcludedExposureDiagnostic[] = [];
  const duplicateOccurrences: ExcludedExposureDiagnostic[] = [];

  const createFailure = (
    error: GuidedHistoryFatalError,
    errorMessage: string
  ): CollectComparableGuidedHistoryFailure => ({
    status: 'fatal_error',
    error,
    errorMessage,
    usableExposures: [],
    diagnostics: {
      totalCandidateLogs: input.logs.length,
      usableExposureCount: 0,
      excludedExposures,
      chronologyAmbiguities,
      duplicateOccurrences,
    },
  });

  // 1. Validate targetProgramId and programs array
  if (
    !input.targetProgramId ||
    typeof input.targetProgramId !== 'string' ||
    input.targetProgramId.trim() === ''
  ) {
    return createFailure('TARGET_PROGRAM_NOT_FOUND', 'Target program ID must be a non-empty string.');
  }

  const trimmedTargetProgId = input.targetProgramId.trim();
  const seenProgramIds = new Set<string>();

  for (const prog of input.programs) {
    if (!prog.id || typeof prog.id !== 'string' || prog.id.trim() === '') {
      return createFailure('DUPLICATE_PROGRAM_IDS', 'Blank or invalid program ID detected in programs array.');
    }
    const pid = prog.id.trim();
    if (seenProgramIds.has(pid)) {
      return createFailure('DUPLICATE_PROGRAM_IDS', `Duplicate program ID "${pid}" detected in programs array.`);
    }
    seenProgramIds.add(pid);
  }

  const targetProgram = input.programs.find(p => p.id === trimmedTargetProgId);
  if (!targetProgram) {
    return createFailure(
      'TARGET_PROGRAM_NOT_FOUND',
      `Target program ID "${trimmedTargetProgId}" was not found in programs array.`
    );
  }

  // 2. Validate target snapshot
  if (!isValidTargetSnapshot(input.targetSnapshot)) {
    return createFailure(
      'INVALID_TARGET_SNAPSHOT',
      'Target snapshot is invalid, missing required fields, or non-Guided.'
    );
  }

  // 3. Validate chronology boundary
  const boundaryError = validateChronologyBoundary(input.boundary, input.logs);
  if (boundaryError) {
    return createFailure(boundaryError.fatalError, boundaryError.message);
  }

  // 4. Validate duplicate workout-log IDs
  const seenLogIds = new Set<string>();
  for (const log of input.logs) {
    if (log && typeof log.id === 'string') {
      const lid = log.id.trim();
      if (lid !== '') {
        if (seenLogIds.has(lid)) {
          return createFailure('DUPLICATE_WORKOUT_LOG_IDS', `Duplicate workout log ID "${lid}" detected in logs array.`);
        }
        seenLogIds.add(lid);
      }
    }
  }

  // 5. Upward lineage traversal from targetProgram
  const visitedLineageIds = new Set<string>();
  const reversedLineage: Program[] = [];
  let currentProg: Program | null = targetProgram;
  let isPartialLineage = false;
  let partialLineageWarning: {
    missingParentProgramId: string;
    safelyTraversedProgramIds: string[];
  } | null = null;

  while (currentProg) {
    if (visitedLineageIds.has(currentProg.id)) {
      return createFailure(
        'CIRCULAR_PROGRAM_LINEAGE',
        `Circular ancestry detected involving program ID "${currentProg.id}".`
      );
    }
    visitedLineageIds.add(currentProg.id);
    reversedLineage.push(currentProg);

    const parentId: string | undefined = currentProg.parentProgramId?.trim();
    if (!parentId) {
      break;
    }
    if (parentId === currentProg.id) {
      return createFailure(
        'CIRCULAR_PROGRAM_LINEAGE',
        `Self-referencing parentProgramId detected on program "${currentProg.id}".`
      );
    }

    const parent: Program | undefined = input.programs.find(p => p.id === parentId);
    if (!parent) {
      isPartialLineage = true;
      partialLineageWarning = {
        missingParentProgramId: parentId,
        safelyTraversedProgramIds: reversedLineage.map(p => p.id).reverse(),
      };
      break;
    }
    currentProg = parent;
  }

  // Order root-to-current
  const lineagePrograms = [...reversedLineage].reverse();
  const lineageProgramIds = lineagePrograms.map(p => p.id);
  const lineageMap = new Map<string, { program: Program; lineagePosition: number }>();
  lineagePrograms.forEach((p, idx) => {
    lineageMap.set(p.id, { program: p, lineagePosition: idx });
  });

  // 6. Process candidate workouts and identify candidate exposures
  interface PreCandidateExposure {
    workout: WorkoutLog;
    exercise: ExerciseEntry;
    exerciseIndex: number;
    matchingSets: SetEntry[];
    timestampMs: number | null;
  }

  const preCandidates: PreCandidateExposure[] = [];

  for (const log of input.logs) {
    if (!log) continue;

    // Validate workout ID
    if (!log.id || typeof log.id !== 'string' || log.id.trim() === '') {
      excludedExposures.push({
        workoutLogId: String(log.id ?? ''),
        workoutDate: log.date ?? null,
        reason: 'INVALID_WORKOUT_ID',
        details: 'Workout has blank, missing, or non-string ID.',
      });
      continue;
    }
    const logId = log.id.trim();

    // Validate calendar date
    if (!isValidCalendarDate(log.date)) {
      excludedExposures.push({
        workoutLogId: logId,
        workoutDate: log.date ?? null,
        reason: 'INVALID_WORKOUT_DATE',
        details: `Workout date "${log.date}" does not follow valid strict YYYY-MM-DD calendar semantics.`,
      });
      continue;
    }
    const logDate = log.date!.trim();

    // Check one-off workout
    if (
      !log.programId ||
      typeof log.programId !== 'string' ||
      log.programId.trim() === '' ||
      log.program === 'One Off' ||
      (log as any).isOneOff === true
    ) {
      excludedExposures.push({
        workoutLogId: logId,
        workoutDate: logDate,
        reason: 'ONE_OFF_WORKOUT',
        details: 'Workout is an ad-hoc or unlinked one-off workout.',
      });
      continue;
    }
    const progId = log.programId.trim();

    // Check redo workout
    if ((log as any).redoFromLogId) {
      excludedExposures.push({
        workoutLogId: logId,
        workoutDate: logDate,
        reason: 'REDO_WORKOUT',
        details: 'Workout is a repeated redo session.',
      });
      continue;
    }

    // Check program lineage membership
    if (!lineageMap.has(progId)) {
      const isDescendant = isDescendantOf(progId, trimmedTargetProgId, input.programs);
      excludedExposures.push({
        workoutLogId: logId,
        workoutDate: logDate,
        reason: isDescendant ? 'DESCENDANT_PROGRAM_CYCLE' : 'UNRELATED_PROGRAM',
        details: isDescendant
          ? `Workout belongs to descendant program cycle "${progId}".`
          : `Workout belongs to program "${progId}" which is not in target lineage.`,
      });
      continue;
    }

    // Target workout self-exclusion (historical_edit)
    if (
      input.boundary.mode === 'historical_edit' &&
      logId === input.boundary.targetWorkoutId.trim()
    ) {
      excludedExposures.push({
        workoutLogId: logId,
        workoutDate: logDate,
        reason: 'TARGET_WORKOUT_SELF',
        details: 'Target workout is self-excluded from its own historical progression basis.',
      });
      continue;
    }

    // Future workout exclusion relative to boundary targetDate
    if (logDate > input.boundary.targetDate) {
      excludedExposures.push({
        workoutLogId: logId,
        workoutDate: logDate,
        reason: 'FUTURE_WORKOUT',
        details: `Workout date "${logDate}" is strictly after target boundary date "${input.boundary.targetDate}".`,
      });
      continue;
    }

    const logEffectiveTs = extractLogEffectiveTimestampMs(log);

    // Same-day boundary checks on input.boundary.targetDate
    if (logDate === input.boundary.targetDate) {
      if (input.boundary.mode === 'active_live') {
        if (logEffectiveTs === null) {
          const diag: ExcludedExposureDiagnostic = {
            workoutLogId: logId,
            workoutDate: logDate,
            reason: 'AMBIGUOUS_EXPOSURE_CHRONOLOGY',
            details: 'Same-day workout lacks effective timestamp to prove it preceded active_live session start.',
          };
          excludedExposures.push(diag);
          chronologyAmbiguities.push(diag);
          continue;
        }
        if (logEffectiveTs >= input.boundary.sessionStartedAt) {
          excludedExposures.push({
            workoutLogId: logId,
            workoutDate: logDate,
            reason: 'FUTURE_WORKOUT',
            details: 'Same-day workout occurred at or after active_live sessionStartedAt timestamp.',
          });
          continue;
        }
      } else if (input.boundary.mode === 'historical_edit') {
        if (logEffectiveTs === null || input.boundary.targetTimestampMs === null) {
          const diag: ExcludedExposureDiagnostic = {
            workoutLogId: logId,
            workoutDate: logDate,
            reason: 'AMBIGUOUS_EXPOSURE_CHRONOLOGY',
            details: 'Same-day candidate or target workout lacks effective timestamp to establish relative causality.',
          };
          excludedExposures.push(diag);
          chronologyAmbiguities.push(diag);
          continue;
        }
        if (logEffectiveTs >= input.boundary.targetTimestampMs) {
          excludedExposures.push({
            workoutLogId: logId,
            workoutDate: logDate,
            reason: 'FUTURE_WORKOUT',
            details: 'Same-day candidate occurred at or after target workout timestamp.',
          });
          continue;
        }
      } else if (input.boundary.mode === 'retrospective_new') {
        if (
          input.boundary.explicitTargetTimestamp === null ||
          input.boundary.explicitTargetTimestamp === undefined
        ) {
          const diag: ExcludedExposureDiagnostic = {
            workoutLogId: logId,
            workoutDate: logDate,
            reason: 'AMBIGUOUS_EXPOSURE_CHRONOLOGY',
            details: 'Without an explicit target timestamp, same-day candidates cannot prove precedence and are excluded.',
          };
          excludedExposures.push(diag);
          chronologyAmbiguities.push(diag);
          continue;
        }
        if (logEffectiveTs === null) {
          const diag: ExcludedExposureDiagnostic = {
            workoutLogId: logId,
            workoutDate: logDate,
            reason: 'AMBIGUOUS_EXPOSURE_CHRONOLOGY',
            details: 'Same-day candidate lacks timestamp to prove precedence over explicitTargetTimestamp.',
          };
          excludedExposures.push(diag);
          chronologyAmbiguities.push(diag);
          continue;
        }
        if (logEffectiveTs >= input.boundary.explicitTargetTimestamp) {
          excludedExposures.push({
            workoutLogId: logId,
            workoutDate: logDate,
            reason: 'FUTURE_WORKOUT',
            details: 'Same-day candidate occurred at or after explicitTargetTimestamp.',
          });
          continue;
        }
      }
    }

    // Inspect exercises within this valid workout
    const exercises = Array.isArray(log.exercises) ? log.exercises : [];

    // Check if workout has any Guided snapshot at all
    let hasAnyGuidedSnapshotInWorkout = false;
    for (const ex of exercises) {
      if (Array.isArray(ex?.sets)) {
        for (const s of ex.sets) {
          if (s?.prescriptionSnapshot?.progressionMode === 'metreps_guided') {
            hasAnyGuidedSnapshotInWorkout = true;
            break;
          }
        }
      }
      if (hasAnyGuidedSnapshotInWorkout) break;
    }

    if (!hasAnyGuidedSnapshotInWorkout) {
      excludedExposures.push({
        workoutLogId: logId,
        workoutDate: logDate,
        reason: 'NON_GUIDED_WORKOUT',
        details: 'Workout contains no Guided prescription snapshots (Performance-Led or legacy session).',
      });
      continue;
    }

    // Find candidate exercise occurrences matching target identity tuple
    interface MatchedOccurrence {
      exercise: ExerciseEntry;
      exerciseIndex: number;
      matchingSets: SetEntry[];
    }

    const matchedOccurrences: MatchedOccurrence[] = [];

    exercises.forEach((ex, exIdx) => {
      if (!ex) return;

      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      const prescribedSets = sets.filter(s => s?.prescriptionSnapshot != null);

      if (prescribedSets.length === 0) {
        excludedExposures.push({
          workoutLogId: logId,
          workoutDate: logDate,
          exerciseIndex: exIdx,
          reason: 'MISSING_COMPARABLE_SNAPSHOT_IDENTITY',
          details: ex.isSkipped
            ? 'Skipped exercise has no prescription snapshots to prove progression lane identity.'
            : 'Exercise has no prescribed sets with prescription snapshots.',
        });
        return;
      }

      // Check all prescribed snapshots against target snapshot
      let mismatchReason: ExcludedExposureReason | null = null;
      for (const pSet of prescribedSets) {
        const r = getSnapshotIdentityMismatchReason(
          pSet.prescriptionSnapshot!,
          input.targetSnapshot,
          identityMode
        );
        if (r) {
          mismatchReason = r;
          break;
        }
      }

      if (mismatchReason) {
        excludedExposures.push({
          workoutLogId: logId,
          workoutDate: logDate,
          exerciseIndex: exIdx,
          reason: mismatchReason,
          details: `Prescription snapshot mismatched target on ${mismatchReason}.`,
        });
        return;
      }

      // Exact match for target identity tuple
      matchedOccurrences.push({
        exercise: ex,
        exerciseIndex: exIdx,
        matchingSets: prescribedSets,
      });
    });

    // Check same-workout duplicate occurrences
    if (matchedOccurrences.length > 1) {
      matchedOccurrences.forEach(occ => {
        const diag: ExcludedExposureDiagnostic = {
          workoutLogId: logId,
          workoutDate: logDate,
          exerciseIndex: occ.exerciseIndex,
          reason: 'DUPLICATE_COMPARABLE_EXERCISE_OCCURRENCE',
          details: `Target comparable identity tuple appeared ${matchedOccurrences.length} times in workout ${logId}.`,
        };
        excludedExposures.push(diag);
        duplicateOccurrences.push(diag);
      });
      continue;
    }

    if (matchedOccurrences.length === 1) {
      const single = matchedOccurrences[0];
      preCandidates.push({
        workout: log,
        exercise: single.exercise,
        exerciseIndex: single.exerciseIndex,
        matchingSets: single.matchingSets,
        timestampMs: logEffectiveTs,
      });
    }
  }

  // 7. Ambiguous same-date grouping check across historical dates (< boundary.targetDate)
  const byDateMap = new Map<string, PreCandidateExposure[]>();
  preCandidates.forEach(cand => {
    const d = cand.workout.date!.trim();
    if (!byDateMap.has(d)) {
      byDateMap.set(d, []);
    }
    byDateMap.get(d)!.push(cand);
  });

  const verifiedCandidates: PreCandidateExposure[] = [];

  for (const [d, group] of byDateMap.entries()) {
    if (group.length === 1) {
      verifiedCandidates.push(group[0]);
    } else {
      // Multiple candidate workouts on the same calendar date
      const hasMissingTs = group.some(c => c.timestampMs === null);
      const timestamps = group.map(c => c.timestampMs);
      const hasDuplicates = new Set(timestamps).size !== timestamps.length;

      if (hasMissingTs || hasDuplicates) {
        group.forEach(c => {
          const diag: ExcludedExposureDiagnostic = {
            workoutLogId: c.workout.id,
            workoutDate: d,
            exerciseIndex: c.exerciseIndex,
            reason: 'AMBIGUOUS_EXPOSURE_CHRONOLOGY',
            details: hasMissingTs
              ? 'Multiple candidate workouts on date lack resolvable effective timestamps.'
              : 'Multiple candidate workouts on date share identical effective timestamps.',
          };
          excludedExposures.push(diag);
          chronologyAmbiguities.push(diag);
        });
      } else {
        // All have distinct, valid timestamps: strictly ordered
        group.sort((a, b) => a.timestampMs! - b.timestampMs!);
        verifiedCandidates.push(...group);
      }
    }
  }

  // 8. Invoke locked classifier on verified candidates and build usable exposures
  const usableExposures: ComparableGuidedExposure[] = [];

  for (const cand of verifiedCandidates) {
    const classification = classifyGuidedExerciseOutcome({
      exercise: cand.exercise,
      workout: cand.workout,
    });

    if (classification.outcome === 'ineligible') {
      excludedExposures.push({
        workoutLogId: cand.workout.id,
        workoutDate: cand.workout.date,
        exerciseIndex: cand.exerciseIndex,
        reason: 'INELIGIBLE_EXERCISE_OUTCOME',
        classifierReason: classification.reason,
        details: `Exercise classified as ineligible: ${classification.reason}`,
      });
      continue;
    }

    const progId = cand.workout.programId!.trim();
    const lineageEntry = lineageMap.get(progId)!;

    const setDetails: ComparableGuidedSetDetail[] = cand.matchingSets
      .map(set => {
        const snap = set.prescriptionSnapshot!;
        const ordinal = snap.workingSetOrdinal;
        const foundSetResult = classification.setResults.find(
          sr => sr.workingSetOrdinal === ordinal
        )?.result;

        const resolvedSetResult =
          foundSetResult ??
          classifyGuidedSetOutcome({
            set,
            exercise: cand.exercise,
            workout: cand.workout,
          });

        return {
          workingSetOrdinal: ordinal,
          snapshot: snap,
          setEntry: set,
          setResult: resolvedSetResult,
        };
      })
      .sort((a, b) => a.workingSetOrdinal - b.workingSetOrdinal);

    const firstSnap = cand.matchingSets[0]?.prescriptionSnapshot;
    const resolvedWeightUnit: WeightUnit =
      firstSnap?.weightUnit ?? cand.workout.unit ?? input.targetSnapshot.weightUnit;

    const parseNumericCoord = (val?: string | number | null): number | null => {
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    };

    const exposure: ComparableGuidedExposure = {
      workoutLogId: cand.workout.id,
      workoutDate: cand.workout.date!.trim(),
      workoutTimestampMs: cand.timestampMs,
      scheduledDate: cand.workout.scheduledDate ?? null,
      programId: progId,
      cycleIndex: lineageEntry.program.cycleIndex ?? null,
      lineagePosition: lineageEntry.lineagePosition,
      week: parseNumericCoord(cand.workout.week),
      day: parseNumericCoord(cand.workout.day),
      exerciseIndex: cand.exerciseIndex,

      exerciseKey: input.targetSnapshot.exerciseKey,
      exerciseRole: input.targetSnapshot.exerciseRole,
      modality: input.targetSnapshot.modality,
      comparableLaneKey: firstSnap?.comparableLaneKey ?? input.targetSnapshot.comparableLaneKey,
      prescribedWorkingSetCount: input.targetSnapshot.prescribedWorkingSetCount,
      weightUnit: resolvedWeightUnit,

      sets: setDetails,

      nudgedWorkingSetOrdinal: classification.nudgedWorkingSetOrdinal,
      nudgedSetOutcome: classification.nudgedSetOutcome,
      nudgedSetAchieved: classification.nudgedSetAchieved,

      classification,
    };

    usableExposures.push(exposure);
  }

  // 9. Chronological ascending sort (oldest to newest)
  usableExposures.sort((a, b) => {
    if (a.workoutDate !== b.workoutDate) {
      return a.workoutDate.localeCompare(b.workoutDate);
    }
    return (a.workoutTimestampMs ?? 0) - (b.workoutTimestampMs ?? 0);
  });

  return {
    status: 'success',
    lineageProgramIds,
    isPartialLineage,
    partialLineageWarning,
    usableExposures,
    diagnostics: {
      totalCandidateLogs: input.logs.length,
      usableExposureCount: usableExposures.length,
      excludedExposures,
      chronologyAmbiguities,
      duplicateOccurrences,
    },
  };
}

export type CollectGuidedAdherenceHistoryInput = CollectComparableGuidedHistoryInput;
export type CollectGuidedAdherenceHistorySuccess = CollectComparableGuidedHistorySuccess;
export type CollectGuidedAdherenceHistoryFailure = CollectComparableGuidedHistoryFailure;
export type CollectGuidedAdherenceHistoryResult = CollectComparableGuidedHistoryResult;

/**
 * Discovers and orders historical Guided exercise exposures strictly for a comparable prescription lane
 * (matching all 11 dimensions including comparableLaneKey).
 */
export function collectComparableGuidedHistory(
  input: CollectComparableGuidedHistoryInput
): CollectComparableGuidedHistoryResult {
  return collectGuidedHistoryInternal(input, 'comparable_lane');
}

/**
 * Discovers and orders historical Guided exercise exposures across an exercise's broad lineage
 * (matching the 10 immutable exercise dimensions, deliberately ignoring comparableLaneKey and periodisation variations).
 */
export function collectGuidedAdherenceHistory(
  input: CollectGuidedAdherenceHistoryInput
): CollectGuidedAdherenceHistoryResult {
  return collectGuidedHistoryInternal(input, 'broad_adherence');
}

