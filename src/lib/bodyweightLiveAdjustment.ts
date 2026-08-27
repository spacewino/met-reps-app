/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BodyweightSnapshot, ExerciseEntry, WeightUnit, SetEntry } from '../types';
import { getRTSMultiplier } from './rpeMath';
import { getFatiguePrior, FatiguePriorProfile } from './setDistribution';
import { solveBodyweightRepTarget } from './modalityTargetMath';
import { getPermittedRepetitionBounds, resolveEffectiveAlgorithm } from './objectiveMath';
import { deriveColdStartOrdinalShape } from './coldStartCalibration';
import { resolveSessionBodyweightInUnit } from './bodyweightSessionMath';

export const UPWARD_READINESS_CAP_1_SET = 1.025;
export const DOWNWARD_READINESS_CAP = 0.85;
export const LOW_RPE_EXPLANATION_MESSAGE = "RPE below 6 was recorded but is not used for live target adjustments.";

export interface BodyweightCommittedEvidence {
  reps: number;
  rpe: number;
  isWarmup?: boolean;
  isSkipped?: boolean;
}

export interface BodyweightPrescribedTargetSnapshot {
  setNumber: number;
  weight: number;
  reps: number;
  rpe: number;
  form?: string;
  isWarmup?: boolean;
}

export interface EvaluateBodyweightLiveAdjustmentOptions {
  exercise: ExerciseEntry;
  exerciseIndex: number;
  sessionBodyweightSnapshot: BodyweightSnapshot | null;
  activeUnit: WeightUnit;
  committedEvidenceBySet: Record<string, BodyweightCommittedEvidence>;
  prescribedTargetSnapshots: Record<string, BodyweightPrescribedTargetSnapshot>;
  userTouchedSets: Record<string, boolean>;
  checkedSets: Record<string, boolean>;
  contextualBaselineE1RM?: number | null;
  objective?: string;
  algorithmId?: string;
  isMainMovement?: boolean;
}

export interface BodyweightAdjustedSetTarget {
  setNumber: number;
  weight: 0;
  reps: number;
  rpe: number;
  form: string;
  isWarmup?: boolean;
  achievedE1RM?: number;
  targetE1RM?: number;
}

export interface BodyweightLiveAdjustmentResult {
  status: 'adjusted' | 'no_change' | 'bypassed' | 'constrained';
  readinessRatio?: number;
  rawReadinessRatio?: number;
  clampedReadinessRatio?: number;
  plannedCapacity?: number;
  observedCapacity?: number;
  adjustedBaselineE1RM?: number;
  adjustedSets: SetEntry[];
  changedRowKeys: string[];
  shouldNotify: boolean;
  explanationMessage?: string;
  bypassReason?: string;
}

export interface CalculateAddedBodyweightSetTargetOptions {
  exercise: ExerciseEntry;
  exerciseIndex: number;
  addedSetNumber: number;
  sessionBodyweightSnapshot: BodyweightSnapshot | null;
  activeUnit: WeightUnit;
  committedEvidenceBySet?: Record<string, BodyweightCommittedEvidence>;
  prescribedTargetSnapshots?: Record<string, BodyweightPrescribedTargetSnapshot>;
  contextualBaselineE1RM?: number | null;
  objective?: 'Off' | 'Hypertrophy' | 'Strength' | 'Deload';
  algorithmId?: string;
  isMainMovement?: boolean;
  weekNum?: number;
  programDuration?: number;
  targetReps?: number;
  targetRPE?: number;
  prescribedTargetShape?: {
    reps: number;
    rpe: number;
    form?: 'standard' | 'strict' | 'loose';
  };
}

/**
 * Pure helper to calculate planned bodyweight session capacity.
 */
export function calculatePlannedBodyweightCapacity(
  sessionBodyweight: number,
  plannedReps: number,
  plannedRPE: number
): number | null {
  if (sessionBodyweight <= 0 || plannedReps <= 0 || plannedRPE < 6.0 || plannedRPE > 10.0) {
    return null;
  }
  const mult = getRTSMultiplier(plannedReps, plannedRPE);
  if (!mult || mult <= 0) return null;
  return sessionBodyweight / mult;
}

/**
 * Pure helper to calculate observed bodyweight session capacity.
 */
export function calculateObservedBodyweightCapacity(
  sessionBodyweight: number,
  actualReps: number,
  actualRPE: number
): number | null {
  if (sessionBodyweight <= 0 || actualReps <= 0 || actualRPE < 6.0 || actualRPE > 10.0) {
    return null;
  }
  const mult = getRTSMultiplier(actualReps, actualRPE);
  if (!mult || mult <= 0) return null;
  return sessionBodyweight / mult;
}

