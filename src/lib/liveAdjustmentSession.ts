import { ExerciseEntry, SetEntry } from '../types';
import type { FatiguePriorProfile } from './setDistribution';
import {
  LiveAdjustmentParams,
  LiveTargetSnapshot,
  CommittedLiveEvidence,
  LiveAdjustmentResult,
} from './liveAdjustmentMath';

/**
 * Immutable snapshot value of a prescribed target.
 * Keyed externally by `${exIdx}-${setIdx}` (never permanently storing ordinals).
 */
export interface PrescribedTargetSnapshotValue {
  weight: number;
  reps: number;
  rpe: number;
}

/**
 * User-committed performance value captured at the moment of explicit RPE selection.
 * Keyed externally by `${exIdx}-${setIdx}`.
 */
export interface CommittedLiveEvidenceValue {
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  form: 'strict' | 'standard' | 'loose' | null;
}

/**
 * Active session and draft-only map types.
 * Stored with row-coordinate keys `${exIdx}-${setIdx}`.
 */
export type PrescribedTargetSnapshotMap = Record<string, PrescribedTargetSnapshotValue>;
export type CommittedLiveEvidenceMap = Record<string, CommittedLiveEvidenceValue>;
export type LiveAdjustedSetMap = Record<string, boolean>;

/**
 * Pure helper to construct CommittedLiveEvidenceValue from raw inputs.
 * Ensures:
 * - strict -> 'strict'
 * - standard -> 'standard'
 * - loose -> 'loose'
 * - null or undefined -> null (preserves null accurately without defaulting to standard)
 */
export function createCommittedLiveEvidenceValue(
  weight: number | null | undefined,
  reps: number | null | undefined,
  rpe: number | null | undefined,
  form?: 'strict' | 'standard' | 'loose' | null
): CommittedLiveEvidenceValue {
  let normalizedForm: 'strict' | 'standard' | 'loose' | null = null;
  if (form === 'strict' || form === 'standard' || form === 'loose') {
    normalizedForm = form;
  }

  return {
    weight: typeof weight === 'number' ? weight : null,
    reps: typeof reps === 'number' ? reps : null,
    rpe: typeof rpe === 'number' ? rpe : null,
    form: normalizedForm,
  };
}

/**
 * Pure helper to capture initial prescribed snapshots from an exercise list.
 * Rules:
 * - Scans working sets (skips warm-ups and ordinals > 6).
 * - Checks touchedSetsRecord; if row is touched, preserves existing snapshot without promoting touched row values.
 * - If untouched, captures weight, reps, rpe if valid (weight > 0, reps > 0, rpe >= 6.0 && rpe <= 10.0, !isSkipped).
 * - Immutably returns a new PrescribedTargetSnapshotMap without mutating inputs.
 */
export function capturePrescribedSnapshotsFromExercises(
  exerciseList: ExerciseEntry[],
  currentSnapshots: PrescribedTargetSnapshotMap = {},
  touchedSetsRecord: Record<string, boolean> = {},
  startExIdx: number = 0
): PrescribedTargetSnapshotMap {
  const result: PrescribedTargetSnapshotMap = { ...currentSnapshots };

  if (!exerciseList || exerciseList.length === 0) {
    return result;
  }

  exerciseList.forEach((ex, i) => {
    if (!ex || !ex.sets) return;
    const exIdx = startExIdx + i;

    let workingOrdinal = 0;
    ex.sets.forEach((s, sIdx) => {
      if (s.isWarmup) return;
      workingOrdinal++;
      if (workingOrdinal > 6) return;

      const key = `${exIdx}-${sIdx}`;
      const isTouched = !!touchedSetsRecord[key];

      if (isTouched) {
        return;
      }

      if (
        typeof s.weight === 'number' &&
        s.weight > 0 &&
        typeof s.reps === 'number' &&
        s.reps > 0 &&
        typeof s.rpe === 'number' &&
        s.rpe >= 6.0 &&
        s.rpe <= 10.0 &&
        !s.isSkipped
      ) {
        result[key] = {
          weight: s.weight,
          reps: s.reps,
          rpe: s.rpe,
        };
      }
    });
  });

  return result;
}

/**
 * Parameters for the pure session adapter.
 */
