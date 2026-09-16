/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ExerciseEntry,
  GuidedCoachingReasonCode,
  PrescriptionSnapshot,
  Program,
  SetEntry,
  WeightUnit,
  WorkoutLog,
} from '../types';
import { resolveProgramProgressionMode } from './programProgressionMode';
import {
  BasePrescriptionSet,
  ClosedPeriodisationLaneContext,
  GuidedBypassReason,
  GuidedConstructionContext,
  GuidedSelectorDiagnostics,
  GuidedSessionKind,
  SelectGuidedPrescriptionInput,
  SelectGuidedPrescriptionResult,
  selectGuidedPrescription,
} from './guidedTargetSelector';
import { GuidedHistoryBoundary } from './guidedHistoryCollector';

export interface GuidedExerciseAdapterInput {
  readonly exercise: ExerciseEntry;
  readonly baseSets: readonly SetEntry[];
  readonly program: Program;
  readonly programs: readonly Program[];
  readonly historicalLogs: readonly WorkoutLog[];
  readonly boundary: GuidedHistoryBoundary;
  readonly sessionKind: GuidedSessionKind;
  readonly activeUnit: WeightUnit;
  readonly canonicalIncrement: number;
  readonly periodisationLane: ClosedPeriodisationLaneContext;
  readonly construction: GuidedConstructionContext;
}

export interface GuidedExerciseAdapterPerformanceLedResult {
  readonly status: 'performance_led_unchanged';
  readonly exercise: ExerciseEntry;
  readonly appliedSets: readonly SetEntry[];
  readonly snapshots: readonly [];
  readonly diagnostics: null;
}

export interface GuidedExerciseAdapterGuidedAppliedResult {
  readonly status: 'guided_applied';
  readonly exercise: ExerciseEntry;
  readonly appliedSets: readonly SetEntry[];
  readonly snapshots: readonly PrescriptionSnapshot[];
  readonly coachingReasonCode: GuidedCoachingReasonCode;
  readonly diagnostics: GuidedSelectorDiagnostics;
}

export interface GuidedExerciseAdapterGuidedBypassedResult {
  readonly status: 'guided_bypassed';
  readonly exercise: ExerciseEntry;
  readonly appliedSets: readonly SetEntry[];
  readonly snapshots: readonly [];
  readonly bypassReason: GuidedBypassReason;
  readonly diagnostics: null;
}

export interface GuidedExerciseAdapterGuidedInvalidInputFallbackResult {
  readonly status: 'guided_invalid_input_fallback';
  readonly errorSource: 'selector';
  readonly exercise: ExerciseEntry;
  readonly appliedSets: readonly SetEntry[];
  readonly snapshots: readonly [];
  readonly selectorError: string;
  readonly selectorErrorMessage: string;
  readonly diagnostics: readonly string[];
}

export type GuidedAdapterFailureKind =
  | 'input_validation'
  | 'mapping_invariant';

export type GuidedAdapterErrorCode =
  | 'MALFORMED_INPUT'
  | 'MISSING_EXERCISE'
  | 'MAPPING_CARDINALITY_MISMATCH';

export interface GuidedExerciseAdapterFailureFallbackResult {
  readonly status: 'guided_adapter_failure_fallback';
  readonly errorSource: 'adapter';
  readonly failureKind: GuidedAdapterFailureKind;
  readonly exercise: ExerciseEntry;
  readonly appliedSets: readonly SetEntry[];
  readonly snapshots: readonly [];
  readonly adapterError: GuidedAdapterErrorCode;
  readonly adapterErrorMessage: string;
  readonly diagnostics: readonly string[];
}

export type GuidedExerciseAdapterResult =
  | GuidedExerciseAdapterPerformanceLedResult
  | GuidedExerciseAdapterGuidedAppliedResult
  | GuidedExerciseAdapterGuidedBypassedResult
  | GuidedExerciseAdapterGuidedInvalidInputFallbackResult
  | GuidedExerciseAdapterFailureFallbackResult;

/**
 * Pure predicate identifying whether a set is an eligible prescribed working set.
 * Non-prescribed sets (warm-up sets and drop sets) are excluded.
 */
export function isPrescribedWorkingSet(set: SetEntry | undefined | null): boolean {
  if (!set || typeof set !== 'object') return false;
  if (set.isWarmup === true) return false;
  if (set.isDropSet === true) return false;
  if (Array.isArray(set.dropSubSets) && set.dropSubSets.length > 0) return false;
  return true;
}

function cloneSet(s: SetEntry): SetEntry {
  return {
    ...s,
    dropSubSets: Array.isArray(s.dropSubSets)
      ? s.dropSubSets.map(sub => ({ ...sub }))
      : s.dropSubSets,
  };
}

function cloneSets(sets: readonly SetEntry[]): SetEntry[] {
  return sets.map(cloneSet);
}

function cloneSetsWithoutGuidedSnapshots(sets: readonly SetEntry[]): SetEntry[] {
  return sets.map(s => {
    const cloned = cloneSet(s);
    cloned.prescriptionSnapshot = null;
    return cloned;
  });
}