/**
 * Pure helper to clamp readiness ratio using production bounds.
 */
export function clampBodyweightReadinessRatio(rawReadiness: number): number {
  if (!Number.isFinite(rawReadiness) || rawReadiness <= 0) {
    return 1.0;
  }
  return Math.max(DOWNWARD_READINESS_CAP, Math.min(UPWARD_READINESS_CAP_1_SET, rawReadiness));
}

/**
 * Evaluates reps-only Live Adjustment for a pure-bodyweight exercise.
 */
export function evaluateBodyweightLiveAdjustment(
  options: EvaluateBodyweightLiveAdjustmentOptions
): BodyweightLiveAdjustmentResult {
  const {
    exercise,
    exerciseIndex,
    sessionBodyweightSnapshot,
    activeUnit,
    committedEvidenceBySet,
    prescribedTargetSnapshots,
    userTouchedSets,
    checkedSets,
    contextualBaselineE1RM,
    objective = 'Hypertrophy',
    algorithmId = 'hypertrophy_linear',
    isMainMovement = false,
  } = options;

  // 1. Guard Modality
  if (exercise.modality !== 'bodyweight') {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      bypassReason: 'non_bodyweight_modality',
    };
  }

  // 2. Guard Objective & Deload
  if (objective === 'Off' || objective === 'Deload') {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      bypassReason: 'objective_off_or_deload',
    };
  }

  // 3. Guard Strength Non-Main Accessories
  if (objective === 'Strength' && !isMainMovement) {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      bypassReason: 'strength_accessory_bypassed',
    };
  }

  // 4. Resolve Bodyweight in Active Unit
  const bwVal = resolveSessionBodyweightInUnit(sessionBodyweightSnapshot, activeUnit);
  if (bwVal === null || bwVal <= 0) {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      bypassReason: 'missing_or_invalid_bodyweight_snapshot',
    };
  }

  // 5. Find Working Set 1 (first non-warmup, non-skipped set)
  let workingSet1Idx = -1;
  for (let i = 0; i < exercise.sets.length; i++) {
    const s = exercise.sets[i];
    if (!s.isWarmup && !s.isSkipped) {
      workingSet1Idx = i;
      break;
    }
  }

  if (workingSet1Idx === -1) {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      bypassReason: 'no_working_set_1_found',
    };
  }

  const set1Key = `${exerciseIndex}-${workingSet1Idx}`;
  const ev1 = committedEvidenceBySet[set1Key];
  const snap1 = prescribedTargetSnapshots[set1Key];

  if (!ev1 || ev1.isWarmup || ev1.isSkipped) {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      bypassReason: 'no_committed_evidence_at_working_set_1',
    };
  }

  if (!snap1) {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      bypassReason: 'missing_prescribed_target_snapshot_at_set_1',
    };
  }

  // Low RPE Guard (< 6.0)
  if (ev1.rpe < 6.0) {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      explanationMessage: LOW_RPE_EXPLANATION_MESSAGE,
      bypassReason: 'rpe_below_6',
    };
  }

  if (ev1.rpe > 10.0 || ev1.reps <= 0 || snap1.reps <= 0 || snap1.rpe < 6.0 || snap1.rpe > 10.0) {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      bypassReason: 'invalid_reps_or_rpe',
    };
  }

  // 6. Calculate Planned & Observed Capacities
  const plannedCap = calculatePlannedBodyweightCapacity(bwVal, snap1.reps, snap1.rpe);
  const observedCap = calculateObservedBodyweightCapacity(bwVal, ev1.reps, ev1.rpe);

  if (!plannedCap || !observedCap) {
    return {
      status: 'bypassed',
      adjustedSets: exercise.sets,
      changedRowKeys: [],
      shouldNotify: false,
      bypassReason: 'capacity_calculation_failed',
    };
  }

  const rawReadiness = observedCap / plannedCap;
  const clampedReadiness = clampBodyweightReadinessRatio(rawReadiness);

  // Determine Adjusted Baseline Capacity
  let adjustedBaselineE1RM: number;
  if (typeof contextualBaselineE1RM === 'number' && Number.isFinite(contextualBaselineE1RM) && contextualBaselineE1RM > 0) {
    adjustedBaselineE1RM = contextualBaselineE1RM * clampedReadiness;
  } else {
    adjustedBaselineE1RM = plannedCap * clampedReadiness;
  }

  // Profile fatigue priors
  let profile: FatiguePriorProfile = 'hypertrophy';
  if (objective === 'Strength') profile = 'strength_normal';

  const priors = getFatiguePrior(profile);

  // Bounds
  const isIsolation = exercise.muscleGroup === 'Biceps' || exercise.muscleGroup === 'Triceps' || exercise.muscleGroup === 'Calves';
  const bounds = getPermittedRepetitionBounds({
    objective: (objective === 'Strength' ? 'Strength' : objective === 'Deload' ? 'Deload' : 'Hypertrophy'),
    algorithmId: algorithmId as any,
    isIsolation,
    isMachine: false,
    anchorReps: snap1.reps,
  });

  const nextSets = [...exercise.sets];
  const changedRowKeys: string[] = [];

  // 7. Adjust Untouched Future Working Sets
  for (let sIdx = workingSet1Idx + 1; sIdx < exercise.sets.length; sIdx++) {
    const sKey = `${exerciseIndex}-${sIdx}`;
    const currSet = exercise.sets[sIdx];

    // Protect non-eligible sets
    if (currSet.isWarmup || currSet.isSkipped || checkedSets[sKey] || userTouchedSets[sKey]) {
      continue;
    }

    const snap = prescribedTargetSnapshots[sKey] || currSet;
    const workingOrdinal = sIdx - workingSet1Idx + 1; // 1-based working set index
    const fatiguePrior = priors[workingOrdinal - 1] ?? priors[priors.length - 1] ?? 1.0;
    const targetOrdinalCap = adjustedBaselineE1RM * fatiguePrior;
    const targetRpe = snap.rpe ?? currSet.rpe ?? 8.0;

    const solved = solveBodyweightRepTarget({
      targetE1RM: targetOrdinalCap,
      sessionBodyweight: bwVal,
      targetRPE: targetRpe,
      anchorReps: snap.reps ?? currSet.reps ?? 10,
      minReps: bounds.minReps,
      maxReps: bounds.maxReps,
      unit: activeUnit,
    });

    const newReps = solved.reps;
    if (newReps !== currSet.reps) {
      changedRowKeys.push(sKey);
      nextSets[sIdx] = {
        ...currSet,
        weight: 0,
        reps: newReps,
        rpe: targetRpe,
      };
    }
  }

  const hasChanges = changedRowKeys.length > 0;

  return {
    status: hasChanges ? 'adjusted' : 'no_change',
    readinessRatio: clampedReadiness,
    rawReadinessRatio: rawReadiness,
    clampedReadinessRatio: clampedReadiness,
    plannedCapacity: plannedCap,
    observedCapacity: observedCap,
    adjustedBaselineE1RM,
    adjustedSets: nextSets,
    changedRowKeys,
    shouldNotify: hasChanges,
  };
}