export interface PrepareLiveAdjustmentParamsInput {
  exercise: ExerciseEntry;
  exIdx: number;
  objective: 'Hypertrophy' | 'Strength' | string;
  algorithmId: string;
  profileType: FatiguePriorProfile;
  baselineE1RM: number;
  prescribedTargetSnapshots: PrescribedTargetSnapshotMap;
  committedLiveEvidenceBySet: CommittedLiveEvidenceMap;
  triggeringSetIdx: number;
}

/**
 * Result of preparing LiveAdjustmentParams from active session state.
 */
export interface PrepareLiveAdjustmentParamsResult {
  success: boolean;
  params?: LiveAdjustmentParams;
  failureReason?: string;
}

/**
 * Pure helper to derive the 1-based working-set ordinal of a set in an exercise,
 * excluding warm-ups from ordinal counting while counting non-warmup sets (including skipped).
 * Returns null if the target set is a warm-up or index is invalid.
 */
export function deriveWorkingSetOrdinal(sets: SetEntry[], targetSetIdx: number): number | null {
  if (!sets || targetSetIdx < 0 || targetSetIdx >= sets.length) {
    return null;
  }
  const targetSet = sets[targetSetIdx];
  if (targetSet?.isWarmup) {
    return null;
  }

  let ordinal = 0;
  for (let i = 0; i <= targetSetIdx; i++) {
    if (!sets[i]?.isWarmup) {
      ordinal++;
    }
  }
  return ordinal;
}

/**
 * Pure helper to find the row index in an exercise for a given working set ordinal (1..6).
 * Returns null if no such working set exists.
 */
export function getWorkingSetRowIndex(sets: SetEntry[], targetOrdinal: number): number | null {
  if (!sets || targetOrdinal < 1) {
    return null;
  }

  let currentOrdinal = 0;
  for (let i = 0; i < sets.length; i++) {
    if (!sets[i]?.isWarmup) {
      currentOrdinal++;
      if (currentOrdinal === targetOrdinal) {
        return i;
      }
    }
  }
  return null;
}

/**
 * Pure session adapter that prepares LiveAdjustmentParams from active React session state.
 *
 * Rules:
 * - Scans rows in current visual order.
 * - Assigns working-set ordinals dynamically (1..6).
 * - Excludes warm-ups from ordinal counting.
 * - Allows skipped working sets to retain a working-set ordinal.
 * - Preserves gaps so the pure engine can terminate evidence correctly.
 * - Attaches current isWarmup, isSkipped, isDropSet, and dropSubSets metadata to committed evidence.
 * - Maps prescribed snapshots to their current working-set ordinals.
 * - Maps active displayed values into currentTargets.
 * - Returns triggering working-set ordinal.
 * - Leaves ordinals above 6 unsupported.
 * - Never mutates inputs.
 */