function cloneExercise(exercise: ExerciseEntry, newSets: SetEntry[]): ExerciseEntry {
  return {
    ...exercise,
    sets: newSets,
  };
}

export interface ApplyGuidedSelectorResultInput {
  readonly exercise: ExerciseEntry;
  readonly baseSets: readonly SetEntry[];
  readonly workingSetIndices: readonly number[];
  readonly selectorResult: SelectGuidedPrescriptionResult;
}

/**
 * Pure result application helper validating and applying an already-produced
 * SelectGuidedPrescriptionResult onto an exercise and its base sets.
 *
 * Enforces atomic mapping invariants:
 * - If selectorResult is invalid_input, returns guided_invalid_input_fallback with errorSource: 'selector'.
 * - If selectorResult is bypass, returns guided_bypassed with base targets and no snapshots.
 * - If selectorResult is guided, strictly validates that snapshots and presentedPrescription
 *   have matching counts and contiguous ordinals 1..N matching workingSetIndices.
 *   If any invariant fails, falls back safely to guided_adapter_failure_fallback with
 *   errorSource: 'adapter', failureKind: 'mapping_invariant', and adapterError: 'MAPPING_CARDINALITY_MISMATCH'.
 * - If mapping succeeds, atomically applies targets and snapshots to prescribed working sets.
 */
export function applyGuidedSelectorResult(
  input: ApplyGuidedSelectorResultInput
):
  | GuidedExerciseAdapterGuidedAppliedResult
  | GuidedExerciseAdapterGuidedBypassedResult
  | GuidedExerciseAdapterGuidedInvalidInputFallbackResult
  | GuidedExerciseAdapterFailureFallbackResult {
  const { exercise, baseSets, workingSetIndices, selectorResult } = input;

  if (selectorResult.status === 'invalid_input') {
    const fallbackSets = cloneSetsWithoutGuidedSnapshots(baseSets);
    return {
      status: 'guided_invalid_input_fallback',
      errorSource: 'selector',
      exercise: cloneExercise(exercise, fallbackSets),
      appliedSets: fallbackSets,
      snapshots: [],
      selectorError: selectorResult.error,
      selectorErrorMessage: selectorResult.errorMessage,
      diagnostics: selectorResult.diagnostics || [],
    };
  }

  if (selectorResult.status === 'bypass') {
    const presByOrdinal = new Map<number, BasePrescriptionSet>();
    for (const p of selectorResult.presentedPrescription) {
      presByOrdinal.set(p.workingSetOrdinal, p);
    }

    const appliedSets = baseSets.map((s, idx) => {
      const ordinalIdx = workingSetIndices.indexOf(idx);
      if (ordinalIdx === -1) {
        // Warmups, drop sets, and other non-prescribed sets remain unchanged
        return cloneSet(s);
      }
      const ordinal = ordinalIdx + 1;
      const pres = presByOrdinal.get(ordinal);
      return {
        ...cloneSet(s),
        weight: pres ? pres.weight : s.weight,
        reps: pres ? pres.reps : s.reps,
        rpe: pres ? pres.rpe : s.rpe,
        prescriptionSnapshot: null,
      };
    });

    return {
      status: 'guided_bypassed',
      exercise: cloneExercise(exercise, appliedSets),
      appliedSets,
      snapshots: [],
      bypassReason: selectorResult.bypassReason,
      diagnostics: null,
    };
  }

  // selectorResult.status === 'guided'
  // Safety verification: verify complete atomic mapping
  const isMappingComplete =
    selectorResult.snapshots.length === workingSetIndices.length &&
    selectorResult.presentedPrescription.length === workingSetIndices.length &&
    workingSetIndices.every((_, ordinalIdx) => {
      const expectedOrdinal = ordinalIdx + 1;
      return (
        selectorResult.snapshots[ordinalIdx]?.workingSetOrdinal === expectedOrdinal &&
        selectorResult.presentedPrescription[ordinalIdx]?.workingSetOrdinal === expectedOrdinal
      );
    });

  if (!isMappingComplete) {
    // Atomic mapping failure: fall back to base exercise without Guided snapshots
    const fallbackSets = cloneSetsWithoutGuidedSnapshots(baseSets);
    return {
      status: 'guided_adapter_failure_fallback',
      errorSource: 'adapter',
      failureKind: 'mapping_invariant',
      exercise: cloneExercise(exercise, fallbackSets),
      appliedSets: fallbackSets,
      snapshots: [],
      adapterError: 'MAPPING_CARDINALITY_MISMATCH',
      adapterErrorMessage: 'Ordinal or cardinality mismatch between selector output and base working sets.',
      diagnostics: [],
    };
  }

  const snapshotsByOrdinal = new Map<number, PrescriptionSnapshot>();
  for (const snap of selectorResult.snapshots) {
    snapshotsByOrdinal.set(snap.workingSetOrdinal, snap);
  }
  const presByOrdinal = new Map<number, BasePrescriptionSet>();
  for (const p of selectorResult.presentedPrescription) {
    presByOrdinal.set(p.workingSetOrdinal, p);
  }

  const appliedSets = baseSets.map((s, idx) => {
    const ordinalIdx = workingSetIndices.indexOf(idx);
    if (ordinalIdx === -1) {
      // Warmups, drop sets, and other non-prescribed sets remain unchanged
      return cloneSet(s);
    }
    const ordinal = ordinalIdx + 1;
    const pres = presByOrdinal.get(ordinal)!;
    const snap = snapshotsByOrdinal.get(ordinal)!;
    return {
      ...cloneSet(s),
      weight: pres.weight,
      reps: pres.reps,
      rpe: pres.rpe,
      prescriptionSnapshot: snap,
    };
  });

  return {
    status: 'guided_applied',
    exercise: cloneExercise(exercise, appliedSets),
    appliedSets,
    snapshots: selectorResult.snapshots,
    coachingReasonCode: selectorResult.coachingReasonCode,
    diagnostics: selectorResult.diagnostics,
  };
}