/**
 * Calculates target for an added bodyweight set using session calibration when evidence exists.
 */
export function calculateAddedBodyweightSetTarget(
  options: CalculateAddedBodyweightSetTargetOptions
): { weight: 0; reps: number; rpe: number; form: string } {
  const {
    exercise,
    exerciseIndex,
    addedSetNumber,
    sessionBodyweightSnapshot,
    activeUnit,
    committedEvidenceBySet,
    prescribedTargetSnapshots,
    contextualBaselineE1RM,
    objective = 'Hypertrophy',
    algorithmId = 'hypertrophy_linear',
    isMainMovement = false,
    weekNum = 1,
    programDuration = 8,
    targetReps,
    targetRPE,
    prescribedTargetShape,
  } = options;

  const bwVal = resolveSessionBodyweightInUnit(sessionBodyweightSnapshot, activeUnit);

  // If objective is Off or Deload, or bodyweight is missing, return unprescribed / fallback
  if (objective === 'Off' || objective === 'Deload' || bwVal === null || bwVal <= 0) {
    return {
      weight: 0,
      reps: targetReps ?? 10,
      rpe: targetRPE ?? 8.0,
      form: 'standard',
    };
  }

  if (objective === 'Strength' && !isMainMovement) {
    return {
      weight: 0,
      reps: targetReps ?? 5,
      rpe: targetRPE ?? 8.0,
      form: 'standard',
    };
  }

  // Determine working ordinal for the added set
  const nonWarmupCount = exercise.sets.filter(s => !s.isWarmup).length;
  const addedOrdinal = nonWarmupCount + 1;

  // Resolve canonical target shape for the requested ordinal
  let canonicalReps: number;
  let canonicalRPE: number;
  let canonicalForm: string = 'standard';
  let profile: FatiguePriorProfile = objective === 'Strength' ? 'strength_normal' : 'hypertrophy';

  if (prescribedTargetShape) {
    canonicalReps = prescribedTargetShape.reps;
    canonicalRPE = prescribedTargetShape.rpe;
    canonicalForm = prescribedTargetShape.form ?? 'standard';
  } else if (typeof targetReps === 'number' && typeof targetRPE === 'number') {
    canonicalReps = targetReps;
    canonicalRPE = targetRPE;
  } else {
    const effectiveAlgo = resolveEffectiveAlgorithm(
      objective === 'Strength' ? 'Strength' : 'Hypertrophy',
      algorithmId
    );
    const derived = effectiveAlgo
      ? deriveColdStartOrdinalShape({
          objective: objective === 'Strength' ? 'Strength' : 'Hypertrophy',
          algorithmId: effectiveAlgo,
          exercise,
          weekNum,
          programDuration,
          ordinal: Math.min(addedOrdinal, 6),
        })
      : null;

    if (derived) {
      canonicalReps = derived.reps;
      canonicalRPE = derived.rpe;
      canonicalForm = derived.form;
      profile = derived.profileType;
    } else {
      const snapKey = `${exerciseIndex}-${exercise.sets.length}`;
      const snap = prescribedTargetSnapshots ? prescribedTargetSnapshots[snapKey] : undefined;
      if (snap && snap.reps > 0 && snap.rpe >= 6.0) {
        canonicalReps = snap.reps;
        canonicalRPE = snap.rpe;
      } else {
        canonicalReps = 10;
        canonicalRPE = 8.0;
      }
    }
  }

  // Check if we have valid committed Set 1 evidence
  let workingSet1Idx = -1;
  for (let i = 0; i < exercise.sets.length; i++) {
    const s = exercise.sets[i];
    if (!s.isWarmup && !s.isSkipped) {
      workingSet1Idx = i;
      break;
    }
  }

  const set1Key = workingSet1Idx >= 0 ? `${exerciseIndex}-${workingSet1Idx}` : `${exerciseIndex}-0`;
  const ev1 = committedEvidenceBySet ? committedEvidenceBySet[set1Key] : undefined;
  const snap1 = prescribedTargetSnapshots ? prescribedTargetSnapshots[set1Key] : undefined;

  let calibratedBaseline: number | null = null;

  if (ev1 && !ev1.isWarmup && !ev1.isSkipped && ev1.reps > 0 && ev1.rpe >= 6.0 && ev1.rpe <= 10.0 && snap1 && snap1.reps > 0 && snap1.rpe >= 6.0) {
    const plannedCap = calculatePlannedBodyweightCapacity(bwVal, snap1.reps, snap1.rpe);
    const observedCap = calculateObservedBodyweightCapacity(bwVal, ev1.reps, ev1.rpe);
    if (plannedCap && observedCap) {
      const rawR = observedCap / plannedCap;
      const clampedR = clampBodyweightReadinessRatio(rawR);
      if (typeof contextualBaselineE1RM === 'number' && Number.isFinite(contextualBaselineE1RM) && contextualBaselineE1RM > 0) {
        calibratedBaseline = contextualBaselineE1RM * clampedR;
      } else {
        calibratedBaseline = plannedCap * clampedR;
      }
    }
  } else if (typeof contextualBaselineE1RM === 'number' && Number.isFinite(contextualBaselineE1RM) && contextualBaselineE1RM > 0) {
    calibratedBaseline = contextualBaselineE1RM;
  }

  if (calibratedBaseline === null || calibratedBaseline <= 0) {
    return {
      weight: 0,
      reps: canonicalReps,
      rpe: canonicalRPE,
      form: canonicalForm,
    };
  }

  const priors = getFatiguePrior(profile);
  const fatiguePrior = priors[addedOrdinal - 1] ?? priors[priors.length - 1] ?? 1.0;
  const targetOrdinalCap = calibratedBaseline * fatiguePrior;

  const isIsolation = exercise.muscleGroup === 'Biceps' || exercise.muscleGroup === 'Triceps' || exercise.muscleGroup === 'Calves';
  const bounds = getPermittedRepetitionBounds({
    objective: (objective === 'Strength' ? 'Strength' : 'Hypertrophy'),
    algorithmId: algorithmId as any,
    isIsolation,
    isMachine: false,
    anchorReps: canonicalReps,
  });

  const solved = solveBodyweightRepTarget({
    targetE1RM: targetOrdinalCap,
    sessionBodyweight: bwVal,
    targetRPE: canonicalRPE,
    anchorReps: canonicalReps,
    minReps: bounds.minReps,
    maxReps: bounds.maxReps,
    unit: activeUnit,
  });

  return {
    weight: 0,
    reps: solved.reps,
    rpe: canonicalRPE,
    form: canonicalForm,
  };
}