export function prepareLiveAdjustmentParams(
  input: PrepareLiveAdjustmentParamsInput
): PrepareLiveAdjustmentParamsResult {
  const {
    exercise,
    exIdx,
    objective,
    algorithmId,
    profileType,
    baselineE1RM,
    prescribedTargetSnapshots,
    committedLiveEvidenceBySet,
    triggeringSetIdx,
  } = input;

  if (!exercise || !exercise.sets || exercise.sets.length === 0) {
    return { success: false, failureReason: 'no_exercise_sets' };
  }

  if (objective !== 'Hypertrophy' && objective !== 'Strength') {
    return { success: false, failureReason: 'unsupported_objective' };
  }

  const triggeringOrdinal = deriveWorkingSetOrdinal(exercise.sets, triggeringSetIdx);
  if (triggeringOrdinal === null || triggeringOrdinal < 1 || triggeringOrdinal > 6) {
    return { success: false, failureReason: 'invalid_or_warmup_triggering_set' };
  }

  const prescribedTargets: LiveTargetSnapshot[] = [];
  const currentTargets: LiveTargetSnapshot[] = [];
  const committedEvidence: CommittedLiveEvidence[] = [];

  let currentOrdinal = 0;
  for (let sIdx = 0; sIdx < exercise.sets.length; sIdx++) {
    const s = exercise.sets[sIdx];
    if (s.isWarmup) {
      // Warm-ups do not get working-set ordinals
      continue;
    }

    currentOrdinal++;
    if (currentOrdinal > 6) {
      // Ordinals above 6 unsupported
      continue;
    }

    const setKey = `${exIdx}-${sIdx}`;

    // 1. Prescribed snapshot mapping
    const snapshot = prescribedTargetSnapshots[setKey];
    if (
      snapshot &&
      typeof snapshot.weight === 'number' &&
      snapshot.weight > 0 &&
      typeof snapshot.reps === 'number' &&
      snapshot.reps > 0 &&
      typeof snapshot.rpe === 'number' &&
      snapshot.rpe >= 6.0 &&
      snapshot.rpe <= 10.0
    ) {
      prescribedTargets.push({
        workingSetOrdinal: currentOrdinal,
        weight: snapshot.weight,
        reps: snapshot.reps,
        rpe: snapshot.rpe,
      });
    }

    // 2. Current active targets mapping
    if (
      typeof s.weight === 'number' &&
      s.weight > 0 &&
      typeof s.reps === 'number' &&
      s.reps > 0 &&
      typeof s.rpe === 'number' &&
      s.rpe >= 6.0 &&
      s.rpe <= 10.0
    ) {
      currentTargets.push({
        workingSetOrdinal: currentOrdinal,
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe,
      });
    }

    // 3. Committed evidence mapping
    const committed = committedLiveEvidenceBySet[setKey];
    if (committed !== undefined) {
      const dropSubSetsFormatted = s.dropSubSets && s.dropSubSets.length > 0
        ? s.dropSubSets.map(sub => ({
            reps: typeof sub.reps === 'number' ? sub.reps : 0,
            weight: typeof sub.weight === 'number' ? sub.weight : 0,
            rpe: 10,
          }))
        : null;

      committedEvidence.push({
        workingSetOrdinal: currentOrdinal,
        weight: committed.weight,
        reps: committed.reps,
        rpe: committed.rpe,
        form: committed.form,
        isWarmup: s.isWarmup ?? false,
        isSkipped: s.isSkipped ?? false,
        isDropSet: s.isDropSet ?? false,
        dropSubSets: dropSubSetsFormatted,
      });
    }
  }

  const params: LiveAdjustmentParams = {
    objective,
    algorithmId,
    profileType,
    baselineE1RM,
    movementCategory: exercise.movementCategory,
    equipment: exercise.equipment,
    modality: exercise.modality,
    isMainMovement: exercise.isMainMovement ?? false,
    prescribedTargets,
    currentTargets,
    committedEvidence,
    triggeringWorkingSetOrdinal: triggeringOrdinal,
  };

  return {
    success: true,
    params,
  };
}

/**
 * Parameters for applying pure LiveAdjustmentResult to an active ExerciseEntry.
 */
export interface ApplyLiveAdjustmentResultParams {
  exercise: ExerciseEntry;
  exIdx: number;
  result: LiveAdjustmentResult;
  prescribedTargetSnapshots: PrescribedTargetSnapshotMap;
  currentLiveAdjustedSets: LiveAdjustedSetMap;
  userTouchedSets: Record<string, boolean>;
  focusedSetKey: string | null;
  activeSelectorRowKey: string | null;
  triggeringRowIndex: number;
}

/**
 * Output of applying LiveAdjustmentResult to an active ExerciseEntry.
 */
export interface ApplyLiveAdjustmentResultOutput {
  updatedExercise: ExerciseEntry;
  updatedLiveAdjustedSets: LiveAdjustedSetMap;
  changedRowKeys: string[];
  restoredRowKeys: string[];
  appliedChangeCount: number;
}

/**
 * Pure helper that applies a LiveAdjustmentResult to one active ExerciseEntry.
 *
 * Rules:
 * - Dynamically maps working-set ordinals to row indices.
 * - Protects triggering row (removes its own liveAdjustedSets marker, never overwrites it).
 * - Applies candidate targets to eligible future rows (ordinal > triggeringOrdinal, ordinal <= 6,
 *   !isWarmup, !isSkipped, !exercise.isSkipped, !userTouched, key !== focusedSetKey, key !== activeSelectorRowKey).
 * - Updates only weight, reps, and RPE for eligible rows, preserving all other fields verbatim.
 * - If new weight/reps/rpe differs from prescribedTargetSnapshot, sets liveAdjustedSets[key] = true.
 * - If new weight/reps/rpe matches prescribedTargetSnapshot, removes liveAdjustedSets[key].
 * - If new weight/reps/rpe equals currently displayed row, does not rewrite row.
 * - Handles invalid_evidence with restorePrescribedOrdinals by restoring marked eligible rows.
 * - Never marks future rows as user-touched.
 * - Returns immutable updatedExercise, updatedLiveAdjustedSets, changedRowKeys, restoredRowKeys, and appliedChangeCount.
 */