/**
 * Pure post-processing runtime adapter bridging canonical base targets and
 * the pure Guided target selector according to Design B.
 *
 * Guaranteed invariants:
 * - Does not call calculateObjectiveSets or reproduce target mathematics.
 * - For performance_led programs, immediately returns performance_led_unchanged with zero Guided snapshots.
 * - For eligible metreps_guided programs, delegates to selectGuidedPrescription as the sole authority.
 * - Translates selector outputs into the locked 5-way adapter result union.
 * - Atomically maps selector prescriptions and snapshots onto prescribed working sets by ordinal.
 * - Preserves warm-ups, drop-sets, comments, completion status, form, and non-target metadata untouched.
 * - Never mutates input objects or leaks mutable aliases.
 */
export function adaptGuidedExercisePrescription(
  input: GuidedExerciseAdapterInput
): GuidedExerciseAdapterResult {
  // Defensive input validation
  if (!input || typeof input !== 'object') {
    return {
      status: 'guided_adapter_failure_fallback',
      errorSource: 'adapter',
      failureKind: 'input_validation',
      exercise: { name: '', muscleGroup: '', sets: [] },
      appliedSets: [],
      snapshots: [],
      adapterError: 'MALFORMED_INPUT',
      adapterErrorMessage: 'Adapter input must be an object.',
      diagnostics: [],
    };
  }

  const baseSets = Array.isArray(input.baseSets)
    ? input.baseSets
    : Array.isArray(input.exercise?.sets)
    ? input.exercise.sets
    : [];

  if (!input.exercise || typeof input.exercise !== 'object') {
    const cleanSets = cloneSetsWithoutGuidedSnapshots(baseSets);
    return {
      status: 'guided_adapter_failure_fallback',
      errorSource: 'adapter',
      failureKind: 'input_validation',
      exercise: { name: '', muscleGroup: '', sets: cleanSets },
      appliedSets: cleanSets,
      snapshots: [],
      adapterError: 'MISSING_EXERCISE',
      adapterErrorMessage: 'exercise entry is required.',
      diagnostics: [],
    };
  }

  // 1. Progression Mode: Performance-led bypasses Guided selector entirely
  const progressionMode = resolveProgramProgressionMode(input.program);
  if (progressionMode === 'performance_led') {
    const cleanSets = cloneSets(baseSets);
    return {
      status: 'performance_led_unchanged',
      exercise: cloneExercise(input.exercise, cleanSets),
      appliedSets: cleanSets,
      snapshots: [],
      diagnostics: null,
    };
  }

  // 2. Identify prescribed working sets and ordinals
  const workingSetIndices: number[] = [];
  for (let i = 0; i < baseSets.length; i++) {
    if (isPrescribedWorkingSet(baseSets[i])) {
      workingSetIndices.push(i);
    }
  }

  const basePrescriptionSets: BasePrescriptionSet[] = workingSetIndices.map((setIdx, ordinalIdx) => {
    const s = baseSets[setIdx];
    return {
      workingSetOrdinal: ordinalIdx + 1,
      weight: typeof s.weight === 'number' ? s.weight : 0,
      reps: typeof s.reps === 'number' ? s.reps : 0,
      rpe: typeof s.rpe === 'number' ? s.rpe : 0,
    };
  });

  // 3. Delegate to pure Guided target selector
  const selectorInput: SelectGuidedPrescriptionInput = {
    exercise: input.exercise,
    program: input.program,
    programs: input.programs,
    historicalLogs: input.historicalLogs,
    boundary: input.boundary,
    sessionKind: input.sessionKind,
    basePrescriptionSets,
    activeUnit: input.activeUnit,
    canonicalIncrement: input.canonicalIncrement,
    periodisationLane: input.periodisationLane,
    construction: input.construction,
  };

  const selectorResult: SelectGuidedPrescriptionResult = selectGuidedPrescription(selectorInput);

  // 4. Translate selector result into adapter result variants via pure application helper
  return applyGuidedSelectorResult({
    exercise: input.exercise,
    baseSets,
    workingSetIndices,
    selectorResult,
  });
}

export const adaptExercisePrescription = adaptGuidedExercisePrescription;