export function applyLiveAdjustmentResult(
  params: ApplyLiveAdjustmentResultParams
): ApplyLiveAdjustmentResultOutput {
  const {
    exercise,
    exIdx,
    result,
    prescribedTargetSnapshots,
    currentLiveAdjustedSets,
    userTouchedSets,
    focusedSetKey,
    activeSelectorRowKey,
    triggeringRowIndex,
  } = params;

  const triggeringKey = `${exIdx}-${triggeringRowIndex}`;
  const updatedLiveAdjustedSets: LiveAdjustedSetMap = { ...currentLiveAdjustedSets };
  delete updatedLiveAdjustedSets[triggeringKey];

  const changedRowKeys: string[] = [];
  const restoredRowKeys: string[] = [];

  if (!exercise || !exercise.sets || exercise.sets.length === 0 || exercise.isSkipped) {
    return {
      updatedExercise: exercise,
      updatedLiveAdjustedSets,
      changedRowKeys,
      restoredRowKeys,
      appliedChangeCount: 0,
    };
  }

  const triggeringOrdinal = deriveWorkingSetOrdinal(exercise.sets, triggeringRowIndex);

  // Case A: Engine returned candidate targets (status: 'adjusted' or non-empty candidateTargets)
  if (result.candidateTargets && result.candidateTargets.length > 0 && result.status !== 'invalid_evidence') {
    const candidateMap = new Map<number, LiveTargetSnapshot>();
    for (const cand of result.candidateTargets) {
      candidateMap.set(cand.workingSetOrdinal, cand);
    }

    const newSets = exercise.sets.map((s, sIdx) => {
      if (s.isWarmup) return s;

      const ordinal = deriveWorkingSetOrdinal(exercise.sets, sIdx);
      if (ordinal === null || triggeringOrdinal === null || ordinal <= triggeringOrdinal || ordinal > 6) {
        return s;
      }

      const key = `${exIdx}-${sIdx}`;

      // Protection filters
      if (s.isSkipped) return s;
      if (userTouchedSets[key]) return s;
      if (key === focusedSetKey) return s;
      if (key === activeSelectorRowKey) return s;

      const prescribed = prescribedTargetSnapshots[key];
      if (!prescribed) return s;

      const candidate = candidateMap.get(ordinal);
      if (!candidate) return s;

      const currentMatches =
        s.weight === candidate.weight &&
        s.reps === candidate.reps &&
        s.rpe === candidate.rpe;

      const prescribedMatches =
        candidate.weight === prescribed.weight &&
        candidate.reps === prescribed.reps &&
        candidate.rpe === prescribed.rpe;

      if (prescribedMatches) {
        delete updatedLiveAdjustedSets[key];
      } else {
        updatedLiveAdjustedSets[key] = true;
      }

      if (currentMatches) {
        return s;
      }

      changedRowKeys.push(key);
      return {
        ...s,
        weight: candidate.weight,
        reps: candidate.reps,
        rpe: candidate.rpe,
      };
    });

    return {
      updatedExercise: { ...exercise, sets: newSets },
      updatedLiveAdjustedSets,
      changedRowKeys,
      restoredRowKeys,
      appliedChangeCount: changedRowKeys.length,
    };
  }

  // Case B: Invalid evidence recommitment -> automatic restoration of marked eligible rows
  if (result.status === 'invalid_evidence' && result.restorePrescribedOrdinals && result.restorePrescribedOrdinals.length > 0) {
    const ordinalsToRestore = new Set(result.restorePrescribedOrdinals);

    const newSets = exercise.sets.map((s, sIdx) => {
      if (s.isWarmup) return s;

      const ordinal = deriveWorkingSetOrdinal(exercise.sets, sIdx);
      if (ordinal === null || !ordinalsToRestore.has(ordinal)) {
        return s;
      }

      const key = `${exIdx}-${sIdx}`;

      // Protection filters
      if (s.isSkipped) return s;
      if (userTouchedSets[key]) return s;
      if (key === focusedSetKey) return s;
      if (key === activeSelectorRowKey) return s;
      if (!currentLiveAdjustedSets[key]) return s; // Only restore rows currently marked in liveAdjustedSets!

      const prescribed = prescribedTargetSnapshots[key];
      if (!prescribed) return s;

      delete updatedLiveAdjustedSets[key];
      restoredRowKeys.push(key);

      return {
        ...s,
        weight: prescribed.weight,
        reps: prescribed.reps,
        rpe: prescribed.rpe,
      };
    });

    return {
      updatedExercise: { ...exercise, sets: newSets },
      updatedLiveAdjustedSets,
      changedRowKeys,
      restoredRowKeys,
      appliedChangeCount: restoredRowKeys.length,
    };
  }

  // Case C: No change, bypassed, or unhandled
  return {
    updatedExercise: exercise,
    updatedLiveAdjustedSets,
    changedRowKeys: [],
    restoredRowKeys: [],
    appliedChangeCount: 0,
  };
}

/**
 * Parameters for checking if an exercise has restorable live targets.
 */
export interface CanRestorePlannedTargetsParams {
  exercise: ExerciseEntry;
  exIdx: number;
  prescribedTargetSnapshots: PrescribedTargetSnapshotMap;
  currentLiveAdjustedSets: LiveAdjustedSetMap;
  userTouchedSets: Record<string, boolean>;
  focusedSetKey: string | null;
  activeSelectorRowKey: string | null;
}

/**
 * Pure helper to determine whether an exercise has at least one restorable live-adjusted set.
 */
export function canRestorePlannedTargets(params: CanRestorePlannedTargetsParams): boolean {
  const {
    exercise,
    exIdx,
    prescribedTargetSnapshots,
    currentLiveAdjustedSets,
    userTouchedSets,
    focusedSetKey,
    activeSelectorRowKey,
  } = params;

  if (!exercise || exercise.isSkipped || !exercise.sets || exercise.sets.length === 0) {
    return false;
  }

  for (let sIdx = 0; sIdx < exercise.sets.length; sIdx++) {
    const s = exercise.sets[sIdx];
    if (s.isWarmup || s.isSkipped) continue;
    const key = `${exIdx}-${sIdx}`;
    if (!currentLiveAdjustedSets[key]) continue;
    if (userTouchedSets[key]) continue;
    if (key === focusedSetKey) continue;
    if (key === activeSelectorRowKey) continue;
    const prescribed = prescribedTargetSnapshots[key];
    if (!prescribed) continue;
    return true;
  }

  return false;
}

/**
 * Parameters for restoring planned targets on an exercise.
 */
export interface RestorePlannedTargetsParams {
  exercise: ExerciseEntry;
  exIdx: number;
  prescribedTargetSnapshots: PrescribedTargetSnapshotMap;
  currentLiveAdjustedSets: LiveAdjustedSetMap;
  userTouchedSets: Record<string, boolean>;
  focusedSetKey: string | null;
  activeSelectorRowKey: string | null;
}

/**
 * Output of restoring planned targets on an exercise.
 */
export interface RestorePlannedTargetsOutput {
  updatedExercise: ExerciseEntry;
  updatedLiveAdjustedSets: LiveAdjustedSetMap;
  restoredRowKeys: string[];
}

/**
 * Pure helper that restores every eligible row for an exercise that is marked in liveAdjustedSets.
 *
 * Rules:
 * - Restores only weight, reps, and RPE from prescribedTargetSnapshots.
 * - Preserves all other set and exercise metadata verbatim.
 * - Does not clear userTouchedSets.
 * - Does not clear committedLiveEvidenceBySet.
 * - Clears live-adjusted markers only for rows actually restored.
 * - Does not affect triggering or previously performed rows.
 */
export function restorePlannedTargetsForExercise(
  params: RestorePlannedTargetsParams
): RestorePlannedTargetsOutput {
  const {
    exercise,
    exIdx,
    prescribedTargetSnapshots,
    currentLiveAdjustedSets,
    userTouchedSets,
    focusedSetKey,
    activeSelectorRowKey,
  } = params;

  const updatedLiveAdjustedSets: LiveAdjustedSetMap = { ...currentLiveAdjustedSets };
  const restoredRowKeys: string[] = [];

  if (!exercise || exercise.isSkipped || !exercise.sets || exercise.sets.length === 0) {
    return {
      updatedExercise: exercise,
      updatedLiveAdjustedSets,
      restoredRowKeys: [],
    };
  }

  const newSets = exercise.sets.map((s, sIdx) => {
    if (s.isWarmup || s.isSkipped) return s;
    const key = `${exIdx}-${sIdx}`;
    if (!currentLiveAdjustedSets[key]) return s;
    if (userTouchedSets[key]) return s;
    if (key === focusedSetKey) return s;
    if (key === activeSelectorRowKey) return s;
    const prescribed = prescribedTargetSnapshots[key];
    if (!prescribed) return s;

    delete updatedLiveAdjustedSets[key];
    restoredRowKeys.push(key);
    return {
      ...s,
      weight: prescribed.weight,
      reps: prescribed.reps,
      rpe: prescribed.rpe,
    };
  });

  return {
    updatedExercise: { ...exercise, sets: newSets },
    updatedLiveAdjustedSets,
    restoredRowKeys,
  };
}

/**
 * Parameters for evaluating whether a low-RPE informational message should be displayed.
 */
export interface ShouldShowLowRPEExplanationInput {
  objective: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  exercise?: ExerciseEntry;
  setIdx: number;
  rpe: number;
}

/**
 * Pure helper to determine if the low-RPE explanatory notification should be displayed.
 *
 * Rules:
 * - Triggered only when RPE is below 6.0 (e.g., 4, 4.5, 5, 5.5). RPE 6.0 and above return false.
 * - Objective must be Hypertrophy or Strength (Off and Deload return false).
 * - Exercise must exist and not be skipped (exercise.isSkipped !== true).
 * - Modality must be weighted (exercise.modality === undefined || exercise.modality === 'weighted').
 *   Non-weighted modalities (bodyweight, assisted, timed, distance, distance_loaded) return false.
 * - In Strength objective, only main movements participate in live adjustments (exercise.isMainMovement === true).
 * - Set must exist, not be a warm-up, and not be skipped (set.isWarmup !== true && set.isSkipped !== true).
 * - Set must be within working-set ordinals 1..6.
 */
export function shouldShowLowRPEExplanation(input: ShouldShowLowRPEExplanationInput): boolean {
  const { objective, exercise, setIdx, rpe } = input;

  if (typeof rpe !== 'number' || isNaN(rpe) || rpe >= 6.0) {
    return false;
  }

  if (objective !== 'Hypertrophy' && objective !== 'Strength') {
    return false;
  }

  if (!exercise || exercise.isSkipped === true) {
    return false;
  }

  if (exercise.modality !== undefined && exercise.modality !== 'weighted') {
    return false;
  }

  if (objective === 'Strength' && exercise.isMainMovement !== true) {
    return false;
  }

  if (!exercise.sets || setIdx < 0 || setIdx >= exercise.sets.length) {
    return false;
  }

  const set = exercise.sets[setIdx];
  if (!set || set.isWarmup === true || set.isSkipped === true) {
    return false;
  }

  const ordinal = deriveWorkingSetOrdinal(exercise.sets, setIdx);
  if (ordinal === null || ordinal < 1 || ordinal > 6) {
    return false;
  }

  return true;
}

/**
 * Timing constants for live adjustment and explanatory bottom toast notifications.
 */
export const LIVE_ADJUSTMENT_SUCCESS_TOAST_DURATION_MS = 5000;
export const DEFAULT_TOAST_DURATION_MS = 2500;
export const LOW_RPE_EXPLANATION_TOAST_DURATION_MS = 2500;

export const LIVE_ADJUSTMENT_SUCCESS_MESSAGE = "Later-set targets adjusted for today's performance.";
export const LOW_RPE_EXPLANATION_MESSAGE = "RPE below 6 was recorded but is not used for live target adjustments.";

export interface ToastTimerHandle {
  timer: any | null;
}

/**
 * Manages showing a toast notification with timer reset and cancellation semantics.
 * Clears any pending timer, sets the message, and schedules dismissal after durationMs.
 */
export function scheduleToastNotification(
  handle: ToastTimerHandle,
  setMessage: (msg: string | null) => void,
  message: string = LIVE_ADJUSTMENT_SUCCESS_MESSAGE,
  durationMs: number = DEFAULT_TOAST_DURATION_MS
): void {
  if (handle.timer) {
    clearTimeout(handle.timer);
    handle.timer = null;
  }
  setMessage(message);
  handle.timer = setTimeout(() => {
    setMessage(null);
    handle.timer = null;
  }, durationMs);
}

/**
 * Safely cleans up any active toast timer on component unmount.
 */
export function cleanupToastNotification(handle: ToastTimerHandle): void {
  if (handle.timer) {
    clearTimeout(handle.timer);
    handle.timer = null;
  }
}

